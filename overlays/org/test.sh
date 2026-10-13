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
