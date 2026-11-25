import * as THREE from 'three';
import type {
  AgentState,
  DebateTurn,
  MarketTicker,
  OrderBookSnapshot,
  PortfolioSummary,
  TradingMode,
  TradingSignal,
} from '../../engine/types';

import type { Locale } from '../../i18n/translations';

export interface RobotScreenContext {
  ticker: MarketTicker | null;
  orderBook: OrderBookSnapshot | null;
  portfolio: PortfolioSummary;
  signal: TradingSignal | null;
  activeTurn: DebateTurn | null;
  tradingMode: TradingMode;
  openPositionsCount: number;
  locale?: Locale;
}

const ROLE_SHORT_TAGS: Record<string, string> = {
  MASTER_ORCHESTRATOR: 'MASTER AI',
  MARKET_DATA: 'MKT DATA',
  DATA_INTEGRITY: 'DATA GATE',
  MARKET_REGIME: 'REGIME AI',
  TECHNICAL_ANALYSIS: 'TECH TA',
  ORDER_BOOK_LIQUIDITY: 'L2 BOOK',
  QUANT_AI: 'QUANT AI',
  FUNDAMENTAL_RESEARCH: 'TOKENOMICS',
  ON_CHAIN_INTELLIGENCE: 'ON-CHAIN',
  NEWS_SENTIMENT: 'SENTIMENT',
  STRATEGY_GENERATION: 'STRAT GEN',
  STRATEGY_VALIDATION: 'VALIDATOR',
  RISK_MANAGEMENT: 'RISK GATE',
  EXECUTION_AGENT: 'EXECUTION',
  PORTFOLIO_MANAGEMENT: 'PORTFOLIO',
  POSITION_MONITORING: 'POS GUARD',
  EXIT_STRATEGY: 'EXIT MGR',
  AI_PERFORMANCE: 'PERF AUDIT',
  CYBERSECURITY: 'SEC VAULT',
};

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines && words.length > 0) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(`${last}...`).width <= maxWidth && lines.join(' ').length < text.length) {
      lines[maxLines - 1] = `${last}...`;
    }
  }
  return lines;
}

function getCategoryHexCss(agent: AgentState): string {
  if (!agent.enabled || agent.status === 'DISABLED' || agent.status === 'OFFLINE') return '#64748B';
  if (agent.status === 'ERROR') return '#EF4444';
  switch (agent.category) {
    case 'ORCHESTRATION':
      return '#22D3EE';
    case 'DATA':
      return '#38BDF8';
    case 'ANALYSIS':
      return '#818CF8';
    case 'STRATEGY':
      return '#F59E0B';
    case 'RISK':
      return '#10B981';
    case 'EXECUTION':
      return '#34D399';
    case 'SECURITY':
      return '#F43F5E';
    default:
      return '#22D3EE';
  }
}

function getPhaseCss(phase: DebateTurn['phase']): string {
  switch (phase) {
    case 'PROPOSE':
      return '#22D3EE';
    case 'CHALLENGE':
      return '#F59E0B';
    case 'REBUTTAL':
      return '#818CF8';
    case 'VETO':
      return '#F43F5E';
    case 'VERDICT':
      return '#10B981';
  }
}

export interface RobotLiveWorkView {
  headline: string;
  body: string;
  metricLabel: string;
  metricValue: string;
  gaugePct: number;
  statusTag: string;
  accentCss: string;
}

