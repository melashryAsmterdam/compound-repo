import type { NextConfig } from 'next';
import { apiUrl } from './lib/api-url';

const API_URL = apiUrl();

const config: NextConfig = {
  // Standalone output is for the container image; Vercel builds its own output.
  output: process.env.VERCEL ? undefined : 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@compound/i18n', '@compound/domain', '@compound/api-client'],
  // The browser talks to the API through the portal origin, so the session cookie stays first-party.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/:path*` },
      { source: '/_storage/:path*', destination: `${API_URL}/_storage/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      { source: '/a/:token', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/.well-known/:file', headers: [{ key: 'Content-Type', value: 'application/json' }] },
    ];
  },
};

export default config;
