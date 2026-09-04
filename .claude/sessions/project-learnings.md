# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-04)

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

**Step 8's shipped surface** is summarized in `ARCHITECTURE.md` and the
reconciled review record (`docs/features/delivery-check/2026-09-03-step8-code-review.md`):
declared artifacts are exact file paths, the implementation-to-verification
handoff is one typed record, a pure coverage module compares exactly, and
`bw deliver` runs every check before one `Store.transaction` completes or
blocks the run.

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
  prototype bundle; one `driver.mjs` scratch target with the completed
  web-calculator run at
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788500665227\target`
  (readable via `driver.mjs report --dir <path>`; earlier targets, including
  the stats run's record, were deleted by `driver.mjs clean`).
- `VERIFY_RETENTION_MAX_BYTES` (64 MB) is chosen, not derived; filesystem and
  network containment for verification commands is unbuilt
  (`docs/proposals/verification-containment.md`). `.governance` location
  configuration is deferred.
- **The stable-criterion-ids feature is complete in the working tree,
  live-validated, and uncommitted.** Spec-minted canonical IDs, the exact
  bidirectional Coverage relation at all three plan checkpoints, and the
  fresh-run repair for old parse-boundary runs — plus this session's fix:
  the coverage split in `src/plan-doc.ts` is the *first* `->` (the left side
  is a constrained ID; last-arrow splitting falsely refused `not_applicable`
  prose containing an arrow), regression test proven by break-and-restore.
  Full suite 694 pass / 0 fail / 1 pre-existing skip, typecheck clean,
  doc-check clean. **Live proof exists:** two operator-authorized paid runs
  completed end to end on scratch targets 2026-09-04 — `stats` (18 criteria,
  11 dispatches, $0.63735) and `web-calculator` (18 criteria from a PRD,
  11 dispatches, $0.84567) — IDs survived spec → plan coverage → signed
  scope → delivery through remediation rounds with no false refusals. This
  supersedes the earlier blocked 13-criterion calculator attempt (whose
  retained reproduction was deleted by `driver.mjs clean` this session).
  The in-session code review of the diff found the coverage-split defect
  (fixed) and nothing else; the operator ruled 2026-09-04 that it discharges
  the plan's review requirement — the plan is `Implemented`.
  Evidence: `docs/features/stable-criterion-ids/real-run-evidence.md` and
  the audit chain in the retained web-calculator target below.
- **Hazard 17 is unguarded by design, not by oversight.** The normative delta
  derives additions only, so a reconciliation can discharge a finding by
  deleting the acceptance criterion — before the approval hash is taken.
  `ARCHITECTURE.md` section 12 specifies the same asymmetry, so closing it is
  a design change rather than a patch.
- **Durable knowledge leaks out of the repository.** Compaction has been
  promoting lessons into machine-local auto memory, and the Diagnostics
  quick-reference below points at a store no second machine has. Filed as
  `docs/proposals/durable-knowledge-tiers.md`.

- **Tasks-as-state shipped with three unremediated review findings**, all
  low, none blocking, none fixed in the commit that landed it. (1) The two
  checkbox guards disagree: `src/plan-doc.ts` refuses a bare `[ ]` with no
  bullet, `scripts/doc-check.mjs` requires the bullet and lets it through —
  measured 2026-09-03, and the same tolerance-at-one-boundary class listed
  below. (2) Both checker allowlists compare paths case-sensitively while
  detection folds case, so a grandfathered record renamed `TASKS.md` is
  flagged — on Windows, where this repository runs. (3) `CLAUDE.md` names
  the three grandfathered task records but not the eleven checklist plans
  the checker also exempts; `.claude/skills/doc-check/SKILL.md` names both.

**Next up:** operator decisions — commit the stable-criterion-ids working tree
(feature, coverage-split fix, plan `Implemented`, relocated debug session
records), and push when ready. Resuming any work starts from `git log -1`,
`git status`, and this block.

## Diagnostics quick-reference

Durable one-liners were promoted into **auto memory** on the machine that ran
those sessions — verified 2026-09-04: no governed-delivery store exists under
`C:\Users\tamezs\.claude\projects\` on this machine, so that layer cannot be
assumed present (the durable-knowledge-tiers gap). The lessons it carried are
recoverable from the session records and review documents named below.

One line memory does not yet carry:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, PowerShell's BOM, and `proposalIdentity`
  each caused one here.

## Session records

### Stable-criterion-ids review, coverage-split fix, and two live E2E runs (2026-09-04)

Working tree only — nothing committed. Reviewed the uncommitted feature diff,
fixed its one defect, then proved the feature live with two operator-authorized
paid chains against scratch targets: `stats` (16 design bullets → 18 IDs,
$0.63735) and `web-calculator` (18 criteria from an operator PRD, $0.84567),
both `run=completed`, chain valid, delivery scope matching the signed approval.
$1.48302 across the session.

#### Decisions and assumptions

- Operator approved both paid runs and both approvals; the second signature
  was executed by the agent on the operator's explicit "approve for me" after
  the signing script failed for them locally.
- Review of the feature diff used the in-session code-review agent; the
  operator ruled it discharges the plan's review requirement and directed
  the plan `Implemented` (the Anthropic-cloud standalone review stays unrun).
- The two `.Codex/sessions/` debug analyses were relocated into
  `.claude/sessions/` — a second sessions location would fork the convention.

#### What failed

- **Last-arrow coverage split falsely refused valid plans**: with all free
  prose moved right of the arrow, `lastIndexOf("->")` split inside a
  `not_applicable` rationale containing `->`, misreporting an invalid
  criterion ID after a paid dispatch. Fixed to `indexOf`; the old justifying
  comment argued the stale direction convincingly — re-derive the split when
  a constrained ID moves to one side of a delimiter. The prose-refusal test's
  pinned diagnostic changed shape (names the prefix before the first arrow).
- **The stats run's per-dispatch record became unqueryable** after
  `driver.mjs clean` — the operator later asked for its self-critique counts
  and only the cost survived (captured pre-clean). Query the store before
  cleaning; clean deletes the only record.

#### What worked

- **Byte-exact approval mechanics under PowerShell**: capture the payload with
  `cmd /c "node <cli> approval-request ... > payload.json"` and sign with
  `cmd /c "node scripts/sign-approval.mjs sign --key <key> < payload.json"` —
  PowerShell redirection re-encodes bytes and does not support `<`.
- **The audit chain answers panel questions directly**: web-calculator spec
  self-critique returned 5 entries and its panel 0 findings; plan
  self-critique 4 entries and its panel 2 findings (AC-008 medium
  traceability — no task verified decimal results; AC-015 low security —
  unvalidated localStorage theme value), both resolved in round 1. The panel
  seated a **security** reviewer for the browser/localStorage design where
  stats drew consistency — composition adapts to content. Second and third
  data points for the panel-contribution question below.
- Spot-checks of both delivered artifacts matched their criteria (stats
  functions exact; calculator structural checks: 19 buttons, no external
  refs, viewport/aria-live/prefers-color-scheme/localStorage present).

#### Running state

- Scratch target with the completed web-calculator run:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788500665227\target` —
  retained evidence - remove with
  `node .claude/skills/run-buildworks/driver.mjs clean`.

