# Review of Microsoft-Decision-1 for BuildWorks' review handoffs

## What this is

A record of a review of Microsoft-Decision-1, a typed-decision ("System One")
model served by Microsoft Foundry. The operator asked how it can be
implemented in BuildWorks at three handoffs: design to spec review to
reconciler, plan to plan review to reconciler, and implementer to code review.
Notes and a proposed design only; nothing is adopted or built.

This record was first written on 2026-10-15 about TypeSafe's Jev. On
2026-10-16 the operator redirected it to Microsoft-Decision-1 on their own
Foundry resource, at:

`https://snitch-resource.services.ai.azure.com/providers/microsoft/v1/systemone`

The file was renamed from `jev-review.md` at the same time. The operator
confirmed the same day that Microsoft-Decision-1 is deployed on
`snitch-resource`.

The handoff design below carries over unchanged. The model facts, client,
configuration, failure handling and operator decisions are rewritten for
Foundry.

Sources were read on 2026-10-16:

- the Foundry blog announcement (`techcommunity.microsoft.com`, dated
  2026-10-09; only its title could be retrieved);
- the catalog mirror at `llmreference.com` for Microsoft-Decision-1 on
  Microsoft Foundry;
- InfoWorld, 2026-10-13, "Microsoft separates decision-making from generative
  AI with a new model";
- secondary write-ups that reproduce parts of the documentation;
- Microsoft Learn, "Deploy and use Microsoft-Decision-1 in Microsoft Foundry"
  (`ms.date` 2026-10-07), read later the same day.

The wire format is now recorded from the operator's resource:
`test/fixtures/recorded/systemone-probe-snitch-resource.json` (4 requests, synthetic
content). Decision D6 was evaluated against labelled cases the same day (see
"Evaluation record" below). Statements still unsettled are marked as such.

**Hazards considered:** 1 (model output in shapes the schema refuses:
Decision-1's answers are typed by the API, so the decision half of a reply can
no longer be malformed), 3 (a constrained field's constraint must be stated:
each question carries its rubric with it), 4 (fixtures and code agreeing while
both are wrong: every Decision-1 fixture must be a recorded response, and the
client's response schema is taken from the recorded probe), 10 (moving aliases: the request names an operator-chosen
deployment, not a model version, so the deployment name is an alias, and a run
must snapshot what it resolves to), 12 (configuration divergence between
targets: the endpoint, deployment name and type are environment variables
that differ between machines and change over time, so each run freezes them
and `doctor` and `status` show them), 13 (specifications inventing obligations:
decision D1 asks, per criterion, which design statement it traces to), 14
(independence that cannot be proven: Decision-1 is a different model family,
a post-trained Qwen3.5-9B, in a separate request, so its verdict is independent
of the Claude author by construction), 17 (a reconciliation that deletes an
obligation: decision D3 takes the disposition away from the author), 18
(delivery proven, correctness never inspected: decision D4 asks about every
acceptance criterion against the delivered code), 21 (agents never told the
gate: the questions are fixed text that can be shown to the author before it
writes). Not weighed: 2, 5-9, 11, 15, 16, 19, 20, 22, 23, which concern
evidence retention, delivery, executables, sandboxing, phases and cleanup that
Decision-1 does not touch.

## What Microsoft-Decision-1 is

It is a hosted model, not a library, a verifier or a language. Microsoft
Research built it by post-training Qwen3.5-9B for single-pass decision
scoring. Microsoft says later versions may be rebased on other models,
including MAI and OpenAI models. Performance and calibration claims are
Microsoft's own and have not been independently measured. InfoWorld states
this explicitly.

- **Input:** a state (text or JSON) and a set of typed questions. Inputs are
  text only.
- **Three question types:**
  - **`noul`:** the probability that a yes/no condition holds.
  - **`choice`:** one option selected from a predefined set, with a
    probability for every option.
  - **`score`:** a position on an ordered scale the caller defines.
