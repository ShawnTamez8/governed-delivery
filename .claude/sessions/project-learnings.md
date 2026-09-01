# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-08-31)

**Shipped:** build order steps 1-7 on `master`, head `84b75e1`. The last four
commits are documentation only — external-harness review records under
`docs/proposals/`, then the step-5b plan and its two reviews; the last code
commit is the step-7 merge `5b93ddb`. The tree was green at that merge — 446
tests / 445 pass / 1 recorded skip / 0 fail, `typecheck` clean, `check:docs`
clean — and nothing since has touched `src/` or `test/`.

**In flight — step 5b, planned, committed at `84b75e1`.**
`docs/features/step5b-upstream-findings/` holds `plan.md` (`Status:
Reconciled`, 13 tasks) and two review records reconciled into it on
2026-08-31. The plan replaces the closure-round review loop with an author-led
flow — draft, one self-critique, a specialist panel, author reconciliation,
deterministic gate — and routes an upstream concern to a stored proposal
instead of another author round. Nothing is implemented. Task 1 is a bounded prototype whose exit decision confirms or
revises Tasks 4-9, so no schema or stage work starts before it runs.

**Three latent defects in shipped code** were confirmed while reconciling those
reviews. They are unfixed, recorded in the plan, and described in the
diagnostics quick-reference below: `insertFinding`'s return on the upsert
conflict path, whole-file schema constraint searching, and a frozen policy that
describes values the live constants actually decide.

**Open and deferred:**

- Step 5b's 13 tasks are all open, starting at the Task 1 prototype gate.
- Whether step 5b or step 8 (delivery check) goes first was not decided. Step 8
  remains the next build-order step and consumes the record the verification
  stage writes.
- `VERIFY_RETENTION_MAX_BYTES` is 64 MB — chosen, not derived. Frozen per run
  either way.
- Filesystem and network containment for verification commands is unbuilt,
  stated as a limitation in `ARCHITECTURE.md` section 17, with
  `docs/proposals/verification-containment.md` filed.
- External configuration of the `.governance` location, and the state migration
  it implies, are deferred out of step 5b by operator decision.
- The build order stops at step 9. Do not build past it without an explicit
  decision.

**Next up:** run Task 1's bounded prototype from
`docs/features/step5b-upstream-findings/plan.md`.

## Diagnostics quick-reference

Durable one-liners are **mirrored into auto memory**, which loads every session
automatically — see `MEMORY.md` there for the full set. Kept here are the ones
specific to working *in this repository*.

- **`insertFinding` returns the wrong row after a conflict.** `src/store.ts:389`
  returns `getFinding(lastInsertRowid)`, and SQLite does not update
  `last_insert_rowid()` for `ON CONFLICT ... DO UPDATE`, so it returns whichever
  row the previous insert created. Harmless today only because both stages
  discard the return value. A two-insert test passes by coincidence — use three.
- **Schema constraint guards search every migration file as one string.**
  `test/schema.test.ts:102-120` and `scripts/doc-check.mjs:243-334` assert with
  `sql.includes(...)` over the concatenation, so a later migration that rebuilds
  a table can drop its constraints and every gate stays green. Scope to the
  table body the way `test/schema.test.ts:98` does.
- **The frozen profile describes values the live constants decide.**
  `buildPolicy()` records `PANEL_SIZE` and `REMEDIATION_ROUNDS`, but
  `src/select.ts`, `src/spec-stage.ts`, and `src/plan-stage.ts` all import the
  live constants. Hard rule 6 is satisfied in the profile and not at the read.
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
- **Exit codes through pipelines lie.** `cmd | grep ...; echo $?` reports grep's
  status, not the stage's. Measure a stage's exit code without the pipe.

## Session records

### Step 5b: two plan reviews reconciled, plan rewritten (2026-08-31)

