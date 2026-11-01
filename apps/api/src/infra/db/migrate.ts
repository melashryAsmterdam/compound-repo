import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

/**
 * Applies migrations/NNNN_*.sql in order, each in its own transaction, recording them in
 * schema_migrations. Runs as the migration owner, never as app_api.
 */
export async function migrate(connectionString: string, log: (m: string) => void = () => {}): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    return applied;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
  migrate(url, console.log)
    .then((applied) => console.log(applied.length ? 'migrations complete' : 'nothing to apply'))
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(1);
    });
}
