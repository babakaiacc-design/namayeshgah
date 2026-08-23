import { useEffect, useState } from 'react';

/**
 * Tracks connectivity so the UI can say it is showing cached data.
 *
 * navigator.onLine only knows whether a network interface exists, not whether
 * the API is reachable, so this is used purely to explain stale content and
 * never to block a request.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
