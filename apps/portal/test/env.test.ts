import { describe, expect, it } from 'vitest';
import { apiUrl } from '../lib/env';

describe('apiUrl', () => {
  it('defaults to the local API outside Vercel', () => expect(apiUrl({})).toBe('http://localhost:4000'));
  it('uses API_URL and drops a trailing slash', () =>
    expect(apiUrl({ API_URL: 'https://api.example.sa/' })).toBe('https://api.example.sa'));
  it('refuses to build on Vercel without API_URL', () => expect(() => apiUrl({ VERCEL: '1' })).toThrow(/API_URL is not set/));
  it('refuses an invalid URL', () => expect(() => apiUrl({ API_URL: 'api.example.sa' })).toThrow(/not a valid URL/));
  it('requires https in Vercel production', () => {
    expect(() => apiUrl({ VERCEL: '1', VERCEL_ENV: 'production', API_URL: 'http://api.example.sa' })).toThrow(/https/);
    expect(apiUrl({ VERCEL: '1', VERCEL_ENV: 'preview', API_URL: 'http://staging.example.sa' })).toBe('http://staging.example.sa');
  });
});
