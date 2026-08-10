export interface ConsentValues {
  acceptedTos: boolean;
  acceptedPrivacy: boolean;
  acceptedNotRia: boolean;
}

export function ConsentCheckboxes({
  values,
  onChange,
}: {
  values: ConsentValues;
  onChange: (key: keyof ConsentValues, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2 pt-1 text-[13px] sm:space-y-3 sm:text-sm">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={values.acceptedTos}
          onChange={(e) => onChange("acceptedTos", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[rgb(var(--ui-brand))]"
        />
        <span className="text-content-secondary leading-snug">
          I agree to the{" "}
          <a
            href="https://lasagnafi.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:text-brand-hover underline underline-offset-2"
          >
            Terms of Service
          </a>
        </span>
      </label>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={values.acceptedPrivacy}
          onChange={(e) => onChange("acceptedPrivacy", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[rgb(var(--ui-brand))]"
        />
        <span className="text-content-secondary leading-snug">
          I agree to the{" "}
          <a
            href="https://lasagnafi.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:text-brand-hover underline underline-offset-2"
          >
            Privacy Policy
          </a>
        </span>
      </label>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={values.acceptedNotRia}
          onChange={(e) => onChange("acceptedNotRia", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[rgb(var(--ui-brand))]"
        />
        <span className="text-content-secondary leading-snug">
          I understand that LasagnaFi is <strong className="font-semibold text-content">not a registered
          investment advisor</strong> and does not provide financial advice
        </span>
      </label>
    </div>
  );
}
