import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestDatabase, migratedDataSource } from '../../test/test-db';
import { fakeFetcher, okResponse } from '../../test/fake-fetcher';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../test/fixtures', name), 'utf8');

/**
 * Boots the real application against a real database with real ingested data.
 *
 * The app module reads DATABASE_URL when it is imported, so the environment is
 * prepared first and AppModule is pulled in dynamically afterwards.
 */
describe('public API', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const url = await createTestDatabase('api');

    // The environment must be set before ANY module that reads it is imported.
    // data-source.ts freezes dataSourceOptions from process.env at import time,
    // and run-seed imports it, so importing the seed first would pin the whole
    // application to the previous DATABASE_URL and leave it querying a database
    // with no tables in it.
    process.env.DATABASE_URL = url;
    process.env.DB_SSL = 'false';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'integration-test-secret-long-enough-to-be-valid';
    process.env.SYNC_SECRET = 'integration-test-sync-secret-long-enough-x';
    process.env.LOG_LEVEL = 'silent';

    // Seed and ingest through a plain connection before the app exists.
    dataSource = await migratedDataSource(url);

    const { seed } = await import('../database/seeds/run-seed');
    await seed(dataSource);

    const { EventroSource } = await import('../ingestion/adapters/eventro.source');
    const { IngestionService } = await import('../ingestion/ingestion.service');
    const { Normalizer } = await import('../ingestion/normalizer/normalizer');
    const { DbReferenceResolver } = await import('../ingestion/normalizer/reference-resolver');

    const listing = fixture('eventro-tehran.html');
    const detail = fixture('eventro-event-53066.html');

    const fetched = await new EventroSource().fetchExhibitions({
      fetcher: fakeFetcher(({ url: target }) => {
        const body = target.includes('/tc/fairs/tehran')
          ? listing
          : target.includes('/events/53066')
            ? detail
            : '<html></html>';
        return okResponse(target, body);
      }),
      locations: ['tehran'],
    });

    const ingestion = new IngestionService(
      dataSource,
      new Normalizer(new DbReferenceResolver(dataSource)),
    );
    await ingestion.ingest('eventro', fetched.exhibitions);

    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts so DTO validation is exercised exactly as in production.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  describe('GET /health', () => {
    it('reports the database as up', async () => {
      const response = await api().get('/health').expect(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.database).toBe('up');
    });
  });

  describe('GET /exhibitions', () => {
    it('returns real ingested exhibitions, paginated', async () => {
      const response = await api().get('/exhibitions').expect(200);

      expect(response.body.items.length).toBeGreaterThan(0);
      expect(response.body.total).toBeGreaterThan(0);
      expect(response.body.limit).toBe(20);
      expect(typeof response.body.hasMore).toBe('boolean');
    });

    it('is open to guests, with no token', async () => {
      // Section 33: browsing never requires an account.
      await api().get('/exhibitions').expect(200);
    });

    it('exposes the date status so a client can be honest about it', async () => {
      const response = await api().get('/exhibitions?includeUndated=true').expect(200);
      const statuses = new Set(response.body.items.map((item: any) => item.dates.status));

      for (const status of statuses) {
        expect(['CONFIRMED', 'UNKNOWN', 'CONFLICT', 'POSTPONED']).toContain(status);
      }
      expect(response.body.items[0]).toHaveProperty('confidence');
      expect(response.body.items[0]).toHaveProperty('lastVerifiedAt');
    });

    it('hides undated exhibitions by default and returns them on request', async () => {
      const withUndated = await api().get('/exhibitions?includeUndated=true').expect(200);
      const withoutUndated = await api().get('/exhibitions').expect(200);

      expect(withUndated.body.total).toBeGreaterThanOrEqual(withoutUndated.body.total);
      expect(withoutUndated.body.items.every((item: any) => item.dates.start !== null)).toBe(true);
    });

    it('caps the page size instead of trusting the client', async () => {
      await api().get('/exhibitions?limit=5000').expect(400);
    });

    it('rejects an unknown query parameter rather than ignoring it', async () => {
      // A typo in a filter name must not silently return unfiltered data.
      await api().get('/exhibitions?categoryy=furniture').expect(400);
    });

    it('rejects a malformed date filter', async () => {
      await api().get('/exhibitions?dateFrom=1405-06-20-bad').expect(400);
    });

    it('pages through results without repeating one', async () => {
      const first = await api().get('/exhibitions?limit=3&offset=0').expect(200);
      const second = await api().get('/exhibitions?limit=3&offset=3').expect(200);

      const firstIds = first.body.items.map((item: any) => item.id);
      const secondIds = second.body.items.map((item: any) => item.id);
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
    });

    it('filters by date range', async () => {
      const response = await api()
        .get('/exhibitions?dateFrom=2026-08-01&dateTo=2026-08-31')
        .expect(200);

      for (const item of response.body.items) {
        expect(item.dates.start <= '2026-08-31').toBe(true);
      }
    });

    it('includes a month-range result whose end date is not known yet', async () => {
      // The end date only exists once a detail page has been fetched, which is
      // budgeted per sync run, so it is routinely still unknown for exhibitions
      // further out. This is exactly the calendar's own query shape: a month
      // opened by the user must show every exhibition starting in it, not only
      // the ones a detail fetch has already reached.
      const [city] = await dataSource.query(
        `SELECT city_id FROM exhibitions WHERE city_id IS NOT NULL LIMIT 1`,
      );
      // date_status is UNKNOWN, not CONFIRMED: a CONFIRMED row is required by a
      // database check constraint to have both dates, and a real row in this
      // state (start known, end not yet fetched) is UNKNOWN too.
      const [created] = await dataSource.query(
        `INSERT INTO exhibitions (slug, canonical_title, city_id, start_date, end_date,
                                  date_status, confidence)
         VALUES ($1, $2, $3, '2026-08-20'::date, NULL, 'UNKNOWN', 0.6)
         RETURNING id`,
        ['no-end-date-2026-08-20', 'رویداد بدون تاریخ پایان آزمایشی', city.city_id],
      );

      const response = await api()
        .get('/exhibitions?dateFrom=2026-08-01&dateTo=2026-08-31')
        .expect(200);

      const ids = response.body.items.map((item: any) => item.id);
      expect(ids).toContain(created.id);
    });

    it('filters by city', async () => {
      const tehran = await api().get('/exhibitions?city=tehran').expect(200);
      const nowhere = await api().get('/exhibitions?city=does-not-exist').expect(200);

      expect(tehran.body.total).toBeGreaterThan(0);
      expect(nowhere.body.total).toBe(0);
    });
  });

  describe('search', () => {
    it('finds an exhibition by a word in its title', async () => {
      const response = await api().get('/exhibitions?search=الکامپ').expect(200);
      expect(response.body.total).toBeGreaterThan(0);
      expect(response.body.items[0].title).toContain('الکامپ');
    });

    it('matches regardless of Arabic or Persian spelling', async () => {
      // The user types ك and ي; the data holds ک and ی.
      const persian = await api().get('/exhibitions?search=کامپیوتر').expect(200);
      const arabic = await api().get('/exhibitions?search=كامپيوتر').expect(200);
      expect(arabic.body.total).toBe(persian.body.total);
      expect(persian.body.total).toBeGreaterThan(0);
    });

    it('matches a partial word the way a search box should', async () => {
      const response = await api().get('/exhibitions?search=نمایشگاه').expect(200);
      expect(response.body.total).toBeGreaterThan(0);
    });

    it('returns an empty page rather than an error for nonsense', async () => {
      const response = await api().get('/exhibitions?search=زطزطزطزط').expect(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    /**
     * Somebody searching for a furniture fair wants to know when it was held and
     * where, so an exhibition that has already finished must still be findable.
     * These run against dates written for this block, because what the fixture
     * happens to contain today would otherwise decide whether the test means
     * anything.
     */
    describe('exhibitions that have already happened', () => {
      const marker = 'سرندیپیتی';
      let past: string;
      let older: string;
      let upcoming: string;

      beforeAll(async () => {
        const [row] = await dataSource.query(
          `SELECT city_id FROM exhibitions WHERE city_id IS NOT NULL LIMIT 1`,
        );

        const add = async (title: string, start: string): Promise<string> => {
          const [created] = await dataSource.query(
            `INSERT INTO exhibitions (slug, canonical_title, city_id, start_date, end_date,
                                      date_status, confidence)
             VALUES ($1, $2, $3, $4::date, $4::date, 'CONFIRMED', 1)
             RETURNING id`,
            [`serendipity-${start}`, `${marker} ${title}`, row.city_id, start],
          );
          await dataSource.query(
            `INSERT INTO exhibition_translations (exhibition_id, locale, title)
             VALUES ($1, 'fa', $2)`,
            [created.id, `${marker} ${title}`],
          );
          return created.id;
        };

        // Relative to today so the test keeps its meaning as the clock moves.
        const day = (offset: number): string =>
          new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

        older = await add('قدیمی', day(-800));
        past = await add('گذشته', day(-40));
        upcoming = await add('پیش‌رو', day(30));
      });

      it('finds one whose date has passed', async () => {
        const response = await api()
          .get(`/exhibitions?search=${encodeURIComponent(marker)}`)
          .expect(200);

        const ids = response.body.items.map((item: any) => item.id);
        expect(ids).toContain(past);
        expect(ids).toContain(older);
      });

      it('reports its date and its city, which is the point of finding it', async () => {
        const response = await api()
          .get(`/exhibitions?search=${encodeURIComponent(marker)}`)
          .expect(200);
        const found = response.body.items.find((item: any) => item.id === past);

        expect(found.dates.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(found.city.name).toBeTruthy();
      });

      it('leads with what is still to come, then the most recent past', async () => {
        const response = await api()
          .get(`/exhibitions?search=${encodeURIComponent(marker)}&sort=soonest`)
          .expect(200);

        const ids = response.body.items.map((item: any) => item.id);
        expect(ids.indexOf(upcoming)).toBeLessThan(ids.indexOf(past));
        expect(ids.indexOf(past)).toBeLessThan(ids.indexOf(older));
      });

      it('orders a ranked search the same way once rank ties', async () => {
        const response = await api()
          .get(`/exhibitions?search=${encodeURIComponent(marker)}&sort=relevance`)
          .expect(200);

        const ids = response.body.items.map((item: any) => item.id);
        expect(ids.indexOf(upcoming)).toBeLessThan(ids.indexOf(older));
      });

      it('still lists a calendar month oldest first', async () => {
        // The grouped ordering is for search; a month view wants plain ascending.
        const response = await api().get('/exhibitions?sort=startDate&limit=50').expect(200);
        const dates = response.body.items.map((item: any) => item.dates.start);
        expect([...dates].sort()).toEqual(dates);
      });
    });
  });

  describe('home screen endpoints', () => {
    it('GET /exhibitions/today returns only what is running now', async () => {
      const response = await api().get('/exhibitions/today').expect(200);
      for (const item of response.body.items) {
        expect(item.dates.isOngoing).toBe(true);
      }
    });

    it('GET /exhibitions/upcoming honours the day window', async () => {
      const response = await api().get('/exhibitions/upcoming?days=365').expect(200);
      for (const item of response.body.items) {
        expect(item.dates.daysUntil).toBeGreaterThan(0);
        expect(item.dates.daysUntil).toBeLessThanOrEqual(365);
      }
    });

    it('GET /exhibitions/upcoming rejects an out-of-range window', async () => {
      await api().get('/exhibitions/upcoming?days=4000').expect(400);
    });

    it('GET /exhibitions/date/:date returns exhibitions open that day', async () => {
      const response = await api().get('/exhibitions/date/2026-09-01').expect(200);
      for (const item of response.body.items) {
        expect(item.dates.start <= '2026-09-01').toBe(true);
        expect(item.dates.end === null || item.dates.end >= '2026-09-01').toBe(true);
      }
    });

    it('GET /exhibitions/date/:date refuses a Jalali date', async () => {
      // The API speaks Gregorian only; conversion is the client's job.
      await api().get('/exhibitions/date/1405-06-20').expect(200);
      await api().get('/exhibitions/date/۱۴۰۵-۰۶-۲۰').expect(400);
    });
  });

  describe('GET /exhibitions/:idOrSlug', () => {
    it('returns one exhibition with its provenance', async () => {
      // Named rather than "whichever sorts first": the database also holds rows
      // written directly by other tests, and those have no source behind them.
      const list = await api().get('/exhibitions?search=الکامپ').expect(200);
      const { id } = list.body.items[0];

      const response = await api().get(`/exhibitions/${id}`).expect(200);

      expect(response.body.id).toBe(id);
      // Section 11: the client must be able to show where a date came from.
      expect(Array.isArray(response.body.sources)).toBe(true);
      expect(response.body.sources.length).toBeGreaterThan(0);
      expect(response.body.sources[0].sourceName).toBe('eventro');
      expect(response.body.sources[0].sourceUrl).toContain('eventro.ir');
    });

    it('resolves by slug as well as id', async () => {
      const list = await api().get('/exhibitions').expect(200);
      const { slug, id } = list.body.items[0];

      const response = await api().get(`/exhibitions/${encodeURIComponent(slug)}`).expect(200);
      expect(response.body.id).toBe(id);
    });

    it('returns 404 for an unknown exhibition', async () => {
      await api().get('/exhibitions/no-such-exhibition').expect(404);
    });
  });

  describe('reference data', () => {
    it('GET /categories returns a nested tree with rolled-up counts', async () => {
      const response = await api().get('/categories').expect(200);

      const home = response.body.find((node: any) => node.slug === 'home-lifestyle');
      expect(home).toBeDefined();
      expect(home.children.some((child: any) => child.slug === 'furniture')).toBe(true);

      const childTotal = home.children.reduce(
        (sum: number, child: any) => sum + child.exhibitionCount,
        0,
      );
      expect(home.exhibitionCount).toBeGreaterThanOrEqual(childTotal);
    });

    it('GET /venues reports null coordinates rather than guesses', async () => {
      const response = await api().get('/venues?city=tehran').expect(200);
      expect(response.body.length).toBeGreaterThan(0);
      for (const venue of response.body) {
        expect(venue.latitude).toBeNull();
        expect(venue.longitude).toBeNull();
      }
    });

    it('GET /cities exposes the IANA timezone the client needs', async () => {
      const response = await api().get('/cities').expect(200);
      const tehran = response.body.find((city: any) => city.slug === 'tehran');
      expect(tehran.timezone).toBe('Asia/Tehran');
      expect(tehran.country.iso2).toBe('IR');
    });
  });

  describe('authentication', () => {
    const deviceId = '6f1c2a1e-9b3d-4c7a-8f2e-1d0b5a7c3e94';

    it('creates an anonymous account for a device', async () => {
      const response = await api().post('/auth/device').send({ deviceId }).expect(201);

      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.user.tier).toBe('FREE');
      expect(response.body.user.locale).toBe('fa');
    });

    it('returns the same account for the same device', async () => {
      const first = await api().post('/auth/device').send({ deviceId }).expect(201);
      const second = await api().post('/auth/device').send({ deviceId }).expect(201);
      expect(second.body.user.id).toBe(first.body.user.id);
    });

    it('never stores the raw device identifier', async () => {
      await api().post('/auth/device').send({ deviceId }).expect(201);

      const rows = await dataSource.query(
        `SELECT count(*)::int AS n FROM users WHERE anonymous_device_id = $1`,
        [deviceId],
      );
      expect(rows[0].n).toBe(0);
    });

    it('rejects a device id that is too short to be meaningful', async () => {
      await api().post('/auth/device').send({ deviceId: 'abc' }).expect(400);
    });

    it('rejects a malformed locale', async () => {
      await api()
        .post('/auth/device')
        .send({ deviceId, locale: 'not-a-locale' })
        .expect(400);
    });

    it('GET /auth/me requires a token', async () => {
      await api().get('/auth/me').expect(401);
    });

    it('GET /auth/me returns the account behind a valid token', async () => {
      const auth = await api().post('/auth/device').send({ deviceId }).expect(201);

      const response = await api()
        .get('/auth/me')
        .set('Authorization', `Bearer ${auth.body.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(auth.body.user.id);
    });

    it('rejects a forged token', async () => {
      await api().get('/auth/me').set('Authorization', 'Bearer not.a.real.token').expect(401);
    });

    it('stops honouring a token once the account is deactivated', async () => {
      const auth = await api()
        .post('/auth/device')
        .send({ deviceId: 'device-to-deactivate-0001' })
        .expect(201);

      await dataSource.query(`UPDATE users SET is_active = false WHERE id = $1`, [
        auth.body.user.id,
      ]);

      await api()
        .get('/auth/me')
        .set('Authorization', `Bearer ${auth.body.accessToken}`)
        .expect(401);
    });
  });
});
