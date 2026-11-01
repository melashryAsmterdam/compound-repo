import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState } from 'react';

/** Face ID vs fingerprint wording (M-08, M-23). */
export function useBiometricKind(): { kind: 'face' | 'finger'; available: boolean } {
  const [state, setState] = useState<{ kind: 'face' | 'finger'; available: boolean }>({ kind: 'finger', available: false });
  useEffect(() => {
    void (async () => {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const available = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      setState({ kind: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? 'face' : 'finger', available });
    })();
  }, []);
  return state;
}
