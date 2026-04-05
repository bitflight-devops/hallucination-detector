---
issue: 56
artifact_type: architect
agent: architect
status: current
---

# Architecture: `unsupported_absence` Trigger Category (A7)

## Overview

Add the `unsupported_absence` trigger category to the hallucination-detector stop hook.
Absent-claim detection fires when the assistant asserts that something does not exist,
is not documented, or is not supported — without evidence from prior tool use. Suppression
is response-level (post-filter in `main()`) rather than per-match inside
`findTriggerMatches()`.

---

## Files Changed

| File                                      | Change type                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/hallucination-config.cjs`        | Add `unsupported_absence: 0.7` to `DEFAULT_WEIGHTS`                                                     |
| `scripts/hallucination-audit-stop.cjs`    | New detection block in `findTriggerMatches()` (block 7); new `hasRecentToolUse` post-filter in `main()` |
| `tests/hallucination-config.test.cjs`     | Update count (6→7), sum (1.65→2.35), add key assertion                                                  |
| `tests/hallucination-audit-stop.test.cjs` | New `describe('unsupported_absence', ...)` suite                                                        |
| `.claude/CLAUDE.md`                       | Update "5 active" → "6 active" in trigger category heading and list                                     |

---

## Data Models

### Match object (unchanged shape)

```js
{
  kind: 'unsupported_absence',  // string literal
  evidence: string,             // the matched substring from the stripped haystack
}
```

### Tool-use check result (local variable in `main()`)

```js
// boolean — true when at least one qualifying tool_use block found in last 10 entries
const hasRecentToolUse = /* boolean */;
```

No new exported types. No new persistent state.

---

## Module Boundaries

### `scripts/hallucination-config.cjs` — `DEFAULT_WEIGHTS`

Responsibility: declare the weight for the new category so all scoring consumers
(`scoreSentence`, `aggregateWeightedScore`, `categoryCounts`) pick it up automatically.

**Change:**

```js
// Before (line 30–38):
const DEFAULT_WEIGHTS = {
  speculation_language: 0.25,
  causality_language: 0.3,
  pseudo_quantification: 0.15,
  completeness_claim: 0.2,
  evaluative_design_claim: 0.4,
  internal_contradiction: 0.35,
};

// After:
const DEFAULT_WEIGHTS = {
  speculation_language: 0.25,
  causality_language: 0.3,
  pseudo_quantification: 0.15,
  completeness_claim: 0.2,
  evaluative_design_claim: 0.4,
  internal_contradiction: 0.35,
  unsupported_absence: 0.7,
};
```

Weight sum: 1.65 + 0.7 = **2.35**

### `scripts/hallucination-audit-stop.cjs` — `findTriggerMatches()`

Responsibility: detect absence-claim phrases in the stripped haystack; push
`{ kind: 'unsupported_absence', evidence }` for each match that is not inside a question.
No knowledge of transcript entries — purely text-local.

**Insertion point:** After block 6 (`internal_contradiction`, line ~1464) and before the
allowlist/maxTriggers filter block (line ~1466). This is detection block 7.

### `scripts/hallucination-audit-stop.cjs` — `main()`

Responsibility: after `findTriggerMatches()` returns, scan `entries` for recent tool use
and remove all `unsupported_absence` matches when qualifying tool use is found.

**Insertion point:** Immediately after the three `findTriggerMatches()` call sites
(lines ~2006, ~2011, ~2015) and before `telemetryBase` is constructed (line ~2018).
A single post-filter block handles all three call paths because they all write into
`triggerMatches`.

---

## Exact Regex

### Detection regex for `findTriggerMatches()`

One compiled regex, case-insensitive, applied to `lower` (the lowercase-stripped haystack):

```js
const ABSENCE_CLAIM_RE =
  /\b(does?\s+not\s+(?:exist|support|document|mention)|do\s+not\s+(?:exist|support|document|mention)|there\s+(?:is|are)\s+no\b|(?:is|are)\s+not\s+(?:documented|available|supported|mentioned)|cannot\s+be\s+found|no\s+\w+\s+(?:found|exists?|(?:is|are)\s+available))\b/gi;
