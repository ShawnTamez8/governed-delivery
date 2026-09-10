# CLI operator experience: gap and requirements analysis

**Status:** Reconciled; ready for bounded CLI implementation planning, not implementation authorization.
**Date:** 2026-09-09
**Baseline:** `a8a71d1`, branch `code-review-stage`; clean working tree at intake.
**Audience:** Operator and the engineer preparing the implementation plan.
**Hazards considered:** 1 and 2 (diagnosable failures and retained evidence);
4 and 5 (outside-derived acceptance evidence and actual delivery);
7 (no blind paid retry or ambiguous remote recreate); 8 and 9 (Windows launch and executable readiness);
10 and 12 (frozen versus current configuration); 11 (usable default setup);
13 and 16 (source authority and upstream decisions);
14 and 18 (honest reporting of review and verification guarantees).

## My understanding and business objective

Make the existing BuildWorks CLI straightforward to operate without remembering
the stage sequence, writing ad hoc SQLite queries, or depending on the scratch
driver. The operator should be able to determine readiness, start work, see what
is happening, perform the one human authorization, and locate the delivered
branch or the evidence explaining a block.

The primary actor is the local repository operator. A shell script is a
secondary consumer of the same CLI, not a new delivery surface. The existing
external signer remains operator-owned.

The eventual workflow also includes GitHub-authored requirements and human
work items flowing into and out of BuildWorks. The first CLI increment provides
the local operating surface for that direction without implementing a GitHub
integration or treating GitHub as a second execution-state authority.

This is analysis and proposed requirements, not a task-by-task implementation
plan. No application code, run database, retained target, policy, or key changes
are authorized here. No paid dispatch is needed to establish these gaps.

## Delivery horizons and source authority

| Horizon | Scope | Planning boundary |
|---|---|---|
| Local operator CLI | Help, local target selection, readiness, read-only visibility, safe existing-stage execution, external approval handoff, and delivery evidence. | This document's implementation-planning scope. No GitHub configuration, credentials, network access, publication mapping, or importer is required. |
| Explicit outbound GitHub publication | A reviewed run becomes a Feature with one Story per approved criterion; a stored blocking proposal can become a human-decision Spike. | The separate outbound proposal requires authorization, target/App/mapping/visibility decisions, and live discovery. Its smallest proposed proof is blocking-proposal-to-Spike publication. |
| GitHub intake and two-way flow | Selected remote requirements become identified local inputs; later human decisions can initiate new governed work. | A separate requirements and authority design must define intake objects, revision/provenance, target selection, and task semantics before planning. |

`docs\proposals\github-project-projection-and-upstream-spikes.md` specifies the
outbound horizon, not the full eventual intake workflow. Its Stories project
approved `AC-*` criteria, not executable agent tasks. Task decomposition remains
deferred by `ARCHITECTURE.md` section 5.

A PRD authored through GitHub as repository Markdown can already supply the
local design input when committed at the expected feature design path and
checked out locally. Importing an issue body or Project item is a different
capability. An externally authored specification is not automatically the
system's reviewed and approved specification.

The repository documents, database rows, and bound evidence remain
authoritative for execution. GitHub comments, edits, closures, and Project
statuses do not grant Ed25519 approval, change an approved spec, complete a
task/stage, or reopen a blocked run. The future intake invariant is an
explicitly accepted, identified local source snapshot; later remote edits do
not silently mutate active approved work. This is a future requirement, not
a claim that the current local design reader implements a remote snapshot.

References: `ARCHITECTURE.md` sections 5, 12, 14, and 15;
`src\spec-stage.ts:142-148,199-214`; and the outbound proposal's "Decision
sought", "Project status is one-way", and "Decisions required before planning".

## Current behavior and evidence

The full governed stage chain already exists. The latest recorded PowerShell
chain completed with live code-review remediation; the limitation is the
operator surface, not a missing delivery engine. That capture is evidence of
the existing chain, not of the commands proposed below.

