import { describe, it, expect } from "vitest";
import { stripPiiFields, redactIdNumbers } from "../tax-vision-extraction.js";

// Gemini returned a ZIP code on a real document even though the prompt forbids
// PII, so this scrub is the actual control rather than the prompt.
describe("stripPiiFields", () => {
  it("drops identifier fields the model should never have returned", () => {
    const out = stripPiiFields({
      zip_code: "00000",
      postal_code: "00000",
      ssn: "000-00-0000",
      social_security_number: "000-00-0000",
      ein: "00-0000000",
      street_address: "1 Example St",
      address: "1 Example St",
      phone_number: "555-0100",
      email_address: "someone@example.com",
      bank_account_number: "000123456",
      routing_number: "000000000",
    });
    expect(Object.keys(out)).toEqual([]);
  });

  it("keeps financial figures and the allowed city/state", () => {
    const fields = {
      w2_wages: 166000,
      taxable_interest: 700,
      total_income_line_9: 169686,
      standard_deduction: 28880,
      federal_income_tax_withheld_w2: 28600,
      refund_amount: 439,
      city: "Springfield",
      state: "MT",
    };
    expect(stripPiiFields(fields)).toEqual(fields);
  });

  it("drops name fields, which the privacy policy promises we do not store", () => {
    const out = stripPiiFields({
      name: "A",
      employee_name: "A",
      employer_name: "A",
      taxpayer_name: "A",
      spouse_name: "A",
      first_name: "A",
      last_name: "A",
      zipcode: "00000",
      date_of_birth: "1970-01-01",
      taxpayer_id: "000000000",
      wages: 1,
    });
    expect(out).toEqual({ wages: 1 });
  });

  it("scrubs nested objects and arrays, not just top-level keys", () => {
    const out = stripPiiFields({
      payer: { name: "A", ein: "00-0000000", total_paid: 500 },
      w2_forms: [{ employee_name: "A", street_address: "1 Example St", wages: 100 }],
      total_income: 600,
    });
    expect(out).toEqual({
      payer: { total_paid: 500 },
      w2_forms: [{ wages: 100 }],
      total_income: 600,
    });
  });

  it("does not match substrings inside legitimate financial keys", () => {
    // "einer"/"strein" style false positives, and account_* which is not
    // account_number, must survive.
    const fields = { einkommen: 1, accounts_receivable: 2, phonetic_note: 3 };
    expect(stripPiiFields(fields)).toEqual(fields);
  });
});

// The summary is prose, so keys can't be filtered. Id numbers have fixed shapes.
describe("redactIdNumbers", () => {
  it("redacts SSN and EIN shapes from free text", () => {
    expect(redactIdNumbers("SSN 000-00-0000 and EIN 00-0000000 on file")).toBe(
      "SSN [redacted] and EIN [redacted] on file"
    );
  });

  it("leaves money and years alone", () => {
    const s = "2025 Form 1040 showing $169,686 total income and a $439 refund.";
    expect(redactIdNumbers(s)).toBe(s);
  });
});
