import { loadConfig } from './config';
import { Db } from './infra/db';
import { logger } from './infra/logger';

/** One-off migration job (B5): run once per deploy, before the new API revision takes traffic. */
async function main() {
  const config = loadConfig();
  const db = config.DB_DRIVER === 'pg' ? await Db.pg(config.DATABASE_URL!) : await Db.pglite(config.PGLITE_DIR);
  await db.migrate();
  logger.info({ pending: await db.pendingMigrations() }, 'migrations complete');
  await db.close();
}

main().catch((e) => {
  logger.error({ err: e }, 'migrate failed');
  process.exit(1);
});
