# Step 5b Author-Led Review and Upstream Proposal Implementation Plan

**Status:** Reconciled

**Goal:** Replace the recursive closure-review loop in `spec_review` and `plan_review` with an author-led flow, and give an upstream concern a destination other than another author round. The artifact's own author self-critiques once, a bounded panel of specialist reviewers reports findings, and that same author reconciles every finding and amends the artifact. Completion stops meaning "reviewers eventually returned an empty list" and starts meaning "every finding carries a retained typed decision and every deterministic artifact gate passes". A concern whose cause is upstream of the reviewed artifact becomes a BuildWorks proposal: a non-blocking follow-up lets the run continue, a blocking dependency writes the proposal and blocks, and an indeterminate case blocks for a human. This is corrective Step 5b work inside the two shipped review stages. It adds no runtime stage: delivery check remains architecture step 8 and deliberate stop remains step 9.

**Source:** `ARCHITECTURE.md` sections 1 (agents propose, deterministic code decides), 5 (stage sequence), 9 (one schema per thing; a field nothing enforces does not belong; deterministic selection), 12 (gates, closure pass, the frozen profile and policy), 13 (conflict resolution, "nothing resolves its own finding", and the standing requirement that an upstream cause be reportable and routed to a human), 14 (work intake: `docs/proposals/` is convention, promotion is a human `git mv`), 15 (storage layout and the `finding(...)` schema), 20 (limits and configuration), and 22 (known hazards); `docs/hazards.md` entries 1, 2, 3, 4, 7, 11, 12, 13, and 14, plus the new entry this plan adds; `docs/features/step5b-upstream-findings/2026-08-31-plan-review.md` and `2026-08-31-plan-review-2.md` (the two reviews this plan is reconciled from, retained unchanged as the decision trail); `docs/features/plan-stage/plan.md` (the 2026-08-30 smoke evidence, including the round-2 finding that caught the plan inventing a rejection requirement the spec never stated, and the six-dispatch/three-round cost record); `.claude/sessions/project-learnings.md` (steps 1-7 shipped, one bounded smoke per stage is the established pattern); `docs/proposals/README.md` (the backlog convention and its explicit absence of a lifecycle); `.claude/skills/doc-check/SKILL.md`; and the shipped implementation in `src/spec-stage.ts`, `src/plan-stage.ts`, `src/plan-gate.ts`, `src/prompts.ts`, `src/finding.ts`, `src/store.ts`, `src/select.ts`, `src/policy.ts`, `src/profile.ts`, `src/raw-output.ts`, `src/lock.ts`, `src/verification-stage.ts`, `src/implementation-stage.ts`, `src/scope.ts`, `src/executor.ts`, `src/cli.ts`, `src/migrations/`, `scripts/doc-check.mjs`, and their tests.

**Hazards considered:** 1 (four new model-returned shapes — self-critique, panel request, reconciliation, and proposal — reach the same `extractJsonBody` and `validateAgentResult` path and must fail closed rather than default), 2 (a later run overwrites `spec.md` and `plan.md` at the same paths, so reconciliation and proposal evidence must carry before/after artifact hashes and retained raw output rather than pointing at files), 3 (every constrained field this plan adds — panel size, requested specialties, disposition vocabulary, upstream impact, and the meaning of `location` on an upstream finding — must be stated in the prompt that requests it and pinned by the source scan), 4 (Task 1 is a bounded prototype precisely because fixtures written in the same session as the contract would agree with it; and review 1 found two guards of the first draft that could not fail — the upsert return path and the whole-file constraint search — both of which this plan fixes and breaks on purpose), 7 (the defect being corrected is a redispatch that varies nothing that matters, and the new flow must not replace it with a second loop that varies nothing either), 11 (a default installation must be able to staff the panel it is configured to require, which is why the configured maximum defaults to two and an unstaffable request blocks by name), 12 (panel size and round counts must have one source and be read from the frozen profile, not from live constants the profile merely describes), 13 (a reviewer and a reconciler may identify an absent obligation; neither may mint one, and a proposal is a candidate rather than an approved requirement), and 14 (self-critique is an author dispatch, never a panel seat, and never contributes to an independence claim). Entries 5, 6, 8, 9, 10, and 15 are not newly exercised: delivery completeness, promises a later stage cannot keep, shell invocation, setup probes, model identity reporting, and the read-only proposal subprocess boundary retain their shipped rules, and no task below reaches them.

---

## Operator decisions this plan implements

These were settled during reconciliation of the two reviews and are binding on the tasks below.

