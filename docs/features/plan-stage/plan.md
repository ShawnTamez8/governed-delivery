# Plan Stage Implementation Plan

**Status:** Proposed

**Goal:** Build order step 5: the `plan` and `plan_review` stages, chained from the approved `awaiting_approval` row — a plan author turns the approved specification into `plan.md` under a content write, a selected review panel raises findings, and a deterministic gate decides completion, refusing at the gate any coverage the plan promises for artifacts only a later stage can produce.

**Source:** `ARCHITECTURE.md` sections 4 (the stage chain and handoffs), 5 (stage sequence: `awaiting_approval -> plan -> plan_review`), 8 (contracts — AgentResult, write modes, finding identity), 9 (agents, role separation, selection), 10 (model configuration), 12 (gates — "Refuse promises that cannot be kept"), 13 (conflict resolution), 20 (limits), 23 (build order step 5); `docs/hazards.md` entries 1, 3, 4, 6, 7, 11, 13; `CLAUDE.md`; the shipped spec stage as the direct precedent (`src/spec-stage.ts`, `docs/features/spec-stage/plan.md`).

**Assumptions:**

- **This plan is executed after `docs/features/approval-gate-hardening/plan.md`.** That plan changes `Store.transaction` to be re-entrant, adds a `spec.gate.pass` contract the approval gate reads, and adds `Profile.approvalSigner`. Building the plan stage first would mean writing the same gate-event and transaction code twice. If the hardening plan has not landed, stop and say so rather than duplicating its changes.
- **The model map lands here, because this is the first step that needs one.** Section 10 requires a stage to name what it needs and configuration to resolve it, resolved once at run start and snapshotted. Until now the model was a single `--model` flag on `bw spec`. The profile gains `modelMap: Record<string, string>` keyed by stage kind, frozen at `new-run`, and a stage whose kind has no entry **fails at configuration time** — before any invocation, as section 10 requires.
- **`bw new-run` gains `--model <name>`, required.** It is the only point at which the map can be frozen. Every existing test that calls `new-run` must pass it, which is a mechanical but wide edit — counted in the blast radius below rather than discovered during execution.
- **`bw spec --model` becomes optional and is checked, not trusted.** When omitted the stage reads the frozen map; when supplied it must equal the frozen value, refused otherwise with a named message. Hard rule 6 says config is frozen at run start, so a flag that silently overrides the snapshot would make the profile a decoration.
- **The plan document schema is minimal and mirrors the spec's.** Frontmatter `feature:` and `plan_for:` (the spec's content hash, which is what binds a plan to the specification it was written from), a `## Tasks` section with one task per list line, and a `## Coverage` section whose entries are `<acceptance criterion> -> <artifact path>` or `<acceptance criterion> -> not_applicable: <rationale> / <alternative verification>`. Hazard 13 warns against inventing obligations, so validation checks presence and shape only.
- **`not_applicable` requires both a rationale and an alternative verification**, per section 8's coverage-decisions rule. A coverage entry naming neither is refused by the schema, not by a reviewer.
- **The unkeepable-promise gate is deterministic and needs no agent.** A criterion's coverage names an artifact; if that artifact is not in the run's signed scope, the plan is promising something the approved scope does not cover and the gate blocks. This is the mechanically checkable half of hazard 6. The half that needs stage ordering — "produced by a stage that runs after the stage being planned" — is not checkable until stages declare which artifacts they produce, which nothing does yet; the plan states this limit rather than implying full coverage.
- **Reviewers are reused; the author is new.** `selectReviewers` is already stage-agnostic and selects on `role: "reviewer"` plus `outputs: ["findings"]`, so the three seeded reviewers serve both stages. Only a `plan-author` agent is added.
- **One real API spend**, a manual smoke against the real `claude` binary, exactly as steps 2 and 3 did. The automated suite uses fixture executors only.