Two review files against `docs/features/step5b-upstream-findings/plan.md`.
Review 2 superseded the plan's design direction rather than correcting it, so
the plan was rewritten in place to 13 tasks instead of patched. Both reviews
were kept unchanged and stamped with per-finding dispositions: 22 accepted on
review 1, 12 on review 2, none rejected, deferred, or open.

#### Decisions and assumptions

- **The review loop becomes author-led:** draft, one self-critique, a
  specialist panel, author reconciliation, deterministic gate. Completion stops
  meaning "reviewers returned an empty list" and starts meaning "every finding
  carries a retained typed decision and the mechanical gates pass".
- **`rejected_with_rationale` advances at any severity**; only
  `upstream_blocking` and `cannot_determine` block. Consequence named in the
  plan: severity stops gating review, which leaves `MATERIAL_THRESHOLD` with no
  consumer and changes the frozen policy shape and the profile hash.
- **The author proposes panel size (2 to a configured maximum defaulting to 2)
  and the specialties; deterministic code selects the identities**, excludes the
  author, and blocks by name when the request cannot be staffed. This replaces
  per-risk panel sizes, contradicting the 2026-08-29 locked decision and
  architecture section 12, which the plan amends rather than leaving in conflict.
- **An upstream concern becomes a stored proposal** with evidence under
  `.governance/`; materializing it into `docs/proposals/` is a human command,
  because a run writing there writes outside the signed scope.
- **`.governance` gets one internal path module** and stays fixed and
  unconfigurable in this step. The literal currently appears in nine production
  path constructions across seven modules.
- **The plan carries `Status: Reconciled`** on operator instruction — a third
  value in a repository that used only `Proposed` and `Implemented`.
  `scripts/doc-check.mjs` does not pin plan statuses, so nothing breaks.

#### What worked

- Grounding every review claim in the code before dispositioning it. Three of
  review 1's findings were confirmed defects in shipped code, and one of its
  citations was wrong: the invented-obligation record lives in
  `docs/features/plan-stage/plan.md`'s smoke evidence, not in this file.

#### Verification

- `npm run check:docs` — exit 0, `doc-check: clean`. The four `src/paths.ts`
  warnings are the expected kind for a file a task is about to create.

#### Next time

- A review that supersedes a design direction is reconciled by rewriting the
  document, not by patching its findings in. The second review's dispositions
  of the first review's findings are the map for what survives the rewrite.
- Ask the operator the questions the review leaves open before rewriting. Four
  decisions here — blocking policy, panel model, proposal persistence, rewrite
  scope — each changed the shape of several tasks, and inventing any of them
  would have produced a plan that had to be rewritten twice.

### Step 7: smoke completed; step 6 correction shipped (2026-08-31)

Step 6's trust-boundary correction shipped on `master`, then step 7 rebased
onto it and the Task 12 smoke ran: one passing run ($0.07618, 5 dispatches),
one blocking run ($0.06595, 5 dispatches), plus a tool-inventory probe
($0.01116, returning exactly `Glob/Grep/Read` under the read-only invocation).
Both plans `Implemented`.

What the smoke added beyond the fixture suite:

- **The passing run's implementer did not write files.** The nondeterministic
  step-6 write-then-propose failure did not recur under the corrected
  invocation. One green run is still one sample; the fixture suite breaking each
  guard is what carries the proof.
- **A genuine plan-coverage block, for real.** The model dropped
  `(traces to: …)` suffixes when restating criteria and `coverageMeetsCriteria`
  held the full text, so the gate blocked and it cost a run. The gate was right;
  the prompt was deliberately not softened to make it pass.
- **The env guarantee held.** `set` under the verify runner retained only the
  eight named passthrough variables plus cmd's defaults; a canary exported to
  `bw verify` never reached the child.
- A fresh `new-run` refuses a tree dirtied by a blocked run's projections —
  commit or clean before the next run. CRLF normalization of a committed
  `governed.yaml` is harmless (the parser splits on `\r?\n`), but git's next
  touch rewrites the working copy, so never expect committed bytes on disk.

