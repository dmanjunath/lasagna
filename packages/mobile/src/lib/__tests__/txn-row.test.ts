import { txnRowTone } from "../txn-row";

test("money back is basil, pending is muted, excluded fades", () => {
  expect(txnRowTone({ amount: "-12.50" }, false)).toEqual({ text: "content", amount: "positive", faded: false }); // a refund or income
  expect(txnRowTone({ amount: "40.00", pending: 1 }, false)).toEqual({ text: "secondary", amount: "secondary", faded: false });
  expect(txnRowTone({ amount: "40.00", excludedAt: "2026-11-01T00:00:00Z" }, false)).toEqual({ text: "content", amount: "content", faded: true });
  expect(txnRowTone({ amount: "40.00" }, false)).toEqual({ text: "content", amount: "content", faded: false });
});

test("hidden amounts show no direction", () => {
  expect(txnRowTone({ amount: "-12.50" }, true).amount).toBe("content");
  expect(txnRowTone({ amount: "-12.50", pending: true }, true).amount).toBe("secondary");
});
