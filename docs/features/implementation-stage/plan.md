# Implementation Stage Implementation Plan

**Status:** Implemented

**Goal:** Build order step 6: the `implementation` stage chained from the passed `plan_review` row — the system creates the run's worktree on branch `gov/<slug>/<run-id>` at the approved starting commit, commits the run's projections there, dispatches an implementer that proposes whole-file patches bound to that base commit, applies each patch only when every touched path is inside the signed scope and untouched since proposal, commits each applied patch to the run branch, and blocks the run — retaining the worktree — when the deterministic gate refuses.

**Source:** `ARCHITECTURE.md` sections 4 (handoff is a row), 5 (sequence: `plan_review -> implementation`), 7 (repository contract — branch and worktree isolation, what the system writes, protected paths), 8 (write modes — patch write, base commit binding, deletion refused), 10 (model configuration), 12 (gates — one authorization covers the rest, scope enforcement, scope fitness), 15 (evidence model — no patch table), 20 (limits — run duration), 23 (build order step 6); `docs/hazards.md` entries 1-8, 10, 11, 13, 14; `CLAUDE.md`; the shipped plan stage as direct precedent (`src/plan-stage.ts`, `docs/features/plan-stage/plan.md`); the step-6 pre-planning entry in `.claude/sessions/project-learnings.md` (the three open scope decisions).

