/**
 * Fail fast on missing configuration. A misconfigured deploy should refuse to
 * boot rather than start and then fail on the first request.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const isProduction = config.NODE_ENV === 'production';
  const errors: string[] = [];

  const required = (key: string) => {
    const value = config[key];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${key} is required`);
    }
    return value as string | undefined;
  };

  required('DATABASE_URL');

  if (isProduction) {
    const placeholder = /^replace-me/i;

    for (const key of ['JWT_SECRET', 'SYNC_SECRET']) {
      const value = required(key);
      if (value && placeholder.test(value)) {
        errors.push(`${key} still holds the placeholder value from .env.example`);
      }
      if (value && value.length < 32) {
        errors.push(`${key} must be at least 32 characters in production`);
      }
    }

    // Supabase's transaction pooler cannot keep prepared statements alive.
    // Catching this at boot is far cheaper than debugging it at runtime.
    const url = String(config.DATABASE_URL ?? '');
    const usesPooler = url.includes('pooler.supabase.com') || url.includes(':6543');
    if (usesPooler && String(config.DB_PREPARE ?? 'true').toLowerCase() !== 'false') {
      errors.push(
        'DB_PREPARE must be false when connecting through the Supabase pooler ' +
          '(port 6543), otherwise queries fail with "prepared statement already exists"',
      );
    }

    if (String(config.DB_SYNCHRONIZE ?? 'false').toLowerCase() === 'true') {
      errors.push('DB_SYNCHRONIZE must never be true in production — use migrations');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return config;
}
