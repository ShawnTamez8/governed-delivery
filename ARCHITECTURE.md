# BuildWorks — Architecture

**Status:** Reconciled. Design, pre-implementation. Written 2026-08-28.

**System name:** Configurable; default BuildWorks.

**Purpose of this document.** This is the design, and the only source of truth
for it. Every constraint here is binding; where one looks arbitrary, the reason
is stated beside it. Companion: `docs/hazards.md`.

---

## 1. The one principle

> Agents propose. The system decides.

Multi-agent software delivery model that automates and coordinates the SDLC from requirements through release. 

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
   compatibility handling, and no version identifiers embedded in component
   names or contracts. A stable name plus a content hash is identity; nothing
   pins a version. Nothing has shipped; change the shape and delete the
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
 └── stage(n)  input_stage_id -> output_ref
      ├── agent_run(s)      what each agent saw, produced, and cost
      ├── findings          typed, identity-stable
      └── gate result       deterministic, not a reviewer's verdict
```

There is no separate artifact lifecycle to keep consistent. A spec is not
"planned"; either the plan stage produced an approved output or it did not. This
single change removes the largest source of complexity in the previous design.

**The handoff is a row, not an implicit sequence.** A stage row carries its
input's ID and the reference to its own output; stage N's `output_ref` is
literally what stage N+1 was handed. A run is then a chain you can walk, the
audit is a join, and the cost dashboard is one query.

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
dirty and the next one cannot start. The rule is simple — the system commits
everything it writes to the run branch (projections and applied patches) and
writes run state only to the ignored `.governance/` directory.

Verification commands live in a committed `governed.yaml` at the repository
root, authored by the operator before the first run. The verification stage
finds its commands there and must actually run them; a stage that cannot
verify fails closed. `governed.yaml` is never part of any run's scope.

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
- `governed.yaml`, policy, and configuration the run snapshotted;
- the audit chain and anything under `.governance/`;
- the design document that is the run's own input.

An agent that could edit its own permissions, its own input, or the record of
what it did has no meaningful boundary. Enforcement belongs in the write path,
because a prompt-level instruction is a request and this is a rule.

### Branch and worktree isolation

Delivery happens on a retained branch named `gov/<slug>/<run-id>`, in a
worktree created for the run under `.governance/worktrees/<run-id>`, never on
the default branch and never in the operator's working copy. The base commit
is recorded at run start and anchors the run's branch. A patch binds to the
head in effect when it is proposed, and re-validation at apply time refuses it
if head has moved in any path it touches since proposal. Only the system moves
the run's branch, so the only head movement a patch can see is its own run's.

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
  Re-validation at apply time refuses the patch if the branch has moved in any
  path it touches since proposal, so a patch built on a stale tree is never
  applied.
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

Derive a finding's canonical ID from the round, a normalized location, and an
`intentKey` describing what is wrong — not from its wording. Within one round,
two reviewers describing the same concern at the same location produce one
canonical finding, and each reviewer's report hangs off it as immutable
evidence carrying that reviewer's own severity, classification, and subject.

Deduplication stops at the round boundary, and that is deliberate. `intentKey`
is model-authored: a reviewer restating the same concern in a later round has
been measured to supply a different one. A later round's finding is therefore a
new canonical identity that never overwrites the earlier round's evidence. The
system deduplicates wording within a round; it does not recognize a concern as
semantically the same across rounds, and nothing may be built as though it did.

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
selectReviewers(candidates, size, requestedSpecialties, requiredSpecialties)
  -> Agent[]
```

Required specialties first, then the specialties the artifact's author
requested, then ranked relevance to fill remaining seats, with role separation
applied and no specialty seated twice. Roughly eighty lines, trivially
testable.

Panel size is configuration, resolved at run start and frozen in the profile.
Its floor is two reviewers; the configured maximum defaults to two and may be
raised to five, which requires registering the additional specialists first.
The author proposes a size inside those bounds and the system staffs it —
section 12 states the request, the seat accounting, and the refusal. A
one-reviewer panel is deliberately unavailable: one reviewer is one lens, and
the default installation should staff two distinct specialties before a lower
floor is worth designing. Risk-tiered panel sizes, including the one-reviewer
low-risk tier this document previously specified, are deferred rather than
rejected; reintroduce them only with a stated reason and a floor that still
holds.

