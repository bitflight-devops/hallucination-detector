# Research: Rule-Based Heuristics for Detecting LLM Confabulation

Date: 2026-03-11

## Executive Summary

The academic literature is unambiguous: pure rule-based (non-ML) methods have a hard ceiling for detecting confident confabulation. The highest-performing non-neural method found is SelfCheckGPT-Ngram (unigram variant), which achieved 85.63 AUC-PR on non-factual detection versus 92.50 for the NLI-based variant -- but SelfCheck-Ngram still requires multiple LLM samples and token probability distributions. For the specific problem of "the assistant said X but X never appeared in the conversation," rule-based approaches can be effective through **provenance checking** -- verifying that specific entities (file paths, variable names, numbers, URLs) in the output actually appear in the input context. This is the most promising direction for a regex/string-matching stop hook.

## Source Inventory

| #   | URL                                                                                                                                | Description                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | https://github.com/potsawee/selfcheckgpt                                                                                           | SelfCheckGPT repository -- describes BERTScore, QA, n-gram, NLI, and LLM-Prompt variants with benchmarks     |
| 2   | https://arxiv.org/abs/2303.08896                                                                                                   | SelfCheckGPT paper abstract (EMNLP 2023) -- zero-resource black-box hallucination detection                  |
| 3   | https://github.com/yuh-zha/AlignScore                                                                                              | AlignScore repository -- factual consistency evaluation with leaderboards including ROUGE baselines          |
| 4   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/research.md?plain=1#L12#hallucination-rails                            | NeMo Guardrails research page -- survey of hallucination detection approaches and references                 |
| 5   | https://github.com/nvidia/nemo-guardrails/blob/develop/docs/user-guides/guardrails-library.md?plain=1#L330#hallucination-detection | NeMo Guardrails hallucination detection implementation details                                               |
| 6   | https://arxiv.org/abs/2311.05232                                                                                                   | Huang et al. 2023 survey -- "A Survey on Hallucination in LLMs: Principles, Taxonomy, Challenges" (ACM TOIS) |
| 7   | https://github.com/confident-ai/deepeval/blob/main/docs/docs/metrics-faithfulness.mdx?plain=1#L158#how-is-it-calculated            | DeepEval faithfulness metric -- claim extraction and verification approach (LLM-based)                       |
| 8   | https://www.comet.com/docs/opik/evaluation/metrics/heuristic_metrics#string-and-token-heuristics                                   | Opik heuristic metrics catalog -- lists ROUGE, BLEU, Levenshtein, Contains, RegexMatch, etc.                 |
| 9   | https://reference.langchain.com/python/langchain-classic/chains/openai_functions/citation_fuzzy_match                              | LangChain citation fuzzy match -- FactWithEvidence class for citation-based QA                               |
| 10  | https://github.com/winkjs/wink-nlp/blob/master/README.md?plain=1#L1#winknlp                                                        | winkNLP -- JavaScript NLP library (tokenization, NER, POS tagging, 650K tokens/sec, zero external deps)      |
| 11  | https://github.com/spencermountain/compromise/blob/master/README.md?plain=1#L432#api                                               | compromise -- lightweight JavaScript NLP library with entity extraction and n-gram support                   |

## Technical Assessment

### 1. Linguistic Markers of Confident Confabulation

**The core problem**: Confident confabulation has no reliable surface-level linguistic markers. Unlike speculation (which uses hedging words like "probably", "I think"), confabulation uses the same syntactic structures as grounded factual statements. The sentence "The file is located at /src/utils/helper.js" looks identical whether the file exists or not.

**What the literature covers**:

