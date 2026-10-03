#!/usr/bin/env bash
set -euo pipefail
cd "$1"
bun test tests/context/context-builder-shared-store.test.ts
bun test tests/hooks/runtime-selector.test.ts tests/hooks/server-client.test.ts
bun test tests/hooks/server-runtime-strict.test.ts
bun test tests/cli/handlers/session-init-server-beta-context.test.ts tests/cli/handlers/context-server-mode.test.ts tests/cli/handlers/session-init-timeout.test.ts
bun test tests/utils/repo-identity.test.ts tests/cli/handlers/session-init-repo-identity.test.ts
