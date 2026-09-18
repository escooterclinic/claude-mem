#!/usr/bin/env bash
set -euo pipefail
tree=$1
(cd "$tree" && npm run build)
