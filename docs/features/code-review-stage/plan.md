# Code Review Stage Implementation Plan

**Status:** Reconciled

**Goal:** Add the `code_review` stage to the chain between `verification` and
`delivery_check`, so that before a run may complete, a fixed panel of two
registered code reviewers has read the committed change against the approved
specification and plan, every finding is recorded as immutable evidence, and a
deterministic gate blocks the run when any reviewer reports a finding at or
above the severity frozen in the run's policy, or any finding whose cause is
upstream in the approved plan. Specialist selection by scope,
changed paths, technology, or risk (item 4 of
`docs/proposals/post-milestone-target-flow.md`) is deferred until this stage
exists to seat reviewers in.

**Source:** The operator's decision of 2026-09-04 to build `code_review` next,
minimal, with a fixed panel, on the evidence of the third paid run of that day:
it delivered four artifacts and passed every gate, and nothing in the system
read the code. `verification` ran the two commands the scratch target froze
(`node --version`, `npm --version`), which prove nothing about the calculator,
and `delivery_check` proved only that each declared file exists in the patch
range. A file that is present and wrong passes the entire chain.
`ARCHITECTURE.md` sections 4 (the handoff is a row), 5 (the sequence and the
deferred list), 6 (trust boundaries and the independence labels), 8 (finding
identity), 9 (the definition, `outputs`, role separation, the panel floor), 11
(the read-only invocation and the frozen executor binding), 12 (a gate is
deterministic; a reviewer's verdict is an input to a gate, never the gate
itself; the deferred-behaviours subsection), 13 (findings deduplicate by
identity within a round; a finding whose cause is upstream must be reportable
as such), 15 (the storage layout and the evidence model), 20 (every limit's
value is stated in configuration and frozen), 21 (prove a guard by breaking
what it guards), 23 (build order step 10: only then, the deferred stages).
`docs/proposals/post-milestone-target-flow.md` items 4, 6, 7, and 8, read as
the backlog this plan draws one item from. The shipped stages as direct
precedent: `src/spec-stage.ts` for the panel loop and finding persistence,
`src/verification-stage.ts` and `src/delivery-stage.ts` for reading the
verification handoff, `src/implementation-stage.ts` for the worktree
cleanliness assertions and the spec and plan hash re-verification.

**Hazards considered:** 5 (completion without delivery) is the entry this
stage extends: delivery proves a declared path was written and this stage is
the first thing in the chain that proves anyone read what was written, so Task
9 records the observed gap as entry 18 beside it rather than widening entry 5.
3 (a constrained field must have its constraint stated in the prompt) governs
the reviewer prompt in Task 4: severity, classification, the two location
forms, the `intentKey` shape, and the meaning of each severity are all values
deterministic code acts on, and the gate compares severity against a frozen
threshold, so a prompt silent about what `high` means would be gating on a
scale the reviewer was never given. 4 (fixtures and code agreeing while both
are wrong) is why the harness fixture in Task 6 builds its findings from the
changed-paths block of the prompt it receives rather than from a literal, why
every new guard carries a break-it step, and why Task 10 is not optional:
section 21 makes a contract test fed by recorded real output the load-bearing
verification category, so the plan is not complete until one real reviewer
response is committed under `test/fixtures/recorded/` with provenance and
replayed through the same validators and gate the stage runs. 11 (a
default installation that cannot complete a run) decides the gate: a gate that
blocked on any finding would make the default installation unable to complete
a run against any design large enough to attract a finding, which the
web-calculator runs showed every panel does, so the gate is a frozen severity
threshold and Task 2 adds the freeze-time staffing refusal and the seeded-
registry assertion. 14 (independence that cannot be proven) is unchanged and
inherited: every dispatch goes through `dispatchOnce`, which records
`configured_standalone`, the fixed panel never seats the implementer because
it filters on `role: reviewer`, and no document this plan writes calls the
reviewers independent — the claim the audit can support is "separately
dispatched and recorded as `configured_standalone`", and that is the wording
Task 8 and Task 9 use. 15 (a declared sandbox does not make a
subprocess read-only) is why Task 3 asserts the worktree is at the verified
commit and clean before the stage row exists and after every reviewer
dispatch: the reviewers run with the worktree as their working directory, and
the tree is checked, not trusted. 7 (retries that vary nothing) bears on the
design twice: there is no retry, no remediation round, and no second panel,
and the two reviewers receive prompts that differ in agent id and specialty;
and the stated repair for a block, a fresh run, is itself a retry that varies
nothing when the block was mistaken, which is why Assumption 4 names the
missing waiver and Task 8 records it as deferred rather than leaving "a fresh
run is the repair" to read as a remedy it is not. 12
(configuration divergence) is answered by freezing the threshold and the
panel in the profile and printing each reviewer's outcome on stderr as the
stage runs. 1 and 2 are inherited from `extractJsonBody` and `dispatchOnce`
and add no new parser. 13 concerns an author inventing an obligation; this
stage dispatches no author, so it is not reachable. 16 (a remediation loop
aimed at the wrong artifact cannot repair an upstream omission) is why an
upstream code-review finding is not gated by severity: a reviewer who
concludes the approved plan left a decision unmade has named something no
code change in this run can repair, so the stage blocks for a human on every
upstream finding and writes every one as a `blocking_dependency` proposal
with retained evidence — section 13's
"somewhere to go", by the operator's decision of 2026-09-04 during this
plan's review. 17 is the reconciliation delta and this stage reconciles
nothing. 6, 8, 9, and 10
were read and bear on nothing here: no promise is made for a later stage, no
new executable is spawned beyond `git` the way three stages already spawn it,
no hook is installed, and no model alias is matched.

**Assumptions:** Six decisions the source does not make for us, each stated
so it can be struck without disturbing the rest.

1. **Placement: `implementation -> verification -> code_review ->
   delivery_check`.** Item 8 of the proposal places the code-review gate
   before terminal verification and delivery; the chain today has one
   verification, and it is free and deterministic. Reviewing code that fails
   its own frozen commands would spend two reviewer dispatches on a run that
   already blocks, and placing the stage after verification lets it read the
   validated verification record for the worktree, the patch base, and the
   verified commit exactly as delivery does, instead of re-deriving them from
   the implementation gate event. The cost is that `runDeliveryStage` must
   look past the new last stage to find the verification record; Task 7 makes
   that change and holds delivery to a `code_review.gate.pass` event the same
   way it is already held to `verification.gate.pass`.
2. **The fixed panel is every registered code reviewer.** A code reviewer is
   an `AgentDefinition` with `role: "reviewer"` and `outputs:
   ["code-findings"]`, bound to the frozen executor. The stage seats all of
   them, in id order, and there is no panel request, no self-critique, and no
   call to `selectReviewers`. The output kind is what partitions the two
   registries: `selectReviewers` and `staffingShortfall` filter on
   `outputs.includes("findings")`, so a code reviewer can never be ranked into
   a spec or plan panel and a spec reviewer can never be seated here. Two are
   seeded, `code-reviewer-correctness` (specialty `correctness`) and
   `code-reviewer-security` (specialty `security`), which meets section 9's
   floor of two lenses. The specialty string `security` also names a spec
   reviewer's lens; that is deliberate, because a specialty is a lens and the
   two registries are partitioned by output kind, not by lens name. Item 4
   later replaces "every registered code reviewer" with a selection over the
   same candidates; nothing else moves.
3. **The gate is a frozen severity threshold, not decision completeness.**
   Section 12 replaced severity gating with decision completeness for
   `spec_review` and `plan_review` because those stages have a reconciliation
   dispatch that produces decisions. This stage has none: there is no author
   to answer a finding, and building the answer path is the remediation loop
   item 8 defers. The only deterministic function of what the stage holds is
   over the reports themselves, and blocking on any finding at all would
   violate hazard 11, since every web-calculator panel returned findings.
   The gate therefore blocks when any report on any canonical finding carries
   a severity at or above `policy.codeReviewBlockingSeverity`, ordered by the
   run's frozen `policy.severities` — the copy `buildPolicy` takes of
   `SEVERITIES` at freeze time, never the live constant, so reordering the
   constant cannot change an in-progress run's gate (hard rule 6); the seeded
   value is `high`. `current_artifact` findings below the threshold are
   retained as evidence in the finding and report tables, in the stage
   record, and in the audit, and they never block. Severity remains each
   reviewer's own immutable assertion; the system decides what to do with it,
   which is exactly the division section 12 states.
4. **A block is terminal and a fresh run is the repair, and there is no
   waiver.** No reconciliation dispatch, no remediation patch round, no
   re-review, and no way for a human to read a finding, judge it wrong, and
   let the run continue. The branch, worktree, record, and retained raw
   output survive. The consequence is stated rather than hidden: a fresh run
   against the same design, the same model, and a near-identical plan varies
   nothing (hazard 7), so a mistaken block — a nit graded `high`, a code
   defect mis-classified upstream — has no exit but changing the design or
   the rubric, and the cost of that dead end is a whole chain here rather
   than a review round. No stage in the chain has an operator waiver today,
   so this is consistent, not new; Task 8 records it as a fifth bullet of
   section 12's deferred-behaviours subsection beside the remediation bullet,
   so both deferrals are findable in the binding document rather than only
   here.
5. **An upstream finding blocks for a human and becomes a proposal.**
   Section 13 forbids forcing a reviewer to
   express a plan defect as a code defect and requires an upstream finding to
   have somewhere to go, so the report contract keeps `classification` and a
   code reviewer may return `upstream` with the location
   `upstream:plan:<decision-key>`. This stage has no reconciliation dispatch
   to route it, so the route is the operator's decision of 2026-09-04, taken
   during this plan's review: every upstream finding blocks the run
   terminally regardless of its severity, with the finding id and the
   decision key retained in the record and the gate event, because a missing
   plan decision is not something a code change in this run can repair
   (hazard 16) and passing it below the threshold would deliver code over an
   unowned defect; and every upstream finding, whatever its severity, also
   writes a non-binding `blocking_dependency` proposal through the existing
   `writeProposalEvidence` and `store.upsertProposal`, so the concern is a
   queryable row on the plan's backlog in the same shape the two review
   stages produce, not a line to dig out of a gate event. One rule, not two:
   the operator first scoped the proposal to the threshold and then, on the
   reconciler's recommendation during the same review, chose the single rule
   because the run is blocked either way, the severity travels on the report
   and in the evidence file, and a second frozen comparison bought only a
   branch and a fixture mode. The candidate is derived deterministically
   from the finding — title and problem from the reviewer's `subject`,
   `whyUpstream` from the decision key — so no second model-returned field
   exists to disagree with the route. The proposal and its evidence are
   retained; only a human promotes it or authorizes a spike, and the repair
   is a fresh run. `UPSTREAM_SOURCES` gains `plan` for the prefix. That also
   widens the grounding-source vocabulary `insertFindingDecision` accepts,
   which is reachable only through a decision path this stage does not have;
   Task 3 says so in the comment and updates the two `test/store.test.ts`
   assertions that pin the old message.
