# Dashboard Read-Only Increment Implementation Plan

**Status:** Implemented

**Goal:** Deliver a CLI-launched, loopback-only dashboard that reads current `RunSnapshot` data from multiple explicitly selected local repositories without creating state or executing governed commands.

**Source:** `docs/features/dashboard/design.md`, its reconciled review in `docs/features/dashboard/2026-09-12-dashboard-design-review.md`, and the dated dashboard authorization in `ARCHITECTURE.md` section 23.

**Hazards considered:** 2 requires preserving named missing and unavailable evidence instead of hiding it; 4 requires tests to derive expectations from real store and projection contracts rather than hand-written dashboard fixtures; 10 requires displaying frozen requested and effective model values without normalizing aliases; 12 requires repository-specific configuration and limitations to remain visible; 14 requires preserving recorded independence labels without strengthening them; and 18 requires presenting verification and review evidence without claiming product correctness.

**Assumptions:** Node 24 remains the runtime; the first release targets a current local browser; repository roots arrive in one explicit UTF-8 JSON file shaped as `{ "repositories": ["C:\\absolute\\repo"] }`; the CLI prints a bootstrap URL but does not open a browser; manual refresh is the settled first-release choice rather than bounded polling; one token lives for the dashboard process lifetime without rotation; responses return each current snapshot whole without a size ceiling; repository reads remain synchronous and serialized in the first release; and browser-level visual behavior receives a manual check because this repository has no browser automation or frontend build system.

**Approach:** Reuse the existing synchronous `runs` and `status` read paths through a small shared read service, then host static HTML, CSS, and separately checked JavaScript from a Node HTTP server bound to `127.0.0.1` on an ephemeral port. Protect every data route with a random per-process bearer token delivered in the URL fragment, preserve each repository's result or refusal independently, keep snapshot state only in the browser session, and expose CLI commands as copyable text only.

**Affected areas:** CLI parsing and lifecycle, read-only operator envelopes, local repository selection, loopback HTTP security, browser assets and state rendering, operator tests, TypeScript/JavaScript checking, and README operator guidance. No migration, persisted schema, run-state mutation, executor, provider, stage, approval, or policy behavior changes.

**Known blockers:** None for the authorized read-only increment. Interactive mutation, remote access, WebSockets, test/task telemetry, forecasts, alerts, and a second harness remain explicitly unauthorized. The existing global `--repo` parser accepts one repository only, so the dashboard needs a separate required `--repositories-file` input rather than changing every command's `--repo` contract. Existing Git, SQLite, and evidence reads are synchronous, so a slow local or network-backed repository can delay every request on the single Node event loop; worker or child-process isolation is deferred until measured stalls or a later remote or multi-user authorization justify that larger execution boundary. Existing tests have no browser runner, so pure client-state behavior must remain importable under Node and the final visual/accessibility check remains manual.

**Blast radius:** `parseArguments` and `formatHelp` in `src/cli-args.ts` are called by `src/cli.ts` and asserted directly and indirectly in `test/cli-operator.test.ts`. The `runs` and `status` branches in `src/cli.ts` currently call `listRuns` and `readRunSnapshot`; `src/run-command.ts` also calls `readRunSnapshot` internally and must remain unchanged. `OperatorResult`, `operatorEnvelope`, and formatting in `src/operator-output.ts` are consumed by `src/cli.ts`, `test/operator-state.test.ts`, and `test/cli-operator.test.ts`; their public shapes must not change. `Store` read-only behavior is established in `src/store.ts` and `test/store.test.ts`. No HTML, CSS, browser JavaScript, HTTP server, or third-party frontend dependency currently exists.

**Verification:** Use Node's existing test runner against focused dashboard, CLI-operator, operator-state, and store tests; run the existing Node-only TypeScript program and a separate strict DOM-enabled dashboard JavaScript program through `npm run typecheck`; run `npm run check:docs`; perform the repository-required guard mutations for loopback binding, API authorization, method refusal, and read-only store use; then manually open the printed local URL against disposable repositories and exercise keyboard, theme, stale-state, and responsive behavior.

---

## Scope and acceptance coverage

The implementation covers only the 14 first-release acceptance criteria in `design.md` section 20.

