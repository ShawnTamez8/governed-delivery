# CLI Operator Implementation Plan

**Status:** Implemented

**Goal:** Let a local operator inspect a run and advance the existing delivery chain from proven stage boundaries without manual sequencing, implicit spend, or changes to approval authority.

**Source:** `.claude\sessions\2026-09-09-docs-cli-operator-analysis.md`, reconciled 2026-09-09, including CLI-AC-01 through CLI-AC-18; its accepted GitHub-boundary dispositions in `docs\proposals\2026-09-09-github-project-projection-and-upstream-spikes-review.md`. `ARCHITECTURE.md` and `docs\hazards.md` remain binding.

**Hazards considered:** 1 and 2 require original refusal reasons and retained evidence references rather than generic failures; 4 and 5 require schema-bound or recorded inputs and actual delivery evidence; 7 prohibits automatic replay or an outer remediation loop; 8 and 9 require direct native executable probing and a demonstrated Windows invocation; 10 and 12 require visibly separate current and frozen configuration; 11 requires useful free readiness without inventing account readiness; 13 and 16 keep source authority and proposal export separate from execution; 14 and 18 require honest reviewer, verification, cost, and completion labels. No parser, prompt, or review-policy redesign is included.

**Assumptions:** The reconciled analysis's local, single-operator, checkout-based model is retained. Explicit run IDs, intake identities, operator-selected models, and external signing remain required. Planning is authorized; implementation and any paid acceptance run require separate authorization.

**Approach:** Add strict command routing, canonical local targeting, a read-only opening mode on the existing concrete Store, shared derived run interpretation, and a fixed sequential caller of the existing stage functions. Preserve low-level command outputs. Add approval file transports and document absolute checkout-local Node invocation rather than packaging a distribution.

**Affected areas:** CLI arguments and output, local target resolution, Store connection/read semantics, shared executable probing, intake diagnostics, derived execution eligibility, approval transport, byte-preserving prompt-marker extraction for fixture routing, and operator documentation. No database columns, profile fields, stage kinds, provider adapters, or remote integration.

**Known blockers:** [Verified] The current Store constructor migrates and `Store.transaction` uses `BEGIN IMMEDIATE`, so neither can serve inspection unchanged. The lock identifies a repository writer, not an active run. `stage.started_at` is not populated, failed invocations can lack agent rows, and profile/configuration reads have their own refusals. The source TypeScript bin is not a distributable package; only a checkout-local invocation is in scope. [Verified] The project learning record excludes general recovery, GitHub integration, and further paid runs. None requires an unresolved product decision for this plan.

**Blast radius:** [Verified] Searches of source, tests, package metadata, and the canonical driver find `src\cli.ts` invoked by `test\cli.test.ts`, `.claude\skills\run-buildworks\driver.mjs`, and the `package.json` bin declaration. Store is used by every stage, approval, audit, dispatch, and their tests; preserve its default writer behavior. `applyMigrations` is called by Store and migration tests. `acquireLock` is called by CLI and lock/CLI tests. The existing external signer and the canonical driver consume raw approval stdout and numeric low-level results; those contracts remain unchanged. The detailed file map and boundary contract below delimit the additions.

**Verification:** Use the existing Node test runner for targeted CLI, Store, lock, approval, stage, and schema/recorded-fixture cases; strict `npm run typecheck`; and `npm run check:docs`. Exercise real CLI subprocesses and real core stages in disposable targets, with schema-bound local harness fixtures rather than paid Claude. Break new guards only in an isolated source mirror. A live provider run is not part of the completion gate.

---

## Scope and baseline

This is a full-path plan. The feature name `cli-operator` is derived from the
analysis's primary outcome, not an existing runtime feature slug. This
bootstrap implementation plan is not a generated plan-stage artifact.

Planning baseline: `a8a71d1`, branch `code-review-stage`, Node v26.4.0 on Windows.
The modified project learning record and the three existing untracked
analysis/review documents are input work, not changes to replace or revert.
The repository has no `docs\upstream` directory. The reconciled review has
five accepted and five deferred dispositions, with no open local-slice finding.

The independently observable outcome is one local operating journey:
help/readiness, explicit run creation, guided execution to the approval pause,
external approval, guided continuation, and inspection of delivery or a block.
Inspection and execution ship together because the command must explain the
state it is permitted to advance.

Excluded: implicit run creation or latest-run mutation; partial-stage recovery;
automatic retries, signing, proposal export, cleanup, merge, push, or publication;
GitHub setup/intake/sync; new execution stages; `status.md`; new status columns;
hard dollar caps; live agent/cost telemetry; a TUI/service; and npm distribution.
Existing code review exclusively owns its bounded panels, patching, and
post-patch verification. Document-review behavior is not redesigned.

The frozen run-age refusal is an explicit guided-entry precondition, including
before spec and plan. The reconciled analysis and CLI-AC-16 select this early
refusal because downstream delivery is already unavailable after the deadline.
The low-level spec and plan functions retain their narrower existing checks;
the CLI does not add age guards to those functions or a deadline watchdog.

One invocation's consent covers every group in its preview through approval
or terminalization, including bounded internal remediation. An optional
stop-after/single-group control is outside this increment. The operator must
wait for the invocation to return or interrupt the process; interruption does
not promise cleanup or resumability. A later operator decision to bound the
range at intermediate groups reopens that control, not approval policy.

## Chosen command contract

`bw` below denotes the checkout-local invocation documented in Task 9, not a
claim that `npm install` puts an executable on PATH.

| Surface | Exact first-increment contract |
| --- | --- |
| `bw --help`, `bw help`, `bw help <command>`, `bw <command> --help` | Exit 0 without resolving a target, probing an executor, opening state, or taking a lock. Known-command help does not require that command's required options. Unknown commands/options still exit 2, including beside `--help`. |
| Global `--repo <path>` | Available before or after the command, exactly once. Default is the invocation's working directory. Resolve an existing local directory through Git's worktree root and `realpath`; reject missing paths, non-worktrees, and bare repositories with a named operational error. Root and child invocations address the same store. |
| Existing commands | Keep names, required intake fields, numeric/path/raw-payload success outputs, and stage exit codes. Apply strict option validation and canonical targeting consistently. Deliberately reject formerly ignored options, positional junk, and duplicate flags. A non-Git directory is no longer an implicit state-creation target. |
| `doctor [--slug <slug> \| --run <id>] [--json]` | No-spend local report. No selector means repository/current-configuration checks; `--slug` adds the existing design-path checks; `--run` adds frozen-run and next-boundary diagnostics. The selectors are mutually exclusive. |
| `runs [--limit <n>] [--json]` | Newest-first by run ID, default 20, allowed 1-100. Fetch `limit + 1` to return `hasMore`; no implicit execution selection. Include project, feature ID, slug, persisted status, derived phase, and last recorded activity. |
| `status --run <id> [--json]` | Inspect the selected run, even when blocked, completed, or unable to execute. Include the fields defined below. No probe, migration, remote lookup, or writer-lock acquisition. |
| `run --run <id> [--yes] [--json]` | Advance existing eligible stage groups to approval, block/refusal, or completion. No model override, new run, recovery switch, or publication switch. `--yes` is consent for this invocation's displayed execution range only. |
| `approval-request --run <id> [--expires <iso>] [--out <path>]` | Preserve canonical raw stdout when `--out` is absent. With `--out`, exclusively create the named file with the same UTF-8 bytes, no BOM and no trailing newline; leave stdout empty and print the path/expiry to stderr. Never overwrite or create parent directories. |
| `approve --run <id> --expires <iso> (--signature <base64> \| --signature-file <path>)` | Exactly one signature source. File transport accepts UTF-8 with an optional BOM and surrounding line endings; trim transport whitespace, then pass the base64 unchanged to `approveRun`. Internal whitespace or malformed base64 remains a core refusal. No private-key option. |
| `proposal-export --proposal <id> [--name <slug>]` | Remains an explicit independent operator action, including for terminal runs. Preserve exclusive-create, name validation, and audit behavior. Guided execution never calls it. |

Argument values support both `--name value` and `--name=value`; booleans are
bare flags and reject assigned values. Reject missing/empty values, duplicates
across both forms, unsupported options, and unexpected bare arguments before
any state access. Keep the existing non-negative decimal ID convention, but
reject numbers outside `Number.isSafeInteger`; zero can name a missing row,
not trigger implicit selection. Validate model and intake identity syntax with
the existing receiving rules, not a second independently maintained pattern.

Resolve user-supplied transport/prompt paths against the original invocation
directory, not `--repo`; resolve stored repository-relative evidence against
the canonical target. Preserve recorded absolute references as recorded:
do not relocate or rewrite evidence to make a moved run appear resumable.
Pass the selected root explicitly rather than changing the parent process cwd.
Use local Git queries with optional index refresh disabled; targeting and
inspection must not alter the index simply by asking for status.

### Output and exits

New JSON-enabled commands emit exactly one JSON object and one terminating
newline to stdout, including errors. Progress and diagnostics go to stderr.
Each command has one current result shape, with nullable fields for unavailable
facts, no schema version or alternative compatibility shapes:

`{ command, outcome, repository, runId, errorCode, reason, observedAt, result }`.

