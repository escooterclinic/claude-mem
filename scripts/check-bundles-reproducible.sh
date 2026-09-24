#!/usr/bin/env bash
# Rebuild HEAD from the committed bun.lock in a throwaway worktree and fail if the
# committed plugin/ bundles differ. escooterclinic fork only: upstream ignores the
# root lockfile, so its bundles carry whatever caret ranges resolved on the builder.
set -euo pipefail
repo=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/cm-repro-XXXXXX")
trap 'git -C "$repo" worktree remove --force "$tmp" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
git -C "$repo" worktree add -q --detach "$tmp" HEAD
cd "$tmp"
npm run build >"$tmp.build.log" 2>&1 || { tail -30 "$tmp.build.log"; echo "BUILD FAILED" >&2; exit 2; }
if git diff --quiet -- plugin/ && [ -z "$(git status --porcelain -- plugin/)" ]; then
  echo "BUNDLES-REPRODUCIBLE at $(git rev-parse --short HEAD)"
else
  git status --short -- plugin/ >&2
  echo "BUNDLES-DRIFT: committed plugin/ bundles differ from a frozen rebuild of HEAD" >&2
  exit 1
fi
