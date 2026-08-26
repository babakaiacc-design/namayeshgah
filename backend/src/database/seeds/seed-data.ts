/**
 * Reference data for development and first deploy.
 *
 * This file contains NO exhibitions. Per rule 44 of the brief, real exhibition
 * data only ever enters the database through the ingestion pipeline, where it
 * carries a traceable source record. Seeding a "sample" exhibition would create
 * a row whose dates answer to nobody.
 *
 * The aliases below are not invented either — they are the literal category and
 * venue strings observed on the live sources during the survey in
 * docs/DATA_SOURCES.md, which is what makes them useful to the normalizer.
 */

export interface CountrySeed {
  iso2: string;
  nameFa: string;
  nameEn: string;
  defaultLocale: string;
}

export interface CitySeed {
  countryIso2: string;
  slug: string;
  nameFa: string;
  nameEn: string;
  timezone: string;
}

export interface VenueSeed {
  citySlug: string;
  slug: string;
  nameFa: string;
  nameEn?: string;
  address?: string;
  website?: string;
  aliases: string[];
}

export interface CategorySeed {
  slug: string;
  nameFa: string;
  nameEn: string;
  sortOrder: number;
  aliases?: string[];
  children?: CategorySeed[];
}

export interface SourceSeed {
  name: string;
  displayName: string;
  baseUrl: string;
  confidence: number;
  fetchMode: 'DIRECT' | 'RELAY';
  isEnabled: boolean;
  notes: string;
}

export const COUNTRIES: CountrySeed[] = [
  { iso2: 'IR', nameFa: 'ایران', nameEn: 'Iran', defaultLocale: 'fa' },
];

export const CITIES: CitySeed[] = [
  {
    countryIso2: 'IR',
    slug: 'tehran',
    nameFa: 'تهران',
    nameEn: 'Tehran',
    timezone: 'Asia/Tehran',
  },
];

/**
 * Coordinates are deliberately absent.
 *
 * Directions need real latitude/longitude, and guessing them would put a wrong
 * pin on a map with no way for a user to tell. They are left null so the gap is
 * visible; an admin fills them from a verified source before the maps button
 * ships. The venue rows themselves are needed now because the normalizer
 * resolves source venue strings through the alias table.
 */
export const VENUES: VenueSeed[] = [
  {
    citySlug: 'tehran',
    slug: 'tehran-international-fairground',
    nameFa: 'نمایشگاه بین‌المللی تهران',
    nameEn: 'Tehran International Permanent Fairground',
    website: 'https://iranfair.com',
    aliases: [
      'نمایشگاه بین المللی تهران',
      'نمایشگاه بین‌المللی تهران',
      'محل دائمی نمایشگاه های بین المللی تهران',
      'سئول',
      'بزرگراه چمران',
    ],
  },
  {
    citySlug: 'tehran',
    slug: 'shahr-e-aftab',
    nameFa: 'شهر آفتاب',
    nameEn: 'Shahr-e Aftab International Exhibition',
    aliases: ['شهر آفتاب', 'نمایشگاه شهر آفتاب', 'مجموعه نمایشگاهی شهر آفتاب'],
  },
  {
    citySlug: 'tehran',
    slug: 'mosalla-imam-khomeini',
    nameFa: 'مصلی امام خمینی',
    nameEn: 'Imam Khomeini Mosalla',
    aliases: ['مصلی', 'مصلای امام خمینی', 'مصلی امام خمینی', 'مصلای تهران'],
  },
  {
    citySlug: 'tehran',
    slug: 'iran-mall',
    nameFa: 'ایران مال',
    nameEn: 'Iran Mall',
    aliases: ['ایران مال', 'مرکز همایش های ایران مال', 'نمایشگاه ایران مال'],
  },
  {
    citySlug: 'tehran',
    slug: 'milad-tower',
    nameFa: 'برج میلاد',
    nameEn: 'Milad Tower',
    aliases: ['برج میلاد', 'مرکز همایش های برج میلاد'],
  },
];

/**
 * Category tree from section 7 of the brief.
 *
 * Aliases are the raw category labels seen on eventro.ir, so the normalizer can
 * map a source's taxonomy onto ours without a hand-maintained switch statement.
 */
