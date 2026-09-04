# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-04)

**Shipped, committed, and pushed.** Build order steps 1-8 are complete and
**step 9's milestone — one complete run with queryable cost — is reached**
(paid run 2026-09-03: 11 dispatches, `claude-sonnet-5`, $0.25019, all eight
stages passed, `run=completed`, chain valid). `master` is the only local
branch and is level with `origin/master` at `c7fc5e0`. Read the head with
`git log -1` rather than trusting a commit id written here.

**Uncommitted right now:** `docs/features/normative-removal-accounting/`
(untracked) — a `Reconciled` plan closing hazard 17 plus its reconciled
review record. Nothing in `src/` has changed for it; the plan is written, not
built.

**The stop is still in force.** Do not build the deferred stages, a dashboard,
or notifications without an explicit decision. Closing hazard 17 is *not* past
the stop: it fixes `spec_review` and `plan_review`, which shipped in steps 3
and 5.

**Hazard 17 — planned, not built.** The normative delta derives additions
only (`deriveAddedNormativeNodes` emits positive remainders), so an
`addressed` decision can discharge a finding by deleting the acceptance
criterion, before the approval hash is taken. `ARCHITECTURE.md` section 12
specifies the same asymmetry and says the gap is unchanged, so closing it
amends the design document as part of the change. The plan and its
reconciliation are in `docs/features/normative-removal-accounting/`; start at
its Task 1.

**Delivery stage facts to know before touching it:**

- The recorded patch base is the starting commit's **child** (implementation
  commits the run's own projections before its first apply). Delivery enforces
  strict descent — a base equal to the starting commit refuses by name — and
  the fixtures commit projections pre-base so the range-anchoring regression
  is visible.
- Delivery certifies existence at the verified commit per declared artifact
  (`ls-tree` blob check), because `git diff --name-only` lists deletions.
- The record is written inside the final transaction after the stage insert.
- The terminal wedges (duration breach, missing or invalid verification
  record, absent gate event) keep refusing and name the repair: restore the
  evidence or start a fresh run; branch, worktree, and evidence are retained.
- Surface summary and the reconciled review:
  `docs/features/delivery-check/2026-09-03-step8-code-review.md`.

**Reconciliation facts (read before touching that area):**

- Both stages abort on an unclaimed node *before* any decision row is inserted
  and before the `spec.reconcile.record` / `plan.reconcile.record` summaries
  are written. A round that fails the normative accounting therefore has no
  decision rows and no reconcile summary — only the `*.reconcile.invalid`
  audit event and the retained raw response. Verified 2026-09-04.
- The stage tests do not define their own reconciliation behaviour:
  `test/spec-stage.test.ts` and `test/plan-stage.test.ts` drive
  `test/fixtures/harness/emit-spec-stage.mjs` and `emit-plan-stage.mjs`, whose
  `reconcile` functions build the decision payload. Change behaviour there,
  not in an assertion.
- The coverage split in `src/plan-doc.ts` is the **first** `->`: the left side
  is a constrained ID, and last-arrow splitting falsely refused a
  `not_applicable` rationale containing an arrow.

**Open and deferred:**

- **The post-milestone flow decision is open.** Item 4 of
  `docs/proposals/post-milestone-target-flow.md` (code-review specialist
  selection) was deliberately not started 2026-09-04; the operator cleared
  small findings instead rather than answer it by drift. Framing established
  without building anything: the machinery mostly exists and is aimed
  elsewhere — `src/select.ts` has `selectReviewers`, `validatePanelRequest`,
  `staffingShortfall`; `computeRisk` runs at intake; role separation is the
  `role === "reviewer"` filter; section 9 already permits raising the panel
  maximum to five once specialists are registered. Two things are genuinely
  missing: the ranked fill that decides unrequested seats sorts by "has a
  specialty" then alphabetically by agent id, so approved scope, changed
  paths, and technology influence nothing on either panel running today; and
  `code_review` is one of section 5's six deferred stages, so item 4 alone
  would be selection logic with nothing to seat (hard rule 4) and delivering
  it as written pulls in proposal items 6-8.
- **The narrower removal rule is deferred with a trigger.** The hazard 17 plan
  reads the remedy literally: every removed node is claimed, including the
  superseded half of a reword. The narrower alternative — exempt a removal
  whose criterion ID survives in the after-set — is reopened only if a live
  run falsely refuses a legitimate replacement.
