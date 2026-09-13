# BuildWorks Governed Agentic SDLC Dashboard Design

**Status:** Reconciled. First read-only increment authorized in `ARCHITECTURE.md` on 2026-09-12.  
**Product:** Configurable system name; default BuildWorks  
**Document type:** Authorized UI and observability design  
**Hazards considered:** 2, preserve the core's named evidence gaps rather than hiding discarded or missing output; 4, derive UI expectations from `RunSnapshot` and recorded contracts rather than hand-written fixtures; 10, retain frozen requested and effective model values without alias normalization; 12, label each repository's effective frozen configuration; 14, preserve recorded independence labels without strengthening them; and 18, present verification and code-review evidence without claiming product correctness.

## 1. Purpose

The dashboard uses the configured system name, whose default is BuildWorks. It is a read-oriented governance and observability console for governed AI-assisted software delivery. Its complete future vision covers workflow progress, model assignments, effort levels, token consumption, execution time, findings, reconciliation, testing, approvals, policy enforcement, and delivery quality; the first-release boundary below limits which of those views are currently eligible.

The dashboard must answer these questions quickly:

1. What is running, waiting, blocked, failed, or complete?
2. Which model and effort level are assigned to each activity and review type?
3. How much time, token capacity, and cost has been consumed or is forecast?
4. What findings were produced, and which were accepted, rejected, duplicated, resolved, or remain open?
5. How many reconciliation rounds have occurred, and why?
6. What tests were planned, created, executed, passed, failed, skipped, or retried?
7. Is the workflow operating within its governance boundaries?
8. What human decision or system action is needed next?

### 1.1 Authorization and release boundary

`ARCHITECTURE.md` authorizes the first dashboard increment as a local, CLI-launched, loopback-only, read-only projection over the existing core. The authorization preserves the CLI as the sole mutation authority and requires a later decision before any interactive UI mutation.

If authorized, the first release has these limits:

- Local use by one operating-system user
- Multiple explicitly configured local repositories
- Read-only projection of data already exposed by the current `RunSnapshot`
- One ephemeral HTTP listener bound only to loopback; no remote viewer
- No direct lifecycle mutation
- Governed actions represented only as explicit CLI command handoffs
- No new test, task, model-invocation, reconciliation-round, forecast, alert, or telemetry persistence

Sections that describe data outside this boundary are future capability, not first-release requirements. The UI must label that capability unavailable; it must not infer, synthesize, or persist substitute values.

## 2. Design Principles

- **Governance first:** Surface lifecycle state, approvals, violations, blocked reasons, and authoritative evidence before vanity metrics.
- **Read-only by default:** Observability must not create an alternate path around CLI, policy, approval, or lifecycle authority.
- **Run-to-evidence traceability:** Every summary metric must drill down to the underlying workflow run, agent run, model invocation, finding, test result, approval, or audit event.
- **No hidden aggregation:** Display metric definitions, data freshness, exclusions, and whether values are measured, estimated, or unavailable.
- **Model and effort transparency:** Record the exact model, provider or executor-reported model identifier, effort level, assignment rule, and assignment reason when available.
- **Separate time categories:** Distinguish active model time, tool execution time, test execution time, queue time, blocked time, approval wait time, and total wall-clock time.
- **Comparable outcomes:** Normalize metrics by model, agent role, review type, lifecycle stage, workflow, repository, and run.
- **Privacy and security:** Never display secrets or unredacted restricted content. Respect repository, role, and artifact access boundaries.

## 3. Primary Navigation

1. **Portfolio**: Explicitly configured local repositories and recent runs
2. **Run Overview**: Current state, progress, forecasts, and risks
3. **Models and Assignments**: Model, effort, agent, executor, and review routing
4. **Reviews and Findings**: Findings, dispositions, reconciliation, and reviewer coverage
5. **Testing**: Test inventory, generation, execution, results, timing, and tokens
6. **Governance**: Approvals, policies, violations, scope, and audit integrity
7. **Artifacts and Traceability**: Requirements, plans, tasks, code, tests, reviews, and documentation
8. **Trends and Comparisons**: Historical efficiency, quality, and reliability
9. **Run Detail**: Timeline, events, diagnostics, logs, and evidence

The first release exposes only navigation backed by the current read projection. Forecasting, testing, cross-harness comparison, alerts, and other unavailable views remain hidden rather than displaying empty or inferred values.

## 4. Global Filters

All views should support compatible filters for:

- Repository and authoritative branch
- Workflow run ID
- Date and time range
- Lifecycle stage or workflow node
- Agent role and agent ID
- Executor
- Provider and model
- Effort level
- Review type
- Artifact type and artifact ID
- Risk level
- Run status
- Finding severity and disposition
- Test type and result
- Human versus agent actor

The first release offers only filters supported by current projected fields. Filter state must be visible and resettable. Stable local links must identify the repository and run without embedding sensitive evidence or credentials. Export is future capability; when authorized, exported reports must include the repository root, run ID, active filters, local refresh time, last recorded activity, and unavailable fields.

## 5. Run Overview

### 5.1 Run Header

The first release displays:

- Workflow run ID
- Project, feature ID, slug, and change kind
- Persisted run status: `in_progress`, `blocked`, or `completed`
- Derived operator phase: `ready`, `awaiting_approval`, `blocked`, `completed`, or `interrupted_or_inconsistent`
- Current eligible workflow action and every refusal reason
- Recorded stage chain and latest recorded activity
- Created and updated timestamps
- Frozen system name, model map, review policy, verification commands, deadline, and approval signer when the profile is readable
- Approval state, signed scope, risk, and binding metadata
- Writer-lock observation
- Last recorded activity, local refresh time, and repository-specific limitations

