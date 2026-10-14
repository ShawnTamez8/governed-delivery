# Project learnings — BuildWorks (governed-delivery)

Current state is the resume point and is rewritten in place. Session records below it are
history and may name superseded state; Current state wins when they disagree. This file is
the system of record; machine-local memory is only a cache
(`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-10-14: code-review reconciler built and verified, uncommitted; self-review plan reconciled, not built; nothing committed)

**Working state (verified 2026-10-13 with `git status`, `git log`, `git rev-list`; HEAD and the hashes rechecked 2026-10-14):**
- Branch `dashboard-restyling`, HEAD `fd756a7`, 5 commits ahead of `origin/dashboard-restyling`,
  nothing pushed. Local `master` was 38 behind `origin/master` on 2026-10-10 (not rechecked).
- 65 uncommitted entries (modified and untracked): the hazard-22 cleanup fix, the design split
  (`src/design-split.ts` and the stage changes), its plans and reviews, the self-review plan and
  review, the phase-retry, usage-limit and segments plans, four proposals, and fixtures under
  `test/fixtures/recorded/`. Committing has not been requested.
- The code-review reconciler (src, tests, fixtures, docs) is also uncommitted.
- `CLAUDE.md` and `AGENTS.md` are byte-identical (sha256 prefix `6be7b6d0bd50ec54`).
- Last full serial suite (2026-10-14, after the reconciler): 1506 tests, 1501 pass, 0 fail,
  5 skipped; HEAD `fd756a7` unchanged before and after.
- **Running:** the dashboard, background shell `b0nulrtqy`, node PID 48908, started
  2026-10-13 11:20:50, `127.0.0.1:58508`, repositories file `dashboard-repositories.json` in the
  session scratchpad. Stop: `TaskStop b0nulrtqy` or `Stop-Process -Id 48908`. A restart mints a
  new port and token.

**Open work list (2026-10-13; the operator asked for one list).**
1. **Code-review reconciler — chosen 2026-10-13, "before fixes only"; built 2026-10-14**
   (rejected findings skip remediation; the final panel's gate still counts every finding). Plan
   `docs/features/code-review-reconciler/plan.md` is `Implemented` (review reconciled, 15
   accepted; implementation note in the plan). The operator accepted open decision 2 (a rejected
   `high` reported again still blocks) by saying "build it now". An in-session reviewer subagent
   found 0 high/medium and 4 low text errors, all fixed. Not done: a paid run (open decision 1, needs
   its own consent), and the passed-branch check in `src/operator-state.ts` (a pass before the last
   round is not checked for rejections; needs a forged audit event to reach). "All 3": the operator said "we are
   going to do all 3. You can start with 1"; asked again after a `/clear`, they did not recall and
   guessed "just the Code-review reconciler, and the self-review plan" (items 1 and 2). It changes
   the code-review contract in `CLAUDE.md`. One Haiku call per round keeps each
   finding with a checked `basis` or rejects it with an exact spec quote. Evidence:
   `test/fixtures/recorded/code-review-reconciler-replay-crew-chatter-run-6.json` ($0.0568, 10
   calls: #200 rejected 10/10 quoting the reset-hash sentence; no must-keep finding rejected) and
   `test/fixtures/recorded/code-review-reconciler-test-5-crew-chatter-run-6.json` ($0.0718, 20
   calls: round-2 set 10/10 pass including #211; new-finding set 7/10 pass, #905 rejected 7 of
   10, #906 wrongly rejected once). Across 30 calls: 1 wrong rejection, 3 missed rejections, 1
   invented quote caught by the check. If built: a failed check means keep; require 2 of 2
   calls to agree before rejecting (same model and prompt, so not shown to be independent) (about 1 percent wrong-reject, misses about half
   of #905-type findings); keep rejected findings visible to the operator; a quote proves the
   words exist, not that they support the rejection (hazard 16).
2. **Self-review plan** `docs/features/implementation-self-review/plan.md` (`Reconciled`
   2026-10-14, not built). Two reviews, both `reconciled`: `2026-10-13-…-review.md` (12 accepted)
   and `2026-10-14-…-review.md` (10 accepted, 1 rejected). Operator decisions 2026-10-14: drop
   remediation rule 3 (the code-review reconciler is the only filter before remediation); a
   self-review reply failure records `implementation.selfreview.skipped` and continues, a guard
   failure blocks; the critique goes to the audit log (2,000 characters per entry, 50 entries,
   code constants). Also folded in: unchanged files are dropped before applying (they stage
   nothing and the patch applier would refuse them), the "last phase's commit" sentences, the
   #209 correction. Building it needs the operator's go-ahead; multi-sample reviewer lenses
   (item 4) were not folded in.
3. **#209 correction (folded into the plan):** #209 (NUL byte in the email) already existed at the
   reviewed commit `bb7f3f6`; the replay's control prompt found it in 1 of 10 calls (`control-4`),
   plus `b-8` in variant B. The "5 of 10" recorded here earlier was the fixture's `201 NUL byte`
   count. It was a round-1 recall miss as well as a missed remediation sweep.
4. **Reviewer recall** (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`,
   $0.227, 31 calls): the out-of-spec rule failed in 1 of 10 calls; each call reports about 2 of
   8+ known defects, so recall is the main miss; rewording the rule (variant B) cut real in-spec
   findings by half or more and is not adopted; a checked `basis` field was valid 10 of 10.
   Candidates, none decided: several samples per lens merged (about $0.02 per lens per round on
   Haiku medium); the `basis` field alone on the current prompt (a 10-call replay, about $0.07).
