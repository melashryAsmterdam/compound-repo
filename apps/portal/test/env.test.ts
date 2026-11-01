import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl } from '../lib/env';

afterEach(() => vi.unstubAllEnvs());

describe('apiUrl', () => {
  it('uses API_URL and drops a trailing slash', () => {
    vi.stubEnv('API_URL', 'https://api.example.sa/');
    expect(apiUrl()).toBe('https://api.example.sa');
  });
  it('rejects a value without a scheme', () => {
    vi.stubEnv('API_URL', 'api.example.sa');
    expect(() => apiUrl()).toThrow(/http/);
  });
  it('falls back to the local API off Vercel, so a fresh checkout builds', () => {
    vi.stubEnv('API_URL', '');
    vi.stubEnv('VERCEL', '');
    expect(apiUrl()).toBe('http://localhost:4000');
  });
  it('fails on Vercel when API_URL is missing', () => {
    vi.stubEnv('API_URL', '');
    vi.stubEnv('VERCEL', '1');
    expect(() => apiUrl()).toThrow(/API_URL is not set/);
  });
});
