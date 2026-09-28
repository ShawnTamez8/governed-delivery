# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-28, streaming-harness-output implemented and committed in `85fccad`; nothing pushed)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working state (verified 2026-09-28 with `git log`/`git status`):** Branch
`streaming-harness-output` holds `85fccad` (streaming implementation and the
port-4200 hook removal) plus the commit that updated this block, on top of
`2447192` (also the tip of local `dashboard-ux-redesign`, three commits ahead
of its origin). Nothing is pushed. `CLAUDE.md`/`AGENTS.md` are byte-identical.
`base.txt` is untracked, a known test-suite leak, and is in no commit. The
bullets below record what shipped: the earlier ones in `bda3b42` and
`2447192`, streaming and the hook removal in `85fccad`.
- **disclosed-open-decisions** — `Implemented` 2026-09-27
  (`docs/features/disclosed-open-decisions/plan.md`; in-session subagent
  review). `src/spec-doc.ts`, `src/spec-stage.ts`, `src/prompts.ts`, their
  tests, `ARCHITECTURE.md` sections 8/12/13, the proposal's Decision paragraph,
  and the recorded fixture
  `test/fixtures/recorded/spec-review-note-keeper-runs-5-6-disclosed-decisions.json`.
- **spec-review-blocking-criterion** — `Implemented` 2026-09-27
  (`docs/features/spec-review-blocking-criterion/plan.md`, fast path, no
  independent review). The spec reconcile prompt states `upstream_blocking` =
  "design cannot be implemented without it"; `ARCHITECTURE.md` sections 8 and 13
  say so too.
- **dashboard-pwa-redesign Task 6** complete (`test/dashboard-ui.test.ts`
  49/49; plan Result block added). Tasks 7-12 remain.
- `README.md`, `CLAUDE.md`, `AGENTS.md` staleness fixes (dashboard section,
  fence anchoring, typecheck line).
- **spec-operator-decisions** — `Implemented` 2026-09-27
  (`docs/features/spec-operator-decisions/plan.md`, Tasks 0-10; implementation
  note lists deviations). New `spec_decision` stage and `awaiting_decision`
  pause, `bw decide`, the dashboard decision POST route
  (`src/dashboard-decision.ts`), migration 007, `src/spec-decision-stage.ts`.
  Plan review `2026-09-27-plan-review.md` and code review
  `2026-09-27-code-review.md` (in-session subagent, 7 findings) are both
  `reconciled`; code-review deferrals: an `awaiting_decision` attention-queue
  group, and duplicate questions across rounds (only if `SPEC_REVIEW_ROUNDS`
  rises above 1).
- **spec-criterion-testability** — `Implemented` 2026-09-27
  (`docs/features/spec-criterion-testability/plan.md`). `criterionQualityRule`
  in the spec author and self-critique prompts; `ARCHITECTURE.md` section 8.
  Team-notes run 4 moved vague terms to open decisions, but one criterion
  (AC-054, "meaningful" version change) still settled a term silently.
- **Dashboard STATE panel** (ad hoc, operator request, no plan): card-style
  KPI strip, state pill and highlighted current ledger step in
  `src/dashboard/app.js` and `styles.css`. The operator approved the look.
- **Hazard 19** (`docs/hazards.md`): a non-streaming executor turns the idle
  budget into a wall clock. `ARCHITECTURE.md` section 22 counts nineteen.
- **streaming-harness-output** — `Implemented` 2026-09-28
  (`docs/features/streaming-harness-output/plan.md`, Tasks 0-6; in-session
  subagent review, no billed review). The executor runs
  `stream-json --include-partial-messages --verbose`, so the idle timer sees
  generation. Task 0 ($0.0926, operator-authorized) recorded
  `test/fixtures/recorded/harness-stream-json-envelope.json`. `parseEnvelope`
  takes newline-delimited JSON with exactly one last `result` line;
  `STREAM_RETAIN_MAX_BYTES` (64 MiB) bounds retention and `RESULT_MAX_BYTES`
  now caps the parsed result in `src/dispatch.ts`. The four stage emitters and
  `echo-json.mjs` emit the recorded line kinds; `test/harness-stream-fixtures.test.ts`
  holds them to it. **The end-to-end effect is unmeasured**: no paid run has
  gone past `implementation` with streaming, and gaps during extended thinking
  were not sampled. The executor definition changed, so every run frozen
  earlier refuses at its next dispatch; a fresh run is the repair.
- The 2026-09-25 port-4200 HTTP hooks in `.claude/settings.json` (commit
  `319c9e4`, no listener) were removed 2026-09-28 at the operator's request.

