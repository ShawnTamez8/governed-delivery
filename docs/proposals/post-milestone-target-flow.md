# Post-Milestone Target Flow

**Status:** Proposal — non-binding pending management decision

**Hazards considered:** 3 (every model-returned constrained field must be
stated in its prompt), 4 and 5 (guards must fail closed and delivery must be
proved), 6 and 7 (retries must be bounded and dispatches must do distinct
work), 11 and 12 (review identity and severity remain attributable), 13 and
14 (reconciliation cannot invent requirements or erase a blocking finding),
15 (scope expansion needs a visible disposition), and 16 (cost attribution
must survive fallback).

This proposal preserves the deferred target flow from the management-facing
BuildWorks delivery brief. It does not authorize work beyond the explicit
step-9 stop in `ARCHITECTURE.md`; that requires a separate management decision.

## Decision sought

Decide whether BuildWorks should proceed beyond the completed end-to-end,
queryable-cost milestone and, if so, authorize planning for the following
stages and controls.

## Deferred target flow

The following is a reasonable extension of the current chain, but it is not
yet binding architecture:

1. Add stable requirement/criterion, plan-item, and task identities assigned
   by the system.
2. Add a deterministic traceability gate that proves every approved criterion
   maps to at least one plan item, and every executable plan item maps to one
   or more tasks or a justified non-task disposition.
3. Store tasks as run-owned rows with execution evidence and status derived
   from governed actions, not from hand-edited task documents.
4. Select up to five code-review specialists from registered lenses based on
   approved scope, changed paths, technology, and risk. Models may propose
   lenses; deterministic code must select identities and enforce role
   separation.
5. Route inexpensive, narrow review work to frozen fast-model configurations
   while reserving a stronger reasoning model for reconciliation. Record
   actual models, fallback, tokens, and cost per invocation.
6. Give code-review reports the same immutable report/canonical finding/typed
   decision pattern as spec and plan review, including upstream proposal
   routing.
7. Require every code-review finding and decision to trace to a changed
   location/commit and, when applicable, the plan item/task being reviewed.
8. Place the code-review gate before terminal verification and delivery, then
   design any remediation loop with a bounded, varied retry strategy.
9. Add documentation, final-verification, and PR-summary stages only after
   their inputs, outputs, gates, and cost are explicit.
