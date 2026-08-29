# Project learnings — BuildWorks (governed-delivery)

## 2026-08-29 — Step 5 and the 12 findings planned; four planning lessons

### State

- Two plans written, both `Status: Proposed`, neither executed:
  - `docs/features/approval-gate-hardening/plan.md` — 11 tasks, closes all 12
    step-4 review findings (10 open plus the 2 accepted-deferred).
  - `docs/features/plan-stage/plan.md` — 7 tasks, build order step 5 plus the
    profile’s deferred model map.
- Hardening runs first. The plan-stage plan states the dependency explicitly:
  `Store.transaction` re-entrancy, the `spec.gate.pass` contract, and
  `Profile.approvalSigner` would otherwise be written twice.
- Nothing implemented this session. Tree clean at `b1ac09b` apart from this file.

### Lessons

- **A findings list is not a task list.** Findings 3 and 9 were filed
  separately — "signed risk recomputed from disk" and "risk uses the raw
  artifact count while scope is deduplicated" — but they are one miscount seen
  at two boundaries. Planned as two tasks they would have been fixed on one
  side and left inconsistent on the other, which *is* the defect. Group a
  review’s findings by defect, not by where the reviewer happened to notice
  them.
- **A guard that reads ambient state can be silently un-exercised by fixture
  ordering.** Task 9 freezes the approval key’s fingerprint by reading
  `BW_APPROVAL_PUBLIC_KEY` inside `freezeProfile`.
  `test/approval-stage.test.ts` sets that variable *after* it calls
  `freezeProfile`, so every fixture would freeze `approvalSigner: null` — bound
  path untested, suite green, guard proving nothing. This widens the step-4
  lesson: it is not only *normalized* input that hides a defect, it is input
  established at the wrong *time*. When a new guard reads an env var, the cwd,
  or the clock, check when existing fixtures establish it.
- **Blast-radius claims must be grepped at the moment they are written.** Two
  claims in the first drafts came from memory: `test/agents.test.ts` "asserts
  properties rather than length" (it asserts `reviewers.length >= 2`, so the
  conclusion held for a different reason than the one stated), and
  `freezeProfile`’s call sites (eight, six of them in one test file). A
  remembered dependency claim is an unverified one — paste the grep with line
  numbers or do not make the claim.
- **A document describing control characters must not contain them, and an
  edit that reports success is not evidence the bytes changed.** A character
  class written with literal NUL and 0x1f went into a plan file: it first broke
  a Bash heredoc, then made `grep` treat the plan as binary. The fix then
  *appeared* to work — a string replace reported success and the surrounding
  prose changed while the bytes stayed. Only re-reading the file caught it; a
  character-level replacement was what actually worked. Verify an edit by
  re-reading the artifact, never by trusting the tool’s own success report.

### Process fix worth making

- **Persist a review’s findings as a file, not in scrollback.** The step-4
  review’s 12 findings survived only in the `step4-open-findings` memory and
  prose here; 4 of 12 were nearly lost and recovering them cost a round trip.
  `docs/features/<slug>/<date>-plan-review.md` already exists as precedent
  (spec-stage, harness-adapter). Code reviews should follow it.

### Next up

- Execute `docs/features/approval-gate-hardening/plan.md`, then
  `docs/features/plan-stage/plan.md`.
- The plan-stage plan carries one real API spend (a manual smoke). Budget for
  prompt iteration: step 3’s smoke found two prompt defects the fixtures could
  not.

## 2026-08-29 — Context compaction wired; steps 1-4 shipped

### Decisions and assumptions

- No hook can observe context capacity from outside the harness, so the
  context-compaction skill stays judgment-driven (Claude runs it at
  milestones and around half capacity — the operator does not invoke it).
  The harness-side mechanism is the auto-compact window in
  `.claude/settings.json`: 500000 tokens, 50% of the configured 1M.
- The skill's "Session continuity" pointer in CLAUDE.md is a required part
  of the setup; step-4 edits had dropped it and it was re-added (commit
  `b1ac09b`). Keep it when editing CLAUDE.md.
- Build progress: steps 1-4 committed (`f68347c`, `14a7ea5`, `d489847`,
  `84dd23d`, `b1ac09b`); step 5 is next.

### Deferred and open

- Open: 12 step-4 review findings are the step-5 planning input — signed
  risk recomputed from disk after the panel was sized, `validateExpiry`
  accepting impossible dates, unescaped payload header lines, `change_kind`
  not re-checked at the gate, lexical `isInside`, `sign --key` containment,
  sha256-object-format repos, and the zero-stage spend guard. See the
  step-4 review entry below for the full list.
- Deferred: approval-write atomicity and the trust-anchor freeze (accepted
  review findings 5/6) ride with step 5's profile model-map work.

### Verification

- `npm ci && npm run typecheck && npm test && npm run check:docs` — 212/212
  green at commit `84dd23d`.

### Next time

- Read the step-4 entries below before planning step 5.

### Next up

- Build order step 5: plan stage and gate, carrying the profile's deferred
  model map and the 12 open review findings.

