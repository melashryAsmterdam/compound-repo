import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Config } from './config.js';
import { ProblemFilter } from './infra/problem.filter.js';

/** Shared by main.ts and the tests so both run the same HTTP pipeline. */
export function configureApp(app: INestApplication, config: Config): void {
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemFilter());
  // The portal calls the API from the browser with the session cookie (ADR-005).
  app.enableCors({ origin: config.PORTAL_ORIGIN, credentials: true });
}