- **The author is the reconciler.** There is no separate reconciler agent. `spec-author` reconciles the specification, `plan-author` reconciles the plan, each as its own evidence-bearing dispatch under the frozen author definition and model mapping.
- **One self-critique per artifact,** before any independent reviewer sees it, and never occupying a panel seat.
- **`rejected_with_rationale` advances at any severity.** The author may decline any finding, including `critical`, with a retained rationale, and the run continues. Only `upstream_blocking` and `cannot_determine` block. Severity remains reviewer evidence and is retained; it stops being a completion gate for the review stages.
- **The author proposes the panel; deterministic code staffs it.** After self-critique the author returns a requested panel size between two and the frozen configured maximum, plus the specialties the artifact calls for. It never names agent identities. Deterministic code selects distinct eligible reviewers from the frozen registry, excludes the author, enforces the configured required specialties, and blocks by name when the request cannot be staffed.
- **The configured panel maximum defaults to two,** with configurable bounds of two to five. The default installation only needs to staff two; raising the maximum is an operator action that requires adding specialists.
- **An upstream concern becomes a proposal stored as run state,** with evidence under the machine-local governance directory. Materializing it into `docs/proposals/` is an explicit human command, not a run write. Promotion to active work remains the human `git mv` section 14 already describes.
- **The governance directory is centralized behind one internal path module** and stays fixed at `.governance` in this step. External configuration of that location, and any state migration it would imply, are deferred to a later feature.
- **Reviewer fields are never combined across reports.** No merge produces a severity, route, or classification pair that no reviewer returned.
- **Step 5b adds no numbered runtime stage** and renumbers nothing. `STAGE_SEQUENCE` and architecture section 5 are unchanged.

## Assumptions

- **The phase order is fixed and identical for both reviewed artifacts.**

| Phase | Actor | Required retained output |
|---|---|---|
| Draft | artifact author | validated initial artifact |
| Self-critique | same author definition, separate dispatch | critique, validated revised artifact, and the panel request |
| Specialist review | complete independent panel | immutable per-reviewer findings, each report's severity and classification preserved together |
| Reconciliation | same author definition, separate dispatch | revised artifact plus one typed decision and rationale per finding id |
| Gate | deterministic code | reconciliation completeness, artifact gates rerun, proposals written or routed, final pass or block |

- **Self-critique and reconciliation are `agent_run` rows.** "Same author" means the same frozen agent definition and the same author model mapping, dispatched separately and retained separately. It is never a hidden continuation, an unrecorded prompt, or a reused transcript.
- **The panel request rides on the self-critique result.** One dispatch returns critique, revised artifact, and panel request as one shape, because a second dispatch would spend money to carry three fields. The request is a constrained model-returned field: an integer within `[2, panelSizeMax]` and a list of specialty strings. Out-of-range, missing, or non-integer values abort the stage; they never clamp silently.
- **Reviewers are not expected to return zero findings.** The existing behaviour that resolves findings absent from a later panel round has no meaning under a default of one round and is removed rather than left dormant.
- **Findings are immutable evidence, scoped to the round that produced them.** The author may not erase or rewrite a finding; it supplies a decision and rationale keyed to the finding id. No classification ratchets across rounds or across panel members.
- **Severity stops gating the review stages.** `MATERIAL_THRESHOLD` is read today only by `specReviewGate` (`src/spec-stage.ts:30`) and `planReviewGate` (`src/plan-gate.ts:19`). When reconciliation completeness replaces both, nothing consults it, and section 9 says a value nothing enforces does not belong. Task 3 removes it from `policy.ts` and `buildPolicy()`, or names the surviving consumer that keeps it. Either way the frozen policy shape and its hash change, and that consequence is recorded rather than absorbed.
- **The disposition vocabulary is `addressed`, `rejected_with_rationale`, `upstream_follow_up`, `upstream_blocking`, and `cannot_determine`.** `addressed` and `rejected_with_rationale` advance. `upstream_follow_up` writes a non-binding proposal and advances. `upstream_blocking` writes a proposal and blocks the run, because filing the missing decision does not make the approved specification implementable. `cannot_determine` blocks for a human without pretending a proposal resolved anything.
- **The stored shape of a reconciliation decision is settled by Task 1, not asserted here.** Whether the decision, the repair location, and the upstream impact are one column or three is a schema question, and hard rule 3 requires every stored field to change an enforced or audited behaviour. Migration 005 and a `repair_target` column are candidates carried over from the first draft of this plan, not commitments: they survive only if the prototype's evidence supports them.
- **No "smarter model" claim is encoded.** The system cannot prove one model is more capable than another. It can guarantee that self-critique and reconciliation run under the author's frozen mapping with a dedicated prompt, the complete artifact, every per-report finding, and sufficient result budget, and that the effective model of each dispatch is recorded as already required. No new model-tier configuration is introduced in this step.
- **The original approval stays as it is.** A blocked run keeps a valid signed approval bound to a spec hash a fresh run will not reproduce. That is historical evidence, not a defect. No approval mutation, in-place reapproval, or rewind is introduced.
- **Hazard 16 is a class hazard with one recorded observation, not a separately filed incident.** Architecture section 13 has mandated upstream routing since before this work; the plan-stage smoke recorded a reviewer catching the plan inventing a rejection requirement the spec never stated (`docs/features/plan-stage/plan.md`, 2026-08-30). No run record in this repository describes a full wrong-artifact remediation loop, and the entry says so plainly rather than implying an incident that was never written down.

