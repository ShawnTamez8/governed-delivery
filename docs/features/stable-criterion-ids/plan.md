# Stable criterion IDs implementation plan

**Status:** Implemented (2026-09-04 — the Known blockers below were cleared: zero-failure full suite 694 pass/0 fail/1 pre-existing skip; two completed paid scratch runs, `stats` and `web-calculator`, provided the real plan-stage evidence; the operator accepted the in-session code review in place of the cloud standalone review)

**Goal:** Replace prose-based plan coverage identity with exact, spec-minted criterion IDs and enforce a one-to-one bidirectional mapping before every plan review dispatch.

**Source:** `docs/features/stable-criterion-ids/design.md`, reconciled against `docs/features/stable-criterion-ids/2026-09-03-design-review.md`; failure evidence in `.claude/sessions/2026-09-03-debug-plan-coverage-gate-paraphrase-mismatch.md`; prior disposition in `docs/proposals/spec-kit-harness-review.md`.

**Assumptions:** None. The design explicitly chooses one replacement document schema, no compatibility parser, exact ID comparison, and no deterministic claim about pre-approval semantic continuity or criterion-level finding lineage.

**Approach:** Change the parsed specification and plan contracts first, make the pure gate expose all identity defects, then carry the new types through prompts, stages, reconciliation, and recorded-shape fixtures. Update the binding architecture only after source behavior is exercised. Finish with break-and-restore proof, a disposable-checkout full gate, and a real paid scratch run using the calculator failure class.

**Affected areas:** Specification and plan Markdown parsing; `SpecDoc` and `CoverageEntry`; plan coverage and scope gates; all spec- and plan-emitting prompts; spec, approval, and plan stage diagnostics; reconciliation normative nodes; harness fixtures and document literals across integration tests; architecture and current-status documentation.

**Known blockers:** The isolated full suite's first run had one transient Windows `EPERM` during hung-command test cleanup; its targeted rerun passed, but the plan still requires a zero-failure completion run. The authorized paid calculator chain stopped before planning when the spec self-critique fenced its JSON, so the required real plan envelope is unavailable and hazard 7 requires fresh authorization before a materially different paid attempt. The standalone review command was not launched: managed security requires explicit approval to upload the disposable source diff to Anthropic's cloud reviewer.

**Blast radius:** Verified repository searches show `validateSpecDoc` is consumed by `src/spec-stage.ts`, `src/approval-stage.ts`, `src/plan-stage.ts`, and `src/reconciliation.ts`; `PlanDoc`, `CoverageEntry`, and `coverageMeetsCriteria` are consumed by `src/plan-stage.ts`, `src/plan-gate.ts`, and `src/reconciliation.ts`. `src/plan-stage.ts` runs the coverage check after the author draft, self-critique, and reconciliation. Parsed specification or plan literals occur in `test/approval-stage.test.ts`, `test/cli.test.ts`, `test/delivery-stage.test.ts`, `test/implementation-stage.test.ts`, `test/plan-doc.test.ts`, `test/plan-stage.test.ts`, `test/prompts.test.ts`, `test/reconciliation.test.ts`, `test/spec-doc.test.ts`, `test/spec-stage.test.ts`, and both stage-emitter fixtures. `src/implementation-stage.ts` hashes and forwards already-gated spec and plan content without parsing it, so an old run already past plan review needs no compatibility parser. No SQL migration, approval payload, scope representation, delivery contract, or finding table changes.

**Verification:** Baseline on 2026-09-03: strict typecheck clean; 182 focused parser, gate, prompt, reconciliation, spec-stage, and plan-stage tests pass. Each task runs its named focused tests. The final gate runs typecheck, the full suite, and `npm run check:docs` from a disposable checkout, proves each new guard by breaking and restoring it there, runs the free scratch smoke, then runs one explicitly authorized paid scratch chain whose design reproduces markdown and parenthetical criteria. The paid evidence must reach `plan_review`, retain the raw envelope, report cost, and pass `verify-audit`.

