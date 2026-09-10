# CLI operator code review

**Reviewed document:** `docs\features\cli-operator\plan.md`

**Review date:** 2026-09-10

**Status:** reconciled

**Effort:** high, separate-context read-only code-review specialist.

**Reviewer:** Host-reported agent `f1e57d7b-e4f3-4ace-8d23-4927183be5f8`, model `claude-opus-4.8`. The implementation coordinator records the report and its follow-up corrections here. This separation is not a governed `configured_standalone` audit record or proof of reviewer independence.

**Hazards considered:** Entries 1-18 in `docs\hazards.md`: 1-2 govern checked parser fields, refusal detail and retained evidence; 3-4 govern unchanged prompt bytes and externally grounded assertions; 5-6 govern delivery bindings and honest continuation limits; 7 prohibits an outer retry; 8-9 govern shared native executable probing; 10-12 govern frozen configuration and local readiness; 13 prohibits stronger downstream schema obligations; 14 limits independence claims; 15 prohibits inferring sandbox guarantees from fixture behavior; 16-17 preserve upstream and reconciliation authority; 18 requires attributable review and accurate verification labels. The disposition table below distinguishes applicable surfaces from unchanged policy.

**Scope reviewed:** Branch `code-review-stage`, HEAD `a8a71d1`; uncommitted implementation from `git --no-pager diff HEAD -- src test README.md CLAUDE.md AGENTS.md ARCHITECTURE.md`, plus the full contents of untracked `src\cli-args.ts`, `src\repo-root.ts`, `src\readiness.ts`, `src\operator-state.ts`, `src\operator-output.ts`, `src\run-command.ts`, `test\cli-operator.test.ts`, `test\relative-evidence.test.ts`, `test\operator-state.test.ts`, `test\run-command.test.ts`, and `test\fixtures\harness\emit-cli-run.mjs`. The reviewer confirms all tracked runtime/test/document hunks and all eleven new files, including both large test files through EOF. The reviewer runs state-free CLI probes and reports no IDE diagnostics; the completed implementation regression and guard evidence come from the separate execution record.

## Summary

The review reports **0 confirmed findings and 0 plausible findings**.
The implementation follows the plan's local CLI, read-only inspection,
frozen-profile, intact-boundary and external-approval contracts. The new
runner calls the existing core stages rather than introducing another
execution engine. Shared parsers retain their checked subsets, and the
target-relative evidence changes preserve absolute references.

The review applies `.claude\review-code.md`, the governing plan and its
reconciled design review, `ARCHITECTURE.md`, `docs\hazards.md`, and
`.claude\sessions\project-learnings.md`. Current recorded completion and
native Windows launch facts take precedence over the checklist's older
"nothing has" completed and shim-wrapper wording.

The reviewer initially samples two large test files and overstates coverage.
The coordinator keeps the review open until the follow-up reads
`test\operator-state.test.ts` lines 1-951 and `test\cli-operator.test.ts`
lines 1-2823 through EOF. That final pass reports no additional finding.
The reviewer also retracts the claim that residual risk consists only of
over-refusal. This finite review does not prove the absence of unsafe paths.

## Tracked scope and exclusions

The runtime diff covers `src\cli.ts`, `src\store.ts`, `src\migrate.ts`,
`src\lock.ts`, `src\harness.ts`, `src\approval-stage.ts`,
`src\plan-stage.ts`, `src\implementation-stage.ts`,
`src\verification-stage.ts`, `src\handoff.ts`, `src\code-review.ts`,
`src\code-review-stage.ts`, `src\delivery-stage.ts`, `src\spec-doc.ts`,
and `src\prompts.ts`.

The tracked test diff covers `test\cli.test.ts`, `test\store.test.ts`,
`test\migrate.test.ts`, `test\lock.test.ts`, `test\harness.test.ts`,
`test\handoff.test.ts`, `test\code-review.test.ts`,
`test\spec-stage.test.ts`, `test\plan-stage.test.ts`, and
`test\prompts.test.ts`. The document diff covers `README.md`, `CLAUDE.md`,
`AGENTS.md`, and architecture sections 15 and 19.