```

**Phrases matched (canonical forms):**

| Phrase               | Covered by                                    |
| -------------------- | --------------------------------------------- |
| `does not exist`     | `does?\s+not\s+(?:exist\|...)`                |
| `do not exist`       | `do\s+not\s+(?:exist\|...)`                   |
| `does not support`   | `does?\s+not\s+(?:...\|support\|...)`         |
| `do not support`     | `do\s+not\s+(?:...\|support\|...)`            |
| `does not document`  | `does?\s+not\s+(?:...\|document\|...)`        |
| `does not mention`   | `does?\s+not\s+(?:...\|mention)`              |
| `there is no`        | `there\s+(?:is\|are)\s+no\b`                  |
| `there are no`       | `there\s+(?:is\|are)\s+no\b`                  |
| `is not documented`  | `(?:is\|are)\s+not\s+(?:documented\|...)`     |
| `are not documented` | `(?:is\|are)\s+not\s+(?:documented\|...)`     |
| `is not available`   | `(?:is\|are)\s+not\s+(?:...\|available\|...)` |
| `are not available`  | `(?:is\|are)\s+not\s+(?:...\|available\|...)` |
| `is not supported`   | `(?:is\|are)\s+not\s+(?:...\|supported\|...)` |
| `are not supported`  | `(?:is\|are)\s+not\s+(?:...\|supported\|...)` |
| `cannot be found`    | `cannot\s+be\s+found`                         |
| `no X found`         | `no\s+\w+\s+(?:found\|exists?\|...)`          |

**Note:** The regex uses the `g` flag. Apply via `matchAll()` on the original-case haystack (not
`lower`) so the `evidence` snippet preserves original case. Alternatively, use the lowercase
haystack for matching and use `m[0]` as evidence — both are acceptable since `lower` is derived
from `haystack` at the same offsets.

**Recommended implementation** (consistent with existing phrase-loop style):

```js
// Reset lastIndex before matchAll() — g-flagged regex retains state.
ABSENCE_CLAIM_RE.lastIndex = 0;
for (const m of haystack.matchAll(ABSENCE_CLAIM_RE)) {
  if (isIndexWithinQuestion(haystack, m.index)) continue;
  matches.push({ kind: 'unsupported_absence', evidence: m[0].trim() });
}
```

Where `ABSENCE_CLAIM_RE` is declared at module scope (same pattern as
`EVALUATIVE_DESIGN_TELLS_GLOBAL`).

---

## Detection Block (full code, insertion after line 1464)

```js
// 7) Absence claims — "X does not exist", "there is no Y", "cannot be found" etc.
// without tool-use evidence in the preceding transcript turns.
// Per-match suppression: isIndexWithinQuestion (text-local).
// Response-level suppression: hasRecentToolUse post-filter in main() removes all
// unsupported_absence matches when tool use found in last 10 entries.
if (isCategoryEnabled('unsupported_absence')) {
  if (useBuiltIn('unsupported_absence')) {
    ABSENCE_CLAIM_RE.lastIndex = 0;
    for (const m of haystack.matchAll(ABSENCE_CLAIM_RE)) {
      if (isIndexWithinQuestion(haystack, m.index)) continue;
      matches.push({ kind: 'unsupported_absence', evidence: m[0].trim() });
    }
  }
  runCustomPatterns('unsupported_absence');
}
```

**Module-scope constant** (declare near other module-scope regex constants):

```js
/**
 * Absence-claim phrases: "X does not exist", "there is no Y", "cannot be found", etc.
 * Used by the `unsupported_absence` detection category in findTriggerMatches().
 * Must use `g` flag; reset lastIndex before matchAll().
 */
const ABSENCE_CLAIM_RE =
  /\b(does?\s+not\s+(?:exist|support|document|mention)|do\s+not\s+(?:exist|support|document|mention)|there\s+(?:is|are)\s+no\b|(?:is|are)\s+not\s+(?:documented|available|supported|mentioned)|cannot\s+be\s+found|no\s+\w+\s+(?:found|exists?|(?:is|are)\s+available))\b/gi;
