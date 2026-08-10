import { Field, Input, SegmentedControl } from '../uikit';

// ---------------------------------------------------------------------------
// Value-source control — the "Market estimate / My own value" toggle plus the
// conditional "Your value" input. Shared by the create modal (Accounts) and the
// detail/edit page (account-detail) so the two flows stay consistent.
//
// Controlled: the parent owns `source` and `ownValue`. When "My own value" is
// selected the value input appears; "Market estimate" runs the auto-estimate
// and hides it. Value keystrokes are digit/decimal-only, matching both callers.
// ---------------------------------------------------------------------------

export type ValueSourceChoice = 'market' | 'own';

export function ValueSourceControl({
  source,
  onSourceChange,
  ownValue,
  onOwnValueChange,
}: {
  source: ValueSourceChoice;
  onSourceChange: (source: ValueSourceChoice) => void;
  ownValue: string;
  onOwnValueChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[12.5px] font-semibold text-content">Value source</p>
      <SegmentedControl
        aria-label="Value source"
        value={source}
        onChange={(v) => onSourceChange(v as ValueSourceChoice)}
        options={[
          { value: 'market', label: 'Market estimate' },
          { value: 'own', label: 'My own value' },
        ]}
      />
      {source === 'own' ? (
        <div className="mt-3">
          <Field label="Your value">
            <Input
              type="text"
              inputMode="decimal"
              value={ownValue}
              onChange={(e) => onOwnValueChange(e.target.value.replace(/[^0-9.]/g, ''))}
              className="ui-tnum"
              leadingIcon={<span className="text-[13px]">$</span>}
            />
          </Field>
          <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
            We'll use this value and won't overwrite it with an estimate.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
          We estimate the value from the address and keep it up to date.
        </p>
      )}
    </div>
  );
}