- **Evaluation:** several decisions can be answered in one request, and each
  question's name becomes a key in the response's `answers` object. Microsoft
  Learn says combining questions about the same state "keeps the decision
  context consistent". It does not say whether they are judged in isolation
  from one another; Jev documented that they were.
- **Output it cannot produce:** it writes no rationale and generates no text.
- **Endpoint:** `POST <resource>/providers/microsoft/v1/systemone`, with the body
  `{model, state, questions}`, where `model` is the *deployment name*. A
  `choice` question is `{type, instructions, criteria}`, and `criteria` maps
  each option name to its description (Microsoft Learn). The response is
  `{model, answers, usage}`. Its `model` names the underlying model,
  `microsoft-decision-1`, with no version (recorded probe). A choice answer
  carries `choice`, `confidence`, `probabilities` (one per option) and `type`.
- **Auth:** an API key in the `api-key` header, recorded working on
  `snitch-resource`. Microsoft Learn gives `Authorization: Bearer` for an
  Entra ID token instead.
- **Deployments:** model `Microsoft-Decision-1`, version `1`, as
  GlobalStandard, or as DataZoneStandard in selected regions. GlobalStandard
  may process a request in any Azure region. DataZoneStandard keeps processing
  inside the data zone.
- **Limits:** input of up to 32,768 tokens. No source read says whether that
  is per request or per question, and none mentions a long-context option.
  Recorded: a 100-option `choice` was accepted, and the D6 requests of about
  7,950 input tokens with 86 options each were accepted. Rate limits are per
  deployment, and a 429 is returned when one is exceeded.
- **Errors:** Microsoft Learn lists 400 (invalid question type or shape), 401,
  403, 404 (wrong endpoint or path), 422 (unsupported deployment name or
  question definition) and 429. Recorded: an invalid key returns 401, and an
  unknown deployment name returns 404 with code `DeploymentNotFound`, not 422.
