import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Re-vendor the upstream engine at a fixed commit.
// Change COMMIT, run `npm run update-vendor`, then review `git diff` and run
// `npm test`. The dependency-order patch in vendor/decision.cjs (see VENDOR.md)
// is NOT re-applied automatically.

const COMMIT = 'e2660f4f1eb3fe3702b28f4c67f82496ac793626'
const BASE = `https://raw.githubusercontent.com/lennney/stop-that-shit/${COMMIT}`

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const FILES = [
  ['src/contracts.cjs', 'vendor/contracts.cjs'],
  ['src/control-protocol.cjs', 'vendor/control-protocol.cjs'],
  ['src/controller.cjs', 'vendor/controller.cjs'],
  ['src/decision.cjs', 'vendor/decision.cjs'],
  ['src/delegation-state.cjs', 'vendor/delegation-state.cjs'],
  ['src/hash-intent.cjs', 'vendor/hash-intent.cjs'],
  ['src/hook-policy.cjs', 'vendor/hook-policy.cjs'],
  ['src/manifest-dependencies.cjs', 'vendor/manifest-dependencies.cjs'],
  ['src/runtime-annotations.cjs', 'vendor/runtime-annotations.cjs'],
  ['src/runtime-audit.cjs', 'vendor/runtime-audit.cjs'],
  ['src/runtime-storage.cjs', 'vendor/runtime-storage.cjs'],
  ['src/shell-analysis.cjs', 'vendor/shell-analysis.cjs'],
  ['src/state-schema.cjs', 'vendor/state-schema.cjs'],
  ['src/state.cjs', 'vendor/state.cjs'],
  ['src/adapters/dsh-hooks.cjs', 'vendor/adapters/dsh-hooks.cjs'],
  ['src/adapters/dsh-tool-classifier.cjs', 'vendor/adapters/dsh-tool-classifier.cjs'],
  ['src/adapters/codex-tool-classifier.cjs', 'vendor/adapters/codex-tool-classifier.cjs'],
  ['src/adapters/lifecycle-fields.cjs', 'vendor/adapters/lifecycle-fields.cjs'],
  ['skills/stop-that-shit/SKILL.md', 'skills/stop-that-shit/SKILL.md'],
  ['skills/stss/SKILL.md', 'skills/stss/SKILL.md'],
  ['skills/stss/references/examples.md', 'skills/stss/references/examples.md'],
  ['LICENSE', 'vendor/UPSTREAM-LICENSE']
]

for (const [remote, local] of FILES) {
  const target = path.join(ROOT, local)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const response = await fetch(`${BASE}/${remote}`)
  if (!response.ok) throw new Error(`${remote}: HTTP ${response.status}`)
  const text = await response.text()
  if (!text.length) throw new Error(`${remote}: empty response`)
  await fs.writeFile(target, text)
  console.log(`${String(text.length).padStart(7)}  ${local}`)
}

console.log(`\nVendored from ${COMMIT}.`)
console.log('Re-apply the dependency-order patch in vendor/decision.cjs if upstream changed it.')
