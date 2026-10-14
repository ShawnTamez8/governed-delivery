# Implementation Self-Review Implementation Plan

**Status:** Reconciled

**Goal:** The implementer checks its own finished change once before verification and fixes what it finds in the same dispatch; the remediation and phase prompts state the checks run 6's remediation skipped; and both reconciler prompts tell the author to update the parts of the document a change affects.

**Source:** Operator decisions 2026-10-13, given after comparing the `implement-plan` and `reconcile-findings` skills with the BuildWorks prompts: (1) the remediation prompt gains rules to re-check the plan tasks and acceptance criteria that govern the changed code and to look for the same defect elsewhere in scope, and each phase prompt gains a check of its tasks before returning; (2) both reconciler prompts gain the "update dependent sections" rule from `reconcile-findings` Step 4; (3) one self-review dispatch inside the `implementation` stage, after the last phase. Asked as two questions, the operator chose "Find and fix in one go" (shaped like the spec and plan self-critique, not a findings-then-fix pair) and "Once, after the last phase". Operator decisions 2026-10-14, after the code-review reconciler was built: drop the remediation rule that let the implementer leave a finding unfixed when it judged the fix an unstated obligation (the code-review reconciler now withholds such findings, with checks); when the self-review's reply cannot be used, record the skip and continue to verification, while a guard refusal still blocks; and record the self-review's critique in the audit log, bounded. Not in scope: giving the remediator the plan-review decisions, or letting it decline a finding (decision 4 of the 2026-10-13 comparison, left for later); any change to the code-review contract. The evidence is `test/fixtures/recorded/code-review-crew-chatter-run-6.json`, extracted 2026-10-13 from crew-chatter run 6's store, and `test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`.

