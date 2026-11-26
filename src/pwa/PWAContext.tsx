import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { registerSW } from 'virtual:pwa-register';
import {
  PWA_BANNER_DISMISS_STORAGE_KEY,
  computePWAUiState,
  detectDisplayMode,
  detectPWAPlatform,
  isRunningStandalone,
  shouldAutoReloadOnSwControlChange,
  shouldRunCooldownSync,
  shouldShowMobileInstallBanner,
  validateManifestPayload,
  type PWADataSyncTransport,
  type PWADisplayMode,
  type PWAManifestAudit,
  type PWAPlatform,
  type PWAServiceWorkerStatus,
  type PWAUiState,
} from './pwaHelpers';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PWABootstrapSnapshot {
  deferredPrompt: BeforeInstallPromptEvent | null;
  swStatus: PWAServiceWorkerStatus;
  needRefresh: boolean;
  offlineReady: boolean;
  registration: ServiceWorkerRegistration | null;
  installedViaEvent: boolean;
}

const DEFAULT_MANIFEST_AUDIT: PWAManifestAudit = {
  checked: false,
  valid: true,
  has192: true,
  has512: true,
  hasMaskable: true,
  shortcutCount: 3,
  display: 'standalone',
  issues: [],
};

const bootstrapState: PWABootstrapSnapshot = {
  deferredPrompt: null,
  swStatus:
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? 'REGISTERING'
      : 'UNSUPPORTED',
  needRefresh: false,
  offlineReady: false,
  registration: null,
  installedViaEvent: false,
};

let bootstrapInitialized = false;
let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
let lastVisibilityCheckMs = 0;
let swControllerReloaded = false;
const subscribers = new Set<() => void>();
const dataSyncHandlers = new Set<() => Promise<void> | void>();
let syncChannel: BroadcastChannel | null = null;

const SW_VISIBILITY_COOLDOWN_MS = 20_000;
const SW_RELOAD_GUARD_KEY = 'omnisent_sw_reloaded_ts';

function notifySubscribers() {
  for (const cb of subscribers) {
    cb();
  }
}

export function triggerRegisteredDataSyncHandlers(): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const handler of dataSyncHandlers) {
    try {
      tasks.push(Promise.resolve(handler()));
    } catch {
      // ignore handler failure
    }
  }
  return Promise.allSettled(tasks).then(() => undefined);
}

export function initPWABootstrapListeners(): void {
  if (bootstrapInitialized || typeof window === 'undefined') return;
  bootstrapInitialized = true;

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    bootstrapState.deferredPrompt = event as BeforeInstallPromptEvent;
    notifySubscribers();
  });

  window.addEventListener('appinstalled', () => {
    bootstrapState.installedViaEvent = true;
    bootstrapState.deferredPrompt = null;
    notifySubscribers();
  });

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      syncChannel = new BroadcastChannel('omnisent-pwa-sync-v1');
      syncChannel.addEventListener('message', (event: MessageEvent) => {
        const type = (event.data as { type?: string } | null)?.type;
        if (type === 'DATA_MUTATED' || type === 'FORCE_SYNC') {
          void triggerRegisteredDataSyncHandlers();
        }
      });
    } catch {
      syncChannel = null;
    }
  }

  if (!('serviceWorker' in navigator)) {
    bootstrapState.swStatus = 'UNSUPPORTED';
    notifySubscribers();
    return;
  }

  const hadControllerAtBoot = Boolean(navigator.serviceWorker.controller);
  if (hadControllerAtBoot) {
    bootstrapState.swStatus = 'READY';
  }

  // When a new autoUpdate Service Worker activates and takes control, cleanly refresh once
  // so installed PWAs never stay on mismatched chunks or stale manifests.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    bootstrapState.swStatus = 'READY';
    bootstrapState.needRefresh = false;
    notifySubscribers();
    try {
      const lastReloadTs = Number(window.sessionStorage.getItem(SW_RELOAD_GUARD_KEY) || 0);
      const recentlyReloaded = Number.isFinite(lastReloadTs) && Date.now() - lastReloadTs < 15_000;
      if (shouldAutoReloadOnSwControlChange(hadControllerAtBoot, swControllerReloaded || recentlyReloaded)) {
        swControllerReloaded = true;
        window.sessionStorage.setItem(SW_RELOAD_GUARD_KEY, String(Date.now()));
        window.location.reload();
      }
    } catch {
      // ignore sessionStorage restrictions
    }
  });

  try {
    updateSWFn = registerSW({
      immediate: true,
      onNeedRefresh() {
        bootstrapState.needRefresh = true;
        bootstrapState.swStatus = 'UPDATE_AVAILABLE';
        notifySubscribers();
      },
      onOfflineReady() {
        bootstrapState.offlineReady = true;
        if (!bootstrapState.needRefresh) {
          bootstrapState.swStatus = 'OFFLINE_READY';
        }
        notifySubscribers();
      },
      onRegisteredSW(_swUrl, registration) {
        if (registration) {
          bootstrapState.registration = registration;
          if (!bootstrapState.needRefresh && !bootstrapState.offlineReady) {
            bootstrapState.swStatus = 'READY';
          }
          notifySubscribers();

          const checkRegistrationUpdate = () => {
            if (!navigator.onLine || registration.installing) return;
            const now = Date.now();
            if (!shouldRunCooldownSync(lastVisibilityCheckMs, now, SW_VISIBILITY_COOLDOWN_MS)) return;
            lastVisibilityCheckMs = now;
            void registration.update().catch(() => {});
          };

          // Background check every 10 minutes
          window.setInterval(checkRegistrationUpdate, 10 * 60 * 1000);

          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              checkRegistrationUpdate();
            }
          });
          window.addEventListener('online', checkRegistrationUpdate);
          window.addEventListener('pageshow', (e) => {
            if (e.persisted) checkRegistrationUpdate();
          });
        }
      },
      onRegisterError() {
        bootstrapState.swStatus = 'ERROR';
        notifySubscribers();
      },
    });

    navigator.serviceWorker.ready
      .then((reg) => {
        bootstrapState.registration = reg;
        if (bootstrapState.swStatus === 'REGISTERING') {
          bootstrapState.swStatus = 'READY';
          notifySubscribers();
        }
      })
      .catch(() => {});
  } catch {
    bootstrapState.swStatus = 'ERROR';
    notifySubscribers();
  }
}

