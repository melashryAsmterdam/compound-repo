import 'reflect-metadata';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { loadConfig, type Config } from './config';
import { ProblemFilter } from './errors';
import { AdminGuard, ResidentGuard } from './http';
import { AppContext } from './infra/context';
import { AdminAuthController } from './modules/admin-auth';
import { AdminAnnouncementsController, AnnouncementsService, AppAnnouncementsController } from './modules/announcements';
import { AdminMiscController, AppCategoriesController, HealthController, StreamsController, UploadsController, WebhooksController } from './modules/misc';
import { AppNotificationsController, NotificationsService } from './modules/notifications';
import { OtpService } from './modules/otp';
import { AdminRequestsController, AdminRequestsService } from './modules/requests-admin';
import { AppRequestsController, ResidentAccess } from './modules/requests-app';
import { RequestsCore } from './modules/requests-core';
import { ResidentAuthController, ResidentSessions } from './modules/resident-auth';
import { UnitsController } from './modules/units';
import { WorkerHandlers } from './worker/handlers';

@Module({})
class ApiModule {
  static with(ctx: AppContext): DynamicModule {
    return {
      module: ApiModule,
      controllers: [
        HealthController,
        AdminAuthController,
        AdminMiscController,
        UnitsController,
        AdminRequestsController,
        AdminAnnouncementsController,
        UploadsController,
        StreamsController,
        WebhooksController,
        ResidentAuthController,
        AppCategoriesController,
        AppRequestsController,
        AppAnnouncementsController,
        AppNotificationsController,
      ],
      providers: [
        { provide: AppContext, useValue: ctx },
        AdminGuard,
        ResidentGuard,
        OtpService,
        NotificationsService,
        RequestsCore,
        AdminRequestsService,
        ResidentAccess,
        ResidentSessions,
        AnnouncementsService,
      ],
    };
  }
}

export interface Built {
  app: INestApplication;
  ctx: AppContext;
  handlers: WorkerHandlers;
}

export async function buildApp(config: Config = loadConfig()): Promise<Built> {
  const ctx = await AppContext.create(config);
  const app = await NestFactory.create(ApiModule.with(ctx), { logger: config.NODE_ENV === 'test' ? false : ['error', 'warn'], bodyParser: false });
  app.use(cookieParser());
  app.use(json({ limit: '100kb', type: ['application/json', 'application/*+json'] }));
  app.useGlobalFilters(new ProblemFilter());
  app.enableCors({ origin: [config.PORTAL_ORIGIN], credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Accept-Language', 'Authorization', 'Idempotency-Key'], exposedHeaders: ['X-CSRF-Token'] });
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', true);
  express.disable('x-powered-by');
  await app.init();
  const handlers = new WorkerHandlers(ctx, app.get(RequestsCore), app.get(AnnouncementsService));
  handlers.register();
  return { app, ctx, handlers };
}