export function buildRobotLiveWorkView(
  agent: AgentState,
  ctxData: RobotScreenContext,
): RobotLiveWorkView {
  const {
    ticker,
    orderBook,
    portfolio,
    signal,
    activeTurn,
    tradingMode,
    openPositionsCount,
    locale = 'vi',
  } = ctxData;
  const isEn = locale === 'en';
  const baseCss = getCategoryHexCss(agent);

  if (!agent.enabled || agent.status === 'DISABLED') {
    return {
      headline: isEn ? 'STATUS: TEMPORARILY DISABLED' : 'TRẠNG THÁI: ĐANG TẠM TẮT',
      body: isEn
        ? 'Autonomous agent paused by operator configuration. Outputs are excluded from consensus voting.'
        : 'Nhân viên robot đã tạm ngưng theo cấu hình người vận hành. Dữ liệu đầu ra không tham gia bỏ phiếu.',
      metricLabel: 'HEALTH',
      metricValue: 'STANDBY',
      gaugePct: 0,
      statusTag: 'DISABLED',
      accentCss: '#64748B',
    };
  }

  const isSpeaker = Boolean(activeTurn && activeTurn.speakerId === agent.id);
  const isTarget = Boolean(activeTurn && activeTurn.targetId === agent.id);

  if (isSpeaker && activeTurn) {
    const phaseCss = getPhaseCss(activeTurn.phase);
    return {
      headline: isEn
        ? `▶ DEBATE STEP ${activeTurn.step}/7 · ${activeTurn.phase}`
        : `▶ PHẢN BIỆN BƯỚC ${activeTurn.step}/7 · ${activeTurn.phase}`,
      body: activeTurn.argument,
      metricLabel: `${isEn ? 'TO' : 'ĐỐI THOẠI'} → ${ROLE_SHORT_TAGS[activeTurn.targetId] ?? activeTurn.targetName}`,
      metricValue: activeTurn.evidenceMetric,
      gaugePct: Math.min(100, Math.max(25, 70 + activeTurn.confidenceDelta)),
      statusTag: activeTurn.phase,
      accentCss: phaseCss,
    };
  }

  if (isTarget && activeTurn) {
    const phaseCss = getPhaseCss(activeTurn.phase);
    return {
      headline: isEn
        ? `◀ CHALLENGED BY ${ROLE_SHORT_TAGS[activeTurn.speakerId] ?? activeTurn.speakerName}`
        : `◀ NHẬN PHẢN BIỆN TỪ ${ROLE_SHORT_TAGS[activeTurn.speakerId] ?? activeTurn.speakerName}`,
      body: isEn
        ? `Cross-checking claim "${activeTurn.evidenceMetric}" against independent telemetry at the council table.`
        : `Đang kiểm tra luận điểm "${activeTurn.evidenceMetric}" và đối chiếu dữ liệu độc lập tại bàn hội đồng.`,
      metricLabel: isEn ? 'DEBATE ROUND' : 'BƯỚC TRANH LUẬN',
      metricValue: `${activeTurn.step}/7 · ${activeTurn.stance}`,
      gaugePct: 82,
      statusTag: 'CHALLENGED',
      accentCss: phaseCss,
    };
  }

  const sym = ticker?.symbol ?? 'BTC/USDT';
  const baseAsset = ticker?.baseAsset ?? 'BTC';
  const priceStr = ticker
    ? `$${ticker.lastPrice.toLocaleString('en-US', { maximumFractionDigits: ticker.lastPrice < 10 ? 4 : 2 })}`
    : '--';
  const chg = ticker?.change24hPct ?? 0;
  const chgStr = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
  const spreadBps = (orderBook?.spreadBps ?? ticker?.spreadBps ?? 0).toFixed(2);
  const imbPct = ((orderBook?.imbalanceRatio ?? 0) * 100).toFixed(1);
  const liqScore = ticker?.liquidityScore ?? 0;
  const rsiStr = ticker?.rsi14 !== null && ticker?.rsi14 !== undefined ? ticker.rsi14.toFixed(1) : '--';
  const vote = signal?.agentVotes.find((v) => v.agentId === agent.id);

  switch (agent.id) {
    case 'MASTER_ORCHESTRATOR':
      return {
        headline: signal
          ? `${isEn ? 'COUNCIL ORCHESTRATION' : 'ĐIỀU PHỐI HỘI ĐỒNG'} · ${sym}`
          : `${isEn ? 'AWAITING RUN' : 'CHỜ LỆNH RUN'} · ${sym}`,
        body: signal
          ? isEn
            ? `19-agent consensus: ${signal.direction} (${signal.confidenceScore}/100) · ${signal.state}. ${signal.conflictsDetected.length} conflict(s) mediated.`
            : `Tổng hợp 19 tác nhân: ${signal.direction} (${signal.confidenceScore}/100) · ${signal.state}. ${signal.conflictsDetected.length} xung đột được kiểm soát.`
          : isEn
            ? 'Zero default positions at startup. Execute Smart RUN to convene all 19 AI agents for full adversarial review.'
            : 'Không có lệnh mặc định ban đầu. Nhấn nút RUN thông minh để kích hoạt 19 Robot AI phân tích & phản biện.',
        metricLabel: 'CONSENSUS',
        metricValue: signal ? `${signal.direction} · ${signal.confidenceScore}%` : `STANDBY`,
        gaugePct: signal ? signal.confidenceScore : agent.healthPct,
        statusTag: signal ? 'ONLINE' : 'READY',
        accentCss: baseCss,
      };
    case 'MARKET_DATA':
      return {
        headline: `${isEn ? 'EXCHANGE FEED' : 'THU THẬP FEED'} ${sym} · ${ticker?.exchange ?? 'EXCHANGE'}`,
        body: isEn
          ? `Last ${priceStr} (${chgStr} 24h) · 24h Vol $${Math.round((ticker?.volume24hUsd ?? 0) / 1_000_000)}M · Feed ${ticker?.dataStatus ?? 'OFFLINE'}.`
          : `Giá khớp ${priceStr} (${chgStr} 24h) · KL 24h $${Math.round((ticker?.volume24hUsd ?? 0) / 1_000_000)}M · Nguồn ${ticker?.dataStatus ?? 'OFFLINE'}.`,
        metricLabel: 'LATENCY',
        metricValue: `${ticker ? ticker.latencyMs : agent.latencyMs} ms`,
        gaugePct: ticker?.dataStatus === 'LIVE_EXCHANGE' ? 98 : 0,
        statusTag: ticker?.dataStatus === 'LIVE_EXCHANGE' ? 'LIVE' : 'OFFLINE',
        accentCss: baseCss,
      };
    case 'DATA_INTEGRITY':
      return {
        headline: `${isEn ? 'DATA INTEGRITY AUDIT' : 'KIỂM ĐỊNH CHẤT LƯỢNG DỮ LIỆU'} ${sym}`,
        body: isEn
          ? `Spread ${spreadBps} bps · Freshness ${ticker ? `${ticker.latencyMs}ms` : '--'} · Listing status: ${ticker?.tradingStatus ?? 'UNKNOWN'}.`
          : `Spread ${spreadBps} bps · Freshness ${ticker ? `${ticker.latencyMs}ms` : '--'} · Trạng thái niêm yết: ${ticker?.tradingStatus ?? 'UNKNOWN'}.`,
        metricLabel: 'DATA SCORE',
        metricValue: signal ? `${signal.dataQualityScore}/100` : (ticker?.dataStatus === 'LIVE_EXCHANGE' ? 'LIVE OK' : 'UNVERIFIED'),
        gaugePct: signal?.dataQualityScore ?? (ticker?.dataStatus === 'LIVE_EXCHANGE' ? 92 : 0),
        statusTag: ticker?.dataStatus === 'LIVE_EXCHANGE' ? 'VERIFIED' : 'WAIT',
        accentCss: baseCss,
      };
    case 'MARKET_REGIME':
      return {
        headline: `${isEn ? 'MARKET REGIME CLASSIFIER' : 'PHÂN LOẠI CHẾ ĐỘ THỊ TRƯỜNG'} · ${sym}`,
        body: isEn
          ? `Current state: ${ticker?.regime ?? 'UNKNOWN_REGIME'}. 24h volatility: ${(ticker?.volatility24hPct ?? 0).toFixed(2)}% · Liquidity ${liqScore}/100.`
          : `Trạng thái hiện tại: ${ticker?.regime ?? 'UNKNOWN_REGIME'}. Biến động 24h: ${(ticker?.volatility24hPct ?? 0).toFixed(2)}% · Thanh khoản ${liqScore}/100.`,
        metricLabel: 'REGIME',
        metricValue: ticker?.regime ?? 'SCANNING',
        gaugePct: Math.min(100, Math.round(liqScore)),
        statusTag: ticker?.dataStatus === 'LIVE_EXCHANGE' ? 'ONLINE' : 'WAIT',
        accentCss: baseCss,
      };
    case 'TECHNICAL_ANALYSIS':
      return {
        headline: `${isEn ? 'MULTI-TF TECHNICAL ENGINE' : 'CHỈ BÁO KỸ THUẬT MULTI-TF'} · ${sym}`,
        body: vote
          ? `${vote.rationale}`
          : isEn
            ? `Tracking EMA9/21/50/200, RSI(14)=${rsiStr}, MACD, ATR14 & key S/R zones for ${sym}.`
            : `Đang theo dõi EMA9/21/50/200, RSI(14)=${rsiStr}, MACD, ATR14 & Kháng cự/Hỗ trợ cho ${sym}.`,
        metricLabel: 'TECH SCORE',
        metricValue: signal ? `${signal.technicalScore}/100 · RSI ${rsiStr}` : `RSI ${rsiStr}`,
        gaugePct: signal?.technicalScore ?? (ticker?.rsi14 ?? 0),
        statusTag: vote?.stance ?? 'READY',
        accentCss: baseCss,
      };
    case 'ORDER_BOOK_LIQUIDITY':
      return {
        headline: `${isEn ? 'L2 ORDER BOOK & LIQUIDITY' : 'SỔ LỆNH L2 & THANH KHOẢN'} · ${sym}`,
        body: orderBook && orderBook.bids.length > 0
          ? isEn
            ? `Bid/Ask Imbalance: ${imbPct}% · Spread ${spreadBps} bps · Book depth score ${liqScore}/100 (L2 Live).`
            : `Mất cân bằng Bid/Ask: ${imbPct}% · Spread ${spreadBps} bps · Độ sâu sổ lệnh ${liqScore}/100 (L2 Live).`
          : isEn
            ? `Connecting to live L2 depth stream on ${ticker?.exchange ?? 'venue'} for ${sym}.`
            : `Đang kết nối sổ lệnh L2 trực tiếp từ ${ticker?.exchange ?? 'sàn'} cho ${sym}.`,
        metricLabel: 'IMBALANCE',
        metricValue: orderBook && orderBook.bids.length > 0 ? `${imbPct}% · ${spreadBps}bps` : '--',
        gaugePct: Math.min(100, Math.max(0, Math.round(liqScore))),
        statusTag: orderBook && orderBook.bids.length > 0 ? (Number(imbPct) >= 0 ? 'BID HEAVY' : 'ASK HEAVY') : 'WAIT',
        accentCss: baseCss,
      };
    case 'QUANT_AI':
      return {
        headline: `${isEn ? 'QUANT ENGINE & EXPECTANCY' : 'MÔ HÌNH ĐỊNH LƯỢNG & KỲ VỌNG'} · ${sym}`,
        body: vote
          ? isEn
            ? `${vote.rationale}. Validated net of ~13 bps fee & slippage hurdle.`
            : `${vote.rationale}. Đối chiếu ngưỡng phí + slippage ~13 bps trước khi đề xuất lệnh.`
          : isEn
            ? `Awaiting Smart RUN to evaluate net-of-fee expected return & ADX regime for ${sym}.`
            : `Chờ nhấn RUN để tính kỳ vọng lợi nhuận ròng sau phí & ADX thực tế cho ${sym}.`,
        metricLabel: 'QUANT EDGE',
        metricValue: signal ? `${signal.quantScore}/100` : 'STANDBY',
        gaugePct: signal?.quantScore ?? 0,
        statusTag: vote?.stance ?? 'READY',
        accentCss: baseCss,
      };
    case 'FUNDAMENTAL_RESEARCH':
      return {
        headline: `${isEn ? 'VENUE LIQUIDITY SCREEN' : 'KIỂM TRA THANH KHOẢN SÀN'} · ${baseAsset}`,
        body: vote
          ? vote.rationale
          : isEn
            ? `Monitoring 24h ${baseAsset} volume: $${Math.round((ticker?.volume24hUsd ?? 0) / 1_000_000)}M · Status ${ticker?.tradingStatus ?? 'UNKNOWN'}.`
            : `Giám sát thanh khoản 24h ${baseAsset}: $${Math.round((ticker?.volume24hUsd ?? 0) / 1_000_000)}M · Trạng thái ${ticker?.tradingStatus ?? 'UNKNOWN'}.`,
        metricLabel: 'FUND SCORE',
        metricValue: signal ? `${signal.fundamentalScore}/100` : `$${Math.round((ticker?.volume24hUsd ?? 0) / 1_000_000)}M VOL`,
        gaugePct: signal?.fundamentalScore ?? Math.min(100, Math.round(liqScore)),
        statusTag: ticker?.tradingStatus ?? 'READY',
        accentCss: baseCss,
      };
    case 'ON_CHAIN_INTELLIGENCE':
      return {
        headline: `${isEn ? 'PERP DERIVATIVES & OI' : 'PHÁI SINH & OPEN INTEREST'} · ${baseAsset}`,
        body: ticker?.fundingRatePct !== null && ticker?.fundingRatePct !== undefined
          ? isEn
            ? `Live Funding Rate: ${ticker.fundingRatePct.toFixed(4)}% · Open Interest: ${ticker.openInterestUsd ? `$${Math.round(ticker.openInterestUsd / 1_000_000)}M` : '--'} (${ticker.exchange}).`
            : `Funding Rate thực tế: ${ticker.fundingRatePct.toFixed(4)}% · Open Interest: ${ticker.openInterestUsd ? `$${Math.round(ticker.openInterestUsd / 1_000_000)}M` : '--'} (${ticker.exchange}).`
          : isEn
            ? `Spot Market (${ticker?.exchange ?? '--'}): No perpetual leverage or funding rate overhead.`
            : `Thị trường Spot (${ticker?.exchange ?? '--'}): Không có đòn bẩy Perpetual / Funding Rate.`,
        metricLabel: 'FUNDING',
        metricValue: ticker?.fundingRatePct !== null && ticker?.fundingRatePct !== undefined
          ? `${ticker.fundingRatePct.toFixed(4)}%`
          : 'SPOT (N/A)',
        gaugePct: ticker?.openInterestUsd ? Math.min(100, Math.round(liqScore)) : 40,
        statusTag: ticker?.marketType ?? 'ONLINE',
        accentCss: baseCss,
      };
    case 'NEWS_SENTIMENT':
      return {
        headline: `${isEn ? 'MOMENTUM & FUNDING SENTIMENT' : 'ĐỘNG LƯỢNG & FUNDING SENTIMENT'} · ${sym}`,
        body: vote
          ? vote.rationale
          : isEn
            ? `Tracking 24h momentum (${chgStr}), RSI (${rsiStr}) & funding skew to detect crowded positioning.`
            : `Theo dõi biến động 24h (${chgStr}), RSI (${rsiStr}) và Funding Rate thực tế để phát hiện FOMO.`,
        metricLabel: 'SENTIMENT',
        metricValue: signal ? `${signal.sentimentScore}/100` : `${chgStr} 24H`,
        gaugePct: signal?.sentimentScore ?? 0,
        statusTag: vote?.stance ?? 'READY',
        accentCss: baseCss,
      };
    case 'STRATEGY_GENERATION':
      return {
        headline: `${isEn ? 'EXECUTION BLUEPRINT' : 'THIẾT KẾ KẾ HOẠCH LỆNH'} · ${sym}`,
        body: signal
          ? `${signal.strategyName}: ${signal.direction} Entry ${signal.entryRange[0].toFixed(2)} · SL ${signal.stopLoss.toFixed(2)} · TP ${signal.takeProfitLevels[1]?.toFixed(2) ?? '--'}.`
          : agent.currentTask,
        metricLabel: 'STRATEGY',
        metricValue: signal ? `${signal.direction} · ${signal.leverage}x` : 'STANDBY',
        gaugePct: signal ? signal.confidenceScore : 0,
        statusTag: signal?.state ?? 'READY',
        accentCss: baseCss,
      };
    case 'STRATEGY_VALIDATION':
      return {
        headline: isEn ? 'R:R & OVERFIT VALIDATION' : 'KIỂM CHỨNG R:R & CHỐNG OVERFIT',
        body: signal
          ? `${isEn ? 'R:R Ratio' : 'Tỷ lệ R:R'} ${signal.riskReward}x · Tier: ${signal.precisionTier ?? 'MODERATE'}. ${signal.calibratedProbabilityNote}`
          : agent.currentTask,
        metricLabel: 'RISK/REWARD',
        metricValue: signal ? `${signal.riskReward}x` : 'MIN 1.5x',
        gaugePct: signal ? Math.min(100, Math.round(signal.riskReward * 32)) : 0,
        statusTag: signal?.state === 'APPROVED' ? 'PASS' : 'STANDBY',
        accentCss: baseCss,
      };
    case 'RISK_MANAGEMENT':
      return {
        headline: `${isEn ? 'INDEPENDENT RISK GATE' : 'CỔNG KIỂM SOÁT RỦI RO ĐỘC LẬP'} (${tradingMode})`,
        body: signal
          ? isEn
            ? `Verdict: ${signal.riskCheck.decision} · Risk ${signal.riskCheck.estimatedRiskPct}% ($${signal.riskCheck.estimatedRiskUsd.toFixed(2)}). Martingale: BLOCKED.`
            : `Quyết định: ${signal.riskCheck.decision} · Rủi ro ${signal.riskCheck.estimatedRiskPct}% ($${signal.riskCheck.estimatedRiskUsd.toFixed(2)}). Martingale: CẤM.`
          : isEn
            ? `Current Drawdown: ${portfolio.currentDrawdownPct.toFixed(2)}% · Open Positions: ${openPositionsCount} · Mandatory SL enforced.`
            : `Drawdown hiện tại: ${portfolio.currentDrawdownPct.toFixed(2)}% · Vị thế mở: ${openPositionsCount} · Stop Loss bắt buộc.`,
        metricLabel: 'RISK VETO',
        metricValue: signal ? signal.riskCheck.decision : `DD ${portfolio.currentDrawdownPct.toFixed(1)}%`,
        gaugePct: Math.max(10, 100 - Math.round(portfolio.currentDrawdownPct * 8)),
        statusTag: tradingMode === 'EMERGENCY_STOP' ? 'LOCKED' : 'ENFORCING',
        accentCss: tradingMode === 'EMERGENCY_STOP' ? '#EF4444' : baseCss,
      };
    case 'EXECUTION_AGENT':
      return {
        headline: `${isEn ? 'ORDER ROUTING GATE' : 'CỔNG THỰC THI LỆNH'} · ${tradingMode}`,
        body: isEn
          ? `Ready to route ${sym} within exchange tick/lot constraints. Idempotency duplicate-order lock active.`
          : `Sẵn sàng định tuyến lệnh ${sym} chuẩn tick/lot size sàn. Đã khóa cơ chế chống gửi trùng Idempotency Key.`,
        metricLabel: 'CLOSED TRADES',
        metricValue: `${portfolio.totalClosedTrades} ${isEn ? 'TRADES' : 'LỆNH'}`,
        gaugePct: tradingMode === 'EMERGENCY_STOP' ? 0 : 95,
        statusTag: tradingMode,
        accentCss: baseCss,
      };
    case 'PORTFOLIO_MANAGEMENT':
      return {
        headline: isEn ? 'PORTFOLIO & MARGIN CONTROL' : 'QUẢN TRỊ DANH MỤC & KÝ QUỸ',
        body: isEn
          ? `Total Equity: $${portfolio.totalEquityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} · Free: $${portfolio.availableBalanceUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} · Margin: $${portfolio.usedMarginUsd.toFixed(0)}.`
          : `Tổng tài sản: $${portfolio.totalEquityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} · Khả dụng: $${portfolio.availableBalanceUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} · Margin: $${portfolio.usedMarginUsd.toFixed(0)}.`,
        metricLabel: 'DAILY PNL',
        metricValue: `${portfolio.dailyPnlPct >= 0 ? '+' : ''}${portfolio.dailyPnlPct.toFixed(2)}%`,
        gaugePct: Math.min(100, Math.max(15, 100 - portfolio.currentDrawdownPct * 5)),
        statusTag: 'ONLINE',
        accentCss: baseCss,
      };
    case 'POSITION_MONITORING':
      return {
        headline: isEn ? '24/7 POSITION SURVEILLANCE' : 'GIÁM SÁT VỊ THẾ MỞ 24/7',
        body: isEn
          ? `Monitoring ${openPositionsCount} live position(s) · Unrealized PnL: ${portfolio.unrealizedPnlUsd >= 0 ? '+' : ''}$${portfolio.unrealizedPnlUsd.toFixed(2)}. Tracking liquidation margin.`
          : `Đang theo dõi ${openPositionsCount} vị thế đang chạy · Unrealized PnL: ${portfolio.unrealizedPnlUsd >= 0 ? '+' : ''}$${portfolio.unrealizedPnlUsd.toFixed(2)}. Kiểm tra khoảng cách thanh lý.`,
        metricLabel: 'OPEN POS',
        metricValue: `${openPositionsCount} ACTIVE`,
        gaugePct: 92,
        statusTag: openPositionsCount > 0 ? 'WATCHING' : 'CLEAR',
        accentCss: baseCss,
      };
    case 'EXIT_STRATEGY':
      return {
        headline: isEn ? 'EXIT ENGINE & CAPITAL GUARD' : 'CHIẾN LƯỢC THOÁT LỆNH & BẢO VỆ VỐN',
        body: isEn
          ? `Peak Equity: $${portfolio.peakEquityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} · Drawdown ${portfolio.currentDrawdownPct.toFixed(2)}%. Trailing Stop & Partial TP armed.`
          : `Đỉnh vốn (Peak): $${portfolio.peakEquityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} · Drawdown ${portfolio.currentDrawdownPct.toFixed(2)}%. Sẵn sàng kích hoạt Trailing Stop & Partial TP.`,
        metricLabel: 'MAX DD',
        metricValue: `${portfolio.currentDrawdownPct.toFixed(2)}%`,
        gaugePct: Math.max(20, 100 - portfolio.currentDrawdownPct * 6),
        statusTag: 'GUARDING',
        accentCss: baseCss,
      };
    case 'AI_PERFORMANCE':
      return {
        headline: isEn ? 'LIVE PERFORMANCE AUDITOR' : 'KIỂM TOÁN HIỆU SUẤT THỰC TẾ',
        body:
          portfolio.winRatePct !== null
            ? `Win Rate: ${portfolio.winRatePct.toFixed(1)}% (${portfolio.winCount}W/${portfolio.lossCount}L) · Realized PnL: $${portfolio.realizedPnlUsd.toFixed(2)}.`
            : isEn
              ? 'Zero closed trades yet (synthetic stats strictly disabled). Tracking verified Realized PnL & Profit Factor.'
              : 'Chưa có lệnh đóng để tính Win Rate (không hiển thị số liệu ảo). Theo dõi Realized PnL & Profit Factor.',
        metricLabel: 'WIN RATE',
        metricValue: portfolio.winRatePct !== null ? `${portfolio.winRatePct.toFixed(1)}%` : 'NO TRADES',
        gaugePct: portfolio.winRatePct ?? 50,
        statusTag: 'HONEST AUDIT',
        accentCss: baseCss,
      };
    case 'CYBERSECURITY':
      return {
        headline: isEn ? 'SECURITY GUARD & API VAULT' : 'BẢO MẬT HỆ THỐNG & API VAULT',
        body: isEn
          ? 'AES-256-GCM encrypted API Vault · Withdrawal Permission: STRICTLY BLOCKED · Immutable Audit Trail active.'
          : 'Mã hóa AES-256-GCM khóa API · Quyền rút tiền: CHẶN TUYỆT ĐỐI · Mọi thao tác đều ghi nhật ký Audit Log bất biến.',
        metricLabel: 'WITHDRAWAL',
        metricValue: 'BLOCKED',
        gaugePct: 100,
        statusTag: 'SECURED',
        accentCss: baseCss,
      };
    default:
      return {
        headline: agent.name,
        body: agent.currentTask,
        metricLabel: 'LATENCY',
        metricValue: `${agent.latencyMs} ms`,
        gaugePct: agent.healthPct,
        statusTag: agent.status,
        accentCss: baseCss,
      };
  }
}

