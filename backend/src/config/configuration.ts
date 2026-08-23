/**
 * Typed configuration loaded from environment variables.
 * Nothing outside this file should read `process.env` directly.
 */

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  logLevel: string;
}

export interface DatabaseConfig {
  url: string;
  ssl: boolean;
  /**
   * Supabase's pooler runs in transaction mode, which cannot hold prepared
   * statements between statements. Leaving this on against the pooler produces
   * "prepared statement already exists" errors, so production must set
   * DB_PREPARE=false. See docs/ARCHITECTURE.md section 3.
   */
  prepare: boolean;
  poolSize: number;
  synchronize: boolean;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export interface FetchConfig {
  userAgent: string;
  timeoutMs: number;
  ratePerSecond: number;
  maxRetries: number;
}

export interface SyncConfig {
  secret: string;
  relayEnabled: boolean;
  relayUrl: string;
  relayHmacSecret: string;
}

export interface Configuration {
  app: AppConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  fetch: FetchConfig;
  sync: SyncConfig;
}

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value.toLowerCase() === 'true';

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export default (): Configuration => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  return {
    app: {
      nodeEnv,
      isProduction: nodeEnv === 'production',
      port: int(process.env.PORT, 3000),
      apiPrefix: process.env.API_PREFIX ?? 'api/v1',
      logLevel: process.env.LOG_LEVEL ?? 'info',
    },
    database: {
      url: process.env.DATABASE_URL ?? '',
      ssl: bool(process.env.DB_SSL, false),
      prepare: bool(process.env.DB_PREPARE, true),
      poolSize: int(process.env.DB_POOL_SIZE, 10),
      synchronize: bool(process.env.DB_SYNCHRONIZE, false),
    },
    auth: {
      jwtSecret: process.env.JWT_SECRET ?? '',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '90d',
    },
    fetch: {
      userAgent: process.env.FETCH_USER_AGENT ?? 'ExhibitionReminderBot/1.0',
      timeoutMs: int(process.env.FETCH_TIMEOUT_MS, 60_000),
      ratePerSecond: int(process.env.FETCH_RATE_LIMIT_PER_SEC, 1),
      maxRetries: int(process.env.FETCH_MAX_RETRIES, 3),
    },
    sync: {
      secret: process.env.SYNC_SECRET ?? '',
      relayEnabled: bool(process.env.RELAY_ENABLED, false),
      relayUrl: process.env.RELAY_URL ?? '',
      relayHmacSecret: process.env.RELAY_HMAC_SECRET ?? '',
    },
  };
};
