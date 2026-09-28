# Disclosed Open Decisions Implementation Plan

**Status:** Implemented

**Goal:** Every open decision the spec author discloses becomes a round-1 `spec_review` finding that reconciliation must answer with a typed disposition, so a disclosed gap can no longer pass the gate without a recorded decision.

**Source:** `docs/proposals/spec-review-severity-nondeterminism.md` (revised 2026-09-26), "Recommended direction". Evidence: `test/fixtures/recorded/spec-review-note-keeper-runs-5-6-disclosed-decisions.json`. Both note-keeper runs reviewed specs disclosing the same three open security decisions in prose. Run 5's panel turned one into a fixable defect and never raised the other two, so they passed with no decision. Run 6's panel raised all three and its reconciler blocked. Operator decisions of 2026-09-26, made while scoping this plan:
- **Mechanism:** disclosures become findings. The spec gains a `## Open decisions` section. The system records each entry as an upstream finding reported by the author's self-critique run, and the existing reconciliation, proposal and gate machinery answers it.
- **Scope:** `spec_review` only. `plan_review` is unchanged.

**Hazards considered:** `docs/hazards.md` items 1, 3, 4, 13, 14, 16 and 17.
- **13 (specifications inventing obligations):** this is the feature's purpose. The prompts already say "say that it is open rather than deciding it yourself"; this gives that instruction a structured destination with a guaranteed decision.
- **3 (constraint stated in the prompt):** the new section is a constrained field. Its form, ID pattern, severity vocabulary, membership rule and no-add rule are stated in every spec prompt that writes it, and pinned in `CONSTRAINT_STRINGS` (Task 2).
- **1 (output shapes):** the section adds a refusal shape. Like the other two structured sections, it refuses a non-entry line by naming its membership rule, not with a generic parse error (Task 1).
- **4 (fixtures agreeing with code):** parser expectations come from the schema this plan states, not from the implementation. Stage tests assert rows and audit events the stage writes; the fixture supplies only model output (Tasks 1 and 3).
- **14 (independence that cannot be proven):** a disclosure report comes from the author, not a panel seat. Task 4 states in `ARCHITECTURE.md` that it adds no reviewer, counts toward no panel size, and makes no independence claim.
- **16 (upstream routing):** disclosures use the existing `upstream_follow_up` / `upstream_blocking` routes and proposal storage unchanged.
- **17 (deletion accounting):** open-decision entries are not normative nodes. Removing one after it is decided deletes no obligation, and its finding's decision is still required.

Items 2, 5–12, 15 and 18 do not govern this change. It touches no raw-output retention, delivery, planning promise, retry, executable resolution, hook, model alias, default seeding, configuration surface, sandbox or code-review gate.

**Assumptions:**
- **Severity is author evidence.** The parenthesized severity is the author's claim, stored on the report exactly as a reviewer's severity is. The `spec_review` gate still reads only dispositions (`specReviewGate`, `src/spec-stage.ts`), so severity decides nothing.
- **Recorded once.** Disclosures are recorded in round 1, from the self-critiqued specification the panel reviews. Later rounds only enforce the no-add rule, so no open decision is decided twice.
- **Not normative nodes.** `specNormativeNodes` is unchanged. Adding or removing an entry needs no grounding claim; the no-add rule is a separate check.
- **Existing specs are unaffected.** A spec without the section parses with `openDecisions: []`, and the stage behaves exactly as today.
- **Architecture decision.** The operator's 2026-09-26 choice is the decision Task 4 records in `ARCHITECTURE.md`. Approving this plan authorizes that edit.
- **No live run.** The change is proven against the stated contract and fixtures only. Whether a live author uses the section, and how reconcilers dispose of it, stays unmeasured until a separately authorized run.

