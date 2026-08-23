import {
  normalizeForSearch,
  normalizePersian,
  slugify,
  toLatinDigits,
  toPersianDigits,
} from './persian.util';

// Invisible / look-alike code points, named so the tests stay readable.
const ZWNJ = '‌';
const ZWSP = '​';
const BOM = '﻿';
const ARABIC_YEH = 'ي';
const ARABIC_KAF = 'ك';
const FARSI_YEH = 'ی';
const KEHEH = 'ک';
const FATHA = 'َ';
const TATWEEL = 'ـ';

describe('toLatinDigits', () => {
  it('converts Persian digits', () => {
    expect(toLatinDigits('۱۴۰۵/۰۶/۲۰')).toBe('1405/06/20');
  });

  it('converts Arabic-Indic digits', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('leaves Latin digits and letters untouched', () => {
    expect(toLatinDigits('Hall 38')).toBe('Hall 38');
  });

  it('handles mixed digit systems in one string', () => {
    expect(toLatinDigits('۲۰26')).toBe('2026');
  });
});

describe('toPersianDigits', () => {
  it('converts Latin digits for display', () => {
    expect(toPersianDigits('1405/06/20')).toBe('۱۴۰۵/۰۶/۲۰');
  });

  it('round-trips with toLatinDigits', () => {
    expect(toLatinDigits(toPersianDigits('2026-08-31'))).toBe('2026-08-31');
  });
});

describe('normalizePersian', () => {
  it('folds Arabic yeh to Farsi yeh', () => {
    expect(normalizePersian(`نما${ARABIC_YEH}شگاه`)).toBe(`نما${FARSI_YEH}شگاه`);
  });

  it('folds Arabic kaf to keheh', () => {
    expect(normalizePersian(`${ARABIC_KAF}تاب`)).toBe(`${KEHEH}تاب`);
  });

  it('strips diacritics and tatweel', () => {
    expect(normalizePersian(`نم${FATHA}ا${TATWEEL}${TATWEEL}یشگاه`)).toBe('نمایشگاه');
  });

  it('strips zero-width characters but keeps ZWNJ', () => {
    const input = `${BOM}نمایشگاه${ZWSP}${ZWNJ}های${ZWSP} تهران`;
    expect(normalizePersian(input)).toBe(`نمایشگاه${ZWNJ}های تهران`);
  });

  it('collapses whitespace without eating the ZWNJ', () => {
    expect(normalizePersian(`  نمایشگاه   ${ZWNJ}های  `)).toBe(`نمایشگاه ${ZWNJ}های`);
  });

  it('converts digits to Latin', () => {
    expect(normalizePersian('نمایشگاه ۱۴۰۵')).toBe('نمایشگاه 1405');
  });

  it('returns an empty string for null and undefined', () => {
    expect(normalizePersian(null)).toBe('');
    expect(normalizePersian(undefined)).toBe('');
    expect(normalizePersian('')).toBe('');
  });
});

describe('normalizeForSearch', () => {
  it('makes the two ways of typing a Persian plural identical', () => {
    // This is the whole reason the function exists: users type either form.
    const withZwnj = normalizeForSearch(`نمایشگاه${ZWNJ}های تهران`);
    const withSpace = normalizeForSearch('نمایشگاه های تهران');
    expect(withZwnj).toBe(withSpace);
  });

  it('strips punctuation so parenthesised names still match', () => {
    expect(normalizeForSearch('نمایشگاه مواد غذایی (اگروفود)')).toBe(
      'نمایشگاه مواد غذایی اگروفود',
    );
  });

  it('matches across Arabic and Persian spellings', () => {
    const arabicSpelling = normalizeForSearch(`نما${ARABIC_YEH}شگاه ${ARABIC_KAF}تاب`);
    const persianSpelling = normalizeForSearch('نمایشگاه کتاب');
    expect(arabicSpelling).toBe(persianSpelling);
  });

  it('lowercases Latin text', () => {
    expect(normalizeForSearch('AGROFOOD Tehran')).toBe('agrofood tehran');
  });

  it('normalizes a real ingested title', () => {
    const raw = 'نمایشگاه بین المللی الکترونیک، کامپیوتر و تجارت الکترونیکی (الکامپ) تهران 1405';
    expect(normalizeForSearch(raw)).toBe(
      'نمایشگاه بین المللی الکترونیک کامپیوتر و تجارت الکترونیکی الکامپ تهران 1405',
    );
  });

  it('is idempotent', () => {
    const once = normalizeForSearch(`نمایشگاه${ZWNJ}های  تهران، ۱۴۰۵`);
    expect(normalizeForSearch(once)).toBe(once);
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeForSearch('   ')).toBe('');
    expect(normalizeForSearch(null)).toBe('');
  });
});

describe('slugify', () => {
  it('joins words with hyphens', () => {
    expect(slugify('نمایشگاه کتاب تهران')).toBe('نمایشگاه-کتاب-تهران');
  });

  it('produces the same slug for both plural spellings', () => {
    expect(slugify(`نمایشگاه${ZWNJ}های تهران`)).toBe(slugify('نمایشگاه های تهران'));
  });

  it('handles Latin titles', () => {
    expect(slugify('AGROFOOD Tehran 2026')).toBe('agrofood-tehran-2026');
  });

  it('does not leave leading or trailing hyphens', () => {
    expect(slugify('  (نمایشگاه)  ')).toBe('نمایشگاه');
  });
});