| Area | Source-grounded current behavior | Operator consequence |
|---|---|---|
| Discovery and arguments | `src\cli.ts` has one usage string and a handwritten argument parser. Help is not a recognized command; unknown commands exit 2. Unrecognized options and bare arguments are not rejected globally, and repeated options overwrite earlier values. | There is no reliable command-specific guide, and some typos can be ignored instead of preventing work. |
| Target repository | `src\cli.ts` uses `process.cwd()` for the store, lock, profile, and stage roots. `src\paths.ts` builds state paths under that root. | Running from a different directory can address a different state location. The operator needs an explicit, consistently resolved target. |
| Installation | `package.json` is private and declares a `bw` bin pointing at TypeScript. There is no build script; `tsconfig.json` sets `noEmit`. The recorded workflow invokes the source file through an absolute path. | A bin declaration is not a complete installation experience. A linked checkout and a distributable npm package are different deliverables. |
| Setup | `new-run` checks Git HEAD, working-tree cleanliness, and committed verification configuration. Profile freezing checks reviewer staffing but permits a missing/unusable public key by freezing a null signer. The executable probe is at dispatch. | Readiness is fragmented across commands. Creating a run does not establish that the operator is ready to approve or that the model account can execute. |
| Orchestration | Individual cases directly call spec, plan, implementation, verification, code-review, and delivery functions. The scratch driver sequences separate CLI processes. | The operator supplies sequencing and manually carries the run ID. There is no normal product command to advance through existing gates. |
| State inspection | No run-list, status, costs, or evidence-navigation command exists. `run`, `stage`, `agent_run`, approval, findings, proposals, and audit rows already hold most of the necessary data. | Answering "where is it, why did it stop, what next?" requires database and filesystem knowledge. |
| Concurrent observation | Every recognized CLI command acquires the repository writer lock and opens the migration-running Store. The scratch driver's status queries instead use SQLite `readOnly: true`. | Adding status as another ordinary switch case would make it unavailable while work holds the lock and could initialize/migrate state on a supposedly read-only request. |
| Human approval | `approval-request` emits canonical payload bytes without a trailing newline; expiry is printed separately. The signer is a separate script, and `approve` verifies the result. The approval stage row is created only when approval succeeds. | "Awaiting operator approval" must be derived after a passed spec review, not found by searching for a pending `awaiting_approval` row. Transport and expiry handling remain manual. |
| Progress | The CLI generally prints an ID or result path on success. Harness output is buffered, and `dispatchOnce` records its row/event after the invocation returns. | A long period without output is not an accurate progress display. Stored dispatch counts do not identify the currently running agent or live accrued cost. |
| Delivery handoff | The implementation returns a retained worktree; review and delivery return structured evidence paths. Branch, final reviewed commit, scope, and command evidence exist across those records. | Successful exit is not yet a useful operator handoff describing what was delivered and where to inspect it. |
| Independent operator actions | `proposal-export` reads a stored proposal and exports it explicitly without requiring the run to be `in_progress`; no GitHub publisher exists. | A terminal execution state does not make all operator actions unavailable. Status needs proposal identity/route/evidence and eligible existing actions, not just a next stage. |

Primary references: `src\cli.ts:22-78`, `src\cli.ts:127-156`,
`src\store.ts:256-265`, `src\store.ts:770-843`,
`src\lock.ts:15-73`, `src\profile.ts:128-211`,
`src\approval-stage.ts:40-72`, `src\approval-stage.ts:201-309`,
`src\dispatch.ts:38-130`, and
`.claude\skills\run-buildworks\driver.mjs:101-142,215-303,326-345`.
The recorded run is in
`.claude\sessions\2026-09-09-paid-powershell-chain.md`.

### Two constraints that materially change the scope

**Continuation is not crash recovery.** Moving from a durably passed stage to
the next existing stage is a different operation from replaying a partially
executed stage. Stage functions have their own predecessor checks and
side effects. An arbitrary `in_progress` run is not proof that it can safely
be replayed. The first operator increment should refuse ambiguous partial
execution instead of deleting rows, resetting status, recreating worktrees, or
buying the same model invocation again.

**Cost visibility is not a complete bill or a budget cap.**
`AgentRunRow.cost` and the token/model fields are nullable. `parseEnvelope`
preserves missing telemetry as null. Failed invocations without a usable
envelope can have an audit event and raw files but no `agent_run` row.
The scratch driver's `reportCost` sums all rows and substitutes zero for null;
that is not an appropriate run-scoped product reporting contract.

A product view should aggregate `agent_run` through `stage.run_id`, separately
show known USD cost, rows with unreported cost, and recorded failed attempts
whose spend is unknown. These failure events are not the same as confirmed
billable charges. Abrupt process loss can leave still less evidence, so even
zero recorded failures cannot prove billing completeness. Aggregate before
joining findings/reports, or fan-out can multiply costs. Display rounding must
not change the stored amount. No live spend, exact invoice total, or enforced
dollar ceiling should be claimed.