| Design criterion | Plan coverage |
|---|---|
| AC 1, exact-current read-only repositories | Tasks 1, 2, 3, and 7 |
| AC 2, run identity, state, action, and reasons | Tasks 1, 4, and 5 |
| AC 3, stale snapshot after refresh failure | Tasks 4 and 7 |
| AC 4, authoritative state vocabulary | Tasks 1 and 5 |
| AC 5, token and cost coverage | Tasks 1 and 5 |
| AC 6, preserve projected distinctions | Tasks 1 and 5 |
| AC 7, repository-bound evidence availability | Tasks 3 and 5 |
| AC 8, no sensitive raw content or file browser | Tasks 3, 5, and 7 |
| AC 9, isolate repository failures | Tasks 2, 3, 4, and 7 |
| AC 10, configured system name | Task 5 |
| AC 11, display-only CLI handoffs | Tasks 3, 5, and 7 |
| AC 12, absent unsupported capabilities | Tasks 4, 5, and 6 |
| AC 13, aggregate provenance and exclusions | Tasks 4 and 5 |
| AC 14, keyboard behavior | Tasks 4 and 6 |

## Tasks

### Task 1: Share the existing read contract without changing CLI output

**Depends on:** None

**Files:**
- Create: `src/operator-read.ts`
- Modify: `src/cli.ts` — `runs` and `status` read branches
- Modify: `test/cli-operator.test.ts` — existing `runs` and `status` contract cases
- Validate: `test/operator-state.test.ts`

**Steps:**

- **Step 1: Add regression coverage around the current read envelope**
  - Change: Extend the disposable-repository tests to assert that successful and refused `runs` and `status` calls retain the exact `OperatorResult` keys, outcome, error code, reason, canonical repository, run ID, observation time, and complete result. Pin the current `target_unavailable` behavior explicitly: its envelope carries `repository: null` because canonical resolution did not complete. Derive successful result values from real `Store` rows and `readRunSnapshot`, not a hand-authored dashboard fixture.
  - Verify: `node --test test/cli-operator.test.ts test/operator-state.test.ts`
  - Expected: Existing CLI output remains green before extraction and the tests pin the behavior both consumers need.

- **Step 2: Extract the shared read service**
  - Change: Add `readRunsResult(target, invocationDirectory, limit)` and `readStatusResult(target, invocationDirectory, runId)` in `src/operator-read.ts`. Each function resolves the repository with `resolveRepositoryRoot`, opens `Store` with `{ readOnly: true }`, calls `listRuns` or returns `readRunSnapshot(...).snapshot`, closes the store in `finally`, and returns the existing `OperatorResult`. Catch only `TargetUnavailableError`, `StoreStateError`, and `RunMissingError` to preserve their established codes and outcomes; rethrow programmer errors. Preserve `repository: null` for `target_unavailable`; the dashboard inventory retains the submitted path independently.
  - Verify: `node --test test/cli-operator.test.ts test/operator-state.test.ts test/store.test.ts`
  - Expected: The service returns the same success and refusal envelopes as the current CLI and performs no migration, lock acquisition, recovery, or write.

- **Step 3: Route the CLI through the shared service**
  - Change: Replace only the `runs` and `status` branches in `src/cli.ts` with the shared functions. For a refused result, write its reason to stderr, write the formatted envelope to stdout, and set `process.exitCode` through `operatorExit`, matching the existing catch path. Preserve text formatting, `--json`, exit codes, stdout/stderr separation, and the existing `run-command.ts` use of `readRunSnapshot`.
  - Verify: `node --test test/cli-operator.test.ts test/operator-state.test.ts`
  - Expected: Existing operator tests observe no contract change, and `run` execution retains its current internal snapshot path.

**Task completion evidence:** Existing `runs` and `status` success and error envelopes remain byte-compatible apart from their expected dynamic `observedAt` value, and read-only store tests remain green.

### Task 2: Define dashboard launch input and CLI lifecycle

**Depends on:** Task 1

**Files:**
- Create: `src/dashboard-config.ts`
- Modify: `src/cli-args.ts` — `COMMANDS`, parsing, and dashboard help
- Modify: `src/cli.ts` — dashboard dispatch and shutdown
- Modify: `test/cli-operator.test.ts` — command discovery, help, malformed input, and startup refusal
- Create: `test/dashboard-server.test.ts`

