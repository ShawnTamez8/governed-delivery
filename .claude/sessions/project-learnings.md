# Project learnings — BuildWorks (governed-delivery)

Current state is the resume point and is rewritten in place. Session records below it are
history and may name superseded state; Current state wins when they disagree. This file is
the system of record; machine-local memory is only a cache
(`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-10-21: change 4, protected acceptance tests, committed `9319f0a` and its review fixes `6a63ee7`; Task 11's paid run completed for $1.72556, its record committed `b0f542e`; change 1 committed `ff260eb`; crew-chatter run 8 completed, not merged; no spend authorized)

**Change 4 (2026-10-21).**
- **Committed.** `9319f0a` holds the protected-acceptance-tests build (Tasks 1-10) and its reconciled code review.
- **Built, not committed.** Tasks 12-16 fix the review's four findings:
  - the suite is mounted from a copy of the commit under `.governance/acceptance/<run>/mounts/`;
  - the assertion rule counts only assertions a test runs;
  - a matcher's argument error is a broken test;
  - an array of promises is settled only through `Promise.all`.

  The re-review, `2026-10-21-code-review-2.md`, is reconciled, and its 4 lint defects were fixed.
- **Validation.**
  - The full serial suite: 1,829 of 1,833 pass, 0 fail, 4 named skips. The engine tests ran in it.
  - Smoke passes 13/13 twice; typecheck and check:docs are clean.
- **Plan status.** `Implemented`, apart from Task 11.
- **Records.** The task record is `.claude/sessions/2026-10-21-protected-acceptance-tests-fixes.md`.
- **Committed.** The fixes are `6a63ee7`.
- **Task 11's paid run.** The operator consented on 2026-10-21, and the run completed: 17 dispatches, $1.72556, one clean panel. The test author passed the gate with 34 reds and 1 guard, and the suite passed 35/35 at verification.
  - The target is kept at `C:\Users\tamezs\buildWorks_test_repos\acceptance-web-calculator-2026-10-21\target`.
  - The evidence fixture is `test/fixtures/recorded/acceptance-web-calculator-e2e-2026-10-21.json`.
  - The record and the doc updates are committed in `b0f542e`.
  - Container mount argv is not recorded by the system, so that half of Task 11's criterion rests on tests.
- **Next.** The operator decides whether to commit the Task 11 record. No spend is authorized.

**Resume point (2026-10-20, still current except as above).** Branch `sandboxed-delivery` is past `7a725e3`, none of it pushed
(`origin/sandboxed-delivery` is `be6a88c`). The operator asked for three commits on 2026-10-20:
- change 1 (`ff260eb`, "commit change 1");
- the inspectable-profiles fix (`7a725e3`);
- the blocked web-calculator run's evidence, which is the commit carrying this line.

`ff260eb` holds the whole change 1 build (89 files, including the deleted
`src/patch-application.ts`):
- `docs/features/sandboxed-implementer/plan.md` is `Implemented`, Tasks 1-13 done. Two code reviews
  are `reconciled`: `2026-10-20-code-review.md` and `2026-10-20-code-review-2.md` (the second fixed a
  gitlink refusal, a refused diff kept under `refs/buildworks/refused/<sha>`, `NO_PROXY` loopback,
  `completed` with incomplete tasks refused, a `list_files` prefix strip, a workspace-failed event and
  doctor test targets under tmpdir). The detail is in the plan's implementation record and
  `.claude/sessions/2026-10-19-sandboxed-implementer-build.md`.
- Validation: the full serial no-engine suite had 1746 tests, 1728 pass, 0 fail and 18 skipped (14
  container, 3 POSIX, 1 symlink). `test/container.test.ts` passed 14/14 on the real engine.
  Typecheck and check:docs were clean.
- Task 13 (paid, each step consented separately):
  - The `CLAUDE.md` probe cost $0.00432976 in 3 Haiku calls. Neither `CLAUDE.md` loaded under the
    tool server or as a read-only dispatch; the control without `--restricted` loaded both. The
    fixture is `test/fixtures/recorded/sandboxed-implementer-claude-md-regression.json`.
  - The web-calculator chain cost $1.53764 in 21 dispatches. It ran 15/15 steps, 2 panels and 1
    remediation, and delivered 4/4. The target is kept at
    `C:\Users\tamezs\buildWorks_test_repos\sandboxed-web-calculator-2026-10-20\target`.
  - Crew-chatter run 8 completed (below).
- **Inspectable frozen profiles: committed `7a725e3`** (`docs/features/inspectable-frozen-profiles/plan.md`, `Implemented` 2026-10-20). The five touched test files passed 228/228 again just before the commit.
  - `readRunSnapshot` verifies evidence through the new hash-verified `loadInspectableProfile`, and
    it still returns only the executable profile, so a refused run shows `profile: null`.
  - The execution-only fields are `after`, `sandbox` and a policy field the current `Policy` no
    longer has. The policy part was the operator's choice, "Extend the rule to policy", made after
    the first live read failed: runs 5-7 still carry `verifyEnvPassthrough`.
  - Live: `status --run 7` now reports `deliveredCommit` `c5d2ff3`.
  - Full suite: 1758 tests, 1740 pass, 0 fail, 18 skipped.
  - The review had 1 medium (fixed) and 3 low findings (2 fixed, and 1 deferred: a duplicate reason
    at the approval boundary).
  - Files: `src/profile.ts`, `src/policy.ts`, `src/operator-state.ts`, `src/code-review.ts`, five
    test files, both plans and this file.

**Next action:** the operator decides:
- whether to push `sandboxed-delivery`. `=` and `docs/runbooks/workflow-explorer.html` were left
  out of every commit; they are the operator's.
- Feature 4 can use `--after 8` once run 8 is merged, now that `7a725e3` is in.
- whether to merge `gov/crew-chatter-attachments-versions/8` into crew-chatter `main`. It must be a
  merge, not a squash, before feature 4 can use `--after 8`. Move the untracked run documents aside
  first if any appear.
- the next rework change after change 1. `sandboxed-delivery` is not merged to `master` until the
  rework is complete, and there is no PR to `master` (operator, 2026-10-17/19). The 2026-10-20
  revision of changes 4 and 7 (below) bears on that choice.
- The blocked run's evidence is committed with this record:
  - the fixture `test/fixtures/recorded/code-review-web-calculator-remediation-regression.json`,
    which carries the delivered files at both reviewed commits;
  - the proposal revision;
  - `.claude/sessions/2026-10-20-debug-web-calculator-remediation-regression.md`.
- Deferred by the operator (2026-10-20, "we wont worry about it now"): the dashboard shows
  availability `unverified` for every evidence reference. That is by design for stat-only checks, but
  `agent_run.output_hash` (sha256 of the raw file) would allow verifying it.

**Crew-chatter on this machine** (`C:\Repositories\testing-repos\crew-chatter`):
- `main` is at `e94a189`, which adds the feature-3 design. Earlier commits: `c5d2ff3` after merging
  runs 6 and 7, `1497e7a` the feature-2 design, `ec2049c` the lockfile `derived:` block, `8f539e5`
  the feature-1 design and `eb1fa30` the TS backend plus React frontend baseline.
- The PRD split gave 7 features, proposals 28-34. Features 4-7 are proposals 31-34 and are not
  exported. To export one, keep the text from `## Problem` up to `## Why this is upstream` and commit
  it as the feature's `design.md` under the split's slug.
- Runs and asides:
  - Run 1, $1.80: the split.
  - Run 2, $0.97: blocked; fixed in `561ce9e`.
  - Run 3, $3.44: blocked on undeclared artifacts; fixed by declared-artifacts-in-tasks. Worktree 3
    and `.governance/raw/3` are the only full raw streams; keep them.
  - Run 4, $1.78: stopped at the decision pause and led to the rework proposal.
  - Run 5, $4.04: blocked at verification typecheck, TS2698 at
    `frontend/src/hooks/useAutoSave.ts(63,44)`; superseded by run 6.
  - Run 6 (feature 1, `crew-chatter-accounts-notes`): $4.91524352, 26 dispatches plus 24
    Decision-1; merged.
  - Run 7 (feature 2, `crew-chatter-folders-tags`, `--after 6`): $5.56758051, 23 dispatches plus
    13 Decision-1; merged to `c5d2ff3`.
  - The run 3-7 asides are under `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-1{8,9}-run<N>`.
- **Run 8, feature 3 (`crew-chatter-attachments-versions`, 2026-10-20), completed under the sandboxed
  implementer:**
  - $6.34541 in 23 Claude dispatches plus 16 Decision-1. The spec author alone cost $3.248, 1.8x
    runs 6 and 7.
  - It was created *without* `--after`, because of the refusal above. Ancestry was checked by hand:
    `c5d2ff3` is an ancestor of `e94a189`.
  - It ran 3 phases plus a no-change self-review ($1.161). Verification passed first time in a
    container. Round 1 had 3 findings, 1 rejected by the reconciler; 1 remediation followed. Round 2
    had 3 non-blocking findings.
  - Delivery passed 14/14 over `c96d569..b8e6613`, and the audit chain is valid. The only
    intervention was the operator's approval signature.
  - Phase 1's agent ran `npm ci`, typecheck and lint in its container: 16 registry requests allowed,
    0 denied. The lockfile was unchanged after every phase.
  - No containers or networks were left behind. The export aside is
    `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-20-feature3-export`.
- Changes 2 and 10 (committed `1cda025`): three model-triggered paths have only test proof. They are
  regeneration after a self-review fix, a remediation regeneration that commits, and the
  unapproved-addition refusal. Change 10 is narrower than its proposal: npm only, additions only, no
  allowlist.

**Rework proposal** (`docs/proposals/sandboxed-delivery-rework.md`, ten changes in three tracks).
Changes 2, 10 and 1 are built; no other change is authorized.
- Operator facts (2026-10-18): every developer has Docker Desktop with WSL 2, Docker first. Each
  holds a personal Claude Code Enterprise seat, and BuildWorks has no credential of its own. Runs
  happen on the operator's workstation. Docker, WSL and Claude Code are replaceable between BuildWorks
  versions, never during a run.
- So `claude` stays on the host and reaches the container only through the agent-neutral MCP tool
  server. Every deciding check stays agent-independent. The adapter interface is extracted only when
  a second agent is added (MHA-03).
- Change 9 (whole-run replay) waits until changes 2, 10 and 1 are built, which is now satisfied. Its
  design is `docs/proposals/whole-run-replay.md`.
- Since 2026-10-20 the proposal carries a status table and a status line on each change: 1, 2 and 10
  are Implemented, 9 is designed only, and the rest are not built.
- Changes 4 and 7 were revised on 2026-10-20 from the blocked web-calculator run, at the operator's
  request.
  - Change 4 needs a real browser with trusted input for interaction criteria, which means a
    browser-capable image and is part of change 4's decision. It also needs tests over each
    criterion-convention variant, plus a route for plan-only behaviour rules.
  - Change 7's repro must become a protected regression test for every later commit. "No repro, so
    advisory" must never by itself deliver a real high.
  - Neither change, as first written, would have caught that run's defect except by chance.
- Two plans were written on 2026-10-20, both `Proposed`, uncommitted and not authorized.
  - `docs/features/protected-acceptance-tests/plan.md` is change 4, rewritten the same day. The
    operator: tests are not written beforehand; go deeper, not wider. The first version, with
    operator-authored tests in `governed.yaml`, is superseded.
    - With `new-run --acceptance-tests`, an independent `acceptance-test-author` writes Playwright
      tests from the criteria, as a step before phase 1 rather than a new stage.
    - A deterministic validity gate checks the suite: it loads, every criterion is covered by ID,
      each criterion has a red test, results are stable under `--repeat-each 2`, and no
      `dispatchEvent` or fixed waits are used.
    - The suite is read-only to every later agent, by an overlay mount and a boundary refusal.
    - A system-owned runner config means no model or target file takes part in the invocation.
    - The implementer gets an abort path for a test that contradicts the specification, and the
      reviewers gain a special-casing lens.
    - Before wiring anything in, Task 4 evaluates the test author on the recorded calculator against
      pre-registered thresholds. It needs a small paid consent of under $5.
    - The research grounding is ImpossibleBench: read-only tests keep performance, an abort path
      cuts cheating, and prompt wording matters. Also OpenAI's verify-returns-true example and
      SWE-bench's FAIL_TO_PASS/PASS_TO_PASS split.
    - The fixture now also carries the approved spec and plan in full (`specFull`, `planFull`).
      That change is uncommitted.
  - `docs/features/reproduced-review-findings/plan.md` is change 7. It needs the first plan built.
    - Reviewers move to `--json-schema` and may attach one `node:test` reproduction per finding.
    - The system runs it against the reviewed commit.
    - Confirmed reproductions of kept findings are re-run after every later remediation. They block
      only at or above the blocking severity.
    - No outcome changes the reconciler's input or the final gate.
  - Each plan lists its operator decisions. Neither adds a policy field, because a new policy field
    would make every stored run uninspectable.
- The multi-stack model is recorded unbuilt in `docs/proposals/target-declared-environments.md`.
- Open: whether per-seat use is "ordinary use" under Claude Code's legal terms.

**Runbook defect, unfixed:** the approval export breaks under PowerShell 7.6. `ConvertFrom-Json`
turns the `--expires` ISO string into a local date. `-DateKind String` fixes it but does not exist in
Windows PowerShell 5.1, so `docs/runbooks/cli-operator.md` and `README.md` still need a fix that
works in both.

**Decision-1 (`src/systemone.ts`, the operator's Foundry resource, API key):**
- Config comes from user-scope `SYSTEMONE_ENDPOINT`, `SYSTEMONE_DEPLOYMENT`,
  `SYSTEMONE_DEPLOYMENT_TYPE` and `SYSTEMONE_API_KEY`. The deployment type is never checked
  (operator, 2026-10-17).
- The probe fixture is `test/fixtures/recorded/systemone-probe-snitch-resource.json`. D6 fails the
  confirmed rule at T = 0.8.
- Format checks (`docs/features/decision-1-format-checks/plan.md`, `Proposed`): narration passes and
  grounding fails. Never relabel cases or split a check by kind after seeing answers.
- Narration is wired into spec review (`6cb2e3b`). No live run has flagged anything yet, runs 3-8
  included.

**Web-calculator paid runs under current defaults** (Haiku 5.5 reviewers, sonnet-5-5 reconciler):
- 2026-10-15: $1.39416 in 21 dispatches.
- 2026-10-17, narration on: $1.51048 in 22.
- 2026-10-20, sandboxed: $1.53764 in 21. Patch dispatches cost $0.08-0.11 each and took 13-29 s.
- Each had one remediation. Verification commands check only `node --version` and `npm --version`.
- 2026-10-20, second sandboxed run: $1.32615 in 21. It **blocked at code_review**, 10/15 driver steps.
  - Round 1 kept finding 9: Enter on the focused theme toggle does equals, because the plan made Enter
    equals everywhere.
  - The remediation exempted every focused button, so after a click on `+`, Enter re-runs `+`.
  - Round 2 blocked on that as a high (finding 10). The audit chain is valid.
  - No BuildWorks code defect was found. The remediation prompt already says to keep every plan task,
    and the agent made one `run_command`, read nothing and ran nothing.
  - Evidence: `test/fixtures/recorded/code-review-web-calculator-remediation-regression.json`.
    Analysis: `.claude/sessions/2026-10-20-debug-web-calculator-remediation-regression.md`.
  - The target `%TEMP%\bw-run-skill\1792540205762\target` is not durable.
- Structured-output open decisions 1 (remediation drops unchanged files) and 3 (other dispatches to a
  schema) remain undecided.

**Working state (verified 2026-10-20):**
- `dashboard-restyling` is pushed at `7446cd0`. Pushing uses the personal gh account (auto memory).
- The untracked `=` and `docs/runbooks/workflow-explorer.html` are the operator's to keep or drop. A
  plain-text API key copy sits at `C:\Users\tamezs\.buildworks\[Environment]SetEnvironmentVariable.txt`;
  removing it is the operator's call.
- `CLAUDE.md` and `AGENTS.md` are byte-identical.
- Unbuilt by choice: `baseline-verification`, `implementation-phase-retry` (`Reconciled`),
  `implementation-segments-and-pause` (`Shelved`), `usage-limit-refusal-summary` and
  `code-review-contract-drift-issue` (`Proposed`). `dashboard-pwa-redesign` is `Reconciled` with
  Task 7 next.
- No run is in flight. A dashboard over the second web-calculator target runs on port 53494 (background
  task `b3y0jq24h`) and ends with its session.

**Open work list (operator asked for one list, 2026-10-13):**
1. **Code-review reconciler** (`6282a6f`): live rejections happened in run 6 (finding 113) and in run
   8. Not done: the passed-branch check in `src/operator-state.ts`, reachable only with a forged audit
   event. A quote proves the words exist, not that they support the rejection (hazard 16).
2. **Implementation self-review** (`fd235a8`): it has not yet returned a patch on crew-chatter. On the
   2026-10-20 web calculator it made one `run_command` sed fix.
3. **#209:** `test/code-review-run-6-evidence.test.ts` pins both control findings.
4. **Reviewer recall**
   (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`): each call reports
   about 2 of 8+ known defects. Undecided: merged samples per lens, or the `basis` field alone.
5. **Effort replay** (`...-security-effort.json`): distinct defects per call of 7 were 2.1, 2.5 and
   3.9 for Haiku `medium`, `high` and `xhigh`, costing $0.008, $0.019 and $0.110. Undecided: the
   reviewer default effort.
6. **Spec/plan reconciler stays on Sonnet 5.5** (recommended).
7. **Crew-chatter run 6 on the other machine:** blocked at code review round 2; undecided.
8. **Older backlog:**
   - The dashboard split card still offers Modify, which the core refuses.
   - `ARCHITECTURE.md` section 14 and README line 94 still say `git mv`.
   - Split designs carry no parent open decisions.
   - Plain-prose open questions under another heading still pass `validateSpecDoc`.

**Backlog plans, detail kept because nothing else records it:**
- **Phase retry** (`docs/features/implementation-phase-retry/plan.md`):
  - A frozen `implementationPhaseAttempts`, seeded 2 with ceiling 3, retries only a reply refused
    with " is not valid JSON: ". The retry prompt is the original plus a refusal notice.
  - Task 3, the fixture from crew-chatter run 2 phase 2 on the other machine, is not done.
  - Structured output and the tool server may have removed the need; that is the operator's call.
- **Toolchain probe** (`docs/proposals/toolchain-probe-and-stack-intent.md`): the check must stop the
  run before spend and name the failing command, exit code and end of output.
- **Usage limit** (`docs/proposals/usage-limit-refusal-strands-a-run.md`): option B is planned and
  option C is unauthorized. Re-verify the plan's `failed()` suffix lines before building.
- **Baseline verification:** the runbook check "Prove the verification commands run in a fresh
  worktree before you spend" is the chosen route.
- **Code-review prompt wall:** a prompt over 1 MiB is refused (hazard 18), which is about 130-160
  task items [Inference, n=2]. Splitting the design is the only route past it.

**Shipped and committed:**
- Spec operator decisions (2026-09-27), streaming harness output (`85fccad`), per-agent settings
  (`c539e59`), phased implementation and the one-repair extractor (`3c19653`), verification-aware
  prompts (`c9ef115`), Haiku 5.5 reviewer defaults (`e2d9bd0`) and the eight-failure fixes
  (`fd756a7`).
- Design split and code-review reconciler (`6282a6f`), self-review (`fd235a8`), structured patch
  output (`94e3b98`), Decision-1 narration (`6cb2e3b`, `05803eb`), open decisions outside section
  (`561ce9e`) and declared artifacts in tasks (`dashboard-restyling`).
- Changes 2 and 10 plus prompt retention (`1cda025`), run documents under `.governance/documents/`
  (`5e3832b`), the change 1 spike (`28a5786`), the change 1 plan (`44a0d3a`) and the change 1 build (`ff260eb`).
- Seeded defaults in `src/policy.ts`: Opus 5.5 `high` authors; Haiku 5.5 `medium` spec and code
  reviewers and code-review reconciler; Sonnet 5.5 `medium` implementer. `--model` freezes only the
  spec/plan reconciler.

**Decisions locked (operator):**
- The operator signs approvals. The assistant never reads or invokes `~/.buildworks/approval.key`.
- A completed paid run never authorizes another spend; ask before each paid range.
- The design splits inside spec review above 30 declared files, and the operator merges each feature
  before the next starts. Hazard 22: clean ignored output after the checks pass.
- Self-review finds and fixes in one dispatch after the last phase. The code-review reconciler runs
  before remediation only. Patch dispatches use `--json-schema`.
- Change 1 choices:
  - Discard and regenerate agent edits to derived files.
  - LF worktrees.
  - $2.00 per patch dispatch.
  - No `--safe-mode`.
  - Node/npm only, with four extension points held by tests.
  - Errors are never swallowed (`ContainerError`); teardown failures are recorded.
- Stored run-document refs stay absolute.
- Test projects are stand-ins; only BuildWorks handling larger designs counts.

**External targets on the other machine** (`C:\Users\Shawn-work\repositories\testing-repos\`, checked
2026-10-16):
- crew-chatter `master` is at `8063995`, with branches `gov/crew-chatter/2`, `/3` and
  `gov/crew-chatter-foundation/6` (`ca0bd0e`). Run 1 reads nonterminal, so use low-level commands.
- Also there: `web-calculator-selfreview-2026-10-14\target`, `json-schema-probe\`, and team-notes
  (runs 1-12, none delivered, "not a real scenario").

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
- `--json-schema`: the answer arrives through a `StructuredOutput` tool call as `structured_output`. A missing `structured_output` is a failed dispatch whose refusal names the line's cost.
- Read `permission_denials` on every probe result line before describing what the model saw.
- Since change 1, patch agents also edit by shell (heredocs, `sed -i`, `node -`) through `run_command`, not just `write_file`. The computed diff covers both.

### Code review stage
- A code_review block is a result, not a driver fault; a pass can retain findings, and a final panel gets no further patch.
- Finding IDs are system-assigned; `intentKey` dedup works within a round only.
- Remediation is where out-of-spec obligations enter (run 6; run 7 findings 138/139 came from the remediation's double-submit guard). It also breaks plan rules its prompt told it to keep (web calculator 2026-10-20). Only an executed check holds such a rule, not prompt text or a self-reported field.
- An interaction defect that involves a focused button's native Enter activation needs trusted input (a real browser). jsdom and `dispatchEvent` never trigger activation, so a test of the correct behaviour fails there.
- Concurrent panels consume `Promise.allSettled` results in frozen panel order.
- `insertFindingDecision` requires grounding exactly for `rejected_with_rationale` and normative changes exactly for `addressed`.
- Code review's clean guard counts ignored entries; `verifyCommit` removes ignored output after the checks pass (hazard 22).

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
- `doc-check` recognizes only backticked forward-slash paths under `src`, `test`, `scripts`, `docs` or `.claude`; section 5's deferred list is every backticked `[a-z_]+` token.
- Edit `CLAUDE.md`, copy to `AGENTS.md`, then compare hashes. An `ALTER TABLE ... ADD COLUMN` migration must be folded into `scripts/doc-check.mjs` and `test/schema.test.ts`.
- `test/dashboard-ui.test.ts` is excluded from `tsc`; a changed signature fails only at test time.
- The Edit hook needs a full Read in the current context; reads before a compaction do not count.
- Before a plan, read this file and the relevant `ARCHITECTURE.md` sections, not just `docs/hazards.md`. A plan that changes a seeded default counts the tests asserting it. A blast-radius search for a frozen shape must include stored runs that are read later (`status`, `--after`), not only runs in flight.
- Replay a proposed gate against its motivating failure before planning it. Settle a free-to-answer `[Unknown]` before spend.
- Quote cost from an artifact of the same size, as a range. A spec author can vary 1.8x between runs of similar features (run 8). Effort is not linear (Haiku `high` 2.4x, `xhigh` 14x `medium`).
- A claim reaches the operator only after its source was checked this session; fix a scoring rule before the data exists. Check "empty" before calling a directory empty (the `.doctor-sandbox-*` dirs held test repos).
- A replay script reads the reply's real field path from a recorded reply before spending.
- Before offering a change to a target after `new-run`, trace what the run froze. A field in one sample is not contract; read a second.
- Identify a system-written row by a field only the system writes. Before fixing a review finding, trace its scenario; a test passing under old and new behaviour proves nothing.
- `dispatchOnce` appends " (requested model m, effort e; prompt .governance/prompts/<run>/<hash>.txt)" to failure reasons; don't anchor a regex at the end.
- "Implemented" means built and unit-proven; separate built, committed and proven by a completed live run, and name the paths no live run exercised.

## Session records

### Earlier history (2026-08-29 to 2026-10-18)
- Steps 1-8 shipped; step 9 reached 2026-09-03. Paid web-calculator chains (2026-09-06 to 09-12) cost $1.00-$2.45; three completed.
- 2026-10-04 to 10-15: team-notes runs 7-10, crew-chatter runs 2-6 on the other machine, the design split, the code-review reconciler, self-review and structured patch output. Lesson: when a model-judgement fix fails twice on the same class, offer a deterministic or human-gated route.
- 2026-10-16 to 10-18: Decision-1, crew-chatter runs 1-5 on this machine, two fixes, the rework proposal, and changes 2 and 10 built.
- 2026-10-19: changes 2 and 10 committed (`1cda025`). Crew-chatter runs 6 and 7 completed and merged. Run documents moved under governance (`5e3832b`). The change 1 spike ($0.25, `28a5786`) and plan (`44a0d3a`).

## 2026-10-20 — change 1 built, Task 13 paid validation, crew-chatter run 8

### Decisions and assumptions
- Operator: delete the leftover `.doctor-sandbox-*` dirs, then run the paid validation, each step consented separately ("start step 2", "Lets move on to step 3", "approved" for run 8's signature).
- Operator: "lets do both". Run 8 without `--after`, and plan the `--after` fix without building it.
- Operator deferred dashboard hash verification of evidence references ("we wont worry about it now").
- Nothing was committed. The Snitch MCP server failed to connect, so the operator's chat approvals were used for the deletes.

### What failed
- `new-run --after 7` refused with "run 7's delivery record does not verify: run 7 cannot be executed: the frozen profile carries no sandbox". The sandboxed plan's blast radius assumed no run was in flight and missed stored runs read later. It is fixed and uncommitted (`docs/features/inspectable-frozen-profiles/plan.md`). The plan's first build also failed live, because run 7's policy still carried the removed `verifyEnvPassthrough` and the "lacks only sandbox" claim had been checked by eye.
- The dashboard link did not open for the operator. The likely cause is the `**bold**` around the URL corrupting the fragment token. Giving the URL in a code block worked around it.
- I reported the `.doctor-sandbox-*` dirs as empty, but two held doctor test repos. I corrected this before deleting.
- I estimated crew-chatter at $2-4, then $5-7, then $7-9 after the spec; it cost $6.35.

### Running state
- Dashboard: background task `bjvdujh3i` at `http://127.0.0.1:60834/`, over
  `C:\Users\tamezs\AppData\Local\Temp\1\claude\C--Repositories-AI-Tools-governed-delivery\8235a81c-d5d8-48c9-94b5-004919f169bf\scratchpad\dashboard-repositories.json`
  (crew-chatter plus the web-calculator target). Stop it with TaskStop `bjvdujh3i`; it ends with the session anyway.

### Verification
- Full serial no-engine suite: 1746 tests, 1728 pass, 0 fail, 18 skip. `test/container.test.ts`: 14/14 on the real engine.
- `npm run check:docs`: clean after every document edit.
- Run 8: 10/10 stages, delivery 14/14, `verify-audit` chain valid, no leftover `bw-*` containers or networks.

### Deferred and open
- Open: commit the inspectable-profiles fix (now built), merge run 8, push. All three are the operator's call. The change 1 build was committed as `ff260eb` at the operator's word.
- Deferred: `unverified` evidence availability on the dashboard. The raw-output hash could verify it.

### Next up
- Ask the operator whether to commit the inspectable-profiles fix, merge crew-chatter run 8, and push `sandboxed-delivery`.

## 2026-10-20 (later) — second web-calculator paid run, rework changes 4 and 7 revised

### Decisions and assumptions
- Operator: "lets run the web-calculator paid run". The run blocked at code review, and no rerun was
  authorized.
- Operator asked whether the target's verification could gain browser regression tests in place of a
  prompt or schema fix, keeping the bounded loop with no retries or extra rounds. Assessed: yes in
  direction, but the tests must sit outside the implementer's scope. A real browser is also needed,
  which the image and the npm-only egress cannot provide.
- Operator: update the proposal with the evidence, mark the implemented changes, and update this
  file.
- Then: commit the evidence set together, and the inspectable-profiles fix separately, with this
  file staged selectively. The fix went first, as `7a725e3`. Its learnings hunks were staged as a
  blob built from this file without the evidence hunks, so neither commit carries the other's
  record.
- The fixture now also carries the delivered files at both reviewed commits (`trees`), because the
  change 4 benchmark depends on them and the scratch target is under `%TEMP%`.

### What failed
- The run itself; see "Web-calculator paid runs" above. My first offer of a "re-checked criteria"
  reply field was a claim, not evidence, and the operator rightly preferred executed tests.

### Verification
- `npm run check:docs`: clean after the proposal edit. The first pass refused a backticked
  target-only path (the calculator's app script) in the proposal, so the proposal names the target's handler in prose.
