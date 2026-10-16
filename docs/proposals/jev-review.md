# Review of TypeSafe Jev for BuildWorks' review handoffs

## What this is

A record of a review of TypeSafe's Jev, the first "System One" model
(`https://typesafe.ai/blog/introducing-system-one-models-and-jev`, read
2026-10-15, with `https://docs.typesafe.ai/` and its API reference, models,
primitives, confidence, patterns, quickstart pages, and the TypeSafe terms and
privacy policy). The operator asked how Jev can be implemented in BuildWorks at
three handoffs: design to spec review to reconciler, plan to plan review to
reconciler, and implementer to code review. Notes and a proposed design only;
nothing is adopted or built.

**Hazards considered:** 1 (model output in shapes the schema refuses: Jev's
answers are typed by the API, so the decision half of a reply can no longer be
malformed), 3 (a constrained field's constraint must be stated: Jev questions
carry their rubric in `criteria`), 4 (fixtures and code agreeing while both are
wrong: every Jev fixture must be a recorded response), 10 (moving aliases:
`jev-latest` moves between releases, so a run pins a versioned ID), 13
(specifications inventing obligations: decision J1 asks, per criterion, which
design statement it traces to), 14 (independence that cannot be proven: Jev is
a separate vendor's model in a separate request, so its verdict is independent
of the author by construction), 17 (a reconciliation that deletes an
obligation: decision J3 takes the disposition away from the author), 18
(delivery proven, correctness never inspected: decision J4 asks about every
acceptance criterion against the delivered code), 21 (agents never told the
gate: the Jev questions are fixed text that can be shown to the author before
it writes). Not weighed: 2, 5-9, 11, 12, 15, 16, 19, 20, 22, 23, which concern
evidence retention, delivery, executables, sandboxing, phases and cleanup that
Jev does not touch.

## What Jev is

A hosted model, not a library, verifier or language. Facts below are from the
TypeSafe docs; performance and calibration claims are TypeSafe's own and are
not independently measured.

- **Input:** a `state` (text or JSON) and a map of typed questions.
  `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`,
  body `{"state": ..., "model": ..., "questions": {...}}`. Raw HTTP works from
  Node; there is also a TypeScript SDK (`@typesafe-ai/sdk`, Node 20+).
- **Three question types:**
  - **Choice**: one of up to 255 named options, each with a rubric. Returns
    `choice`, `probabilities` over every option, and `confidence`.
  - **Score**: one of 2 to 10 ordered levels, each with a rubric. Returns
    `score`, `probabilities`, `legend` and `confidence`.
  - **Noul**: the probability that a statement is true.
- **Evaluation:** every question is evaluated "in parallel and in isolation
  against the same state". Adding questions "barely changes the response time".
- **Output it cannot produce:** "System One models do not write replies,
  produce code, or generate explanations of their reasoning."
- **Limits:**
  - Context: 64k tokens per request and 32k per question (state plus one
    question). A long-context header raises both to 262k, which the docs call
    "slower and less accurate".
  - Body: at most 32 MiB.
  - Questions: no separate cap on the count.
- **Models:** `jev-1.13.0` (the `jev-latest` alias) and `jev-1.14.0`
  (`jev-preview`). The docs say: "If you have tuned confidence thresholds
  against one version, send that version's ID instead of the alias."
  Determinism is not stated.
- **Calibration:** "Calibration is measured across groups of predictions; it
  does not guarantee that an individual answer is correct." The method and
  dataset are not published. TypeSafe's evals are business workflows, not code
  or specification review.
- **Price:** $0.042 per million input tokens. Output is free.
- **Availability:** early access with a waitlist.
- **Data and terms:**
  - The docs say "Jev is not trained on customer requests or responses".
  - The privacy policy gives no retention period for input.
  - The terms cap liability at $100 and say not to submit confidential
    material through the Site. API customers may have separate terms, which
    were not read.

## What it does and does not fix