**Approach:** Prototype the two claims this design rests on before committing schema or stage order to them, then build outward from configuration. Task 1 measures, at the real dispatch boundary and in scratch storage, whether one self-critique meaningfully reduces findings and whether an author can reconcile specialty findings without inventing obligations, and its exit decision either confirms the contracts below or revises them in this same document. Tasks 2 and 3 make the governance path and the review configuration real — one path module, one frozen policy the stages actually read. Tasks 4 through 6 define the self-critique, panel-request, and reconciliation contracts and their prompts before any schema depends on them. Tasks 7 and 8 store findings, decisions, and proposals in the shape the prototype settled. Task 9 rewires both orchestrators to the fixed phase order. Task 10 reconciles the architecture, hazards, README, and checker to the shipped behaviour, never ahead of it. Tasks 11 through 13 break every new guard, take one bounded real sample, and hand a clean gate to an independent reviewer.

**Affected areas:** `src/paths.ts` (new); `src/policy.ts`, `src/profile.ts`, `src/select.ts`, `src/prompts.ts`, `src/finding.ts`, `src/store.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/plan-gate.ts`, `src/lock.ts`, `src/raw-output.ts`, `src/verification-stage.ts`, `src/implementation-stage.ts`, `src/scope.ts`, `src/executor.ts`, `src/cli.ts`; a proposal module and its migration under `src/` and `src/migrations/`; the agent definitions under `src/agents/`; `test/policy.test.ts`, `test/profile.test.ts`, `test/select.test.ts`, `test/prompts.test.ts`, `test/store.test.ts`, `test/schema.test.ts`, `test/migrate.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, `test/plan-gate.test.ts`, `test/audit.test.ts`, `test/cli.test.ts`, and the harness fixtures under `test/fixtures/harness/`; `scripts/doc-check.mjs`; `ARCHITECTURE.md`, `docs/hazards.md`, `docs/proposals/README.md`, `README.md`, and `.claude/sessions/project-learnings.md`.

**Known blockers and constraints:**

- The prototype may not support the design. Task 1 exists to be capable of returning "self-critique changed little" or "the reconciler invented an obligation". Its exit decision is recorded in this document either way, and a disconfirming result revises the later tasks rather than being retried until it agrees.
- One bounded real sample is evidence of a contract, not a rate. No percentage claim about how many gaps self-critique removes may be written into this plan, a prompt, or a test.
- Removing the severity gate from both review stages changes the frozen policy shape and therefore the profile hash. Profiles created before the change must follow an explicit stated rule — refuse by name, or be readable as historical evidence and not resumable — chosen in Task 3 rather than discovered at runtime.
- The registry holds three reviewer definitions, all under `src/agents/spec-reviewer-*.ts`, and they serve both review stages. A configured maximum above three cannot be staffed by the default installation, which is exactly why the maximum defaults to two and an unstaffable request is a named block rather than a silent shrink.
- The author's panel request is model output reaching a deterministic selector. It must be validated before it can influence selection, and the selector must remain a pure function whose inputs are the frozen agent list, the validated size, and the requested and required specialties.
- Every existing `insertFinding` call site and fixture changes when the finding shape changes. TypeScript failures during Task 7 are the intended fail-closed pressure, not a reason to make a new field optional.
- `docs/proposals/` is a human convention with no runtime contract. Nothing in this plan may write there during a run; the export command is a separate operator action against stored state.

**Blast radius** (verified by reading the implementation and search results, 2026-08-31):

- `insertFinding` (`src/store.ts:389`) returns `this.getFinding(Number(result.lastInsertRowid))!`. SQLite does not update `last_insert_rowid()` on `ON CONFLICT ... DO UPDATE`, so on the conflict path it returns whichever row the previous successful insert created. Both stages currently discard the return value, so nothing observable is broken today; any new flow that reads it would be reading an unrelated finding.
- `test/schema.test.ts:102-120` and `scripts/doc-check.mjs:243-334` assert enum and uniqueness constraints with whole-file `sql.includes(...)` over every migration concatenated. `src/migrations/003_finding.sql` keeps that text forever, so a later rebuild of `finding` can omit `UNIQUE (stage_id, intent_key, location)` or either `CHECK` and both gates stay green. The adjacent stage test at `test/schema.test.ts:98` shows the correct pattern: `migrationTables(sql).get("stage")!.includes(...)`.
- `PANEL_SIZE` is declared at `src/select.ts:5` and read live at `src/select.ts:62`, `src/spec-stage.ts:221`, and `src/plan-stage.ts:317`. `REMEDIATION_ROUNDS` is read live at `src/spec-stage.ts:238,343` and `src/plan-stage.ts:334,438`. `buildPolicy()` copies both into the frozen profile, which no stage then reads — the profile describes values the live constants decide.
- `runPlanStage` accepts `deps` with a `selectPanel` seam (`src/plan-stage.ts:62-67`). `runSpecStage` takes no `deps` parameter at all (`src/spec-stage.ts:51`), so a spec-review test cannot control its panel except through the frozen agent list.
- `src/plan-gate.ts` exports `planReviewGate`, `coverageFitsScope`, and `coverageMeetsCriteria` — it is not only the material-finding gate. `specReviewGate` is not in a gate module at all; it lives at `src/spec-stage.ts:26`.
- `MATERIAL_THRESHOLD` is imported only by `src/plan-gate.ts` and `src/spec-stage.ts`. No other gate, stage, or script reads it.
- The literal `.governance` appears in nine path constructions across seven production modules — `src/store.ts:160`, `src/lock.ts:5`, `src/profile.ts:75,159`, `src/raw-output.ts:10,14`, `src/verification-stage.ts:195`, `src/implementation-stage.ts:209` — plus the scope prefix at `src/scope.ts:94`, the executor denied path at `src/executor.ts:66`, the clean-tree filter at `src/cli.ts:201`, and the storage-layout assertions at `scripts/doc-check.mjs:162,337-346`.
- `writePlanDoc` (`src/plan-doc.ts:175-177`) and `writeSpecDoc` (`src/spec-doc.ts:96-98`) write unconditionally to `docs/features/<slug>/`, and `bw new-run` has no same-slug guard. A later run on the same slug overwrites the artifacts a blocked run's `stage.output_ref` names, so a path reference is not evidence and a hash is.
- The reviewer pool is three definitions: `src/agents/spec-reviewer-consistency.ts`, `spec-reviewer-security.ts`, and `spec-reviewer-traceability.ts`. `REQUIRED_SPECIALTIES` is `["requirements-traceability"]`.
- No search result requires an approval, implementation, verification, delivery-check, CLI stage-sequence, or `STAGE_SEQUENCE` change.

**Verification:** Regression-first per task. The completion gate is `npm run typecheck`, focused tests during implementation, `npm test`, and `npm run check:docs`; then every new guard is broken and restored in a scratch mirror. One bounded prototype sample precedes production commitment and one bounded production smoke follows it. No requirement ID is introduced, no upstream document is edited automatically, no proposal is written into the repository by a run, and no current step is renumbered.

---

### Task 1: Bounded prototype and contract decision gate

**Depends on:** None

**Files:**

- Add: a scratch prototype harness outside production stage order, under a temporary directory or an uncommitted scratch path
- Modify at the end of the task: this plan, with the recorded decision

**Steps:**

- [ ] Build the prototype against the real dispatch boundary with scratch or fixture storage. It may not modify `STAGE_SEQUENCE`, the canonical schema, or either shipped stage's order. It exists to measure the flow, not to become it.
- [ ] Run the six comparisons this design depends on: draft versus self-critiqued artifact findings; two specialty findings that agree; conflicting findings whose severity and upstream classification differ; one non-blocking upstream concern; one blocking upstream dependency; and malformed or incomplete reconciliation output.
- [ ] For each, record dispatch count, cost, duration, parsing success or failure, finding counts before and after self-critique, reconciliation completeness against the finding id set, proposal quality, and whether the reconciler invented an obligation the approved input never stated.
- [ ] Confirm at the parser what the panel request and reconciliation shapes actually look like coming back from a real model, including at least one deliberately malformed response, before either shape is fixed in code.
- [ ] Record the exit decision in this plan: confirm the disposition vocabulary, the panel-request shape, the reconciliation result shape, and whether a `repair_target`-style column is needed at all — or revise Tasks 4 through 9 here before production work starts.

**Verify:** the prototype's own recorded output; `npm run typecheck` if any committed file changed; this plan's decision paragraph present and dated.

**Expected:** One bounded real sample per comparison, with actual cost and no retry to green. A disconfirming result revises the plan; it does not get re-run until it agrees.

**Task completion evidence:** The per-comparison record, the parser results including the malformed case, and the dated decision paragraph appended to this plan.

### Task 2: One governance path module

**Depends on:** None

**Files:**

- Add: `src/paths.ts`
- Modify: `src/store.ts`, `src/lock.ts`, `src/profile.ts`, `src/raw-output.ts`, `src/verification-stage.ts`, `src/implementation-stage.ts`, `src/scope.ts`, `src/executor.ts`, `src/cli.ts`
- Modify: the tests covering those modules; `scripts/doc-check.mjs` if its storage-layout assertion moves

**Steps:**

- [ ] Add `src/paths.ts` owning the governance directory name and one function per existing location: state database, lock directory, raw output (absolute and reference forms), profile directory and file, verification evidence, worktrees, and the new proposal evidence directory. The directory name is a constant in this module and is not configurable in this step.
- [ ] Replace all nine production path constructions with calls into it, and derive the scope prefix, the executor denied path, and the clean-tree filter from the same constant rather than repeating the literal.
- [ ] Add a test asserting the literal appears in exactly one production module, so a later addition cannot quietly reintroduce a tenth construction site.
- [ ] Leave the layout under the directory byte-for-byte as shipped. This task changes where the name is written, not where anything is stored.

**Verify:** `npm test`; `npm run typecheck`; `npm run check:docs`; `git diff` shows no change to any stored path string.

**Expected:** One module answers "where does governance state live", proposal evidence has a home to be added to, and external configuration of that location remains a deferred, separate decision.

**Task completion evidence:** The single-source test green, the full suite green, and a diff showing path values unchanged.

### Task 3: Real review configuration in the frozen policy

**Depends on:** Task 1

**Files:**

- Modify: `src/policy.ts`, `src/profile.ts`, `src/select.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/plan-gate.ts`
- Modify: `test/policy.test.ts`, `test/profile.test.ts`, `test/select.test.ts`, `test/plan-gate.test.ts`
- Modify: `scripts/doc-check.mjs` where it pins policy facts

**Steps:**

- [ ] Add `specReviewRounds` and `planReviewRounds`, both defaulting to one, and `panelSizeMax`, defaulting to two with validated bounds of two through five. Replace the per-risk `PANEL_SIZE` map, which the author-proposed panel supersedes; keep `computeRisk` and the risk value itself, which the approval payload binds.
- [ ] Define a configured round as one complete `panel → reconcile` cycle. Self-critique happens once per artifact regardless of the configured round count, before the first panel.
- [ ] Make both stages and the selector read these values from the frozen profile policy. Remove the live-constant fallbacks and add a test that fails if a stage imports a review-policy constant directly.
- [ ] Settle materiality: remove `MATERIAL_THRESHOLD` and `materialityThreshold` once reconciliation completeness replaces both severity gates, or name in a comment the consumer that keeps it. Record the resulting policy-shape and profile-hash change.
- [ ] State and implement the rule for profiles created before this change — refuse by name, or readable as history and not resumable — and test it. Do not let an old profile silently produce a policy the code no longer honours.
- [ ] Add a configuration-time staffing refusal: when the frozen registry cannot seat `panelSizeMax` distinct eligible reviewers including the configured required specialties, the run refuses at configuration time and names what is missing.

**Verify:** `node --test test/policy.test.ts test/profile.test.ts test/select.test.ts test/plan-gate.test.ts`; `npm run typecheck`; `npm run check:docs`.

**Expected:** Round counts and panel bounds have one source, are frozen per run, and are read where they are enforced. A default installation staffs two. A configuration the registry cannot satisfy fails before any money is spent.

**Task completion evidence:** The red tests against the live constants, the green focused gate, the recorded policy-hash change, and the old-profile rule proven by test.

### Task 4: Self-critique contract and prompt

**Depends on:** Tasks 1 and 3

**Files:**

- Modify: `src/prompts.ts`, `src/agents/spec-author.ts`, `src/agents/plan-author.ts`
- Modify: `src/spec-stage.ts`, `src/plan-stage.ts`
- Modify: `test/prompts.test.ts`, `test/agents.test.ts`, and both author fixtures under `test/fixtures/harness/`

**Steps:**

- [ ] Define one self-critique result shape carrying the critique, the revised artifact, and the panel request. Validate it fail closed: a missing critique, a missing or invalid artifact, or an absent panel request aborts with a named error and never falls back to the draft.
- [ ] Write the self-critique prompt for both authors. It states that this is the author's own pass before independent review, that the revised artifact must still satisfy the same document validation as the draft, and that the author may not add obligations the approved input does not contain.
- [ ] Dispatch self-critique as a separate `agent_run` under the author's frozen definition and model mapping, exactly once per artifact, before any reviewer dispatch. Retain its raw output like any other invocation.
- [ ] Rerun the mechanical artifact gates on the revised artifact. A self-critique that produces an invalid document blocks; it does not silently fall back.
- [ ] Extend the hazard-3 source scan and the generated-prompt assertions so the self-critique prompt's constraints are pinned where they are requested.

**Verify:** `node --test test/prompts.test.ts test/agents.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`; `npm run typecheck`.

**Expected:** Exactly one self-critique per artifact, recorded as its own dispatch, gated like any other artifact, and never counted as review.

**Task completion evidence:** The dispatch-count assertion, the invalid-critique block, and the prompt-scan test failing when the constraint sentence is removed.

### Task 5: Author-proposed panel, deterministic staffing

**Depends on:** Task 4

**Files:**

- Modify: `src/select.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`
- Modify: `test/select.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`

**Steps:**

- [ ] Validate the panel request before it reaches selection: an integer size within `[2, panelSizeMax]` and a list of specialty strings. Out of range, non-integer, missing, or non-string entries abort the stage by name. Nothing clamps to a bound, and nothing defaults.
- [ ] Extend `selectReviewers` to take the validated size and the requested specialties alongside the required ones, keeping it a pure function over the frozen agent list. Configured required specialties fill first, then requested specialties, then ranked relevance — and the author is excluded because candidates are reviewers only.
- [ ] Block by name when the request cannot be staffed with distinct eligible reviewers, naming the requested size, the specialties, and what the frozen registry could seat. Do not shrink the panel to what is available.
- [ ] Add a `deps.selectPanel` seam to `runSpecStage` mirroring the one `runPlanStage` already has (`src/plan-stage.ts:62-67`), so a spec-review test can control its panel without depending on registry contents.
- [ ] Test that the author never influences identity: two different requests with the same size and specialties against the same frozen registry select the same reviewers.

**Verify:** `node --test test/select.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`; `npm run typecheck`.

**Expected:** The author proposes a size and a lens; deterministic code decides who reviews. An unstaffable request is a named block, and selection stays reproducible from the frozen profile.

**Task completion evidence:** The validation truth table, the unstaffable block message, and the determinism test.

### Task 6: Reconciliation contract and prompt

**Depends on:** Tasks 1 and 5

**Files:**

- Modify: `src/prompts.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`
- Modify: `test/prompts.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, and both review fixtures

