# Usage-Limit Refusal Summary Implementation Plan

**Status:** Proposed

**Goal:** When a dispatch fails because the provider's usage window is exhausted, make the `agent.dispatch.failed` audit summary and the returned reason say so, with the reset time and the refused attempt's own reported cost, instead of only "exited with code 1".

**Source:** Operator statements, 2026-10-07: asked whether a usage-limit refusal should be lived with or handled, then chose "Plan B only" from `docs/proposals/usage-limit-refusal-strands-a-run.md` (option B; options C and D are not authorized and are out of scope). Evidence: crew-chatter run 2 phase 6 ($0.1291114 reported by the refused attempt, recorded by nothing) in `test/fixtures/recorded/crew-chatter-run-2-session-limit-refusal.json`, and team-notes run 8 phase 2 in `test/fixtures/recorded/team-notes-run-8-session-limit-refusal.json`. Both fixtures are written and uncommitted.

**Assumptions:**
- **No lifecycle change.** A refused dispatch still returns `{ ok: false }`, the stage still completes blocked, the run still blocks, nothing resumes. Only the text changes.
- **The recognition rule is the shape both recorded refusals share**, not the later `api_error` field. A failed dispatch is a usage-limit refusal when its stream's last non-empty line is a `result` line with `is_error: true` and `api_error_status: 429`, and the stream holds a `rate_limit_event` whose `rate_limit_info.status` is `"rejected"`. Run 8 (claude CLI 2.1.289) has no `api_error` field; crew-chatter run 2 (2.1.292) has `api_error: "usage_limit_reached"`. A rule keyed on that field would miss run 8.
- **The reset time comes from the last rejected `rate_limit_event`** (`rate_limit_info.resetsAt`, epoch seconds). The result line carries none. It is shown as an ISO UTC instant, so no timezone is computed.
- **The cost is the result line's `total_cost_usd`**, shown as reported. It is not added to the run's recorded cost: nothing structured stores it (open decision 1).
- No new audit action, table, column, policy value, `governed.yaml` key or config. The audit action stays `agent.dispatch.failed`.

**Approach:** Add one pure function, `readUsageLimitRefusal(raw)`, to `src/harness.ts`, beside `parseEnvelope`, which already owns the knowledge of the stream's line kinds. It returns `null` unless the rule above holds, and never throws. In `dispatchOnce` (`src/dispatch.ts`), the `outcome.exitCode !== 0` branch calls it and, when it returns a refusal, appends a fixed sentence after the existing `exited with code N` text. The existing `failed()` helper then appends `(requested model M, effort E)` as it does now, writes the audit event and returns the same string as `reason`, so every stage that aborts with `dispatch.reason` carries the cause with no stage change. Tests replay the two recorded streams through a scratch executor and through the function directly.

**Affected areas:** `src/harness.ts`, `src/dispatch.ts`; a new `test/usage-limit-refusal.test.ts`; the two recorded fixtures; `docs/runbooks/cli-operator.md` (one troubleshooting row); `.claude/sessions/project-learnings.md` (one diagnostics line).

