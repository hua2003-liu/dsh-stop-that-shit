# Vendored upstream

Pinned to `lennney/stop-that-shit` commit
`e2660f4f1eb3fe3702b28f4c67f82496ac793626` (2026-10-24, the merge that added the
DSH host adapter).

## Files

```
vendor/*.cjs                         upstream src/*.cjs
vendor/adapters/dsh-hooks.cjs        upstream src/adapters/dsh-hooks.cjs
vendor/adapters/dsh-tool-classifier.cjs
vendor/adapters/codex-tool-classifier.cjs
vendor/adapters/lifecycle-fields.cjs
skills/stop-that-shit/SKILL.md
skills/stss/SKILL.md
skills/stss/references/examples.md
```

The upstream adapter reaches into `../../src/...`. Copying those files next to
the plugin removes the checkout dependency, so the package can be installed by
DSH as a bundle.

## Local patch

`vendor/decision.cjs` — one reorder, no rule added:

- dependency authority (`DEPENDENCY_NOT_AUTHORIZED`) is evaluated **before** the
  file boundary (`WRITE_PATH_UNPROVEN` / `PATH_OUTSIDE_CONTRACT`);
- an authorized dependency action (`deps=allow`) is exempt from the
  proven-path requirement, because a package manager chooses its own write
  targets.

Why: with `files=...` armed, a package install has no proven target path, so the
old order returned `WRITE_PATH_UNPROVEN` for every `npm install`. That hid
`deps=deny` behind an approval and made `deps=allow` still ask. Upstream tracks
the same fix in PR #104 (unmerged at the pinned commit).

Everything else is byte-identical to upstream.

## Updating

```powershell
npm run update-vendor
```

Edit `COMMIT` in `scripts/update-vendor.mjs` first, then re-apply the
`decision.cjs` patch if it no longer applies, and run `npm test`.

Upstream tests are not run here: they depend on the full repository layout. The
plugin's own `test/plugin.test.cjs` drives the real vendored adapter through a
fake Cordis context.