**Steps:**

- **Step 1: Add one exact repository-list schema**
  - Change: Parse a required `--repositories-file <path>` as UTF-8 JSON with exactly one `repositories` member containing a non-empty array of unique absolute non-empty strings. Strip exactly one leading UTF-8 BOM before parsing, then reject a BOM-only or empty file, malformed JSON, unknown members, non-array values, relative paths, duplicate normalized paths, and an empty list with a `UsageError` that names the file or member. Reject any BOM elsewhere as malformed JSON. Resolve the file itself from the original invocation directory. Retain submitted repository paths in memory so later target failures remain visible per repository.
  - Verify: `node --test test/dashboard-server.test.ts test/cli-operator.test.ts`
  - Expected: Every accepted launch has one deterministic input shape and no dashboard-created configuration file.

- **Step 2: Register the dashboard command without weakening global parsing**
  - Change: Add `dashboard --repositories-file <path>` to `COMMANDS` and add a command-definition field that declares whether the global repository target is accepted. After command selection, make `parseArguments` raise `UsageError` when `--repo` was supplied to a command that declares no global target; keep the pre-pass and every other command's single optional global `--repo` behavior and duplicate-option errors unchanged. Make `formatHelp` omit the `--repo` global line for `dashboard` while retaining `--help`. Do not define `--json` for `dashboard`. Help must return before reading the repository list or resolving any target.
  - Verify: `node --test test/cli-operator.test.ts`
  - Expected: General and command help list `dashboard`; malformed dashboard options exit 2 without creating state, while all existing command forms retain their outcomes.

- **Step 3: Add bounded process lifecycle**
  - Change: In `src/cli.ts`, handle `dashboard` before ordinary target resolution and writer-lock acquisition. Load the repository list, start the dashboard server, print exactly one bootstrap URL, and await shutdown. Register `SIGINT` and `SIGTERM` handlers that close the HTTP server once and remove their listeners. A successful signal-driven close exits 0; a startup or close failure reports the error and exits 1, and startup failure never prints a successful URL.
  - Verify: `node --test test/dashboard-server.test.ts test/cli-operator.test.ts`
  - Expected: Dashboard startup opens no repository store and acquires no repository lock until an API read; shutdown releases the listener and permits the same port resource to close cleanly.

**Task completion evidence:** CLI parsing and lifecycle tests cover valid help, every malformed repository-file shape, forbidden dashboard options, startup failure, and clean server closure.

### Task 3: Serve a token-protected loopback API and static allowlist

**Depends on:** Tasks 1 and 2

**Files:**
- Create: `src/dashboard-server.ts`
- Create: `src/dashboard/index.html`
- Create: `src/dashboard/app.js`
- Create: `src/dashboard/styles.css`
- Modify: `test/dashboard-server.test.ts`

**Steps:**

- **Step 1: Establish the fixed network boundary**
  - Change: Start Node's HTTP server on host `127.0.0.1` and port `0`, with no host or port override. Generate a 32-byte random token when the server starts; it remains valid without rotation only until that server closes. Print a bootstrap URL whose fragment carries the token so HTTP requests and referrer headers do not transmit it automatically. Validate the request `Host` against the actual loopback address and selected port, reject a nonmatching `Origin` when present, emit no CORS permission, and set `Cache-Control: no-store`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and frame denial on every response.
  - Verify: `node --test test/dashboard-server.test.ts`
  - Expected: Tests reach the bound loopback address and reject altered host, origin, absent token, and wrong token requests without opening repository state.

- **Step 2: Allowlist static and data routes**
  - Change: Serve only `/`, `/app.js`, and `/styles.css` from paths anchored to `import.meta.url`. Static routes are intentionally unauthenticated because the bootstrap document must load before browser JavaScript can recover the fragment token; loopback binding, exact `Host` validation, the static allowlist, and data-route bearer authorization remain the boundary. Permit only `GET`; return JSON 405, 404, or 401 responses for other methods, unknown routes, traversal attempts, and unauthenticated data calls. Never map a URL path to an arbitrary filesystem path and never serve evidence file contents.
  - Verify: `node --test test/dashboard-server.test.ts`
  - Expected: Static assets carry fixed content types and security headers; traversal, mutation verbs, and unlisted files remain inaccessible.

