# Doctor Ambient Configuration Implementation Plan

**Status:** Implemented

**Goal:** Make `doctor` show the environment supplied to its native Claude version probe, bounded user-configuration observations, and the absolute executable it probes, without spending, repairing configuration, or changing run policy.

**Source:** `.claude\sessions\2026-09-11-cc-switch-candidate-b-effort.md`; Candidate B in `docs\proposals\cc-switch-review.md`; MHA-07 and MHA-11 in `docs\proposals\2026-09-03-multi-harness-adapter-blast-radius-review.md`. `ARCHITECTURE.md` sections 3, 11, 15, 17, 19-21, and 23 govern conflicts.

**Hazards considered:** 4 (derive expectations from the stated contract and independent native child processes, then break the guards); 8 (native Windows resolution, no command-shell wrapper); 9 (probe with the environment actually supplied to invocation); 11 (test an installation-independent default doctor path); 12 (expose configuration divergence rather than hide it); 17 (retain the selected whole-file change-detection obligation rather than silently remove it during reconciliation). Hazards 10 and 15 limit claims: a version probe proves neither provider/model routing nor configuration containment. Hazard 2 was considered and does not require new retention: no model dispatch or model-output handling changes.

**Assumptions:** This request authorizes planning Candidate B only. Windows native Claude remains the primary supported path; preserve the existing POSIX direct-spawn path without promising installation certification. Diagnostic fingerprints are local change indicators, not credential redaction guarantees or proof of configuration precedence. Whole-file fingerprints of both documented user files, including `user_state`, remain intentional sensitive comparison data. The operator owns the local executable being probed.

**Approach:** Extract the existing named-environment construction; add opt-in process options to `probeExecutor`; resolve and probe one absolute native executable for doctor; project allowlisted environment metadata and two bounded Claude user-file observations through the existing `current` object.

**Affected areas:** `src\harness.ts`, `src\readiness.ts`, a concrete doctor diagnostics module, harness/CLI regression fixtures, and the existing README/runbook. The JSON addition is current observational data, not a new frozen executor schema.

**Known blockers:** No unresolved product decision blocks this bounded plan. Verified constraints: no new harness or dashboard authorization; no provider spend; Windows shims cannot replace the native launcher; existing tests intercept the bare probe name and must be adapted before absolute-path probing lands. Missing home information or unsupported file reads are explicit observational limitations, not implementation blockers. See Baseline and boundaries.

**Blast radius:** Verified by symbol/import searches: `probeExecutor` is called by `inspectReadiness` and `dispatchOnce`; `invokeHarness` is called by `dispatchOnce`; `inspectReadiness` is called by the doctor branch of `src\cli.ts`. `DoctorResult` in `src\operator-output.ts` consumes `CurrentReadiness`, and both renderers serialize it already. Preserve all non-doctor process defaults and all existing CLI gate rules; detailed dependents are listed below.

**Verification:** Real local child-process tests plus the existing Node test runner, focused harness/dispatch/CLI suites, profile checks, byte-preservation assertions, isolated negative mutations, `npm run typecheck`, and `npm run check:docs`. No paid acceptance chain is required or authorized.

---

## Baseline and boundaries

This is a full-path bootstrap plan for BuildWorks itself, not an artifact from
a governed target run. The derived feature slug is `doctor-ambient-config`.
Task execution belongs in approved task-state rows, not a new task document or
Markdown checkboxes.

Planning baseline, observed 2026-09-11: branch `cs_candidate_b`, HEAD `fbda8dd`.
The only pre-existing working-tree change is the requested conversion of the
effort record from `.txt` to `.md`. Its historical `86af2c0` baseline and the
older Current state in project learnings are not the checkout's present HEAD.
Preserve that history and the conversion; do not rewrite them to match today.
The local runtime is Windows, Node 26.4.0, libuv 1.52.1; `package.json` requires
Node >=24. No `docs\upstream` directory or checked-in `.github` workflow was
found at this baseline. There is no existing executable-resolution helper in
the searched production files.

The assessment narrows two overly strong suggestions in the original review:
do not hash credential values, and do not remove the authentication,
entitlement, or quota limitations. This plan adopts those corrections without
editing the historical review.

Included: one observation per doctor invocation; explicit environment parity
for its version probe; native executable identity; named provider-override
presence; bounded local Claude user-file fingerprints; complete text/JSON
presentation; unchanged frozen-run refusal semantics.

Excluded: Candidate A, new environment passthrough names, provider access
checks, config parsing/merging or repairs, drift gates, frozen file/binary
identity, telemetry persistence, progress/token dashboard work, a proxy,
cc-switch installation, Pi/Codex support, an adapter interface, migrations,
stage changes, signing, publication, and paid runs. MHA-07 remains partially
open: this does not move probing into run creation or change dispatch probes.

## Settled diagnostic contract

### Process construction and executable identity

Introduce `buildHarnessEnvironment` in `src\harness.ts`, extracting exactly the
current `invokeHarness` loop over `executor.sandbox.envPassthrough`. Its inputs
are the executor and an optional environment source defaulting to `process.env`;
its output is a fresh `Record<string, string>` containing defined named values
only. Empty strings remain present. It never adds variables, normalizes values,
or mutates the executor/source.