References: `src\store.ts:38-58`, `src\harness.ts:108-137`,
`src\dispatch.ts:38-130`, and `ARCHITECTURE.md` sections 10, 15, and 20.

### Safe-boundary map

This table identifies candidate next calls, not permission based on the last
row alone. The run must be `in_progress`, the chain must be the expected
unbroken prefix, and required outputs, approvals, profile, audit bindings, and
worktree checks must still pass. The existing core functions remain the gate.

| Durable boundary | Next execution or handoff action | Important qualification |
|---|---|---|
| Created run, no stages | Invoke `runSpecStage` | A valid frozen profile and readable design are required; any existing stage prevents restarting the spec group. |
| Passed `spec_review`, no approval | Pause for external signing, then `approve` | A passed `spec` by itself is not this boundary. Spec review and its gate must have completed. |
| Passed `awaiting_approval` with recorded approval | Invoke `runPlanStage` | The approved spec must still match its evidence. A pre-existing plan stage is not resumable through this entry. |
| Passed `plan_review` | Invoke `runImplementationStage` | A passed `plan` alone is insufficient. Existing worktree residue is refused, not reused automatically. |
| Passed `implementation` | Invoke `runVerificationStage` | Implementation's commit handoff must exist in its pass audit event; a passed row by itself is insufficient. |
| Passed `verification` | Invoke `runCodeReviewStage` | Verified commit, retained record, audit binding, clean worktree, and frozen panel are checked again. All internal panels/remediation stay inside this call. |
| Passed `code_review` | Invoke `runDeliveryStage` | Final reviewed/verified commit and retained evidence are cross-checked before terminalization. |
| Completed run | Display the recorded delivery handoff | No further stage call or automatic publication. |
| Blocked run, partial group, unknown chain, or inconsistent handoff | Explain the state and refuse automatic continuation | Do not synthesize missing stage completions or replay a paid actor. |

These execution refusals do not prohibit independent inspection or explicit
proposal export. Status distinguishes the next workflow action from other
eligible operator actions and states why each unavailable action is refused.
The first increment exposes only implemented actions; it does not advertise
an unbuilt GitHub command as an executable next step.

References: `src\spec-stage.ts:81-148`, `src\plan-stage.ts:81-106`,
`src\implementation-stage.ts:60-90,197-212`,
`src\verification-stage.ts:79-145`, `src\code-review-stage.ts:65-150`,
and `src\delivery-stage.ts:115-166,546-631`.

A hard process termination does not run JavaScript catch/finally handlers.
Some stage catches terminalize ordinary thrown failures, but process loss can
leave a pending/in-progress stage or a passed row without all of its handoff
evidence. Spec and plan each contain two stages: a crash after authoring is
not a supported restart at the review half. CLI process exit, lock recovery,
and workflow recovery therefore must not be treated as equivalent.

There are two bounded existing transactional exceptions, neither requiring a
general resume engine. Approval commits its stage, approval row, and audit
events together; failure can leave the same pre-approval boundary. Delivery
finalization similarly rolls its database changes back and can leave the
passed-code-review boundary intact. Its deterministic orphan result files are
rewritten by the existing core on a later invocation. A new guided invocation
may call the core from that intact boundary; it must not loop automatically on
the failure or generalize this behavior to paid stages.

Delivery rollback/re-invocation is covered by
`test\delivery-stage.test.ts:898-928`; that test simulates a thrown
finalization failure, not every possible OS-kill/disk-loss sequence. Approval's
transaction is in `src\approval-stage.ts:266-309`.

### Time limits and what status can honestly display

The run-age check uses `run.created_at`, so waiting for human approval consumes
the eventual run-age allowance. The current default is seven days, frozen per
run. Direct source tracing locates that check at implementation, verification,
code review, and delivery, not in the spec or plan entry points. It is an
entry-time refusal, not proof of a watchdog stopping the whole chain precisely
at its deadline.

The new guided command should expose the deadline and refuse to buy more work
when that frozen deadline already makes later delivery impossible. That is an
explicit new early-readiness refusal; the plan must not describe it as a guard
already enforced by every stage or silently rewrite the stage implementations.
Likewise, expiry is checked when accepting approval. Current downstream stages
do not revalidate `approval.expires_at`; reporting an old expiry must not
invent a new post-approval revocation policy.

