# CLI operator follow-up code review

**Reviewed document:** `docs\features\cli-operator\plan.md`

**Review date:** 2026-09-10

**Status:** open

**Effort:** high.

**Reviewer:** Fresh host-reported code-review agent `b1ea346f-7060-4042-aade-44bc953a1277`, model `gpt-5.5`, separate context. The coordinator records the report and adds physical-EOF and baseline observations. This is not a governed `configured_standalone` attestation or proof of independence.

**Supersedes:** This operator-requested pass becomes the latest assessment of the working tree. It preserves `2026-09-10-code-review.md` and its implementation disposition as history; it does not overwrite or reopen that reconciled record.

**Hazards considered:** All 18 entries in `docs\hazards.md`: 1-2 govern parser refusals and retained evidence; 3-4 govern prompt constraints and externally grounded assertions; 5-6 govern delivery and continuation promises; 7 prohibits unchanged outer retries; 8-9 govern executable resolution; 10-12 govern frozen configuration and readiness; 13 prohibits new specification obligations; 14 limits independence claims; 15 prohibits sandbox claims from compliant samples; 16-17 preserve upstream and reconciliation authority; 18 requires honest correctness, review and verification labels. The table below records each disposition.

**Scope reviewed:** `git --no-pager diff HEAD` at `a8a71d1` on `code-review-stage`, plus every untracked file from `git --no-pager ls-files --others --exclude-standard`. The explicit untracked inventory and tracked areas appear below. The specialist reports complete tracked-hunk and untracked-file reads; the coordinator additionally reads both large suites' physical tails. A fresh targeted command passes nine cases. Prior full-suite evidence remains separate from this review's observations.

## Summary

The fresh review reports **0 confirmed findings and 0 plausible findings**.
It finds no significant introduced correctness, resource-handling or
repository-rule defect. The operator explicitly requests this pass after
implementation completion; the earlier zero-finding review does not replace
the new assessment.

The review measures the changes against `.claude\review-code.md`,
`CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `docs\hazards.md`,
`.claude\sessions\project-learnings.md`, the governing plan and both prior
feature reviews. Current completion and native-launch evidence outrank the
checklist's stale historical wording.

The reviewer withholds style, formatting, speculative hardening, historical
baseline claims, previously reconciled decisions and explicitly deferred
scope. No finding requires implementation changes. This result does not
prove universal safety or application correctness.

## Reviewed inventory

The tracked runtime hunks cover `src\cli.ts`, `src\store.ts`,
`src\migrate.ts`, `src\lock.ts`, `src\harness.ts`,
`src\approval-stage.ts`, `src\plan-stage.ts`,
`src\implementation-stage.ts`, `src\verification-stage.ts`,
`src\handoff.ts`, `src\code-review.ts`, `src\code-review-stage.ts`,
`src\delivery-stage.ts`, `src\spec-doc.ts`, and `src\prompts.ts`.

The tracked test hunks cover `test\cli.test.ts`, `test\store.test.ts`,
`test\migrate.test.ts`, `test\lock.test.ts`, `test\harness.test.ts`,
`test\handoff.test.ts`, `test\code-review.test.ts`,
`test\spec-stage.test.ts`, `test\plan-stage.test.ts`, and
`test\prompts.test.ts`. The tracked document hunks cover `README.md`,
`CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, and
`.claude\sessions\project-learnings.md`.

The untracked inventory at review start is:

| Area | Files read |
| --- | --- |
| Runtime | `src\cli-args.ts`, `src\repo-root.ts`, `src\readiness.ts`, `src\operator-state.ts`, `src\operator-output.ts`, `src\run-command.ts` |
| Tests and fixture | `test\cli-operator.test.ts`, `test\operator-state.test.ts`, `test\relative-evidence.test.ts`, `test\run-command.test.ts`, `test\fixtures\harness\emit-cli-run.mjs` |
| Feature plan and prior reviews | `docs\features\cli-operator\plan.md`, `docs\features\cli-operator\2026-09-09-cli-operator-review.md`, `docs\features\cli-operator\2026-09-10-code-review.md` |
| Analysis and execution history | `.claude\sessions\2026-09-09-cli-github-impact-analysis.md`, `.claude\sessions\2026-09-09-cli-operator-plan.txt`, `.claude\sessions\2026-09-09-docs-cli-operator-analysis.md`, `.claude\sessions\2026-09-10-cli-operator-implementation.txt` |
| Earlier proposal review | `docs\proposals\2026-09-09-github-project-projection-and-upstream-spikes-review.md` |

The preserved planning, analysis and execution records supply context; their
earlier pending-work statements are historical, not fresh runtime defects.
The review does not treat deliberate scope exclusions as missing features.

The specialist's initial line totals, 2745 and 909, match PowerShell
`Measure-Object -Line`, which omits blank lines. The coordinator measures
physical counts of 2823 for `test\cli-operator.test.ts` and 951 for
`test\operator-state.test.ts`, then reads lines 2735-2823 and 901-951
through EOF. Those tails cover readiness/probe refusal cases and
checked-subset/fresh-boundary cases; they yield no finding. The count
correction does not represent a source change.

## Candidate dispositions