The first release does not invent a correlation ID, workflow version, checkpoint, active agent, current model invocation, or time category that the read projection does not expose.

### 5.2 Summary KPI Cards

The first release includes:

- Known input, output, cache-read, and cache-write tokens, each with reported and unreported row counts
- Known USD cost, agent-row count, cost-reported row count, and cost-unreported row count
- Recorded failed dispatch attempts
- Finding and report counts
- Approval state
- Current workflow phase
- Delivered and missing artifact counts
- Evidence references grouped by availability

The first release excludes forecasts, token budgets, test counts, reconciliation duration, active model time, queue time, blocked duration, and approval-wait duration because the current projection does not expose authoritative values. Future estimates must be labeled **Estimated** and include their basis and confidence representation.

### 5.3 Workflow Progress

Render the recorded stage chain showing:

- Status and latest transition
- Recorded start and completion timestamps, including the source of inferred start evidence
- Gate result and output reference
- Findings and reports linked by stage ID
- Cost and token coverage grouped by stage when reported
- Approval state at the approval boundary
- Verification, code-review, and delivery evidence when projected
- Links to artifacts and evidence

The current run is an ordered chain. The first release must not render unrecorded parallel lanes, test activity, assignment history, or duration categories.

## 6. Model, Effort, and Assignment Reporting

The first release displays the frozen model map and the agent-level cost and token groupings that `RunSnapshot` exposes. Per-invocation assignment, effective effort, executor telemetry, and override history remain future capability until an authoritative projection exposes them.

### 6.1 Model Invocation Matrix

| Field | Description |
|---|---|
| Model | Exact reported model identifier |
| Provider or executor | Source responsible for model execution |
| Effort level | Assigned reasoning or compute effort |
| Agent role | Planning, implementation, reviewer, testing, aggregator, or other configured role |
| Activity | Workflow node or operation performed |
| Review type | Architecture, security, code, test strategy, maintainability, documentation, requirements, plan, adversarial, or configured type |
| Assignment source | Policy, workflow manifest, route profile, manual override, or executor default |
| Assignment reason | Risk, artifact type, data sensitivity, capability, availability, cost, or configured rationale |
| Calls | Number of invocations |
| Input tokens | Measured input tokens |
| Output tokens | Measured output tokens |
| Total tokens | Input plus output and other billable token classes, according to provider reporting |
| Estimated cost | Cost derived from the configured rate card, if available |
| Execution time | Model execution duration |
| Findings | Findings attributed to the invocation or agent run |
| Accepted findings | Findings retained after review and deduplication |
| Retries | Invocation retry count |
| Status | Pending, running, blocked, failed, or completed |

### 6.2 Effort-Level Reporting

Effort level must be stored on each applicable model invocation or assignment, not inferred later. The UI should show:

- Configured effort level
- Requested effort level
- Executor-reported effective effort level, if available
- Whether the model supports explicit effort selection
- Assignment source and override history
- Token and execution-time variance by effort level
- Findings yield and accepted-findings yield by effort level
- Test-generation yield by effort level
- Retry and failure rate by effort level

If an executor cannot report the selected model or effective effort, display **Not reported by executor** rather than guessing.

### 6.3 Review Assignment Matrix

| Review type | Required | Assigned agent | Executor | Model | Effort | Status | Findings | Tokens | Time |
|---|---:|---|---|---|---|---|---:|---:|---:|
| Requirements | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Plan | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Architecture | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Security | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Code | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Test strategy | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Maintainability | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Documentation | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Adversarial or risk | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |
| Review aggregation | Yes/No | Value | Value | Value | Value | Value | Value | Value | Value |

The matrix must highlight:

- Missing required review assignments
- Same-agent or same-model independence concerns
- Review types skipped by policy
- Manual overrides
- Reviews waiting on an upstream artifact or approval
- Reviews that used a different model or effort level after retry or escalation

## 7. Code Agent Harness and Executor Reporting

BuildWorks must treat the code agent harness or executor as a first-class reporting dimension that is separate from the model, agent role, review type, and effort level.

Cross-harness inventory and comparison are future capability. The binding architecture places a second harness after the dashboard and requires a separate implementation decision. The first release displays only frozen configuration and current evidence; it does not create an executor registry, adapter abstraction, or telemetry sidecar.

```text
Review type
  -> Agent role
    -> Harness or executor
      -> Model
        -> Effort level
```

For example, a security review could be performed by a Security Review Agent through Claude Code using a configured Claude model at high effort. An architecture review could use Codex with a configured OpenAI model at medium effort. These dimensions must remain independently queryable because changing the harness can affect tool behavior, execution boundaries, timing, retries, token reporting, and produced evidence even when the model remains the same.

### 7.1 Harness and Executor Inventory

The dashboard must support configured and future execution harnesses without hard-coding the product to a fixed list. Initial examples include:

- Claude Code
- Codex CLI
- Pi
- GitHub Copilot CLI or coding agent
- OpenCode
- Aider
- OpenAI Agents SDK
- Native LangGraph agents
- Manual human executor
- Other executor adapters registered with BuildWorks

For each harness or executor, display:

