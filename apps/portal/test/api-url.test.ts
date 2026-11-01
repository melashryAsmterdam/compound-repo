import { describe, expect, it } from 'vitest';
import { apiUrl, LOCAL_API_URL } from '../lib/api-url';

describe('apiUrl', () => {
  it('reads API_URL and drops trailing slashes', () => {
    expect(apiUrl({ API_URL: 'https://api.example.sa/' })).toBe('https://api.example.sa');
    expect(apiUrl({ API_URL: '  https://api.example.sa/v  ' })).toBe('https://api.example.sa/v');
  });
  it('falls back to localhost for local development', () => {
    expect(apiUrl({})).toBe(LOCAL_API_URL);
    expect(apiUrl({ API_URL: '' })).toBe(LOCAL_API_URL);
  });
  it('refuses a Vercel build without API_URL', () => {
    expect(() => apiUrl({ VERCEL: '1' })).toThrow(/API_URL is not set/);
  });
  it('refuses a value that is not an http(s) URL', () => {
    expect(() => apiUrl({ API_URL: 'api.example.sa' })).toThrow(/not a valid URL/);
    expect(() => apiUrl({ API_URL: 'ftp://api.example.sa' })).toThrow(/must be http/);
  });
});
