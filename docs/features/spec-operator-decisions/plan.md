# Spec Operator Decisions Implementation Plan

**Status:** Implemented

**Goal:** A `spec_review` question that would block the run instead pauses it and asks the operator, with options and a recommendation; the operator approves the recommendation, denies it (leave open, continue), or writes their own answer, from the CLI or the dashboard, and the spec author folds the answers into the spec before approval.

**Source:** Operator decisions, 2026-09-27. Evidence: team-notes runs 1 and 2 (external target `C:\Users\Shawn-work\repositories\testing-repos\team-notes`, $1.4078 and $1.1701) and note-keeper runs 1 and 6 all blocked at `spec_review` on open design questions the model judged blocking. Run 2 blocked after `docs/features/spec-review-blocking-criterion/plan.md` narrowed the criterion: the reconciler blocked OD-003 (version retention, "a defined number of historical versions or … a documented period") while following up OD-002, a structurally identical question. Operator conclusion: "We are going to need to prompt for human approval / feedback. That will settle it once and for all." Choices made in session:
- **Deny** leaves the question open: it is recorded as a follow-up, the spec says nothing new about it, and the run continues. A denied question that came from the spec's own `## Open decisions` keeps that entry exactly as written.
- **Surfaces:** CLI and dashboard. The dashboard answer form is a second dashboard write.
- **Which questions:** only findings the reconciler marks `upstream_blocking` or `cannot_determine` with a question. Follow-ups stay recorded and are listed, not asked.
- **Process:** plan first, operator review, then implementation.

**Hazards considered:** `docs/hazards.md` items 1, 2, 3, 4, 13, 14, 16 and 17.
- **3 (constraint stated in the prompt):** the question object (text, 2-4 options, recommended index, why) is a new constrained field. The spec reconcile prompt states its shape, and the advertised example validates against `validateReconciliation` (Task 2).
- **1 (output shapes):** the fold dispatch is a new model response parsed by the existing `extractJsonBody` and `validateAgentResult`; refusals name the rule that failed (Task 6).
- **2 (discarded output):** the fold goes through `dispatchOnce`, which retains raw output before parsing. No new dispatch path.
- **4 (fixtures agreeing with code):** the fixture emitter (`test/fixtures/harness/emit-spec-stage.mjs`) gains question and fold responses. Their shapes come from the validator stated in Task 2, not from the stage code, and the stage tests assert rows and audit events the stage writes.
- **13 (inventing obligations):** the fold may add a normative node only when its grounding occurs in the design or in the operator's recorded answer to that same question. An approved or modified answer is the operator's decision, not the model's.
- **14 (independence):** an operator answer is a human decision recorded with `actor_type: human`. It is never described as a reviewer or panel result.
- **16 (upstream routing):** `upstream_blocking` changes meaning in `spec_review` only: it now asks the operator instead of ending the run. Its proposal row is still written with route `blocking_dependency` and is never rewritten. A denied question is recognised by its `deny` answer, which the snapshot shows beside the proposal. `plan_review` routing is unchanged.
- **17 (deletion accounting):** the fold's normative delta is accounted for in both directions with the existing `validateReconciliation` machinery. Removing an obligation needs a grounded claim, as it does today.

Items 5-12, 15 and 18 do not govern this change. It touches no delivery check, later-stage promise, retry, executable resolution, hook, model alias, seeding, configuration surface, sandbox or code-review gate.

