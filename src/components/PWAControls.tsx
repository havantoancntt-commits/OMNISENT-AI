import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Info,
  Laptop,
  MoreVertical,
  PlusSquare,
  Share,
  ShieldCheck,
  Smartphone,
  TabletSmartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { PWAGuideTab } from '../pwa/pwaHelpers';
import { useOnlineStatus } from '../pwa/useOnlineStatus';
import { usePWAInstall } from '../pwa/usePWAInstall';

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
    platform,
    uiState,
    swReady,
    installing,
    modalOpen,
    openModal,
    closeModal,
    install,
  } = usePWAInstall();

  const [activeGuideTab, setActiveGuideTab] = useState<PWAGuideTab>(uiState.recommendedGuideTab);

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

  const handlePrimaryAction = async () => {
    if (canNativePrompt) {
      await install();
      onActionStart?.();
      return;
    }
    openModal();
  };

  const handleOpenGuide = () => {
    openModal();
  };

  return (
    <>
      {variant === 'sidebar' && (
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

          {!isInstalled ? (
            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={installing}
                data-testid="pwa-install-btn-sidebar"
                className="flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/25 disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {canNativePrompt ? t('pwa.installNowBtn') : t('pwa.installGuideBtn')}
                </span>
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
            <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('pwa.standaloneActive')}</span>
            </div>
          )}
        </div>
      )}

      {variant === 'drawer' && (
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

          {!isInstalled ? (
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={installing}
                data-testid="pwa-install-btn-drawer"
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/25 disabled:opacity-60"
              >
                <Download className="h-4 w-4 shrink-0" />
                <span>{canNativePrompt ? t('pwa.installNowBtn') : t('pwa.installGuideBtn')}</span>
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
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{t('pwa.standaloneActive')}</span>
            </div>
          )}
        </div>
      )}

      {/* Cross-Device Institutional PWA Installation Guide Modal */}
      {modalOpen && (
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

            {/* Live PWA Readiness Telemetry */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-slate-800 bg-[#070B12] p-2.5">
                <p className="text-[10px] text-slate-400">{t('pwa.diagManifest')}</p>
                <p className="mt-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                  {t('pwa.diagManifestVal')}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#070B12] p-2.5">
                <p className="text-[10px] text-slate-400">{t('pwa.diagSw')}</p>
                <p
                  className={`mt-0.5 font-mono text-[11px] font-semibold ${
                    swReady ? 'text-emerald-400' : 'text-cyan-400'
                  }`}
                >
                  {swReady ? t('pwa.diagSwReady') : t('pwa.diagSwSync')}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#070B12] p-2.5">
                <p className="text-[10px] text-slate-400">{t('pwa.diagShell')}</p>
                <p className="mt-0.5 font-mono text-[11px] font-semibold text-cyan-300">
                  {t('pwa.diagShellVal')}
                </p>
              </div>
            </div>

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

            <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>{t('pwa.securityFootNote')}</span>
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
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { t } = useI18n();

  if (isOnline) return null;

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
};