```

---

## Post-filter in `main()` — Call Flow

### Where `entries` comes from

`entries` is populated at line 1932 only when `lastAssistantMessageFromStdin` is absent
(i.e., stdin did not supply the message directly). Since Claude Code v1.12+ supplies
`last_assistant_message` via stdin, `entries` is **empty in the common case**.

**Fail-open rule:** When `entries` is empty, skip suppression entirely. The
`unsupported_absence` matches remain in `triggerMatches` and are treated as any other
trigger match (shadow-logged or blocked per `config.dryRun`).

### Insertion point

After line 2015 (the last `findTriggerMatches()` call), before line 2018
(`const telemetryBase = ...`):

```js
// Post-filter: suppress unsupported_absence matches when recent tool use found.
// entries is empty in the common stdin-direct path — skip suppression (fail-open).
if (triggerMatches.some((m) => m.kind === 'unsupported_absence') && entries.length > 0) {
  const hasRecentToolUse = hasToolUseInRecentEntries(entries, 10);
  if (hasRecentToolUse) {
    triggerMatches = triggerMatches.filter((m) => m.kind !== 'unsupported_absence');
  }
}
```

`triggerMatches` must be declared with `let` (not `const`) at line 1999 to allow
reassignment via filter. **Verify the existing declaration uses `let`.**

Current code at line 1999: `let triggerMatches = [];` — confirmed `let`.

### Helper function `hasToolUseInRecentEntries(entries, lookback)`

New private function in `scripts/hallucination-audit-stop.cjs`.

**Signature:**

```js
/**
 * Returns true when any of the last `lookback` entries contains a tool_use block
 * whose name is one of the qualifying search tools.
 *
 * @param {Array<object>} entries  - Parsed JSONL transcript entries.
 * @param {number} lookback        - Maximum number of entries to scan from the end.
 * @returns {boolean}
 */
function hasToolUseInRecentEntries(entries, lookback) { ... }
```

**Implementation:**

```js
function hasToolUseInRecentEntries(entries, lookback) {
  const QUALIFYING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Bash']);
  const window = entries.slice(-lookback);
  for (const entry of window) {
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && QUALIFYING_TOOLS.has(block.name)) {
        return true;
      }
    }
  }
  return false;
}
```

**Fail-safe:** Any `undefined`/`null` access is guarded by optional chaining. No try/catch
needed — the data access is safe.

---

## Full Call Flow in `main()`

```
main()
  │
  ├── entries = [] (common case: lastAssistantMessageFromStdin set)
  │   OR
  ├── entries = parseJsonl(transcriptText) (when stdin has transcript_path only)
  │
  ├── triggerMatches = findTriggerMatches(lastAssistantText, config)
  │   (or findTriggerMatches(strippedText, config) for structured+valid path)
  │   │
  │   └── [inside findTriggerMatches]
  │       block 7: ABSENCE_CLAIM_RE.matchAll → push unsupported_absence matches
  │
  ├── POST-FILTER (new, after all findTriggerMatches calls):
  │   if triggerMatches has unsupported_absence AND entries.length > 0:
  │     hasRecentToolUse = hasToolUseInRecentEntries(entries, 10)
  │     if hasRecentToolUse:
  │       triggerMatches = triggerMatches.filter(m => m.kind !== 'unsupported_absence')
  │
  ├── telemetryBase = { categories, evidence, ... }
  │
  ├── if config.dryRun: writeShadowLog(); exit(0)      ← shadow mode path
  │
  └── blockAndExit(...)                                 ← block path
```

---

## JSDoc Update

At line 977, update the `@returns` description to include `unsupported_absence`:

```js
 * @returns {Array<{kind: string, evidence: string}>} An array of match objects where `kind` is one of:
 *   `speculation_language`, `causality_language`, `pseudo_quantification`, `completeness_claim`,
 *   `evaluative_design_claim`, `internal_contradiction`, or `unsupported_absence`,
 *   and `evidence` is the matched snippet from the text.
