# Harness Adapter Implementation Plan

**Status:** Implemented

**Goal:** Build order step 2: one concrete harness adapter — spawn the
`claude-code` executor, enforce its invocation contract (stdin prompt, probe,
inactivity timeout with tree-kill, restricted environment passthrough), parse
its returned envelope and the agent's inner body against the documented
fallback shapes, retain raw bytes before any parsing, and persist the result as
an `agent_run` row. No adapter interface, no second executor, no agent
registry, no stage dispatch — those are later build-order steps.

**Source:** `ARCHITECTURE.md` sections 7 (repository contract — protected
paths), 8 (contracts — AgentResult, write modes), 9 (agents — executor field,
context only), 10 (model configuration — record requested/effective
separately), 11 (harness invocation — the executor definition and every rule
under it), 15 (state, storage, and evidence — the `agent_run` schema block,
raw-output retention), 16 (audit), 17 (security — env passthrough, no
credentials in prompts), 18 (parsing model output — the seven shapes), 19
(concurrency — single writer, busy retry), 20 (limits — invocation time, result
size), 21 (verification strategy — contract tests fed by recorded real
output), 23 (build order, step 2); `docs/hazards.md` entries 1, 2, 8, 9, 10,
14, 18 (numbering as in the document: 1/18 are the same defect class stated
twice); `CLAUDE.md` layout and commands conventions;
`docs/features/run-store/plan.md` as the precedent for structure, task
granularity, and the "prove the guard by breaking it" discipline.

**Hazards considered:** `docs/hazards.md` 1 (model output in shapes the schema refuses — the seven parse cases), 2 (discarded output is undiagnosable), 8 (Windows executable resolution), 9 (unverified hook interpreters), 10 (exact-match model acceptance against moving aliases), 14 (independence that cannot be proven — recorded, not claimed). Entries 3-7 and 11-13 concern prompts, delivery, and specification content, which arrive with the stages.

**Assumptions:**

- **The executor definition is a hardcoded TypeScript module, not a loaded
  config file.** `governed.yaml` (section 7) holds verification commands, and
  the executor definition is listed as a separately protected path in section
  7's protected-paths list, but no path or file format for it is specified
  anywhere in the architecture. Building a YAML loader for a single, fixed
  definition would be an abstraction with no second consumer yet (hard rule
  4) and would require either a YAML-parsing dependency (step 1 committed to
  zero runtime dependencies) or a hand-rolled parser neither requested nor
  needed. `src/executor.ts` exports the `claude-code` definition as a typed
  constant matching the section 11 YAML shape exactly. Loading it from a
  committed file is deferred to whichever step first needs a second executor
  or an operator-editable definition.
- **`agent_run` has no status or error column in the architecture's schema
  block** (section 15 lists exactly: `id, stage_id, agent, role, executor,
  requested_model, effective_model, fallback, tokens_in, tokens_out,
  cache_read, cache_write, cost, duration_ms, input_hash, output_hash,
  raw_output_ref, independence`). Invocation outcome (success, refusal,
  timeout) is therefore expressed to the caller through `invokeHarness`'s
  return value, never through a persisted status column. A row is inserted
  only for an invocation that actually produced a harness envelope to record
  (see Task 6). **A failed or timed-out invocation is not silently dropped:**
  it still gets its raw bytes retained (hazard 2) and a dedicated
  `agent.dispatch.failed` audit event naming the stage, agent, and cause
  (timeout or exit code) — so the attempt is diagnosable and its wall time
  is queryable from the audit chain, even though its token/cost figures (if
  any were spent before failure) have no `agent_run` row to attach to until
  a schema change adds one. Task 7 records this consequence in
  `ARCHITECTURE.md` section 15 explicitly, rather than leaving it an
  undocumented gap.
- **AgentResult validation (section 8) is out of scope.** `invokeHarness`
  extracts the inner JSON body per the section 18 fallback shapes and returns
  it as `unknown` (or a typed refusal naming the cause). Validating that body
  against the `AgentResult` contract belongs to the stage that dispatches a
  real agent and knows what shape it asked for — the spec stage, step 3. Step
  2 proves the extractor against all seven documented shapes; it does not
  invent an `AgentResult` schema to validate against.
- **`fallback` is nullable free text**, holding whatever the harness envelope
  reports about a model substitution, or `null` when the harness performed
  none. Only the `null` (no-fallback) path is confirmed by Task 3's recorded
  envelope — a trivial single-turn prompt against the default model has no
  reason to trigger a fallback. The populated shape (what the envelope
  reports when a fallback actually occurs) stays unverified until a real
  fallback event is captured; this is stated as an open gap, not assumed
  from the one fixture.
- **Absolute timeout ceiling is six times the idle budget**: the executor
  definition's `idleTimeoutSeconds: 600` gets a new
  `absoluteTimeoutSeconds: 3600` field (not present in the section 11 YAML,
  which shows idle timeout only). Section 11 requires "a separate absolute
  ceiling as a multiple of the idle budget" without naming the multiple; six
  is a concrete, documented choice, changeable in one place.
- **`envPassthrough` is the minimal set a Windows Node/npm-shimmed executable
  needs to run at all**: `PATH, HOME, USERPROFILE, APPDATA, LOCALAPPDATA,
  TEMP, TMP, SystemRoot`. Section 11's YAML shows the same list with a
  trailing `...`; the concrete list is a per-machine operational concern the
  architecture does not pin, and an operator needing more (a corporate proxy
  variable, for example) currently edits `src/executor.ts` directly, since no
  config loader exists yet (see the first assumption above).
- **The `claude` CLI resolves on this machine** at
  `C:\Users\Shawn-work\AppData\Roaming\npm\claude.cmd`, verified via
  `claude --version` -> `2.1.251 (Claude Code)`. It is an npm-shimmed `.cmd`
  file on Windows, which is exactly hazard 8's case.
