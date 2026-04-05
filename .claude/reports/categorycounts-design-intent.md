# `categoryCounts` Design Intent Investigation

Generated: 2026-03-09

---

## 1. What is `categoryCounts` used for? Where does it go?

`categoryCounts` is a per-invocation tally of how many matches fired per detection category
during a single hook run. It is written as the `categories` field of a JSONL introspection log
entry via `appendIntrospectionLog()`.

**Code path** (`hallucination-audit-stop.cjs`):

- Lines 664–676: `categoryCounts` is declared and populated by iterating `matches`.
- Line 687: It is passed as `categories: categoryCounts` into `appendIntrospectionLog()`.
- Lines 590–597: `appendIntrospectionLog` serialises the full entry as a JSON line and appends
  it to the JSONL log file (path: `config.introspectOutputPath` or
  `os.tmpdir()/hallucination-detector-introspect.jsonl`, lines 657–659).

**Downstream consumer**: `hallucination-annotate.cjs`. This script reads the JSONL log to:

- Let the analyst annotate specific detection lines with `fp/fn/tp/tn` labels (`cmdAnnotate`,
  lines 108–154).
- Print a summary of detections and annotations (`cmdSummary`, line 195+).
- Record missed detections (`cmdAddNegative`, lines 163–187).

The `categories` field on each JSONL entry is how the annotate tool and downstream analysis
know which detection categories contributed to a match, enabling per-category accuracy tracking.

**This path is active only when `config.introspect === true`** (line 650). In normal blocking
mode, `categoryCounts` is never computed.

---

## 2. Authoritative source of truth for valid detection categories

`DEFAULT_WEIGHTS` in `hallucination-config.cjs` (lines 22–29) is the canonical registry:

```text
speculation_language: 0.25
causality_language: 0.3
pseudo_quantification: 0.15
completeness_claim: 0.2
fabricated_source: 0.1
evaluative_design_claim: 0.4
```

Evidence that `DEFAULT_WEIGHTS` is treated as canonical:

- `aggregateWeightedScore()` (line 523) iterates `Object.keys(DEFAULT_WEIGHTS)` to enumerate
  all valid categories — not the `scores` object, not `categoryCounts`.
- `loadConfig()` (line 63) validates user-supplied weight overrides against
  `Object.keys(DEFAULT_WEIGHTS)` — any key not in `DEFAULT_WEIGHTS` is ignored.

The `scores` object in `scoreSentence()` (lines 496–503) and `categoryCounts` (lines 664–671)
are both independent copies of the same six-key structure. They are hand-duplicated from
`DEFAULT_WEIGHTS`, not derived from it programmatically.

---

## 3. Is `categoryCounts` supposed to mirror the full set, or is it intentionally a subset?

It mirrors the full set — all six categories from `DEFAULT_WEIGHTS` are present in
`categoryCounts` (lines 664–671):

```text
speculation_language, causality_language, pseudo_quantification,
completeness_claim, fabricated_source, evaluative_design_claim
```

This matches `DEFAULT_WEIGHTS` exactly. The design intent is full parity.

However, the parity is maintained by hand-duplication, not by derivation. There is no
`Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0]))` pattern. If a new category
is added to `DEFAULT_WEIGHTS` (and to `findTriggerMatches`), `categoryCounts` will silently
stay at six keys — the new category will fire in matches but will not be counted.

---

## 4. What happens when a category fires but is absent from `categoryCounts`?

The guard on line 673 is:

```javascript
if (Object.hasOwn(categoryCounts, m.kind)) {
  categoryCounts[m.kind] += 1;
}
```

If a new category fires in `matches` but is not a key in `categoryCounts`, the branch is
silently skipped. The match still triggers blocking behavior (via `matches.length > 0` on
line 661), and the full `matches` array is still written to the JSONL log (line 683). What is
lost is the per-category count in the `categories` field of the log entry.

**Nothing is broken in terms of blocking behavior.** The log entry becomes incomplete:

- `matchCount` correctly reflects the total match count including the uncounted category.
- `matches` array contains all matches including the uncounted one.
- `categories` field shows `0` for the new category (key absent, not defaulted to 0 — the key
  simply will not exist).
