# Streaming Harness Output Implementation Plan

**Status:** Implemented

**Goal:** The harness idle timer measures real inactivity. The executor streams output while the model generates, so every text chunk resets the timer. A dispatch that is still writing survives past 30 minutes, and a dispatch that has truly gone silent still dies. The absolute ceiling stays as the backstop.

**Source:** Operator decision after team-notes run 4 (2026-09-27) blocked at `implementation` (external target `C:\Users\Shawn-work\repositories\testing-repos\team-notes`, $4.19 known plus one dispatch of unknown cost). The operator asked whether the harness could check for activity before killing at 30 minutes. It cannot: `--output-format json` produces no bytes until the answer is complete, and `--no-session-persistence` leaves no transcript to watch. A streamed output is the activity signal. `docs/hazards.md` entry 19 records the measurement.

**Hazards considered:** `docs/hazards.md` items 1, 2, 4 and 19.
- **19 (inactivity budget as a wall clock):** the entry this plan answers. Streaming makes `resetIdle` fire during generation, which is what `ARCHITECTURE.md` section 11 already specifies.
- **1 (output shapes the schema refuses):** the outer envelope becomes newline-delimited JSON. That is a new shape at the harness boundary. `parseEnvelope` must accept exactly the recorded shape and refuse every other one by name: no result line, two result lines, a line that is not JSON, and a result line that is not the last line. The inner `result` text and `extractJsonBody` are unchanged.
- **2 (discarded output):** the whole stream is retained before any parsing. With partial messages enabled, a killed dispatch retains everything the model wrote before the kill, which run 4's 0-byte file did not.
- **4 (fixtures agreeing with code):** the stream shape comes from one recorded real invocation (Task 0), never from memory of the CLI documentation. The four stage emitters under `test/fixtures/harness/` are rewritten to emit that recorded shape and are checked against it.

`ARCHITECTURE.md` section 20 (Limits) already requires a result cap plus a separate, much larger retention ceiling; Task 3 implements that rule for the stream. Section 11 already specifies an inactivity budget that resets on any output; this plan makes the executor satisfy it.

Items 3, 5-18 do not govern this change: it touches no prompt, delivery check, stage order, retry, executable resolution, hook, model alias, seeding, configuration divergence, obligation accounting, independence claim, read-only boundary, or review gate. The read-only flags in `CLAUDE_CODE.command` are kept byte for byte.

**Scope:** `src/executor.ts` (the command), `src/harness.ts` (retention cap and `parseEnvelope`), the four stage emitters, `test/fixtures/harness/emit-cli-run.mjs` if it constructs envelopes, and the tests that read the recorded envelope. Out of scope, each a separate decision:
- **The timeout values.** `idleTimeoutSeconds: 1800` and `absoluteTimeoutSeconds: 3600` are unchanged. With streaming, 1800 seconds is a loose hang detector, and whether a 24-file implementation finishes inside 3600 seconds is unmeasured. Change one thing at a time.
- **Splitting implementation into smaller dispatches.** That is the deferred `task_decomposition` stage.
- **Retained raw files from earlier runs.** They hold the old single-JSON envelope and are not rewritten. The committed fixtures under `test/fixtures/recorded/` stay byte-identical; their replays read the inner `result` text, which is unchanged.

