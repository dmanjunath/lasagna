import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
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
  // The suggestion the arrow keys are on, or -1 for the typed text.
  const [active, setActive] = useState(-1);
  const listId = useId();
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
        setActive(-1);
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

  const showList = open && predictions.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <Input
        type="text"
        value={value}
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={() => { focusedRef.current = true; if (predictions.length > 0) setOpen(true); }}
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(predictions.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(predictions[active]); }
          // Stopped here: Escape closes the list, not the modal it sits in.
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
      />
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[264px] overflow-y-auto rounded-ui-md border border-line-strong bg-panel-raised p-1 shadow-ui-lg"
        >
          {predictions.map((p, i) => (
            <div
              key={p.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: picking must land before the input blurs.
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex min-h-touch cursor-pointer items-center rounded-ui-sm px-2.5 text-[13px] font-medium text-content sm:min-h-0 sm:py-2',
                i === active && 'bg-canvas-sunken',
              )}
            >
              <span className="min-w-0 truncate">{p.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
