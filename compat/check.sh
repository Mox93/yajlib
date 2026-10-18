#!/usr/bin/env bash
# Type-checks the BUILT declarations (dist/index.d.mts) against many TypeScript versions.
# skipLibCheck is off, so the .d.ts itself must parse and type-check on each version.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p lib
cp ../dist/index.d.mts lib/index.d.ts
bun install --silent

failed=0
printf "%-8s %s\n" "TS" "RESULT"
for dir in node_modules/ts*/; do
  ver=$(node "$dir/bin/tsc" --version | sed 's/Version //')
  if out=$(node "$dir/bin/tsc" -p tsconfig.json 2>&1); then
    printf "%-8s PASS\n" "$ver"
  else
    printf "%-8s FAIL\n%s\n" "$ver" "$(echo "$out" | head -3)"
    failed=1
  fi
done
exit $failed