**Hazards considered:** 1 (changed model-output shapes need accepted and rejected parser cases), 2 (retain the paid run's raw envelope before parsing), 3 (state the canonical ID constraint in every emitting prompt), 4 (derive fixtures from prompt/schema and prove guards by breaking them), 6 (preserve exact signed-scope coverage checks), 7 (do not retry an unchanged paid failure), 8 (use the Windows-aware scratch driver), 13 (only the spec mints obligations), 14 (record the eventual review's actual independence), 16 (the plan never invents an upstream criterion), and 17 (do not claim this feature authorizes or grounds criterion deletion).

## Implementation evidence (2026-09-03)

Tasks 1 through 4 are implemented in the working tree. The parser-first red
run failed 18 new assertions before source changes; the resulting parser and
pure-gate slice passed 47 tests. After migrating all consumers, the prompt,
reconciliation, and plan-stage slice passes 99 tests; the combined spec- and
plan-stage slice passes 94; CLI and implementation pass 94 with the one
pre-existing Windows symlink skip; and delivery passes 23. `npm run typecheck`
and `git diff --check` are clean. `npm run check:docs -- --json` reports zero
errors, the same 39 historical path warnings, and no warning in this feature
directory.

Task 5 is in progress in an authorized disposable checkout. All six specified
break-and-restore mutations failed their focused assertion and returned green
after restoration; the free BuildWorks smoke passed 12/12. The first full
suite run reported 692 passes, one pre-existing Windows symlink skip, and one
`EPERM` during hung-command temporary-directory cleanup; that exact test passed
when rerun in isolation, but this is not yet the required zero-failure full
gate. The authorized 13-criterion calculator chain spent $0.0877614 and blocked
at spec self-critique because the model fenced its otherwise valid JSON. Its
first draft minted `AC-001` through `AC-013`, but no plan dispatch or replayable
plan envelope exists. `real-run-evidence.md` records the retained paths and the
no-retry disposition. The independent review snapshot is ready in the
disposable clone, but no bytes were uploaded because managed security requires
separate approval for the Anthropic cloud destination. The plan remains
Proposed until the unresolved completion evidence is satisfied or explicitly
deferred.

---

### Task 1: Replace prose identity in the pure document and gate contracts

**Depends on:** None

**Files:**

- Modify: `src/spec-doc.ts` — `SpecDoc`, acceptance-criterion parsing, and exported ID contract
- Modify: `src/plan-doc.ts` — `CoverageEntry` and Coverage parsing
- Modify: `src/plan-gate.ts` — `coverageMeetsCriteria` and `coverageFitsScope`
- Modify: `test/spec-doc.test.ts`
- Modify: `test/plan-doc.test.ts`
- Modify: `test/plan-gate.test.ts`

**Steps:**

1. Add regression cases before implementation.
   - Specify accepted IDs at `AC-001`, `AC-010`, `AC-999`, and `AC-1000`; refuse `AC-000`, lowercase, short, extra-zero, missing-ID, duplicate-ID, and empty-text forms with the offending value or line in the reason.
   - Specify plan parsing as `<criterion-id> -> <target>`, retaining the existing last-arrow and last-` / ` target parsing while refusing prose or malformed IDs on the left.
   - Specify gate results as `{ ok: false, missing, unknown, duplicate }`, with each array de-duplicated in first-observed order. Cover the original markdown and parenthetical case by giving the spec rich prose and the plan only its ID.
   - Run `node --test test/spec-doc.test.ts test/plan-doc.test.ts test/plan-gate.test.ts` before source changes and record the expected failures.