- Downstream analysis tools reading `categories` will see the new category as absent, not as
  a zero count.

The failure mode is silent data incompleteness in the introspection log, not a crash or
incorrect blocking decision.

---

## 5. Does `hallucination-introspect.test.cjs` assert on the shape of `categoryCounts`?

No. The test file uses `categories` objects as **fixture data** fed into the JSONL log —
it does not assert on the shape produced by `hallucination-audit-stop.cjs`.

Observed test fixture shapes (lines 251–280, 424–429, 469):

```text
categories: {
  speculation_language: N,
  causality_language: N,
  pseudo_quantification: N,
  completeness_claim: N,
}
```

These fixtures contain only **four** categories — `fabricated_source` and
`evaluative_design_claim` are absent from every test fixture in the file.

There is no `assert.deepEqual` or `assert.strictEqual` call that checks the `categories` field
shape produced by the hook. The tests exercise `cmdAnnotate`, `cmdAddNegative`, and
`cmdSummary` against hand-authored fixture data, not against live hook output.

**Implication**: The test suite would not catch a mismatch between `DEFAULT_WEIGHTS` categories
and `categoryCounts` keys if a new category were added to one but not the other. The fixture
data using a four-key subset also means the test suite does not validate that the production
log actually emits all six keys.

---

## Summary of Findings

| Question                                               | Finding                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is `categoryCounts` for?                          | Per-invocation category hit counter; written as `categories` field in JSONL introspection log consumed by `hallucination-annotate.cjs`                                                                                                                                                                             |
| Authoritative category registry                        | `DEFAULT_WEIGHTS` in `hallucination-config.cjs` (lines 22–29)                                                                                                                                                                                                                                                      |
| Full set or subset?                                    | Intended full set, but maintained by hand-duplication — drift risk if `DEFAULT_WEIGHTS` is extended                                                                                                                                                                                                                |
| Missing category behavior                              | Silent skip via `Object.hasOwn` guard; blocking unaffected; JSONL `categories` field silently incomplete                                                                                                                                                                                                           |
| Test asserts on shape?                                 | No — tests use hand-authored 4-key fixture data; `fabricated_source` and `evaluative_design_claim` absent from all fixtures; no shape assertion against live hook output                                                                                                                                           |
| `fabricated_source` detection in `findTriggerMatches`? | **No.** Zero occurrences of `fabricated_source` in `hallucination-audit-stop.cjs`. The string exists only in `hallucination-config.cjs:27` (the weight registry). No match with `kind: 'fabricated_source'` is ever produced.                                                                                      |
| Git: when was `categoryCounts` introduced?             | Commit `04477fe` — "feat: add introspection mode for data-driven heuristic refinement" (merged via PR #27, released in v1.5.0 at `3a0c47e`). This is the oldest commit in the file's follow history touching introspection.                                                                                        |
| Was `fabricated_source` ever in `categoryCounts`?      | It is present in `categoryCounts` today (the key is initialized from `Object.keys(DEFAULT_WEIGHTS)` which includes it), but it can never increment above 0 because `findTriggerMatches` never emits `kind: 'fabricated_source'`. It was likely added to `DEFAULT_WEIGHTS` as a planned-but-unimplemented category. |

---

## 6. `fabricated_source` — weight without a detector

`fabricated_source` appears in `DEFAULT_WEIGHTS` (`hallucination-config.cjs:27`, weight `0.1`)
and therefore in `categoryCounts`'s initial zero-fill. However, `grep -n 'fabricated_source'
scripts/hallucination-audit-stop.cjs` returns no output. There is no detection logic — no
regex, no phrase list, no `matches.push({ kind: 'fabricated_source', ... })` anywhere in
`findTriggerMatches`.

Consequence: `categoryCounts.fabricated_source` will always be `0` at runtime. The JSONL
`categories` field will contain `"fabricated_source": 0` for every log entry. This is not a
`categoryCounts` bug — it is a gap between the weight registry and the detector implementation.
`categoryCounts` correctly reflects the fact that no matches fired; the detector simply doesn't
exist yet.