- Executor ID and display name
- Executor type and adapter kind
- Version, when reported
- Execution mode, such as native, external CLI, SDK, or manual human
- Sandbox or isolation type
- Configured capabilities
- Allowed command and path scope summary
- Network policy status, when applicable
- Model-selection ownership
- Supported effort controls
- Telemetry capabilities, including model, token, timing, tool-call, and cost reporting
- Availability and health status

### 7.2 Harness Performance Matrix

| Harness or executor | Model | Effort | Agent role | Review or activity type | Runs | Success rate | Findings | Accepted findings | Tests created | Tokens | Execution time | Retries |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Configured value | Reported value | Assigned value | Configured value | Configured value | Measured | Measured | Measured | Measured | Measured | Measured | Measured | Measured |

The matrix must allow grouping and comparison by repository, workflow, stage, review type, model, effort level, agent role, and date range.

### 7.3 Harness Governance Metrics

Report the following by harness or executor:

- Approval requests generated
- Policy checks performed
- Blocked actions
- Scope-expansion attempts
- Protected-path write attempts
- Restricted-path read attempts
- Command allowlist violations
- Timeout events
- Output-redaction events
- Stale-base or stale-artifact rejections
- Patch validation failures
- Human escalations
- Reconciliation rounds involving the harness
- Checkpoint recovery and resume count
- Cleanup or sandbox disposal failures

### 7.4 Harness Quality and Efficiency Metrics

Report:

- Findings per million tokens
- Accepted findings per million tokens
- Cost per accepted finding
- Tests created per million tokens
- Accepted tests or verified test outcomes per million tokens
- Test execution success rate
- Defect reproduction rate
- Duplicate finding rate
- Rejected finding rate
- Retry and failure rate
- Rework caused by harness output
- Documentation artifacts produced
- Requirement and acceptance-criteria coverage added
- Wall-clock time per completed activity

These metrics are operational indicators for workflow and technology evaluation. They must not be used as employee-performance scores.

### 7.5 Harness Selection and Assignment History

For every model-backed or executor-backed activity, preserve the complete assignment chain:

- Review or activity type
- Agent ID and role
- Harness or executor ID
- Requested and reported model
- Requested and effective effort level
- Assignment source
- Assignment reason
- Assignment timestamp
- Manual override identity and rationale, when applicable
- Superseded assignment
- Retry or escalation relationship

The run timeline should show reassignment as a new governed event rather than replacing the original assignment.

### 7.6 Model and Harness Escalation Chain

The dashboard must visualize escalation sequences such as:

```text
Implementation review
  -> Claude Code
  -> configured model
  -> medium effort
  -> insufficient confidence
  -> reassigned to another model or higher effort
  -> unresolved conflict
  -> human review
```

Track:

- Escalation count
- Escalation trigger and policy rule
- Previous and new harness
- Previous and new model
- Previous and new effort level
- Incremental tokens and cost
- Incremental execution and waiting time
- Findings added, removed, or changed
- Final outcome
- Human decision, when required

### 7.7 Harness Detail View

Selecting a harness should open a detail view containing:

- Current configuration summary
- Recent and active assignments
- Supported agent roles and activity types
- Model and effort combinations observed
- Token, timing, findings, testing, and reconciliation trends
- Governance interventions
- Failure and retry diagnostics
- Version changes and configuration history
- Evidence links for individual runs

### 7.8 Harness Comparison

Users should be able to compare two or more harnesses using equivalent workflow categories and clearly labeled filters. Comparisons should include:

- Completion and failure rates
- Token and cost consumption
- Active and wall-clock time
- Finding yield and accepted-finding yield
- Test creation and verified outcome yield
- Reconciliation and escalation frequency
- Policy intervention frequency
- Retry and rework rates
- Evidence completeness

The UI must warn when compared runs differ materially in model, effort, workflow, risk, repository, input scope, or review type. It must not imply that the harness alone caused an observed difference.

A future comparison is eligible only when both cohorts declare the same workflow category, review type, risk class, repository or normalized input scope, model, effort, and telemetry coverage. Each rate must display its numerator, denominator, excluded-row count, missing-telemetry count, and applicable rate-card effective date. The UI must refuse a comparison rather than rank cohorts when these keys differ or either cohort lacks the minimum declared coverage.

### 7.9 Future Executor Telemetry Requirements

A future executor projection must come from the authoritative core schema rather than a dashboard-owned record. Before this view becomes eligible, that projection must define executor identity, reported version, execution mode, sandbox and policy observations, model binding, timing, persisted status, retry or escalation lineage, and diagnostic and evidence references. Missing fields remain unavailable; free-form logs do not supply authoritative values.

## 8. Reviews and Findings

### 8.1 Finding Counts

The first release reports retained findings and immutable reports by:

- Stage
- Round
- Reviewer ID, when projected
- Severity
- Classification
- Location
- Recorded decision disposition, when one exists
- Final-panel blocking status, when established by code-review evidence

### 8.2 Finding Lifecycle

Each first-release finding includes:

- Finding ID
- Stage ID and persisted round
- Intent key and location
- Each immutable report's ID, source agent-run ID, reviewer ID, severity, classification, and subject
- The one recorded decision, when present, with its authoritative disposition and retained grounding fields
- Final-panel blocking status, when the code-review record establishes it

The UI must not collapse multiple reports into a synthetic severity or classification. It must not translate document-review decisions into generic open, accepted, rejected, waived, or resolved states.