`stage.started_at` is declared but no current source write populates it.
Use available stage-create audit timestamps and clearly labelled observation
times for elapsed reporting; show unknown when no start evidence exists.
Do not infer active work merely because the last row says `pending`.
Failed-dispatch audit summaries also lack the raw-file reference held by
successful agent rows. Where no exact reference exists, expose the retained
run evidence directory and the limitation instead of guessing a file by time.

References: `src\policy.ts:113-126`,
`src\implementation-stage.ts:197-205`,
`src\verification-stage.ts:114-122`,
`src\code-review-stage.ts:100-106`, `src\delivery-stage.ts:159-165`,
`src\store.ts:395-415,790-826`, and `src\dispatch.ts:62-77`.

## Desired operator journey

The operator first gets a no-spend readiness report for the selected target.
It names missing prerequisites and exposes the chosen configuration rather
than trying to repair the repository silently. The operator commits the design
and real verification commands, creates a run using the existing intake
fields, and invokes one guided execution command.

That command advances the existing chain until human approval is required,
a stage refuses/blocks, or delivery completes. At the approval boundary it
returns control, the reviewed spec location, the scope/risk summary, and exact
instructions for the separate signing and verification steps. It does not
hold a writer lock open while waiting for the human.

After the operator records valid approval, the same guided command advances
from the next safe boundary. A separate read-only status command remains
usable while work is running. The terminal output names the outcome, recorded
cost coverage, retained branch/worktree, final commit where known, and evidence.
When execution blocks, status also identifies stored proposals, their routes,
and retained evidence so the operator can inspect or explicitly export them
without reopening the run.

Approval remains a human action. Execution consent to spend, cryptographic
scope approval, and permission to publish organization-visible GitHub content
are separate permissions. A convenience flag neither substitutes for the
signature nor authorizes publication.

## Recommended bounded scope

These are capability requirements. The command names are a proposed vocabulary,
not an already implemented interface or a prescribed internal design.

| Capability | Candidate surface | Required first-increment behavior |
|---|---|---|
| Discover and select a target | `bw --help`, `bw <command> --help`, consistent `--repo` | Help is free and side-effect-free. `--repo` selects the canonical local repository root, not a GitHub publication destination. Invalid/unknown options fail before state changes or spend. |
| Check readiness | `bw doctor` with optional feature/run selection | Check runtime/Git/commit, clean-tree requirements for new intake, design and committed config, actual native executable availability, reviewer staffing, and public-key status. Report current readiness separately from a frozen run's configuration; GitHub is not a prerequisite. |
| Find existing work | `bw runs` | Bounded newest-first listing within the selected repository, including run ID, feature, run status, last recorded activity, and current derived phase. Require an explicit run ID for subsequent execution. |
| Inspect a run | `bw status --run <id>` | Show recorded chain, derived operator phase, blocking/refusal evidence when recorded, next workflow action, other eligible operator actions, stored proposals, frozen configuration, approvals, reported cost, and local evidence locations. Read local state by default and include a machine-readable mode. |
| Advance existing work | `bw run --run <id>` | Execute only the existing next eligible stage groups, stop at approval/block/completion, and never automatically replay a partially executed stage. Reuse the same command after explicit approval. |
| Complete the approval handoff | Existing `approval-request` and `approve` | Add convenient byte-preserving payload output and signature-file input if needed; preserve existing raw stdout and canonical binding. Print useful next instructions without invoking the signer or accepting a private key. |
| Understand activity and outcome | Guided-command progress and final summary | Show stage start/end and elapsed waiting time without streaming sensitive model text. Report durable state and known cost after stages finish. Identify final branch/worktree/commit and retained reports. |
| Invoke it conveniently | Documented checkout-local installation/launcher | Establish one working Windows invocation from a target repository without changing the Claude harness. Keep release packaging separate unless explicitly selected. |

Keep `new-run` and its required identity/model inputs in the first increment
rather than inventing project or feature identities automatically. This avoids
combining implicit run creation and potentially paid execution in one ambiguous
command. A later shorthand can combine them once its duplicate-run behavior is
specified. Do not automatically select "the latest" run for mutation.

Use text by default and explicit JSON on the new inspection/guided commands.
Do not retrofit every low-level command's output in the first slice. In
particular, wrapping the existing approval payload in JSON would change the
bytes the operator signs.

Readiness means the checks actually performed. A successful `claude --version`
does not establish authenticated account access, model entitlement, or enough
quota. Do not make a paid request to turn a free doctor command green. A
missing key should be visible as "not ready to approve"; do not silently change
the existing nullable-signer policy or generate a key.