- **Determinism:** not stated by Microsoft. Measured on one case (D6, #905):
  ten identical requests chose the same option every time, but its
  probability ranged from 0.687 to 0.922. The choice repeated; the
  probability did not.
- **Calibration:** Microsoft describes the probabilities as calibrated and
  reports the highest accuracy across 36 benchmarks of about 150,000 held-out
  questions. Neither the method nor the datasets were read, and nothing shows
  any benchmark covers code or specification review.
- **Wording sensitivity:** Microsoft Learn: "Scores can change based on how you
  phrase or order questions and options."
- **Price:** $0.042 per million input tokens. Output is free.
- **Responsible-use limit:** the catalog says the model should not be the sole
  automated decision-maker for consequential matters involving employment,
  credit, housing, healthcare or legal rights. BuildWorks' decisions are about
  code and documents, not people, but the gate design below never makes it the
  sole decision-maker in any case.
- **Data and terms:** the model is served from the operator's own Azure
  resource, so it falls under that subscription's Azure terms rather than a
  separate vendor's site terms. None of the sources read states data retention
  or training use for this model specifically; both must be read from
  Microsoft's product terms before any target content is sent.

The API shape matches TypeSafe's System One API as documented for Jev: the
`systemone` path, the three question types including the unusual `noul`, and
the identical $0.042 price. Microsoft Learn says only that "the request
pattern is similar to a system-one API". Jev's documented details therefore
do not carry over unless Microsoft documents them or a response records them.
Recorded so far: a `confidence` field on every choice answer, and
probabilities that sum to 1 within 1e-15. The 255-option and 2-10-level caps
remain unknown.

## What it does and does not fix

The operator's hope is that a typed-decision model handles prose problems,
schema problems and models making mistakes. Each, against the mechanism above:

- **Schema problems: fixed for decisions, not for text.**
  - What it fixes: a Decision-1 answer is a typed value from a closed set, so
    a disposition, a verdict or a severity cannot come back malformed.
  - What remains: the reviewer finding's `subject`, the reconciler's revised
    document, its `normativeChanges` text, and every patch are text, which
    Decision-1 cannot produce. That text stays with Claude under
    `--json-schema`, which already ended malformed patch replies (`94e3b98`;
    one paid run, every patch reply applied).
- **Prose problems: reduced where prose explains a decision contract.**
  - Today the reconcile prompt teaches one reply shape per disposition in
    prose (`buildSpecReconcilePrompt` and the shared decision contract in
    `src/prompts.ts`: "For disposition rejected_with_rationale you must also
    supply…", "return no field at all that your disposition does not list").
  - If Decision-1 picks the disposition first, Claude is asked for one fixed
    shape for that disposition. Most of that prose goes away, and so does the
    union that hard rule 3 forbids.
- **Models making mistakes: not fixed. Made measurable and gateable.**
  - Decision-1 is a model and will be wrong some fraction of the time. What
    changes is the shape of the mistake: every decision arrives with a
    probability.
  - First, the error rate can be measured against labelled cases before the
    model is trusted.
  - Second, the deterministic gate can act on the probability: proceed above a
    frozen threshold, otherwise route to the operator or an executable check.
  - Third, typed questions can enumerate every acceptance criterion instead of
    hoping a free-form reviewer reaches it. The 2026-10-13 and 2026-10-15
    replays
    (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security*.json`)
    measured free-form reviewers reporting 0.7 to 3.9 of 7 known defects per
    call, depending on model and effort. That is sampling, and enumeration is
    the structural answer to it. Whether one question's answer is influenced by
    the others in the same request is unconfirmed (see above). If isolation
    cannot be shown, each criterion gets its own request.
  - None of this holds unless the probabilities are calibrated on BuildWorks'
    own questions, and nothing published shows that.
- **A risk specific to this workload.** The replays found that reviewers who
  reasoned longer found more defects. Haiku 5.5 at `xhigh` produced about 72K
  output tokens per call and found the most, while Opus 5.5 at `medium`, with
  about 3,400 thinking tokens, found 0.7 per call. Decision-1 is built for the
  opposite end: a 9B model scoring in a single pass, with no extended
  reasoning. It can only work here on small states asking narrow questions,
  never "review this 2,000-line diff".

## Where it fits in the three handoffs

Generation stays with Claude: spec, plan and code authoring, reviewer
findings, revision text and remediation patches. Decision-1 takes the
decision points. Each decision below names its question, its state, and what
the deterministic gate does with the answer.

Size check from crew-chatter run 6: the design is 7,563 characters, the spec
13,791 and the plan 27,115, so design plus spec plus plan is roughly 12K
tokens. That fits the 32,768-token input limit whether the limit is per
request or per question. The full code-review input (spec, plan and diff,
121,905 characters) does not fit, so code-review questions must use sliced
states. If the limit is per request rather than per question, the
per-criterion questions in D1 and D4 also have to be batched across requests
so that the state plus every question in one request fits.

### Design → spec → spec review → reconcile

- **D1 Traceability (hazard 13).**
  - State: the design plus the spec.
  - Questions: per spec acceptance criterion, a `choice` over the design's
    sections and bullets, parsed deterministically, plus `none`. The question
    is "which design statement does this criterion implement?".
  - Reverse direction: per design bullet, a `noul` "the spec has a criterion
    that implements this statement".
  - Gate: a criterion answered `none` above the threshold becomes a
    system-raised finding with a templated subject. An uncovered design bullet
    does the same. Low probability becomes a finding marked for the operator.
- **D2 Finding triage.**
  - State: the design, the spec and one canonical finding.
  - Question: a `noul` "this finding identifies a defect the spec can fix,
    judged against the design".
  - Gate: recorded as evidence only, until the evaluation below shows its
    error rate. Decision-1 never silently drops a finding.
- **D3 Disposition.**
  - State: the design, the spec and one finding.
  - Question: a `choice` over the five dispositions (`addressed`,
    `rejected_with_rationale`, `upstream_follow_up`, `upstream_blocking`,
    `cannot_determine`), each with its rubric.
  - Gate: above the threshold, the author is dispatched to write only the
    fixed shape for that disposition. Below it, the finding goes to
    `cannot_determine`, which uses the existing operator pause.
  - This changes who decides a disposition: today the author does
    (`ARCHITECTURE.md` section 12, "Nothing resolves its own finding"). That
    is an architecture decision for the operator.

### Plan → plan review → reconcile

- **D1 Coverage, plan side.** The plan's `## Coverage` claims are checked
  deterministically for form today; Decision-1 checks whether each claim is
  true.
  - Per claimed pair: a `noul` "task T implements criterion AC-k".
  - Per task: a `choice` over the spec's criteria plus `none`, to catch an
    orphan task, which is an invented obligation.
  - State: the spec plus the plan (about 10K tokens for run 6).
- **D2 and D3** as for the spec, with the spec as the source document.

### Implementer → code review → code-review reconciler → severity gate

- **D4 Criterion check (hazard 18).**
  - Per acceptance criterion: a `choice` of `implemented`, `partial`,
    `not_implemented` or `cannot_tell`.
  - State: the criterion's text plus the files the plan's tasks for that
    criterion declare, sliced to fit the input limit.
  - Gate: `not_implemented` above the threshold becomes a system-raised
    finding that enters the existing remediation loop. This is the
    enumeration that reviewer sampling lacks.
- **D5 Finding validity.**
  - State: one reviewer finding plus the file at its location.
  - Question: a `noul` "the defect this finding describes is present in this
    code".
  - Gate: recorded first. Later it is a precision filter before remediation,
    since each false finding costs a remediation dispatch, and run 6 showed
    remediation is where out-of-spec obligations enter.
- **D6 Code-review reconciler replacement.**
  - Today two Haiku calls must both reject, each with an excerpt that must
    occur in the spec.
  - Instead: a `choice` over the spec's criteria and section headings plus
    `none` ("which clause of the approved specification excludes the
    behaviour this finding asks for?"). The system then quotes that clause
    deterministically, so an invented quote becomes impossible. The replay
    caught one invented quote.
  - Gate: withhold a finding only when one clause is chosen above the
    threshold.
- **D7 Severity.**
  - Question: a `score` over `low`, `medium`, `high` and `critical`, each with
    its rubric.
  - Gate: block on P(severity ≥ the frozen blocking level) above the
    threshold, instead of on one reviewer's label. This requires the `score`
    answer to carry a probability per level. Microsoft Learn says it does ("the
    probability for each level"), but no `score` response has been recorded.
    Spec-review outcomes varied on
    the same disclosed decisions, though identical input was not shown
    (`docs/proposals/spec-review-severity-nondeterminism.md`).

## Fit against the hard rules and the architecture

- **Rule 1 (one harness until one run completes):** satisfied; runs have
  completed end to end.
- **Section 11 ("one adapter, concrete, with no interface above it"):**
  Decision-1 is not a harness: it has no agent, tools or files. It would be a
  second concrete client, a new *src/systemone.ts*, called directly by stage
  code with no executor interface. Adding it is an amendment to section 11.
- **Rule 4 (no abstraction without two implementations):** no "decider"
  interface. Decision-1 calls are concrete. A Claude fallback is deliberately
  absent (see failure handling below). Pointing the same client at another
  System One provider later would be a change of endpoint and configuration,
  not a second implementation.
- **Rule 3 (one schema per thing):**
  - Each decision has one question shape and one stored row shape.
  - D3 replaces today's per-disposition reply union with one schema per
    disposition dispatch.
- **Rule 5 (recorded fixtures):** every Decision-1 fixture is a recorded
  response from the operator's resource, with a provenance block. The client's
  response schema is taken from the recorded probe
  (`test/fixtures/recorded/systemone-probe-snitch-resource.json`), not from the
  secondary sources above.
- **Rule 6 (frozen config):**
  - The endpoint, the deployment name and the deployment type are frozen in
    the profile at `new-run`. All three come from environment variables
    because the operator expects them to change. A change applies
    to the next run, never to a run already started.
  - The deployment name is an alias the operator controls (hazard 10), so the
    profile also snapshots the model name and version it resolves to, from
    whatever the response or the deployment metadata reports. The response
    reports `microsoft-decision-1` with no version (recorded probe and all 35
    D6 requests). So a deployment upgrade within that model name is
    undetectable at run time from the response alone. That is either an
    accepted gap, or the version must come from the deployment metadata.
  - So is every threshold.
  - So is every question's text, by hash. Microsoft's own warning that
    results change with wording makes this load-bearing, not cosmetic.
- **Section 12 ("a reviewer's verdict is an input to a gate, never the gate
  itself"):** a Decision-1 probability is an input; the gate is the frozen
  threshold rule in code.

## Implementation shape

- **`src/systemone.ts`** (built 2026-10-16 for the D6 evaluation, not wired
  into any stage):
  - A concrete `fetch` client that POSTs to the endpoint it is given; a run
    would give it the frozen one.
  - The key is read from `SYSTEMONE_API_KEY`, sent in the `api-key` header,
    and never logged or stored. A key holding anything but printable ASCII is
    refused before sending. Entra ID instead of a key is an operator choice
    (see below).
  - It validates the response:
    - the `answers` keys equal the question keys;
    - each answer has the type its question asked for, and the chosen option
      is one of its options;
    - the probabilities cover exactly the options and sum to 1 within 1e-6;
    - the response names a model and reports input-token usage.
    Each check is written against a recorded response. The response's `model`
    names the underlying model, not the deployment, so it is recorded, not
    compared with the deployment name.
  - It retains the raw request and response beside the existing raw dispatch
    evidence, and records the input-token usage if the response reports it.
- **Failure handling:** fail closed.
  - A 400, 401, 403, 404, 422, a 429 after the frozen retries, or any 5xx
    blocks the stage with the status named. The built client retries nothing.
  - No silent fallback to Claude, which would be a second decision path with
    different error rates.
- **`src/policy.ts`:** one threshold per decision (D1-D7), frozen into the
  profile.
- **Deployment variables:** the endpoint, deployment name and type are not
  constants in `src/policy.ts`. They are read from three environment
  variables at `new-run` and frozen into the profile with everything else:
  - `SYSTEMONE_ENDPOINT`: the full request URL. It is
    `https://snitch-resource.services.ai.azure.com/providers/microsoft/v1/systemone`
    today. A value that is not an absolute `https` URL is refused, because
    the client sends the key to whatever this names.
  - `SYSTEMONE_DEPLOYMENT`: the deployment name, sent as the request's
    `model` field. It is `Decision-1` today.
  - `SYSTEMONE_DEPLOYMENT_TYPE`: recorded as given and checked against no
    list of one vendor's offers (operator decision 2026-10-17: there will be
    many Decision-1 endpoints and the resource may move, so no vendor-specific
    value is hard-coded). It is `DataZoneStandard` today.
  - `new-run` refuses when any of the three is missing, rather than choosing
    a default.
  - The client never reads these variables after `new-run`; it uses the
    frozen values.
  - The deployment type is recorded, not sent: no Decision-1 request carries
    it. It is the operator's declaration of where requests are processed, and
    it is checked against the resource only if `doctor` gains the management
    route below.
- **Store:**
  - One new table holding one row per question asked: run, stage, decision
    kind, subject (criterion, finding or pair), question hash, endpoint,
    deployment name, deployment type, resolved model version, answer, probabilities, threshold and
    gate outcome. It is audited like every other write.
  - The `ALTER`/`CREATE` must be folded into `scripts/doc-check.mjs` and
    `test/schema.test.ts`.
- **`doctor`:** must confirm, without spending, that the key is present and
  the frozen deployment exists. Microsoft Learn documents no free listing
  route on `/providers/microsoft/v1/`. It lists deployments with
  `az cognitiveservices account deployment list`, which needs Azure
  management credentials that a run otherwise does not. Whether `doctor` uses
  that, or checks only that the configuration is present, is an open
  decision for the adoption plan.
  Either way, `doctor` and `status` print the endpoint, deployment name and
  type in effect: the environment's values before a run, and the frozen values for a
  run.
- **Prompts (hazard 21):** the author and implementer prompts state the
  Decision-1 questions their output will be judged by.
- **Cost:** a run's Decision-1 input should be a few million tokens at most,
  about $0.10 at the published price. This is an inference from the sizes
  above, not a measurement.

## Evaluation before adoption

Decision-1's error rate and calibration on these questions are unknown, so
each decision is adopted only after a recorded evaluation against labelled
cases, with its adoption rule written before the run. The labelled cases must
come from outside the session that scores them. Candidate sources already
committed:

- **D6:** `test/fixtures/recorded/code-review-reconciler-*.json` (30 recorded
  single Haiku 5.5 calls over 26 findings: one wrong rejection of 906 and three
  missed rejections of 905). The labels were fixed before any call, but from
  the spec text by an assistant session, so the operator confirms them before
  they count as ground truth. Ask Decision-1 the same findings and compare its
  errors with Haiku's on the same cases.
- **D5 and D7:** the crew-chatter run 6 findings, once each is labelled real
  or false by a reproduction against `bb7f3f6`. These are the findings in
  `test/fixtures/recorded/code-review-crew-chatter-run-6.json` and the replay
  fixtures. The reproductions do not exist yet.
- **D1:** the crew-chatter and web-calculator designs, specs and plans, with
  traceability labelled by the operator.
- **D3:** no labelled set exists. An author's recorded disposition is not
  ground truth. This decision needs operator-labelled cases or stays last.

Per decision, the measurements are:
- accuracy against the labels;
- Brier score;
- the accuracy of answers above the proposed threshold, which is what the
  gate relies on;
- the same typed question asked of Haiku 5.5 through `--json-schema`, as a
  baseline;
- for one fixed case, the spread of answers when the identical request is
  repeated, since determinism is not stated.

## Evaluation record

**D6, 2026-10-16: fails.** The plan is `docs/features/decision-1-d6-evaluation/plan.md`.
The result, with every request hash, response, score and Haiku comparison, is
`test/fixtures/recorded/systemone-d6-evaluation-crew-chatter-run-6.json`.

Setup:
- 35 requests to `Decision-1` (`DataZoneStandard`) on `snitch-resource`: the
  26 labelled cases once each, and #905 nine more times. Every response named
  `microsoft-decision-1`.
- Cost: 278,580 input tokens, $0.0117.
- Each request asked one `choice` question: which of the specification's 85
  clauses, or `none`, the finding asks to go beyond.
- The operator confirmed the labels and the rule before the first request.
  The rule withholds a finding when the chosen clause has P ≥ 0.8.

Results by rule clause:
- **Validity: passed.** All 35 responses validated.
- **No wrong rejections: passed.** None of the 17 keep-labelled findings was
  withheld, at any threshold from 0.5 to 0.95. Haiku made one wrong
  rejection in 30 single calls (#906, call 5b-3), and none under the built
  2-of-2 rule.
- **Correct rejections: failed.**
  - #200 chose `none`. `none` and `L048` tied at 0.4659.
  - #905 chose `L048` at 0.895, while its labelled baseline `L047` got
    0.0145.
  - `L048` is the line "`backend/src/lib/auth.ts` parses the `Cookie` header
    … and responds HTTP 401 when the session is missing or invalid". It sits
    between the two labelled baselines, and the labels do not include it.
  - Haiku rejected #200 in 10 of 10 calls and #905 in 7 of 10, quoting a
    labelled baseline each time.
- **Determinism: failed.** All ten #905 answers chose `L048`, but its
  probability ranged from 0.687 to 0.922.

Reported for information:
- The Brier score of P(withhold) = 1 − P(`none`) over the 19 labelled cases
  was 0.0127.
- Of the either-labelled cases, only #207 chose a clause (`L056`, at 0.737),
  so it is withheld only below T = 0.74.

What this does and does not show:
- On these cases Decision-1 was precise but not accurate about rejections. It
  never withheld a finding that must be fixed. It also never named a
  labelled baseline, and it pointed both out-of-spec session findings at the
  session-verification line instead.
- Whether `L048` is also an acceptable baseline is a labelling question.
  Relabelling after seeing the answers would fit the labels to the model, so
  the verdict stands under the rule fixed before the run.
- The comparison is not like for like. Haiku also had the plan, the full diff
  and the checkout; Decision-1 had one finding and the specification.
- There are two reject-labelled cases, from one stand-in project.

**Format checks, 2026-10-17.** The run covered two further checks: 172 requests for $0.001632 (`docs/features/decision-1-format-checks/plan.md`, "Evaluation record"). Both used case sets built from recorded failures, with labels confirmed before any call and the D6 rule at T = 0.8.
- **Narration passes.** The check asks whether an Acceptance criteria entry carries the author's remark about the work. It flagged all 3 labelled remarks and none of the 128 criteria, and its ten repeats answered at 0.999.
- **Grounding fails.** The check asks whether a cited excerpt supports its claim. It caught all 3 unsupported citations but flagged 2 supported code-review rejections, and its repeats spread 0.038.

**Narration adopted, 2026-10-17.** The operator adopted the narration check in `spec_review` (`docs/features/narration-check-spec-review/plan.md`; ARCHITECTURE.md sections 11, 12, 15 and 23). Before each round's panel it asks the evaluated question once per acceptance-criteria entry; an entry flagged at T = 0.8 is a finding for the reconciler, and any failed request blocks the run. `new-run` freezes the deployment from the `SYSTEMONE_*` variables and refuses without them unless `--no-narration-check` is given. Grounding is not adopted.

## Proposed order

Each step ships only if its evaluation passes:

1. **D6.** The smallest change, with labelled data that already exists. It
   replaces two Claude calls. Evaluated 2026-10-16 and failed (see
   "Evaluation record"); not adopted.
2. **D7 and D5.** The code-review gate inputs.
3. **D4.** The criterion check after implementation.
4. **D1.** Spec and plan traceability.
5. **D3.** The disposition split. It is the largest change: it amends
   sections 12 and 13 and moves the disposition from the author to a gated
   Decision-1 decision.

## Decisions the operator must make

- **Deployment: recorded.** The operator confirmed on 2026-10-16 that
  Microsoft-Decision-1 is deployed on `snitch-resource` as `Decision-1`, type
  `DataZoneStandard`. The operator expects the endpoint, name and type to
  change, so they are the environment variables `SYSTEMONE_ENDPOINT`,
  `SYSTEMONE_DEPLOYMENT` and `SYSTEMONE_DEPLOYMENT_TYPE`, not constants (see
  "Deployment variables" above). `DataZoneStandard` keeps processing inside the data zone, which is
  one input to the data decision below.
- **Auth.** An API key in an environment variable, or Entra ID. The operator
  chose the API key (`SYSTEMONE_API_KEY`) for the D6 evaluation on
  2026-10-16. A Foundry key grants full access to the whole resource and is
  rotated by hand, so it should not be shared with whatever else uses
  `snitch-resource`.
- **Data.** Whether target specifications and code may be sent to the
  resource. This is decided by the subscription's Azure terms, the deployment
  type's processing location and company policy. Retention and training use
  for this model must be read from Microsoft's terms first. The operator
  allowed only the committed crew-chatter run 6 fixtures for the D6
  evaluation (2026-10-16). On 2026-10-17 the operator stated that data can
  be sent to the resource for some of the decisions the operator takes, and
  that there will be many Decision-1 endpoints. Which decisions those are is
  named per decision, before that decision's evaluation runs.
- **Architecture.** The section 11 amendment for a second concrete client.
  For D3 only, the section 12 and 13 change in who decides a disposition.
- **Thresholds.** The adoption rule and threshold for each decision, set
  before its evaluation runs.
