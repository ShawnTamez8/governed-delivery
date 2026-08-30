# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-08-30)

**Shipped:** build order steps 1-6. Step 6 — the implementation stage — is
Implemented (`docs/features/implementation-stage/plan.md`), smoke-passed
against the real harness, and independently reviewed
(`docs/features/implementation-stage/2026-08-30-code-review.md`, two low
findings, both closed — the dangling-link guard was added and break-proven;
this entry closes the record-keeping one). Suite 368 pass / 1 recorded skip,
`typecheck` clean, `check:docs` clean.

**The step-6 smoke:** one `claude-sonnet-5` dispatch, **$0.0673** (budgeted
0.068-0.156), 5.1s, valid patch set on the first attempt — the third stage
whose prompts worked unmodified on the first real attempt. Gate passed;
`gov/demo/1` carries the projections commit and the apply commit, both
authored `BuildWorks <buildworks@buildworks.invalid>`; the implementer's own
test passes in the worktree. Evidence at `%TEMP%\bw-smoke-6`.

**In flight:** nothing. Step 7 (verification) is the next build-order step
and has no plan yet.

**Open and deferred:**

- The verification trust anchor is `BW_APPROVAL_PUBLIC_KEY` at approve time and
  the recorded `signer` is compared to the fingerprint frozen at intake. Whoever
  can set that variable can still self-approve. Agents cannot: no `BW_*` in
  `envPassthrough`, no CLI in the allowlist, both asserted in
  `test/executor.test.ts`.
- The build order stops at step 9 — one complete run with queryable cost. Do not
  build past it without an explicit decision.
- `check:docs` warnings, pre-existing: the learnings file references the removed
  doc-consistency skill directory and the approval-gate plan references a
  placeholder src path. Offered to fix; not yet taken up.
- Whether the three stage orchestrators (spec/plan/implementation) should be
  extracted into a shared shape — the step-6 review's recommendation is to
  defer: the three differ in exactly the places a premature interface would
  guess at (panel vs none, rounds vs terminal refusal, document writes vs a
  worktree), and step 7's consumer is the evidence that would show what
  actually generalizes (hard rule 4 is satisfied either way; the duplication
  is named in code).

**Next up:** plan step 7 (verification).

## Diagnostics quick-reference

Durable one-liners that recur. Each cost at least one wasted cycle to learn.

- **Never write a backslash in a Bash tool command.** A doubled backslash
  arrives as a single one under *every* quoting form, including a heredoc with a
  quoted delimiter — the transport collapses it above the shell. Anchor edits on
  backslash-free text, build one with `chr(92)`, or write the script with the
  `Write` tool and run the file. `Write` preserves them exactly.
- **Break-it cycle:** `git add -A` (no commit, reversible) → break → run the
  test → `git checkout -- <path>` → `git diff --quiet -- <path>` to confirm.
  Non-zero means halt. **One cycle per tool call**; a chained sequence has
  nowhere to put the verify step. Prefer a scratchpad mirror when the code under
  test can run against a copy — nothing needs restoring.
- **A break-it test named in a plan is still a hypothesis.** Verify the
  direction of the attack at the shell before writing the test. A test written
  to fail that passes on first run is a defect in the test.
- **Verify an edit by re-reading the artifact, never by trusting the tool's
  success report.** A string replace can report success while the bytes it
  targeted survive.
- **`core.autocrlf=true` on this machine.** CRLF silently breaks
  substitution-based fixture assertions and the failure never names line
  endings. Check `git ls-files --eol` when a string test fails for no visible
  reason. `.gitattributes` pins ts/mjs/sql/json/md to `eol=lf`.
- **`npm test` runs files in parallel; a single-file pass is not evidence the
  suite passes.**
- **`open(p,"wb")` truncates before the read is evaluated** —
  `open(p,"wb").write(open(p,"rb").read())` zeroed a fixture.
- **Read the callee's signature rather than inferring it from its name.**
  `store.exec` (not `execute`); `verifyAuditChain` returns `null` for a valid
  chain, not `{ok: true}`.
- **Windows:** `taskkill` must run by full path (`SystemRoot\System32`) or the
  tree-kill is a silent no-op. A GNU `timeout`-killed run can look green because
  Node's exit teardown kills the hung child — the duration assertions in
  `test/harness.test.ts` exist to catch that.
- **Never commit a sweep without reading the full, untruncated inventory
  first.** `git add -A` swept a stray byte-identical duplicate of
  `ARCHITECTURE.md` (a restore-saga leftover) into a commit; only the commit
  output exposed it, and it had to be amended out. Inspect every staged file
  name; do not pipe `git status` through `head`.
