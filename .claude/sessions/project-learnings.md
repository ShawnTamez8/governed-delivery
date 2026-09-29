# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-29, per-agent model/effort plan implemented, uncommitted; streaming committed; nothing pushed)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working state (verified 2026-09-29 with `git log`/`git status`):** Branch
`streaming-harness-output`, HEAD `ff61dee`, on top of `85fccad` (streaming
implementation) and `2447192` (also the tip of local `dashboard-ux-redesign`,
three ahead of its origin). Nothing is pushed. `CLAUDE.md`/`AGENTS.md` are
byte-identical. **Uncommitted (about 51 paths):** the whole
stage-role-model-overrides implementation (source, `src/migrations/008_agent_run_effort.sql`,
`test/uniform-profile.ts`, tests, docs, `scripts/doc-check.mjs`), the plan and its review
`docs/features/stage-role-model-overrides/2026-09-29-stage-role-model-overrides-review.md`,
the fixture `test/fixtures/recorded/claude-effort-flag-probes.json`, and this file.
`base.txt` is untracked, a known test-suite leak, in no commit.

**Shipped (all committed):**
- 2026-09-27 (`bda3b42`, `2447192`): disclosed-open-decisions, the
  `upstream_blocking` prompt criterion, spec-operator-decisions (`spec_decision`
  stage, `awaiting_decision` pause, `bw decide`, dashboard decision POST,
  migration 007), spec-criterion-testability, dashboard STATE panel,
  dashboard-pwa-redesign Task 6 (Tasks 7-12 remain), hazard 19. Each has a
  plan under `docs/features/<slug>/plan.md`; the spec-operator-decisions code
  review deferred an `awaiting_decision` attention-queue group and duplicate
  questions across rounds (only if `SPEC_REVIEW_ROUNDS` rises above 1).
- 2026-09-28 (`85fccad`): **streaming-harness-output**. The executor runs
  `stream-json --include-partial-messages --verbose`; `parseEnvelope` takes
  NDJSON with one last `result` line; `STREAM_RETAIN_MAX_BYTES` (64 MiB) bounds
  retention and `RESULT_MAX_BYTES` caps the parsed result in `src/dispatch.ts`;
  recording `test/fixtures/recorded/harness-stream-json-envelope.json`. The
  executor definition changed, so runs frozen earlier refuse at their next
  dispatch; a fresh run is the repair. The port-4200 hooks were removed from
  `.claude/settings.json`.

