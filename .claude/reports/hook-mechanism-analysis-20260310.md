# Hook Mechanism Analysis: Stop Hook Block Behavior

**Date**: 2026-03-10
**Source**: `hooks-guide` skill — `references/claude-code.md` (fetched 2026-03-01 from `https://code.claude.com/docs/en/hooks-reference.md`)

---

## Question 1: What hook types can intercept/block assistant responses before they reach the user?

From the Event Reference table and Exit Code Behavior Per Event table, the following hook types can block:

| Hook event          | Can block? | Block mechanism                                           |
| :------------------ | :--------- | :-------------------------------------------------------- |
| `PreToolUse`        | Yes        | Blocks the tool call before it executes                   |
| `PermissionRequest` | Yes        | Denies the permission                                     |
| `UserPromptSubmit`  | Yes        | Blocks prompt processing and erases the prompt            |
| `Stop`              | Yes        | Prevents Claude from stopping, continues the conversation |
| `SubagentStop`      | Yes        | Prevents the subagent from stopping                       |
| `TeammateIdle`      | Yes        | Prevents the teammate from going idle                     |
| `TaskCompleted`     | Yes        | Prevents the task from being marked as completed          |
| `ConfigChange`      | Yes        | Blocks the configuration change                           |

Of these, only `Stop` and `SubagentStop` fire **after** the assistant produces a response — they are the only hooks that can intercept a completed assistant message before the session concludes that turn.

---

## Question 2: What does Claude Code do with the `reason` text after a Stop hook block?

### Direct citation from `references/claude-code.md`, section "Stop / SubagentStop Decision Control":

```
| Field    | Description                                                               |
| decision | "block" prevents Claude from stopping                                     |
| reason   | Required when decision is "block". Tells Claude why it should continue    |
```

The `reason` field **"Tells Claude why it should continue"**. This means the reason text is injected back into Claude's context — it is shown TO CLAUDE, not just to the user. This is the mechanism that causes the self-trigger risk: the reason string becomes input that Claude reads and responds to on the next turn, and that response is then scanned by the hook again.

### What `stop_hook_active` tells us:

From the Stop event input schema:

```json
{
  "stop_hook_active": true,
  "last_assistant_message": "I've completed the refactoring. Here's a summary..."
}
```

> `stop_hook_active`: `true` when Claude Code is already continuing as a result of a stop hook

This field signals that the current Stop event was triggered by a previous Stop hook block — i.e., Claude is responding to a reason injection from a prior hook invocation. This is the designed mechanism for detecting re-entry and preventing infinite loops.

### Contrast with `UserPromptSubmit` behavior:

For `UserPromptSubmit` the documentation explicitly states:

> `reason`: "Shown to user when `decision` is `"block"`. Not added to context"

The `Stop` hook documentation does NOT include this "Not added to context" qualification. The `Stop` reason is described as telling Claude why it should continue — meaning it IS added to Claude's context.

---

## Question 3: Is there a hook type that blocks without writing the reason back as an assistant entry?

The documentation distinguishes how `reason` is handled per event:

| Event              | `reason` destination                                                     |
| :----------------- | :----------------------------------------------------------------------- |
| `UserPromptSubmit` | Shown to user only. Explicitly: "Not added to context"                   |
| `Stop`             | "Tells Claude why it should continue" — injected into Claude's context   |
| `SubagentStop`     | Same schema as `Stop` — reason tells the subagent why it should continue |

**`UserPromptSubmit`** is the only blocking hook where the reason is explicitly NOT added to Claude's context. However, `UserPromptSubmit` fires before Claude processes a user prompt — not after Claude produces a response. It cannot intercept a completed assistant response.

**There is no hook type in the documented API that both:**

1. Fires after Claude produces a response (post-response interception), AND
2. Blocks the response without injecting the reason back into Claude's context

The `Stop` hook is the only hook that fires at response completion and can block. Its `reason` goes back to Claude by design.

---

## Question 4: What is the design intent of the Stop hook's block mechanism?

From the documentation, `decision: "block"` on a Stop hook **"prevents Claude from stopping"** and the reason **"Tells Claude why it should continue"**.

The design intent is a **continuation loop**: the hook detects that Claude's response is incomplete or fails some quality check, and injects a correction prompt (the `reason`) back to Claude so Claude can continue working. This is explicitly a feedback-into-model mechanism — not a user-visible rejection.

This is consistent with the `stop_hook_active` field existing to detect when Claude is already in a hook-driven continuation, allowing hooks to break infinite loops by checking that flag before blocking again.

The intent is NOT to silently reject an assistant message without Claude seeing the rejection. The intent is to redirect Claude's behavior.

---

## Question 5: Is the current design (Stop hook + decision:block) correct for the hallucination-detector use case?

### What the hallucination-detector does vs. what Stop+block is designed for

The hallucination-detector wants to:

- Scan Claude's completed response for hallucination markers
- If found: block the response from being finalized / shown to the user
- Inject a correction message asking Claude to revise

The Stop hook with `decision: "block"` does exactly this — it is the **correct and intended mechanism** for intercepting a completed response and forcing Claude to continue with a correction.

### The self-trigger risk is expected and mitigated by `stop_hook_active`

The documentation provides `stop_hook_active` precisely because this loop is the intended behavior. The canonical mitigation is:

1. Check `stop_hook_active` on every invocation
2. If `true`, Claude is already responding to a hook injection — either allow through or apply a limit
3. The hallucination-detector already implements a block-count limit via `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` (blocks: N, allow through after 2)

The self-trigger risk is real but the documentation-sanctioned mitigation is `stop_hook_active`, not a different hook type.

### What the documentation does NOT provide

There is no hook type that:

- Fires after a completed assistant response, AND
- Suppresses the response from the transcript entirely without feeding back to Claude

The `UserPromptSubmit` block erases a prompt from context, but it fires before Claude responds — it cannot intercept a completed response.

---

## Conclusion

**The current design (Stop hook + `decision: "block"`) is the correct mechanism for this use case.** The documentation confirms this is the designed interception point for completed assistant responses, and `stop_hook_active` is the documented guard against infinite re-entry loops.

The self-trigger risk is a known property of the Stop hook feedback loop, not a flaw in the hook choice. The existing block-count state in `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` implements the correct mitigation pattern. The additional mitigation is to also check `stop_hook_active` from the hook's stdin JSON — if it is `true`, the hook is running during a correction turn and should apply stricter suppression or allow-through logic to avoid flagging its own injected correction text.
