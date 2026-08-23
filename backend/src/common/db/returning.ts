/**
 * Normalizes what TypeORM hands back from a RETURNING clause.
 *
 * The shape is not consistent across statement types:
 *
 *   INSERT ... RETURNING   ->  [{ id: 3 }]
 *   UPDATE ... RETURNING   ->  [[{ id: 1 }], 1]
 *   DELETE ... RETURNING   ->  [[{ id: 2 }], 1]
 *   DELETE matching nothing ->  [[], 0]
 *
 * The last line is the dangerous one. A guard written as
 * `if (rows.length === 0) throw new NotFoundException()` never fires after a
 * DELETE, because the outer array always holds two elements. That turns an
 * ownership check into a no-op: deleting another account's row reports success
 * even though nothing was removed.
 *
 * Every read of a RETURNING result goes through this function so the shape is
 * decided in one place instead of at each call site.
 */
export function returningRows<T = any>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];

  // The [rows, affectedCount] shape, distinguished by an array in the first
  // slot and a number in the second. A plain row set never looks like this,
  // because its elements are row objects rather than an array and a number.
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }

  return result as T[];
}

/** The first returned row, or undefined. */
export function returningRow<T = any>(result: unknown): T | undefined {
  return returningRows<T>(result)[0];
}
