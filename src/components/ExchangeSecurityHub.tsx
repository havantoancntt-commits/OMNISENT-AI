import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TestTube2,
  Unplug,
} from 'lucide-react';
import { getLocalizedExchangeSpec } from '../engine/exchangeCatalog';
import type {
  AuditLogEntry,
  ExchangeEnvironment,
  ExchangeInfo,
  ExchangeVerificationStatus,
} from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

interface ExchangeSecurityHubProps {
  exchanges: ExchangeInfo[];
  auditLogs: AuditLogEntry[];
  liveFeedActive: boolean;
  onRefreshExchanges: () => void;
}

type RegistryFilter = 'ALL' | 'CONFIGURED' | 'TESTNET' | 'SPOT' | 'FUTURES';

interface FeedbackState {
  tone: 'success' | 'warning' | 'error';
  text: string;
  latencyMs?: number;
  detectedEquityUsd?: number | null;
}

function getVerificationLabel(
  ex: ExchangeInfo,
  t: ReturnType<typeof useI18n>['t'],
): {
  label: string;
  colorClass: string;
} {
  if (!ex.hasApiKeyConfigured) {
    return ex.connectionStatus === 'PUBLIC_ONLY'
      ? { label: t('sec.status.publicFeed'), colorClass: 'text-cyan-400' }
      : { label: t('sec.status.notConnected'), colorClass: 'text-slate-500' };
  }
  switch (ex.verificationStatus as ExchangeVerificationStatus) {
    case 'VERIFIED_LIVE':
      return { label: t('sec.status.verifiedLive'), colorClass: 'text-emerald-400' };
    case 'VERIFIED_TESTNET':
      return { label: t('sec.status.verifiedTestnet'), colorClass: 'text-cyan-300' };
    case 'VAULT_STORED_UNVERIFIED':
      return { label: t('sec.status.vaultUnverified'), colorClass: 'text-amber-400' };
    case 'AUTH_FAILED':
      return { label: t('sec.status.authFailed'), colorClass: 'text-rose-400' };
    default:
      return { label: t('sec.status.vaultStored'), colorClass: 'text-slate-300' };
  }
}