`result` has that command's documented fields below, or is null when the
command cannot obtain its result. `runId` is null where no run is selected.
`repository` is null only before successful target resolution. Usage failures
also use this envelope when a bare `--json` is present on a JSON-capable
command; malformed input must not cause an extra stdout usage banner.
Help is plain text, including when requested alongside `--json`.

`errorCode` is null on successful inspection/completion/approval pause, or
one of `usage`, `target_unavailable`, `state_missing`, `schema_unsupported`,
`state_unavailable`, `run_missing`, `setup_required`, `writer_contention`,
`consent_required`, `observation_changed`, `run_aged`, `chain_incomplete`,
`evidence_invalid`, `policy_block`, or `execution_failed`. Preserve the
originating diagnostic in `reason`. Usage is `outcome: error` on inspection
commands and `outcome: refused` on `run`, with exit 2 in both cases.

| Command | Result fields / outcome vocabulary |
| --- | --- |
| `doctor` | `checks`, `current`, `frozen`, `limitations`; outcomes `ready`, `not_ready`, `error`. Each check has `name`, `status` (`pass`, `fail`, `not_checked`), `evidence`, and `repair`. |
| `runs` | `runs`, `limit`, `hasMore`; outcomes `ok`, `state_missing`, `error`. An existing empty store is `ok` with an empty array. |
| `status` | The run snapshot below; outcomes `ok`, `state_missing`, `run_missing`, `error`. A blocked run with readable state is still `ok`. |
| `run` | `snapshot`, `execution`; outcomes `completed`, `awaiting_approval`, `consent_required`, `refused`, `blocked`, `failed`. If the run cannot be loaded, report `refused` with a named reason and a null snapshot. |

Inspection exits 0 when the requested inspection succeeds, 1 for missing
state/run, failed readiness, contention, or other operational failure, and 2
for usage. `runs` with no store exits 1 as `state_missing`; an empty existing
store exits 0. Guided execution exits 0 only for completed delivery, 3 for a
valid approval pause, 1 for every other operational outcome, and 2 for usage.
Existing low-level stage codes and approval bytes are not retrofitted into
this envelope.

The following is the closed error mapping. All four new commands emit `usage`
with exit 2 and `target_unavailable` with exit 1. The remaining mappings use
exit 1. Inspection that obtains a readable snapshot still returns `ok`/exit 0:
its ineligible actions carry the corresponding reason/code below without
turning a blocked or incomplete run into an inspection error.

| `errorCode` | Emitting commands and condition | Outcome |
| --- | --- | --- |
| `usage` | `doctor`, `runs`, `status`, `run`: invalid arguments | `error`; `run` uses `refused` |
| `target_unavailable` | All four: local root resolution fails | `error`; `run` uses `refused` |
| `state_missing` | `runs`, `status`, `doctor --run`, `run`: no existing store | `state_missing` for `runs`/`status`; `error` for doctor; `refused` for run |
| `schema_unsupported` | State-reading commands above: schema differs from the checkout inventory | `error`; `run` uses `refused` |
| `state_unavailable` | State-reading commands above: SQLite open/query fails, including bounded contention or required hot-journal recovery | `error`; `run` uses `refused` |
| `run_missing` | `status`, `doctor --run`, `run`: selected row absent | `run_missing` for status; `error` for doctor; `refused` for run |
| `setup_required` | `doctor`: required current local check fails; `run`: required setup prevents entry | `not_ready`; `run` uses `refused` |
| `writer_contention` | `doctor --run`: writer prevents continuation; `run`: another writer is observed or acquisition fails | `not_ready`; `run` uses `refused` |
| `consent_required` | `run`: consent absent, declined, cancelled, or EOF | `consent_required` |
| `observation_changed` | `doctor --run`, `run`: boundary observation changes across the required recheck | `not_ready`; `run` uses `refused` |
| `run_aged` | `doctor --run`, `run`: otherwise executable guided boundary exceeds frozen age | `not_ready`; `run` uses `refused` |
| `chain_incomplete` | `doctor --run`, `run`: partial/manual/unknown or contradictory row chain | `not_ready`; `run` uses `refused` |
| `evidence_invalid` | `doctor --run`, `run`: required profile, handoff, audit binding, or worktree evidence is missing/invalid | `not_ready`; `run` uses `refused` |
| `policy_block` | `doctor --run`, `run`: persisted block or existing policy gate prevents continuation; `run`: a called stage records a block | `not_ready`; `run` uses `blocked` for persisted blocks, otherwise `refused` |
| `execution_failed` | `run`: a core call fails without recording a block, or an unexpected execution error occurs | `failed` |

Doctor without `--run` does not require a store. Failures of its independent
checks remain check data under `setup_required`, not invented database errors.
Use validation/target/store/run failures first; once data is available preserve
all applicable check/action reasons. For multiple failed run-readiness checks,
select the top-level code in this order: `observation_changed`,
`evidence_invalid`, `policy_block`, `chain_incomplete`, `writer_contention`,
`run_aged`, `setup_required`. A readable persisted block takes `blocked` in
guided output even if its retained evidence also has limitations.
Do not classify core errors by matching prose: inspect the durable post-call
state; a false core result without a recorded block is `execution_failed`.

`run.result.execution` contains `consent` (`not_needed`, `required`,
`declined`, or `granted`), `groupsAttempted`, `groupsCompleted`,
`remainingGroups`, `startedAt`, `endedAt`, and `elapsedMs`. Group fields are
ordered arrays of the fixed group names in Task 6; timestamps/elapsed are
null until invocation execution begins. A group is completed only after
durable re-reading establishes the expected passed boundary. A refusal before
a call does not increment `groupsAttempted`; a core call that fails does.
These are invocation observations, not persisted counters or model telemetry.

Text output conveys the same distinctions without requiring color, cursor
control, or an interactive terminal. Use the frozen `systemName` when loaded;
otherwise use current configuration without implying it was frozen for the run.
Doctor prints `PASS`, `FAIL`, and `NOT CHECKED` as distinct text labels.
`FAIL` names a performed check's negative evidence and repair; `NOT CHECKED`
names why the check does not apply or cannot run. Skipped checks do not count
as performed failures, and unverified account readiness remains a limitation
even when every applicable local check passes.

### Run snapshot contract

The shared snapshot contains `run`, `phase`, `stages`, `workflowAction`,
`operatorActions`, `proposals`, `configuration`, `approval`, `cost`, `activity`,
`writer`, `delivery`, `evidence`, and `limitations`.

`run` contains repository-local identity and persisted status separately from
the derived `phase`. The phase is one of `ready`, `awaiting_approval`,
`blocked`, `completed`, or `interrupted_or_inconsistent`; these are output
labels, never new rows/statuses. Repository writer observation is a separate
field, not a claim that this run or a particular agent is active.

`workflowAction` names a candidate group or approval handoff, its eligibility,
its refusal reasons, and a command/argument array that explicitly identifies
the target and run. An ineligible action is not printed as an executable next
step. `operatorActions` independently lists available inspection,
`verify-audit`, approval transport when eligible, and stored-proposal exports.
Proposal actions carry proposal ID, route, title, evidence reference, and any
known default-name/collision limitation; explicit export rechecks its own rules.
There are no placeholder GitHub actions, IDs, URLs, or publication statuses.

`configuration` reports verified profile hash, policy hash, starting commit,
model map, verification command argv, review panel/round/severity controls,
deadline, and signer-binding fingerprint/null. Invalid or missing profile
evidence is named without hiding the remaining readable database rows.
`approval` reports missing/granted state, approval identity, recorded signer,
scope, risk, hash bindings, and the acceptance expiry. An old expiry after
grant is information, not a new revocation rule.

`stages` preserves order, predecessor ID, status, gate, output reference, and
known start/end evidence. `activity.lastRecordedAt` is derived from actual
run creation/update, stage-end, and run audit timestamps; dispatch-only
activity does not use `run.updated_at` as its proxy. Where `started_at` is
null, use the matching stage-create audit event with that source labelled,
otherwise null. Invocation elapsed time is an observation, not durable stage
duration, a watchdog, or a percent complete.

`cost` contains currency `USD`, `knownUsd`, agent-row count, cost-reported and
cost-unreported row counts, null-aware token totals/coverage, recorded failed
attempt count, and the same subtotals by stage and agent. Aggregate
`agent_run JOIN stage ON stage.id = agent_run.stage_id WHERE stage.run_id = ?`
before attaching findings or reports. Count `agent.dispatch.failed` events
for this run separately; never add them as confirmed charges or successful
rows. Code-review remediation remains attributed to its owning stage.
Missing telemetry stays unknown; even zero known failures does not prove a
complete bill after process loss. Formatting does not round or rewrite stored
values. There is no live spend estimate or dollar guarantee.

`delivery` identifies recorded outcome, retained branch/worktree, original
patch base and final reviewed/verified commit when established, changed and
declared/delivered/missing paths, verification command outcomes, and report/log
references. Historical findings retain round, reviewer attribution, location,
severity, subject, and any recorded decision. Final below-threshold findings
are labelled recorded/non-blocking, never fixed or harmless; prior-round
findings are historical, not assumed to have a cross-round identity.

