# Pi support assessment and prior Claude acceptance chain

**Status:** historical evidence

Preserved from `project-learnings.md` during the September 11 compaction.
This is the earlier $2.05854 completed run, not the later $2.44813 blocked
doctor-ambient-config run. No external target was rechecked to create this
record. Current decisions, authorizations and next actions belong only in
`.claude/sessions/project-learnings.md`.

## Decisions and assumptions

- Pi is additional support, with Claude retained as backup. One Claude chain
  under `C:\Users\tamezs\buildWorks_test_repos` used Claude Code 2.1.269 and
  `claude-sonnet-5`; authorization also covered README/learning updates, not Pi.
- Pi research used `https://github.com/earendil-works/pi/tree/main/packages/coding-agent`
  (package metadata 0.85.1, inconsistently revision-pinned); no runtime/provider
  evidence, implementation, scored report or scorecard resulted.

IT approval/access, Codex containment equivalence, Claude invoice cost and Pi
cost-null behavior were unestablished. The 10-14-day estimate did not reconcile
with the multi-harness review's 18-30-day scope; neither is approved. Only
correctness reviewers reported findings. Non-temp storage is not a backup or
proof of logoff survival.

## Recorded outcome

- Run 1 (`web-calculator`) completed nine stages, driver 15/15, 16 cost-bearing
  dispatches: **$2.05854** rounded (stored sum $2.0585392).
- Both panels staffed correctness/security. Round 1 low finding 9,
  `formatresult-infinity-leak-on-overflow`, triggered remediation below the final
  threshold; `383a17d9` -> `8cd5a2d9` changed calculator/tests.
- Round 2 medium finding 10, `formatresult-false-error-on-large-finite-result`
  (calculator line 97), reported rounding overflow rejecting finite 1e300.
  `finalGate=pass` means below frozen `high`, not clean; no further patch authorized.
- Six signed paths (manifest, calculator, index, styles, theme, tests) delivered at
  `8cd5a2d9b959f4eb215b71feae690a9b1a14b2d2`; audit passed.
- Both verification passes ran only `node --version` and `npm --version`.
  No generated-calculator-test or browser/manual product evidence exists;
  BuildWorks' own suite does not validate the delivered calculator.

Prior-session retention: store and 16 raw envelopes under
`C:\Users\tamezs\buildWorks_test_repos\target`, worktree
`C:\Users\tamezs\buildWorks_test_repos\target\.governance\worktrees\1`, keys under
`C:\Users\tamezs\buildWorks_test_repos\keys`. These paths are not rechecked by
the doctor-planning session and remain machine-local, not backup guarantees.

## Per-dispatch evidence

Per-dispatch driver values, rechecked against retained rows in that prior
session; all used executor `claude-code`, effective model `claude-sonnet-5`.
Individually rounded costs need not sum to the rounded total.

| ID | Agent | USD | Duration ms |
| --- | --- | ---: | ---: |
| 1 | spec-author | 0.05982 | 27966 |
| 2 | spec-author | 0.08164 | 64453 |
| 3 | spec-reviewer-traceability | 0.04679 | 31487 |
| 4 | spec-reviewer-consistency | 0.10720 | 56141 |
| 5 | spec-author | 0.10489 | 50153 |
| 6 | plan-author | 0.05059 | 27091 |
| 7 | plan-author | 0.08010 | 62174 |
| 8 | spec-reviewer-traceability | 0.05847 | 41406 |
| 9 | spec-reviewer-consistency | 0.11037 | 57473 |
| 10 | plan-author | 0.08129 | 46834 |
| 11 | implementer | 0.33899 | 175054 |
| 12 | code-reviewer-correctness | 0.32108 | 413120 |
| 13 | code-reviewer-security | 0.10949 | 27716 |
| 14 | implementer | 0.15607 | 44977 |
| 15 | code-reviewer-correctness | 0.23766 | 121216 |
| 16 | code-reviewer-security | 0.11409 | 26376 |

## Prior-session verification

- `node .claude\skills\run-buildworks\driver.mjs smoke --dir C:\Users\tamezs\buildWorks_test_repos\smoke`: 13/13; smoke-only directory removed.
- `node .claude\skills\run-buildworks\driver.mjs paid --yes --dir C:\Users\tamezs\buildWorks_test_repos`: exit 0, 15/15 including audit.
- `node .\src\cli.ts status --repo C:\Users\tamezs\buildWorks_test_repos\target --run 1 --json`: completion/cost/limits confirmed; read-only SQLite/JSON resolved every raw ref and parsed 16 files.
- `npm test`: 1071/1072, zero failures, one skip; types/docs passed with 63 historical warnings.
- Prior compaction reran `npm run check:docs`, `npm run typecheck` and `git --no-optional-locks -c diff.autoRefreshIndex=false --no-pager diff --check`: passed, no paid rerun or source edit.

Pi JSONL/read-only/discovery flags remain research leads, not verified runtime
or provider access; cc-switch still does not replace argv/envelope integration.
