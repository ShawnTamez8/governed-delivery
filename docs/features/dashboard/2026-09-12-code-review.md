# Dashboard read-only increment — code review

**Reviewed document:** `docs/features/dashboard/plan.md`
**Review date:** 2026-09-12
**Status:** reconciled
**Review effort:** high
**Hazards considered:** 2 required refusal and stale-state evidence to remain visible; 4 required real `Store` and operator envelopes plus isolated guard mutations; 10 required the projection to preserve frozen requested and effective model values; 12 required one shared read contract and stable repository identity across the CLI and dashboard; 14 required recorded independence labels to remain unchanged; and 18 required verification and review evidence without a correctness claim. Hazards 1, 3, 5-9, 11, 13, and 15-17 do not apply because this increment dispatches no model, completes no stage, installs no hook, launches no harness, creates no proposal, and performs no remediation.

**Scope reviewed:** `git --no-pager diff HEAD -- README.md package.json tsconfig.json tsconfig.dashboard.json src/cli-args.ts src/cli.ts test/cli-operator.test.ts test/run-command.test.ts` plus untracked files `src/operator-read.ts`, `src/dashboard-config.ts`, `src/dashboard-server.ts`, `src/dashboard/index.html`, `src/dashboard/app.js`, `src/dashboard/styles.css`, `test/dashboard-server.test.ts`, and `test/dashboard-ui.test.ts`. The review also read the binding architecture, hazard catalogue, project learning record, dashboard design, plan, and both prior document reviews. The full suite, focused dashboard tests, composed type checking, and documentation checker pass after reconciliation.

## Summary

The implementation preserves the CLI as the only mutation authority while adding the authorized CLI-launched, loopback-only read projection. The review found seven confirmed defects in route identity, Windows repository identity, shutdown documentation, TypeScript program boundaries, and overlapping refreshes. The implementation workflow resolved all seven, and independent follow-up reviews found no open material defects.

The review withholds the accepted synchronous-read stall risk, browser automation, remote access, interactive mutation, and other explicitly deferred work. It also withholds style and pre-existing changes outside the implementation scope.

## Findings

### Finding 1 — A failed or superseded run request could display another run

- **Where:** `src/dashboard/app.js`, snapshot state, rendering, routing, and refresh paths.
- **Severity:** Medium because an operator could copy a command for run 1 while the URL identified run 2.
- **Why it matters:** One snapshot slot retained the prior successful envelope across a run-identity change, and an older response could arrive after a newer selection. This violated Task 4's stable-route and stale-state contract.
- **Reproduced:** A successful run-1 envelope followed by a run-2 `run_missing` envelope retained and rendered run 1 under the run-2 route.
- **Disposition:** Resolved. Snapshot state now records `requestedRunId`, rejects mismatched envelopes, clears across run identities, ignores superseded responses, and renders named unknown or refused routes without the prior run.

### Finding 2 — Windows-equivalent paths produced duplicate entries and unstable identifiers

- **Where:** `src/dashboard-config.ts` path identity and `src/dashboard-server.ts` repository ID construction.
- **Severity:** Medium because one repository could appear twice and a case-only relaunch could invalidate a deep link.
- **Why it matters:** `path.normalize()` retained a non-root trailing separator, while the server hashed a case-preserving value that differed from duplicate detection. This violated Tasks 2 and 3.
- **Reproduced:** Paths differing only by a trailing separator bypassed duplicate rejection, and paths differing only by case generated different hashes on Windows.
- **Disposition:** Resolved. One canonical identity removes non-root trailing separators, case-folds on Windows, drives duplicate detection, and supplies the repository-ID hash. Tests cover separator, casing, reordering, and relaunch-equivalent inputs.

### Finding 3 — Shutdown documentation overstated Windows `SIGTERM` behavior

- **Where:** `README.md` dashboard shutdown guidance and `test/dashboard-server.test.ts` process-lifecycle coverage.
- **Severity:** Medium because a Windows operator could expect cleanup and exit 0 from a termination API that ends the process without delivering the signal handler.
- **Why it matters:** The implementation registered the handler, but Windows process termination does not guarantee delivery to Node. The original plan and README described that platform behavior as graceful.
- **Reproduced:** A Windows child terminated through `child.kill("SIGTERM")` exited by signal without running its Node handler.
- **Disposition:** Resolved as a documented platform deviation. The README now promises graceful closure only for signals delivered to Node, names the Windows termination limitation, and retains direct lifecycle coverage for close-once and listener cleanup.

### Finding 4 — A hand-written declaration disconnected UI tests from runtime JavaScript

- **Where:** The removed dashboard declaration, `tsconfig.json`, and `tsconfig.dashboard.json`.
- **Severity:** Medium because the tests could type-check against declarations that disagreed with the browser module.
- **Why it matters:** The primary program resolved `app.js` to the separate declaration while the dashboard program checked only the JavaScript, so no compiler compared the two contracts.
- **Reproduced:** TypeScript resolution selected `app.d.ts` for the UI test and inferred the JavaScript independently.
- **Disposition:** Resolved. The declaration is removed, the primary program excludes the DOM-dependent UI test, and the dashboard program checks the runtime JavaScript and its TypeScript consumer together.

### Finding 5 — An inherited exclusion silently removed the UI test from the dashboard program

- **Where:** `tsconfig.dashboard.json`.
- **Severity:** Medium because the intended shared JavaScript and test contract remained unchecked after Finding 4's first correction.
- **Why it matters:** The child configuration inherited the primary program's exclusion even though its `include` named the UI test.
- **Reproduced:** `tsc --showConfig` and `tsc --listFilesOnly` omitted `test/dashboard-ui.test.ts`.
- **Disposition:** Resolved. The dashboard configuration overrides `exclude` with an empty list, and resolved-configuration checks contain both `src/dashboard/app.js` and `test/dashboard-ui.test.ts`.

### Finding 6 — The primary TypeScript program still admitted browser globals

- **Where:** `tsconfig.json`.
- **Severity:** Medium because server code could reference `document` or `window` without a type error despite the Node-only boundary.
- **Why it matters:** TypeScript's default libraries included DOM declarations when the primary configuration omitted an explicit `lib`.
- **Reproduced:** `tsc --listFilesOnly -p tsconfig.json` included `lib.dom.d.ts` and related DOM libraries.
- **Disposition:** Resolved. The primary program now declares `lib: ["esnext"]`; the dashboard child adds DOM libraries only for the browser module and UI test.

### Finding 7 — Superseded run-list responses could overwrite newer results

- **Where:** `src/dashboard/app.js` run-list refresh path.
- **Severity:** Medium because a slow earlier refresh could replace a newer result and appear current.
- **Why it matters:** Snapshot requests had generation and identity checks, but repository run-list requests did not. Rapid refresh clicks or a limit change could complete out of order.
- **Reproduced:** A newer limit-100 response completed before an older limit-20 response, after which the old response became the displayed non-stale value.
- **Disposition:** Resolved. Each repository now tracks its latest run-list request generation and requested limit, and both run-list and snapshot paths use the same current-request predicate. Focused tests cover superseded generations and resource identities.

## Reconciliation

All seven findings are accepted and resolved. The final independent pass reports no open high-confidence material defect. The Windows `SIGTERM` limitation remains an explicit implementation deviation because the operating system can terminate a process without delivering Node's registered handler.
