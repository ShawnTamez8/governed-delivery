# Debugging Analysis

## Problem

Step 7's required end-to-end verification smoke cannot yet reach verification. The
real `bw implement` invocation in its scratch run let the implementer mutate the
implementation worktree, then received `add` proposals for the same files. The
step-6 gate correctly refused the first file because it already existed.

This is not a step-7 verification-stage failure. It is a step-6 trust-boundary
failure exposed while step 7 tried to consume a passed implementation.

There is no `step6` branch in the repository. Step 6 is on `master` at `32a714e`
(with its session commit at `d82b894`); `step7` forks from that point at `3be15fd`
and carries a correction at `a864483`.

## Expected Behavior

The implementation subprocess may inspect the run worktree and return typed,
whole-file patch proposals. It may not mutate the worktree itself. BuildWorks
must start from a clean proposal base, validate every proposed path against the
operator-signed scope and the protected-path rules, write only validated content,
commit exactly the validated paths, and hand a clean worktree and exact final
commit to verification.

This follows the binding design:

- "Agents propose. The system decides" (`ARCHITECTURE.md:13-28`).
- Agents may not run commands outside an allowlist or write outside allowed paths
  (`ARCHITECTURE.md:113-124`).
- Prompt instructions are requests; enforcement belongs in the write path
  (`ARCHITECTURE.md:166-178`).
- The caller, not the agent, enforces the sandbox (`ARCHITECTURE.md:388-391`).
- Config is frozen at run start (`ARCHITECTURE.md:50-70`).

## Actual Behavior

The recorded step-7 smoke reached the seventh paid dispatch. The implementer
created `src/clamp.mjs` and `test/clamp.test.mjs` in the worktree, then returned
both as `add` patches. `bw implement` blocked with:

```text
add requires the file not to exist: src/clamp.mjs
```

The retained worktree reported:

```text
?? src/
?? test/
```

The attempt spent `$0.5021` across seven dispatches; the final implementation
dispatch cost `$0.1319`. Step 7 therefore never exercised its required pass,
block, or environment-canary paths. Branch evidence:

- `step7:docs/features/verification-stage/plan.md:377-422,467-519`
- `step7:docs/features/verification-stage/tasks.md:3,19`
- `step7:docs/proposals/implementer-writes-files-it-also-proposes.md:3-30`

The failure is behavior-dependent, not guaranteed on every run. The earlier
step-6 smoke used the same prompt template and model and returned JSON without
writing files. Commit `a864483` correctly retracts the earlier claims that step 6
had never been smoked and that a retry would necessarily reproduce the failure.
A retry may pass, but that would be another sample, not enforcement.

## Reproducibility

**Classification:** observed once against the real harness; deterministic
mechanisms reproduced locally without model spend.

### Recorded real reproduction

1. Create and initialize the scratch repository described in
   `step7:docs/features/verification-stage/plan.md:386-406`.
2. Drive `migrate`, `new-run`, `spec`, approval, and `plan` through their passing
   gates.
3. Run `bw implement --run 1` using `claude-sonnet-5`.
4. Observe the add-over-existing refusal and the untracked `src/` and `test/`
   directories in `.governance/worktrees/1`.

### Local deterministic reproductions

An isolated clone of `master` was modified only in the temporary directory and
removed after the checks.

1. A fixture subprocess wrote `unreported.txt`, returned an otherwise valid
   proposal, and the current implementation stage returned `ok: true` with
   `?? unreported.txt` still in the handed-off worktree.
2. An approved lexical path `src/alias/x.ts` was redirected by a junction to the
   ordinary, unprotected, out-of-scope path `ordinary-target/x.ts`. The current
   stage returned `ok: true`; the target existed and remained untracked.
3. A signed artifact literally named `-A` accompanied an unreported child write.
   The current `git add` call interpreted the path as the `-A` option; the patch
   commit contained both `-A` and `unreported.txt` while the stage returned
   `ok: true`.

All three diagnostic tests passed because they asserted the current defective
behavior. They are not repository fixtures and were not retained.

The existing add-over-existing gate test was also rerun and passed. That proves
the refusal observed in the real smoke is the intended gate behavior, not the
root defect.

## Evidence

### 1. Declared sandbox controls are not executed

`ExecutorDefinition` declares allowed paths, denied paths, and a command
allowlist (`src/executor.ts:1-21,30-51`). The implementer itself declares an empty
command allowlist (`src/agents/implementer.ts:3-10`). `invokeHarness` enforces only
the environment passthrough, timeouts, cwd, and command (`src/harness.ts:153-181`);
it never translates the path or command restrictions into process controls.

