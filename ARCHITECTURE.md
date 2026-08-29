# Governed Delivery — Architecture

**Status:** Design, pre-implementation. Written 2026-08-28.

**Purpose of this document.** This is the design, and the only source of truth
for it. Every constraint here is binding; where one looks arbitrary, the reason
is stated beside it. Companion: `docs/hazards.md`.

---

## 1. The one principle

> Agents propose. The system decides.

Agents reason, draft, implement, review, and summarize. They never approve their
own work, advance authoritative state, bypass policy, or write without
validation.

```
agent output -> typed result -> validation -> approved write -> audit event -> next stage
```

This is the whole product. Everything below exists to make that sentence
enforceable and observable. If a design choice does not serve it, cut the choice.

## 2. Failure modes this design exists to avoid

Three structural mistakes, and together the reason this document is mostly
about subtraction.

- **A workflow engine for one workflow.** Declarative statuses and transitions
  per artifact type, plus cross-artifact consistency rules, produce five
  interlocking state machines where one hardcoded sequence would do.
- **Separate state models that must agree.** Artifact state, run state, and
  collaboration state held separately means every change must be correct in
  three places that can disagree silently. This is what produces "one step
  forward, two back."
- **Abstraction before the second implementation.** An executor registry, a
  workflow adapter, a tool registry, an RPC layer, an editor extension, and
  target stack adapters, all built before a single run completes end to end.
  Each becomes a seam, and seams are where the failures land.

A second delivery surface will silently diverge from the first unless something
exercises both. Build one.

## 3. Hard rules

These are binding constraints, not aspirations. Write them where they will be
read.

1. **One harness until one run completes end to end.** No second harness, no
   adapter interface, no plugin system until a run reaches the terminal stage
   and its evidence is queryable.
2. **One surface.** A CLI that calls the core directly. No RPC layer, no editor
   extension, no second entry point that can drift.
3. **One schema per thing.** No unions, no version discriminators, no
   compatibility handling. Nothing has shipped; change the shape and delete the
   old one.
4. **No abstraction without two real implementations.** Extract an interface
   when the second case exists, never in anticipation of it.
5. **Every fixture is recorded from a real run or asserted against the schema
   that will receive it.** No hand-written fixture may define correctness.
6. **Config is frozen at run start.** Snapshot what the run depends on; a run
   resumes against what it began with.

If the codebase passes a few thousand lines before the first complete run, stop
and cut.

## 4. The model: one run, ordered stages, explicit handoffs

A run is a chain. Each stage takes a typed input identified by the previous
stage's output, selects its participants, produces a typed proposal, is
validated by a deterministic gate, writes an immutable record, and hands off.

```
run
 └── stage(n)  input_stage_id -> output
      ├── agent_run(s)      what each agent saw, produced, and cost
      ├── findings          typed, identity-stable
      └── gate result       deterministic, not a reviewer's verdict
```

There is no separate artifact lifecycle to keep consistent. A spec is not
"planned"; either the plan stage produced an approved output or it did not. This
single change removes the largest source of complexity in the previous design.

**The handoff is a row, not an implicit sequence.** Stage N's output ID is
literally stage N+1's input. A run is then a chain you can walk, the audit is a
join, and the cost dashboard is one query.

## 5. Stage sequence

Start with the minimum that delivers value. Twelve stages that never complete
one run are worth less than eight that close the loop.

```
spec  ->  spec_review  ->  awaiting_approval  ->  plan  ->  plan_review
      ->  implementation  ->  verification  ->  delivery_check  ->  completed
```

Deferred until the above completes end to end at least once:
`task_decomposition`, `test_authoring`, `code_review`, `documentation`,
`final_verification`, `pr_summary`. Each is real work; none is worth building
before the loop closes.

## 6. Trust boundaries

Enumerate them; each is testable. Agents may not:

- approve their own work;
- mutate authoritative state directly;
- run commands outside an explicit allowlist;
- write outside allowed paths;
- expand scope without approval;
- modify policy files, agent definitions, or tool permissions;
- invoke the governance CLI. Spawned executors never receive it in an allowlist.

Model providers are not sources of truth. Repository content, policy files,
audit records, and human decisions are.

**Record when a guarantee is asserted rather than proven.** When
reviewers run as subagents inside the same harness session that authored the
work, independence cannot be verified from outside. Label it
`unverified_self_attestation`; label a separately spawned process
`configured_standalone`. A system that grades its own guarantee honestly is
worth more than one that prints a checkmark. Note the tension: the in-harness
path yields better telemetry and weaker provable independence; the separate
process yields the reverse.