Local readiness and inspection do not contact GitHub, consult a logged-in
`gh` session, or infer publication permission from Git remotes. A future
integration's live diagnostics must be explicit and separate from readiness
to execute the local delivery chain.

## Business, data, and security rules

Run/stage/audit rows and their bound evidence remain authoritative. New
operator labels such as "awaiting operator approval", "ready for next stage",
"writer active", and "interrupted or inconsistent" are derived views, not new
persisted run statuses. The CLI must not write the deferred status projection.

Local repository identity, `run.project`, run ID, and feature/criterion identity
remain distinct. Run IDs are scoped to their store; criterion IDs belong to
their specification. Neither is a globally unique GitHub identity. Future
GitHub owner/repository, Project, issue IDs, and publication hashes require
explicit concrete mappings; do not introduce empty columns, generic tracker
interfaces, or speculative schemas in this increment.

Inspection must not acquire or remove the writer lock, create a database, run
migrations, alter a profile, or repair evidence. It must work alongside a
writer using a consistent read of committed state. SQLite contention may
produce a bounded, named unavailable result; it must not hang or pretend an
empty database. An unsupported schema requires an explicit migration
instruction, not a compatibility parser or implicit migration.

Status must distinguish repository lock ownership from knowledge that a
particular run/agent is active: the current lock stores a PID/token/time, not
a run ID. File existence, stage status, elapsed time, and process liveness
must not be conflated. Do not use `run.updated_at` as the timestamp of the
latest stage/dispatch unless the write path actually updates it.

New execution commands must state their potential paid work before starting.
Recommended consent contract: show the target, run, frozen model/review bounds,
and remaining stage groups through the next human gate or terminal outcome,
including the bounded internal review/remediation work; require explicit
execution consent once per invocation, with an explicit noninteractive consent
option. Without consent, do not dispatch. This is not a monetary guarantee and
not scope approval or publication permission.

Never reset a terminal blocked/completed run, overwrite an approval,
auto-sign, auto-export a proposal, widen scope, change the frozen model, merge,
push, delete evidence, or clean up a worktree as part of convenience operation.
The existing code-review function owns its internal remediation and
verification; the outer command must not add another review loop.
The execution guard does not apply indiscriminately to inspection/export:
those existing operator actions retain their own eligibility and do not
advance authoritative stage state.

Default output exposes useful summaries and evidence paths, not complete raw
model responses, environment variables, private keys, or key contents. Finding
views retain reviewer attribution and round/severity. A below-threshold finding
is recorded/non-blocking, not "fixed" or "harmless". Completion means the
existing gates passed, not that version-only commands prove product behavior.

### Boundaries for a later GitHub integration

These requirements constrain the later integration, not the current CLI
deliverables or database shape:

| Concern | Required boundary |
|---|---|
| Target and readiness | Publication uses the explicitly configured and frozen GitHub repository/Project mapping, not an inferred remote or universal board. GitHub-disabled targets still execute the local chain. |
| Preview and consent | A no-write preview identifies target and publishable content before separate confirmation. Neither preview nor paid-execution consent publishes; the preview mutates neither authoritative local state nor remote items. |
| Credential scope | The concrete publisher receives its short-lived App token through its named command-time environment input. It does not pass that credential into model/verification environments, prompts, issues, retained output, or audit summaries. |
| Publication status | Stored remote IDs/URLs, frozen mapping, published hash, last completed step, and unpublished/partial/ambiguous/published outcomes remain separate from delivery status. Default status reads stored facts; live diagnostics are explicit. |
| Terminal operator actions | An eligible stored `blocking_dependency` proposal can be published after execution blocks. Missing human decision question, options, owner, and needed-by date are named; publication does not guess them or rewrite the stored proposal. |
| Failure and recovery | Publication failure does not change a passed/blocked gate. An ambiguous create refuses automatic recreation and uses the proposal's explicit identity reconciliation; this never replays a paid stage or reopens the run. |
| Evidence and intake | A `.governance` reference remains local evidence, not a remotely accessible URL. Publication excludes raw model output; accepted inbound source material retains explicit identity/provenance without letting later remote edits change active approved work. |

No publication implementation, automatic sync, schema extension, or remote
inspection is authorized by recording these boundaries.

References: `ARCHITECTURE.md` sections 3, 12, 14, 15, 17, 19, and 24;
`src\approval.ts`; `src\paths.ts`; `src\lock.ts`; and `src\store.ts`.

## Inputs, outputs, and error contract

