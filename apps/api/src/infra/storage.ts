import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeEqual } from './crypto';

/**
 * Object storage with signed, expiring URLs (ADR-013). This is the local
 * adapter (stand-in for GCS V4 signed URLs); the API serves /_storage.
 */
export class LocalStorage {
  constructor(
    private readonly dir: string,
    private readonly secret: string,
    private readonly baseUrl: string,
  ) {}

  private sig(method: string, key: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${method}\n${key}\n${exp}`).digest('base64url');
  }

  signedUrl(method: 'PUT' | 'GET', key: string, ttlSeconds: number, now = new Date()): { url: string; expiresAt: Date } {
    const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
    const url = `${this.baseUrl}/_storage/${encodeURIComponent(key)}?m=${method}&exp=${exp}&sig=${this.sig(method, key, exp)}`;
    return { url, expiresAt: new Date(exp * 1000) };
  }

  verify(method: string, key: string, exp: string, sig: string, now = new Date()): boolean {
    const e = Number(exp);
    if (!Number.isFinite(e) || e * 1000 < now.getTime()) return false;
    return safeEqual(Buffer.from(this.sig(method, key, e)), Buffer.from(String(sig)));
  }

  private path(key: string) {
    if (key.includes('..')) throw new Error('bad key');
    return join(this.dir, key);
  }
  put(key: string, data: Buffer) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
  get(key: string): Buffer | null {
    const p = this.path(key);
    return existsSync(p) ? readFileSync(p) : null;
  }
  delete(key: string) {
    const p = this.path(key);
    if (existsSync(p)) unlinkSync(p);
  }
}
