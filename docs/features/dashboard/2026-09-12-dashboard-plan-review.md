# Dashboard read-only increment implementation plan — review

**Reviewed document:** `plan.md`

**Document type:** Plan

**Review date:** 2026-09-12

**Status:** reconciled

**Hazards considered:** 4, because two of the critical findings come from executing the repository's own type-check and configuration rather than from reading the plan's claims; 12, because the plan's launch-input contract meets a Windows-specific encoding difference the repository's PowerShell-first operator guide creates; 2 and 18, because the plan already carries their obligations correctly and this review confirms rather than disputes that; 8, because the read path spawns `git` synchronously on every request and the plan treats that cost as free; 10 and 14 do not bear on this review, because the plan preserves recorded model strings and independence labels without restating them.

---

## Summary

The plan is well grounded in the repository: every symbol it names exists, `listRuns` genuinely returns `hasMore`, the read-only `Store` path genuinely refuses with the codes the plan quotes, and the architecture authorization it cites genuinely says what the plan claims. The defects concentrate in one place the plan asserts instead of testing — the TypeScript configuration — and in the transport contract between the server and the browser, which the plan leaves undefined at exactly the points where two acceptance criteria depend on it.

## Verdict

**Ready for planning after required changes.** The task decomposition, scope discipline, and acceptance mapping hold up; an implementer can execute Tasks 1 through 3 and 5 through 8 largely as written. Task 4 cannot execute as written, because its stated verification command fails on the repository as it exists today. Fix the three critical issues before starting.

## Critical issues — must fix before implementation

**Issue: enabling `allowJs` and `checkJs` breaks `npm run typecheck` immediately**

- **Why it matters:** Task 4, Step 1 instructs the implementer to enable `allowJs` and `checkJs` in `tsconfig.json`, whose `include` is `["src", "test"]`. Turning on `allowJs` pulls `test/fixtures/harness/*.mjs` into the program for the first time. Those five fixture files carry untyped parameters and fail immediately under `strict`.
- **Where:** Task 4, Step 1, and its `npm run typecheck` verification.
- **Production impact:** The repository's only type gate fails on the first commit of Task 4 with 19 errors in files the dashboard does not touch. An implementer who trusts the plan's "Expected" line concludes the failure is their own dashboard code and either weakens `strict` or annotates unrelated harness fixtures — both of which damage checks that currently protect the governed stages.
- **Evidence:** A scratch configuration identical to `tsconfig.json` plus `allowJs`, `checkJs`, and a DOM library produces `TS7006` in `emit-cli-run.mjs`, `emit-code-review.mjs`, `emit-implementation-stage.mjs`, `emit-plan-stage.mjs`, and `emit-spec-stage.mjs`. Removing `allowJs` and `checkJs` from that same configuration exits 0.
- **Recommended fix:** Scope JavaScript checking to the dashboard rather than the whole program. State the exact mechanism in the plan — a second configuration file checking only the dashboard directory, plus a second script that `npm run typecheck` chains — and state that the existing `tsconfig.json` program keeps `allowJs` off so the harness fixtures stay outside it. Replace Task 4's single-command expectation with the two commands that actually run.

**Issue: the browser module has no DOM type library**

- **Why it matters:** `tsconfig.json` sets `"target": "esnext"` with no `lib` and `"types": ["node"]`, so the program's global scope contains no `document`, `window`, `sessionStorage`, `location`, `HTMLElement`, or `navigator.clipboard`. Task 4, Step 1 requires the browser module to pass `checkJs` while Task 4, Step 2 requires it to read a URL fragment, write session storage, and build elements, and Task 5, Step 3 requires it to use the clipboard. Every one of those references fails to resolve.
- **Where:** Task 4, Step 1; the `Verification` header field, which claims "strict type checking with browser JavaScript included".
- **Production impact:** The implementer discovers the gap only after writing the browser module, and the obvious repair — adding `dom` to the shared `lib` — silently grants DOM globals to every server-side file in `src/`, removing the compiler's ability to reject a `document` reference inside the HTTP server or a stage.
- **Evidence:** Adding `"lib": ["esnext", "dom", "dom.iterable"]` to a scratch copy of `tsconfig.json` type-checks `src` and `test` cleanly, so no conflict exists between the DOM library and `@types/node` at this version. The library choice is available; the plan simply never makes it.
- **Recommended fix:** Name the DOM library explicitly and confine it to the dashboard-only configuration created for the previous finding, so server code keeps a Node-only global scope. Record in the plan that the two programs deliberately differ in `lib` and why.