- **PowerShell inline `node -e` quoting is unreliable under every form.**
  Escaped quotes inside the `-e` string get mangled by PowerShell before Node
  sees them. Write one-off query scripts with the `Write` tool and run the
  file.
- **Scaffolding that silently no-ops is more dangerous than a broken edit** —
  its results still look plausible. Check each step's own output for the thing
  it was supposed to do.

## Session records

### Step 6: implementation stage — implemented, smoke-passed (2026-08-30)

Nine tasks executed in order with every verification; the independent review
filed two low findings, both closed (the dangling-link guard added and
break-proven; the record-keeping this entry is).

**Smoke (the one real spend):** one `claude-sonnet-5` dispatch, **$0.0673**,
5.1s, 313 output tokens. Valid patch set on the first attempt — `add` patches
for both scope files with the handed `baseCommit` and whole-file content; the
gate applied and committed both; the worktree's own test passes. No prompt
defects — steps 3 and 5 recorded that fixtures cannot find prompt defects;
there was nothing to find here.

**Decisions this plan locked** (architecture-open choices):
`ProposedPatchFile.content` is the complete new file content (whole-file
write, no diff field added); scope matching is exact-or-`s/`-prefix string
comparison, case-preserving, with trailing slashes dropped on the entry (the
operator signs paths as declared — `touchesProtected` folds case, scope does
not); one commit per patch under the system identity (`BuildWorks
<buildworks@buildworks.invalid>` via `-c` flags); the projections (spec +
plan) are the run branch's first commit; one patch per file per dispatch —
enforced by the head-moved re-validation, not a separate counter.

**The three pre-planning decisions:** (1) the scope-fitness proposal flow is
deferred past step 9 — an out-of-scope patch refuses at apply time naming the
path, fresh run is the repair; (2) the run-duration ceiling landed with this
step (`RUN_DURATION_LIMIT_SECONDS` = 7 days, frozen in `Policy`, enforced at
stage entry; pre-existing dev runs refuse at the approval gate's policy
re-check by design); (3) `status.md` deferred past step 9.

**Three-orchestrator duplication:** still deliberate and named in code (hard
rule 4). Recommendation for step 7: do not extract yet — the three differ in
the places a premature interface would guess at, and step 7's consumer is the
evidence that shows what actually generalizes.

**Guards broken and restored (nine breaks, each observed failing exactly its
named test):** scope (`pathFitsScope` always-true, unit and stage level),
protected-path (unit and stage level), base-commit equality, head-moved
re-validation, empty-delivery, duration comparison, `isPathInside` backstop,
resolved-protected re-check, and — after the review's finding 1 — the
dangling-link guard.

**Deviations, each verified by the reviewer as sound:** break-it item (f)
targets the junction `escape-link` case because the lexical gate refuses
`../evil.ts` first (the backstop would never be exercised otherwise); the
planFor-variant test forges the approval's `spec_hash` rather than the gate
event's `planFor` — the plan's literal wording would have made the comparison
pass, and only the inversion reaches its stated goal; worktree log assertions
use a `base..HEAD` range because the branch history includes the base commit;
the file-symlink test skips on Windows without Developer Mode with a recorded
reason (the junction case is the always-run proof).