The implementation prompt says "read" and forbids Git commands, but does not say
the checkout is proposal-only (`src/prompts.ts:202-241`). More importantly, the
design explicitly says a prompt is not enforcement (`ARCHITECTURE.md:166-178`).
The stage invokes the process in the same mutable worktree the gate later treats
as its base (`src/implementation-stage.ts:309-335`) and performs no cleanliness
check before parsing or applying the result (`src/implementation-stage.ts:341-522`).

The installed Claude Code 2.1.251 CLI exposes enforceable controls that the
executor does not use: `--restricted`, `--safe-mode`, `--tools`,
`--disallowedTools`, `--permission-mode dontAsk`, `--strict-mcp-config`, and
`--no-session-persistence`. Its help also confirms that `--allowedTools` grants
approval but does not define the available tool inventory.

### 2. Untrusted patch paths reach Git as options/pathspecs

The spec parser accepts a repo-relative artifact named `-A`
(`src/spec-doc.ts:38-53`). The lexical scope gate accepts that exact signed path
(`src/implementation-gate.ts:27-66`). Application passes it directly to
`git add` without an option terminator or literal-pathspec mode
(`src/implementation-stage.ts:480-493`). The subsequent commit and audit do not
compare actual staged/committed paths with the proposal
(`src/implementation-stage.ts:495-511`).

A separate bare Git scratch check also produced both `-A` and `unreported.txt`
in the index after the equivalent `git add -A` invocation.

### 3. Resolved targets are not checked against signed scope

Lexical paths are checked against scope. A resolved link target is checked only
for worktree containment and protected status
(`src/implementation-stage.ts:418-466`). It is not checked with
`pathFitsScope`. `writeFileSync` then follows the link, while `git add` receives
the lexical alias (`src/implementation-stage.ts:480-493`). Existing tests cover
a protected target, an outside-worktree target, and a dangling target, but not an
ordinary in-repository target outside signed scope
(`test/implementation-stage.test.ts:501-540`). The isolated reproduction above
confirmed that omission reaches a passing stage.

This redirect class has already required multiple corrections. Trying to model
one more "safe" target category would repeat the failed assumption. Nothing in
the architecture requires link traversal in patch paths.

### 4. Frozen agents/executor and capability preflight are ignored

The profile snapshots agents and the executor (`src/profile.ts:120-140`), but the
implementation stage selects the live global agent and accepts the caller's live
executor (`src/implementation-stage.ts:53-56,309-335`). The CLI supplies live
`CLAUDE_CODE` (`src/cli.ts:347-352`). The frozen executor declares only `plan`
and `review`, not implementation (`src/executor.ts:30-35`), yet the stage runs.

This is dynamically visible in the current success test: `withApprovedRun`
freezes live `CLAUDE_CODE`, then the test passes a different executor whose
capabilities are empty, and expects the stage to pass
(`test/implementation-stage.test.ts:49-65,140-143,242-289`). That test passed in
the master baseline.

The same construction occurs in `spec-stage.ts`, `plan-stage.ts`, and the raw
`dispatch` CLI: they freeze the model but use live agent/executor definitions.
A fix limited to `runImplementationStage` would fix the immediate component but
would not satisfy hard rule 6 for a complete run.

## Likely Failing Layer

**Integration/configuration boundary, with deterministic-gate gaps.**

The observed add-over-existing refusal is in the service/business-logic gate,
but that gate is behaving correctly. The cause is the unenforced boundary
between the Claude Code subprocess and the worktree. The dirty-worktree,
option-like-path, link-redirect, and frozen-config gaps then allow related cases
to pass instead of block.

Step 7's verification implementation is ruled out as the cause because its
entry precondition was never reached. Its seven plan findings and three code
findings are recorded as reconciled; Task 12 remains its only implementation
gate.

## Scope Narrowing

Ruled out:

- **Patch body parsing:** the real response parsed and reached existence checks.
- **Add semantics:** the existing test and targeted rerun show the gate correctly
  refuses `add` over an existing file.
- **Step-7 command runner:** no verification command ran in the failed smoke.
- **A deterministic model regression:** one earlier compliant run and one later
  mutating run show the prompt does not establish a guarantee.

Still in scope for the step-6 correction:

- frozen actor/executor binding at every dispatch construction site;
- enforceable read-only Claude Code invocation;
- clean worktree as a gate precondition/postcondition;
- literal Git path handling and exact staged/committed path equality;
- fail-closed handling of link/junction components.

Outside this correction:

- step 7's broader verification-command containment proposal;
- the pre-existing unbounded harness-stderr issue;
- the step-7 branch's record wording inconsistencies (for example, README calls
  step 7 implemented while its feature plan remains Proposed).

## Hypothesis

**Hypothesis:** Step 6 relies on the model to behave as proposal-only while the
live executor is allowed to mutate the same worktree used by the deterministic
gate. Because the stage neither uses the frozen sandbox configuration nor
asserts a clean proposal base, model-side writes can either cause the observed
safe refusal or survive into a passed verification input. Independent path
handling gaps can commit or expose additional unsigned content.