### 8.3 Quality and Efficiency Metrics

These derived rates are future capability unless the authoritative projection supplies every numerator, denominator, and excluded-row count.

- Findings per million tokens
- Accepted findings per million tokens
- Cost per accepted finding
- Time per accepted finding
- Duplicate finding rate
- Rejected or false-positive rate
- Reopened finding rate
- Blocking finding rate
- Findings escaped to a later stage
- Findings that generated code, documentation, or test changes
- Finding-to-test traceability rate

These measures should be presented as operational signals, not as employee-performance scores.

## 9. Reconciliation and Disagreement

The first release can group retained findings by their persisted round and display recorded decisions. It does not present reconciliation timing, token use, consensus counts, or cross-round semantic identity because the current projection does not establish those values.

### 9.1 Summary

Display:

- Total reconciliation rounds
- Current reconciliation round
- Rounds by conflict type
- Consensus achieved count
- Deterministic resolutions
- Human escalations
- Unresolved blocking conflicts
- Average and maximum round duration
- Tokens and execution time consumed by reconciliation
- Findings added, removed, merged, or changed during reconciliation

### 9.2 Reconciliation Timeline

For each round, show:

- Participating reviewers, models, and effort levels
- Inputs and artifact versions considered
- Findings entering and leaving the round
- Agreements and disagreements
- Duplicate findings merged
- Resolution rule applied
- Model or effort reassignment
- Human question or decision
- Tokens, model time, tool time, and wall-clock time
- Resulting transition, retry, escalation, or blocked state

### 9.3 Loop Detection

Flag:

- Repeated findings without new evidence
- Repeated use of the same inputs and model configuration
- Rising token use without state progress
- Excessive retry or reconciliation counts
- Oscillating finding dispositions
- Reopened conflicts
- Model escalation without an explicit policy reason

The dashboard may recommend operator review, but it must not bypass configured retry limits or approval gates.

## 10. Testing Dashboard

This section is future capability. `test_authoring` remains a deferred stage, and the current authoritative schema and `RunSnapshot` expose no test inventory or test-execution records. The first release does not display test metrics as zero and does not infer tests from repository files or command logs.

### 10.1 Test Inventory Cards

- Existing test case count before the run
- Test cases discovered
- Test cases proposed
- Test cases created
- Test cases modified
- Test cases deleted
- Test cases approved
- Test cases executed
- Passed, failed, skipped, blocked, flaky, and not-run counts
- Retried test count
- Automated versus manual count
- Requirement and acceptance-criteria coverage

### 10.2 Test Case Table

| Field | Description |
|---|---|
| Test ID | Stable test case identifier |
| Name | Human-readable test name |
| Type | Unit, integration, contract, UI, end-to-end, security, performance, regression, negative, or manual |
| Source | Existing, agent-created, human-created, imported, or generated from a finding |
| Requirement links | Requirements and acceptance criteria covered |
| Finding links | Findings that caused or are verified by the test |
| Created by | Agent, model invocation, or human actor |
| Model | Exact model identifier when AI-generated |
| Effort level | Assigned effort for test generation or analysis |
| Status | Proposed, approved, created, executed, blocked, or retired |
| Result | Passed, failed, skipped, flaky, blocked, or not run |
| Execution duration | Measured test duration |
| Token usage | Tokens used to design, generate, repair, or analyze the test |
| Retry count | Number of re-executions |
| Evidence | Test report, command output, log, screenshot, or artifact reference |

### 10.3 Test Execution Metrics

Separate test-generation work from deterministic test execution:

- **Test-generation tokens:** Tokens used to design or create tests
- **Test-analysis tokens:** Tokens used to interpret failures or recommend fixes
- **Test-repair tokens:** Tokens used to revise tests after validation failure
- **Test execution time:** Time consumed by the test process itself
- **Model analysis time:** Time consumed by AI analysis of test output
- **Queue time:** Time waiting for an executor or CI resource
- **Blocked time:** Time waiting for policy, dependency, environment, or approval
- **Total test-stage wall-clock time:** End-to-end elapsed time for the testing stage

Report these metrics by test type, suite, executor, model, effort level, workflow run, and lifecycle stage.

### 10.4 Test Quality Signals

- Tests created per requirement
- Acceptance criteria without tests
- Negative-test coverage
- Test cases created per million tokens
- Passed tests per million tokens used for test work
- Flaky-test rate
- Failure reproduction rate
- Tests that fail before the implementation fix and pass afterward
- Tests rejected during validation
- Duplicate or redundant tests
- Changed-code-to-test coverage, when coverage data exists
- Test evidence completeness

## 11. Token, Time, and Cost Analytics

The first release is limited to `RunSnapshot.cost`: known USD cost, agent rows, reported and unreported cost rows, four token classes with coverage counts, recorded failed attempts, and the available stage and agent groupings. Other breakdowns in this section are future capability.

### 11.1 Token Breakdown

Track measured token classes supported by each provider or executor, including:

- Input tokens
- Output tokens
- Cached input tokens
- Cache creation tokens
- Reasoning tokens, when reported
- Tool-related tokens, when reported
- Total billable tokens
- Unclassified tokens

Break down by:

- Model
- Effort level
- Agent
- Executor
- Review type
- Workflow stage
- Reconciliation round
- Test-generation, test-analysis, and test-repair activity
- Successful, failed, blocked, and retried invocation