6. **The reviewers read the diff in the prompt and the code in the worktree.**
   The frozen executor's tool inventory is `Read,Glob,Grep`, so a reviewer
   cannot run `git` and cannot learn what changed from the tree alone. The
   prompt carries the changed paths and the full unified diff of
   `patchBase..verifiedCommit`, and the invocation's working directory is the
   worktree at the verified commit so the reviewer can read surrounding code.
   A diff that pushes the prompt past `PROMPT_MAX_BYTES` is refused by
   `dispatchOnce` by name and the stage aborts on that refusal, which is
   section 20's rule applied unchanged: refuse, never truncate. Say what that
   costs, in the gate's doc comment and in section 12: the refusal lands
   after implementation has spent its dispatches, and until some form of
   chunked review exists a change whose diff plus specification plus plan
   exceeds the ceiling cannot be reviewed at all, so the stage's reach is
   bounded by diff size. The web-calculator diff is a small fraction of the
   ceiling; a real target's may not be. The approved
   specification and plan travel too, re-verified against the signed spec hash
   and the gated plan hash exactly as `runImplementationStage` verifies them,
   because "present and wrong" is a judgement against the specification.

**Approach:** One new stage module, two new agent definitions, one new prompt,
one new output kind, one new policy value, one new stage-kind entry in the
model map and the capability map, two new path helpers, one new harness
fixture, and one new test file. The stage mirrors the shape the four existing
orchestrators share, deliberately without extracting an abstraction: hard
rule 4, and `src/implementation-stage.ts` already records that the question of
what generalizes belongs to whoever has all the stages in hand. Delivery moves
its last-stage check one stage later and gains a second gate-event check. The
binding documents change in the same commit as the code: the sequence, the
deferred list, the gate paragraph, the deferred-behaviours bullet, the storage
layout, the hazard entry, and the two pinned lists in `scripts/doc-check.mjs`.
No migration: the finding and finding_report tables already carry everything a
code finding is, and `stage.kind` carries no CHECK constraint.

**Affected areas:**

- New: `src/code-review-stage.ts`, `src/agents/code-reviewer-correctness.ts`,
  `src/agents/code-reviewer-security.ts`,
  `test/fixtures/harness/emit-code-review.mjs`, `test/code-review-stage.test.ts`,
  `docs/features/code-review-stage/real-run-evidence.md` and one
  `test/fixtures/recorded/code-review-*.json` (Task 10).
- Modify: `src/agents.ts`, `src/select.ts`, `src/policy.ts`, `src/profile.ts`,
  `src/finding.ts`, `src/reconciliation.ts`, `src/paths.ts`, `src/prompts.ts`,
  `src/delivery-stage.ts`, `src/cli.ts`, `scripts/doc-check.mjs`,
  `.claude/skills/run-buildworks/driver.mjs`,
  `.claude/skills/run-buildworks/SKILL.md`, `ARCHITECTURE.md`,
  `docs/hazards.md`, `README.md`, `CLAUDE.md`.
- Modify tests: `test/agents.test.ts`, `test/select.test.ts`,
  `test/policy.test.ts`, `test/profile.test.ts`, `test/paths.test.ts`,
  `test/store.test.ts`, `test/prompts.test.ts`, `test/delivery-stage.test.ts`,
  `test/cli.test.ts`.

**Known blockers:**

- **This builds past the deliberate stop, and the decision to do so is the
  operator's message of 2026-09-04, not this plan.** `CLAUDE.md` says the
  build order stops at step 9 and nothing is built past it without an
  explicit decision; `ARCHITECTURE.md` section 12's deferred-behaviours
  subsection says the same. The decision was taken for exactly one deferred
  stage. Task 8 records that in both documents so the record of the decision
  is in the committed tier and the other five deferred stages and three
  deferred behaviours are still visibly behind their own decision.
  Verified by reading `CLAUDE.md` and section 12.
- **`scripts/doc-check.mjs` pins the sequence and the deferred list.**
  `PINNED_SEQUENCE` and `PINNED_DEFERRED` are literal lists, not derived, and
  `checkSequence` and `checkDeferred` fail on any difference from section 5.
  Editing section 5 without the pins fails `check:docs`; editing the pins
  without section 5 fails it the other way. Task 8 edits both and uses the
  intermediate failure as the break-test the doc-check skill requires.
  Verified by reading the script.
- **`runDeliveryStage` requires the last stage to be a passed `verification`
  and reads the record from `last.output_ref`.** The check is at the top of
  `src/delivery-stage.ts`; both `test/delivery-stage.test.ts` (the
  `withDeliveryRun` fixture and the test asserting `not a passed
  verification`) and `test/cli.test.ts` (`parkVerifiedRun` and the test at
  the `deliver` section asserting the same wording) pin the current shape.
  Task 7 moves the check and the fixtures together. Verified by grep.
- **`freezeProfile` pins the model map literally and `test/profile.test.ts`
  asserts the literal**, plus a test named for "the five dispatchable stage
  kinds". Task 2 adds the sixth entry and updates both assertions.
- **`Policy` gains a field, so `policyHash` changes.** Every run frozen
  before this change refuses at the approval gate's policy re-check and at
  `loadVerifiedProfile` with the field named as missing. Nothing has shipped,
  so no compatibility handling is owed (hard rule 3); `invalidPolicyReason`
  derives its expected field set from `buildPolicy()`, so the new field is
  enforced without a second list. `STRING_ARRAY_FIELDS` and
  `POSITIVE_INT_FIELDS` are the two hand-kept lists; the new field is a
  string, so Task 2 adds its own membership check rather than joining either.
- **`test/policy.test.ts` scans `STAGE_MODULES` for imports of the frozen-only
  constants.** The new stage module must be added to that list or the guard
  does not cover it, and the new constant `CODE_REVIEW_BLOCKING_SEVERITY` must
  join `FROZEN_ONLY` or a stage could import it live. Task 2.
- **`test/paths.test.ts` fails on any source line outside `src/paths.ts` that
  spells `.governance`**, and pins every helper's value. The two new helpers
  go in `src/paths.ts` and the pin test gains two lines. Task 3.
- **The reviewers' `envPassthrough` is the frozen executor's, not the
  test's.** `test/implementation-stage.test.ts` shows the pattern: the
  fixture executor lists `EMIT_MODE` in its own passthrough, is frozen into
  the profile through `freezeExecutorIntoProfile`, and tests set the variable
  around each call with `withMode`. The stage tests here follow that pattern
  exactly. Verified by reading that file.
- **`npm test` intermittently leaks empty `moved` commits and a stray
  `base.txt` onto the real repository**, root cause untraced, recorded in
  `.claude/sessions/project-learnings.md`. The pre-gate full-suite run is
  executed in a recursive copy of the working tree outside the repository,
  never in place, per the same rule the previous plan followed. Repairing the
  real repository's history is destructive and this plan does not authorize
  it.
- **Task 10 spends real money and needs the operator.** The paid chain
  requires operator authorization per
  `.claude/skills/run-buildworks/SKILL.md`; a lapsed `claude` session fails
  the spec dispatch closed. Budget rises by two reviewer dispatches on a diff
  of four files plus the spec and plan, which on the recorded plan-panel
  costs ($0.13 to $0.18 each) puts a full chain at $1.25 to $2.50. Do not
  start it without both. It is load-bearing: section 21 makes recorded real
  output the verification category that pays, and until one real reviewer
  response is committed and replayed the plan is awaiting contract evidence,
  not complete. The deterministic tests prove the code matches its author's
  reading; only the recorded response proves the contract with the provider.

**Blast radius:** Verified by import search across `src` and `test`, not
inferred.

- `AGENTS` in `src/agents.ts` is imported by `src/profile.ts` and by
  `test/agents.test.ts`, `test/select.test.ts`, `test/spec-stage.test.ts`,
  `test/plan-stage.test.ts`. The two stage tests and `test/select.test.ts`
  build their seatable set as `role === "reviewer" &&
  outputs.includes("findings")`, so the two new definitions are excluded by
  construction and no exact-panel assertion in `test/select.test.ts` moves.
  `test/agents.test.ts` iterates every reviewer in five tests asserting
  forbidden outputs; the new reviewers satisfy all five as written.
- `selectReviewers` and `staffingShortfall` in `src/select.ts` are unchanged.
  Their candidate filter is what keeps the two registries apart, and Task 2
  adds a test that proves it rather than assuming it.
- `freezeProfile` in `src/profile.ts` is called by `src/cli.ts` and by seven
  test files (`test/profile.test.ts`, `test/approval-stage.test.ts`,
  `test/spec-stage.test.ts`, `test/plan-stage.test.ts`,
  `test/implementation-stage.test.ts`, `test/verification-stage.test.ts`,
  `test/delivery-stage.test.ts`). Its signature does not change; it gains a
  refusal and a map entry. `requiredCapability` has one production caller,
  `requireFrozenBinding`, and one test.
- `Policy` in `src/policy.ts` is imported by `src/approval-stage.ts`,
  `src/cli.ts`, `src/implementation-stage.ts`, `src/plan-gate.ts`,
  `src/plan-stage.ts`, `src/profile.ts`, `src/spec-stage.ts`, and five test
  files. The added field is additive; the hash change is the known blocker
  above.
- `SEVERITIES` in `src/finding.ts` is imported by `src/policy.ts`,
  `src/reconciliation.ts`, `src/store.ts`, and `test/policy.test.ts`. Its
  contents do not change; Task 2 adds a comment stating its order is
  ascending and load-bearing.
- `UPSTREAM_SOURCES` and `upstreamPrefixFor` in `src/reconciliation.ts` are
  imported by `src/store.ts` (grounding-source validation in
  `insertFindingDecision`), `src/spec-stage.ts`, `src/plan-stage.ts`, and
  `test/migrate.test.ts` (which calls `upstreamPrefixFor("design")`). Adding
  `plan` changes no existing value, but it changes the store's refusal
  message: two assertions in `test/store.test.ts` pin `allowed values are
  design, specification` and must gain `, plan`. Verified by grep.
- `runDeliveryStage` in `src/delivery-stage.ts` has one production caller,
  `src/cli.ts`, and two test consumers named in the blockers. It gains a type
  import from `src/code-review-stage.ts`; nothing imports delivery back, so
  no cycle.
- `writeProposalEvidence`, `proposalIdentity`, and `store.upsertProposal` are
  called today by `src/spec-stage.ts` and `src/plan-stage.ts` only; the code
  review stage becomes a third caller and changes none of them. The
  `proposal` table's `route` CHECK already admits `blocking_dependency`.
  Verified by reading `src/proposal.ts`, `src/store.ts`, and
  `src/migrations/006_proposal.sql`.
- `src/paths.ts` is imported by nine production modules and
  `test/paths.test.ts`; two additive helpers.
- `src/prompts.ts` is imported by the three dispatching stages and
  `test/prompts.test.ts`, whose whole-file constraint scan reads the source.
  One additive builder.
- `src/cli.ts` has no importers; `test/cli.test.ts` spawns it.
- `scripts/doc-check.mjs` has no importers; `npm run check:docs` runs it.
  `test/schema.test.ts` reads `ARCHITECTURE.md`'s SQL fence only, which does
  not change.
- `.claude/skills/run-buildworks/driver.mjs` has no importers; its `smoke`
  step count is stated in prose in `SKILL.md` and in
  `.claude/sessions/project-learnings.md`, which doc-check cannot see.