5. **Haiku effort replay** (`high`, `xhigh`, 10 calls each, about $0.40): offered, not chosen.
   Whether Haiku honours `--effort` is unverified.
6. **Spec/plan reconciler stays on Sonnet 5.5** (recommended; it is the part that worked; $0.54
   of run 6's $4.84).
7. **Feature 1, crew-chatter run 6:** blocked at code review round 2. Options: re-run with more
   rounds (`CODE_REVIEW_MAX_ROUNDS`, 2 now, up to 5), fix branch `gov/crew-chatter-foundation/6`
   at `ca0bd0e` by hand, or stop. Undecided. A blocked run cannot be an `--after` predecessor.
8. **Commit** the uncommitted work, only when the operator asks.
9. **Older backlog, unchanged:** phase-retry plan (`Reconciled`, not built; see below),
   usage-limit summary plan (`docs/features/usage-limit-refusal-summary/plan.md`, `Proposed`,
   option B), toolchain-probe proposal, baseline-verification plan (`Reconciled`, not built),
   segments plan (`Shelved`), the dashboard split card still offers Modify (the core refuses it),
   `ARCHITECTURE.md` section 14 and README line 94 still say `git mv`, and
   `spec-review-note-keeper-runs-5-6-disclosed-decisions.json` has a corrupted provenance path.
10. **Settled 2026-10-13:** dispatches never read a target's `CLAUDE.md` or the operator's
    global one. The executor runs `--restricted --safe-mode`; a probe under those flags answered
    `NONE`, and the operator's probe without `--safe-mode` quoted both files. crew-chatter's
    stale `.claude/CLAUDE.md` cannot reach a run.

**Backlog plans, detail kept because nothing else records it:**
- **Phase retry** (`docs/features/implementation-phase-retry/plan.md`, `Reconciled` 2026-10-09,
  review 12 accepted, 1 deferred, 0 open): frozen `implementationPhaseAttempts` seeded 2, ceiling
  3; retry only a reply refused with " is not valid JSON: "; the retry prompt is the original plus
  a notice stating the refusal (section 19 and hazard 7: an identical resend "is not a retry");
  one double-quote sentence in the first prompt; the retry event names the refused `agent_run`
  id. Reading rule for the first paid retry: keep 2 if at least one retried phase parses on
  attempt 2; set 1 and reopen the options if two retried phases are refused again in the same
  file; a mixed history is the operator's to read. Task 3 (extract crew-chatter run 2 phase 2
  into a fixture) is not done; its raw reply is one of 16 files under the target's
  `.governance/raw/2/`. Building makes every earlier frozen profile unusable by name.
