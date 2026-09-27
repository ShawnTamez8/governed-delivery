# Reconciliation Disposition Shapes Implementation Plan

**Status:** Implemented

**Goal:** Make both reconciliation prompts state, and advertise as a valid example, the complete decision shape for every disposition. That stops upstream decisions from being refused for a missing `changedLocations` or `proposal`, and the validator stays unchanged.

**Source:** Operator request of 2026-09-26 ("The bug in buildworks needs fixed"). The evidence is two paid `note-keeper` runs that blocked at `spec_review` on structure refusals:
- **Run 2:** cost $1.2429162. Refusal: `reconciliation decision for finding 22 is missing changedLocations`.
- **Run 3:** cost $2.141577. Refusal: `finding 31 is upstream_blocking without a proposal candidate`.

The retained reconciler envelopes are `.governance/raw/2/2026-09-26T07-15-18-843Z-8a352a9c8534.json` and `.governance/raw/3/2026-09-26T07-37-34-262Z-76c4be9240da.json` under the target `C:\Users\Shawn-work\repositories\testing-repos\note-keeper`.

**Hazards considered:** `docs/hazards.md` items 1, 2, 3, 4, 7, 16 and 17.
- **1 (output shapes):** extraction is untouched. Both envelopes parsed; the refusals are decision-structure refusals after parsing.
- **2 (discarded output):** retained raw output is what made the diagnosis possible, and Task 1 copies it into the repository.
- **3 (constraint stated in the prompt):** this is the defect. The prompt advertises one decision shape, that shape is valid for no upstream disposition, and the field bullet invites omission.
- **4 (hand-written fixtures):** the replay fixtures are verbatim provider output. The new shape test derives its decisions from the generated prompt, not from literals.
- **7 (retries that vary nothing):** no retry is added.
- **16 and 17 (upstream routing, deletion accounting):** the validator, normative accounting and conditional-field matrix are unchanged, so no route loosens.

Items 5, 6, 8–15 and 18 do not govern this change. It touches no delivery check, planning promise, executable resolution, hook, model alias, configuration surface, default seeding, specification-provenance rule, reviewer independence, sandbox, or code-review gate.

**Assumptions:**
- The two refusals are correct and stay refusals. The validator's structure/content boundary (`src/reconciliation.ts` module comment) says a missing field is the model failing the contract.
- No live provider run is authorized. The fix is proven against the prompt contract and recorded responses only. Whether a live reconciler now complies is unverified until a separately authorized run.

**Approach:**
- **Contract text.** In `reconciliationDecisionContract`, make `changedLocations` unconditionally required, with `[]` as the stated empty value. State that `proposal` is required even when the artifact's prose already describes the gap.
- **Shape block.** Add one complete shape per disposition, with `<...>` placeholders.
- **Envelope.** Change `exampleDecisionsFor` so each advertised entry points at those shapes instead of showing only the `addressed`-like skeleton.
- **Proof.** A new test extracts every advertised shape from both generated prompts, fills the placeholders mechanically, and runs it through `validateReconciliation`. Recorded replays pin that the validator still refuses both provider responses.

**Affected areas:**
- `src/prompts.ts`: `reconciliationDecisionContract` and `exampleDecisionsFor`, both module-private, rendered by `buildSpecReconcilePrompt` and `buildPlanReconcilePrompt`.
- `test/prompts.test.ts`
- `test/reconciliation.test.ts`
- Two new files in `test/fixtures/recorded/`
- `docs/hazards.md`: hazard 3.

