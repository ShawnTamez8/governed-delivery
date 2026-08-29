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
