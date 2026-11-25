import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Box,
  Cpu,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Menu,
  OctagonAlert,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useI18n } from './i18n/I18nContext';
import { DEFAULT_RISK_CONFIG } from './engine/riskEngine';
import type {
  AgentLogEntry,
  AgentState,
  AuditLogEntry,
  AutoExecutionConfig,
  AutoExecutionEngineStatus,
  ExchangeInfo,
  MarketTicker,
  MarketType,
  OrderBookSnapshot,
  OrderRecord,
  PnlHistoryPoint,
  PortfolioCorrelationGuard,
  PortfolioSummary,
  Position,
  RiskConfig,
  SmartOpportunityCandidate,
  TradingMode,
  TradingSignal,
} from './engine/types';
import { appendPnlPoint } from './engine/pnlHistory';
import {
  dedupeTickersByPair,
  findMatchingSignal,
  findMatchingTicker,
  parsePairSelection,
  serializePairSelection,
} from './engine/pairSelection';
import { AgentControlCenter } from './components/AgentControlCenter';
import { CoinSearchModal } from './components/CoinSearchModal';
import { CommandCenter } from './components/CommandCenter';
import { ExchangeSecurityHub } from './components/ExchangeSecurityHub';
import { MarketScanner } from './components/MarketScanner';
import {
  OfflineIndicator,
  PWAInstallControl,
  PWAInstallModal,
  PWASmartBanner,
} from './components/PWAControls';
import { PortfolioRisk } from './components/PortfolioRisk';
import { QuantLab } from './components/QuantLab';
import {
  SmartRunControl,
  type SmartRunMode,
  type SmartRunSummary,
} from './components/SmartRunControl';
import { Workspace3D } from './components/Workspace3D';

type NavTab =
  | 'command'
  | 'workspace3d'
  | 'scanner'
  | 'agents'
  | 'quant'
  | 'portfolio'
  | 'exchanges';

const NAV_ITEM_DEFS: Array<{
  id: NavTab;
  labelKey: 'app.nav.command' | 'app.nav.space3d' | 'app.nav.scanner' | 'app.nav.agents' | 'app.nav.quant' | 'app.nav.portfolio' | 'app.nav.exchanges';
  shortKey?: 'app.nav.commandShort' | 'app.nav.space3dShort' | 'app.nav.scannerShort' | 'app.nav.agentsShort';
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'command', labelKey: 'app.nav.command', shortKey: 'app.nav.commandShort', icon: LayoutDashboard },
  { id: 'workspace3d', labelKey: 'app.nav.space3d', shortKey: 'app.nav.space3dShort', icon: Box },
  { id: 'scanner', labelKey: 'app.nav.scanner', shortKey: 'app.nav.scannerShort', icon: Search },
  { id: 'agents', labelKey: 'app.nav.agents', shortKey: 'app.nav.agentsShort', icon: Cpu },
  { id: 'quant', labelKey: 'app.nav.quant', icon: FlaskConical },
  { id: 'portfolio', labelKey: 'app.nav.portfolio', icon: Wallet },
  { id: 'exchanges', labelKey: 'app.nav.exchanges', icon: ShieldCheck },
];

const INITIAL_PORTFOLIO: PortfolioSummary = {
  mode: 'FULL_AUTO',
  initialEquityUsd: 100_000,
  totalEquityUsd: 100_000,
  availableBalanceUsd: 100_000,
  usedMarginUsd: 0,
  realizedPnlUsd: 0,
  unrealizedPnlUsd: 0,
  totalFeesUsd: 0,
  dailyPnlPct: 0,
  weeklyPnlPct: 0,
  peakEquityUsd: 100_000,
  currentDrawdownPct: 0,
  winCount: 0,
  lossCount: 0,
  totalClosedTrades: 0,
  winRatePct: null,
};

