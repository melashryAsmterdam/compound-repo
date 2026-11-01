import { generateKeyPair, importPKCS8, importSPKI, type KeyLike } from 'jose';
type CryptoKey = KeyLike;
import type { Config } from '../config';
import { ConsoleChannels, type EmailSender, type PushSender, type SmsSender } from './channels';
import { Clock } from './clock';
import { Db } from './db';
import { Worker } from './jobs';
import { RealtimeHub } from './realtime';
import { LocalStorage } from './storage';

/** Process-wide services, built once at boot and injected everywhere as AppContext. */
export class AppContext {
  constructor(
    readonly config: Config,
    readonly db: Db,
    readonly clock: Clock,
    readonly channels: ConsoleChannels,
    readonly sms: SmsSender,
    readonly email: EmailSender,
    readonly push: PushSender,
    readonly storage: LocalStorage,
    readonly hub: RealtimeHub,
    readonly worker: Worker,
    readonly jwt: { privateKey: CryptoKey; publicKey: CryptoKey; kid: string },
  ) {}

  now() {
    return this.clock.now();
  }

  static async create(config: Config): Promise<AppContext> {
    const db = config.DB_DRIVER === 'pg' ? await Db.pg(config.DATABASE_URL!) : await Db.pglite(config.PGLITE_DIR);
    // B5: local PGlite migrates itself; on Postgres the migrate job runs once per deploy and the
    // API only checks the schema is current (its login role needs no DDL rights).
    if (config.DB_DRIVER === 'pglite') await db.migrate();
    else await db.assertMigrated();
    const clock = new Clock();
    const channels = new ConsoleChannels({ logText: config.LOG_MESSAGE_TEXT === '1' });
    const storage = new LocalStorage(config.STORAGE_DIR, config.STORAGE_SECRET, config.PUBLIC_API_URL);
    const hub = new RealtimeHub();
    await hub.start(db);
    const worker = new Worker(db, clock);
    let privateKey: CryptoKey;
    let publicKey: CryptoKey;
    if (config.JWT_PRIVATE_KEY) {
      privateKey = await importPKCS8(config.JWT_PRIVATE_KEY, 'ES256', { extractable: true });
      const { createPublicKey } = await import('node:crypto');
      const spki = createPublicKey(config.JWT_PRIVATE_KEY).export({ type: 'spki', format: 'pem' }).toString();
      publicKey = await importSPKI(spki, 'ES256');
    } else {
      ({ privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true }));
    }
    return new AppContext(config, db, clock, channels, channels.sms, channels.email, channels.push, storage, hub, worker, {
      privateKey,
      publicKey,
      kid: 'local-1',
    });
  }
}
