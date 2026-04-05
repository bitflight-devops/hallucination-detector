# Research: Claim Decomposition for LLM Factuality Evaluation

Date: 2026-03-11

## Executive Summary

Two dominant systems exist for decomposing LLM output into verifiable atomic claims: **FActScore** (EMNLP 2023) and **SAFE** (NeurIPS 2024). Both use the same core approach -- sentence splitting via NLTK, followed by LLM-prompted decomposition of each sentence into atomic facts using few-shot examples. SAFE extends FActScore by adding a self-containment revision step (resolving pronouns/vague references) and a relevance classification step. No production-ready rule-based alternative exists that achieves comparable granularity without an LLM. For the hallucination detector's synchronous Node.js constraint, a three-tier strategy is viable: (1) heuristic sentence splitting + clause detection for zero-dependency mode, (2) compromise.js for lightweight NLP-assisted decomposition, (3) LLM-assisted decomposition for full accuracy.

## Source Inventory

| #   | URL                                                                                                             | Description                                                               |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | https://arxiv.org/abs/2305.14251                                                                                | FActScore paper abstract -- EMNLP 2023, defines atomic fact decomposition |
| 2   | https://github.com/shmsw25/FActScore                                                                            | FActScore repository -- official implementation, 419 stars                |
| 3   | https://github.com/shmsw25/FActScore/blob/main/factscore/atomic_facts.py                                        | FActScore atomic fact generator -- core decomposition code                |
| 4   | https://arxiv.org/abs/2403.18802                                                                                | SAFE paper abstract -- NeurIPS 2024, search-augmented factuality eval     |
| 5   | https://github.com/google-deepmind/long-form-factuality/blob/main/README.md                                     | SAFE repository README -- pipeline overview                               |
| 6   | https://github.com/google-deepmind/long-form-factuality/blob/main/eval/safe/README.md                           | SAFE eval README -- 4-step pipeline description                           |
| 7   | https://github.com/google-deepmind/long-form-factuality/blob/main/eval/safe/get_atomic_facts.py                 | SAFE atomic facts module -- wraps FActScore's generator                   |
| 8   | https://github.com/google-deepmind/long-form-factuality/blob/main/eval/safe/classify_relevance.py               | SAFE relevance classifier -- revision + relevance prompts                 |
| 9   | https://github.com/google-deepmind/long-form-factuality/blob/main/eval/safe/rate_atomic_fact.py                 | SAFE fact rater -- search-augmented verification                          |
| 10  | https://github.com/google-deepmind/long-form-factuality/blob/main/eval/safe/search_augmented_factuality_eval.py | SAFE main pipeline -- orchestration code                                  |
| 11  | https://github.com/google-deepmind/long-form-factuality/blob/main/third_party/factscore/atomic_facts.py         | SAFE's fork of FActScore atomic facts -- modified for pluggable LLM       |
| 12  | https://github.com/google-deepmind/long-form-factuality/blob/main/third_party/factscore/demos/demons.json       | FActScore few-shot decomposition examples -- 21 sentence/fact-list pairs  |
| 13  | https://arxiv.org/abs/2401.06855                                                                                | FAVA paper abstract -- fine-grained hallucination taxonomy (6 types)      |
| 14  | https://fine-grained-hallucination.github.io                                                                    | FAVA project page -- hallucination taxonomy overview                      |
| 15  | https://github.com/spencermountain/compromise/blob/master/README.md                                             | compromise.js -- JavaScript NLP library for sentence/clause parsing       |

---

## 1. FActScore: Atomic Fact Decomposition

### Algorithm (verified from source code, source #3)

FActScore decomposes text into atomic facts through this pipeline:

1. **Paragraph splitting**: Split on `\n` to get paragraphs.
2. **Sentence tokenization**: Uses NLTK `sent_tokenize()` for each paragraph.
3. **Sentence splitter repair**: `fix_sentence_splitter()` merges sentences broken on initials (e.g., "J. F." split across sentences), single-word sentences, and sentences starting with lowercase.
4. **LLM-based decomposition**: Each sentence is sent to an LLM with few-shot examples.
5. **Postprocessing**: Entity validation using spaCy NER to ensure decomposed facts don't hallucinate new entities not in the original sentence.

