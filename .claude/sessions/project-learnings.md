# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-01)

**Shipped:** build order steps 1-7 and step 5b Task 1, on `master`, head
`60587fc`, tree clean, **not pushed** to `origin`. The last code commit is
still the step-7 merge `5b93ddb` — nothing since has touched `src/` or
`test/`, so the last measured suite state stands: 446 tests / 445 pass / 1
recorded skip / 0 fail. `check:docs` is clean (0 errors, 40 warnings).

**The binding architecture changed.** `60587fc` amended `ARCHITECTURE.md`
sections 8, 9, 12, 13, and 20 under operator acceptance: the five-phase
author-led review flow replaces the closure pass, the author proposes a panel
the system staffs and refuses by name, completion is decision completeness
rather than a severity threshold, canonical identity is round-scoped with every
reviewer report immutable, the panel floor and default are two reviewers, and
one review round is the default. Section 5, `STAGE_SEQUENCE`, section 15's
schema block, and section 23 are unchanged. Both limits are stated in the
document itself: an exact match proves textual occurrence, not logical support,
and hashes plus document gates do not prove a concern was semantically cured.

**In flight — step 5b, Tasks 2-13 open, nothing implemented.** Task 1's
prototype ran and its exit decision is recorded in
`docs/features/step5b-upstream-findings/plan.md` and
`docs/features/step5b-upstream-findings/2026-09-01-task1-prototype-evidence.md`.
It confirmed the contracts and forced five revisions to Tasks 4-10, all already
written into the plan. Task 2 (governance path module, no dependencies) and
Task 3 (review configuration in the frozen policy, now unblocked) are next; the
plan runs 2 before 3.

**Three latent defects in shipped code** remain unfixed: `insertFinding`'s
return on the upsert conflict path, whole-file schema constraint searching, and
a frozen policy that describes values the live constants actually decide. Each
has its own auto-memory file with the line numbers and the reproduction. Task 3
fixes the third, Task 7 the first two.

**Open and deferred:**

- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record". That file was never
  written. Historical tier, so `check:docs` only warns; the gap in the step-6
  record is real and undecided.
- Whether step 5b or step 8 (delivery check) goes first was never decided. Step
  8 remains the next build-order step.
- `VERIFY_RETENTION_MAX_BYTES` is 64 MB — chosen, not derived.
- Filesystem and network containment for verification commands is unbuilt,
  stated as a limitation in `ARCHITECTURE.md` section 17, with
  `docs/proposals/verification-containment.md` filed.
- External configuration of the `.governance` location, and the state migration
  it implies, are deferred out of step 5b by operator decision.
- The build order stops at step 9. Do not build past it without an explicit
  decision.

**Next up:** start step 5b Task 2 (`src/paths.ts`, the single governance-path
module) from `docs/features/step5b-upstream-findings/plan.md`.

## Diagnostics quick-reference

Durable one-liners are **mirrored into auto memory**, which loads every session
automatically — see `MEMORY.md` there for the full set. Kept here are the ones
specific to working *in this repository*.

- **An exact-match citation check must collapse whitespace, not only BOM and
  CRLF.** Every governing document here is hard-wrapped at ~78 columns, so a
  correct quotation spanning a line break fails `normalizeText`-only matching.
  Measured: a sound rejection became `cannot_determine` for that reason alone.
  Collapse runs of whitespace on both sides; the guarantee is unchanged.
- **`intentKey` is model-authored and unstable across rounds.** A reviewer
  restating the same concern in a later round supplied a different key at the
  same location, so identity deduplicates wording within a round and cannot
  detect semantic recurrence. Never build behaviour that assumes it does.
- **Review defaults are code constants, not operator input.** `governed.yaml`
  accepts only a `verify:` block (`src/governed-config.ts:91`) and `new-run`
  has no panel or round flag. Panel size and round counts live in
  `src/policy.ts` and reach a run through `buildPolicy()` and the frozen
  profile. "Configuration" in this repo means that, not a prompt.
- **A large-context dispatch costs about three times a reviewer dispatch.**
  Reviewer dispatches ran $0.02-0.04; self-critique and reconciliation, which
  carry the design plus the full artifact plus every per-reviewer report, ran
  $0.07-0.09. Budget from the prompt's contents, not from a per-dispatch average.
