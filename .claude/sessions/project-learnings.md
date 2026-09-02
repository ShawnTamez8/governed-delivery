# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-02)

**Shipped and committed:** build order steps 1-7 and step 5b Tasks 1 through 6.
`master` is the only local branch and equals `origin/master` at `f094c0f` —
nothing unpushed. Read the head with `git log -1` rather than trusting a commit
id written here.

**In flight — step 5b Tasks 7, 8, and 9, complete but uncommitted.** The
operator directed the three tasks merged into **one atomic working-tree change**
(canonical finding/report/decision storage, proposal persistence and export, and
the orchestrator/gate rewiring) because Task 7's schema rebuild could not ship
alone without a temporary severity adapter — a second schema for one concept,
which hard rule 3 forbids. No partial commit, no compatibility shim. The tranche
has been independently reviewed and the review reconciled (six findings, all
verified then accepted). Nothing is committed; the operator has not asked for a
commit.

**The round-activation boundary is gone — this is the reversal to know before
touching a stage.** `LEGACY_CLOSURE_PASSES` no longer exists in `src/`. Both
stages now read `profile.policy.specReviewRounds` / `planReviewRounds` and run
one complete `panel → reconcile` cycle per configured round, then gate **once
over every round's decisions**. Completion is decision completeness:
`BLOCKING_DISPOSITIONS = [cannot_determine, upstream_blocking]` in
`src/plan-gate.ts`, imported by `specReviewGate` so the two gates cannot drift.
`materialityThreshold`, `MATERIAL_THRESHOLD`, and the old `insertFinding` /
`getFindings` / `updateFindingDisposition` API are all removed.

**The two latent defects that were open for six tasks are both closed.**
`upsertCanonicalFinding` select-then-inserts inside a transaction and returns the
row it wrote (three-insert regression); schema constraint assertions in
`test/schema.test.ts` and `scripts/doc-check.mjs` are scoped to each table's
final `CREATE TABLE` body, so dead text in a superseded migration can no longer
satisfy them.

**Open and deferred:**

- Task 10 (hazard 16, `ARCHITECTURE.md` sections 12/13/14/15/20/22, README,
  hazard-count checker), Task 11 (break-and-restore sweep), Task 12 (bounded
  production smoke), Task 13 (completion gate + independent review) are all
  untouched. `ARCHITECTURE.md` has received **only** the mechanical section-15
  schema-fence sync; every narrative change is Task 10's.
- `npm test` intermittently leaks empty `moved` commits and a stray `base.txt`
  onto the real repo — see the session record below and auto memory. Root cause
  in `test/verification-stage.test.ts`'s worktree setup is **not traced**.
- `src/policy.ts:47` names `assertStaffable` in a doc comment; the function is
  `staffingShortfall`. Still present. One-word fix whenever that file is next
  edited for its own reasons.
- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record". That file was never
  written. Historical tier, so `check:docs` only warns; the gap is real.
- Whether step 5b or step 8 (delivery check) goes first was never explicitly
  decided. Nine 5b tasks have now shipped ahead of it by practice.
- `C:\Users\Shawn-work\repositories\step5b-task1-prototype` — retained Task 1
  prototype bundle, confirmed present 2026-09-02. Outside the repo, no process.
- `VERIFY_RETENTION_MAX_BYTES` is 64 MB — chosen, not derived. Filesystem and
  network containment for verification commands is unbuilt (`ARCHITECTURE.md`
  section 17; `docs/proposals/verification-containment.md`).
- External configuration of the `.governance` location is deferred out of 5b.
- The build order stops at step 9. Do not build past it without a decision.

**Next up:** step 5b Task 10 — final architecture facts, hazards, README, and
checker alignment, from `docs/features/step5b-upstream-findings/plan.md`. It
starts by verifying the sections 12/13 amendment still matches the implemented
flow, then adds hazard 16 and the hazard-count check.

## Diagnostics quick-reference