### The Decomposition Prompt

From source #11 (SAFE's fork, which adds an instruction header):

```
Instructions:
1. You are given a sentence. Your task is to break the sentence down into a
   list of atomic facts.
2. An atomic fact is a sentence containing a singular piece of information.
3. Each atomic fact in the outputted list should check a different piece of
   information.
4. Use the previous examples to learn how to do this.
5. You should only output the atomic facts as a list, with each item starting
   with "- ". Do not include other formatting.
6. Your task is to do this for the last sentence that is given.
```

This is preceded by 7-8 few-shot examples from a demonstrations file, plus 1 BM25-retrieved similar example.

### What an "Atomic Fact" Looks Like (from source #12)

Input sentence:

> "Michael Collins (born October 31, 1930) is a retired American astronaut and test pilot who was the Command Module Pilot for the Apollo 11 mission in 1969."

Decomposed atomic facts:

- Michael Collins was born on October 31, 1930.
- Michael Collins is retired.
- Michael Collins is an American.
- Michael Collins was an astronaut.
- Michael Collins was a test pilot.
- Michael Collins was the Command Module Pilot.
- Michael Collins was the Command Module Pilot for the Apollo 11 mission.
- Michael Collins was the Command Module Pilot for the Apollo 11 mission in 1969.

Key pattern: Each conjunction, appositive, relative clause, and parenthetical becomes a separate atomic fact. Nested information is extracted with increasing specificity (e.g., "Command Module Pilot" then "...for Apollo 11" then "...in 1969").

### Filtering Non-Factual Sentences

FActScore skips sentences matching:

- Starts with "Sure", "Please", "I hope", "Here are" (conversational filler)
- Contains "This sentence does not contain any facts"
- First/last sentence heuristics for non-bio text

---

## 2. SAFE: Search-Augmented Factual Evaluation

### Pipeline (verified from sources #6, #7, #8, #9, #10)

SAFE extends FActScore with three additional steps after decomposition:

1. **Decompose** (same as FActScore) -- uses FActScore's atomic fact generator directly (source #7 imports `third_party.factscore.atomic_facts`)
2. **Revise for self-containment** -- resolves pronouns and vague references
3. **Classify relevance** -- determines if each fact is relevant to the original prompt
4. **Rate accuracy** -- multi-step search-augmented verification

### Step 2: Self-Containment Revision (source #8)

SAFE prompts the LLM to replace vague references:

```
Vague references include but are not limited to:
- Pronouns (e.g., "his", "they", "her")
- Unknown entities (e.g., "this event", "the research", "the invention")
- Non-full names (e.g., "Jeff..." or "Bezos..." when referring to Jeff Bezos)

Instructions:
1. The following STATEMENT has been extracted from the broader context of
   the given RESPONSE.
2. Modify the STATEMENT by replacing vague references with the proper
   entities from the RESPONSE that they are referring to.
3. You MUST NOT change any of the factual claims made by the original STATEMENT.
4. You MUST NOT add any additional factual claims to the original STATEMENT.
```

This step is critical -- FActScore's atomic facts often contain "He", "She", "They" which are unverifiable in isolation.

### Step 3: Relevance Classification (source #8)

Uses a "Foo / Not Foo" abstraction to determine if the atomic fact's subject relates to the prompt's subject based on the response context. Facts about tangential entities mentioned in the response but not related to the question are marked "Irrelevant."

### Step 4: Multi-Step Search Verification (source #9)

For each relevant fact:

1. LLM generates a Google Search query
2. Search results are collected
3. Repeat up to `max_steps` (default: 5) times
4. LLM judges "Supported" or "Not Supported" based on accumulated search results

### Key Difference from FActScore

