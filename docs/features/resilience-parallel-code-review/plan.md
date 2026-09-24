# Resilience Reviewer and Parallel Code-Review Panels

**Status:** Implemented

**Goal:** Add a third, non-overlapping resilience specialist to the frozen code-review panel and execute the reviewers in each panel concurrently, while preserving deterministic findings, complete evidence, read-only worktree guarantees, and sequential remediation rounds.

**Source:** Operator request on 2026-09-17 to add the resilience reviewer and replace sequential reviewer dispatch within a panel with parallel dispatch.

**Hazards considered:** `docs/hazards.md` items 1 (provider output shapes), 2 (discarded output), 3 (prompt-only constraints), 4 (hand-written fixtures), 7 (identical retries), 8 (Windows executable resolution), 11 (default installation paths), 12 (configuration divergence), 14 (reviewer independence), 15 (read-only reviewers), and 18 (code-inspection coverage). Items 5, 6, 9, 10, 13, 16, and 17 do not govern this change because it does not alter delivery promises, hook handling, JSON extraction, model aliases, specification provenance, findings reconciliation, or upstream routing.

## Success criteria

- Newly frozen default profiles contain three distinct `code-findings` specialists in this stable order: correctness, security, and resilience.
- A deliberately configured two-seat future profile continues to select correctness and security rather than accidentally replacing security with the new reviewer.
- All reviewers in one code-review panel are launched against the same frozen commit, diff, declared scope, and changed paths without waiting for the preceding reviewer to finish.
- The stage waits for every launched reviewer to settle before it records the panel result, dispatches remediation, applies the final severity gate, or returns a failure.
- One reviewer failure does not cancel, orphan, or discard evidence from sibling reviewers. No automatic retry or sequential fallback is introduced.
- Raw responses and agent-run evidence may retain their real completion order, while panel membership, validation, findings, reports, failure summaries, and remediation input are processed in frozen panel order.
- Parallel reviewers remain read-only. After every reviewer process settles, the stage verifies HEAD and worktree cleanliness once against the quiescent panel and does not identify a particular concurrent reviewer as the cause of a panel-level integrity failure.
- Remediation, verification, and successive panel rounds remain sequential. Only the independent reviewers inside one panel become concurrent.
- The new reviewer reports concrete current-code resilience and state-integrity defects, without absorbing correctness, security, maintainability-style, or future QA-team responsibilities.
- The default dispatch count becomes three reviewer calls for a clean one-round review and seven calls for the default remediated path: three reviewers, one implementer, and three reviewers.
- Existing frozen profiles and recorded two-reviewer evidence remain readable without a migration, compatibility union, or schema version.
- Focused tests, the full test suite, strict typechecking, and the documentation checker pass.

## Scope boundaries

This plan changes the existing `code_review` stage only. It does not authorize or design the deferred `test_authoring` stage, a QA team, acceptance-criteria-to-test mapping, end-to-end test generation, flaky-test detection, final verification, or pull-request summary stages.

The resilience specialist owns concrete defects that appear when execution is delayed, repeated, interrupted, concurrent, partially completed, restarted, or affected by dependency failure. Its review includes timeout and cancellation handling, retry safety, idempotency and duplicate processing, transaction and commit boundaries, race conditions, cleanup, error propagation, recovery, cross-store or side-effect consistency, and safe degradation.

The resilience specialist does not report generic missing tests, style preferences, naming, comments, abstraction quality, speculative performance tuning, or ordinary maintainability observations. Correctness continues to own ordinary behavioral defects and broken acceptance behavior. Security continues to own injection, authorization, secret exposure, unsafe input handling, and trust-boundary defects. A hard-coded value is a resilience finding only when it concretely breaks a timeout, limit, retry, recovery, or frozen-configuration guarantee. SQL transaction, locking, and partial-commit defects belong to resilience; SQL injection remains security-owned.

