import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { Fetcher, RawResponse } from '../../common/http/fetcher';
import { FETCHER_FACTORY, FetcherFactory } from '../../common/http/fetcher.factory';
import { createTestDatabase, migratedDataSource } from '../../../test/test-db';

const SYNC_SECRET = 'sync-secret-for-integration-tests-long-enough';

/**
 * Builds a listing page in the exact shape eventro serves.
 *
 * Generated rather than saved because these tests need to change the published
 * date between runs, which a static fixture cannot do. The structure is copied
 * verbatim from the real markup captured in test/fixtures, and the saved
 * fixtures still guard the parser against the real site.
 */
function listingHtml(events: Array<{ id: string; title: string; jalali: string; gregorian: string }>) {
  const items = events
    .map(
      (event) => `
    <div class="allmode_item">
      <h4 class="allmode_title">
        <a href="https://eventro.ir/events/${event.id}">${event.title}</a>
      </h4>
      <div class="allmode_text">
        <div class="event_detail">
          <span class="dt0">کد رویداد:  </span><span class="dt1"> ${event.id}</span>
        </div>
        <div class="event_detail">
          <span class="dt0 hidden-xs">تاریخ برگزاری: </span>
          <span class="dt1"> ${event.jalali} &nbsp;
            <span class='ltr'>${event.gregorian}</span>
          </span>
        </div>
        <div class="event_detail">
          <span class="dt0 hidden-xs">مکان: </span><span class="dt1">تهران</span>
        </div>
      </div>
    </div>`,
    )
    .join('\n');

  return `<html><body><div id="eventslistarea">${items}</div></body></html>`;
}

/** Detail page carrying the schema.org microdata the adapter prefers. */
function detailHtml(event: { start: string; end: string; venue: string }) {
  return `<html><body>
    <meta itemprop="startDate" content="${event.start}:00.000">
    <meta itemprop="endDate" content="${event.end}:00.000">
    <meta itemprop="location" content="${event.venue}">
    <meta itemprop="address" content="آسیا، خاورمیانه، ایران، استان تهران، تهران">
    <div class="event_contact cf">
      <div class="event_detail">
        <span class="dt0">برگزارکننده : </span><span class="dt1">شرکت آزمایشی</span>
      </div>
    </div>
  </body></html>`;
}