**Approach:**
- **Schema (`src/spec-doc.ts`).** Parse an optional `## Open decisions` section whose entries read `- OD-001 (high): <question the design leaves open>`. It has its own ID pattern, the shared severity vocabulary, a membership rule, and a duplicate check.
- **Stage (`src/spec-stage.ts`).** In round 1, before the panel dispatches, record each entry of the self-critiqued spec as a canonical finding: location `upstream:design:od-NNN`, intent key `disclosed-open-decision`, one report from the self-critique run carrying the author's severity, classification `upstream`, and subject `OD-NNN: <text>`. These findings join the round's reconciliation input, so the existing `validateReconciliation` completeness check forces a decision for each. Every round refuses a reconciled spec that adds an entry ID absent from the spec it reviewed.
- **Prompts (`src/prompts.ts`).** The draft, self-critique and reconcile prompts state the section schema. The reconcile prompt adds the no-add rule and explains author-reported findings. The reviewer prompt says disclosed entries are already recorded and names what reviewers should still report.
- **Docs.** `ARCHITECTURE.md` sections 8, 12 and 13 record the rule. The proposal records the choice.

**Affected areas:**
- `src/spec-doc.ts`: `SpecDoc`, `validateSpecDoc`, new `OpenDecision` and `OPEN_DECISION_ID_PATTERN`.
- `src/spec-stage.ts`: `runSpecStage`, new exported `disclosedOpenDecisionReports`.
- `src/prompts.ts`: `buildSpecAuthorPrompt`, `buildSpecSelfCritiquePrompt`, `buildSpecReviewPrompt`, `buildSpecReconcilePrompt`.
- `test/spec-doc.test.ts`, `test/spec-stage.test.ts`, `test/prompts.test.ts`.
- `ARCHITECTURE.md` sections 8, 12 and 13; `docs/proposals/spec-review-severity-nondeterminism.md`.

**Known blockers:**
- **Fixture routing.** `test/fixtures/harness/emit-spec-stage.mjs` routes each dispatch by prompt substring, in this order: `self-critique`, `spec reviewer`, `reconcile`, `spec author` (lines 167-212). Its reconcile branch answers every `finding <digit>` match in the whole prompt (line 126). So new text must not contain:
  - `self-critique` in the reviewer, reconcile or draft prompts;
  - `spec reviewer` (with a space) in the reconcile or draft prompts;
  - `reconcile` in the draft prompt;
  - `finding ` followed by a digit anywhere.

  The routing tests at `test/prompts.test.ts:1108-1111` and the composition journey from `:1221` feed all four prompts through the emitter, so a violation fails there.
- **One-line pins.** `CONSTRAINT_STRINGS` (`test/prompts.test.ts:70`) scans the prompt source, so each pinned phrase must sit on one source line.
- **`ARCHITECTURE.md` headings.** `scripts/doc-check.mjs` `derive()` parses `ARCHITECTURE.md` by heading and fence shape. Task 4 edits prose inside sections 8, 12 and 13 only and renames no heading.
- **Baseline failures.** `test/sign-approval.test.ts:99` currently fails: a known false positive against a comment in `src/dashboard-approval.ts:16`, deferred to the operator (`.claude/sessions/project-learnings.md` Current state, item 1). `test/cli-operator.test.ts:1394` fails when launched from the assistant's tool shell (project-learnings, Windows section). Judge results against the Task 0 baseline.
- **No paid execution** is authorized.
- **Uncommitted files.** The working tree may hold the uncommitted proposal revision, its fixture and project-learnings edits. Those are not this plan's changes, except the proposal edit in Task 4.

**Blast radius:**
- **`SpecDoc`.** Built only by `validateSpecDoc`: a grep for `acceptanceCriteria:` in `src` and `test` finds no other object literal (`src/plan-gate.ts:120` is a parameter type). Readers are `src/approval-stage.ts`, `src/plan-stage.ts`, `src/implementation-stage.ts`, `src/operator-state.ts`, `src/reconciliation.ts` (`specNormativeNodes`) and `src/spec-stage.ts`. None enumerates `SpecDoc` fields, so the added field changes nothing for them. A spec carrying the new section still validates at approval and plan intake, because those call the same `validateSpecDoc`.
- **Finding storage.** `insertFindingReport` (`src/store.ts:608`) checks severity and classification only, not which stage the reporting agent run belongs to. That is the same as reconciliation decisions, whose agent run is already the author's spec-stage run (`src/spec-stage.ts:513-523,631-633`). No schema or migration change.
- **Projections.** `src/operator-state.ts:404-406` labels each report `reviewerId: <agent name>`, so a disclosure report shows as `spec-author`, which is true. The retained-report equality at `:580-590` runs only for code review. No dashboard change is required; the field name `reviewerId` is a known misnomer for these rows, and renaming it is out of scope.
- **Prompt callers.** The four builders are called from `src/spec-stage.ts:212,276,437,521` and from `test/prompts.test.ts` (lines 265-1257, grep-verified). Prompts are code, not frozen profile content, so the change reaches only dispatches issued after it lands.
- **Unchanged.** `validateReconciliation`, the gate, proposal storage, `plan_review`, code review and the smoke driver (which makes no dispatches).