**Steps:**

- [ ] Define the reconciliation result: the revised artifact plus exactly one decision and rationale per finding id, using the five-value vocabulary. Refuse extras, duplicates, omissions, and unknown dispositions with named errors. A missing rationale on a decision that requires one is a refusal, not a blank field.
- [ ] Write the reconciliation prompt. It hands the author the complete artifact and every per-reviewer report with its severity and classification intact, states that a finding may be declined with rationale, and states that the author may not add a requirement the approved input does not contain. It also states that an out-of-specialty finding may be declined with rationale, since deterministic code cannot prove a semantic finding belongs to a specialty.
- [ ] State the meaning of `location` for an upstream report in both reviewer prompts, beside the classification field: an omission has no heading in the artifact under review, so name the upstream document's section rather than inventing a local one. Pin the rule in the source scan and the generated-prompt assertions.
- [ ] Tell the spec reviewer explicitly that `current_artifact` means the specification and upstream means the design input it never sees (`src/spec-stage.ts:120` reads `design.md`), and the plan reviewer that upstream means the approved specification.
- [ ] Rerun the mechanical artifact gates on the reconciled artifact, and record before and after artifact hashes on the reconciliation event exactly as `plan.gate.pass` already records `planHash=` (`src/plan-stage.ts:433`), so the evidence survives a later run overwriting the file.
- [ ] Preserve report pairs. Add the mixed case — one reviewer reporting `critical` on the current artifact, another reporting `low` upstream on the same concern — and prove both reports survive to the reconciler unfused, and that no stored value pairs a severity with a classification no reviewer returned.

