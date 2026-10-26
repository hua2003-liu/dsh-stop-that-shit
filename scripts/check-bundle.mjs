#!/usr/bin/env node
/**
 * Validate this bundle's manifest and display resources without installing it.
 *
 * Checks the things a user or the plugin manager would otherwise only discover
 * after an install: the declared patch exists and parses as a Loader patch
 * list, the runtime entry is exported, and every advertised locale/icon file
 * is present and non-empty.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = [];
const fail = (message) => problems.push(message);

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (!manifest.name) fail('package.json: missing name');
if (!manifest.version) fail('package.json: missing version');
if (!manifest.engines?.dsh) fail('package.json: missing engines.dsh');
if (manifest.type !== 'commonjs' && manifest.type !== 'module') {
  fail('package.json: type must be "commonjs" or "module"');
}

const patchPath = manifest.dsh?.bundle?.patch;
if (!patchPath) {
  fail('package.json: missing dsh.bundle.patch');
} else {
  const absolute = join(root, patchPath);
  if (!existsSync(absolute)) {
    fail(`package.json: dsh.bundle.patch points at a missing file (${patchPath})`);
  } else {
    const text = readFileSync(absolute, 'utf8');
    if (!/^\s*-\s*insert:/m.test(text)) fail(`${patchPath}: no "insert:" entry`);
    if (!/^\s{4}-\s*id:/m.test(text)) fail(`${patchPath}: inserted row has no id`);
    if (!/^\s{6}name:/m.test(text)) fail(`${patchPath}: inserted row has no name`);
  }
}

const entry = manifest.main ?? manifest.exports?.['.'];
if (!entry) {
  fail('package.json: no runtime entry (main or exports["."])');
} else if (!existsSync(join(root, typeof entry === 'string' ? entry : Object.values(entry)[0]))) {
  fail(`package.json: runtime entry does not exist (${entry})`);
}

let localized = 0;
for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
  if (!subpath.startsWith('./locale/')) continue;
  // A wildcard export such as "./locale/*.json" covers several files; expand it
  // against the directory it names so each advertised locale is still verified.
  const targets = target.includes('*')
    ? readdirSync(dirname(join(root, target)))
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(dirname(target), name).replaceAll('\\', '/'))
    : [target];
  for (const file of targets) {
    localized += 1;
    const absolute = join(root, file);
    if (!existsSync(absolute)) {
      fail(`package.json: exported locale file is missing (${file})`);
      continue;
    }
    const parsed = JSON.parse(readFileSync(absolute, 'utf8'));
    if (!parsed.meta?.title) fail(`${file}: missing meta.title`);
    if (!parsed.meta?.description) fail(`${file}: missing meta.description`);
  }
}
if (localized === 0) fail('package.json: no locale files exported');

const iconExport = manifest.exports?.['./icon'] ?? manifest.icon;
if (!iconExport) {
  fail('package.json: no icon exported (exports["./icon"] or icon)');
} else {
  const file = join(root, iconExport);
  if (!existsSync(file)) fail(`package.json: icon is missing (${iconExport})`);
  else if (readFileSync(file).length === 0) fail(`package.json: icon is empty (${iconExport})`);
}

const listed = manifest.files ?? [];
for (const required of ['index.cjs', 'cordis.patch.yml', 'icon.svg']) {
  if (!listed.includes(required)) fail(`package.json: "files" does not list ${required}`);
}

if (problems.length > 0) {
  console.error(`bundle check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`bundle check ok: ${manifest.name}@${manifest.version}`);
