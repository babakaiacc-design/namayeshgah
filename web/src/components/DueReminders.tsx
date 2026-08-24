import { Link } from 'react-router-dom';

import { Icon } from './Icon';
import { useDueReminders } from '../lib/reminders';
import { describeCountdown, formatJalali } from '../lib/persian-date';

/**
 * Reminders that came due while the app was closed.
 *
 * This is the dependable half of the reminder feature on the web. A push
 * notification may never arrive, depending on the browser, the platform and
 * whether the app was installed to the Home Screen. Asking the server on open
 * has none of those conditions attached, so the user always sees what they
 * asked to be told.
 */
export function DueReminders() {
  const { due, dismiss } = useDueReminders();

  if (due.length === 0) return null;

  return (
    <section className="due" aria-label="یادآوری‌های شما">
      <div className="due__head">
        <h2 className="due__title">
          <Icon name="bell" size="sm" />
          یادآوری شما
        </h2>
        <button
          type="button"
          className="due__dismiss"
          onClick={() => dismiss(due.map((reminder) => reminder.id))}
        >
          خواندم
        </button>
      </div>

      <ul className="due__list">
        {due.map((reminder) => {
          const countdown = reminder.exhibitionStart
            ? describeCountdown(daysUntil(reminder.exhibitionStart))
            : null;

          return (
            <li key={reminder.id}>
              <Link to={`/exhibition/${reminder.exhibitionId}`} className="due__item">
                <strong>{reminder.exhibitionTitle}</strong>
                <span className="due__meta">
                  {reminder.exhibitionStart && formatJalali(reminder.exhibitionStart)}
                  {countdown ? ` · ${countdown}` : ''}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Days from today to a date, counted in whole local days. */
function daysUntil(iso: string): number {
  const today = new Date();
  const target = new Date(`${iso}T12:00:00Z`);
  const start = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12),
  );
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}