Durable one-liners live in **auto memory**, which loads automatically — read
`MEMORY.md` there rather than duplicating it here. It carries the
whitespace-collapsing citation match, the unstable `intentKey`, frozen review
defaults, dispatch cost, break-it mechanics, line endings, the source-scanning
trap, duplicated-stage coverage, the discriminating-configuration rule, prompt
bounds deriving from the validator, and the `npm test` git leak.

One line memory does not yet carry:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, and PowerShell's BOM each caused one here, and
  `proposalIdentity` made it four (below).

## Session records

### Step 5b Tasks 7-9: storage rebuild, proposals, orchestration (2026-09-02)

One uncommitted tranche on top of `f094c0f`. Migrations `005` (rebuild `finding`;
add `finding_report`, `finding_decision`) and `006` (`proposal`,
`proposal_source`); new `src/proposal.ts`; rewritten `src/store.ts`,
`src/plan-gate.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`; `bw
proposal-export` in `src/cli.ts`. Review and reconciliation:
`docs/features/step5b-upstream-findings/2026-09-02-task7-9-code-review.md`
(6 accepted, 0 rejected, 0 deferred, 0 open). No dispatch was paid for.

#### Decisions and assumptions

- **The operator merged Tasks 7-9 into one atomic tranche** after I surfaced
  that Task 7's own Files list contradicted its steps. Shipping Task 7 alone
  needed an unspecified severity adapter bridging old and new schemas — hard
  rule 3 forbids it. The plan was amended in place with the defect recorded.
- **Raise a plan defect; do not resolve it silently.** The task boundary was
  wrong, not just underspecified, and only the operator could rule on that.
- **Clean up the stray no-op commits, but commit nothing else** — the operator's
  instruction when the test leak was surfaced.

#### What failed

- **`npm test` wrote to the real repository.** Two empty `moved` commits (author
  `t <t@example.invalid>`) landed on `master` plus an untracked `base.txt`,
  matching `test/fixtures/verify/commit-empty.mjs` and `touch-tracked.mjs`.
  Confirmed zero content diff, never pushed; removed with `git reset --soft
  f094c0f`. Intermittent — did not reproduce on two later full runs. **Root
  cause not traced; still open.**
- **A fixture substitution silently no-matched.** The plan-stage dedup test
  replaced `const artifact = revising ? REVISED_PLAN : current;`, but the plan
  fixture says `planDoc({ revised: true })`. The stock fixture ran and the test
  asserted nothing it meant to. Fixed, and both dedup tests now assert their
  substitutions applied. Fifth instance of this class.
- **Fixing the store boundary exposed a hazard-4 fixture defect the review
  predicted.** `test/store.test.ts`'s `decisionInput` defaulted `addressed` with
  `normativeChanges: null` — a combination `validateReconciliation` can never
  return — and two tests asserted against it. The helper now derives the
  conditional shape from the disposition, so no fixture there can describe an
  unreachable state.

#### What worked

- **Verify every review finding against the code before accepting it.** All six
  held, but three only became actionable after tracing: finding 1's reachability
  needed reading `src/spec-stage.ts` **at `f094c0f`** to confirm the legacy code
  already stored upstream-prefixed locations; finding 3's needed
  `src/reconciliation.ts:560-564`, which states outright that a converted
  decision releases its node while surviving as `cannot_determine`; finding 5's
  needed a direct `proposalIdentity` probe.
- **The `unclaimedNodes` correction reversed my own earlier design call.** I had
  aborted the round on any unclaimed node, reasoning fail-closed was simpler.
  That conflated two causes: a node released by a conversion **has** an owning
  decision that section 12 requires stored and blocked by name. Both stages now
  abort only when `conversions.length === 0`. Fail-closed still holds — a
  conversion always yields a `cannot_determine` the gate blocks on.
- **Break-it proved findings 1, 2, and 3**: reverting each fix failed exactly
  the named assertion, then restored green. A regression that passes on first
  write has only shown the reading matched the code.
- **`flag: "wx"` beats a preflight.** `existsSync` + truncating write is two
  filesystem decisions; the exclusive write makes the refusal the write's own
  outcome, and the pre-existing-file test then exercises the real path.
- **An audit event must exist in its own right.** A valid hash chain proves the
  events present were not altered — never that a required one was emitted.
  Proposal persistence had no event at all until this review.