## 2026-08-29 — Step 4 review reconciled: three Windows defects, all measured

An independent code review of the approval gate produced 15 findings. The three
fixed here were the ones that broke the documented workflow on the platform this
machine runs. Each was confirmed by measurement before any edit, and each new
test was run against the pre-fix code and seen to fail.

- **The signing tool signed bytes the gate could never recompute.** Measured on
  PowerShell 5.1: the documented pipe delivers the payload with a UTF-8 BOM
  prepended and every LF rewritten to CRLF, plus one trailing CRLF; the redirect
  route (`> payload.txt`, then `Get-Content -Raw |`) delivers two trailing CRLFs,
  because the file keeps its own newline and PowerShell appends another handing
  the string to a native command. `sign-approval.mjs` stripped one trailing
  newline and nothing else. The human gate was unusable on the default shell of
  a supported platform.
- **The lesson from step 4 was right but scoped too narrowly.** That entry says
  a test that normalizes its input hides the defect it exists to catch.
  `test/sign-approval.test.ts` normalized nothing — and still missed this,
  because feeding `spawnSync`'s `input` byte-exact *is* a normalization: it
  bypasses the shell the operator actually types into. The general rule:
  **where a documented workflow runs through a shell, an editor, or a
  filesystem, that layer is part of the contract and belongs inside the test.**
  Byte-exactness at the process boundary proves nothing about the boundary the
  human crosses.
- **A tolerance applied at one boundary and not its sibling is a defect.**
  `normalizeText` was applied to the spec hash so a CRLF checkout could not
  invalidate an authorization, but not to `validateSpecDoc`, which parses the
  same file. A BOM-saving editor therefore blocked approval reporting a missing
  `feature:` field that was plainly present. When a tolerance is added, find
  every reader of the same bytes.
- **A guard must compare the way the filesystem compares.** `touchesProtected`
  matched protected prefixes case-exactly. On Windows and macOS
  `Src/Agents/x.ts` and `src/agents/x.ts` are one file, so capitalization
  evaded the guard and took the risk score from `standard` to `low` — a
  two-reviewer panel down to one. The guard now folds case; `computeScope`
  deliberately does not, because the operator signs the paths as declared.
- **Breaking the guard caught my own mistake, not just the original one.** A
  bulk `.exec(content)` → `.exec(text)` replacement also hit the private
  `section()` helper, whose parameter is separately named `content`. The full
  suite would have caught it, but the break-test caught it first and cheaper.
  Confirms the standing rule: a test that passes on first write has shown only
  that your reading matched the code.

Gate after the change: 212 tests pass (was 207), `typecheck` clean,
`check:docs` clean, and both documented signing workflows verified end to end
through a real PowerShell 5.1 shell. Not committed.

Twelve findings from the same review remain open — signed risk recomputed from
disk after the panel was sized, `validateExpiry` accepting `2026-02-30`,
unescaped payload header lines, `change_kind` never re-checked at the gate,
lexical `isInside`, `sign --key` containment, sha256-object-format repos, and
the zero-stage spend guard among them.


## 2026-08-29 — Build order step 4 implemented (human approval gate)

- `bw approval-request` prints the canonical payload; `bw approve` verifies one
  Ed25519 signature and records the `approval` row, creating the
  `awaiting_approval` stage only on success. The gate dispatches nothing, so a
  refusal costs nothing and is *not* terminal — it audits `approval.refused`
  and leaves no stage row, unlike step 3 where every failure was terminal
  because money had already been spent. Plan:
  `docs/features/approval-gate/plan.md` (Status: Implemented).
- The profile (`.governance/profiles/<run>/profile.json`, hash on
  `run.profile_ref`) is frozen at `new-run`. It carries the starting commit
  because section 15's `run` table has no column for one and
  `test/schema.test.ts` compares columns against ARCHITECTURE.md — adding a
  column would have meant editing the design document.
- **The lesson worth carrying: a test that normalizes its input can hide the
  defect it exists to catch.** The CLI walk stripped the trailing newline from
  `approval-request`'s stdout before signing, so it passed while the real
  documented workflow (`> payload.txt`, then sign) would always have failed
  verification. `console.log` appends a byte that is not in the signed payload.
  Where bytes are signed or hashed, a test must consume them exactly as a user
  would — any normalization in the test is a place the contract can be wrong.
- Known gap, accepted by operator decision: the verification trust anchor is
  `BW_APPROVAL_PUBLIC_KEY` at approve time and the recorded `signer` is never
  compared to anything frozen, so whoever can set that variable can
  self-approve. Agents cannot (no `BW_*` in `envPassthrough`, no CLI in the
  allowlist — both now asserted in `test/executor.test.ts`). The hardening, if
  ever wanted, is to freeze the signer fingerprint in the profile.
- Also accepted: `approveRun`'s writes are not atomic; a crash mid-approval
  wedges the run. Fixing it needs `Store`'s transaction handling restructured
  (`insertStage` and `appendAudit` each open their own `BEGIN IMMEDIATE` and
  cannot nest) — step-1 code, deliberately out of scope.
