# Multi-harness adapter blast-radius review

**Review date:** 2026-09-03

**Decision under review:** Add Codex as the second real BuildWorks harness and
leave a sound expansion point for an unknown number of later harnesses.

## Executive conclusion

Adding Codex is the correct moment to generalize the current Claude integration:
Codex is now the second real implementation that `ARCHITECTURE.md` hard rule 4
requires before an interface may be extracted. It is not a small adapter-only
change, though. The current code has a reusable process supervisor and normalized
`HarnessEnvelope`, but run intake, agent binding, prompt examples, output parsing,
containment, tests, and the paid-run driver still encode Claude assumptions.

The recommended scope is **one selected harness for the whole run**. That fits the
existing frozen `Profile.executor`, approval profile hash, stage APIs, and
`agent_run.executor` column. It should require no database migration and no
change to the stage sequence, findings model, approval payload shape,
verification, or delivery gate.

Do **not** register placeholder harnesses. Register Codex only after its real
invocation, output, authentication, containment, and telemetry contracts have
been captured. Later harnesses should enter the same static registry one at a
time after equivalent evidence exists. Empty or guessed entries would violate
hard rules 4 and 5, create configurations that cannot complete a run, and make
capability declarations decorative.

Overall assessment:

| Dimension | Assessment |
|---|---|
| Breadth of code change | Medium-high |
| Security and evidence risk | High |
| Database migration risk | Low for one harness per run |
| Existing stage/gate logic | Mostly reusable |
| First two-harness delivery | 18-30 engineering days |
| Five later, conforming CLI harnesses | 15-35 additional engineering days |
| Five later harnesses with mixed contracts | More plausibly 30-60+ additional days |

The first implementation gate is managerial, not technical. The milestone in
section 23 has been reached, but the binding build order still puts a second
harness after the deferred stages, dashboard, and notifications. If Codex is now
the priority, that order and section 11's one-adapter wording need an explicit,
reconciled architecture amendment before code is changed.

## Scope and evidence reviewed

This review examined the current working tree, not only `HEAD`. Unrelated
in-progress task-document guard changes were present and were left untouched.

Primary project evidence:

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md), especially sections 2, 3, 6,
  9-11, 15, 17, and 20-24.
- [`docs/hazards.md`](../hazards.md), especially hazards 1-4, 7-12, 14, and 15.
- [`CLAUDE.md`](../../CLAUDE.md),
  [project learnings](../../.claude/sessions/project-learnings.md), and the
  [documentation checker instructions](../../.claude/skills/doc-check/SKILL.md).
- The shipped [harness-adapter plan](../features/harness-adapter/plan.md) and
  [its plan review](../features/harness-adapter/2026-08-29-plan-review.md).
- The current executor, process runner, dispatch, frozen profile, agent
  registry, prompt builders, stage orchestrators, store schema, scope guards,
  tests, fixtures, and paid-run driver.
- The local Codex CLI and the
  [official Codex command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli).

Local inspection found `codex-cli 0.151.0-alpha.7.2`, resolved from the installed
VS Code extension. Its `exec` command can read the prompt from stdin, accepts a
per-invocation model, provides `--sandbox read-only`, `--ephemeral`,
`--ignore-user-config`, and `--ignore-rules`, and emits JSONL events with
`--json`. It can also write the final assistant message separately and validate
it against a supplied JSON Schema. No paid Codex invocation was made for this
review, so its real event envelope, token fields, effective-model evidence,
cost reporting, authentication environment, and containment behavior remain
unverified.

Repository footprint observations:

- 10 production files contain an explicit Claude command, constant, executor
  ID, or Claude-specific comment.
- 15 test or fixture files contain an explicit Claude executor assumption.
- Including the provider-neutral-looking modules that actually construct,
  dispatch, bind, validate, select, and protect an executor, at least 20
  production files participate in the blast radius.
- Six source agent definitions bind to `claude-code`; nine result examples in
  `src/prompts.ts` return `"executor": "claude-code"`.
