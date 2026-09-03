# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-03)

**Shipped and committed:** build order steps 1-8. Step 5b is fully
`Implemented`; step 8 (delivery check) is fully `Implemented` too — plan
`Status: Implemented` with a dated Implementation note, tasks.md fully
checked, and the standalone review record reconciled. `master` is the only
local branch, ahead of `origin/master` by the step-8 commits `1890503`,
`02f799b`, `849571c`, `f68ebbb`, `98d87b3`, `695c16f`, `36a726d` (all
pre-step-5b history plus 5b's own commits are behind them; nothing has been
pushed — the operator has not asked). Read the head with `git log -1`
rather than trusting a commit id written here.

**Step 8's shipped surface:** declared artifacts are exact file paths
(trailing-slash and starting-tree directory refusals; run-document
refusals for design/spec/plan under `docs/features/<slug>/`); the
implementation-to-verification handoff is one typed record
(`base=<pre-apply head>; head=<final>` in the gate event, patch base on the
verification record); a pure coverage module compares exactly; `bw deliver`
performs every profile, handoff, scope, git, cleanliness, coverage,
existence-at-head, gate-event, and ancestry check before one
`Store.transaction` inserts the delivery_check stage, writes the record
(carrying its own stage id), completes the stage, transitions the run to
`completed` or `blocked`, and appends the audit event. The standalone review
(`configured_standalone`, the operator's first billed review) found twelve
issues — deletion counting as delivered, base==starting widening the range,
run-document declarations being undeliverable, no fixture exercising the
projections commit, missing verification.gate.pass — all remediated in
`36a726d` with named regressions and break-and-restore proofs.

**The delivery stage facts to know before touching it:**

- The recorded patch base is the starting commit's **child** (the
  implementation stage commits the run's own spec/plan projections before
  its first apply). Delivery enforces strict descent — a base equal to the
  starting commit refuses by name — and the fixtures commit projections
  pre-base so the range-anchoring regression is visible.
- Delivery certifies existence at the verified commit per declared artifact
  (`ls-tree` blob check), because `git diff --name-only` lists deletions.
- The record is written inside the final transaction after the stage insert.
- Refusal messages on the terminal wedges (duration breach, missing or
  invalid verification record, absent gate event) name the repair: restore
  the evidence or start a fresh run — the branch, worktree, and evidence are
  retained.

**Open and deferred:**

- **Step 9's milestone has been reached.** The paid end-to-end run
  (2026-09-03, operator-authorized) completed: 11 dispatches,
  `claude-sonnet-5`, $0.25019, all eight stages passed, `delivery_check=
  passed`, `run=completed`, delivery record matching the signed scope, chain
  valid. Evidence: the plan's Implementation note and SKILL.md. One earlier
  attempt that day spent $0.00 and blocked at the spec dispatch on an
  expired `claude` OAuth session — retained, audited, fail-closed, exactly
  as designed. Step 9 is the deliberate stop: do not build past it without
  an explicit decision.
- Architectural half of review finding F3 (whether the run-duration ceiling
  should bind cost-free stages at all) and finding F12 (the three
  stage-local git helpers may now be extracted under hard rule 4 — but
  consolidation touches implementation and verification stages) are
  deferred with triggers in
  `docs/features/delivery-check/2026-09-03-step8-code-review.md`.
- `npm test` intermittently leaks empty `moved` commits and a stray
  `base.txt` onto the real repo (auto memory:
  `test-suite-leaks-into-real-repo`). Root cause in
  `test/verification-stage.test.ts`'s worktree setup is not traced.
- `src/policy.ts:47` names `assertStaffable` in a doc comment; the function
  is `staffingShortfall`. One-word fix whenever that file is next edited for
  its own reasons.
- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record"; that file was never
  written. Historical tier, so `check:docs` only warns — the gap is real.
