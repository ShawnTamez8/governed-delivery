# Sandboxed implementer build — task record (2026-10-19)

**Requested outcome:** `/implement-plan docs/features/sandboxed-implementer/plan.md`.
**Authorization taken:** the operator's `/implement-plan` invocation is recorded as the section 23
decision (Task 1). It covers Tasks 1-12. Task 13 (paid) needs separate consent per step.
**Baseline:** branch `sandboxed-delivery` at `44a0d3a`; Claude Code 2.1.304 (plan names 2.1.303);
Docker 29.8.2 linux; Node v26.4.0.

## Progress
- Task 1 done: ARCHITECTURE.md section 23 "Sandboxed implementer — 2026-10-19"; check:docs clean.
- Task 2 done: `container/Dockerfile`, `src/container.ts`, `src/tool-server.ts`, `src/egress-proxy.ts`,
  `toolLogDir`/`toolLogRef`; tests `test/tool-server.test.ts`, `test/container-seams.test.ts`.
  Break-tests (5) all broke and restored byte-identical (scratchpad `breaktest.mjs`).
- Task 3 done: `test/container.test.ts` (12, real Docker; skip with "no Docker engine answered"),
  recorded fixture `test/fixtures/recorded/docker-cli-outputs.json`. No-engine run simulated with
  `DOCKER_HOST` and with docker off PATH, not by stopping Docker Desktop. 4 break-tests broke/restored.
- Task 4 done: Docker stand-in (`test/fixtures/docker/`), `test/docker-stand-in.test.ts` (6).
- Task 5 done: `src/workspace-commit.ts`, `test/workspace-commit.test.ts` (12); 4 break-tests.
- Task 6 done: executor command, harness `toolServer`/`budgetUsd`, dispatch tool evidence, reply schemas.
- Task 7 done (2026-10-19): full suite with no engine (`DOCKER_HOST` bogus, serial) 1735 pass,
  0 fail, 17 skipped (12 real-Docker container tests, 5 platform); `test/container.test.ts` 12/12
  against real Docker; typecheck clean; 7 break-tests (bt-task7.json) broke and restored byte-identical.
  `freezeProfile` takes a required sandbox; `createRunIntake` checks engine, image
  and programs before the run row; `worktreeAddArgs` (LF pair) in implementation-stage; doctor checks.
  Spawned-CLI tests set `NODE_OPTIONS` to the redirect preload; in-process tests import it.
  The hazard-19 rule (ceiling + 5 s grace < executor idle) is checked once, in `freezeProfile`
  against `CLAUDE_CODE`; `invalidSandboxReason` is shape-only. Checking it on every profile load
  refused ~200 fixtures that shrink the executor idle to 30 s for non-sandboxed stages.
  Doctor sandbox tests live in `test/doctor-diagnostics.test.ts`; `frozen_sandbox_image` names the run.
