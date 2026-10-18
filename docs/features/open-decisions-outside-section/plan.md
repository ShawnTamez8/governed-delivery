# Open Decisions Outside Their Section Implementation Plan

**Status:** Implemented

**Goal:** A specification that lists an open decision anywhere but under `## Open decisions` is refused when it is written, before any review spend. The prompts that write the section tell the author that an open question inherited from another specification goes there too.

**Source:**
- Crew-chatter run 2 (feature 1 of the run-1 split, `crew-chatter-accounts-notes`), 2026-10-17. It blocked at the `spec_review` gate after $0.9690182 with `spec reconciliation added open decision(s) OD-001, OD-012: a new open question is answered through the decision on the finding that raised it, not by a new entry`.
- Operator request 2026-10-17: "Yes please", after the review concluded that Decision-1 is the wrong tool for this and a deterministic refusal plus one prompt sentence is the fix.

**Hazards considered:**
- 1: a new refusal shape. A refusal at the author or self-critique write ends the stage with no retry (`writeSpecDoc` throws, and `src/spec-stage.ts` aborts at its two write sites). The prompt sentence is what makes a split feature's spec pass, not the refusal.
- 2: the three responses this plan depends on are retained raw in the machine-local target. Task 1 copies them into the repository before anything depends on them.
- 3: the constraint (open questions only under the section) is stated in the shared `openDecisionsSchema` and pinned in `CONSTRAINT_STRINGS`.
- 4: the regression case is the recorded self-critique artifact, not a hand-written spec. The hand-written lines in Task 2 are refusal shapes only, as the existing open-decision tests already use.
- 7: no retry is added.
- 17: does not apply. Nothing here removes an obligation; open decisions are not normative nodes.
- 13, 16 and 23: none, because nothing here changes what a criterion may say, what remediation sees or what a fix receives.

**Assumptions:**
- A line that starts with an open-decision ID (after an optional `-`, `*`, `+` or `1.`/`1)` list marker) is an open-decision entry wherever it appears. A mention later in a line, such as `AC-005: … (see OD-001)`, is not, and stays accepted. The scan of all 28 recorded specification documents under `test/fixtures/recorded/` found no OD-led line outside the section. Run 2's self-critique artifact is the only one.
- Emphasis-wrapped IDs (`**OD-001**`) are not caught. No recorded output writes one.

**Approach:**
- One check in `validateSpecDoc`, after the existing heading checks. It walks the normalized text, tracks the current `## ` heading the same way `section()` ends sections, and refuses an OD-led line under any heading other than `## Open decisions` (or before the first heading). Every writer and every re-reader of a spec gets it through the one validator.
- One sentence in `openDecisionsSchema`, which the draft, self-critique and reconciliation prompts all include. It says the section is the only place an open question is listed, including one another specification already records, such as the specification a feature was split from.
- Nothing changes in the no-add rule (`src/spec-stage.ts`), the reconciler, Decision-1 or the narration check.

**Affected areas:**
- `src/spec-doc.ts` (`validateSpecDoc`) and `src/prompts.ts` (`openDecisionsSchema`).
- `test/spec-doc.test.ts`, `test/prompts.test.ts`, `test/spec-stage.test.ts`, and a new fixture under `test/fixtures/recorded/`.
- `ARCHITECTURE.md` (the `## Open decisions` paragraph in the document-schema section), `docs/hazards.md` (hazard 3), and `.claude/sessions/project-learnings.md`.

**Known blockers:**
- A refusal at authoring blocks the run: there is no repair round (hazard 1, `src/spec-stage.ts` write sites). This plan accepts that and relies on the prompt sentence for compliance. Whether a live author now complies is unmeasured until a paid run, which this plan does not include.
- The prose form is not caught. Run 2's first draft listed the same questions as plain bullets with no IDs under `## Follow-ups already routed during design review`. A deterministic rule cannot tell such prose from a follow-up note. If a reviewer flags it, the reconciler's only fix still meets the no-add rule. That residual case is a candidate for a later judgment check. Its first recorded positive is this run's draft, in the Task 1 fixture.
- Re-running feature 1 later needs the untracked run-2 `docs/features/crew-chatter-accounts-notes/spec.md` in the crew-chatter target removed or moved aside by the operator first.