- **`scripts/doc-check.mjs` has no test at all.** Its three tasks-as-state
  findings were fixed in `c7fc5e0`, each proved by break-and-restore against
  the live checker, but nothing committed re-runs those probes. A committed
  test would have to write Markdown into the real `docs/` tree, which is the
  leak class below — a considered tradeoff, not an oversight.
- `taskArtifacts`'s checkbox regex opens `^\s*`, and `\s` matches the newline
  under `m`, so the reported line is one short of the offending line.
  Cosmetic, pre-existing, deliberately left alone as out of scope.
- `npm test` intermittently leaks empty `moved` commits and a stray
  `base.txt` onto the real repo. Root cause in
  `test/verification-stage.test.ts`'s worktree setup is untraced; two clean
  runs on 2026-09-04 did not reproduce it. Repairing the real repository's
  history needs operator authorization — run the suite in a disposable copy
  instead.
- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record"; that file was never
  written. Historical tier, so `check:docs` only warns — the gap is real.
- Delivery-check review findings F3 (whether the run-duration ceiling should
  bind cost-free stages) and F12 (the three stage-local git helpers may now be
  extracted under hard rule 4) are deferred with triggers in that review.
- `VERIFY_RETENTION_MAX_BYTES` (64 MB) is chosen, not derived; filesystem and
  network containment for verification commands is unbuilt
  (`docs/proposals/verification-containment.md`). `.governance` location
  configuration is deferred.
- **Durable knowledge leaks out of the repository** —
  `docs/proposals/durable-knowledge-tiers.md`.

**Retained evidence outside the repo — do not run `driver.mjs clean`:**

- `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788500665227\target` —
  the completed web-calculator run. Its retained reconciliation response is
  **load-bearing**: the hazard 17 plan's Task 2 copies it into a repository
  fixture as the recorded negative contract test. `clean` deletes every
  target and already destroyed the `stats` run's per-dispatch record once.
- `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788529105160\target` —
  this session's free smoke target; disposable.
- Step 5b's Task 1 prototype bundle, outside the repo, no process.

**Next up:** commit the two new documents under
`docs/features/normative-removal-accounting/`, then either execute that plan
from Task 1 or take the item-4 decision. Resuming starts from `git log -1`,
`git status`, and this block.

## Diagnostics quick-reference

Durable one-liners that recur, kept here because the file is the only tier
committed to the repository:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, PowerShell's BOM, `proposalIdentity`, and the
  two task-artifact guards each caused one here.
- **Break-test `doc-check` against a scratchpad mirror, not the working tree.**
  The checker anchors to its own location, so a copy holding
  `ARCHITECTURE.md`, `src/migrations/`, and the script runs identically and
  nothing needs restoring. `.claude/skills/doc-check/SKILL.md` says so.
- **Query a run's store before `driver.mjs clean`** — clean deletes the only
  record.
- **Byte-exact approval mechanics under PowerShell:** capture with
  `cmd /c "node <cli> approval-request ... > payload.json"` and sign with
  `cmd /c "node scripts/sign-approval.mjs sign --key <key> < payload.json"`.
  PowerShell redirection re-encodes bytes and has no `<`.
- **Reverse a break-it mutation by editing it back, never `git checkout --`**,
  when the file also carries uncommitted work.
- **The Bash tool mangles long quoted heredocs and regex-bearing `node -e`.**
  A 400-line `<<'EOF'` died with "unexpected EOF while looking for matching
  `'`", and a `node -e` regex containing a backslash class became an
  unterminated literal. Use the Write tool for documents and a scratch `.mjs`
  for anything with escapes.

## Session records

### Small-findings commit, the item-4 framing, and the hazard 17 plan (2026-09-04)

Two commits: `c7fc5e0` (the three tasks-as-state findings plus the
`policy.ts` comment) pushed with `9a12cba`. Then a written, reviewed, and
reconciled plan for hazard 17 — no source touched for it. No spend.

#### Decisions and assumptions

- **Item 4 was deliberately not started.** The operator asked what was next,
  chose to clear the known small findings first, and left the post-milestone
  flow decision open rather than let it be settled by drift.
- **Hazard 17 was recommended next and accepted**, on the argument that
  stable criterion IDs (shipped `9a12cba`) make the symmetric delta cheap: the
  ID distinguishes a reworded criterion from a deleted obligation, which
  prose-keyed nodes could not.
