import {
  transitionOrderState,
  mapLifecycleToLegacyOrderStatus,
  type OrderLifecycleState,
  type OrderStateEvent,
} from '../src/engine/orderStateMachine.ts';
import {
  buildLiquidationEstimate,
  computeUnifiedOrderCosts,
  inferContractFilter,
  roundDecimal,
  roundToTick,
  validateContractFilters,
} from '../src/engine/precision.ts';
import { evaluateOrderRisk } from '../src/engine/riskEngine.ts';
import type {
  OrderRecord,
  OrderRequest,
  PortfolioSummary,
  Position,
  RiskCheckResult,
  RiskConfig,
  RiskContext,
} from '../src/engine/types.ts';

export interface ExecutionFillResult {
  ok: boolean;
  executionVenue: 'PAPER_SIMULATOR' | 'LIVE_EXCHANGE';
  isSimulated: boolean;
  orderId: string;
  lifecycleState: OrderLifecycleState;
  events: OrderStateEvent[];
  executedPrice: number;
  executedQty: number;
  feeUsd: number;
  slippageUsd: number;
  riskCheck: RiskCheckResult;
  orderRecord: OrderRecord;
  position?: Position;
  error?: string;
}

export interface ExecutionReconciliationReport {
  status: 'CLEAN' | 'DISCREPANCY_FOUND';
  checkedAtUtc: string;
  openPositionsCount: number;
  ordersCount: number;
  expectedEquityUsd: number;
  recordedEquityUsd: number;
  equityDeltaUsd: number;
  reconciliationRequiredOrderIds: string[];
  notes: string[];
}

export function isLiveExecutionEnabled(): boolean {
  return process.env.OMNISENT_LIVE_EXECUTION_ENABLED === 'true';
}