**Issue: the HTTP status contract for refusal envelopes is undefined**

- **Why it matters:** Task 3, Step 3 says the data routes "return its unmodified `runs` or `status` envelope" without stating the HTTP status that carries a refused envelope. Task 3, Step 2 separately assigns 401 to unauthenticated calls, and Task 4, Step 2 requires the client to "fail closed with a visible session-expired state when the token is absent or rejected", while Task 4, Step 3 requires a failed refresh to preserve the prior snapshot as stale.
- **Where:** Task 3, Step 3; Task 4, Steps 2 and 3.
- **Production impact:** The client has two mutually exclusive obligations keyed on the same observable. If a `state_unavailable` repository returns a non-200 status, the client treats a routine per-repository refusal as an expired session and drops the whole view, violating AC 9. If an expired token returns 200 with an envelope-shaped body, the client renders it as a stale data refusal and never tells the operator to relaunch, violating the fail-closed requirement.
- **Recommended fix:** Fix the contract in the plan: data routes return HTTP 200 for every result the shared read service produces, including refusals, because the envelope's `errorCode` already carries the outcome; reserve non-200 statuses for transport-layer conditions the envelope cannot express — 401 for token failure, 404 for an unknown repository identifier or malformed run identifier, 405 for a mutation verb. Add an explicit test in Task 3 that a `state_missing` repository returns 200 with `errorCode` set, and a test in Task 4 that only a 401 triggers the session-expired state.

## High-risk areas

**Risk: the `repository` field drifts between the CLI and the shared service on `target_unavailable`**

- **Why:** In `src/cli.ts`, `resolveRepositoryRoot` runs before the command branch, so when it throws `TargetUnavailableError` the local `rootDir` is still null and the catch block emits an envelope with `repository: null`. Task 1, Step 2 moves resolution inside the shared service, where the submitted path is in scope and the natural implementation emits it. Task 1, Step 1 pins "canonical repository" in the regression tests without saying which value a refusal carries.
- **Impact if ignored:** The extraction changes an existing CLI output field on the one path the plan claims is byte-compatible. `test/cli-operator.test.ts` either catches it as a confusing late failure or, worse, the implementer updates the assertion to match the new behavior and ships a silent contract change to the command the dashboard is supposed to leave alone.
- **Mitigation:** State in Task 1, Step 2 that a `target_unavailable` result carries `repository: null` and that the submitted path travels to the dashboard through the inventory route rather than the envelope. Add the explicit assertion to Task 1, Step 1.

**Risk: synchronous reads make one slow repository stall every other repository**

- **Why:** `resolveRepositoryRoot` calls `spawnSync("git", ...)` three times per resolution, and `Store`, `listRuns`, and `readRunSnapshot` are entirely synchronous, including `statSync` over every evidence reference. Node's HTTP server runs one thread. Task 4, Step 3 has the client "request each run list independently", so a portfolio refresh issues concurrent requests that the server serializes.
- **Impact if ignored:** AC 9 is proven only for error isolation. A repository on a disconnected network share, behind a credential-prompting `git`, or holding a hot journal blocks the event loop and freezes the whole dashboard, including the repositories that are healthy. The plan's tests use local temporary directories and never observe this.
- **Mitigation:** Bound the exposure in the plan. State that each data route handles exactly one repository so a stall cannot span repositories in a single request, add a stated per-request time budget after which the route returns a named `target_unavailable`-class refusal for that repository alone, and record in Task 6, Step 3 that serialization is a known first-release limitation rather than an unmeasured performance claim.

**Risk: the dashboard command cannot reject `--repo`, and its help advertises it**

- **Why:** `parseArguments` strips `--repo` in a pre-pass that runs before command selection, and `CommandDefinition` carries no field expressing "this command takes no global options". `formatHelp` appends a hardcoded global block naming `--repo` to every command's help. Task 2, Step 2 says only to "mark it as not accepting global `--repo` or `--json`".
- **Impact if ignored:** The implementer invents a mechanism mid-task. The likely shortcut — a special case on the command name inside `parseArguments` — spreads dashboard knowledge into the parser that every other command shares, and the help text keeps offering an option the command rejects, which is precisely the kind of contract drift the repository tracks.
- **Mitigation:** Name the mechanism in the plan: add one optional field to `CommandDefinition`, have `parseArguments` raise a `UsageError` when the selected command declares no global target and `--repo` is present, and have `formatHelp` omit the global target line for such a command while keeping `--help`. Add the help-text assertion to Task 2's test list.

