# Hybrid Hallucination Detection Architecture Research

**Date**: 2026-03-11

## Executive Summary

Production guardrail systems universally use a tiered architecture: fast deterministic checks (regex, heuristics) run first, and expensive LLM-based verification runs only when the fast path cannot decide with confidence. Claude Code natively supports this pattern through four hook types (`command`, `http`, `prompt`, `agent`) that can be composed on the same event. The key architectural decision is **where to draw the escalation boundary** -- which detections the regex path handles definitively vs. which require LLM judgment. Research from RouteLLM demonstrates that routing 50-75% of cases to the cheap path while escalating the rest preserves 95%+ of full-model accuracy at 2-4x cost reduction.

## Source Inventory

| #   | URL                                                                                                                           | Content                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | https://docs.claude.com/en/docs/claude-code/hooks-guide                                                                       | Claude Code hooks guide -- hook types, events, examples                                                      |
| 2   | https://docs.claude.com/en/docs/claude-code/hooks                                                                             | Claude Code hooks reference -- command/http/prompt/agent types, Stop/SubagentStop events, JSON output schema |
| 3   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/user-guides/guardrails-process.md                                 | NeMo Guardrails process -- input/dialog/output rails pipeline stages                                         |
| 4   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/reference/use-case-diagrams.md                                    | NeMo Guardrails combined architecture -- regex + NIM + third-party integration diagram                       |
| 5   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/configure-rails/guardrail-catalog/community/regex.md              | NeMo Guardrails regex detection rail -- built-in pattern matching for fast filtering                         |
| 6   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/configure-rails/guardrail-catalog/fact-checking.md                | NeMo Guardrails hallucination detection -- self-check, AlignScore, Patronus Lynx approaches                  |
| 7   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/research.md                                                       | NeMo Guardrails research -- references SelfCheckGPT (arXiv:2303.08896)                                       |
| 8   | https://github.com/nvidia/nemo-guardrails/blob/develop/nemoguardrails/benchmark/README.md                                     | NeMo Guardrails benchmarking -- latency measurement framework for guardrails overhead                        |
| 9   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/integration/langchain/langgraph-integration.md                    | NeMo Guardrails LangGraph integration -- performance considerations                                          |
| 10  | https://github.com/lm-sys/routellm/blob/main/README.md                                                                        | RouteLLM -- framework for routing between cheap/expensive models with threshold calibration                  |
| 11  | https://github.com/lm-sys/routellm/blob/main/benchmarks/README.md                                                             | RouteLLM benchmarks vs commercial offerings (Martian, Unify AI)                                              |
| 12  | https://github.com/meta-llama/llama-cookbook/blob/main/getting-started/responsible_ai/llama_guard/README.md                   | LlamaGuard -- input/output safety classifier for LLM inference                                               |
| 13  | https://github.com/openai/openai-cookbook/blob/main/articles/gpt-oss-safeguard-guide.md                                       | OpenAI gpt-oss-safeguard -- reasoning-based safety classification with harmony format                        |
| 14  | https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md                       | Claude Code plugin hook development -- hook events quick reference                                           |
| 15  | https://docs.claude.com/en/docs/claude-code/sdk/sdk-python#using-hooks-for-behavior-modification                              | Claude Code Python SDK -- programmatic hook registration                                                     |
| 16  | https://github.com/microsoftdocs/architecture-center/blob/main/docs/ai-ml/architecture/basic-azure-ai-foundry-chat-content.md | Azure AI Foundry architecture -- content filtering with classification models at low/medium/high strictness  |

## Technical Assessment

### 1. Cascading Classifier Architecture

The cascading classifier pattern is well-established across content moderation and safety systems. The core structure:

```
Input --> [Fast Deterministic Filter] --clear-pass--> Allow
                |
                |--clear-fail--> Block
                |
                |--uncertain----> [Expensive Classifier] --pass--> Allow
                                                         --fail--> Block
```

**Three decision outcomes from the fast path, not two.** The critical insight is that the fast filter produces THREE outcomes, not two: definite-safe, definite-unsafe, and uncertain. Only the uncertain bucket escalates. This is what distinguishes a cascade from a simple pipeline.

**NeMo Guardrails implements this explicitly.** Their architecture has separate rail types (Source 3, 4):