**Verification:**
- Focused runs: `node --test test/spec-doc.test.ts test/spec-stage.test.ts test/prompts.test.ts test/reconciliation.test.ts`.
- `npm run typecheck`, `npm run check:docs` and `npm test`, compared against the Task 0 baseline.
- One break-test per new guard (Task 5).

---

## Success criteria

- A spec with `## Open decisions` entries parses into `openDecisions`. Each malformed shape is refused by a message naming its rule, and a spec without the section parses exactly as before.
- In round 1, each entry of the self-critiqued spec is recorded as a canonical finding at `upstream:design:<id in lowercase>` with intent key `disclosed-open-decision`. It carries one report from the self-critique agent run with the entry's severity and classification `upstream`, and one `spec.disclosure.record` audit event.
- Reconciliation receives those findings in its findings block. A reconciliation omitting a decision for one is refused by the existing completeness check. An `upstream_blocking` decision on one blocks the gate by name with its proposal. An `upstream_follow_up` or `addressed` decision passes with the decision recorded.
- A reconciled spec that adds an entry ID absent from the spec it reviewed aborts the round with `spec.reconcile.invalid`, naming the ID, before any decision is persisted.
- With two configured rounds, disclosures are recorded in round 1 only.
- The draft, self-critique, reviewer and reconcile prompts state the rules this feature adds, each pinned in `CONSTRAINT_STRINGS`, and every emitter routing test still passes.
- `ARCHITECTURE.md` sections 8, 12 and 13 describe the section, the author-reported finding and the no-add rule, dated as the operator decision of 2026-09-26.
- `npm run typecheck` and `npm run check:docs` pass, and `npm test` shows no failure outside the Task 0 baseline.

## Tasks

- **Task 0: Record the baseline before changing anything.**
  - From the checkout root run `node --test --test-reporter=tap test/*.test.ts`, redirecting output to a file in the session scratchpad, not the repository. Extract the `not ok` lines as the baseline set.
  - Expected: failures, if any, are limited to `test/sign-approval.test.ts` ("nothing under src/ touches a private key") and possibly `test/cli-operator.test.ts:1394`.
  - If anything else fails, stop and report it before editing.