#### Verification

- `npm run typecheck` — clean.
- `npm test` — 625 tests, 624 pass, 0 fail, 1 pre-existing skip (Windows
  Developer Mode symlink guard). Closes the review's own open item: its full run
  never reached a summary.
- `npm run check:docs` — `doc-check: clean`, 36 pre-existing path warnings.
- `git diff f094c0f 467eb88` — empty, proving the stray commits carried nothing.

#### Next time

- Read the *governing* module's comment before designing around its output.
  `reconciliation.ts` already documented the conversion/release behaviour that
  finding 3 turned on; I designed the abort without it.
- One deviation from a review's literal wording is fine when recorded: the
  proposal event is emitted **after** the upsert, because the id it must carry
  does not exist until the row does.

### Step 5b Task 6: reconciliation contract and prompt (2026-09-02)

`f094c0f`. `src/reconciliation.ts`, both reviewer prompts rewritten to the
specialty-only boundary with classification, both reconciliation prompts, the
reconciliation capabilities on both authors. Reviews:
`2026-09-02-task6-code-review.md` and `-2.md`, both reconciled.

- **The refusal/convert boundary.** Structure errors (missing/misplaced fields,
  unknown dispositions, extra/duplicate/missing decisions) refuse by name;
  content failures (unmatched grounding, extra/duplicated/unmatched normative
  claims) rewrite the decision to `cannot_determine`, drop the conditional
  fields, append a bracketed note to the retained rationale, and record the
  conversion. That line is left implicit by the plan.
- **One reconciliation per round, even a clean one** — the reconciler is the
  actor that confirms an empty findings set.
- **The mixed pair cannot share one canonical identity — operator decision, not
  an inference.** Classification determines location shape, so a
  mixed-classification pair is always two canonical findings with two decisions.
  Task 7 proved this at the storage layer without ever constructing the
  unreachable one-canonical-two-mixed-report row (hazard 4). In auto memory.
- **Both review defects lived in the layer that turns a contract into model
  behaviour, and both were reproduced before acceptance:** a fixed example
  `"findingId": 1` the validator refuses whenever the round's ids exclude 1, and
  base fixtures giving every decision the same normative claim, so the happy
  path silently carried a converted decision no test observed.
- **A held break-it mutation was an attack defect, not a coverage gap:** a
  whole-file prompt scan cannot catch a sentence removed from one of two prompts
  while the other keeps its copy.

### Step 5b Task 5: author-proposed panel, deterministic staffing (2026-09-02)

`bacec0a`. `validatePanelRequest` in `src/select.ts`; both stages validate the
request and refuse an unstaffable panel by name before dispatching.

- **The prompts were brought into scope though the task's file list omits them**,
  operator asked first: the default installation's legal size is exactly two, so
  a prompt stating neither bound would have made the named refusal the ordinary
  outcome of a correct run.
- **`staffingShortfall` was extended, not duplicated** — one question asked at
  two moments is one function; a near-copy is a place for one rule to go missing.
- **Two of fourteen break-it mutations held, and both were real coverage gaps**
  — the tests had picked configurations where the old and new rules agree
  numerically. Choose the configuration where they disagree (auto memory:
  `discriminating-configuration`). A comment *claiming* a companion test
  distinguished them did not make it so.
- **The prompt brought into scope to state a bound stated the wrong bound** —
  auto memory: `prompt-bounds-derive-from-validator`.

### Step 5b Task 4: self-critique contract and prompt (2026-09-02)

`578d0eb`. `src/self-critique.ts`, both self-critique prompts, one dispatch per
artifact before `completeStage`.

- **Revision A was implemented although Task 4's step list never absorbed it** —
  nobody rewrote the steps when the operator accepted the prototype result. Read
  a task's governing exit decision, not only its checkboxes.
- **A capability refusal must sit beside the dispatch it guards**, not before a
  draft that could never complete the stage.
- **Making the fixture echo what the prompt actually contained** is how a
  stage-level test can see a prompt: an omission surfaces as `none-listed`.