2. Replace `SpecDoc.acceptanceCriteria: string[]` with an exported `AcceptanceCriterion` shape containing `id` and `text`. Export one canonical criterion-ID predicate or regular expression and use it in the parser; do not duplicate the grammar in the plan parser.
   - Extend only the failure variant with `obsoleteCriterionShape?: true`. Set it when a non-empty acceptance-criterion line uses the retired prose-only form; omit it for missing sections, duplicate IDs, empty text, and malformed attempted IDs. Existing human-readable `reason` remains the primary diagnostic, and consumers never infer the condition by matching that text.
3. Rename `CoverageEntry.criterion` to `criterionId`. Parse only canonical IDs on the left side, but leave duplicate valid IDs for the spec-aware gate so it can report duplicates together with missing and unknown IDs.
4. Rework `coverageMeetsCriteria` to compare exact IDs from `AcceptanceCriterion[]` in both directions and to report missing, unknown, and duplicate IDs in one result. Remove case, whitespace, markdown, and prose normalization from identity. Keep `coverageFitsScope`'s exact path behavior unchanged and report its offenders by `criterionId`.
5. Re-run the three focused test files. Record the expected compile-time failures in the not-yet-migrated `src/plan-stage.ts` and `src/reconciliation.ts`; the first required green `npm run typecheck` moves to Task 3, where every consumer of the exported shapes has changed.

**Task completion evidence:** The original rich-prose case passes by ID; missing, unknown, and duplicate cases fail distinctly; malformed document shapes fail by name; scope and `not_applicable` behavior stays green; typecheck failures are limited to the downstream consumers explicitly assigned to Tasks 2 and 3.

### Task 2: Enforce the new contract at every model and stage boundary

**Depends on:** Task 1

**Files:**

- Modify: `src/prompts.ts` — spec author, spec self-critique, spec reconciliation, plan author, plan self-critique, plan reconciliation, and reviewer guidance
- Modify: `src/plan-stage.ts` — all three coverage checkpoints and diagnostics
- Modify: `src/approval-stage.ts` — obsolete spec-shape repair at the approval read boundary
- Modify: `test/prompts.test.ts`
- Modify: `test/plan-stage.test.ts`
- Modify: `test/approval-stage.test.ts`
- Validate: `src/spec-stage.ts` and `test/spec-stage.test.ts` — all three existing `writeSpecDoc` boundaries consume the shared parser

**Steps:**

1. Extend the prompt-source constraint test and generated-prompt tests before changing prompts.
   - Require every spec-emitting prompt to show the canonical `AC-001: <text>` form, state spec-only minting, and direct revisions to preserve IDs when they preserve an obligation.
   - Require every plan-emitting prompt to show ID-only Coverage forms and prohibit criterion prose on the left side.
   - Ask reviewers and reconcilers to cite a criterion ID when useful while stating that location remains an unenforced textual field.
   - Validate every prompt example by passing a document containing it through the same parser used by the stage.
2. Update the prompts without adding an alternate prose form or compatibility instruction. The approved specification remains present verbatim in plan prompts; only the Coverage reference changes to an ID.
3. Run `coverageMeetsCriteria` before `coverageFitsScope` at the author, self-critique, and reconciliation checkpoints so an invented ID reports as an identity violation before its artifact promise is considered. Use one local formatter for all three checkpoints and emit one stable refusal shape that includes `missing=[...]`, `unknown=[...]`, and `duplicate=[...]`; keep stage-specific prefixes intact.
4. At `buildBinding` and the initial spec read in `runPlanStage`, append the actionable old-run repair only when `obsoleteCriterionShape === true`: the document uses the retired schema and the operator must start a fresh run. Do not match `reason`, add a second parser, or attach the repair to malformed new-schema output. Do not change `src/implementation-stage.ts`, which consumes already-gated documents by hash and opaque content.
5. Add stage tests proving all three checkpoints reject each identity defect before reviewer dispatch, and proving a rich-prose spec reaches the panel when its plan covers the IDs. Add approval and plan-entry tests for the actionable obsolete-shape refusal.
6. Run `node --test test/prompts.test.ts test/approval-stage.test.ts test/plan-stage.test.ts test/spec-stage.test.ts` and `npm run typecheck`.

