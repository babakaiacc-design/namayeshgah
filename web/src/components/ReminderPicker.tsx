import type { ExhibitionDetail } from '../api/types';
import { REMINDER_OPTIONS, useReminders } from '../lib/reminders';
import { formatJalali } from '../lib/persian-date';

/**
 * The reminder options from section 21.
 *
 * Two honesty rules are visible here. An exhibition with no published date
 * cannot be scheduled, so the picker says why rather than offering buttons that
 * would quietly do nothing. And once a reminder exists, the exact moment it
 * will fire is shown, because "7 days before" means nothing to the reader
 * unless they can see which day that is.
 */
export function ReminderPicker({ exhibition }: { exhibition: ExhibitionDetail }) {
  const { has, toggle, isPending, error, forExhibition } = useReminders();
  const mine = forExhibition(exhibition.id);
  const schedulable = Boolean(exhibition.dates.start);

  return (
    <section className="section">
      <h2 className="section__title">یادآوری</h2>

      {!schedulable && (
        <p className="panel__note">
          تا زمانی که تاریخ این نمایشگاه اعلام نشود، یادآوری قابل تنظیم نیست.
          به‌محض انتشار تاریخ می‌توانید یادآوری بگذارید.
        </p>
      )}

      {schedulable && (
        <>
          <div className="chips" role="group" aria-label="گزینه‌های یادآوری">
            {REMINDER_OPTIONS.map((option) => {
              const active = has(exhibition.id, option.type);
              return (
                <button
                  key={option.type}
                  type="button"
                  className={`chip${active ? ' chip--active' : ''}`}
                  disabled={isPending}
                  aria-pressed={active}
                  onClick={() => void toggle(exhibition.id, option.type)}
                >
                  {active ? '✓ ' : ''}
                  {option.label}
                </button>
              );
            })}
          </div>

          {mine.length > 0 && (
            <ul className="reminder-list">
              {mine.map((reminder) => (
                <li key={reminder.id} className="reminder-list__item">
                  <span>
                    {REMINDER_OPTIONS.find((option) => option.type === reminder.type)?.label ??
                      'یادآوری'}
                  </span>
                  <span className="reminder-list__when">
                    {reminder.remindAt
                      ? formatJalali(reminder.remindAt.slice(0, 10))
                      : 'در انتظار اعلام تاریخ'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="panel__note">
            یادآوری‌ها هنگام باز کردن اپ نمایش داده می‌شوند. برای دریافت اعلان
            حتی وقتی اپ بسته است، به صفحهٔ پروفایل بروید.
          </p>
        </>
      )}

      {error && <p className="panel__note panel__note--error">{describeError(error)}</p>}
    </section>
  );
}

function describeError(error: Error): string {
  // The tier cap is a refusal the user can act on, so it gets its own wording
  // rather than a generic failure message.
  if (error.message.includes('limit reached')) {
    return 'به سقف تعداد یادآوری‌های حساب رایگان رسیده‌اید. یکی از یادآوری‌های قبلی را حذف کنید.';
  }
  return 'ثبت یادآوری انجام نشد. چند لحظه دیگر دوباره تلاش کنید.';
}
