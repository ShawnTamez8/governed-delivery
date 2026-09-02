# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

## Current state (2026-09-02)

**Shipped:** build order steps 1-7 and step 5b Tasks 1 through 6, on `master`,
the only local branch. Task 6 is **uncommitted** in the working tree. Verified
at that tree: `npm test` 601 tests / 600 pass / 1 recorded skip / 0 fail; `npm
run typecheck` clean; `npm run check:docs` exit 0. Read the
head with `git log -1` and the unpushed set with `git log origin/master..master`
— neither is written here, because a record naming the commit that contains it
invalidates itself on the next amend, and the previous version of this block
was wrong on both by the time it was read.

**The binding architecture changed** in `60587fc` under operator acceptance,
amending `ARCHITECTURE.md` sections 8, 9, 12, 13, and 20: the five-phase
author-led review flow replaces the closure pass, the author proposes a panel
the system staffs and refuses by name, completion is decision completeness
rather than a severity threshold, canonical identity is round-scoped with every
reviewer report immutable, the panel floor and default are two reviewers, and
one review round is the default. Sections 5, 15's schema block, 23, and
`STAGE_SEQUENCE` are unchanged. The document states its own limits: an exact
match proves textual occurrence, not logical support, and hashes plus document
gates do not prove a concern was semantically cured.

**In flight — step 5b, Tasks 7-13 open.** Task 7 (canonical finding,
reviewer-report, and reconciliation storage) is next, from
`docs/features/step5b-upstream-findings/plan.md`. Task 6 shipped the
reconciliation contract: `src/reconciliation.ts` (reviewer reports + decisions
+ grounding + normative accounting), the specialty-only reviewer prompts with
classification, both reconciliation prompts, the
`spec-reconciliation` / `plan-reconciliation` capabilities, and both stages
running panel → reconciliation → gate once per legacy pass with before/after
hashes on `spec.reconcile.record` / `plan.reconcile.record`. Its completion
record carries the refusal/convert boundary, the changed-locations deviation,
and the mixed-pair identity constraint (below).

**The round-activation boundary is still the thing to know before touching a
stage.** `specReviewRounds` and `planReviewRounds` are frozen into every profile
and **deliberately not read by either stage**. A configured round means one
complete `panel -> reconcile` cycle, and no gate reads decisions until Task 9;
wiring the values into the legacy loop would make one configured round mean
one panel and zero reconciliations. Both stages carry an explicitly named
`LEGACY_CLOSURE_PASSES = 3` until Task 9 removes it and activates the frozen
values in the same change. `panelSizeMin`, `panelSizeMax`, `requiredSpecialties`
and `materialityThreshold` *are* read from the frozen profile today. The
reconciliation dispatch exists now, but the legacy severity gate still decides
the run; blocking on `cannot_determine` / `upstream_blocking` and the audited
`unclaimed=` count are Task 9's.

**Two latent defects in shipped code** remain, both Task 7: `insertFinding`'s
return on the upsert conflict path, and whole-file schema constraint searching.
Each has an auto-memory file with line numbers and reproduction.

**Open and deferred:**

- `src/policy.ts` names `assertStaffable` in the `PANEL_SIZE_*` doc comment; the
  function is `staffingShortfall`. Pre-existing, left alone in Task 5 rather
  than folded into an unrelated diff. One-word fix whenever that file is next
  edited for its own reasons.
- `docs/features/step6-trust-boundary/plan.md` names
  `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` in four
  places, including "committed as the evidence record". That file was never
  written. Historical tier, so `check:docs` only warns; the gap is real and
  undecided.
- Whether step 5b or step 8 (delivery check) goes first was never explicitly
  decided. Six 5b tasks have now shipped ahead of it by practice; step 8
  remains the next *build-order* step.
- `C:\Users\Shawn-work\repositories\step5b-task1-prototype` — the retained Task
  1 prototype bundle, 441 KB, confirmed present 2026-09-02. Outside the
  repository, uncommitted, no process attached.
- `VERIFY_RETENTION_MAX_BYTES` is 64 MB — chosen, not derived.
- Filesystem and network containment for verification commands is unbuilt,
  stated as a limitation in `ARCHITECTURE.md` section 17, with
  `docs/proposals/verification-containment.md` filed.
- External configuration of the `.governance` location, and the state migration
  it implies, are deferred out of step 5b by operator decision.
- The build order stops at step 9. Do not build past it without an explicit
  decision.

