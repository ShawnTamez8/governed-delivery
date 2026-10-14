# Code-Review Reconciler Implementation Plan

**Status:** Implemented

**Goal:** Before each code-review remediation, one or two Haiku calls drop reviewer findings that ask for more than the approved specification requires. A finding is dropped only when both calls agree and both quote the specification's own baseline, so the implementer fixes only findings within the specification. Every dropped finding stays visible to the operator.

**Source:** Operator decisions 2026-10-13. Work list item 1 in `.claude/sessions/project-learnings.md`: build the code-review reconciler. Asked "In which review rounds should the reconciler drop rejected findings?", the operator chose "Before fixes only": rejected findings are not sent to the implementer, and the final panel's severity gate still counts every finding. The rules come from the recommendation recorded with item 1 and are carried over unchanged: a failed check means keep; a rejection needs 2 of 2 calls to agree; rejected findings stay visible to the operator; a quote proves the words exist, not that they support the rejection (hazard 16). Evidence: `test/fixtures/recorded/code-review-reconciler-replay-crew-chatter-run-6.json` (10 calls, $0.0568) and `test/fixtures/recorded/code-review-reconciler-test-5-crew-chatter-run-6.json` (20 calls, $0.0718), both Haiku 5.5 at `medium`, plus `test/fixtures/recorded/code-review-crew-chatter-run-6.json` for the run they replay. This is a separate plan from `docs/features/implementation-self-review/plan.md`, which keeps every change to the code-review contract out of its scope.