**Approach:** Mirror `src/spec-stage.ts` structurally — it is the proven shape for author dispatch, content write, panel, findings, deterministic gate, and bounded closure rounds — but do not extract a shared abstraction. Hard rule 4 forbids an interface before two real implementations exist, and this is the moment the second appears; the plan calls out the duplication explicitly and defers extraction to a later step with the evidence in hand. The gate and every validator are pure functions taking injected inputs, so the whole suite runs against fixture executors with no network.

**Affected areas:** New `src/plan-doc.ts`, `src/plan-stage.ts`, `src/agents/plan-author.ts`; modify `src/prompts.ts` (plan author and plan reviewer prompts), `src/agents.ts` (register the author), `src/profile.ts` (the model map), `src/policy.ts` (the plan stage's remediation budget if it differs), `src/cli.ts` (`bw plan`, `new-run --model`, `spec --model` optional), `src/spec-stage.ts` (read the model from the profile); tests for each; `test/prompts.test.ts` (hazard 3's constrained-field scan gains the plan prompts); `README.md` and `CLAUDE.md` (the new command).

**Known blockers:**

- **`ARCHITECTURE.md` is not modified by this plan.** The `plan` and `plan_review` kinds are already in section 5's sequence and `scripts/doc-check.mjs` asserts that sequence verbatim, so no documentation fact changes. Verified by reading the checker's `expectedSeq`.
- **Hazard 3 (a constrained field must have its constraint stated in the prompt).** `test/prompts.test.ts` reads `src/prompts.ts` and asserts each constrained field's constraint appears in the source. Its `CONSTRAINT_STRINGS` array carries a comment saying the patch rules "return with the step whose prompts request patches" — that is **not** this step: the plan stage is a content write, like the spec stage. Adding patch-rule strings here would be wrong. The array does gain the plan schema's constraints.
- **Hazard 7 (retries that vary nothing).** The spec stage's revision round already varies the prompt by injecting the open findings. The plan stage must do the same; a closure round that resends an identical prompt is a slower failure with a larger bill.
- **Hazard 11 (a default installation must complete a run).** The seeded agents must satisfy the plan stage's panel at standard risk. A test asserts the seeded registry can staff it, as `test/agents.test.ts` already does for the spec stage.
- **The spec-stage duplication is deliberate and will be visible in review.** Two stage orchestrators of similar shape is the expected outcome of hard rule 4, not an oversight. Say so in the code comment so a reviewer does not file it as one.
- **The manual smoke costs real money and must be run once.** The step-3 entry in `.claude/sessions/project-learnings.md` records that the smoke exposed two prompt defects the fixtures could not — a prompt mentioning `baseCommit` made the model refuse, and a reviewer returned a bare findings object until the prompt stated the full envelope. Expect the plan prompts to need the same iteration, and budget for it.

**Blast radius** (verified by import search across `src/**` and `test/**`):

- `src/profile.ts` — imported by `src/cli.ts`, `src/approval-stage.ts`, `test/profile.test.ts`, `test/cli.test.ts`. Adding `modelMap` changes every frozen profile's hash; no fixture pins a literal profile hash (both tests compute it in-test from the bytes they read), so nothing else moves.
- **`freezeProfile` gains a required `model` argument, which breaks all eight call sites** (verified by grep): `src/cli.ts:134`, `test/approval-stage.test.ts:61`, and six calls in `test/profile.test.ts` (lines 24, 33, 41, 54, 62, 63). Every one needs the new argument. This is mechanical but must be done in the same step as the signature change or the tree stays red — `tsconfig.json` includes `test`.
- `src/cli.ts` — no importers; `test/cli.test.ts` spawns it. Making `--model` required on `new-run` touches **every** `new-run` invocation in the suite: `test/cli.test.ts` (several), and any test that shells out to it. `test/store.test.ts`, `test/spec-stage.test.ts`, and `test/approval-stage.test.ts` call `store.insertRun` directly and are unaffected — verified by grep for `new-run` across `test/`.
- `src/spec-stage.ts` — imported by `src/cli.ts` and `test/spec-stage.test.ts`. It gains a profile read for the model; `runSpecStage`'s `requestedModel` input becomes optional, so the direct callers in `test/spec-stage.test.ts` that pass it explicitly keep working.
- `src/prompts.ts` — imported by `src/spec-stage.ts` and `test/prompts.test.ts`. Adding two builders affects neither existing consumer.
- `src/agents.ts` — imported by `src/select.ts`, `src/spec-stage.ts`, `src/profile.ts`, `test/agents.test.ts`. Registering `plan-author` lengthens `AGENTS`. Verified by reading `test/agents.test.ts`: its only count assertion is `reviewers.length >= 2` over agents filtered to `role: "reviewer"`, so adding an **author** cannot affect it; its "no reviewer allows spec output" loop is likewise filtered to reviewers. `selectReviewers` also filters to `role: "reviewer"`, so an added author can never enter a panel.
- `src/policy.ts` — imported by `src/spec-stage.ts`, `src/profile.ts`, `src/cli.ts`, `src/approval-stage.ts`, `test/policy.test.ts`. Any constant added here changes the policy hash, which is frozen per run and re-checked at the approval gate; runs created before the change will fail that re-check with the correct message. Nothing has shipped, so no migration is owed.
- No consumer of the plan stage exists yet; build order step 6 (implementation on a branch) is the next caller.