**Blast radius:**
- `validateSpecDoc` callers, from a repository search: `writeSpecDoc` (`src/spec-doc.ts`, used at `src/spec-stage.ts` author, self-critique and reconciliation writes and `src/spec-decision-stage.ts` fold write), `src/spec-stage.ts` (reconciled revision), `src/spec-decision-stage.ts` (reviewed and folded specs), `src/plan-stage.ts`, `src/approval-stage.ts`, `src/code-review-reconcile.ts` and `src/operator-state.ts`. A spec that now refuses would refuse at every re-read too. The fixture scan shows no recorded spec affected. Hard rule 3 rules out a compatibility path for any in-flight run.
- `openDecisionsSchema` callers: the spec draft prompt (`src/prompts.ts` around line 73), the self-critique prompt (around line 292) and the spec reconciliation prompt (around line 932). The reconciliation prompt follows the schema with "never add a new entry during this revision", which stays and still governs that dispatch.
- No schema, migration, profile field, CLI surface or dashboard change.

**Verification:** `node --test test/spec-doc.test.ts test/prompts.test.ts test/spec-stage.test.ts`, then `npm run typecheck`, `npm test` and `npm run check:docs`. Each new guard is proven by breaking it (Tasks 2 and 3), with the file copied first and restored bytes compared by SHA-256.

---

## The recorded incident

The run-2 spec stage dispatched three Claude calls that matter here. All are retained under `C:\Repositories\testing-repos\crew-chatter\.governance\raw\2\`. The starting commit was `8f539e5`.

| Agent run | Dispatch | Raw file | What it did |
|---|---|---|---|
| 78 | spec author draft (Opus 5.5, high), $0.4253996 | `2026-10-17T20-59-20-773Z-4eb495e9348f.json` | Listed three questions as plain bullets under `## Follow-ups already routed during design review`, citing run-1 finding numbers. No OD IDs; valid. |
| 79 | self-critique (Opus 5.5, high), $0.4084144 | `2026-10-17T21-01-08-552Z-50778d343f2e.json` | Replaced the finding numbers with the parent spec's IDs, writing `- OD-001: …` and `- OD-012: …` under `## Questions left open upstream`. Valid under today's validator, which checks only headings that start with "open decisions". |
| 106 | reconciler (Sonnet 5.5, medium), $0.1257077 | `2026-10-17T21-02-52-143Z-8bec30ea02e2.json` | Answered finding 36 (`open-decisions-heading-mismatch`, raised by `spec-reviewer-traceability`) by moving both entries under `## Open decisions` in the required form. The no-add rule read that as two new entries and blocked. |

Under this plan, agent run 79's artifact is refused at the self-critique write, after $0.8338140 rather than $0.9690182. With the prompt sentence, the expected outcome is that the author lists the two questions under `## Open decisions` in the draft, where they become round-1 findings as designed.

## Tasks

### Task 1: Commit the recorded responses

**Depends on:** None.

**Files:**
- Create: `test/fixtures/recorded/spec-crew-chatter-run-2-open-questions-outside-section.json`

**Steps:**
- Write the fixture with a `provenance` block in the shape of `spec-reconciliation-note-keeper-missing-proposal.json`. Name the run (crew-chatter run 2, `crew-chatter-accounts-notes`, blocked at `spec_review`, 5 priced dispatches plus 24 Decision-1 requests, $0.9690182), each dispatch time from the table above, the capture date 2026-10-17, the starting commit `8f539e5`, and what was dropped: everything in the stream-json envelope but the final `result` string.
- Keep three entries, `draft`, `selfCritique` and `reconciliation`, each holding the agent run ID, the raw file name and `result` byte for byte as the provider returned it.
- Verify: a scratch read parses each `result` with `extractJsonBody` (`src/parse-output.ts`). It confirms that `draft`'s `proposedContentChanges.spec` and `selfCritique`'s `proposedContentChanges.selfCritique.artifact` both validate with today's `validateSpecDoc`, and that the reconciliation's `spec` carries `OD-001` and `OD-012` under `## Open decisions`.
- Expected: all three statements hold. This is the baseline the next task changes.

**Task completion evidence:** the committed fixture, and the scratch read's output recorded in this plan's implementation record.

### Task 2: Refuse an open-decision line outside its section