**Assumptions:**
- **The self-review is a step inside `implementation`, not a new stage.** It runs after the last phase commits and before the stage records `implementation.gate.pass`. The stage sequence, the checker's pinned sequence, `verification`, `code_review` and `delivery_check` stay unchanged; they read the gate event's range, which now ends at the self-review's commit when it changed anything. `CLAUDE.md`'s rule "No code review runs between phases" still holds: the self-review is the author's own pass, not a review panel.
- **It is not independent review (hazard 14).** The same `implementer` agent and setting run it. Code review stays the independent check, and nothing in the documents may describe the self-review as replacing it. Its `agent_run` row carries `independence: "configured_standalone"` like every dispatch (`src/dispatch.ts`); that value describes process isolation, not review independence, and the stage comment and hazard 23 say so.
- **Shape:** one dispatch returns `proposedContentChanges.selfReview.critique` (a non-empty list of strings) and `proposedPatches` (zero or more patches against the stage's last commit). The critique is never empty because "nothing found" is still a statement of what was checked, the same rule `validateSelfCritique` applies. Zero patches is valid and commits nothing. One schema per thing (hard rule 3): `SelfCritique` carries an artifact and a panel request that do not apply here, so the self-review gets its own small validator rather than a union.
- **Reply failures skip; guard failures block.** The self-review runs after every phase has spent, and code review still reads the whole change independently, so a self-review whose reply cannot be used is skipped rather than ending the run. A reply failure is a failed dispatch, a body that does not parse, a result that fails `validateAgentResult`, a status other than `proposed`, a critique that fails `validateImplementationSelfReview`, or a patch envelope with a malformed patch. The stage records `implementation.selfreview.skipped` with the reason, commits nothing, and passes with the last phase's commit as the gate head. A guard failure is a moved head, a dirty tree, or any refusal from `applyProposedPatches`; each shows the boundary failed, so it blocks the run, and the earlier phases' commits stay as evidence. The guard checks run before the reply is read, so a failed dispatch that also mutated the tree blocks. This differs from the spec and plan self-critique, which block on any failure, because those fail before most of a run's money is spent.
- **The critique is recorded in the audit log, bounded, and kept whole in the retained raw output** (`dispatchOnce` stores it with its hash). Each entry becomes one `implementation.selfreview.critique` event; an entry longer than `SELF_REVIEW_AUDIT_ENTRY_CHARS` (2,000 characters) is cut there with a marker naming its full length, and at most `SELF_REVIEW_AUDIT_MAX_ENTRIES` (50) entries are recorded. Both are code constants in `src/implementation-self-review.ts`, not run settings: they bound a record and change no run outcome. The entries do not become `finding` rows: the operator chose the one-dispatch shape, and code-review findings belong to `code_review`.
- **An unchanged file is dropped, not refused.** `applyProposedPatches` refuses a patch whose staged set differs from the proposed set, and a file whose content equals the checkout stages nothing (`src/patch-application.ts`, the staged-set check; the comment in `emit-implementation-stage.mjs` above `phasedFile` records it). A self-review usually finds little to change, so before applying, the stage drops each `modify` file whose blob, as `git hash-object --path=<path> --stdin` computes it from the proposed content, equals the blob at the last commit (`git rev-parse <head>:<path>`). Hashing with `--path` applies the same line-ending and filter conversion `git add` applies, so a file that differs only in line endings under `core.autocrlf` is dropped too. A patch left with no files is removed. The pass event names every dropped path. Phases and remediation keep their current behaviour.
- **The remediation prompt gains two rules, not three.** The code-review reconciler (`docs/features/code-review-reconciler/plan.md`, `Implemented` 2026-10-14) now withholds a finding from remediation when every frozen call rejects it with an exact quote from the approved specification, and remediation receives only the findings it keeps. Its replay rejected run 6's #200 in 10 of 10 calls (`test/fixtures/recorded/code-review-reconciler-replay-crew-chatter-run-6.json`). A prompt rule letting the remediator leave a kept finding unfixed would be a second filter with no quote, no second call and no record beyond the summary, so the remediation prompt carries no such rule. The self-review prompt keeps the no-invention rule, which constrains only what the self-review adds: it has no findings to decline.
- **Cost.** A self-review prompt carries the same spec, plan and full diff a remediation prompt carries. Run 6's remediation dispatch cost $0.5517149 on `claude-sonnet-5-5` (dispatch 68 in the fixture), so the self-review should cost roughly that on a run of that size. [Inference: one dispatch, not measured until a paid run.] A skipped self-review has still spent its dispatch. It saves money only when it prevents a remediation round; it is a quality change first.

**Approach:** Add the prompt rules as single source lines so the constraint scan in `test/prompts.test.ts` finds them. Give the `implementer` a second output, `implementation-self-review`, and require it wherever the implementation group's outputs are checked. Add `src/implementation-self-review.ts` with the result validator and the audit bounds. Add `buildImplementationSelfReviewPrompt`, which opens with the same role line as the phase prompt so the stand-in executor routes it to the same emitter, and carries a marker sentence the emitter checks before it looks for a phase. In `runImplementationStage`, after the phase loop, dispatch the self-review against the last commit, check the boundary, skip on a reply failure, drop unchanged files, apply the rest through `applyProposedPatches`, and record the critique and one pass event. Raise the preview's implementation ceiling by one. Record run 6 as hazard 23 and update the documents that describe the implementation stage, including every sentence that names the gate head.

**Affected areas:** `src/prompts.ts`, `src/implementation-stage.ts`, `src/agents/implementer.ts`, `src/readiness.ts`, `src/operator-state.ts`, `src/operator-output.ts`; new `src/implementation-self-review.ts`; `test/fixtures/harness/emit-implementation-stage.mjs`; the tests named per task; `ARCHITECTURE.md`, `docs/hazards.md`, `scripts/doc-check.mjs`, `CLAUDE.md`, `AGENTS.md`, `.claude/sessions/project-learnings.md`.

**Known blockers:**
- **[Verified]** Changing the implementer's outputs changes the agent registry frozen into each profile. A run created before this change carries an implementer without `implementation-self-review`, so its implementation group refuses by name before any dispatch (`frozenGroupReasons` in `src/operator-state.ts`, and the stage's own check). No live run needs to continue: crew-chatter run 6 is blocked at code review, and its implementation stage has already passed.
- **[Verified]** Tests count implementation dispatches and audit events: `test/implementation-stage.test.ts` (the `COUNT(*)` over `agent_run` near line 303, `assert.equal(rows.length, 1, "one phase, one dispatch")` at line 376, the setting rows near line 839, and the six-phase test near line 1016), `test/cli-operator.test.ts` near line 1845, and `test/delivery-stage.test.ts` near line 470. Each gains one implementer dispatch per implementation stage. This list came from a grep and missed line 376 once, so Task 9 greps `agent_run` and `implementation.` across `test/` again rather than trusting it. The new expected value is derived from the rule (phases plus one), never read from a failing run. `test/implementation-stage.test.ts` near line 700 counts `implementation.patch.apply`; the self-review's apply events are named `implementation.selfreview.patch.apply`, so that count does not change.
- **[Verified]** `emit-implementation-stage.mjs` throws when a prompt has no `This is phase K of N.` sentence (line 27). The self-review prompt has none, so the emitter must check for the self-review marker first.
- **[Verified]** A self-review patch file with unchanged content stages nothing, and `applyProposedPatches` refuses the patch (see the assumption above). The stage drops such files before applying.
- **[Verified]** The self-review prompt carries the whole diff, like the code-review prompt, and `dispatchOnce` refuses a prompt over `PROMPT_MAX_BYTES` (`src/dispatch.ts` line 55). A change too large for that ceiling already blocked at code review. That refusal is a failed dispatch, so the self-review is skipped and code review blocks with the same reason it gives today.
- **[Verified]** The routing test "CLI fixture routes every builder…" in `test/prompts.test.ts` requires one routing entry per exported `build*` function, so the new builder needs one.
- **[Verified]** `docs/features/implementation-phase-retry/plan.md` (`Reconciled`, not built) retries a phase reply that is not valid JSON. It does not cover the self-review, whose bad reply is skipped, never retried.
- **[Verified]** `CLAUDE.md` says "Do not change `spec_review` or `plan_review` while maintaining this loop." Task 4 changes the two reconciler prompts those stages use. The operator authorized that change on 2026-10-13 (decision 2); it is not code-review loop maintenance.

