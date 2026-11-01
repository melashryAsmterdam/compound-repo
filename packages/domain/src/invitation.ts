/** Invitation and unit activation derivations (data model §2, A2). */

export const INVITATION_TTL_MS = 7 * 86_400_000;
export const INVITES_PER_UNIT_PER_DAY = 5;

export type InvitationState = 'pending' | 'used' | 'expired' | 'superseded' | 'revoked';
export type ActivationStatus = 'not_invited' | 'invited' | 'failed' | 'expired' | 'active';
export type AssignmentStatus = 'invited' | 'active' | 'revoked';
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'skipped';

export interface InvitationFacts {
  expiresAt: Date;
  usedAt: Date | null;
  supersededAt: Date | null;
  revokedAt: Date | null;
}

export function invitationState(inv: InvitationFacts, now: Date): InvitationState {
  if (inv.usedAt) return 'used';
  if (inv.revokedAt) return 'revoked';
  if (inv.supersededAt) return 'superseded';
  if (inv.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

export function activationStatus(
  assignment: { status: AssignmentStatus } | null,
  latest: (InvitationFacts & { deliveryStatuses: DeliveryStatus[] }) | null,
  now: Date,
): ActivationStatus {
  if (!assignment || assignment.status === 'revoked') return 'not_invited';
  if (assignment.status === 'active') return 'active';
  if (!latest) return 'not_invited';
  const st = latest.deliveryStatuses;
  if (st.length > 0 && st.every((s) => s === 'failed' || s === 'undelivered')) return 'failed';
  if (invitationState(latest, now) === 'expired') return 'expired';
  return 'invited';
}

/** Which invite channels can be offered for an owner (A2-AC2). */
export function availableChannels(owner: { phone: string | null; email: string | null }): Array<'sms' | 'email'> {
  const out: Array<'sms' | 'email'> = [];
  if (owner.phone) out.push('sms');
  if (owner.email) out.push('email');
  return out;
}

/** OTP goes to the invited mobile, or email if invited by email only (R1-AC3). */
export function otpChannelFor(person: { phone: string | null; email: string | null }): 'sms' | 'email' | null {
  if (person.phone) return 'sms';
  if (person.email) return 'email';
  return null;
}
