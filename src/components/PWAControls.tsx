import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Info,
  Laptop,
  MoreVertical,
  PlusSquare,
  RefreshCw,
  Share,
  ShieldCheck,
  Smartphone,
  TabletSmartphone,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { PWAGuideTab } from '../pwa/pwaHelpers';
import { usePWA } from '../pwa/PWAContext';
import { useOnlineStatus } from '../pwa/useOnlineStatus';

interface PWAInstallControlProps {
  variant: 'sidebar' | 'drawer';
  onActionStart?: () => void;
}

export const PWAInstallControl: React.FC<PWAInstallControlProps> = ({
  variant,
  onActionStart,
}) => {
  const { t } = useI18n();
  const {
    isInstalled,
    canNativePrompt,
    swStatus,
    needRefresh,
    installing,
    dataSyncTransport,
    syncLatencyMs,
    syncingNow,
    openModal,
    install,
    applyUpdate,
    syncNow,
  } = usePWA();

  const syncTransportLabel =
    dataSyncTransport === 'WS_LIVE'
      ? t('pwa.syncWsLive')
      : dataSyncTransport === 'HTTP_FAST'
        ? t('pwa.syncHttpFast')
        : dataSyncTransport === 'OFFLINE_CACHED'
          ? t('pwa.syncOfflineCache')
          : t('pwa.diagSwSync');

  const syncTransportTone =
    dataSyncTransport === 'WS_LIVE'
      ? 'text-emerald-400'
      : dataSyncTransport === 'HTTP_FAST'
        ? 'text-cyan-300'
        : dataSyncTransport === 'OFFLINE_CACHED'
          ? 'text-amber-300'
          : 'text-slate-400';

  const handlePrimaryAction = async () => {
    if (needRefresh) {
      await applyUpdate();
      onActionStart?.();
      return;
    }
    if (canNativePrompt) {
      await install();
      onActionStart?.();
      return;
    }
    openModal();
    onActionStart?.();
  };

  const handleOpenGuide = () => {
    openModal();
    onActionStart?.();
  };

  const primaryLabel = needRefresh
    ? t('pwa.updateNowBtn')
    : canNativePrompt
      ? t('pwa.installNowBtn')
      : t('pwa.installGuideBtn');

  if (variant === 'sidebar') {
    return (
      <div
        data-testid="pwa-sidebar-card"
        className="mt-3 rounded-xl border border-slate-800/80 bg-[#0E1522] p-3 text-xs"
      >
        <div className="flex items-center gap-2.5">
          <img
            src="/pwa-192x192.png"
            alt="OMNISENT AI"
            className="h-8 w-8 shrink-0 rounded-lg border border-slate-700/80 object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-xs font-semibold text-slate-100">
              {isInstalled ? t('pwa.installedTitle') : t('pwa.cardTitle')}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {isInstalled ? t('pwa.installedSubtitle') : t('pwa.cardSubtitle')}
            </p>
          </div>
        </div>

        {needRefresh ? (
          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrimaryAction}
              data-testid="pwa-update-btn-sidebar"
              className="flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-2.5 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/25"
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('pwa.updateNowBtn')}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenGuide}
              aria-label={t('pwa.guideAria')}
              title={t('pwa.guideAria')}
              data-testid="pwa-guide-btn-sidebar"
              className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-slate-700/80 bg-[#070B12] text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : !isInstalled ? (
          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={installing}
              data-testid="pwa-install-btn-sidebar"
              className="flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/25 disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{primaryLabel}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenGuide}
              aria-label={t('pwa.guideAria')}
              title={t('pwa.guideAria')}
              data-testid="pwa-guide-btn-sidebar"
              className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-slate-700/80 bg-[#070B12] text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="mt-2.5 flex items-center justify-between gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300">
            <span className="flex min-w-0 items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('pwa.standaloneActive')}</span>
            </span>
            <button
              type="button"
              onClick={handleOpenGuide}
              aria-label={t('pwa.guideAria')}
              className="shrink-0 text-emerald-200/80 hover:text-emerald-100"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="mt-2 space-y-1 border-t border-slate-800/70 pt-2 text-[10px] text-slate-500">
          <div className="flex items-center justify-between">
            <span>{t('pwa.diagSw')}</span>
            <span
              className={`font-mono ${
                swStatus === 'UPDATE_AVAILABLE'
                  ? 'text-amber-300'
                  : swStatus === 'READY' || swStatus === 'OFFLINE_READY'
                    ? 'text-emerald-400'
                    : 'text-slate-400'
              }`}
            >
              {swStatus === 'UPDATE_AVAILABLE'
                ? t('pwa.diagSwUpdate')
                : swStatus === 'OFFLINE_READY'
                  ? t('pwa.diagSwOfflineReady')
                  : swStatus === 'READY'
                    ? t('pwa.diagSwReady')
                    : swStatus === 'UNSUPPORTED'
                      ? t('pwa.diagSwUnsupported')
                      : t('pwa.diagSwSync')}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1.5">
            <span className="shrink-0 whitespace-nowrap">{t('pwa.syncLabel')}</span>
            <span className={`truncate text-right font-mono tabular-nums ${syncTransportTone}`}>
              {dataSyncTransport === 'WS_LIVE'
                ? 'WS LIVE'
                : dataSyncTransport === 'HTTP_FAST'
                  ? 'HTTP'
                  : syncTransportLabel}
              {typeof syncLatencyMs === 'number' && syncLatencyMs > 0 ? ` · ${syncLatencyMs}ms` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={syncingNow}
            data-testid="pwa-sync-now-sidebar"
            className="mt-1 flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-[#070B12] px-2 text-[11px] font-medium text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-200 disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${syncingNow ? 'animate-spin text-cyan-300' : ''}`} />
            <span>{syncingNow ? t('pwa.syncingBtn') : t('pwa.syncNowBtn')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="pwa-drawer-card"
      className="rounded-xl border border-slate-800 bg-[#070B12] p-3"
    >
      <div className="flex items-center gap-3">
        <img
          src="/pwa-192x192.png"
          alt="OMNISENT AI"
          className="h-9 w-9 shrink-0 rounded-lg border border-slate-700 object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-slate-100">
            {isInstalled ? t('pwa.installedTitle') : t('pwa.cardTitle')}
          </p>
          <p className="text-xs text-slate-400">
            {isInstalled ? t('pwa.installedSubtitle') : t('pwa.cardSubtitle')}
          </p>
        </div>
      </div>

      {needRefresh ? (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={handlePrimaryAction}
            data-testid="pwa-update-btn-drawer"
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/25"
          >
            <RefreshCw className="h-4 w-4 shrink-0" />
            <span>{t('pwa.updateNowBtn')}</span>
          </button>
          <button
            type="button"
            onClick={handleOpenGuide}
            aria-label={t('pwa.guideAria')}
            data-testid="pwa-guide-btn-drawer"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-500/40"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      ) : !isInstalled ? (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={installing}
            data-testid="pwa-install-btn-drawer"
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/25 disabled:opacity-60"
          >
            <Download className="h-4 w-4 shrink-0" />
            <span>{primaryLabel}</span>
          </button>
          <button
            type="button"
            onClick={handleOpenGuide}
            aria-label={t('pwa.guideAria')}
            data-testid="pwa-guide-btn-drawer"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-500/40"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{t('pwa.standaloneActive')}</span>
          </span>
          <button
            type="button"
            onClick={handleOpenGuide}
            aria-label={t('pwa.guideAria')}
            className="text-emerald-200 hover:text-white"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5 text-[11px]">
        <div className="min-w-0">
          <span className="text-slate-400">{t('pwa.syncLabel')}: </span>
          <span className={`font-mono font-medium tabular-nums ${syncTransportTone}`}>
            {syncTransportLabel}
            {typeof syncLatencyMs === 'number' && syncLatencyMs > 0 ? ` · ${syncLatencyMs}ms` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={syncingNow}
          data-testid="pwa-sync-now-drawer"
          className="flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1522] px-2.5 text-[11px] font-semibold text-cyan-200 hover:border-cyan-500/40 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
          <span>{syncingNow ? t('pwa.syncingBtn') : t('pwa.syncNowBtn')}</span>
        </button>
      </div>
    </div>
  );
};

export const PWASmartBanner: React.FC = () => {
  const { t } = useI18n();
  const {
    isInstalled,
    needRefresh,
    showMobileBanner,
    canNativePrompt,
    installing,
    install,
    applyUpdate,
    openModal,
    dismissBanner,
  } = usePWA();

  if (isInstalled && needRefresh) {
    return (
      <div
        data-testid="pwa-standalone-update-banner"
        className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 shadow-sm lg:hidden"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <RefreshCw className="h-4 w-4 shrink-0 text-amber-300" />
          <p className="truncate text-xs font-medium text-amber-100">
            {t('pwa.standaloneUpdateMsg')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void applyUpdate()}
          data-testid="pwa-standalone-update-btn"
          className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-amber-400 px-3 text-[11px] font-semibold text-slate-950 hover:bg-amber-300"
        >
          <span>{t('pwa.updateNowBtn')}</span>
        </button>
      </div>
    );
  }

  if (!showMobileBanner) return null;

  return (
    <div
      data-testid="pwa-mobile-banner"
      className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-cyan-500/30 bg-[#0E1522] p-3 shadow-sm lg:hidden"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <img
          src="/pwa-192x192.png"
          alt="OMNISENT AI"
          className="h-9 w-9 shrink-0 rounded-lg border border-cyan-500/30 object-cover"
        />
        <div className="min-w-0">
          <p className="truncate font-display text-xs font-semibold text-slate-100">
            {t('pwa.bannerTitle')}
          </p>
          <p className="truncate text-[11px] text-slate-400">{t('pwa.bannerDesc')}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => (canNativePrompt ? void install() : openModal())}
          disabled={installing}
          data-testid="pwa-mobile-banner-install"
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-60"
        >
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span>{canNativePrompt ? t('pwa.installNowBtn') : t('pwa.installGuideBtn')}</span>
        </button>
        <button
          type="button"
          onClick={dismissBanner}
          aria-label={t('pwa.bannerDismissAria')}
          data-testid="pwa-mobile-banner-dismiss"
          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-800 bg-[#070B12] text-slate-400 hover:text-slate-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export const PWAInstallModal: React.FC = () => {
  const { t } = useI18n();
  const {
    isInstalled,
    displayMode,
    canNativePrompt,
    platform,
    uiState,
    swStatus,
    needRefresh,
    checkingUpdate,
    updateCheckResult,
    manifestAudit,
    isInIframe,
    installing,
    modalOpen,
    dataSyncTransport,
    syncLatencyMs,
    syncingNow,
    closeModal,
    install,
    checkForUpdate,
    applyUpdate,
    syncNow,
  } = usePWA();

  const [activeGuideTab, setActiveGuideTab] = useState<PWAGuideTab>(uiState.recommendedGuideTab);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    setActiveGuideTab(uiState.recommendedGuideTab);
  }, [uiState.recommendedGuideTab]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, closeModal]);

  if (!modalOpen) return null;

  const handleCopyUrl = async () => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard?.writeText(window.location.href);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const swStatusLabel =
    swStatus === 'UPDATE_AVAILABLE'
      ? t('pwa.diagSwUpdate')
      : swStatus === 'OFFLINE_READY'
        ? t('pwa.diagSwOfflineReady')
        : swStatus === 'READY'
          ? t('pwa.diagSwReady')
          : swStatus === 'UNSUPPORTED'
            ? t('pwa.diagSwUnsupported')
            : t('pwa.diagSwSync');

  const swStatusTone =
    swStatus === 'UPDATE_AVAILABLE'
      ? 'text-amber-300'
      : swStatus === 'READY' || swStatus === 'OFFLINE_READY'
        ? 'text-emerald-400'
        : swStatus === 'UNSUPPORTED' || swStatus === 'ERROR'
          ? 'text-rose-300'
          : 'text-cyan-400';

  const displayLabel =
    displayMode === 'window-controls-overlay'
      ? t('pwa.diagDisplayWco')
      : isInstalled
        ? t('pwa.diagShellVal')
        : t('pwa.diagDisplayBrowser');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-modal-title"
      data-testid="pwa-install-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700/80 bg-[#0E1522] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="OMNISENT AI"
              className="h-11 w-11 shrink-0 rounded-xl border border-cyan-500/30 object-cover"
            />
            <div>
              <h2 id="pwa-modal-title" className="font-display text-base font-semibold text-slate-50">
                {t('pwa.modalTitle')}
              </h2>
              <p className="text-xs text-slate-400">{t('pwa.modalSubtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label={t('pwa.closeAria')}
            data-testid="pwa-modal-close"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-800 bg-[#070B12] text-slate-400 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Live PWA Readiness Telemetry (Verified from runtime probes) */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-[#070B12] p-2.5">
            <p className="text-[10px] text-slate-400">{t('pwa.diagManifest')}</p>
            <p
              className={`mt-0.5 font-mono text-[11px] font-semibold ${
                manifestAudit.valid ? 'text-emerald-400' : 'text-amber-300'
              }`}
            >
              {manifestAudit.valid ? t('pwa.diagManifestVal') : t('pwa.diagManifestMissing')}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#070B12] p-2.5">
            <p className="text-[10px] text-slate-400">{t('pwa.diagSw')}</p>
            <p className={`mt-0.5 font-mono text-[11px] font-semibold ${swStatusTone}`}>
              {swStatusLabel}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#070B12] p-2.5">
            <p className="text-[10px] text-slate-400">{t('pwa.diagShell')}</p>
            <p
              className={`mt-0.5 font-mono text-[11px] font-semibold ${
                isInstalled ? 'text-emerald-400' : 'text-cyan-300'
              }`}
            >
              {displayLabel}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#070B12] p-2.5">
            <p className="text-[10px] text-slate-400">{t('pwa.syncLabel')}</p>
            <p
              className={`mt-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                dataSyncTransport === 'WS_LIVE'
                  ? 'text-emerald-400'
                  : dataSyncTransport === 'HTTP_FAST'
                    ? 'text-cyan-300'
                    : dataSyncTransport === 'OFFLINE_CACHED'
                      ? 'text-amber-300'
                      : 'text-slate-400'
              }`}
            >
              {dataSyncTransport === 'WS_LIVE'
                ? t('pwa.syncWsLive')
                : dataSyncTransport === 'HTTP_FAST'
                  ? t('pwa.syncHttpFast')
                  : dataSyncTransport === 'OFFLINE_CACHED'
                    ? t('pwa.syncOfflineCache')
                    : t('pwa.diagSwSync')}
              {typeof syncLatencyMs === 'number' && syncLatencyMs > 0 ? ` · ${syncLatencyMs}ms` : ''}
            </p>
          </div>
        </div>

        {/* New Service Worker Update CTA */}
        {needRefresh && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-200">{t('pwa.updateReadyTitle')}</p>
                <p className="mt-0.5 text-[11px] text-slate-300">{t('pwa.updateReadyDesc')}</p>
              </div>
              <button
                type="button"
                onClick={applyUpdate}
                data-testid="pwa-modal-apply-update"
                className="flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-300"
              >
                <RefreshCw className="h-4 w-4" />
                <span>{t('pwa.updateNowBtn')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Direct 1-Click Install CTA when Chromium native prompt is available */}
        {canNativePrompt && (
          <div className="mt-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-cyan-200">{t('pwa.nativeReadyTitle')}</p>
                <p className="mt-0.5 text-[11px] text-slate-300">{t('pwa.nativeReadyDesc')}</p>
              </div>
              <button
                type="button"
                onClick={install}
                disabled={installing}
                data-testid="pwa-modal-native-install"
                className="flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                <span>{t('pwa.installNowBtn')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Embedded Preview Frame Notice + Copy URL */}
        {isInIframe && !canNativePrompt && !isInstalled && (
          <div className="mt-4 rounded-xl border border-slate-700/80 bg-[#070B12] p-3">
            <p className="text-[11px] leading-relaxed text-slate-300">{t('pwa.iframeHint')}</p>
            <div className="mt-2.5 flex items-center justify-end">
              <button
                type="button"
                onClick={handleCopyUrl}
                data-testid="pwa-copy-url-btn"
                className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedUrl ? t('pwa.copiedUrlBtn') : t('pwa.copyUrlBtn')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Device Selector Tabs */}
        <div
          role="tablist"
          aria-label={t('pwa.deviceTabsAria')}
          className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-[#070B12] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeGuideTab === 'ios'}
            onClick={() => setActiveGuideTab('ios')}
            data-testid="pwa-tab-ios"
            className={`flex min-h-[38px] items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors sm:gap-1.5 sm:text-xs ${
              activeGuideTab === 'ios'
                ? 'border border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                : 'border border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <TabletSmartphone className="h-3.5 w-3.5 shrink-0" />
            <span>iOS / iPad</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeGuideTab === 'android'}
            onClick={() => setActiveGuideTab('android')}
            data-testid="pwa-tab-android"
            className={`flex min-h-[38px] items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors sm:gap-1.5 sm:text-xs ${
              activeGuideTab === 'android'
                ? 'border border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                : 'border border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5 shrink-0" />
            <span>Android</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeGuideTab === 'desktop'}
            onClick={() => setActiveGuideTab('desktop')}
            data-testid="pwa-tab-desktop"
            className={`flex min-h-[38px] items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors sm:gap-1.5 sm:text-xs ${
              activeGuideTab === 'desktop'
                ? 'border border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                : 'border border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Laptop className="h-3.5 w-3.5 shrink-0" />
            <span>Desktop</span>
          </button>
        </div>

        {/* Step-by-Step Instructions */}
        <div className="mt-3 space-y-2.5 rounded-xl border border-slate-800 bg-[#070B12] p-3.5 text-xs">
          {activeGuideTab === 'ios' && (
            <>
              {platform === 'ios-browser' && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                  {t('pwa.iosAltBrowserNote')}
                </p>
              )}
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10 font-mono text-[11px] font-semibold text-cyan-300">
                  1
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.iosStep1Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.iosStep1Desc')}</p>
                </div>
                <Share className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10 font-mono text-[11px] font-semibold text-cyan-300">
                  2
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.iosStep2Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.iosStep2Desc')}</p>
                </div>
                <PlusSquare className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 font-mono text-[11px] font-semibold text-emerald-300">
                  3
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.iosStep3Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.iosStep3Desc')}</p>
                </div>
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              </div>
            </>
          )}

          {activeGuideTab === 'android' && (
            <>
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10 font-mono text-[11px] font-semibold text-cyan-300">
                  1
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.androidStep1Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.androidStep1Desc')}</p>
                </div>
                <MoreVertical className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10 font-mono text-[11px] font-semibold text-cyan-300">
                  2
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.androidStep2Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.androidStep2Desc')}</p>
                </div>
                <Download className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 font-mono text-[11px] font-semibold text-emerald-300">
                  3
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.androidStep3Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.androidStep3Desc')}</p>
                </div>
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              </div>
            </>
          )}

          {activeGuideTab === 'desktop' && (
            <>
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10 font-mono text-[11px] font-semibold text-cyan-300">
                  1
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.desktopStep1Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.desktopStep1Desc')}</p>
                </div>
                <Download className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10 font-mono text-[11px] font-semibold text-cyan-300">
                  2
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.desktopStep2Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.desktopStep2Desc')}</p>
                </div>
                <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 font-mono text-[11px] font-semibold text-emerald-300">
                  3
                </span>
                <div className="flex-1 text-slate-200">
                  <span className="font-semibold text-slate-50">{t('pwa.desktopStep3Title')}</span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('pwa.desktopStep3Desc')}</p>
                </div>
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="min-w-0 flex-1">{t('pwa.securityFootNote')}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={syncingNow}
              data-testid="pwa-modal-sync-now-btn"
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
              <span>{syncingNow ? t('pwa.syncingBtn') : t('pwa.syncNowBtn')}</span>
            </button>
            <button
              type="button"
              onClick={() => void checkForUpdate()}
              disabled={checkingUpdate}
              data-testid="pwa-check-update-btn"
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#070B12] px-3 text-xs font-medium text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
              <span>
                {checkingUpdate
                  ? t('pwa.checkingUpdateBtn')
                  : updateCheckResult === 'up-to-date'
                    ? t('pwa.upToDateLabel')
                    : t('pwa.checkUpdateBtn')}
              </span>
            </button>
            <button
              type="button"
              onClick={closeModal}
              className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-900 px-4 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              {t('pwa.doneBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { t } = useI18n();
  const wasOfflineRef = useRef(false);
  const [restoredNotice, setRestoredNotice] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      setRestoredNotice(false);
      return;
    }
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setRestoredNotice(true);
      const timer = window.setTimeout(() => setRestoredNotice(false), 3500);
      return () => window.clearTimeout(timer);
    }
  }, [isOnline]);

  if (!isOnline) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="pwa-offline-indicator"
        className="fixed right-4 bottom-16 left-4 z-50 flex items-center gap-3 rounded-xl border border-amber-500/40 bg-[#0E1522]/95 px-3.5 py-2.5 shadow-xl sm:right-auto sm:max-w-sm lg:bottom-4"
      >
        <WifiOff className="h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-semibold text-amber-200">{t('pwa.offlineTitle')}</p>
          <p className="text-[11px] text-slate-300">{t('pwa.offlineDesc')}</p>
        </div>
      </div>
    );
  }

  if (restoredNotice) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="pwa-online-restored-indicator"
        className="fixed right-4 bottom-16 left-4 z-50 flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-[#0E1522]/95 px-3.5 py-2.5 shadow-xl sm:right-auto sm:max-w-sm lg:bottom-4"
      >
        <Wifi className="h-4 w-4 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-semibold text-emerald-200">{t('pwa.onlineRestoredTitle')}</p>
          <p className="text-[11px] text-slate-300">{t('pwa.onlineRestoredDesc')}</p>
        </div>
      </div>
    );
  }

  return null;
};
