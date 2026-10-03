# Overlay topology

This fork tracks `thedotmack/claude-mem` with the `upstream` remote. Its normal product tree is the shared base. Two manifests describe the complete local delta applied to that base:

```text
upstream product -> shared fork base -> org deployment tree
                                     -> th323 deployment tree
```

The deployment trees contain product files only. `apply.sh` omits `.git`, `.overlay-build`, and the overlay machinery itself when it copies the base.

## Apply an overlay

From a clean shared-base checkout:

```bash
overlays/apply.sh org
overlays/apply.sh th323
```

The default outputs are `.overlay-build/org` and `.overlay-build/th323`. Explicit source and output paths are also supported:

```bash
overlays/apply.sh org /path/to/clean/base /path/to/result
```

The output must differ from the source. An output nested inside the source is accepted only directly below `.overlay-build/`, which the copy step excludes. Low-level tests may set `OVERLAY_SKIP_BUILD=1`; the acceptance test exercises both committed build hooks with a stub `npm`, and deployment uses the default real build behavior.

Each manifest line has four tab-separated fields:

```text
action  upstream-path  expected-upstream-sha256  overlay-payload-path
```

Actions are `add`, `replace`, and `delete`. An `add` uses `-` for the expected hash; a `delete` uses `-` for its payload. Replacement payloads live below the relevant overlay's `files/` directory. Before copying anything, the apply step verifies every replaced or deleted source file against its recorded SHA-256 and verifies that every added path is absent. Any upstream movement fails the whole operation before an output is created. Re-running replaces the output atomically, so the operation is idempotent.

`overlays/status.sh` prints the action and upstream path for every deviation. The manifest is the reviewable inventory; payload diffs show the content.

## Generated bundles

Generated bundles do not belong in a manifest. The earlier `estate/dist` branch demonstrated why: source and shipped bundles can diverge. Each overlay's `build.sh` installs dependencies with the upstream Bun toolchain (`bun install`) and runs the product's existing `npm run build` after source files are applied, so generated files come from the same overlaid source on every application. Generated files are never edited or copied into an overlay.

## Advance the shared base

1. Fetch `upstream` and fast-forward or rebase the shared base onto the chosen upstream commit.
2. Run `overlays/status.sh` to review the declared local delta.
3. Run `bash overlays/test-overlays.sh`.
4. Apply both overlays. A hash failure identifies each upstream file that must be reviewed.
5. For each failed entry, compare the new upstream file with the overlay payload. Update the payload if still needed, then record the new upstream SHA-256 in the manifest. Remove the entry if upstream now provides the behavior.
6. Build and test both produced trees before deployment.

## Decide where a change belongs

- A product correction useful to upstream users goes to an upstream branch and pull request. A deployment may carry a pending fix as a temporary overlay, with its PR and removal condition recorded in the overlay README. Upstream PR #4112, the org overlay's last such fix, merged in v13.29.0 and its entries were removed.
- A policy or behavior specific to one deployment goes only in that deployment's manifest and payload tree, with a one-line reason in its README.
- A deviation shared by both deployments is still a product change candidate. Send a generic change upstream. If upstream would reject it because it expresses local policy, declare it independently in both overlays so each deployment's complete delta remains visible.
- Deployment values and secrets belong to the deploying repository. They are injected after this source/build step and never committed here.

## Add another overlay

1. Create `overlays/<name>/manifest.tsv`, `README.md`, and `build.sh` using an existing skeleton.
2. Put only source payloads under `overlays/<name>/files/`.
3. Add manifest lines with hashes from the current shared base.
4. Extend `test-overlays.sh` with a distinct marker and assertions that it appears only in the new result.
5. Run `bash overlays/test-overlays.sh` and review `overlays/status.sh`.