Default output lists evidence paths and concise recorded reasons, not complete
raw model output, environment values, signatures, or key contents. When failed
dispatches have no exact raw reference, name the run's retained raw directory
and the missing linkage; do not guess a file by timestamp. Evidence outside a
consistent readable handoff is labelled missing, unverified, or inconsistent
rather than repaired. Completion describes the existing gates, not proof of
product correctness from version-only commands.

### Snapshot field shapes and completeness

These are output projections of existing records, not new persisted schemas.
Every object includes its listed keys. IDs are numbers, timestamps and paths
are strings, and unavailable scalar evidence is null. Empty arrays mean no
recorded entries, not a failed read. Record a missing/invalid source in
`limitations` and its evidence entry before returning null or an empty array.

| Section | Exact fields and source |
| --- | --- |
| `stages[]` | `id`, `runId`, `kind`, `ordinal`, `inputStageId`, `outputRef`, `status`, `gateResult`, `startedAt`, `endedAt`, `startEvidence`. Map `StageRow` fields without changing status/gate values; order by ordinal then ID. `startEvidence` has `at`, `source`, `auditId`; source is `stage.started_at`, `stage_create_audit`, or null, with the matching timestamp/event ID or null. |
| `proposals[]` | `id`, `runId`, `stageId`, `identity`, `title`, `problem`, `whyUpstream`, `route`, `evidenceRef`, `createdAt`, `sourceFindingIds`. Map `ProposalRow` and `proposal_source`, order proposals and source IDs numerically. Do not rewrite the stored route or infer subsequent duplicate-candidate evidence from `evidence_ref`. |
| `evidence` | `references`, `findings`. References use the shape below; findings use the existing canonical/report/decision identities, not a merged synthetic reviewer verdict. |
| `delivery` | `stageId`, `outcome`, `branch`, `worktreePath`, `patchBase`, `initialVerifiedCommit`, `finalReviewedCommit`, `deliveredCommit`, `changedPaths`, `declaredPaths`, `deliveredPaths`, `missingPaths`, `verification`, `resultRef`, `reportRef`. Outcome is the retained delivery record's `pass`/`block` or null. Map the record's `changed`, `declared`, `delivered`, `missing`, and `verifiedCommit`; derive initial/final commits only from their bound verification/review handoffs. Branch/worktree observations do not substitute for a missing delivery record. |

Each `evidence.references` entry has `kind`, `stageId`, `agentRunId`,
`auditId`, `ref`, `availability`, `reason`. Kind is `stage_output`,
`raw_output`, `raw_directory`, `proposal`, `verification_result`,
`verification_log`, `code_review_result`, `code_review_report`,
`delivery_result`, or `delivery_report`. IDs without a source row/event are
null. `ref` preserves the recorded path or the existing path helper's
deterministic report/raw-directory reference. Availability is `available`,
`missing`, `unverified`, or `inconsistent`; reason is null only when no
limitation applies. A present file is not automatically hash-verified.
Order references by stage ordinal, kind, source IDs, then reference text;
keep distinct source links even when two links name the same file.

Each `evidence.findings` entry has `id`, `stageId`, `round`, `intentKey`,
`location`, `reports`, `decision`, `finalPanelBlocking`. Reports contain
`id`, `agentRunId`, `reviewerId`, `severity`, `classification`, `subject`;
reviewer ID comes from the joined agent row and is null when that linkage is
missing. Order findings by stage ordinal, round, ID, and reports by ID.
`decision` is null or the existing `FindingDecisionRow` fields, omitting only
the redundant `finding_id`; retain its structured-column encoding unchanged
rather than inventing another reconciliation schema. It is a document-review
decision, never a synthesized code-review resolution. `finalPanelBlocking`
is a boolean only for a finding on a consistently bound final code-review
panel, derived from that panel's recorded blocking IDs; otherwise null.

`delivery.verification` contains ordered entries with `stageId`, `round`,
`commit`, `outcome`, `blockingCommand`, `commands`, `resultRef`. Initial
verification uses round null; remediation entries use their recorded panel
round. Each command uses the existing `RecordedVerificationCommand` fields
from `src\commit-verification.ts`: `name`, `argv`, `exitCode`, `timedOut`,
`spawnError`, `killError`, `outputOverflow`, `durationMs`, `evidenceRef`,
`blockedBecause`. Reuse that type and preserve nullable diagnostics.
Report every recorded command, not only the last successful verification.

Status and guided snapshots return complete structured arrays for the selected
run, including historical stages, findings, and reports. There is no new size
limit, pagination, or silent truncation in either text or JSON; raw provider
bodies and log contents remain excluded. Large records can produce large
output, and output failure must not become an empty or shortened success.
The `runs` inventory alone uses its documented `limit`/`hasMore` contract.
Boundary evaluation always consumes the complete selected-run chain/evidence.

### Store availability and explicit recovery

Read-only connections use a 1000 ms SQLite busy timeout, one attempt, and a
short deferred read transaction. Writers retain their 5000 ms busy timeout
and up to three total Store attempts on `SQLITE_BUSY`, with 100 ms between
attempts; migration connections retain their existing 5000 ms timeout without
that Store retry wrapper. No inspection changes journal mode or takes a lock.

A killed writer can leave a hot rollback journal. SQLite must roll it back
before reading consistent data, and that requires writes; a read-only command
therefore cannot guarantee availability after process loss. Map the original
SQLite failure to `state_unavailable`, including its code/message and the
instruction to run `bw migrate --repo <target>` explicitly with the matching
checkout when no live writer owns the repository. That existing writer-side
command permits SQLite recovery and applies pending migrations; it does not
repair stage evidence, replay a group, or make an interrupted chain resumable.
Never delete a journal, take over the lock, or invoke recovery from inspection.
An unreadable lock still requires the existing manual ownership diagnosis.
The killed-writer test measures the actual supported-runtime behavior; this
plan does not claim that experiment has already run.

## File map and integration boundaries

New symbols named here are explicit implementation additions, not claims that
they already exist. Use functions and data types, not a command plugin,
executor registry, storage interface hierarchy, or declarative workflow engine.

| File | Responsibility and callers affected |
| --- | --- |
| Create `src\cli-args.ts` | One fixed command/options definition used by CLI parsing and command-specific help. Includes the new command result/output choices without making low-level outputs JSON. |
| Create `src\repo-root.ts` | `resolveRepositoryRoot` resolves local Git worktrees. CLI is its production caller; direct resolution cases live in the new CLI tests. |
| Modify `src\cli.ts` | `main`, parser/usage replacement, explicit root plumbing in every existing switch arm, read/write routing, new commands, and approval file transport. Keep this the only executable entry point. |
| Modify `src\store.ts` | Optional read-only opening in `Store`/`openStore`, short `readSnapshot`, and extracted `validateRunIdentity` reused by `insertRun` and CLI intake parsing. Existing callers retain writer defaults. No SQL migration. |
| Modify `src\migrate.ts` | Extract `listMigrations` from the existing filename discovery/validation so application and read-only schema checks share the actual migration inventory. Preserve `applyMigrations` ordering and behavior. |
| Modify `src\lock.ts` | Add non-mutating `inspectLock`; reuse PID parsing/liveness in `acquireLock` without changing its ownership, stale-lock, or release-token behavior. CLI observation never calls acquisition. |
| Modify `src\harness.ts` | Extend the concrete `probeExecutor` with an optional timeout and captured stdout/stderr result. Doctor and `dispatchOnce` share its direct spawn; existing one-argument callers retain probe argv and refusal semantics. Do not change model invocation or its environment/timeouts. |
| Modify `src\prompts.ts` | Extract existing prompt-family role prefixes into exported constants consumed by their builders and the test router. Preserve rendered bytes exactly; no new protocol marker or prompt instruction. |
| Create `src\readiness.ts` | Shared `checkIntakeRepository` extracted from CLI's HEAD/dirty-tree/committed-config checks, plus `inspectReadiness` for doctor. New-run consumes only its existing intake checks, not doctor's additional advisory checks. |
| Create `src\operator-state.ts` | Run-scoped snapshot queries, cost aggregation, evidence navigation, fixed boundary interpretation, and action descriptions used by status, doctor, and guided execution. |
| Create `src\run-command.ts` | `advanceRun` calls the current stages directly, with one invocation consent decision and a re-read after each successful group. |
| Create `src\operator-output.ts` | Text/JSON serializers and redacted summaries shared by new CLI commands and guided progress/final output. No raw-provider-output streaming. |
| Modify `src\handoff.ts`, `src\code-review.ts` | Extract current retained-record validation as `parseVerificationHandoff` and `parsePassedCodeReviewRecord`, respectively. Existing core consumers and the new snapshot reader share these parsers; no new evidence shape. |
| Modify `src\code-review-stage.ts`, `src\delivery-stage.ts` | Replace only the extracted retained-record validation blocks with calls to the shared parsers, preserving guard ordering, errors, and gate/transaction behavior. No full-stage preflight refactor. |
| Create `test\cli-operator.test.ts` | Actual CLI subprocess contracts: targeting, help, doctor, inspection, consent, output, approval files, terminal proposal export, and Windows invocation. |
| Create `test\operator-state.test.ts` | Schema-bound snapshots, boundary/refusal matrix, multi-run cost arithmetic, missing telemetry, and recorded review/delivery presentation. |
| Create `test\run-command.test.ts` | Direct existing-stage integration through the guided caller; repeat invocation and no-replay/partial-chain assertions. |
| Create `test\fixtures\harness\emit-cli-run.mjs` | Test-only router over existing schema-bound emitter behavior for one frozen executor to serve the entire CLI journey. No runtime test flag or production provider alternative. |
| Modify `test\store.test.ts`, `test\migrate.test.ts`, `test\lock.test.ts` | Read-only connection/snapshot/schema/refusal tests and existing writer/migration/lock regression coverage. |
| Modify `test\handoff.test.ts`, `test\code-review.test.ts` | Direct current-format parser cases and malformed-record refusals for the narrow extractions. |
| Modify `test\harness.test.ts`, `test\prompts.test.ts` | Probe timeout/output and common-launch assertions; prompt-family routing and byte-preserving constant-extraction coverage. |
| Modify `test\spec-stage.test.ts`, `test\plan-stage.test.ts` | Preserve low-level age behavior while the new guided caller refuses an aged run. |
| Modify `README.md`, `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md` | Operator guide, consistent command lists, and deliberate clarification of read-only inspection versus writer migration and safe continuation. No stage-order, deferred-stage, or schema changes. |

