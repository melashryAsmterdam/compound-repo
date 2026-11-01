import { defineConfig } from '@playwright/test';

/**
 * Portal smoke (07-repo §3: "Playwright ar/en RTL smoke"). Needs the API with
 * DEV_FIXED_OTP=123456 and the seeded demo compound; `webServer` starts both
 * locally unless they are already running.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  workers: 1,
  use: { storageState: 'e2e/.auth/admin.json', baseURL: 'http://localhost:3000', trace: 'retain-on-failure', locale: 'ar-SA', timezoneId: 'Asia/Riyadh' },
  webServer: [
    {
      command: 'cd ../api && pnpm build && node dist/seed.js && node dist/main.js',
      url: 'http://localhost:4000/healthz',
      reuseExistingServer: true,
      // Local test server only: fixed OTP and raised rate limits (both refused when NODE_ENV=production).
      env: { PGLITE_DIR: '.data/e2e', DEV_FIXED_OTP: '123456', OTP_DEST_HOURLY_LIMIT: '1000', OTP_IP_HOURLY_LIMIT: '1000', LOGIN_IP_LIMIT: '1000', PORTAL_ORIGIN: 'http://localhost:3000', PUBLIC_API_URL: 'http://localhost:3000/api', ACTIVATION_BASE_URL: 'http://localhost:3000' },
    },
    { command: 'pnpm build && pnpm start', url: 'http://localhost:3000/sign-in', reuseExistingServer: true, env: { API_URL: 'http://localhost:4000' } },
  ],
});
