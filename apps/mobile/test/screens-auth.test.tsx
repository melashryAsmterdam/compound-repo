import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import Otp from '@/app/otp';
import SignIn from '@/app/sign-in';
import ActivationPreview from '@/app/a/[token]';
import { getFlow, setFlow } from '@/lib/flow';
import { mockRouter, setParams } from './setup';
import { json, ME, mockFetch, renderScreen } from './render';

const CHALLENGE = {
  challengeId: '3b6f2c4e-0000-4000-8000-000000000001', channel: 'sms', maskedDestination: '+9665*****567',
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), resendsRemaining: 3,
};
const TOKEN = 'abcdefghijABCDEFGHIJ0123456789_-abcdefghijk';

beforeEach(() => {
  jest.clearAllMocks();
  setFlow(null);
  setParams({});
});

describe('M-03 Sign in', () => {
  it('enables Send code only for a valid Saudi mobile and starts OTP with E.164', async () => {
    const api = mockFetch({ 'POST /app/v1/auth/otp/start': () => json(200, CHALLENGE) });
    await renderScreen(<SignIn />, { fetch: api.fetch });
    const send = screen.getByTestId('send-code');
    await fireEvent.changeText(screen.getByTestId('phone-input'), '٠٥٥١٢٣');
    expect(send).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('phone-input'), '٠٥٥١٢٣٤٥٦٧');
    expect(send).toBeEnabled();
    await fireEvent.press(send);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/otp'));
    expect(api.calls[0]!.body).toEqual({ phone: '+966551234567' });
    expect(getFlow()).toMatchObject({ mode: 'signIn', identifier: '+966551234567' });
  });

  it('shows the localised rate-limit message', async () => {
    const api = mockFetch({ 'POST /app/v1/auth/otp/start': () => json(429, { code: 'rate_limited', status: 429, title: 'x', type: 'about:blank' }) });
    await renderScreen(<SignIn />, { fetch: api.fetch, locale: 'ar' });
    await fireEvent.changeText(screen.getByTestId('phone-input'), '0551234567');
    await fireEvent.press(screen.getByTestId('send-code'));
    expect(await screen.findByText('محاولات كثيرة. يرجى الانتظار ثم المحاولة مرة أخرى.')).toBeTruthy();
  });
});

describe('M-05 OTP', () => {
  it('auto-submits 6 digits (Arabic-Indic accepted) and signs in', async () => {
    setFlow({ mode: 'signIn', challenge: CHALLENGE as never, identifier: '+966551234567' });
    const api = mockFetch({
      'POST /app/v1/auth/otp/verify': () => json(200, { accessToken: 'a', accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: 'r', me: ME }),
    });
    await renderScreen(<Otp />, { fetch: api.fetch });
    await fireEvent.changeText(screen.getByTestId('otp-input'), '١٢٣٤٥٦');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)'));
    expect(api.calls[0]!.body).toMatchObject({ challengeId: CHALLENGE.challengeId, code: '123456', device: { platform: 'ios' } });
  });

  it('never says "number not found": a bad sign-in code shows the generic message', async () => {
    setFlow({ mode: 'signIn', challenge: CHALLENGE as never });
    const api = mockFetch({ 'POST /app/v1/auth/otp/verify': () => json(400, { code: 'otp_invalid', status: 400, title: 'x', type: 'about:blank' }) });
    await renderScreen(<Otp />, { fetch: api.fetch });
    await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
    expect(await screen.findByText(/couldn't sign you in with this number/)).toBeTruthy();
  });

  it('after 5 wrong codes the challenge is spent: no resend, start again (QA-13)', async () => {
    setFlow({ mode: 'signIn', challenge: CHALLENGE as never });
    const api = mockFetch({ 'POST /app/v1/auth/otp/verify': () => json(400, { code: 'otp_attempts_exceeded', status: 400, title: 'x', type: 'about:blank' }) });
    await renderScreen(<Otp />, { fetch: api.fetch });
    await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
    expect(await screen.findByText('Too many wrong codes. Start again to get a new code.')).toBeTruthy();
    expect(screen.queryByTestId('otp-resend')).toBeNull();
    expect(screen.getByTestId('otp-input').props.editable).toBe(false);
    await fireEvent.press(screen.getByTestId('otp-start-again'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('shows an OTP error passed back from consent (activation)', async () => {
    setFlow({ mode: 'activation', challenge: CHALLENGE as never, lastError: 'otp_attempts_exceeded' });
    await renderScreen(<Otp />, { fetch: mockFetch({}).fetch });
    expect(await screen.findByTestId('otp-start-again')).toBeTruthy();
    expect(getFlow()?.lastError).toBeUndefined();
  });

  it('activation mode keeps the code and moves to consent without calling the server', async () => {
    setFlow({ mode: 'activation', challenge: CHALLENGE as never });
    const api = mockFetch({});
    await renderScreen(<Otp />, { fetch: api.fetch });
    await fireEvent.changeText(screen.getByTestId('otp-input'), '654321');
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/consent'));
    expect(getFlow()?.code).toBe('654321');
    expect(api.calls).toHaveLength(0);
  });
});

describe('M-04 Activation preview', () => {
  it('shows name, compound and unit read-only, then starts activation by token', async () => {
    setParams({ token: TOKEN });
    const api = mockFetch({
      'GET /app/v1/invitations/:token': () => json(200, {
        fullName: 'Noura Al-Otaibi', compoundNameAr: 'مجمع النرجس', compoundNameEn: 'Narjis Compound', unitNumber: '14', block: 'B',
        otpChannel: 'sms', maskedDestination: '+9665*****567', privacyNoticeVersion: 'pn-1', termsVersion: 't-1',
      }),
      'POST /app/v1/activation/start': () => json(200, CHALLENGE),
    });
    await renderScreen(<ActivationPreview />, { fetch: api.fetch });
    expect(await screen.findByText('Welcome, Noura Al-Otaibi')).toBeTruthy();
    expect(screen.getByText('Narjis Compound')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('activate'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/otp'));
    expect(api.calls.find((c) => c.path === '/app/v1/activation/start')!.body).toEqual({ invitationToken: TOKEN });
    expect(getFlow()?.mode).toBe('activation');
  });

  it('expired link: R1-AC7 message with a call button from compoundContactPhone', async () => {
    setParams({ token: TOKEN });
    const api = mockFetch({
      'GET /app/v1/invitations/:token': () => json(410, { code: 'invitation_expired', status: 410, title: 'x', type: 'about:blank', compoundContactPhone: '+966112345678' }),
    });
    await renderScreen(<ActivationPreview />, { fetch: api.fetch });
    expect(await screen.findByTestId('invite-invalid')).toBeTruthy();
    expect(screen.getByText('Call management')).toBeTruthy();
  });
});