**Verify:** `node --test test/prompts.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`; `npm run typecheck`.

**Expected:** Every finding id has exactly one retained typed decision; malformed reconciliation fails closed; no prompt authorizes minting an obligation; and no aggregation invents a report.

**Task completion evidence:** The extras/duplicates/omissions/unknown refusals, the mixed-pair preservation test, and each prompt-scan test failing when its sentence is removed.

### Task 7: Finding and reconciliation storage

**Depends on:** Tasks 1 and 6

**Files:**

- Add: a migration under `src/migrations/` in the shape Task 1 settled
- Modify: `src/finding.ts`, `src/store.ts`
- Modify: `test/store.test.ts`, `test/schema.test.ts`, `test/migrate.test.ts`
- Modify: `scripts/doc-check.mjs`

**Steps:**

- [ ] Fix `insertFinding` to return the row it actually wrote: add `RETURNING id` to the upsert or re-select by `(stage_id, intent_key, location)`. Add a regression that inserts three findings, re-reports the first, and proves the returned row is the first — the two-insert case passes by coincidence and does not prove this.
- [ ] Write every merge and dedup assertion against canonical stored state read back through `getFindings(stageId)`, never through `insertFinding`'s return value. Assert the row count as well as the surviving row's values: proving one row is correct does not prove a second was not created.
- [ ] Store one reconciliation decision per finding id with its rationale, the reconciling `agent_run`, and the artifact hashes in force. Enforce one decision per finding at the schema level and validate the vocabulary before SQL, importing it from the module that owns it so the constraint and the validator cannot drift.
- [ ] Keep reports round-scoped and unfused. Do not rank or combine severity in SQL; immutable migration text cannot import `SEVERITY_ORDER` and a fourth copy of the ordering would go stale silently.
- [ ] Scope the finding constraint assertions to the table body in both `test/schema.test.ts` and `scripts/doc-check.mjs`, using the pattern already at `test/schema.test.ts:98`, so a rebuild of `finding` cannot pass on `003_finding.sql`'s dead text.
- [ ] If the migration rebuilds `finding`: rename, recreate with every existing constraint, copy rows with explicit ids, drop the old table, set the user version. Note in the file that explicit-id copying restores the `AUTOINCREMENT` sequence correctly only because nothing in `src/` deletes findings. Do not edit an existing migration and do not add a permanent default for a field new writes must supply.
- [ ] Build the migration regression against a scratch migrations directory holding the prior versions, applied, then the new file copied in and reapplied — `applyMigrations` applies every file in the directory it is given.
- [ ] Name the exact column position for any schema line added to architecture section 15: `checkMigrations` and `test/schema.test.ts:90` compare column lists with `JSON.stringify`, so order is part of the contract.