- **Regex detection rails** -- built-in, zero-dependency pattern matching for definitive cases (Source 5)
- **LLM-based rails** -- self-check fact checking, hallucination detection via model calls (Source 6)
- **Third-party integration rails** -- AlignScore (RoBERTa-based), Patronus Lynx, LlamaGuard (Source 4, 6)

The regex rail runs first and can reject outright. The LLM-based rails run only for content that passes the fast filter. The NeMo architecture diagram (Source 4) shows this as parallel pipelines that can be composed: regex rails + NIM classifiers + third-party models all available as rail implementations.

### 2. Confidence-Based Escalation

Two distinct approaches exist for determining when to escalate:

#### A. Threshold-based routing (RouteLLM pattern)

RouteLLM (Source 10) uses a trained router model that computes a "strong model win rate" for each input. If the score exceeds a configurable threshold, the query goes to the expensive model. Key findings:

- **85% cost reduction** while maintaining **95% GPT-4 performance** on MT Bench (Source 10)
- **Threshold calibration** uses historical data to find the optimal cutoff for a desired cost/quality tradeoff (Source 10)
- Four router implementations: matrix factorization (`mf`), weighted Elo (`sw_ranking`), BERT classifier, causal LLM classifier (Source 10)
- The `mf` router (matrix factorization) is recommended as the best tradeoff of speed vs accuracy (Source 10)
- Routers **generalize across model pairs** -- trained on GPT-4/Mixtral but work for other strong/weak pairs (Source 10)

**Comparison with commercial routers** (Source 11): RouteLLM's best router achieved equivalent MT Bench performance to Unify AI's router while routing only 25.4% to GPT-4 vs Unify AI's 45.6%. This demonstrates that a well-calibrated routing threshold can cut expensive-model usage by nearly half compared to naive approaches.

#### B. Heuristic confidence scoring (applicable to our regex-based system)

For our specific case (regex-based detection), escalation signals include:

1. **Match density** -- many low-confidence matches in a single response suggests ambiguity
2. **Suppression proximity** -- a match that nearly qualifies for suppression (evidence almost nearby, question-like but not quite) is uncertain
3. **Category conflict** -- the same text region triggering multiple categories simultaneously
4. **Context insufficiency** -- matches in short responses where the 150-char evidence window captures most of the text

These heuristics do not require a trained model. They emerge from the existing `findTriggerMatches()` suppression logic -- the same signals that trigger suppression rules can also signal uncertainty.

### 3. Production Guardrail System Architectures

#### NeMo Guardrails (NVIDIA)

**Architecture**: Event-driven pipeline with five rail categories -- input, dialog, retrieval, execution, output (Source 3). Rails are composable and ordered.

**Fast path**: Regex detection rails (Source 5) -- built-in, no additional packages, pattern-based blocking. Returns structured results with `is_match`, `text`, and `detections` fields.

**Slow path**: LLM-based rails for hallucination detection (Source 6):

- **Self-check fact checking**: Prompts the LLM to verify its own output against evidence. Returns a score 0.0-1.0.
- **Self-check hallucination**: Samples multiple alternative responses, then checks consistency (based on SelfCheckGPT, arXiv:2303.08896 -- Source 7). This is the most direct parallel to what an agent-type hook could do.
- **AlignScore**: Uses a RoBERTa-based model (not an LLM) for factual consistency scoring. Middle ground between regex and LLM.

**Performance note** (Source 8, 9): "Guardrails add latency due to additional LLM calls for safety checks." NeMo provides a benchmarking framework specifically to measure this latency overhead. Their documentation recommends caching and monitoring token usage.

#### LlamaGuard (Meta)

**Architecture**: A fine-tuned Llama model used as an input/output safety classifier (Source 12). Available in 1B, 8B, and larger variants.

**Key design**: LlamaGuard is itself the "expensive classifier" in the cascade. It is a specialized, smaller model fine-tuned for safety classification -- cheaper than calling the main LLM but more capable than regex. Meta provides it in quantized form to reduce inference cost.

**Customization**: Categories can be tuned via prompting or fine-tuning (Source 12). The taxonomy is not fixed.

#### OpenAI gpt-oss-safeguard

**Architecture**: A purpose-built reasoning model with the Harmony response format that separates reasoning from classification output (Source 13).

**Reasoning effort control**: The model supports `low`, `medium`, `high` reasoning effort -- an explicit latency/accuracy dial (Source 13). This is directly analogous to our fast-path/slow-path split but implemented within a single model.

