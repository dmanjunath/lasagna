# Lasagna — UX & Copy Guidelines

Principles for anything a user sees: labels, hints, captions, empty states, layout. Defaults, not laws — but deviating should be a deliberate decision you can justify.

## Every element must earn its place

Before rendering any text — label, hint, caption, placeholder, helper — ask: **what does this tell the user that they don't already know, or that changes a decision they're making?** If the answer is "nothing," or it would be equally true and equally useless in every state, cut it.

- Zero-information text is noise. Example: an open-ended amount field once showed "from $1" — technically true, tells the user nothing. It should show nothing.
- Empty is a valid state. Don't fill a slot just because it exists.

## Delete the thing, don't substitute for it

When you remove the reason for an element — a constraint, a mode, a bound — remove the element too. Don't backfill the slot with a plausible-looking replacement to keep it occupied. A range hint exists *because* there's a meaningful range; remove the range and the hint goes with it.

## Say each thing once

Don't show the same information twice on one screen. If a detailed breakdown already labels every item, a separate legend of the same items is redundant — drop one. Duplication makes the UI heavier and lets the two copies drift out of sync.

## Don't advertise what isn't built

No "coming soon" roadmaps, feature-gap lists, or internal model caveats in the product. Telling a user what the app can't do yet highlights gaps, sets expectations you may not meet, and does nothing for their current task. Ship the feature or say nothing. Genuine, load-bearing legal disclaimers belong in the dedicated disclaimer component, not sprinkled into body copy.

## Be direct, not clever

Name things plainly and accurately. Avoid marketing or cutesy phrasing ("Show the work", "Hide the work", "Supercharge your plan") and say what the thing is ("Year by year projection"). Accuracy comes first: a catchy label that is wrong (e.g. calling a deterministic projection a "backtest") is worse than a plain one, and it erodes trust. If you cannot name something accurately in a few words, that is a signal the thing itself is unclear.

## No em-dashes or en-dashes

Do not use em-dashes (—) or en-dashes (–) in copy. Use a comma, period, colon, or parentheses instead. (A lone dash standing in for an empty value in a table is a glyph, not punctuation, and is fine.)

## Equivalent things look and behave the same

If two variants of a control do the same job (e.g. two ways of showing a portfolio composition), give them the same treatment — same legend, layout, and affordances — unless a difference is functional (read-only vs editable). Gratuitous inconsistency reads as a bug.

## Verify the rendered result, not the diff

Judge UI by the pixels and the words as a user reads them, not by the code. Screenshot it, then actually read the copy and check the layout. A change that type-checks and "looks right in the diff" can still render noise, duplication, or drift. See CLAUDE.md → Visual Verification for how.
