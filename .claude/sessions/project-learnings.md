# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

This file is the system of record. Harness auto memory mirrors some of its
durable one-liners so they load automatically, but the mirror is machine-local
and per-clone-path: nothing is ever removed from here on the grounds that
memory holds it (`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-09-06, end of session)

**Four features are `Implemented`, committed as `ef88f4f` on
`code-review-stage`, and pushed to `origin/code-review-stage` (2026-09-06).**
The branch is three commits ahead of `master`; local `master` = `origin/master`
= `a12f3cf`, the branch point. Merging into `master` is separate and unasked.
Read the head with `git log -1` rather than trusting a commit id written here.

**Pushing needs the personal GitHub account.** The remote is
`ShawnTamez8/governed-delivery`; the repo-local credential helper is
`gh auth git-credential`, which uses whichever `gh` account is *active*, and
the active account is the work one (`TamezS_rush`), which gets a 403. Both are
logged in. Push with `gh auth switch --user ShawnTamez8`, then switch back to
`TamezS_rush` in the same command so other repositories are unaffected.

- `docs/features/spec-section-membership/` — every structured spec section
  states its membership rule in the parser and all three authoring prompts.
  Proven live on three chains.
- `docs/features/plan-coverage-single-artifact/` — a Coverage line names
  exactly one path, the criterion's *representative delivery anchor*. Proven
  live twice: forty single-path or `not_applicable` lines across two chains,
  and each plan panel's one finding asked for a task, not a second artifact.
- `docs/features/unfenced-json-extraction/` — with no fence present
  `extractJsonBody` parses from the first `{` to the end; refusals say what the
  body contained. Proved by replaying the recorded response; hazard 1 shape 8
  has not recurred live, so the fallback is unexercised on a chain.
- `docs/features/code-review-stage/` — Task 10 closed. Two chains reached
  `code_review` and **both blocked on correct `high` findings**; three reviewer
  responses are committed as `test/fixtures/recorded/code-review-web-calculator-*.json`
  and replayed by three tests in `test/code-review-stage.test.ts`, break-tested
  against the gate's `>=` and the location validator's suffix check. Outcome 4,
  legitimate half. Unexercised live: the `upstream:plan:` route and its
  proposal, the pass path over below-threshold findings, delivery after
  `code_review`.

**Five paid chains on the web-calculator PRD since `code_review` landed, none
complete:**

| Run | Stopped at | Cost | Cause |
| --- | --- | --- | --- |
| 2026-09-05 | `spec_review`, stage 2 | $0.41049 | prose note inside `## Acceptance criteria` — hazard 3; fixed (spec-section-membership) |
| 2026-09-05 | `plan_review`, stage 5 | $1.25141 | two artifacts on one Coverage line — hazard 3; fixed (plan-coverage-single-artifact) |
| 2026-09-06 | `spec`, stage 1 | $0.08103 | prose before an unfenced JSON object — hazard 1 shape 8; fixed (unfenced-json-extraction) |
| 2026-09-06 | `code_review`, stage 8 | $1.15759 | `src/calculator.js:97` backspace after an operator resets to `0` (AC-010); `src/styles.css:17` `#ff9500` on white ≈ 2.2:1 (AC-019). Both correct. |
| 2026-09-06 | `code_review`, stage 8 | $1.40170 | different implementation: `Enter` keydown calls `equals()` without `preventDefault`, so a focused button also fires (AC-014). Correct. |

The three upstream blocks were three defects, each invisible to the
deterministic suite and each now closed at both boundaries. The two
`code_review` blocks are the gate working: the code was wrong as the reviewer
said. The stage did not cause the upstream blocks — its commit appended one
prompt builder, touched no parser, and its reviewers emit only `code-findings`.
Before it landed the same design's first run also blocked at `spec_review`.

**The open product decision:** what a block at `code_review` should lead to.
Section 12 deliberately built no remediation round, so the only path from a
block is a fresh run, and two fresh runs in a row have ended on correct `high`
findings. Options recorded in `docs/features/code-review-stage/real-run-evidence.md`
and none taken: a remediation round; a `critical` first-delivery threshold; or
accept that this design does not deliver in one shot. A third identical run
varies only the sample (hazard 7) and is not one of the options.

**Open and deferred, all listed once here:**

- The code-review decision above. Merging `code-review-stage` into `master` is
  separate and unasked.
- Multi-artifact coverage (the proposal's remedy 4) — a product decision, not a
  bug. The design review's wrong-anchor disagreement (second code review,
  finding 2) has not arisen on a live panel; unobserved, not disproved.
- Two deliberate membership gaps, neither measured on a run: `## Declared
  artifacts` admits a Markdown-decorated path (fails only at `delivery_check`);
  the plan's `## Tasks` admits any non-empty line (`src/plan-doc.ts:68-84`).
- `AGENTS.md` is an exact copy of `CLAUDE.md` and `.agents/skills/**` of
  `.claude/skills/**`, byte-identical as of this session, with no drift check
  and outside `check:docs`'s tier list. A pointer file would end the
  duplication; it is the operator's design choice.
- `docs/proposals/github-project-projection-and-upstream-spikes.md` — undecided.
- `scripts/doc-check.mjs` has no test. `npm test` intermittently leaks a
  `moved` commit or `base.txt` onto the real repo; cause untraced; run the
  suite in a `robocopy /MIR` mirror including `.git`. Two known flakes, both
  intermittent and neither a regression: `test/harness.test.ts` tree-kill
  timing under load, and `test/verify-command.test.ts` `EPERM` cleanup.
- Delivery-check F3 and F12 deferred with triggers; `VERIFY_RETENTION_MAX_BYTES`
  chosen, not derived; verification containment unbuilt; `.governance`
  location configuration deferred; durable knowledge tiers.

**Verification standing at end of session:** `npm run typecheck` exit 0;
`npm run check:docs` clean (historical-tier path warnings only);
`test/code-review-stage.test.ts` 39/39 before the third replay test was added
and the three replays 3/3 after (the full file not re-run since); extractor and
reconciliation tests 59/59; full suite 784/782/1 skip/1 flake in a mirror
before the extractor fix, not re-run in full after it. Free smoke 13/13.

**Nothing outside the repository is load-bearing.** Retained targets
`C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\{1788668925127,1788674210677,1788742310835,1788745293903}`
may be cleaned with `node .claude/skills/run-buildworks/driver.mjs clean`.

**Next up:** the operator's decision on the code-review block, and whether to
commit. Neither is engineering work.

## Diagnostics quick-reference

Durable one-liners that recur, kept here because the file is the only tier
committed to the repository. Most are mirrored into auto memory.

- **A tolerance applied at one boundary and not its sibling is a defect** —
  seven have occurred here, the last in `validateCodeReviewLocations`.
- **A constrained field's constraint must be stated in the prompt, not only
  enforced in the parser** — the *membership rule of a section* is as much a
  constrained field as the format of a value inside it, and the section a
  schema forces an author to write in is where that author will answer a
  finding. Three paid runs died on this.
- **Hazard 1's enumeration is the contract parsers are held to** — a shape
  missing from it is a shape no reviewer asks about; a suite working all listed
  shapes passed while the unlisted one blocked a paid run.
- **A block at `code_review` is a result, not a driver failure** — the driver
  prints `10/14 steps as expected` because `review` exits 1 and the three
  delivery steps cannot run. Read the finding against the worktree before
  calling it anything.
- **Identify a recorded artifact revision by hash, never by dispatch order.**
- **A zero counter in an audit summary is not evidence of a guard firing.**
- **Break-test `doc-check` against a scratchpad mirror, not the working tree**;
  its tiers are an explicit path list, so `AGENTS.md` and `.agents/**` are
  never scanned. Section 5's deferred list is every backticked `[a-z_]+` token.
- **Query a run's store before `driver.mjs clean`** — clean deletes the record.
  `agent_run.cost` keyed by `stage_id`; the audit table is `audit`; the
  `finding` table is shared across stages, so code-review ids continue from the
  plan review's.
- **Backgrounding through `| tail -N` buffers until exit** — redirect a paid
  chain to a file and poll `state.db`. The chain outlives the 600 s tool
  timeout when backgrounded; do not restart it.
- **Byte-exact approval under PowerShell:** capture with
  `cmd /c "node <cli> approval-request ... > payload.json"`, sign with
  `cmd /c "node scripts/sign-approval.mjs sign --key <key> < payload.json"`.
- **Reverse a break-it mutation by editing it back, never `git checkout --`**,
  and drive mutations from a scratch `.mjs` that hashes before and after.
  Anchor on a unique expression, never on indentation or a trailing newline —
  the tree is CRLF. `spawnSync` with `shell: true` eats `(` and `|` in
  `--test-name-pattern` and exits 255 silently; spawn `node` directly.
- **The Bash tool mangles long heredocs and regex-bearing `node -e`** — use
  Write and a scratch `.mjs`; a bare `python - <<'PY'` with no python hangs.
- **A phrase pinned in `CONSTRAINT_STRINGS` is scanned in the *source*** — a
  prompt that reads correctly fails when the phrase wraps across a
  template-literal line. Three times now.
- **A shared validator reused by a new stage checks only what it was written
  for** — a new caller adds its own check.
- **`Store.exec` refuses every write to the audit table.** Build a missing-gate
  state by never appending the event.
- **A mechanical rename across a documentation tree invents facts** — paths,
  binaries, versions and model IDs do not survive find-and-replace; restore
  from the original after diffing.
- **A review record with no `**Status:**` line and no dispositions is not
  reconciled**, even when its findings are already fixed.
- **Read every review record beside a proposal before planning from it.**

## Session records

### Regressions cleared, extractor fixed, two chains to `code_review` (2026-09-06, uncommitted)

One session, four phases: cleared the tree's regressions and verified the
suite; built `docs/features/unfenced-json-extraction/` (fast-path plan); ran
two authorized paid chains that both reached `code_review` and blocked; closed
`code-review-stage` Task 10 and `plan-coverage-single-artifact` Task 7 on
their evidence. Detail is in each feature's `real-run-evidence.md` and
implementation note; do not re-derive it.

#### Decisions and assumptions

- **The operator authorized three spends this session:** the extractor fix
  ("go ahead and fix it"), then a paid run, then a fresh paid run after the
  first blocked. Each authorization covered one run.
- **The code-review blocks are recorded as the gate succeeding**, not as
  defects, because each finding was read against the worktree and held. No
  rubric, threshold, prompt, or validator was changed to clear them.
- **The extractor fix is remedies 1–3 of the proposal**, remedy 4 (restate the
  prompt) deliberately not taken; prose *after* an unfenced object is not
  built because nobody has measured it.
- **The `a2db2a0` list-marker fix could not have covered the extractor
  defect:** `normalizeNodeText` strips a bullet from a normative node's text
  during reconciliation comparison, a different layer from `extractJsonBody`.
- **`code-review-stage` is current with master** — branched at `a12f3cf`,
  which is local `master` and `origin/master`.

#### What failed

- **Run 3 blocked at stage 1** on prose before an unfenced object; fixed.
- **Runs 4 and 5 blocked at `code_review`** on correct `high` findings; not a
  defect. No chain has completed since the stage landed.
- **A fabricated example nearly entered an evidence record:** a sentence
  claimed AC-016 spanned two files without the criterion having been read.
  Caught and corrected before doc-check; the rule is the repository's own —
  expected values come from outside your head.
- **Break-test scaffolding failed twice before it ran:** anchors on indentation
  and trailing newlines miss in a CRLF tree, and `shell: true` swallowed the
  test-name pattern. Both now in the quick-reference.

#### What worked

- **The disposable mirror** (`robocopy /MIR` including `.git`) ran the full
  suite with `HEAD` unmoved and no leak; the one failure was a load flake that
  passed 3/3 in isolation.
- **Recorded evidence was copied the moment it became load-bearing** — three
  reviewer responses extracted by script with `provenance.stageContext` read
  from the run's own `result.json`, never retyped, and replayed to the recorded
  verdict.
- **The plan-coverage redirect held on two live panels:** each raised a task
  finding at the boundary where the earlier panel demanded a second artifact.
- **Dispositions were verified against the tree before being written** — the
  separator heuristic's absence and the anchor rule's presence were confirmed
  in code and tests, not taken from the session file.

#### Verification

- `npm run typecheck` — exit 0, repeated after every change.
- `npm run check:docs` — clean after every documentation edit.
- `npm test` in a disposable mirror — 784/782/1 skip/1 flake (before the
  extractor fix).
- `node --test test/parse-output.test.ts test/reconciliation.test.ts` — 59/59;
  fallback removed → exactly the four new tests fail, byte-identical restore.
- `node --test test/code-review-stage.test.ts` — 39/39 before the third replay
  was added; the three replays 3/3; gate `>=`→`>` and location negation each
  fail exactly the two correctness replays, byte-identical restore.
- `node .claude/skills/run-buildworks/driver.mjs smoke` — 13/13;
  `paid --yes` twice — 13 dispatches each, $1.15759 and $1.40170, both
  `code_review=blocked`.

#### Next time

- **Verify a "was it this stage" question by tracing the commit's files
  against the failing path**, not by stage order alone — here the answer was
  clean on both.
- **When a paid run is authorized, say what it can settle before spending**,
  and record the outcome under its own name even when it is a block.
- **Read the criterion before writing an example about it.**

#### Next up

- The operator's decision on what a `code_review` block leads to; the commit.

### Two membership fixes and an agent-portability mirror (2026-09-05/06, uncommitted)

`spec-section-membership` (eight tasks) and `plan-coverage-single-artifact`
(seven tasks) executed on `code-review-stage` with two independent reviews each.
The plan-coverage change added meaning the plan never specified — the path is
the representative delivery anchor — and its separator heuristic was removed
rather than refined after design review rejected inferring a list from
punctuation. Two paid runs blocked (stage 5, $1.25141; stage 1, $0.08103); the
membership fix was proven against a live author on the second. The governing
proposal's design review was not read until after the run. `AGENTS.md` and
`.agents/skills/**` were produced by find-and-replace and asserted paths, a
binary, and model IDs that do not exist; restored byte-identical from their
originals. The independent reviews caught two prompts withdrawing the legal
`not_applicable` form by omission and two `ARCHITECTURE.md` sentences claiming
the parser stricter than it is.

### The code_review stage implemented (2026-09-05, `6fb5412`, `4d71ad1`)

Tasks 1-9 of `docs/features/code-review-stage/plan.md` shipped and passed one
independent review. Placement `implementation -> verification -> code_review ->
delivery_check`; a fixed panel of every `code-findings` reviewer; the gate blocks
at or above the frozen `codeReviewBlockingSeverity` in the frozen order; every
upstream finding blocks at any severity and writes a `blocking_dependency`
proposal; a block is terminal with no waiver (ARCHITECTURE section 12). The
step-9 stop is lifted for `code_review` only. Delivery reads the record from
`last.output_ref` and refuses when it disagrees with verification. Nineteen
scripted mutations proved the guards. Planning it, the self-review missed four
contract gaps the operator's standalone review caught — each a *reuse described
as stricter than the reused code is*; verify a reviewer's claims against source
before dispositioning. Its first paid run blocked upstream at `spec_review`.

### Hazard 17, the list-marker remedy, and the driver design swap (2026-09-04, `a2db2a0`)

Both list-marker remedies chosen: `normalizeNodeText` on both sides *and* a
`nodeForm` argument in the prompt — "the exact text of X" is not stated until
the prompt says what X's text is. The clamp design was replaced by the web
calculator because a design too small to attract a finding exercises nothing;
run 3 completed a chain with a live replacement claimed (`unclaimedRemoved=0`,
$1.34097). A rationale that cannot be broken is not a rationale.

### Earlier history (2026-08-29 to 2026-09-04)

- **Stable criterion IDs** (`9a12cba`): spec-minted canonical IDs and the exact
  bidirectional Coverage relation, proved by two paid chains.
- **Coverage-gate investigation** (2026-09-03): the answer already lived in
  `docs/proposals/spec-kit-harness-review.md` and was not found — a decision
  that lives only in the narrative tier dies at the next compaction.
- **Step 8, delivery check** (`d033595`): a billed standalone review beat an
  in-session subagent (hazard 14); a break mutation must change the outcome
  class the test pins; the recorded patch base is the starting commit's child.
- **Step 5b** (`60587fc`…`39d5432`): only the operator rules on a wrong task
  boundary; a reconciliation stamp is a claim, not evidence.
- **Steps 1-7** (`83d88c0`, `32a714e`): `bw new-run` could never create a run
  in a repository that had not gitignored `.governance/` (hazard 11);
  `resolveExisting` resolved dangling links lexically — refuse what cannot be
  verified; the plan stage mirrors the spec stage without a shared abstraction
  (hard rule 4).
