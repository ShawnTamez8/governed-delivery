# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-09, PowerShell chain completed with live remediation)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working branch:** `code-review-stage`. The feature implementation baseline is
`55b12b8` (`feat:bounded-code-review-remediation`). The operator authorized
committing this session's skill-routing docs, learning updates, two dated session
records, and paid-run fixture on this branch. No push, merge, or cleanup was
requested. Global skill edits remain outside this repository, installed locally
and backed up; recovery paths and the exact changed files are in
`2026-09-08-copilot-skills-audit.md`.

**Paid PowerShell result:** The operator-authorized fresh chain completed all
stages in 16 dispatches for $2.40174. It ran from
`2026-09-09T05:08:01.322Z` to `2026-09-09T05:28:41.759Z` under
`C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\20260909-powershell-000531\target`.
The first code-review panel found one high and one medium calculator defect;
one guarded remediation and the frozen verification commands passed, then both
reviewers returned a clean second panel. Delivery and audit validation passed.
The observed ancestry was PowerShell -> Node driver -> Node CLI -> native Claude,
without a command-shell wrapper around Claude. No paid process remains. Read
`2026-09-09-paid-powershell-chain.md` beside this record for transcript, source
hashes, durable fixture, authorization, and outcome limits. No further paid
attempt or cleanup is authorized.

**Tooling continuity:** Copilot keeps this file as the canonical learning record.
The canonical project skills remain under `.claude/skills/`; their `.agents`
entries forward there. The six frequently used global workflows have one
implementation under the user's `.copilot/skills/`, with Windows junctions from
their shared `.agents` locations. Skills invoke doc-check for document rules;
neither this record nor doc-check is an automatic workflow hook. The skill audit
itself authorized no spend or cleanup. Detailed audit: `2026-09-08-copilot-skills-audit.md`
beside this record.

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

**Open/deferred:** The September 9 capture now covers the live remediation,
post-patch frozen commands, and panel 2 that the clean September 7 chain did
not exercise. The frozen commands still check only Node/npm versions; no
manual browser check was made for the September 9 output. `--json-schema`
remains separate. Future QA should compose the concrete patch/verification
modules without changing this loop.

**Next up:** the PowerShell reproduction is complete; the operator can decide
the next scoped change. Skill reload, push/merge, and retained-target cleanup
remain separate operator actions.

## Diagnostics quick-reference

Durable project facts belong here, regardless of whether a host also caches them.

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
  reports failed downstream expectations when `review` blocks. Read the finding
  against the worktree rather than diagnosing from a driver step-count summary.
- **Identify a recorded artifact revision by hash, never by dispatch order.**
- **A zero counter in an audit summary is not evidence of a guard firing.**
- **Break-test `doc-check` against a scratchpad mirror, not the working tree**.
  `checkPaths()` recursively scans repository Markdown, including `AGENTS.md`
  and `.agents`; explicit tier lists classify files, not select them. The rooted
  path regex recognizes fewer prefixes than the scanner visits. Section 5's
  deferred list is every backticked `[a-z_]+` token.
- **Query a run's store before `driver.mjs clean`** — clean deletes the record.
  `agent_run.cost` keyed by `stage_id`; the audit table is `audit`; the
  `finding` table is shared across stages, so code-review ids continue from the
  plan review's.
- **Backgrounding through `| tail -N` buffers until exit** — redirect a paid
  chain to a file and poll `state.db`. The chain outlives the 600 s tool
  timeout when backgrounded; do not restart it.
- **The driver signs exact bytes without a shell:** it captures the approval
  payload as a Buffer and sends it to the signer on stdin. Historical manual
  PowerShell workaround (not the Claude harness launch): capture with
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

### PowerShell paid chain exercises remediation and completes (2026-09-09)

#### Decisions and assumptions

- One paid chain was authorized before any further skill/driver changes.
  The successful result authorizes neither another run nor a new wrapper.

#### What worked

- One separately authorized chain used the unchanged driver, design, and
  native Claude harness. PowerShell 7.6.5 launched Node v26.4.0; the observed
  model process was native Claude Code 2.1.263 with no intervening cmd wrapper.
- Both first-panel findings went to one implementer dispatch; its single-file
  patch and version-command verification passed. Both reviewers returned a
  clean second panel, delivery passed, and the audit chain was valid.
- Cost: $2.40174 over 16 dispatches. Target:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\20260909-powershell-000531\target`.
  No process remains; cleanup is not authorized.
- Full provenance, five unchanged provider result bodies, stage and audit rows,
  and post-patch logs are in
  `test/fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json`.
  The adjacent `2026-09-09-paid-powershell-chain.md` records the experiment and
  its limits: no browser validation and no causal cmd-versus-PowerShell comparison.

#### What failed

- The evidence export initially rejected SQLite null-prototype rows after a
  lossless JSON round trip. Comparing serialized values fixed only that assertion;
  the existing capture was verified without another paid dispatch or file rewrite.

#### Verification and continuation

- The paid driver returned exit 0 and `15/15 steps as expected`; free smoke
  returned 13/13. `node scripts/doc-check.mjs --json` and `git diff --check`
  passed after capture; source hashes matched before and after the chain.
- The paid shell is completed and the auxiliary skill-audit agent is idle.
  No active paid work remains. The free-smoke target is also retained at
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\20260909-powershell-000531-smoke\target`.
- Next up: resume only a newly requested scope; do not repeat the paid run to
  rediscover the result. Existing Copilot sessions may need `/skills reload`.

