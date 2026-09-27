# Stage Role Model Overrides Implementation Plan

**Status:** Proposed

**Goal:** Let `bw new-run` freeze a different model for the reviewer role,
and (where the role exists) the reconciler/implementer role, independently
of the run's base author model, instead of one `--model` value covering
every dispatch in every stage.

**Source:** Operator request in this conversation, arising from investigating
why the note-keeper target repository's `spec_review` stage produced a
different severity verdict on the same disclosed gap (export-archive access
control, attachment content-type/disposition, password-reset token security)
across six runs, all on `claude-sonnet-5`. The operator wants to run the
reviewer role on a cheaper model (e.g. Haiku) while keeping the role that
acts on findings (reconciler for spec/plan, remediation implementer for
code_review) on a strong model, and wants this parameterized rather than
hard-coded. Scope was narrowed twice in conversation:
1. All three review stages (spec_review, plan_review, code_review) get
   independently configurable models — not just spec_review.
2. code_review has no LLM reconciler (disposition there is the deterministic
   `decideCodeReviewRound`, not a model call) — operator's explicit decision:
   "If there is no reconciler in the code review, then just leave it. I dont
   want to add any more models to code review, only to have the models used
   parameterized." So code_review gets its two *existing* roles (reviewer
   panel, remediation implementer) split into independently configurable
   keys; no third slot is invented there.

**Assumptions:**
- Guided mode (`src/guided-command.ts` / `buildworks [<path>]`) is out of
  scope. It continues to prompt for one model and pass no overrides, which
  is unaffected because every new override defaults to the base model when
  absent — same behavior it has today. Only the low-level `new-run` command
  gains the new flags. (Not settled with the operator explicitly, but follows
  directly from "only to have the models used parameterized" plus the fact
  that every experiment discussed in this conversation used the low-level
  path.)
- The self-critique dispatch (author role, same agent as the draft) stays
  tied to the stage's base author model (`spec` / `plan`), not a new key.
  The operator's ask was scoped to "reviewer" and "reconciler," not
  self-critique, and self-critique is the author re-examining its own draft,
  not an independent lens.

**Approach:** Add three brand-new keys to the frozen profile's `modelMap`
(`spec_reconcile`, `plan_reconcile`, `code_review_implementer`) alongside the
six that exist today, all defaulting to the run's base `--model` unless an
operator override is given. None of the three new keys is a `stage.kind`
value — they are pure model-resolution keys the orchestrator functions
consult by string literal at the exact dispatch that needs them, so
`doc-check`'s `PINNED_SEQUENCE` (the real `stage.kind` sequence) and the
`dispatch` CLI command's `resolveStageModel(profile, stage.kind)` lookup are
both unaffected — verified in Blast radius below. `new-run` gains six new
optional flags (`--spec-review-model`, `--spec-reconcile-model`,
`--plan-review-model`, `--plan-reconcile-model`, `--code-review-model`,
`--code-review-implementer-model`), each validated with the same
`validateModelName` the base `--model` already uses, each defaulting to the
base model when omitted — so an operator who passes none of them gets
today's exact behavior (one model, six identical entries, now nine).

**Affected areas:** `src/profile.ts` (frozen schema + `freezeProfile`),
`src/spec-stage.ts` and `src/plan-stage.ts` (resolve and use the new
`*_reconcile` key for the reconciliation dispatch only — the draft and
self-critique dispatches are unchanged), `src/code-review-stage.ts` (resolve
and use the new `code_review_implementer` key for the remediation dispatch
only — the reviewer panel dispatch keeps using `code_review`),
`src/operator-state.ts` (extend the pre-flight readiness check to cover the
new keys), `src/cli-args.ts` and `src/cli.ts` (`new-run`'s new flags),
`src/run-intake.ts` (thread the overrides through), plus tests and docs.

**Known blockers:** None found. `governed.yaml`, migrations, and the
`stage.kind` enum (`docs/hazards.md` hazard 11/12 territory) are untouched —
confirmed by reading `src/migrations/001_init.sql`'s `stage` table (no
`CHECK` constraint on `kind`) and `scripts/doc-check.mjs`'s `PINNED_SEQUENCE`
(lists actual `stage.kind` values only: spec, spec_review, plan, plan_review,
implementation, code_review — none of the three new keys belongs there,
since none of them is ever written to the `stage.kind` column).

**Blast radius:** Every caller of `resolveStageModel` was enumerated by
search (`grep -rn resolveStageModel src`) and each is accounted for below:
- `src/spec-stage.ts:99,108` — the two existing resolves (`spec`, `spec_review`);
  Task 2 adds a third (`spec_reconcile`) at the point the reconciliation
  dispatch is built (currently line ~513-524).