describe('sync engine', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  /** Mutable so a test can change what the source publishes between runs. */
  let pages: Record<string, string> = {};
  let failNext = false;

  const fixtureFetcher: Fetcher = {
    async get(url: string): Promise<RawResponse> {
      if (failNext) throw new Error('simulated network failure');
      const key = Object.keys(pages).find((candidate) => url.includes(candidate));
      const body = key ? pages[key] : '<html></html>';
      return { url, status: 200, body, headers: {}, notModified: false };
    },
  };

  const fixtureFactory: FetcherFactory = { forSource: () => fixtureFetcher };

  const api = () => request(app.getHttpServer());
  const query = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    dataSource.query(sql, params);

  const runSync = (body: Record<string, unknown> = {}) =>
    api().post('/internal/sync').set('X-Sync-Secret', SYNC_SECRET).send(body);

  beforeAll(async () => {
    const url = await createTestDatabase('sync');

    process.env.DATABASE_URL = url;
    process.env.DB_SSL = 'false';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'sync-integration-jwt-secret-long-enough-value';
    process.env.SYNC_SECRET = SYNC_SECRET;
    process.env.LOG_LEVEL = 'silent';

    dataSource = await migratedDataSource(url);
    const { seed } = await import('../../database/seeds/run-seed');
    await seed(dataSource);

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FETCHER_FACTORY)
      .useValue(fixtureFactory)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    failNext = false;
    pages = {};
    await query(
      `TRUNCATE users, notifications, reminders, exhibition_changes,
                exhibition_source_records, sync_runs, exhibitions CASCADE`,
    );
    await query('DELETE FROM sync_locks');
    await query(
      `UPDATE sources SET consecutive_failures = 0, last_error = NULL,
              last_success_at = NULL, last_failure_at = NULL`,
    );
  });

  describe('authentication of the internal endpoint', () => {
    it('refuses a request with no secret', async () => {
      await api().post('/internal/sync').send({}).expect(401);
    });

    it('refuses a wrong secret', async () => {
      await api().post('/internal/sync').set('X-Sync-Secret', 'nope').send({}).expect(401);
    });

    it('accepts the configured secret', async () => {
      await runSync({ source: 'eventro' }).expect(200);
    });
  });

  describe('a successful run', () => {
    beforeEach(() => {
      pages = {
        '/tc/fairs/tehran': listingHtml([
          {
            id: '70001',
            title: 'نمایشگاه بین المللی صنعت مبلمان تهران',
            jalali: '20 شهریور 1405',
            gregorian: '11 September 2026',
          },
        ]),
        '/events/70001': detailHtml({
          start: '2026-09-11',
          end: '2026-09-14',
          venue: 'محل دائمی نمایشگاه های بین المللی تهران',
        }),
      };
    });

    it('ingests and reports what it did', async () => {
      const response = await runSync({ source: 'eventro' }).expect(200);

      const eventro = response.body.sources.find((s: any) => s.source === 'eventro');
      expect(eventro.status).toBe('SUCCESS');
      expect(eventro.fetched).toBe(1);
      expect(eventro.created).toBe(1);
    });

    it('records the run for monitoring', async () => {
      await runSync({ source: 'eventro' }).expect(200);

      const [run] = await query<{ status: string; fetched_count: number; finished_at: Date }>(
        `SELECT r.status::text AS status, r.fetched_count, r.finished_at
         FROM sync_runs r JOIN sources s ON s.id = r.source_id
         WHERE s.name = 'eventro' ORDER BY r.started_at DESC LIMIT 1`,
      );
      expect(run.status).toBe('SUCCESS');
      expect(run.fetched_count).toBe(1);
      expect(run.finished_at).not.toBeNull();
    });

    it('marks the source healthy', async () => {
      await runSync({ source: 'eventro' }).expect(200);

      const [source] = await query<{ last_success_at: Date; consecutive_failures: number }>(
        `SELECT last_success_at, consecutive_failures FROM sources WHERE name = 'eventro'`,
      );
      expect(source.last_success_at).not.toBeNull();
      expect(source.consecutive_failures).toBe(0);
    });
  });

  describe('a postponed exhibition', () => {
    const withDate = (jalali: string, gregorian: string, start: string, end: string) => ({
      '/tc/fairs/tehran': listingHtml([
        {
          id: '70002',
          title: 'نمایشگاه بین المللی صنعت مبلمان تهران',
          jalali,
          gregorian,
        },
      ]),
      '/events/70002': detailHtml({
        start,
        end,
        venue: 'محل دائمی نمایشگاه های بین المللی تهران',
      }),
    });

    /** Sets up an exhibition with a reminder seven days before it starts. */
    const setUpReminder = async () => {
      pages = withDate('20 شهریور 1405', '11 September 2026', '2026-09-11', '2026-09-14');
      await runSync({ source: 'eventro' }).expect(200);

      const [exhibition] = await query<{ id: string }>(`SELECT id FROM exhibitions LIMIT 1`);
      const [user] = await query<{ id: string }>(
        `INSERT INTO users (anonymous_device_id, locale, timezone)
         VALUES ('device-sync-1', 'fa', 'Asia/Tehran') RETURNING id`,
      );
      const [reminder] = await query<{ id: string }>(
        `INSERT INTO reminders (user_id, exhibition_id, reminder_type, offset_days, offset_time, remind_at)
         VALUES ($1, $2, 'DAYS_7', 7, '09:00',
                 (($3::date - 7) + time '09:00') AT TIME ZONE 'Asia/Tehran')
         RETURNING id`,
        [user.id, exhibition.id, '2026-09-11'],
      );

      return { exhibitionId: exhibition.id, userId: user.id, reminderId: reminder.id };
    };

    it('treats a source revising its own listing as a change, not a conflict', async () => {
      await setUpReminder();

      // Section 13: the same source now publishes later dates.
      pages = withDate('25 شهریور 1405', '16 September 2026', '2026-09-16', '2026-09-19');
      await runSync({ source: 'eventro' }).expect(200);

      const [exhibition] = await query<{ start_date: string; date_status: string }>(
        `SELECT start_date, date_status FROM exhibitions LIMIT 1`,
      );
      expect(exhibition.start_date).toBe('2026-09-16');
      expect(exhibition.date_status).toBe('CONFIRMED');
    });

    it('logs the change with both dates', async () => {
      await setUpReminder();
      pages = withDate('25 شهریور 1405', '16 September 2026', '2026-09-16', '2026-09-19');
      await runSync({ source: 'eventro' }).expect(200);

      const [change] = await query<{ old_value: string; new_value: string }>(
        `SELECT old_value, new_value FROM exhibition_changes WHERE field = 'start_date'`,
      );
      expect(change.old_value).toContain('2026-09-11');
      expect(change.new_value).toContain('2026-09-16');
    });

    it('moves the reminder by the same amount, keeping the offset', async () => {
      // The core promise of section 22.
      const { reminderId } = await setUpReminder();

      const [before] = await query<{ remind_at: Date }>(
        `SELECT remind_at FROM reminders WHERE id = $1`,
        [reminderId],
      );

      pages = withDate('25 شهریور 1405', '16 September 2026', '2026-09-16', '2026-09-19');
      const response = await runSync({ source: 'eventro' }).expect(200);

      const [after] = await query<{ remind_at: Date; offset_days: number }>(
        `SELECT remind_at, offset_days FROM reminders WHERE id = $1`,
        [reminderId],
      );

      // Seven days before the new start, in Tehran local time.
      const expected = new Date('2026-09-09T09:00:00+03:30');
      expect(after.remind_at.toISOString()).toBe(expected.toISOString());
      expect(after.offset_days).toBe(7);
      expect(after.remind_at.getTime()).toBeGreaterThan(before.remind_at.getTime());
      expect(response.body.changes.remindersRescheduled).toBe(1);
    });

    it('notifies the user that the date moved', async () => {
      const { userId } = await setUpReminder();

      pages = withDate('25 شهریور 1405', '16 September 2026', '2026-09-16', '2026-09-19');
      await runSync({ source: 'eventro' }).expect(200);

      const [notification] = await query<{ type: string; title: string; body: string; payload: any }>(
        `SELECT type::text AS type, title, body, payload
         FROM notifications WHERE user_id = $1`,
        [userId],
      );

      expect(notification.type).toBe('DATE_CHANGE');
      expect(notification.title).toContain('تاریخ');
      expect(notification.payload.oldValue).toContain('2026-09-11');
      expect(notification.payload.newValue).toContain('2026-09-16');
      // The client reschedules its local alarm from this.
      expect(notification.payload.remindAt).toBeTruthy();
    });

    it('marks the change processed so it is not handled twice', async () => {
      await setUpReminder();
      pages = withDate('25 شهریور 1405', '16 September 2026', '2026-09-16', '2026-09-19');
      await runSync({ source: 'eventro' }).expect(200);

      const [pending] = await query<{ count: string }>(
        `SELECT count(*) FROM exhibition_changes WHERE processed_at IS NULL`,
      );
      expect(Number(pending.count)).toBe(0);

      // A second run must not send a duplicate notification.
      const second = await runSync({ source: 'eventro' }).expect(200);
      expect(second.body.changes.notificationsCreated).toBe(0);
    });
  });

  describe('a reminder waiting on an unknown date', () => {
    it('is scheduled as soon as a date is published', async () => {
      // Listing only, so the exhibition has no end date and stays UNKNOWN.
      pages = {
        '/tc/fairs/tehran': listingHtml([
          {
            id: '70003',
            title: 'نمایشگاه تخصصی آزمایشی تهران',
            jalali: 'مرداد 1405',
            gregorian: 'July 2026',
          },
        ]),
      };
      await runSync({ source: 'eventro' }).expect(200);

      const [exhibition] = await query<{ id: string; date_status: string }>(
        `SELECT id, date_status FROM exhibitions LIMIT 1`,
      );
      expect(exhibition.date_status).toBe('UNKNOWN');

      const [user] = await query<{ id: string }>(
        `INSERT INTO users (anonymous_device_id) VALUES ('device-sync-2') RETURNING id`,
      );
      const [reminder] = await query<{ id: string; remind_at: Date | null }>(
        `INSERT INTO reminders (user_id, exhibition_id, reminder_type, offset_days, offset_time)
         VALUES ($1, $2, 'DAYS_7', 7, '09:00') RETURNING id, remind_at`,
        [user.id, exhibition.id],
      );
      expect(reminder.remind_at).toBeNull();

      // The source now publishes a full date.
      pages = {
        '/tc/fairs/tehran': listingHtml([
          {
            id: '70003',
            title: 'نمایشگاه تخصصی آزمایشی تهران',
            jalali: '20 شهریور 1405',
            gregorian: '11 September 2026',
          },
        ]),
        '/events/70003': detailHtml({
          start: '2026-09-11',
          end: '2026-09-14',
          venue: 'شهر آفتاب',
        }),
      };
      const response = await runSync({ source: 'eventro' }).expect(200);

      const [scheduled] = await query<{ remind_at: Date }>(
        `SELECT remind_at FROM reminders WHERE id = $1`,
        [reminder.id],
      );
      expect(scheduled.remind_at).not.toBeNull();
      expect(response.body.remindersScheduled).toBeGreaterThanOrEqual(1);
    });
  });

  describe('failure handling', () => {
    it('records a failed run and increments the failure counter', async () => {
      failNext = true;
      const response = await runSync({ source: 'eventro' }).expect(200);

      expect(response.body.sources[0].status).toBe('FAILED');

      const [source] = await query<{ consecutive_failures: number; last_error: string }>(
        `SELECT consecutive_failures, last_error FROM sources WHERE name = 'eventro'`,
      );
      expect(source.consecutive_failures).toBe(1);
      expect(source.last_error).toBeTruthy();
    });

    it('resets the failure counter after a success', async () => {
      failNext = true;
      await runSync({ source: 'eventro' }).expect(200);

      failNext = false;
      pages = {
        '/tc/fairs/tehran': listingHtml([
          {
            id: '70004',
            title: 'نمایشگاه آزمایشی بازیابی',
            jalali: '20 شهریور 1405',
            gregorian: '11 September 2026',
          },
        ]),
      };
      await runSync({ source: 'eventro' }).expect(200);

      const [source] = await query<{ consecutive_failures: number; last_error: string | null }>(
        `SELECT consecutive_failures, last_error FROM sources WHERE name = 'eventro'`,
      );
      expect(source.consecutive_failures).toBe(0);
      expect(source.last_error).toBeNull();
    });

    it('skips a disabled source instead of failing it', async () => {
      const response = await runSync({ source: 'iranfair' }).expect(200);

      expect(response.body.sources[0].status).toBe('SKIPPED');
      expect(response.body.sources[0].error).toContain('disabled');

      const [source] = await query<{ consecutive_failures: number }>(
        `SELECT consecutive_failures FROM sources WHERE name = 'iranfair'`,
      );
      // A source we chose not to run is not a source that failed.
      expect(source.consecutive_failures).toBe(0);
    });

    it('reports a missing adapter without crashing the run', async () => {
      const response = await runSync({ source: 'exhibitionmakers' }).expect(200);
      expect(response.body.sources[0].status).toBe('SKIPPED');
      expect(response.body.sources[0].error).toContain('no adapter');
    });
  });

  describe('concurrency', () => {
    it('skips a second run while one holds the lock', async () => {
      await query(
        `INSERT INTO sync_locks (name, expires_at, holder)
         VALUES ('ingestion', now() + interval '30 minutes', 'other-process')`,
      );

      const response = await runSync({ source: 'eventro' }).expect(200);
      expect(response.body.lockSkipped).toBe(true);
      expect(response.body.sources).toEqual([]);
    });

    it('takes over a lock left behind by a crashed run', async () => {
      // A durable lock needs an expiry, otherwise a crash blocks sync forever.
      await query(
        `INSERT INTO sync_locks (name, expires_at, holder)
         VALUES ('ingestion', now() - interval '1 minute', 'crashed-process')`,
      );

      const response = await runSync({ source: 'eventro' }).expect(200);
      expect(response.body.lockSkipped).toBeUndefined();
    });

    it('releases the lock when the run finishes', async () => {
      await runSync({ source: 'eventro' }).expect(200);
      const [row] = await query<{ count: string }>(`SELECT count(*) FROM sync_locks`);
      expect(Number(row.count)).toBe(0);
    });
  });

  describe('source monitoring', () => {
    it('reports health and the last run for every source', async () => {
      await runSync({ source: 'eventro' }).expect(200);

      const response = await api()
        .get('/internal/sources')
        .set('X-Sync-Secret', SYNC_SECRET)
        .expect(200);

      const eventro = response.body.find((s: any) => s.name === 'eventro');
      expect(eventro.healthy).toBe(true);
      expect(eventro.hasAdapter).toBe(true);
      expect(eventro.lastRun.status).toBeTruthy();

      // The blocked official source is visible, disabled, and flagged as
      // needing the relay.
      const iranfair = response.body.find((s: any) => s.name === 'iranfair');
      expect(iranfair.isEnabled).toBe(false);
      expect(iranfair.fetchMode).toBe('RELAY');
      expect(iranfair.hasAdapter).toBe(false);
    });

    it('requires the sync secret', async () => {
      await api().get('/internal/sources').expect(401);
    });
  });

  describe('dry run', () => {
    it('reports without writing', async () => {
      pages = {
        '/tc/fairs/tehran': listingHtml([
          {
            id: '70005',
            title: 'نمایشگاه آزمایشی خشک',
            jalali: '20 شهریور 1405',
            gregorian: '11 September 2026',
          },
        ]),
      };

      const response = await runSync({ source: 'eventro', dryRun: true }).expect(200);
      expect(response.body.sources[0].created).toBe(1);

      const [row] = await query<{ count: string }>(`SELECT count(*) FROM exhibitions`);
      expect(Number(row.count)).toBe(0);

      const [runs] = await query<{ count: string }>(`SELECT count(*) FROM sync_runs`);
      expect(Number(runs.count)).toBe(0);
    });
  });
});