#### Azure AI Foundry

**Architecture**: Uses "classification models" with configurable strictness levels (low, medium, high) for content filtering (Source 16). This is a platform-level cascade -- the strictness setting determines how aggressively the fast path filters.

### 4. Cost-Accuracy Trade-offs

Concrete data from RouteLLM research (Sources 10, 11):

| Metric                               | Value                                | Source    |
| ------------------------------------ | ------------------------------------ | --------- |
| Cost reduction with routing          | Up to 85%                            | Source 10 |
| Quality retention                    | 95% of GPT-4 performance on MT Bench | Source 10 |
| RouteLLM vs Unify AI at same quality | 25.4% vs 45.6% GPT-4 calls           | Source 11 |
| RouteLLM vs Martian at same quality  | 29.7% vs ~50% GPT-4 calls            | Source 11 |

**Extrapolation to our case**: The hallucination detector currently runs regex-only (command hook, <1s). Adding an agent hook for uncertain cases would add per-call LLM latency (default timeout: 60s per Source 2). If the regex path resolves 70-80% of cases definitively (clear pass or clear fail), the agent hook fires on only 20-30% of responses, keeping average latency well under the timeout.

NeMo Guardrails explicitly notes: "Consider caching strategies for repeated safety validations" (Source 9). For a stop hook, caching is less applicable since each response is unique, but the principle of minimizing LLM calls remains.

### 5. Claude Code Hook Architecture for Hybrid Detection

This is the most directly actionable section. Claude Code supports four hook types that can be composed on the same event (Source 2):

#### Hook Types Available

| Type      | Latency  | Cost                   | Capabilities                                                  | Default Timeout |
| --------- | -------- | ---------------------- | ------------------------------------------------------------- | --------------- |
| `command` | <1s      | Zero                   | Script execution, stdin JSON, exit codes                      | 600s            |
| `http`    | Variable | Zero (self-hosted)     | POST to endpoint, structured JSON response                    | 30s             |
| `prompt`  | 2-10s    | Per-token              | Single-turn LLM evaluation, yes/no decision                   | 30s             |
| `agent`   | 10-60s   | Per-token + tool calls | Multi-turn subagent with Read/Grep/Glob tools, up to 50 turns | 60s             |

Source: Source 2 (hooks reference documentation)

#### Prompt Hook Details

- Sends hook input + your prompt to a Claude model (Haiku by default) (Source 2)
- Returns structured JSON: `{ "ok": true/false, "reason": "..." }` (Source 2)
- Use `$ARGUMENTS` placeholder to inject the hook's JSON input into the prompt (Source 2)
- The `model` field is optional; defaults to "a fast model" (Source 2)
- When `ok` is `false`, the `reason` is fed back to Claude as its next instruction (Source 2)

#### Agent Hook Details

- Spawns a subagent with tool access (Read, Grep, Glob) (Source 2)
- Up to 50 turns of investigation before returning a decision (Source 2)
- Same decision schema as prompt hooks: `{ "ok": true/false, "reason": "..." }` (Source 2)
- Useful "when verification requires inspecting actual files or test output" (Source 2)

#### Supported Events for All Four Types

Stop, SubagentStop, PreToolUse, PostToolUse, UserPromptSubmit, PermissionRequest, PostToolUseFailure, TaskCompleted (Source 2)

#### Composition Pattern

Multiple hooks on the same event run **in parallel** and identical handlers are deduplicated (Source 2). This means:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/hallucination-audit-stop.cjs"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Evaluate the assistant response for hallucination: $ARGUMENTS",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Both hooks fire on every Stop event. There is **no built-in conditional escalation** -- you cannot make the prompt hook fire only when the command hook is uncertain. The command hook and prompt hook run independently and in parallel.

### 6. Proposed Hybrid Architecture for This Project

Given the constraints (command hooks run in parallel with prompt/agent hooks, no conditional chaining), there are three viable architectures:

#### Architecture A: Command-Only with Structured Output (Recommended First Step)

```
Stop event
  |
  v
[command hook: hallucination-audit-stop.cjs]
  |
  |-- definite match --> { "decision": "block", "reason": "..." }
  |-- no match --------> exit 0 (allow)
  |-- uncertain -------> { "decision": "block", "reason": "UNCERTAIN: [details]. Verify these claims..." }
```