#### Verification

- `npm test` — 694 pass, 0 fail, 1 pre-existing skip; no tree leak observed
  this pass. `npm run typecheck`, `npm run check:docs` — clean (39
  pre-existing historical path warnings).
- `node --test test/plan-doc.test.ts` — 23/23; the new arrow-in-rationale
  regression test confirmed failing under the reverted split before restore.

#### Deferred and open

- Auto-memory mirror skipped: no governed-delivery store exists under
  `C:\Users\tamezs\.claude\projects\` on this machine — the
  `docs/proposals/durable-knowledge-tiers.md` gap observed directly.

#### Next up

- Operator: commit the working tree and push when ready.

### Coverage-gate investigation, hazard 17, and the knowledge-tier gap (2026-09-03)

No source changed. Four driven scratch runs (two `clamp`, one completing
end to end; two `calculator`, both blocked — the second at
`plan.coverage.incomplete` with all 16 criteria reported uncovered),
$0.83080 across the session.

The second block is the one that mattered. Diagnosis, and the reconciliation
that corrected three of its own claims, are in
`.claude/sessions/2026-09-03-debug-plan-coverage-gate-paraphrase-mismatch.md`
— read that rather than restating it here. What belongs in the resume point:

- **Hazard 17 was raised out of it** and `ARCHITECTURE.md` section 22 renumbered
  to seventeen. Read the entry before touching reconciliation.
- **The repository already held the answer and it was not found.**
  `docs/proposals/spec-kit-harness-review.md` carried the same failure, three
  dispositions, and a defect the investigation never found — referenced by
  nothing but the backlog README. A pruned half-sentence in this file had
  also carried the original decision ("the gate was right; the prompt was not
  softened to pass") until `f094c0f` trimmed it. Both are the subject of
  `docs/proposals/durable-knowledge-tiers.md`.
- **One observation, not a rate:** in the `clamp` run that completed, the
  author's self-critique returned four critique entries and both seated
  reviewers returned zero findings — every edit in that run came from the
  author critiquing its own draft, and the reconciliation dispatch confirmed
  an empty round (`specHashBefore` equal to `specHashAfter`). Worth a second
  data point before concluding anything about what the panel contributes on
  a small, tightly-scoped design.
- **The lesson for this file specifically:** a decision that lives only in the
  narrative tier dies at the next compaction. Durable content belongs in
  `docs/hazards.md` or a proposal; this file carries the resume point and
  points outward.

### Step 8: delivery check, Tasks 1-6, the standalone review, and the paid milestone run (2026-09-02 to 2026-09-03)

Tasks 1-6 landed as seven atomic commits `1890503`…`36a726d` (the last
remediating the standalone review's twelve findings — the operator's first
`configured_standalone` review), then `cf19f57` (evidence gate), `8646d75`
(paid-run evidence), `d033595` (doc fix); per-task mapping is in `git log`.
Final state: 682 tests (681 pass, one pre-existing skip), typecheck clean,
smoke 12/12, doc-check clean — and the paid run completed: 11 dispatches,
$0.25019, all eight stages passed, `run=completed`.

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
- **Two break mutations were aimed at the wrong branch** — each needed a
  mutation that changed the *outcome class* the test pins, not a reversal the
  code path never distinguishes; and sed with `|` delimiters or an apostrophe
  in a single-quoted script silently no-ops.
- **The first paid attempt spent nothing and blocked at the spec dispatch:**
  the `claude` binary's OAuth session had expired ("Failed to authenticate:
  OAuth session expired and could not be refreshed"). The run failed closed
  with the raw envelope retained and the refusal audited — designed
  behaviour, and a re-authentication fixed it. (Auto memory:
  `cli-auth-expiry-fails-closed`.)
- **A driver step FAILed on its own assertion formatting** — the comparison
  had passed; the fix was replayed green against the retained run without
  respending. Piping the driver through `tail` also masked its exit code.

#### What worked

- **The standalone review found what fixture-blind code hides** — deletions
  counted as delivered, a widened certified range, the run's own documents
  passing every gate, completion without `verification.gate.pass`. Each fix
  landed with a regression that breaks when the guard is removed; details in
  the reconciled review record named below.
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

Tasks 1-13 landed across `60587fc`…`39d5432` (per-task mapping in `git log`;
Route A refusal-by-name and the Tasks 7-9 tranche merge were operator
decisions; Task 1 prototype evidence in
`2026-09-01-task1-prototype-evidence.md`). Plan `Implemented`; all review
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
