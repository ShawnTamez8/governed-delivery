# CLI operator implementation plan — review

**Reviewed document:** `plan.md`
**Document type:** Plan
**Review date:** 2026-09-09
**Status:** reconciled
**Hazards considered:** 2 governs the crashed-writer inspection gap below, because a reader that cannot open the store discards the only record of the failure it exists to explain; 8 and 9 govern the duplicated executable probe, because a readiness check that spawns differently from the real dispatch certifies a launch path nobody exercises; 4 governs the prompt-marker fixture router, which is the sole end-to-end evidence Task 8 produces; 5 and 18 govern the delivery and completion-gate wording, which the plan already restricts to recorded evidence and frozen commands; 7 governs the no-replay rules, which the plan states correctly; 11, 12, and 14 govern doctor's separation of current from frozen facts and its refusal to claim account readiness. Hazards 1, 3, 10, 13, 15, 16, and 17 concern prompt, schema, and reconciliation behavior this plan explicitly leaves unchanged.

---

## Summary

The plan is unusually well grounded: its blocker claims about `Store`, `BEGIN IMMEDIATE`, `stage.started_at`, and the run-duration limit hold against source, the shared-parser extraction targets two genuinely duplicated blocks in `src/code-review-stage.ts` and `src/delivery-stage.ts`, and the boundary table matches the real stage vocabulary including the deliberately absent pre-approval stage row. Three defects nonetheless make the completion gate weaker than it claims and put one hazard-covered subsystem on a second implementation path.

## Verdict

- **Ready for planning after required changes** — Fix the three critical issues below. The command contract, boundary interpreter, and consent model need no redesign.

## Critical issues — must fix before implementation

**Issue:** The combined regression pass omits suites that cover the modified code

- **Why it matters:** The plan modifies `src/store.ts`, `src/migrate.ts`, `src/lock.ts`, and `src/cli.ts`, and its own blast-radius section states that `Store` serves every stage, approval, audit, and dispatch path. The enumerated 20-file pass in "Completion gate and rollback" omits `test/audit.test.ts`, whose appends run through the `Store.transaction` frame the plan changes, and also omits `test/schema.test.ts`, `test/governed-config.test.ts`, `test/select.test.ts`, `test/executor.test.ts`, `test/harness.test.ts`, `test/patch-application.test.ts`, `test/commit-verification.test.ts`, and `test/delivery-coverage.test.ts`.
- **Where:** "Completion gate and rollback", the `node --test` block.
- **Production impact:** The plan declares regression safety a completion criterion and then defines a gate that cannot observe a regression in the audit chain, the migration inventory, or governed-config parsing. A broken hash chain ships as passing.
- **Recommended fix:** Add `npm test` as the final regression pass after the targeted commands, and state that the enumerated list is the fast iteration loop, not the regression evidence.

**Issue:** Doctor's executable probe becomes a second, unshared spawn implementation

- **Why it matters:** Task 3 Step 3 requires probing `CLAUDE_CODE.probe` "directly with a bounded 5000 ms process timeout and captured output". `probeExecutor` in `src/harness.ts` accepts no timeout and discards stdout, and the file map neither modifies `src/harness.ts` nor lists it among the modules reused unchanged. The implementer therefore writes a second spawn site for the one launch path hazards 8 and 9 exist to protect, and the repository's learning record already records that a responsibility implemented on two parallel paths fails on the untouched copy.
- **Where:** "File map and integration boundaries" table, and Task 3, Step 3.
- **Production impact:** Doctor reports the harness ready while the real dispatch resolves a different executable, or reports it unavailable after the harness changes its launch semantics. Both outcomes make the free readiness command actively misleading before a paid run.
- **Recommended fix:** Add `src/harness.ts` to the file map with the narrow change of an optional timeout and captured-output parameter on `probeExecutor`, require `src/readiness.ts` to call it, and add an assertion that doctor and dispatch resolve the same argv.

**Issue:** Read-only inspection has no defined behavior against a crashed writer