**Hazards considered:** 1 (implementer output is parsed against the AgentResult contract with every refusal naming its cause; the shared fixture is validated against the same validator real output is held to), 2 (no new discard path — `dispatchOnce` already retains raw bytes before parsing and references them from the run record), 3 (the implementer prompt states every constrained field's constraint: the exact `baseCommit` value, the `add`/`modify` action enum, whole-file content, and the no-deletion rule; the prompts scan gains the patch rules its comment reserved for this step), 4 (the fixture builds its patches from the prompt's own scope and baseCommit, never from literals, and reads a marker from its working directory — the failure mode this entry names is agreement between fixture and code, and a fixture that derives its inputs from what the code produced cannot silently agree), 5 (an empty `proposedPatches` is refused at the gate — the cheap half of completion-without-delivery; the changed-paths half is step 8's delivery_check, a stated limit, not a gap), 7 (no remediation rounds exist here: section 20 budgets rounds for reviewed stages and implementation is unreviewed, so a refusal is terminal by design and there is no retry to vary), 8 (git is spawned the way `resolveStartingCommit` already spawns it — direct, no npm shim — and git resolution was already proven at run start, since a run without git never gets approved), 10 (the model map gains `implementation`, resolved once at run start and failing at configuration time when unmapped), 11 (the seeded registry gains the implementer and a test asserts it), 13 (the gate checks presence and shape only — path, action, base commit, content — and invents no obligation like required tests), 14 (not a review stage; the author dispatch still records `configured_standalone` through `dispatchOnce`). Entries 6, 9, and 12 do not apply: 6 is the plan gate's concern, already enforced at step 5; 9 concerns setup-time interpreter spawns, which this step adds none of; 12 concerns two surfaces enforcing different rules, and this step keeps the single CLI surface resolving the model exactly as the stage does.

**Assumptions:**

- **Scope fitness (section 12) is deferred past step 9** (pre-planning decision 1). An out-of-scope patch path is refused at apply time with a message naming the path; the repair is a fresh run. No delta-hash proposal flow is built in this step.
- **The run-duration ceiling (section 20) lands with this step** (pre-planning decision 2). `RUN_DURATION_LIMIT_SECONDS = 604800` (7 days) in `src/policy.ts`, frozen in `Policy`, enforced at the implementation stage entry against `run.created_at`. Seven days because the ceiling exists to stop an unattended run, and the human approval window (default 8h) plus the remediating stages must fit comfortably; the value is config-level (section 20: "state each limit's value in configuration, not in code") and frozen per run through the profile, which is how section 20's "record which values were in force" is satisfied.
- **The `status.md` projection (section 14) is deferred past step 9** (pre-planning decision 3). No work in this plan.
- **Patch semantics: `ProposedPatchFile.content` is the complete new file content.** The shipped type in `src/agent-result.ts` carries `path`, `action`, and optional `content` — no diff field exists, and whole content against a named base commit is a diff the system can compute and validate deterministically. Inventing a unified-diff transport would mean adding a field to a shipped contract; nothing here needs it.
- **The system applies and commits, one commit per patch**, authored as the system identity (`user.name` = `SYSTEM_NAME`, `user.email` = `buildworks@buildworks.invalid`, passed per commit via `-c` flags — never global git config), message `bw run <id>: apply patch (base <first-8-of-hash>)`. Run commits are never attributed to the operator, and the branch carries the record even when the operator's machine is gone.
- **The projections are committed to the run branch.** Section 7: "the system commits everything it writes to the run branch (projections and applied patches)". Steps 3 and 5 write `spec.md` and `plan.md` into the main tree; this stage copies both into the worktree at their repo-relative paths and commits them as the branch's first commit, before dispatch. The scope gate does not apply to that commit: it is the system's own content write, not an agent-proposed patch, exactly as steps 3 and 5 wrote projections without a scope check. This also puts the implementer's inputs on disk where it can read them.
- **One patch per file per dispatch.** The base commit is fixed at dispatch; each applied patch advances the branch, so a second patch touching a path the first already touched is refused by the head-moved re-validation. That refusal is the designed guard's honest consequence (section 8: "refuses it if the branch has moved in any path it touches since proposal") and is what makes the guard provable by breaking it.
- **Scope matching is string-based on the signed entries as declared.** A patch path `p` is in scope iff `p` equals a scope entry `s`, or `p` starts with `s + "/"` — so `src` and `src/` both cover `src/index.ts`, and `src/index.ts` does not cover `src/index.tsx`. Comparison is exact and case-preserving: the operator signs the paths as declared, the same rationale `coverageFitsScope` states in `src/plan-gate.ts`.
- **No remediation rounds.** Section 20 budgets rounds "per reviewed stage"; implementation is unreviewed, so a refused patch is terminal: the stage completes blocked with no `output_ref`, the run blocks, the worktree is retained (section 7: "retain the worktree after the run ends, including when it ends blocked"), and the audit event names the offending paths. A fresh run is the repair.
- **The harness runs with its working directory set to the worktree root**, so the implementer reads the repository content it is patching. Raw output retention and the audit stay in the main repository's `.governance/` — `dispatchOnce`'s `rootDir` argument is unchanged; only the spawn's `cwd` moves.
- **The stage's `output_ref` is the worktree path** — what verification (step 7) is handed.
- **Runs created before this change fail the approval gate's policy re-check** with `policy has changed since intake` (the `Policy` shape grows). Nothing has shipped, so no compatibility handling is owed (hard rule 3); the refusal is the correct behaviour.

**Approach:** One new stage orchestrator mirroring `runPlanStage`'s structural shape — preconditions each refused by name, one author dispatch, a deterministic gate, terminal block or pass, and the wedge guard — plus one pure gate module, one new agent and prompt, a harness `cwd` extension, and the run-duration ceiling. No schema change: section 15's evidence model has no patch table, and step 8's delivery check will compute changed paths from git — the applied commits are the record. The duplication with `runSpecStage`/`runPlanStage` remains deliberate and is named in the code (hard rule 4): the extraction decision belongs to the step that has all three in hand.

**Affected areas:** New `src/implementation-stage.ts`, `src/implementation-gate.ts`, `src/agents/implementer.ts`, `test/fixtures/harness/emit-implementation-stage.mjs`, `test/fixtures/harness/echo-cwd.mjs`; modify `src/prompts.ts` (implementer prompt), `src/agents.ts` (register it), `src/profile.ts` (model map), `src/policy.ts` (run-duration ceiling), `src/harness.ts` (`InvocationInput.cwd`), `src/cli.ts` (`bw implement`); tests for each; `CLAUDE.md` and `README.md`.

**Known blockers:**

- **`test/profile.test.ts:157` pins the four-entry model map** with a literal `deepEqual`, and **`test/profile.test.ts:170` uses `"implementation"` as its unmapped-stage example**. Both must change in the same step as the map literal or the suite fails — the plan-stage review's lesson about fixtures reading ambient state applies: these pins are the tripwires.
- **`test/prompts.test.ts:20-22` reserves the patch rules for this step by comment.** Its `CONSTRAINT_STRINGS` comment says the patch rules "return with the step whose prompts request patches" — that is this step, so the comment changes with the array.
- **The `Policy` shape change moves `policyHash`.** `buildBinding` re-checks it at the approval gate (`src/approval-stage.ts:76-79`), so pre-existing dev runs refuse with the correct message. No migration owed.
- **`ARCHITECTURE.md` is not modified by this plan.** `implementation` is already in the pinned sequence (`scripts/doc-check.mjs:218-228`, verified) and the schema block is unchanged, so `npm run check:docs` stays green with no documentation edits. No new current-tier document is added.
- **The worktree lives under `.governance/worktrees/<run-id>`**, which `.gitignore` line 3 already covers — the main tree cannot be dirtied by the branch's existence. Verified by reading `.gitignore`.
- **`git worktree add` reports its own refusals** (dirty main tree conflicting with the target commit, an existing branch). The stage passes git's stderr through in the refusal message, and the smoke exercises the real behaviour.
- **The manual smoke costs real money, once.** Step 5's record budgets a low-risk plan stage at ~$0.63 with closure rounds; this stage has one dispatch and no panel, so expect roughly one step-5 single-dispatch cost (0.068-0.156). The step-3 and step-5 records are the reason the smoke exists: fixtures cannot expose prompt defects.

**Blast radius** (verified by import search across `src/**` and `test/**`):

- `src/profile.ts` — imported by `src/cli.ts`, `src/approval-stage.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `test/profile.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, `test/cli.test.ts`. Adding a fifth `modelMap` entry changes every frozen profile's bytes; no test pins a literal profile hash (they compute it from the bytes they read — verified in `test/plan-stage.test.ts:40-67`), and the only literal map assertions are the two named above (`test/profile.test.ts:157-174`). `test/spec-stage.test.ts:333` deletes `modelMap.spec` and `test/plan-stage.test.ts:582-603` tamper `plan`/`plan_review` — neither is affected by a fifth entry.
- `src/policy.ts` — imported by `src/spec-stage.ts`, `src/plan-stage.ts`, `src/profile.ts`, `src/cli.ts`, `src/approval-stage.ts`, `test/policy.test.ts`. `test/policy.test.ts:21-33` asserts field-by-field, not a literal object, so it gains one line (verified by reading the file).
- `src/harness.ts` — imported by `src/dispatch.ts`, `test/harness.test.ts`. `InvocationInput.cwd` is optional and backward compatible; `dispatchOnce` already spreads `input.invocation` into `invokeHarness` (`src/dispatch.ts:57-61`, verified), so `dispatch.ts` needs no change for the stage to set the working directory.
- `src/agents.ts` — imported by `src/select.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/profile.ts`, `test/agents.test.ts`. Registering an **author** cannot enter a panel: `selectReviewers` filters to `role: "reviewer"` and `test/agents.test.ts`'s assertions are reviewer-filtered (the plan-stage plan verified this; the loops are unchanged).
- `src/prompts.ts` — imported by `src/spec-stage.ts`, `src/plan-stage.ts`, `test/prompts.test.ts`. Adding one builder affects neither existing consumer.
- `src/cli.ts` — no importers; `test/cli.test.ts` spawns it.
- No consumer of the implementation stage exists yet; build order step 7 (verification) is the next caller.

**Verification:** `npm run typecheck`, `npm test` (fixture executors only, zero live network calls), `npm run check:docs`. Completion gate: `npm ci && npm run typecheck && npm test && npm run check:docs` from a clean checkout, every break-it run recorded, plus one manual smoke against the real `claude` binary whose output is recorded in the task evidence.

---

### Task 1: `implementation` in the frozen model map

**Depends on:** None

**Files:**
- Modify: `src/profile.ts` — `freezeProfile`'s `modelMap` literal
- Modify: `test/profile.test.ts` — the two pins

**Steps:**

- [x] **Step 1: the map entry**
  - Change: `src/profile.ts:128`'s literal gains `implementation: model`. The doc comment above the field stays accurate: one entry per stage kind that exists today — after this step, `verification` and `delivery_check` still do not.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: the pin tests move together**
  - Change: `test/profile.test.ts:157` ("the profile freezes one model entry per stage kind") gains `implementation: "chosen-model"` in its `deepEqual`. `test/profile.test.ts:170` ("resolveStageModel refuses an unmapped stage kind naming the mapped ones") changes its example kind from `"implementation"` to `"verification"` — the next section-5 kind that remains unmapped until step 7.
  - Verify: `node --test test/profile.test.ts`
  - Expected: all pass, including the refusal naming the five mapped kinds.

- [x] **Step 3: full suite**
  - Verify: `npm test`
  - Expected: all pass. `freezeProfile`'s signature is unchanged, so no other caller moves; this run confirms it.

**Task completion evidence:** the frozen profile maps `implementation`, and an unmapped kind still fails at configuration time by name.

### Task 2: The run-duration ceiling

**Depends on:** None

**Files:**
- Modify: `src/policy.ts` — `RUN_DURATION_LIMIT_SECONDS`, `Policy`, `buildPolicy`
- Modify: `test/policy.test.ts` — one assertion

**Steps:**

- [x] **Step 1: the constant and the frozen field**
  - Change: `src/policy.ts` gains `export const RUN_DURATION_LIMIT_SECONDS = 7 * 86400;` with a comment: section 20's rule that every limit has a defined behaviour on breach — the implementation stage refuses at entry, naming the limit — and that the value is configuration, frozen per run. `Policy` gains `runDurationLimitSeconds: number`; `buildPolicy` gains `runDurationLimitSeconds: RUN_DURATION_LIMIT_SECONDS`.
  - Change: Enforcement itself lands in Task 6 and reads `profile.policy.runDurationLimitSeconds` — the frozen value, per hard rule 6. Do not add enforcement here.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: the policy test gains the line**
  - Change: `test/policy.test.ts`'s "every policy value is the one the enforcing module actually uses" gains `assert.equal(p.runDurationLimitSeconds, RUN_DURATION_LIMIT_SECONDS);` and the import.
  - Verify: `node --test test/policy.test.ts`
  - Expected: all pass.

**Task completion evidence:** the ceiling is frozen in `Policy` and asserted against the constant; pre-existing dev runs now refuse at the approval gate's policy re-check with the correct message (by design).

### Task 3: The implementer agent and the prompt

**Depends on:** None

**Files:**
- Create: `src/agents/implementer.ts`
- Modify: `src/agents.ts` — register it
- Modify: `src/prompts.ts` — `buildImplementationAuthorPrompt`
- Modify: `test/agents.test.ts`, `test/prompts.test.ts`

**Steps:**

- [x] **Step 1: the agent, and the disallowed-output test first**
  - Change: `src/agents/implementer.ts` defines `IMPLEMENTER` with `id: "implementer"`, `role: "author"`, `specialty: null`, `executor: "claude-code"`, `outputs: ["patches"]`, `tools: []` — the same shape as `src/agents/plan-author.ts`. Register it in `src/agents.ts`.
  - Change: `test/agents.test.ts` asserts `agentById("implementer")` resolves with `role: "author"`; its `outputs` excludes `"spec"`, `"plan"`, `"plan-revision"`, and `"findings"`; no reviewer's `outputs` includes `"patches"`; and the seeded registry staffs an implementation dispatch (hazard 11). Section 9 says the test asserting a disallowed-output refusal must be written first — this is that test.
  - Verify: `node --test test/agents.test.ts`
  - Expected: all pass.

- [x] **Step 2: the prompt**
  - Change: `buildImplementationAuthorPrompt(agent, planContent, specContent, scope, baseCommit)` in `src/prompts.ts`, following `buildPlanAuthorPrompt`'s shape. It states: the role; the approved plan and specification verbatim; the AgentResult envelope `{"status": "proposed", "agent": "implementer", "role": "author", "executor": "claude-code", "summary": "...", "proposedPatches": [{"baseCommit": "...", "files": [{"path": "...", "action": "add", "content": "<complete new file content>"}]}]}`; the `status` enum `proposed, blocked, failed`; **`baseCommit must be exactly: <given value>`** — handed, not left to compute, for the same reason the plan prompt hands `plan_for`; `action` one of `add`, `modify` — **deletion is refused by the system and must not be proposed**; `content` is the complete new file content, not a diff; and the signed scope as the only paths a patch may touch, in the block shape: `Patch only these paths:` followed by one `- <path>` line per entry, ending in a blank line (the scrape target the fixture relies on in Task 7). It also states that the agent's working directory is the repository checkout it should read, and that it runs no git commands — the system applies patches.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: the constrained-field scan gains the patch rules**
  - Change: `test/prompts.test.ts`'s `CONSTRAINT_STRINGS` gains `"proposedPatches"`, `"baseCommit"`, `"add"`, `"modify"`, `"deletion"`, `"content"`, and the comment at lines 20-22 is rewritten — the patch rules returned with this step, exactly as it promised. Add a generated-prompt test for the builder asserting: the exact handed `baseCommit` value appears; each scope path appears as a `- <path>` line; the action enum and the no-deletion rule appear.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: all pass.

**Task completion evidence:** the seeded registry staffs the stage; the prompt states every constrained field's constraint; the scan covers them.

### Task 4: The deterministic patch gate

**Depends on:** None

**Files:**
- Create: `src/implementation-gate.ts`
- Create: `test/implementation-gate.test.ts`

**Steps:**

- [x] **Step 1: the three pure functions**
  - Change: `src/implementation-gate.ts` exports:
    - `pathFitsScope(path: string, scope: string[]): boolean` — `normalizePath(path)` (from `src/scope.ts`), true iff `p === s` or `p.startsWith(s + "/")` for some entry `s`. Exact and case-preserving, with the operator-signs-paths rationale stated in a comment.
    - `gatePatchPaths(paths: string[], scope: string[], slug: string): { ok: true } | { ok: false; refused: string[]; reason: string }` — per path, in order: refuse a path whose normalized segments contain `..` or which `isAbsolute` (`path escapes the repository: <p>`); refuse `!pathFitsScope` (`outside the signed scope: <p>`); refuse `touchesProtected([p], slug)` (`touches a protected path: <p>`). Returns every refused path and a reason joining them.
    - `movedPaths(diffNameOnly: string[], patchPaths: string[]): string[]` — the normalized intersection, for the head-moved re-validation.
  - Change: A comment states precisely what this checks — apply-time scope and protected-path enforcement, and the intersection the head-moved guard needs — and what it does not: the git diff itself, existence semantics, and whether any declared artifact was delivered at all (hazard 5's second half is step 8's delivery check).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: the tests**
  - Change: `test/implementation-gate.test.ts` covers: exact match; directory prefix (`src` covers `src/index.ts`; trailing-slash `src/` too); `src/index.ts` not covering `src/index.tsx`; a path differing from a signed entry only in case refused on every platform; out-of-scope named; protected named (scope entry `src/agents/x.ts` — the gate refuses it even though the scope names it, because protection outranks scope); escapes (`../evil.ts`, an absolute path, `a/../../b`); `movedPaths` intersections including a path needing normalization.
  - Verify: `node --test test/implementation-gate.test.ts`
  - Expected: all pass.

- [x] **Step 3: prove the guards by breaking them**
  - Change: Two one-line breaks, each run through the quick-reference break-it cycle (`git add -A` → break → run the named test → `git checkout -- <path>` → `git diff --quiet -- <path>`): make `pathFitsScope` return `true` unconditionally (the out-of-scope test must fail), then restore; remove the `touchesProtected` call (the protected test must fail), then restore.
  - Verify: `node --test test/implementation-gate.test.ts` after each break and each restore
  - Expected: exactly the named test fails on each break; green after each restore.

**Task completion evidence:** scope and protection are refused deterministically, and both guards have been seen failing.

### Task 5: The harness runs in a caller-chosen directory

**Depends on:** None

**Files:**
- Modify: `src/harness.ts` — `InvocationInput`, the spawn options
- Create: `test/fixtures/harness/echo-cwd.mjs`
- Modify: `test/harness.test.ts`

**Steps:**

- [x] **Step 1: `cwd` rides through the invocation**
  - Change: `InvocationInput` gains `cwd?: string`; the spawn options in `invokeHarness` gain `...(input.cwd !== undefined ? { cwd: input.cwd } : {})`. Comment: the implementation stage runs the harness inside the run's worktree so the implementer reads the repository it patches; raw output retention is unaffected because `dispatchOnce`'s `rootDir` argument is unchanged. `dispatch.ts` needs no change — `DispatchInput.invocation` is `Partial<InvocationInput>` and is spread into `invokeHarness` (`src/dispatch.ts:57-61`).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: the test**
  - Change: `test/fixtures/harness/echo-cwd.mjs` is one line: `console.log(process.cwd());`. `test/harness.test.ts` gains two cases calling `invokeHarness` directly: one with `cwd` set to a `mkdtempSync` directory asserting `outcome.raw.trim()` equals it exactly; one without `cwd` asserting the current behaviour (raw equals `process.cwd()`).
  - Verify: `node --test test/harness.test.ts`
  - Expected: all pass.

**Task completion evidence:** the harness honors a caller-chosen working directory and defaults to the inherited one.

### Task 6: The implementation stage

**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 5

**Files:**
- Create: `src/implementation-stage.ts`

**Steps:**

- [x] **Step 1: preconditions, each refused by name before any state mutation or spawn**
  - Change: `runImplementationStage(store, executor, input: { runId: number; requestedModel?: string; rootDir: string })` in `src/implementation-stage.ts`, returning `{ ok: true; stageId: number; worktreePath: string } | { ok: false; reason: string }`. In order: the run exists; `requireRunInProgress(run)`; the chain has no `implementation` stage (`run ${id} already has an implementation stage with status ${s}`); the last stage is a **passed** `plan_review` with `output_ref`; `loadVerifiedProfile(rootDir, run)`; `resolveStageModel(profile, "implementation")`; a supplied `requestedModel` differing from the frozen value refused with the plan stage's own message (`--model ${requestedModel} does not match the model frozen at run start (${frozen}): config is frozen at run start`); the `approval` row and the scope parse (the same code and message as `src/plan-stage.ts:122-135`); the plan file read from `last.output_ref` (`cannot read the approved plan ${path}`); **the plan and spec re-verification** — the run's latest `plan.gate.pass` audit event (`run ${id} has no plan.gate.pass audit event: the plan_review gate never recorded what it approved`), its `planHash` and `planFor` extracted with one regex, `planHash=([0-9a-f]{64}); planFor=([0-9a-f]{64})` (the event `src/plan-stage.ts:390-397` writes), the `planHash` compared against `sha256Hex(normalizeText(planContent))` with the wording `the plan has changed since review: gated ${gatedHash}, on disk ${planHash}`, then the spec file read from the `awaiting_approval` stage's `output_ref` (the chain lookup; `cannot read the approved spec ${path}`) and held to both authoritative records of what the operator approved: `sha256Hex(normalizeText(specContent))` compared against `approval.spec_hash` (refusal `the spec has changed since approval: signed ${approval.spec_hash}, on disk ${specHash}`) and against the extracted `planFor` (refusal `the spec does not match the plan the gate approved: planFor ${planFor}, on disk ${specHash}`). The plan's own re-verification does not make this redundant: it proves the plan file is unchanged, while the spec file is a separate mutable file the stage reads, commits to the run branch, and hands to the implementer — `runPlanStage` re-verifies the spec at its boundary for exactly this reason (`src/plan-stage.ts:152-169`); **the duration check** — `Date.now() - Date.parse(run.created_at) > profile.policy.runDurationLimitSeconds * 1000` refuses `run ${id} has exceeded the run-duration limit of ${profile.policy.runDurationLimitSeconds} seconds`, before the stage row exists; and a pre-existing worktree directory at `join(rootDir, ".governance", "worktrees", String(runId))` refuses `worktree path already exists for run ${id}` (crash residue from a previous attempt).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: the stage row and the worktree**
  - Change: `store.insertStage(runId, "implementation", last.id)`; audit `implementation.stage.create`. Then `spawnSync("git", ["worktree", "add", worktreePath, "-b", `gov/${run.slug}/${run.id}`, approval.starting_commit], { cwd: rootDir, encoding: "utf8" })` — direct spawn, no shell, matching `resolveStartingCommit`. Non-zero exit or spawn error aborts with the git message named (`git worktree add failed: ${stderr}`), audit action `implementation.worktree.failed`. On success audit `implementation.worktree.create` recording the branch and base commit. Comment: the worktree is never deleted — section 7 retains it, including when the run ends blocked.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: the projections commit**
  - Change: Copy the spec and plan files into the worktree at `join(worktreePath, "docs", "features", run.slug, "spec.md")` and `join(worktreePath, "docs", "features", run.slug, "plan.md")` — the repo-relative paths `writeSpecDoc`/`writePlanDoc` use in the main tree, constructed from the slug rather than derived from the absolute `output_ref` paths. `git -C worktreePath add` both, then commit with the system identity (`-c user.name=${SYSTEM_NAME} -c user.email=buildworks@buildworks.invalid`), message `bw run ${id}: projections (spec and plan)`. Failure aborts naming git's stderr. Audit `implementation.projections.commit` recording both paths and their hashes. Comment: the scope gate does not apply here — this is the system's own content write committed to the run branch per section 7, not an agent-proposed patch.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 4: the dispatch**
  - Change: The author is `agentById("implementer")`; if `!author.outputs.includes("patches")`, abort before dispatch with `configured agent ${author.id} does not allow patches output`. Read the branch head (`git -C worktreePath rev-parse HEAD`) as `headAtProposal` — the head in effect when the patch is proposed, i.e. after the projections commit. Dispatch through `dispatchOnce` with `prompt: buildImplementationAuthorPrompt(author, planContent, specContent, scope, headAtProposal)` and `invocation: { cwd: worktreePath }`. A failed dispatch aborts with action `implementation.author.failed` (raw output is already retained and audited by `dispatchOnce`).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 5: parse, validate, and refuse an empty delivery**
  - Change: `extractJsonBody`, then `validateAgentResult(author.id, body)` — refusals abort with `implementation.content.invalid`. Require `status === "proposed"` (abort `implementation.author.failed` naming the status). Require `proposedPatches` to be a non-empty array — abort `implementation.content.invalid` with `implementer returned no proposed patches: a run that delivers nothing cannot pass` (hazard 5's cheap half). Per patch: `files` non-empty; per file: `content` must be a string (`patch file ${p} is missing string content`).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 6: the gate, per patch, in order — every refusal terminal**
  - Change: For each patch, with audit action `implementation.patch.refused` and the reason naming the cause: (a) `gatePatchPaths` over the patch's paths — refuse naming the refused paths; (b) `patch.baseCommit !== headAtProposal` — refuse `patch base commit ${b} does not match the branch head ${headAtProposal}`; (c) the head-moved re-validation — if the current head differs from `headAtProposal`, take `git -C worktreePath diff --name-only ${headAtProposal} ${currentHead}` and refuse when `movedPaths` is non-empty (`branch moved since proposal in: ${moved.join(", ")}`); (d) the escape backstop — `isPathInside(worktreePath, resolvedTarget)` (from `src/scope.ts`) must hold; then **the resolved-protected re-check** — the lexical `touchesProtected` in `gatePatchPaths` cannot see a symlink or junction redirecting the write, and `isPathInside` only proves the resolved target is still somewhere inside the worktree, so resolve the target through the filesystem with `resolveExisting` (also from `src/scope.ts` — it resolves the nearest existing ancestor, which catches a symlinked parent directory for an `add`), relativize against the worktree root, `normalizePath` it, and re-run `touchesProtected([relResolved], slug)`; a hit refuses with `resolves to protected path ${relResolved}` — this is the guard the `src/scope.ts` comment and the review-code break-it notes demand: compare the way the filesystem compares, because the write follows the link; (e) existence semantics — `add` requires the file not to exist, `modify` requires it to exist, each refusal naming the path — **after** the security checks, so a symlinked target is refused for what it resolves to, never for what happens to exist; (f) apply — `mkdirSync(dirname(target), { recursive: true })` and `writeFileSync(target, content)`; (g) commit — `git add` each path, then commit with the system identity and message `bw run ${id}: apply patch (base ${headAtProposal.slice(0, 8)})`, refusal naming git's stderr; (h) audit `implementation.patch.apply` naming the files and base commit. Comment: `headAtProposal` is fixed at dispatch and each applied patch advances the branch, so a later patch touching a path an earlier patch touched is refused by (c) — one patch per file per dispatch, and the designed re-validation in action.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 7: the pass**
  - Change: Read the final head; `store.completeStage(stage.id, worktreePath, "pass")`; audit `implementation.gate.pass` recording `head=${finalHead}`; return `{ ok: true, stageId: stage.id, worktreePath }`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 8: the abort helper and the wedge guard**
  - Change: `abort(stageId, action, reason)` — audit, `completeStage(stageId, "", "block")`, `setRunStatus(runId, "blocked")`, return `{ ok: false, reason }` — and the try/catch wedge guard in the same shape as `src/plan-stage.ts:490-505`, so an unexpected throw produces the same terminal state and no run is left wedged. Note in a comment: no test seam is needed, unlike `runPlanStage`'s `deps.selectPanel` — every guard here is reachable through the fixture executor or store-constructed state (Task 7 proves each).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

**Task completion evidence:** typecheck green; behaviour is validated by Task 7, which is the next task in order.

### Task 7: The fixture executor and the stage tests

**Depends on:** Task 6

**Files:**
- Create: `test/fixtures/harness/emit-implementation-stage.mjs`
- Create: `test/implementation-stage.test.ts`

**Steps:**

- [x] **Step 1: the fixture builds its patches from the prompt, not from literals**
  - Change: `test/fixtures/harness/emit-implementation-stage.mjs` mirrors `emit-plan-stage.mjs`: it reads the prompt from stdin, scrapes `baseCommit must be exactly: ([0-9a-f]{40}|[0-9a-f]{64})` and the `Patch only these paths:` scope block (`- <path>` lines, throwing when the scrape finds nothing — a broken fixture must fail loudly, hazard 4), and dispatches on `process.env.EMIT_MODE` (default `ok`): `ok` — one patch with `baseCommit` scraped and one `add` file per scope entry, whose content embeds `readFileSync("base.txt", "utf8")` from the process working directory (base.txt exists only in the worktree, so the applied content proves the harness ran with `cwd` set); `base-mismatch` — `baseCommit: "0".repeat(40)`; `out-of-scope` — one file at `src/never-approved.ts`; `protected` — one file at `EMIT_PATH` (default `src/agents/evil.ts`); `symlink-dir` — before emitting, creates a directory junction `src/alias` → `src/agents/` inside the working directory (the worktree the harness runs in — the fixture is the only party that can place the link, since on this machine a committed symlink checks out as a plain file under `core.symlinks=false`), then proposes `src/alias/x.ts` with `action: "add"`; `symlink-design` — before emitting, creates a file symlink `src/alias.md` → `docs/features/<slug>/design.md`, then proposes `src/alias.md` with `action: "modify"`; `empty` — `proposedPatches: []`; `two-patches` — two patches both touching the first scope path (the second `modify`); `add-existing` — the first scope path with `action: "add"`; `modify-missing` — the first scope path with `action: "modify"`; `non-proposed` — `status: "failed"`. The envelope shape is `emit-plan-stage.mjs`'s (`type`/`subtype`/`is_error`/`result`/`total_cost_usd`/`usage`/`modelUsage`).
  - Verify: pipe the minimal prompt the scrapes need, then check the body validates — a here-doc with exactly:
    ```
    baseCommit must be exactly: <40 hex characters>

    Patch only these paths:

    - src/a.ts

    ```
    followed by `| node test/fixtures/harness/emit-implementation-stage.mjs`, and assert the emitted envelope's `result` parses and `validateAgentResult("implementer", JSON.parse(result))` is ok for the `ok` mode (run without `EMIT_MODE` set).
  - Expected: a valid envelope on stdout in `ok` mode; the body validates.

- [x] **Step 2: the approved-run harness**
  - Change: `test/implementation-stage.test.ts` opens with a `withApprovedRun(fn, opts)` helper mirroring `test/plan-stage.test.ts`'s, but in a **real git repository**: `mkdtempSync`; `git init -q`; write `base.txt`; commit with the `-c user.email=t@example.invalid -c user.name=t` pattern from `test/cli.test.ts:287-297`, asserting the init succeeded (a missing git fails the test loudly); capture `HEAD` (assert 40 or 64 hex). Then: `openStore`, `insertRun("p", "f-1", "demo", "feature")`, `freezeProfile(root, runId, HEAD, "m")` + `setProfileRef`; write the spec (the `SPEC` shape from `test/plan-stage.test.ts:24-37`, artifacts `src/a1.ts`, `test/a1.test.ts`) at `docs/features/demo/spec.md`; `spec` and `spec_review` stages passed with the spec path; the `spec.gate.pass` audit event; `awaiting_approval` passed; `insertApproval` with `startingCommit: HEAD`, `scope: canonicalJson(opts.scope ?? SCOPE)`; write the plan at `docs/features/demo/plan.md` (`plan_for` = spec hash); `plan` and `plan_review` stages passed; the `plan.gate.pass` audit event with `planHash=`. The fixture executor is the `fixtureExecutor` pattern from `test/plan-stage.test.ts:50-67` with `envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP", "EMIT_MODE", "EMIT_PATH"]`. Tests that drive a mode set `process.env.EMIT_MODE` (and `EMIT_PATH` where needed) before the run and restore the previous value in `finally` — the harness passes named variables only, so an unset variable is indistinguishable from a mode not requested.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: the success path**
  - Change: The success test: `runImplementationStage` returns ok; the stage row is `passed` with `output_ref` equal to `join(root, ".governance", "worktrees", String(runId))`; `git -C root rev-parse --verify gov/demo/<runId>` exits 0; the worktree log has exactly two commits — `bw run <id>: projections (spec and plan)` then `bw run <id>: apply patch (base ...)` — with the apply commit authored as `BuildWorks <buildworks@buildworks.invalid>` (`git log -1 --format=%an|%ae`); both scope files exist in the worktree and `src/a1.ts` contains the `base.txt` marker (the cwd proof); the main tree's `git status --porcelain` snapshot taken before the stage is unchanged after; `verifyAuditChain(store)` returns null; the run status is still `in_progress`.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: the success test passes.

- [x] **Step 4: every precondition refusal**
  - Change: Cases: nonexistent run; blocked run; a second `runImplementationStage` call refusing with `already has an implementation stage`; last stage not `plan_review`; no approval; plan file deleted; **plan edited after the gate** (rewrite the plan file, keep the gate event) — refuses `the plan has changed since review` with **no worktree directory and no `agent_run` rows** (the spend boundary proof); **spec edited after approval** (rewrite the spec file, keep the gate events and the approval row) — refuses `the spec has changed since approval: signed ...` with no worktree directory and no `agent_run` rows, plus a variant that rewrites the spec *and* forges the plan gate event's `planFor` to match it — refuses `the spec does not match the plan the gate approved` (the variant proves the `planFor` comparison fires independently of the approval comparison); backdated `created_at` (`store.exec("UPDATE run SET created_at = ? WHERE id = ?", [eightDaysAgo, runId])`) — refuses naming the limit with no stage row, no worktree, and no `agent_run` rows; pre-created worktree directory — refuses `worktree path already exists`.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: all pass.

- [x] **Step 5: every gate refusal**
  - Change: Cases, each asserting the stage blocks, the run blocks, the named refusal text, and — where a worktree was created — that it survives: `base-mismatch`; `out-of-scope` naming `src/never-approved.ts`; `protected` with an approval scope of `["src/agents/evil.ts"]` (constructed via the helper's scope override, so the protected check is the one that fires) naming the protected path; `empty` naming `no proposed patches`; `add-existing` with scope `["docs/features/demo/spec.md"]` (the projections commit makes that file exist) naming `add requires the file not to exist`; `modify-missing` with scope `["src/missing.ts"]` naming `modify requires the file to exist`; `EMIT_PATH` `../evil.ts` naming `escapes`; `non-proposed` naming the status; the **symlink cases**: `symlink-dir` with scope `["src/alias/x.ts"]` — the fixture's junction redirects the write into `src/agents/`, and the stage refuses with `resolves to protected path src/agents/x.ts` (directory junctions need no privileges, so this is the always-run proof); and `symlink-design` with scope `["src/alias.md"]` — refused with `resolves to protected path docs/features/demo/design.md`, where the test first pre-flights `symlinkSync(target, path, "file")` in a scratch directory and skips this single assertion with a recorded reason when the OS refuses file symlinks (Windows without Developer Mode). Both refusals fire on the resolved path and do not depend on the target's existence — `resolveExisting` resolves the link itself; and the **head-moved case**: `two-patches` — the first patch applies and commits, the second is refused with `branch moved since proposal`, the stage blocks, and the worktree log has three commits (projections plus the first patch).
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: all pass.

- [x] **Step 6: config-time model failure and the fixture contract**
  - Change: A case deleting `profile.modelMap.implementation` (the `test/plan-stage.test.ts:582` pattern, profile hash kept self-consistent) asserts the refusal names the unmapped kind, before dispatch — no `agent_run` rows. A case asserts the `ok` fixture body passes `validateAgentResult` — the shared fixture held to the same contract real output is held to (hazard 4).
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: all pass.

- [x] **Step 7: prove the terminal guards by breaking them**
  - Change: Seven breaks, each through the quick-reference break-it cycle and each confirmed to fail exactly its named test: (a) make `pathFitsScope` always true — the out-of-scope test fails; (b) skip the base-commit equality — the base-mismatch test fails; (c) skip the `movedPaths` check — the two-patches test fails (the stage passes instead of blocking); (d) allow an empty `proposedPatches` — the empty test fails; (e) flip the duration comparison — the expired-run test fails; (f) skip the `isPathInside` backstop — the escape test fails; (g) skip the resolved-protected re-check — the symlink-dir test fails (the stage passes instead of blocking). The scope and protected unit breaks were already proven in Task 4; do not repeat them here.
  - Verify: `node --test test/implementation-stage.test.ts` after each break and each restore
  - Expected: exactly the named test fails on each break; green after each restore.

- [x] **Step 8: full suite**
  - Verify: `npm test`
  - Expected: all pass — parallel-file execution confirmed clean.

**Task completion evidence:** the stage passes end to end against a real git repository, every refusal is named and terminal, the worktree survives every block, and seven break-it runs are recorded.

### Task 8: The CLI surface and the documentation

**Depends on:** Task 7

**Files:**
- Modify: `src/cli.ts` — the `implement` case, `USAGE`, `known`
- Modify: `test/cli.test.ts`
- Modify: `CLAUDE.md` — the commands line
- Modify: `README.md` — the status paragraph

**Steps:**

- [x] **Step 1: the command**
  - Change: `implement` joins `known` and `USAGE` as `implement --run <id> [--model <name>]     run the implementation stage`. The case mirrors `plan`: `runImplementationStage(store, CLAUDE_CODE, { runId: numeric(args, "run"), requestedModel: optional(args, "model"), rootDir: process.cwd() })`, printing the worktree path on success and the reason to stderr with exit 1 on failure.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: CLI tests**
  - Change: `test/cli.test.ts` adds: `implement --run 9999` exits 1 naming the run and creates no `.governance/worktrees` directory; `implement` without `--run` exits 2 naming the option; and a walk that constructs the approved state through the store in a temp directory without git — freezing the profile with the `"b".repeat(40)` starting-commit literal `test/plan-stage.test.ts` uses, since the walk stops before worktree creation — then edits the plan file after the gate event and runs `implement`: exit 1 naming `the plan has changed since review`, with no worktree directory and no `agent_run` rows.
  - Change: **Deviation, recorded as built if confirmed:** no CLI walk reaches a dispatch. `bw implement` hardcodes `CLAUDE_CODE` exactly as `bw spec` and `bw plan` do, and a walk that reached the dispatch would spend real money in the automated suite — the established precedent from the plan-stage plan's Task 6 deviation. End-to-end stage behaviour is covered by `test/implementation-stage.test.ts` against the fixture executor; the CLI case proves the command is wired to `runImplementationStage` with the right `rootDir`, up to the deepest pre-dispatch refusal.
  - Verify: `node --test test/cli.test.ts`
  - Expected: all pass.

- [x] **Step 3: the documented command list**
  - Change: `CLAUDE.md`'s `node src/cli.ts ...` line gains `implement`. Compare the documented list against `src/cli.ts`'s `known` array — the two must agree exactly.
  - Verify: read both back and compare
  - Expected: no command in one and absent from the other.

- [x] **Step 4: the status paragraph**
  - Change: `README.md`'s Status section extends to steps 1-6, naming the implementation stage's worktree, base-commit binding, and scope enforcement in one clause.
  - Verify: `npm run check:docs`
  - Expected: `doc-check: clean`, aside from the two pre-existing warnings named in `.claude/sessions/project-learnings.md` (learnings-file reference and approval-gate plan placeholder path). The stage sequence pin already covers `implementation`.

**Task completion evidence:** `bw implement` refuses bad input before spending, is proven wired to the stage up to the dispatch boundary, and the documented command list matches the CLI.

### Task 9: The smoke, the completion gate, and the learnings

**Depends on:** Task 8

**Files:**
- Modify: `.claude/sessions/project-learnings.md` — a new entry

**Steps:**

- [x] **Step 1: the manual smoke**
  - Change: One real end-to-end implementation stage against the `claude` binary in a temp checkout **with a real git commit** — the approval requires a starting commit and `git worktree add` requires a repository, per the plan-stage smoke pattern: construct the spec, gate events, and approval through the store so the implementation dispatch is the only spend, then run `node src/cli.ts implement --run <id> --model sonnet`. Record in the task evidence: the model requested and effective, the cost from the envelope, whether the implementer returned a valid patch set on the first attempt, whether the gate passed and committed, and every prompt defect the smoke exposed. Iterate the prompt against real output — steps 3 and 5 record that fixtures cannot find prompt defects.
  - Verify: `node src/cli.ts implement --run <id>` against a real run
  - Expected: either a passed `implementation` stage or a designed terminal block. A block is an acceptable outcome and must be reported as one, not retried until it passes. Budget: roughly one step-5 single-dispatch cost (0.068-0.156).

- [x] **Step 2: the completion gate**
  - Verify: `npm ci && npm run typecheck && npm test && npm run check:docs`
  - Expected: all four exit 0 from a clean install, every automated test using fixture executors only.

- [x] **Step 3: record the learnings**
  - Change: Append an entry to `.claude/sessions/project-learnings.md` covering: the smoke's real output and cost; the decisions this plan made that the architecture left open (whole-file patch content, the scope-matching rule, the system commit identity, projections on the run branch, one patch per file); the disposition of the three pre-planning decisions (scope-fitness proposal flow and `status.md` deferred past step 9; the run-duration ceiling landed); the state of the three-orchestrator duplication with a recommendation on whether extraction is warranted; and which guards were broken and restored during implementation.
  - Verify: read the entry back
  - Expected: it names the smoke's real output and the landed decisions, not a summary of intent.

**Task completion evidence:** the full gate is green, the smoke is recorded with its real cost and outcome, and the session record carries the decisions for step 7 to resume from.

---

## Implementation note

**Shipped:** all nine tasks as planned. The smoke passed on the first
dispatch — one `claude-sonnet-5` invocation, **$0.0673** (budgeted
0.068-0.156), valid patch set on the first attempt, gate passed, both scope
files committed to `gov/demo/1` under the system identity, the implementer's
own test green in the worktree, audit chain intact.

**Deviations, each verified by the independent review as sound:**

- Break-it item (f) targets a junction `escape-link` fixture case (a link
  inside the worktree pointing outside it) instead of the `../evil.ts` case,
  because the lexical gate refuses `../evil.ts` first and the `isPathInside`
  backstop would never be exercised otherwise.
- The planFor-variant test forges the approval row's `spec_hash` rather than
  the gate event's `planFor`: the plan's literal wording would have made the
  comparison pass; only the inversion reaches the plan's stated goal of
  proving the `planFor` comparison fires independently of the approval
  comparison.
- Worktree log assertions use a `base..HEAD` range — the branch history
  includes the base commit the worktree was created from, and the plan's
  commit counts meant the run's own commits.
- The file-symlink case skips on Windows without Developer Mode with a
  recorded reason; the junction case is the always-run proof.

**Review outcome:** the independent review
(`2026-08-30-code-review.md`) filed two low findings, both closed. Finding 1
— a dangling link defeated the resolved-target checks (`resolveExisting`
walks with `existsSync`, which is stat semantics) — is fixed by refusing any
link component whose target cannot be resolved, proven by a break-it run
against a dangling junction. Finding 2 — the absent Task 9 record — is this
note and the session entry.

**Deferred (as planned):** the scope-fitness proposal flow and the
`status.md` projection, past step 9.
