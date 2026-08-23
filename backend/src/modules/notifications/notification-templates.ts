/**
 * Text for server-generated notifications.
 *
 * The brief forbids scattering UI strings through the code, and this is the one
 * place the server has to produce user-facing text. It is centralized here and
 * keyed by locale, so adding Turkish or Arabic later means editing one file.
 *
 * The structured payload travels alongside the rendered text, so a client that
 * would rather render its own copy can ignore these entirely.
 */

export type NotificationType =
  | 'REMINDER'
  | 'DATE_CHANGE'
  | 'VENUE_CHANGE'
  | 'CANCELLED'
  | 'NEW_EXHIBITION'
  | 'DIGEST';

interface Rendered {
  title: string;
  body: string;
}

type Renderer = (values: Record<string, string>) => Rendered;

const TEMPLATES: Record<string, Partial<Record<NotificationType, Renderer>>> = {
  fa: {
    DATE_CHANGE: (v) => ({
      title: 'تاریخ نمایشگاه تغییر کرد',
      body: `تاریخ «${v.title}» از ${v.oldValue} به ${v.newValue} تغییر کرد. یادآوری شما به‌روزرسانی شد.`,
    }),
    VENUE_CHANGE: (v) => ({
      title: 'محل برگزاری تغییر کرد',
      body: `محل برگزاری «${v.title}» تغییر کرد.`,
    }),
    CANCELLED: (v) => ({
      title: 'نمایشگاه لغو شد',
      body: `«${v.title}» لغو شده است.`,
    }),
    NEW_EXHIBITION: (v) => ({
      title: 'نمایشگاه جدید در حوزه موردعلاقه شما',
      body: `«${v.title}» به تقویم اضافه شد.`,
    }),
    REMINDER: (v) => ({
      title: v.title,
      body: `«${v.title}» ${v.daysUntil} روز دیگر آغاز می‌شود.`,
    }),
  },
  en: {
    DATE_CHANGE: (v) => ({
      title: 'Exhibition date changed',
      body: `"${v.title}" moved from ${v.oldValue} to ${v.newValue}. Your reminder has been updated.`,
    }),
    VENUE_CHANGE: (v) => ({
      title: 'Venue changed',
      body: `The venue for "${v.title}" has changed.`,
    }),
    CANCELLED: (v) => ({
      title: 'Exhibition cancelled',
      body: `"${v.title}" has been cancelled.`,
    }),
    NEW_EXHIBITION: (v) => ({
      title: 'New exhibition in a category you follow',
      body: `"${v.title}" was added to the calendar.`,
    }),
    REMINDER: (v) => ({
      title: v.title,
      body: `"${v.title}" starts in ${v.daysUntil} days.`,
    }),
  },
};

/**
 * Renders a notification, falling back to Persian, then to a plain statement.
 *
 * A missing translation must never stop a date-change alert from being
 * delivered: the user losing the message is worse than seeing it in the wrong
 * language.
 */
export function renderNotification(
  type: NotificationType,
  locale: string,
  values: Record<string, string>,
): Rendered {
  const language = (locale || 'fa').split('-')[0];
  const renderer = TEMPLATES[language]?.[type] ?? TEMPLATES.fa[type];

  if (!renderer) {
    return { title: type, body: values.title ?? '' };
  }

  return renderer(values);
}

export function supportedLocales(): string[] {
  return Object.keys(TEMPLATES);
}
