import { DateTime } from 'luxon';

/**
 * Turns a reminder offset into the exact instant it should fire.
 *
 * This is why `reminders` stores `offset_days` and `offset_time` next to
 * `remind_at`. The offset is the user intent ("seven days before, at nine in
 * the morning"); `remind_at` is a derived value that has to be rebuilt whenever
 * the exhibition moves.
 *
 * The city timezone is not decoration. "Nine in the morning" means nine in the
 * morning where the exhibition is, so the local wall clock is resolved first
 * and only then converted to an instant. Doing the arithmetic in UTC would put
 * a Dubai reminder half an hour out from a Tehran one and an hour out from a
 * Berlin one for half the year.
 */
export function computeRemindAt(
  startDate: string | null | undefined,
  offsetDays: number,
  offsetTime: string,
  timeZone: string,
): Date | undefined {
  // No published date means nothing to schedule. The reminder row still exists,
  // carrying the user intent until a date arrives.
  if (!startDate) return undefined;

  const time = parseTime(offsetTime);
  if (!time) return undefined;
  if (!Number.isInteger(offsetDays) || offsetDays < 0) return undefined;

  const start = DateTime.fromISO(startDate, { zone: timeZone });
  if (!start.isValid) return undefined;

  const target = start.minus({ days: offsetDays }).set({
    hour: time.hour,
    minute: time.minute,
    second: 0,
    millisecond: 0,
  });

  // Luxon reports invalid only for an unknown zone; a local time that does not
  // exist because of a spring-forward is moved forward instead, which is the
  // behaviour we want for an alarm.
  if (!target.isValid) return undefined;

  return target.toJSDate();
}

/**
 * The offset a reminder type stands for.
 *
 * CUSTOM has no fixed offset; the caller supplies its own.
 */
export const REMINDER_TYPE_OFFSETS: Record<string, number> = {
  DAYS_30: 30,
  DAYS_14: 14,
  DAYS_7: 7,
  DAYS_3: 3,
  DAYS_1: 1,
  START_DAY: 0,
};

function parseTime(value: string): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value?.trim() ?? '');
  if (!match) return undefined;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;

  return { hour, minute };
}
