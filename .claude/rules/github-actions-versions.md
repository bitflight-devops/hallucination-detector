---
paths:
  - ".github/workflows/*.yml"
  - ".github/workflows/*.yaml"
---

# GitHub Actions Version Verification

Before writing or editing any `uses:` line in a workflow file, ensure you use the current major version of the action.
Use `node .claude/scripts/gh-api.cjs release latest <owner>/<action>` to be shown the current latest release tag.
Then use the major pin in the workflow: `actions/checkout@v6`

