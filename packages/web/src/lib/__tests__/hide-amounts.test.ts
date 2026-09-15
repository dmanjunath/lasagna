import { describe, it, expect, vi } from "vitest";

/**
 * The module resolves the stored flag at IMPORT time, so that formatters can
 * read it synchronously during the first render. Each case therefore installs
 * storage first and then re-imports.
 */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  return store;
}

async function load(initial: Record<string, string> = {}) {
  const store = stubStorage(initial);
  vi.resetModules();
  const mod = await import("../hide-amounts.js");
  return { ...mod, store };
}

describe("maskAmount", () => {
  // The whole point of the feature. A mask derived from the value — digit
  // substitution, a width, a blur — would leak the magnitude it hides.
  it("is identical for a small and a large amount", async () => {
    const { setAmountsHidden, maskAmount } = await load();
    setAmountsHidden(true);
    expect(maskAmount("$340")).toBe(maskAmount("$3,400,000"));
    expect(maskAmount("$3.40")).toBe(maskAmount("$3,400,000"));
  });

  it("is the same constant for zero", async () => {
    const { setAmountsHidden, maskAmount, HIDDEN_AMOUNT } = await load();
    setAmountsHidden(true);
    expect(maskAmount("$0.00")).toBe(HIDDEN_AMOUNT);
  });

  it("carries no digits", async () => {
    const { HIDDEN_AMOUNT } = await load();
    expect(HIDDEN_AMOUNT).not.toMatch(/\d/);
  });

  it("passes the formatted value through while the mode is off", async () => {
    const { isAmountsHidden, maskAmount } = await load();
    expect(isAmountsHidden()).toBe(false);
    expect(maskAmount("$3,400,000")).toBe("$3,400,000");
  });
});

describe("stored flag", () => {
  it("round-trips through localStorage", async () => {
    const first = await load();
    expect(first.isAmountsHidden()).toBe(false);
    first.setAmountsHidden(true);

    // Same storage, fresh module: a reload must come up already hidden, before
    // the first money string is formatted.
    const second = await load(Object.fromEntries(first.store));
    expect(second.isAmountsHidden()).toBe(true);

    second.setAmountsHidden(false);
    const third = await load(Object.fromEntries(second.store));
    expect(third.isAmountsHidden()).toBe(false);
  });

  it("notifies subscribers on change, but not on a repeat of the same value", async () => {
    const { setAmountsHidden, subscribeAmountsHidden } = await load();
    let calls = 0;
    const unsubscribe = subscribeAmountsHidden(() => {
      calls += 1;
    });
    setAmountsHidden(true);
    setAmountsHidden(true);
    expect(calls).toBe(1);
    unsubscribe();
    setAmountsHidden(false);
    expect(calls).toBe(1);
  });
});

describe("isMasked", () => {
  it("recognises a value a formatter has already replaced", async () => {
    const { isMasked, HIDDEN_AMOUNT } = await load();
    expect(isMasked(HIDDEN_AMOUNT)).toBe(true);
    expect(isMasked(`+${HIDDEN_AMOUNT}`)).toBe(true);
    expect(isMasked("$3,400,000")).toBe(false);
    expect(isMasked("+4.2%")).toBe(false);
    expect(isMasked(undefined)).toBe(false);
  });
});

describe("maskCurrencyInText", () => {
  it("passes text through untouched while the mode is off", async () => {
    const { maskCurrencyInText } = await load();
    expect(maskCurrencyInText("Pay off your $2,890 Credit Card")).toBe(
      "Pay off your $2,890 Credit Card",
    );
  });

  // Every currency shape that reaches the app as an already-formatted string.
  it.each([
    ["$1,234.56", "$•••••"],
    ["$1.2M", "$•••••"],
    ["$1.2m", "$•••••"],
    ["-$340", "$•••••"],
    ["$0", "$•••••"],
    ["$1,234", "$•••••"],
    ["$722/yr", "$•••••/yr"],
    ["USD 1,234", "$•••••"],
  ])("masks %s", async (input, expected) => {
    const { setAmountsHidden, maskCurrencyInText } = await load();
    setAmountsHidden(true);
    expect(maskCurrencyInText(input)).toBe(expected);
  });

  // The important half. A pattern that eats a year, a step number, a percentage
  // or a count is a worse bug than the leak it was written to close: it corrupts
  // copy on every masked surface.
  it.each([
    "Reach financial independence in 2045",
    "Step 10: rebalance",
    "The market has returned 10% a year since 1928",
    "24.99% APR",
    "Retire at age 65",
    "6 accounts connected",
    "Up 4.2% this month",
  ])("leaves %s alone", async (input) => {
    const { setAmountsHidden, maskCurrencyInText } = await load();
    setAmountsHidden(true);
    expect(maskCurrencyInText(input)).toBe(input);
  });

  it("masks the amounts in real insight copy without touching the rest", async () => {
    const { setAmountsHidden, maskCurrencyInText } = await load();
    setAmountsHidden(true);
    expect(
      maskCurrencyInText("Pay off your $2,890 Credit Card to stop $722/yr in interest"),
    ).toBe("Pay off your $••••• Credit Card to stop $•••••/yr in interest");
    expect(maskCurrencyInText("Step 10: Reach financial independence at $555,326")).toBe(
      "Step 10: Reach financial independence at $•••••",
    );
    expect(maskCurrencyInText("Move $956,000 from Cash to your Brokerage Account")).toBe(
      "Move $••••• from Cash to your Brokerage Account",
    );
  });

  // Magnitude survives a naive amount-only match: "$5 million" would still say
  // million. The scale word goes with the number.
  it("eats a spelled-out magnitude with the amount", async () => {
    const { setAmountsHidden, maskCurrencyInText } = await load();
    setAmountsHidden(true);
    expect(maskCurrencyInText("about $5 million saved")).toBe("about $••••• saved");
    expect(maskCurrencyInText("$1.2 billion")).toBe("$•••••");
  });

  // A word that merely starts with a scale letter must not be swallowed.
  it("keeps a following word that is not a magnitude", async () => {
    const { setAmountsHidden, maskCurrencyInText } = await load();
    setAmountsHidden(true);
    expect(maskCurrencyInText("$25 monthly")).toBe("$••••• monthly");
    expect(maskCurrencyInText("$40 billed today")).toBe("$••••• billed today");
  });

  // Masked copy must be as flat as a masked formatter: same output regardless
  // of magnitude, so nothing can be inferred by comparing two rendered strings.
  it("is identical for a small and a large amount in the same sentence", async () => {
    const { setAmountsHidden, maskCurrencyInText } = await load();
    setAmountsHidden(true);
    expect(maskCurrencyInText("You have $12 left")).toBe(
      maskCurrencyInText("You have $3,190,247 left"),
    );
  });
});