**Known blockers:**
- **Unknown until Task 0:** whether `-p --output-format stream-json` also requires `--verbose`. The CLI help says `--include-partial-messages` works only with `--print` and `--output-format=stream-json`. A free empty-input probe after run 4 refused on missing input before reaching flag validation, so it did not answer the question.
- **Unknown until Task 0:** whether the final `type: "result"` line carries the same fields `parseEnvelope` reads today (`result`, `total_cost_usd`, `usage`, `modelUsage`), and how far apart lines arrive during one long text block.
- **Unknown until Task 0: effective-model detection.** `parseEnvelope` picks the effective model as the unique `modelUsage` entry whose `inputTokens` equals the top-level `usage.input_tokens` (`src/harness.ts:159`). If the result line reports `usage` differently (for example summed across turns), the match silently yields `null`. Task 0 must show the match still selects exactly one model.
- **Stream size depends on tool use.** A verbose stream likely echoes every tool call and tool result, so an implementer that reads many files writes their contents to stdout. A ratio measured from a tool-free prompt would undersize the retention ceiling and kill a real dispatch, which is the failure this plan fixes. Task 0's prompt therefore reads files.
- **Session metadata in the capture.** The stream's first line reports session settings. Before the capture is committed, it must be checked for any key, token, or environment value (section 11: never leak the environment into retained output).
- **Frozen profiles.** The whole executor definition is in the frozen profile and `requireFrozenBinding` compares it at every dispatch (`src/profile.ts:416`), so changing the command refuses every run frozen before the change. No run is in progress: team-notes run 4 is blocked. Land this change before starting any new run.
- **The stdout cap.** `RESULT_MAX_BYTES` (1 MiB) caps the whole stdout today (`src/harness.ts:257`). A partial-message stream carries every text chunk plus the final result, so a large but legitimate response could trip the cap. The cap must apply to the extracted result, with a separate, larger retention ceiling on the stream (`ARCHITECTURE.md` section 20).
- **Full suite.** Parallel `npm test` crashes on the heap limit. Use `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`. Two tests fail before this change: the dashboard SIGTERM test and "nothing under src/ touches a private key".

**Verification:** `npm run typecheck`, the serial full suite with no failures beyond the baseline pair and `git log -1` unchanged, `npm run check:docs`, `git diff --check`, and the break-tests named in each task. End-to-end success is a separately authorized paid run that reaches past `implementation`. This plan does not claim it.

---

## Tasks

- **Task 0: Record one real streaming response (paid; ask the operator first).**
  - Run the exact `CLAUDE_CODE.command` with `--output-format stream-json --include-partial-messages` in place of `--output-format json`, adding `--verbose` only if the CLI refuses without it. Run it in a small scratch repository with one prompt that first reads several files with the read-only tools and then writes about 2,000 tokens of text. The capture then shows both the tool-call lines and the chunk cadence inside one long text block. Estimated cost: cents. State the command and the cost before running it.
  - Before committing, search the capture for keys, tokens, and environment values; stop and report if any appear.
  - Commit the bytes to `test/fixtures/recorded/harness-stream-json-envelope.json` with a `provenance` block (command, CLI version, date, prompt, and what was dropped). Record the facts the later tasks need: whether `--verbose` was required, the line types seen, whether tool results carry file contents, the longest gap between lines, the result line's fields, whether the effective-model match still selects exactly one `modelUsage` entry, and the ratio of stream bytes to result bytes, split into tool-result bytes and text-chunk bytes.
  - Stop and report if the result line lacks a field `parseEnvelope` needs or the model match fails. The plan is then wrong, not the capture.
  - **Result (2026-09-28, $0.0926, uncommitted):** recorded in `test/fixtures/recorded/harness-stream-json-envelope.json`; its `measurements` block holds the numbers.
    - `--verbose` is required: without it the CLI exits 1 in 1.2 s with no dispatch ("--output-format=stream-json requires --verbose").
    - 967 lines, all JSON, one per line; line types `system:init`, `system:status`, `stream_event`, `assistant`, `rate_limit_event`, `user`, and exactly one `result:success`, which is the last line.
    - The result line carries `result`, `total_cost_usd`, `usage` and `modelUsage`; the effective-model match selects exactly `claude-sonnet-5`.
    - Over a 45 s, 5-turn dispatch the longest gap between stdout chunks was 571 ms, and the first chunk arrived at 620 ms. The response used no extended thinking, so gaps during thinking are unmeasured.
    - Sizes: 321,434 stream bytes for a 12,957-byte result. Text deltas take 229,485 bytes (913 lines, about 250 bytes of envelope per line), about 17.7 times the result text; full `assistant` messages repeat another 19,272. Tool results take 43,000 bytes for 18,765 bytes of files read, about 2.3 times.
    - Secret check: no key or token pattern, no passthrough environment value, `apiKeySource` is `"none"`. The init line does carry the working directory path and the account's rate-limit utilization; both were kept for fidelity.
    - This is one sample, not a characterization.
