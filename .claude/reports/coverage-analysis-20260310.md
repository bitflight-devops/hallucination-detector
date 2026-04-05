# Coverage Analysis — 2026-03-10

## Coverage Numbers Per File

Run command: `node --test --experimental-test-coverage 'tests/**/*.test.cjs' 2>&1`

| File                                           | Line %    | Branch %  | Funcs %   | Uncovered Lines                                                                               |
| ---------------------------------------------- | --------- | --------- | --------- | --------------------------------------------------------------------------------------------- |
| `.claude/scripts/lib/story-helpers.cjs`        | 100.00    | 100.00    | 100.00    | —                                                                                             |
| `scripts/hallucination-annotate.cjs`           | 76.54     | 80.77     | 83.33     | 111-113 116-118 122-124 131-135 165-167 170-172 199-201 269-283 289-328 331-332               |
| `scripts/hallucination-audit-stop.cjs`         | 81.78     | 84.21     | 82.35     | 25-32 34-40 80-81 101 205-206 272 274 278-283 345-347 592-605 607-613 615-617 651-732 736-737 |
| `scripts/hallucination-config.cjs`             | 97.78     | 81.25     | 100.00    | 57-58                                                                                         |
| `tests/hallucination-audit-stop.test.cjs`      | 100.00    | 100.00    | 91.61     | —                                                                                             |
| `tests/hallucination-config.test.cjs`          | 100.00    | 100.00    | 100.00    | —                                                                                             |
| `tests/hallucination-introspect.test.cjs`      | 100.00    | 100.00    | 100.00    | —                                                                                             |
| `tests/rebuild-issue-bodies.test.cjs`          | 100.00    | 100.00    | 100.00    | —                                                                                             |
| `tests/repair-from-original-register.test.cjs` | 100.00    | 100.00    | 100.00    | —                                                                                             |
| `tests/story-helpers.test.cjs`                 | 100.00    | 100.00    | 100.00    | —                                                                                             |
| `tests/sync-issues-to-project.test.cjs`        | 100.00    | 100.00    | 100.00    | —                                                                                             |
| **all files**                                  | **95.05** | **94.49** | **95.64** |                                                                                               |

---

## GitHub Coverage Reporting

### What Exists Today

The CI workflow (`.github/workflows/ci.yml`) has a `test-node` job that runs `npm test`, which resolves to `node --test 'tests/**/*.test.cjs'` — no `--experimental-test-coverage` flag, no coverage upload step, no third-party coverage service configured.

`package.json` has no coverage-related scripts and no coverage dependencies (codecov, c8, nyc, etc.).

### Recommendation

**Use Node.js built-in coverage + GitHub job summary.** This stack uses `node:test` with `--experimental-test-coverage`, which outputs a coverage report to stdout in the TAP stream. The cleanest approach for this zero-dependency-runtime project is:

1. Add `--experimental-test-coverage` to the test command in CI only (not `package.json`, to avoid changing the local dev default).
2. Parse the coverage output and write it to `$GITHUB_STEP_SUMMARY` using a small inline shell script.
3. Optionally fail the job if coverage drops below a threshold.

No third-party service (Codecov, Coveralls) is needed. No new npm packages required. This approach keeps the zero-external-dependency principle intact.

### Exact CI Steps to Add

In `.github/workflows/ci.yml`, replace the `test-node` job's "Run tests" step with the following:

````yaml
- name: Run tests with coverage
  run: |
    if [ -f package.json ] && node -e "const p = require('./package.json'); process.exit(p.scripts && p.scripts.test ? 0 : 1)" 2>/dev/null; then
      npm install --ignore-scripts
      node --test --experimental-test-coverage 'tests/**/*.test.cjs' 2>&1 | tee /tmp/test-output.txt
      EXIT_CODE=${PIPESTATUS[0]}
      # Extract coverage table and append to job summary
      if grep -q "start of coverage report" /tmp/test-output.txt; then
        echo "## Test Coverage" >> "$GITHUB_STEP_SUMMARY"
        echo '```' >> "$GITHUB_STEP_SUMMARY"
        sed -n '/start of coverage report/,/end of coverage report/p' /tmp/test-output.txt >> "$GITHUB_STEP_SUMMARY"
        echo '```' >> "$GITHUB_STEP_SUMMARY"
      fi
      exit $EXIT_CODE
    else
      echo "No test script defined — running smoke test"
      node scripts/hallucination-audit-stop.cjs < /dev/null || true
      echo "Smoke test passed (script loaded without crash)"
    fi
````

