# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-08-30)

**Shipped:** build order steps 1-6 on `master` (`32a714e`). Step 7
(verification) is built and committed as `3be15fd` on branch **`step7`**, which
is not merged. Suite 429 pass / 1 recorded skip, `typecheck` clean,
`check:docs` clean.

**Step 7 is NOT done.** Tasks 1-11 of `docs/features/verification-stage/plan.md`
are complete and its independent code review is reconciled; **Task 12, the
manual smoke, is outstanding** and the plan stays `Proposed`. Unproven: a
passing verification stage, a blocking one, and the environment canary absent
from real retained output. All three need a passed `implementation` stage.

**The blocker is in step 6, on master, not in this branch.** `bw implement`
blocked with `add requires the file not to exist` because the implementer wrote
its files into the worktree and then also proposed them as `add` patches. The
prompt forbids git commands and never forbids writing files. Step 6's own smoke
passed the same prompt on one dispatch, so **the behaviour is nondeterministic
and a retry may simply succeed**. Filed as
`docs/proposals/implementer-writes-files-it-also-proposes.md`.

**Open and deferred:**

- Task 12 needs a passed implementation stage. Cheapest path: fix the
  implementer prompt, confirm across **several** runs (one green run is the
  evidence step 6 already had), then one full-chain run for the record.
- `VERIFY_RETENTION_MAX_BYTES` is 64 MB — chosen, not derived. Operator may
  want a different value; it is frozen per run either way.
- Filesystem and network containment for verification commands is unbuilt and
  stated as a limitation in `ARCHITECTURE.md` section 17, with
  `docs/proposals/verification-containment.md` filed.
- Branch `step7` is unmerged and `master` is untouched.
- The build order stops at step 9. Do not build past it without an explicit
  decision.

**Next up:** decide whether to fix the step-6 implementer prompt (one or two
sentences in `buildImplementationAuthorPrompt`, `src/prompts.ts`) so Task 12
can finish, or retry the smoke as-is given the failure is nondeterministic.

## Diagnostics quick-reference

Durable one-liners are **mirrored into auto memory**, which loads every session
automatically — see `MEMORY.md` there for the full set (`verify-claims-when-written`,
`break-it-mechanics`, `break-it-direction`, `fixture-blindness`,
`one-smoke-is-one-sample`, `limits-need-their-own-ceiling`,
`windows-and-test-runner-quirks`, `line-endings-and-fixtures`,
`commit-and-shell-gotchas`, `approval-expiry-is-a-signing-window`). Kept here
are the ones that are specific to working *in this repository* rather than
general habits.

- **Prove a guard by breaking what it guards, one cycle per tool call.** Prefer
  a scratch mirror: the suite imports nothing outside `node:*` and `src/`, so a
  plain copy with no `node_modules` runs it and nothing needs restoring. Else
  `git add -A` (no commit) → break → run → `git checkout -- <path>` →
  `git diff --quiet -- <path>`; non-zero means halt.
- **A break-it target named in a plan is a hypothesis.** Confirm the attack
  reaches the guard at the shell first, and revise the target when it does not —
  two of step 7's twenty-four needed that, one unobservable as written and one
  that would have hung the suite for fifteen minutes at its real value.
- **A findings list is not a task list.** Two step-4 findings were one miscount
  seen at two boundaries; fixed separately they would have left the two sides
  inconsistent, which *is* the defect. Group by defect, not by report line.
- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText` reached the spec hash but not `validateSpecDoc`, which parses
  the same file. Likewise a guard must compare the way the filesystem compares:
  case-exact `touchesProtected` let a capitalized path evade it on Windows.
- **A documented workflow's shell, editor, and filesystem are part of the
  contract.** The signing tool signed bytes the gate could never recompute,
  because PowerShell 5.1's pipe adds a BOM and rewrites LF to CRLF. Put that
  layer inside the test.
- **A rolled-back audit insert does not break the hash chain** —
  `verifyAuditChain` recomputes from surviving rows. `Store.transaction` is
  re-entrant; a nested failure aborts the outermost frame, and silent partial
  commits are not possible.

## Session records

### Step 7: verification stage built, smoke blocked upstream (2026-08-30)

Tasks 1-11 of `docs/features/verification-stage/plan.md` implemented and
committed as `3be15fd` on branch `step7`; Task 12 outstanding, plan still
`Proposed`. Independent code review reconciled, 3 findings.

#### Decisions and assumptions

- **Committed to a branch, not master, deliberately.** A stage whose happy path
  has never executed is a partial pass; the commit message says so and the plan
  status reflects it.
- **`VERIFY_RETENTION_MAX_BYTES` = 64 MB** was added beyond the plan while
  reconciling a review finding. Chosen, not derived — operator may revise.
- **One shared `VERIFICATION` constant per test file**, not one across five: the
  plan's affected areas listed no test-support module and every test file here
  defines its own constants.

#### What failed

- **`bw new-run` could never create a run in a repository that had not
  gitignored `.governance/`** — `openStore()` creates the directory before the
  clean-tree check runs, so the invocation reported a tree only it had dirtied.
  Every test passed because the shared temp-root helper wrote the `.gitignore`
  first. Fixed: the check excludes `.governance/`, and a test now builds a
  repository with no `.gitignore` at all.
- **The evidence file had no ceiling.** Measured 5.97 GB in 5.2 s (~1.1 GB/s),
  roughly 955 GB inside the 900-second command ceiling. Fixed with a frozen
  retention ceiling; removing it again in a mirror retained 116 GB in 120 s.
- **Task 12 blocked in step 6, still open.** `bw implement` refused the
  implementer's own file writes. Step 6's smoke passed the identical prompt, so
  this is nondeterministic — see `docs/proposals/implementer-writes-files-it-also-proposes.md`.
- **I claimed step 6 had never been smoked. It had.** A `smoke` grep hit was
  assigned to the wrong entry without opening it; the record sat three lines
  above. Wrong claim reached a committed proposal, the plan note, and advice to
  the operator not to retry, before the next read caught it. All corrected.

#### What worked

- **A scratch mirror beats staged-git for break-it cycles here.** The suite
  imports nothing outside `node:*` and `src/`, so a plain copy with no
  `node_modules` runs it. 24 cycles, no risk to the tree, `diff -r` proving the
  restore.
- **TAP, not the default reporter, when detecting failures programmatically.**
  `✖` does not survive a Windows codepage round trip through Python's
  `subprocess`; the first pass reported 24 false passes. `--test-reporter=tap`
  gives ASCII `not ok`.
- **Two break-it cycles needed the plan's revision clause,** proving the clause
  earns its place: one target was unobservable as written (re-reading the same
  committed file yields the same config), one would have hung the suite for 15
  minutes at its real value.

#### Verification

- `npm run typecheck` / `npm test` (429 pass, 1 skip) / `npm run check:docs` — all clean.
- 24 break-restore cycles, each failing while broken, `diff -r` clean after.
- Smoke: 7 dispatches, **$0.5021**, `claude-sonnet-5` — spec 4, plan 2,
  implementer 1. Five stage rows passed on real handoffs before the block.
- `bw verify` against real state: refuses a blocked run by name, refuses an
  unknown run, exits 1; `verify-audit` reports chain valid.

#### Deferred and open

- Open: Task 12's three unproven behaviours, blocked on the step-6 prompt.
- Deferred: verification containment (proposal filed, no sandbox mechanism
  exists to reuse).

#### Next time

- Prior smokes here each drove **one stage**, with upstream constructed through
  the store. Use that pattern to iterate a prompt at ~$0.13 an attempt; reserve
  a full chain for the record.
- When a review finding is confirmed by measurement, record the measurement in
  the code comment — `VERIFY_RETENTION_MAX_BYTES` carries its 1 GB/s figure and
  the next reader never has to re-derive the ceiling.

#### Next up

- Decide the step-6 prompt fix, then finish Task 12 and advance the plan to
  `Implemented`.

### Step 7: planning (2026-08-30)

`write-plan` full path, 10 tasks; a self-review found 7 material issues and the
operator supplied 7 external review findings, all verified and accepted, taking
it to 12 tasks and 24 break-it targets. Decisions and rationale live in
`docs/features/verification-stage/plan.md` and in the shipped code; only the
pointers that settled questions are kept here.

**Architecture facts worth knowing before touching this area:**

- Section 12 names **"verification config"** among what the profile freezes, so
  hard rule 6 puts the read at run start — not an open choice. It also names
  bounded remediation rounds for `verification` *by name*, unlike
  implementation, where section 20's "per reviewed stage" wording let step 6
  decline them without contradiction.
- Section 4: **stage N's `output_ref` is literally what stage N+1 was handed** —
  which is why verification's is a JSON record, not a report.
- `ARCHITECTURE.md` had not changed since `14a7ea5` (step 2), so steps 3-6 all
  deferred section-12 requirements with plan-level assumptions alone. Step 7
  ended that: sections 12, 15, 17, and 20 now carry the deferrals and limits.

**Closed:** the three-orchestrator extraction question step 6 deferred here.
Verification has no author, panel, rounds, model, prompt, or `agent_run` row, so
the shape the three dispatching stages share is absent; an interface spanning
all four would have to make every one optional. Do not carry it to step 8.

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

### Build order steps 1-5 (2026-08-29)

- **Step 5 — plan stage and gate** (`83d88c0`). Mirrors the spec stage without
  extracting a shared abstraction (hard rule 4). **The approval's `expires_at`
  is a human signing window, not an authorization lifetime** — it bounds
  `approval-request` → sign → `approve`; re-checking it later would strand a run
  with no in-place repair. Smoke: six dispatches, **$0.63**, three remediation
  rounds — but **the plan stage's dispatches were the only spend**: the spec,
  chain, `spec.gate.pass` event, and approval were constructed through the
  store. Every smoke in this repo so far has driven one stage this way.
- **Step 4 — human approval gate.** `bw approve` verifies one Ed25519 signature
  and creates `awaiting_approval` only on success. A refusal costs nothing and
  is not terminal — unlike step 3, where every failure was terminal because
  money had already been spent. The profile carries `startingCommit` because
  section 15's `run` table has no column for one and `test/schema.test.ts`
  compares columns against `ARCHITECTURE.md`.
- **Step 3 — spec stage.** Enums the architecture left open: severity
  low/medium/high/critical, threshold `high`; disposition
  open/resolved/disputed/accepted; risk low/standard/high, panel sizes 1/2/3.
  Its smoke exposed two prompt defects fixtures could not — naming `baseCommit`
  in the author prompt made the model refuse without a git repo, and the
  reviewer returned a bare findings object until the prompt stated the full
  envelope shape. **Real smoke output must drive prompt iteration.**
- **Step 2 — harness adapter.** From the one recorded real envelope:
  `claude -p --output-format json` **does** report `total_cost_usd` (the
  architecture's `sessionCost: false` example was wrong); `modelUsage` can carry
  auxiliary queries, so the effective model is the unique entry whose
  `inputTokens` match `usage.input_tokens`, and no unique match records `null`.
  `invokeHarness` is async by necessity — timeout timers starve under a
  synchronous wait.
- **Step 1 — run store.** SQLite via `node:sqlite`, no runtime dependencies.
  Preserve: fail-closed `--gate-result`, transactional audit appends, lock
  ownership tokens. Migrations anchor to the module location, not cwd. The
  pid-reuse wedge carries a held-since diagnostic only — age-based takeover was
  rejected as unsafe.

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