**Assumptions:**
- **Architecture decision.** Approving this plan authorizes Task 1's edits to `ARCHITECTURE.md` sections 3, 5, 12, 13, 15, 17 and 23 and hard rule 2 in `CLAUDE.md`/`AGENTS.md`. The edits add a second human decision point and a second dashboard write, and neither creates a second mutation authority. Every write goes through a core function under the repository writer lock, exactly as `approveRun` does.
- **Fixed-length chain.** `prefixAction` (`src/operator-state.ts`) identifies every boundary by stage count against a fixed `STAGES` list. `spec_decision` is therefore always present: the spec group creates and passes it when no question is open. Optional stages would need a boundary interpreter rewrite, which this plan avoids.
- **Existing stores.** Runs recorded before this change lack `spec_decision`. Under hard rule 3 there is no compatibility handling: `prefixAction` reports them `interrupted_or_inconsistent`, and a fresh run is the repair. This includes the note-keeper and team-notes histories. Their rows remain readable through `status`.
- **Only model-chosen blocks become questions.** A decision the deterministic checks converted to `cannot_determine` (`conversions` in `validateReconciliation`) still ends the run, because it records a malformed or ungrounded claim, not an open question the operator can answer. Mechanical failures (invalid document, unclaimed nodes, added open-decision IDs) also stay terminal.
- **Answers are immutable.** One answer per question. A mistaken answer is repaired by a fresh run, the same rule as every other recorded decision.
- **The fold is not re-reviewed.** The operator's answers are human decisions. The operator reads the folded spec at approval, which is still the signature gate; no panel reviews the fold, consistent with section 12's no-closure-pass rule.
- **No live run.** Proof is fixture-based. A live check is separately authorized.

**Approach:**
- **Contract.** A spec `upstream_blocking` or `cannot_determine` decision must carry `question: {"text", "options": [{"label", "answer"}], "recommended": <index>, "why"}` with 2-4 options. `plan_review` decisions are unchanged.
- **Storage.** Migration 007 adds `decision_question` and `decision_answer` tables. A question's stage is always derived through its finding; the question row stores no stage of its own.
- **Gate.** The `spec_review` gate no longer blocks on model-chosen `upstream_blocking` or `cannot_determine` decisions that carry a question. It still records `spec.gate.pass` with the reviewed spec's hash and risk, plus `spec.questions.open` naming the question IDs. With none open, the spec group also creates and passes `spec_decision`.
- **Answers.** A core `answerQuestion` records approve, deny or modify under the writer lock, writing the answer and its audit event in one store transaction. It is called by `bw decide` and by a dashboard POST route. Neither dispatches anything.
- **Fold.** A new execution group, `decision`, runs once every question has an answer. It creates `spec_decision` and, unless every answer is deny, dispatches the spec author once with the design, the spec and the answers. It validates the revision with the existing spec gates, a fold-only grounding check (design or the recorded answer), and a check that every denied disclosed open decision survives unchanged, then writes the spec and records `spec_decision.gate.pass` with the folded hash.
- **Approval.** Approval then binds the `spec_decision` output and hash instead of the `spec_review` gate event.

**Affected areas:**
- `src/reconciliation.ts`: `ReconciliationDecision`, `validateReconciliation` (question field; a fold-only grounding source set). `UPSTREAM_SOURCES` is unchanged.
- `src/prompts.ts`: `buildSpecReconcilePrompt`, new `buildSpecDecisionFoldPrompt`.
- `src/migrations/007_decision_question.sql`, `src/store.ts`.
- `src/spec-stage.ts`: gate and question persistence. New `src/spec-decision-stage.ts`: `answerQuestion`, `runSpecDecisionStage`.
- `src/approval-stage.ts`: `buildBinding`.
- `src/operator-state.ts`: `STAGES`, `EXECUTION_GROUPS`, `prefixAction`, snapshot `questions`, boundary checks.
- `src/run-command.ts`: `callGroup`, `expectedBoundary`, `remainingGroups`, `boundaryResult`.
- `src/operator-output.ts`: the `run` exit-code mapping for `awaiting_decision`.
- `src/guided-command.ts`: decision pause and interactive answers.
- `src/cli.ts`, `src/cli-args.ts`: `decide`.
- `src/dashboard-server.ts`, new `src/dashboard-decision.ts`, `src/dashboard/app.js`, `src/dashboard/dashboard-model.js`.
- `test/fixtures/harness/emit-spec-stage.mjs` and the tests named per task.
- `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/runbooks/cli-operator.md`, `scripts/doc-check.mjs` `PINNED_SEQUENCE`, `PINNED_TABLES` and column pins.
- `src/approval-stage.ts` comment on `approveRun` ("The only human gate").