- `src/plan-stage.ts:117,126` — same shape; Task 3 adds `plan_reconcile` at
  the reconciliation dispatch (currently line ~618-629).
- `src/code-review-stage.ts:108` — the one existing resolve (`code_review`,
  used today by *both* the reviewer dispatch at line ~400-412 and the
  remediation dispatch at line ~606-613); Task 4 adds a second resolve
  (`code_review_implementer`) and repoints only the remediation dispatch at
  it — the reviewer dispatch keeps consuming `code_review`.
- `src/implementation-stage.ts:93` — resolves `implementation`; untouched,
  no new role exists in that stage.
- `src/operator-state.ts:474` (`frozenGroupReasons`) — the pre-flight
  readiness check that currently checks `[group, "${group}_review"]` for
  spec/plan and `[group]` for implementation/code_review; Task 5 extends
  the spec/plan list with the `_reconcile` key and gives code_review its own
  branch that also checks `code_review_implementer`.
- `src/cli.ts:278` (`case "dispatch"`) — resolves by `stage.kind` directly,
  a raw single-agent dispatch tool with no role concept. Confirmed by full
  read (lines 246-321): it never consults a role-specific key today (the
  reviewer's `spec_review`/`plan_review`/`code_review` entries are already
  invisible to it whenever the caller dispatches a `spec`/`plan`-kind stage
  row), so the three new keys — which are not `stage.kind` values — reach it
  the same way: never. No change needed here.
- `requireFrozenBinding`/`requiredCapability` (`src/profile.ts:378-430`) —
  confirmed by full read that capability binding is checked once per stage
  kind before *any* of that stage's dispatches (e.g. `spec-stage.ts:127`
  checks the `spec` capability once, before the draft, self-critique, *and*
  reconciliation dispatches). The new keys select a model for an
  already-capability-checked dispatch; they need no new capability and no
  change to `requiredCapability`.
- `invalidProfileReason` (`src/profile.ts:268-322`) — checks only that
  `modelMap` is *an object*, not its specific keys; no change needed.
- Every test file calling `freezeProfile` (confirmed exhaustive by
  `grep -rn "freezeProfile(" test/`): `test/profile.test.ts`,
  `test/spec-stage.test.ts`, `test/plan-stage.test.ts`,
  `test/code-review-stage.test.ts` (5 or 6 positional args, some with a
  `deps` object), and `test/dashboard-server.test.ts:129` (5 positional
  args, no `deps`). Task 1 appends the new overrides parameter *after*
  `deps`, both new parameters defaulting to `{}`, so every one of these
  existing calls — 5-argument or 6-argument — needs no change.
- `createRunIntake` callers (`grep -rn createRunIntake` → `src/cli.ts`,
  `src/guided-command.ts`, `test/run-intake.test.ts`,
  `test/guided-command.test.ts`): the new `modelOverrides` field on
  `RunIntakeInput` is optional; `guided-command.ts` and its test are
  confirmed unaffected (neither is edited by this plan).
- Display: `src/operator-output.ts:55` prints
  `JSON.stringify(snapshot.configuration.modelMap)` — a generic passthrough
  with no hardcoded key list, confirmed by read; the three new keys appear
  automatically with no code change.
- Docs: `README.md:69-71`, `CLAUDE.md` and `AGENTS.md`'s `new-run` bullet
  (identical wording, confirmed present in both), `ARCHITECTURE.md` section
  10 ("Model configuration").

**Verification:** `npm run typecheck`, `npm test`, `npm run check:docs`, plus
the concrete per-task checks below (each names the exact assertion and
expected result).

**Hazards considered:** 10 (exact-match model acceptance against moving
aliases) — not triggered; `validateModelName` checks shape only, and every
new key is frozen at run start and read back verbatim, exactly like the
existing six. 11 (a default installation that cannot complete a run) — the
new keys always default to the already-validated base model, so a default
installation that passes no override behaves exactly as it does today, and
Task 1 adds an explicit `freezeProfile` refusal test for an invalid override
matching the existing pattern for staffing-shortfall refusals. 12
(configuration divergence between targets, and making effective
configuration visible) — satisfied by construction: `operator-output.ts`'s
generic `modelMap` passthrough already surfaces the new keys with no code
change (see Blast radius). 14 (independence that cannot be proven) —
considered and not applicable: that hazard is about process separation
(subagent-in-session vs. separately spawned process), which `dispatchOnce`
already guarantees per-dispatch regardless of which model string is passed;
giving the reviewer a different model from the author does not touch that
guarantee either way.

