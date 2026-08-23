import * as cheerio from 'cheerio';

import { Fetcher } from '../../common/http/fetcher';
import {
  ExhibitionSource,
  RawExhibition,
  SourceContext,
  SourceResult,
} from './exhibition-source';

/**
 * eventro.ir — the primary source (see DATA_SOURCES.md section 2).
 *
 * Two properties make it the best option available:
 *
 *  - every event carries a stable numeric code, which is the strongest
 *    deduplication signal we can get;
 *  - the detail page publishes schema.org microdata with ISO dates, so the
 *    adapter never has to interpret a Persian month name or a two-digit year.
 *
 * Parsing keys off the Persian label text ("کد رویداد:", "مکان:") rather than
 * CSS position, because the site runs Joomla and a template update would move
 * the elements while leaving the labels intact.
 *
 * The same adapter serves Tehran and any foreign location: eventro uses one
 * URL shape, /tc/fairs/{location}, for both.
 */
export class EventroSource implements ExhibitionSource {
  readonly name = 'eventro';
  readonly displayName = 'Eventro';
  readonly baseUrl = 'https://eventro.ir';

  async fetchExhibitions(context: SourceContext): Promise<SourceResult> {
    const exhibitions: RawExhibition[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    let detailBudget = context.maxDetailFetches ?? Number.POSITIVE_INFINITY;

    for (const location of context.locations) {
      const listUrl = `${this.baseUrl}/tc/fairs/${location}`;

      let html: string;
      try {
        const response = await context.fetcher.get(listUrl);
        if (response.notModified) {
          context.logger?.debug(`eventro: ${location} unchanged`);
          continue;
        }
        html = response.body;
      } catch (error) {
        warnings.push(`eventro: failed to fetch ${listUrl}: ${(error as Error).message}`);
        continue;
      }

      const items = this.parseListing(html, location, warnings);

      for (const item of items) {
        const key = item.sourceExternalId ?? item.sourceUrl;
        if (seen.has(key)) continue;
        seen.add(key);

        // The listing carries a single date; only the detail page states an end
        // date, a venue and an organizer. Without it the record would be
        // permanently missing its end date, so the detail fetch is worth the
        // extra request.
        if (detailBudget > 0) {
          detailBudget -= 1;
          try {
            const detail = await context.fetcher.get(item.sourceUrl);
            if (!detail.notModified) {
              this.applyDetail(item, detail.body, warnings);
            }
          } catch (error) {
            warnings.push(
              `eventro: detail fetch failed for ${item.sourceUrl}: ${(error as Error).message}`,
            );
          }
        }

        exhibitions.push(item);
      }
    }

    return { exhibitions, warnings };
  }

  /** Exposed for tests so a saved fixture can be parsed without a network. */
  parseListing(html: string, location: string, warnings: string[] = []): RawExhibition[] {
    const $ = cheerio.load(html);
    const results: RawExhibition[] = [];

    // Scope to the results container: `.allmode_item` is also used by sidebar
    // widgets, which would otherwise be ingested as exhibitions.
    $('#eventslistarea .allmode_item').each((_, element) => {
      const item = $(element);
      const link = item.find('h4.allmode_title a').first();
      const href = link.attr('href')?.trim();
      const title = collapse(link.text());

      if (!href || !title) {
        warnings.push('eventro: listing row without a title link, skipped');
        return;
      }

      const externalId = href.match(/\/events\/(\d+)/)?.[1];

      const raw: RawExhibition = {
        sourceExternalId: externalId,
        sourceUrl: absolute(href, this.baseUrl),
        title,
        city: location,
        imageUrl: item.find('.allmode_img img').attr('src')?.trim(),
        extra: { listingLocation: location },
      };

      // Label-driven extraction: read the visible Persian label, then take the
      // adjacent value element.
      item.find('.event_detail').each((__, detail) => {
        const block = $(detail);
        const label = collapse(block.find('.dt0').first().text()).replace(/[:：]\s*$/, '');
        const valueEl = block.find('.dt1').first();
        const value = collapse(valueEl.text());
        if (!label) return;

        if (label.includes('کد رویداد')) {
          raw.sourceExternalId = raw.sourceExternalId ?? (value || undefined);
        } else if (label.includes('تاریخ برگزاری')) {
          // Jalali text and a Gregorian rendering sit side by side; keep both.
          const gregorian = collapse(valueEl.find('.ltr').first().text());
          raw.rawStartDate = collapse(value.replace(gregorian, ''));
          const iso = parseEnglishDate(gregorian);
          if (iso) {
            raw.startDate = iso;
          } else if (gregorian) {
            warnings.push(`eventro: unrecognized listing date "${gregorian}" for ${title}`);
          }
        } else if (label.includes('مکان')) {
          // On this site the listing "مکان" is the CITY, not the venue; the
          // venue only appears on the detail page.
          raw.city = value || location;
        } else if (label.includes('وضعیت')) {
          raw.status = value || undefined;
        }
      });

      results.push(raw);
    });

    return results;
  }

  /** Exposed for tests. Merges detail-page facts into a listing record. */
  applyDetail(raw: RawExhibition, html: string, warnings: string[] = []): RawExhibition {
    const $ = cheerio.load(html);

    const microdata = (prop: string): string | undefined =>
      $(`meta[itemprop="${prop}"]`).first().attr('content')?.trim() || undefined;

    // Preferred path: schema.org microdata. The site emits a slightly malformed
    // datetime ("2026-08-31:00.000"), but the leading date is clean ISO, and
    // taking it avoids parsing month names or two-digit years entirely.
    const start = isoDate(microdata('startDate'));
    const end = isoDate(microdata('endDate'));

    if (start) {
      if (raw.startDate && raw.startDate !== start) {
        // Never silently pick a winner — surface it and let the pipeline
        // record a conflict.
        warnings.push(
          `eventro: start date disagreement for ${raw.sourceUrl}: listing ${raw.startDate} vs detail ${start}`,
        );
      }
      raw.startDate = start;
    }
    if (end) raw.endDate = end;

    const venue = microdata('location');
    if (venue) raw.venue = venue;

    const address = microdata('address');
    if (address) {
      raw.extra = { ...raw.extra, address };
      // "آسیا، خاورمیانه، ایران، استان تهران، تهران" — last part is the city.
      const parts = address.split('،').map((part) => part.trim()).filter(Boolean);
      if (parts.length > 0) raw.city = parts[parts.length - 1];
      if (parts.length > 2) raw.country = parts[2];
    }

    const image = microdata('image');
    if (image) raw.imageUrl = image;

    const eventStatus = microdata('eventStatus');
    if (eventStatus) raw.extra = { ...raw.extra, eventStatus };

    // Remaining fields have no microdata, so fall back to label lookup.
    const labelled = this.readLabelledValues($);

    const organizer = microdata('organizer') ?? labelled.get('برگزارکننده');
    if (organizer) raw.organizer = collapse(organizer);

    const contact = labelled.get('اطلاعات تماس');
    if (contact) {
      raw.organizerContact = contact;
      const website = contact.match(/((?:https?:\/\/)?(?:www\.)[^\s,]+)/)?.[1];
      if (website) raw.officialWebsite = website.startsWith('http') ? website : `https://${website}`;
    }

    // eventro cites where it got the event from. When that upstream is the
    // official calendar we cannot reach directly, the attribution is worth
    // keeping: it tells the confidence model this is not merely an aggregator's
    // own claim.
    const upstream = labelled.get('منبع ذکر رویداد');
    if (upstream) {
      raw.extra = {
        ...raw.extra,
        upstreamSource: upstream,
        upstreamUrl: upstream.match(/https?:\/\/[^\s)]+/)?.[0],
      };
    }

    const jalaliStart = labelled.get('تاریخ شروع');
    if (jalaliStart) raw.rawStartDate = jalaliStart;
    const jalaliEnd = labelled.get('تاریخ پایان');
    if (jalaliEnd) raw.rawEndDate = jalaliEnd;

    return raw;
  }

