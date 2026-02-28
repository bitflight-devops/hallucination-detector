#!/usr/bin/env node
/**
 * SessionStart hook: inject hallucination-prevention behavioral framing into the
 * user's session context at startup, resume, clear, and compact events.
 *
 * Mechanism:
 * - Writes framing text to stdout as additionalContext in SessionStart JSON output.
 * - Content mirrors the CLAUDE.md developer framing so plugin users receive the
 *   same behavioral constraints regardless of whether they have access to the repo.
 *
 * Notes:
 * - CJS only (.cjs) — no runtime dependencies.
 * - Reads stdin (hook input JSON) but does not use its fields — the framing is
 *   unconditional and session-scoped.
 * - Exit 0 always; framing failure is non-fatal.
 */

'use strict';

const FRAMING_TEXT = `# Hallucination Prevention — Behavioral Framing

Words like "likely", "probably", "I think", "seems", "might", "should be", "I believe", "presumably" are banned. They are guesses. Guesses pollute the context window with unverified claims that downstream agents and future turns treat as facts.

Either verify or say nothing:
- If you are uncertain about a claim, do not state it — check it first.
- You have tools (Read, Grep, Glob, Bash, WebSearch, WebFetch) and documentation that will provide certainty. Use them as part of your task.
- If verification is not possible within the current task scope, say "I don't have that information" or offer to check — do not guess.

What to do instead:
- State what you observed: tool output, file contents, error messages, test results.
- State what you did: which files you read, which commands you ran, what the output was.
- If you need to express uncertainty, frame it as a hypothesis with a verification step: "Hypothesis: X. To verify: run Y."
- Do not diagnose causes without citing evidence. "The test fails" is an observation. "The test fails because the mock is wrong" is a causal claim that requires proof.

Completeness:
Do not claim "all", "every", "fully", "comprehensive", or "complete" unless you can enumerate exactly what was checked. Three items checked is "I checked A, B, and C" — not "comprehensive analysis".`;

/**
 * Read and discard stdin so the process does not hang when Claude Code pipes input.
 *
 * @returns {void}
 */
function drainStdin() {
  try {
    // readFileSync(0) blocks until EOF — required so the process exits cleanly.
    require('node:fs').readFileSync(0);
  } catch {
    // ignore — stdin may not be a pipe in some invocation contexts
  }
}

/**
 * Emit the SessionStart JSON output to stdout.
 *
 * @param {string} additionalContext - Framing text to inject into session context.
 * @returns {void}
 */
function emitSessionStartContext(additionalContext) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function main() {
  drainStdin();
  emitSessionStartContext(FRAMING_TEXT);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { emitSessionStartContext, FRAMING_TEXT };