**Verification:** `npm run typecheck`, `npm test` in an isolated copy,
`npm run check:docs`, and `node .claude/skills/run-buildworks/driver.mjs smoke`.
Every new guard is proved by break-and-restore: change the behaviour, confirm
the named test fails, restore by editing back, never with `git checkout --`.
The deterministic stage tests driven through the harness fixture, and the
delivery and CLI tests that prove the chain still completes with the new stage
in it, are the first of section 21's two categories. The second, the one that
pays, is Task 10: one real reviewer response recorded from an authorized paid
run, committed with provenance, and replayed through the stage's validators
and gate. Without it the plan is awaiting contract evidence and its status
does not advance.

---

## Tasks

### Task 1: the two code reviewers and the output kind that partitions them

**Depends on:** None

**Files:**
- Create: `src/agents/code-reviewer-correctness.ts`,
  `src/agents/code-reviewer-security.ts`
- Modify: `src/agents.ts` — `AGENTS`
- Modify: `src/select.ts` — new `codeReviewPanel`, `codeReviewStaffingShortfall`
- Validate: `test/agents.test.ts`, `test/select.test.ts`

**Steps:**

- **Step 1: write the failing registry assertions first.** In
  `test/agents.test.ts` add: the seeded registry holds at least two agents
  with `role: "reviewer"` whose `outputs` is exactly `["code-findings"]`,
  bound to `claude-code`, with distinct non-null specialties (hazard 11, the
  code-review sibling of "the seeded reviewers can staff a standard-risk plan
  panel"); no author's outputs include `code-findings`; no agent whose outputs
  include `code-findings` also includes `findings` (one lens set per stage
  family — a reviewer eligible for both panels is the item-4 drift this plan
  defers, arriving by accident). Extend the existing implementer test's
  forbidden list with `code-findings`.
  - Verify: `node --test test/agents.test.ts`
  - Expected: the two new tests fail because no such agent exists; every
    pre-existing test still passes.

- **Step 2: add the two definitions and register them.** Each file mirrors
  `src/agents/spec-reviewer-security.ts`, exporting `CODE_REVIEWER_CORRECTNESS`
  and `CODE_REVIEWER_SECURITY` respectively: `id`, `role: "reviewer"`,
  `specialty` (`correctness` and `security`), `executor: "claude-code"`,
  `outputs: ["code-findings"]`, `tools: []`. Append both to `AGENTS` after the
  spec reviewers. Extend the registry comment in `src/agents.ts` with one
  sentence: `findings` seats a spec or plan panel and `code-findings` seats
  the code-review panel, and the two output kinds are what keep the two
  candidate sets apart.
  - Verify: `node --test test/agents.test.ts`
  - Expected: green.

- **Step 3: add the fixed-panel functions beside the selection functions.**
  In `src/select.ts` add `codeReviewPanel(candidates, executorId):
  AgentDefinition[]` returning every candidate with `role === "reviewer"`,
  `outputs.includes("code-findings")`, and `executor === executorId`, sorted
  by id ascending — a pure function of its arguments, taking the frozen
  profile's agents from the caller exactly as `selectReviewers` does (hard
  rule 6). Add `codeReviewStaffingShortfall(candidates, minSize, executorId):
  string | null` returning a named refusal when the panel has fewer than
  `minSize` members, when two members share a specialty, when a member's
  specialty is null, or when two members share an id; null otherwise. Say in
  the doc comment that this is the fixed panel the operator's 2026-09-04
  decision asked for, that item 4 of the proposal replaces the "every
  registered code reviewer" rule with a selection over the same candidates,
  and that nothing else here is meant to move when it does.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- **Step 4: prove the partition and the refusals in `test/select.test.ts`.**
  Add: `codeReviewPanel(AGENTS, CLAUDE_CODE.id)` returns exactly
  `["code-reviewer-correctness", "code-reviewer-security"]` in that order;
  `selectReviewers(AGENTS, 5, [])` returns no agent whose outputs include
  `code-findings` (the ranked fill sorts `code-reviewer-*` before
  `spec-reviewer-*`, so a leaked eligibility would seat one first — this is
  the assertion that fails if the filter ever changes);
  `codeReviewStaffingShortfall` refuses by name for a one-reviewer registry,
  for two reviewers sharing a specialty, for a code reviewer on another
  executor (so it is not counted), and returns null for `AGENTS`.
  - Verify: `node --test test/select.test.ts`
  - Expected: green.

- **Step 5: break it.** Change one new definition's outputs to `["findings"]`
  and confirm the partition test and the `selectReviewers` test both fail;
  restore. Change `codeReviewPanel`'s sort to descending and confirm the
  order assertion fails; restore.
  - Verify: `node --test test/agents.test.ts test/select.test.ts` after each
    mutation and restore
  - Expected: each mutation fails the named test; each restore is green.

**Task completion evidence:** Two code reviewers in the registry with
`code-findings` as their only output, a pure fixed-panel function and its
staffing refusal in `src/select.ts`, and tests proving the spec and plan
selection can never seat them, each observed failing under a mutation.

### Task 2: the frozen configuration — threshold, model entry, capability, staffing

**Depends on:** Task 1

**Files:**
- Modify: `src/finding.ts` — `SEVERITIES` comment
- Modify: `src/policy.ts` — `CODE_REVIEW_BLOCKING_SEVERITY`, `Policy`,
  `buildPolicy`, `invalidPolicyReason`
- Modify: `src/profile.ts` — `freezeProfile` (model map and staffing refusal),
  `requiredCapability`
- Validate: `test/policy.test.ts`, `test/profile.test.ts`

**Steps:**

- **Step 1: state that `SEVERITIES` is ordered.** Add a comment above the
  constant in `src/finding.ts`: the array is in ascending order, `low` to
  `critical`; `buildPolicy` copies it into the frozen `policy.severities`,
  and the code-review gate compares by index in that frozen copy, so the
  order is load-bearing for every run frozen after a change. Do not change
  the contents.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- **Step 2: add the threshold to policy.** In `src/policy.ts` export
  `CODE_REVIEW_BLOCKING_SEVERITY = "high"` with a comment in the style of its
  neighbours: what it is (the lowest severity at which one code-review report
  blocks the run), why `high` (hazard 11 — a panel that returns nothing is
  the exception, and a gate that blocked on any finding would make the
  default installation unable to complete a run against any design large
  enough to attract one; `high` is the first level at which a reviewer is
  asserting the change fails a criterion or misbehaves in use, per the prompt
  rubric Task 4 states), what happens on breach (the run blocks terminally
  naming the finding ids and severities; a fresh run is the repair), and that
  the stage reads `profile.policy.codeReviewBlockingSeverity` and orders it
  within `profile.policy.severities`, never this constant or `SEVERITIES`.
  Add `codeReviewBlockingSeverity: string` to `Policy`, set it in
  `buildPolicy`, and in `invalidPolicyReason`, after the `STRING_ARRAY_FIELDS`
  loop has established that `p.severities` is a string array, refuse a
  threshold that does not occur exactly once in `p.severities` — the frozen
  list in the same policy object, not the live `SEVERITIES` — with a message
  naming the field, the value, and the frozen list. The check is against the
  policy's own vocabulary because that is the list the gate indexes; a
  threshold valid against the live constant but absent from the frozen list
  would index to -1 and block nothing. Do not add the field to
  `STRING_ARRAY_FIELDS` or `POSITIVE_INT_FIELDS`; it is neither.
  - Verify: `node --test test/policy.test.ts`
  - Expected: the field-by-field test does not yet assert the new value and
    passes; no refusal test exists yet.

- **Step 3: pin the policy in its tests.** In `test/policy.test.ts`: import the
  new constant and add its line to "every policy value is the one the
  enforcing module actually uses"; add a test that
  `invalidPolicyReason({ ...buildPolicy(), codeReviewBlockingSeverity: "severe" })`
  matches `/codeReviewBlockingSeverity/` and names the frozen list, that a
  policy whose `severities` is `["low", "medium"]` with the seeded threshold
  `high` is refused (valid live, absent from the frozen list), that a policy
  whose `severities` lists `high` twice is refused, and that each member of
  `SEVERITIES` is accepted against the seeded list; add
  `CODE_REVIEW_BLOCKING_SEVERITY` to `FROZEN_ONLY`. Do not add
  `code-review-stage.ts` to `STAGE_MODULES` yet: the scan reads each listed
  file with an unguarded `readFileSync`, and the module does not exist until
  Task 3, which adds the entry.
  - Verify: `node --test test/policy.test.ts`
  - Expected: green.

- **Step 4: freeze the sixth model entry and the capability.** In
  `freezeProfile`'s `modelMap` literal add `code_review: model`; update the
  comment if it counts entries. In `requiredCapability` add `case
  "code_review":` to the `review` group and reword the doc comment from "the
  five dispatchable kinds map to four capability names" to six and four. In
  `test/profile.test.ts` update the `modelMap` deep-equal literal and rename
  and extend "requiredCapability maps the five dispatchable stage kinds" to
  six, asserting `requiredCapability("code_review") === "review"`. The
  refusal-message test for `resolveStageModel` matches a prefix of the joined
  key list and still passes; extend its regex to include `code_review` so it
  pins the whole list.
  - Verify: `node --test test/profile.test.ts`
  - Expected: green.

- **Step 5: refuse at freeze time a registry that cannot staff the code
  panel.** In `freezeProfile`, immediately after the existing
  `staffingShortfall` refusal, call
  `codeReviewStaffingShortfall(agents, policy.panelSizeMin, CLAUDE_CODE.id)`
  and throw `cannot freeze a profile for run ${runId}: ${shortfall}` when it
  is non-null — section 11's rule: a configuration the registry cannot
  satisfy fails before a run row exists and before anything is spent. The
  existing `deps.agents` seam is the test seam. Add a test in
  `test/profile.test.ts` freezing with `AGENTS.filter((a) =>
  !a.outputs.includes("code-findings"))` and asserting the throw names the
  shortfall, and one freezing with the real `AGENTS` and asserting success.
  Note the ordering consequence in `src/cli.ts`: `new-run` already catches a
  freeze failure, audits `profile.freeze.failed`, blocks the run, and prints
  the run id; nothing there changes.
  - Verify: `node --test test/profile.test.ts test/cli.test.ts`
  - Expected: green.

- **Step 6: break it.** Set `CODE_REVIEW_BLOCKING_SEVERITY` to `"severe"` and
  confirm "the policy this code builds is one it accepts" fails; restore.
  Remove the `code_review` map entry and confirm the model-map test fails;
  restore. Remove the freeze-time refusal and confirm the new profile test
  fails; restore.
  - Verify: the named test files after each mutation and restore
  - Expected: each mutation fails exactly the named test.

**Task completion evidence:** The threshold, the sixth model entry, the
capability mapping, and the freeze-time staffing refusal are frozen
configuration, each pinned by a test observed failing under mutation.

### Task 3: the stage — preconditions, fixed panel, findings, gate, record

**Depends on:** Task 2

**Files:**
- Create: `src/code-review-stage.ts` — `runCodeReviewStage`,
  `validateCodeReviewLocations`, `codeReviewGate`, `CodeReviewRecord`
- Modify: `src/paths.ts` — `codeReviewEvidenceDir`, `codeReviewEvidenceRef`
- Modify: `src/reconciliation.ts` — `UPSTREAM_SOURCES`, `upstreamPrefixFor`
- Validate: `test/paths.test.ts`, `test/store.test.ts`, `npm run typecheck`

The stage is written before its prompt (Task 4) and its fixture (Task 6) so
the type checker anchors the contract; it is not exercised until Task 6.

**Steps:**