- **`claude -p --output-format json`'s exact envelope field names are
  confirmed by one real recorded invocation, not assumed from documentation
  memory.** Task 3 spends a small amount of real API cost once, on a trivial
  prompt, to capture the actual bytes as a committed fixture. Every other test
  in this plan runs against that fixture or against deterministic fixture
  scripts (Task 1's `test/fixtures/harness/*.mjs`) and spends nothing.
- **One invocation dispatches one agent turn**; there is no multi-turn
  session, no `--continue`, no `--resume`. Nothing in the architecture through
  step 2 asks for one.
- **The new CLI command's prompt argument is a file path, not the prompt
  text**, consistent with "prompt on stdin, never in argv" (section 11) — the
  path itself is trusted static data, not model input, so passing it as a
  flag value is not the hazard the rule guards against.

**Approach:** Zero runtime dependencies, matching step 1. `node:child_process`
for spawning, `node:crypto` for hashing, `node:fs` for raw-output retention.
Six new modules (`executor.ts`, `harness.ts`, `parse-output.ts`,
`raw-output.ts`, `dispatch.ts`, plus a new migration) and one extended module
(`store.ts` gains `insertAgentRun`); `dispatch.ts` composes the others into
one sequence — raw output and an audit event are unconditional and happen
before any parsing or branching, so a failed or timed-out invocation is
never silently dropped — and is itself unit-tested against deterministic
fixture executors, not only exercised manually; `cli.ts` gains a thin
`dispatch` command wrapping it. Every guard gets a break-it test per
hazard 4.
The documentation checker is extended to cover the new schema block, per its
own stated design ("every table the design prose names exists in the schema
block," section 21).

**Affected areas:** New `src/executor.ts`, `src/harness.ts`,
`src/parse-output.ts`, `src/raw-output.ts`, `src/dispatch.ts`,
`src/migrations/002_agent_run.sql`, `test/executor.test.ts`,
`test/harness.test.ts`, `test/parse-output.test.ts`, `test/raw-output.test.ts`,
`test/dispatch.test.ts`, `test/fixtures/harness/*.mjs` (deterministic
stand-in executables, including `exit-nonzero.mjs`),
`test/fixtures/harness/claude-code-envelope.json` (one recorded real
invocation); modify `src/store.ts` (add `AgentRunRow`, `insertAgentRun`),
`src/cli.ts` (add `dispatch`), `test/cli.test.ts` (cover `dispatch`),
`test/schema.test.ts` and `scripts/doc-check.mjs` (extend the schema-vs-source
check to `agent_run`), `ARCHITECTURE.md` (sections 11 and 15 — see Task 7).

**Known blockers:**

- Hazard 8 (Windows executable resolution): `claude` resolves to a `.cmd` shim
  (verified above). `child_process.spawn` with `shell: false` does not resolve
  npm-shimmed `.cmd` files on Windows since Node's spawn-argument hardening;
  the fix is `shell: process.platform === "win32"` on the spawn call. Because
  all argv elements passed through this adapter are static literals (the
  prompt travels over stdin, never argv), enabling the shell on Windows does
  not reopen the argument-shredding hazard section 11 warns about.
- Hazard 9 (unverified hook interpreters): `probeExecutor` must run the
  probe command and fail closed with a named cause before any real
  invocation is attempted, so a broken `PATH` is diagnosed as a probe failure,
  not a mysterious empty result three steps later.
- Hazard 1/18 (parsing model output): the largest defect class per the
  document's own emphasis. All seven shapes need an accept/refuse assertion,
  not just the happy path.
- Hazard 2 (discarded output is undiagnosable): raw bytes must be written to
  disk before the envelope or the inner body is parsed, so a parse failure
  still leaves diagnosable evidence.
- Hazard 10 (exact-match model acceptance against moving aliases): out of
  scope for step 2 — there is no alias resolution yet, because model
  configuration (section 10) and agent selection (section 9) are later steps.
  `requested_model` in this step is whatever the CLI caller passes literally;
  recording it is in scope, resolving aliases is not.
- Windows tree-kill: `child.kill()` alone does not terminate a process tree on
  Windows. The fix (`taskkill /pid <pid> /t /f`) is verified on this machine;
  the POSIX equivalent (negative-pid `SIGKILL` on a detached process group) is
  implemented but **unverified** — this repository has no POSIX CI target
  today, and the plan does not claim it is tested. State this in the task
  evidence rather than asserting untested cross-platform coverage.
- The completion gate (`npm ci && npm run typecheck && npm test && npm run
  check:docs`) must stay free of real network/API dependence, per section 21's
  own verification strategy ("Replay retained model output as fixtures").
  Task 3's one real invocation happens once during implementation to produce
  a committed fixture; `npm test` never calls the real `claude` binary.

**Blast radius:** `src/store.ts`'s `Store` class gains one method
(`insertAgentRun`) and one exported type (`AgentRunRow`); no existing method
signature changes, so `src/cli.ts`'s five existing commands and all of
`test/store.test.ts`, `test/cli.test.ts`, `test/audit.test.ts`,
`test/lock.test.ts`, `test/migrate.test.ts` are unaffected (verified by
reading `store.ts`, `cli.ts` in full — no other file imports from `store.ts`
or `audit.ts` except the test files and `cli.ts` itself, confirmed by grep of
`from "./store` / `from "./audit` across `src/` and `test/`).
`scripts/doc-check.mjs`'s schema-vs-migration loop (lines 129-137 as currently
written) iterates a hardcoded `["run", "stage", "audit"]` list; extending it to
include `"agent_run"` is additive and does not change its existing assertions
for the three current tables. `src/migrate.ts`'s `applyMigrations` already
applies every `NNN_name.sql` file above the current `user_version` in
lexicographic order (verified by reading the function) — `002_agent_run.sql`
requires no change to `migrate.ts` itself. No agent definitions, stage
dispatch, or gate logic exist yet to consume `invokeHarness`'s output, so
nothing downstream is broken or coupled by this change; the new `dispatch` CLI
command is the only caller of the new modules until step 3.

**Verification:** `npm run typecheck` (strict `tsc --noEmit`), `npm test`
(`node --test`, using only deterministic fixture executors and the one
committed recorded envelope — no live network calls), `npm run check:docs`
(extended checker), and the completion gate:
`npm ci && npm run typecheck && npm test && npm run check:docs` from a clean
checkout. Every guard in Known blockers gets a break-it test.

---

### Task 1: Executor definition and shim-aware spawn core

**Depends on:** None (step 1's `store.ts`/`lock.ts` are unmodified prerequisites,
already present)

**Files:**
- Create: `src/executor.ts`
- Create: `test/fixtures/harness/echo-json.mjs`
- Create: `test/fixtures/harness/echo-env.mjs`
- Create: `test/executor.test.ts`

**Steps:**

- [x] **Step 1: `src/executor.ts` — the definition**
  - Change: Export `interface ExecutorDefinition` with fields `id: string`,
    `command: string[]`, `probe: string[]`, `capabilities: string[]`,
    `telemetry: { perInvocationModel: boolean; effectiveModel: boolean;
    tokenUsage: boolean; sessionCost: boolean }`, `sandbox: { allowedPaths:
    string[]; deniedPaths: string[]; commandAllowlist: string[];
    idleTimeoutSeconds: number; absoluteTimeoutSeconds: number;
    envPassthrough: string[]; network: "inherit" }`. `network` is typed as
    the single literal actually used — section 11's YAML shows only
    `network: inherit`, and no other value has any defined behavior anywhere
    in the architecture, so a wider union would be speculative. Export
    `export const CLAUDE_CODE: ExecutorDefinition` populated exactly per
    section 11's YAML plus the two assumptions above: `id: "claude-code"`,
    `command: ["claude", "-p", "--output-format", "json"]`,
    `probe: ["claude", "--version"]`, `capabilities: ["plan", "review"]`,
    telemetry as shown (`sessionCost: false`), `sandbox.allowedPaths:
    ["docs/features/**"]`, `deniedPaths: [".governance/**"]`,
    `commandAllowlist: []`, `idleTimeoutSeconds: 600`,
    `absoluteTimeoutSeconds: 3600`, `envPassthrough: ["PATH", "HOME",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot"]`,
    `network: "inherit"`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `test/fixtures/harness/echo-json.mjs`**
  - Change: A standalone Node script (no imports beyond `node:` builtins)
    that reads all of stdin, and writes to stdout a single JSON object:
    `{"type":"result","stdinLength":<bytes read>,"argv":process.argv.slice(2)}`.
    This stands in for `claude -p --output-format json` in every test that
    does not need the real binary — its `command` in a test-only
    `ExecutorDefinition` is `["node", "test/fixtures/harness/echo-json.mjs"]`.
  - Verify: `node test/fixtures/harness/echo-json.mjs --foo <<< "hi"` (manual
    check during authoring)
  - Expected: prints `{"type":"result","stdinLength":3,"argv":["--foo"]}`
    (or the platform's actual newline-adjusted byte count).

- [x] **Step 3: `test/fixtures/harness/echo-env.mjs`**
  - Change: A standalone Node script that writes
    `JSON.stringify(process.env)` to stdout, used to assert the spawn
    wrapper's environment passthrough is restrictive (Task 2's guard).
  - Verify: `npm run typecheck` (not type-checked itself; confirms no
    file-glob breakage in the test run)
  - Expected: exit 0.

- [x] **Step 4: `test/executor.test.ts`**
  - Change: Assert `CLAUDE_CODE.id === "claude-code"`; assert
    `CLAUDE_CODE.command` deep-equals `["claude", "-p", "--output-format",
    "json"]`; assert `CLAUDE_CODE.telemetry.sessionCost === false`; assert
    `CLAUDE_CODE.sandbox.absoluteTimeoutSeconds >
    CLAUDE_CODE.sandbox.idleTimeoutSeconds` (the ceiling-is-a-multiple
    invariant, so a future edit that breaks the relationship fails loudly).
  - Verify: `node --test test/executor.test.ts`
  - Expected: all tests pass.

**Task completion evidence:** `npm run typecheck` exits 0; `node --test
test/executor.test.ts` passes; the two fixture scripts run standalone as
shown.

### Task 2: `src/harness.ts` — spawn, probe, timeout, tree-kill, env restriction

**Depends on:** Task 1

**Files:**
- Create: `src/harness.ts`
- Create: `test/fixtures/harness/hang.mjs`
- Create: `test/fixtures/harness/spawn-grandchild.mjs`
- Create: `test/harness.test.ts`

**Steps:**

- [x] **Step 1: `probeExecutor`**
  - Change: `export function probeExecutor(executor: ExecutorDefinition):
    void`. Runs `executor.probe` via the same shim-aware spawn helper as
    Step 2 below (synchronously, `spawnSync`), with `shell: process.platform
    === "win32"`. On a non-zero exit or a spawn error (`ENOENT`), throw
    `new Error(\`probe failed for executor ${executor.id}: ${cause}\`)` naming
    the resolved command and the underlying error message — this is the
    hazard-9 guard: fail before any real invocation, with a diagnosable
    cause.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `invokeHarness` — spawn and capture**
  - Change: `export interface InvocationInput { prompt: string;
    idleTimeoutSeconds?: number; absoluteTimeoutSeconds?: number }`.
    `export interface HarnessOutcome { raw: string; exitCode: number | null;
    durationMs: number; timedOut: boolean; spawnError: string | null }`.
    `export function invokeHarness(executor: ExecutorDefinition, input:
    InvocationInput): HarnessOutcome`. Spawns `executor.command[0]` with
    `executor.command.slice(1)` via `child_process.spawn`, `shell:
    process.platform === "win32"` (hazard 8), `stdio: ["pipe", "pipe",
    "pipe"]`, and `env` built from `process.env` filtered to exactly
    `executor.sandbox.envPassthrough` (hazard-11/security section 17: named
    variables only, never the full environment). Writes `input.prompt` to the
    child's stdin and closes it (section 11: "prompt on stdin, never in
    argv"). Accumulates stdout into `raw`. Measures wall-clock `durationMs`
    from spawn to exit. **Never throws for a failure that happens after the
    probe has already succeeded**: if the child's own `"error"` event fires
    (a spawn failure — e.g. `ENOENT` from a TOCTOU race between probe and
    invocation), `invokeHarness` catches it and resolves with
    `{ raw: "" (or whatever partial stdout was captured), exitCode: null,
    durationMs: <elapsed>, timedOut: false, spawnError: err.message }`
    instead of rejecting, so Task 6's dispatch sequence has one uniform
    outcome shape to branch on regardless of failure mode. `spawnError` is
    `null` on every other path (success, timeout, non-zero exit).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: inactivity timeout and absolute ceiling**
  - Change: Inside `invokeHarness`, start an idle timer of
    `(input.idleTimeoutSeconds ?? executor.sandbox.idleTimeoutSeconds) *
    1000` ms, reset on every stdout/stderr `data` event. Start a separate
    absolute timer of `(input.absoluteTimeoutSeconds ??
    executor.sandbox.absoluteTimeoutSeconds) * 1000` ms that is never reset.
    Either firing kills the process tree (Step 4) and sets `timedOut: true`
    on the returned `HarnessOutcome`; both timers are cleared on normal exit.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 4: tree-kill**
  - Change: `function killTree(pid: number): void`. On `win32`:
    `spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"])`. On other
    platforms: spawn the child with `detached: true` and call
    `process.kill(-pid, "SIGKILL")`. Called by the timeout handlers in Step 3.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 5: `test/fixtures/harness/hang.mjs`**
  - Change: A script that reads stdin fully (so the harness's stdin-close
    still lets it start), then sleeps forever (`setInterval(() => {},
    1 << 30)`), never writing to stdout — used to trigger the idle timeout
    deterministically and quickly by passing a short `idleTimeoutSeconds` in
    the test.
  - Verify: manual run with a short-lived kill (authoring check only)
  - Expected: process must be killed externally to end.

- [x] **Step 6: `test/fixtures/harness/spawn-grandchild.mjs`**
  - Change: A script that spawns a detached grandchild
    (`node -e "setInterval(()=>{}, 1000)"`), writes the grandchild's pid to a
    file path given as `process.argv[2]`, then itself hangs like `hang.mjs`.
    Used to prove tree-kill actually reaches the grandchild, not just the
    immediate child.
  - Verify: manual run (authoring check only)
  - Expected: the pid file is written before the script hangs.

- [x] **Step 7: `test/harness.test.ts` — probe**
  - Change: Assert `probeExecutor` succeeds for an executor whose `probe` is
    `["node", "--version"]`; assert it throws naming the executor id and
    cause for an executor whose `probe` is `["definitely-not-a-real-binary"]`.
  - Verify: `node --test test/harness.test.ts`
  - Expected: both assertions pass.

- [x] **Step 8: `test/harness.test.ts` — happy path via `echo-json.mjs`**
  - Change: Build a test-only `ExecutorDefinition` whose `command` is
    `["node", "test/fixtures/harness/echo-json.mjs"]`. Call `invokeHarness`
    with a known prompt; assert `HarnessOutcome.raw` parses as JSON with the
    expected `stdinLength` matching the prompt's byte length, `exitCode ===
    0`, `timedOut === false`.
  - Verify: `node --test test/harness.test.ts`
  - Expected: passes.

- [x] **Step 9: `test/harness.test.ts` — env passthrough guard**
  - Change: Set `process.env.BUILDWORKS_TEST_CANARY = "leak-me"` in the test
    process before invoking a test executor whose `command` runs
    `echo-env.mjs`, with an `envPassthrough` list that does not include
    `BUILDWORKS_TEST_CANARY`. Parse the child's stdout JSON; assert the
    canary key is absent. This is the break-it guard: temporarily pass
    `process.env` unfiltered instead of the allowlist, confirm the canary
    leaks through (test fails as expected), then restore the filtered
    build and confirm it passes again — record both runs in the task
    evidence per hazard 4's discipline.
    Additionally, on `win32`, run a test executor whose `command` is
    `["cmd", "/c", "echo", "hi"]` through the same shim-aware spawn path
    with only the `CLAUDE_CODE.sandbox.envPassthrough` list applied (no
    `ComSpec` entry), and assert it still exits 0 — `shell: true`'s internal
    shell resolution reads `ComSpec` from the *parent* process's own
    environment, not from the filtered `env` handed to the child, but this
    assertion makes that fact verified rather than assumed.
  - Verify: `node --test test/harness.test.ts`
  - Expected: canary absent with the allowlist in place; present when the
    filter is bypassed (recorded, then reverted); the `cmd /c echo` check
    exits 0 under the filtered environment.

- [x] **Step 10: `test/harness.test.ts` — idle timeout and tree-kill**
  - Change: Using `hang.mjs` with `idleTimeoutSeconds: 1` (override via
    `InvocationInput`), assert `invokeHarness` returns within a few seconds
    with `timedOut: true`. Using `spawn-grandchild.mjs` with the same short
    idle timeout and a temp file path for the grandchild's pid, assert that
    after `invokeHarness` returns, the grandchild pid is no longer alive
    (`process.kill(pid, 0)` throws `ESRCH` on the recorded pid) — this proves
    the tree-kill, not just the immediate child. Prove the guard by breaking
    it: temporarily call `child.kill()` instead of `killTree(child.pid)`,
    confirm the grandchild survives (test fails), then restore.
  - Verify: `node --test test/harness.test.ts`
  - Expected: immediate-child case passes on first write; the grandchild
    case fails when tree-kill is replaced with a plain kill and passes when
    restored — record both runs in the task evidence.

- [x] **Step 11: shim resolution against the real `claude.cmd`**
  - Change: A test that runs `probeExecutor(CLAUDE_CODE)` for real (this
    machine has `claude` resolving per the plan's assumptions). Prove the
    guard by breaking it: temporarily hardcode `shell: false` in the spawn
    call, confirm the probe throws (or the shimmed command fails to spawn) on
    this machine, then restore `shell: process.platform === "win32"` and
    confirm it passes. Skip this test (not fail) when `claude` does not
    resolve in the running environment, printing a clear skip reason, per
    hazard 9's guidance to report a PATH problem rather than a false
    failure.
  - Verify: `node --test test/harness.test.ts`
  - Expected: passes on this machine with the shim-aware spawn; fails with
    `shell: false` (recorded, then restored); skips cleanly on a machine
    without `claude`.

**Task completion evidence:** `npm test` green; the env-passthrough,
tree-kill, and shim-resolution guards each have a recorded failing run under
the broken variant and a passing run after restoration.

### Task 3: Real envelope capture and outer-envelope extraction

**Depends on:** Task 2

**Files:**
- Create: `test/fixtures/harness/claude-code-envelope.json`
- Create: `src/harness.ts` — extend with `parseEnvelope`
- Create: `test/harness.test.ts` — extend

**Steps:**

- [x] **Step 1: capture one real invocation**
  - Change: Run, once, from the repository root:
    `claude -p --output-format json "Reply with exactly the single word:
    pong"` and save the raw stdout bytes verbatim to
    `test/fixtures/harness/claude-code-envelope.json`. This spends a small,
    real amount of API cost on the operator's account — a single trivial
    turn — and is done once during implementation, never by the automated
    suite. This is the hazard-4/hard-rule-5 discipline: the envelope's field
    names for cost, tokens, model, and the inner result text are read from
    this recorded file, not invented.
  - Verify: `node -e "JSON.parse(require('fs').readFileSync('test/fixtures/harness/claude-code-envelope.json','utf8'))"`
  - Expected: parses without error; confirms the file is valid JSON before
    it is depended on.

- [x] **Step 2: `parseEnvelope`**
  - Change: `export interface HarnessEnvelope { effectiveModel: string |
    null; fallback: string | null; tokensIn: number | null; tokensOut: number
    | null; cacheRead: number | null; cacheWrite: number | null; cost: number
    | null; resultText: string }`. `export function
    parseEnvelope(executor: ExecutorDefinition, raw: string):
    HarnessEnvelope`. **Precondition: called only when the invocation
    exited cleanly** (`HarnessOutcome.exitCode === 0`) — Task 6's dispatch
    sequence enforces this by branching on `exitCode`/`timedOut`/`spawnError`
    before ever calling `parseEnvelope`, so a crashed or killed process's
    non-JSON or empty stdout never reaches this function. Given that
    precondition, `raw` parses as JSON (the outer envelope from
    `--output-format json` is machine-generated and always valid JSON at the
    top level on a clean exit — this is not the hazard-1 shape problem, which
    concerns the agent's own inner text). Reads whichever fields the fixture
    in Step 1
    actually contains for model identity, token usage, and cost; for any
    field the fixture does not carry (expected: cost, given
    `telemetry.sessionCost === false` on `CLAUDE_CODE`), set it to `null`,
    never `0` — architecture section 11: "a zero that means 'not reported' is
    indistinguishable from a zero that means 'free'." Extracts the field
    holding the agent's own textual reply into `resultText`, unparsed —
    Task 4 handles that content.
  - Verify: `npm run typecheck`
  - Expected: exit 0. (The exact field-name mapping in this step's
    implementation is written against the Step 1 fixture, not against this
    plan's guesses — update this step's evidence with the fixture's actual
    key names once captured.)

- [x] **Step 3: replay test**
  - Change: `test/harness.test.ts` reads
    `test/fixtures/harness/claude-code-envelope.json`, calls
    `parseEnvelope(CLAUDE_CODE, raw)`, and asserts: `resultText` contains
    `"pong"`; `cost === null` (matching `sessionCost: false`); `tokensIn` and
    `tokensOut` are both positive integers if the fixture reports them, or
    both `null` if it does not — assert whichever the recorded fixture
    actually shows, not an assumed pair.
  - Verify: `node --test test/harness.test.ts`
  - Expected: passes against the committed fixture, with zero network calls.

- [x] **Step 4: prove the null-not-zero guard by breaking it**
  - Change: Temporarily default an unreported field to `0` instead of
    `null` in `parseEnvelope`.
  - Verify: `node --test test/harness.test.ts`
  - Expected: the cost assertion (`cost === null`) fails; restore and
    re-run to green.

**Task completion evidence:** `npm test` green using only the committed
fixture; the null-vs-zero guard fails when broken and passes when restored;
the fixture file exists and is valid JSON.

### Task 4: `src/parse-output.ts` — the seven fallback shapes

**Depends on:** None (pure function over strings; independent of Tasks 1-3)

**Files:**
- Create: `src/parse-output.ts`
- Create: `test/parse-output.test.ts`

**Steps:**

- [x] **Step 1: `extractJsonBody`**
  - Change: `export type ExtractResult = { kind: "ok"; value: unknown } |
    { kind: "refused"; reason: string }`.
    `export function extractJsonBody(text: string): ExtractResult`.
    Implements, in order: (1) if the trimmed text parses as JSON directly,
    return it (`bare JSON`); (2) find every ` ```json ... ``` ` or bare
    ` ``` ... ``` ` fence (case-insensitive language tag, tolerant of `\r\n`
    inside the fence per hazard-1 item 7 — normalize `\r\n` to `\n` before
    parsing the fenced content, not before searching for fence markers); if
    exactly one fence is found, parse its content as JSON, ignoring any prose
    before or after the fence (items 3 and 4); if that content is not valid
    JSON, return `{ kind: "refused", reason: "fenced block is not valid
    JSON: <parse error message>" }` (item 6); (3) if two or more fences are
    found, return `{ kind: "refused", reason: "expected exactly one JSON
    block, found <n>" }` (item 5 — refuse rather than guess); (4) if no fence
    and the bare text is not JSON, return `{ kind: "refused", reason: "no
    JSON object found in output" }`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: one test per documented shape**
  - Change: `test/parse-output.test.ts`, one case per hazard-1/18 item:
    1. bare JSON -> `{ kind: "ok", value: {...} }`.
    2. single ` ```json ` fence -> `ok` with the fenced value.
    3. prose before the fence (`"Now I'll return the reconciliation:\n\`\`\`json..."`)
       -> `ok`, prose ignored.
    4. prose after the fence -> `ok`, prose ignored.
    5. two fenced blocks -> `refused`, reason names the count `2`.
    6. a fenced block that is not JSON (e.g. plain prose inside the fence)
       -> `refused`, reason names "not valid JSON".
    7. CRLF line endings inside the fence -> `ok`, value parses identically
       to the LF version of the same content.
    Assert the operator-visible `reason` string on every `refused` case, not
    merely that `kind === "refused"` (hazard 1: "assert the operator-visible
    message on every refusal").
  - Verify: `node --test test/parse-output.test.ts`
  - Expected: all seven cases pass, including the two refusal reason-string
    assertions.

- [x] **Step 3: prove the guard by breaking it**
  - Change: Temporarily change the two-fences branch to pick the first fence
    instead of refusing.
  - Verify: `node --test test/parse-output.test.ts`
  - Expected: the two-fenced-blocks test fails (it now silently picks one);
    restore and re-run to green.

**Task completion evidence:** `npm test` green with one assertion per
documented shape; the guess-instead-of-refuse guard fails when broken and
passes when restored.

### Task 5: `agent_run` migration, store extension, raw-output retention

**Depends on:** Task 3 (needs `HarnessEnvelope`'s field shapes settled)

**Files:**
- Create: `src/migrations/002_agent_run.sql`
- Create: `src/raw-output.ts`
- Create: `test/raw-output.test.ts`
- Modify: `src/store.ts` — add `AgentRunRow`, `insertAgentRun`
- Create: `test/store.test.ts` — extend with agent_run coverage

**Steps:**

- [x] **Step 1: `002_agent_run.sql`**
  - Change:

    ```sql
    CREATE TABLE agent_run (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_id         INTEGER NOT NULL REFERENCES stage(id),
      agent            TEXT NOT NULL,
      role             TEXT NOT NULL CHECK (role IN ('author', 'reviewer')),
      executor         TEXT NOT NULL,
      requested_model  TEXT NOT NULL,
      effective_model  TEXT,
      fallback         TEXT,
      tokens_in        INTEGER,
      tokens_out       INTEGER,
      cache_read       INTEGER,
      cache_write      INTEGER,
      cost             REAL,
      duration_ms      INTEGER NOT NULL,
      input_hash       TEXT NOT NULL,
      output_hash      TEXT NOT NULL,
      raw_output_ref   TEXT NOT NULL,
      independence     TEXT NOT NULL
                       CHECK (independence IN ('unverified_self_attestation', 'configured_standalone'))
    );

    PRAGMA user_version = 2;
    ```

    Column order matches the architecture's section 15 list exactly, for
    `test/schema.test.ts`'s column-order comparison (Step 4 below).
  - Verify: `npm run typecheck`
  - Expected: exit 0 (SQL is not type-checked; confirms no glob breakage).

- [x] **Step 2: `src/raw-output.ts`**
  - Change: `export function writeRawOutput(rootDir: string, runId: number,
    bytes: string): string`. Creates `.governance/raw/<runId>/` (recursive
    mkdir) if absent, writes `bytes` to a file named
    `<timestamp>-<random 6-byte hex>.json` inside it (using
    `node:crypto`'s `randomBytes`, matching `lock.ts`'s token style), and
    returns the path relative to `rootDir` (e.g.
    `.governance/raw/3/2026...-a1b2c3.json`) for storage in
    `agent_run.raw_output_ref`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: `test/raw-output.test.ts`**
  - Change: Write bytes to a temp root via `fs.mkdtempSync`; assert the
    returned ref, joined back with the temp root, reads back the exact bytes
    written; assert two calls with the same `runId` produce two distinct
    files (no overwrite).
  - Verify: `node --test test/raw-output.test.ts`
  - Expected: all tests pass.

- [x] **Step 4: schema contract test extension**
  - Change: `test/schema.test.ts` adds `agent_run` to the table-and-column
    comparison already used for `run`/`stage`/`audit` (parsing the expected
    column list from `ARCHITECTURE.md` section 15's schema fence, the same
    mechanism the existing test uses — not a hand-copied list). Also assert
    the `role` and `independence` `CHECK` constraints are present in
    `002_agent_run.sql`.
  - Verify: `node --test test/schema.test.ts`
  - Expected: passes once `002_agent_run.sql`'s column order matches the
    architecture block exactly.

- [x] **Step 5: `store.ts` — `AgentRunRow` and `insertAgentRun`**
  - Change: Export `interface AgentRunRow` mirroring the migration's columns
    (camelCase TypeScript surface is not used elsewhere in `store.ts` — match
    the existing `snake_case` field convention from `RunRow`/`StageRow`).
    Add `insertAgentRun(input: { stageId: number; agent: string; role:
    "author" | "reviewer"; executor: string; requestedModel: string;
    effectiveModel: string | null; fallback: string | null; tokensIn: number
    | null; tokensOut: number | null; cacheRead: number | null; cacheWrite:
    number | null; cost: number | null; durationMs: number; inputHash:
    string; outputHash: string; rawOutputRef: string; independence:
    "unverified_self_attestation" | "configured_standalone" }): AgentRunRow`
    to the `Store` class, following the existing `insertRun`/`insertStage`
    pattern: validate `role` and `independence` against their allowed-value
    arrays (throwing the same `"invalid X <value>: allowed values are
    ..."` message shape `insertRun` uses for `change_kind`), insert via
    `this.#withRetry`, and return the row via a new `getAgentRun(id)`
    reader.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 6: store tests**
  - Change: `test/store.test.ts` adds: inserting an `agent_run` row against
    a real `stage_id` persists all fields including `null` ones (assert
    `cost === null`, not `0` or missing); an invalid `role` is refused
    naming the allowed values; an invalid `independence` is refused naming
    the allowed values; a `stage_id` that does not exist fails on the
    `REFERENCES stage(id)` foreign key (matching the existing
    `PRAGMA foreign_keys = ON` behavior already relied on by `stage.run_id`).
  - Verify: `node --test test/store.test.ts`
  - Expected: all tests pass.

**Task completion evidence:** `npm test` green; the schema contract test
passes only once migration and architecture columns match exactly; nullable
telemetry fields round-trip as `NULL`, verified by direct assertion.

### Task 6: `src/dispatch.ts` composition, CLI wiring, and end-to-end tests

**Depends on:** Tasks 1, 2, 3, 4, 5

**Files:**
- Create: `src/dispatch.ts`
- Create: `test/dispatch.test.ts`
- Create: `test/fixtures/harness/exit-nonzero.mjs`
- Modify: `src/cli.ts` — add `dispatch`
- Modify: `test/cli.test.ts` — cover `dispatch`

**Steps:**

- [x] **Step 1: `src/dispatch.ts` — the composed, testable sequence**
  - Change: `export interface DispatchInput { stageId: number; agent:
    string; role: "author" | "reviewer"; requestedModel: string; prompt:
    string }`. `export interface DispatchOutcome { agentRunId: number |
    null; failed: boolean; cause: string | null }`.
    `export function dispatch(store: Store, executor: ExecutorDefinition,
    input: DispatchInput): DispatchOutcome`. This is the corrected
    sequence, fixing the ordering the review flagged — raw output and the
    audit event are unconditional, and come before any parsing or success/
    failure branching:
    1. `const stage = store.getStage(input.stageId); if (!stage) throw new
       Error(\`stage ${input.stageId} does not exist\`);` — fails before any
       probe or spawn, so a bad id costs nothing.
    2. `probeExecutor(executor)` — hazard 9, fails closed before any real
       invocation.
    3. `const outcome = invokeHarness(executor, { prompt: input.prompt })`.
    4. `const rawOutputRef = writeRawOutput(process.cwd(), stage.run_id,
       outcome.raw)` — **always runs here, before any parsing or branching**,
       per hazard 2: even an empty string from a total spawn failure is
       written, so there is always a file to point to.
    5. Derive `failed` and `cause`: `outcome.timedOut ? "timeout" :
       outcome.spawnError !== null ? \`spawn error: ${outcome.spawnError}\` :
       outcome.exitCode !== 0 ? \`exit code ${outcome.exitCode}\` : null`;
       `failed = cause !== null`.
    6. `appendAudit(store, { runId: stage.run_id, stageId: stage.id, actor:
       input.agent, actorType: "agent", action: failed ?
       "agent.dispatch.failed" : "agent.dispatch", summary: failed ?
       \`agent ${input.agent} (${input.role}) on stage ${stage.id} failed:
       ${cause}\` : \`dispatched agent ${input.agent} (${input.role}) on
       stage ${stage.id}\` })` — **always runs**, so a failed attempt is
       never silent (per the plan's schema assumption: the audit chain is
       where a failed attempt's evidence lives, since `agent_run` has no
       status column).
    7. If `failed`, return `{ agentRunId: null, failed: true, cause }` — no
       `agent_run` row, matching the plan's schema assumption.
    8. Otherwise: `const envelope = parseEnvelope(executor, outcome.raw)`
       (safe here — `exitCode === 0` is now guaranteed by step 5's branch);
       compute `inputHash = sha256(input.prompt)` and `outputHash =
       sha256(outcome.raw)` via `node:crypto`'s `createHash("sha256")...
       digest("hex")` (matching `audit.ts`'s existing idiom); call
       `store.insertAgentRun({ stageId: stage.id, agent: input.agent, role:
       input.role, executor: executor.id, requestedModel:
       input.requestedModel, effectiveModel: envelope.effectiveModel,
       fallback: envelope.fallback, tokensIn: envelope.tokensIn, tokensOut:
       envelope.tokensOut, cacheRead: envelope.cacheRead, cacheWrite:
       envelope.cacheWrite, cost: envelope.cost, durationMs:
       outcome.durationMs, inputHash, outputHash, rawOutputRef,
       independence: "configured_standalone" })` — `"configured_standalone"`
       because this is always a freshly spawned process, never a
       same-session subagent (hazard 14); return `{ agentRunId: row.id,
       failed: false, cause: null }`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `dispatch` CLI command — thin wrapper**
  - Change: `bw dispatch --stage <id> --agent <id> --role author|reviewer
    --model <name> --prompt-file <path>`. Validates `--role` against
    `["author", "reviewer"]` up front with the same `UsageError` naming
    pattern `--change-kind`/`--gate-result` already use, exiting 2. Parses
    `--stage` with the existing `numeric(args, "stage")` helper. Reads the
    prompt text from the file at `--prompt-file` (a filesystem path, not the
    prompt itself — see the plan's assumptions), surfacing a clear "cannot
    read prompt file `<path>`: `<cause>`" `UsageError` (exit 2) if the read
    fails, before calling `dispatch`. Calls `dispatch(store, CLAUDE_CODE,
    {...})`. On `outcome.failed`, prints
    `dispatch failed for stage ${stageId} (agent ${agent}): ${cause}` and
    sets `process.exitCode = 1`. Otherwise prints `String(outcome.agentRunId)`.
    Add `dispatch --stage <id> --agent <id> --role author|reviewer --model
    <name> --prompt-file <path>` to `USAGE` and the `known` command array,
    matching the existing format.
  - Verify: `npm run typecheck` and `node src/cli.ts` (no args)
  - Expected: exit 0; usage text includes the new command line.

- [x] **Step 3: `test/dispatch.test.ts` — unit tests against fixture executors**
  - Change: Using the `echo-json.mjs` fixture executor (success path) and
    two new tiny fixture scripts — `test/fixtures/harness/exit-nonzero.mjs`
    (reads stdin, writes `"boom"` to stderr, `process.exit(3)`) and reuse of
    `hang.mjs` with a short `idleTimeoutSeconds` (timeout path) — assert:
    - **Success:** `dispatch` returns `{ failed: false, agentRunId:
      <number> }`; `store.getAgentRun(agentRunId)` has `cost === null`
      (fixture reports none) and `raw_output_ref` pointing at a file that
      exists and contains the fixture's raw output; `verifyAuditChain`
      still returns `null` afterward.
    - **Non-zero exit:** `dispatch` returns `{ failed: true, cause: "exit
      code 3" }` and `agentRunId: null`; **the raw output file still
      exists** and contains the fixture's stderr-adjacent stdout capture;
      the audit chain has a new `agent.dispatch.failed` event naming the
      stage and the cause; no new `agent_run` row was inserted (row count
      unchanged). This is the direct regression test for the critical
      finding.
    - **Timeout:** same three assertions as the non-zero-exit case, with
      `cause: "timeout"`.
    - **Bad stage id:** `dispatch` throws `stage <id> does not exist`
      *before* the fixture executor's probe script is ever invoked (assert
      via a probe/command pointed at a path that would throw loudly if
      ever spawned, e.g. `["definitely-not-a-real-binary"]`, and confirm no
      throw from the probe reaches the caller — only the stage-existence
      error does).
  - Verify: `node --test test/dispatch.test.ts`
  - Expected: all four cases pass, entirely against local fixture scripts —
    zero network calls.

- [x] **Step 4: prove the ordering guard by breaking it**
  - Change: Temporarily restore the original (defective) ordering —
    `parseEnvelope` before `writeRawOutput`, and skip both on the
    failure branch.
  - Verify: `node --test test/dispatch.test.ts`
  - Expected: the non-zero-exit and timeout cases fail (no raw file, no
    audit event, and/or a thrown parse error instead of a clean `failed`
    result); restore the corrected ordering and re-run to green. Record
    both runs in the task evidence — this is the plan review's critical
    finding, proven and fixed, not merely asserted fixed.

- [x] **Step 5: process-level CLI tests**
  - Change: `test/cli.test.ts` adds: `dispatch` with a missing `--role`
    value exits 2 with `missing required option --role` (matching the
    existing `stage-complete` test's shape); `dispatch` against a
    nonexistent `--stage` id exits 1 with the "does not exist" message.
    Both run against the real `CLAUDE_CODE` executor (since `cli.ts`'s
    `dispatch` case is a thin wrapper with no fixture-injection seam) but
    never reach `probeExecutor` or `invokeHarness`, because both failures
    are caught before `dispatch()` is called (bad `--role`) or inside it
    before the probe (bad `--stage`) — so both are network-free regardless
    of whether `claude` resolves on the test machine.
  - Verify: `node --test test/cli.test.ts`
  - Expected: both cases pass without any real `claude` invocation.

- [x] **Step 6: documented manual smoke test**
  - Change: No new automated test for the real binary (would spend real API
    cost on every run — the fixture-based `test/dispatch.test.ts` already
    covers the corrected sequencing deterministically). Record in this
    task's evidence the exact manual command sequence used to smoke-test the
    real path once during implementation: `node src/cli.ts new-run --project
    p --feature f --slug s --change-kind feature`, then `node src/cli.ts
    stage-add --run <id> --kind spec`, then `node src/cli.ts dispatch
    --stage <id> --agent smoke-test --role author --model sonnet
    --prompt-file <a temp file containing "Reply with exactly the single
    word: pong">` — `--model sonnet` here is recorded verbatim as literal
    passthrough into `requested_model` (hazard 10's alias resolution is
    deferred; nothing reinterprets this value in step 2) — confirming the
    printed `agent_run` id, the `.governance/raw/<run>/*.json` file, and
    `resultText` containing `"pong"` when read back.
  - Verify: manual, once, during implementation (not part of `npm test`)
  - Expected: an `agent_run` row exists, `cost` is `null`, `raw_output_ref`
    file exists and is readable.

**Task completion evidence:** `npm test` green with zero live network calls;
the ordering guard (Step 4) fails when the defective sequence is restored and
passes when corrected; `dispatch`'s bad-input paths (`--role`, `--stage`)
fail before any process spawn; the manual smoke test (Step 6) is recorded as
executed once against the real `claude` binary.

### Task 7: Documentation checker extension and status

**Depends on:** Task 5 (parses `002_agent_run.sql`), Task 6 (the failed-
invocation behavior this task documents)

**Files:**
- Modify: `scripts/doc-check.mjs`
- Modify: `ARCHITECTURE.md` — sections 11 and 15
- Modify: `README.md` — status
- Modify: `.claude/sessions/project-learnings.md` — record step 2

**Steps:**

- [x] **Step 1: record the two new facts in `ARCHITECTURE.md`**
  - Change: In section 11's executor YAML block, add
    `absoluteTimeoutSeconds: 3600` alongside the existing
    `idleTimeoutSeconds: 600` line, with a one-line note that the ceiling is
    a configured multiple of the idle budget (matching this plan's
    assumption) — the code and the document must not drift on a field the
    document itself introduces the concept for ("a separate absolute
    ceiling as a multiple of the idle budget") but never named. In section
    15, add one sentence after the schema block: a failed or timed-out
    invocation is represented by an `agent.dispatch.failed` audit event, not
    by an `agent_run` row, until a status column is designed — so a reader
    of the schema does not assume every invocation attempt has a
    corresponding row.
  - Verify: `npm run check:docs`
  - Expected: exit 0 (neither addition is asserted by the checker yet; this
    step's expectation is that adding prose does not break existing
    assertions — Step 2 below adds the new assertion).

- [x] **Step 2: extend the schema-vs-migrations check**
  - Change: In `scripts/doc-check.mjs`, extend the `for (const table of
    ["run", "stage", "audit"])` loop (lines 129-137 as currently written) to
    `["run", "stage", "agent_run", "audit"]`, reading `agent_run`'s columns
    from both `ARCHITECTURE.md` (already parsed by the existing
    `archColumns` map, which already covers all six schema-block tables) and
    from the concatenated migration SQL (already parsed by the existing
    `migrationColumns` map, which already scans every `CREATE TABLE` in
    `src/migrations/*.sql` — `002_agent_run.sql` is picked up automatically
    once it exists, since the migration-reading loop is not table-specific).
    Add the two new `agent_run` `CHECK` constraints to the existing
    `constraints` array: `"CHECK (role IN ('author', 'reviewer'))"` and
    `"CHECK (independence IN ('unverified_self_attestation',
    'configured_standalone'))"`.
  - Verify: `npm run check:docs`
  - Expected: exit 0 once `002_agent_run.sql`'s column order matches
    section 15 exactly (this is the same check `test/schema.test.ts` runs in
    Task 5, run here independently as section 21 requires — "a checker that
    re-derives documentation facts from source").

- [x] **Step 3: README status**
  - Change: Update the "Status" section to add step 2 (the harness adapter)
    to what's implemented, alongside step 1.
  - Verify: `npm run check:docs`
  - Expected: exit 0 (README is outside the checker's scope; confirms no
    interference).

- [x] **Step 4: session learnings**
  - Change: Append a dated entry to `.claude/sessions/project-learnings.md`
    recording step 2 as implemented, any deviations found during
    implementation (the real envelope's actual field names from Task 3 Step
    1, once captured, and the plan-review critical finding on failure-path
    evidence retention, reconciled before implementation), and the next
    build-order step (3: spec stage and its review panel with a
    deterministic gate).
  - Verify: none (documentation only)
  - Expected: file updated.

- [x] **Step 5: completion gate**
  - Change: none.
  - Verify: `npm ci && npm run typecheck && npm test && npm run check:docs`
  - Expected: all four exit 0 from a clean install, with zero live network
    calls during `npm test`.

**Task completion evidence:** `npm run check:docs` exits 0; the completion
gate passes from a clean checkout.

---

## Implementation note

**Shipped (2026-08-29):** the concrete harness adapter — `src/executor.ts`
(the definition), `src/harness.ts` (probe, invoke, timeouts, tree-kill,
envelope parsing), `src/parse-output.ts` (the seven shapes),
`src/raw-output.ts`, `src/dispatch.ts` (the evidence-safe sequence, this
plan's `dispatch()` under the name `dispatchOnce`, with the result union
using `reason` rather than `cause`), migration `002_agent_run.sql`,
`store.insertAgentRun`, and `bw dispatch`. Completion gate green from clean:
typecheck, 75/75 tests, checker.

**Deviations from the plan, and why:**

- `invokeHarness` is async, not sync: the timeout timers run on the same
  thread as any synchronous wait, so a sync wait starves the timers and the
  timeout can never fire.
- The plan review's critical fix is applied and proven: raw output and
  stderr are retained and the attempt audited before any branch; failure
  paths write an `agent.dispatch.failed` event and insert no `agent_run`
  row. The ordering break-it (Task 6 Step 4) was run: with retention moved
  after the branch, all three failure-path tests fail; restored, they pass.
  The architecture section 15 states the no-row rule.
- The real recorded envelope contradicted the plan in two places, and the
  implementation follows the envelope (hard rule 5): `sessionCost` is `true`
  (the envelope carries `total_cost_usd`; the architecture's example was
  fixed), and the effective model is the unique `modelUsage` entry matching
  `usage.input_tokens` — the envelope showed auxiliary model queries whose
  tokens do not land in the top-level `usage`.
- `--model` is transmitted to the harness (`--model <name>` appended to the
  command), not merely recorded: a recorded-but-never-requested model is
  fiction, and the code review forced the change.
- `npm test` is pinned to `test/*.test.ts`: Node's default discovery runs
  everything under `test/`, including the `hang` fixture scripts, which
  hangs the runner.
- `taskkill` runs by full path (`SystemRoot\System32\taskkill.exe`): a PATH
  miss made the tree-kill a silent no-op, and a GNU-timeout-killed test run
  could look green because Node's exit teardown kills the hung child.
  Duration assertions in `test/harness.test.ts` catch that lie.
- Prompt and result size caps (1 MiB each) are constants in `src/harness.ts`
  with breach behavior per section 20; they move to configuration when the
  config loader exists.

**Code review:** one independent pass, 15 consolidated findings, all
reconciled: evidence-safe settle logic (resolve-never-reject, stdin error
swallowing, buffer-accurate UTF-8 accumulation, stderr retention, close
grace, timer-race guards), size caps, `dispatchOnce` extraction with
automated failure-path coverage, model transmission, prompt-file
diagnostics, and two test corrections.

**Deferred:** none within step 2 scope. The POSIX tree-kill path is
implemented but unverified (no POSIX target). Config-file loading for the
executor definition remains deferred per hard rule 4.

---

## Deferred

Out of scope for step 2, per the architecture's own build-order sequencing:

- Agent definitions and the selection function (section 9) — step 3 needs a
  spec-stage agent to dispatch; step 2 dispatches by raw agent id/role/model
  passed directly on the CLI, with no registry behind them.
- `AgentResult` schema validation (section 8) — the first stage that asks an
  agent for a specific result shape defines and validates it.
- Model alias resolution (sections 9, 10; hazard 10) — `requested_model` is
  passed through literally.
- Gates (section 12) — no gate exists to feed `invokeHarness`'s output into
  yet.
- A config loader for the executor definition — deferred until a second
  executor or an operator-editable definition exists (hard rule 4).
