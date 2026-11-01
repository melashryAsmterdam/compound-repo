import type { AppContext } from '../infra/context';
import type { Tx } from '../infra/db';

export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function signedObjectUrl(ctx: AppContext, tx: Tx, uploadId: string | null): Promise<string | null> {
  if (!uploadId) return null;
  const u = await tx.one<{ object_key: string; status: string }>(`SELECT object_key, status FROM upload WHERE id = $1`, [uploadId]);
  if (!u || u.status !== 'ready') return null;
  return ctx.storage.signedUrl('GET', u.object_key, 600, ctx.now()).url;
}

export async function compoundDto(ctx: AppContext, tx: Tx, compoundId: string) {
  const c = await tx.one<any>(`SELECT * FROM compound WHERE id = $1`, [compoundId]);
  return {
    id: c.id,
    nameAr: c.name_ar,
    nameEn: c.name_en,
    logoUrl: await signedObjectUrl(ctx, tx, c.logo_upload_id),
    contactPhone: c.contact_phone,
    timezone: c.timezone,
  };
}
