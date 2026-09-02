# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-02)

**Shipped:** build order steps 1-7 and step 5b Tasks 1, 2, and 3, on `master`,
head `5d63726`, tree clean, **pushed** — `origin/master` is level with it, and
`master` is the only local branch. Verified at that head: `npm test` 494 tests /
493 pass / 1 recorded skip / 0 fail; `npm run typecheck` clean;
`npm run check:docs` exit 0 with 36 warnings.

**The binding architecture changed** in `60587fc` under operator acceptance,
amending `ARCHITECTURE.md` sections 8, 9, 12, 13, and 20: the five-phase
author-led review flow replaces the closure pass, the author proposes a panel
the system staffs and refuses by name, completion is decision completeness
rather than a severity threshold, canonical identity is round-scoped with every
reviewer report immutable, the panel floor and default are two reviewers, and
one review round is the default. Sections 5, 15's schema block, 23, and
`STAGE_SEQUENCE` are unchanged. The document states both limits itself: an exact
match proves textual occurrence, not logical support, and hashes plus document
gates do not prove a concern was semantically cured.

**In flight — step 5b, Tasks 4-13 open.** Task 2 shipped `src/paths.ts`
(`cd11071`); Task 3 shipped the frozen review configuration and the
invalid-profile refusal (`5d63726`). Task 4 (self-critique contract and prompt)
is next, from `docs/features/step5b-upstream-findings/plan.md`.

**The round-activation boundary is the thing to know before touching a stage.**
`specReviewRounds` and `planReviewRounds` are frozen into every profile and
**deliberately not read by either stage yet**. A configured round means one
complete `panel -> reconcile` cycle, and no reconciliation dispatch exists until
Task 9; wiring the values into the legacy loop would make one configured round
mean one panel and zero reconciliations. Both stages carry an explicitly named
`LEGACY_CLOSURE_PASSES = 3` until Task 9 removes it and activates the frozen
values in the same change. `panelSizeMin` and `materialityThreshold` *are* read
from the frozen profile today.

**Two latent defects in shipped code** remain, both Task 7: `insertFinding`'s
return on the upsert conflict path, and whole-file schema constraint searching.
Each has an auto-memory file with line numbers and reproduction. The third — a
frozen policy describing values live constants decided — is closed for panel
size and materiality, and closes for round counts at Task 9.

**Open and deferred:**

- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record". That file was never
  written. Historical tier, so `check:docs` only warns; the gap is real and
  undecided.
- Report pairs (two reviewers on one canonical finding) were never observed in
  real model output — 9 findings, 9 reports, no pairs. Tasks 6 and 7 must keep
  proving pair preservation by fixture.
- Whether step 5b or step 8 (delivery check) goes first was never decided. Step
  8 remains the next build-order step.
- `VERIFY_RETENTION_MAX_BYTES` is 64 MB — chosen, not derived.
- Filesystem and network containment for verification commands is unbuilt,
  stated as a limitation in `ARCHITECTURE.md` section 17, with
  `docs/proposals/verification-containment.md` filed.
- External configuration of the `.governance` location, and the state migration
  it implies, are deferred out of step 5b by operator decision.
- The build order stops at step 9. Do not build past it without an explicit
  decision.

**Next up:** start step 5b Task 4 (self-critique contract and prompt) from
`docs/features/step5b-upstream-findings/plan.md`.

## Diagnostics quick-reference

Every line here is **mirrored into auto memory**, which loads automatically —
see `MEMORY.md` there for the reasoning, line numbers, and reproductions. This
is the index, not the explanation.

- **Exact-match citation checks must collapse whitespace**, not only BOM and
  CRLF: every governing document here is hard-wrapped at ~78 columns, so a
  correct quotation spanning a line break fails otherwise.
- **`intentKey` is model-authored and unstable across rounds** — identity
  deduplicates wording within a round and cannot detect semantic recurrence.
- **Review defaults are code constants frozen per run, not operator input.**
  Read from `profile.policy` — except the round counts, frozen but deliberately
  inactive until Task 9.
