import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Cpu,
  ExternalLink,
  Globe,
  Play,
  Power,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  dedupeTickersByPair,
  findMatchingSignal,
  parsePairSelection,
  serializePairSelection,
} from '../engine/pairSelection';
import type {
  AgentLogEntry,
  AgentState,
  GeminiDecisionCalibration,
  GeminiGroundingSource,
  MarketTicker,
  MarketType,
  TradingSignal,
} from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

const AGENT_CATEGORY_KEYS = {
  ALL: 'agents.cat.ALL',
  ORCHESTRATION: 'agents.cat.ORCHESTRATION',
  DATA: 'agents.cat.DATA',
  ANALYSIS: 'agents.cat.ANALYSIS',
  STRATEGY: 'agents.cat.STRATEGY',
  RISK: 'agents.cat.RISK',
  EXECUTION: 'agents.cat.EXECUTION',
  SECURITY: 'agents.cat.SECURITY',
} as const;

interface AgentControlCenterProps {
  agents: AgentState[];
  agentLogs: AgentLogEntry[];
  tickers: MarketTicker[];
  selectedTicker: MarketTicker | null;
  selectedSignal: TradingSignal | null;
  signals: TradingSignal[];
  onSelectSymbol: (symbol: string, marketType: MarketType, exchange?: string) => void;
  onAgentAction: (agentId: string, action: 'START' | 'STOP' | 'RESTART' | 'ENABLE' | 'DISABLE') => void;
  onRunPipeline: (symbol: string, marketType: MarketType, exchange?: string) => void;
  onOpenGlobalSearch?: () => void;
  onRefreshState?: () => Promise<void> | void;
  pipelineLoading: boolean;
}

interface GeminiResult {
  status: 'OK' | 'UNCONFIGURED' | 'ERROR';
  model: string;
  thinkingLevel?: string;
  executiveThesis?: string;
  regimeAssessment?: string;
  catalystBrief?: string;
  groundingSources?: GeminiGroundingSource[];
  decisionCalibration?: GeminiDecisionCalibration | null;
  keyRisks?: string[];
  recommendedAction?: string;
  errorMessage?: string;
  generatedAtUtc: string;
}

interface CopilotMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  toolsUsed?: string[];
  sources?: GeminiGroundingSource[];
  error?: boolean;
}