- Historical feature plans and reviews also name Claude. They are evidence of
  the past and must not be rewritten merely to make them look current.

## Severity-ranked findings

| ID | Severity | Finding | Required disposition |
|---|---|---|---|
| MHA-01 | Critical | Current binding architecture does not authorize reprioritizing a second harness ahead of the remaining step-10 work. | Reconcile and amend sections 11 and 23 before implementation. |
| MHA-02 | Critical | Codex containment is not proven equivalent to the current Claude read-only tool boundary. | Prove an empty command/tool allowlist and customization isolation, add an external enforcement layer, or reject the adapter under the current architecture. |
| MHA-03 | High | Invocation construction and envelope parsing are Claude-shaped despite generic names. | Give each real adapter ownership of argv construction and raw-envelope parsing into one normalized result. |
| MHA-04 | High | Frozen configuration and every seeded agent are bound to the Claude constant. | Select the real adapter before run creation and bind the frozen agents to that run's selected executor. |
| MHA-05 | High | Prompt and result identity can disagree with the executor and role that actually ran. | Interpolate the frozen executor and validate agent, role, and executor against the dispatch before accepting output. |
| MHA-06 | High | The current in-memory output cap is unsuitable for event-stream harnesses and does not implement the architecture's separate evidence-retention ceiling. | Stream raw output to bounded evidence while separately bounding the parseable result. |
| MHA-07 | High | The executable probe happens at dispatch, uses a different environment from invocation, and does not prevent creation of an unusable run. | Probe the selected adapter with the actual filtered spawn environment before inserting the run. |
| MHA-08 | Medium | Codex telemetry and cost capabilities are unknown. | Declare only measured fields; persist unavailable values as `null`, never zero or model self-report. |
| MHA-09 | Medium | Splitting adapters into new modules can move protected executor policy outside the current protected-path list. | Protect the whole committed adapter/registry control plane at the write gate. |
| MHA-10 | Medium | The test fixtures, current-state docs, and paid-run tool assume Claude. | Add adapter conformance tests and explicit harness selection to operations; preserve historical documents. |
| MHA-11 | Medium | The Codex binary found locally is extension-managed and alpha-labelled, not evidence of a portable installation contract. | Test a supported standalone installation and record probe/version evidence on Windows and the supported CI platform. |

## Detailed findings

### MHA-01 — architecture sequencing needs a human decision

Hard rule 1 prohibited a second harness until one complete run with queryable
cost. The 2026-09-03 paid run recorded in project learnings satisfies that
condition. Section 23 is more specific, however: after the milestone it orders
the deferred stages, then a dashboard, then notifications, and only then—if
ever—a second harness. Those intermediate items have not been built.

This does not mean Codex is technically premature. It means the management
priority has changed and the binding design must say so. Implementing first and
updating the architecture afterward would invert this project's governance
model.

The amendment should preserve these limits:

- one CLI surface;
- one selected harness per run;
- a static registry of real, shipped adapters rather than a plugin system;
- one normalized internal result schema;
- no versioned adapter IDs or compatibility layer;
- no per-stage or per-reviewer harness routing in this feature.

### MHA-02 — Codex read-only mode is not yet the required trust boundary

The Claude definition in `src/executor.ts` does more than request read-only
behavior. Its fixed command removes write and command tools, fixes the available
file tools to `Read,Glob,Grep`, disables MCP, disables customizations, runs
non-interactively, and avoids session persistence. The stages then verify a
clean worktree around proposal dispatches. That combination is the response to
hazard 15.

Codex offers a read-only sandbox, but its own help describes that option as the
policy for model-generated shell commands. Read-only therefore does not, by
itself, prove the architecture's empty command allowlist. The inspected CLI also
shows no direct command-line equivalent to Claude's fixed tool inventory,
strictly empty MCP configuration, or safe mode. `--ignore-user-config` only
promises not to load the user config file, and `--ignore-rules` concerns
execution-policy rule files; neither is evidence that project instructions,
hooks, skills, plugins, MCP servers, or network-capable tools are absent.