Doctor snapshots only the relevant names through `process.env[name]` before
filtering: the passthrough list, the three provider override names below, and
`CLAUDE_CONFIG_DIR`. Reading by declared name preserves Windows main-thread
environment lookup semantics when the host spells its PATH key `Path`.
The snapshot has canonical declared keys; do not replace this with a
case-sensitive lookup against an arbitrary spread of the Windows environment.
`invokeHarness` continues using the helper's default source.

Extend `ProbeOptions` with optional `env`, `cwd`, and `executablePath`.
`probeExecutor` forwards only supplied options; `executablePath` overrides
only argv[0], never `executor.probe.slice(1)`. An explicit override must be
absolute or throw a named error before spawn. Keep `ProbeResult` unchanged,
including its independent stdout and stderr. No options means the existing
inherited environment, inherited cwd, bare executable, and absence of a
timeout. Keep direct `shell: false` launch and existing timeout/non-zero/error
diagnostics.

Doctor builds one filtered map, captures `process.cwd()` as `probeCwd`, resolves
the fixed `CLAUDE_CODE.probe[0]`, then supplies that same map, cwd, absolute
path, and `timeoutMs: 5000` to `probeExecutor`. Preserve the existing invocation
cwd rather than changing executable search to the selected target's root.
`--repo` selects the inspected repository; it does not authorize a new
target-local executable search. Later stage worktree cwd values can differ,
which must remain a stated limitation.

Add `resolveDoctorExecutable` to the concrete diagnostics module, not to a
registry or platform-adapter interface. For the current bare `claude` name:

- On Windows, follow the native lookup ordering documented by libuv 1.52.1:
  current cwd when `NoDefaultCurrentDirectoryInExePath` is absent in the
  parent, then PATH entries in order; `.com` before `.exe`, case-insensitive
  filesystem lookup, and no `PATHEXT`-based `.cmd` or `.bat` execution.
- Resolve relative PATH entries against `probeCwd`; support spaces and quoted
  entries without invoking a shell. Windows entries are semicolon-delimited;
  preserve whitespace rather than trimming it as an unrecorded rewrite.
  A quoted entry may contain a semicolon. Skip empty Windows entries, matching
  native lookup, rather than inventing another cwd search.
- On POSIX, search PATH in order for the exact basename, requiring a regular
  executable file; empty PATH entries mean cwd, and quotes are literal.
  For missing PATH use `/usr/bin:/bin`, the Node-documented POSIX default;
  Windows uses the parent PATH fallback used by Node/libuv. Distinguish an
  absent PATH from a present empty string. Capture that parent fallback once
  with the lookup context, rather than rereading it between candidates.
- For a path-bearing command, resolve it against `probeCwd` without searching
  PATH; preserve native extension handling on Windows. Never expand shell
  aliases, tilde, or embedded environment-variable references.
- Return the absolute selected path and invoke that exact spelling. Do not
  run one candidate to discover another, substitute a later candidate after a
  launch failure, or report a separate `Get-Command`/`where` result as identity.
  Continue past missing candidates/directories and POSIX candidates lacking
  execute permission; remember a POSIX access denial and report `EACCES` if
  no later candidate succeeds, otherwise report `ENOENT`. Windows attribute
  lookup failures are skipped like native search; a selected file's launch
  failure never causes a second selection. If Windows selects a candidate
  but denies its launch, retain that path and report a failed probe even
  when a later PATH candidate can launch. Unexpected filesystem errors
  retain their named cause rather than becoming a successful empty path.
  At the readiness boundary, resolution failures use the same
  `probe failed for executor claude-code:` prefix as probe failures.

The implementation must bind native ordering expectations to the external
references and independent local child-process evidence below. Compare custom
resolution with an unmodified native bare-name spawn under the same captured
environment, cwd and Windows parent lookup controls. Supplying the resolver's
answer to the probe proves invocation identity, not native-search parity.
A readable selected file
is not proof it can launch: the existing `executor_probe` check reports actual
spawn/probe success or failure. The path identifies the selection for this
probe, not the origin, signature, supported installation, binary hash, or
identity of any later dispatch.

### Environment observations and privacy

Introduce one `AmbientProviderConfig` interface in
`src\doctor-diagnostics.ts`, with these fields:

| Field | Meaning |
| --- | --- |
| `environment` | Array of `{ name, present, passedToChild, valueHash }` for the exact union of passthrough names and the four observation names below, sorted by name. |
| `homeVariable` | `USERPROFILE` on Windows, `HOME` on POSIX; this is the documented user-home convention, not a precedence inference. |
| `files` | Exactly two `ConfigFileObservation` records, in the order given below, even when the home is unavailable. |

`present` means the captured value is not `undefined`; an empty variable is
still present. `passedToChild` means the named value is an own property of
the BuildWorks-supplied filtered map. This is not an exhaustive claim about
the eventual OS process environment: Windows libuv can add required system
variables. Do not enumerate or expose those extra ambient values.

