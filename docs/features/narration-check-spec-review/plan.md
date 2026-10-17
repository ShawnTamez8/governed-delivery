# Narration Check in Spec Review Implementation Plan

**Status:** Implemented

**Goal:** Each spec-review round asks Microsoft-Decision-1, once per Acceptance criteria entry of the specification the panel reviews, whether the entry carries the author's remark about the document or the work. Each entry flagged at or above the frozen threshold becomes a finding in that round for the reconciler to answer. Every failed request blocks the run, and nothing is retried or skipped.

**Source:**
- Operator, 2026-10-17: "wire narration into the spec stage. Ensure we do not swallow errors." The operator supplied rules: no empty catch, no `|| true`, no ignored return codes, no silent fallback, no broad catch to hide a crash, and no retry or timeout increase in place of a fix.
- Operator decisions the same day:
  - **On a flag:** "Finding for the reconciler".
  - **Variables not set:** "Explicit per-run switch". `new-run` refuses unless the three `SYSTEMONE_*` variables are set or `--no-narration-check` is given.
  - **Data:** "Yes, all projects".
- Evidence: `docs/features/decision-1-format-checks/plan.md`, "Evaluation record". The check passed the confirmed rule at T = 0.8. It caught 3 of 3 remarks, flagged 0 of 128 criteria, and its ten repeats all answered 0.999.

**Hazards considered:**
- 1: the extractor still parses every model reply; this check reads only Decision-1's typed answers, validated by `validateSystemOneResponse`.
- 2: every Decision-1 response is retained raw before it is validated.
- 3: the remark rule is the section rule the author prompt already states.
- 4: the stand-in server replays recorded Decision-1 bodies only.
- 7: no retry.
- 10: the deployment name is an alias, so the response's model is recorded on each agent run. It has no version, so an upgrade within the name is undetectable; this is an accepted gap the proposal names.
- 11: `new-run --no-narration-check` keeps a default installation able to complete a run without Decision-1.
- 12: the frozen check shows in status and preview.
- 14: a Decision-1 call is a separate service, `configured_standalone`.
- 21: the author prompt already states the rule this check judges.

**Assumptions:**
- **A Decision-1 call is an `agent_run` row.** Section 15 defines an agent run as "what an agent was allowed to see and do, plus what it actually cost and which model actually ran". The row records the following:
  - `agent` and `setting`: `narration-check`;
  - `role`: `reviewer`;
  - `executor`: `systemone`;
  - `requested_model`: the frozen deployment;
  - `effective_model`: the response's `model`;
  - `tokens_in` and `tokens_out`: the response's usage;
  - `cost`: null, because the response reports none and section 11 says to record a gap as a gap;
  - `requested_effort`: null, because Decision-1 has no effort level;
  - `independence`: `configured_standalone`.
  This lets a flagged entry be an ordinary `finding_report` with no schema change to that table. Changing that table would rebuild it and touch every finding reader. Those readers were mapped on 2026-10-17: `src/operator-state.ts`, `src/dashboard/*.js`, `src/code-review-stage.ts` and about 20 test files.
- **The typed answer has one new table,** `check_answer`. It holds one row per question asked: the agent run, the check, the criterion ID, the question and state hashes, the endpoint, the deployment type, the choice, the probabilities, the threshold, whether the entry was flagged, and the finding when it was. The table is audited by the stage's events like every other write.
- **The question is the evaluated question, byte for byte.** It moves from `scripts/systemone-format-cases.ts` to `src/narration-check.ts`, and the evaluation scripts import it from there. The committed evidence test proves the hashes did not move. The profile freezes the question's hash, and the stage refuses a run whose frozen hash differs from the code's.
- **The check runs before each round's panel,** on the same specification the panel reviews. A round whose check fails spends no Claude dispatch. The specification revised by the final round's reconciliation is not checked again, which matches the panel.
- **The finding:**
  - location: the criterion ID, such as `AC-022`;
  - intent key: `criterion-carries-remark`;
  - classification: `current_artifact`;
  - severity: `medium`;
  - subject: templated from the entry, the probability and the section rule.
  The report is validated by `validateReviewerReports` like a reviewer's.
- **Guided mode requires the check.** This follows the approval-key precedent: guided intake requires a public key that `new-run` lets an operator go without. Guided intake refuses by name when the variables are not set.
- **A loopback `http` endpoint is accepted.** The https rule exists because the key is sent to whatever the endpoint names. `http://127.0.0.1`, `http://[::1]` and `http://localhost` never leave the machine, and the tests need them for the stand-in server. Any other `http` endpoint is still refused.
- **The key is read when the stage runs, never frozen.** Its presence is also checked at `new-run`, so a run is not created only to block on a missing key.
- **The dashboard's configuration rows are not extended.** The configuration JSON in status, doctor and the run preview carries the new field. A dashboard row is a follow-up.