**How tested:** trace executor construction and every write/commit call; rerun the
existing add collision test; run isolated child-write, junction, and option-path
reproductions; compare the installed CLI's actual controls with the executor
command; run the current master baseline.

## Hypothesis Result

**Confirmed.**

- The real harness produced the reported mutation and refusal.
- An unreported direct write survived a passing implementation stage.
- A junction reached an ordinary out-of-scope target and the stage passed.
- `-A` caused an unreported file to enter the patch commit and the stage passed.
- A non-frozen, capability-empty executor already passes the repository's success
  test.
- The source contains no compensating cleanliness, staged-set, committed-set, or
  frozen-executor check.

## Codebase Review

**Files read:** `ARCHITECTURE.md`, `docs/hazards.md`, `src/executor.ts`,
`src/harness.ts`, `src/dispatch.ts`, `src/profile.ts`, `src/agents.ts`,
`src/agents/implementer.ts`, `src/spec-doc.ts`, `src/implementation-gate.ts`,
`src/implementation-stage.ts`, `src/prompts.ts`, `src/cli.ts`, the implementation
fixture, and the complete implementation-stage test file. Construction sites in
spec and plan stages were traced by search.

**Callers/dependents:** CLI `implement` -> `runImplementationStage` ->
`dispatchOnce` -> `invokeHarness`; step 7 consumes the passed implementation
stage's worktree and `implementation.gate.pass` head. Spec, plan, and raw dispatch
share the frozen-config defect.

**Existing coverage:** ordinary success, base mismatch, lexical scope, protected
paths, head movement, add/modify existence, outside-worktree/protected/dangling
links, profile model lookup, executor env filtering, and argv model forwarding.
It does not cover proposal-time mutation, exact committed path equality, ordinary
out-of-scope link targets, executor capability, or frozen actor/executor use.

**Baseline:**

- `npm test`: 368 tests, 367 passed, 1 recorded skip, 0 failed.
- `npm run typecheck`: clean.
- `npm run check:docs`: clean, with 25 historical path warnings.
- Focused add-over-existing test: 1 passed.
- Working tree remained clean after baseline commands.

## Proposed Fix

A prompt-only edit is not a proper fix. Keep the proposed sentence as guidance,
but enforce the boundary in code.

### 1. Freeze and enforce a read-only executor

Update the single executor definition and the binding architecture together:

- declare the implementation capability;
- run Claude Code in OAuth-compatible restricted/safe mode;
- make the built-in inventory exactly `Read`, `Glob`, and `Grep`;
- explicitly deny `Write`, `Edit`, `NotebookEdit`, `Bash`, and `mcp__*`;
- use `dontAsk`, strict MCP configuration, and no session persistence;
- do not use `--bare`, because the installed CLI makes it API-key-only and the
  default OAuth installation must remain able to complete a run (hazard 11);
- add one prompt sentence saying the checkout is read-only and only returned
  patch content is considered. Treat that sentence as UX, not a guard.

Use the verified profile's agents and executor at dispatch. Require agent/executor
binding and the required executor capability before a stage row, worktree, or
paid invocation exists. Apply the same rule to spec, plan, implementation, and
the raw dispatch surface; otherwise config remains only partly frozen.

### 2. Make worktree cleanliness a deterministic gate

After the projections commit, assert the worktree and index are clean before
dispatch. Assert them again immediately after dispatch and before result parsing
or application, including tracked, staged, untracked, and ignored entries. Any
change blocks the run and names the paths; do not reset and continue, because
that hides evidence that the executor boundary failed.

This is the core's backstop if CLI controls, hooks, or executor configuration
drift.

### 3. Treat every patch path literally and verify what Git will commit

Invoke Git with literal pathspec handling and `--` before every untrusted path.
Before commit, compare the NUL-delimited staged path set exactly with the current
patch's normalized path set. After commit, compare the commit's changed path set
again and derive the audit summary from the observed set. Refuse any mismatch.

### 4. Refuse link/junction components in patch targets

Fail closed when any existing path component is a symlink or junction. This is
smaller and safer than adding another target-category exception to the current
resolution walk, and the design does not require linked patch paths. Retain the
containment and protected-path backstops.

### 5. Record and prove the failure mode

Add a hazards entry for the failure that actually occurred: a declared sandbox
and a compliant sample do not make a proposal subprocess read-only. Add focused
regressions derived from the architecture and the recorded real output, then
break each guard and observe its named test fail before restoring it.

Likely files affected:

- `ARCHITECTURE.md`
- `docs/hazards.md`
- `src/executor.ts`
- `src/profile.ts` and dispatch construction sites in `src/cli.ts`,
  `src/spec-stage.ts`, `src/plan-stage.ts`, and `src/implementation-stage.ts`
