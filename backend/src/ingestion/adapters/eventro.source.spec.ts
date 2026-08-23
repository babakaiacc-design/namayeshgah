import { readFileSync } from 'fs';
import { join } from 'path';

import { Fetcher, RawResponse } from '../../common/http/fetcher';
import { EventroSource, isoDate, parseEnglishDate } from './eventro.source';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../test/fixtures', name), 'utf8');

const TEHRAN_LISTING = fixture('eventro-tehran.html');
const GERMANY_LISTING = fixture('eventro-germany.html');
const EVENT_DETAIL = fixture('eventro-event-53066.html');
const MONTH_ONLY = fixture('eventro-month-only-date.html');

describe('parseEnglishDate', () => {
  it('parses the listing date format', () => {
    expect(parseEnglishDate('31 August 2026')).toBe('2026-08-31');
    expect(parseEnglishDate('01 September 2026')).toBe('2026-09-01');
  });

  it('rejects a two-digit year rather than guessing the century', () => {
    expect(parseEnglishDate('Mon 31 August 26')).toBeUndefined();
  });

  it('rejects an impossible day instead of rolling into the next month', () => {
    expect(parseEnglishDate('31 February 2026')).toBeUndefined();
  });

  it('returns undefined for junk', () => {
    expect(parseEnglishDate('')).toBeUndefined();
    expect(parseEnglishDate('به زودی')).toBeUndefined();
    expect(parseEnglishDate(undefined)).toBeUndefined();
  });
});

describe('isoDate', () => {
  it("accepts the site's malformed datetime and keeps the date part", () => {
    expect(isoDate('2026-08-31:00.000')).toBe('2026-08-31');
    expect(isoDate('2026-09-03:00.000')).toBe('2026-09-03');
  });

  it('rejects an invalid calendar date', () => {
    expect(isoDate('2026-02-31:00.000')).toBeUndefined();
    expect(isoDate('not-a-date')).toBeUndefined();
  });
});