**Review finding 1 — the lesson:** a documented guarantee ("the refusal does
not depend on the target's existence") was false at a boundary the plan never
tested: `resolveExisting` walks with `existsSync` (stat semantics), so a
dangling link is invisible to it and resolves lexically. The fix refuses any
link component whose target cannot be resolved — refuse what cannot be
verified, rather than claim a resolution the filesystem cannot provide.
Constructible and break-proven on Windows via a junction whose target is
deleted after creation (junctions cannot be created dangling, but they can
become so).

### Step-5 manual smoke: passed end to end, real binary (2026-08-30)

The one real API spend for step 5, `claude` with `--model sonnet` (effective
`claude-sonnet-5` throughout, proxy-routed). Low-risk two-artifact spec: three
remediation rounds, six dispatches, **$0.63 total** (0.068-0.156 per dispatch,
8s-91s each); cost escalates per round as prompts grow with injected findings.

- **First stage whose prompts worked unmodified on the first real attempt** —
  the step-3 lessons (state the full envelope, keep patch concepts out of
  content-write prompts) held; the rounds were content-quality iteration.
- **Hazard 13 enforced by the reviewer, live:** a round-2 finding caught the
  plan author inventing a rejection requirement the spec never stated. The gate
  passed in round 3 with two **open medium findings** (one genuinely correct)
  because the threshold is `high` — passed by design, recorded as such.
- Reviewer findings drove real plan improvement: the final plan derives its test
  set from a single `DOCUMENTED_SHAPES` array with a non-emptiness guard, making
  the flagged cross-reference drift structurally impossible.
- Audit chain verified; all five stage rows passed; `configured_standalone`
  throughout. Cost expectation for a step-6 smoke: one dispatch, no panel —
  budget one step-5 single-dispatch cost (0.068-0.156).

### Skills: review-code added, doc-check rewritten (2026-08-29)

- `review-code` is a **global** skill (`~/.claude/skills/review-code/`) that
  reads a per-repository checklist at `.claude/review-code.md`. The split keeps
  one skill name working in every repo while the repo-specific rules stay
  versioned with the code they name. This repo's checklist carries the six hard
  rules, the hazard-to-code map, and the suppression list.
- `write-plan`, `implement-plan`, and `review-design` no longer hardcode
  `.claude/skills/doc-consistency/`. They discover a project documentation skill
  by what it does, so they find `doc-check` here.
- `scripts/doc-check.mjs` rewritten with tiers (current / reference /
  historical), `--json`, `--only=`, and **exit 2 when the checker itself cannot
  read the source**. The defect that motivated it: renaming an `ARCHITECTURE.md`
  section made the old checker report `governed.yaml is absent from the
  protected paths list` — a documentation defect that did not exist, against a
  document that was correct. **A checker that blames the wrong artifact is worse
  than no checker.**
- Historical-tier documents (`docs/features/**`, `.claude/sessions/**`) get
  warnings, never errors, on stale paths. They are evidence of what was believed
  when written; editing one to make it true destroys what the reconciliation
  depends on.
- Skill files load into context on every invocation, and `description` fields
  load in *every session*. Cut anything the tool's own output or error messages
  already say.

### Break-it runs: the backup mechanism and the backslash transport (2026-08-29)

Four break-it restores failed silently during the step-5 review reconciliation,
leaving four deliberate breaks stacked in the tree at once; the suite caught it
(306/311) and the tree was recovered by hand. Both causes were a step whose
success was assumed rather than checked — the quoting produced no backup and
said so; the restore failed and said so; neither was read because the command
was written to look for something else. The rules live in the quick-reference
above.

### Step-4 hardening: all twelve findings closed (2026-08-29)

`docs/features/approval-gate-hardening/plan.md` Implemented; 11 tasks, 18 steps.
Every fix was observed failing against the unfixed code first. The tests are in
the repo and searchable by name; the durable lessons:

- **A guard that reads ambient state can be silently un-exercised by fixture
  ordering.** `freezeProfile` reads `BW_APPROVAL_PUBLIC_KEY`, and the fixture
  set it *after* the call — every fixture froze `approvalSigner: null`, bound
  path untested, suite green, guard proving nothing. Reordering was not enough:
  the two bound-path tests now open with `assert.ok(f.frozenSigner)`, so
  restoring the original ordering fails on that line instead of passing
  vacuously. **When a new guard reads an env var, the cwd, or the clock, assert
  in the test that the fixture actually established it** — the reorder is
  invisible six months later, the assertion is not.
- **A findings list is not a task list.** Findings 3 and 9 were filed separately
  — "signed risk recomputed from disk" and "risk uses the raw artifact count
  while scope is deduplicated" — but they are one miscount seen at two
  boundaries. Planned as two tasks they would have been fixed on one side and
  left inconsistent on the other, which *is* the defect. Group by defect, not by
  where the reviewer noticed it.
- **Blast-radius claims must be grepped at the moment they are written.** Two
  first-draft claims came from memory and were wrong in their reasoning. Paste
  the grep with line numbers or do not make the claim.
- **A rolled-back audit insert does not break the hash chain.**
  `verifyAuditChain` recomputes from the surviving rows, so the vanished ones
  leave no gap. Worth knowing before wrapping another audit-writing operation in
  a transaction.
- `Store.transaction` re-entrancy: a nested failure sets an abort flag; the
  outermost frame rolls back and throws "transaction aborted by a nested
  failure". Silent partial commits are not possible.
- **A document describing control characters must not contain them.** A
  character class with literal NUL and 0x1f broke a Bash heredoc, then made
  `grep` treat the plan as binary.

### Step-4 review: three Windows defects, all measured (2026-08-29)

- **The signing tool signed bytes the gate could never recompute.** Measured on
  PowerShell 5.1: the documented pipe delivers the payload with a UTF-8 BOM and
  every LF rewritten to CRLF plus one trailing CRLF; the redirect route delivers
  two trailing CRLFs. `sign-approval.mjs` stripped one trailing newline and
  nothing else — the human gate was unusable on the default shell of a supported
  platform.
- **Where a documented workflow runs through a shell, an editor, or a
  filesystem, that layer is part of the contract and belongs inside the test.**
  Feeding `spawnSync`'s `input` byte-exact is a normalization: it bypasses the
  shell the operator types into.
- **A tolerance applied at one boundary and not its sibling is a defect.**
  `normalizeText` was applied to the spec hash but not to `validateSpecDoc`,
  which parses the same file. When a tolerance is added, find every reader of
  the same bytes.
- **A guard must compare the way the filesystem compares.** Case-exact
  `touchesProtected` let a capitalized path evade it on Windows/macOS; the guard
  now folds case, `computeScope` deliberately does not (the operator signs the
  paths as declared). Also in `.claude/review-code.md`.
- **Breaking the guard caught my own mistake, not just the original one.** A
  bulk `.exec(content)` → `.exec(text)` replacement also hit a private helper
  whose parameter is separately named `content`; the break-test caught it first
  and cheaper.

### Build order steps 1-5 (2026-08-29)

**Step 5 — plan stage and gate** (`83d88c0`). `plan` / `plan_review` mirrors the
spec stage structurally without extracting a shared abstraction; hard rule 4
forbids the interface until two real implementations exist, and the duplication
is named and deferred rather than silent. The review found six defects, four
accepted: an unverified profile hash at three call sites, review-panel models
never resolved from their own map entry, a coverage gate that never checked
every acceptance criterion was covered, and `--model` with no value becoming a
frozen-map mismatch instead of a usage error. **The approval's `expires_at` is a
human signing window, not an authorization lifetime** — it bounds
`approval-request` → sign → `approve`, and re-checking it at a later stage would
strand a run with no in-place repair. Default lifetime is now
`APPROVAL_DEFAULT_LIFETIME_SECONDS` (8h) in `src/policy.ts`, frozen per run.

**Step 4 — human approval gate.** `bw approval-request` prints the canonical
payload; `bw approve` verifies one Ed25519 signature and records the `approval`
row, creating `awaiting_approval` only on success. The gate dispatches nothing,
so a refusal costs nothing and is *not* terminal — unlike step 3, where every
failure was terminal because money had already been spent. The profile is frozen
at `new-run` and carries the starting commit, because section 15's `run` table
has no column for one and `test/schema.test.ts` compares columns against
ARCHITECTURE.md — a column would have meant editing the design.

**Step 3 — spec stage.** Two chained rows: author → AgentResult validation →
content write, then panel → findings → deterministic gate → closure rounds.
Every failure path is terminal. The panel's re-review resolves findings; the
author's claim never does. Enums (architecture left them open): severity
low/medium/high/critical with materiality threshold `high`; disposition
open/resolved/disputed/accepted; risk low/standard/high with panel sizes 1/2/3.
**The manual smoke was the highest-value spend yet** — it exposed two prompt
defects fixtures could not: mentioning `baseCommit` in the author prompt made
the model refuse to produce a spec without a git repo (patch rules do not belong
in a content-write prompt), and the reviewer returned a bare findings object
until the prompt stated the full envelope shape with every field. **Real smoke
output must drive prompt iteration; fixtures cannot.** The smoke also produced
the designed terminal state: blocked after 3 rounds, naming the open finding
ids. Fail closed, as designed.

**Step 2 — harness adapter.** `bw dispatch` end to end against the real `claude`
binary. Failure paths retain raw output and audit the attempt but insert no
`agent_run` row. From the one recorded real envelope
(`test/fixtures/harness/claude-code-envelope.json`): `claude -p --output-format
json` **does** report `total_cost_usd` (the architecture's `sessionCost: false`
example was wrong); `modelUsage` can carry auxiliary queries alongside the real
turn, so the effective model is the unique entry whose `inputTokens` match
`usage.input_tokens`, and no unique match records `null`. `invokeHarness` is
async by necessity — timeout timers starve under any synchronous wait.

**Step 1 — run store.** Stage chain and audit chain over SQLite (`node:sqlite`,
no runtime dependencies), the `bw` CLI, the repository lock, and the
documentation checker. One review reconciled, 15 findings. Rules to preserve:
fail-closed `--gate-result`, transactional audit appends, lock ownership tokens.
Migrations anchor to the module location, not cwd. The pid-reuse wedge is
mitigated with a held-since diagnostic only — age-based takeover was rejected as
unsafe.

### Locked design decisions (2026-08-29)

Architecture reconciled against `2026-08-28-architecture-review.md`, all 14
findings applied (`f68347c`).

- System name is a configuration value, default **BuildWorks**.
- Internal paths stay fixed and non-configurable: `.governance/`,
  `gov/<slug>/<run-id>`, `governed.yaml`. Configurability was rejected on the
  `.gitignore` pairing, state references, findability, and hard rule 4.
- Remediation rounds default 3 (counting closure passes), frozen in the profile.
- Panel size is configuration per risk level; defaults 2 at standard, 1 at low.
- Approval is an Ed25519 signature by the operator, verified against a public
  key in machine-local configuration.
- A patch binds to the head in effect when proposed; apply-time re-validation
  refuses only if head moved in paths it touches.
- Harness language: TypeScript on Node, per operator decision.
- No `docs/hazards.md` entry for the CRLF fixture breakage: that document
  records failures that have occurred in delivery, and entries 1 and 12 already
  cover the class. Latent fragilities do not earn an entry.

### Step-6 plan: implementation stage (2026-08-30)

### Decisions and assumptions

- The step-6 plan is complete at `docs/features/implementation-stage/plan.md`
  (write-plan, full path; one self-review pass, 5 findings; Status Proposed;
  `check:docs` clean). The 6-9 scope review found the build order already lean —
  no new human gates, no review panels, one new agent — and its three open
  decisions are resolved as the plan's first three assumptions: (1) scope-fitness
  proposal flow deferred past step 9 — an out-of-scope patch refuses with a
  named message and a fresh run; (2) the run-duration ceiling lands with step 6
  — `RUN_DURATION_LIMIT_SECONDS` = 7 days, frozen in `Policy` (policyHash moves;
  pre-existing dev runs refuse at the approval gate by design); (3) `status.md`
  deferred past step 9.
- Architecture-open choices the plan locks: `ProposedPatchFile.content` is the
  complete new file content (whole-file write — the shipped type has no diff
  field); one commit per patch under a system git identity (`SYSTEM_NAME
  <buildworks@buildworks.invalid>`); the projections (spec + plan) committed to
  the run branch as its first commit (section 7's "commits everything it
  writes"); scope matching is string-based exact-or-`s/`-prefix, case-preserving;
  no remediation rounds (implementation is unreviewed — refusal is terminal, the
  worktree is retained); harness `cwd` = worktree; `output_ref` = worktree path.

### What failed

- Draft gap 1 — spec drift: my "transitive binding" note claimed an unchanged
  plan implies an unchanged spec. It does not: `spec.md` is a separate mutable
  file the stage reads, commits to the run branch, and feeds the implementer.
  The operator's review caught it; fix in the plan compares
  `sha256Hex(normalizeText(specContent))` against `approval.spec_hash` **and**
  the gate event's `planFor` before the stage row or worktree exists. Lesson: a
  binding argument must name the file it covers.
- Draft gap 2 — symlink redirect: lexical `touchesProtected` plus the
  `isPathInside` containment check both pass for a junction `src/alias` →
  `src/agents/`, and the write follows the link. Fix in the plan: re-run
  `touchesProtected` on the `resolveExisting`-resolved target, ordered before
  the existence checks. The repo already recorded this class twice —
  `src/scope.ts`'s own comment and the review-code break-it note — and I had not
  consulted them when writing the gate. Both findings have named tests in the
  plan: a spec-edited no-spend case plus a forged-`planFor` variant, and
  junction/file-symlink cases with a recorded skip when the OS refuses file
  symlinks.

### What worked

- Grounding every cited line before writing paid off twice: the plan names
  `test/profile.test.ts:157`/`:170` as the two pins that must move with the
  model map (the four-entry `deepEqual` and the `"implementation"` unmapped
  example), and `test/prompts.test.ts:20-22` as the comment reserving the patch
  rules for this step. `dispatchOnce` already spreads `input.invocation`, so the
  harness `cwd` extension needs no dispatch change.

### Verification

- `npm run check:docs` - exit 0 clean after reconciliation; historical-tier
  path warnings only. No code changed — plan-only session, so typecheck/tests
  were not run.

### Deferred and open

- Deferred: `status.md` projection and the scope-fitness proposal flow — past
  step 9, per the plan's assumptions.
- Open: whether the three orchestrators get a shared shape — the plan leaves
  extraction to a later step that has all three in hand.

*(This record's "next time" pointers were executed: the plan is implemented,
smoke-passed, and reviewed — see the step-6 implementation record above.)*
