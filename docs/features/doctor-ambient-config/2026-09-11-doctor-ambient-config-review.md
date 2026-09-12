# Doctor Ambient Configuration Implementation Plan — review

**Reviewed document:** `plan.md`
**Document type:** Plan
**Review date:** 2026-09-11
**Status:** reconciled
**Hazards considered:** 2 (no new retention surface introduced; not affected), 4 (a guard-breaking evidence gap exists for native-resolution parity, flagged below), 8 (native direct launch preserved, no shell wrapper introduced), 9 (the plan applies this hazard's "verify resolution in the environment that will actually invoke it" principle to the harness probe; the high-risk finding below shows the same principle is not yet applied to executable identity itself), 10 (cited only as the plan's own stated limit: a version probe proves neither model routing nor provider precedence, and this review does not extend that claim further), 11 (an installation-independent default doctor path is partially addressed; a shim-only install still fails the same way the real dispatch already does), 12 (configuration divergence is exposed through the new ambient check, but see the high-risk finding on `.claude.json` content hashing), 15 (declared sandbox containment is unaffected; the new diagnostic surface never writes into MCP/skill/prompt injection surfaces).

---

## Summary

The plan extends `doctor` with filtered-environment probe parity, an absolute executable identity, and a bounded, privacy-limited inventory of two Claude user configuration files, all as non-gating current-state evidence. It is unusually well grounded in the actual source (`src/harness.ts`, `src/readiness.ts`, `src/profile.ts`, `src/cli.ts`) and in external contract references, with a clear file map, dependent list, and task-to-acceptance-criteria mapping. One design gap needs closing before implementation: a hand-rolled executable-resolution algorithm whose output is never proven, in the same lookup context, to match the OS's actual bare-name resolution.

## Verdict

- **Ready for planning after required changes** — The contract, file map, and task decomposition are implementation-ready, but the native-resolution parity gap below must be resolved before an implementer starts Task 2, since it bears on the feature's core identity-parity claim.

## Critical issues — must fix before implementation

No critical issues found. An earlier finding here (an unhandled failure in ambient-config collection crashing `doctor`) does not hold: `src/cli.ts`'s outer `main()` catch block wraps the entire command switch, including the `doctor` branch, and converts any propagating error into a `setup_required` operator-envelope result with a non-zero exit code rather than an unhandled process crash. The residual concern — that such an error discards the checks already computed in the same `inspectReadiness` call rather than reporting them alongside a degraded ambient-config entry — is real but is a High-risk area, not a Critical one; see below.

## High-risk areas

**Risk:** An unexpected error in ambient-config collection discards already-computed check evidence

- **Why:** "Bounded user-file inventory" states "unexpected programming errors propagate; catch expected filesystem errors only at the individual observation boundary." Nothing in "Projection and readiness policy" describes a boundary around the call into `collectAmbientProviderConfig` (or `resolveDoctorExecutable`) inside `inspectReadiness`. Both touch live filesystem state (network drives, reparse points, antivirus locks, unusual permission errors) the two-case `readable`/`unavailable` contract does not enumerate in advance. `src/cli.ts`'s outer catch prevents a process crash, but it discards every other check `inspectReadiness` already computed in that call (node, git, head, verification, design, approval, executor) and reports only a generic `setup_required` error instead.
- **Impact if ignored:** An operator loses the full readiness picture to a failure in a newly added, purely informational diagnostic path, even though the command does not crash outright.
- **Mitigation:** Scope any added boundary to the ambient-config and resolver calls only, and report failures there as their own bounded state (for example `ambient_provider_config: unavailable` / a resolver-specific evidence string on `executor_probe`) without changing `executor_probe`'s pass/fail outcome for an ambient-collection error — folding an ambient-collection failure into `executor_probe`'s result would violate AC-009 ("Overrides and unavailable config observations alone never change doctor readiness or exit code"). Add a Task 5 regression that injects an unmodeled filesystem error and asserts `doctor` still reports every other check.

**Risk:** The hand-rolled executable resolver is never proven to match the OS's real bare-name resolution in the same lookup context

**Risk:** The hand-rolled executable resolver is never proven to match the OS's real bare-name resolution

