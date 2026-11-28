export type PWAPlatform =
  | 'ios-safari'
  | 'ios-browser'
  | 'android-chromium'
  | 'desktop-chromium'
  | 'desktop-safari'
  | 'desktop-other';

export type PWAGuideTab = 'ios' | 'android' | 'desktop';

export type PWADisplayMode =
  | 'window-controls-overlay'
  | 'standalone'
  | 'fullscreen'
  | 'minimal-ui'
  | 'browser';

export type PWAServiceWorkerStatus =
  | 'UNSUPPORTED'
  | 'REGISTERING'
  | 'READY'
  | 'OFFLINE_READY'
  | 'UPDATE_AVAILABLE'
  | 'ERROR';

export interface PWAManifestAudit {
  checked: boolean;
  valid: boolean;
  has192: boolean;
  has512: boolean;
  hasMaskable: boolean;
  shortcutCount: number;
  display: string | null;
  issues: string[];
}

export const PWA_BANNER_DISMISS_STORAGE_KEY = 'omnisent_pwa_banner_dismissed_v1';

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

export function detectDisplayMode(checks: {
  wco?: boolean;
  standalone?: boolean;
  fullscreen?: boolean;
  minimalUi?: boolean;
  navigatorStandalone?: boolean;
  referrer?: string;
}): PWADisplayMode {
  if (checks.wco) return 'window-controls-overlay';
  if (
    checks.standalone ||
    checks.navigatorStandalone ||
    (typeof checks.referrer === 'string' && checks.referrer.startsWith('android-app://'))
  ) {
    return 'standalone';
  }
  if (checks.fullscreen) return 'fullscreen';
  if (checks.minimalUi) return 'minimal-ui';
  return 'browser';
}

export function isRunningStandalone(
  matchMediaStandalone: boolean,
  navigatorStandalone = false,
  extraInstalledMode = false,
): boolean {
  return Boolean(matchMediaStandalone || navigatorStandalone || extraInstalledMode);
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

export function shouldShowMobileInstallBanner(input: {
  isInstalled: boolean;
  dismissed: boolean;
  isEmbeddedIframe: boolean;
}): boolean {
  if (input.isInstalled || input.dismissed || input.isEmbeddedIframe) {
    return false;
  }
  return true;
}

export function validateManifestPayload(raw: unknown): PWAManifestAudit {
  if (!raw || typeof raw !== 'object') {
    return {
      checked: true,
      valid: false,
      has192: false,
      has512: false,
      hasMaskable: false,
      shortcutCount: 0,
      display: null,
      issues: ['INVALID_JSON'],
    };
  }

  const m = raw as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof m.name !== 'string' || !m.name.trim()) issues.push('MISSING_NAME');
  if (typeof m.short_name !== 'string' || m.short_name.trim().length === 0) {
    issues.push('MISSING_SHORT_NAME');
  } else if (m.short_name.trim().length > 12) {
    issues.push('SHORT_NAME_TOO_LONG');
  }
  if (m.start_url !== '/') issues.push('INVALID_START_URL');
  if (m.scope !== '/') issues.push('INVALID_SCOPE');
  if (typeof m.id !== 'string' || !m.id) issues.push('MISSING_ID');

  const display = typeof m.display === 'string' ? m.display : null;
  if (display !== 'standalone' && display !== 'fullscreen' && display !== 'minimal-ui') {
    issues.push('INVALID_DISPLAY');
  }

  const icons = Array.isArray(m.icons) ? (m.icons as Array<Record<string, unknown>>) : [];
  const has192 = icons.some(
    (ic) => String(ic.sizes || '').includes('192x192') && ic.type === 'image/png',
  );
  const has512 = icons.some(
    (ic) => String(ic.sizes || '').includes('512x512') && ic.type === 'image/png',
  );
  const hasMaskable = icons.some((ic) => {
    const purpose = String(ic.purpose || '');
    return purpose === 'maskable' && String(ic.sizes || '').includes('512x512');
  });
  const hasCombinedAnyMaskable = icons.some((ic) => {
    const purpose = String(ic.purpose || '');
    return purpose.includes('any') && purpose.includes('maskable');
  });

  if (!has192) issues.push('MISSING_192_PNG');
  if (!has512) issues.push('MISSING_512_PNG');
  if (!hasMaskable) issues.push('MISSING_MASKABLE_512');
  if (hasCombinedAnyMaskable) issues.push('COMBINED_ANY_MASKABLE');

  const shortcutCount = Array.isArray(m.shortcuts) ? m.shortcuts.length : 0;

  return {
    checked: true,
    valid: issues.length === 0,
    has192,
    has512,
    hasMaskable,
    shortcutCount,
    display,
    issues,
  };
}

export type PWADataSyncTransport = 'WS_LIVE' | 'HTTP_FAST' | 'OFFLINE_CACHED' | 'SYNCING';

export const PWA_DATA_SNAPSHOT_STORAGE_KEY = 'omnisent_pwa_snapshot_v1';
export const PWA_SYNC_EVENT_STORAGE_KEY = 'omnisent_pwa_sync_event_v1';
export const PWA_DATA_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PWASelectedPairSnapshot {
  symbol: string;
  marketType: 'SPOT' | 'PERPETUAL' | 'FUTURES' | 'MARGIN';
  exchange: string;
}

export interface PWATelemetrySnapshotPayload {
  v: 1;
  savedAtMs: number;
  stateRevision: number | null;
  ledgerEpoch?: string | null;
  tradingMode: string;
  serverUtc: string;
  tickers: unknown[];
  portfolio: Record<string, unknown>;
  positions: unknown[];
  selectedPair?: PWASelectedPairSnapshot;
  autoExecutionStatus?: Record<string, unknown> | null;
}

