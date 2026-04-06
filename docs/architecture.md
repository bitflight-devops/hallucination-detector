# Hallucination Detector — Architecture Reference

A Claude Code stop-hook plugin that audits assistant output for speculation, ungrounded causality, pseudo-quantification, and completeness overclaims. Zero runtime dependencies. Two hooks (Stop and SessionStart), several CJS scripts, regex-based detection with structured claim annotation, configurable weights, and per-match confidence scoring.

## Runtime files

| File                                              | Role                                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/hallucination-audit-stop.cjs`            | **Stop hook** — core detection. Reads stdin JSON from Claude Code, parses JSONL transcript, extracts last assistant message, runs `findTriggerMatches()`, emits `{ "decision": "block", "reason": "..." }` or exits cleanly. |
| `scripts/hallucination-framing-session-start.cjs` | **SessionStart hook** — injects behavioral framing text into session context at startup.                                                                                                                                     |
| `scripts/hallucination-claim-structure.cjs`       | Structured claim annotation — classifies claims and annotates with evidence requirements.                                                                                                                                    |
| `scripts/hallucination-annotate.cjs`              | Annotation pipeline — marks up text with detected patterns and structured metadata.                                                                                                                                          |
| `scripts/hallucination-config.cjs`                | Configuration loading — `loadConfig()`, `loadWeights()`, `DEFAULT_WEIGHTS`, `DEFAULT_CONFIG`. Exports `isValidCategoryThreshold()` for per-category threshold validation.                                                    |
| `scripts/hallucination-db.cjs`                    | SQLite telemetry — `openDb()`, `_openDbAt()`, `writeStopHookLog()`, idempotent `migrateSchemaV2()`. Persists block events and confidence scores to `~/.hd/telemetry/hallucination-detector.db`.                              |
| `scripts/hallucination-memory-gate.cjs`           | Memory gate — `computeMemoryGate()` with `RETAINABLE_LABELS` for persistence gating.                                                                                                                                         |
| `hooks/hooks.json`                                | Registers both hooks with Claude Code.                                                                                                                                                                                       |

## Two-layer detection architecture

The stop hook runs two detection layers in sequence.

**Layer 1: Structured claim validation** — If the response contains labeled claim sections (`[VERIFIED]`, `[INFERRED]`, etc.), `validateClaimStructure()` runs first. Structural violations block before trigger scanning runs.

**Layer 2: Trigger-phrase backstop** — `findTriggerMatches()` scans for risky language. When the response is structured, properly labeled `[INFERRED]` or `[SPECULATION]` text is exempt from speculation triggers.

## Claude Code plugin I/O contracts

**Hook registration:** `hooks/hooks.json` uses `${CLAUDE_PLUGIN_ROOT}` which resolves to this repo root at runtime.

| Event          | Script                                    | I/O                                                                                                    |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SessionStart` | `hallucination-framing-session-start.cjs` | stdin: `{ session_id, transcript_path, source, model }`. stdout: plain text added to Claude's context. |
| `Stop`         | `hallucination-audit-stop.cjs`            | stdin: `{ session_id, transcript_path, stop_hook_active }`. stdout: JSON or empty.                     |

**Stop hook stdout contract (critical invariant):**

- `{ "decision": "block", "reason": "..." }` — blocks Claude. `reason` is fed back to Claude.
- Empty stdout + exit 0 — allows Claude to complete.

Altering this shape silently disables the hook. Hook crashes are treated as "allow" (fail-open).

**Environment variables:** `CLAUDE_PLUGIN_ROOT` (repo root), `CLAUDE_PROJECT_DIR` (user project root).

**Exit codes:** 0 = success. 2 = blocking error (stderr shown to Claude for Stop hooks). Other = non-blocking (verbose log only).

## Key functions

| Function                                                                  | File                                | Returns                                 |
| ------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------- |
| `validateClaimStructure(text)`                                            | `hallucination-claim-structure.cjs` | `{ structured, valid, errors, claims }` |
| `findTriggerMatches(text, config)`                                        | `hallucination-audit-stop.cjs`      | `[{ kind, evidence, confidence }]`      |
| `computeConfidence(matchStr, kind, haystack, idx, config, rawText?)`      | `hallucination-audit-stop.cjs`      | Integer 0–100                           |
| `recomputeStackingBonuses(rawMatches, rawMatchOffsets, haystack, config)` | `hallucination-audit-stop.cjs`      | void (mutates in place)                 |
| `computeMemoryGate(claims)`                                               | `hallucination-memory-gate.cjs`     | `{ allowed: Set, blocked: Set }`        |
| `loadConfig()` / `loadWeights()`                                          | `hallucination-config.cjs`          | Config/weight objects with defaults     |
| `isValidCategoryThreshold(value)`                                         | `hallucination-config.cjs`          | `boolean`                               |

## Trigger detection categories (8 active)

1. `speculation_language` — "I think", "probably", "likely", etc.
2. `causality_language` — "because", "caused by", "due to" without evidence nearby
3. `pseudo_quantification` — quality scores (N/10), ungrounded percentages
4. `completeness_claim` — "all files checked", "fully resolved", etc.
5. `evaluative_design_claim` — ungrounded quality/design assertions
6. `internal_contradiction` — contradiction between earlier and later claims
7. `unsupported_absence` — "does not exist", "there is no" without tool verification
8. `ungrounded_behavioral_assertion` — "it works", "fixed", "done" without evidence

## Suppression mechanisms