**Known blockers:**
- **Fixture routing.** `emit-spec-stage.mjs` routes by prompt substring (`self-critique`, `spec reviewer`, `reconcile`, `spec author`, in that order). The fold prompt needs its own distinguishing substring that none of the earlier routes match, and the routing tests in `test/prompts.test.ts` (`routingPrompts`) require every exported builder to be listed.
- **Pinned sequence and schema.** `scripts/doc-check.mjs` `PINNED_SEQUENCE` must change in the same commit as `ARCHITECTURE.md` section 5, and `PINNED_TABLES` plus the column pins in the same commit as the section 15 schema block, or `check:docs` fails.
- **Baseline failures.** Two unrelated tests fail today (dashboard SIGTERM; "nothing under src/ touches a private key").
- **Test leak.** The full suite can leave an empty "moved" commit on the working branch. Check `git log -1` after each full run.
- **No paid execution** without a separate authorization.

**Blast radius:**
- **`prefixAction` / `STAGES`.** Every consumer of `readRunSnapshot` sees the new stage and phase: `run-command.ts`, `guided-command.ts`, `cli.ts` status/runs, the dashboard model. `listRuns` calls `prefixAction` directly. [Verified by reading `src/operator-state.ts` and `src/run-command.ts`.]
- **`buildBinding`.** Called by `approveRun`, `readApprovalRequest` (`src/dashboard-approval.ts`) and `interpretBoundary`. It currently requires the last stage to be a passed `spec_review` and reads `spec.gate.pass`; both change to `spec_decision`. [Verified.]
- **`validateReconciliation`.** Called by `spec-stage.ts` and `plan-stage.ts`. The question requirement is opt-in by context, so the plan side is unchanged. [Callers verified by grep: `src/spec-stage.ts` and `src/plan-stage.ts:671`.]
- **`BLOCKING_DISPOSITIONS`** (`src/plan-gate.ts`) stays as it is for `plan_review`. `specReviewGate` stops using it for question-carrying decisions.

**Verification:** per-task focused tests; then `npm run typecheck`, the full suite (no new failures against the baseline), `npm run check:docs`, `git diff --check`, and `node .claude/skills/run-buildworks/driver.mjs smoke`, which is free. Each new guard gets a break-test that fails by assertion.

---

## Tasks

- **Task 0: Baseline.** Record `npm test` failures and `git log -1` before any change. Expected: the two known failures.

- **Task 1: Record the decision in the architecture.**
  - `ARCHITECTURE.md` section 5: sequence becomes `spec -> spec_review -> spec_decision -> awaiting_approval -> …`. Update `scripts/doc-check.mjs` `PINNED_SEQUENCE` to match.
  - Section 12: add `spec_decision`, an unsigned human decision boundary. It covers what reaches it (model-chosen blocking decisions with a question), the three answers, the fold, its grounding, and that approval binds its output. Change `awaiting_approval`'s "The only human gate" to "The only signed authorization gate", and the same claim in section 17 ("the only human gate in the pipeline") to "the only signed authorization gate in the pipeline". Change the `approveRun` comment in `src/approval-stage.ts` to match.
  - Section 13: `upstream_blocking` in `spec_review` asks the operator; in `plan_review` it still blocks.
  - Section 15: add `decision_question(id, finding_id, text, options, recommended, why, created_at)` and `decision_answer(id, question_id, action, answer, created_at)` to the schema block. Add both tables to `scripts/doc-check.mjs` `PINNED_TABLES`, and pin the `UNIQUE` question and answer keys and the action `CHECK` alongside the existing constraint pins. Break-test the new pins in a checker mirror (per `doc-check`): drop a table from the schema block and drop the action `CHECK` from the migration; each fails `check:docs` by name; restore.
  - Section 3 hard rule 2 and section 23: the 2026-09-27 decision permits a second dashboard write, recording an operator answer through the same core function and writer lock as `bw decide`. Mirror the hard-rule text in `CLAUDE.md` and `AGENTS.md` (byte-identical).
  - Verify: `npm run check:docs`. Expected: exit 0.