- **Live proof is supplementary, not the verification claim.** The operator
  ruled: require the recorded negative replay plus deterministic positive and
  negative tests; a paid run is optional; an accepted two-sided replacement
  strengthens the evidence; no replacement is inconclusive; a false refusal
  blocks completion; never claim live-provider compliance unless observed.
- **The pre-gate full suite runs in a recursive copy** of the working
  directory outside the repository, `.git` and `node_modules` included — a
  worktree or clone would check out committed state and silently test
  something other than the uncommitted work.
- **The plan reads hazard 17's remedy literally** (claim every removal), with
  the narrower ID-aware rule deferred under a trigger.

#### What failed

- **My `doc-check` break-test used the wrong method.** I renamed real
  repository files (`tasks.md` → `TASKS.md`, `plan.md` → `PLAN.md`) to prove
  the case-fold fix, then restored them. It worked and `git status` confirmed
  the restore, but `.claude/skills/doc-check/SKILL.md` prescribes a scratchpad
  mirror precisely so nothing needs restoring. Read the skill's method before
  inventing one.
- **A 400-line quoted heredoc through the Bash tool aborted** with
  "unexpected EOF while looking for matching `'`", and a `node -e` one-liner
  whose regex held `[^"\\]` became an unterminated literal. Both worked via
  the Write tool and a scratch `.mjs`.

#### What worked

- **Verifying the review's claims before dispositioning them.** All four held:
  the abort-before-record ordering, both emitters returning a single
  added-half claim, section 21 making recorded-output replay load-bearing, and
  the retained web-calculator response containing a real task replacement
  that claims only its added half. That last one turns the durable contract
  fixture into a copy job rather than a new paid run.
- **Break-and-restore on the live checker** proved both `doc-check` fixes: the
  bullet-less `[ ]` passed under the old regex and failed under the new one,
  and each grandfathered record renamed to uppercase was flagged with the
  case-sensitive lookup restored.
- **The plan's own self-review caught an implementation bug**, not just
  wording: the provisional `wouldUse` bookkeeping in the claim loop is keyed
  by text, so with two direction maps a decision claiming the same text twice
  would decrement the wrong budget.

#### Verification

- `npm test` twice — 695 tests, 694 pass, 0 fail, 1 skip; `git status` clean
  after both, no leak observed. The skip is environmental: a file-symlink test
  that Windows without Developer Mode cannot run.
- `npm run typecheck`, `npm run check:docs` — clean (40 warnings, all
  historical paths plus the plan's own future evidence document).
- `node .claude/skills/run-buildworks/driver.mjs smoke` — 12/12 as expected,
  on Node **v26.4.0** (the skill records v24.14.0 as verified).

#### Deferred and open

- Open: the item-4 / post-milestone flow decision.
- Deferred: the narrower ID-aware removal rule, with its trigger in the plan.

#### Next up

- Commit `docs/features/normative-removal-accounting/`, then execute the plan
  from Task 1.

### Stable criterion IDs shipped (2026-09-04, `9a12cba`)

Spec-minted canonical IDs, the exact bidirectional Coverage relation at all
three plan checkpoints, and a fresh-run repair for old parse-boundary runs.
Proved live by two operator-authorized paid chains — `stats` (18 IDs,
$0.63735) and `web-calculator` (18 criteria from a PRD, $0.84567) — both
`run=completed` with IDs surviving spec → plan coverage → signed scope →
delivery. Evidence:
`docs/features/stable-criterion-ids/real-run-evidence.md`.

Durable lessons from it:

- **The last-arrow coverage split falsely refused valid plans**, and the stale
  comment argued the wrong direction convincingly. Re-derive a split when a
  constrained ID moves to one side of a delimiter.
- **The audit chain answers panel questions directly.** web-calculator's plan
  panel returned two findings (AC-008 medium traceability, AC-015 low
  security) and seated a **security** reviewer where `stats` drew consistency
  — composition adapts to content. With the 2026-09-03 `clamp` observation
  (four self-critique entries, zero panel findings) that is three data points
  on what a panel contributes.
- The operator ruled an in-session code review discharges a plan's review
  requirement; the Anthropic-cloud standalone review stays unrun.

### Coverage-gate investigation, hazard 17, and the knowledge-tier gap (2026-09-03)

No source changed. Four driven scratch runs, $0.83080. Diagnosis and the
reconciliation that corrected three of its own claims are in
`.claude/sessions/2026-09-03-debug-plan-coverage-gate-paraphrase-mismatch.md`.

- **Hazard 17 was raised out of it** and `ARCHITECTURE.md` section 22
  renumbered to seventeen. Read the entry before touching reconciliation.
- **The repository already held the answer and it was not found.**
  `docs/proposals/spec-kit-harness-review.md` carried the same failure and a
  defect the investigation never found, referenced by nothing but the backlog
  README. A pruned half-sentence in this file had also carried the original
  decision ("the gate was right; the prompt was not softened to pass") until
  `f094c0f` trimmed it. Both are the subject of
  `docs/proposals/durable-knowledge-tiers.md`.
- **A decision that lives only in the narrative tier dies at the next
  compaction.** Durable content belongs in `docs/hazards.md` or a proposal;
  this file carries the resume point and points outward.

### Step 8: delivery check, the standalone review, and the paid milestone run (2026-09-02 to 2026-09-03)

Tasks 1-6 landed as `1890503`…`36a726d`, then `cf19f57` (evidence gate),
`8646d75` (paid-run evidence), `d033595` (doc fix). Review reconciled:
11 accepted, 1 deferred, 0 open.

- **The operator chose `/code-review ultra` over the in-session subagent**
  (hazard 14) — a billed `configured_standalone` review that earned its cost:
  it found deletions counted as delivered, a widened certified range, the
  run's own documents passing every gate, and completion without
  `verification.gate.pass`.
- **Making every fixture reproduce the real chain's shape** (projections
  committed before the base) turned the strict-descent refusal and the
  projection-exclusion property into exercised code; the `noGateEvent` option
  made the missing-event refusal reachable at all, since the audit table's
  append-only trigger forbids deleting the event.
