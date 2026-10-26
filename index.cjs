'use strict';

/**
 * stop-that-shit-dsh — DeepSeek Harness Host plugin.
 *
 * This is the DSH half of Stop That Shit: the judgment lives in the vendored
 * adapter (vendor/), this file owns everything DSH-specific.
 *
 *   ctx.skills    registers `stop-that-shit` and `stss` so the model receives
 *                 them in its skill catalog instead of reading a global skills dir
 *   ctx.commands  registers `/sts <mode> [flags] -- <task>` so a contract can be
 *                 armed without putting a `$stop-that-shit` line in the prompt
 *   agent/pre-step     arms the contract from verified user text and folds the
 *                      contract summary into the admitted messages
 *   tools/pre-execute  returns deny / ask / pass for each tool call
 *   tools/post-execute observes the settled result and updates delegation state
 *   session/*          lifecycle bookkeeping
 *   subagent/*         delegation ledger
 *
 * Nothing here is a security boundary. The DSH fs sandbox owns isolation; this
 * plugin is an advisory task-boundary guard, exactly like the other adapters.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
  applyDshDecision,
  fromNativeEvent,
  handleDshHook,
  resolveRootLineage,
  toControlEvent
} = require('./vendor/adapters/dsh-hooks.cjs');
const { handleControlEvent } = require('./vendor/controller.cjs');
const { setRunCodeBindingOnly } = require('./vendor/adapters/dsh-tool-classifier.cjs');

/** Source tag for context this plugin folds into the model's history. */
const SOURCE = { kind: 'stop-that-shit' };

const ROOT = __dirname;

const SKILLS = [
  { name: 'stop-that-shit', file: 'skills/stop-that-shit/SKILL.md' },
  { name: 'stss', file: 'skills/stss/SKILL.md' }
];

/** Split one SKILL.md into its YAML frontmatter and the body DSH wants. */
function readSkill(relative) {
  const raw = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  return {
    front: match ? match[1] : '',
    content: match ? raw.slice(match[0].length) : raw
  };
}

function frontField(front, key) {
  const line = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(front);
  return line ? line[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

/** A real user message: source.kind === 'user' is what the adapter trusts. */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: String(text) }]
  };
}

/** A context message: user role, but never mistaken for human input. */
function contextMessage(text) {
  return Object.freeze({
    ...userMessage(text),
    source: SOURCE
  });
}