- **Task 1: Parse the `## Open decisions` section.**
  - Depends on: Task 0.
  - In `src/spec-doc.ts`:
    - Add `export interface OpenDecision { id: string; severity: string; text: string }` and the field `openDecisions: OpenDecision[]` on `SpecDoc`.
    - Add `export const OPEN_DECISION_ID_PATTERN = /^OD-(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$/;`, the same shape as `CRITERION_ID_PATTERN` with the `OD` prefix.
    - Import `SEVERITIES` from `./finding.ts`. `finding.ts` imports nothing, so this creates no cycle.
  - In `validateSpecDoc`, after the acceptance-criteria loop, read `section(text, "Open decisions")`. When the section is absent, `openDecisions` is `[]`. Otherwise split lines exactly as the criteria pass does (trim, strip one leading `- `, drop blank lines). An empty section yields `[]`. Check each line in this order:
    - **Membership:** a line not matching `/^OD-\S*/i` refuses with `every line under ## Open decisions must be one open decision of the form '- OD-NNN (<severity>): <question the design leaves open>'; an explanation belongs in another section; this line is not an open decision: <line>`.
    - **Shape:** a line not matching `/^(\S+) \(([^)]*)\): (.*\S.*)$/` refuses with `open decision must be '<OD-NNN> (<severity>): <question>': <line>`.
    - **ID:** an ID failing `OPEN_DECISION_ID_PATTERN` refuses with `invalid open decision ID <id>: must match <OPEN_DECISION_ID_PATTERN.source>`.
    - **Severity:** a severity outside `SEVERITIES` refuses with `open decision <id> severity <value> is not one of low, medium, high, critical`, built from `SEVERITIES.join(", ")`.
    - **Duplicate:** a repeated ID refuses with `duplicate open decision ID <id>`.
    - Otherwise push `{ id, severity, text: <trimmed question> }`.
  - Return `openDecisions` in the success value. Update the function's doc comment: the schema now has three structured sections, and the open-decisions section is optional.
  - In `test/spec-doc.test.ts`, add tests using a helper that appends a section to the existing `validSpec()`. Expected values come from the rules stated above:
    - `- OD-001 (high): who may download the export archive` and an unbulleted `OD-002 (low): retention period` parse to `[{ id: "OD-001", severity: "high", text: "who may download the export archive" }, { id: "OD-002", severity: "low", text: "retention period" }]`;
    - no section, and a heading with no entries, both give `openDecisions: []`;
    - a prose line is refused with the membership message; `OD-1`, `OD-000` and `od-001` are refused as invalid IDs; `(severe)` is refused naming the vocabulary; `- OD-001 high: x` and `- OD-001 (high):` (no question) are refused with the shape message; a repeated `OD-001` is refused as a duplicate;
    - the existing test "a valid spec parses with artifacts and criteria extracted" still passes. Add `openDecisions: []` to its assertions.
  - Verify: `npm run typecheck`, then `node --test test/spec-doc.test.ts`. Expected: clean typecheck; all pass.

- **Task 2: State the section and its rules in the four spec prompts.**
  - Depends on: Task 1.
  - In `src/prompts.ts`, add this schema bullet after the acceptance-criteria bullet in `buildSpecAuthorPrompt`, in the self-critique artifact schema (indented to match), and in `buildSpecReconcilePrompt`'s schema list. Keep each sentence on one source line:
    - `- an optional ## Open decisions section: one question the design leaves open per list line, in exactly this form: \`- OD-001 (high): <the question the design leaves open>\`.`
    - `  Open decision IDs must match \`OD-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`, and the parenthesized severity is one of low, medium, high, critical: how much the feature is at risk while the question stays open.`
    - `  Every non-blank line in this section is one open decision and nothing else.`
    - `  Record a question here instead of deciding it yourself or leaving it only in prose: each entry is recorded as a finding that must receive a typed decision before approval.`
  - In `buildSpecSelfCritiquePrompt`, change the closing sentence "Where the design leaves a decision open, say that it is open rather than deciding it yourself." to `Where the design leaves a decision open, record it under ## Open decisions rather than deciding it yourself.`
  - In `buildSpecReconcilePrompt`, append to the schema bullet: `You may keep, reword, or remove an existing entry, but never add a new entry during this revision; a question you now find open is answered through the decision on the finding that raised it.` After the no-invention paragraph, add: `A finding whose report comes from ${agent.id} is an open decision you disclosed under ## Open decisions. Answer it like any other finding: upstream_follow_up or upstream_blocking with a complete proposal when the design must decide it, addressed only when you can ground the resolution in the design, or cannot_determine.`
  - In `buildSpecReviewPrompt`, after the criterion-ID paragraph, add: `The specification's ## Open decisions section lists questions its author says the design leaves open. Each entry is already recorded as a finding and will receive a decision, so you need not report it again. Report a question the design leaves open that the section omits as an upstream finding, and an entry the design actually decides as a current_artifact finding at ## Open decisions.`
  - Before saving, check every added line against the routing constraints in Known blockers. The reviewer text contains no `self-critique`; the reconcile text contains neither `self-critique` nor `spec reviewer`; the draft text contains none of `self-critique`, `spec reviewer`, `reconcile`; no text contains `finding` followed by a space and a digit.
  - In `test/prompts.test.ts`:
    - Add to `CONSTRAINT_STRINGS`: `## Open decisions`, `OD-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})`, `one open decision and nothing else`, `must receive a typed decision before approval`, `never add a new entry during this revision`, `an open decision you disclosed`, `already recorded as a finding`.
    - Extend the per-prompt assertion lists: the draft list (near line 265), the self-critique test (near line 473), the reviewer test (near line 288) and the reconcile test (near line 673). Each generated prompt must contain the phrases its builder now carries.
  - Verify: `npm run typecheck`, then `node --test test/prompts.test.ts test/spec-stage.test.ts`. Expected: all pass, including the routing tests at lines 1108-1111 and the composition journey from line 1221.