**Approach:**
- Freeze `narrationCheck: { endpoint, deployment, deploymentType, threshold, timeoutMs, questionHash } | null` into the profile at `new-run`. It is null only when the operator passed `--no-narration-check`.
- In `runSpecStage`, refuse at configuration time when the frozen question hash differs from the code's or the key is unusable. Each round then asks one request per criterion, in document order. The stage retains the raw response, inserts the agent run and its `check_answer`, and records a flagged entry as that round's finding.
- On any failure, the stage audits `spec.narration.failed` with the client's reason and blocks the stage and the run. That covers a non-2xx status, a timeout, a network error, a body that is not JSON, a failed validation, or an unexpected entry shape.

**Affected areas:**
- New: `src/narration-check.ts`, `src/migrations/009_check_answer.sql`, `test/narration-check.test.ts` and `test/systemone-stand-in.ts`.
- Modified:
  - `src/systemone.ts`, `src/profile.ts`, `src/policy.ts`, `src/store.ts`, `src/run-intake.ts`, `src/cli-args.ts`, `src/cli.ts`, `src/guided-command.ts`, `src/spec-stage.ts`, `src/operator-state.ts`, `src/operator-output.ts`;
  - `scripts/systemone-format-cases.ts`, `scripts/doc-check.mjs` and `.claude/skills/run-buildworks/driver.mjs`;
  - `ARCHITECTURE.md` sections 11, 12, 15 and 23, `CLAUDE.md` and `AGENTS.md` (`new-run`), and `README.md`;
  - tests that spawn `new-run` or pin the configuration and schema.

**Known blockers:**
- **[Verified]** `test/schema.test.ts` and `scripts/doc-check.mjs` pin the table list in four places, which the schema task updates.
- **[Verified]** Tests that spawn `new-run` inherit `process.env`. On the operator's machine the `SYSTEMONE_*` variables are user-scope, so such a test would freeze the check on and then call the real resource. Every test `new-run` gets `--no-narration-check` unless it is testing the check, and those point at the loopback stand-in.
- **[Verified]** `test/cli-operator.test.ts` has one test known to fail from the assistant's shell (`powershell-transport-test-env-specific`).

**Blast radius:**
- **Profile shape.** Every reader of `Profile` gains a field. `invalidProfileReason` refuses a profile without `narrationCheck`, so profiles frozen before this change cannot execute. That is hard rule 3, and nothing has shipped.
- **Intake.** `createRunIntake` gains a required input with three callers: `src/cli.ts`, `src/guided-command.ts`, and `test/run-intake.test.ts` with `test/guided-command.test.ts`.
- **Store.** The schema version becomes 9, so read-only opens of older stores refuse by name (`src/store.ts`). A new table and nullable effort are the only store changes.
- **Spec stage.** Only `runSpecStage`; a profile with `narrationCheck: null` takes today's path exactly.
- **Driver.** `newRunArgs` passes `--no-narration-check` unless the new driver flag `--narration-check` is given, so smoke never calls Decision-1.

**Verification:**
- `npm run typecheck`, `npm run check:docs` and the full `npm test` suite, with HEAD unchanged.
- Each guard named in the tasks is broken on a copy and its test must fail.
- No Decision-1 request reaches the real resource during the suite. The stand-in counts its requests, and no test environment carries the real endpoint.

---

## Tasks

### Task 1: One definition of the narration question

- Create `src/narration-check.ts`. Move these from `scripts/systemone-format-cases.ts`, unchanged: `NarrationAnswer`, `NARRATION_OPTIONS`, `ACCEPTANCE_SECTION_RULE`, `NARRATION_QUESTION_TEXT`, `acceptanceEntries`, the state builder (exported as `narrationState`) and `narrationQuestion`.
- Add `NARRATION_QUESTION_NAME = "narration"`, `NARRATION_POSITIVE = "contains-remark"` and `narrationQuestionHash()`, which is `sha256Hex(JSON.stringify(narrationQuestion()))`, the hash the evaluation recorded.
- The scripts import from `src/narration-check.ts`, and `scripts/systemone-format-evaluation.ts` uses `NARRATION_QUESTION_NAME` for the check's name.
- Verify: `node --test test/systemone-format-cases.test.ts test/systemone-format-evaluation.test.ts test/systemone-format-evidence.test.ts`. All pass, so the recorded question and state hashes are unchanged.

