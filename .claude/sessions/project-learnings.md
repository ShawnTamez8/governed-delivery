# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-26, dashboard-approval and reconciliation-disposition-shapes done; four items awaiting an operator decision — verified at `319c9e4`)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working state (verified 2026-09-26 with `git log`/`git status`):** Branch
`dashboard-ux-redesign`, HEAD `319c9e4`, not pushed. `CLAUDE.md`/`AGENTS.md`
are byte-identical. 16 modified plus 6 untracked paths sit uncommitted,
spanning two independently-complete features and two pure documents:

1. **Dashboard-approval feature** — `docs/features/dashboard-approval/plan.md`
   is `Implemented`; its `## Independent review — 2026-09-26` section is
   `reconciled`. Adds the one dashboard write ARCHITECTURE.md's 2026-09-26
   decision permits — submitting an approval signature through the same
   `approveRun` core and writer lock as `bw approve`, via
   `src/dashboard-approval.ts`. README.md/CLAUDE.md/AGENTS.md/ARCHITECTURE.md
   already document it (confirmed 2026-09-26: README has a full "Approving
   from the dashboard" section; CLAUDE.md's hard-rule-2 paragraph names the
   decision). **Known-deferred, still open:** `test/sign-approval.test.ts:99`
   ("nothing under src/ touches a private key") fails — the guard regex
   `/private[ -]?key/i` matches a code comment on
   `src/dashboard-approval.ts:16` ("never receives a private key"), a false
   positive, not a real leak. Reword the comment or narrow the guard —
   operator's call, not fixed.
2. **Reconciliation-disposition-shapes fix** —
   `docs/features/reconciliation-disposition-shapes/plan.md` is `Implemented`
   but **has no `## Independent review` section** (unlike dashboard-approval's
   plan) — a real process gap, still open. Fixes a bug where
   `validateReconciliation` (`src/reconciliation.ts`) refuses a decision
   missing `changedLocations` (required on every disposition) or `proposal`
   (required for `upstream_follow_up`/`upstream_blocking`) with a hard
   validation error (`spec.reconcile.invalid`) instead of a clean gate block.
   `src/prompts.ts`'s `reconciliationDecisionContract`/`exampleDecisionsFor`
   now state and demonstrate every disposition's required shape.
   `node --test test/reconciliation.test.ts test/prompts.test.ts` → 76/76,
   against two real recorded fixtures
   (`test/fixtures/recorded/spec-reconciliation-note-keeper-missing-*.json`).
   Full write-up: `docs/hazards.md` hazard 3. Not committed.
3. **`docs/proposals/spec-review-severity-nondeterminism.md`** (new, pure
   backlog, no remedy chosen) — see [[reviewer-severity-nondeterminism]].
4. **`docs/features/stage-role-model-overrides/plan.md`** (new,
   `Status: Proposed`, **not implemented** — the operator explicitly wants to
   review this plan before any `implement-plan` run). Lets `bw new-run`
   freeze an independent model for the reviewer role, and — only where a
   distinct role exists (spec/plan's reconciliation dispatch, code_review's
   remediation-implementer dispatch) — a second override, without inventing a
   role code_review doesn't have. 9 tasks, self-reviewed once (2 findings
   fixed inline). Does **not** by itself resolve item 3 — a different model
   is just a different sample.

**Carried forward, unchanged since 2026-09-24:** Target Tap PRD
(`.claude/skills/run-buildworks/target-tap-design.md`) has run against a
provider twice, both blocked; its scratch target's frozen verification
commands are still only `node --version`/`npm --version`. Hard rules,
authorized decisions and the observed $1.39–$3.59 three-reviewer cost range
are recorded in `ARCHITECTURE.md`/`CLAUDE.md` (source of truth) — **no paid
execution against BuildWorks' own target is authorized.** The separate
note-keeper investigation (item 3) ran against paid chains on a different,
external target repository, not BuildWorks' own.

**Verification run this session:** `npm run check:docs` → exit 0, clean (84
pre-existing warnings, all in historical fixture/bootstrap docs unrelated to
this session, none new).

