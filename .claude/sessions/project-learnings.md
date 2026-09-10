# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-10, 10:45 compaction; CLI implemented and reviewed)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working branch:** `code-review-stage`. The operator authorizes committing the
reviewed CLI changes and related planning, review and session records together.
This commit builds on `a8a71d1`; use `git log -1` for the resulting identifier.
Earlier input work is included, not discarded. No push, paid run, real operator
signing, merge or retained-target cleanup is authorized. Remote state is not
rechecked.

**Authorization and input:** Explicit `implement-plan` authorization supersedes
the planning-only boundary and completes all nine tasks in
`docs\features\cli-operator\plan.md`, now `Implemented`, without paid acceptance.
`docs\features\cli-operator\2026-09-09-cli-operator-review.md` is `reconciled`:
19 accepted, 2 rejected, 1 deferred, 0 open. The execution evidence is
`2026-09-10-cli-operator-implementation.txt` beside this file; planning records
are history, not the resume point.

**Completed:** Canonical targeting, read-only inspection/readiness, consented
intact-boundary execution, external approval transports and the operator guide.
Both high-effort code reviews report 0 confirmed and 0 plausible findings:
`docs\features\cli-operator\2026-09-10-code-review.md` is `reconciled`;
the separately requested `docs\features\cli-operator\2026-09-10-code-review-2.md`
stays `open` pending disposition. An open report with zero findings is not
an unfinished investigation. Separate host contexts do not supply governed
standalone attestations or independence guarantees.

**Locked CLI decisions:** One consent covers the whole preview through approval
or terminalization; intermediate stop control remains explicitly deferred.
Status returns complete arrays without pagination, truncation or raw provider
bodies. Early frozen-age refusal applies to guided entry, not low-level
spec/plan; accepted approval expiry does not revoke the grant.

**Locked scope:** Local CLI only; repository Markdown can feed the existing
design path through checkout. Inbound issues/Projects, external spec approval,
task sync and outbound publication need separate contracts. Execution,
signing and publication consent remain separate, as do delivery/publication
and continuation/export. Prior paid costs, limits and retained targets remain
below; their existence authorizes neither spend nor cleanup.

**Locked behavior:** Committed/Implemented `code_review` alone gets bounded
remediation: 2-5 seats, 1-5 panels, defaults 2 each, final-panel severity gating.
No human/upstream/reconciliation mechanism or document-review behavior change
inherits that authorization.

**Deferred decisions:** The reconciled analysis owns inbound object/target and
revision/provenance selection, executable-task semantics, Spike ingestion/
cross-run identity, and outbound ownership/App/field/visibility/publication.
Stop control needs its own range decision. Packaging, general mid-stage repair,
hard dollar caps, new stages, `--json-schema` and stronger artifact verification
remain excluded; QA should compose existing patch/verification modules.
Hot-journal behavior is measured, not an open experiment.

**Running state:** Rechecked: no active shell sessions; all six child agents
are idle and have released their work. Named experiment files are removed.
The shared test-workspace parent was last observed empty and remains unmanaged;
it is not a running process. Retained operator targets remain untouched.

**Next up:** No code correction is proposed. Keep the latest review open until
a separate operator disposition; this commit authorizes no further code work,
paid acceptance or push.

## Diagnostics quick-reference

Durable project facts belong here, regardless of whether a host also caches them.

- **A tolerance applied at one boundary and not its sibling is a defect** —
  seven have occurred here, the last in `validateCodeReviewLocations`.
- **State field and section-membership constraints in the prompt** — an author
  answers a finding in the section the schema requires; parser-only rules
  killed three paid runs.
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
- **Break-test `doc-check` in a mirror**. `checkPaths()` recursively scans all
  repository Markdown, including `AGENTS.md` and `.agents`; tier lists classify,
  not select. Rooted path recognition is narrower than discovery. Section 5's
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
- **Earlier Bash-tool runs mangled long heredocs and regex-bearing `node -e`**;
  a scratch `.mjs` avoided this. A bare `python - <<'PY'` without Python hung.
- **A phrase pinned in `CONSTRAINT_STRINGS` is scanned in the *source*** — a
  prompt that reads correctly fails when the phrase wraps across a
  template-literal line. Three times now.
- **Shared validators prove only their checked subset** — findings, command
  contents and optional metadata remain unknown until projected. New callers
  add their own checks; malformed display fields get limitations, not stronger
  downstream core gates.
- **`Store.exec` refuses every write to the audit table.** Build a missing-gate
  state by never appending the event.