The observation-only names are `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
`OPENAI_BASE_URL`, and `CLAUDE_CONFIG_DIR`. They are all excluded by the
current executor definition. Report their presence and delivery status, but
never their values or value hashes. `CLAUDE_CONFIG_DIR` is included because
Claude documents it as the user-config relocation variable; an excluded
parent setting must not redirect this collector into a different directory.

The explicit non-secret fingerprint allowlist is `PATH`, `HOME`,
`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, and `SystemRoot`.
Only present entries on this list receive `sha256Hex(value)`; all other
`valueHash` fields are `null`. Do not infer safety from membership in the
executor passthrough list, and do not add a credential-name heuristic.
Use full SHA-256 to match the existing helper. These are comparison hashes,
not anonymization; paths and environment digests can identify a workstation.
Absolute executable/config paths are intentionally visible. Raw environment
maps, file contents, parsed settings, credential values, and credential
value digests must never enter the new report or diagnostics.

Whole-file `contentHash` is intentionally distinct from hashing an extracted
credential value. Retain it for both documented user files, including
`.claude.json`, despite that file's possible sign-in and trust state. The
hash supports byte-change detection and confirmation against a candidate
file; it neither identifies the changed field nor anonymizes the report.
BuildWorks adds no persistence or transmission, but an operator can redirect
or share either output format. Treat paths, sizes and whole-file hashes as
sensitive local operational data before doing so. Never parse or hash
individual sign-in fields.

### Bounded user-file inventory

Claude's settings documentation identifies the following user-level files.
Introduce `ConfigFileObservation` with the same fields for every record:
`name`, `path: string | null`, `state`, `sizeBytes: number | null`,
`contentHash: string | null`, and `reason: string | null`.
`state` has the scalar values `readable`, `absent`, and `unavailable`; do not
create variant record schemas.

| Name | Path relative to the selected passed-through home |
| --- | --- |
| `user_settings` | `.claude\settings.json` |
| `user_state` | `.claude.json` |

Use platform-native joining. Resolve only a present, non-empty, absolute
home value from the filtered map. If it is unavailable, emit both records
with null paths/hashes and a named unavailable-home reason. Do not call
`os.homedir()` as a silent fallback into operator configuration.
Do not use APPDATA to invent another Claude settings location.

Introduce `DOCTOR_CONFIG_MAX_BYTES = 1024 * 1024` as a local diagnostic
read ceiling, not a new run policy or frozen-profile field. This derived
implementation limit bounds each of two observations to one MiB; make the
limit and oversized-file reason visible in documentation. It is unrelated to
the harness result limit even though the initial values match.

Read regular files only, with a read-only descriptor, a bounded read of at
most the ceiling plus one byte, and descriptor closure in `finally`.
Loop over short reads until EOF or the ceiling-plus-one sentinel is reached;
a single successful `readSync` is not proof that the complete file was read.
Inspect type before opening, use nonblocking read-open semantics where
available, and confirm regular-file type on the opened descriptor as well.
An absent file is `absent`, with null hash and no failure assertion. A
directory, special file, leaf symlink, dangling link, permission error,
oversized file, or failed read is `unavailable`, with null hash and an explicit
reason. Do not hash a prefix of an oversized or failed read. On a complete
read, hash the exact Buffer with `sha256Hex`, without JSON parsing, BOM
removal, or newline normalization. Record its byte length.
For absent files and unavailable paths, `sizeBytes` is null. For an unavailable
file whose regular-file size was successfully observed, retain that size.
Only `readable` carries a hash; readable/absent records have null reasons,
and every unavailable record has a non-empty reason. A bounded read must
reach EOF and its byte count must match the observed stable descriptor size
before it can produce a readable record.

Check descriptor metadata before and after the read; an observed size/time
change yields `unavailable`, not a stable-file claim. This is a best-effort
observation, not a filesystem snapshot or race-proof drift guard. Do not
recursively scan directories, inspect credential files/keychains, follow
config references, execute helpers from settings, or create missing parents.
Report filesystem error codes and paths, never configuration contents.
For filesystem failures, identify the failed operation, observed error code
when available, and affected path. For observation refusals, name the cause
(such as unavailable home, unsupported type, size ceiling, or detected
change). Keep reasons human-readable; assert the cause and applicable
code/path in tests rather than pinning an entire sentence.
Unexpected programming errors propagate; catch expected filesystem errors
only at the individual observation boundary.

The five-second bound remains the native version-probe timeout, not a new
whole-command SLA. Byte/file-count bounds do not bound all OS filesystem
latency. No remote config discovery or supported universal installation
inventory is promised.

### Projection and readiness policy

Add `ambientProviderConfig: AmbientProviderConfig` to `CurrentReadiness` and
three current executor fields: `resolvedPath: string | null`,
`probeCwd: string`, and `versionOutput: string | null`.
`versionOutput` is the trimmed non-empty stdout/stderr joined in their
existing order after a successful probe, not a parsed or invented semver.
Keep it null on failure or an empty successful response; preserve both streams
in the existing probe evidence. Retain a successfully resolved path even if
the subsequent probe fails, labelling it as the selected probe path.

Add exactly one `ambient_provider_config` check. Use `pass` when both file
observations are conclusive (`readable` or `absent`); use `not_checked` when
either is unavailable. Never use `fail` for this check, including when an
override is present or a file cannot be read. `repair` is null because these
are observations, not mandatory repair instructions. Its concise evidence
names present overrides and their exclusion/delivery, and summarizes each
file's state; complete records remain in `current`.