Parallelism is limited to the reviewers in a single frozen panel. The implementer receives the complete actionable finding set only after that panel has settled. Verification begins only after the implementer completes. A later panel begins only after the prior remediation commit and frozen verification commands complete.

## Design decisions

### Stable third-seat selection

Create `src/agents/code-reviewer-state-integrity.ts` with agent ID `code-reviewer-state-integrity` and specialty `resilience`. The existing selector sorts agent IDs before taking the frozen panel size. This ID sorts after `code-reviewer-security`, so a future two-seat panel retains correctness and security while the new default three-seat panel adds resilience as the third seat. Do not add a reviewer-priority framework for one new implementation.

Raise `CODE_REVIEW_PANEL_SIZE` from 2 to 3 without changing its existing 2-5 bounds. The agent registry, policy, and executor binding remain frozen at run creation. Runs already frozen with the two existing reviewer definitions continue to use those two definitions; no migration or compatibility format is added.

### Concurrent dispatch and deterministic consumption

Keep `dispatchOnce` as the single-dispatch primitive shared by stages. In `runCodeReviewStage`, construct one promise per frozen panel member and start the complete set together with `Promise.allSettled`. Do not use fail-fast `Promise.all`: the stage must not return while another paid provider process is still running.

Each reviewer task returns a typed in-memory outcome containing its frozen panel index, agent, dispatch result or thrown error. After every promise settles, perform exactly one panel-level HEAD and full `checkWorktreeClean` check while no reviewer process remains active. Treat these signals as structured state; do not infer behavior by parsing error messages.

Process the settled-result array in frozen panel order, which `Promise.allSettled` preserves independently of completion order. Independently extract and validate every successful provider response. If HEAD and worktree integrity remained intact, retain each valid report and its findings in panel order even if another reviewer failed, then block the stage without remediation. Those reports remain evidence attached to a blocked stage; they are not a complete panel, an active finding set, or a gate result. If the integrity check failed, retain only provider/raw/agent-run evidence and accept no reviewer reports or findings from that panel. This preserves useful trustworthy evidence while preventing an incomplete or contaminated panel from gating or authorizing a patch.

The raw response references, `agent_run` identifiers, and `agent.dispatch` audit entries are written when each dispatch completes and therefore may appear in completion order. That order is evidence, not panel precedence. Canonical panel records, immutable reviewer reports, deduplicated finding aggregation, failure summaries, and remediation prompts remain deterministic in the frozen order.

### Shared-worktree integrity

All reviewers receive the same immutable commit and diff, and their executor sandbox remains read-only. Do not run `git` integrity observations from individual completion handlers while sibling processes remain active. After all reviewers settle, read HEAD and call the existing full `checkWorktreeClean` exactly once. Any failure belongs to the panel and proves no individual reviewer caused it.

If the quiescent panel check observes a changed HEAD, dirty worktree, or failed Git inspection, retain raw outputs and agent-run evidence, reject the panel atomically, and accept no findings from the untrusted worktree state. Do not try to repair the tree, retry the panel, or fall back to sequential execution.

### Auditability and cost semantics

Append `code_review.panel.start` immediately before launch with the canonical summary `round=<N>/<MAX>; commit=<SHA>; panel=<ID+ID+ID>`. Append `code_review.panel.settled` after all reviewer tasks and the quiescent integrity check with `round=<N>/<MAX>; commit=<SHA>; elapsedMs=<MS>; outcomes=<ID:STATUS,...>; integrity=<clean|dirty|check_failed>`. Reviewer IDs and outcomes use frozen panel order. Status is one of `valid`, `dispatch_failed`, `output_invalid`, or `integrity_untrusted`; full provider failure details remain in the existing raw output and `agent.dispatch.failed` event.

When any reviewer fails, retain the existing terminal action `code_review.reviewer.failed` with `round=<N>/<MAX>; commit=<SHA>; failures=<ID:KIND,...>; panel=<ID+ID+ID>`. List failures in frozen panel order and use typed failure kinds rather than prose parsing. The stage's operator-visible abort reason lists the same reviewer summaries in the same order. Continue to use the existing per-dispatch audit entries for provider-specific cost and raw-output provenance.

