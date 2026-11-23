import { chatRequest } from "../chat";
jest.mock("../navigation", () => ({ openPath: jest.fn() }));
import { hideIdCitations, linkTarget, stripMarkdown, threadDate } from "../chat-text";

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

test("drops the ids the model cites, with the space before them", () => {
  expect(hideIdCitations(`Your car payment would be $450 [${ID}].`)).toBe("Your car payment would be $450.");
  expect(hideIdCitations(`Two accounts [${ID}, ${ID2}] hold it.`)).toBe("Two accounts hold it.");
  expect(hideIdCitations("Upper case [ABCDEF00-0000-4000-8000-0000000000AB] too.")).toBe("Upper case too.");
  expect(hideIdCitations("A balance of $2,878.70 [get_debts].")).toBe("A balance of $2,878.70.");
  expect(hideIdCitations("Rate [get_debts, get_accounts] here.")).toBe("Rate here.");
  expect(hideIdCitations("Spent $13 [default_api:get_spending_summary].")).toBe("Spent $13.");
  expect(hideIdCitations("You are 34 [profile, get_financial_path], so [profile] says so.")).toBe("You are 34, so says so.");
  expect(hideIdCitations(`Mixed [ get_debts , ${ID} ].`)).toBe("Mixed.");
});

test("keeps a link whose text happens to be an id, and other brackets", () => {
  expect(hideIdCitations(`[${ID}](/accounts/${ID})`)).toBe(`[${ID}](/accounts/${ID})`);
  expect(hideIdCitations("A [note] stays, and [Two words] too.")).toBe("A [note] stays, and [Two words] too.");
  // A link whose text is a source word is a real link, and a list with a prose word is prose.
  expect(hideIdCitations("See [accounts](/accounts) and [profile, me].")).toBe("See [accounts](/accounts) and [profile, me].");
  expect(hideIdCitations("[Profile] is capitalized prose.")).toBe("[Profile] is capitalized prose.");
});

test("a preview is the answer's plain text on one line", () => {
  expect(stripMarkdown(`## Summary\n\nYou have **$12,000** saved [${ID}].\n\n- Keep going\n- [See spending](/spending)`)).toBe(
    "Summary You have $12,000 saved. Keep going See spending",
  );
  expect(stripMarkdown("| A | B |\n|---|---|\n| 1 | 2 |")).toBe("A B 1 2");
});

test("thread dates read Today, Yesterday, then the day", () => {
  const now = new Date(2026, 10, 22, 15, 0);
  expect(threadDate(new Date(2026, 10, 22, 8, 0).toISOString(), now)).toBe("Today");
  expect(threadDate(new Date(2026, 10, 21, 23, 0).toISOString(), now)).toBe("Yesterday");
  expect(threadDate(new Date(2026, 10, 3).toISOString(), now)).toBe("Nov 3");
  expect(threadDate(new Date(2025, 0, 3).toISOString(), now)).toBe("Jan 3, 2025");
  expect(threadDate("not a date", now)).toBe("");
});

test("an app path opens in the app, a page in the browser", () => {
  const web = "https://app.example.test";
  expect(linkTarget("/transactions?categories=food", web)).toEqual({ kind: "app", path: "/transactions?categories=food" });
  expect(linkTarget(`${web}/goals/1`, web)).toEqual({ kind: "app", path: "/goals/1" });
  expect(linkTarget("https://irs.example.test/limits", web)).toEqual({ kind: "web", url: "https://irs.example.test/limits" });
  expect(linkTarget("mailto:help@example.test", web)).toEqual({ kind: "system", url: "mailto:help@example.test" });
  expect(linkTarget("//evil.example.test", web)).toBeNull();
  expect(linkTarget("javascript:alert(1)", web)).toBeNull();
});

test("a chat link's query names one request by its stamp", () => {
  expect(chatRequest("prompt=Where%20did%20it%20go%3F&title=Spending&at=123")).toEqual({ prompt: "Where did it go?", title: "Spending", nonce: "123" });
  // Without a stamp the link itself is the request, so opening it again does not ask twice.
  expect(chatRequest("prompt=Hi")).toEqual({ prompt: "Hi", title: undefined, nonce: "link:prompt=Hi" });
  expect(chatRequest("prompt=%20%20")).toBeNull();
  expect(chatRequest(undefined)).toBeNull();
});