**Verification:** `npm run typecheck`, `npm test` (fixture executors only, zero live network calls), `npm run check:docs`. Completion gate: `npm ci && npm run typecheck && npm test && npm run check:docs` from a clean checkout, every break-it run recorded, plus one manual smoke against the real `claude` binary whose output is recorded in the task evidence.

---

### Task 1: The model map, frozen at run start

**Depends on:** None

**Files:**
- Modify: `src/profile.ts` — `Profile`, `freezeProfile`
- Modify: `src/cli.ts` — `new-run --model`, `spec --model` optional
- Modify: `src/spec-stage.ts` — read the model from the profile
- Modify: `test/profile.test.ts`, `test/cli.test.ts`, `test/spec-stage.test.ts`

**Steps:**

- [ ] **Step 1: the map in the profile**
  - Change: `Profile` gains `modelMap: Record<string, string>`. `freezeProfile` takes a `model: string` argument and records `{ spec: model, spec_review: model, plan: model, plan_review: model }` — one entry per stage kind that exists today, all resolving to the same configured model because there is one model to configure. The shape is a map because section 10 requires a stage to name what it needs; the values coincide until there is a reason for them not to.
  - Change: Export `resolveStageModel(profile: Profile, stageKind: string): { ok: true; model: string } | { ok: false; reason: string }`, refusing with `no model configured for stage ${stageKind}: the profile frozen at run start maps ${Object.keys(profile.modelMap).join(", ")}`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 2: `new-run --model`, required**
  - Change: `src/cli.ts`'s `new-run` case reads `required(args, "model")` and passes it to `freezeProfile`. Update `USAGE` to `new-run --project <p> --feature <f> --slug <s> --change-kind <k> --model <name>`.
  - Change: Update every `new-run` invocation in `test/cli.test.ts` to pass `--model`. Add a case asserting `new-run` without `--model` exits 2 naming the option.
  - Verify: `node --test test/cli.test.ts`
  - Expected: all pass, including the new missing-option case.

- [ ] **Step 3: the stage reads the frozen model**
  - Change: `runSpecStage`'s input `requestedModel` becomes `requestedModel?: string`. After loading the run, load the profile and call `resolveStageModel(profile, "spec")`. When `requestedModel` is supplied and differs from the frozen value, abort with `--model ${requestedModel} does not match the model frozen at run start (${frozen}): config is frozen at run start`. When omitted, use the frozen value.
  - Change: `src/cli.ts`'s `spec` case passes `args.get("model")` rather than `required(args, "model")`, and `USAGE` shows `--model` as optional.
  - Verify: `node --test test/spec-stage.test.ts test/cli.test.ts`
  - Expected: all pass. Add a case asserting the mismatch is refused by name, and one asserting the omitted flag resolves from the profile.

