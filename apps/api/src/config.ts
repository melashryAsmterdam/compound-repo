import { z } from 'zod';

/** Config validated at boot (standards: apps/api/src/config.ts). */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WORKER: z.enum(['0', '1']).default('0'),
  /** Also run the worker loop inside the API process (local dev only). */
  INLINE_WORKER: z.enum(['0', '1']).default('1'),
  DB_DRIVER: z.enum(['pg', 'pglite']).default('pglite'),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  PORTAL_ORIGIN: z.string().url().default('http://localhost:3000'),
  ACTIVATION_BASE_URL: z.string().url().default('http://localhost:3000'),
  OTP_PEPPER: z.string().min(16).default('dev-only-otp-pepper-change-me'),
  STORAGE_SECRET: z.string().min(16).default('dev-only-storage-secret-change-me'),
  STORAGE_DIR: z.string().default('.data/objects'),
  /** PKCS8 PEM for ES256. Generated per process when absent (dev/test only). */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_ISSUER: z.string().default('api.compound.local'),
  SMS_PROVIDER: z.enum(['console']).default('console'),
  EMAIL_PROVIDER: z.enum(['console']).default('console'),
  PUSH_PROVIDER: z.enum(['console']).default('console'),
  /** Per-IP limits (05-auth). Raised only in tests where every call comes from 127.0.0.1. */
  OTP_IP_HOURLY_LIMIT: z.coerce.number().int().default(10),
  OTP_DEST_HOURLY_LIMIT: z.coerce.number().int().default(5),
  LOGIN_IP_LIMIT: z.coerce.number().int().default(20),
  /** Fixed OTP for local demo numbers only; never honoured in production. */
  DEV_FIXED_OTP: z.string().regex(/^\d{6}$/).optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.NODE_ENV === 'production') {
    if (cfg.DB_DRIVER !== 'pg' || !cfg.DATABASE_URL) throw new Error('production requires DB_DRIVER=pg and DATABASE_URL');
    if (!cfg.JWT_PRIVATE_KEY) throw new Error('production requires JWT_PRIVATE_KEY (KMS-backed signer is Phase-1 infra work)');
    if (cfg.OTP_PEPPER.startsWith('dev-') || cfg.STORAGE_SECRET.startsWith('dev-')) throw new Error('production secrets not set');
    if (cfg.DEV_FIXED_OTP) throw new Error('DEV_FIXED_OTP is not allowed in production');
    if (cfg.OTP_DEST_HOURLY_LIMIT > 5 || cfg.OTP_IP_HOURLY_LIMIT > 10 || cfg.LOGIN_IP_LIMIT > 20) throw new Error('rate limits cannot be raised in production');
  }
  return cfg;
}

export const CONFIG = Symbol('CONFIG');