Inputs remain target repository, explicit run ID, current intake fields,
operator-selected model at creation, and externally supplied approval expiry
and signature. The spec input remains the feature's design document in the
repository layout; no arbitrary prompt-input feature is needed.

The status output should include repository/run identity; persisted status and
derived operator phase separately; ordered stages and their evidence links;
frozen model, verification commands, review controls, starting commit/profile
hash; approval state; cost subtotal and telemetry gaps; and an actionable next
workflow command or a clear reason no automatic continuation is available.
Separately show eligible existing operator actions and stored proposal IDs,
routes, titles, and local evidence references. Do not describe a local path as
a GitHub URL or equate execution completion with successful publication.

Errors must distinguish malformed CLI input, missing setup, missing run,
writer contention, expected human-approval pause, policy block, incomplete
stage, missing/tampered evidence, and an underlying execution failure.
Preserve the originating reason rather than replacing everything with
"run failed". Do not manufacture an old refusal reason that was never recorded.

Recommended new guided-command exit contract: 0 only for terminal completion,
1 for an operational refusal/block/failure, 2 for usage errors, and a documented
distinct code such as 3 for an expected approval pause. Read-only status returns
0 when inspection succeeds even if the inspected run is blocked. JSON carries
the outcome explicitly. Existing stage-command codes stay unchanged.
Future publication commands report their own result without changing these
delivery exit semantics or rewriting the run's persisted status.

No terminal prompt may wait indefinitely when stdin is redirected. JSON stdout
must contain exactly the documented result, with progress/diagnostics on stderr.
Plain terminal output must also work when redirected, without cursor-control
sequences or color being required to understand the outcome.

## Acceptance criteria for the later plan

These criteria define the recommended bounded slice; they do not assert that
the current implementation satisfies it.

| ID | Given / when | Required result |
|---|---|---|
| CLI-AC-01 | Given no governance state, when help is requested or an invalid command/option is supplied | Help exits 0; invalid usage exits 2; neither creates state, locks the repository, or dispatches. |
| CLI-AC-02 | Given an explicit repository, its root, or a child directory, when a new operator command resolves its target | It consistently identifies the intended canonical local root, reports it, and never creates a separate nested governance store. A bad target is named, not replaced by the current directory. `--repo` does not select a remote publication destination, and Git remotes do not confer publication authority. |
| CLI-AC-03 | Given missing or invalid prerequisites, when doctor runs | Each performed local check reports its evidence and repair instruction, creates no run, changes no repository/key/configuration, and spends nothing. Availability is not account authorization; GitHub configuration, credentials, or reachability are not prerequisites. |
| CLI-AC-04 | Given no store or no runs, when runs/status reads | Missing state and an empty existing store are distinguished; no database or schema is created. Explicitly missing run IDs are diagnosed. |
| CLI-AC-05 | Given a writer holding the repository lock, when another process requests status | It reads committed state without taking/removing the writer lock or advancing the run; inconsistent intermediate evidence is labelled and not executable. |
| CLI-AC-06 | Given a passed spec review with no granted approval, when status or guided execution evaluates the run | It derives the human-approval pause despite there being no pending approval-stage row; no plan/implementation dispatch occurs. |
| CLI-AC-07 | Given an eligible boundary and explicit execution consent, when guided execution advances | It invokes only the next existing stage group, re-reads durable state after success, and stops at approval, refusal/block, or completion. Already passed groups are never re-dispatched. |
| CLI-AC-08 | Given blocked/completed state, an incomplete stage, an unrecognized/manual chain, or contradictory evidence, when guided execution is requested | It performs no paid work or repair, reports the exact limitation, and preserves rows, files, branch, and worktree. Completed state may report the existing handoff. This execution refusal does not disable independently eligible inspection or explicit proposal export. |
| CLI-AC-09 | Given redirected input and no explicit execution consent, when a potentially paid guided command runs | It neither hangs on a prompt nor dispatches. Execution consent never grants cryptographic approval or permission to publish GitHub content; supplying consent also cannot implicitly sign, export, or publish. |
| CLI-AC-10 | Given an exported approval payload, when the operator signs and supplies the signature through supported Windows transports | The core verifies the same canonical payload, expiry, scope, hashes, and signer rules; it never receives a private key or silently approves. Existing raw-payload consumers retain their contract. |
| CLI-AC-11 | Given multiple runs, nullable telemetry, and failed-attempt audit events, when cost is reported | The subtotal contains only the selected run's known costs, reports missing telemetry/unknown spend explicitly, counts review remediation under its owning stage, and is not inflated by finding/report joins. |
| CLI-AC-12 | Given a long-running dispatch, when progress/status is shown | Available audit/observation timestamps and last recorded activity are labelled accurately; missing start evidence remains unknown. There is no fabricated live cost, currently active agent, percent complete, or streamed raw model text. |
| CLI-AC-13 | Given a completed delivery or a blocking review, when the final summary is rendered | It names the recorded delivery outcome, branch/worktree and commit when established, local report/log paths, actionable blockers or retained non-blocking findings, and verification limits. It does not claim publication from delivery success or present local evidence as a remote URL. |
| CLI-AC-14 | Given JSON mode, when an inspection or guided command exits for any documented outcome | Stdout parses as the single documented result and distinguishes delivery pause/block/completion and workflow action from independent operator actions; diagnostics/progress do not corrupt it. Reading local status requires no remote fetch or hypothetical publication-state fields. |
| CLI-AC-15 | Given the chosen installation method on Windows and a separate target path containing spaces, when the operator invokes help and free readiness/inspection | The correct CLI and assets resolve without using the BuildWorks checkout as the target or adding a shell wrapper around native Claude. |
| CLI-AC-16 | Given changed policy before approval, an expired signature submitted for approval, an aged run, or a moved/missing worktree, when the relevant action is requested | Existing guards remain decisive and the guided entry refuses work already unable to reach delivery because of run age. It neither refreshes frozen inputs nor invents expiry-based revocation of previously granted approval. |
| CLI-AC-17 | Given a terminal run with stored proposals, when status is requested and the operator separately requests an eligible export | Status exposes proposal IDs/routes/titles/local evidence and the implemented inspection/export action separately from stage continuation. Explicit export retains its existing refusal/audit behavior and does not reopen the run; no unbuilt publisher is presented as executable. |
| CLI-AC-18 | Given a target without GitHub integration or credentials, or an unavailable GitHub service, when local help, readiness, inspection, execution, or approval is used | Local behavior depends only on its own prerequisites, does not contact GitHub or read a `gh` login, and does not require placeholder integration configuration. Later publication diagnostics cannot replace delivery state. |