### Step 7: verification stage built (2026-08-30)

Twelve tasks, `3be15fd` on branch `step7`, later merged. Independent code
review reconciled, 3 findings. Suite green at 429 pass / 1 skip; smoke 7
dispatches, **$0.5021**, `claude-sonnet-5`.

- **`bw new-run` could never create a run in a repository that had not
  gitignored `.governance/`** — `openStore()` creates the directory before the
  clean-tree check, so the invocation reported a tree only it had dirtied. Every
  test passed because the shared temp-root helper wrote the `.gitignore` first.
  Fixed; a test now builds a repository with no `.gitignore` at all.
- **The evidence file had no ceiling.** Measured 5.97 GB in 5.2 s (~1.1 GB/s),
  roughly 955 GB inside the 900-second command ceiling. Fixed with
  `VERIFY_RETENTION_MAX_BYTES`, which carries that measurement in its comment so
  the next reader never re-derives it.
- **Architecture facts worth knowing before touching this area:** section 12
  names "verification config" among what the profile freezes, so hard rule 6
  puts the read at run start; section 4 means stage N's `output_ref` is
  literally what stage N+1 was handed, which is why verification's is a JSON
  record rather than a report.
- **Closed:** the three-orchestrator extraction question step 6 deferred here.
  Verification has no author, panel, rounds, model, prompt, or `agent_run` row,
  so the shape the three dispatching stages share is absent. Do not carry it to
  step 8.
- **Next time:** prior smokes here each drove **one stage**, with upstream
  constructed through the store — roughly $0.13 an attempt for prompt
  iteration. Reserve a full chain for the record.

### Step 6: implementation stage — shipped (2026-08-30)

Nine tasks, `32a714e`; two low review findings, both closed. Smoke: one
dispatch, **$0.0673**, valid patch set on the first attempt.

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
lexically. **Refuse what cannot be verified rather than claim a resolution the
filesystem cannot provide.** Constructible on Windows via a junction whose
target is deleted after creation.

**Two draft-gap lessons:** a binding argument must name the file it covers (an
unchanged plan does not imply an unchanged spec, so the stage re-verifies both);
and consult the repo's own records before writing a link-redirect gate — the
symlink class was already recorded twice and missed both times.

### Build order steps 1-5 (2026-08-29)

- **Step 5 — plan stage and gate** (`83d88c0`). Mirrors the spec stage without
  extracting a shared abstraction (hard rule 4). **The approval's `expires_at`
  is a human signing window, not an authorization lifetime** — it bounds
  `approval-request` → sign → `approve`; re-checking it later would strand a run
  with no in-place repair. Smoke: six dispatches, **$0.63**, three remediation
  rounds, and a round-2 finding caught the plan inventing a rejection
  requirement the spec never stated — the recorded observation behind step 5b's
  hazard 16.
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
findings applied (`f68347c`). These describe shipped behaviour; where step 5b's
plan changes one, it says so and amends the architecture in the same task.

- System name is a configuration value, default **BuildWorks**.
- Internal paths stay fixed and non-configurable: `.governance/`,
  `gov/<slug>/<run-id>`, `governed.yaml`.
- Remediation rounds default 3 (counting closure passes), frozen in the profile.
  Step 5b's plan replaces this with per-stage round counts defaulting to 1.
- Panel size is configuration per risk level; defaults 2 at standard, 1 at low.
  Step 5b's plan replaces this with an author-proposed size inside frozen
  bounds of 2 to 5.
- Approval is an Ed25519 signature verified against a public key in
  machine-local configuration.
- A patch binds to the head in effect when proposed; apply-time re-validation
  refuses only if head moved in paths it touches.
- Harness language: TypeScript on Node, per operator decision.
- No `docs/hazards.md` entry for the CRLF fixture breakage: that document
  records failures that have occurred in delivery, and entries 1 and 12 already
  cover the class. Latent fragilities do not earn an entry.