---

### Task 1: Extend the frozen profile schema with three new model-map keys

**Depends on:** None

**Files:**
- Modify: `src/profile.ts` — the `Profile.modelMap` doc comment, a new
  exported `StageModelOverrides` interface, `freezeProfile`
- Validate: `test/profile.test.ts`

**Steps:**

- **Step 1: Add the `StageModelOverrides` type and update the doc comment**
  - Change: Above the `Profile` interface's `modelMap` field
    (`src/profile.ts:36-45`), update the comment — it currently says "There
    is one model to configure, so every entry currently holds it; the shape
    is what lets that stop being true without a schema change." Replace the
    second clause: this plan is the moment that stops being true for three
    of the nine entries. Add a new exported interface directly above
    `freezeProfile` (near the `MODEL_NAME`/`validateModelName` block, e.g.
    after line 121):
    ```ts
    /**
     * Optional per-role model overrides, each defaulting to the run's base
     * model when omitted. `specReconcile`/`planReconcile` select the model
     * for the reconciliation dispatch only — the draft and self-critique
     * dispatches always use the base model. `codeReview` selects the
     * reviewer panel's model; `codeReviewImplementer` selects the
     * remediation dispatch's model. code_review has no reconciler role
     * (disposition there is `decideCodeReviewRound`, a deterministic
     * function, not a dispatch), so there is no third code_review entry.
     */
    export interface StageModelOverrides {
      specReview?: string;
      specReconcile?: string;
      planReview?: string;
      planReconcile?: string;
      codeReview?: string;
      codeReviewImplementer?: string;
    }
    ```
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean (new exported type, no consumer yet).

- **Step 2: Thread overrides through `freezeProfile` and populate the three new keys**
  - Change: In `src/profile.ts`, add a new parameter to `freezeProfile`
    *after* the existing `deps` parameter (so no existing positional call
    site breaks):
    ```ts
    export function freezeProfile(
      rootDir: string,
      runId: number,
      startingCommit: string | null,
      model: string,
      verification: VerificationConfig,
      deps: { agents?: readonly AgentDefinition[] } = {},
      overrides: StageModelOverrides = {}
    ): { path: string; hash: string; profile: Profile } {
    ```
    Immediately after the existing `validateModelName(model)` check, validate
    every override value that was actually supplied:
    ```ts
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      const overrideError = validateModelName(value);
      if (overrideError !== null) {
        throw new Error(`invalid --${key} override: ${overrideError}`);
      }
    }
    ```
    Change the `modelMap` literal (currently `spec, spec_review, plan,
    plan_review, implementation, code_review`) to, in exactly this key
    order (later tasks' test regexes depend on this order matching
    `Object.keys(profile.modelMap)`):
    ```ts
    modelMap: {
      spec: model,
      spec_review: overrides.specReview ?? model,
      spec_reconcile: overrides.specReconcile ?? model,
      plan: model,
      plan_review: overrides.planReview ?? model,
      plan_reconcile: overrides.planReconcile ?? model,
      implementation: model,
      code_review: overrides.codeReview ?? model,
      code_review_implementer: overrides.codeReviewImplementer ?? model,
    },
    ```
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 3: Update the pinned model-map test and add override coverage**
  - Change: In `test/profile.test.ts`, update "the profile freezes one
    model entry per stage kind" (line ~176-189): its `assert.deepEqual`
    must list all nine keys in the Step 2 order, all equal to
    `"chosen-model"` (no override was passed). Update "resolveStageModel
    refuses an unmapped stage kind naming the mapped ones" (line ~191-202):
    its second `assert.match` currently expects
    `/spec, spec_review, plan, plan_review, implementation, code_review/` —
    change it to match the new nine-key joined string in the Step 2 order:
    `spec, spec_review, spec_reconcile, plan, plan_review, plan_reconcile, implementation, code_review, code_review_implementer`.
    Add two new tests after it:
    ```ts
    test("freezeProfile applies per-role overrides, defaulting the rest to the base model", () => {
      withRoot((root) => {
        const { profile } = freezeProfile(root, 1, COMMIT, "base-model", VERIFICATION, {}, {
          specReview: "review-model",
          codeReviewImplementer: "implementer-model",
        });
        assert.deepEqual(profile.modelMap, {
          spec: "base-model",
          spec_review: "review-model",
          spec_reconcile: "base-model",
          plan: "base-model",
          plan_review: "base-model",
          plan_reconcile: "base-model",
          implementation: "base-model",
          code_review: "base-model",
          code_review_implementer: "implementer-model",
        });
      });
    });

    test("freezeProfile refuses an invalid override model name and writes nothing", () => {
      withRoot((root) => {
        assert.throws(
          () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, {}, { specReview: "bad model" }),
          /invalid --specReview override: invalid model name "bad model"/
        );
        assert.equal(
          existsSync(join(root, ".governance", "profiles", "1", "profile.json")),
          false,
          "nothing may be written when an override is refused"
        );
      });
    });
    ```
  - Verify: `npm test -- --test-name-pattern="profile"`
  - Expected: every `profile.test.ts` test passes, including the two new ones.