- **Task 2: The question contract.**
  - `src/reconciliation.ts`: add `question` to `ReconciliationDecision`. `validateReconciliation` gains a context flag `requireQuestions`. When true, `upstream_blocking` and `cannot_determine` must carry a question: non-empty `text` and `why`, 2-4 options each with non-empty `label` and `answer`, and an integer `recommended` within range. `question` is forbidden on every other disposition, and on every disposition when the flag is false. A missing or malformed question refuses the whole reconciliation by name, the same class as a missing proposal.
  - Fold grounding (used by Task 6) is a context-specific source set, not an addition to `UPSTREAM_SOURCES`. `validateReconciliation` accepts an optional `operatorAnswers` context mapping finding ID to recorded answer text; only then does it accept grounding source `operator_decision`, and only when the excerpt occurs in the answer recorded for that same decision's finding. `UPSTREAM_SOURCES`, `upstreamPrefixFor` and the `insertFindingDecision` source check stay `design`/`specification`/`plan`.
  - `src/prompts.ts` `buildSpecReconcilePrompt`: state the question object and that the operator chooses. Update the `upstream_blocking` and `cannot_determine` shapes in the spec prompt only. `reconciliationDecisionContract` is shared, so the shape change is passed in by the spec caller.
  - Tests (`test/reconciliation.test.ts`, `test/prompts.test.ts`): accept a valid question; refuse each malformed variant by its message; refuse a question on `addressed`; refuse a question when `requireQuestions` is false. `operator_decision` grounding: accepted with `operatorAnswers` when the excerpt is in that finding's answer; refused when the excerpt is only in another finding's answer; refused by ordinary spec and plan reconciliation (no `operatorAnswers`); and refused by `insertFindingDecision` (`test/store.test.ts`). The existing "every decision shape a reconcile prompt advertises validates" test must pass for the spec prompt with `requireQuestions: true` and for the plan prompt without it.
  - Break-test: drop the range check on `recommended`; the out-of-range test fails by assertion.

- **Task 3: Storage.**
  - `src/migrations/007_decision_question.sql`:
    - `decision_question(id, finding_id UNIQUE REFERENCES finding, text, options TEXT JSON, recommended INTEGER, why, created_at)`. No `stage_id` column: `finding.stage_id` is the one authority for which stage owns the question;
    - `decision_answer(id, question_id UNIQUE REFERENCES decision_question, action CHECK IN ('approve','deny','modify'), answer TEXT NOT NULL, created_at)`;
    - `PRAGMA user_version = 7`.
  - `src/store.ts`: `insertDecisionQuestion`, `getDecisionQuestions(stageId)`, `insertDecisionAnswer`, `getDecisionAnswers(stageId)`. Both getters select by joining `decision_question.finding_id` to `finding.stage_id`.
  - Tests in `test/store.test.ts`: round-trip, the unique answer per question, the action CHECK refusal, and a question on a finding of another stage absent from `getDecisionQuestions` for this stage.

- **Task 4: The spec_review gate asks instead of blocking.**
  - `src/spec-stage.ts`: call `validateReconciliation` with `requireQuestions: true`. Persist each question beside its decision.
  - `specReviewGate` blocks only on converted `cannot_determine` decisions (those in `conversions`). Model-chosen `upstream_blocking` and `cannot_determine` decisions with questions pass the gate.
  - On pass, record `spec.gate.pass` as today, then `spec.questions.open questions=<ids>`. If none are open, insert `spec_decision` with the spec as `output_ref` and complete it `pass`, audited `spec_decision.stage.create` and `spec_decision.gate.pass` with `specHash=…; risk=…; answers=0`.
  - Fixture: `emit-spec-stage.mjs` gains a mode that returns an `upstream_blocking` decision with a question.
  - Tests in `test/spec-stage.test.ts`:
    - a blocking question leaves the run `in_progress` with spec_review passed and no `spec_decision` row;
    - a converted `cannot_determine` still blocks the run;
    - no questions gives three passed stages;
    - an `upstream_follow_up` decision creates no question.