Before registration, a Codex discovery run must attempt, not merely avoid:

- a write inside and outside the worktree;
- a shell command when the declared allowlist is empty;
- a read of `.governance/` and unrelated parent paths;
- MCP, web, or network use beyond the provider connection;
- influence from user and project configuration, agent instruction files,
  hooks, and installed extensions;
- session persistence after the process exits.

A compliant sample is insufficient; the negative attempts are the evidence.
If current Codex cannot enforce the existing boundary, management has two honest
choices: add a caller-controlled containment wrapper that does, or amend the
architecture to state the weaker guarantee and accept it. Merely copying the
current `sandbox` declaration onto a Codex definition would make that field
decorative, contrary to section 9's binding rule.

### MHA-03 — the actual adapter seam is argv plus parsing

`src/harness.ts` already provides useful shared mechanics: filtered environment,
stdin, process-tree termination, idle and absolute timeouts, cwd selection, and
captured stdout/stderr. Those mechanics should stay shared.

Two behaviors cannot stay generic as written:

- `invokeHarness` appends `--model` to a static command array. Claude accepts
  that construction. Codex needs an `exec` subcommand and a deliberate stdin
  form; dynamic flags must be placed before any positional `-`. Future CLIs may
  spell model and noninteractive flags differently.
- `parseEnvelope` calls `JSON.parse` once and interprets Claude fields such as
  `result`, `total_cost_usd`, `usage`, and `modelUsage`. Codex `--json` emits a
  JSONL event stream, so every Codex dispatch would fail envelope parsing even
  if the model returned a perfect `AgentResult`.

The runtime abstraction should therefore be narrow:

```text
HarnessAdapter
  id
  serializable definition to freeze
  build invocation from frozen definition + prompt/model/cwd
  parse retained raw bytes -> HarnessEnvelope
```

The static registry resolves the runtime behavior by the frozen executor ID.
`dispatchOnce` should not grow a series of executor-ID conditionals. Vendor raw
formats remain adapter-private; `HarnessEnvelope` remains the one normalized
schema consumed by the store and stages. This is an adapter boundary, not a
plugin system and not a persisted union of vendor envelopes.

### MHA-04 — run intake and agent binding must become executor-aware

`freezeProfile` currently imports `CLAUDE_CODE`, checks staffing against its ID,
and always serializes that definition. Every source agent is also permanently
bound to `claude-code`, while the review stages filter eligible reviewers by
that binding. Adding a Codex constant alone would either still create a Claude
run or cause Codex stages to refuse because no author or reviewer is bound to
the frozen executor.

For one harness per run, the lowest-blast repair is:

1. Resolve an explicitly selected registered adapter before a run row exists.
2. Validate its capabilities for every dispatching stage and prove the reviewer
   panel can be staffed before any state or spend exists.
3. Freeze its serializable executor definition in the existing profile field.
4. Freeze the logical agent definitions as effective run bindings carrying the
   selected executor ID.
5. On resume, resolve runtime behavior from the frozen ID and use the frozen
   command, sandbox, limits, capabilities, and telemetry declarations.
6. Refuse an unknown or unavailable frozen adapter before spawn while keeping
   the run, audit, profile, and retained evidence readable.

This avoids duplicating six agent files for every harness. Source agents express
roles, specialties, outputs, and tools; the frozen profile records their
effective executor binding for that run. Section 9 should be amended to make the
distinction explicit rather than silently changing what its `executor` field
means.

The existing persisted profile and `agent_run` shapes can support this. The
approval already signs the profile hash, so changing the selected executor
changes what the human authorizes without adding an approval column.

### MHA-05 — output identity needs to be checked, not prompted only

