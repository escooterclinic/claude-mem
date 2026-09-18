#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file() {
  local path=$1 expected=$2
  [[ -f "$path" ]] || fail "missing file: $path"
  [[ $(cat "$path") == "$expected" ]] || fail "unexpected content in $path"
}

assert_absent() {
  [[ ! -e "$1" ]] || fail "cross-contaminated path exists: $1"
}

sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

mkdir -p "$TMP/base/config" "$TMP/fixture-overlays/org/files/config" "$TMP/fixture-overlays/th323/files/config"
printf 'shared\n' > "$TMP/base/config/runtime.txt"
printf 'untouched\n' > "$TMP/base/untouched.txt"

# Exercise the committed skeletons against the same base. They intentionally
# have no deviations yet. A fake npm proves both committed build hooks run
# without making this mechanism test perform the full product build twice.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/npm" <<'EOF'
#!/usr/bin/env bash
# EXIT EXPLICITLY, NEVER VIA `set -e` ON A BARE `[[ ]]`.
# MEASURED on bash 3.2.57 (the system bash on macOS): `set -e` does NOT fire for a
# compound `[[ ]]` command, so the stub sailed past a false condition and exited 0. The
# build-failure branch of apply.sh was then never reached, and a test that reported the
# guard as unproven here would have reported it as PROVEN on a bash 5 machine -- a guard
# whose proof depends on which shell ran it is not a proof.
set -uo pipefail
if [ "$*" != "run build" ]; then
  echo "stub npm: unexpected arguments: $*" >&2
  exit 64
fi
if [ "${NPM_FAIL:-0}" = 1 ]; then
  echo "stub npm: failing on purpose (NPM_FAIL=1)" >&2
  exit 1
fi
printf 'built\n' > .build-hook-ran
EOF
chmod +x "$TMP/bin/npm"
PATH="$TMP/bin:$PATH" "$ROOT/overlays/apply.sh" org "$TMP/base" "$TMP/real-org-result"
PATH="$TMP/bin:$PATH" "$ROOT/overlays/apply.sh" th323 "$TMP/base" "$TMP/real-th323-result"
assert_file "$TMP/real-org-result/config/runtime.txt" shared
assert_file "$TMP/real-th323-result/config/runtime.txt" shared
assert_file "$TMP/real-org-result/.build-hook-ran" built
assert_file "$TMP/real-th323-result/.build-hook-ran" built
assert_absent "$TMP/real-org-result/overlays"
assert_absent "$TMP/real-th323-result/overlays"

set +e
build_failure=$(NPM_FAIL=1 PATH="$TMP/bin:$PATH" "$ROOT/overlays/apply.sh" org "$TMP/base" "$TMP/build-failure-result" 2>&1)
build_failure_exit=$?
set -e
[[ $build_failure_exit -ne 0 ]] || fail "build hook failure did not propagate"
[[ "$build_failure" == *"overlay build failed"* ]] || fail "build hook failure was not explicit"
assert_absent "$TMP/build-failure-result"

printf 'org-only\n' > "$TMP/fixture-overlays/org/files/config/runtime.txt"
printf 'personal-only\n' > "$TMP/fixture-overlays/th323/files/config/runtime.txt"
printf 'org-added\n' > "$TMP/fixture-overlays/org/files/config/org-only.txt"
printf 'personal-added\n' > "$TMP/fixture-overlays/th323/files/config/personal-only.txt"

base_hash=$(sha256 "$TMP/base/config/runtime.txt")
cat > "$TMP/fixture-overlays/org/manifest.tsv" <<EOF
replace	config/runtime.txt	$base_hash	files/config/runtime.txt
add	config/org-only.txt	-	files/config/org-only.txt
EOF
cat > "$TMP/fixture-overlays/th323/manifest.tsv" <<EOF
replace	config/runtime.txt	$base_hash	files/config/runtime.txt
add	config/personal-only.txt	-	files/config/personal-only.txt
EOF