## Implementation-planning implications

The smallest coherent increment is **inspection plus safe guided execution**,
not a new workflow engine. Inspection alone is useful but still leaves the
operator responsible for sequencing; orchestration alone would hide failures
behind a command that cannot report its own state.

The likely change surfaces are existing CLI argument routing and output;
target resolution; a genuinely read-only database path and bounded queries;
shared run-state interpretation; extraction/reuse of intake readiness checks;
direct sequential calls into existing stages; approval file transport; and
operator documentation. Keep the current database schema unless a specific
accepted requirement demonstrably needs a new field.

Share workflow-state interpretation between status and execution so the next
stage action shown is the next stage action allowed. Keep independent operator
actions subject to their own eligibility rather than a blanket in-progress
guard. Execution still revalidates under the writer lock through the existing
core guards; a status snapshot is not authorization.
Do not recursively spawn the CLI under its own lock, copy the scratch driver's
success expectations into the product, or wrap the full paid chain in a
long-lived SQLite transaction.

The scratch driver is test infrastructure: it creates fixture design/config,
generates disposable keys, signs approvals, and continues recording downstream
expectations after failures. Those behaviors must not become the operator
workflow by copying the driver wholesale.

For installation, begin with the existing checkout-based model and a proven
local invocation. Do not assume that publishing the current TypeScript bin is
enough: Node refuses type stripping under `node_modules`. A distributed package
would need an explicit JavaScript build/package approach and inclusion of the
SQL migrations and the operator signer, which also imports TypeScript modules.
That is a larger, separately selectable scope.

