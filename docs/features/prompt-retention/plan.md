# Prompt Retention Implementation Plan

**Status:** Implemented

**Goal:** Every model dispatch keeps the exact prompt it sent, before the harness starts, so a failed or surprising answer can be traced to its input and a future replay can check a recorded prompt.

**Source:**
- Operator decision 2026-10-18: "yes, start saving prompts now", split out of change 9 (`docs/proposals/whole-run-replay.md`, section 6 and decision 2), which otherwise waits.
- `src/dispatch.ts` keeps raw output (hazard 2) but only `sha256(prompt)` of the input.

**Hazards considered:**
- 2: this is the hazard applied to the input. A dispatch that fails keeps its output today but not what it was asked. The prompt is written before the harness starts, in the same evidence-first order the output already follows.
- 4: the tests compare the retained bytes with the prompt sent and its hash with the `agent_run.input_hash` the store records. No expected value is invented.
- Every other entry: none. Nothing gates on the retained prompt. No prompt, parser, stage, limit or retry changes, and Decision-1 requests already keep their request in their raw file.

**Verification:** `node --test test/dispatch.test.ts test/code-review-stage.test.ts test/paths.test.ts`, then `npm run typecheck`, `npm test` serially, `npm run check:docs`, and `node .claude/skills/run-buildworks/driver.mjs smoke`. Each guard is proven by breaking it, with the file copied first and restored bytes compared by SHA-256.

---

## Decisions

- **Per run, named by hash.** Prompts go under `.governance/prompts/<run>/<input_hash>.txt`, beside `.governance/raw/<run>/`. A run's evidence then stays together for extraction, and identical prompts in one run (the code-review reconciler's repeated calls) share one file. The global `.governance/content/<hash>` that section 20 describes is a different, unbuilt idea for delivering oversize prompts, and it is not reused.
- **No migration.** A successful dispatch's prompt is found from its existing `agent_run.input_hash` and run. A failed dispatch has no row, so its `agent.dispatch.failed` summary names the prompt file.
- **Written before the harness starts, after the existing refusals.** A missing stage, an oversize prompt and a failed probe still return before anything is written, so their tests' "nothing retained" assertions hold.
- **Fail closed.** If the prompt cannot be written, the dispatch is refused before the harness starts: a dispatch without its evidence is the state hazard 2 forbids.

## Tasks

- Task 1: retain the prompt.
  - `src/paths.ts`: add `promptDir(rootDir, runId)` (`.governance/prompts/<run>`) and `promptRef(runId, name)`, beside `rawOutputDir` and `rawOutputRef`, built from `GOVERNANCE_DIR`.
  - `src/raw-output.ts`: add `writePrompt(rootDir, runId, prompt, hash): string`. It creates the directory, writes `<hash>.txt` only if it does not exist, and returns the root-relative reference.
  - `src/dispatch.ts`:
    - compute `const inputHash = sha256(input.prompt)` once and use it for `inputHash` in `insertAgentRun`;
    - after the probe and before `invokeHarness`, call `writePrompt`, and on a throw return `{ ok: false, reason: \`cannot retain the prompt before dispatch: <message>\` }`;
    - in `failed`, extend the summary to `${detail} (requested model ${model}, effort ${effort}; prompt ${promptRef})`;
    - extend the function's doc comment to name the prompt in the evidence-safe order.
  - Update the two tests that pin the old summary ending: `test/dispatch.test.ts` ("a failed dispatch's audit summary and reason name the requested model and effort") and the regular expression in `test/code-review-stage.test.ts` that ends `\(requested model m, effort medium\)$`.
  - New tests in `test/dispatch.test.ts`:
    - a successful dispatch keeps `.governance/prompts/<run>/<hash>.txt` whose bytes equal the prompt and whose name equals the row's `input_hash`;
    - a failed dispatch keeps the prompt, and its audit summary names that file;
    - two dispatches with the same prompt in one run leave one file;
    - an oversize prompt and a missing stage keep no prompt.
  - Verify: `node --test test/dispatch.test.ts test/code-review-stage.test.ts test/paths.test.ts`. Expected: all pass.
  - Break-test: remove the `writePrompt` call. The retention tests must fail. Restore by SHA-256.

- Task 2: record it in the design.
  - `ARCHITECTURE.md` section 15: add the retained prompt to what a run keeps, with its path and how it is found.
  - `ARCHITECTURE.md` section 17: retained prompts are sensitive exactly as retained raw output is (design, specification and code under review), machine-local and ignored.
  - `docs/hazards.md` entry 2: one sentence that the prompt is now retained before invocation, citing this plan.
  - Verify: `npm run check:docs`. Expected: exit 0.

- Task 3: full validation and the record.
  - Run `npm run typecheck`, then `npm test` serially. Expected: 0 failures, skip count unchanged (5).
  - Run `node .claude/skills/run-buildworks/driver.mjs smoke`. Expected: completes, spending nothing.
  - Set Status to `Implemented` and add an implementation record. Update `.claude/sessions/project-learnings.md`.

## Implementation record

Implemented 2026-10-18 on branch `sandboxed-delivery`, as Tasks 1 to 3 describe, with two differences from the plan as written.

- A third test pinned the old summary ending: the envelope-refusal assertion in `test/implementation-stage.test.ts` ("a phase reply that never reached the structured channel is a failed dispatch, refused at the envelope"). It now expects `; prompt \S+\.txt)` like the code-review one, and the focused run included that file.
- The break-test kept the `writePrompt` call and stopped it writing (`writeFileSync(path, prompt)` replaced in `src/raw-output.ts`), because removing the call also removes the reference the summary needs. The three positive retention tests in `test/dispatch.test.ts` failed; the test that a refused dispatch retains nothing passed, as it should. The file was copied first and restored byte-identical (SHA-256 `f5f5705601ef37e724edb275f5a0d0355690850af6114bbd020cde84adce1a48`).

Validation:
- `node --test test/dispatch.test.ts test/paths.test.ts test/implementation-stage.test.ts test/code-review-stage.test.ts`: 150 tests, 149 pass, 1 skipped (the file-symlink case), 0 fail.
- `npm run typecheck`: exit 0.
- `npm test`: 1637 tests, 1632 pass, 5 skipped, 0 fail.
- `npm run check:docs`: clean.
- `node .claude/skills/run-buildworks/driver.mjs smoke`: 13/13 steps as expected. The smoke dispatches no model, so it shows that nothing else regressed. It does not exercise retention.

What this does not show: no paid dispatch has written a prompt file yet, so the size of a real run's `.governance/prompts/` is unmeasured. Nothing deletes retained prompts, and they accumulate as raw output does.
