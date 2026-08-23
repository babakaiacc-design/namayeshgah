import type {
  CategoryNode,
  City,
  Exhibition,
  ExhibitionDetail,
  ExhibitionQuery,
  Paginated,
  Venue,
} from './types';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '');

/**
 * The free Render instance sleeps after fifteen minutes and takes roughly fifty
 * seconds to wake. A short timeout would turn every first visit of the day into
 * an error, so the budget is generous and the service worker serves the cached
 * copy meanwhile.
 */
const REQUEST_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ApiError(detail || response.statusText, response.status, url);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new ApiError('سرور پاسخ نداد', 0, url);
    }
    throw new ApiError((error as Error).message, 0, url);
  } finally {
    clearTimeout(timer);
  }
}

function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export const api = {
  exhibitions(query: ExhibitionQuery = {}) {
    return request<Paginated<Exhibition>>(`/exhibitions${toQueryString({ ...query })}`);
  },

  today(city = 'tehran', limit = 20) {
    return request<Paginated<Exhibition>>(
      `/exhibitions/today${toQueryString({ city, limit })}`,
    );
  },

  upcoming(days = 7, city = 'tehran', limit = 20) {
    return request<Paginated<Exhibition>>(
      `/exhibitions/upcoming${toQueryString({ days, city, limit })}`,
    );
  },

  onDate(date: string, city = 'tehran', limit = 50) {
    return request<Paginated<Exhibition>>(
      `/exhibitions/date/${date}${toQueryString({ city, limit })}`,
    );
  },

  exhibition(idOrSlug: string) {
    return request<ExhibitionDetail>(`/exhibitions/${encodeURIComponent(idOrSlug)}`);
  },

  categories(city?: string) {
    return request<CategoryNode[]>(`/categories${toQueryString({ city })}`);
  },

  venues(city?: string) {
    return request<Venue[]>(`/venues${toQueryString({ city })}`);
  },

  cities() {
    return request<City[]>('/cities');
  },

  authenticateDevice(deviceId: string, locale = 'fa', timezone = 'Asia/Tehran') {
    return request<{ accessToken: string; user: { id: string; tier: string } }>('/auth/device', {
      method: 'POST',
      body: JSON.stringify({ deviceId, locale, timezone }),
    });
  },
};