The operator's hope is that Jev handles prose problems, schema problems and
models making mistakes. Each, against the mechanism above:

- **Schema problems: fixed for decisions, not for text.**
  - What it fixes: a Jev answer is a typed value from a closed set, so a
    disposition, a verdict or a severity cannot come back malformed.
  - What remains: the reviewer finding's `subject`, the reconciler's revised
    document, its `normativeChanges` text, and every patch are text, which Jev
    cannot produce. That text stays with Claude under `--json-schema`, which
    already ended malformed patch replies (`94e3b98`; one paid run, every patch
    reply applied).
- **Prose problems: reduced where prose explains a decision contract.**
  - Today the reconcile prompt teaches one reply shape per disposition in
    prose (`buildSpecReconcilePrompt` and the shared decision contract in
    `src/prompts.ts`: "For disposition rejected_with_rationale you must also
    supply…", "return no field at all that your disposition does not list").
  - If Jev picks the disposition first, Claude is asked for one fixed shape
    for that disposition. Most of that prose goes away, and so does the union
    that hard rule 3 forbids.
- **Models making mistakes: not fixed. Made measurable and gateable.**
  - Jev is a model and will be wrong some fraction of the time. What changes
    is the shape of the mistake: every decision arrives with a probability.
  - First, the error rate can be measured against labelled cases before Jev is
    trusted.
  - Second, the deterministic gate can act on the probability: proceed above a
    frozen threshold, otherwise route to the operator or an executable check.
  - Third, questions are evaluated in parallel and in isolation, so a check
    can enumerate every acceptance criterion instead of hoping a free-form
    reviewer reaches it. The 2026-10-13 and 2026-10-15 replays
    (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security*.json`)
    measured free-form reviewers reporting 0.7 to 3.9 of 7 known defects per
    call, depending on model and effort. That is sampling, and enumeration is the structural answer to it.
  - None of this holds unless Jev's probabilities are calibrated on
    BuildWorks' own questions, and nothing published shows that.
- **A risk specific to this workload.** The replays found that reviewers who
  reasoned longer found more defects. Haiku 5.5 at `xhigh` produced about 72K
  output tokens per call and found the most, while Opus 5.5 at `medium`, with
  about 3,400 thinking tokens, found 0.7 per call. Jev is built for the
  opposite end: fast decisions without extended reasoning, with multi-factor
  judgements decomposed into atomic questions. It can only work here on small
  states asking narrow questions, never "review this 2,000-line diff".

## Where it fits in the three handoffs

Generation stays with Claude: spec, plan and code authoring, reviewer
findings, revision text and remediation patches. Jev takes the decision points.
Each decision below names its question, its state, and what the deterministic
gate does with the answer.

Size check from crew-chatter run 6: the design is 7,563 characters, the spec
13,791 and the plan 27,115, so design plus spec plus plan is roughly 12K tokens
and fits the 32k per-question limit. The full code-review input (spec, plan and
diff, 121,905 characters) does not fit, so code-review questions must use
sliced states.

### Design → spec → spec review → reconcile

- **J1 Traceability (hazard 13).**
  - State: the design plus the spec.
  - Questions: per spec acceptance criterion, a Choice over the design's
    sections and bullets, parsed deterministically, plus `none`. The question
    is "which design statement does this criterion implement?".
  - Reverse direction: per design bullet, a Noul "the spec has a criterion
    that implements this statement".
  - Gate: a criterion answered `none` above the threshold becomes a
    system-raised finding with a templated subject. An uncovered design bullet
    does the same. Low confidence becomes a finding marked for the operator.
- **J2 Finding triage.**
  - State: the design, the spec and one canonical finding.
  - Question: a Noul "this finding identifies a defect the spec can fix,
    judged against the design".
  - Gate: recorded as evidence only, until the evaluation below shows its
    error rate. Jev never silently drops a finding.
- **J3 Disposition.**
  - State: the design, the spec and one finding.
  - Question: a Choice over the five dispositions (`addressed`,
    `rejected_with_rationale`, `upstream_follow_up`, `upstream_blocking`,
    `cannot_determine`), each with its rubric.
  - Gate: above the threshold, the author is dispatched to write only the
    fixed shape for that disposition. Below it, the finding goes to
    `cannot_determine`, which uses the existing operator pause.
  - This changes who decides a disposition: today the author does
    (`ARCHITECTURE.md` section 12, "Nothing resolves its own finding"). That
    is an architecture decision for the operator.

### Plan → plan review → reconcile

- **J1 Coverage, plan side.** The plan's `## Coverage` claims are checked
  deterministically for form today; Jev checks whether each claim is true.
  - Per claimed pair: a Noul "task T implements criterion AC-k".
  - Per task: a Choice over the spec's criteria plus `none`, to catch an
    orphan task, which is an invented obligation.
  - State: the spec plus the plan (about 10K tokens for run 6).
- **J2 and J3** as for the spec, with the spec as the source document.

### Implementer → code review → code-review reconciler → severity gate

- **J4 Criterion check (hazard 18).**
  - Per acceptance criterion: a Choice of `implemented`, `partial`,
    `not_implemented` or `cannot_tell`.
  - State: the criterion's text plus the files the plan's tasks for that
    criterion declare, sliced to fit 32k.
  - Gate: `not_implemented` above the threshold becomes a system-raised
    finding that enters the existing remediation loop. This is the
    enumeration that reviewer sampling lacks.
- **J5 Finding validity.**
  - State: one reviewer finding plus the file at its location.
  - Question: a Noul "the defect this finding describes is present in this
    code".
  - Gate: recorded first. Later it is a precision filter before remediation,
    since each false finding costs a remediation dispatch, and run 6 showed
    remediation is where out-of-spec obligations enter.
- **J6 Code-review reconciler replacement.**
  - Today two Haiku calls must both reject, each with an excerpt that must
    occur in the spec.
  - Instead: a Choice over the spec's criteria and section headings plus
    `none` ("which clause of the approved specification excludes the
    behaviour this finding asks for?"). The system then quotes that clause
    deterministically, so an invented quote becomes impossible. The replay
    caught one invented quote.
  - Gate: withhold a finding only when one clause is chosen above the
    threshold.
- **J7 Severity.**
  - Question: a Score over `low`, `medium`, `high` and `critical`, each with
    its rubric.
  - Gate: block on P(severity ≥ the frozen blocking level) above the
    threshold, instead of on one reviewer's label. Spec-review outcomes
    varied on the same disclosed decisions, though identical input was not
    shown (`docs/proposals/spec-review-severity-nondeterminism.md`).

## Fit against the hard rules and the architecture

- **Rule 1 (one harness until one run completes):** satisfied; runs have
  completed end to end.
- **Section 11 ("one adapter, concrete, with no interface above it"):** Jev
  is not a harness: it has no agent, tools or files. It would be a second
  concrete client, a new *src/jev.ts*, called directly by stage code with no
  executor interface. Adding it is an amendment to section 11.
- **Rule 4 (no abstraction without two implementations):** no "decider"
  interface. Jev calls are concrete. A Claude fallback is deliberately absent
  (see failure handling below).
- **Rule 3 (one schema per thing):**
  - Each decision has one question shape and one stored row shape.
  - J3 replaces today's per-disposition reply union with one schema per
    disposition dispatch.
- **Rule 5 (recorded fixtures):** every Jev fixture is a recorded API
  response with a provenance block.
- **Rule 6 (frozen config):**
  - The versioned model ID (`jev-1.13.0`, never an alias; hazard 10) is
    frozen in the profile.
  - So is every threshold.
  - So is every question's text, by hash.
- **Section 12 ("a reviewer's verdict is an input to a gate, never the gate
  itself"):** a Jev probability is an input; the gate is the frozen threshold
  rule in code.

## Implementation shape

- **A new *src/jev.ts*:**
  - A concrete `fetch` client to `/v1/systemone`.
  - The key is read from `TYPESAFE_API_KEY` and never logged or stored.
  - It validates the response: answer keys equal question keys, probabilities
    sum to 1 within tolerance, and the returned `model` equals the frozen ID.
  - It retains the raw request and response beside the existing raw dispatch
    evidence, and records `usage.input_tokens`.
- **Failure handling:** fail closed.
  - A 400 (including `max_tokens_exceeded`), 401, 422, a 429 after the
    frozen retries, or a 529 blocks the stage with the status named.
  - No silent fallback to Claude, which would be a second decision path with
    different error rates.
- **`src/policy.ts`:** `JEV_MODEL` and one threshold per decision (J1-J7),
  frozen into the profile.
- **Store:**
  - One new table holding one row per question asked: run, stage, decision
    kind, subject (criterion, finding or pair), question hash, model,
    answer, probabilities, confidence, threshold and gate outcome. It is
    audited like every other write.
  - The `ALTER`/`CREATE` must be folded into `scripts/doc-check.mjs` and
    `test/schema.test.ts`.
- **`doctor`:** probes `GET /v1/models` with the key and confirms the frozen
  model ID is listed. It spends nothing.
- **Prompts (hazard 21):** the author and implementer prompts state the Jev
  questions their output will be judged by.
- **Cost:** a run's Jev input should be a few million tokens at most, about
  $0.10 at the published price. This is an inference from the sizes above,
  not a measurement.

## Evaluation before adoption

Jev's error rate and calibration on these questions are unknown, so each
decision is adopted only after a recorded evaluation against labelled cases,
with its adoption rule written before the run. The labelled cases must come
from outside the session that scores them. Candidate sources already
committed:

- **J6:** `test/fixtures/recorded/code-review-reconciler-*.json` (30 recorded
  single Haiku 5.5 calls over 26 findings: one wrong rejection of 906 and three
  missed rejections of 905). The labels were fixed before any call, but from
  the spec text by an assistant session, so the operator confirms them before
  they count as ground truth. Ask Jev the same findings and compare its errors
  with Haiku's on the same cases.
- **J5 and J7:** the crew-chatter run 6 findings, once each is labelled real
  or false by a reproduction against `bb7f3f6`. These are the findings in
  `test/fixtures/recorded/code-review-crew-chatter-run-6.json` and the replay
  fixtures. The reproductions do not exist yet.
- **J1:** the crew-chatter and web-calculator designs, specs and plans, with
  traceability labelled by the operator.
- **J3:** no labelled set exists. An author's recorded disposition is not
  ground truth. This decision needs operator-labelled cases or stays last.

Per decision, the measurements are:
- accuracy against the labels;
- Brier score;
- the accuracy of answers above the proposed threshold, which is what the
  gate relies on;
- the same typed question asked of Haiku 5.5 through `--json-schema`, as a
  baseline.

## Proposed order

Each step ships only if its evaluation passes:

1. **J6.** The smallest change, with labelled data that already exists. It
   replaces two Claude calls.
2. **J7 and J5.** The code-review gate inputs.
3. **J4.** The criterion check after implementation.
4. **J1.** Spec and plan traceability.
5. **J3.** The disposition split. It is the largest change: it amends
   sections 12 and 13 and moves the disposition from the author to a gated
   Jev decision.

## Decisions the operator must make

- **API access.** Whether an early-access key exists or can be obtained.
  Without one, nothing above can be measured.
- **Data.** Whether target specifications and code may be sent to TypeSafe,
  given no stated input retention period and the $100 liability cap.
- **Architecture.** The section 11 amendment for a second concrete client.
  For J3 only, the section 12 and 13 change in who decides a disposition.
- **Thresholds.** The adoption rule and threshold for each decision, set
  before its evaluation runs.