### Step 5b Tasks 2 and 3: paths module, frozen review config (2026-09-01 to 2026-09-02)

`cd11071` and `5d63726`. Route A — a profile violating the current policy shape
is refused by name in `loadVerifiedProfile`, no migration, no defaults — was the
operator's decision.

- **A task that says "read X from the frozen profile" and also defines what X
  means is two instructions.** Task 3's first attempt wired the configured round
  counts into the legacy loop, making one round mean one panel and zero
  reconciliations. A configuration rename that changes what a run does is the
  signal only one instruction was followed.
- **Tracing the profile consumers settled the decision better than reasoning
  about it did:** no stage read panel size or rounds from the profile at all.

### Step 5b Task 1: prototype run, architecture amended (2026-09-01)

`60587fc`. Twelve real dispatches on `claude-sonnet-5`, **$0.59543**, 430 s,
**zero parse failures**, scratch storage outside production stage order. Cost
overran the $0.25-0.45 estimate. Evidence in
`docs/features/step5b-upstream-findings/2026-09-01-task1-prototype-evidence.md`.

- **Amend every section a design change falsifies, not only the ones named** —
  the operator amended sections 8, 9, 12, 13, and 20.
- **`addressed` admitted an invented obligation.** The author added an acceptance
  criterion the design never states and the artifact gate passed; the operator
  directed normative-delta grounding in response, retained as Task 11's
  regression.
- **A scratch `.mjs` harness can import the repo's `.ts` modules** via
  `await import(pathToFileURL(...).href)` under Node 24 type stripping.
- **State what a deterministic check proves, in the document that describes it.**

### Step 5b: plan reviews and reconciliations (2026-08-31 to 2026-09-01)

Four review records, all reconciled; review 2 superseded the design direction,
so the plan was rewritten in place to 13 tasks.

- **A reconciliation stamp is a claim, not evidence.** Trace the promised result
  through prompt input, parser, storage, and gate before calling a finding
  closed. A review that supersedes a design direction is reconciled by
  rewriting the document, not by patching its findings in.

### Steps 1-7: build order to the deliberate stop (2026-08-29 to 2026-08-31)

Steps 1-5 `83d88c0` and earlier; step 6 `32a714e` (one dispatch, **$0.0673**);
step 7 smoke — passing run $0.07618, blocking run $0.06595, tool probe $0.01116
returning exactly `Glob/Grep/Read`.

- **`bw new-run` could never create a run in a repository that had not gitignored
  `.governance/`** — `openStore()` creates the directory before the clean-tree
  check; every test passed because the shared temp-root helper wrote the
  `.gitignore` first. A fresh `new-run` also refuses a tree dirtied by a blocked
  run's projections, so commit or clean between runs.
- **A documented guarantee was false at a boundary the plan never tested:**
  `resolveExisting` walks with `existsSync`, so a dangling link resolves
  lexically. Refuse what cannot be verified rather than claim a resolution the
  filesystem cannot provide.
- **Real smoke output must drive prompt iteration.** Naming `baseCommit` in the
  spec-author prompt made the model refuse without a git repo; the reviewer
  returned a bare findings object until the prompt stated the full envelope; and
  a genuine plan-coverage block came from the model dropping `(traces to: …)`
  suffixes — the gate was right and the prompt was not softened.
- **Step 5's plan stage mirrors the spec stage without extracting a shared
  abstraction** (hard rule 4). Its round-2 smoke finding — the plan inventing a
  rejection requirement the spec never stated — is the observation behind
  hazard 16.
- `claude -p --output-format json` **does** report `total_cost_usd`, and
  `modelUsage` can carry auxiliary queries, so the effective model is the unique
  entry whose `inputTokens` match `usage.input_tokens`. Migrations anchor to the
  module location, not cwd. The profile carries `startingCommit` because section
  15's `run` table has no column for one.
- `scripts/doc-check.mjs` exits 2 **when the checker itself cannot read the
  source**. Historical-tier documents (`docs/features/**`, `.claude/sessions/**`)
  warn, never error; `docs/proposals/` errors. Path warnings for files a plan is
  about to create are expected; do not chase them to zero.
