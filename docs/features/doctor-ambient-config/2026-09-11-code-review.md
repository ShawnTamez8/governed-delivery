# Doctor ambient configuration — code review

**Reviewed document:** `plan.md`
**Review date:** 2026-09-11
**Status:** reconciled
**Effort:** high
**Reviewer context:** This reviewer does not implement the change and uses a separate review context. This record makes no independently attested claim about provider process topology.
**Scope reviewed:** Baseline `fbda8dd3870a04e50cc95893e059fc3b0adc7560` to the current working tree: the complete tracked diff for `src\harness.ts`, `src\readiness.ts`, `test\harness.test.ts`, `test\cli-operator.test.ts`, `README.md`, and `docs\runbooks\cli-operator.md`; plus the complete untracked files `src\doctor-diagnostics.ts` and `test\doctor-diagnostics.test.ts`. The review covers every diff hunk and each listed file through physical EOF, including all 3,079 physical lines of the CLI test file.
**Hazards considered:** 4 (contract-derived assertions, independent native children, and seven retained mutation/restoration records); 8 and 9 (same-context native executable selection exposes Finding 1); 11 and 12 (owned default fixtures and visible current configuration show no additional defect); 10 and 15 (routing, effective configuration, and containment remain explicit limitations, with no new defect identified); 14 (separate review context does not establish provider-process independence); 17 (the retained whole-file user-state fingerprint remains the operator's settled choice). Hazards 1, 2, 3, 5, 6, 7, 13, 16, and 18 do not identify an affected runtime path: this change does not alter model parsing/retention, prompts, delivery, coverage, retries, normative reconciliation, or the governed code-review gate.

## Summary

The implementation preserves the named environment filter, inherited dispatch-probe defaults, current/frozen separation, and non-gating file observations. The bounded collector checks type, complete reads, descriptor stability, and closure; it withholds raw configuration, override values, and override-value hashes. The existing renderer exposes the complete current object in both formats without a schema or stage change.

One confirmed Windows defect violates AC-003: Node filesystem lookup rejects a directory spelling that native executable lookup accepts, so doctor can skip the executable a bare native spawn selects in the same environment and cwd. The selected absolute probe remains internally consistent with the wrong selection; that does not establish native-selection parity.

The review withholds style issues, pre-existing behavior, speculative hardening, the settled `user_state` hashing tradeoff, the rejected broad-catch proposal, and the two deferred documentation/helper suggestions. The unrelated instruction-file edits, session conversion, and prior learning-record changes remain outside the finding scope. The current architecture and reconciled plan override the checklist's historical wrapper and pre-milestone statements.

## Findings

### Finding 1 — Windows filesystem lookup skips a native-valid executable candidate

- **Classification:** CONFIRMED.
- **Where:** `src\doctor-diagnostics.ts:83-99`, `resolveDoctorExecutable`; the result reaches `src\readiness.ts:226-227`.
- **Severity:** Medium. The failure requires a Windows PATH entry with a dot-suffixed directory component, such as an existing `first` directory named as `first.`. Ordinary PATH spellings do not reach this reproduction.
- **Contract:** AC-003 requires agreement with independent bare-name native selection under the same captured lookup context. The process contract requires native Windows ordering rather than merely consistency between the custom resolver and its absolute probe.
- **Why it matters:** Native Windows lookup accepts `first.\claude.exe` when the existing file is `first\claude.exe`. The resolver instead calls Node's `statSync` on the candidate; that call returns `ENOENT` for this spelling on the reviewed runtime. Line 99 discards the candidate. With no later executable, doctor falsely fails `executor_probe`. With a later PATH copy, doctor selects and successfully probes that different copy while a native bare-name spawn selects the first. This is a same-context divergence, not the documented difference between an invocation cwd and a later worktree cwd.
- **Reproduced:** Two unchanged-source runs on Windows, Node `v26.4.0`, libuv `1.52.1`, use owned copies of `process.execPath` named `claude.exe`, an owned home, and an owned invocation directory. The parent sets `NoDefaultCurrentDirectoryInExePath=1`; the resolver and independent `spawnSync("claude", ...)` receive the same PATH and cwd. The native child reports `process.execPath`, not a shared version as its identity. A separate absolute launch of the native-reported spelling also succeeds. Direct `inspectReadiness` calls confirm both downstream outcomes below.

| PATH relative to the owned reproduction root | Native-selected path | Native/absolute launch exit | Node `statSync` | Doctor-selected path | `executor_probe` |
| --- | --- | --- | --- | --- | --- |
| `first.` | `first.\claude.exe` | `0` / `0` | `ENOENT` | `null` | `fail` |
| `first.;second` | `first.\claude.exe` | `0` / `0` | `ENOENT` | `second\claude.exe` | `pass` |

The rows abbreviate absolute paths only for readability. Both actual PATH entries and the supplied cwd are absolute. The reproduction also confirms ordinary, quoted, and explicit `\.` spellings agree; it does not infer a general failure from one unsuccessful launch.

The external lookup reference is [libuv 1.52.1 `search_path_join_test`](https://github.com/libuv/libuv/blob/v1.52.1/src/win/process.c), which tests the assembled candidate with `GetFileAttributesW`. Node filesystem lookup is not interchangeable with that test. Match the native lookup semantics before discarding a candidate, and cover both the sole-candidate refusal and competing-candidate divergence with independent native differential assertions. Do not substitute unconditional pathname rewriting for the native contract.

The review introduces no source mutation or repair. The existing isolated reversed-precedence mutation proves the independent ordering assertion fires, but its ordinary PATH inputs do not cover this normalization difference. A new regression and its isolated guard mutation belong to the parent implementation workflow.

## Investigation and verification

The review reads the governing plan and complete prior review, including its final `5 accepted / 6 rejected / 2 deferred / 0 open` disposition. It reads the canonical documentation skill, project checklist, both instruction files, current learning block, architecture, hazard catalogue, implementation record, mutation record, and resolved discovery-debug record.

Caller tracing covers `inspectReadiness` through the CLI's doctor branch and outer error boundary, `probeExecutor` through `dispatchOnce`, `invokeHarness`, the configured executor, canonical hashing, profile freezing/binding, and both operator renderings. The whole-executor canonical comparison prevents retained arbitrary probes from entering current diagnostics. No diff exists in the CLI, renderer, dispatch, executor, profile, or migration boundaries.

### Commands in this review

- `npm run typecheck` passes.
- `git --no-pager --no-optional-locks -c diff.autoRefreshIndex=false diff --check fbda8dd3870a04e50cc95893e059fc3b0adc7560 -- src\harness.ts src\readiness.ts test\harness.test.ts test\cli-operator.test.ts README.md docs\runbooks\cli-operator.md` passes; Git reports only its existing CRLF conversion warnings.
- `node --test --test-reporter=spec --test-name-pattern="ambient|short successful|exact per-file|EOF byte-count|filesystem errors|opened descriptor|named environment|probe defaults" test\doctor-diagnostics.test.ts test\harness.test.ts test\cli-operator.test.ts` reports 14 named tests, 14 passes, no failures, and no skips. This includes all three ambient CLI boundary tests, text/JSON parity, frozen-byte preservation, non-gating observations, snapshot stability, privacy, short reads, EOF/count mismatch, descriptor type/errors, and unchanged probe defaults.
- Two inline Node reproduction commands confirm Finding 1 against unchanged source; the second asserts the native identity, absolute-launch success, resolver result, and actual readiness check for both cases. Both commands exit `0` because their assertions confirm the observed defect.
- Post-write `npm run check:docs` passes with no errors and 63 existing historical path warnings; none concern this review.

### Existing evidence checked rather than rerun

The implementation record and the retained Task 5 log agree on 207 total tests: 203 passes, four expected platform skips, and no failures. That runner covers the complete harness, diagnostics, dispatch, CLI-operator, and profile files. The review does not rerun the seven-to-eight-minute CLI suite merely to duplicate that evidence.

The full mutation record contains seven distinct source mutations, seven intended `ERR_ASSERTION` results, and seven byte-exact green restorations. Current hashes of all six in-scope source/test files match the record's baseline hashes. In particular, the reviewed diagnostics source has SHA-256 `1b4be3a0051b1d254069f28bd8032977add2ed539e09b26cb9a2790d6e67b85e`, and readiness has SHA-256 `b59bb8312d6aa9d672421542793240d33135cc4d09f7fa3ad54f06acc5aa5d47`.

The implementation record also retains Task 6's successful Windows README selector, documentation check, and typecheck. These are prior execution evidence, not commands this reviewer claims to rerun.

## Limitations and completion boundary

- This review executes Windows checks only. POSIX cases remain unexecuted, not certified.
- The existing evidence covers real Windows directory junctions and dangling links. Privilege-dependent file symlinks remain skipped. Selected invalid-PE launch failure proves no fallback for that input, not an actual ACL-denial experiment.
- Byte limits and metadata checks do not establish a filesystem snapshot, complete configuration precedence, bounded filesystem latency, authenticated provider readiness, or later-dispatch identity.
- No real provider invocation, signer, approval command, publication, or commit to the BuildWorks checkout runs in this review. The selected existing tests create disposable target commits. Reproductions use only owned native Node copies and synthetic paths; they inspect no live operator configuration. Cleanup removes only the owned reproduction directories and leaves no reproduction file.
- Only this review document remains as a review-authored repository change. The plan remains `Reconciled`; Finding 1 remains open for the parent to disposition and repair. No other review blocker emerges.

## Reconciliation (2026-09-11)

The original review above is preserved as evidence of the reviewed baseline.
Final disposition: **1 accepted and fixed, 0 rejected, 0 deferred, 0 open**.

Finding 1 is accepted. Node's `Stat` binding applies `ToNamespacedPath`, which
suppresses the Win32 normalization used by native executable lookup. The fix
uses the DOS-device namespace only for the Windows attribute query, preserves
explicit namespaces, and still returns and probes the original candidate
spelling. It does not strip trailing characters, change ordering, or retry a
different executable after a launch failure.

The independent native regression covers the sole dot-suffixed candidate and
a competing later executable, rejected suffix controls, and explicit extended
namespace controls. It failed against the original resolver. The isolated
correction mutation then produced one intended `ERR_ASSERTION`; byte-exact
restoration passed the same named test. Evidence and current source hash:
`.claude\sessions\2026-09-11-doctor-native-path-mutation.txt`. The seven earlier
mutation hashes above remain historical, not claims about the corrected file.

After correction, diagnostics/harness reported 52 passes and four expected
platform skips; all three ambient CLI boundary tests and typecheck passed.
A separate read-only follow-up reviewer reconstructed the exact corrective
delta against the original hashes, reran focused native cases and typecheck,
confirmed Finding 1 resolved, and found no significant introduced issue.
No source changes followed that review.

Runtime evidence remains Windows Node 26.4.0/libuv 1.52.1. UNC and explicit
DOS-device input paths were inspected but not independently exercised.
POSIX, privilege-dependent file symlinks, and actual Windows ACL launch denial
retain the limitations above. This closes this review only, not the unrelated
CLI follow-up review or any provider-readiness question.
