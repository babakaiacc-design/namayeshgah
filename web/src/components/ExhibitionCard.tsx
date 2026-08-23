import { Link } from 'react-router-dom';

import type { Exhibition } from '../api/types';
import { describeCountdown, formatJalaliRange } from '../lib/persian-date';

interface Props {
  exhibition: Exhibition;
}

/**
 * The card from section 35 of the brief.
 *
 * The date line is the part that matters. When no source has published a date
 * the card says so outright instead of leaving a gap or guessing a countdown,
 * which is the visible half of rule 58.
 */
export function ExhibitionCard({ exhibition }: Props) {
  const { dates, venue, city, category } = exhibition;
  const countdown = describeCountdown(dates.daysUntil);
  const dateLine = formatJalaliRange(dates.start, dates.end);

  return (
    <Link className="card" to={`/exhibition/${encodeURIComponent(exhibition.slug)}`}>
      <div className="card__badges">
        {dates.isOngoing && <span className="badge badge--live">در حال برگزاری</span>}

        {/* A countdown needs a start date, not a fully confirmed range. Hiding
            it whenever the end date is missing would throw away the one thing
            the user most wants to know. */}
        {!dates.isOngoing && countdown && (
          <span className="badge badge--soon">{countdown}</span>
        )}

        <DateCaveat status={dates.status} hasStart={Boolean(dates.start)} hasEnd={Boolean(dates.end)} />

        {category && <span className="badge badge--category">{category.name}</span>}
      </div>

      <h3 className="card__title">{exhibition.title}</h3>

      <div className="card__meta">
        {dateLine ? (
          <span className="card__meta-item">
            <span aria-hidden="true">▤</span>
            {dateLine}
          </span>
        ) : (
          <span className="card__meta-item">تاریخ هنوز منتشر نشده است</span>
        )}

        <span className="card__meta-item">
          <span aria-hidden="true">⌖</span>
          {venue?.name ?? city.name}
        </span>
      </div>
    </Link>
  );
}

/**
 * Says precisely which part of the date is missing.
 *
 * Labelling a row "date not announced" while printing a start date underneath
 * it is worse than saying nothing: the two statements contradict each other and
 * the reader cannot tell which to trust.
 */
function DateCaveat({
  status,
  hasStart,
  hasEnd,
}: {
  status: string;
  hasStart: boolean;
  hasEnd: boolean;
}) {
  if (status === 'CONFLICT') {
    // Two sources disagree. Saying so is more useful than silently showing one
    // of them as though it were settled.
    return <span className="badge badge--unknown">تاریخ در حال بررسی</span>;
  }

  if (status !== 'UNKNOWN') return null;
  if (!hasStart) return <span className="badge badge--unknown">تاریخ اعلام نشده</span>;
  if (!hasEnd) return <span className="badge badge--unknown">روز پایان اعلام نشده</span>;
  return null;
}