- **Task 5: Answers (`answerQuestion`, `bw decide`).**
  - New `src/spec-decision-stage.ts` `answerQuestion(store, root, {runId, findingId, action, answer?})` refuses unless:
    - the run is in progress;
    - its last stage is a passed `spec_review` with no `spec_decision` row;
    - the question exists, its finding belongs to that stage, and it has no answer;
    - `modify` carries non-empty text of at most 4000 characters, and `approve`/`deny` carry none.
  - Recording: `approve` stores the recommended option's `answer` text; `deny` stores an empty answer; `modify` stores the text. Each answer is audited as `decision.answer` with `actor: operator`, `actorType: human`. The answer insert and its `decision.answer` append run inside one `store.transaction`, as `approveRun` does for its stage and audit rows: either both commit or neither does. A refusal is audited as `decision.refused` outside that transaction and creates no answer row, mirroring `approveRun`.
  - `src/cli.ts`: `decide --repo --run --finding (--approve | --deny | --answer-file <path>)`. It takes the writer lock and opens an exact-current store, as `approve` does. `--answer-file` resolves from the invocation directory and reads UTF-8. The existing usage and help tables list the command.
  - Tests in `test/spec-decision-stage.test.ts` and `test/cli-operator.test.ts`: each refusal by message; a second answer refused; approve stores the recommended text; a finding from another stage refused; an injected failure in the `decision.answer` append leaves no answer row and no audit event, and a retry of the same answer then succeeds.
  - Break-test: move the answer insert outside the transaction; the fault-injection test fails by assertion.

