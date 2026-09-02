# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-02)

**Shipped:** build order steps 1-7 and step 5b Tasks 1, 2, 3, and 4, on
`master`, head `578d0eb`, tree clean, **committed but not pushed** —
`origin/master` is at `5d63726`, two behind (`974eec0` the learnings
compaction and `578d0eb` Task 4), and `master` is the only local branch.
Verified at `578d0eb`: `npm test` 524 tests / 523 pass / 1 recorded skip / 0
fail; `npm run typecheck` clean; `npm run check:docs` exit 0 with 36 warnings.

**The binding architecture changed** in `60587fc` under operator acceptance,
amending `ARCHITECTURE.md` sections 8, 9, 12, 13, and 20: the five-phase
author-led review flow replaces the closure pass, the author proposes a panel
the system staffs and refuses by name, completion is decision completeness
rather than a severity threshold, canonical identity is round-scoped with every
reviewer report immutable, the panel floor and default are two reviewers, and
one review round is the default. Sections 5, 15's schema block, 23, and
`STAGE_SEQUENCE` are unchanged. The document states both its own limits: an
exact match proves textual occurrence, not logical support, and hashes plus
document gates do not prove a concern was semantically cured.

**In flight — step 5b, Tasks 5-13 open.** Task 5 (author-proposed panel,
deterministic staffing) is next, from
`docs/features/step5b-upstream-findings/plan.md`. It is the task that finally
lets the panel request Task 4 retains influence selection: the
`[2, panelSizeMax]` bound, the union with `requiredSpecialties`, distinct-lens
selection, and the named unstaffable block.

**The round-activation boundary is still the thing to know before touching a
stage.** `specReviewRounds` and `planReviewRounds` are frozen into every profile
and **deliberately not read by either stage**. A configured round means one
complete `panel -> reconcile` cycle, and no reconciliation dispatch exists until
Task 9; wiring the values into the legacy loop would make one configured round
mean one panel and zero reconciliations. Both stages carry an explicitly named
`LEGACY_CLOSURE_PASSES = 3` until Task 9 removes it and activates the frozen
values in the same change. `panelSizeMin` and `materialityThreshold` *are* read
from the frozen profile today, and Task 4 changed none of this.

**Two latent defects in shipped code** remain, both Task 7: `insertFinding`'s
return on the upsert conflict path, and whole-file schema constraint searching.
Each has an auto-memory file with line numbers and reproduction.

**Open and deferred:**

- `974eec0`, `578d0eb`, and `afbbfef` are unpushed. Pushing was offered and
  not requested.
- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record". That file was never
  written. Historical tier, so `check:docs` only warns; the gap is real and
  undecided.
- Report pairs (two reviewers on one canonical finding) were never observed in
  real model output — 9 findings, 9 reports, no pairs. Tasks 6 and 7 must keep
  proving pair preservation by fixture.
- Whether step 5b or step 8 (delivery check) goes first was never explicitly
  decided. Four 5b tasks have now shipped ahead of it by practice; step 8
  remains the next *build-order* step.
- `C:\Users\Shawn-work\repositories\step5b-task1-prototype` — the retained Task
  1 prototype bundle, 441 KB, confirmed still present 2026-09-02. Outside the
  repository, uncommitted, no process attached.
- `VERIFY_RETENTION_MAX_BYTES` is 64 MB — chosen, not derived.
- Filesystem and network containment for verification commands is unbuilt,
  stated as a limitation in `ARCHITECTURE.md` section 17, with
  `docs/proposals/verification-containment.md` filed.
- External configuration of the `.governance` location, and the state migration
  it implies, are deferred out of step 5b by operator decision.
- The build order stops at step 9. Do not build past it without an explicit
  decision.

**Next up:** start step 5b Task 5 (author-proposed panel, deterministic
staffing) from `docs/features/step5b-upstream-findings/plan.md`.

## Diagnostics quick-reference

