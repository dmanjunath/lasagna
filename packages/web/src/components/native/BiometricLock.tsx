/**
 * BiometricLock — full-screen Face ID gate for the native shell. Mounted lazily
 * from App.tsx (native only) so the Capacitor plugin never ships in the web
 * bundle. It gates pixels, not the session: locked state just covers the app
 * (including login) until BiometricAuth.authenticate() succeeds.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { ScanFace } from 'lucide-react';
import { Button } from '../uikit';
import { isLockEnabled, shouldLock } from '../../lib/biometric-lock';

export default function BiometricLock() {
  // Cold start: backgroundedAt === null → locked whenever the lock is enabled.
  const [locked, setLocked] = useState(() =>
    shouldLock({ enabled: isLockEnabled(), backgroundedAt: null, now: Date.now() }),
  );
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      await BiometricAuth.authenticate({
        reason: 'Unlock LasagnaFi',
        allowDeviceCredential: true,
      });
      setLocked(false);
    } catch {
      // BiometryError (cancel/failure) — stay locked; user retries via the button.
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    const onBackground = () => {
      backgroundedAt.current = Date.now();
    };
    const onResume = () => {
      const lock = shouldLock({
        enabled: isLockEnabled(),
        backgroundedAt: backgroundedAt.current,
        now: Date.now(),
      });
      if (lock) setLocked(true);
    };
    window.addEventListener('native:background', onBackground);
    window.addEventListener('native:resume', onResume);
    return () => {
      window.removeEventListener('native:background', onBackground);
      window.removeEventListener('native:resume', onResume);
    };
  }, []);

  // Prompt as soon as we lock (cold start or resume past the grace window).
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  if (!locked) return null;

  return (
    <div className="ui-root boot-splash fixed inset-0 z-[100]">
      {/* The artwork itself carries the lockup, centred, exactly as the native
          launch and privacy screens draw it — so returning from the Face ID
          prompt does not move the mark. The button is placed relative to the
          viewport centre because the lockup is centred there; 9vh clears the
          lockup's lower half at any screen height, since `cover` scales the
          artwork with the viewport. */}
      <div
        className="absolute inset-x-0 flex justify-center"
        style={{ top: 'calc(50% + 9vh)' }}
      >
        {/* Neutral label: allowDeviceCredential means Face ID, Touch ID, or passcode. */}
        <Button size="lg" onClick={() => void unlock()}>
          <ScanFace className="h-4 w-4" />
          Unlock
        </Button>
      </div>
    </div>
  );
}