- **Why:** "Process construction and executable identity" reimplements Windows and POSIX executable search in `resolveDoctorExecutable` rather than deriving the resolved path from an actual bare-name spawn. Because `doctor` then hands the resolved absolute path to `probeExecutor` via `executablePath`, the reported path always matches what `doctor` itself invokes — but `src/dispatch.ts` and every stage caller keep spawning the bare configured name with the OS's own resolution (unchanged by design, per AC-002). If the custom resolver's ordering, extension handling, or quoting differs from the real native search in even one case (Windows execution aliases, ACL-denied-but-existing files, short-path/8.3 aliasing, a corporate PATH-rewriting policy) under the same PATH and cwd, `doctor` can report one binary as "ready" while a bare-name spawn under that identical environment resolves to a different one.
- **Impact if ignored:** An operator sees a passing, path-and-version-reporting `doctor` result built on a resolution the plan never checks against a real bare-name spawn under the same environment, so a silent divergence between the two would go undetected.
- **Mitigation:** Add a task step (Task 2 is the natural home) that, using the same captured environment map and `probeCwd` the custom resolver used, independently spawns the bare configured name through an ordinary unmodified `probeExecutor` call and confirms — by resolved absolute path and content identity — that it selects the same file `resolveDoctorExecutable` selected, across at least the PATH-ordering and current-directory scenarios already listed. Treat a mismatch as a resolver defect. Scope the claim to same-context resolution parity: this does not and cannot guarantee identity against a later dispatch run under a different stage worktree cwd, which the plan already excludes from scope.

**Risk:** Hashing the full contents of `.claude.json` fingerprints live sign-in/session material

- **Why:** The plan's own "External contract evidence" section states `.claude.json` "can contain sign-in state: hash bounded raw bytes only, never parse or expose its contents," and Claude's settings documentation independently describes it as holding "your sign-in session, MCP server configurations, per-project state such as trust decisions." "Bounded user-file inventory" then unconditionally computes `sha256Hex` over the complete file for both `user_settings` and `user_state` with no distinction for the latter's higher sensitivity, and also reports its exact `sizeBytes`.
- **Impact if ignored:** `doctor --json` becomes a new, previously nonexistent surface that emits a content-derived fingerprint (hash plus exact size) of a file that can hold live authentication and per-project trust state, without this repository's stated security boundary (`ARCHITECTURE.md` section 17, "credentials never enter a prompt") having been extended to cover diagnostic output. A hash is not the secret, but the pair of hash and size is enough for a party who later obtains or guesses the file to confirm a match. The plan's own "Assumptions" section already frames fingerprints as "local change indicators, not credential redaction guarantees," which limits but does not eliminate this exposure for `user_state` specifically, since that file (unlike `user_settings`) is documented to hold sign-in session material.
- **Mitigation:** Record an explicit, reasoned decision — in "Assumptions" or "Known blockers," next to the existing fingerprint-limits sentence — that whole-file hashing of `user_state` is an accepted tradeoff given its stated purpose (local operational change detection, not exported or transmitted), or narrow the `user_state` record to presence, `state`, and `sizeBytes` only (no `contentHash`) while keeping the full contract for the lower-sensitivity `user_settings` file. Either resolution is acceptable; what the settled contract currently lacks is an explicit choice between them for this specific file.

**Risk:** The shared test fixture refactor should confirm its full call-site count before editing

- **Why:** Task 4 requires rewriting `doctorFixture` and `fixtureProbe`, which "File map and verified dependents" itself notes feed approval, guided-run, README, and `journeyFixture` (GitHub-sentinel) tests inside a single 2,800-plus line file. Independently counting call sites in that file finds this reach is real but bounded: `doctorFixture` (6), `doctorRun` (8), `fixtureProbe` (3), `journeyFixture` (3). Task 4 already names the specific bypasses (threading `doctor.environment` through the README and journey subprocesses, the unavailable-tools case, the bare-versus-absolute probe assertion) and already requires running the whole file at the task boundary, so the named consumers are not left unaddressed — but the plan does not instruct a search for every reference to the fixtures before editing them, so a bypass outside the ones already named could still go unnoticed until a test failure surfaces it.
- **Impact if ignored:** A shared-fixture change missing an unnamed bypass is discovered only as a test failure rather than as a planned regression case, even though the overall risk is smaller than the fixture's line count alone suggests.
- **Mitigation:** Add an explicit Task 4 step to search `test/cli-operator.test.ts` for every reference to `CLAUDE_CODE.probe`, `doctor.command`, `doctor.invoke`, and `fixtureProbe` before editing the fixtures, and reconcile each hit against the new contract, in addition to running the full file at the end of the task as already planned.

## Medium and low concerns