Risk is computed once, deterministically, at intake — from the spec's
`changeKind`, the size of its declared scope, and whether it touches protected
paths. It travels into the authorization for the operator to sign. An agent
never assesses its own risk.

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
command: [claude, -p, --output-format, json, --restricted, --safe-mode, --tools, "Read,Glob,Grep", --disallowedTools, "Write,Edit,NotebookEdit,Bash,mcp__*", --permission-mode, dontAsk, --strict-mcp-config, --no-session-persistence]
probe: [claude, --version]
capabilities: [spec, plan, review, implementation]
telemetry:                  # what this harness can actually report
  perInvocationModel: true
  effectiveModel: true
  tokenUsage: true
  sessionCost: true         # a recorded real envelope carries total_cost_usd
sandbox:
  allowedPaths: [docs/features/**]   # document stages; implementation: the signed scope
  deniedPaths: [.governance/**]
  commandAllowlist: []
  idleTimeoutSeconds: 600
  absoluteTimeoutSeconds: 3600       # the separate ceiling, a multiple of the idle budget
  envPassthrough: [PATH, HOME, USERPROFILE, APPDATA, TEMP, TMP, ...]
  network: inherit
```

Capabilities and telemetry are declarations the system checks against, not
documentation. A stage requiring a capability no configured executor declares
must fail at configuration time, not at the moment it is dispatched. Allowed
paths are stage-scoped: document stages write under `docs/features/**`; the
implementation stage writes only inside the run's signed scope.

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

Enforcement starts at the invocation: proposal subprocesses run read-only
(restricted mode, an explicit read-only tool inventory, no session
persistence), and the stage asserts a clean worktree before and after the
dispatch, because a prompt-level instruction is a request and the tree is
checked, not trusted.

### Reading the result

**Parse the returned body against the shapes in "Parsing model output".** The
harness returning exit code zero says nothing about whether the body is what was
asked for.

**Take cost and model identity from the harness, never from the model.** A model
asked what it cost will answer plausibly and wrongly. Read token counts, the
effective model, and any fallback state from the harness's own structured
output or transcript, and store them on the agent run. Where the harness cannot
report something — a field absent from the envelope — record the gap
explicitly rather than substituting a zero. A zero that means "not reported" is
indistinguishable from a zero that means "free", and it will silently corrupt
every estimate built on top of it.

**Retain the raw bytes before parsing**, as "State, storage, and evidence"
requires.

## 12. Gates

A gate is deterministic. A reviewer's verdict is an input to a gate, never the
gate itself.

**`spec_review` and `plan_review`.** Persist immutable source and policy intake
first. Both reviewed artifacts run the same five phases in a fixed order: the
author drafts; the same author definition self-critiques once, in its own
dispatch, returning the revised artifact and its panel request; a complete
independent panel of specialist reviewers reports findings; the same author
definition reconciles, in its own dispatch, returning the revised artifact and
one typed decision per canonical finding; and the deterministic gate decides.
There is no closure pass — no further panel is dispatched to confirm the
author's own answers. Round counts are configuration, frozen in the profile,
and default to one. A configured round is one complete panel-and-reconciliation
cycle; self-critique happens once per artifact regardless of how many are
configured.

**The author proposes the panel; the system staffs it.** The self-critique
result carries a requested panel size within frozen bounds and a unique list of
specialties — never an agent identity. Configured required specialties consume
seats inside that size. Deterministic code selects distinct eligible reviewers
with distinct specialties from the frozen registry, excludes the author, and
refuses by name when the required-and-requested union cannot be staffed. It
never shrinks the panel and never drops a requested lens.

**Completion is a property of the decisions, not of an empty findings list.**
The gate passes when every canonical finding of every configured round carries
exactly one retained typed decision, the conditional content that disposition
requires is present and valid, and the reconciled artifact passes the same
mechanical document gates its draft did. Severity remains immutable reviewer
evidence and no longer gates these two stages: a materiality threshold deciding
completion is replaced by decision completeness.

**Where authority sits, stated exactly.** The author supplies the semantic
disposition — what a finding means and what to do about it. Deterministic code
validates, before any stage state changes: that every canonical finding carries
one decision and no decision names a finding that does not exist; that the
normative delta between the artifact before and after reconciliation is fully
accounted for; that every cited excerpt occurs textually in the governing
input; that conditional proposal content is complete where its disposition
requires it and absent where it forbids it; that the mechanical artifact gates
pass; and that the resulting route is honoured.

**`addressed` is not authority to invent an obligation.** Deterministic code
derives the normative delta by set-diffing the parsed nodes of the validated
artifact before and after reconciliation — declared artifacts and acceptance
criteria for a specification, tasks and coverage for a plan. Every added node,
including the added half of a replacement, must be claimed exactly once by an
`addressed` decision and carry an excerpt from the governing input: the design
for a specification, the approved specification for a plan. The artifact under
review is never an authority for its own content. An added node that is
unclaimed, claimed twice, or ungrounded is handled as `cannot_determine` and
blocks. Where the governing input is genuinely silent, the author's route is an
upstream disposition with a complete proposal candidate, not a new requirement.
This adds no round and no dispatch: the delta is computed from artifacts the
stage already holds.

**What these checks do not establish.** An exact match proves that the cited
words occur in the governing input, in that order. It does not prove they
logically support the rejection or the addition they are offered for. Artifact
hashes and mechanical document gates prove what changed and that the result
still parses; they do not prove the reported concern was semantically cured. No
panel independently confirms an `addressed` decision or a grounded rejection.
That residual semantic judgement is the author's, it is retained as evidence,
and it is the accepted cost of removing the closure pass. It is not a gap the
checks above close, and nothing in this system should be described as though it
were.

**`awaiting_approval`.** The only human gate. One signed authorization — an
Ed25519 signature by the operator, verified by the gate against a public key
held in machine-local configuration, never in a repository — binds feature ID,
spec content hash, starting commit, profile hash, risk, expiry, and scope. The
gate re-checks that policy has not changed since intake before honoring it.
Worker sessions cannot resolve it and never receive signing secrets.

The **profile** is the frozen record of everything the run resolved at start —
model map, limits, policy, agent definitions, verification config, review panel
bounds and round counts, and system name — stored under
`.governance/profiles/<run>/` with its hash on the run row. Policy is
the subset of the profile that gates consult; the re-check compares the
profile's policy hash against the policy in force. The **scope** the operator
signs is the set of paths and artifacts the spec declares; the gate computes
it at this stage, and the operator signs exactly that.

The **system name** is configuration, resolved at run start and frozen in the
profile, defaulting to BuildWorks. The CLI, projection headers, and
notifications read it; nothing functional depends on it.

**After approval.** One authorization covers the rest. Each patch is validated
against the signed scope and re-validated against its base commit, then applied
without a fresh human decision. A stage
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

### Deferred before the step 9 milestone

Three behaviours this section describes are deliberately not built yet. They
are recorded here rather than only in a plan, because this document is
binding and a deferral nobody can find in it is indistinguishable from an
omission. Each one blocks terminally with the cause named, and **a fresh run
is the repair for all three** — there is no in-place resume.

- **Verification remediation rounds.** `verification` fails closed on the
  first command that does not pass; the remediation budget above is not spent
  because no round loop exists. Step 9's milestone is one complete run, and a
  complete run passes verification, so a round loop is off that path.
- **Scope-fitness proposals.** A spec artifact outside the signed scope
  blocks at the gate. The delta-hash proposal above is unbuilt; widening the
  scope means a fresh approval on a fresh run.
- **The `status.md` projection.** Section 14 describes it as a projection of
  the run row. Nothing writes it, and the database is the only place a run's
  state can be read today.

These stay deferred until the deliberate stop at step 9 is lifted by an
explicit decision. Building past it is not a matter of finding time.

## 13. Conflict resolution

Reviewers produce findings. They do not vote, and the system does not need them
to agree.

**Findings deduplicate by identity, within a round.** Two reviewers raising the
same concern about the same location in the same round produce one canonical
finding, because identity derives from intent and location rather than wording.
Each reviewer's report remains a separate immutable child of that finding,
carrying its own severity, classification, and subject, so no stored value ever
pairs fields no single reviewer returned. Round is part of the identity: the
same concern in a later configured round takes a later-round identity and
cannot overwrite the earlier round's evidence.

**Identity deduplicates wording, not meaning.** `intentKey` is model-authored,
and a reviewer restating the same concern in a later round has been measured to
supply a different one. Cross-round deduplication is a convenience that
sometimes fires, never a guarantee that the system recognizes a repeated
concern. Do not build a behaviour that depends on it.

**The gate is deterministic, so consensus is not required.** A gate does not ask
whether reviewers agreed; it asks whether every canonical finding carries
exactly one retained typed decision whose conditional content is complete and
valid. Contradictory recommendations from two reviewers at the same location
are two immutable reports on one canonical finding, and the single decision
answers both without either report being rewritten. Classification determines
the location shape — `current_artifact` carries a real heading, `upstream` the
exact token — so a pair that splits one concern by classification cannot share
a canonical identity: it is two canonical findings with two decisions, and
every report reaches the same reconciliation dispatch unfused, whatever
finding it sits on. The storage layer never fabricates a one-canonical
two-mixed-classification-report row, because the report contract cannot
produce that state (operator decision, 2026-09-02).

**Nothing resolves its own finding.** The author supplies the disposition and
the artifact revision; whether that advances the run belongs to the
deterministic gate, and where the gate cannot decide, to a human. The author
reconciles by design — it is the only actor holding the context to answer a
finding about its own artifact — and the boundary that keeps this honest is
that it never decides whether its own answer suffices. A reviewer never
reconciles, and no agent approves.

**Exhausting the configured rounds blocks the run and names the findings.** A
bounded number of panel-and-reconciliation cycles, then a terminal block
identifying the canonical finding IDs still unanswered, with the branch and
worktree retained. The gate reads every configured round's decisions, not only
the last: a later round cannot clear a block an earlier round raised. An
unresolvable disagreement is a human decision, not an aggregation function, and
burning more rounds against it only spends money.

**A finding whose cause is upstream must be reportable as such, and must have
somewhere to go.** A reviewer who correctly concludes that the specification is
at fault should not be forced to express that as a defect in the plan, because
the author can then only answer by revising the wrong artifact. The result
contract says "this is valid and its cause is upstream", and reconciliation
routes it three ways: `upstream_follow_up` writes a proposal and the run
continues; `upstream_blocking` writes the proposal and blocks, because filing a
missing decision does not make the approved input implementable; and
`cannot_determine` blocks for a human and may claim no proposal. A proposal is
run state with retained evidence and is non-binding — it adds no acceptance
criterion to the current feature. No run writes into `docs/proposals/`; export
and promotion are human actions, as section 14 describes.

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
  content/<hash>    content-addressed overflow for oversized prompts and results
  profiles/<run>/   the frozen profile snapshot for a run
  verification/<run>/  retained command output, one file per command, plus the
                       structured result record handed to delivery_check
```

**What is git-tracked and what is not.** The database and raw output are
machine-local and gitignored. Migrations are committed with the system source
under `src/migrations/`, because the schema must be readable and reviewable.
Projections under `docs/features/<slug>/` are
committed, because they are what a human reviews in a diff. Agent definitions,
policy, and the design document are committed, because they are inputs that must
be reviewable and protected. Tracking an audit directory while
ignoring run state leaves the tree dirty after every run, so the next one fails
its clean-tree precondition. Decide this once and make the ignore rules match.

**Migrations are ordered plain SQL, committed with the system source under
`src/migrations/`, applied at startup.** No ORM. The schema is
small enough to read, and you will want to read it when a cost number looks
wrong.

**Multi-project.** `run.project` is the discriminator, so one database can serve
several repositories and answer "what is in flight across everything" without a
central service. If a project's runs must be portable, export rows rather than
sharing a file.

**Backup is copying one file.** A checkpoint database, and git.

### The evidence model

The idea that justifies the system to anyone outside it:

> An agent run is a record of what an agent was allowed to see and do, plus what
> it actually cost and which model actually ran.

Self-reported cost is not evidence. Read it from the harness transcript.

```sql
run(id, project, feature_id, slug, change_kind, status, profile_ref, created_at, updated_at)
stage(id, run_id, kind, ordinal, input_stage_id, output_ref, status, gate_result, started_at, ended_at)
agent_run(id, stage_id, agent, role, executor, requested_model, effective_model,
          fallback, tokens_in, tokens_out, cache_read, cache_write, cost,
          duration_ms, input_hash, output_hash, raw_output_ref, independence)
finding(id, stage_id, agent_run_id, severity, intent_key, subject, location, disposition)
approval(id, run_id, feature_id, spec_hash, starting_commit, profile_hash, risk,
         scope, expires_at, signature, signer, created_at)
audit(id, run_id, stage_id, actor, actor_type, action, summary, hash, prev_hash, created_at)
```

`run.status` is one of `in_progress`, `blocked`, `completed`; `stage.status` one
of `pending`, `in_progress`, `passed`, `blocked`, `failed`; `gate_result` one of
`pass`, `block`. A stage whose remediation budget is exhausted blocks the run.

Cost per stage, per feature, per agent, and historical estimation all fall out
of this without a separate service. Dashboards and notifications read it; they
never sit in the delivery path.

**Retain raw model output before any parser touches it**, and reference it from
`agent_run.raw_output_ref`. A rejected response whose
bytes were discarded leaves only a truncated fragment in an error message.
Retained bytes are how diagnosis becomes possible instead of guesswork, and they
are the raw material for the contract tests in the verification section.

**An invocation that produces no envelope records no `agent_run` row.** A
timeout or a non-zero exit leaves its audit event and retained raw output as
the record — the spend is visible, the row is honest by absence. Until a
status column is designed into the schema, do not insert a row pretending an
outcome that never arrived.

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
and into any transcript it produces. This applies to verification commands as
well as to agent sessions: a verification command is code the implementer
wrote, and full inheritance would put the approval public key inside its
reach.

**Verification commands are not otherwise contained, and that is a stated
limitation rather than a claim.** They run with the run's worktree as their
working directory, but nothing stops one from reading or writing elsewhere on
the filesystem — `.governance/` is reachable by relative path — or from
reaching the network, which is `inherit` for the executor too. The system has
no sandboxing mechanism to apply here. Treat the named passthrough as the only
containment that exists today, and see `docs/proposals/` for the options.

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
per-row revision counter for content writes — a counter, not a schema version.
Audit appends serialize under the database's single-writer lock, never the
repository lock: one database serves several repositories, so a SQLite busy
timeout with a bounded retry keeps a cross-project append waiting instead of
failing.

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
  content-addressed file under `.governance/content/<hash>` that the
  invocation references — rather than being cut. If it cannot be delivered
  intact, refuse the invocation.
- **Result size.** Cap it, refuse above the cap, and retain the raw bytes anyway
  so the refusal is diagnosable. **Retention is bounded too, by a separate and
  much larger ceiling.** "Retain the bytes anyway" is a rule about a bounded
  result; against a stream that never ends it is a full disk, and a full disk
  takes the run store and the audit chain with it. A verification command
  writing to a pipe was measured at roughly a gigabyte a second, which is
  hundreds of gigabytes inside its own time ceiling. On breach the command is
  killed; the result was already refused by the result cap, so nothing is lost
  but the flood.
- **Concurrency.** One writer per repository, enforced by a lock. A second
  invocation fails fast with a clear diagnostic rather than interleaving writes.
- **Review rounds.** A bounded budget per reviewed stage, set in configuration
  and frozen in the profile — one round by default, configurable higher. A
  round is one complete panel-and-reconciliation cycle; there is no closure
  pass, and the count is unrelated to panel size. Exhausting the budget blocks;
  it does not silently accept.
- **Verification retries.** No limit is in force, because there is no round
  loop: the first verification command that does not pass blocks the run.
  Adding retries later means adding a limit of its own, frozen in the profile
  like every other value here — not borrowing the review budget above.
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
lines gets most of the value. Prose goes stale; a checker does not. Give it
one more assertion: every table the design prose names exists in the schema
block.

## 22. Known hazards

`docs/hazards.md` states fifteen failure modes this kind of system is subject
to and what each requires. They are requirements, not an appendix: model output
in shapes the schema refuses, discarded output being undiagnosable, constrained
fields whose constraint the prompt never states, fixtures and code agreeing
while both are wrong, completion without delivery, promises a later stage cannot
keep, retries that vary nothing, executable resolution, unverified hook
interpreters, exact-match model acceptance against moving aliases, a default
install that cannot complete a run, configuration divergence between targets,
specifications inventing obligations, independence that cannot be proven, and
proposal subprocesses that are requested rather than enforced to be read-only.

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