This writes the coverage table to the GitHub Actions job summary (visible in the PR checks UI) with no external service dependency.

**Optional threshold enforcement** — add after `tee`:

```bash
# Fail if overall line coverage drops below 90%
OVERALL=$(grep "all files" /tmp/test-output.txt | awk '{print $4}' | tr -d '%')
if [ -n "$OVERALL" ] && [ "$(echo "$OVERALL < 90" | bc)" = "1" ]; then
  echo "Coverage $OVERALL% is below threshold 90%" >&2
  exit 1
fi
```

---

## Uncovered Line Classification — `scripts/hallucination-audit-stop.cjs`

### Lines 25-32 and 34-40: `readStdinJson()` and `safeReadFileText()`

```
25-32  function readStdinJson() { try { fs.readFileSync(0) } catch { return {} } }
34-40  function safeReadFileText(filePath) { try { fs.readFileSync(...) } catch { return '' } }
```

**Classification: integration-only / untestable catch branches.**

`readStdinJson` reads from file descriptor 0 (stdin). The catch branches (lines 29-31 and 37-39) fire when `readFileSync` throws. In the test environment these functions are not called directly with bad inputs. The catch-on-parse-error path in `readStdinJson` (line 29-30) is the only sub-branch that is testable by passing invalid JSON to `JSON.parse`. The `safeReadFileText` catch is a filesystem error path (bad path, permission denied) that requires OS-level manipulation.

**Worth adding:** A test for `readStdinJson` by exporting it and passing a non-JSON string to `JSON.parse` internally is possible but the function is not currently exported. Exporting it and adding a test for the `JSON.parse` failure path would cover lines 29-31 and is a genuine testable gap.

### Lines 80-81: `extractTextFromMessageContent` — `block.content` branch

```
79-81  if (typeof block.content === 'string' && block.content.trim()) {
         parts.push(block.content);
       }
```

**Classification: genuine testable gap.**

This branch handles content blocks with a `.content` string field instead of `.text`. No existing test exercises this block shape. Adding a test with `{ type: 'something', content: 'hello' }` would cover it.

### Line 101: `getLastAssistantText` — empty text fallback `return ''`

```
101  return '';
```

**Classification: genuine testable gap.**

The function returns `''` when no main-chain assistant entry with non-empty text is found. A test with a transcript containing only sidechain entries, or only user entries, would cover this.

### Lines 205-206: `isQualityScore` — `return true` for decimal numerator

```
195  if (numStr.includes('.')) return true;
```

**Classification: genuine testable gap.**

No test passes a decimal-numerator score like `7.5/10`. Adding `findTriggerMatches('The quality is 7.5/10.')` would cover lines 195-196 and confirm the decimal path flags correctly.

### Line 272 and 274: `should be` — `HYPOTHESIS_SHOULD` and `INSTRUCTIONAL_SHOULD` suppression branches

```
271  } else if (HYPOTHESIS_SHOULD.test(haystack)) {
272    // suppressed
273  } else if (INSTRUCTIONAL_SHOULD.test(haystack)) {
274    // suppressed
```

**Classification: genuine testable gap.**

Tests exist for the `PRESCRIPTIVE_SHOULD` and `EPISTEMIC_SUBJECT_SHOULD` branches. The hypothesis framing (`H0 should be rejected`) and instructional (`you should configure`) suppression branches have no tests. Both are straightforward to add.

### Lines 278-283: `should be` — question check fallback

```
278-283  } else if (lower.includes('should be')) {
           const idx = lower.indexOf('should be');
           if (!isIndexWithinQuestion(haystack, idx)) {
             matches.push(...)
           }
         }
```

**Classification: genuine testable gap.**

The final fallback that fires when none of the specific `should be` classifiers match. A bare `"The output should be correct."` (no identifier after "should be", no epistemic subject, no hypothesis framing) would exercise this path.

### Lines 345-347: `causality_language` — `HEDGED_BECAUSE` branch

```
344-347  if (HEDGED_BECAUSE.test(haystack)) {
           matches.push({ kind: 'causality_language', evidence: 'because (hedged)' });
           break;
         }
```

**Classification: genuine testable gap.**

No test exercises hedged-because (`"probably because"`, `"likely because"`). Adding one would cover lines 344-347.

### Lines 592-605: `loadLoopState()`

```
592-605  function loadLoopState(sessionId) { ... fs.readFileSync(statePath) ... }
```

**Classification: integration-only / untestable in isolation.**