Keep `executor_probe` as the existing pass/fail readiness check, now with the
selected absolute path in its evidence. Resolution failure belongs to this
check, not a new policy check. Collect configuration observations even when
the probe fails.

Keep the existing limitations about provider authentication, model entitlement,
quota, and private-key availability. Add that the file inventory is limited
to the documented user locations; managed/project settings, OS home fallback,
actual file use under native flags, and effective precedence are not
established. State that this is current evidence, including under `--run`,
not frozen evidence or a pin for subsequent worktree dispatches.

No source edit is needed in `src\cli.ts` or `src\operator-output.ts`:
the doctor branch already carries `current` into `DoctorResult`, text lists all
checks and serializes `current`, and JSON serializes the whole envelope.
The non-gating check statuses preserve both no-selector and `--run` policy.
For `--run`, preserve canonical whole-executor comparison and never resolve,
execute, or collect configuration for an arbitrary retained executor.
Do not add these observations to `RunConfiguration`, `Profile`, approval
bytes, `agent_run`, or audit events.

## Acceptance criteria and task coverage

These are the executable acceptance criteria of this bootstrap plan, derived
from Candidate B and the assessment's explicit limitations.

| ID | Observable outcome | Tasks |
| --- | --- | --- |
| AC-001 | Doctor and invocation use the same named-variable filter; a non-passthrough canary is absent from both real children. | 1, 4, 5 |
| AC-002 | Low-level dispatch retains inherited bare-probe defaults and invocation behavior; its audit/envelope contracts are unchanged. | 1, 5 |
| AC-003 | Reported absolute path is the path actually supplied to the successful native probe and agrees with independent native bare-name selection under the same lookup context; competing PATH entries, cwd, spaces and platform rules are covered. | 2, 4, 5 |
| AC-004 | Probe arguments and both diagnostic streams survive; missing executable, non-zero exit and timeout remain named failures with no provider call. | 1, 2, 5 |
| AC-005 | All passthrough/observation names have truthful presence and supplied-map membership; excluded provider overrides remain excluded when set. | 3, 4, 5 |
| AC-006 | Only the explicit non-secret allowlist has value hashes; token/endpoint/config-dir values and file contents are absent from text and JSON. | 3, 5 |
| AC-007 | Exactly the two documented user files are observed from the filtered home; changing a file changes its exact-byte hash. | 3, 5 |
| AC-008 | Missing files, missing/invalid home, unreadable/special/linked/oversized files and observed concurrent modification have explicit, bounded, non-fabricated evidence. | 3, 5 |
| AC-009 | Overrides and unavailable config observations alone never change doctor readiness or exit code; actual probe failures retain existing gating. | 4, 5 |
| AC-010 | Text and JSON expose the same full current observations; JSON remains one existing operator envelope with one newline. | 4, 5 |
| AC-011 | `doctor --run` preserves frozen bytes and arbitrary-retained-probe refusal; current observations never replace frozen facts. | 4, 5 |
| AC-012 | Observation creates no state, lock, config or evidence files and changes no target/config bytes; tests never require paid dispatch or real operator secrets. | 3, 5 |
| AC-013 | Documentation states limits and privacy semantics, including the intentional whole-file user-state fingerprint and sensitive redirected/shared output, without claiming authenticated readiness, complete effective config, binary pinning or dashboard telemetry. | 6 |

## File map and verified dependents

All new symbols below are explicitly introduced by this plan. Existing-symbol
relationships were confirmed with repository searches, not inferred from names.

| File | Action and responsibility | Callers/dependents |
| --- | --- | --- |
| `src\harness.ts` | Modify: extract `buildHarnessEnvironment`; opt-in `ProbeOptions`; retain `ProbeResult`. | `src\readiness.ts` and `src\dispatch.ts` call the probe; dispatch alone calls invocation. |
| `src\doctor-diagnostics.ts` | Create: concrete native resolution, environment metadata, bounded file observations and their interfaces/limit. | New import from `src\readiness.ts`; direct diagnostic tests. |
| `src\readiness.ts` | Modify `CurrentReadiness` and `inspectReadiness`; leave `checkIntakeRepository` unchanged. | `src\cli.ts` doctor branch; `DoctorResult`; direct CLI readiness tests. |
| `test\harness.test.ts` | Modify: real-child environment/options and unchanged-default evidence. | Uses `testExecutor`, existing probe cases and `test\fixtures\harness\echo-env.mjs`. |
| `test\doctor-diagnostics.test.ts` | Create: native resolution, metadata/redaction and bounded file tests. | Node runner includes the new `.test.ts` file automatically. |
| `test\cli-operator.test.ts` | Modify: `doctorFixture`, `fixtureProbe`, direct readiness cases and current/frozen CLI tests. | Shared fixture feeds approval, guided-run and README PowerShell tests in this file; preserve those contracts. |
| `README.md` | Modify only Inspect without spending and doctor JSON explanation. | Executable inspection fence is covered by the Windows README test; keep its existing command sequence. |
| `docs\runbooks\cli-operator.md` | Modify doctor description in section 4 and the `Inspection and support reference` section. | Operator-facing explanation of the same CLI, not another workflow; section 8 concerns delivered artifacts, not doctor setup. |