- **A mechanical rename across a documentation tree invents facts** — paths,
  binaries, versions and model IDs do not survive find-and-replace; restore
  from the original after diffing.
- **A review record with no `**Status:**` line and no dispositions is not
  reconciled**, even when its findings are already fixed.
- **Read every review record beside a proposal before planning from it.**
- **`git --no-optional-locks` is insufficient for `git diff` inspection** -
  measured index refresh still occurred; inspection also supplies the
  process-local `-c diff.autoRefreshIndex=false`, without changing core execution.
- **Read-only SQLite may need writer-side crash recovery** - the spilled hot
  journal produced SQLite 776 without changing files; explicit fixture `migrate`
  recovered committed rows without replay. Readers never do that recovery.

## Session records

### PowerShell paid chain exercises remediation and completes (2026-09-09)

- One separately authorized chain uses the unchanged driver/design/native
  harness: PowerShell 7.6.5 -> Node v26.4.0 -> Claude Code 2.1.263, without an
  intervening cmd wrapper. First-panel high/medium findings receive one patch;
  frozen version commands and the clean second panel precede completed delivery.
- The result is $2.40174 over 16 dispatches, driver `15/15`, smoke `13/13`, and
  a valid audit chain. The paid target is
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\20260909-powershell-000531\target`.
  The smoke target is
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\20260909-powershell-000531-smoke\target`.
- Full provenance, five unchanged provider bodies, stage/audit rows, and
  post-patch logs reside in
  `test/fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json`.
  `2026-09-09-paid-powershell-chain.md` preserves source hashes, command evidence,
  limits, and the resolved null-prototype export assertion: no browser check,
  causal shell comparison, paid rerun, or evidence rewrite.

### Copilot skill portability aligned (2026-09-08)

- The operator selected the existing `.claude` project skills and this learning
  record as canonical for Copilot too. Six priority global workflows share
  `.copilot/skills/` implementations through local Windows junctions from
  `.agents`; project `.agents` entries forward to `.claude`. These records are
  context, not automatic workflow hooks.
- All 17 discovered skills have valid frontmatter after correcting two name
  mismatches, oversized entries, unavailable calls, stale paths and task defaults.
  `2026-09-08-copilot-skills-audit.md` retains detailed guidance, rollback/recovery
  paths and limits; no runtime, paid target or global Codex/Claude skill changed.

### Paid evidence: implementation block, then clean completion (2026-09-07)

- Two chains were separately authorized, each with a stated 16-dispatch bound:
  11 dispatches/$1.00548 blocked, then 13/$1.39473 completed.
- `implementation.content.invalid` came from `\U0001f319` at positions 1911
  and 9505 in provider JSON. A byte-exact fixture reproduces it; changing only
  those tokens makes all five files validate. Neither shell manufactured them.
- The fresh chain's first panel was clean; four artifacts delivered at
  `b0b1104dc0b045dbc3d8c116ba44e9ed894200e4`, audit passed, and the operator
  manually checked the calculator. No detailed manual matrix was recorded.
- Five reviewer fixtures replayed; focused replay 9/9 and types/docs/diff passed.
  Earlier full gate: 821/822, one Windows symlink skip; no remediation needed.