- **Step 3: Expose repository-scoped read routes**
  - Change: Assign each submitted root the full base64url SHA-256 digest of its normalized absolute path, making the opaque ID stable across process launches and repository-list reordering. Add authenticated `GET /api/repositories`, `GET /api/repositories/<id>/runs?limit=<n>`, and `GET /api/repositories/<id>/runs/<run-id>`. The inventory response contains one top-level server observation time, the absolute current CLI path, and submitted path/opaque-ID entries; it carries no repository observation time or run state. Validate `limit` as a safe integer from 1 through 100 with default 20 and return JSON 400 for an invalid value. The last two routes perform exactly one synchronous repository read per request and return the Task 1 service's complete, unmodified `runs` or `status` envelope without response-size truncation or pagination inside the envelope. Return HTTP 200 for every success or refusal envelope, including `state_missing`, `schema_unsupported`, `state_unavailable`, `target_unavailable`, and `run_missing`; reserve non-200 responses for transport conditions: 400 for an invalid limit, 401 for bearer failure, 404 for an unknown repository ID, malformed run ID, or unknown route, and 405 for a non-`GET` method. Do not cache snapshots server-side.
  - Verify: `node --test test/dashboard-server.test.ts test/operator-state.test.ts test/store.test.ts`
  - Expected: A valid repository returns the same result as the CLI read contract; a `state_missing` repository returns HTTP 200 with its named `errorCode`; transport failures retain their distinct statuses; and missing state, unsupported schema, unavailable SQLite, missing run, and invalid repository remain isolated without suppressing others.

**Task completion evidence:** HTTP integration tests prove loopback binding, bearer enforcement, host/origin checks, static allowlisting, method refusal, exact envelope reuse, repository failure isolation, and store closure.

### Task 4: Implement client bootstrap, routing, refresh, and stale-state behavior

**Depends on:** Task 3

