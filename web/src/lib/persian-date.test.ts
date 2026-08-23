import { describe, expect, it } from 'vitest';

import {
  addDays,
  addJalaliMonths,
  daysBetween,
  describeCountdown,
  describeFreshness,
  formatJalali,
  formatJalaliNumeric,
  formatJalaliRange,
  fromJalali,
  jalaliMonth,
  toJalali,
  toLatinDigits,
  toPersianDigits,
  todayInZone,
} from './persian-date';

describe('toJalali', () => {
  it('matches the date the real source published', () => {
    // eventro listed event 53066 as "09 شهریور 1405 / 31 August 2026".
    // Our stored Gregorian date must render back to exactly that Jalali date.
    expect(toJalali('2026-08-31')).toEqual({ year: 1405, month: 6, day: 9 });
  });

  it('handles the Persian new year boundary', () => {
    expect(toJalali('2026-03-20')).toEqual({ year: 1404, month: 12, day: 29 });
    expect(toJalali('2026-03-21')).toEqual({ year: 1405, month: 1, day: 1 });
  });

  it('rejects an impossible date instead of rolling it over', () => {
    expect(toJalali('2026-02-31')).toBeUndefined();
    expect(toJalali('not-a-date')).toBeUndefined();
  });
});

describe('formatJalali', () => {
  it('renders with Persian digits and month name', () => {
    expect(formatJalali('2026-08-31')).toBe('۹ شهریور ۱۴۰۵');
  });

  it('renders the numeric form', () => {
    expect(formatJalaliNumeric('2026-08-31')).toBe('۱۴۰۵/۰۶/۰۹');
  });

  it('returns an empty string rather than throwing on missing input', () => {
    expect(formatJalali(null)).toBe('');
    expect(formatJalali(undefined)).toBe('');
    expect(formatJalaliNumeric('')).toBe('');
  });
});

describe('formatJalaliRange', () => {
  it('repeats only what changes within one month', () => {
    // The shape section 20 of the brief asks for.
    expect(formatJalaliRange('2026-08-30', '2026-09-02')).toBe('۸ تا ۱۱ شهریور ۱۴۰۵');
  });

  it('keeps both month names when the range crosses a month', () => {
    expect(formatJalaliRange('2026-08-19', '2026-08-25')).toBe('۲۸ مرداد تا ۳ شهریور ۱۴۰۵');
  });

  it('keeps both years when the range crosses the new year', () => {
    expect(formatJalaliRange('2026-03-19', '2026-03-22')).toBe(
      '۲۸ اسفند ۱۴۰۴ تا ۲ فروردین ۱۴۰۵',
    );
  });

  it('collapses a single-day range', () => {
    expect(formatJalaliRange('2026-08-31', '2026-08-31')).toBe('۹ شهریور ۱۴۰۵');
  });

  it('says "from" when only a start date is known', () => {
    // An exhibition whose end date no source published.
    expect(formatJalaliRange('2026-08-31', null)).toBe('۹ شهریور ۱۴۰۵');
  });

  it('returns empty when there is no start date at all', () => {
    expect(formatJalaliRange(null, null)).toBe('');
  });
});

describe('fromJalali', () => {
  it('round-trips with toJalali', () => {
    const samples = ['2026-08-31', '2026-03-21', '2026-01-01', '2025-12-31', '2027-06-15'];
    for (const iso of samples) {
      const parts = toJalali(iso)!;
      expect(fromJalali(parts.year, parts.month, parts.day)).toBe(iso);
    }
  });

  it('converts the date used throughout the brief', () => {
    // 20 شهریور 1405 is the example date in sections 1 and 13.
    expect(fromJalali(1405, 6, 20)).toBe('2026-09-11');
  });

  it('finds the first day of the Persian year', () => {
    expect(fromJalali(1405, 1, 1)).toBe('2026-03-21');
  });

  it('handles a 30-day Esfand in a leap year', () => {
    // 1403 is a leap year, so 30 Esfand exists.
    expect(fromJalali(1403, 12, 30)).toBe('2025-03-20');
  });

  it('returns undefined for a day that does not exist', () => {
    // 1404 is not a leap year, so there is no 30 Esfand.
    expect(fromJalali(1404, 12, 30)).toBeUndefined();
    expect(fromJalali(1405, 13, 1)).toBeUndefined();
    expect(fromJalali(1405, 0, 1)).toBeUndefined();
  });
});

