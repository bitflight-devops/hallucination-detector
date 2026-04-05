# Efficiency Review — claim-structure, memory-gate, audit-stop (new code)

Date: 2026-03-10

## Files reviewed

- `scripts/hallucination-claim-structure.cjs` (new)
- `scripts/hallucination-memory-gate.cjs` (new)
- `scripts/hallucination-audit-stop.cjs` (new functions: `stripLabeledClaimLines`, `buildStructuralBlockReason`, new branching in `main()`)
- `tests/hallucination-claim-structure.test.cjs` (new)

---

## Findings

### F1 — Regex compiled inside a loop in `parseClaimLines` [HIGH]

**File:** `hallucination-claim-structure.cjs`, lines 53–55

```js
const re = new RegExp(LABEL_RE.source, 'g');
for (let m = re.exec(line); m !== null; m = re.exec(line)) {
```

A new `RegExp` object is constructed on every iteration of the outer `for` loop — once per line. The loop can run hundreds of times on a long message. The purpose is to get a fresh `lastIndex` each time, but the correct fix is to reset `lastIndex` on the module-level constant before use, or use `String.prototype.matchAll()` with the global flag, which returns a fresh iterator without constructing a new object.

`LABEL_RE` is already defined at module level with `g` flag. Constructing `new RegExp(LABEL_RE.source, 'g')` every iteration defeats the point of defining it as a constant.

**Recommended fix:** replace with `line.matchAll(LABEL_RE)` (produces a fresh iterator; no `RegExp` allocation per line) or reset `LABEL_RE.lastIndex = 0` before use. Using `matchAll` is simpler and idiomatic.

---

### F2 — `claims.find()` called in O(n²) loops [MEDIUM]

**File:** `hallucination-claim-structure.cjs`, lines 379–404

Two separate loops over `memWrite.allowed` and `uniqueClaimIds` each call `claims.find(c => c.id === id)` — linear search through `claims` on every iteration. With N claims, this is O(N²) per validation call.

A `Map` keyed by claim ID is already built earlier in `validateClaimStructure` (`seenIds`, line 235). That map is not reused for later lookups; `find()` is called instead.

**Recommended fix:** keep a reference to `seenIds` (already a `Map<id, claim>`) and replace `claims.find(c => c.id === id)` with `seenIds.get(id)` in both loops. Zero extra allocation; O(1) lookup.

---

### F3 — `[...new Set(claims.map(c => c.id))].map(id => claims.find(...))` at return site [MEDIUM]

**File:** `hallucination-claim-structure.cjs`, lines 421–424

```js
claims: [...new Set(claims.map((c) => c.id))].map((id) => {
  const c = claims.find((x) => x.id === id);
  return { id: c.id, label: c.label };
}),
```

This creates a `Set` from all IDs, spreads it into an array, then calls `claims.find()` for each unique ID — another O(N²) pass just to build the return value. Again, `seenIds` (the `Map` built on line 235) would give O(1) lookup with no extra structure.

**Recommended fix:** `[...seenIds.values()].map(c => ({ id: c.id, label: c.label }))` — one pass, no `find`.

---

### F4 — Duplicate regex for list-item detection in `hasEnumerationNearby` [LOW]

**File:** `hallucination-audit-stop.cjs`, lines 229–233

```js
const listItemRe = /^\s*(?:\d+[.)]\s|\*\s|-\s)/m;
const globalListItemRe = /^\s*(?:\d+[.)]\s|\*\s|-\s)/gm;
if (!listItemRe.test(preceding)) return false;
const allMatches = preceding.match(globalListItemRe);
```

Two regexes with identical patterns are constructed on every call. The first (`listItemRe`) is used only for a presence check before the second (`globalListItemRe`) is used to count. The presence check is redundant: `preceding.match(globalListItemRe)` already returns `null` when there are no matches, so the `if (!listItemRe.test(...)) return false` guard is unnecessary.

Furthermore, both regexes are created as literals inside the function body, so they are recompiled on every invocation. `hasEnumerationNearby` is called in a loop over `completenessRegexes` (up to 5 times per message).

**Recommended fix:** hoist one `const LIST_ITEM_RE = /^\s*(?:\d+[.)]\s|\*\s|-\s)/gm` to module level, eliminate the non-global duplicate, and simplify to:

```js
const allMatches = preceding.match(LIST_ITEM_RE);
return allMatches !== null && allMatches.length >= 2;
```

Note: `String.prototype.match` with a global regex returns all matches or `null`; the early-exit guard adds no value.

---

### F5 — `loadLoopState` called twice in the structured-valid path of `main()` [MEDIUM]

**File:** `hallucination-audit-stop.cjs`, lines 839–855

```js
// matches.length === 0 branch:
const { statePath } = loadLoopState(sessionId);          // call 1
saveLoopState(statePath, { blocks: 0 });
process.exit(0);
...
// matches.length > 0 branch:
const { statePath, data } = loadLoopState(sessionId);    // call 2
```

Each `loadLoopState` call does a filesystem read (`fs.readFileSync` + `JSON.parse`). In the structured-valid + matches-present path, the function reads the state file twice: once at line 839 (for the zero-match branch that is not taken) and once at line 844. The zero-match branch exits immediately after, so there is no overlap — but the code structure means a reader must trace control flow to confirm only one call executes per run. More importantly, the identical pattern appears verbatim in the unstructured path (lines 899–904) and the structured-invalid path (lines 818–845). Each branch independently calls `loadLoopState`, meaning any future change that needs the state before branching will require yet another call.