function readDisplayMode(): PWADisplayMode {
  if (typeof window === 'undefined') return 'browser';
  const mm = (query: string) => window.matchMedia?.(query)?.matches ?? false;
  const navStandalone = Boolean(
    (window.navigator as Navigator & { standalone?: boolean }).standalone,
  );
  return detectDisplayMode({
    wco: mm('(display-mode: window-controls-overlay)'),
    standalone: mm('(display-mode: standalone)'),
    fullscreen: mm('(display-mode: fullscreen)'),
    minimalUi: mm('(display-mode: minimal-ui)'),
    navigatorStandalone: navStandalone,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
  });
}

function readInitialBannerDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PWA_BANNER_DISMISS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface PWAContextValue {
  isInstalled: boolean;
  displayMode: PWADisplayMode;
  canNativePrompt: boolean;
  platform: PWAPlatform;
  uiState: PWAUiState;
  swReady: boolean;
  swStatus: PWAServiceWorkerStatus;
  needRefresh: boolean;
  offlineReady: boolean;
  checkingUpdate: boolean;
  updateCheckResult: 'idle' | 'up-to-date' | 'update-available' | 'unavailable';
  manifestAudit: PWAManifestAudit;
  isInIframe: boolean;
  installing: boolean;
  modalOpen: boolean;
  showMobileBanner: boolean;
  dataSyncTransport: PWADataSyncTransport;
  lastDataSyncAtMs: number | null;
  syncLatencyMs: number | null;
  syncingNow: boolean;
  dismissBanner: () => void;
  openModal: () => void;
  closeModal: () => void;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  checkForUpdate: () => Promise<'update-available' | 'up-to-date' | 'unavailable'>;
  applyUpdate: () => Promise<void>;
  syncNow: () => Promise<void>;
  registerDataSyncHandler: (fn: () => Promise<void> | void) => () => void;
  reportDataSync: (meta: {
    transport: PWADataSyncTransport;
    syncedAtMs?: number;
    latencyMs?: number | null;
  }) => void;
  broadcastSyncEvent: (type: 'DATA_MUTATED' | 'FORCE_SYNC') => void;
}

const DEFAULT_PWA_VALUE: PWAContextValue = {
  isInstalled: false,
  displayMode: 'browser',
  canNativePrompt: false,
  platform: 'desktop-other',
  uiState: {
    shouldShowInstallEntry: true,
    primaryAction: 'guide-modal',
    recommendedGuideTab: 'desktop',
  },
  swReady: false,
  swStatus: 'REGISTERING',
  needRefresh: false,
  offlineReady: false,
  checkingUpdate: false,
  updateCheckResult: 'idle',
  manifestAudit: DEFAULT_MANIFEST_AUDIT,
  isInIframe: false,
  installing: false,
  modalOpen: false,
  showMobileBanner: false,
  dataSyncTransport: 'SYNCING',
  lastDataSyncAtMs: null,
  syncLatencyMs: null,
  syncingNow: false,
  dismissBanner: () => {},
  openModal: () => {},
  closeModal: () => {},
  install: async () => 'unavailable',
  checkForUpdate: async () => 'unavailable',
  applyUpdate: async () => {},
  syncNow: async () => {},
  registerDataSyncHandler: () => () => {},
  reportDataSync: () => {},
  broadcastSyncEvent: () => {},
};