**Blast radius:** (evidence: Grep over `src` and `test`, 2026-10-13, line references rechecked 2026-10-14)
- `buildImplementationAuthorPrompt` is called only by `src/implementation-stage.ts` and tested in `test/prompts.test.ts`. `buildCodeReviewRemediationPrompt` is called only by `src/code-review-stage.ts`. `buildSpecReconcilePrompt` is called by `src/spec-stage.ts`, and `buildPlanReconcilePrompt` by `src/plan-stage.ts`. All four builders appear in the routing test.
- The implementer's `outputs` are read by `src/implementation-stage.ts` line 393, `src/code-review-stage.ts` line 310, `src/readiness.ts` line 238 (`author_bindings`), `src/operator-state.ts` line 541 (`frozenGroupReasons`), and `test/agents.test.ts`. Code review keeps requiring only `patches`.
- `implementation.gate.pass` is parsed by `src/verification-stage.ts`, `src/operator-state.ts` and `src/store.ts` through `formatImplementationGate` / `src/handoff.ts`. Its shape does not change; only its `head` can now be the self-review's commit.
- `formatRunPreview` (`src/operator-output.ts`) is the only place that computes dispatch ceilings, and `test/operator-output.test.ts` checks its text.
- Nothing outside `src/implementation-stage.ts` reads the `implementation.phase.apply` or `implementation.patch.*` audit actions (grep), so the new `implementation.selfreview.*` actions have no existing consumers.

**Verification:** Component: each prompt states its new rules, and the constraint scan finds every rule; the validator accepts the advertised result and refuses each defect, and the audit bounds cut and cap as stated; the stage dispatches the self-review once after the last phase, commits its patches through the guards, drops unchanged files, records the critique and the pass event, skips on each reply failure, and blocks on each guard failure. End to end, as far as free commands reach: the stand-in executor drives a run through implementation with a self-review that fixes a file, verification reads the self-review's commit, and the run passes delivery; a second run whose self-review reply is not JSON also completes. Regression: the focused files per task, `npm run typecheck`, `npm run check:docs`, the full serial suite against zero failures with `git log -1` unchanged afterwards, and the free smoke. A green result does not show that a real model finds or fixes anything in its self-review, or that run 6's round-2 defects would not recur. That needs a paid run, which is a separate decision.