export const ExchangeSecurityHub: React.FC<ExchangeSecurityHubProps> = ({
  exchanges,
  auditLogs,
  liveFeedActive,
  onRefreshExchanges,
}) => {
  const { locale, t } = useI18n();
  const [selectedId, setSelectedId] = useState<string>(exchanges[0]?.id ?? 'binance');
  const [environment, setEnvironment] = useState<ExchangeEnvironment>('MAINNET');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<RegistryFilter>('ALL');

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const [spotTrade, setSpotTrade] = useState(true);
  const [futuresTrade, setFuturesTrade] = useState(true);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [batchVerifying, setBatchVerifying] = useState(false);
  const [canStageUnverified, setCanStageUnverified] = useState(false);
  const [allowUnverifiedStage, setAllowUnverifiedStage] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const selectedSpec = useMemo(() => getLocalizedExchangeSpec(selectedId, locale), [selectedId, locale]);
  const selectedExchange = useMemo(
    () => exchanges.find((ex) => ex.id === selectedId) ?? exchanges[0],
    [exchanges, selectedId],
  );

  const effectiveEnv: ExchangeEnvironment =
    environment === 'TESTNET' && selectedSpec.supportsTestnet ? 'TESTNET' : 'MAINNET';

  const configuredExchanges = useMemo(
    () => exchanges.filter((ex) => ex.hasApiKeyConfigured),
    [exchanges],
  );
  const verifiedCount = useMemo(
    () =>
      configuredExchanges.filter(
        (ex) =>
          ex.verificationStatus === 'VERIFIED_LIVE' ||
          ex.verificationStatus === 'VERIFIED_TESTNET',
      ).length,
    [configuredExchanges],
  );

  const filteredExchanges = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return exchanges.filter((ex) => {
      const spec = getLocalizedExchangeSpec(ex.id, locale);
      if (filter === 'CONFIGURED' && !ex.hasApiKeyConfigured) return false;
      if (filter === 'TESTNET' && !spec.supportsTestnet) return false;
      if (filter === 'SPOT' && !ex.supportedMarkets.includes('SPOT')) return false;
      if (
        filter === 'FUTURES' &&
        !ex.supportedMarkets.includes('FUTURES') &&
        !ex.supportedMarkets.includes('PERPETUAL')
      ) {
        return false;
      }
      if (!q) return true;
      return (
        ex.name.toLowerCase().includes(q) ||
        ex.id.toLowerCase().includes(q) ||
        spec.tierLabel.toLowerCase().includes(q) ||
        spec.authLabel.toLowerCase().includes(q)
      );
    });
  }, [exchanges, filter, searchQuery, locale]);

  const handleSelectExchange = (id: string) => {
    const nextSpec = getLocalizedExchangeSpec(id, locale);
    const ex = exchanges.find((item) => item.id === id);
    setSelectedId(id);
    if (!nextSpec.supportsTestnet) {
      setEnvironment('MAINNET');
    } else if (ex?.hasApiKeyConfigured) {
      setEnvironment(ex.environment);
    }
    setCanStageUnverified(false);
    setAllowUnverifiedStage(false);
    setFeedback(null);
  };

  const handleTestAuth = async () => {
    setTesting(true);
    setFeedback(null);
    setCanStageUnverified(false);
    try {
      const res = await fetch('/api/exchanges/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchangeId: selectedId,
          apiKey,
          apiSecret,
          passphrase,
          environment: effectiveEnv,
          allowWithdrawal: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ tone: 'error', text: data.error || t('sec.msg.testFailed') });
        onRefreshExchanges();
        return;
      }

      const v = data.verification as {
        ok: boolean;
        outcome: string;
        latencyMs: number;
        message: string;
        detectedEquityUsd?: number | null;
      };
      if (v.ok) {
        setFeedback({
          tone: 'success',
          text: v.message,
          latencyMs: v.latencyMs,
          detectedEquityUsd: v.detectedEquityUsd ?? null,
        });
      } else if (v.outcome === 'REGION_OR_NETWORK_RESTRICTED') {
        setCanStageUnverified(true);
        setFeedback({
          tone: 'warning',
          text: v.message,
          latencyMs: v.latencyMs,
        });
      } else {
        setFeedback({
          tone: 'error',
          text: v.message,
          latencyMs: v.latencyMs,
        });
      }
      onRefreshExchanges();
    } catch {
      setFeedback({ tone: 'error', text: t('sec.msg.testNetworkErr') });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/exchanges/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchangeId: selectedId,
          apiKey,
          apiSecret,
          passphrase,
          spotTrade,
          futuresTrade,
          environment: effectiveEnv,
          allowWithdrawal: false,
          allowUnverifiedVaultStage: allowUnverifiedStage,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.canStageUnverified) {
          setCanStageUnverified(true);
          setFeedback({
            tone: 'warning',
            text: data.error || t('sec.msg.regionRestricted'),
          });
        } else {
          setFeedback({
            tone: 'error',
            text: data.error || t('sec.msg.connectFailed'),
          });
        }
        onRefreshExchanges();
        return;
      }

      const v = data.verification as {
        ok: boolean;
        latencyMs: number;
        message: string;
        detectedEquityUsd?: number | null;
      };
      setApiKey('');
      setApiSecret('');
      setPassphrase('');
      setCanStageUnverified(false);
      setAllowUnverifiedStage(false);
      setFeedback({
        tone: v?.ok ? 'success' : 'warning',
        text: v?.ok
          ? t('sec.msg.vaultEncryptedOk', { msg: v.message })
          : t('sec.msg.vaultStagedWarn', { msg: v?.message ?? '' }),
        latencyMs: v?.latencyMs,
        detectedEquityUsd: v?.detectedEquityUsd ?? null,
      });
      onRefreshExchanges();
    } catch {
      setFeedback({ tone: 'error', text: t('sec.msg.vaultNetworkErr') });
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyOne = async (id: string) => {
    setVerifyingId(id);
    try {
      const res = await fetch(`/api/exchanges/${id}/verify`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          tone: 'error',
          text: data.error || t('sec.msg.reverifyFail', { id }),
        });
      } else if (data.verification) {
        const v = data.verification as {
          ok: boolean;
          outcome: string;
          latencyMs: number;
          message: string;
          detectedEquityUsd?: number | null;
        };
        setFeedback({
          tone: v.ok
            ? 'success'
            : v.outcome === 'REGION_OR_NETWORK_RESTRICTED'
              ? 'warning'
              : 'error',
          text: v.message,
          latencyMs: v.latencyMs,
          detectedEquityUsd: v.detectedEquityUsd ?? null,
        });
      }
      onRefreshExchanges();
    } catch {
      setFeedback({ tone: 'error', text: t('sec.msg.reverifyErr', { id }) });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleVerifyAll = async () => {
    setBatchVerifying(true);
    try {
      const res = await fetch('/api/exchanges/verify-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ tone: 'error', text: data.error || t('sec.msg.batchFail') });
      } else {
        const count = Array.isArray(data.results) ? data.results.length : 0;
        setFeedback({
          tone: 'success',
          text: t('sec.msg.batchSuccess', { count }),
        });
      }
      onRefreshExchanges();
    } catch {
      setFeedback({ tone: 'error', text: t('sec.msg.batchErr') });
    } finally {
      setBatchVerifying(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    await fetch(`/api/exchanges/${id}/disconnect`, { method: 'POST' });
    setFeedback({
      tone: 'success',
      text: t('sec.msg.disconnected', { name: getLocalizedExchangeSpec(id, locale).name }),
    });
    onRefreshExchanges();
  };

  return (
    <div className="space-y-6">
      {/* Top Security Vault KPI Strip */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {t('sec.kpi.supportedTitle')}
          </p>
          <p className="mt-1.5 font-display text-xl font-semibold tabular-nums text-slate-100 whitespace-nowrap">
            {t('sec.kpi.supportedVal', { count: exchanges.length })}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            HMAC-SHA256 / SHA512 / Passphrase / CDP
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {t('sec.kpi.vaultTitle')}
          </p>
          <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-cyan-300">
            {configuredExchanges.length} / {exchanges.length}
          </p>
          <p className="mt-1 text-xs tabular-nums text-slate-400">
            {t('sec.kpi.verifiedDesc', { count: verifiedCount })}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {t('sec.kpi.withdrawTitle')}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 font-display text-lg font-semibold text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
            <span>{t('sec.kpi.withdrawVal')}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t('sec.kpi.withdrawDesc')}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {t('sec.kpi.publicFeedTitle')}
          </p>
          <p
            className={`mt-1.5 font-display text-lg font-semibold ${
              liveFeedActive ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {liveFeedActive ? t('sec.kpi.feedConnected') : t('sec.kpi.feedOffline')}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t('sec.kpi.publicFeedDesc')}
          </p>
        </div>
      </section>

      {/* Main Split: 11-Exchange Registry + Vault Setup Console */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Exchange Registry */}
        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                {t('sec.registryTitle')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('sec.registrySubtitle')}
              </p>
            </div>
            {configuredExchanges.length > 0 && (
              <button
                type="button"
                disabled={batchVerifying}
                onClick={handleVerifyAll}
                className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${batchVerifying ? 'animate-spin' : ''}`} />
                <span>{batchVerifying ? t('sec.verifyingAllBtn') : t('sec.verifyAllBtn')}</span>
              </button>
            )}
          </div>

          {/* Search & Filter Toolbar */}
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sec.searchPlaceholder')}
                className="min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-[#070B12] p-1 text-[11px]">
              {(
                [
                  { id: 'ALL', label: t('sec.filter.ALL') },
                  { id: 'CONFIGURED', label: t('sec.filter.CONFIGURED') },
                  { id: 'TESTNET', label: t('sec.filter.TESTNET') },
                  { id: 'SPOT', label: t('sec.filter.SPOT') },
                  { id: 'FUTURES', label: t('sec.filter.FUTURES') },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition-colors ${
                    filter === tab.id
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Exchange Cards */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredExchanges.map((ex) => {
              const spec = getLocalizedExchangeSpec(ex.id, locale);
              const badge = getVerificationLabel(ex, t);
              const isSelected = ex.id === selectedId;
              const isVerifyingThis = verifyingId === ex.id;

              return (
                <div
                  key={ex.id}
                  className={`flex flex-col justify-between rounded-xl border p-3.5 text-xs transition-colors ${
                    isSelected
                      ? 'border-cyan-500/70 bg-[#0D192B]'
                      : 'border-slate-800 bg-[#0A101B] hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <button
                          type="button"
                          onClick={() => handleSelectExchange(ex.id)}
                          className="text-left font-display text-sm font-semibold text-slate-100 hover:text-cyan-300"
                        >
                          {ex.name}
                        </button>
                        <p className="text-[11px] text-slate-400">{spec.tierLabel}</p>
                      </div>
                      <span className={`font-mono text-[11px] font-semibold whitespace-nowrap shrink-0 ${badge.colorClass}`}>
                        {badge.label}
                      </span>
                    </div>

                    <div className="mt-2 space-y-1 font-mono text-[11px] text-slate-400">
                      <p className="text-slate-300">{spec.authLabel}</p>
                      <p className="tabular-nums text-slate-500">
                        {ex.supportedMarkets.join(' · ')}
                      </p>
                      <p className="tabular-nums text-slate-500">
                        RTT {ex.apiLatencyMs}ms · Fee {ex.makerFeeBps}/{ex.takerFeeBps} bps
                        {spec.supportsTestnet ? ' · Testnet OK' : ''}
                      </p>
                    </div>

                    {ex.hasApiKeyConfigured && (
                      <div className="mt-2 border-t border-slate-800/70 pt-2 text-[11px]">
                        <div className="flex items-center justify-between font-mono text-slate-300">
                          <span>
                            Key: {ex.maskedApiKey} ·{' '}
                            <span className="text-cyan-400">{ex.environment}</span>
                          </span>
                          {ex.accountEquitySummaryUsd !== null && (
                            <span className="tabular-nums text-emerald-400">
                              ${ex.accountEquitySummaryUsd.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              USDT
                            </span>
                          )}
                        </div>
                        {ex.verificationNote && (
                          <p className="mt-1 line-clamp-2 text-slate-400">{ex.verificationNote}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-2.5">
                    {ex.hasApiKeyConfigured ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isVerifyingThis}
                            onClick={() => handleVerifyOne(ex.id)}
                            className="flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-700 px-2.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 whitespace-nowrap"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${isVerifyingThis ? 'animate-spin' : ''}`}
                            />
                            <span>{isVerifyingThis ? t('sec.verifyingBtn') : t('sec.reverifyBtn')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectExchange(ex.id)}
                            className="flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-700 px-2.5 text-[11px] text-cyan-300 hover:bg-cyan-500/10 whitespace-nowrap"
                          >
                            <KeyRound className="h-3 w-3" />
                            <span>{t('sec.updateBtn')}</span>
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDisconnect(ex.id)}
                          className="flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-700 px-2.5 text-[11px] text-rose-300 hover:bg-rose-500/10 whitespace-nowrap"
                        >
                          <Unplug className="h-3 w-3" />
                          <span>{t('sec.disconnectBtn')}</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSelectExchange(ex.id)}
                        className="flex min-h-[32px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 text-[11px] font-medium text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-500/10 whitespace-nowrap"
                      >
                        <KeyRound className="h-3 w-3" />
                        <span>{t('sec.connectBtn')}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredExchanges.length === 0 && (
              <div className="col-span-full rounded-xl border border-slate-800 bg-[#0A101B] p-6 text-center text-xs text-slate-400">
                {t('sec.noExchangeMatch')}
              </div>
            )}
          </div>
        </div>

        {/* Right: Institutional Encrypted API Vault Console */}
        <form
          onSubmit={handleConnect}
          className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-cyan-400" />
              <h2 className="font-display text-base font-semibold text-slate-100">
                {t('sec.vaultConsoleTitle')}
              </h2>
            </div>
            <span className="font-mono text-[11px] text-slate-400">AES-256-GCM</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {t('sec.vaultConsoleDesc')}
          </p>

          <div className="mt-4 space-y-3 text-xs">
            {/* Exchange Selector */}
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="ex-select">
                {t('sec.fieldExchange')}
              </label>
              <select
                id="ex-select"
                value={selectedId}
                onChange={(e) => handleSelectExchange(e.target.value)}
                className="min-h-[42px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 text-sm text-slate-100 focus:border-cyan-500/60 focus:outline-none"
              >
                {exchanges.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} ({getLocalizedExchangeSpec(ex.id, locale).authLabel})
                  </option>
                ))}
              </select>
            </div>

            {/* Environment Toggle */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-slate-400">{t('sec.fieldEnv')}</span>
                {!selectedSpec.supportsTestnet && (
                  <span className="text-[11px] text-slate-500">
                    {t('sec.mainnetOnlyNote', { name: selectedSpec.name })}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-[#070B12] p-1">
                <button
                  type="button"
                  onClick={() => setEnvironment('MAINNET')}
                  className={`min-h-[34px] rounded-md text-xs font-medium transition-colors ${
                    effectiveEnv === 'MAINNET'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('sec.envMainnet')}
                </button>
                <button
                  type="button"
                  disabled={!selectedSpec.supportsTestnet}
                  onClick={() => setEnvironment('TESTNET')}
                  className={`min-h-[34px] rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    effectiveEnv === 'TESTNET'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('sec.envTestnet')}
                </button>
              </div>
            </div>

            {/* Exchange Auth & Security Guide */}
            <div className="rounded-lg border border-slate-800 bg-[#0A101B] p-3 text-[11px]">
              <div className="flex items-center justify-between font-mono text-cyan-300">
                <span>{selectedSpec.authLabel}</span>
                {selectedExchange?.hasApiKeyConfigured && (
                  <span className="text-emerald-400">
                    {t('sec.currentlyStored', { key: selectedExchange.maskedApiKey ?? '--' })}
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                Endpoint:{' '}
                {effectiveEnv === 'TESTNET' && selectedSpec.testnetProbeLabel
                  ? selectedSpec.testnetProbeLabel
                  : selectedSpec.mainnetProbeLabel}
              </p>
              <ul className="mt-2 space-y-1 text-slate-300">
                {selectedSpec.permissionChecklist.map((item) => (
                  <li key={item} className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-cyan-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-slate-400">{selectedSpec.ipWhitelistTip}</p>
            </div>

            {/* API Key */}
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="ex-apikey">
                {selectedId === 'deribit' ? t('sec.clientIdLabel') : 'API Key'}
              </label>
              <div className="relative">
                <input
                  id="ex-apikey"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('sec.apiKeyPlaceholder')}
                  className="min-h-[42px] w-full rounded-lg border border-slate-800 bg-[#070B12] pl-3 pr-10 font-mono text-sm text-slate-100 focus:border-cyan-500/60 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={showKey ? t('sec.hideApiKeyAria') : t('sec.showApiKeyAria')}
                  onClick={() => setShowKey((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* API Secret */}
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="ex-secret">
                {selectedId === 'deribit'
                  ? t('sec.clientSecretLabel')
                  : selectedId === 'coinbase'
                    ? t('sec.coinbaseSecretLabel')
                    : 'API Secret'}
              </label>
              <div className="relative">
                <input
                  id="ex-secret"
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="off"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder={t('sec.apiSecretPlaceholder')}
                  className="min-h-[42px] w-full rounded-lg border border-slate-800 bg-[#070B12] pl-3 pr-10 font-mono text-sm text-slate-100 focus:border-cyan-500/60 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={showSecret ? t('sec.hideSecretAria') : t('sec.showSecretAria')}
                  onClick={() => setShowSecret((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Passphrase (highlighted when required) */}
            {(selectedSpec.requiresPassphrase || passphrase.length > 0) && (
              <div>
                <label className="mb-1 flex items-center justify-between text-slate-300" htmlFor="ex-pass">
                  <span>{t('sec.passphraseLabel', { name: selectedSpec.name })}</span>
                  <span className="font-mono text-[11px] text-amber-400">{t('sec.requiredTag')}</span>
                </label>
                <div className="relative">
                  <input
                    id="ex-pass"
                    type={showPassphrase ? 'text' : 'password'}
                    autoComplete="off"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder={t('sec.passphrasePlaceholder', { name: selectedSpec.name })}
                    className="min-h-[42px] w-full rounded-lg border border-amber-500/40 bg-[#070B12] pl-3 pr-10 font-mono text-sm text-slate-100 focus:border-cyan-500/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={showPassphrase ? t('sec.hidePassAria') : t('sec.showPassAria')}
                    onClick={() => setShowPassphrase((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {/* Granular Permissions */}
            <div className="space-y-1.5 pt-1">
              <label className="flex min-h-[32px] items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={spotTrade}
                  onChange={(e) => setSpotTrade(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
                <span>{t('sec.allowSpot')}</span>
              </label>
              <label className="flex min-h-[32px] items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={futuresTrade}
                  onChange={(e) => setFuturesTrade(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
                <span>{t('sec.allowFutures')}</span>
              </label>
              <div className="flex items-center gap-2 pt-0.5 text-emerald-400">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>{t('sec.withdrawGuardLine')}</span>
              </div>
            </div>

            {canStageUnverified && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                <input
                  type="checkbox"
                  checked={allowUnverifiedStage}
                  onChange={(e) => setAllowUnverifiedStage(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-500 bg-slate-900"
                />
                <span>{t('sec.stageUnverifiedNote')}</span>
              </label>
            )}
          </div>

          {feedback && (
            <div
              className={`mt-3 rounded-lg border p-2.5 text-xs ${
                feedback.tone === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : feedback.tone === 'warning'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              }`}
            >
              <p>{feedback.text}</p>
              {(feedback.latencyMs !== undefined || feedback.detectedEquityUsd !== undefined) && (
                <p className="mt-1 font-mono text-[11px] tabular-nums opacity-85">
                  {feedback.latencyMs !== undefined ? `RTT: ${feedback.latencyMs}ms` : ''}
                  {feedback.detectedEquityUsd !== null && feedback.detectedEquityUsd !== undefined
                    ? t('sec.detectedEquity', {
                        equity: feedback.detectedEquityUsd.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }),
                      })
                    : ''}
                </p>
              )}
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={testing || saving || apiKey.trim().length < 8 || apiSecret.trim().length < 8}
              onClick={handleTestAuth}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#0A101B] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-45"
            >
              <TestTube2 className="h-4 w-4" />
              <span>{testing ? t('sec.testingAuthBtn') : t('sec.testAuthBtn')}</span>
            </button>

            <button
              type="submit"
              disabled={saving || testing || apiKey.trim().length < 8 || apiSecret.trim().length < 8}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-45"
            >
              <Lock className="h-4 w-4" />
              <span>
                {saving
                  ? t('sec.savingVaultBtn')
                  : selectedExchange?.hasApiKeyConfigured
                    ? t('sec.updateVaultBtn')
                    : t('sec.connectVaultBtn')}
              </span>
            </button>
          </div>
        </form>
      </section>

      {/* Immutable Audit Trail */}
      <section className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
        <h2 className="mb-3 font-display text-base font-semibold text-slate-100">
          {t('sec.auditTitle', { count: auditLogs.length })}
        </h2>
        <div className="max-h-72 overflow-x-auto overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-3 font-medium">UTC</th>
                <th className="py-2 pr-3 font-medium">{t('sec.auditGroupCol')}</th>
                <th className="py-2 pr-3 font-medium">Actor</th>
                <th className="py-2 pr-3 font-medium">{t('sec.auditActionCol')}</th>
                <th className="py-2 font-medium">{t('sec.auditDetailCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="py-2 pr-3 tabular-nums text-slate-400">
                    {log.timestampUtc.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td
                    className={`py-2 pr-3 font-semibold ${
                      log.severity === 'CRITICAL'
                        ? 'text-rose-400'
                        : log.severity === 'WARNING'
                          ? 'text-amber-400'
                          : 'text-cyan-400'
                    }`}
                  >
                    {log.category}
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{log.actor}</td>
                  <td className="py-2 pr-3 text-slate-200">{log.action}</td>
                  <td className="py-2 font-sans text-xs text-slate-400">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