- **Toolchain-probe proposal** (`docs/proposals/toolchain-probe-and-stack-intent.md`): operator
  direction 2026-10-11: the check must stop the run before spend and name the failing command,
  its exit code and the end of its output; the proposal's other decisions stay open.
- **Usage-limit proposal** (`docs/proposals/usage-limit-refusal-strands-a-run.md`): option B
  (recognise the 429 shape, record reset time and raw cost) is planned; option C (pause instead
  of block) is a separate, unauthorized decision.
- **Baseline-verification plan:** not scheduled; the 2026-10-05 runbook check ("Prove the
  verification commands run in a fresh worktree before you spend") is the chosen route.
- **Code-review prompt wall:** code review refuses a prompt over 1 MiB (hazard 18); measured
  5.4 to 6.4 KB of diff per task item, so one review fills near 130 to 160 items [Inference,
  n=2]. Splitting the design is the only route past it today.

**Shipped and committed:** spec operator decisions and disclosed open decisions (2026-09-27),
streaming harness output (`85fccad`), per-agent model and effort settings (`c539e59`), phased
implementation and the one-repair extractor (`3c19653`), verification-aware prompts and plan
task items (`c9ef115`), Haiku 5.5 reviewer defaults (`e2d9bd0`), the eight-failure fixes
(`fd756a7`). Seeded defaults in `src/policy.ts`: Opus 5.5 `high` authors, Haiku 5.5 `medium`
spec and code reviewers, Sonnet 5.5 `medium` implementer; `--model` freezes only the reconciler.
**Built, uncommitted:** the design split (`docs/features/design-split-into-features/plan.md`,
`Implemented`, two reviews reconciled; threshold 30 declared files; `new-run --after`), the
hazard-22 cleanup in `verifyCommit`, and the code-review reconciler
(`docs/features/code-review-reconciler/plan.md`, `Implemented` 2026-10-14; setting
`code-review-reconciler` on Haiku 5.5 `medium`; `CODE_REVIEW_RECONCILER_CALLS` 2, range 2-3).

**Decisions locked (operator):** the operator signs approvals; the assistant never reads or
invokes `~/.buildworks/approval.key`. A completed paid run never authorizes another spend; ask
before each paid range. Reviewers on Haiku 5.5 (pinned `claude-haiku-5-5`), authors on Opus 5.5,
implementer on Sonnet 5.5 (2026-10-08/09). BuildWorks proposes a design split inside spec review
when the spec declares more than 30 files; the operator merges each feature before the next
starts; segments plan shelved (2026-10-12). Hazard 22: clean ignored output after checks pass
(2026-10-13). Self-review: find and fix in one dispatch, once after the last phase (2026-10-13).
Code-review reconciler acts before remediation only; 2-of-2 agreement; any failure keeps
(2026-10-13). Self-review plan: no remediation rule to decline a finding; an unusable
self-review reply skips, a guard failure blocks; critique recorded in the audit log (2026-10-14).
Test projects (crew-chatter, team-notes) are stand-ins; only BuildWorks handling larger designs
counts (2026-10-10).

**External targets** (under `C:\Users\Shawn-work\repositories\testing-repos\`):
- **crew-chatter**: `master` at `8063995` (six split designs under
  `docs/features/crew-chatter-*/design.md`); untracked run 6 `spec.md` and `plan.md` under
  `docs/features/crew-chatter-foundation/` (move them aside before another `new-run`); branches
  `gov/crew-chatter/2` (`e02e035`), `/3` (`cc839ba`), `gov/crew-chatter-foundation/6`
  (`ca0bd0e`). Run 1 still reads nonterminal, so guided mode refuses; use low-level commands.
  Runs 2-4 asides are under `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-*`.
- **team-notes** (HEAD `3b73c3d`): runs 1-12, none delivered; the operator calls it "not a real
  scenario". Evidence in `test/fixtures/recorded/plan-team-notes-run-12.json` and
  `run-10-dispatch-context.json`.

## Diagnostics quick-reference

### Prompts, parsing and provider output
- `specReviewGate`/`planReviewGate` block only on `cannot_determine`/`upstream_blocking`; severity is stored evidence there. Only `code_review` gates on severity (`codeReviewBlockingSeverity`).
- A prompt criterion narrows model judgement but does not settle it. A decision the gate depends on needs a deterministic rule or a human.
- A rule a model must follow is followed reliably when it is a format the code checks (the `basis` field: 10 of 10); a prose prohibition is followed by sampling and also suppresses wanted output (variant B halved real findings). Prefer a checked field over a reworded sentence.
- A reviewer call is one sample: each Haiku security-reviewer call found about 2 of 8+ known defects, a different 2 each time. Recall, not rule-breaking, was run 6's main miss.
- Dispatches run `--restricted --safe-mode` and see no `CLAUDE.md`, `AGENTS.md` or global config; a target's instruction files cannot reach a run.
- `test/fixtures/harness/emit-spec-stage.mjs` routes by prompt substring in the order `self-critique`, `spec reviewer`, `reconcile`, `spec author`; answers every `finding <digit>` in the prompt; and derives `REVISED_SPEC` from `BASE_SPEC`. New prompt text must avoid those words.
- Boundary asymmetry caused seven defects, most recently in `validateCodeReviewLocations`; inspect both sides of every comparison.
- Put field/section constraints in prompts: parser-only rules killed three paid runs. `CONSTRAINT_STRINGS` scans source, so a phrase wrapped across a template-literal line fails.
- When a prompt asks a model to branch on a fact the system can compute exactly, state the fact, not the rule (team-notes run 7: add versus modify; phase prompts now list existing and missing scope paths).
- "Fenced block is not valid JSON" names the candidate, not the cause; retained `\UXXXXXXXX` bytes came from the provider. Anchor a closing code fence to the start of its own line (hazard 1 item 9).
- Every task in `## Tasks` and every line in `## Coverage` is a normative node; an unclaimed rewording of a coverage line fails the multiset comparison closed.
- `src/harness.ts` prefers a per-dispatch `invocation.idleTimeoutSeconds` over the sandbox default. Native `claude.exe` needs no shell wrapper (avoids DEP0190, keeps typed ENOENT).
- Model IDs: the installed Claude Code carries its model catalog as strings in `claude.exe` (`grep -a -o`, no spend); it lists `claude-haiku-5-5`. Check the binary before disputing a model name.
- A seeded model default is spelled out in `DEFAULT_SETTINGS` (`src/policy.ts`) and on purpose in `test/cli.test.ts`, `test/profile.test.ts`, `test/run-intake.test.ts`, `test/dashboard-ui.test.ts`, the README table and the skill. Changing it for one run needs only `new-run --model-for`.
- `claude --effort` with an unknown value only warns and runs the default; the stream reports no effective effort, so only requested effort can be recorded.
- A `result` line with `is_error: true` and `terminal_reason: api_error` can follow `stop_reason: max_tokens` messages; thinking counts toward the response cap. Read the last line of the retained stream, not the exit code. Hazard 20's 64,000-token failure ran on `claude-sonnet-5`; `claude-sonnet-5-5` caps at 128,000 and the largest phase reply measured 98,218 tokens, so phase failures seen are malformed content, not size.
- The one-repair extractor (hazard 1 item 10) escapes raw control characters inside strings and nothing else. Crew-chatter run 3 phase 2 wrote 5,314 characters of one file unescaped (181 raw line breaks, 3 raw quotes); the repair cannot place a quote, and the refusal names the original offset. Fixture `test/fixtures/recorded/crew-chatter-run-3-phase-2-malformed-json.json`. Across 20 retained file replies: 3 fail the strict parse, 1 after the repair. All three lapses were phase 2 replies (a lead noticed after the fact, not a result).
- A lapse comes as a stretch. To measure one, count actual newline characters; a string-state scanner flips at the first unescaped quote and under-counts.

### Code review stage
- A code_review block is a result, not a driver fault; a pass can retain findings. A final panel can block after a successful remediation; it gets no further patch.
- Finding IDs are system-assigned; dedup by `intentKey` works within a round only, so a defect recurring in a later round gets a new ID.
- Run 6: every round-2 high traced to round 1 (the remediator re-imposed a rule the plan reconciler removed, or added an obligation it refused to invent). Remediation is where out-of-spec obligations enter; recorded in `test/fixtures/recorded/code-review-crew-chatter-run-6.json`.
- Concurrent panels consume `Promise.allSettled` results in frozen panel order; prove ordering with out-of-order completions, two or more failed seats and non-zero cost.
- `insertFindingDecision` requires grounding exactly for `rejected_with_rationale` and normative changes exactly for `addressed`.
- Code review's clean guard counts ignored entries (`checkWorktreeClean`); verification writes `node_modules/` and build output in the same worktree. `verifyCommit` now removes ignored output after the checks pass (hazard 22).

### Evidence, runs and storage
- Retained raw files since 2026-09-28 hold the whole `stream-json` stdout; read `total_cost_usd`, `usage` and `result` from the last line (`parseEnvelope`), never `JSON.parse` of the whole file.
- A byte-ceiling check must flag overflow when data arrives after the ceiling is reached, not only when one chunk straddles it.
- A guard added on a reviewer's hypothesis needs a test that fails without it; otherwise revert it.
- Identify revisions by hash, not dispatch order; zero audit counters do not prove guards fired. Query before `driver.mjs clean`; the table is `audit`; finding IDs span document and code review. `Store.exec` forbids audit writes.
- Windows `DeleteTempDirsOnExit=1` deleted default driver targets at logoff; use a durable target directory and extract load-bearing responses into `test/fixtures/recorded/` immediately.
- `| tail -N` buffered paid output; redirect logs. A timed-out wait can leave the chain running; never relaunch blindly.
- A hot journal made read-only SQLite return 776; readers never repair. Read-only Git needs `--no-optional-locks` and `-c diff.autoRefreshIndex=false`.
- `envPassthrough` freezes names, not values. A doctor pass is not auth proof.
- A run that stops before delivery leaves `docs/features/<slug>/spec.md` and `plan.md` untracked in the target; the next `new-run`/`doctor` refuses the dirty tree. Move them aside first.
- A full `npm test` can leave an empty "moved" commit (author `t`) on the current branch; check `git log -1` after full runs.
- A dispatch that exits 1 within seconds is usually the claude.ai session limit: a `rate_limit_event` with `status: "rejected"` at the stream's tail. It is not always free (crew-chatter run 2 phase 6: $0.1291 the store did not record), and a hit mid-range strands earlier phases ($9.63 in that run). Fixture `test/fixtures/recorded/crew-chatter-run-2-session-limit-refusal.json`.
- Spec, plan, fold and split authors now run in the target root; reviewers do not (the executor does not enforce `deniedPaths`). A commit to the target after `new-run` never reaches that run (worktree from the frozen starting commit).
- `npm ci` fails when `package.json` and the lockfile disagree; install every library the design needs in the baseline commit. ESLint reports a disable directive for an unknown rule as an error; check lint in a worktree after `npm ci`.

### Guided mode and intake
- Run identity has no uniqueness constraint; re-query the exact tuple while holding the writer lock.
- An expired approval handoff rotates by moving the whole directory atomically, validating it, then creating fresh bytes.
- Compare committed blobs with LF source constants and the worktree with HEAD through Git, or a `core.autocrlf=true` clone reads as modified.
- Guided routing treats the first argument as a target only when absolute or explicitly relative; `--repo` is refused. Guided mode refuses redirected stdin, so the assistant drives live runs with `migrate`, `new-run` and `run --yes`.
- Intake requires a readable HEAD, a clean tree excluding governance state, a committed `governed.yaml`, a committed `.governance/` ignore rule, and the design at exactly `docs/features/<slug>/design.md`. `new-run` also refuses on an untracked `.claude/`.
- `run --yes` consent covers only through the approval pause; implementation needs a second `run --yes` after the signature.

### Dashboard
- Snapshot caches key by repository and run; every overlapping refresh path needs its own generation guard.
- `--repositories-file` and the assets are read once at startup; a restart mints a new port and bearer token (never stored). The bootstrap URL prints once.
- An executing stage is usually `pending`, not `in_progress`; take a status predicate's values from the writers, not the state's name.
- With the OS "Animation effects" off, `prefers-reduced-motion: reduce` disables the ledger sweep and live-tag pulse by design.

### Windows, Node and TypeScript
- `evidence.end(cb)` fires on `'finish'` before the descriptor closes; wait for `'close'` before deleting.
- Node v26.4.0 `rmSync` does not retry EPERM despite `maxRetries`. Probe a tolerance option before crediting it.
- `test/cli-operator.test.ts` PowerShell 5.1 approval-transport test fails from the assistant's tool shell but passes in the operator's terminal.
- `child.kill("SIGTERM")` can terminate without running Node's handler on Windows.
- Keep the file glob in any `npm test` variant: bare `node --test` runs `test/fixtures/harness/*.mjs` (one waits on stdin, one dumps the environment). Full-suite check: `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` (about 11 minutes).
- On the Shawn-work host prefix BuildWorks commands with `PATH="/c/Users/Shawn-work/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin:$PATH"` or doctor's `executor_probe` fails.
- A scratch `.mjs` outside the repository imports repository TypeScript only through a `file:///C:/...` URL.
- The auto-mode classifier sometimes returns no verdict (retry once, then move on) and sometimes blocks an action outright (launching `claude` without `--safe-mode`, deleting target files, a first commit in the target): stop and give the operator the command.
- `git worktree remove` fails with "Filename too long" on a worktree holding `node_modules`; use a short path or `git archive | tar -x`, and clear leftovers with `robocopy <empty> <dir> /MIR`.
- `npm run`/`npm test` export `.npmrc` settings as `npm_config_*`; this host's `allow-scripts` makes a child `npm ci` fail with `EALLOWSCRIPTS`. Bootstrap now uses `VERIFY_ENV_PASSTHROUGH`.
- Open SQLite only through `openDatabase` in `src/sqlite.ts`; a direct `node:sqlite` import brings the experimental notice back.

### Documentation and working practice
- `doc-check` recognizes only backticked forward-slash paths under `src`, `test`, `scripts`, `docs` or `.claude`; a scratch-only or other-repository path warns if backtick-wrapped. Section 5's deferred list is every backticked `[a-z_]+` token.
- Edit `CLAUDE.md`, copy to `AGENTS.md`, then compare hashes.
- An `ALTER TABLE ... ADD COLUMN` migration must be folded into `scripts/doc-check.mjs` and `test/schema.test.ts`.
- `test/dashboard-ui.test.ts` is excluded from `tsc`; a changed signature there fails only at test time.
- The Edit hook needs a full Read in the current context; reads before a compaction and files just written do not count, and a file that grew needs its tail re-read.
- Before writing a plan or recommendation, read this file and the `ARCHITECTURE.md` sections for the area (sections 19 and 20 for retries and freezing), not just `docs/hazards.md`.
- A plan that changes a seeded default must count the tests asserting the old value. A plan that raises a limit must trace the next stage's limit before claiming the new reach.
- Replay a proposed gate against the failure that motivated it before planning it. An `[Unknown]` about an environment a paid stage depends on, answerable by a free command, is a check to run before spend.
- Verification commands spawn with a shell on Windows (`src/verify-command.ts`), so `.cmd` shims resolve.
- When quoting an expected cost, use an artifact of the same size or say it is smaller. Before offering a change to a target after `new-run`, trace what the run froze.
- A field in the only sample read is not evidence it is in the contract; read a second sample.
- An instruction telling an operator how to edit generated output is a claim about its bytes; run the generator and apply the instruction first. A walk that verifies a procedure must run exactly the documented commands.
- Identify a system-written row by a field only the system writes, never one a model can produce.
- Before fixing a review finding, trace its failure scenario in code; a fix whose test passes under both old and new behaviour proves nothing.
- Measure a prompt change against recall, not only against the error it targets. Calibrate a classifier on the known positive before reading new results.
- One run's finding order is not evidence of when a defect appeared; check the reviewed commit.
- "It fails at the previous commit too" does not make a red test acceptable; trace it once.
- Before asking the operator to choose, say what each option does and costs in plain words.
- A plan step that re-decides after a record is built must reset every field the first decision wrote (the reconciler plan left `roundRecord.blocking` at `[]`). Test a projection against the record the stage writes, not one the test builds.
- To find tests that pin a list, search for the constant and the code that builds the list (`DEFAULT_SETTINGS`, `RECONCILER`), not only the string literal. A `"reconciler"` grep missed `test/agents.test.ts`, and only the full suite caught it.

## Session records

### Earlier history (2026-08-29 to 2026-09-27)
- Steps 1-8 shipped; step 9 reached 2026-09-03. Code review with bounded remediation (`6fb5412`, `4d71ad1`), delivery check (`d033595`), guided bootstrap and dashboard (`3415032`, `3235d23`), dashboard approval and reconciler shapes (`d2954d9`), code-review audit prompt and artifact check (`2a31e5c`, `834d209`), spec operator decisions (2026-09-27).
- Paid web-calculator chains 2026-09-06 to 09-12: 11 to 16 dispatches, $1.00 to $2.45; three completed, the rest blocked at code review on correct high findings or provider bytes. Only version commands ran as verification.
- Lessons kept: trace the gate before proposing a remedy; compare the retained dispatch each agent received, never a later working tree; when a model-judgement fix fails twice on the same class, offer a deterministic or human-gated route.

### 2026-10-04 to 2026-10-07 — phases, team-notes runs 7-12, crew-chatter runs 1-2
- Team-notes run 7 blocked on add versus modify (fixed by listing scope paths); run 8 on the session limit; run 9 on one raw line break (the one-repair extractor); run 10 ($7.30) on an uninstalled toolchain at verification; run 12 passed plan review over the 80-item ceiling.
- Crew-chatter run 1 asked a layout-guess question (launched from the checkout); run 2 ($9.63) committed 5 of 6 phases before the session limit; its lint failed on a missing plugin, fixed in the baseline (`5f6c1b2`).

### 2026-10-08 to 2026-10-10 — run 3 malformed reply, phase-retry plan, reviewer defaults, eight test failures
- Crew-chatter run 3 ($6.46) blocked at phase 2 on an unrepairable reply; the phase-retry plan followed and was reconciled 2026-10-09.
- Run 4 ($4.94) passed plan review with 86 items against the frozen 80 and was unbuildable; this led to the design split.
- The eight red tests had three causes (npm's exported `allow-scripts`, the SQLite notice, a comment tripping the private-key scan), fixed in `fd756a7`. I had committed with them red because earlier plans called them unrelated.

### 2026-10-11 to 2026-10-12 — segments plan, splitter proposal, design split built
- The segments plan was written and then shelved in favour of the split. Code review's 1 MiB prompt was found to be the next wall after implementation's ceiling.
- The design split was built (threshold 30) and reviewed twice. The walk caught a wrong trim instruction; a finding-6 fix was reverted after its break-it did not fail.

### 2026-10-13 — first live split; feature 1 built and verified; hazard 22
- Run 5 ($2.26): the split dispatch proposed 6 features, validated first time; approved; designs committed in the target as `8063995`. Fixture `test/fixtures/recorded/split-crew-chatter-run-5.json`.
- Run 6 (feature 1, 29 files): spec, plan (37 items), 4 phases, then `npm ci`, typecheck, lint and build all passed, the first crew-chatter run to pass verification. Code review then refused on ignored `node_modules/` (hazard 22, fixed). Round 1: 13 findings; remediation `ca0bd0e`; round 2: 7 findings, 4 high; gate blocked. $4.84 over 22 dispatches.

## 2026-10-13 — why models miss rules: run 6 traced, self-review planned, three replays

### Decisions and assumptions
- Operator chose an implementation self-review: one dispatch after the last phase that finds and fixes in one go (plan written and reviewed; work list item 2).
- Before reconciling the self-review review, the operator asked why models miss rules; three paid replays answered it ($0.227 + $0.0568 + $0.0718, all consented). Spec/plan reconciler stays on Sonnet; the code-review reconciler was tested on Haiku 5.5 medium.

### What failed
- I attributed #209 to the remediator's missing sweep from one run's record; the replay found it at the reviewed commit. Check the reviewed commit before saying when a defect appeared.
- I cited "27 beyond-baseline findings" from memory; the store said 19. My first scorer missed #200, the finding it existed to catch. My first recommendation (sharpen the reviewer rule) would have halved real findings.
- I wrote "290 KB" for the reconciler prompt in a fixture; it was 125,867 bytes. Corrected.
- The classifier blocked launching `claude` without `--safe-mode`; the operator ran the positive-control probe by hand.

### What worked
- A control prompt rebuilt byte-identical to a recorded dispatch (`input_hash` match) makes a replay comparable to the run.
- Labels fixed before any call, plus a code check on every quote and basis, made the reconciler results countable; the check caught the one invented quote.

### Verification
- Replay and reconciler fixtures written under `test/fixtures/recorded/`; `npm run check:docs` clean; `CLAUDE.md` and `AGENTS.md` hashes match. Scratch scripts and clones (`cc6` at `bb7f3f6`, `cc6r2` at `ca0bd0e`) are in the session scratchpad `replay/` folder only.

### Next up
- Item 1 is reconciled; building it needs the operator's go-ahead. Item 2 next (the operator's guess at "all 3"): answer the self-review review's proposed decisions, fold in the #209 correction and the reconciler's effect on remediation rule 3, re-review and reconcile. Item 7 is still undecided.

## 2026-10-14 — code-review reconciler built

### Decisions and assumptions
- The operator said "build it now" (2026-10-13), which also accepted plan open decision 2: the reconciler can turn a pass into a block. The independent review used an in-session subagent, not the billed `/code-review ultra`.
- Cost estimate, corrected in the plan: one or two Haiku calls per remediated round, under $0.012 at run 6's prompt size, not "about $0.03 per fix round". The remediated default path is eight or nine dispatches in code review, up from seven.

### What failed
- Task 2's search for tests that pin the setting list used the string `"reconciler"`. `test/agents.test.ts` pins the list through the constant, so the search missed it, and only the full suite caught it. Wrong assumption: every pin spells the string. Earlier check that would have caught it: grep for `DEFAULT_SETTINGS` in `test/`. Rule: search for the constant and the list's builder too, not only the literal.
- Docs I wrote this session called the calls "independent" and said they check findings "against the code". The plan's own hazard-14 entry and the validator say otherwise. The reviewer caught both. Rule: check a sentence about a mechanism against the plan's hazard notes before writing it.

### Verification
- Typechecks clean; `check:docs` clean (standing warnings); smoke 13/13; full suite 1500/1506 with one failure, fixed, then 1501/1506 with 0 failures on the rerun; HEAD `fd756a7` unchanged; `CLAUDE.md` and `AGENTS.md` hashes match.

### Next up
- Item 2, the self-review plan. Item 1's paid run and the passed-branch check are open and need the operator. Committing needs the operator's request.

## 2026-10-14 — self-review plan re-reviewed and reconciled

### Decisions and assumptions
- The operator asked which step was next because two reviews of one plan looked like two plans. Both reviews were reconciled in one pass; the operator answered three questions (rule 3 dropped, skip on an unusable reply, critique in the audit log).

### What failed
- The "5 of 10" for #209 in this file was the replay fixture's count for #201. I wrote it from the summary block without checking which finding the label named. Rule: before citing a count from a fixture, find the calls that report that exact finding.

### Verification
- `npm run check:docs` clean apart from the plan's warnings for files it has yet to create.

### Next up
- Building the self-review plan needs the operator's go-ahead. Item 1's paid run, the passed-branch check, item 7 and committing are still the operator's.
