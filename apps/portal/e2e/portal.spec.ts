import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const API = 'http://localhost:4000';
const run = Date.now().toString().slice(-6);

/** The session from global-setup is reused (one OTP per run, like a real admin). */
async function signIn(page: Page) {
  await page.goto('/requests');
  await expect(page.locator('main')).toBeVisible();
}

/** Resident side through the shared API (what the mobile app does): activate by phone, create a request. */
async function residentCreatesRequest(request: APIRequestContext, phone: string, unitId: string) {
  const start = await request.post(`${API}/app/v1/activation/start`, { data: { phone } });
  expect(start.ok()).toBeTruthy();
  const { challengeId } = await start.json();
  const done = await request.post(`${API}/app/v1/activation/complete`, {
    data: { challengeId, code: '123456', consent: { privacyNoticeVersion: '2026-11-01', termsVersion: '2026-11-01', locale: 'ar' }, device: { installationId: randomUUID(), platform: 'ios' } },
  });
  expect(done.ok()).toBeTruthy();
  const { accessToken } = await done.json();
  const r = await request.post(`${API}/app/v1/units/${unitId}/requests`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Idempotency-Key': randomUUID() },
    data: { categoryCode: 'plumbing', description: 'تسريب مياه تحت مغسلة المطبخ', locationInUnit: 'المطبخ' },
  });
  expect(r.status()).toBe(201);
  return (await r.json()) as { ref: string };
}

test('Arabic is the default and the layout mirrors (K-1, K-2)', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'الطلبات' })).toBeVisible();
  const nav = await page.getByRole('navigation').boundingBox();
  const main = await page.locator('main').boundingBox();
  expect(nav!.x).toBeGreaterThan(main!.x); // side navigation sits on the right in Arabic
  for (const path of ['/requests?status=new,in_progress,done,closed,cancelled', '/units', '/announcements/new', '/settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} overflows`).toBe(true);
  }
});

test('admin manages a unit, the resident reports, the admin works the request', async ({ page, request }) => {
  const number = `E2E-${run}`;
  const phone = `+9665${run}${String(Math.floor(Math.random() * 90) + 10)}`;
  await signIn(page);

  // P-09 / P-10: add a unit
  await page.goto('/units');
  await page.getByRole('button', { name: 'إضافة وحدة' }).first().click();
  await page.locator('#u-number').fill(number);
  await page.locator('#u-block').fill('E');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByText(`تمت إضافة الوحدة`)).toBeVisible();

  // P-11 / P-12: assign owner and send the invite by SMS
  await page.goto(`/units?q=${number}`);
  await page.getByRole('link', { name: number }).click();
  await page.getByRole('button', { name: 'تعيين مالك' }).click();
  await page.locator('#o-name').fill('نورة الحربي');
  await page.locator('#o-phone').fill(phone.replace('+966', '0'));
  await page.getByRole('button', { name: 'حفظ وإرسال الدعوة' }).click();
  await expect(page.getByText('تمت الدعوة').first()).toBeVisible();
  const unitId = page.url().split('/').pop()!;

  // R1/R2 through the API, then A3: the request shows on the dashboard
  const { ref } = await residentCreatesRequest(request, phone, unitId);
  await page.goto(`/requests?q=${ref}`);
  const row = page.getByRole('row').filter({ hasText: ref });
  await expect(row).toBeVisible();
  await expect(row.getByText('جديد')).toBeVisible();

  // P-07 / P-08: start work, schedule a visit, mark done
  await row.getByRole('link', { name: ref }).click();
  await expect(page.getByText('تسريب مياه تحت مغسلة المطبخ')).toBeVisible();
  await page.getByRole('button', { name: 'بدء العمل' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('تم تحديث الحالة وإشعار الساكن.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'بدء العمل' })).toBeHidden();

  await page.getByPlaceholder('اكتب تعليقًا للساكن').fill('سيزوركم الفني غدًا');
  await page.getByLabel('إضافة موعد زيارة').check();
  await page.locator('#vfrom').selectOption('09:00');
  await page.locator('#vto').selectOption('11:00');
  await page.getByRole('button', { name: 'نشر' }).click();
  await expect(page.getByText('موعد الزيارة').first()).toBeVisible();
  await expect(page.getByText(/التعديل أو الحذف خلال/)).toBeVisible();

  await expect(page.getByText('سيزوركم الفني غدًا')).toBeVisible();

  await page.getByRole('button', { name: 'تحديد كمنجز' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(/بانتظار تأكيد الساكن/).first()).toBeVisible();
  await expect(page.getByText(/يُغلق تلقائيًا في/)).toBeVisible();
  await expect(page.getByPlaceholder('اكتب تعليقًا للساكن')).toBeVisible(); // Done still allows comments
});

test('announcement composer shows the audience counter and sends (A5)', async ({ page }) => {
  await signIn(page);
  await page.goto('/announcements/new');
  await page.locator('#tAr').fill(`انقطاع المياه ${run}`);
  await page.locator('#bAr').fill('ستنقطع المياه غدًا من 9 إلى 12');
  await page.locator('#tEn').fill(`Water cut-off ${run}`);
  await page.locator('#bEn').fill('Water will be off tomorrow 9–12');
  await expect(page.getByText(/سيصل إلى \S+ من السكان/)).toBeVisible();
  await page.getByRole('button', { name: /^إرسال الآن ·/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'إرسال الآن' }).click();
  await page.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  await expect(page.getByText('أُرسل')).toBeVisible({ timeout: 15_000 });
});

test('English switches to LTR (K-1)', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'English' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible();
  const nav = await page.getByRole('navigation').boundingBox();
  const main = await page.locator('main').boundingBox();
  expect(nav!.x).toBeLessThan(main!.x);
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

test('invalid invite link shows W-02 with the compound phone', async ({ page }) => {
  await page.goto(`/a/${'x'.repeat(43)}`);
  await expect(page.getByText('اطلب من إدارة المجمع إعادة إرسال الدعوة')).toBeVisible();
});

test('unauthenticated users go to sign in', async ({ page }) => {
  await page.goto('/units');
  await page.waitForURL(/session-expired/);
  await expect(page.getByRole('heading', { name: 'تم تسجيل خروجك حفاظًا على أمانك.' })).toBeVisible();
});
});
