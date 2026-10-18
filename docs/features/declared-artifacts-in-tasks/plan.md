# Declared Artifacts In Tasks Implementation Plan

**Status:** Implemented

**Goal:** A plan whose `## Tasks` never names a declared artifact is refused at the plan write, before plan review or implementation spend. The spec and plan prompts tell their authors the rule that delivery already enforces: every declared artifact must change.

**Source:**
- Crew-chatter run 3 (feature 1 of the run-1 split, `crew-chatter-accounts-notes`), 2026-10-17. Plan, plan review, three implementation phases, the self-review and verification all passed. `code_review` then blocked before any reviewer was dispatched, with `code_review.artifact.missing: run 3's verified range e6167832f5a9517204dcf98b4957b3879c284c98..f50bc9541220600fb939c385596ef10cb8ef7178 does not deliver declared artifact(s): backend/package.json, frontend/package.json, package-lock.json`. The run's recorded total is $3.43547941. The range after approval cost $2.47315344.
- Operator request 2026-10-17: "write a plan for the fix". The two candidate fixes were a spec rule against conditional declarations and a plan-gate check that every declared artifact has a task, recommended together.

**Hazards considered:**
- 2: the responses this plan depends on are retained raw only in the machine-local target (`.governance/raw/3`, the run-3 worktree). Task 1 copies them into the repository before anything depends on them.
- 3: both new constraints are stated in the prompts of the dispatches they judge, and pinned in `CONSTRAINT_STRINGS`. The plan rule is one source line per sentence so the constraint scan matches it.
- 4: the regression cases are the recorded run-3 spec and plans, and the expected untasked set comes from the run's own `code_review.artifact.missing` audit event, not from this session. The plan-stage emitter builds its task lines from the scope it scrapes out of the prompt, the same way it already builds Coverage.
- 5: delivery's exact-match check is unchanged and stays the backstop. The new gate only moves the most common way to fail it from code review to the plan write.
- 6: this extends "refuse the unkeepable promise at the planning gate" to declared artifacts. The existing gate covers only Coverage lines (`coverageFitsScope`).
- 13: the check invents no obligation. "Every declared artifact must change" is `delivery_check`'s existing rule (`ARCHITECTURE.md` section 12). The check reads only whether a path is named, never what a task says about it.
- 20: a task that names a path and changes nothing can still leave a phase empty. The plan rule tells the author never to invent such a change, and nothing here detects one.
- 21: this is the hazard's own pattern. The author of each artifact was never told the gate that judges it. Run 3's spec author was never told that a declared file must change, and its plan author was never told that every declared file must appear in a task.
- 1, 7, 16, 17 and 23: none. No parser shape, retry, remediation input, normative-node accounting or fix input changes. Task lines that name paths are already normative nodes, and the emitter's new line stays the same before and after reconciliation.

**Assumptions:**
- A declared artifact is named in a task when its exact signed path appears in a `## Tasks` line, bounded on the left by anything except a letter, digit, `_`, `.`, `/` or `-`. On the right, the boundary is anything except a letter, digit, `_`, `/`, `-` or a `.` followed by a word character. So `` `src/a.ts` `` and `src/a.ts.` (sentence end) name `src/a.ts`, while `src/a.tsx`, `frontend/package.json` (for a declared `package.json`) and `./src/a.ts` do not. All three plan prompts already tell the author to copy scope paths verbatim.
- The rule matches the recorded plans that delivered. A scratch scan with this exact bounded match checked every recorded plan document whose specification is also in its fixture: crew-chatter run 6, the doctor live chain (three documents), the PRD reconciliation (two) and the web-calculator reconciliation (two). It found every declared path named in `## Tasks`, and found exactly the three package files missing from run 3's approved plan. Three fixtures carry a plan without its specification (`plan-crew-chatter-run-2.json`, `plan-team-notes-run-6.json`, `plan-team-notes-run-12.json`) and could not be checked. Task 2 re-runs the run-6 case through the real function.
- Run 3's draft plan (agent run 136) already left the three package files out of every task, as did the self-critique (137) and the reconciliation (140). The new gate therefore refuses at the draft write.