### 11.2 Time Breakdown

The current projection does not expose an authoritative time breakdown. This subsection is future capability.

- Model latency
- External executor duration
- Tool-call duration
- Test execution duration
- Build and validation duration
- Queue time
- Approval wait time
- Blocked time
- Resume overhead
- Reconciliation time
- Total wall-clock time

### 11.3 Forecasting

Forecasting is future capability and is excluded from the first release.

Show:

- Current token usage
- Configured budget
- Estimated remaining tokens
- Estimated final tokens
- Estimated remaining time
- Estimated completion time
- Forecast by remaining workflow stage
- Forecast confidence or range
- Primary forecast drivers
- Budget-warning thresholds

Forecasts must never be presented as measured values.

## 12. Governance and Approval

The first release displays the projected approval, workflow-action reasons, writer observation, evidence availability, and limitations. Policy-check counts and complete audit-chain analytics remain future capability until the read projection exposes them.

### 12.1 Approval Status

For each gate, display:

- Gate name and required role
- Artifact and transition
- Requested time
- Current status
- Waiting duration
- Resolution time
- Approver identity, when authorized for the viewer
- Signature verification status when signed approvals are enabled
- Artifact version and payload reference
- Rejection or revision rationale

### 12.2 Policy Enforcement

Report:

- Policy checks performed
- Passed and failed checks
- Blocked actions
- Unauthorized lifecycle-transition attempts
- Self-approval attempts
- Protected-path write attempts
- Restricted-path read attempts
- Command allowlist violations
- Scope-expansion attempts
- Timeout events
- Output-redaction events
- Stale artifact or base-commit rejections
- Patch validation failures

### 12.3 Audit Health

- Audit event count
- Last audit event time
- Hash-chain verification status
- Missing or malformed event count
- Events without expected provenance
- Invocations without model or effort metadata
- Findings without source-run links
- Tests without evidence links
- Metrics ingestion lag

## 13. Artifacts and Traceability

The first release displays existing evidence references and delivery artifact sets. The relationship graph and coverage rates below are future capability because the current projection does not expose the required task, test, requirement, or code-change edges.

Provide a graph and coverage view linking:

```text
Requirement
  -> Acceptance criterion
    -> Plan
      -> Task
        -> Code change
          -> Test case
            -> Test execution evidence
              -> Review finding
                -> Resolution
                  -> Approval
                    -> Release or pull-request summary
```

Report:

- Requirement-to-plan coverage
- Requirement-to-task coverage
- Acceptance-criteria-to-test coverage
- Finding-to-resolution coverage
- Finding-to-test coverage
- Code-change-to-review coverage
- Code-change-to-test coverage
- Documentation update coverage
- Artifacts missing required evidence
- Orphaned artifacts and broken links

## 14. Live Activity and Run Detail

The first release displays `activity.lastRecordedAt` and the projected last audit event. A complete event feed, input and output hashes, and streaming updates remain future capability until the authoritative read projection exposes them.

The activity feed should show append-only, time-ordered events with filters for:

- Lifecycle transitions
- Agent and executor start or completion
- Model and effort assignments
- Tool calls
- Test creation and execution
- Findings created or updated
- Reconciliation rounds
- Approvals requested or resolved
- Policy blocks
- Checkpoints, failures, and resumes

Each event should expose provenance, related artifacts, input and output hashes where applicable, and a link to permitted evidence. Secret or restricted output must remain redacted.

## 15. Alerts and Operational Signals

Alerts are future capability. They require a separately approved owner for thresholds, notification state, and the relationship between current configuration and each run's frozen profile.

Configurable alerts should include:

- Token budget threshold exceeded
- Forecast exceeds token or cost budget
- No lifecycle progress within a configured interval
- Reconciliation or retry limit approaching
- Repeated invocation with equivalent inputs
- High duplicate-finding rate
- Required review unassigned or skipped
- Same reviewer independence concern
- Blocking finding unresolved
- Approval wait exceeds threshold
- Test execution failure or flakiness threshold exceeded
- Required tests not created or not executed
- Traceability coverage falls below policy
- Audit integrity verification failure
- Missing model, effort, token, timing, or evidence metadata
- Protected or restricted action blocked

## 16. Dashboard Actions

### 16.1 Safe Read Actions

- Filter, sort, group, and compare
- Drill down from aggregate metrics to source evidence
- Open governed artifacts and test reports
- Compare runs, models, effort levels, and review assignments
- Export a filtered run report in Markdown, JSON, or CSV
- Copy stable links to run, finding, test, approval, and audit views

### 16.2 Governed Command Handoffs

The dashboard may display or copy an exact CLI command that the operator can run separately. It does not execute the command, open a writer, collect consent, submit a signature, or report that a displayed command succeeded. Examples include:

- Inspect readiness or run status
- Continue an eligible run through the existing guided command
- Create an approval request
- Export a retained upstream proposal
- Verify the audit chain

Every handoff must display the command, selected repository, run ID, current eligibility, refusal reasons, expected transition, and required external operator step. Displaying a handoff never grants consent or authority.

### 16.3 Prohibited Dashboard Behavior

The dashboard must not:

- Directly alter authoritative lifecycle state
- Apply patches outside the policy engine
- Approve on behalf of an agent
- Hide or rewrite audit history
- Silently change model or effort assignments
- Rerun models or tests without recording a new governed execution event
- Infer missing model, effort, token, timing, or cost data
- Execute a displayed CLI handoff
- Open the authoritative database as a writer
- Claim that an external command completed without a fresh read of authoritative state