- Known retained targets, with no cleanup authorized:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788790553825\target` (blocked)
  and `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788794835268\target` (completed).

### Bounded code-review remediation implemented and reconciled (2026-09-07)

Independent review closed three evidence defects in delivery binding,
verification labelling, and typed patch failures. The locked contract is in
Current state; round count, panel size, and threshold remain independent.

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
- Three reviewer captures use run-derived stage context. An invented AC-016
  example failed review: read the criterion and trace changed paths, not just
  stage order, before assigning a cause.
- A disposable mirror preserved HEAD: 784 tests, 782 passed, one skip, one load
  flake (3/3 isolated); parse/reconciliation 59/59; code-review-stage 39/39 before
  the third replay. All three replays passed; fallback removal broke four
  assertions, threshold/location mutations broke both correctness replays, and
  restoration was byte-exact. Smoke 13/13; types/docs passed.
- Historical branch baseline: code-review-stage branched at `a12f3cf`, then
  local master and origin/master. This is not a claim about their current tips.

### Two membership fixes and an agent-portability mirror (2026-09-05/06)

`spec-section-membership` (eight tasks) and `plan-coverage-single-artifact`
(seven) executed on `code-review-stage`, two independent reviews each. The
coverage path is a representative delivery anchor; its invented separator
heuristic was removed, not refined. Two paid blocks (stage 5/$1.25141,
stage 1/$0.08103) proved the membership fix live on the second, before the
governing proposal review was read. Find-and-replace invented paths, a binary
and model IDs in `AGENTS.md`/`.agents/skills/**`; originals restored byte-exactly.
Reviews caught two prompts omitting legal `not_applicable` and two architecture
sentences overstating parser strictness.

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

### CLI planning groundwork and GitHub impact reconciled (2026-09-09)

- `2026-09-09-docs-cli-operator-analysis.md` holds the 18 reconciled criteria,
  safe boundaries, transactional exceptions, evidence limits, and distribution
  constraints. The operator selects it, not the outbound proposal, as the
  GitHub review's reconciliation target.
- `docs\proposals\2026-09-09-github-project-projection-and-upstream-spikes-review.md`
  records that override: 5 accepted, 0 rejected, 5 deferred, 0 open. The proposal
  stays unchanged; `2026-09-09-cli-github-impact-analysis.md` remains the earlier
  review-only history, not an open-work list.
- The analysis corrects an age trace: four downstream entries, not low-level
  spec/plan, enforce it. Types/docs and criterion/disposition assertions pass.

### CLI operator plan review reconciled (2026-09-10)

The 22 dispositions preserve full-range consent, complete arrays, raw approval
bytes and bootstrap criteria in the existing analysis. Three critical
corrections require the full suite, shared bounded probe and measured crash
recovery. The planning record retains assertions over 18 criteria, nine tasks,
15 errors and lifecycle shape, including CRLF/unscoped-table corrections.
Document reconciliation grants neither execution nor spending authority.

### CLI operator implementation evidence (2026-09-10)

#### Decisions and assumptions

- Bounded deviations: target-relative evidence consumption, disabled Git diff
  refresh and shared declared-artifact extraction without stronger downstream
  gates; no schema/stage/pin changes. Standard I/O is the only runner test seam.
- Existing stages own gates; one invocation never retries a failed group,
  including rolled-back delivery. Disposable signing proves transport, not real
  authority; version fixtures prove neither product correctness nor containment.

#### What failed and worked

- Restored stderr beside JSON and counted attempts after fallible progress.
  Fixture isolation reloads serialized profiles and sets an absent external key
  override; clearing it reactivates host defaults, and ignored state is not outside.
- Lowercase `# design` is the grounding input; capitalization caused a block.
  Failed dispatches return audited exit reasons, not separately retained stderr.
- Corrected ascending-severity comparisons and retained unattempted-group
  accounting. The stdout mutation reports `2 !== 1` at `operatorEnvelope`;
  Node rejects TypeScript mirrors under node_modules. Restored mirrors are removed.
- The first reviewer completed initially sampled suites before closure and
  withdrew the over-refusal-only guarantee. Exact failures, corrections,
  probes and byte-restoration evidence remain in the implementation record.

#### Verification

- `2026-09-10-cli-operator-implementation.txt` retains every command, ten late
  and earlier parser/probe/lock/router guard proofs. Its unfiltered approval gate
  closes the contributor's external-signing filesystem limitation.
- The actual CLI journey freezes one profile, crosses approval, derives paths
  from schema-valid spec/Git and proves repeat no-op; a calibrated `gh` sentinel
  sees no GitHub operation. Actual README PowerShell preserves rows/files/index;
  a copied target omission fails, restoration passes. CLAUDE/AGENTS match;
  architecture changes stay in sections 15/19.
- `node --test test\cli-operator.test.ts`: 108 pass; `npm test`: 1071 pass,
  zero failures, one OS file-symlink skip. `npm run typecheck`,
  `npm run check:docs` and `git --no-pager diff --check` pass. The initial code
  review requires no fix or production rollback.

### Operator-requested follow-up code review (2026-09-10)

- Fresh `gpt-5.5` review covers the HEAD diff and untracked contents. Nine
  existing index/key-isolation/delivery-retry cases pass; the full suite is
  prior evidence, not a fresh run. Docs/types/diff pass; 63 path warnings remain.
- The coordinator resolves nonempty versus physical line counts and reads both
  large test tails; source/README hashes match. `DEP0190` has no retained traced
  origin, so the report attributes it to neither runtime nor a named fixture.

### Continuity checkpoint (2026-09-10)

**Decisions and assumptions:** Explicit compaction saves context only. The
latest zero-finding review stays open; no lifecycle disposition or execution
authority changes. The sole next action remains in Current state above.
