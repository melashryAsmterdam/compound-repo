import { z } from 'zod';

// Validated at boot; the process refuses to start on a bad config (repo standard §2).
const schema = z.object({
  NODE_ENV: z.enum(['local', 'test', 'dev', 'staging', 'prod']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  WORKER: z.enum(['0', '1']).default('0'),
  DATABASE_URL: z.string().min(1).default('postgres://postgres@127.0.0.1:5432/postgres'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Role every request transaction switches to. In GCP the API connects as app_api already;
  // locally and in tests it connects as a superuser, so the switch is what makes RLS apply.
  DB_SET_ROLE: z
    .string()
    .regex(/^[a-z_]+$/)
    .optional(),
  OTP_PEPPER: z.string().min(32),
  PORTAL_ORIGIN: z.string().url().default('http://localhost:3001'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;
export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  return parsed.data;
}

/** `__Host-` requires Secure, so plain-http local development uses an unprefixed name. */
export function adminCookieName(config: Config): string {
  return config.COOKIE_SECURE ? '__Host-cs_admin' : 'cs_admin';
}