```

---

## `.claude/CLAUDE.md` Update

Section "Trigger detection categories (5 active)" → "Trigger detection categories (6 active)".

Add to the numbered list:

```
6. `unsupported_absence` — absence claims without tool evidence ("does not exist", "there is no", "cannot be found", etc.)
```

---

## Test Patterns

### `tests/hallucination-config.test.cjs`

Three assertions to update atomically with the `DEFAULT_WEIGHTS` change:

**Test 1 — key count:**

```js
// Before:
expect(Object.keys(DEFAULT_WEIGHTS).length).toBe(6);
// After:
expect(Object.keys(DEFAULT_WEIGHTS).length).toBe(7);
```

**Test 2 — key presence (add one line):**

```js
expect(DEFAULT_WEIGHTS).toHaveProperty('unsupported_absence');
```

**Test 3 — weight sum:**

```js
// Before (line 35):
expect(Math.abs(sum - 1.65)).toBeLessThan(1e-9);
// After:
expect(Math.abs(sum - 2.35)).toBeLessThan(1e-9);
```

Update the test description string from `'values sum to 1.65 ...'` to
`'values sum to 2.35 (unsupported_absence: 0.7 added)'`.

### `tests/hallucination-audit-stop.test.cjs` — new `describe` block

The suite has four sub-tests covering: positive detection, question suppression, code-block
suppression, and tool-use suppression (integration path via `runHook`).

#### Sub-test (a): positive — absence phrase, no tool evidence

```js
describe('unsupported_absence', () => {
  it('flags "does not exist"', () => {
    const matches = findTriggerMatches('The function does not exist in this module.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('unsupported_absence');
  });

  it('flags "there is no"', () => {
    const matches = findTriggerMatches('There is no configuration option for this.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('unsupported_absence');
  });

  it('flags "is not documented"', () => {
    const matches = findTriggerMatches('This behavior is not documented anywhere.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('unsupported_absence');
  });

  it('flags "cannot be found"', () => {
    const matches = findTriggerMatches('The endpoint cannot be found in the codebase.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('unsupported_absence');
  });
```

#### Sub-test (b): negative — question suppression

```js
  it('does not flag absence phrase inside a question', () => {
    const matches = findTriggerMatches('Does the feature not exist in the current build?');
    const absenceMatches = matches.filter((m) => m.kind === 'unsupported_absence');
    expect(absenceMatches.length).toBe(0);
  });
```

#### Sub-test (c): negative — code block suppression (`stripLowSignalRegions`)

````js
  it('does not flag absence phrase inside a fenced code block', () => {
    const matches = findTriggerMatches(
      'Check the output:\n```\n// does not exist\n```\n',
    );
    const absenceMatches = matches.filter((m) => m.kind === 'unsupported_absence');
    expect(absenceMatches.length).toBe(0);
  });
````

#### Sub-test (d): negative — tool use present in transcript → no match (integration via `runHook`)

This exercises the post-filter in `main()`. It requires a multi-turn transcript that contains
a `tool_use` block in the recent entries followed by the assistant message with an absence claim.

**Transcript structure needed:**

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","id":"tu1","input":{"file_path":"/tmp/x"}}]}}
{"type":"tool_result","content":[{"type":"text","text":"file content"}]}
{"type":"assistant","message":{"content":[{"type":"text","text":"The function does not exist in this module."}]}}
```

**Helper function** (add to `tests/hallucination-audit-stop.test.cjs`):

```js
/**
 * Build a temporary multi-turn transcript file.
 * `turns` is an array of raw JSONL entry objects written in order.
 * Returns the file path. Caller is responsible for cleanup.
 */
function makeTempMultiTurnTranscript(turns) {
  const tmpFile = path.join(
    os.tmpdir(),
    `hd-multi-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  const lines = turns.map((t) => JSON.stringify(t)).join('\n');
  fs.writeFileSync(tmpFile, `${lines}\n`, 'utf-8');
  return tmpFile;
}
```

**Test:**

```js
  it('does not block when tool use found in recent transcript entries', () => {
    const transcriptPath = makeTempMultiTurnTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', id: 'tu1', input: { file_path: '/tmp/x' } },
          ],
        },
      },
      {
        type: 'tool_result',
        content: [{ type: 'text', text: 'file content here' }],
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'The function does not exist in this module.' },
          ],
        },
      },
    ]);

    try {
      const result = runHook({ transcript_path: transcriptPath, session_id: 'absence-suppressed-1' });
      expect(result.status).toBe(0);
      // No block decision emitted — absence claim suppressed by tool use
      if (result.stdout.trim()) {
        const decision = JSON.parse(result.stdout.trim());
        expect(decision.decision).not.toBe('block');
      }
    } finally {
      try { fs.unlinkSync(transcriptPath); } catch { /* ok */ }
    }
  });
```

**Note on session state:** The session ID `'absence-suppressed-1'` must be purged before
the test or the fail-open path may fire. Add it to `E2E_SESSION_IDS` in
`tests/hallucination-e2e.test.cjs` is NOT needed here — the `beforeEach` in
`hallucination-audit-stop.test.cjs` does not manage session files. Either:

- Use a unique random session ID per run: `session_id: \`absence-${Date.now()}\``
- Or manually delete the state file in the test's `finally` block.

Recommended: use a random session ID to avoid state bleed.

```js
  it('does not block when tool use found in recent transcript entries', () => {
    const sessionId = `absence-suppressed-${Date.now()}`;
    // ... (same as above but with sessionId variable)
  });
```

#### Sub-test (e): positive — absence phrase blocks when no tool use in transcript

```js
  it('blocks when absence phrase present and no tool use in transcript', () => {
    const sessionId = `absence-blocks-${Date.now()}`;
    const transcriptPath = makeTempMultiTurnTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'The function does not exist in this module.' },
          ],
        },
      },
    ]);

    try {
      const result = runHook({ transcript_path: transcriptPath, session_id: sessionId });
      expect(result.status).toBe(0);
      // In shadow mode (default dryRun: false), this should block
      // OR be shadow-logged if dryRun defaults to true.
      // The hook exits 0 in both cases; check stdout for decision.
      // When dryRun: false (default), a block decision is emitted.
      if (result.stdout.trim()) {
        const decision = JSON.parse(result.stdout.trim());
        expect(decision.decision).toBe('block');
      }
    } finally {
      try { fs.unlinkSync(transcriptPath); } catch { /* ok */ }
    }
  });
```

**Important:** The default `dryRun` is `false`. The feature description says "must enter shadow mode
before enabling blocks" but this refers to the deployment gate, not the default config value.
`DEFAULT_CONFIG.dryRun` is `false`. Tests run without a project config file, so `dryRun` is false
in the test environment — the block path will fire. If this is wrong, consult the config default
at `scripts/hallucination-config.cjs` line 59 (`dryRun: false`) — verified.

### `tests/hallucination-e2e.test.cjs` — shadow-mode integration

Add a session ID to `E2E_SESSION_IDS` and a test that verifies `writeShadowLog` fires for an
absence phrase when `dryRun: true` is set via a config file in the tmp project dir.

```js
// Add to E2E_SESSION_IDS:
'e2e-ab-1',

// New describe block:
describe('e2e: unsupported_absence shadow mode', () => {
  it('shadow-logs absence phrase when dryRun: true', () => {
    tmpDir = makeTmpProjectDir();
    // Write a config file that enables shadow mode
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { dryRun: true };\n',
    );
    const transcriptPath = writeTranscript(
      tmpDir,
      'The function does not exist in this module.',
    );
    const result = runHook(
      { transcript_path: transcriptPath, session_id: 'e2e-ab-1' },
      tmpDir,
    );
    expect(result.status).toBe(0);
    // Shadow mode exits 0 with no block decision on stdout
    const decision = parseDecision(result.stdout);
    expect(decision).toBeNull();
    // The hook does not crash — stderr should be empty
    expect(result.stderr).toBe('');
  });
});
```

---

## `aggregateWeightedScore` Test Update

The `aggregateWeightedScore` suite at line 730 has a test that calculates an expected value
using the weight sum `1.65`. After adding `unsupported_absence: 0.7`, the sum is `2.35`.

**Test at line 741 (`'returns the triggered category fractional weight for partial scores'`):**

```js
// Before:
// speculation weight = 0.25, weightSum = 1.65
// result = 0.25 / 1.65 ≈ 0.15152
// After:
// speculation weight = 0.25, weightSum = 2.35
// result = 0.25 / 2.35 ≈ 0.10638
const expected = 0.25 / 2.35;
expect(Math.abs(result - expected)).toBeLessThan(0.001);
```

**Test at line 757 (`'handles missing score keys as 0'`):**

```js
// Before comment: // Only speculation fires: 0.25 / 1.65
// After:
// Only speculation fires: 0.25 / 2.35 ≈ 0.10638 (weightSum = 2.35 with unsupported_absence: 0.7)
const expected = 0.25 / 2.35;
```

**Test at line 718 (`'returns 1 for all-one scores with default weights'`):**

The `scores` object passes only 6 keys. With `unsupported_absence` in `DEFAULT_WEIGHTS`, a
scores object missing `unsupported_absence` will have it treated as 0, causing the aggregate
to be less than 1. **This test will break.**

Fix: add `unsupported_absence: 1` to the scores object:

```js
const scores = {
  speculation_language: 1,
  causality_language: 1,
  pseudo_quantification: 1,
  completeness_claim: 1,
  evaluative_design_claim: 1,
  internal_contradiction: 1,
  unsupported_absence: 1,    // ← add
};
expect(aggregateWeightedScore(scores, DEFAULT_WEIGHTS)).toBe(1);
```

---

## Constraints Verified

| Constraint                                                 | Status                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Zero new npm dependencies                                  | Met — uses only existing built-ins and module-scope regex                  |
| `findTriggerMatches` signature unchanged (`text, config`)  | Met — post-filter is in `main()`                                           |
| `triggerMatches` declared with `let` (allows reassignment) | Verified at line 1999                                                      |
| `entries` populated only when transcript_path path used    | Verified at lines 1920–1932                                                |
| Fail-open when `entries` is empty                          | Explicit guard: `entries.length > 0`                                       |
| Shadow mode default                                        | `DEFAULT_CONFIG.dryRun: false` — blocks unless config overrides            |
| CJS module format                                          | All files are `.cjs`                                                       |
| Detection block number                                     | Block 7, after `internal_contradiction` (block 6), before allowlist filter |

---

## Implementation Checklist (for javascript-pro agent)

- [ ] Declare `ABSENCE_CLAIM_RE` at module scope in `scripts/hallucination-audit-stop.cjs`
- [ ] Add detection block 7 after `internal_contradiction` block (after line 1464)
- [ ] Add `hasToolUseInRecentEntries(entries, lookback)` private function
- [ ] Add post-filter block in `main()` after the three `findTriggerMatches` call sites, before `telemetryBase`
- [ ] Update JSDoc `@returns` at line 977 to include `unsupported_absence`
- [ ] Add `unsupported_absence: 0.7` to `DEFAULT_WEIGHTS` in `scripts/hallucination-config.cjs`
- [ ] Update `tests/hallucination-config.test.cjs`: count 6→7, sum 1.65→2.35, add key, update description
- [ ] Add `makeTempMultiTurnTranscript` helper to `tests/hallucination-audit-stop.test.cjs`
- [ ] Add `describe('unsupported_absence', ...)` suite with 5 sub-tests
- [ ] Update `aggregateWeightedScore` tests: add `unsupported_absence: 1` to full-scores object; update fractional weight comment+expected to use 2.35 denominator
- [ ] Add `'e2e-ab-1'` to `E2E_SESSION_IDS` in `tests/hallucination-e2e.test.cjs`
- [ ] Add shadow-mode e2e test in `tests/hallucination-e2e.test.cjs`
- [ ] Update `.claude/CLAUDE.md` "5 active" → "6 active" and add item 6 to the list
- [ ] Run `pnpm test` — all assertions pass
- [ ] Run `pnpm run lint` — no Biome errors
