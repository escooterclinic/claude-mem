#!/usr/bin/env bash
set -euo pipefail
tree=$1
(cd "$tree" && bun install && npm run build)
