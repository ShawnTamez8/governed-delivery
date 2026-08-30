# Project learnings — BuildWorks (governed-delivery)

## Hardening completed: all twelve step-4 findings closed (2026-08-29)

### State

- `docs/features/approval-gate-hardening/plan.md` is **Implemented**; all 11
  tasks and 18 steps checked off. Suite 238/238, typecheck clean, check:docs
  clean. Tasks 1-4 landed earlier (`617c42e`); tasks 5-11 in this session.
- **Step 5 is unblocked.** Both of its dependencies now exist:
  `Profile.approvalSigner` (task 9) and re-entrant `Store.transaction`
  (task 10). `spec.gate.pass` (task 3) already had.

### The twelve findings and the test seen failing for each

Every fix was observed failing against the unfixed code before the fix landed.

- 1 impossible expiry dates — `test/approval.test.ts` (task 1, earlier commit)
- 2 payload line forgery — `test/approval.test.ts` (task 2, earlier commit)
- 3 + 9 risk miscount / signed risk recomputed — `test/spec-stage.test.ts`
  "the panel is sized from distinct artifacts" (task 3, earlier commit)
- 4 `change_kind` never re-checked — `test/approval-stage.test.ts` (task 4)
- 5 `bw spec` spends on a blocked zero-stage run — `test/spec-stage.test.ts`
  "a blocked run is refused before anything can be dispatched". Failed with
  `ok: true`: the stage authored and reviewed to completion against a dead
  run. Timing is the clearest evidence — 795ms failing, 48ms once refused.
- 6 freeze-failure path unproven — `test/cli.test.ts` "a profile-freeze
  failure blocks the run and names it on stderr"
- 7 sha256 object-format repos — `test/profile.test.ts` "resolveStartingCommit
  reads HEAD in a sha256 object-format repository". Returned `null`.
- 10 lexical `isInside` — `test/approval.test.ts` "a public key reached through
  a link into the repository is refused". Accepted the key (`ok === true`).
- 11 `sign --key` containment — `test/sign-approval.test.ts` "sign refuses a
  private key that lives inside a repository". It printed a valid signature.
- 12 trust-anchor freeze (accepted-deferred) — `test/approval-stage.test.ts`
  "an approval signed by a key other than the one frozen at intake is refused"
- 13 approval write atomicity (accepted-deferred) — `test/store.test.ts`
  nesting cases failed with "cannot start a transaction within a transaction";
  `test/approval-stage.test.ts` "a failure mid-approval leaves the run
  retryable, not wedged" failed on "the half-written stage must have rolled
  back" with the wrapper removed.

### Lessons

- **A plan can specify a break-it test that cannot break.** Task 8 said to
  point a link *inside* the repository at an outside key directory. That path
  is already lexically inside the root, so the existing guard refuses it and
  the test would have passed against the unfixed code — a green test proving
  nothing, which is the exact failure mode hazard 4 exists to prevent. The
  direction that actually defeats a lexical `relative()` check is the reverse:
  a link *outside* the repository pointing *into* it. Measured at the shell
  first, both directions, before writing either test. **A break-it test named
  in a plan is still a hypothesis; verify the direction of the attack before
  writing the test, not after it passes.**
- **The fixture-ordering trap was real and the guard against it works.**
  `freezeProfile` reads `BW_APPROVAL_PUBLIC_KEY`, and the fixture set that
  variable *after* calling it. Reordering was not enough on its own: the two
  bound-path tests now open with `assert.ok(f.frozenSigner)`, and restoring
  the original ordering makes both fail on that line instead of passing
  vacuously. **When a new guard reads ambient state, assert in the test that
  the fixture actually established it** — the reorder is invisible six months
  later, the assertion is not.
- **Two of my own assertions were wrong, and the test caught me, not the
  code.** `store.execute` does not exist (it is `exec`), and
  `verifyAuditChain` returns `null` for a valid chain, not `{ok: true}`. Both
  surfaced as test failures that looked like product defects for a moment.
  Read the callee's signature rather than assuming its shape from its name —
  the same rule as "trace before asserting", applied to test code.
- **A rolled-back audit insert does not break the hash chain.**
  `verifyAuditChain` recomputes from the rows that survived, so the rows that
  vanished leave no gap. Worth knowing before wrapping any other audit-writing
  operation in a transaction.

### Deferred and open

- Nothing open from the step-4 review. The `step4-open-findings` memory is
  now stale and should be closed out.
- `Store.transaction` re-entrancy: a swallowed exception thrown inside a
  nested transaction used to zero the depth counter and silently commit the
  partial unit at the outer COMMIT. Since the step-5 review, a nested failure
  sets an abort flag instead; the outermost frame then rolls back and throws
  "transaction aborted by a nested failure", so loudness is preserved and
  silent partial commits are not possible.

