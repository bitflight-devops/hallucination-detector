---
description: Check for CodeRabbit review feedback on the current PR before pushing
globs: "**/*.cjs,**/*.js,**/*.json"
---

# CodeRabbit Review Feedback

When working on a PR branch, check for CodeRabbit bot review comments after CI completes. CodeRabbit posts actionable prompts in its review bodies.

## How to check

```bash
# Find the PR number for the current branch
node .claude/scripts/gh-api.cjs pr list 2>&1 | node -e "
  const prs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const branch = require('child_process').execSync('git branch --show-current', {encoding:'utf8'}).trim();
  const pr = prs.find(p => p.head === branch);
  if (pr) console.log(pr.number);
"

# Extract CodeRabbit's AI agent prompts from review bodies
node .claude/scripts/gh-api.cjs issue comment search <PR_NUMBER> \
  --user "coderabbitai[bot]" \
  --section "Prompt for AI Agents" \
  --source reviews
```

## When to check

- After pushing and CI completes
- Before marking a PR as ready for human review
- When CodeRabbit has posted new reviews (visible in `review list`)

## What to do with findings

Each result contains a `content` field with a specific, actionable prompt. Evaluate each prompt against the current code — CodeRabbit reviews may reference stale line numbers after subsequent pushes. Verify the finding still applies before acting on it.
