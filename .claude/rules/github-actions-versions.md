---
paths:
  - ".github/workflows/*.yml"
  - ".github/workflows/*.yaml"
---

# GitHub Actions Version Verification

Before writing or editing any `uses:` line in a workflow file, verify the current major version of the action.

## How to check

```bash
# Check the latest release tag for any action
node .claude/scripts/gh-api.cjs run list  # not applicable — use WebFetch instead
```

Use `mcp__Ref__ref_read_url` to fetch the releases page:

```
https://github.com/<owner>/<action>/releases/latest
```

Example — before writing `uses: pnpm/action-setup@vN`:
1. Fetch `https://github.com/pnpm/action-setup/releases/latest`
2. Read the tag shown (e.g. `v4.1.0` → major is `v4`)
3. Use the major pin: `pnpm/action-setup@v4`

## Rule

**Never copy a `uses:` version from another workflow file without verifying it.**
The source file may itself be outdated. Always verify against the action's own releases page.

## Actions used in this repo

| Action | Verified major | Releases page |
|--------|---------------|---------------|
| `actions/checkout` | `v4` | https://github.com/actions/checkout/releases |
| `actions/setup-node` | `v4` | https://github.com/actions/setup-node/releases |
| `pnpm/action-setup` | `v4` | https://github.com/pnpm/action-setup/releases |

Update this table whenever a new action is added to a workflow.
