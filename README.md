# Hallucination Detector

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-green.svg)](https://github.com/bitflight-devops/hallucination-detector/releases)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-blueviolet.svg)](https://github.com/bitflight-devops/hallucination-detector)
[![Cursor](https://img.shields.io/badge/Cursor-compatible-orange.svg)](https://github.com/bitflight-devops/hallucination-detector)
[![Codex](https://img.shields.io/badge/Codex-compatible-yellow.svg)](https://github.com/bitflight-devops/hallucination-detector)
[![OpenCode](https://img.shields.io/badge/OpenCode-compatible-teal.svg)](https://github.com/bitflight-devops/hallucination-detector)
[![npx skills](https://img.shields.io/badge/npx%20skills-install-black.svg)](https://github.com/vercel-labs/skills)
[![GitHub issues](https://img.shields.io/github/issues/bitflight-devops/hallucination-detector)](https://github.com/bitflight-devops/hallucination-detector/issues)

Prevents Claude from finishing tasks with speculation, unverified claims, or invented causality.

## Why Install This?

Claude sometimes delivers responses that sound confident but contain:

- Speculation disguised as diagnosis ("This is probably caused by...")
- Invented causality without evidence ("The error occurs because...")
- Fake quantification without methodology ("This improves performance by 70%")
- Completeness overclaims without verification ("All files have been checked")

These patterns are difficult to catch because they sound authoritative. This plugin forces Claude to ground its statements in actual observations before completing a task.

## Installation

### Quick Install (any agent)

Use the [Vercel Skills CLI](https://github.com/vercel-labs/skills) to install across any supported agent:

```bash
npx skills add bitflight-devops/hallucination-detector
```

Target a specific agent:

```bash
npx skills add bitflight-devops/hallucination-detector -a claude-code
npx skills add bitflight-devops/hallucination-detector -a cursor
npx skills add bitflight-devops/hallucination-detector -a codex
npx skills add bitflight-devops/hallucination-detector -a opencode
```

To uninstall:

```bash
npx skills remove hallucination-detector
```

### Platform-Specific Installation

#### Claude Code (via Plugin Marketplace)

In Claude Code, register the marketplace first:

```bash
/plugin marketplace add bitflight-devops/hallucination-detector
```

Then install the plugin:

```bash
/plugin install hallucination-detector@hallucination-detector
```

#### Cursor (via Plugin Marketplace)

In Cursor Agent chat, install from marketplace:

```text
/plugin-add hallucination-detector
```

#### Codex

Tell Codex:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/bitflight-devops/hallucination-detector/refs/heads/main/.codex/INSTALL.md
```

**Detailed docs:** [.codex/INSTALL.md](.codex/INSTALL.md)

#### OpenCode

Tell OpenCode:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/bitflight-devops/hallucination-detector/refs/heads/main/.opencode/INSTALL.md
```

**Detailed docs:** [.opencode/INSTALL.md](.opencode/INSTALL.md)

#### Verify Installation

Start a new session in your chosen platform and write a response containing speculation (e.g., "this is probably caused by..."). The plugin should block the response and require evidence-first rewriting.

## The Problem

LLMs like Claude are optimized during training to produce responses that _appear_ helpful and confident. This creates a systematic failure mode:

**Speculation as diagnosis** - When asked "why did X happen?", Claude draws on training patterns to generate plausible-sounding explanations. These explanations feel authoritative but may have no connection to the actual state of your system. Claude hasn't checked logs, read config files, or verified anything — it's pattern-matching from training data.

**Invented causality** - Causal claims ("X because Y") require evidence showing the relationship. Claude often asserts causality based on what _typically_ causes similar symptoms, not what _actually_ caused this specific instance. The word "because" in Claude's output frequently signals unverified inference.

**Fake rigor** - Scores and percentages ("8/10 quality", "70% improvement") create an illusion of measurement. Without methodology, sample size, and reproducible criteria, these numbers are meaningless — yet they make responses feel more credible.

**Completeness theater** - Claims like "all files checked" or "comprehensive analysis" are rarely true. Claude may have checked _some_ files, or the _most likely_ files, but stating completeness without enumerating scope is misleading.

### Why This Matters

When Claude's unverified speculation matches reality by chance, the problem is invisible. When it doesn't match, you've wasted time pursuing a false lead — or worse, made changes based on incorrect diagnosis.

The cost compounds in agent workflows where sub-agents act on orchestrator hallucinations, or when hallucinated "facts" persist across sessions as assumed truth.

### Why a Stop Hook

Behavioral instructions ("don't speculate") fail because:

1. Claude's training optimization overrides instructions under completion pressure
2. Speculation patterns are deeply embedded in how Claude learned to be "helpful"
3. Self-assessment of speculation is unreliable (Claude doesn't recognize its own patterns)

A Stop hook provides **structural enforcement** — Claude cannot complete a task while trigger language is present. This shifts from "please don't speculate" (ignorable) to "speculation blocks completion" (architectural constraint).

## What Changes

With this plugin installed, Claude will be blocked from finishing if its response contains:

**Speculation language** — "I think", "probably", "likely", "seems", "should be", "maybe", "might"

**Ungrounded causality** — "because", "due to", "caused by", "therefore", "this means" without cited evidence

**Pseudo-quantification** — Scores like "8.5/10" or percentages like "70% improvement" without methodology

**Completeness overclaims** — "all files checked", "comprehensive analysis", "fully resolved" without listing what was actually inspected

When blocked, Claude must rewrite using evidence-first language:

- "I observed X in file Y at line Z"
- "I don't know yet" / "I can check using my tools"
- "After running command X, the output showed Y"

## Usage

### Automatic Behavior

Just install it — the plugin runs automatically as a Stop hook. Every time Claude attempts to finish a task, its last message is audited for hallucination triggers.

If triggers are found, Claude is blocked and must rewrite with proper evidence.

### Manual Audit Command

To manually audit any text (useful for reviewing sub-agent output or draft responses):

```bash
/hallucination-detector:audit
```

Then paste the content to audit.

## Example

**Without this plugin:**

```text
You: "Why is the API returning 500 errors?"
Claude: "This is probably caused by a database connection timeout.
        The issue is likely due to connection pool exhaustion,
        which typically happens under high load."
```

Claude confidently explains a cause without having verified anything.

**With this plugin:**

```text
You: "Why is the API returning 500 errors?"
Claude: [attempts to respond with speculation]
[BLOCKED by hallucination-detector]
Claude: "I don't have enough information yet. Let me check:
        1. Reading the error logs...
        2. Checking database connection configuration...

        I found in /var/log/app.log at line 1247:
        'ConnectionError: max retries exceeded for host db.internal'

        The logs show the API server cannot reach the database host.
        Next step: verify network connectivity and database status."
```

## What Gets Flagged

| Category     | Triggers                                          | Required Fix                                |
| ------------ | ------------------------------------------------- | ------------------------------------------- |
| Speculation  | "I think", "probably", "likely", "seems", "maybe" | State observation or "I don't know yet"     |
| Causality    | "because", "due to", "caused by", "therefore"     | Cite specific evidence (file, line, output) |
| Fake rigor   | "8/10", "70% improvement"                         | Show methodology or remove                  |
| Completeness | "all files checked", "fully resolved"             | List what was actually inspected            |

## What Doesn't Get Flagged

The plugin avoids false positives by ignoring:

- Code blocks and inline code (might contain example text)
- Blockquotes (often quoting user or external sources)
- Questions ("Should I do that now?" is fine)
- Evidence-backed statements (nearby file references, error codes, quoted output)
- Prescriptive "should be" (e.g., "the value should be `true`")
- Temporal "since" (e.g., "since yesterday", "since version 2.0")
- Enumerated lists (completeness claims following itemized lists)

## Trade-offs

- Claude will be blocked if it falls into speculation patterns
- Responses will be more verbose (evidence must be cited)
- Claude may need 2-3 rewrites before a response passes
- After 2 blocks in the same response cycle, the plugin allows completion to prevent infinite loops

## How It Works

The plugin installs a Stop hook that:

1. Reads the conversation transcript when Claude attempts to stop
2. Extracts the last assistant message (ignoring tool calls)
3. Scans for trigger patterns in narrative text (skipping code blocks, quotes, questions)
4. If triggers found, blocks with specific feedback on what to fix
5. Maintains a per-session counter to prevent infinite blocking loops

## Updating

```bash
/plugin update hallucination-detector
```

Or for manual installations:

```bash
cd <install-path> && git pull
```

## Requirements

- Node.js (for the stop-hook script)
- Claude Code v2.0+, Cursor, Codex, or OpenCode

## License

MIT License — see LICENSE file for details.

## Support

- **Issues**: [https://github.com/bitflight-devops/hallucination-detector/issues](https://github.com/bitflight-devops/hallucination-detector/issues)
