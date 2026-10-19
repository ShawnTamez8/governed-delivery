# Rework BuildWorks around a sandboxed implementer and executable evidence

**Date:** 2026-10-18

**Status:** Proposal — non-binding. Nothing here is authorized. Each part names
the operator decision it needs, and several reverse binding text in
`ARCHITECTURE.md`.

**Hazards considered:** all twenty-four entries in `docs/hazards.md` were weighed;
the mapping is in "Hazard coverage" below. The entries that most constrain the
proposal: 1 (patch content escaped inside JSON is a recurring failure class that
change 1 removes for implementation), 3 (every prompt-stated constraint that a
schema could enforce instead is a candidate for change 5), 7 (resume in change 8
must not become a retry that varies nothing), 15 (change 1 replaces its
read-only-implementer requirement and must prove a stronger boundary in its
place), 18 (change 4 is the first objective correctness signal), 20 (change 1
removes the response-size limit that phases exist to work around), 21 (change 1
lets the implementer run the commands that judge it), and 24 (change 2 removes
lockfiles from the set of files a model must author).

## What this is

On 2026-10-18 the operator asked for a proposal to rework BuildWorks along ten
lines suggested after crew-chatter run 4, with effort, risk, and an answer to one
question: do we lose governance? The short answer is no, provided changes 1 and 4
are built with their containment proven by breaking it. Several guarantees get
stronger, and one stated limitation in section 17, uncontained verification,
closes. The section "Governance: kept, changed, lost" gives the details.

The operator answered four questions the same day, and the proposal is revised
to match:

- Every developer who would run BuildWorks has Docker Desktop with WSL 2, and
  Windows Sandbox. Docker is the first option.
- Each developer holds their own Claude Code Enterprise seat. No credential
  belongs to BuildWorks itself.
- BuildWorks runs on the operator's own workstation.
- Docker, WSL and Claude Code must be replaceable or upgradeable in a future
  BuildWorks version without breaking the rest of it. This means between
  releases, never during a run: no run starts on one version of a dependency
  and finishes on another.

This document is a backlog proposal, not a plan. Implementation of any part needs
an operator decision recorded in `ARCHITECTURE.md` section 23, and a plan under
`docs/features/`. Work happens on the `sandboxed-delivery` branch, cut from
`dashboard-restyling` on 2026-10-18.

## The evidence that prompted it

- **Crew-chatter run 3 (2026-10-17)** passed spec, plan, implementation and
  verification, then blocked at `code_review` with `code_review.artifact.missing`
  for both workspace `package.json` files and `package-lock.json`. The spec had
  declared them conditionally, and the plan chose no new dependencies. Run total
  $3.43547941. Recorded in
  `test/fixtures/recorded/plan-crew-chatter-run-3-declared-artifacts-untasked.json`;
  fixed at the plan gate by `docs/features/declared-artifacts-in-tasks/plan.md`
  (hazard 24).
- **Crew-chatter run 4 (2026-10-18)**, a fresh run on the same design under that
  fix, reached the `spec_decision` pause for $1.7754115. Its spec no longer
  declared the package files conditionally. Instead it chose a dependency the
  design never named: "`frontend/package.json` adds exactly `@tiptap/react`,
  `@tiptap/pm`, `@tiptap/starter-kit` and `@tiptap/extension-list`, each at `^3`
  ... `package-lock.json` is regenerated with `npm install` at the repository root
  so that `npm ci` installs exactly these packages." The implementer runs with
  Read, Glob and Grep only (section 11), so it cannot run `npm install`. It would
  have to author a lockfile entry for TipTap and its ProseMirror tree by hand, and
  the frozen `npm ci` would very likely refuse the result at verification, after
  the plan and every phase had been paid for. That is an inference, not a measured
  outcome. The operator stopped the run at the decision pause.
- **The same open question was routed two ways.** Reset-token delivery (OD-001)
  was routed `upstream_follow_up` in run 3 and `upstream_blocking` in run 4, with
  the same design and the same reconcile prompt. That is the gap
  `docs/proposals/spec-review-severity-nondeterminism.md` named on note-keeper.
- **Crew-chatter run 6** blocked at code review round 2; every round-2 high traced
  to an obligation remediation introduced
  (`test/fixtures/recorded/code-review-crew-chatter-run-6.json`, hazard 23).
- **Crew-chatter run 2** stranded $9.63 when the usage window closed during phase
  6 (`test/fixtures/recorded/crew-chatter-run-2-session-limit-refusal.json`).

## The common cause

In each case a model made a promise in prose: a file it would change, a lockfile
it would produce, how blocking a question is, a defect that must be fixed. That
promise was checked by deterministic machinery only later, after the spend.
BuildWorks has answered each instance with a validator and a sentence of prompt
text. That works, and the hazards record shows it working, but it adds one rule
per incident and never removes a class.

The rework applies one principle more consistently than today: **models make
judgments, the harness owns everything deterministic, and authority is exercised
at the boundary with executable evidence.** This is the existing first principle
of section 1, "Agents propose. The system decides.", applied to execution and to
evidence as well as to state.

## Governance: kept, changed, lost

### Kept unchanged

- One mutation authority: the CLI and its core functions; the two dashboard
  writes stay as they are.
- The signed scope and the approval signature, made outside the host's authority.
- The frozen profile (hard rule 6) and the audit chain.
- Patch-scope enforcement at apply time. Under change 1 it applies to the diff
  the harness computes instead of to the paths a model listed in JSON.
- Harness-run verification. Verification is still executed by BuildWorks, never
  by the agent, and its result is what gates.
