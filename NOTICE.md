# NOTICE

This repository is an **unofficial** DeepSeek Harness (DSH) adapter for
[Stop That Shit](https://github.com/lennney/stop-that-shit). It is not
affiliated with, endorsed by, or maintained by the upstream project.

## Upstream

- Project: Stop That Shit (别再造史了)
- Source: https://github.com/lennney/stop-that-shit
- Pinned commit: `e2660f4f1eb3fe3702b28f4c67f82496ac793626` (main, 2026-10-24)
- License: MIT, Copyright (c) 2026 Stop That Shit contributors
- Full text: `vendor/UPSTREAM-LICENSE`

## What is copied

- `vendor/*.cjs` — upstream `src/*.cjs`
- `vendor/adapters/*.cjs` — upstream `src/adapters/{dsh-hooks,dsh-tool-classifier,codex-tool-classifier,lifecycle-fields}.cjs`
- `skills/` — upstream `skills/stop-that-shit` and `skills/stss`

## What is new

- `index.cjs` — the DSH Host plugin: skills registration, `/sts` command,
  event wiring, root-lineage lookup, `ask` mapping.
- `cordis.patch.yml`, `locale/`, `icon.svg`, `test/`, `scripts/`.

## Local modification to upstream code

`vendor/decision.cjs` is patched in one place; see [VENDOR.md](VENDOR.md).
The patch moves dependency authority ahead of the file-boundary check so that
`deps=deny` / `deps=ask` / `deps=allow` stay observable under `files=...`.
