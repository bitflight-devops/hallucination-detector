# RAG Groundedness/Faithfulness Scoring: Framework Analysis

Date: 2026-03-11

## Executive Summary

All major RAG evaluation frameworks converge on a single architectural pattern: **claim decomposition followed by per-claim entailment checking against source material**. The formula is universally `supported_claims / total_claims`. Frameworks differ in whether the entailment step uses an LLM-as-judge (RAGAS, DeepEval, TruLens, LangSmith) or a specialized small model (Vectara HHEM, AlignScore). No framework offers a pure rule-based/heuristic groundedness scorer -- the closest is Vectara's HHEM-2.1-Open, a 248M-parameter T5 model that runs on CPU in ~1.5 seconds. For our synchronous Node.js hook, the practical spectrum runs from regex-based heuristics (what we have now) through small-model NLI to LLM-as-judge.

## Source Inventory

| #   | URL                                                                                                                                                       | Description                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | https://github.com/explodinggradients/ragas/blob/main/docs/concepts/metrics/available_metrics/faithfulness.md?plain=1#L1#faithfulness                     | RAGAS Faithfulness metric documentation                   |
| 2   | https://github.com/explodinggradients/ragas/blob/main/docs/concepts/metrics/available_metrics/faithfulness.md?plain=1#L39#faithfulness-with-hhem-2-1-open | RAGAS Faithfulness with HHEM variant                      |
| 3   | https://github.com/explodinggradients/ragas/blob/main/docs/concepts/metrics/available_metrics/nvidia_metrics.md?plain=1#L140#response-groundedness        | RAGAS/NVIDIA Response Groundedness metric                 |
| 4   | https://github.com/confident-ai/deepeval/blob/main/docs/docs/metrics-hallucination.mdx?plain=1#L1                                                         | DeepEval HallucinationMetric documentation                |
| 5   | https://github.com/confident-ai/deepeval/blob/main/docs/docs/metrics-faithfulness.mdx?plain=1#L117#how-is-it-calculated                                   | DeepEval FaithfulnessMetric calculation                   |
| 6   | https://www.trulens.org/getting_started/core_concepts/rag_triad/                                                                                          | TruLens RAG Triad concept documentation                   |
| 7   | https://github.com/truera/trulens/blob/main/src/feedback/trulens/feedback/llm_provider.py                                                                 | TruLens groundedness implementation source code           |
| 8   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/configure-rails/guardrail-catalog/fact-checking.md?plain=1#L1                                 | NeMo Guardrails fact-checking and hallucination detection |
| 9   | https://huggingface.co/vectara/hallucination_evaluation_model                                                                                             | Vectara HHEM-2.1-Open model card                          |
| 10  | https://docs.langchain.com/langsmith/evaluation-approaches.md                                                                                             | LangSmith RAG evaluation approaches                       |

## Technical Assessment

### 1. RAGAS -- Faithfulness Metric

**Source**: [1], [2], [3]

**Architecture**: Two-step LLM pipeline.

- **Step 1 -- Claim Decomposition**: An LLM breaks the response into individual atomic statements/claims.
- **Step 2 -- Entailment Verification**: For each claim, the LLM checks whether it can be inferred from the retrieved context.
- **Score**: `number_of_supported_claims / total_claims` (range 0.0 to 1.0).

**Worked example** (from source [1]):

> Response: "Einstein was born in Germany on 20th March 1879."
> Context: "Albert Einstein (born 14 March 1879) was a German-born theoretical physicist"
> Claims extracted: ["Einstein was born in Germany", "Einstein was born on 20th March 1879"]
> Verdicts: [supported, not supported]
> Score: 1/2 = 0.5

**Non-LLM variant**: RAGAS supports Vectara's HHEM-2.1-Open as a drop-in replacement for Step 2 (source [2]). The LLM still performs Step 1 (claim decomposition), but the entailment check uses the small T5-based classifier model instead.