export const AgentControlCenter: React.FC<AgentControlCenterProps> = ({
  agents,
  agentLogs,
  tickers,
  selectedTicker,
  selectedSignal,
  signals,
  onSelectSymbol,
  onAgentAction,
  onRunPipeline,
  onOpenGlobalSearch,
  onRefreshState,
  pipelineLoading,
}) => {
  const { locale, t } = useI18n();
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [geminiTab, setGeminiTab] = useState<'synthesis' | 'copilot'>('synthesis');
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiResult, setGeminiResult] = useState<GeminiResult | null>(null);

  const [copilotInput, setCopilotInput] = useState('');
  const [copilotStreaming, setCopilotStreaming] = useState(false);
  const [copilotActiveTools, setCopilotActiveTools] = useState<string[]>([]);
  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([]);

  const activeTicker = selectedTicker ?? tickers[0] ?? null;
  const activeSelectValue = activeTicker ? serializePairSelection(activeTicker) : '';
  const uniquePairTickers = dedupeTickersByPair(tickers);

  // Clear stale Gemini analysis whenever the active coin/exchange/marketType switches
  useEffect(() => {
    setGeminiResult(null);
    setCopilotMessages([]);
    setCopilotActiveTools([]);
  }, [activeTicker?.symbol, activeTicker?.marketType, activeTicker?.exchange]);

  const categories = ['ALL', 'ORCHESTRATION', 'DATA', 'ANALYSIS', 'STRATEGY', 'RISK', 'EXECUTION', 'SECURITY'] as const;
  const filteredAgents = agents.filter((a) => catFilter === 'ALL' || a.category === catFilter);
  const activeSignal = selectedSignal ?? findMatchingSignal(signals, activeTicker);
  const latestAnySignal = signals[0] ?? null;

  const handleGeminiSynthesize = async () => {
    if (!activeTicker) return;
    setGeminiLoading(true);
    try {
      const res = await fetch('/api/ai/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: activeTicker.symbol,
          marketType: activeTicker.marketType,
          exchange: activeTicker.exchange,
          locale,
        }),
      });
      const data = await res.json();
      if (data.synthesis) setGeminiResult(data.synthesis);
      await onRefreshState?.();
    } catch {
      setGeminiResult({
        status: 'ERROR',
        model: 'gemini-4-hydrogen',
        errorMessage: t('agents.geminiEndpointErr'),
        generatedAtUtc: new Date().toISOString(),
      });
    } finally {
      setGeminiLoading(false);
    }
  };

  const handleCopilotSend = async (promptOverride?: string) => {
    const question = (promptOverride ?? copilotInput).trim();
    if (!question || !activeTicker || copilotStreaming) return;

    const userMsg: CopilotMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: question,
    };
    const assistantId = `m-${Date.now() + 1}`;
    const historyPayload = copilotMessages
      .filter((m) => !m.error && m.text.trim().length > 0)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    setCopilotInput('');
    setCopilotActiveTools([]);
    setCopilotStreaming(true);
    setCopilotMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'model', text: '', toolsUsed: [], sources: [] },
    ]);

    try {
      const res = await fetch('/api/ai/copilot/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          symbol: activeTicker.symbol,
          marketType: activeTicker.marketType,
          exchange: activeTicker.exchange,
          locale,
          history: historyPayload,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => t('agents.geminiEndpointErr'));
        setCopilotMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: errText, error: true } : m,
          ),
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const evt of events) {
          const line = evt
            .split('\n')
            .find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as {
              type: string;
              text?: string;
              name?: string;
              summary?: string;
              sources?: GeminiGroundingSource[];
              toolsUsed?: string[];
              message?: string;
            };
            if (payload.type === 'tool' && payload.name) {
              setCopilotActiveTools((prev) =>
                prev.includes(payload.name!) ? prev : [...prev, payload.name!],
              );
            } else if (payload.type === 'delta' && payload.text) {
              setCopilotMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, text: m.text + payload.text } : m,
                ),
              );
            } else if (payload.type === 'done') {
              setCopilotMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        sources: payload.sources ?? [],
                        toolsUsed: payload.toolsUsed ?? [],
                      }
                    : m,
                ),
              );
            } else if (payload.type === 'error') {
              setCopilotMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, text: payload.message || t('agents.geminiEndpointErr'), error: true }
                    : m,
                ),
              );
            }
          } catch {
            // ignore malformed SSE chunk
          }
        }
      }
    } catch {
      setCopilotMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: t('agents.geminiEndpointErr'), error: true }
            : m,
        ),
      );
    } finally {
      setCopilotStreaming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Multi-Agent Decision Pipeline & Gemini Synthesis Panel */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                {t('agents.engineTitle')}
              </h2>
              <p className="text-xs text-slate-400">
                {activeTicker
                  ? t('agents.syncedLabel', {
                      symbol: activeTicker.symbol,
                      exchange: activeTicker.exchange,
                      marketType: activeTicker.marketType,
                    })
                  : t('agents.defaultDesc')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onOpenGlobalSearch && (
                <button
                  type="button"
                  onClick={onOpenGlobalSearch}
                  aria-label={t('agents.searchAria')}
                  className="flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#070B12] px-3 text-xs font-medium text-cyan-300 hover:border-cyan-500/50 whitespace-nowrap"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>{t('agents.searchBtn')}</span>
                </button>
              )}
              <select
                value={activeSelectValue}
                onChange={(e) => {
                  const parsed = parsePairSelection(e.target.value);
                  if (parsed) {
                    onSelectSymbol(parsed.symbol, parsed.marketType, parsed.exchange);
                  }
                }}
                aria-label={t('agents.selectPairAria')}
                className="min-h-[42px] rounded-lg border border-slate-800 bg-[#070B12] px-3 text-xs text-slate-100"
              >
                {uniquePairTickers.map((tkr) => {
                  const val = serializePairSelection(tkr);
                  return (
                    <option key={val} value={val}>
                      {tkr.symbol} · {tkr.marketType} · {tkr.exchange}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                disabled={pipelineLoading || !activeTicker}
                onClick={() =>
                  activeTicker &&
                  onRunPipeline(
                    activeTicker.symbol,
                    activeTicker.marketType,
                    activeTicker.exchange,
                  )
                }
                className="flex min-h-[42px] items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                <span>
                  {pipelineLoading ? t('agents.runningPipeline') : t('agents.runPipeline')}
                </span>
              </button>
            </div>
          </div>

          {activeSignal ? (
            <div className="mt-4 space-y-3 border-t border-slate-800/80 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-display font-bold text-slate-100">
                    {activeSignal.symbol}
                  </span>
                  <span className="text-xs text-slate-400">
                    ({activeSignal.exchange} · {activeSignal.marketType})
                  </span>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span
                    className={`font-mono font-semibold ${
                      activeSignal.direction === 'LONG'
                        ? 'text-emerald-400'
                        : activeSignal.direction === 'SHORT'
                          ? 'text-rose-400'
                          : 'text-amber-400'
                    }`}
                  >
                    {activeSignal.direction}
                  </span>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-xs text-slate-400">{activeSignal.marketRegime}</span>
                </div>
                <span className="font-mono text-xs text-slate-300">
                  {t('agents.stateRisk', {
                    state: activeSignal.state,
                    decision: activeSignal.riskCheck.decision,
                  })}
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {activeSignal.reasoningSummary}
              </p>

              {activeSignal.conflictsDetected.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
                  {activeSignal.conflictsDetected.map((c, idx) => (
                    <p key={idx}>{c}</p>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {activeSignal.agentVotes.map((v) => (
                  <div
                    key={v.agentId}
                    className="rounded-lg border border-slate-800 bg-[#0A101B] p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-200">{v.agentName}</span>
                      <span
                        className={`font-mono font-semibold ${
                          v.stance === 'BULLISH'
                            ? 'text-emerald-400'
                            : v.stance === 'BEARISH'
                              ? 'text-rose-400'
                              : v.stance === 'VETO'
                                ? 'text-amber-400'
                                : 'text-slate-400'
                        }`}
                      >
                        {v.stance} ({v.score})
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{v.rationale}</p>
                  </div>
                ))}
              </div>

              {activeSignal.debateRounds && activeSignal.debateRounds.length > 0 && (
                <div className="space-y-2 border-t border-slate-800/80 pt-3">
                  <p className="text-xs font-semibold text-slate-200">
                    {t('agents.debateHeader', { count: activeSignal.debateRounds.length })}
                  </p>
                  <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                    {activeSignal.debateRounds.map((turn) => (
                      <div
                        key={turn.step}
                        className="rounded-lg border border-slate-800/80 bg-[#070B12] p-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="font-medium text-slate-100">
                            {turn.step}. {turn.speakerName}{' '}
                            <span className="text-slate-500">→ {turn.targetName}</span>
                          </span>
                          <span
                            className={`font-mono text-[10px] font-semibold ${
                              turn.phase === 'VETO'
                                ? 'text-rose-400'
                                : turn.phase === 'CHALLENGE'
                                  ? 'text-amber-400'
                                  : turn.phase === 'VERDICT'
                                    ? 'text-emerald-400'
                                    : 'text-cyan-400'
                            }`}
                          >
                            {turn.phase}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-300">{turn.argument}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500">{activeSignal.calibratedProbabilityNote}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2 rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center text-xs text-slate-400">
              <p>
                {activeTicker
                  ? t('agents.emptyForPair', {
                      symbol: activeTicker.symbol,
                      exchange: activeTicker.exchange,
                      marketType: activeTicker.marketType,
                    })
                  : t('agents.emptyNoPair')}
              </p>
              <p>
                {t('agents.emptyHintPrefix')}{' '}
                <strong className="text-cyan-300">{t('agents.runPipeline')}</strong>{' '}
                {t('agents.emptyHintSuffix')}
              </p>
              {latestAnySignal && (
                <button
                  type="button"
                  onClick={() =>
                    onSelectSymbol(
                      latestAnySignal.symbol,
                      latestAnySignal.marketType,
                      latestAnySignal.exchange,
                    )
                  }
                  className="pt-1 text-[11px] font-medium text-cyan-400 hover:text-cyan-300"
                >
                  {t('agents.jumpLatest', {
                    symbol: latestAnySignal.symbol,
                    exchange: latestAnySignal.exchange,
                  })}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Gemini 4 Hydrogen XHIGH + Decisions API + Streaming Quant Co-Pilot */}
        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                {t('agents.geminiTitle')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('agents.geminiDesc')}
              </p>
            </div>
            {geminiTab === 'synthesis' && (
              <button
                type="button"
                disabled={geminiLoading}
                onClick={handleGeminiSynthesize}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50 whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{geminiLoading ? t('agents.geminiRunning') : t('agents.geminiBtn')}</span>
              </button>
            )}
          </div>

          {/* Mode Tabs: XHIGH Synthesis + Decisions API | Streaming Quant Co-Pilot */}
          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg border border-slate-800 bg-[#070B12] p-1">
            <button
              type="button"
              onClick={() => setGeminiTab('synthesis')}
              className={`min-h-[34px] rounded-md px-2 text-xs font-medium transition-colors whitespace-nowrap ${
                geminiTab === 'synthesis'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {t('agents.mode.synthesis')}
            </button>
            <button
              type="button"
              onClick={() => setGeminiTab('copilot')}
              className={`min-h-[34px] rounded-md px-2 text-xs font-medium transition-colors whitespace-nowrap ${
                geminiTab === 'copilot'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {t('agents.mode.copilot')}
            </button>
          </div>

          {geminiTab === 'synthesis' ? (
            geminiResult ? (
              <div className="mt-4 space-y-3 border-t border-slate-800/80 pt-3 text-xs">
                {geminiResult.status !== 'OK' && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold">{geminiResult.status}</p>
                      <p className="mt-0.5 break-words text-amber-200/90">{geminiResult.errorMessage}</p>
                    </div>
                  </div>
                )}
                {geminiResult.status === 'OK' && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-slate-400">
                        {geminiResult.model}
                        {geminiResult.thinkingLevel ? ` · ${geminiResult.thinkingLevel}` : ''}
                      </span>
                      <span className="font-mono font-semibold text-cyan-400">
                        {geminiResult.recommendedAction}
                      </span>
                    </div>
                    <p className="text-slate-200 leading-relaxed">{geminiResult.executiveThesis}</p>
                    {geminiResult.regimeAssessment && (
                      <p className="text-slate-400">
                        {t('agents.geminiRegime', { regime: geminiResult.regimeAssessment })}
                      </p>
                    )}
                  </>
                )}

                    {/* Gemini Decisions API Calibrated Probability Gate */}
                    {geminiResult.decisionCalibration && (
                      <div className="rounded-lg border border-slate-800 bg-[#070B12] p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-semibold text-emerald-300">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>{t('agents.decisions.title')}</span>
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">
                            {geminiResult.decisionCalibration.model}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                          <div>
                            <span className="block font-sans text-[10px] text-slate-400">
                              {t('agents.decisions.winProb')}
                            </span>
                            <span className="text-sm font-semibold text-cyan-300">
                              {(geminiResult.decisionCalibration.winEdgeProbability * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="block font-sans text-[10px] text-slate-400">
                              {t('agents.decisions.liqSafety')}
                            </span>
                            <span className="text-sm font-semibold text-emerald-300">
                              {(geminiResult.decisionCalibration.liquiditySafetyProbability * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="block font-sans text-[10px] text-slate-400">
                              {t('agents.decisions.rubric')}
                            </span>
                            <span className="text-xs font-semibold text-slate-200">
                              {geminiResult.decisionCalibration.qualityRubricScore}/4 ({geminiResult.decisionCalibration.qualityRubricNormalizedPct}%)
                            </span>
                          </div>
                          <div>
                            <span className="block font-sans text-[10px] text-slate-400">
                              {t('agents.decisions.route')}
                            </span>
                            <span className="text-xs font-semibold text-amber-300">
                              {geminiResult.decisionCalibration.recommendedRoute}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Google Search Grounding Catalysts & Verified Links */}
                    {geminiResult.catalystBrief && (
                      <div className="rounded-lg border border-slate-800 bg-[#0A101B] p-3 space-y-2">
                        <div className="flex items-center gap-1.5 font-semibold text-cyan-300">
                          <Globe className="h-3.5 w-3.5" />
                          <span>{t('agents.grounding.title')}</span>
                        </div>
                        <p className="text-slate-300 leading-relaxed">
                          {geminiResult.catalystBrief}
                        </p>
                        {geminiResult.groundingSources && geminiResult.groundingSources.length > 0 && (
                          <div className="border-t border-slate-800/80 pt-2">
                            <p className="text-[10px] font-medium text-slate-400">
                              {t('agents.grounding.sourcesLabel')}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {geminiResult.groundingSources.map((src) => (
                                <a
                                  key={src.uri}
                                  href={src.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                                >
                                  <span className="max-w-[160px] truncate">{src.title}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {geminiResult.status === 'OK' &&
                      geminiResult.keyRisks &&
                      geminiResult.keyRisks.length > 0 && (
                        <ul className="list-disc space-y-1 pl-4 text-slate-400">
                          {geminiResult.keyRisks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-slate-800 bg-[#0A101B] p-4 text-xs text-slate-400">
                {t('agents.geminiPromptBefore')}{' '}
                <strong className="text-slate-200">{t('agents.geminiBtn')}</strong>{' '}
                {t('agents.geminiPromptMid')}{' '}
                <span className="font-mono text-slate-300">gemini-4-hydrogen (XHIGH) + gemini-decision-1</span>{' '}
                {t('agents.geminiPromptAfter')}{' '}
                <span className="font-semibold text-slate-200">
                  {activeTicker
                    ? `${activeTicker.symbol} (${activeTicker.exchange} · ${activeTicker.marketType})`
                    : '--'}
                </span>.
              </div>
            )
          ) : (
            /* Live Streaming Quant Co-Pilot with Hybrid Tool Calling + Search Grounding */
            <div className="mt-3 space-y-3 border-t border-slate-800/80 pt-3 text-xs">
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {copilotMessages.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-[#070B12] p-3 space-y-2 text-slate-400">
                    <p>
                      {t('agents.copilot.intro', {
                        symbol: activeTicker?.symbol ?? 'BTC/USDT',
                      })}
                    </p>
                    <div className="flex flex-col gap-1.5 pt-1">
                      <button
                        type="button"
                        disabled={!activeTicker || copilotStreaming}
                        onClick={() => handleCopilotSend(t('agents.copilot.quick1'))}
                        className="rounded-lg border border-slate-800 bg-[#0E1522] px-2.5 py-2 text-left text-[11px] text-cyan-300 hover:border-cyan-500/40"
                      >
                        {t('agents.copilot.quick1')}
                      </button>
                      <button
                        type="button"
                        disabled={!activeTicker || copilotStreaming}
                        onClick={() => handleCopilotSend(t('agents.copilot.quick2'))}
                        className="rounded-lg border border-slate-800 bg-[#0E1522] px-2.5 py-2 text-left text-[11px] text-cyan-300 hover:border-cyan-500/40"
                      >
                        {t('agents.copilot.quick2')}
                      </button>
                    </div>
                  </div>
                ) : (
                  copilotMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded-lg border p-2.5 ${
                        msg.role === 'user'
                          ? 'border-cyan-500/30 bg-cyan-500/10 text-slate-100'
                          : msg.error
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                            : 'border-slate-800 bg-[#070B12] text-slate-200'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {msg.text || (copilotStreaming ? '...' : '')}
                      </p>
                      {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 border-t border-slate-800/70 pt-1.5 font-mono text-[10px] text-cyan-300">
                          <Wrench className="h-3 w-3 shrink-0" />
                          <span>
                            {t('agents.copilot.toolsUsed')} {msg.toolsUsed.join(', ')}
                          </span>
                        </div>
                      )}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-2 border-t border-slate-800/70 pt-1.5">
                          {msg.sources.map((src) => (
                            <a
                              key={src.uri}
                              href={src.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 underline"
                            >
                              <span className="max-w-[140px] truncate">{src.title}</span>
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {copilotActiveTools.length > 0 && copilotStreaming && (
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-cyan-400">
                  <Wrench className="h-3 w-3" />
                  <span>{copilotActiveTools.join(' · ')}</span>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCopilotSend();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={copilotInput}
                  onChange={(e) => setCopilotInput(e.target.value)}
                  placeholder={t('agents.copilot.placeholder')}
                  disabled={!activeTicker || copilotStreaming}
                  className="min-h-[40px] flex-1 rounded-lg border border-slate-800 bg-[#070B12] px-3 text-xs text-slate-100 placeholder:text-slate-500"
                />
                <button
                  type="submit"
                  disabled={!activeTicker || copilotStreaming || !copilotInput.trim()}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 whitespace-nowrap"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>
                    {copilotStreaming ? t('agents.copilot.sendingBtn') : t('agents.copilot.sendBtn')}
                  </span>
                </button>
              </form>
              {copilotMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCopilotMessages([])}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  {t('agents.copilot.clearBtn')}
                </button>
              )}
            </div>
          )}

          {/* Recent Agent Logs */}
          <div className="mt-5 border-t border-slate-800/80 pt-3">
            <h3 className="text-xs font-semibold text-slate-300">{t('agents.logsTitle')}</h3>
            <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto font-mono text-[11px]">
              {agentLogs.length === 0 ? (
                <p className="text-slate-500">{t('agents.logsEmpty')}</p>
              ) : (
                agentLogs.slice(0, 10).map((l) => (
                  <div key={l.id} className="text-slate-400">
                    <span className="text-slate-500">{l.timestampUtc.slice(11, 19)}</span>{' '}
                    <span className="text-cyan-400">[{l.agentId}]</span> {l.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 19 AI Agents Registry Grid */}
      <section className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400" />
            <h2 className="font-display text-base font-semibold text-slate-100">
              {t('agents.listTitle', { count: agents.length })}
            </h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCatFilter(cat)}
                className={`min-h-[36px] rounded-lg px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${
                  catFilter === cat
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {t(AGENT_CATEGORY_KEYS[cat])}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.map((ag) => (
            <div
              key={ag.id}
              className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0A101B] p-3.5"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-100">
                      {ag.name}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {ag.category} · {ag.dataSource} · v{ag.version}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-xs font-semibold ${
                      ag.status === 'ONLINE'
                        ? 'text-emerald-400'
                        : ag.status === 'DISABLED' || ag.status === 'OFFLINE'
                          ? 'text-slate-500'
                          : 'text-amber-400'
                    }`}
                  >
                    {ag.status}
                  </span>
                </div>

                <p className="mt-2 text-xs text-slate-300">{ag.currentTask}</p>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-800/70 pt-2.5">
                <span className="font-mono text-[11px] tabular-nums text-slate-400">
                  {ag.latencyMs}ms · {t('agents.healthLabel')} {ag.healthPct}%
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAgentAction(ag.id, 'RESTART')}
                    aria-label={t('agents.restartAria', { name: ag.name })}
                    className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-cyan-300"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAgentAction(ag.id, ag.enabled ? 'DISABLE' : 'ENABLE')}
                    aria-label={
                      ag.enabled
                        ? t('agents.disableAria', { name: ag.name })
                        : t('agents.enableAria', { name: ag.name })
                    }
                    className={`flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 text-[11px] font-medium whitespace-nowrap ${
                      ag.enabled
                        ? 'border-slate-700 bg-slate-900 text-slate-300 hover:text-rose-300'
                        : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    <Power className="h-3 w-3" />
                    <span>{ag.enabled ? t('agents.disableBtn') : t('agents.enableBtn')}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