- "Environment observations and privacy" documents that absolute paths and the fingerprint hashes can identify a workstation, but the plan does not say whether this is acceptable for the local-only, non-transmitted diagnostic surface it describes or whether it should be called out again in the README/runbook update in Task 6 as an operator-facing privacy note, not just an internal design note.
- "Projection and readiness policy" already gives explicit types for the three new current-executor fields in prose (`resolvedPath: string | null`, `probeCwd: string`, `versionOutput: string | null`), unlike the fully typed `AmbientProviderConfig` and `ConfigFileObservation` code blocks elsewhere in the plan; a matching TypeScript interface snippet would still improve scannability but nothing about the shape is actually left to implementer inference.
- The Windows resolution rule ("`.com` before `.exe`, case-insensitive filesystem lookup") does not address a candidate that exists but is denied by an ACL to the current user (GetFileAttributesW succeeds for such a file, matching libuv, so the resolver will select it and the subsequent launch will fail as a probe error). This is consistent with native behavior but is not called out as a deliberately accepted edge case anywhere in the text.
- "Bounded user-file inventory" specifies `state` as `readable`, `absent`, or `unavailable`, but does not state what `reason` text convention should be used (raw `Error.code`, a prefixed sentence, or something else), leaving the exact evidence string format to implementer discretion across two file records and the executable-resolution error path.

## Missing and underspecified areas

- No explicit interface block for the three new current-executor fields (`resolvedPath`, `probeCwd`, `versionOutput`); an implementer must decide the exact types and null handling from prose alone before touching `CurrentReadiness`.
- No statement of what happens when two `doctor` invocations run concurrently against the same target and read the same user-config file mid-write from an unrelated process; the plan's TOCTOU handling (stat before and after) covers detection but does not say whether a genuinely torn read should be reported as `unavailable` with a distinct reason from "oversized" or "permission denied," which affects how Task 3's tests must assert this case.
- No decision on whether the new `ambient_provider_config` check and the new executor-identity fields should be mentioned together in the same evidence line as `executor_probe`, or kept fully separate in text output; without this, the text-rendering shape in Task 6's documentation update is left to implementer judgment.

## Suggested improvements

- Record the resolver-parity mitigation and the `.claude.json` hashing decision as explicit new bullets in "Known blockers" once resolved, so the plan's own blocker list reflects every open design question this review found rather than only the ones already known before this pass.
- Consider whether `versionOutput` and the existing `executor_probe.evidence` string should share one formatting helper, since both derive from the same probe outcome and duplicating that logic across two call sites is the kind of small divergence this plan is otherwise careful to avoid elsewhere (for example, the single `buildHarnessEnvironment` helper it already introduces for exactly this reason).

---

## Reconciliation

**Date:** 2026-09-11
**Disposition:** 5 accepted, 6 rejected, 2 deferred, 0 open
**Status:** reconciled
**Hazards considered:** 4 (independent native evidence and an ordering mutation prevent self-confirming resolver tests); 8 and 9 (same-context direct-spawn comparison, without shell discovery or later-dispatch guarantees); 12 (retain useful configuration-change observations); 17 (the operator explicitly retains the user-state fingerprint rather than silently losing the obligation). Hazards 10 and 15 remain limits on routing and containment claims, not grounds for new behavior.

### Inventory and authority

The review body remains historical evidence. It contains four distinct
high-risk areas, four medium/low concerns, three missing-area claims and two
suggestions: 13 findings. The adjacent native-resolution headings describe
one finding, not two. The critical section withdraws its earlier crash claim
and refers to the first high-risk area; it adds no separate active finding.
The earlier conversational count of three high-risk areas is incorrect.
The verdicts below govern disposition, including claims the review repeats
after acknowledging their correction.

Repository evidence determines every disposition except the user-state
privacy tradeoff. On 2026-09-11 the operator selects "Keep the whole-file hash
and explicitly document the privacy tradeoff." This preserves AC-007; it
does not authorize credential-value hashing, persistence or transmission.

### Verdicts

