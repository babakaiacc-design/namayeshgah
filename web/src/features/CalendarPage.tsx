import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { ExhibitionCard } from '../components/ExhibitionCard';
import { Empty, Failed, Loading } from '../components/States';
import {
  WEEKDAY_NAMES,
  addDays,
  addJalaliMonths,
  formatJalali,
  jalaliMonth,
  toJalali,
  toPersianDigits,
  todayInZone,
} from '../lib/persian-date';

const CITY = 'tehran';
const ZONE = 'Asia/Tehran';

/**
 * A Jalali month grid with a marker on every day that has an exhibition.
 *
 * The grid is built from the Jalali month, but every value sent to the API is
 * a Gregorian ISO date. The calendar system stays entirely in the view layer,
 * which is what lets a second calendar be added later without touching the API.
 */
export function CalendarPage() {
  const today = todayInZone(ZONE);
  const todayJalali = toJalali(today)!;

  const [cursor, setCursor] = useState({
    year: todayJalali.year,
    month: todayJalali.month,
  });
  const [selected, setSelected] = useState<string | null>(today);

  const month = jalaliMonth(cursor.year, cursor.month);

  const monthRange = useMemo(() => {
    if (!month) return null;
    return { from: month.firstDay, to: addDays(month.firstDay, month.daysInMonth - 1) };
  }, [month]);

  const monthQuery = useQuery({
    queryKey: ['calendar', CITY, monthRange?.from, monthRange?.to],
    queryFn: () =>
      api.exhibitions({
        city: CITY,
        dateFrom: monthRange!.from,
        dateTo: monthRange!.to,
        limit: 100,
      }),
    enabled: Boolean(monthRange),
  });

  /** Which ISO days inside this month have at least one exhibition open. */
  const busyDays = useMemo(() => {
    const days = new Set<string>();
    if (!month || !monthQuery.data) return days;

    for (const item of monthQuery.data.items) {
      if (!item.dates.start) continue;
      const end = item.dates.end ?? item.dates.start;

      // An exhibition occupies every day it runs, not only its first.
      for (let day = 0; day < month.daysInMonth; day += 1) {
        const iso = addDays(month.firstDay, day);
        if (iso >= item.dates.start && iso <= end) days.add(iso);
      }
    }
    return days;
  }, [month, monthQuery.data]);

  const selectedItems = useMemo(() => {
    if (!selected || !monthQuery.data) return [];
    return monthQuery.data.items.filter((item) => {
      if (!item.dates.start) return false;
      const end = item.dates.end ?? item.dates.start;
      return selected >= item.dates.start && selected <= end;
    });
  }, [selected, monthQuery.data]);

  if (!month) return <Failed />;

  const move = (delta: number) => {
    const next = addJalaliMonths(cursor.year, cursor.month, delta);
    setCursor({ year: next.year, month: next.month });
    setSelected(null);
  };

  const leadingBlanks = Array.from({ length: month.startWeekday });
  const days = Array.from({ length: month.daysInMonth }, (_, index) => index + 1);

  return (
    <>
      <h1 className="page-title">تقویم</h1>

      <div className="calendar">
        <div className="calendar__head">
          {/* In RTL the "previous" control sits on the right, which is what the
              arrow directions below reflect. */}
          <button type="button" className="calendar__nav" onClick={() => move(-1)} aria-label="ماه قبل">
            ›
          </button>
          <span className="calendar__title">
            {month.name} {toPersianDigits(month.year)}
          </span>
          <button type="button" className="calendar__nav" onClick={() => move(1)} aria-label="ماه بعد">
            ‹
          </button>
        </div>

        <div className="calendar__grid" role="grid">
          {WEEKDAY_NAMES.map((name) => (
            <span key={name} className="calendar__weekday" role="columnheader">
              {name.slice(0, 1)}
            </span>
          ))}

          {leadingBlanks.map((_, index) => (
            <span key={`blank-${index}`} />
          ))}

          {days.map((day) => {
            const iso = addDays(month.firstDay, day - 1);
            const isToday = iso === today;
            const isSelected = iso === selected;
            const hasEvents = busyDays.has(iso);

            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                className={[
                  'calendar__day',
                  isToday ? 'calendar__day--today' : '',
                  isSelected ? 'calendar__day--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelected(iso)}
                aria-label={`${formatJalali(iso)}${hasEvents ? '، دارای نمایشگاه' : ''}`}
              >
                {toPersianDigits(day)}
                {hasEvents && <span className="calendar__dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      {monthQuery.isLoading && <Loading rows={2} />}
      {monthQuery.isError && <Failed onRetry={() => void monthQuery.refetch()} />}

      {selected && !monthQuery.isLoading && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">{formatJalali(selected)}</h2>
            {selectedItems.length > 0 && (
              <span className="section__count">
                {toPersianDigits(selectedItems.length)} نمایشگاه
              </span>
            )}
          </div>

          {selectedItems.length === 0 ? (
            <Empty title="در این روز نمایشگاهی برگزار نمی‌شود" />
          ) : (
            selectedItems.map((item) => <ExhibitionCard key={item.id} exhibition={item} />)
          )}
        </section>
      )}
    </>
  );
}