**Hazards considered:**
- **1 (model output shapes):** a new reply shape; the prompt states it whole, with the same escaping rules as the phase prompt, and a reply that does not parse is skipped and recorded, never applied.
- **3 (state the constraint where it is requested):** the critique's non-empty rule, `proposedPatches` being allowed to be `[]`, the rule against returning an unchanged file, the base commit and the scope are all stated in the self-review prompt, and the advertised example validates (Task 7).
- **4 (fixtures agreeing with code):** the emitter builds its self-review patch from the prompt's scope and base commit and from the checkout, as its phase modes do.
- **13 and 16 (inventing obligations):** the run 6 remediation added session invalidation the plan reconciler had refused to invent (#189 in the fixture). The code-review reconciler, built 2026-10-14, now withholds a finding like #200 from remediation with a checked quote; the self-review prompt carries the no-invention rule the reconciler prompts already state. The remediation prompt gains no rule to decline a finding, because that would be an unchecked second filter beside the reconciler.
- **14 (independence):** the self-review is the author's own pass and is never described as review; code review stays the independent check.
- **15 (read-only proposal subprocess):** the self-review dispatch gets head and clean-tree checks after it returns, before its reply is read, and both block; a mode that commits in the checkout proves the head check.
- **17 (answering by deletion):** the "update dependent sections" rule could be read as permission to remove a criterion or task; the rule says each changed node is claimed like any other, and the existing removed-node claims still apply.
- **20 (one dispatch over too much):** the self-review runs once over the whole change. Its prompt is about the size of the code-review prompt, so it meets the same `PROMPT_MAX_BYTES` ceiling, not a new one, and an over-size prompt skips the self-review rather than adding a block.
- **21 (agents told the gate):** the self-review prompt states the frozen verification commands, which run straight after it.
- **22 (ignored-output guard):** not affected; the self-review runs before verification, and the tree is checked clean after it.
- New entry **23** records run 6 (Task 11).

---

## Replay against the motivating failure

Run 6's four round-2 high findings, from the fixture:

- **#208 and #210 (one defect, two reviewers):** the latest edit waited behind a save already in progress, against AC-015. The round-1 remediation put the one-request-in-flight rule back to fix #199. The plan reconciler had removed that rule for AC-015 (#187), and the approved plan the remediator received said "A send is never deferred behind an earlier request". Rule 1 of the remediation prompt and the self-review's "a fix that breaks a task or an acceptance criterion is not a fix" target this.
- **#211:** a 401 on save dropped the unsaved edit. The remediation added `password_changed_at` session invalidation for #200, which the plan reconciler had routed upstream as an obligation the specification lacks (#189). The code-review reconciler targets this: its replay rejected #200 in 10 of 10 calls, quoting the reset-hash sentence, so #200 would not have reached the remediator.
- **#209:** a NUL byte in the email reached Postgres. The defect was already in the round-1 reviewed commit `bb7f3f6`, and the round-1 panel missed it: replaying the round-1 security prompt against that commit found it in 1 of 10 control calls (`control-4`) and in 1 call of the reworded variant (`b-8`) in `test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`. The remediation then fixed the NUL byte in the notes route (#201) only. Rule 2 of the remediation prompt and the self-review's sweep target the missed sweep; neither raises the panel's recall.

What this plan can show without spending: each rule is in the prompt the remediator and the self-review receive. Whether a model follows it is unshown; hazard 21's prompt rule did not stop crew-chatter run 2's lint failure.

## Tasks

### Task 1: Pin run 6's evidence

**Depends on:** None

**Files:**
- Validate: `test/fixtures/recorded/code-review-crew-chatter-run-6.json` (written 2026-10-13 by a read-only store query; it is already in the working tree)
- Validate: `test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`
- Create: `test/code-review-run-6-evidence.test.ts`

**Steps:**
- Read the fixture to the end and confirm its provenance names the run, the store, the capture date and what was dropped.
- Add tests that read the fixture and assert, from its own rows: round 2 has exactly four findings with a `high` report (208, 209, 210, 211); finding 187's decision is `addressed` and one of its `normativeChanges` texts contains "A send is never deferred behind an earlier request"; finding 189's decision is `upstream_follow_up`; `provenance.passwordChangedAtBeforeRemediation` starts with "absent"; finding 201 and 209 both have an intent key containing `nul`. From the security replay fixture, assert that call `control-4` reports a finding located in `backend/src/features/auth/service.ts` whose intent key contains `email`, and that no other `control-` call reports one. These are the facts hazard 23 cites, so the hazard rests on committed data.
- Break it: copy the fixture to the scratchpad, change finding 189's disposition to `addressed` in the working-tree fixture, run only the new test file (it must fail), copy the saved fixture back and confirm its SHA-256 matches the copy.
- Verify: `node --test --test-reporter=tap test/code-review-run-6-evidence.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 2: The remediation prompt's two rules

**Depends on:** None

**Files:**
- Modify: `src/prompts.ts` — `buildCodeReviewRemediationPrompt` and its comment.
- Modify: `test/prompts.test.ts` — `CONSTRAINT_STRINGS`, the remediation prompt test.

**Steps:**
- Read `src/prompts.ts` and `test/prompts.test.ts` to the end before editing.
- After the source line ending "never put a raw line break or tab inside a string literal." and before the blank line that precedes `Approved scope:`, add these two rules, each on its own source line (the sentence "…or agent definitions." sits mid-paragraph in a wrapped line, so it is not the anchor):
  - "Before you return, re-read every task in the approved plan and every acceptance criterion in the approved specification that governs the code you change: a fix that breaks one of them is not a fix, so find a change that keeps both."
  - "When you fix a defect, look for the same defect in every other file of the approved scope and fix it there too."
- Extend the comment above the builder: the two rules come from crew-chatter run 6 (fixture path), one sentence per rule naming the finding it answers (#208/#210 and #209), and one sentence saying the prompt has no rule for declining a finding because the code-review reconciler decides that with checks.
- Add the two sentences to `CONSTRAINT_STRINGS` with a comment naming this plan, and assert in the remediation prompt test that a built prompt contains each one, before `Approved scope:`.
- Break it: delete the second rule from the builder; the constraint test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/prompts.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 3: The phase prompt's task check

**Depends on:** None

**Files:**
- Modify: `src/prompts.ts` — `buildImplementationAuthorPrompt` (`phaseRules`).
- Modify: `test/prompts.test.ts` — the phase-rule tests.

**Steps:**
- Add to `phaseRules`, after "Return at least one file…", one line: "Before you return, read back each task of this phase, and each acceptance criterion whose line in the plan's Coverage section names a file you return, against the files you return, and correct any file that leaves one unmet." A plan's `## Coverage` lines map a criterion to an artifact (`<criterion-id> -> <artifact>`, `src/plan-doc.ts`), so the rule names the link the implementer can read.
- Add the sentence to `CONSTRAINT_STRINGS` and assert it appears in the first, last and only phase prompts.
- Confirm the scraped blocks still end where the emitter expects: the existing scrape-shape test must still pass unchanged.
- Break it: drop the line; the assertion must fail. Restore.
- Verify: `node --test --test-reporter=tap test/prompts.test.ts test/implementation-stage.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 4: The reconcilers update what a change affects

**Depends on:** None

**Files:**
- Modify: `src/prompts.ts` — `buildSpecReconcilePrompt`, `buildPlanReconcilePrompt`.
- Modify: `test/prompts.test.ts` — the two reconciliation prompt tests.

**Steps:**
- In `buildSpecReconcilePrompt`, after the paragraph ending "or return cannot_determine.", add one line: "When a change answers a finding, update every other part of the specification that change affects, such as another acceptance criterion, a declared artifact, or an open decision, so the revised specification stays consistent; each normative node that update adds or removes is claimed in normativeChanges like any other."
- In `buildPlanReconcilePrompt`, after the matching paragraph, add one line: "When a change answers a finding, update every other part of the plan that change affects, such as another task or a coverage line, so the revised plan stays consistent; each normative node that update adds or removes is claimed in normativeChanges like any other."
- Add both sentences to `CONSTRAINT_STRINGS` and assert each appears in its builder's prompt and not in the other's.
- Break it: delete the plan sentence; the constraint test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/prompts.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`
- Expected: all pass, and the break fails. The spec and plan stage tests pass unchanged, because their emitters route on other text.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 5: The implementer's self-review output

**Depends on:** None

**Files:**
- Modify: `src/agents/implementer.ts` — `outputs: ["patches", "implementation-self-review"]`.
- Modify: `src/readiness.ts` — the `author_bindings` list (line 238).
- Modify: `src/operator-state.ts` — `frozenGroupReasons` (line 541): the implementation group requires `["patches", "implementation-self-review"]`; code review still requires `["patches"]`.
- Modify: `test/agents.test.ts`, `test/operator-state.test.ts`, and `test/cli-operator.test.ts` where it asserts the `author_bindings` doctor check (grep `author_bindings` in `test/`; the recorded `doctor-ambient-config-web-calculator-live-chain.json` holds a pass text that does not change and is not edited).

**Steps:**
- Read each file to the end before editing.
- `test/agents.test.ts`: the implementer allows `implementation-self-review`; no reviewer and no other author does (extend the "no reviewer can produce either self-critique result kind" test's forbidden list).
- Add an operator-state test: a frozen profile whose implementer lacks the output gives the implementation group a `setup_required` reason naming it, and the code-review group none.
- In `test/cli-operator.test.ts`, beside the test that removes `spec-split` from the frozen spec author (near line 3120), add one that removes `implementation-self-review` from the frozen implementer and asserts the refusal "configured agent implementer does not allow implementation-self-review output" through the CLI, before any implementation dispatch.
- Break it: remove the output from `frozenGroupReasons`'s implementation list; the operator-state test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/agents.test.ts test/operator-state.test.ts test/cli-operator.test.ts test/profile.test.ts`
- Expected: all pass, and the break fails. A test that pins the frozen agent registry's content updates only the implementer's `outputs`; list each one in the evidence.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 6: The self-review result validator and audit bounds

**Depends on:** None

**Files:**
- Create: `src/implementation-self-review.ts` — `ImplementationSelfReview { critique: string[] }`, `validateImplementationSelfReview(raw: unknown)`, `SELF_REVIEW_AUDIT_ENTRY_CHARS = 2000`, `SELF_REVIEW_AUDIT_MAX_ENTRIES = 50`, and `critiqueAuditEntries(critique: string[]): string[]`.
- Create: `test/implementation-self-review.test.ts`

**Steps:**
- Model the validator on `validateSelfCritique` (`src/self-critique.ts`): refuse by name when the value is not an object, when `critique` is missing, not an array or empty, and when an entry is not a non-empty string. Ignore unknown fields, as `validateAgentResult` does. A doc comment says why it is not `SelfCritique` (hard rule 3) and why the critique is never empty.
- `critiqueAuditEntries` returns at most `SELF_REVIEW_AUDIT_MAX_ENTRIES` strings, in critique order. An entry longer than `SELF_REVIEW_AUDIT_ENTRY_CHARS` is cut to that length and followed by ` (cut at 2000 of <n> characters)`, with both numbers taken from the constant and the entry. A doc comment says the bounds limit an audit record and change no run outcome, which is why they are code constants and not frozen run settings, and that the retained raw output keeps the whole critique.
- Tests: the example the prompt will advertise (Task 7) validates; each refusal above has its own test asserting the reason text; an entry of exactly 2,000 characters is kept whole and one of 2,001 is cut with the marker naming 2001; 51 entries give 50.
- Break it: accept an empty array; the empty-critique test must fail. Restore. Then drop the entry cap; the 51-entry test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/implementation-self-review.test.ts`
- Expected: all pass, and both breaks fail.

**Task completion evidence:** TAP counts and both break-it outcomes.

### Task 7: The self-review prompt

**Depends on:** Task 6

**Files:**
- Modify: `src/prompts.ts` — new export `buildImplementationSelfReviewPrompt(agent, planContent, specContent, scope, head, existingPaths, changedPaths, diff, verification)`.
- Modify: `test/prompts.test.ts` — the routing list (`routingPrompts`), `CONSTRAINT_STRINGS`, new tests.

**Steps:**
- The prompt, in this order (each rule on one source line):
  1. `${IMPLEMENTATION_PROMPT_PREFIX} ${agent.id}`, then the marker sentence "This is your own self-review of the complete change, after the last phase." It must not contain "This is phase", so the emitter cannot mistake it for a phase.
  2. The read-only paragraph from the phase prompt, naming `head` as the checkout's commit.
  3. The checks, each sentence on its own source line, exactly:
     - "Read back every task in the approved plan and every acceptance criterion in the approved specification against the code at this commit, and fix any that the code leaves unmet."
     - "Look for wrong results, unchecked input, races between requests, state left inconsistent after a failure, and errors that are caught and ignored, and fix each one you find."
     - "When you fix a defect, look for the same defect in every other file of the approved scope and fix it there too." (the same sentence as remediation rule 2, so one `CONSTRAINT_STRINGS` entry covers both builders)
     - "A fix that breaks a task or an acceptance criterion is not a fix: find a change that keeps both."
     - "Fix only with behavior the approved specification already requires; never add an obligation the specification does not state, however reasonable it looks."
  4. The reply shape: `{"status": "proposed", "agent": …, "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"selfReview": {"critique": ["..."]}}, "proposedPatches": []}`, then these sentences: "critique holds one entry per problem you found and what you did about it, or one entry saying what you checked when you found nothing." "proposedPatches holds only the files whose content you change, each with its complete new content, and is [] when nothing needs fixing." "Never return a file whose content you did not change."
  5. The patch contract and escaping lines copied from the phase prompt, with "baseCommit must be exactly: ${head}", then the scope block ("Patch only these paths:") and the two existence lists in exactly the phase prompt's shape, so the emitter's scrapers read them.
  6. `verificationCommandsBlock(verification)`, then "These commands run right after this review, and the first that fails blocks the run."
  7. "Changed paths:" with one `- <path>` line each, then the approved plan, the approved specification, and "Complete diff of the change through ${head}:" with the diff last.
- A doc comment names this plan, the operator decisions, hazards 14 and 21, and says the prompt states no consequence beyond the verification commands.
- Tests: the prompt states each rule sentence and the marker, has no `This is phase` text, names `head` as the base commit, carries the scope and both lists in the scraped shape, and ends with the diff; the advertised `selfReview` example validates with `validateImplementationSelfReview` and the advertised result with `validateAgentResult`; add a `routingPrompts` entry routing it to `emit-implementation-stage.mjs` under `IMPLEMENTATION_PROMPT_PREFIX`; add the new rule sentences to `CONSTRAINT_STRINGS`.
- Break it: put "This is phase 1 of 1." into the marker; the no-phase test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/prompts.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 8: The stand-in executor answers the self-review

**Depends on:** Task 7

**Files:**
- Modify: `test/fixtures/harness/emit-implementation-stage.mjs`

**Steps:**
- Before the phase scrape (line 27), branch on the marker "This is your own self-review of the complete change". In that branch, read the base commit and scope from the prompt exactly as the phase modes do, and answer by `EMIT_MODE`:
  - any phase mode (the default): a valid result with one critique entry and `proposedPatches: []`, so every existing test gets a clean self-review;
  - `self-review-fix`: modify the first scope path, appending `// self-review` to its current content read from the checkout;
  - `self-review-unchanged`: modify the first scope path with its current content read from the checkout, byte for byte;
  - `self-review-empty-critique`: `critique: []`;
  - `self-review-not-json`: a result text that is prose, not JSON;
  - `self-review-bad-patch`: one patch with an empty `files` list;
  - `self-review-blocked`: status `blocked`;
  - `self-review-long-critique`: 51 critique entries, the first 2,001 characters long, and no patches;
  - `self-review-out-of-scope`: a patch to `src/never-approved.ts`;
  - `self-review-mutate`: write `unreported.txt`, then the clean answer;
  - `self-review-commit`: commit a change to the first scope path in the checkout with `git`, then the clean answer.
  In the self-review modes, the phases answer as `ok` does, so these modes run against a one-phase plan; a test that needs several phases with a self-review mode is out of this plan.
- Keep the existing header comment's rule: the patch is built from the prompt and the checkout, and a scrape that finds nothing throws.
- Verify: covered by Task 9's tests.

**Task completion evidence:** Task 9's tests exercise every mode.

### Task 9: The stage dispatches the self-review

**Depends on:** Tasks 5, 6, 7, 8

**Files:**
- Modify: `src/implementation-stage.ts` — `runImplementationStage` and its header comment.
- Modify: `test/implementation-stage.test.ts`, `test/cli-operator.test.ts`, `test/delivery-stage.test.ts`.

**Steps:**
- Read `src/implementation-stage.ts` and the three test files to the end before editing.
- Before `store.insertStage`, next to `requireFrozenBinding`, refuse by name when the frozen implementer lacks `implementation-self-review`, so the low-level `implement` command refuses before the stage row and worktree exist. The existing `patches` check stays where it is.
- After the phase loop and before `store.completeStage`, with `base` the head after the last phase:
  1. Compute `existingPaths` at `base`, the changed paths with `git diff --name-only -z headAtProposal base`, and the diff with `git diff --no-color headAtProposal base` (the same commands `src/code-review-stage.ts` uses). A git failure blocks with `implementation.selfreview.failed`.
  2. Dispatch once with `buildImplementationSelfReviewPrompt`, the implementer's frozen model, effort and setting, `role: "author"`, `invocation: { cwd: worktreePath }`.
  3. Whether or not the dispatch succeeded, check the head is still `base` and the tree is clean. Either failure blocks with `implementation.selfreview.failed`, the reason prefixed "self-review: " and naming both heads or the dirty paths.
  4. Read the reply. Each of these skips: the dispatch failed; `extractJsonBody` refuses the body; `validateAgentResult` refuses the result; the status is not `proposed`; `validateImplementationSelfReview(proposedContentChanges.selfReview)` refuses; or `proposedPatches` is present and is not an array of patches each with a string `baseCommit` and a non-empty `files` list whose entries each have a string `path`, `action` and `content`. A skip records `implementation.selfreview.skipped` with `base=<base>; reason=self-review: <reason>` (the reason last, because it is free text), commits nothing, and continues to the gate event.
  5. Drop each `modify` file whose `git hash-object --path=<path> --stdin` blob for the proposed content equals `git rev-parse <base>:<path>`, then remove patches left with no files. A git failure here blocks with `implementation.selfreview.failed`.
  6. When patches remain, apply them with `applyProposedPatches` (`proposalBase: base`, commit message `bw run ${runId}: self-review (base ${base.slice(0, 8)})`, audit actions prefixed `implementation.selfreview.`, so a success is `implementation.selfreview.patch.apply`). Any refusal blocks with `implementation.selfreview.failed`, the reason prefixed "self-review: ". Set `finalHead` to the resulting commit.
  7. Record one `implementation.selfreview.critique` event per string from `critiqueAuditEntries`, then `implementation.selfreview.pass` with `critique=<n>; recorded=<m>; patches=<n>; dropped=<paths or none>; base=<base>; head=<finalHead>`.
- The gate event then records `{ base: headAtProposal, head: finalHead }` as before; after a skip, `finalHead` is `base`.
- Update the header comment: the stage now runs one self-review dispatch after the last phase; reply failures skip and guard failures block, and why; why the self-review is not review (hazard 14), including that its `configured_standalone` row describes process isolation.
- Tests, each against the stand-in executor:
  - a clean self-review: one more `agent_run` row than phases, all with setting `implementer`; no extra commit; the gate head is the last phase's commit; the pass event says `critique=1; recorded=1; patches=0; dropped=none` and one critique event exists;
  - `self-review-fix`: one more commit after the last phase, named `self-review`, and the gate head is that commit; a following `runVerificationStage` reads that head;
  - `self-review-unchanged`: no extra commit, the stage passes, and the pass event names the first scope path under `dropped`;
  - `self-review-empty-critique`, `self-review-not-json`, `self-review-bad-patch` and `self-review-blocked`: the stage passes, a `implementation.selfreview.skipped` event names the defect, no self-review commit exists, and the gate head is the last phase's commit;
  - `self-review-long-critique`: 50 critique events, the first ending with "(cut at 2000 of 2001 characters)", and the pass event says `critique=51; recorded=50`;
  - `self-review-out-of-scope`: the run blocks with `implementation.selfreview.failed`, the reason prefixed "self-review: " and naming `src/never-approved.ts`; the phase commits stay on the branch;
  - `self-review-mutate`: the run blocks with `implementation.selfreview.failed` naming `unreported.txt`;
  - `self-review-commit`: the run blocks with `implementation.selfreview.failed` naming both heads;
  - the self-review prompt the stage sent (its `input_hash` against a prompt rebuilt from the run's own plan, spec, scope and diff) has the last phase's commit as its base.
- In `test/cli-operator.test.ts`, add two full-chain tests beside the one whose executor arguments are `--implementation-mode ok --code-review-mode ok` (line 1078). The first passes `--implementation-mode self-review-fix` and asserts the run completes, the branch log has a `self-review` commit directly after the last phase commit, and the verification and code-review stages name that commit. The second passes `--implementation-mode self-review-not-json` and asserts the run completes with an `implementation.selfreview.skipped` event and no self-review commit.
- Grep `agent_run` and `implementation.` across `test/` for every assertion on implementation dispatch or event counts, including those listed under Known blockers, and update each to phases plus one with a comment naming the self-review.
- Break it, restoring after each: (1) skip the clean-tree check after the self-review; the mutate test must fail; (2) leave `finalHead` unchanged after applying the self-review's patch; the fix test must fail; (3) skip the head check; the commit test must fail; (4) remove the unchanged-file drop; the unchanged test must fail; (5) block instead of skipping on a body that does not parse; the not-JSON test must fail.
- Verify: `node --test --test-reporter=tap test/implementation-stage.test.ts test/verification-stage.test.ts test/code-review-stage.test.ts test/delivery-stage.test.ts test/cli-operator.test.ts test/run-command.test.ts`
- Expected: all pass, and each break fails its named test.

**Task completion evidence:** TAP counts and the five break-it outcomes.

### Task 10: The consent preview counts the self-review

**Depends on:** Task 9

**Files:**
- Modify: `src/operator-output.ts` — `formatRunPreview`.
- Modify: `test/operator-output.test.ts`

**Steps:**
- `implementation: policy.implementationMaxPhases + 1`, with the comment extended: plus one for the self-review after the last phase, which spends its dispatch even when it is skipped.
- The implementation line becomes: "Implementation: one implementer dispatch per ${policy.implementationPhaseTasks} plan tasks, at most ${policy.implementationMaxPhases} phases, then one implementer self-review dispatch; the phase count is known once the plan exists."
- Update the preview test's expected ceiling from the frozen policy (`implementationMaxPhases + 1`), not a literal.
- Break it: drop the `+ 1`; the test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/operator-output.test.ts test/run-command.test.ts test/guided-command.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 11: Documents

**Depends on:** Tasks 2-10

**Files:**
- Modify: `ARCHITECTURE.md` — section 12's `**implementation**` paragraph and its "What phasing does not establish" paragraph; section 20's implementation-phases bullet; section 22's count and list.
- Modify: `docs/hazards.md` — new entry 23.
- Modify: `scripts/doc-check.mjs` — `NUMBER_WORDS` gains `"twenty-three": 23`.
- Modify: `CLAUDE.md` and `AGENTS.md` — the "Phased implementation" section, identically.
- Modify: `.claude/sessions/project-learnings.md` — the Current state block and one dated entry.

**Steps:**
- Read each file's affected section in full, and `ARCHITECTURE.md` and `docs/hazards.md` to the end, before editing.
- Section 12: rewrite the sentence that says the gate event's head "is the last phase's commit" so it reads the last phase's commit, or the self-review's commit when the self-review changed anything. After the phase description, say that one implementer self-review dispatch follows the last phase, reads the whole change with the plan and spec, returns a critique and zero or more patches that pass the same guards, drops a file whose content is unchanged, records its critique in the audit log, is skipped when its reply cannot be used, and blocks the run on a guard failure. Record the operator's authorization (2026-10-13, and the 2026-10-14 decisions) the way the section records earlier authorized changes. Add to "What phasing does not establish": the self-review is the author's own pass, not independent review, and code review still reads the complete net diff once.
- Section 20: the implementation dispatch ceiling is the phase ceiling plus one.
- Hazard 23, "A fix that never sees the decisions behind the code it changes": the measured incident (run 6, 2026-10-13, total $4.83619668; remediation dispatch $0.5517149); the three traces from the Replay section citing both fixtures, including that #209 was in the round-1 reviewed commit and the round-1 panel missed it; the remedies (the code-review reconciler for #211's cause, with checks; the prompt rules of Tasks 2 and 3 and the self-review of Task 9, which are requests); and what they do not show. State plainly that prompt rules mitigate the mechanism and do not close it: the remediator still never sees the plan-review decisions, which is a separate operator decision. State that the self-review's `agent_run` row reads `configured_standalone`, which describes process isolation, not review independence.
- Section 22: "twenty-three failure modes", and append the new mode to its list.
- `CLAUDE.md` and `AGENTS.md`: in "Phased implementation", rewrite "the stage still records one gate event spanning the head before phase one to the last phase's commit" so the span ends at the last phase's commit, or the self-review's commit when it changed anything. After "No code review runs between phases.", add: after the last phase the implementer self-reviews the whole change once in its own dispatch and may return fixes, which commit before verification; an unusable reply skips the self-review and a guard failure blocks the run. Copy the file to the other and compare hashes.
- Learnings: Current state names this plan and its status; the entry records the operator's decisions, the run 6 trace (with #209 found by 1 of 10 control calls) and what remains unproven.
- Verify: `npm run check:docs`; `node -e "const c=require('crypto'),f=require('fs');console.log(['CLAUDE.md','AGENTS.md'].map(p=>c.createHash('sha256').update(f.readFileSync(p)).digest('hex')).join(' '))"`
- Expected: `doc-check: clean` apart from standing warnings; the two hashes are identical; no current-tier document still says the gate head is only the last phase's commit (grep "last phase's commit").

**Task completion evidence:** checker output, the grep, and the two hashes.

### Task 12: Full verification and the free end-to-end walk

**Depends on:** Tasks 1-11

**Steps:**
- `npm run typecheck` — expected: no errors.
- `git log -1 --format=%H` before and after the suite, then the full serial suite with TAP output to a scratch file (`node --test --test-concurrency=1 --test-reporter=tap > <scratch>/suite.tap`). Expected: 0 fail, and the same HEAD before and after (the suite has left empty commits before).
- `node .claude/skills/run-buildworks/driver.mjs smoke` — expected: every step passes.
- The free end-to-end walks are Task 9's two full-chain tests in `test/cli-operator.test.ts`; confirm both are among the passes.
- Expected overall: every check passes; any failure is traced to its cause before anything else changes.

**Task completion evidence:** typecheck output, TAP summary counts, the two HEADs, and the smoke result.

## Open decisions

1. **Give the remediator the plan-review decisions, and record a finding it declines as a typed disposition** so the next panel and the final gate can tell it apart from an unfixed defect (decision 4 of the 2026-10-13 comparison). Not in this plan; it changes the code-review contract in `CLAUDE.md`. This plan gives the remediator no way to decline a finding; the code-review reconciler is the only filter before remediation.
2. **A paid run to see whether the self-review finds anything.** Not authorized by this plan; it needs its own consent and range.
