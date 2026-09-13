# BuildWorks governed agentic SDLC dashboard design — review

**Reviewed document:** `design.md`

**Document type:** Design, with secondary product-specification content

**Review date:** 2026-09-12

**Status:** reconciled

**Hazards considered:** 2, discarded output is undiagnosable; 10, exact-match model acceptance against moving aliases; 12, configuration divergence between targets; 14, independence that cannot be proven; and 18, delivery proven while correctness remains uninspected. These hazards constrain evidence links, model reporting, frozen configuration, reviewer claims, and dashboard interpretation.

---

## Summary

The proposal describes a broad dashboard experience, but it does not define an architecture-compatible delivery surface or a truthful projection contract over the state BuildWorks currently stores. Planning from it requires inventing authorization, transport, schemas, security boundaries, and unavailable telemetry.

## Verdict

- **Not ready for implementation planning** — The proposal conflicts with the binding one-surface rule, defines records that compete with the authoritative schema, and makes Phase 1 acceptance depend on data the current system does not produce. Resolve the three critical issues before deriving an implementation plan.

## Critical issues — must fix before implementation

**Issue:** The dashboard has no authorized architectural boundary

- **Why it matters:** `ARCHITECTURE.md` section 3 permits one CLI surface that calls the core directly, and section 23 places a dashboard after the completed-run milestone without itself authorizing a second entry point. `AGENTS.md` states that only `code_review` received post-milestone authorization. A browser dashboard also needs a serving and query boundary, but the proposal specifies neither.
- **Where:** Sections 1, 3, 14, 16, 21.1, and 22.
- **Production impact:** Implementers either create a forbidden RPC or web entry point, make a browser read `.governance/state.db` directly, or couple UI code to CLI output without a declared contract. Each choice changes the architecture and trust boundary.
- **Recommended fix:** Record the operator decision that authorizes dashboard work, amend the binding architecture with exactly one permitted read boundary, and state whether all command handoffs remain external CLI invocations. Keep mutating behavior out of scope until separately authorized.

**Issue:** Suggested telemetry creates competing schemas and contradicts current records

- **Why it matters:** The architecture requires one schema per thing and one SQLite source of truth. Section 17 introduces `ModelAssignment`, `ModelUsageEvent`, `FindingRecord`, `TestCaseRecord`, `TestExecutionRecord`, `ReconciliationRoundRecord`, and section 7 adds `ExecutorTelemetry`, while calling them extensions rather than defining their ownership. Several values conflict with the database: run status has only `in_progress`, `blocked`, and `completed`; `waiting_for_approval` is a derived operator phase; finding reports exclude `info`; finding decisions use `addressed`, `rejected_with_rationale`, `upstream_follow_up`, `upstream_blocking`, and `cannot_determine`, not the proposed disposition set.
- **Where:** Sections 5.1, 7.9, 8.2, 17, and 18.
- **Production impact:** The dashboard reports states that cannot exist, loses distinctions the gates rely on, or persists a second telemetry model that silently diverges from authoritative run state.
- **Recommended fix:** Replace suggested duplicate records with a field-by-field projection from the current migrations and `RunSnapshot`. For every unavailable field, choose either a deliberate authoritative-schema change or an explicit unavailable state; do not create a sidecar record.

**Issue:** Phase 1 requires deferred and nonexistent data

- **Why it matters:** The first delivery phase requires test inventory, test execution, review assignments, rich timing, and evidence links. The current schema has no test tables, task records, model invocation table, reconciliation-round record, forecast record, or alert configuration. `test_authoring` remains a deferred stage requiring its own decision, and the operator snapshot exposes only the implemented run, stage, approval, cost, finding, proposal, verification, review, delivery, and evidence projections.
- **Where:** Sections 5, 6, 9 through 15, 20, and Phase 1 in section 22.
- **Production impact:** Phase 1 cannot satisfy its own acceptance criteria from current authoritative data. Planning either expands into unauthorized stages and schema work or fills gaps with inferred values, contrary to acceptance criterion 14.
- **Recommended fix:** Define a first release solely from fields already exposed by `RunSnapshot`, list every intentionally unavailable metric, and move each feature that depends on a deferred stage or new persistence contract behind its own explicit decision.

## High-risk areas

**Risk:** Viewer authorization and evidence redaction remain undefined

- **Why:** The dashboard includes portfolio views, approver identity, prompts, command logs, raw evidence, paths, and stable links across repositories. The architecture treats raw output as sensitive and keeps state machine-local, but the proposal defines no viewer identity, repository authorization, field-level redaction, or evidence-download rule.
- **Impact if ignored:** A read-only UI exposes repository content, operational paths, approval metadata, or retained model output to an unauthorized viewer.
- **Mitigation:** Define deployment locality, viewer identity, repository-level authorization, redaction ownership, and deny-by-default behavior for every evidence class before planning.

**Risk:** Live reads lack consistency and failure semantics

- **Why:** Native WebSockets, freshness timestamps, live activity, and shared filters assume a streaming query layer. The architecture requires exact-current read-only inspection, bounded SQLite contention, no hot-journal recovery by readers, and explicit refusal for missing or inconsistent evidence.
- **Impact if ignored:** A dashboard mixes rows from different boundaries, labels stale data as current, or hides a refused inspection behind partial cards.
- **Mitigation:** Define snapshot boundaries, refresh sequencing, stale and inconsistent states, contention behavior, schema mismatch behavior, and reconnect semantics without allowing the reader to repair state.

**Risk:** Comparative metrics overstate causal conclusions

