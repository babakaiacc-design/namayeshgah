import { api, setAuthToken } from '../api/client';

const DEVICE_KEY = 'exhibition-reminder:device-id';
const TOKEN_KEY = 'exhibition-reminder:token';

/**
 * Anonymous device account.
 *
 * Browsing needs no account at all, so sign-in is deferred until the user does
 * something that belongs to them: setting a reminder or following something.
 * That keeps the first visit free of any identifier being created.
 *
 * The identifier is generated here and only ever leaves as an HMAC on the
 * server side, which never stores the raw value.
 */
function deviceId(): string {
  let id = safeGet(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    safeSet(DEVICE_KEY, id);
  }
  return id;
}

let inFlight: Promise<string> | null = null;

/**
 * Returns a usable token, signing in if needed.
 *
 * Concurrent callers share one request; without that, opening a page that both
 * loads reminders and loads favourites would create two sign-ins at once.
 */
export async function ensureSignedIn(): Promise<string> {
  const existing = safeGet(TOKEN_KEY);
  if (existing) {
    setAuthToken(existing);
    return existing;
  }

  if (!inFlight) {
    inFlight = api
      .authenticateDevice(deviceId(), 'fa', resolveTimezone())
      .then((result) => {
        safeSet(TOKEN_KEY, result.accessToken);
        setAuthToken(result.accessToken);
        return result.accessToken;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

/** Restores a stored token on boot so the first request is already authorised. */
export function restoreSession(): boolean {
  const token = safeGet(TOKEN_KEY);
  if (token) setAuthToken(token);
  return Boolean(token);
}

export function hasAccount(): boolean {
  return Boolean(safeGet(TOKEN_KEY));
}

/** Clears the token after the server rejects it, so the next call signs in again. */
export function clearSession(): void {
  safeRemove(TOKEN_KEY);
  setAuthToken(null);
}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tehran';
  } catch {
    return 'Asia/Tehran';
  }
}

// Private browsing on iOS can throw on any storage access, and a thrown
// exception here would take the whole page down.
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignored */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignored */
  }
}
