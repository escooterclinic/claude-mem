#!/usr/bin/env bash
# tests/run.sh — this fork's gate suite, run ON THE GATE RUNNER by verify.sh.
#
# WHY HERE AND NOT IN GITHUB ACTIONS. Actions are OFF across the org by decision and stay
# off (operator, 2026-09-24). The reproducibility step added to .github/workflows/ci.yml in
# #9 therefore never ran once — all 8 workflows `active`, 0 runs ever — so the only live
# pin on the committed bundles was the `prebuild` frozen install. This script is where
# those checks actually run: the pre-push hook submits verify.sh to the runner.
#
# THE RUNNER GETS TRACKED FILES ONLY (no node_modules, no dist/), so this provisions
# from the committed bun.lock first and builds before the suite that reads dist/.
#   exit 0 all green · 1 a check failed · 2 could not provision
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
rc=0
bun install --frozen-lockfile || { echo "run.sh: bun install --frozen-lockfile failed"; exit 2; }
# Committed plugin/ bundles == a frozen rebuild of HEAD (throwaway worktree; see the script).
bash scripts/check-bundles-reproducible.sh || rc=1
# In place, for dist/ — tests/infrastructure/plugin-distribution.test.ts packs it.
npm run build >/dev/null 2>&1 || { echo "run.sh: npm run build failed"; rc=1; }
bun test tests || rc=1
# Every subprocess-spawning test that rides bun's 5s default has 5x headroom.
bash scripts/check-spawn-test-headroom.sh || rc=1
exit $rc