**Depends on:** Task 1.

**Files:**
- Modify: `src/spec-doc.ts` (`validateSpecDoc`, after the `decisionHeadings` checks and before the `## Open decisions` parse)
- Validate: `test/spec-doc.test.ts`

**Steps:**
- Change: walk `text.split("\n")`, tracking the current heading as the trimmed title of the last `^## ` line. For each line not under `Open decisions`, refuse when it matches `/^\s*(?:[-*+]|\d+[.)])?\s*OD-\d/i`, with the reason `an open decision is listed only under ## Open decisions; this line outside that section starts with an open decision ID: <trimmed line>`. Name the heading as `## <title>`, or `before the first heading` when there is none. Add a comment naming run 2 and why the heading rule alone missed it. Update the existing comment at the heading checks, which says a differently spelled heading is the only escape.
- Tests, added beside the existing `## Open decisions` block in `test/spec-doc.test.ts`:
  - The Task 1 self-critique artifact refuses, with the exact reason for its `- OD-001: how the password-reset token reaches the user` line under `## Questions left open upstream`.
  - The Task 1 draft validates. This pins the known prose-form limit, so a later change to it is deliberate.
  - The Task 1 reconciliation's `spec` validates, with `openDecisions` IDs `OD-001` and `OD-012`.
  - Refusal shapes on `validSpec()`: `- OD-001 (high): q` under `## Context`; `1. OD-002 (low): q` under `## Out of scope`; and `OD-003: q` with no marker under `## Scope`.
  - An acceptance criterion mentioning `(see OD-001)` mid-line, with a valid `## Open decisions` entry, still validates.
  - The existing open-decision tests stay green unchanged.
- Verify: `node --test test/spec-doc.test.ts`
- Expected: all pass.
- Break-test: copy `src/spec-doc.ts`, delete the new check, rerun, and confirm the self-critique and shape tests fail. Restore, and confirm the bytes match the copy by SHA-256.

**Task completion evidence:** the test run before and after the break-test.

### Task 3: State the rule where the section is requested

**Depends on:** None. It can run alongside Task 2.

**Files:**
- Modify: `src/prompts.ts` (`openDecisionsSchema`)
- Modify: `test/prompts.test.ts` (`CONSTRAINT_STRINGS`)

**Steps:**
- Change: after `Every non-blank line in this section is one open decision and nothing else.`, add one source line (memory: a pinned phrase split across a template-literal wrap fails the scan):
  `${indent}  This section is the only place an open question is listed, including one another specification already records, such as the specification this feature was split from: never list one under another heading or by its ID in another section.`
- Add `This section is the only place an open question is listed` to `CONSTRAINT_STRINGS`, immediately before the `// What a criterion may say` comment. `CRITERION_QUALITY_RULE` is `CONSTRAINT_STRINGS.slice(-5, -2)`, counted from the end, so an insertion above the criterion-quality block leaves it selecting the same three strings; an insertion among the last five would not.
- Verify: `node --test test/prompts.test.ts`
- Expected: all pass. The constraint test finds the new string in the source, and the tests that render the draft, self-critique and reconciliation prompts still pass. The reconciliation prompt still carries "never add a new entry during this revision" immediately after the schema.
- Break-test: remove the sentence from a copy-protected `src/prompts.ts`, confirm the constraint test fails, and restore by SHA-256.

**Task completion evidence:** the test run before and after the break-test.

### Task 4: Where the run now stops

**Depends on:** Tasks 1 and 2.

**Files:**
- Modify: `test/spec-stage.test.ts`

**Steps:**
- Change: one test that drives `runSpecStage` through the file's `fixtureExecutor(scriptPath)`, whose script returns a valid draft to the author dispatch and the Task 1 self-critique artifact to the self-critique dispatch, as the self-critique tests under `// --- self-critique` do. Assert the stage and run end `blocked` with an audit `spec.selfcritique.invalid` whose summary carries the Task 2 reason. Also assert no `spec_review` stage row and no reviewer or reconciler agent run. No test in the file asserts `spec.selfcritique.invalid` today, so this is the first. The profile comes from `freezeUniformProfile`; confirm it freezes `narrationCheck` null before relying on "no Decision-1 request".
- Verify: `node --test test/spec-stage.test.ts`
- Expected: passes. A break-test is not repeated here: Task 2's break-test covers the check, and this test proves only where the existing abort path lands.

