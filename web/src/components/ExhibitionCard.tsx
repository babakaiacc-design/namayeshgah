import { Link } from 'react-router-dom';

import type { Exhibition } from '../api/types';
import { Icon } from './Icon';
import {
  describeCountdown,
  formatJalaliRange,
  jalaliDayMonth,
} from '../lib/persian-date';

interface Props {
  exhibition: Exhibition;
}

/**
 * The card from section 35 of the brief.
 *
 * The date leads. In a calendar app the first question is always "when", so the
 * day and month are set as a block on the leading edge at a much larger size
 * than anything else, and the eye can scan a list by date without reading a
 * word. The earlier version buried the date in a line of grey meta text, which
 * is what made the list look flat and undifferentiated.
 *
 * When no date has been published the block says so instead of being left
 * blank, which keeps the row rhythm intact and states the gap honestly.
 */
export function ExhibitionCard({ exhibition }: Props) {
  const { dates, venue, city, category } = exhibition;
  const countdown = describeCountdown(dates.daysUntil);
  const dayMonth = jalaliDayMonth(dates.start);
  const range = formatJalaliRange(dates.start, dates.end);

  return (
    <Link className="card" to={`/exhibition/${encodeURIComponent(exhibition.slug)}`}>
      <div
        className={`card__date${dates.isOngoing ? ' card__date--live' : ''}`}
        aria-hidden="true"
      >
        {dayMonth ? (
          <>
            <span className="card__day">{dayMonth.day}</span>
            <span className="card__month">{dayMonth.month}</span>
          </>
        ) : (
          <Icon name="alert" size="md" />
        )}
      </div>

      <div className="card__body">
        <div className="card__badges">
          {dates.isOngoing && (
            <span className="badge badge--live">
              <span className="badge__dot" aria-hidden="true" />
              در حال برگزاری
            </span>
          )}

          {/* A countdown needs a start date, not a fully confirmed range.
              Hiding it whenever the end date is missing would throw away the
              one thing the user most wants to know. */}
          {!dates.isOngoing && countdown && <span className="badge badge--soon">{countdown}</span>}

          <DateCaveat
            status={dates.status}
            hasStart={Boolean(dates.start)}
            hasEnd={Boolean(dates.end)}
          />
        </div>

        <h3 className="card__title">{exhibition.title}</h3>

        <div className="card__meta">
          <span className="card__meta-item">
            <Icon name="pin" size="sm" />
            {venue?.name ?? city.name}
          </span>

          {range && (
            <span className="card__meta-item">
              <Icon name="calendar" size="sm" />
              {range}
            </span>
          )}

          {category && (
            <span className="card__meta-item">
              <Icon name="tag" size="sm" />
              {category.name}
            </span>
          )}
        </div>
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