- **A large-context dispatch costs about three times a reviewer dispatch**
  ($0.07-0.09 against $0.02-0.04). Budget from the prompt's contents.
- **A break-it mutation that holds is a finding, not a pass** — either the
  checker crashed, or the guard is unreachable by design or by fixture.
- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, and PowerShell's BOM each caused one here.
- **Source-scanning tests must survive this repo's own strings** — the executor
  sandbox glob ends in `/**` and blinds a naive comment-stripper.

## Session records

### Step 5b Tasks 2 and 3: paths module, frozen review config (2026-09-01 to 2026-09-02)

`cd11071` (Task 2) and `5d63726` (Task 3). Task 3 was committed as `2c8a71e` and
then **materially revised by a later pass** before reaching `origin`; those
differences are the substance of this record.

#### Decisions and assumptions

- **Route A for profiles frozen before Task 3, chosen by the operator** after
  the alternatives were traced: a profile missing or violating the current
  policy fields is refused by name in `loadVerifiedProfile` — no migration, no
  defaults, no continuing past it. The argument is the single door: every
  execution and resume path loads the profile through it, and nothing that only
  reads the database, retained evidence, or the audit chain does, so a refused
  run stays inspectable and `verify-audit` still verifies it. Framed as a
  validity check, never a version rule — hard rule 3 forbids compatibility
  handling, and a refusal is that rule stated out loud.
- **`panelSizeMin` is a frozen policy value**, not just a floor constant. Until
  Task 5 lets the author propose a size the stages staff the floor; staffing the
  maximum would silently seat five reviewers the moment an operator raised the
  ceiling.
- **`MATERIAL_THRESHOLD` survives Task 3** — the plan permits removing it only
  once reconciliation completeness replaces both severity gates, which is Task
  9. The revision went further and made both gates take the threshold as a
  parameter read from the frozen profile.

#### What failed

- **The configured round counts were wired into the legacy closure loop, and
  the resulting behaviour change was announced as intended.** Task 3 says "make
  both stages read these values from the frozen profile"; it *also* defines a
  configured round as one complete `panel -> reconcile` cycle. Both sentences
  are in the same task. Acting on the first while ignoring the second made one
  configured round mean one panel and zero reconciliation dispatches, changing
  what a run does. Reversed in `5d63726` behind `LEGACY_CLOSURE_PASSES = 3`.
- **Two break-it mutations held and would have shipped as "proven".** Restoring
  the `approvalSigner != null` tolerance broke nothing because the case is now
  unreachable; removing the staffing refusal from `freezeProfile` broke nothing
  because the seeded registry can always staff the default panel.
- **`git checkout -- <file>` during a break-it pass reverted uncommitted work.**
  Nothing was staged, so the restore went to `HEAD` and silently discarded the
  `src/executor.ts` edit. The rule was already in auto memory and not followed.
- **Four scope calls were left to a later pass to correct**: distinct-specialty
  enforcement inside `selectReviewers` (deferred to Task 5 as scope creep),
  duplicate and oversized `requiredSpecialties` validation, an executor filter
  on eligible reviewers, and duplicate agent ids.

#### What worked

- **Tracing the profile consumers before recommending a rule.** Grepping
  `loadVerifiedProfile` and `policyHash` showed only `buildBinding` re-checks
  policy in force, that no stage read panel size or rounds from the profile at
  all, and that `loadVerifiedProfile`'s own doc comment already argues for the
  single door — which settled the decision better than the reasoning did.
- **Deriving the pre-Task-3 policy shape from `git show HEAD:src/policy.ts`**
  and building the fixture by transforming the current policy, so only the
  fields that actually changed are stated by hand.
- **Following an existing seam precedent instead of inventing one.**
  `runPlanStage`'s `selectPanel` carries a recorded justification for exactly
  the unreachable-guard problem, so `freezeProfile` got a narrow `deps.agents`
  override on the same reasoning.

#### Running state