**Running state:** two background dashboard shells started earlier this
session may still be running against scratch targets under this session's
temp scratchpad — irrelevant to a future session (a new session gets a new
scratchpad path). Stop with TaskStop if still needed; otherwise ignore.

**Open/deferred — all four are operator decisions; nothing is pending from
the assistant:**
- Which of the 6 candidate remedies (if any) to pursue for item 3.
- Whether to add/run an Independent-review pass for item 2's plan.
- Review, and separately approve, item 4 for implementation.
- Fix, or decide not to fix, item 1's private-key-guard false positive.
- Whether to commit items 1-2 (feature-complete) and/or run `/code-review
  ultra` on the dashboard-approval work first, as the operator earlier said
  they wanted to.

**Next up:** Nothing pending from the assistant — every thread above waits on
the operator.

## Diagnostics quick-reference

Durable project facts belong here, regardless of whether a host also caches them.

### Prompts, parsing and provider output
- Boundary asymmetry caused seven defects, most recently in `validateCodeReviewLocations`; inspect both sides of every comparison.
- Put field/section constraints in prompts: parser-only rules killed three paid runs. `CONSTRAINT_STRINGS` scans source, so a phrase wrapped across a template-literal line fails.
- "Fenced block is not valid JSON" names the candidate, not the cause; retained `\UXXXXXXXX` bytes came from the provider, not terminal corruption.
- Hazard 1 omitted a shape that blocked a paid run despite all enumerated cases passing; fixtures do not prove universal parser coverage.
- Anchor a closing code fence to the start of its own line (hazard 1 item 9, cost $2.83862): a bare triple backtick inside a JSON string otherwise truncates the payload.
- Every task in `## Tasks` and every line in `## Coverage` is a normative node; an unclaimed rewording of a coverage line fails the multiset comparison closed.
- `src/harness.ts` prefers a per-dispatch `invocation.idleTimeoutSeconds` over the sandbox default; check the call site before assuming the default governs.
- Native `claude.exe` needs no shell wrapper: direct launch avoids DEP0190 and preserves typed ENOENT.

### Code review stage
- A code_review block is a result, not a driver fault; a pass can retain findings. Read the final panel and frozen verification commands.
- A final configured panel can block after a successful remediation; it gets no further patch or delivery, and a completed spend never authorizes a retry.
- Concurrent panels must consume `Promise.allSettled` results in input (frozen panel) order; only tests with controlled out-of-order completions, two or more failed seats and a non-zero fixture cost prove that ordering and aggregation.
- Shared validators prove subsets; callers project findings/commands/metadata. Malformed display fields get limitations, not stronger gates.
- `insertFindingDecision` requires grounding exactly for `rejected_with_rationale` and normative changes exactly for `addressed`.

### Evidence, runs and storage
- Identify revisions by hash, not dispatch order; zero audit counters do not prove guards fired.
- Query before `driver.mjs clean`: it deletes store/raw evidence. Cost joins through `stage_id`; the table is `audit`; finding IDs span document and code review.
- `Store.exec` forbids audit writes; model a missing gate by not appending its event.
- Windows `TEMP=...\AppData\Local\Temp\1` with `DeleteTempDirsOnExit=1` deletes default driver targets at logoff; four stores were lost by 2026-09-10. Use a fresh child of `C:\Users\tamezs\buildWorks_test_repos` and extract load-bearing responses into `test/fixtures/recorded/` immediately.
- `| tail -N` buffered paid output; redirect logs and inspect state. A timed-out wait can leave the chain running; never relaunch blindly.
- The driver signs Buffer bytes over stdin without a shell; PowerShell `cmd /c` redirection is approval transport, not a launch fix.
- `agent_runs` persists model, harness and duration fields. Since 2026-09-24 (`dashboard-ux-redesign`), `RunSnapshot.cost.byAgent` also projects roles, requested and effective models, unreported-model rows, and summed `duration_ms`. Harness is still unprojected. `Unavailable` now means the row reported no effective model.
- A hot journal made read-only SQLite return 776 without writes; readers never repair. Read-only Git needs `--no-optional-locks` and `-c diff.autoRefreshIndex=false`.
- `envPassthrough` freezes names, not values or files. A doctor pass is not auth proof.

