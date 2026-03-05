# GitHub Projects V2 — Management

GitHub Projects V2 is the current projects system (board, table, roadmap views). Managed via GraphQL API through `octokit.graphql()`.

**Scope requirement**: `GITHUB_TOKEN` needs `project` scope.

## When to Use What

| Context                     | Tool                                                         |
| --------------------------- | ------------------------------------------------------------ |
| Discover project IDs/fields | `node .claude/scripts/sync-issues-to-project.cjs --discover` |
| Sync issues to board        | `node .claude/scripts/sync-issues-to-project.cjs`            |
| Scripted / multi-step       | `createGitHubClient()` + `octokit.graphql()`                 |

---

## Quick Commands

```bash
# Discover project IDs and field options
node .claude/scripts/sync-issues-to-project.cjs --discover

# Sync issues to project (dry-run)
node .claude/scripts/sync-issues-to-project.cjs --dry-run

# Full project setup (labels + instructions)
node .claude/skills/gh/scripts/github-project-setup.cjs setup
```

---

## Scripted Operations (JavaScript)

Use `octokit.graphql()` for Projects V2 operations.

```javascript
const { createGitHubClient } = require('./.claude/scripts/lib/github-client.cjs');
const octokit = createGitHubClient();

// Get project node ID and field option IDs
const result = await octokit.graphql(`{
  organization(login: "bitflight-devops") {
    projectV2(number: 1) {
      id
      fields(first: 20) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
      }
    }
  }
}`);

// Add issue to project
const { addProjectV2ItemById } = await octokit.graphql(`
  mutation AddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`, {
  projectId: 'PVT_kwXXX',
  contentId: 'I_kwXXX',  // issue node ID
});

// Set single-select field value
await octokit.graphql(`
  mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`, { projectId: '...', itemId: '...', fieldId: '...', optionId: '...' });
```

---

## Standard Project Structure

```text
Project: "Hallucination Detector Backlog"
  Fields:
    - Status: Backlog | Grooming | In Progress | Review | Done
    - Priority: P0 | P1 | P2 | Idea
    - Type: Feature | Bug | Refactor | Docs | Chore
  Views:
    - Board (grouped by Status)
    - Table (all fields visible)
    - Roadmap (grouped by Milestone)
```

SOURCE: GitHub Projects V2 GraphQL API — <https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects> (accessed 2026-02-21)
SOURCE: Octokit GraphQL — <https://github.com/octokit/graphql.js> (accessed 2026-02-21)