The durable one-liners live in **auto memory**, which loads automatically —
read `MEMORY.md` there rather than duplicating it here. It carries the
whitespace-collapsing citation match, the unstable `intentKey`, frozen review
defaults, dispatch cost, break-it mechanics, line endings, whole-file guards,
and the source-scanning trap, each with its reasoning and reproduction.

One line memory does not yet carry:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, and PowerShell's BOM each caused one here.

## Session records

### Step 5b Task 4: self-critique contract and prompt (2026-09-02)

`578d0eb`. `src/self-critique.ts` (one shape, both artifacts), both
self-critique prompts, one self-critique dispatch per artifact in each review
stage, and `docs/features/step5b-upstream-findings/2026-09-02-code-review.md`.
No dispatch was paid for: every test runs against the fixture executors.

#### Decisions and assumptions

- **Built uncommitted on master by operator instruction, then committed once
  verified**, so Task 5's break-it passes have a clean `HEAD` to restore to.
- **Task 4 validates the panel request structurally and stops there.** The
  frozen `[2, panelSizeMax]` bound, the union with `requiredSpecialties`, and
  staffing are Task 5's steps, stated there — the plan's own step lists draw the
  line, and crossing it is what Task 3 did with the round counts.
- **Revision A was implemented although Task 4's step list never absorbed it.**
  Nobody rewrote the steps when the operator accepted the prototype result, so
  read a task's governing exit decision, not only its checkboxes.
- **The self-critique dispatch sits on the author's stage row** (`spec`/`plan`),
  before `completeStage`, where the legacy revision dispatch already sits. No
  new stage kind, and `STAGE_SEQUENCE` is untouched.

#### What failed

- **Two of eleven break-it mutations held, and both were defects in the attack.**
  One mutated a line *downstream* of the guard it meant to remove; the other ran
  only the whole-file prompt scan, which cannot see one of two prompts dropping
  a shared sentence. Re-aimed, both were detected.
- **The plan stage carried the code without the proof.** Replacing
  `registeredSpecialties` with `[]` at the plan-side call site left the whole
  suite green; the spec side had the test, the plan side did not.
- **The capability refusal was written beside the dispatch it guards**, so it
  spent a draft invocation before refusing a run that could never complete.
  Moved beside the draft's own output check.

#### What worked

- **Deriving the fixture's self-critique payload from the prototype's recorded
  output** rather than inventing a shape beside the validator.
- **Making the fixture echo what the prompt actually contained.** It scrapes the
  registered-specialty block out of stdin and answers with the first lens it
  finds, so an empty list surfaces as `none-listed` in the audit record. That is
  how a stage-level test can see a prompt.
- **A duplicate key in an object literal is legal and the last one wins** — how
  a scratch fixture overrides one branch's `status` when the obvious anchor now
  matches two branches.

#### Verification

- Eleven break-it mutations across `src/self-critique.ts`, `src/spec-stage.ts`,
  `src/plan-stage.ts`, and `src/prompts.ts`, each restored and confirmed
  byte-identical. Suite results are in Current state.

#### Next time

- **Copying a phase into the sibling stage means copying its test too.** These
  two orchestrators are duplicated on purpose, so nothing structural will notice
  a missing assertion on one side.
- **Put a configuration refusal where the other configuration refusals are.**
  "Fails before a paid invocation" is a property of the whole ordering, not of
  the check that happens to be nearest the code it protects.
- **Assert a shared prompt sentence per prompt, not per file.** The whole-file
  scan is the cheap net and cannot localize.

### Step 5b Tasks 2 and 3: paths module, frozen review config (2026-09-01 to 2026-09-02)

`cd11071` (Task 2, `src/paths.ts`) and `5d63726` (Task 3, the frozen review
configuration). Task 3 was committed as `2c8a71e` and then materially revised
before reaching `origin`; the revision is the substance of this record. Route A
— a profile violating the current policy shape is refused by name in
`loadVerifiedProfile`, no migration and no defaults — was the operator's
decision, and its reasoning is in auto memory.

