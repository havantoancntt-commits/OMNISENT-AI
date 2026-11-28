import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Box,
  Cpu,
  FlaskConical,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  OctagonAlert,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useI18n } from './i18n/I18nContext';
import {
  apiFetch,
  buildAuthenticatedWsUrl,
  clearAuthSession,
  setAuthSession,
  subscribeAuthRequired,
  subscribeAuthSession,
  type AuthSessionState,
} from './lib/apiClient';
import { DEFAULT_RISK_CONFIG } from './engine/riskEngine';
import type {
  AgentLogEntry,
  AgentState,
  AuditLogEntry,
  AutoExecutionConfig,
  AutoExecutionEngineStatus,
  ClosePositionResponse,
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
import { usePWA } from './pwa/PWAContext';
import {
  PWA_DATA_SNAPSHOT_STORAGE_KEY,
  parseTelemetrySnapshot,
  serializeTelemetrySnapshot,
} from './pwa/pwaHelpers';
import {
  applyDirectExchangeWsTick,
  buildOkxSubscriptionArgs,
  hasAnyLiveTickerPrice,
  mergeTickerFeedSnapshots,
  parseOkxPublicTickerFrame,
  pickBestBenchmarkTicker,
  repricePortfolioAndPositions,
} from './pwa/directPriceSync';
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
  mode: 'PAPER',
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

  const { registerDataSyncHandler, reportDataSync, broadcastSyncEvent } = usePWA();
  const [cachedHydration] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      return parseTelemetrySnapshot(window.localStorage.getItem(PWA_DATA_SNAPSHOT_STORAGE_KEY));
    } catch {
      return null;
    }
  });

  const [tickers, setTickers] = useState<MarketTicker[]>(() =>
    cachedHydration ? (cachedHydration.tickers as MarketTicker[]) : [],
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    () => cachedHydration?.selectedPair?.symbol ?? 'BTC/USDT',
  );
  const [selectedMarketType, setSelectedMarketType] = useState<MarketType>(
    () => cachedHydration?.selectedPair?.marketType ?? 'PERPETUAL',
  );
  const [selectedExchange, setSelectedExchange] = useState<string>(
    () => cachedHydration?.selectedPair?.exchange ?? 'Binance',
  );
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);

  const [portfolio, setPortfolio] = useState<PortfolioSummary>(() =>
    cachedHydration
      ? (cachedHydration.portfolio as unknown as PortfolioSummary)
      : INITIAL_PORTFOLIO,
  );
  const [positions, setPositions] = useState<Position[]>(() =>
    cachedHydration ? (cachedHydration.positions as Position[]) : [],
  );
  const [pnlHistory, setPnlHistory] = useState<PnlHistoryPoint[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [riskConfig, setRiskConfig] = useState<RiskConfig>(DEFAULT_RISK_CONFIG);
  const [correlationGuard, setCorrelationGuard] = useState<PortfolioCorrelationGuard | null>(null);
  const [tradingMode, setTradingMode] = useState<TradingMode>(() =>
    cachedHydration?.tradingMode
      ? (cachedHydration.tradingMode as TradingMode)
      : 'PAPER',
  );

  const [agents, setAgents] = useState<AgentState[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [liveFeedActive, setLiveFeedActive] = useState(false);
  const [serverUtc, setServerUtc] = useState(() => cachedHydration?.serverUtc ?? '');
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [smartRunMode, setSmartRunMode] = useState<SmartRunMode>('ANALYZE_SINGLE');
  const [includeGeminiOnRun, setIncludeGeminiOnRun] = useState(false);
  const [runStage, setRunStage] = useState(0);
  const [lastRunSummary, setLastRunSummary] = useState<SmartRunSummary | null>(null);
  const [smartOpportunities, setSmartOpportunities] = useState<SmartOpportunityCandidate[]>([]);
  const [emergencyConfirmOpen, setEmergencyConfirmOpen] = useState(false);
  const [unlockReasonInput, setUnlockReasonInput] = useState('');
  const [unlockErrorMsg, setUnlockErrorMsg] = useState<string | null>(null);
  const [pendingUnlockMode, setPendingUnlockMode] = useState<TradingMode>('PAPER');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authSecretInput, setAuthSecretInput] = useState('');
  const [authActorInput, setAuthActorInput] = useState('SYSTEM_OPERATOR');
  const [authErrorMsg, setAuthErrorMsg] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authSession, setAuthSessionState] = useState<AuthSessionState>({
    token: null,
    actor: null,
    role: null,
    expiresAtUtc: null,
  });
  const [authStatus, setAuthStatus] = useState<{
    authEnforced: boolean;
    hasClaimedCredential: boolean;
    authenticated: boolean;
    role: string | null;
    actor: string | null;
  } | null>(null);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [autoExecutionStatus, setAutoExecutionStatus] = useState<AutoExecutionEngineStatus | null>(
    () =>
      cachedHydration?.autoExecutionStatus
        ? (cachedHydration.autoExecutionStatus as unknown as AutoExecutionEngineStatus)
        : null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const wsSyncTimerRef = useRef<number | null>(null);
  const lastSnapshotPersistMsRef = useRef<number>(0);
  const lastKnownRevisionRef = useRef<number | null>(cachedHydration?.stateRevision ?? null);
  const lastKnownEpochRef = useRef<string | null>(cachedHydration?.ledgerEpoch ?? null);
  const wsSupportedRef = useRef<boolean>(true);
  const tickersRef = useRef<MarketTicker[]>(tickers);
  const portfolioRef = useRef<PortfolioSummary>(portfolio);
  const positionsRef = useRef<Position[]>(positions);
  const selectedPairRef = useRef<{ symbol: string; marketType: MarketType; exchange: string }>({
    symbol: selectedSymbol,
    marketType: selectedMarketType,
    exchange: selectedExchange,
  });
  const autoExecutionStatusRef = useRef<AutoExecutionEngineStatus | null>(autoExecutionStatus);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    selectedPairRef.current = {
      symbol: selectedSymbol,
      marketType: selectedMarketType,
      exchange: selectedExchange,
    };
  }, [selectedSymbol, selectedMarketType, selectedExchange]);

  useEffect(() => {
    autoExecutionStatusRef.current = autoExecutionStatus;
  }, [autoExecutionStatus]);

  const persistTelemetrySnapshotThrottled = useCallback(
    (meta: {
      stateRevision?: number | null;
      ledgerEpoch?: string | null;
      tradingMode: string;
      serverUtc: string;
      tickers: MarketTicker[];
      portfolio: PortfolioSummary;
      positions: Position[];
      force?: boolean;
    }) => {
      if (typeof window === 'undefined' || !hasAnyLiveTickerPrice(meta.tickers)) return;
      const now = Date.now();
      if (!meta.force && now - lastSnapshotPersistMsRef.current < 2500) return;
      lastSnapshotPersistMsRef.current = now;
      try {
        window.localStorage.setItem(
          PWA_DATA_SNAPSHOT_STORAGE_KEY,
          serializeTelemetrySnapshot({
            nowMs: now,
            stateRevision: meta.stateRevision ?? null,
            ledgerEpoch: meta.ledgerEpoch ?? lastKnownEpochRef.current,
            tradingMode: meta.tradingMode,
            serverUtc: meta.serverUtc,
            tickers: meta.tickers,
            portfolio: meta.portfolio as unknown as Record<string, unknown>,
            positions: meta.positions,
            selectedPair: selectedPairRef.current,
            autoExecutionStatus: autoExecutionStatusRef.current
              ? (autoExecutionStatusRef.current as unknown as Record<string, unknown>)
              : null,
          }),
        );
      } catch {
        // ignore storage quota errors
      }
    },
    [],
  );

  const reconcileMarketPortfolioPositions = useCallback(
    (params: {
      incomingTickers?: MarketTicker[];
      incomingPortfolio?: PortfolioSummary;
      incomingPositions?: Position[];
      incomingRevision?: number | null;
      incomingEpoch?: string | null;
      forceAuthoritative?: boolean;
    }): {
      tickers: MarketTicker[];
      portfolio: PortfolioSummary;
      positions: Position[];
      acceptedStructuralState: boolean;
      epochChanged: boolean;
    } => {
      const mergedTickers = params.incomingTickers
        ? mergeTickerFeedSnapshots(tickersRef.current, params.incomingTickers)
        : tickersRef.current;

      if (params.incomingTickers) {
        tickersRef.current = mergedTickers;
        setTickers(mergedTickers);
      }

      const incomingRev =
        typeof params.incomingRevision === 'number' && Number.isFinite(params.incomingRevision)
          ? params.incomingRevision
          : null;
      const incomingEpoch =
        typeof params.incomingEpoch === 'string' && params.incomingEpoch.length > 0
          ? params.incomingEpoch
          : null;
      const epochChanged =
        incomingEpoch !== null &&
        lastKnownEpochRef.current !== null &&
        incomingEpoch !== lastKnownEpochRef.current;

      if (incomingEpoch !== null) {
        lastKnownEpochRef.current = incomingEpoch;
      }

      const forceAuth = Boolean(params.forceAuthoritative || epochChanged);
      const isStaleRevision =
        !forceAuth &&
        incomingRev !== null &&
        lastKnownRevisionRef.current !== null &&
        incomingRev < lastKnownRevisionRef.current;

      if (forceAuth && incomingRev !== null) {
        lastKnownRevisionRef.current = incomingRev;
      } else if (incomingRev !== null && !isStaleRevision) {
        lastKnownRevisionRef.current = incomingRev;
      }

      const basePortfolio = isStaleRevision
        ? portfolioRef.current
        : (params.incomingPortfolio ?? portfolioRef.current);
      const basePositions = isStaleRevision
        ? positionsRef.current
        : (params.incomingPositions ?? positionsRef.current);

      const repriced = repricePortfolioAndPositions(basePortfolio, basePositions, mergedTickers);
      if (repriced.portfolio !== portfolioRef.current) {
        portfolioRef.current = repriced.portfolio;
        setPortfolio(repriced.portfolio);
      }
      if (repriced.positions !== positionsRef.current) {
        positionsRef.current = repriced.positions;
        setPositions(repriced.positions);
      }

      return {
        tickers: mergedTickers,
        portfolio: repriced.portfolio,
        positions: repriced.positions,
        acceptedStructuralState: !isStaleRevision,
        epochChanged,
      };
    },
    [],
  );

  const fetchAllState = useCallback(async () => {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const noStoreInit: RequestInit = { cache: 'no-store' };
      const [mktRes, portRes, agRes, sigRes, exRes, audRes, autoRes] = await Promise.all([
        apiFetch('/api/market/tickers', noStoreInit),
        apiFetch('/api/portfolio', noStoreInit),
        apiFetch('/api/agents', noStoreInit),
        apiFetch('/api/signals', noStoreInit),
        apiFetch('/api/exchanges', noStoreInit),
        apiFetch('/api/audit-logs', noStoreInit),
        apiFetch('/api/auto-trade/status', noStoreInit),
      ]);

      let incomingTickers: MarketTicker[] | undefined;
      let latestUtc = '';
      let incomingPortfolio: PortfolioSummary | undefined;
      let incomingPositions: Position[] | undefined;
      let incomingRevision: number | null = null;
      let incomingEpoch: string | null = null;
      let latestMode: TradingMode | null = null;

      if (mktRes.ok) {
        const mkt = await mktRes.json();
        const parsedTickers: MarketTicker[] = Array.isArray(mkt.tickers) ? mkt.tickers : [];
        incomingTickers = parsedTickers;
        latestUtc = mkt.serverUtc ?? '';
        const mergedTickers = mergeTickerFeedSnapshots(tickersRef.current, parsedTickers);
        setLiveFeedActive(Boolean(mkt.liveFeedActive) || hasAnyLiveTickerPrice(mergedTickers));
        if (latestUtc) setServerUtc(latestUtc);
      }
      if (portRes.ok) {
        const pt = await portRes.json();
        if (typeof pt.stateRevision === 'number') {
          incomingRevision = pt.stateRevision;
        }
        if (typeof pt.ledgerEpoch === 'string') {
          incomingEpoch = pt.ledgerEpoch;
        }
        if (pt.portfolio) {
          incomingPortfolio = pt.portfolio as PortfolioSummary;
          latestMode = pt.portfolio.mode;
        }
        if (Array.isArray(pt.positions)) {
          incomingPositions = pt.positions as Position[];
        }
        if (Array.isArray(pt.pnlHistory)) setPnlHistory(pt.pnlHistory);
        setOrders(pt.orders ?? []);
        if (pt.riskConfig) setRiskConfig(pt.riskConfig);
        if (pt.correlationGuard) setCorrelationGuard(pt.correlationGuard);
      }

      const reconciled = reconcileMarketPortfolioPositions({
        incomingTickers,
        incomingPortfolio,
        incomingPositions,
        incomingRevision,
        incomingEpoch,
        forceAuthoritative: portRes.ok,
      });
      if (latestMode && reconciled.acceptedStructuralState) {
        setTradingMode(latestMode);
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
        autoExecutionStatusRef.current = autoData;
        setAutoExecutionStatus(autoData);
      }

      const latencyMs = Math.max(
        1,
        Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
      );
      if (mktRes.ok || portRes.ok) {
        reportDataSync({
          transport: 'HTTP_FAST',
          syncedAtMs: Date.now(),
          latencyMs,
        });
      }
      if (reconciled.tickers.length > 0 && reconciled.portfolio) {
        persistTelemetrySnapshotThrottled({
          stateRevision: lastKnownRevisionRef.current,
          ledgerEpoch: lastKnownEpochRef.current,
          tradingMode: latestMode ?? reconciled.portfolio.mode,
          serverUtc: latestUtc,
          tickers: reconciled.tickers,
          portfolio: reconciled.portfolio,
          positions: reconciled.positions,
          force: portRes.ok,
        });
      }
    } catch {
      reportDataSync({
        transport: navigator.onLine ? 'SYNCING' : 'OFFLINE_CACHED',
      });
    }
  }, [persistTelemetrySnapshotThrottled, reconcileMarketPortfolioPositions, reportDataSync]);

  const fetchFastBootstrap = useCallback(async (): Promise<{ wsSupported?: boolean } | null> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      reportDataSync({ transport: 'OFFLINE_CACHED' });
      return null;
    }
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const res = await apiFetch('/api/sync/bootstrap', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data.wsSupported === 'boolean') {
        wsSupportedRef.current = data.wsSupported;
      }

      const prevRevision = lastKnownRevisionRef.current;
      const incomingRevision =
        typeof data.stateRevision === 'number' ? data.stateRevision : null;
      const incomingEpoch =
        typeof data.ledgerEpoch === 'string' ? data.ledgerEpoch : null;

      const reconciled = reconcileMarketPortfolioPositions({
        incomingTickers: Array.isArray(data.tickers) ? (data.tickers as MarketTicker[]) : undefined,
        incomingPortfolio: data.portfolio as PortfolioSummary | undefined,
        incomingPositions: Array.isArray(data.positions) ? (data.positions as Position[]) : undefined,
        incomingRevision,
        incomingEpoch,
      });

      if (typeof data.liveFeedActive === 'boolean') {
        setLiveFeedActive(data.liveFeedActive || hasAnyLiveTickerPrice(reconciled.tickers));
      }
      if (data.serverUtc) setServerUtc(data.serverUtc);
      if (data.tradingMode && reconciled.acceptedStructuralState) {
        setTradingMode(data.tradingMode);
      }
      if (data.autoExecutionStatus && reconciled.acceptedStructuralState) {
        const autoData = data.autoExecutionStatus as AutoExecutionEngineStatus;
        autoExecutionStatusRef.current = autoData;
        setAutoExecutionStatus(autoData);
      }

      const latencyMs = Math.max(
        1,
        Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
      );
      reportDataSync({
        transport: 'HTTP_FAST',
        syncedAtMs: Date.now(),
        latencyMs,
      });

      if (
        reconciled.epochChanged ||
        (incomingRevision !== null &&
          prevRevision !== null &&
          incomingRevision > prevRevision)
      ) {
        void fetchAllState();
      }

      if (reconciled.tickers.length > 0 && reconciled.portfolio) {
        persistTelemetrySnapshotThrottled({
          stateRevision: lastKnownRevisionRef.current,
          ledgerEpoch: lastKnownEpochRef.current,
          tradingMode: String(data.tradingMode ?? reconciled.portfolio.mode ?? 'PAPER'),
          serverUtc: String(data.serverUtc ?? ''),
          tickers: reconciled.tickers,
          portfolio: reconciled.portfolio,
          positions: reconciled.positions,
          force: reconciled.epochChanged,
        });
      }
      return {
        wsSupported: typeof data.wsSupported === 'boolean' ? data.wsSupported : undefined,
      };
    } catch {
      reportDataSync({
        transport: navigator.onLine ? 'SYNCING' : 'OFFLINE_CACHED',
      });
      return null;
    }
  }, [fetchAllState, persistTelemetrySnapshotThrottled, reconcileMarketPortfolioPositions, reportDataSync]);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/status');
      if (!res.ok) return;
      const data = await res.json();
      setAuthStatus({
        authEnforced: Boolean(data.authEnforced),
        hasClaimedCredential: Boolean(data.hasClaimedCredential),
        authenticated: Boolean(data.authenticated),
        role: typeof data.role === 'string' ? data.role : null,
        actor: typeof data.actor === 'string' ? data.actor : null,
      });
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void refreshAuthStatus();
    const unsubSession = subscribeAuthSession((next) => {
      setAuthSessionState(next);
      void refreshAuthStatus();
    });
    const unsubRequired = subscribeAuthRequired((detail) => {
      setAuthErrorMsg(detail.message ?? null);
      setAuthModalOpen(true);
    });
    return () => {
      unsubSession();
      unsubRequired();
    };
  }, [refreshAuthStatus]);

  // Register unified PWA Sync Now handler
  useEffect(() => {
    return registerDataSyncHandler(fetchAllState);
  }, [registerDataSyncHandler, fetchAllState]);

  // Bootstrap initial state, WebSocket telemetry stream, serverless Direct OKX WS & PWA lifecycle resume sync
  useEffect(() => {
    void fetchAllState();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let directWs: WebSocket | null = null;
    let directPingTimer: number | null = null;
    let directReconnectTimer: number | null = null;
    let directConnected = false;
    let directFailCount = 0;
    let pollTickCount = 0;
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

    const safelyCloseSocket = (sock: WebSocket | null) => {
      if (!sock) return;
      sock.onmessage = null;
      sock.onclose = null;
      sock.onerror = null;
      if (sock.readyState === WebSocket.OPEN) {
        try {
          sock.close();
        } catch {
          // ignore
        }
      } else if (sock.readyState === WebSocket.CONNECTING) {
        sock.onopen = () => {
          try {
            sock.close();
          } catch {
            // ignore
          }
        };
      }
    };

    const stopDirectExchangeWs = () => {
      directConnected = false;
      if (directPingTimer !== null) {
        window.clearInterval(directPingTimer);
        directPingTimer = null;
      }
      if (directReconnectTimer !== null) {
        window.clearTimeout(directReconnectTimer);
        directReconnectTimer = null;
      }
      safelyCloseSocket(directWs);
      directWs = null;
    };

    const startDirectExchangeWs = () => {
      if (closedByEffect || wsConnected || directFailCount >= 3) return;
      if (document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (directWs && (directWs.readyState === WebSocket.OPEN || directWs.readyState === WebSocket.CONNECTING)) {
        return;
      }
      try {
        const sock = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
        directWs = sock;
        let directEverOpened = false;

        sock.onerror = () => {
          // fallback HTTP polling continues automatically
        };
        sock.onopen = () => {
          if (closedByEffect || wsConnected) {
            try {
              sock.close();
            } catch {
              // ignore
            }
            return;
          }
          directConnected = true;
          directEverOpened = true;
          directFailCount = 0;
          reportDataSync({ transport: 'WS_LIVE', syncedAtMs: Date.now() });
          try {
            sock.send(
              JSON.stringify({
                op: 'subscribe',
                args: buildOkxSubscriptionArgs(tickersRef.current),
              }),
            );
          } catch {
            // ignore
          }
          if (directPingTimer !== null) window.clearInterval(directPingTimer);
          directPingTimer = window.setInterval(() => {
            if (sock.readyState === WebSocket.OPEN) {
              try {
                sock.send('ping');
              } catch {
                // ignore
              }
            }
          }, 20_000);
        };
        sock.onmessage = (ev) => {
          if (closedByEffect || wsConnected) return;
          const parsedTick = parseOkxPublicTickerFrame(typeof ev.data === 'string' ? ev.data : '');
          if (!parsedTick) return;
          const updatedTickers = applyDirectExchangeWsTick(tickersRef.current, parsedTick);
          if (updatedTickers === tickersRef.current) return;

          tickersRef.current = updatedTickers;
          setTickers(updatedTickers);
          setLiveFeedActive(true);
          const utc = new Date(parsedTick.timestampUtc).toISOString();
          setServerUtc(utc);
          reportDataSync({ transport: 'WS_LIVE', syncedAtMs: Date.now() });

          const repriced = repricePortfolioAndPositions(
            portfolioRef.current,
            positionsRef.current,
            updatedTickers,
          );
          if (repriced.portfolio !== portfolioRef.current) {
            portfolioRef.current = repriced.portfolio;
            setPortfolio(repriced.portfolio);
          }
          if (repriced.positions !== positionsRef.current) {
            positionsRef.current = repriced.positions;
            setPositions(repriced.positions);
          }

          persistTelemetrySnapshotThrottled({
            stateRevision: lastKnownRevisionRef.current,
            tradingMode: repriced.portfolio.mode ?? 'PAPER',
            serverUtc: utc,
            tickers: updatedTickers,
            portfolio: repriced.portfolio,
            positions: repriced.positions,
          });
        };
        sock.onclose = () => {
          directConnected = false;
          if (directPingTimer !== null) {
            window.clearInterval(directPingTimer);
            directPingTimer = null;
          }
          if (!directEverOpened) {
            directFailCount += 1;
            if (directFailCount >= 3 || closedByEffect) return;
          }
          if (!closedByEffect && !wsConnected && document.visibilityState === 'visible') {
            directReconnectTimer = window.setTimeout(startDirectExchangeWs, 4000);
          }
        };
      } catch {
        directFailCount += 1;
      }
    };

    const scheduleFullRefresh = () => {
      if (wsSyncTimerRef.current !== null) {
        window.clearTimeout(wsSyncTimerRef.current);
      }
      wsSyncTimerRef.current = window.setTimeout(() => {
        wsSyncTimerRef.current = null;
        void fetchAllState();
      }, 220);
    };

    // Adaptive fallback polling (paused when PWA is backgrounded to preserve battery)
    const fastBootstrapTimer = window.setInterval(() => {
      if (!wsConnected && !closedByEffect && document.visibilityState === 'visible') {
        pollTickCount += 1;
        if (directConnected && pollTickCount % 2 !== 0) return;
        void fetchFastBootstrap();
      }
    }, 2500);

    const pollTimer = window.setInterval(() => {
      if (!wsConnected && !closedByEffect && document.visibilityState === 'visible') {
        void fetchAllState();
      }
    }, 15_000);

    const connect = () => {
      if (closedByEffect) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        reportDataSync({ transport: 'OFFLINE_CACHED' });
        return;
      }
      if (wsSupportedRef.current === false || (!everOpened && failedHandshakes >= 2)) {
        startDirectExchangeWs();
        return;
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      try {
        ws = new WebSocket(buildAuthenticatedWsUrl(wsUrl));
        ws.onerror = () => {
          // handled on close
        };
        ws.onopen = () => {
          wsConnected = true;
          everOpened = true;
          failedHandshakes = 0;
          stopDirectExchangeWs();
          reportDataSync({ transport: 'WS_LIVE', syncedAtMs: Date.now() });
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'PRICE_TICK_UPDATE') {
              const incomingRev =
                typeof msg.stateRevision === 'number' ? msg.stateRevision : null;
              const incomingEpoch =
                typeof msg.ledgerEpoch === 'string' ? msg.ledgerEpoch : null;
              const reconciled = reconcileMarketPortfolioPositions({
                incomingTickers: Array.isArray(msg.tickers) ? (msg.tickers as MarketTicker[]) : undefined,
                incomingPortfolio: msg.portfolio as PortfolioSummary | undefined,
                incomingPositions: Array.isArray(msg.positions) ? (msg.positions as Position[]) : undefined,
                incomingRevision: incomingRev,
                incomingEpoch,
              });
              if (msg.pnlPoint) {
                setPnlHistory((prev) => appendPnlPoint(prev, msg.pnlPoint as PnlHistoryPoint));
              }
              if (typeof msg.liveFeedActive === 'boolean') {
                setLiveFeedActive(msg.liveFeedActive || hasAnyLiveTickerPrice(reconciled.tickers));
              }
              if (msg.serverUtc) setServerUtc(msg.serverUtc);
              reportDataSync({ transport: 'WS_LIVE', syncedAtMs: Date.now() });

              if (reconciled.tickers.length > 0 && reconciled.portfolio) {
                persistTelemetrySnapshotThrottled({
                  stateRevision: lastKnownRevisionRef.current,
                  ledgerEpoch: lastKnownEpochRef.current,
                  tradingMode: reconciled.portfolio.mode ?? 'PAPER',
                  serverUtc: msg.serverUtc ?? '',
                  tickers: reconciled.tickers,
                  portfolio: reconciled.portfolio,
                  positions: reconciled.positions,
                  force: reconciled.epochChanged,
                });
              }

              const nextPosCount = reconciled.positions.length;
              const nextRevision = incomingRev ?? prevStateRevision;
              const pnlPt = msg.pnlPoint as PnlHistoryPoint | null | undefined;
              const eventTag = pnlPt?.eventTag;
              const eventTs = pnlPt?.timestampMs ?? 0;
              const isTradeEvent =
                Boolean(eventTag && ['ORDER_FILLED', 'AUTO_SL_TP', 'POSITION_CLOSED', 'EMERGENCY_STOP'].includes(eventTag)) &&
                eventTs !== prevEventTs;

              if (!initializedFromWs) {
                initializedFromWs = true;
                prevPosCount = nextPosCount;
                prevEventTs = eventTs;
                prevStateRevision = nextRevision;
                if (reconciled.epochChanged) {
                  scheduleFullRefresh();
                }
              } else if (
                reconciled.epochChanged ||
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
              const incomingRev =
                typeof msg.stateRevision === 'number' ? msg.stateRevision : null;
              const incomingEpoch =
                typeof msg.ledgerEpoch === 'string' ? msg.ledgerEpoch : null;
              const reconciled = reconcileMarketPortfolioPositions({
                incomingTickers: Array.isArray(msg.tickers) ? (msg.tickers as MarketTicker[]) : undefined,
                incomingPortfolio: msg.portfolio as PortfolioSummary | undefined,
                incomingPositions: Array.isArray(msg.positions) ? (msg.positions as Position[]) : undefined,
                incomingRevision: incomingRev,
                incomingEpoch,
              });
              if (msg.pnlPoint) {
                setPnlHistory((prev) => appendPnlPoint(prev, msg.pnlPoint as PnlHistoryPoint));
              }
              if (msg.tradingMode && reconciled.acceptedStructuralState) {
                setTradingMode(msg.tradingMode);
              }
              if (typeof msg.liveFeedActive === 'boolean') {
                setLiveFeedActive(msg.liveFeedActive || hasAnyLiveTickerPrice(reconciled.tickers));
              }
              if (msg.autoExecutionStatus && reconciled.acceptedStructuralState) {
                const autoData = msg.autoExecutionStatus as AutoExecutionEngineStatus;
                autoExecutionStatusRef.current = autoData;
                setAutoExecutionStatus(autoData);
              }
              if (msg.serverUtc) setServerUtc(msg.serverUtc);
              reportDataSync({ transport: 'WS_LIVE', syncedAtMs: Date.now() });

              if (reconciled.tickers.length > 0 && reconciled.portfolio) {
                persistTelemetrySnapshotThrottled({
                  stateRevision: lastKnownRevisionRef.current,
                  ledgerEpoch: lastKnownEpochRef.current,
                  tradingMode: String(msg.tradingMode ?? reconciled.portfolio.mode ?? 'PAPER'),
                  serverUtc: msg.serverUtc ?? '',
                  tickers: reconciled.tickers,
                  portfolio: reconciled.portfolio,
                  positions: reconciled.positions,
                  force: reconciled.epochChanged,
                });
              }

              const nextPosCount = reconciled.positions.length;
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

              const nextRevision = incomingRev ?? prevStateRevision;

              if (!initializedFromWs) {
                initializedFromWs = true;
                prevPosCount = nextPosCount;
                prevAutoTradesCount = nextAutoCount;
                prevTradingMode = nextMode;
                prevEventTs = eventTs;
                prevStateRevision = nextRevision;
                if (reconciled.epochChanged) {
                  scheduleFullRefresh();
                }
              } else if (
                reconciled.epochChanged ||
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
          if (!closedByEffect && (everOpened || failedHandshakes < 2) && wsSupportedRef.current !== false) {
            reconnectTimer = window.setTimeout(connect, 3500);
          } else if (!closedByEffect) {
            startDirectExchangeWs();
          }
        };
      } catch {
        wsConnected = false;
        startDirectExchangeWs();
      }
    };

    void fetchFastBootstrap().then((boot) => {
      if (closedByEffect) return;
      if (boot?.wsSupported === false) {
        startDirectExchangeWs();
      } else {
        connect();
      }
    });

    // Immediate PWA Resume / Network Recovery Synchronization
    let lastResumeSyncMs = 0;
    const handleResumeSync = () => {
      if (closedByEffect) return;
      if (document.visibilityState === 'hidden') {
        stopDirectExchangeWs();
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        reportDataSync({ transport: 'OFFLINE_CACHED' });
        return;
      }
      const now = Date.now();
      if (now - lastResumeSyncMs < 1500) return;
      lastResumeSyncMs = now;
      void fetchFastBootstrap();
      if (!wsConnected) {
        if (wsSupportedRef.current !== false && (everOpened || failedHandshakes < 2)) {
          connect();
        } else {
          startDirectExchangeWs();
        }
      }
    };

    const handleOnlineRecovery = () => {
      failedHandshakes = 0;
      directFailCount = 0;
      void fetchAllState();
      if (!wsConnected) {
        if (wsSupportedRef.current === false) {
          startDirectExchangeWs();
        } else {
          connect();
        }
      }
    };

    const handleOffline = () => {
      wsConnected = false;
      stopDirectExchangeWs();
      reportDataSync({ transport: 'OFFLINE_CACHED' });
    };

    document.addEventListener('visibilitychange', handleResumeSync);
    window.addEventListener('focus', handleResumeSync);
    window.addEventListener('pageshow', handleResumeSync);
    window.addEventListener('online', handleOnlineRecovery);
    window.addEventListener('offline', handleOffline);

    return () => {
      closedByEffect = true;
      window.clearInterval(pollTimer);
      window.clearInterval(fastBootstrapTimer);
      document.removeEventListener('visibilitychange', handleResumeSync);
      window.removeEventListener('focus', handleResumeSync);
      window.removeEventListener('pageshow', handleResumeSync);
      window.removeEventListener('online', handleOnlineRecovery);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (wsSyncTimerRef.current !== null) {
        window.clearTimeout(wsSyncTimerRef.current);
      }
      stopDirectExchangeWs();
      safelyCloseSocket(ws);
    };
  }, [
    fetchAllState,
    fetchFastBootstrap,
    persistTelemetrySnapshotThrottled,
    reconcileMarketPortfolioPositions,
    reportDataSync,
  ]);

  // Fetch Order Book for exact selected (symbol, marketType, exchange)
  useEffect(() => {
    let cancelled = false;
    const loadOb = () => {
      const params = new URLSearchParams({
        symbol: selectedSymbol,
        marketType: selectedMarketType,
      });
      if (selectedExchange) params.set('exchange', selectedExchange);
      apiFetch(`/api/market/orderbook?${params.toString()}`)
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

  const rawSelectedTicker = findMatchingTicker(tickers, {
    symbol: selectedSymbol,
    marketType: selectedMarketType,
    exchange: selectedExchange,
  });
  const selectedTicker =
    rawSelectedTicker && rawSelectedTicker.lastPrice > 0
      ? rawSelectedTicker
      : pickBestBenchmarkTicker(tickers, selectedSymbol, selectedMarketType) ??
        rawSelectedTicker ??
        null;
  const selectedSignal = findMatchingSignal(signals, selectedTicker);
  const uniquePairTickers = dedupeTickersByPair(tickers);

  const handleSelectSymbol = (
    symbol: string,
    marketType: MarketType,
    exchange?: string,
  ) => {
    const matched = findMatchingTicker(tickers, { symbol, marketType, exchange });
    const nextSym = matched?.symbol ?? symbol;
    const nextMkt = matched?.marketType ?? marketType;
    const nextEx = matched?.exchange ?? exchange ?? '';
    setSelectedSymbol(nextSym);
    setSelectedMarketType(nextMkt);
    setSelectedExchange(nextEx);
    selectedPairRef.current = { symbol: nextSym, marketType: nextMkt, exchange: nextEx };
    persistTelemetrySnapshotThrottled({
      stateRevision: lastKnownRevisionRef.current,
      tradingMode,
      serverUtc,
      tickers: tickersRef.current,
      portfolio: portfolioRef.current,
      positions: positionsRef.current,
      force: true,
    });
  };

  const handleSelectRemotePair = async (
    symbol: string,
    marketType: MarketType,
    exchange: string,
    options?: { runAi?: boolean },
  ) => {
    const res = await apiFetch('/api/market/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, marketType, exchange }),
    });
    if (!res.ok) {
      throw new Error('Failed to activate remote market pair');
    }
    const data = await res.json();
    const chosenSym = data.ticker?.symbol ?? symbol;
    const chosenMkt = (data.ticker?.marketType ?? marketType) as MarketType;
    const chosenEx = (data.ticker?.exchange ?? exchange ?? '') as string;
    setSelectedSymbol(chosenSym);
    setSelectedMarketType(chosenMkt);
    setSelectedExchange(chosenEx);
    selectedPairRef.current = { symbol: chosenSym, marketType: chosenMkt, exchange: chosenEx };
    if (Array.isArray(data.tickers)) {
      const reconciled = reconcileMarketPortfolioPositions({
        incomingTickers: data.tickers as MarketTicker[],
      });
      persistTelemetrySnapshotThrottled({
        stateRevision: lastKnownRevisionRef.current,
        tradingMode,
        serverUtc: data.serverUtc ?? serverUtc,
        tickers: reconciled.tickers,
        portfolio: reconciled.portfolio,
        positions: reconciled.positions,
        force: true,
      });
    }
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
      const res = await apiFetch('/api/run/smart', {
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
        if (data.portfolio || Array.isArray(data.positions)) {
          reconcileMarketPortfolioPositions({
            incomingPortfolio: data.portfolio as PortfolioSummary | undefined,
            incomingPositions: Array.isArray(data.positions) ? (data.positions as Position[]) : undefined,
            incomingRevision: typeof data.stateRevision === 'number' ? data.stateRevision : null,
            incomingEpoch: typeof data.ledgerEpoch === 'string' ? data.ledgerEpoch : null,
            forceAuthoritative: true,
          });
        }
        await fetchAllState();
        broadcastSyncEvent('DATA_MUTATED');
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
      const res = await apiFetch('/api/session/reset', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLastRunSummary(null);
        setSmartOpportunities([]);
        if (data.portfolio || Array.isArray(data.positions)) {
          reconcileMarketPortfolioPositions({
            incomingPortfolio: data.portfolio as PortfolioSummary | undefined,
            incomingPositions: Array.isArray(data.positions) ? (data.positions as Position[]) : undefined,
            incomingRevision: typeof data.stateRevision === 'number' ? data.stateRevision : null,
            incomingEpoch: typeof data.ledgerEpoch === 'string' ? data.ledgerEpoch : null,
            forceAuthoritative: true,
          });
        }
        await fetchAllState();
        broadcastSyncEvent('DATA_MUTATED');
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
      const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/action`, {
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
      broadcastSyncEvent('DATA_MUTATED');
    } catch {
      setActionError(t('app.error.actionFailed'));
    }
  };

  const handleClosePosition = async (id: string): Promise<ClosePositionResponse> => {
    setActionError(null);
    try {
      const res = await apiFetch(`/api/positions/${encodeURIComponent(id)}/close`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data.error || t('app.error.actionFailed');
        const alreadyClosed = Boolean(data.alreadyClosed || res.status === 404 || res.status === 409);
        if (data.portfolio || Array.isArray(data.positions)) {
          reconcileMarketPortfolioPositions({
            incomingPortfolio: data.portfolio as PortfolioSummary | undefined,
            incomingPositions: Array.isArray(data.positions) ? (data.positions as Position[]) : undefined,
            incomingRevision: typeof data.stateRevision === 'number' ? data.stateRevision : null,
            incomingEpoch: typeof data.ledgerEpoch === 'string' ? data.ledgerEpoch : null,
            forceAuthoritative: true,
          });
        }
        if (alreadyClosed) {
          await fetchAllState();
          broadcastSyncEvent('DATA_MUTATED');
        } else {
          setActionError(errMsg);
        }
        return { ok: false, alreadyClosed, error: errMsg };
      }
      reconcileMarketPortfolioPositions({
        incomingPortfolio: data.portfolio as PortfolioSummary | undefined,
        incomingPositions: Array.isArray(data.positions) ? (data.positions as Position[]) : undefined,
        incomingRevision: typeof data.stateRevision === 'number' ? data.stateRevision : null,
        incomingEpoch: typeof data.ledgerEpoch === 'string' ? data.ledgerEpoch : null,
        forceAuthoritative: true,
      });
      if (data.pnlPoint) {
        setPnlHistory((prev) => appendPnlPoint(prev, data.pnlPoint as PnlHistoryPoint));
      }
      await fetchAllState();
      broadcastSyncEvent('DATA_MUTATED');
      return {
        ok: true,
        closedNetPnlUsd: data.closedNetPnlUsd,
        receipt: data.receipt,
      };
    } catch {
      const errMsg = t('app.error.actionFailed');
      setActionError(errMsg);
      return { ok: false, error: errMsg };
    }
  };

  const handleUpdatePositionSlTp = async (
    id: string,
    stopLoss: number,
    takeProfit: number,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/positions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopLoss, takeProfit }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('app.error.updateSlTpFailed') };
      }
      await fetchAllState();
      broadcastSyncEvent('DATA_MUTATED');
      return { ok: true };
    } catch {
      return { ok: false, error: t('app.error.updateSlTpNetwork') };
    }
  };

  const handleSaveRiskConfig = async (cfg: RiskConfig): Promise<boolean> => {
    setActionError(null);
    try {
      const res = await apiFetch('/api/risk/config', {
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
      broadcastSyncEvent('DATA_MUTATED');
      return true;
    } catch {
      setActionError(t('app.error.actionFailed'));
      return false;
    }
  };

  const handleChangeMode = async (
    mode: TradingMode,
    unlockGovernance?: { confirmEmergencyReset: boolean; unlockReason: string },
  ) => {
    if (tradingMode === 'EMERGENCY_STOP' && mode !== 'EMERGENCY_STOP' && !unlockGovernance) {
      setPendingUnlockMode(mode);
      setUnlockReasonInput('');
      setUnlockErrorMsg(null);
      setEmergencyConfirmOpen(true);
      return;
    }
    setActionError(null);
    try {
      const payload = unlockGovernance
        ? {
            mode,
            confirmEmergencyReset: unlockGovernance.confirmEmergencyReset,
            unlockReason: unlockGovernance.unlockReason,
          }
        : { mode };
      const res = await apiFetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.code === 'EMERGENCY_UNLOCK_GOVERNANCE_REQUIRED') {
          setPendingUnlockMode(mode);
          setUnlockErrorMsg(data.error || t('app.emergency.unlockReasonMinErr'));
          setEmergencyConfirmOpen(true);
          return;
        }
        setActionError(data.error || t('app.error.actionFailed'));
        return;
      }
      setEmergencyConfirmOpen(false);
      setUnlockReasonInput('');
      setUnlockErrorMsg(null);
      await fetchAllState();
      broadcastSyncEvent('DATA_MUTATED');
    } catch {
      setActionError(t('app.error.actionFailed'));
    }
  };

  const handleEmergencyStop = async () => {
    setActionError(null);
    try {
      const res = await apiFetch('/api/emergency-stop', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || t('app.error.actionFailed'));
        return;
      }
      setEmergencyConfirmOpen(false);
      await fetchAllState();
      broadcastSyncEvent('DATA_MUTATED');
    } catch {
      setActionError(t('app.error.actionFailed'));
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErrorMsg(null);
    const cleanSecret = authSecretInput.trim();
    if (!cleanSecret) {
      setAuthErrorMsg(t('app.auth.secretPlaceholder'));
      return;
    }
    const isClaimFlow = Boolean(authStatus && !authStatus.authEnforced && !authStatus.hasClaimedCredential);
    setAuthSubmitting(true);
    try {
      const endpoint = isClaimFlow ? '/api/auth/claim' : '/api/auth/login';
      const bodyPayload = isClaimFlow
        ? { actor: authActorInput.trim() || 'SYSTEM_OPERATOR', passphrase: cleanSecret }
        : { token: cleanSecret, passphrase: cleanSecret };
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        setAuthErrorMsg(data.error || t('app.error.actionFailed'));
        return;
      }
      setAuthSession({
        token: String(data.token),
        actor: typeof data.actor === 'string' ? data.actor : null,
        role: typeof data.role === 'string' ? data.role : null,
        expiresAtUtc: typeof data.expiresAtUtc === 'string' ? data.expiresAtUtc : null,
      });
      setAuthSecretInput('');
      setAuthModalOpen(false);
      await fetchAllState();
    } catch {
      setAuthErrorMsg(t('app.error.actionFailed'));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAuthLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore network failures on logout
    }
    clearAuthSession();
    await refreshAuthStatus();
  };

  const handleUpdateAutoConfig = async (
    partial: Partial<AutoExecutionConfig>,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/auto-trade/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('auto.err.updateFailed') };
      }
      setAutoExecutionStatus(data as AutoExecutionEngineStatus);
      if (data.tradingMode) {
        setTradingMode(data.tradingMode as TradingMode);
      }
      await fetchAllState();
      broadcastSyncEvent('DATA_MUTATED');
      return { ok: true };
    } catch {
      return { ok: false, error: t('auto.err.updateFailed') };
    }
  };

  const handleRunAutoCycle = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/auto-trade/cycle', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('auto.err.actionFailed') };
      }
      if (data.status) setAutoExecutionStatus(data.status as AutoExecutionEngineStatus);
      if (data.portfolio || Array.isArray(data.positions)) {
        reconcileMarketPortfolioPositions({
          incomingPortfolio: data.portfolio as PortfolioSummary | undefined,
          incomingPositions: Array.isArray(data.positions) ? (data.positions as Position[]) : undefined,
          incomingRevision: typeof data.stateRevision === 'number' ? data.stateRevision : null,
          incomingEpoch: typeof data.ledgerEpoch === 'string' ? data.ledgerEpoch : null,
          forceAuthoritative: true,
        });
      }
      await fetchAllState();
      broadcastSyncEvent('DATA_MUTATED');
      return { ok: true };
    } catch {
      return { ok: false, error: t('auto.err.actionFailed') };
    }
  };

  const handleApproveAutoProposal = async (
    id: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/auto-trade/proposals/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.portfolio || Array.isArray(data.positions)) {
          reconcileMarketPortfolioPositions({
            incomingPortfolio: data.portfolio as PortfolioSummary | undefined,
            incomingPositions: Array.isArray(data.positions) ? (data.positions as Position[]) : undefined,
            incomingRevision: typeof data.stateRevision === 'number' ? data.stateRevision : null,
            incomingEpoch: typeof data.ledgerEpoch === 'string' ? data.ledgerEpoch : null,
            forceAuthoritative: true,
          });
        }
        return { ok: false, error: data.error || t('auto.err.actionFailed') };
      }
      if (data.status) setAutoExecutionStatus(data.status as AutoExecutionEngineStatus);
      if (data.portfolio || Array.isArray(data.positions)) {
        reconcileMarketPortfolioPositions({
          incomingPortfolio: data.portfolio as PortfolioSummary | undefined,
          incomingPositions: Array.isArray(data.positions) ? (data.positions as Position[]) : undefined,
          incomingRevision: typeof data.stateRevision === 'number' ? data.stateRevision : null,
          incomingEpoch: typeof data.ledgerEpoch === 'string' ? data.ledgerEpoch : null,
          forceAuthoritative: true,
        });
      }
      await fetchAllState();
      broadcastSyncEvent('DATA_MUTATED');
      return { ok: true };
    } catch {
      return { ok: false, error: t('auto.err.actionFailed') };
    }
  };

  const handleRejectAutoProposal = async (
    id: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/auto-trade/proposals/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || t('auto.err.actionFailed') };
      }
      if (data.status) setAutoExecutionStatus(data.status as AutoExecutionEngineStatus);
      await fetchAllState();
      broadcastSyncEvent('DATA_MUTATED');
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
              autoExecutionStatus={autoExecutionStatus}
              openPositionsCount={positions.length}
              onUpdateAutoConfig={handleUpdateAutoConfig}
              onRunAutoCycle={handleRunAutoCycle}
              onApproveAutoProposal={handleApproveAutoProposal}
              onRejectAutoProposal={handleRejectAutoProposal}
              onOpenAutoConfig={() => setActiveTab('portfolio')}
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

            <div className="mt-3 border-t border-slate-800/80 pt-3">
              <p className="text-[11px] text-slate-400">{t('app.sidebar.authLabel')}</p>
              <p
                className={`mt-0.5 font-mono text-[11px] ${
                  authSession.token || authStatus?.authenticated
                    ? 'text-emerald-400'
                    : authStatus?.authEnforced
                      ? 'text-amber-400'
                      : 'text-slate-400'
                }`}
              >
                {authSession.token || authStatus?.authenticated
                  ? t('app.sidebar.authActive', {
                      role: authSession.role ?? authStatus?.role ?? 'OPERATOR',
                    })
                  : authStatus?.authEnforced
                    ? t('app.sidebar.authRequired')
                    : t('app.sidebar.authPublicDev')}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                {authSession.token ? (
                  <button
                    type="button"
                    onClick={handleAuthLogout}
                    data-testid="auth-logout-btn"
                    className="flex min-h-[30px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#070B12] px-2 text-[11px] font-medium text-slate-300 hover:border-slate-500"
                  >
                    <LogOut className="h-3 w-3" />
                    <span>{t('app.sidebar.authBtnLogout')}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthErrorMsg(null);
                      setAuthModalOpen(true);
                    }}
                    data-testid="auth-open-btn"
                    className="flex min-h-[30px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/20"
                  >
                    <KeyRound className="h-3 w-3" />
                    <span>{t('app.sidebar.authBtnLogin')}</span>
                  </button>
                )}
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
              onOrderPlaced={async () => {
                await fetchAllState();
                broadcastSyncEvent('DATA_MUTATED');
              }}
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

      {/* Emergency Stop Confirmation / Unlock Governance Dialog */}
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
                {tradingMode === 'EMERGENCY_STOP'
                  ? t('app.emergency.unlockTitle')
                  : t('app.emergency.dialogTitle')}
              </h2>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {tradingMode === 'EMERGENCY_STOP'
                ? t('app.emergency.unlockDesc')
                : t('app.emergency.dialogDesc')}
            </p>
            {tradingMode === 'EMERGENCY_STOP' && (
              <div className="mt-3 space-y-1.5">
                <label
                  htmlFor="em-unlock-reason"
                  className="block text-[11px] font-medium text-slate-300"
                >
                  {t('app.emergency.unlockReasonLabel')}
                </label>
                <input
                  id="em-unlock-reason"
                  type="text"
                  value={unlockReasonInput}
                  onChange={(e) => {
                    setUnlockReasonInput(e.target.value);
                    if (unlockErrorMsg) setUnlockErrorMsg(null);
                  }}
                  placeholder={t('app.emergency.unlockReasonPlaceholder')}
                  className="min-h-[42px] w-full rounded-lg border border-slate-700 bg-[#070B12] px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                {unlockErrorMsg && (
                  <p className="text-[11px] text-rose-400">{unlockErrorMsg}</p>
                )}
              </div>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setEmergencyConfirmOpen(false);
                  setUnlockErrorMsg(null);
                }}
                className="min-h-[44px] rounded-lg border border-slate-700 px-4 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                {t('app.emergency.cancelBtn')}
              </button>
              {tradingMode === 'EMERGENCY_STOP' ? (
                <button
                  type="button"
                  onClick={() => {
                    const clean = unlockReasonInput.trim();
                    if (clean.length < 3) {
                      setUnlockErrorMsg(t('app.emergency.unlockReasonMinErr'));
                      return;
                    }
                    void handleChangeMode(pendingUnlockMode, {
                      confirmEmergencyReset: true,
                      unlockReason: clean,
                    });
                  }}
                  className="min-h-[44px] rounded-lg bg-cyan-600 px-4 text-xs font-semibold text-white hover:bg-cyan-500"
                >
                  {t('app.emergency.restoreTargetBtn', { mode: pendingUnlockMode })}
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

      {/* Operator In-Memory Authentication Modal */}
      {authModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <form
            onSubmit={handleAuthSubmit}
            className="w-full max-w-md rounded-2xl border border-cyan-500/35 bg-[#0E1522] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-cyan-300">
                <KeyRound className="h-5 w-5" />
                <h2 id="auth-modal-title" className="font-display text-base font-semibold text-slate-100">
                  {t('app.auth.modalTitle')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {authStatus && !authStatus.authEnforced && !authStatus.hasClaimedCredential
                ? t('app.auth.claimDesc')
                : t('app.auth.loginDesc')}
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {t('app.auth.modalDesc')}
            </p>

            {authStatus && !authStatus.authEnforced && !authStatus.hasClaimedCredential && (
              <div className="mt-3 space-y-1">
                <label htmlFor="auth-actor-input" className="block text-[11px] font-medium text-slate-300">
                  {t('app.auth.actorLabel')}
                </label>
                <input
                  id="auth-actor-input"
                  type="text"
                  value={authActorInput}
                  onChange={(e) => setAuthActorInput(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-slate-700 bg-[#070B12] px-3 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            )}

            <div className="mt-3 space-y-1">
              <label htmlFor="auth-secret-input" className="block text-[11px] font-medium text-slate-300">
                {t('app.auth.secretLabel')}
              </label>
              <input
                id="auth-secret-input"
                type="password"
                value={authSecretInput}
                onChange={(e) => setAuthSecretInput(e.target.value)}
                placeholder={t('app.auth.secretPlaceholder')}
                className="min-h-[42px] w-full rounded-lg border border-slate-700 bg-[#070B12] px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            {authErrorMsg && (
              <p className="mt-2 text-xs text-rose-400">{authErrorMsg}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                className="min-h-[40px] rounded-lg border border-slate-700 px-4 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                {t('app.auth.cancel')}
              </button>
              <button
                type="submit"
                disabled={authSubmitting}
                className="min-h-[40px] rounded-lg bg-cyan-600 px-4 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-60"
              >
                {authSubmitting
                  ? t('app.auth.submitting')
                  : authStatus && !authStatus.authEnforced && !authStatus.hasClaimedCredential
                    ? t('app.auth.claimSubmit')
                    : t('app.auth.loginSubmit')}
              </button>
            </div>
          </form>
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
