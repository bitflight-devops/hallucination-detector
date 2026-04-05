# Prompt Hook Stop Event — What the LLM Receives

Source: https://code.claude.com/docs/en/hooks.md (accessed 2026-03-09)

---

## Question 1: Does Claude Code resolve `transcript_path` and inject the file content, or does Haiku only receive the raw JSON with the path string?

**Answer: Haiku receives only the raw JSON with the path string. No file content is injected.**

The docs state explicitly:

> Use the `$ARGUMENTS` placeholder to inject the hook's JSON input data into your prompt text. Claude Code sends the combined prompt and input to a fast Claude model, which returns a JSON decision.

The `prompt` field description:

> The prompt text to send to the LLM. Use `$ARGUMENTS` as a placeholder for the hook input JSON. If `$ARGUMENTS` is not present, input JSON is appended to the prompt

The Stop hook example shows what `$ARGUMENTS` expands to — it is the raw hook input JSON, which for Stop events includes `transcript_path` as a string field. The docs show no mechanism by which Claude Code reads that file and injects its contents.

The Stop hook input JSON (from the common input fields documented for all events) includes:

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  ...
}
```

`transcript_path` is a path string. The docs describe no step where Claude Code opens that file and injects its contents before sending to Haiku.

---

## Question 2: Is there any documented way for a prompt hook to access file content?

**Answer: Not for `type: "prompt"`. Only `type: "agent"` hooks can access file content.**

From the docs:

> **Agent-based hooks** (`type: "agent"`) are like prompt-based hooks but with multi-turn tool access. Instead of a single LLM call, an agent hook spawns a subagent that can read files, search code, and inspect the codebase to verify conditions.

> When an agent hook fires:
>
> 1. Claude Code spawns a subagent with your prompt and the hook's JSON input
> 2. The subagent can use tools like Read, Grep, and Glob to investigate
> 3. After up to 50 turns, the subagent returns a structured `{ "ok": true/false }` decision

The contrast is explicit:

> Agent hooks are useful when verification requires inspecting actual files or test output, not just evaluating the hook input data alone.

For `type: "prompt"`, the docs state:

> Instead of executing a Bash command, prompt-based hooks:
>
> 1. Send the hook input and your prompt to a Claude model, Haiku by default
> 2. The LLM responds with structured JSON containing a decision
> 3. Claude Code processes the decision automatically

No tool access, no file reading — single-turn only. The only input available to the Haiku model is the combined prompt string + hook input JSON via `$ARGUMENTS`.

---

## Summary

| Hook type        | Gets raw JSON with `transcript_path` string | Can read transcript file contents |
| ---------------- | ------------------------------------------- | --------------------------------- |
| `type: "prompt"` | Yes                                         | No — no tool access               |
| `type: "agent"`  | Yes                                         | Yes — via Read tool               |

To access transcript file content in a Stop hook, `type: "agent"` is required. A `type: "prompt"` hook cannot read the transcript; it only sees the path string.
