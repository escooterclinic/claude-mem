#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# Exercise aliased temporary roots on Linux too (macOS /var is a symlink).
mkdir "$TMP/real-temp"
ln -s "$TMP/real-temp" "$TMP/linked-temp"
export TMPDIR="$TMP/linked-temp"
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.invalid
mkdir -p "$TMP/bin" "$TMP/hooks/org/files" "$TMP/source"
ln -s "$BASH" "$TMP/bin/bash"
export OVERLAYS_ROOT="$TMP/hooks"
export PATH="$TMP/bin:$PATH"
cat > "$TMP/bin/bun" <<'EOF'
#!/usr/bin/env bash
if [ "$*" != install ]; then exit 64; fi
mkdir -p node_modules
printf 'dependency\n' > node_modules/unshipped
exit 0
EOF
cat > "$TMP/bin/npm" <<'EOF'
#!/usr/bin/env bash
if [ "$*" != 'run build' ]; then exit 64; fi
if [ "${NPM_FAIL:-0}" = 1 ]; then exit 1; fi
mkdir -p plugin/scripts
printf 'generated bundle\n' > plugin/scripts/worker-service.cjs
exit 0
EOF
cat > "$TMP/hooks/org/build.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$1"
bun install
npm run build
EOF
cat > "$TMP/hooks/org/test.sh" <<'EOF'
#!/usr/bin/env bash
if [ "${TEST_FAIL:-0}" = 1 ]; then exit 1; fi
if [ ! -f "$1/plugin/scripts/worker-service.cjs" ]; then exit 1; fi
exit 0
EOF
chmod +x "$TMP/bin/bun" "$TMP/bin/npm" "$TMP/hooks/org/"*.sh
git init -q "$TMP/source"
git init -q --bare "$TMP/upstream.git"
git init -q --bare "$TMP/publish.git"
mkdir -p "$TMP/source/plugin/.claude-plugin" "$TMP/source/.claude-plugin"
printf '{"name":"fixture","plugins":[{"name":"fixture","source":"./plugin"}]}\n' > "$TMP/source/.claude-plugin/marketplace.json"
printf 'plugin/scripts/\nnode_modules/\n' > "$TMP/source/.gitignore"
printf 'base\n' > "$TMP/source/target"
printf 'overlay\n' > "$TMP/hooks/org/files/target"
hash=$(shasum -a 256 "$TMP/source/target" | awk '{print $1}')
printf 'replace\ttarget\t%s\tfiles/target\n' "$hash" > "$TMP/hooks/org/manifest.tsv"
release() {
  printf '{"version":"%s"}\n' "$1" > "$TMP/source/plugin/.claude-plugin/plugin.json"
  git -C "$TMP/source" add .
  git -C "$TMP/source" commit -qm "Release $1"
  git -C "$TMP/source" tag "v$1"
  git -C "$TMP/source" push -q "$TMP/upstream.git" HEAD:main --tags
}
refs() { git --git-dir="$TMP/publish.git" show-ref 2>/dev/null || true; }
advance() {
  local expected=$1 actual=0
  shift
  bash "$ROOT/overlays/advance.sh" org --upstream-url "$TMP/upstream.git" \
    --publish-url "$TMP/publish.git" --publish-branch deployment --status-file "$TMP/status.json" "$@" > "$TMP/output" 2>&1 || actual=$?
  if [ "$actual" != "$expected" ]; then cat "$TMP/output"; echo "expected $expected, got $actual" >&2; exit 1; fi
}
status() {
  python3 - "$TMP/status.json" "$1" "$2" <<'PY'
import json, sys
value = json.load(open(sys.argv[1]))
assert value[sys.argv[2]] == json.loads(sys.argv[3]), value
assert set(value) == {'deployment','upstream_latest','published','releases_behind','ok','stage','error','files_needing_review','at'}
assert value['at'].endswith('Z')
PY
}
unchanged() { [ "$(refs)" = "$before" ] || { echo 'remote unexpectedly changed' >&2; exit 1; }; }
release 1.0.0
advance 0
status stage '"published"'
status published '"1.0.0"'
status ok true
[ "$(git --git-dir="$TMP/publish.git" rev-parse refs/tags/org/v1.0.0)" = "$(git --git-dir="$TMP/publish.git" rev-parse deployment)" ]
[ "$(git --git-dir="$TMP/publish.git" show deployment:target)" = overlay ]
manifest_hash=$(shasum -a 256 "$TMP/hooks/org/manifest.tsv" | awk '{print $1}')
[ "$(git --git-dir="$TMP/publish.git" log -1 --format=%s deployment)" = "Deploy org from upstream v1.0.0; manifest sha256 $manifest_hash" ]
git --git-dir="$TMP/publish.git" show deployment:plugin/scripts/worker-service.cjs | grep -q 'generated bundle'
if git --git-dir="$TMP/publish.git" ls-tree -r --name-only deployment | grep -E '(^|/)(node_modules|\.git|\.overlay-build)(/|$)'; then exit 1; fi
before=$(refs)
advance 3
status stage '"up-to-date"'
status releases_behind 0
unchanged
# An overlay change on the SAME upstream version republishes under a revision tag
# (2026-10-03: a merged org overlay change sat unpublished as "up-to-date").
printf '# overlay revision\n' >> "$TMP/hooks/org/manifest.tsv"
advance 0
status stage '"published"'
new_hash=$(shasum -a 256 "$TMP/hooks/org/manifest.tsv" | awk '{print $1}')
[ "$(git --git-dir="$TMP/publish.git" log -1 --format=%s deployment)" = "Deploy org from upstream v1.0.0; manifest sha256 $new_hash" ]
[ "$(git --git-dir="$TMP/publish.git" rev-parse "refs/tags/org/v1.0.0-overlay-${new_hash:0:12}")" = "$(git --git-dir="$TMP/publish.git" rev-parse deployment)" ]
before=$(refs)
advance 3
status stage '"up-to-date"'
unchanged
release 1.1.0
release 1.2.0
# Prereleases never displace the highest stable tag.
git -C "$TMP/source" tag v99.0.0-rc.1
git -C "$TMP/source" push -q "$TMP/upstream.git" --tags
advance 0 --dry-run
status stage '"dry-run"'
status releases_behind 2
status upstream_latest '"v1.2.0"'
unchanged
NPM_FAIL=1 advance 1
status stage '"build"'
status ok false
unchanged
TEST_FAIL=1 advance 1
status stage '"test"'
unchanged
# Multiple mismatches are all reported before building.
printf 'second\n' > "$TMP/hooks/org/files/second"
printf 'add\tsecond\t-\tfiles/second\n' >> "$TMP/hooks/org/manifest.tsv"
printf 'moved\n' > "$TMP/source/target"
printf 'upstream owns it\n' > "$TMP/source/second"
release 1.3.0
advance 2
status stage '"overlay-review"'
status files_needing_review '["target", "second"]'
unchanged
# Correct review allows exactly one commit on the prior deployment tip.
hash=$(shasum -a 256 "$TMP/source/target" | awk '{print $1}')
printf 'replace\ttarget\t%s\tfiles/target\n' "$hash" > "$TMP/hooks/org/manifest.tsv"
old_tip=$(git --git-dir="$TMP/publish.git" rev-parse deployment)
advance 0
new_parent=$(git --git-dir="$TMP/publish.git" rev-parse deployment^)
[ "$old_tip" = "$new_parent" ] || exit 1
status published '"1.3.0"'
# A conflicting release tag must leave the branch unchanged (atomic push).
release 1.4.0
git --git-dir="$TMP/publish.git" tag org/v1.4.0 "$old_tip"
before=$(refs)
advance 1
status stage '"publish"'
unchanged
echo 'advance tests passed'
