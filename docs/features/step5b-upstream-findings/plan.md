# Step 5b Author-Led Review and Upstream Proposal Implementation Plan

**Status:** Reconciled

**Goal:** Replace the recursive closure-review loop in `spec_review` and `plan_review` with an author-led flow, and give an upstream concern a destination other than another author round. The artifact's own author self-critiques once, a bounded panel of specialist reviewers reports findings, and that same author reconciles every finding and amends the artifact. Completion stops meaning "reviewers eventually returned an empty list" and starts meaning "every finding carries a retained typed decision and every deterministic artifact gate passes". A concern whose cause is upstream of the reviewed artifact becomes a BuildWorks proposal: a non-blocking follow-up lets the run continue, a blocking dependency writes the proposal and blocks, and an indeterminate case blocks for a human. This is corrective Step 5b work inside the two shipped review stages. It adds no runtime stage: delivery check remains architecture step 8 and deliberate stop remains step 9.

**Source:** `ARCHITECTURE.md` sections 1 (agents propose, deterministic code decides), 5 (stage sequence), 9 (one schema per thing; a field nothing enforces does not belong; deterministic selection), 12 (gates, closure pass, the frozen profile and policy), 13 (conflict resolution, "nothing resolves its own finding", and the standing requirement that an upstream cause be reportable and routed to a human), 14 (work intake: `docs/proposals/` is convention, promotion is a human `git mv`), 15 (storage layout and the `finding(...)` schema), 20 (limits and configuration), and 22 (known hazards); `docs/hazards.md` entries 1, 2, 3, 4, 7, 11, 12, 13, and 14, plus the new entry this plan adds; `docs/features/step5b-upstream-findings/2026-08-31-plan-review.md`, `2026-08-31-plan-review-2.md`, `2026-09-01-plan-review-3.md`, and `2026-09-01-plan-review-3-review.md` (the four reconciled review records retained as the decision trail); `docs/features/plan-stage/plan.md` (the 2026-08-30 smoke evidence, including the round-2 finding that caught the plan inventing a rejection requirement the spec never stated, and the six-dispatch/three-round cost record); `.claude/sessions/project-learnings.md` (steps 1-7 shipped, one bounded smoke per stage is the established pattern); `docs/proposals/README.md` (the backlog convention and its explicit absence of a lifecycle); `.claude/skills/doc-check/SKILL.md`; and the shipped implementation in `src/spec-stage.ts`, `src/plan-stage.ts`, `src/plan-gate.ts`, `src/prompts.ts`, `src/finding.ts`, `src/store.ts`, `src/select.ts`, `src/policy.ts`, `src/profile.ts`, `src/raw-output.ts`, `src/lock.ts`, `src/verification-stage.ts`, `src/implementation-stage.ts`, `src/scope.ts`, `src/executor.ts`, `src/cli.ts`, `src/migrations/`, `scripts/doc-check.mjs`, and their tests.

**Hazards considered:** 1 (self-critique, panel request, reviewer report, reconciliation decision, nested proposal candidate, and rejection grounding all reach the same `extractJsonBody` and `validateAgentResult` path and must fail closed rather than default), 2 (a later run overwrites `spec.md` and `plan.md` at the same paths, so immutable reviewer reports, reconciliation decisions, proposals, before/after artifact hashes, and retained raw output must survive independently of those files), 3 (every constrained field this plan adds — panel size, unique requested specialties, classification, disposition vocabulary, proposal fields, rejection grounding, and the exact upstream `location` syntax — must be stated in the prompt that requests it and pinned by the source scan), 4 (Task 1 is a bounded prototype precisely because fixtures written in the same session as the contract would agree with it; it exercises the canonical-finding/report split, multi-round identity, and malformed shapes, while review 1's upsert and whole-file constraint guards are fixed and broken on purpose), 7 (the defect being corrected is a redispatch that varies nothing that matters, and a configured later round must be a new panel/reconciliation cycle with independently retained reports rather than an overwrite of the first), 11 (a default installation must staff two distinct specialties; required specialties consume seats, and an unstaffable requested union blocks by name), 12 (panel size and round counts have one source and are read from the frozen profile, not from live constants the profile merely describes), 13 (neither reviewer nor reconciler may mint an obligation; an upstream proposal is non-binding; exact-match rejection grounding proves only that cited text occurs in the governing input, not that it logically supports the author's rejection; and the selected author-led authority therefore retains a semantic-judgment risk deterministic code cannot remove), and 14 (self-critique is an author dispatch, never a panel seat, and never contributes to an independence claim). Entries 5, 6, 8, 9, 10, and 15 are not newly exercised: delivery completeness, promises a later stage cannot keep, shell invocation, setup probes, model identity reporting, and the read-only proposal subprocess boundary retain their shipped rules, and no task below reaches them.

---

## Operator decisions this plan implements

These were settled during reconciliation of the four review records and are binding on the tasks below.

- **The author is the reconciler.** There is no separate reconciler agent. `spec-author` reconciles the specification, `plan-author` reconciles the plan, each as its own evidence-bearing dispatch under the frozen author definition and model mapping.
- **One self-critique per artifact,** before any independent reviewer sees it, and never occupying a panel seat.
- **`rejected_with_rationale` advances at any severity when it is textually grounded.** The author may decline any finding, including `critical`, with a retained rationale and an exact source reference deterministic code can match against the governing upstream input: `design.md` for specification reconciliation and the approved specification for plan reconciliation. That match proves the excerpt occurs; it does not prove the excerpt logically supports the rejection. The current artifact cannot ground its own rejection. Missing or unmatched grounding becomes `cannot_determine` and blocks for a human, but a semantically weak matching rationale can advance under the selected author-led authority. Only `upstream_blocking` and `cannot_determine` block after validation. Severity remains immutable reviewer evidence and stops being a completion gate for the review stages.
- **`addressed` is not authority to invent a normative obligation.** Deterministic code compares the validated artifact before and after reconciliation. Every added or replaced parsed normative node must be claimed by exactly one `addressed` decision and textually grounded in the governing design for a specification or the approved specification for a plan. If the author cannot supply that grounding, it must route the concern upstream with a complete proposal candidate or return `cannot_determine`; an ungrounded `addressed` decision cannot advance. This adds no closure round or dispatch. Exact matching still proves textual occurrence rather than semantic sufficiency.
- **The author proposes the panel; deterministic code staffs it.** After self-critique the author returns a requested panel size between two and the frozen configured maximum, plus a unique list of specialties the artifact calls for. It never names agent identities. Configured required specialties consume seats in that size; their union with requested specialties must fit. Deterministic code selects distinct eligible reviewers with distinct specialties from the frozen registry, excludes the author, and blocks by name rather than shrinking or dropping a requested lens when the union cannot be staffed.
- **The configured panel maximum defaults to two,** with configurable bounds of two to five. The default installation only needs to staff two; raising the maximum is an operator action that requires adding specialists.
- **An upstream concern becomes a proposal stored as run state,** with evidence under the machine-local governance directory. Materializing it into `docs/proposals/` is an explicit human command, not a run write. Promotion to active work remains the human `git mv` section 14 already describes.
- **The governance directory is centralized behind one internal path module** and stays fixed at `.governance` in this step. External configuration of that location, and any state migration it would imply, are deferred to a later feature.
- **Reviewer fields are never combined across reports.** No merge produces a severity, route, or classification pair that no reviewer returned.
- **Canonical concerns, reviewer reports, and reconciliation decisions are separate records.** A canonical finding deduplicates identity within one round; every reviewer report remains immutable and carries its own severity, classification, subject, and producing `agent_run`; exactly one decision belongs to the canonical finding. The same concern in a later configured round gets a later-round identity and cannot overwrite earlier evidence.
- **A proposal candidate is part of an upstream reconciliation decision.** It carries the model-authored title, problem statement, and upstream explanation. Deterministic code derives `follow_up | blocking_dependency` from `upstream_follow_up | upstream_blocking`; no second model-returned impact field can disagree with the disposition.
- **The binding architecture changes before production implementation.** Task 1 may prototype outside production. If its exit confirms this design, the operator-approved amendments to architecture sections 12 and 13 land before Tasks 3 through 9. Final schema facts and current-state documentation remain in Task 10.
- **Step 5b adds no numbered runtime stage** and renumbers nothing. `STAGE_SEQUENCE` and architecture section 5 are unchanged.

## Assumptions

- **The phase order is fixed and identical for both reviewed artifacts.**

| Phase | Actor | Required retained output |
|---|---|---|
| Draft | artifact author | validated initial artifact |
| Self-critique | same author definition, separate dispatch | critique, validated revised artifact, and the panel request |
| Specialist review | complete independent panel | immutable per-reviewer findings, each report's severity and classification preserved together |
| Reconciliation | same author definition, separate dispatch | revised artifact plus one typed decision per canonical finding id, with required rationale and conditional grounding/proposal content |
| Gate | deterministic code | reconciliation completeness, artifact gates rerun, proposals written or routed, final pass or block |