**Full suite (serial, 2026-09-29, with the effort work):** 1341 tests, 1333 pass, 5
skipped, 3 failed: the two known (dashboard SIGTERM stderr warning; "nothing under
src/ touches a private key") plus `test/schema.test.ts` "every table's columns",
which this work caused and fixed afterwards (the file passes; the full suite was not
rerun after that fix or the two review fixes; the touched files were). HEAD had no
stray commit afterwards.

**External target:** `C:\Users\Shawn-work\repositories\testing-repos\team-notes`
(HEAD `3b73c3d`). Runs 1-3 blocked at `spec_review` ($1.4078, $1.1701,
$1.6186). Run 4 blocked at `implementation` (killed at 1,800,194 ms, 0-byte raw
file, hazard 19). **Run 5** (2026-09-28/29, first with streaming, model
`claude-sonnet-5`, driven with `run --run 5 --yes` twice): spec, spec review and
plan passed (about 19 and 11 min; $3.55 in the store), the operator signed
approval in the dashboard, then `implementation` failed with exit 1.
- Streaming worked: the implementer streamed 32.8 min, past run 4's 1,800 s, no
  idle kill; raw file 3,500 lines / 2.75 MB, every line valid JSON.
- The failure is a different mechanism: the `result` line is `API Error:
  Claude's response exceeded the 64000 output token maximum` (`is_error`,
  `terminal_reason: api_error`). After 17 read-only calls the model produced four
  consecutive `max_tokens` messages, each 64,000 tokens of thinking (260,678 of
  262,076 output). No writes. **[Inference]** run 4's 0-byte kill may have been
  the same loop; the empty file cannot show it.
- The store carries no cost for that failed dispatch ("unknown spend"); the raw
  result has `total_cost_usd` 2.9195696, so run 5 is about $6.47.
- Usage windows at the end: five-hour 0.82, seven-day 0.82.
- Untracked `docs/features/team-notes/spec.md` and `plan.md` remain in the target
  root (verified); move them aside before any next run. Raw evidence stays
  machine-local at `.governance/raw/5/2026-09-29T00-49-38-624Z-26ea8b0ebac6.json`;
  copy the result line and the four `max_tokens` lines into
  `test/fixtures/recorded/` with provenance before a plan or test depends on them.
- Thinking is not silent: each 64,000-token thinking message carried 380-402
  `thinking_delta` events with empty text, so the idle timer is fed during heavy
  thinking. Count only; the stream has no timestamps.

**stage-role-model-overrides plan (`Implemented` 2026-09-29, uncommitted; see the
plan's Implementation note for what shipped, deviations (a)-(h) and the independent
in-session review: no correctness defect, two low findings fixed, one deferred):**
model **and effort** per setting for the nine registered agents plus one
`reconciler` setting (covers spec, plan and the decision fold), seeded defaults in
`src/policy.ts`, `--effort` / `--model-for` / `--effort-for` on `new-run`,
`claude --effort` passed per dispatch, `agent_run.requested_effort` (migration
008), `dispatchSettings` replaces `modelMap` in the frozen profile.
- **Seeded defaults, final per the operator:** `spec-author` Opus 5.5 `high`;
  spec reviewers Haiku 4.5 `medium`; code reviewers Sonnet 5.5 `medium`;
  `implementer` Sonnet 5.5 `medium` and `reconciler` (`--model`) `medium` (both
  set by the operator 2026-09-29); `plan-author` Opus 5.5 `high` (operator, later
  2026-09-29; it was my `--model` guess until then, so `--model` now covers only
  `reconciler`). Risk recorded: run 5's failure was at `high` on Sonnet 5, and
  5.5's levels are recalibrated, so it says nothing about 5.5; nothing measured
  shows that `medium` avoids the output-cap failure.
- **Task 0 ran** ($0.0349, five dispatches, fixture above): Haiku 4.5 takes
  `--effort` at `low` and `medium`; Opus 5.5 is callable; `xhigh` on Sonnet 4.6
  (docs say unsupported) is accepted silently; a nonsense level warns on stderr
  and runs at the default. A one-word prompt cannot show that effort changes
  behavior or that any model reviews well.
- **Review (in-session, same session as the author, so not independent):** 1
  critical, 4 high-risk, 7 medium. Critical: existing tests encode the
  single-model contract (`spec-stage.test.ts` passes `requestedModel: "m"` at 14+
  sites; 47 `freezeProfile(` calls in 14 files), so seeded non-null defaults break
  them; the plan says they pass unchanged. High: Tasks 2-3 expect a clean
  typecheck that cannot exist until Tasks 4-5; `--model` no longer governs most
  settings and cost moves toward Opus; new freeze refusals run before staffing
  checks and collide with the `deps.agents` seam (`test/profile.test.ts:431-506`);
  a repeat implementer failure is unrecorded spend.
- **Reconciled 2026-09-29** (14 verdicts: 13 accepted, 1 deferred, 0 open; plan
  `Reconciled`). Operator rulings: a run-wide `--effort` does not reach the six
  reviewers (they move only through their own `--effort-for`, up to `max`, never
  `ultracode`); `agent_run` gains a `setting` column beside `requested_effort`;
  failed `agent.dispatch.failed` summaries name the requested model and effort; the
  cost of a failed dispatch stays out of scope, stated in the plan. The plan adds a
  test helper `test/uniform-profile.ts` and a Task 4 Step 0 that routes seven
  dispatching test files through it. Deferred: printing setting sources in `status`.

**Running state:** dashboard background task `bjq5aqd81`, port 54101 (the
bearer token is minted per start and is not recorded), serving team-notes from
the session scratchpad's `dashboard-repositories.json`. Session-only; stop with
TaskStop `bjq5aqd81`. The earlier session's dashboard (`bjutv7qpr`, port 52902)
was gone when checked.

**Open — operator decisions:**
- Push the branch (nothing has been pushed).
- A live run that reaches a spec_review question needs `bw run` or guided mode
  with the operator answering; `driver.mjs paid` cannot cross a decision pause.
  Old run stores (team-notes, note-keeper) read `interrupted_or_inconsistent`; a
  fresh run is the repair.
- `test/sign-approval.test.ts:99` false positive: it matches the comment "never
  receives a private key" at `src/dashboard-approval.ts:16`.
- `plan_review` has no blocking criterion or operator-question path (out of
  scope for the 2026-09-27 plans).
- Out of scope, recorded: the store records no cost for a dispatch that failed
  after producing a stream.

**Next up:** Commit the stage-role-model-overrides implementation (nothing is
committed until the operator asks). The first paid run is the test of the seeded `implementer` default (Sonnet 5.5
`medium`); it needs its own authorization, and a completed paid run never authorizes
another. Deferred: refuse an unknown `--model-for`/`--effort-for` setting name at parse
time so a typo leaves no blocked run.

## Diagnostics quick-reference

Durable project facts belong here, regardless of whether a host also caches them.

### Prompts, parsing and provider output
- `specReviewGate`/`planReviewGate` block only on `cannot_determine`/`upstream_blocking`; severity is stored evidence there. Only `code_review` gates on severity (`codeReviewBlockingSeverity`).
- A prompt criterion narrows model judgement but does not settle it. After the 2026-09-27 blocking criterion, the reconciler still blocked one "the design allows X or Y" question while following up an identical one. A decision the gate depends on needs a deterministic rule or a human.
- `test/fixtures/harness/emit-spec-stage.mjs` routes by prompt substring in the order `self-critique`, `spec reviewer`, `reconcile`, `spec author`; answers every `finding <digit>` in the prompt; and derives `REVISED_SPEC` from `BASE_SPEC`. New prompt text must avoid those words, and a test spec change goes into `BASE_SPEC`.
- Boundary asymmetry caused seven defects, most recently in `validateCodeReviewLocations`; inspect both sides of every comparison.
- Put field/section constraints in prompts: parser-only rules killed three paid runs. `CONSTRAINT_STRINGS` scans source, so a phrase wrapped across a template-literal line fails.
- "Fenced block is not valid JSON" names the candidate, not the cause; retained `\UXXXXXXXX` bytes came from the provider, not terminal corruption.
- Anchor a closing code fence to the start of its own line (hazard 1 item 9, cost $2.83862): a bare triple backtick inside a JSON string otherwise truncates the payload.
- Every task in `## Tasks` and every line in `## Coverage` is a normative node; an unclaimed rewording of a coverage line fails the multiset comparison closed.
- `src/harness.ts` prefers a per-dispatch `invocation.idleTimeoutSeconds` over the sandbox default; check the call site before assuming the default governs.
- Native `claude.exe` needs no shell wrapper: direct launch avoids DEP0190 and preserves typed ENOENT.
- `claude --effort <low|medium|high|xhigh|max>` (CLI 2.1.284) overrides settings; an unknown value only warns on stderr and runs at the default, so BuildWorks must refuse a bad level itself. The stream reports no effective effort (only `per_turn_effort_active`), so only requested effort can be recorded.
- A `result` line with `is_error: true` and `terminal_reason: api_error` can carry `stop_reason: max_tokens` messages before it; thinking counts toward the 64,000-token response cap. Read the last line of the retained stream, not the exit code alone.

### Code review stage
- A code_review block is a result, not a driver fault; a pass can retain findings. Read the final panel and frozen verification commands.
- A final configured panel can block after a successful remediation; it gets no further patch or delivery, and a completed spend never authorizes a retry.
- Concurrent panels must consume `Promise.allSettled` results in input (frozen panel) order; only tests with controlled out-of-order completions, two or more failed seats and a non-zero fixture cost prove that ordering and aggregation.
- Shared validators prove subsets; callers project findings/commands/metadata. Malformed display fields get limitations, not stronger gates.
- `insertFindingDecision` requires grounding exactly for `rejected_with_rationale` and normative changes exactly for `addressed`.

### Evidence, runs and storage
- A run's retained raw file changed shape on 2026-09-28. Runs dispatched before it hold one JSON object; later runs hold the whole `stream-json` stdout, one JSON object per line, the `type: "result"` line last. Read `num_turns`, `usage`, `total_cost_usd` and the `result` text from that last line (`JSON.parse(lastLine)`), never `JSON.parse` of the whole file. Nothing in `src/` reads retained raw files, but a test that parsed emitter stdout as one object broke (`implementation-stage.test.ts`); use `parseEnvelope`.
- A byte-ceiling check must flag overflow when data arrives after the ceiling is already reached, not only when one chunk straddles it. `invokeHarness` missed the exact-fit case (the old 1 MiB cap had the same gap), which showed up as silent truncation until the idle timer fired. The flood test covers it only while chunk sizes align with the ceiling.
- A guard added on a reviewer's hypothesis needs a test that fails without it. A repeat-kill guard on the post-ceiling branch failed no test on Windows in three runs, so it was reverted rather than kept unproven.
- Identify revisions by hash, not dispatch order; zero audit counters do not prove guards fired.
- Query before `driver.mjs clean`: it deletes store/raw evidence. Cost joins through `stage_id`; the table is `audit`; finding IDs span document and code review.
- `Store.exec` forbids audit writes; model a missing gate by not appending its event.
- Windows `TEMP=...\AppData\Local\Temp\1` with `DeleteTempDirsOnExit=1` deletes default driver targets at logoff; four stores were lost by 2026-09-10. Use a fresh child of `C:\Users\tamezs\buildWorks_test_repos` and extract load-bearing responses into `test/fixtures/recorded/` immediately.
- `| tail -N` buffered paid output; redirect logs and inspect state. A timed-out wait can leave the chain running; never relaunch blindly.
- The driver signs Buffer bytes over stdin without a shell; PowerShell `cmd /c` redirection is approval transport, not a launch fix.
- `agent_runs` persists model, harness and duration fields. `RunSnapshot.cost.byAgent` projects roles, requested/effective models, unreported-model rows and summed `duration_ms`; harness is unprojected.
- A hot journal made read-only SQLite return 776 without writes; readers never repair. Read-only Git needs `--no-optional-locks` and `-c diff.autoRefreshIndex=false`.
- `envPassthrough` freezes names, not values or files. A doctor pass is not auth proof.
- A run blocked at `spec_review` (or failing later) leaves `docs/features/<slug>/spec.md` and `plan.md` untracked in the target, and the next `new-run`/`doctor` refuses the dirty tree. Move them aside (keep them as evidence) before starting another run.
- A full `npm test` can leave an empty commit "moved" (author `t`) on the current branch. Check `git log -1` after every full run; drop it with `git reset --soft <prior>` after confirming `git diff <prior> HEAD` is empty.

### Guided mode and intake
- Run identity has no uniqueness constraint; re-query the exact tuple while holding the repository writer lock, or concurrent guided processes create duplicate runs.
- An expired approval handoff rotates by moving the whole directory atomically, validating it, then creating fresh bytes; stale signatures are inert evidence.
- Compare committed blobs with LF source constants and the worktree with HEAD through Git, or a clean `core.autocrlf=true` clone reads as modified.
- Guided routing treats the first argument as a target only when absolute, `.`, `..`, or starting `.\`, `..\`, `./`, `../`; a bare name is a command and exits 2. `--repo` is refused.
- Intake requires a readable HEAD, a clean tree excluding governance state, a committed `governed.yaml`, a committed `.governance/` ignore rule (doctor), and the design at exactly `docs/features/<slug>/design.md` (since step 3, `d489847`). A PRD elsewhere is copied there and committed; note-keeper did the same in `411fed2`.
- Guided mode refuses redirected stdin, so the assistant drives live runs with `migrate`, `new-run` and `run --yes`, and automated proof composes installed-shim execution with an injected-prompt journey.

### Dashboard
- Snapshot caches key by repository and run, and every overlapping refresh path needs its own generation guard.
- Repository IDs are base64url SHA-256 of the normalized worktree path; the Governance stage is a synthesized gate projection with `stageId: null`.
- Views are scoped through `scopeViews` → `repositoryViews({repositories, repositoryFilter})` → `scopeData`; Overview, Runs and Findings read that one scope (pinned by `test/dashboard-ui.test.ts`, Task 6).
- `--repositories-file` is read once at startup, and so are the assets (`app.js`, `styles.css`); changing either means restarting, which mints a new port and bearer token by design (`randomBytes(32)` in `src/dashboard-server.ts`, never stored).
- Popover listeners need `{ once: true }` or explicit cleanup. Presentation may narrow, never alter; apply formatting honesty to every value class at once.
- An executing stage is usually `pending`, not `in_progress`: spec, plan and implementation never leave the store default while they run. Take a status predicate's expected values from the writers' insert and `setStageStatus` sites, never from the state's name, and check live-state features against a real running snapshot.

### Windows, Node and TypeScript
- `evidence.end(cb)` fires on `'finish'` before the descriptor closes; wait for `'close'` before deleting the directory.
- Node v26.4.0 `rmSync` does **not** retry EPERM despite `maxRetries`/`retryDelay` (probed 2026-09-24). Probe a tolerance option on the installed runtime before crediting it.
- `test/cli-operator.test.ts:1394` (PowerShell 5.1 approval transport) fails when the suite runs from the assistant's tool shell but passes in the operator's terminal; have the operator rerun it before diagnosing.
- `child.kill("SIGTERM")` can terminate without running Node's handler on Windows; promise graceful cleanup only for delivered signals.
- A variant of `npm test` must keep its file glob (`node --test <flags> test/*.test.ts`). A bare `node --test` also runs `test/fixtures/harness/*.mjs`: `echo-json.mjs` waits on stdin forever, and `echo-env.mjs` writes the whole environment, API keys included, into the TAP output. The parallel `npm test` heap crash reproduces at `d2954d9`; `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` completes (about 11 minutes) and is the full-suite check.
- On the Shawn-work host `claude` resolves only to npm shims; prefix BuildWorks commands with `PATH="/c/Users/Shawn-work/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin:$PATH"` or doctor's `executor_probe` fails.
- A scratch `.mjs` outside the repository imports repository TypeScript only through a `file:///C:/...` URL; a bare `C:/...` path fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
- The assistant's auto-mode classifier sometimes returns no verdict for Bash or Edit; retry once, then use PowerShell or another task and return. It did not indicate a code problem.
- Child `tsconfig` files inherit base `include` and `exclude` even with `files`, and default `lib` includes DOM; inspect resolved files when separating Node and browser programs.

### Documentation and working practice
- Break-test doc-check in a mirror. Section 5's deferred list is every backticked `[a-z_]+` token; decisions go in sections 12 and 23.
- `doc-check` recognizes only backticked forward-slash paths under `src`, `test`, `scripts`, `docs` or `.claude`; `docs/runbooks/**` is reference tier, so write generated example paths there in Windows backslash form.
- Edit `CLAUDE.md`, copy to `AGENTS.md`, then compare hashes.
- A migration that adds a column with `ALTER TABLE ... ADD COLUMN` must be folded in by two column checkers: `scripts/doc-check.mjs` and `test/schema.test.ts` (both append it after the CREATE TABLE columns; list it last in the ARCHITECTURE `agent_run` line). A plan that says the checker "pins only names" needs that claim grepped, and the full suite run, before it is believed.
- `test/dashboard-ui.test.ts` is excluded from `tsc`, so a changed `insertAgentRun` signature is not caught by typecheck; the suite then fails with EPERM cleanup errors because a thrown insert leaves the store open.
- The Edit hook refuses a file until it has been Read in full **in the current context**; reads from before a compaction and files just written with Write do not count.
- Restore only the break mutation, hash before/after, anchor a unique expression. Shell-true `--test-name-pattern` lost `(`/`|` and exited 255.
- Before writing a plan, read this file and the `ARCHITECTURE.md` sections for the area, not just `docs/hazards.md`. The first streaming plan cited a memory note for a rule section 20 already states, and sized a stream ceiling from a planned capture that used no tools, though tool results dominate an implementer's stream.
- A plan that changes a seeded default must count the tests asserting the old value, not only the files that mention the renamed symbol. The effort plan listed nine files by symbol and missed the stage tests that assert `requestedModel: "m"` (review finding 1).
- Bash heredocs and regex `node -e` were mangled; use a scratch `.mjs`. Read every adjacent review before planning from a proposal.
- Check `git status` and `git log` against the recorded state before trusting a resume point; an unexplained file count means an undocumented layer (happened 2026-09-15 and 2026-09-24).

## Session records

### Effort plan, run 5, streaming check (2026-09-28 to 2026-09-29, `85fccad`, `ff61dee`)

#### Decisions and assumptions
- The operator authorized a fresh team-notes run 5 knowing the usage limit might stop it; a completed paid run authorizes nothing further, so nothing was retried after the failure.
- The operator chose the reconciler as its own setting covering spec and plan, spec author on an Opus-class model, reviewers never `high`, Haiku for spec reviewers, Sonnet 5.5 for code reviewers and the implementer (final defaults in Current state).
- The `--model` assertion on `bw spec|plan|implement|review` stays; it will assert against the stage's author setting (plan open decision 7, my recommendation).

#### What failed
- Run 5 `implementation`: output-token-cap loop, not the idle timer; root cause and cost in Current state. Open: the plan does not claim its defaults fix it.
- My first plan revision treated the agent as the only unit and dropped the reconciler; the operator reversed that within one message. I had also written the existing-test impact off as "unchanged" until the review checked the tests.

#### What worked
- Reading the retained stream's last line and per-message `stop_reason` and `thinking_tokens` diagnosed the failure without code changes or spend.
- A scratch `.mjs` importing `CLAUDE_CODE.command` ran the five probes through the executor's own flags; dropping the `system` lines kept machine paths out of the fixture (provenance says so).

#### Running state
- See Current state (dashboard `bjq5aqd81`). Scratch outputs of the probes live under the session scratchpad `effort-probe-out`; the fixture is the durable copy.

#### Verification
- `node <scratch>/effort-probe.mjs` (five dispatches) - all exit 0, $0.0349 total.
- `claude --effort nonsense --version` - warning, exit 0.
- `npm run check:docs`, `git diff --check` - clean after each doc edit.
- Not run: the full serial suite, any paid run beyond run 5 and Task 0.

#### Deferred and open
- Deferred: extracting run 5's failure lines into `test/fixtures/recorded/` - nothing depends on them yet.
- Open at the time: `plan-author` and `reconciler` defaults (plan-author since settled: Opus 5.5 `high`); push; the review's critical and high findings.

#### Next time
- Count assertions on the old value before saying a plan leaves tests unchanged.
- Confirm the unit of configuration with the operator's own words before rewriting a design around it.

#### Next up
- See Current state.

### Operator decisions for spec review; team-notes runs 1-2 (2026-09-27)

- The operator chose a human decision step over further prompt tuning after every
  new PRD hit a model-judged block. Plan choices: deny = leave open and continue;
  answer from CLI and dashboard; only blocking questions reach the operator.
- Design choices in the plan: `spec_decision` is always in the chain
  (`prefixAction` indexes stages by count); old run stores read as inconsistent
  (hard rule 3); converted `cannot_determine` stays terminal; answers are
  immutable; the fold is not re-reviewed and the operator sees it at approval.
- The design stays at `docs/features/<slug>/design.md` (step 3); team-notes got a
  verbatim copy (`3b73c3d`), PRD left at `docs/design.md`.
- Disclosed-open-decisions was kept: note-keeper passed spec review only when
  reviewers happened not to raise disclosed gaps (runs 4 and 5 passed; 1 and 6
  blocked).
- team-notes run 1 ($1.4078) blocked on author-disclosed hardening questions
  (OD-001, OD-003); run 2 ($1.1701) followed up 2 of 3 and blocked on OD-003
  ("X or Y"), inconsistent with its own OD-002 reasoning.
- Lessons: when a model-judgement fix fails a second time on the same class, offer
  a deterministic or human-gated route; query every run's outcome (`status --json`)
  before quoting a pass rate.

### Dashboard approval, reconciler fix, note-keeper review variance (2026-09-26, `d2954d9`)

Dashboard approval (the one dashboard write) and the reconciliation disposition
shapes shipped in `d2954d9`. The first severity-nondeterminism write-up was wrong
three ways, all caught by independent review: its remedies targeted severity,
which the gate never reads; it claimed identical reviewer input; it misread
reconciliation decision 38 through a later `git stash`. Lessons: trace the gate
before proposing a remedy; compare the retained dispatch each agent received,
never a later working tree; read how the test emitter routes prompts before
planning a stage change; the self-critique response in `.governance/raw/<run>/` is
exactly the spec the panel reviewed (take text from the `result` field of the last
line, since 2026-09-28); `num_turns` and token totals show whether two dispatches
received the same input.

### Code-review audit prompt, artifact check, plan-reconcile coverage fix (2026-09-16/17, `2a31e5c`, `834d209`)

Two paid `target-tap` runs blocked: the first (10 dispatches, $1.55366) failed
`plan_review` round 1 on an unclaimed `not_applicable` coverage rewording;
`target-tap-live-2` (16 dispatches, $3.58933) remediated three round-1 defects,
then blocked on two new round-2 highs. Fixes: the coverage-node rule and
`nodeForm` in the reconcile prompt, a whole-diff audit instruction for reviewers,
and a pre-dispatch declared-artifact check. Analysis is in
`.claude/sessions/2026-09-16-debug-plan-reconcile-unclaimed-coverage-node.md`.

### Guided project bootstrap, dashboard increment and redesign (2026-09-12 to 2026-09-14, `3415032`, `3235d23`)

Guided bootstrap (`docs/features/guided-project-bootstrap/plan.md`) shipped
checkout-linked `buildworks`/`bw`, the `static-web` initializer, shared intake
and guided continuation. Its eight review findings were fixed with break-tested
guards. The loopback dashboard uses bearer-protected GET routes; its redesign
went through `src/dashboard/dashboard-model.js`. Requirements are in
`.claude/sessions/2026-09-12-requirements-dashboard-*.md`.

### Paid chains, 2026-09-06 to 2026-09-12

| Date | Dispatches | Cost | Outcome |
| --- | --- | --- | --- |
| 2026-09-06 | 13 / 13 | $1.15759 / $1.40170 | Both blocked at `code_review` on correct high findings |
| 2026-09-07 | 11 | $1.00548 | Blocked at `implementation.content.invalid` (provider `\U0001f319` bytes) |
| 2026-09-07 | 13 | $1.39473 | Completed; clean first panel; operator manual calculator check |
| 2026-09-09 | 16 | $2.40174 | Completed after one remediation under PowerShell; fixture `code-review-web-calculator-powershell-remediation-chain.json` |
| 2026-09-11 | 16 | $2.0585392 | Completed; non-blocking medium after remediation; six artifacts at `8cd5a2d` |
| 2026-09-11 | 16 | $2.4481306 | Final high (AC-013 Enter contradiction) blocked at `511f64b` |
| 2026-09-12 | 16 | $1.8073754 | Final high (AC-018 mobile overflow) blocked; `.claude/sessions/2026-09-12-paid-web-calculator-code-review-block.md` |

Only version commands ran as frozen verification in every chain.

### Proposals and earlier history (2026-08-29 to 2026-09-11)

- **Proposals:** CLI operator work uses full consent, grants no spend, and never
  retries failed groups; doctor keeps Windows key casing (`4356151`); cc-switch
  and Pi are no substitute for an adapter; Copilot portability keeps canonical
  `.claude` skills with `.agents` entries forwarding to them.
- **Shipped early:** the code review stage with a bounded remediation loop
  (`6fb5412`, `4d71ad1`), unfenced extraction from the first `{`, hazard 17's
  list-marker remedy (`a2db2a0`), stable criterion IDs (`9a12cba`).
- **Step 8 delivery check** (`d033595`): a billed standalone review beat an
  in-session subagent (hazard 14). **Step 5b:** only the operator rules on a
  wrong task boundary. **Steps 1-7:** `bw new-run` needed `.governance/`
  gitignored (hazard 11); the plan stage mirrors the spec stage without a shared
  abstraction (hard rule 4).