- **Task 3: Record disclosures as findings and refuse added entries.**
  - Depends on: Task 1.
  - In `src/spec-stage.ts`, add an exported pure helper. The lowercase ID is a valid kebab decision key, so the location passes the same token rule `validateReviewerReports` enforces:

    ```ts
    export const DISCLOSED_OPEN_DECISION_INTENT = "disclosed-open-decision";
    export function disclosedOpenDecisionReports(doc: SpecDoc): ReviewerReport[] {
      return doc.openDecisions.map((d) => ({
        severity: d.severity,
        classification: "upstream",
        location: `${upstreamPrefixFor("design")}${d.id.toLowerCase()}`,
        intentKey: DISCLOSED_OPEN_DECISION_INTENT,
        subject: `${d.id}: ${d.text}`,
      }));
    }
    ```

    Import the `ReviewerReport` type from `./reconciliation.ts`.
  - In `runSpecStage`, keep `critiqueDispatch.agentRunId`: it is already in scope after the self-critique dispatch. In the round loop, after `roundReports` and `roundFindings` are created and before the reviewer loop, add a `round === 1` block. For each report from `disclosedOpenDecisionReports(written.doc)`:
    - call `store.upsertCanonicalFinding(reviewStage.id, round, report.intentKey, report.location)`;
    - call `store.insertFindingReport({ findingId, agentRunId: critiqueDispatch.agentRunId, severity, classification, subject })`;
    - append audit `spec.disclosure.record` with summary `recorded disclosed open decision <OD id> as finding <finding id> at <location> (<severity>), round 1`;
    - add the report to `roundReports`/`roundFindings` with `reviewerId: author.id`, exactly as reviewer reports are added.

    Add a short comment: the report is the author's disclosure, not a panel seat; section 13, as amended by Task 4.
  - In the same loop, after the `change_kind` check on `reconciledDoc` and before `writeSpecDoc`, compare entry IDs. Any ID in `reconciledDoc.value.openDecisions` absent from `written.doc.openDecisions` (the spec this round reviewed) aborts with `spec.reconcile.invalid` and reason `spec reconciliation added open decision(s) <ids joined by ", ">: a new open question is answered through the decision on the finding that raised it, not by a new entry`.
  - In `test/spec-stage.test.ts`, add a helper that builds a scratch fixture from `fixtureSource()`.
    - **Base spec.** Replace the first occurrence of ``- AC-001: the thing works\n`;`` (the end of `BASE_SPEC`; `DUPLICATE_SPEC` has the same ending later, and `.replace` touches only the first) with ``- AC-001: the thing works\n\n## Open decisions\n\n- OD-001 (high): who may download the export archive\n`;``. Change `BASE_SPEC`, not `authoredSpec()`: `REVISED_SPEC` is derived from `BASE_SPEC`, so the revised document keeps the entry, and a second round reviews a spec that still discloses it. Without that, the "once only" test cannot tell `round === 1` from `true`.
    - **Reconcile replacement.** Optionally replace the fixture's `const decisions = ids.map(...)` block, the same literal the existing `upstream_follow_up` test replaces (`test/spec-stage.test.ts:411-432`). Every replacement:
      - computes `const disclosed = new Set([...stdin.matchAll(/- finding (\d+)\n  - report from spec-author:/g)].map((m) => Number(m[1])));` rather than trusting position;
      - puts the existing two-entry revision claims (`AC-001: the thing works REVISED-spec` and `supersededCriterion(current)`) on the first id not in `disclosed`, and only when `revising`;
      - answers other non-disclosed ids `addressed` with `normativeChanges: []`.

    Add these tests:
    - **Recorded:** "a disclosed open decision becomes a round-1 upstream finding reported by the self-critique run", using the default reconcile, which answers `addressed`. Assert:
      - the run passes;
      - the `spec_review` stage holds a finding with location `upstream:design:od-001`, intent key `disclosed-open-decision`, round 1;
      - its one report has severity `high`, classification `upstream`, subject `OD-001: who may download the export archive`, and an `agent_run_id` equal to the spec stage's second `author` agent run (the self-critique);
      - a decision exists for it;
      - one `spec.disclosure.record` event names it;
      - `verifyAuditChain(store)` is `null`.
    - **Blocks by name:** "an upstream_blocking decision on a disclosed open decision blocks the gate by name". The reconcile replacement answers disclosure ids `upstream_blocking` with `changedLocations: []` and the proposal `{ title: "export access", problem: "the design never says who may download the archive", whyUpstream: "the spec cannot invent it" }`. Assert `result.ok === false`, a reason matching `<finding id> (proposal <proposal id>)`, a `blocking_dependency` proposal sourced from that finding, and run status `blocked`.
    - **Completeness:** "a reconciliation that omits a disclosed open decision is refused as incomplete". The replacement filters disclosure ids out of `decisions`. Assert the reason matches `reconciliation is incomplete: no decision for canonical finding id\(s\) <id>` and no decision row is persisted.
    - **No-add:** "a reconciliation that adds an open decision aborts naming it". The replacement returns `current + "- OD-002 (low): a newly noticed question\n"` — the artifact under review with one entry appended and no normative node changed — and answers every id `addressed` with `changedLocations: ["## Open decisions"]` and `normativeChanges: []`. With no claims, the round passes the unclaimed-node checks and reaches the no-add check. Assert the reason names `OD-002`, a `spec.reconcile.invalid` event exists, and no decision row is persisted.
    - **Once only:** "with two configured rounds, disclosures are recorded in round 1 only". Use `freezePolicyInto(store, root, runId, { specReviewRounds: 2 })` before the call. Assert exactly one finding with intent key `disclosed-open-decision` exists across the stage, in round 1.
    - Confirm the existing tests pass unchanged: `BASE_SPEC` has no section, so their finding ids and indexes do not move.
  - Verify: `npm run typecheck`, then `node --test test/spec-stage.test.ts`. Expected: all pass.