- `C:\Users\Shawn-work\repositories\step5b-task1-prototype` — the retained Task
  1 prototype bundle, 441 KB, still present. Outside the repository,
  uncommitted, no process attached.

#### Verification

- At `5d63726`: `npm run typecheck` clean; `npm test` 494 tests, 493 pass, 1
  skip, 0 fail; `npm run check:docs` exit 0, 36 warnings (down from 41 because
  the files Task 2's plan references now exist).
- Eight break-it mutations across `profile.ts`, `policy.ts`, `approval-stage.ts`
  and `spec-stage.ts`, each restored; six failed on the first attempt, two only
  after the gaps above were closed.

#### Next time

- **A task that says "read X from the frozen profile" and also defines what X
  means is two instructions.** Check the code being wired implements the
  definition before connecting the value. A configuration rename that changes
  what a run does is the signal that it does not.
- **Announcing a behaviour change confidently does not make it correct.** The
  round change was reported to the operator as the amended architecture's
  intent; it was an artifact of wiring a value into the nearest similarly named
  loop.
- **Stage before mutating.** A break-it pass on uncommitted work needs
  `git add -A` first, or `git checkout --` restores to `HEAD` and eats the work.

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
- **Importing the repo's `.ts` modules into a scratch `.mjs` harness** via
  `await import(pathToFileURL(...).href)` under Node 24 type stripping let the
  prototype use the real executor, harness, parser, and validators without
  touching production. Splicing an amendment by line range on a copy, then
  `diff -U3`, made the invariant checks mechanical before anything was applied.
- **Withholding one input measured what the prompt does not say.** Not naming
  the reviewer registry in the self-critique prompt surfaced an unstaffable
  `data-privacy` request — the evidence Task 4 needs.
- **State what a deterministic check proves, in the document that describes
  it.** Every overstatement caught was a textual or mechanical check described
  as semantic verification. Relatedly, the one `check:docs` error was a dangling
  path reference inside a proposal, not a check to remove.

### Step 5b: plan reviews and reconciliations (2026-08-31 to 2026-09-01)

Four review records against `docs/features/step5b-upstream-findings/plan.md`,
all reconciled and retained with per-finding dispositions. Review 2 superseded
the plan's design direction, so the plan was rewritten in place to 13 tasks
rather than patched; review 3 then audited the `Reconciled` claim and found five
nominally closed contracts that were not executable.

- **A reconciliation stamp is a claim, not evidence.** Trace the promised result
  through prompt input, parser, storage, and gate before calling a finding
  closed. `check:docs` validates neither that chain nor `Status`.
- **A review that supersedes a design direction is reconciled by rewriting the
  document, not by patching its findings in.** The later review's dispositions
  of the earlier review's findings are the map for what survives.
- **Ask the operator the questions a review leaves open before rewriting.** Four
  decisions here each reshaped several tasks; inventing any would have produced
  a plan rewritten twice.

### Step 7: verification stage and smoke (2026-08-30 to 2026-08-31)

Twelve tasks; suite green at 429 pass / 1 skip. Task 12 smoke: a passing run
($0.07618, 5 dispatches), a blocking run ($0.06595, 5 dispatches), and a
tool-inventory probe ($0.01116) returning exactly `Glob/Grep/Read`.

- **`bw new-run` could never create a run in a repository that had not
  gitignored `.governance/`** — `openStore()` creates the directory before the
  clean-tree check, so the invocation reported a tree only it had dirtied. Every
  test passed because the shared temp-root helper wrote the `.gitignore` first.
- **The evidence file had no ceiling** — 5.97 GB in 5.2 s, roughly 955 GB inside
  the 900-second command ceiling. Fixed with `VERIFY_RETENTION_MAX_BYTES`, whose
  comment carries the measurement.
- **A genuine plan-coverage block.** The model dropped `(traces to: …)` suffixes
  when restating criteria and `coverageMeetsCriteria` held the full text. The
  gate was right; the prompt was not softened to pass.
- **Closed:** the three-orchestrator extraction question. Verification has no
  author, panel, rounds, model, prompt, or `agent_run` row, so the shape the
  three dispatching stages share is absent. Do not carry it to step 8.
- A fresh `new-run` refuses a tree dirtied by a blocked run's projections, so
  commit or clean between runs. Prior smokes drove one stage with upstream built
  through the store — about $0.13 an attempt for prompt iteration.

### Step 6: implementation stage — shipped (2026-08-30)

Nine tasks, `32a714e`. Smoke: one dispatch, **$0.0673**, valid patch set first try.

**Decisions locked:** `ProposedPatchFile.content` is the complete new file
content (no diff field); scope matching is exact-or-`s/`-prefix, case-preserving
(`touchesProtected` folds case, scope does not); one commit per patch under
`BuildWorks <buildworks@buildworks.invalid>` via `-c` flags; the projections are
the run branch's first commit; one patch per file per dispatch, enforced by the
head-moved re-validation. `RUN_DURATION_LIMIT_SECONDS` (7 days) landed here.

**The review's lesson:** a documented guarantee ("the refusal does not depend on
the target's existence") was false at a boundary the plan never tested —
`resolveExisting` walks with `existsSync`, so a dangling link resolves
lexically, constructible on Windows via a junction whose target is deleted after
creation. **Refuse what cannot be verified rather than claim a resolution the
filesystem cannot provide.** Also: consult the repo's own records before writing
a gate — the symlink class was already recorded twice and missed both times.

### Build order steps 1-5 (2026-08-29)

- **Step 5 — plan stage and gate** (`83d88c0`). Mirrors the spec stage without
  extracting a shared abstraction (hard rule 4). Smoke: six dispatches, **$0.63**,
  and a round-2 finding caught the plan inventing a rejection requirement the
  spec never stated — the observation behind step 5b's hazard 16.
- **Step 4 — human approval gate.** `bw approve` verifies one Ed25519 signature
  and creates `awaiting_approval` only on success. A refusal costs nothing and is
  not terminal — unlike step 3, where every failure was terminal because money
  had already been spent. The profile carries `startingCommit` because section
  15's `run` table has no column for one.
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
- **Step 1 — run store.** SQLite via `node:sqlite`, no runtime dependencies.
  Migrations anchor to the module location, not cwd. The pid-reuse wedge carries
  a held-since diagnostic only — age-based takeover was rejected as unsafe.

### Skills and tooling (2026-08-29)

- `scripts/doc-check.mjs` has tiers (current / reference / historical), `--json`,
  `--only=`, and **exit 2 when the checker itself cannot read the source** — the
  motivating defect was a renamed `ARCHITECTURE.md` section making the old
  checker report a documentation defect that did not exist. **A checker that
  blames the wrong artifact is worse than no checker.**
- Historical-tier documents (`docs/features/**`, `.claude/sessions/**`) get
  warnings, never errors; `docs/proposals/` errors. Path warnings for files a
  plan is about to create are expected; do not chase them to zero.

### Locked design decisions (2026-08-29, amended 2026-09-01)

Architecture reconciled against `2026-08-28-architecture-review.md`, all 14
findings applied (`f68347c`). The review-flow decisions were superseded by
`60587fc` and now live in Current state and `ARCHITECTURE.md`; what remains here
still describes shipped behaviour.

- System name is a configuration value, default **BuildWorks**.
- Internal paths stay fixed and non-configurable: `.governance/`,
  `gov/<slug>/<run-id>`, `governed.yaml`.
- Approval is an Ed25519 signature verified against a public key in
  machine-local configuration.
- A patch binds to the head in effect when proposed; apply-time re-validation
  refuses only if head moved in paths it touches.
- Harness language: TypeScript on Node, per operator decision.
- No `docs/hazards.md` entry for the CRLF fixture breakage: that document
  records failures that have occurred in delivery, and entries 1 and 12 already
  cover the class. Latent fragilities do not earn an entry.