export class PaperSimulatedExecutionAdapter {
  executeOrder(params: {
    orderRequest: OrderRequest;
    riskConfig: RiskConfig;
    riskContext: RiskContext;
    actor: string;
    slippageBpsOverride?: number;
  }): ExecutionFillResult {
    const { orderRequest, riskConfig, riskContext, actor } = params;
    const nowMs = orderRequest.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const orderId = `ORD-${nowMs}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const events: OrderStateEvent[] = [];

    events.push(
      transitionOrderState({
        orderId,
        fromState: null,
        toState: 'CREATED',
        reason: `Khởi tạo lệnh PAPER_SIMULATOR cho ${orderRequest.symbol} (${orderRequest.side})`,
        actor,
        nowIso,
      }),
    );

    events.push(
      transitionOrderState({
        orderId,
        fromState: 'CREATED',
        toState: 'VALIDATING',
        reason: 'Kiểm định bộ lọc hợp đồng (tickSize/stepSize) & Deterministic Risk Engine',
        actor: 'RISK_MANAGEMENT',
        nowIso,
      }),
    );

    const riskCheck = evaluateOrderRisk(
      {
        ...orderRequest,
        requireFreshTimestamp: orderRequest.requireFreshTimestamp ?? true,
        nowMs,
      },
      riskConfig,
      riskContext,
    );

    const effectiveLeverage =
      orderRequest.marketType === 'SPOT' ? 1 : Math.max(1, orderRequest.leverage);

    if (!riskCheck.approved || riskCheck.recommendedQuantity <= 0) {
      events.push(
        transitionOrderState({
          orderId,
          fromState: 'VALIDATING',
          toState: 'RISK_REJECTED',
          reason: riskCheck.reasons[0] ?? 'Risk Engine từ chối lệnh.',
          actor: 'RISK_MANAGEMENT',
          metadata: { reasons: riskCheck.reasons },
          nowIso,
        }),
      );
      const orderRecord: OrderRecord = {
        id: orderId,
        idempotencyKey: orderRequest.idempotencyKey,
        symbol: orderRequest.symbol,
        exchange: orderRequest.exchange,
        marketType: orderRequest.marketType,
        side: orderRequest.side,
        orderType: orderRequest.orderType,
        quantity: riskCheck.recommendedQuantity,
        price: orderRequest.entryPrice,
        stopLoss: orderRequest.stopLoss,
        takeProfit: orderRequest.takeProfit,
        leverage: effectiveLeverage,
        feesUsd: 0,
        slippageUsd: 0,
        status: mapLifecycleToLegacyOrderStatus('RISK_REJECTED'),
        lifecycleState: 'RISK_REJECTED',
        mode: 'PAPER',
        strategyName: orderRequest.strategyName ?? 'Manual Risk Order',
        riskDecision: riskCheck.decision,
        createdAtUtc: nowIso,
      };
      return {
        ok: false,
        executionVenue: 'PAPER_SIMULATOR',
        isSimulated: true,
        orderId,
        lifecycleState: 'RISK_REJECTED',
        events,
        executedPrice: orderRequest.entryPrice,
        executedQty: riskCheck.recommendedQuantity,
        feeUsd: 0,
        slippageUsd: 0,
        riskCheck,
        orderRecord,
        error: riskCheck.reasons[0] ?? 'Risk Engine rejected order.',
      };
    }

    const filter = inferContractFilter(orderRequest.entryPrice, orderRequest.marketType);
    const slipRate =
      orderRequest.orderType === 'MARKET'
        ? (params.slippageBpsOverride ?? 3) / 10_000
        : 0;
    const rawExecPrice =
      orderRequest.side === 'LONG'
        ? orderRequest.entryPrice * (1 + slipRate)
        : orderRequest.entryPrice * (1 - slipRate);
    const execPrice = roundToTick(rawExecPrice, filter.tickSize) || orderRequest.entryPrice;

    const filterCheck = validateContractFilters({
      price: execPrice,
      quantity: riskCheck.recommendedQuantity,
      filter,
    });
    const finalQty = filterCheck.valid ? filterCheck.normalizedQty : riskCheck.recommendedQuantity;

    events.push(
      transitionOrderState({
        orderId,
        fromState: 'VALIDATING',
        toState: 'SUBMITTED',
        reason: 'Gửi lệnh tới Paper Simulated Execution Venue (NOT REAL EXCHANGE)',
        actor: 'EXECUTION_AGENT',
        nowIso,
      }),
    );

    events.push(
      transitionOrderState({
        orderId,
        fromState: 'SUBMITTED',
        toState: 'ACKNOWLEDGED',
        reason: 'Paper Execution Venue xác nhận nhận lệnh',
        actor: 'EXECUTION_AGENT',
        nowIso,
      }),
    );

    const costs = computeUnifiedOrderCosts({
      quantity: finalQty,
      price: execPrice,
      orderType: orderRequest.orderType,
    });
    const feeUsd = costs.entryFeeUsd;
    const slippageUsd = roundDecimal(Math.abs(execPrice - orderRequest.entryPrice) * finalQty, 2);

    events.push(
      transitionOrderState({
        orderId,
        fromState: 'ACKNOWLEDGED',
        toState: 'FILLED',
        reason: `Khớp mô phỏng PAPER ${finalQty} ${orderRequest.symbol} @ $${execPrice}`,
        actor: 'EXECUTION_AGENT',
        metadata: { feeUsd, slippageUsd, isSimulated: true },
        nowIso,
      }),
    );

    const notional = roundDecimal(finalQty * execPrice, 2);
    const marginUsd = roundDecimal(notional / Math.max(1, effectiveLeverage), 2);
    const liqEst = buildLiquidationEstimate({
      side: orderRequest.side,
      entryPrice: execPrice,
      leverage: effectiveLeverage,
      marketType: orderRequest.marketType,
    });

    const positionId = `POS-${nowMs}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const position: Position = {
      id: positionId,
      symbol: orderRequest.symbol,
      exchange: orderRequest.exchange,
      marketType: orderRequest.marketType,
      side: orderRequest.side,
      quantity: finalQty,
      entryPrice: execPrice,
      markPrice: orderRequest.entryPrice,
      stopLoss: orderRequest.stopLoss,
      initialStopLoss: orderRequest.stopLoss,
      takeProfit: orderRequest.takeProfit,
      leverage: effectiveLeverage,
      marginUsd,
      unrealizedPnlUsd: roundDecimal(
        orderRequest.side === 'LONG'
          ? (orderRequest.entryPrice - execPrice) * finalQty
          : (execPrice - orderRequest.entryPrice) * finalQty,
        2,
      ),
      unrealizedPnlPct: 0,
      liquidationPrice: liqEst.price,
      liquidationIsEstimate: true,
      liquidationMarginMode: liqEst.marginMode,
      fundingPaidUsd: 0,
      strategyName: orderRequest.strategyName ?? 'Manual Risk Order',
      mode: 'PAPER',
      openedAtUtc: nowIso,
    };

    const orderRecord: OrderRecord = {
      id: orderId,
      idempotencyKey: orderRequest.idempotencyKey,
      symbol: orderRequest.symbol,
      exchange: orderRequest.exchange,
      marketType: orderRequest.marketType,
      side: orderRequest.side,
      orderType: orderRequest.orderType,
      quantity: finalQty,
      price: execPrice,
      stopLoss: orderRequest.stopLoss,
      takeProfit: orderRequest.takeProfit,
      leverage: effectiveLeverage,
      feesUsd: feeUsd,
      slippageUsd,
      status: mapLifecycleToLegacyOrderStatus('FILLED'),
      lifecycleState: 'FILLED',
      mode: 'PAPER',
      strategyName: position.strategyName,
      riskDecision: riskCheck.decision,
      createdAtUtc: nowIso,
    };

    return {
      ok: true,
      executionVenue: 'PAPER_SIMULATOR',
      isSimulated: true,
      orderId,
      lifecycleState: 'FILLED',
      events,
      executedPrice: execPrice,
      executedQty: finalQty,
      feeUsd,
      slippageUsd,
      riskCheck,
      orderRecord,
      position,
    };
  }
}