- Next: build order step 5 — plan stage and gate. It is the first step that
  needs a per-stage model, so the profile's deferred model map (section 10)
  should land with it.

## 2026-08-29 — Design reconciled; ready for build order step 1

### Locked decisions

- Architecture reconciled against `2026-08-28-architecture-review.md`; all 14
  findings applied. Commit `f68347c`.
- System name: configuration value, default **BuildWorks**. No other name is
  established.
- Internal paths stay fixed and non-configurable: `.governance/`,
  `gov/<slug>/<run-id>`, `governed.yaml`. Configurability was rejected on the
  `.gitignore` pairing, state references, findability, and hard rule 4
  (no abstraction without two real implementations).
- Remediation rounds: default 3 (counting closure passes), set in
  configuration, frozen in the profile.
- Panel size: configuration per risk level; defaults 2 at standard risk, 1 at
  low risk.
- Approval: Ed25519 signature by the operator, verified by the gate against a
  public key in machine-local configuration.
- Patch validation: a patch binds to the head in effect when proposed;
  apply-time re-validation refuses only if head moved in paths it touches.
- Harness language: TypeScript on Node, per operator decision 2026-08-29.

## 2026-08-29 — Build order step 3 implemented (spec stage)

- `bw spec` runs the spec and spec_review stages as two chained rows:
  author → AgentResult validation → content write (spec row), then panel →
  findings → deterministic gate → closure rounds (spec_review row). Every
  failure path is terminal: blocked stage, blocked run, named reason, audit
  event, retained raw output. The panel's re-review resolves findings — the
  author's claim never does.
- Enum choices (architecture left them open): severity low/medium/high/
  critical (materiality threshold `high`), disposition open/resolved/
  disputed/accepted, risk low/standard/high with panel sizes 1/2/3. Risk is
  recomputed from the spec at approval time, never persisted.
- The manual smoke against the real binary was the highest-value spend yet:
  it exposed two prompt defects the fixtures could not. (1) Mentioning
  `baseCommit` in the author prompt made the model refuse to produce a spec
  without a git repo — patch rules do not belong in a content-write prompt.
  (2) The reviewer returned a bare findings object until the prompt stated
  the full envelope shape with every field. Real smoke output must drive
  prompt iteration; fixtures cannot.
- The real smoke also produced the designed terminal state: the demo spec
  could not pass review in 3 rounds — run blocked naming finding ids 11 and
  12, 15 findings total, 10 resolved by re-review, audit complete. Fail
  closed, exactly as designed.
- Next: build order step 4 — human approval binding state (Ed25519 signature
  over spec hash, starting commit, profile hash, risk, scope).

## 2026-08-29 — Build order step 2 implemented (harness adapter)

- `bw dispatch` is end to end against the real `claude` binary: probe →
  invoke → retain raw → audit → parse envelope → `agent_run` row. Failure
  paths (timeout, non-zero exit) retain raw output and audit the attempt but
  insert no `agent_run` row; the architecture section 15 now states that rule.
- Discoveries from the one recorded real envelope (`test/fixtures/harness/
  claude-code-envelope.json`), all ground truth now:
  - `claude -p --output-format json` DOES report `total_cost_usd` — the
    architecture's old `sessionCost: false` example was wrong; fixed to
    `true`, and the fixture asserts cost, not null.
  - `modelUsage` can contain auxiliary model queries (a title generation)
    alongside the real turn; only the effective model's usage lands in the
    top-level `usage.*`. The effective model is the unique `modelUsage` entry
    whose `inputTokens` match `usage.input_tokens`; no unique match records
    `null` (the smoke run did exactly that under proxy routing).
- Windows gotchas: `taskkill` must run by full path (`SystemRoot\System32`)
  — a PATH miss makes the tree-kill a silent no-op; `invokeHarness` is async
  by necessity (timeout timers starve under any synchronous wait). A GNU
  `timeout`-killed test run can look green because Node's exit teardown kills
  the hung child — the duration assertions in `test/harness.test.ts` exist to
  catch that lie.
- Next: build order step 3 — spec stage and its review panel with a
  deterministic gate.

## 2026-08-29 — Build order step 1 implemented

- Run store, stage chain, and audit chain over SQLite shipped in TypeScript on
  Node 24 (`node:sqlite`, no runtime dependencies), with the `bw` CLI, the
  repository lock, and the documentation checker as the `doc-check` project
  skill. Plan: `docs/features/run-store/plan.md` (Status: Implemented).
- One independent code review reconciled: 15 findings, all fixed. The
  fail-closed `--gate-result` requirement, transactional audit appends, and
  lock ownership tokens are the rules to preserve in later steps.
- Deviations to remember: migrations anchor to the module location, not cwd;
  the pid-reuse wedge is mitigated with a held-since diagnostic only (age-based
  takeover rejected as unsafe).
- Commands: `npm run typecheck`, `npm test`, `npm run check:docs` — also in
  CLAUDE.md, which is where commands live.