Reuse without changing their contracts: `src\profile.ts` (`loadVerifiedProfile`,
`resolveStageModel`, `requireFrozenBinding`, `validateModelName`);
`src\approval-stage.ts` (`buildBinding`, `approveRun`); `src\approval.ts`;
`src\governed-config.ts`; `src\select.ts`; `src\paths.ts`; and the existing
spec, plan, implementation, and verification stage implementations. Their callers
include CLI, stage modules, and corresponding tests as established by the
import/call searches; no subclass or alternate runtime implementation was found.

[Verified] `src\implementation-stage.ts` imports the existing handoff
formatter; `src\verification-stage.ts` imports its parser. `src\code-review-stage.ts`
and `src\delivery-stage.ts` import `src\code-review.ts`; their matching tests,
`test\cli.test.ts`, and `test\handoff.test.ts`/`test\code-review.test.ts` consume
these public contracts. Keep existing exports/signatures unchanged while
adding the two new parsers. The new parser's profile import is type-only;
panel selection reuses `codeReviewPanel` from `src\select.ts`.

`package.json`, `tsconfig.json`, SQL migrations, frozen profile/schema shape,
policy values, agent definitions, rendered provider prompt bytes, and the external signer
are unchanged. Prompt source changes only to share its existing role prefixes.
The canonical driver remains test infrastructure and retains
its existing invocation contracts; do not copy its auto-signing into production.

## Tasks

### Task 1: Strict arguments and one canonical local target

**Depends on:** None.

**Files:** Create `src\cli-args.ts`, `src\repo-root.ts`, and
`test\cli-operator.test.ts`; modify `src\cli.ts` and `src\store.ts`.
Validate existing `test\cli.test.ts`.

**Steps:**

- **Step 1:** Add subprocess tests for all help forms, unknown commands/options, repeated and valueless options, assigned booleans, positional junk, unsafe numeric IDs, mutually exclusive fields, and invalid intake identities. Assert exit codes and byte/file inventories before and after; do not open a writable Store just to assert that it is absent. Verify with `node --test test\cli-operator.test.ts test\cli.test.ts`. Expected: new cases initially expose current permissive parsing; legacy output assertions remain the baseline.
- **Step 2:** Replace `parse`/`optional`/`required` routing with one fixed option definition and pre-state validation. Extract and validate global options before selecting the command; `argv[0]` is not necessarily the command when `--repo` precedes it. Recognize both global-option positions and reject duplicates across them, including on help paths. Extract slug/feature/change-kind receiving checks from `insertRun` into `validateRunIdentity`, retaining its original checks in the insert path through that helper. Reuse `validateModelName`. Complete every syntactic check before lock, migration, profile freeze, file writes, or dispatch. Verify with the same command. Expected: valid legacy calls still work; malformed input creates nothing.
- **Step 3:** Resolve `--repo` and implicit cwd to the canonical non-bare worktree root; pass that root to locks, Store, profile and config readers, every stage, approval, and proposal destination. Test root/child paths, `--repo` from elsewhere, junction aliases, spaces, missing paths, non-Git/bare targets, and original-cwd transport files. Verify with the same command plus `npm run typecheck`. Expected: exactly the intended target is used, no nested store appears, and no native Claude wrapper is introduced.

**Task completion evidence:** Real process output and filesystem assertions
prove help/usage paths are side-effect-free and valid commands use one target.
Maintain per-task execution state in the approved task database, not checkboxes
or a new task document.

### Task 2: Genuinely read-only state and writer observation

**Depends on:** Task 1.

**Files:** Modify `src\store.ts`, `src\migrate.ts`, `src\lock.ts`,
`test\store.test.ts`, `test\migrate.test.ts`, `test\lock.test.ts`;
extend `test\cli-operator.test.ts`.

**Steps:**

- **Step 1:** Add `openStore(root, { readOnly: true })` using `DatabaseSync`'s `readOnly` option. This branch does not call `applyMigrations`, create directories, change journal mode, or acquire the repository lock. Derive the supported `user_version` from `listMigrations` at the module-relative migrations location, not a hardcoded six. Refuse lower versions with explicit `migrate --repo` instructions, and higher versions with a matching-checkout instruction rather than suggesting a downgrade. Close handles on constructor failure. Verify with `node --test test\store.test.ts test\migrate.test.ts`. Expected: absent state remains absent, exact-current empty state is readable, wrong versions remain untouched, and actual write attempts on the read-only connection fail.
- **Step 2:** Add `readSnapshot(fn)` using a short deferred `BEGIN`/`COMMIT`, rolling back on error. It must not use writer `transaction`'s `BEGIN IMMEDIATE`; do not accept an async callback or hold the snapshot across a probe, filesystem/Git work, consent, or stage execution. Read-only connections use a 1000 ms SQLite busy timeout without the writer's three-attempt retry. Tests allow a 5-second process bound and require a named `state_unavailable` reason for contention. Verify with `node --test test\store.test.ts test\migrate.test.ts test\cli-operator.test.ts`. Expected: multiple queries see one committed database snapshot and writers are not blocked by a long-lived inspection transaction.
- **Step 3:** Add `inspectLock(root)` returning absent, live PID, dead PID, or unreadable observation plus available timestamp; never unlink or take over. Reuse the current `EPERM` liveness rule. A disappearing file is an absent observation, not an error that triggers cleanup. Test live/dead/unreadable/racing cases, including unchanged lock bytes. Verify with `node --test test\lock.test.ts test\cli-operator.test.ts`. Expected: inspection does not infer an active run from a PID or interfere with ownership.
- **Step 4:** Exercise an actual reader subprocess while a separate writer process holds the repository lock and has uncommitted SQLite changes. Add a separate killed-writer case in a disposable target: force rollback-journal page spill, synchronize on the open transaction, terminate that specific child, and establish that a hot journal exists before attempting read-only inspection. Require bounded `state_unavailable` with the originating SQLite reason and explicit writer-side recovery instruction; if the runtime reads it without writes, record that measured result and unchanged bytes rather than forcing an assumed failure. In the fixture only, explicitly invoke `migrate` to exercise stale-lock handling and journal recovery, then require the pre-transaction committed rows and an unchanged run/stage chain. Verify with `node --test test\cli-operator.test.ts test\store.test.ts`. Expected: no uncommitted rows, empty success fallback, inspection-side recovery, or workflow replay. Ordinary writable Store transactions and migrations retain their previous behavior.

**Task completion evidence:** Connection-level write refusal, snapshot
consistency, live-process contention, killed-writer behavior with explicit
SQLite recovery, and unchanged inspection state/lock inventories.

### Task 3: No-spend readiness with current and frozen facts separated

**Depends on:** Tasks 1 and 2.

**Files:** Create `src\readiness.ts`; modify `src\cli.ts`, `src\harness.ts`;
extend `test\cli-operator.test.ts`, `test\harness.test.ts`. Reuse profile, policy, selection,
config, approval-key, and executor definitions without changing them.

**Steps:**