**NVIDIA Response Groundedness variant** (source [3]): Uses two independent LLM judgments on a 0/1/2 scale, averages them. More token-efficient than full Faithfulness but provides less explainability (no per-claim breakdown).

**Key observation**: Claim decomposition (Step 1) is the hardest part to do without an LLM. RAGAS does not offer a rule-based claim extraction method.

### 2. DeepEval -- Faithfulness and Hallucination Metrics

**Source**: [4], [5]

DeepEval provides two distinct metrics:

**FaithfulnessMetric** (source [5]):

- Same architecture as RAGAS: extract claims from output, classify each against retrieval context.
- Formula: `number_of_truthful_claims / total_claims`
- A claim is truthful if it **does not contradict** any facts in the retrieval context.
- Supports `truths_extraction_limit` to cap the number of facts extracted from context.

**HallucinationMetric** (source [4]):

- Inverted perspective: uses context as source of truth, checks how many context items are contradicted.
- Formula: `number_of_contradicted_contexts / total_contexts`
- The distinction: Faithfulness decomposes the **output** into claims; Hallucination checks the **context** for contradictions.
- Default model: gpt-4.1. Supports custom LLM providers.

**Key observation**: DeepEval defines "truthful" as "does not contradict" rather than "is supported by" -- a weaker standard. A claim about something not mentioned in context would pass Faithfulness but represents an actual grounding failure. This is a known trade-off in the field.

### 3. TruLens -- Groundedness with Chain-of-Thought

**Source**: [6], [7]

**Architecture** (from source code, source [7]):

1. **Sentence tokenization**: Uses NLTK `sent_tokenize()` to split the response into sentences. Falls back to LLM-based splitting if configured.
2. **Trivial statement filtering**: Removes trivial/filler sentences (e.g., "Hi.", "I'm here to help.") via `_remove_trivial_statements()` to avoid diluting the score.
3. **Per-sentence LLM evaluation**: Each non-trivial sentence is evaluated against the source material using a chain-of-thought prompt. The LLM returns a score (0-3 by default) and reasoning.
4. **Aggregation**: Scores are normalized to [0,1] and averaged across all sentences.

**Distinctive features**:

- Uses `ThreadPoolExecutor` for parallel sentence evaluation.
- Returns structured reasons with `criteria`, `supporting_evidence`, and `score` for each statement.
- Abstentions (responses like "I don't know") are treated as grounded.
- Configurable: `use_sent_tokenize`, `filter_trivial_statements`, custom `criteria`, `additional_instructions`, `examples`.

**Key observation**: TruLens is the only framework that uses sentence-level (not claim-level) decomposition by default. This is simpler but coarser -- a sentence can contain multiple claims. TruLens also uniquely filters trivial statements before scoring.

### 4. LangSmith -- Answer Faithfulness

**Source**: [10]

LangSmith provides evaluation as LLM-as-judge prompts hosted in its prompt hub. The RAG evaluation summary table (source [10]) shows:

| Evaluator           | Detail                                     | LLM-as-judge?                 |
| ------------------- | ------------------------------------------ | ----------------------------- |
| Answer faithfulness | "Is the answer grounded in the documents?" | Yes -- uses a prompt template |

The actual prompt is hosted at `smith.langchain.com/hub/langchain-ai/rag-answer-hallucination`. The documentation does not describe the prompt's internal logic, but the architecture is a single LLM call with the documents and answer as input. LangSmith does not decompose claims -- it asks the LLM to make a holistic judgment.

**Key observation**: LangSmith's approach is the simplest (single LLM call) but least granular (no per-claim scores).

### 5. NeMo Guardrails -- Self-Check Fact-Checking

**Source**: [8]

NeMo Guardrails provides runtime output rails for fact-checking:

**Self-Check Fact-Checking**:

