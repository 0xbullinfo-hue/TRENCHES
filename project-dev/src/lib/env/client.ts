import { z } from 'zod';
import { DEFAULT_GENESIS_MINT } from '@/lib/config';

const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().url().optional()
);

const optionalNonEmpty = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional()
);

const optionalBooleanFlag = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.enum(['true', 'false']).optional()
);

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SOLANA_RPC: optionalUrl,
  NEXT_PUBLIC_GENESIS_MINT: optionalNonEmpty.default(DEFAULT_GENESIS_MINT),
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  NEXT_PUBLIC_TELEGRAM_ALERTS: optionalBooleanFlag,
  NEXT_PUBLIC_MAINTENANCE_MODE: optionalBooleanFlag,
  NEXT_PUBLIC_BUY_LOCK: optionalBooleanFlag,
  NEXT_PUBLIC_WALLET_LOCK: optionalBooleanFlag,
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Pure parser for client-exposed `NEXT_PUBLIC_*` environment variables.
 */
export function parseClientEnv(raw: Record<string, string | undefined>): ClientEnv {
  const result = clientEnvSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid client environment configuration: ${formatted}`);
  }
  return result.data;
}

let cachedClientEnv: ClientEnv | null = null;

/**
 * Reads explicit `process.env.NEXT_PUBLIC_*` literals so Next.js can inline them safely.
 */
export function getClientEnv(): ClientEnv {
  if (!cachedClientEnv) {
    cachedClientEnv = parseClientEnv({
      NEXT_PUBLIC_SOLANA_RPC: process.env.NEXT_PUBLIC_SOLANA_RPC,
      NEXT_PUBLIC_GENESIS_MINT: process.env.NEXT_PUBLIC_GENESIS_MINT,
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
      NEXT_PUBLIC_TELEGRAM_ALERTS: process.env.NEXT_PUBLIC_TELEGRAM_ALERTS,
      NEXT_PUBLIC_MAINTENANCE_MODE: process.env.NEXT_PUBLIC_MAINTENANCE_MODE,
      NEXT_PUBLIC_BUY_LOCK: process.env.NEXT_PUBLIC_BUY_LOCK,
      NEXT_PUBLIC_WALLET_LOCK: process.env.NEXT_PUBLIC_WALLET_LOCK,
    });
  }
  return cachedClientEnv;
}

export function resetClientEnvCache(): void {
  cachedClientEnv = null;
}
