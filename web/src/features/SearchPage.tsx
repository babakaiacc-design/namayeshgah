import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import type { CategoryNode } from '../api/types';
import { CategoryFilter } from '../components/CategoryFilter';
import { ExhibitionCard } from '../components/ExhibitionCard';
import { Empty, Failed, Loading } from '../components/States';
import { toPersianDigits } from '../lib/persian-date';

const CITY = 'tehran';

export function SearchPage() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<string | undefined>();

  // A search box that fires on every keystroke would hammer a free instance
  // and, on a slow connection, render results for a prefix the user has
  // already moved past.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const categories = useQuery({
    queryKey: ['categories', CITY],
    queryFn: () => api.categories(CITY),
  });

  const hasQuery = debounced.length > 0 || Boolean(category);

  const results = useQuery({
    queryKey: ['search', debounced, category, CITY],
    queryFn: () =>
      api.exhibitions({
        search: debounced || undefined,
        category,
        city: CITY,
        sort: debounced ? 'relevance' : 'startDate',
        limit: 50,
      }),
    enabled: hasQuery,
  });

  const flatCategories = useMemo(() => flatten(categories.data ?? []), [categories.data]);

  return (
    <>
      <h1 className="page-title">جستجو</h1>

      <input
        className="search-input"
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="نام نمایشگاه، مثلاً مبلمان"
        aria-label="جستجوی نمایشگاه"
        // Persian text is entered right to left; the browser needs telling.
        dir="rtl"
        enterKeyHint="search"
      />

      <CategoryFilter
        categories={flatCategories}
        selected={category}
        onSelect={setCategory}
      />


      {!hasQuery && (
        <Empty
          title="چیزی برای جستجو بنویسید"
          hint="یا یکی از دسته‌بندی‌های بالا را انتخاب کنید"
        />
      )}

      {hasQuery && results.isLoading && <Loading rows={4} />}
      {hasQuery && results.isError && <Failed onRetry={() => void results.refetch()} />}

      {hasQuery && results.data && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">نتایج</h2>
            <span className="section__count">
              {toPersianDigits(results.data.total)} مورد
            </span>
          </div>

          {results.data.items.length === 0 ? (
            <Empty
              title="نمایشگاهی پیدا نشد"
              hint="املای دیگری را امتحان کنید یا فیلتر را بردارید"
            />
          ) : (
            results.data.items.map((item) => (
              <ExhibitionCard key={item.id} exhibition={item} />
            ))
          )}
        </section>
      )}
    </>
  );
}

/** Only top-level categories are shown as chips; the API includes children. */
function flatten(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.filter((node) => node.exhibitionCount > 0 || node.children.length > 0);
}
