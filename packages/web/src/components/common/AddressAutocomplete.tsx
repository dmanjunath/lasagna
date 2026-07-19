import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Input } from '../uikit';

// Address input backed by the Google Places proxy. Typing debounces a
// prediction fetch; picking a suggestion resolves its geocode (placeId/lat/lng)
// via /places/details. Editing the text by hand clears the resolved geocode so
// we never persist a placeId that no longer matches the shown address.
export function AddressAutocomplete({
  value,
  onTextChange,
  onPick,
  onReject,
  autoFocus,
}: {
  value: string;
  onTextChange: (text: string) => void;
  onPick: (r: { address: string; placeId: string; lat: number | null; lng: number | null }) => void;
  // Called instead of onPick when the picked place is a business (commercial
  // addresses aren't supported — only homes have a value estimate).
  onReject?: () => void;
  autoFocus?: boolean;
}) {
  const [predictions, setPredictions] = useState<Array<{ description: string; placeId: string }>>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Suppress the fetch triggered by our own onTextChange right after a pick.
  const skipNextRef = useRef(false);
  // Only fetch predictions once the user has actually focused the field. A
  // pre-filled value that loads after mount (opening the account edit page /
  // expanding settings) must NOT pop the autocomplete on its own.
  const focusedRef = useRef(false);

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    if (!focusedRef.current) return;
    const q = value.trim();
    if (q.length < 3) {
      setPredictions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { predictions } = await api.placesAutocomplete(q);
        setPredictions(predictions);
        setOpen(predictions.length > 0);
      } catch {
        setPredictions([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = async (p: { description: string; placeId: string }) => {
    setOpen(false);
    setPredictions([]);
    skipNextRef.current = true;
    try {
      const d = await api.placeDetails(p.placeId);
      // Commercial place (store, restaurant, …) — reject rather than saving an
      // address we can't value as a home.
      if (d.isBusiness) {
        onReject?.();
        return;
      }
      onPick({
        address: d.address ?? p.description,
        placeId: d.placeId,
        lat: d.lat,
        lng: d.lng,
      });
    } catch {
      // Fall back to the raw description if details resolution fails.
      onPick({ address: p.description, placeId: p.placeId, lat: null, lng: null });
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <Input
        type="text"
        value={value}
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={() => { focusedRef.current = true; if (predictions.length > 0) setOpen(true); }}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-ui-md border border-line bg-panel py-1 shadow-ui-md">
          {predictions.map((p) => (
            <li key={p.placeId}>
              <button
                type="button"
                className="block w-full px-3.5 py-2 text-left text-sm text-content hover:bg-line/40"
                onClick={() => pick(p)}
              >
                {p.description}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
