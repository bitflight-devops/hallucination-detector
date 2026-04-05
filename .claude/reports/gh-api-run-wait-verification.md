# Verification: gh-api run wait + pr merge --auto fix

Date: 2026-03-10

## Changes implemented

### 1. `run wait <run-id>` subcommand

- New `runWait(octokit, runStr)` function added after `runCancel`
- Polls `octokit.rest.actions.getWorkflowRun` every `--interval` seconds (default 10)
- Gives up after `--timeout` seconds (default 300), exits 2
- On completion: table format (same columns as `run list`) or JSON via `--format json`
- Exit codes: 0 for success/skipped/neutral, 1 for other conclusions, 2 for timeout
- Wired into dispatch under `resource === 'run'`, `action === 'wait'`
- Usage line added to runtime help string

### 2. `pr merge --auto` fallback to direct merge

- When `--auto` is set, fetches PR `mergeable_state` before calling GraphQL mutation
- If `mergeable_state === 'clean'` or `'unstable'`: does direct REST merge immediately
- Only calls `enablePullRequestAutoMerge` for `'blocked'`/`'unknown'` states
- Prints `{ merged: true, method: 'direct', mergeable_state: ... }` on direct-merge path

## Manual test

```
node .claude/scripts/gh-api.cjs run wait 22917343542 --timeout 10
```

Output:

```
STATUS        CONCLUSION    BRANCH                                              ID
----------------------------------------------------------------------------------
completed     success       refs/pull/35/head                                   22917343542
EXIT:0
```

Run 22917343542 was already completed with conclusion `success`. Returned immediately, exit code 0.

## Lint

```
pnpm run lint
```

Result: `Checked 31 files in 31ms. No fixes applied.` — zero errors.

## Tests

```
pnpm test
```

Result: 7 test files, 304 tests, all passed.

## Deviations from spec

None. All behaviour matches spec exactly.