**Task completion evidence:** Every emitting prompt and stage boundary agrees on one schema; identity defects name their category and ID before paid review; old parse-boundary runs receive the fresh-run repair; already-gated opaque downstream content stays untouched.

### Task 3: Carry structured criteria through reconciliation and real-shape fixtures

**Depends on:** Tasks 1 and 2

**Files:**

- Modify: `src/reconciliation.ts` — `specNormativeNodes` and `planNormativeNodes`
- Modify: `test/reconciliation.test.ts`
- Modify: `test/fixtures/harness/emit-spec-stage.mjs`
- Modify: `test/fixtures/harness/emit-plan-stage.mjs`
- Modify as required by parsed document literals: `test/approval-stage.test.ts`, `test/cli.test.ts`, `test/delivery-stage.test.ts`, `test/implementation-stage.test.ts`, `test/plan-stage.test.ts`, and `test/spec-stage.test.ts`

**Steps:**

1. Make spec normative nodes render acceptance criteria canonically as `<id>: <text>` and plan normative nodes render `<criterion-id> -> <target>`. Preserve the existing multiset, whitespace-collapse, and addition-only semantics; add an explicit regression that a wording change under one ID remains a normative replacement and that no removed-node guarantee appears.
2. Update the spec emitter to output valid IDs in the draft, self-critique, and reconciliation revisions. Update the plan emitter to scrape criterion IDs from the approved specification embedded in each prompt rather than carrying literal IDs; make an empty scrape a fixture failure, matching its existing scope-path rule.
3. Update only test strings and expected objects that pass through the changed document contracts. Leave historical finding-location strings and migration records unchanged unless the test exercises the new prompt guidance; a broad replacement of `## Acceptance criteria` would corrupt unrelated identity evidence.
4. Replay the stage and downstream suites that consume the fixtures: `node --test test/reconciliation.test.ts test/spec-stage.test.ts test/plan-stage.test.ts test/approval-stage.test.ts test/implementation-stage.test.ts test/delivery-stage.test.ts test/cli.test.ts`, then run the first post-contract `npm run typecheck` and require it to pass.

**Task completion evidence:** Reconciliation still accounts for structured nodes, dynamic fixtures derive IDs from the actual prompt/spec, and all affected integration paths pass without changing unrelated historical identity evidence.

### Task 4: Reconcile the binding documentation with the shipped contract

**Depends on:** Tasks 1 through 3

**Files:**

- Modify: `ARCHITECTURE.md` — sections 8, 12, 18, and 21 as applicable
- Modify: `README.md` — current plan-stage gate description
- Modify: `docs/features/stable-criterion-ids/plan.md` — implementation evidence and final status after all gates
- Validate without modification unless a real source-derived invariant changes: `scripts/doc-check.mjs`
- Validate without modification: `docs/hazards.md`

**Steps:**

1. Amend the architecture to state the canonical spec-owned ID form, exact bidirectional and unique Coverage relation, unchanged `specHash` and signed-scope bindings, one-schema compatibility refusal at parse boundaries, and the residual limits around pre-approval semantic continuity, textual finding locations, and hazard 17.
2. Update the README's implemented plan-stage description so it names ID-based total coverage in addition to unkeepable scope promises. Do not change the stage sequence, schema block, hazard count, deferred stages, or build order.
3. Run `npm run check:docs -- --json`. Require zero errors and no new warnings from the feature directory. Read the checker output as structure and path evidence only; parser and prompt tests remain the proof of model-output syntax.
4. Run `git diff --check` and inspect the diff for accidental changes to `docs/hazards.md`, migrations, approval contracts, or task-document policy.

**Task completion evidence:** Binding documentation matches the code's exact guarantee, doc-check remains clean, and no checker pin or hazard count changes without a source fact that requires it.

