import { DlpServiceClient } from "@google-cloud/dlp";

const PROJECT_ID = "lasagna-prod";
const LOCATION = "us";

const client = new DlpServiceClient();

const INFO_TYPES = [
  "PERSON_NAME",
  "US_SOCIAL_SECURITY_NUMBER",
  "STREET_ADDRESS",
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "DATE_OF_BIRTH",
  "US_INDIVIDUAL_TAXPAYER_IDENTIFICATION_NUMBER",
];

interface Field {
  key: string;
  value: string;
}

export async function redactPii(fields: Field[]): Promise<Field[]> {
  const text = normalizeSsns(
    fields.map((f) => `${f.key}: ${f.value}`).join("\n")
  );

  const [response] = await client.deidentifyContent({
    parent: `projects/${PROJECT_ID}/locations/${LOCATION}`,
    inspectConfig: {
      infoTypes: INFO_TYPES.map((name) => ({ name })),
      minLikelihood: "POSSIBLE",
    },
    deidentifyConfig: {
      infoTypeTransformations: {
        transformations: [
          {
            infoTypes: INFO_TYPES.map((name) => ({ name })),
            primitiveTransformation: {
              replaceConfig: {
                newValue: { stringValue: "[REDACTED]" },
              },
            },
          },
        ],
      },
    },
    item: { value: text },
  });

  const redactedLines = (response.item?.value ?? "").split("\n");
  const result: Field[] = [];

  for (const line of redactedLines) {
    const sepIdx = line.indexOf(": ");
    if (sepIdx === -1) continue;
    const key = line.slice(0, sepIdx).trim();
    const value = line.slice(sepIdx + 2).trim();
    if (!value || value === "[REDACTED]") continue;
    if (/^\[REDACTED\][\s,.\-]*$/.test(value)) continue;
    result.push({ key, value });
  }

  return result;
}

function normalizeSsns(text: string): string {
  // Collapse spaced digit sequences that look like SSNs
  return text.replace(/\b\d(?:\s+\d){2,8}\d*\b/g, (match) => {
    const digits = match.replace(/\s+/g, "");
    if (digits.length === 9) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    }
    return match;
  });
}