**Known blockers:**
- **[Verified]** The branch to change is `if (outcome.exitCode !== 0) { return failed(\`dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: exited with code ${outcome.exitCode}\`); }` in `src/dispatch.ts`. `failed()` appends ` (requested model ${input.requestedModel}, effort ${input.requestedEffort})` to every detail, writes the audit event and returns the summary as `reason`.
- **[Verified]** Existing tests pin that suffix: `test/dispatch.test.ts` lines 118, 223 (`/exited with code 3 \(requested model claude-opus-5-5, effort xhigh\)$/`) and 363. The new text must go before the suffix and only on the refusal path, so those stay green unchanged.
- **[Verified]** `parseEnvelope` (`src/harness.ts`) accepts the refused stream (one result line, last) and returns its `total_cost_usd` and `result`, but never reads `is_error` or `api_error_status`, so it cannot recognise a refusal and is not changed. `dispatchOnce` does not call it on a non-zero exit.
- **[Verified, two samples]** crew-chatter run 2 phase 6: 2999 ms, two tool calls, `total_cost_usd` 0.12911140000000002, result `api_error: "usage_limit_reached"`, `api_error_status: 429`. team-notes run 8 phase 2: 340 ms, no tool calls, `total_cost_usd` 0, no `api_error` field, `api_error_status: 429`. Both: `is_error: true`, `terminal_reason: "api_error"`, a `rate_limit_event` with `status: "rejected"` and `rateLimitType: "five_hour"` before the synthetic assistant message.
- **[Verified]** Every `dispatchOnce` caller that fails forwards the reason into an audit event or a returned reason: `abort(..., dispatch.reason)` in `src/spec-stage.ts`, `src/plan-stage.ts`, `src/spec-decision-stage.ts`, `src/implementation-stage.ts` (prefixed `phase N of M:`), `src/code-review-stage.ts` (remediation, and a reviewer failure object), and `console.error(result.reason)` in `src/cli.ts`. No caller parses the text of this action. `src/operator-state.ts` prints the last recorded event's summary on a blocked run (line 654, "run N is blocked; last recorded event <action>: <summary>", and line 430), so the new sentence reaches `status` through the stage's abort event (`implementation.author.failed` for an implementation phase).
- **[Verified]** The "failed attempt(s) with unknown spend" count in the operator output counts `agent.dispatch.failed` rows (`src/operator-state.ts`, `src/operator-output.ts`). A longer summary does not change it, and this plan does not change the count's meaning.
- **[Verified by grep]** `src/audit.ts` applies no length limit to `summary`. The new sentence is bounded anyway: the provider message is cut to 200 characters.
- **[Unknown]** Other claude CLI versions and the seven-day window. Only 2.1.289 and 2.1.292 and the five-hour window are recorded. An unrecognised shape falls back to the existing generic text, which is the current behaviour.
- **[Unknown]** Whether a 429 without a rejected `rate_limit_event` occurs. None is recorded, so the rule requires the event and treats a bare 429 as an ordinary failed dispatch.
- **[Verified at planning time]** The working tree holds uncommitted work this plan does not touch: both proposals, both refusal fixtures, `test/fixtures/recorded/plan-crew-chatter-run-2.json`, `test/recorded-plan-task-items.test.ts`, `.claude/sessions/project-learnings.md` and the 2026-10-05 edit in `docs/runbooks/cli-operator.md`. Task 3 edits two of those files again.
- **[Verified]** Known full-suite failures before this change: `test/dashboard-server.test.ts` "dashboard CLI prints one bootstrap URL ... follows platform SIGTERM behavior" and `test/sign-approval.test.ts` "nothing under src/ touches a private key". Compare against that list; do not assume it.

**Blast radius:** (evidence: Grep over `src` and `test`, 2026-10-07)
- `dispatchOnce`: twelve call sites in seven files (`src/code-review-stage.ts` 413 and 621, `src/cli.ts` 316, `src/implementation-stage.ts` 429, `src/plan-stage.ts` 276, 362, 551 and 637, `src/spec-decision-stage.ts` 304, `src/spec-stage.ts` 235, 301, 508 and 594). Signature and result type are unchanged; one new text path on a non-zero exit.
- `src/harness.ts`: one new export, one caller. `invokeHarness`, `parseEnvelope`, the limits and the executor types are untouched.
- Tests that assert a failed dispatch's text: `test/dispatch.test.ts` (118, 223, 363), `test/run-command.test.ts` (323, exit 23), `test/cli-operator.test.ts`, `test/verification-stage.test.ts` and `test/commit-verification.test.ts` (their own "exited with code" strings, from different code). Their fixtures print no result line, so the function returns `null` for them; the files are run in Task 2 to prove it.
- Persisted formats: only the text of one existing audit action changes, for new refusals. The hash chain covers whatever text is written; no stored row is rewritten. Operator output counts the action and also prints the last event's summary for a blocked run (`src/operator-state.ts` lines 430 and 654), so the longer text appears in `status` on one line of about 350 characters; no code truncates it that this planning found. **[Unknown]** how the dashboard renders a summary that long; no task checks it, and the text is plain, so the worst case is a wrapped line.
- Not touched: stages, the frozen profile, the policy, `governed.yaml`, the store schema, `parseEnvelope`, the run lifecycle, `ARCHITECTURE.md` (no section describes the failure text; Grep found none), `CLAUDE.md` and `AGENTS.md`.

**Verification:** Component: `readUsageLimitRefusal` returns the recorded reset time, window, cost and provider message for both fixtures, and `null` for each near miss (`test/usage-limit-refusal.test.ts`). End to end, as far as free commands reach: a scratch executor replays each recorded stream and exits 1; `dispatchOnce` returns a reason and writes one `agent.dispatch.failed` audit event, both carrying the cause, with no `agent_run` row, the raw stream retained and the audit chain valid. Regression: `node --test` on the files above, `npm run typecheck`, `npm run check:docs`, the full serial suite compared with its two known failures, the free smoke. A green result proves the text on two recorded shapes. It does not prove the next CLI version emits the same fields, and it does not make a refused run resumable.