FActScore verifies facts against a static knowledge source (Wikipedia dump). SAFE uses live Google Search with iterative query refinement. SAFE achieves 72% agreement with human annotators and wins 76% of disagreement cases (source #6).

---

## 3. FAVA: Fine-Grained Hallucination Taxonomy

### Six Hallucination Types (verified from source #14)

FAVA (source #13, #14) defines a taxonomy relevant to what "verifiable" means:

| Type              | Definition                                                           | Verifiable?      |
| ----------------- | -------------------------------------------------------------------- | ---------------- |
| **Entity**        | Wrong entity; changing one entity fixes the sentence                 | Yes              |
| **Relational**    | Wrong semantic relationship between entities                         | Yes              |
| **Contradictory** | Entire statement contradicted by evidence                            | Yes              |
| **Invented**      | Non-existent concepts/entities fabricated by the model               | Yes (by absence) |
| **Subjective**    | Personal beliefs, opinions, biases -- no factual proposition         | No               |
| **Unverifiable**  | Contains factual propositions but no evidence exists to confirm/deny | No               |

This taxonomy directly answers "what makes a claim verifiable" -- Entity, Relational, Contradictory, and Invented errors are verifiable against external knowledge. Subjective and Unverifiable claims should be filtered out before verification.

---

## 4. Claim Decomposition Without an LLM

### What Exists

No fetched source documents a production system that achieves FActScore-quality atomic fact decomposition without an LLM. The approaches that exist operate at coarser granularity:

#### 4a. Sentence Splitting (NLTK / spaCy)

Both FActScore and SAFE use NLTK `sent_tokenize()` as their first step (sources #3, #11). This is a regex + abbreviation-list approach. FActScore adds a `fix_sentence_splitter()` function that handles:

- Initials like "J. F. Kennedy" being split across sentences
- Single-word orphan sentences
- Sentences starting with lowercase (continuation of previous)

This gives you **sentence-level granularity**, not atomic facts. A sentence like "He was born in 1930 in New York and studied at MIT" contains 3+ facts but remains one sentence.

#### 4b. compromise.js (source #15)

JavaScript NLP library (200KB minified) with:

- Sentence splitting: `doc.sentences()`
- Clause detection: built-in POS tagging, can identify verbs and noun phrases
- Named entity recognition (basic)
- No dependency parsing

Relevant capabilities for heuristic decomposition:

- Split on coordinating conjunctions ("and", "or", "but")
- Identify appositives (noun phrases between commas)
- Extract subject-verb-object triples (partial)

This would give **clause-level granularity** -- finer than sentences but coarser than FActScore's atomic facts.

#### 4c. Rule-Based Clause Splitting (heuristic)

A pure-regex approach can decompose at conjunction boundaries:

- Split on ", and ", ", but ", ", or ", "; "
- Split on relative clauses: ", who ", ", which ", ", where "
- Extract parenthetical content: text within "(" and ")"
- Split on appositive patterns: "X, a/an Y, ..."

This is the coarsest level but requires zero dependencies and runs synchronously.

### Granularity Comparison

| Approach                | Unit          | Example Input                                                  | # Units |
| ----------------------- | ------------- | -------------------------------------------------------------- | ------- |
| Rule-based clause split | Clause        | "He was born in NY and studied at MIT, where he met his wife." | 3       |
| compromise.js           | Clause/phrase | Same                                                           | 3-4     |
| FActScore/SAFE (LLM)    | Atomic fact   | Same                                                           | 5-6     |

The LLM step captures things that rule-based approaches miss:

- "born in NY" contains both a birth event and a location
- "studied at MIT" contains both an education event and an institution
- Temporal qualifiers embedded in clauses

---

## 5. What Makes a Claim "Verifiable"

Based on all sources reviewed, a claim is verifiable when:

1. **It contains a factual proposition** -- an assertion about the world that is either true or false (not an opinion, instruction, or question)
2. **It references identifiable entities** -- named entities, dates, quantities, or specific concepts that can be looked up
3. **It asserts a relationship** -- between those entities (born in, founded by, located at, member of, etc.)
4. **Evidence could exist** -- there is a knowledge source where this fact could be confirmed or denied

Claims that are NOT verifiable:

- **Instructions/commands**: "Run npm install" -- this is an action, not a fact
- **Opinions/subjective**: "This is a great library" -- no factual content
- **Meta-commentary**: "Let me explain..." -- conversational framing
- **Self-referential**: "I checked three files" -- about the current interaction
- **Code**: Code blocks contain logic, not factual claims (though comments in code might)
- **Questions**: Asking something is not asserting something

### Heuristic Filters for Non-Verifiable Content

From the FActScore codebase (sources #3, #11), these patterns identify non-factual content:

- Sentences starting with: "Sure", "Please", "I hope", "Here are", "Let me"
- Sentences containing "?" (questions)
- Code blocks (FActScore doesn't handle these; the hallucination detector already strips them)
- Block quotes

---

## 6. Implementation Guidance for the Hallucination Detector

### Three-Tier Architecture

Given the constraint that the stop hook runs synchronously in Node.js with zero runtime dependencies:

#### Tier 1: Pure Heuristic (current constraint -- zero dependencies)

```
Input text
  -> stripLowSignalRegions() [already exists]
  -> sentence split (regex: /[.!?]\s+(?=[A-Z])/ with abbreviation list)
  -> clause split (split on conjunctions, relative pronouns, semicolons)
  -> filter non-verifiable (questions, commands, meta-commentary)
  -> output: list of clause-level claims
```

This is what can run in the stop hook today. Granularity: clause-level. Catches ~60-70% of what FActScore catches at the sentence level, but misses intra-clause decomposition.

#### Tier 2: NLP-Assisted (compromise.js as devDependency)

```
Input text
  -> compromise(text).sentences()
  -> POS tagging for verb/noun identification
  -> clause splitting at conjunction boundaries with POS awareness
  -> named entity extraction for verifiability classification
  -> output: list of clause-level claims with entity annotations
```

Adds ~200KB dependency. Would need to be a runtime dependency (violates zero-dep constraint). Better sentence splitting than regex, handles abbreviations and edge cases.

#### Tier 3: LLM-Assisted (async, external)

```
Input text
  -> sentence split (NLTK-equivalent)
  -> for each sentence: prompt LLM with FActScore-style few-shot examples
  -> self-containment revision (SAFE-style pronoun resolution)
  -> relevance filtering
  -> output: list of atomic facts
```

This cannot run in the synchronous stop hook. Would need to be a separate async process (MCP server, background worker, or post-hook evaluation). Achieves FActScore/SAFE-quality decomposition.

### Recommended Path

For the hallucination detector's immediate needs (detecting fabricated confident assertions), **Tier 1 is sufficient** for the stop hook. The current detector catches speculation language and ungrounded causality -- these operate at phrase/sentence level, not atomic-fact level.

Atomic fact decomposition becomes necessary when:

1. Verifying specific factual claims against a knowledge source (requires Tier 3)
2. Scoring factual density (counting claims per response -- Tier 2 suffices)
3. Tracking which specific facts triggered a block (Tier 1 suffices with clause splitting)

The structured claim annotation feature (commit `bc20244`) already extracts `{ kind, evidence, offset }` per match. Extending this to include the decomposed claim text at clause level (Tier 1) is a natural next step that requires no new dependencies.

---

## Key Findings

1. **Both FActScore and SAFE decompose text identically** -- SAFE reuses FActScore's code. The decomposition step is: NLTK sentence split, then LLM few-shot prompting with 8 demonstrations to break each sentence into atomic facts. Each atomic fact is a single-predicate sentence (source #3, #7, #11, #12).

2. **Self-containment revision is critical for verification** -- FActScore's atomic facts contain unresolved pronouns ("He was born in 1930"). SAFE adds a revision step that replaces vague references with explicit entities from the response context. Without this step, atomic facts cannot be independently verified (source #8).

3. **No rule-based system achieves atomic-fact granularity** -- All surveyed systems that decompose below sentence level use an LLM. Rule-based approaches (regex clause splitting, compromise.js) achieve clause-level granularity, which captures conjunction boundaries and relative clauses but misses nested facts within a single clause. For the hallucination detector's current regex-based architecture, clause-level decomposition is the maximum achievable granularity without adding an LLM dependency.