The command hook enriches its block reason with structured uncertainty information. When uncertain, it blocks with an instructive reason that tells Claude what to verify. This preserves the single-hook architecture while adding nuance to the feedback.

**Pros**: Zero additional cost, zero latency increase, no architectural change.
**Cons**: Blocks on uncertainty rather than verifying -- may over-block.

#### Architecture B: Dual Hook with Command Pre-filter + Prompt Verifier

```
Stop event (parallel execution)
  |
  +--> [command hook: fast regex audit]
  |      Returns: { decision, reason, metadata: { uncertain_claims: [...] } }
  |
  +--> [prompt hook: LLM verification]
         Receives full $ARGUMENTS including last_assistant_message
         Evaluates hallucination independently
```

Both hooks run in parallel. The command hook handles clear cases fast. The prompt hook provides LLM-based judgment on every response. If either blocks, the response is blocked.

**Pros**: Defense in depth. LLM catches what regex misses.
**Cons**: Prompt hook runs on EVERY response (cost, latency). No way to make it conditional.

#### Architecture C: Command Hook as Gate + HTTP Callback to Conditional LLM

```
Stop event
  |
  v
[command hook: hallucination-audit-stop.cjs]
  |
  |-- definite match --> block
  |-- no match --------> allow
  |-- uncertain -------> POST to local HTTP service
                           |
                           v
                         [Local service calls Claude API directly]
                           |
                           v
                         Returns block/allow to command hook
```

The command hook calls an HTTP endpoint only for uncertain cases. The HTTP service runs the LLM verification and returns a decision. The command hook waits for the response (within its 600s timeout).

**Pros**: Conditional escalation -- LLM only fires for uncertain cases.
**Cons**: Requires running a local HTTP service. Adds operational complexity. The command hook blocks while waiting for the HTTP response.

#### Architecture D: Dual Hook with State File Coordination

```
Stop event (parallel execution)
  |
  +--> [command hook: fast regex audit]
  |      Writes uncertainty signals to temp file
  |      Returns: block/allow for definite cases
  |
  +--> [agent hook: reads temp file from command hook]
         If temp file exists with uncertain claims:
           Investigates using Read/Grep/Glob
           Returns: { ok: true/false, reason: "..." }
         If no temp file:
           Returns: { ok: true }
```

Uses the filesystem as a coordination channel between parallel hooks. The command hook writes its uncertainty analysis to a temp file. The agent hook reads it and investigates only the uncertain claims.

**Pros**: Conditional LLM usage without an HTTP service. Agent can inspect actual files referenced in claims.
**Cons**: Race condition -- command hook and agent hook run in parallel, so the agent may read the temp file before the command hook writes it. Requires timing coordination or polling.

### Recommended Architecture: A then D

**Phase 1 (immediate)**: Implement Architecture A. Enrich the command hook's block output with structured uncertainty metadata. Categories:

- `definite_match` -- current behavior, block with specific reason
- `uncertain_match` -- new, block with instructive verification guidance
- `no_match` -- current behavior, allow

This requires no new hook types and no cost increase.

**Phase 2 (when false-positive rate from uncertain blocking is measurable)**: Implement Architecture D. Add an agent hook that reads the command hook's uncertainty signals from a temp file and investigates. Use a polling strategy in the agent hook (check for temp file existence, retry for up to 2s) to handle the parallel execution race condition.

The agent hook prompt would be structured as:

```
You are verifying claims flagged as potentially hallucinated by a regex-based detector.
Read the uncertainty file at /tmp/claude-hallucination-uncertain-{sessionId}.json.
For each flagged claim, check if the assistant's statement is grounded in evidence
by searching the codebase or reading referenced files.
Return { "ok": true } if claims are grounded, { "ok": false, "reason": "..." } if not.
$ARGUMENTS
```

## Implementation Guidance

### Adding a prompt-type Stop hook alongside the existing command hook

In `hooks/hooks.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "description": "Fast regex-based hallucination audit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hallucination-audit-stop.cjs\""
          }
        ]
      },
      {
        "description": "LLM-based hallucination verification for uncertain cases",
        "hooks": [
          {
            "type": "agent",
            "prompt": "Check the assistant's last message for ungrounded factual claims. If claims reference specific files, tools, or data, verify them using Read and Grep. Focus on: (1) claims about code behavior without citing file contents, (2) statistics or metrics without sources, (3) causal claims ('X happens because Y') without evidence. Return {\"ok\": true} if claims are grounded or the response is opinion/instruction rather than factual assertion. Return {\"ok\": false, \"reason\": \"Ungrounded claim: [specific claim]\"} if a factual claim cannot be verified. Context: $ARGUMENTS",
            "timeout": 45
          }
        ]
      }
    ]
  }
}
```