Read-only regression boundaries:

- `src\dispatch.ts` calls the unchanged-default probe, then invocation.
  Its production callers are `src\cli.ts`, `src\spec-stage.ts`,
  `src\plan-stage.ts`, `src\implementation-stage.ts`, and
  `src\code-review-stage.ts`; all benefit from behavior-preserving environment
  extraction and receive no new resolution or telemetry code.
- Other harness importers use unchanged symbols: `src\policy.ts` imports size
  constants, and `src\verify-command.ts` imports `killTree`. Do not change
  verification-command environment or shell semantics.
- `src\operator-output.ts` carries `CurrentReadiness` in `DoctorResult`;
  `formatOperatorResult` already projects additions. Its other consumers
  include `src\run-command.ts`, `test\operator-state.test.ts`, and
  `test\run-command.test.ts`; there is no renderer redesign here.
- `src\profile.ts` freezes the whole `CLAUDE_CODE` definition and compares
  canonical executor JSON in `requireFrozenBinding`. Keep both that
  definition and the serialized profile shape unchanged. `src\canonical.ts`
  already exports `sha256Hex` for strings and bytes; reuse it unchanged.

## Tasks

### Task 1: Share environment construction without changing dispatch defaults

**Depends on:** None.

**Files:** Modify `src\harness.ts` and `test\harness.test.ts`.
Validate `test\dispatch.test.ts` and the existing echo-env fixture.

**Steps:**

- Add regression cases for the current named filter, defined empty values,
  immutable source/executor inputs, stdout/stderr preservation, and the
  absence of env/cwd/timeout overrides when options are omitted.
- Extract `buildHarnessEnvironment` and use it in `invokeHarness`; add
  `ProbeOptions.env`, `.cwd`, and `.executablePath` exactly as specified.
  Assert a relative explicit override refuses before any spawn.
- Run a probe using `process.execPath` and the existing echo-env fixture,
  then an invocation using the same definition/map and cwd. Assert actual
  child values for named inputs and absence of a synthetic excluded canary,
  not whole-environment equality on Windows. Keep the real stdout/stderr
  comparison against the direct Node child.

**Verify:** `node --test test\harness.test.ts test\dispatch.test.ts`
and `npm run typecheck`.

**Expected:** Existing transport/timeout/envelope/audit cases pass; explicit
probe options reach the native child; default dispatch probe options remain
absent. New environment construction does not change frozen definitions.

**Task completion evidence:** Test output and the exact captured spawn
options/real-child assertions for AC-001, AC-002 and AC-004.

### Task 2: Resolve and exercise one absolute native probe selection

**Depends on:** Task 1.

**Files:** Create `src\doctor-diagnostics.ts` and
`test\doctor-diagnostics.test.ts`.

**Steps:**

- Implement `resolveDoctorExecutable` with the platform rules above and
  explicit named resolution errors. Capture the parent cwd-search control
  separately on Windows; do not add it to the child passthrough declaration.
- In owned scratch directories, copy `process.execPath` under native
  executable names and exercise the resolver plus direct probe using that
  actual file. Copying the installed native runtime is test setup, not
  synthesizing provider output. Keep fixture creation outside the measured
  no-write window and clean only each owned scratch directory.
- Cover first/second PATH candidates, reordered PATH, a target-local decoy
  that must not override the invocation cwd, spaces, relative PATH entries,
  missing/empty PATH, missing binaries, directories and non-executables.
  On Windows cover `.com`/`.exe` ordering, mixed case, quoted paths, a
  `.cmd`-only candidate and `NoDefaultCurrentDirectoryInExePath`; on POSIX
  cover a denied first candidate followed by an executable candidate,
  denial with no usable later candidate, and empty PATH entries. Assert the selection
  and actual spawn command together, not a version string shared by copies.
- Add differential cases using unmocked `spawnSync` with the bare fixture
  name, `shell: false`, and the same captured environment/cwd as the resolver.
  Hold the Windows parent cwd-search control and missing-PATH fallback equal
  for both paths. Have the copied Node child report `process.execPath` and
  compare the selected file identity with the resolver result; do not pass
  the resolved absolute path to this independent spawn or intercept its
  command. Account for native path casing/normalization without equating
  different copies merely because their version or content hash matches.
  Exercise the competing PATH, cwd, relative/quoted-path and missing/denied
  candidate cases above on their applicable platforms. Compare native
  failure behavior as well as successful identities; a selected Windows
  candidate that fails to launch must not trigger a fallback.

**Verify:** `node --test test\doctor-diagnostics.test.ts test\harness.test.ts`
and `npm run typecheck`.

**Expected:** The absolute selection is the actual probe command and agrees
with independent native selection under the same lookup context; argv and
five-second caller timeout remain intact. Unsupported shim-only installation
is a named failure, not a shell fallback. Record platform-specific coverage
as executed or unexecuted; a Windows-only result is not POSIX certification.

**Task completion evidence:** Paired resolver/native-child identities or
failure observations, captured lookup contexts and source-grounded ordering
assertions for AC-003 and AC-004.

### Task 3: Collect bounded, privacy-limited ambient observations

**Depends on:** Task 1 and the diagnostics module from Task 2.