## 17. Authoritative Read Projection

The first release consumes one read projection from the existing core. It does not introduce dashboard-owned telemetry records or read tables directly. `RunSnapshot` and its refusal behavior remain the source contract until a deliberate schema change replaces them.

### 17.1 Source-of-Truth Matrix

| Dashboard value | Authoritative source | First-release treatment |
|---|---|---|
| Run identity and persisted status | `RunSnapshot.run` | Display exact values |
| Operator phase and eligible action | `RunSnapshot.phase` and `RunSnapshot.workflowAction` | Display the derived value and every reason |
| Stage chain | `RunSnapshot.stages` | Display recorded order, status, gate result, timestamps, and output reference |
| Frozen configuration | `RunSnapshot.configuration` | Display values or the recorded profile limitation |
| Approval | `RunSnapshot.approval` | Display state and permitted binding metadata |
| Cost and token coverage | `RunSnapshot.cost` | Display known totals with reported and unreported row counts |
| Findings and decisions | `RunSnapshot.evidence.findings` | Display immutable reports separately from the optional decision |
| Evidence availability | `RunSnapshot.evidence.references` | Display `available`, `missing`, `unverified`, or `inconsistent` with the recorded reason |
| Verification and delivery | `RunSnapshot.delivery` | Display retained commits, commands, artifact sets, and outcomes |
| Writer state | `RunSnapshot.writer` | Display the observation; never infer which run owns the writer |
| Data limitations | `RunSnapshot.limitations` | Display without suppression |
| Tests, tasks, forecasts, alerts, and invocation-level telemetry | No current authoritative projection | Do not display or infer in the first release |

The dashboard must preserve current vocabulary rather than defining parallel enums. Requested and effective model values remain the strings recorded by the frozen profile and run evidence; provider aliases are not normalized after run start.

### 17.2 Read Consistency and Failure Behavior

Each repository refresh requests one complete exact-current snapshot through the existing read path. The dashboard must:

- Keep a repository's values from one snapshot together
- Display the local refresh time, last recorded activity, and repository root without presenting refresh time as persisted run evidence
- Replace a prior snapshot only after the new snapshot completes successfully
- Preserve the last successful snapshot as visibly stale when a refresh fails
- Display schema mismatch, hot-journal, lock-contention, missing-evidence, inconsistent-chain, and unreadable-profile refusals
- Never migrate, repair, recover, or write the database
- Never combine partial rows from separate refreshes into one apparent state

The first release uses explicit refresh or bounded polling. WebSockets and push updates remain future capability because no streaming contract exists.

### 17.3 Local Multi-Repository Boundary

One local operator supplies an explicit set of repository roots at launch. The first release does not persist that list. Each repository keeps its own authoritative `.governance/state.db`; the dashboard creates no central state store. It reads repositories independently, isolates one repository's refusal from the others, and labels every card, link, export, and command handoff with its repository root.

The operating-system account is the first-release viewer boundary. The CLI launches one ephemeral HTTP host bound only to loopback. The host refuses non-loopback connections and exposes no configurable public bind address. It exposes only evidence references already projected by the core and applies the projection's availability and limitation labels. Raw prompts, raw model output, signatures, credentials, and unrestricted file reads are outside the first release.

Stable links identify the configured repository root and run ID without embedding sensitive file contents or credentials. A missing repository, retained worktree, or evidence file produces a named unavailable state rather than a redirect to another record.

## 18. Metric Definitions

| Metric | Definition |
|---|---|
| Total token usage | Sum of measured token classes included by the provider or executor contract; the UI must disclose included classes |
| Estimated token usage | Forecast generated from completed stages and remaining workflow assignments; never mixed with measured usage |
| Execution time | Measured active duration for the selected model, executor, tool, test, stage, or run |
| Total wall-clock time | Time from run creation or start through completion, including waits and blocks |
| Finding count | Count of distinct finding IDs after preserving original and duplicate relationships |
| Accepted finding count | Findings with an accepted or resolved disposition according to configured semantics |
| Reconciliation round count | Number of persisted reconciliation-round records, not the number of model calls |
| Existing test case count | Baseline tests discovered before run-created test changes are applied |
| Test cases created | Distinct governed test artifacts or test definitions created during the selected run |
| Test cases executed | Distinct test executions, with retries reported separately |
| Test execution time | Duration of the test process, excluding AI analysis unless explicitly included in a separate combined metric |
| Test token usage | Tokens attributed to test generation, test analysis, or test repair, reported separately |
| Approval latency | Time between approval request creation and resolution |
| Blocked time | Duration while the authoritative run status is blocked |
| Model effectiveness | Accepted findings or verified outcomes divided by a declared denominator such as tokens, time, or cost; never used as an employee score |

## 19. Default Run Overview Layout

```text
+--------------------------------------------------------------------------------+
| Configured system name | Repository | Run ID | Status | Phase | Last activity   |
+--------------------------------------------------------------------------------+
| Known cost | Token coverage | Findings | Approval | Delivered | Missing evidence |
+--------------------------------------------------------------------------------+
| Ordered stage chain | Current action eligibility and every refusal reason        |
+--------------------------------------------------------------------------------+
| Frozen configuration and approval bindings                                      |
+--------------------------------------------------------------------------------+
| Findings, immutable reports, and optional decisions                              |
+--------------------------------------------------------------------------------+
| Verification, code-review, and delivery evidence                                |
+--------------------------------------------------------------------------------+
| Limitations | Evidence availability | Display-only CLI handoffs                  |
+--------------------------------------------------------------------------------+
```

