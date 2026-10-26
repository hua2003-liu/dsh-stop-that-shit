'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const plugin = require('../index.cjs');

const CWD = 'C:/ws';

function mount() {
  const handlers = new Map();
  const skills = [];
  const commands = [];

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    sessions: {
      get(id) {
        return id === 'root' ? { id, header: { cwd: CWD } } : undefined;
      }
    },
    on(name, fn) {
      const list = handlers.get(name) || [];
      list.push(fn);
      handlers.set(name, list);
      return () => {};
    },
    inject(_services, callback) {
      callback(ctx);
      return () => {};
    },
    effect(fn) {
      const disposer = fn();
      return typeof disposer === 'function' ? disposer : () => {};
    },
    skills: {
      register(definition) {
        skills.push(definition);
        return () => {};
      }
    },
    commands: {
      register(definition) {
        commands.push(definition);
        return () => {};
      }
    }
  };

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-plugin-'));
  plugin.apply(ctx, { dataDir });

  return {
    skills,
    commands,
    dataDir,
    fire(name, ...args) {
      const list = handlers.get(name) || [];
      return list[0](...args);
    },
    preStep(text, sessionId = 'root') {
      return this.fire('agent/pre-step', {
        agent: { session: { id: sessionId, header: { cwd: CWD } } },
        messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }],
        turn: 1
      }, async () => ({ kind: 'enter', messages: [] }));
    },
    gate(toolName, args, sessionId = 'root') {
      return this.fire('tools/pre-execute', {
        name: toolName,
        arguments: args,
        callId: `call-${Math.random().toString(16).slice(2)}`,
        agent: { session: { id: sessionId, header: { cwd: CWD } } }
      }, async () => ({ kind: 'allow' }));
    }
  };
}

test('registers both skills and the /sts command', () => {
  const h = mount();
  assert.deepEqual(h.skills.map((s) => s.name).sort(), ['stop-that-shit', 'stss']);
  assert.ok(h.skills.every((s) => s.content.length > 200));
  assert.ok(h.skills.every((s) => !s.content.startsWith('---')));
  assert.equal(h.commands.length, 1);
  assert.equal(h.commands[0].name, 'sts');
});

test('unarmed sessions pass every tool call', async () => {
  const h = mount();
  assert.deepEqual(await h.gate('write', { file_path: `${CWD}/a.txt`, content: 'x' }), { kind: 'allow' });
  assert.deepEqual(await h.gate('pwsh', { command: 'npm install yaml' }), { kind: 'allow' });
});

test('review arms read-only and denies writes', async () => {
  const h = mount();
  const decision = await h.preStep('$stop-that-shit review -- inspect the readme');
  assert.equal(decision.kind, 'enter');
  assert.equal(decision.messages.at(-1).source.kind, 'stop-that-shit');

  const denied = await h.gate('write', { file_path: `${CWD}/a.txt`, content: 'x' });
  assert.equal(denied.kind, 'deny');
  assert.match(denied.reason, /MODE_FORBIDS_MUTATION/);

  assert.deepEqual(await h.gate('read', { file_path: `${CWD}/a.txt` }), { kind: 'allow' });
});

test('change honours the declared file boundary', async () => {
  const h = mount();
  await h.preStep('$stop-that-shit change files=src/** -- implement the parser');

  assert.deepEqual(await h.gate('write', { file_path: `${CWD}/src/ok.ts`, content: 'x' }), { kind: 'allow' });

  const outside = await h.gate('write', { file_path: `${CWD}/docs/x.md`, content: 'x' });
  assert.equal(outside.kind, 'deny');
  assert.match(outside.reason, /PATH_OUTSIDE_CONTRACT/);
});