External evidence:
[Node.js: Type stripping in dependencies](https://nodejs.org/api/typescript.html#type-stripping-in-dependencies),
read 2026-09-09. Repository evidence: `package.json`, `tsconfig.json`,
`src\store.ts:240-243`, and `scripts\sign-approval.mjs`.
No install/link/packaging experiment was performed in this analysis.

### Existing evidence and focused future validation

Existing tests provide reusable coverage for CLI refusals, lock ownership,
frozen-model checks, approval byte handling, dispatch telemetry/evidence, and
terminal delivery behavior. Relevant files include `test\cli.test.ts`,
`test\store.test.ts`, `test\lock.test.ts`, `test\approval-stage.test.ts`,
`test\sign-approval.test.ts`, and `test\dispatch.test.ts`.

The later plan should add focused no-spend tests for read-only inspection under
a live writer, exact argument/JSON contracts, each safe boundary, partial-stage
refusal, terminal-run inspection/export, operation-specific consent, no GitHub
dependency, and delivery/evidence summaries. Exercise
actual CLI processes and the existing stage functions with the repository's
recorded/schema-bound test mechanisms, not only a fake orchestrator.

Expected stage order and authority come from the architecture; expected
costs/content come from recorded envelopes or the receiving schema. The
September 9 fixture at
`test\fixtures\recorded\code-review-web-calculator-powershell-remediation-chain.json`
is available for review/remediation and delivery presentation evidence.
Its capture is not proof of interruption recovery or of the new CLI.
Prove new guards by breaking them in an isolated copy and observing the
targeted assertion fail. A paid end-to-end acceptance run would still require
separate operator authorization.

## Exclusions, assumptions, and readiness

Excluded: mid-stage crash recovery, replaying blocked runs, cross-machine
resume, a second harness, a TUI/web/RPC service, new SDLC stages, automatic
verification remediation, scope changes, the deferred status document,
automatic signing, repository/key scaffolding, Git publication/cleanup, GitHub
API integration/import/publication/synchronization, publication mappings and
recovery, executable-task synchronization, and hard monetary budget enforcement.
Full streaming, exact active-agent telemetry, and remote/multi-repository
dashboards are not prerequisites for this slice.

Working assumptions: keep the current local single-operator trust model,
checkout-based use, explicit run IDs, existing intake fields, and existing
stage/approval/policy semantics. These assumptions limit scope; they do not
grant new permissions.

Ready to draft the bounded local implementation plan on that basis.
Distributable installation, actual partial-stage recovery, outbound GitHub
integration, and inbound/two-way flow each materially expand scope and require
separate decisions. Exact command spelling, output fields, and the exit-code
number for an approval pause can be finalized in the local plan.

The following future decisions are explicitly deferred, not open blockers to
that local plan:

| Decision | Trigger and owner |
|---|---|
| Inbound object and local target/run selection | Operator authorization of inbound requirements; select repository Markdown, issue/form, discussion, or another explicit input. |
| Source revision and provenance details | Inbound design; specify content hash, revision, included attachments/comments, materialization, and operator acceptance while preserving the source/approval invariant above. |
| Executable task meaning | Explicit operator authorization beyond the current stages; distinguish criterion Stories from execution tasks before designing synchronization. |
| Spike-decision ingestion and cross-run identity | Later GitHub design; preserve changed source plus a fresh run and do not silently replace the outbound proposal's run-scoped identity with feature-global reuse. |
| Outbound production contract | Separate outbound authorization/discovery; settle target ownership, App installation/permissions, live Project field mappings, publication policy, and content visibility as listed in the proposal. |

## Analysis task record

Requested outcome: source-grounded analysis of the missing operator-facing CLI
capabilities, sufficient to prepare a later implementation plan, reconciled
with the GitHub-impact review at the operator's explicit request.

Success criterion: identify current gaps, reuse boundaries, safe scope,
testable requirements, and material uncertainties without changing delivery
behavior or spending on a run.

Approach: trace operator setup, approval, state/cost reporting, target/install
behavior, and stage-continuation constraints against source and governing
documents; reconcile the GitHub impact as boundary requirements while leaving
future integration design choices deferred. No task checklist or competing
state store is added to the repository.

Changed objects: this analysis and the dated GitHub-impact review's
reconciliation stamp. The source GitHub proposal, runtime, architecture, policy,
keys, run state, retained evidence, and source tests remain unchanged.

Validation and outcome: source citations and existing test/evidence contracts
were inspected, including the independent stage-boundary trace. Its initial
claim that spec and plan also enforce run age was not supported by the source;
the final analysis records the four actual enforcement points. The document
checker and strict typecheck passed; the documentation checker reported only
historical path warnings outside this new record. A separate reference/ID
check found no missing cited repository files or duplicate acceptance IDs.
No new CLI capability or interruption behavior is claimed as executed.

Remaining issues: the proposed capabilities are not implemented; the future
decisions above remain outside the local slice. Reconciliation authorizes
document changes, not implementation, remote activity, or paid execution.
The review stamp records every disposition. No current-slice finding remains
open. Rollback requires only reversing the scoped document edits; no runtime
or data rollback is needed.