- Task 8 (2026-10-19): `verifyCommit` and `regenerateDerivedArtifacts` each run one sandbox through
  `withSandbox` (container.ts) and `runInSandbox`; `removeIgnoredOutput(frozen, ...)` removes through
  `removeIgnoredOutputInContainer`. `verifyCommit` returns `record: null` for a start failure, an
  unreadable exit status, or an unproven teardown (`unquiescedReason`); the stages block with no
  result.json (verification) or `abort` (code review). Sandbox audit actions are the stage's own:
  `verification.sandbox.*`, `code_review.sandbox.*` (not under `.verification`/`.remediation`),
  `implementation.sandbox.*`. Labels: `verification`, `remediation-N-verify`, `derived-<label>`.
  `runVerifyCommand` lost `envPassthrough` and `shell`. Bootstrap runs the starter's
  `governed.yaml` commands in a run-0 `bootstrap` sandbox (evidence `.governance/bootstrap/`), and
  `inspectBootstrapPrerequisites` gained `docker_engine`, so `VERIFY_ENV_PASSTHROUGH` and
  `policy.verifyEnvPassthrough` are deleted (plan Task 8's "if it runs them" branch). The bootstrap
  `npm` host check stays (follow-up: nothing on the host runs npm now). Stand-in gained an
  `unstartable` mark and joins argv itself on Windows (DEP0190 reached command stderr);
  `sandboxPrefix()` helper. `governed-config.ts` TOKEN comment updated, rule unchanged (follow-up).
  Task 8 tests pass: commit-verification 8, derived 10, verify-command 5, verification-stage 24,
  project-bootstrap + policy 37; 6 break-tests (bt-task8.json) broke and restored byte-identical.
  Task 8 done: full serial no-engine suite 1741 pass, 0 fail, 17 skipped (1758 tests).
- Task 9 (2026-10-20), code done, verification partial: `dispatchInSandbox` (dispatch.ts) runs each
  patch dispatch in its own sandbox (`withSandbox`, tool server on the work container ID, frozen
  ceiling and `budgetUsd`, proxy log captured to `toolEvidence().proxyLogPath`). Phases, self-review
  and remediation use it, then `commitWorkspace`; labels `phase-N`, `self-review`, `remediation-N`.
  Audits: `<stage>.sandbox.failed|quiescence.failed|teardown.failed` (proxy-log failure counts as a
  teardown failure); phase refusal `implementation.workspace.refused`, empty phase
  `implementation.content.invalid`; `*.derived.discarded` forwarded; `phase.dropped` gone.
  Self-review unusable reply (incl. a failed dispatch that wrote files) -> `discardWorkspace`
  (new, workspace-commit.ts) then `selfreview.skipped` with `discarded=`; empty diff passes with no
  commit. Remediation base is `currentCommit` (plan text says `patchBase`, which is the handoff base
  and would always fail commitWorkspace's head check). Prompts: `WORKSPACE_TOOLS_RULES` (spike
  preamble generalized), reply shape + status sentence per prompt, escaping lines dropped (no file
  content in the reply), `derivedArtifactsLines(v, workspace)` adds the plan's rewrite sentence; the
  old "and a patch that changes one" clause removed everywhere (now false: derived edits are
  discarded). Deleted: PATCH_RESULT_SCHEMA, SELF_REVIEW_RESULT_SCHEMA, ProposedPatch types and the
  validator's patch arm, dropUnchangedFiles/sameBlobAtCommit/readSelfReviewReply, movedPaths.
  Search: no document-stage reader of patches (only the three dispatches and patch-application.ts).
  BLOCKED: deleting src/patch-application.ts + its test needs Snitch approval; Snitch's decision
  worker was unavailable, then the server disconnected. Until deleted, typecheck fails there only.
  prompts.test.ts's emitter-composition test and harness-stream-fixtures.test.ts are emitter tests
  and move to Task 10. Tests passing: agent-result, implementation-self-review, implementation-gate,
  recorded-implementation-response (35).
- Task 10 (2026-10-20): emitters speak tool mode. `emit-implementation-stage.mjs` writes into its cwd and
  answers the workspace reply as structured_output (shape of the spike's `resultLine`); it refuses a
  prompt without `--json-schema` or `--mcp-config`, or with the other schema (`required.includes("critique")`).
  `emit-code-review.mjs` remediation writes its fix; reviewers/reconciler must arrive without either flag.
  `emit-cli-run.mjs` accepts and forwards `--mcp-config` (and accepts `--allowedTools`, `--max-budget-usd`).
  Deleted modes: base-mismatch, empty-files, two-patches, add-existing, modify-missing, phased-add-existing,
  phased-unchanged, phased-all-unchanged, symlink/junction/escape/dangling link modes, self-review
  bad-patch/null-patch, remediation-wrong-base (replaced by remediation-blocked). Link refusal now lives
  only at the boundary (`workspace-commit.test.ts`, mode 120000); the stage passes every path through it.
  `self-review-mutate-fail` now skips with `discarded=unreported.txt` (was a block): an unusable reply's
  writes are discarded by design. New case: `markUnremovable(sandboxPrefix(root, runId, "phase-1"))` blocks
  with `implementation.sandbox.quiescence.failed`, head unchanged. Failed-dispatch summaries now name the
  tool log and proxy log (Task 6). Suites: implementation-stage 58/58, code-review-stage 61/61,
  harness-stream-fixtures 12/12, prompts 61/61. `delivery-coverage.ts` invariant (2) comment no longer
  names patch-application.ts. Operator approved the delete in chat (2026-10-20; Snitch was disconnected):
  src/patch-application.ts and test/patch-application.test.ts removed (tracked, unmodified, recoverable
  from git); `npm run typecheck` clean.
  Full serial no-engine suite (started before the delete and two pin fixes): 1732 tests, 1714 pass,
  2 fail (deleted patch-application.test.ts; cli-operator self-review-not-json pin fixed mid-run), 16 skip.
- Task 11 (2026-10-20): ARCHITECTURE sections 6, 7 (supported toolchain, LF worktree, protected-path
  enforcement point), 8 (workspace reply, computed diff), 11 (command without --safe-mode, tool server,
  caller-enforced sandbox), 12 (implementation/self-review/verification/remediation), 15 (tools/, bootstrap/,
  -mcp.json), 17 (commands contained; key-reachability text now names agent sessions), 20 (patch-dispatch
  limits). hazards 15, 20, 22 dated notes. README prerequisites + "Docker and the supported toolchain";
  runbook prerequisites, fresh-worktree check now runs in the image, 8 troubleshooting rows; CLAUDE.md/AGENTS.md
  identical (sha256 b7af5843…); run-buildworks SKILL Docker prerequisite (the smoke's new-run needs an engine).
  Dashboard reads no deleted event. check:docs clean (new [paths] warnings only in dated historical docs);
  typecheck clean. Deviation: event name `implementation.phase.apply` kept (now with `paths=`), not renamed
  `workspace.commit` as the plan's blast-radius line suggested; consumers (gate parsing, tests) read it.
- Task 9/10 break-tests (2026-10-20, bt-task9.json): dropping the tool server from `dispatchInSandbox`,
  ignoring an unproven phase teardown, accepting a non-completed phase reply, skipping the self-review
  discard, and accepting a non-completed remediation reply each broke their test; all restored
  byte-identical. Gap: remediation's `code_review.sandbox.quiescence.failed` branch has no stage test
  (the plan asked only for the phase case).
- Task 12 done (2026-10-20): typecheck clean; full serial no-engine suite 1731 tests, 1715 pass, 0 fail,
  16 skipped: 12 `test/container.test.ts` ("no Docker engine answered"), 3 native differential POSIX
  (Windows), 1 workspace-commit file-leaf symlink (Windows privilege). The 17th skip of Tasks 7-8 was
  implementation-stage's file-symlink test, deleted in Task 10. `git log -1` = 44a0d3a (unchanged);
  check:docs clean; smoke 13/13 against Docker 29.8.2; `test/container.test.ts` 12/12 with the engine up.
- Independent code review (2026-10-20, a separate agent, review-code at `high`):
  `docs/features/sandboxed-implementer/2026-10-20-code-review.md`, 4 findings (3 confirmed, 1 plausible),
  all accepted, fixed and reconciled in the file:
  - F1 (high): host `git commit` ran target hooks on agent content. `NO_HOOKS` (`-c core.hooksPath=/dev/null`)
    in the workspace-commit and derived-artifacts git helpers; tests with positive controls; ARCHITECTURE 17,
    hazard 15 dated note.
  - F2 (medium): the tool server's `docker` saw only the harness env (no DOCKER_*). `DOCKER_CLIENT_ENV` and
    `dockerClientEnv()` in container.ts; `--docker-env <json>` passed by dispatchOnce, required and validated by
    the tool server, merged into its env. Probe test; container.test.ts 12/12 again with the engine up.
  - F3 (low): stage tests for `implementation.sandbox.failed` (phase, self-review), `code_review.sandbox.failed`,
    and remediation `code_review.sandbox.quiescence.failed` (closes the gap noted above).
  - F4 (low): runbook sandbox.failed row (blocked; fresh run) and the derived paragraph's stale "on the host".
  7 break-tests (bt-review.json) broke and restored byte-identical. typecheck and check:docs clean.
- Full serial no-engine rerun after the review fixes (2026-10-20): 1739 tests, 1722 pass, 1 fail, 16 skipped
  (the same named skips); `git log -1` 44a0d3a. The failure was an after-hook EPERM in
  `test/doctor-diagnostics.test.ts`'s `sandboxTarget` cleanup: the emptied Git target directory was briefly
  held from outside the process (no fsmonitor or maintenance configured); assertions had passed. Reproduced
  2 of 7 isolated runs, on different doctor tests. Fix: `removeTarget`, the bounded EPERM/EBUSY retry already
  recorded in `test/verify-command.test.ts`. Then 10 of 10 runs clean, whole file 36 pass / 4 skip, typecheck
  clean. Full suite not rerun after that test-only change. Three empty `.doctor-sandbox-*` directories left
  by the failing runs remain in the checkout root (operator's call to delete; Snitch disconnected).
- Plan Status set to `Implemented` with an implementation record; check:docs clean. Task 13 not run.
- Second review (2026-10-20, operator's `/code-review high`, 10 unverified findings):
  `docs/features/sandboxed-implementer/2026-10-20-code-review-2.md`, reconciled. Fixed: F1 gitlink (mode 160000)
  refused (reproduced: committed nested repo's `core.fsmonitor` ran on host `git status`); F3 refused diff kept
  as commit under `refs/buildworks/refused/<sha>`; F4 `NO_PROXY=localhost,127.0.0.1,::1` (`LOOPBACK_HOSTS`);
  F5 `completed` + non-empty `incompleteTasks` refused; F6 `list_files` strips `/work/` once per line;
  F8 `implementation.workspace.failed` for a kind-`failed` commitWorkspace result; F10 doctor test targets
  under tmpdir. Rejected unreachable: F2 (Linux git lists `?? gen`, nothing behind a symlinked parent), F7
  (starter `npm ci` makes no node_modules). Declined: F9 helper consolidation. 7 break-tests (bt-review2.json)
  broke and restored by SHA-256, two on the real engine. Full serial no-engine suite: 1746 tests, 1728 pass,
  0 fail, 18 skipped (14 container, 3 POSIX, 1 symlink); container.test.ts 14/14 real engine; typecheck clean;
  `git log -1` 44a0d3a. Lesson added to `~/.claude/lessons.md` (read what a validator checks before ruling a
  finding unreachable).
- Operator 2026-10-20: "yes, delete the failed test runs, then lets run the paid validation". The three
  `.doctor-sandbox-*` dirs were deleted. Two were not empty as previously reported: each was a doctor test target
  repo (governed.yaml, .gitignore, one `base` commit). Task 13 step 1, the CLAUDE.md probe (scratchpad
  `claude-md-regression.mjs`, ported from the spike probe), cost $0.00432976 in 3 Haiku calls. With the tool
  server and as a read-only dispatch, neither the planted nor the global CLAUDE.md loaded. The control without
  `--restricted` fired on both signals. Fixture: `test/fixtures/recorded/sandboxed-implementer-claude-md-regression.json`.
  Steps 2 and 3 (the paid chains) await their own consent.
- Operator 2026-10-20: "start step 2. ALso launch the dashboard". The web-calculator paid chain completed: 21
  dispatches, $1.53764, 15/15 steps, 2 panels with 1 remediation, 4/4 delivered, audit chain valid. Target kept at
  `C:\Users\tamezs\buildWorks_test_repos\sandboxed-web-calculator-2026-10-20\target`. Patch dispatches: phase 1
  $0.090 15 s (2 write), phase 2 $0.114 29 s (2 read, 3 write), self-review $0.092 13 s (1 run_command sed fix),
  remediation $0.079 13 s (1 write). No packages installed, proxy logs hold only start lines, no sandbox failure
  events, no leftover bw objects. Dashboard launched on 127.0.0.1 over a scratchpad repositories file naming only
  this target (the operator's buildWorks_test_repos/dashboard-repositories.json was not changed). Recorded in the plan.
  Step 3 (crew-chatter feature 3) awaits consent.
- Step 3 prep (operator 2026-10-20: "Lets move on to step 3"): proposal 30 exported and its `## Problem` body
  committed in crew-chatter as `e94a189` (`docs/features/crew-chatter-attachments-versions/design.md`, the
  split's slug); export moved to `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-20-feature3-export`.
  `new-run --after 7` REFUSED: run 7's profile has no `sandbox`, and `readRunSnapshot` loads profiles via
  `loadVerifiedProfile` (execution door), so deliveredCommit/finalReviewedCommit are null. `status --run 7` and
  the dashboard show the same for every pre-sandbox run. A gap in this plan's blast radius (assumed no run in
  flight; missed the chained-feature read). Operator: "lets do both". Run 8 was created WITHOUT `--after` (link
  hand-checked: c5d2ff3 is an ancestor of e94a189) and started with `run --yes` in the background (output
  `$TEMP/t13-crew8.out`; settings `--model claude-sonnet-5-5`, narration on; estimate $5-7). Dashboard relaunched
  over crew-chatter and the web-calculator target. Fix planned (not built):
  `docs/features/inspectable-frozen-profiles/plan.md` (Proposed; snapshot verifies evidence against a
  hash-verified "inspectable" profile; execution keeps `loadVerifiedProfile`).
- Run 8 paused at approval after spec ($3.26 so far: the spec author alone $3.248, 1.8x runs 6/7). The operator
  signed ("approved"; approval 5, signer 893f0765…), and run --yes resumed. Run 8 COMPLETED: 23 Claude dispatches
  $6.34541 + 16 Decision-1; 10/10 stages; delivery 14 artifacts over c96d569..b8e6613; chain valid. 3 phases + a
  self-review with no change, $1.161; verification passed first time in container; round 1 had 3 findings (1 rejected by
  the reconciler), 1 remediation; round 2 had 3 non-blocking. Phase 1's agent ran `npm ci` and the typecheck/lint in
  its container (16 registry requests allowed, 0 denied); the lockfile was unchanged after every phase; agents
  edited via run_command scripts too. No leftovers; tree clean. Recorded in the plan. Task 13 complete. Branch
  gov/crew-chatter-attachments-versions/8 is NOT merged to crew-chatter main (operator's call).

## Design decisions made during the build (for the implementation record)
- The tool server takes `--docker <json argv>` besides `--container`, `--log`, `--timeout`, so it runs
  the frozen `sandbox.dockerCommand` (hazard 12) rather than a bare `docker`.
- File tools (`list_files`, `read_file`, `write_file`) use `execCaptured` (stdin piped, same wrapper and
  exit-status read); `run_command` uses `runInSandbox` -> `runVerifyCommand`, with evidence at
  `<log>-call-<seq>.log`.
- `list_files` no longer skips `node_modules` (extension point 4 bans the literal); depth 3 and the
  200,000-character answer cap remain.
- The proxy runs `node` from the frozen image, so an image must provide `sh`, `timeout`, `sleep` and
  `node`; the program check covers them.
- The Docker client inherits the process environment (control calls and exec); a container gets only
  explicit `--env` assignments. This keeps the plan's `-e ANTHROPIC_API_KEY` break-test meaningful.
- `runVerifyCommand` gained `evidenceHeader`. Task 6 first forced `shell: false` for every caller,
  which broke host-side `npm` derived regeneration on Windows (`spawn npm ENOENT`); found by the
  guided journey under the no-engine run, bridged in Task 7 with a `shell` option, and removed in
  Task 8 once no host caller remained.
- Image tag `bw-sandbox:<sha256(Dockerfile)[0:12]>`; `ensureImage()` alone knows the Dockerfile location.
- Tests reach the Docker stand-in in a spawned CLI through a `NODE_OPTIONS --import` preload that
  redirects `docker` spawns (the existing claude-probe fixture pattern), and in-process through frozen
  `dockerCommand`.
- The hazard-19 ceiling-vs-idle check moved from profile validity to freeze time (plan line 28 states
  the relation, not where it is enforced); a loaded profile is checked for shape only.
