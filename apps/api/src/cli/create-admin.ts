/**
 * Operator tool (Q-4: we provision compounds and admins). Creates a compound and its first admin.
 *   pnpm --filter @compound/api ops:create-admin -- --compound-en "Al Narjis" --compound-ar "النرجس" \
 *     --contact 0112345678 --email owner@example.sa --name "Abu Fahad" --password '…12+ chars…'
 * Runs as the migration owner (not app_api) and audits with actor_type = 'operator'.
 */
import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { hashPassword, PASSWORD_MIN } from '../modules/auth/password.js';

const { values } = parseArgs({
  options: {
    'compound-en': { type: 'string' },
    'compound-ar': { type: 'string' },
    contact: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
    password: { type: 'string' },
    phone: { type: 'string' },
  },
});

async function main(): Promise<void> {
  const required = ['compound-en', 'compound-ar', 'contact', 'email', 'name', 'password'] as const;
  const missing = required.filter((k) => !values[k]);
  if (missing.length) throw new Error(`Missing: ${missing.map((m) => `--${m}`).join(' ')}`);
  if (values.password!.length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters`);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres' });
  await client.connect();
  const compoundId = randomUUID();
  const adminId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.compound_id', $1, true)`, [compoundId]);
    await client.query('INSERT INTO compound (id, name_ar, name_en, contact_phone) VALUES ($1, $2, $3, $4)', [
      compoundId,
      values['compound-ar'],
      values['compound-en'],
      // Compound contact may be a landline (shown to residents, Q-21): 0XXXXXXXXX → +966XXXXXXXXX.
      values.contact!.replace(/\s/g, '').replace(/^0/, '+966'),
    ]);
    await client.query(
      `INSERT INTO admin_user (id, compound_id, email, full_name, phone_e164, password_hash, mfa_channel)
       VALUES ($1, $2, lower($3), $4, $5, $6, 'email')`,
      [adminId, compoundId, values.email, values.name, values.phone ?? null, await hashPassword(values.password!)],
    );
    await client.query(
      `INSERT INTO audit_log (compound_id, actor_type, action, entity_type, entity_id, row_hash)
       VALUES ($1, 'operator', 'admin.provision', 'admin_user', $2, $3)`,
      [compoundId, adminId, createHash('sha256').update(JSON.stringify([compoundId, 'operator', 'admin.provision', adminId])).digest()],
    );
    await client.query('COMMIT');
    console.log(`Created compound ${compoundId} and admin ${adminId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
