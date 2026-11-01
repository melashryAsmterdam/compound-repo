import { hash, verify } from '@node-rs/argon2';

// Argon2id, m=64 MiB, t=3, p=1 (05-auth-and-roles §2). algorithm 2 = Argon2id.
const OPTIONS = { algorithm: 2, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;
export const PASSWORD_MIN = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password).catch(() => false);
}

// Verified against when the email is unknown, so response time does not reveal which emails exist.
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password-placeholder');
  await verifyPassword(await dummy, password);
}