- Huang et al. (2023, source #6) categorize hallucinations into "faithfulness hallucination" (contradicting source) and "factuality hallucination" (contradicting world knowledge). Confident confabulation falls under faithfulness hallucination when a source context exists.
- The Ji et al. (2023) survey referenced in source #4 (ACM Computing Surveys, "Survey of hallucination in natural language generation") established that hallucination detection methods fall into two categories: (a) metrics comparing output to source, and (b) self-consistency methods comparing multiple outputs.

**What rule-based approaches CAN detect (surface patterns)**:

- **Excessive specificity without attribution**: Sentences containing specific numbers, percentages, dates, or measurements that are not attributed to a source or tool output. Pattern: a claim containing a specific numeric value AND no nearby evidence marker (citation, code block, tool output reference).
- **Phantom precision**: Statements like "approximately 80 characters", "roughly 3x faster", "about 150ms" -- approximate-sounding but fabricated quantities. These combine a hedging quantifier with a specific number.
- **Definitive absence claims**: "There is no X", "X does not exist", "X is not documented" -- these are high-risk for confabulation when stated without evidence of having checked.
- **Fabricated enumeration**: "There are 3 issues: ..." where the count is stated before enumeration, and the count may be fabricated.

### 2. Specificity Without Source (Hallucination by Excessive Specificity)

This is the most actionable area for rule-based detection in a stop hook.

**The principle**: When an LLM adds concrete details (file paths, version numbers, character counts, specific error messages, API endpoints) that were not present in the input context, the probability of confabulation increases dramatically.

**Detectable patterns**:

| Pattern                            | Regex feasibility                                           | Example                                                 |
| ---------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Specific file paths not in context | HIGH -- extract paths from output, check against transcript | "Edit `/src/utils/config.js`" when file never mentioned |
| Exact numbers without source       | MEDIUM -- detect `\d+` in declarative sentences             | "The limit is 80 characters"                            |
| URL/link fabrication               | HIGH -- extract URLs, verify against transcript             | "See https://docs.example.com/api"                      |
| Version number claims              | MEDIUM -- detect semver patterns                            | "Requires Node.js 18.2.0"                               |
| Quoted text not in transcript      | HIGH -- extract quoted strings, check against input         | 'The error says "ENOENT: no such file"'                 |
| Variable/function name claims      | HIGH -- extract identifiers, check against tool outputs     | "The `processData()` function handles this"             |

### 3. Self-Consistency Checks (SelfCheckGPT and Variants)

**The principle** (from source #2, Manakul et al. 2023): If an LLM knows a fact, multiple sampled responses will be consistent. If a fact is hallucinated, sampled responses will diverge because there is no grounded knowledge to anchor them.

**Variants and their ML requirements** (from source #1):

| Method                     | Requires ML model?   | Performance (NonFact AUC-PR) |
| -------------------------- | -------------------- | ---------------------------- |
| SelfCheck-Unigram          | No (pure statistics) | 85.63                        |
| SelfCheck-BERTScore        | Yes (BERT)           | 81.96                        |
| SelfCheck-QA               | Yes (QA model)       | 84.26                        |
| SelfCheck-NLI              | Yes (DeBERTa)        | 92.50                        |
| SelfCheck-Prompt (GPT-3.5) | Yes (LLM)            | 93.42                        |

**SelfCheck-Ngram (the non-ML variant)**:

- Computes average negative log-probability of each token in the response, estimated from the sampled passages using n-gram language models.
- A token that appears frequently across multiple samples gets a lower score (more consistent = less hallucinated).
- A token that appears in the original but rarely in samples gets a higher score (inconsistent = more hallucinated).
- Returns scores at both sentence-level and document-level.

**Applicability to a stop hook**: LOW. SelfCheck requires multiple sampled responses to the same prompt. A Claude Code stop hook sees only one response. Generating additional samples would require calling the LLM again, which defeats the "without an LLM" constraint and adds latency. The principle is sound but the mechanism is not applicable to single-response post-hoc checking.

### 4. Entailment Heuristics Without a Model

**What exists in the literature**:

The AlignScore leaderboard (source #3) provides a ranking of non-neural baselines for factual consistency:

| Method                    | SummaC AUC-ROC | TRUE AUC-ROC | Type             |
| ------------------------- | -------------- | ------------ | ---------------- |
| ROUGE-2                   | 78.1           | 72.4         | Lexical overlap  |
| ROUGE-1                   | 77.4           | 72.0         | Lexical overlap  |
| ROUGE-L                   | 77.3           | 71.8         | Lexical overlap  |
| BLEU                      | 76.3           | 67.3         | N-gram precision |
| NER-Overlap               | 60.4           | 59.3         | Entity matching  |
| AlignScore-large (neural) | 88.6           | 83.8         | Alignment model  |

**Key observation**: ROUGE-1/2/L scores in the 72-78 AUC-ROC range represent the ceiling for pure lexical overlap methods. This is above random (50%) but well below neural methods (83-93%). NER-Overlap at 59-60% is near random -- entity names alone are insufficient.

**Practical non-ML entailment heuristics**:

1. **Token-level Jaccard similarity**: Compute overlap between tokens in the claim and tokens in the source. Low overlap = higher confabulation risk. This is essentially what ROUGE-1 measures.

2. **N-gram precision (BLEU-like)**: Check what fraction of n-grams in the output appear in the source. Novel n-grams (especially 3-grams and 4-grams) that don't appear in the source are candidates for fabrication.

3. **Named entity grounding**: Extract entities (proper nouns, file paths, numbers) from the output. Check if each entity appears in the input context. Ungrounded entities are confabulation candidates. The AlignScore leaderboard shows NER-Overlap alone scores poorly (60.4), but as a _signal_ combined with other heuristics, it has value.

4. **Keyword extraction and matching**: Extract domain-specific keywords from the source (tool outputs, file names, error messages). Check if claims in the output reference these keywords accurately or introduce novel ones.

### 5. Citation/Attribution Checking (Most Actionable for This Project)

This is where rule-based approaches have the highest ceiling for the specific use case of a Claude Code stop hook.

**The approach**: The stop hook has access to the full conversation transcript. It can extract "provenance-bearing tokens" from the assistant's response and verify they appeared in the conversation context.

**Provenance-bearing token categories**:

| Category                | Extraction method                                        | Verification                                             |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| File paths              | Regex: `/[\w.-]+(/[\w.-]+)+` or backslash variant        | Check if path appears in any tool_result or user message |
| URLs                    | Regex: `https?://\S+`                                    | Check if URL appears in prior context                    |
| Variable/function names | Regex: backtick-wrapped identifiers `` `\w+` ``          | Check if identifier appears in any code block in context |
| Exact quoted strings    | Regex: `"[^"]{10,}"` (substantial quotes)                | Check if quoted text appears verbatim in context         |
| Error messages          | Regex: common error patterns (ENOENT, TypeError, etc.)   | Check if error text appears in tool output               |
| Numeric claims          | Regex: specific numbers in declarative context           | Check if number appears in prior context                 |
| Shell commands          | Regex: command-like patterns after "run" or in backticks | Check if command output exists in transcript             |

**LangChain's citation_fuzzy_match** (source #9) implements a related pattern: it uses an LLM to extract `FactWithEvidence` objects (claims paired with source citations), then fuzzy-matches the citations against the source documents. The extraction step requires an LLM, but the matching step is pure string comparison. For a rule-based approach, the extraction step must be done heuristically (regex-based entity extraction) rather than via LLM.

### 6. Existing Open-Source Tools

**Non-ML hallucination detection tools**: I did not find any open-source tool that performs non-ML hallucination detection on LLM output. Every tool found uses at least one of: (a) an LLM for judging, (b) a neural NLI model, (c) multiple sampled responses.

**Tools surveyed**:

| Tool                        | ML required?                                     | Approach                                                  |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| SelfCheckGPT (source #1)    | Yes (except n-gram variant which needs sampling) | Multi-sample consistency                                  |
| NeMo Guardrails (source #5) | Yes (LLM self-check)                             | LLM judges own output with additional samples             |
| AlignScore (source #3)      | Yes (RoBERTa-based)                              | Trained alignment function                                |
| DeepEval (source #7)        | Yes (LLM for claim extraction and verification)  | LLM-as-judge faithfulness                                 |
| Opik (source #8)            | Heuristic metrics available (ROUGE, BLEU)        | Provides building blocks but not a hallucination detector |
| Guardrails AI               | Yes (LLM-based validators)                       | LLM judges claims against context                         |

**JavaScript NLP libraries for building rule-based heuristics**:

| Library                 | Size                             | Features relevant to this project                                            |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| winkNLP (source #10)    | ~10KB min+gz, zero external deps | Tokenization, NER, POS tagging, sentence boundary detection, 650K tokens/sec |
| compromise (source #11) | ~200KB                           | Tokenization, NER, n-grams (via compromise-stats), entity extraction         |

**Important constraint**: The hallucination-detector runtime hooks must have zero npm dependencies. Both winkNLP and compromise would be dev dependencies only, or would need their relevant algorithms reimplemented in plain JS within the hook scripts.

## Key Findings and Ceiling Analysis

### Can we detect "the assistant said X but X never appeared in the tool results or conversation" without an LLM?

**Yes, partially.** The ceiling depends on what type of X we are checking:

| Type of claim                       | Rule-based feasibility | Estimated precision | Estimated recall                                                |
| ----------------------------------- | ---------------------- | ------------------- | --------------------------------------------------------------- |
| File paths not in context           | HIGH                   | HIGH (>90%)         | MEDIUM (catches literal paths, misses paraphrased references)   |
| URLs not in context                 | HIGH                   | HIGH (>90%)         | HIGH (URLs are exact strings)                                   |
| Quoted text not in transcript       | HIGH                   | HIGH (>85%)         | MEDIUM (misses near-quotes)                                     |
| Variable/function names not in code | MEDIUM                 | MEDIUM (70-80%)     | LOW (many valid names are generated, not quoted from context)   |
| Specific numbers without source     | MEDIUM                 | LOW-MEDIUM (60-70%) | MEDIUM (many false positives -- legitimate computation results) |
| Causal claims without evidence      | LOW                    | LOW (50-60%)        | LOW (indistinguishable from grounded reasoning syntactically)   |
| Invented behavioral claims          | VERY LOW               | VERY LOW (<50%)     | VERY LOW (requires semantic understanding)                      |

### The hard boundary

Rule-based methods fundamentally cannot detect:

1. **Semantically plausible fabrications**: "The function returns null on error" -- syntactically identical whether true or false.
2. **Paraphrased confabulation**: The assistant restates information from context but changes a key detail.
3. **Inference-based fabrication**: The assistant draws a conclusion that sounds logical but is not supported by evidence.
4. **Correct syntax, wrong semantics**: "Run `npm install`" when the project uses pnpm -- requires understanding project conventions.

### The achievable wins

Rule-based methods CAN detect with high confidence:

1. **Phantom entities**: File paths, URLs, variable names, error messages that appear nowhere in the conversation transcript.
2. **Ungrounded specificity**: Precise numeric claims (character limits, timeouts, version numbers) with no source in context.
3. **Fabricated quotes**: Quoted text that does not appear in any tool output or user message.
4. **Absence claims without search evidence**: "X does not exist" or "X is not documented" statements when no search/read tool was used.

## Implementation Guidance

### Recommended approach: Provenance Checking

The highest-value addition to the existing stop hook is a **provenance checker** that extracts specific entities from the assistant's output and verifies they appeared in the conversation context.

**Architecture**:

```
Assistant message
       |
       v
[Entity extraction] -- regex-based, extracts:
  - file paths
  - URLs
  - backtick-wrapped identifiers
  - quoted strings (>10 chars)
  - specific numbers in declarative context
       |
       v
[Context indexing] -- builds a searchable set from:
  - all tool_result content
  - all user messages
  - all prior assistant messages
       |
       v
[Provenance check] -- for each extracted entity:
  - Is it present in the context set?
  - If not, flag as potentially ungrounded
       |
       v
[Threshold] -- if N ungrounded entities found,
  emit { kind: 'ungrounded_entity', evidence, offset }
```

**Suppression rules for provenance checker**:

- Entities inside code blocks (the assistant may be writing new code, not quoting existing code)
- Entities that are common/generic (e.g., `/tmp`, `index.js`, `main`, `true`, `false`)
- Entities in questions ("Does `/src/config.js` exist?")
- Entities preceded by "create", "write", "new" (suggesting generation, not reference)
- Numbers that are results of computation visible in context

### Estimated performance ceiling

Based on the AlignScore leaderboard data (source #3), pure lexical methods (ROUGE) achieve 72-78 AUC-ROC on general factual consistency benchmarks. However, provenance checking in a conversation context is a narrower and more structured problem than general factual consistency:

- The "source" (conversation transcript) is fully available and structured (tool outputs are clearly delineated)
- The entities to check are extractable by regex (paths, URLs, identifiers)
- False positives can be reduced by suppression rules specific to the coding domain

Estimated performance for provenance checking specifically: **80-90% precision, 40-60% recall** on the subset of confabulations that involve fabricated specific entities. Many confabulations will not involve detectable entities and will be invisible to this approach.

### JavaScript NLP building blocks

If entity extraction needs to go beyond regex (e.g., extracting noun phrases or identifying declarative vs. interrogative sentences), two zero-dependency-compatible approaches exist:

1. **Reimplement minimal tokenization in CJS**: Split on whitespace and punctuation, classify tokens by pattern (path-like, URL-like, number-like, identifier-like). No NLP library needed for this level.

2. **Use winkNLP or compromise as devDependencies for testing/validation**: Build test suites that use these libraries to validate the regex-based extraction against proper NLP parsing. The runtime code stays dependency-free.

## Recommendations

### Top 3 actionable findings:

1. **Provenance checking is the highest-ceiling rule-based approach for this use case.** Extract specific entities (file paths, URLs, identifiers, quoted strings, numbers) from the assistant's output and verify they appeared in the conversation transcript. This directly addresses "the assistant said X but X never appeared in the tool results."

2. **SelfCheckGPT's consistency principle is sound but not applicable to a single-response stop hook.** It requires multiple sampled responses, which means calling the LLM again. If the project ever adds an LLM-based checking tier, SelfCheck-NLI (using DeBERTa, not an LLM) achieves 92.50 AUC-PR and is the best non-LLM-prompting method.

3. **Absence claims without tool evidence are a high-precision detection target.** Statements like "X does not exist", "there is no Y", "X is not supported" are frequent confabulation patterns. Detecting these when no search/read tool was recently invoked is a rule-based check with high precision (the claim structure is syntactically distinct) and directly catches a common confabulation mode.

### Prioritized implementation order:

| Priority | Detection                                   | Category name            | Complexity                                                                          |
| -------- | ------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| 1        | File paths / URLs not in transcript         | `ungrounded_entity`      | Medium -- regex extraction + transcript scanning                                    |
| 2        | Absence claims without tool evidence        | `unsupported_absence`    | Low -- regex for negation patterns + check for recent tool use                      |
| 3        | Fabricated quoted text                      | `ungrounded_quote`       | Medium -- quote extraction + fuzzy matching against transcript                      |
| 4        | Specific numbers without source             | `ungrounded_specificity` | Medium-High -- number extraction + context checking + many suppression rules needed |
| 5        | Variable/function names not in code context | `ungrounded_identifier`  | High -- identifier extraction from prose (not code blocks) + context checking       |

### What NOT to pursue:

- General semantic entailment without a model (ROUGE-level approaches achieve only 72-78% on benchmarks and would produce too many false positives for a blocking stop hook)
- Self-consistency checking (requires multiple LLM calls)
- Full NLI/NER-based approaches (require ML models, violating zero-dependency constraint)

## References

- Manakul, P., Liusie, A., & Gales, M. J. F. (2023). SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection for Generative Large Language Models. EMNLP 2023. https://arxiv.org/abs/2303.08896
- Zha, Y., Yang, Y., Li, R., & Hu, Z. (2023). AlignScore: Evaluating Factual Consistency with a Unified Alignment Function. ACL 2023. https://arxiv.org/abs/2305.16739
- Huang, L., et al. (2023). A Survey on Hallucination in Large Language Models: Principles, Taxonomy, Challenges, and Open Questions. ACM TOIS. https://arxiv.org/abs/2311.05232
- Laban, P., Schnabel, T., Bennett, P., & Hearst, M. A. (2022). SummaC: Re-Visiting NLI-based Models for Inconsistency Detection in Summarization. TACL. https://arxiv.org/abs/2111.09525
- Min, S., et al. (2023). FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation. https://arxiv.org/abs/2305.14251
- Ji, Z., et al. (2023). Survey of Hallucination in Natural Language Generation. ACM Computing Surveys 55(12). https://dl.acm.org/doi/pdf/10.1145/3571730
- Lin, C. Y. (2004). ROUGE: A Package for Automatic Evaluation of Summaries. ACL Workshop. https://aclanthology.org/W04-1013/