- `src/prompts.ts`
- `test/executor.test.ts`, `test/harness.test.ts`, `test/prompts.test.ts`, and
  stage tests/fixtures

No new harness interface or compatibility shape is needed.

## Validation Plan

1. Add the five regressions below and confirm each fails against current master.
2. Apply the smallest code changes above.
3. Run the focused executor, harness, prompt, spec, plan, and implementation
   tests.
4. Break and restore each guard independently:
   - expose a mutating tool;
   - remove the post-dispatch clean check;
   - omit literal-path mode;
   - permit a junction component;
   - substitute a live executor for the frozen one.
5. Run `npm test`, `npm run typecheck`, and `npm run check:docs`.
6. Commit the step-6 correction on `master`.
7. Rebase `step7` onto the corrected master and resolve its session/proposal
   records without rewriting historical evidence.
8. Start a fresh scratch run. The existing blocked run is terminal, and its
   frozen profile predates the corrected executor.
9. Complete step 7 Task 12 against the real harness: one passing verification,
   one genuinely blocking verification, and the absent environment canary.

Step 9 spends real model money. No additional model invocation was made during
this diagnosis.

## Regression Coverage

Proposed tests:

- `blocks_when_executor_mutates_worktree_before_returning_proposal`
  - fixture writes an unreported tracked/untracked/ignored path and returns a
    valid proposal; stage blocks before applying anything.
- `treats_option_like_patch_path_as_a_literal_and_commits_only_that_path`
  - signed path is `-A`; another dirty path must not be staged or committed.
- `refuses_any_link_component_before_writing`
  - approved alias targets an ordinary unprotected path outside scope and is
    refused before either patch file is written.
- `uses_frozen_agent_and_executor_and_requires_implementation_capability`
  - caller/live definitions differ; stage uses or requires the profile binding
    and fails before worktree/dispatch when capability is absent.
- `claude_executor_exposes_only_read_tools_in_restricted_safe_mode`
  - exact argv is asserted against the binding architecture and installed CLI
    semantics; `Write`, `Edit`, `NotebookEdit`, `Bash`, and MCP tools are absent
    or denied.

The first three failure directions were proven in the isolated reproductions.
The fourth is already exposed by the current success fixture's mismatch. The
fifth can be break-proven without a paid invocation by mutating the executor
command in a scratch mirror.

## Hazards Considered

- **Hazard 4 — fixtures and code agreeing while both are wrong.** Current
  fixtures return proposals but do not simulate the real harness's direct file
  writes. Expected behavior must come from the architecture and recorded smoke,
  not a newly invented fixture.
- **Hazard 8 — Windows executable resolution.** The executor still uses the one
  supported CLI process and constant, shell-safe flag values; no second harness
  is introduced.
- **Hazard 11 — a default installation that cannot complete a run.** `--bare`
  was rejected because it requires API-key auth in the installed CLI; the
  existing OAuth path must keep working. The missing implementation capability
  must be added and tested.
- **Hazard 12 — configuration divergence between targets.** Frozen agent and
  executor definitions must become the effective definitions, not merely status
  metadata.
- **New observed hazard:** proposal-only behavior must be enforced at the
  subprocess boundary and checked afterward. A prompt and one compliant smoke
  are not evidence that a process is read-only.

Hazards 1-3 and 5-7, 9-10, and 13-14 do not drive this correction: output parsing,
retry variation, model aliasing, invented obligations, and reviewer independence
are not on the failing path.

## Risks

- A read-only implementer cannot run tests itself. That is intentional for this
  milestone: step 7 owns deterministic command execution. It can still inspect
  the complete repository with `Read`, `Glob`, and `Grep`.
- CLI restricted/safe mode confines Claude Code's built-in behavior, not an
  arbitrarily malicious replacement executable. If the architecture is intended
  to defend against a hostile harness binary rather than model/tool behavior, an
  OS/container boundary is required and is not a small step-6 correction. The
  clean-tree guard still detects in-worktree mutation.
- Existing frozen profiles must not be silently upgraded to the new executor.
  Config freeze means a fresh run is required.
- Refusing all link components is stricter than current behavior. No shipped
  contract requires link-based patch targets; fail-closed is preferable after
  repeated redirect defects.
- Updating all dispatch construction sites is necessary to claim run-level
  config freeze. Updating only implementation would be a documented partial
  pass, not completion of hard rule 6.

## Open Questions

No requirement question blocks the recommended correction.

One boundary should be stated explicitly during implementation: whether
"caller-enforced sandbox" means protection from model-visible Claude Code tools
(the recommended bounded fix) or containment of a hostile executor binary. The
current architecture and one-harness milestone support the former; the latter
requires a separate, materially larger containment design.