- **A break mutation must change the outcome class the test pins**, not a
  reversal the code path never distinguishes; and `sed` with `|` delimiters or
  an apostrophe inside a single-quoted script silently no-ops.
- **The first paid attempt spent nothing and blocked at the spec dispatch:**
  the `claude` OAuth session had expired, and the run failed closed with the
  envelope retained and the refusal audited — designed behaviour.
- **doc-check cannot see prose numbers.** A stale test count in a SKILL.md
  sailed through `check:docs`; the checker verifies paths, pins, and
  structure, never prose figures.

### Step 5b: reviews, storage rebuild, proposals (2026-08-31 to 2026-09-03)

Tasks 1-13 across `60587fc`…`39d5432`. Plan `Implemented`; all reviews
reconciled.

- **Only the operator rules on a wrong task boundary.** A plan defect that
  contradicts its own task split is raised, not silently resolved.
- **Read a task's governing exit decision, not only its checkboxes.**
- **Amend every section a design change falsifies, not only the named ones.**
- **A reconciliation stamp is a claim, not evidence** — trace the promised
  result through prompt, parser, storage, and gate.
- **A scratch `.mjs` harness can import the repo's `.ts` modules** via
  `await import(pathToFileURL(...).href)` under Node type stripping; **making
  a fixture echo what the prompt contained** is how a stage-level test sees a
  prompt (an omission surfaces as `none-listed`).

### Steps 1-7: build order to the deliberate stop (2026-08-29 to 2026-08-31)

Steps 1-5 `83d88c0` and earlier; step 6 `32a714e` ($0.0673); step 7 smoke
runs $0.07618 passing, $0.06595 blocking, $0.01116 tool probe returning
exactly `Glob/Grep/Read`.

- **`bw new-run` could never create a run in a repository that had not
  gitignored `.governance/`** — `openStore()` creates the directory before the
  clean-tree check (hazard 11).
- **A documented guarantee was false at a boundary the plan never tested:**
  `resolveExisting` walks with `existsSync`, so a dangling link resolves
  lexically. Refuse what cannot be verified.
- **Real smoke output must drive prompt iteration.** Naming `baseCommit` in
  the spec-author prompt made the model refuse without a git repo; the
  reviewer returned a bare findings object until the prompt stated the full
  envelope.
- **Step 5's plan stage mirrors the spec stage without extracting a shared
  abstraction** (hard rule 4). Its round-2 finding — the plan inventing a
  rejection requirement the spec never stated — is the observation behind
  hazard 16.
- **State what a deterministic check proves, in the document that describes
  it** (e.g. architecture section 12's residual-judgement paragraph).