- **A break-it mutation that crashes the checker looks exactly like a guard
  that held** — both report zero failing checks, and an uncaught throw exits 1
  just as a real failure does. Require the run's summary line to be present
  before trusting "no check failed", and prefer a mutation that *loosens* the
  guard over one that deletes a null check and throws.
- **A findings list is not a task list.** Two step-4 findings were one miscount
  seen at two boundaries; fixed separately they would have left the two sides
  inconsistent, which *is* the defect. Group by defect, not by report line.
- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText` reached the spec hash but not `validateSpecDoc`, which parses
  the same file. Likewise a guard must compare the way the filesystem compares:
  case-exact `touchesProtected` let a capitalized path evade it on Windows.
- **A documented workflow's shell, editor, and filesystem are part of the
  contract.** The signing tool signed bytes the gate could never recompute,
  because PowerShell 5.1's pipe adds a BOM and rewrites LF to CRLF.
- **A rolled-back audit insert does not break the hash chain** —
  `verifyAuditChain` recomputes from surviving rows. `Store.transaction` is
  re-entrant; a nested failure aborts the outermost frame.
- **Exit codes through pipelines lie.** `cmd | tail; echo $?` reports tail's
  status, not the command's. This recurs — measure exit codes without the pipe.

## Session records

### Step 5b Task 1: prototype run, architecture amended (2026-09-01)

Commit `60587fc` on `master`. Twelve real dispatches on `claude-sonnet-5`,
**$0.59543**, 430 s, **zero parse failures**, driven against the shipped
dispatch boundary in scratch storage outside production stage order. Nothing
under `src/` or `test/` changed.

#### Decisions and assumptions

- **The operator accepted the authority boundary and its residual semantic
  limit**, and amended sections 8, 9, 12, 13, and 20 in one commit rather than
  only 12 and 13 — the sections-12/13-only change would have left section 8
  claiming cross-round deduplication works and section 9 claiming per-risk panel
  sizes. Amend every section a design change falsifies, not only the ones named.
- **The ungrounded `addressed` decision was not accepted as residual risk.** The
  operator directed normative-delta grounding: deterministic code set-diffs the
  parsed artifact before and after reconciliation, and every added normative node
  must be claimed by exactly one `addressed` decision and grounded in the
  governing input. Binding on Tasks 6, 9, 10, and 11.
- **Panel floor and default are two reviewers**; the one-reviewer low-risk tier
  is deferred, not deleted. Two is the panel size, never a round count.
- **One review round by default**, configurable higher, no closure pass. No
  verification round limit is in force because no loop exists.

#### What failed

- **`addressed` admitted an invented obligation.** Answering a TOCTOU finding,
  the author added an atomic exclusive-create acceptance criterion the design
  never states, and the artifact gate passed. The no-invention prompt sentence
  did not prevent it and no mechanical check detects it. Fixed at the plan level
  by normative-delta grounding; the retained case is Task 11's regression.
- **A correct citation failed the grounding match** (quick-reference above).
  Re-evaluating the *same stored model output* under the corrected matcher
  turned both probe rejections into matches with no further spend.
- **Three of eighteen break-it mutations did not detect their break.** Two were
  unrealistic (they threw instead of loosening the guard); one was a real defect
  in the prototype — `mergeCanonical` deduplicated within a single call, so
  dropping `round` from the identity changed nothing observable.
- **Cost overran the estimate**, $0.60 against $0.25-0.45.

#### What worked

- **Importing the repo's `.ts` modules into a scratch `.mjs` harness** via
  `await import(pathToFileURL(...).href)` under Node 24 type stripping. This is
  how the prototype used the real executor, harness, parser, and validators
  without touching production or duplicating them.
- **Splicing an amendment by line range on a copy, then `diff -U3`**, instead of
  editing the binding document directly. It produced an exact reviewable diff
  and made the invariant checks (headings identical, sections 5/23 byte-equal,
  no new overlong lines) mechanical before anything was applied.
- **Not naming the reviewer registry in the self-critique prompt on the first
  attempt.** It measured what the author asks for unprompted — an unstaffable
  `data-privacy` lens — which is the evidence Task 4 needs. Told the registry,
  the same author requested `security` and staffed.

#### Running state

- `C:\Users\Shawn-work\repositories\step5b-task1-prototype` — the retained
  prototype bundle: harness, prompts, all 12 prompts and raw responses, derived
  state, 441 KB. Outside the repository, uncommitted, no process attached.

#### Verification

- `npm run check:docs` — exit 0, `doc-check: clean`, 40 warnings.
- `node validators.check.mjs` in the prototype bundle — 58/58 checks as expected.
- `node break.mjs` in the prototype bundle — 19/19 guards proven by breaking them.
- `npm test` and `npm run typecheck` were **not** run: no source changed.

#### Deferred and open

- Open: report pairs (two reviewers on one canonical finding) were never
  observed in real output — 9 findings, 9 reports, no pairs. Tasks 6 and 7 must
  keep proving pair preservation by fixture.
- Open: `master` is not pushed to `origin`, and local branches `step5b-task1`
  (identical to master) and `step7` still exist.

#### Next time

- **State what a deterministic check proves, in the document that describes
  it.** Every overstatement caught this session was a textual or mechanical
  check described as semantic verification.
- **A checker's own error can be someone else's stale citation.** The one
  `check:docs` error was a dangling path reference inside a proposal, not a
  check to remove. Fix the reference; do not weaken a scan that is tracking
  40 other paths.
- **Measure the thing the prompt does not say.** Withholding one input on the
  first attempt turned a guess about model behaviour into evidence.

### Step 5b: plan reviews and reconciliations (2026-08-31 to 2026-09-01)

Four review records against `docs/features/step5b-upstream-findings/plan.md`,
all reconciled and retained unchanged with per-finding dispositions. Review 2
superseded the plan's design direction, so the plan was rewritten in place to 13
tasks instead of patched; review 3 then audited the `Reconciled` claim and found
five nominally closed contracts that were not executable. The design decisions
those reviews settled now live in `ARCHITECTURE.md`, not only in the plan.

#### Next time

- **A reconciliation stamp is a claim, not evidence.** Trace the promised result
  through prompt input, parser, storage, and gate before calling a finding
  closed. `check:docs` intentionally validates neither that chain nor `Status`.
- **A review that supersedes a design direction is reconciled by rewriting the
  document, not by patching its findings in.** The later review's dispositions
  of the earlier review's findings are the map for what survives.
- **Ask the operator the questions a review leaves open before rewriting.** Four
  decisions here each changed the shape of several tasks; inventing any would
  have produced a plan rewritten twice.

### Step 7: verification stage and smoke (2026-08-30 to 2026-08-31)

Twelve tasks, merged to `master`; suite green at 429 pass / 1 skip. Step 6's
trust-boundary correction shipped first, then the Task 12 smoke ran: a passing
run ($0.07618, 5 dispatches), a blocking run ($0.06595, 5 dispatches), and a
tool-inventory probe ($0.01116) returning exactly `Glob/Grep/Read`.

- **`bw new-run` could never create a run in a repository that had not
  gitignored `.governance/`** — `openStore()` creates the directory before the
  clean-tree check, so the invocation reported a tree only it had dirtied. Every
  test passed because the shared temp-root helper wrote the `.gitignore` first.
- **The evidence file had no ceiling.** Measured 5.97 GB in 5.2 s (~1.1 GB/s),
  roughly 955 GB inside the 900-second command ceiling. Fixed with
  `VERIFY_RETENTION_MAX_BYTES`, whose comment carries that measurement.
- **A genuine plan-coverage block, for real.** The model dropped
  `(traces to: …)` suffixes when restating criteria and `coverageMeetsCriteria`
  held the full text. The gate was right; the prompt was not softened to pass.
- **Closed:** the three-orchestrator extraction question. Verification has no
  author, panel, rounds, model, prompt, or `agent_run` row, so the shape the
  three dispatching stages share is absent. Do not carry it to step 8.
- A fresh `new-run` refuses a tree dirtied by a blocked run's projections.
  Commit or clean between runs. Never expect committed bytes on disk: git's next
  touch rewrites CRLF in the working copy.
- **Reserve a full chain for the record.** Prior smokes drove one stage with
  upstream constructed through the store — about $0.13 an attempt for prompt
  iteration.

### Step 6: implementation stage — shipped (2026-08-30)

Nine tasks, `32a714e`. Smoke: one dispatch, **$0.0673**, valid patch set first try.

**Decisions locked:** `ProposedPatchFile.content` is the complete new file
content (no diff field); scope matching is exact-or-`s/`-prefix, case-preserving
(`touchesProtected` folds case, scope does not); one commit per patch under
`BuildWorks <buildworks@buildworks.invalid>` via `-c` flags; the projections are
the run branch's first commit; one patch per file per dispatch, enforced by the
head-moved re-validation. `RUN_DURATION_LIMIT_SECONDS` (7 days) landed here.

**The review's lesson:** a documented guarantee ("the refusal does not depend on
the target's existence") was false at a boundary the plan never tested —
`resolveExisting` walks with `existsSync`, so a dangling link resolves
lexically. **Refuse what cannot be verified rather than claim a resolution the
filesystem cannot provide.** Constructible on Windows via a junction whose
target is deleted after creation. Also: a binding argument must name the file it
covers, and consult the repo's own records before writing a gate — the symlink
class was already recorded twice and missed both times.

### Build order steps 1-5 (2026-08-29)

- **Step 5 — plan stage and gate** (`83d88c0`). Mirrors the spec stage without
  extracting a shared abstraction (hard rule 4). **The approval's `expires_at`
  is a human signing window, not an authorization lifetime** — it bounds
  `approval-request` → sign → `approve`; re-checking it later would strand a run
  with no in-place repair. Smoke: six dispatches, **$0.63**, and a round-2
  finding caught the plan inventing a rejection requirement the spec never
  stated — the recorded observation behind step 5b's hazard 16.
- **Step 4 — human approval gate.** `bw approve` verifies one Ed25519 signature
  and creates `awaiting_approval` only on success. A refusal costs nothing and
  is not terminal — unlike step 3, where every failure was terminal because
  money had already been spent. The profile carries `startingCommit` because
  section 15's `run` table has no column for one.
- **Step 3 — spec stage.** Its smoke exposed two prompt defects fixtures could
  not: naming `baseCommit` in the author prompt made the model refuse without a
  git repo, and the reviewer returned a bare findings object until the prompt
  stated the full envelope shape. **Real smoke output must drive prompt
  iteration.**
- **Step 2 — harness adapter.** From the one recorded real envelope:
  `claude -p --output-format json` **does** report `total_cost_usd` (the
  architecture's `sessionCost: false` example was wrong); `modelUsage` can carry
  auxiliary queries, so the effective model is the unique entry whose
  `inputTokens` match `usage.input_tokens`. `invokeHarness` is async by
  necessity — timeout timers starve under a synchronous wait.
- **Step 1 — run store.** SQLite via `node:sqlite`, no runtime dependencies.
  Migrations anchor to the module location, not cwd. The pid-reuse wedge carries
  a held-since diagnostic only — age-based takeover was rejected as unsafe.

### Skills and tooling (2026-08-29)

- `scripts/doc-check.mjs` has tiers (current / reference / historical),
  `--json`, `--only=`, and **exit 2 when the checker itself cannot read the
  source** — the motivating defect was a renamed `ARCHITECTURE.md` section
  making the old checker report a documentation defect that did not exist. **A
  checker that blames the wrong artifact is worse than no checker.**
- Historical-tier documents (`docs/features/**`, `.claude/sessions/**`) get
  warnings, never errors; `docs/proposals/` errors. Path warnings for files a
  plan is about to create are expected; do not chase them to zero.
- `review-code` is a global skill reading `.claude/review-code.md`. The doc
  skills discover the project documentation skill by what it does, so they find
  `doc-check` here.

### Locked design decisions (2026-08-29, amended 2026-09-01)

Architecture reconciled against `2026-08-28-architecture-review.md`, all 14
findings applied (`f68347c`). Lines marked **amended** were superseded by
`60587fc`; the rest still describe shipped behaviour.

- System name is a configuration value, default **BuildWorks**.
- Internal paths stay fixed and non-configurable: `.governance/`,
  `gov/<slug>/<run-id>`, `governed.yaml`.
- **Amended:** remediation rounds defaulted to 3 counting closure passes; the
  review stages now default to one round with no closure pass.
- **Amended:** panel size was configuration per risk level, 2 at standard and 1
  at low; it is now author-proposed inside frozen bounds with a floor and
  default of 2, and risk no longer sizes the panel.
- Approval is an Ed25519 signature verified against a public key in
  machine-local configuration.
- A patch binds to the head in effect when proposed; apply-time re-validation
  refuses only if head moved in paths it touches.
- Harness language: TypeScript on Node, per operator decision.
- No `docs/hazards.md` entry for the CRLF fixture breakage: that document
  records failures that have occurred in delivery, and entries 1 and 12 already
  cover the class. Latent fragilities do not earn an entry.