const PWAContext = createContext<PWAContextValue>(DEFAULT_PWA_VALUE);

export const PWAProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [snap, setSnap] = useState<PWABootstrapSnapshot>(() => ({ ...bootstrapState }));
  const [displayMode, setDisplayMode] = useState<PWADisplayMode>(() => readDisplayMode());
  const [manifestAudit, setManifestAudit] = useState<PWAManifestAudit>(DEFAULT_MANIFEST_AUDIT);
  const [installing, setInstalling] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(readInitialBannerDismissed);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<
    'idle' | 'up-to-date' | 'update-available' | 'unavailable'
  >('idle');
  const [dataSyncTransport, setDataSyncTransport] = useState<PWADataSyncTransport>('SYNCING');
  const [lastDataSyncAtMs, setLastDataSyncAtMs] = useState<number | null>(null);
  const [syncLatencyMs, setSyncLatencyMs] = useState<number | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);

  const platform = useMemo<PWAPlatform>(() => {
    if (typeof navigator === 'undefined') return 'desktop-other';
    return detectPWAPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  }, []);

  const isInIframe = useMemo<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);

  useEffect(() => {
    initPWABootstrapListeners();
    setSnap({ ...bootstrapState });

    const onUpdate = () => setSnap({ ...bootstrapState });
    subscribers.add(onUpdate);

    const mediaQueries = [
      '(display-mode: window-controls-overlay)',
      '(display-mode: standalone)',
      '(display-mode: fullscreen)',
      '(display-mode: minimal-ui)',
    ]
      .map((q) => window.matchMedia?.(q))
      .filter((mq): mq is MediaQueryList => Boolean(mq));

    const handleDisplayChange = () => setDisplayMode(readDisplayMode());
    for (const mq of mediaQueries) {
      mq.addEventListener?.('change', handleDisplayChange);
    }

    // Verify live Web App Manifest compliance
    fetch('/manifest.webmanifest', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          setManifestAudit({
            checked: true,
            valid: false,
            has192: false,
            has512: false,
            hasMaskable: false,
            shortcutCount: 0,
            display: null,
            issues: [`HTTP_${res.status}`],
          });
          return;
        }
        const json = await res.json();
        setManifestAudit(validateManifestPayload(json));
      })
      .catch(() => {
        setManifestAudit({
          checked: true,
          valid: false,
          has192: false,
          has512: false,
          hasMaskable: false,
          shortcutCount: 0,
          display: null,
          issues: ['FETCH_FAILED'],
        });
      });

    return () => {
      subscribers.delete(onUpdate);
      for (const mq of mediaQueries) {
        mq.removeEventListener?.('change', handleDisplayChange);
      }
    };
  }, []);

  const isInstalled = useMemo(() => {
    const mediaStandalone = displayMode === 'standalone';
    const navStandalone =
      typeof navigator !== 'undefined'
        ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        : false;
    const extraInstalled =
      snap.installedViaEvent ||
      displayMode === 'window-controls-overlay' ||
      displayMode === 'fullscreen' ||
      displayMode === 'minimal-ui';
    return isRunningStandalone(mediaStandalone, navStandalone, extraInstalled);
  }, [displayMode, snap.installedViaEvent]);

  const canNativePrompt = Boolean(snap.deferredPrompt) && !isInstalled;

  const uiState = useMemo(
    () =>
      computePWAUiState({
        isInstalled,
        canNativePrompt,
        platform,
      }),
    [isInstalled, canNativePrompt, platform],
  );

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const promptEvent = bootstrapState.deferredPrompt;
    if (!promptEvent) {
      setModalOpen(true);
      return 'unavailable';
    }
    setInstalling(true);
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        bootstrapState.installedViaEvent = true;
        setModalOpen(false);
      }
      bootstrapState.deferredPrompt = null;
      notifySubscribers();
      return outcome;
    } finally {
      setInstalling(false);
    }
  }, []);

  const checkForUpdate = useCallback(async (): Promise<
    'update-available' | 'up-to-date' | 'unavailable'
  > => {
    if (bootstrapState.needRefresh) {
      setUpdateCheckResult('update-available');
      return 'update-available';
    }
    const reg = bootstrapState.registration;
    if (!reg) {
      setUpdateCheckResult('unavailable');
      return 'unavailable';
    }
    setCheckingUpdate(true);
    try {
      await reg.update();
      const hasWaitingOrInstalling = Boolean(reg.waiting || reg.installing || bootstrapState.needRefresh);
      const outcome = hasWaitingOrInstalling ? 'update-available' : 'up-to-date';
      setUpdateCheckResult(outcome);
      return outcome;
    } catch {
      setUpdateCheckResult('unavailable');
      return 'unavailable';
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const applyUpdate = useCallback(async () => {
    if (updateSWFn) {
      await updateSWFn(true);
      return;
    }
    if (bootstrapState.registration?.waiting) {
      bootstrapState.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }, []);

  const registerDataSyncHandler = useCallback((fn: () => Promise<void> | void) => {
    dataSyncHandlers.add(fn);
    return () => {
      dataSyncHandlers.delete(fn);
    };
  }, []);

  const reportDataSync = useCallback(
    (meta: {
      transport: PWADataSyncTransport;
      syncedAtMs?: number;
      latencyMs?: number | null;
    }) => {
      setDataSyncTransport(meta.transport);
      if (typeof meta.syncedAtMs === 'number') {
        setLastDataSyncAtMs(meta.syncedAtMs);
      }
      if (meta.latencyMs !== undefined) {
        setSyncLatencyMs(meta.latencyMs);
      }
    },
    [],
  );

  const broadcastSyncEvent = useCallback((type: 'DATA_MUTATED' | 'FORCE_SYNC') => {
    try {
      syncChannel?.postMessage({ type, ts: Date.now() });
    } catch {
      // ignore closed channel
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingNow) return;
    setSyncingNow(true);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      await Promise.allSettled([
        checkForUpdate(),
        triggerRegisteredDataSyncHandlers(),
      ]);
      const elapsed = Math.max(
        1,
        Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
      );
      setLastDataSyncAtMs(Date.now());
      setSyncLatencyMs(elapsed);
      broadcastSyncEvent('FORCE_SYNC');
    } finally {
      setSyncingNow(false);
    }
  }, [syncingNow, checkForUpdate, broadcastSyncEvent]);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      window.localStorage.setItem(PWA_BANNER_DISMISS_STORAGE_KEY, '1');
    } catch {
      // ignore storage errors
    }
  }, []);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const swReady =
    snap.swStatus === 'READY' ||
    snap.swStatus === 'OFFLINE_READY' ||
    snap.swStatus === 'UPDATE_AVAILABLE';

  const showMobileBanner = shouldShowMobileInstallBanner({
    isInstalled,
    dismissed: bannerDismissed,
    isEmbeddedIframe: isInIframe,
  });

  const value = useMemo<PWAContextValue>(
    () => ({
      isInstalled,
      displayMode,
      canNativePrompt,
      platform,
      uiState,
      swReady,
      swStatus: snap.swStatus,
      needRefresh: snap.needRefresh,
      offlineReady: snap.offlineReady,
      checkingUpdate,
      updateCheckResult,
      manifestAudit,
      isInIframe,
      installing,
      modalOpen,
      showMobileBanner,
      dataSyncTransport,
      lastDataSyncAtMs,
      syncLatencyMs,
      syncingNow,
      dismissBanner,
      openModal,
      closeModal,
      install,
      checkForUpdate,
      applyUpdate,
      syncNow,
      registerDataSyncHandler,
      reportDataSync,
      broadcastSyncEvent,
    }),
    [
      isInstalled,
      displayMode,
      canNativePrompt,
      platform,
      uiState,
      swReady,
      snap.swStatus,
      snap.needRefresh,
      snap.offlineReady,
      checkingUpdate,
      updateCheckResult,
      manifestAudit,
      isInIframe,
      installing,
      modalOpen,
      showMobileBanner,
      dataSyncTransport,
      lastDataSyncAtMs,
      syncLatencyMs,
      syncingNow,
      dismissBanner,
      openModal,
      closeModal,
      install,
      checkForUpdate,
      applyUpdate,
      syncNow,
      registerDataSyncHandler,
      reportDataSync,
      broadcastSyncEvent,
    ],
  );

  return <PWAContext.Provider value={value}>{children}</PWAContext.Provider>;
};

export function usePWA(): PWAContextValue {
  return useContext(PWAContext);
}
