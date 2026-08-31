# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-08-30)

**Shipped:** build order steps 1-6, committed as `32a714e` on master. Suite 368
pass / 1 recorded skip, `typecheck` clean, `check:docs` clean.

**In flight:** step 7 (verification) is **planned but not implemented**.
`docs/features/verification-stage/` is untracked — `plan.md` (Proposed, 12
tasks), `tasks.md`, and `2026-08-30-plan-review.md` (7 findings, all accepted
and reconciled). No source file has been touched; nothing is committed.

**What step 7 will build:** a strict-subset `governed.yaml` parser, a bounded
command runner, an audit reader on `Store`, and the stage orchestrator, plus
three policy values, a non-nullable `Profile.verification`, `new-run`
preconditions, `bw verify`, this repository's own `governed.yaml`, and two
`ARCHITECTURE.md` amendments. No schema change, no migration, no dispatch —
the stage resolves no model.

**Open and deferred:**

- The clean-tree precondition at `new-run` is an **extension past step 7**,
  flagged in the plan's Assumptions so it can be struck. Nothing in `src/`
  enforces section 7's clean-tree requirement today (verified by grep).
- Verification runs implementer-authored code with no filesystem or network
  containment. The plan records this as a stated limitation plus a
  `docs/proposals/` entry; the repository has no sandbox mechanism to reuse
  and `sandbox.network` is `"inherit"` for the executor too.
- The verification trust anchor is `BW_APPROVAL_PUBLIC_KEY` at approve time.
  Whoever can set it can still self-approve. Agents cannot: no `BW_*` in
  `envPassthrough`, no CLI in the allowlist, both asserted in
  `test/executor.test.ts`. Step 7 extends the same guarantee to verification
  commands via `VERIFY_ENV_PASSTHROUGH`.
- `check:docs` warnings, pre-existing: the learnings file references a removed
  skill directory and the approval-gate plan references a placeholder src path.
  Offered to fix; not taken up.
- The build order stops at step 9. Do not build past it without an explicit
  decision.

**Closed this session:** the three-orchestrator extraction question that step 6
deferred to step 7. Verification has no author, panel, rounds, model, prompt, or
`agent_run` row, so the shape the three dispatching stages share is absent; an
interface spanning all four would have to make every one of those optional. The
plan recommends closing rather than carrying it to step 8.

**Next up:** execute `docs/features/verification-stage/plan.md` with
`implement-plan` in a fresh window.

## Diagnostics quick-reference

Durable one-liners that recur. Each cost at least one wasted cycle to learn.
Most are also mirrored into auto memory, which loads automatically.

- **Citing a file is not reading it.** A blast-radius line naming
  `test/harness.test.ts` sat in the same plan as an assertion that file's
  comments explicitly contradict. When a claim concerns behaviour, open the
  test that records it.
- **A neighbouring plan's claims look pre-verified and are not.** Three
  blast-radius claims copied from the step-6 plan were wrong. Grep at the
  moment of writing, even when a sibling document already states it.
- **Before quoting a cost in test files, look for a shared helper.** "Six test
  files need fixtures" was really one shared temp-root factory in
  `test/cli.test.ts`. The inflated number drove an operator decision that had
  to be reversed a turn later.
- **Never write a backslash in a Bash tool command,** and prefer the `Write`
  tool for any long document. A doubled backslash arrives as a single one under
  every quoting form, and a quoted-delimiter heredoc still failed on a
  multi-paragraph document with apostrophes. `Write` preserves bytes exactly.
- **Break-it cycle:** `git add -A` (no commit) → break → run the test →
  `git checkout -- <path>` → `git diff --quiet -- <path>`. Non-zero means halt.
  **One cycle per tool call.** Prefer a scratchpad mirror when the code under
  test can run against a copy.
- **A break-it test named in a plan is still a hypothesis.** Verify the
  direction of the attack at the shell first. A test written to fail that
  passes on first run is a defect in the test.
- **A precondition needs a test that does not seed its own satisfaction.**
  `new-run`'s clean-tree check shipped unconditionally broken — `openStore()`
  creates `.governance/` before the check runs, so no repository lacking that
  ignore rule could ever create a run. Every test passed, because the shared
  temp-root helper wrote the `.gitignore` first. A helper that constructs a
  passing environment proves the check fires; only a default environment proves
  the product works. Ask what the helper is quietly providing.