## 20. Acceptance Criteria

These criteria apply to the first release authorized by `ARCHITECTURE.md` on 2026-09-12.

1. The dashboard reads each explicitly configured local repository through the existing exact-current snapshot path and opens no writer.
2. Each repository view displays its root, snapshot time, run ID, persisted run status, derived phase, current action eligibility, and all refusal reasons without inferring state from logs.
3. A failed refresh preserves the prior successful snapshot as visibly stale and displays the new refusal; it never combines partial data from both reads.
4. Run and stage states use the current authoritative vocabulary without dashboard-defined aliases.
5. Known token and cost totals display their reported and unreported row counts; missing telemetry is unavailable, never zero.
6. Frozen configuration, approval bindings, findings, reports, decisions, evidence availability, verification, code review, and delivery data retain the distinctions present in `RunSnapshot`.
7. Every evidence link preserves its repository and run identity and displays missing, unverified, or inconsistent evidence as recorded.
8. The dashboard exposes no raw prompt, raw model output, signature, credential, or unrestricted file browser.
9. One repository's schema, journal, lock, profile, or evidence refusal does not suppress successful snapshots from other configured repositories.
10. The configured system name supplies product labels; no functional behavior depends on the default name.
11. The dashboard displays or copies eligible CLI handoffs but never executes them, collects consent, submits signatures, or claims their outcome.
12. Tests, tasks, forecasts, alerts, cross-harness comparisons, invocation telemetry, and unsupported filters remain absent from the first release rather than appearing as empty or inferred data.
13. Every aggregate identifies its source projection, included rows, excluded rows, and unavailable values.
14. Keyboard shortcuts do not activate during text entry, expose their bindings, support disabling, and preserve full keyboard navigation without relying on shortcuts.

## 21. Frontend Technology Standards

### 21.1 Approved Technology Stack

**Core technologies:**

- TypeScript
- Vanilla JavaScript, where TypeScript is unnecessary
- HTML5
- Modern CSS
- Web Components, optional but preferred

**Explicitly approved:**

- TypeScript
- Custom Elements
- Shadow DOM
- CSS Variables
- CSS Grid
- Flexbox
- Native Fetch API
- SVG

Native WebSockets are permitted only after an authorized streaming contract exists; they are not part of the first release.

**Explicitly not allowed:**

- Tailwind
- Bootstrap
- Material UI
- Chakra UI
- Shadcn
- Ant Design
- jQuery
- CSS-in-JS frameworks
- Runtime CSS generators

**Reasoning.** BuildWorks is a governance product. It should have zero framework lock-in, predictable rendering, a minimal dependency footprint, and an extremely long service life. The dashboard will likely live longer than whatever UI framework is fashionable right now.

### 21.2 UI Design Philosophy

Avoid:

- AI startup UI
- Purple everywhere
- Floating gradients
- Glassmorphism
- Neon effects
- Animated cards
- Over-designed dashboards

Instead:

- Engineering console
- Operations center
- Aircraft cockpit
- SOC dashboard
- Enterprise control plane

The aesthetic should communicate:

- Authority
- Trust
- Auditability
- Operational visibility

It should not communicate:

- Creativity
- Playfulness
- Marketing
- Consumer SaaS

### 21.3 Color System

#### Light theme

| Token | Value |
|---|---|
| Background | `#F7F8FA` |
| Panel | `#FFFFFF` |
| Primary | `#005A9C` |
| Success | `#107C10` |
| Warning | `#CA5010` |
| Error | `#D13438` |
| Text | `#1F1F1F` |

#### Dark theme

| Token | Value |
|---|---|
| Background | `#111315` |
| Panel | `#1B1D21` |
| Primary | `#3B8EEA` |
| Success | `#4CC38A` |
| Warning | `#F2A93B` |
| Error | `#FF6B6B` |
| Text | `#E6E6E6` |

#### Restricted colors

The following are explicitly banned unless used for a specific semantic purpose:

- Purple
- Magenta
- Neon cyan
- Neon green
- Gradient rainbows

### 21.4 UX Principles

#### Information density

This is a working tool, not a marketing site.

Prefer:

- More information
- Less whitespace

Over:

- Massive cards
- Huge margins
- Empty screens

Think:

- Azure Portal
- GitHub
- VS Code
- Power BI
- Grafana
- Datadog

Not:

- Linear
- Notion
- Consumer dashboards

#### Keyboard-first interaction

Everything should be keyboard accessible. Examples:

| Shortcut | Action |
|---|---|
| `/` | Search |
| `g r` | Go to Runs |
| `g f` | Go to Findings |
| `g a` | Go to Approvals |

Shortcuts must not activate while focus is in a text-entry control, must not replace ordinary focus navigation, must expose their bindings in the UI, and must support disabling when they conflict with browser or assistive-technology commands.
Shortcuts for unavailable future views, including Testing, must not be registered in the first release.

Operators will love this.

#### Accessibility

Require:

- WCAG AA
- High contrast mode
- Full keyboard navigation
- Screen reader support
- Reduced motion support
- Color-blind safe charts

### 21.5 Data Visualization Standards

Avoid:

