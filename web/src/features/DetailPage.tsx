import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { ExhibitionDetail } from '../api/types';
import { Failed, Loading } from '../components/States';
import { useFavorites } from '../lib/favorites';
import {
  describeFreshness,
  formatJalaliRange,
  toPersianDigits,
} from '../lib/persian-date';

export function DetailPage() {
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const { isFavorite, toggle } = useFavorites();

  const query = useQuery({
    queryKey: ['exhibition', idOrSlug],
    queryFn: () => api.exhibition(idOrSlug!),
    enabled: Boolean(idOrSlug),
  });

  if (query.isLoading) return <Loading rows={4} />;
  if (query.isError || !query.data) return <Failed onRetry={() => void query.refetch()} />;

  const exhibition = query.data;
  const { dates, venue } = exhibition;
  const favorite = isFavorite(exhibition.id);

  return (
    <article>
      <Link to="/" className="back-link">
        بازگشت
      </Link>

      <h1 className="detail__title">{exhibition.title}</h1>

      <DateBlock exhibition={exhibition} />

      <dl className="detail__facts">
        <Fact label="محل برگزاری" value={venue?.name ?? exhibition.city.name} />
        {venue?.address && <Fact label="نشانی" value={venue.address} />}
        {dates.startTime && (
          <Fact
            label="ساعت"
            value={`${toPersianDigits(dates.startTime.slice(0, 5))} تا ${toPersianDigits(
              (dates.endTime ?? '').slice(0, 5),
            )}`}
          />
        )}
        {exhibition.category && <Fact label="دسته‌بندی" value={exhibition.category.name} />}
        {exhibition.organizer && <Fact label="برگزارکننده" value={exhibition.organizer} />}
        <Fact
          label="نوع"
          value={exhibition.isInternational ? 'بین‌المللی' : 'داخلی'}
        />
      </dl>

      <div className="detail__actions">
        <button
          type="button"
          className={`action${favorite ? ' action--active' : ''}`}
          onClick={() => toggle(exhibition.id)}
        >
          {favorite ? '♥ در علاقه‌مندی‌ها' : '♡ افزودن به علاقه‌مندی‌ها'}
        </button>

        {exhibition.officialWebsite && (
          <a
            className="action"
            href={exhibition.officialWebsite}
            target="_blank"
            rel="noopener noreferrer"
          >
            وب‌سایت رسمی
          </a>
        )}

        {/* Coordinates are null until an admin verifies them, so the directions
            button simply does not appear rather than opening a wrong pin. */}
        {venue?.latitude != null && venue?.longitude != null && (
          <a
            className="action"
            href={`https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            مسیریابی
          </a>
        )}

        <ShareButton exhibition={exhibition} />
      </div>

      {exhibition.description && <p className="detail__description">{exhibition.description}</p>}

      <SourceList exhibition={exhibition} />
    </article>
  );
}

function DateBlock({ exhibition }: { exhibition: ExhibitionDetail }) {
  const { dates } = exhibition;
  const freshness = describeFreshness(exhibition.lastVerifiedAt);

  // Only a genuinely dateless exhibition gets the "not announced" panel; a
  // known start with an unknown end says exactly that instead.
  if (!dates.start) {
    return (
      <div className="detail__dates detail__dates--warn">
        <strong>تاریخ هنوز اعلام نشده است</strong>
        <p>
          هیچ منبعی تاریخ این نمایشگاه را منتشر نکرده. به‌محض انتشار، همین‌جا
          به‌روزرسانی می‌شود.
        </p>
        {freshness && <span className="detail__freshness">{freshness}</span>}
      </div>
    );
  }

  return (
    <div
      className={`detail__dates${
        dates.status === 'CONFLICT' || !dates.end ? ' detail__dates--warn' : ''
      }`}
    >
      <strong>{formatJalaliRange(dates.start, dates.end)}</strong>

      {dates.status === 'UNKNOWN' && !dates.end && (
        <p>روز پایان این نمایشگاه هنوز توسط هیچ منبعی اعلام نشده است.</p>
      )}

      {dates.status === 'CONFLICT' && (
        <p>
          منابع دربارهٔ تاریخ این نمایشگاه اختلاف دارند. تاریخ‌های اعلام‌شده در
          پایین صفحه آمده است.
        </p>
      )}

      {freshness && <span className="detail__freshness">{freshness}</span>}
    </div>
  );
}

/**
 * Where the data came from, per section 11.
 *
 * This is what makes a CONFLICT actionable for the reader: both dates are on
 * screen with the site that published each one.
 */
function SourceList({ exhibition }: { exhibition: ExhibitionDetail }) {
  if (exhibition.sources.length === 0) return null;

  return (
    <section className="section">
      <h2 className="section__title">منابع</h2>
      <ul className="sources">
        {exhibition.sources.map((source) => (
          <li key={source.sourceUrl} className="sources__item">
            <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
              {source.displayName}
            </a>
            {source.startDate && (
              <span className="sources__dates">
                {formatJalaliRange(source.startDate, source.endDate)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShareButton({ exhibition }: { exhibition: ExhibitionDetail }) {
  const text = [
    exhibition.title,
    formatJalaliRange(exhibition.dates.start, exhibition.dates.end),
    exhibition.venue?.name ?? exhibition.city.name,
  ]
    .filter(Boolean)
    .join('\n');

  const share = async () => {
    const url = window.location.href;
    // navigator.share is the native sheet on mobile; the clipboard is the
    // fallback on desktop, where the API is often missing.
    if (navigator.share) {
      try {
        await navigator.share({ title: exhibition.title, text, url });
        return;
      } catch {
        // The user dismissed the sheet; nothing to report.
        return;
      }
    }
    await navigator.clipboard?.writeText(`${text}\n${url}`);
  };

  return (
    <button type="button" className="action" onClick={() => void share()}>
      اشتراک‌گذاری
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