- **Relaxing a limit for one resource means naming what still bounds it.**
  "Retain the bytes anyway" was applied to the evidence file with the in-memory
  cap left in place — and nothing bounded disk but the 900-second command
  ceiling. Measured: 5.97 GB in 5.2 seconds. When a rule written for a bounded
  thing is applied to an unbounded stream, the rule needs its own ceiling.
- **A stage that has never been smoked is unproven however green its tests.**
  Step 6 shipped on fixture coverage with no recorded manual run; the first real
  `bw implement` blocked immediately, because the fixture executor returns a
  canned result and never touches the worktree, so no test could observe the
  implementer writing the files it also proposes. Before depending on an
  upstream stage, check whether a smoke was ever recorded for it.
- **Verify an edit by re-reading the artifact,** never by trusting the tool's
  success report.
- **`core.autocrlf=true` on this machine.** CRLF silently breaks
  substitution-based fixture assertions and the failure never names line
  endings. `.gitattributes` pins ts/mjs/sql/json/md to `eol=lf`.
- **`npm test` runs files in parallel; a single-file pass is not evidence the
  suite passes.**
- **Read the callee's signature rather than inferring it from its name.**
  `store.exec` (not `execute`); `verifyAuditChain` returns `null` for a valid
  chain.
- **Windows:** `taskkill` must run by full path or the tree-kill is a silent
  no-op. `spawnSync`'s `timeout` kills only the direct child, which under
  `shell: true` is the `cmd.exe` wrapper — use async `spawn` plus `killTree`.
- **Never commit a sweep without reading the full, untruncated inventory
  first.** `git add -A` once swept a stray duplicate of `ARCHITECTURE.md` into
  a commit.
- **PowerShell inline `node -e` quoting is unreliable under every form.** Write
  one-off query scripts with the `Write` tool and run the file.
- **Scaffolding that silently no-ops is more dangerous than a broken edit** —
  its results still look plausible.

## Session records

### Step 7: verification plan written and reconciled (2026-08-30)

Planning only — no source touched. `write-plan` full path produced a 10-task
plan; a self-review pass found 7 material issues; the operator then supplied 7
external review findings, all of which were verified against the repository and
accepted, taking the plan to 12 tasks and 24 break-it targets.

**Decisions locked** (operator, this session):

- **Remediation rounds deferred past step 9**, and — reversing the initial
  disposition — `ARCHITECTURE.md` section 12 gains a subsection recording this
  deferral *and* the two already in force unrecorded (scope fitness,
  `status.md`) with their repair semantics. A plan-level assumption does not
  amend a document `CLAUDE.md` calls binding.
- **`new-run` refuses a repository that cannot verify** — absent, malformed,
  uncommitted, or dirty configuration is refused before the run row exists.
  This reversed an earlier call of mine; see the cost-estimate lesson below.
- **`governed.yaml` is read from the resolved starting commit** via `git show`,
  with no working-copy fallback, and the validated config is passed into
  `freezeProfile` rather than re-read. `Profile.verification` is non-nullable.
- **Named environment passthrough** (`VERIFY_ENV_PASSTHROUGH` in policy, frozen
  per run, asserted to hold no `BW_` name).
- **`output_ref` is a structured JSON record** carrying the worktree path, the
  verified commit, per-command outcomes, and evidence refs — not a text report.
- **Overflow blocks**, the budget is `profile.policy.resultMaxBytes` and is
  combined across both streams, and complete output is streamed to the evidence
  file independently of the in-memory cap.

**Architecture facts that settled questions I nearly asked as open:**

- Section 12 names **"verification config"** among what the profile freezes, so
  hard rule 6 puts the read at run start — not an open choice.
- Section 12 names **bounded remediation rounds for `verification`** by name,
  unlike implementation, where section 20's "per reviewed stage" wording let
  step 6 decline them without contradiction.
- Section 17: **"Pass named environment variables, never the whole
  environment."** `invokeHarness` implements it; a plain `spawn` with no `env`
  inherits everything.
- Section 4: **stage N's `output_ref` is literally what stage N+1 was handed.**
- `Policy` already carries `resultMaxBytes`; reading the live `RESULT_MAX_BYTES`
  in a stage discards a value the run had already frozen.
