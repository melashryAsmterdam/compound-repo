import { maskDestination } from '@compound/domain';
import { logger } from './logger';
import { newId } from './crypto';

export interface SentMessage {
  channel: 'sms' | 'email' | 'push';
  to: string;
  subject?: string;
  text: string;
  data?: Record<string, string>;
  providerMessageId: string;
  at: Date;
}

export type PushResult = { ok: true; providerMessageId: string } | { ok: false; error: 'UNREGISTERED' | 'INVALID_ARGUMENT' | 'UNAVAILABLE' };

export interface SmsSender {
  readonly provider: string;
  send(msg: { to: string; text: string; senderId?: string | null }): Promise<{ providerMessageId: string }>;
}
export interface EmailSender {
  readonly provider: string;
  send(msg: { to: string; subject: string; text: string }): Promise<{ providerMessageId: string }>;
}
export interface PushSender {
  readonly provider: string;
  send(msg: { token: string; title: string; body: string; data: Record<string, string> }): Promise<PushResult>;
}

/**
 * Local/test adapters (07-repo §2: "SMS/push adapters = console"). They keep an
 * in-memory outbox so tests and the local demo can read OTPs and links.
 * Unifonic, FCM and the email provider plug in behind the same interfaces.
 */
export class ConsoleChannels {
  readonly outbox: SentMessage[] = [];
  /** Tokens that should behave as unregistered (tests). */
  readonly deadTokens = new Set<string>();

  /** logText: development opt-in (LOG_MESSAGE_TEXT=1). Message text carries OTPs and activation links. */
  constructor(private readonly opts: { logText?: boolean } = {}) {}

  private record(m: Omit<SentMessage, 'providerMessageId' | 'at'>) {
    const providerMessageId = newId();
    this.outbox.push({ ...m, providerMessageId, at: new Date() });
    const to = m.channel === 'push' ? '[device]' : maskDestination(m.to);
    if (this.opts.logText) logger.info({ channel: m.channel, to }, `[${m.channel}] ${m.subject ? m.subject + ' — ' : ''}${m.text}`);
    else logger.info({ channel: m.channel, to, providerMessageId, chars: m.text.length }, `[${m.channel}] message sent (text not logged)`);
    return providerMessageId;
  }

  readonly sms: SmsSender = { provider: 'console-sms', send: async (m) => ({ providerMessageId: this.record({ channel: 'sms', to: m.to, text: m.text }) }) };
  readonly email: EmailSender = {
    provider: 'console-email',
    send: async (m) => ({ providerMessageId: this.record({ channel: 'email', to: m.to, subject: m.subject, text: m.text }) }),
  };
  readonly push: PushSender = {
    provider: 'console-push',
    send: async (m) => {
      if (this.deadTokens.has(m.token)) return { ok: false, error: 'UNREGISTERED' };
      return { ok: true, providerMessageId: this.record({ channel: 'push', to: m.token, subject: m.title, text: m.body, data: m.data }) };
    },
  };

  last(channel: SentMessage['channel'], to?: string): SentMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.channel === channel && (to === undefined || m.to === to));
  }
}
