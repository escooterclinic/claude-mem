#!/usr/bin/env bash
# check-spawn-test-headroom.sh — every test that spawns a subprocess and relies on
# bun's 5s default timeout must finish with 5x headroom, or carry its own budget.
#
# WHY (measured). Subprocess-spawning tests go red under host load against bun's 5s
# default: the npm-pack test took 2.0s warm and 11.8s at load 101 (~6x). On
# 2026-09-24, running these files with the default cut to 1s at load ~50 timed out
# 26 tests that had no budget of their own; they now carry the suite's 30_000.
#
# HOW, BEHAVIOURALLY. The population is the test files that reference a spawn API;
# the VERDICT is measured, not grepped: they run with `--timeout 1000`. An explicit
# per-test budget overrides that flag, so only a test still riding bun's default can
# time out here — and one that does has less than 5x headroom under 5s. Other
# failures (assertions, environment) are left to the ordinary suite run.
#   exit 0  no spawning test relies on the default without headroom
#   exit 1  names each one; give it `}, 30_000);` (see tests/infrastructure/plugin-distribution.test.ts)
#   exit 2  could not run (no bun, no test files found)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
command -v bun >/dev/null || { echo "spawn-headroom: bun not on PATH — cannot measure"; exit 2; }
files=()
while IFS= read -r f; do files+=("$f"); done < <(
  grep -rlE 'Bun\.spawn|spawnSync|execSync|execFileSync|child_process|Bun\.\$' tests \
    | grep -E '\.test\.ts$' | sort)
[ "${#files[@]}" -gt 0 ] || { echo "spawn-headroom: found no spawning test files — refusing to pass blind"; exit 2; }
log="$(mktemp)"; trap 'rm -f "$log"' EXIT
bun test --timeout 1000 "${files[@]}" >"$log" 2>&1
# bun prints the `(fail) …` line, THEN its reason on the next line: `^ this test timed
# out after 1000ms.` for the body, `^ a beforeEach/afterEach hook timed out for this
# test.` for a hook. Hooks run under the DEFAULT, never the test's own budget — the
# singleton suite's reset() hook was the slow part there — so both count.
offenders="$(grep -B1 -E '^\s*\^ (this test timed out after 1000ms|a beforeEach/afterEach hook timed out)' "$log" | grep -E '^\(fail\)' | sed -E 's/ \[[0-9.]+ms\]$//' | sort -u)"
if [ -n "$offenders" ]; then
  echo "SPAWN-HEADROOM: FAIL — these spawning tests rely on bun's 5s default and ran past 1s (load $(uptime | sed 's/.*load averages*: //')):"
  printf '%s\n' "$offenders" | sed 's/^/  /'
  echo "Give each its own budget — the test, or the hook bun names — \`}, 30_000);\` with a comment naming what it spawns."
  exit 1
fi
echo "SPAWN-HEADROOM: OK — ${#files[@]} spawning test files, none relies on the default without 5x headroom"
