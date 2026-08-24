/**
 * Jalali dates and Persian numerals for the UI layer.
 *
 * Everything here is built on Intl with the `persian` calendar, which every
 * modern browser ships. No hand-written calendar arithmetic and no conversion
 * library: rule 6 of the project says dates are never converted by hand, and
 * the platform already does it correctly, including leap years.
 *
 * The API speaks Gregorian ISO dates only. Conversion happens here and nowhere
 * else, so the wire format and the display format can never drift.
 */

export type IsoDate = string; // yyyy-mm-dd

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
] as const;

/** Saturday first, matching how a Persian calendar is laid out. */
export const WEEKDAY_NAMES = [
  'شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه',
] as const;

export interface JalaliParts {
  year: number;
  month: number; // 1..12
  day: number;
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Turns an ISO date into a UTC instant at midday.
 *
 * A calendar date has no time and no zone. Anchoring at midday UTC keeps it
 * clear of every timezone boundary, so formatting can never slide the date onto
 * the neighbouring day the way midnight anchoring does.
 */
function anchor(iso: IsoDate): Date | undefined {
  const match = ISO_PATTERN.exec(iso ?? '');
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));

  // Rejects impossible dates such as 2026-02-31, which would otherwise roll
  // silently into March.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return undefined;
  }
  return date;
}

const partsFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

/** The Jalali year, month and day for an ISO Gregorian date. */
export function toJalali(iso: IsoDate): JalaliParts | undefined {
  const date = anchor(iso);
  if (!date) return undefined;
  return jalaliOf(date);
}

function jalaliOf(date: Date): JalaliParts {
  const parts = partsFormatter.formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  return { year: read('year'), month: read('month'), day: read('day') };
}

const persianDigits = '۰۱۲۳۴۵۶۷۸۹';

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => persianDigits[Number(digit)]);
}

export function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)));
}

/** "۹ شهریور ۱۴۰۵" */
export function formatJalali(iso: IsoDate | null | undefined): string {
  if (!iso) return '';
  const parts = toJalali(iso);
  if (!parts) return '';
  return `${toPersianDigits(parts.day)} ${JALALI_MONTHS[parts.month - 1]} ${toPersianDigits(parts.year)}`;
}

/** "۱۴۰۵/۰۶/۰۹" */
export function formatJalaliNumeric(iso: IsoDate | null | undefined): string {
  if (!iso) return '';
  const parts = toJalali(iso);
  if (!parts) return '';
  const pad = (value: number) => toPersianDigits(String(value).padStart(2, '0'));
  return `${toPersianDigits(parts.year)}/${pad(parts.month)}/${pad(parts.day)}`;
}

/**
 * Collapses a range the way a person writes it, repeating only what changes.
 *
 *   same month  -> "۸ تا ۱۱ شهریور ۱۴۰۵"
 *   same year   -> "۲۸ مرداد تا ۳ شهریور ۱۴۰۵"
 *   otherwise   -> "۲۹ اسفند ۱۴۰۴ تا ۲ فروردین ۱۴۰۵"
 *   no end date -> "از ۸ شهریور ۱۴۰۵"
 */
export function formatJalaliRange(
  start: IsoDate | null | undefined,
  end: IsoDate | null | undefined,
): string {
  if (!start) return '';
  const from = toJalali(start);
  if (!from) return '';

  if (!end || end === start) return formatJalali(start);

  const to = toJalali(end);
  if (!to) return `از ${formatJalali(start)}`;

  const day = (value: number) => toPersianDigits(value);
  const month = (value: number) => JALALI_MONTHS[value - 1];
  const year = (value: number) => toPersianDigits(value);

  if (from.year === to.year && from.month === to.month) {
    return `${day(from.day)} تا ${day(to.day)} ${month(to.month)} ${year(to.year)}`;
  }
  if (from.year === to.year) {
    return `${day(from.day)} ${month(from.month)} تا ${day(to.day)} ${month(to.month)} ${year(to.year)}`;
  }
  return `${formatJalali(start)} تا ${formatJalali(end)}`;
}

/**
 * The Gregorian ISO date for a Jalali date.
 *
 * Intl only formats, so this searches for the Gregorian day whose Jalali
 * rendering matches, using Intl itself as the oracle. That keeps the platform
 * as the single authority on the calendar rather than reimplementing leap-year
 * rules, which is where hand-rolled Jalali converters usually go wrong.
 */
