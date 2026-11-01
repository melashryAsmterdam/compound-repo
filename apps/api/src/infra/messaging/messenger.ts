import { Injectable, Logger } from '@nestjs/common';

export type MessageTemplate =
  | { kind: 'admin_otp'; code: string }
  | { kind: 'password_reset'; link: string };

export interface OutboundMessage {
  channel: 'sms' | 'email';
  destination: string;
  locale: 'ar' | 'en';
  template: MessageTemplate;
}

/**
 * Port for SMS and email (ADR-008). Production adapters (Unifonic, email provider) plug in here;
 * request-related notifications will go through the outbox instead of calling this directly.
 */
export abstract class Messenger {
  abstract send(message: OutboundMessage): Promise<void>;
}

/** Local development only: prints messages so a developer can read the code. */
@Injectable()
export class ConsoleMessenger extends Messenger {
  private readonly logger = new Logger('ConsoleMessenger');

  async send(message: OutboundMessage): Promise<void> {
    this.logger.log(`[${message.channel} → ${message.destination}] ${JSON.stringify(message.template)}`);
  }
}