describe('jalaliMonth', () => {
  it('reports 31 days for the first half of the year', () => {
    const month = jalaliMonth(1405, 6)!;
    expect(month.name).toBe('شهریور');
    expect(month.daysInMonth).toBe(31);
    expect(month.firstDay).toBe('2026-08-23');
  });

  it('reports 30 days for the second half of the year', () => {
    expect(jalaliMonth(1405, 7)!.daysInMonth).toBe(30);
  });

  it('derives Esfand length from the platform rather than a hard-coded rule', () => {
    expect(jalaliMonth(1403, 12)!.daysInMonth).toBe(30); // leap
    expect(jalaliMonth(1404, 12)!.daysInMonth).toBe(29); // common
  });

  it('places the first day in the right column, Saturday first', () => {
    const month = jalaliMonth(1405, 1)!;
    // 1405-01-01 is 2026-03-21, a Saturday.
    expect(month.startWeekday).toBe(0);
  });
});

describe('addJalaliMonths', () => {
  it('moves forward within a year', () => {
    expect(addJalaliMonths(1405, 6, 1)).toMatchObject({ year: 1405, month: 7 });
  });

  it('wraps to the next year', () => {
    expect(addJalaliMonths(1405, 12, 1)).toMatchObject({ year: 1406, month: 1 });
  });

  it('wraps back to the previous year', () => {
    expect(addJalaliMonths(1405, 1, -1)).toMatchObject({ year: 1404, month: 12 });
  });
});

describe('digits', () => {
  it('converts to Persian digits', () => {
    expect(toPersianDigits(1405)).toBe('۱۴۰۵');
    expect(toPersianDigits('8 - 11')).toBe('۸ - ۱۱');
  });

  it('round-trips', () => {
    expect(toLatinDigits(toPersianDigits('2026-08-31'))).toBe('2026-08-31');
  });
});

describe('todayInZone', () => {
  it('returns the wire format directly', () => {
    const at = new Date('2026-08-31T20:00:00Z');
    expect(todayInZone('Asia/Tehran', at)).toBe('2026-08-31');
  });

  it('is already tomorrow in Tehran while still today in London', () => {
    // Late-evening UTC crosses midnight in Tehran. Getting this wrong makes
    // the home screen show the wrong day for several hours every night.
    const at = new Date('2026-08-31T21:00:00Z');
    expect(todayInZone('Asia/Tehran', at)).toBe('2026-09-01');
    expect(todayInZone('Europe/London', at)).toBe('2026-08-31');
  });
});

describe('date arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-08-31', '2026-09-03')).toBe(3);
    expect(daysBetween('2026-09-03', '2026-08-31')).toBe(-3);
  });
});

describe('describeCountdown', () => {
  it('reads naturally', () => {
    expect(describeCountdown(0)).toBe('امروز');
    expect(describeCountdown(1)).toBe('فردا');
    expect(describeCountdown(5)).toBe('۵ روز دیگر');
    expect(describeCountdown(-2)).toBe('برگزار شده');
  });

  it('says nothing rather than inventing a countdown for an unknown date', () => {
    // The caller renders an explicit "تاریخ نامشخص" instead.
    expect(describeCountdown(null)).toBeNull();
    expect(describeCountdown(undefined)).toBeNull();
  });
});

describe('describeFreshness', () => {
  const now = new Date('2026-08-31T12:00:00Z');

  it('reports how long ago the data was checked', () => {
    expect(describeFreshness('2026-08-31T08:00:00Z', now)).toBe('آخرین بررسی: امروز');
    expect(describeFreshness('2026-08-30T08:00:00Z', now)).toBe('آخرین بررسی: دیروز');
    expect(describeFreshness('2026-08-28T08:00:00Z', now)).toBe('آخرین بررسی: ۳ روز پیش');
  });

  it('says nothing when the data has never been verified', () => {
    expect(describeFreshness(null, now)).toBeNull();
    expect(describeFreshness('nonsense', now)).toBeNull();
  });
});
