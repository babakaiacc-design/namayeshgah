import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'exhibition-reminder:favorites';

/**
 * Favourites kept on the device.
 *
 * Deliberately local for now. The server already has the tables and the
 * anonymous device account, but the write endpoints land with the reminder
 * work; keeping the data in one well-known key means the sync can adopt it
 * later without the user losing anything they saved in the meantime.
 */
function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    // A corrupted or unavailable store must not break the page.
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private browsing on iOS can refuse writes; the UI stays usable.
  }
  window.dispatchEvent(new CustomEvent('favorites-changed'));
}

export function useFavorites() {
  const [ids, setIds] = useState<string[]>(read);

  useEffect(() => {
    const sync = () => setIds(read());
    // Both events matter: 'storage' covers another tab, the custom event
    // covers another component in this one.
    window.addEventListener('storage', sync);
    window.addEventListener('favorites-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('favorites-changed', sync);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    const current = read();
    const next = current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id];
    write(next);
    setIds(next);
  }, []);

  const isFavorite = useCallback((id: string) => ids.includes(id), [ids]);

  return { ids, toggle, isFavorite };
}