- **Task 1: Stream the executor output (`src/executor.ts`).**
  - Replace `"json"` with `"stream-json"` and add `--include-partial-messages` (and `--verbose` if Task 0 required it). Keep every other flag byte for byte.
  - Rewrite the idle-budget comment: the budget now measures inactivity, and the absolute ceiling bounds an active process.
  - Verify: `node --test test/executor.test.ts`. Update any pin that names the old command, and add a pin for the new flags.
- **Task 2: Parse the stream (`src/harness.ts` `parseEnvelope`).**
  - Split the raw text into lines. Require exactly one line whose JSON `type` is `"result"`, and require it to be the last non-blank line. Read the same fields from it as today. Refuse, naming the executor and the cause: a line that is not JSON, no result line, more than one result line, a result line that is not last.
  - Update the doc comment's evidence to cite Task 0's recording. Delete `test/fixtures/harness/claude-code-envelope.json` and move its three readers (`test/harness.test.ts`, `test/cli-operator.test.ts`, `test/operator-state.test.ts`) to the new recording. One schema per thing (hard rule 3): the old envelope shape is not kept as an alternative.
  - Verify: `node --test test/harness.test.ts`, one test per refusal asserting the message. Break-test: make the parser take the first result line instead of requiring one; the two-result-lines test must fail.
- **Task 3: Separate the result cap from stream retention (`src/harness.ts`).**
  - Keep all stdout bytes up to a new `STREAM_RETAIN_MAX_BYTES`. Size it from Task 0's measurements: text chunks scale with the result, and tool results add up to the bytes the dispatch reads, which the result size does not bound (the read-only tools can open any file in the worktree). If no measured bound exists, size the ceiling as a disk-safety limit in the spirit of section 20, not as a tight fit. State the sizing rule and its source next to the constant. Overflowing it kills the process and sets `resultOverflow`, as the cap does today.
  - Apply `RESULT_MAX_BYTES` to the parsed `resultText` instead. A result over the cap is refused by name, and the raw stream is still retained.
  - Verify: tests for both ceilings. Break-test: point the result cap back at the raw stream; a test streaming more than 1 MiB of chunks around a small result must fail.
- **Task 4: Rewrite the fixture emitters to the recorded shape.**
  - `emit-spec-stage.mjs`, `emit-plan-stage.mjs`, `emit-implementation-stage.mjs`, `emit-code-review.mjs`, and `echo-json.mjs` (and `emit-cli-run.mjs` if it builds an envelope) wrap their existing `result` text in the recorded line sequence. Their routing and inner results do not change.
  - Add one test that feeds each emitter's output through `parseEnvelope`, and one that compares the emitters' line types against the Task 0 recording, so a hand-written shape cannot drift from the real one.
  - Verify: the stage tests (`spec-stage`, `plan-stage`, `implementation-stage`, `code-review-stage`, `cli`, `cli-operator`, `prompts`) pass unchanged apart from the envelope wrapper.
- **Task 5: Prove the idle timer now tracks activity.**
  - Add a harness test with a stub executor that writes one line every 200 ms for 1.5 s, invoked with `idleTimeoutSeconds` of 1 (a test-only call-site value; stages still take the frozen value). It must finish with `timedOut: false`. A stub that writes one line and then stays silent must be killed with `timedOut: true`.
  - Break-test: remove `resetIdle()` from the stdout handler; the streaming test must fail.
- **Task 6: Record the design and close.**
  - `ARCHITECTURE.md` section 11: the executor streams, so the idle budget measures inactivity. Update the executor YAML's command line and its `sessionCost` comment, which cites the old recorded envelope. In `docs/hazards.md` entry 19, add the remedy paragraph with the recording's path.
  - `.claude/sessions/project-learnings.md`: rewrite the diagnostic advice that assumes a single-JSON raw file (reading `num_turns` and the self-critique response from `.governance/raw/<run>/`) for the stream format.
  - Run `npm run typecheck`, the serial full suite, `npm run check:docs`, `git diff --check`. Set this plan `Implemented` with an implementation note: what shipped, what deviated, the break-tests, and that the paid end-to-end run is unmeasured.

## Implementation note (2026-09-28)