**Files:**
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/app.js`
- Modify: `src/dashboard/styles.css`
- Create: `test/dashboard-ui.test.ts`
- Create: `tsconfig.dashboard.json`
- Modify: `package.json` — compose server and dashboard type checks

**Steps:**

- **Step 1: Make browser logic type-checked and testable**
  - Change: Keep the existing `tsconfig.json` program Node-only with `allowJs` disabled so it does not absorb `test/fixtures/harness/*.mjs`. Add root-level `tsconfig.dashboard.json` extending `tsconfig.json`, explicitly override `include` with `["src/dashboard/app.js"]` so the base program's `["src", "test"]` include is not inherited, and set `allowJs: true`, `checkJs: true`, and `lib: ["esnext", "dom", "dom.iterable"]`; inherit the repository's strict, no-emit, module, resolution, and Node type settings. Add `typecheck:dashboard` as `tsc --noEmit -p tsconfig.dashboard.json` and change `typecheck` to run the existing `tsc --noEmit` program followed by `npm run typecheck:dashboard`. The separate programs intentionally keep DOM globals out of the server's primary type check. Load `app.js` from `index.html` as an external `type="module"` script compatible with the CSP. Keep state transitions and formatters as exported pure functions, and guard DOM bootstrap so Node tests can import them without a browser. Use type-only JSDoc imports from `src/operator-output.ts` and `src/operator-state.ts` rather than duplicating authoritative status enums or creating a runtime browser import of TypeScript.
  - Verify: `tsc --noEmit`; `npm run typecheck:dashboard`; `npm run typecheck`
  - Expected: The primary Node-only TypeScript program, the strict DOM-enabled dashboard JavaScript program, and their composed script all pass without adding a bundler, changing or loading harness fixtures in the dashboard program, or granting DOM globals to the server check.

- **Step 2: Bootstrap the authenticated session safely**
  - Change: Read the token once from the bootstrap URL fragment, keep it in session storage for the tab, remove it from the visible URL, and attach it only as an `Authorization: Bearer` header on same-origin API requests. Treat only HTTP 401 as an expired dashboard session. When the token is absent or rejected, fail closed with a visible instruction to return to the terminal and reopen the original bootstrap URL; reloading the current tab can recover its session-storage token, but a duplicate or second tab opened from the token-free URL cannot. Never interpolate API data with `innerHTML`; construct elements and assign untrusted values through `textContent`.
  - Verify: `node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts`
  - Expected: Pure client tests prove token extraction/removal and text-safe rendering inputs; server tests prove an absent or stale token cannot read data.

- **Step 3: Add stable client routing and explicit refresh**
  - Change: Use a token-free URL fragment containing only repository ID and optional run ID. Load the repository inventory, request each run list independently with a selectable limit from 1 through 100, and preserve successful repositories when another returns a refusal envelope. Add an explicit Refresh control and no interval, polling, WebSocket, or push behavior. On a 200 refusal envelope or transport failure other than 401, retain the last successful value in memory, mark it stale with its prior envelope `observedAt`, and display the new error code and reason beside it; never merge partial new fields into the old snapshot. A 401 instead enters the session-expired state from Step 2.
  - Verify: `node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts`
  - Expected: Tests cover initial success, one-repository refusal over HTTP 200, a transport failure, successful replacement, stale preservation, 401-only session expiry, deep-link restoration across repository-list reordering, unknown repository/run routes, validated limit selection, and no background polling.

**Task completion evidence:** Imported client-state tests demonstrate deterministic routing and stale replacement behavior, and type checking covers the browser module.

### Task 5: Render the portfolio and complete current run projection

**Depends on:** Task 4

**Files:**
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/app.js`
- Modify: `src/dashboard/styles.css`
- Modify: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Render portfolio and run selection**
  - Change: Show every configured repository with its submitted path, canonical path when resolved, the latest run-list envelope's `observedAt`, state or refusal, selected 1-100 run limit, returned runs, and `hasMore` indicator. Do not present the inventory response's top-level observation time as a repository observation. Support current projected filters for repository, persisted run status, and derived phase. Use the configured system name after a snapshot is selected and a neutral "Governed Delivery Dashboard" label before then.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Rendering tests use envelopes produced from real temporary stores and preserve unavailable repositories, empty state, and the latest-run ordering.

- **Step 2: Render run overview without semantic collapse**
  - Change: Provide focused views for overview, ordered stages, cost and token coverage, findings, governance, delivery, and evidence. Render all workflow-action reasons, limitations, reported/unreported counts, immutable finding reports, optional decisions, recorded independence labels, evidence availability reasons, verification commands, commits, and delivered/missing paths. Never describe configured standalone review as independent or a passed verification/code review as proof of product correctness.
  - Verify: `node --test test/dashboard-ui.test.ts test/operator-state.test.ts`
  - Expected: Tests assert the distinctive limitation, independence, missing-telemetry, and evidence-availability text from real snapshots appears without fabricated zeroes or merged report fields.

- **Step 3: Render display-only command handoffs**
  - Change: Show `workflowAction` and `operatorActions` commands and arguments exactly as projected, together with eligibility and refusal reasons. Build the executable text from the server-provided CLI path plus the projected command and argv. Use single-quoted PowerShell escaping on Windows and single-quoted POSIX escaping elsewhere, label the selected shell form, and test spaces, quotes, metacharacters, and placeholder arguments. Provide a copy button that writes only that displayed command to the clipboard and reports clipboard failure. Add no form submission, HTTP mutation route, automatic command execution, consent control, signature input, or success state inferred from copying.
  - Verify: `node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts`
  - Expected: Tests prove command text remains projection-derived and every HTTP mutation attempt receives 405.

**Task completion evidence:** The UI renders every first-release source-of-truth row in `design.md` section 17.1 and omits every unsupported capability named by AC 12.

### Task 6: Apply the visual, keyboard, and accessibility contract

**Depends on:** Task 5

**Files:**
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/app.js`
- Modify: `src/dashboard/styles.css`
- Modify: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Implement the approved visual system**
  - Change: Use semantic HTML, CSS variables, CSS Grid/Flexbox, the approved light and dark color tokens, dense tables, status text plus color, and responsive layouts that preserve evidence and refusal text. Add no UI framework, CSS generator, icon package, gradient, animation, or separate duplicated theme stylesheet.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Static-asset assertions find the required landmarks, theme variables, focus styles, reduced-motion handling, and no prohibited dependency or visual pattern.

- **Step 2: Implement keyboard and accessibility behavior**
  - Change: Support ordinary tab order, labelled controls, table captions or accessible names, live regions for refresh errors, visible focus, and only the shortcuts whose destinations exist in the first release. Suppress shortcuts in text-entry and editable controls, expose a shortcut reference, and provide a session-scoped disable control. Theme and shortcut preferences remain in browser session state and never enter repository state.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Pure event-policy tests cover text-entry suppression, disabled shortcuts, route changes, and reduced-motion/theme state without requiring a browser-specific fixture.

- **Step 3: Keep provisional performance targets non-gating**
  - Change: Avoid synchronous client rendering of hidden future views and render only the selected run's full snapshot. Display all required arrays without truncation. Record that first-release server reads are synchronous and serialized, so one slow repository can delay other requests; do not claim isolation from stalls or the provisional budgets in design section 21.8 until representative repository latency, browser, device, data volume, cache state, percentile, and measurement window exist. Worker or child-process isolation remains deferred until a measured stall or later remote or multi-user authorization supplies the trigger.
  - Verify: Manual browser check with a run containing a large findings array, plus `node --test test/dashboard-ui.test.ts`.
  - Expected: The selected snapshot remains complete and usable; implementation evidence records observation only, not an unsupported performance pass.

**Task completion evidence:** Automated accessibility-state assertions pass and the manual check confirms keyboard reachability, focus visibility, light/dark rendering, narrow-window layout, and complete large-array access.

### Task 7: Document operation, boundaries, and recovery

**Depends on:** Tasks 2 through 6

**Files:**
- Modify: `README.md` — `Local operator guide`, `Inspect without spending`, and `Output contracts and refusal handling`
- Modify: `docs/features/dashboard/design.md` — only if implementation reveals a contract mismatch that requires an explicit design correction
- Validate: `docs/features/dashboard/2026-09-12-dashboard-design-review.md`

**Steps:**

- **Step 1: Document the exact launch contract**
  - Change: Add the `dashboard --repositories-file` command, the one accepted JSON shape, leading UTF-8 BOM handling, absolute-path requirement, bootstrap URL handling, process-lifetime token, second-tab limitation, manual browser open, loopback-only boundary, signal exit behavior, and examples for PowerShell. State that the list remains in memory and that each repository keeps its own state database.
  - Verify: `npm run check:docs`
  - Expected: Every documented command and path matches the implemented help and repository layout.

- **Step 2: Document read and failure semantics**
  - Change: Explain manual refresh, the 1-100 run-list limit, per-repository refusal isolation, synchronous-read stall limitation, stale-state labeling, exact-current schema refusal, hot-journal limitation, missing evidence, token coverage, whole untruncated snapshot responses, and the distinction between inventory observation, envelope observation, and recorded run activity.
  - Verify: `npm run check:docs`
  - Expected: Operators can distinguish stale, unavailable, unreported, and zero values without inspecting source.

- **Step 3: Document the non-authorized boundary**
  - Change: State that the dashboard serves no evidence contents, runs no CLI command, collects no approval or signature, opens no writer, exposes no remote listener, and includes no WebSocket, alert, forecast, test/task telemetry, second harness, or interactive mutation.
  - Verify: `npm run check:docs`
  - Expected: README behavior matches the dated architecture authorization and does not imply that future interaction is already available.

**Task completion evidence:** Help and README agree on invocation and shutdown, and the documentation checker reports clean with only pre-existing historical warnings.

### Task 8: Prove the end-to-end read-only boundary

**Depends on:** Tasks 1 through 7

**Files:**
- Modify: `test/dashboard-server.test.ts`
- Modify: `test/dashboard-ui.test.ts`
- Modify: `test/cli-operator.test.ts`
- Validate: `test/operator-state.test.ts`
- Validate: `test/store.test.ts`

**Steps:**

- **Step 1: Exercise two real disposable repositories**
  - Change: Build one temporary Git repository with migrated state and representative rows through `Store`, plus one repository with missing or unsupported state. Start the exported dashboard server on its fixed loopback host, call the portfolio and selected-run routes with the bootstrap token, and compare successful payloads with the shared read service. Snapshot filesystem inventory and database bytes before and after every dashboard read.
  - Verify: `node --test test/dashboard-server.test.ts test/dashboard-ui.test.ts test/cli-operator.test.ts test/operator-state.test.ts test/store.test.ts`
  - Expected: Valid data remains exact, the second repository's refusal stays isolated, database bytes and repository inventories remain unchanged, and every store and socket closes.

- **Step 2: Prove the new guards by mutation**
  - Change: One at a time in a disposable working copy, alter loopback binding, bypass bearer validation, accept a mutation HTTP method, and open a writer store from a data route. The writer mutation must make a `state_missing` repository create `.governance/state.db`, causing the pre/post filesystem inventory assertion to fail. Confirm the corresponding targeted test fails for each mutation, restore the exact original bytes, and rerun the targeted tests. Do not mutate the active working tree without a byte-for-byte restoration check.
  - Verify: `node --test test/dashboard-server.test.ts test/store.test.ts`
  - Expected: Each security or read-only mutation changes the expected outcome class, and the restored implementation passes.

- **Step 3: Complete repository and manual validation**
  - Change: Run the focused tests, full existing suite, strict Node and dashboard type checking, documentation checking, and a manual browser session against the two disposable repositories. Add a static-asset boundary assertion that rejects `WebSocket`, `setInterval`, and non-`GET` fetch use. Verify URL bootstrap, missing-token refusal, portfolio isolation, run drilldown, manual refresh, stale labeling, copy-only command handoff, keyboard rules, theme switch, responsive layout, and clean shutdown. Record the manual session as an observation against the acceptance sequence, not as a standalone proof that every criterion passes.
  - Verify: `node --test test/dashboard-server.test.ts test/dashboard-ui.test.ts test/cli-operator.test.ts test/operator-state.test.ts test/store.test.ts`; `npm test`; `npm run typecheck`; `npm run check:docs`
  - Expected: All automated checks pass, the manual acceptance sequence satisfies AC 1 through AC 14, and no `.governance` file, Git worktree file, lock, audit row, or process remains changed by dashboard observation.

**Task completion evidence:** Focused and full test results, four successful mutation proofs with exact restoration, documentation/type checks, and the manual browser acceptance record establish the bounded release without claiming future interaction.

## Deferred scope

- Interactive dashboard commands, consent, approval, signatures, or mutation
- Remote or multi-user access
- WebSockets or server-pushed state
- New telemetry tables, migrations, or dashboard persistence
- Test, task, forecast, alert, and invocation-detail views
- Cross-harness comparison or a second executor
- Browser automation, packaging, installation, or publication
- Report export
- Performance-budget enforcement before its measurement contract is approved

## Rollback

This increment changes no persisted schema or run record. Rollback removes the `dashboard` command, its shared read-service call sites, server, assets, tests, and README section, then restores the prior direct `runs` and `status` branches. Existing repositories and `.governance/state.db` files require no migration or repair.

## Implementation note

Implemented on 2026-09-12. The CLI now launches one token-protected loopback
dashboard over the shared exact-current `runs` and `status` read service. The
browser renders the complete multi-repository portfolio and selected
`RunSnapshot`, retains same-run stale data after a failed refresh, keeps
cross-run and superseded responses isolated, and exposes projection-derived
commands as copy-only text. The implementation adds no persisted schema,
writer path, remote listener, provider dispatch, or interactive mutation.

The type-checking layout differs from the planned single-file dashboard
program: the DOM-enabled program checks both the runtime JavaScript and its
TypeScript UI test together, while the primary program explicitly excludes
that test and excludes DOM libraries. This avoids a hand-maintained declaration
contract. Signal cleanup also follows the operating system's delivery
semantics: handled `SIGINT`, and `SIGTERM` where Node receives it, close once;
Windows process termination APIs can end the process without delivering
`SIGTERM`.

A current Chrome session exercised token removal, missing-token refusal,
portfolio isolation, selected-run drilldown, a 250-finding snapshot, dark
theme, keyboard routes, copy-only handoff, stale-state retention, and a
contained 480-pixel layout. The accepted synchronous server-read stall and all
other items under Deferred scope remain deferred. The reconciled code review is
`docs/features/dashboard/2026-09-12-code-review.md`.