- **Step 1: the two path helpers and the upstream source.** In `src/paths.ts`
  add `codeReviewEvidenceDir(rootDir, runId)` returning
  `<rootDir>/.governance/code-review/<runId>` and `codeReviewEvidenceRef(runId,
  name)` returning the root-relative form, mirroring the delivery pair and
  their comments. Pin both in `test/paths.test.ts`'s "every location is the one
  shipped" test. In `src/reconciliation.ts` add `"plan"` to `UPSTREAM_SOURCES`
  and a `plan` branch to `upstreamPrefixFor` returning `upstream:plan:`; extend
  the comment above `UPSTREAM_SOURCES` to say that `plan` is the code-review
  stage's upstream and that no decision path cites it today, so its
  appearance in `insertFindingDecision`'s accepted grounding sources is
  vocabulary, not a reachable write. Update the two assertions in
  `test/store.test.ts` that pin `allowed values are design, specification` to
  the new three-value message. Once `src/code-review-stage.ts` exists at the
  end of this task, add `code-review-stage.ts` to `STAGE_MODULES` in
  `test/policy.test.ts` so the frozen-only import scan covers it.
  - Verify: `node --test test/paths.test.ts test/reconciliation.test.ts
    test/migrate.test.ts test/store.test.ts`, and `node --test
    test/policy.test.ts` after Step 6
  - Expected: green; the `paths` pin test fails until the helpers exist and
    passes after.