OVERLAYS_ROOT="$TMP/fixture-overlays" "$ROOT/overlays/apply.sh" org "$TMP/base" "$TMP/org-result"
OVERLAYS_ROOT="$TMP/fixture-overlays" "$ROOT/overlays/apply.sh" th323 "$TMP/base" "$TMP/th323-result"

assert_file "$TMP/org-result/config/runtime.txt" org-only
assert_file "$TMP/org-result/config/org-only.txt" org-added
assert_file "$TMP/org-result/untouched.txt" untouched
assert_absent "$TMP/org-result/config/personal-only.txt"

assert_file "$TMP/th323-result/config/runtime.txt" personal-only
assert_file "$TMP/th323-result/config/personal-only.txt" personal-added
assert_file "$TMP/th323-result/untouched.txt" untouched
assert_absent "$TMP/th323-result/config/org-only.txt"

# Re-applying replaces the result atomically and produces the same tree.
before=$(find "$TMP/org-result" -type f -print0 | sort -z | xargs -0 shasum -a 256)
OVERLAYS_ROOT="$TMP/fixture-overlays" "$ROOT/overlays/apply.sh" org "$TMP/base" "$TMP/org-result"
after=$(find "$TMP/org-result" -type f -print0 | sort -z | xargs -0 shasum -a 256)
[[ "$before" == "$after" ]] || fail "apply is not idempotent"

status=$(OVERLAYS_ROOT="$TMP/fixture-overlays" "$ROOT/overlays/status.sh")
[[ "$status" == *$'org:\n  replace config/runtime.txt\n  add config/org-only.txt'* ]] || fail "org status is incomplete"
[[ "$status" == *$'th323:\n  replace config/runtime.txt\n  add config/personal-only.txt'* ]] || fail "th323 status is incomplete"

# Mutating the upstream file must trip the hash guard before any result is produced.
printf 'upstream moved\n' > "$TMP/base/config/runtime.txt"
rm -rf "$TMP/guard-result"
set +e
guard_output=$(OVERLAYS_ROOT="$TMP/fixture-overlays" "$ROOT/overlays/apply.sh" org "$TMP/base" "$TMP/guard-result" 2>&1)
guard_exit=$?
set -e
[[ $guard_exit -ne 0 ]] || fail "upstream drift guard did not fail"
[[ "$guard_output" == *"upstream mismatch: config/runtime.txt"* ]] || fail "guard did not name the mismatched file"
assert_absent "$TMP/guard-result"

# An output may never be the source: replacement would otherwise delete it.
set +e
same_tree_output=$(OVERLAY_SKIP_BUILD=1 "$ROOT/overlays/apply.sh" org "$TMP/base" "$TMP/base" 2>&1)
same_tree_exit=$?
set -e
[[ $same_tree_exit -ne 0 ]] || fail "same-tree safety guard did not fail"
[[ "$same_tree_output" == *"output tree must differ from upstream tree"* ]] || fail "same-tree guard was not explicit"
assert_file "$TMP/base/config/runtime.txt" "upstream moved"

# Payloads must be owned by the overlay, not symlinks to external content.
mkdir -p "$TMP/symlink-overlays/org/files"
printf 'external\n' > "$TMP/external.txt"
ln -s "$TMP/external.txt" "$TMP/symlink-overlays/org/files/escaped.txt"
cat > "$TMP/symlink-overlays/org/manifest.tsv" <<EOF
add	config/escaped.txt	-	files/escaped.txt
EOF
set +e
symlink_output=$(OVERLAYS_ROOT="$TMP/symlink-overlays" "$ROOT/overlays/apply.sh" org "$TMP/base" "$TMP/symlink-result" 2>&1)
symlink_exit=$?
set -e
[[ $symlink_exit -ne 0 ]] || fail "payload symlink guard did not fail"
[[ "$symlink_output" == *"overlay payload is missing"* ]] || fail "payload symlink guard was not explicit"
assert_absent "$TMP/symlink-result"

echo "overlay tests passed"
