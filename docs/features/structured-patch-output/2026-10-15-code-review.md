# Structured patch output — code review

**Reviewed document:** `docs/features/structured-patch-output/plan.md`

**Review date:** 2026-10-15

**Status:** reconciled

**Reviewer:** one in-session general-purpose reviewer subagent, read-only, separate context; not the billed `/code-review ultra`. It is the same session that wrote the code, so this is `unverified_self_attestation` in the sense of hazard 14, not an independent process.

**Hazards considered:** 1 (the change is about which channel a patch reply is parsed from; the reviewer checked that `result` text cannot reach the parser in structured mode), 2 (finding 1: a refused structured reply left its cost recorded nowhere), 4 (the reviewer checked that each new test fails without the change and that expected values come from recorded fixtures or the plan's refusal text), 14 (the reviewer label above), 20 (the phase drop; finding 2 is about its ordering against the applier's checks). Entries 3, 5-13, 15-19 and 21-23 were not touched by this diff: no prompt constraint, delivery, retry, executable, configuration, specification, sandbox, reconciliation, timeout, verification-command or ignored-output path changed.

**Scope reviewed:** the uncommitted diff against `fd235a8` (`src/agent-result.ts`, `src/implementation-self-review.ts`, `src/harness.ts`, `src/dispatch.ts`, `src/implementation-stage.ts`, `src/code-review-stage.ts`, `src/prompts.ts`, the three emitters under `test/fixtures/harness/`, the changed tests, the docs) plus the untracked plan and the three recorded fixtures. The reviewer ran no tests.

## Summary

No high-severity finding. Checked and found correct: only the phase, self-review and remediation dispatches set `jsonSchema`; in structured mode `resultText` is the serialized `structured_output` and `result` is never read; `RESULT_MAX_BYTES` still caps it; a missing, null, array or string `structured_output` is refused by name; the self-review's behaviour is unchanged because `readSelfReviewReply` refuses empty patches and non-string content before the drop; the structured-mode, phase `not-json` and `phased-unchanged` tests would fail without the change; the documented numbers match the fixtures.

## Findings (as reported)

1. **Medium — a refused structured reply leaves no cost in the store** (`src/dispatch.ts`, `src/harness.ts`). When the CLI exits 0 with a result line but no `structured_output`, the dispatch now fails at the envelope, writes no `agent_run` row, and its `total_cost_usd` is lost. In text mode the same unusable reply had a row and its cost and was refused later at the body.
2. **Low — the block reason can name the wrong cause** (`src/implementation-stage.ts`). The drop runs before the applier's `baseCommit` and empty-patch checks, so a reply whose every file is unchanged and whose base is wrong blocks as "every returned file is unchanged", and a reply mixing an empty patch with unchanged files records a dropped event naming files that were not the problem. The run blocks correctly either way.
3. **Low — nothing tests the remediation failure path** (`test/code-review-stage.test.ts`). No emitter mode sends remediation a reply without `structured_output`.
4. **Low — `dropUnchangedFiles` differs from the plan's "exactly today's rule"** (`src/implementation-stage.ts`). It compares only string content and keeps a patch that arrived with no file.
5. **Low — a probe fixture holds a local path** (`test/fixtures/recorded/json-schema-probe-web-calculator-phase-2.json`). Both `permission_denials` entries name the session scratchpad under the operator's user directory, which Task 1 said to replace.
6. **Low — the plan's status is stale** (`docs/features/structured-patch-output/plan.md`). It still read `Proposed`.

## Reconciliation (2026-10-15)

- **1 — accepted, fixed.** The refusal now ends "; the line reports total_cost_usd N" (or "reports no total_cost_usd"), so the cost reaches the failure's audit event; `ARCHITECTURE.md` section 11 says so. Tested in `test/harness.test.ts`, `test/implementation-stage.test.ts` and `test/code-review-stage.test.ts`; dropping the suffix failed all three, restored by hash. The `agent_run` row is still absent, as for every failed dispatch (section 15).
- **2 — accepted, not changed.** Diagnosis only; recorded as a deviation in the plan's implementation note.
- **3 — accepted, fixed.** A `remediation-prose` emitter mode and a test asserting `code_review.remediation.failed` with the envelope refusal and no remediation row.
- **4 — accepted, recorded.** The deviation is in the plan's implementation note; the self-review pre-filters both cases.
- **5 — accepted, fixed.** Both paths now read `<session-scratchpad>`, and the fixture's `droppedFromEnvelope` names the replacement.
- **6 — accepted, fixed.** The plan is `Implemented`, with an implementation note.

After the fixes: full serial suite 1562 tests, 1556 pass, 0 fail, 6 skipped, HEAD `fd235a8` unchanged; typecheck and `check:docs` clean; smoke 13/13.