All nine `AgentResult` examples in `src/prompts.ts` instruct the model to return
`"executor": "claude-code"`. `validateAgentResult` checks that `agent` equals
the dispatched agent, but it only checks that `executor` is non-empty and that
`role` is one of two allowed values. It does not compare either field with the
actual dispatch. The raw `bw dispatch` surface likewise checks that the agent
exists, but does not prove its configured role matches the requested role.

With Codex this becomes immediately reachable: a genuine Codex process can be
stored as `agent_run.executor = codex` while its accepted model-authored body
claims `claude-code`. That makes the typed result and the system evidence
disagree.

Prompt examples should use the frozen effective binding, and the validation
boundary should accept an expected identity containing agent, role, and
executor. The CLI should validate the frozen agent's role and allowed output
before spawn. The database value must continue to come from the system's
selected adapter, never from model text.

### MHA-06 — JSONL requires a real streaming/evidence boundary

The current runner accumulates stdout in memory, keeps at most the one-megabyte
result limit, kills the process on overflow, and accumulates stderr without a
corresponding byte limit. `dispatchOnce` writes those captured bytes only after
the child returns. This is workable for the measured Claude envelope, but Codex
JSONL can contain progress and tool events in addition to the final response.

Section 20 requires two distinct limits: a parseable result cap and a separate,
larger raw-evidence retention ceiling. Hazard 2 requires rejected output to stay
diagnosable. The multi-harness work should stream stdout and stderr to the raw
evidence sink as they arrive, enforce a bounded retention ceiling, and give the
adapter a bounded result view or final-message extraction. On breach, the run
must retain what was allowed, kill the whole tree, audit the exact reason, and
refuse rather than silently truncate.

Codex's final-message file option may help separate the result from JSONL
telemetry, but it is not automatically the best design: it creates another
caller-managed artifact and does not remove the need to retain the event stream.
The discovery fixture should decide whether event parsing or the separate final
message is the smaller, better-evidenced contract.

### MHA-07 — probe and invocation currently test different environments

The architecture requires a probe before any run in the environment that will
actually spawn the harness. Today `new-run` does not probe. `dispatchOnce` probes
immediately before each invocation, and `probeExecutor` inherits the parent
environment while `invokeHarness` constructs a named-variable environment.
A probe can therefore succeed with configuration or credentials the real child
does not receive.

This matters more for Codex because authentication and configuration are tied to
its home/config location. The local probe also warned that it could not find a
home directory, even though it could print a version. The selected adapter's
probe should run once during intake, before the run row, with the same shell,
cwd policy, executable resolution, and filtered environment as the real
invocation. Authentication readiness may require a separate non-spending check;
if the CLI cannot provide one, that limitation should be explicit rather than
simulated by `--version`.

### MHA-08 — telemetry must be measured per adapter

The state model is already correct for heterogeneous telemetry: effective model,
fallback, tokens, cache counts, and cost are nullable. The risk is declaring a
Codex capability based on documentation or model output rather than a retained
real event stream.

The Codex adapter should report only fields shown by recorded harness-owned
events. If cost or fallback is absent, its declaration is false and the stored
value is `null`. Management reporting must distinguish “not reported” from zero
cost. If queryable cost is a requirement for every supported harness rather than
only for BuildWorks overall, that becomes an adapter admission criterion and
should be stated before work begins.

### MHA-09 — adapter code is protected control-plane content

`src/scope.ts` protects the single current executor file by exact path. A normal
multi-adapter layout will likely move definitions and runtime registration into
multiple files. Unless the protected prefix moves with them, an implementation
patch could modify a parser, capability declaration, command, or sandbox policy
that later judges the same run.

The write gate and its break-test need to cover the entire adapter and registry
area. Keeping every adapter in the existing single file would avoid that one
edit but would create the switch-heavy structure this generalization is meant to
avoid.

### MHA-10 — tests and operations are part of the adapter contract

The current tests deliberately use fixture executors whose ID is
`claude-code`, then modify the frozen profile so stage binding accepts them.
CLI tests also document the absence of an executor injection seam. The paid-run
driver probes `claude`, defaults to a Claude model, and has no harness selector.

