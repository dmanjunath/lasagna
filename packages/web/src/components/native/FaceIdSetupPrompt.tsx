import { useEffect, useState } from 'react';
import { ScanFace } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../uikit';
import { isNativeApp } from '../../lib/native';
import { setLockEnabled } from '../../lib/biometric-lock';
import { setPasskeyRegistered } from '../../lib/passkey-hint';

const PROMPTED_KEY = 'lasagna_faceid_prompted';

/**
 * One-time post-login offer (native shell only) to turn on Face ID: it enables
 * the app-lock (Face ID to reopen the app) AND registers a passkey (Face ID to
 * sign in next time). Shown once — the `lasagna_faceid_prompted` flag is set on
 * accept, decline, or when the device has no biometrics.
 */
export default function FaceIdSetupPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isNativeApp()) return;
    try {
      if (localStorage.getItem(PROMPTED_KEY) === '1') return;
    } catch {
      return;
    }
    let cancelled = false;
    void import('@aparajita/capacitor-biometric-auth').then(async ({ BiometricAuth }) => {
      try {
        const { isAvailable } = await BiometricAuth.checkBiometry();
        if (cancelled) return;
        if (isAvailable) setShow(true);
        else markPrompted(); // no Face ID / Touch ID on this device — never ask
      } catch {
        /* leave unprompted; we'll offer again next launch */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markPrompted = () => {
    try {
      localStorage.setItem(PROMPTED_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };

  const dismiss = () => {
    markPrompted();
    setShow(false);
  };

  const enable = async () => {
    setBusy(true);
    setError('');
    try {
      // Confirm the user can actually pass Face ID before turning the lock on,
      // so a broken/unenrolled sensor can't lock them out.
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      await BiometricAuth.authenticate({ reason: 'Enable Face ID for LasagnaFi', allowDeviceCredential: true });
      setLockEnabled(true);

      // Register a passkey too so login is faster next time. Best-effort: the
      // lock is already on, so a passkey failure shouldn't block the flow.
      try {
        const { startRegistration } = await import('@simplewebauthn/browser');
        const options = await api.webauthnRegisterOptions();
        const response = await startRegistration({ optionsJSON: options as never });
        await api.webauthnRegisterVerify({ response });
        setPasskeyRegistered(true);
      } catch {
        /* passkey optional */
      }
      dismiss();
    } catch {
      // Biometric confirm cancelled/failed — leave everything off and let them
      // retry or dismiss. Don't mark prompted so a genuine misfire can retry.
      setError("Couldn't turn on Face ID. You can enable it later in Settings.");
      setBusy(false);
    }
  };

  if (!show) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/45 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="faceid-setup-title"
        className="w-full max-w-sm bg-panel border border-line rounded-t-ui-xl sm:rounded-ui-xl shadow-ui-lg p-6 flex flex-col items-center text-center gap-3"
      >
        <span className="grid h-14 w-14 place-items-center rounded-ui-lg bg-brand-soft text-brand">
          <ScanFace className="h-7 w-7" />
        </span>
        <h2 id="faceid-setup-title" className="text-[17px] font-bold tracking-tight text-content">
          Turn on Face ID?
        </h2>
        <p className="text-[13.5px] font-medium text-content-muted leading-relaxed">
          Use Face ID to lock LasagnaFi when you leave, and to sign in without a
          password next time. You can change this anytime in Settings.
        </p>
        {error && <p role="alert" className="text-[12.5px] font-medium text-negative">{error}</p>}
        <div className="flex flex-col gap-2 w-full pt-2">
          <Button size="lg" className="w-full" onClick={() => void enable()} loading={busy} disabled={busy}>
            <ScanFace className="h-4 w-4" />
            Enable Face ID
          </Button>
          <Button variant="ghost" size="lg" className="w-full" onClick={dismiss} disabled={busy}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
