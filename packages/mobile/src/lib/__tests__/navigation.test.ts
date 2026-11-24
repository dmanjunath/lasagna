const calls: string[] = [];
jest.mock("expo-router", () => ({
  router: {
    back: () => calls.push("back"),
    dismiss: () => calls.push("dismiss"),
    canGoBack: () => true,
    canDismiss: () => true,
    push: (h: string) => calls.push(`push ${h}`),
    navigate: (h: string) => calls.push(`navigate ${h}`),
    replace: (h: string) => calls.push(`replace ${h}`),
  },
}));

import { closeSheet, openPath } from "../navigation";
import { setCurrentTab, setSheetOpen } from "../routes";

beforeEach(() => {
  calls.length = 0;
  setCurrentTab("(home)");
});

test("opening a page from a sheet pops only the sheet, then pushes on the page it came from", () => {
  setSheetOpen(true);
  openPath("/accounts/acc-1");
  // One back (the sheet), never dismiss (which can pop the page under the sheet too, losing the user's place).
  expect(calls[0]).toBe("back");
  expect(calls.filter((c) => c === "back")).toHaveLength(1);
  expect(calls).not.toContain("dismiss");
  expect(calls[1]).toMatch(/^push .*accounts\/acc-1/);
});

test("with no sheet up, a link just pushes", () => {
  setSheetOpen(false);
  openPath("/accounts/acc-1");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatch(/^push /);
});

test("closing twice pops once", () => {
  setSheetOpen(true);
  closeSheet();
  closeSheet();
  expect(calls).toEqual(["back"]);
});
