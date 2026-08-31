# Verification Stage Implementation Plan

**Status:** Proposed

**Goal:** Build order step 7: the `verification` stage chained from the passed `implementation` row — the system runs the commands frozen at run start from a committed `governed.yaml` inside the run's worktree, under a named environment passthrough, a bounded per-command ceiling, and a bounded output budget; it proves the worktree still holds the commit implementation left and is clean before and after every command, retains every command's complete output before deciding anything, and hands `delivery_check` a structured record naming the worktree and the verified commit. A missing or uncommitted configuration, a dirty or moved worktree, an overflowing command, a timeout, or any non-zero exit blocks the run and names the cause.

**Source:** `ARCHITECTURE.md` sections 4 (the handoff is a row — stage N's `output_ref` is literally what stage N+1 was handed), 5 (sequence: `implementation -> verification`), 6 (trust boundaries), 7 (repository contract — a clean working tree at run start, `governed.yaml` committed and authored before the first run, never part of any run's scope; branch and worktree isolation), 12 (gates — `verification` fails closed when commands are missing or do not pass; the profile freezes verification config), 15 (state and evidence — the directory layout, no table for command results, retain raw output before any parser touches it), 17 (security — pass named environment variables, never the whole environment), 20 (limits — every limit defines its behaviour on breach, never silent truncation; refuse above the result cap and retain the bytes anyway), 21 (verification strategy), 23 (build order step 7); `docs/hazards.md` entries 2, 7, 8, 9, 11, 12; `CLAUDE.md`; the shipped implementation stage as direct precedent (`src/implementation-stage.ts`); `docs/features/verification-stage/2026-08-30-plan-review.md`, whose seven findings are reconciled into this revision.