## Medium and low concerns

- Runs beyond the newest 20 are unreachable. Task 3, Step 3 exposes no limit parameter and Task 5, Step 1 renders a `hasMore` indicator with nothing behind it, while `listRuns` accepts 1 through 100 and the CLI exposes `--limit`. Either pass a validated limit through the route or state in the plan that `hasMore` is informational in the first release and say what the operator does instead.
- Byte-order-mark handling on the repositories file is unspecified. `JSON.parse` rejects a leading BOM, and the repository's operator guidance is PowerShell-first, where several `Set-Content` paths emit one. Task 2, Step 1 mentions rejecting a "BOM-only" file but never says whether a BOM preceding valid JSON is stripped or refused. Decide, and make the refusal message name the encoding rather than reporting a generic parse failure.
- The shutdown contract stops short of the exit code. Task 2, Step 3 registers `SIGINT` and `SIGTERM` handlers and closes the server, but never states the process exit code for a clean operator shutdown or for a close failure.
- Static routes are unauthenticated, and the plan never says so out loud. The token lives in the URL fragment, so the browser cannot present it when fetching `/`. Task 3, Step 2 assigns 401 only to "unauthenticated data calls", which leaves the static allowlist's open status implicit rather than a recorded, accepted decision resting on the loopback bind and the `Host` check.
- The plan narrows a design option without recording it. Design section 17.2 permits "explicit refresh or bounded polling"; the plan's `Assumptions` field chooses manual refresh and Task 4, Step 3 asserts no background polling. The narrowing is sound — state it as a first-release decision so a later reader does not read the test as contradicting the design.
- Task 1's steps name `readRunSnapshot` without naming `.snapshot`. The function returns a `RunObservation` wrapper, and `src/cli.ts` reads the member explicitly. Say so, because the shared service must produce the same `result` payload the CLI does today.
- Task 7 modifies a README "command inventory" that does not exist under that name. The README's operator sections are `Local operator guide`, `Inspect without spending`, and `Output contracts and refusal handling`. Name the real sections.
- Task 8, Step 2 proves a writer-store mutation without naming the observation. The other three mutation proofs map to stated assertions; this one needs the plan to say what the failing test observes — migration application against a `state_missing` repository, or a `.governance/state.db` byte comparison across a dashboard read.

## Missing and underspecified areas

- **Second-tab and reload behavior.** Task 4, Step 2 stores the token in session storage and removes it from the visible URL. Session storage is per-tab, so opening a second tab on the now-token-free URL fails closed, and the operator must return to the terminal for the original bootstrap URL. State this and say what the session-expired panel tells the operator to do.
- **Inventory observation time.** Task 3, Step 3 gives `/api/repositories` "its observation time" while Task 5, Step 1 renders a per-repository "observed time". Specify whether the inventory carries one server-side timestamp or a timestamp per repository, because AC 13 requires every aggregate to identify its included and excluded rows.
- **Token lifetime.** The plan generates one 32-byte token per process and never states whether it expires, rotates, or survives for the life of the listener. Say that it lives exactly as long as the process and that no rotation exists in the first release.
- **Response size ceiling.** Task 6, Step 3 requires rendering all arrays without truncation and Task 8 exercises "a run containing a large findings array", but no route states a maximum response size or what happens when a snapshot exceeds it. State that no ceiling exists and that the snapshot is returned whole, so an implementer does not invent pagination inside the envelope.
- **Repository identifier stability across launches.** Task 3, Step 3 derives an opaque identifier from the normalized absolute path, and Task 4, Step 3 puts that identifier in a deep link. Say whether a link survives a relaunch with a reordered or trimmed repositories file, because the answer determines whether the identifier is a hash of the path or an index.

## Suggested improvements