**Known blockers:**
- The working tree carries uncommitted dashboard PWA-redesign work (`README.md`, `src/dashboard/*`, `test/dashboard-ui.test.ts`), plus the untracked `integrity-review-v2.md`. Per `.claude/sessions/project-learnings.md`, five structure-pinning tests in `test/dashboard-ui.test.ts` currently fail (that plan's Task 6). This plan must not edit those files. Full-suite results are judged against a baseline captured before any change (Task 0).
- `test/cli-operator.test.ts:1394` fails when the suite is launched from the assistant's tool shell and passes in the operator's terminal (project-learnings, 2026-09-24). A failure there is baseline noise, not a regression.
- The fixture emitters route on prompt words and scrape finding ids (`test/fixtures/harness/emit-spec-stage.mjs:126,167-212`, `emit-plan-stage.mjs:130,171-216`). The new contract text must not contain the substrings `self-critique`, `spec reviewer` or `plan reviewer`. It must not contain `finding ` followed by a digit, or the emitters would answer a phantom finding id.
- `CONSTRAINT_STRINGS` checks the prompt source file, so each pinned phrase must sit on one source line (project-learnings: a phrase wrapped across a template-literal line fails).
- Paid execution is not authorized (project-learnings "Implementation boundary").

**Blast radius:**
- **Callers.**
  - `reconciliationDecisionContract` and `exampleDecisionsFor` are not exported. Their only callers are `buildSpecReconcilePrompt` (`src/prompts.ts:668,683`) and `buildPlanReconcilePrompt` (`src/prompts.ts:748,762`).
  - Those builders are called from `src/spec-stage.ts:521` and `src/plan-stage.ts:626` and from `test/prompts.test.ts` (lines 665, 743, 803-855, 1032, 1036, 1178-1179).
  - Verified by grep; no other importer exists.
- **Tests.** The routing tests at `test/prompts.test.ts:1043-1118` and the end-to-end emitter composition at `test/prompts.test.ts:1137` feed the reconcile prompt through the harness emitters, so they cover the routing constraint above.
- **Frozen profile.** Prompts are not frozen profile content: `src/policy.ts` constants are, and prompt text is code. So the change reaches only dispatches issued after it lands. No run is in progress on any target in this checkout (project-learnings "Running state"; the three `note-keeper` runs are terminally blocked).
- **Prompt size.** Each reconcile prompt grows by roughly 1 KB against `promptMaxBytes` 1048576.
- **Unchanged.** No schema, migration, validator or store change.

**Verification:**
- Focused runs: `node --test test/prompts.test.ts test/reconciliation.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`.
- `npm run typecheck`, `npm run check:docs` and `npm test`, compared against the Task 0 baseline.
- A break-test for each new guard (Task 3).

---

## Success criteria

- Both generated reconciliation prompts state that `changedLocations` is required on every decision and that `[]` is its value when nothing changed.
- Both prompts state that `proposal` is required on `upstream_follow_up` and `upstream_blocking` even when the revised artifact already describes the open decision in prose.
- Both prompts advertise exactly one complete shape for each of the five dispositions. Each shape, with placeholders filled mechanically, passes `validateReconciliation` with no conversion.
- The advertised decisions envelope still lists every canonical finding id exactly once, as the existing test requires. It no longer shows `"changedLocations": ["..."]` as the only entry shape.
- Both recorded `note-keeper` reconciler responses are committed with provenance and still refuse with their original messages.
- Hazard 3 carries a measured instance naming both runs, their costs, the cause, and the contract tests.
- `npm run typecheck` and `npm run check:docs` pass. `npm test` shows no failure outside the Task 0 baseline set.

## Tasks

- **Task 0: Record the baseline before changing anything.**
  - From the checkout root, run the suite with the TAP reporter: `node --test --test-reporter=tap test/*.test.ts`. That is the `npm test` script (`package.json`) with a reporter whose `not ok` lines name each failure. Redirect the output to a file in the session scratchpad, not the repository, and extract the `not ok` lines as the baseline set.
  - Expected: failures, if any, are limited to the known set in Known blockers (the `test/dashboard-ui.test.ts` structure tests and possibly `test/cli-operator.test.ts:1394`).
  - If anything else fails, stop and report it before editing. A red baseline outside the known set would make Task 4's comparison meaningless.

- **Task 1: Commit the two recorded responses and pin the refusals.**
  - Write a one-off extraction script in the session scratchpad, not the repository. It reads each retained raw envelope, parses the harness JSON, and keeps its `result` string verbatim. It reads the governing design from the run's starting commit with `git -C <note-keeper> show <commit>:docs/features/note-keeper/design.md` (the `configuration.startingCommit` each run's `status --json` reports: run 2 `c02cdc2db69ae6e8859ee191584854e0fd4e3508`, run 3 `c32c6908d49b07c0969fbbe01945c652d3e7678d`, both verified 2026-09-26). It writes one indented JSON file per run:
    - `test/fixtures/recorded/spec-reconciliation-note-keeper-missing-changed-locations.json`, from run 2.
    - `test/fixtures/recorded/spec-reconciliation-note-keeper-missing-proposal.json`, from run 3.
  - Each file has these members:
    - `provenance`, following the existing recorded files: `what`, `run`, `agent`, `dispatchedAt`, `capturedAt` 2026-09-26, `capturedFrom`, `fidelity`, `demonstrates`, `seeAlso` and `consumedBy`.
    - `canonicalFindingIds`: run 2 `[16,17,18,19,20,21,22,23,24,25]`; run 3 `[26,27,28,29,30,31,32,33]`.
    - `design`: the governing text.
    - `envelope`: `{ "result": <verbatim string> }`.
    - `fidelity` states that the harness envelope fields (session id, cost, usage, timings, model usage) were dropped and the `result` string is byte-for-byte what the provider returned.
    - The canonical finding ids are the `spec_review` findings the run recorded (run 2 status snapshot findings 16–25, run 3 findings 26–33).
  - In `test/reconciliation.test.ts`, beside the existing recorded replays (after the `NOTE_RUN` block), add a loader that uses `extractJsonBody(envelope.result)` exactly as `noteRunSpec` does. Add two tests. Each passes the recorded `decisions` to `validateReconciliation` with:
    - the recorded `canonicalFindingIds`;
    - `governingSource: "design"`;
    - the recorded `design`;
    - `beforeNormativeNodes` and `afterNormativeNodes` both `[]`, because the structure refusal returns before normative accounting (`src/reconciliation.ts:516-520`, `:618-621`, accounting from `:656`).

    The tests assert `ok === false` and the exact reasons:
    - `reconciliation decision for finding 22 is missing changedLocations`
    - `finding 31 is upstream_blocking without a proposal candidate`
  - Verify: `node --test test/reconciliation.test.ts`. Expected: all pass, including both new tests.
  - Evidence: two committed fixtures with provenance and two passing replays.