## 7. Repository contract

What the system requires of a target repository, what it writes, and what it
must never write.

### Preconditions

A git repository with a clean working tree at run start. The tree must still be
clean between runs, which is a constraint on the ignore rules rather than on the
operator: if anything the system writes during a run is tracked, every run ends
dirty and the next one cannot start. Decide once, and prefer writing run state
to an ignored location and committing only projections.

Verification commands must be configured and must actually run. A stage that
cannot verify fails closed.

### What the system writes

- `docs/features/<slug>/` — projections, committed, human-readable.
- `.governance/` — authoritative state and retained raw output, machine-local
  and ignored.
- The feature branch and worktree — source changes, one run at a time.

Nothing else. A patch touching a path outside the run's signed scope is refused
at apply time.

### Protected paths

Agents may never write these, and the prohibition is enforced at the point a
patch is applied rather than requested in a prompt:

- agent definitions and the executor definition;
- policy and configuration the run snapshotted;
- the audit chain and anything under `.governance/`;
- the design document that is the run's own input.

An agent that could edit its own permissions, its own input, or the record of
what it did has no meaningful boundary. Enforcement belongs in the write path,
because a prompt-level instruction is a request and this is a rule.

### Branch and worktree isolation

Delivery happens on a retained branch, in a worktree created for the run, never
on the default branch and never in the operator's working copy. The base commit
is recorded at run start and every proposed patch is validated against it.

Retain the worktree after the run ends, including when it ends blocked. A failed
run whose evidence has been deleted cannot be diagnosed, and the branch is the
deliverable.

## 8. Contracts

### AgentResult

A status of `proposed`, `blocked`, or `failed`; the agent, role, and executor
identity; a summary; proposed content changes; proposed patches; diagnostics;
and questions for a human. Plus risk, optional confidence, and an optional
recommended transition.

Two properties are easy to lose and expensive to omit.

- **A proposed patch is bound to a base commit.** Required, not optional.
  Approval re-validates the diff against the current head, so a patch proposed
  against a stale tree is refused rather than applied.
- **Deletion is schema-legal but refused.** Accept the field so the schema does
  not churn later; reject the operation until its semantics are designed.

### Write modes

Two mechanisms, with different validation. Conflating them loses the guarantee
that makes the second one safe.

**Content write.** The agent proposes the whole content of a governed document.
The system validates it against the schema for that document and writes it. Used
where the system owns the file and there is no prior content to conflict with —
a specification, a plan, a review.

**Patch write.** The agent proposes a diff against a named base commit. The
system re-validates the diff against the current head before applying, refuses
it if the tree has moved, and checks every touched path against the run's signed
scope. Used for source changes, where the agent is editing content it does not
own.

A content write cannot express a source change, and a patch write must never be
accepted without its base commit. Everything downstream of approval is a patch
write.

### Finding identity

Derive a finding's ID from a normalized location plus an `intentKey` describing
what is wrong — not from its wording. The same concern rephrased in a
later round then produces the same ID, so findings deduplicate and can be
tracked across rounds and reviewers.

Consequence: `intentKey` cannot be normalized after the fact without changing
identity, so its accepted shape must be stated in the prompt that asks for it.
A prompt requesting a constrained field must state that field's constraint, and
a test should enforce that across every prompt-building file.

### Coverage decisions

A coverage entry may say `not_applicable`, but only with a rationale and an
alternative verification. Honest non-coverage beats a fabricated test.

## 9. Agents: definition, registry, and selection

### The definition

Version-controlled, one file per agent, treated as protected control-plane
content that an agent may never modify.

```yaml
id: planner
role: author            # author | reviewer — the basis of role separation
specialty: null         # reviewers only; e.g. security, requirements-traceability
executor: claude-code
outputs: [plan]         # the only result kinds this agent may be asked for
tools: []               # command allowlist; empty means none
```

**The binding rule: a field that nothing enforces does not belong here.**
Definitions accumulate fields like `purpose`, `canRecommend`, and
`cannot` — prose asserting properties the code enforces elsewhere, or not at
all. Decorative fields make a registry look authoritative while the real
constraints live somewhere else. If `outputs` is not checked at dispatch, either
check it or delete it.