**Verify:** `node --test test/store.test.ts test/schema.test.ts test/migrate.test.ts`; `npm run typecheck`; `npm run check:docs`.

**Expected:** The store returns the row it wrote, every decision is retained against its finding, old rows survive with their original semantics, and the three schema consumers agree about the final table rather than about dead text.

**Task completion evidence:** The three-insert return regression red then green, the scoped-constraint test failing when a constraint is dropped from the new table, and the before/after row assertions.

### Task 8: Proposal contract, persistence, and human export

**Depends on:** Tasks 2, 6, and 7

**Files:**

- Add: a proposal module under `src/` and its migration under `src/migrations/`
- Modify: `src/cli.ts`, `src/store.ts`
- Modify: `test/cli.test.ts`, `test/store.test.ts`, `test/schema.test.ts`, `test/audit.test.ts`
- Modify: `docs/proposals/README.md`

**Steps:**

- [ ] Define the proposal record: source run, stage, feature slug, and finding ids; title and problem statement; why the concern is upstream of the reviewed artifact; `follow_up | blocking_dependency` impact; the reconciler's rationale; and the artifact hashes in force.
- [ ] Store it as run state with evidence written under the governance directory through `src/paths.ts`. No run writes into `docs/proposals/`, which is outside the signed scope.
- [ ] Give it a deterministic identity and a stated behaviour when the same proposal is raised again. Deduplicate the candidate without fusing impact, route, or rationale across reports: preserve source finding ids and let the reconciler's single explicit impact decision stand.
- [ ] Validate that a proposal is non-binding. It cannot add an acceptance criterion to the current feature and cannot become an active `design.md` automatically. Promotion stays the human `git mv` section 14 describes.
- [ ] Retain the raw reconciliation output and append the audit event before any write, and define the behaviour when rendering or writing the evidence fails — the run blocks with the cause named rather than advancing as though a proposal existed.
- [ ] Route by impact: `follow_up` writes and advances; `blocking_dependency` writes and blocks, because filing the missing decision does not make the approved specification implementable; `cannot_determine` blocks for a human with no proposal claimed.
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