The new test shape should include:

- shared process-runner tests independent of a vendor;
- one conformance suite applied to each registered real adapter;
- a recorded real outer-envelope fixture for Claude and a recorded real event
  stream for Codex;
- schema validation of every fixture-emitted `AgentResult`;
- malformed, multiple-final-message, CRLF, overflow, timeout, non-zero exit,
  and missing-telemetry cases;
- Windows executable-resolution tests for both standalone CLIs;
- a fake adapter that is test-only and can be frozen honestly, never a
  production placeholder masquerading as Claude or Codex;
- a paid disposable-target chain for Claude after refactoring and a separate,
  explicitly authorized Codex chain.

The driver should require or clearly display the harness and model being used
before any paid step. Its report should include executor as well as model and
cost. A future harness must not silently inherit the Claude default model.

Current-state documentation that must change with implementation includes
`ARCHITECTURE.md`, `README.md`, `CLAUDE.md`, and the run-buildworks skill and
driver. Historical documents under `docs/features/` remain unchanged. The
documentation checker treats this proposal as reference material and currently
checks its paths, not its architecture claims.

If this work adds a new hazard for non-portable sandbox vocabulary, the hazard
count and list in architecture section 22 must change with it; doc-check already
guards that relationship. The implementation should also add a documentation
check that derives the registered real adapter IDs from source and compares them
with the supported-adapter list in current docs, so the next adapter cannot ship
silently.

### MHA-11 — local availability is not a supported installation contract

On this workstation `codex` resolves from a versioned VS Code extension path and
identifies itself as an alpha build. That proves the command can be found in this
interactive environment only. It does not prove a clean target machine, CI
worker, or filtered child environment can resolve or authenticate it.

Before BuildWorks advertises Codex support, test the intended standalone install
method, PATH behavior, version output, update behavior, and Windows process-tree
termination. Record the observed CLI version with the contract evidence. Use a
stable adapter ID such as `codex`; do not encode the CLI version in the ID.

## Recommended target shape

```text
CLI new-run --executor <id> --model <name>
          |
          v
static registry of real adapters only
          |
          +-- preflight: executable, capabilities, staffing, environment
          |
          v
serializable executor definition + effective agent bindings
          |
          v
frozen profile --hash--> approval binding

stage dispatch
  -> resolve runtime adapter from frozen ID
  -> shared bounded process supervisor
  -> retain raw vendor output
  -> adapter parses to the one HarnessEnvelope
  -> validate AgentResult against dispatched agent/role/executor
  -> persist agent_run using system-owned identity and measured telemetry
```

The following boundaries keep future adapter cost linear rather than
combinatorial:

- **Shared:** process lifecycle, named environment construction, timeouts,
  process-tree kill, raw retention, hashes, audit, database insertion, result
  validation, stages, gates, and approval.
- **Per adapter:** executable/probe definition, safe argv construction,
  containment flags or wrapper, raw-envelope parser, and measured telemetry
  declarations.
- **Per run:** selected executor definition, effective agent bindings, model
  map, policy, verification configuration, and approval hash.
- **Never dynamic in this feature:** plugin discovery, arbitrary executable
  definitions from target repositories, per-stage harness routing, or
  model-authored adapter selection.

## Supported routing modes and their blast radius

| Mode | Profile/storage effect | Orchestration effect | Recommendation |
|---|---|---|---|
| One harness per run | Existing single executor snapshot remains valid; no DB migration expected | Existing stage signatures largely survive | Build this first |
| Different harness per stage | Requires a frozen executor map and model namespace per stage | Every dispatch resolution and capability preflight changes | Separate feature, roughly 8-15 days beyond the estimate below |
| Mixed harnesses inside one review panel | Requires per-agent bindings and heterogeneous adapter resolution within one stage | Selection, independence evidence, telemetry, retries, and reconciliation failure handling all widen | Do not combine with the second-adapter work |