- `Store` has **no audit reader** — only `appendAudit` and `verifyAuditChain`.
- `ARCHITECTURE.md` has not changed since `14a7ea5` (step 2), so steps 3-6 all
  deferred section-12 requirements with plan-level assumptions alone.

**What failed in my own work:**

- The plan asserted a nonexistent executable yields `spawnError` with a null
  exit code. `test/harness.test.ts` records the opposite in a comment written
  for exactly this reason: under `shell: true` the shell starts, names the
  command on stderr, and exits 1. The plan cited that file in its blast radius
  while contradicting it.
- Three blast-radius claims were carried from the step-6 plan rather than
  grepped: `src/plan-gate.ts` imports policy and was missing, `test/cli.test.ts`
  does **not** import profile, and `src/harness.ts` is also imported by
  `src/policy.ts`.
- A "four block paths" count enumerated three — the miscount was the symptom of
  overflow having been designed as a flag that never blocked.

**Deferred:** filesystem and network containment for verification commands
(stated limitation plus a proposal, not built). The clean-tree precondition is
in the plan but marked strikeable.

**Next up:** run `implement-plan` against
`docs/features/verification-stage/plan.md` in a fresh window.

### Step 6: implementation stage — shipped (2026-08-30)

Nine tasks, committed as `32a714e`; independent review filed two low findings,
both closed. Smoke: one `claude-sonnet-5` dispatch, **$0.0673**, 5.1s, valid
patch set on the first attempt — the third stage whose prompts worked unmodified
on the first real attempt. Nine guards broken and restored.

**Decisions locked:** `ProposedPatchFile.content` is the complete new file
content (no diff field); scope matching is exact-or-`s/`-prefix, case-preserving
(`touchesProtected` folds case, scope does not); one commit per patch under
`BuildWorks <buildworks@buildworks.invalid>` via `-c` flags; the projections are
the run branch's first commit; one patch per file per dispatch, enforced by the
head-moved re-validation. Scope fitness and `status.md` deferred past step 9;
`RUN_DURATION_LIMIT_SECONDS` (7 days) landed here.

**The review's lesson:** a documented guarantee ("the refusal does not depend on
the target's existence") was false at a boundary the plan never tested —
`resolveExisting` walks with `existsSync`, so a dangling link resolves
lexically. The fix refuses any link component whose target cannot be resolved.
**Refuse what cannot be verified rather than claim a resolution the filesystem
cannot provide.** Constructible on Windows via a junction whose target is
deleted after creation.

**Two draft-gap lessons that survived planning:** a binding argument must name
the file it covers (an unchanged plan does not imply an unchanged spec, so the
stage re-verifies both); and consult the repo's own records before writing a
link-redirect gate — the symlink class was already recorded twice and missed
both times.

### Step-4 hardening and review: twelve findings closed (2026-08-29)

`docs/features/approval-gate-hardening/plan.md` Implemented; every fix observed
failing against the unfixed code first. Durable lessons:

- **A guard that reads ambient state can be silently un-exercised by fixture
  ordering.** `freezeProfile` reads `BW_APPROVAL_PUBLIC_KEY` and the fixture set
  it *after* the call, so every fixture froze `approvalSigner: null` and the
  bound path was untested while the suite stayed green. Reordering was not
  enough — the tests now open with `assert.ok(f.frozenSigner)`. **When a new
  guard reads an env var, the cwd, or the clock, assert in the test that the
  fixture actually established it.**
- **A findings list is not a task list.** Two findings were one miscount seen at
  two boundaries; planned separately they would have been fixed on one side and
  left inconsistent on the other, which *is* the defect. Group by defect.
- **The signing tool signed bytes the gate could never recompute.** On
  PowerShell 5.1 the documented pipe adds a UTF-8 BOM and rewrites every LF to
  CRLF. **Where a documented workflow runs through a shell, an editor, or a
  filesystem, that layer is part of the contract and belongs inside the test.**
- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText` reached the spec hash but not `validateSpecDoc`, which parses
  the same file.
- **A guard must compare the way the filesystem compares.** Case-exact
  `touchesProtected` let a capitalized path evade it on Windows.
- **A rolled-back audit insert does not break the hash chain** —
  `verifyAuditChain` recomputes from surviving rows. `Store.transaction`
  re-entrancy: a nested failure aborts the outermost frame; silent partial
  commits are not possible.

### Build order steps 1-5 (2026-08-29)

- **Step 5 — plan stage and gate** (`83d88c0`). Mirrors the spec stage
  structurally without extracting a shared abstraction (hard rule 4). Six
  defects found, four accepted. **The approval's `expires_at` is a human signing
  window, not an authorization lifetime** — it bounds `approval-request` → sign
  → `approve`, and re-checking it later would strand a run with no in-place
  repair. Smoke: six dispatches, **$0.63**, three remediation rounds; hazard 13
  enforced live when a finding caught the plan author inventing a rejection
  requirement the spec never stated.
- **Step 4 — human approval gate.** `bw approve` verifies one Ed25519 signature
  and creates `awaiting_approval` only on success. The gate dispatches nothing,
  so a refusal costs nothing and is not terminal — unlike step 3, where every
  failure was terminal because money had already been spent. The profile carries
  `startingCommit` because section 15's `run` table has no column for one and
  `test/schema.test.ts` compares columns against ARCHITECTURE.md.
- **Step 3 — spec stage.** Enums the architecture left open: severity
  low/medium/high/critical with threshold `high`; disposition
  open/resolved/disputed/accepted; risk low/standard/high with panel sizes
  1/2/3. **The manual smoke was the highest-value spend yet** — it exposed two
  prompt defects fixtures could not: naming `baseCommit` in the author prompt
  made the model refuse to produce a spec without a git repo, and the reviewer
  returned a bare findings object until the prompt stated the full envelope
  shape. **Real smoke output must drive prompt iteration; fixtures cannot.**
- **Step 2 — harness adapter.** From the one recorded real envelope:
  `claude -p --output-format json` **does** report `total_cost_usd` (the
  architecture's `sessionCost: false` example was wrong); `modelUsage` can carry
  auxiliary queries, so the effective model is the unique entry whose
  `inputTokens` match `usage.input_tokens`, and no unique match records `null`.
  `invokeHarness` is async by necessity — timeout timers starve under any
  synchronous wait.
- **Step 1 — run store.** SQLite via `node:sqlite`, no runtime dependencies.
  Rules to preserve: fail-closed `--gate-result`, transactional audit appends,
  lock ownership tokens. Migrations anchor to the module location, not cwd. The
  pid-reuse wedge is mitigated with a held-since diagnostic only — age-based
  takeover was rejected as unsafe.

### Skills and tooling (2026-08-29)

- `review-code` is a global skill reading the per-repo checklist
  `.claude/review-code.md`. The doc skills discover the project documentation
  skill by what it does, so they find `doc-check` here.
- `scripts/doc-check.mjs` has tiers (current / reference / historical),
  `--json`, `--only=`, and **exit 2 when the checker itself cannot read the
  source** — the motivating defect was a renamed `ARCHITECTURE.md` section
  making the old checker report a documentation defect that did not exist. **A
  checker that blames the wrong artifact is worse than no checker.**
- Historical-tier documents (`docs/features/**`, `.claude/sessions/**`) get
  warnings, never errors. Path warnings for files a plan is about to create are
  expected; do not chase them to zero.
- Skill files load into context on every invocation, `description` fields in
  *every session*. Cut anything the tool's own output already says.

### Locked design decisions (2026-08-29)

Architecture reconciled against `2026-08-28-architecture-review.md`, all 14
findings applied (`f68347c`).

- System name is a configuration value, default **BuildWorks**.
- Internal paths stay fixed and non-configurable: `.governance/`,
  `gov/<slug>/<run-id>`, `governed.yaml`.
- Remediation rounds default 3 (counting closure passes), frozen in the profile.
- Panel size is configuration per risk level; defaults 2 at standard, 1 at low.
- Approval is an Ed25519 signature verified against a public key in
  machine-local configuration.
- A patch binds to the head in effect when proposed; apply-time re-validation
  refuses only if head moved in paths it touches.
- Harness language: TypeScript on Node, per operator decision.
- No `docs/hazards.md` entry for the CRLF fixture breakage: that document
  records failures that have occurred in delivery, and entries 1 and 12 already
  cover the class. Latent fragilities do not earn an entry.