- **Step 2: preconditions, each refused by name before any state mutation.**
  In `src/code-review-stage.ts` export `runCodeReviewStage(store, executor,
  input: { runId; requestedModel?; rootDir })` returning
  `{ ok: true; stageId; resultRef } | { ok: false; reason }`. Before the stage
  row exists, refuse in this order, each with the wording its precedent uses:
  the run does not exist; `requireRunInProgress`; a `code_review` stage
  already exists (naming its status); the last stage is not a passed
  `verification` with an `output_ref` (`run N's last stage is X (status), not
  a passed verification`); `loadVerifiedProfile`; `resolveStageModel(profile,
  "code_review")` and the `--model` mismatch refusal, worded as the other
  stages word it; `requireFrozenBinding(profile, executor, "code_review")`;
  the run-duration ceiling from `profile.policy.runDurationLimitSeconds`; the
  verification record at the last stage's `output_ref`, re-read and validated
  with the same field checks `runDeliveryStage` applies (run id, stage id
  equal to the verification stage's, worktree path, both commits matching the
  commit pattern, `outcome === "pass"`), with the same two messages for
  missing and invalid; a `verification.gate.pass` audit event, refused with
  delivery's wording when absent — verification completes its stage and
  appends the event as separate writes, so a crash between them leaves a
  passed row whose outcome the audit never recorded, and two paid reviewer
  dispatches must not be spent on it; the approval row, refused by name when absent (only its
  `spec_hash` is read — the scope is delivery's concern, not this stage's);
  the spec from the `awaiting_approval` stage's `output_ref`
  hashed with `sha256Hex(normalizeText(...))` against `approval.spec_hash`,
  and the plan from the `plan_review` stage's `output_ref` hashed against the
  `plan.gate.pass` event's `planHash`, with the `planFor` check against the
  spec hash — copy the three refusals and the regex from
  `runImplementationStage` verbatim rather than paraphrasing them; the
  worktree exists, its head equals `verifiedCommit`, and `git status
  --porcelain -z --untracked-files=all --ignored=matching` is empty (the
  implementation stage's `worktreeClean`, copied); the fixed panel from
  `codeReviewPanel(profile.agents, executor.id)` passes
  `codeReviewStaffingShortfall(..., profile.policy.panelSizeMin, executor.id)`
  — the same check freeze applied, repeated at this boundary because a
  tolerance applied at one boundary and not its sibling is this repository's
  recurring defect — and every member's outputs include `code-findings`. Spawn
  `git` directly the way the three sibling stages do, with the 64 MiB
  `maxBuffer` delivery uses, because the unified diff is the largest git
  output in the chain.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- **Step 3: the changed set and the diff.** Compute `changedPaths` with
  `git diff --name-only -z <patchBase> <verifiedCommit>` in the worktree, split
  on NUL, and the diff text with `git diff --no-color <patchBase>
  <verifiedCommit>`. Refuse an empty changed set by name before the stage row
  exists: a passed verification over a range that changed nothing is a state
  no honest run reaches, and a review of nothing must not pass.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- **Step 4: the stage row, the panel loop, and the persistence.** Insert the
  `code_review` stage with the verification stage as its input, set it
  `in_progress`, audit `code_review.stage.create` naming the worktree, the
  range, and the panel ids. For each reviewer in panel order: dispatch through
  `dispatchOnce` with `role: "reviewer"`, the frozen `code_review` model, the
  prompt from Task 4, and `invocation: { cwd: worktreePath }`; after the
  dispatch re-run the head and cleanliness checks and abort with
  `code_review.worktree.dirty` naming the paths or the moved head — a prompt
  is a request and the tree is checked (hazard 15); then `extractJsonBody`,
  `validateAgentResult(reviewer.id, ...)`, refuse a status other than
  `proposed` with the spec stage's wording ("a reviewer that cannot review
  must not pass the gate by absence"), and validate
  `proposedContentChanges.findings` with `validateReviewerReports(...,
  { agentId, upstreamPrefix: upstreamPrefixFor("plan") })`. Then apply two
  checks that shared validator cannot make, each refusing with
  `code_review.reviewer.failed`: `validateCodeReviewLocations(reports,
  changedPaths)`, an exported pure function returning a reason or null, which
  requires every `current_artifact` report's location to match
  `^<path>(:[1-9][0-9]*)?$` for exactly one `path` in `changedPaths` (the
  path compared byte-for-byte after the shared validator's
  `normalizeLocation`, which only trims edge whitespace, collapses internal
  runs, and drops one trailing colon — none of which can turn one changed
  path into another, so the stored identity is still the exact path — and
  refusing an unchanged path, a heading, a `:0`, a non-numeric suffix, or a
  second suffix by name: the prompt states the rule and this is the
  deterministic backstop, hazard 3); and a frozen-vocabulary check that every
  report's severity occurs in `profile.policy.severities`, because the shared
  validator checks the live `SEVERITIES` and the gate indexes the frozen
  list. Persist each
  report exactly as `runSpecStage` does: `upsertCanonicalFinding(stage.id, 1,
  intentKey, location)` then `insertFindingReport`, auditing
  `code_review.finding.record` per report. Round is always 1: there is one
  panel and no second round. Write one stderr progress line per reviewer
  (`reviewed <id> (<specialty>): <n> finding(s) in <ms>ms`), which is hazard
  12's visibility of the effective configuration at the operator's surface.
  Every abort follows the sibling shape: audit the named action, complete the
  stage blocked with an empty `output_ref`, block the run, return the reason.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- **Step 5: the gate, pure and exported.** Export
  `codeReviewGate(findings: { finding: CanonicalFindingRow; reports:
  FindingReportRow[] }[], blockingSeverity: string, severities: readonly
  string[]): { pass: true } | { pass: false; blocking: { findingId: number;
  severity: string; location: string; cause: "upstream" | "severity" }[] }`.
  A finding blocks with cause `upstream` when any of its reports carries
  classification `upstream`, whatever its severity; otherwise it blocks with
  cause `severity` when any report has `severities.indexOf(report.severity)
  >= severities.indexOf(blockingSeverity)`. The blocking list carries each
  blocking finding once with the highest severity any report gave it (by
  index in `severities`) and its location, which for an upstream finding is
  the `upstream:plan:<decision-key>` token itself, so the decision key
  travels in the record and the event. Throw if `blockingSeverity` or any
  report severity is not in `severities` — `invalidPolicyReason` and Step 4's
  frozen-vocabulary check already refuse both, so the throw is the wedge
  guard's business, never the ordinary path. The stage reads its findings
  with `store.getCanonicalFindings(stage.id)` and
  `store.getFindingReports(id)`, the threshold from
  `profile.policy.codeReviewBlockingSeverity`, and the order from
  `profile.policy.severities`; it imports nothing from `src/finding.ts` but
  the row types. The doc comment states what the gate proves and does not:
  it proves that no reviewer asserted a severity at or above the frozen
  threshold and that no reviewer placed a defect's cause in the plan; it
  does not prove the code is correct, no panel or author confirms a
  below-threshold finding was harmless, and a change too large for the
  prompt ceiling is never reviewed, only refused. Say why a threshold rather than
  decision completeness (Assumption 3) and why upstream is not gated by
  severity (Assumption 5), in one paragraph each, so the next reader does not
  file either as a regression against section 12 or 13.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- **Step 6: the proposals, the record, and the completion.** Before the
  record is written, for each blocking entry with cause `upstream`, at any
  severity, write the concern as a proposal
  exactly as `runSpecStage` does after a reconciliation: `writeProposalEvidence(rootDir,
  runId, { findingId, candidate, route: "blocking_dependency", rationale,
  artifactHashBefore: planHash, artifactHashAfter: planHash })` then
  `store.upsertProposal(..., proposalIdentity(stage.id, title, problem,
  "blocking_dependency"))`, auditing `code_review.proposal.record` with the
  spec stage's summary shape (`proposal <id> created|linked; finding=<id>;
  route=blocking_dependency; ...`). The candidate is derived, never a second
  model-returned field: `title` is the reviewer's `subject`; `problem` is the
  subject followed by one sentence naming the reviewer, the severity, and the
  decision key; `whyUpstream` states that the approved plan (hash named)
  leaves decision `<key>` unmade so the change cannot be corrected in code
  within this run. The rationale is the system's: `code reviewer <id>
  classified the finding upstream at severity <s>`. Both artifact hashes are
  the plan hash, because this stage changes no artifact. Export the record's
  shape as `interface CodeReviewRecord` so delivery reads the same type it is
  written from (hard rule 3). Write `<codeReviewEvidenceDir>/result.json`
  with `runId`, `stageId`, `worktreePath`, `patchBase`, `verifiedCommit`,
  `changedPaths`, `panel` (agent ids in seat order), `blockingSeverity`,
  `severities` (the frozen order), `findings` (each canonical finding's `id`,
  `location`, `intentKey`, and its reports' `agent`, `severity`,
  `classification`, `subject`), `blocking` (the gate's list, each entry with
  `findingId`, `severity`, `location`, `cause`), `proposals` (each with
  `proposalId`, `findingId`, `route`, `evidenceRef`), `outcome`, and
  `createdAt`; write `report.md` beside it in the verification stage's style
  (outcome, worktree, range, panel, one section per finding with every report
  as its own line, the proposals raised, and the terminal sentence that no
  remediation round exists when blocked and a fresh run is the repair). On
  pass: `completeStage(stage.id, resultRef, "pass")` and audit
  `code_review.gate.pass` with a machine-readable summary — `code_review
  gate passed over <base>..<head>; panel=<ids joined by +>; findings=<n>;
  blocking=0; threshold=<severity>`. On block: complete the stage blocked
  with the `resultRef` (the record is the evidence and survives, as
  verification's does), block the run, audit `code_review.gate.block` with a
  summary naming the threshold and each blocking entry as
  `finding=<id>; severity=<s>; cause=<upstream|severity>; location=<loc>`
  plus `proposals=<findingId>:<proposalId>:blocking_dependency:<created|linked>,...`,
  and return `code_review blocked: finding id(s) <id> (<severity>,
  <cause>, <location>)...; threshold <t>`. The wedge guard: an unexpected
  throw completes an open stage blocked, audits `code_review.stage.failed`,
  blocks the run, and returns.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

**Task completion evidence:** `src/code-review-stage.ts` typechecks with every
precondition, the panel loop, the location and frozen-vocabulary checks, the
pure gate over the frozen order, the proposal write, the exported record
type, and the wedge guard in place; the two path helpers are pinned; `plan`
is an upstream source. No behaviour is claimed until Task 6 exercises it.

### Task 4: the reviewer prompt states every constraint the gate acts on

**Depends on:** Task 3

**Files:**
- Modify: `src/prompts.ts` — `buildCodeReviewPrompt`
- Modify: `src/code-review-stage.ts` — call site
- Validate: `test/prompts.test.ts`

**Steps:**

- **Step 1: the builder.** Add `buildCodeReviewPrompt(agent, specContent,
  planContent, changedPaths, diff, verifiedCommit)` returning a prompt that
  opens `you are the code reviewer ${agent.id} with specialty
  ${agent.specialty}` and states, in the order the two review prompts state
  theirs: the specialty-only reporting rule and that an empty findings array
  is a valid result; that the working directory is the repository checkout
  at commit `<verifiedCommit>`, read-only, with no git commands to run, and
  that the diff below is the complete statement of what changed; the exact
  AgentResult JSON shape with `role: "reviewer"` and
  `proposedContentChanges.findings`; each finding's fields — `severity` one
  of low, medium, high, critical, with one sentence per level (`critical`:
  the change is unsafe or destroys data or state in ordinary use; `high`: the
  change fails to implement an acceptance criterion or a plan task it claims
  to cover, or behaves incorrectly in ordinary use; `medium`: a defect that
  does not fail a criterion; `low`: a nit or a style concern); `classification`
  `current_artifact` when the defect is in the changed code, `upstream` when
  the code cannot be corrected because the approved plan leaves the decision
  unmade; `location` by classification — `current_artifact`: one of the
  changed paths below, exactly as listed, optionally followed by `:<line>`
  where `<line>` is a positive integer, and never a heading, a description,
  or a path that is not listed; `upstream`: exactly
  `upstream:plan:<decision-key>` with the kebab-case 64-character rule and
  the "never invent a heading" sentence the sibling prompts carry;
  `intentKey` lowercase kebab-case within 64 characters; `subject` one
  sentence, and for an `upstream` finding that sentence must state the plan
  decision that is missing, because it is recorded as the title of the
  concern raised against the plan. Then the blocks, each under a fixed heading line
  followed by a blank line: `Changed paths:` with one `- <path>` line per
  entry, `Approved specification:`, `Approved plan:`, and `Diff:` carrying the
  unified diff verbatim. State in the doc comment that the `Changed paths:`
  block shape is a contract the harness fixture scrapes, exactly as the
  implementation prompt says of its scope block, and that the severity rubric
  is a constraint stated because the gate compares severity against a frozen
  threshold (hazard 3): a threshold over an unstated scale is a comparison
  against nothing. Do not tell the reviewer what the threshold is or that a
  severity blocks — the sibling prompts state no consequences, and a reviewer
  writing to a gate is the bias section 12 guards against.
  - Verify: `npm run typecheck`
  - Expected: exit 0, with the stage calling the builder.

- **Step 2: pin it.** In `test/prompts.test.ts` add to `CONSTRAINT_STRINGS`
  the strings that are new to the file: `upstream:plan:`, `Changed paths:`,
  `one of the changed paths below`, `positive integer`, `state the plan
  decision that is missing`, and `fails to implement an acceptance
  criterion`. (`code-findings` is an output kind, not a prompt string; it does
  not belong in the scan.) Add a per-prompt
  test: `buildCodeReviewPrompt(CODE_REVIEWER_CORRECTNESS, "SPEC-TEXT",
  "PLAN-TEXT", ["js/a.js", "css/b.css"], "DIFF-TEXT", "c".repeat(40))`
  contains `code reviewer code-reviewer-correctness`, `Report only findings
  within your specialty: correctness`, `low, medium, high, critical`, each
  rubric sentence's distinguishing phrase, `current_artifact`,
  `upstream:plan:`, `lowercase kebab-case`, `64`, `An empty findings array is
  a valid result`, `read-only`, `- js/a.js`, `- css/b.css`, `SPEC-TEXT`,
  `PLAN-TEXT`, `DIFF-TEXT`, and the commit; and does not contain `high or
  critical blocks` or the word `threshold`. Add the two agent imports.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: green.

- **Step 3: break it.** Delete the rubric sentence for `high` and confirm the
  per-prompt test fails; restore. Delete the `Changed paths:` heading and
  confirm both the scan and the per-prompt test fail; restore.
  - Verify: `node --test test/prompts.test.ts` after each mutation and restore
  - Expected: each mutation fails the named assertions.

**Task completion evidence:** The prompt states every field the validator and
the gate act on, pinned by the whole-file scan and a per-prompt test observed
failing under mutation, and it names no consequence a reviewer could write to.

### Task 5: the CLI surface

**Depends on:** Task 4

**Files:**
- Modify: `src/cli.ts` — `USAGE`, `known`, new `review` case
- Validate: `test/cli.test.ts`

**Steps:**

- **Step 1: the command.** Add `review --run <id> [--model <name>]` to
  `USAGE` between `verify` and `deliver`, described as "run the code_review
  stage: a fixed reviewer panel reads the verified change; a finding at or
  above the frozen severity blocks the run". Add `review` to `known` and a
  `case "review"` that mirrors `case "implement"`: load the run, refuse a
  missing run, `loadVerifiedProfile`, call `runCodeReviewStage(store,
  verified.profile.executor, { runId, requestedModel: optional(args,
  "model"), rootDir: process.cwd() })`, print `result.resultRef` on success,
  the reason and exit 1 otherwise. `--model` is accepted because the stage
  dispatches, unlike `verify` and `deliver`, and the frozen-model mismatch
  refusal is the stage's.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- **Step 2: the CLI tests.** In `test/cli.test.ts`, beside the `deliver` block,
  add: the usage text introduces `review` (regex on the usage line); `review`
  without `--run` is a usage error (exit 2); `review --run 9999` exits 1
  naming the run and creates no `.governance/code-review` directory; `review`
  on a fresh run exits 1 with `last stage is none, not a passed verification`.
  Do not touch `parkVerifiedRun` or the `deliver` tests here: delivery still
  requires a passed `verification` as its last stage until Task 7, so
  appending a `code_review` row now would fail every `deliver` test in the
  interval. Task 7 Step 1 makes that change together with the delivery
  change. The CLI happy path for `review` needs Task 6's fixture and is written
  there.
  - Verify: `node --test test/cli.test.ts`
  - Expected: green.

**Task completion evidence:** `bw review` exists, refuses by name, and the CLI
tests pin the usage text and the refusals.

### Task 6: the harness fixture and the stage tests

**Depends on:** Task 5

**Files:**
- Create: `test/fixtures/harness/emit-code-review.mjs`
- Create: `test/code-review-stage.test.ts`
- Validate: both, plus `test/cli.test.ts`

**Steps:**

- **Step 1: the fixture, built from the prompt.** Read stdin; scrape the
  agent id from `you are the code reviewer (\S+)` and the changed paths from
  the `Changed paths:\n\n([\s\S]*?)\n\n` block, throwing when either is
  absent (a broken fixture must fail loudly, never pass by falling back to a
  literal — hazard 4, the same rule `emit-implementation-stage.mjs` states).
  Read `base.txt` from the process working directory and embed its content in
  the AgentResult `summary`, so a retained raw output carrying the worktree's
  marker proves the harness ran with its cwd set to the worktree. Dispatch on
  `EMIT_MODE`: `ok` returns an empty findings array for every reviewer;
  `low` returns one `low` `current_artifact` finding at the first changed
  path from `code-reviewer-correctness` and nothing from the other;
  `high` returns one `high` finding at `<first path>:12` from
  `code-reviewer-security` and nothing from the other; `shared` returns the
  same location and intentKey from both reviewers, `high` from one and `low`
  from the other; `upstream` returns one `low` finding with classification
  `upstream` at `upstream:plan:missing-rounding-decision` from
  `code-reviewer-correctness` and nothing from the other; `bad-location` returns an
  `upstream` finding whose location lacks the prefix (the shared validator's
  refusal); `unchanged-path` returns a `current_artifact` finding at
  `README.md`, a path the fixture commits at the base and never changes;
  `bad-line` returns a `current_artifact` finding at `<first path>:0`;
  `non-proposed` returns `status: "failed"`; `mutate`
  writes `reviewer-residue.txt` into the cwd and then returns as `ok`;
  `prose` prints prose with no JSON. Wrap every result in the claude-shaped
  envelope the sibling fixtures emit. Then add the CLI happy path in
  `test/cli.test.ts`: create a run through the CLI, park it through
  `parkVerifiedRun` (which after Task 7 also appends a hand-completed
  `code_review` row — for this test call the parking helper's verify-only
  half, so add a `throughCodeReview` option to it in Task 7 and pass `false`
  here, or in this task split the helper so the `verify` step and the
  hand-completed `code_review` step are separately callable), rewrite the
  frozen profile's `executor` to a fixture executor whose command is
  `node test/fixtures/harness/emit-code-review.mjs` with `EMIT_MODE` in its
  passthrough (the `freezeExecutorIntoProfile` pattern from
  `test/spec-stage.test.ts`, inlined since `test/cli.test.ts` already imports
  `canonicalJson`, `sha256Hex`, and `openStore`), run `review`, and assert
  exit 0, stdout equal to `codeReviewEvidenceRef(runId, "result.json")`, a
  passed `code_review` stage, two `agent_run` rows with `role = 'reviewer'`,
  and `verify-audit` still `chain valid`.
  - Verify: `node --test test/cli.test.ts`
  - Expected: green.

- **Step 2: the test fixture.** In `test/code-review-stage.test.ts` write
  `withVerifiedRun(fn, opts)` by combining `test/delivery-stage.test.ts`'s
  `withDeliveryRun` (real repository, spec written and gated, approval row,
  worktree on the run branch, projections committed, declared files committed,
  implementation gate event, the real `runVerificationStage`) with
  `test/implementation-stage.test.ts`'s plan setup: write `plan.md` beside the
  spec, insert `plan` and `plan_review` rows with the plan path as
  `output_ref`, and append a `plan.gate.pass` event carrying
  `planHash=<sha256 of normalized plan>; planFor=<spec hash>` in the shape
  `runImplementationStage`'s regex parses. Freeze the fixture executor into
  the profile with `EMIT_MODE` in its passthrough and `withMode` around each
  call. Keep `base.txt` committed at the base so the marker read works, and
  commit `README.md` at the base too, unchanged by the run, so the
  `unchanged-path` mode names a real file that is outside the changed set.
  Accept `opts` for: `commitFiles`, `implementationOnly` (skip verification
  so the last stage is `implementation`), and `mode`.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: the fixture builds and one placeholder test passes; remove the
    placeholder before Step 3 lands.

- **Step 3: the pass path.** Assert: result ok; the stage is `code_review`,
  `passed`, `gate_result pass`, `input_stage_id` equals the verification
  stage; the run stays `in_progress`; exactly two `agent_run` rows for the
  stage, both `role = 'reviewer'`, agents `code-reviewer-correctness` and
  `code-reviewer-security` in that order; each row's `raw_output_ref` file
  contains the worktree's `base.txt` content (cwd proof); the record at
  `resultRef` carries `changedPaths` equal to the committed files, `panel`
  equal to the two ids, `outcome: "pass"`, `blocking: []`, `proposals: []`,
  `blockingSeverity: "high"`, `severities` equal to the frozen list;
  `report.md` exists; a `code_review.gate.pass` event whose summary
  matches `/findings=0; blocking=0; threshold=high/`; `verifyAuditChain` null.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 4: findings below the threshold pass and are retained.** Mode `low`:
  passes; one canonical finding row for the stage with `round = 1`; one
  report row with severity `low`, classification `current_artifact`; the
  record's `findings` lists it; the gate summary says `findings=1;
  blocking=0`; a `code_review.finding.record` event names it.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 5: a finding at the threshold blocks.** Mode `high`: result not ok
  with reason matching `/code_review blocked: finding id\(s\) \d+ \(high,
  severity, [^)]+:12\).*threshold high/`; the stage is `blocked` with `gate_result block` and its
  `output_ref` is the record ref (the evidence survives); the run is
  `blocked`; the record has `outcome: "block"` and one entry in `blocking`;
  a `code_review.gate.block` event; the worktree still exists; both reviewers
  were still dispatched (two `agent_run` rows — the panel completes before
  the gate decides, as the spec panel does).
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 6: the gate reads the frozen threshold and the frozen order.**
  Re-freeze the profile (the `refreeze` helper from
  `test/verification-stage.test.ts`, copied) with
  `codeReviewBlockingSeverity: "critical"` and run mode `high`: passes with
  `blocking=0`. Re-freeze with `"low"` and run mode `low`: blocks naming the
  finding. Re-freeze with `severities: ["critical", "high", "medium", "low"]`
  — the live list reversed — and the seeded threshold `high`, then run mode
  `low`: blocks, because in the frozen order `low` indexes above `high`; a
  gate indexing the live `SEVERITIES` passes it. Also assert the record's
  `severities` is the reversed list. A stage reading either live constant
  fails at least one of the three.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 7: one canonical finding, two reports.** Mode `shared`: exactly one
  finding row and two report rows on it with severities `high` and `low`
  from the two different `agent_run` ids; the run blocks; the blocking list
  names the finding once with severity `high`.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 8: an upstream finding blocks for a human at any severity and
  becomes a proposal.** Mode `upstream` (a `low` upstream finding, with mode
  `low` from Step 4 as the contrast — a `low` `current_artifact` finding
  passes under the same `high` threshold): the result is not ok with cause
  `upstream`; the stage is `blocked` with the record ref as `output_ref`; the
  run is `blocked`; the report row's classification is `upstream` and the
  finding's location is the exact token; the record's `blocking` has one
  entry with `cause: "upstream"`, `severity: "low"`, and `location:
  "upstream:plan:missing-rounding-decision"`; the `code_review.gate.block`
  summary contains `cause=upstream`,
  `location=upstream:plan:missing-rounding-decision`, and the finding id;
  exactly one `proposal` row exists for the stage with route
  `blocking_dependency` and `title` equal to the fixture's subject, with a
  `proposal_source` link to the finding, an evidence file at
  `proposalEvidenceRef(runId, "finding-<id>.json")` whose
  `candidate.whyUpstream` names the decision key and whose `severity` on the
  evidence's rationale reads `low`, a `code_review.proposal.record` event, the
  record's `proposals` naming the row, and the gate summary's `proposals=`
  naming it as `<findingId>:<proposalId>:blocking_dependency:created`. Mode
  `bad-location`:
  aborts with `code_review.reviewer.failed` and a reason matching `/is not
  upstream:plan:<decision-key>/`, the run blocks, no record file is written.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 8a: a `current_artifact` location must be a changed path.** Mode
  `unchanged-path`: aborts with `code_review.reviewer.failed`, the reason
  names `README.md` and says it is not one of the changed paths, the run
  blocks, no finding rows exist, no record is written. Mode `bad-line`: aborts
  the same way naming the `:0` suffix. Add a direct unit test of
  `validateCodeReviewLocations` with `changedPaths` `["js/a.js", "css/b.css"]`:
  accepts `js/a.js`, `js/a.js:12`, `css/b.css:1`; refuses `js/a.js:0`,
  `js/a.js:x`, `js/a.js:1:2`, `js/a.jsx`, `js/`, `## Acceptance criteria`, and
  an empty changed set with any location; ignores `upstream` reports.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 9: the read-only boundary.** Mode `mutate`: aborts with
  `code_review.worktree.dirty`, the reason names `reviewer-residue.txt`, the
  run blocks, no finding rows exist, no record is written. Mode
  `non-proposed`: aborts with the "must not pass the gate by absence" wording.
  Mode `prose`: aborts with `body refused`.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 10: every precondition, refused by name before the stage row.**
  One test each, asserting no `code_review` row exists and the run stays
  `in_progress` after the refusal: nonexistent run; run not in progress;
  second stage refused naming the first's status; `implementationOnly` (last
  stage is `implementation (passed), not a passed verification`); missing
  worktree; worktree head moved (an empty commit in the worktree, as the
  verification test does); dirty at entry (`not clean before code review`);
  profile modified since intake; run past the frozen duration limit
  (backdated `created_at`, one-second limit); verification record deleted
  (`is missing`); verification record edited to `outcome: "block"` (`is
  invalid`); spec file edited after approval (`the spec has changed since
  approval`); plan file edited after the gate (`the plan has changed since
  review`); `plan.gate.pass` event absent; `verification.gate.pass` event
  absent (delete the row from the audit table in the fixture as the delivery
  test does, and assert the refusal names the event and that no `agent_run`
  row exists — nothing was dispatched); executor frozen without the
  `review` capability (`lacks the required capability "review" for stage
  kind code_review`); `--model` disagreeing with the frozen model; frozen
  agents with one code reviewer removed (the staffing refusal at the stage
  boundary, worded as freeze words it).
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 11: the wedge guard.** Occupy the evidence directory's path with a
  file so `mkdirSync` throws inside the guarded body, exactly as the
  verification test does; assert the stage is `blocked`, the run is
  `blocked`, a `code_review.stage.failed` event exists, and the chain is
  valid.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: green.