| Candidate | Evidence and disposition |
| --- | --- |
| Git inspection refreshes the index | Source uses `--no-optional-locks` and process-local `diff.autoRefreshIndex=false`; fresh targeted stale-stat cases preserve bytes and mtimes. Reject as a finding. |
| Guided fixtures fall back to operator keys | The fresh existing isolation case confirms the direct-run fixtures do not consult the operator default public key. Reject as a finding. |
| Delivery rollback triggers an automatic outer retry | The fresh existing case observes one failed delivery attempt and separately consented continuation from the intact boundary. Reject as a finding. |
| Progress corrupts JSON stdout | Source routes guided progress to stderr; the execution record retains the separate baseline/mutant/restoration proof. Reject as a finding; no fresh mutation occurs in this pass. |
| Help bypasses provided-value validation | Source still validates supplied values; prior exact CLI probes distinguish that from skipped missing-required and exclusivity checks. Reject as a finding. |
| Relative evidence uses the invocation directory | Source resolves stored relative references against the selected root and user transport paths against the original invocation directory. Reject as a finding. |

No candidate reproduces an implementation defect against unchanged behavior,
so this review creates no defect fix or new mutation experiment.

## Hazard dispositions

| Entry | Application and disposition |
| --- | --- |
| 1. Model output shapes | Shared parsers preserve their checked subsets and named malformed-handoff refusals. No finding. |
| 2. Discarded output | Inspection presents retained references and availability limits without inventing exact raw links for failed attempts. No finding. |
| 3. Prompt constraints | Shared prefix constants preserve rendered prompt bytes and fixture routing. No new constraint drift. |
| 4. Circular fixture authority | Schemas, architecture, recorded responses, Git state and retained guard experiments ground the assertions. No finding. |
| 5. Completion without delivery | Delivery interpretation binds reviewed commit, records and declared/delivered paths. No finding. |
| 6. Unkeepable promises | Guided execution refuses partial or contradictory chains without promising general repair or replay. No finding. |
| 7. Unchanged retries | The outer runner stops after an unsuccessful group; the existing code-review loop alone owns remediation. No finding. |
| 8. Windows resolution | Readiness and dispatch share the direct native probe path. No new runtime shell wrapper or launch path. |
| 9. Interpreter readiness | Doctor uses the shared bounded probe; the change adds no hook installer. No finding. |
| 10. Moving aliases | Guided execution respects the frozen profile and exposes no model override. No finding. |
| 11. Unusable defaults | Readiness names local setup gaps without claiming provider-account readiness. No new paid acceptance evidence. |
| 12. Configuration divergence | Current environment and frozen run facts remain distinct; canonical targeting and workflow interpretation are shared. No finding. |
| 13. Invented obligations | Snapshot readers avoid stronger downstream schema obligations on hash-bound artifacts. No finding. |
| 14. Unproven independence | Runtime projections preserve provenance without upgrading it to an independence guarantee. This report identifies its host-reported reviewer separately. |
| 15. Assumed sandboxing | Fixture behavior and a no-GitHub sentinel do not establish real-provider sandboxing or network isolation. No applicable containment-policy change. |
| 16. Wrong-artifact remediation | Guided execution does not introduce document-review routing or automatic proposal export. No finding. |
| 17. Deleting obligations | Normative-delta and reconciliation policy remain unchanged. No applicable policy change. |
| 18. Unexamined correctness | Output retains review attribution and actual verification limits; version-only commands do not prove application correctness. No finding. |

## Fresh evidence and limitations

The reviewer runs this existing targeted command against the unchanged
implementation:

```powershell
node --test --test-name-pattern='target and intake Git observations|worktree observations preserve index bytes|direct run fixtures never consult|Task 8 failed delivery finalization' test\cli-operator.test.ts test\operator-state.test.ts test\run-command.test.ts
```

It exits 0 with 9 passed, 0 failed, 0 cancelled, 0 skipped and 0 todo in
38963.8972 ms. This establishes the selected Git-observation, key-isolation
and failed-delivery retry behaviors, not the entire product journey.
The test process emits `DEP0190`; this pass does not retain a traced origin
for that warning and does not attribute it to a particular fixture or
runtime call site. Source review separately establishes direct native
runtime probing.

The earlier full implementation gate records 1071 passes, zero failures and
one OS file-symlink skip, plus the 108-case full CLI gate. Those results,
the actual fixture journey and isolated guard proofs remain in
`.claude\sessions\2026-09-10-cli-operator-implementation.txt`; they are not
fresh executions by this reviewer.

Post-review hashes of `src\cli-args.ts`, `src\cli.ts`,
`src\operator-state.ts`, `src\run-command.ts` and `README.md` match
the retained implementation baseline. `git --no-pager diff --check` exits 0.
The coordinator runs documentation and strict-type checks for this report;
their final results belong in the execution record.

The reviewer creates no separate reproduction fixture. Existing tests leave
the shared `node_modules\.cli-operator-tests` parent present and empty;
the coordinator confirms that state and preserves it rather than deleting
a shared workspace parent. No paid provider run, real operator signing,
GitHub operation, source edit, commit or retained-target cleanup occurs.

## Findings

No findings. This review remains `open` under the requested review workflow;
only a separately authorized disposition can reconcile it. The governing
plan remains `Implemented`.
