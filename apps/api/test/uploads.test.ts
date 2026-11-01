import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeResident, adminSession, createRequest, setup, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(() => env.close());

async function upload(env: TestEnv, auth: { post: (p: string, b?: unknown) => any }, data: Buffer, contentType: string, purpose = 'request_photo') {
  const t = (await auth.post('/app/v1/uploads', { purpose, contentType, bytes: data.length }).expect(201)).body;
  const url = new URL(t.uploadUrl);
  await env.http.put(url.pathname + url.search).set('Content-Type', contentType).send(data).expect(200);
  await env.drain();
  return t.uploadId as string;
}

describe('uploads (ADR-013, R2-AC7)', () => {
  it('re-encodes photos, strips EXIF/GPS, attaches them to the request, and serves signed URLs', async () => {
    const admin = await adminSession(env);
    const { unitId, resident } = await activeResident(env, admin);
    const jpeg = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#3366ff' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'TestCam' }, GPS: { GPSLatitudeRef: 'N', GPSLatitude: '24/1 42/1 0/1' } } as any)
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const id = await upload(env, resident, jpeg, 'image/jpeg');
    const r = await createRequest(resident, unitId, { photoUploadIds: [id] });
    const d = (await admin.get(`/admin/v1/requests/${r.id}`).expect(200)).body;
    expect(d.photoCount).toBe(1);
    expect(d.photos[0]).toMatchObject({ id, width: 2048, height: 683 });
    const url = new URL(d.photos[0].url);
    const img = await env.http.get(url.pathname + url.search).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const meta = await sharp(img.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
    await env.http.get(url.pathname + url.search.replace(/sig=[^&]+/, 'sig=forged')).expect(403);
  });

  it('rejects files whose bytes do not match the declared type', async () => {
    const admin = await adminSession(env);
    const { unitId, resident } = await activeResident(env, admin);
    const id = await upload(env, resident, Buffer.from('<?php echo 1; ?>'), 'image/png');
    const row = await env.ctx.db.owner((tx) => tx.one<any>(`SELECT status FROM upload WHERE id = $1`, [id]));
    expect(row.status).toBe('rejected');
    await resident
      .post(`/app/v1/units/${unitId}/requests`, { categoryCode: 'other', description: 'With a bad attachment', photoUploadIds: [id] })
      .set('Idempotency-Key', crypto.randomUUID())
      .expect(422);
    const pdf = await resident.post('/app/v1/uploads', { purpose: 'request_photo', contentType: 'application/pdf', bytes: 10 }).expect(422);
    expect(pdf.body.code).toBe('upload_invalid');
  });
});
