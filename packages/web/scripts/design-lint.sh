#!/bin/sh
# Runs the design lint (src/__tests__/design-lint.test.ts) when web UI source
# changed. Silent on a pass. On a failure it prints the problems to stderr and
# exits 2.
#
#   design-lint.sh --staged   files staged for commit (the git pre-commit hook)
#   design-lint.sh            files changed in the working tree (the Claude Stop hook)
set -u
root=$(git rev-parse --show-toplevel) || exit 0
cd "$root" || exit 0

if [ "${1:-}" = "--staged" ]; then
  changed=$(git diff --cached --name-only --diff-filter=ACMR)
else
  changed=$( (git diff --name-only HEAD; git ls-files --others --exclude-standard) 2>/dev/null)
fi
echo "$changed" | grep -qE '^packages/web/src/.*\.(tsx?|css)$' || exit 0

out=$(cd packages/web && NO_COLOR=1 npx vitest run src/__tests__/design-lint.test.ts 2>&1) && exit 0
echo "Design lint failed. Fix the code, or lower an allowance that the message names." >&2
# Each problem is one quoted line in the Received array: "path: n (allowed m). Fix".
problems=$(echo "$out" | sed -n 's/^+ *"\(.*\)",\{0,1\}$/  src\/\1/p')
[ -n "$problems" ] && echo "$problems" >&2 || echo "$out" | tail -30 >&2
exit 2