- Deterministic gates and the one-writer lock.

### Strengthened

- **Verification containment.** Section 17 states that verification commands
  are not contained, and `docs/proposals/verification-containment.md` records it
  as open. The container change 1 needs is that containment, so implementer
  commands and verification commands both run inside a bounded filesystem,
  network and CPU envelope. Today neither does.
- **Every command the implementer runs passes through BuildWorks** (change 1's
  tool server), so each one is recorded in the run and can be refused. Today the
  implementer runs none, and verification commands are not individually recorded
  beyond their result.
- **Derived files** (change 2) gain a deterministic, audited author in place of a
  model.
- **Routing** (change 6) becomes a frozen, reviewable policy over typed fields
  instead of a model judgment that can differ between runs.
- **Blocking findings** (change 7) require evidence that the harness checks, not
  a reviewer's claim.
- **Correctness** (change 4) gets an objective signal for the first time. Today
  the frozen commands can be as weak as `node --version` (hazard 18).

### Changed, with a stated cost

- **Hazard 15's mechanism is replaced, not kept.** Today the implementer is
  read-only at the invocation boundary, and the stage asserts a clean worktree
  before and after it runs (`docs/features/step6-trust-boundary/plan.md`). Under
  change 1 the implementer still has no built-in write or shell tool. It writes
  and executes only through BuildWorks' own tools, and those act inside a
  disposable container. The guarantee becomes: nothing reaches the run branch
  except a diff the harness computes and checks against the signed scope and
  protected paths. That is a stronger statement only if the container is proven
  by breaking it. A sandbox that has been declared but never broken is exactly
  what hazard 15 warns about.
- **Trust boundary "run commands outside an explicit allowlist"** (section 6)
  becomes "run commands outside the container, and only through BuildWorks'
  tool server". The allowlist moves from a tool inventory to an environment
  boundary.
- **The prompt is no longer the agent's whole input.** The implementer sees
  command output it produced. Every tool call and its result is retained under
  the existing retention ceiling, so the input remains inspectable after the
  fact rather than before it.

### What would genuinely be lost if this is built badly

- **Credentials inside the container.** An earlier draft of this proposal ran
  the `claude` process inside the container, which put the operator's
  credentials where `npm install` runs package lifecycle scripts. The revised
  change 1 keeps `claude` on the host, so the credential never enters the
  container by construction. The rule that must hold: nothing that reaches the
  container's environment, mounts or network carries a provider credential, and
  the spike proves it.
- **Resume as a back door for retries.** Change 8 must not let a failed
  model-judged step be re-run until it passes. Hazard 7 and section 19 exist for
  that reason.
- **A compatibility layer.** Change 5 replaces document shapes. Hard rule 3
  forbids carrying both; recorded fixtures for the old shapes are retired, not
  adapted.

## Each dependency confined to one module

The operator requires that a future BuildWorks version can upgrade or replace
Docker, WSL or Claude Code without breaking the rest of the system. That is a
constraint on where each dependency may appear, not a request for configurable
components, and it fits hard rule 4: one concrete module per dependency, with no
interface above it until a second implementation exists.

- **Docker** is called by exactly one new module. That module starts the
  container, mounts the run's worktree, runs a command, enforces the limits, and
  tears down. It invokes only the `docker` command-line interface and uses no
  feature specific to Docker Desktop, so the same module works against any Docker
  engine. Nothing else in BuildWorks knows a container exists.
- **WSL** is never invoked by BuildWorks. It is Docker Desktop's backend on
  Windows and stays inside Docker Desktop.
- **Claude Code** stays where it is today, in `src/harness.ts` and
  `src/executor.ts`. Its flags, its stream format, its structured output and its
  sign-in do not leak into stages, gates or the tool server. Provider selection
  and credentials reach it only through the named environment passthrough, so
  BuildWorks never hard-codes how Claude Code authenticates.
- **The tool server** is BuildWorks' own code over MCP, and it serves any agent,
  not only Claude Code. "The tool server serves any agent" below states the
  rules.
- **Versions are recorded, not chosen.** Each run records the `claude --version`
  it probed and the container image digest it used, as evidence of what ran.
- **Upgrades are gated by the benchmark.** A BuildWorks release that changes the
  Claude Code version, the image or the Docker requirement passes replay and a
  benchmark sweep (change 9) before operators receive it.

Replacing Docker with another container engine, or upgrading any of the three,
is then a change to one module. Adding or replacing an agent is a larger change,
bounded by the next section.

### The tool server serves any agent; Claude Code stays an adapter

The operator requires (2026-10-18) that any coding agent or harness can use the
tool server, not only Claude Code, and that Claude Code remains an adapter inside
BuildWorks. Both are requirements on this rework, not later work, because the
rework is where Claude-specific assumptions could otherwise enter the execution
path.

**The tool server is agent-neutral.**

- Its contract is plain MCP: a stdio server whose tools are defined by
  BuildWorks. It uses no Claude Code feature, tool name or convention, and it
  does not inspect which client is calling.
- Its rules are enforced by the server itself: every call is checked against the
  run's container and limits, recorded before it executes, and refused by name
  when it falls outside them. No rule depends on the client asking politely.
- It acts only inside one run's container, under a credential BuildWorks issues
  for that run, and it never touches run state. It cannot advance a stage,
  record a gate or write the store. Hard rule 2's single mutation authority is
  unchanged: the tool server is an execution surface inside a run, not a second
  way to drive BuildWorks.

**Governance does not depend on which agent ran.** The checks that decide the
outcome are BuildWorks' own and run after the agent exits, whoever the agent was:
the diff against the signed scope, protected paths, harness-run verification,
the gates and the audit chain. An agent BuildWorks has never seen still cannot
put a file outside scope on the run branch or pass a gate it failed.

