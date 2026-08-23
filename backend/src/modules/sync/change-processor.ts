import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { computeRemindAt } from '../../common/dates/reminder-time';
import { renderNotification } from '../notifications/notification-templates';

export interface ChangeProcessingResult {
  changesProcessed: number;
  remindersRescheduled: number;
  remindersUnscheduled: number;
  notificationsCreated: number;
}

interface PendingChange {
  change_id: string;
  exhibition_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  title: string;
  start_date: string | null;
  timezone: string;
}

/**
 * Turns a detected change into consequences for users.
 *
 * This is the second half of section 22 of the brief. Ingestion records that an
 * exhibition moved; this decides what that means for everyone who asked to be
 * reminded about it.
 *
 * The rule is that the OFFSET survives, not the instant. A user who asked for
 * "seven days before" still gets seven days of notice after the exhibition
 * moves, which is only possible because reminders store the offset.
 */
@Injectable()
export class ChangeProcessor {
  private readonly logger = new Logger(ChangeProcessor.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async processPending(limit = 500): Promise<ChangeProcessingResult> {
    const result: ChangeProcessingResult = {
      changesProcessed: 0,
      remindersRescheduled: 0,
      remindersUnscheduled: 0,
      notificationsCreated: 0,
    };

    const pending: PendingChange[] = await this.dataSource.query(
      `SELECT c.id AS change_id, c.exhibition_id, c.field, c.old_value, c.new_value,
              COALESCE(t.title, e.canonical_title) AS title,
              e.start_date, ci.timezone
       FROM exhibition_changes c
       JOIN exhibitions e ON e.id = c.exhibition_id
       JOIN cities ci     ON ci.id = e.city_id
       LEFT JOIN exhibition_translations t
              ON t.exhibition_id = e.id AND t.locale = 'fa'
       WHERE c.processed_at IS NULL
       ORDER BY c.detected_at
       LIMIT $1`,
      [limit],
    );

    for (const change of pending) {
      try {
        await this.dataSource.transaction(async (manager) => {
          if (change.field === 'start_date') {
            await this.rescheduleReminders(manager, change, result);
          }
          await manager.query(
            `UPDATE exhibition_changes SET processed_at = now() WHERE id = $1`,
            [change.change_id],
          );
        });
        result.changesProcessed += 1;
      } catch (error) {
        // A change that cannot be processed stays unprocessed so the next run
        // retries it, rather than being marked done and silently dropped.
        this.logger.error(
          `failed to process change ${change.change_id}: ${(error as Error).message}`,
        );
      }
    }

    return result;
  }

  private async rescheduleReminders(
    manager: EntityManager,
    change: PendingChange,
    result: ChangeProcessingResult,
  ): Promise<void> {
    const reminders = await manager.query(
      `SELECT r.id, r.user_id, r.offset_days, r.offset_time, r.remind_at,
              u.locale
       FROM reminders r
       JOIN users u ON u.id = r.user_id
       WHERE r.exhibition_id = $1 AND r.is_active AND NOT r.is_sent
       FOR UPDATE OF r`,
      [change.exhibition_id],
    );

    if (reminders.length === 0) return;

    for (const reminder of reminders) {
      const remindAt = computeRemindAt(
        change.start_date,
        Number(reminder.offset_days),
        String(reminder.offset_time),
        change.timezone,
      );

      await manager.query(`UPDATE reminders SET remind_at = $2, updated_at = now() WHERE id = $1`, [
        reminder.id,
        remindAt ?? null,
      ]);

      if (remindAt) result.remindersRescheduled += 1;
      // The exhibition lost its date, so there is nothing to fire. The row
      // stays active and will be rescheduled when a date reappears.
      else result.remindersUnscheduled += 1;

      const rendered = renderNotification('DATE_CHANGE', reminder.locale ?? 'fa', {
        title: change.title,
        oldValue: change.old_value ?? '—',
        newValue: change.new_value ?? '—',
      });

      await manager.query(
        `INSERT INTO notifications (user_id, type, title, body, exhibition_id, payload)
         VALUES ($1, 'DATE_CHANGE'::notification_type_enum, $2, $3, $4, $5)`,
        [
          reminder.user_id,
          rendered.title,
          rendered.body,
          change.exhibition_id,
          JSON.stringify({
            field: change.field,
            oldValue: change.old_value,
            newValue: change.new_value,
            // The client reschedules its own local alarm from this.
            remindAt: remindAt ? remindAt.toISOString() : null,
            reminderId: reminder.id,
          }),
        ],
      );

      result.notificationsCreated += 1;
    }
  }

  /**
   * Recomputes remind_at for reminders that have none, which happens when a
   * reminder was created while the exhibition date was still UNKNOWN.
   *
   * Run after every sync so a date arriving for the first time schedules the
   * reminders that were waiting for it, without needing a change record.
   */
  async scheduleWaitingReminders(): Promise<number> {
    const waiting = await this.dataSource.query(
      `SELECT r.id, r.offset_days, r.offset_time, e.start_date, ci.timezone
       FROM reminders r
       JOIN exhibitions e ON e.id = r.exhibition_id
       JOIN cities ci     ON ci.id = e.city_id
       WHERE r.is_active AND NOT r.is_sent
         AND r.remind_at IS NULL
         AND e.start_date IS NOT NULL`,
    );

    let scheduled = 0;
    for (const reminder of waiting) {
      const remindAt = computeRemindAt(
        reminder.start_date,
        Number(reminder.offset_days),
        String(reminder.offset_time),
        reminder.timezone,
      );
      if (!remindAt) continue;

      await this.dataSource.query(
        `UPDATE reminders SET remind_at = $2, updated_at = now() WHERE id = $1`,
        [reminder.id, remindAt],
      );
      scheduled += 1;
    }

    return scheduled;
  }
}