### Task 2: The client's loopback rule and raw text

- `readSystemOneConfig` also accepts `http:` when the hostname is `127.0.0.1`, `[::1]` or `localhost`. The refusal text for every other endpoint is unchanged.
- `askSystemOne`'s success outcome adds `text`, the raw body, and `durationMs`. Failures already carry `body`.
- Tests in `test/systemone.test.ts` cover the following, and breaking the hostname check fails them:
  - a loopback `http` endpoint is accepted;
  - `http://example.com` and the recorded endpoint as `http` are still refused;
  - a success carries the replayed body byte for byte.

### Task 3: The frozen switch

- `src/policy.ts`: `NARRATION_THRESHOLD = 0.8`, from the evaluated rule. `SYSTEMONE_REQUEST_TIMEOUT_MS` is now frozen, and its comment says so.
- `src/profile.ts`:
  - `NarrationCheckConfig { endpoint; deployment; deploymentType; threshold; timeoutMs; questionHash }`.
  - `Profile.narrationCheck: NarrationCheckConfig | null`.
  - `freezeProfile` takes it as its last argument, which defaults to null for existing test callers. `createRunIntake` always passes it.
  - `invalidProfileReason` refuses a profile without the field ("predates the field"), and an object that is not exactly that shape. The rules are non-empty strings, a threshold in (0, 1], a positive integer timeout, and a 64-hex question hash.
- `src/run-intake.ts`:
  - `RunIntakeInput.narrationCheck: "on" | "off"` is required.
  - Before the run row, "on" reads `readSystemOneConfig` and `readSystemOneKey` from `options.env` (default `process.env`) and throws the reader's reason, with ` (or pass --no-narration-check)` appended for `new-run`.
  - "on" builds the frozen config from the values read, `NARRATION_THRESHOLD`, `SYSTEMONE_REQUEST_TIMEOUT_MS` and `narrationQuestionHash()`.
  - It audits `run.narration` with the endpoint, deployment, type and threshold, or `off`.
- `src/cli-args.ts` and `src/cli.ts`: the `new-run` flag `no-narration-check`, with a help note.
- `src/guided-command.ts`: passes "on"; a refusal names the variables.
- Tests in `test/run-intake.test.ts` and `test/profile.test.ts`, each broken once:
  - "on" with each variable missing refuses before any run row;
  - "on" with a missing key refuses;
  - "off" freezes null;
  - "on" freezes the read values;
  - a profile without the field, or with a wrong shape, is refused.

### Task 4: The answer table

- `src/migrations/009_check_answer.sql` creates `check_answer` with these columns: `id`, `agent_run_id`, `check_name`, `subject`, `question_hash`, `state_hash`, `endpoint`, `deployment_type`, `choice`, `probabilities`, `threshold`, `flagged` and `finding_id`.
  - `agent_run_id` is `NOT NULL UNIQUE REFERENCES agent_run(id)`.
  - `check_name` has `CHECK (check_name IN ('narration'))`.
  - `probabilities` is JSON text.
  - `flagged` has `CHECK (flagged IN (0, 1))`.
  - `finding_id` references `finding(id)` and is non-null exactly when flagged.
  - The file ends with `PRAGMA user_version = 9;`.
- `src/store.ts`: `CheckAnswerRow`, `insertCheckAnswer` (refuses an unknown check name or a flagged answer without a finding) and `getCheckAnswers(stageId)`. `AgentRunInput.requestedEffort` becomes `string | null`.
- `ARCHITECTURE.md` section 15's schema block gains the table. `scripts/doc-check.mjs` `PINNED_TABLES` gains it, and so do both lists in `test/schema.test.ts`.
- Tests: `test/store.test.ts` (insert, both refusals) and `test/migrate.test.ts` (the count follows the directory).

### Task 5: The check in `runSpecStage`

- At configuration time, before any stage row, when `profile.narrationCheck !== null`:
  - refuse when `questionHash !== narrationQuestionHash()` ("the narration question changed since run start");
  - refuse when `readSystemOneKey(process.env)` fails.
- At the start of each round, before the panel, the stage calls `runNarrationRound` from `src/narration-check.ts` with the store, the review stage, the run, the round, the reviewed spec text, the frozen config, the key and the root directory. Then, for each entry of `acceptanceEntries(specContent)`, in order:
  - Take the entry's criterion ID from `^- (AC-\d{3,}): `. An entry without one fails the round. `validateSpecDoc` makes that unreachable, so the failure names it as a defect.
  - Send the request.
  - Retain the raw request and outcome (status, request IDs, body) with `writeRawOutput` before branching.
  - On a failed outcome, return failure with `narration request for <ID> failed: <reason>`, naming the retained file.
  - On success: insert the agent run, decide `flagged` as `choice === contains-remark && P ≥ threshold`, record a flagged entry through `validateReviewerReports`, `upsertCanonicalFinding` and `insertFindingReport`, insert the `check_answer`, and audit `spec.narration.answer` with the ID, choice, probability and flag.
  - The function returns the round's reports for the reconciler input.