- `stripLowSignalRegions(text)` — removes code blocks, inline code, blockquotes before matching
- `stripLabeledClaimLines(text)` — removes properly labeled claim lines from trigger scanning
- `isIndexWithinQuestion(text, index)` — exempts sentences containing "?"
- `hasEvidenceNearby(text, rawText, index)` — window check for evidence markers; pass original unstripped text as `rawText`
- `hasEnumerationNearby(text, index)` — preceding window for numbered/bulleted lists

## Configuration fields

### `config.categories`

`DEFAULT_CONFIG.categories` is `{}`. Each key is a detection category name. Each value may include:

- `uncertain` and `hallucinated` — per-category threshold pair (both finite numbers in [0, 1], `uncertain <= hallucinated`). When present and valid, `scoreText()` uses these for sentences where that category is the sole active trigger. Invalid pairs are dropped with a stderr warning; other category fields are preserved.

`scoreText()` per-category behavior affects sentence label classification only — it does NOT change the block/allow gate decision.

### `config.confidenceWeights`

| Key                 | Default | Meaning                                                   |
| ------------------- | ------- | --------------------------------------------------------- |
| `patternStrength`   | 0.4     | Weight for intrinsic pattern strength                     |
| `evidenceProximity` | 0.25    | Weight for nearby evidence markers (reduces score)        |
| `categoryStacking`  | 0.2     | Weight for multiple categories firing on the same region  |
| `contextDensity`    | 0.15    | Weight for trigger density in the surrounding text window |

`recomputeStackingBonuses()` applies `categoryStacking` and `contextDensity` as a post-pass.

### `config.reportingThreshold`

Integer 0–100 (default 50). Matches below this are excluded from block reason text but still trigger the block. Reduces noise without reducing detection sensitivity.

## Claim label taxonomy

Seven canonical labels. Only `[VERIFIED]` and `[CAUSAL]` may persist to memory.

| Label           | Retain? | Required metadata  | Meaning                                                 |
| --------------- | ------- | ------------------ | ------------------------------------------------------- |
| `[VERIFIED]`    | yes     | `Evidence:`        | Backed by code, logs, tests, docs, tool output          |
| `[CAUSAL]`      | yes     | `Evidence:`        | Causation shown by experiment, mechanism, or comparison |
| `[INFERRED]`    | no      | `Basis:`           | Working theory; useful for reasoning, never for memory  |
| `[UNKNOWN]`     | no      | `Missing:`         | Missing evidence or unresolved ambiguity                |
| `[SPECULATION]` | no      | `Basis:`           | Low-evidence possibility                                |
| `[CORRELATED]`  | no      | `Evidence:`        | Association observed, causation not established         |
| `[REJECTED]`    | no      | `Contradicted by:` | Previously considered, now contradicted                 |

Key distinctions:

- `[UNKNOWN]` = no evidence to say anything. `[SPECULATION]` = proposing a low-evidence possibility.
- `[CORRELATED]` must never be rewritten as `[CAUSAL]`. Timing alone is not causation.
- `[CAUSAL]` requires mechanism, experiment, or controlled comparison — higher bar than `[VERIFIED]`.

## Structured response contract

**Required sections:** ANSWER, MEMORY WRITE. Omit other sections when no claims of that type exist.

**ANSWER:** Brief task acknowledgment and claim ID pointers only. No recommendations, conclusions, factual assertions, causal statements, or judgments.

**Evidence prefixes for VERIFIED/CAUSAL/CORRELATED:** Must use a normalized prefix: `File:` `Log:` `Test:` `Doc:` `Tool:` `User:` `Transcript:` `Code:` `Command:` `Output:` `Error:` `Config:` `Trace:` `Repro:`

```text
ANSWER
- Task acknowledged. Claim c1 identifies the root cause.

VERIFIED
- [VERIFIED][c1] <atomic claim>
  Evidence: File: scripts/hallucination-claim-structure.cjs:42

INFERRED
- [INFERRED][c2] <working theory>
  Basis: <why inferred>

MEMORY WRITE
- Allowed: c1
- Blocked: c2
```

**Validator error codes:**

| Code                                             | Condition                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `unlabeled_claim` / `unsupported_answer_content` | ANSWER contains blocked content                                     |
| `missing_claim_id`                               | Label present but no ID                                             |
| `duplicate_claim_id`                             | Same ID used twice                                                  |
| `missing_evidence` / `missing_basis` / etc.      | Required metadata field absent                                      |
| `invalid_memory_write`                           | MEMORY WRITE incorrectly lists retainable/non-retainable claims     |
| `vague_verified_evidence`                        | VERIFIED/CAUSAL uses non-specific text instead of normalized prefix |
| `unnormalized_evidence`                          | VERIFIED/CAUSAL/CORRELATED evidence has no recognized prefix        |

## Session state

One temp file per session: `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` storing `{ blocks: N }`. Prevents infinite loops — after 2 blocks, allows through.

## Extending the detector

### Adding a trigger detection category (Layer 2)

1. Add a new block inside `findTriggerMatches()` in `scripts/hallucination-audit-stop.cjs`
2. Follow the existing pattern: define phrases/regex, iterate, apply suppression, push `{ kind, evidence, confidence: computeConfidence(...) }`
3. Add tests in `tests/hallucination-audit-stop.test.cjs` — positive and negative (suppression) cases
4. Run `pnpm test` and `pnpm run lint`

### Adding a structural validation rule (Layer 1)

1. Add validation logic inside `validateClaimStructure()` in `scripts/hallucination-claim-structure.cjs`
2. Push `{ code: 'your_code', claimId, label, message }` to the errors array
3. Add tests in `tests/hallucination-claim-structure.test.cjs`
4. If the rule involves persistence, update `RETAINABLE_LABELS` in `hallucination-memory-gate.cjs`
5. Run `pnpm test` and `pnpm run lint`
