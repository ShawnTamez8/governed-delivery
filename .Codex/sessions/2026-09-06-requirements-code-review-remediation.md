# Requirements Clarification

## Status

- Ready for planning: Yes
- Risk tier: High

## My Understanding

BuildWorks must repair actionable findings raised by its code-review panel
inside the current run, then review the repaired, verified commit. The operator
must be able to tune reviewer count, remediation attempts, and the blocking
severity by changing small policy values rather than redesigning the stage.

## Business Objective

Let a governed run recover from ordinary implementation defects without paying
for a fresh end-to-end run, while retaining a bounded cost, deterministic
release policy, and an auditable final review.

## Primary Actor

The BuildWorks operator who maintains the frozen policy and starts governed
runs.

## Current Behavior

- `code_review` launches both registered code reviewers once.
- A finding at or above the frozen `high` threshold blocks the run terminally.
- An upstream finding creates a proposal and blocks at any severity.
- No code-review remediation or re-review exists; a fresh run is the only
  repair.

## Desired Behavior

- The default code-review panel remains the two existing specialists:
  correctness and security.
- The configured panel size is independently adjustable from two through five.
  Increasing it requires registering enough distinct, specialized code
  reviewers first; an unstaffable value is refused before a run spends.
- Every code reviewer has explicit, reviewer-specific instructions defining its
  lens. Reviewers return only concrete, actionable defects that can be fixed in
  the current code and omit preferences, style-only comments, speculative
  hardening, questions, and upstream concerns.
- The total panel-round budget is independently adjustable from one through
  five in the same policy module used today and is frozen at run start. It
  defaults to two, which permits one remediation plus one confirmation panel;
  no hidden panel execution occurs outside the configured total.
- When a panel reports findings and another panel round remains, the existing implementer
  receives all findings together, proposes a patch, the deterministic patch
  guard applies and commits it, and every frozen verification command runs on
  the new commit before another complete panel executes.
- No finding-disposition or reconciliation schema is introduced. The next panel
  is the evidence that a remediation succeeded or exposed another defect.
- The final gate remains severity-policy based. A run passes when the final
  reviewed commit has no finding at or above the frozen blocking severity. A
  below-threshold finding remains visible evidence but does not block delivery.
- `codeReviewBlockingSeverity` remains a single frozen policy value. Changing
  it affects future runs only, so the operator can make low, medium, or high
  findings non-blocking without changing orchestration.
- If the final configured panel round still has a finding that reaches the
  blocking threshold, the run blocks with the final findings and all earlier
  rounds retained. The system does not silently claim the commit is clean.
- Code-review findings do not create a human-review step, waiver, spike, or
  proposal. A finding that cannot be expressed as an actionable current-code
  defect is outside this panel's output contract.
- `spec_review` and `plan_review`, including their panels, prompts,
  reconciliation, upstream routes, and configured rounds, remain unchanged.

## Inputs

- The approved specification and plan.
- The signed scope.
- The implementation patch base and the latest verified commit.
- The frozen code-review panel size, panel-round budget, severity order, and
  blocking threshold.
- Findings returned by each specialized code reviewer.

## Outputs

- A retained code-review record containing every panel execution, finding,
  remediation commit, verification result, final reviewed commit, and gate
  outcome.
- An append-only audit trail and agent-run cost records for reviewers and the
  implementer.
- Either a passed `code_review` handoff for `delivery_check`, or a terminal
  block naming the final blocking findings or failed deterministic guard.

## Permissions and Security

- Reviewers and the implementer remain separately dispatched through the
  frozen executor and receive no governance CLI access.
- Reviewer and implementer subprocesses remain read-only at the invocation
  boundary; only deterministic system code may apply a proposed patch.
- Every remediation patch remains bound to the current branch head, constrained
  to signed scope, barred from protected paths, and committed by the system.
- Every verification command uses the frozen command list, limits, and named
  environment passthrough.

## Error Handling

- Invalid panel size, panel-round budget, blocking severity, missing specialty
  instructions, or insufficient reviewers fails during profile freeze.
