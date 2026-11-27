/**
 * Precision arithmetic, exchange contract filters, unified fee/slippage model,
 * and explicitly labeled liquidation estimation helpers.
 */

export interface ContractFilterSpec {
  tickSize: number;
  stepSize: number;
  minQty: number;
  maxQty: number;
  minNotionalUsd: number;
}

export interface FeeModelSpec {
  makerFeeBps: number;
  takerFeeBps: number;
  slippageBps: number;
}

export interface OrderCostBreakdown {
  grossNotionalUsd: number;
  entryFeeUsd: number;
  exitFeeEstUsd: number;
  roundTripFeeUsd: number;
  slippageEstUsd: number;
  totalFrictionUsd: number;
}

export interface LiquidationEstimateDetail {
  price: number | null;
  isEstimate: true;
  marginMode: 'ISOLATED' | 'CROSS';
  maintenanceMarginRate: number;
  maintenanceMarginMethod: string;
  disclaimer: string;
}

export const DEFAULT_FEE_MODEL: FeeModelSpec = {
  makerFeeBps: 2,
  takerFeeBps: 5,
  slippageBps: 3,
};

export function inferDecimalPlaces(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 6;
  const s = step.toExponential();
  const match = s.match(/e-(\d+)$/);
  if (match) {
    return Math.min(10, Number(match[1]));
  }
  const plain = String(step);
  const dot = plain.indexOf('.');
  return dot >= 0 ? Math.min(10, plain.length - dot - 1) : 0;
}

export function roundDecimal(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const d = Math.max(0, Math.min(10, Math.trunc(decimals)));
  const factor = Math.pow(10, d);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function roundToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return roundDecimal(price, 6);
  const decimals = inferDecimalPlaces(tickSize);
  const ticks = Math.round(price / tickSize);
  return roundDecimal(ticks * tickSize, decimals);
}

export function roundToStep(quantity: number, stepSize: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(stepSize) || stepSize <= 0) return roundDecimal(quantity, 6);
  const decimals = inferDecimalPlaces(stepSize);
  // Floor to step size so orders never exceed risk/margin budget
  const steps = Math.floor((quantity + 1e-12) / stepSize);
  return roundDecimal(steps * stepSize, decimals);
}

export function inferContractFilter(entryPrice: number, marketType: string): ContractFilterSpec {
  const safePrice = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 1;
  const tickSize =
    safePrice < 0.0001
      ? 0.00000001
      : safePrice < 0.01
        ? 0.000001
        : safePrice < 2
          ? 0.0001
          : safePrice < 100
            ? 0.001
            : 0.01;
  const stepSize =
    safePrice >= 10_000
      ? 0.0001
      : safePrice >= 500
        ? 0.001
        : safePrice >= 10
          ? 0.01
          : safePrice >= 0.5
            ? 0.1
            : 1;
  return {
    tickSize,
    stepSize,
    minQty: stepSize,
    maxQty: marketType === 'SPOT' ? 1_000_000 : 500_000,
    minNotionalUsd: 10,
  };
}

export function validateContractFilters(params: {
  price: number;
  quantity: number;
  filter: ContractFilterSpec;
}): { valid: boolean; reason?: string; normalizedQty: number; normalizedPrice: number } {
  const normalizedPrice = roundToTick(params.price, params.filter.tickSize);
  const normalizedQty = roundToStep(params.quantity, params.filter.stepSize);

  if (normalizedPrice <= 0) {
    return {
      valid: false,
      reason: 'Giá sau làm tròn tickSize phải > 0.',
      normalizedQty,
      normalizedPrice,
    };
  }
  if (normalizedQty < params.filter.minQty) {
    return {
      valid: false,
      reason: `Khối lượng (${normalizedQty}) nhỏ hơn minQty (${params.filter.minQty}).`,
      normalizedQty,
      normalizedPrice,
    };
  }
  if (normalizedQty > params.filter.maxQty) {
    return {
      valid: false,
      reason: `Khối lượng (${normalizedQty}) vượt maxQty (${params.filter.maxQty}).`,
      normalizedQty,
      normalizedPrice,
    };
  }
  const notional = roundDecimal(normalizedQty * normalizedPrice, 2);
  if (notional < params.filter.minNotionalUsd) {
    return {
      valid: false,
      reason: `Giá trị danh nghĩa ($${notional.toFixed(2)}) thấp hơn minNotional ($${params.filter.minNotionalUsd}).`,
      normalizedQty,
      normalizedPrice,
    };
  }
  return {
    valid: true,
    normalizedQty,
    normalizedPrice,
  };
}

