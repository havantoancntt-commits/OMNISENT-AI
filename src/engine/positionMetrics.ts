import { getSmartPriceDecimals } from './symbolSearch.ts';
import type { Position } from './types.ts';

export type PositionHealthState = 'NEAR_TP' | 'IN_PROFIT' | 'MONITORING' | 'NEAR_SL';

export interface PositionTelemetry {
  notionalUsd: number;
  entryNotionalUsd: number;
  riskUsd: number;
  rewardUsd: number;
  plannedRR: number;
  rMultiple: number;
  slDistancePct: number;
  tpDistancePct: number;
  liqDistancePct: number | null;
  entryTrackPct: number;
  markTrackPct: number;
  canMoveBreakeven: boolean;
  healthState: PositionHealthState;
  heldDurationLabel: string;
  priceDecimals: number;
}

export interface SlTpValidationResult {
  valid: boolean;
  reason?: string;
  stopLoss: number;
  takeProfit: number;
}

export function getPriceDecimals(price: number): number {
  return getSmartPriceDecimals(price);
}

export function formatHeldDuration(openedAtUtc: string, nowMs = Date.now()): string {
  const openedMs = Date.parse(openedAtUtc);
  if (!Number.isFinite(openedMs)) return '--';
  const diffSec = Math.max(0, Math.floor((nowMs - openedMs) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${String(remMins).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

export function computePositionTelemetry(
  pos: Position,
  nowMs = Date.now(),
): PositionTelemetry {
  const mark = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
  const entry = pos.entryPrice;
  const sl = pos.stopLoss;
  const tp = pos.takeProfit;

  const notionalUsd = Number((pos.quantity * mark).toFixed(2));
  const entryNotionalUsd = Number((pos.quantity * entry).toFixed(2));
  const riskPerUnit = Math.abs(entry - sl);
  const rewardPerUnit = Math.abs(tp - entry);
  const riskUsd = Number((riskPerUnit * pos.quantity).toFixed(2));
  const rewardUsd = Number((rewardPerUnit * pos.quantity).toFixed(2));
  const plannedRR = riskPerUnit > 0 ? Number((rewardPerUnit / riskPerUnit).toFixed(2)) : 0;

  const priceMove = pos.side === 'LONG' ? mark - entry : entry - mark;
  const rMultiple =
    riskPerUnit > 1e-12 ? Number((priceMove / riskPerUnit).toFixed(2)) : 0;

  const slDistancePct =
    mark > 0
      ? Number(
          (((pos.side === 'LONG' ? mark - sl : sl - mark) / mark) * 100).toFixed(2),
        )
      : 0;
  const tpDistancePct =
    mark > 0
      ? Number(
          (((pos.side === 'LONG' ? tp - mark : mark - tp) / mark) * 100).toFixed(2),
        )
      : 0;

  const liqDistancePct =
    pos.liquidationPrice && pos.liquidationPrice > 0 && mark > 0
      ? Number(
          (
            ((pos.side === 'LONG'
              ? mark - pos.liquidationPrice
              : pos.liquidationPrice - mark) /
              mark) *
            100
          ).toFixed(2),
        )
      : null;

  // Map SL -> 0%, TP -> 100% trajectory along trade direction
  const totalSpan = pos.side === 'LONG' ? tp - sl : sl - tp;
  let entryTrackPct = 35;
  let markTrackPct = 35;
  if (totalSpan > 1e-12) {
    const rawEntry =
      pos.side === 'LONG' ? (entry - sl) / totalSpan : (sl - entry) / totalSpan;
    const rawMark =
      pos.side === 'LONG' ? (mark - sl) / totalSpan : (sl - mark) / totalSpan;
    entryTrackPct = Number(Math.max(4, Math.min(96, rawEntry * 100)).toFixed(1));
    markTrackPct = Number(Math.max(0, Math.min(100, rawMark * 100)).toFixed(1));
  }

  // Breakeven eligible when mark is safely in profit (>0.08% beyond entry) and SL hasn't reached entry yet
  const profitBufferOk =
    pos.side === 'LONG'
      ? mark > entry * 1.0008 && sl < entry * 0.9999
      : mark < entry * 0.9992 && sl > entry * 1.0001;

  let healthState: PositionHealthState = 'MONITORING';
  if (markTrackPct >= 80 || tpDistancePct <= 0.45) {
    healthState = 'NEAR_TP';
  } else if (markTrackPct <= 22 || slDistancePct <= 0.45) {
    healthState = 'NEAR_SL';
  } else if (pos.unrealizedPnlUsd > 0) {
    healthState = 'IN_PROFIT';
  }

  return {
    notionalUsd,
    entryNotionalUsd,
    riskUsd,
    rewardUsd,
    plannedRR,
    rMultiple,
    slDistancePct,
    tpDistancePct,
    liqDistancePct,
    entryTrackPct,
    markTrackPct,
    canMoveBreakeven: profitBufferOk,
    healthState,
    heldDurationLabel: formatHeldDuration(pos.openedAtUtc, nowMs),
    priceDecimals: getPriceDecimals(mark),
  };
}

export function validatePositionSlTpUpdate(
  pos: Position,
  newSl: number,
  newTp: number,
  locale: 'en' | 'vi' = 'vi',
): SlTpValidationResult {
  if (!Number.isFinite(newSl) || newSl <= 0) {
    return {
      valid: false,
      reason: locale === 'en' ? 'Stop Loss must be greater than 0.' : 'Stop Loss phải lớn hơn 0.',
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
    };
  }
  if (!Number.isFinite(newTp) || newTp <= 0) {
    return {
      valid: false,
      reason: locale === 'en' ? 'Take Profit must be greater than 0.' : 'Take Profit phải lớn hơn 0.',
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
    };
  }

  const refMark = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;

  if (pos.side === 'LONG') {
    if (newSl >= refMark) {
      return {
        valid: false,
        reason:
          locale === 'en'
            ? `LONG Stop Loss (${newSl}) must be below current Mark price (${refMark}).`
            : `Stop Loss (${newSl}) của lệnh LONG phải thấp hơn giá Mark hiện tại (${refMark}).`,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
      };
    }
    if (newTp <= refMark) {
      return {
        valid: false,
        reason:
          locale === 'en'
            ? `LONG Take Profit (${newTp}) must be above current Mark price (${refMark}).`
            : `Take Profit (${newTp}) của lệnh LONG phải cao hơn giá Mark hiện tại (${refMark}).`,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
      };
    }
  } else {
    if (newSl <= refMark) {
      return {
        valid: false,
        reason:
          locale === 'en'
            ? `SHORT Stop Loss (${newSl}) must be above current Mark price (${refMark}).`
            : `Stop Loss (${newSl}) của lệnh SHORT phải cao hơn giá Mark hiện tại (${refMark}).`,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
      };
    }
    if (newTp >= refMark) {
      return {
        valid: false,
        reason:
          locale === 'en'
            ? `SHORT Take Profit (${newTp}) must be below current Mark price (${refMark}).`
            : `Take Profit (${newTp}) của lệnh SHORT phải thấp hơn giá Mark hiện tại (${refMark}).`,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
      };
    }
  }

  return {
    valid: true,
    stopLoss: newSl,
    takeProfit: newTp,
  };
}

export interface LivePositionEvaluation {
  closed: boolean;
  closeReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_PROFIT';
  closePrice?: number;
  realizedGrossUsd?: number;
  closeFeeUsd?: number;
  realizedNetUsd?: number;
  nextStopLoss: number;
  trailingStage?: 'BREAKEVEN_ARMED' | 'STEP_LOCK_055R' | 'CHANDELIER_55PCT';
  markPrice: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
}

export function evaluateLivePositionLifecycle(params: {
  position: Position;
  markPrice: number;
  canEvaluateTriggers: boolean;
  feeRate?: number;
}): LivePositionEvaluation {
  const { position: pos, markPrice, canEvaluateTriggers, feeRate = 0.0005 } = params;
  const isLong = pos.side === 'LONG';
  const pxDec = getSmartPriceDecimals(pos.entryPrice);

  let nextStopLoss = pos.stopLoss;
  let trailingStage: LivePositionEvaluation['trailingStage'];

  const hitSL =
    canEvaluateTriggers &&
    ((isLong && markPrice <= nextStopLoss) || (!isLong && markPrice >= nextStopLoss));
  const hitTP =
    canEvaluateTriggers &&
    ((isLong && markPrice >= pos.takeProfit) || (!isLong && markPrice <= pos.takeProfit));

  if (hitSL || hitTP) {
    const closePrice = hitSL ? nextStopLoss : pos.takeProfit;
    const realizedGrossUsd = isLong
      ? (closePrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - closePrice) * pos.quantity;
    const closeFeeUsd = pos.quantity * closePrice * feeRate;
    const realizedNetUsd = realizedGrossUsd - closeFeeUsd;
    const closeReason = hitTP
      ? 'TAKE_PROFIT'
      : realizedNetUsd >= 0
        ? 'TRAILING_PROFIT'
        : 'STOP_LOSS';

    return {
      closed: true,
      closeReason,
      closePrice,
      realizedGrossUsd: Number(realizedGrossUsd.toFixed(2)),
      closeFeeUsd: Number(closeFeeUsd.toFixed(2)),
      realizedNetUsd: Number(realizedNetUsd.toFixed(2)),
      nextStopLoss,
      markPrice,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
    };
  }

  // 3-Stage R-Multiple Profit Protection synchronized with Backtester (+0.65R BE, +1.15R step, +1.65R 55% lock)
  if (canEvaluateTriggers && pos.entryPrice > 0) {
    const favorableMove = isLong ? markPrice - pos.entryPrice : pos.entryPrice - markPrice;
    const slProtected = isLong
      ? nextStopLoss >= pos.entryPrice
      : nextStopLoss <= pos.entryPrice;

    const initialSlRef = pos.initialStopLoss ?? (!slProtected ? nextStopLoss : undefined);
    const initialRiskDist = initialSlRef
      ? Math.max(Math.abs(pos.entryPrice - initialSlRef), pos.entryPrice * 0.0035)
      : Math.max(Math.abs(pos.takeProfit - pos.entryPrice) / 1.8, pos.entryPrice * 0.005);

    const rGain = initialRiskDist > 0 ? favorableMove / initialRiskDist : 0;

    if (!slProtected && rGain >= 0.65) {
      const bePrice = Number(
        (isLong ? pos.entryPrice * 1.0018 : pos.entryPrice * 0.9982).toFixed(pxDec),
      );
      const strictlySafe = isLong
        ? bePrice < markPrice && bePrice > nextStopLoss
        : bePrice > markPrice && bePrice < nextStopLoss;
      if (strictlySafe) {
        nextStopLoss = bePrice;
        trailingStage = 'BREAKEVEN_ARMED';
      }
    } else if (slProtected && rGain >= 1.65) {
      const lockedTarget = Number(
        (isLong
          ? pos.entryPrice + favorableMove * 0.55
          : pos.entryPrice - favorableMove * 0.55
        ).toFixed(pxDec),
      );
      const improvesLock = isLong
        ? lockedTarget > nextStopLoss * 1.001 && lockedTarget < markPrice
        : lockedTarget < nextStopLoss * 0.999 && lockedTarget > markPrice;
      if (improvesLock) {
        nextStopLoss = lockedTarget;
        trailingStage = 'CHANDELIER_55PCT';
      }
    } else if (slProtected && rGain >= 1.15) {
      const stepTarget = Number(
        (isLong
          ? pos.entryPrice + initialRiskDist * 0.55
          : pos.entryPrice - initialRiskDist * 0.55
        ).toFixed(pxDec),
      );
      const improvesStep = isLong
        ? stepTarget > nextStopLoss * 1.001 && stepTarget < markPrice
        : stepTarget < nextStopLoss * 0.999 && stepTarget > markPrice;
      if (improvesStep) {
        nextStopLoss = stepTarget;
        trailingStage = 'STEP_LOCK_055R';
      }
    }
  }

  const pnlUsd = isLong
    ? (markPrice - pos.entryPrice) * pos.quantity
    : (pos.entryPrice - markPrice) * pos.quantity;
  const pnlPct = pos.marginUsd > 0 ? (pnlUsd / pos.marginUsd) * 100 : 0;

  return {
    closed: false,
    nextStopLoss,
    trailingStage,
    markPrice,
    unrealizedPnlUsd: Number(pnlUsd.toFixed(2)),
    unrealizedPnlPct: Number(pnlPct.toFixed(2)),
  };
}