- Move the `git` resolution cost out of the per-request path. Resolving each configured repository once at dashboard startup, and reusing the canonical root while continuing to open the store per request, preserves exact-current reads and removes three synchronous subprocess spawns from every refresh.
- Assert the absence of the dashboard's unauthorized capabilities the same way the plan asserts its guards. A test that scans the served assets for `WebSocket`, `setInterval` polling, and any non-`GET` fetch turns AC 12 and the architecture boundary into something a later change cannot quietly cross.
- Record in Task 8 that the manual browser session is observation, not a passed criterion, matching the discipline Task 6, Step 3 already applies to the performance budgets.

---

## Reconciliation

**Date:** 2026-09-12

**Disposition:** 20 accepted, 1 rejected, 1 deferred, 0 open

**Status:** reconciled

### Verdicts

- **Accepted — enabling `allowJs` and `checkJs` breaks `npm run typecheck` immediately:** Task 4 now creates a dashboard-only strict JavaScript configuration that explicitly overrides the inherited include and composes it with the unchanged Node-only TypeScript program.
- **Accepted — the browser module has no DOM type library:** The dashboard-only configuration now names `esnext`, `dom`, and `dom.iterable` without granting DOM globals to the primary server check.
- **Accepted — the HTTP status contract for refusal envelopes is undefined:** Task 3 now returns every shared-service envelope over HTTP 200 and reserves explicit non-200 statuses for transport failures; Task 4 treats only 401 as session expiry.
- **Accepted — the `repository` field drifts between the CLI and the shared service on `target_unavailable`:** Task 1 now pins `repository: null` for unresolved targets and keeps submitted paths in dashboard inventory.
- **Deferred — synchronous reads make one slow repository stall every other repository:** The operator selected the smallest-blast-radius first release, so the plan now discloses serialized synchronous reads and defers worker or child-process isolation until a measured stall or later remote or multi-user authorization.
- **Accepted — the dashboard command cannot reject `--repo`, and its help advertises it:** Task 2 now specifies a command-definition capability consumed by both parsing and help formatting.
- **Accepted — runs beyond the newest 20 are unreachable:** The operator selected a validated 1-100 route and client limit.
- **Accepted — byte-order-mark handling on the repositories file is unspecified:** Task 2 now strips one leading UTF-8 BOM and rejects empty or otherwise malformed content explicitly.
- **Accepted — the shutdown contract stops short of the exit code:** Task 2 now assigns exit 0 to clean signal shutdown and exit 1 to startup or close failure.
- **Accepted — static routes are unauthenticated, and the plan never says so out loud:** Task 3 now records unauthenticated static bootstrap as an intentional consequence of fragment-token delivery and names the remaining boundary.
- **Accepted — the plan narrows a design option without recording it:** Manual refresh without polling is now a settled first-release assumption and an asserted client behavior.
- **Accepted — Task 1's steps name `readRunSnapshot` without naming `.snapshot`:** The shared service step now names the exact member returned in the existing envelope.
- **Accepted — Task 7 modifies a README command inventory that does not exist under that name:** Task 7 now names the three existing README sections.
- **Accepted — Task 8 proves a writer-store mutation without naming the observation:** The mutation now creates state in a missing-state repository and fails the pre/post filesystem inventory assertion.
- **Accepted — second-tab and reload behavior:** Task 4 now distinguishes same-tab reload from a token-free duplicate tab and supplies explicit recovery text.
- **Accepted — inventory observation time:** Task 3 assigns one top-level inventory time, while Task 5 uses only each read envelope's observation time for repository data.
- **Accepted — token lifetime:** Task 3 now binds one non-rotating token to the server process lifetime.
- **Accepted — response size ceiling:** Task 3 now returns complete snapshots without truncation, pagination inside the envelope, or a first-release size ceiling.
- **Accepted — repository identifier stability across launches:** Task 3 now derives IDs from the full base64url SHA-256 digest of each normalized absolute path, independent of launch order.
- **Rejected — move Git resolution to dashboard startup:** Startup-only resolution weakens refresh-time target validation and removes only Git subprocess cost, while synchronous SQLite and evidence checks can still stall; the plan retains per-request exact-current resolution.
- **Accepted — assert the absence of unauthorized capabilities:** Task 8 now scans served assets for WebSocket, interval polling, and non-GET fetch use.
- **Accepted — record the manual browser session as observation:** Task 8 now prevents the manual session record from becoming an unsupported standalone pass claim.