**Approach:**
- One pure function, `tasksNameScope(doc, scope)`, in `src/plan-gate.ts` beside `coverageFitsScope`. It returns `{ ok: true }` or `{ ok: false, untasked, reason }`.
- `src/plan-stage.ts` calls it at the same three sites as `coverageFitsScope`: the draft, the self-critique and the reconciliation. The sites check in the same order, after scope fitness, and abort with a new audit action, `plan.artifact.untasked`.
- Two plan-prompt sentences go in all three plan author prompts, after the scope list. One states the rule. The other says never to invent a change to a path that needs none, because the gate's refusal will name such a path so the specification can be corrected. No new status route is added.
- One spec-prompt sentence goes in `specVerificationRule()` (the draft and self-critique prompts) and in the spec reconciliation prompt. It says to declare a file only if the change must create or modify it however it is built. A file that changes only under a choice still open, such as whether to add a dependency, is declared only after that choice is settled in the specification.
- The plan-stage emitter adds one task line naming every scraped scope path. One new variant leaves the last path out.
- Delivery, code review's artifact check, the spec validator and the approval scope are unchanged.

**Affected areas:**
- `src/plan-gate.ts`, `src/plan-stage.ts` and `src/prompts.ts` (three plan builders, `specVerificationRule`, `buildSpecReconcilePrompt`).
- `test/plan-gate.test.ts`, `test/plan-stage.test.ts`, `test/prompts.test.ts`, `test/fixtures/harness/emit-plan-stage.mjs`, and a new fixture `test/fixtures/recorded/plan-crew-chatter-run-3-declared-artifacts-untasked.json`.
- `ARCHITECTURE.md` (section 8's declared-artifacts paragraph and section 12's planning-gate paragraphs), `docs/hazards.md` (new entry 24), and `.claude/sessions/project-learnings.md`.

**Known blockers:**
- A refusal at the plan write blocks the run with no repair round, and the signed spec cannot change inside the run. For a run-3 case the repair is a fresh run whose spec declares only what changes. This plan moves that block about $1.98 earlier: the draft cost $0.4911888 of run 3's $2.47315344 post-approval range. The spec sentence is what lets such a run pass.
- Whether live authors follow either sentence is unmeasured until a paid run, which this plan does not include. Run 3's spec author ignored a close relative of the spec sentence: `specVerificationRule()` already says "never declare an artifact only because a command exists", and it declared `package-lock.json` because of `npm ci`.
- The run-3 worktree and `.governance/raw/3` in `C:\Repositories\testing-repos\crew-chatter` are the only copies of the responses until Task 1 lands. Do not clean that target first.

**Blast radius:**
- `coverageFitsScope` and its three call sites in `src/plan-stage.ts` (draft, self-critique, reconciliation) are the only existing callers, from a repository search. `plan.coverage.unkeepable` appears nowhere outside `src/plan-stage.ts` and its tests, so no operator, doctor or dashboard table maps audit codes that would need the new one.
- Every test that drives `runPlanStage` gets its plans from `test/fixtures/harness/emit-plan-stage.mjs`, directly (`test/plan-stage.test.ts`) or routed through `test/fixtures/harness/emit-cli-run.mjs` (`test/cli.test.ts`, the run-buildworks `driver.mjs smoke`). Today that emitter's tasks are "Build the thing" and "Test the thing", which name no scope path, so every one of those runs would refuse without the emitter change. The plan-stage tests that rewrite the emitter (`fixtureSource().replace(...)`) key on `- Test the thing\n`, the first task line, and `"Build the thing REVISED-plan"`. The new third line leaves all three unchanged. `test/implementation-stage.test.ts`, `test/cli.test.ts`'s binding test, and the others that write `plan.md` directly never reach the plan gate.
- The prompt builders are shared by the stage, `test/prompts.test.ts`, and `test/harness-stream-fixtures.test.ts`, which routes prompts by their words. The new sentences must not contain "self-critique", "plan reviewer", "spec reviewer", "reconcile", "finding" followed by digits, "name only these:", "Approved specification:" or "Verification:". The scope list must still end at its first blank line.
- No schema, migration, profile field, policy knob, CLI surface or dashboard change.

