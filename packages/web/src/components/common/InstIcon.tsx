import { useState } from 'react';
import { faviconUrl, institutionDomainFor } from '../ds/institutions';

// ---------------------------------------------------------------------------
// Institution avatar — favicon on a soft tile, initial fallback. Mirrors Money.
// `md` (default) is the 48px account-detail hero look; `sm` is a ~24px variant
// for menu rows and compact identity lines.
// ---------------------------------------------------------------------------

export function InstIcon({ institution, isManual, size = 'md' }: {
  institution: string;
  isManual: boolean;
  size?: 'md' | 'sm';
}) {
  const url = isManual ? null : faviconUrl(institutionDomainFor(institution), 64);
  const mono = (institution || '?').trim().charAt(0).toUpperCase();
  const [err, setErr] = useState(false);
  if (size === 'sm') {
    return (
      <div className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-[6px] border border-line bg-canvas-sunken text-[10px] font-bold text-content-secondary">
        {url && !err ? (
          <img src={url} alt="" className="h-4 w-4 rounded-[3px]" onError={() => setErr(true)} />
        ) : (
          mono
        )}
      </div>
    );
  }
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-ui-md border border-line bg-canvas-sunken text-[16px] font-bold text-content-secondary shadow-ui-sm">
      {url && !err ? (
        <img src={url} alt="" className="h-7 w-7 rounded-[6px]" onError={() => setErr(true)} />
      ) : (
        mono
      )}
    </div>
  );
}
