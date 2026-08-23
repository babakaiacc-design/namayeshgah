import {
  AUTO_MERGE_THRESHOLD,
  REVIEW_THRESHOLD,
  TITLE_ONLY_CEILING,
  dateOverlap,
  decide,
  scoreMatch,
  titleSimilarity,
  trigrams,
} from './similarity';

describe('trigrams', () => {
  it('produces padded trigrams for Persian words', () => {
    const grams = trigrams('کتاب');
    expect(grams.has('  ک')).toBe(true);
    expect(grams.has('اب ')).toBe(true);
    expect(grams.size).toBeGreaterThan(0);
  });

  it('produces trigrams for Persian, unlike pg_trgm under a C locale', () => {
    // The whole reason this lives in TypeScript.
    expect(trigrams('نمایشگاه').size).toBeGreaterThan(4);
  });

  it('is blind to the two spellings of a Persian plural', () => {
    expect(trigrams('نمایشگاه‌های تهران')).toEqual(trigrams('نمایشگاه های تهران'));
  });

  it('returns an empty set for blank input', () => {
    expect(trigrams('').size).toBe(0);
    expect(trigrams('   ').size).toBe(0);
  });
});

describe('titleSimilarity', () => {
  it('scores identical titles as 1', () => {
    expect(titleSimilarity('نمایشگاه مبلمان', 'نمایشگاه مبلمان')).toBe(1);
  });

  it('sees through Arabic versus Persian spelling', () => {
    expect(titleSimilarity('نمايشگاه كتاب', 'نمایشگاه کتاب')).toBe(1);
  });

  it('scores the real-world pair from the brief as similar', () => {
    // Section 12: these two titles are probably the same event.
    const score = titleSimilarity(
      'نمایشگاه بین المللی صنعت مبلمان تهران',
      'نمایشگاه صنعت مبلمان تهران HOFEX',
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it('scores unrelated titles low', () => {
    const score = titleSimilarity('نمایشگاه مبلمان تهران', 'نمایشگاه تجهیزات پزشکی مشهد');
    expect(score).toBeLessThan(0.4);
  });

  it('is symmetric', () => {
    const a = 'نمایشگاه صنعت ساختمان';
    const b = 'نمایشگاه بین المللی صنعت ساختمان';
    expect(titleSimilarity(a, b)).toBeCloseTo(titleSimilarity(b, a), 10);
  });

  it('returns 0 when either side is empty', () => {
    expect(titleSimilarity('', 'نمایشگاه')).toBe(0);
    expect(titleSimilarity('', '')).toBe(0);
  });
});

describe('dateOverlap', () => {
  it('scores identical ranges as 1', () => {
    expect(dateOverlap({ start: '2026-08-31', end: '2026-09-03' }, { start: '2026-08-31', end: '2026-09-03' })).toBe(1);
  });

  it('scores partial overlap between 0 and 1', () => {
    const score = dateOverlap(
      { start: '2026-08-31', end: '2026-09-03' },
      { start: '2026-09-02', end: '2026-09-05' },
    )!;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('still credits a short postponement', () => {
    // The scenario in section 13: the fair moved by two days.
    const score = dateOverlap(
      { start: '2026-09-11', end: '2026-09-14' },
      { start: '2026-09-13', end: '2026-09-16' },
    )!;
    expect(score).toBeGreaterThan(0.4);
  });

  it('scores far-apart dates as 0', () => {
    expect(dateOverlap({ start: '2026-01-01' }, { start: '2026-11-01' })).toBe(0);
  });

  it('returns undefined rather than 0 when a date is unknown', () => {
    // An unknown date must not be treated as evidence against a match.
    expect(dateOverlap({ start: null }, { start: '2026-08-31' })).toBeUndefined();
    expect(dateOverlap({ start: undefined }, { start: undefined })).toBeUndefined();
  });

  it('returns undefined for an unparseable date', () => {
    expect(dateOverlap({ start: 'soon' }, { start: '2026-08-31' })).toBeUndefined();
  });
});

describe('scoreMatch', () => {
  const base = {
    title: 'نمایشگاه بین المللی صنعت مبلمان تهران',
    start: '2026-08-31',
    end: '2026-09-03',
    venueId: 'venue-1',
    categoryId: 'cat-1',
  };

  it('treats a shared external id as proof of identity', () => {
    const result = scoreMatch(
      { title: 'یک چیز', externalId: '53066' },
      { title: 'چیز کاملا متفاوت', externalId: '53066' },
    );
    expect(result.exact).toBe(true);
    expect(result.score).toBe(1);
    expect(decide(result.score)).toBe('MERGE');
  });

  it('merges the same event reported by two sources', () => {
    const result = scoreMatch(base, {
      ...base,
      title: 'نمایشگاه بین المللی صنعت مبلمان تهران',
    });
    expect(result.score).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
    expect(decide(result.score)).toBe('MERGE');
  });

  it('sends a plausible but unproven pair to review', () => {
    const result = scoreMatch(base, {
      ...base,
      title: 'نمایشگاه صنعت مبلمان تهران HOFEX',
    });
    expect(decide(result.score)).toBe('REVIEW');
  });

  it('keeps unrelated events separate', () => {
    const result = scoreMatch(base, {
      title: 'نمایشگاه تجهیزات پزشکی مشهد',
      start: '2026-02-01',
      end: '2026-02-04',
      venueId: 'venue-9',
      categoryId: 'cat-9',
    });
    expect(result.score).toBeLessThan(REVIEW_THRESHOLD);
    expect(decide(result.score)).toBe('SEPARATE');
  });

  it('never auto-merges on a title alone', () => {
    // Consecutive editions of an annual fair have near-identical titles.
    const result = scoreMatch({ title: base.title }, { title: base.title });
    expect(result.score).toBe(TITLE_ONLY_CEILING);
    expect(decide(result.score)).toBe('REVIEW');
    expect(result.reason).toContain('capped');
  });

  it('still judges a record whose date is unknown', () => {
    const result = scoreMatch(
      { title: base.title, venueId: 'venue-1', categoryId: 'cat-1' },
      { ...base },
    );
    expect(result.signals.dates).toBeUndefined();
    expect(result.signals.venue).toBe(1);
    expect(decide(result.score)).toBe('MERGE');
  });

  it('does not punish a match for a signal neither side has', () => {
    const withVenues = scoreMatch(base, { ...base });
    const withoutVenues = scoreMatch(
      { ...base, venueId: undefined },
      { ...base, venueId: undefined },
    );
    expect(withoutVenues.score).toBeCloseTo(withVenues.score, 5);
  });

  it('lets a venue mismatch pull a similar title apart', () => {
    const sameVenue = scoreMatch(base, { ...base, title: 'نمایشگاه صنعت مبلمان تهران' });
    const otherVenue = scoreMatch(base, {
      ...base,
      title: 'نمایشگاه صنعت مبلمان تهران',
      venueId: 'venue-2',
    });
    expect(otherVenue.score).toBeLessThan(sameVenue.score);
  });

  it('reports its signals for the review queue', () => {
    const result = scoreMatch(base, { ...base });
    expect(Object.keys(result.signals).sort()).toEqual(['category', 'dates', 'title', 'venue']);
  });

  it('scores 0 when there is nothing comparable', () => {
    const result = scoreMatch({ title: '' }, { title: '' });
    expect(result.score).toBe(0);
    expect(decide(result.score)).toBe('SEPARATE');
  });
});

describe('decide', () => {
  it('uses the thresholds from the brief', () => {
    expect(decide(0.96)).toBe('MERGE');
    expect(decide(0.95)).toBe('MERGE');
    expect(decide(0.9)).toBe('REVIEW');
    expect(decide(0.8)).toBe('REVIEW');
    expect(decide(0.79)).toBe('SEPARATE');
  });
});
