#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OVERLAYS_ROOT=${OVERLAYS_ROOT:-"$ROOT/overlays"}

found=0
for overlay_dir in "$OVERLAYS_ROOT"/*; do
  [[ -d "$overlay_dir" && -f "$overlay_dir/manifest.tsv" ]] || continue
  found=1
  echo "$(basename "$overlay_dir"):"
  count=0
  while IFS=$'\t' read -r action target _expected _payload; do
    [[ -n "$action" && "$action" != \#* ]] || continue
    printf '  %s %s\n' "$action" "$target"
    count=$((count + 1))
  done < "$overlay_dir/manifest.tsv"
  [[ $count -gt 0 ]] || echo "  (no deviations)"
done

[[ $found -eq 1 ]] || { echo "no overlay manifests found under $OVERLAYS_ROOT" >&2; exit 1; }