**Task completion evidence:** `npm run typecheck` and
`npm test -- --test-name-pattern="profile"` both pass.

---

### Task 2: Use `spec_reconcile` for the spec stage's reconciliation dispatch

**Depends on:** Task 1

**Files:**
- Modify: `src/spec-stage.ts`
- Validate: `test/spec-stage.test.ts`

**Steps:**

- **Step 1: Resolve the reconcile model alongside the existing two resolves**
  - Change: In `runSpecStage` (`src/spec-stage.ts`), immediately after the
    existing `resolvedReviewModel` block (lines 108-111), add:
    ```ts
    const resolvedReconcileModel = resolveStageModel(profile, "spec_reconcile");
    if (!resolvedReconcileModel.ok) {
      return { ok: false, reason: resolvedReconcileModel.reason };
    }
    ```
    After the line `const reviewModel = resolvedReviewModel.model;` (line
    121), add `const reconcileModel = resolvedReconcileModel.model;`. No
    new `requireFrozenBinding` call — the existing `binding` check for
    `"spec"` (line 127-130) already covers the author capability for every
    dispatch this stage makes under that stage kind, including
    reconciliation.
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 2: Point the reconciliation dispatch at the new model**
  - Change: The reconciliation dispatch inside the round loop
    (`src/spec-stage.ts`, currently `requestedModel: model` at line ~520)
    changes to `requestedModel: reconcileModel`. The draft dispatch (line
    ~211) and the self-critique dispatch (line ~275) keep
    `requestedModel: model` — unchanged.
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 3: Add a test proving the reconcile dispatch uses the override**
  - Change: In `test/spec-stage.test.ts`, add a `refreeze` helper mirroring
    the one already in `test/code-review-stage.test.ts` (lines 126-137) —
    add the import `loadProfile, type Profile` to the existing
    `import { freezeProfile, loadVerifiedProfile } from "../src/profile.ts";`
    line, then:
    ```ts
    function refreeze(root: string, store: Store, runId: number, mutate: (p: Profile) => void): void {
      const { profile } = loadProfile(root, runId);
      mutate(profile);
      profile.policyHash = policyHash(profile.policy);
      const serialized = canonicalJson(profile);
      writeFileSync(join(root, ".governance", "profiles", String(runId), "profile.json"), serialized);
      store.setProfileRef(runId, sha256Hex(serialized));
    }
    ```
    Add a new test using `withRun` (the file's existing helper) that calls
    `refreeze(root, store, runId, (p) => { p.modelMap.spec_reconcile = "reconcile-model"; })`
    before invoking `runSpecStage`, runs the stage to a passing gate the
    way the file's existing happy-path test does (reusing the same `FIXTURE`
    dispatch script and pattern already used by the surrounding tests in
    this file), then asserts:
    ```ts
    const rows = store.query<{ role: string; requested_model: string }>(
      "SELECT role, requested_model FROM agent_run WHERE stage_id = ? ORDER BY id", [specStageId]
    );
    const authorRows = rows.filter((r) => r.role === "author");
    assert.equal(authorRows.length, 3); // draft, self-critique, reconciliation
    assert.equal(authorRows[0].requested_model, "m");
    assert.equal(authorRows[1].requested_model, "m");
    assert.equal(authorRows[2].requested_model, "reconcile-model");
    ```
    (`specStageId` is the id returned in `result.stageIds.spec` from the
    stage's `StageResult`.) `"m"` is the base model `withRun` already
    freezes (`src/... freezeProfile(root, run.id, head, "m", VERIFICATION)`
    at line 121 of the test file) — unchanged by this test.
  - Verify: `npm test -- --test-name-pattern="spec"`
  - Expected: the new test passes; every pre-existing test in the file
    still passes unchanged (they never set `spec_reconcile`, so it defaults
    to `"m"`, matching what those tests already assert about `requestedModel`).

**Task completion evidence:** `npm run typecheck` and
`npm test -- --test-name-pattern="spec"` both pass.

---

### Task 3: Use `plan_reconcile` for the plan stage's reconciliation dispatch

**Depends on:** Task 1

**Files:**
- Modify: `src/plan-stage.ts`
- Validate: `test/plan-stage.test.ts`

**Steps:**

- **Step 1: Resolve the reconcile model alongside the existing two resolves**
  - Change: Mirror Task 2 Step 1 exactly, in `runPlanStage`
    (`src/plan-stage.ts`), after the existing `resolvedReviewModel` block
    (lines 126-129): add the `resolvedReconcileModel = resolveStageModel(profile, "plan_reconcile")`
    check, and `const reconcileModel = resolvedReconcileModel.model;` after
    line 137. No new binding check, for the same reason as Task 2 Step 1
    (the existing `"plan"` binding at lines 143-146 already covers every
    author-role dispatch in this stage).
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 2: Point the reconciliation dispatch at the new model**
  - Change: The reconciliation dispatch inside the round loop
    (`src/plan-stage.ts`, currently `requestedModel: model` at line ~625)
    changes to `requestedModel: reconcileModel`. The draft dispatch (line
    ~283) and self-critique dispatch (line ~367) keep `requestedModel: model`.
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 3: Add a test proving the reconcile dispatch uses the override**
  - Change: Mirror Task 2 Step 3 exactly for `test/plan-stage.test.ts`: add
    the same `refreeze` helper (import `loadProfile, type Profile` alongside
    the existing `freezeProfile, loadVerifiedProfile` import), set
    `p.modelMap.plan_reconcile = "reconcile-model"` before calling
    `runPlanStage`, then assert the three `role="author"` `agent_run` rows
    for the plan stage are `[MODEL, MODEL, "reconcile-model"]` in id order
    (`MODEL` is the file's existing `const MODEL = "m"` at line 20).
  - Verify: `npm test -- --test-name-pattern="plan"`
  - Expected: the new test passes; every pre-existing test in the file
    still passes unchanged.

**Task completion evidence:** `npm run typecheck` and
`npm test -- --test-name-pattern="plan"` both pass.

---

### Task 4: Split code_review's reviewer and implementer models

**Depends on:** Task 1

**Files:**
- Modify: `src/code-review-stage.ts`
- Validate: `test/code-review-stage.test.ts`

**Steps:**

- **Step 1: Resolve the implementer model alongside the existing resolve**
  - Change: In `runCodeReviewStage` (`src/code-review-stage.ts`),
    immediately after the existing `resolvedModel`/`model` block (lines
    108-116), add:
    ```ts
    const resolvedImplementerModel = resolveStageModel(profile, "code_review_implementer");
    if (!resolvedImplementerModel.ok) return { ok: false, reason: resolvedImplementerModel.reason };
    const implementerModel = resolvedImplementerModel.model;
    ```
    No new binding check — the existing `binding` check for `"code_review"`
    (line 117-118) already covers this stage's one capability requirement
    (`review`) for every dispatch it makes, reviewer and implementer alike;
    `requiredCapability` maps all three review kinds to the same `"review"`
    capability, and the implementer's own agent-shape check (`author.role
    !== "author"`, etc., lines 263-270) is unrelated to capability binding.
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 2: Point the remediation dispatch at the new model**
  - Change: The remediation implementer dispatch (currently
    `requestedModel: model` at line ~613, inside the `authorDispatch` call)
    changes to `requestedModel: implementerModel`. The reviewer panel
    dispatch (line ~407, inside the `reviewerPromises` map) keeps
    `requestedModel: model` — `model` now means specifically "the reviewer
    panel's model," which is exactly what `resolveStageModel(profile,
    "code_review")` already resolves.
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 3: Add a test proving the remediation dispatch uses the override**
  - Change: In `test/code-review-stage.test.ts`, using the file's existing
    `refreeze` helper (lines 126-137, already present — no new helper
    needed here), find or add a test exercising a round that reaches
    remediation (one already exists for the remediation path — locate it by
    searching for `code_review.remediation.pass` or the existing
    `authorDispatch`-exercising test in this file) and add, right before
    the stage call, `refreeze(ctx.root, ctx.store, ctx.runId, (p) => { p.modelMap.code_review_implementer = "implementer-model"; })`.
    After the stage call, assert:
    ```ts
    const rows = store.query<{ role: string; requested_model: string }>(
      "SELECT role, requested_model FROM agent_run WHERE stage_id = ? ORDER BY id", [stageId]
    );
    const reviewerRows = rows.filter((r) => r.role === "reviewer");
    const authorRows = rows.filter((r) => r.role === "author");
    for (const row of reviewerRows) assert.equal(row.requested_model, MODEL);
    for (const row of authorRows) assert.equal(row.requested_model, "implementer-model");
    ```
    (Use the file's own constant name for the base model in place of
    `MODEL` above — confirm it by reading the top of the file; Task 4's
    author must not invent a new constant if one already exists.)
  - Verify: `npm test -- --test-name-pattern="code review"`
  - Expected: the new/modified test passes; every pre-existing test in the
    file still passes unchanged (none of them sets
    `code_review_implementer`, so it defaults to the base model, matching
    what those tests already assert).

**Task completion evidence:** `npm run typecheck` and
`npm test -- --test-name-pattern="code review"` both pass.

---

### Task 5: Extend the pre-flight readiness check for the new keys

**Depends on:** Task 1

**Files:**
- Modify: `src/operator-state.ts` — `frozenGroupReasons`
- Validate: `test/operator-state.test.ts`

**Steps:**

- **Step 1: Cover the three new keys in `frozenGroupReasons`**
  - Change: In `src/operator-state.ts` (lines 468-472), the `kinds`
    computation currently reads:
    ```ts
    const kinds = group === "spec" || group === "plan" ? [group, `${group}_review`]
      : group === "implementation" || group === "code_review" ? [group] : [];
    ```
    Change to:
    ```ts
    const kinds = group === "spec" || group === "plan" ? [group, `${group}_review`, `${group}_reconcile`]
      : group === "implementation" ? [group]
      : group === "code_review" ? [group, "code_review_implementer"] : [];
    ```
    This is the only change this function needs: the loop immediately below
    (lines 473-478) already iterates `kinds` generically, calling
    `resolveStageModel` and `requireFrozenBinding` for each — no other line
    in the function references stage kinds by name in a way the new keys
    would bypass. (`requireFrozenBinding` is still called per new kind here
    even though Tasks 2-4 established no *new* capability requirement is
    needed at the dispatch site — `requiredCapability` already returns
    `null` for an unrecognized kind, so calling it with `"spec_reconcile"`
    would fail wrongly. Handle this by having the loop call
    `requireFrozenBinding` only for kinds `requiredCapability` actually
    recognizes, or — simpler and consistent with the fact these are pure
    model-resolution keys — only push the new keys into a *second*,
    model-only check list that skips the binding call. Confirm which reading
    is correct against `requiredCapability`'s switch (`src/profile.ts:385-400`)
    before choosing: it recognizes only `spec`, `spec_review`, `plan`,
    `plan_review`, `implementation`, `code_review` and returns `null` for
    anything else, and `requireFrozenBinding` treats a `null` capability as
    a refusal ("no executor capability defined for stage kind ..."). So the
    new keys must be resolved for a model but **not** passed to
    `requireFrozenBinding`. Restructure the loop to do exactly that:
    ```ts
    for (const kind of kinds) {
      const model = resolveStageModel(profile, kind);
      if (!model.ok) fail(model.reason);
      if (requiredCapability(kind) !== null) {
        const binding = requireFrozenBinding(profile, profile.executor, kind);
        if (!binding.ok) fail(binding.reason);
      }
    }
    ```
    This requires importing `requiredCapability` from `./profile.ts`
    alongside the file's existing `loadVerifiedProfile, requireFrozenBinding,
    resolveStageModel` import (line 16).
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 2: Add a readiness test for a broken new key**
  - Change: In `test/operator-state.test.ts`, near the existing
    `setup_required` assertions (lines 873, 972), add a test that freezes a
    profile, deletes one of the three new keys from `modelMap` (e.g. via the
    same profile-mutate-and-rewrite pattern used elsewhere in this file —
    confirm the exact helper name by reading how the tests at lines 873/972
    construct their broken state before duplicating it), builds the snapshot
    for the `spec` (or `code_review`) execution group, and asserts
    `snapshot.workflowAction.reasons.some((r) => r.code === "setup_required" && r.reason.includes("spec_reconcile"))`
    (or `code_review_implementer` for the code_review-group variant).
  - Verify: `npm test -- --test-name-pattern="operator-state"`
  - Expected: the new test passes; every pre-existing test in the file still
    passes unchanged.

**Task completion evidence:** `npm run typecheck` and
`npm test -- --test-name-pattern="operator-state"` both pass.

---

### Task 6: Add the six new `new-run` flags

**Depends on:** None (parallel with Tasks 2-5; needed before Task 7)

**Files:**
- Modify: `src/cli-args.ts` — `COMMANDS["new-run"].options`

**Steps:**

- **Step 1: Declare the six new options**
  - Change: In `src/cli-args.ts`, after the existing `model` shared
    `OptionDefinition` (line 21), the `"new-run"` entry's `options` array
    (lines 32-38) currently ends with `{ ...model, required: true }`. Add
    six new non-required entries, each reusing `validateModelName` (already
    imported at line 3) directly — there is no shared `model` constant to
    spread from since each has a distinct `--name`:
    ```ts
    { name: "spec-review-model", value: "name", validate: validateModelName },
    { name: "spec-reconcile-model", value: "name", validate: validateModelName },
    { name: "plan-review-model", value: "name", validate: validateModelName },
    { name: "plan-reconcile-model", value: "name", validate: validateModelName },
    { name: "code-review-model", value: "name", validate: validateModelName },
    { name: "code-review-implementer-model", value: "name", validate: validateModelName },
    ```
    appended to the `"new-run"` options array, after `{ ...model, required: true }`.
    No changes to `parseArguments`, `synopsis`, or `formatHelp` — all three
    already iterate `definition.options` generically (confirmed by full
    read of `src/cli-args.ts`), so the new flags appear in
    `buildworks help new-run`'s synopsis and are validated by the existing
    generic loop (lines 225-230) with no further code.
  - Verify: `node src/cli.ts help new-run`
  - Expected: the printed usage line includes
    `[--spec-review-model <name>] [--spec-reconcile-model <name>] [--plan-review-model <name>] [--plan-reconcile-model <name>] [--code-review-model <name>] [--code-review-implementer-model <name>]`
    after the existing `--model <name>`.

**Task completion evidence:** `node src/cli.ts help new-run` shows all six
new flags; `npx tsc --noEmit` compiles clean.

---

### Task 7: Thread the overrides from `new-run` through `createRunIntake` to `freezeProfile`

**Depends on:** Task 1, Task 6

**Files:**
- Modify: `src/run-intake.ts` — `RunIntakeInput`, `createRunIntake`
- Modify: `src/cli.ts` — `case "new-run"`
- Validate: `test/run-intake.test.ts`, `test/cli.test.ts`

**Steps:**

- **Step 1: Add the optional field to `RunIntakeInput`**
  - Change: In `src/run-intake.ts`, import `type StageModelOverrides`
    alongside the existing `freezeProfile` import (line 4), and add one
    optional field to `RunIntakeInput` (lines 7-13):
    ```ts
    export interface RunIntakeInput {
      project: string;
      featureId: string;
      slug: string;
      changeKind: ChangeKind;
      model: string;
      modelOverrides?: StageModelOverrides;
    }
    ```
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 2: Pass the overrides to `freezeProfile`**
  - Change: In `createRunIntake` (`src/run-intake.ts`), the `freezeProfile`
    call (lines 61-67) currently passes five positional arguments. Add the
    `deps` placeholder and the overrides:
    ```ts
    const frozen = freezeProfile(
      rootDir,
      run.id,
      intake.startingCommit!,
      input.model,
      intake.verification!,
      {},
      input.modelOverrides ?? {},
    );
    ```
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 3: Read the six new flags in `new-run` and pass them through**
  - Change: In `src/cli.ts`'s `case "new-run"` (lines 184-201), the
    `createRunIntake` call's object literal currently ends after `model:
    args.get("model")!,`. Add:
    ```ts
    modelOverrides: {
      specReview: args.get("spec-review-model"),
      specReconcile: args.get("spec-reconcile-model"),
      planReview: args.get("plan-review-model"),
      planReconcile: args.get("plan-reconcile-model"),
      codeReview: args.get("code-review-model"),
      codeReviewImplementer: args.get("code-review-implementer-model"),
    },
    ```
    (`args.get(name)` returns `string | undefined`, matching the optional
    fields on `StageModelOverrides` exactly — `exactOptionalPropertyTypes`
    is not set in `tsconfig.json`, confirmed by reading it, so assigning
    `undefined` here type-checks.)
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 4: Add an end-to-end test through the real CLI**
  - Change: In `test/cli.test.ts`, add a test using the file's existing
    `tempCwd`/`runCli` helpers (see the pattern at lines 81-107): run
    `new-run` with the base `NEW_RUN_ARGS`-style flags plus
    `"--spec-review-model", "cheap-model"`, then read
    `.governance/profiles/<runId>/profile.json` (as the existing test "new-run
    freezes a profile and records its hash on the run", lines 300-330,
    already does) and assert
    `profile.modelMap.spec_review === "cheap-model"` while
    `profile.modelMap.spec === "test-model"` (the base model the test
    passes). Add a second test passing an invalid value for one new flag
    (e.g. `"--code-review-implementer-model", "bad model"`) and assert via
    the file's existing `assertNoRunRow` helper (lines 340-347) that the
    command refuses and creates no run row — matching how the file already
    tests the base `--model`'s validation.
  - Verify: `npm test -- --test-name-pattern="new-run"`
  - Expected: both new tests pass; every pre-existing `new-run`-related test
    in the file still passes unchanged (none of them passes the new flags,
    so every entry defaults to the base model, exactly as before this plan).

**Task completion evidence:** `npm run typecheck`,
`npm test -- --test-name-pattern="new-run"`, and
`npm test -- --test-name-pattern="run-intake"` (confirm `run-intake.test.ts`
needs no change since `modelOverrides` is optional and no existing call site
sets it — if a test author finds a reason to add direct
`createRunIntake`-level coverage beyond the CLI-level test in Step 4, add it
here following the file's existing pattern, but it is not required for this
task's completion) all pass.

---

### Task 8: Update documentation

**Depends on:** Tasks 1-7 (documents the shipped behavior, not a design still in flux)

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `ARCHITECTURE.md`

**Steps:**

- **Step 1: README.md**
  - Change: At `README.md:69-71`, the sentence "The model each stage uses is
    frozen at `bw new-run --model` and every spend entry point checks it."
    becomes: "The model each stage uses is frozen at `bw new-run --model`,
    with six optional per-role overrides
    (`--spec-review-model`, `--spec-reconcile-model`, `--plan-review-model`,
    `--plan-reconcile-model`, `--code-review-model`,
    `--code-review-implementer-model`) that default to `--model` when
    omitted, and every spend entry point checks whichever entry the dispatch
    resolves to." Leave the PowerShell example at `README.md:546` unchanged
    — it demonstrates the base flow, and the doc-checker's "current" tier
    requires accuracy, not that every example show every optional flag.
  - Verify: `npm run check:docs`
  - Expected: exit 0.

- **Step 2: CLAUDE.md and AGENTS.md (identical wording, both files)**
  - Change: Both files carry the identical sentence "`new-run` requires
    project, feature, slug, change-kind and model; it never selects these
    implicitly." (verified present verbatim in both — `CLAUDE.md`'s
    "Commands" section and `AGENTS.md:276-278`). Append, in both files, in
    the same place: ", plus six optional per-role overrides
    (`--spec-review-model`, `--spec-reconcile-model`, `--plan-review-model`,
    `--plan-reconcile-model`, `--code-review-model`,
    `--code-review-implementer-model`) that default to `--model` when
    omitted."
  - Verify: `npm run check:docs`
  - Expected: exit 0; `diff <(sed -n ...)` is unnecessary, but confirm by
    eye that both files read identically at this sentence, matching this
    repository's stated requirement that they "remain in sync."

- **Step 3: ARCHITECTURE.md section 10**
  - Change: Section 10 ("Model configuration", lines 446-468) already says
    "A stage names what it needs; the configuration resolves that to a
    concrete model" — this remains true and needs no correction. Add one
    sentence after the existing "Map stages to models in configuration"
    paragraph (after line 453) making explicit that a stage's roles are
    named independently: "A stage that dispatches more than one role — an
    author, a reviewer panel, and, where the stage has one, a role that acts
    on findings — names each role it needs, and configuration may resolve
    each to a different model; a role that is not overridden resolves to
    the stage's base model." This is a clarifying addition, not a change to
    an existing claim — `derive()` in `scripts/doc-check.mjs` does not parse
    this section's prose (confirmed: `PINNED_SEQUENCE`/`PINNED_DEFERRED` are
    the only structured facts `derive()` pulls from `ARCHITECTURE.md`, and
    neither concerns section 10's text), so this edit cannot trip a
    structural check.
  - Verify: `npm run check:docs`
  - Expected: exit 0.

**Task completion evidence:** `npm run check:docs` exits 0 after all four
files are edited.

---

### Task 9: Full verification pass

**Depends on:** Tasks 1-8

**Files:**
- Validate: whole repository

**Steps:**

- **Step 1: Full typecheck and test suite**
  - Change: None — verification only.
  - Verify: `npm run typecheck && npm test`
  - Expected: both exit 0, including every pre-existing test (this plan
    changed no default behavior — every new key defaults to the base model
    when no override is given, so a caller that passes no new flag gets
    exactly today's frozen `modelMap` values on the six original keys, plus
    three new keys equal to the same base model).

- **Step 2: Documentation check**
  - Change: None — verification only.
  - Verify: `npm run check:docs`
  - Expected: exit 0.

**Task completion evidence:** All three commands in Steps 1-2 exit 0.