- **Step 12: break every guard.** In turn: change `>=` to `>` in
  `codeReviewGate` (Step 5's test and Step 6's `low` half fail); read
  `CODE_REVIEW_BLOCKING_SEVERITY` instead of the frozen value (Step 6 fails
  and `test/policy.test.ts`'s import scan fails); pass `SEVERITIES` to the
  gate instead of `profile.policy.severities` (Step 6's reversed-order test
  fails); drop the `upstream` cause so upstream findings gate by severity
  alone (Step 8's `upstream` mode passes instead of blocking, so the test
  fails); skip the proposal write (Step 8's proposal row, evidence file, and
  event assertions fail); skip `validateCodeReviewLocations` (Step 8a's two modes
  pass instead of aborting); drop the post-dispatch cleanliness check (Step
  9's `mutate` fails); drop the `verification.gate.pass` precondition (Step
  10's new case dispatches and fails); hard-code `round` to 2 (Step 4's
  `round = 1` assertion fails); skip the `code_review.gate.pass` audit (Step 3
  fails); pass `upstreamPrefixFor("design")` instead of `"plan"` (Step 8
  fails); remove the empty-changed-set refusal and commit no files (a new
  test with `commitFiles: []` expects the refusal — add it, then break it).
  Restore each by editing back.
  - Verify: `node --test test/code-review-stage.test.ts` after each mutation
    and restore
  - Expected: each mutation fails the named test and nothing else; a mutation
    that changes nothing means the test is not reaching the branch, in which
    case fix the test rather than the assertion.

**Task completion evidence:** The stage passes, blocks on severity, blocks
on an upstream finding at any severity and raises a proposal for it,
refuses, and wedges exactly as specified, driven through a fixture that
builds its findings from the prompt, with every guard observed failing under
a targeted mutation and the CLI happy path green.

### Task 7: delivery reads past the new stage

**Depends on:** Task 6

**Files:**
- Modify: `src/delivery-stage.ts` — the last-stage check, the code-review
  record read, the verification record lookup, the gate-event checks
- Modify: `test/delivery-stage.test.ts` — `withDeliveryRun`, the wording test,
  the new record and gate-event tests
- Validate: `test/delivery-stage.test.ts`, `test/cli.test.ts`

Section 4 says a stage's `output_ref` is literally what the next stage is
handed, so delivery reads the code-review record from `last.output_ref`,
parses it strictly, and only then walks back to the verification record the
code-review record names. Two records, both validated, cross-checked against
each other.

**Steps:**

- **Step 1: the failing fixtures first.** In `withDeliveryRun`, after the
  verification stage is established, insert a `code_review` stage with the
  verification stage as input, write a real record at
  `codeReviewEvidenceDir(rootDir, run.id)/result.json` of the exported
  `CodeReviewRecord` shape (import the type and the two path helpers) whose
  `runId`, `stageId`, `worktreePath`, `patchBase`, and `verifiedCommit` are
  the fixture's own values, `changedPaths` the committed files, `panel` the
  two seeded ids, `blocking: []`, `proposals: []`, `outcome: "pass"`;
  complete the stage `pass` with `output_ref` `codeReviewEvidenceRef(run.id,
  "result.json")`, and append a `code_review.gate.pass` event, unless
  `opts.noCodeReviewGateEvent` is set, in which case complete the stage
  without the event. Add `opts.blockedCodeReview`: write the record with
  `outcome: "block"` and one `blocking` entry `{ findingId: 1, severity:
  "low", location: "upstream:plan:missing-rounding-decision", cause:
  "upstream" }`, complete the stage `block`, and block the run — the shape
  Task 6 Step 8 produces. Add `codeReviewStageId` to `Ctx`. Update the
  pass-path assertion `stage.input_stage_id` from `verificationStageId` to
  `codeReviewStageId`. Change the wording test at "a last stage that is not a
  passed verification" to use `blockedCodeReview` and expect `last stage is
  code_review (blocked), not a passed code_review` — this is the regression
  the operator asked for by name: delivery cannot follow a blocked review. In
  `test/cli.test.ts`, extend `parkVerifiedRun` so that after `verify` passes
  it appends the same hand-built `code_review` row, record file, and
  `code_review.gate.pass` event, by hand through the store exactly as it
  appends the implementation stage and its event — there is no executor seam
  in the CLI, as the helper's own comment says — behind the option Task 6's
  happy path needs to bypass it; and change the `deliver` refusal test's
  expected wording from `not a passed verification` to `not a passed
  code_review`.
  - Verify: `node --test test/delivery-stage.test.ts test/cli.test.ts`
  - Expected: nearly every delivery test fails with `not a passed
    verification` — the regression Step 2 turns green.

- **Step 2: the two records, strictly.** In `runDeliveryStage`, require the
  last stage to be a passed `code_review` with an `output_ref` (`run N's last
  stage is X (status), not a passed code_review`). Read the code-review record
  from `last.output_ref`, refusing `is missing` and `is invalid` with the
  verification record's two message shapes, where invalid means any of:
  `runId` not this run; `stageId` not `last.id`; `outcome !== "pass"`;
  `blocking` not an empty array; `worktreePath`, `patchBase`, or
  `verifiedCommit` not strings matching the commit pattern where a commit is
  expected; `changedPaths` not a non-empty string array. Import the type
  `CodeReviewRecord` from `src/code-review-stage.ts` for the parsed shape.
  Then locate the verification stage as `chain.find((s) => s.kind ===
  "verification")`, refusing by name when it is absent, not passed, or
  without `output_ref`; read and validate its record exactly as today against
  that stage's id; and refuse `is invalid` on the code-review record when its
  `worktreePath`, `patchBase`, or `verifiedCommit` differs from the
  verification record's — the review must have read the range delivery is
  about to certify. Insert the `delivery_check` stage with the code_review
  stage as its input. Keep every other check exactly as it is. Add, beside
  the `verification.gate.pass` check, the same check for
  `code_review.gate.pass` with the same wording pattern: a run completing
  without it would carry a delivery verdict over an audit that never records
  the review passing. Update the module comment's chain description and the
  local `VerificationHandoff` comment to say two records are read.
  - Verify: `node --test test/delivery-stage.test.ts test/cli.test.ts`
  - Expected: green, including the `parkVerifiedRun` chain.

- **Step 3: the new refusal tests.** Add, mirroring the existing verification
  ones: "a passed code_review whose gate event is absent refuses: the audit
  must record the outcome" (`noCodeReviewGateEvent`); "a missing code-review
  record refuses by name" (delete the file after the fixture builds, expect
  `is missing`); "a code-review record edited to outcome block refuses"
  (rewrite `outcome` and add a `blocking` entry, expect `is invalid`); "a
  code-review record naming a different verified commit refuses" (rewrite
  `verifiedCommit` to another commit-shaped string, expect `is invalid`); and
  assert in each that no `delivery_check` row exists and the run stays
  `in_progress`.
  - Verify: `node --test test/delivery-stage.test.ts`
  - Expected: green.

- **Step 4: break it.** Remove the `code_review.gate.pass` check and confirm
  its test fails; restore. Drop the `outcome` check on the code-review record
  and confirm the edited-record test fails; restore. Drop the cross-check
  against the verification record and confirm the different-commit test
  fails; restore. Read the verification record from `last.output_ref` and
  confirm the pass path fails on the record's stage id; restore.
  - Verify: `node --test test/delivery-stage.test.ts` after each mutation and
    restore
  - Expected: each mutation fails the named test.

**Task completion evidence:** Delivery requires a passed `code_review` as its
input and a `code_review.gate.pass` event, strictly parses the code-review
record it is handed and cross-checks it against the verification record it
names, refuses a blocked review, a missing or edited record, and a mismatched
range, and every delivery and CLI test is green with the new stage in the
chain.

### Task 8: the binding documents, the checker pins, and the driver

**Depends on:** Task 7

**Files:**
- Modify: `ARCHITECTURE.md` — sections 5, 12, 15, 23
- Modify: `scripts/doc-check.mjs` — `PINNED_SEQUENCE`, `PINNED_DEFERRED`
- Modify: `CLAUDE.md`, `README.md`
- Modify: `.claude/skills/run-buildworks/driver.mjs`,
  `.claude/skills/run-buildworks/SKILL.md`
- Validate: `npm run check:docs`, `node .claude/skills/run-buildworks/driver.mjs smoke`

**Steps:**

- **Step 1: section 5, and confirm the checker fails before the pins move.**
  Insert `code_review` between `verification` and `delivery_check` in the
  sequence fence, keeping the fence's two-line shape; remove `code_review`
  from the deferred list and change "Deferred until the above completes end
  to end at least once" to say the loop closed on 2026-09-03 and the operator
  lifted the stop for one stage, the code review, on 2026-09-04, naming the
  five that remain deferred. Write that sentence without backticks around any
  lowercase identifier: `derive()` reads section 5's deferred list as every
  backticked `[a-z_]+` token in the whole section, so a backticked stage name
  in the new prose would be counted as a deferred stage and fail the pin.
  The decision record itself belongs in sections 12 and 23 (Steps 3 and 4),
  which the checker does not parse.
  - Verify: `npm run check:docs`
  - Expected: exit 1 with `sequence` and `deferred` errors pointing at section
    5 and no other new error. This is the break-test the doc-check skill
    requires: the pins fired on a real difference.

- **Step 2: move the pins.** In `scripts/doc-check.mjs` insert `"code_review"`
  after `"verification"` in `PINNED_SEQUENCE` and remove it from
  `PINNED_DEFERRED`. Do not describe either as derived; the comment above them
  already says they are tripwires.
  - Verify: `npm run check:docs`
  - Expected: `sequence` and `deferred` clean; the remaining sections not yet
    edited produce no error.

- **Step 3: section 12 — the gate paragraph and the deferral.** After the
  `verification` paragraph and before `delivery_check`, add a `code_review`
  paragraph stating: the stage seats a fixed panel of every registered code
  reviewer (role reviewer, output kind `code-findings`, bound to the frozen
  executor), hands each the approved specification and plan, the changed
  paths, and the unified diff of the recorded patch range, with the worktree
  at the verified commit as the read-only working directory; asserts the
  worktree is at that commit and clean before the stage row exists and after
  every dispatch; records every report as immutable evidence on a canonical
  finding exactly as the two review stages do; and passes when no report
  carries a severity at or above the threshold frozen in the profile,
  blocking otherwise by finding id and severity. State what the gate proves
  and does not, as the `addressed` paragraph does for its checks: it proves no
  reviewer asserted a severity at or above the threshold, never that the code
  is correct, and nothing confirms a below-threshold finding was harmless.
  Say why severity gates here when section 12 removed it from the two review
  stages: there is no reconciliation dispatch and no decision to be complete,
  and blocking on any finding would make the default installation unable to
  complete a run (hazard 11). Say the panel is fixed and item 4's selection is
  deferred. Say where an upstream finding goes, so section 13's rule holds for
  this stage too: a code reviewer's upstream finding carries `upstream:plan:`
  and blocks the run for a human at any severity, its finding id and decision
  key retained in the record and the gate event, and every one becomes a
  non-binding `blocking_dependency` proposal with retained evidence, which
  only a human promotes; a fresh run is the repair.
  Describe the two reviewers as separately dispatched and recorded as
  `configured_standalone`, never as independent — section 6 says what that
  label proves. State the reach limit: the prompt carries the specification,
  the plan, and the full diff under the frozen prompt ceiling, and a change
  that exceeds it is refused after implementation has spent, never reviewed
  in part. In the deferred-behaviours subsection change "Three behaviours" to
  five and add two bullets. **Code-review remediation.** `code_review` blocks
  terminally on a report at or above the frozen severity or on an upstream
  finding; no reconciliation dispatch, patch round, or re-review exists, and
  a fresh run is the repair. **Operator waiver.** No human can read a
  code-review finding, judge it wrong or over-graded, and let the run
  continue; a fresh run against the same design and model varies nothing
  (hazard 7), so a mistaken block ends at the design or the rubric. A waiver
  would be a signed operator decision recorded against the finding id, in the
  approval's shape, and is not built. Rewrite the subsection's closing
  sentence: the stop at step 9 was lifted for exactly one deferred stage,
  `code_review`, by operator decision on 2026-09-04; the five behaviours here
  and the five stages still listed in section 5 each need their own.
  - Verify: `npm run check:docs`
  - Expected: clean for these checks; section 12 is prose the checker only
    path-scans.

- **Step 4: section 15 and section 23.** Add `code-review/<run>/` to the
  storage layout fence between `delivery/<run>/` and the closing fence, in
  the fence's style: the retained review record, `result.json` (changed
  paths, panel, every finding with every report, the blocking list, the
  outcome) and its `report.md` companion; the `code_review` stage's
  `output_ref` references the structured record. `checkLayout` requires only
  that the four named entries remain and `migrations/` stays absent, so an
  added entry is safe. In section 23, extend step 10 with a parenthetical:
  `code_review` was the first, by decision on 2026-09-04.
  - Verify: `npm run check:docs`
  - Expected: clean.

- **Step 5: `CLAUDE.md` and `README.md`.** In `CLAUDE.md`'s "The architecture
  is binding" section, after the step-9 sentence, add one sentence: that
  decision was taken once, on 2026-09-04, for `code_review` only, and no
  other deferred stage inherits it. Add `review` to the CLI command list in
  "Commands" between `verify` and `deliver`. In `README.md`'s Status paragraph
  add the code-review stage after the delivery stage sentence in the same
  register (`bw review` — a fixed panel of two code reviewers reads the
  verified change against the approved specification and plan; every finding
  is recorded; a finding at or above the frozen severity, or one whose cause
  is in the plan, blocks the run), and
  amend the closing sentences so "All eight build-order stages now exist" and
  the milestone sentence remain true and say the first post-milestone stage
  exists by explicit decision.
  - Verify: `npm run check:docs`
  - Expected: clean; both are `current` tier, so any path they cite must
    resolve.

- **Step 6: the driver and its skill document.** In `driver.mjs`'s
  `paidChain`, add `step("review (fixed panel + gate)", { exit: 0, match:
  /result\.json/ }, () => bw(["review", "--run", runId]))` between `verify`
  and `deliver`, and extend the terminal-state step's expectation and query to
  include `code_review=passed`. In `freeSmoke`, add `step("review refuses
  without a passed verification", { exit: 1, match: /not a passed
  verification/ }, () => bw(["review", "--run", runId]))` after the `verify`
  refusal, making the smoke thirteen steps. In `SKILL.md`: add `review` to the
  frontmatter description's command list and the paid-chain sequence; change
  "Twelve steps" and `12/12` to thirteen and `13/13` and add the new line to
  the verified-output block with a note that the block is now the
  post-`code_review` shape; add `review` to the "unrelated" gotcha so the
  four commands are distinguished; state the new budget ($1.25 to $2.50) and
  why (two reviewer dispatches on the full diff plus spec and plan); and add
  a paid-chain paragraph saying what the review step asserts and that its
  record lives at `.governance/code-review/<run>/`. The prose test count in
  the Test section is stated as a prose figure doc-check cannot see; update
  it after Task 9's full-suite run.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs smoke` and
    `npm run check:docs`
  - Expected: `13/13 steps as expected`; the checker clean.