export const CATEGORIES: CategorySeed[] = [
  {
    slug: 'industry',
    nameFa: 'صنعت',
    nameEn: 'Industry',
    sortOrder: 1,
    aliases: ['صنعت، معدن و تجارت', 'فنی مهندسی و علوم پایه'],
    children: [
      { slug: 'machinery', nameFa: 'ماشین‌آلات', nameEn: 'Machinery', sortOrder: 1 },
      { slug: 'tools', nameFa: 'ابزار', nameEn: 'Tools', sortOrder: 2 },
      { slug: 'automation', nameFa: 'اتوماسیون', nameEn: 'Automation', sortOrder: 3 },
      {
        slug: 'oil-gas',
        nameFa: 'نفت و گاز',
        nameEn: 'Oil and Gas',
        sortOrder: 4,
        aliases: ['انرژی، نفت، گاز و پتروشیمی'],
      },
      { slug: 'petrochemical', nameFa: 'پتروشیمی', nameEn: 'Petrochemical', sortOrder: 5 },
    ],
  },
  {
    slug: 'technology',
    nameFa: 'فناوری',
    nameEn: 'Technology',
    sortOrder: 2,
    aliases: ['کامپیوتر و فناوری اطلاعات'],
    children: [
      { slug: 'it', nameFa: 'فناوری اطلاعات', nameEn: 'IT', sortOrder: 1 },
      { slug: 'ai', nameFa: 'هوش مصنوعی', nameEn: 'AI', sortOrder: 2 },
      { slug: 'electronics', nameFa: 'الکترونیک', nameEn: 'Electronics', sortOrder: 3 },
      { slug: 'telecom', nameFa: 'مخابرات', nameEn: 'Telecommunications', sortOrder: 4 },
      { slug: 'software', nameFa: 'نرم‌افزار', nameEn: 'Software', sortOrder: 5 },
    ],
  },
  {
    slug: 'construction',
    nameFa: 'ساختمان',
    nameEn: 'Construction',
    sortOrder: 3,
    aliases: ['شهرسازی، عمران و معماری'],
    children: [
      { slug: 'building', nameFa: 'ساختمان', nameEn: 'Building', sortOrder: 1 },
      { slug: 'architecture', nameFa: 'معماری', nameEn: 'Architecture', sortOrder: 2 },
      {
        slug: 'decoration-construction',
        nameFa: 'دکوراسیون ساختمانی',
        nameEn: 'Architectural Decoration',
        sortOrder: 3,
      },
      { slug: 'hvac', nameFa: 'تأسیسات', nameEn: 'HVAC and Utilities', sortOrder: 4 },
      { slug: 'elevator', nameFa: 'آسانسور', nameEn: 'Elevators', sortOrder: 5 },
    ],
  },
  {
    slug: 'home-lifestyle',
    nameFa: 'خانه و سبک زندگی',
    nameEn: 'Home and Lifestyle',
    sortOrder: 4,
    aliases: ['خانه، خانه داری و دکوراسیون'],
    children: [
      { slug: 'furniture', nameFa: 'مبلمان', nameEn: 'Furniture', sortOrder: 1 },
      {
        slug: 'home-decoration',
        nameFa: 'دکوراسیون داخلی',
        nameEn: 'Interior Decoration',
        sortOrder: 2,
      },
      { slug: 'kitchen', nameFa: 'آشپزخانه', nameEn: 'Kitchen', sortOrder: 3 },
      { slug: 'appliances', nameFa: 'لوازم خانگی', nameEn: 'Home Appliances', sortOrder: 4 },
    ],
  },
  {
    slug: 'fashion',
    nameFa: 'مد و پوشاک',
    nameEn: 'Fashion and Apparel',
    sortOrder: 5,
    aliases: ['مد، پوشاک و صنایع نساجی'],
    children: [
      { slug: 'apparel', nameFa: 'پوشاک', nameEn: 'Apparel', sortOrder: 1 },
      { slug: 'textile', nameFa: 'نساجی', nameEn: 'Textile', sortOrder: 2 },
      { slug: 'footwear', nameFa: 'کفش', nameEn: 'Footwear', sortOrder: 3 },
      { slug: 'leather', nameFa: 'چرم', nameEn: 'Leather', sortOrder: 4 },
      { slug: 'jewelry', nameFa: 'زیورآلات', nameEn: 'Jewelry', sortOrder: 5 },
    ],
  },
  {
    slug: 'food',
    nameFa: 'مواد غذایی',
    nameEn: 'Food and Beverage',
    sortOrder: 6,
    aliases: ['صنایع غذایی و کشاورزی'],
    children: [
      { slug: 'food-industry', nameFa: 'صنایع غذایی', nameEn: 'Food Industry', sortOrder: 1 },
      { slug: 'beverage', nameFa: 'نوشیدنی', nameEn: 'Beverage', sortOrder: 2 },
      { slug: 'coffee', nameFa: 'قهوه', nameEn: 'Coffee', sortOrder: 3 },
      {
        slug: 'confectionery',
        nameFa: 'شیرینی و شکلات',
        nameEn: 'Confectionery and Chocolate',
        sortOrder: 4,
      },
    ],
  },
  {
    slug: 'medical',
    nameFa: 'پزشکی',
    nameEn: 'Medical',
    sortOrder: 7,
    aliases: ['علوم پزشکی، دارویی و درمان'],
    children: [
      {
        slug: 'medical-equipment',
        nameFa: 'تجهیزات پزشکی',
        nameEn: 'Medical Equipment',
        sortOrder: 1,
      },
      { slug: 'pharmaceutical', nameFa: 'دارویی', nameEn: 'Pharmaceutical', sortOrder: 2 },
      { slug: 'dental', nameFa: 'دندانپزشکی', nameEn: 'Dentistry', sortOrder: 3 },
      { slug: 'laboratory', nameFa: 'آزمایشگاهی', nameEn: 'Laboratory', sortOrder: 4 },
    ],
  },
  {
    slug: 'transport-logistics',
    nameFa: 'حمل و نقل و لجستیک',
    nameEn: 'Transport and Logistics',
    sortOrder: 8,
    aliases: ['صنایع لجستیک و حمل و نقل', 'ودرو و موتورسیکلت'],
    children: [
      { slug: 'automotive', nameFa: 'خودرو', nameEn: 'Automotive', sortOrder: 1 },
      { slug: 'logistics', nameFa: 'لجستیک', nameEn: 'Logistics', sortOrder: 2 },
    ],
  },
  {
    slug: 'tourism',
    nameFa: 'گردشگری',
    nameEn: 'Tourism',
    sortOrder: 9,
    aliases: ['تفریح، سفر و گردشگری', 'میراث فرهنگی و صنایع دستی'],
  },
  {
    slug: 'other',
    nameFa: 'سایر',
    nameEn: 'Other',
    sortOrder: 99,
  },
];