export function computeRobotScreenSignature(
  agent: AgentState,
  ctxData: RobotScreenContext,
): string {
  const view = buildRobotLiveWorkView(agent, ctxData);
  return [
    ctxData.locale ?? 'vi',
    agent.id,
    agent.status,
    agent.enabled ? '1' : '0',
    agent.latencyMs,
    view.headline,
    view.body,
    view.metricValue,
    view.statusTag,
    view.accentCss,
  ].join('|');
}

export function drawRobotWorkstationCanvas(
  ctx: CanvasRenderingContext2D,
  tex: THREE.CanvasTexture,
  agent: AgentState,
  ctxData: RobotScreenContext,
): void {
  const W = 512;
  const H = 256;
  const view = buildRobotLiveWorkView(agent, ctxData);
  const tag = ROLE_SHORT_TAGS[agent.id] ?? agent.category;

  // 1. Deep Obsidian Glass Background + Subtle Grid
  ctx.fillStyle = '#060D1A';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#0F1C30';
  ctx.lineWidth = 1;
  for (let gx = 32; gx < W; gx += 32) {
    ctx.beginPath();
    ctx.moveTo(gx, 44);
    ctx.lineTo(gx, H - 34);
    ctx.stroke();
  }
  for (let gy = 64; gy < H - 34; gy += 32) {
    ctx.beginPath();
    ctx.moveTo(12, gy);
    ctx.lineTo(W - 12, gy);
    ctx.stroke();
  }

  // Outer glowing border
  ctx.strokeStyle = view.accentCss;
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  // 2. Top Header Strip (y = 6..44)
  ctx.fillStyle = '#0B1526';
  ctx.fillRect(6, 6, W - 12, 38);

  // Role tag pill
  ctx.fillStyle = view.accentCss;
  ctx.fillRect(14, 13, 98, 24);
  ctx.fillStyle = '#040914';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(tag, 63, 30);

  // Agent title
  ctx.textAlign = 'left';
  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 15px sans-serif';
  const shortName = agent.name.replace(/ Agent$/i, '');
  ctx.fillText(shortName, 122, 30);

  // Status badge on right
  ctx.textAlign = 'right';
  ctx.fillStyle = view.accentCss;
  ctx.font = 'bold 13px monospace';
  ctx.fillText(`${view.statusTag} · ${agent.latencyMs}ms`, W - 16, 30);
  ctx.textAlign = 'left';

  // 3. Active Task Headline (y = 50..78)
  ctx.fillStyle = view.accentCss;
  ctx.font = 'bold 14px monospace';
  const headlineLines = wrapCanvasText(ctx, view.headline, W - 32, 1);
  ctx.fillText(headlineLines[0] ?? view.headline, 16, 68);

  // 4. Left Main Task Description Card (x = 14..332, y = 82..210)
  ctx.fillStyle = '#0A1322';
  ctx.fillRect(14, 82, 318, 128);
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(14, 82, 318, 128);

  ctx.fillStyle = '#E2E8F0';
  ctx.font = '16px sans-serif';
  const bodyLines = wrapCanvasText(ctx, view.body, 294, 4);
  bodyLines.forEach((line, i) => {
    ctx.fillText(line, 26, 108 + i * 26);
  });

  // 5. Right Telemetry Gauge & Sparkline Card (x = 342..498, y = 82..210)
  ctx.fillStyle = '#0A1322';
  ctx.fillRect(342, 82, 156, 128);
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(342, 82, 156, 128);

  ctx.fillStyle = '#94A3B8';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(view.metricLabel.slice(0, 18), 352, 102);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 13px monospace';
  const metricLines = wrapCanvasText(ctx, view.metricValue, 132, 2);
  metricLines.forEach((ln, idx) => {
    ctx.fillText(ln, 352, 124 + idx * 17);
  });

  // Activity bars driven by actual measured gaugePct
  const barSeed = agent.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const barCount = 10;
  for (let b = 0; b < barCount; b++) {
    const activeFactor = Math.max(0.12, view.gaugePct / 100);
    const ratio = activeFactor * (0.45 + 0.55 * (((barSeed + b * 5) % 11) / 10));
    const bh = Math.max(4, Math.round(ratio * 32));
    const bx = 352 + b * 13;
    const by = 198 - bh;
    ctx.fillStyle = view.gaugePct > 0 && b < Math.ceil((view.gaugePct / 100) * barCount) ? view.accentCss : '#1E3A5F';
    ctx.fillRect(bx, by, 9, bh);
  }

  // 6. Footer Bar (y = 216..244)
  ctx.fillStyle = '#0B1526';
  ctx.fillRect(6, 218, W - 12, 30);

  // Health / activity progress bar
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(16, 228, 120, 10);
  ctx.fillStyle = view.accentCss;
  ctx.fillRect(16, 228, Math.round((Math.min(100, Math.max(0, view.gaugePct)) / 100) * 120), 10);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '12px monospace';
  ctx.fillText(`SRC: ${agent.dataSource}`, 148, 237);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748B';
  ctx.fillText(`EVALS ${agent.evalCount ?? 0} · v${agent.version}`, W - 16, 237);
  ctx.textAlign = 'left';

  tex.needsUpdate = true;
}
