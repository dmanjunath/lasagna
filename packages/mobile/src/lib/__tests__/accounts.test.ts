import { groupAccounts, indexFromItems } from "../accounts";

test("indexFromItems flattens items with their institution", () => {
  expect(
    indexFromItems({
      items: [
        { institutionName: null, institutionId: "manual", accounts: [{ id: "1", name: "Cash", mask: null, type: "depository" }] },
        { institutionName: "Bank", institutionId: "ins_1", accounts: [{ id: "2", name: "Card", mask: "12", type: "credit" }] },
      ],
    }),
  ).toEqual([
    { id: "1", name: "Cash", mask: null, institution: "Manual", isManual: true, type: "depository" },
    { id: "2", name: "Card", mask: "12", institution: "Bank", isManual: false, type: "credit" },
  ]);
});

test("groupAccounts orders cash, cards, assets, then debts, unknown types last", () => {
  const a = (id: string, type: string) => ({ id, name: id, mask: null, institution: "", isManual: true, type });
  const groups = groupAccounts([a("loan", "loan"), a("x", "mystery"), a("chk", "depository"), a("card", "credit"), a("sav", "depository")]);
  expect(groups.map((g) => [g.title, g.accounts.map((x) => x.id)])).toEqual([
    ["Cash", ["chk", "sav"]],
    ["Credit cards", ["card"]],
    ["Loans", ["loan"]],
    ["Other", ["x"]],
  ]);
});
