# Dashboard Redesign 3 — code review

**Reviewed document:** `docs/features/dashboard-redesign-3/plan.md`
**Review date:** 2026-09-13
**Status:** reconciled
**Review effort:** high
**Hazards considered:** 2 (evidence and telemetry availability must be explicit rather than hiding gaps or reconstructing raw output; unavailable execution duration and absent token classes are labeled as missing or unavailable rather than zero); 4 (UI and model expectations derive from authoritative `Store` rows and `RunSnapshot` contracts rather than hand-written fixtures; all guards are proved by breaking them with mutation and confirming failure); 10 (recorded model identifiers remain verbatim without alias normalization; agent-level model and execution duration remain explicitly unavailable as deferred by operator decision); 12 (repository identity and configuration remain isolated and labeled per repository); 14 (recorded reviewer identity is presented as recorded evidence, not an independence claim; multi-reviewer panels remain attributed); and 18 (completed stages and passed checks remain evidence records, never claims of semantic product correctness; stage and gate outcomes are explicitly stated). Hazards 1, 3, 5-9, 11, 13, and 15-17 do not apply because this increment dispatches no model, completes no stage, installs no hook, launches no harness, creates no proposal, and performs no remediation.

**Scope reviewed:** `git --no-pager diff HEAD -- README.md src/dashboard/app.js src/dashboard/dashboard-model.js src/dashboard/index.html src/dashboard/styles.css test/dashboard-ui.test.ts` plus untracked files `docs/features/dashboard-redesign-3/design.md` and `docs/features/dashboard-redesign-3/plan.md`. The review also read `ARCHITECTURE.md`, `CLAUDE.md`, `.claude/review-code.md`, `docs/hazards.md`, `.claude/sessions/project-learnings.md`, and the governing plan and design. Full test suite, composed type checking, and documentation checks pass.

## Summary

The implementation transforms BuildWorks' read-only dashboard into an enterprise-grade governed delivery command center. It delivers a 6-tab primary navigation structure (`Overview`, `Runs`, `Findings`, `Governance`, `Models & Agents`, `Audit`), a 6-card outcome-focused horizontal KPI strip, a prioritized Needs Attention exception queue, an interactive 8-stage Delivery Pipeline stepper, secondary governance health and model assignment panels, lower AI utilization and data quality panels, an enterprise Governed Deliveries portfolio table, and progressive disclosure slide-over drawers.

The review verified all hard rules, security boundaries, and accessibility contracts:
- Strict preservation of the loopback read-only boundary (GET requests only; copy-only CLI commands; zero mutations).
- Content Security Policy compliance (`style-src 'self'` with zero inline style attributes).
- WCAG 2.2 AA accessibility (tested contrast ratios >= 4.5:1 text, >= 3:1 non-text; keyboard navigation across tabs; focus trapping in drawers; modal dialog shortcuts).
- Five mutation proofs (M1-M5) executed and verified against real `Store` and `RunSnapshot` models.

One confirmed finding regarding event listener accumulation in popover triggers was identified during the review and reconciled inline. Withheld from this review were explicitly deferred operator decisions (agent execution duration and model attribution), pre-existing patterns, and style/formatting preferences.

## Findings

### Finding 1 — Metric popover trigger accumulated document-level click listeners across re-renders

- **Where:** `src/dashboard/app.js` (`metricInfoButton`).
- **Severity:** Low because the listener overhead is lightweight, but across repeated manual refreshes or tab switches, unmounted wrapper elements were retained in closure scope.
- **Why it matters:** Every invocation of `metricInfoButton` permanently registered an anonymous `document.addEventListener("click", ...)` to detect clicks outside the popover. Because the listener was never removed when the popover closed or the element unmounted, listeners accumulated on `document`.
- **Reproduced:** Confirmed by inspection and tracing in `src/dashboard/app.js`: creating a `metricInfoButton` added an unconditional document listener regardless of whether the popover was open or closed.
- **Disposition:** Resolved. Refactored `metricInfoButton` so that the `document` click listener is registered only when the popover is opened (`aria-expanded="true"`), and immediately removed via `document.removeEventListener("click", onDocumentClick)` when the popover closes.
