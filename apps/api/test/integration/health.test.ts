import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('HTTP shell', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('GET /healthz', async () => {
    await t.http().get('/healthz').expect(200, { status: 'ok' });
  });

  it('unknown routes answer problem+json', async () => {
    const res = await t.http().get('/nope').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('not_found');
  });

  it('applies every migration, including the category seed', async () => {
    const { rows } = await t.sql.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.map((r) => r.name)).toEqual([
      '0000_roles.sql',
      '0001_init.sql',
      '0002_rls_and_grants.sql',
      '0003_seed_categories.sql',
    ]);
    const cats = await t.sql.query('SELECT count(*)::int AS n FROM request_category');
    expect(cats.rows[0].n).toBe(8);
  });
});
