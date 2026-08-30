# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-08-30)

**Shipped:** build order steps 1-5, all committed. Latest `83d88c0` (step 5:
plan stage and gate). The step-5 manual smoke is complete and recorded in
Session records — `docs/features/plan-stage/plan.md` is *Implemented*. Suite 322
pass, `typecheck` clean, `check:docs` clean.

**Open and deferred:**

- `modelMap` freezes four of section 5's eight stage kinds. Step 6 must extend
  it with `implementation`; a run created before that cannot dispatch the stage
  and fails at configuration time. Deferred deliberately — see the step-5 code
  review's reconciliation.
- The verification trust anchor is `BW_APPROVAL_PUBLIC_KEY` at approve time and
  the recorded `signer` is compared to the fingerprint frozen at intake. Whoever
  can set that variable can still self-approve. Agents cannot: no `BW_*` in
  `envPassthrough`, no CLI in the allowlist, both asserted in
  `test/executor.test.ts`.
- The build order stops at step 9 — one complete run with queryable cost. Do not
  build past it without an explicit decision.

**Next up:** build order step 6 (implementation on a branch, patch bound to base
commit, scope enforced), which also extends `modelMap`.

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

## Session records

### Step-5 manual smoke: passed end to end, real binary (2026-08-30)

The one real API spend for step 5, run per the plan against `claude` with
`--model sonnet` (effective `claude-sonnet-5` on every dispatch, proxy-routed).
A low-risk two-artifact spec: **three remediation rounds, six dispatches, $0.63
total** — 0.068 / 0.069 / 0.109 / 0.098 / 0.129 / 0.156 per dispatch. Cost
escalates per round: prompts grow with the injected findings and the documents
under review (8s to 91s per invocation, 542 to 8634 output tokens).

- **First stage whose prompts worked unmodified on the first real attempt.** No
  prompt-shape defect at all — the step-3 lessons (state the full envelope, keep
  patch concepts out of content-write prompts) held. The three rounds were
  content-quality iteration, not shape repair.
- **Hazard 13 enforced against the plan by the reviewer, live.** A round-2
  finding caught the plan author inventing a rejection requirement the spec
  never stated; the revision removed it. The materiality threshold also showed
  its designed shape: the gate passed in round 3 with two **open medium
  findings** (one — an untested `require.main` branch in the plan's own tasks —
  genuinely correct) because the threshold is `high`. Passed by design,
  recorded as such.
- Reviewer findings drove real plan improvement: the final plan derives its test
  set from a single `DOCUMENTED_SHAPES` array with a non-emptiness guard, so the
  cross-reference drift the reviewer flagged is structurally impossible.
- Audit chain verified; all five stage rows passed; `independence` recorded as
  `configured_standalone` on every dispatch. `DEP0190` (shell argv
  concatenation) appeared once — the known Windows spawn behaviour, now
  input-guarded by model-name validation.
- Cost expectation for step 6 planning: a low-risk plan stage is ~$0.60 with
  closure rounds; each extra round costs more than the last.

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
leaving four deliberate breaks stacked in the tree at once. The suite caught it
(306/311); the tree was recovered by hand. Two causes, both now rules in the
quick-reference above.

The restore was `shutil.copy2` from a scratchpad copy the failed quoting had
never created. Each restore raised `FileNotFoundError`, printed a traceback, and
was ignored — the whole sequence ran as one chained command whose output was
filtered with `grep "^✖"` to find failing tests. `git checkout` had looked
unusable because the work was uncommitted; staging makes it restore from the
index, which is exactly right.

**The general pattern — the reason this entry survives its own fix:** both
causes are *a step whose success was assumed rather than checked*. The quoting
produced no backup and said so; the restore failed and said so. Neither was read
because the command was written to look for something else. Scaffolding that
silently no-ops is more dangerous than a broken edit, because the test results
it produces still look plausible.

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
  two trailing CRLFs, because the file keeps its own newline and PowerShell
  appends another. `sign-approval.mjs` stripped one trailing newline and nothing
  else. The human gate was unusable on the default shell of a supported
  platform.
- **A test that normalizes its input hides the defect it exists to catch** — and
  the step-4 statement of that lesson was scoped too narrowly.
  `test/sign-approval.test.ts` normalized nothing and still missed this, because
  feeding `spawnSync`'s `input` byte-exact *is* a normalization: it bypasses the
  shell the operator types into. **Where a documented workflow runs through a
  shell, an editor, or a filesystem, that layer is part of the contract and
  belongs inside the test.**
- **A tolerance applied at one boundary and not its sibling is a defect.**
  `normalizeText` was applied to the spec hash but not to `validateSpecDoc`,
  which parses the same file, so a BOM-saving editor blocked approval reporting
  a missing `feature:` field that was plainly present. When a tolerance is
  added, find every reader of the same bytes.
- **A guard must compare the way the filesystem compares.** `touchesProtected`
  matched case-exactly, so on Windows and macOS a capitalized path evaded it and
  took risk from `standard` to `low` — a two-reviewer panel down to one. The
  guard now folds case; `computeScope` deliberately does not, because the
  operator signs the paths as declared.
- **Breaking the guard caught my own mistake, not just the original one.** A
  bulk `.exec(content)` → `.exec(text)` replacement also hit a private helper
  whose parameter is separately named `content`. The full suite would have
  caught it; the break-test caught it first and cheaper.

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
