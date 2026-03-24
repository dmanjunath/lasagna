import { useState } from "react";
import { motion } from "framer-motion";
import { Save, Loader2 } from "lucide-react";
import { Button } from "../ui/button.js";
import type { ExtractedData } from "../../lib/types.js";

interface FormField {
  key: string;
  label: string;
  line: string;
}

const FORM_FIELDS: FormField[] = [
  { key: "wages", label: "Wages, salaries, tips", line: "1a" },
  { key: "interestIncome", label: "Interest income", line: "2b" },
  { key: "dividendIncome", label: "Dividend income", line: "3b" },
  { key: "capitalGains", label: "Capital gains (or losses)", line: "7" },
  { key: "otherIncome", label: "Other income", line: "8" },
  { key: "totalIncome", label: "Total income", line: "9" },
  { key: "adjustments", label: "Adjustments to income", line: "10" },
  { key: "adjustedGrossIncome", label: "Adjusted gross income", line: "11" },
  { key: "standardDeduction", label: "Standard/Itemized deduction", line: "12" },
  { key: "taxableIncome", label: "Taxable income", line: "15" },
  { key: "totalTax", label: "Total tax", line: "24" },
  { key: "totalPayments", label: "Total payments", line: "33" },
  { key: "refundOrOwed", label: "Refund / Amount owed", line: "35a/37" },
];

interface ManualEntryFormProps {
  initialData?: ExtractedData;
  onSave: (data: ExtractedData) => Promise<void>;
}

export function ManualEntryForm({ initialData, onSave }: ManualEntryFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    FORM_FIELDS.forEach((field) => {
      const existing = initialData?.fields[field.key];
      initial[field.key] = existing?.value?.toString() ?? "";
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (key: string, value: string) => {
    // Allow empty, numbers, and negative numbers
    const cleaned = value.replace(/[^0-9.-]/g, "");
    setValues((prev) => ({ ...prev, [key]: cleaned }));
  };

  const formatForDisplay = (value: string) => {
    if (!value) return "";
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toLocaleString("en-US");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const extractedData: ExtractedData = {
      confidence: 100, // Manual entry is always 100% confident
      fields: {},
    };

    FORM_FIELDS.forEach((field) => {
      const rawValue = values[field.key];
      const numValue = rawValue ? parseFloat(rawValue) : 0;
      extractedData.fields[field.key] = {
        value: numValue,
        line: field.line,
        verified: true, // Manual entry is pre-verified
      };
    });

    try {
      await onSave(extractedData);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="glass-card rounded-2xl p-4 md:p-6">
        <div className="text-sm text-text-muted mb-4">
          Enter values from your Form 1040. Leave fields blank if not applicable.
        </div>

        <div className="space-y-3">
          {FORM_FIELDS.map((field, i) => (
            <motion.div
              key={field.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-center gap-3"
            >
              <div className="w-12 text-xs text-text-muted font-mono">
                Line {field.line}
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-sm text-text-secondary">{field.label}</label>
              </div>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formatForDisplay(values[field.key])}
                  onChange={(e) => handleChange(field.key, e.target.value.replace(/,/g, ""))}
                  className="w-full pl-7 pr-3 py-2 rounded-lg bg-surface border border-border text-right text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50"
                  placeholder="0"
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save className="w-4 h-4 mr-2" />
            Save Tax Information
          </>
        )}
      </Button>
    </form>
  );
}
