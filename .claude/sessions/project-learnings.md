# Project learnings — BuildWorks (governed-delivery)

Current state is the resume point and is rewritten in place. Session records below it are
history and may name superseded state; Current state wins when they disagree. This file is
the system of record; machine-local memory is only a cache
(`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-10-22: change 7 built, `Implemented` and committed on `sandboxed-delivery` (`c52017f`, records `214bb84`), not pushed; Task 10's paid run and a Target Tap run completed; the served-browser-pages fix is built, `Implemented` and committed (`663b789`), not pushed; change 4 and change 1 built and committed; crew-chatter run 8 not merged; no spend authorized)

**Change 7, reproduced review findings (2026-10-22).** `docs/features/reproduced-review-findings/plan.md` is `Implemented`. The build is `c52017f`; the paid-run records, the false-confirmation fixtures, hazard 18's measured paragraph and the fix plan are `214bb84`. `docs/runbooks/workflow-explorer.html` is not part of either.
- **Independent review: 7 findings, all fixed.** Operator decisions:
  - finding 1: drop a refused reply's reproductions and keep its findings;
  - finding 2: a matcher on a missing element is `repro_failed`;
  - findings 3/4: each reproduction and check runs alone in its own checkout and sandbox, and checks run after verification passes;
  - finding 6: remediation mounts only `.governance/code-review/<run>/preserved/`.
- **Regression:** the full suite is 1877/1883, with 4 skips. Its 2 failures are the `sign-approval` keygen refusal tests: Node v26.4.0 aborts in `process.exit` with a libuv `UV_HANDLE_CLOSING` assertion, and the script is unchanged. The engine suites pass 28/28, and the benchmark 6/6.
- **Committed** as `c52017f`, with the run records in `214bb84`; neither is pushed.
- **Task 10's paid run (operator-authorized):**
  - It completed: 16 dispatches, $1.49350, at `C:\Users\tamezs\buildWorks_test_repos\reproduced-findings-web-calculator-2026-10-22\target`.
  - Its one panel was clean, so no reproduction was ever written or run. Only the structured reviewer reply is proven live (fixture `code-review-structured-reply-web-calculator-2026-10-22.json`).
  - Confirmation and preservation have no live run, and reviewer recall has no sample.
  - A second paid run, Target Tap, also completed: 19 dispatches, $4.61744, one clean panel, at `C:\Users\tamezs\buildWorks_test_repos\target-tap-reproduced-findings-2026-10-22\target`. It paused at the package decision, which the operator answered from the dashboard; the auto-mode classifier then blocked the assistant's post-signing `run --yes`, so the operator launched it.
  - **Measured (free, on the engine):** both browser runners open `file:///work/`, so a module-script or root-absolute-path page runs no code, and two spec-derived reproductions falsely confirmed against Target Tap's delivered commit. The evidence is in hazard 18 and `test/fixtures/recorded/reproduction-{report-file-origin-ac-014,report-file-origin-ac-016,diagnostic-file-origin}.json`.
  - The fix plan `docs/features/served-browser-pages/plan.md` is `Implemented` (operator-authorized 2026-10-22, built 2026-10-22/23). The build is committed as `663b789` and the delivered-page fixture as `12619c8`; neither is pushed. Both runners now serve `/work` through `container/serve.mjs` on `127.0.0.1:47731` (image `bw-sandbox:975c2e567b66` at Task 1; the review fixes changed `container/` again, so new runs build a newer tag). The Target Tap reproductions are now `not_reproduced` on the engine. The full suite passed 1887/1893 (the 2 `sign-approval` failures, 4 skips). The code review (`2026-10-22-code-review.md`) had 4 accepted and 1 deferred: a runner killed at the ceiling in a shared dispatch container may hold the port, and fixing that is the operator's call. Plan decisions: accept the unretained server exception text (M4), and a `301` for a directory URL without a trailing slash.
  - `.claude/skills/run-buildworks/SKILL.md` still lists `target-tap` as "Never run".
  - Whether to spend again on a run that attracts findings is the operator's call.
- `runAlone`'s thrown-error wrapper is written, not verified.
- The plan's review: `2026-10-22-plan-review.md` (3 critical, 4 high, 9 medium, 5 missing, 2 suggested: 22 accepted, 1 deferred).
- Reproductions are Playwright `.spec.mjs` files (one constant, `REPRODUCTION_FILE_NAME`) run by a new system-owned `container/checks.config.mjs` (`testDir: "/bw-checks"`), one command per file, in a throwaway detached checkout of the reviewed commit, never the run's worktree.
- Operator decisions, 2026-10-22:
  - A failing preserved check is evidence named in the next panel's prompt, never a block; only the final panel's gate blocks. A check that dirties the worktree still blocks (integrity).
  - Only a matcher failure confirms; a locator timeout is `repro_failed`, with the call log's last entry recorded as `detail`.
  - The free benchmark narrows loops in sample `sonnet-5-5-medium-1` of the r1 evaluation record to one failing case each.
  - At most 5 reproductions per reviewer reply.
  - The code-review operating-contract change (`CLAUDE.md`, `AGENTS.md`, section 12, a section 23 entry) is approved; it lands in Task 10.
  - A rejected finding's confirmed reproduction is never preserved.
- Not authorized: another paid run.

**Change 4, protected acceptance tests: built and committed.** `9319f0a` (Tasks 1-10 and its review), `6a63ee7` (Tasks 12-16, the re-review's fixes), `b0f542e` (Task 11's record). The plan is `Implemented`. Task 11's paid run completed: 17 dispatches, $1.72556, the suite 35/35 at verification. Target kept at `C:\Users\tamezs\buildWorks_test_repos\acceptance-web-calculator-2026-10-21\target`; fixture `test/fixtures/recorded/acceptance-web-calculator-e2e-2026-10-21.json`. Container mount argv is not recorded by the system, so that half of Task 11's criterion rests on tests.

**Change 1, sandboxed implementer: built and committed** (`ff260eb`), with inspectable frozen profiles (`7a725e3`). Its Task 13 paid record: web calculator $1.53764 in 21 dispatches; `CLAUDE.md` probe $0.0043; crew-chatter run 8 (below). Detail is in `docs/features/sandboxed-implementer/plan.md` and `.claude/sessions/2026-10-19-sandboxed-implementer-build.md`.

**Open, the operator's call:**
- Whether to fix the served-browser-pages code review's deferred finding 2 (a runner killed at the ceiling in a shared dispatch container may hold port 47731). Which change to build next: the rest of the rework is unbuilt except changes 1, 2, 4, 7 and 10.
- Whether to merge `gov/crew-chatter-attachments-versions/8` into crew-chatter `main` (still at `e94a189`). It must be a merge, not a squash, before feature 4 can use `--after 8`.
- `sandboxed-delivery` is not merged to `master` until the rework is complete, and there is no PR to `master` (operator, 2026-10-17/19).
- `docs/runbooks/workflow-explorer.html` is untracked and the operator's; it was left out of every commit. A plain-text API key copy sits at `C:\Users\tamezs\.buildworks\[Environment]SetEnvironmentVariable.txt`; removing it is the operator's call.
- Deferred (2026-10-20, "we wont worry about it now"): the dashboard shows evidence availability `unverified`; `agent_run.output_hash` could verify it.
- Deferred: the inspectable-profiles review's duplicate reason at the approval boundary.

**Crew-chatter on this machine** (`C:\Repositories\testing-repos\crew-chatter`):
- `main` is at `e94a189` (feature-3 design). Earlier: `c5d2ff3` after merging runs 6 and 7, `1497e7a` feature-2 design, `ec2049c` the lockfile `derived:` block, `8f539e5` feature-1 design, `eb1fa30` the TS backend plus React frontend baseline.
- The PRD split gave 7 features, proposals 28-34. Features 4-7 are proposals 31-34 and are not exported. To export one, keep the text from `## Problem` up to `## Why this is upstream` and commit it as the feature's `design.md` under the split's slug.
- Runs: 1 $1.80 (the split); 2 $0.97 blocked, fixed in `561ce9e`; 3 $3.44 blocked on undeclared artifacts (worktree 3 and `.governance/raw/3` are the only full raw streams; keep them); 4 $1.78 stopped at the decision pause; 5 $4.04 blocked at typecheck TS2698, superseded by 6; 6 (`crew-chatter-accounts-notes`) $4.91524352, merged; 7 (`crew-chatter-folders-tags`, `--after 6`) $5.56758051, merged to `c5d2ff3`. Asides for runs 3-7 are under `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-1{8,9}-run<N>`.
- Run 8 (feature 3, `crew-chatter-attachments-versions`, 2026-10-20, sandboxed): completed, $6.34541 in 23 dispatches plus 16 Decision-1; the spec author alone cost $3.248. Created without `--after` (ancestry `c5d2ff3` → `e94a189` checked by hand). 3 phases plus a no-change self-review; round 1 had 3 findings (1 rejected), 1 remediation; delivery 14/14 over `c96d569..b8e6613`; audit chain valid. Phase 1's container made 16 registry requests, 0 denied. Export aside `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-20-feature3-export`.
- Changes 2 and 10 (`1cda025`): three model-triggered paths have only test proof (regeneration after a self-review fix, a remediation regeneration that commits, the unapproved-addition refusal). Change 10 is npm only, additions only, no allowlist.

**Rework proposal** (`docs/proposals/sandboxed-delivery-rework.md`, ten changes in three tracks). Changes 1, 2, 4, 7 and 10 are built and committed; change 9 (`docs/proposals/whole-run-replay.md`) is designed only.
- Operator facts (2026-10-18): every developer has Docker Desktop with WSL 2, Docker first; each holds a personal Claude Code Enterprise seat, and BuildWorks has no credential of its own; runs happen on the operator's workstation; Docker, WSL and Claude Code are replaceable between BuildWorks versions, never during a run.
- So `claude` stays on the host and reaches the container only through the agent-neutral MCP tool server. Every deciding check stays agent-independent. The adapter interface is extracted only when a second agent is added (MHA-03).
- Changes 4 and 7 were revised on 2026-10-20 from the blocked web-calculator run: interaction criteria need a real browser with trusted input, and a confirmed repro must hold every later commit while "no repro, so advisory" never delivers a real high.
- Change 4's research grounding: ImpossibleBench (read-only tests keep performance, an abort path cuts cheating, prompt wording matters), OpenAI's verify-returns-true example, SWE-bench's FAIL_TO_PASS/PASS_TO_PASS split.
- The multi-stack model is recorded unbuilt in `docs/proposals/target-declared-environments.md`.
- Open: whether per-seat use is "ordinary use" under Claude Code's legal terms.

**Runbook defect, unfixed:** the approval export breaks under PowerShell 7.6. `ConvertFrom-Json` turns the `--expires` ISO string into a local date. `-DateKind String` fixes it but does not exist in Windows PowerShell 5.1, so `docs/runbooks/cli-operator.md` and `README.md` still need a fix that works in both.

**Decision-1 (`src/systemone.ts`, the operator's Foundry resource, API key):**
- Config comes from user-scope `SYSTEMONE_ENDPOINT`, `SYSTEMONE_DEPLOYMENT`, `SYSTEMONE_DEPLOYMENT_TYPE` and `SYSTEMONE_API_KEY`. The deployment type is never checked (operator, 2026-10-17).
- The probe fixture is `test/fixtures/recorded/systemone-probe-snitch-resource.json`. D6 fails the confirmed rule at T = 0.8.
- Format checks (`docs/features/decision-1-format-checks/plan.md`, `Proposed`): narration passes and grounding fails. Never relabel cases or split a check by kind after seeing answers.
- Narration is wired into spec review (`6cb2e3b`). No live run has flagged anything yet, runs 3-8 included.

**Web-calculator paid runs under current defaults** (Haiku 5.5 reviewers, sonnet-5-5 reconciler):
- 2026-10-15 $1.39416 in 21; 2026-10-17 (narration on) $1.51048 in 22; 2026-10-20 sandboxed $1.53764 in 21; 2026-10-21 with acceptance tests $1.72556 in 17. Patch dispatches cost $0.08-0.11 each and took 13-29 s.
- 2026-10-20, second sandboxed run: $1.32615 in 21; **blocked at code_review**. Round 1 kept finding 9 (Enter on the focused theme toggle does equals); the remediation exempted every focused button, so Enter after a click on `+` re-runs `+`; round 2 blocked on that as a high (finding 10). No BuildWorks defect: the remediation prompt already said to keep every plan task. Evidence `test/fixtures/recorded/code-review-web-calculator-remediation-regression.json` (with both reviewed `trees`); analysis `.claude/sessions/2026-10-20-debug-web-calculator-remediation-regression.md`.
- Structured-output open decisions 1 (remediation drops unchanged files) and 3 (other dispatches to a schema) remain undecided.

**Working state (verified 2026-10-23):**
- `dashboard-restyling` is pushed at `7446cd0`; `sandboxed-delivery` is pushed through `5e4154e`; `de99c1d`, `c52017f`, `214bb84`, `83c8bd3`, `12619c8` and `663b789` are local only. Pushing uses the personal gh account (auto memory).
- `CLAUDE.md` and `AGENTS.md` are byte-identical.
- Unbuilt by choice: `baseline-verification`, `implementation-phase-retry` (`Reconciled`), `implementation-segments-and-pause` (`Shelved`), `usage-limit-refusal-summary` and `code-review-contract-drift-issue` (`Proposed`). `dashboard-pwa-redesign` is `Reconciled` with Task 7 next.
- No run or background process is in flight.

**Open work list (operator asked for one list, 2026-10-13):**
1. **Code-review reconciler** (`6282a6f`): live rejections happened in run 6 (finding 113) and run 8. Not done: the passed-branch check in `src/operator-state.ts`, reachable only with a forged audit event. A quote proves the words exist, not that they support the rejection (hazard 16).
2. **Implementation self-review** (`fd235a8`): no patch yet on crew-chatter; on the 2026-10-20 web calculator it made one `run_command` sed fix.
3. **#209:** `test/code-review-run-6-evidence.test.ts` pins both control findings.
4. **Reviewer recall** (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`): each call reports about 2 of 8+ known defects. Undecided: merged samples per lens, or the `basis` field alone.
5. **Effort replay** (`...-security-effort.json`): distinct defects per call of 7 were 2.1, 2.5 and 3.9 for Haiku `medium`, `high` and `xhigh`, costing $0.008, $0.019 and $0.110. Undecided: the reviewer default effort.
6. **Spec/plan reconciler stays on Sonnet 5.5** (recommended).
7. **Crew-chatter run 6 on the other machine:** blocked at code review round 2; undecided.
8. **Older backlog:** the dashboard split card still offers Modify, which the core refuses; `ARCHITECTURE.md` section 14 and README line 94 still say `git mv`; split designs carry no parent open decisions; plain-prose open questions under another heading still pass `validateSpecDoc`.

**Backlog plans, detail kept because nothing else records it:**
- **Phase retry** (`docs/features/implementation-phase-retry/plan.md`): a frozen `implementationPhaseAttempts`, seeded 2 with ceiling 3, retries only a reply refused with " is not valid JSON: "; the retry prompt is the original plus a refusal notice. Task 3, the fixture from crew-chatter run 2 phase 2 on the other machine, is not done. Structured output and the tool server may have removed the need; the operator's call.
- **Toolchain probe** (`docs/proposals/toolchain-probe-and-stack-intent.md`): the check must stop the run before spend and name the failing command, exit code and end of output.
- **Usage limit** (`docs/proposals/usage-limit-refusal-strands-a-run.md`): option B is planned and option C is unauthorized. Re-verify the plan's `failed()` suffix lines before building.
- **Baseline verification:** the runbook check "Prove the verification commands run in a fresh worktree before you spend" is the chosen route.
- **Code-review prompt wall:** a prompt over 1 MiB is refused (hazard 18), about 130-160 task items [Inference, n=2]. Splitting the design is the only route past it.

**Shipped and committed:**
- Spec operator decisions (2026-09-27), streaming harness output (`85fccad`), per-agent settings (`c539e59`), phased implementation and the one-repair extractor (`3c19653`), verification-aware prompts (`c9ef115`), Haiku 5.5 reviewer defaults (`e2d9bd0`) and the eight-failure fixes (`fd756a7`).
- Design split and code-review reconciler (`6282a6f`), self-review (`fd235a8`), structured patch output (`94e3b98`), Decision-1 narration (`6cb2e3b`, `05803eb`), open decisions outside section (`561ce9e`) and declared artifacts in tasks (`dashboard-restyling`).
- Changes 2 and 10 plus prompt retention (`1cda025`), run documents under `.governance/documents/` (`5e3832b`), the change 1 spike (`28a5786`), plan (`44a0d3a`) and build (`ff260eb`), inspectable profiles (`7a725e3`), change 4 (`9319f0a`, `6a63ee7`, `b0f542e`).
- Seeded defaults in `src/policy.ts`: Opus 5.5 `high` authors; Haiku 5.5 `medium` spec and code reviewers and code-review reconciler; Sonnet 5.5 `medium` implementer and `acceptance-test-author`. `--model` freezes only the spec/plan reconciler.

**Decisions locked (operator):**
- The operator signs approvals. The assistant never reads or invokes `~/.buildworks/approval.key`.
- A completed paid run never authorizes another spend; ask before each paid range.
- The design splits inside spec review above 30 declared files, and the operator merges each feature before the next starts. Hazard 22: clean ignored output after the checks pass.
- Self-review finds and fixes in one dispatch after the last phase. The code-review reconciler runs before remediation only. Patch dispatches use `--json-schema`.
- Change 1 choices: discard and regenerate agent edits to derived files; LF worktrees; $2.00 per patch dispatch; no `--safe-mode`; Node/npm only, with four extension points held by tests; errors are never swallowed (`ContainerError`) and teardown failures are recorded.
- Change 4: tests are not written beforehand by the operator; an independent author writes them from the criteria (go deeper, not wider).
- Stored run-document refs stay absolute. Test projects are stand-ins; only BuildWorks handling larger designs counts.

**External targets on the other machine** (`C:\Users\Shawn-work\repositories\testing-repos\`, checked 2026-10-16):
- crew-chatter `master` is at `8063995`, with branches `gov/crew-chatter/2`, `/3` and `gov/crew-chatter-foundation/6` (`ca0bd0e`). Run 1 reads nonterminal, so use low-level commands.
- Also there: `web-calculator-selfreview-2026-10-14\target`, `json-schema-probe\`, and team-notes (runs 1-12, none delivered, "not a real scenario").

## Diagnostics quick-reference

### Prompts, parsing and provider output
- `specReviewGate`/`planReviewGate` block only on `cannot_determine`/`upstream_blocking`; only `code_review` gates on severity.
- A prompt criterion narrows model judgement but does not settle it. A gate decision needs a deterministic rule or a human; a checked field (the `basis` field: 10 of 10) beats a reworded prose prohibition, which also suppresses wanted output.
- A reviewer call is one sample: each Haiku security call found about 2 of 8+ known defects, a different 2 each time.
- Every dispatch runs `--restricted`. `--safe-mode` is gone since change 1, because it discards an `--mcp-config` server. `--restricted` alone keeps every `CLAUDE.md` out, under the tool server and for read-only dispatches (fixture `sandboxed-implementer-claude-md-regression.json`).
- `test/fixtures/harness/emit-spec-stage.mjs` routes by prompt substring (`self-critique`, `spec reviewer`, `reconcile`, `spec author`) and answers every `finding <digit>`; new prompt text must avoid those words.
- Boundary asymmetry caused seven defects; inspect both sides of every comparison. Put field and section constraints in prompts (`CONSTRAINT_STRINGS` scans source, so don't wrap a pinned phrase across a template-literal line).
- When a prompt asks a model to branch on a fact the system can compute, state the fact, not the rule.
- "Fenced block is not valid JSON" names the candidate, not the cause. Code fences anchor to line start (hazard 1 item 9). The one-repair extractor escapes raw control characters only.
- Every `## Tasks` item and `## Coverage` line is a normative node; an unclaimed rewording fails closed.
- Model IDs: the installed `claude.exe` carries its catalog as strings (`grep -a -o`, no spend). `claude --effort` with an unknown value only warns; only requested effort can be recorded.
- A `result` line with `is_error: true` / `api_error` can follow `max_tokens`; thinking counts toward the cap. Read the last line of the retained stream, not the exit code.
- `--json-schema`: the answer arrives through a `StructuredOutput` tool call as `structured_output`. A missing `structured_output` is a failed dispatch whose refusal names the line's cost. Only `enum` has been exercised; whether `pattern`, `maxLength` and `maxItems` are enforced is unknown, so re-check every bound at the boundary.
- Read `permission_denials` on every probe result line before describing what the model saw.
- Since change 1, patch agents also edit by shell (heredocs, `sed -i`, `node -`) through `run_command`, not just `write_file`. The computed diff covers both.

### Code review stage
- A code_review block is a result, not a driver fault; a pass can retain findings, and a final panel gets no further patch.
- Finding IDs are system-assigned; `intentKey` dedup works within a round only.
- Remediation is where out-of-spec obligations enter (run 6; run 7 findings 138/139 came from the remediation's double-submit guard). It also breaks plan rules its prompt told it to keep (web calculator 2026-10-20). Only an executed check holds such a rule, not prompt text or a self-reported field.
- An interaction defect that involves a focused button's native Enter activation needs trusted input (a real browser). jsdom and `dispatchEvent` never trigger activation, so a test of the correct behaviour fails there.
- Concurrent panels consume `Promise.allSettled` results in frozen panel order.
- `insertFindingDecision` requires grounding exactly for `rejected_with_rationale` and normative changes exactly for `addressed`.
- Code review's clean guard counts ignored entries; `verifyCommit` removes ignored output after the checks pass (hazard 22), and only after a pass.

### Acceptance suites and the browser image
- The runner config (`container/acceptance.config.mjs`) fixes `testDir: "/work/acceptance"`, and `readAcceptanceReport` hard-codes the `acceptance/` root and `/work/` prefix; running a file anywhere else needs its own config and reader root.
- `classifyFailure` counts both a matcher failure and a locator-action timeout as `valid_red`; a locator timeout's message carries Playwright's call log, whose last entry says what it waited for.
- `test-author-evaluation-web-calculator.json` is the round that **failed** its thresholds (gate 0/3, neither finding caught). The passing records are `-r1.json` (Sonnet 5.5 `medium`, the seeded setting) and `-r2-rescore.json` (Opus 5.5 `high`); their controls differ from the failed round's.
- The image tag hashes every file under `container/`; any new file there builds a new image for new runs and leaves frozen runs on theirs.

### Evidence, runs and storage
- Raw files hold the whole `stream-json` stdout; read cost and result from the last line (`parseEnvelope`).
- Identify revisions by hash, not dispatch order; zero audit counters prove nothing. Query before `driver.mjs clean`; the table is `audit`; `Store.exec` forbids audit writes.
- Use a durable target directory (Windows deletes temp targets at logoff) and extract load-bearing responses into `test/fixtures/recorded/` at once.
- `| tail -N` buffers paid output; redirect logs. A timed-out wait can leave the chain running; never relaunch blindly.
- A hot journal made read-only SQLite return 776; readers never repair. Read-only Git needs `--no-optional-locks` and `-c diff.autoRefreshIndex=false`.
- `envPassthrough` freezes names, not values. A doctor pass is not auth proof.
- Run documents live in the target's `.governance/documents/<run>/`; only the projections commit puts them under `docs/features/<slug>/`. Older runs left them untracked in the checkout, so move those aside before `new-run`, `doctor` or a merge.
- Two doors read the frozen profile. `loadVerifiedProfile` (execution) refuses any shape change. `loadInspectableProfile` (snapshot, `status`, dashboard, `--after`) tolerates only the execution-only fields `after`, `sandbox` and a removed policy field. A new frozen field that anything on the snapshot path reads makes every earlier run uninspectable; check the stored runs with the predicate itself, not by comparing keys.
- A full `npm test` can leave an empty "moved" commit (author `t`); check `git log -1` after full runs.
- A dispatch exiting 1 within seconds is usually the session limit (`rate_limit_event` `rejected`); it is not always free.
- Spec, plan, fold and split authors run in the target root, and reviewers do not. A target commit after `new-run` never reaches that run.
- `npm ci` fails when `package.json` and the lockfile disagree; declare the lockfile under `derived:` or install everything in the baseline.
- A control prompt rebuilt byte-identical to a recorded dispatch (`input_hash` match) makes a replay comparable; rebuild older prompts from `git archive <commit> src`.

### Guided mode and intake
- Run identity has no uniqueness constraint; re-query the exact tuple under the writer lock.
- Compare committed blobs with LF constants and the worktree with HEAD through Git (`core.autocrlf=true`).
- Guided mode refuses `--repo` and redirected stdin, so the assistant drives live runs with `migrate`, `new-run` and `run --yes`.
- Intake requires a readable HEAD, a clean tree, a committed `governed.yaml` and `.governance/` ignore rule, and the design at `docs/features/<slug>/design.md`. `new-run` also refuses on an untracked `.claude/`.
- `run --yes` consent covers only through the approval pause; implementation needs a second `run --yes` after the signature.

### Dashboard
- Snapshot caches key by repository and run; every overlapping refresh path needs its own generation guard.
- `--repositories-file` and the assets are read once at startup; a restart mints a new port and token. Give the operator the URL in a code block: Markdown bold around it broke the fragment token when clicked (2026-10-20).
- Sandboxed runs show nothing in Docker Desktop afterwards: work containers and networks are removed per dispatch.
- An executing stage is usually `pending`, not `in_progress`; take predicate values from the writers.
- `prefers-reduced-motion: reduce` disables the ledger sweep and live-tag pulse by design.

### Windows, Node and TypeScript
- `evidence.end(cb)` fires before the descriptor closes; wait for `'close'` before deleting. Node v26.4.0 `rmSync` does not retry EPERM despite `maxRetries`; tests use a bounded EPERM/EBUSY retry (`removeTarget`).
- The PowerShell 5.1 approval-transport test fails from the assistant's shell but passes in the operator's terminal.
- `child.kill("SIGTERM")` can terminate without running Node's handler on Windows.
- Keep the file glob in any `npm test` variant. Full suite: `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` (about 13 minutes; background it). `test/container.test.ts` needs a real engine and skips by name without one.
- On the Shawn-work host prefix commands with the npm-global claude-code bin on `PATH`, or `executor_probe` fails.
- A scratch `.mjs` imports repository TypeScript only through a `file:///C:/...` URL.
- The auto-mode classifier sometimes blocks an action outright (launching `claude` unrestricted, deleting target files); stop and give the operator the command.
- `git worktree remove` fails with "Filename too long" over `node_modules`; clear leftovers with `robocopy <empty> <dir> /MIR`.
- `npm run`/`npm test` export `.npmrc` as `npm_config_*`; `allow-scripts` makes a child `npm ci` fail with `EALLOWSCRIPTS` (bootstrap uses `VERIFY_ENV_PASSTHROUGH`).
- Open SQLite only through `openDatabase` in `src/sqlite.ts`. A new subprocess that reads a diff copies the existing diff readers' buffer size.

### Documentation and working practice
- `doc-check` recognizes only backticked forward-slash paths under `src`, `test`, `scripts`, `docs` or `.claude`; section 5's deferred list is every backticked `[a-z_]+` token. Review and reconciliation files under `docs/features/` need a `**Hazards considered:**` line too.
- Edit `CLAUDE.md`, copy to `AGENTS.md`, then compare hashes. An `ALTER TABLE ... ADD COLUMN` migration must be folded into `scripts/doc-check.mjs` and `test/schema.test.ts`.
- `test/dashboard-ui.test.ts` is excluded from `tsc`; a changed signature fails only at test time.
- The Edit hook needs a full Read in the current context; reads before a compaction do not count.
- Before a plan, read this file and the relevant `ARCHITECTURE.md` sections, not just `docs/hazards.md`. A plan that changes a seeded default counts the tests asserting it. A blast-radius search for a frozen shape must include stored runs that are read later (`status`, `--after`), not only runs in flight.
- A plan written before its dependency shipped carries premises about that dependency's design, not its code; re-verify each against the shipped source before building (change 7's plan named a mount, a runner invocation and an evaluation record that the build had changed).
- Replay a proposed gate against its motivating failure before planning it. Settle a free-to-answer `[Unknown]` before spend.
- Quote cost from an artifact of the same size, as a range. A spec author can vary 1.8x between runs of similar features (run 8). Effort is not linear (Haiku `high` 2.4x, `xhigh` 14x `medium`).
- A claim reaches the operator only after its source was checked this session; fix a scoring rule before the data exists. Check "empty" before calling a directory empty (the `.doctor-sandbox-*` dirs held test repos).
- A replay script reads the reply's real field path from a recorded reply before spending.
- Before offering a change to a target after `new-run`, trace what the run froze. A field in one sample is not contract; read a second.
- Identify a system-written row by a field only the system writes. Before fixing a review finding, trace its scenario; a test passing under old and new behaviour proves nothing.
- `dispatchOnce` appends " (requested model m, effort e; prompt .governance/prompts/<run>/<hash>.txt)" to failure reasons; don't anchor a regex at the end.
- "Implemented" means built and unit-proven; separate built, committed and proven by a completed live run, and name the paths no live run exercised.

## Session records

### Earlier history (2026-08-29 to 2026-10-21)
- Steps 1-8 shipped; step 9 reached 2026-09-03. Paid web-calculator chains (2026-09-06 to 09-12) cost $1.00-$2.45; three completed.
- 2026-10-04 to 10-15: team-notes runs 7-10, crew-chatter runs 2-6 on the other machine, the design split, the code-review reconciler, self-review and structured patch output. Lesson: when a model-judgement fix fails twice on the same class, offer a deterministic or human-gated route.
- 2026-10-16 to 10-19: Decision-1, crew-chatter runs 1-7 on this machine, the rework proposal, changes 2 and 10 (`1cda025`), run documents under governance (`5e3832b`), the change 1 spike and plan.
- 2026-10-20: change 1 built and paid-validated (`ff260eb`); `new-run --after 7` refused because the sandboxed plan's blast radius missed stored runs read later, fixed as inspectable profiles (`7a725e3`) after a first build that checked "lacks only sandbox" by eye. The second web-calculator run blocked at code review and led to the change 4 and 7 revisions; the operator preferred executed tests over a "re-checked criteria" reply field.
- 2026-10-21: change 4 built, reviewed twice and committed; its test-author evaluation failed round 0, passed rounds 1 and 2; Task 11's paid run completed.

## 2026-10-22 — change 7 plan reviewed and reconciled

### Decisions and assumptions
- Operator settled six choices on the reconciled plan; they are in Current state above and in the plan's "Settled decisions".
- The operator answered the locator question with "shouldnt it state why the locator timedout"; the plan records the call log's last entry, verified only for the never-resolved form (`acceptance-report-valid-red-locator.json`). Task 1's spike records the hidden-element form.
- [Inference, unverified] Playwright treats a positional path as a filter under `testDir`; Task 1 settles it on the engine.

### What failed
- The plan (written 2026-10-20) as reviewed would have confirmed every reproduction: plan 1's fixed config cannot discover `/bw-checks` files, and Task 4's exit-code rule read that failure as `confirmed`. Fixed in the plan (C1, C2), not built.
- The plan's benchmark named the failed evaluation round as passing (H1); fixed to the r1 record.

### Verification
- `npm run check:docs` - clean after the review, the reconciliation and this file; path warnings on the plan name files it creates and a target-only path.

### Deferred and open
- Open: which rework change to build next, and whether to build change 7 now; both need the operator's word.

### Next up
- If the operator authorizes change 7, start with Task 1's free engine spike of the checks runner before any other task.