- Retained evidence outside the repo, no process: step 5b's Task 1
  prototype bundle and Task 12 smoke target (paths in the previous entry of
  this file); `driver.mjs` scratch targets under
  `%LOCALAPPDATA%\Temp\bw-run-skill\` (latest on disk, readable via
  `driver.mjs report --dir <path>`).
- `VERIFY_RETENTION_MAX_BYTES` (64 MB) is chosen, not derived; filesystem and
  network containment for verification commands is unbuilt
  (`docs/proposals/verification-containment.md`). `.governance` location
  configuration is deferred.

## Diagnostics quick-reference

Durable one-liners live in **auto memory**, which loads automatically — read
`MEMORY.md` there rather than duplicating it here. It carries the
whitespace-collapsing citation match, the unstable `intentKey`, frozen review
defaults, dispatch cost, break-it mechanics, line endings, the source-scanning
trap, duplicated-stage coverage, the discriminating-configuration rule, prompt
bounds deriving from the validator, the `npm test` git leak, SQL comments
defeating substring guards, doc-check's backtick scratch-filename warning, and
the independent-review-choice pattern (hazard 14).

One line memory does not yet carry:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, PowerShell's BOM, and `proposalIdentity`
  each caused one here.

## Session records

### Step 8: delivery check, Tasks 1-6 and the standalone review (2026-09-02 to 2026-09-03)

Seven atomic commits on `master`: `1890503` (Task 1: declared artifacts are
exact file paths — trailing-slash and starting-tree directory refusals),
`02f799b` (Task 2: one typed handoff, base + head in the gate event),
`849571c` (Task 3: the pure coverage module), `f68ebbb` (Task 4:
`runDeliveryStage` — checks first, one final transaction), `98d87b3`
(Task 5: `bw deliver` and the paid driver), `695c16f` (Task 6: architecture
amendments, docs, sweep, disposable gate), `36a726d` (remediation of the
standalone review's twelve findings, `configured_standalone` — the
operator's first billed review choice; all eleven fixable findings landed
with named regressions, one deferred with a trigger). Final state: 682
tests (one pre-existing skip), typecheck clean, smoke 12/12, doc-check
0/36. Plan `Implemented`; the paid end-to-end run then completed under
operator authorization (11 dispatches, $0.25019, all eight stages passed,
`run=completed`) — step 9's milestone reached.

#### Decisions and assumptions

- **The operator chose `/code-review ultra` over the in-session subagent**
  this time (hazard 14): a billed, separately spawned `configured_standalone`
  review. It earned its cost — the sweep reproduced real defects end to end.
- **Implementation corrected the plan's own wording**: the recorded patch
  base is the starting commit's child (projections commit between), never
  equal to it; delivery enforces ancestry continuity plus strict descent
  (equality refuses), per the plan's review-driven amendment.
- **Fixable wedges got repair messages, not behavior changes**: the
  duration-breach, missing/invalid-record, and absent-gate-event refusals
  keep refusing (per the approved plan and verification's precedent) and now
  name the repair — restore the evidence or start a fresh run, with the
  branch and worktree retained.

#### What failed

- **A break-it restore via `git checkout --` wiped the file's own
  uncommitted remediation work.** Delivery-stage.ts carried legitimate
  review fixes; restoring the mutation with `git checkout` reverted the file
  to HEAD, discarding all of them, and the "restore" run failed against old
  code. Auto memory `break-it-mechanics` already said prefer a scratch
  mirror or staged git — I violated it mid-batch. Restore mutations with the
  reverse patch, never a checkout, when the file also carries uncommitted
  work.
- **Two break mutations were aimed at the wrong branch.** Reversing the diff
  range changed nothing (git lists a deleted path in name-only, so the set
  was identical), and inverting the blob check changed nothing for a test
  whose outcome was already a block (the mutation made everything missing).
  Each needed a mutation that changed the *outcome class* the test pins.
- **A `|`-delimited sed died on `||`** and an apostrophe escaped out of a
  single-quoted sed script — both silently no-oped, producing pass/pass
  cycles that looked like held guards until the logs were read.

#### What worked

- **The standalone review found what fixture-blind code hides.** F1 (a
  deletion counts as delivered — name-only lists removed paths), F2 (base
  equality widens the certified range over the projections commit), F5 (no
  fixture exercised a pre-base projections commit, so the anchor regression
  was invisible), F6 (declaring the run's own documents passed every gate
  and blocked terminally at delivery), F8 (a run could complete without
  verification.gate.pass in the audit). Each fix landed with a regression
  that breaks when the guard is removed.
- **Making every fixture reproduce the real chain's shape** (projections
  committed before the base) turned the strict-descent refusal and the
  projection-exclusion property into exercised code, and the 
  `noGateEvent` fixture option made the missing-event refusal reachable at
  all (the audit table's append-only trigger forbids deleting the event).
- **Refusal messages that name the repair** turned three permanent wedges
  from dead ends into explained, designed states.

Review: `docs/features/delivery-check/2026-09-03-step8-code-review.md`,
reconciled (11 accepted — 9 full, 2 narrow — 1 deferred, 0 open).

### Step 5b Task 13: completion gate and independent review (2026-09-03)

Gate, measured directly: typecheck clean; `npm test` 625/624 pass/1
pre-existing skip/0 fail, no repository leak; `check:docs --json` 0 errors,
36 warnings. Diff scope confirmed clean (no `src/` file, no requirement-ID
text, nothing under `docs/proposals/`); the four plan-level review records
untouched since before this diff existed.

#### Decisions and assumptions

- **Asked the operator which kind of "independent" review to run, rather
  than picking silently** — an in-session subagent
  (`unverified_self_attestation` per hazard 14) vs. `/code-review ultra`
  (billed, `configured_standalone`) is a real evidence difference, not a
  cosmetic one. Operator chose the subagent. Auto memory:
  `independent-review-choice-hazard14`.

#### What worked

- **An independent review that re-derives rather than re-reads is worth
  more than one that agrees with the narrative.** It reproduced three of
  Task 11's break-it mutations live, queried the retained Task 12 smoke
  database directly via `node:sqlite`, and read the retained Task 1
  evidence directly. Found zero findings, but earned that verdict.
  `2026-09-03-task13-completion-review.md`, reconciled.

Result: the plan's `Status:` moved to `Implemented`, with a dated
Implementation note (shipped behaviour, 4 deviations, exact counts, the
smoke outcome, remaining limitations stated rather than closed over).

### Step 5b Tasks 10-12: documentation, break-it sweep, production smoke (2026-09-02 to 2026-09-03)

Task 10: hazard 16 added to `docs/hazards.md`; `ARCHITECTURE.md` sections
14, 15, 22 updated (12/13 already matched Task 1's amendment);
`scripts/doc-check.mjs` gained `checkHazardCount`; `README.md`'s status
section rewritten. Task 11: twenty distinct guards proven in a scratch
`git worktree`, each mutation failing its named test and restoring clean.
Task 12: one real, paid, bounded run against `bw` — 10 dispatches, $0.36548,
`claude-sonnet-5` throughout, zero parse failures; all three non-blocking
disposition families fired for real (`upstream_follow_up`, `addressed`,
`rejected_with_rationale`); `cannot_determine`/`upstream_blocking` did not
surface (one-sample limitation, not a gap).

#### What failed

- **A break-it proof observed a real guard weakness (item 13, P1) and didn't
  repair it** — a comment quoting a dropped `UNIQUE` constraint still
  substring-matched in both `test/schema.test.ts` and
  `scripts/doc-check.mjs`; the original write-up quieted the mutation
  instead of fixing the checker. Auto memory:
  `sql-comment-defeats-substring-guard`. Caught on independent review, not
  self-review.
- **A warning-count fix introduced the warnings it was estimating** —
  backtick-quoting the scratch filenames it was explaining. Auto memory:
  `doc-check-backtick-scratch-warning`. True final count: 36, unchanged from
  before Task 12.

#### What worked

- **Replaying a real retained historical decision, not a fixture, proved a
  second guard branch.** Task 1's actual retained round-2 reconciliation
  (ungrounded "atomic exclusive-create" criterion, zero `normativeChanges`)
  replayed against the shipped, unmutated validator surfaces the criterion
  in `unclaimedNodes` and aborts the round instead of converting a
  decision — a branch fixtures never exercised. Also caught hazard 16's own
  text overstating this as one path; corrected in the same pass.

#### Verification

- `npm run typecheck` clean; `node --test test/schema.test.ts` 8/8; `npm run
  check:docs --json` 0 errors, 36 warnings (final).

Review: `2026-09-02-task10-12-code-review.md` (7 accepted, 0 rejected, 0
deferred, 0 open).

### Step 5b Tasks 7-9: storage rebuild, proposals, orchestration (2026-09-02)

One tranche, now committed at `54ee29b`. Migrations `005` (rebuild `finding`;
add `finding_report`, `finding_decision`) and `006` (`proposal`,
`proposal_source`); new `src/proposal.ts`; rewritten `src/store.ts`,
`src/plan-gate.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`; `bw
proposal-export` in `src/cli.ts`. Review and reconciliation:
`2026-09-02-task7-9-code-review.md` (6 accepted, 0 rejected, 0 deferred, 0
open). No dispatch was paid for.

#### Decisions and assumptions

- **The operator merged Tasks 7-9 into one atomic tranche** after Task 7's
  own Files list was found to contradict its steps — shipping Task 7 alone
  needed a severity adapter hard rule 3 forbids. Raise a plan defect; don't
  resolve it silently — only the operator can rule on a wrong task boundary.

#### What failed

- **`npm test` wrote to the real repository** — two empty `moved` commits
  plus an untracked `base.txt`, zero content diff, removed with `git reset
  --soft f094c0f`. Intermittent, root cause not traced (see Current state).
- **A fixture substitution silently no-matched** (fifth instance of this
  class): the plan-stage dedup test replaced code the stock fixture never
  exercised, so it asserted nothing it meant to.

#### What worked

- **The `unclaimedNodes` correction reversed my own earlier design call.** A
  node released by a conversion already has an owning decision the gate
  blocks by name, so both stages abort only when `conversions.length === 0`
  — fail-closed still holds, since a conversion always yields
  `cannot_determine`. `reconciliation.ts` already documented this; read the
  governing module's comment before designing around its output.
- **Break-it proved all six accepted findings**: reverting each fix failed
  exactly the named assertion, then restored green.

### Step 5b Task 6: reconciliation contract and prompt (2026-09-02)

`f094c0f`. `src/reconciliation.ts`, both reviewer prompts rewritten to the
specialty-only boundary with classification, both reconciliation prompts,
the reconciliation capabilities on both authors. Reviews:
`2026-09-02-task6-code-review.md` and `-2.md`, both reconciled.

- **The refusal/convert boundary.** Structure errors (missing/misplaced
  fields, unknown dispositions, extra/duplicate/missing decisions) refuse by
  name; content failures (unmatched grounding, extra/duplicated/unmatched
  normative claims) rewrite the decision to `cannot_determine`, drop the
  conditional fields, append a bracketed note to the retained rationale, and
  record the conversion.
- **One reconciliation per round, even a clean one** — the reconciler is the
  actor that confirms an empty findings set.
- **The mixed pair cannot share one canonical identity — operator decision,
  not an inference.** Classification determines location shape, so a
  mixed-classification pair is always two canonical findings with two
  decisions. In auto memory: `mixed-pair-identity-constraint`.
- **A held break-it mutation was an attack defect, not a coverage gap:** a
  whole-file prompt scan cannot catch a sentence removed from one of two
  prompts while the other keeps its copy.

### Step 5b Task 5: author-proposed panel, deterministic staffing (2026-09-02)

`bacec0a`. `validatePanelRequest` in `src/select.ts`; both stages validate
the request and refuse an unstaffable panel by name before dispatching.

- **The prompts were brought into scope though the task's file list omits
  them**, operator asked first: the default installation's legal size is
  exactly two, so a prompt stating neither bound would have made the named
  refusal the ordinary outcome of a correct run.
- **`staffingShortfall` was extended, not duplicated** — one question asked
  at two moments is one function.
- **Two of fourteen break-it mutations held, and both were real coverage
  gaps** — the tests had picked configurations where the old and new rules
  agree numerically. Auto memory: `discriminating-configuration`.
- **The prompt brought into scope to state a bound stated the wrong bound**
  — auto memory: `prompt-bounds-derive-from-validator`.

### Step 5b Task 4: self-critique contract and prompt (2026-09-02)

`578d0eb`. `src/self-critique.ts`, both self-critique prompts, one dispatch
per artifact before `completeStage`.

- **Revision A was implemented although Task 4's step list never absorbed
  it** — nobody rewrote the steps when the operator accepted the prototype
  result. Read a task's governing exit decision, not only its checkboxes.
- **A capability refusal must sit beside the dispatch it guards**, not
  before a draft that could never complete the stage.
- **Making the fixture echo what the prompt actually contained** is how a
  stage-level test can see a prompt: an omission surfaces as `none-listed`.

### Step 5b Tasks 2 and 3: paths module, frozen review config (2026-09-01 to 2026-09-02)

`cd11071` and `5d63726`. Route A — a profile violating the current policy
shape is refused by name in `loadVerifiedProfile`, no migration, no
defaults — was the operator's decision.

- **A task that says "read X from the frozen profile" and also defines what
  X means is two instructions.** Task 3's first attempt wired the configured
  round counts into the legacy loop, making one round mean one panel and
  zero reconciliations.
- **Tracing the profile consumers settled the decision better than
  reasoning about it did:** no stage read panel size or rounds from the
  profile at all.

### Step 5b Task 1: prototype run, architecture amended (2026-09-01)

`60587fc`. Twelve real dispatches on `claude-sonnet-5`, $0.59543, 430 s,
zero parse failures, scratch storage outside production stage order. Cost
overran the $0.25-0.45 estimate. Evidence in
`2026-09-01-task1-prototype-evidence.md`.

- **Amend every section a design change falsifies, not only the ones
  named** — the operator amended sections 8, 9, 12, 13, and 20.
- **`addressed` admitted an invented obligation.** The author added an
  acceptance criterion the design never states and the artifact gate
  passed; the operator directed normative-delta grounding in response,
  retained as Task 11's regression.
- **A scratch `.mjs` harness can import the repo's `.ts` modules** via
  `await import(pathToFileURL(...).href)` under Node 24 type stripping.
- **State what a deterministic check proves, in the document that describes
  it.**

### Step 5b: plan reviews and reconciliations (2026-08-31 to 2026-09-01)

Four review records, all reconciled; review 2 superseded the design
direction, so the plan was rewritten in place to 13 tasks.

- **A reconciliation stamp is a claim, not evidence.** Trace the promised
  result through prompt input, parser, storage, and gate before calling a
  finding closed. A review that supersedes a design direction is reconciled
  by rewriting the document, not by patching its findings in.

### Steps 1-7: build order to the deliberate stop (2026-08-29 to 2026-08-31)

Steps 1-5 `83d88c0` and earlier; step 6 `32a714e` (one dispatch, $0.0673);
step 7 smoke — passing run $0.07618, blocking run $0.06595, tool probe
$0.01116 returning exactly `Glob/Grep/Read`.

- **`bw new-run` could never create a run in a repository that had not
  gitignored `.governance/`** — `openStore()` creates the directory before
  the clean-tree check. A fresh `new-run` also refuses a tree dirtied by a
  blocked run's projections, so commit or clean between runs.
- **A documented guarantee was false at a boundary the plan never tested:**
  `resolveExisting` walks with `existsSync`, so a dangling link resolves
  lexically. Refuse what cannot be verified.
- **Real smoke output must drive prompt iteration.** Naming `baseCommit` in
  the spec-author prompt made the model refuse without a git repo; the
  reviewer returned a bare findings object until the prompt stated the full
  envelope; a genuine plan-coverage block came from the model dropping
  `(traces to: …)` suffixes.
- **Step 5's plan stage mirrors the spec stage without extracting a shared
  abstraction** (hard rule 4). Its round-2 smoke finding — the plan
  inventing a rejection requirement the spec never stated — is the
  observation behind hazard 16.
- `claude -p --output-format json` **does** report `total_cost_usd`, and
  `modelUsage` can carry auxiliary queries, so the effective model is the
  unique entry whose `inputTokens` match `usage.input_tokens`. Migrations
  anchor to the module location, not cwd.
- `scripts/doc-check.mjs` exits 2 **when the checker itself cannot read the
  source**. Historical-tier documents (`docs/features/**`,
  `.claude/sessions/**`) warn, never error; `docs/proposals/` errors.
