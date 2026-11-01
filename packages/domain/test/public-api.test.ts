import { describe, expect, it } from 'vitest';
import * as domain from '../src/index.js';

// QA-01 / Architect B1: apps/mobile and apps/api both import @compound/domain. Removing any of these
// names breaks one of the two builds.
describe('@compound/domain public API', () => {
  it.each([
    // mobile + foundation
    'mask', 'normalise', 'toWesternDigits', 'planSmsFallback', 'availableCommands', 'isQuietHour', 'DomainError',
    // api + portal
    'transition', 'maskPhone', 'normaliseSaudiMobile', 'maskDestination', 'routeFor', 'smsFallbackFor',
    'invitationState', 'activationStatus', 'visitWindowToUtc', 'formatRequestRef', 'allowedAdminTransitions',
  ])('exports %s', (name) => expect(typeof (domain as Record<string, unknown>)[name]).toBe('function'));

  it('both phone APIs agree on valid Saudi mobiles', () => {
    for (const input of ['0512345678', '+966 51 234 5678', '٠٥١٢٣٤٥٦٧٨']) {
      expect(domain.normaliseSaudiMobile(input)).toBe(domain.normalise(input));
    }
  });
});