- **Task 2: State and advertise every disposition's complete shape in the shared contract.**
  - In `src/prompts.ts` `reconciliationDecisionContract`, replace the last line of the `changedLocations` bullet ("Empty when you change nothing, as for cannot_determine.") with sentences that keep each pinned phrase on one source line:
    - `changedLocations is required on every decision, whatever its disposition.`
    - `When you change nothing, send an empty array, "changedLocations": [], and never omit the field.`
    - `An upstream_follow_up, upstream_blocking, or cannot_determine decision usually changes nothing and still sends it.`
  - In the upstream paragraph, after the `proposal:` bullet, add:
    - `The proposal is required even when your revised artifact, its summary, or an out-of-scope note already describes the same open decision: prose in the document is not a proposal candidate, and a decision without its proposal object blocks the run.`
  - After `cannot_determine carries none of grounding, normativeChanges, or proposal.`, add a shape block. It opens with the line `Each decision takes exactly one of these complete shapes. Replace every <...> placeholder; <id> is the id of the finding the decision answers:`. Then one list line per disposition, in this order:
    - `- addressed: {"findingId": <id>, "disposition": "addressed", "rationale": "<why>", "changedLocations": ["<location you changed>"], "normativeChanges": []}`
    - `- rejected_with_rationale: {"findingId": <id>, "disposition": "rejected_with_rationale", "rationale": "<why>", "changedLocations": [], "grounding": {"source": "${sourceName}", "location": "<heading>", "excerpt": "<exact words>"}}`
    - `- upstream_follow_up: {"findingId": <id>, "disposition": "upstream_follow_up", "rationale": "<why>", "changedLocations": [], "proposal": {"title": "<title>", "problem": "<problem>", "whyUpstream": "<why upstream>"}}`
    - `- upstream_blocking:` the same as `upstream_follow_up` with that disposition.
    - `- cannot_determine: {"findingId": <id>, "disposition": "cannot_determine", "rationale": "<why>", "changedLocations": []}`

    Close the block with the line `An addressed decision's normativeChanges holds one entry per normative node it adds or removes, as described above; it is [] only when the change touches no normative node.`
  - In `exampleDecisionsFor`, render each canonical entry as `{"findingId": <n>, <the remaining fields of one shape listed below>}` instead of the fixed `addressed`-like skeleton. Keep the empty-round `[]` unchanged. Update both functions' doc comments: the envelope carries id completeness, and the shape block carries per-disposition validity (hazard 3's second sentence). The comment must no longer say a copied entry validates on its own.
  - Before saving, confirm the added text contains none of the emitter routing substrings and no `finding` followed by a space and a digit (Known blockers).
  - Verify: `npm run typecheck`, then `node --test test/prompts.test.ts test/spec-stage.test.ts test/plan-stage.test.ts`.
  - Expected: typecheck clean. The existing envelope-id test still extracts `[3, 5]`. The routing and emitter-composition tests pass.

