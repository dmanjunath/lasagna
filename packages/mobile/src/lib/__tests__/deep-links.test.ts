import { hrefForLink, webPathFromUrl } from "../deep-links";

test("the web path comes from a universal link's path or the scheme's host on", () => {
  expect(webPathFromUrl("https://app.example.test/reset-password?token=abc")).toBe("/reset-password?token=abc");
  expect(webPathFromUrl("https://app.example.test")).toBe("/");
  expect(webPathFromUrl("lasagna://reset-password?token=bad")).toBe("/reset-password?token=bad");
  expect(webPathFromUrl("lasagna://accounts/123")).toBe("/accounts/123");
  expect(webPathFromUrl("lasagna:///goals")).toBe("/goals");
  expect(webPathFromUrl("/billing/success?canceled=1")).toBe("/billing/success?canceled=1");
});

test("auth links open their root screens with the token intact", () => {
  expect(hrefForLink("lasagna://reset-password?token=bad")).toBe("/reset-password?token=bad");
  expect(hrefForLink("https://app.example.test/accept-invite?token=t1")).toBe("/accept-invite?token=t1");
  expect(hrefForLink("https://app.example.test/billing/success")).toBe("/billing/success");
  expect(hrefForLink("https://app.example.test/signup")).toBe("/sign-in?mode=signup");
});

test("app links open a tab, a native screen, or the fallback", () => {
  expect(hrefForLink("https://app.example.test/")).toBe("/(home)");
  expect(hrefForLink("https://app.example.test/goals")).toBe("/(goals)");
  expect(hrefForLink("lasagna://transactions?categories=food")).toBe("/(spending)/transactions?categories=food");
  expect(hrefForLink("https://app.example.test/plans/savings/g1")).toBe("/(home)/goals/g1");
});

test("Plaid's OAuth return is recognised on either link form", () => {
  const { isPlaidOAuthReturn } = jest.requireActual("../deep-links");
  expect(isPlaidOAuthReturn("https://app.example.com/plaid-oauth?oauth_state_id=x")).toBe(true);
  expect(isPlaidOAuthReturn("lasagna://plaid-oauth")).toBe(true);
  expect(isPlaidOAuthReturn("/plaid-oauth-other")).toBe(false);
});
