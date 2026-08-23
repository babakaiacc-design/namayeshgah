import { useQueries } from '@tanstack/react-query';

import { api } from '../api/client';
import { ExhibitionCard } from '../components/ExhibitionCard';
import { Empty, Loading } from '../components/States';
import { useFavorites } from '../lib/favorites';

export function FavoritesPage() {
  const { ids } = useFavorites();

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['exhibition', id],
      queryFn: () => api.exhibition(id),
      // Favourites are the pages most worth having offline, so they are kept
      // far longer than the default and reused from cache aggressively.
      staleTime: 30 * 60 * 1000,
    })),
  });

  if (ids.length === 0) {
    return (
      <>
        <h1 className="page-title">علاقه‌مندی‌ها</h1>
        <Empty
          title="هنوز نمایشگاهی ذخیره نکرده‌اید"
          hint="از صفحهٔ هر نمایشگاه می‌توانید آن را به این فهرست اضافه کنید"
        />
      </>
    );
  }

  const loading = queries.some((query) => query.isLoading);
  const items = queries.flatMap((query) => (query.data ? [query.data] : []));

  return (
    <>
      <h1 className="page-title">علاقه‌مندی‌ها</h1>

      {loading && items.length === 0 && <Loading rows={2} />}

      {items.map((item) => (
        <ExhibitionCard key={item.id} exhibition={item} />
      ))}

      {!loading && items.length === 0 && (
        <Empty
          title="نمایشگاه‌های ذخیره‌شده در دسترس نیستند"
          hint="اتصال اینترنت را بررسی کنید"
        />
      )}
    </>
  );
}