- **The configured round counts were wired into the legacy closure loop, and
  the resulting behaviour change was announced as intended.** Task 3 says "make
  both stages read these values from the frozen profile"; it *also* defines a
  configured round as one complete `panel -> reconcile` cycle. Acting on the
  first while ignoring the second made one configured round mean one panel and
  zero reconciliation dispatches. Reversed behind `LEGACY_CLOSURE_PASSES = 3`.
  **A task that says "read X from the frozen profile" and also defines what X
  means is two instructions**, and a configuration rename that changes what a
  run does is the signal that only one of them was followed.
- **Two break-it mutations held and would have shipped as "proven"** — each
  guarding a case the seeded registry or an upstream refusal had made
  unreachable. `freezeProfile` gained a narrow `deps.agents` seam on the
  precedent `runPlanStage`'s `selectPanel` already set, rather than a new one.
- **`git checkout -- <file>` during a break-it pass reverted uncommitted work**
  because nothing was staged. Stage before mutating.
- **Tracing the profile consumers settled the decision better than reasoning
  about it did:** no stage read panel size or rounds from the profile at all,
  and `loadVerifiedProfile`'s own doc comment already argued for the single door.

### Step 5b Task 1: prototype run, architecture amended (2026-09-01)

`60587fc`. Twelve real dispatches on `claude-sonnet-5`, **$0.59543**, 430 s,
**zero parse failures**, against the shipped dispatch boundary in scratch
storage outside production stage order. Cost overran the $0.25-0.45 estimate.
Evidence in
`docs/features/step5b-upstream-findings/2026-09-01-task1-prototype-evidence.md`.

- **The operator amended sections 8, 9, 12, 13, and 20** rather than only 12 and
  13 — the narrower change would have left section 8 claiming cross-round
  deduplication works and section 9 claiming per-risk panel sizes. Amend every
  section a design change falsifies, not only the ones named.
- **`addressed` admitted an invented obligation.** Answering a TOCTOU finding
  the author added an acceptance criterion the design never states, and the
  artifact gate passed; no prompt sentence prevented it and no mechanical check
  detects it. The operator directed normative-delta grounding in response,
  binding on Tasks 6, 9, 10, and 11, with the case retained as Task 11's
  regression.
- **A scratch `.mjs` harness can import the repo's `.ts` modules** via
  `await import(pathToFileURL(...).href)` under Node 24 type stripping — the
  prototype used the real executor, parser, and validators without touching
  production.
- **Withholding one input measured what the prompt does not say.** Not naming
  the reviewer registry in the self-critique prompt surfaced an unstaffable
  `data-privacy` request — the evidence that became Task 4's revision A, now
  shipped.
- **State what a deterministic check proves, in the document that describes
  it.** Every overstatement caught was a textual or mechanical check described
  as semantic verification.

### Step 5b: plan reviews and reconciliations (2026-08-31 to 2026-09-01)

Four review records against `docs/features/step5b-upstream-findings/plan.md`,
all reconciled with per-finding dispositions. Review 2 superseded the plan's
design direction, so the plan was rewritten in place to 13 tasks; review 3 then
audited the `Reconciled` claim and found five nominally closed contracts that
were not executable.

- **A reconciliation stamp is a claim, not evidence.** Trace the promised result
  through prompt input, parser, storage, and gate before calling a finding
  closed. `check:docs` validates neither that chain nor `Status`.
- **A review that supersedes a design direction is reconciled by rewriting the
  document, not by patching its findings in.**
- **Ask the operator the questions a review leaves open before rewriting.** Four
  decisions here each reshaped several tasks.

### Step 7: verification stage and smoke (2026-08-30 to 2026-08-31)

Twelve tasks. Task 12 smoke: a passing run ($0.07618, 5 dispatches), a blocking
run ($0.06595, 5 dispatches), and a tool-inventory probe ($0.01116) returning
exactly `Glob/Grep/Read`.

