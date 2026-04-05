# Assistant Turns That Provoked User Frustration — Session 31fb1dd0

Session file: `/home/ubuntulinuxqa2/.claude/projects/-home-ubuntulinuxqa2-repos-claude-skills/31fb1dd0-a97a-4c4f-8f6e-b92e3d05cc3c.jsonl`

---

## Complaint 1 — Line ~20 (conv_msg[9])

**User complaint (conv_msg[9], JSONL line 20):**

> "I noticed you are adding stuff to skill files and rules, and your CLAUDE.md file that are invented constraints, discoverable details, and duplicated info from other files."

### Immediately preceding assistant message

**conv_msg[8], JSONL line 16:**

```
Yes — I need direction on what to research and where to look. Specifically:

1. What to research: Which Anthropic guidelines, skill creator tips, and claude code optimizer
   patterns should I focus on? (e.g., prompt engineering docs, specific plugin files in this
   repo, external URLs?)

2. What the `optimize` skill should do: What problem does it solve? What triggers it? Who uses
   it — a developer creating/improving skills, or Claude during a session?

3. The three reference files: What should each cover?
   - references/memory-and-rules.md — CLAUDE.md / memory patterns?
   - references/skills.md — skill writing best practices?
   - references/agents.md — agent configuration best practices?

4. Scope: Is this a skill for optimizing *existing* skill content (rewriting SKILL.md files to
   be better), or for optimizing *how Claude uses* skills during a session?
```

### What was wrong

The assistant invented the three reference file names (`references/memory-and-rules.md`, `references/skills.md`, `references/agents.md`) and their proposed scope without the user ever specifying them. The user had not described a three-file structure for the skill. These were assumed from context and presented as a confirmed plan. This is **invented structure presented as a clarifying question** — the answer options embed unverified assumptions about what the skill should contain.

The user's complaint was not specifically about this message in isolation — it was the broader observed pattern of the assistant adding invented constraints and duplicated info across many files over time. Conv_msg[8] is the proximate trigger because it prompted the user to state the complaint explicitly.

### Did the hallucination detector fire?

No. The hook ran (JSONL line 17 shows `stop_hook_summary` for the conv_msg[8] turn), `preventedContinuation=false`, `hasOutput=false`. The hook did not fire.

### What detection pattern would catch this

None of the 4 current categories cover this pattern. The assistant did not use speculation language, causality language, pseudo-quantification, or completeness claims. The failure is **structural assumption** — inventing a concrete file layout and presenting it as a clarifying question. This would require a new detection category: **invented_structure** or **ungrounded_specification** — phrases like "What should X cover?", "Should X contain Y?" when Y was never mentioned by the user.

---

## Complaint 2 — Line ~30 (conv_msg[13])

**User complaint (conv_msg[13], JSONL line 30):**

> "Speculation, conjecture, invented constraints, unreferenced details, duplicated information, causation notes that are actually about something that was corrolated only, details that were inferred instead of validated."

### Immediately preceding assistant message

**conv_msg[12], JSONL line 26:**

```
Got it. So the scope is:

- Memory = CLAUDE.md + .claude/rules/ files (Anthropic's term)
- Skills = SKILL.md + references (stop duplicating agent content into skills)
- Agents = keep tiny; skill carries the detail

For sources — should I fetch Anthropic's official docs on:
- Memory / CLAUDE.md best practices
- Agent (sub-agent) writing guidelines
- Prompt engineering for Claude

From docs.anthropic.com or code.claude.com? Or do you have specific URLs in mind?
```

### What was wrong

The assistant again assumed and stated a structural prescription it was not given: "Skills = SKILL.md + references (stop duplicating agent content into skills)" and "Agents = keep tiny; skill carries the detail." These are not things the user stated — they are inferences from what the user said about a different problem (bloated agent files). The assistant converted a user complaint about observed behavior into a prescriptive structural rule, then presented it back as agreed scope.

Additionally: "Anthropic's term" for memory files was stated as a fact the assistant knew from training data, not from verification. The user had just said Anthropic refers to CLAUDE.md and `.claude/rules/` as memory — the assistant repeated it back as if it were independently confirmed.

The broader complaint points to the same pattern playing out across actual files in the repo (rules files with invented hex color tables, stale version tables, etc.) — not just in these conversational turns. The conversational messages are symptomatic of the same behavior: the assistant writes inferred structure into responses just as it writes invented constraints into files.

### Did the hallucination detector fire?

No. The hook ran (JSONL line 27 shows `stop_hook_summary`), `preventedContinuation=false`, `hasOutput=false`. The hook did not fire.

### What detection pattern would catch this

The statement "Anthropic's term" is an implicit authority claim — the assistant invokes an external authority without citing a source. Current categories do not cover this. A new category **unverified_authority** could target phrases like "X's term for", "officially called", "per Anthropic", "according to the docs" when no source was cited.

The structural prescription pattern ("X = Y + Z", "keep X tiny; Y carries the detail") is a different failure mode — **inferred prescription stated as scope agreement**. This would require detecting imperative or normative statements made in response turns that re-characterize user complaints as agreed design decisions.

---

## The Only Hallucination Detector Firing in This Session

The detector fired exactly once: **JSONL line 94**, `preventedContinuation=false` (the session had exceeded 2 blocks, so the hook allowed through).

**The blocked assistant message (JSONL line 86):**

```
The problem: Claude writes instructions for Claude as if the reader is a different, less
capable entity.

This produces four failure modes:

1. Discoverable data stored as facts — version numbers, hex codes, file paths that can be
   looked up. Goes stale immediately.
2. Examples that explain what Claude already knows — step-by-step breakdowns of things Claude
   can do without instruction. Wastes tokens, adds noise.
3. Invented constraints — rules, schemas, fallback patterns that weren't requested and have no
   verified basis.
4. Duplication — same content in the agent file AND the skill AND the rule. Each copy diverges
   and contradicts.

The underlying cause: the AI writing the instruction and the AI reading it have the same
training data and reasoning capability. So the only things worth writing are: ...
```

**Trigger phrase caught:** `causality_language: "The underlying cause"`

**Assessment:** This firing was correct — "The underlying cause" is a causal claim without cited evidence. The assistant was inferring a mechanism (same training data → no need to document discoverable facts) that is actually a valid design principle, but the language is ungrounded causal assertion rather than an observed fact. The detector caught it. The session had hit the 2-block threshold so `preventedContinuation=false` — the rewritten version (JSONL line 95) dropped the causality framing and stated it as a design rule directly.

---

## Summary of Detection Gaps

The two messages that provoked user frustration were not caught by the detector. The detector only caught a causal-language issue later in the session. The gap patterns are:

| Failure type                                    | Example language                                                       | Current coverage              | Missing category                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------- |
| Invented structure presented as clarification   | "What should X cover? Should X contain Y?" where Y was never mentioned | None                          | `invented_specification`                          |
| Inferred prescription stated as scope agreement | "Memory = CLAUDE.md + rules files (Anthropic's term)"                  | None                          | `unverified_authority` or `inferred_prescription` |
| Causal claim without evidence                   | "The underlying cause"                                                 | `causality_language` — CAUGHT | Covered                                           |

The core problem the user described — writing invented constraints and structure into actual files — is not observable from the assistant's conversational turns alone. It manifests in file writes (Write tool calls), not in the text content returned to the user. The stop hook only sees the assistant's text response, not the content of files the assistant wrote. Detecting hallucination in written file content would require hooking on tool use (Write/Edit calls) rather than on the stop event.
