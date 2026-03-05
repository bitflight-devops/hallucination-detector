# Start Work on Issue

You are beginning work on GitHub issue **$ARGUMENTS**.

Follow these steps in order. Do not skip steps. Do not jump to implementation.

---

## Step 1: Load the issue

```bash
node .claude/scripts/gh-api.cjs issue view $ARGUMENTS
```

Read the full issue body, labels, milestone, and assignee. Extract:
- **Title** and **summary**
- **Impact type** label (e.g. `impact: additive`)
- **Risk level** label (e.g. `risk: low`)
- **Phase** label (e.g. `phase: 1-additive-patterns`)
- **Acceptance criteria** from the issue body

If no acceptance criteria exist in the body, state that and ask the user whether to proceed or define criteria first.

## Step 2: Load deep analysis and comments

```bash
node .claude/scripts/gh-api.cjs issue comment search $ARGUMENTS \
  --section "Deep Analysis: Implementation Impact"
```

If found, extract:
- Dependencies (blocked by / blocks)
- Files touched
- Failure modes
- Contract impact

If no deep analysis comment exists, proceed using the issue body alone. If a blocking dependency is listed and still open, warn the user before proceeding.

## Step 3: Determine workflow weight

Based on the labels extracted in Step 1:

- **Lightweight** (phase 1 + risk low + impact additive): Skip the research substep in Step 5. Go straight from understanding to objectives.
- **Standard** (everything else): Follow all substeps in Step 5.

## Step 4: Create a feature branch

Derive a branch name from the issue number and title:
- Format: `feat/<issue-number>-<kebab-case-slug>` (max 50 chars for the slug)
- Example: issue #15 "Cognitive bias detection" → `feat/15-cognitive-bias-detection`

Check if the branch exists first:

```bash
git branch --list "feat/$ARGUMENTS-*"
```

If it exists, check it out. Otherwise create it:

```bash
git checkout -b <branch-name>
```

## Step 5: Plan the work

Follow the Working Process defined in `.claude/CLAUDE.md` § "Working Process" (steps 1–4: understand, research, objectives, gap analysis). If this is a **lightweight** issue (Step 3), skip the research substep.

Read every file listed in the deep analysis "Files touched" section. If no deep analysis exists, identify the relevant files from the issue body and the "Adding a new detection category" section of `.claude/CLAUDE.md`.

Present the plan to the user as a todo list before starting implementation.

## Step 6: Implement

Delegate JavaScript implementation to the `javascript-pro` agent per project rules. Provide:
- The spec (what to change, interfaces, consistency rules)
- Files to create or modify
- Shared modules to use or create

## Step 7: Verify

Run verification:

```bash
pnpm test
pnpm run lint
```

Confirm each acceptance criterion from the issue is met with evidence (test output, grep results, file reads). Do not assert completion without proof.

## Step 8: Commit and push

Stage and commit with a conventional commit message referencing the issue:

```
feat: <description> (#$ARGUMENTS)
```

or `fix:`, `chore:`, etc. as appropriate for the change type.

Push to the feature branch:

```bash
git push -u origin <branch-name>
```

## Step 9: Create a PR

```bash
node .claude/scripts/create-pr.cjs --title "<type>: <description>" --body "Closes #$ARGUMENTS

## Summary
<what changed and why>

## Test plan
- [ ] pnpm test passes
- [ ] pnpm run lint passes
- [ ] <acceptance criteria from issue>"
```

## Step 10: Post-push workflow

Follow the post-push workflow from `.claude/CLAUDE.md`:
1. Watch CI until completion
2. Read CodeRabbit review feedback
3. Check for review comments
4. Fix any issues and push again