**Assumptions:**
- **The reply shape and prompt text are the ones measured.** The prompt is the replay template that calls rec-2 to rec-10 and all 20 test-5 calls used (`reconcilerSource` in the first fixture; test 5's provenance says it was "checked identical by diff"). A keep names a `basis`: an acceptance-criterion ID from the specification, `plan task: ` followed by the task's first five words, or one of `crash`, `data-loss`, `wrong-result`, `unauthorized-access`. A reject carries `rationale` and `excerpt`. Changing the wording would make the 30 measured calls stop describing the built prompt, so no wording changes are allowed beyond the role line, which is identical to the replay's (`you are the code-review reconciler`).
- **The second call runs only when the first rejects something validly.** A rejection needs both calls, so when call 1 has no valid rejection, call 2 cannot change the outcome. The calls therefore run in sequence, not side by side as the panel's do. That costs about 25 seconds per round (measured durations in the fixture) and saves the second call in the common case. In the 30 recorded calls, 10 had no valid rejection.
- **What happens when a check fails:** a call that fails to dispatch, a reply that does not parse, a missing or duplicated decision, or a reject whose excerpt is not in the specification all mean keep for the findings affected. A keep with an unchecked `basis` is still a keep; its basis is recorded as invalid. The one failure that blocks the run is a call that moves the worktree head or leaves the tree dirty (hazard 15), the same rule every other dispatch in the stage follows.
- **When every finding in a non-final round is rejected,** nothing goes to the implementer and the round is decided as a final panel. The frozen severity gate runs over all of that round's findings, rejected ones included, and the stage passes or blocks there. Another panel over the same commit would be a retry that changes nothing (section 19, hazard 7), and the operator's choice keeps the gate counting every finding. A consequence: a high finding that both calls rejected still blocks when it is the round's only finding. The reconciler stops out-of-spec fixes; it never turns a block into a pass.
- **The reconciler can turn a pass into a block.** A rejected finding is not fixed, so the next panel reviews the same code and may report the same concern again. That report is a new round-scoped finding with no decision (intent keys are not stable across rounds), and the final gate counts it. Without the reconciler, the remediator would have fixed it, and the run might have passed. The treatment is also uneven: a rejected high finding blocks at once when every finding in the round is rejected, but blocks only if a reviewer reports it again when some other finding is kept. This follows from the operator's choice that the final gate counts every finding. No recorded data covers it: every out-of-spec finding measured (#200, #905) was `medium`, below the `high` threshold.
- **Rejections are stored as `finding_decision` rows** with disposition `rejected_with_rationale`, the existing schema for a decision on a finding (hard rule 3), with no migration. The row's grounding is `{source: "specification", location: <the approved spec's output_ref>, excerpt: <call 1's excerpt>}`. `agent_run_id` is call 1's run, `rationale` is call 1's rationale, `changed_locations` is `[]`, `normative_changes` is null, and both artifact hashes are the reviewed commit, because the decision changes nothing. Kept findings get no row, so they look exactly as code-review findings do today. Call 2's run ID, rationale and excerpt are kept in the audit event and the round record. `src/operator-state.ts` already reads every `finding_decision` row of a run (line 201), and the dashboard already shows `rejected_with_rationale` as "rejected", so the operator sees rejected findings with no new read path.
- **The setting is new, not `reconciler`.** The spec and plan reconciler takes the run's `--model` (Sonnet 5.5 in practice) and is the part that worked (work list item 6). The code-review reconciler was measured only on `claude-haiku-5-5` at `medium`. So it gets its own setting, `code-review-reconciler`, seeded with that model and effort. Like a reviewer's, its effort moves only through its own `--effort-for`, never the run-wide `--effort`. Following the `reconciler` precedent, its dispatches record the stage's author agent, `implementer`, with role `author` and setting `code-review-reconciler`.
- **The call count is frozen policy.** It bounds dispatches, and `ARCHITECTURE.md` section 20 says "State each limit's value in configuration, not in code, and record in the run which values were in force." So it becomes `CODE_REVIEW_RECONCILER_CALLS = 2` in `src/policy.ts`, frozen as `policy.codeReviewReconcilerCalls`, permitted 2-3. A rejection needs every one of those calls to agree. The floor is 2 because a single call wrongly rejected a must-keep finding once in 30 (test 5, #906). The ceiling exists because every limit needs one; raising the count only makes rejection harder.
- **Earlier frozen profiles stop working.** `invalidDispatchSettingsReason` requires an entry for every setting, and `invalidPolicyReason` requires every policy field, so a profile frozen before this change is refused by name (no migration, hard rule 3). Crew-chatter run 6 is blocked at code review, and work list item 7 (re-run it or not) is a separate decision. A re-run would be a new run in any case.
- **Cost.** At run 6's size (a 125,867-byte prompt), a call cost $0.0036 to $0.0057 on average across the two fixtures. A remediated round adds one or two calls, under $0.012 at that size [measured on that size only]. The "about $0.03 per fix round" given when the operator was asked was an overestimate.

**Approach:** Pin run 6's approved specification and plan as recorded evidence, so the 30 measured calls can be replayed through the real validator. Add the `code-review-reconciler` setting. Add `src/code-review-reconcile.ts` with the reply validator and the agreement rule. Add `buildCodeReviewReconcilerPrompt`, copied from the measured template. Teach the stand-in executor to answer it. In `runCodeReviewStage`, between the `remediate` decision and the remediation dispatch: call the reconciler, store each agreed rejection, send only kept findings to the implementer, and decide the round by the gate when nothing is kept. Then update the round record, the report, the status projection, the dashboard, the consent preview and the documents.

**Affected areas:** `src/policy.ts`, `src/profile.ts`, `src/cli-args.ts`, `src/prompts.ts`, `src/code-review.ts`, `src/code-review-stage.ts`, `src/operator-state.ts`, `src/operator-output.ts`, `src/dashboard/dashboard-model.js`, `src/dashboard/app.js`; new `src/code-review-reconcile.ts`; `test/fixtures/harness/emit-cli-run.mjs`, `test/fixtures/harness/emit-code-review.mjs`; a new recorded fixture; the tests named in each task; `ARCHITECTURE.md`, `docs/hazards.md`, `README.md`, `docs/runbooks/cli-operator.md`, `.claude/skills/run-buildworks/SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/sessions/project-learnings.md`.

**Known blockers:**
- **[Verified]** `CLAUDE.md`'s code-review contract says "Every non-empty panel before the final configured round sends all actionable findings together to the frozen implementer" and that code reviewers "do not create a human gate, waiver, proposal, spike, upstream route, or findings reconciliation schema". `ARCHITECTURE.md` section 12 says code-review remediation "records no finding decision". The operator's 2026-10-13 decision changes both. Task 10 rewrites those sentences, and nothing here touches `spec_review` or `plan_review`.
- **[Verified]** Run 6's approved spec and plan exist only as untracked files in the crew-chatter target (`docs/features/crew-chatter-foundation/spec.md`, 13,791 bytes; `plan.md`, 27,115 bytes). The learnings tell the operator to move them aside before the next `new-run` there. Task 1 copies them into this repository first, checked against the hashes in run 6's store.
- **[Verified]** Tests count code-review dispatches and pin the setting names. `test/code-review-stage.test.ts` asserts `rows.length, 7, "two full panels and one remediation"` (the per-setting effort test, `high-then-clean`). Setting lists are pinned in `test/profile.test.ts` (`NON_REVIEWER_SETTINGS`, the expected settings near line 194, the `without(...)` refusals near line 385), `test/cli.test.ts` (the expected settings near line 1040), `test/dashboard-ui.test.ts` (the sorted setting keys near line 2391), and `test/cli-operator.test.ts` and `test/guided-command.test.ts` ("--model reaches only the one setting with no seeded model", which stays `["reconciler"]`, since the new setting has a seeded model). Every test whose emitter mode reports a finding in a non-final round now also gets one reconciler dispatch. The default reconciler answer keeps everything, so no second call is made and outcomes do not change, only counts.
- **[Verified]** `src/operator-state.ts` accepts a blocked code-review record only when `final.round === profile.policy.codeReviewMaxRounds`. A round decided early because every finding was rejected would be reported as invalid evidence unless that check changes (Task 8). The same branch requires the record's `blocking` to equal the last round's `blocking`. `runCodeReviewStage` sets `roundRecord.blocking` from the round's first decision, which is `remediate` (so `[]`) whenever the reconciler runs, so an early block must reset it (Task 6).
- **[Verified]** A failed dispatch writes no `agent_run` row, and its `agent.dispatch.failed` event names the dispatching agent, `implementer`, with no setting (`src/dispatch.ts`). Only the requested model separates a failed reconciler call from a failed remediation, so the stage's own audit event must name each call's outcome (Task 6).
- **[Verified]** `STAGE_SETTINGS.code_review` in `src/dashboard/app.js` lists `implementer` and the `code-reviewer-` prefix, which `code-review-reconciler` does not match (Task 8).
- **[Verified]** `findingStatus` in `src/dashboard/dashboard-model.js` checks a recorded disposition before the final-panel result. A rejected finding that blocks a round decided early would show as "rejected" when it is actually blocking (Task 8).
- **[Verified]** `selectPromptRoute` in `test/fixtures/harness/emit-cli-run.mjs` requires exactly one prefix match. `you are the code-review reconciler` does not start with any existing prefix (`you are the code reviewer` has a space where it has a hyphen, and `you are the code-review remediator` differs after `code-review `). The routing test in `test/prompts.test.ts` requires one route per exported builder.

**Blast radius:** (evidence: Grep over `src` and `test`, 2026-10-13)
- `decideCodeReviewRound`, the `CodeReviewRound` type and `buildCodeReviewRemediationPrompt` are used only in `src/code-review.ts`, `src/code-review-stage.ts`, `src/prompts.ts`, `test/code-review.test.ts` and `test/prompts.test.ts`. The remediation builder's signature does not change; it receives a shorter findings list.
- The code-review `result.json` round record is read by `parsePassedCodeReviewRecord` (`src/code-review.ts`), which ignores unknown round fields and already allows a passed record whose last round is below `maxRounds`, and by `src/operator-state.ts` (both branches near lines 784-841). `delivery_check` reaches the record only through `parsePassedCodeReviewRecord` and `parseCodeReviewGatePass`, and the shape of the pass event does not change.
- `invalidDispatchSettingsReason` and `resolveDispatchSettings` are private to `src/profile.ts`. Every profile load goes through `invalidProfileReason`, so the new required setting reaches every stage and `doctor`.
- `finding_decision` rows are written by `src/spec-stage.ts` and `src/plan-stage.ts` and read for the gate by `getFindingDecisions(reviewStage.id)`. That read is scoped to its own stage id, so code-review rows never reach the document gates. `src/operator-state.ts` line 201 reads them for the whole run and passes them to the dashboard.
- `formatRunPreview` (`src/operator-output.ts`) is the only code that computes dispatch ceilings.

**Verification:** Component: the validator reproduces the 30 recorded calls' check outcomes on the pinned specification and plan, and the agreement rule applied to those calls rejects no must-keep finding. The prompt carries every static line of the measured template. The stage dispatches the reconciler only before a remediation, sends only kept findings, stores agreed rejections, keeps on every failure, blocks on a dirty tree, and decides an all-rejected round by the gate. End to end, as far as free commands reach: a stand-in full chain where the reconciler rejects one of two findings and the run delivers. Regression: the focused files per task, `npm run typecheck`, `npm run check:docs`, the full serial suite with 0 failures and `git log -1` unchanged afterwards, and the free smoke. A green result does not show that the built stage performs as the replays did on a new run, or how often a live panel's finding is wrongly rejected. Only a paid run shows that, and it is a separate decision.

**Hazards considered:**
- **1 (model output shapes):** a new reply shape. It is parsed with `extractJsonBody`, and any defect means keep, never a block.
- **3 (state the constraint in the prompt):** each checked field (`basis` forms, the `excerpt` copied exactly from the specification, one decision per listed finding) is stated in the prompt the replay measured. Task 4 confirms the constraint scan finds each one.
- **4 (fixtures agreeing with code):** the validator's expected outcomes come from the replay's recorded check (Task 3), and the stand-in's excerpt is scraped from the prompt's own specification block (Task 5), never a literal.
- **2 (output that cannot be diagnosed):** a failed reconciler dispatch is audited under the implementer's name. The `code_review.reconcile.done` event names each call's status, so the audit shows which dispatch failed.
- **7 (retries that vary nothing):** an all-rejected round is decided by the gate instead of re-running a panel over the same commit. Call 2 is a second call on the same input, not a retry of a failure.
- **13 and 16 (inventing obligations):** the motivating case. Run 6 round 1's #200 asked for session invalidation the specification never required, and the remediation that added it produced #211. All 10 replay calls rejected #200 by quoting the reset sentence. Hazard 16's limit applies here as it does there: the excerpt check proves the words exist in the specification, not that they support the rejection. Test 5 recorded one exact-match quote that did not support its rejection (#213). The 2-of-2 rule reduces that risk and does not remove it.
- **14 (independence):** the calls are separate `configured_standalone` dispatches. Nothing describes them as independent review, and they never add findings. They use the same model, prompt and input, so they are not shown to be independent samples. The 2-of-2 rule protects only as far as two calls do not make the same mistake, and no recorded run measures that: test 5's one wrong rejection (#906) never paired up, which is one observation, not a rate.
- **15 (read-only proposal subprocess):** the reconciler runs in the worktree, and the stage checks the head and the clean tree after each call.
- **17 (answering by deletion):** a rejection changes no artifact, and the finding stays in the store and the record. Only the remediation input shrinks.
- **18 (delivery proven, correctness never inspected):** the reconciler reduces what remediation fixes, never what the final panel judges.
- **20 (one dispatch over too much):** the reconciler prompt carries the spec, plan and full diff, like a reviewer prompt, so it meets the same `PROMPT_MAX_BYTES` ceiling. Over that ceiling the dispatch fails, which means keep, and remediation then fails on the same ceiling as it does today.
- **21 (agents told the gate):** not applicable. The reconciler writes no code, and its prompt states no gate, as the review prompts state none.
- **22 (ignored-output guard):** the clean check after each call is the same `checkWorktreeClean` the panel uses. Verification's ignored output is already removed before code review starts.

---

## Replay against the motivating failure

Run 6 round 1 (fixture `code-review-crew-chatter-run-6.json`) had 13 findings. The remediation fixed all of them, including #200 (invalidate sessions on password reset). The plan reconciler had refused to invent that obligation (#189). The fix introduced #211 (a 401 on save drops the unsaved edit), one of round 2's four highs.

Applying this plan's rule to the recorded calls, paired as (1,2), (3,4) … (9,10):
- Replay fixture: #200 is rejected in all five pairs. #207 (either answer allowed) is rejected in none, because no pair has both calls rejecting it. No must-keep finding is rejected.
- Test 5, set 5a (round-2 findings, all keep or either): nothing is rejected. #213's lone rejections never pair up, and #214's excerpt fails the check.
- Test 5, set 5b: #905 (labelled reject) is rejected in 2 of 5 pairs. #906, wrongly rejected once in 10 calls, is rejected in no pair.

So for run 6, round 1's remediation would have received 12 findings, not 13, and the #200 → #211 path would not have been taken. #200 was `medium`, so had round 2 reported it again, the final gate at `high` would not have blocked on it. That holds for run 6 only; a rejected `high` finding reported again would block (Assumptions). Round 2's #208, #209 and #210 are not out-of-spec findings (AC-015 and AC-075). They would still have been reported and, as the final panel, still blocked. The reconciler does not fix run 6. It removes one of its causes. Task 3 turns these counts into tests on the recorded data.

## Tasks

### Task 1: Pin run 6's approved specification and plan

**Depends on:** None

**Files:**
- Create: `test/fixtures/recorded/crew-chatter-run-6-approved-spec-plan.json`
- Create: `test/code-review-reconcile-evidence.test.ts`

**Steps:**
- With read-only queries on crew-chatter's store (`C:\Users\Shawn-work\repositories\testing-repos\crew-chatter\.governance\state.db`, opened through `openDatabase` in `src/sqlite.ts`), read run 6's `approval.spec_hash` and the latest `plan.gate.pass` summary's `planHash`. Read the target's untracked `docs/features/crew-chatter-foundation/spec.md` and `plan.md`. Compute `sha256Hex(normalizeText(content))` (`src/canonical.ts`) for each, and continue only when both hashes match the store. If either differs, stop and report it: the files changed after the run, and the replay inputs cannot be recovered from them.
- Write the fixture `{provenance, spec, plan}`. Provenance names the run, the store path, the two hashes and the queries that produced them, the capture date, the source file paths, and that nothing was dropped.
- Tests: the fixture's spec and plan hash to the recorded values. The set of AC IDs from `validateSpecDoc(spec)` equals the set the replay's regex `^- (AC-\d{3,}):` finds, because the validator in Task 3 uses the first and the replay used the second.
- Break it: copy the fixture to the scratchpad, change one character of the working-tree fixture's `spec`, and run the test; the hash test must fail. Copy the saved fixture back and confirm its SHA-256 matches the copy.
- Verify: `node --test --test-reporter=tap test/code-review-reconcile-evidence.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** the two matching hashes, TAP counts, the break-it outcome.

### Task 2: The `code-review-reconciler` setting and the frozen call count

**Depends on:** None

**Files:**
- Modify: `src/policy.ts` — export `CODE_REVIEW_RECONCILER = "code-review-reconciler"` beside `RECONCILER`, with a doc comment (a setting name, not a registered agent; measured only on Haiku 5.5 `medium`). Add `[CODE_REVIEW_RECONCILER]: { model: "claude-haiku-5-5", effort: "medium" }` to `DEFAULT_SETTINGS`. Export `CODE_REVIEW_RECONCILER_CALLS = 2`, `CODE_REVIEW_RECONCILER_CALLS_FLOOR = 2` and `CODE_REVIEW_RECONCILER_CALLS_CEILING = 3`, with a doc comment giving the floor's reason (Assumptions). Add `codeReviewReconcilerCalls` to `Policy` and `buildPolicy`, to the positive-integer key list `invalidPolicyReason` checks, and a range check beside the `codeReviewMaxRounds` check in the same wording.
- Modify: `test/policy.test.ts` — the same assertions the file makes for `CODE_REVIEW_MAX_ROUNDS` (the built value, the default within its range, the exported-constant list near line 355, and an out-of-range refusal at 1 and at 4).
- Modify: `src/profile.ts` — `resolveDispatchSettings`: `names` gains `CODE_REVIEW_RECONCILER`, and the run-wide `effort` skips it as it skips reviewers. `invalidDispatchSettingsReason`: `required` gains it. Update both doc comments.
- Modify: `src/cli-args.ts` — the `new-run` notes: "each of the nine agents, the reconciler and the code-review reconciler"; a setting name is an agent id, `reconciler` or `code-review-reconciler`; the run-wide `--effort` never reaches a reviewer or the code-review reconciler.
- Modify: `test/profile.test.ts`, `test/cli.test.ts`, `test/dashboard-ui.test.ts` (the sorted keys near line 2391), and any other test Grep finds pinning the setting list (`grep -n "\"reconciler\"" test/*.ts`).

**Steps:**
- Read each file to the end before editing.
- Tests: a frozen profile carries `code-review-reconciler: {model: "claude-haiku-5-5", effort: "medium"}`. `--effort xhigh` leaves it at `medium`. `--effort-for code-review-reconciler=low` and `--model-for code-review-reconciler=<m>` reach it. A profile without the entry is refused with "no entry for code-review-reconciler".
- Break it, restoring after each: (1) remove the run-wide effort exclusion; the `--effort xhigh` test must fail. (2) Lower the floor to 1; the refusal at 1 must fail.
- Verify: `node --test --test-reporter=tap test/policy.test.ts test/profile.test.ts test/cli.test.ts test/run-intake.test.ts test/dashboard-ui.test.ts test/cli-operator.test.ts test/guided-command.test.ts`
- Expected: all pass, and the break fails. List every test changed only because it pins the setting list.

**Task completion evidence:** TAP counts, the break-it outcome, the list of pinned-list updates.

### Task 3: The reply validator and the agreement rule

**Depends on:** Task 1

**Files:**
- Create: `src/code-review-reconcile.ts`
- Create: `test/code-review-reconcile.test.ts`

**Steps:**
- Export `KEEP_BASES = ["crash", "data-loss", "wrong-result", "unauthorized-access"]`.
- Export `validateReconcilerReply(value: unknown, input: { findingIds: number[]; spec: string; plan: string; specLocation: string })`. It returns `{ problems: string[]; decisions: Map<number, ReconcilerDecision> }`, where `ReconcilerDecision` is one of:
  - `{ disposition: "keep"; basis: string; basisValid: boolean }`
  - `{ disposition: "reject"; rationale: string; excerpt: string }`
  - `{ disposition: "unusable"; reason: string }`

  The rules, which are the replay's `check` function:
  - A value that is not an object, or whose `decisions` is not an array, gives every listed finding `unusable`.
  - A finding with zero or more than one entry is `unusable`.
  - An entry for an unlisted finding id is a problem and is otherwise ignored.
  - A reject is valid only when `rationale` is a non-empty string and `groundingTextuallyFails({source: "specification", location: specLocation, excerpt}, "specification", spec)` (`src/reconciliation.ts`) returns null. Otherwise it is `unusable`.
  - A keep's `basis` is valid when it is an AC ID present in `validateSpecDoc(spec)`'s criteria, or `plan task: <words>` whose collapsed words occur in the collapsed plan (`collapseWhitespace`), or one of `KEEP_BASES`. An invalid basis is still a keep, with `basisValid: false` and a problem.
  - Any other disposition is `unusable`.
- Export `agreedRejections(calls: Array<Map<number, ReconcilerDecision> | null>, required: number)`, which returns the finding ids that every one of exactly `required` calls rejected validly. A null entry (a failed call) or fewer than `required` calls returns none. The stage passes `profile.policy.codeReviewReconcilerCalls`.
- A header comment names this plan, the operator decision, the two fixtures, and hazard 16's limit (textual occurrence, not support).
- Unit tests, one per rule above, each asserting the reason or problem text.
- Recorded-data tests, using Task 1's spec and plan and the two reconciler fixtures. The expected values come from the fixtures' own recorded `problems`, written by the replay's check:
  - For each of the 30 calls, the set of finding ids flagged by `validateReconcilerReply` (a basis problem or an unusable reject) equals the set the recorded `problems` names. rec-1 flags 195, 196, 197 and 204 for basis. 5a-7 flags 214 for its excerpt. All others flag nothing.
  - `agreedRejections(pair, 2)` over pairs (1,2) … (9,10) of each set gives: replay, `[200]` in every pair; 5a, `[]` in every pair; 5b, `[905]` for pairs (3,4) and (7,8) and `[]` otherwise. No pair rejects a finding the provenance labels keep.
- Break it, restoring after each: (1) make `agreedRejections` accept one call. The 5a pair results must fail (#213 at 5a-9). (2) Skip the excerpt check. The 5a-7 test must fail.
- Verify: `node --test --test-reporter=tap test/code-review-reconcile.test.ts`
- Expected: all pass, and both breaks fail.

**Task completion evidence:** TAP counts and both break-it outcomes.

### Task 4: The reconciler prompt

**Depends on:** Task 3

**Files:**
- Modify: `src/prompts.ts` — export `CODE_REVIEW_RECONCILER_PROMPT_PREFIX = "you are the code-review reconciler"` and `buildCodeReviewReconcilerPrompt(findings: CodeReviewRemediationFindingInput[], specContent, planContent, diff, reviewedCommit)`.
- Modify: `test/prompts.test.ts` — the routing list, `CONSTRAINT_STRINGS`, new tests.

**Steps:**
- Copy the prompt text from the `prompt` template literal in the first fixture's `reconcilerSource`, word for word: the role line, the working-directory sentence with `reviewedCommit` in place of `HEAD`, the keep, reject and unsure rules, the return shape with one `{"findingId": <id>, …}` entry per finding, the two shapes, then `Findings:`, `Approved specification:`, `Approved plan:`, `Diff of the change:` in that order with the diff last. Render the findings in the replay's form, `- finding <id>; location <location>; intentKey <key>`, then one `  - reviewer <id>; severity <s>; subject <subject>` line per report. That is the remediation input type without its classification, which the replay did not show.
- A doc comment says the text is the measured template and must not be reworded without a new replay, names the fixtures, and says that, like the review prompts, it states no consequence. It also says the basis example `"plan task: Create the notes API in"` comes from crew-chatter and stays on purpose: every run receives it, a model that copies it gives an invalid basis, and an invalid basis still keeps the finding.
- Tests:
  - Every non-interpolated line of the fixture's template appears in the built prompt in the same order. Extract them from `reconcilerSource` in the test, never from a literal written here.
  - The prompt starts with the prefix and ends with the diff.
  - `selectPromptRoute` routes it to `emit-code-review.mjs` (Task 5 adds the route).
  - The two rule sentences that carry checked constraints ("A rejection must quote that baseline: words copied exactly from the approved specification, which the system checks." and the "The decisions list has exactly one entry per finding id listed below, no more and no fewer." sentence) are added to `CONSTRAINT_STRINGS`.
- Break it: drop the "When you are unsure, keep the finding" sentence. The template-line test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/prompts.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 5: The stand-in executor answers the reconciler

**Depends on:** Task 4

**Files:**
- Modify: `test/fixtures/harness/emit-cli-run.mjs` — import the new prefix and add a `PROMPT_ROUTES` entry to `emit-code-review.mjs`.
- Modify: `test/fixtures/harness/emit-code-review.mjs`

**Steps:**
- Before the remediation branch, add a reconciler branch on `stdin.startsWith("you are the code-review reconciler")`. It scrapes the listed finding ids and intent keys from the `- finding <id>; location …; intentKey <key>` lines, and the first acceptance-criterion line's text from the `Approved specification:` block (the line after `- AC-…: `). A scrape that finds nothing throws, as the file's header rule requires. It answers by `EMIT_MODE`:
  - any existing mode (the default): keep every finding with basis `wrong-result`, so no second call is made;
  - `reconcile-reject-one`: reject the finding whose intent key is `beyond-spec-hardening`, with that scraped criterion text as its excerpt, and keep the rest;
  - `reconcile-split`: answer as `reconcile-reject-one` on the first call and keep everything on the second, counting calls in a file under `BW_TEST_RECONCILE_STATE_DIR` (the test creates the directory outside the worktree; the emitter throws when the variable is unset in this mode);
  - `reconcile-reject-all-low` and `reconcile-reject-all-high`: reject every finding with the scraped excerpt;
  - `reconcile-bad-excerpt`: reject `beyond-spec-hardening` with the excerpt `words the specification never says`;
  - `reconcile-prose`: emit prose with `emitRaw`;
  - `reconcile-exit`: exit 3;
  - `reconcile-mutate`: write `reconciler-residue.txt`, then answer as the default.
- Reviewer answers for the new modes. In `reconcile-reject-one`, `reconcile-split`, `reconcile-bad-excerpt`, `reconcile-prose`, `reconcile-exit` and `reconcile-mutate`, before remediation the correctness seat reports `high` at `${first}:1` with intent `needs-remediation`, and the security seat reports `high` at `${first}:2` with intent `beyond-spec-hardening`. After remediation (the `code-review-remediated` marker) every seat reports nothing, as `high-then-clean` does. `reconcile-reject-all-low` reports one `low` from correctness every round. `reconcile-reject-all-high` reports one `high` from correctness every round.
- The remediation branch is unchanged. In `reconcile-reject-one` it additionally throws when its prompt names `beyond-spec-hardening`, so a rejected finding reaching the implementer fails the run loudly.
- Verify: covered by Task 6's tests.

**Task completion evidence:** Task 6's tests exercise every mode.

### Task 6: The stage calls the reconciler before remediation

**Depends on:** Tasks 2, 3, 4, 5

**Files:**
- Modify: `src/code-review.ts` — `CodeReviewRound` gains `reconciliation: CodeReviewReconciliation | null`, with `CodeReviewReconciliation = { calls: Array<{ agentRunId: number | null; status: "valid" | "failed" | "unparsed"; reason: string | null; problems: string[] }>; rejected: Array<{ findingId: number; rationales: string[]; excerpts: string[]; agentRunIds: number[] }>; kept: number[] }`.
- Modify: `src/code-review-stage.ts` — `runCodeReviewStage`, `buildReport`, the header comment.
- Modify: `test/code-review-stage.test.ts`, and count assertions elsewhere (grep each test file that runs a remediating code-review mode: `test/cli-operator.test.ts`, `test/run-command.test.ts`, `test/delivery-stage.test.ts`, `test/operator-state.test.ts`).

**Steps:**
- Read `src/code-review-stage.ts`, `src/code-review.ts` and the test files to the end before editing.
- At entry, beside the seat settings, resolve `resolveSettings(profile, CODE_REVIEW_RECONCILER)`. A missing entry refuses before the stage row.
- Every round record starts with `reconciliation: null`.
- When `decision.action === "remediate"`, before the remediation dispatch:
  1. Build the prompt once from `recordedFindings` (mapped as for remediation), `specContent`, `planContent`, `diff`, `currentCommit`.
  2. Run up to `profile.policy.codeReviewReconcilerCalls` calls in sequence. Each call is `dispatchOnce` with agent `author.id`, role `author`, the resolved model and effort, setting `CODE_REVIEW_RECONCILER`, and `invocation: { cwd: worktreePath }`. After each call, check that HEAD equals `currentCommit` and the tree is clean. Otherwise abort with `code_review.worktree.dirty`, naming "reconciler" and the entries, as the remediation check does. A failed dispatch records `status: "failed"` with its reason. A body that `extractJsonBody` refuses records `unparsed`. Otherwise run `validateReconcilerReply` and record `valid` with its problems. Stop as soon as a call is not `valid` or leaves no finding that every call so far has validly rejected.
  3. `rejected = agreedRejections(calls, profile.policy.codeReviewReconcilerCalls)`. For each rejected finding, `store.insertFindingDecision` as stated under Assumptions, and audit `code_review.reconcile.reject` with `round; commit; finding; agentRuns=<id1>,<id2>; excerpt=<call 1 excerpt>`. The excerpt is free text that may contain `;` or line breaks, so it stays the last field.
  4. Audit `code_review.reconcile.done` with `round; commit; findings; kept; rejected; calls=<status>,<status>`, one status per call made, in order (`valid`, `failed` or `unparsed`). Print one progress line to stderr in the existing style.
  5. Set `roundRecord.reconciliation`.
  6. If no finding is kept, re-decide with `decideCodeReviewRound(withReports, …, false)`. Set `roundRecord.blocking` from that decision (its `blocking` on a block, `[]` on a pass), because the round record was built from the earlier `remediate` decision. Then take the existing pass or block branch unchanged, so the record, the gate event and the stage status are those of a final panel at this round. The block reason adds "every finding was rejected by the code-review reconciler, so the round was decided as a final panel".
  7. Otherwise pass only the kept findings to `buildCodeReviewRemediationPrompt`.
- `buildReport`: for a round with a reconciliation, add `### Reconciliation`, one line per call (status, agent run, problem count), then each rejected finding with its id, location, both rationales and both excerpts, then "Kept: <ids>". When nothing was kept, add "Every finding was rejected, so this round was decided as a final panel."
- Header comment: one paragraph on the reconciler, the operator decision, and why a failed check means keep.
- Tests, each against the stand-in executor:
  - `reconcile-reject-one`: two reconciler `agent_run` rows with setting `code-review-reconciler` and agent `implementer`. One `finding_decision` row (`rejected_with_rationale`, grounding source `specification`, excerpt equal to the spec's first criterion text read from the test's own spec, both hashes equal to round 1's reviewed commit). The remediation dispatch's prompt names `needs-remediation` and not `beyond-spec-hardening`. Round 2 is clean, the stage passes, and the record and report carry the reconciliation.
  - `reconcile-split`: two calls, no decision row, and the remediation prompt names both intent keys.
  - `reconcile-bad-excerpt`, `reconcile-prose`, `reconcile-exit`: exactly one reconciler call, no decision row, both findings remediated, and the run passes at round 2. For `exit`, there is no `agent_run` row with setting `code-review-reconciler`, one `agent.dispatch.failed` event, and a `code_review.reconcile.done` event ending `calls=failed`. For `prose`, that event ends `calls=unparsed`.
  - `reconcile-mutate`: blocks with `code_review.worktree.dirty` naming `reconciler-residue.txt`, with no remediation dispatch.
  - `reconcile-reject-all-low`: passes at round 1 of 2 with no remediation, one decision row, and a gate pass event with `round=1/2; …; findings=1`.
  - `reconcile-reject-all-high`: blocks at round 1 of 2 naming the finding, with no remediation, one decision row, and a `code_review.gate.block` at round 1. The written `result.json` has the same entries in its top-level `blocking` and in round 1's `blocking`. Task 8 adds the projection check over this same stage output.
  - Existing modes: `high-then-clean` and `mixed-then-clean` make one reconciler call each and pass as before. The per-setting test near line 742 becomes 8 rows (two panels, one reconciler, one remediation). Check the reconciler row's model and effort from a refrozen `code-review-reconciler` entry in its own assertion, not in the `efforts` loop, because that loop asserts each setting ran as its own agent, and the reconciler runs as `implementer`.
- Update the other count assertions the grep finds, each with a comment naming the reconciler.
- Break it, restoring after each: (1) pass `recordedFindings` unfiltered to remediation. `reconcile-reject-one` must fail on the emitter's throw. (2) Skip the clean check after the call. `reconcile-mutate` must fail. (3) Make an all-rejected round remediate anyway. `reconcile-reject-all-low` must fail. (4) Leave `roundRecord.blocking` unset after the re-decision. `reconcile-reject-all-high` must fail on the `blocking` equality.
- Verify: `node --test --test-reporter=tap test/code-review-stage.test.ts test/code-review.test.ts test/delivery-stage.test.ts test/run-command.test.ts test/cli-operator.test.ts`
- Expected: all pass, and each break fails its named test.

**Task completion evidence:** TAP counts and the four break-it outcomes.

### Task 7: A full chain where the reconciler rejects a finding

**Depends on:** Task 6

**Files:**
- Modify: `test/cli-operator.test.ts`

**Steps:**
- Beside the full-chain test whose executor arguments are `--implementation-mode ok --code-review-mode ok`, add one with `--code-review-mode reconcile-reject-one`. Assert the run completes, `delivery_check` passes, the branch has exactly one remediation commit, and `bw status --json` lists one code-review finding with a `rejected_with_rationale` decision.
- Verify: `node --test --test-reporter=tap test/cli-operator.test.ts`
- Expected: all pass.

**Task completion evidence:** TAP counts.

### Task 8: The status projection and the dashboard

**Depends on:** Task 6

**Files:**
- Modify: `src/operator-state.ts` — the blocked code-review branch.
- Modify: `src/dashboard/dashboard-model.js` — `findingStatus` and its doc comment.
- Modify: `src/dashboard/app.js` — the "None: code-review findings carry no disposition" text, the status legend near line 1764, and `STAGE_SETTINGS.code_review` with its doc comment.
- Modify: `test/operator-state.test.ts`, `test/dashboard-ui.test.ts`, `test/code-review-stage.test.ts`

**Steps:**
- Read each file's affected function and its tests in full before editing.
- `operator-state.ts`: replace `final.round === profile.policy.codeReviewMaxRounds` with: `final.round === maxRounds`, or `final.round < maxRounds` when every finding id in `final.findings` has a `rejected_with_rationale` decision in the run's decision rows. The gate summary check already uses `final.round`.
- `findingStatus`: for a `code_review` finding, `finalPanelBlocking === true` returns `blocking` before the disposition is read. Then `rejected_with_rationale` returns `rejected`. Then the existing order applies. Update the doc comment: a code-review finding may now carry a reconciler rejection, and a final-panel block outranks it.
- `app.js`: the no-decision text becomes "None: kept for remediation or judged by the final panel". The legend says a rejected code-review finding was dropped from remediation by two agreeing reconciler calls quoting the specification, and that reconciler costs appear under the implementer, because its dispatches record agent `implementer` (as the spec and plan reconciler's record their author). The finding card keeps its separate "Disposition" and "Final panel" rows, so a finding that is both rejected and blocking shows both facts. `STAGE_SETTINGS.code_review.names` gains `code-review-reconciler`, and the doc comment says the reconciler's dispatches are recorded on the `code_review` row.
- Tests:
  - In `test/operator-state.test.ts`: a blocked record decided at round 1 of 2 whose findings all carry rejections is `available`, and the same record with one finding lacking a rejection is invalid.
  - In `test/code-review-stage.test.ts`, over the stage's own output, never a record the test builds (hazard 4): after `reconcile-reject-all-low` and after `reconcile-reject-all-high`, `readRunSnapshot` (`src/operator-state.ts`) over the same store marks the code-review stage `available`. For `all-high`, the finding's `finalPanelBlocking` is `true` and its decision is `rejected_with_rationale`.
  - `findingStatus` returns `blocking` for a rejected code-review finding on a blocking final panel, and `rejected` for one outside the final panel.
  - `stageSettingsText` for `code_review` includes the `code-review-reconciler` pair. The existing test's seeded pair `claude-haiku-5-5 · medium` already appears for the panel, so assert with an override of the `code-review-reconciler` entry that gives a distinct pair.
- Break it, restoring after each: (1) restore the old `=== maxRounds` check. The built-record round-1 test and both stage-output tests must fail. (2) Remove `code-review-reconciler` from `STAGE_SETTINGS`. The `stageSettingsText` test must fail.
- Verify: `node --test --test-reporter=tap test/operator-state.test.ts test/dashboard-ui.test.ts test/code-review-stage.test.ts`
- Expected: all pass, and both breaks fail.

**Task completion evidence:** TAP counts and both break-it outcomes.

### Task 9: The consent preview counts the reconciler

**Depends on:** Task 6

**Files:**
- Modify: `src/operator-output.ts` — `formatRunPreview`.
- Modify: `test/operator-output.test.ts`

**Steps:**
- `code_review`: `policy.codeReviewPanelSize * policy.codeReviewMaxRounds + (policy.codeReviewMaxRounds - 1) * (1 + policy.codeReviewReconcilerCalls)`, with a comment: before each remediation, up to that many reconciler calls.
- The text becomes: "Code review: N reviewers * R panel(s), plus before each of at most R-1 remediation implementer dispatch(es) up to C code-review reconciler dispatches; each remediation is followed by frozen verification; blocking severity S.", with C from `policy.codeReviewReconcilerCalls`.
- Update the test's expected ceiling, computed from the frozen policy, never a literal.
- Break it: drop the reconciler term. The test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/operator-output.test.ts test/run-command.test.ts test/guided-command.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 10: Documents

**Depends on:** Tasks 2-9

**Files:**
- Modify: `ARCHITECTURE.md` — section 10 (the settings: an entry for `code-review-reconciler`), section 12's `**code_review**` text (the remediation paragraph and "This remediation is not document reconciliation…"), section 20's "Code-review panel rounds" bullet (findings on a non-final panel now pass the reconciler before the patch proposal, and the call count is a frozen limit of 2-3).
- Modify: `docs/hazards.md` — entry 16, one paragraph on the code-review counterpart.
- Modify: `CLAUDE.md` and `AGENTS.md` — "Code-review operating contract", and the `driver.mjs` bullet under Commands ("Remediation adds an implementer dispatch and another full three-reviewer panel"), identically.
- Modify: `README.md` (the settings table near line 606 and the `--model` sentence), `docs/runbooks/cli-operator.md` (the settings sentence near line 576), `.claude/skills/run-buildworks/SKILL.md` (the settings sentence near line 107, and the cost paragraph "The historical $1.25–$2.50 budget predates the three-reviewer default", which counts seven dispatches for the remediated path).
- Modify: `.claude/sessions/project-learnings.md`

**Steps:**
- Read `ARCHITECTURE.md` section 12 and `docs/hazards.md` entry 16 in full, and each other file's affected section, before editing.
- Section 12: before a remediation, up to two reconciler calls judge every finding. A finding is withheld from the implementer only when both calls reject it, each quoting the approved specification's baseline exactly. A failed check keeps the finding. A rejection is recorded as a `rejected_with_rationale` finding decision. A round whose every finding is rejected is decided by the severity gate, as a final panel is. The final panel is never reconciled. Replace "records no finding decision" with what it records now. State what the check proves: the quoted words exist, not that they support the rejection. State that a rejected finding reported again by the final panel still counts, so the reconciler can turn a pass into a block.
- Hazard 16: the code-review counterpart, the run 6 trace (#200 → #211), the replay results with their fixtures and costs, and the limit (test 5's #213: an exact quote that did not support its rejection).
- `CLAUDE.md`: "three independent release-policy knobs" becomes four, adding `CODE_REVIEW_RECONCILER_CALLS` (2-3, default 2). In the operating contract, "sends all actionable findings" becomes "sends every finding the code-review reconciler keeps". Add one sentence on the reconciler (2-of-2, keep on any failure, decisions recorded, an all-rejected round decided by the gate, its own setting `code-review-reconciler` on Haiku 5.5 `medium`). Remove "or findings reconciliation schema" from the list of things reviewers do not create, and say the reconciler records rejections in the existing `finding_decision` table. In the `driver.mjs` bullet, remediation also adds up to `CODE_REVIEW_RECONCILER_CALLS` reconciler calls before the implementer dispatch. Copy the file to `AGENTS.md` and compare hashes.
- README, runbook, skill: add the setting to each settings statement. In the skill's cost paragraph, the remediated path is eight or nine dispatches (one or two reconciler calls added to the seven).
- Learnings: Current state names this plan and its status, and item 1 is marked chosen ("before fixes only", 2026-10-13). One dated entry records the decision and the corrected cost estimate.
- Verify: `npm run check:docs`; `node -e "const c=require('crypto'),f=require('fs');console.log(['CLAUDE.md','AGENTS.md'].map(p=>c.createHash('sha256').update(f.readFileSync(p)).digest('hex')).join(' '))"`
- Expected: `doc-check: clean` apart from standing warnings, and the two hashes are identical.

**Task completion evidence:** checker output and the two hashes.

### Task 11: Full verification and the free end-to-end walk

**Depends on:** Tasks 1-10

**Steps:**
- `npm run typecheck`. Expected: no errors.
- `git log -1 --format=%H` before and after the full serial suite, with TAP output going to a scratch file (`node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts > <scratch>/suite.tap`). Expected: 0 fail, and the same HEAD before and after.
- `node .claude/skills/run-buildworks/driver.mjs smoke`. Expected: every step passes.
- The free end-to-end walk is Task 7's full-chain test; confirm it is among the passes.
- Expected overall: every check passes. Trace any failure to its cause before changing anything else.

**Task completion evidence:** typecheck output, TAP summary counts, the two HEADs, and the smoke result.

## Open decisions

1. **A paid run.** Nothing here shows how the built stage performs on a live panel's findings. That needs a run, which needs its own consent and range. It would also be the first measurement of the pass-to-block risk under Assumptions, since no recorded out-of-spec finding was `high`.
2. **The operator accepts the pass-to-block consequence.** A rejected `high` finding that the final panel reports again blocks the run, where the remediator might have fixed it and passed. This follows from the operator's "before fixes only" choice. The plan states it but does not change it. Any change, such as carrying a rejection into the next round, would need a new decision.
3. **The self-review plan's remediation rule 3** ("leave code unchanged when a fix needs a new obligation") is proposed for removal in that plan's review. This plan moves the same judgment earlier and records it, which supports removing it. The decision belongs to that plan's reconciliation.
4. **Giving the remediator the plan-review decisions** (the earlier comparison's decision 4) stays out of scope. The reconciler checks findings against the specification only, as measured.

## Implementation note (2026-10-14)

All eleven tasks shipped, uncommitted, on branch `dashboard-restyling` at HEAD `fd756a7`. The operator accepted open decision 2 by asking for the build ("build it now", 2026-10-13). Decision 1 (a paid run) is still open: nothing here measures the built stage on a live panel.

**Verification.** Both typechecks are clean. `npm run check:docs` is clean apart from standing path warnings. The free smoke passed 13 of 13 steps. The full serial suite ran 1,506 tests: 1,500 passed, 5 were skipped, and 1 failed. HEAD was `fd756a7` before and after, with no leaked commit. The failure was in `test/agents.test.ts`. It pins the seeded setting list through the `RECONCILER` constant, so Task 2's search for the string `"reconciler"` missed it. That test now expects both reconcilers. A break-it that removes the seeded `code-review-reconciler` entry makes it fail. A second full serial run after the fix passed 1,501 of 1,506, with 0 failures and 5 skipped. HEAD was unchanged again. Every break-it each task names failed and was restored by hash. Task 7's full chain passes. The PowerShell approval-transport test, which fails from the assistant's shell, passed in this run.

**Independent review.** One in-session reviewer subagent read the reconciler code against this plan and the operator decisions. It found no high or medium defect. It reported four low text errors, all fixed:
- a stale comment in `src/code-review-stage.ts` about the stage's only author-side dispatch;
- a dashboard legend that assumed exactly two calls;
- a runbook sentence that said the reconciler checks findings "against the code" rather than the approved specification;
- a README cell that called the calls "independent", which hazard 14 above rules out.

Its fifth item was not fixed. `src/operator-state.ts`'s passed code-review branch accepts a pass decided before the last round without checking that every finding there carries a rejection. The blocked branch now checks this. Reaching the gap needs a forged gate event in the hash-chained audit log, so it is a follow-up, not a defect in this change.

**Deviations.**
- The Task 8 stage-output projection tests are in `test/operator-state.test.ts`, built with that file's `withBoundary` helper, rather than in `test/code-review-stage.test.ts`. They still read the record the stage writes, never one the test builds.
- The stand-in emitter checks the remediation input itself in more modes than `reconcile-reject-one`, because the stage does not persist prompts.
- `findingStatus` in `src/dashboard/dashboard-model.js` lost a later `finalPanelBlocking` line that the new first check made unreachable.
- The runbook paragraph on code-review defaults still said two reviewers. It now says three, because the reconciler sentence edited that same paragraph.

**Deferred.** The passed-branch check above. The driver's own `node:sqlite` import (`.claude/skills/run-buildworks/driver.mjs:21`) still prints the experimental notice during `smoke`. That is pre-existing and outside this plan.