- **Step 1:** Extract the current HEAD, dirty-tree filtering, and `loadGovernedConfigAtCommit` checks into `checkIntakeRepository`. Both doctor and `new-run` call it; preserve new-run's existing governance-prefix exclusion and refusal semantics. Do not require a key merely to create a run. Verify with `node --test test\cli.test.ts test\cli-operator.test.ts test\governed-config.test.ts`. Expected: no divergence between diagnostic intake checks and actual new-run checks.
- **Step 2:** Implement doctor's independent checks: running Node meets `package.json`'s major-version minimum; Git resolves and HEAD exists; current intake cleanliness/config status; governance ignore-rule readiness; and, for `--slug`, readable design at the existing feature design path and its presence in HEAD. Without a slug, label feature readiness `not_checked`. Missing design/config/key setup gets a named repair, never scaffolding, key generation, or a run row. Verify with `node --test test\cli-operator.test.ts`. Expected: each performed check states its evidence and the missing setup, with no repository changes.
- **Step 3:** Inspect current `buildPolicy`, `AGENTS`, document/code reviewer staffing through `staffingShortfall`/`codeReviewStaffingShortfall`, required executor capabilities, and `loadPublicKey`. Extend `probeExecutor` with optional timeout options and a typed captured stdout/stderr result; its existing one-argument dispatch caller ignores that result and preserves its behavior. Doctor calls this same function with the fixed current `CLAUDE_CODE` and a 5000 ms timeout, not a new spawn site or model invocation. Assert doctor and dispatch use the same executable, probe argv, and `shell: false`; retain missing-executable/nonzero-exit diagnostics and add bounded timeout/captured-output cases. Return availability evidence while leaving account authentication, entitlement, and quota unverified. Verify with `node --test test\cli-operator.test.ts test\profile.test.ts test\executor.test.ts test\harness.test.ts`. Expected: readiness data names each observed failure and distinguishes not-ready-to-approve from account readiness.

**Task completion evidence:** Readiness reports only checks actually performed;
all fixtures run locally without provider requests or GitHub prerequisites.
This task completes repository/feature checks and their returned data only;
test those data without asserting doctor stdout, stderr, or JSON. Task 4 owns
all doctor presentation/output assertions and common output serialization;
Task 5 owns `doctor --run` wiring, so this
task does not depend on a boundary classifier that has not been built.

### Task 4: Run inventory, honest costs, and one output contract

**Depends on:** Tasks 1, 2, and 3.

**Files:** Create `src\operator-state.ts`, `src\operator-output.ts`,
`test\operator-state.test.ts`; modify `src\cli.ts`;
extend `test\cli-operator.test.ts`, `test\store.test.ts`.

**Steps:**

- **Step 1:** Implement the bounded run-list query and one run-scoped database snapshot using `readSnapshot`. Collect runs/stages/agent rows/approval/audit/findings/reports/decisions/proposals and their existing source links without a Cartesian cost join. Query only the selected run; constrain findings through their stage and reviewer attribution through the recorded agent row. Verify with `node --test test\operator-state.test.ts test\cli-operator.test.ts`. Expected: newest-first limits and `hasMore` are deterministic; unknown run, missing store, and empty store are distinct.
- **Step 2:** Derive cost and activity fields exactly as the snapshot contract specifies. Build two distinct runs through the real schema, use `parseEnvelope` on the recorded harness envelope for expected costs/tokens, and separately exercise schema-permitted nulls, zero cost, failed audit attempts, multiple reports per finding, and review remediation agent rows. Compute the expected subtotal from the selected input rows, not a copied literal. Assert the source-grounded timing behavior through Store calls: insertion/status changes leave `started_at` null; `completeStage` writes `ended_at`. Bind snapshot assertions to those rows and labelled stage-create audit timestamps. Verify with `node --test test\operator-state.test.ts test\store.test.ts test\dispatch.test.ts`. Expected: other-run costs and finding fan-out cannot affect the subtotal; zero and unreported remain distinct; row-only/audit-only dispatch windows do not fabricate activity or completeness.
- **Step 3:** Implement text and per-command JSON serialization, including Task 3's doctor data and the complete error/exit mapping above. Assert every doctor's `PASS`/`FAIL`/`NOT CHECKED` distinction here, not in Task 3. Serialize one result at the CLI boundary; helpers return data and never print JSON independently. Default output includes complete structured summaries/paths, not raw evidence, signatures, environment contents, or keys. Include large schema-valid finding/report collections and compare all returned IDs/counts to the selected rows; no array may silently truncate. Verify with `node --test test\cli-operator.test.ts test\operator-state.test.ts`. Expected: every documented new-command outcome parses as one JSON object, stderr remains separate, and redirected text is understandable without terminal control sequences.
- **Step 4:** Populate the profile, approval, evidence, finding, and terminal-proposal sections from their original records. A missing evidence file remains visible as a limitation instead of failing the entire database inspection or becoming an invented path. Keep proposal export eligibility independent of run execution; use existing name derivation/exclusive-create rules and leave the final collision check to export. Verify with `node --test test\operator-state.test.ts test\cli-operator.test.ts test\cli.test.ts`. Expected: terminal runs remain inspectable and explicit export retains its audit/refusal semantics without reopening execution.

**Task completion evidence:** Multi-run/query-derived totals, complete JSON
outcome coverage, and a terminal proposal inspection/export subprocess case.
Task 5 completes the shared eligibility portion of these snapshots; do not
introduce a second temporary next-stage classifier in this task.

### Task 5: One conservative boundary interpreter and bound handoff reader

**Depends on:** Tasks 2, 3, and 4.

**Files:** Modify `src\operator-state.ts`, `src\handoff.ts`,
`src\code-review.ts`, `src\code-review-stage.ts`, `src\delivery-stage.ts`,
`src\readiness.ts`, `src\cli.ts`;
extend `test\operator-state.test.ts`, `test\cli-operator.test.ts`,
`test\handoff.test.ts`, `test\code-review.test.ts`,
`test\spec-stage.test.ts`, `test\plan-stage.test.ts`.

**Steps:**

- **Step 1:** Extract the identical current verification-record shape checks used by code review and delivery into `parseVerificationHandoff(unknown, runId, stageId)` in `src\handoff.ts`. Extract delivery's passed-code-review record checks into `parsePassedCodeReviewRecord(unknown, runId, stageId, profile)` in `src\code-review.ts`; retain its policy/panel/round/remediation/final-commit invariants. Both return typed current-format data or a named reason. Keep path I/O, caller-specific error context, audit binding, and mutation ordering in the callers. Verify with `node --test test\handoff.test.ts test\code-review.test.ts test\code-review-stage.test.ts test\delivery-stage.test.ts`. Expected: current accepted/rejected record shapes and every existing gate result remain unchanged; this is shared parsing, not new policy or a `canRunStage` framework.
- **Step 2:** Implement a fixed prefix interpreter over ordered stage rows. Require consecutive ordinals beginning at zero, exact predecessor IDs in the same run, the architecture's stage names/order, and passed/gate-pass/nonempty-output evidence for every completed prefix stage. Only prefix lengths 0, 2, 3, 5, 6, 7, and 8 admit a new workflow action; length 9 is terminal only with the delivery/run outcome consistent. Reject a partial document group, unknown/manual chain, duplicate or skipped stage, failed/pending/in-progress residue, missing gate event, and contradictory approval/output bindings before any core call. Verify with `node --test test\operator-state.test.ts test\cli-operator.test.ts`. Expected: the boundary table below is exhaustive; no generic last-row heuristic exists.
- **Step 3:** Load/hash-verify the frozen profile, inspect each required existing output and gate audit event, and apply the handoff comparisons below. Reuse `buildBinding` at the approval boundary, `parseImplementationGate`, the extracted record parsers, and `parseCodeReviewGatePass`. For filesystem observations use the non-mutating Git commands specified below, not execution helpers whose `git status` can refresh the index. Do not run review/reconciliation gates again or require downstream documents to parse under a stronger schema than the core's hash-bound consumption. For ready paid groups, check their frozen model/capability, named author/output requirements, and reviewer staffing; do not call an executor probe from status. Verify with `node --test test\operator-state.test.ts test\handoff.test.ts test\code-review.test.ts test\approval-stage.test.ts`. Expected: missing/tampered handoffs and moved/dirty worktrees are unavailable actions with specific reasons, not paid discoveries.
- **Step 4:** Separate the short committed database snapshot from file/Git observations. Recheck the exact boundary fingerprint defined below after evidence reads; if it changed, return an observation-changed limitation and no eligible continuation, not a mix presented as stable. While a repository writer is observed, return committed state and candidate phase but no claim that this run is active or executable concurrently. On execution, the same interpreter is re-evaluated under the owned writer lock; ignore only that invocation's own lock observation. Verify with `node --test test\operator-state.test.ts test\cli-operator.test.ts`. Expected: status remains useful during work and cannot authorize a stale snapshot.
- **Step 5:** Compute `deadline = created_at + frozen runDurationLimitSeconds`, refusing new guided work when the current age exceeds that frozen limit, before consent/dispatch and before each subsequent group. Use the core's strict greater-than boundary, not a guessed deadline watcher. Name this as the guided-entry precondition and state in the refusal that low-level spec/plan retain their own narrower checks; do not present those commands as a route to successful aged delivery. Add direct spec/plan regressions that an otherwise valid aged run has no new age-only refusal, alongside guided refusal cases. An accepted approval's elapsed expiry remains informational; current policy/signer checks apply at the existing approval gate only. Bind completed presentation to the recorded delivery row/result and final review handoff; if files are now missing or inconsistent, show persisted completion with its limitation, do not assert a verified present-day handoff or re-enter delivery. Verify with `node --test test\operator-state.test.ts test\cli-operator.test.ts test\spec-stage.test.ts test\plan-stage.test.ts test\delivery-stage.test.ts`. Expected: truthful terminal status and early aged-run refusal without changing persisted state or low-level stage policy.
- **Step 6:** Wire `doctor --run` through this reader and Task 3's readiness results. Show verified frozen models/configuration, signer binding, deadline, and boundary refusals separately from current setup. If the profile is missing, unreadable, malformed, or hash-invalid, preserve readable database/current-check data, set unavailable frozen fields to null, report the original profile reason under a failed profile check, and return `not_ready`/`evidence_invalid`/exit 1. Dependent frozen checks are `not_checked`, never current-config substitutes. Never rebuild the profile, impose new-intake cleanliness on a continuing run, or execute a retained arbitrary probe. Current policy change affects approval readiness as the existing gate specifies; accepted approvals are not revoked by elapsed expiry. Verify with `node --test test\cli-operator.test.ts test\profile.test.ts test\approval-stage.test.ts`. Expected: both current and frozen readiness are visible, including an explicit not-checked limitation if the frozen executor differs from the fixed native executor doctor probed.