- **Rejected - H1: An unexpected error in ambient-config collection discards already-computed check evidence:** The plan's bounded inventory already maps operational filesystem failures to per-file `unavailable` records and deliberately propagates programming errors. The review identifies no concrete operational failure outside that contract. `src\cli.ts`'s outer `main` catch reports unexpected errors instead of hiding them; a broad diagnostic fallback conflicts with the explicit error-handling rule. The record has three file states, not two, and `src\readiness.ts` permits only `pass`, `fail` and `not_checked` for checks, not the proposed check status `unavailable`. Keep the existing per-observation failure tests and AC-009; do not add a combined resolver/collector catch.
- **Accepted - H2: The hand-rolled executable resolver is never proven to match the OS's real bare-name resolution in the same lookup context / The hand-rolled executable resolver is never proven to match the OS's real bare-name resolution:** The process contract, AC-003 and Task 2 now require independent bare-name native-spawn evidence with matching environment, cwd and parent lookup controls. Task 5 adds a wrong-ordering mutation that keeps the absolute probe internally consistent, so self-confirmation cannot satisfy the new assertion. The claim excludes later dispatches with different contexts.
- **Accepted - H3: Hashing the full contents of `.claude.json` fingerprints live sign-in/session material:** The operator retains both whole-file hashes. Assumptions, the privacy contract, AC-013 and Task 6 now state the sign-in/trust-state tradeoff, candidate-file comparison exposure and sensitivity of redirected/shared output. Task 3 explicitly covers same-size changes in both files. Whole-file comparison does not reveal the changed field; credential-value digests remain prohibited.
- **Accepted - H4: The shared test fixture refactor should confirm its full call-site count before editing:** Task 4 now inventories fixture references, wrappers and direct subprocess bypasses before editing. It derives the inventory at execution time rather than pinning counts. `doctorFixture`, `fixtureProbe` and `journeyFixture` in `test\cli-operator.test.ts` establish the dependency; the existing whole-file run remains the regression boundary.
- **Rejected - M1: Operator-facing privacy note:** The existing environment/privacy contract already treats paths and hashes as workstation-identifying operational data, and Task 6 already assigns the README/runbook explanation. H3 sharpens the user-state decision; this concern identifies no separate missing requirement.
- **Deferred - M2: Matching executor interface snippet for scannability:** The projection contract already specifies each type and null rule. The implementer creates the concrete `CurrentReadiness` shape in Task 4; revisit a documentation snippet only if the resulting interface needs explanation, rather than maintaining a duplicate schema now.
- **Accepted - M3: Windows ACL-denied selected candidate:** The process contract now explicitly retains a selected Windows path and reports probe failure when launch is denied, without trying a later candidate. Task 2 includes selected-launch failure comparison. This clarifies the existing no-reselection rule; it does not claim attribute lookup always succeeds for ACL-denied paths.
- **Accepted - M4: File-observation reason convention:** The bounded inventory now requires operation/code/path evidence for filesystem failures and a named cause for observation refusals. Task 3 asserts cause-specific reasons without pinning full prose or introducing another record schema.
- **Rejected - U1: Missing executor interface types and null handling:** The projection contract already specifies `resolvedPath: string | null`, `probeCwd: string` and `versionOutput: string | null`, including empty/failing probe behavior and retention of a resolved path after launch failure. The missing-area claim contradicts both that contract and the review's corrected M2 paragraph.
- **Rejected - U2: Concurrent file-write outcome:** The existing bounded inventory requires before/after descriptor metadata, EOF/count agreement, `unavailable` on observed changes and a non-empty reason. Task 3 already covers detected modification and count mismatch. It explicitly excludes snapshot guarantees; M4 clarifies wording without adding concurrency coordination.
- **Rejected - U3: Text-output check separation:** The plan already separates `ambient_provider_config` from `executor_probe` evidence and places full observations in `current`. `src\operator-output.ts`'s `formatOperatorResult` renders each check and the complete current object; no output-shape decision remains.
- **Rejected - S1: Put resolved parity/hash decisions in Known blockers:** The accepted requirements belong in their contract, acceptance criteria and tasks; this stamp records the operator decision. Listing resolved requirements as open blockers contradicts the completed disposition. The existing native-resolution implementation risk remains explicit in the plan.
- **Deferred - S2: Shared probe-output formatting helper:** `inspectReadiness` currently formats successful probe streams once. Revisit extraction during Task 4 only if two real uses duplicate normalization; a local computed value can serve both fields without prescribing another helper now.

### Scope and completion evidence

Requested outcome: reconcile the separate review into the existing bootstrap
plan without implementation. The baseline contains the earlier session-file
conversion and the untracked feature documents; this reconciliation preserves
that conversion and the review body.

Success means every finding has a disposition, accepted changes reach the
dependent contract/tasks/criteria, the operator owns the privacy choice, and
the lifecycle describes reconciled but unimplemented work. Only `plan.md` and
this review change; no runtime, target state, configuration, signing or paid
operation changes. The plan's original planning record remains historical.

Validation and final result: `npm run --silent check:docs -- --json` reports
zero errors and no feature warnings; its 63 historical warnings concern
other documents. `npm run typecheck` exits 0. An in-memory check accounts for
all 13 dispositions, six tasks, 13 acceptance criteria, lifecycle status and
the accepted changes in their dependent sections. Reconciliation is complete;
the plan remains unimplemented. No runtime acceptance evidence exists yet;
the implementation tasks retain those obligations.

Reasoning correction: a missing code block does not establish a missing
contract, and a local uncaught error does not establish an unhandled process
failure. The full projection contract and enclosing CLI error handler settle
those claims before any broader fallback or duplicate schema is justified.

Rollback status: no implementation exists to roll back. Reversing this
reconciliation means reversing only these document edits, not the prior
session conversion or historical review findings.
