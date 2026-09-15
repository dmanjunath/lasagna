# Recorded model responses

These files let local development drive the whole app without spending a cent at
a provider, and get the same answer every time.

They exist because $44 of provider spend in 48 hours came from local testing,
and 92% of it bought a response nobody could use. Dev spend was invisible and
unbounded. With `LLM_FIXTURES=replay` — the default in `docker-compose.yml` — it
is zero.

## The rule

> **A fixture is what the real model returned when it was given exactly the
> prompt the app sends. Nothing else is a fixture.**

Not hand-written. Not written by an assistant that also knows this codebase, the
conversation it is in, or what a test is hoping to see.

This is the whole point, so it is worth being blunt about why. A response
authored with that extra context is unrepresentatively good: it parses on the
first try, it fills every field, it never rambles past the token cap. The real
model does all of those things, constantly — the insights path had been
returning truncated JSON and empty strings for weeks. A test that passes against
a polished hand-written response proves nothing about production. It proves that
someone can write JSON.

**So: never edit a file in this directory to make a test pass.** If a fixture is
wrong, the recording is stale — re-record it. If the app cannot handle what the
model really said, that is a bug in the app, and the fixture just found it.

There is no exception for "it is only slightly different" or "the model would
obviously say this". If a response in here was not returned by a provider, the
directory is no longer evidence of anything.

## How to record one

Recording makes a real, billed call. It is the only mode that spends money, so
it prints what each call cost.

```bash
# Seeded or synthetic tenants ONLY. Never a real household.
LLM_FIXTURES=record pnpm -F @lasagna/api record:llm -- \
  --source insights --tenant <seeded-tenant-id>
```

The script drives the app's own generation path, so the prompt is genuinely the
one the app builds. Do not compose a prompt by hand and record that: the point
of a fixture is that the model saw what the app sends.

`LLM_FIXTURES=replay` runs the same script as a **free dry run**: it builds the
real prompts, then misses, and names exactly what is missing. Worth doing before
you spend.

Recording never re-buys a prompt it already has on disk, so re-running after one
call in a multi-step agent loop failed does not pay for the earlier steps again.
To genuinely re-record one, delete the file first.

To capture a surface the script does not cover, run the API with
`LLM_FIXTURES=record` and use the feature. Every call through `lib/llm.ts` is
captured on the way past.

## How a fixture is found

The filename is a SHA-256 of everything that would change what the real model
answers:

- the **model slug** (`~anthropic/claude-sonnet-latest`, …)
- the system prompt
- the prompt / messages
- the tool names offered, and `toolChoice`
- `temperature` and `maxOutputTokens`
- for structured-output calls, the JSON Schema shape of the output schema

Same prompt and same model, same fixture. Change the model or edit a prompt and
you get a **miss** — which is correct: the stored response is one the new prompt
never produced, and serving it would be a lie. The miss throws, names the key,
and prints the command to record a fresh one. It never quietly falls back to the
network, and never quietly returns an empty response.

Because tool results are part of the next turn's messages, a multi-turn chat
fixture is tied to the tenant whose data went into it. Replay chat against the
tenant it was recorded from.

## Why these can live in a public repo

Capture happens at the **provider boundary** inside `lib/llm.ts`: the request
has already been through `pii-scrubber`, and the response has not yet been
descrubbed. So a fixture holds aliases (`Account 1`, `Person A`) and never a
real name, balance-bearing account title, or address.

That is enforced, not hoped for. Before anything is written, `assertRecordable`
in `lib/llm-fixtures.ts` refuses the recording if either check fails.

**The request is re-scrubbed.** Scrubbing is idempotent, so scrubbing an
already-scrubbed payload must change nothing. If it changes something, the first
pass missed it and the model was about to be shown a real name. Asking the
scrubber rather than re-implementing its matching is deliberate: it matches
whole words, so a 4-digit account mask that turns up by chance inside a
simulation figure is correctly not a hit, and a naive substring check here would
reject every honest recording.

**The file is scanned** for anything shaped like an email address, and for a run
of 9 or more digits that could be an account or routing number.

The response is deliberately *not* checked against the alias map. An account
named "Roth IRA" or "Credit Card" is also ordinary financial vocabulary: the
request correctly carried the alias, and the model then wrote the generic term
on its own, about nobody. (Both of these were found by real recordings, not
invented.)

A refusal is a scrubber bug. Fix `lib/pii-scrubber.ts`; do not delete the check.

On top of that: **record against seeded or synthetic tenants only.** `pnpm
db:seed` makes one. Never record against real household data, even though the
scrubber should handle it.

## Modes

| `LLM_FIXTURES` | What happens | Where it is the default |
| --- | --- | --- |
| `off` | Real provider call. Costs money. | Everywhere except local dev. The only mode production may run. |
| `record` | Real provider call, saved here, price printed. | Never a default. Ask for it explicitly. |
| `replay` | Served from this directory. Never hits the network. | Local development, via `docker-compose.yml`. |

Production is asserted: `record` or `replay` with `APP_ENV=production` throws
rather than serving a canned answer to a real household.

## Layout

```
fixtures/llm/<source>/<key>.json
```

`<source>` is the surface that made the call (`insights`, `chat`, `chat-title`,
…). Each file carries the model slug, when it was recorded, a prompt excerpt so
the directory can be skimmed, the provider's response, and the usage and cost it
reported — replay returns all of it, so cost accounting and usage logging run
exactly as they do against the real provider.

One consequence worth knowing: a replayed call still writes an `activity_events`
row, carrying the tokens and dollars of the **original** recording. That is
deliberate, and it is what keeps `logLlmUsage` and the cost path genuinely
exercised. It does mean local spend dashboards show what the recording cost once,
not what this run cost, which is nothing.

## A call that failed is recorded too

A provider error is billed exactly like a successful call, and on the insights
path it is a routine outcome rather than a rare one: the model spends its whole
output budget reasoning and returns nothing, so `generateObject` throws. One
such call, recorded live while this layer was being built, billed **$0.13 for
153 seconds and produced nothing**.

If failures were not captured, the single most expensive surface in the app
would have no fixture at all and would re-bill on every local page load, which
is the exact loop this exists to break. So a fixture may carry an `error` field
instead of a response, and replay re-throws an equivalent error. The failure
branch downstream then runs for free.

The cost is that a *transient* failure (a rate limit, an upstream blip) gets
baked in as if it were what the prompt does. If you believe a recorded error was
transient, delete the file and record again.

## What is here now

| Source | What it captures |
| --- | --- |
| `insights` | One structured-output call on Sonnet returning 7 insights. It billed $0.1381 and took 132 seconds. Replayed, it is 0.3 seconds and free. |
| `chat` | A full three-round agent loop. Rounds 1 and 2 return tool calls, round 3 writes the 3,554-character answer. |
| `chat-title` | The thread title generated after a first message. |

Driving `/api/insights/generate` and `/api/chat` end to end against the seeded
tenant these were recorded from costs nothing and makes no network call.