Consent to a code-review panel covers the complete frozen panel. Parallel dispatch means a fast failure can no longer prevent later seats from being charged, because all seats have already started; the expected spend remains the sum of the same reviewer calls. No retry is authorized by a failed panel.

### Evidence boundary

Deterministic tests must prove that the production orchestration actually overlaps reviewer executions and drains all children on failure. They do not establish that the external provider accepts three concurrent native launcher processes under every account or host limit. A separately authorized paid throwaway-repository run is required for that external proof. If the provider or host rejects concurrency, block and report the measured result; do not silently restore sequential dispatch.

`Promise.allSettled` governs failures that return through the running BuildWorks process. This plan adds no harness-wide `SIGINT` or `SIGTERM` cancellation protocol. If the parent process terminates, the operating system and existing launcher behavior govern its children; the stage cannot promise to drain or terminalize after its own process has exited. Graceful parent-signal cancellation requires a separate design across every stage that uses `invokeHarness`, not a code-review-only signal handler.

## Affected areas

Create:

- `src/agents/code-reviewer-state-integrity.ts`
- `docs/features/resilience-parallel-code-review/plan.md`
- A recorded provider fixture under `test/fixtures/recorded/` only after a separately authorized live run supplies real output and provenance.

Modify:

- `ARCHITECTURE.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `src/agents.ts`
- `src/policy.ts`
- `src/code-review-stage.ts`
- `test/agents.test.ts`
- `test/select.test.ts`
- `test/policy.test.ts`
- `test/profile.test.ts`
- `test/prompts.test.ts`
- `test/code-review-stage.test.ts`
- `test/dispatch.test.ts`
- `test/delivery-stage.test.ts`
- `test/cli.test.ts`
- `test/run-command.test.ts`
- `test/fixtures/harness/echo-json.mjs`
- `test/fixtures/harness/emit-code-review.mjs`
- `.claude/skills/run-buildworks/SKILL.md`
- `.claude/skills/run-buildworks/driver.mjs` only if inspection confirms a hard-coded two-reviewer assumption.

No database schema, migration, persisted record shape, stage order, approval format, delivery behavior, or dashboard mutation path changes. Delivery's existing passed-code-review validator does consume the frozen panel size and exact membership, so its current-policy synthetic record fixture must advance to the three-seat panel even though delivery behavior does not change.

## Assumptions

- The three reviewer processes are independent readers of the same commit and require no output from one another.
- The current executor read-only sandbox applies separately to every concurrently launched reviewer.
- SQLite/store writes made after asynchronous provider completions remain serialized by the existing synchronous store boundary; concurrent provider execution does not create concurrent database writers.
- No supported in-progress run will be deliberately resumed across deployment without accepting the new within-panel execution behavior. Before implementation rollout, inspect known targets for an active `code_review` stage and finish or explicitly abandon it under the old checkout if one exists.
- The external provider may impose an undocumented process, account, or rate limit. That uncertainty is a live-validation concern, not a reason to add speculative throttling or fallback behavior.

## Tasks

- **Step 1: Amend the binding code-review design before changing behavior.**
  - Update `ARCHITECTURE.md` to define the three seeded lenses, the third-seat resilience boundary, concurrent dispatch within one panel, all-settled behavior, deterministic frozen-order consumption, and completion-order raw/audit evidence.
  - State that one CLI/store writer can coordinate multiple concurrent read-only provider subprocesses without creating a second mutation authority.
  - Preserve sequential remediation, verification, and round transitions.
  - Define shared-worktree integrity checking without attributing a concurrent mutation to an individual reviewer.
  - Update the current operating contract in both `AGENTS.md` and `CLAUDE.md` identically: default panel size 3, three distinct specialists, concurrent within-panel dispatch, and no authorization for other deferred stages.
  - Update only current operating text in `README.md` and the canonical run skill with the new default dispatch counts and cost semantics. Preserve dated historical run records and their two-reviewer facts unchanged.
  - Verify `AGENTS.md` and `CLAUDE.md` remain byte-identical.

- **Step 2: Register the resilience specialist and freeze it as the third default seat.**
  - Add `CODE_REVIEWER_STATE_INTEGRITY` with ID `code-reviewer-state-integrity`, specialty `resilience`, output `code-findings`, no tools, and the existing Claude Code executor.
  - Document beside the agent ID that its stable lexicographic position preserves correctness and security as the two-seat panel; the selector test enforces that compatibility constraint.
  - Write explicit positive and negative specialty instructions matching the scope boundaries above so the new reviewer reports only actionable current-code defects.
  - Register the agent in `src/agents.ts` and raise the policy default to 3 while preserving the 2-5 configured bounds and current staffing refusal.
  - Keep the existing lexicographic selector and prove that size 2 selects correctness/security while size 3 selects correctness/security/state-integrity.
  - Update agent, policy, profile, selection, prompt, CLI, and run-command assertions for the new frozen default and distinct non-empty specialty instructions.
  - Do not alter existing recorded two-reviewer fixtures or pretend they contain a resilience response.

- **Step 3: Execute each frozen reviewer panel concurrently and drain it completely.**
  - In `src/code-review-stage.ts`, introduce a local typed reviewer-outcome representation rather than a reusable concurrency abstraction with no second implementation.
  - Capture the frozen panel order, commit, diff, scope, changed paths, prompt inputs, and panel start time once before launch.
  - Append the panel-dispatch audit event, synchronously construct every `dispatchOnce` promise, and await them with `Promise.allSettled`.
  - Return only typed dispatch and output-validation state from each reviewer task; do not invoke Git from an individual completion handler.
  - After all dispatches settle, observe HEAD and call the existing full `checkWorktreeClean` exactly once against the quiescent panel.
  - Classify dispatch exceptions, provider failures, malformed outputs, and integrity failures without parsing prose. Extract and validate every otherwise trustworthy successful output.
  - When panel integrity is clean, persist every valid reviewer report and canonical finding in frozen panel order, including valid reports from an otherwise incomplete panel. Deduplicate shared finding identities exactly as today and retain every immutable source report.
  - When any integrity check failed, persist no reviewer reports or findings from that panel; retain the raw provider and agent-run evidence needed to diagnose it.
  - If any reviewer or integrity check failed, append `code_review.panel.settled` and one deterministic `code_review.reviewer.failed` terminal summary, then block without implementer dispatch or final gating.
  - Preserve the existing abort artifact contract: an incomplete or integrity-failed panel completes the stage with `output_ref = ""` and writes no code-review `result.json` or `report.md`. Immutable finding rows from valid members of an integrity-clean but incomplete panel remain evidence on that blocked stage, never a final record or gate result.
  - If the panel is complete and valid, continue through the existing aggregate-remediate-verify-review flow unchanged.
  - Ensure no return, throw, remediation call, or final severity decision is reachable until all launched promises have settled.

- **Step 4: Prove real overlap, deterministic records, failure draining, and worktree safety.**
  - Extend the executable harness fixture with a test-only barrier mode. Each reviewer writes a unique start marker outside the target worktree and waits until all three start markers exist before any reviewer can finish.
  - Add `BW_TEST_REVIEW_BARRIER_DIR`, `BW_TEST_REVIEW_BARRIER_COUNT`, and any controlled-delay variable only to the cloned `fixtureExecutor` allowlist in `test/code-review-stage.test.ts`; do not change the production `CLAUDE_CODE` environment passthrough. Place the barrier directory under the test's temporary root, outside the target worktree.
  - Poll marker state with a bounded delay and a five-second fixture deadline. Emit a named failure on expiry instead of spinning or depending on the harness's much longer production timeout.
  - Add a stage test that would time out under sequential orchestration, completes under concurrent orchestration, and proves all three start markers existed before the first finish marker.
  - Add a failure-drain test with controlled short and long reviewer delays in which one reviewer fails first and a slower sibling writes a completion marker. Assert the stage does not terminalize until the slow sibling exits, retains all available raw/audit evidence, and launches no remediation. Use the marker ordering as the assertion; do not make elapsed wall-clock duration the sole proof.
  - Add a concurrent worktree-mutation regression that verifies the panel blocks after draining, accepts no findings from the untrusted state, and reports only panel-level observation rather than unsupported causation.
  - Add mixed-duration and mixed-finding fixtures whose completion order differs from panel order. Assert deterministic `record.panel`, report insertion, deduplicated findings, failure messages, and remediation input.
  - Update the shared-finding regression so all three reviewers can report one identity and the store retains one canonical finding plus three immutable reviewer reports.
  - Update exact default dispatch counts from 2 to 3 for a clean panel, from 5 to 7 for a remediated default run, and corresponding one-round, invalid-remediation, failed-verification, and threshold-block cases.
  - Replace tests that incorrectly equate `agent_run` ID order with reviewer seat order. Assert reviewer membership as a set and deterministic canonical panel/report order separately.
  - Assert the exact `code_review.panel.start`, `code_review.panel.settled`, and `code_review.reviewer.failed` action names and canonical summaries, including ordered multi-reviewer failures and the complete settled payload.
  - Assert an incomplete panel has empty stage `output_ref`, no `result.json` or `report.md`, no remediation, and no gate event. When integrity remains clean, assert valid sibling reports remain attached to the blocked stage and the operator projection does not present them as a completed panel or gate result.
  - Exercise three concurrent `dispatchOnce` calls and assert distinct raw references, three agent-run rows, three dispatch audit entries, correct aggregate cost, and a valid audit chain.
  - Run the relevant tests under the repository's supported Windows/Node invocation so the direct native `claude.exe` launch contract remains covered.

- **Step 5: Verify the repository-wide contract and documentation.**
  - Inspect the dashboard/operator projection and run driver for assumptions that a panel always has two reviewers or that agent-run IDs express seat order; change only confirmed assumptions.
  - Run focused reviewer, selection, policy, profile, prompt, dispatch, code-review-stage, CLI, and run-command tests during implementation.
  - Prove the concurrency barrier by temporarily reverting the launch to sequential behavior, observing the barrier regression fail or time out within its bounded fixture deadline, then restoring the concurrent implementation.
  - Prove the failure-drain guard by temporarily reintroducing fail-fast return behavior, observing the regression fail, then restoring all-settled behavior.
  - Run `npm run typecheck`, `npm test`, and `npm run check:docs` from the checkout root.
  - Confirm `git diff --check`, inspect the complete diff, and verify no unrelated files or generated state were added.

- **Step 6: Obtain separately authorized external concurrency evidence.**
  - Stop before this step unless the operator explicitly authorizes a paid run and its expected budget. Plan approval or implementation approval alone does not authorize provider spend.
  - Use the canonical `run-buildworks` workflow against a throwaway target repository, never BuildWorks itself, and preserve the exact frozen profile, panel membership, raw responses, agent-run costs, audit chain, and panel elapsed evidence.
  - Confirm three distinct reviewers ran against the same commit and the stage waited for all three. Compare panel wall time with individual reviewer durations as supporting evidence while treating the code-level barrier test as the deterministic concurrency proof.
  - Copy any response that becomes load-bearing into `test/fixtures/recorded/` immediately with provenance naming the target, run, dispatch time, capture date, and removed harness-envelope fields.
  - If the provider rejects or rate-limits concurrent launch, retain the failure evidence and request an explicit design decision. Do not retry, silently serialize, reduce the panel, or add a throttle under this plan.

## Verification matrix

| Requirement | Primary evidence |
| --- | --- |
| Third reviewer is distinct and correctly scoped | Agent registry and prompt tests assert specialty, positive duties, exclusions, unique ID, and non-empty instructions |
| Two-seat policy keeps security | Selection test asserts correctness/security for size 2 and all three stable seats for size 3 |
| Reviewers truly overlap | Three-party external-marker barrier test that cannot complete under sequential launch |
| All launched work drains on failure | Fast-failure/slow-sibling regression with completion marker and terminal-state timing |
| Records remain deterministic | Mixed-duration test compares frozen panel order, report order, canonical findings, and remediation prompt |
| Provider evidence is never discarded | Raw reference, agent-run, immutable report, cost, and audit assertions for every settled success |
| Shared worktree remains guarded | Concurrent mutation regression plus one quiescent post-panel HEAD/full-clean check |
| Incomplete panels remain distinguishable from gate results | Empty stage output reference, absent review record, blocked status, retained valid sibling evidence, and no gate event |
| Remediation rounds remain sequential | Two-round test asserts implementer and verification finish before the next three-reviewer panel starts |
| Cost and audit remain correct | Concurrent dispatch test plus aggregate run-cost and `verify-audit` assertions |
| Existing frozen evidence remains usable | Existing two-reviewer recorded-fixture regressions pass unchanged |
| Repository contract remains coherent | Typecheck, full tests, doc-check, byte-identical instruction files, and diff inspection |
| Real provider accepts three concurrent launches | Separately authorized throwaway paid run; explicitly unverified until authorized and completed |

## Known blockers and release conditions

- No paid or external model execution is authorized by this plan. External concurrency behavior remains unverified until the operator separately approves Step 6.
- The implementation may merge with deterministic local concurrency proof if the operator accepts external provider concurrency as a documented unverified release condition. It must not be described as live-provider proven until Step 6 succeeds.
- If an active run is found at deployment time, do not resume it across this behavior change by assumption. Finish it with the old checkout or obtain an explicit operator decision.
- If implementation reveals that the store performs asynchronous concurrent writes despite the current synchronous boundary, stop and revise the design; do not add locking or a second writer mechanism without evidence and review.
- Parent-process signal cancellation remains an existing harness-wide limitation. Do not claim that `SIGINT` or `SIGTERM` drains concurrent reviewers unless a separately designed and verified cancellation contract lands.

## Blast radius

The structural blast radius is bounded: one new static agent definition, one policy-default change, and one orchestration loop in `code_review`. Existing arrays and panel-size fields already support three reviewers, so no schema or migration is expected. The main behavioral blast radius is operational: one additional paid dispatch per panel, concurrent native provider processes, nondeterministic completion-order agent-run IDs, and the need to drain an entire panel after one seat fails. The plan contains those effects inside `code_review` and preserves deterministic canonical records for downstream consumers.

## Implementation note (2026-09-18)

Steps 1-5 are implemented. Newly frozen profiles default to the correctness, security, and resilience/state-integrity panel; reviewers within one panel launch concurrently and fully drain; one quiescent integrity check follows settlement; trustworthy results are consumed in frozen panel order; incomplete panels block without a gate record or remediation; and remediation, verification, and later panels remain sequential. The delivery and CLI synthetic current-policy records were advanced to the three-seat binding because their validators compare exact frozen panel membership. The run driver was inspected and required no change.

The independent implementation review reported one medium-confidence verification gap and no observed production defect. That finding is accepted and resolved by mixed-duration/mixed-finding ordering, ordered two-reviewer failure, and non-zero concurrent cost regressions, each proved with a failing guard mutation before restoration. Focused dispatch and code-review-stage suites pass after the correction. Final repository verification completed with 1,184 tests passed, 0 failed, and 5 skipped; strict typechecking passed; doc-check was clean; `git diff --check` was clean; and `AGENTS.md` and `CLAUDE.md` remained byte-identical.

Step 6 remains deliberately unexecuted: no paid or external provider run was authorized. Real-provider acceptance of three concurrent native launches and a recorded resilience response therefore remain unverified release conditions, exactly as scoped above; no provider fixture was invented.