`outputs` in particular earns its place, and getting it wrong is expensive.
A dispatcher that derives the required output from the *result kind* rather than
the *performer* will ask a reviewer agent for plan output and fail with
"configured agent does not allow plan output." An entire review step can then
never execute, and nothing will notice until an invocation is paid for. **A test asserting
that a request for a disallowed output is refused would have caught it
immediately; write that test first.**

### Role separation

Enforced at dispatch, not by convention:

- an agent with `role: author` is never selected as a reviewer for its own stage;
- a reviewer never resolves its own findings, advances a stage, or approves;
- the approval gate is closed to every agent regardless of role.

### Selection

A pure function, not a subsystem:

```ts
selectReviewers(stage, risk, spec) -> Agent[]
```

Required specialties first, then ranked relevance to fill remaining slots, with
role separation applied. Roughly eighty lines, trivially testable. Two reviewers
per reviewed stage is a reasonable default; one at low risk.

Keep it free of model routing and telemetry concerns. Entangling selection with
semantic model tiers and capability preflight is what made the previous
implementation resistant to change — three unrelated reasons for one function to
fail.

## 10. Model configuration

Which model runs a stage is configuration, not code, and not the agent's choice.

**Map stages to models in configuration.** A stage names what it needs; the
configuration resolves that to a concrete model. Keep this out of agent
selection — a selection function that also routes models has two unrelated
reasons to fail.

**If you use semantic tiers, resolve them at run start and snapshot the
resolution.** A tier like `fast` or `balanced` that resolves at call time is a
moving target: validating the effective model against a list authored earlier
breaks the moment the alias is remapped, and the check runs after the invocation
is paid for. Resolve once, record what it resolved to, and hold that for the
life of the run.

**Record requested and effective model separately on every agent run**, along
with any fallback the harness performed. They differ more often than expected,
and the difference is exactly what a cost model needs.

**A stage whose model cannot be resolved fails at configuration time**, before
any invocation. Discovering it at dispatch means discovering it after earlier
stages have already been paid for.

## 11. Harness invocation

The harness is a CLI process. There is one adapter, concrete, with no interface
above it until a second harness exists.

### The executor definition

```yaml
id: claude-code
command: [claude, -p, --output-format, json]
probe: [claude, --version]
capabilities: [plan, review]
telemetry:                  # what this harness can actually report
  perInvocationModel: true
  effectiveModel: true
  tokenUsage: true
  sessionCost: false
sandbox:
  allowedPaths: [docs/features/**]
  deniedPaths: [.governance/**]
  commandAllowlist: []
  idleTimeoutSeconds: 600
  envPassthrough: [PATH, HOME, USERPROFILE, APPDATA, TEMP, TMP, ...]
  network: inherit
```

Capabilities and telemetry are declarations the system checks against, not
documentation. A stage requiring a capability no configured executor declares
must fail at configuration time, not at the moment it is dispatched.

### Invocation

**Non-interactive, one process per invocation.** Prompt on **stdin**, never in
argv. On Windows the executable usually needs shell resolution, and a shell
concatenates arguments without escaping them — a prompt containing spaces or
quotes arrives shredded, and the session runs without doing the work it was
asked for, while appearing to succeed. Write the prompt to stdin and close it.

**Probe before any run.** Run the probe command at setup and refuse to proceed
if the executable does not resolve in the environment that will actually spawn
it. Verifying it in a developer shell proves nothing about the environment the
system spawns from.

**Timeouts are an inactivity budget, not a wall clock.** Legitimate work can run
for many minutes while producing output the whole time; a wall-clock limit kills
it. Reset the timer on any output, and keep a separate absolute ceiling as a
multiple of the idle budget so a chatty hang still terminates. Kill the whole
process tree, not the immediate child — on Windows that means an explicit tree
kill.

**The sandbox is enforced by the caller, not requested of the agent.** Allowed
and denied paths, the command allowlist, and an explicit environment passthrough
list. Pass named variables through; never inherit the whole environment, which
leaks credentials and machine state into a model context.

### Reading the result

**Parse the returned body against the shapes in "Parsing model output".** The
harness returning exit code zero says nothing about whether the body is what was
asked for.

**Take cost and model identity from the harness, never from the model.** A model
asked what it cost will answer plausibly and wrongly. Read token counts, the
effective model, and any fallback state from the harness's own structured
output or transcript, and store them on the agent run. Where the harness cannot
report something — session cost, in the example above — record the gap
explicitly rather than substituting a zero. A zero that means "not reported" is
indistinguishable from a zero that means "free", and it will silently corrupt
every estimate built on top of it.

