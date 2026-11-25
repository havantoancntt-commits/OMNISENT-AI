import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  computePWAUiState,
  detectPWAPlatform,
  isRunningStandalone,
  type PWAPlatform,
  type PWAUiState,
} from './pwaHelpers';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface UsePWAInstallResult {
  isInstalled: boolean;
  canNativePrompt: boolean;
  platform: PWAPlatform;
  uiState: PWAUiState;
  swReady: boolean;
  installing: boolean;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

function readStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaMatch = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
  const navStandalone = Boolean(
    (window.navigator as Navigator & { standalone?: boolean }).standalone,
  );
  return isRunningStandalone(mediaMatch, navStandalone);
}

export function usePWAInstall(): UsePWAInstallResult {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(readStandalone);
  const [swReady, setSwReady] = useState<boolean>(false);
  const [installing, setInstalling] = useState<boolean>(false);
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  const platform = useMemo<PWAPlatform>(() => {
    if (typeof navigator === 'undefined') return 'desktop-other';
    return detectPWAPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayModeChange = () => {
      setIsInstalled(readStandalone());
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setModalOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery?.addEventListener?.('change', handleDisplayModeChange);

    if ('serviceWorker' in navigator) {
      if (navigator.serviceWorker.controller) {
        setSwReady(true);
      }
      navigator.serviceWorker.ready
        .then(() => setSwReady(true))
        .catch(() => {
          // Non-fatal in insecure or restricted environments
        });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery?.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) {
      setModalOpen(true);
      return 'unavailable';
    }
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setModalOpen(false);
      }
      setDeferredPrompt(null);
      return outcome;
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt]);

  const canNativePrompt = Boolean(deferredPrompt) && !isInstalled;

  const uiState = useMemo(
    () =>
      computePWAUiState({
        isInstalled,
        canNativePrompt,
        platform,
      }),
    [isInstalled, canNativePrompt, platform],
  );

  return {
    isInstalled,
    canNativePrompt,
    platform,
    uiState,
    swReady,
    installing,
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    install,
  };
}
