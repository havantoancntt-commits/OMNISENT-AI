export type PWAPlatform =
  | 'ios-safari'
  | 'ios-browser'
  | 'android-chromium'
  | 'desktop-chromium'
  | 'desktop-safari'
  | 'desktop-other';

export type PWAGuideTab = 'ios' | 'android' | 'desktop';

export const PWA_MANIFEST_META = {
  id: '/',
  name: 'OMNISENT AI — Autonomous Trading Intelligence',
  shortName: 'OMNISENT AI',
  themeColor: '#070B12',
  backgroundColor: '#070B12',
  startUrl: '/',
  scope: '/',
} as const;

export function detectPWAPlatform(userAgent: string, maxTouchPoints = 0): PWAPlatform {
  const ua = userAgent || '';

  const isIPhoneOrIPad =
    /iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  if (isIPhoneOrIPad) {
    const isAltIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    return isAltIosBrowser ? 'ios-browser' : 'ios-safari';
  }

  const isAndroid = /Android/i.test(ua);
  if (isAndroid) {
    return 'android-chromium';
  }

  const isChromium = /Chrome|Chromium|Edg\/|OPR\/|Brave/i.test(ua);
  if (isChromium) {
    return 'desktop-chromium';
  }

  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium/i.test(ua);
  if (isSafari) {
    return 'desktop-safari';
  }

  return 'desktop-other';
}

export function isRunningStandalone(
  matchMediaStandalone: boolean,
  navigatorStandalone = false,
): boolean {
  return Boolean(matchMediaStandalone || navigatorStandalone);
}

export function getRecommendedGuideTab(platform: PWAPlatform): PWAGuideTab {
  if (platform === 'ios-safari' || platform === 'ios-browser') {
    return 'ios';
  }
  if (platform === 'android-chromium') {
    return 'android';
  }
  return 'desktop';
}

export interface PWAUiStateInput {
  isInstalled: boolean;
  canNativePrompt: boolean;
  platform: PWAPlatform;
}

export interface PWAUiState {
  shouldShowInstallEntry: boolean;
  primaryAction: 'native-prompt' | 'guide-modal';
  recommendedGuideTab: PWAGuideTab;
}

export function computePWAUiState(input: PWAUiStateInput): PWAUiState {
  return {
    shouldShowInstallEntry: !input.isInstalled,
    primaryAction: input.canNativePrompt ? 'native-prompt' : 'guide-modal',
    recommendedGuideTab: getRecommendedGuideTab(input.platform),
  };
}
