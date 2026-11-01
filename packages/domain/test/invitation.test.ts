import { describe, expect, it } from 'vitest';
import { activationStatus, availableChannels, invitationState, otpChannelFor } from '../src/index.js';

const now = new Date('2026-11-01T12:00:00Z');
const base = { expiresAt: new Date('2026-11-05T00:00:00Z'), usedAt: null, supersededAt: null, revokedAt: null };

describe('invitationState', () => {
  it('pending', () => expect(invitationState(base, now)).toBe('pending'));
  it('used wins', () => expect(invitationState({ ...base, usedAt: now, revokedAt: now }, now)).toBe('used'));
  it('revoked', () => expect(invitationState({ ...base, revokedAt: now, supersededAt: now }, now)).toBe('revoked'));
  it('superseded', () => expect(invitationState({ ...base, supersededAt: now }, now)).toBe('superseded'));
  it('expired at the boundary', () => expect(invitationState({ ...base, expiresAt: now }, now)).toBe('expired'));
});

describe('activationStatus', () => {
  const inv = { ...base, deliveryStatuses: ['sent' as const] };
  it('no assignment', () => expect(activationStatus(null, null, now)).toBe('not_invited'));
  it('revoked assignment', () => expect(activationStatus({ status: 'revoked' }, inv, now)).toBe('not_invited'));
  it('active', () => expect(activationStatus({ status: 'active' }, inv, now)).toBe('active'));
  it('assigned, never invited', () => expect(activationStatus({ status: 'invited' }, null, now)).toBe('not_invited'));
  it('failed when every delivery failed', () =>
    expect(activationStatus({ status: 'invited' }, { ...inv, deliveryStatuses: ['failed', 'undelivered'] }, now)).toBe('failed'));
  it('not failed when one channel succeeded', () =>
    expect(activationStatus({ status: 'invited' }, { ...inv, deliveryStatuses: ['failed', 'delivered'] }, now)).toBe('invited'));
  it('invited with deliveries still queued', () =>
    expect(activationStatus({ status: 'invited' }, { ...inv, deliveryStatuses: [] }, now)).toBe('invited'));
  it('expired', () =>
    expect(activationStatus({ status: 'invited' }, { ...inv, expiresAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe('expired'));
});

describe('channels', () => {
  it('available channels', () => {
    expect(availableChannels({ phone: '+966512345678', email: 'a@b.sa' })).toEqual(['sms', 'email']);
    expect(availableChannels({ phone: null, email: 'a@b.sa' })).toEqual(['email']);
    expect(availableChannels({ phone: null, email: null })).toEqual([]);
  });
  it('otp channel prefers sms', () => {
    expect(otpChannelFor({ phone: '+966512345678', email: 'a@b.sa' })).toBe('sms');
    expect(otpChannelFor({ phone: null, email: 'a@b.sa' })).toBe('email');
    expect(otpChannelFor({ phone: null, email: null })).toBeNull();
  });
});