export function shouldRunCooldownSync(
  lastSyncMs: number,
  nowMs: number,
  cooldownMs: number,
): boolean {
  if (!Number.isFinite(lastSyncMs) || lastSyncMs <= 0) return true;
  if (!Number.isFinite(nowMs) || !Number.isFinite(cooldownMs) || cooldownMs <= 0) return true;
  return nowMs - lastSyncMs >= cooldownMs;
}

export function shouldAutoReloadOnSwControlChange(
  hadControllerBefore: boolean,
  alreadyReloadedInSession = false,
): boolean {
  return Boolean(hadControllerBefore && !alreadyReloadedInSession);
}

const SECRET_FIELD_NAMES = new Set([
  'apikey',
  'apisecret',
  'passphrase',
  'encryptedcredentials',
  'secret',
  'token',
]);

function stripSecretFields(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SECRET_FIELD_NAMES.has(key.toLowerCase())) continue;
    clean[key] = val;
  }
  return clean;
}

function sanitizeSelectedPair(raw: unknown): PWASelectedPairSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as Record<string, unknown>;
  const symbol = typeof candidate.symbol === 'string' ? candidate.symbol.trim() : '';
  const marketType =
    candidate.marketType === 'SPOT' ||
    candidate.marketType === 'PERPETUAL' ||
    candidate.marketType === 'FUTURES' ||
    candidate.marketType === 'MARGIN'
      ? candidate.marketType
      : null;
  const exchange = typeof candidate.exchange === 'string' ? candidate.exchange.trim() : '';
  if (!symbol || !marketType) return undefined;
  return { symbol, marketType, exchange };
}

function sanitizeAutoExecutionSnapshot(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  if (typeof src.engineRunning !== 'boolean' && typeof src.tradingMode !== 'string') {
    return undefined;
  }
  const clean = stripSecretFields(src);
  if (Array.isArray(clean.recentActivity)) {
    clean.recentActivity = clean.recentActivity.slice(0, 12);
  }
  if (Array.isArray(clean.pendingProposals)) {
    clean.pendingProposals = clean.pendingProposals.slice(0, 10);
  }
  return clean;
}

export function serializeTelemetrySnapshot(input: {
  nowMs?: number;
  stateRevision?: number | null;
  ledgerEpoch?: string | null;
  tradingMode: string;
  serverUtc: string;
  tickers: unknown[];
  portfolio: Record<string, unknown>;
  positions: unknown[];
  selectedPair?: PWASelectedPairSnapshot;
  autoExecutionStatus?: Record<string, unknown> | null;
}): string {
  const payload: PWATelemetrySnapshotPayload = {
    v: 1,
    savedAtMs: input.nowMs ?? Date.now(),
    stateRevision: typeof input.stateRevision === 'number' ? input.stateRevision : null,
    ledgerEpoch: typeof input.ledgerEpoch === 'string' ? input.ledgerEpoch : null,
    tradingMode: input.tradingMode,
    serverUtc: input.serverUtc,
    tickers: Array.isArray(input.tickers) ? input.tickers.slice(0, 60) : [],
    portfolio: stripSecretFields(input.portfolio),
    positions: Array.isArray(input.positions) ? input.positions.slice(0, 50) : [],
    selectedPair: sanitizeSelectedPair(input.selectedPair),
    autoExecutionStatus: sanitizeAutoExecutionSnapshot(input.autoExecutionStatus),
  };
  return JSON.stringify(payload);
}

export function parseTelemetrySnapshot(
  raw: string | null | undefined,
  nowMs = Date.now(),
  maxAgeMs = PWA_DATA_SNAPSHOT_MAX_AGE_MS,
): PWATelemetrySnapshotPayload | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PWATelemetrySnapshotPayload>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.v !== 1 ||
      typeof parsed.savedAtMs !== 'number' ||
      !Number.isFinite(parsed.savedAtMs) ||
      typeof parsed.tradingMode !== 'string' ||
      !Array.isArray(parsed.tickers) ||
      !parsed.portfolio ||
      typeof parsed.portfolio !== 'object' ||
      !Array.isArray(parsed.positions)
    ) {
      return null;
    }
    if (nowMs - parsed.savedAtMs > maxAgeMs || parsed.savedAtMs > nowMs + 60_000) {
      return null;
    }
    const hasPositivePrice = parsed.tickers.some(
      (t) =>
        t &&
        typeof t === 'object' &&
        typeof (t as { lastPrice?: unknown }).lastPrice === 'number' &&
        (t as { lastPrice: number }).lastPrice > 0,
    );
    if (!hasPositivePrice) {
      return null;
    }
    return {
      v: 1,
      savedAtMs: parsed.savedAtMs,
      stateRevision: typeof parsed.stateRevision === 'number' ? parsed.stateRevision : null,
      ledgerEpoch: typeof parsed.ledgerEpoch === 'string' ? parsed.ledgerEpoch : null,
      tradingMode: parsed.tradingMode,
      serverUtc: typeof parsed.serverUtc === 'string' ? parsed.serverUtc : '',
      tickers: parsed.tickers,
      portfolio: stripSecretFields(parsed.portfolio as Record<string, unknown>),
      positions: parsed.positions,
      selectedPair: sanitizeSelectedPair(parsed.selectedPair),
      autoExecutionStatus: sanitizeAutoExecutionSnapshot(parsed.autoExecutionStatus),
    };
  } catch {
    return null;
  }
}

