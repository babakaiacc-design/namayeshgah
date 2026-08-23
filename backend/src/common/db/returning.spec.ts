import { returningRow, returningRows } from './returning';

describe('returningRows', () => {
  it('passes through the INSERT shape, which is a plain row set', () => {
    expect(returningRows([{ id: 3 }])).toEqual([{ id: 3 }]);
    expect(returningRows([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('unwraps the UPDATE and DELETE shape, which pairs rows with a count', () => {
    expect(returningRows([[{ id: 1 }], 1])).toEqual([{ id: 1 }]);
    expect(returningRows([[{ id: 1 }, { id: 2 }], 2])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('reports a DELETE that matched nothing as empty', () => {
    // The whole reason this helper exists. Read raw, [[], 0] has length 2, so
    // an ownership guard written as `rows.length === 0` never fires and the API
    // reports success for a delete that removed nothing.
    expect(returningRows([[], 0])).toEqual([]);
    expect(returningRows([[], 0])).toHaveLength(0);
  });

  it('does not mistake two returned rows for the wrapped shape', () => {
    // Two row objects are not [rows, count]: the first element is an object
    // rather than an array, and the second is not a number.
    const twoRows = [{ id: 1 }, { id: 2 }];
    expect(returningRows(twoRows)).toHaveLength(2);
  });

  it('does not mistake a row set whose first row is array-valued', () => {
    // A column can legitimately hold an array, but the count slot still is not
    // a number, so the pair shape does not match.
    const arrayColumn = [{ tags: ['a'] }, { tags: ['b'] }];
    expect(returningRows(arrayColumn)).toHaveLength(2);
  });

  it('tolerates a query that returned nothing at all', () => {
    expect(returningRows([])).toEqual([]);
    expect(returningRows(undefined)).toEqual([]);
    expect(returningRows(null)).toEqual([]);
  });
});

describe('returningRow', () => {
  it('takes the first row of either shape', () => {
    expect(returningRow([{ id: 3 }])).toEqual({ id: 3 });
    expect(returningRow([[{ id: 7 }], 1])).toEqual({ id: 7 });
  });

  it('is undefined when nothing was returned', () => {
    expect(returningRow([[], 0])).toBeUndefined();
    expect(returningRow([])).toBeUndefined();
  });
});
