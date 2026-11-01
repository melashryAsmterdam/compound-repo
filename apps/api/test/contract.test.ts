import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { setup, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(() => env.close());

/** No undocumented routes, no unimplemented operations (07-repo §3 contract checks). */
describe('API contract coverage', () => {
  it('implements exactly the operations in packages/api-contract/openapi.yaml', () => {
    const spec = parse(readFileSync(join(__dirname, '../../../packages/api-contract/openapi.yaml'), 'utf8'));
    const contract = new Set<string>();
    for (const [path, ops] of Object.entries<any>(spec.paths))
      for (const m of Object.keys(ops)) if (['get', 'post', 'put', 'patch', 'delete'].includes(m)) contract.add(`${m.toUpperCase()} ${path.replace(/\{[^}]+\}/g, ':p')}`);

    const router = (env.app.getHttpAdapter().getInstance() as any).router;
    const implemented = new Set<string>();
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) implemented.add(`${m.toUpperCase()} ${String(layer.route.path).replace(/:[A-Za-z]+/g, ':p')}`);
    }
    const internal = new Set(['PUT /_storage/:p', 'GET /_storage/:p']);
    const missing = [...contract].filter((op) => !implemented.has(op));
    const extra = [...implemented].filter((op) => !contract.has(op) && !internal.has(op));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect(contract.size).toBeGreaterThan(60);
  });
});
