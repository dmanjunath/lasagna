---
name: ship-ota
description: Use when asked to push and ship Lasagna changes to users, including phrasings like "push and deploy", "deploy ota", "ship it", "publish the ota bundle", "send it to the app", "roll back the ota", or after a commit the user wants live on web, the API and installed iOS apps.
---

# Ship Lasagna: push, deploy, OTA

Gets a commit from the working tree to every surface: web (Cloudflare Pages), the
API (Cloud Run), and installed iOS apps (OTA web bundle). OTA.md is the full
runbook for OTA. This skill is the order of operations and the checks that prove
each step landed.

Never commit or push unless the user asked for it (CLAUDE.md). This skill runs
once they have.

## 0. Repo slugs

Never hard-code infra values (CLAUDE.md rule). Read the owner from the remote, and
always pass `-R`: `gh` resolves to the upstream remote by default and 404s.

```bash
OWNER=$(git remote get-url origin | sed -E 's#.*[:/]([^/]+)/[^/]+(\.git)?$#\1#')
APP="$OWNER/lasagna"; INFRA="$OWNER/lasagna-infra"
```

## 1. Before committing

- `pnpm -F @lasagna/web typecheck` and `cd packages/web && npx vitest run`.
  Includes `src/__tests__/design-lint.test.ts`. If a ratchet says "lower its
  allowance", lower it, don't raise it.
- API touched: `cd packages/api && npx tsc --noEmit -p . && npx vitest run src/lib`.
- Schema touched: a migration in `packages/core/drizzle/` must be in the commit.
- Scan the staged diff for real identifiers (uuids, emails, bucket or project
  names) before committing.
- Stage only the files you changed. `packages/landing/.astro/settings.json` and
  loose root scratch files are not yours. Leave them.

## 2. Push

SSH push fails inside the sandbox. Run it with the sandbox disabled, then confirm
the remote has the sha.

```bash
git fetch -q origin main && git push origin main
gh api repos/$APP/commits/main --jq .sha   # must equal git rev-parse HEAD
```

## 3. Wait for CI

`Tests` must succeed (the OTA gate needs it). `Build & Push` builds the API image
tagged with the full sha.

```bash
SHA=$(git rev-parse HEAD)
for i in $(seq 1 40); do
  out=$(gh run list -R $APP --commit $SHA --json name,status,conclusion \
    --jq '.[] | "\(.name)|\(.status)|\(.conclusion)"')
  [ -n "$out" ] && ! echo "$out" | grep -qv '|completed|' && break; sleep 15
done; echo "$out"
```

## 4. API (only if packages/api or packages/core changed)

A web-only commit needs no API deploy. Otherwise dispatch with the FULL 40-char
sha. `run_migrations=true` only if files under `packages/core/drizzle/` changed.

```bash
gh workflow run deploy-api.yml -R $INFRA -f image_tag=$SHA -f run_migrations=false
```

Watch it to completion, then check `/api/health` on the API and app hosts. The
hosts live in the infra repo and CLAUDE.md, so don't write them here.

## 5. Web

Cloudflare Pages builds `main` on push. There's nothing to dispatch. To verify,
the `/assets/index-*.js` name in the served HTML changes from the previous
deploy's. Poll for that rather than assuming.

## 6. OTA bundle for installed iOS apps

Ships anything in `packages/web/src` or `packages/web/public`. A change under
`packages/web/ios/` (plugins, Info.plist, Swift, assets) needs an App Store build.
The publish refuses across that native surface. Don't `force` past it unless you
are certain, because the bundle would boot and then fail when a missing plugin is
called.

A cron publishes `main` every 6 hours. To ship now, dispatch it:

```bash
gh workflow run publish-ota.yml -R $INFRA -f sha=$SHA
sleep 8
RID=$(gh run list -R $INFRA --workflow publish-ota.yml --limit 1 --json databaseId --jq '.[0].databaseId')
# wait for completed|success, then prove it went live:
gh run view $RID -R $INFRA --log | grep -E '==> Live:|Cron enabled|DISABLED|REFUSING'
```

Done means `==> Live: <sha> (<version>, min native <v>)` and `Published current
main. Cron enabled.`

- `REFUSING: working tree is dirty`: the script ran against a dirty tree. In CI
  this means the sha is wrong, so check you passed the pushed sha.
- Tests gate failure: wait for `Tests` on that sha, or fix it. Don't force.
- Devices pick the bundle up on their next launch or resume, and swap it in the
  next time the app is backgrounded. Settings shows `update <version> (<sha>)`.

## 7. Rolling back

- **Boots but misbehaves:** dispatch `publish-ota.yml` with the last good sha. It
  lands in seconds if that sha was built before. This DISABLES the cron, so no
  commit ships until you publish current `main` again. Tell the user that.
- **Fails to boot:** devices revert by themselves (`notifyAppReady` timeout). Still
  publish a good sha so new launches stop getting the bad one.
- **Bad native change:** can't be rolled back over the air. It needs an App Store
  build.

## 8. Report

One short message: the sha, what went live where (web bundle name, API revision
health, `==> Live:` line), what was skipped and why (no API deploy for a
web-only change, no migration), and anything left uncommitted.