**Task completion evidence:** Every allowed boundary and its rejection variants
is covered, including no pending approval row, both partial document groups,
all missing gate-event windows, and a completed run whose retained worktree
was moved. The same function supplies status action eligibility and guided
execution's candidate selection; the core still rechecks and decides gates.

### Boundary and evidence table for Task 5

The boundary fingerprint is the SHA-256 of UTF-8 `JSON.stringify` of a tuple:
the selected run tuple, its ordered stage tuples, and its ordered audit tuples.
Use explicit arrays, these field orders, and unchanged nulls:

- Run: `id`, `project`, `feature_id`, `slug`, `change_kind`, `status`, `profile_ref`, `created_at`, `updated_at`.
- Stages, ordered by `ordinal`, then `id`: `id`, `run_id`, `kind`, `ordinal`, `input_stage_id`, `output_ref`, `status`, `gate_result`, `started_at`, `ended_at`.
- Audit, filtered by `run_id` and ordered by `id`: `id`, `run_id`, `stage_id`, `actor`, `actor_type`, `action`, `summary`, `hash`, `prev_hash`, `created_at`.

Compute the same tuples in a second short snapshot. An absent run changes the
fingerprint. Do not include wall-clock observations, repository-wide audit
events from other runs, or lock metadata. The fingerprint detects recorded
boundary changes, not filesystem immutability or audit-chain validity;
evidence/binding checks and the explicit `verify-audit` action remain separate.

The table is a call-eligibility contract, not a promise that executing a valid
next stage will pass. A genuine new stage finding/verification/delivery block
must still be recorded by its existing core gate.

| Durable prefix | Eligible action and required retained evidence |
| --- | --- |
| No stages | `runSpecStage`. Verified profile; readable design; frozen spec/spec-review models, capability bindings, author, output kinds, and available reviewer staffing. Do not infer interruption from a shared feature spec/plan filename alone; a newly created explicit run can replace earlier generated documents through the existing core path. |
| `spec`, `spec_review` passed | Pause; no plan call. Both output refs identify the reviewed specification. Require the stage-create events and `spec.gate.pass` hash/risk; call non-mutating `buildBinding` with a prospective valid expiry to obtain scope/risk/hash evidence and policy readiness. Its refusal remains visible. Missing key is not proof of approval; show the external setup action separately. |
| Passed `awaiting_approval` | `runPlanStage`. Approval row plus `approval.stage.create`/`approval.granted`, matching feature/profile/starting-commit/scope and spec hash; reviewed spec matches `spec.gate.pass`. No pre-existing plan stage for this run. Do not use `buildBinding` after grant, because it deliberately refuses an existing approval stage. |
| Passed `plan`, `plan_review` | `runImplementationStage`. `plan.gate.pass` contains `planHash` and `planFor`; normalized disk plan matches the former, and disk spec matches both the latter and approval's `spec_hash`. No worktree or run-branch residue to reuse. |
| Passed `implementation` | `runVerificationStage`. Matching implementation worktree output; `implementation.gate.pass` parses as `base=<commit>; head=<commit>`. Existing worktree head/cleanliness matches that head; preserve patch base. |
| Passed `verification` | `runCodeReviewStage`. Passed verification record identifies this run/stage/worktree/base/initial commit; `verification.gate.pass` exists for the stage. Its base/commit agree with the implementation handoff. Approved plan/spec bindings remain intact; worktree is at the initial verified commit and clean. Frozen code-review panel, severity vocabulary, implementer, and models remain staffable. |
| Passed `code_review` | `runDeliveryStage`. Shared record parser establishes the full passed review record; its initial commit/base/worktree match verification, each remediation has passed verification, and its final panel has no unreviewed patch. `parseCodeReviewGatePass` matches final round, frozen max rounds, final commit, final finding count, and blocking severity. Worktree head is the final reviewed commit, not necessarily the initial verification commit. |
| Passed `delivery_check`, completed run | Report only. Delivery result identifies the producing run/stage, patch range, declared/delivered/missing sets and outcome; compare with `delivery.gate.pass` and the final reviewed commit. No new dispatch or automatic publication. |
| Blocked run, partial prefix, unknown chain, contradictory evidence | Inspection and independently eligible export only. Preserve rows, raw evidence, branches, worktree, and the originating recorded reason. No resets or synthesized stage completions. |

Stage-create actions are `spec.stage.create`, `spec_review.stage.create`,
`approval.stage.create`, `plan.stage.create`, `plan_review.stage.create`,
`implementation.stage.create`, `verification.stage.create`, and
`code_review.stage.create`. Delivery is bound by its atomic terminal gate
event, not an invented `delivery.stage.create`. Ordinary `stage.add` and
`stage.complete` audit events do not substitute for these gate handoffs.
No gate hash is inferred from the command name or from a report's prose.

The existing verification gate summary records the commit/worktree/count as
text, not a canonical JSON object. Require its actual event and compare
structured handoff identities; do not claim it provides a nonexistent result
hash. Code-review pass summaries have the explicit canonical parser above.

Historical commit handoffs are compared to each other, not each to the
current HEAD: remediation legitimately moves beyond the initial verification
commit. Inspect current HEAD only against the latest applicable boundary:
implementation head before verification, initial verified head before code
review, final reviewed head before delivery, and recorded delivered head for
present-day completion observations. Add a regression where the initial and
final commits differ; the valid remedied chain must remain eligible.

Use direct `git --no-optional-locks` inspection commands with the evidence
worktree as cwd. Before verification, match `checkCommitState`'s
`rev-parse HEAD` and `status --porcelain`; before code review, match
`checkWorktreeClean`'s `status --porcelain -z --untracked-files=all --ignored=matching`.
Before delivery, preserve its narrower tracked-state `diff --quiet HEAD`
rule rather than newly refusing untracked/ignored files. Keep these read-only
observations in `operator-state`, shared by its status/doctor/run consumers;
the existing execution helpers remain unchanged. Assert Git index bytes and
mtime are unchanged on inspection. This small read-only command path is
intentional because the existing helpers have no non-mutating inspection
option; do not widen their execution APIs just to serve the display.

### Task 6: Consent-bounded guided execution and observable progress

**Depends on:** Tasks 1, 2, 4, and 5.

**Files:** Create `src\run-command.ts`, `test\run-command.test.ts`,
`test\fixtures\harness\emit-cli-run.mjs`;
modify `src\cli.ts`, `src\operator-output.ts`;
modify `src\prompts.ts`; extend `test\cli-operator.test.ts`,
`test\prompts.test.ts`.

**Steps:**