**Verification:** `node --test test/plan-gate.test.ts test/plan-stage.test.ts test/prompts.test.ts`, then `npm run typecheck`, `npm test` serially, `npm run check:docs`, and `node .claude/skills/run-buildworks/driver.mjs smoke`. Each new guard is proven by breaking it (Tasks 2, 3 and 4). The file is copied first, and the restored bytes are compared by SHA-256.

---

## The recorded incident

Run 3 started at `8f539e5`. Its projections were committed as `e6167832f5a9517204dcf98b4957b3879c284c98` on branch `gov/crew-chatter-accounts-notes/3` in `C:\Repositories\testing-repos\crew-chatter\.governance\worktrees\3`. Raw files are under `C:\Repositories\testing-repos\crew-chatter\.governance\raw\3\`.

| Agent run | Dispatch | Raw file | What it did |
|---|---|---|---|
| 107 | spec author draft (Opus 5.5), $0.3495062 | `2026-10-18T02-23-09-713Z-f0acfee98cec.json` | Declared `backend/package.json`, `frontend/package.json` and `package-lock.json`. Its Verification notes said "Any dependency added to `backend/package.json` or `frontend/package.json` must also be recorded in `package-lock.json`." |
| 108, 135 | self-critique and reconciliation | as listed by `agent_run.raw_output_ref` | Kept all three declarations. |
| 136 | plan author draft (Opus 5.5), $0.4911888 | `2026-10-18T02-54-33-141Z-7702f016af72.json` | Named none of the three in any task. |
| 137, 140 | plan self-critique ($0.607459) and reconciliation (Sonnet 5.5, $0.1759177) | `2026-10-18T02-57-54-655Z-a696a705f935.json`, `2026-10-18T03-00-01-308Z-e6b8eaf24322.json` | Named none of the three in any task. The approved plan's Approach says "No new dependencies … So `backend/package.json`, `frontend/package.json` and `package-lock.json` stay unchanged." |
| 141–144 | three phases and the self-review (Sonnet 5.5), $1.186599 | `.governance\raw\3\` | Changed 16 of 19 declared files. The self-review: "No dependencies changed." |

Verification passed on `f50bc95` (`npm ci`, typecheck, lint, build), so the code needed no dependency change. The spec declared files whose change depended on a choice it left open. The plan made that choice and said so in prose. Nothing between the two compared the plan's tasks with the signed scope.

## Tasks

- Task 1: copy the run-3 evidence into the repository.
  - Create `test/fixtures/recorded/plan-crew-chatter-run-3-declared-artifacts-untasked.json` with the keys `provenance`, `spec`, `plan` and `planDraft`, the shape of `test/fixtures/recorded/crew-chatter-run-6-approved-spec-plan.json` plus `planDraft`. Extract with a scratch `.mjs` in the session scratchpad, never a Bash heredoc or `node -e`.
    - `spec` is the approved spec exactly as committed: `git -C C:\Repositories\testing-repos\crew-chatter\.governance\worktrees\3 show e6167832f5a9517204dcf98b4957b3879c284c98:docs/features/crew-chatter-accounts-notes/spec.md`.
    - `plan` is the approved plan from the same commit at `docs/features/crew-chatter-accounts-notes/plan.md`.
    - `planDraft` is `proposedContentChanges.plan` from the `result` line of agent run 136's raw stream file.
  - `provenance` names:
    - the run (crew-chatter run 3, operator-authorized, 2026-10-17), the target path, the starting commit, the projection commit and the blocked range;
    - each source's agent run, model, cost and dispatch time;
    - the capture date;
    - the `code_review.artifact.missing` audit text verbatim, as the source of the expected set;
    - what was dropped: the stream envelope and every result field except the plan document.
  - Verify with a scratch `.mjs` that imports `sha256Hex` and `normalizeText` from `src/canonical.ts` and `validatePlanDoc` from `src/plan-doc.ts` (Node 24 type stripping):
    - `sha256Hex(normalizeText(spec))` is `cb545af5a0cc1558aa79da8c2bbec432c7703cf1570f87a0da967d1dbc2399f6`;
    - `sha256Hex(normalizeText(plan))` is `453b0c8b032bc8f0cc08748fb1ab27ed6d0500a6beda0a2aa14388c0ffd7cde8`;
    - `validatePlanDoc` accepts both plans, and both carry that `plan_for`.

- Task 2: add `tasksNameScope` to `src/plan-gate.ts` and its tests.
  - Change: export `tasksNameScope(doc: PlanDoc, scope: string[]): { ok: true } | { ok: false; untasked: string[]; reason: string }`.
    - `untasked` is every scope entry, in scope order, that no `doc.tasks` line names under the boundary rule in Assumptions. Build the pattern from the regex-escaped path: `(?<![\w./-])<path>(?![\w/-]|\.\w)`.
    - The reason is `plan names declared artifact(s) in no task: <paths joined by ", ">; delivery refuses a declared artifact the change leaves untouched, so every approved scope path must appear, copied verbatim, in a ## Tasks line that changes it`.
    - The doc comment says what the check does not prove: a named path may still be left unchanged, and code review's artifact check stays the backstop (hazards 5 and 20). Like `coverageFitsScope`, it compares exact signed spellings.
  - Tests in `test/plan-gate.test.ts`:
    - The recorded run-3 approved plan against `computeScope(validateSpecDoc(spec).value.declaredArtifacts)` returns `untasked` equal to `["backend/package.json", "frontend/package.json", "package-lock.json"]`, sorted as the audit event lists them. The recorded draft returns the same.
    - The recorded run-6 approved plan against its own spec's scope returns `{ ok: true }`.
    - Boundary cases on a hand-built `PlanDoc` (shapes only, as the existing `planWith` helper does):
      - backticked `` `src/a.ts` `` names `src/a.ts`;
      - `src/a.ts.` at sentence end names it;
      - `src/a.tsx` does not name `src/a.ts`;
      - `frontend/package.json` does not name a declared `package.json`;
      - a path named only outside `doc.tasks` is untasked.
  - Verify: `node --test test/plan-gate.test.ts`. Expected: all pass.
  - Break-test: change the lookbehind to accept any prefix. The `package.json` case must fail. Restore by SHA-256.

