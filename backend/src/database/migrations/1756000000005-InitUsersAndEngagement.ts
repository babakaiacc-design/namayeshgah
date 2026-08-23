import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Users, identities, favourites, reminders, notifications, admins.
 *
 * The reminder table stores an OFFSET (`offset_days` + `offset_time`) next to
 * the computed `remind_at` instant. That redundancy is the whole point: when a
 * source moves an exhibition, the offset is what lets the system rebuild the
 * reminder ("7 days before" stays "7 days before"). Storing only the absolute
 * instant would make the recalculation in section 9 of ARCHITECTURE.md
 * impossible.
 */
export class InitUsersAndEngagement1756000000005 implements MigrationInterface {
  name = 'InitUsersAndEngagement1756000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        -- An anonymous device account works everywhere on day one: Google
        -- sign-in is unreliable inside Iran and SMS OTP is meaningless abroad.
        anonymous_device_id  text UNIQUE,

        display_name         text,
        locale               text NOT NULL DEFAULT 'fa',
        timezone             text NOT NULL DEFAULT 'Asia/Tehran',
        tier                 user_tier_enum NOT NULL DEFAULT 'FREE',
        is_active            boolean NOT NULL DEFAULT true,
        last_seen_at         timestamptz,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE auth_identities (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider      auth_provider_enum NOT NULL,
        provider_uid  text NOT NULL,
        email         text,
        password_hash text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_uid)
      );
      CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);
    `);

    // One row covers both kinds of follow. Following a category is what feeds
    // the "new exhibition in your field" notification.
    await queryRunner.query(`
      CREATE TABLE favorites (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exhibition_id  uuid REFERENCES exhibitions(id) ON DELETE CASCADE,
        category_id    uuid REFERENCES categories(id) ON DELETE CASCADE,
        created_at     timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT chk_favorites_exactly_one_target CHECK (
          (exhibition_id IS NOT NULL AND category_id IS NULL) OR
          (exhibition_id IS NULL AND category_id IS NOT NULL)
        )
      );
      CREATE UNIQUE INDEX idx_favorites_user_exhibition
        ON favorites(user_id, exhibition_id) WHERE exhibition_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_favorites_user_category
        ON favorites(user_id, category_id) WHERE category_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE reminders (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exhibition_id    uuid NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,

        reminder_type    reminder_type_enum NOT NULL,

        -- Days before the start date, and the local time of day to fire.
        -- Keep these; remind_at is derived from them plus the city timezone.
        offset_days      integer NOT NULL,
        offset_time      time NOT NULL DEFAULT '09:00',

        -- Null while the exhibition date is UNKNOWN: nothing to schedule yet,
        -- but the user's intent is still recorded and will be honoured as soon
        -- as a date arrives.
        remind_at        timestamptz,

        -- Id of the alarm the client scheduled, so it can cancel or replace it.
        notification_id  text,

        is_active        boolean NOT NULL DEFAULT true,
        is_sent          boolean NOT NULL DEFAULT false,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT chk_reminders_offset_non_negative CHECK (offset_days >= 0),
        UNIQUE (user_id, exhibition_id, reminder_type, offset_days)
      );
      CREATE INDEX idx_reminders_user ON reminders(user_id);
      CREATE INDEX idx_reminders_exhibition ON reminders(exhibition_id);
      CREATE INDEX idx_reminders_due
        ON reminders(remind_at) WHERE is_active AND NOT is_sent;
    `);

    await queryRunner.query(`
      CREATE TABLE notifications (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type           notification_type_enum NOT NULL,
        title          text NOT NULL,
        body           text NOT NULL,
        exhibition_id  uuid REFERENCES exhibitions(id) ON DELETE CASCADE,
        payload        jsonb,
        is_read        boolean NOT NULL DEFAULT false,
        sent_at        timestamptz,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_notifications_user_created
        ON notifications(user_id, created_at DESC);
      CREATE INDEX idx_notifications_unread
        ON notifications(user_id) WHERE NOT is_read;
    `);

    await queryRunner.query(`
      CREATE TABLE admin_users (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email          text NOT NULL UNIQUE,
        password_hash  text NOT NULL,
        name           text NOT NULL,
        role           admin_role_enum NOT NULL DEFAULT 'VIEWER',
        is_active      boolean NOT NULL DEFAULT true,
        last_login_at  timestamptz,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS admin_users`);
    await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
    await queryRunner.query(`DROP TABLE IF EXISTS reminders`);
    await queryRunner.query(`DROP TABLE IF EXISTS favorites`);
    await queryRunner.query(`DROP TABLE IF EXISTS auth_identities`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
