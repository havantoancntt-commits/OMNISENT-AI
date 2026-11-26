import type {
  OrderRequest,
  RiskCheckResult,
  RiskConfig,
  RiskContext,
} from './types.ts';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  riskPerTradePct: 0.25,
  maxRiskPerTradePct: 0.5,
  dailyLossLimitPct: 1.5,
  weeklyLossLimitPct: 4.0,
  maxDrawdownPct: 8.0,
  defaultLeverage: 1,
  maxLeverage: 3,
  maxOpenPositions: 3,
  minRiskReward: 1.5,
  allowMartingale: false,
  requireStopLoss: true,
  maxSingleAssetExposurePct: 35,
};

const TAKER_FEE_RATE = 0.0005; // 5 bps
const ESTIMATED_SLIPPAGE_RATE = 0.0003; // 3 bps

export function calculatePositionSize(params: {
  accountEquityUsd: number;
  riskPct: number;
  entryPrice: number;
  stopLossPrice: number;
  leverage: number;
  feeRate?: number;
  slippageRate?: number;
}): {
  quantity: number;
  notionalUsd: number;
  requiredMarginUsd: number;
  estimatedRiskUsd: number;
} {
  const {
    accountEquityUsd,
    riskPct,
    entryPrice,
    stopLossPrice,
    leverage,
    feeRate = TAKER_FEE_RATE,
    slippageRate = ESTIMATED_SLIPPAGE_RATE,
  } = params;

  if (
    accountEquityUsd <= 0 ||
    riskPct <= 0 ||
    entryPrice <= 0 ||
    stopLossPrice <= 0 ||
    leverage <= 0
  ) {
    return { quantity: 0, notionalUsd: 0, requiredMarginUsd: 0, estimatedRiskUsd: 0 };
  }

  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  if (stopDistance <= 0) {
    return { quantity: 0, notionalUsd: 0, requiredMarginUsd: 0, estimatedRiskUsd: 0 };
  }

  const riskBudgetUsd = accountEquityUsd * (riskPct / 100);
  // Account for round-trip fees and slippage inside the stop distance
  const effectiveStopPerUnit =
    stopDistance + entryPrice * (feeRate * 2 + slippageRate);
  let quantity = riskBudgetUsd / effectiveStopPerUnit;

  // Cap notional by available equity * leverage * 0.95 safety buffer
  const maxNotionalUsd = accountEquityUsd * leverage * 0.95;
  if (quantity * entryPrice > maxNotionalUsd) {
    quantity = maxNotionalUsd / entryPrice;
  }

  const notionalUsd = quantity * entryPrice;
  const requiredMarginUsd = notionalUsd / leverage;
  const estimatedRiskUsd = quantity * effectiveStopPerUnit;

  return {
    quantity: Number(quantity.toFixed(6)),
    notionalUsd: Number(notionalUsd.toFixed(2)),
    requiredMarginUsd: Number(requiredMarginUsd.toFixed(2)),
    estimatedRiskUsd: Number(estimatedRiskUsd.toFixed(2)),
  };
}

export function estimateLiquidationPrice(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  leverage: number,
  marketType: string,
): number | null {
  if (marketType === 'SPOT' || leverage <= 1) return null;
  const maintenanceMarginRate = 0.005;
  const dec = entryPrice < 0.0001 ? 10 : entryPrice < 0.01 ? 8 : 6;
  if (side === 'LONG') {
    return Number((entryPrice * (1 - 1 / leverage + maintenanceMarginRate)).toFixed(dec));
  }
  return Number((entryPrice * (1 + 1 / leverage - maintenanceMarginRate)).toFixed(dec));
}

/**
 * Deterministic Smart Risk Engine — completely independent of AI/LLM outputs.
 * Has absolute veto power over every trade.
 */
