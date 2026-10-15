# Structured Patch Output Implementation Plan

**Status:** Implemented

**Goal:** The three dispatches that return patches (each implementation phase, the implementation self-review, and code-review remediation) receive their answer through the `claude` CLI's `--json-schema` structured output instead of free reply text, and a phase drops a returned file that is unchanged instead of blocking on it. A large-reply probe gates the build.

**Source:** Operator request 2026-10-14: "write the plan and include the phase unchanged file drop and the large-reply probe". The evidence behind it:
- `test/fixtures/recorded/web-calculator-selfreview-run-1-phase-2-trailing-prose.json`: the first paid run after the self-review was built ($1.12023, 12 dispatches) blocked at implementation phase 2 of 2. The phase reply was a valid JSON object followed by one sentence of prose ("Wait — I must not return unchanged files unnecessarily; …"), which `extractJsonBody` refuses. The same reply returned `index.html` byte-identical to the phase 1 commit, and a free replay through `applyProposedPatches` refused that patch ("staged set differs from the proposed patch"); with `index.html` removed it committed. Both faults had to be absent for the phase to pass.
- `test/fixtures/recorded/json-schema-probe-web-calculator-phase-2.json`: two paid calls ($0.1061466) resending that phase's byte-identical prompt with `--json-schema` added. Both answered through a `StructuredOutput` tool call with no text block; the result line carried `structured_output`, its `result` equalled `JSON.stringify(structured_output)`, and the existing `parseEnvelope`, `extractJsonBody` and `validateAgentResult` accepted it. In both, the model's `Read` of the checkout was denied (`permission_denials`), so neither call saw a file.
- `docs/features/code-review-remediation/real-run-evidence.md` (2026-09-07) recorded that Claude Code advertised `--json-schema` and deferred it: "adopting it would change the contract of every structured dispatch and requires its own recorded invocation and design." This plan is that design for the patch-producing dispatches only.