The estimates in this review assume the first mode. Treating “support several
harnesses” as permission to route each dispatch independently would more than
double the conceptual surface and would need its own architecture review.

## Detailed blast-radius matrix

| Area | Expected change | Risk |
|---|---|---|
| Architecture and hazards | Reconcile build order, define static multi-adapter boundary, state actual Codex containment | High |
| Executor and harness core | Split serializable definition from runtime behavior; adapter-owned argv and parser; bounded streaming evidence | High |
| Run intake and profile | Add harness selection, preflight before insert, freeze selected definition and effective agent bindings | High |
| Agent registry and selection | Remove source-level Claude lock-in without duplicating agents; preserve frozen executor checks | Medium-high |
| Prompt/result contract | Replace nine hard-coded executor examples; enforce expected role/executor | High |
| Spec/plan/implementation stages | Resolve one runtime adapter from the frozen ID; most business logic remains unchanged | Medium |
| Store and migrations | Existing executor and nullable telemetry columns are sufficient | Low |
| Approval | Existing profile hash binds the choice; human-readable display should name it | Low-medium |
| Scope protection | Expand protection from one executor file to the whole adapter control plane | Medium |
| Verification and delivery | No agent dispatch; no intended logic change | Low |
| Tests and fixtures | Replace masquerading fixture assumptions; add two real contract fixture families and conformance tests | High |
| Driver and operator docs | Add explicit harness/model selection, probes, reporting, and two paid paths | Medium-high |
| Existing runs | Completed evidence remains readable; in-progress Claude runs can continue if the frozen shape and stable Claude ID remain accepted | Medium |

## Effort estimate

Assumptions: one engineer familiar with this repository; one selected harness
per run; Windows remains a supported platform; no dynamic plugins; no per-stage
routing; one paid Codex contract run is authorized after the free tests pass;
review and remediation are included, but procurement and provider-account delays
are not.

| Workstream | Estimate |
|---|---:|
| Architecture decision, threat model, and Codex discovery evidence | 3-5 days |
| Narrow adapter extraction and shared process/evidence refactor | 5-8 days |
| Run selection, frozen binding, prompt identity, and CLI changes | 4-6 days |
| Codex parser, containment, telemetry, and Windows behavior | 5-9 days |
| Fixture/conformance migration, docs, driver, and paid end-to-end proof | 4-6 days |

Some workstreams overlap. The planning range for a reviewed two-adapter release
is **18-30 engineering days**, or roughly **4-6 calendar weeks for one engineer**
allowing review cycles. If Codex requires a new OS-level containment wrapper to
satisfy MHA-02, plan **25-40 engineering days** instead.

After that foundation, a later harness that already offers stdin prompts,
noninteractive execution, enforceable read-only/no-command behavior, structured
output, a model override, and honest telemetry should take about **3-7 days**.
A harness with streaming differences, weak sandboxing, unusual authentication,
or missing telemetry is more likely **7-15 days** and may be rejected rather
than adapted. Therefore five unknown future harnesses are not credibly one
estimate: **15-35 days is a best case; 30-60+ days is the safer mixed-contract
planning range**.

Placeholder entries do not reduce those figures. Most adapter effort is learning
and proving the real contract, not writing an ID into a registry.

## Recommended delivery sequence

1. Obtain a management decision to reprioritize the second harness and reconcile
   the binding architecture before implementation.
2. Run a bounded Codex discovery spike in a disposable target: exact standalone
   install, filtered environment, stdin/argv behavior, malicious containment
   attempts, raw JSONL, telemetry, overflow, timeout, and Windows tree kill.
3. Decide MHA-02. If the current CLI cannot meet the trust boundary, choose an
   external caller-enforced wrapper or stop; do not weaken the guarantee by
   implication.
4. Extract the narrow runtime adapter seam using Claude and Codex as the two real
   cases. Keep the serializable frozen definition separate from runtime
   functions and keep the registry static.