- **Why it matters:** Task 2 Step 4 exercises only a *live* writer holding the lock with uncommitted changes. Task 6 Step 4 explicitly declines to promise cleanup on hard process kill, and the snapshot contract defines an `interrupted_or_inconsistent` phase, so a killed writer is a state the plan expects. [Inference, from SQLite's documented rollback-journal semantics] a read-only connection that encounters a hot journal cannot replay it and fails to open, because journal playback requires write access. The store uses the default journal mode; nothing in `src/store.ts` or the migrations selects WAL.
- **Where:** Task 2, Step 4, and the `errorCode` vocabulary under "Output and exits".
- **Production impact:** `status` and `runs` fail in exactly the scenario that motivates them. The operator's first diagnostic after a crash returns an unmapped open error rather than a named limitation and a repair.
- **Recommended fix:** Add a killed-writer case to Task 2 Step 4 that terminates a writer mid-transaction, requires a named `state_unavailable` outcome carrying the originating SQLite reason, and names the writer-side recovery command as the repair. If the case proves recoverable read-only, record that measured result instead.

## High-risk areas

**Risk:** One `--yes` authorizes the entire post-approval chain

- **Why:** The post-approval invocation advances plan, plan review, implementation, verification, the bounded code-review loop, and delivery under a single consent decision. The plan excludes hard dollar caps, and the repository's own evidence puts a clean chain at $1.39473 and a remediated chain at $2.40174. The preview shows dispatch ceilings derived from frozen policy, not money.
- **Impact if ignored:** An operator learning the tool consents once and cannot stop at the next boundary without killing the process, which the plan already declines to make safe.
- **Mitigation:** Add a bounded stop control to the `run` contract — a `--stop-after <group>` or single-group mode — and require the consent preview to state explicitly that consent covers every listed group.

**Risk:** The only end-to-end proof depends on matching prompt text

- **Why:** Task 6's fixture router selects emitters "by the role/artifact markers in `src/prompts.ts`" and fails on an unmatched prompt. Task 8 builds the entire journey, negative matrix, and break-test evidence on that router. The learning record already carries three occurrences of a pinned prompt phrase breaking when the source wraps it across template-literal lines.
- **Impact if ignored:** An unrelated prompt edit fails the whole journey suite as an unmatched prompt, which reads as a product defect and costs a diagnosis cycle each time.
- **Mitigation:** Require the router to derive its markers from exported constants in `src/prompts.ts` rather than re-spelling them, and require the unmatched-prompt failure to name the marker set it searched.

**Risk:** Guided execution enforces a run-age rule the core does not apply to the same stages

- **Why:** [Verified] only `src/implementation-stage.ts`, `src/verification-stage.ts`, `src/code-review-stage.ts`, and `src/delivery-stage.ts` compare run age against `profile.policy.runDurationLimitSeconds`. Task 5 Step 5 applies that refusal before every group, so `run` refuses a spec or plan group that `bw spec --run` accepts. The plan states elsewhere that it introduces no new policy.
- **Impact if ignored:** Two surfaces of one system disagree about whether a run is alive, and the refusal reads as a defect rather than a deliberate guided-path precondition.
- **Mitigation:** Name the early refusal as a guided-entry precondition in the scope section, require its message to state that the low-level stage commands retain their own narrower rule, and add a regression pinning that the spec and plan stage functions remain ungated by age.

## Medium and low concerns

- Task 7 Step 1's expected result, "stdout payload and file bytes are identical to the core payload", is imprecise. The existing command prints through `console.log`, so stdout carries a trailing newline the file must not. [Verified] `scripts/sign-approval.mjs` applies `normalizeText(...).replace(/\n+$/, "")`, so both transports verify; state the assertion as two exact comparisons rather than one identity claim.
- [Verified] `runDeliveryStage` is synchronous and performs its git work through `spawnSync`, so the 15-second timer in Task 6 Step 4 cannot fire during delivery. Scope the heartbeat claim to the asynchronous groups.
- Task 9 Step 2 edits `ARCHITECTURE.md` sections 15 and 19. `derive()` in `scripts/doc-check.mjs` parses section 5's fence and its backticked tokens, and section 15's `sql` fence. State that headings and fence shapes must not be reshaped, and that a reshaped fence exits 2 as a checker failure rather than 1 as a document defect.
- The `errorCode` vocabulary lists fifteen values without mapping each to its emitting commands and exit codes. Add that mapping so an implementer cannot mint a plausible sixteenth.
- Task 3 produces doctor results before Task 4 defines the output contract, so Task 3's output assertions need rewriting in Task 4. Restrict Task 3 to returning data and defer every doctor output assertion to Task 4.
- The boundary fingerprint in Task 5 Step 4 is unnamed. State exactly which run, stage, and audit columns it covers, so the recheck is reproducible.
- The global `--repo` may appear before the command, but the existing dispatcher reads `argv[0]` as the command name and exits 2 for anything unknown. Task 1 must state that global option extraction precedes command selection.
- `README.md` is `current` tier, where an unresolved root-anchored path is an error rather than a warning. Task 9 Step 1 must keep its PowerShell examples free of unresolvable rooted paths.
- The feature directory holds no `design.md`, and the eighteen acceptance criteria the coverage table binds to live in `.claude/sessions/`. `CLAUDE.md` declares `design.md` the human-authored design file for a feature directory. Promote at least the criterion table.

## Missing and underspecified areas

- Field-level shapes for the `stages`, `proposals`, `evidence`, and `delivery` sections of the run snapshot. Hard rule 3 requires one schema per thing; a JSON contract described only by section name leaves the implementer to invent it.
- Whether `run` performs a schema migration as a side effect of opening its writer after consent. The read-only preview refuses a version mismatch, which appears to close the gap; state that explicitly so no implicit migration rides on execution consent.
- The interaction between `status --json` truncation and large recorded evidence. The plan forbids raw model output but sets no bound on finding, report, or stage array sizes.
- Whether `doctor --run` refuses or degrades when the frozen profile file is unreadable. The snapshot contract names invalid profile evidence; the doctor task does not.

## Suggested improvements

- Record in the plan that `stage.started_at` is never written and `stage.ended_at` is written by `completeStage`, and pin both with a regression so a later change to either silently alters the labelled activity source.
- State the observable difference between `not_checked` and `fail` in doctor's text output, so a partially applicable report is not read as a partial failure.
- Name the concrete SQLite busy-timeout and retry difference between reader and writer in one place, rather than only inside Task 2 Step 2.

---

## Reconciliation

**Date:** 2026-09-09
**Disposition:** 19 accepted, 2 rejected, 1 deferred, 0 open
**Status:** reconciled
**Hazards considered:** 2 requires a named unavailable result without inspection-side recovery; 4 requires schema-bound router and output evidence; 7 keeps consent separate from replay; 8 and 9 require the shared native probe; 11 and 12 distinguish failed, skipped, current, and frozen readiness; 14 and 18 limit timing, cost, and delivery claims. The remaining findings clarify document contracts without changing prompt bytes, stage order, signing authority, or review policy.

The operator retains consent for the complete previewed execution range and
selects complete structured snapshot arrays without truncation. The original
review above remains the record of its claims; the verdicts below identify
the two claims that repository evidence rejects. Reconciliation changes the
plan, not runtime code or implementation authorization.

### Verdicts

- **Accepted — The combined regression pass omits suites that cover the modified code:** The completion gate makes the enumerated commands the iteration loop and `npm test` the final regression evidence, covering the shared Store, audit, harness, and prompt paths.
- **Accepted — Doctor's executable probe becomes a second, unshared spawn implementation:** The file map and Task 3 extend `src\harness.ts` narrowly for timeout/captured output and require doctor and dispatch to share `probeExecutor`, executable argv, and direct launch.
- **Accepted — Read-only inspection has no defined behavior against a crashed writer:** The availability contract and Task 2 add a real killed-writer/hot-journal case, original SQLite diagnostics, and explicit `migrate` recovery without workflow replay; [SQLite locking, section 4.1](https://www.sqlite.org/lockingv3.html#dealing_with_hot_journals) establishes the write requirement, while the supported-runtime experiment remains implementation work.
- **Deferred — One `--yes` authorizes the entire post-approval chain:** The operator keeps the existing range and defers a stop-after/single-group control until a separate range-control decision; scope and Task 6 explicitly state that consent covers every previewed group and that interruption does not guarantee resumability.
- **Accepted — The only end-to-end proof depends on matching prompt text:** Task 6 shares unchanged prompt-family prefixes from exported builder constants with the router, rejects unmatched/ambiguous prefixes with the searched marker set, and requires byte-preserving extraction evidence.
- **Accepted — Guided execution enforces a run-age rule the core does not apply to the same stages:** Scope and Task 5 name the guided-entry precondition and preserve direct spec/plan behavior; the reconciled analysis's time-limit contract and CLI-AC-16 already authorize that distinction.
- **Rejected — Task 7 Step 1's stdout/file identity assertion is imprecise:** `src\cli.ts:582` uses `process.stdout.write(approvalPayload(bound.binding))`, not `console.log`, and `test\cli.test.ts:549-555` asserts no trailing newline; both transports correctly require the canonical bytes, so the plan retains its existing assertion.
- **Accepted — Delivery cannot emit the 15-second heartbeat:** Task 6 limits timed observations to event-loop availability and gives synchronous delivery start/end observations only, matching `runDeliveryStage` and its `spawnSync` Git calls.
- **Accepted — Architecture edits must preserve checker parse boundaries:** Task 9 preserves the named headings and sequence/schema/storage fences that `derive()` consumes and distinguishes checker exit 2 from document-defect exit 1.
- **Accepted — The error vocabulary lacks command/exit mappings:** Output and exits now maps all fifteen codes to emitting commands, outcomes, precedence, and exits while keeping readable inspection limitations separate from command failure.
- **Accepted — Doctor output assertions precede the common output contract:** Task 3 returns data only; Task 4 depends on Task 3 and owns doctor text/JSON assertions and the shared serializer.
- **Accepted — The boundary fingerprint is unnamed:** Task 5 defines exact run, stage, and audit column tuples, ordering, null handling, and SHA-256 serialization, without claiming filesystem or audit-chain verification.
- **Accepted — Global `--repo` extraction must precede command selection:** Task 1 explicitly extracts global options before choosing the command and covers both positions and cross-position duplicates.
- **Accepted — README examples must avoid unresolved rooted paths:** Task 9 requires variable-derived operator paths and existing checkout assets under the README's current-tier path rules.
- **Rejected — The feature needs a `design.md` with the criterion table:** `AGENTS.md` explicitly distinguishes the current bootstrap plans/reviews from the eventual generated feature layout; this bootstrap plan cites the repository's reconciled analysis and its eighteen criteria, so the runtime design-file convention does not require duplicating or moving that source.
- **Accepted — Snapshot sections lack field-level shapes:** The snapshot contract defines stage, proposal, evidence, finding/report/decision, delivery, and verification projections from the existing row and retained-record types, including order and unavailable-source semantics.
- **Accepted — Guided writer startup leaves migration consent implicit:** Task 6 requires the exact-current schema during preview and again under the writer lock before default writer startup, refusing pending migrations instead of treating execution consent as migration authority.
- **Accepted — Large status snapshots lack a completeness rule:** The operator selects complete selected-run structured arrays; the contract and Task 4 prohibit silent truncation and add row-derived large-output assertions without pagination or raw-body output.
- **Accepted — Doctor lacks unreadable-profile behavior:** Task 5 retains readable database/current-check data, nulls unavailable frozen facts, marks dependent checks `not_checked`, and returns `not_ready` with `evidence_invalid` and the originating profile reason.
- **Accepted — Stage timing writes need explicit regression coverage:** Task 4 asserts that insertion/status updates leave `started_at` null and `completeStage` writes `ended_at`, then binds activity labels to the actual rows and audit timestamps.
- **Accepted — Doctor must distinguish `not_checked` from `fail` in text:** The output contract names distinct `PASS`, `FAIL`, and `NOT CHECKED` labels with negative evidence versus skip reasons and excludes skipped checks from performed-failure counts.
- **Accepted — Reader and writer busy policies need one reference:** The availability section records reader 1000 ms/one attempt, Store writer 5000 ms/up to three attempts with 100 ms pauses, and migration 5000 ms without the Store retry wrapper.
