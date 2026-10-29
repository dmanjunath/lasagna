import type { ReactNode } from "react";
import { Check } from "lucide-react";

export interface ConsentValues {
  acceptedTos: boolean;
  acceptedPrivacy: boolean;
  acceptedNotRia: boolean;
}

const linkClass =
  "ui-focus rounded-ui-sm text-brand hover:text-brand-hover underline underline-offset-2";

// Each row is a full 44px touch target: the box is 20px and the label's
// padding makes up the rest, with no untappable gap between rows.
function ConsentRow({ checked, onChange, children }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-touch items-start gap-3 py-3 cursor-pointer">
      <span className="relative grid h-5 w-5 shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer ui-focus h-5 w-5 cursor-pointer appearance-none rounded-ui-xs border border-line-heavy bg-panel transition-colors checked:border-brand checked:bg-brand"
        />
        <Check
          aria-hidden
          strokeWidth={3}
          className="pointer-events-none absolute h-3.5 w-3.5 text-brand-fg opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="text-content-secondary leading-snug">{children}</span>
    </label>
  );
}

export function ConsentCheckboxes({
  values,
  onChange,
}: {
  values: ConsentValues;
  onChange: (key: keyof ConsentValues, checked: boolean) => void;
}) {
  return (
    <div className="text-[13px] sm:text-sm">
      <ConsentRow checked={values.acceptedTos} onChange={(c) => onChange("acceptedTos", c)}>
        I agree to the{" "}
        <a href="https://lasagnafi.com/terms" target="_blank" rel="noopener noreferrer" className={linkClass}>
          Terms of Service
        </a>
      </ConsentRow>
      <ConsentRow checked={values.acceptedPrivacy} onChange={(c) => onChange("acceptedPrivacy", c)}>
        I agree to the{" "}
        <a href="https://lasagnafi.com/privacy" target="_blank" rel="noopener noreferrer" className={linkClass}>
          Privacy Policy
        </a>
      </ConsentRow>
      <ConsentRow checked={values.acceptedNotRia} onChange={(c) => onChange("acceptedNotRia", c)}>
        I understand that LasagnaFi is <strong className="font-semibold text-content">not a registered
        investment advisor</strong> and does not provide financial advice
      </ConsentRow>
    </div>
  );
}