**Hazards considered:**
- **Hazard 2** (discarded output is undiagnosable): the raw stream is already retained before any branch. This change makes the retained evidence's most important fact, the cause, readable without opening the file. It retains nothing new and discards nothing.
- **Hazard 1** (model output arrives in shapes the schema refuses): this reads provider output, so it fails closed. Any line that does not parse, any missing field or any other shape returns `null`, and the generic text is used. The function never throws and never changes an `ok` result.
- **Hazard 4** (fixtures and code agreeing while both are wrong): the expected reset times, windows, costs and messages come from two committed recordings of real refusals, and the ISO strings are cross-checked against the provider's own local-time sentence in each recording (12:50pm and 12:40pm America/Chicago in October are 17:50 and 17:40 UTC). The near-miss streams are derived from the recorded ones by changing one field, not written from scratch.
- **Hazard 7** (retries that vary nothing): nothing retries. The text states the run is refused and says nothing about resuming.
- **Hazard 20** (one dispatch over a plan larger than one response): its rule that a failed phase blocks the run with no retry is unchanged. The `phase N of M:` prefix on the implementation stage's reason already says where the run stopped; this adds why.
- **Hazard 6** (promises a later stage cannot keep): the new text makes no promise. It does not say the run can continue.
- **Hard rules 3 and 4:** no second schema, no union and no abstraction; one plain function with one caller. Hard rule 6: no configuration.
- **Hazards 3, 5, 8-19, 21:** not weighed as design inputs; no prompt, gate, schema, executable resolution or stage sequence changes.

## Replay against the motivating failure