**Full suite (serial, 2026-09-28, with the streaming change):** 1302 tests,
1294 pass, 5 skipped, 3 failed: the two known ones (dashboard SIGTERM stderr
warning; "nothing under src/ touches a private key") plus one this change
caused (`implementation-stage.test.ts` parsed emitter stdout as one JSON
object). That one was fixed afterwards and the touched test files, plus
operator-state, code-review-stage and plan-stage, were rerun green; the full
suite was not rerun. Parallel `npm test` crashes on the heap limit, at baseline
too; see the Windows/Node quick-reference.

**External target:** `C:\Users\Shawn-work\repositories\testing-repos\team-notes`
(HEAD `3b73c3d`). Runs 1-3 blocked at `spec_review` ($1.4078, $1.1701,
$1.6186; run 3 on finding 19). Run 4 passed spec review, approval (signed from
the dashboard), plan and plan review, then blocked at `implementation` on
2026-09-27: the implementer (24-path scope) was killed at 1,800,194 ms with a
0-byte raw file ($4.1858 known plus one attempt of unknown spend; hazard 19).
Run 4 left **untracked** `docs/features/team-notes/spec.md` and `plan.md`,
which must be moved aside before the next run (the clean-tree check refuses
otherwise). Earlier runs' specs were moved to session scratchpads.

**Open — operator decisions; nothing is pending from the assistant:**
- Push the branch (nothing has been pushed).
- A live run that reaches a spec_review question needs `bw run` or guided mode
  with the operator answering; `driver.mjs paid` cannot cross a decision pause.
  Old run stores (team-notes, note-keeper) read `interrupted_or_inconsistent`;
  a fresh run is the repair.
- `docs/features/stage-role-model-overrides/plan.md` (`Proposed`) still awaits
  review.
- `test/sign-approval.test.ts:99` false positive: it matches the comment
  "never receives a private key" at `src/dashboard-approval.ts:16`.
- `plan_review` has no blocking criterion or operator-question path. This is
  out of scope for both 2026-09-27 plans.

**Next up:** The operator decides on pushing, and on authorizing a new live
team-notes run, which is the only end-to-end check of streaming-harness-output
(the executor change refuses runs frozen before it, so it must be a fresh run).

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
- A run blocked at `spec_review` leaves `docs/features/<slug>/spec.md` untracked in the target, and the next `new-run`/`doctor` refuses the dirty tree. Move it aside (keep it as evidence) before starting another run.
- A full `npm test` can leave an empty commit "moved" (author `t`) on the current branch. Check `git log -1` after every full run; drop it with `git reset --soft <prior>` after confirming `git diff <prior> HEAD` is empty.