**Task completion evidence:** `ARCHITECTURE.md` sections 5, 12, 15, and 23,
`CLAUDE.md`, `README.md`, and the run skill assert the chain as it now is;
the two pins moved and were observed firing first; the free smoke is thirteen
of thirteen.

### Task 9: hazard 18, the isolated full suite, and the gate

**Depends on:** Task 8

**Files:**
- Modify: `docs/hazards.md` — new entry 18
- Modify: `ARCHITECTURE.md` — section 22, the count and the list
- Validate: `npm run check:docs`, `npm run typecheck`, `npm test` in an
  isolated copy

**Steps:**

- **Step 1: record the failure mode where hazards live.** Add `## 18. Delivery
  proven, correctness never inspected` to `docs/hazards.md`: a chain can
  prove that every declared path was committed (entry 5's remedy) and that
  the frozen commands passed, and still have had nothing read the code.
  Record the observation as what it is: the 2026-09-04 web-calculator run,
  $1.34097, delivered four artifacts and passed every gate; its verification
  commands were `node --version` and `npm --version`, which prove nothing
  about a calculator, and `delivery_check` proved existence in the patch
  range. The calculator worked, established by opening it by hand; the system
  had no opinion. This is a gap found by reading a completed run's record, not
  a filed defect, and the entry says so as entries 16 and 17 do. Then the
  requirement and what now enforces it: before a run may complete, at least
  two separately dispatched reviewers, each recorded as
  `configured_standalone` (section 6 — the audit can prove a separate
  process, never independence), must have read the committed change against
  the approved specification and plan, every finding must be retained as
  attributable evidence, and a deterministic gate over those findings must sit
  between verification and delivery — the `code_review` stage, its fixed
  panel, the frozen severity threshold, and the upstream block with its
  proposal. State the residual honestly: the gate proves that no reviewer
  asserted a severity at or above the threshold or placed a defect's cause in
  the plan, and a verification configuration that proves nothing is still
  accepted; a stronger `governed.yaml` is the operator's, not the system's.
  - Verify: `npm run check:docs`
  - Expected: `hazardCount` fails — section 22 still says seventeen. That is
    the checker firing on a real difference; Step 2 fixes the document.

- **Step 2: section 22.** Change "seventeen" to "eighteen" and append the new
  mode to the list sentence in its style: "and a delivery proven complete that
  nothing ever read".
  - Verify: `npm run check:docs`
  - Expected: clean.

- **Step 3: the isolated full suite.** Copy the working directory, `.git` and
  `node_modules` included, to a path outside the repository; run `npm test`,
  `npm run typecheck`, and `npm run check:docs` there; then `git status
  --short` and `git log -1 --oneline` in both the copy and the real
  repository. The baseline is the 2026-09-04 count recorded in
  `.claude/sessions/project-learnings.md`: 711 tests, 710 passing, 0 failing,
  1 environmental skip. Record the new counts. If the copy shows a leaked
  commit or file, record the delta as evidence toward the untraced root cause
  and stop; do not repair the copy and do not touch the real repository's
  history without the operator's explicit authorization. Delete the copy
  afterwards. Update the prose test count in
  `.claude/skills/run-buildworks/SKILL.md` to the new figure.
  - Verify: as stated
  - Expected: zero failures, one skip, `HEAD` unmoved in both trees, only this
    plan's files modified in the real repository.

**Task completion evidence:** Hazard 18 exists and section 22 counts it; the
full suite, the type check, the doc check, and the free smoke pass with the
real repository provably untouched.

### Task 10: the recorded real response, and what it can and cannot settle

**Depends on:** Task 9

This task is load-bearing, not supplementary. Section 21 names contract tests
fed by recorded real output as the verification category that pays, and hard
rule 5 says no hand-written fixture defines correctness; `emit-code-review.mjs`
proves the stage matches its author's reading of the contract, and only a
real reviewer response proves the contract with the provider — the wrapper,
the field shapes, the case of a constrained field, the form a real reviewer
gives a location. Until one such response is committed and replayed the plan
is awaiting contract evidence and is not complete. A paid run cannot be aimed
at a finding of a particular severity — the driver commits one fixed design,
and what the reviewers report is the model's choice — so an outcome is
recorded, never fished for.

**Files:**
- Create: `docs/features/code-review-stage/real-run-evidence.md`
- Create: `test/fixtures/recorded/code-review-web-calculator-<what>.json`
- Modify: `test/code-review-stage.test.ts` — the replay test
- Validate: the retained scratch target's run store, `node --test
  test/code-review-stage.test.ts`

**Steps:**

- **Step 1: state the cost and obtain the authorization.** Comparable chains
  cost $1.34097 with eleven dispatches; this one adds two reviewer dispatches
  over a diff of about four files plus the specification and plan, so state
  $1.25 to $2.50 before running. Do not start without an explicit
  authorization and a working `claude` session, and treat the authorization
  as covering one run.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs paid --yes`
  - Expected: thirteen dispatches, all nine stages passed and the run
    completed, or a block at `code_review` with the finding ids named. Both
    are results.

- **Step 2: read what the panel did, before cleaning anything.** Query the
  retained target's store: the two `agent_run` rows for the `code_review`
  stage (agent, effective model, cost, duration, `raw_output_ref`), every
  `finding` row for the stage with its `finding_report` rows, the
  `code_review.gate.pass` or `code_review.gate.block` event, and the record
  at `.governance/code-review/<run>/result.json`. Query before any
  `driver.mjs clean`; clean deletes the only record.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs report --dir
    <target>` plus a direct read of the store
  - Expected: one of the outcomes below, identified by evidence.

- **Step 3: copy the response into the repository now, and replay it.** For
  at least one reviewer's retained raw output — prefer the one that reported
  findings, then the one the stage refused, and if both are empty take the
  first — extract the harness envelope
  as retained, the prompt's changed-paths block, the frozen `severities` and
  `codeReviewBlockingSeverity` in force, and the stage's recorded verdict into
  `test/fixtures/recorded/code-review-web-calculator-<what>.json` with a
  `provenance` block (run, dispatch time, capture date, what was dropped from
  the envelope and why), sanitized only of absolute machine paths. Add a
  replay test in `test/code-review-stage.test.ts` that drives the committed
  copy through the same chain the stage runs: `extractJsonBody`,
  `validateAgentResult`, `validateReviewerReports` with the plan prefix,
  `validateCodeReviewLocations` against the recorded changed paths, and
  `codeReviewGate` with the recorded threshold and order, asserting the
  recorded verdict — which may be a refusal: a response the stage refused is
  replayed to the same refusal, by reason. A response with an empty findings
  array still exercises the envelope, the result shape, and the gate's pass
  path, and the test says so in its name. Never schedule this for later: the
  target is machine-local and `driver.mjs clean` deletes it.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: the replay passes from the committed copy with the target
    untouched.

- **Step 4: record the outcome under its own name.** Write the run's
  identifiers, cost, per-dispatch figures, the finding rows, the gate event,
  and the retained target path into the evidence document with a
  `**Hazards considered:**` line. Do not round the outcome up.
  - Verify: `npm run check:docs`
  - Expected: clean; the document is historical tier, so path findings in it
    are warnings.

**Task completion evidence:** One of five recorded outcomes. Two complete
this task, one leaves it open, and two end in a decision for the operator.

1. **No paid run authorized.** The task is not complete and neither is the
   plan. Write the evidence document anyway, stating that the stage is
   awaiting contract evidence, what the deterministic tests do prove, and
   that no claim about a live reviewer's output is made; leave the plan's
   status at `Proposed` with the code committed. The alternative — calling
   the plan complete on hand-written emitters alone — is the binding
   verification rule in section 21 changed by omission, and only the operator
   changes that rule.
2. **Completed with findings below the threshold.** The panel read the code,
   recorded findings, and the gate passed. Record the findings verbatim and
   replay the response per Step 3; this is the first evidence that a live
   reviewer returns the report shape and location form this stage validates.
   Complete.
3. **Completed with an empty panel.** Both reviewers returned no findings.
   Replay one response per Step 3: it proves the envelope, the result shape,
   and the pass path live, and proves nothing about the finding or location
   contract. Record it as exactly that, name the finding-path contract as
   still unverified live, and do not rerun to fish for a finding (hazard 7).
   Complete for what it exercised.
4. **Blocked on a finding at or above the threshold, or on an upstream
   finding.** Replay the response per Step 3 either way. Then read the
   finding against the code. If the code is wrong as the reviewer says, or
   the plan really left the decision unmade, the stage did its job on its
   first live run and the block is the evidence this plan was written for;
   record it as a success of the gate, not a defect, and complete. If the
   finding is wrong, over-graded, or mis-classified upstream, that is the
   threshold, the rubric, or the upstream route landing badly in production,
   and it is a design decision for the operator: record it, name the
   candidate remedies (a rubric change, a different frozen threshold), apply
   none, and stop.
5. **Aborted on a malformed report.** A reviewer returned a location the
   validator refuses — a line range `path:12-18`, a column `path:12:5`, a
   parenthetical, a path outside the changed set — or a severity or shape the
   shared validator refuses, and the stage ended with
   `code_review.reviewer.failed` before any finding row was written. This is
   the likeliest first live outcome, because a line range is the natural
   form for a reviewer to write and the prompt allows one line. Replay the
   refused response per Step 3, asserting the refusal reason, and record it:
   it is contract evidence that the prompt's location rule and the live
   provider's habit disagree, which is exactly what section 21's category
   exists to find. It is not a defect to fix on the spot. Do not loosen the
   validator, the prompt, or the fixture to clear it. Name the candidate
   remedies for the operator — accept `path:<start>-<end>` in the prompt and
   the validator together, both sides at once, because a tolerance applied at
   one boundary and not the other is this repository's recurring defect; or
   keep the rule and tighten the prompt's wording — apply none, and stop. The
   plan stays `Proposed` until the operator decides, as in the illegitimate
   half of outcome 4.

## Gate

This plan is complete when `code_review` sits between `verification` and
`delivery_check` in `ARCHITECTURE.md` section 5 and in `PINNED_SEQUENCE`;
`bw review` runs the stage against the frozen executor and model; the fixed
panel is every registered code reviewer, seeded as two with distinct
specialties, partitioned from the spec and plan panels by the `code-findings`
output kind and proven never to enter `selectReviewers`; every reviewer report
is stored as an immutable `finding_report` on a canonical `finding`; a
`current_artifact` location is one of the changed paths with an optional
positive line, enforced deterministically; the gate blocks at or above
`profile.policy.codeReviewBlockingSeverity`, seeded `high`, ordered by the
frozen `profile.policy.severities`, and reads neither live constant; every
upstream finding blocks for a human with its finding id and decision key
retained, and raises a `blocking_dependency` proposal with retained evidence
for each; the worktree is asserted at the verified
commit and clean before the stage row and after every dispatch; the stage
requires the `verification.gate.pass` event before it dispatches; the record
and report are written under `.governance/code-review/<run>/` and the stage's
`output_ref` names the record; delivery requires a passed `code_review` and
its gate event, strictly parses the code-review record it is handed, and
cross-checks it against the verification record; the prompt states every
constrained field and the severity rubric and names no consequence; section
12 states the gate, what it proves, why severity gates here, where an
upstream finding goes, and the deferred remediation, and no binding document
calls the reviewers independent; section 15 lists the record; hazard 18
exists and section 22 counts it; `CLAUDE.md`, `README.md`, and the run skill
describe the chain as it is; the free smoke is thirteen of thirteen;
`npm test`, `npm run typecheck`, and `npm run check:docs` pass in an isolated
copy with the real repository untouched; every new guard was observed failing
under a targeted mutation and restored; and Task 10 has committed one real
reviewer response with provenance, replayed it through the stage's validators
and gate, and recorded outcome 2, 3, or the legitimate half of 4 under its
own name. Outcome 1 leaves the plan `Proposed` and awaiting contract
evidence; outcome 5 and the illegitimate half of 4 leave it `Proposed` and
awaiting an operator decision on the rubric, the threshold, or the location
form.

The illegitimate half of outcome 4 — a live block on a finding the operator
judges wrong or over-graded — and outcome 5 — a live abort on a location or
report form the validators refuse — are design decisions for the operator
about the threshold, the rubric, or the location form, not defects to work
around. No prompt, fixture, validator, threshold, or gate change may be made
to clear either without that decision.