### Guided mode and intake
- Run identity has no uniqueness constraint; re-query the exact tuple while holding the repository writer lock, or concurrent guided processes create duplicate runs.
- An expired approval handoff rotates by moving the whole directory atomically, validating it, then creating fresh bytes; stale signatures are inert evidence.
- Compare committed blobs with LF source constants and the worktree with HEAD through Git, or a clean `core.autocrlf=true` clone reads as modified.
- Guided routing treats the first argument as a target only when absolute, `.`, `..`, or starting `.\`, `..\`, `./`, `../`; a bare name is a command and exits 2. `--repo` is refused.
- `.governance/` ignore coverage is a doctor check only; intake requires a readable HEAD, a clean tree excluding governance state, a committed `governed.yaml`, and (guided) `BW_APPROVAL_PUBLIC_KEY`.
- Guided mode refuses redirected stdin, so automated proof composes installed-shim execution with an injected-prompt journey — a stated limitation, not end-to-end evidence.

### Dashboard
- Snapshot caches key by repository and run, and every overlapping refresh path needs its own generation guard.
- Repository IDs are base64url SHA-256 of the normalized worktree path; the Governance stage is a synthesized gate projection with `stageId: null`.
- Scoping views filters the array fed to `portfolioProjection`, `commandCenterKpis`, `needsAttentionQueue` and `governedDeliveriesRows` by `selectedRepositoryId || repositoryFilter`.
- `--repositories-file` is read once at startup; changing targets means restarting, which mints a new port and bearer token.
- Popover listeners need `{ once: true }` or explicit cleanup. Presentation may narrow, never alter; apply formatting honesty to every value class at once.
- An executing stage is usually `pending`, not `in_progress`: spec, plan and implementation never leave the store default while they run; only verification and code review set `in_progress`. The stages' own failure paths treat both as unfinished (`stageIsOpen` in `dashboard-model.js`). Until 2026-09-26 the dashboard matched only `in_progress`, so LIVE never showed during those three stages. That flaw sat in `liveness()` from the start, and the IN PROGRESS badge copied it.
- Rule from that rework: take a status predicate's expected values from the writers' `setStageStatus`/insert sites or a live record, never from the name of the state. The unit tests passed because their fixtures called `setStageStatus("in_progress")`, and only the live run exposed the gap. Check a live-state feature against a real running snapshot before calling it done.

### Windows, Node and TypeScript
- `evidence.end(cb)` fires on `'finish'` before the descriptor closes; wait for `'close'` before deleting the directory.
- Node v26.4.0 `rmSync` does **not** retry EPERM despite `maxRetries`/`retryDelay` (probed 2026-09-24: fails in 0–1 ms against a held file), so the 2026-09-16 test-side retry was inert. Probe a tolerance option on the installed runtime before crediting it.
- `test/cli-operator.test.ts:1394` (Windows PowerShell 5.1 approval transport) fails with "signature does not verify" whenever the suite is launched from the assistant's tool shell, but passes in the operator's terminal (2026-09-24; cause unknown, not `PSModulePath`). Have the operator rerun it before diagnosing.
- `child.kill("SIGTERM")` can terminate without running Node's handler on Windows; promise graceful cleanup only for delivered signals.
- Node `statSync` adds extended Windows path semantics that native executable lookup does not.
- Child `tsconfig` files inherit base `include` and `exclude` even with `files`, and default `lib` includes DOM; inspect resolved files when separating Node and browser programs.

### Documentation and working practice
- Break-test doc-check in a mirror. Section 5's deferred list is every backticked `[a-z_]+` token; decisions go in sections 12 and 23.
- `doc-check` recognizes only backticked forward-slash paths under `src`, `test`, `scripts`, `docs` or `.claude`; `docs/runbooks/**` is reference tier, so write generated example paths there in Windows backslash form.
- Edit `CLAUDE.md`, copy to `AGENTS.md`, then compare hashes.
- Mechanical doc renames invented paths/binaries/model IDs; restore byte-exact originals. Missing status/disposition means unreconciled.
- Restore only the break mutation, hash before/after, anchor a unique expression. Shell-true `--test-name-pattern` lost `(`/`|` and exited 255.
- Bash heredocs and regex `node -e` were mangled; use a scratch `.mjs`. Read every adjacent review before planning from a proposal.
- Check `git status` and `git log` against the recorded state before trusting a resume point; an unexplained file count means an undocumented layer (happened 2026-09-15 and 2026-09-24).

## Session records

### Dashboard-approval shipped; reconciler bug fixed; note-keeper severity-variance investigated (2026-09-26)

#### Decisions and assumptions
- Operator rejected the initial hypothesis that the spec-writer needed more
  thoroughness or a higher reasoning-effort setting: no such config knob
  exists anywhere in this codebase (checked by grep), and direct spec-content
  comparison across 6 note-keeper runs found only one narrow author-stage
  content gap, not a systemic authoring weakness.
- Operator: for `stage-role-model-overrides`, code_review gets its two
  existing roles (reviewer, remediation-implementer) parameterized — no
  invented third "reconciler" role for code_review, since none exists there.
  Operator also wants to review that plan before any `implement-plan` run.

#### What failed
- A `note-keeper` test-target run (run 6) blocked at `spec_review`; initially
  suspected as a repeat of an earlier session-limit (429) failure, but its
  audit trail was a clean `spec.gate.block` with 5/5 agent rows reported and
  0 failed attempts — a real policy block, not an error.
- Root cause isolated to reviewer-stage sampling variance, not a bug: across
  6 same-model (`claude-sonnet-5`), same-PRD note-keeper runs, the same
  disclosed security gap (export-archive access control, attachment
  content-type/disposition, password-reset token security) got different
  severity/blocking verdicts with zero model, prompt, or config difference
  found (verified field-by-field against raw dispatch envelopes and a
  `prompts.ts` diff). Full write-up:
  `docs/proposals/spec-review-severity-nondeterminism.md`. This directly
  contradicts hazard 7's stated premise for review-panel dispatches
  specifically (their raw envelopes carry `thinking_tokens` in the
  thousands — not zero-temperature calls).
- Separately, runs 2 and 3 of the same investigation surfaced a real
  reconciler defect (already fixed earlier in this session, before this
  compaction): `validateReconciliation` refused a decision missing
  `changedLocations` or `proposal` with a hard validation error instead of a
  clean gate block. Fixed via `src/prompts.ts` contract/example changes;
  76/76 regression tests pass; full write-up in `docs/hazards.md` hazard 3.
  Cross-timezone mtime analysis confirmed the fix predates 3 of the 6 runs
  (UTC dispatch timestamps vs. local `ls -la --time-style=full-iso` mtimes
  must be converted to the same zone before comparing, or the ordering looks
  contradictory).

#### What worked
- Comparing raw provider envelopes field-by-field (`canonicalModel`,
  `requestedModel` vs. `effectiveModel`, `contextWindow`, `service_tier`)
  ruled out silent model fallback as a cause in under one read.
- `git stash list` recovered leftover `spec.md` content from 4 prior
  note-keeper runs that a subsequent `new-run` had cleared from the working
  tree, which is what made the author-stage vs. reviewer-stage variance
  split possible.

#### Deferred and open
- Open: which of 6 candidate remedies (if any) to pursue for the
  severity-variance finding — operator decision, no remedy chosen.
- Open: `docs/features/reconciliation-disposition-shapes/plan.md` has no
  `## Independent review` section, unlike dashboard-approval's plan.
- Open: `docs/features/stage-role-model-overrides/plan.md` awaits the
  operator's review before any implementation.
- Deferred: `test/sign-approval.test.ts:99`'s private-key-guard false
  positive against a comment in `src/dashboard-approval.ts:16` — reword vs.
  narrow the guard is the operator's call.

#### Next time
- When a user asks to "write up" a defect, check whether it is already
  fully diagnosed/fixed/documented in the current session before drafting a
  new document — a narrow `git diff | grep` for one category of keyword
  (severity wording) is not evidence the whole file has no relevant change.
- LLM review-panel dispatches are not zero-temperature; do not assume a
  second identical-input dispatch will reproduce a first verdict when
  designing consistency remedies.

#### Next up
- Nothing pending from the assistant. See Current state for the four open
  operator decisions.

### Resume-point audit finds an undocumented layer (2026-09-24)

The previous Current state (2026-09-16) described `834d209`'s work as
uncommitted and knew nothing of `docs/features/resilience-parallel-code-review/`,
planned, implemented and reviewed on 2026-09-17/18; it also still said the
Target Tap PRD had never run against a provider, which two paid runs had
already contradicted. Second occurrence of an undocumented layer (see the
2026-09-15 record); the general lesson is in the Diagnostics quick-reference
above.

### Code-review audit prompt, artifact check, plan-reconcile coverage fix (2026-09-16/17, `2a31e5c`, `834d209`)

Two paid `target-tap` runs blocked for different reasons. The first (10
dispatches, $1.55366) failed `plan_review` round 1 because the author reworded a
`not_applicable` coverage line without claiming it (audit event 34); the fix
put the coverage-node rule and `nodeForm` in the reconcile prompt. The second,
`target-tap-live-2` (16 dispatches, $3.58933), reached `code_review`, remediated
three round-1 defects, then blocked on two new round-2 highs — a test script
naming an undeclared file and a rapid-click race. The fixes told reviewers to
audit the whole diff rather than sample, and made the stage block before
dispatch when a declared artifact is missing from the verified commit. Debug
analysis is retained at
`.claude/sessions/2026-09-16-debug-plan-reconcile-unclaimed-coverage-node.md`.

### Verify-command EPERM cleanup race fixed (2026-09-16, `4848a64`)

The recurring `test/verify-command.test.ts:134` EPERM came from `settle()`
resolving on `'finish'` while the evidence descriptor was still open, racing
`withRoot`'s `rmSync`; `taskkill` teardown added a second race. Fixed by
awaiting `'close'` and adding `rmSync` retries in the test. `npm test` then
passed 1,178 / 0 failed / 5 skipped. Analysis:
`.claude/sessions/2026-09-16-debug-verify-command-cleanup-eperm.md`; review
`docs/features/verification-stage/2026-09-16-code-review.md` (0 findings).

### Dashboard launch and an undocumented second layer (2026-09-15)

The operator asked only to launch the dashboard and add
`C:\Repositories\testing-repos\simple-game-test`; the repositories file lives
outside the repository at
`C:\Users\tamezs\.copilot\session-state\d4c9f2f8-18c6-4755-a0d8-b45098406e5b\files\dashboard-repositories.json`.
The resume point had undercounted the working set (23+10 against 33+11) and named
two expired temp targets, which exposed the undocumented fence-anchoring and
idle-timeout layer later written up and committed in `3235d23`/`a420563`. The
second EPERM occurrence triggered the investigation recorded above.

### Guided project bootstrap implemented (2026-09-13/14, `3235d23`)

`docs/features/guided-project-bootstrap/plan.md` shipped Tasks 1-10:
checkout-linked `buildworks`/`bw`, the `static-web` initializer, shared run
intake, and guided identity, consent and continuation. Eight review findings —
concurrent tuple intake, expired-handoff rotation, the `autocrlf` false
positive, terminal output without reasons, malformed expiry, missing reviewer
attribution, an archive rename race, and a stale signature blocking renewal —
were all fixed with break-tested guards. The fixture journey completed every
stage at USD 0. `npm test` 1,173 passed / 5 skipped; free smoke 13/13.

### Dashboard read-only increment and redesign (2026-09-12/13, `3415032`)

The `127.0.0.1` dashboard uses bearer-protected GET routes over shared
exact-current read services; `docs/features/dashboard/2026-09-12-code-review.md`
records seven resolved defects. The redesign added six tabs, KPIs, an
eight-stage pipeline and drawers through one pure projection module,
`src/dashboard/dashboard-model.js`, keeping the HTTP and `RunSnapshot` contracts
unchanged. Requirements are retained in
`.claude/sessions/2026-09-12-requirements-dashboard-enterprise-redesign.md` and
`.claude/sessions/2026-09-12-requirements-dashboard-density-triage.md`.

### Paid chains, 2026-09-06 to 2026-09-12

| Date | Dispatches | Cost | Outcome |
| --- | --- | --- | --- |
| 2026-09-06 | 13 / 13 | $1.15759 / $1.40170 | Both blocked at `code_review` on correct high findings |
| 2026-09-07 | 11 | $1.00548 | Blocked at `implementation.content.invalid` (provider `\U0001f319` bytes) |
| 2026-09-07 | 13 | $1.39473 | Completed; clean first panel; operator manual calculator check |
| 2026-09-09 | 16 | $2.40174 | Completed after one remediation under PowerShell; fixture `code-review-web-calculator-powershell-remediation-chain.json` |
| 2026-09-11 | 16 | $2.0585392 | Completed; non-blocking medium after remediation; six artifacts at `8cd5a2d` |
| 2026-09-11 | 16 | $2.4481306 | Final high (AC-013 Enter contradiction) blocked at `511f64b` |
| 2026-09-12 | 16 | $1.8073754 | Final high (AC-018 mobile overflow) blocked; `.claude/sessions/2026-09-12-paid-web-calculator-code-review-block.md` |

Only version commands ran as frozen verification in every chain.

### Proposals and assessments (2026-09-08 to 2026-09-11)

- **CLI operator work** (2026-09-09/10): the operator chose
  `2026-09-09-docs-cli-operator-analysis.md`; the plan review's 22 dispositions
  preserved full consent and granted no spend; standard I/O is the runner seam,
  and an invocation never retries failed groups.
- **Doctor** (`4356151`): canonical environment reads preserve Windows key
  casing; native lookup requires native path semantics.
- **cc-switch** (`docs/proposals/cc-switch-review.md`): switching is no adapter
  substitute; MHA-03 and MHA-01 remain.
- **Pi**: additional support, not an approved adapter
  (`2026-09-11-pi-assessment-and-prior-claude-chain.md`).
- **Copilot portability** (2026-09-08): canonical `.claude` skills, `.agents`
  entries forward; `2026-09-08-copilot-skills-audit.md`.

### Code review stage and membership fixes (2026-09-04 to 2026-09-07)

`docs/features/code-review-stage/plan.md` shipped Tasks 1-9 (`6fb5412`,
`4d71ad1`); the bounded remediation loop replaced the original
terminal-block/upstream-proposal policy. `spec-section-membership` and
`plan-coverage-single-artifact` made a Coverage line a representative delivery
anchor. The extractor fix (`docs/features/unfenced-json-extraction/`) parses
from the first `{` without a fence. Hazard 17's list-marker remedy normalizes
both sides and states the node form in the prompt (`a2db2a0`).

### Earlier history (2026-08-29 to 2026-09-04)

- **Stable criterion IDs** (`9a12cba`): spec-minted canonical IDs and the exact
  bidirectional Coverage relation.
- **Coverage-gate investigation**: the answer already lived in
  `docs/proposals/spec-kit-harness-review.md` — a decision that lives only in
  the narrative tier dies at the next compaction.
- **Step 8, delivery check** (`d033595`): a billed standalone review beat an
  in-session subagent (hazard 14); a break mutation must change the outcome
  class the test pins.
- **Step 5b** (`60587fc`…`39d5432`): only the operator rules on a wrong task
  boundary; a reconciliation stamp is a claim, not evidence.
- **Steps 1-7** (`83d88c0`, `32a714e`): `bw new-run` needed `.governance/`
  gitignored (hazard 11); refuse what cannot be verified; the plan stage mirrors
  the spec stage without a shared abstraction (hard rule 4).
