import { DateTime } from 'luxon';

import { REMINDER_TYPE_OFFSETS, computeRemindAt } from './reminder-time';

/** Renders an instant back into a given zone, for readable assertions. */
const inZone = (date: Date | undefined, zone: string): string =>
  DateTime.fromJSDate(date as Date, { zone }).toFormat('yyyy-MM-dd HH:mm');

describe('computeRemindAt', () => {
  it('fires the requested number of days before the start', () => {
    const result = computeRemindAt('2026-09-11', 7, '09:00', 'Asia/Tehran');
    expect(inZone(result, 'Asia/Tehran')).toBe('2026-09-04 09:00');
  });

  it('fires on the start day itself for a zero offset', () => {
    const result = computeRemindAt('2026-09-11', 0, '08:00', 'Asia/Tehran');
    expect(inZone(result, 'Asia/Tehran')).toBe('2026-09-11 08:00');
  });

  it('crosses a month boundary correctly', () => {
    const result = computeRemindAt('2026-09-03', 30, '09:00', 'Asia/Tehran');
    expect(inZone(result, 'Asia/Tehran')).toBe('2026-08-04 09:00');
  });

  it('resolves the wall clock in the exhibition city, not the server zone', () => {
    // The same offset in two cities produces two different instants, which is
    // the entire point of storing the timezone.
    const tehran = computeRemindAt('2026-09-11', 1, '09:00', 'Asia/Tehran');
    const dubai = computeRemindAt('2026-09-11', 1, '09:00', 'Asia/Dubai');

    expect(inZone(tehran, 'Asia/Tehran')).toBe('2026-09-10 09:00');
    expect(inZone(dubai, 'Asia/Dubai')).toBe('2026-09-10 09:00');
    // Tehran is UTC+3:30, Dubai UTC+4, so Tehran fires half an hour later.
    expect(tehran!.getTime() - dubai!.getTime()).toBe(30 * 60 * 1000);
  });

  it('keeps the local hour across a daylight saving change', () => {
    // Berlin moves to summer time on 2026-03-29. A reminder set before the
    // change must still fire at 09:00 local, not 08:00 or 10:00.
    const before = computeRemindAt('2026-03-28', 0, '09:00', 'Europe/Berlin');
    const after = computeRemindAt('2026-04-05', 0, '09:00', 'Europe/Berlin');

    expect(inZone(before, 'Europe/Berlin')).toBe('2026-03-28 09:00');
    expect(inZone(after, 'Europe/Berlin')).toBe('2026-04-05 09:00');
    // The UTC offset differs, proving the conversion is zone aware.
    expect(before!.getUTCHours()).not.toBe(after!.getUTCHours());
  });

  it('counts back across a daylight saving boundary in days, not hours', () => {
    const result = computeRemindAt('2026-04-02', 7, '09:00', 'Europe/Berlin');
    expect(inZone(result, 'Europe/Berlin')).toBe('2026-03-26 09:00');
  });

  it('returns undefined when no date has been published', () => {
    // An UNKNOWN exhibition date leaves the reminder unscheduled but recorded.
    expect(computeRemindAt(null, 7, '09:00', 'Asia/Tehran')).toBeUndefined();
    expect(computeRemindAt(undefined, 7, '09:00', 'Asia/Tehran')).toBeUndefined();
  });

  it('rejects a malformed time rather than guessing', () => {
    expect(computeRemindAt('2026-09-11', 7, '25:00', 'Asia/Tehran')).toBeUndefined();
    expect(computeRemindAt('2026-09-11', 7, '9am', 'Asia/Tehran')).toBeUndefined();
    expect(computeRemindAt('2026-09-11', 7, '', 'Asia/Tehran')).toBeUndefined();
  });

  it('rejects a negative or fractional offset', () => {
    expect(computeRemindAt('2026-09-11', -1, '09:00', 'Asia/Tehran')).toBeUndefined();
    expect(computeRemindAt('2026-09-11', 1.5, '09:00', 'Asia/Tehran')).toBeUndefined();
  });

  it('rejects an unknown timezone instead of silently using UTC', () => {
    expect(computeRemindAt('2026-09-11', 7, '09:00', 'Mars/Olympus')).toBeUndefined();
  });

  it('rejects a malformed date', () => {
    expect(computeRemindAt('11-09-2026', 7, '09:00', 'Asia/Tehran')).toBeUndefined();
  });

  it('accepts seconds in the offset time', () => {
    const result = computeRemindAt('2026-09-11', 1, '09:30:00', 'Asia/Tehran');
    expect(inZone(result, 'Asia/Tehran')).toBe('2026-09-10 09:30');
  });
});

describe('recalculation after an exhibition moves', () => {
  // The scenario from section 22 of the brief.
  const timezone = 'Asia/Tehran';

  it('shifts the reminder by the same amount as the exhibition', () => {
    const before = computeRemindAt('2026-09-11', 7, '09:00', timezone);
    const after = computeRemindAt('2026-09-16', 7, '09:00', timezone);

    expect(inZone(before, timezone)).toBe('2026-09-04 09:00');
    expect(inZone(after, timezone)).toBe('2026-09-09 09:00');
  });

  it('preserves the offset rather than the absolute time', () => {
    // Storing only remind_at would make this impossible: there would be no way
    // to know the user asked for "seven days before".
    const originalStart = '2026-09-11';
    const movedStart = '2026-09-16';

    for (const offset of [30, 14, 7, 3, 1, 0]) {
      const before = computeRemindAt(originalStart, offset, '09:00', timezone)!;
      const after = computeRemindAt(movedStart, offset, '09:00', timezone)!;
      const shift = (after.getTime() - before.getTime()) / 86_400_000;
      expect(shift).toBe(5);
    }
  });
});

describe('REMINDER_TYPE_OFFSETS', () => {
  it('covers every fixed option in the brief', () => {
    expect(REMINDER_TYPE_OFFSETS).toEqual({
      DAYS_30: 30,
      DAYS_14: 14,
      DAYS_7: 7,
      DAYS_3: 3,
      DAYS_1: 1,
      START_DAY: 0,
    });
  });

  it('has no entry for CUSTOM, which carries its own offset', () => {
    expect(REMINDER_TYPE_OFFSETS.CUSTOM).toBeUndefined();
  });
});
