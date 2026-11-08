#!/usr/bin/env bash
set -euo pipefail
cd "$1"
bun test tests/context/context-builder-shared-store.test.ts
bun test tests/hooks/runtime-selector.test.ts tests/hooks/server-client.test.ts
bun test tests/hooks/server-runtime-strict.test.ts
bun test tests/cli/handlers/session-init-server-beta-context.test.ts tests/cli/handlers/context-server-mode.test.ts tests/cli/handlers/session-init-timeout.test.ts
bun test tests/utils/repo-identity.test.ts tests/cli/handlers/session-init-repo-identity.test.ts
bun test tests/hooks/file-context-server-runtime.test.ts
bun test tests/utils/writing-machine.test.ts
# Generation-job store suites (retry re-pin, missing-row guard). They need Postgres, and a
# gate that cannot run is not a skip: with no CLAUDE_MEM_TEST_POSTGRES_URL this run owns a
# throwaway cluster and removes it on exit; with no Postgres binaries at all it FAILS.
if [ -z "${CLAUDE_MEM_TEST_POSTGRES_URL:-}" ]; then
  pgbin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb /opt/homebrew/opt/postgresql@*/bin/initdb 2>/dev/null | tail -1)")
  [ -x "$pgbin/initdb" ] || { echo "FAIL: no Postgres to run the generation-job store suites" >&2; exit 1; }
  pgdir=$(mktemp -d); pgport=$((20000 + RANDOM % 20000))
  [ "$(id -u)" = 0 ] && chown nobody "$pgdir" && pgrun="runuser -u nobody --" || pgrun=""
  trap '$pgrun "$pgbin/pg_ctl" -D "$pgdir/db" -m immediate stop >/dev/null 2>&1; rm -rf "$pgdir"' EXIT
  $pgrun "$pgbin/initdb" -D "$pgdir/db" -U postgres --auth=trust >/dev/null
  $pgrun "$pgbin/pg_ctl" -D "$pgdir/db" -o "-p $pgport -k '' -c listen_addresses=127.0.0.1" -l "$pgdir/log" -w start >/dev/null
  export CLAUDE_MEM_TEST_POSTGRES_URL="postgresql://postgres@127.0.0.1:$pgport/postgres"
fi
bun test tests/server/runtime/retry-repins-generation-job-id.test.ts tests/server/runtime/jobs-list-and-operator-routes.test.ts tests/server/generation/provider-observation-generator.test.ts tests/server/runtime/terminal-failure-marks-row.test.ts
# The BUILT bundles are what clients run: a source change that never reaches them is no fix.
# Every client bundle that builds a ServerClient must carry the header (server-service.cjs is
# the server, not a client). Fails when no client bundle is found or any lacks the header.
header=X-Claude-Mem-Writing-Machine
checked=0
for f in plugin/scripts/*.cjs; do
  case "$(basename "$f")" in server-service.cjs|._*) continue ;; esac
  grep -q 'CLAUDE_MEM_SERVER_API_KEY' "$f" && grep -q 'Bearer' "$f" || continue
  grep -q "$header" "$f" || { echo "FAIL: built bundle $f lacks $header" >&2; exit 1; }
  checked=$((checked + 1))
done
[ "$checked" -gt 0 ] || { echo "FAIL: no built client bundle found to check for $header" >&2; exit 1; }
echo "writing-machine header present in $checked built client bundle(s)"
