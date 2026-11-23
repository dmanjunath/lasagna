import { maskCurrencyInText, setAmountsHidden } from "../hide-amounts";

afterEach(() => setAmountsHidden(false));

test("passes text through while the mode is off", () => {
  expect(maskCurrencyInText("Pay off your $2,890 Credit Card")).toBe("Pay off your $2,890 Credit Card");
});

test.each([
  ["$1,234.56", "$•••••"],
  ["$1.2M", "$•••••"],
  ["-$340", "$•••••"],
  ["$0", "$•••••"],
  ["$722/yr", "$•••••/yr"],
  ["USD 1,234", "$•••••"],
  ["about $5 million saved", "about $••••• saved"],
  ["$25 monthly", "$••••• monthly"],
])("masks %s", (input, expected) => {
  setAmountsHidden(true);
  expect(maskCurrencyInText(input)).toBe(expected);
});

test.each(["Reach financial independence in 2045", "Step 10: rebalance", "24.99% APR", "Retire at age 65", "6 accounts connected"])(
  "leaves %s alone",
  (input) => {
    setAmountsHidden(true);
    expect(maskCurrencyInText(input)).toBe(input);
  },
);