**Files:** Modify `src\doctor-diagnostics.ts` and
`test\doctor-diagnostics.test.ts`; reuse `src\canonical.ts`.

**Steps:**

- Implement `AmbientProviderConfig`, `ConfigFileObservation`, the fixed
  allowlists and `DOCTOR_CONFIG_MAX_BYTES`. Add
  `collectAmbientProviderConfig` consuming the executor, canonical named
  ambient snapshot and the already-built child map; it must not rebuild
  environment values from live host state during collection.
- Implement the two-file observation contract. Exercise readable empty and
  non-empty files, missing files, invalid/missing home, directories, leaf
  links, denied reads, oversize and detected modification. Use a mocked
  narrow filesystem operation to inject `EACCES`/read failures rather than
  depending on the current user's privileges. Inject successful short reads
  as well and prove the entire file, not the first chunk, is hashed. Cover
  the exact byte ceiling, one byte over it, and EOF/count mismatch. Restore
  builtin mocks with the existing `syncBuiltinESMExports` pattern.
- Toggle each of the three provider overrides and the config-directory
  override independently using synthetic values. Assert presence changes,
  delivery stays false under `CLAUDE_CODE`, no value/hash appears, and the
  excluded config directory is never read. Add a credential-like name to a
  cloned test executor's passthrough list and prove it gains presence/
  delivery metadata but no hash. Never mutate the shared constant.
- Change exact bytes in a controlled user file and compare to
  `sha256Hex(readFileSync(fixturePath))`; include CRLF/BOM differences so
  normalization cannot pass as an exact-byte fingerprint. Use the published
  empty digest already covered by `test\canonical.test.ts` as external hash
  evidence. Cover both `user_settings` and `user_state`, including a same-size
  byte change, without real operator secrets. Assert per-file byte ceilings,
  no prefix digest on refusal, and cause-specific unavailable reasons.

**Verify:** `node --test test\doctor-diagnostics.test.ts test\canonical.test.ts`
and `npm run typecheck`.

**Expected:** Complete typed records follow the settled contract; unavailable
evidence is explicit and no secret/plaintext config data escapes. Owned home
and config bytes are unchanged except for the deliberately controlled edits
between observations.

**Task completion evidence:** AC-005 through AC-008 and the collector's
AC-012 file-preservation assertions.

### Task 4: Wire the doctor projection without adding a gate

**Depends on:** Tasks 1-3.

**Files:** Modify `src\readiness.ts` and `test\cli-operator.test.ts`.
Validate `src\cli.ts` and `src\operator-output.ts` unchanged.

**Steps:**

- Before changing shared fixtures, inventory references to `doctorFixture`,
  `doctorRun`, `fixtureProbe`, `journeyFixture`, `CLAUDE_CODE.probe`,
  `doctor.command` and `doctor.invoke` throughout `test\cli-operator.test.ts`.
  Trace their wrappers and direct subprocess callers against the new
  environment/absolute-path contract, including README and journey bypasses.
  Derive this inventory from the file at execution time; do not pin today's
  call counts or treat a matching count as proof of isolation.
- Adapt `doctorFixture` and `fixtureProbe` before enabling absolute-path
  resolution. Give each doctor fixture an owned native executable copy
  named `claude.exe` on Windows or `claude` on POSIX, prepend its directory
  to the fixture PATH, and set fixture HOME/USERPROFILE explicitly.
  Leave the production `CLAUDE_CODE` object unchanged. Retain a sentinel
  against model dispatch that recognizes both bare and absolute Claude
  spellings. Preload code must never intercept every command indiscriminately.
- Preserve `doctorFixture`'s external public-key override, input/timeout
  forwarding, separate invocation/target cwd, and CLI JSON transport.
  Return its owned environment map as `doctor.environment` and use it both
  in its `invoke` helper and in the callers that bypass that helper: the
  README PowerShell subprocess and `journeyFixture`. Apply their existing
  NODE_OPTIONS/key/Git overrides afterward, retaining the journey's GitHub
  credential stripping and sentinel. Merely changing `invoke` would leave
  those two paths resolving a host binary and reading real operator homes.
  Direct `fixtureProbe` uses owned environment values and records the real
  forwarded probe options rather than dropping env/cwd/timeout as it does
  today. Restore every changed environment variable and builtin in `finally`.
  The unavailable-tools test currently intercepts only bare `claude`:
  supply an owned empty search path/cwd for that case so resolution itself
  returns the expected prefixed `ENOENT` instead of probing a host install.
- Snapshot the canonical named environment and cwd at entry, build the child
  map once, collect ambient metadata, resolve and run the existing probe with
  the explicit options. Populate the new fields on every outcome, including
  probe failure. Generate one non-gating ambient check and precise limitations.
- Update the test named "readiness and real dispatch share direct probe
  executable and argv": doctor now supplies the selected absolute path and
  filtered map; dispatch still supplies the bare configured name and no
  env/cwd/timeout overrides. Both retain exactly the configured probe args
  and `shell: false`. Assert this intentional difference explicitly.

**Verify:** `node --test test\harness.test.ts test\doctor-diagnostics.test.ts test\dispatch.test.ts test\cli-operator.test.ts`
and `npm run typecheck`.

