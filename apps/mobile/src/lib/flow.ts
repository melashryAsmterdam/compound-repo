import type { InvitationPreview, OtpChallenge } from './api';

/** In-memory state shared by M-03/M-04 → M-05 → M-06 (never persisted: holds the OTP code). */
export interface AuthFlow {
  mode: 'signIn' | 'activation';
  challenge: OtpChallenge;
  identifier?: string;
  preview?: InvitationPreview;
  code?: string;
  contactPhone?: string;
  /** OTP error from a later step (M-06 activation/complete), shown when M-05 is back in focus. */
  lastError?: string;
}

let flow: AuthFlow | null = null;
export const setFlow = (f: AuthFlow | null) => {
  flow = f;
};
export const getFlow = () => flow;
export const patchFlow = (p: Partial<AuthFlow>) => {
  if (flow) flow = { ...flow, ...p };
};