- Task 3: call the check at the plan stage's three write sites, and update the emitter.
  - Change `src/plan-stage.ts`: import `tasksNameScope`, and directly after each of the three `coverageFitsScope` refusals add the same shape. Abort with `plan.artifact.untasked` and the function's reason, on `planStage.id` for the draft and the self-critique and on `reviewStage.id` for the reconciliation. Extend the comment above the draft site, which already explains why a free gate runs before the panel, to name this check too.
  - Change `test/fixtures/harness/emit-plan-stage.mjs`:
    - `planDoc` gains an `untasked = false` option and a third task line, `- Change ${paths.map((p) => "`" + p + "`").join(", ")}`, after `- Test the thing`. With `untasked`, it lists every path but the last, and omits the line when that leaves none.
    - Update the file's header comment to say the task line is built from the scraped scope for the same hazard-4 reason as the Coverage lines.
  - New test in `test/plan-stage.test.ts`, beside "coverage outside the approved scope blocks before any reviewer is dispatched": "a declared artifact no task names blocks before any reviewer is dispatched". It rewrites the author branch to `planDoc({ untasked: true })` through `fixtureSource().replace(...)`, as that test does, and asserts:
    - `result.reason` matches `/plan names declared artifact\(s\) in no task: /` and names the scope's last path;
    - author 1, reviewer 0;
    - exactly one `plan.artifact.untasked` audit event;
    - the plan stage and run are `blocked`, and `verifyAuditChain(store)` is null.
  - Verify: `node --test test/plan-stage.test.ts`. Expected: every existing test still passes with the new emitter line, and the new test passes.
  - Break-test: remove the draft-site call. The new test must fail. Restore by SHA-256.