- `runSpecStage` aborts with `spec.narration.failed` on any failure. It adds each flagged report to `roundReports` and `roundFindings` beside the panel's.
- Tests in `test/spec-stage.test.ts` use the stand-in, which replays recorded answer bodies from `test/fixtures/recorded/systemone-format-checks-evaluation.json`: N-wc-numbering-L049's `contains-remark` 0.980, and a criterion answered `criterion`. Each guard is broken once:
  1. a clean spec records one answer per criterion and no finding;
  2. a flagged entry becomes a round finding the reconciler receives, and its `check_answer.finding_id` names it;
  3. a 500 from the stand-in blocks the stage and run with the reason, after retaining the body, with no panel dispatch;
  4. a body that fails validation blocks;
  5. a timeout blocks;
  6. a changed question hash refuses before any stage row;
  7. a missing key refuses before any stage row;
  8. `narrationCheck: null` sends nothing.

### Task 6: What the operator sees

- `src/operator-state.ts`: `RunConfiguration.narrationCheck`.
- `src/operator-output.ts`: `formatRunPreview` adds one of two lines:
  - "Narration check: off (new-run --no-narration-check)."
  - "Narration check: one Decision-1 request per acceptance criterion per spec-review round to <deployment> at <endpoint>, flagged at P ≥ <T>; not counted in the dispatch ceilings; any failed request blocks the run."
- The tests that pin the configuration's keys and the preview text are updated.

### Task 7: The driver and test spawns

- `driver.mjs`: `newRunArgs` appends `--no-narration-check` unless the driver was given `--narration-check`. `SKILL.md` names the flag.
- Every test spawn of `new-run` passes `--no-narration-check`, except those testing the check. The direct `createRunIntake` calls pass `narrationCheck` explicitly.

### Task 8: The documents

- `ARCHITECTURE.md`:
  - section 11: Decision-1 is a second concrete client, not a harness, with no interface above it;
  - section 12: the narration check in spec review;
  - section 15: the table and the agent-run reading;
  - section 23: the 2026-10-17 decision.
- `CLAUDE.md` and `AGENTS.md`, identically: `new-run --no-narration-check`.
- `README.md`: the operator variables.
- `docs/proposals/decision-1-review.md`: the narration check adopted.
- Plan status `Implemented` with an implementation note.

## Implementation record

Implemented 2026-10-17, uncommitted, with no Decision-1 or provider spend. Where the build differs from the tasks above:
- The Task 5 tests are in `test/narration-check.test.ts`, not `test/spec-stage.test.ts`, as **Affected areas** lists. It has nine tests, the eight cases plus one proving the frozen question is the one the evaluation sent.
- The seeded policy runs one spec-review round (`SPEC_REVIEW_ROUNDS`). The test that each round asks about its own reviewed specification therefore freezes two rounds. The first draft of that test expected two rounds under the default and failed; the expectation was wrong, not the stage.
- The preview line prints `P >=` rather than `P ≥`, so the text survives a console that is not UTF-8.
- `RunConfiguration.narrationCheck` also reaches `doctor --json`, so the doctor tests pin it.
- `test/guided-command.test.ts` runs its three guided-intake tests against the stand-in. The journey test asserts that narration agent runs record a null cost and every harness run zero.
- `test/cli.test.ts`'s chain walk counts six audit events: `new-run` now also audits `run.narration`.

Verification:
- Every guard was broken once against a copy and restored byte for byte. Each mutation failed at least one test:
  - the stage: 9 mutations;
  - the profile shape: 10 mutations;
  - the client's loopback rule and success `text`, and intake: 7 mutations.
- One mutation first went uncaught: dropping the failed body from the retained record. The failure tests now compare the retained body with the one the stand-in sent.
- `driver.mjs smoke` passed 13 of 13 steps.
- `npm run check:docs` was clean.
- `npm run typecheck` and `npm test` passed, with the one count fix above.
- The tool shell has no `SYSTEMONE_*` variables, so no test could have reached the real resource. A test that created a run with the check on outside the stand-in would have failed at intake.

## Open decisions

- A dashboard configuration row for the check.
- Whether `doctor` should confirm the frozen deployment exists. That needs Azure management credentials (proposal, "doctor").