  /**
   * Collects "label : value" pairs from the detail page.
   *
   * Where the markup uses the site's own .dt0/.dt1 label/value spans that pair
   * is used directly. The regex fallback exists for blocks like .event_source
   * that carry the label as bare text, and it is applied only to elements with
   * no element children, so a wrapper div cannot swallow all of its
   * descendants' labels into one greedy match.
   */
  private readLabelledValues($: cheerio.CheerioAPI): Map<string, string> {
    const values = new Map<string, string>();

    const record = (label: string, value: string) => {
      const key = collapse(label).replace(/[:：]\s*$/, '');
      const text = collapse(value);
      if (key && text && !values.has(key)) values.set(key, text);
    };

    $('.event_detail').each((_, element) => {
      const block = $(element);
      const label = block.find('.dt0').first();
      if (label.length === 0) return;
      record(label.text(), block.find('.dt1').first().text());
    });

    $('.event_source div, .event_loc > div, .event_contact div').each((_, element) => {
      const block = $(element);
      if (block.find('div').length > 0) return;

      const match = collapse(block.text()).match(/^([^:：]{2,40})[:：]\s*(.+)$/);
      if (match) record(match[1], match[2]);
    });

    return values;
  }
}

const ENGLISH_MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Parses an English Gregorian date such as "31 August 2026".
 *
 * This is a formatting change, not a calendar conversion — the source already
 * did the Jalali-to-Gregorian work. Two-digit years are rejected rather than
 * guessed; the microdata path supplies an unambiguous date anyway.
 */
export function parseEnglishDate(input: string | undefined): string | undefined {
  if (!input) return undefined;

  const match = collapse(input).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = ENGLISH_MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) return undefined;

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible days such as 31 February, which would otherwise roll
  // over into the next month.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;

  return date.toISOString().slice(0, 10);
}

/** Extracts a clean ISO date from a possibly malformed datetime string. */
export function isoDate(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return undefined;
  }
  return `${year}-${month}-${day}`;
}

function collapse(text: string | undefined): string {
  return (text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function absolute(href: string, baseUrl: string): string {
  return href.startsWith('http') ? href : new URL(href, baseUrl).toString();
}
