# Spec Stage Implementation Plan

**Status:** Implemented

**Goal:** Build order step 3: the spec and spec-review stages, as two stage rows matching section 5's chain — under `spec`, dispatch a spec author, validate its result against the `AgentResult` contract, and content-write `spec.md`; under `spec_review`, convene a selected review panel, deduplicate their findings by identity, and decide completion with a deterministic gate that runs bounded closure rounds and blocks the run on budget exhaustion.

**Source:** `ARCHITECTURE.md` sections 8 (contracts — AgentResult, write modes, finding identity), 9 (agents — definition, role separation, selection), 12 (gates — `spec_review`), 13 (conflict resolution), 14 (work intake and projections), 15 (evidence model — the `finding` table); `docs/hazards.md` entries 1, 3, 4, 11, 13, 14; `CLAUDE.md`; the shipped steps 1 and 2 as precedent (`docs/features/run-store/plan.md`, `docs/features/harness-adapter/plan.md`, `src/dispatch.ts`, `src/store.ts`).

**Hazards considered:** `docs/hazards.md` 1 (parse shapes), 3 (a constrained field must state its constraint in the prompt), 4 (fixtures and code agreeing while both are wrong), 11 (a default install must complete a run — the seeded panel), 13 (specifications inventing obligations), 14 (independence that cannot be proven). Entries 2, 8, 9, 10 were settled by step 2; 5, 6, 7, 12 concern delivery and retries, which this step does not reach.

**Assumptions:**

- **Agent definitions are typed TypeScript modules, one file per agent** under `src/agents/`, following the executor-definition precedent from step 2. The architecture's example shows YAML, but Node has no YAML parser and step 1 committed to zero runtime dependencies; a loader for operator-editable files is deferred with the config loader (hard rule 4). Version-controlled and protected: agents are committed inputs an agent may never modify, and no write path in this plan touches `src/agents/`.
- **Severity values are `low`, `medium`, `high`, `critical`** (ordered), and the materiality threshold is a constant naming one of them — default `high`. The architecture names severity and a configured threshold but never enumerates the values; the plan picks the ordered set and freezes the default as a constant until the config loader exists. The enum lives in the migration CHECK and the prompt text only — the architecture document gains nothing from this plan.
- **Risk is never persisted.** It is a pure function of the spec (`computeRisk` over `change_kind`, declared artifacts, and protected touches), so step 4 recomputes it from the spec content at approval time — no column, no churn.
- **Disposition values are `open`, `resolved`, `disputed`, `accepted`.** The architecture requires findings to be "resolved or explicitly dispositioned with a justification" without enumerating values. Step 3's machinery sets `open` and `resolved` (the panel's re-review resolves); `disputed` and `accepted` are for humans in step 4 and later, present in the schema now so it does not churn.
- **Risk levels are `low`, `standard`, `high`, with panel sizes 1, 2, and 3** — the architecture fixed 2 at standard and 1 at low; 3 at high is this plan's completion of the mapping. Panel sizes are constants until the config loader exists.
- **The spec document schema is minimal**: frontmatter `feature:` and `change_kind:` (one of `feature` | `defect_fix`), a `## Declared artifacts` section listing repo-relative paths (the list `delivery_check` depends on, step 8), and an `## Acceptance criteria` section. Nothing else is required — hazard 13 warns against invented obligations, so validation checks presence and shape only.
- **Finding deduplication is enforced by a `UNIQUE(stage_id, intent_key, location)` index** — the schema-level form of the architecture's "two reviewers raising the same concern produce one finding."
- **Reviewers return their findings inside a normal `AgentResult`**: `proposedContentChanges` carries a typed `{ findings: [...] }` object. No new contract is invented.
- **One real API spend**: the manual smoke test dispatches the real `claude` binary once per stage round it exercises, exactly as step 2's smoke test did. The automated suite uses fixture executors only.

**Approach:** Pure functions for selection, risk, the gate, and validation; the orchestration (`runSpecStage`) takes an `ExecutorDefinition` parameter so every automated test runs against fixture executors emitting `AgentResult`-shaped JSON. The stage drives `dispatchOnce` unchanged — evidence retention, audit, and `agent_run` rows come for free. Zero new runtime dependencies. Every guard gets a break-it test per hazard 4; the disallowed-output test is written first per section 9's explicit demand.

**Affected areas:** New `src/agents/` (three seeded agents), `src/agent-result.ts`, `src/finding.ts`, `src/select.ts`, `src/prompts.ts`, `src/spec-doc.ts`, `src/spec-stage.ts`, `src/migrations/003_finding.sql`; modify `src/store.ts` (finding ops), `src/cli.ts` (`bw spec`), `scripts/doc-check.mjs` and `test/schema.test.ts` (finding table); new test files and one fixture executor.

