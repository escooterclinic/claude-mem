#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OVERLAYS_ROOT=${OVERLAYS_ROOT:-"$ROOT/overlays"}

if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "usage: $0 <overlay> [upstream-tree] [output-tree]" >&2
  exit 64
fi

overlay=$1
source_tree=${2:-$ROOT}
output_tree=${3:-"$ROOT/.overlay-build/$overlay"}
overlay_dir="$OVERLAYS_ROOT/$overlay"
manifest="$overlay_dir/manifest.tsv"

[[ "$overlay" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "invalid overlay name: $overlay" >&2; exit 64; }
[[ -f "$manifest" ]] || { echo "overlay manifest not found: $manifest" >&2; exit 66; }
[[ -d "$source_tree" ]] || { echo "upstream tree not found: $source_tree" >&2; exit 66; }

python3 - "$source_tree" "$output_tree" "$overlay_dir" "$manifest" <<'PY'
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import shutil
import sys
import tempfile

source = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
overlay_dir = Path(sys.argv[3]).resolve()
manifest = Path(sys.argv[4]).resolve()

if output == source:
    die_message = f"output tree must differ from upstream tree: {output}"
    print(die_message, file=sys.stderr)
    raise SystemExit(1)
if output.is_relative_to(source) and output.parent != source / ".overlay-build":
    print(f"output inside upstream tree must be directly under {source / '.overlay-build'}", file=sys.stderr)
    raise SystemExit(1)

def die(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)

def safe_relative(raw: str, label: str) -> Path:
    path = Path(raw)
    if path.is_absolute() or raw == "" or ".." in path.parts:
        die(f"unsafe {label}: {raw}")
    return path

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

entries: list[tuple[str, Path, str, Path | None]] = []
for line_number, raw_line in enumerate(manifest.read_text().splitlines(), 1):
    if not raw_line or raw_line.startswith("#"):
        continue
    fields = raw_line.split("\t")
    if len(fields) != 4:
        die(f"invalid manifest line {line_number}: expected 4 tab-separated fields")
    action, raw_target, expected, raw_payload = fields
    if action not in {"add", "replace", "delete"}:
        die(f"invalid action on manifest line {line_number}: {action}")
    target = safe_relative(raw_target, "target path")
    payload = None if raw_payload == "-" else safe_relative(raw_payload, "payload path")
    if action == "add" and expected != "-":
        die(f"invalid add on manifest line {line_number}: expected hash must be -")
    if action == "delete" and payload is not None:
        die(f"invalid delete on manifest line {line_number}: payload must be -")
    if action in {"replace", "delete"} and len(expected) != 64:
        die(f"invalid {action} on manifest line {line_number}: expected sha256 is not 64 characters")
    entries.append((action, target, expected, payload))

for action, target, expected, payload in entries:
    base_file = source / target
    if not base_file.parent.resolve().is_relative_to(source):
        die(f"upstream target escapes its tree: {target}")
    if action == "add":
        if base_file.exists():
            die(f"upstream mismatch: {target} exists but overlay expects it absent")
    else:
        if base_file.is_symlink() or not base_file.is_file():
            die(f"upstream mismatch: {target} is missing")
        actual = digest(base_file)
        if actual != expected:
            die(f"upstream mismatch: {target} expected sha256 {expected}, got {actual}")
    if action != "delete":
        payload_file = overlay_dir / payload if payload is not None else None
        if payload_file is None or payload_file.is_symlink() or not payload_file.is_file():
            die(f"overlay payload is missing for {target}")
        if not payload_file.resolve().is_relative_to(overlay_dir):
            die(f"overlay payload escapes its overlay: {payload}")

output.parent.mkdir(parents=True, exist_ok=True)
temp = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
try:
    shutil.rmtree(temp)
    shutil.copytree(source, temp, ignore=shutil.ignore_patterns(".git", ".overlay-build", "overlays"))
    for action, target, _expected, payload in entries:
        destination = temp / target
        if action == "delete":
            destination.unlink()
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(overlay_dir / payload, destination)
    if output.exists():
        shutil.rmtree(output)
    os.replace(temp, output)
except BaseException:
    shutil.rmtree(temp, ignore_errors=True)
    raise
PY

if [[ "${OVERLAY_SKIP_BUILD:-0}" != 1 && -x "$overlay_dir/build.sh" ]]; then
  if ! "$overlay_dir/build.sh" "$output_tree"; then
    rm -rf "$output_tree"
    echo "overlay build failed; removed incomplete output: $output_tree" >&2
    exit 1
  fi
fi

echo "applied $overlay -> $output_tree"