- [ ] **Step 4: a stage with no model fails at configuration time**
  - Change: Add a `test/profile.test.ts` case asserting `resolveStageModel` refuses an unmapped stage kind naming the mapped ones. Add a `test/spec-stage.test.ts` case that freezes a profile whose `modelMap` omits `spec` (write the profile directly, as the hardening plan's policy-drift test does, so the profile hash stays self-consistent) and asserts `runSpecStage` refuses **before** any dispatch — no `agent_run` row exists afterwards.
  - Verify: `node --test test/profile.test.ts test/spec-stage.test.ts`
  - Expected: all pass. Section 10's requirement is that this failure precedes the invocation, and the absent `agent_run` row is the proof.

**Task completion evidence:** the model is frozen at `new-run`, a mismatched `--model` is refused by name, and an unmapped stage fails before spending anything.

### Task 2: The plan document schema

**Depends on:** None

**Files:**
- Create: `src/plan-doc.ts`
- Create: `test/plan-doc.test.ts`

**Steps:**

- [ ] **Step 1: the types and the validator**
  - Change: `src/plan-doc.ts` exports `interface CoverageEntry { criterion: string; artifact: string | null; rationale: string | null; alternativeVerification: string | null }` and `interface PlanDoc { feature: string; planFor: string; tasks: string[]; coverage: CoverageEntry[] }`, plus `validatePlanDoc(content: string): { ok: true; value: PlanDoc } | { ok: false; reason: string }`. It mirrors `src/spec-doc.ts`'s structure, reusing its private `section()` approach.
  - Change: Refusals, each naming its cause: missing `feature:` frontmatter; missing or non-64-hex `plan_for:`; missing `## Tasks` section; empty task list; missing `## Coverage` section; empty coverage list; a coverage line matching neither `<criterion> -> <path>` nor the `not_applicable` form; a `not_applicable` entry missing its rationale or its alternative verification (message: `coverage entry for ${criterion} says not_applicable without both a rationale and an alternative verification`).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 2: the writer**
  - Change: `writePlanDoc(rootDir, slug, content): { path: string; doc: PlanDoc }`, validating then writing to `docs/features/<slug>/plan.md`, exactly as `writeSpecDoc` does for `spec.md`. Note in a comment that this path is also where a human-authored implementation plan would live for this repository's own work; the system owns the file for a governed run, and the two never share a slug.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 3: one test per refusal**
  - Change: `test/plan-doc.test.ts` covers a valid document and every refusal above, asserting the exact reason string. Include a `not_applicable` entry that is well formed and one missing each half.
  - Verify: `node --test test/plan-doc.test.ts`
  - Expected: all pass.

- [ ] **Step 4: prove a guard by breaking it**
  - Change: Temporarily accept a `not_applicable` entry with no alternative verification; confirm that test fails; restore.
  - Verify: `node --test test/plan-doc.test.ts`
  - Expected: the named test fails on the break and passes on restore.

**Task completion evidence:** `test/plan-doc.test.ts` green, with the `not_applicable` guard seen failing when broken.

### Task 3: The plan author agent and the two prompts

**Depends on:** Task 2

**Files:**
- Create: `src/agents/plan-author.ts`
- Modify: `src/agents.ts` — register it
- Modify: `src/prompts.ts` — `buildPlanAuthorPrompt`, `buildPlanReviewPrompt`
- Modify: `test/agents.test.ts`, `test/prompts.test.ts`

**Steps:**

- [ ] **Step 1: the agent, and the disallowed-output test first**
  - Change: `src/agents/plan-author.ts` defines `PLAN_AUTHOR` with `id: "plan-author"`, `role: "author"`, `specialty: null`, `executor: "claude-code"`, `outputs: ["plan", "plan-revision"]`, `tools: []`. Register it in `src/agents.ts`.
  - Change: `test/agents.test.ts` asserts `agentById("plan-author").outputs` does not include `"spec"`, that no reviewer's `outputs` includes `"plan"`, and that the seeded reviewers can staff a standard-risk plan panel (hazard 11). Section 9 says a dispatcher that derives the required output from the result kind rather than the performer fails with "configured agent does not allow plan output" and that the test asserting refusal should be written first — this is that test.
  - Verify: `node --test test/agents.test.ts`
  - Expected: passes.

- [ ] **Step 2: the author prompt**
  - Change: `buildPlanAuthorPrompt(agent, specContent, specHash, scope, context?)` in `src/prompts.ts`, following `buildSpecAuthorPrompt`'s shape: the role line, the approved specification verbatim, the signed scope as the paths the plan may name, the AgentResult envelope with every field stated, and the plan document schema with `plan_for` set to the given `specHash`. It states, in the prompt text: the `status` enum; that output goes in `proposedContentChanges.plan`; the `## Tasks` and `## Coverage` section headings; the two coverage forms including that `not_applicable` requires both a rationale and an alternative verification; and that no git operations are involved, because this is a content write and the step-3 smoke showed that mentioning patch concepts makes the model refuse to produce a document.
  - Change: The revision variant opens with a `## Revision` heading carrying the open material findings, exactly as the spec author's does — hazard 7 requires the retry to vary.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 3: the reviewer prompt**
  - Change: `buildPlanReviewPrompt(agent, planContent, specContent)` following `buildSpecReviewPrompt`: it names the reviewing agent, gives both documents, and states the finding constraints — severity `low, medium, high, critical`; `intentKey` lowercase kebab-case within 64 characters; findings returned in `proposedContentChanges.findings`; the full envelope shape with every field, because the step-3 smoke showed a reviewer returns a bare findings object until the prompt states the whole envelope.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 4: the constrained-field scan covers the new prompts**
  - Change: `test/prompts.test.ts`'s `CONSTRAINT_STRINGS` gains the plan schema's constrained values (`## Tasks`, `## Coverage`, `not_applicable`, `proposedContentChanges.plan`). Add generated-prompt assertions for both builders mirroring the existing spec ones. Do **not** add patch-rule strings: the plan stage is a content write, and the array's own comment reserves those for the step whose prompts request patches.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: all pass.

**Task completion evidence:** `test/agents.test.ts` and `test/prompts.test.ts` green; the disallowed-output assertion fails if `"plan"` is added to a reviewer's `outputs`.

### Task 4: The unkeepable-promise gate

**Depends on:** Task 2

**Files:**
- Create: `src/plan-gate.ts`
- Create: `test/plan-gate.test.ts`

**Steps:**

- [ ] **Step 1: the two gate functions**
  - Change: `src/plan-gate.ts` exports `planReviewGate(findings: FindingRow[])`, identical in contract to `specReviewGate` — passes iff no material finding remains open — and `coverageFitsScope(doc: PlanDoc, scope: string[]): { ok: true } | { ok: false; unkeepable: string[] }`, which returns the criteria whose coverage names an artifact outside the run's signed scope.
  - Change: Comment precisely what this does and does not check: it is the mechanically decidable half of hazard 6 and section 12's "refuse promises that cannot be kept". The other half — a criterion whose artifacts are produced by a stage that runs *after* the one being planned — is not decidable until stages declare the artifacts they produce, which nothing does yet. Stating the limit is the point; a comment claiming full hazard-6 coverage would be false.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 2: tests including the `not_applicable` interaction**
  - Change: `test/plan-gate.test.ts` covers: coverage entirely inside the scope passes; an artifact outside the scope is returned as unkeepable and named; a `not_applicable` entry is **never** unkeepable, because it promises no artifact — it carries a rationale and an alternative verification instead, which section 8 says is preferable to a fabricated test; a mix returns only the offending criteria. `planReviewGate` gets the same open/resolved/severity cases `specReviewGate` has.
  - Verify: `node --test test/plan-gate.test.ts`
  - Expected: all pass.

- [ ] **Step 3: prove the guard by breaking it**
  - Change: Temporarily treat an out-of-scope artifact as acceptable; confirm the unkeepable test fails; restore.
  - Verify: `node --test test/plan-gate.test.ts`
  - Expected: the named test fails on the break and passes on restore.

**Task completion evidence:** an out-of-scope promise is refused deterministically; a `not_applicable` entry passes the same gate.

### Task 5: The plan and plan_review stages

**Depends on:** Task 1, Task 2, Task 3, Task 4

**Files:**
- Create: `src/plan-stage.ts`
- Create: `test/plan-stage.test.ts`
- Create: `test/fixtures/harness/emit-plan-stage.mjs`

**Steps:**

- [ ] **Step 1: preconditions and the chain**
  - Change: `runPlanStage(store, executor, { runId, requestedModel?, rootDir })` in `src/plan-stage.ts`. It refuses, each by name: a nonexistent run; a run whose status is not `in_progress`; a run whose last stage is not a **passed** `awaiting_approval`; a run that already has a `plan` stage. It reads the approved spec from that stage's `output_ref`, the signed scope from the run's `approval` row (`JSON.parse` of the `scope` column), and the model from the frozen profile via `resolveStageModel(profile, "plan")`. It creates the `plan` stage chained from the `awaiting_approval` row, so `stage.input_stage_id` carries the handoff section 4 requires.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 2: author, validate, content write**
  - Change: Dispatch `plan-author` through `dispatchOnce`, refusing before dispatch if `outputs` does not include `"plan"`. Parse with `extractJsonBody`, validate with `validateAgentResult`, require `status === "proposed"`, require `proposedContentChanges.plan` to be a string, then `writePlanDoc`. Refuse when the written document's `plan_for` does not equal the spec hash the stage computed — the plan must declare which specification it was written from, and a mismatch means it was written from another one.
  - Change: Every failure path is terminal, matching `runSpecStage`: the stage completes blocked with no approved `output_ref`, the run blocks, an audit event names the reason, and raw output is already retained by `dispatchOnce`. Wrap the whole body in the same try/catch wedge guard `runSpecStage` uses.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 3: the coverage gate, before the panel**
  - Change: Run `coverageFitsScope` immediately after the content write. On failure, block the `plan` stage naming the unkeepable criteria. It runs before the panel because it is deterministic and free: refusing here saves a full panel's invocations on a plan that cannot pass.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 4: the panel, findings, and closure rounds**
  - Change: Create the `plan_review` stage chained from `plan`. Size the panel with `computeRisk` over the same inputs the approval bound — `run.change_kind`, `computeScope(spec declared artifacts).length`, and `touchesProtected(...)` — so the plan panel and the spec panel are sized on the same basis. Select with `selectReviewers`, refuse if the panel is short, then run bounded rounds: dispatch each reviewer, validate the envelope, validate every finding field (location, `intentKey` shape, severity enum, subject), insert findings with the normalized location, resolve by re-review, and decide with `planReviewGate`. On budget exhaustion, block naming the still-open finding ids. Between rounds, re-dispatch the author with the open material findings so the retry varies (hazard 7).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 5: the fixture executor and the stage tests**
  - Change: `test/fixtures/harness/emit-plan-stage.mjs` mirrors `emit-spec-stage.mjs`, emitting an `AgentResult`-shaped envelope driven by an environment variable so one fixture serves the author, the reviewers, and the revision rounds.
  - Change: `test/plan-stage.test.ts` covers the success path end to end (both stage rows, `output_ref` set to the plan path, gate `pass`, audit chain valid); each precondition refusal; a plan whose `plan_for` does not match; an out-of-scope coverage promise blocking before any reviewer is dispatched (assert the reviewer `agent_run` count is zero — the proof that the free gate ran first); budget exhaustion blocking and naming finding ids; and a reviewer returning a non-`proposed` status blocking rather than passing by absence.
  - Verify: `node --test test/plan-stage.test.ts`
  - Expected: all pass.

- [ ] **Step 6: prove the terminal paths by breaking them**
  - Change: For each of — the coverage gate, the `plan_for` check, the panel-size check, and the closure budget — break the guard, confirm the named test fails, restore.
  - Verify: `node --test test/plan-stage.test.ts` after each
  - Expected: exactly the named test fails on each break; green after each restore.

**Task completion evidence:** the two stage rows chain from `awaiting_approval`, every failure path is terminal, and four break-it runs are recorded.

### Task 6: The CLI surface

**Depends on:** Task 5

**Files:**
- Modify: `src/cli.ts` — `bw plan`, `USAGE`, `known`
- Modify: `test/cli.test.ts`

**Steps:**

- [ ] **Step 1: the command**
  - Change: Add `plan` to `known` and to `USAGE` as `plan --run <id> [--model <name>]    run the plan and plan_review stages`. The case calls `runPlanStage` with `runId: numeric(args, "run")`, `requestedModel: args.get("model")`, and `rootDir: process.cwd()`, printing the plan path on success and the reason to stderr with exit 1 on failure — the same shape as the `spec` case.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 2: CLI tests**
  - Change: `test/cli.test.ts` adds: `plan --run 9999` exits 1 naming the run and creates no `.governance/raw` directory (no spawn); `plan` without `--run` exits 2 naming the option; and a walk that creates a run, drives it to a passed `awaiting_approval` through the store, then runs `plan` against the fixture executor and asserts exit 0 with the plan path on stdout.
  - Verify: `node --test test/cli.test.ts`
  - Expected: all pass.

**Task completion evidence:** `bw plan` refuses bad input before spending and completes a fixture-backed run end to end.

### Task 7: Documentation, the smoke, and the gate

**Depends on:** Task 6

**Files:**
- Modify: `CLAUDE.md` — the commands line
- Modify: `README.md` — the status paragraph
- Modify: `.claude/sessions/project-learnings.md`

**Steps:**

- [ ] **Step 1: the commands line**
  - Change: `CLAUDE.md`'s `node src/cli.ts ...` line gains `plan`. Verify by comparing the documented list against `src/cli.ts`'s `known` array — the two must agree exactly, as they were made to at the end of step 4.
  - Verify: read both back and compare
  - Expected: no command in one and absent from the other.

- [ ] **Step 2: the status paragraph**
  - Change: `README.md`'s Status section extends to steps 1-5, naming the plan stage and its unkeepable-promise gate in one clause.
  - Verify: `npm run check:docs`
  - Expected: `OK: documentation facts verified`. The checker reads `ARCHITECTURE.md`, so this confirms the README edit broke no documented fact; the stage sequence assertion already covers `plan` and `plan_review`.

- [ ] **Step 3: the manual smoke**
  - Change: Run one real end-to-end plan stage against the `claude` binary on a small design, and record in this plan's evidence: the model requested and effective, the cost from the envelope, whether the author returned a valid plan document on the first attempt, and every prompt defect the smoke exposed. Iterate the prompts against the real output — the step-3 entry in `.claude/sessions/project-learnings.md` records that fixtures could not have found its two prompt defects, and there is no reason to expect otherwise here.
  - Verify: `node src/cli.ts plan --run <id>` against a real run
  - Expected: either a passed `plan_review` or a designed terminal block. A block is an acceptable outcome and must be reported as one, not retried until it passes.

- [ ] **Step 4: the completion gate**
  - Verify: `npm ci && npm run typecheck && npm test && npm run check:docs`
  - Expected: all four exit 0 from a clean install, with every automated test using fixture executors only.

- [ ] **Step 5: record the learnings**
  - Change: Append an entry to `.claude/sessions/project-learnings.md` covering what the smoke exposed, the enum and schema choices this plan made that the architecture left open, and the state of the spec/plan stage duplication with a recommendation for whether step 6 should extract the shared shape.
  - Verify: read the entry back
  - Expected: it names the smoke's real output, not a summary of intent.

**Task completion evidence:** the full gate is green, the smoke is recorded with its real cost and outcome, and the documented command list matches the CLI.