- Invalid reviewer output, an attempted upstream classification, an empty or
  invalid remediation patch, a scope or protected-path violation, a dirty or
  moved worktree, or a failed verification command blocks the run and retains
  available evidence.
- A remediation that makes no committed change cannot consume another review
  attempt as an identical retry.
- Policy changes never mutate a run already in progress; a new run freezes the
  new values.

## Non-Functional Requirements

- Patch application and commit verification become concrete reusable modules
  used by both their existing stages and code-review remediation. They are not
  a generic workflow, plugin, or adapter system.
- A future QA stage is out of scope now, but it must be able to compose those
  concrete modules from its own stage module rather than being inserted into
  the code-review policy or requiring the existing stages to be rewritten.
- All model output and command output that influences the decision remains
  attributable and retained under the existing bounded evidence rules.

## In Scope

- Code-review policy, specialist definitions and prompts, panel staffing,
  remediation orchestration, safe patch application, post-patch verification,
  code-review evidence, delivery handoff validation, CLI/docs, and tests.

## Out of Scope

- Any behavior change to `spec_review` or `plan_review`.
- A human reviewer, operator waiver, spike, or code-review proposal.
- Finding reconciliation decisions or cross-round semantic deduplication.
- A QA stage, generic stage adapter, workflow engine, plugin system, or second
  harness.
- Verification-stage remediation for failures unrelated to a code-review patch.

## Acceptance Criteria

```gherkin
Given the default frozen configuration
When a run reaches code review
Then exactly the correctness and security reviewers execute with distinct, explicit specialty instructions
```

```gherkin
Given a configured code-review panel size from two through five and enough registered specialists
When the profile is frozen
Then that exact panel size is retained for every code-review panel execution in the run
```

```gherkin
Given an invalid or unstaffable panel size or a panel-round budget outside one through five
When a new run freezes its profile
Then the run is refused before any model invocation and the reason names the invalid configuration
```

```gherkin
Given a reviewer reports one or more actionable findings and another panel round remains
When code review continues
Then one implementer dispatch receives all findings, its proposed patch passes the existing scope and base-commit guards, the frozen verification commands pass, and the full panel reviews the new commit
```

```gherkin
Given the final reviewed commit has no finding at or above the frozen blocking severity
When the code-review gate decides
Then code review passes and delivery receives that exact reviewed and verified commit
```

```gherkin
Given only below-threshold findings remain on the final panel
When the gate decides
Then the findings remain in evidence and the run is not blocked by them
```

```gherkin
Given a blocking finding remains in the last configured panel round
When the final panel completes
Then code review blocks, names the final blocking finding, and retains every round and remediation attempt
```

```gherkin
Given the operator changes the blocking severity, panel size, or panel-round budget in policy
When a later run starts
Then the later run freezes and uses the new value while an earlier run continues to use its original values
```

```gherkin
Given a code reviewer prompt is generated
When its specialty and output rules are inspected
Then it directs the reviewer to omit stylistic, speculative, upstream, and otherwise non-actionable concerns
And deterministic validation rejects an upstream classification before it becomes a finding, proposal, spike, waiver request, or human-review task
```

```gherkin
Given this feature is implemented
When the spec-review and plan-review regression suites run
Then their prompts, panel selection, reconciliation, upstream routing, and round behavior remain unchanged
```

## Assumptions

- The existing blocking severity remains `high` initially. This already makes
  `low` and `medium` findings non-blocking while preserving them as evidence.
- The total panel-round default is two. Setting it to one deliberately selects
  one-shot review: the final threshold decides immediately and no unreviewed
  remediation patch is applied.
- The existing implementer is the remediation author; no new remediation agent
  role is required.
- Reviewer panel executions use the registered code reviewers in deterministic
  id order. Raising the configured size requires adding specialist definitions
  and instructions; it does not synthesize a generic reviewer.
- A failed verification after a remediation patch is terminal for this feature.
  General verification remediation belongs to its separately deferred behavior.

## Open Questions

1. None.