- **Fixture setup before the first real-stage test:** Extract the existing role prefixes in `src\prompts.ts` into exported constants that each relevant builder consumes without changing its returned bytes. Create the test-only router over the existing spec, plan, implementation, and code-review emitters using those same constants, including code-review remediation. Match the leading role prefix rather than searching embedded input documents for a marker; reject zero or ambiguous matches with the complete searched marker names/values and match count, not raw prompt content. Forward exact prompt bytes through direct Node subprocesses. Compare representative rendered prompts before/after extraction byte-for-byte in an isolated copy, and test routing for every builder family plus unrelated input text/wrapping changes. Freeze that schema-valid executor before the first dispatch following the existing `test\cli.test.ts` fixture pattern; never change the profile after execution begins. Verify fixture responses through the receiving core schemas in `node --test test\run-command.test.ts test\prompts.test.ts`. No production injection option or second provider is introduced.
- **Step 1:** Read the selected run without a writer lock and compute the shared boundary. A valid approval pause or completed run needs no execution consent and buys no work. Other ineligible states return their specific refusal. For an eligible executable range, show canonical target/run, frozen models, remaining groups, verification commands, document-review panel/round ceilings, and code-review panel/round/remediation ceiling. State explicitly that consent covers every listed group, not only the next group, with no intermediate voluntary stop control or hard monetary cap. Derive the dispatch ceilings from frozen policy rather than promising an invoice: a document group has author plus self-critique plus its rounds of panel and reconciler; code review has panel size times maximum rounds plus at most one implementer between panels. Verify with `node --test test\run-command.test.ts test\cli-operator.test.ts`. Expected: preview reflects the selected run and does not dispatch, mutate, sign, or export.
- **Step 2:** Require `--yes` or an explicit affirmative TTY response after that preview, once per invocation. JSON mode or redirected stdin without `--yes` returns `consent_required` immediately; decline, EOF, or cancellation does not execute. Do not hold the writer lock or an SQLite transaction while prompting. Preview requires the exact-current schema. After consent acquire the existing repository lock and repeat the read-only schema/version check before opening the default writer; close that reader before proceeding. A mismatch refuses with `schema_unsupported` and the existing explicit repair, so execution consent never authorizes pending migrations. The writer's unchanged migration path has nothing to apply on this exact-current store. Re-read the run and refuse if its fingerprint/profile/eligible boundary changed since preview, requiring a fresh invocation rather than executing a different range. Verify with `node --test test\run-command.test.ts test\cli-operator.test.ts test\lock.test.ts test\migrate.test.ts`. Expected: no noninteractive hang, implicit migration, pre-consent stage/agent rows, or race-based expansion of consent.
- **Step 3:** Implement a fixed switch on the shared next group, directly calling `runSpecStage`, `runPlanStage`, `runImplementationStage`, `runVerificationStage`, `runCodeReviewStage`, or `runDeliveryStage` with the selected root and verified frozen executor. After each success re-read durable state and recompute eligibility; require forward movement to the expected boundary. Stop immediately on a returned refusal/block or thrown failure, preserving its originating reason. Never recursively spawn the CLI, hold a chain-wide SQLite transaction, invoke a passed group, or loop around an unsuccessful stage. Verify with `node --test test\run-command.test.ts test\cli-operator.test.ts`. Expected: only the architecture's existing groups run, and the next human/terminal/refusal boundary returns control.
- **Step 4:** Write group start/end and a 15-second elapsed-observation heartbeat to stderr while asynchronous stage calls yield to the event loop. Delivery is synchronous and uses `spawnSync`; it emits start/end observations only, with no heartbeat during that call. Other synchronous spans can also delay a timer, so 15 seconds is not a response-time guarantee. Label spec/spec-review and plan/plan-review as groups unless an actual stage-create audit event supports a narrower timestamp; no invented substage/agent starts. Verification and code-review verification already write command progress to stderr internally; preserve that behavior and do not invent a public stage callback. Clear heartbeat resources on every exit and release Store/lock in `finally`; do not promise JavaScript cleanup on hard process kill. Verify with `node --test test\run-command.test.ts test\cli-operator.test.ts`. Expected: a delayed local fixture produces progress without raw model content; final stdout remains one result.
- **Step 5:** Render the final durable snapshot, known cost coverage, recorded delivery or blocking evidence, and independent operator actions. A stage refusal may leave the run in progress; do not relabel it blocked unless the database says so, and do not pretend an unrecorded refusal can be reconstructed by a later status request. A newly invoked delivery call may re-enter an intact passed-code-review boundary after its existing transaction rolled back; it is not retried automatically. Verify with `node --test test\run-command.test.ts test\cli-operator.test.ts test\delivery-stage.test.ts`. Expected: exit 0/3/1 follows the defined outcomes, and stage/approval semantics remain owned by the core.

**Task completion evidence:** A no-spend actual-stage journey, repeat-invocation
dispatch accounting, refusal preservation, and progress/JSON separation.
SIGKILL recovery, a live budget cap, and exact active-agent telemetry are not
claimed by these checks.

### Task 7: External approval handoff without byte or authority changes

**Depends on:** Tasks 1, 4, and 5.

**Files:** Modify `src\cli.ts`, `src\operator-output.ts`;
extend `test\cli-operator.test.ts`. Validate
`test\approval-stage.test.ts`, `test\approval.test.ts`,
`test\sign-approval.test.ts`, and `test\cli.test.ts`.
Do not modify `scripts\sign-approval.mjs`.

**Steps:**

- **Step 1:** Add `--out` as an exclusive-create binary/UTF-8 write of `approvalPayload(buildBinding(...).binding)`. Preserve the no-option raw stdout path byte-for-byte and the existing expiry policy. Diagnose missing parent, unreadable destination, and existing path without overwrite. Verify with `node --test test\cli-operator.test.ts test\cli.test.ts test\approval-stage.test.ts`. Expected: stdout payload and file bytes are identical to the core payload, not JSON or a terminal-formatted copy.
- **Step 2:** Add mutually exclusive `--signature-file` transport, read before any approval mutation, with explicit UTF-8/BOM/outer-whitespace handling. Reject an empty/unreadable file as usage, but let `approveRun` retain semantic signature/expiry/policy refusals and their audit behavior. Verify with `node --test test\cli-operator.test.ts test\approval.test.ts test\approval-stage.test.ts test\sign-approval.test.ts`. Expected: expired, invalid, changed-scope/hash/key, and duplicate approvals do not pass; already granted approval is not overwritten.
- **Step 3:** At the approval pause render reviewed spec path, derived scope/risk and hash bindings, signer-readiness limitation, an explicit expiry supplied identically to request/approve, and commands for the separate signer and approval submission. Never execute the signer, prompt for a key, or include a private-key filename literal under `src`; `test\sign-approval.test.ts` enforces that boundary. Explain that after approval the operator invokes `run --run` again and gives new execution consent. Verify with `node --test test\cli-operator.test.ts test\sign-approval.test.ts`. Expected: a pause returns control with no retained writer lock or implicit authorization.
- **Step 4:** In disposable fixtures only, use the existing signer to sign the exported bytes and feed the signature file to the actual CLI. Exercise a Windows PowerShell transport as well as raw Node subprocess input; preserve the signer's established BOM/CRLF handling rather than normalizing fixtures before the signer receives them. Verify with `node --test test\cli-operator.test.ts test\sign-approval.test.ts test\cli.test.ts`. Expected: supported transports verify the same canonical payload, and the original driver's raw-stdout workflow remains valid.

**Task completion evidence:** Byte equality, external signer round-trip in a
throwaway key directory, core refusal/audit assertions, and lock release at the
human pause. This test setup is not permission to sign a real operator run.

### Task 8: Prove the real local journey and refusal boundaries without spend

**Depends on:** Tasks 1-7.

**Files:** Extend `test\fixtures\harness\emit-cli-run.mjs`;
extend `test\run-command.test.ts`, `test\cli-operator.test.ts`,
`test\operator-state.test.ts`. Reuse the existing spec, plan, implementation,
and code-review emitter fixtures and committed recorded responses.

**Steps:**

- **Step 1:** Extend Task 6's router tests to cover the entire CLI journey and the existing emitters' refusal/remediation modes; preserve exact stdin and fail on unmatched prompts. Use the same frozen schema-valid executor for both guided invocations, with no profile-hash rewrite after the first dispatch. Verify with `node --test test\run-command.test.ts test\cli-operator.test.ts`. Expected: actual `dispatchOnce` and stage validators consume every fixture, and the profile remains unchanged across approval.
- **Step 2:** Exercise creation, the pre-approval `run --yes`, external approval, and the post-approval `run --yes` through real CLI processes in a disposable Git target. Derive expected stage sequence from the architecture and artifact obligations from the emitted spec validated by the real schema. Assert that declared artifacts equal delivered changed paths, final output names the actual Git branch/head/worktree, and a repeat completed invocation creates no new rows or files. Verify with `node --test test\run-command.test.ts test\cli-operator.test.ts`. Expected: the complete local scenario works rather than only a stubbed dispatcher.
- **Step 3:** Exercise a blocking review, a non-final review followed by remediation and verification, final below-threshold findings, and a normal stage failure. Use the existing code-review emitter's modes plus the recorded `test\fixtures\recorded\code-review-web-calculator-powershell-remediation-chain.json` for presentation/telemetry expectations. Do not reopen its machine-local provenance paths; fixture paths are historical strings. Verify with `node --test test\run-command.test.ts test\operator-state.test.ts test\code-review-stage.test.ts test\delivery-stage.test.ts`. Expected: bounded review dispatch counts, immutable reviewer attribution, correct final commit selection, known-cost coverage, and no claimed correctness/publication beyond evidence.
- **Step 4:** Cover each prefix and interruption variant from Task 5, rejected consent, changed preview boundary, missing/tampered records, unsupported schema, aged run, changed policy before approval, expired submitted signature, and granted-but-old expiry. Include a failed delivery finalization whose existing transaction leaves an intact boundary: the same invocation stops, a separately consented later invocation may succeed. Verify with `node --test test\run-command.test.ts test\operator-state.test.ts test\cli-operator.test.ts test\delivery-stage.test.ts test\approval-stage.test.ts`. Expected: no blind replay, repair, or spend from an ineligible state; exact core failure reasons survive.
- **Step 5:** Exercise the local paths with GitHub credentials unset and an instrumented `gh` sentinel that fails if invoked; retain normal local Git/Node and the fixture provider. Inspect spawned executable arguments to exclude GitHub fetch/publication calls while preserving the existing harness/verification network limitations. Verify with `node --test test\cli-operator.test.ts test\run-command.test.ts`. Expected: help/doctor/inspection/execution/approval have no GitHub dependency; this does not claim verification commands or the real model provider are network-sandboxed.
- **Step 6:** In an isolated copy of the changed source/tests, independently bypass the strict parser, replace read-only opening with the writer path, remove prefix/approval/age checks, make the loop retry a failed group, redirect progress to stdout, and replace run-scoped cost aggregation with an unscoped or report-fanned query. Run the corresponding targeted command from the earlier steps after each single mutation and require the named assertion to fail; restore the exact copied bytes before the next case. Expected: every new protective rule has demonstrated failure sensitivity without mutating this working tree or retained operator state.

