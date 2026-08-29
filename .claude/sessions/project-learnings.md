# Project learnings — BuildWorks (governed-delivery)

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