- [ ] Replace the round loop in both stages with: draft, self-critique, then for each configured round a complete panel followed by reconciliation, then the deterministic gate. Remove the closure-round redispatch and the resolution of findings absent from a later panel.
- [ ] Make the gate decide on reconciliation completeness and the mechanical artifact gates, not on open severity. Advance on `addressed` and `rejected_with_rationale` at any severity, with the rationale retained; block on `upstream_blocking` and `cannot_determine`, naming the finding ids and the proposal.
- [ ] Add the plan-review regression that reproduces the original defect: a material upstream concern in round one produces a proposal and either a documented advance or a named block by its impact, and no additional plan-author revision round is dispatched to repair the wrong artifact.
- [ ] Add the spec-review analogue so both stages prove the same semantics, using the new `deps.selectPanel` seam rather than depending on registry contents.
- [ ] Assert dispatch counts explicitly in both stages: exactly one draft, exactly one self-critique, exactly the requested panel size, exactly one reconciliation per round.
- [ ] Prove both round configurations: the default of one, and a configured value greater than one running `panel → reconcile` twice with one self-critique in total and findings scoped to the round that produced them.
- [ ] Prove the coverage and document gates still run on the reconciled artifact, and that `coverageFitsScope` and `coverageMeetsCriteria` keep their shipped behaviour.
- [ ] Assert the blocked run keeps its approval untouched and its findings retained, and that the audit chain validates across the whole stage.

**Verify:** `node --test test/spec-stage.test.ts test/plan-stage.test.ts test/plan-gate.test.ts test/audit.test.ts`; `npm run typecheck`.

**Expected:** Both stages run the same five phases, spend a bounded and asserted number of dispatches, and never send an upstream concern back to the author of the wrong artifact.

**Task completion evidence:** Dispatch counts, final stage and run states, retained finding and decision rows, proposal rows, audit validation, and the red-to-green reproduction of the original defect.

### Task 10: Architecture, hazards, README, and checker alignment

**Depends on:** Task 9

**Files:**

- Modify: `docs/hazards.md`, `ARCHITECTURE.md`, `README.md`, `scripts/doc-check.mjs`
- Modify: `test/schema.test.ts` if any pin moved

**Steps:**

- [ ] Add hazard 16, `A remediation loop aimed at the wrong artifact cannot repair an upstream omission`. Record the failure mode, name its one recorded observation — the plan-stage smoke's round-2 invented-requirement catch — and state plainly that no full wrong-artifact loop is separately recorded in this repository, so the entry is a class hazard derived from section 13's standing rule.
- [ ] Amend section 13. "Nothing resolves its own finding" becomes explicit about the trade: deterministic code decides structural completeness and mechanical gates; the author supplies the semantic disposition, including declining a finding of any severity with a retained rationale; independent reviewers do not confirm the amended artifact by default; the audit retains the original finding, the decision, the rationale, and before/after artifact hashes; malformed, missing, or indeterminate dispositions fail closed. Record what is given up, not only what is gained.
- [ ] Amend section 12. Replace the closure pass with the five-phase order, replace per-risk panel sizes with the author-proposed panel inside frozen bounds, state the configured round default of one, and state the configuration-time staffing refusal.
- [ ] Update section 15's schema block and storage layout for the new tables and the proposal evidence directory, naming exact column positions. Update section 20 for the new configured limits, section 14 for the two-step proposal flow, and section 22's hazard count and summary.
- [ ] Add a hazard-count check to `scripts/doc-check.mjs` comparing the `^## \d+\.` heading count in `docs/hazards.md` against section 22's count, so that step is enforced rather than remembered.
- [ ] Run the checker after each edit. Exit 2 means code, migration, and checker facts disagree and must be fixed at the source; do not weaken a pin or rewrite a historical document to suppress it.
- [ ] Update `README.md` to describe the shipped flow. Do not claim delivery check is implemented and do not rename or renumber a step.

**Verify:** `npm run check:docs`; `node --test test/schema.test.ts`; `git diff -- ARCHITECTURE.md docs/hazards.md README.md scripts/doc-check.mjs`.