- **Task 3: Prove the contract with tests, and prove each guard by breaking it.**
  - In `test/prompts.test.ts`, add four phrases to both per-prompt assertion lists (the spec list near line 666 and the plan list near line 744) and to `CONSTRAINT_STRINGS` (the reconciliation block near line 173):
    - `changedLocations is required on every decision`
    - `never omit the field`
    - `prose in the document is not a proposal candidate`
    - `Each decision takes exactly one of these complete shapes`
  - Add the test `every decision shape a reconcile prompt advertises validates against validateReconciliation`. It runs over two cases: spec (governing source `design`, governing text `DESIGN-TEXT`) and plan (`specification`, `SPEC-TEXT`), each built with the existing `PAIR` findings. For each:
    - Extract the shape lines with `/^- (addressed|rejected_with_rationale|upstream_follow_up|upstream_blocking|cannot_determine): (\{.*\})$/gm`.
    - Assert the five dispositions appear exactly once each.
    - For each shape, replace `<id>` with `7` and every other `<[^>]*>` placeholder with the governing text token, then `JSON.parse`.
    - Pass `[decision]` to `validateReconciliation` with `canonicalFindingIds: [7]` and both node lists `[]`.
    - Assert `ok`, zero conversions, empty `unclaimedNodes` and empty `unclaimedRemovals`.

    Import `validateReconciliation` from `../src/reconciliation.ts` if the file does not already.
  - Update the comment on the existing test `every finding id a reconcile prompt advertises is one the validator accepts` (`test/prompts.test.ts` near line 820). It currently says a copied array validates. The envelope now proves id completeness only, and the new shape test proves per-disposition validity. Do not change that test's assertions.
  - Break-tests. For each, record `git hash-object` of the mutated file first, apply exactly one mutation, run the named focused test, restore, and confirm the hash matches. Never touch the dashboard files. Also confirm from the TAP summary line that the failure is an assertion, not a crash (saved memory: a break-it crash looks like a held guard).
    1. Delete the `"proposal": {...}` member from the `upstream_blocking` shape. Expected: the shape test fails naming `upstream_blocking without a proposal candidate`.
    2. Delete `"changedLocations": []` from the `cannot_determine` shape. Expected: the shape test fails naming `missing changedLocations`.
    3. Remove the clause `, and never omit the field` from the Task 2 sentence. Expected: the `CONSTRAINT_STRINGS` test and both per-prompt tests fail.
    4. In `src/reconciliation.ts:516`, loosen the check to accept an absent field as `[]`. Expected: the run 2 replay test in `test/reconciliation.test.ts` fails. This proves the replay pins validator strictness.
  - Evidence: all new tests pass unmutated. Each mutation produces its expected assertion failure, and each restore is hash-identical.

