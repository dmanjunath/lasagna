import { moneyDisplay } from "../format";

it("shows a typed amount as money, and leaves anything else as typed", () => {
  expect(moneyDisplay("14753.39")).toBe("$14,753.39");
  expect(moneyDisplay("1234")).toBe("$1,234.00");
  expect(moneyDisplay("")).toBe("");
  expect(moneyDisplay("abc")).toBe("abc");
});
