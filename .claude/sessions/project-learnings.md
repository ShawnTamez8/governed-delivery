# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-03)

**Shipped and committed:** build order steps 1-8 complete, and **step 9's
milestone — one complete run with queryable cost — is reached.** Step 8
(delivery check) is `Implemented` (plan note, tasks.md checked, standalone
review reconciled); the operator-authorized paid run completed 2026-09-03:
11 dispatches, `claude-sonnet-5`, $0.25019, all eight stages passed,
`delivery_check=passed`, `run=completed`, record matching the signed scope,
chain valid. `master` is the only local branch, ahead of `origin/master` by
all step-8 work: `1890503`…`36a726d` (Tasks 1-6 + review remediation),
`cf19f57` (evidence gate), `8646d75` (paid-run evidence), `d033595` (doc
fix). Nothing pushed — the operator has not asked. Read the head with
`git log -1` rather than trusting a commit id written here.

**Step 8's shipped surface:** declared artifacts are exact file paths
(trailing-slash, starting-tree directory, and run-document refusals for
design/spec/plan under `docs/features/<slug>/`); the
implementation-to-verification handoff is one typed record
(`base=<pre-apply head>; head=<final>` in the gate event, patch base on the
verification record); a pure coverage module compares exactly; `bw deliver`
performs every profile, handoff, scope, git, cleanliness, coverage,
existence-at-head, gate-event, and ancestry check before one
`Store.transaction` inserts the delivery_check stage, writes the record
(carrying its own stage id), completes the stage, transitions the run to
`completed` or `blocked`, and appends the audit event. The standalone review
(`configured_standalone` — the operator's first billed review choice) found
twelve issues, all remediated in `36a726d` with named regressions and
break-and-restore proofs.

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

- **The build order stops at step 9, which is now reached.** Do not build
  past it (deferred stages, dashboard, notifications) without an explicit
  decision; pushing to `origin/master` also awaits the operator.
- Architectural half of review finding F3 (whether the run-duration ceiling
  should bind cost-free stages at all) and finding F12 (the three
  stage-local git helpers may now be extracted under hard rule 4) are
  deferred with triggers in
  `docs/features/delivery-check/2026-09-03-step8-code-review.md`.
- `npm test` intermittently leaks empty `moved` commits and a stray
  `base.txt` onto the real repo (auto memory:
  `test-suite-leaks-into-real-repo`). Root cause in
  `test/verification-stage.test.ts`'s worktree setup is not traced. Run the
  full suite from a disposable checkout when tree purity matters.
- `src/policy.ts:47` names `assertStaffable` in a doc comment; the function
  is `staffingShortfall`. One-word fix whenever that file is next edited for
  its own reasons.
- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record"; that file was never
  written. Historical tier, so `check:docs` only warns — the gap is real.
- Retained evidence outside the repo, no process: step 5b's Task 1
  prototype bundle; `driver.mjs` scratch targets under
  `%LOCALAPPDATA%\Temp\bw-run-skill\` (latest on disk, readable via
  `driver.mjs report --dir <path>`).
- `VERIFY_RETENTION_MAX_BYTES` (64 MB) is chosen, not derived; filesystem and
  network containment for verification commands is unbuilt
  (`docs/proposals/verification-containment.md`). `.governance` location
  configuration is deferred.

**Next up:** nothing is in flight. The operator decides what step 9's
reached milestone means: stop, push, or an explicit decision to build past
the stop. Resuming any work here starts from `git log -1` and this block.

## Diagnostics quick-reference

Durable one-liners live in **auto memory**, which loads automatically — read
`MEMORY.md` there rather than duplicating it here. It carries the
whitespace-collapsing citation match, the unstable `intentKey`, frozen review
defaults, dispatch cost, break-it mechanics, line endings, the source-scanning
trap, duplicated-stage coverage, the discriminating-configuration rule, prompt
bounds deriving from the validator, the `npm test` git leak, SQL comments
defeating substring guards, doc-check's backtick scratch-filename warning, the
independent-review-choice pattern (hazard 14), and the `claude` auth-expiry
envelope.

One line memory does not yet carry:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, PowerShell's BOM, and `proposalIdentity`
  each caused one here.

## Session records

### Step 8: delivery check, Tasks 1-6, the standalone review, and the paid milestone run (2026-09-02 to 2026-09-03)

Seven atomic commits on `master`: `1890503` (Task 1: declared artifacts are
exact file paths — trailing-slash and starting-tree directory refusals),
`02f799b` (Task 2: one typed handoff, base + head in the gate event),
`849571c` (Task 3: the pure coverage module), `f68ebbb` (Task 4:
`runDeliveryStage` — checks first, one final transaction), `98d87b3`
(Task 5: `bw deliver` and the paid driver), `695c16f` (Task 6: architecture
amendments, docs, sweep, disposable gate), `36a726d` (remediation of the
standalone review's twelve findings — the operator's first
`configured_standalone` review; eleven fixable findings landed with named
regressions, one deferred with a trigger). Then `cf19f57` (evidence gate:
review record, plan `Implemented`), `8646d75` (paid-run evidence), and
`d033595` (test-count doc fix). Final state: 682 tests (681 pass, one
pre-existing skip), typecheck clean, smoke 12/12, doc-check 0/36 — and the
paid run completed: 11 dispatches, $0.25019, all eight stages passed,
`delivery_check=passed`, `run=completed`.

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
  uncommitted remediation work.** Restoring the mutation reverted the file
  to HEAD, discarding the review fixes it carried. Auto memory
  `break-it-mechanics` now says it: reverse the mutation, never checkout,
  when the file also carries uncommitted work.
- **Two break mutations were aimed at the wrong branch.** Reversing the diff
  range changed nothing (git lists a deleted path in name-only, so the set
  was identical); inverting the blob check changed nothing for a test whose
  outcome was already a block. Each needed a mutation that changed the
  *outcome class* the test pins. A `|`-delimited sed died on `||` and an
  apostrophe escaped a single-quoted script — both silently no-oped.
- **The first paid attempt spent nothing and blocked at the spec dispatch:**
  the `claude` binary's OAuth session had expired ("Failed to authenticate:
  OAuth session expired and could not be refreshed"). The run failed closed
  with the raw envelope retained and the refusal audited — designed
  behaviour, and a re-authentication fixed it. (Auto memory:
  `cli-auth-expiry-fails-closed`.)
- **A driver step FAILed on its own assertion formatting**: the
  expected-output regex could not match the summary its own code prints
  (`declared=`/`delivered=` sit between `scopeMatch=yes` and `missing=[]`).
  The comparison had passed; the fix was replayed green against the
  retained run without respending. Also: piping the driver through `tail`
  masked its exit code — read driver output unmasked.

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
  projection-exclusion property into exercised code; the `noGateEvent`
  fixture option made the missing-event refusal reachable at all (the audit
  table's append-only trigger forbids deleting the event).
- **Refusal messages that name the repair** turned three permanent wedges
  from dead ends into explained, designed states.
- **doc-check cannot see prose numbers.** A stale test count in SKILL.md
  ("446 tests" vs 682) sailed through `check:docs` — the checker verifies
  paths, pins, and structure, never prose figures. The fixed line carries
  its measurement date and a drift note.

Review: `docs/features/delivery-check/2026-09-03-step8-code-review.md`,
reconciled (11 accepted — 9 full, 2 narrow — 1 deferred, 0 open).

### Step 5b: reviews, storage rebuild, proposals (2026-08-31 to 2026-09-03)

Committed `60587fc` (Task 1 prototype: 12 dispatches, $0.59543, evidence in
`2026-09-01-task1-prototype-evidence.md`), `cd11071`/`5d63726` (Tasks 2-3:
paths module, frozen review config — Route A refusal-by-name was the
operator's decision), `578d0eb` (Task 4: self-critique), `bacec0a` (Task 5:
author-proposed panel), `f094c0f` (Task 6: reconciliation), `54ee29b`
(Tasks 7-9: storage rebuild + proposals — merged into one tranche by the
operator after Task 7's Files list contradicted its steps), `39d5432`
(Tasks 10-13: hazard 16, doc-check `checkHazardCount`, twenty-guard sweep,
$0.36548 production smoke, completion gate). Plan `Implemented`; all review
records reconciled.

Durable lessons still load-bearing from that era (most others are in auto
memory):

- **Only the operator rules on a wrong task boundary.** A plan defect that
  contradicts its own task split is raised, not silently resolved.
- **Read a task's governing exit decision, not only its checkboxes** —
  Revision A was implemented although Task 4's step list never absorbed it.
- **Amend every section a design change falsifies, not only the named ones.**
- **A reconciliation stamp is a claim, not evidence** — trace the promised
  result through prompt, parser, storage, and gate.
- **A review that re-derives rather than re-reads earns its verdict**: the
  Task 13 review reproduced break-it mutations live and queried retained
  databases directly.
- **A scratch `.mjs` harness can import the repo's `.ts` modules** via
  `await import(pathToFileURL(...).href)` under Node 24 type stripping;
  **making a fixture echo what the prompt contained** is how a stage-level
  test sees a prompt (an omission surfaces as `none-listed`).

### Steps 1-7: build order to the deliberate stop (2026-08-29 to 2026-08-31)

Steps 1-5 `83d88c0` and earlier; step 6 `32a714e` (one dispatch, $0.0673);
step 7 smoke — passing run $0.07618, blocking run $0.06595, tool probe
$0.01116 returning exactly `Glob/Grep/Read`.

- **`bw new-run` could never create a run in a repository that had not
  gitignored `.governance/`** — `openStore()` creates the directory before
  the clean-tree check (hazard 11; also in the run-buildworks SKILL gotchas).
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
- **State what a deterministic check proves, in the document that describes
  it** (e.g., architecture section 12's residual-judgement paragraph).