export function evaluateOrderRisk(
  order: OrderRequest,
  config: RiskConfig,
  ctx: RiskContext,
): RiskCheckResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const nowIso = new Date().toISOString();

  // 1. Trading Mode & Emergency Stop Gates
  if (ctx.tradingMode === 'EMERGENCY_STOP') {
    reasons.push('Hệ thống đang ở trạng thái EMERGENCY_STOP — mọi lệnh mới bị khóa.');
  } else if (ctx.tradingMode === 'ANALYSIS_ONLY') {
    reasons.push('Chế độ ANALYSIS_ONLY không cho phép đặt lệnh.');
  }

  // 2. Data Integrity, Freshness & Symbol Status Gates
  if (order.dataStatus !== 'LIVE_EXCHANGE') {
    reasons.push(`Dữ liệu thị trường không phải LIVE_EXCHANGE (${order.dataStatus}) — chặn đặt lệnh.`);
  }
  if (
    typeof order.tickerTimestampUtc === 'number' &&
    Number.isFinite(order.tickerTimestampUtc)
  ) {
    const evalNow = typeof order.nowMs === 'number' && Number.isFinite(order.nowMs) ? order.nowMs : Date.now();
    const ageMs = evalNow - order.tickerTimestampUtc;
    if (ageMs > 30_000) {
      reasons.push(
        `Dữ liệu giá thị trường đã cũ (${Math.round(ageMs / 1000)}s > 30s) — chặn đặt lệnh để tránh trượt giá.`,
      );
    }
  }
  if (order.tradingStatus && order.tradingStatus !== 'TRADING') {
    reasons.push(`Trạng thái cặp giao dịch không hợp lệ (${order.tradingStatus}).`);
  }

  // 3. Idempotency / Duplicate Order Protection
  if (!order.idempotencyKey || ctx.recentIdempotencyKeys.includes(order.idempotencyKey)) {
    reasons.push('Phát hiện khóa idempotency trùng lặp hoặc thiếu — chặn gửi lệnh trùng.');
  }

  // 4. Loss Limits & Drawdown Circuit Breakers
  if (ctx.dailyPnlPct <= -Math.abs(config.dailyLossLimitPct)) {
    reasons.push(
      `Đã chạm giới hạn lỗ ngày (${ctx.dailyPnlPct.toFixed(2)}% <= -${config.dailyLossLimitPct}%).`,
    );
  }
  if (ctx.weeklyPnlPct <= -Math.abs(config.weeklyLossLimitPct)) {
    reasons.push(
      `Đã chạm giới hạn lỗ tuần (${ctx.weeklyPnlPct.toFixed(2)}% <= -${config.weeklyLossLimitPct}%).`,
    );
  }
  if (ctx.currentDrawdownPct >= config.maxDrawdownPct) {
    reasons.push(
      `Drawdown (${ctx.currentDrawdownPct.toFixed(2)}%) vượt ngưỡng khóa tối đa (${config.maxDrawdownPct}%).`,
    );
  }

  // 5. Open Positions & Anti-Martingale Check
  if (ctx.openPositions.length >= config.maxOpenPositions) {
    reasons.push(
      `Số vị thế đang mở (${ctx.openPositions.length}) đã đạt giới hạn (${config.maxOpenPositions}).`,
    );
  }

  const existingSameSymbol = ctx.openPositions.find(
    (p) => p.symbol === order.symbol && p.side === order.side,
  );
  if (existingSameSymbol && existingSameSymbol.unrealizedPnlUsd < 0) {
    reasons.push(
      `Chặn tăng vị thế đang thua lỗ (${order.symbol} ${order.side}) theo quy tắc cấm Martingale.`,
    );
  }

  const opposingSamePair = ctx.openPositions.find(
    (p) =>
      p.symbol.toUpperCase() === order.symbol.toUpperCase() &&
      p.marketType === order.marketType &&
      p.side !== order.side,
  );
  if (opposingSamePair) {
    reasons.push(
      `Xung đột vị thế đối nghịch (${order.symbol} ${order.marketType}): đang mở ${opposingSamePair.side}, chặn mở ${order.side} để tránh tự hedge khóa biên lợi nhuận.`,
    );
  }

  // 6. Leverage & Spot Constraints
  const effectiveLeverage = order.marketType === 'SPOT' ? 1 : order.leverage;
  if (order.marketType === 'SPOT' && order.side === 'SHORT') {
    reasons.push('Không thể mở lệnh SHORT trên thị trường SPOT thuần.');
  }
  if (order.marketType === 'SPOT' && order.leverage > 1) {
    reasons.push('Thị trường SPOT chỉ hỗ trợ đòn bẩy 1x.');
  }
  if (effectiveLeverage > config.maxLeverage || effectiveLeverage <= 0) {
    reasons.push(
      `Đòn bẩy (${effectiveLeverage}x) vượt giới hạn cho phép (tối đa ${config.maxLeverage}x).`,
    );
  }

  // 7. Stop Loss & Take Profit Geometry Validation
  if (
    !Number.isFinite(order.entryPrice) ||
    !Number.isFinite(order.stopLoss) ||
    !Number.isFinite(order.takeProfit) ||
    order.entryPrice <= 0 ||
    order.stopLoss <= 0 ||
    order.takeProfit <= 0
  ) {
    reasons.push('Giá Entry, Stop Loss và Take Profit phải là số hữu hạn lớn hơn 0.');
  } else {
    if (order.side === 'LONG') {
      if (order.stopLoss >= order.entryPrice) {
        reasons.push('Lệnh LONG yêu cầu Stop Loss phải thấp hơn Entry.');
      }
      if (order.takeProfit <= order.entryPrice) {
        reasons.push('Lệnh LONG yêu cầu Take Profit phải cao hơn Entry.');
      }
    } else {
      if (order.stopLoss <= order.entryPrice) {
        reasons.push('Lệnh SHORT yêu cầu Stop Loss phải cao hơn Entry.');
      }
      if (order.takeProfit >= order.entryPrice) {
        reasons.push('Lệnh SHORT yêu cầu Take Profit phải thấp hơn Entry.');
      }
    }
  }

  const riskDist = Math.abs(order.entryPrice - order.stopLoss);
  const rewardDist = Math.abs(order.takeProfit - order.entryPrice);
  const riskRewardRatio = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 0;

  if (riskRewardRatio < config.minRiskReward) {
    reasons.push(
      `Tỷ lệ Risk/Reward (${riskRewardRatio.toFixed(2)}) thấp hơn mức tối thiểu (${config.minRiskReward}).`,
    );
  }

  // 8. Position Sizing, Single-Asset Exposure Cap & Margin Verification
  const targetRiskPct = Math.min(
    order.riskPctOverride ?? config.riskPerTradePct,
    config.maxRiskPerTradePct,
  );
  const sized = calculatePositionSize({
    accountEquityUsd: ctx.accountEquityUsd,
    riskPct: targetRiskPct,
    entryPrice: order.entryPrice,
    stopLossPrice: order.stopLoss,
    leverage: effectiveLeverage,
  });

  let finalQty = sized.quantity;
  let reduced = false;
  if (order.quantity !== undefined && Number.isFinite(order.quantity) && order.quantity > 0) {
    if (order.quantity > sized.quantity * 1.05 && sized.quantity > 0) {
      warnings.push(
        `Khối lượng yêu cầu (${order.quantity}) vượt ngân sách rủi ro ${targetRiskPct}%, đã điều chỉnh về ${sized.quantity}.`,
      );
      finalQty = sized.quantity;
      reduced = true;
    } else {
      finalQty = order.quantity;
    }
  }

  const existingSymbolNotionalUsd = ctx.openPositions
    .filter((p) => p.symbol === order.symbol)
    .reduce(
      (sum, p) => sum + p.quantity * (p.markPrice > 0 ? p.markPrice : p.entryPrice),
      0,
    );
  const maxAssetExposureUsd =
    ctx.accountEquityUsd * (Math.max(1, config.maxSingleAssetExposurePct) / 100);
  const remainingExposureUsd = Math.max(0, maxAssetExposureUsd - existingSymbolNotionalUsd);

  if (
    order.entryPrice > 0 &&
    finalQty * order.entryPrice > remainingExposureUsd + 0.01
  ) {
    if (order.quantity === undefined && remainingExposureUsd >= 10) {
      finalQty = Number((remainingExposureUsd / order.entryPrice).toFixed(6));
      reduced = true;
      warnings.push(
        `Đã giới hạn khối lượng ${order.symbol} về ${finalQty} để không vượt trần phơi nhiễm ${config.maxSingleAssetExposurePct}% Equity.`,
      );
    } else {
      const projectedExposureUsd = existingSymbolNotionalUsd + finalQty * order.entryPrice;
      reasons.push(
        `Phơi nhiễm tài sản ${order.symbol} ($${projectedExposureUsd.toFixed(2)}) vượt giới hạn tối đa ${config.maxSingleAssetExposurePct}% Equity ($${maxAssetExposureUsd.toFixed(2)}).`,
      );
    }
  }

  const notionalValueUsd = Number((finalQty * order.entryPrice).toFixed(2));
  const requiredMarginUsd = Number((notionalValueUsd / Math.max(1, effectiveLeverage)).toFixed(2));
  const estimatedFeesUsd = Number((notionalValueUsd * TAKER_FEE_RATE * 2).toFixed(2));
  const estimatedSlippageUsd = Number((notionalValueUsd * ESTIMATED_SLIPPAGE_RATE).toFixed(2));
  const estimatedRiskUsd = Number(
    (finalQty * riskDist + estimatedFeesUsd + estimatedSlippageUsd).toFixed(2),
  );
  const estimatedRiskPct =
    ctx.accountEquityUsd > 0
      ? Number(((estimatedRiskUsd / ctx.accountEquityUsd) * 100).toFixed(3))
      : 100;

  if (estimatedRiskPct > config.maxRiskPerTradePct + 0.05) {
    reasons.push(
      `Rủi ro lệnh (${estimatedRiskPct.toFixed(2)}%) vượt ngưỡng tối đa (${config.maxRiskPerTradePct}%).`,
    );
  }
  if (requiredMarginUsd > ctx.availableBalanceUsd) {
    reasons.push(
      `Ký quỹ yêu cầu ($${requiredMarginUsd.toFixed(2)}) vượt số dư khả dụng ($${ctx.availableBalanceUsd.toFixed(2)}).`,
    );
  }
  if (notionalValueUsd < 10) {
    reasons.push('Giá trị lệnh tối thiểu phải >= $10 USDT.');
  }

  const liquidationPriceEst = estimateLiquidationPrice(
    order.side,
    order.entryPrice,
    effectiveLeverage,
    order.marketType,
  );

  // Check if liquidation price is dangerously close to stop loss
  if (liquidationPriceEst !== null) {
    if (order.side === 'LONG' && liquidationPriceEst >= order.stopLoss) {
      reasons.push(
        `Giá thanh lý ước tính ($${liquidationPriceEst}) cao hơn hoặc bằng Stop Loss ($${order.stopLoss}).`,
      );
    }
    if (order.side === 'SHORT' && liquidationPriceEst <= order.stopLoss) {
      reasons.push(
        `Giá thanh lý ước tính ($${liquidationPriceEst}) thấp hơn hoặc bằng Stop Loss ($${order.stopLoss}).`,
      );
    }
  }

  let decision: RiskCheckResult['decision'] = 'APPROVE';
  if (ctx.currentDrawdownPct >= config.maxDrawdownPct || ctx.tradingMode === 'EMERGENCY_STOP') {
    decision = 'LOCK_SYSTEM';
  } else if (reasons.length > 0) {
    decision = 'REJECT';
  } else if (reduced) {
    decision = 'REDUCE_POSITION';
  }

  return {
    decision,
    approved: reasons.length === 0,
    reasons,
    warnings,
    recommendedQuantity: finalQty,
    notionalValueUsd,
    requiredMarginUsd,
    estimatedRiskUsd,
    estimatedRiskPct,
    riskRewardRatio,
    estimatedFeesUsd,
    estimatedSlippageUsd,
    liquidationPriceEst,
    checkedAtUtc: nowIso,
  };
}