describe('EventroSource listing parser', () => {
  const source = new EventroSource();

  it('extracts events from the real Tehran page', () => {
    const items = source.parseListing(TEHRAN_LISTING, 'tehran');
    expect(items.length).toBeGreaterThan(5);
  });

  it('reads the stable event code, which anchors deduplication', () => {
    const items = source.parseListing(TEHRAN_LISTING, 'tehran');
    const elecomp = items.find((item) => item.sourceExternalId === '53066');

    expect(elecomp).toBeDefined();
    expect(elecomp!.title).toContain('الکامپ');
    expect(elecomp!.sourceUrl).toBe('https://eventro.ir/events/53066');
  });

  it('takes the Gregorian date the site printed rather than converting Jalali', () => {
    const items = source.parseListing(TEHRAN_LISTING, 'tehran');
    const elecomp = items.find((item) => item.sourceExternalId === '53066')!;

    expect(elecomp.startDate).toBe('2026-08-31');
    // The Jalali text is kept verbatim for cross-checking, never parsed.
    expect(elecomp.rawStartDate).toContain('شهریور');
  });

  it('leaves the end date unset, because the listing never states one', () => {
    const items = source.parseListing(TEHRAN_LISTING, 'tehran');
    for (const item of items) {
      expect(item.endDate).toBeUndefined();
    }
  });

  it('gives every event a source url', () => {
    const items = source.parseListing(TEHRAN_LISTING, 'tehran');
    for (const item of items) {
      expect(item.sourceUrl).toMatch(/^https:\/\/eventro\.ir\//);
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  it('parses the German page with the same code path', () => {
    // One adapter has to serve phase 1 (Tehran) and phase 3 (international).
    const items = source.parseListing(GERMANY_LISTING, 'germany');
    expect(items.length).toBeGreaterThan(3);
    expect(items.every((item) => item.sourceExternalId)).toBe(true);
  });

  it('reports past events with their status instead of dropping them', () => {
    const items = source.parseListing(GERMANY_LISTING, 'germany');
    const held = items.filter((item) => item.status?.includes('برگزار شده'));
    expect(held.length).toBeGreaterThan(0);
  });

  it('does not pick up sidebar widgets that share the item class', () => {
    const items = source.parseListing(TEHRAN_LISTING, 'tehran');
    // Everything inside the results container links to /events/{id}.
    expect(items.every((item) => /\/events\/\d+$/.test(item.sourceUrl))).toBe(true);
  });
});

describe('EventroSource with a month-only date', () => {
  const source = new EventroSource();

  // Real case from the live listing: eventro states "مرداد 1405 / July 2026"
  // for an event whose exact day is not fixed.
  it('refuses to invent a day and records a warning', () => {
    const warnings: string[] = [];
    const [item] = source.parseListing(MONTH_ONLY, 'tehran', warnings);

    expect(item.sourceExternalId).toBe('53064');
    expect(item.startDate).toBeUndefined();
    expect(warnings.some((w) => w.includes('July 2026'))).toBe(true);
  });

  it('still keeps the record, with the raw date preserved', () => {
    const [item] = source.parseListing(MONTH_ONLY, 'tehran');

    expect(item.title).toContain('مبلمان');
    expect(item.rawStartDate).toContain('مرداد');
  });
});

describe('EventroSource detail parser', () => {
  const source = new EventroSource();

  const parseDetail = () => {
    const [listing] = source
      .parseListing(TEHRAN_LISTING, 'tehran')
      .filter((item) => item.sourceExternalId === '53066');
    const warnings: string[] = [];
    return { raw: source.applyDetail(listing, EVENT_DETAIL, warnings), warnings };
  };

  it('fills in the end date from schema.org microdata', () => {
    const { raw } = parseDetail();
    expect(raw.startDate).toBe('2026-08-31');
    expect(raw.endDate).toBe('2026-09-03');
  });

  it('extracts the venue, which the listing does not carry', () => {
    const { raw } = parseDetail();
    expect(raw.venue).toBe('محل دائمی نمایشگاه های بین المللی تهران');
  });

  it('resolves the city from the address chain', () => {
    const { raw } = parseDetail();
    expect(raw.city).toBe('تهران');
    expect(raw.country).toBe('ایران');
  });

  it('extracts the organizer and contact details', () => {
    const { raw } = parseDetail();
    expect(raw.organizer).toContain('راهکار تجارت');
    expect(raw.organizerContact).toBeDefined();
    expect(raw.officialWebsite).toContain('elecopmiran.com');
  });

  it('records the upstream source eventro cites', () => {
    // eventro attributes this event to the official calendar we cannot reach
    // directly, which the confidence model should know about.
    const { raw } = parseDetail();
    expect(raw.extra?.upstreamUrl).toContain('calendar.iranfair.com');
  });

  it('agrees with the listing date and raises no conflict warning', () => {
    const { warnings } = parseDetail();
    expect(warnings.filter((w) => w.includes('disagreement'))).toEqual([]);
  });

  it('warns instead of silently choosing when the two dates disagree', () => {
    const raw = { sourceUrl: 'https://eventro.ir/events/1', title: 't', startDate: '2026-01-01' };
    const warnings: string[] = [];
    source.applyDetail(raw, EVENT_DETAIL, warnings);
    expect(warnings.some((w) => w.includes('disagreement'))).toBe(true);
  });
});

describe('EventroSource end to end against fixtures', () => {
  const source = new EventroSource();

  /** Serves saved pages so the test never touches the network. */
  const fixtureFetcher = (calls: string[] = []): Fetcher => ({
    async get(url: string): Promise<RawResponse> {
      calls.push(url);
      const body = url.includes('/tc/fairs/tehran')
        ? TEHRAN_LISTING
        : url.includes('/events/53066')
          ? EVENT_DETAIL
          : '<html></html>';
      return { url, status: 200, body, headers: {}, notModified: false };
    },
  });

  it('returns fully populated records', async () => {
    const result = await source.fetchExhibitions({
      fetcher: fixtureFetcher(),
      locations: ['tehran'],
    });

    const elecomp = result.exhibitions.find((e) => e.sourceExternalId === '53066')!;
    expect(elecomp.startDate).toBe('2026-08-31');
    expect(elecomp.endDate).toBe('2026-09-03');
    expect(elecomp.venue).toBe('محل دائمی نمایشگاه های بین المللی تهران');
  });

  it('honours the detail fetch budget', async () => {
    const calls: string[] = [];
    await source.fetchExhibitions({
      fetcher: fixtureFetcher(calls),
      locations: ['tehran'],
      maxDetailFetches: 3,
    });

    const detailCalls = calls.filter((url) => url.includes('/events/'));
    expect(detailCalls).toHaveLength(3);
  });

  it('skips work entirely when the listing is unchanged', async () => {
    const calls: string[] = [];
    const result = await source.fetchExhibitions({
      fetcher: {
        async get(url) {
          calls.push(url);
          return { url, status: 304, body: '', headers: {}, notModified: true };
        },
      },
      locations: ['tehran'],
    });

    expect(result.exhibitions).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('records a warning instead of failing the run when a fetch breaks', async () => {
    const result = await source.fetchExhibitions({
      fetcher: {
        async get() {
          throw new Error('connection reset');
        },
      },
      locations: ['tehran'],
    });

    expect(result.exhibitions).toEqual([]);
    expect(result.warnings[0]).toContain('connection reset');
  });

  it('still yields listing data when detail pages fail', async () => {
    let first = true;
    const result = await source.fetchExhibitions({
      fetcher: {
        async get(url) {
          if (first) {
            first = false;
            return { url, status: 200, body: TEHRAN_LISTING, headers: {}, notModified: false };
          }
          throw new Error('detail timeout');
        },
      },
      locations: ['tehran'],
    });

    expect(result.exhibitions.length).toBeGreaterThan(0);
    expect(result.exhibitions[0].startDate).toBeDefined();
    expect(result.warnings.some((w) => w.includes('detail timeout'))).toBe(true);
  });
});