**Next up:** start step 5b Task 7 (canonical finding, reviewer-report, and
reconciliation storage) from `docs/features/step5b-upstream-findings/plan.md`.
Task 7 does NOT construct the one-canonical-two-mixed-report storage row —
operator decision, 2026-09-02 (review 2, finding 1): that state is
unreachable through the production report contract, and hand-constructing it
would violate hazard 4. Task 7 proves instead the three cases named in its
step 3 — see the Task 6 session record.

## Diagnostics quick-reference

The durable one-liners live in **auto memory**, which loads automatically —
read `MEMORY.md` there rather than duplicating it here. It carries the
whitespace-collapsing citation match, the unstable `intentKey`, frozen review
defaults, dispatch cost, break-it mechanics, line endings, whole-file guards,
the source-scanning trap, duplicated-stage coverage, the discriminating-
configuration rule, and prompt bounds deriving from the validator — each with
its reasoning and reproduction.

One line memory does not yet carry:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, and PowerShell's BOM each caused one here.

## Session records

### Step 5b Task 6: reconciliation contract and prompt (2026-09-02)

Uncommitted in the working tree. `src/reconciliation.ts` (the plan names no
new module; Task 4 set the precedent), both reviewer prompts rewritten to the
specialty-only boundary with classification and the classification-dependent
location syntax, both reconciliation prompts, the reconciliation capabilities
on both authors, and both stages running panel → reconciliation → gate once
per legacy pass with `specHashBefore`/`specHashAfter` on
`spec.reconcile.record` / `plan.reconcile.record`. Reviews:
`docs/features/step5b-upstream-findings/2026-09-02-task6-code-review.md` and
`2026-09-02-task6-code-review-2.md` (reconciled 2026-09-02: 4 accepted, 0
rejected, 0 deferred, 0 open). No dispatch was paid for.

- **The refusal/convert boundary.** Structure errors (missing/misplaced
  fields, unknown dispositions, extra/duplicate/missing decisions) refuse by
  name; content failures (unmatched grounding, extra/duplicated/unmatched
  normative claims) rewrite the decision to `cannot_determine`, drop the
  conditional fields, append a bracketed note to the retained rationale, and
  record the conversion. That is the line the plan's step 6 and step 7 leave
  implicit. `changedLocations` is required on every decision though the Task 1
  prototype never returned one.
- **One reconciliation per legacy pass, even a clean one** — the reconciler is
  the actor that confirms an empty findings set. The legacy severity gate still
  decides the run; blocking on `cannot_determine` / `upstream_blocking` and the
  audited `unclaimed=` count are Task 9's.
- **The mixed pair cannot share one canonical identity through the report
  flow — operator decision, not an inference.** Review 2 (finding 1) ruled:
  keep the accepted `(round, intentKey, location)` identity; deduplication
  requires the same location, so a mixed-classification pair is always two
  canonical findings with two decisions, both reports reaching the same
  reconciliation dispatch unfused. Task 7 must NOT construct a
  one-canonical-two-mixed-report row — that state is unreachable through the
  production report contract and would violate hazard 4. It proves instead:
  same intent+location with differing severity → one finding, two immutable
  reports; mixed classifications → two findings, two decisions; no stored
  value combines fields from different reports. Amended `ARCHITECTURE.md`
  section 13 and the plan (Task 6 step 10, assumption 46, Task 7 step 3, and
  the Task 6 completion record). In auto memory.
- **The review found two defects in the layer that turns the contract into
  model behaviour, and both were reproduced before acceptance.** (1) Both
  reconcile prompts advertised a fixed example `"findingId": 1` — refused
  whenever the round's canonical ids do not include 1; the example is now
  derived from the round's own findings. (2) The base fixtures gave every
  decision the same normative claim, so the happy path silently carried a
  converted decision no test observed; the fixtures claim once and only when
  they revise, and both happy paths assert zero conversions and zero
  unclaimed nodes. Both fixes proven by reintroducing each defect.
- **A held break-it mutation was an attack defect, not a coverage gap:** the
  whole-file prompt scan cannot catch a sentence removed from one of two
  prompts while the other keeps its copy — the per-prompt tests caught it, and
  removing the sentence from both made the scan fail. Five scratch anchors
  silently no-matched when the fixtures gained the `(id, index)` map and the
  `revising` condition — the silent-no-match class again.