- Prompt template uses NLI framing: `"You are given a task to identify if the hypothesis is grounded and entailed to the evidence."`
- Input: `{{ evidence }}` (relevant chunks) + `{{ response }}` (bot response)
- Output: "yes"/"no" mapped to a 0.0-1.0 score
- Threshold-based blocking: score < 0.5 triggers refusal

**Self-Check Hallucination** (no context variant):

- Based on SelfCheckGPT paper (arxiv:2303.08896)
- Samples multiple alternative responses from the LLM
- Checks consistency between original and sampled responses using NLI framing
- Does not require retrieval context -- uses self-consistency as a proxy

**AlignScore Integration**:

- Uses a RoBERTa-based model for factual consistency scoring
- Requires a running AlignScore server endpoint
- Returns a numeric score rather than binary yes/no

**Key observation**: NeMo Guardrails is the closest to our use case architecturally -- it's a runtime guard that blocks or warns, not an offline evaluation tool. The self-check hallucination approach (sample-then-compare) works without retrieval context.

### 6. Vectara HHEM-2.1-Open

**Source**: [9]

**Architecture**: Fine-tuned T5-base model (~248M parameters) trained as a binary classifier for hallucination detection.

**Input format**: Premise-hypothesis pairs.

```
Premise: {source_text}
Hypothesis: {claim_text}
```

**Output**: Score 0.0-1.0 where 0 = hallucinated, 1 = consistent.

**Performance characteristics** (from source [9]):

- Runs on CPU, <600MB RAM at 32-bit precision
- ~1.5 seconds for 2k-token input on modern x86 CPU
- Unlimited context length (vs. 512-token limit in HHEM-1.0)
- Outperforms GPT-3.5-Turbo and GPT-4 zero-shot on RAGTruth benchmarks

**Benchmark results** (RAGTruth-QA, from source [9]):
| Model | Balanced Accuracy | F1 |
|-------|------------------:|---:|
| HHEM-2.1-Open | 74.28% | 60.00% |
| GPT-4 zero-shot | 74.11% | 57.78% |
| GPT-3.5-Turbo | 56.16% | 25.00% |

**Key observation**: HHEM achieves GPT-4-level accuracy at a fraction of the cost and latency. It requires Python (transformers library) or an inference server, which creates a deployment complexity for our Node.js hook.

## Common Patterns Across All Frameworks

### Universal Architecture

Every framework follows this pipeline:

```
Response Text
    |
    v
[Decompose into atomic units]  <-- claims (RAGAS, DeepEval) or sentences (TruLens)
    |
    v
[Check each unit against source]  <-- LLM-as-judge or NLI model
    |
    v
[Aggregate scores]  <-- supported/total (ratio)
    |
    v
Score: 0.0 - 1.0
```

### Shared Design Decisions

1. **Decomposition granularity**: Claims (fine-grained, LLM-dependent) vs. sentences (coarser, rule-based via tokenization).
2. **Entailment direction**: "Is the claim supported by the source?" (RAGAS, TruLens) vs. "Does the claim contradict the source?" (DeepEval Hallucination). The "supported by" framing is stricter.
3. **Aggregation**: Simple ratio (supported/total) in all cases.
4. **No framework offers pure heuristic scoring**: All require either an LLM or a specialized NLI model for the entailment step.

### What None of Them Do (rule-based)

No framework provides a rule-based groundedness scorer. The entailment step universally requires a model because:

- Paraphrasing: "Einstein was born in 1879" vs. "born 14 March 1879" requires semantic understanding.
- Negation: "The system is not slow" vs. "The system is fast" requires logical reasoning.
- Implication: "I visited Iowa" vs. "I visited the United States" requires world knowledge.

## Implementation Guidance for Our Use Case

### Spectrum of Approaches

#### Tier 1: Pure Heuristic (what we have now, extended)

**No model required. Synchronous Node.js compatible.**

Extend the existing regex-based detection to cover groundedness heuristics:

1. **Citation absence detection**: Flag claims that reference specific facts (dates, numbers, names, versions) without a corresponding tool output in the transcript containing those facts.
2. **Semantic anchor matching**: Extract key entities/values from tool outputs, check if response claims about those entities have corresponding anchors in tool output.
3. **Specificity without source**: Detect patterns like precise numbers, version strings, URLs, or filenames that don't appear in any tool output.
4. **Hedging language** (already implemented as `speculation_language`).

Limitations: Cannot detect paraphrasing, implication, or semantic equivalence. High false-positive rate on legitimate inferences.

#### Tier 2: Lightweight NLI Model (HHEM or similar)

**Requires model hosting. Could run as sidecar or MCP server.**

- Deploy HHEM-2.1-Open as a local inference server (Python + transformers)
- Node.js hook calls the server via HTTP for entailment checking
- Claim decomposition still needs either LLM or heuristic sentence splitting
- Latency: ~1.5s per check on CPU

Integration pattern:

```
Transcript --> Extract tool outputs as "premises"
           --> Split response into sentences
           --> For each sentence, call HHEM(premise, sentence)
           --> Aggregate scores
```

#### Tier 3: LLM-as-Judge

**Requires API access. Highest accuracy. Async or with timeout.**

- Use the RAGAS/TruLens pattern: decompose into claims, check each against tool output
- Could use Claude itself (meta-evaluation) or a cheaper model
- Latency: seconds per evaluation
- Cost: per-token API pricing

### Claim Decomposition Without an LLM

For Tiers 1-2, claim decomposition must be done heuristically:

1. **Sentence splitting**: Use period/newline splitting (what TruLens does with NLTK). Viable in Node.js.
2. **Trivial filtering**: Remove sentences that are questions, greetings, or meta-commentary ("Let me check that for you").
3. **Factual sentence identification**: Sentences containing specific entities, numbers, dates, or technical terms are more likely to be factual claims.

### Relevant Existing Infrastructure

Our hook already has:

- `stripLowSignalRegions(text)` -- removes code blocks, inline code, blockquotes
- `isIndexWithinQuestion(text, index)` -- exempts questions
- `hasEvidenceNearby(text, rawText, index)` -- 150-char window check for evidence markers
- Transcript parsing to extract tool calls and results

The transcript parsing gives us access to the "source material" (tool outputs) that the response should be grounded in. This is the equivalent of RAGAS's `retrieved_contexts`.

## Recommendations

### For Issue #11 (RAG Verification)

Based on this research:

1. **Start with Tier 1 heuristics** (Phase 1, additive, no dependencies):
   - Add a new detection category `ungrounded_specifics` that flags specific facts (numbers, dates, versions, URLs) in the response that don't appear in any tool output from the transcript.
   - This is consistent with our existing architecture and zero-dependency constraint.

2. **Plan for Tier 2 as a separate package** (Phase 7, external, isolated):
   - HHEM-2.1-Open as an optional MCP server that the hook can query.
   - Keeps the core hook zero-dependency while enabling higher-accuracy checking.
   - The RAGAS pattern of using HHEM for Step 2 (entailment) while using heuristic sentence splitting for Step 1 is the most practical hybrid.

3. **Tier 3 is out of scope** for a stop hook:
   - LLM-as-judge adds seconds of latency per response.
   - Better suited as an offline evaluation tool or a separate CI check.

### Key Design Insight from Research

The TruLens approach of **filtering trivial statements before scoring** is directly applicable to our hook. Our existing `isIndexWithinQuestion` and `stripLowSignalRegions` perform a similar function. Extending this to filter greetings, acknowledgments, and meta-commentary before groundedness checking would reduce false positives.

The DeepEval distinction between "not contradicted" vs. "supported by" matters for our use case. For a stop hook, "not contradicted" is the safer standard -- blocking responses that merely add information beyond tool output would be too aggressive. We should flag **specific factual claims that contradict or have no basis in tool output**, not penalize reasonable inferences.