**Retain the raw bytes before parsing**, as "State, storage, and evidence"
requires.

## 12. Gates

A gate is deterministic. A reviewer's verdict is an input to a gate, never the
gate itself.

**`spec_review`.** Persist immutable source and policy intake first. Dispatch
the author and the review panel. A material finding or any change to governed
content triggers a closure pass. The deterministic gate decides completion.

**`awaiting_approval`.** The only human gate. One signed authorization binds
feature ID, spec version and content hash, starting commit, profile hash, risk,
expiry, and scope. Approval re-checks that policy has not changed since intake.
Worker sessions cannot resolve it and never receive signing secrets.

**After approval.** One authorization covers the rest. Each patch is validated
against the signed scope and applied without a fresh human decision. A stage
that fails its requirement blocks the run rather than requesting a new
signature.

**`verification`.** Fails closed when commands are missing or do not pass.
Bounded remediation rounds are the retry budget; exhausting one blocks.

**`delivery_check`.** Before a run
may complete, every artifact the spec declared must appear in the changed paths
of an applied patch. Scope enforcement answers "may this stage write here";
this answers "did anyone write it at all". Without it, a run can route work to a
later stage, mark it done, and report success having delivered nothing. A suite
whose fixtures declare one path and write another will not notice.

**Refuse promises that cannot be kept.** If a criterion's artifacts
are all produced by a later stage, the plan may not promise test coverage for it
now — the only way to satisfy that promise later is a false attestation. Refuse
at the gate instead.

**Scope fitness.** When the spec declares an artifact the signed scope does not
cover, do not fail and do not silently widen. Propose an addition with a delta
hash and policy snapshot, and let that be part of what is approved.

## 13. Conflict resolution

Reviewers produce findings. They do not vote, and the system does not need them
to agree.

**Findings deduplicate by identity.** Two reviewers raising the same concern
about the same location produce one finding, because identity derives from
intent and location rather than wording. This removes most apparent conflict
before anything has to resolve it.

**The gate is deterministic, so consensus is not required.** A gate does not ask
whether reviewers agreed; it asks whether every material finding is resolved or
explicitly dispositioned with a justification. Contradictory recommendations
from two reviewers are two findings, and both must be answered.

**Nothing resolves its own finding.** The author may address or dispute a
finding; the decision that it is resolved belongs to the gate, and where the
gate cannot decide, to a human.

**Exhausting the remediation budget blocks the run and names the findings.**
A bounded number of rounds, then a terminal block that identifies the specific
finding IDs still open, with the branch and worktree retained. An unresolvable
disagreement is a human decision, not an aggregation function, and burning more
rounds against it only spends money.

**A finding whose cause is upstream must be reportable as such.** A reviewer who
correctly concludes that the specification is at fault should not be forced to
express that as a defect in the plan, because the author can then only answer by
revising the wrong artifact. Give the result contract a way to say "this is
valid and its cause is upstream" and route it to a human rather than to another
remediation round.

## 14. Work intake and projections

There is no artifact lifecycle. Work intake is documents and convention; run
state is the database. Keeping those separate is what removes the previous
version's cross-artifact consistency rules — those existed only because status
was stored in two places that could disagree.

**Backlog.** Proposals, enhancements, and bug reports are markdown under
`docs/proposals/`. Nothing enforces a state machine over them. Promoting one to
active work is `git mv` into `docs/features/<slug>/design.md`. There is no
transition to validate because nothing downstream depends on a proposal's status
being correct.

**Active work.** One directory per unit of work:

```
docs/features/<slug>/
  design.md     input; hand-written or drafted, the only file a human authors
  spec.md       produced by the spec stage
  plan.md       produced by the plan stage
  reviews/      produced by review stages
  status.md     projection of run state; never hand-edited
```

**Status is derived, never stored.** *This is the rule that matters.* `status.md`
is a rebuildable projection. The authoritative answer to "what state is this
in?" is a query against `run` and `stage` — the same query the dashboard runs.
Nothing can disagree because the answer exists once. Resume reads the database,
never the projection.

**Bugs use the same pipeline with one flag.** A `changeKind` of `feature` or
`defect_fix` on the run. This flag is what lets a defect fix be
required to carry regression coverage and behavioural evidence bound to the
implementation commit — a real gate worth keeping.

**Tasks are rows, not artifacts.** When task decomposition is eventually built,
tasks belong to a run and have no independent lifecycle to keep consistent with
anything. Making them a third artifact type is a large part of what went wrong
before.

