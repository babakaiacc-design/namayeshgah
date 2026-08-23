import { types } from 'pg';

/** Postgres type oid for DATE. */
const DATE_OID = 1082;

/**
 * Makes Postgres DATE columns arrive as plain 'YYYY-MM-DD' strings.
 *
 * By default node-postgres turns a DATE into a JS Date at LOCAL midnight. On a
 * machine running in Asia/Tehran (+03:30) that value formats through
 * toISOString() as the PREVIOUS day, so an exhibition starting 2026-08-31 would
 * be published as 2026-08-30. JSON.stringify calls toISOString internally, so
 * the bug would reach API responses without anyone writing a conversion.
 *
 * A calendar date has no time and no zone; it should never become an instant.
 * Handing it back as the string Postgres already sent removes the whole class
 * of off-by-one errors, and matches how dates are stored and compared
 * everywhere else in this codebase.
 *
 * Must be called before any pool is created. See ARCHITECTURE.md section 8.
 */
export function configurePostgresDateParsing(): void {
  types.setTypeParser(DATE_OID, (value: string) => value);
}