export default function App() {
  const { locale, setLocale, t } = useI18n();
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    if (typeof window === 'undefined') return 'command';
    const param = new URLSearchParams(window.location.search).get('tab');
    const valid: NavTab[] = [
      'command',
      'workspace3d',
      'scanner',
      'agents',
      'quant',
      'portfolio',
      'exchanges',
    ];
    return param && valid.includes(param as NavTab) ? (param as NavTab) : 'command';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = NAV_ITEM_DEFS.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
    shortLabel: item.shortKey ? t(item.shortKey) : t(item.labelKey),
    icon: item.icon,
  }));

  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC/USDT');
  const [selectedMarketType, setSelectedMarketType] = useState<MarketType>('PERPETUAL');
  const [selectedExchange, setSelectedExchange] = useState<string>('Binance');
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);

  const [portfolio, setPortfolio] = useState<PortfolioSummary>(INITIAL_PORTFOLIO);
  const [positions, setPositions] = useState<Position[]>([]);
  const [pnlHistory, setPnlHistory] = useState<PnlHistoryPoint[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [riskConfig, setRiskConfig] = useState<RiskConfig>(DEFAULT_RISK_CONFIG);
  const [correlationGuard, setCorrelationGuard] = useState<PortfolioCorrelationGuard | null>(null);
  const [tradingMode, setTradingMode] = useState<TradingMode>('FULL_AUTO');

  const [agents, setAgents] = useState<AgentState[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [liveFeedActive, setLiveFeedActive] = useState(false);
  const [serverUtc, setServerUtc] = useState('');
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [smartRunMode, setSmartRunMode] = useState<SmartRunMode>('ANALYZE_SINGLE');
  const [includeGeminiOnRun, setIncludeGeminiOnRun] = useState(false);
  const [runStage, setRunStage] = useState(0);
  const [lastRunSummary, setLastRunSummary] = useState<SmartRunSummary | null>(null);
  const [smartOpportunities, setSmartOpportunities] = useState<SmartOpportunityCandidate[]>([]);
  const [emergencyConfirmOpen, setEmergencyConfirmOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [autoExecutionStatus, setAutoExecutionStatus] = useState<AutoExecutionEngineStatus | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const wsSyncTimerRef = useRef<number | null>(null);

  const fetchAllState = useCallback(async () => {
    try {
      const [mktRes, portRes, agRes, sigRes, exRes, audRes, autoRes] = await Promise.all([
        fetch('/api/market/tickers'),
        fetch('/api/portfolio'),
        fetch('/api/agents'),
        fetch('/api/signals'),
        fetch('/api/exchanges'),
        fetch('/api/audit-logs'),
        fetch('/api/auto-trade/status'),
      ]);

      if (mktRes.ok) {
        const mkt = await mktRes.json();
        setTickers(mkt.tickers ?? []);
        setLiveFeedActive(Boolean(mkt.liveFeedActive));
        setServerUtc(mkt.serverUtc ?? '');
      }
      if (portRes.ok) {
        const pt = await portRes.json();
        if (pt.portfolio) {
          setPortfolio(pt.portfolio);
          setTradingMode(pt.portfolio.mode);
        }
        setPositions(pt.positions ?? []);
        if (Array.isArray(pt.pnlHistory)) setPnlHistory(pt.pnlHistory);
        setOrders(pt.orders ?? []);
        if (pt.riskConfig) setRiskConfig(pt.riskConfig);
        if (pt.correlationGuard) setCorrelationGuard(pt.correlationGuard);
      }
      if (agRes.ok) {
        const ag = await agRes.json();
        setAgents(ag.agents ?? []);
        setAgentLogs(ag.logs ?? []);
      }
      if (sigRes.ok) {
        const sig = await sigRes.json();
        setSignals(sig.signals ?? []);
      }
      if (exRes.ok) {
        const ex = await exRes.json();
        setExchanges(ex.exchanges ?? []);
      }
      if (audRes.ok) {
        const aud = await audRes.json();
        setAuditLogs(aud.logs ?? []);
      }
      if (autoRes.ok) {
        const autoData = (await autoRes.json()) as AutoExecutionEngineStatus;
        setAutoExecutionStatus(autoData);
      }
    } catch {
      // Non-fatal retry on next tick
    }
  }, []);

  // Bootstrap initial state & WebSocket telemetry stream (with clean HTTP fallback on serverless hosts)
  useEffect(() => {
    fetchAllState();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let closedByEffect = false;
    let wsConnected = false;
    let everOpened = false;
    let failedHandshakes = 0;
    let reconnectTimer: number | null = null;
    let initializedFromWs = false;
    let prevPosCount = 0;
    let prevAutoTradesCount = 0;
    let prevTradingMode: TradingMode | null = null;
    let prevEventTs = 0;
    let prevStateRevision: number | null = null;

    const scheduleFullRefresh = () => {
      if (wsSyncTimerRef.current !== null) {
        window.clearTimeout(wsSyncTimerRef.current);
      }
      wsSyncTimerRef.current = window.setTimeout(() => {
        wsSyncTimerRef.current = null;
        void fetchAllState();
      }, 220);
    };

    const pollTimer = window.setInterval(() => {
      if (!wsConnected && !closedByEffect) {
        void fetchAllState();
      }
    }, 10_000);

    const fastTickerTimer = window.setInterval(async () => {
      if (!wsConnected && !closedByEffect) {
        try {
          const res = await fetch('/api/market/tickers');
          if (res.ok) {
            const mkt = await res.json();
            if (Array.isArray(mkt.tickers)) setTickers(mkt.tickers);
            if (typeof mkt.liveFeedActive === 'boolean') setLiveFeedActive(mkt.liveFeedActive);
            if (mkt.serverUtc) setServerUtc(mkt.serverUtc);
          }
        } catch {
          // non-fatal
        }
      }
    }, 3000);

    const connect = () => {
      if (closedByEffect) return;
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          wsConnected = true;
          everOpened = true;
          failedHandshakes = 0;
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'PRICE_TICK_UPDATE') {
              if (Array.isArray(msg.tickers)) setTickers(msg.tickers);
              if (msg.portfolio) setPortfolio(msg.portfolio);
              if (Array.isArray(msg.positions)) setPositions(msg.positions);
              if (msg.pnlPoint) {
                setPnlHistory((prev) => appendPnlPoint(prev, msg.pnlPoint as PnlHistoryPoint));
              }
              if (typeof msg.liveFeedActive === 'boolean') setLiveFeedActive(msg.liveFeedActive);
              if (msg.serverUtc) setServerUtc(msg.serverUtc);

              const nextPosCount = Array.isArray(msg.positions) ? msg.positions.length : prevPosCount;
              const nextRevision =
                typeof msg.stateRevision === 'number' ? msg.stateRevision : prevStateRevision;
              const pnlPt = msg.pnlPoint as PnlHistoryPoint | null | undefined;
              const eventTag = pnlPt?.eventTag;
              const eventTs = pnlPt?.timestampMs ?? 0;
              const isTradeEvent =
                Boolean(eventTag && ['ORDER_FILLED', 'AUTO_SL_TP', 'POSITION_CLOSED', 'EMERGENCY_STOP'].includes(eventTag)) &&
                eventTs !== prevEventTs;

              if (
                nextPosCount !== prevPosCount ||
                isTradeEvent ||
                (nextRevision !== null && prevStateRevision !== null && nextRevision !== prevStateRevision)
              ) {
                prevPosCount = nextPosCount;
                prevEventTs = eventTs;
                prevStateRevision = nextRevision;
                scheduleFullRefresh();
              }
              return;
            }
            if (msg.type === 'TELEMETRY_UPDATE') {
              if (Array.isArray(msg.tickers)) setTickers(msg.tickers);
              if (msg.portfolio) setPortfolio(msg.portfolio);
              if (Array.isArray(msg.positions)) setPositions(msg.positions);
              if (msg.pnlPoint) {
                setPnlHistory((prev) => appendPnlPoint(prev, msg.pnlPoint as PnlHistoryPoint));
              }
              if (msg.tradingMode) setTradingMode(msg.tradingMode);
              if (typeof msg.liveFeedActive === 'boolean') setLiveFeedActive(msg.liveFeedActive);
              if (msg.autoExecutionStatus) {
                setAutoExecutionStatus(msg.autoExecutionStatus as AutoExecutionEngineStatus);
              }
              if (msg.serverUtc) setServerUtc(msg.serverUtc);

              const nextPosCount = Array.isArray(msg.positions) ? msg.positions.length : prevPosCount;
              const nextAutoCount =
                typeof msg.autoExecutionStatus?.autoTradesTotalCount === 'number'
                  ? msg.autoExecutionStatus.autoTradesTotalCount
                  : prevAutoTradesCount;
              const nextMode = (msg.tradingMode as TradingMode | undefined) ?? prevTradingMode;
              const pnlPt = msg.pnlPoint as PnlHistoryPoint | null | undefined;
              const eventTag = pnlPt?.eventTag;
              const eventTs = pnlPt?.timestampMs ?? 0;
              const isTradeEvent =
                Boolean(eventTag && ['ORDER_FILLED', 'AUTO_SL_TP', 'POSITION_CLOSED', 'EMERGENCY_STOP'].includes(eventTag)) &&
                eventTs !== prevEventTs;

              const nextRevision =
                typeof msg.stateRevision === 'number' ? msg.stateRevision : prevStateRevision;

              if (!initializedFromWs) {
                initializedFromWs = true;
                prevPosCount = nextPosCount;
                prevAutoTradesCount = nextAutoCount;
                prevTradingMode = nextMode;
                prevEventTs = eventTs;
                prevStateRevision = nextRevision;
              } else if (
                nextPosCount !== prevPosCount ||
                nextAutoCount !== prevAutoTradesCount ||
                (nextMode && nextMode !== prevTradingMode) ||
                isTradeEvent ||
                (nextRevision !== null && prevStateRevision !== null && nextRevision !== prevStateRevision)
              ) {
                prevPosCount = nextPosCount;
                prevAutoTradesCount = nextAutoCount;
                prevTradingMode = nextMode;
                prevEventTs = eventTs;
                prevStateRevision = nextRevision;
                scheduleFullRefresh();
              }
            }
          } catch {
            // ignore malformed frame
          }
        };
        ws.onclose = () => {
          wsConnected = false;
          if (!everOpened) {
            failedHandshakes += 1;
          }
          // Stop spamming WS reconnects if host doesn't support WS upgrades (e.g. serverless); HTTP pollTimer continues smoothly
          if (!closedByEffect && (everOpened || failedHandshakes < 2)) {
            reconnectTimer = window.setTimeout(connect, 4000);
          }
        };
      } catch {
        wsConnected = false;
      }
    };
    connect();

    return () => {
      closedByEffect = true;
      window.clearInterval(pollTimer);
      window.clearInterval(fastTickerTimer);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (wsSyncTimerRef.current !== null) {
        window.clearTimeout(wsSyncTimerRef.current);
      }
      ws?.close();
    };
  }, [fetchAllState]);

  // Fetch Order Book for exact selected (symbol, marketType, exchange)
  useEffect(() => {
    let cancelled = false;
    const loadOb = () => {
      const params = new URLSearchParams({
        symbol: selectedSymbol,
        marketType: selectedMarketType,
      });
      if (selectedExchange) params.set('exchange', selectedExchange);
      fetch(`/api/market/orderbook?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled && d.bids) setOrderBook(d);
        })
        .catch(() => {});
    };
    loadOb();
    const id = setInterval(loadOb, 3500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedSymbol, selectedMarketType, selectedExchange]);

  // Global Cmd/Ctrl + K shortcut to open Universal Coin Search Palette
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectedTicker = findMatchingTicker(tickers, {
    symbol: selectedSymbol,
    marketType: selectedMarketType,
    exchange: selectedExchange,
  });
  const selectedSignal = findMatchingSignal(signals, selectedTicker);
  const uniquePairTickers = dedupeTickersByPair(tickers);

  const handleSelectSymbol = (
    symbol: string,
    marketType: MarketType,
    exchange?: string,
  ) => {
    const matched = findMatchingTicker(tickers, { symbol, marketType, exchange });
    setSelectedSymbol(matched?.symbol ?? symbol);
    setSelectedMarketType(matched?.marketType ?? marketType);
    setSelectedExchange(matched?.exchange ?? exchange ?? '');
  };

  const handleSelectRemotePair = async (
    symbol: string,
    marketType: MarketType,
    exchange: string,
    options?: { runAi?: boolean },
  ) => {
    const res = await fetch('/api/market/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, marketType, exchange }),
    });
    if (!res.ok) {
      throw new Error('Failed to activate remote market pair');
    }
    const data = await res.json();
    if (Array.isArray(data.tickers)) {
      setTickers(data.tickers);
    }
    const chosenSym = data.ticker?.symbol ?? symbol;
    const chosenMkt = (data.ticker?.marketType ?? marketType) as MarketType;
    const chosenEx = (data.ticker?.exchange ?? exchange ?? '') as string;
    setSelectedSymbol(chosenSym);
    setSelectedMarketType(chosenMkt);
    setSelectedExchange(chosenEx);
    if (options?.runAi) {
      await handleSmartRun('ANALYZE_SINGLE', chosenSym, chosenMkt, chosenEx);
    }
  };

  const handleSmartRun = async (
    overrideMode?: SmartRunMode,
    overrideSymbol?: string,
    overrideMarket?: MarketType,
    overrideExchange?: string,
  ) => {
    const activeMode = overrideMode ?? smartRunMode;
    setPipelineLoading(true);
    setActionError(null);
    setRunStage(1);
    const t2 = window.setTimeout(() => setRunStage(2), 180);
    const t3 = window.setTimeout(() => setRunStage(3), 420);
    try {
      const res = await fetch('/api/run/smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: activeMode,
          symbol: overrideSymbol ?? selectedSymbol,
          marketType: overrideMarket ?? selectedMarketType,
          exchange: overrideExchange ?? (selectedTicker?.exchange || selectedExchange),
          includeGemini: includeGeminiOnRun,
          locale,
        }),
      });
      setRunStage(4);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.chosenSymbol && data.chosenMarketType) {
          setSelectedSymbol(data.chosenSymbol);
          setSelectedMarketType(data.chosenMarketType);
          if (data.chosenExchange) {
            setSelectedExchange(data.chosenExchange);
          }
        }
        if (Array.isArray(data.opportunities)) {
          setSmartOpportunities(data.opportunities);
        }
        if (data.signal) {
          setLastRunSummary({
            chosenSymbol: data.chosenSymbol,
            chosenExchange: data.chosenExchange ?? data.signal.exchange,
            direction: data.signal.direction,
            state: data.signal.state,
            confidenceScore: data.signal.confidenceScore,
            scanCandidatesCount: data.scanCandidatesCount ?? 1,
            autoExecuted: Boolean(data.autoExecuted),
            executionMessage: data.executionMessage ?? '',
            timestampUtc: new Date().toISOString(),
          });
        }
        await fetchAllState();
      } else {
        setActionError(data.error || t('app.error.actionFailed'));
      }
    } catch {
      setActionError(t('app.error.actionFailed'));
    } finally {
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      setPipelineLoading(false);
      window.setTimeout(() => setRunStage(0), 600);
    }
  };

  const handleRunPipeline = async (
    symbol: string,
    marketType: MarketType,
    exchange?: string,
  ) => {
    await handleSmartRun('ANALYZE_SINGLE', symbol, marketType, exchange);
  };

  const handleResetSession = async () => {
    setActionError(null);
    try {
      const res = await fetch('/api/session/reset', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLastRunSummary(null);
        setSmartOpportunities([]);
        await fetchAllState();
      } else {
        setActionError(data.error || t('app.error.actionFailed'));
      }
    } catch {
      setActionError(t('app.error.actionFailed'));
    }
  };

  const handleAgentAction = async (
    agentId: string,
    action: 'START' | 'STOP' | 'RESTART' | 'ENABLE' | 'DISABLE',
  ) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || t('app.error.actionFailed'));
        return;
      }
      await fetchAllState();
    } catch {
      setActionError(t('app.error.actionFailed'));
    }
  };

  const handleClosePosition = async (id: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/positions/${encodeURIComponent(id)}/close`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || t('app.error.actionFailed'));
        return;
      }
      await fetchAllState();
    } catch {
      setActionError(t('app.error.actionFailed'));
    }
  };

  const handleUpdatePositionSlTp = async (
    id: string,
    stopLoss: number,
    takeProfit: number,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/positions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopLoss, takeProfit }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('app.error.updateSlTpFailed') };
      }
      await fetchAllState();
      return { ok: true };
    } catch {
      return { ok: false, error: t('app.error.updateSlTpNetwork') };
    }
  };

  const handleSaveRiskConfig = async (cfg: RiskConfig): Promise<boolean> => {
    setActionError(null);
    try {
      const res = await fetch('/api/risk/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || t('app.error.actionFailed'));
        return false;
      }
      if (data.autoExecutionStatus) {
        setAutoExecutionStatus(data.autoExecutionStatus as AutoExecutionEngineStatus);
      }
      await fetchAllState();
      return true;
    } catch {
      setActionError(t('app.error.actionFailed'));
      return false;
    }
  };

  const handleChangeMode = async (mode: TradingMode) => {
    setActionError(null);
    try {
      const res = await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || t('app.error.actionFailed'));
        return;
      }
      await fetchAllState();
    } catch {
      setActionError(t('app.error.actionFailed'));
    }
  };

  const handleEmergencyStop = async () => {
    setActionError(null);
    try {
      const res = await fetch('/api/emergency-stop', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || t('app.error.actionFailed'));
        return;
      }
      setEmergencyConfirmOpen(false);
      await fetchAllState();
    } catch {
      setActionError(t('app.error.actionFailed'));
    }
  };

  const handleUpdateAutoConfig = async (
    partial: Partial<AutoExecutionConfig>,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/auto-trade/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('auto.err.updateFailed') };
      }
      setAutoExecutionStatus(data as AutoExecutionEngineStatus);
      await fetchAllState();
      return { ok: true };
    } catch {
      return { ok: false, error: t('auto.err.updateFailed') };
    }
  };

  const handleRunAutoCycle = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/auto-trade/cycle', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('auto.err.actionFailed') };
      }
      if (data.status) setAutoExecutionStatus(data.status as AutoExecutionEngineStatus);
      await fetchAllState();
      return { ok: true };
    } catch {
      return { ok: false, error: t('auto.err.actionFailed') };
    }
  };

  const handleApproveAutoProposal = async (
    id: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/auto-trade/proposals/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('auto.err.actionFailed') };
      }
      if (data.status) setAutoExecutionStatus(data.status as AutoExecutionEngineStatus);
      await fetchAllState();
      return { ok: true };
    } catch {
      return { ok: false, error: t('auto.err.actionFailed') };
    }
  };

  const handleRejectAutoProposal = async (
    id: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/auto-trade/proposals/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('auto.err.actionFailed') };
      }
      if (data.status) setAutoExecutionStatus(data.status as AutoExecutionEngineStatus);
      await fetchAllState();
      return { ok: true };
    } catch {
      return { ok: false, error: t('auto.err.actionFailed') };
    }
  };

  return (
    <div className="min-h-screen bg-[#070B12] text-slate-100">
      {/* Top Bar Contract: [Brand] — [5 single-line nav links] — [1 Primary CTA] */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#070B12]/95 pt-safe">
        <div className="mx-auto flex h-12 max-w-[1440px] items-center justify-between gap-8 px-4 sm:h-14 sm:px-6">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('command')}
            className="font-display text-base font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 sm:text-lg"
          >
            OMNISENT AI
          </button>

          {/* Zone 2: 5 Concise single-line nav links (Desktop) */}
          <nav
            aria-label={t('app.nav.mainAria')}
            className="hidden items-center gap-6 text-sm font-medium text-slate-400 lg:flex"
          >
            {navItems.slice(0, 5).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-100 ${
                  activeTab === item.id
                    ? 'text-cyan-400 underline decoration-cyan-400/70 underline-offset-8'
                    : ''
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Smart Run Command Control & Emergency Stop */}
          <div className="flex items-center gap-2 shrink-0">
            <SmartRunControl
              tickers={tickers}
              selectedTicker={selectedTicker}
              selectedSymbol={selectedSymbol}
              selectedMarketType={selectedMarketType}
              selectedExchange={selectedExchange}
              tradingMode={tradingMode}
              runMode={smartRunMode}
              includeGemini={includeGeminiOnRun}
              running={pipelineLoading}
              runStage={runStage}
              lastSummary={lastRunSummary}
              onChangeRunMode={setSmartRunMode}
              onChangeTargetSymbol={handleSelectSymbol}
              onOpenGlobalSearch={() => setSearchModalOpen(true)}
              onToggleGemini={setIncludeGeminiOnRun}
              onExecuteRun={(mode) => handleSmartRun(mode)}
              onResetSession={handleResetSession}
            />
            <button
              type="button"
              onClick={() => setEmergencyConfirmOpen(true)}
              aria-label={
                tradingMode === 'EMERGENCY_STOP'
                  ? t('app.emergency.ariaStopped')
                  : t('app.emergencyStop')
              }
              className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                tradingMode === 'EMERGENCY_STOP'
                  ? 'bg-rose-600 text-white'
                  : 'border border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
              }`}
            >
              <OctagonAlert className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {tradingMode === 'EMERGENCY_STOP'
                  ? t('app.emergency.stoppedLabel')
                  : t('app.emergencyStop')}
              </span>
              <span className="sm:hidden">
                {tradingMode === 'EMERGENCY_STOP'
                  ? t('app.emergency.stoppedLabel')
                  : t('app.emergency.stopShort')}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout: Desktop Left Sidebar + Content Viewport */}
      <div className="mx-auto flex max-w-[1440px] gap-6 px-4 pt-5 pb-24 sm:px-6 lg:pb-10">
        {/* Desktop Sidebar */}
        <aside
          aria-label={t('app.nav.sidebarAria')}
          className="hidden w-52 shrink-0 flex-col gap-1 lg:flex"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex min-h-[42px] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100 border border-transparent'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}

          {/* Compact System Summary & Language Selector in Sidebar */}
          <div className="mt-4 rounded-xl border border-slate-800/80 bg-[#0E1522] p-3 text-xs">
            <p className="text-slate-400">{t('app.sidebar.modeCurrent')}</p>
            <p className="mt-1 font-mono font-semibold text-cyan-400">{tradingMode}</p>
            <p className="mt-2 text-slate-400">{t('app.sidebar.marketFeed')}</p>
            <p className={`mt-0.5 font-mono text-[11px] ${liveFeedActive ? 'text-emerald-400' : 'text-amber-400'}`}>
              {liveFeedActive ? t('app.sidebar.feedLive') : t('app.sidebar.feedOffline')}
            </p>

            <div className="mt-3 border-t border-slate-800/80 pt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                <Globe className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span>{t('app.sidebar.languageLabel')}</span>
              </div>
              <div
                role="group"
                aria-label={t('app.sidebar.languageLabel')}
                data-testid="lang-switcher"
                className="grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-[#070B12] p-0.5"
              >
                <button
                  type="button"
                  onClick={() => setLocale('vi')}
                  aria-pressed={locale === 'vi'}
                  data-testid="lang-btn-vi"
                  className={`min-h-[30px] rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    locale === 'vi'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  VI · Tiếng Việt
                </button>
                <button
                  type="button"
                  onClick={() => setLocale('en')}
                  aria-pressed={locale === 'en'}
                  data-testid="lang-btn-en"
                  className={`min-h-[30px] rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    locale === 'en'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  EN · English
                </button>
              </div>
            </div>
          </div>

          <PWAInstallControl variant="sidebar" />
        </aside>

        {/* Active Main Content */}
        <main className="min-w-0 flex-1">
          <PWASmartBanner />
          {actionError && (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200"
            >
              <div className="flex items-center gap-2 min-w-0">
                <OctagonAlert className="h-4 w-4 shrink-0 text-rose-400" />
                <span className="break-words">{actionError}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionError(null)}
                aria-label={t('app.error.dismiss')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-rose-300 hover:bg-rose-500/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {activeTab === 'command' && (
            <CommandCenter
              tickers={tickers}
              selectedTicker={selectedTicker}
              selectedSignal={selectedSignal}
              orderBook={orderBook}
              portfolio={portfolio}
              positions={positions}
              agents={agents}
              signals={signals}
              tradingMode={tradingMode}
              liveFeedActive={liveFeedActive}
              serverUtc={serverUtc}
              onSelectSymbol={handleSelectSymbol}
              onNavigate={(tab) => setActiveTab(tab as NavTab)}
              onRunPipeline={handleRunPipeline}
              onSmartScan={() => handleSmartRun('SMART_SCAN_BEST')}
              smartOpportunities={smartOpportunities}
              onOpenGlobalSearch={() => setSearchModalOpen(true)}
              onClosePosition={handleClosePosition}
              onUpdateSlTp={handleUpdatePositionSlTp}
              pipelineLoading={pipelineLoading}
              autoExecutionStatus={autoExecutionStatus}
              onUpdateAutoConfig={handleUpdateAutoConfig}
              onRunAutoCycle={handleRunAutoCycle}
              onApproveAutoProposal={handleApproveAutoProposal}
              onRejectAutoProposal={handleRejectAutoProposal}
            />
          )}

          {activeTab === 'workspace3d' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h1 className="font-display text-lg font-semibold text-slate-50 sm:text-xl">
                    {t('app.room3d.title')}
                  </h1>
                  <p className="text-xs text-slate-400">
                    {t('app.room3d.subtitle')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSearchModalOpen(true)}
                    aria-label={t('app.room3d.searchAria')}
                    className="flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1522] px-3 text-xs font-medium text-cyan-300 hover:border-cyan-500/50 whitespace-nowrap"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>{t('app.room3d.searchBtn')}</span>
                  </button>
                  <select
                    value={
                      selectedTicker
                        ? serializePairSelection(selectedTicker)
                        : serializePairSelection({
                            symbol: selectedSymbol,
                            marketType: selectedMarketType,
                            exchange: selectedExchange,
                          })
                    }
                    onChange={(e) => {
                      const parsed = parsePairSelection(e.target.value);
                      if (parsed) handleSelectSymbol(parsed.symbol, parsed.marketType, parsed.exchange);
                    }}
                    aria-label={t('app.room3d.selectAria')}
                    className="min-h-[42px] rounded-lg border border-slate-800 bg-[#0E1522] px-3 text-xs text-slate-100"
                  >
                    {uniquePairTickers.map((tk) => {
                      const val = serializePairSelection(tk);
                      return (
                        <option key={val} value={val}>
                          {tk.symbol} · {tk.marketType} · {tk.exchange}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
              <Workspace3D
                agents={agents}
                selectedTicker={selectedTicker}
                orderBook={orderBook}
                portfolio={portfolio}
                tradingMode={tradingMode}
                latestSignal={selectedSignal}
                openPositionsCount={positions.length}
                debateRunning={pipelineLoading}
                onRunDebate={() =>
                  selectedTicker &&
                  handleRunPipeline(
                    selectedTicker.symbol,
                    selectedTicker.marketType,
                    selectedTicker.exchange,
                  )
                }
              />
            </div>
          )}

          {activeTab === 'scanner' && (
            <MarketScanner
              tickers={tickers}
              selectedTicker={selectedTicker}
              orderBook={orderBook}
              positions={positions}
              riskConfig={riskConfig}
              tradingMode={tradingMode}
              latestSignal={selectedSignal}
              onSelectSymbol={handleSelectSymbol}
              onSelectRemotePair={handleSelectRemotePair}
              onOpenGlobalSearch={() => setSearchModalOpen(true)}
              onRunPipeline={handleRunPipeline}
              pipelineLoading={pipelineLoading}
              onOrderPlaced={fetchAllState}
              onClosePosition={handleClosePosition}
              onUpdateSlTp={handleUpdatePositionSlTp}
            />
          )}

          {activeTab === 'agents' && (
            <AgentControlCenter
              agents={agents}
              agentLogs={agentLogs}
              tickers={tickers}
              selectedTicker={selectedTicker}
              selectedSignal={selectedSignal}
              signals={signals}
              onSelectSymbol={handleSelectSymbol}
              onAgentAction={handleAgentAction}
              onRunPipeline={handleRunPipeline}
              onOpenGlobalSearch={() => setSearchModalOpen(true)}
              onRefreshState={fetchAllState}
              pipelineLoading={pipelineLoading}
            />
          )}

          {activeTab === 'quant' && (
            <QuantLab
              tickers={tickers}
              selectedTicker={selectedTicker}
              onSelectSymbol={handleSelectSymbol}
              onSelectRemotePair={handleSelectRemotePair}
              onOpenGlobalSearch={() => setSearchModalOpen(true)}
            />
          )}

          {activeTab === 'portfolio' && (
            <PortfolioRisk
              portfolio={portfolio}
              positions={positions}
              pnlHistory={pnlHistory}
              orders={orders}
              riskConfig={riskConfig}
              correlationGuard={correlationGuard}
              tradingMode={tradingMode}
              onClosePosition={handleClosePosition}
              onUpdateSlTp={handleUpdatePositionSlTp}
              onInspectSymbol={(sym, mkt, ex) => {
                handleSelectSymbol(sym, mkt, ex);
                setActiveTab('scanner');
              }}
              onSaveRiskConfig={handleSaveRiskConfig}
              onChangeMode={handleChangeMode}
              onEmergencyStop={handleEmergencyStop}
              autoExecutionStatus={autoExecutionStatus}
              onUpdateAutoConfig={handleUpdateAutoConfig}
              onRunAutoCycle={handleRunAutoCycle}
              onApproveAutoProposal={handleApproveAutoProposal}
              onRejectAutoProposal={handleRejectAutoProposal}
            />
          )}

          {activeTab === 'exchanges' && (
            <ExchangeSecurityHub
              exchanges={exchanges}
              auditLogs={auditLogs}
              liveFeedActive={liveFeedActive}
              onRefreshExchanges={fetchAllState}
            />
          )}
        </main>
      </div>

      {/* Smartphone Thumb-Zone Bottom Tab Bar (56px height, total sticky <= 13% viewport height) */}
      <nav
        aria-label={t('app.nav.mobileAria')}
        className="fixed right-0 bottom-0 left-0 z-30 border-t border-slate-800 bg-[#070B12]/95 pb-safe lg:hidden"
      >
        <div className="grid h-14 grid-cols-5 items-center">
          {navItems.slice(0, 4).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                  active ? 'text-cyan-400' : 'text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.shortLabel}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-expanded={mobileMenuOpen}
            className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              ['quant', 'portfolio', 'exchanges'].includes(activeTab) || mobileMenuOpen
                ? 'text-cyan-400'
                : 'text-slate-400'
            }`}
          >
            <Menu className="h-5 w-5" />
            <span>{t('app.nav.moreShort')}</span>
          </button>
        </div>
      </nav>

      {/* Mobile Bottom Sheet Drawer for Quant Lab, Portfolio & Risk, Exchanges & Vault + Language */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/60 lg:hidden">
          <div className="w-full rounded-t-3xl border-t border-slate-800 bg-[#0E1522] p-5 pb-8">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-base font-semibold text-slate-100">
                {t('app.drawer.title')}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label={t('app.drawer.closeAria')}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2">
              {navItems.slice(4).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-slate-800 bg-[#070B12] px-4 text-sm font-medium text-slate-100"
                  >
                    <Icon className="h-4 w-4 text-cyan-400" />
                    <span>{item.label}</span>
                  </button>
                );
              })}

              <div className="mt-3 rounded-xl border border-slate-800 bg-[#070B12] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
                  <Globe className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t('app.sidebar.languageLabel')}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLocale('vi')}
                    aria-pressed={locale === 'vi'}
                    data-testid="mobile-lang-btn-vi"
                    className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                      locale === 'vi'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    VI · Tiếng Việt
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocale('en')}
                    aria-pressed={locale === 'en'}
                    data-testid="mobile-lang-btn-en"
                    className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                      locale === 'en'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    EN · English
                  </button>
                </div>
              </div>

              <PWAInstallControl
                variant="drawer"
                onActionStart={() => setMobileMenuOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Emergency Stop Confirmation Dialog */}
      {emergencyConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="em-stop-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-[#0E1522] p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400">
              <OctagonAlert className="h-5 w-5" />
              <h2 id="em-stop-title" className="font-display text-base font-semibold">
                {t('app.emergency.dialogTitle')}
              </h2>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {t('app.emergency.dialogDesc')}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setEmergencyConfirmOpen(false)}
                className="min-h-[44px] rounded-lg border border-slate-700 px-4 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                {t('app.emergency.cancelBtn')}
              </button>
              {tradingMode === 'EMERGENCY_STOP' ? (
                <button
                  type="button"
                  onClick={() => {
                    handleChangeMode('PAPER');
                    setEmergencyConfirmOpen(false);
                  }}
                  className="min-h-[44px] rounded-lg bg-cyan-600 px-4 text-xs font-semibold text-white hover:bg-cyan-500"
                >
                  {t('app.emergency.restorePaperBtn')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleEmergencyStop}
                  className="min-h-[44px] rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  {t('app.emergency.activateBtn')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Global Command-K Coin Search Modal */}
      <CoinSearchModal
        open={searchModalOpen}
        selectedSymbol={selectedTicker?.symbol ?? selectedSymbol}
        selectedMarketType={selectedTicker?.marketType ?? selectedMarketType}
        selectedExchange={selectedTicker?.exchange ?? selectedExchange}
        onClose={() => setSearchModalOpen(false)}
        onSelectPair={handleSelectRemotePair}
      />
      <PWAInstallModal />
      <OfflineIndicator />
    </div>
  );
}