**Hazards considered:** 2 (every command's complete stdout and stderr are streamed to an evidence file as they arrive, before any exit code is examined and independently of the in-memory budget, so the bytes above the cap are retained rather than discarded and the refusal is diagnosable), 7 (no retry exists in this step: remediation is deferred by operator decision and that deferral is now recorded in `ARCHITECTURE.md` itself rather than only here, so there is no round that could resend an unvaried prompt), 8 (commands are spawned with `shell: true` on Windows as `src/harness.ts` does, because `npm run typecheck` is an npm shim; the seeded `governed.yaml` uses npm scripts so the shimmed case is the tested one, and command tokens are constrained to a character set that survives the shell so the audited argv is what ran), 9 (an unresolvable executable is recorded as the repository has already measured it — under `shell: true` the shell starts, names the command on stderr, and exits 1 — rather than as an invented `spawnError`; no setup-time probe is added because these commands are operator-authored and change with the repository, so a `new-run` probe would assert at freeze time a fact only true at stage time), 11 (this repository gains its own committed `governed.yaml`, `new-run` refuses to create a run without one, and the seeded file is asserted against `package.json` at test time, so a fresh checkout either completes a run or refuses before spending), 12 (the effective verification configuration is frozen in the profile, printed per command as the stage runs, and read from the starting commit rather than the working copy, so two checkouts cannot silently verify different things). Entries 1, 3, 4, 5, 6, 10, 13, and 14 do not apply: 1, 3, 10, and 14 concern model output, prompts, model identity, and reviewer independence, and this stage dispatches no agent and resolves no model; 4 concerns fixtures and code agreeing, and the runner's expectations are taken from `test/harness.test.ts`'s recorded behaviour and from `package.json`, not from values invented alongside the code; 5 is step 8's delivery check by the build order's own division; 6 is the plan gate's concern, enforced at step 5; 13 concerns a specification inventing obligations, and this stage reads its obligations from a committed operator-authored file.

**Assumptions:**

- **Remediation rounds are deferred past step 9, and `ARCHITECTURE.md` records the deferral.** Section 12 budgets remediation rounds for `verification`; this step does not build them, and the first failing command blocks the run terminally. Remediation is off the happy path — step 9's milestone is one complete run, and a complete run passes verification — so a round loop roughly doubles the step while buying nothing toward the milestone. Because `CLAUDE.md` calls the architecture binding, a plan-level assumption is not enough: Task 10 amends section 12 to record this and the two deferrals already in force (scope fitness, `status.md`) with their repair semantics. A fresh run is the repair for all three.
- **`new-run` refuses a repository that cannot verify.** A missing `governed.yaml` is refused before the run row exists, not frozen as `null`. The public-key precedent does not transfer: a null `approvalSigner` still permits a run to complete, recorded as unbound, whereas a run frozen without verification commands can only ever block after every expensive stage has spent. Section 7 states the file is authored before the first run, and this is what makes that a precondition rather than a wish.
- **The configuration is read from the starting commit, not the working copy.** `new-run` resolves `HEAD` already; the verification config is read with `git show <commit>:governed.yaml`. Reading the working copy would freeze bytes the run branch does not contain, because the branch is created from that commit. A file absent from the commit is refused as uncommitted even when it exists on disk.
- **`new-run` enforces section 7's clean-tree precondition.** This is an extension beyond step 7 proper, taken because `new-run` is already gaining a precondition block and nothing in `src` enforces the clean tree today — verified by grep. It is called out here so it can be struck without disturbing the rest of the plan.
- **The verification configuration is frozen into the profile at run start**, satisfying hard rule 6 and section 12's naming of "verification config" among what the profile freezes. `new-run` parses and validates it once and passes the result into `freezeProfile`, which does not re-read the file — one read, one source, no window between validation and freeze.
- **`governed.yaml` is read through a strict-subset parser with no dependency.** The repository has no runtime dependencies. The accepted shape is one top-level `verify:` key holding a non-empty sequence of mappings with the keys `name` then `command`, where every `command` token is double-quoted — which makes the bracket span valid JSON as well as valid YAML, so `JSON.parse` reads it. Tokens are additionally constrained to characters that survive a Windows shell, because `shell: true` reinterprets spaces, quotes, and metacharacters and would make the audited argv differ from what ran — the risk `src/profile.ts` already states for model names.
- **Commands run under a named environment passthrough.** Section 17 forbids inheriting the whole environment, and this stage runs code the implementer wrote. `VERIFY_ENV_PASSTHROUGH` lives in `src/policy.ts`, is frozen in `Policy`, and is asserted to contain no `BW_` name — the same guarantee `test/executor.test.ts` already asserts for the executor, and the reason an agent cannot reach `BW_APPROVAL_PUBLIC_KEY`. The list is stated independently of the executor's rather than imported from it: they coincide today because both need the same OS minimum to resolve `node` and `npm`, and coupling them would make one change silently move the other.
- **Filesystem and network containment are a stated limitation, not a claim.** The worktree is the working directory, but nothing prevents a command from reading or writing outside it — `.governance/state.db` is reachable by relative path, and `sandbox.network` is `"inherit"` for the executor too. The repository has no sandboxing mechanism to reuse, and inventing one is not step 7's work. Task 10 records the limitation in `ARCHITECTURE.md` and files a proposal; claiming isolation the code does not provide would be worse than naming the gap.
- **The stage proves it tested the committed deliverable.** Section 4 makes the branch the deliverable. At entry the stage reads the head the implementation stage recorded in its `implementation.gate.pass` audit event, requires the worktree to be at that commit and clean, and re-checks both after every command. A command that modifies a tracked file or advances HEAD blocks the run, because a suite that rewrites snapshots and then passes has verified bytes the branch does not contain. When the recorded head cannot be read or parsed, the stage refuses rather than skipping the check — refuse what cannot be verified, the lesson step 6's review already paid for.
- **The output budget is combined across both streams, taken from the frozen policy, and overflow blocks.** Section 20 requires refusing above the cap and retaining the bytes anyway, so the evidence file receives the complete stream while only the in-memory copy is bounded. The limit is `profile.policy.resultMaxBytes`, already frozen, not the live `RESULT_MAX_BYTES` — reading the constant would discard a value the run had already fixed. Combined rather than per stream, because a command's diagnosis is as likely to be on one stream as the other. **Corrected during implementation:** this assumption originally read "matching how `invokeHarness` spends one budget across both", which is not what `invokeHarness` does — it bounds stdout alone and accumulates stderr unbounded. The combined choice stands on its own merits; the divergence between the two enforcers of the same policy value is now named in `src/verify-command.ts` rather than recorded as a similarity (hazard 12).
- **The stage's `output_ref` is a structured record, not a report.** Section 4: stage N's `output_ref` is literally what stage N+1 was handed. A text report hands `delivery_check` command results and nothing it can compute changed paths from, so the record carries the worktree path, the verified commit, every command's outcome, and the evidence references, with the human-readable report beside it.
- **The stage dispatches nothing, so it resolves no model.** No author, no panel, no `agent_run` row, no `modelMap` entry. `bw verify` takes `--run` and no `--model`.
- **Runs created before this change fail the approval gate's policy re-check** with `policy has changed since intake`, because `Policy` grows three fields. Nothing has shipped, so no compatibility handling is owed (hard rule 3).

**Approach:** Four new modules — a strict-subset parser, a bounded command runner, an audit reader on the store, and the stage orchestrator — plus a frozen profile field, three policy values, `new-run` preconditions, the `bw verify` command, this repository's `governed.yaml`, and two `ARCHITECTURE.md` amendments. No schema change, no migration, no new agent, no dispatch.

**On the three-orchestrator duplication.** The step-6 review deferred the extraction question to this step, expecting step 7's consumer to show what generalizes. It does not: this stage has no author, panel, rounds, model, prompt, or `agent_run` row, so the shape the three dispatching orchestrators share is absent. An interface spanning all four would have to make every one of those optional, which is an interface guessing at differences rather than expressing a commonality. Hard rule 4 is satisfied; the remaining duplication is among the three dispatching stages, is named in `src/implementation-stage.ts`, and this plan adds nothing to it. Recommend closing the question rather than carrying it to step 8.

**Affected areas:** New `src/governed-config.ts`, `src/verify-command.ts`, `src/verification-stage.ts`, `governed.yaml`, `test/governed-config.test.ts`, `test/verify-command.test.ts`, `test/verification-stage.test.ts`, fixture scripts under `test/fixtures/verify/`, and a `docs/proposals/` entry; modify `src/policy.ts`, `src/profile.ts`, `src/store.ts`, `src/cli.ts`, `ARCHITECTURE.md` (sections 12 and 15), `CLAUDE.md`, `README.md`, `test/policy.test.ts`, `test/profile.test.ts`, `test/store.test.ts`, `test/cli.test.ts`.

**Known blockers:**

- **`test/harness.test.ts` records the Windows spawn contract** an earlier draft of this plan contradicted: under `shell: true` an unresolvable command starts the shell, which names it on stderr and exits 1; `spawnError` covers only the case where the shell itself cannot start. The runner's tests take their expectations from that recorded behaviour.
- **`Store` has no audit reader.** `appendAudit` and `verifyAuditChain` exist; nothing returns rows to a caller. Task 7 adds one, which is the only way the stage can read the head implementation recorded without changing step 6.
- **The implementation stage's recorded head is a summary string**, written as `head=<hash>` by `src/implementation-stage.ts`. Parsing it is a coupling between two stages through an audit summary; the guard against that is a strict anchored pattern and a refusal when it does not match, never a skipped check.
- **Requiring `governed.yaml` at `new-run` costs about one line, not six files.** `test/cli.test.ts` creates its temp root through a single shared helper, so the seed lands there. The other five files that freeze profiles call `freezeProfile` directly and are unaffected, because the requirement sits at the CLI and `freezeProfile` receives an already-validated configuration.
- **`test/policy.test.ts` asserts policy field by field** against each enforcing module's constant, so it gains three lines rather than a rewritten literal.
- **`test/profile.test.ts` pins the `modelMap` literal and uses `plan` as its resolvable example.** Neither changes: this stage adds no map entry.
- **`verification` is already in the pinned stage sequence** in `scripts/doc-check.mjs`, so the stage kind needs no checker change.
- **Editing section 15's fence is safe against the checker.** `checkLayout` requires only that the fence still lists `state.db`, `raw/<run>`, `content/<hash>`, and `profiles/<run>` and still omits `migrations/`, and `derive` finds the fence by its `.governance/` substring — verified by reading both. Adding an entry satisfies that; removing one would not.
- **Editing section 12 touches no derived fact.** The checker derives the stage sequence from section 5's fence and the tables from section 15's, not from section 12's prose — verified by reading `derive`.
- **`.governance/` is already gitignored**, so retained output cannot dirty the tree between runs.
- **`npm test` runs files in parallel**, so a single-file pass is not evidence the suite passes. Every task's verification runs the whole suite.
- **The smoke's harness cost is zero for this stage** — it dispatches no model. The end-to-end run that reaches it spends on the earlier stages; budget one step-6-shaped run.

**Blast radius** (verified by import search across `src` and `test` at the time of writing):

- `src/policy.ts` — imported by `src/approval-stage.ts`, `src/cli.ts`, `src/implementation-stage.ts`, `src/plan-gate.ts`, `src/plan-stage.ts`, `src/profile.ts`, `src/spec-stage.ts`, and by `test/cli.test.ts`, `test/plan-stage.test.ts`, `test/policy.test.ts`, `test/profile.test.ts`, `test/spec-stage.test.ts`. The three added fields change `policyHash`, which the approval gate re-checks through `buildBinding`, so pre-existing dev runs refuse with the correct message. No migration owed.
- `src/profile.ts` — imported by `src/approval-stage.ts`, `src/cli.ts`, `src/implementation-stage.ts`, `src/plan-stage.ts`, `src/spec-stage.ts`, and by `test/approval-stage.test.ts`, `test/implementation-stage.test.ts`, `test/plan-stage.test.ts`, `test/profile.test.ts`, `test/spec-stage.test.ts`. `test/cli.test.ts` does not import it — it exercises the CLI by spawning it. `freezeProfile` gains a required parameter, so every direct caller is updated in Task 4.
- `src/store.ts` — imported by every stage module, `src/audit.ts`, `src/cli.ts`, and most test files. The added reader is additive; no existing signature changes.
- `src/harness.ts` — imported by `src/dispatch.ts`, `src/policy.ts`, `test/dispatch.test.ts`, `test/harness.test.ts`, `test/policy.test.ts`. `killTree` is already exported and the runner imports it; `harness.ts` is unchanged. The runner takes its byte budget as a parameter rather than importing `RESULT_MAX_BYTES`, so no new edge is added.
- `src/cli.ts` — no importers; `test/cli.test.ts` spawns it.
- `src/scope.ts` — unchanged. `governed.yaml` is already in `PROTECTED_PATH_PREFIXES`, so no agent-proposed patch can rewrite the commands.
- No consumer of the verification stage exists yet; step 8 is the next caller and consumes the structured record this stage writes.

**Verification:** `npm run typecheck`, `npm test`, `npm run check:docs`. Completion gate: `npm ci && npm run typecheck && npm test && npm run check:docs` from a clean checkout, every break-it cycle recorded with the test that failed and the restore confirmed, plus one manual end-to-end smoke reaching `bw verify` against the real repository suite in a real worktree, recording a passing and a blocking run.

---

### Task 1: The `governed.yaml` strict-subset parser

**Depends on:** None

**Files:**
- Create: `src/governed-config.ts`
- Validate: `test/governed-config.test.ts`

**Steps:**

- [ ] **Step 1: Define the contract**
  - Change: export `interface VerifyCommand { name: string; command: string[] }`, `interface VerificationConfig { commands: VerifyCommand[] }`, and `type ParseResult = { ok: true; config: VerificationConfig } | { ok: false; reason: string }`. Header comment states the accepted shape in full and why every token is double-quoted: it makes the bracket span valid JSON as well as valid YAML, so `JSON.parse` reads it.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 2: Implement `parseGovernedConfig(text)`**
  - Change: line-oriented, refusing by name with a 1-based line number, never throwing. Skip blank lines and lines whose first non-space character is `#`. Rules, each its own refusal: (1) the first content line is exactly `verify:`; (2) each entry opens with two spaces, a hyphen, a space, `name:`, and a scalar — key order is fixed, so an entry opening with `command:` is refused here rather than accepted, because supporting both orders doubles the states the parser must be correct about for no gain; (3) the next content line is four spaces, `command:`, and a bracket span; (4) the name matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, because it becomes part of a retained filename and reaches a path join; (5) names are unique; (6) the bracket span parses as a non-empty JSON array of non-empty strings; (7) **every token matches `^[A-Za-z0-9._:=@+/-]+$`** — no spaces, quotes, or shell metacharacters, because `shell: true` on Windows would reinterpret them and the audited argv would differ from what ran, the risk `src/profile.ts` states for model names; (8) at least one entry is present; (9) any other content is refused as unrecognized.
  - Verify: `npm run typecheck`
  - Expected: clean. Confirm by hand that `npm`, `run`, `typecheck`, `test`, and `check:docs` all satisfy rule (7).

- [ ] **Step 3: Implement `loadGovernedConfigAtCommit(rootDir, commit)`**
  - Change: read the file with `git show <commit>:governed.yaml` via `spawnSync`, mirroring how `resolveStartingCommit` spawns git. Return a distinct refusal for each of: git unavailable or the command failing for any reason other than a missing path; the path absent from the commit (refuse as uncommitted, naming the commit — this is the case where the file exists on disk but was never committed); and a present but unparseable file. Return `{ ok: true, config }` otherwise. There is deliberately no working-copy fallback: the run branch is created from this commit, so working-copy bytes are not what the run will verify against.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 4: Test every accept and every refusal**
  - Change: `test/governed-config.test.ts` covering the accepting case and one test per refusal rule, each asserting the reason names the rule and carries the right line number: unquoted tokens, an empty list, a duplicate name, a name with a path separator, a token containing a space, a token containing an ampersand, a non-`verify` top-level key, a `command` that is a plain string, and an entry with `command` before `name`. For `loadGovernedConfigAtCommit`, build a real temp git repository and cover: parsed from the commit; present on disk but never committed; committed then modified on disk, asserting the committed bytes win.
  - Verify: `npm test`
  - Expected: whole suite passes.

**Task completion evidence:** one named test per refusal rule, plus the three commit-reading cases against a real temp repository.

---

### Task 2: The repository's own `governed.yaml`

**Depends on:** Task 1

**Files:**
- Create: `governed.yaml`
- Modify: `test/governed-config.test.ts`

**Steps:**

- [ ] **Step 1: Write the committed configuration**
  - Change: create `governed.yaml` at the root declaring `typecheck` running `["npm", "run", "typecheck"]`, `test` running `["npm", "test"]`, and `docs` running `["npm", "run", "check:docs"]`, in that order — cheapest failure to diagnose first. Open with a comment naming what the file is and that it is never part of any run's scope.
  - Verify: `cat governed.yaml`
  - Expected: three entries in that order with every token double-quoted. This step has no automated check of its own; Step 2 is where validation lands.

- [ ] **Step 2: Assert the seeded repository can be verified (hazard 11)**
  - Change: add a test parsing the committed file and asserting it names at least one command and that **every command of the form `npm run <script>` names a script present in `package.json`**, read at test time. The expected values come from `package.json`, not from a literal written beside the code.
  - Verify: `npm test`
  - Expected: passes; renaming an npm script without updating `governed.yaml` fails it.

**Task completion evidence:** the committed file, and a seeded-repository test deriving its expectations from `package.json`.

---

### Task 3: Policy — the ceiling, the passthrough, and the frozen output budget

**Depends on:** None

**Files:**
- Modify: `src/policy.ts`
- Modify: `test/policy.test.ts`

**Steps:**

- [ ] **Step 1: Add the three values**
  - Change: export `VERIFY_COMMAND_TIMEOUT_SECONDS = 900`, with a comment giving the reason (a suite plus a typecheck fits comfortably; the ceiling exists to stop a hung command, not to pace a fast one) and the breach behaviour (the process tree is killed and the run blocks naming the command and the limit). Export `VERIFY_ENV_PASSTHROUGH` listing `PATH`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, and `SystemRoot`, with a comment stating that section 17 forbids inheriting the whole environment, that this stage runs implementer-authored code, and that the list is stated independently of the executor's rather than imported from it — they coincide because both need the same OS minimum, and coupling them would make one change silently move the other. Add `verifyCommandTimeoutSeconds` and `verifyEnvPassthrough` to `Policy` and populate both in `buildPolicy`. `resultMaxBytes` is already present and is the output budget; no new field is needed for it.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 2: Extend the assertions**
  - Change: in `test/policy.test.ts`, add the two field-by-field assertions against the enforcing module's constants. Add a test asserting **no name in `VERIFY_ENV_PASSTHROUGH` starts with `BW_`**, modelled on the existing assertion in `test/executor.test.ts`, with a comment naming what it protects: an implementer-authored command must not be able to read the approval public key that binds the signer.
  - Verify: `npm test`
  - Expected: passes.

**Task completion evidence:** three new policy assertions, including the `BW_` exclusion; `policyHash` changed, which is the intended consequence for pre-existing dev runs.

---

### Task 4: Freeze the validated configuration in the profile

**Depends on:** Task 1

**Files:**
- Modify: `src/profile.ts`
- Modify: `test/profile.test.ts`

**Steps:**

- [ ] **Step 1: Add the field and the parameter**
  - Change: add `verification: VerificationConfig` to `Profile` — not nullable, because a run that cannot verify is now refused before it exists. Replace the header comment sentence saying the verification config is absent because `governed.yaml` is step 7's input; that is no longer true and the comment is the design's record. Add a required `verification: VerificationConfig` parameter to `freezeProfile` and store it. `freezeProfile` does not read `governed.yaml`: the caller has already validated it against the starting commit, and re-reading would open a window between validation and freeze.
  - Verify: `npm run typecheck`
  - Expected: fails at every `freezeProfile` call site, which is the list of callers to update.

- [ ] **Step 2: Update the direct callers**
  - Change: update `src/cli.ts` (Task 5 covers its precondition work) and every test that calls `freezeProfile` directly — `test/profile.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, `test/implementation-stage.test.ts`, `test/approval-stage.test.ts` — to pass a configuration. Give the test helpers a single shared minimal config so the addition is one definition, not five.
  - Verify: `npm run typecheck` then `npm test`
  - Expected: both clean.

- [ ] **Step 3: Test the freeze**
  - Change: in `test/profile.test.ts`, assert the frozen configuration round-trips through `loadProfile` byte-identically and that the profile hash still reproduces from the re-read bytes. Do not modify the `modelMap` pins.
  - Verify: `npm test`
  - Expected: whole suite passes.

**Task completion evidence:** `Profile.verification` non-nullable, every direct caller updated, the round-trip asserted.

---

### Task 5: `new-run` preconditions

**Depends on:** Tasks 1, 4

**Files:**
- Modify: `src/cli.ts` — the `new-run` case
- Modify: `test/cli.test.ts`

**Steps:**

- [ ] **Step 1: Refuse before the row exists**
  - Change: in the `new-run` case, before the insert and beside the existing `--model` validation, in order: resolve the starting commit; refuse when there is no git repository, naming that; refuse when `git status --porcelain` reports anything, naming the clean-tree precondition from section 7 and showing the first few offending paths; call `loadGovernedConfigAtCommit` and refuse with its reason when it fails. Pass the validated configuration into `freezeProfile` after the insert. Comment why all of this sits before the insert: a repository that cannot verify must not get a run row that is guaranteed to block after every expensive stage has spent.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 2: Test each refusal, and that no row survives**
  - Change: in `test/cli.test.ts`, seed the shared temp-root helper with a committed `governed.yaml` so existing tests keep passing. Add: no `governed.yaml` in the commit refuses and **creates no run row**; a malformed one refuses and creates no row; a `governed.yaml` present on disk but uncommitted refuses and creates no row; a dirty working tree refuses and creates no row. The no-row assertion is what proves the checks run before the insert.
  - Verify: `npm test`
  - Expected: whole suite passes.

**Task completion evidence:** four refusals, each asserting the database holds no run afterwards.

---

### Task 6: The bounded command runner

**Depends on:** Tasks 1, 3

**Files:**
- Create: `src/verify-command.ts`
- Create: fixture scripts under `test/fixtures/verify/`
- Validate: `test/verify-command.test.ts`

**Steps:**

- [ ] **Step 1: Define the outcome contract**
  - Change: export `interface CommandOutcome { name: string; argv: string[]; exitCode: number | null; timedOut: boolean; spawnError: string | null; killError: string | null; stdout: string; stderr: string; durationMs: number; outputOverflow: boolean; evidenceRef: string }`. Mirror `HarnessOutcome`'s naming deliberately, including `killError`, and comment that the two are separate contracts because their inputs differ — hard rule 4 forbids extracting a shared spawn abstraction until something needs one.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 2: Implement `runVerifyCommand(cmd, opts)`**
  - Change: async, taking `{ cwd, timeoutSeconds, maxBytes, envPassthrough, evidencePath }`. Build `env` by copying only the named passthrough variables from `process.env`, exactly as `invokeHarness` does — never spread `process.env`. Spawn with `shell` true on Windows, `detached` on POSIX so the negative pid reaches the group, and the given `cwd`. **Open a write stream to `evidencePath` and write every chunk of both streams to it as it arrives**, so the complete output is retained regardless of the in-memory budget; accumulate in memory only up to `maxBytes` **combined across both streams**, setting `outputOverflow` when the budget is exhausted. Set an absolute timer at `timeoutSeconds`; on fire, call `killTree` and record `killError` when it throws, resolving with `timedOut: true`. `child.pid` is `number | undefined` and strict mode refuses the call without a guard: an undefined pid means no process was created, which is a `spawnError`, not a timeout that killed nothing. Allow the harness's close-grace period between `exit` and `close` so late output is not lost. Clear the timer on close.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 3: Write the fixtures**
  - Change: `exit-zero.mjs` prints a marker and exits 0. `exit-two.mjs` prints to stderr and exits 2. `print-cwd.mjs` prints `process.cwd()`. `print-env.mjs` prints the full environment as JSON — this is the canary. `hang-with-child.mjs` spawns a detached sleeping child, prints its pid, then sleeps, modelled on `test/fixtures/harness/spawn-grandchild.mjs`. `flood-stdout.mjs` writes well beyond any test budget. `touch-tracked.mjs` appends a byte to a tracked file and exits 0.
  - Verify: `node test/fixtures/verify/exit-two.mjs; echo $?`
  - Expected: the stderr marker and `2`.

- [ ] **Step 4: Test the runner**
  - Change: `test/verify-command.test.ts` asserting: exit 0 and exit 2 carry their markers on the right streams; `print-cwd.mjs` under a temp `cwd` prints that directory; **`print-env.mjs` with a canary variable set in the parent does not show the canary and does show `PATH`** — the environment guarantee, asserted in both directions; an unresolvable command yields `exitCode` 1 with the command named on stderr, **taking the expectation from `test/harness.test.ts`'s recorded behaviour rather than inventing one**, and `spawnError` covers only the shell failing to start; `flood-stdout.mjs` under a small `maxBytes` sets `outputOverflow`, keeps the in-memory copy within budget, and leaves an evidence file **larger than the budget**, proving retention is independent of the cap; `hang-with-child.mjs` under a 2-second ceiling yields `timedOut: true`, resolves well inside the fixture's own sleep, and leaves the grandchild dead. Assert the duration bound explicitly — a killed run can look green because Node's exit teardown kills the hung child.
  - Verify: `npm test`
  - Expected: whole suite passes.

**Task completion evidence:** the environment canary asserted in both directions, the overflow evidence file larger than the in-memory budget, and the tree-kill proven by duration and grandchild death.

---

### Task 7: An audit reader on the store

**Depends on:** None

**Files:**
- Modify: `src/store.ts`
- Validate: `test/store.test.ts`

**Steps:**

- [ ] **Step 1: Add the reader**
  - Change: add `getAuditEvents(runId: number): AuditRow[]` returning rows for the run ordered by `id` ascending. Additive only; no existing signature changes. Comment its one current consumer and why it exists: the verification stage must read the head the implementation stage recorded, and an audit event is where that fact lives.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 2: Test it**
  - Change: in `test/store.test.ts`, assert events come back in insertion order, that another run's events are excluded, and that an unknown run returns an empty array.
  - Verify: `npm test`
  - Expected: passes.

**Task completion evidence:** three store assertions covering order, isolation, and the empty case.

---

### Task 8: The verification stage orchestrator

**Depends on:** Tasks 4, 6, 7

**Files:**
- Create: `src/verification-stage.ts`
- Validate: `test/verification-stage.test.ts`

**Steps:**

- [ ] **Step 1: Preconditions, each refused by name**
  - Change: export `runVerificationStage(store, input: { runId, rootDir })` returning `{ ok: true; stageId; resultRef } | { ok: false; reason }`. In order: the run exists; `requireRunInProgress`; the chain has no `verification` stage (naming the existing one's status); the last stage is an `implementation` with status `passed` and a non-empty `output_ref`; the worktree at that path exists; `loadVerifiedProfile`; the run's age is within `profile.policy.runDurationLimitSeconds`; the recorded implementation head is readable — read the run's audit events, take the last `implementation.gate.pass`, and extract the commit with a pattern anchored to `^head=([0-9a-f]{40}|[0-9a-f]{64})$`, refusing when the event is missing or the summary does not match; the worktree's `HEAD` equals that commit; and `git status --porcelain` in the worktree is empty. No `resolveStageModel` call — this stage dispatches nothing.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 2: Run the commands under the frozen limits**
  - Change: insert the stage with kind `verification` and `input_stage_id` set to the implementation row, set it in progress. For each command in frozen order, call `runVerifyCommand` with the worktree as `cwd`, `profile.policy.verifyCommandTimeoutSeconds`, `profile.policy.resultMaxBytes`, `profile.policy.verifyEnvPassthrough`, and an evidence path under `.governance/verification/<run-id>/`. After each command, re-read `HEAD` and `git status --porcelain` in the worktree. Append an audit event naming the command, its argv, its exit code or timeout, its duration, and the evidence path; print one progress line per command as it finishes, which is what makes the effective configuration visible at the operator's surface (hazard 12) and is a stage responsibility because only the stage knows a command has finished before the run has.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 3: The deterministic decision**
  - Change: the first command that exits non-zero, times out, reports a spawn error, sets `outputOverflow`, moves `HEAD`, or leaves the worktree dirty stops the loop and blocks — four command-failure conditions plus the integrity pair, six in all. Overflow blocks because section 20 requires refusing above the cap; a moved head or a dirty tree blocks because the run would otherwise report having verified bytes the branch does not contain. On block: write the record and the report, `completeStage(stage.id, resultRef, "block")`, `setRunStatus(runId, "blocked")`, audit the cause, return the refusal. On pass: write both, `completeStage(stage.id, resultRef, "pass")`, audit, return `ok`. The record is JSON at `.governance/verification/<run-id>/result.json` carrying the worktree path, the verified commit, every command's outcome with its evidence reference, the overall outcome, and the name of the blocking command when there is one; `resultRef` is its path relative to `rootDir`, so `delivery_check` is handed the worktree and the commit rather than a report it cannot act on.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 4: The wedge guard**
  - Change: wrap the body in try/catch as `runImplementationStage` does — an unexpected throw completes a pending or in-progress stage as blocked, audits the reason, sets the run blocked, and returns a refusal.
  - Verify: `npm run typecheck`
  - Expected: clean.

- [ ] **Step 5: Test the stage**
  - Change: `test/verification-stage.test.ts` building a run to a passed `implementation` stage with a real git worktree and a profile frozen with fixture commands. Cover the pass path (stage `passed`, run still `in_progress`, the record naming the worktree and the verified commit, every command present with an evidence reference); **six block paths** — non-zero exit, timeout, unresolvable command, output overflow, a command that dirties the tree via `touch-tracked.mjs` while exiting zero, and a pre-existing dirty worktree at entry; the refusal when the `implementation.gate.pass` event is absent and when its summary does not match the pattern; every other precondition refusal by name; and that commands run in the worktree by asserting `print-cwd.mjs`'s evidence holds the worktree path, not the repository root.
  - Verify: `npm test`
  - Expected: whole suite passes.

**Task completion evidence:** the pass path, six block paths, both head-parsing refusals, every precondition refusal, and the worktree-cwd proof.

---

### Task 9: `bw verify`

**Depends on:** Task 8

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`

**Steps:**

- [ ] **Step 1: Wire the command**
  - Change: add `verify` to the known-command array and a `USAGE` line reading `verify --run <id>` described as running the verification stage, after the `implement` line and visually distinct from `verify-audit`. Add `case "verify"` calling `runVerificationStage(store, { runId: numeric(args, "run"), rootDir: process.cwd() })`, printing `resultRef` on success and the reason to stderr with exit code 1 on refusal, the shape `implement` uses. Per-command progress comes from the stage, so the CLI adds none. Do not accept `--model`.
  - Verify: `node src/cli.ts`
  - Expected: usage lists `verify --run <id>` and still lists `verify-audit`.

- [ ] **Step 2: Test the surface**
  - Change: assert `verify` with no `--run` is a usage error, and that `verify --run` naming a nonexistent run exits 1 with the stage's refusal on stderr.
  - Verify: `npm test`
  - Expected: passes.

**Task completion evidence:** both CLI assertions passing; the usage text distinguishes `verify` from `verify-audit`.

---

### Task 10: Documentation and the recorded deferrals

**Depends on:** Tasks 1 through 9

**Files:**
- Modify: `ARCHITECTURE.md` — sections 12 and 15
- Modify: `CLAUDE.md`, `README.md`
- Create: a `docs/proposals/` entry for verification containment

**Steps:**

- [ ] **Step 1: Record the deferrals in the design**
  - Change: in section 12, after the `verification` paragraph, add a short subsection recording what is deliberately not built before the step 9 milestone and what repairs each: verification remediation rounds, scope-fitness proposals, and the `status.md` projection — in each case a terminal block with the cause named, and a fresh run as the repair. This is what makes the deferrals part of the binding document instead of three plan-level assumptions, two of which are already in force unrecorded. Keep the existing paragraphs untouched.
  - Verify: `npm run check:docs`
  - Expected: exit 0. The checker derives the stage sequence from section 5 and the tables from section 15, not from section 12's prose, so this edit touches no derived fact.

- [ ] **Step 2: Record the retained-output directory and the containment limitation**
  - Change: add one line to section 15's `.governance/` tree for the verification directory — retained command output and result records, one directory per run. In section 17, add a sentence stating that verification commands run under a named passthrough but are not otherwise contained: they run with the worktree as their working directory and can reach the rest of the filesystem and the network, and containment is unbuilt. File a `docs/proposals/` entry describing the gap and the options, so the limitation is recorded as work rather than as an accepted end state.
  - Verify: `npm run check:docs`
  - Expected: exit 0; `checkLayout`'s four required entries are still present and `migrations/` is still absent.

- [ ] **Step 3: Update the command list and status prose**
  - Change: add `verify` to `CLAUDE.md`'s command list. Extend `README.md`'s build-order paragraph to steps 1-7 with one sentence on the verification stage, matching the detail the other stages get.
  - Verify: `npm run check:docs`
  - Expected: exit 0.

**Task completion evidence:** `npm run check:docs` output recorded with no new findings against the current-tier documents; the deferral subsection and the containment sentence present in `ARCHITECTURE.md`.

---

### Task 11: Prove each guard by breaking what it guards

**Depends on:** Tasks 1 through 10

**Files:**
- Validate: every test file added or modified by this plan

**Steps:**

- [ ] **Step 1: Confirm the direction of each attack first**
  - Change: for each target, establish at the shell that the break reaches the guard before writing anything. A break-it item named in a plan is a hypothesis, and a test written to fail that passes on first run is a defect in the test.
  - Verify: the shell check appropriate to each target
  - Expected: each attack is reachable, or the item is revised and the revision recorded.

- [ ] **Step 2: One break-restore cycle per guard, one cycle per tool call**
  - Change: `git add -A` (no commit), break, run the named test, `git checkout -- <path>`, confirm with `git diff --quiet -- <path>`; a non-zero result halts. Prefer a scratchpad mirror where the code under test can run against a copy — the parser and the runner both can. Targets: (a) parser accepts a wrong top-level key; (b) accepts unquoted tokens; (c) accepts an empty list; (d) accepts a duplicate name; (e) accepts a name with a path separator; (f) accepts a token containing a space; (g) `loadGovernedConfigAtCommit` falls back to the working copy; (h) it accepts a file absent from the commit; (i) `new-run` skips the clean-tree check; (j) `new-run` moves the config check after the insert; (k) `freezeProfile` re-reads the file instead of taking the parameter; (l) the runner spreads `process.env`; (m) the runner writes the evidence file only up to the cap; (n) the runner uses `child.kill()` instead of `killTree`; (o) the runner drops `cwd`; (p) the stage ignores a non-zero exit; (q) ignores a timeout; (r) ignores overflow; (s) ignores a moved head; (t) ignores a dirty worktree; (u) skips the head check when the audit event is missing; (v) reads `RESULT_MAX_BYTES` instead of `profile.policy.resultMaxBytes`; (w) reads `VERIFY_COMMAND_TIMEOUT_SECONDS` instead of the frozen value; (x) `output_ref` reverts to the text report.
  - Verify: for each cycle, the named test fails while broken and the tree is clean after restore
  - Expected: twenty-four observed failures, each matching exactly the test named for it. A guard whose break does not fail its test is a defect to fix before the task closes.

- [ ] **Step 3: Record the outcome**
  - Change: record each cycle's target, the failing test, and the restore confirmation.
  - Verify: `npm test` and `git status --short` after the last restore
  - Expected: the suite passes and the tree is clean.

**Task completion evidence:** twenty-four recorded cycles, each naming the guard, the failing test, and the confirmed restore.

---

### Task 12: Manual end-to-end smoke

**Depends on:** Task 11

**Files:**
- Validate: a scratch repository outside the working tree

**Steps:**

- [ ] **Step 1: Drive a run to a passed implementation stage**
  - Change: in a scratch git repository holding its own committed `governed.yaml` with cheap real commands, run `migrate`, `new-run`, `spec`, `approval-request`, sign, `approve`, `plan`, `implement` against the real `claude` binary, as the step-6 smoke did.
  - Verify: `bw implement --run <id>` prints a worktree path
  - Expected: a passed implementation stage with projections and the applied patch committed. Record the cost.

- [ ] **Step 2: Verify for real**
  - Change: run `bw verify --run <id>`.
  - Verify: the command prints the result path and exits 0
  - Expected: every command ran in the worktree, each has an evidence file, the audit names each with its exit code, the record carries the worktree path and the verified commit, the stage is `passed`, and the run is still `in_progress`.

- [ ] **Step 3: Prove the block path and the environment guarantee against the real binary**
  - Change: on a fresh run through the same sequence, make one configured command genuinely fail in the scratch repository — not by editing the system's own code. Separately, set a canary variable in the parent shell and add a command that prints its environment, confirming the canary does not appear in the evidence file.
  - Verify: `bw verify --run <id>` exits 1 naming the failing command
  - Expected: the stage is `blocked`, the run is `blocked`, the evidence holds the real failure output, the worktree survives, and the canary is absent from the retained environment dump.

- [ ] **Step 4: Record the evidence**
  - Change: record run ids, the cost of the earlier stages, each command's duration, and the evidence paths.
  - Verify: `npm test` in the working tree afterwards
  - Expected: unaffected; the smoke runs against a scratch repository.

**Task completion evidence:** one passing and one blocking verification stage against the real binary, plus the environment canary confirmed absent from real retained output.

---

## Gate

Complete when `npm ci && npm run typecheck && npm test && npm run check:docs` passes from a clean checkout, all twenty-four break-restore cycles are recorded with the test each one failed, and Task 12 has recorded a passing run, a blocking run, and the environment canary's absence against the real harness. Step 8 (delivery check) is the next build-order step, and consumes the structured record this stage writes. The deliberate stop at step 9 stands.

---

## Implementation note

**Date:** 2026-08-31

**The upstream block is resolved.** The step-6 trust-boundary correction
(`docs/features/step6-trust-boundary/plan.md`, on master) closes the
implementer-mutates-worktree defect: the implementer runs read-only at the
invocation boundary, the stage asserts a clean worktree before and after
dispatch, patch paths travel literally, link components fail closed, and the
frozen executor and agents bind every dispatch construction site. This
branch has been rebased onto the corrected master; Task 12 now runs against
the corrected executor and is completed in the entry below.

**Date:** 2026-08-30

**Tasks 1 through 11 are complete; Task 12 is outstanding.** The plan's status
stays `Proposed` because its own gate names Task 12, and a manual end-to-end
smoke against the real harness has not run.

### What shipped

Four new modules as designed — `src/governed-config.ts` (the strict-subset
parser and the commit reader), `src/verify-command.ts` (the bounded runner),
`src/verification-stage.ts` (the orchestrator), plus `governed.yaml` — with
`Profile.verification` non-nullable, four policy values, the `new-run`
preconditions, `Store.getAuditEvents`, `bw verify`, both `ARCHITECTURE.md`
amendments, and `docs/proposals/verification-containment.md`. No schema change,
no migration, no dispatch.

Verification: `npm run typecheck` clean, `npm test` 429 passed / 1 skipped / 0
failed, `npm run check:docs` clean. All twenty-four break-restore cycles failed
while broken and were restored byte for byte — recorded in
`docs/features/verification-stage/2026-08-30-break-it.md`, including the two
items that needed the plan's revision clause and the one that is caught by a
hang rather than an assertion.

### What deviated

- **A fourth policy value the plan did not name.**
  `VERIFY_RETENTION_MAX_BYTES` (64 MB) was added while reconciling the code
  review's second finding. The plan assumed retention could be unbounded
  because the in-memory copy was capped; measured, an endless command wrote
  5.97 GB in 5.2 seconds, which is about 955 GB inside the frozen 900-second
  command ceiling. `ARCHITECTURE.md` section 20's result-size bullet is amended
  to say that retention is bounded too, because "retain the bytes anyway" is a
  rule written about a bounded result.
- **`new-run`'s clean-tree check excludes `.governance/`.** As planned it was
  unconditionally broken: `openStore()` creates the state directory before the
  check runs, so no repository without that path already gitignored could ever
  create a run. Hazard 11, confirmed by reproduction and now covered by a test
  that builds a repository with no `.gitignore` at all.
- **One shared `VERIFICATION` constant per test file**, not one across all
  five. The plan asked for "one definition, not five"; the plan's own affected
  areas listed no shared test-support module, and adding one would have been a
  new pattern in a repository where every test file defines its own constants.
- **An extra fixture and an extra block path.** `commit-empty.mjs` covers a
  command that advances the branch while exiting zero, so the after-command
  head check has a test of its own rather than sharing the entry-time one.
- **The output-budget assumption was corrected in place** — see the note on it
  above. The behaviour is unchanged; the justification was wrong about
  `invokeHarness`.

### Task 12: attempted, blocked upstream

The smoke ran against the real binary and **did not reach `bw verify`'s pass
path.** It blocked one stage earlier, in step 6.

A scratch repository outside the working tree, its own committed
`governed.yaml` naming `["node", "--version"]` and `["npm", "--version"]` —
`npm` deliberately, because it is a Windows shim and that is hazard 8's path
exercised for real. A throwaway Ed25519 keypair in the scratchpad, since no
operator key exists at `~/.buildworks/approval.pub` on this machine.

What worked, all against `claude-sonnet-5`:

- `bw new-run` froze the verification configuration read from the starting
  commit — `node-version` and `npm-version`, in order — and bound the signer.
- `bw spec` passed in two rounds (4 dispatches), `bw approval-request` printed
  a payload whose scope was the two declared artifacts, `sign` and
  `bw approve` recorded the authorization, `bw plan` passed (2 dispatches).
- `bw implement` created the worktree on `gov/clamp/1`, committed the
  projections, dispatched the implementer — and blocked.

**Seven dispatches, $0.5021, about two minutes of harness time.**

`bw implement` blocked with `add requires the file not to exist:
src/clamp.mjs`. The implementer had written the files into the worktree with
its own tools and then also returned them as `add` patches. The gate is right
and the model is not being unreasonable: the prompt forbids git commands and
never forbids writing files. Filed as
`docs/proposals/implementer-writes-files-it-also-proposes.md` — step 6 scope,
not folded in here.

**Corrected after first writing this note:** step 6 *was* smoked, and it
passed — one dispatch, $0.0673, "valid patch set on the first attempt". This
note originally said no step-6 smoke existed, from a grep hit misattributed to
step 2 without opening the entry around it. The correction makes the defect
worse rather than better: same prompt and same model, one run wrote the files
and one did not, so `bw implement` passes or blocks on model whim and its
single smoke happened to land on the good side. It also means a retry here may
simply succeed.

What the smoke did establish about *this* stage, against real state rather
than fixtures: `bw verify --run 1` refuses the blocked run by name
(`run 1 is blocked, not in_progress`, exit 1), `bw verify --run 99` refuses a
run that does not exist, the usage text distinguishes `verify` from
`verify-audit`, and `bw verify-audit` reports the chain valid across all
seven dispatches and both blocked stages.

**Still unproven, and it is the part that matters:** a passing verification
stage, a blocking one, and the environment canary absent from real retained
output. All three need a passed `implementation` stage, which needs the step 6
prompt fixed first. The stage is proven against fixtures, a real git worktree,
and twenty-four break-restore cycles — but never against a run the real binary
drove to completion.
