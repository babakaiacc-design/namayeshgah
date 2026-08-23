import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { REMINDER_TYPE_OFFSETS, computeRemindAt } from '../../common/dates/reminder-time';
import { CreateReminderDto, ReminderDto, ReminderType } from './dto/reminder.dto';
import { returningRows } from '../../common/db/returning';

/**
 * Free accounts get a bounded number of active reminders.
 *
 * The tier column and this limit are the whole monetization hook from section
 * 54: the paid tier lifts the cap. No payment code exists yet, and none is
 * needed for the cap to be meaningful.
 */
const TIER_REMINDER_LIMITS: Record<string, number> = {
  FREE: 15,
  PRO: 500,
  BUSINESS: 5000,
};

@Injectable()
export class RemindersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(
    user: { id: string; tier: string },
    input: CreateReminderDto,
  ): Promise<ReminderDto> {
    const [exhibition] = await this.dataSource.query(
      `SELECT e.id, e.start_date, ci.timezone,
              COALESCE(t.title, e.canonical_title) AS title
       FROM exhibitions e
       JOIN cities ci ON ci.id = e.city_id
       LEFT JOIN exhibition_translations t
              ON t.exhibition_id = e.id AND t.locale = 'fa'
       WHERE e.id = $1`,
      [input.exhibitionId],
    );

    if (!exhibition) throw new NotFoundException('exhibition was not found');

    const offsetDays =
      input.type === ReminderType.Custom
        ? (input.offsetDays as number)
        : REMINDER_TYPE_OFFSETS[input.type];

    if (offsetDays === undefined) {
      throw new BadRequestException(`unknown reminder type "${input.type}"`);
    }

    const offsetTime = input.offsetTime ?? '09:00';

    await this.assertWithinLimit(user);

    // Null when the exhibition has no published date yet. The row is still
    // created so the intent survives, and the sync schedules it as soon as a
    // date arrives.
    const remindAt = computeRemindAt(
      exhibition.start_date,
      offsetDays,
      offsetTime,
      exhibition.timezone,
    );

    const [row] = await this.dataSource.query(
      `INSERT INTO reminders (user_id, exhibition_id, reminder_type, offset_days, offset_time, remind_at)
       VALUES ($1, $2, $3::reminder_type_enum, $4, $5, $6)
       ON CONFLICT (user_id, exhibition_id, reminder_type, offset_days) DO UPDATE
         SET offset_time = EXCLUDED.offset_time,
             remind_at   = EXCLUDED.remind_at,
             is_active   = true,
             is_sent     = false,
             updated_at  = now()
       RETURNING id, reminder_type::text AS reminder_type, offset_days, offset_time,
                 remind_at, is_active, is_sent, created_at`,
      [user.id, input.exhibitionId, input.type, offsetDays, offsetTime, remindAt ?? null],
    );

    return this.toDto(row, exhibition);
  }

  /**
   * Counts only active, unsent reminders.
   *
   * A reminder that already fired, or one the user switched off, should not
   * consume the allowance.
   */
  private async assertWithinLimit(user: { id: string; tier: string }): Promise<void> {
    const limit = TIER_REMINDER_LIMITS[user.tier] ?? TIER_REMINDER_LIMITS.FREE;

    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS active FROM reminders
       WHERE user_id = $1 AND is_active AND NOT is_sent`,
      [user.id],
    );

    if (Number(row?.active ?? 0) >= limit) {
      throw new ForbiddenException(
        `reminder limit reached for the ${user.tier} tier (${limit})`,
      );
    }
  }

  async list(userId: string): Promise<ReminderDto[]> {
    const rows = await this.dataSource.query(
      `SELECT r.id, r.exhibition_id, r.reminder_type::text AS reminder_type,
              r.offset_days, r.offset_time, r.remind_at, r.is_active, r.is_sent,
              r.created_at, e.start_date, ci.timezone,
              COALESCE(t.title, e.canonical_title) AS title
       FROM reminders r
       JOIN exhibitions e ON e.id = r.exhibition_id
       JOIN cities ci     ON ci.id = e.city_id
       LEFT JOIN exhibition_translations t
              ON t.exhibition_id = e.id AND t.locale = 'fa'
       WHERE r.user_id = $1 AND r.is_active
       ORDER BY r.remind_at NULLS LAST, r.created_at`,
      [userId],
    );

    return rows.map((row: any) =>
      this.toDto(row, {
        id: row.exhibition_id,
        title: row.title,
        start_date: row.start_date,
        timezone: row.timezone,
      }),
    );
  }

  /**
   * Reminders whose moment has arrived but which have not been marked sent.
   *
   * This is the layer that always works on the web, where no local scheduled
   * notification API exists: the client asks on open and shows what is due.
   */
  async due(userId: string): Promise<ReminderDto[]> {
    const rows = await this.dataSource.query(
      `SELECT r.id, r.exhibition_id, r.reminder_type::text AS reminder_type,
              r.offset_days, r.offset_time, r.remind_at, r.is_active, r.is_sent,
              r.created_at, e.start_date, ci.timezone,
              COALESCE(t.title, e.canonical_title) AS title
       FROM reminders r
       JOIN exhibitions e ON e.id = r.exhibition_id
       JOIN cities ci     ON ci.id = e.city_id
       LEFT JOIN exhibition_translations t
              ON t.exhibition_id = e.id AND t.locale = 'fa'
       WHERE r.user_id = $1 AND r.is_active AND NOT r.is_sent
         AND r.remind_at IS NOT NULL AND r.remind_at <= now()
         -- An exhibition that already finished is no longer worth announcing.
         AND (e.end_date IS NULL OR e.end_date >= (now() AT TIME ZONE ci.timezone)::date)
       ORDER BY r.remind_at`,
      [userId],
    );

    return rows.map((row: any) =>
      this.toDto(row, {
        id: row.exhibition_id,
        title: row.title,
        start_date: row.start_date,
        timezone: row.timezone,
      }),
    );
  }

  /** Marks reminders as delivered so they stop appearing as due. */
  async acknowledge(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const updated = returningRows(
      await this.dataSource.query(
        `UPDATE reminders SET is_sent = true, updated_at = now()
         WHERE user_id = $1 AND id = ANY($2::uuid[])
         RETURNING id`,
        [userId, ids],
      ),
    );
    return updated.length;
  }

  async remove(userId: string, id: string): Promise<void> {
    // Scoping the delete by user is what stops one account removing another
    // account's reminder by guessing an id, and returningRows is what makes the
    // miss actually observable — see common/db/returning.ts.
    const deleted = returningRows(
      await this.dataSource.query(
        `DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
      ),
    );
    if (deleted.length === 0) throw new NotFoundException('reminder was not found');
  }

  private toDto(
    row: any,
    exhibition: { id: string; title: string; start_date: string | null; timezone: string },
  ): ReminderDto {
    return {
      id: row.id,
      exhibitionId: exhibition.id,
      exhibitionTitle: exhibition.title,
      type: row.reminder_type,
      offsetDays: Number(row.offset_days),
      offsetTime: String(row.offset_time).slice(0, 5),
      remindAt: row.remind_at ? new Date(row.remind_at).toISOString() : null,
      exhibitionStart: exhibition.start_date,
      timezone: exhibition.timezone,
      isActive: row.is_active,
      isSent: row.is_sent,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