### Task 5: Prove the guard, run the full gate, and obtain independent review

**Depends on:** Tasks 1 through 4

**Files:**

- Create after the paid validation: `real-run-evidence.md` beside this plan
- Create after the paid validation when safe: `criterion-id-plan-envelope.json` under the existing harness fixture directory
- Create after explicit review authorization: `docs/features/stable-criterion-ids/<review-date>-code-review.md`
- Modify after the paid validation when safe: `test/harness.test.ts` — recorded-envelope contract replay through the established harness seam
- Modify for accepted review findings only: files named by Tasks 1 through 4
- Validate: `.claude/skills/run-buildworks/driver.mjs` from a disposable checkout and scratch target only

**Steps:**

1. Request the required authorization for a disposable checkout or worktree before creating it. Copy the complete uncommitted change into that isolated repository and verify its starting status so the known full-suite leak cannot alter this working copy.
2. In the disposable repository, break and restore each load-bearing guard one at a time: accept prose as an ID, remove the unknown direction, remove duplicate detection, omit one of the three plan-stage checks, omit the ID constraint from one emitting prompt, and make the plan fixture use a literal ID. Run the named focused test for each mutation, require it to fail for the intended assertion, reverse only that mutation, and re-run green.
3. From the disposable repository run `npm ci`, `npm run typecheck`, `npm test`, and `npm run check:docs -- --json`. Require zero type errors, zero test failures with only the recorded pre-existing skip, zero documentation errors, and no new feature-document warnings. Confirm the original working copy's commit and status remain unchanged by the test run.
4. Run `node .claude/skills/run-buildworks/driver.mjs smoke` first. Do not retry a failure without changing the disproven assumption or input.
5. For the spend-authorized real check, keep all mutations outside this repository: in the disposable copy replace only the driver's scratch `DESIGN` and slug with the calculator reproduction from the debugging analysis, then run `node .claude/skills/run-buildworks/driver.mjs paid --yes`. Require the scratch run to pass spec, approval, plan, and plan review with criterion IDs and to complete the remaining stages driven by that command. Record dispatch count, cost, effective model, stage states, audit verification, scratch path, spec and plan hashes, and the raw plan-author envelope path in `real-run-evidence.md`. The evidence document carries its own `**Hazards considered:**` line.
6. Inspect the retained plan-author envelope for repository content or credentials before copying it. If safe, copy the complete calculator envelope to `criterion-id-plan-envelope.json` under the harness fixture directory with its harness metadata intact. In `test/harness.test.ts`, pass the bytes through `parseEnvelope(CLAUDE_CODE, raw)`, pass `envelope.resultText` through `extractJsonBody`, pass that value through `validateAgentResult("plan-author", value)`, extract `proposedContentChanges.plan`, pass it through `validatePlanDoc`, and assert its exact criterion IDs. If the envelope contains sensitive or unrelated content, retain it only under the scratch target's `.governance/raw/` and record why it is not committed; do not sanitize bytes and describe them as raw evidence.
7. Stop rather than retry if the paid run fails for model output. Diagnose from the retained raw envelope, vary the prompt or contract only when the evidence identifies a defect, and obtain fresh spend authorization for a materially new paid attempt.
8. Ask the operator to authorize one independent external code review. Record its actual independence as `configured_standalone` only for a separately spawned process; otherwise record `unverified_self_attestation`. Reconcile every material finding in the dated review artifact and re-run affected focused checks.
9. Re-run the disposable completion gate after review remediation, inspect the aggregate diff, and change this plan to `**Status:** Implemented` only when every acceptance criterion and required evidence item is satisfied.

**Task completion evidence:** Each guard has a measured red/green proof, the isolated full gate is green, free smoke stays green, one paid calculator run proves the original failure class at the real harness boundary with retained cost and raw evidence, the independent review is reconciled, and the final diff contains only the designed document-contract feature.
