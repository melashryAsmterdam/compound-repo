import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** P-01 → P-02 once per run; the signed-in state is shared by the specs. */
export default async function globalSetup() {
  mkdirSync('e2e/.auth', { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: 'http://localhost:3000', locale: 'ar-SA' });
  await page.goto('/sign-in');
  await page.locator('#email').fill('admin@narjis.example.sa');
  await page.locator('#password').fill('Narjis-Admin-2026');
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/\/verify/);
  await expect(page.getByText(/أرسلنا رمزًا إلى/)).toBeVisible();
  await page.locator('#code').fill('123456');
  await page.waitForURL(/\/requests/);
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
  await browser.close();
}