export class LiveExchangeExecutionAdapter {
  executeOrder(): never {
    if (!isLiveExecutionEnabled()) {
      throw new Error(
        'LIVE EXCHANGE EXECUTION DISABLED: OMNISENT_LIVE_EXECUTION_ENABLED=false. Chỉ cho phép khớp lệnh mô phỏng PAPER.',
      );
    }
    throw new Error(
      'LIVE EXCHANGE EXECUTION BLOCKED: Real-money order transmission is intentionally locked pending institutional exchange custody sign-off.',
    );
  }
}

export function reconcileExecutionState(params: {
  portfolio: PortfolioSummary;
  positions: Position[];
  orders: OrderRecord[];
}): ExecutionReconciliationReport {
  const { portfolio, positions, orders } = params;
  const notes: string[] = [];
  const unrealizedSum = positions.reduce((s, p) => s + p.unrealizedPnlUsd, 0);
  const expectedEquityUsd = roundDecimal(
    portfolio.initialEquityUsd + portfolio.realizedPnlUsd + unrealizedSum,
    2,
  );
  const equityDeltaUsd = roundDecimal(Math.abs(portfolio.totalEquityUsd - expectedEquityUsd), 2);
  if (equityDeltaUsd > 0.05) {
    notes.push(
      `Chênh lệch Equity $${equityDeltaUsd.toFixed(2)} (Expected $${expectedEquityUsd.toFixed(2)} vs Recorded $${portfolio.totalEquityUsd.toFixed(2)}).`,
    );
  }

  const reconciliationRequiredOrderIds = orders
    .filter((o) => o.lifecycleState === 'RECONCILIATION_REQUIRED' || o.status === 'OPEN')
    .map((o) => o.id);
  if (reconciliationRequiredOrderIds.length > 0) {
    notes.push(`${reconciliationRequiredOrderIds.length} lệnh đang chờ đối soát trạng thái.`);
  }

  if (notes.length === 0) {
    notes.push('Sổ cái Paper Simulator, vị thế mở và Equity khớp chính xác 100%.');
  }

  return {
    status: notes.length > 1 || equityDeltaUsd > 0.05 || reconciliationRequiredOrderIds.length > 0
      ? 'DISCREPANCY_FOUND'
      : 'CLEAN',
    checkedAtUtc: new Date().toISOString(),
    openPositionsCount: positions.length,
    ordersCount: orders.length,
    expectedEquityUsd,
    recordedEquityUsd: portfolio.totalEquityUsd,
    equityDeltaUsd,
    reconciliationRequiredOrderIds,
    notes,
  };
}
