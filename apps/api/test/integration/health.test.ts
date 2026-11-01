import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { ProblemFilter } from '../../src/infra/problem.filter.js';

describe('HTTP shell', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new ProblemFilter());
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /healthz', async () => {
    await request(app.getHttpServer()).get('/healthz').expect(200, { status: 'ok' });
  });

  it('unknown routes answer problem+json', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('not_found');
  });
});
