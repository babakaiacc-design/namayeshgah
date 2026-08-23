import { validateEnv } from './env.validation';

const LONG_SECRET = 'a'.repeat(48);

const productionEnv = (overrides: Record<string, unknown> = {}) => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/postgres',
  JWT_SECRET: LONG_SECRET,
  SYNC_SECRET: LONG_SECRET,
  ...overrides,
});

describe('validateEnv', () => {
  describe('in development', () => {
    it('only requires a database url', () => {
      expect(() => validateEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x' })).not.toThrow();
    });

    it('rejects a missing database url', () => {
      expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL is required/);
    });

    it('tolerates placeholder secrets so local setup is frictionless', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgres://x',
          JWT_SECRET: 'replace-me-with-a-long-random-string',
        }),
      ).not.toThrow();
    });
  });

  describe('in production', () => {
    it('accepts a well-formed configuration', () => {
      expect(() => validateEnv(productionEnv())).not.toThrow();
    });

    it('rejects secrets left at their .env.example placeholder', () => {
      expect(() =>
        validateEnv(productionEnv({ JWT_SECRET: 'replace-me-with-a-long-random-string' })),
      ).toThrow(/JWT_SECRET still holds the placeholder/);
    });

    it('rejects secrets that are too short', () => {
      expect(() => validateEnv(productionEnv({ SYNC_SECRET: 'short' }))).toThrow(
        /SYNC_SECRET must be at least 32 characters/,
      );
    });

    it('rejects a missing sync secret', () => {
      expect(() => validateEnv(productionEnv({ SYNC_SECRET: undefined }))).toThrow(
        /SYNC_SECRET is required/,
      );
    });

    it('never allows schema synchronize', () => {
      expect(() => validateEnv(productionEnv({ DB_SYNCHRONIZE: 'true' }))).toThrow(
        /DB_SYNCHRONIZE must never be true/,
      );
    });

    it('reports every problem at once rather than one per boot', () => {
      const attempt = () =>
        validateEnv({ NODE_ENV: 'production', DB_SYNCHRONIZE: 'true' });
      expect(attempt).toThrow(/DATABASE_URL is required/);
      expect(attempt).toThrow(/JWT_SECRET is required/);
      expect(attempt).toThrow(/DB_SYNCHRONIZE must never be true/);
    });

    // The trap that costs the most debugging time — see ARCHITECTURE.md §3.
    describe('Supabase transaction pooler', () => {
      const poolerUrl =
        'postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';

      it('rejects prepared statements when using the pooler hostname', () => {
        expect(() =>
          validateEnv(productionEnv({ DATABASE_URL: poolerUrl, DB_PREPARE: 'true' })),
        ).toThrow(/DB_PREPARE must be false/);
      });

      it('rejects the default when DB_PREPARE is simply absent', () => {
        expect(() => validateEnv(productionEnv({ DATABASE_URL: poolerUrl }))).toThrow(
          /DB_PREPARE must be false/,
        );
      });

      it('detects the pooler by port even on a custom hostname', () => {
        expect(() =>
          validateEnv(
            productionEnv({ DATABASE_URL: 'postgresql://u:p@db.internal:6543/postgres' }),
          ),
        ).toThrow(/DB_PREPARE must be false/);
      });

      it('accepts the pooler once DB_PREPARE is false', () => {
        expect(() =>
          validateEnv(productionEnv({ DATABASE_URL: poolerUrl, DB_PREPARE: 'false' })),
        ).not.toThrow();
      });

      it('leaves direct connections free to use prepared statements', () => {
        expect(() =>
          validateEnv(
            productionEnv({
              DATABASE_URL: 'postgresql://u:p@db.abc.supabase.co:5432/postgres',
              DB_PREPARE: 'true',
            }),
          ),
        ).not.toThrow();
      });
    });
  });
});
