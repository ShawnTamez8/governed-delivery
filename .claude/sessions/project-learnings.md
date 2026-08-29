# Project learnings — BuildWorks (governed-delivery)

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

### Open questions

- None at this time.

### Next steps

- Build order step 2: one harness adapter, concrete, no interface above it.
  Plan under `docs/features/` per the write-plan convention.

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
