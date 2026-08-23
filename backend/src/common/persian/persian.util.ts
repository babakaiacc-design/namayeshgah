/**
 * Persian text normalization.
 *
 * This module is the single source of truth for turning Persian text into a
 * comparable form. It MUST be applied identically when writing to the database
 * and when building a query — if the two ever diverge, search fails silently
 * and the bug is very hard to spot. The SQL mirror of `normalizeForSearch`
 * lives in the migration that creates `search_vector`; change them together.
 *
 * See docs/ARCHITECTURE.md section 7.
 */

// Characters that look identical to a reader but are distinct code points.
// Iranian sites mix Arabic and Persian forms freely, so this is not optional.
const CHARACTER_FOLDING: ReadonlyArray<readonly [RegExp, string]> = [
  [/ي/g, 'ی'], // ARABIC YEH        -> FARSI YEH
  [/ى/g, 'ی'], // ALEF MAKSURA      -> FARSI YEH
  [/ك/g, 'ک'], // ARABIC KAF        -> KEHEH
  [/ة/g, 'ه'], // TEH MARBUTA       -> HEH
  [/ؤ/g, 'و'], // WAW WITH HAMZA    -> WAW
  [/ئ/g, 'ی'], // YEH WITH HAMZA    -> FARSI YEH
  [/[آأإٱ]/g, 'ا'], // ALEF variants -> ALEF
];

// Harakat / diacritics and the superscript alef. Decorative, never semantic
// in the exhibition titles we ingest.
const DIACRITICS = /[ً-ْٰـ]/g;

// Zero-width characters other than ZWNJ, plus the BOM. These sneak in from
// copy-pasted HTML and would otherwise break exact matching.
const INVISIBLE = /[​‍‎‏﻿]/g;

const ZWNJ = /‌/g;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const LATIN_DIGITS = '0123456789';

/**
 * Converts Persian (۰-۹) and Arabic-Indic (٠-٩) digits to Latin digits.
 * Always applied before storage so that numeric comparison and date parsing
 * work regardless of which digit set the source used.
 */
export function toLatinDigits(input: string): string {
  let result = '';
  for (const char of input) {
    const persianIndex = PERSIAN_DIGITS.indexOf(char);
    if (persianIndex !== -1) {
      result += LATIN_DIGITS[persianIndex];
      continue;
    }
    const arabicIndex = ARABIC_DIGITS.indexOf(char);
    if (arabicIndex !== -1) {
      result += LATIN_DIGITS[arabicIndex];
      continue;
    }
    result += char;
  }
  return result;
}

/**
 * Converts Latin digits to Persian digits. Presentation only — never store the
 * output of this function.
 */
export function toPersianDigits(input: string): string {
  let result = '';
  for (const char of input) {
    const index = LATIN_DIGITS.indexOf(char);
    result += index === -1 ? char : PERSIAN_DIGITS[index];
  }
  return result;
}

/**
 * Canonical form for storage and display.
 *
 * Folds look-alike characters, strips diacritics and stray invisible
 * characters, and collapses whitespace — but deliberately KEEPS the ZWNJ,
 * because it carries real orthographic meaning in Persian and removing it
 * would corrupt text we show back to the user.
 */
export function normalizePersian(input: string | null | undefined): string {
  if (!input) return '';

  let text = input.normalize('NFC');

  for (const [pattern, replacement] of CHARACTER_FOLDING) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(DIACRITICS, '');
  text = text.replace(INVISIBLE, '');
  text = toLatinDigits(text);

  // Collapse runs of whitespace, but do not touch ZWNJ.
  text = text.replace(/[^\S‌]+/g, ' ').trim();

  return text;
}

/**
 * Aggressive form used for the search index and for search queries.
 *
 * On top of the canonical form this turns ZWNJ into a real space. In Persian
 * the ZWNJ marks a word boundary, so "نمایشگاه‌های" and "نمایشگاه های" — the two
 * ways users actually type the same phrase — collapse to one key. Punctuation
 * is dropped so that "نمایشگاه (اگروفود)" matches a plain search for the name.
 */
export function normalizeForSearch(input: string | null | undefined): string {
  if (!input) return '';

  let text = normalizePersian(input).toLowerCase();

  text = text.replace(ZWNJ, ' ');

  // Keep letters, marks, numbers and spaces; drop everything else.
  text = text.replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ');

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Builds a URL-safe slug. Persian characters are preserved because the app is
 * Persian-first and percent-encoded Persian slugs are still readable and
 * shareable; only whitespace and punctuation are reduced to hyphens.
 */
export function slugify(input: string): string {
  const text = normalizeForSearch(input);
  return text.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