- **Why:** The proposal compares harnesses, models, effort, findings, tests, cost, and time across materially different inputs. A warning about unequal runs does not define comparable cohorts, missing-telemetry exclusion, denominator rules, or confidence treatment.
- **Impact if ignored:** Operators interpret selection bias and incomplete telemetry as executor or model effectiveness.
- **Mitigation:** Specify cohort keys, minimum coverage, excluded-row accounting, denominator definitions, rate-card version binding, and a refusal state when comparisons lack equivalent inputs.

## Medium and low concerns

- **Medium:** The title and several labels hard-code BuildWorks even though section 1 notes that the system name is configurable. Require every visible product label to read the frozen or current configured system name.
- **Medium:** `EffortLevel` freezes provider-specific values while section 23 leaves the canonical vocabulary open. Resolve the vocabulary and preserve requested versus effective values before using it in contracts.
- **Medium:** Performance budgets omit data volume, device, browser, cache state, percentile, and measurement window, so the thresholds are not testable acceptance criteria.
- **Medium:** Keyboard shortcuts omit focus, text-entry, browser, assistive-technology, and conflict behavior. Define when shortcuts activate and how users discover or disable them.
- **Medium:** Configurable alerts imply persistent thresholds and notification state, but the proposal does not identify ownership, freeze behavior, or whether alerts observe current configuration or each run's frozen profile.

## Missing and underspecified areas

- Define the smallest authorized dashboard release and separate current-data views from future-stage views.
- Define the read projection contract, including pagination, stable identifiers, timestamps, precision, nullability, and unavailable-versus-zero behavior.
- Define local deployment, browser support, URL identity, evidence-link lifetime, and behavior after a retained worktree or evidence file disappears.
- Resolve the open decisions that alter schemas, security, source of truth, or the read-only boundary before planning; retain visual and forecasting choices as later decisions.

## Suggested improvements

- Add a source-of-truth matrix that maps each visible value to a database column, retained record, frozen profile field, or deterministic derivation.
- Turn the 16 acceptance criteria into release-specific criteria that name current authoritative inputs and explicit refusal states.
- Separate the visual design system from the governance data contract so visual changes do not imply new persisted state.

---

## Reconciliation

**Date:** 2026-09-12

**Disposition:** 15 accepted, 0 rejected, 3 deferred, 0 open

**Status:** reconciled

### Verdicts

- **Deferred — The dashboard has no authorized architectural boundary:** The operator kept dashboard implementation unapproved; planning remains blocked until a deliberate `ARCHITECTURE.md` amendment authorizes one read surface.
- **Accepted — Suggested telemetry creates competing schemas and contradicts current records:** Section 17 now makes `RunSnapshot` the sole read contract, maps every first-release value to it, and removes dashboard-owned telemetry types and parallel enums.
- **Accepted — Phase 1 requires deferred and nonexistent data:** The first release now contains only current snapshot data, while tests, tasks, forecasts, alerts, invocation telemetry, and cross-harness comparisons remain future capability.
- **Accepted — Viewer authorization and evidence redaction remain undefined:** The design now limits the target to one local operating-system user, forbids a network listener, excludes raw sensitive content, and names unavailable evidence behavior.
- **Accepted — Live reads lack consistency and failure semantics:** The read contract now defines complete per-repository snapshots, stale-state labeling, isolated refusals, bounded polling, and no reader repair or migration.
- **Accepted — Comparative metrics overstate causal conclusions:** Future comparisons now require equivalent cohort keys, explicit numerator and denominator values, exclusion counts, telemetry coverage, rate-card dates, and refusal when comparability fails.
- **Accepted — Configurable system name:** Product labels now use the configured system name, with BuildWorks retained only as the default.
- **Accepted — Effort vocabulary conflicts with an open decision:** The removed dashboard enums no longer freeze effort vocabulary; requested and effective values remain authoritative recorded strings.
- **Deferred — Performance budgets lack measurement conditions:** The values now remain provisional until an authorized surface defines browsers, data volume, device class, cache state, percentile, and measurement window.
- **Accepted — Keyboard shortcuts lack activation and conflict rules:** The design now excludes text-entry activation, preserves ordinary navigation, exposes bindings, and permits disabling conflicts.
- **Deferred — Alert configuration has no owner:** Alerts remain outside the first release until threshold ownership, notification state, and frozen-profile behavior receive approval.
- **Accepted — Smallest authorized release is undefined:** Section 1.1 and section 22 now define the current-snapshot release and its architecture prerequisite.
- **Accepted — Read projection contract is undefined:** Section 17 now defines authoritative fields, unavailable values, refresh consistency, failures, and repository isolation.
- **Accepted — Local deployment and evidence-link behavior are undefined:** The design now records launch-supplied repository roots, local-only viewing, repository-scoped links, and missing-artifact behavior.
- **Accepted — Open decisions block bounded planning:** Section 23 now separates settled first-release decisions from future decisions that do not enter the first release.
- **Accepted — Source-of-truth matrix is missing:** Section 17.1 now maps dashboard values to `RunSnapshot` fields and explicit unavailable states.
- **Accepted — Acceptance criteria mix current and future data:** Section 20 now contains release-specific criteria grounded in the current projection and explicit refusal states.
- **Accepted — Visual standards and data contracts are coupled:** The authoritative read contract and release boundary now sit outside the frontend technology standards, so visual rules create no persisted state.

### Subsequent authorization

On 2026-09-12, after this reconciliation, the operator authorized the deferred dashboard surface as a CLI-launched, loopback-only, read-only projection over current `RunSnapshot` data. `ARCHITECTURE.md` records the reason and boundary. This later decision satisfies the deferral trigger without rewriting the original review finding or its reconciliation evidence.
