import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const UnitInput = z.object({
  number: z.string().trim().min(1).max(30),
  block: optionalText(30),
  type: z.enum(['villa', 'apartment', 'townhouse', 'other']),
  floor: optionalText(10),
  notes: optionalText(500),
});
export type UnitInput = z.infer<typeof UnitInput>;

export const UnitPatch = z
  .object({
    number: z.string().trim().min(1).max(30),
    block: optionalText(30),
    type: z.enum(['villa', 'apartment', 'townhouse', 'other']),
    floor: optionalText(10),
    notes: optionalText(500),
    status: z.enum(['active', 'inactive']),
  })
  .partial();
export type UnitPatch = z.infer<typeof UnitPatch>;

export const ACTIVATION = ['not_invited', 'invited', 'failed', 'expired', 'active'] as const;
export type Activation = (typeof ACTIVATION)[number];

export const UnitListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  block: z.string().trim().max(30).optional(),
  activation: z.enum(ACTIVATION).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().pipe(z.literal(50)).default(50),
});
export type UnitListQuery = z.infer<typeof UnitListQuery>;

export const OwnerInput = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().max(20).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    locale: z.enum(['ar', 'en']).default('ar'),
  })
  .refine((v) => v.phone || v.email, { message: 'phone_or_email_required', path: ['phone'] });
export type OwnerInput = z.infer<typeof OwnerInput>;