- **Task 6: The decision group (`runSpecDecisionStage`).**
  - Refuses unless every question from Task 4 has an answer.
  - Inserts `spec_decision` (input: the spec_review stage).
  - When every answer is `deny`: completes `pass` with the unchanged spec and an audit `answers=<n>; folded=0`.
  - Otherwise dispatches the frozen spec author once, with the `spec` model and `spec-reconciliation` output. The prompt is `buildSpecDecisionFoldPrompt(author, design, spec, answeredQuestions)`, which states the spec schema, the no-add open-decision rule, and that denied questions stay open and unmentioned.
  - Validation, all existing checks unless noted:
    - `validateAgentResult` and `validateSpecDoc`;
    - `change_kind` equality;
    - the no-added-open-decision check;
    - new, denied-disclosed preservation: for each denied question whose finding is a disclosed open decision (location `upstream:design:od-nnn` with that ID in the reviewed spec's `## Open decisions`), the folded spec's `## Open decisions` holds an entry with the same ID, severity and text, exactly. `specNormativeNodes` excludes `## Open decisions`, so the normative delta cannot catch this and the check is separate;
    - the normative delta through `validateReconciliation`, with one synthetic `addressed` decision per approved or modified question and none for a denied question, so a node added for a denied reviewer-raised question has no claim and refuses. Grounding may cite `design`, or `operator_decision` through the Task 2 `operatorAnswers` context, whose excerpt must occur in the answer recorded for that same question. The model returns those decisions in the same shape it uses today.
  - Any failure completes the stage `block` and blocks the run (fresh run is the repair), matching `abort` in `spec-stage.ts`.
  - On pass, it writes the spec and records `spec_decision.gate.pass specHash=…; risk=…; answers=<n>; folded=<m>`.
  - Tests: fold pass; all-deny pass without dispatch; an ungrounded addition blocks; an added open decision blocks; the answers text is in the prompt. Mixed approve-plus-deny folds: one approved question and one denied disclosed open decision pass with the denied entry byte-for-byte preserved; the fold deleting that entry blocks; the fold rewording its text or changing its severity blocks; a node added for a denied reviewer-raised question blocks; a node grounded in another question's answer blocks.
  - Break-test: skip the preservation check; the deleted-entry and reworded-entry tests fail by assertion.

- **Task 7: Boundaries, approval, run and guided flow.**
  - `src/operator-state.ts`:
    - `STAGES` gains `spec_decision` at index 2, and the group map becomes `0: spec, 2: decide or decision, 3: approval, 4: plan, …`. `EXECUTION_GROUPS` gains `decision` after `spec`.
    - Two separate states at stages.length 2. Any question unanswered: phase `awaiting_decision`, workflow group `decide`, a non-execution action handled like `approval`. Every question answered: phase `ready`, execution group `decision`.
    - The snapshot gains `questions: [{findingId, text, options, recommended, why, answer: {action, text, at} | null}]`.
    - Approval checks read `spec_decision` and its gate event in place of `spec_review` and `spec.gate.pass`.
    - `frozenGroupReasons` treats group `decision` like `spec` for model, binding and author-output checks (`spec` model, `spec-reconciliation` output), so an unconfigured run refuses before the fold is paid for.
  - `src/approval-stage.ts` `buildBinding`: the last stage must be a passed `spec_decision`, and the hash and risk come from `spec_decision.gate.pass`.
  - `src/run-command.ts`:
    - `callGroup("decision")`.
    - `boundaryResult`: group `decide` returns outcome `awaiting_decision`, as `approval` returns `awaiting_approval`; the loop's non-execution check treats `decide` like `approval`.
    - `expectedBoundary(spec)` accepts exactly two shapes: 3 passed stages with next group `approval`, or 2 passed stages with next group `decide`. `expectedBoundary(decision)` expects 1 passed stage with next group `approval`, not the next `EXECUTION_GROUPS` entry.
    - `remainingGroups` returns `["decision"]` for group `decision`, as it returns `["spec"]` for `spec`, so the consent preview never claims post-approval groups.
  - `src/operator-output.ts`: `run` outcome `awaiting_decision` exits 3, the same external-pause code as `awaiting_approval`.
  - `src/guided-command.ts`: at `awaiting_decision`, list each question with numbered options and the recommendation, then prompt approve / deny / modify. Record answers through `answerQuestion`. Redirected input refuses as today.
  - Tests: snapshot phase and actions for each state; approval refuses before `spec_decision` passes; guided prompts drive `answerQuestion` (existing guided test harness). `advanceRun`, both spec branches: with an open question, outcome `awaiting_decision`, exit 3, `groupsCompleted: ["spec"]`, 2 stages; with none, outcome `awaiting_approval`, 3 stages. After answers: the preview's `remainingGroups` is exactly `["decision"]`, and the run ends `awaiting_approval` with 3 stages.
  - Break-test: let `remainingGroups` slice `EXECUTION_GROUPS` for `decision`; the preview assertion fails.

- **Task 8: Dashboard.**
  - `src/dashboard-decision.ts` `submitDecisionAnswer(target, invocationDirectory, {runId, findingId, action, answer})`: the `submitApproval` sequence (lock, exact-current schema, writer, `answerQuestion`).
  - `src/dashboard-server.ts`: `POST /api/repositories/:id/runs/:run/decisions/:finding` with the approval route's token, Origin, media type and body-size rules. The body is exactly `{action, answer?}`.
  - `src/dashboard/app.js`: the run view shows open questions as cards, each with the options, the recommended option badge, the reason, and Approve / Deny / Modify controls (Modify opens a text area). Answered questions show the recorded answer. `dashboard-model.js` projects `questions`.
  - Tests: route auth, Origin, 405, size and body shape refusals (mirroring the approval route tests), and the CLI and dashboard producing the same answer and audit record for one question. `test/dashboard-ui.test.ts` gains structural pins for the question card.

- **Task 9: Operator docs.** Update `README.md`, `docs/runbooks/cli-operator.md` and the command lists in `CLAUDE.md`/`AGENTS.md` (the decide command and the decision pause). Verify: `npm run check:docs`.

- **Task 10: Verification and closure.** Run `npm run typecheck`, the full suite (only the baseline failures; `git log -1` unchanged), `node .claude/skills/run-buildworks/driver.mjs smoke` (free; update the driver if its expected chain lists stages), `npm run check:docs` and `git diff --check`. Run an independent review per the operator's choice, then set this plan `Implemented` with a note.

---

## Implementation note

**Shipped (2026-09-27, uncommitted on `dashboard-ux-redesign`):** Tasks 0-10 as written, with the deviations below. No paid run was made; proof is fixture-based.

**Deviations:**
- Migration 007 was written in Task 1, because the checker's table and constraint pins read it in the same commit as the section 15 schema block. `test/schema.test.ts` was updated for `user_version = 7`.
- `answerQuestion(store, input)` takes no `root`: nothing it checks reads the filesystem.
- `answerQuestion` trims `modify` text (code-review finding 7), so the CLI and the dashboard store the same bytes; the CLI still strips a leading BOM from `--answer-file`.
- The snapshot's `operatorActions` gained `decision_answer` entries, and `status` text prints each question's `decide` commands (`formatDecisionQuestions`), only while the boundary is eligible. Guided mode refuses to take answers on an ineligible boundary, and the dashboard question card shows the reason instead of controls.
- `src/cli-args.ts` enforces exactly one of `--approve`, `--deny` and `--answer-file`; a missing one is a usage error (exit 2).
- `src/plan-stage.ts` also binds `spec_decision.gate.pass` for its spec hash. The plan's blast radius named `buildBinding` but not the plan stage's own read.
- The recorded remediation-chain test (`test/operator-state.test.ts`) now expects that pre-`spec_decision` run to read `interrupted_or_inconsistent`, per the no-compatibility assumption.
- The dashboard decision route's body limit is `DECISION_ANSWER_MAX_CHARS * 6 + 256` bytes, sized for a fully escaped 4000-character answer.
- Guided decision prompts allow three invalid entries before refusing.
- The fold's open-decision check is wider than Task 6 states (code-review findings 2 and 3): every reviewed `## Open decisions` entry must survive unchanged unless its own finding's answer is approve or modify, and a denied disclosure missing from the reviewed spec refuses, including on the all-deny path.
- The dashboard's `findingStatus` reads a question's answer: approve or modify is addressed, deny is non-blocking, unanswered stays blocking (code-review finding 4).
- The smoke driver's approval step now expects "no passed spec_decision stage".
- Fixture modes added to `emit-spec-stage.mjs`: `FIXTURE-ASK-OPERATOR`, `FIXTURE-ASK-CANNOT`, `FIXTURE-FOLLOW-UP`, `FIXTURE-UNGROUNDED-REJECTION`, `FIXTURE-ASK-EVERY`, `FIXTURE-ASK-SECOND`, `FIXTURE-RECONCILE-DROP-OD`, and the `FIXTURE-FOLD-*` fold modes.

**Code review:** one independent in-session review, 7 findings (3 medium, 4 low). Six accepted and fixed with break-tested regressions, one accepted in part; the `awaiting_decision` attention-queue group and multi-round duplicate questions are deferred. See `2026-09-27-code-review.md`.

**Deferred and follow-ups:**
- The paid driver (`driver.mjs paid`) cannot cross a decision pause: no low-level command folds answers outside `run`, and auto-answering would take the operator's decision. A live check that reaches a question must use `bw run` or guided mode with a human answering.
- `answerQuestion` checks the structural chain, not the gated spec hash; a direct `bw decide` on an edited spec records an answer the fold later refuses. The operator surfaces no longer offer that answer.
- The full suite run in parallel (`npm test`) ends in a V8 heap-limit crash; this reproduces at the `d2954d9` baseline and predates this work.

**Verification:** `npm run typecheck` clean; full suite run serially (`node --test --test-concurrency=1 test/*.test.ts`) 1283 tests, 1275 pass, 2 fail, 6 skipped. The two failures are the Task 0 baseline (dashboard SIGTERM; "nothing under src/ touches a private key", still matching only `src/dashboard-approval.ts`). `git log -1` unchanged at `d2954d9`; `npm run check:docs` clean; `git diff --check` clean; `driver.mjs smoke` 13/13. Each new guard was break-tested and failed by assertion.