**Task completion evidence:** One actual-stage CLI journey, the complete
negative matrix, recorded-response presentation evidence, and named isolated
break-test failures with restoration hashes. No paid invocation is necessary.

### Task 9: Document and demonstrate the bounded local workflow

**Depends on:** Tasks 1-8.

**Files:** Modify `README.md`, `CLAUDE.md`, `AGENTS.md`,
`ARCHITECTURE.md`; extend `test\cli-operator.test.ts` for the documented
invocation. Update this plan's status only after authorized implementation.

**Steps:**

- **Step 1:** Add a README operator guide using PowerShell variables for absolute checkout CLI/signer paths and `& node $BwCli ... --repo $Target`. Document Node >=24, checkout dependencies, design/config/public-key prerequisites, explicit new-run identity/model fields, doctor, runs/status, both guided invocations, external approval file workflow, and final evidence navigation. Examples must distinguish `--yes` spend consent from signature authority, quote paths with spaces, and avoid npm-link/distribution claims. `README.md` is current tier: derive example paths from operator variables and real checkout assets; do not introduce nonexistent root-anchored repository paths in inline code. Verify with `node --test test\cli-operator.test.ts` and the same documented help/doctor/runs invocations against the test-created separate target. Expected: no operation accidentally targets the BuildWorks checkout, and module-relative SQL/assets resolve correctly.
- **Step 2:** Update the command guidance in both `CLAUDE.md` and `AGENTS.md` consistently. Deliberately clarify `ARCHITECTURE.md` sections 15 and 19: writer startup applies migrations; inspection opens existing state read-only; guided continuation requires an exact-current schema and intact durable boundaries, not arbitrary resume. Record the early frozen-age refusal without changing downstream approval-expiry policy, stage order, or any deferred behavior. Preserve named headings and fence shapes consumed by `derive()`, particularly section 5's sequence/deferred tokens and section 15's schema/storage fences. A missing/reshaped parse boundary can produce checker exit 2, not a document-defect exit 1; resolve the structural mismatch rather than weakening the getter. Verify with `npm run check:docs`. Expected: architecture remains the authority and the documentation pins/allowlists need no changes.
- **Step 3:** Document exit 3 for approval, stdout/stderr JSON separation and all outcome/field contracts, read-only/schema/contention behavior, evidence and known-cost limits, terminal proposal export, and the absence of GitHub or general recovery. Show actual frozen verification commands so completion is not advertised as stronger than those commands and the review gate. Verify with `npm run check:docs` and `npm run typecheck`. Expected: operator guidance matches the implemented surface; historical unrelated warnings are not edited away.

**Task completion evidence:** The documented Windows checkout invocation works
from a separate path containing spaces, and the complete local journey's
recorded/schema-bound evidence is linked from the implementation task record.
No paid run, source packaging, GitHub access, commit, or cleanup of retained
operator targets is part of this task.

## Acceptance-criterion coverage

| Criterion | Tasks and observable proof |
| --- | --- |
| CLI-AC-01 | Task 1: help/invalid-input exit and no state/lock/dispatch creation. |
| CLI-AC-02 | Tasks 1 and 9: canonical root, child/junction/space paths, wrong-target refusal, local-only meaning. |
| CLI-AC-03 | Task 3: independent free checks, evidence/repairs, key and account limits, no GitHub prerequisites. |
| CLI-AC-04 | Tasks 2 and 4: missing store, empty current store, and missing run are distinct and non-mutating. |
| CLI-AC-05 | Tasks 2, 4, and 5: committed snapshot under a live writer, unchanged lock, intermediate evidence not executable. |
| CLI-AC-06 | Tasks 5-7: spec-review boundary derives a pause without a pending approval row. |
| CLI-AC-07 | Tasks 5, 6, and 8: existing next group only, durable re-read, no redispatch. |
| CLI-AC-08 | Tasks 5, 6, and 8: terminal/partial/manual/inconsistent chains refuse without repair; inspection/export remains separate. |
| CLI-AC-09 | Task 6: no redirected prompt or spend without consent; consent cannot sign/export/publish. |
| CLI-AC-10 | Tasks 7 and 9: canonical byte equality and external signature-file verification on Windows. |
| CLI-AC-11 | Tasks 4 and 8: selected-run totals, nullable telemetry, failed attempts, report fan-out, and remediation attribution. |
| CLI-AC-12 | Tasks 4 and 6: labelled audit/observation timing, heartbeat, no fabricated active agent/live cost. |
| CLI-AC-13 | Tasks 5, 6, and 8: bound final commit/worktree/report summary, attributable findings and verification limits. |
| CLI-AC-14 | Tasks 1, 4, 6, and 8: one JSON object for each documented new-command outcome and distinct workflow/operator actions. |
| CLI-AC-15 | Tasks 1 and 9: absolute checkout invocation from a separate Windows target with spaces. |
| CLI-AC-16 | Tasks 3, 5-8: policy/expiry/hash/worktree guards, early frozen-age refusal, no post-grant expiry revocation. |
| CLI-AC-17 | Tasks 4 and 8: terminal proposal visibility plus explicit export, without reopening execution. |
| CLI-AC-18 | Tasks 3, 6, 8, and 9: no gh/GitHub prerequisite or remote publication operation on local paths. |

## Completion gate and rollback

Component success requires each new command, reader, transport, and boundary
refusal to satisfy its targeted assertions. End-to-end success requires a
real CLI journey over the existing stages in a disposable target: approval
pause, separate signature acceptance, continued execution, and delivery
summary. Regression safety requires the complete existing suite to retain its
contracts because the Store/probe changes reach beyond the enumerated CLI
iteration set. A fake dispatcher returning success is not that
end-to-end proof.

Use task-specific Node commands and the combined set below for fast iteration,
not final regression evidence. After that targeted loop, `npm test` is the
final regression pass, including audit, schema, governed-config, selection,
executor/harness, patch application, commit verification, delivery coverage,
and prompt suites that the shorter list does not enumerate:

```powershell
node --test test\cli-operator.test.ts test\operator-state.test.ts test\run-command.test.ts test\cli.test.ts test\store.test.ts test\migrate.test.ts test\lock.test.ts test\profile.test.ts test\approval.test.ts test\approval-stage.test.ts test\sign-approval.test.ts test\dispatch.test.ts test\handoff.test.ts test\code-review.test.ts test\spec-stage.test.ts test\plan-stage.test.ts test\implementation-stage.test.ts test\verification-stage.test.ts test\code-review-stage.test.ts test\delivery-stage.test.ts
npm test
npm run typecheck
npm run check:docs
```

Do not add a test runner or build/package tool. If a targeted failure reveals
wider coupling, investigate the cause before expanding validation; do not
silently expand product scope. All new guard break-tests and their exact
failures/restoration belong in the implementation task record.

No migration or historical evidence rewrite is required. Rollback removes
only the implemented CLI additions and restores the specifically changed
code; existing rows, profiles, approvals, evidence, branches, and worktrees
remain intact. Do not use whole-file restoration over other uncommitted work.
Explicit approval payload files and proposal exports are operator-owned files,
not disposable artifacts to erase automatically.

The `Reconciled` status records completed document review, not implementation
authorization. Execution state belongs in task database rows. After separately
authorized implementation meets this gate,
mark the plan `Implemented` and record evidence and remaining limitations in
the repository's established session-artifact location. A live paid run is a
separate operator decision, never an implied final step.

## Implementation note (2026-09-10)

The operator's explicit `implement-plan` request authorizes execution after
the planning-only baseline above. All nine tasks are complete in the working
tree: strict canonical CLI targeting, read-only readiness and run snapshots,
intact-boundary guided execution with explicit consent, external approval file
transports, the actual local fixture journey, and the Windows operator guide.
Existing stages retain their gates, frozen configuration and low-level output
contracts.

Three bounded implementation adjustments complete the stated behavior:
existing stage consumers resolve relative evidence against the selected
target; Git inspection disables diff auto-refresh as well as optional locks;
and shared declared-artifact extraction avoids imposing stronger downstream
specification validation. No schema, migration, stage, dependency, provider,
review policy, packaging or GitHub integration change enters this increment.
The scope exclusions and deferred intermediate stop control remain unchanged.

The full CLI gate passes 108 cases. The full repository suite passes 1071,
with zero failures and one reported Windows file-symlink skip; strict types,
documentation and whitespace gates pass. The separate high-effort
`2026-09-10-code-review.md` records 0 confirmed and 0 plausible findings,
complete review coverage, evidence limits and the implementation disposition.
`.claude\sessions\2026-09-10-cli-operator-implementation.txt` preserves exact
commands, guard failures/restoration, the no-spend journey and completion
evidence.

The implementation remains uncommitted on `code-review-stage`; prior input
changes remain intact. No paid provider acceptance run, real operator signing,
push, merge, or retained-target cleanup occurs. Only the twelve named parent
experiment files are removed after their evidence enters the repository
record. No production rollback is necessary.