- **Self-critique and reconciliation are `agent_run` rows.** "Same author" means the same frozen agent definition and the same author model mapping, dispatched separately and retained separately. It is never a hidden continuation, an unrecorded prompt, or a reused transcript.
- **The panel request rides on the self-critique result.** One dispatch returns critique, revised artifact, and panel request as one shape, because a second dispatch would spend money to carry three fields. The request is a constrained model-returned field: an integer within `[2, panelSizeMax]` and a unique list of specialty strings. Configured required specialties count inside the requested size; the unique union of required and requested specialties may not exceed it. Missing, duplicate, non-string, out-of-range, or over-capacity values abort the stage; they never clamp, truncate, or default.
- **Reviewers are not expected to return zero findings.** The existing behaviour that resolves findings absent from a later panel round has no meaning under a default of one round and is removed rather than left dormant.
- **Findings are round-scoped canonical identities with immutable reports.** Identity is `(stage_id, round, intent_key, location)`. Every panel member's report is a separate immutable child carrying that report's severity, classification, subject, and `agent_run`; the author supplies one decision keyed to the canonical finding id. No classification, severity, or subject ratchets across rounds or panel members.
- **Severity stops gating the review stages.** `MATERIAL_THRESHOLD` is read today only by `specReviewGate` (`src/spec-stage.ts:30`) and `planReviewGate` (`src/plan-gate.ts:19`). When reconciliation completeness replaces both, nothing consults it, and section 9 says a value nothing enforces does not belong. Task 3 removes it from `policy.ts` and `buildPolicy()`, or names the surviving consumer that keeps it. Either way the frozen policy shape and its hash change, and that consequence is recorded rather than absorbed.
- **The disposition vocabulary is `addressed`, `rejected_with_rationale`, `upstream_follow_up`, `upstream_blocking`, and `cannot_determine`.** `addressed` advances only after its normative-delta grounding is complete and the reconciled artifact passes its mechanical gates; hashes and gate results prove what changed and that the artifact is structurally valid, not that the reported concern was semantically cured. `rejected_with_rationale` advances only with a governing source document, location, and exact excerpt that deterministic code matches after normalizing the BOM, CRLF, and runs of whitespace on both sides — the document validator's `normalizeText` alone is not enough, because every governing document here is hard-wrapped and the Task 1 prototype recorded a correct citation failing purely because it spanned a line break; the current artifact is not an accepted grounding source, and a missing or failed match is treated as `cannot_determine`. Exact matching proves textual occurrence, not semantic sufficiency. `upstream_follow_up` requires a proposal candidate, writes a non-binding proposal, and advances. `upstream_blocking` requires the same candidate, writes it, and blocks because filing the missing decision does not make the approved specification implementable. `cannot_determine` forbids a claimed proposal and blocks for a human. No closure panel independently confirms an addressed change or a textually grounded rejection; that residual semantic risk is the explicit cost of the selected author-led flow.
- **Normative reconciliation deltas are derived, not model-declared.** For a specification, the parsed normative nodes are `declaredArtifacts` and `acceptanceCriteria`; for a plan, they are `tasks` and `coverage`. Deterministic code set-diffs the validated before/after nodes after the same normalization their document parsers use. Every added node — including the added half of a replacement — must appear exactly once in an `addressed` decision's `normativeChanges`, carrying the exact artifact node and `grounding: { source, location, excerpt }`. The current artifact is never an authority source. Deletion-only and prose-only changes do not create a normative node, but their declared changed locations and before/after hashes remain retained. An extra, omitted, duplicated, wrongly sourced, or unmatched normative change is handled as `cannot_determine`; code does not invent a proposal the author failed to supply.
- **The reconciliation result owns conditional grounding and proposal content.** Every decision carries finding id, disposition, rationale, and changed locations. `rejected_with_rationale` additionally carries grounding. An `addressed` decision additionally carries `normativeChanges` exactly when the derived artifact diff adds or replaces parsed normative nodes, with one source grounding per node. The two upstream dispositions additionally carry a proposal candidate with title, problem statement, and why the concern is upstream. Those conditional fields are required exactly where used and forbidden elsewhere; impact is derived from disposition.
- **Task 1 settles column placement, not entity responsibility.** The plan commits to canonical finding, immutable reviewer-report, and one-decision-per-finding records. Task 1 decides the minimal columns and migration mapping after exercising real output; a `repair_target` column survives only if evidence identifies an enforced or audited consumer. It may not collapse the three responsibilities back into one upserted row.
- **Every actor receives the source needed to obey the no-invention rule.** Specification self-critique, review, and reconciliation receive `design.md` plus the specification; plan self-critique, review, and reconciliation receive the approved specification plus the plan. An upstream location is never an invented heading: use `upstream:design:<decision-key>` in specification review and `upstream:specification:<decision-key>` in plan review, where `<decision-key>` is lowercase kebab-case within 64 characters and identifies the missing decision or obligation.
- **No "smarter model" claim is encoded.** The system cannot prove one model is more capable than another. It can guarantee that self-critique and reconciliation run under the author's frozen mapping with a dedicated prompt, the complete artifact, every per-report finding, and sufficient result budget, and that the effective model of each dispatch is recorded as already required. No new model-tier configuration is introduced in this step.
- **The original approval stays as it is.** A blocked run keeps a valid signed approval bound to a spec hash a fresh run will not reproduce. That is historical evidence, not a defect. No approval mutation, in-place reapproval, or rewind is introduced.
- **Hazard 16 is a class hazard with one recorded observation, not a separately filed incident.** Architecture section 13 has mandated upstream routing since before this work; the plan-stage smoke recorded a reviewer catching the plan inventing a rejection requirement the spec never stated (`docs/features/plan-stage/plan.md`, 2026-08-30). No run record in this repository describes a full wrong-artifact remediation loop, and the entry says so plainly rather than implying an incident that was never written down.

**Approach:** Prototype the claims this design rests on before committing production schema or stage order to them, then make the authority change binding before code relies on it. Task 1 measures, at the real dispatch boundary and in scratch storage, whether one self-critique meaningfully reduces findings, whether an author can reconcile grounded specialty findings without inventing obligations, and whether the canonical-finding/report/decision and nested-proposal contracts survive mixed and multi-round evidence. Its exit either revises this plan or, on operator confirmation, amends architecture sections 12 and 13 before production work starts. Tasks 2 and 3 make the governance path and the review configuration real — one path module, one frozen policy the stages actually read. Tasks 4 through 6 define the self-critique, panel-request, reviewer-report, reconciliation, grounding, and proposal-candidate contracts and their prompts before any schema depends on them. Tasks 7 and 8 store findings, reports, decisions, and proposals in the shape the prototype settled. Task 9 rewires both orchestrators to the fixed phase order. Task 10 adds the final schema, hazards, README, and checker facts after behaviour exists, without deferring the governing authority change until then. Tasks 11 through 13 break every new guard, take one bounded real sample, and hand a clean gate to an independent reviewer.