The rule underneath all of this: **enforce what has consequences.** Applying a
patch, resolving an approval, completing a run — those get gates, because
getting them wrong costs money or corrupts the tree. Whether a proposal is
"accepted" is bookkeeping, and bookkeeping enforced by code becomes state
machines that must agree with each other.

## 15. State, storage, and evidence

**One SQLite database is the authoritative state store.** Not a telemetry
sidecar — the system's memory. Everything the system needs to resume, gate, or
report lives there.

```
.governance/
  state.db          authoritative: runs, stages, agent runs, findings, audit
  raw/<run>/...     retained raw model output, one file per invocation
  migrations/       ordered .sql files, applied at startup
```

**What is git-tracked and what is not.** The database and raw output are
machine-local and gitignored. Projections under `docs/features/<slug>/` are
committed, because they are what a human reviews in a diff. Agent definitions,
policy, and the design document are committed, because they are inputs that must
be reviewable and protected. Tracking an audit directory while
ignoring run state leaves the tree dirty after every run, so the next one fails
its clean-tree precondition. Decide this once and make the ignore rules match.

**Migrations are ordered plain SQL, applied at startup.** No ORM. The schema is
small enough to read, and you will want to read it when a cost number looks
wrong.

**Multi-project.** `run.project` is the discriminator, so one database can serve
several repositories and answer "what is in flight across everything" without a
central service. If a project's runs must be portable, export rows rather than
sharing a file.

**Backup is copying one file.** That is a genuine advantage over the previous
design's state spread across JSON trees, a separate checkpoint database, and
git.

### The evidence model

The idea that justifies the system to anyone outside it:

> An agent run is a record of what an agent was allowed to see and do, plus what
> it actually cost and which model actually ran.

Self-reported cost is not evidence. Read it from the harness transcript.

```sql
run(id, project, feature_id, slug, change_kind, status, created_at, updated_at)
stage(id, run_id, kind, ordinal, input_stage_id, status, gate_result, started_at, ended_at)
agent_run(id, stage_id, agent, role, executor, requested_model, effective_model,
          fallback, tokens_in, tokens_out, cache_read, cache_write, cost,
          duration_ms, input_hash, output_hash, raw_output_ref, independence)
finding(id, stage_id, agent_run_id, severity, intent_key, subject, location, disposition)
handoff(id, from_stage_id, to_stage_id, payload_ref, created_at)
audit(id, run_id, stage_id, actor, actor_type, action, summary, hash, prev_hash, created_at)
```

Cost per stage, per feature, per agent, and historical estimation all fall out
of this without a separate service. Dashboards and notifications read it; they
never sit in the delivery path.

**Retain raw model output before any parser touches it**, and reference it from
`agent_run.raw_output_ref`. A rejected response whose
bytes were discarded leaves only a truncated fragment in an error message.
Retained bytes are how diagnosis becomes possible instead of guesswork, and they
are the raw material for the contract tests in the verification section.

## 16. Audit

Append-only and hash-chained: each event's hash covers its content plus the
previous event's hash. Corrections are new events, never edits. A verification
command recomputes the chain. This makes the trail tamper-evident rather than
append-only by convention, and it costs perhaps forty lines.

## 17. Security and secret handling

**Signing material lives outside the repository.** Approval keys are never in
the repo, never in a projection, and never in run state. A worker or agent
session never receives them under any circumstance — an agent that can sign an
approval has defeated the only human gate in the pipeline.

**Pass named environment variables, never the whole environment.** Inheriting
the parent environment puts credentials and machine state into a model context
and into any transcript it produces.

**Treat retained raw output as sensitive.** It is model text produced from
repository content and prompts, so it may contain anything either contained. It
is machine-local and ignored for that reason as much as for tree cleanliness.

**The audit chain is tamper-evident, not secret.** It is committed and readable.
Do not put secrets in summaries, and do not rely on the chain for
confidentiality — it exists so that alteration is detectable.

**Credentials never enter a prompt.** If a stage needs authenticated access, it
gets it through the environment passthrough list, not through instructions.

## 18. Parsing model output

Real models return correct work in shapes the schema refuses. Every parser must
be exercised against all of these. *This is the largest single defect class,
and it is invisible to a suite whose fixtures emit conforming bytes.*

