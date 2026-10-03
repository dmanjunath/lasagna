import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    // mql.matches, not window.innerWidth. The query was already built and then
    // ignored, and innerWidth grows with horizontal overflow, so one wide page
    // was enough to report a phone as desktop and render the full sidebar on it.
    const onChange = () => setIsMobile(mql.matches);

    mql.addEventListener('change', onChange);
    setIsMobile(mql.matches);

    return () => mql.removeEventListener('change', onChange);
  }, []);

  return !!isMobile;
}
