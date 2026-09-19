import { test, expect } from "@playwright/test";

// Verifies the chat answers a retirement-withdrawal question with real portfolio
// data from the DB (i.e., non-zero balance). Catches regressions like the one
// where get_portfolio_summary was returning $0 for users without per-security
// holdings rows.
//
// Uses /s/chat?prompt=... which auto-sends the prompt on page load — simplest
// path to drive a real chat round-trip without depending on UI selectors that
// vary across simple-mode, mobile, and desktop layouts.
test.use({ viewport: { width: 375, height: 812 } });

test("retirement withdrawal prompt cites real portfolio numbers", async ({ page }) => {
  const prompt = "what can i withdraw safely in retirement?";
  await page.goto(`/s/chat?prompt=${encodeURIComponent(prompt)}`);

  // Poll the page text until an assistant response longer than 400 chars appears,
  // or 90s elapses. The LLM call typically takes 15-45s; allow headroom.
  let responseText = "";
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    responseText = await page.locator("body").innerText().catch(() => "");
    // Strip the echoed user question to ensure we're seeing real assistant content.
    const withoutPrompt = responseText.replace(prompt, "");
    if (
      withoutPrompt.length > 400 &&
      (withoutPrompt.includes("##") || /\$[\d,]{3,}/.test(withoutPrompt))
    ) {
      break;
    }
    await page.waitForTimeout(1500);
  }

  console.log("=== CHAT PAGE CONTENT ===");
  console.log(responseText);
  console.log("=========================");

  // Hard fail if the response claims zero portfolio — that's the regression.
  expect(responseText.toLowerCase()).not.toMatch(
    /zero balance.*portfolio|portfolio.*zero balance|\$0\s*(balance|portfolio)/,
  );

  // Hard fail if the response asks the user to provide their balance manually.
  expect(responseText.toLowerCase()).not.toMatch(
    /please (provide|share|tell me).*your.*(portfolio|balance|total)/,
  );

  // Sanity: response should contain at least one dollar figure with a real number.
  expect(responseText).toMatch(/\$[\d,]{3,}/);
});
