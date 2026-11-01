import { buildApp } from './app';
import { loadConfig } from './config';
import { logger } from './infra/logger';

async function main() {
  const config = loadConfig();
  const { app, ctx, handlers } = await buildApp(config);
  const runWorker = config.WORKER === '1' || config.INLINE_WORKER === '1';
  if (runWorker) {
    ctx.worker.start(1000);
    setInterval(() => void handlers.tick(), 60_000);
    void handlers.tick();
  }
  if (config.WORKER === '1') {
    logger.info('worker started');
    return;
  }
  await app.listen(config.PORT);
  logger.info({ port: config.PORT, db: ctx.db.driver, inlineWorker: runWorker }, 'api listening');
}

main().catch((e) => {
  logger.error({ err: e }, 'boot failed');
  process.exit(1);
});