**Shipped.** Tasks 0-6.
- The executor runs `--output-format stream-json --include-partial-messages --verbose`, with every read-only flag unchanged.
- `parseEnvelope` reads newline-delimited JSON and requires exactly one `type: "result"` line, last. It refuses, by name and with the line number: a line that is not JSON, a line that is JSON but not an object, no result line, more than one, a result line that is not last, and a result line whose `result` is not a string.
- `STREAM_RETAIN_MAX_BYTES` (64 MiB) bounds retained stdout and kills the process on breach. `RESULT_MAX_BYTES` (1 MiB) now caps the parsed result text.
- The four stage emitters and `echo-json.mjs` write a reduced form of the recorded line sequence. `test/harness-stream-fixtures.test.ts` holds every emitter's line kinds and result-line fields to the recording.
- The old `claude-code-envelope.json` is deleted, and its three readers read the recording.
- `ARCHITECTURE.md` sections 11 and 20, `docs/hazards.md` entry 19, and `.claude/sessions/project-learnings.md` are updated.

**Deviations from the plan.**
- `src/dispatch.ts` changed. The plan's scope named `executor.ts` and `harness.ts`, but "a result over the cap is refused by name" can only live where the result is parsed. Its overflow message also changed, from "result exceeded the size cap" to a retention-ceiling message; no test pinned the old text.
- `src/verify-command.ts` changed, a doc comment only: it described `invokeHarness` as spending `RESULT_MAX_BYTES` on stdout.
- `STREAM_RETAIN_MAX_BYTES` is 64 MiB, the size of `VERIFY_RETENTION_MAX_BYTES`, as a disk-and-memory limit. No measured bound exists, so it is not a fit to the capture. It is a live constant in `src/harness.ts`, not a frozen policy field, matching how `RESULT_MAX_BYTES` is enforced. Freezing it would need a policy-shape change, which this plan did not authorize.
- A boundary defect surfaced while testing: when a chunk ended exactly on the ceiling, later output was dropped without setting `resultOverflow`, so the stream was silently truncated until the idle timer fired. The check now flags it. The old 1 MiB cap had the same gap.
- `test/implementation-stage.test.ts` also changed. It parsed emitter stdout as one JSON object and broke in the full suite; it now uses `parseEnvelope`.
- `test/fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json` and the other committed recordings are untouched. Their envelopes are one-line JSON objects with `type: "result"`, which are one-line streams under the same schema, not a second shape.

**Break-tests.** Each failed by assertion, and the source was restored by hash:
- Taking a second result line instead of refusing it failed "refuses two result lines".
- Pointing the retention check back at `RESULT_MAX_BYTES` failed "a stream longer than the result cap".
- Removing `resetIdle()` from the stdout handler failed "keeps writing survives the idle budget".
- Ignoring exact-boundary overflow failed "a stream past the retention ceiling".
- Removing the parsed-result cap in `dispatchOnce` failed "a result over the size cap is refused".
- Accepting a non-string `result` failed "refuses a result line whose result is not a string".
- A repeat-kill guard proposed by the review failed no test on Windows in three runs, so it was reverted rather than kept unproven.

**Verification.**
- `npm run typecheck` is clean, and `git log -1` is unchanged.
- The serial full suite ran 1302 tests: 1294 pass, 5 skipped, 3 fail. Two are the baseline failures (dashboard SIGTERM; "nothing under src/ touches a private key"). The third is the `implementation-stage` test above, fixed afterwards.
- After the last source edit, `harness`, `dispatch`, `implementation-stage`, `harness-stream-fixtures` and `executor` (90 of 92, 2 skipped) and `operator-state`, `code-review-stage` and `plan-stage` (185 of 185) were rerun green. The full suite was not rerun.
- `npm run check:docs` reports clean with 6 new missing-path warnings. All are references to the deleted fixture in historical plans and this plan's Task 2; the checker already listed 87 such warnings.

**Review.** An in-session subagent reviewed the diff (`2026-09-28-code-review.md`), not a billed `/code-review ultra`. It found no material defects and seven low-severity items. Their dispositions are in that record.

**Unmeasured.** No paid run has gone past `implementation` with streaming, so whether a 24-file implementation now finishes is unknown. The 3600-second absolute ceiling and the 1800-second idle budget are unchanged. Gaps during extended thinking were not sampled, because the capture used none. The capture is one sample.