- Pie charts
- 3D charts
- Donut charts
- Fancy animations

Prefer:

- Tables
- Heatmaps
- Timelines
- Bar charts
- Trend lines
- State diagrams

A governance system is fundamentally states, transitions, and events. Those should be visualized directly.

### 21.6 Dashboard Layout Standards

Every page should use:

1. Header
2. Filter bar
3. Primary metrics
4. Supporting metrics
5. Detailed data
6. Evidence links

Drilldown should always be:

```text
Metric
  -> Run
    -> Agent
      -> Harness
        -> Model
          -> Artifact
            -> Evidence
```

Nothing should be a dead-end metric.

### 21.7 Theme Standards

Light and dark mode should be first-class features, not afterthoughts. Everything should be CSS-variable driven:

```css
:root {
  --background: #f7f8fa;
}

[data-theme="dark"] {
  --background: #111315;
}
```

No separate CSS files, and no duplicated styling systems.

### 21.8 Performance Standards

These values are provisional design targets, not first-release acceptance criteria:

| Operation | Budget |
|---|---|
| Initial dashboard load | < 2 seconds |
| Route change | < 200 ms |
| Filter operation | < 100 ms |
| Theme switch | < 50 ms |
| Layout shift | CLS = 0 |

They become enforceable only after the authorized surface names supported browsers, representative data volume, device class, cache state, percentile, and measurement window. Until then, no plan may claim them as verified budgets.

### 21.9 Observability Standards

The UI itself should expose metrics:

- UI render time
- Dashboard load time
- API response time
- WebSocket latency
- Refresh frequency
- Client errors
- Dropped updates

If BuildWorks governs agents, it should also govern and observe itself.

### 21.10 Audit-Everything UX

Nearly every value should be clickable:

```text
42 Findings
  -> Finding list
    -> Review artifact
      -> Agent run
        -> Model invocation
          -> Prompt
            -> Evidence
```

or:

```text
12M Tokens
  -> By review type
    -> By agent
      -> By harness
        -> By model
          -> By invocation
```

Every metric should answer one question: "Why is this number what it is?" That is the difference between a typical observability dashboard and a governed SDLC control-plane dashboard.

Together, this section covers frontend technology standards, user experience standards, the visual design system, and performance and accessibility requirements. Those requirements will prevent the dashboard from turning into the typical purple-gradient AI dashboard and keep it looking more like an enterprise operations console that belongs beside VS Code, Azure Portal, GitHub Enterprise, Grafana, and Power BI.

## 22. Recommended Delivery Order

### Prerequisite: Architecture Authorization — Complete 2026-09-12

- The operator authorized a CLI-launched, loopback-only, read-only dashboard over current `RunSnapshot` data.
- The authorization keeps direct mutation, remote viewers, WebSockets, and new persistence outside scope.
- Interactive UI mutation remains a later replacement decision rather than an implied extension of this release.

### Release 1: Current Run Observability

- Explicit local repository configuration
- Independent exact-current snapshots
- Run header, persisted status, derived phase, and action eligibility
- Recorded stage chain
- Frozen configuration and approval view
- Known cost and token coverage
- Findings, reports, and decisions
- Verification, code-review, delivery, and evidence availability
- Repository-specific limitations, refusal states, and stale refresh handling
- Display-only CLI command handoffs

### Future Releases: Separately Authorized Capabilities

- Test and task reporting after their authoritative stages and schemas exist
- Invocation, effort, harness, and assignment telemetry after the core exposes one authoritative contract
- Cross-harness comparison after a second harness is authorized and implemented
- Forecasting after its method, confidence representation, and rate-card ownership are approved
- Alerts after threshold ownership, notification state, and frozen-configuration behavior are approved
- Network or multi-user access after authentication, authorization, and redaction boundaries are approved
- Governed UI submission after a mutation boundary is approved

## 23. Design Decisions

The following decisions are settled for the first release:

- The binding architecture authorizes the bounded read-only dashboard surface as of 2026-09-12.
- Scope is limited to current `RunSnapshot` data.
- The target deployment is local, single-operator, and multi-repository.
- The dashboard is read-only and offers display-only CLI command handoffs.
- Refresh uses complete snapshots rather than a streaming contract.
- The current authoritative vocabulary and missing-data semantics are preserved without dashboard-owned enums.

The following decisions remain attached to future capabilities and do not block first-release design once the architecture prerequisite is satisfied:

- Canonical effort-level vocabulary across providers and executors
- Whether requested and effective effort need separate policy fields
- How external executors report model and effort without trusting free-form logs
- Provider-specific token-class normalization
- Cost rate-card ownership and effective-date versioning
- Forecasting method and confidence representation
- Test-case identity across frameworks and renamed tests
- Treatment of parameterized tests in test counts
- Independence policy for models, agents, executors, and review types
- Retention and access policy for raw prompts, outputs, command logs, and future evidence
- Telemetry event persistence, indexing, and export format
- Alert threshold ownership and notification state
- Networked identity, authorization, and redaction policy

## 24. Summary

The dashboard's authorized first release is a CLI-launched, loopback-only, single-operator, multi-repository projection of current authoritative run snapshots. It preserves recorded state, missing-data semantics, limitations, and evidence availability; it offers only display-only CLI handoffs and creates no second state model. Broader model, effort, testing, forecasting, alerting, remote-access, and mutation capabilities remain future work behind their own authoritative contracts and decisions.
