#!/usr/bin/env bash
set -euo pipefail
cd "$1"
bun test tests/context/context-builder-shared-store.test.ts
