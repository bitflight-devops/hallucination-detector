# Code Quality Review — Simplification Pass

Date: 2026-03-10
Files reviewed:

- `scripts/hallucination-claim-structure.cjs` (new)
- `scripts/hallucination-memory-gate.cjs` (new)
- `scripts/hallucination-audit-stop.cjs` (modified — `stripLabeledClaimLines`, `buildStructuralBlockReason`, `STRUCTURED_BLOCK_FORMAT`, new branching in `main()`)
- `tests/hallucination-claim-structure.test.cjs` (new)

---

## Finding 1: Duplicated RETAINABLE_LABELS constant

**Category: Redundant state — same constant defined in two files**

`hallucination-claim-structure.cjs` line 14:

```js
const RETAINABLE_LABELS = new Set(['VERIFIED', 'CAUSAL']);
```

`hallucination-memory-gate.cjs` line 13:

```js
const RETAINABLE = new Set(['VERIFIED', 'CAUSAL']);
```

These are the same semantic constant with different names, in two different files. The claim-structure module also re-exports `computeMemoryGate` from the memory-gate module (`module.exports` line 436), meaning it already depends on the memory-gate module. The `RETAINABLE_LABELS` set in claim-structure duplicates the authoritative set inside `computeMemoryGate`. If a new label is added to the retainable set, it must be updated in both places. There is no single source of truth.

**Required fix:** Export `RETAINABLE_LABELS` from `hallucination-memory-gate.cjs` (the module that owns the gate logic) and import it into `hallucination-claim-structure.cjs` instead of redefining it.

---

## Finding 2: Duplicated loop-state block logic in `main()`

**Category: Copy-paste with slight variation**

The `main()` function in `hallucination-audit-stop.cjs` contains three near-identical blocks of code that load loop state, increment blocks, check the loop ceiling, save state, and either block or exit:

**Block A** — structured + invalid (lines 818–830):

```js
const { statePath, data } = loadLoopState(sessionId);
const blocks = Number(data.blocks || 0);
const nextBlocks = blocks + 1;

if (nextBlocks > 2 && stopHookActive) {
  saveLoopState(statePath, { blocks: nextBlocks });
  process.exit(0);
}

saveLoopState(statePath, { blocks: nextBlocks });
const reason = buildStructuralBlockReason(structureResult.errors);
emitJson({ decision: 'block', reason });
process.exit(0);
```

**Block B** — structured + valid with matches (lines 844–856):

```js
const { statePath, data } = loadLoopState(sessionId);
const blocks = Number(data.blocks || 0);
const nextBlocks = blocks + 1;

if (nextBlocks > 2 && stopHookActive) {
  saveLoopState(statePath, { blocks: nextBlocks });
  process.exit(0);
}

saveLoopState(statePath, { blocks: nextBlocks });
const reason = buildBlockReason(matches);
emitJson({ decision: 'block', reason });
process.exit(0);
```

**Block C** — unstructured with matches (lines 904–918):

```js
const { statePath, data } = loadLoopState(sessionId);
const blocks = Number(data.blocks || 0);
const nextBlocks = blocks + 1;

if (nextBlocks > 2 && stopHookActive) {
  saveLoopState(statePath, { blocks: nextBlocks });
  process.exit(0);
}

saveLoopState(statePath, { blocks: nextBlocks });
const reason = buildBlockReason(matches);
emitJson({ decision: 'block', reason });
process.exit(0);
```

The only difference between the three is the `reason` source (`buildStructuralBlockReason` vs `buildBlockReason`). The loop-ceiling guard, state save, emit, and exit are identical. This pattern will drift: if the loop ceiling changes from 2 to 3, or the guard condition changes, it will be patched in one or two places and silently left wrong in the third.

Additionally there are two separate "no matches — reset to 0" exits using a distinct pattern:

- Lines 838–842: structured + valid + no matches — reads state but only uses `statePath`, not `data`
- Lines 898–901: unstructured + no matches — same pattern

These read loop state (paying I/O cost) purely to get `statePath` so they can write a reset. The `data` value is loaded and discarded.

**Required fix:** Extract a `maybeBlock(sessionId, stopHookActive, reason)` helper that encapsulates the load → increment → ceiling check → save → emit → exit sequence. The three call sites pass the reason string. Extract a `resetLoopState(sessionId)` helper for the two "no matches" paths.

---

## Finding 3: Leaky abstraction — `computeMemoryGate` re-exported through `hallucination-claim-structure.cjs`

**Category: Leaky abstraction**

`hallucination-claim-structure.cjs` line 436:

```js
computeMemoryGate: require('./hallucination-memory-gate.cjs').computeMemoryGate,
```

`hallucination-claim-structure.cjs` is a validator. It has no business being the public surface for the memory gate computation. Consumers that need `computeMemoryGate` should import it from its owner (`hallucination-memory-gate.cjs`) directly.

The test file correctly imports both independently:

```js
const { validateClaimStructure } = require('../scripts/hallucination-claim-structure.cjs');
const { computeMemoryGate } = require('../scripts/hallucination-memory-gate.cjs');
```

But the re-export creates a second import path for `computeMemoryGate` through a module that does not own it. This is a hidden coupling: claim-structure's `module.exports` now has a runtime dependency on memory-gate at require time, and callers could mistakenly reach memory-gate through claim-structure.

**Required fix:** Remove `computeMemoryGate` from `hallucination-claim-structure.cjs`'s `module.exports`. Any callers that used the re-export should import from `hallucination-memory-gate.cjs` directly.

---

## Finding 4: Duplicated LABEL_RE / STRUCTURED_RE regex pair

**Category: Redundant state — two regexes with the same source, different flags**

`hallucination-claim-structure.cjs` lines 17–20:

