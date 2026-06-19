/**
 * Environment validation run at bootstrap by ConfigModule.forRoot({ validate }).
 *
 * The app must fail fast (refuse to start) when the JWT secrets are missing or
 * weak — never silently fall back to a hard-coded/known secret, which would let
 * anyone forge valid tokens (including admin) if the env is misconfigured.
 */

const MIN_SECRET_LENGTH = 16;

/** Placeholder values that must never be accepted as real secrets. */
const FORBIDDEN_SECRETS = new Set<string>([
  'dev-secret',
  'dev-refresh-secret',
  'change-me-access-secret',
  'change-me-refresh-secret',
]);

function requireSecret(env: Record<string, unknown>, key: string): string {
  const raw = env[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`Config error: ${key} is required and must be a non-empty string`);
  }
  const value = raw.trim();
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `Config error: ${key} must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  if (FORBIDDEN_SECRETS.has(value)) {
    throw new Error(
      `Config error: ${key} is set to a known placeholder value; set a strong unique secret`,
    );
  }
  return value;
}

/**
 * Validate (and pass through) process env. Throwing here aborts startup.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const jwtSecret = requireSecret(config, 'JWT_SECRET');
  const jwtRefreshSecret = requireSecret(config, 'JWT_REFRESH_SECRET');

  if (jwtSecret === jwtRefreshSecret) {
    throw new Error(
      'Config error: JWT_SECRET and JWT_REFRESH_SECRET must be distinct',
    );
  }

  return config;
}