**Expected:** Both current and `--run` doctor projections carry complete
observations; existing renderer and readiness aggregation require no source
change. Shared fixture users, including README/approval/guided-run tests,
remain functional.

**Task completion evidence:** AC-001 through AC-005 and AC-009 through
AC-011 at the CLI boundary, including unchanged legacy-probe defaults.

### Task 5: Prove the no-spend, no-write and current/frozen boundaries

**Depends on:** Task 4.

**Files:** Modify the three affected test files as needed; validate
`test\dispatch.test.ts` and `test\profile.test.ts` without redesigning them.

**Steps:**

- Exercise doctor with no selector, `--slug`, and `--run`, in text and JSON.
  Assert the full environment name set, both file records, identity fields,
  check states and unchanged operator-envelope keys/newline behavior.
  Add independent cases with present overrides and unavailable config
  evidence: an otherwise ready report must remain ready with exit 0.
- For current/frozen separation, take the existing verified-profile fixture,
  record its bytes/hash, change only owned ambient/config inputs, and observe
  changed `current` data with unchanged `frozen`, profile bytes and
  `run.profile_ref`. Preserve the arbitrary retained-probe canary case,
  invalid-profile cases, approval pause, and continuing-run dirty-tree case.
  Do not populate new observations from a retained executor.
- Snapshot the existing `inventory` output for target, key and owned home
  before and after doctor, including the Git index and any existing state/
  lock. On a target without governance state assert that none is created.
  Keep unrelated synthetic secret canaries out of stdout/stderr and all new
  fields. Assert no model spawn, signing, repair, migration or GitHub call.
- In a disposable source mirror outside `node_modules`, mutate one guard at
  a time: leak the canary through the filter, hash an override value, select
  a different path than the probe executes, reverse resolver candidate
  precedence while keeping its absolute probe consistent with that wrong
  selection, accept an oversized prefix hash,
  make unavailable config a failure gate, or execute the retained probe.
  Run the smallest relevant named cases, record the expected failing
  assertion, restore only that mutation, and rerun. Do not mutate live
  source/config or use whole-file reverts in the working checkout.

**Verify:** `node --test test\harness.test.ts test\doctor-diagnostics.test.ts test\dispatch.test.ts test\cli-operator.test.ts test\profile.test.ts`
and `npm run typecheck`.

**Expected:** All 12 behavioral criteria have direct evidence, guards fail
under their corresponding mutation, and restorations return to green.
Use one runner invocation for related selectors; expand to `npm test` only
if focused results expose dependencies beyond these suites. No paid run
is substituted for missing privacy or native-selection assertions.

**Task completion evidence:** Retained targeted results, mutation/restoration
records, unchanged inventory/profile evidence and named platform limitations.

### Task 6: Publish the exact operator contract and close implementation

**Depends on:** Task 5.

**Files:** Modify `README.md` and `docs\runbooks\cli-operator.md`.
Update this plan's lifecycle only when implementation has actually completed.

**Steps:**

- Explain filtered doctor probing, invocation cwd versus target selection,
  selected executable/version output, the new current fields, the two-file
  inventory and one-MiB read ceiling. Explain why provider overrides can be
  present but not supplied, why unavailable config evidence is not a gate,
  and why hashes/absolute paths should be treated as local operational data.
  State that the whole-file hash intentionally covers `user_state` despite
  possible sign-in/trust state, reveals byte changes rather than their
  meaning, and remains sensitive when operators redirect or share output.
  In the runbook, edit section 4 and `Inspection and support reference`;
  do not insert setup diagnostics into section 8's delivery inspection.
- Preserve authentication/entitlement/quota/private-key limitations and add
  the explicit precedence, incomplete inventory, OS-added environment,
  current/frozen and later-dispatch limitations. Explain that version output
  establishes neither a supported installation nor provider readiness.
  Keep the existing inspection PowerShell fence and approval workflow intact.
- Record implementation evidence and remaining unexecuted platform cases
  through the repository's existing task/session workflow; do not create
  `tasks.md`, change architecture ordering, modify historical reviews or
  claim this feature implements MHA-07 in full. Mark the plan `Implemented`
  only after the task evidence and required implementation review are complete.

**Verify:** `npm run check:docs`, `npm run typecheck`, and
`node --test --test-name-pattern="Task 9 README inspection" test\cli-operator.test.ts`
on Windows.

**Expected:** Current operator docs describe only delivered behavior,
documentation checks have no errors, and the existing README command fence
still operates against its separate owned target.

**Task completion evidence:** AC-013, implementation review disposition,
and the completed evidence record for Tasks 1-5. No commit or publication is
part of this plan unless separately requested.

## Rollback and completion boundaries

Component success means the environment filter, native selection, and file
collector satisfy their contracts. End-to-end success means the actual CLI
projects those observations without a readiness-policy, write, spend, or
frozen-state regression. Passing collector tests alone is not completion.

There is no migration or persistent diagnostic state to roll back. If the
feature is withdrawn, reverse only its source/test/doc changes and preserve
existing runs, keys, user settings and the prior session-record conversion.
No target cleanup, profile rewriting or provider invocation is a rollback step.
Changing a real operator's home, config, PATH or credentials is not a test plan.