- **`bw new-run` could never create a run in a repository that had not
  gitignored `.governance/`** — `openStore()` creates the directory before the
  clean-tree check. Every test passed because the shared temp-root helper wrote
  the `.gitignore` first.
- **A genuine plan-coverage block.** The model dropped `(traces to: …)` suffixes
  when restating criteria and `coverageMeetsCriteria` held the full text. The
  gate was right; the prompt was not softened to pass.
- **Closed:** the three-orchestrator extraction question. Verification has no
  author, panel, rounds, model, prompt, or `agent_run` row, so the shape the
  three dispatching stages share is absent. Do not carry it to step 8.
- A fresh `new-run` refuses a tree dirtied by a blocked run's projections, so
  commit or clean between runs. Driving one stage with upstream built through
  the store costs about $0.13 an attempt for prompt iteration.

### Step 6: implementation stage — shipped (2026-08-30)

Nine tasks, `32a714e`. Smoke: one dispatch, **$0.0673**, valid patch set first
try. Decisions locked here are in the code and the plan; what is not recoverable
from either:

- **A documented guarantee was false at a boundary the plan never tested.**
  "The refusal does not depend on the target's existence" — but
  `resolveExisting` walks with `existsSync`, so a dangling link resolves
  lexically, constructible on Windows via a junction whose target is deleted
  after creation. **Refuse what cannot be verified rather than claim a
  resolution the filesystem cannot provide**, and consult the repo's own records
  before writing a gate: the symlink class was already recorded twice and missed
  both times.

### Build order steps 1-5 (2026-08-29)

- **Step 5 — plan stage and gate** (`83d88c0`) mirrors the spec stage without
  extracting a shared abstraction (hard rule 4). Smoke: six dispatches,
  **$0.63**, and a round-2 finding caught the plan inventing a rejection
  requirement the spec never stated — the observation behind hazard 16.
- **Step 4 — human approval gate.** A refusal costs nothing and is not terminal,
  unlike step 3 where every failure was terminal because money had already been
  spent. The profile carries `startingCommit` because section 15's `run` table
  has no column for one.
- **Step 3 — spec stage.** Its smoke exposed two prompt defects fixtures could
  not: naming `baseCommit` in the author prompt made the model refuse without a
  git repo, and the reviewer returned a bare findings object until the prompt
  stated the full envelope shape. **Real smoke output must drive prompt
  iteration.**
- **Step 2 — harness adapter.** From the one recorded real envelope:
  `claude -p --output-format json` **does** report `total_cost_usd` (the
  architecture's `sessionCost: false` example was wrong), and `modelUsage` can
  carry auxiliary queries, so the effective model is the unique entry whose
  `inputTokens` match `usage.input_tokens`.
- **Step 1 — run store.** Migrations anchor to the module location, not cwd. The
  pid-reuse wedge carries a held-since diagnostic only — age-based takeover was
  rejected as unsafe.

### Skills and tooling (2026-08-29)

- `scripts/doc-check.mjs` exits 2 **when the checker itself cannot read the
  source**. The motivating defect was a renamed `ARCHITECTURE.md` section making
  the old checker report a documentation defect that did not exist: a checker
  that blames the wrong artifact is worse than no checker.
- Historical-tier documents (`docs/features/**`, `.claude/sessions/**`) get
  warnings, never errors; `docs/proposals/` errors. Path warnings for files a
  plan is about to create are expected; do not chase them to zero.

### Locked design decisions (2026-08-29, amended 2026-09-01)

Architecture reconciled against `2026-08-28-architecture-review.md`, all 14
findings applied (`f68347c`); the review-flow decisions were later superseded by
`60587fc`. The decisions themselves are stated in `ARCHITECTURE.md` and are not
repeated here. The one that is not:

- No `docs/hazards.md` entry for the CRLF fixture breakage: that document
  records failures that have occurred in delivery, and entries 1 and 12 already
  cover the class. Latent fragilities do not earn an entry.
