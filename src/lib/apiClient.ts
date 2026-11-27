// In-memory-only API authentication & fetch wrapper.
// SECURITY INVARIANT: Auth / session / Bearer tokens MUST NEVER be persisted to
// localStorage, sessionStorage, IndexedDB, or non-HttpOnly cookies.

export interface AuthSessionState {
  token: string | null;
  actor: string | null;
  role: string | null;
  expiresAtUtc: string | null;
}

export interface AuthRequiredEventDetail {
  endpoint: string;
  status: number;
  message?: string;
}

let memorySession: AuthSessionState = {
  token: null,
  actor: null,
  role: null,
  expiresAtUtc: null,
};

const authListeners = new Set<(session: AuthSessionState) => void>();
const authRequiredListeners = new Set<(detail: AuthRequiredEventDetail) => void>();

export function getAuthToken(): string | null {
  return memorySession.token;
}

export function getAuthSession(): AuthSessionState {
  return { ...memorySession };
}

export function setAuthSession(next: {
  token: string;
  actor?: string | null;
  role?: string | null;
  expiresAtUtc?: string | null;
}): void {
  const clean = next.token.trim();
  memorySession = {
    token: clean.length > 0 ? clean : null,
    actor: next.actor ?? null,
    role: next.role ?? null,
    expiresAtUtc: next.expiresAtUtc ?? null,
  };
  for (const listener of authListeners) {
    try {
      listener(getAuthSession());
    } catch {
      // ignore listener errors
    }
  }
}

export function clearAuthSession(): void {
  memorySession = {
    token: null,
    actor: null,
    role: null,
    expiresAtUtc: null,
  };
  for (const listener of authListeners) {
    try {
      listener(getAuthSession());
    } catch {
      // ignore
    }
  }
}

export function subscribeAuthSession(
  listener: (session: AuthSessionState) => void,
): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

export function subscribeAuthRequired(
  listener: (detail: AuthRequiredEventDetail) => void,
): () => void {
  authRequiredListeners.add(listener);
  return () => {
    authRequiredListeners.delete(listener);
  };
}

export function buildAuthenticatedWsUrl(baseWsUrl: string): string {
  const token = memorySession.token;
  if (!token) return baseWsUrl;
  const separator = baseWsUrl.includes('?') ? '&' : '?';
  return `${baseWsUrl}${separator}token=${encodeURIComponent(token)}`;
}

export async function apiFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = memorySession.token;
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(input, {
    ...init,
    cache: init.cache ?? 'no-store',
    headers,
  });

  const urlStr = typeof input === 'string' ? input : input.toString();
  if (response.status === 401 && !urlStr.startsWith('/api/auth/')) {
    let message: string | undefined;
    try {
      const cloned = response.clone();
      const body = (await cloned.json()) as { error?: string };
      message = body?.error;
    } catch {
      // ignore parse failures
    }
    for (const listener of authRequiredListeners) {
      try {
        listener({ endpoint: urlStr, status: 401, message });
      } catch {
        // ignore
      }
    }
  }

  return response;
}
