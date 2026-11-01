import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { ProblemFilter } from './infra/problem.filter.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}

void bootstrap();