export function fromJalali(year: number, month: number, day: number): IsoDate | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  // The Jalali new year falls in late March, so this lands within days.
  const guess = new Date(Date.UTC(year + 621, month + 1, day, 12));
  const target = ordinal({ year, month, day });

  let current = guess;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const parts = jalaliOf(current);
    if (parts.year === year && parts.month === month && parts.day === day) {
      return current.toISOString().slice(0, 10);
    }

    const delta = target - ordinal(parts);
    // The ordinal is approximate, so a single step is taken once the estimate
    // gets small, which guarantees the loop converges rather than oscillating.
    const step = Math.abs(delta) > 3 ? delta : Math.sign(delta);
    current = new Date(current.getTime() + step * 86_400_000);
  }

  // The requested date does not exist, for example 31 Esfand in a common year.
  return undefined;
}

/** Monotonic day-ish number used only to estimate how far to jump. */
function ordinal(parts: JalaliParts): number {
  return parts.year * 372 + (parts.month - 1) * 31 + parts.day;
}

export interface JalaliMonthInfo {
  year: number;
  month: number;
  name: string;
  /** ISO date of the first day. */
  firstDay: IsoDate;
  daysInMonth: number;
  /** Column of the first day, 0 = Saturday. */
  startWeekday: number;
}

/**
 * Everything the calendar grid needs for one Jalali month.
 *
 * The day count is derived by walking to the next month rather than hard-coding
 * "the first six months have 31 days", so a leap Esfand of 30 days is handled
 * by the platform.
 */
export function jalaliMonth(year: number, month: number): JalaliMonthInfo | undefined {
  const firstDay = fromJalali(year, month, 1);
  if (!firstDay) return undefined;

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextFirst = fromJalali(nextYear, nextMonth, 1);
  if (!nextFirst) return undefined;

  const daysInMonth = Math.round(
    (anchor(nextFirst)!.getTime() - anchor(firstDay)!.getTime()) / 86_400_000,
  );

  // getUTCDay is Sunday-based; the Persian week starts on Saturday.
  const startWeekday = (anchor(firstDay)!.getUTCDay() + 1) % 7;

  return {
    year,
    month,
    name: JALALI_MONTHS[month - 1],
    firstDay,
    daysInMonth,
    startWeekday,
  };
}

export function addJalaliMonths(year: number, month: number, delta: number): JalaliParts {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1, day: 1 };
}

/** Today as an ISO date in a given IANA zone. */
export function todayInZone(timeZone = 'Asia/Tehran', now: Date = new Date()): IsoDate {
  // en-CA renders Gregorian dates as yyyy-mm-dd, which is exactly the wire
  // format, so no string surgery is needed.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = anchor(iso);
  if (!date) return iso;
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number | undefined {
  const a = anchor(from);
  const b = anchor(to);
  if (!a || !b) return undefined;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * How the countdown reads on a card: "امروز", "فردا", "۵ روز دیگر".
 *
 * Returns null when there is nothing truthful to say, which the caller renders
 * as an explicit "تاریخ نامشخص" rather than inventing a countdown.
 */
export function describeCountdown(daysUntil: number | null | undefined): string | null {
  if (daysUntil === null || daysUntil === undefined || Number.isNaN(daysUntil)) return null;
  if (daysUntil < 0) return 'برگزار شده';
  if (daysUntil === 0) return 'امروز';
  if (daysUntil === 1) return 'فردا';
  return `${toPersianDigits(daysUntil)} روز دیگر`;
}

/** "امروز" / "۲ روز پیش" for the freshness line required by section 30. */
export function describeFreshness(
  lastVerifiedAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!lastVerifiedAt) return null;

  const checked = new Date(lastVerifiedAt);
  if (Number.isNaN(checked.getTime())) return null;

  const days = Math.floor((now.getTime() - checked.getTime()) / 86_400_000);
  if (days <= 0) return 'آخرین بررسی: امروز';
  if (days === 1) return 'آخرین بررسی: دیروز';
  return `آخرین بررسی: ${toPersianDigits(days)} روز پیش`;
}

/**
 * The day and month alone, for the date block on a card.
 *
 * A calendar app earns its identity from the date being a visual object rather
 * than a line of text, so the card renders these two parts at different weights
 * instead of one sentence.
 */
export function jalaliDayMonth(
  iso: IsoDate | null | undefined,
): { day: string; month: string } | null {
  if (!iso) return null;
  const parts = toJalali(iso);
  if (!parts) return null;
  return { day: toPersianDigits(parts.day), month: JALALI_MONTHS[parts.month - 1] };
}
