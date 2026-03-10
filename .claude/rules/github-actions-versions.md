---
paths:
  - ".github/workflows/*.yml"
  - ".github/workflows/*.yaml"
---

# GitHub Actions Version Verification

Before writing or editing any `uses:` line in a workflow file, verify the current major version of the action.

## How to check

Use `node .claude/scripts/gh-api.cjs release latest <owner>/<action>` to get the current latest release tag:

```bash
node .claude/scripts/gh-api.cjs release latest actions/checkout
# → v6.0.2  (major: v6)
```

Then use the major pin in the workflow: `actions/checkout@v6`

## Rule

**Never copy a `uses:` version from another workflow file without verifying it.**
The source file may itself be outdated. Always verify the current major before writing any `uses:` line.

## Actions used in this repo

Before using any action, run:

```bash
node .claude/scripts/gh-api.cjs release latest <owner>/<action> --major
```

Examples:

```bash
node .claude/scripts/gh-api.cjs release latest actions/checkout --major
node .claude/scripts/gh-api.cjs release latest actions/setup-node --major
node .claude/scripts/gh-api.cjs release latest pnpm/action-setup --major
```

Use the returned major version directly in the `uses:` line. Do not guess. Do not copy from another workflow.
