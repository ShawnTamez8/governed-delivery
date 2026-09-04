# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

This file is the system of record. Harness auto memory mirrors some of its
durable one-liners so they load automatically, but the mirror is machine-local
and per-clone-path: nothing is ever removed from here on the grounds that
memory holds it (`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-09-04)

**Shipped and pushed.** Build order steps 1-8 are complete and **step 9's
milestone — one complete run with queryable cost — is reached** (paid run
2026-09-03: 11 dispatches, `claude-sonnet-5`, $0.25019, all eight stages
passed, `run=completed`, chain valid). `master` is the only local branch and is
level with `origin/master` at `90a7ed9`. Read the head with `git log -1` rather
than trusting a commit id written here.

**Uncommitted right now — 23 paths, verified against `git status`:** the
hazard-17 implementation, the list-marker remedy, run 3's evidence, and the
driver design swap. Eighteen modified plus five new:
`docs/features/normative-removal-accounting/2026-09-04-code-review.md`,
`.../real-run-evidence.md`,
`test/fixtures/recorded/spec-reconciliation-web-calculator-list-marker.json`,
`test/fixtures/recorded/plan-reconciliation-web-calculator-prd.json`, and
`.claude/skills/run-buildworks/web-calculator-design.md`.

**The stop is still in force.** Do not build the deferred stages, a dashboard,
or notifications without an explicit decision. Closing hazard 17 is *not* past
the stop: it fixes `spec_review` and `plan_review`, which shipped in steps 3
and 5.

**Hazard 17 is closed and its plan is `Implemented` at outcome 2.** The
mechanism is described where it belongs — `docs/hazards.md` entry 17 and
`ARCHITECTURE.md` section 12 both assert the shipped behaviour — and the three
live runs are in
`docs/features/normative-removal-accounting/real-run-evidence.md`. Run 3
completed a chain in which a live author claimed both halves of a real
replacement, passing with `unclaimedRemoved=0`.

**The list-marker defect's general rule, which outlives the fix: "the exact
text of X" is not a stated constraint unless the prompt also says what X's
text is — and a shape the document schema forces the author to read is the
shape the author sends back.** The fix (both halves, by operator decision) is
`normalizeNodeText` applied to both sides of every claim comparison plus a
`nodeForm` argument on `reconciliationDecisionContract`; hazards entry 3
carries the incident. Still unproven live: no run has passed `spec_review`
over a *spec-side* replacement, where the marker actually appears.

**Reconciliation facts — read before touching that area:**

- Both stages abort on an unclaimed node *before* any decision row is inserted
  and before the `spec.reconcile.record` / `plan.reconcile.record` summaries
  are written, so a round that fails the accounting has no decision rows and
  no summary — only the `*.reconcile.invalid` event and the retained response.
- **A recorded response cannot be replayed without the governing document it
  was dispatched with**: grounding is checked against it, so a fixture holding
  only the response converts every decision on grounding and proves nothing.
  All three recorded fixtures therefore carry their governing text.
- The stage tests do not define their own reconciliation payload:
  `test/spec-stage.test.ts` and `test/plan-stage.test.ts` drive
  `test/fixtures/harness/emit-spec-stage.mjs` and `emit-plan-stage.mjs`, and
  each test file carries **eight copies** of the emitter's decision block as
  substitution strings — change an emitter's payload and those copies move
  with it, or the substitutions silently no-match.
- The coverage split in `src/plan-doc.ts` is the **first** `->`; `listItems`
  strips only `^-\s*`, so a `*`-marked task keeps its marker as node text.
- **A rationale that cannot be broken is not a rationale.** The plan required
  one provisional claim counter per direction because a shared one "would
  decrement the wrong budget" — aliasing the maps failed no assertion, because
  at most one direction is ever non-zero for a given text. The pair is kept;
  the comment says what the break-it run showed.

**Delivery stage facts** (surface summary and reconciled review:
`docs/features/delivery-check/2026-09-03-step8-code-review.md`):

- The recorded patch base is the starting commit's **child** (implementation
  commits the run's projections before its first apply); delivery enforces
  strict descent, and the fixtures commit projections pre-base so the
  range-anchoring regression stays visible.
- Delivery certifies existence at the verified commit per declared artifact
  (`ls-tree` blob check), because `git diff --name-only` lists deletions. The
  record is written inside the final transaction after the stage insert.
- The terminal wedges (duration breach, missing or invalid verification
  record, absent gate event) refuse and name the repair: restore the evidence
  or start a fresh run; branch, worktree, and evidence are retained.

**The driver's committed design is the web calculator, not the clamp.**
`.claude/skills/run-buildworks/web-calculator-design.md` holds it, byte-
identical to the design run 3 completed against; `driver.mjs` reads it rather
than embedding a template literal, so swapping designs is a content edit and
prose containing a backtick cannot corrupt the file every dispatch reads.
`DEFAULT_SLUG` is `web-calculator`, and **a paid chain now costs $1.00–$2.00,
not $0.25** — every clamp run produced clean panels, so no findings, no
decisions, and no exercise of the review, remediation, proposal, or
normative-accounting paths. Nothing else in the driver is design-specific
(verify commands `node --version` / `npm --version`, delivery assertion
`declared=\d+`, no test couples to it). The free `smoke` spends nothing.

**Open and deferred:**

- **The post-milestone flow decision is open.** Item 4 of
  `docs/proposals/post-milestone-target-flow.md` (code-review specialist
  selection): the machinery mostly exists but is aimed elsewhere —
  `src/select.ts` has `selectReviewers`, `validatePanelRequest`,
  `staffingShortfall`, and section 9 already permits a five-seat panel once
  specialists are registered. Two things are missing: the ranked fill sorts by
  "has a specialty" then alphabetically, so scope, changed paths, and
  technology influence nothing on either live panel; and `code_review` is one
  of section 5's six deferred stages, so item 4 alone is selection logic with
  nothing to seat (hard rule 4) and pulls in proposal items 6-8.
- **A live spec-side replacement is unproven** — the one claim no run has made.
  Needs its own authorization and a design shaped to provoke a criterion
  reword; re-running an existing chain for it is hazard 7.
- **The narrower removal rule stays deferred with its trigger:** exempting a
  removal whose criterion ID survives in the after-set is reopened only if a
  live run falsely refuses a legitimate reword. Nothing observed is that run.
- **`scripts/doc-check.mjs` has no test.** Its three tasks-as-state findings
  were fixed in `c7fc5e0`, each proved by break-and-restore against the live
  checker, but nothing committed re-runs those probes — a committed test would
  write Markdown into the real `docs/` tree. A considered tradeoff.
- `npm test` intermittently leaks empty `moved` commits and a stray `base.txt`
  onto the real repo; root cause in `test/verification-stage.test.ts`'s
  worktree setup is untraced and four clean runs on 2026-09-04 did not
  reproduce it. Repairing real history needs operator authorization — run the
  suite in a disposable copy instead.
- `taskArtifacts`'s checkbox regex opens `^\s*` and `\s` matches the newline
  under `m`, so the reported line is one short. Cosmetic, pre-existing.
- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record"; that file was never
  written. Historical tier, so `check:docs` only warns — the gap is real.
- Delivery-check findings F3 (duration ceiling binding cost-free stages) and
  F12 (extracting the three stage-local git helpers) are deferred with
  triggers in that review. `VERIFY_RETENTION_MAX_BYTES` (64 MB) is chosen, not
  derived; verification containment is unbuilt
  (`docs/proposals/verification-containment.md`); `.governance` location
  configuration is deferred.
- **Durable knowledge leaks out of the repository** —
  `docs/proposals/durable-knowledge-tiers.md`.

**Nothing outside the repository is load-bearing.** Every recorded response a
test or document depends on is committed under `test/fixtures/recorded/` with
provenance. Every scratch target under
`C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\` is disposable, including
the three 2026-09-04 paid runs (`1788540972942`, `1788541898254`,
`1788544250363`) whose stores were queried before anything was cleaned. Still
query a store before `driver.mjs clean` — it deletes every target and already
destroyed the `stats` run's per-dispatch record once. Step 5b's Task 1
prototype bundle remains outside the repo with no process.

**Next up:** commit all 23 paths together, then take the item-4 decision.
Nothing is blocked. Resuming starts from `git log -1`, `git status`, and this
block.

## Diagnostics quick-reference

Durable one-liners that recur, kept here because the file is the only tier
committed to the repository:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, PowerShell's BOM, `proposalIdentity`, the two
  task-artifact guards, and `normalizeNodeText` each caused one here.
- **Identify a recorded artifact revision by hash, never by dispatch order.**
  The revision on disk before reconciliation is the **self-critique round's**
  output, not the authoring dispatch's, so the authoring text matches neither
  `specHashBefore` nor `planHashBefore`. Match every extracted document
  against the run's own audit hashes before committing it.
- **A zero counter in an audit summary is not evidence of a guard firing.**
  `unclaimedRemoved=0` reads identically when a removal was claimed and when
  no removal existed. Prove the delta by replay, and prove the run depended on
  the mechanism by replaying with the mechanism's input suppressed.
- **Break-test `doc-check` against a scratchpad mirror, not the working tree.**
  The checker anchors to its own location, so a copy holding `ARCHITECTURE.md`,
  `src/migrations/`, and the script runs identically and nothing needs
  restoring. `.claude/skills/doc-check/SKILL.md` says so.
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

### Hazard 17 implemented, the list-marker remedy, three paid runs, and the driver design swap (2026-09-04)

Executed `docs/features/normative-removal-accounting/plan.md` end to end via
`implement-plan`: six tasks, one mandatory code review (two findings, both
reconciled), then an operator decision and a third paid run. No commit yet.
Total spend across three authorized runs: **$1.98227**.

#### Decisions and assumptions

- **The operator authorized three paid runs, one at a time**, each its own
  decision rather than a retry of the last (hazard 7). Run 2's design and run
  3's design were both operator-supplied, replacing the driver's clamp.
- **Both list-marker remedies were chosen, not one**: tolerate the marker in
  the comparison *and* state the node form in the prompt. Tolerance alone
  leaves an author succeeding by accident; the prompt alone leaves a correct
  answer refused whenever an author copies the line it is reading.
- **Replace the driver's clamp design with the web calculator**, accepting the
  cost rise, because a design too small to attract a finding cannot exercise
  review, remediation, or reconciliation. The operator conditioned this on the
  blast radius being small — it is two constants plus the skill doc, and run 3
  had already proved the same swap end to end.
- **A blocking live result is the operator's decision, not a defect to work
  around.** Run 2's refusal was measured, the remedies named, and none applied
  until the decision came.

#### What failed

- **Run 2 blocked at `spec_review` for $0.39572** on the list-marker mismatch,
  not on anything the plan changed: a pure addition claim failed identically,
  so the run would have blocked before removals were accounted for at all.
- **Ten spec-stage tests failed after Task 2** — expected fixture debt, since
  both emitters were addition-only. Each failure was verified
  replacement-shaped before the emitters were fixed rather than the assertions.
- **The obvious way to find a recorded before-revision is wrong:** the
  authoring dispatch's text hashes to neither audit hash; the self-critique
  round's artifact does.
- **A `node -e` substitution containing a curly apostrophe silently missed**
  the plan-side prompt assertion; caught by a grep count, fixed with `Edit`.

#### What worked

- **Hash-verified extraction** — the script throws on mismatch, which caught
  the self-critique subtlety instead of committing a delta that never existed.
- **The counterfactual replay as evidence.** Run 3's response with the removal
  suppressed from the before-set converts the decision and blocks, proving the
  run depended on the new accounting; committed beside the positive replay.
- **Every guard broken and restored** — additions-only matching, an
  always-empty `unclaimedRemovals`, each stage's abort, the prompt sentence,
  `normalizeNodeText`, the claim-matching refusal. Both run-3 tests passed on
  first write and were believed only after a mutation failed them.
- **The full suite in a recursive copy outside the repository** carried the
  uncommitted work (a worktree or clone would not) and kept the leak away from
  real history. Four copies, all deleted.

#### Verification

- `npm test` in an isolated copy — **711 tests, 710 pass, 0 fail, 1
  environmental skip** against the 695/694/0/1 baseline; `HEAD` unmoved in
  both trees, no leak reproduced.
- `npm run typecheck` exit 0; `npm run check:docs` exit 0 at 17 hazard
  headings; `reconciliation`+`prompts` 63/63, both stage suites 96/96,
  `schema.test.ts` 8/8 alone after the section 12 edit.
- `driver.mjs smoke` 12/12 before and after the design swap, target
  `design.md` byte-compared to the committed one.
- Run 3 (`paid --yes`): 11 dispatches, $1.34097, all eight stages passed,
  `run=completed`, `scopeMatch=yes declared=4 delivered=4`, chain valid.

#### Deferred and open

- Open: the item-4 / post-milestone flow decision, untouched this session.
- Open: a live `spec_review` pass over a spec-side replacement — the marker
  path is proven only against recorded output.
- Deferred: the narrower ID-aware removal rule, trigger unchanged.

#### Next up

- Commit all 23 paths, then take the item-4 decision.

### Small-findings commit and the hazard 17 plan (2026-09-04)

Two commits: `c7fc5e0` (three tasks-as-state findings plus the `policy.ts`
comment) pushed with `9a12cba`. Then a written, reviewed, and reconciled plan
for hazard 17 — no source touched, no spend. Baseline at that point:
`npm test` 695 tests, 694 pass, 0 fail, 1 environmental skip (a file-symlink
test Windows without Developer Mode cannot run).

- **Item 4 was deliberately not started.** The operator chose to clear known
  small findings first rather than settle the post-milestone flow by drift.
- **Hazard 17 was recommended and accepted** on the argument that stable
  criterion IDs (`9a12cba`) make the symmetric delta cheap: the ID
  distinguishes a reworded criterion from a deleted obligation.
- **Live proof was ruled supplementary, not the verification claim** — the
  recorded replay plus deterministic tests carry it; a false live refusal
  blocks completion; never claim live-provider compliance unless observed.
- **Verifying a review's claims before dispositioning them** paid off: all
  four held, which turned the durable contract fixture into a copy job rather
  than a new paid run.

### Stable criterion IDs shipped (2026-09-04, `9a12cba`)

Spec-minted canonical IDs, the exact bidirectional Coverage relation at all
three plan checkpoints, and a fresh-run repair for old parse-boundary runs.
Proved by two paid chains — `stats` (18 IDs, $0.63735) and `web-calculator`
(18 criteria from a PRD, $0.84567) — both `run=completed` with IDs surviving
spec → plan coverage → signed scope → delivery. Evidence:
`docs/features/stable-criterion-ids/real-run-evidence.md`.

- **The last-arrow coverage split falsely refused valid plans**, and the stale
  comment argued the wrong direction convincingly. Re-derive a split when a
  constrained ID moves to one side of a delimiter.
- **Panel composition adapts to content.** web-calculator's plan panel
  returned two findings and seated a **security** reviewer where `stats` drew
  consistency; with the `clamp` observation (four self-critique entries, zero
  panel findings) that is three data points on what a panel contributes.
- The operator ruled an in-session code review discharges a plan's review
  requirement; the Anthropic-cloud standalone review stays unrun.

### Coverage-gate investigation and the knowledge-tier gap (2026-09-03)

No source changed. Four driven scratch runs, $0.83080. Diagnosis in
`.claude/sessions/2026-09-03-debug-plan-coverage-gate-paraphrase-mismatch.md`.

- **Hazard 17 was raised out of it** and `ARCHITECTURE.md` section 22
  renumbered to seventeen.
- **The repository already held the answer and it was not found.**
  `docs/proposals/spec-kit-harness-review.md` carried the same failure and a
  defect the investigation never found, referenced by nothing but the backlog
  README. A pruned half-sentence in this file had also carried the original
  decision until `f094c0f` trimmed it. Both are the subject of
  `docs/proposals/durable-knowledge-tiers.md`.
- **A decision that lives only in the narrative tier dies at the next
  compaction.** Durable content belongs in `docs/hazards.md` or a proposal.

### Step 8: delivery check, the standalone review, the paid milestone (2026-09-02 to 2026-09-03)

Tasks 1-6 landed as `1890503`…`36a726d`, then `cf19f57` (evidence gate),
`8646d75` (paid-run evidence), `d033595` (doc fix). Review reconciled: 11
accepted, 1 deferred, 0 open.

- **The operator chose `/code-review ultra` over the in-session subagent**
  (hazard 14) — a billed `configured_standalone` review that earned its cost:
  deletions counted as delivered, a widened certified range, the run's own
  documents passing every gate, completion without `verification.gate.pass`.
- **Making every fixture reproduce the real chain's shape** (projections
  committed before the base) turned the strict-descent refusal and the
  projection-exclusion property into exercised code.
- **A break mutation must change the outcome class the test pins**, not a
  reversal the code path never distinguishes.
- **The first paid attempt spent nothing and blocked at the spec dispatch:**
  the `claude` OAuth session had expired, and the run failed closed with the
  envelope retained and the refusal audited — designed behaviour.
- **doc-check cannot see prose numbers.** A stale test count in a SKILL.md
  sailed through `check:docs`; the checker verifies paths, pins, and
  structure, never prose figures.

### Step 5b: reviews, storage rebuild, proposals (2026-08-31 to 2026-09-03)

Tasks 1-13 across `60587fc`…`39d5432`. Plan `Implemented`; reviews reconciled.

- **Only the operator rules on a wrong task boundary.** A plan defect that
  contradicts its own task split is raised, not silently resolved.
- **Read a task's governing exit decision, not only its checkboxes**, and
  amend every section a design change falsifies, not only the named ones.
- **A reconciliation stamp is a claim, not evidence** — trace the promised
  result through prompt, parser, storage, and gate.
- **A scratch `.mjs` harness can import the repo's `.ts` modules** via
  `await import(pathToFileURL(...).href)` under Node type stripping; making a
  fixture echo what the prompt contained is how a stage-level test sees a
  prompt (an omission surfaces as `none-listed`).

### Steps 1-7: build order to the deliberate stop (2026-08-29 to 2026-08-31)

Steps 1-5 `83d88c0` and earlier; step 6 `32a714e` ($0.0673); step 7 smoke runs
$0.07618 passing, $0.06595 blocking, $0.01116 tool probe returning exactly
`Glob/Grep/Read`.

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