### Next up

- Build order step 5: `docs/features/plan-stage/plan.md`, now unblocked.

## Hardening execution, CRLF fix, and hazard enforcement (2026-08-29)

### Decisions and assumptions

- Operator decision: no `docs/hazards.md` entry for the CRLF fixture breakage.
  That document records failures that have occurred in delivery; entries 1
  (item 7) and 12 already cover the class. Latent fragilities do not earn an
  entry.
- Three standalone commits, deliberately not squashed: `617c42e` hardening
  tasks 1-4, `e533ba3` CRLF fix, `0401fb7` hazard enforcement. The CRLF fix in
  particular needed its own breakable guard.
- The approval binds the spec a panel gated via the `spec.gate.pass` audit
  event carrying `specHash=` and `risk=`, not a new `stage` column — section
  15's table has no such column and `test/schema.test.ts` compares against it,
  so a column would have meant editing ARCHITECTURE.md.

### What failed

- Three `test/spec-stage.test.ts` scratch builders substitute across multi-line
  targets; under a CRLF working tree the replace silently no-matches and the
  tests fail on wrong-stage-outcome asserts that never name line endings.
  Fixed in `e533ba3`: `normalizeText` at the fixture-read boundary plus a
  `.gitattributes` pinning ts/mjs/sql/json/md to `eol=lf`.
- `open(p,"wb").write(open(p,"rb").read())` truncated
  `test/fixtures/harness/emit-spec-stage.mjs` to 0 bytes — the write handle is
  opened, truncating, before the read is evaluated. The full suite caught it
  (11 failures); a single-file run had passed. Recovered with `git checkout`.
- A heredoc-fed Python `replace` reported success while the literal control
  bytes it targeted survived, twice. Verify an edit by re-reading the artifact,
  never by trusting the tool's success report.

### What worked

- Break-first discipline caught a guard that guarded nothing: reverting the
  `computeScope(...).length` argument in `src/spec-stage.ts` failed *no* test,
  because no fixture declared duplicate artifacts. A scratch fixture with 11
  raw / 9 distinct paths now makes the panel size observable (low risk seats
  one reviewer), and the revert fails it.
- The `audit_no_delete` trigger refused a test that tried `DELETE FROM audit`
  to build a no-gate-event case; the fixture gained a `gateSummary` option
  instead. Append-only means append-only in tests too.

### Verification

- `npm ci && npm run typecheck && npm test && npm run check:docs` — 225/225
  green (was 212) at `0401fb7`.
- Break-it runs recorded for every guard added: expiry round-trip, payload
  control characters, `feature_id` at the source, spec-hash binding, risk
  binding, missing gate event, `change_kind` re-check, deduplicated risk count,
  the CRLF fixture path, and both hazard-consultation refusal paths.

### Deferred and open

- Open: 7 of the 12 step-4 findings remain — 7 (freeze-failure path unproven),
  8 (`bw spec` spends on blocked zero-stage runs), 10 (sha256 object-format
  repos), 11 (lexical `isInside`), 12 (`sign --key` containment), plus the two
  accepted-deferred: the trust-anchor freeze (task 9) and approval write
  atomicity (task 10). Tasks 1-4 are checked off in the plan.
- Open: step-5 execution is blocked on hardening tasks 9 and 10. The
  plan-stage plan depends on `Profile.approvalSigner` (task 9) and re-entrant
  `Store.transaction` (task 10); `spec.gate.pass` (task 3) has landed.

### Next time

- `core.autocrlf=true` on this machine. Any `git checkout` of a file predates
  `.gitattributes` at your peril — check `git ls-files --eol` when a
  string-substitution test fails for no visible reason.
- Python heredocs through Git Bash collapse doubled backslashes. Build regex
  and escape text with `chr(92)` rather than `BSLASH`-style literals.
- `npm test` runs test files in parallel; a single-file pass is not evidence
  the suite passes.

### Next up

- Resume `docs/features/approval-gate-hardening/plan.md` at Task 5, then work
  through Task 11. Step 5 unblocks once tasks 9 and 10 land.

## 2026-08-29 — Step 5 and the 12 findings planned; four planning lessons

### State

- Two plans written: `docs/features/approval-gate-hardening/plan.md` (11 tasks,
  all 12 step-4 findings) and `docs/features/plan-stage/plan.md` (7 tasks,
  build order step 5 plus the profile model map). Hardening runs first — the
  plan-stage plan states the dependency (`Store.transaction` re-entrancy, the
  `spec.gate.pass` contract, `Profile.approvalSigner`).

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

### Verification

- `npm ci && npm run typecheck && npm test && npm run check:docs` — 212/212
  green at commit `84dd23d`.

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
