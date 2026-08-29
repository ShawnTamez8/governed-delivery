# Harness Adapter Implementation Plan — review

**Reviewed document:** `C:\Users\Shawn-work\repositories\governed-delivery\docs\features\harness-adapter\plan.md`
**Document type:** Plan. A full implementation plan in the repository's write-plan format; its assumptions section resolves architecture ambiguities, and those resolutions receive review as design decisions.
**Review date:** 2026-08-29

---

## Summary

The plan is strongly grounded: every hazard that applies to spawning a real harness is named, the fixture discipline follows hard rule 5, the blast radius is verified by reading and grep, and every guard carries a break-it step. One critical gap remains — the failure paths discard the evidence the architecture exists to preserve — and one schema tension deserves an explicit decision rather than a quiet assumption.

## Verdict

**Ready for planning after required changes.** The critical issue is a reordering of the dispatch sequence, not a redesign; the remaining items are wording and one explicit decision.

## Critical issues — must fix before implementation

**Issue:** The failure paths discard raw output and write no audit event

- **Why it matters:** Task 6 Step 1's sequence is probe → invoke → timedOut? exit 1 → parseEnvelope → writeRawOutput → insertAgentRun → appendAudit. On timeout the plan exits before `writeRawOutput` and before `appendAudit`; a parse failure skips both via the exception path. The plan's own Known blockers state hazard 2's rule — "raw bytes must be written to disk before the envelope or the inner body is parsed, so a parse failure still leaves diagnosable evidence" — and the sequence violates it. A timed-out or killed invocation has spent wall time and possibly real API cost, and produces exactly zero persisted evidence: no raw file, no `agent_run` row, no audit event. Section 16 ("Corrections are new events") and the evidence model's own definition — "a record of what an agent was allowed to see and do, plus what it actually cost" — have no representation of the event at all.
- **Where:** Task 6 Step 1 (the dispatch sequence); the hazard 2 bullet in Known blockers; the second schema assumption.
- **Production impact:** A run that times out repeatedly burns money invisibly: the audit chain and the cost query show nothing, and the partial output that would explain the hang is discarded.
- **Recommended fix:** Reorder the sequence: probe → invoke → `writeRawOutput` (retain before any parsing or branching) → `appendAudit` recording the attempt and its outcome (including a timeout or exit-code summary) → then branch. On timeout or non-zero exit: print a message naming the stage and agent ids, exit 1, no `agent_run` row — keeping the plan's schema assumption. Otherwise parse and insert.

## High-risk areas

**Risk:** Failed invocations have no `agent_run` row, so their spend drops out of every estimate

- **Why:** The plan's schema assumption is faithful to the architecture block (no status column), but section 11's rule — "record the gap explicitly rather than substituting a zero" — exists to keep estimates honest. An invocation that burned tokens before timing out is absent from `agent_run` entirely; the gap becomes invisible rather than explicit.
- **Impact if ignored:** Historical cost queries silently undercount failed runs; the milestone's "queryable cost" is systematically optimistic.
- **Mitigation:** With the critical fix in place the audit event carries the attempt. Additionally record the decision's consequence in the architecture — a line in section 15 stating that failed invocations are represented by audit events only until a status column is designed — or add the status column to the schema now through the architecture's own change process. Do not silently accept the gap.

## Medium and low concerns

- `parseEnvelope` assumes the outer envelope "is machine-generated and always valid JSON at the top level." A non-zero exit (auth failure, crash) produces empty or prose stdout; the current sequence then surfaces a raw JSON parse error that does not name the exit code. Check `HarnessOutcome.exitCode !== 0` before parsing and name the exit code in the refusal message.
- The `fallback` assumption says its field name and shape "are confirmed against the real recorded envelope in Task 3" — but the recorded invocation contains no fallback, so nothing confirms it. The fixture confirms only the null path. Reword the assumption to state which parts stay unverified until a real fallback occurs.
- `absoluteTimeoutSeconds` is a new field on a shape the architecture defines — section 11's executor YAML shows only `idleTimeoutSeconds`. Add the field to the architecture's YAML block in Task 7 so the document and the typed definition cannot drift.
- Task 6 Step 4's smoke test passes `--model sonnet` as a literal `requested_model`. The hazard-10 deferral covers this, but the smoke evidence should record the value as literal passthrough, since alias resolution later reinterprets it.

## Missing and underspecified areas

- The timeout message `dispatch timed out after <durationMs>ms` omits the stage and agent ids; the plan's own operator-visible-message discipline (hazard 1) names every cause elsewhere. Name them.
- The plan does not state whether `invokeHarness`'s spawn-error path (a successful probe followed by a failed spawn) retains the partial output; the critical fix's reorder covers it, so state that behavior explicitly in Task 6 once reordered.

## Suggested improvements

- Extend the environment-passthrough canary test to run a `cmd /c echo` style child under the filtered environment, so a missing Windows-specific variable (a `COMSPEC`-class dependency) surfaces in tests rather than in production.

---

## Reconciliation

**Date:** 2026-08-29
**Disposition:** 6 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — failure paths discard evidence (critical):** `src/dispatch.ts`
  retains raw output and stderr and appends the audit event before any
  branch; failure paths write `agent.dispatch.failed` and insert no
  `agent_run` row. The ordering break-it was run: removing retention made
  all three failure-path tests fail; restored, they pass.
- **Accepted — failed invocations have no `agent_run` row (high-risk):**
  architecture section 15 now states the rule explicitly: an invocation
  that produces no envelope records no row; its audit event and retained
  raw output are the record until a status column is designed.
- **Accepted — exit-code check before parsing (medium):** dispatch branches
  on `exitCode !== 0` with a named message before `parseEnvelope` runs.
- **Accepted — fallback shape unverified by the fixture (medium):** the plan
  assumption is reflected in the implementation note; the fixture confirms
  only the null path.
- **Accepted — `absoluteTimeoutSeconds` in the architecture (medium):**
  section 11's YAML now carries the field.
- **Accepted — timeout message names stage and agent (medium):** every
  failure reason names the agent, role, stage, and cause.

The plan document itself was revised on disk to incorporate these findings
before implementation completed; the implementation note in the plan records
the remaining deviations.