- Task 4: state both rules in the prompts.
  - Change `src/prompts.ts`:
    - In `buildPlanAuthorPrompt`, `buildPlanSelfCritiquePrompt` and `buildPlanReconcilePrompt`, insert these two lines, each on one source line, after the blank line that ends the scope list. In the self-critique and reconcile prompts they go before the "When a critique or a finding says" paragraph; in the author prompt, before `${verificationCommandsBlock(verification)}`:
      - `Name every approved scope path above, copied verbatim, in at least one ## Tasks line that changes it: delivery refuses a declared artifact the change leaves untouched, so the gate refuses a plan that names one in no task.`
      - `Never invent a change to a path that needs none: leave such a path out of ## Tasks, and the gate's refusal will name it so the specification can be corrected.`
    - In `specVerificationRule()`, insert after "The commands are not obligations the design states: …": `Declare a file only if the change must create or modify it however it is built: a file that changes only under a choice still open, such as whether to add a dependency, is declared only after you settle that choice in the specification, because delivery refuses a declared artifact the change leaves untouched.` Add the same line to `buildSpecReconcilePrompt` directly after "Never restate a command as an acceptance criterion."
    - Extend the doc comments of `specVerificationRule`, `buildPlanAuthorPrompt`, `buildPlanSelfCritiquePrompt` and `buildPlanReconcilePrompt` by one sentence each, naming crew-chatter run 3 and this plan.
  - Change `test/prompts.test.ts`:
    - Add `PLAN_TASKS_NAME_SCOPE_RULE` and `PLAN_NO_INVENTED_CHANGE_RULE` to `CONSTRAINT_STRINGS` above the `// What a criterion may say` comment, so `CRITERION_QUALITY_RULE = CONSTRAINT_STRINGS.slice(-5, -2)` is unchanged. Insert the spec sentence into `SPEC_VERIFICATION_SENTENCES` as its fourth entry.
    - In "each plan prompt states the frozen commands …", assert for all three prompts that both plan sentences appear after the scope list and before `VERIFICATION_BLOCK_SENTENCES[0]`. Assert that the scope-list scrape and the routing-word checks there still hold.
    - In "the spec reconciliation prompt states the frozen commands …", assert that the spec sentence appears after `RUN_10_COMMAND_LINES[2]` and before "The revised specification must satisfy the same document schema".
  - Verify: `node --test test/prompts.test.ts test/harness-stream-fixtures.test.ts`. Expected: all pass.
  - Break-test: delete the first plan sentence from `buildPlanReconcilePrompt` only. The plan-prompt test must fail for the reconcile prompt, and the constraint scan must still pass, because the other two builders carry it. Restore by SHA-256.

- Task 5: record the rule in the design and the hazard log.
  - `ARCHITECTURE.md` section 8: after the paragraph on the `Verification:` open decision, add two sentences. Declared artifacts are files the change must create or modify however it is built. The draft, self-critique and reconciliation prompts say so, because delivery refuses a declared artifact the change leaves untouched.
  - `ARCHITECTURE.md` section 12: after "**Refuse promises that cannot be kept.**", add "**Every declared artifact has a task.**" The paragraph says:
    - the planning gate refuses a draft, self-critique or reconciled plan in which some signed scope path appears in no `## Tasks` line (exact path, bounded);
    - it is free and runs before the panel;
    - it proves the path is named, not changed, so delivery's exact match stays the check;
    - a refused run is repaired by a fresh run, because the signed spec cannot change inside one.
  - `docs/hazards.md`: new entry "## 24. A declared artifact nothing will change". It describes the mechanism: the spec declares a file conditionally, the plan resolves the condition the other way, and nothing compares the two before code review. It adds a "**Measured, 2026-10-17, $3.43547941**" paragraph citing the Task 1 fixture and the audit text. A "What answers it" paragraph covers the plan gate (deterministic, run 3 would block after $0.4911888 of post-approval spend) and the two prompt sentences (requests). "What this does not show" covers live compliance, which is unmeasured, and the earlier rule the author ignored.
  - Verify: `npm run check:docs`. Expected: exit 0 with only the expected historical-path warnings.

