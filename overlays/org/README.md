# Org overlay

Org workstations use the shared server store. For effective `server` or legacy
`server-beta` runtime, `worker-service start` exits successfully without starting a
worker. Missing server settings produce a distinct `server-misconfigured` context;
hook handlers log the missing names and stop successfully. Server request failures
log their error class and HTTP status and stop successfully, without local fallback.
SessionEnd and advisor capture also refuse worker dispatch in misconfigured server
runtime. Unset and worker runtime retain upstream behaviour.

`manifest.tsv` declares SHA-pinned replacements against upstream v13.37.0. The
upstream runtime-selector test that expected missing API keys to select worker is
explicitly replaced with the org expectation. The upstream session-init timeout
test that expected a worker retry after server failure is likewise replaced; its
worker-runtime timeout coverage is retained.
`server-runtime-strict.test.ts` is an added test with isolated subprocesses and
worker/spawn tripwires, covering canonical/legacy startup, all missing settings,
HTTP and transport failures, no SQLite creation, and worker-mode dispatch.

- `file-context.ts` returns a no-op outside the worker runtime. Upstream calls the worker API
  from the PreToolUse:Read hook regardless of runtime, which lazy-spawns a local worker and
  creates claude-mem.db beside the shared store (measured 2026-10-06 on v13.29.0). Remove the
  row once upstream guards the handler (thedotmack/claude-mem#4558); `file-context-server-runtime.test.ts` covers it.
- Upstream PR thedotmack/claude-mem#4112 merged in v13.29.0. `test.sh` retains the
  upstream shared-store context regression test and runs the strict runtime suites.
- Generated bundles are rebuilt from source, never maintained as payloads.
- Deployment values are injected by the deploying repository, never stored here.

Rebased onto v13.35.0: all rows remain necessary; no rows were dropped. Upstream
worker spooling, lifecycle changes, and File Read Gate changes are retained beneath
the org runtime guards. Both replaced upstream test files are unchanged upstream,
so their org expectations remain unchanged. All added paths remain absent upstream. The strict runtime test now watches
the upstream spool dispatch as well as worker HTTP calls; worker/unset dispatch
expectations are retained.

The repo-identity alias fixture validates and warms its synthetic git/ssh scripts
before bounded discovery, avoiding first-execution delays on macOS. Its identity
expectation and hung-command timeout tests remain intact; production budgets are
unchanged.

Rebased onto v13.37.0 (2026-10-13). Five rows had moved upstream and were merged three-way
(observation, session-init, worker-service, server-client; upstream's server-event privacy,
env opt-out and transport-failure changes are kept beneath the org guards). `file-context.ts`
stays, narrowed: upstream #4576 (our #4558) now skips the lookup in `server` runtime, but not in
`server-misconfigured`, where it still lazy-spawns a worker beside the shared store; the row is
now a one-line widening of upstream's guard (`!== 'worker'`). Drop it when upstream does the same.

Writing machine (2026-10-13): `server-client.ts` spreads `writingMachineHeaders()`
(added `src/utils/writing-machine.ts`) into every request, so each bundle sends
`X-Claude-Mem-Writing-Machine: <~/.config/claude-policy/machine-id>` natively and
fails open. `test.sh` greps the BUILT `plugin/scripts/*.cjs` client bundles for the
header; claude-code-policy's cache patch classifies such a bundle as `native`.

Generation-job retry (2026-11-07). `POST /v1/jobs/:id/retry` republished the stored payload
verbatim, so a session_summary row whose `payload.generation_job_id` names an id discarded
`ON CONFLICT` (pre-`c5d52e5c4`) was re-queued pointing at nothing; the worker answered
`completed`, 0 observations, and the real row sat `queued` forever. `ServerV1PostgresRoutes.ts`
now re-pins `generation_job_id` to the row's own id in both the published and the persisted
payload (`retry-repins-generation-job-id.test.ts`). `ProviderObservationGenerator.ts` carries
escooterclinic/claude-mem `155f979fe`: a payload naming a missing row THROWS instead of reporting
success. Its test file is replaced to add that regression and to fix the harness (one pool per
test; load the mode), which was red at v13.37.0 on a stale `search_path`, not on any assertion.
`test.sh` runs these store suites against a throwaway Postgres it owns. Drop the routes row when
upstream re-pins on retry, and the generator rows when upstream ships the missing-row guard.

`advance.py --upstream-tag vX.Y.Z` publishes the overlay on a pinned upstream base (tag
`org/vX.Y.Z-overlay-<sha12>`), for a fix on the deployed version while the advance to newer
upstream is blocked in overlay-review. It never downgrades below the published version.