The assessment's estimate remains 14-22 focused engineering hours, roughly
2-3 working days for a familiar developer, including review. It is an estimate,
not a completion promise. Native lookup coverage and test-fixture isolation
are the main implementation risks; a universal config inventory or extra
harness would require a different plan and estimate.

## External contract evidence

Consulted 2026-09-11; these are contract references, not observations of this
operator's configuration or a paid Claude process:

- [Claude settings and user locations](https://code.claude.com/docs/en/settings#find-or-create-your-settings-files):
  user settings under `.claude`, Windows USERPROFILE convention,
  `CLAUDE_CONFIG_DIR` relocation, and the separate `.claude.json` user file.
  The latter can contain sign-in state: hash bounded raw bytes only, never
  parse or expose its contents. Project/managed precedence is not inventory.
- [libuv 1.52.1 Windows process lookup](https://github.com/libuv/libuv/blob/v1.52.1/src/win/process.c):
  `search_path`, `path_search_walk_ext`, required system environment handling,
  and native current-directory/PATH/extension behavior. This matches the
  measured local libuv version; supported Node versions still need their
  platform-specific regression cases rather than a version discriminator.
- [Node 24 child process contract](https://github.com/nodejs/node/blob/v24.0.0/doc/api/child_process.md):
  explicit environment/cwd options, direct spawn semantics and probe failure
  behavior, missing-PATH fallback, and Windows environment key handling.
  Resolve using native behavior, not shell command discovery.

## Planning record

Requested outcome: an executable plan from the Candidate B effort assessment.
Approach: the full path, one coherent diagnostics feature, no implementation.
Success criterion: all source obligations mapped to concrete tasks, explicit
contract choices, evidenced dependents and one reconciled self-review.
Material decisions are the settled contract above; no new operator decision
or provider spend was inferred from prior runs.

Changes in this planning request are limited to this plan. The earlier
Markdown conversion is preserved. No application, governed state, key,
configuration, architecture or historical-review file has been modified.
Rollback status: no implementation exists to roll back.

Single self-review: one complete pass over the saved draft and its primary
sources; four material findings reconciled inline, with no blocking finding
left unresolved.

| Finding | Risk | Disposition |
| --- | --- | --- |
| Native lookup failure/default handling was underspecified. | A denied early PATH candidate could mask a usable later executable, or missing PATH could select a guessed fallback. | Specified the POSIX default, candidate error behavior, captured Windows fallback and readiness error prefix; extended Task 2 cases. |
| A bounded read did not explicitly require complete-file evidence. | A short read could be reported as a complete fingerprint, and unavailable records had ambiguous size/reason fields. | Required EOF/count agreement, explicit nullable-field rules, and short-read/boundary tests in Task 3. |
| Shared fixture isolation did not cover bypass callers. | README/journey subprocesses could resolve a host binary or inspect the operator's actual home despite an isolated invoke helper. | Threaded `doctor.environment` into the two observed direct callers and isolated the unavailable-tools case in Task 4. |
| The runbook file map targeted section 8 incorrectly. | An executor could update delivery inspection instead of the doctor support contract. | Corrected the file map and Task 6 to section 4 and `Inspection and support reference`. |

Planning completion evidence: `npm run check:docs` and `npm run typecheck`
passed. An in-memory structural check accounted for 30 repository-path
references, six tasks and 13 acceptance criteria, with no prohibited
placeholders or task checkboxes. These are planning checks, not executed
feature tests. Result: plan complete, still Proposed and unimplemented;
runtime acceptance and platform evidence remain the implementation tasks.

## Implementation completion (2026-09-11)

The operator's explicit `implement-plan` request supersedes the planning-only
authorization recorded above. All six tasks are complete. Doctor now reports
its filtered native probe context and absolute selection, allowlisted environment
metadata, and two bounded exact-byte user-file observations. Both output formats
retain complete current data without changing frozen definitions, dispatch
defaults, readiness policy, schemas, or stages. README and runbook explain the
delivered limits and the settled whole-file fingerprint tradeoff.

The separate implementation review, `2026-09-11-code-review.md`, is reconciled:
one confirmed Medium native Windows normalization defect was accepted, fixed,
and independently re-reviewed; no finding remains open. The correction queries
attributes with native normalization while preserving the selected/probed
spelling. This is an AC-003 correction, not a scope or policy expansion.

The prescribed five-suite boundary run passed 203 tests with four expected
platform skips. All seven prescribed isolated guard mutations failed their
intended assertions and passed byte-exact restoration. After the review fix,
diagnostics/harness passed 52 tests with four skips, the three ambient CLI cases
passed, and an eighth isolated mutation proved the normalization regression.
Typecheck, documentation checks, and the Windows README inspection case passed.
Detailed task evidence is retained in
`.claude\sessions\2026-09-11-doctor-ambient-config-implementation.txt`; execution
state belongs to the session's task rows, not this task list.

No material scope deviation or production rollback occurred. POSIX execution,
privileged Windows file-symlink creation, actual ACL launch denial, UNC, and
explicit DOS-device input execution remain unverified; they are not implied by
the Windows evidence. The optional interface example and duplication-driven
formatting helper remain deferred. No paid run, signing, publication, checkout
commit, operator-configuration change, or broader MHA-07 implementation occurred.
