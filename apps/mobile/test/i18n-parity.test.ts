import { ar } from '@/lib/i18n/ar';
import { en } from '@/lib/i18n/en';

type Tree = { [k: string]: string | Tree };
const leaves = (t: Tree, prefix = ''): Record<string, string> =>
  Object.entries(t).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...leaves(v, key) };
  }, {});

const A = leaves(ar as unknown as Tree);
const E = leaves(en as unknown as Tree);
const vars = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((v) => v.replace(/\s/g, '')).sort();

describe('i18n parity ar/en (CI rule: no literal UI strings, parity checked)', () => {
  it('has the same keys', () => {
    expect(Object.keys(A).sort()).toEqual(Object.keys(E).sort());
  });
  it('has no empty values', () => {
    for (const [k, v] of Object.entries({ ...A, ...E })) expect([k, v.trim().length > 0]).toEqual([k, true]);
  });
  it('uses the same interpolation variables', () => {
    for (const k of Object.keys(E)) expect([k, vars(A[k]!)]).toEqual([k, vars(E[k]!)]);
  });
  it('Arabic values are Arabic (except brand/language names)', () => {
    const allowLatin = new Set(['common.english', 'common.charCount', 'photos.counter', 'newRequest.none']);
    for (const [k, v] of Object.entries(A)) {
      if (allowLatin.has(k)) continue;
      expect([k, /[؀-ۿ]/.test(v)]).toEqual([k, true]);
    }
  });
  it('covers every Problem.code a resident can hit', () => {
    const codes = ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'rate_limited', 'otp_invalid', 'otp_expired',
      'otp_attempts_exceeded', 'invitation_expired', 'invitation_used', 'invitation_revoked', 'invalid_transition', 'version_conflict',
      'request_closed', 'unit_access_revoked', 'session_revoked', 'consent_version_outdated'];
    for (const c of codes) expect(E[`errors.${c}`]).toBeDefined();
  });
});