crew-chatter run 2, 2026-10-07: phase 6 of 6 was refused. Its audit rows 191 and 192 read "dispatched agent implementer (author) on stage 9: exited with code 1 (requested model claude-sonnet-5-5, effort medium)" and the same with a `phase 6 of 6:` prefix, and `status` said "1 failed attempt(s) with unknown spend". Replayed against this plan, row 191's summary would read "... exited with code 1: the provider's usage limit refused the dispatch (window five_hour; resets 2026-10-07T17:50:00.000Z; the refused attempt reported cost USD 0.1291114, which no agent_run row records; provider message: \"You've hit your session limit · resets 12:50pm (America/Chicago)\") (requested model claude-sonnet-5-5, effort medium)", and row 192 would repeat it. team-notes run 8 phase 2 would read the same way with window five_hour, reset 2026-10-04T17:40:00.000Z and cost USD 0.

What this does not change: both runs are still blocked with nothing to resume; `status` still prints "1 failed attempt(s) with unknown spend" and the run's known cost still excludes the $0.1291114. The operator reads the cause from the block message instead of opening the retained file.

## Tasks

### Task 1: Recognise the refusal

**Depends on:** None

**Files:**
- Modify: `src/harness.ts` — add `UsageLimitRefusal` and `readUsageLimitRefusal(raw: string)` after `parseEnvelope`.
- Create: `test/usage-limit-refusal.test.ts`.
- Already present, uncommitted: `test/fixtures/recorded/crew-chatter-run-2-session-limit-refusal.json`, `test/fixtures/recorded/team-notes-run-8-session-limit-refusal.json`.

**Steps:**
- Read `src/harness.ts` to end of file before editing, and both fixtures' `provenance` blocks. A fixture holds `refusedStream.init` (a flat object: `line` beside the trimmed init fields), and `.rateLimitEvents`, `.syntheticAssistantMessage` and `.result` (each `{ line, value }`, with `.rateLimitEvents` an array); rebuild a stream by sorting those entries by `line` and writing one `JSON.stringify` per line (the init object without its `line` key, the others their `value`).
- Shape: `UsageLimitRefusal` is `{ resetsAt: number | null; windowType: string | null; costUsd: number | null; providerMessage: string }`. The function: split `raw` on `/\r?\n/`; take the last non-empty line; it must parse as a JSON object with `type === "result"`, `is_error === true` and `api_error_status === 429`, or return `null`. Then look, from the end, at lines containing the text `rate_limit_event`, parse each, and take the last whose `type` is `"rate_limit_event"` and whose `rate_limit_info.status` is `"rejected"`; if none, return `null`. `resetsAt` is that event's `rate_limit_info.resetsAt` when it is a finite number for which `new Date(resetsAt * 1000)` is a valid date (so formatting it can never throw), else `null`; `windowType` its `rate_limit_info.rateLimitType` when a string, else `null`; `costUsd` the result line's `total_cost_usd` when a finite number, else `null`; `providerMessage` the result line's `result` when a string, else `""`. A line that fails to parse is skipped on the event search and returns `null` for the result line. The function does not read `api_error`.
- Tests in `test/usage-limit-refusal.test.ts`, each its own `test(...)`, load both fixtures the way `test/plan-doc.test.ts` loads `RUN_12`. (a) crew-chatter: the rebuilt stream gives `resetsAt` 1791395400 (shown as `2026-10-07T17:50:00.000Z` by `new Date(resetsAt * 1000).toISOString()`, asserted as that literal), `windowType` `"five_hour"`, `costUsd` equal to the fixture result's `total_cost_usd` (0.12911140000000002), and `providerMessage` equal to the fixture result's `result`, which is the sentence ending `resets 12:50pm (America/Chicago)`. (b) team-notes run 8: `resetsAt` 1791135600 (`2026-10-04T17:40:00.000Z`), `windowType` `"five_hour"`, `costUsd` 0, message ending `resets 12:40pm (America/Chicago)`. (c) Near misses derived from the crew-chatter stream by one change each, each returning `null`: `api_error_status` 500; `api_error_status` removed; `is_error` false; every rejected event removed (the `allowed_warning` events stay); the result line not last (an assistant line appended after it); the result line replaced by non-JSON text; an empty string. (d) The crew-chatter stream with its `api_error` field removed is still recognised, which is the run 8 shape (a deliberate test of the rule's independence from that field). (e) Discrimination: the crew-chatter stream with its first `rate_limit_event` given a different `resetsAt` and its status kept `allowed_warning` still reports the rejected event's reset time, so the status filter is what picks it. (f) Cost and reset absent or unusable: the result line without `total_cost_usd` gives `costUsd` null; the rejected event without `resetsAt`, and one whose `resetsAt` is `1e20` (a finite number that is not a valid date), give `resetsAt` null; all three still recognised.
- Break it, one at a time, restoring after each and hashing the file before and after: (1) make the function always return `null` and (a), (b), (d), (e), (f) must fail; (2) drop the `api_error_status === 429` check and the status-500 near miss must fail; (3) drop the `is_error` check and the `is_error` near miss must fail; (4) drop the rejected-event requirement and the no-rejected-event near miss must fail; (5) take `resetsAt` from the first `rate_limit_event` and (e) must fail; (6) require `api_error === "usage_limit_reached"` and (b) and (d) must fail; (7) drop the valid-date check and the `1e20` case in (f) must fail.
- Verify: `node --test --test-reporter=tap test/usage-limit-refusal.test.ts` (the default reporter prints no counts)
- Expected: all pass; each break fails the tests named.

**Task completion evidence:** TAP counts, and the seven break-it outcomes.

### Task 2: Say it in the dispatch failure

**Depends on:** Task 1

**Files:**
- Modify: `src/dispatch.ts` — the `outcome.exitCode !== 0` branch, and a private `describeUsageLimitRefusal` beside `sha256`.
- Modify: `test/usage-limit-refusal.test.ts` — the end-to-end tests.

**Steps:**
- Read `src/dispatch.ts` and `test/dispatch.test.ts` to end of file before editing.
- In the branch, call `readUsageLimitRefusal(outcome.raw)`; when it is `null` return exactly the string returned today. When it is a refusal, return `failed(<today's string>: <sentence>)`, where the sentence is `the provider's usage limit refused the dispatch (window ${windowType ?? "unreported"}; resets ${iso ?? "at an unreported time"}; ${cost}; provider message: ${JSON.stringify(message.slice(0, 200))})`. `iso` is `new Date(resetsAt * 1000).toISOString()` when `resetsAt` is not null. `cost` is `the refused attempt reported cost USD ${Number(costUsd.toFixed(7))}, which no agent_run row records` when `costUsd` is not null, else `the refused attempt reported no cost`. `describeUsageLimitRefusal` is a plain function with this one caller.
- Tests (same file; its own small `withDispatchContext`-style helper creating a store, a run and a stage, as `test/dispatch.test.ts` does): for each fixture, a scratch executor (a `.mjs` that reads stdin, prints the rebuilt stream's lines and exits 1; build it as `scratchExecutor` does in `test/dispatch.test.ts`) is dispatched through `dispatchOnce` with `requestedModel: "claude-sonnet-5-5"` and `requestedEffort: "medium"`. Assert: `result.ok` is false; `result.reason` equals the full expected string, written out as a literal with the stage id interpolated, for crew-chatter ending `... 2026-10-07T17:50:00.000Z; the refused attempt reported cost USD 0.1291114, which no agent_run row records; provider message: "You've hit your session limit · resets 12:50pm (America/Chicago)") (requested model claude-sonnet-5-5, effort medium)` and for run 8 with `2026-10-04T17:40:00.000Z`, `USD 0` and `12:40pm`; the one `agent.dispatch.failed` audit summary equals `result.reason`; `agent_run` is empty; the raw directory holds the stream; `verifyAuditChain(store)` is `null`. A near-miss stream (status 500) through the same path gives a reason matching `/exited with code 1 \(requested model claude-sonnet-5-5, effort medium\)$/` with no "usage limit" in it.
- Break it, restoring and hashing after each: (1) call the function but ignore its result and the two refusal tests must fail; (2) drop the model and effort suffix from the refusal path only and the literal-reason tests must fail; (3) format the cost with `toFixed(2)` and the crew-chatter literal must fail.
- Verify: `node --test --test-reporter=tap test/usage-limit-refusal.test.ts test/dispatch.test.ts test/harness.test.ts test/run-command.test.ts test/verification-stage.test.ts test/commit-verification.test.ts`, then `node --test --test-reporter=tap test/cli-operator.test.ts` (long; the PowerShell 5.1 approval test may fail from the assistant's shell and pass in the operator's)
- Expected: the new file passes; the other files pass unchanged, which proves their fixtures return `null` from the function. Any failure outside the known two is mine until shown otherwise.

**Task completion evidence:** TAP counts for both commands and the three break-it outcomes.

### Task 3: Documents

**Depends on:** Task 2

**Files:**
- Modify: `docs/runbooks/cli-operator.md` — the troubleshooting row beginning "Doctor passes but a provider dispatch fails".
- Modify: `.claude/sessions/project-learnings.md` — the diagnostics line beginning "A dispatch that exits 1 within seconds".
- Read first, edit only if they contradict: `docs/proposals/usage-limit-refusal-strands-a-run.md` (it is a proposal, not edited to record outcomes), `ARCHITECTURE.md` section 19.

**Steps:**
- Read each file to end before editing. The runbook row gains two sentences: a failed dispatch whose reason says "the provider's usage limit refused the dispatch" names the window, the reset time (UTC) and the cost the refused attempt reported, which is not in the run's recorded cost; it is an environment cause, and the run stays blocked and cannot be resumed. Keep the row's existing sentences.
- The learnings line: replace "Read the tail of its raw stream" guidance with "the audit summary and the block reason now name it (after this change); the raw stream remains the evidence", and keep the cost and warning facts. State that the change is committed only when it is.
- Do not edit `CLAUDE.md` or `AGENTS.md`.
- Verify: `npm run check:docs`
- Expected: clean; no new warning naming either file.

**Task completion evidence:** the checker output and the two diffs.

### Task 4: Full verification

**Depends on:** Tasks 1-3

**Steps:**
- `npm run typecheck`.
- `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` (about 11 minutes; keep the file glob). Compare against the two known failures named under Known blockers.
- `git log -1` and `git status --short`: a stray empty "moved" commit is dropped only after `git diff <prior> HEAD` is empty.
- `node .claude/skills/run-buildworks/driver.mjs smoke`.
- Expected: typecheck clean; no failure beyond the two known; smoke `13/13 steps as expected`.
- Report what was not run: any paid run, and any resume of a blocked run. State plainly that a real refused dispatch has not been replayed against a live provider; only two recordings of it have.

**Task completion evidence:** the four outputs, with failures named.

## Open decisions

1. Whether the refused attempt's reported cost should be added to the run's known cost. It needs a structured place to store it (a column, or parsing the summary text), which is a schema decision outside this plan.
2. Whether a stream whose result line carries an `api_error` other than `usage_limit_reached` (with the other recognition fields present) should still be called a usage-limit refusal. This plan ignores the field, because run 8 has none; no such stream has been recorded.
3. Whether option C (pause instead of block) is wanted. It is not authorized and nothing here prepares for it beyond the cause being named.
