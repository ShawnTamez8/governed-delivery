# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

This file is the system of record. Harness auto memory mirrors some of its
durable one-liners so they load automatically, but the mirror is machine-local
and per-clone-path: nothing is ever removed from here on the grounds that
memory holds it (`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-09-07, first full chain completed)

**`docs/features/code-review-remediation/plan.md` is `Implemented` and its
2026-09-07 code review is `reconciled` on the existing `code-review-stage`
branch.** Tasks 1-10 and all three review remediations are committed at the
current `HEAD`. After the first paid attempt blocked at implementation, one
separately authorized fresh chain completed all stages in 13 dispatches for
$1.39473. The operator then manually verified the delivered calculator output;
the run's frozen commands themselves checked only Node and npm versions.
Push, merge, and retained-target cleanup remain unasked.

**Locked behavior:** `code_review` alone gets a bounded loop. Its frozen
profile selects 2–5 explicitly specialized reviewers (default 2) and permits
1–5 total panel executions (default 2). Every non-empty intermediate panel is
sent once to the frozen implementer, its actionable findings are patched
together, the new commit is verified with the frozen verification commands,
and the full panel reviews again. On the last configured panel only findings
at or above the independently frozen blocking threshold block; lower-severity
findings remain recorded and do not block. There is no code-review human gate,
waiver, proposal, spike, upstream classification, or findings-reconciliation
schema. `spec_review` and `plan_review` are unchanged.

**Open/deferred:** The fresh first panel was clean: live evidence covers both
specialized prompts and final delivery, not remediation, post-patch
verification, or panel 2. Two reviewer fixtures preserve that limit.
`--json-schema` remains separate. Future QA should compose the concrete
patch/verification modules without changing this loop.

**Next up:** the operator decides whether to push or merge the feature and when
to clean the two retained paid targets.

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
- **“Fenced block is not valid JSON” names the candidate source, not the root
  cause** — read the parser detail and retained bytes. A legal fence containing
  Python's `\UXXXXXXXX` escape is still invalid JSON; the outer terminal cannot
  manufacture that ASCII sequence while UTF-8 stdout is captured as bytes.
- **Spawn the installed native `claude.exe` directly on Windows** — no shim was
  deleted; BuildWorks removed a stale `claude.cmd` assumption. PowerShell
  resolves the same binary. Direct spawn avoids a second argv parser and
  `DEP0190`, preserves typed `ENOENT`, and cannot repair malformed JSON.
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

### Paid evidence: implementation block, then clean completion (2026-09-07)

#### Decisions and assumptions

- The operator separately authorized two Claude Code chains, each bounded at 16
  dispatches. The first used 11 and cost $1.00548; after its deterministic
  correction, the fresh chain used 13 and cost $1.39473.

#### What failed

- `implementation.content.invalid`: the fenced body contained `\U0001f319` at
  positions 1911 and 9505. It was malformed inner JSON, not a fence or
  PowerShell failure; no patch or later stage ran. The two prior runs instead
  reached `code_review` and correctly blocked on actionable findings.

#### What worked

- A byte-exact fixture reproduces the refusal; changing only both `\U` tokens
  makes all five files validate. The actual launcher is native `claude.exe`;
  captured bytes are decoded once, so neither shell manufactured the result.
- The fresh implementation returned valid JSON, verification passed, both
  specialized reviewers returned valid empty reports in panel 1, all four
  artifacts delivered at `b0b1104dc0b045dbc3d8c116ba44e9ed894200e4`, and
  the audit chain verified. The operator then manually verified the calculator
  output. No remediation or second panel was needed.

#### Running state

- Blocked target: `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788790553825\target`.
  Completed target: `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788794835268\target`.
  No process remains; do not use broad `driver.mjs clean` yet.

#### Verification

- The new reviewer result bodies match the retained raw bytes exactly and all
  five live code-review fixtures pass extraction and contract replay. Focused
  replay is 9/9; typecheck, docs, and diff check are clean. Earlier local gates
  remain 821/822 with one Windows symlink skip.
- Operator manual check — the delivered calculator output was verified after
  completion; no detailed manual test matrix was recorded.

#### Deferred and open

- Open: live remediation, post-patch verification, and panel 2 remain
  unexercised because the successful first panel reported nothing.
- Deferred: `--json-schema` needs a separate recorded contract investigation.

#### Next up

- Push/merge and cleanup are the only immediate operator decisions; do not buy
  runs merely to force a remediation finding.

### Bounded code-review remediation implemented and reconciled (2026-09-07)

- The contract is 2–5 specialized reviewers, 1–5 panels, remediation of every
  actionable intermediate finding, and a separately configurable final-panel
  severity threshold. It has no human gate, spike, waiver, proposal, upstream
  classification, or reconciliation schema.
- Independent review closed three evidence defects in delivery binding,
  verification labelling, and typed patch failures. Keep round count, panel
  size, and threshold independent so policy changes remain profile edits.

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
