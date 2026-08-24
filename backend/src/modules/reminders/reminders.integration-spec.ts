import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestDatabase, migratedDataSource } from '../../../test/test-db';

describe('reminders and favorites', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let otherToken: string;
  let exhibitionId: string;
  let undatedId: string;
  let categoryId: string;

  const api = () => request(app.getHttpServer());

  // supertest exposes .set() on a Test, not on the agent, so the header has to
  // be attached after the verb rather than before it.
  const get = (path: string) => api().get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string) => api().post(path).set('Authorization', `Bearer ${token}`);
  const del = (path: string) => api().delete(path).set('Authorization', `Bearer ${token}`);
  const query = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    dataSource.query(sql, params);

  beforeAll(async () => {
    const url = await createTestDatabase('reminders');

    process.env.DATABASE_URL = url;
    process.env.DB_SSL = 'false';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'reminders-integration-secret-long-enough-ok';
    process.env.SYNC_SECRET = 'reminders-integration-sync-secret-long-enough';
    process.env.LOG_LEVEL = 'silent';

    dataSource = await migratedDataSource(url);
    const { seed } = await import('../../database/seeds/run-seed');
    await seed(dataSource);

    const [city] = await query<{ id: string }>(`SELECT id FROM cities WHERE slug = 'tehran'`);
    const [category] = await query<{ id: string }>(
      `SELECT id FROM categories WHERE slug = 'furniture'`,
    );
    categoryId = category.id;

    const [dated] = await query<{ id: string }>(
      `INSERT INTO exhibitions (slug, canonical_title, city_id, start_date, end_date, date_status)
       VALUES ('furniture-fair', 'نمایشگاه مبلمان تهران', $1, '2026-09-11', '2026-09-14', 'CONFIRMED')
       RETURNING id`,
      [city.id],
    );
    exhibitionId = dated.id;

    const [undated] = await query<{ id: string }>(
      `INSERT INTO exhibitions (slug, canonical_title, city_id, date_status)
       VALUES ('undated-fair', 'نمایشگاه بدون تاریخ', $1, 'UNKNOWN')
       RETURNING id`,
      [city.id],
    );
    undatedId = undated.id;

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const signIn = async (deviceId: string) => {
      const response = await api().post('/auth/device').send({ deviceId }).expect(201);
      return response.body.accessToken as string;
    };
    token = await signIn('device-reminders-primary');
    otherToken = await signIn('device-reminders-other');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await query('DELETE FROM reminders');
    await query('DELETE FROM favorites');
    await query(`UPDATE users SET tier = 'FREE'`);
  });

  describe('access control', () => {
    it('refuses to create a reminder without an account', async () => {
      // Section 33: browsing is open, reminders are not.
      await api().post('/reminders').send({ exhibitionId, type: 'DAYS_7' }).expect(401);
    });

    it('refuses to list reminders without an account', async () => {
      await api().get('/reminders').expect(401);
    });
  });

  describe('creating a reminder', () => {
    it('computes the moment in the exhibition city timezone', async () => {
      const response = await post('/reminders')
        .send({ exhibitionId, type: 'DAYS_7' })
        .expect(201);

      expect(response.body.offsetDays).toBe(7);
      expect(response.body.offsetTime).toBe('09:00');
      // Seven days before 2026-09-11 at 09:00 Tehran time.
      expect(response.body.remindAt).toBe(new Date('2026-09-04T09:00:00+03:30').toISOString());
      expect(response.body.timezone).toBe('Asia/Tehran');
    });

    it('supports every fixed option from the brief', async () => {
      for (const type of ['DAYS_30', 'DAYS_14', 'DAYS_7', 'DAYS_3', 'DAYS_1', 'START_DAY']) {
        const response = await post('/reminders').send({ exhibitionId, type }).expect(201);
        expect(response.body.type).toBe(type);
      }

      const list = await get('/reminders').expect(200);
      expect(list.body).toHaveLength(6);
    });

    it('accepts a custom offset and time', async () => {
      const response = await post('/reminders')
        .send({ exhibitionId, type: 'CUSTOM', offsetDays: 5, offsetTime: '10:00' })
        .expect(201);

      expect(response.body.offsetDays).toBe(5);
      // Five days before, at ten in the morning Tehran time.
      expect(response.body.remindAt).toBe(new Date('2026-09-06T10:00:00+03:30').toISOString());
    });

    it('requires an offset for a custom reminder', async () => {
      await post('/reminders').send({ exhibitionId, type: 'CUSTOM' }).expect(400);
    });

    it('rejects a malformed time', async () => {
      await post('/reminders')
        .send({ exhibitionId, type: 'DAYS_7', offsetTime: '9am' })
        .expect(400);
    });

    it('records the intent even when the date is unknown', async () => {
      // Rule 58 forbids inventing a date, so there is nothing to schedule yet.
      // Losing the request instead would be worse than storing it unscheduled.
      const response = await post('/reminders')
        .send({ exhibitionId: undatedId, type: 'DAYS_7' })
        .expect(201);

      expect(response.body.remindAt).toBeNull();
      expect(response.body.offsetDays).toBe(7);
    });

    it('is idempotent for the same exhibition and type', async () => {
      await post('/reminders').send({ exhibitionId, type: 'DAYS_7' }).expect(201);
      await post('/reminders').send({ exhibitionId, type: 'DAYS_7' }).expect(201);

      const list = await get('/reminders').expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('returns 404 for an exhibition that does not exist', async () => {
      await post('/reminders')
        .send({ exhibitionId: '11111111-1111-4111-8111-111111111111', type: 'DAYS_7' })
        .expect(404);
    });
  });

  describe('tier limits', () => {
    it('caps active reminders on the free tier', async () => {
      // The monetization hook from section 54, enforced without any payment
      // code existing.
      const [city] = await query<{ id: string }>(`SELECT id FROM cities WHERE slug = 'tehran'`);

      for (let index = 0; index < 15; index += 1) {
        const [row] = await query<{ id: string }>(
          `INSERT INTO exhibitions (slug, canonical_title, city_id, start_date, end_date, date_status)
           VALUES ($1, $2, $3, '2026-10-01', '2026-10-03', 'CONFIRMED') RETURNING id`,
          [`limit-fair-${index}`, `نمایشگاه ${index}`, city.id],
        );
        await post('/reminders').send({ exhibitionId: row.id, type: 'DAYS_7' }).expect(201);
      }

      await post('/reminders').send({ exhibitionId, type: 'DAYS_7' }).expect(403);
    });

    it('lifts the cap for a paid tier', async () => {
      await query(`UPDATE users SET tier = 'PRO'`);
      // A new token so the payload carries the upgraded tier.
      const upgraded = await api()
        .post('/auth/device')
        .send({ deviceId: 'device-reminders-primary' })
        .expect(201);

      const response = await api()
        .post('/reminders')
        .set('Authorization', `Bearer ${upgraded.body.accessToken}`)
        .send({ exhibitionId, type: 'DAYS_7' })
        .expect(201);

      expect(response.body.id).toBeTruthy();
    });
  });

  describe('due reminders', () => {
    /** The layer that always works on the web, where no local alarm API exists. */
    const makeDue = async () => {
      const created = await post('/reminders')
        .send({ exhibitionId, type: 'DAYS_7' })
        .expect(201);

      await query(`UPDATE reminders SET remind_at = now() - interval '1 hour' WHERE id = $1`, [
        created.body.id,
      ]);
      return created.body.id as string;
    };

    it('surfaces a reminder whose moment has passed', async () => {
      const id = await makeDue();
      const due = await get('/reminders/due').expect(200);
      expect(due.body.map((r: any) => r.id)).toContain(id);
    });

    it('does not surface one whose moment is still ahead', async () => {
      await post('/reminders').send({ exhibitionId, type: 'DAYS_7' }).expect(201);
      const due = await get('/reminders/due').expect(200);
      expect(due.body).toEqual([]);
    });

    it('stops surfacing once acknowledged', async () => {
      const id = await makeDue();

      const ack = await post('/reminders/acknowledge').send({ ids: [id] }).expect(200);
      expect(ack.body.acknowledged).toBe(1);

      const due = await get('/reminders/due').expect(200);
      expect(due.body).toEqual([]);
    });

    it('ignores a past exhibition whose end date was never published', async () => {
      // Without a published end date the start date is the last day we know
      // about. Treating "unknown end" as "still running" would leave a stale
      // reminder in the due list indefinitely.
      const id = await makeDue();
      await query(
        `UPDATE exhibitions SET start_date = current_date - 30, end_date = NULL,
                date_status = 'UNKNOWN' WHERE id = $1`,
        [exhibitionId],
      );

      const due = await get('/reminders/due').expect(200);
      expect(due.body.map((r: any) => r.id)).not.toContain(id);

      await query(
        `UPDATE exhibitions SET start_date = '2026-09-11', end_date = '2026-09-14',
                date_status = 'CONFIRMED' WHERE id = $1`,
        [exhibitionId],
      );
    });

    it('ignores an exhibition that has already finished', async () => {
      const id = await makeDue();
      // Both ends move, because the schema rightly refuses a range whose end
      // precedes its start.
      await query(
        `UPDATE exhibitions SET start_date = current_date - 8, end_date = current_date - 5
         WHERE id = $1`,
        [exhibitionId],
      );

      const due = await get('/reminders/due').expect(200);
      expect(due.body.map((r: any) => r.id)).not.toContain(id);

      await query(
        `UPDATE exhibitions SET start_date = '2026-09-11', end_date = '2026-09-14' WHERE id = $1`,
        [exhibitionId],
      );
    });
  });

  describe('ownership', () => {
    it('does not let one account delete another account reminder', async () => {
      const created = await post('/reminders')
        .send({ exhibitionId, type: 'DAYS_7' })
        .expect(201);

      await api()
        .delete(`/reminders/${created.body.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);

      // Still there for its owner.
      const list = await get('/reminders').expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('does not show one account the reminders of another', async () => {
      await post('/reminders').send({ exhibitionId, type: 'DAYS_7' }).expect(201);

      const other = await api()
        .get('/reminders')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);
      expect(other.body).toEqual([]);
    });

    it('deletes its own reminder', async () => {
      const created = await post('/reminders')
        .send({ exhibitionId, type: 'DAYS_7' })
        .expect(201);

      await del(`/reminders/${created.body.id}`).expect(204);
      const list = await get('/reminders').expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe('favorites', () => {
    it('follows an exhibition', async () => {
      const response = await post('/favorites').send({ exhibitionId }).expect(201);
      expect(response.body.kind).toBe('exhibition');
      expect(response.body.title).toContain('مبلمان');
    });

    it('follows a category', async () => {
      // Following a category is what feeds "new exhibition in your field".
      const response = await post('/favorites').send({ categoryId }).expect(201);
      expect(response.body.kind).toBe('category');
    });

    it('rejects following both at once', async () => {
      await post('/favorites').send({ exhibitionId, categoryId }).expect(400);
    });

    it('rejects following nothing', async () => {
      await post('/favorites').send({}).expect(400);
    });

    it('is idempotent, so a double tap does not error', async () => {
      const first = await post('/favorites').send({ exhibitionId }).expect(201);
      const second = await post('/favorites').send({ exhibitionId }).expect(201);

      expect(second.body.id).toBe(first.body.id);
      const list = await get('/favorites').expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('keeps accounts separate', async () => {
      await post('/favorites').send({ exhibitionId }).expect(201);

      const other = await api()
        .get('/favorites')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);
      expect(other.body).toEqual([]);
    });

    it('unfollows', async () => {
      const created = await post('/favorites').send({ exhibitionId }).expect(201);
      await del(`/favorites/${created.body.id}`).expect(204);

      const list = await get('/favorites').expect(200);
      expect(list.body).toEqual([]);
    });

    it('returns 404 for an exhibition that does not exist', async () => {
      await post('/favorites')
        .send({ exhibitionId: '11111111-1111-4111-8111-111111111111' })
        .expect(404);
    });
  });

  describe('a postponement moves the reminder', () => {
    it('reschedules a reminder created through the API', async () => {
      // The full loop of section 22, from the endpoint a client actually calls
      // through to the change processor.
      const created = await post('/reminders')
        .send({ exhibitionId, type: 'DAYS_7' })
        .expect(201);

      expect(created.body.remindAt).toBe(new Date('2026-09-04T09:00:00+03:30').toISOString());

      const [source] = await query<{ id: string }>(`SELECT id FROM sources WHERE name = 'eventro'`);
      await query(`UPDATE exhibitions SET start_date = '2026-09-16', end_date = '2026-09-19' WHERE id = $1`, [
        exhibitionId,
      ]);
      await query(
        `INSERT INTO exhibition_changes (exhibition_id, field, old_value, new_value, source_id)
         VALUES ($1, 'start_date', '2026-09-11', '2026-09-16', $2)`,
        [exhibitionId, source.id],
      );

      const { ChangeProcessor } = await import('../sync/change-processor');
      const processor = app.get(ChangeProcessor);
      const result = await processor.processPending();

      expect(result.remindersRescheduled).toBe(1);
      expect(result.notificationsCreated).toBe(1);

      const list = await get('/reminders').expect(200);
      // Still seven days before, now measured from the new start date.
      expect(list.body[0].remindAt).toBe(new Date('2026-09-09T09:00:00+03:30').toISOString());
      expect(list.body[0].offsetDays).toBe(7);

      await query(`UPDATE exhibitions SET start_date = '2026-09-11', end_date = '2026-09-14' WHERE id = $1`, [
        exhibitionId,
      ]);
    });
  });
});
