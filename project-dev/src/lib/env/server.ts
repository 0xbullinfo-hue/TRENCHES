import { z } from 'zod';

const optionalNonEmpty = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional()
);

const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().url().optional()
);

const optionalSecret = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(16, 'SESSION_SECRET must be at least 16 characters when configured').optional()
);

const optionalBooleanFlag = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.enum(['true', 'false']).optional()
);

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SESSION_SECRET: optionalSecret,
  ALLOW_FILE_PERSISTENCE: optionalBooleanFlag,
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalNonEmpty,
  SOLANA_RPC: optionalUrl,
  SITE_URL: optionalUrl,
  ADMIN_WALLET: optionalNonEmpty,
  CRON_SECRET: optionalNonEmpty,
  DEXSCREENER_ENABLED: optionalBooleanFlag,
  CSP_ENFORCE: optionalBooleanFlag,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

/**
 * Pure parser usable in unit tests or custom env sources without mutating `process.env`.
 */
export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server environment configuration: ${formatted}`);
  }

  const data = result.data;
  if ((data.UPSTASH_REDIS_REST_URL && !data.UPSTASH_REDIS_REST_TOKEN) ||
      (!data.UPSTASH_REDIS_REST_URL && data.UPSTASH_REDIS_REST_TOKEN)) {
    throw new Error(
      'Invalid server environment configuration: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must either both be set or both be omitted'
    );
  }

  return data;
}

/**
 * Lazily validates and caches server environment variables on first runtime access.
 * Throws if accidentally called inside a browser context.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() cannot be called in a browser environment');
  }
  if (!cachedServerEnv) {
    cachedServerEnv = parseServerEnv(process.env);
  }
  return cachedServerEnv;
}

export function resetServerEnvCache(): void {
  cachedServerEnv = null;
}
