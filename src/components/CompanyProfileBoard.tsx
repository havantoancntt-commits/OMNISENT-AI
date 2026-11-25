import React, { useState } from 'react';
import {
  ArrowUpRight,
  Award,
  Building2,
  CheckCircle2,
  Compass,
  Cpu,
  FileText,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  computeLiveDivisionCount,
  getCompanyCharterRules,
  getCompanyDivisions,
  getCompanyPillars,
  getCompanyProfile,
  getCompanySpecifications,
} from '../data/companyProfile';
import type { AgentState, TradingMode } from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

type CompanyBoardTab = 'overview' | 'philosophy' | 'committee';

interface CompanyProfileBoardProps {
  agents: AgentState[];
  tradingMode: TradingMode;
  onNavigate?: (tab: string) => void;
  onOpenDossier?: () => void;
}

export const CompanyProfileBoard: React.FC<CompanyProfileBoardProps> = ({
  agents,
  tradingMode,
  onNavigate,
  onOpenDossier,
}) => {
  const { locale, t } = useI18n();
  const [activeTab, setActiveTab] = useState<CompanyBoardTab>('overview');
  const [dossierOpen, setDossierOpen] = useState(false);

  const profile = getCompanyProfile(locale);
  const specifications = getCompanySpecifications(locale);
  const pillars = getCompanyPillars(locale);
  const divisions = getCompanyDivisions(locale);
  const charterRules = getCompanyCharterRules(locale);

  const liveAgents = computeLiveDivisionCount(agents);
  const totalAgents = agents.length || 19;

  const handleOpenFull = () => {
    if (onOpenDossier) {
      onOpenDossier();
    } else {
      setDossierOpen(true);
    }
  };

  return (
    <>
      <section
        aria-label={t('corp.ariaBoard')}
        data-testid="company-profile-board"
        className="overflow-hidden rounded-xl border border-amber-400/20 bg-[#0E1522]"
      >
        {/* Subtle Champagne-Gold Top Hairline Accent */}
        <div className="h-[2px] w-full bg-gradient-to-r from-amber-400/70 via-cyan-400/60 to-transparent" />

        {/* Executive Masthead Row */}
        <div className="flex flex-col gap-4 border-b border-slate-800/80 px-5 py-5 lg:flex-row lg:items-end lg:justify-between lg:px-6">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-300/90">
              <span className="font-medium">{t('corp.badge')}</span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-400">{profile.domainClassification}</span>
              <span className="text-slate-600 hidden sm:inline" aria-hidden="true">·</span>
              <span className="hidden font-mono text-slate-400 sm:inline">{tradingMode}</span>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
                {profile.companyName}
              </h2>
              <span className="font-mono text-xs text-cyan-400">
                {profile.platformName}
              </span>
            </div>

            <p className="max-w-3xl text-sm leading-relaxed text-slate-300">
              {profile.executiveThesis}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('workspace3d')}
                className="flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#090F1A] px-3.5 py-2 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
              >
                <span>{t('corp.room3dBtn')}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenFull}
              className="flex min-h-[42px] items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 px-4 py-2 text-xs font-semibold text-amber-200 whitespace-nowrap shrink-0 transition-colors hover:bg-amber-400/25"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>{t('corp.dossierBtn')}</span>
            </button>
          </div>
        </div>

        {/* Institutional Specifications Strip (Clean 4-column Hairline Grid — No Nested Cards) */}
        <div className="grid grid-cols-2 divide-y divide-slate-800/70 border-b border-slate-800/80 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {specifications.map((spec, idx) => (
            <div key={spec.label} className="px-5 py-3.5 lg:px-6">
              <p className="text-[11px] text-slate-400">{spec.label}</p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-50 sm:text-xl">
                {idx === 0 ? `${liveAgents}/${totalAgents}` : spec.value}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">{spec.note}</p>
            </div>
          ))}
        </div>

        {/* Interactive Board Section Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0B111D]/70 px-5 py-2.5 lg:px-6">
          <div
            role="tablist"
            aria-label={t('corp.tabsAria')}
            className="flex flex-wrap items-center gap-1.5"
          >
            {(
              [
                { id: 'overview', label: t('corp.tab.overview') },
                { id: 'philosophy', label: t('corp.tab.philosophy') },
                { id: 'committee', label: t('corp.tab.committee') },
              ] as Array<{ id: CompanyBoardTab; label: string }>
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-amber-400/15 text-amber-200 border border-amber-400/30'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="hidden items-center gap-2 text-xs text-slate-400 md:flex">
            <Mail className="h-3.5 w-3.5 text-amber-300/80" />
            <span className="font-mono">{profile.contactEmail}</span>
          </div>
        </div>

        {/* Tab Content Panel */}
        <div className="p-5 lg:p-6">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 divide-y divide-slate-800/70 md:grid-cols-3 md:divide-x md:divide-y-0">
              {pillars.map((pillar, idx) => (
                <div
                  key={pillar.index}
                  className={`${
                    idx === 0
                      ? 'pb-4 md:pb-0 md:pr-6'
                      : idx === 1
                        ? 'py-4 md:py-0 md:px-6'
                        : 'pt-4 md:pt-0 md:pl-6'
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-semibold text-amber-300">
                      {pillar.index}.
                    </span>
                    <h3 className="font-display text-sm font-semibold text-slate-100">
                      {pillar.title}
                    </h3>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {pillar.summary}
                  </p>
                  <p className="mt-3 font-mono text-[11px] text-cyan-400">
                    {pillar.mechanism}
                  </p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'philosophy' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-5">
                <p className="text-xs font-medium text-amber-300">
                  {t('corp.philosophy.tag')}
                </p>
                <h3 className="font-display text-lg font-semibold text-slate-50">
                  {t('corp.philosophy.headline')}
                </h3>
                <p className="text-xs leading-relaxed text-slate-300">
                  {profile.governanceStatement}
                </p>
                <p className="pt-1 font-mono text-[11px] text-slate-400">
                  {profile.operationalStandard}
                </p>
              </div>

              <div className="divide-y divide-slate-800/70 lg:col-span-7">
                {charterRules.map((rule) => (
                  <div
                    key={rule.label}
                    className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-100">{rule.label}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">{rule.detail}</p>
                    </div>
                    <span
                      className={`font-mono text-xs font-semibold whitespace-nowrap shrink-0 ${
                        rule.enforced ? 'text-emerald-400' : 'text-amber-300'
                      }`}
                    >
                      {rule.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'committee' && (
            <div className="grid grid-cols-1 divide-y divide-slate-800/70 md:grid-cols-2 md:divide-x md:divide-y-0">
              {divisions.map((div, idx) => (
                <div
                  key={div.id}
                  className={`py-4 ${
                    idx < 2 ? 'md:border-b md:border-slate-800/70 md:pt-0' : 'md:pb-0'
                  } ${idx % 2 === 0 ? 'md:pr-6' : 'md:pl-6'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-sm font-semibold text-slate-100">
                      {div.code}. {div.title}
                    </h3>
                    <span className="font-mono text-xs font-semibold tabular-nums text-cyan-400 whitespace-nowrap shrink-0">
                      {t('corp.unitsRobot', { count: div.agentCount })}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {div.mandate}
                  </p>
                  <p className="mt-2.5 text-[11px] text-slate-300">
                    {div.keyUnits.join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Executive Footer Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-[#0A101B] px-5 py-3 text-xs text-slate-400 lg:px-6">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-slate-200">{profile.chairmanTitle}</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="font-mono text-slate-400">{profile.contactEmail}</span>
          </div>
          {onNavigate && (
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('agents')}
                className="min-h-[36px] text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:underline underline-offset-4 whitespace-nowrap"
              >
                {t('corp.footer.viewAgents')}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('portfolio')}
                className="min-h-[36px] text-xs font-medium text-slate-300 hover:text-slate-100 hover:underline underline-offset-4 whitespace-nowrap"
              >
                {t('corp.footer.riskMgmt')}
              </button>
            </div>
          )}
        </div>
      </section>

      {dossierOpen && (
        <CompanyDossierModal
          agents={agents}
          tradingMode={tradingMode}
          onClose={() => setDossierOpen(false)}
          onNavigate={onNavigate}
        />
      )}
    </>
  );
};

interface CompanyDossierModalProps {
  agents: AgentState[];
  tradingMode: TradingMode;
  onClose: () => void;
  onNavigate?: (tab: string) => void;
}

export const CompanyDossierModal: React.FC<CompanyDossierModalProps> = ({
  agents,
  tradingMode,
  onClose,
  onNavigate,
}) => {
  const { locale, t } = useI18n();
  const profile = getCompanyProfile(locale);
  const specifications = getCompanySpecifications(locale);
  const divisions = getCompanyDivisions(locale);
  const charterRules = getCompanyCharterRules(locale);

  const liveAgents = computeLiveDivisionCount(agents);
  const totalAgents = agents.length || 19;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-dossier-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6"
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-amber-400/30 bg-[#0B111D] shadow-2xl">
        <div className="h-[2px] w-full bg-gradient-to-r from-amber-400 via-cyan-400 to-emerald-400" />

        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-amber-300">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span>{t('corp.modal.officialLabel')}</span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="font-mono text-cyan-400">{tradingMode}</span>
            </div>
            <h2
              id="company-dossier-title"
              className="mt-1 font-display text-xl font-bold text-slate-50 sm:text-2xl"
            >
              {profile.companyName}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {profile.platformName} · {profile.contactEmail}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('corp.modal.closeAria')}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {/* Executive Summary */}
          <div className="space-y-1.5 border-b border-slate-800/80 pb-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <Award className="h-4 w-4" />
              <span>{t('corp.modal.manifestTitle')}</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-200">
              {profile.executiveThesis}
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              {profile.governanceStatement}
            </p>
          </div>

          {/* 4-column Specifications */}
          <div className="grid grid-cols-2 gap-3 border-b border-slate-800/80 pb-3.5 sm:grid-cols-4">
            {specifications.map((spec, idx) => (
              <div key={spec.label}>
                <p className="text-[11px] text-slate-400">{spec.label}</p>
                <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-50 sm:text-lg">
                  {idx === 0 ? `${liveAgents}/${totalAgents}` : spec.value}
                </p>
                <p className="text-[11px] text-slate-500">{spec.note}</p>
              </div>
            ))}
          </div>

          {/* 4 AI Divisions */}
          <div className="space-y-2.5 border-b border-slate-800/80 pb-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400">
              <Cpu className="h-4 w-4" />
              <span>{t('corp.modal.archTitle')}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {divisions.map((div) => (
                <div key={div.id} className="border-t border-slate-800/60 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-100">
                      {div.code}. {div.title}
                    </span>
                    <span className="font-mono text-cyan-400">
                      {t('corp.unitsAgents', { count: div.agentCount })}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">{div.mandate}</p>
                  <p className="mt-1 text-[11px] text-slate-300">{div.keyUnits.join(' · ')}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Risk Governance Charter */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              <span>{t('corp.modal.charterTitle')}</span>
            </div>
            <div className="divide-y divide-slate-800/70">
              {charterRules.map((rule) => (
                <div
                  key={rule.label}
                  className="flex items-center justify-between gap-4 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2 text-slate-200">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>{rule.label}</span>
                  </div>
                  <span className="font-mono font-semibold text-emerald-400 whitespace-nowrap">
                    {rule.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col gap-2 border-t border-slate-800 bg-[#080D17] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Compass className="h-3.5 w-3.5 text-amber-300" />
            <span>{profile.chairmanTitle}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onNavigate && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigate('workspace3d');
                }}
                className="min-h-[42px] rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25"
              >
                {t('corp.modal.enter3dBtn')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] rounded-lg bg-amber-400 px-4 text-xs font-bold text-slate-950 hover:bg-amber-300"
            >
              {t('corp.modal.closeBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