**Expected:** The current documentation, the migrations, and the checker pins state one rule; the two review records and every historical feature document are untouched; section 5 and `STAGE_SEQUENCE` are byte-for-byte unchanged.

**Task completion evidence:** Doc-check exit 0, the new hazard-count check failing on a deliberate miscount, and a diff assertion showing no stage-sequence change.

### Task 11: Break and restore every new guard

**Depends on:** Task 10

**Files:**

- Validate in a scratch mirror; do not run destructive restore commands against the working tree

**Steps:**

- [ ] Remove the panel-request range validation: the out-of-range test must fail.
- [ ] Make an unstaffable panel shrink instead of blocking: the named-block test must fail.
- [ ] Accept a reconciliation missing one finding id: the completeness test must fail.
- [ ] Accept an unknown disposition: the vocabulary test must fail.
- [ ] Let `upstream_blocking` advance: the blocking-route test must fail.
- [ ] Let `cannot_determine` advance: the human-routing test must fail.
- [ ] Revert `insertFinding` to return by `lastInsertRowid`: the three-insert return regression must fail.
- [ ] Drop a constraint from the rebuilt `finding` table: the scoped schema test must fail — this is the guard review 1 proved could not fail before Task 7.
- [ ] Remove the self-critique dispatch: the exactly-one-self-critique and dispatch-count tests must fail.
- [ ] Fuse the mixed `critical`/`current_artifact` and `low`/upstream pair: the report-pair preservation test must fail.
- [ ] Remove each new prompt sentence — the no-invention rule, the upstream `location` rule, the specialty boundary — one at a time: the matching source-scan test must fail.
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
- [ ] Inspect the retained raw output and stored rows. Confirm exactly one self-critique dispatch, a panel matching the validated request, one decision per finding id, and — if the reconciler routes upstream — a stored proposal with its source finding ids, the correct route, and a validated audit chain.
- [ ] Record the run id, requested and effective model per dispatch, dispatch count, actual cost, duration, finding counts before and after self-critique, decisions by value, proposal outcome, stage and run result, and audit result. If no upstream concern surfaces, record that one-sample limitation plainly; the deterministic tests remain the route's proof and no repeated spend is authorized to obtain a preferred sample.
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
- [ ] Have an independent reviewer assess the implemented diff against this plan, the amended sections 12 and 13, hazard 16, migration safety, and the break-it evidence. A material review finding is closed under this same reconciliation rule; an upstream review finding becomes a proposal rather than being absorbed into the implementation note.
- [ ] Only after a clean gate and a clean independent review, set this plan to `Implemented` and append a dated implementation note with shipped behaviour, deviations from this plan, exact test counts, the smoke outcome, and remaining limitations.

**Verify:** `npm run typecheck && npm test && npm run check:docs`; the review artifact present; the working-tree diff reviewed.

**Expected:** Step 5b ships and is independently reviewed without renumbering the architecture, introducing requirement IDs, letting a model mint an obligation, or letting a run write outside the signed scope.

**Task completion evidence:** Full gate output, the review disposition, the final diff scope, and the dated implementation note.

---

## Completion gate

Step 5b is complete only when all of the following are true:

- Task 1's prototype evidence exists and its decision is recorded in this document, and every later contract either matches that decision or records why it changed.
- Both review stages run exactly one self-critique per artifact before any reviewer dispatch, under the author's frozen definition and model mapping, never occupying a panel seat and never contributing to an independence claim.
- Review rounds and panel bounds live in the frozen policy and are read where they are enforced; no stage or selector reads a live review-policy constant; the default installation staffs its default panel and an unstaffable request blocks by name.
- The author proposes a panel size within the frozen bounds and the specialties it wants; deterministic code selects the identities, excludes the author, and enforces the required specialties.
- Every finding carries exactly one retained typed decision with a rationale; extras, duplicates, omissions, and unknown values are refused; `rejected_with_rationale` advances at any severity with its rationale retained; `upstream_blocking` and `cannot_determine` block with the finding ids named.
- No stored value pairs a severity, route, or classification that no reviewer returned; reports stay round-scoped and unfused.
- An upstream concern produces a stored, queryable, non-binding proposal with its source finding ids and artifact hashes; no run writes into `docs/proposals/`; export and promotion are human actions.
- `insertFinding` returns the row it wrote, proven by a three-insert regression; the finding constraint assertions are scoped to the final table body and fail when a constraint is dropped from it.
- The governance directory name has exactly one production definition, and it remains fixed and unconfigurable in this step.
- Hazard 16, architecture sections 12, 13, 14, 15, 20, and 22, the README, the migrations, the tests, and the doc-check pins agree; the new hazard-count check is enforced; architecture section 5 and runtime `STAGE_SEQUENCE` are unchanged; both review records are untouched.
- Every new guard has a recorded break-and-restore proof; the full typecheck, test, and doc-check gate is green; one bounded production sample is recorded honestly with measured cost.
- No requirement-ID scheme, reverse-traceability redesign, in-place reapproval, automatic design or specification mutation, delivery-check implementation, governance-path configuration, or new runtime stage entered the diff.