- Task 6: full validation and the session record.
  - Run `npm run typecheck`, then `npm test` serially. Expected: 0 failures, with the skip count unchanged from the last recorded run (5).
  - Run `node .claude/skills/run-buildworks/driver.mjs smoke`. Expected: the smoke chain completes, spending nothing.
  - Set this plan's Status to `Implemented` and add an implementation record covering files changed, the break-tests and their results, and the test totals. Update the Current state in `.claude/sessions/project-learnings.md`: the fix, its commit state, and that a crew-chatter feature-1 re-run is the live test.

## Implementation record (2026-10-17)

The six tasks were built as written, with one addition and two places where the tests are stronger than the plan asked.

- **Files changed:**
  - `test/fixtures/recorded/plan-crew-chatter-run-3-declared-artifacts-untasked.json` (new). A scratch script checked both hashes and both `plan_for` values given in Task 1.
  - `src/plan-gate.ts` (`tasksNameScope`), `src/plan-stage.ts` (three call sites, `plan.artifact.untasked`), `src/prompts.ts` (`PLAN_TASKS_NAME_SCOPE_RULES` in the three plan builders, `DECLARE_ONLY_WHAT_CHANGES_RULE` in `specVerificationRule()` and `buildSpecReconcilePrompt`).
  - `test/plan-gate.test.ts`, `test/plan-stage.test.ts`, `test/prompts.test.ts`, `test/fixtures/harness/emit-plan-stage.mjs`.
  - `ARCHITECTURE.md` sections 8, 12 and 22, and `docs/hazards.md` entry 24.
  - **Addition:** `scripts/doc-check.mjs` adds `"twenty-four": 24` to `NUMBER_WORDS`. Section 22's count went to twenty-four, and the checker refused a word it could not parse. Hazard 23's plan made the same change.
- **Stronger than planned:**
  - The run-3 test does not hard-code the expected untasked set. It parses the set from the `code_review.artifact.missing` summary that the fixture records verbatim.
  - The boundary test also covers a dotfile and `./src/a.ts`.
  - The plan-stage test asserts the full reason prefix for the emitter's last scope path, `test/a1.test.ts`, and that the audit holds exactly that one reason.
- **Break-tests:** each file was copied first, and after the restore its SHA-256 matched the copy.
  - Removing the `tasksNameScope` lookbehind failed the boundary test.
  - Removing the draft-site call failed the new plan-stage test.
  - Deleting the first plan sentence from `buildPlanReconcilePrompt` failed only the plan-prompt test, for the reconcile prompt.
  - Deleting the spec sentence from `buildSpecReconcilePrompt` failed only the spec-reconcile test.
- **Validation:**
  - `npm run typecheck`: clean.
  - `node --test --test-concurrency=1 test/*.test.ts`: 1633 tests, 1628 pass, 0 fail, 5 skipped.
  - `npm run check:docs`: clean, with only the historical-tier path warnings.
  - `node .claude/skills/run-buildworks/driver.mjs smoke`: 13/13. Smoke does not reach the plan stage, so the emitter change is covered by `test/plan-stage.test.ts` and `test/cli.test.ts`, not by smoke.
- **Not measured:** whether live spec and plan authors follow the new sentences. That needs a paid run, and none is authorized.
