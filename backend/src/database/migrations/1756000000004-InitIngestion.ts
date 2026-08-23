import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ingestion bookkeeping: sources, the raw record each source produced, the
 * change log, and per-run monitoring.
 *
 * `exhibition_source_records` is what makes rule 58 enforceable. Every date the
 * app displays can be traced back to the exact source row it came from, and
 * when two sources disagree BOTH rows survive — the conflict is recorded rather
 * than resolved by picking a winner at random.
 */
export class InitIngestion1756000000004 implements MigrationInterface {
  name = 'InitIngestion1756000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sources (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name                   text NOT NULL UNIQUE,
        display_name           text NOT NULL,
        base_url               text NOT NULL,

        -- Trust weight applied to everything this source reports.
        confidence             numeric(3,2) NOT NULL DEFAULT 0.40,

        -- DIRECT for reachable hosts, RELAY for the ones only an Iranian
        -- egress can reach. Adapters never look at this; the Fetcher does.
        fetch_mode             fetch_mode_enum NOT NULL DEFAULT 'DIRECT',

        -- Blocked sources ship disabled and are switched on when the relay lands.
        is_enabled             boolean NOT NULL DEFAULT false,

        sync_interval_hours    integer NOT NULL DEFAULT 12,
        rate_limit_per_sec     integer NOT NULL DEFAULT 1,

        last_success_at        timestamptz,
        last_failure_at        timestamptz,
        last_error             text,
        consecutive_failures   integer NOT NULL DEFAULT 0,

        robots_checked_at      timestamptz,
        notes                  text,

        created_at             timestamptz NOT NULL DEFAULT now(),
        updated_at             timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT chk_sources_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
        CONSTRAINT chk_sources_rate_limit CHECK (rate_limit_per_sec BETWEEN 1 AND 10)
      );
      CREATE INDEX idx_sources_enabled ON sources(is_enabled) WHERE is_enabled;
    `);

    await queryRunner.query(`
      CREATE TABLE exhibition_source_records (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Null until deduplication attaches the record to a canonical event.
        exhibition_id       uuid REFERENCES exhibitions(id) ON DELETE SET NULL,
        source_id           uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,

        source_external_id  text,
        source_url          text NOT NULL,
        source_title        text NOT NULL,
        source_title_norm   text GENERATED ALWAYS AS (persian_normalize_search(source_title)) STORED,
        source_start_date   date,
        source_end_date     date,
        source_venue        text,
        source_category     text,
        source_organizer    text,

        -- Verbatim payload, so a parser bug can be re-run without re-fetching.
        raw_payload         jsonb,

        -- Lets a sync skip untouched records and detect real edits cheaply.
        content_hash        text NOT NULL,

        confidence          numeric(3,2) NOT NULL DEFAULT 0.40,
        first_seen_at       timestamptz NOT NULL DEFAULT now(),
        last_fetched_at     timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT chk_source_records_date_order
          CHECK (source_start_date IS NULL OR source_end_date IS NULL
                 OR source_start_date <= source_end_date)
      );

      -- A source's own id is the strongest dedup signal available.
      CREATE UNIQUE INDEX idx_source_records_external
        ON exhibition_source_records(source_id, source_external_id)
        WHERE source_external_id IS NOT NULL;

      CREATE INDEX idx_source_records_exhibition ON exhibition_source_records(exhibition_id);
      CREATE INDEX idx_source_records_unmatched
        ON exhibition_source_records(source_id) WHERE exhibition_id IS NULL;
      CREATE INDEX idx_source_records_title_norm
        ON exhibition_source_records(source_title_norm);
    `);

    await queryRunner.query(`
      CREATE TABLE exhibition_changes (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        exhibition_id  uuid NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
        field          text NOT NULL,
        old_value      text,
        new_value      text,
        source_id      uuid REFERENCES sources(id) ON DELETE SET NULL,
        detected_at    timestamptz NOT NULL DEFAULT now(),

        -- Set once affected reminders have been recalculated and users told.
        processed_at   timestamptz
      );
      CREATE INDEX idx_exhibition_changes_exhibition ON exhibition_changes(exhibition_id);
      CREATE INDEX idx_exhibition_changes_unprocessed
        ON exhibition_changes(detected_at) WHERE processed_at IS NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE sync_runs (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id        uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        status           sync_status_enum NOT NULL DEFAULT 'RUNNING',
        started_at       timestamptz NOT NULL DEFAULT now(),
        finished_at      timestamptz,
        fetched_count    integer NOT NULL DEFAULT 0,
        created_count    integer NOT NULL DEFAULT 0,
        updated_count    integer NOT NULL DEFAULT 0,
        duplicate_count  integer NOT NULL DEFAULT 0,
        conflict_count   integer NOT NULL DEFAULT 0,
        failed_count     integer NOT NULL DEFAULT 0,
        error_message    text,
        details          jsonb
      );
      CREATE INDEX idx_sync_runs_source_started ON sync_runs(source_id, started_at DESC);
    `);

    // A single scheduler triggers sync, but a manual run can overlap it.
    // Advisory locks live only for a session, so an ordinary table gives the
    // pipeline a durable mutex without needing Redis.
    await queryRunner.query(`
      CREATE TABLE sync_locks (
        name        text PRIMARY KEY,
        locked_at   timestamptz NOT NULL DEFAULT now(),
        expires_at  timestamptz NOT NULL,
        holder      text
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sync_locks`);
    await queryRunner.query(`DROP TABLE IF EXISTS sync_runs`);
    await queryRunner.query(`DROP TABLE IF EXISTS exhibition_changes`);
    await queryRunner.query(`DROP TABLE IF EXISTS exhibition_source_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS sources`);
  }
}