- **Task 4: Record the rule in `ARCHITECTURE.md` and the proposal.**
  - Depends on: Tasks 1-3.
  - **Section 8, "Coverage decisions":** in the paragraph beginning "Each structured section of a specification states a membership rule", add that the optional `## Open decisions` section's line is one `OD-NNN (<severity>): <question>` entry. Its IDs use the criterion ID shape with an `OD` prefix, and its entries are not normative nodes.
  - **Section 12, the `spec_review`/`plan_review` phase paragraph:** add a paragraph after it. Before the round-1 panel, every open decision the self-critiqued specification discloses is recorded as a round-1 canonical finding at `upstream:design:<id>`, reported by the author's self-critique run with the author's severity. Reconciliation must answer it like any finding, and reconciliation may remove an entry but never add one. `plan_review` has no such section (operator decision, 2026-09-26).
  - **Section 12, "Where authority sits":** add to the list of what deterministic code validates: that every disclosed open decision is a canonical finding of round 1, and that no reconciliation adds an entry.
  - **Section 13:** after "Reviewers produce findings. They do not vote, and the system does not need them to agree.", add a paragraph. The author's disclosed open decisions enter as findings too (operator decision, 2026-09-26). A disclosure report is the author's evidence: it occupies no panel seat, counts toward no panel size, and makes no independence claim (hazard 14). The author still supplies the disposition and the deterministic gate still decides, so "Nothing resolves its own finding" holds unchanged.
  - Rename no heading and add no fenced block.
  - **Proposal:** in `docs/proposals/spec-review-severity-nondeterminism.md`, add a paragraph after the `**Revised:**` paragraph. It reads: "**Decision:** 2026-09-26 — the operator chose the recommended direction for `spec_review` only, with disclosures recorded as author-reported findings. Plan: `docs/features/disclosed-open-decisions/plan.md`." The plan path stays in backticks so doc-check resolves it.
  - Verify: `npm run check:docs`. Expected: exit 0, no new warning naming either edited file.

