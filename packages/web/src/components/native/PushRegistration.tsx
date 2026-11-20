import { useEffect } from 'react';
import { useAuth } from '../../lib/auth';
import { isSetupPrompted } from '../../lib/biometric-lock';
import { registerPush } from '../../lib/push';

/**
 * Asks for push permission after sign-in (native shell only), once the Face ID
 * offer is answered, so the system prompt never lands on top of that sheet.
 * Demo sessions are shared, so they never register a device.
 */
export default function PushRegistration() {
  const { user } = useAuth();
  const signedIn = !!user && !user.isDemo;

  useEffect(() => {
    if (!signedIn) return;
    const register = () => {
      registerPush().catch((e) => console.info('[push] register failed:', e?.message ?? e));
    };
    if (isSetupPrompted()) {
      register();
      return;
    }
    window.addEventListener('native:faceid-prompted', register, { once: true });
    return () => window.removeEventListener('native:faceid-prompted', register);
  }, [signedIn]);

  return null;
}