1. bare JSON
2. a single ` ```json ` fence
3. prose before the fence — "Now I'll return the reconciliation:"
4. prose after the fence
5. two fenced blocks
6. a fenced block that is not JSON
7. CRLF line endings inside the fence

**Choose strictness by consequence, not by taste.** Where bytes are canonicalized
into an immutable record, be strict and refuse prose outside the fence, because
silently dropping it corrupts the record. Where the result is only
schema-validated, tolerate one fenced block anywhere in the body. Refuse rather
than guess when several are present.

Assert the operator-visible message on every refusal, not merely that an error
was thrown. Several defects were diagnosable only because the message named the
cause.

## 19. Concurrency, failure, and resume

One writer per repository, via a lock file. A second invocation fails fast with
a clear diagnostic rather than corrupting state. Optimistic concurrency on a
version field for content writes. Audit appends serialized under the same lock.

Run state is machine-local and resumable. Resume reads authoritative state, never
a human-readable projection.

**A retry that resends an identical prompt is not a retry.** A run
died three times in planning producing byte-identical bad output. If a retry does
not vary the prompt, the context, or the model, it is a slower failure. Make
variation a requirement of the retry path.

## 20. Limits

Every limit has a defined behaviour on breach, and that behaviour is never
silent truncation. A truncated prompt produces confidently wrong work at full
price.

- **Prompt size.** Cap it. An oversized prompt must go somewhere explicit — a
  content-addressed file the invocation references — rather than being cut. If
  it cannot be delivered intact, refuse the invocation.
- **Result size.** Cap it, refuse above the cap, and retain the raw bytes anyway
  so the refusal is diagnosable.
- **Concurrency.** One writer per repository, enforced by a lock. A second
  invocation fails fast with a clear diagnostic rather than interleaving writes.
- **Remediation rounds.** A bounded budget per reviewed stage. Exhausting it
  blocks; it does not silently accept.
- **Invocation time.** An inactivity budget with a separate absolute ceiling,
  as "Harness invocation" describes.
- **Run duration.** A ceiling, because an unattended run that cannot finish
  should stop rather than accumulate cost.

State each limit's value in configuration, not in code, and record in the run
which values were in force.

## 21. Verification strategy

Two categories, and the second is the one that pays.

**Unit and integration tests, test-driven.** Necessary, and they verify code
against your assumptions.

**Contract tests fed by recorded real output.** *This is the load-bearing one.*
Test-driven development does not catch the defects that cost money — output in
an unexpected wrapper, a constrained field in the wrong case, a mock provider
passing a governed stage, a fixture declaring one path and writing another. Every one was
a case where the code did exactly what its author intended and the contract with
reality was wrong. Replay retained model output as fixtures.

**Prove a guard by breaking what it guards.** A test that passes on first write
has shown only that the author's reading matched the code. Break the behaviour,
confirm the test fails, restore. Run this over the whole suite periodically, not
only when a test is written; it is the only evidence that distinguishes a guard
from a mirror.

**Keep a checker that re-derives documentation facts from source.** Counts,
versions, stage sequences, and paths, verified mechanically. Roughly a hundred
lines gets most of the value. Prose goes stale; a checker does not.

## 22. Known hazards

`docs/hazards.md` states fourteen failure modes this kind of system is subject
to and what each requires. They are requirements, not an appendix: model output
in shapes the schema refuses, discarded output being undiagnosable, constrained
fields whose constraint the prompt never states, fixtures and code agreeing
while both are wrong, completion without delivery, promises a later stage cannot
keep, retries that vary nothing, executable resolution, unverified hook
interpreters, exact-match model acceptance against moving aliases, a default
install that cannot complete a run, configuration divergence between targets,
specifications inventing obligations, and independence that cannot be proven.

When a new failure mode is found, add it there rather than here. Two lists drift
apart, and the one that drifts is the one people stop trusting.

## 23. Build order

1. Run store, stage chain, and audit chain over SQLite. No agents yet.
2. One harness adapter, concrete, no interface above it.
3. Spec stage and its review panel with a deterministic gate.
4. Human approval binding state.
5. Plan stage and gate.
6. Implementation on a branch, patch bound to base commit, scope enforced.
7. Verification, failing closed.
8. Delivery check.
9. **Stop. One complete run, with queryable cost.** This is the milestone that
   decides whether the project continues.
10. Only then: the deferred stages, then a dashboard, then notifications, then —
    if ever — a second harness.

## 24. Non-goals

Explicitly not built, and not to be added without deleting something first:
a workflow engine, multiple delivery surfaces, an editor extension, target-stack
adapters, a plugin system, cross-machine resume, pull-request creation, and any
compatibility layer for state that no user has.