**Assumptions:**
- **Only the three patch-producing dispatches change.** Spec and plan authors, self-critiques, reviewers, the split dispatch and both reconcilers keep free-text JSON. Their replies are smaller and not file contents; moving them is a separate decision (open decision 3).
- **The schema is per invocation, like model and effort.** `invokeHarness` appends `--json-schema <schema>` after `--model` and `--effort`, so the frozen executor command and the profile shape do not change, and a run frozen before this change dispatches with the schema too. That matches how model and effort travel today (`ARCHITECTURE.md` section 11, "Model and effort are per invocation"). The schema is a code constant beside the validator it mirrors, the way the prompt text is a code constant, not a run setting.
- **The answer is read from `structured_output`.** For a dispatch that requested a schema, `parseEnvelope` sets `resultText` to `JSON.stringify(structured_output)` and refuses by name a result line without a `structured_output` object. Everything downstream (`extractJsonBody`, `validateAgentResult`, the self-review reader, the patch applier) is unchanged, because a serialized object is bare JSON (hazard 1 shape 1). `result` equalled that serialization in 2 of 2 recorded calls, but the plan does not depend on that equality.
- **One schema per thing (hard rule 3).** Two schemas: `PATCH_RESULT_SCHEMA` for phases and remediation, and `SELF_REVIEW_RESULT_SCHEMA` for the self-review, which adds the required `proposedContentChanges.selfReview.critique`. The patch schema is the one the 2026-10-14 probe sent (recorded in the probe fixture's `provenance.schema`); its enums are built from the validator's own `STATUSES` and `PATCH_ACTIONS`, so the two cannot drift. `additionalProperties: false` holds the model to the fields the prompt advertises.
- **One prompt sentence changes.** The probes sent the existing prompt text, including "Output the JSON object directly, with no surrounding prose". After Task 1 the operator chose to reword it for the three patch prompts (open decision 4, decided): they now say to submit the object once through the structured output tool and not also write it as text. The reworded prompts have not been sent to a real model.
- **The phase drop reuses the self-review's rule.** The self-review already drops a `modify` file inside the signed scope whose blob, as `git hash-object --path` computes it, equals the blob at the base commit (`sameBlobAtCommit`). The phase loop applies the same function to each phase reply against the phase's base. A phase left with no files blocks with a named reason, because the phase prompt already says "Return at least one file: a phase that changes nothing blocks the run." Remediation keeps its current behaviour (open decision 1).
- **A dispatch the CLI cannot complete fails as it does today.** What Claude Code does when a model cannot satisfy the schema (retry, error subtype, or exit code) is unknown. Every outcome lands on an existing path: a non-zero exit or a missing `structured_output` is a failed dispatch, so a phase or remediation blocks and the self-review skips, each with a reason that names it.

**Approach:** First spend about $0.86 on two gating probe calls (Task 1). One resends crew-chatter run 3's byte-identical 82,046-byte phase 2 prompt, whose free-text reply broke at a 5,314-character unescaped stretch. The other repeats the small web-calculator probe from a checkout outside the system temp directory, so the model can actually read files. Build only if both pass a reading rule fixed before the calls. Then add the two schemas, teach the harness to send a schema and read `structured_output`, make the stand-in emitters answer the way the real CLI does and refuse a patch prompt without a schema, wire the three dispatches, add the phase drop, and record the evidence in hazards 1 and 20 and the documents that describe the harness and the phases.

**Affected areas:** `src/agent-result.ts`, `src/implementation-self-review.ts`, `src/harness.ts`, `src/dispatch.ts`, `src/implementation-stage.ts`, `src/code-review-stage.ts`; `test/fixtures/harness/emit-implementation-stage.mjs`, `test/fixtures/harness/emit-code-review.mjs`, `test/fixtures/harness/emit-cli-run.mjs`; the tests named per task; two new fixtures under `test/fixtures/recorded/`; `ARCHITECTURE.md`, `docs/hazards.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/sessions/project-learnings.md`.

**Known blockers:**
- **[Verified]** Task 1 spends money and needs the operator's consent at execution time; this plan authorizes nothing. If either probe fails the reading rule, Tasks 2-8 do not start.
- **[Verified]** The 2026-10-14 probe's reads were denied. Its clones sat under the session scratchpad in the system temp directory; the run's own dispatch, in a worktree under `C:\Users\Shawn-work\repositories\testing-repos\`, recorded no denials. The cause is not established. Task 1 therefore runs both calls from checkouts under `testing-repos`, and requires `permission_denials` to be empty.
- **[Verified]** Crew-chatter run 3's worktree directory is gone, but branch `gov/crew-chatter/3` still points at the phase 1 commit `cc839ba8c3b95ef2c0866b23fab4421f8b87b414`, and the run's store and frozen profile (`.governance/profiles/3/profile.json`) are intact. Today's `buildImplementationAuthorPrompt` produces a different prompt (82,271 bytes, hash `2a7511ed…`). The builder at `c9ef115` reproduces the recorded one exactly: hash `cf168ee7eea9f1be87ec6519970a7356084c242641de5d0360cc05e14b9012a5`, equal to `agent_run` 32's `input_hash`, checked 2026-10-14 by importing `prompts.ts` and `plan-doc.ts` from `git archive c9ef115 src` and `sqlite.ts` from the checkout (`c9ef115` has no `src/sqlite.ts`).
- **[Verified]** `emit-cli-run.mjs` refuses any argv pair other than `--implementation-mode`, `--code-review-mode`, `--delay-ms`, `--model` and `--effort` (its `options` function). It must accept `--json-schema`, or every `emit-cli-run` test fails once the harness sends one.
- **[Verified]** `test/harness-stream-fixtures.test.ts` holds each emitter's result-line fields to the recorded envelope `test/fixtures/recorded/harness-stream-json-envelope.json`, which has no `structured_output`. Schema-mode emissions must be held to a recorded result line that has one: the probe fixture's `resultLineVerbatim`.
- **[Verified]** Two tests expect the self-review's not-JSON reply to be refused at the body: `test/implementation-stage.test.ts` (`["self-review-not-json", /implementer body refused: /]`) and `test/cli-operator.test.ts` (the `skipped[0]` summary starting `reason=self-review: implementer body refused: `). Under a schema, a reply with no structured output is refused at the envelope instead, so both expected reasons change. Task 5 greps `body refused` across `test/` again rather than trusting this list.
- **[Verified]** Tests anchor the `implementation.phase.apply` summary: `/^phase 1 of 6: tasks 1-10; base=[0-9a-f]{40,64}; head=[0-9a-f]{40,64}$/` and `lastPhaseHead`'s `/head=([0-9a-f]+)$/`. The drop is recorded as a separate `implementation.phase.dropped` event, so that summary's format does not change.
- **[Verified]** The schema-bound reply streams: probe call a emitted 235 `input_json_delta` events while writing its `StructuredOutput` input, so every chunk still resets the idle timer (hazard 19).
- **[Verified]** `claude --help` on 2.1.300 lists `--json-schema <schema>  JSON Schema for structured output`; 2.1.263 advertised it too. An older binary without it would exit non-zero on the unknown option, which is a failed dispatch by name. No doctor check is added.
- **[Unknown]** Whether `StructuredOutput` is available under every flag the frozen command uses was shown for `--restricted --safe-mode --tools Read,Glob,Grep --permission-mode dontAsk` in 2 calls; nothing else is known about how the CLI enforces the schema.

**Blast radius:** (evidence: Grep over `src`, `test`, `scripts` and `.claude/skills`, 2026-10-14)
- `InvocationInput` (`src/harness.ts`) reaches the child only through `invokeHarness`; `DispatchInput.invocation` is `Partial<InvocationInput>`, and all sixteen `dispatchOnce` call sites (`src/cli.ts`, `src/code-review-stage.ts` ×3, `src/implementation-stage.ts` ×2, `src/plan-stage.ts` ×4, `src/spec-decision-stage.ts`, `src/spec-stage.ts` ×5) compile unchanged because the new field is optional. Only three of them set it.
- `parseEnvelope` is called by `src/dispatch.ts` and by `test/harness.test.ts`, `test/harness-stream-fixtures.test.ts` and `test/cli-operator.test.ts`; the new third parameter defaults to `false`, so those calls keep their behaviour.
- `STATUSES` and `PATCH_ACTIONS` are module-private in `src/agent-result.ts` today; exporting them changes no caller.
- Nothing outside `src/implementation-stage.ts` reads `implementation.phase.*` audit actions (grep of `src/`), so `implementation.phase.dropped` has no consumer to break.
- The emitters are used by: `emit-implementation-stage.mjs` in `test/implementation-stage.test.ts`, `test/cli.test.ts`, `test/operator-state.test.ts`, `test/prompts.test.ts`, `test/run-intake.test.ts` and `test/harness-stream-fixtures.test.ts`; `emit-code-review.mjs` in `test/code-review-stage.test.ts` and `test/harness-stream-fixtures.test.ts`; `emit-cli-run.mjs` in `test/cli-operator.test.ts`, `test/guided-command.test.ts`, `test/prompts.test.ts` and `test/run-command.test.ts`. The paid driver `.claude/skills/run-buildworks/driver.mjs` uses the real `claude` binary, not an emitter.
- `agent_run.input_hash` stays the hash of the prompt alone; the schema is not hashed. A replay is reproducible from the prompt and the schema constant at the commit that ran it.

**Verification:** Component: each schema matches the probed shape and the validator's constants; the harness sends `--json-schema` only when asked and reads `structured_output` when it did, refusing by name when it is missing; each of the three dispatches sends its schema and no other dispatch sends one; a phase drops an unchanged file, records it, and blocks only when nothing is left. End to end, as far as free commands reach: the stand-in executor drives runs through implementation and code-review remediation in schema mode, including the full-chain `cli-operator` tests. Regression: the focused files per task, `npm run typecheck`, `npm run check:docs`, the full serial suite against zero failures with `git log -1` unchanged afterwards, and the free smoke. A green result does not show how often a real schema-bound reply fails, or that a full paid run passes; that needs a paid run, which is a separate decision (open decision 2).

**Hazards considered:**
- **1 (model output shapes):** the motivating failure is a new shape, prose after an unfenced object; it becomes item 11, with the recorded reply as its contract test. For the three patch dispatches the shapes stop applying, because the body is a serialized object; the extractor still runs on it and still refuses what it refused.
- **2 (discarded output):** the raw stream is retained before parsing as today, and a missing `structured_output` is refused with the line number, so a failed schema dispatch is diagnosable from the retained bytes.
- **3 (state the constraint where it is requested):** the prompts keep stating the shape; the schema is the check, not a replacement for the statement.
- **4 (fixtures agreeing with code):** the emitters' schema-mode result line is held to the recorded probe line, the patch schema is compared with the schema that was live-tested, and the emitters refuse a patch prompt that arrives without a schema, so a fixture cannot pass by emitting what the code expects.
- **15 (read-only proposal subprocess):** `StructuredOutput` is a CLI tool, not a file write; the clean-tree and head checks after each dispatch are unchanged and still block.
- **19 (inactivity budget):** the structured answer streams as `input_json_delta` events (235 in one probe call), so the idle timer still measures inactivity.
- **20 (one dispatch over too much):** the phase drop answers the unchanged-file refusal in a phase; the large-reply probe measures whether an 82 KB prompt's reply survives the structured channel where free text broke.
- **23 (the self-review):** the drop function is the self-review's, now shared, and the self-review's behaviour does not change.
- **7, 14, 16, 21, 22:** not affected. Retries are not added (7); no review changes (14, 16); verification commands and the ignored-output guard are untouched (21, 22).

---

## Replay against the motivating failure

The web-calculator phase 2 reply failed twice over: trailing prose (refused by the extractor) and an unchanged `index.html` (refused by the applier). Under this plan the first cannot reach the parser, because the body is `structured_output` and any prose would sit in a separate text block that is not read; the second is dropped before applying and recorded. Recorded evidence for the first: 2 of 2 schema-bound calls answered with no text block. For the second: the free replay committed the same patch once `index.html` was removed.

Crew-chatter run 3's phase 2 reply (`test/fixtures/recorded/crew-chatter-run-3-phase-2-malformed-json.json`, $0.7789614) wrote 5,314 characters of one file unescaped, which the one-repair extractor cannot fix. Whether a structured answer avoids that is exactly what the large-reply probe measures; nothing recorded so far shows it.

## Tasks

### Task 1: The gating probes

**Depends on:** None. Needs the operator's consent to spend at execution time.

**Files:**
- Create: `test/fixtures/recorded/json-schema-probe-gate.json`
- Modify: `.claude/sessions/project-learnings.md` (the result, pass or fail)

**Steps:**
- Fix the reading rule in the fixture's provenance before any call. A call passes only if: the process exits 0; the result line has `subtype` `success` and `is_error` false; `permission_denials` is empty and the stream has at least one `Read` tool call; `structured_output` is a JSON object; `validateAgentResult("implementer", structured_output)` is ok with `status` `proposed`; every patch's `baseCommit` equals the probe's base. Call L additionally passes only if, after dropping each `modify` file whose `git hash-object --path=<path> --stdin` equals `git rev-parse <base>:<path>`, `applyProposedPatches` commits the rest on a fresh clone at the base with run 3's approved scope. Any failure stops the plan: record the shape and report to the operator; Tasks 2-8 do not start.
- Call L (large): clone `C:\Users\Shawn-work\repositories\testing-repos\crew-chatter` into `C:\Users\Shawn-work\repositories\testing-repos\json-schema-probe\crew-chatter-run-3` and check out `cc839ba8c3b95ef2c0866b23fab4421f8b87b414`. Rebuild the prompt with `buildImplementationAuthorPrompt` and `validatePlanDoc`/`planPhases` imported from `git archive c9ef115 src` (unpacked in the scratchpad), using run 3's frozen profile (`implementer` agent, `policy.implementationPhaseTasks`, `verification`), its approval scope, the plan and spec at `cc839ba` under the target's *docs/features/crew-chatter/*, phase 2, base `cc839ba…`, and the scope paths that exist at `cc839ba`. Refuse to spend unless its sha256 equals `cf168ee7eea9f1be87ec6519970a7356084c242641de5d0360cc05e14b9012a5`. Spawn `executor.command` from that profile plus `--model claude-sonnet-5-5 --effort medium` (its `dispatchSettings.implementer`) plus `--json-schema` with the schema in `test/fixtures/recorded/json-schema-probe-web-calculator-phase-2.json`'s `provenance.schema`, the prompt on stdin, the environment filtered to the profile's `envPassthrough`, and the clone as working directory.
- Call S (small): the same procedure for web-calculator run 1 phase 2: clone `C:\Users\Shawn-work\repositories\testing-repos\web-calculator-selfreview-2026-10-14\target` into `C:\Users\Shawn-work\repositories\testing-repos\json-schema-probe\web-calculator-run-1`, check out `be3a32ceca5b4873da76cfbfb05d94a21c1fa0f9`, rebuild the prompt with the current builder, and refuse to spend unless its sha256 equals `cc2af331b3247a9d778a5878a184c08201be35d34e7005b4c921884195717ceb`.
- Expected cost: call L's prompt cost $0.7789614 when it last ran and call S's $0.0287 to $0.0775, so about $0.86 [Inference]. Run L, then S, sequentially.
- Write the fixture: provenance (the operator's consent, capture date, both prompt hashes and how they were rebuilt, the schema, the reading rule, cost, what was dropped), and per call the verbatim result line, the ordered tool-call names, any text blocks, the reading-rule outcome per criterion, and for L the file count, the reply's byte length, the dropped paths and the resulting commit. Search the fixture for local user names, credentials and key material before saving; a local path in `permission_denials` or a tool input is replaced with a placeholder and the replacement is named in `droppedFromEnvelope`.
- Verify: re-run the reading rule from the committed fixture alone with `parseEnvelope` (one-line stream), `extractJsonBody` and `validateAgentResult`.
- Expected: both calls pass. If not, stop.

**Task completion evidence:** the fixture, the reading-rule table, the total cost, and a learnings entry.

### Task 2: The two schemas

**Depends on:** Task 1 passed.

**Files:**
- Modify: `src/agent-result.ts` — export `STATUSES` and `PATCH_ACTIONS`; add `PATCH_RESULT_SCHEMA`.
- Modify: `src/implementation-self-review.ts` — add `SELF_REVIEW_RESULT_SCHEMA`.
- Modify: `test/agent-result.test.ts`, `test/implementation-self-review.test.ts`

**Steps:**
- Read each file to the end before editing.
- `PATCH_RESULT_SCHEMA`: an object schema with `additionalProperties: false`, required `status`, `agent`, `role`, `executor`, `summary`, `proposedPatches`; `status` an enum built from `STATUSES`; `role` the enum `author`, `reviewer`; `agent`, `executor`, `summary` strings; `proposedPatches` an array of objects (`additionalProperties: false`, required `baseCommit` and `files`), each file an object (`additionalProperties: false`, required `path`, `action`, `content`) with `action` an enum built from `PATCH_ACTIONS`. A comment names the probe fixtures and says why the schema is per invocation and not frozen.
- `SELF_REVIEW_RESULT_SCHEMA`: the patch schema with `proposedContentChanges` added to `properties` and to `required`: an object (`additionalProperties: false`, required `selfReview`) whose `selfReview` is an object (`additionalProperties: false`, required `critique`) whose `critique` is an array of strings with `minItems: 1` and `minLength: 1` per item, matching `validateImplementationSelfReview`. Build it from `PATCH_RESULT_SCHEMA`, not by copying it.
- Tests: `PATCH_RESULT_SCHEMA` deep-equals `provenance.schema` in `test/fixtures/recorded/json-schema-probe-web-calculator-phase-2.json` (the schema that was live-tested); its enums equal the exported constants; every recorded `structured_output` in both probe fixtures passes `validateAgentResult`. `SELF_REVIEW_RESULT_SCHEMA` keeps every patch-schema property, requires `proposedContentChanges`, and its `critique` bounds match the validator: an empty critique is refused by the validator and forbidden by `minItems`.
- Break it: in `PATCH_RESULT_SCHEMA` only, change the `action` enum to `[...PATCH_ACTIONS, "delete"]`, leaving the constant alone; the deep-equal test must fail. Restore and compare the file's hash.
- Verify: `node --test --test-reporter=tap test/agent-result.test.ts test/implementation-self-review.test.ts`
- Expected: all pass; the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 3: The harness sends a schema and reads the structured answer

**Depends on:** Task 2.

**Files:**
- Modify: `src/harness.ts` — `InvocationInput`, `invokeHarness`, `EnvelopeShape`, `parseEnvelope` and its comment.
- Modify: `src/dispatch.ts` — the `parseEnvelope` call in `dispatchOnce`.
- Modify: `test/harness.test.ts`

**Steps:**
- Read both source files to the end before editing.
- `InvocationInput` gains `jsonSchema?: object`, documented like `effort`. `invokeHarness` pushes `"--json-schema", JSON.stringify(input.jsonSchema)` after the effort pair when it is defined.
- `EnvelopeShape` gains `structured_output?: unknown`. `parseEnvelope(executor, raw, structured = false)`: when `structured` is true and the result line's `structured_output` is not a non-null, non-array object, throw `refuse(\`has a result line without a structured_output object although the dispatch requested --json-schema: line ${line}\`)`; otherwise `resultText` is `JSON.stringify(structured_output)`. When `structured` is false nothing changes. The comment names the probe fixtures and says `result` is not read in this mode.
- `dispatchOnce` passes `input.invocation?.jsonSchema !== undefined` as the third argument. The `RESULT_MAX_BYTES` cap keeps applying to `resultText`.
- Tests: the argv test gains a case where `jsonSchema` is set and the child argv ends `["--model", "m", "--effort", "medium", "--json-schema", JSON.stringify(schema)]`, and the existing cases show it absent. For each call in `json-schema-probe-web-calculator-phase-2.json`, `parseEnvelope(CLAUDE_CODE, call.resultLineVerbatim, true).resultText` equals `JSON.stringify(JSON.parse(call.resultLineVerbatim).structured_output)` and passes `validateAgentResult`; the same line with `structured_output` deleted throws the named refusal in structured mode and parses in text mode.
- Break it: make `parseEnvelope` ignore `structured`; the refusal test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/harness.test.ts test/dispatch.test.ts`
- Expected: all pass; the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 4: The stand-in executors answer the way the CLI does

**Depends on:** Task 3.

**Files:**
- Modify: `test/fixtures/harness/emit-implementation-stage.mjs`, `test/fixtures/harness/emit-code-review.mjs`, `test/fixtures/harness/emit-cli-run.mjs`
- Modify: `test/harness-stream-fixtures.test.ts`

**Steps:**
- Read each emitter to the end before editing.
- Each emitter reads `--json-schema` from `process.argv` (`emit-cli-run.mjs` adds it to the pairs its `options` function accepts, value required). In schema mode, an object reply is emitted as three lines: the `system` `init` line, an `assistant` message holding one `tool_use` block named `StructuredOutput` whose `input` is the reply, and the result line carrying `structured_output: <reply>` and `result: JSON.stringify(<reply>)`. It emits no `stream_event` delta: `kind()` in `test/harness-stream-fixtures.test.ts` holds line kinds to the text-mode recording, which has no `input_json_delta` kind, and the probe fixtures keep only result lines, so there is no recorded delta to copy. A string reply (the not-JSON modes, and `emit-code-review.mjs`'s `emitRaw` prose for reviewers and reconcilers) is emitted as today, with no `structured_output`, which is what a reply that never reached the structured channel looks like to the parser.
- Each emitter refuses loudly when a patch prompt arrives without `--json-schema`, and when any other prompt arrives with it: `emit-implementation-stage.mjs` (every prompt it serves is a phase or the self-review), `emit-code-review.mjs` (the remediation branch must have it; reviewer and reconciler branches must not), `emit-cli-run.mjs` (per route: implementation and remediation routes must have it, every other route must not). The thrown message names the prompt kind and the flag. This is the guard Task 5's wiring is proved against.
- `test/harness-stream-fixtures.test.ts`: give `Emission` an `args` field that `run()` passes after the script path (today it passes none), and a flag selecting which recorded result line its fields are held to. Add a schema-mode emission of each of the three emitters (args `--json-schema` plus the matching schema; a phase prompt, a remediation prompt, and an `emit-cli-run` implementation-route prompt) whose result-line fields are held to the keys of `resultLineVerbatim` in `json-schema-probe-web-calculator-phase-2.json`, whose line kinds stay within the recorded kinds, and which parse with `parseEnvelope(CLAUDE_CODE, stdout, true)`.
- Verify: `node --test --test-reporter=tap test/harness-stream-fixtures.test.ts`
- Expected: all pass. The stage suites are expected to fail until Task 5, because the emitters now refuse patch prompts without a schema; record that count as the pre-wiring baseline.

**Task completion evidence:** TAP counts for the shape test and the recorded baseline failure count of `test/implementation-stage.test.ts` and `test/code-review-stage.test.ts`.

### Task 5: Wire the three dispatches

**Depends on:** Task 4.

**Files:**
- Modify: `src/implementation-stage.ts` — the phase dispatch and the self-review dispatch.
- Modify: `src/code-review-stage.ts` — the remediation dispatch.
- Modify: `test/implementation-stage.test.ts`, `test/cli-operator.test.ts`, and any other test the grep below finds.

**Steps:**
- Read both source files to the end before editing.
- Phase dispatch: `invocation: { cwd: worktreePath, jsonSchema: PATCH_RESULT_SCHEMA }`. Self-review dispatch: `jsonSchema: SELF_REVIEW_RESULT_SCHEMA`. Remediation dispatch: `jsonSchema: PATCH_RESULT_SCHEMA`. One comment at each names this plan.
- `grep -rn "body refused" test/` and update every expectation for a schema dispatch's not-JSON reply to the envelope refusal (`envelope parse failed: harness envelope for executor claude-code has a result line without a structured_output object`). The audit action changes with it: such a reply is now a failed dispatch, so a phase records `implementation.author.failed` instead of `implementation.content.invalid`, remediation still records `code_review.remediation.failed`, and the self-review's skip reason reads `reason=self-review: dispatch failed: …`. Also `grep -rn "implementation.content.invalid" test/` and change only the expectations whose mode replies with a string; a structurally invalid object (for example the `empty-files` mode) still reaches the validator and keeps `implementation.content.invalid`. Expected values come from the refusal text written in Task 3 and the existing `abort` calls, not from a failing run's output.
- Break it: remove `jsonSchema` from the phase dispatch only; `test/implementation-stage.test.ts` must fail on the emitter's named refusal. Restore. Repeat for the remediation dispatch against `test/code-review-stage.test.ts`.
- Verify: `node --test --test-reporter=tap test/implementation-stage.test.ts test/code-review-stage.test.ts test/cli-operator.test.ts test/cli.test.ts test/prompts.test.ts test/run-command.test.ts test/guided-command.test.ts test/operator-state.test.ts test/run-intake.test.ts`
- Expected: 0 failures; both breaks fail.

**Task completion evidence:** TAP counts and both break-it outcomes.

### Task 6: A phase drops an unchanged file

**Depends on:** Task 5.

**Files:**
- Modify: `src/implementation-stage.ts` — new module function `dropUnchangedFiles`, the phase loop, the self-review block.
- Modify: `test/fixtures/harness/emit-implementation-stage.mjs` — two modes.
- Modify: `test/implementation-stage.test.ts`

**Steps:**
- Move the self-review's drop loop into `dropUnchangedFiles(worktreePath, commit, scope, patches)`, returning `{ ok: true; kept: ProposedPatch[]; dropped: string[] } | { ok: false; reason: string }` with exactly today's rule (only `modify` files inside `scope`, `sameBlobAtCommit` against `commit`, a patch left empty is removed). The self-review calls it and keeps its pass-event text; its tests must pass unchanged.
- In the phase loop, after the empty-patch check and before `applyProposedPatches`, call it with `phaseBase`. A `{ ok: false }` blocks with `implementation.patch.refused` and `${where}${reason}`. A non-empty `dropped` records `implementation.phase.dropped` with `phase K of N: unchanged at <phaseBase>: <paths>`. If `kept` is empty, block with `implementation.content.invalid` and `${where}every returned file is unchanged at ${phaseBase} (<paths>): a phase that changes nothing blocks the run`. Otherwise apply `kept`. The `implementation.phase.apply` summary does not change.
- Emitter modes: `phased-unchanged`, where phase 2 returns its usual file plus a byte-identical copy of a file phase 1 committed, read from the checkout; and `phased-all-unchanged`, where phase 2 returns only that copy.
- Tests: `phased-unchanged` passes, records one `implementation.phase.dropped` naming the copied path, and phase 2's commit touches only its own file; `phased-all-unchanged` blocks with the message above and records no phase 2 commit.
- Break it: skip the `dropUnchangedFiles` call in the phase loop; the `phased-unchanged` test must fail with "staged set differs from the proposed patch". Restore and compare the file's hash.
- Verify: `node --test --test-reporter=tap test/implementation-stage.test.ts`
- Expected: all pass; the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 7: Record the evidence

**Depends on:** Task 6.

**Files:**
- Modify: `docs/hazards.md` — hazards 1 and 20.
- Modify: `test/parse-output.test.ts`
- Modify: `ARCHITECTURE.md` — section 11 ("Invocation" and "Reading the result"), section 12 (the `implementation` paragraph).
- Modify: `CLAUDE.md`, then copy to `AGENTS.md` — "Phased implementation".
- Modify: `.claude/sessions/project-learnings.md`

**Steps:**
- Hazard 1: add item 11, "prose after an unfenced object, e.g. `{…}\n\nWait — …`", to the enumerated list, and a "Measured, 2026-10-14, $1.12023 for the run" paragraph: the reply, the refusal text, the fixture, and what changed (the three patch dispatches answer through `--json-schema`, Task 1's results in numbers), followed by "What this does not show": the sample sizes, that the other dispatches still parse free text, and that the CLI's behaviour on a schema failure is unknown.
- `test/parse-output.test.ts`: the recorded reply in `web-calculator-selfreview-run-1-phase-2-trailing-prose.json` is refused by `extractJsonBody` with its recorded reason ("Unexpected non-whitespace character after JSON at position 4135"), and its first `provenance.measured.jsonEndsAt` characters parse; that fixture is item 11's contract test.
- Hazard 20: a "Measured" paragraph for the unchanged `index.html` in phase 2, the replay result, and the drop, with the same "What this does not show" discipline.
- `ARCHITECTURE.md` section 11 "Invocation": a paragraph after "Model and effort are per invocation" stating that the three patch-producing dispatches append `--json-schema` with the schema for their result, that it is a code constant and not part of the frozen executor definition, and that no other dispatch sends one. "Reading the result": for a dispatch that requested a schema, the body is the result line's `structured_output`, serialized, and a result line without one is refused by name. Section 12's `implementation` paragraph: a phase drops a returned file unchanged at its base, records it, and blocks when nothing is left.
- `CLAUDE.md` "Phased implementation": one sentence for the phase drop and one saying phases, the self-review and code-review remediation receive their answer through `--json-schema`. Copy the file to `AGENTS.md` and compare hashes.
- Learnings: Current state and a dated entry.
- Verify: `node --test --test-reporter=tap test/parse-output.test.ts` and `npm run check:docs`
- Expected: pass; doc-check clean apart from standing warnings.

**Task completion evidence:** TAP counts, doc-check output, matching hashes.

### Task 8: Regression

**Depends on:** Task 7.

**Steps:**
- `npm run typecheck`: clean.
- Record `git log -1 --format=%h`, run `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`, then record `git log -1 --format=%h` again: 0 failures, the same hash.
- Free smoke: `node .claude/skills/run-buildworks/driver.mjs smoke` with the nested `claude` bin directory first on PATH (this host): `13/13 steps as expected`.

**Task completion evidence:** the counts and both hashes.

## Open decisions

1. **Remediation drops unchanged files too.** Remediation uses the same applier and would block the same way, but this plan leaves it as it is because the operator asked for the phase drop. It is a one-call change after Task 6.
2. **A paid end-to-end run after the build.** Not authorized by this plan; it needs its own consent and range.
3. **The other structured dispatches** (spec and plan authors, self-critiques, reviewers, split, reconcilers) moving to `--json-schema`. Out of scope; each needs its own schema.
4. **Rewording the prompts' "Output the JSON object directly" sentence** for schema dispatches. **Decided 2026-10-14 by the operator ("yes reword that sentence first"), built before Task 2.** The evidence: call L wrote its whole answer as text first, then again through the tool, at 81,781 output tokens against 53,154 for the free-text reply to the same prompt ($1.2574650 against $0.7789614). Three smaller calls did not. One large sample does not show how often it happens. The phase, self-review and remediation prompts now carry `STRUCTURED_OUTPUT_RULE` (`src/prompts.ts`), "Submit the JSON object once, through the structured output tool, and do not also write it out as text before or after: only the structured output is read.", in place of that sentence; the JSON escaping lines stay, because the tool input is still JSON the model writes. Every other prompt keeps the sentence. `test/prompts.test.ts` asserts the rule once in each of the three prompts, the old sentence in none of them, and neither change in four free-text prompts; dropping the rule from the self-review builder failed that test (break-it, restored). Whether the new sentence stops the double write is unmeasured: no reworded prompt has reached a model, and the Task 1 evidence describes the old wording.

## Task 1 outcome (2026-10-14)

Run at the operator's request ("run the Task 1 probes"). Both calls passed every criterion of the reading rule; $1.2809081 in total against the $0.86 estimate. Evidence: `test/fixtures/recorded/json-schema-probe-gate.json`.
- **Call L** (crew-chatter run 3 phase 2, byte-identical prompt): ten files, 67,249 bytes of structured output, valid, and all ten applied and committed on a fresh clone at `cc839ba8` with nothing dropped, including `backend/src/features/attachments/routes.ts`, the file whose unescaped stretch broke the free-text reply. $1.2574650, 417 seconds, nine successful reads. It wrote a full text draft before the tool call (open decision 4); the draft and the submitted answer differ only in that file's `_res`/`res` parameter on two lines, one `�` escape against the literal character, and the summary. BuildWorks reads only the submitted answer.
- **Call S** (web-calculator run 1 phase 2, from a checkout under `testing-repos`): one file, `styles.css`, valid, $0.0234431, its `Read` succeeded. The earlier small probe's denied reads were tied to its checkout in the system temp directory [Inference].

Tasks 2-8 may proceed; building them needs the operator's go-ahead.

## Implementation note (2026-10-15)

Built at the operator's request ("go ahead and yes reword that sentence first"), uncommitted, no paid run. The reword (open decision 4) went in first, then Tasks 2-8.

**What shipped.** `PATCH_RESULT_SCHEMA` and `SELF_REVIEW_RESULT_SCHEMA`; `--json-schema` on the phase, self-review and remediation dispatches only; `parseEnvelope` reading `structured_output` in that mode; the three emitters answering in the CLI's structured shape and refusing a patch prompt without the flag (and any other prompt with it); `dropUnchangedFiles` shared by the phases and the self-review, with `implementation.phase.dropped`; hazard 1 item 11 with its contract test in `test/parse-output.test.ts`, hazard 20's measured paragraph, `ARCHITECTURE.md` sections 11 and 12, `CLAUDE.md`/`AGENTS.md`.

**Evidence per task.** Task 2: 20/20, the `delete` break failed 2 tests. Task 3: harness and dispatch 50 pass, the ignore-`structured` break failed 2. Task 4: 12/12 shape tests; pre-wiring baseline 49 of 67 implementation-stage and 10 of 57 code-review-stage failures. Task 5: the nine named suites plus the harness, agent-result and self-review files, 597 tests, 0 failures, HEAD unchanged; removing the phase schema failed 49 implementation-stage tests and removing the remediation schema failed 10 code-review-stage tests, each on the emitter's exit (its named message goes to stderr, which the stage reason does not carry; the message itself is held by the shape test's refusal cases). Task 6: 70 implementation-stage tests, 0 failures; bypassing the drop failed both new tests with "staged set differs from the proposed patch: staged src/p2.ts, proposed src/p1.ts, src/p2.ts". Task 7: the item 11 test failed when the extractor was loosened to cut at the last `}`; `check:docs` clean apart from standing warnings; `CLAUDE.md` and `AGENTS.md` hashes match. Task 8: see the learnings entry of 2026-10-15 for the full-suite counts and the smoke.

**Deviations.**
- A schema dispatch whose reply has no `structured_output` is now a failed dispatch, so it records `implementation.author.failed` (a phase) or a `dispatch failed:` skip (the self-review) and writes no `agent_run` row. In text mode the same unusable reply had a row and its cost. The independent review rated this medium; the refusal now names the cost the result line reports ("; the line reports total_cost_usd N"), so it reaches the failure's audit event. The row is still absent, as for every failed dispatch (`ARCHITECTURE.md` section 15).
- `dropUnchangedFiles` is not exactly the self-review's old loop: it compares only string content, and it keeps a patch that arrived with no file so the applier refuses it by name. The self-review refuses both cases before the drop, so its behaviour is unchanged.
- The drop runs before the applier's base-commit check. A reply whose every file is unchanged and whose `baseCommit` is wrong blocks as "every returned file is unchanged" rather than naming the base. The run blocks either way; only the reason differs. Not changed.
- Added beyond the plan: a phase `not-json` emitter mode and test, and a `remediation-prose` mode and test, so both failure paths are exercised; the local scratchpad path in `json-schema-probe-web-calculator-phase-2.json`'s two `permission_denials` entries was replaced with `<session-scratchpad>` (named in its `droppedFromEnvelope`).

**Independent review.** One in-session reviewer subagent (not the billed `/code-review ultra`): 0 high, 1 medium, 5 low. Fixed: the medium (cost in the refusal), the untested remediation path, the fixture path, this status. Recorded here and not changed: the drop's ordering and its rule differences. The findings and their dispositions are in `docs/features/structured-patch-output/2026-10-15-code-review.md` (`reconciled`).

**Not shown.** No reworded prompt and no schema-bound phase inside a real run has reached a model; the four probe calls are the only live evidence. Open decisions 1-3 are unchanged.