- **Review 2 found four findings; all four are accepted, three mechanical and
  proven by reintroduction.** (1) The mixed pair — operator decision, above.
  (2) The validator refused extras on some objects but silently dropped
  unknown members on others; `unknownMember` now refuses an unknown field by
  name at every model-returned level (reports, decisions, grounding, nested
  grounding, normative-change entries, proposals — `impact` special-cased so
  it still reaches its derived-from-disposition refusal). (3) The decisions
  example each reconcile prompt advertises is now the round's complete
  envelope — one entry per canonical id, empty array when none — so a copied
  array validates, not just its first id. (4) The contract now states the
  conditional-field matrix: grounding only on `rejected_with_rationale`,
  normativeChanges only on `addressed`, proposal only on
  `upstream_follow_up`/`upstream_blocking`, no field a disposition does not
  list. Each guard loosened in a scratch mirror (dirty tree — no
  checkout-restores), its mapped test failed, and the restore hashed
  byte-identical to the working tree.
- **Verified:** typecheck clean; `npm test` 601/600/1/0; `check:docs` exit 0.
  Thirty-six break-and-restore mutations, each detected by its mapped test and
  restored byte-identical by hash.

### Step 5b Task 5: author-proposed panel, deterministic staffing (2026-09-02)

`bacec0a`. `validatePanelRequest` in `src/select.ts`, `requestedSpecialties` on
`selectReviewers` and `staffingShortfall`; both stages validate the request and
refuse an unstaffable panel by name before dispatching. Review:
`2026-09-02-task5-code-review.md`. No dispatch was paid for.

- **The prompts were brought into scope though the task's file list omits them**,
  operator asked first: the default installation's legal size is exactly two,
  so a prompt that stated neither bound would have made the named refusal the
  ordinary outcome of a correct run.
- **`staffingShortfall` was extended, not duplicated** — one question asked at
  two moments is one function, and a near-copy is a place for one rule to go
  missing. **Requested lenses seat in ranked order**, so the panel array is
  order-independent.
- **Two of fourteen break-it mutations held, and both were real coverage gaps,
  not defective attacks** — the stage tests had picked configurations where the
  old rule and the requested size agree numerically (auto memory:
  `discriminating-configuration`). A comment in one test *claimed* a companion
  test distinguished the rules; it did not — a stated justification is not a
  proof.
- **The prompt brought into scope to state a bound stated the wrong bound**: it
  advertised `panelSizeMin`, but required lenses consume seats, and the example
  envelope's hardcoded `"size": 2` repeated the error in the value a model
  copies (auto memory: `prompt-bounds-derive-from-validator`).
- **Choose the configuration where the old rule and the new rule disagree.**
  Equal expected values under both is fixture blindness in a new costume. Treat
  a held break-it mutation as a coverage gap until the attack is proven
  defective.

### Step 5b Task 4: self-critique contract and prompt (2026-09-02)

`578d0eb`. `src/self-critique.ts` (one shape, both artifacts), both
self-critique prompts, one self-critique dispatch per artifact on the author's
stage row before `completeStage`. No dispatch was paid for.

- **Revision A was implemented although Task 4's step list never absorbed it.**
  Nobody rewrote the steps when the operator accepted the prototype result, so
  read a task's governing exit decision, not only its checkboxes.
- **A capability refusal must sit beside the dispatch it guards**, not before a
  draft that could never complete the stage — configuration failures fail before
  paid invocations.
- **Making the fixture echo what the prompt actually contained** is how a
  stage-level test can see a prompt: it scrapes a block out of stdin and answers
  with what it found, so an omission surfaces as `none-listed` in the record.
- Two of eleven break-it mutations held and both were attack defects; Task 5's
  held mutations were real gaps — a held mutation proves nothing by itself.

### Step 5b Tasks 2 and 3: paths module, frozen review config (2026-09-01 to 2026-09-02)

`cd11071` (Task 2, `src/paths.ts`) and `5d63726` (Task 3). Route A — a profile
violating the current policy shape is refused by name in `loadVerifiedProfile`,
no migration, no defaults — was the operator's decision.

- **A task that says "read X from the frozen profile" and also defines what X
  means is two instructions.** Task 3's first instruction wired the configured
  round counts into the legacy loop, making one configured round mean one panel
  and zero reconciliation dispatches; reversed behind `LEGACY_CLOSURE_PASSES = 3`.
  A configuration rename that changes what a run does is the signal only one
  instruction was followed.
- **Tracing the profile consumers settled the decision better than reasoning
  about it did:** no stage read panel size or rounds from the profile at all.

