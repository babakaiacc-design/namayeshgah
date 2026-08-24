import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { api } from '../api/client';
import type { Favorite } from '../api/types';
import { ensureSignedIn, hasAccount } from './auth';

const LEGACY_KEY = 'exhibition-reminder:favorites';

/**
 * Favourites, held on the server against the anonymous device account.
 *
 * An earlier build kept them in localStorage. Those entries are migrated on
 * first use rather than abandoned, so nobody loses what they saved before the
 * endpoints existed.
 */
export function useFavorites() {
  const queryClient = useQueryClient();
  const migrated = useRef(false);

  const query = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      await ensureSignedIn();
      return api.favorites();
    },
    // Signing in just to read an empty list would create an account for a
    // visitor who has not asked for one.
    enabled: hasAccount(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (migrated.current || !query.data) return;
    migrated.current = true;
    void migrateLegacy(query.data, queryClient);
  }, [query.data, queryClient]);

  const add = useMutation({
    mutationFn: async (exhibitionId: string) => {
      await ensureSignedIn();
      return api.addFavorite({ exhibitionId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  });

  const remove = useMutation({
    mutationFn: async (favoriteId: string) => {
      await ensureSignedIn();
      return api.removeFavorite(favoriteId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  });

  const favorites = query.data ?? [];

  const findFor = (exhibitionId: string): Favorite | undefined =>
    favorites.find((favorite) => favorite.exhibitionId === exhibitionId);

  return {
    favorites,
    isLoading: query.isLoading,
    isFavorite: (exhibitionId: string) => Boolean(findFor(exhibitionId)),
    isPending: add.isPending || remove.isPending,
    toggle: async (exhibitionId: string) => {
      const existing = findFor(exhibitionId);
      if (existing) await remove.mutateAsync(existing.id);
      else await add.mutateAsync(exhibitionId);
    },
  };
}

async function migrateLegacy(
  current: Favorite[],
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  let legacy: string[] = [];
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    legacy = Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return;
  }

  const known = new Set(current.map((favorite) => favorite.exhibitionId));
  const pending = legacy.filter((id) => !known.has(id));

  for (const exhibitionId of pending) {
    try {
      await api.addFavorite({ exhibitionId });
    } catch {
      // An exhibition that has since been merged away is simply dropped; one
      // stale id must not stop the rest migrating.
    }
  }

  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignored */
  }

  if (pending.length > 0) {
    await queryClient.invalidateQueries({ queryKey: ['favorites'] });
  }
}