**Task completion evidence:** the test run.

### Task 5: Record the rule and the incident

**Depends on:** Tasks 2 and 3.

**Files:**
- Modify: `ARCHITECTURE.md`. In the document-schema paragraph that begins "The optional `## Open decisions` section follows the same rule", add that an open-decision entry line outside the section is refused wherever it appears. Correct "a second or differently spelled one is refused, because its entries would otherwise escape recording", which run 2 showed was incomplete.
- Modify: `docs/hazards.md`, hazard 3. Add a "Measured, 2026-10-17, $0.9690182" paragraph covering three things. First, the incident chain from the table above. Second, the fixture path. Third, what it adds: the prompt stated the section's rule only for questions the design leaves open, so an author treated questions inherited from a parent specification as something else, and a reviewer's correct finding could then be fixed only in the way the no-add rule refuses. State the unmeasured live compliance and the prose-form residual.
- Modify: `.claude/sessions/project-learnings.md`. Update the Current state block to: fix implemented, crew-chatter runs 1 and 2 blocked and their costs, and the next action, which is the operator's choice of re-running feature 1 as a separate paid range.
- Modify: this plan. Set `**Status:** Implemented` and add an implementation record covering what shipped, the break-tests and the unmeasured live behavior.
- Verify: `npm run typecheck`, `npm test` and `npm run check:docs`
- Expected: typecheck clean, every test passes (the known environment-specific `test/cli-operator.test.ts` PowerShell transport case is reported separately if it fails from the tool shell), and `check:docs` exits 0.

**Task completion evidence:** the three command results.

## Implementation record (2026-10-17)

The operator said "implment the plan". All five tasks shipped, uncommitted.
- **Task 1:** the fixture holds the three `result` strings byte for byte, plus provenance. The baseline read confirmed the plan: the draft and the self-critique both validated with no open decisions, and the reconciliation's spec carried `OD-001` and `OD-012` under `## Open decisions`.
- **Task 2:** the refusal names the heading rather than saying "outside that section": `an open decision is listed only under ## Open decisions; this line under ## <heading> starts with an open decision ID: <line>` (or `before the first heading`). Five tests were added to `test/spec-doc.test.ts`, which now has 25, all passing. Two break-tests failed as intended: disabling the check failed the recorded-artifact and refusal-shape tests, and widening the pattern to any mention failed the mention test.
- **Task 3:** the sentence was added to `openDecisionsSchema` and the full sentence pinned as `OPEN_DECISIONS_ONLY_PLACE_RULE`, above the criterion-quality block. Beyond the plan, it is also asserted per prompt: draft, self-critique, and reconciliation, the last checking that the no-add sentence still follows the schema. `test/prompts.test.ts` has 56 tests, all passing. Removing the sentence failed four tests.
- **Task 4:** the stage test feeds the recorded artifact through the self-critique branch. The run ends with the `spec` stage `blocked`, the exact reason in `spec.selfcritique.invalid`, two author runs, no reviewer, and no Decision-1 row. It was also break-tested (beyond the plan): with the check disabled, it fails.
- **Task 5:** `ARCHITECTURE.md` section 8, hazard 3, and the Current state in `.claude/sessions/project-learnings.md` were updated.
- Every mutated file was restored from a copy and compared by SHA-256.
- **Verification:** `npm run typecheck` is clean. `npm run check:docs` is clean, with one expected warning for the crew-chatter target path. The full serial suite ran 1628 tests: 1623 pass, 0 fail, 5 skipped. HEAD was `05803eb` before and after the suite, with no stray commit.

Unmeasured: whether a live author now lists an inherited question under `## Open decisions`. Only a paid re-run of crew-chatter feature 1 shows that, and it needs its own approval.

## Follow-ups, not in this plan

- A split feature's design carries no open decisions from the parent specification, so the feature author found them by reading the parent spec. Whether the split should copy the relevant parent open decisions into each feature design is a design-split question for its own plan (`docs/features/design-split-into-features/plan.md`).
- The prose form (open questions as plain bullets under another heading) is the residual case named under Known blockers. A Decision-1 check for it would need labelled cases and an adoption rule set before any request, as the format checks did.