```js
const LABEL_RE = /\[(VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED)\]/g;
const STRUCTURED_RE = /\[(VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED)\]/;
```

`LABEL_RE` and `STRUCTURED_RE` have identical source patterns. The only difference is the `g` flag. The module uses `LABEL_RE` inside `parseClaimLines` but reconstructs a new regex from its source on line 53 anyway:

```js
const re = new RegExp(LABEL_RE.source, 'g');
```

This means `LABEL_RE` itself is never directly iterated — its sole purpose is to provide `.source` to the `new RegExp(...)` call. That makes `LABEL_RE` a named constant whose only value is its `.source` property, which is the same as `STRUCTURED_RE.source`.

**Required fix:** Define one constant for the label alternation pattern as a string (`const LABEL_PATTERN = '\\[(VERIFIED|...)\\]'`) and derive both use sites from it: `new RegExp(LABEL_PATTERN, 'g')` inside `parseClaimLines`, and `new RegExp(LABEL_PATTERN)` assigned as `STRUCTURED_RE`. This eliminates the duplicate source and clarifies that `LABEL_RE` as a pre-compiled regex was never used.

---

## Finding 5: Stringly-typed label list in `stripLabeledClaimLines`

**Category: Stringly-typed code**

`hallucination-audit-stop.cjs` lines 673–674:

```js
const LABELED_CLAIM_LINE_RE =
  /^\s*-?\s*(?:\[(?:VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED)\])+\[c\d+\].*/;
```

This hardcodes the full label set as a regex alternation. The same label set is hardcoded as a regex in `hallucination-claim-structure.cjs` (lines 17–20) and as a `Set` in both `hallucination-claim-structure.cjs` and `hallucination-memory-gate.cjs`. There are now four separate locations defining which labels are valid. Adding a new label requires updating all four.

The `STRUCTURED_BLOCK_FORMAT` constant in `hallucination-audit-stop.cjs` (lines 682–719) also lists all seven labels as literal examples in the template string — that is acceptable since it is instructional prose, not a structural definition. But the regex in `stripLabeledClaimLines` is structural.

**Required fix:** The label set should be defined once, exported from `hallucination-claim-structure.cjs` as `VALID_LABELS` (an array or Set), and the regex in `stripLabeledClaimLines` should be built from it at module load time:

```js
const { VALID_LABELS } = require('./hallucination-claim-structure.cjs');
const labelAlt = VALID_LABELS.join('|');
const LABELED_CLAIM_LINE_RE = new RegExp(`^\\s*-?\\s*(?:\\[(?:${labelAlt})\\])+\\[c\\d+\\].*`);
```

---

## Finding 6: Inconsistency — structured branch skips introspection mode

**Category: Inconsistency — new code breaks an existing behavior**

The unstructured path in `main()` (lines 862–896) has a dedicated introspection mode block that logs analysis data and exits without blocking. The structured path (lines 815–857) has no introspection mode check. If `config.introspect` is true and the response is structured, the hook will block normally — ignoring the introspection mode completely.

This means introspection mode behaves differently depending on whether a response is structured or not. A user running in introspection mode to calibrate detection will get blocks from structured responses but only logs from unstructured ones. This is a silent behavioral inconsistency.

**Required fix:** The structured branch should check `config.introspect` and log analysis data (including `structureResult.errors` and `structureResult.claims`) before exiting, consistent with the unstructured introspection path.

---

## Finding 7: Partial `loadLoopState` call — discarded `data`

**Category: Redundant state — loaded but discarded**

Two locations in `main()` call `loadLoopState` but only use `statePath`:

Lines 839–841 (structured + valid + no matches):

```js
const { statePath } = loadLoopState(sessionId);
saveLoopState(statePath, { blocks: 0 });
```

Lines 899–901 (unstructured + no matches):

```js
const { statePath } = loadLoopState(sessionId);
saveLoopState(statePath, { blocks: 0 });
```

Both read the file from disk (paying I/O) to get the path, then immediately overwrite with `{ blocks: 0 }`. The path is deterministic: it is `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` — visible in `loadLoopState`'s implementation. These call sites should compute the path directly (or call a `getStatePath(sessionId)` helper) instead of paying a filesystem read to obtain a value that could be computed.

This is a minor efficiency issue but also a code clarity issue: reading a file to get its own path is confusing to the reader.

**Required fix:** Extract `getStatePath(sessionId)` from `loadLoopState` and use it directly in the reset paths. This makes the intent explicit: "I know the state is zero, I just need the path to write it."

---

## Summary Table

| #   | Category                                              | Severity | Location                                                               |
| --- | ----------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| 1   | Redundant state — duplicate constant                  | High     | `RETAINABLE_LABELS` in claim-structure vs `RETAINABLE` in memory-gate  |
| 2   | Copy-paste with slight variation                      | High     | Three loop-state/block sequences in `main()`                           |
| 3   | Leaky abstraction                                     | Medium   | `computeMemoryGate` re-exported through claim-structure                |
| 4   | Redundant state — duplicate regex source              | Medium   | `LABEL_RE` / `STRUCTURED_RE` in claim-structure                        |
| 5   | Stringly-typed code                                   | Medium   | Label alternation hardcoded in `stripLabeledClaimLines` (4th location) |
| 6   | Inconsistency                                         | Medium   | Structured branch ignores `config.introspect`                          |
| 7   | Redundant state — file read to get deterministic path | Low      | Two `loadLoopState` calls that discard `data`                          |

Findings 1, 2, and 6 are the highest priority: Finding 1 will silently diverge when a new label is added, Finding 2 will silently diverge when loop ceiling logic is patched, and Finding 6 is an observable behavioral inconsistency in a currently shipped mode.