/**
 * Confidence values follow section 6 of DATA_SOURCES.md. The two blocked
 * sources ship disabled with fetchMode RELAY: their adapters exist and are
 * tested against fixtures, but nothing will call them until an Iranian egress
 * is available.
 */
export const SOURCES: SourceSeed[] = [
  {
    name: 'eventro',
    displayName: 'Eventro',
    baseUrl: 'https://eventro.ir',
    confidence: 0.7,
    fetchMode: 'DIRECT',
    isEnabled: true,
    notes:
      'Primary source. Structured records with a stable event code and both Jalali and Gregorian dates.',
  },
  {
    name: 'exhibitionmakers',
    displayName: 'Exhibition Makers',
    baseUrl: 'https://exhibitionmakers.com',
    confidence: 0.6,
    fetchMode: 'DIRECT',
    isEnabled: true,
    notes: 'robots.txt allows everything. Country and city pages are navigation only; detail pages carry the data.',
  },
  {
    name: 'kabirkarsan',
    displayName: 'Kabir Karsan',
    baseUrl: 'https://kabirkarsan.com',
    confidence: 0.4,
    fetchMode: 'DIRECT',
    isEnabled: true,
    notes:
      'WordPress REST API at /wp-json/wp/v2/exhibitions. Records are SEO articles with no structured dates — enrichment only, never a date authority.',
  },
  {
    name: 'iranfair',
    displayName: 'Iran International Exhibitions Company (official)',
    baseUrl: 'https://calendar.iranfair.com',
    confidence: 1.0,
    fetchMode: 'RELAY',
    isEnabled: false,
    notes:
      'Most authoritative source available. DNS resolves but TCP times out from outside Iran — enable once the relay is in place.',
  },
  {
    name: 'iranadfair',
    displayName: 'IranAdFair',
    baseUrl: 'https://iranadfair.com',
    confidence: 0.7,
    fetchMode: 'RELAY',
    isEnabled: false,
    notes: 'DNS resolves, TCP times out from outside Iran. Blocked pending the relay.',
  },
  {
    name: 'manual',
    displayName: 'Manual Curation',
    baseUrl: 'https://exhibition-reminder.internal/manual',
    confidence: 0.85,
    fetchMode: 'DIRECT',
    isEnabled: false,
    notes:
      'Hand-entered after a human directly verified the organizer\'s own page or poster. Used for venues whose own site is too unstructured or unreliable to scrape (e.g. iranmallexhibition.com). Never run by the scheduler — ingested via POST /internal/manual-ingest.',
  },
];
