# Org overlay

No deployment deviations are currently committed.

- Upstream PR thedotmack/claude-mem#4112 (session-start reads the shared store in server runtime) merged in v13.29.0, so its temporary entries were removed. `test.sh` still runs upstream's own `tests/context/context-builder-shared-store.test.ts` on every published tree, so a regression of that behaviour stops the publish.
- Generated bundles: regenerated from the source so they never become hand-maintained deviations.
- Deployment values: injected by the deploying repository and never stored here.
