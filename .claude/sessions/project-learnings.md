# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-24, resilience panel and parallel code review — committed at `6ed1991`)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working state (verified 2026-09-24 with `git log`):** Branch
`guided-project-bootstrap`, HEAD `6ed1991`, not pushed. That commit holds the
resilience/parallel layer, the `withRoot` test fix and these session records.
`CLAUDE.md` and `AGENTS.md` are byte-identical.

**Shipped at `6ed1991` — resilience panel and parallel code review:**
`docs/features/resilience-parallel-code-review/plan.md` is `Implemented`.
`2026-09-17-plan-review.md` is `reconciled`; `2026-09-17-code-review.md` is
`reconciled` with one medium finding (missing deterministic-order, multi-failure
and aggregate-cost regressions) accepted and fixed on 2026-09-18, each new guard
break-tested. The change adds a third `code-findings` lens (resilience/state
integrity), raises the default `CODE_REVIEW_PANEL_SIZE` to 3, launches reviewers
within a panel concurrently, drains every launch, checks the worktree once when
the panel is quiescent, and consumes reports in frozen panel order. It has
never run against a provider.

**Checks before commit (2026-09-24):** typecheck and `check:docs` were clean
(operator). The operator's `npm test` failed only on the recurring
`test/verify-command.test.ts:134` cleanup EPERM. Node 26 `rmSync` never retried
the transient external hold on `evidence.txt`, so the approved test-only fix
makes `withRoot` retry only EPERM/EBUSY for about 2 s. It was validated by a
held-file probe with a break-test, 256 stress runs (0 failures, one real lock
absorbed), and a full suite run in which it passed
(`.claude/sessions/2026-09-24-debug-verify-command-eperm-inert-retry.md`). That
run's only failure, `test/cli-operator.test.ts:1394`, is environment-specific:
it fails when launched from the assistant's tool shell and passed in the
operator's terminal.

**Committed since the last resume point:**
- `834d209` — exhaustive-audit (anti-sampling) code-review prompt and a
  pre-dispatch declared-artifact check that blocks stage and run via
  `code_review.artifact.missing` before any reviewer spend. Prompted by paid run
  `target-tap-live-2` (16 dispatches, $3.58933), which blocked at the final
  round-2 panel on two new high findings after one remediation.
- `2a31e5c` — plan reconciliation prompt treats every `## Coverage` line as a
  normative node. Prompted by a `target-tap` paid run (10 dispatches, $1.55366)
  blocked at `plan_review` round 1 on an unclaimed `AC-011` rewording.
- `4848a64` — verify-command `'close'`-not-`'finish'` cleanup race fix; its code
  review is `reconciled`, 0 findings.

**Completed earlier:** guided project bootstrap (`plan.md` `Implemented`, both
reviews `reconciled`); fence anchoring and the 1800-second idle budget
(`docs/features/unfenced-json-extraction/plan.md` amendment, review
`reconciled`); read-only dashboard and command-center redesign (`3415032`).

**Target Tap PRD:** `.claude/skills/run-buildworks/target-tap-design.md`
(slug `target-tap`). It has now run against a provider twice (the two runs
above, both blocked). The scratch target's frozen verification commands are
still only `node --version` and `npm --version`, and the PRD asks for five kinds
of test that nothing in the chain executes.

**Decisions locked:** Hard Rule 2 holds — the guided initializer lives inside
the CLI mutation authority; the dashboard is a read-only loopback projection.
Signing stays external via canonical bytes and detached signatures. The single
starter is `static-web`. Guided mode is interactive only. Run identity is the
exact project, feature ID, slug and change-kind tuple. The idle budget is 1800
seconds in the frozen sandbox. Only `code_review` (2026-09-04) and its bounded
remediation loop (2026-09-06) are authorized past step 9.

**Implementation boundary:** Presentation narrows, never alters. Interactive UI
mutation, remote access, a second harness, a production executor switch, and
fabricated telemetry remain unauthorized. **No paid execution is authorized.**
No current dollar range exists for a three-reviewer chain; observed chains have
cost $1.39–$3.59.

**Running state:** Nothing started by the 2026-09-24 session. The 2026-09-15
dashboard on port 61419 is not listening (probed 2026-09-24).

**Open/deferred:**
- Pushing `guided-project-bootstrap` — not requested.
- Manual browser evaluation of the dashboard across themes and viewports.
- The `RunSnapshot` agent-field projection keeps model, harness and duration
  rendering as unavailable.
- Production interactive guided mode is proved only as two composed checks,
  because redirected stdin is refused by design.
- Whether a paid chain should exercise the three-lens concurrent panel, and at
  what budget and verification-command scope — operator decision.

**Next up:** Nothing is pending for the assistant. The next decisions are the
operator's: whether to push `guided-project-bootstrap`, and whether to
authorize a paid chain that exercises the three-lens concurrent panel.

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
- `agent_runs` persists model, harness and duration fields, but `RunSnapshot.cost.byAgent` keeps only agent plus cost; dashboard "unavailable" labels are a projection gap, not a data gap.
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

### Resume-point audit finds an undocumented layer (2026-09-24)

#### Decisions and assumptions
- The session ran context compaction only; no code, tests, review or spend. The
  assistant took its picture of the resilience/parallel layer from the committed
  plan and review records plus `git diff --stat`, not from re-running anything.

#### What failed
- The previous Current state (2026-09-16) described `834d209`'s work as
  uncommitted and knew nothing of `docs/features/resilience-parallel-code-review/`,
  planned, implemented and reviewed on 2026-09-17/18. It also still said the
  Target Tap PRD had never run against a provider, which two paid runs had
  already contradicted. Second occurrence of an undocumented layer; see the
  2026-09-15 record.

#### Verification
- `git log --oneline -8`, `git status --short`, `git diff --stat` — HEAD
  `834d209`, 18 modified plus 2 untracked paths.
- `Get-FileHash` on `CLAUDE.md` and `AGENTS.md` — equal.
- `Test-NetConnection 127.0.0.1 -Port 61419` — not listening.

#### Next up
- Re-run the three repository checks on the uncommitted layer, then ask the
  operator about committing it.

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