Pre-existing planning, analysis and reconciled review inputs provide context;
they are not newly introduced implementation defects. Continuity, execution
and lifecycle records document this workflow rather than extending its
runtime review scope. The coordinator preserves those earlier inputs.

## Hazard dispositions

| Entry | Application and disposition |
| --- | --- |
| 1. Model output shapes | Shared handoff, code-review and specification parsers expose only checked fields. Refusal paths retain their original meaning. No finding. |
| 2. Discarded output | Inspection reports retained references and availability without inventing exact raw-file linkage for failed attempts. No finding. |
| 3. Prompt constraints | Prefix extraction preserves all eleven rendered prompts byte-for-byte; the fixture router derives its markers from those constants. No new prompt obligation or finding. |
| 4. Circular fixture authority | Recorded responses, schema validators, architecture-derived stage order and actual Git delivery ground the assertions. Isolated guard evidence remains in the execution record. No finding. |
| 5. Completion without delivery | The interpreter checks retained delivery, commit, gate and scope bindings. Missing present-day terminal evidence remains a limitation, not permission to reopen execution. No finding. |
| 6. Unkeepable promises | Plan coverage policy remains unchanged. Guided execution refuses partial or contradictory chains rather than promising repair. Intact-boundary continuation, separately consented delivery after transaction rollback, and explicit writer-side SQLite recovery have distinct documented limits. No finding. |
| 7. Unchanged retries | A guided invocation stops after an unsuccessful group; the existing code-review loop alone owns bounded remediation. No finding. |
| 8. Windows resolution | Readiness and dispatch share direct native probing without a new command-shell wrapper. No finding. |
| 9. Interpreter readiness | Doctor uses the shared executable/argv path with a bounded probe; the change adds no hook installer. No finding. |
| 10. Moving model aliases | Inspection distinguishes frozen configuration from current environment facts; guided execution introduces no model override. No finding. |
| 11. Unusable defaults | Local readiness explains setup refusals without claiming provider-account readiness. Fixture execution is not a new paid default-installation acceptance run. No finding. |
| 12. Configuration divergence | Canonical targets and shared workflow interpretation keep execution reasons consistent. Doctor can add stricter present-day setup diagnostics. No finding. |
| 13. Invented obligations | Shared declared-artifact extraction avoids imposing new full-spec requirements on downstream consumers. No finding. |
| 14. Unproven independence | Projection retains recorded reviewer provenance. This review identifies its separate host agent without upgrading that evidence to a governed standalone attestation or independence guarantee. No finding. |
| 15. Assumed sandboxing | The runtime harness and proposal containment policy remain unchanged. A compliant fixture journey does not establish network containment or real-provider sandbox behavior. No applicable policy change. |
| 16. Wrong-artifact remediation | Document-review routing remains unchanged; guided execution never signs or exports an upstream proposal automatically. No finding. |
| 17. Deleting obligations | Reconciliation delta policy and normative prompt bytes remain unchanged. No applicable policy change. |
| 18. Unexamined correctness | Output retains immutable review attribution, final-panel severity and the actual frozen verification commands. Version-only commands do not prove application correctness. No finding. |

## Reviewer reproduction

The reviewer runs `node src\cli.ts` with each argument vector below from
the checkout root. Each path returns before target, store, writer-lock or
provider access. The empty-vector case exercises the explicit missing-command
refusal rather than discovering an unknown command's default behavior.