### Step 5b Task 1: prototype run, architecture amended (2026-09-01)

`60587fc`. Twelve real dispatches on `claude-sonnet-5`, **$0.59543**, 430 s,
**zero parse failures**, scratch storage outside production stage order. Cost
overran the $0.25-0.45 estimate. Evidence in
`docs/features/step5b-upstream-findings/2026-09-01-task1-prototype-evidence.md`.

- **Amend every section a design change falsifies, not only the ones named** —
  the operator amended sections 8, 9, 12, 13, and 20.
- **`addressed` admitted an invented obligation.** The author added an acceptance
  criterion the design never states and the artifact gate passed; the operator
  directed normative-delta grounding in response, with the case retained as
  Task 11's regression.
- **A scratch `.mjs` harness can import the repo's `.ts` modules** via
  `await import(pathToFileURL(...).href)` under Node 24 type stripping.
- **State what a deterministic check proves, in the document that describes it.**
  Every overstatement caught was a textual or mechanical check described as
  semantic verification.

### Step 5b: plan reviews and reconciliations (2026-08-31 to 2026-09-01)

Four review records against the plan, all reconciled. Review 2 superseded the
design direction, so the plan was rewritten in place to 13 tasks; review 3
audited the `Reconciled` claim and found five nominally closed contracts that
were not executable.

- **A reconciliation stamp is a claim, not evidence.** Trace the promised result
  through prompt input, parser, storage, and gate before calling a finding
  closed.
- **A review that supersedes a design direction is reconciled by rewriting the
  document, not by patching its findings in.**
- **Ask the operator the questions a review leaves open before rewriting.**

### Step 7: verification stage and smoke (2026-08-30 to 2026-08-31)

Task 12 smoke: a passing run ($0.07618, 5 dispatches), a blocking run ($0.06595,
5 dispatches), and a tool-inventory probe ($0.01116) returning exactly
`Glob/Grep/Read`.

- **`bw new-run` could never create a run in a repository that had not gitignored
  `.governance/`** — `openStore()` creates the directory before the clean-tree
  check; every test passed because the shared temp-root helper wrote the
  `.gitignore` first.
- **A genuine plan-coverage block:** the model dropped `(traces to: …)` suffixes
  when restating criteria. The gate was right; the prompt was not softened.
- A fresh `new-run` refuses a tree dirtied by a blocked run's projections, so
  commit or clean between runs. Driving one stage with upstream built through the
  store costs about $0.13 an attempt for prompt iteration.

### Step 6: implementation stage — shipped (2026-08-30)

Nine tasks, `32a714e`. Smoke: one dispatch, **$0.0673**, valid patch set first
try.

- **A documented guarantee was false at a boundary the plan never tested:**
  `resolveExisting` walks with `existsSync`, so a dangling link resolves
  lexically. **Refuse what cannot be verified rather than claim a resolution the
  filesystem cannot provide**, and consult the repo's own records first.

### Build order steps 1-5 (2026-08-29)

- **Step 5 — plan stage and gate** (`83d88c0`) mirrors the spec stage without
  extracting a shared abstraction (hard rule 4). Smoke: six dispatches, **$0.63**;
  a round-2 finding caught the plan inventing a rejection requirement the spec
  never stated — the observation behind hazard 16.
- **Step 4 — human approval gate.** The profile carries `startingCommit` because
  section 15's `run` table has no column for one.
- **Step 3 — spec stage.** Naming `baseCommit` in the author prompt made the
  model refuse without a git repo, and the reviewer returned a bare findings
  object until the prompt stated the full envelope. **Real smoke output must
  drive prompt iteration.**
- **Step 2 — harness adapter.** `claude -p --output-format json` **does** report
  `total_cost_usd`, and `modelUsage` can carry auxiliary queries, so the
  effective model is the unique entry whose `inputTokens` match
  `usage.input_tokens`.
- **Step 1 — run store.** Migrations anchor to the module location, not cwd.

### Skills and tooling (2026-08-29)

- `scripts/doc-check.mjs` exits 2 **when the checker itself cannot read the
  source** — a checker that blames the wrong artifact is worse than no checker.
- Historical-tier documents (`docs/features/**`, `.claude/sessions/**`) get
  warnings, never errors; `docs/proposals/` errors. Path warnings for files a
  plan is about to create are expected; do not chase them to zero.
- No `docs/hazards.md` entry for the CRLF fixture breakage: entries 1 and 12
  already cover the class. Latent fragilities do not earn an entry.