`loadLoopState` reads from `os.tmpdir()`. The happy path requires a real temp file to exist. Both the success path (lines 598-600) and the catch-empty path (604) are filesystem-dependent. This function is only called from `main()`, which is itself not called in tests. Testing would require either exporting the function and mocking `fs`, or calling `main()` with a real temp file and fake stdin. Integration-only; not worth unit testing without a mocking layer this project doesn't have.

### Lines 607-613: `saveLoopState()`

**Classification: same as `loadLoopState` — integration-only.**

### Lines 615-617: `emitJson()`

```
615-617  function emitJson(obj) { process.stdout.write(...) }
```

**Classification: genuine testable gap, but low value.**

Not exported. Could be exported and tested by capturing stdout. Low value because the function is a single-line wrapper.

### Lines 651-732: `main()`

**Classification: integration-only / requires stdin + filesystem.**

`main()` is guarded by `require.main === module` (lines 735-736) and reads from stdin and the filesystem. Testing it requires spawning a child process with a real transcript file or mocking `fs` and `process.stdin`. This is an integration test concern, not a unit test concern. Expected to remain uncovered.

### Lines 736-737: `require.main === module` guard

**Classification: untestable by design.**

The `if (require.main === module)` guard is never true in test context. Expected uncovered.

---

## Uncovered Line Classification — `scripts/hallucination-config.cjs` (lines 57-58)

Lines 57-58 are the `catch` block inside `loadConfig()` that fires when `require(rcPath)` throws (e.g., syntax error in `.hallucinationrc.cjs`). The test suite tests the happy path and the missing-file path, but not a file that exists but throws on `require`. **Classification: genuine testable gap.** Adding a test that writes a syntactically invalid `.hallucinationrc.cjs` to a temp path and calls `loadConfig()` with that path would cover it.

---

## Uncovered Line Classification — `scripts/hallucination-annotate.cjs`

Lines 111-113, 116-118, 122-124, 131-135 are validation error paths in `cmdAnnotate` (bad line number, invalid label, empty log, out-of-range line). Lines 165-167, 170-172 are validation paths in `cmdAddNegative`. Lines 199-201 are the early-return path in `cmdSummary` when the log is empty. Lines 269-283 are `printUsage()`. Lines 289-328 are `main()`. Lines 331-332 are the `require.main` guard.

**Classification:**

- `printUsage()` (269-283): untestable without calling `main()` directly
- `main()` (289-328): integration-only (CLI entry point, requires process.argv manipulation)
- `require.main` guard (331-332): untestable by design
- Validation error paths (111-135, 165-172, 199-201): **genuine testable gaps** — all exported functions, all reachable with bad arguments

---

## Recommended New Tests

### High value — add to `tests/hallucination-audit-stop.test.cjs`

1. **`extractTextFromMessageContent` — `.content` block shape** (covers lines 80-81):
   - Input: `[{ type: 'result', content: 'some text' }]`
   - Expected: returns `'some text'`

2. **`getLastAssistantText` — no assistant entries** (covers line 101):
   - Input: transcript with only `{ type: 'user', message: { content: 'hi' } }`
   - Expected: returns `''`

3. **`isQualityScore` — decimal numerator** (covers lines 195-196):
   - Input to `findTriggerMatches`: `'The quality score is 7.5/10.'`
   - Expected: one `pseudo_quantification` match

4. **`should be` — hypothesis framing suppression** (covers line 272):
   - Input: `'H0 should be rejected based on the data.'`
   - Expected: no `speculation_language` match

5. **`should be` — instructional suppression** (covers line 274):
   - Input: `'You should configure the timeout value.'`
   - Expected: no `speculation_language` match

6. **`should be` — bare fallback trigger** (covers lines 278-283):
   - Input: `'The output should be correct.'`
   - Expected: one `speculation_language` match with evidence `'should be'`

7. **Hedged-because trigger** (covers lines 344-347):
   - Input: `'It failed probably because of the timeout.'`
   - Expected: one `causality_language` match with evidence `'because (hedged)'`

### Medium value — add to `tests/hallucination-config.test.cjs`

8. **`loadConfig` catch branch — require throws** (covers config lines 57-58):
   - Write a temp file with invalid JS syntax, set `HALLUCINATIONRC` env var to that path, call `loadConfig()`, expect it to return defaults without throwing.

### Lower value — skip

- `readStdinJson` catch (requires exporting the function — architectural change for marginal gain)
- `saveLoopState` / `loadLoopState` (integration-only, no mocking layer)
- `emitJson` (single-line wrapper, not exported)
- `main()` in any script (integration-only, CLI entry points)