### Guided mode and intake
- Run identity has no uniqueness constraint; re-query the exact tuple while holding the repository writer lock, or concurrent guided processes create duplicate runs.
- An expired approval handoff rotates by moving the whole directory atomically, validating it, then creating fresh bytes; stale signatures are inert evidence.
- Compare committed blobs with LF source constants and the worktree with HEAD through Git, or a clean `core.autocrlf=true` clone reads as modified.
- Guided routing treats the first argument as a target only when absolute, `.`, `..`, or starting `.\`, `..\`, `./`, `../`; a bare name is a command and exits 2. `--repo` is refused.
- Intake requires a readable HEAD, a clean tree excluding governance state, a committed `governed.yaml`, a committed `.governance/` ignore rule (doctor), and the design at exactly `docs/features/<slug>/design.md` (since step 3, `d489847`). A PRD elsewhere (for example `docs/design.md`) is copied there and committed; note-keeper did the same in `411fed2`.
- Guided mode refuses redirected stdin, so the assistant drives live runs with `migrate`, `new-run` and `run --yes`, and automated proof composes installed-shim execution with an injected-prompt journey.

### Dashboard
- Snapshot caches key by repository and run, and every overlapping refresh path needs its own generation guard.
- Repository IDs are base64url SHA-256 of the normalized worktree path; the Governance stage is a synthesized gate projection with `stageId: null`.
- Views are scoped through `scopeViews` → `repositoryViews({repositories, repositoryFilter})` → `scopeData`; Overview, Runs and Findings read that one scope (pinned by `test/dashboard-ui.test.ts`, Task 6).
- `--repositories-file` is read once at startup; changing targets means restarting, which mints a new port and bearer token.
- Dashboard assets (`app.js`, `styles.css`) are also read once at startup (`src/dashboard-server.ts`); restart the dashboard to see an asset edit.
- Popover listeners need `{ once: true }` or explicit cleanup. Presentation may narrow, never alter; apply formatting honesty to every value class at once.
- An executing stage is usually `pending`, not `in_progress`: spec, plan and implementation never leave the store default while they run. Take a status predicate's expected values from the writers' insert and `setStageStatus` sites, never from the state's name, and check live-state features against a real running snapshot.

### Windows, Node and TypeScript
- `evidence.end(cb)` fires on `'finish'` before the descriptor closes; wait for `'close'` before deleting the directory.
- Node v26.4.0 `rmSync` does **not** retry EPERM despite `maxRetries`/`retryDelay` (probed 2026-09-24). Probe a tolerance option on the installed runtime before crediting it.
- `test/cli-operator.test.ts:1394` (PowerShell 5.1 approval transport) fails when the suite runs from the assistant's tool shell but passes in the operator's terminal; have the operator rerun it before diagnosing.
- `child.kill("SIGTERM")` can terminate without running Node's handler on Windows; promise graceful cleanup only for delivered signals.
- A variant of `npm test` must keep its file glob (`node --test <flags> test/*.test.ts`). A bare `node --test` also runs `test/fixtures/harness/*.mjs`: `echo-json.mjs` waits on stdin forever, and `echo-env.mjs` writes the whole environment, API keys included, into the TAP output. One serial run hung 20 minutes that way on 2026-09-27. The parallel `npm test` heap crash reproduces at `d2954d9`; `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` completes (about 11 minutes, 1283 tests on 2026-09-27) and is the full-suite check.
- On the Shawn-work host `claude` resolves only to npm shims; prefix BuildWorks commands with `PATH="/c/Users/Shawn-work/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin:$PATH"` or doctor's `executor_probe` fails.
- Child `tsconfig` files inherit base `include` and `exclude` even with `files`, and default `lib` includes DOM; inspect resolved files when separating Node and browser programs.

### Documentation and working practice
- Break-test doc-check in a mirror. Section 5's deferred list is every backticked `[a-z_]+` token; decisions go in sections 12 and 23.
- `doc-check` recognizes only backticked forward-slash paths under `src`, `test`, `scripts`, `docs` or `.claude`; `docs/runbooks/**` is reference tier, so write generated example paths there in Windows backslash form.
- Edit `CLAUDE.md`, copy to `AGENTS.md`, then compare hashes.
- The Edit hook refuses a file until it has been Read in full **in the current context**; reads from before a compaction do not count.
- Restore only the break mutation, hash before/after, anchor a unique expression. Shell-true `--test-name-pattern` lost `(`/`|` and exited 255.
- Before writing a plan, read this file and the `ARCHITECTURE.md` sections for the area, not just `docs/hazards.md`. The first streaming plan cited a memory note for a rule section 20 already states, and sized a stream ceiling from a planned capture that used no tools, though tool results dominate an implementer's stream.
- Bash heredocs and regex `node -e` were mangled; use a scratch `.mjs`. Read every adjacent review before planning from a proposal.
- Check `git status` and `git log` against the recorded state before trusting a resume point; an unexplained file count means an undocumented layer (happened 2026-09-15 and 2026-09-24).

## Session records

### Operator decisions for spec review; team-notes runs 1-2 (2026-09-27)

#### Decisions and assumptions
- The operator chose a human decision step over further prompt tuning. Every
  new PRD has hit a model-judged block. Plan choices: deny = leave open and
  continue; answer from CLI and dashboard; only blocking questions reach the
  operator; plan reviewed before implementation.
- Design choices recorded in the plan:
  - `spec_decision` is always in the chain, because `prefixAction` indexes
    stages by count;
  - old run stores read as inconsistent (hard rule 3);
  - converted `cannot_determine` stays terminal;
  - answers are immutable;
  - the fold is not re-reviewed, and the operator sees it at approval.
- The design stays at `docs/features/<slug>/design.md`. The operator thought
  this was new; it dates from step 3. team-notes got a verbatim copy
  (`3b73c3d`), with the PRD left at `docs/design.md`.
- Disclosed-open-decisions was kept rather than reverted. The note-keeper
  history shows the old gate passing only when reviewers happened not to raise
  disclosed gaps (runs 4 and 5 passed spec review; 1 and 6 blocked).

#### What failed
- **team-notes run 1** (5 dispatches, $1.4078) blocked on
  author-disclosed hardening questions: OD-001 (export access) and OD-003
  (reset tokens). The prompts gave the reconciler no rule for `upstream_blocking`.
- **team-notes run 2** ($1.1701), after the blocking-criterion fix, listed no
  hardening questions and followed up 2 of 3. It still blocked on OD-003
  (version retention: "X or Y"), inconsistent with its own OD-002 reasoning.
- I first said note-keeper passed spec review only once; the store showed runs
  4 and 5 both passed. Query the run store before quoting a pass rate.

#### What worked
- Querying `status --json` for every run in a store gave the outcome table,
  including which later stages died with exit 1 (usage limits).

#### Running state
- Dashboard: background task `bjutv7qpr`, `http://127.0.0.1:52902`, serving
  team-notes and note-keeper from the session scratchpad's
  `dashboard-repositories.json`. Session-only; stop with TaskStop.

#### Verification
- `node --test test/prompts.test.ts test/spec-stage.test.ts` - 77/77 pass.
- `node --test --test-reporter=tap test/*.test.ts` - 1216/1224; the 2 known failures.
- `npm run typecheck`, `npm run check:docs`, `git diff --check` - clean.
- Break-tests for the blocking-criterion pins (7 mutations) and dashboard
  Task 6 (6 mutations) - each failed by assertion.

#### Next time
- When a model-judgement fix fails a second time on the same class, stop
  tuning prompts and offer a deterministic or human-gated route.
- Before quoting cross-run statistics, query every run's outcome; don't rely
  on the recorded fixture or memory.

#### Next up
- See Current state.

### Dashboard approval, reconciler fix, note-keeper review variance (2026-09-26, `d2954d9`)

Dashboard approval (the one dashboard write) and the reconciliation disposition
shapes shipped in `d2954d9`. Note-keeper run 6 was a clean `spec.gate.block`,
not a repeat 429. The first severity-nondeterminism write-up was wrong three
ways, all caught by independent review:
- its remedies targeted severity, which the gate never reads;
- it claimed identical reviewer input;
- it misread reconciliation decision 38 through a later `git stash`.

The lessons that came out of it:
- Trace the gate before proposing a remedy.
- Compare the retained dispatch each agent received, never a later working
  tree.
- Read how the test emitter routes prompts before planning a stage change.
- The self-critique response in `.governance/raw/<run>/` is exactly the spec
  the panel reviewed. (Since 2026-09-28 that file is a stream; take the text
  from the `result` field of its last line.)
- `num_turns` and token totals show whether two dispatches received the same
  input. (Read them from the last line of a post-2026-09-28 raw file.)

### Resume-point audit and undocumented layers (2026-09-15, 2026-09-24)

Both times the Current state undercounted the working set, which exposed
committed work it did not describe: the fence-anchoring layer
(`3235d23`/`a420563`) and `resilience-parallel-code-review`. The general
lesson is in the quick-reference.

### Code-review audit prompt, artifact check, plan-reconcile coverage fix (2026-09-16/17, `2a31e5c`, `834d209`)

Two paid `target-tap` runs blocked:
- The first (10 dispatches, $1.55366) failed `plan_review` round 1 on an
  unclaimed `not_applicable` coverage rewording.
- `target-tap-live-2` (16 dispatches, $3.58933) remediated three round-1
  defects, then blocked on two new round-2 highs.

The fixes:
- the coverage-node rule and `nodeForm` in the reconcile prompt;
- a whole-diff audit instruction for reviewers;
- a pre-dispatch declared-artifact check.

Analysis is in
`.claude/sessions/2026-09-16-debug-plan-reconcile-unclaimed-coverage-node.md`.

### Verify-command EPERM cleanup race fixed (2026-09-16, `4848a64`)

`settle()` resolved on `'finish'` while the evidence descriptor was open,
racing `rmSync`. It now awaits `'close'`. See
`.claude/sessions/2026-09-16-debug-verify-command-cleanup-eperm.md`.

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

### Proposals and assessments (2026-09-08 to 2026-09-11)

- **CLI operator work:** full consent, no granted spend, and an invocation
  never retries failed groups.
- **Doctor** (`4356151`): Windows key casing is preserved.
- **cc-switch:** switching is no substitute for an adapter.
- **Pi:** additional support, not an adapter.
- **Copilot portability:** canonical `.claude` skills, with `.agents` entries
  forwarding to them.

### Earlier history (2026-08-29 to 2026-09-07)

- **Code review stage** (`6fb5412`, `4d71ad1`): shipped with a bounded
  remediation loop.
- **Coverage lines** are representative delivery anchors.
- **Unfenced extraction** parses from the first `{`.
- **Hazard 17's list-marker remedy** (`a2db2a0`).
- **Stable criterion IDs** (`9a12cba`).
- **Step 8 delivery check** (`d033595`): a billed standalone review beat an
  in-session subagent (hazard 14).
- **Step 5b:** only the operator rules on a wrong task boundary.
- **Steps 1-7:** `bw new-run` needed `.governance/` gitignored (hazard 11), and
  the plan stage mirrors the spec stage without a shared abstraction
  (hard rule 4).