### Enriching the command hook's uncertainty output

The command hook currently returns `{ "decision": "block", "reason": "..." }`. To support the hybrid architecture, the block reason can encode uncertainty:

```javascript
// In findTriggerMatches or the caller:
// When a match has suppression signals nearby but not close enough to suppress:
const isUncertain = hasPartialEvidence(text, rawText, match.offset);

if (isUncertain) {
  return {
    decision: "block",
    reason: `UNCERTAIN: "${match.evidence}" at offset ${match.offset} ` +
            `may be grounded but evidence is ambiguous. ` +
            `Verify: Does the preceding context contain a tool output, ` +
            `file read, or command result that supports this claim?`
  };
}
```

### Key design constraints from Claude Code hooks

1. **Parallel execution**: All hooks on the same event run in parallel (Source 2). There is no sequential chaining where hook A's output feeds hook B's input.
2. **Any block wins**: If any hook returns `decision: "block"`, the response is blocked regardless of other hooks' decisions.
3. **Fail-open on crash**: If a hook crashes, Claude Code treats it as "allow" (documented in project CLAUDE.md).
4. **State file coordination**: The existing hallucination detector already uses `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` for cross-invocation state. The same pattern can store uncertainty signals for agent hooks to read.
5. **Agent hook tool access**: Agent hooks can use Read, Grep, and Glob (Source 2). This means the agent can actually verify claims by reading the files or code referenced in the assistant's response.

## Comparative Analysis

| Criterion                  | Command Only (current)      | Command + Prompt                            | Command + Agent                             | Command + HTTP                |
| -------------------------- | --------------------------- | ------------------------------------------- | ------------------------------------------- | ----------------------------- |
| Latency (clear cases)      | <100ms                      | <100ms (command) + 2-10s (prompt, parallel) | <100ms (command) + 10-60s (agent, parallel) | <100ms                        |
| Latency (uncertain)        | <100ms (blocks immediately) | 2-10s (prompt decides)                      | 10-60s (agent investigates)                 | Variable (HTTP service)       |
| Per-response cost          | $0                          | ~$0.001-0.005 per response                  | ~$0.01-0.05 per uncertain response          | $0 + API costs for uncertain  |
| Accuracy (clear cases)     | High (regex tuned)          | Same as command                             | Same as command                             | Same as command               |
| Accuracy (uncertain)       | Over-blocks                 | Moderate (single-turn LLM)                  | High (multi-turn with tool access)          | High (if using capable model) |
| Operational complexity     | None                        | None (built-in)                             | None (built-in)                             | Requires HTTP service         |
| Can verify file references | No                          | No                                          | Yes (Read, Grep, Glob)                      | Yes (if service has access)   |

## Recommendations

1. **Start with Architecture A** (enriched command hook). This is zero-cost and provides the uncertainty signal infrastructure needed for later phases. The current `findTriggerMatches()` already has the suppression logic that can be repurposed as uncertainty signals.

2. **When ready for LLM verification, use agent hooks over prompt hooks.** The agent hook's ability to Read/Grep/Glob means it can actually verify claims against the codebase -- checking whether a referenced function exists, whether a file contains what the assistant claims, etc. This is fundamentally more capable than a prompt hook's single-turn yes/no judgment.

3. **The race condition between parallel hooks is the main engineering challenge.** The command hook and agent hook run simultaneously. If the agent hook needs the command hook's uncertainty analysis, the agent hook must either (a) independently detect uncertainty or (b) poll for the command hook's state file. Option (a) is cleaner but duplicates logic; option (b) requires a short delay.

4. **Monitor false-positive and false-negative rates separately for each path.** The command hook's definite-block and the agent hook's uncertain-block represent different error profiles. Track them independently to tune each path.

5. **Consider the prompt hook as a middle ground.** For cases where file verification is not needed (e.g., checking whether "95% of cases" has a cited source), a prompt hook (30s timeout, Haiku-fast) is cheaper and faster than an agent hook (60s timeout, multi-turn).
