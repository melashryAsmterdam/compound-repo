import { z } from 'zod';

// Validated at boot; the process refuses to start on a bad config (repo standard §2).
const schema = z.object({
  NODE_ENV: z.enum(['local', 'test', 'dev', 'staging', 'prod']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  WORKER: z.enum(['0', '1']).default('0'),
  DATABASE_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  return parsed.data;
}