| Arguments | Exit | Observed contract |
| --- | --- | --- |
| `--help` | 0 | General help. |
| `help` | 0 | General help. |
| `help status` | 0 | Command help without a required run ID. |
| Empty argument vector | 2 | Missing command. |
| `status` | 2 | Missing required `--run`. |
| `doctor --slug a --run 1` | 2 | Mutually exclusive selectors. |
| `runs --limit 0` | 2 | Limit outside 1-100. |
| `frobnicate` | 2 | Unknown command. |
| `status --run abc` | 2 | Invalid numeric run ID. |
| `doctor --run 1 --help` | 0 | Valid supplied ID and help output. |
| `run` | 2 | Missing required `--run`. |
| `doctor --run 5 --help` | 0 | Valid supplied ID and help output. |
| `doctor --run abc --help` | 2 | Invalid supplied ID even with help. |
| `doctor --slug Bad --help` | 2 | Invalid supplied slug even with help. |

Help skips missing-required and mutually-exclusive-option enforcement, not
validation of provided values. The reviewer's first PowerShell loop shadows
the automatic `$args` variable and produces spurious observations; the
corrected loop uses `$parts` and direct calls. The table records those
corrected results, not an implementation fix.

## Implementation evidence

The coordinator's
`.claude\sessions\2026-09-10-cli-operator-implementation.txt` records exact
commands, original failures, corrections, mutation diagnostics, restoration
hashes and contributor handoffs. The following results belong to that
implementation workflow; the independent reviewer does not rerun them.

| Evidence | Recorded result |
| --- | --- |
| Exact 20-file combined gate in the plan | 697 pass, 0 fail, 1 skip; 562912.07 ms. |
| Full `node --test test\cli-operator.test.ts` | 108 pass, 0 fail, 0 skip; 464556.76 ms. |
| Full `npm test` | 1072 total, 1071 pass, 0 fail, 1 skip; 590698.73 ms. |
| `npm run typecheck` | Exit 0. |
| `npm run check:docs` | Exit 0; 63 historical path warnings. |
| `git --no-pager diff --check` | Exit 0. |
| Guard sensitivity | Ten late baseline/failure/restoration proofs, plus earlier parser, probe, lock, migration and router proofs; exact commands and hashes in the execution record. |

The skipped case is "a file symlink redirecting the write into the run's
design document is refused." Its reported reason is "file symlinks are
refused by this OS (Windows without Developer Mode); the junction case
covers the guard." The workflow does not separately establish the actual
Developer Mode setting.

The local journey uses the actual CLI and stages, one frozen fixture profile,
external disposable signing, and Git delivery. The README case executes
the actual PowerShell inspection fence against a separate spaced target.
A calibrated `gh` sentinel and native process observations establish no
GitHub operation in that fixture journey, not a general network sandbox.

## Suppressions and limitations

The review withholds style, naming, speculative hardening, decided scope
trade-offs, already dispositioned design findings, and work beyond the
authorized increment. It treats the moved intake status-line parsing pattern
as pre-existing rather than filing it against this extraction; it does not
claim every possible status-code configuration unreachable.

The plan's pre-completion `Reconciled` status, historical path warnings,
OS file-symlink skip, and deferred stop-after/single-group control do not
constitute new implementation defects. No packaging, GitHub integration,
general recovery, new stage, schema change or hard dollar cap enters scope.

The reviewer traces populated-state, approval and guided-execution behavior
and reads its evidence, but does not independently execute those journeys or
perform source mutations. No paid provider acceptance run or real operator
signature occurs in this implementation workflow. Frozen version commands
and a clean review panel do not prove application correctness.

## Findings

No findings.

## Implementation disposition

The implementation coordinator closes this review on 2026-09-10 after the
reviewer completes the remaining full-file reads and corrects the coverage,
help-validation and residual-risk statements. Disposition totals are
0 accepted defects, 0 rejected defects, 0 deferred defects and 0 open findings.
No runtime correction, waiver or scope expansion follows from this review.

The plan advances to `Implemented` through the separately authorized
implementation workflow. Source, tests, README and architecture remain
unchanged between the completed full regression and review closure.
The execution record preserves the earlier incomplete-review state and the
coordinator's final disposition rather than rewriting that history.
