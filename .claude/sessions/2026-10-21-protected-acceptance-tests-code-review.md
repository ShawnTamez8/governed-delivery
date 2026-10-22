# Protected acceptance tests - code-review task record

**Request:** review the uncommitted diff, including untracked files. Review only; no implementation fixes, commits, operator decisions or provider spending.

**Baseline:** branch `sandboxed-delivery`, HEAD `4be6b2abd7203f5412427f20ef4ca340efa14adc`; 47 modified tracked files and 31 original untracked files.

**Success criteria:** inspect the diff against the binding architecture, hazards and governing plan; reproduce actionable candidates against unchanged code in owned disposable targets; preserve load-bearing evidence in the repository; write a dated open review and run focused checks.

**Approach and assumptions:** high-effort direct review. The protected-acceptance-tests plan and its subsequent operator decisions govern the feature. The reproduced-review-findings plan remains unbuilt. Recorded scope limits and decided follow-ups do not become new findings. Existing Docker images support free browser and mount probes; no paid run has authorization.

**Result:** four confirmed findings, one high and three medium. The review records a Windows case-alias write around the read-only overlay, an uncalled helper satisfying assertion presence, a matcher argument error counting as valid red and an awaited array leaving action promises unsettled. The case-alias probe changes the Task 7 record's previous inference into reproduced evidence and shows a clean final snapshot after byte restoration. It does not prove a forged-delivery run.

**Files created:** `docs/features/protected-acceptance-tests/2026-10-21-code-review.md`, `test/fixtures/recorded/acceptance-code-review-probes.json` and this task record. No implementation file changes.

**Validation:** source/dashboard typecheck passes; acceptance units pass 21 of 21; real-engine acceptance tests pass 2 of 2; four isolated guard mutations reach and fail their corresponding assertions. The full JSON audit covers the 14 original report fixtures and five evaluation records, replays the stored scoring and parses all 97 generated suite-file instances. Ten changed non-engine test files complete serially with an owned stand-in state directory: 497 pass and 5 fail out of 502, with no cancellations or skips. The documentation checker passes with historical path warnings.

**Evidence and cleanup:** the recorded fixture retains the two complete browser logs, suite/page inputs, actual gate results, Windows alias log, restored bytes, clean Git status and four successful guard-mutation assertion logs. It also retains the entire 502-test regression log and current/unchanged-HEAD diagnostic logs. Four regression failures report dirty fixture files; the fifth dereferences an absent stage and passes its isolated rerun. Unchanged HEAD reproduces the cleanliness refusal, but the underlying cause and absent-stage trigger remain unverified. An initial isolated mount-mutant attempt fails on its mirror's asset path, not the guard; the explicit-path rerun supplies the real mutation result. Every engine probe removes its containers and networks. The review removes its disposable targets, baseline archive and mutation mirrors after preserving their evidence. Retained logs and scripts live only in the session directory or recorded fixture. No repository source changes.

**User decisions:** the review invocation authorizes inspection and its report only. No further scope or spending decision occurs.

**Remaining work:** all four review findings remain open. The broader regression is not green; the review does not attribute its baseline-sensitive failures to this feature. Any accepted implementation correction requires the implementation workflow and re-review. No additional provider spend has authorization.

**Rollback:** no implementation rollback applies. The three review-created files are the complete repository delta from this task; the operator's original dirty tree remains intact.