5. Make intake, profile freezing, agent binding, prompts, result validation,
   protected paths, and operator reporting executor-aware.
6. Migrate fixtures to honest test adapters and add shared conformance plus one
   recorded real fixture per production adapter.
7. Re-run the paid Claude disposable-target chain to prove the refactor did not
   change the shipped path.
8. With explicit spend approval, run the Codex disposable-target chain through
   `completed` and verify audit, identity, scope, model, nullable telemetry, and
   cost reporting.
9. Add later named harnesses only when each has a real owner, executable, access
   path, and retained contract evidence.

## Acceptance evidence for the implementation feature

The implementation should not be called complete until all of the following are
demonstrated:

1. Current architecture names the supported routing mode and the two real
   adapters, and its build order reflects the approved priority.
2. The production registry contains no fixture or placeholder entry.
3. Unknown executor, missing capability, unstaffable panel, missing executable,
   and unusable invocation environment all refuse before a run row or spend.
4. The selected executor and effective agent bindings are frozen once and bound
   by the approval profile hash.
5. Every stage and raw dispatch uses the frozen selection; no live Claude
   default can override it on resume.
6. Accepted `AgentResult` agent, role, and executor exactly match the dispatched
   identity.
7. Claude and Codex raw outputs are retained before parsing and replayed as
   contract fixtures; malformed streams fail with named operator-visible causes.
8. Result and evidence-retention limits are independent, bounded, and tested by
   breaking them.
9. Codex negative containment tests prove writes, forbidden reads/commands,
   customization injection, MCP/web access, and persistence are blocked to the
   level architecture claims.
10. Tokens, effective model, fallback, and cost come only from measured
    harness-owned fields; every unreported field is `null`.
11. Adapter files and registry changes are refused by the implementation write
    gate.
12. Windows resolves and terminates each supported standalone CLI under the
    exact filtered child environment.
13. Typecheck, documentation checks, and the full suite pass; git-spawning tests
    are run in a disposable copy if the known parent-repository leakage recurs.
14. Separate, explicitly authorized Claude and Codex paid runs reach
    `completed`, retain an intact audit chain, and report executor with every
    agent run.

## Assumptions that still need verification

| Assumption | Why it cannot be accepted yet | Verification |
|---|---|---|
| Codex can run noninteractively with only the named child environment | Version help is not an authenticated dispatch | Probe and one disposable invocation with the exact filtered environment |
| Codex can meet the empty command/tool allowlist | Read-only sandboxing is not the same claim | Adversarial tool, command, path, network, and customization attempts |
| Codex JSONL identifies one final assistant result unambiguously | No real event stream was captured | Retain and replay a real successful stream plus malformed variants |
| Codex reports effective model, tokens, cache use, fallback, or cost | The command reference promises event output, not BuildWorks' telemetry fields | Populate capabilities only from retained real events |
| The extension-provided alpha binary represents deployment | It is tied to one workstation and extension version | Test the supported standalone install on Windows and CI |
| Every future harness can support all four dispatch capabilities | The future products are not named | Require per-adapter capability proof before registry admission |
| Management wants one harness per run rather than per-stage routing | “Additional harnesses” does not determine routing granularity | Record the routing decision in the architecture amendment |

## Recommendation to management

Approve a **Codex-as-second-real-adapter** feature if Codex support is an active
delivery requirement, and approve the corresponding architecture reprioritization
at the same time. Scope it to one selected harness per run and a static registry.

Do not approve unnamed third-through-seventh placeholders. Ask only that the
second-adapter design make another real adapter an O(1)-module, O(1)-fixture
addition with no stage-specific branches. When each later harness is named, run
its contract and containment spike first, then estimate it from evidence.

The go/no-go condition for Codex is MHA-02. Output parsing, frozen binding, and
test migration are ordinary engineering work. A harness that cannot enforce the
project's proposal-process trust boundary is not a supported adapter merely
because it can return JSON.