**Recommended fix:** call `loadLoopState` once near the top of `main()`, after the early exits for missing transcript. Pass `statePath` and `data` into each branch. This also removes the repeated `Number(data.blocks || 0)` expression.

---

### F6 — `MECHANISM_RE` compiled inside a conditional branch on every call [LOW]

**File:** `hallucination-claim-structure.cjs`, lines 301–302

```js
const MECHANISM_RE =
  /\b(?:explain|analysis|output|returned|showed|log|trace|stack|error|...)\b/i;
const hasMechanism = MECHANISM_RE.test(evidenceContent);
```

`MECHANISM_RE` is defined inside the `case 'CAUSAL'` branch of a `switch` inside a `for` loop. Every claim with a `CAUSAL` label causes this regex to be compiled. For a message with multiple `CAUSAL` claims, it compiles multiple times.

**Recommended fix:** hoist to module level alongside the other pattern constants (`TIMING_WORDS_RE`, `CAUSAL_VERBS_RE`, etc.).

---

### F7 — `RETAINABLE` `Set` instantiated on every `computeMemoryGate` call [LOW]

**File:** `hallucination-memory-gate.cjs`, lines 13

```js
function computeMemoryGate(claims) {
  const RETAINABLE = new Set(['VERIFIED', 'CAUSAL']);
```

`RETAINABLE` is a constant that never changes. It is re-created as a new `Set` on every invocation. The function is called once per hook invocation today, so the impact is negligible. However, there is also a module-level `RETAINABLE_LABELS` in `hallucination-claim-structure.cjs` with identical contents. The two are not shared.

**Recommended fix:** hoist to module level in `hallucination-memory-gate.cjs`, and consider whether `hallucination-claim-structure.cjs` can import and reuse it rather than duplicating.

---

### F8 — `stripLabeledClaimLines` splits, filters, and joins on every structured response [LOW]

**File:** `hallucination-audit-stop.cjs`, lines 672–679

```js
function stripLabeledClaimLines(text) {
  const LABELED_CLAIM_LINE_RE = /.../ ;
  const METADATA_LINE_RE = /.../ ;
  return text
    .split('\n')
    .filter(...)
    .join('\n');
}
```

Both `LABELED_CLAIM_LINE_RE` and `METADATA_LINE_RE` are defined as regex literals inside the function. This function is called on every structured response that passes validation. The regexes should be module-level constants.

---

### F9 — `buildStructuralBlockReason` uses array join over string concatenation — not an issue [NOTE]

The `.slice(0, 10).map(...).join('\n')` pattern followed by `[...].join('\n')` is the correct approach for building multi-line strings in this codebase. No inefficiency here.

---

### F10 — `HEDGED_BECAUSE.test(haystack)` called inside a per-occurrence loop for `because` [LOW]

**File:** `hallucination-audit-stop.cjs`, lines 372–376

```js
if (phrase === 'because') {
  if (HEDGED_BECAUSE.test(haystack)) {
    matches.push(...);
    break;
  }
```

`HEDGED_BECAUSE.test(haystack)` is called once per occurrence of the literal string `'because'` in `haystack`. If `haystack` contains "because" five times, the regex test runs five times before `break` is reached (on first match) or not at all (if no hedge). This is wasteful because the result does not depend on which occurrence of `because` triggered the outer loop. The hedged-because check should be hoisted outside the `while` loop, performed once at entry to the `'because'` phrase block.

---

## Summary table

| ID  | Location                             | Category               | Severity |
| --- | ------------------------------------ | ---------------------- | -------- |
| F1  | `parseClaimLines` — regex in loop    | Regex in loop          | HIGH     |
| F2  | `validateClaimStructure` — find×2    | O(N²) lookup           | MEDIUM   |
| F3  | `validateClaimStructure` — return    | O(N²) lookup           | MEDIUM   |
| F4  | `hasEnumerationNearby` — dual regex  | Regex in function      | LOW      |
| F5  | `main()` — loadLoopState called 2×   | Redundant I/O          | MEDIUM   |
| F6  | `CAUSAL` branch — MECHANISM_RE       | Regex in loop          | LOW      |
| F7  | `computeMemoryGate` — RETAINABLE Set | Duplicate constant     | LOW      |
| F8  | `stripLabeledClaimLines` — regexes   | Regex in function      | LOW      |
| F10 | `because` phrase loop — HEDGED test  | Redundant test in loop | LOW      |

## Hot-path impact ranking

The stop hook runs on every assistant message. Ordered by actual invocation frequency:

1. **F1** — `parseClaimLines` iterates over all lines for every structured message. A regex allocation per line is the highest-frequency waste.
2. **F5** — `loadLoopState` does a filesystem read. Calling it twice (in two different branches of the same execution path) doubles the I/O cost for no benefit.
3. **F2 / F3** — `claims.find()` in loops compounds with claim count. For typical messages (5–10 claims) the cost is small but the fix is free (reuse the already-built `seenIds` Map).
4. **F4, F6, F8, F10** — function-scoped regex definitions are the lowest-effort, zero-risk fixes. Each is a move-to-module-level change.
5. **F7** — the `RETAINABLE` Set duplication is cosmetic; deduplicate only when sharing the module is straightforward.
