import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { CONFIG, loadConfig, type Config } from './config.js';
import { AuditService } from './infra/audit.service.js';
import { Clock, SystemClock } from './infra/clock.js';
import { createPool, Db, DB_POOL } from './infra/db/db.service.js';
import { ConsoleMessenger, Messenger } from './infra/messaging/messenger.js';
import { OtpService } from './infra/otp.service.js';
import { RateLimitService } from './infra/rate-limit.service.js';
import { AdminSessionGuard } from './modules/auth/admin-session.guard.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { UnitsController } from './modules/units/units.controller.js';
import { UnitsService } from './modules/units/units.service.js';

export interface AppOverrides {
  config?: Config;
  clock?: Clock;
  messenger?: Messenger;
}

@Module({})
export class AppModule {
  static register(overrides: AppOverrides = {}): DynamicModule {
    const config = overrides.config ?? loadConfig();
    if (!overrides.messenger && ['staging', 'prod'].includes(config.NODE_ENV)) {
      // ConsoleMessenger prints one-time codes; it must never run where real people sign in.
      throw new Error('No SMS/email adapter configured for this environment');
    }
    const providers: Provider[] = [
      { provide: CONFIG, useValue: config },
      { provide: DB_POOL, useFactory: () => createPool(config) },
      { provide: Clock, useValue: overrides.clock ?? new SystemClock() },
      // Real SMS/email adapters replace ConsoleMessenger when the providers are contracted (OD-2, OD-3).
      { provide: Messenger, useValue: overrides.messenger ?? new ConsoleMessenger() },
      Db,
      AuditService,
      RateLimitService,
      OtpService,
      AdminSessionGuard,
      AuthService,
      UnitsService,
    ];
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, UnitsController],
      providers,
    };
  }
}