**Affected areas:** `src/paths.ts` (new); `src/policy.ts`, `src/profile.ts`, `src/select.ts`, `src/prompts.ts`, `src/finding.ts`, `src/store.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/plan-gate.ts`, `src/lock.ts`, `src/raw-output.ts`, `src/verification-stage.ts`, `src/implementation-stage.ts`, `src/scope.ts`, `src/executor.ts`, `src/cli.ts`; a proposal module and its migration under `src/` and `src/migrations/`; the agent definitions under `src/agents/`; `test/policy.test.ts`, `test/profile.test.ts`, `test/select.test.ts`, `test/prompts.test.ts`, `test/store.test.ts`, `test/schema.test.ts`, `test/migrate.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, `test/plan-gate.test.ts`, `test/audit.test.ts`, `test/cli.test.ts`, and the harness fixtures under `test/fixtures/harness/`; `scripts/doc-check.mjs`; `ARCHITECTURE.md`, `docs/hazards.md`, `docs/proposals/README.md`, `README.md`, and `.claude/sessions/project-learnings.md`.

**Known blockers and constraints:**

- The prototype may not support the design. Task 1 exists to be capable of returning "self-critique changed little", "the reconciler invented an obligation", "report pairs could not be preserved", or "proposal output was incomplete". Its exit decision is recorded in this document either way, and a disconfirming result revises the later tasks rather than being retried until it agrees.
- One bounded real sample is evidence of a contract, not a rate. No percentage claim about how many gaps self-critique removes may be written into this plan, a prompt, or a test.
- Removing the severity gate from both review stages changes the frozen policy shape and therefore the profile hash. Profiles created before the change must follow an explicit stated rule — refuse by name, or be readable as historical evidence and not resumable — chosen in Task 3 rather than discovered at runtime.
- The registry holds three reviewer definitions with three distinct specialties, all under `src/agents/spec-reviewer-*.ts`, and they serve both review stages. A configured maximum above three cannot be staffed by the default installation. With the default size of two and `requirements-traceability` required, exactly one additional requested specialty fits; SQL plus UI requires at least three seats and registered reviewers for both. An unstaffable request is a named block rather than a silent shrink.
- The author's panel request is model output reaching a deterministic selector. It must be validated before it can influence selection, and the selector remains a pure function whose inputs are the frozen agent list, validated size, and unique requested and required specialties. Required specialties consume seats; no requested specialty may be dropped to make the request fit.
- Every existing `insertFinding` call site and fixture changes when the finding shape changes. TypeScript failures during Task 7 are the intended fail-closed pressure, not a reason to make a new field optional.
- `docs/proposals/` is a human convention with no runtime contract. Nothing in this plan may write there during a run; the export command is a separate operator action against stored state.

**Blast radius** (verified by reading the implementation and search results, 2026-08-31):

- `insertFinding` (`src/store.ts:389`) returns `this.getFinding(Number(result.lastInsertRowid))!`. SQLite does not update `last_insert_rowid()` on `ON CONFLICT ... DO UPDATE`, so on the conflict path it returns whichever row the previous successful insert created. The same upsert also overwrites `agent_run_id`, severity, and subject for `(stage_id, intent_key, location)`, so it cannot preserve two reviewers' paired assertions. Both stages currently discard the return value; Step 5b replaces this write path with canonical-finding plus immutable-report writes rather than making the lossy return load-bearing.
- `test/schema.test.ts:102-120` and `scripts/doc-check.mjs:243-334` assert enum and uniqueness constraints with whole-file `sql.includes(...)` over every migration concatenated. `src/migrations/003_finding.sql` keeps that text forever, so a later rebuild of `finding` can omit `UNIQUE (stage_id, intent_key, location)` or either `CHECK` and both gates stay green. The adjacent stage test at `test/schema.test.ts:98` shows the correct pattern: `migrationTables(sql).get("stage")!.includes(...)`.
- `PANEL_SIZE` is declared at `src/select.ts:5` and read live at `src/select.ts:62`, `src/spec-stage.ts:221`, and `src/plan-stage.ts:317`. `REMEDIATION_ROUNDS` is read live at `src/spec-stage.ts:238,343` and `src/plan-stage.ts:334,438`. `buildPolicy()` copies both into the frozen profile, which no stage then reads — the profile describes values the live constants decide.
- `runPlanStage` accepts `deps` with a `selectPanel` seam (`src/plan-stage.ts:62-67`). `runSpecStage` takes no `deps` parameter at all (`src/spec-stage.ts:51`), so a spec-review test cannot control its panel except through the frozen agent list.
- `src/plan-gate.ts` exports `planReviewGate`, `coverageFitsScope`, and `coverageMeetsCriteria` — it is not only the material-finding gate. `specReviewGate` is not in a gate module at all; it lives at `src/spec-stage.ts:26`.
- `MATERIAL_THRESHOLD` is imported only by `src/plan-gate.ts` and `src/spec-stage.ts`. No other gate, stage, or script reads it.
- The literal `.governance` appears in nine path constructions across seven production modules — `src/store.ts:160`, `src/lock.ts:5`, `src/profile.ts:75,159`, `src/raw-output.ts:10,14`, `src/verification-stage.ts:195`, `src/implementation-stage.ts:209` — plus the scope prefix at `src/scope.ts:94`, the executor denied path at `src/executor.ts:66`, the clean-tree filter at `src/cli.ts:201`, and the storage-layout assertions at `scripts/doc-check.mjs:162,337-346`.
- `writePlanDoc` (`src/plan-doc.ts:175-177`) and `writeSpecDoc` (`src/spec-doc.ts:96-98`) write unconditionally to `docs/features/<slug>/`, and `bw new-run` has no same-slug guard. A later run on the same slug overwrites the artifacts a blocked run's `stage.output_ref` names, so a path reference is not evidence and a hash is.
- The reviewer pool is three definitions: `src/agents/spec-reviewer-consistency.ts`, `spec-reviewer-security.ts`, and `spec-reviewer-traceability.ts`. `REQUIRED_SPECIALTIES` is `["requirements-traceability"]`.
- `buildSpecReviewPrompt` receives only `specContent`; `runSpecStage` reads `design.md` but does not pass it to the reviewer. `buildPlanReviewPrompt` already receives both plan and approved specification, so only the specification review path lacks its upstream source today.
- No search result requires an approval, implementation, verification, delivery-check, CLI stage-sequence, or `STAGE_SEQUENCE` change.

**Verification:** Regression-first per task. The completion gate is `npm run typecheck`, focused tests during implementation, `npm test`, and `npm run check:docs`; then every new guard is broken and restored in a scratch mirror. One bounded prototype sample precedes production commitment and one bounded production smoke follows it. No requirement ID is introduced, no upstream document is edited automatically, no proposal is written into the repository by a run, and no current step is renumbered.

---

### Task 1: Bounded prototype and architecture decision gate

**Depends on:** None

**Files:**

- Add: a scratch prototype harness outside production stage order, under a temporary directory or an uncommitted scratch path
- Modify at the end of the task: this plan, with the recorded decision
- Modify only after a confirming prototype and explicit operator acceptance: `ARCHITECTURE.md` sections 12 and 13

**Steps:**

- [x] Build the prototype against the real dispatch boundary with scratch or fixture storage. It may not modify `STAGE_SEQUENCE`, the canonical schema, or either shipped stage's order. It exists to measure the flow, not to become it.
- [x] Run the eight comparisons this design depends on: draft versus self-critiqued artifact findings; two specialty findings that agree; conflicting reports whose severity and upstream classification differ; the same canonical concern reported by two reviewers and again in a later round; one non-blocking upstream concern; one blocking upstream dependency; a specification-upstream concern grounded against the supplied design; and malformed or incomplete reconciliation output.
- [x] For each, record dispatch count, cost, duration, parsing success or failure, finding counts before and after self-critique, canonical finding count, immutable report count and pairs, round identity, reconciliation completeness against the canonical finding id set, proposal-candidate completeness, rejection-grounding match, and whether the reconciler invented an obligation the approved input never stated.
- [x] Confirm at the parser what the panel request, reviewer report, reconciliation decision, conditional proposal candidate, and rejection-grounding shapes actually look like coming back from a real model, including deliberately malformed, duplicate-specialty, over-capacity, missing-proposal, and unmatched-grounding responses before those shapes are fixed in production code.
- [x] Record the exit decision in this plan: confirm the disposition vocabulary, panel-request shape, canonical-finding/report/decision responsibilities, reconciliation result, conditional proposal candidate, upstream location tokens, and minimal columns — or revise Tasks 4 through 9 here before production work starts. A `repair_target`-style column survives only with an enforced or audited consumer.
- [x] If the prototype confirms the selected design, present its measured result and the exact sections 12 and 13 amendment for operator acceptance, then amend the architecture before Task 3 begins. State that the author supplies the semantic disposition while deterministic code validates completeness, derived normative deltas, textual source occurrence, conditional proposal content, mechanical artifact gates, and route before changing stage state. State equally plainly that exact-match grounding does not prove logical support and that hashes plus artifact gates do not independently prove an `addressed` concern was semantically cured. Record operator acceptance of that authority boundary and residual semantic limit; do not describe the ungrounded-`addressed` behaviour observed in the prototype as accepted. Replace closure review with the five phases, author-proposed panel inside frozen bounds, one-round default, and named staffing refusal. If the prototype disconfirms the design or the operator does not accept the amendment, stop and reconcile this plan again; do not start production tasks under conflicting architecture.

**Verify:** the prototype's retained output; this plan's dated decision paragraph; `npm run check:docs` after the architecture decision; `npm run typecheck` if any committed source changed; a diff showing architecture sections 5 and 23 unchanged.

**Expected:** One bounded real sample per comparison, with actual cost and no retry to green. A disconfirming result revises the plan. A confirming result makes the operator-approved authority change binding before production code relies on it.

**Task completion evidence:** The per-comparison record, parser results including each malformed case, the dated decision paragraph appended to this plan, the operator decision, and the sections 12 and 13 diff with doc-check exit 0.

#### Exit decision, 2026-09-01

The prototype ran: twelve real dispatches on `claude-sonnet-5`, **$0.59543**,
430 s, zero parse failures, plus 58 constructed refusal checks and 19
break-and-restore proofs. The per-comparison record, the dispatch table, and
the full reasoning are in
`docs/features/step5b-upstream-findings/2026-09-01-task1-prototype-evidence.md`;
the harness and every retained prompt and raw response are preserved outside
this repository at `../step5b-task1-prototype`.

**Confirmed by real output, and now fixed for Tasks 4 through 9:** the
five-value disposition vocabulary; the panel-request shape (integer size plus
a unique specialty list, never an agent identity); the canonical-finding /
immutable-reviewer-report / one-decision-per-finding split, with no fusion
observed; the conditional proposal candidate with impact derived from the
disposition and no model-returned impact field; and the exact
`upstream:design:<decision-key>` token, which six upstream findings produced
correctly on first attempt with no invented design heading. Both upstream
routes occurred naturally with complete candidates: `upstream_follow_up`
advanced, `upstream_blocking` blocked naming its canonical finding ids. **No
`repair_target`-style column survives** — nothing in the run identified an
enforced or audited consumer.

**Revisions this prototype makes binding on the later tasks:**

- **Task 4** must supply the frozen registry's specialty list to the
  self-critique prompt. Not told what could be seated, the author requested
  `data-privacy`; the request was structurally valid, unstaffable, and blocked
  by name. Told the registry, the same author requested `security`, which
  staffed. Task 5's named refusal stays as the backstop; without this it is
  the ordinary outcome.
- **Task 6's** rejection-grounding match must collapse runs of whitespace, not
  only strip a BOM and normalize CRLF. A correct citation spanning a line
  break in the hard-wrapped design failed the literal match and a sound
  rejection became `cannot_determine`. Every governing document here is
  hard-wrapped. The assumption above that reads "after the same normalization
  the document validator uses" is corrected accordingly. The guarantee is
  unchanged: textual occurrence, never logical support.
- **Tasks 7 and 9** may not treat `(round, intentKey, location)` as detecting
  recurrence. Round 2 raised the identical concern at the identical location
  under a different model-authored `intentKey`. Round-scoping still prevents a
  later round overwriting earlier evidence, which is its actual job; Task 9's
  two-round recurrence step becomes a fixture test, because real output does
  not reproduce a stable intent key.
- **Task 9's** gate must evaluate every round's decisions, not the current
  round's. Round 1 blocked on two findings and round 2 routed advance; a
  per-round gate would let a later round erase an earlier `upstream_blocking`.
- **Tasks 6, 9, 10, and 11** must treat the invented atomicity criterion as a
  defect to mitigate, not an unqualified residual risk to accept. The author
  added a normative acceptance criterion the design never states, marked the
  finding `addressed`, and passed the artifact gate. The revised contract
  derives normative nodes from the before/after artifact and requires every
  added node to carry governing-source grounding under its `addressed`
  decision. Without it, the decision becomes `cannot_determine`; when the
  governing source is genuinely silent, the prompt requires an upstream
  disposition and complete proposal candidate. Task 11 replays the retained
  atomicity case as the regression. Task 10 records both the observation and
  the mitigation under hazard 16. Exact textual grounding still cannot prove
  semantic support, so that narrower limitation remains explicit.

#### Operator response to finding E, 2026-09-01

The operator did **not** accept an ungrounded `addressed` decision as an
unmitigated residual risk. The normative-delta grounding rule above is binding
on Tasks 6, 9, 10, and 11 before the architecture amendment can be accepted.
This response adds no review round or model dispatch and does not itself
approve architecture sections 12 and 13 or authorize Task 3.

**Not established by one sample, and not to be written into a prompt, test, or
this plan as a rate:** self-critique did not reduce findings here — the same
two reviewers with the same prompts returned 3 canonical findings on the draft
and 4 on the self-critiqued specification. The two reviewers never shared a
canonical identity across nine findings, so agreeing and conflicting report
pairs were not observed at the dispatch boundary and stay proven by fixture.
No real dispatch produced malformed output; fail-closed handling stays proven
by construction.

#### Operator acceptance and architecture amendment, 2026-09-01

The operator accepted the prototype result and the sections 12 and 13
amendment, and directed that sections 8, 9, and 20 be amended in the same
change so the binding document is not left contradicting itself. Applied to
`ARCHITECTURE.md`: 155 insertions, 48 deletions across sections 8, 9, 12, 13,
and 20. Section 5, `STAGE_SEQUENCE`, section 15's schema block, and section 23
are unchanged. `npm run check:docs` reports the same single pre-existing error
and the same 40 warnings as before the change, and every fact it derives from
source is identical.

**Accepted — the authority boundary.** The author supplies the semantic
disposition. Before any stage state changes, deterministic code validates
decision completeness, the derived normative delta, textual occurrence of every
cited excerpt, conditional proposal content, the mechanical artifact gates, and
the route.

**Accepted — the residual semantic limit.** An exact match proves the cited
words occur in the governing input; it does not prove they logically support
the rejection or the addition. Artifact hashes and document gates prove what
changed and that the result parses; they do not prove a concern was
semantically cured. No panel independently confirms either.

**Not accepted:** the ungrounded `addressed` decision the prototype recorded.
It is mitigated by normative-delta grounding, not absorbed as residual risk.

Section decisions made in the same pass:

- **Section 8** limits canonical deduplication to one round and disclaims
  semantic recurrence across rounds outright.
- **Section 9** keeps a configurable panel with a floor and default of two
  reviewers and defers the one-reviewer low-risk tier rather than deleting it.
  Two is the default panel size, not a round count. Risk no longer sizes the
  panel; it travels into the signed authorization only.
- **Section 20** states one review round by default, configurable higher, with
  no closure-pass language, and records that no verification round limit is in
  force because no loop exists — the first failing command blocks, and adding
  retries later requires its own frozen limit. A draft of that bullet claimed a
  configured verification budget that does not exist; the operator caught it and
  it was corrected before the amendment was applied.
- **Section 15's** remediation-budget sentence stays for Task 10.

These values are constants in `src/policy.ts` frozen into the run profile, not
operator-prompted: `governed.yaml` accepts only a `verify:` block and `new-run`
has no panel or round flag. Task 3's contribution is to make the stages read
them from the frozen profile instead of importing the live constants.

Task 1 is complete. Tasks 3 through 9 are unblocked; none has started, and no
production code has changed.

### Task 2: One governance path module

**Depends on:** None

**Files:**

- Add: `src/paths.ts`
- Modify: `src/store.ts`, `src/lock.ts`, `src/profile.ts`, `src/raw-output.ts`, `src/verification-stage.ts`, `src/implementation-stage.ts`, `src/scope.ts`, `src/executor.ts`, `src/cli.ts`
- Modify: the tests covering those modules; `scripts/doc-check.mjs` if its storage-layout assertion moves

**Steps:**

- [x] Add `src/paths.ts` owning the governance directory name and one function per existing location: state database, lock directory, raw output (absolute and reference forms), profile directory and file, verification evidence, worktrees, and the new proposal evidence directory. The directory name is a constant in this module and is not configurable in this step.
- [x] Replace all nine production path constructions with calls into it, and derive the scope prefix, the executor denied path, and the clean-tree filter from the same constant rather than repeating the literal.
- [x] Add a test asserting the literal appears in exactly one production module, so a later addition cannot quietly reintroduce a tenth construction site.
- [x] Leave the layout under the directory byte-for-byte as shipped. This task changes where the name is written, not where anything is stored.

**Verify:** `npm test`; `npm run typecheck`; `npm run check:docs`; `git diff` shows no change to any stored path string.

**Expected:** One module answers "where does governance state live", proposal evidence has a home to be added to, and external configuration of that location remains a deferred, separate decision.

**Task completion evidence:** The single-source test green, the full suite green, and a diff showing path values unchanged.

#### Completion record, 2026-09-01

`src/paths.ts` owns `GOVERNANCE_DIR`, the `GOVERNANCE_PREFIX` form the
comparison sites use, and one function per location: `lockDir`,
`stateDbPath`, `rawOutputDir`, `rawOutputRef`, `profileDir`, `profilePath`,
`verificationEvidenceDir`, `worktreePath`, and `proposalEvidenceDir`. The
last has no caller — Task 8 decides what goes inside it; it is here so that
adding a governance location stays an edit to one file.

All twelve sites now import it: the nine constructions (`src/store.ts`,
`src/lock.ts`, `src/profile.ts` twice, `src/raw-output.ts` twice,
`src/verification-stage.ts`, `src/implementation-stage.ts`), plus the scope
prefix (`src/scope.ts`), the executor denied glob (`src/executor.ts`), and
the clean-tree filter (`src/cli.ts`). The filter stopped being a regexp with
the name baked into it and became a capture of the porcelain path compared
against the prefix, which needed no escaping and tests the same lines.
`src/profile.ts` lost its private `profilePath` and its now-unused `join`
import.

`test/paths.test.ts` scans every `src/**/*.ts` for the literal outside
comments. The scan is line-oriented on purpose: a real lexer is what a
comment opener inside a string calls for, and this repository has one — the
executor sandbox glob ending in `/**` — so a block-comment opener counts only
when it starts a line, which keeps that string visible. Its bias is toward
reporting a mention it cannot classify rather than hiding a construction
behind a comment marker. The three prose mentions of `.governance/` that
remain (`src/approval.ts`, `src/cli.ts`, `src/profile.ts`) are documentation
and are left alone.

The test files still spell the directory themselves and were not rewritten to
import the module. A test that asked `stateDbPath` where the database is
would pass through a rename; the expected value has to come from outside the
code under test.

**Verified:** `npm run typecheck` clean; `npm test` 449 tests, 448 pass, 1
skip, 0 fail; `npm run check:docs` exit 0, `doc-check: clean`, warnings 41 →
36 because the two files this task adds now exist. Every new guard proven by
breaking them and restoring: a tenth construction site added to
`src/audit.ts` failed the scan naming the offending line; the same string
added to `src/executor.ts` *after* the `/**` glob also failed, which is the
case a naive scanner would have gone blind to; and renaming `profiles/` to
`profile/` in `paths.ts` failed the value pin. `scripts/doc-check.mjs` needed
no change — its `.governance/` assertions are about the storage-layout fence
in `ARCHITECTURE.md`, and the layout did not move.

### Task 3: Real review configuration in the frozen policy

**Depends on:** Task 1

**Files:**

- Modify: `src/policy.ts`, `src/profile.ts`, `src/select.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/plan-gate.ts`
- Modify: `test/policy.test.ts`, `test/profile.test.ts`, `test/select.test.ts`, `test/plan-gate.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`
- Modify: `scripts/doc-check.mjs` where it pins policy facts

**Steps:**

- [x] Add `specReviewRounds` and `planReviewRounds`, both defaulting to one, and `panelSizeMax`, defaulting to two with validated bounds of two through five. Replace the per-risk `PANEL_SIZE` map, which the author-proposed panel supersedes; keep `computeRisk` and the risk value itself, which the approval payload binds.
- [x] Define a configured round as one complete `panel → reconcile` cycle. Self-critique happens once per artifact regardless of the configured round count, before the first panel.
- [x] Make both stages read every active review value from the frozen profile policy. Panel size, required specialties, and materiality are active in the legacy stages. Freeze the new round counts now, but do not apply them to the legacy closure loop: Task 9 activates them when a round can actually contain the promised `panel → reconcile` cycle. Add tests that fail if a stage imports a review-policy constant directly or activates the configured count before reconciliation exists.
- [x] Settle materiality: remove `MATERIAL_THRESHOLD` and `materialityThreshold` once reconciliation completeness replaces both severity gates, or name in a comment the consumer that keeps it. Record the resulting policy-shape and profile-hash change.
- [x] State and implement the rule for profiles created before this change — refuse by name, or readable as history and not resumable — and test it. Do not let an old profile silently produce a policy the code no longer honours.
- [x] Add a configuration-time staffing refusal: when the frozen registry cannot seat `panelSizeMax` eligible reviewers on the frozen executor, with unique agent ids and distinct specialties including the configured required specialties, profile creation refuses and names the defect. Required specialties count inside every requested panel size and may not outnumber its seats.

**Verify:** `node --test test/policy.test.ts test/profile.test.ts test/select.test.ts test/plan-gate.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`; `npm run typecheck`; `npm run check:docs`.

**Expected:** Round counts and panel bounds have one source and are frozen per run. Active legacy-stage values are read from that profile; configured round counts remain inactive until Task 9 implements their stated semantics. A default installation staffs two distinct eligible specialties. A configuration the registry cannot satisfy fails before any money is spent.

**Task completion evidence:** The red tests against the live constants, the green focused gate, the recorded policy-hash change, and the old-profile rule proven by test.

#### Completion record, 2026-09-01

**The old-profile rule is Route A, decided by the operator.** A frozen profile
that is missing, or violates, the fields this code enforces is an invalid
profile, refused by name in `loadVerifiedProfile`. Nothing migrates it, fills a
default, or continues past it. That single door is the whole argument: every
execution and resume path loads the frozen profile through it, so the refusal
cannot be enforced at one stage and forgotten at another — the same reason the
tamper-hash comparison already lives there. Nothing that only reads the
database, the retained evidence, or the audit chain passes through it, so a
refused run stays fully inspectable and `verify-audit` still verifies it.

This is not a version check and not compatibility handling, both of which hard
rule 3 forbids; it is that rule stated out loud. The question it asks has no
notion of "old": does the policy this run froze carry the values the stages
read, within the bounds they assume? The reason it must exist is mechanical —
a profile frozen before a field existed parses with `undefined` there, and
every JavaScript comparison against `undefined` is false, so a missing bound
could bypass a downstream refusal or skip a loop. The central validity check
prevents malformed policy from reaching any consumer. Both review stages also
terminally block if their legacy loop ever falls through without a gate result;
they cannot return a nonterminal failure and leave the run wedged.

**Policy shape and hash.** `panelSizes` and `remediationRounds` are gone;
`specReviewRounds`, `planReviewRounds`, `panelSizeMin`, and `panelSizeMax`
replace them.

| | policy hash |
|---|---|
| pre-Task-3 shape | `5df5a26bd3c2f88a8a7daf3672497060534c81593c74d88a3e2e3e73fc486ef5` |
| this change | `657d705359c992399f70a467c14273cfe8be52916a20d179d26e784c09023001` |

Every profile frozen before this change therefore carries the first hash and is
refused. The profile hash on the run row changes with it, since the policy is
part of the serialized profile.

**Two decisions this task settled that the plan left open.**

`MATERIAL_THRESHOLD` and `materialityThreshold` stay. The plan permits removing
them "once reconciliation completeness replaces both severity gates"; that
replacement is Task 9. Until then `specReviewGate` (`src/spec-stage.ts`) and
`planReviewGate` (`src/plan-gate.ts`) receive the threshold frozen in the run's
profile. Neither imports the live default. Removing it now would leave both
review stages ungated for the length of the build.

`panelSizeMin` is a frozen policy value beside `panelSizeMax`. The floor of two
is also the default, and until the author proposes a size (Task 5) the stages
have to staff something. They staff the larger of the floor and the number of
configured required specialties — the smallest valid panel. Staffing the
maximum would have silently seated five reviewers the moment an operator
raised the ceiling.

**Round activation boundary.** Both new policy values default to one complete
`panel → reconcile` cycle, but Task 3 cannot honestly enforce that definition:
the typed reconciliation dispatch and decisions do not exist until Tasks 6 and
9. Applying one to the old loop produced one panel and zero author revisions.
The two stages therefore retain their explicitly named three-pass legacy
closure budget until Task 9 atomically removes it and activates the frozen
counts. Risk is still computed, recorded in the gate summary, and bound into
the approval; it no longer sizes the panel.

**The `approvalSigner` tolerance is gone.** `approval-stage.ts` compared with
`!= null` so that a profile frozen before the field existed read as "no key
bound at intake". It now compares with `!== null`. Null stays a live, supported
state; absent is an obsolete shape and is refused upstream. The line change is
not itself observable — which is the point — so what is tested is that the case
it absorbed can no longer reach the comparison.

**Verified after independent correction:** `npm run typecheck` clean; the 128
focused policy, profile, selection, gate, specification-stage, and plan-stage
tests pass; `npm run check:docs` exits 0 with `doc-check: clean`. The original
Task 3 run recorded `npm test` as 484 tests, 483 pass, 1 skip, 0 fail. A new
full-suite run was attempted twice but did not complete in this environment:
it stopped producing output in the unchanged dispatch timeout test after that
file's first two tests passed. No new full-suite count is claimed.

**Guard record after independent correction.** The unchanged Route A guards
still cover the central validity check, exact policy shape, panel bounds,
`approvalSigner` presence, staffing before profile write, and the narrow
registry seam. The corrected boundaries were also broken and restored. Making
the specification stage activate `specReviewRounds` before Task 9, while
replacing its frozen specialty list with the live default, failed both named
stage regressions. Disabling the required-specialty capacity check, executor
eligibility, and duplicate-id refusal failed all three named staffing
regressions. Allowing selection to reuse a specialty failed the distinct-lens
regression. Each set passed again after restoration. The legacy-loop
fallthrough is unreachable with its positive constant, but it now calls the
same terminal `abort` machinery as every reachable failure instead of returning
a nonterminal result.

### Task 4: Self-critique contract and prompt

**Depends on:** Tasks 1 and 3

**Files:**

- Modify: `src/prompts.ts`, `src/agents/spec-author.ts`, `src/agents/plan-author.ts`
- Modify: `src/spec-stage.ts`, `src/plan-stage.ts`
- Modify: `test/prompts.test.ts`, `test/agents.test.ts`, and both author fixtures under `test/fixtures/harness/`

**Steps:**

- [x] Define one self-critique result shape carrying the critique, revised artifact, and panel request. Validate it fail closed: a missing critique, missing or invalid artifact, duplicate or over-capacity specialties, or absent panel request aborts with a named error and never falls back to the draft.
- [x] Add explicit `spec-self-critique` and `plan-self-critique` output capabilities to the two author definitions and assert that reviewers cannot produce either result kind.
- [x] Write the self-critique prompt for both authors. It states that this is the author's own pass before independent review, that the revised artifact must still satisfy the same document validation as the draft, and that the author may not add obligations the governing input does not contain. Supply design plus specification for the spec path, and approved specification plus plan for the plan path.
- [x] Dispatch self-critique as a separate `agent_run` under the author's frozen definition and model mapping, exactly once per artifact, before any reviewer dispatch. Retain its raw output like any other invocation.
- [x] Rerun the mechanical artifact gates on the revised artifact. A self-critique that produces an invalid document blocks; it does not silently fall back.
- [x] Extend the hazard-3 source scan and the generated-prompt assertions so the self-critique prompt's constraints are pinned where they are requested.

**Verify:** `node --test test/prompts.test.ts test/agents.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`; `npm run typecheck`.

**Expected:** Exactly one self-critique per artifact, recorded as its own dispatch, gated like any other artifact, and never counted as review.

**Task completion evidence:** The dispatch-count assertion, author-output capability tests, governing-input assertion, invalid-critique block, and prompt-scan test failing when the constraint sentence is removed.


#### Outcome, 2026-09-02

Implemented on `master`, uncommitted at the operator's instruction. New:
`src/self-critique.ts` (the shape and its validator) and
`test/self-critique.test.ts`. The plan's file list named no new module; one
result shape shared by both stages needs somewhere to live, and putting it in
`agent-result.ts` would have mixed the envelope contract with a payload
schema.

**Revision A applied, though this task's step list never carried it.** The
accepted Task 1 exit decision binds Task 4 to supply the frozen registry's
specialty list to the self-critique prompt; the steps above were not rewritten
when the operator accepted that result. Both prompts name the lenses the frozen
profile's eligible reviewers can seat on the frozen executor, and both stage
suites prove the stage supplies them rather than only that the builder renders
them.

**The panel request is validated and retained, and deliberately does not reach
selection.** Structure only: the fields are present, typed, unique, and ask for
no more lenses than seats. The `[2, panelSizeMax]` bound, the union with the
configured required specialties, and the staffing refusal are Task 5's steps,
stated there. This is the boundary Task 3 crossed by wiring a frozen value into
the nearest similarly named loop, and the same reasoning applies: a value that
is validated is not thereby active.

**Both authors gained one output each**, `spec-self-critique` and
`plan-self-critique`; neither may produce the other's, and no reviewer may
produce either (hazard 14). The capability is read from the frozen profile and
refused before any dispatch, so a misconfigured author costs nothing.

**Verified:** `npm run typecheck` clean; `npm test` 524 tests, 523 pass, 1
skip, 0 fail (494/493/1 at `5d63726`); `npm run check:docs` exit 0, 36
warnings, unchanged. Eleven break-and-restore mutations against the new guards:
nine detected first time, two only after the attack itself was corrected — one
had mutated a line downstream of the guard it meant to remove, and one had run
only the whole-file source scan, which cannot localize a sentence both prompts
carry. Independent review in `2026-09-02-code-review.md`: three findings, all
applied, each proven by the mutation that exposed it.

**Not done here, by scope:** nothing reads the retained panel request, no round
count was activated, and `LEGACY_CLOSURE_PASSES` is untouched.

### Task 5: Author-proposed panel, deterministic staffing

**Depends on:** Task 4

**Files:**

- Modify: `src/select.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`
- Modify: `test/select.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`

**Steps:**

- [x] Validate the panel request before it reaches selection: an integer size within `[2, panelSizeMax]` and a unique list of specialty strings. Normalize no model value. Duplicate, non-string, missing, or out-of-range values abort by name. Compute the unique union with configured required specialties and refuse when that union exceeds the requested size; nothing clamps, truncates, or defaults.
- [x] Extend `selectReviewers` to take the validated size and requested specialties alongside the required ones, keeping it pure over the frozen agent list. Required specialties fill first, requested specialties next, then ranked relevance fills remaining seats with specialties not already represented. The author is excluded because candidates are reviewers only.
- [x] Block by name when the request cannot be staffed with distinct eligible reviewers and distinct specialties, naming the requested size, required and requested specialty union, and what the frozen registry could seat. Do not shrink the panel, drop a requested lens, or select two agents with the same specialty.
- [x] State and test the default-seat consequence: with size two and `requirements-traceability` required, the author may request at most one additional specialty. A request for both SQL and UI is over-capacity at size two; at size three it succeeds only when both specialist definitions are in the frozen registry.
- [x] Add a `deps.selectPanel` seam to `runSpecStage` mirroring the one `runPlanStage` already has (`src/plan-stage.ts:62-67`), so a spec-review test can control its panel without depending on registry contents.
- [x] Test that the author never influences identity: equivalent requests with the same size and specialty set against the same frozen registry select the same reviewers regardless of specialty-list order.

**Verify:** `node --test test/select.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`; `npm run typecheck`.

**Expected:** The author proposes a size and distinct lenses; required lenses consume seats and deterministic code decides who reviews. An over-capacity or unstaffable request is a named block, and selection stays reproducible from the frozen profile.

**Task completion evidence:** The validation and seat-accounting truth table, distinct-specialty selection, SQL-plus-UI default refusal and configured success, unstaffable block message, and order-independent determinism test.

#### Completion record, 2026-09-02

Shipped on `master`. `validatePanelRequest` and an extended `selectReviewers`
and `staffingShortfall` in `src/select.ts`; both review stages now validate the
author's request against the frozen policy, refuse an unstaffable panel by
name, and select against the requested lenses; `runSpecStage` gained the
`deps.selectPanel` seam `runPlanStage` already had. No dispatch was paid for:
every test runs against the fixture executors.

**Deviation: `src/prompts.ts` and `test/prompts.test.ts` were in scope, and
this task's file list does not name them.** Task 5 makes `[panelSizeMin,
panelSizeMax]` binding, and in the default installation that range is exactly
`[2, 2]` while the configured required lens consumes one of the two seats. The
self-critique prompt stated neither bound, so shipping the code alone would
have made the named refusal the ordinary outcome of a well-behaved run — the
same defect Task 1's revision A fixed for specialties, and the case this plan's
`Hazards considered` line names first under entry 3. The operator was asked
before any code was written and approved the wider scope. Both self-critique
builders now take one `PanelPromptBounds` object in place of the bare
`registeredSpecialties` list and state the size range and the always-seated
lenses; the always-seated block is omitted entirely when no lens is configured,
because announcing a constraint that does not exist is the same defect as
omitting one that does.

**`staffingShortfall` was extended rather than duplicated.** It answers one
question — can this registry seat this panel with these mandatory lenses — at
two moments: profile freeze, where no request exists and the requested list is
empty, and review staffing, where the author's validated request supplies the
rest. A second near-identical function would have been a place for one rule to
go missing.

**Requested lenses are seated in ranked order, not in the order the author
listed them.** The plan asks only that equivalent requests select the same
reviewers; seating from the ranked list makes the returned array itself
order-independent, so the test compares an ordered list rather than a set. The
author's list is read as a set, which is the only thing it is allowed to be.

**Two of fourteen break-it mutations held, and both exposed a real coverage gap
rather than a defective attack.** Replacing `requested.value.size` with the
interim `max(panelSizeMin, requiredSpecialties.length)` changed nothing
observable in either stage test, because both configurations made the two rules
agree numerically: one required lens with a request of two gives two either
way, and three required lenses with a request of three gives three either way.
The discriminating configuration is one required lens under a ceiling of three
with the author asking for three — the old rule seats two. Both stage tests were
rewritten to that configuration and both mutations are now detected. The
original tests asserted the right number for the wrong reason and would have
shipped as proof.

**Independent review in `2026-09-02-task5-code-review.md`: four findings, all
applied.** Two were medium and both concerned the prompt this task brought into
scope, which is where the risk of that expansion actually landed. The prompt
advertised `sizeMin` as the floor, but required lenses consume seats inside the
requested size, so the smallest legal request is
`max(sizeMin, requiredSpecialties.length)` — and `invalidPolicyReason` permits a
policy configuring more required lenses than the floor. In that reachable
configuration the prompt named a size the validator is guaranteed to refuse, and
the hardcoded `"size": 2` in the advertised example was the same defect in the
value a model is most likely to copy. Hazard 3's second sentence names this case
outright. Both were reproduced by execution before being accepted. The fix
derives the advertised floor and the example from the same frozen values the
validator enforces, and a new test asserts every advertised size validates
across three required-lens configurations.

**Verified:** `npm run typecheck` clean; `npm test` 552 tests, 551 pass, 1
recorded skip, 0 fail (524/523/1 at Task 4); `npm run check:docs` exit 0 with
36 warnings, unchanged. Seventeen break-and-restore mutations across
`src/select.ts`, `src/prompts.ts`, `src/spec-stage.ts`, and `src/plan-stage.ts`,
each restored and confirmed byte-identical by hash.

**Not done here, by scope:** no round count was activated and both
`LEGACY_CLOSURE_PASSES` constants are untouched; no reconciliation dispatch, no
storage change, and no proposal work. The panel request now reaches selection,
which is the whole of what Task 5 promised.

### Task 6: Reconciliation contract and prompt

**Depends on:** Tasks 1 and 5

**Files:**

- Modify: `src/prompts.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`
- Modify: `src/agents/spec-author.ts`, `src/agents/plan-author.ts`
- Modify: `test/prompts.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, and both review fixtures

**Steps:**

- [ ] Define the reviewer-report result before reconciliation depends on it. Each report carries canonical `location` and `intentKey`, plus that reviewer's `severity`, `classification: current_artifact | upstream`, and `subject`. Reject duplicate canonical identities within one reviewer's result. Preserve the complete report with its producing `agent_run`; do not upsert one reviewer's fields over another's.
- [ ] Change both reviewer prompts from “through your specialty lens” to “report only findings within specialty `<specialty>`”. State that an empty in-specialty result is valid and that out-of-specialty concerns must not be reported. Pin the exact boundary in source and generated-prompt tests; the reconciler's ability to reject an out-of-specialty report remains a backstop, not the primary control.
- [ ] Supply the governing upstream input everywhere it is needed: `buildSpecReviewPrompt` receives design plus specification, and specification reconciliation receives both; plan review and reconciliation continue to receive approved specification plus plan. This is the evidence used by the no-invention prompt and both addressed-change and rejection-grounding validators.
- [ ] Define `location` beside `classification` in both reviewer prompts. `current_artifact` uses a real heading, task, or artifact path from the artifact under review. `upstream` uses exactly `upstream:design:<decision-key>` for specification review or `upstream:specification:<decision-key>` for plan review; `<decision-key>` is lowercase kebab-case within 64 characters and names the absent decision or obligation. Never require or invent a heading for an omission.
- [ ] Add explicit `spec-reconciliation` and `plan-reconciliation` output capabilities to the two author definitions and assert that reviewers cannot produce either result kind.
- [ ] Define the reconciliation result: the revised artifact plus exactly one decision per canonical finding id, using the five-value vocabulary. Every decision requires a rationale and changed locations. `rejected_with_rationale` also requires `grounding: { source, location, excerpt }`. An `addressed` decision also requires `normativeChanges: [{ artifactLocation, artifactText, grounding }]` exactly when the deterministic before/after parse adds or replaces a normative node. `source` is exactly `design` for specification reconciliation and `specification` for plan reconciliation, never the current artifact. Deterministic code collapses whitespace, exact-matches the source excerpt, and set-compares the returned `artifactText` values with every added parsed node. An incorrect source, missing excerpt, failed match, or extra/omitted/duplicate node is handled as `cannot_determine`, not accepted as prose. Name validators according to those textual and structural guarantees and do not claim they verify that an excerpt semantically supports a change.
- [ ] Define a conditional `proposal` candidate inside each decision. It is required exactly for `upstream_follow_up` and `upstream_blocking`, forbidden for the other dispositions, and carries title, problem statement, and why the concern is upstream. Impact is not model output: code derives `follow_up` from `upstream_follow_up` and `blocking_dependency` from `upstream_blocking`. Refuse extras, duplicates, omissions, unknown dispositions, misplaced proposal fields, and incomplete grounding with named errors.
- [ ] Write the reconciliation prompt with the governing input, complete artifact, canonical finding ids, and every immutable per-reviewer report with its severity and classification intact. State that the author may address only a change whose added normative nodes it can ground, ground a rejection, route an unsupported obligation upstream with a complete proposal candidate, or return `cannot_determine`. State explicitly that a reviewer calling a concern `current_artifact` does not authorize the author to add an obligation absent from the governing input. Require the author to explain what artifact change addresses a finding or why the cited source defeats it, while keeping that explanation as retained semantic evidence rather than mislabeling it as deterministic proof.
- [ ] Rerun the mechanical artifact gates on the reconciled artifact, and record before and after artifact hashes on the reconciliation event exactly as `plan.gate.pass` already records `planHash=` (`src/plan-stage.ts:433`), so the evidence survives a later run overwriting the file.
- [ ] Preserve report pairs. Add the mixed case — one reviewer reporting `critical` on the current artifact, another reporting `low` upstream on the same canonical concern — and prove one canonical finding plus two immutable reports reach the reconciler unfused, and that no stored value pairs a severity with a classification no reviewer returned.

**Verify:** `node --test test/prompts.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`; `npm run typecheck`.

**Expected:** Every canonical finding id has every reviewer report and exactly one retained typed decision; every added parsed normative node is claimed once by an `addressed` decision and textually grounded in the governing input; malformed, ungrounded, unaccounted, or conditionally incomplete reconciliation fails closed; every actor receives the governing input; no prompt authorizes minting an obligation; no aggregation invents or erases a report; and tests and names do not overstate textual or mechanical checks as semantic verification.

**Task completion evidence:** The extras/duplicates/omissions/unknown and conditional-field refusals; exact-set addressed-node checks; addressed and rejection grounding matches and mismatches; the design-present spec-review assertion; mixed-pair preservation; and each prompt-scan test failing when its sentence is removed.

### Task 7: Canonical finding, reviewer-report, and reconciliation storage

**Depends on:** Tasks 1 and 6

**Files:**

- Add: a migration under `src/migrations/` in the shape Task 1 settled
- Modify: `src/finding.ts`, `src/store.ts`
- Modify: `test/store.test.ts`, `test/schema.test.ts`, `test/migrate.test.ts`
- Modify: `scripts/doc-check.mjs`

**Steps:**

- [ ] Replace the lossy `insertFinding` contract with two writes. `upsertCanonicalFinding(stageId, round, intentKey, location)` returns the exact canonical row using `RETURNING id` or identity re-select. `insertFindingReport(findingId, agentRunId, severity, classification, subject)` inserts immutable evidence and refuses a duplicate `(finding_id, agent_run_id)`. Add the three-insert regression against the canonical return path because the two-insert case passes by coincidence.
- [ ] Give the three entities one responsibility each. `finding` owns `(stage_id, round, intent_key, location)` and a stable id; `finding_report` owns reviewer `agent_run_id`, severity, classification, and subject; `finding_decision` owns one reconciling `agent_run_id`, disposition, rationale, conditional grounding, and before/after artifact hashes. Task 8's proposal record links upstream candidate content to its decision and source finding ids. Enforce `UNIQUE (stage_id, round, intent_key, location)`, `UNIQUE (finding_id, agent_run_id)`, and `UNIQUE (finding_id)` respectively.
- [ ] Read canonical findings together with all reports before reconciliation. Assert one canonical row and two report rows for the mixed case, and separate canonical rows for the same identity in rounds one and two. Never use an insert return as proof that no second report was created.
- [ ] Validate severity, classification, disposition, and conditional-field vocabularies before SQL, importing each from the module that owns it so validators and constraints cannot drift. Do not rank or combine severity in SQL; immutable migration text cannot import `SEVERITY_ORDER` and a fourth copy would go stale silently.
- [ ] Scope the finding, report, and decision constraint assertions to their final table bodies in both `test/schema.test.ts` and `scripts/doc-check.mjs`, using the pattern already at `test/schema.test.ts:98`, so a rebuild cannot pass on dead migration text.
- [ ] If the migration rebuilds `finding`: rename, recreate with the new round-scoped identity and every surviving constraint, copy rows with explicit ids under the legacy-row mapping Task 1 recorded, populate their immutable report evidence without manufacturing a second reviewer, drop the old table, and set the user version. Note that explicit-id copying restores the `AUTOINCREMENT` sequence correctly only because nothing in `src/` deletes findings. Do not edit an existing migration or add a permanent default for a field new writes must supply.
- [ ] Build the migration regression against a scratch migrations directory holding the prior versions, applied, then the new file copied in and reapplied — `applyMigrations` applies every file in the directory it is given.
- [ ] Name the exact column position for any schema line added to architecture section 15: `checkMigrations` and `test/schema.test.ts:90` compare column lists with `JSON.stringify`, so order is part of the contract.

**Verify:** `node --test test/store.test.ts test/schema.test.ts test/migrate.test.ts`; `npm run typecheck`; `npm run check:docs`.

**Expected:** The store returns the canonical row it wrote, every per-reviewer report survives unchanged, every decision is retained once against its canonical finding, repeated concerns stay round-scoped, old rows survive without invented reviewers, and the three schema consumers agree about final table bodies rather than dead text.

**Task completion evidence:** The three-insert canonical-return regression red then green; mixed-case one-finding/two-report and multi-round assertions; each uniqueness/enum constraint failing when dropped from the final table; and before/after migration rows.

### Task 8: Proposal contract, persistence, and human export

**Depends on:** Tasks 2, 6, and 7

**Files:**

- Add: a proposal module under `src/` and its migration under `src/migrations/`
- Modify: `src/cli.ts`, `src/store.ts`
- Modify: `test/cli.test.ts`, `test/store.test.ts`, `test/schema.test.ts`, `test/audit.test.ts`
- Modify: `docs/proposals/README.md`

**Steps:**

- [ ] Define the proposal record from the validated reconciliation candidate: source run, stage, feature slug, and canonical finding ids; title and problem statement; why the concern is upstream of the reviewed artifact; the reconciler's rationale; and the artifact hashes in force. Derive `follow_up | blocking_dependency` from the reconciliation disposition; never accept a second model-returned impact value.
- [ ] Store it as run state with evidence written under the governance directory through `src/paths.ts`. No run writes into `docs/proposals/`, which is outside the signed scope.
- [ ] Give it a deterministic identity and a stated behaviour when the same proposal is raised again. Deduplicate the candidate without fusing impact, route, or rationale across reports: preserve every source canonical finding id and its immutable reports, and let the reconciler's one disposition determine impact.
- [ ] Validate that a proposal is non-binding. It cannot add an acceptance criterion to the current feature and cannot become an active `design.md` automatically. Promotion stays the human `git mv` section 14 describes.
- [ ] Retain the raw reconciliation output and append the audit event before any write, and define the behaviour when rendering or writing the evidence fails — the run blocks with the cause named rather than advancing as though a proposal existed.
- [ ] Route by derived impact: `upstream_follow_up` renders `follow_up`, writes, and advances; `upstream_blocking` renders `blocking_dependency`, writes, and blocks because filing the missing decision does not make the approved specification implementable; `cannot_determine` blocks for a human with no proposal claimed.
- [ ] Add a `bw proposal-export` command that materializes a stored proposal into `docs/proposals/` as an explicit operator action, refusing to overwrite an existing file. Document the two-step flow in `docs/proposals/README.md`.
- [ ] Give proposal and reconciliation audit events a machine-readable summary in the shape the gate events already use — ids, route, artifact hashes, risk, outcome — so a later query finds every upstream block without parsing prose, the way `src/plan-stage.ts:169-185` reads `spec.gate.pass` back.

**Verify:** `node --test test/cli.test.ts test/store.test.ts test/schema.test.ts test/audit.test.ts`; `npm run typecheck`; `npm run check:docs`.

**Expected:** An upstream concern has a durable, queryable destination that no run writes into the repository, and the backlog convention gains system-raised work only when a human asks for it.

**Task completion evidence:** The three routes proven separately, the dedup test showing preserved source ids and no fused impact, the export refusal on an existing file, and a validated audit chain.

### Task 9: Orchestrate both stages on the new phase order

**Depends on:** Tasks 3 through 8

**Files:**

- Modify: `src/spec-stage.ts`, `src/plan-stage.ts`, `src/plan-gate.ts`
- Modify: `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, `test/plan-gate.test.ts`, `test/audit.test.ts`
- Modify: the review harness fixtures, plus scratch fixture variants written into each test's temp root as `test/spec-stage.test.ts` already does

**Steps:**

- [ ] Replace the round loop in both stages with: draft, self-critique, then for each configured round a complete panel followed by reconciliation, then the deterministic gate. This is the atomic activation point for `profile.policy.specReviewRounds` and `planReviewRounds`: remove both `LEGACY_CLOSURE_PASSES` constants here, not earlier. Remove the closure-round redispatch and the resolution of findings absent from a later panel. Pass design plus specification through the specification phases and approved specification plus plan through the plan phases.
- [ ] Make the gate decide over every configured round on report/decision completeness, the exact set of derived normative additions, textual grounding for `addressed` additions and rejections, conditional proposal completeness, and the mechanical artifact gates, not on open severity. Advance on a fully accounted and grounded `addressed` decision and a textually grounded `rejected_with_rationale` at any severity. Treat an absent, extra, duplicated, wrongly sourced, or unmatched grounding or normative node as `cannot_determine`; also block on `upstream_blocking` and explicit `cannot_determine`, naming the canonical finding ids and any stored proposal. Do not encode or document this gate as independent semantic confirmation of either an addressed concern or the logical sufficiency of a grounding excerpt.
- [ ] Add the plan-review regression that reproduces the original defect: a material upstream concern in round one produces a proposal and either a documented advance or a named block by its impact, and no additional plan-author revision round is dispatched to repair the wrong artifact.
- [ ] Add the spec-review analogue so both stages prove the same semantics, using the new `deps.selectPanel` seam rather than depending on registry contents.
- [ ] Assert dispatch counts explicitly in both stages: exactly one draft, exactly one self-critique, exactly the requested panel size, exactly one reconciliation per round.
- [ ] Prove both round configurations: the default of one, and a configured value greater than one running `panel → reconcile` twice with one self-critique in total. Have the same intent/location recur in both rounds and prove two canonical round identities and all per-reviewer reports survive rather than overwriting each other.
- [ ] Prove the coverage and document gates still run on the reconciled artifact, and that `coverageFitsScope` and `coverageMeetsCriteria` keep their shipped behaviour.
- [ ] Assert the blocked run keeps its approval untouched and its findings retained, and that the audit chain validates across the whole stage.

**Verify:** `node --test test/spec-stage.test.ts test/plan-stage.test.ts test/plan-gate.test.ts test/audit.test.ts`; `npm run typecheck`.

**Expected:** Both stages run the same five phases, spend a bounded and asserted number of dispatches, and never send an upstream concern back to the author of the wrong artifact.

**Task completion evidence:** Dispatch counts, final stage and run states, retained canonical finding, reviewer-report, decision, and proposal rows, audit validation, and the red-to-green reproduction of the original defect.

### Task 10: Final architecture facts, hazards, README, and checker alignment

**Depends on:** Task 9

**Files:**

- Modify: `docs/hazards.md`, `ARCHITECTURE.md`, `README.md`, `scripts/doc-check.mjs`
- Modify: `test/schema.test.ts` if any pin moved

**Steps:**

- [ ] Add hazard 16, `A remediation loop aimed at the wrong artifact cannot repair an upstream omission`. Record both observations: the plan-stage smoke's round-2 invented-requirement catch and Task 1's ungrounded atomic exclusive-create criterion admitted through `addressed`. State plainly that no full wrong-artifact loop is separately recorded in this repository. Record the normative-delta grounding mitigation and its remaining limit: textual occurrence is auditable but is not semantic proof.
- [ ] Verify the sections 12 and 13 authority change accepted in Task 1 still matches the implemented flow, including its explicit distinction between deterministic normative-delta/textual/mechanical validation and author-owned semantic judgment. Do not postpone or rewrite that decision here to fit accidental code; a mismatch returns to implementation or requires a new explicit operator decision.
- [ ] Update section 15's schema block and storage layout for canonical findings, immutable reviewer reports, finding decisions, proposals, and the proposal evidence directory, naming exact column positions. Update section 20 for the new configured limits, section 14 for the two-step proposal flow, and section 22's hazard count and summary.
- [ ] Add a hazard-count check to `scripts/doc-check.mjs` comparing the `^## \d+\.` heading count in `docs/hazards.md` against section 22's count, so that step is enforced rather than remembered.
- [ ] Run the checker after each edit. Exit 2 means code, migration, and checker facts disagree and must be fixed at the source; do not weaken a pin or rewrite a historical document to suppress it.
- [ ] Update `README.md` to describe the shipped flow. Do not claim delivery check is implemented and do not rename or renumber a step.

**Verify:** `npm run check:docs`; `node --test test/schema.test.ts`; `git diff -- ARCHITECTURE.md docs/hazards.md README.md scripts/doc-check.mjs`.

**Expected:** The current documentation, migrations, and checker pins state one rule; the four reconciled review records and every other historical feature document are untouched during implementation; Task 1's approved sections 12 and 13 decision remains intact; section 5 and `STAGE_SEQUENCE` are byte-for-byte unchanged.

**Task completion evidence:** Doc-check exit 0, the new hazard-count check failing on a deliberate miscount, and a diff assertion showing no stage-sequence change.

### Task 11: Break and restore every new guard

**Depends on:** Task 10

**Files:**

- Validate in a scratch mirror; do not run destructive restore commands against the working tree

**Steps:**

- [ ] Remove the panel-request range validation: the out-of-range test must fail.
- [ ] Make an unstaffable panel shrink instead of blocking: the named-block test must fail.
- [ ] Accept a reconciliation missing one canonical finding id or one reviewer report: the completeness test must fail.
- [ ] Accept an unknown disposition: the vocabulary test must fail.
- [ ] Let an unmatched `rejected_with_rationale` grounding advance: the grounding test must fail.
- [ ] Replay Task 1's retained atomic exclusive-create change as `addressed` without governing-source grounding: the normative-delta test must fail. Then omit, duplicate, or attach the wrong artifact node in `normativeChanges`: the exact-set tests must fail. Restore a grounded fixture and prove it advances without an extra dispatch.
- [ ] Omit a proposal candidate from an upstream disposition, or attach one to a non-upstream disposition: the conditional-shape tests must fail.
- [ ] Let `upstream_blocking` advance: the blocking-route test must fail.
- [ ] Let `cannot_determine` advance: the human-routing test must fail.
- [ ] Revert canonical-finding upsert to return by `lastInsertRowid`: the three-insert return regression must fail.
- [ ] Upsert a second reviewer's report over the first: the one-finding/two-report preservation test must fail.
- [ ] Remove `round` from canonical identity: the configured-two-round recurrence test must fail.
- [ ] Drop a constraint from any rebuilt finding, report, or decision table: the scoped schema test must fail — this is the guard review 1 proved could not fail before Task 7.
- [ ] Remove the self-critique dispatch: the exactly-one-self-critique and dispatch-count tests must fail.
- [ ] Fuse the mixed `critical`/`current_artifact` and `low`/upstream pair, or discard either report: the report-pair preservation test must fail.
- [ ] Omit `design.md` from the specification-review or reconciliation prompt: the governing-input test must fail.
- [ ] Allow duplicate specialties, an over-capacity required/requested union, or two selected reviewers with the same specialty: the panel validation tests must fail.
- [ ] Remove each new prompt sentence — the no-invention rule, upstream `location` syntax, proposal candidate constraints, grounding contract, and specialty-only boundary — one at a time: the matching source-scan test must fail.
- [ ] Have a stage read a live review-policy constant instead of the frozen policy: the no-live-constant test must fail.
- [ ] Write a proposal into `docs/proposals/` during a run: the scope test must fail.
- [ ] Restore after every break and rerun the named test green. Record every observed failure and restoration; a test that stays green has not proven its guard and must be strengthened before the task closes.

**Verify:** the named focused test after each break and restore, then `npm run typecheck && npm test && npm run check:docs`.

**Expected:** Every new decision boundary has an independent executable test that detects its removal or inversion.

**Task completion evidence:** A break-it table naming the mutation, the failing test and assertion, and the green restoration for every entry.

### Task 12: Bounded production smoke and learning record

**Depends on:** Task 11

**Files:**

- Validate: a fresh scratch repository outside the working tree
- Modify after evidence exists: `.claude/sessions/project-learnings.md`

**Steps:**

- [ ] Create one fresh governed scratch run whose approved specification intentionally leaves a product decision unresolved while making it necessary for an implementable plan. Drive it through the real author, self-critique, panel, and reconciliation using the shipped executor and model configuration. Do not edit the upstream artifact mid-run and do not retry a blocked run.
- [ ] Inspect the retained raw output and stored rows. Confirm exactly one self-critique dispatch, a panel matching the validated required/requested specialty union, canonical findings with every immutable report, one decision per canonical finding, exact textual grounding for every rejection, and — if the reconciler routes upstream — a stored proposal rendered from its candidate with the derived route, source finding ids, and validated audit chain. Record that this inspection cannot establish the semantic correctness of every author disposition from one sample.
- [ ] Record the run id, requested and effective model per dispatch, dispatch count, actual cost, duration, canonical finding and reviewer-report counts before and after self-critique, decisions by value, grounding results, proposal outcome, stage and run result, and audit result. If no upstream concern surfaces, record that one-sample limitation plainly; deterministic tests remain the route's proof and no repeated spend is authorized to obtain a preferred sample.
- [ ] Append the entry to `.claude/sessions/project-learnings.md`, separating what fixtures and break-it tests prove from what the real output demonstrated.

**Verify:** the relevant `bw` commands in the scratch repository; `bw verify-audit` for the smoke run; then `npm run check:docs` and read the new entry back.

**Expected:** One bounded real sample with retained evidence, actual cost, and no retry to green.

**Task completion evidence:** The retained run evidence and the appended learning record, with measured rather than estimated numbers.

### Task 13: Completion gate and independent review

**Depends on:** Task 12

**Files:**

- Modify: this plan's status and implementation note, only after all evidence exists
- Add separately during the repository workflow: a dated code review record under `docs/features/step5b-upstream-findings/`

**Steps:**

- [ ] From the repository root run `npm run typecheck`, `npm test`, and `npm run check:docs`, recording exact counts and any pre-existing skip. Verify the diff introduces no requirement-ID system, no stage-sequence change, no automatic edit of a design or specification, no run write into `docs/proposals/`, and no unrelated file.
- [ ] Have an independent reviewer assess the implemented diff against this plan, all four reconciled review records, the Task 1-approved sections 12 and 13 amendment, hazard 16, migration safety, and the break-it evidence. The reviewer must flag any claim that exact source matching or mechanical artifact gates establish semantic correctness. A material review finding is closed under this same grounded reconciliation rule; an upstream review finding becomes a proposal rather than being absorbed into the implementation note.
- [ ] Only after a clean gate and a clean independent review, set this plan to `Implemented` and append a dated implementation note with shipped behaviour, deviations from this plan, exact test counts, the smoke outcome, and remaining limitations.

**Verify:** `npm run typecheck && npm test && npm run check:docs`; the review artifact present; the working-tree diff reviewed.

**Expected:** Step 5b ships and is independently reviewed without renumbering the architecture, introducing requirement IDs, letting a model mint an obligation, or letting a run write outside the signed scope.

**Task completion evidence:** Full gate output, the review disposition, the final diff scope, and the dated implementation note.

---

## Completion gate

Step 5b is complete only when all of the following are true:

- Task 1's prototype evidence exists and its decision is recorded in this document; a confirming result received explicit operator acceptance and amended architecture sections 12 and 13 before production work began; every later contract either matches that decision or records a new approved change.
- Both review stages run exactly one self-critique per artifact before any reviewer dispatch, under the author's frozen definition and model mapping, never occupying a panel seat and never contributing to an independence claim.
- Review rounds and panel bounds live in the frozen policy and are read where they are enforced; no stage or selector reads a live review-policy constant; the default installation staffs its default panel and an unstaffable request blocks by name.
- The author proposes a panel size within frozen bounds and unique specialties; configured required specialties consume seats; their union fits the requested size; deterministic code selects distinct identities with distinct specialties, excludes the author, and never drops a requested lens.
- Every round-scoped canonical finding retains every immutable per-reviewer report and exactly one typed decision. Extras, duplicates, omissions, and unknown values are refused. Every added or replaced parsed normative node is claimed exactly once by an `addressed` decision and exact-matches its returned artifact text; its source grounding, and every `rejected_with_rationale` grounding, exact-matches the governing design or approved specification after whitespace normalization. The current artifact cannot ground itself; an ungrounded or unaccounted decision becomes `cannot_determine`; `upstream_blocking` and `cannot_determine` block with canonical finding ids named. Exact matching proves textual occurrence, not logical support, and neither an `addressed` disposition nor artifact gates independently establish semantic correctness; the architecture and implementation state this author-led authority boundary without overstating it.
- No stored value pairs a severity, route, classification, or subject that no reviewer returned; reports stay round-scoped and unfused, and the same concern in a later round cannot overwrite earlier evidence.
- An upstream decision carries a validated proposal candidate and produces a stored, queryable, non-binding proposal with impact derived from disposition, source canonical finding ids, immutable reports, and artifact hashes; no run writes into `docs/proposals/`; export and promotion are human actions.
- The canonical-finding upsert returns the row it wrote, proven by a three-insert regression; immutable report insertion cannot overwrite another reviewer; finding, report, and decision constraints are scoped to their final table bodies and fail when a constraint is dropped.
- The governance directory name has exactly one production definition, and it remains fixed and unconfigurable in this step.
- Specification reviewers and reconcilers receive `design.md`; plan reviewers and reconcilers receive the approved specification; upstream locations use the exact stable tokens and never invent a heading for an omission.
- Hazard 16, architecture sections 12, 13, 14, 15, 20, and 22, the README, the migrations, the tests, and the doc-check pins agree; the new hazard-count check is enforced; architecture section 5 and runtime `STAGE_SEQUENCE` are unchanged; all four reconciled review records are untouched during implementation.
- Every new guard has a recorded break-and-restore proof; the full typecheck, test, and doc-check gate is green; one bounded production sample is recorded honestly with measured cost.
- No requirement-ID scheme, reverse-traceability redesign, in-place reapproval, automatic design or specification mutation, delivery-check implementation, governance-path configuration, or new runtime stage entered the diff.
