/**
 * Local demo data (stand-in for infra/ops-cli "create compound/admin", Q-4).
 * Usage: DEV_FIXED_OTP=123456 pnpm --filter @compound/api seed
 */
import { loadConfig } from './config';
import { AppContext } from './infra/context';
import { newId } from './infra/crypto';
import { hashPassword } from './modules/admin-auth';

export async function seed(ctx: AppContext, opts: { email?: string; password?: string } = {}) {
  const compoundId = newId();
  const adminId = newId();
  const email = opts.email ?? 'admin@narjis.example.sa';
  const password = opts.password ?? 'Narjis-Admin-2026';
  const exists = await ctx.db.owner((tx) => tx.one<any>(`SELECT compound_id FROM admin_user WHERE email = $1`, [email]));
  if (exists) return { compoundId: exists.compound_id as string, email, password, created: false };
  const pw = await hashPassword(password);
  await ctx.db.owner(async (tx) => {
    await tx.query(`INSERT INTO compound (id, name_ar, name_en, contact_phone) VALUES ($1, 'مجمع النرجس', 'Al Narjis Compound', '+966112345678')`, [compoundId]);
    await tx.query(`INSERT INTO admin_user (id, compound_id, email, full_name, password_hash, mfa_channel, locale) VALUES ($1,$2,$3,'أبو فهد',$4,'email','ar')`, [adminId, compoundId, email, pw]);
    const blocks = ['A', 'B', 'C'];
    for (const b of blocks)
      for (let i = 1; i <= 12; i++)
        await tx.query(`INSERT INTO unit (id, compound_id, number, block, type) VALUES ($1,$2,$3,$4,'villa')`, [newId(), compoundId, `${b}-${i}`, b]);
  });
  return { compoundId, email, password, created: true };
}

if (require.main === module) {
  (async () => {
    const ctx = await AppContext.create(loadConfig());
    const r = await seed(ctx);
    console.log(r.created ? `Seeded compound ${r.compoundId}\nAdmin: ${r.email} / ${r.password}` : `Already seeded (${r.email})`);
    await ctx.db.close();
  })();
}