- **Task 4: Record the measured instance and verify the repository.**
  - Append a `**Measured, 2026-09-26, $1.2429162 and $2.141577.**` paragraph to hazard 3 in `docs/hazards.md`, after the 2026-09-05 instances. Its content:
    - Two consecutive paid `note-keeper` spec reconciliations answered upstream findings and were refused as structure errors.
    - Run 2 sent a `proposal` but omitted `changedLocations`. Run 3 sent `"changedLocations": []` but omitted `proposal`, after describing the same gaps in the specification's own prose.
    - In both, every other decision was well formed. The whole round was discarded and the run blocked.
    - Cause: the decision's required fields depend on its disposition, but the prompt advertised a single `addressed`-like entry and said only that `changedLocations` is "empty ... as for cannot_determine".
    - Fix: the contract now states that `changedLocations` is unconditional, that `proposal` survives prose, and one complete shape per disposition, each validated by the new prompt test.
    - Name both committed fixtures.
    - Lesson: an example must validate on every branch the validator distinguishes, not only the common one.
    - The live compliance rate is unmeasured.
  - Verify: `npm run check:docs` (expected exit 0), `npm run typecheck` (clean), `npm test` (no failing test outside the Task 0 baseline set), and `git diff --check` (no whitespace errors).
  - Inspect `git status --short`. Expected: this plan's files are added or modified: the plan, the two fixtures, `src/prompts.ts`, `test/prompts.test.ts`, `test/reconciliation.test.ts` and `docs/hazards.md`. The pre-existing dashboard modifications are unchanged, and no scratch or generated file remains.

## Out of scope

- Any change to `validateReconciliation` or the structure/content boundary.
- A bounded reconciler re-dispatch on structure refusal. That is new behaviour beyond the build order and needs its own operator decision.
- Code-review prompts, which have no reconciliation dispatch.
- Any paid or live provider run, including re-running `note-keeper`.
- Committing. The operator decides when and how this lands relative to the in-progress dashboard work on this branch.

## Implementation note

Implemented 2026-09-26, uncommitted.

**What shipped:**
- Tasks 0-4 as written.
- Both fixtures are committed with provenance, and their replays pass.
- The contract text and shape block are in `src/prompts.ts`.
- The shape test, four pinned phrases per list, and the hazard 3 measured paragraph are in place.

**Verification:**
- `npm run typecheck` and `npm run check:docs` are clean. `git diff --check` is clean.
- `npm test` ran 1204 tests with one failure, `dashboard CLI prints one bootstrap URL...` (#273), which is in the baseline.
- The baseline ran 1201 tests with two failures: #273 and `run queue puts recorded in-progress rows first...` (#306). #306 passed this time. Both belong to the uncommitted dashboard work, which this plan did not touch.

**Deviations:**
- **Baseline outside the known set.** Task 0's baseline included #273 and #306, which Known blockers did not list. Both are dashboard tests in files this plan does not touch, so they were accepted as baseline rather than stopping.
- **Addressed shape.** Task 2 specified `"normativeChanges": []`. The independent review found that this advertises the rare prose-only branch as the example: the fixtures' addressed decisions that carried normativeChanges all claimed a node. It could invite an unclaimed-node block. The shape now shows one complete `normativeChanges` entry, and the closing sentence states when `[]` applies.
- **Placeholders.** The grounding placeholders now match the contract's wording (`<heading in the ... document>`, `<that document's exact words>`).
- **Shape test.** It now asserts that each line's label equals its JSON disposition, and that the addressed shape carries one entry. It validates the addressed entry against an after-node list derived from the filled shape.
- **Break-tests.** Six ran, not four. The two additional ones cover the review-driven guards. All six fail on assertions, and every restore is hash-identical.
- **Hazard 3 paragraph.** Scoped so it does not claim the prose-only branch is shown as a shape.

**Deferred:**
- Live compliance is unverified. No provider run was authorized, so whether a live reconciler now sends complete upstream decisions is unmeasured until a separately authorized run.
