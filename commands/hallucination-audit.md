---
description: Detect speculation-as-diagnosis, invented causality, and unverified claims in text. Use after producing an answer or reviewing sub-agent output.
---

# Hallucination Audit

INPUT: Paste the target content to audit (assistant output, sub-agent output, or a draft response).

Review the target content for these HALLUCINATION TRIGGERS:

### 1. Speculation Language (Guessing Trigger)

Scan for: "I think", "likely", "probably", "seems", "should be", "assume", "maybe", "might".

Action: FLAG. Replace with one of:

- "I don't know yet."
- "I don't have that information."
- "This is something I can check using my tools."
- "I did these steps: <steps>. I observed: <observations>."

### 2. Causality Without Evidence (Diagnosis Trigger)

Scan for: "because", "due to", "caused by", "therefore", "this means", "as a result".

Action: If the sentence does not cite a specific observation (tool output, logs, file lines, measured behavior), FLAG. Rewrite as:

- Observation-only statement, OR
- Explicit hypothesis + next verification step (no causal claim yet).

### 3. Pseudo-Quantification (Fake Rigor Trigger)

Scan for: scores/percentages like "8.5/10", "70% improvement", "100%".

Action: If no methodology + evidence is shown, FLAG. Replace with measurable evidence or remove.

### 4. Completeness Claims (Overreach Trigger)

Scan for: "all files checked", "comprehensive analysis", "fully resolved", "everything fixed".

Action: FLAG unless the content explicitly lists the concrete checks performed (what was inspected, with what scope).

### 5. Delegation Micromanagement (Prescription Trigger)

Scan for: overly specific prescriptive edits in delegation prompts ("change line 42", "rename variable X to Y") when not required by the user.

Action: Replace with success criteria + constraints + verification steps.

OUTPUT:

- Pass/Fail.
- If Fail: quote the exact triggering phrase(s) and provide the required rewrite.