**One guarantee does depend on the agent: that it is confined to the tool
server.** With Claude Code that is done by its flags (built-in Bash, Write and
Edit disallowed, only BuildWorks' MCP server admitted). Another agent may have
its own shell, file tools, MCP servers or network access that cannot be switched
off the same way. The 2026-09-03 review
(`docs/proposals/2026-09-03-multi-harness-adapter-blast-radius-review.md`,
finding MHA-02) already set the rule for this: before an agent is registered,
a discovery run must *attempt* each forbidden action and fail, not merely avoid
it. An agent that cannot be confined has two honest outcomes:

- BuildWorks runs the agent itself inside a container whose only reachable
  service is the tool server, so the confinement no longer depends on the agent;
- or the architecture states the weaker guarantee for that agent, and the run
  record labels it, as section 6 does for `unverified_self_attestation`.

Copying a confinement declaration onto an agent that does not enforce it is not
an option.

**Claude Code remains one concrete adapter.** This is what section 11 already
says, "There is one adapter, concrete, with no interface above it until a second
harness exists", and the rework keeps it:

- Claude-specific invocation, flags, stream parsing, cost telemetry, structured
  output and sign-in stay inside `src/harness.ts` and `src/executor.ts`.
- Stages see only the normalized result the adapter returns.
- Every change in this proposal is accepted only if it adds no Claude-specific
  assumption outside the adapter. Each plan that implements a change says how it
  meets that.

The interface above the adapter is extracted when a second agent is actually
added, as hard rule 4 requires and as finding MHA-03 of the same review sketches
(build an invocation from the frozen definition, parse retained bytes into the
one normalized envelope, a static registry keyed by the frozen executor ID).
Extracting it earlier would be an abstraction with one implementation. Adding the
second agent needs the section 11 amendment that review names.

## The ten changes

Effort is stated in engineer-weeks for one developer working with Claude at the
pace of this repository so far (about 21,700 lines of `src/` and 41,000 of tests
across 121 commits since 2026-08-28). These are estimates, not measurements.
Paid validation is listed separately, because a completed paid run never
authorizes another.

### 1. A sandboxed implementer, governed at the boundary

**What.** Implementation phases, the self-review and code-review remediation
keep running the `claude` command-line interface on the host, under the
operator's own sign-in, exactly as today. They gain one MCP server, BuildWorks'
own, and nothing else:

- The built-in Bash, Write and Edit tools stay disallowed.
- `--strict-mcp-config` admits only BuildWorks' tool server, allowed with
  `--allowedTools "mcp__<server>__*"`.
- The tool server's tools (run a command, write a file, read a file, list files)
  act inside a disposable Linux container. The only host path mounted is the
  run's worktree.
- The container's network is limited to the package registry. It needs no
  provider endpoint, because the model is called from the host.
- CPU, memory and per-command time limits are frozen in the profile.

On exit the harness computes the diff against the phase base, checks it against
the signed scope and protected paths, commits it, and then runs the frozen
verification commands itself in a fresh container. The agent's own test runs are
advisory; the harness run gates.

The flags exist as documented
(https://code.claude.com/docs/en/cli-reference.md,
https://code.claude.com/docs/en/permissions.md). Their combined effect in a `-p`
session has not been run, so the spike tests it first.

**What it removes.**

- Patch content escaped inside JSON (hazard 1's remaining patch shapes, and items
  10 and 11).
- The response-size limit behind phases (hazard 20) stops being the reason a
  phase is ten tasks.
- "Write an `add` for a file that exists" and "drop an unchanged `modify`" stop
  being failure modes.
- The implementer can run `npm install`, the typecheck and the build, and see
  failures before returning (hazard 21).
- Run 4's lockfile problem disappears for the implementer, and change 2 removes
  it for everyone else.

**Design notes.**

- One concrete image, built from a Dockerfile committed in BuildWorks and pinned
  by digest: Node, npm and Git at pinned versions. It does not contain Claude
  Code, so upgrading Claude Code never rebuilds the image, and rebuilding the
  image never touches Claude Code. This is not a target-stack adapter framework
  (section 24); it is one image for the one ecosystem in use, and hard rule 4
  applies before a second exists.
- Structured output is retained for the reply. The agent returns a typed summary
  (what it changed and why, any task it could not complete), not file contents.
  The diff is computed, never reported.
- A per-dispatch budget (turn ceiling and a cost ceiling read from the stream)
  joins the frozen limits, because an agent that can run commands can loop.
- Every tool call is recorded by the tool server before it executes, and the
  transcript is retained before parsing, as section 11 requires today.

**The container runtime.** Docker Desktop with the WSL 2 backend is the first
option; every developer who would run BuildWorks has it. Windows Sandbox is also
available on every developer workstation, and was considered as the second
option:

- It is a disposable Windows virtual machine, not a Linux container.
- It has no image format, so the toolchain would be installed on every launch
  (inference; unmeasured).
- It is configured by a sandbox definition file rather than driven like a
  container engine. Whether its command-line control and concurrency suit one
  container per command is not established.

It is not built unless Docker fails the spike.

**Effort.** 4–6 weeks, including the spike. The tool server is about a week of
that, and it replaces the work an earlier draft spent on running Claude Code
inside the container. Paid validation: two to four full runs at an expected
$3–8 each, because an agentic phase uses more tokens than a one-shot patch
(inference; unmeasured).

**Risk.** Medium to high.

- **Cost per phase** rises by an unmeasured factor.
- **Nondeterminism moves.** The agent's path through the code varies more than a
  one-shot reply.
- **Docker Desktop on the workstation** brings file-sharing performance and
  line-ending differences between Windows and the Linux container that the
  current host-only verification never meets.
- **Licensing**, under "Open questions" below.

**Spike before any build (about one week, small paid budget).** Exit criteria,
each proven by manufacturing the failure:

- A `-p` session with the flags above can call the tool server's tools and
  cannot call Bash, Write or Edit.
- A command inside the container cannot read the host's `.governance/`, the user
  profile, the approval public key or any Claude Code credential.
- The container's environment carries no provider credential.
- A request to a host outside the allowlist fails.
- A diff touching a protected path is refused at the boundary.
- A runaway command is killed at the frozen ceiling.
- One crew-chatter phase completes with the lockfile regenerated.

If any criterion fails, stop and report rather than adjusting the criterion.

Spike run 2026-10-19 in `docs/features/sandboxed-implementer-spike/plan.md`, at a cost of $0.25. Every criterion passed, with two operator-approved amendments. The first: `--safe-mode` discards the tool server, so the command drops it, and `--restricted` alone keeps `CLAUDE.md` files out. The second: `PWD` is a container runtime default. The plan's spike record lists the findings the build must answer.

**Decisions needed.** A section 23 entry replacing hazard 15's mechanism and
section 11's tool inventory for the three patch dispatches; a section 6 trust
boundary rewrite.

### 2. Derived artifacts belong to the harness

**What.** The operator declares derived files and the command that produces them
in `governed.yaml`, for example the lockfile and an
`npm install --package-lock-only --ignore-scripts` command. Models never author
those paths: they are refused in a patch, excluded from the spec's declared
artifacts, and regenerated by the harness after every phase that changed an
authored manifest. The regeneration is its own audited event and commit.

**Why now.** It fixes run 4's failure class without change 1, at today's
containment level. Verification already runs `npm ci` on the host with network
inherited, so a lockfile-only install adds no new exposure, and
`--ignore-scripts` runs less third-party code than `npm ci` does. Under change 1
the regeneration moves into the container with everything else.

**Effort.** 1 week. Paid validation: one crew-chatter feature-1 run.

**Risk.** Low to medium.

- Registry state is time-dependent, so two regenerations can differ. The
  committed result is the record, and the frozen `npm ci` checks it.
- The operator declares the command and the system does not detect the
  ecosystem. This respects the stance in
  `docs/proposals/toolchain-probe-and-stack-intent.md`.

**Decision needed.** A section 23 entry; an addition to the repository contract
in section 7.

### 3. A capability manifest, declared and probed at run start

**What.** `new-run` freezes a statement of what the run's environment can do:
whether the implementer can execute commands, whether package installation and
network are available, the toolchain versions, and the derived-file rules from
change 2. The probe half is mechanism 2 of
`docs/proposals/toolchain-probe-and-stack-intent.md`: operator-declared probe
commands run once in a throwaway worktree, and a failing probe refuses the run
at $0. The manifest is rendered into every author prompt as a constraint, and
once documents are typed (change 5) a plan step that needs an absent capability
is refused by field, not by prose matching.

**Effort.** 1–2 weeks; less if the toolchain-probe proposal is built first.

**Risk.** Low.

- Without change 5, the plan-side check is a prompt constraint plus a narrow
  validator (hazard 3).
- The operator declares; nothing is auto-detected. That is a deliberate limit,
  not a gap.

**Decision needed.** The six open decisions already recorded in the
toolchain-probe proposal, plus the capability fields.

### 4. Acceptance criteria become executable before implementation

**What.** After approval, a test-authoring step writes one or more tests per
acceptance criterion. The harness commits them to the run branch, runs them at
the starting commit, and requires each to **fail** there. Each test is then a
protected path that the implementer may not modify. Verification adds the
acceptance-test command, and the run passes only when every test passes on the
final commit. Reviewers judge whether each test captures its criterion. That is
a narrower question than "is the code correct", and they can answer it more
reliably.

**What it removes.** The weakest point in the record: a run can complete while
its frozen commands check only `node --version` (hazard 18). It automates
"prove a guard by breaking what it guards" at the level of the product. Deleted
criteria lose their test visibly (hazard 17).

**Effort.** 3–4 weeks. Paid validation: two runs, one per starter type.

**Risk.** Medium to high.

- Model-written tests can be wrong or too weak. Requiring them to fail on the
  baseline catches vacuous tests but not wrong ones, so test review stays.
- UI criteria need a browser or DOM test toolchain, which raises image size and
  flakiness.
- **The "must fail on the baseline" rule must coexist with the brownfield rule
  that existing commands pass on the baseline** in the toolchain-probe proposal.
  The two apply to different command sets, but the interaction needs to be
  written down.

**Decisions needed.** Lifting the deferred `test_authoring` stage in section 5;
whether the test author is a distinct agent with its own frozen setting (it
should be, for independence from the implementer).

### 5. Typed documents, rendered to markdown

**What.** Spec and plan authors return JSON under a schema through
`--json-schema`, as the patch dispatches already do
(`docs/features/structured-patch-output/plan.md`). The markdown in
`docs/features/<slug>/` becomes a rendering, not the source. Open decisions,
declared artifacts, acceptance criteria and tasks are typed arrays with stable
IDs, and a task names its artifacts by ID. The section-membership failures (runs
2 and 3, hazard 3), OD lines outside their section, and fence and escape shapes
for documents become unproduceable, not merely detectable.

**Effort.** 3–4 weeks. It touches `src/spec-doc.ts`, `src/plan-doc.ts`, the
prompts, reconciliation's normative delta, the dashboard, and every recorded
document fixture. Paid validation: two to three runs, plus re-recording fixtures
(hard rule 5).

**Risk.** Medium.

- Large structured outputs are untested: run 4's spec authors produced about
  64,000 output tokens across three calls.
- Re-recording every document fixture is real spend.
- Reconciliation's prose diffing must be rewritten as a structural diff.

**Decision needed.** A section 8 and section 23 entry. Under hard rule 3 the
markdown parsers are deleted, not kept beside the new shape.

### 6. Models classify; a frozen policy decides the route

**What.** The spec and plan reconcilers stop choosing between
`upstream_follow_up` and `upstream_blocking`. They emit structural features for
each finding: severity, whether it is a disclosed open decision, whether it
changes an external interface, whether it adds a runtime dependency, and whether
the spec text can settle it. A small policy in `src/policy.ts`, frozen in the
profile, maps those features to a route. For example, a high-severity disclosed
open decision always pauses for the operator. The policy is unit-tested against
recorded cases, including run 3's and run 4's OD-001.

The features must be structural, not topic lists:
`docs/proposals/spec-review-severity-nondeterminism.md` rejected deterministic
escalation by security category, and that rejection stands.

**Effort.** 1 week. Paid validation: none required beyond the next ordinary run;
recorded reconciler outputs can be replayed.

**Risk.** Low. The model still judges the features, so variance moves from the
route to a feature. That is narrower and easier to measure with change 9.

**Decision needed.** A section 12 entry naming the policy and its values.

### 7. A blocking finding carries evidence the harness checks

**What.** A code reviewer that wants a finding to block must attach a repro: a
test file and command, or a command alone. The harness applies the repro in a
scratch copy of the reviewed commit, inside the container, and runs it.

- If it fails as claimed, the finding is confirmed and may block.
- If it passes, or there is no repro, the finding is recorded as advisory.

Findings that cannot be expressed as an executable check, such as some security
design findings, keep today's path through the code-review reconciler, with
grounding required.

**What it removes.** Remediation driven by plausible but unverified findings,
which is where run 6's out-of-spec obligations entered (hazard 23). It lets
cheap, wide reviewer panels run without a false positive costing a remediation
round.

**Effort.** 2–3 weeks; depends on change 1's container for safe execution of
reviewer-written code.

**Risk.** Medium. Recall can drop if real defects are hard to reproduce. Measure
it with change 9 against the recorded run-6 findings before adopting.

**Decision needed.** A change to the code-review operating contract in
`CLAUDE.md` and section 12; the code-review authorization of 2026-09-04 covers
the stage, not this evidence rule.

### 8. Fail early, and resume from the last good state

**What, in three parts that can be decided separately.**

1. **Per-phase verification.** The frozen commands run after every phase, not
   only once at the end. A phase that breaks the build blocks at that phase,
   before the next is paid for. This needs no reversal of section 19, because a
   failure still blocks.
2. **Quota preflight.** Before a paid range starts, check the provider's usage
   window and refuse a range that cannot finish. Whether the CLI exposes the
   usage window before a call is unknown; recorded refusals carry a
   `rate_limit_event`, and `docs/proposals/usage-limit-refusal-strands-a-run.md`
   option D sketches the threshold form.
3. **Resume.** A new invocation may continue a blocked run from its last intact,
   verified boundary when the cause is in a closed list (a usage-limit refusal,
   or an unrepairable reply with a varied prompt), with checks that the head,
   tree, profile and plan hashes are unchanged. This is the design already
   reconciled in `docs/features/implementation-segments-and-pause/plan.md`
   (Shelved) and `docs/proposals/build-in-segments-and-continue.md`.

**Effort.** Part 1: under 1 week. Part 2: 1 week, depending on the unknown.
Part 3: 2–3 weeks, mostly already designed.

**Risk.** Part 1: low; it adds verification time per phase. Part 3: medium; it
needs the written hazard 7 exception and must not widen into general retry.

**Decisions needed.** Part 1: a section 12 entry only. Part 3: reversal of the
section 19 sentence "No general mid-stage recovery" for the named causes, and of
section 20's "a failed phase blocks the run and is not retried", which is
decision 1 of the shelved plan.

### 9. Whole-run replay and a benchmark suite

**What, in two parts.**

- **Replay.** A replay executor returns the retained response for each
  dispatch, so a change to a validator, gate, policy or rendering can run
  against retained runs at no provider cost. **Revised 2026-10-18 after
  grounding** (`docs/features/derived-artifacts-and-dependency-policy/plan.md`,
  "Change 9 is not in this plan"): this draft said each dispatch's `input_hash`
  is the key, and that holds only until a run's first commit. `input_hash` is
  `sha256(prompt)`, and the prompt is not retained. System commit SHAs differ in
  every run, because commit dates are not pinned and commit messages carry the
  run ID, and the implementation, review and remediation prompts embed those
  SHAs. A recorded patch's `baseCommit` must equal the live head. Store-wide
  finding IDs are embedded in the reconcile, fold and remediation prompts. Whole-run replay
  therefore needs its own design, now written in
  `docs/proposals/whole-run-replay.md` (about 2.5–3.5 weeks), and an operator
  decision. A changed prompt still cannot be replayed, so replay tests the
  deterministic system around the models, not the models.
- **Benchmark.** A fixed set of designs is run with repeats per release:
  web-calculator, crew-chatter feature 1, one design that adds a dependency, and
  one design with a disclosed open decision. The report gives pass rate, the
  stage of each block, and the cost distribution. A fix becomes a hypothesis
  tested across the suite, not on one paid run that may hit a different failure,
  as run 4 did. The same sweep is the release gate for a dependency upgrade.

**Effort.** Replay: 1.5–2 weeks. Benchmark harness: 1 week, built on
`.claude/skills/run-buildworks/driver.mjs`.

Ongoing spend: about $40–120 per sweep at four designs times three repeats,
using the observed $1.39–$9.63 per-run range. That is an estimate, and each sweep
needs its own authorization.

**Risk.** Low. Retained runs live under machine-local `.governance/raw/`, so a
replay corpus must be extracted into `test/fixtures/recorded/` to be durable.
Section 15 and the "recorded evidence" rule in `CLAUDE.md` already require that.

**Decision needed.** None for replay (it is test infrastructure under hard rule
5). The benchmark needs a standing budget decision.

### 10. Dependency policy as code

**What.** The harness compares dependency manifests between the starting commit
and the spec's declared intent, and after implementation against the actual
diff. A new runtime dependency is a typed operator decision raised through the
existing `spec_decision` path, optionally checked against an operator-maintained
allowlist (name, licence). A dependency added during implementation that the
spec did not declare is refused at the boundary. Run 4's TipTap choice would
have surfaced as a question at spec review, not as a fact inside the spec.

**Effort.** 1 week for npm only.

**Risk.** Low. One ecosystem is concrete under hard rule 4. A second ecosystem
waits for a second real target.

**Decision needed.** A section 12 entry; whether the allowlist exists at first or
every new dependency simply asks.

## Decision-1's place in the rework

The operator asked on 2026-10-18 whether running Decision-1 after each
self-critique would add value. The answer is: at specific self-critiques, as
narrow checks, each proven on labelled cases first; not as a blanket step after
every self-critique.

**What the record shows.** Decision-1 has done well on narrow format questions
and badly on judgment:

- **Narration (adopted).** Offline it caught 3 of 3 recorded remarks and flagged 0
  of 128 clean criteria at the threshold 0.8
  (`test/fixtures/recorded/systemone-format-checks-evaluation.json`). Live, it has
  answered about 140 criteria across crew-chatter runs 1, 3 and 4 and the
  2026-10-17 web-calculator run and flagged none. That is correct for clean
  specifications, but no live catch is recorded yet.
- **Grounding (not adopted).** It caught every unsupported citation but also
  flagged two supported rejections, and its repeats spread 0.038.
- **D6 (failed).** Two choices among recorded locations were wrong, and ten
  identical requests ranged 0.687–0.922
  (`test/fixtures/recorded/systemone-d6-evaluation-crew-chatter-run-6.json`).

Cost and latency are not the constraint: 172 requests cost $0.001632. The
constraint is false positives, because a flagged entry becomes a finding the
reconciler acts on.

**Rules for any new Decision-1 check.**

- Use it only where no deterministic check can settle the question. Dependency
  changes are settled by comparing manifests (change 10) and declared artifacts
  by `tasksNameScope`; a classifier adds variance there and nothing else.
- Use it only for narrow, format-like questions. Questions of judgment, such as
  whether a specification invented a decision the design never made, are the
  grounding question that failed.
- Each check needs a labelled case set drawn from recorded output, labels fixed
  before any answer is seen, an evaluation that passes at a threshold chosen in
  advance, and its own section 23 decision. The 2026-10-17 narration decision
  explicitly does not authorize "a Decision-1 call at any other stage".
- The implementation self-review judges code, not document format, and gets no
  Decision-1 check.

**Candidate: open questions written as prose in the spec self-critique.** The
fix in `561ce9e` refuses an `OD-` line outside `## Open decisions`, but an open
question written as plain prose under another heading still passes. Crew-chatter
run 2's draft did exactly that, and the draft is recorded in
`test/fixtures/recorded/spec-crew-chatter-run-2-open-questions-outside-section.json`.
"Is this sentence an open question?" is the same kind of question as the
narration check. This is a separate small candidate, about the size of the
narration work in `docs/features/narration-check-spec-review/plan.md`. It is not
an eleventh ranked change, and it is independent of the rework.

**Effect on the ten changes.**

- **Change 6** gains an option: Decision-1 could answer some of the structural
  questions the policy reads (is this a disclosed open decision, does it change
  an external interface), with a probability and a frozen threshold. That keeps
  the proposal's separation, a model classifies and a policy decides. D6's
  variance is a warning, so this option needs its own evaluation and is not
  assumed by change 6.
- **Change 9** must record and replay Decision-1 answers as well as Claude
  dispatches. They are already recorded as `agent_run` rows with executor
  `systemone` and their responses are retained, so this is a requirement on the
  replay executor, not new design.
- **Change 5** narrows what Decision-1 is for. Typed documents make shape errors
  unproduceable, but prose-level questions such as narration and open questions
  in prose remain.
- **Confinement** already holds. Decision-1 is confined to `src/systemone.ts` and
  `src/narration-check.ts` and configured by the operator's environment, which
  is the one-module rule above.

## Ranking, and the minimum to complete a run

The changes are numbered in the order they were first suggested, not by
importance. The operator's stated expectation on 2026-10-18 is that all ten are
wanted. Even so, each is authorized and built separately, and a benchmark result
decides the next, because two of them may need revision once measured: change 7
could lower reviewer recall, and change 5 is costly for failures that validators
already catch.

### The minimum to complete a run

BuildWorks already completes runs on the web-calculator design (2026-10-15 and
2026-10-17). The gap is the larger crew-chatter design, and most of its recorded
blocks are already fixed:

| Crew-chatter block | Status |
|---|---|
| Run 2: an open decision listed outside its section | Fixed by `561ce9e` |
| Run 3: declared files that no task changes | Fixed by `7446cd0` |
| Run 3 (earlier): malformed JSON in phase 2 | Fixed by structured patch output (2026-10-14) |
| Run 6: round 2 blocked on obligations remediation introduced | Partly addressed by the code-review reconciler (2026-10-13) |
| Run 4: the spec adds TipTap and needs a lockfile the implementer cannot produce | Open |

Run 3 also showed that this feature can pass implementation and verification
when it adds no dependency. Only change 2 is therefore strictly required to take
crew-chatter feature 1 through a run. Change 10 belongs with it, so that adding
TipTap is the operator's choice and not a fact inside the spec. Neither
guarantees completion: a new block can still surface later in the chain, most
likely at code review. But together they close the one failure known in advance.

### Ranked by value for the effort

| Rank | Change | Why it sits here |
|---|---|---|
| 1 | 2 Derived artifacts owned by the harness | Removes the one known blocker; about 1 week |
| 2 | 9 Replay, with the benchmark after it | Every later fix is tested against retained runs at no provider cost, instead of a paid run each. Revised 2026-10-18: needs its own design first (see change 9), and cannot replay a changed prompt, so it does not validate changes 2 and 10 |
| 3 | 10 Dependency policy | Puts dependency choices with the operator; about 1 week |
| 4 | 8 part 1 Per-phase verification | A failure costs one phase, not the whole implementation |
| 5 | 6 Routing by frozen policy | The same facts produce the same pause; small |
| 6 | 1 Sandboxed implementer | The largest long-term gain and the foundation for 4 and 7, but 4–6 weeks and a trust-boundary decision |
| 7 | 4 Executable acceptance criteria | The largest correctness gain; needs 1 |
| 8 | 7 Findings carry a repro | Needs 1; its effect on recall must be measured first |
| 9 | 3 Capability manifest | Worth less once 1 and 2 exist, because the implementer can run the toolchain itself |
| 10 | 5 Typed documents | The highest cost; the failures it prevents are already caught by validators |

Change 8 parts 2 and 3 sit outside the ranking. Part 3 reverses section 19 and
needs its own decision, whatever else is adopted.

**Recommended first authorization:** changes 9 (replay), 2 and 10, about three
weeks, ending in one paid crew-chatter feature-1 run as the live test with a
budget the operator sets at that point. Revised 2026-10-18: changes 2 and 10
are planned in `docs/features/derived-artifacts-and-dependency-policy/plan.md`.
Change 9 waits for a replay design and its own decision. Operator decision,
2026-10-18: change 9 is reassessed after changes 2, 10 and 1 are built.

## Sequencing

The changes split into three tracks by how much binding text they reverse.
Within a track, build in the ranked order above. Change 3 qualifies for track A
by that rule but ranks ninth, so it waits unless the toolchain-probe proposal is
pursued on its own merits.

**Track A — inside today's rules.** Changes 2, 6, 10, 8 part 1, 9 (replay), and
3 (probe half). About 5–7 weeks. They close run 4's failure class, the routing
variance, and the late-failure cost without touching the trust boundary. Build
replay first, so every later change is measured against retained runs.

**Track B — the sandbox.** The change 1 spike, then change 1, with verification
moved into the same container. That closes section 17's stated limitation. About
4–6 weeks. It needs the trust-boundary decision, and it should not start until
the spike's exit criteria pass.

**Track C — on top of the sandbox.** Change 4 (executable criteria), change 7
(repro-backed findings), change 5 (typed documents), change 8 parts 2 and 3. About
8–11 weeks.

The total is roughly 17–24 engineer-weeks, plus paid validation of about
$150–400 across the tracks, not counting benchmark sweeps. Each track ends with a
benchmark sweep whose result decides whether the next track starts.

## Hard-rule and contract conflicts

| Change | Binding text it conflicts with | Resolution needed |
|---|---|---|
| 1 | Hazard 15 mechanism; section 6 command boundary; section 11 tool inventory | Section 23 decision replacing the mechanism, after the spike |
| 1 | Section 24 "target-stack adapter frameworks" | None if exactly one concrete image; refuse a second until a second target exists |
| 1 | Hard rule 4 | None if Docker, Claude Code and the tool server are each one concrete module with no interface above them |
| 1 | Hard rule 2 | None if the tool server acts only inside a run's container and never touches run state |
| 1 | Section 11 "one adapter, concrete" | None for this rework; adding a second agent needs the amendment named by the 2026-09-03 review |
| 3 | Toolchain-probe stance "the operator declares" | None if the manifest is declared, not detected |
| 4 | Section 5 deferral of `test_authoring` | Section 23 decision lifting it |
| 5 | Hard rule 3 | Delete the markdown parsers; no dual shape |
| 7 | Code-review operating contract | Contract change in `CLAUDE.md` and section 12 |
| 8.3 | Section 19 "No general mid-stage recovery"; section 20 "not retried"; hazard 7 | Decision 1 of the shelved segments plan, with a written hazard 7 exception |
| 10 | Hard rule 4, if built for more than npm | Build npm only |

## Hazard coverage

| Hazard | Effect |
|---|---|
| 1 Output shapes | Change 1 removes patch content from JSON; change 5 extends schemas to documents |
| 2 Discarded output | Change 1 records every tool call; change 9 depends on retention |
| 3 Constrained fields | Change 5 enforces by schema; change 6 removes the route from model output |
| 4 Fixtures agreeing | Change 9 replays recorded runs; change 4 requires red-on-baseline |
| 5 Completion without delivery | Change 4 checks behaviour, not presence; change 2 for derived files |
| 6 Promises a later stage cannot keep | Change 3 makes capabilities explicit; change 5 types coverage |
| 7 Retries that vary nothing | Change 8 part 3 needs a written exception; change 9 measures variance |
| 8 Executable resolution | The Docker module must resolve `docker` the way section 11 resolves `claude`; the spike covers Windows hosting |
| 9 Hook interpreters | Change 3 probes them |
| 10 Moving model aliases | Unchanged; already frozen per setting |
| 11 Default install cannot complete | Change 9's benchmark runs the default |
| 12 Configuration divergence | Change 3 makes the effective manifest visible; recorded versions show what ran |
| 13 Invented obligations | Change 4 exposes a criterion with no testable source; change 10 surfaces invented dependencies |
| 14 Unprovable independence | Change 7 makes evidence checkable regardless of who produced it |
| 15 Read-only by declaration | Replaced by change 1; the spike must prove the new boundary |
| 16 Remediation aimed upstream | Changes 6 and 7 |
| 17 Deleting the obligation | Change 5 stable IDs; change 4 deleted tests are visible |
| 18 Correctness never inspected | Change 4 |
| 19 Inactivity as wall clock | Unchanged; the agentic stream still streams |
| 20 Plan larger than one response | Change 1 removes the response-size limit; phases remain for verification cadence |
| 21 Agents not told their gate | Change 1 lets the implementer run it; change 8 part 1 runs it per phase |
| 22 Ignored files and clean-tree guard | Change 1 moves build output into the container; change 2 owns derived files |
| 23 Fix blind to decisions | Change 7 requires evidence; change 5 lets typed decisions travel to the remediator |
| 24 Declared artifact nothing changes | Change 2 removes lockfiles from declarations; change 10 settles dependencies first |

## Open questions

- **Seat use.** BuildWorks runs `claude` under the operator's own Enterprise seat.
  Claude Code's legal page says subscription sign-in "is designed to support
  ordinary use of Claude Code", and that developers building products or
  services should use API key authentication through the Claude Console or a
  supported cloud provider
  (https://code.claude.com/docs/en/legal-and-compliance.md). The authentication
  page documents a subscription token for "CI pipelines and scripts"
  (https://code.claude.com/docs/en/authentication.md). Whether an operator
  running BuildWorks on their own workstation is ordinary use is not settled by
  the documentation; confirm it with the Anthropic account team before other
  developers adopt BuildWorks. A shared or service deployment would need a
  service credential, which reaches Claude Code through environment variables
  without a code change, because of the confinement rule above.
- **Cost telemetry under another provider.** Whether `total_cost_usd` in the
  stream means the same thing under a cloud provider's billing as under a
  subscription is unknown.
- **Docker Desktop file sharing.** Bind-mount performance and line endings for a
  worktree on a Windows filesystem, measured during the spike.

## Decisions for the operator

1. Whether to authorize the recommended first set (changes 9, 2 and 10), and
   later each change in ranked order. The operator expects all ten to be wanted
   (2026-10-18); that is direction, not authorization.
2. Answered 2026-10-18: runs execute on the operator's workstation; Docker
   Desktop with WSL 2 is the first container runtime; Windows Sandbox is the
   fallback, built only if Docker fails the spike.
3. Authorization for the change 1 spike and its paid budget.
4. For track A: whether change 2's derived-file declaration lives in
   `governed.yaml` (recommended) or in the frozen profile only.
5. Whether a standing benchmark budget exists, or each sweep is authorized
   separately.
6. Who confirms the seat-use question, and whether adoption by other developers
   waits for the answer.

## Considered and rejected

- **Teaching the implementer to write lockfiles.** Prompt text cannot make a
  model reproduce a registry resolution. It would be the hazard 3 pattern again.
- **Forbidding new dependencies outright.** It removes run 4's failure, but it
  also rules out most real features. Change 10 makes the decision visible
  instead.
- **Sampling reviewers or reconcilers repeatedly and voting** to cure routing
  variance. It costs more on every run and hides variance rather than removing it.
  The severity-nondeterminism proposal rejected it for the same reason.
- **Running the agent with write tools on the host, unsandboxed.** It removes
  hazard 15's protection without replacing it. It would lose governance, which
  is the outcome this proposal is required to avoid.
- **Running `claude` inside the container.** It puts the operator's seat
  credential where package lifecycle scripts run, and ties every Claude Code
  upgrade to an image rebuild. Rejected in favour of the host-side process and
  the tool server.
- **Claude Code's own sandbox for Bash.** Per
  https://code.claude.com/docs/en/sandboxing.md it runs on macOS, Linux and
  WSL 2 but not native Windows, and it covers shell commands, not file tools or
  MCP servers. It would also put the boundary inside the dependency the rework
  must be able to replace.

Related: `ARCHITECTURE.md` sections 5, 6, 7, 11, 12, 17, 19, 20 and 24;
`docs/proposals/verification-containment.md`;
`docs/proposals/toolchain-probe-and-stack-intent.md`;
`docs/proposals/usage-limit-refusal-strands-a-run.md`;
`docs/proposals/build-in-segments-and-continue.md`;
`docs/proposals/implementer-writes-files-it-also-proposes.md`;
`docs/proposals/spec-review-severity-nondeterminism.md`;
`docs/proposals/2026-09-03-multi-harness-adapter-blast-radius-review.md`;
`docs/features/implementation-phase-retry/plan.md`.
