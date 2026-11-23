import {
  accountCountText,
  addableItems,
  effectiveBalance,
  groupsByInstitution,
  groupsByType,
  lastSyncedOf,
  relativeTime,
  stripAccountMask,
  titleCase,
  type Item,
  type ItemAccount,
} from "../account-list";

const acct = (p: Partial<ItemAccount> & Pick<ItemAccount, "id" | "type">): ItemAccount => ({
  name: `Account ${p.id}`,
  subtype: null,
  mask: null,
  balance: "0",
  currency: "USD",
  ...p,
});

const items: Item[] = [
  {
    id: "i1",
    institutionId: "ins_1",
    institutionName: "Maple Bank",
    status: "good",
    lastSyncedAt: "2026-11-22T10:00:00Z",
    accounts: [
      acct({ id: "chk", type: "depository", subtype: "checking", balance: "1000.50", mask: "1234", name: "PLATINUM CHECKING ••1234" }),
      acct({ id: "cc", type: "credit", balance: "250", name: "rewards card" }),
      acct({ id: "skip", type: "depository", balance: "500", excludeFromNetWorth: true }),
    ],
  },
  {
    id: "m",
    institutionId: "manual",
    institutionName: null,
    status: "good",
    lastSyncedAt: null,
    accounts: [
      acct({ id: "home", type: "real_estate", subtype: "primary", balance: "400000", name: "Maplewood Ct home" }),
      acct({ id: "mort", type: "loan", subtype: "mortgage", balance: "-300000", propertyAccountId: "home", name: "home loan" }),
      acct({ id: "inv", type: "investment", balance: "100", invertBalance: true }),
    ],
  },
];

test("effective balance follows the invert override", () => {
  expect(effectiveBalance({ balance: "100", invertBalance: true })).toBe(-100);
  expect(effectiveBalance({ balance: null })).toBe(0);
});

test("names: title case keeps short words in capitals, a trailing mask goes", () => {
  expect(titleCase("PLATINUM CHECKING hsa")).toBe("Platinum Checking HSA");
  expect(stripAccountMask("Checking ••1234", "1234")).toBe("Checking");
  expect(stripAccountMask("Checking (1234)", "1234")).toBe("Checking");
  expect(stripAccountMask("1234", "1234")).toBe("1234");
});

test("groups by type in the web's order, totals skip excluded accounts, debt is owed", () => {
  const g = groupsByType(items);
  expect(g.map((x) => x.title)).toEqual(["Cash", "Investments", "Property", "Debt"]);
  expect(g[0].total).toBeCloseTo(1000.5);
  expect(g[0].count).toBe(2);
  expect(g[1].total).toBe(-100);
  const debt = g[3];
  expect(debt.owed).toBe(true);
  expect(debt.total).toBe(300250);
  const mortgage = debt.rows.find((r) => r.account.id === "mort")!;
  expect(mortgage.meta).toBe("Mortgage, linked to Maplewood CT Home");
  expect(mortgage.owed).toBe(true);
  const home = g[2].rows[0];
  expect(home.meta).toBe("Primary, linked to Home Loan");
  expect(g[0].rows.find((r) => r.account.id === "skip")!.badges).toEqual(["Not counted"]);
  expect(g[0].rows[0].name).toBe("Platinum Checking");
});

test("groups by institution: net totals and status words", () => {
  const now = new Date("2026-11-22T13:00:00Z").getTime();
  const [bank, manual] = groupsByInstitution(items, now);
  expect(bank.status).toBe("synced 3h ago");
  expect(bank.total).toBeCloseTo(750.5);
  expect(bank.rows[1].meta).toBe("Credit");
  expect(bank.rows[1].owed).toBe(false);
  expect(bank.rows[1].negative).toBe(true);
  expect(manual.status).toBe("Manual entry");
  expect(manual.institution).toBe("Manual");
  expect(manual.total).toBe(400000 - 300000 - 100);
  expect(groupsByInstitution([{ ...items[0], status: "item_login_required" }])[0].status).toBe("Needs attention");
});

test("counts, last sync, relative time, addable connections", () => {
  expect(accountCountText(8, 7)).toBe("8 accounts (1 not counted in net worth)");
  expect(accountCountText(1, 1)).toBe("1 account");
  expect(lastSyncedOf(items)).toBe("2026-11-22T10:00:00Z");
  const now = new Date("2026-11-22T10:00:00Z").getTime();
  expect(relativeTime("2026-11-22T09:59:30Z", now)).toBe("just now");
  expect(relativeTime("2026-11-20T10:00:00Z", now)).toBe("2d ago");
  expect(addableItems(items).map((i) => i.id)).toEqual(["i1"]);
  expect(addableItems([{ ...items[0], accounts: items[0].accounts.map((a) => ({ ...a, frozen: true })) }])).toEqual([]);
});
