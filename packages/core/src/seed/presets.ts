import type { SeedConfig } from "./types.js";

export const PRESETS: Record<string, SeedConfig> = {
  negative: {
    assets: { cash: 2000 },
    loans: { credit_card: 8000, student_loan: 40000, car: 12000 },
  },

  "100k": {
    assets: {
      cash: 15000,
      savings: 25000,
      trad_401k: 50000,
      brokerage: 15000,
    },
    loans: { credit_card: 3000, car: 5000 },
  },

  "750k": {
    assets: {
      cash: 30000,
      savings: 50000,
      roth_401k: 150000,
      trad_401k: 200000,
      brokerage: 250000,
      hsa: 20000,
    },
    property: { primary: 450000 },
    loans: { primary_mortgage: 400000 },
  },

  "1.8M": {
    assets: {
      cash: 50000,
      savings: 100000,
      roth_401k: 200000,
      trad_401k: 300000,
      brokerage: 600000,
    },
    property: { primary: 800000, rental1: 400000 },
    loans: { primary_mortgage: 500000, rental1_mortgage: 150000 },
  },

  "4M": {
    assets: {
      cash: 100000,
      savings: 200000,
      roth_401k: 300000,
      trad_401k: 500000,
      brokerage: 1500000,
    },
    property: { primary: 1200000, rental1: 600000 },
    alternatives: { pe: 300000 },
    loans: { primary_mortgage: 500000, rental1_mortgage: 200000 },
  },

  "7M": {
    assets: {
      cash: 150000,
      savings: 200000,
      roth_401k: 400000,
      trad_401k: 600000,
      brokerage: 2500000,
    },
    property: { primary: 2000000, rental1: 800000, rental2: 700000 },
    alternatives: { pe: 500000, hedge: 300000 },
    loans: {
      primary_mortgage: 700000,
      rental1_mortgage: 150000,
      rental2_mortgage: 100000,
    },
  },

  "12M": {
    assets: {
      cash: 250000,
      savings: 300000,
      roth_401k: 500000,
      trad_401k: 1000000,
      brokerage: 4000000,
    },
    property: { primary: 2500000, rental1: 1000000, rental2: 500000 },
    alternatives: { pe: 1200000, hedge: 500000, angel: 300000 },
    loans: {
      primary_mortgage: 500000,
      rental1_mortgage: 200000,
      rental2_mortgage: 50000,
    },
  },

  "25M": {
    assets: {
      cash: 500000,
      savings: 500000,
      roth_401k: 700000,
      trad_401k: 1300000,
      brokerage: 8000000,
    },
    property: {
      primary: 4000000,
      rental1: 2000000,
      rental2: 1500000,
      rental3: 500000,
    },
    alternatives: { pe: 4000000, hedge: 1500000, angel: 500000 },
    loans: {
      primary_mortgage: 300000,
      rental1_mortgage: 100000,
      rental2_mortgage: 100000,
    },
  },

  "75M": {
    assets: {
      cash: 1000000,
      savings: 1000000,
      roth_401k: 1000000,
      trad_401k: 2000000,
      brokerage: 25000000,
    },
    property: {
      primary: 8000000,
      rental1: 5000000,
      rental2: 4000000,
      rental3: 3000000,
    },
    alternatives: { pe: 15000000, hedge: 7000000, angel: 3000000 },
    loans: {
      primary_mortgage: 500000,
      rental1_mortgage: 300000,
      rental2_mortgage: 200000,
    },
  },
};