test('dependency policy maps to deny, ask, and allow', async () => {
  const denied = mount();
  await denied.preStep('$stop-that-shit change deps=deny -- go');
  const deny = await denied.gate('pwsh', { command: 'npm install yaml' });
  assert.equal(deny.kind, 'deny');
  assert.match(deny.reason, /DEPENDENCY_NOT_AUTHORIZED/);

  const asked = mount();
  await asked.preStep('$stop-that-shit change deps=ask -- go');
  assert.equal((await asked.gate('pwsh', { command: 'npm install yaml' })).kind, 'ask');

  const allowed = mount();
  await allowed.preStep('$stop-that-shit change deps=allow -- go');
  assert.deepEqual(await allowed.gate('pwsh', { command: 'npm install yaml' }), { kind: 'allow' });
});

test('dependency authority is decided before the file boundary', async () => {
  const denied = mount();
  await denied.preStep('$stop-that-shit change files=src/** deps=deny -- go');
  const deny = await denied.gate('pwsh', { command: 'npm install yaml' });
  assert.equal(deny.kind, 'deny');
  assert.match(deny.reason, /DEPENDENCY_NOT_AUTHORIZED/);

  const asked = mount();
  await asked.preStep('$stop-that-shit change files=src/** deps=ask -- go');
  assert.equal((await asked.gate('pwsh', { command: 'npm install yaml' })).kind, 'ask');

  const allowed = mount();
  await allowed.preStep('$stop-that-shit change files=src/** deps=allow -- go');
  assert.deepEqual(await allowed.gate('pwsh', { command: 'npm install yaml' }), { kind: 'allow' });
});

test('hash policy maps to deny, ask, and allow', async () => {
  const denied = mount();
  await denied.preStep('$stop-that-shit change -- go');
  const deny = await denied.gate('edit', {
    file_path: `${CWD}/src/h.ts`,
    old_string: 'a',
    new_string: 'const h = createHash("sha256")'
  });
  assert.equal(deny.kind, 'deny');
  assert.match(deny.reason, /HASH_NOT_AUTHORIZED/);

  const asked = mount();
  await asked.preStep('$stop-that-shit change hash=ask -- go');
  assert.equal((await asked.gate('edit', {
    file_path: `${CWD}/src/h.ts`,
    old_string: 'a',
    new_string: 'const h = createHash("sha256")'
  })).kind, 'ask');

  const allowed = mount();
  await allowed.preStep('$stop-that-shit change hash=allow -- go');
  assert.deepEqual(await allowed.gate('edit', {
    file_path: `${CWD}/src/h.ts`,
    old_string: 'a',
    new_string: 'const h = createHash("sha256")'
  }), { kind: 'allow' });
});

test('delegation budget is enforced', async () => {
  const h = mount();
  await h.preStep('$stop-that-shit change agents=0 -- go');
  const denied = await h.gate('subagent', { description: 'check' });
  assert.equal(denied.kind, 'deny');
  assert.match(denied.reason, /AGENT_BUDGET_EXHAUSTED/);
});

test('/sts arms the same contract and forwards the task', async () => {
  const h = mount();
  const followups = [];
  const agent = {
    session: { id: 'root', header: { cwd: CWD } },
    followup(message) {
      followups.push(message);
    }
  };

  const result = await h.commands[0].handler({ agent, rawInput: ' review -- inspect the readme' });
  assert.equal(result.kind, 'success');
  assert.equal(followups.length, 1);
  assert.equal(followups[0].source.kind, 'user');
  assert.equal(followups[0].content[0].text, 'inspect the readme');
  assert.equal((await h.gate('write', { file_path: `${CWD}/a.txt`, content: 'x' })).kind, 'deny');
});

test('/sts status answers without sending a task', async () => {
  const h = mount();
  await h.preStep('$stop-that-shit change -- go');
  const followups = [];
  const result = await h.commands[0].handler({
    agent: { session: { id: 'root' }, followup: (m) => followups.push(m) },
    rawInput: ' status'
  });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /ARMED/);
  assert.equal(followups.length, 0);
});
