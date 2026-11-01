import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { configureApp } from './setup.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.register({ config }));
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}

void bootstrap();
