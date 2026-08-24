import { useQueries } from '@tanstack/react-query';

import { api } from '../api/client';
import { ExhibitionCard } from '../components/ExhibitionCard';
import { Empty, Loading } from '../components/States';
import { useFavorites } from '../lib/favorites';

export function FavoritesPage() {
  const { favorites, isLoading } = useFavorites();

  const exhibitionIds = favorites
    .filter((favorite) => favorite.kind === 'exhibition' && favorite.exhibitionId)
    .map((favorite) => favorite.exhibitionId as string);

  const followedCategories = favorites.filter((favorite) => favorite.kind === 'category');

  const queries = useQueries({
    queries: exhibitionIds.map((id) => ({
      queryKey: ['exhibition', id],
      queryFn: () => api.exhibition(id),
      // Saved items are the ones most worth having offline.
      staleTime: 30 * 60 * 1000,
    })),
  });

  const items = queries.flatMap((query) => (query.data ? [query.data] : []));
  const loadingItems = queries.some((query) => query.isLoading);

  if (isLoading) {
    return (
      <>
        <h1 className="page-title">علاقه‌مندی‌ها</h1>
        <Loading rows={2} />
      </>
    );
  }

  if (favorites.length === 0) {
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

  return (
    <>
      <h1 className="page-title">علاقه‌مندی‌ها</h1>

      {followedCategories.length > 0 && (
        <section className="section">
          <h2 className="section__title">دسته‌بندی‌های دنبال‌شده</h2>
          <div className="chips">
            {followedCategories.map((favorite) => (
              <span key={favorite.id} className="chip">
                {favorite.title}
              </span>
            ))}
          </div>
        </section>
      )}

      {loadingItems && items.length === 0 && <Loading rows={2} />}

      {items.map((item) => (
        <ExhibitionCard key={item.id} exhibition={item} />
      ))}

      {!loadingItems && exhibitionIds.length > 0 && items.length === 0 && (
        <Empty
          title="نمایشگاه‌های ذخیره‌شده در دسترس نیستند"
          hint="اتصال اینترنت را بررسی کنید"
        />
      )}
    </>
  );
}
