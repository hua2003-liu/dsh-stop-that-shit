# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-26

First release. The DSH half of Stop That Shit, vendored against upstream
`e2660f4`.

### Added

- Host plugin (`index.cjs`) that registers the `stop-that-shit` and `stss`
  skills, the `/sts` command, and the guard listeners for
  `agent/pre-step`, `tools/pre-execute`, `tools/post-execute`,
  `session/created|disposed`, and `subagent/start|end`.
- Root-lineage accounting: delegated calls are judged against the root
  session's contract, and an unresolvable root fails closed.
- `deps=` mapped onto DSH approvals: `deny` blocks, `ask` raises the host
  approval card, `allow` passes.
- Per-session contract state under `~/.dsh/stop-that-shit/sessions/` and a
  JSONL decision stream under `~/.dsh/stop-that-shit/runtime/`.
- Bundle patch (`cordis.patch.yml`) with `dataDir` and `runCodeBindingOnly`
  config, English and Chinese locale metadata, and an icon.
- Ten in-process assertions against a fake Cordis context plus the real
  vendored adapter (`npm test`), and a CI workflow on Node 22 and 24.

### Verified

End-to-end in a real DSH process (0.2.1-rc.3), not only in unit tests:

- `$stop-that-shit review -- …` denies a write with
  `MODE_FORBIDS_MUTATION`; the file is not created.
- `files=src/**` allows `src/x.ts` and denies `docs/y.md` with
  `PATH_OUTSIDE_CONTRACT`.
- `deps=deny` denies `npm install` with `DEPENDENCY_NOT_AUTHORIZED`.
- Both skills appear in a fresh session's skill catalog.
- Install from `github:hua2003-liu/dsh-stop-that-shit` composes the `sts`
  row and loads the plugin.

### Known limitations

- Not a security boundary; DSH's own sandbox owns isolation.
- `run_code` program bodies can write files directly; only nested `tools.*`
  calls are judged.
- Shell write targets (`mkdir`, `echo >`) can be reported as
  `WRITE_PATH_UNPROVEN` under a `files=` boundary.
- `ask` outcomes are recorded as denials in the audit stream.
- Hosts without an approval channel degrade `ask` to a denial.