- **Task 5: Prove each guard by breaking it, then verify the repository.**
  - Depends on: Tasks 1-4.
  - For each break-test:
    - record `git hash-object` of the file first;
    - apply exactly one mutation and run the named focused test;
    - confirm from the TAP summary that the failure is an assertion, not a crash (a crash looks like a held guard);
    - restore, and confirm the hash matches.

    The break-tests:
    1. In `runSpecStage`, change the round-1 disclosure block's condition to `false`. Expected: the "Recorded" test fails because no finding exists at `upstream:design:od-001`.
    2. Remove the no-add check. Expected: the "No-add" test fails because the run no longer refuses `OD-002`.
    3. In `validateSpecDoc`, skip the severity check. Expected: the `(severe)` spec-doc test fails.
    4. Delete the reviewer-prompt sentence containing `already recorded as a finding`. Expected: the `CONSTRAINT_STRINGS` test and the reviewer prompt test fail.
    5. Change the recording condition from `round === 1` to `true`. Expected: the "Once only" test fails, finding two disclosure findings.
  - Verify: `npm run typecheck` (clean), `npm run check:docs` (exit 0), `npm test` (no failure outside the Task 0 baseline set) and `git diff --check` (no whitespace errors).
  - Inspect `git status --short`. Expected changes are this plan's files only: the plan itself, `src/spec-doc.ts`, `src/spec-stage.ts`, `src/prompts.ts`, the three test files, `ARCHITECTURE.md` and the proposal. No scratch file remains.
  - Advance this plan's `**Status:**` to `Implemented` and add an implementation note: what shipped, deviations, and the unmeasured live behavior.

## Out of scope

- `plan_review`, which has no open-decisions section (operator scope decision, 2026-09-26).
- A rule for choosing `upstream_blocking` over `upstream_follow_up`. The proposal names this as a separate operator decision; this plan guarantees a decision, not a block.
- Renaming the `reviewerId` projection field or any dashboard change.
- Surfacing open decisions to plan authors, and any change to approval, plan or implementation stages beyond parsing the same spec.
- Any paid or live provider run.
- Committing. The operator decides when this lands.

## Implementation note (2026-09-27)

**Shipped:** Tasks 0-5 as written. `validateSpecDoc` parses `## Open decisions`; round 1 of `spec_review` records each entry as an author-reported upstream finding (`spec.disclosure.record`); every round refuses an added entry ID; the four spec prompts state the section and its rules; `ARCHITECTURE.md` sections 8, 12 and 13 and the proposal record the decision. Verification: typecheck clean, `check:docs` clean, `git diff --check` clean, and `npm test` at 1208 passing with the same seven baseline failures (six dashboard tests and the sign-approval private-key scan). All five planned break-tests failed on an assertion and were restored to their recorded hashes.

**Deviations:**
- The prompt test "the spec reconciliation prompt is not the spec author prompt" asserted that the author prompt never contains `decisions`. The new heading contains that word, so the test now asserts the JSON key `"decisions"` is absent from the author prompt and present in the reconcile prompt.
- The No-add test appends `"\n- OD-002 …"`, not `"- OD-002 …"`, because the fixture's current artifact is trimmed and has no trailing newline.

**Independent review (in-session subagent, 5 findings):**
- Fixed: a second `## Open decisions` heading, or a differently spelled one (`## Open Decisions`, `## Open decisions (none yet)`), was silently skipped by `section()`, so its entries escaped recording and the no-add rule. `validateSpecDoc` now refuses both, with a test and a break-test for each guard. `ARCHITECTURE.md` section 8 states the rule.
- Fixed (documentation): section 13 said "Nothing resolves its own finding" held unchanged. For a disclosure, the same author raises and answers the finding, and an `addressed` answer that changes no normative node needs no grounding. The text now says the rule guarantees a recorded typed decision, not a block or an independent check.
- Accepted, documented in section 12: the no-add check compares IDs, so a reworded entry that keeps its ID is not compared with the question its decision answered. Comparing text would forbid the rewording this plan allows.
- Accepted, consistent with the plan: an entry answered `addressed` may remain listed in the approved spec.

**Unmeasured:** whether a live author uses the section, and how reconcilers dispose of its entries. That needs a separately authorized paid run.