export function computeUnifiedOrderCosts(params: {
  quantity: number;
  price: number;
  orderType?: 'MARKET' | 'LIMIT' | 'STOP';
  feeModel?: FeeModelSpec;
}): OrderCostBreakdown {
  const model = params.feeModel ?? DEFAULT_FEE_MODEL;
  const grossNotionalUsd = roundDecimal(Math.max(0, params.quantity) * Math.max(0, params.price), 2);
  const entryBps = params.orderType === 'LIMIT' ? model.makerFeeBps : model.takerFeeBps;
  const exitBps = model.takerFeeBps;
  const slippageBps = params.orderType === 'LIMIT' ? model.slippageBps * 0.5 : model.slippageBps;

  const entryFeeUsd = roundDecimal(grossNotionalUsd * (entryBps / 10_000), 2);
  const exitFeeEstUsd = roundDecimal(grossNotionalUsd * (exitBps / 10_000), 2);
  const roundTripFeeUsd = roundDecimal(entryFeeUsd + exitFeeEstUsd, 2);
  const slippageEstUsd = roundDecimal(grossNotionalUsd * (slippageBps / 10_000), 2);
  const totalFrictionUsd = roundDecimal(roundTripFeeUsd + slippageEstUsd, 2);

  return {
    grossNotionalUsd,
    entryFeeUsd,
    exitFeeEstUsd,
    roundTripFeeUsd,
    slippageEstUsd,
    totalFrictionUsd,
  };
}

export function computeSingleLegCloseFee(params: {
  quantity: number;
  closePrice: number;
  takerFeeBps?: number;
}): number {
  const takerFeeBps = params.takerFeeBps ?? DEFAULT_FEE_MODEL.takerFeeBps;
  return roundDecimal(Math.max(0, params.quantity) * Math.max(0, params.closePrice) * (takerFeeBps / 10_000), 2);
}

export function buildLiquidationEstimate(params: {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  leverage: number;
  marketType: string;
  marginMode?: 'ISOLATED' | 'CROSS';
  maintenanceMarginRate?: number;
}): LiquidationEstimateDetail {
  const marginMode = params.marginMode ?? 'ISOLATED';
  const mmr = params.maintenanceMarginRate ?? 0.005;

  if (params.marketType === 'SPOT' || params.leverage <= 1 || params.entryPrice <= 0) {
    return {
      price: null,
      isEstimate: true,
      marginMode,
      maintenanceMarginRate: mmr,
      maintenanceMarginMethod: 'NONE_SPOT_1X',
      disclaimer: 'SPOT / 1x: Không có giá thanh lý ký quỹ đòn bẩy.',
    };
  }

  const dec = params.entryPrice < 0.0001 ? 10 : params.entryPrice < 0.01 ? 8 : 6;
  const raw =
    params.side === 'LONG'
      ? params.entryPrice * (1 - 1 / params.leverage + mmr)
      : params.entryPrice * (1 + 1 / params.leverage - mmr);

  return {
    price: roundDecimal(Math.max(0, raw), dec),
    isEstimate: true,
    marginMode,
    maintenanceMarginRate: mmr,
    maintenanceMarginMethod: 'SIMULATED_TIERED_MMR_0.5PCT',
    disclaimer:
      'ESTIMATE: Giá thanh lý mô phỏng theo bậc MMR chuẩn 0.50% (chưa bao gồm biến động funding/ADL thực tế của từng sàn).',
  };
}