### Copilot skill portability aligned (2026-09-08)

- The operator selected the existing `.claude` project skills and this learning
  record as canonical for Copilot too. Global priority copies now share one
  implementation through local Windows junctions; project `.agents` entries
  forward to `.claude`. Markdown records are context, not automatic skill hooks.
- All 17 discovered personal skills have valid name/description frontmatter.
  Two directory-name mismatches and oversized entry files were corrected;
  unavailable tool calls, stale harness paths, and task-document defaults were
  removed. Detailed guidance and global rollback copies were retained.
- The source disproved an older quick-reference claim: doc-check recursively
  scans Markdown paths, including AGENTS and `.agents`; its explicit lists
  classify tiers rather than restrict discovery. The quick-reference is corrected.
- Audit, local recovery paths, and limitations are recorded in
  `2026-09-08-copilot-skills-audit.md` beside this file. No application runtime,
  paid-run state, retained target, or global Codex/Claude skill installation changed.

### Paid evidence: implementation block, then clean completion (2026-09-07)

- Two chains were separately authorized, each with a stated 16-dispatch bound:
  11 dispatches/$1.00548 blocked, then 13/$1.39473 completed.
- `implementation.content.invalid` came from `\U0001f319` at positions 1911
  and 9505 in provider JSON. A byte-exact fixture reproduces it; changing only
  those tokens makes all five files validate. Neither shell manufactured them.
- The fresh chain's first panel was clean; four artifacts delivered at
  `b0b1104dc0b045dbc3d8c116ba44e9ed894200e4`, audit passed, and the operator
  manually checked the calculator. No detailed manual matrix was recorded.
- Five reviewer fixtures passed extraction/contract replay; focused replay was
  9/9, with typecheck/docs/diff clean. The earlier full gate was 821/822 with one
  Windows symlink skip. This run did not need remediation.
- Known retained targets, with no cleanup authorized:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788790553825\target` (blocked)
  and `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788794835268\target` (completed).

### Bounded code-review remediation implemented and reconciled (2026-09-07)

- The contract is 2–5 specialized reviewers, 1–5 panels, remediation of every
  actionable intermediate finding, and a separately configurable final-panel
  severity threshold. It has no human gate, spike, waiver, proposal, upstream
  classification, or reconciliation schema.
- Independent review closed three evidence defects in delivery binding,
  verification labelling, and typed patch failures. Keep round count, panel
  size, and threshold independent so policy changes remain profile edits.

### Extractor fixed; two chains correctly block at code_review (2026-09-06)

- Cleared regressions, built `docs/features/unfenced-json-extraction/`, and
  closed code-review-stage Task 10 and plan-coverage-single-artifact Task 7 on
  retained evidence. Each feature's implementation note and real-run-evidence
  record hold the detail. The extractor fix and both attempts were separately authorized.
- Run 3 exposed prose before unfenced JSON; remedies 1-3 fixed extraction.
  Restating the prompt (remedy 4) was deliberately not taken; prose after an
  unfenced object remained unbuilt for lack of measured need. The `a2db2a0`
  list-marker normalization acts at a different layer and could not fix extraction.
- Runs 4 and 5 each used 13 dispatches ($1.15759 and $1.40170) and correctly
  blocked on high code findings. No gate policy was weakened to clear them.
  Plan coverage redirected two live panels to task findings rather than asking
  for a second artifact. Dispositions were checked against code, not session prose.
- Three reviewer responses were extracted with stage context derived from run
  records. An invented AC-016 example was caught before doc-check: read the
  criterion before illustrating it. Trace a blamed stage's changed files against
  the failing path, not just stage order. CRLF/shell break-test traps are above.
- A disposable full-suite mirror kept HEAD unchanged: 784 tests, 782 passed,
  one skip and one load flake (3/3 isolated). Parse/reconciliation tests passed
  59/59; removing the fallback failed exactly four new assertions and restored
  byte-identically. Code-review-stage tests passed 39/39 before the third replay;
  the three replays passed, and threshold/location mutations broke both
  correctness replays. Smoke was 13/13; typecheck and doc-check were clean.
- Historical branch baseline: code-review-stage branched at `a12f3cf`, then
  local master and origin/master. This is not a claim about their current tips.

### Two membership fixes and an agent-portability mirror (2026-09-05/06)

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

Tasks 1-9 of `docs/features/code-review-stage/plan.md` shipped with an independent
review and 19 guard mutations. Only code_review lifted the step-9 stop.
Delivery bound the review record to verification. The initial terminal-block
and upstream-proposal policy was later replaced by the bounded code-only loop;
do not restore that obsolete policy from old review records. A standalone
design review caught four reused contracts described as stricter than their
code: verify those claims before dispositioning. The first paid attempt blocked
at spec_review.

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
