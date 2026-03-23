import type { FormTemplate } from "../types.js";

export const form1040Template: FormTemplate = {
  formId: "1040",
  formName: "Form 1040 - U.S. Individual Income Tax Return",
  detectPatterns: [
    /Form\s*1040/i,
    /U\.?S\.?\s*Individual\s*Income\s*Tax\s*Return/i,
    /Department\s*of\s*the\s*Treasury/i,
  ],
  fields: {
    wages: {
      line: "1a",
      label: "Wages, salaries, tips",
      region: { page: 1, x: 1650, y: 885, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    taxExemptInterest: {
      line: "2a",
      label: "Tax-exempt interest",
      region: { page: 1, x: 1650, y: 930, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    taxableInterest: {
      line: "2b",
      label: "Taxable interest",
      region: { page: 1, x: 1650, y: 975, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    qualifiedDividends: {
      line: "3a",
      label: "Qualified dividends",
      region: { page: 1, x: 1650, y: 1020, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    ordinaryDividends: {
      line: "3b",
      label: "Ordinary dividends",
      region: { page: 1, x: 1650, y: 1065, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    totalIncome: {
      line: "9",
      label: "Total income",
      region: { page: 1, x: 1650, y: 1380, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    adjustedGrossIncome: {
      line: "11",
      label: "Adjusted gross income",
      region: { page: 1, x: 1650, y: 1470, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    standardDeduction: {
      line: "12",
      label: "Standard deduction or itemized deductions",
      region: { page: 1, x: 1650, y: 1515, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    taxableIncome: {
      line: "15",
      label: "Taxable income",
      region: { page: 1, x: 1650, y: 1650, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    totalTax: {
      line: "24",
      label: "Total tax",
      region: { page: 2, x: 1650, y: 600, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    totalPayments: {
      line: "33",
      label: "Total payments",
      region: { page: 2, x: 1650, y: 1050, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    refund: {
      line: "35a",
      label: "Refund",
      region: { page: 2, x: 1650, y: 1140, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    amountOwed: {
      line: "37",
      label: "Amount you owe",
      region: { page: 2, x: 1650, y: 1230, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
  },
};

export const templates = [form1040Template];