function plugin(ctx, config = {}) {
  const dataDir = typeof config.dataDir === 'string' && config.dataDir.trim()
    ? config.dataDir.trim()
    : path.join(os.homedir(), '.dsh', 'stop-that-shit');
  const options = { dataDir };

  // `run_code` is the PTC transport: a bare async function with full Node
  // globals. Only assert binding-only when the deployment can prove it.
  setRunCodeBindingOnly(config.runCodeBindingOnly === true);
  ctx.effect(() => () => setRunCodeBindingOnly(false));

  // ---- session lookup -----------------------------------------------------

  function getSessionById(sessionId) {
    const store = ctx.sessions;
    if (!store || typeof store.get !== 'function') return null;
    let session;
    try {
      session = store.get(sessionId);
    } catch {
      return null;
    }
    if (!session) return null;
    return { id: session.id, header: session.header };
  }

  /**
   * Root session for a tool call. The header names only the immediate parent,
   * so a grandchild needs a full walk; an unreachable root returns null and the
   * adapter refuses the call instead of trusting an intermediate child.
   */
  const rootOf = (sessionId) => resolveRootLineage(sessionId, getSessionById);

  function gateContext(exec) {
    const sessionId = exec && exec.agent && exec.agent.session
      ? String(exec.agent.session.id || '')
      : '';
    return {
      rootSessionId: rootOf(sessionId) || undefined,
      resolveRootSession: rootOf
    };
  }

  // ---- skills -------------------------------------------------------------

  ctx.inject(['skills'], (scoped) => {
    for (const spec of SKILLS) {
      if (!fs.existsSync(path.join(ROOT, spec.file))) continue;
      const { front, content } = readSkill(spec.file);
      scoped.skills.register({
        name: spec.name,
        description: frontField(front, 'description') || spec.name,
        content,
        source: 'stop-that-shit',
        invocation: { modelInvocable: true, userInvocable: true }
      });
    }
  });

  // ---- /sts command -------------------------------------------------------

  const MODE = /^\s*(review|answer|monitor|change|watch|status|runtime)\b([\s\S]*)$/i;

  ctx.inject(['commands'], (scoped) => {
    scoped.commands.register({
      name: 'sts',
      description: 'Arm a Stop That Shit contract for this session, then send the task',
      input: { hint: 'review|answer|monitor|change|watch|status [flags] -- task' },
      handler: ({ agent, rawInput }) => {
        const match = MODE.exec(rawInput || '');
        if (!match) {
          return { kind: 'error', text: 'usage: /sts review|change|watch|status [files=...] -- task' };
        }
        const mode = match[1].toLowerCase();
        const rest = match[2] || '';
        const sep = rest.indexOf('--');
        const flags = (sep >= 0 ? rest.slice(0, sep) : rest).trim();
        const task = sep >= 0 ? rest.slice(sep + 2).trim() : '';
        const directive = `$stop-that-shit ${mode}${flags ? ` ${flags}` : ''}`;

        // Arm through the same parser the prompt directive uses. The synthetic
        // prompt is the directive only, so the contract and the task body are
        // kept separate.
        const armed = handleDshHook('agent/pre-step', {
          session: { id: String(agent.session.id) },
          prompt: directive
        }, options);

        if (armed && (armed.kind === 'reject' || armed.kind === 'deny')) {
          return { kind: 'error', text: armed.reason || 'the contract directive was rejected' };
        }
        if (task) agent.followup(userMessage(task));

        return {
          kind: 'success',
          text: armed && armed.text ? armed.text : `Stop That Shit contract armed: ${mode}`
        };
      }
    });
  });

  // ---- pre-step: arm and annotate ----------------------------------------

  ctx.on('agent/pre-step', async (payload, next) => {
    const normalized = fromNativeEvent('agent/pre-step', payload);
    if (!normalized) return next();

    const result = handleDshHook('agent/pre-step', normalized, options);
    if (!result) return next();

    return applyDshDecision('agent/pre-step', result, next, ({ kind, text, downstream }) => {
      if (kind === 'reason') {
        ctx.logger.warn(`[stop-that-shit] step rejected: ${String(text)}`);
        return undefined;
      }
      if (!downstream || downstream.kind === 'reject' || !Array.isArray(downstream.messages)) {
        return undefined;
      }
      return { ...downstream, messages: downstream.messages.concat(contextMessage(text)) };
    });
  });

  // ---- tool gate ----------------------------------------------------------

  ctx.on('tools/pre-execute', async (exec, next) => {
    const payload = fromNativeEvent('tools/pre-execute', exec, gateContext(exec));
    if (!payload) return next();

    // Fail closed: a delegated call whose root cannot be resolved has no
    // contract to check against.
    if (payload.requiresVerifiedRoot === true) {
      return {
        kind: 'deny',
        reason: 'Delegated tool call has no verified root session. '
          + 'The session header names only the immediate parent; resolve the full lineage before gating it.'
      };
    }

    const event = toControlEvent('tools/pre-execute', payload);
    if (!event) return next();

    const result = handleControlEvent(event, options);

    if (result.kind === 'deny' || result.kind === 'prompt-error') {
      // DSH can ask the user; a Claude-style `ask` must not collapse into a
      // silent denial here.
      if (result.decision && result.decision.outcome === 'require_user_approval') {
        return { kind: 'ask', reason: result.message };
      }
      return { kind: 'deny', reason: result.message };
    }

    if (result.kind === 'context') {
      // The tool gate has no context channel; keep the watch note in the log.
      ctx.logger.info(`[stop-that-shit] ${result.text}`);
    }

    return next();
  });

  // ---- settled results ----------------------------------------------------

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const payload = fromNativeEvent('tools/post-execute', exec, Object.assign(
      { result },
      gateContext(exec)
    ));
    if (payload) handleDshHook('tools/post-execute', payload, options);
    return next();
  });

  // ---- session lifecycle --------------------------------------------------

  ctx.on('session/created', (session) => {
    const payload = fromNativeEvent('session/created', session);
    if (payload) handleDshHook('session/created', payload, options);
  });

  ctx.on('session/disposed', (session) => {
    const payload = fromNativeEvent('session/disposed', session);
    if (payload) handleDshHook('session/disposed', payload, options);
  });

  // ---- delegation ledger --------------------------------------------------

  // `subagent/start|end` emit `(identity, parent)`; `parent` is the live parent
  // agent. Fall back to the child's header when the second argument is absent.
  function parentSessionId(info, parent) {
    if (parent && parent.session) return String(parent.session.id);
    if (typeof parent === 'string') return parent;
    const session = getSessionById(info && info.id);
    const header = session && session.header;
    return header && header.parentSession ? String(header.parentSession) : undefined;
  }

  ctx.on('subagent/start', (info, parent) => {
    const payload = fromNativeEvent('subagent/start', info, {
      sessionId: parentSessionId(info, parent)
    });
    if (payload) handleDshHook('subagent/start', payload, options);
  });

  ctx.on('subagent/end', (info, parent) => {
    const payload = fromNativeEvent('subagent/end', info, {
      sessionId: parentSessionId(info, parent)
    });
    if (payload) handleDshHook('subagent/end', payload, options);
  });
}

const pluginExports = {
  name: 'stop-that-shit',
  inject: ['sessions'],
  apply: plugin
};

module.exports = pluginExports;
module.exports.default = pluginExports;