**Known blockers:**

- Hazard 3 (constrained fields): the prompts request `AgentResult` status, severity, disposition, and `intentKey` — each constraint must be stated in the prompt text, and a test asserts it (Task 5).
- Hazard 4: every guard in this plan gets a break-it run — validation refusals, the gate, the closure budget, and deduplication.
- Hazard 11 (default installation completes): the seeded agents must satisfy the spec stage's required specialties at standard risk (two reviewers), and a test asserts the seeded panel covers them.
- Hazard 13 (specifications inventing obligations): the spec schema accepts anything the source never requires; the reviewer prompt asks reviewers to trace criteria, but step 3 does not enforce traceability mechanically — that is a later gate's job, stated in the plan rather than silently skipped.
- The schema block's `finding` line has no CHECK values; the migration adds CHECKs for the enums this plan chooses, and the doc checker's constraints array gains them (same precedent as `role`/`independence` in step 2).

**Blast radius:** `dispatchOnce` and its consumers are unchanged — `runSpecStage` is a new caller (verified: `src/dispatch.ts` exports only `dispatchOnce` and `DispatchInput`/`DispatchResult`; `src/cli.ts` is its only importer today, confirmed by the step-2 review's grep). `src/store.ts` gains `insertFinding`/`getFindings`/`updateFindingDisposition` and one index; no existing method signature changes, so the step-1/2 tests are unaffected. `scripts/doc-check.mjs`'s table loop gains `"finding"` and two constraint strings; existing assertions are untouched. No consumer of the spec stage exists yet — step 4 (approval) is the next caller.

**Verification:** `npm run typecheck`, `npm test` (fixture executors only — zero live network calls), `npm run check:docs`, and the completion gate `npm ci && npm run typecheck && npm test && npm run check:docs` from a clean checkout. One manual smoke against the real binary, recorded in task evidence.

---

### Task 1: Agent definitions and the disallowed-output test first

**Depends on:** None

**Files:**
- Create: `src/agents/spec-author.ts`
- Create: `src/agents/spec-reviewer-traceability.ts`
- Create: `src/agents/spec-reviewer-security.ts`
- Create: `src/agents.ts`
- Create: `test/agents.test.ts`

**Steps:**

- [x] **Step 1: the definition shape**
  - Change: `src/agents.ts` exports `interface AgentDefinition { id: string; role: "author" | "reviewer"; specialty: string | null; executor: string; outputs: string[]; tools: string[] }` — exactly the section 9 YAML's fields, nothing decorative. It also exports `AGENTS: readonly AgentDefinition[]` and `agentById(id): AgentDefinition | undefined`. `executor` holds `"claude-code"` matching `CLAUDE_CODE.id`; `tools` is the command allowlist, empty for all seeded agents. `executor` and `tools` are carried because the architecture's definition shape requires them; nothing in step 3 enforces them — that arrives with executor binding — and the plan states this rather than silently dropping fields (section 9's "a field that nothing enforces does not belong here" is the test the later step must pass).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: the three seeded agents**
  - Change: `src/agents/spec-author.ts` defines `spec-author` (`role: "author"`, `specialty: null`, `outputs: ["spec", "spec-revision"]`, `tools: []`). `src/agents/spec-reviewer-traceability.ts` defines `spec-reviewer-traceability` (`role: "reviewer"`, `specialty: "requirements-traceability"`, `outputs: ["findings"]`). `src/agents/spec-reviewer-security.ts` defines `spec-reviewer-security` (`role: "reviewer"`, `specialty: "security"`). Each file exports exactly one definition and registers it in `src/agents.ts`'s `AGENTS` array. Three agents are the seed because standard risk needs a panel of two and the author may never review (hazard 11).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: the disallowed-output test, written first**
  - Change: `test/agents.test.ts` asserts, before any dispatch code exists: (1) `agentById("spec-reviewer-traceability").outputs` does not include `"spec"` — a request for spec output from a reviewer must be refused by the dispatch check added in Task 7; (2) the seeded reviewers' specialties cover the spec stage's required specialty set `["requirements-traceability"]` and the seed provides at least two reviewers; (3) `spec-author` has `role: "author"` and never appears in a panel for its own stage (asserted structurally here, enforced by `selectReviewers` in Task 4).
  - Verify: `node --test test/agents.test.ts`
  - Expected: passes; if any seeded agent gains a `"spec"` output, this test fails first — that is the failure section 9 says must be caught "immediately, before an invocation is paid for."

**Task completion evidence:** `npm run typecheck` exits 0; `test/agents.test.ts` passes and fails when `"spec"` is added to a reviewer's `outputs` (recorded break-it run).

### Task 2: The AgentResult contract and its validation

**Depends on:** None

**Files:**
- Create: `src/agent-result.ts`
- Create: `test/agent-result.test.ts`

**Steps:**

- [x] **Step 1: types**
  - Change: `src/agent-result.ts` defines `AgentResultStatus = "proposed" | "blocked" | "failed"`; `interface AgentResult { status: AgentResultStatus; agent: string; role: "author" | "reviewer"; executor: string; summary: string; proposedContentChanges?: unknown; proposedPatches?: ProposedPatch[]; diagnostics?: string[]; questions?: string[]; risk?: string; confidence?: number; recommendedTransition?: string }`; `interface ProposedPatch { baseCommit: string; files: { path: string; action: "add" | "modify"; content?: string }[] }` — matching section 8's field list, with the patch bound to its base commit.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `validateAgentResult`**
  - Change: `validateAgentResult(agentId: string, raw: unknown): { ok: true; value: AgentResult } | { ok: false; reason: string }`. Refuses with named causes, one check per rule: not an object; `status` outside the enum (message names the allowed values); `agent`/`role`/`executor`/`summary` missing or not strings; `agent` not equal to `agentId` (identity check — an agent may not return a result under another agent's id); a patch whose `baseCommit` is missing (message: `proposed patch is missing baseCommit`); a patch with `action` outside `add | modify`; and **any `action: "delete"` entry — schema-legal but refused** (section 8), with the message `deletion is schema-legal but refused`. Extra unknown fields are ignored, never an error.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: one test per rule, with the refusal messages asserted**
  - Change: `test/agent-result.test.ts` covers: a valid proposed result; each refusal above, asserting the exact `reason` string (hazard 1's operator-visible message discipline); a `blocked` result validating fine (a reviewer may legitimately return blocked); `confidence` outside 0..1 is accepted (the architecture does not constrain it — the plan must not invent a rule).
  - Verify: `node --test test/agent-result.test.ts`
  - Expected: all pass.

- [x] **Step 4: prove the guard by breaking it**
  - Change: Temporarily accept `action: "delete"` entries.
  - Verify: `node --test test/agent-result.test.ts`
  - Expected: the deletion test fails; restore and re-run to green.

**Task completion evidence:** `npm test` green; deletion-refusal fails when broken and passes when restored (recorded).

### Task 3: Finding identity, migration 003, and store operations

**Depends on:** None

**Files:**
- Create: `src/migrations/003_finding.sql`
- Create: `src/finding.ts`
- Modify: `src/store.ts` — finding ops
- Modify: `test/schema.test.ts` — finding coverage
- Modify: `test/store.test.ts` — finding coverage

**Steps:**

- [x] **Step 1: `003_finding.sql`**
  - Change: Create the `finding` table matching the architecture's column list and order exactly (for the schema contract test): `finding(id, stage_id, agent_run_id, severity, intent_key, subject, location, disposition)`, with `stage_id INTEGER NOT NULL REFERENCES stage(id)`, `agent_run_id INTEGER REFERENCES agent_run(id)`, `severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical'))`, `disposition TEXT NOT NULL DEFAULT 'open' CHECK (disposition IN ('open', 'resolved', 'disputed', 'accepted'))`, and `UNIQUE (stage_id, intent_key, location)` — the dedup rule as schema. Ends with `PRAGMA user_version = 3;`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `src/finding.ts` — identity**
  - Change: `normalizeLocation(location: string): string` — trim, collapse internal whitespace, and drop a trailing `:` so `## Acceptance criteria` and `## Acceptance criteria:` normalize identically. `findingIdentity(location: string, intentKey: string): string` returns `${normalizeLocation(location)}::${intentKey}`. `normalizeIntentKey(intentKey: string): string` — trim, lowercase, collapse runs of non-alphanumerics to a single `-`; used to validate, never to change a stored value (section 8: normalization after the fact changes identity, so the prompt carries the constraint and the validator only checks conformance).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: store ops**
  - Change: `src/store.ts` gains `insertFinding({ stageId, agentRunId, severity, intentKey, subject, location, disposition })` (validates severity/disposition against the arrays, `ON CONFLICT(stage_id, intent_key, location) DO UPDATE SET severity = excluded.severity, subject = excluded.subject, agent_run_id = excluded.agent_run_id` — the later reviewer's wording wins but the row stays one), `getFindings(stageId)` ordered by id, and `updateFindingDisposition(id, disposition, justification)` — justification goes into the audit event the caller writes, not into a new column (the schema block has no justification column and the plan does not add one).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 4: store tests**
  - Change: `test/store.test.ts` adds: two insertions with the same normalized location and intent key produce one row (dedup); different intent keys produce two; an invalid severity or disposition is refused naming the allowed values; `updateFindingDisposition` changes the row.
  - Verify: `node --test test/store.test.ts`
  - Expected: all pass.

- [x] **Step 5: schema contract extension**
  - Change: `test/schema.test.ts`'s column-compare loop gains `"finding"`; the CHECK-constraint assertions gain `"CHECK (severity IN ('low', 'medium', 'high', 'critical'))"` and `"CHECK (disposition IN ('open', 'resolved', 'disputed', 'accepted'))"`; and `sql.includes("UNIQUE (stage_id, intent_key, location)")` is asserted.
  - Verify: `node --test test/schema.test.ts`
  - Expected: passes once the migration matches the block.

- [x] **Step 6: prove the dedup guard by breaking it**
  - Change: Temporarily drop the UNIQUE constraint from a scratch migration copy (same `MIGRATION_FILE` mechanism as step 2's break-it).
  - Verify: `node --test test/schema.test.ts`
  - Expected: the UNIQUE assertion fails; restore and re-run to green.

**Task completion evidence:** `npm test` green; the dedup guard fails when broken and passes when restored (recorded).

### Task 4: Risk and selection

**Depends on:** Task 1

**Files:**
- Create: `src/select.ts`
- Create: `test/select.test.ts`

**Steps:**

- [x] **Step 1: `computeRisk`**
  - Change: `computeRisk(changeKind: string, declaredArtifactCount: number, touchesProtectedPaths: boolean): "low" | "standard" | "high"`. Deterministic: score = (changeKind === "defect_fix" ? 1 : 0) + (declaredArtifactCount > 10 ? 1 : 0) + (touchesProtectedPaths ? 2 : 0); score 0 → `low`, 1-2 → `standard`, ≥3 → `high`. The spec stage computes it after the author's spec exists, from `change_kind` and the declared-artifact list — an agent never assesses its own risk (section 9).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `selectReviewers`**
  - Change: `selectReviewers(risk: Risk, requiredSpecialties: string[]): AgentDefinition[]`. Pure and deterministic: (1) candidates are agents with `role: "reviewer"` whose `outputs` include `"findings"`; (2) required specialties are filled first, one agent per specialty, in specialty order, then agent id order; (3) remaining slots (panel size by risk: 1 / 2 / 3) are filled by ranked relevance — agents with any remaining specialty first, then by id; (4) role separation is enforced at the type and logic level: only reviewers are candidates, and the author id never appears in the result because authors are never candidates. The panel-size map is the constant `PANEL_SIZE: Record<Risk, number> = { low: 1, standard: 2, high: 3 }`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: selection tests**
  - Change: `test/select.test.ts` covers: `computeRisk` score boundaries (all four score values); standard-risk spec stage returns exactly the two seeded reviewers, traceability first; a required specialty with no seeded agent returns fewer reviewers than the panel size (the caller must then fail — the test asserts the count, Task 7 asserts the failure); low risk returns one (the first required specialty's agent); high risk with the seed returns both seeded reviewers (only two exist); the author never appears in any result.
  - Verify: `node --test test/select.test.ts`
  - Expected: all pass.

- [x] **Step 4: prove the role-separation guard by breaking it**
  - Change: Temporarily include authors in the candidate pool.
  - Verify: `node --test test/select.test.ts`
  - Expected: the author-exclusion test fails; restore and re-run to green.

**Task completion evidence:** `npm test` green; role-separation fails when broken and passes when restored (recorded).

### Task 5: Prompt building and the hazard-3 test

**Depends on:** Tasks 1, 2, 3

**Files:**
- Create: `src/prompts.ts`
- Create: `test/prompts.test.ts`

**Steps:**

- [x] **Step 1: `buildSpecAuthorPrompt`**
  - Change: `buildSpecAuthorPrompt(agent: AgentDefinition, designContent: string, context?: { findingsSummary?: string }): string`. The prompt contains: the role ("you are the spec author"); the design document content verbatim; the `AgentResult` contract with every constrained field stated — `status` must be one of `proposed | blocked | failed`, patches require `baseCommit`, deletion is refused; and the spec document schema (Task 6): frontmatter `feature` and `change_kind` (one of `feature | defect_fix`), `## Declared artifacts` (repo-relative paths, one per line), `## Acceptance criteria`. The revision variant (`findingsSummary` present) opens with a `## Revision` heading carrying the open material findings and asks the author to address or dispute each in the revised spec — the heading is real prompt structure, and it is what the fixtures key on. The prompt is a pure function of its inputs — no hidden state.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `buildSpecReviewPrompt`**
  - Change: `buildSpecReviewPrompt(agent: AgentDefinition, specContent: string): string`. The prompt contains: the role ("you are a spec reviewer", the agent's `specialty` as its lens); the spec content verbatim; the finding contract with every constraint stated — `severity` one of `low | medium | high | critical`, `location` a section heading or artifact path from the spec, `intentKey` **lowercase kebab-case, at most 64 characters, describing the concern type** (section 8: the constraint must be stated in the prompt that asks for the field), and the reviewer's `AgentResult` carries findings in `proposedContentChanges.findings`. The revision round passes the revised spec content only — the re-review needs nothing else, and the fixture keys on the spec's own content.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: the hazard-3 test**
  - Change: `test/prompts.test.ts` reads `src/prompts.ts` from disk and asserts, per constrained field, that the literal constraint string appears in the source near its prompt builder: `"proposed"`, `"blocked"`, `"failed"`, `"baseCommit"`, `"deletion"`, `"feature"`, `"defect_fix"`, `"## Declared artifacts"`, `"## Acceptance criteria"`, `"low"`, `"medium"`, `"high"`, `"critical"`, `"lowercase kebab-case"`, `"64"`, `"proposedContentChanges.findings"`. The test reads the file, never the generated strings — it guards the prompt source, per hazard 3's "a test should enforce that across every prompt-building file."
  - Verify: `node --test test/prompts.test.ts`
  - Expected: passes; fails when a constraint string is removed from the prompt source (break-it run recorded).

- [x] **Step 4: prove the guard by breaking it**
  - Change: Temporarily delete the `intentKey` constraint sentence from `src/prompts.ts`.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: fails on `"lowercase kebab-case"`; restore and re-run to green.

**Task completion evidence:** `npm test` green; the hazard-3 test fails when the prompt source drops a constraint and passes when restored (recorded).

### Task 6: The spec document schema and the content write

**Depends on:** None

**Files:**
- Create: `src/spec-doc.ts`
- Create: `test/spec-doc.test.ts`

**Steps:**

- [x] **Step 1: `validateSpecDoc`**
  - Change: `validateSpecDoc(content: string): { ok: true; value: SpecDoc } | { ok: false; reason: string }`. `SpecDoc = { feature: string; changeKind: "feature" | "defect_fix"; declaredArtifacts: string[]; acceptanceCriteria: string[] }`. Parses frontmatter (`feature:` and `change_kind:` lines), the `## Declared artifacts` section (one repo-relative path per non-empty list line; a path containing `..` or an absolute form is refused: `declared artifact must be a repo-relative path: <path>`), and the `## Acceptance criteria` section (one criterion per list line; empty list refused: `acceptance criteria must not be empty`). Missing any section or field refuses naming it. Everything else in the document is unvalidated prose — hazard 13 means the schema accepts whatever the source never required.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `writeSpecDoc`**
  - Change: `writeSpecDoc(rootDir: string, slug: string, content: string): string` — the content write: writes `docs/features/<slug>/spec.md` verbatim after `validateSpecDoc` passes, creating the directory, and returns the written path. It **overwrites** any existing file — the revision round's write replaces the prior content, and the gate decides whether the replacement stands. The write happens through the system, never the agent's patch path (section 8: a content write cannot express a source change, and this write touches only the projection). Step 3 writes into the operator's working copy — branch and worktree isolation arrive with step 6, so no run has more than one writer anywhere in step 3.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: tests**
  - Change: `test/spec-doc.test.ts` covers: a valid spec parses with artifacts and criteria extracted; each refusal names its cause (missing frontmatter field, bad `change_kind`, missing sections, empty criteria, a `..` path); `writeSpecDoc` writes the file to the right place and refuses invalid content without touching the filesystem (assert no file exists after the refusal).
  - Verify: `node --test test/spec-doc.test.ts`
  - Expected: all pass.

- [x] **Step 4: prove the guard by breaking it**
  - Change: Temporarily accept empty acceptance criteria.
  - Verify: `node --test test/spec-doc.test.ts`
  - Expected: the empty-criteria test fails; restore and re-run to green.

**Task completion evidence:** `npm test` green; the empty-criteria guard fails when broken and passes when restored (recorded).

### Task 7: The spec stage — orchestration, gate, closure loop, and CLI

**Depends on:** Tasks 1-6

**Files:**
- Create: `src/spec-stage.ts`
- Create: `test/fixtures/harness/emit-spec-stage.mjs`
- Create: `test/spec-stage.test.ts`
- Modify: `src/cli.ts` — `bw spec`
- Modify: `test/cli.test.ts` — `spec` bad-input cases

**Steps:**

- [x] **Step 1: the fixture**
  - Change: `test/fixtures/harness/emit-spec-stage.mjs` reads stdin fully, then dispatches on the prompt's role text — `runSpecStage` uses one executor for every dispatch, so one fixture must serve both roles. When stdin contains `spec author` (the author prompt's role line, Task 5 Step 1): print a valid `AgentResult` with `agent: "spec-author"` (matching the dispatched id, or `validateAgentResult`'s identity check refuses it), `role: "author"`, `executor: "claude-code"`, and `proposedContentChanges.spec` holding a fixed valid spec document whose content contains `REVISED-spec` when stdin also contains the `## Revision` heading, and a fixed base spec otherwise. When stdin contains `spec reviewer` (Task 5 Step 2): print an `AgentResult` with `agent: "spec-reviewer-traceability"`, `role: "reviewer"`, and `proposedContentChanges.findings` holding two findings (one material `high` traceability finding with location `## Acceptance criteria` and intentKey `missing-traceability`, one `low` nit) when stdin does **not** contain `REVISED-spec`, and an empty findings array when it does — so the revision round's re-review deterministically reports nothing new and the gate passes in round 2. Any other prompt prints `{"status":"failed",...}` with a summary naming the unrecognized prompt. Exits 0.
  - Verify: manual authoring checks: `echo "spec author" | node test/fixtures/harness/emit-spec-stage.mjs`, `printf 'spec author\n## Revision\nx' | node test/fixtures/harness/emit-spec-stage.mjs`, `echo "spec reviewer" | node test/fixtures/harness/emit-spec-stage.mjs`
  - Expected: the base spec result, the revised spec result, and the two-finding result, respectively.

- [x] **Step 2: `runSpecStage`**
  - Change: `runSpecStage(store, executor, { runId, requestedModel, rootDir }): Promise<StageResult>` with `StageResult = { ok: true; stageIds: { spec: number; specReview: number }; specPath: string } | { ok: false; reason: string }`. Two stage rows, matching section 5's chain; the stage rows' `output_ref` is the spec path (`docs/features/<slug>/spec.md`) for both, and every stage-level audit event uses `actor: "system"`, `actorType: "cli"`. Sequence, in order:
    1. `store.getRun(runId)`; absent → `{ ok: false, reason: "run <id> does not exist" }`.
    2. `store.getStageChain(runId).length > 0` → `{ ok: false, reason: "run <id> already has stage <kind> with status <status>" }` (the first existing stage's kind and status) — the spec stage is the first stage, and a retry of an identical stage is hazard 7's slower failure, so the refusal names the state and the recovery is a fresh run.
    3. Read `docs/features/<slug>/design.md` under `rootDir` (slug from the run row); unreadable → named refusal.
    4. `specStage = store.insertStage(runId, "spec", null)`; audit `spec.stage.create`.
    5. Author round: the disallowed-output check runs first — `agentById("spec-author").outputs` must include `"spec"`, otherwise refuse `configured agent spec-author does not allow spec output` without spending an invocation (the Task 1 test exists before this code). Then `dispatchOnce(store, executor, { stageId: specStage.id, agent: "spec-author", role: "author", requestedModel, prompt: buildSpecAuthorPrompt(...) })`. A failed dispatch (the `DispatchResult` `ok: false` case) aborts terminally: audit `spec.author.failed` with the reason, `completeStage(specStage, "", "block")`, return `{ ok: false, reason }`.
    6. Extract the inner body: `extractJsonBody(envelope resultText)` — reuse `src/parse-output.ts`; a refusal aborts. Then `validateAgentResult("spec-author", ...)`; refusal aborts. Then require `proposedContentChanges.spec` to be a string (refusal names the missing field); then `validateSpecDoc` on it; refusal aborts. Each abort is terminal: audit `spec.content.invalid` with the reason, `completeStage(specStage, "", "block")`, return `{ ok: false, reason }` — no run is ever left wedged with a pending stage and no recovery path.
    7. `writeSpecDoc` (overwrites); audit `spec.content.write` with the path; `completeStage(specStage, specPath, "pass")`.
    8. `reviewStage = store.insertStage(runId, "spec_review", specStage.id)`; audit `spec_review.stage.create`. `computeRisk(run.change_kind, declaredArtifacts.length, touchesProtected)` — `touchesProtected` is true when any declared artifact starts with `src/agents/`, `src/executor.ts`, `governed.yaml`, `.governance/`, or equals `docs/features/<slug>/design.md` (section 7's protected set). Risk is not persisted — step 4 recomputes it from the spec content.
    9. Panel loop, `REMEDIATION_ROUNDS = 3` total rounds **including the initial round** (the architecture's default):
       - `selectReviewers(risk, ["requirements-traceability"])`; if the panel is smaller than the risk's panel size → terminal abort: audit `spec.panel.incomplete` naming the missing specialty, `completeStage(reviewStage, specPath, "block")`, return `{ ok: false, reason }` (hazard 11 made visible).
       - For each reviewer: the disallowed-output check (`outputs` includes `"findings"`), then `dispatchOnce(... stageId: reviewStage.id, role: "reviewer" ...)` with `buildSpecReviewPrompt`; a failed dispatch aborts terminally: audit, `completeStage(reviewStage, specPath, "block")`, return — a reviewer that cannot run cannot be skipped silently. Extract body, validate the result, then validate each entry of `proposedContentChanges.findings` against the finding shape (severity enum, intentKey conformance via `normalizeIntentKey`, non-empty subject/location). An invalid finding entry is the same terminal abort: audit naming the reviewer and the cause, `completeStage(reviewStage, specPath, "block")`, return — a reviewer whose output cannot be validated must not pass the gate by absence.
       - `store.insertFinding` for each (dedup by the UNIQUE index); audit `spec.finding.record`. Then the resolution rule: any previously open finding whose identity does not appear in this round's reported set is marked `resolved` by the system, with an audit `spec.finding.resolved` naming its id — the panel's re-review is what resolves, never the author's claim.
    10. `specReviewGate(findings)` — deterministic: `material = severity >= "high"` (`SEVERITY_ORDER`), and `openMaterial = findings.filter(f => f.severity is material && f.disposition === "open")`. Pass iff `openMaterial.length === 0`; otherwise block, naming the finding ids. On block with rounds remaining: loop to another author round (the revision prompt carries the findings summary, and the revision overwrites `spec.md` — the gate decides whether the replacement stands). Exhausting the budget: `completeStage(reviewStage, specPath, "block")`, `run.status = "blocked"` via a new `store.setRunStatus`, audit `spec.gate.block` naming the finding ids, return `{ ok: false, reason }`.
       - On pass: `completeStage(reviewStage, specPath, "pass")`, audit `spec.gate.pass`, return `{ ok: true, stageIds: { spec: specStage.id, specReview: reviewStage.id }, specPath }`.
    11. Every dispatch's `agent_run` row, raw output, and audit event already exist — `dispatchOnce` provides them.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: orchestration tests against fixtures**
  - Change: `test/spec-stage.test.ts`, all with the one fixture executor (`node test/fixtures/harness/emit-spec-stage.mjs`) and temp roots:
    1. **Happy path with one revision round**: design.md present. Assert: two stage rows exist with kinds `spec` then `spec_review`, chained by `spec_review.input_stage_id` pointing at the `spec` row; both are `passed` with `output_ref` set to the spec path; `spec.md` exists on disk and contains `REVISED-spec` (the revision was written); the run is not blocked; the author was dispatched exactly twice and the panel twice (4 reviewer dispatches — 2 reviewers x 2 rounds, all attached to the `spec_review` stage row); the round-1 material finding's disposition is `resolved` (the system marked it when round 2 did not re-report it); and the audit contains `spec.gate.pass`.
    2. **Blocked on budget exhaustion**: point the test at a scratch copy of the fixture with the `REVISED-spec` check removed, so every round reports the material finding. Assert: the `spec` stage is `passed`, the `spec_review` stage is `blocked`, `run.status === "blocked"`, the reason names the finding id, the author was dispatched exactly `REMEDIATION_ROUNDS` times, and `spec.gate.block` is in the audit.
    3. **Dedup**: a scratch copy of the fixture whose reviewer branch emits only the material finding, and a second scratch copy emitting the same identity with different wording; assert one finding row.
    4. **Invalid result refusal**: a scratch copy whose author branch emits `status: "bogus"`; assert the stage aborts with the named refusal and no `spec.md` is written.
    5. **Missing design.md**: assert the named refusal before any dispatch (no `agent_run` rows).
  - Verify: `node --test test/spec-stage.test.ts`
  - Expected: all five cases pass with zero network calls.

- [x] **Step 4: `bw spec`**
  - Change: `src/cli.ts` gains `spec --run <id> --model <name>`: parses with the existing helpers, calls `runSpecStage(store, CLAUDE_CODE, { runId, requestedModel, rootDir: process.cwd() })`, prints the spec path on success (exit 0) or the reason (exit 1). The disallowed-output checks live in `runSpecStage` (Task 7 Step 2), where they run before any dispatch — the CLI stays a thin wrapper. `USAGE` and the `known` array gain the command.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 5: CLI tests**
  - Change: `test/cli.test.ts` adds: `spec --run 9999` exits 1 with `run 9999 does not exist`; `spec` with a missing `--run` exits 2 with the named option. Neither reaches a spawn (no run, no dispatch).
  - Verify: `node --test test/cli.test.ts`
  - Expected: both pass.

- [x] **Step 6: prove the gate guard by breaking it**
  - Change: Temporarily make `specReviewGate` pass when material findings exist but are not re-reported in the same round.
  - Verify: `node --test test/spec-stage.test.ts`
  - Expected: the blocked case passes when it should fail; restore and re-run to green (recorded).

- [x] **Step 7: documented manual smoke test**
  - Change: Record the exact manual sequence run once against the real binary: `bw new-run`, `bw stage-add --kind spec` is not used — `bw spec --run <id> --model sonnet` on a temp checkout with a one-line `design.md`, confirming the printed `spec.md` path, the author and reviewer `agent_run` rows, and `bw verify-audit` printing `chain valid`. This spends real API cost for one author round and one reviewer panel (two reviewers) — declared, once.
  - Verify: manual, once, during implementation (not part of `npm test`)
  - Expected: `spec.md` exists; rows exist with `role` values `author` and `reviewer`; chain valid.

**Task completion evidence:** `npm test` green with zero live network calls; the gate break-it fails when broken and passes when restored; the manual smoke test recorded as executed once.

### Task 8: Documentation checker extension and status

**Depends on:** Tasks 3, 7

**Files:**
- Modify: `scripts/doc-check.mjs`
- Modify: `README.md` — status
- Modify: `.claude/sessions/project-learnings.md` — record step 3

**Steps:**

- [x] **Step 1: extend the checker**
  - Change: `scripts/doc-check.mjs`: the table loop gains `"finding"` (`["run", "stage", "agent_run", "finding", "audit"]`); the constraints array gains `"CHECK (severity IN ('low', 'medium', 'high', 'critical'))"`, `"CHECK (disposition IN ('open', 'resolved', 'disputed', 'accepted'))"`, and `"UNIQUE (stage_id, intent_key, location)"`.
  - Verify: `npm run check:docs`
  - Expected: exit 0 once migration 003 matches the architecture block.

- [x] **Step 2: README status**
  - Change: add step 3 (spec stage with deterministic gate) to the implemented list.
  - Verify: `npm run check:docs`
  - Expected: exit 0.

- [x] **Step 3: session learnings**
  - Change: append a dated entry recording step 3, the enum choices (severity, disposition, risk), the typed-module agent-definition decision and its hard-rule-4 rationale, and the next step (4: human approval binding state).
  - Verify: none (documentation only)
  - Expected: file updated.

- [x] **Step 4: completion gate**
  - Change: none.
  - Verify: `npm ci && npm run typecheck && npm test && npm run check:docs`
  - Expected: all four exit 0 from a clean install, zero live network calls during `npm test`.

**Task completion evidence:** `npm run check:docs` exits 0; the completion gate passes from a clean checkout.

---

## Implementation note

**Shipped (2026-08-29):** the spec and spec-review stages as two chained
stage rows, `bw spec`, agent definitions (`spec-author` plus three seeded
reviewers so high risk convenes a full panel), the `AgentResult` contract
with deletion refusal, finding identity with `UNIQUE` dedup and the
re-review resolution rule, deterministic risk and selection, the hazard-3
prompt-source guard, the minimal spec document schema, and the deterministic
gate with closure rounds. Completion gate green from clean: typecheck,
118/118 tests, checker.

**Deviations from the plan, and why:**

- The author prompt no longer mentions `baseCommit` or `deletion`: the real
  smoke showed the clause made the model refuse to produce a spec without a
  git repository. Patch rules belong to the step whose prompts request
  patches; the hazard-3 constraint list dropped them accordingly.
- The reviewer prompt states the full envelope shape field by field: the
  real reviewer returned a bare findings object until the prompt named
  every required field.
- The fixture wraps its `AgentResult` in a claude-shaped envelope, because
  `parseEnvelope` reads the envelope's `result` field — a bare result on
  stdout is invisible to the pipeline.
- `dispatchOnce` now returns the parsed envelope and forwards
  `requestedModel` to the harness (`--model`), eliminating the retained-file
  re-read and the recorded-but-never-requested model.
- A third seeded reviewer (`spec-reviewer-consistency`) exists so high-risk
  runs can convene a full panel — hazard 11's default-install requirement.

**Code review:** one independent pass, 15 consolidated findings, all
reconciled: the findings upsert resets `disposition` on re-report (the
reviewer verified a false gate pass by execution), null finding entries and
non-proposed statuses abort terminally, locations normalize before storage
so identity and the UNIQUE key agree, slugs validate at insert, the
change_kind contradiction aborts, protected-path scoring normalizes paths
and compares repo-relative, and an unexpected-throw wedge guard completes
any incomplete stage as blocked.

**The real smoke, honestly:** the first two attempts failed — the model
refused the contract, and the retained bytes named both prompt defects.
After the fixes, a real run exercised the complete loop: author passed,
the panel found material findings, all three closure rounds ran, and the
gate blocked the run naming finding ids — fail closed with complete
evidence, exactly as designed. The demo spec failing review is the system
working, not a test failure.

**Deferred:** `disputed` and `accepted` dispositions are schema-present but
unused until step 4's human gate.
