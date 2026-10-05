# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-10-05, run 10 blocked at verification; baseline-verification plan awaiting the operator)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working state (verified 2026-10-05 with `git status` and `git branch -vv`):**
Branch `dashboard-restyling` at `af938d3`, in sync with its origin. `origin/master`
is `e7aea6b` (streaming and per-agent settings); local `master` is still `e0d7ca6`,
38 behind; `streaming-harness-output` is local-only at `e7aea6b`;
`dashboard-ux-redesign` is 3 ahead of its origin. **Uncommitted on
`dashboard-restyling`:** the phased-implementation work (source, tests, three
recorded fixtures, `docs/features/phased-implementation/`, edits to
`ARCHITECTURE.md`, `docs/hazards.md`, `CLAUDE.md` and `AGENTS.md`), the extractor
repair in `src/parse-output.ts`, the dashboard restyling files in `src/dashboard/`
(the operator said they need no further change), this file, and the untracked
`docs/features/baseline-verification/` plan and review. `CLAUDE.md` and
`AGENTS.md` are byte-identical. The full serial suite has not been run since the
phased work (last record, 2026-09-29: the two known failures plus one since fixed).

**Shipped and committed:** 2026-09-27 disclosed-open-decisions, spec operator
decisions (`spec_decision` stage, `awaiting_decision`, `bw decide`, dashboard
decision POST, migration 007); 2026-09-28 streaming harness output (`85fccad`);
2026-09-29 per-agent model and effort settings (`c539e59`, migration 008). Seeded
defaults in `src/policy.ts`: Opus 5.5 `high` spec and plan authors, Haiku 4.5
`medium` spec reviewers, Sonnet 5.5 `medium` code reviewers and implementer;
`--model` freezes only the reconciler. The first live run under them (web
calculator) was 14 dispatches, $1.66350, completed; the stage-role-model-overrides
plan carries its table.

**Implemented, not committed:** phased implementation (hazard 20; 10 tasks per
phase, at most 8 phases, both frozen in `src/policy.ts`) with a per-phase list of
which scope paths exist, and the one-repair extractor for raw control characters
inside JSON strings (hazard 1 item 10). Run 10 is the first run to pass every phase
of a multi-phase plan.

**External target** `C:\Users\Shawn-work\repositories\testing-repos\team-notes`
(HEAD `3b73c3d`): runs 1-10 are all `blocked`; none delivered. **Run 10** (2026-10-05,
`--model claude-sonnet-5-5`, signer `~/.buildworks/approval.pub`) passed spec, spec
review, approval, plan, plan review and a 6-phase implementation (16 dispatches,
$7.3048866, no unknown-spend failures, audit chain valid), then `verification`
blocked on `typecheck`: `Cannot find module ...\node_modules\typescript\bin\tsc`.
`npm ls typescript` is empty while `node_modules/.bin/tsc` exists, so the install
is partial **[Inference]**; nobody reinstalled to confirm. The six phase commits
are on `gov/team-notes/10`. Team-notes at `3b73c3d` also has no application source,
so its `build` command cannot pass until a feature creates the app. Target state
now: `docs/features/team-notes/spec.md` and `plan.md` untracked again (copies of
the earlier pair are in `%TEMP%\team-notes-aside-2026-10-05\`), and the operator
skill `.claude/skills/buildworks-operator/SKILL.md` untracked, which dirties the
tree and makes `new-run` refuse until it is committed or moved.

**Decisions locked (operator):** a red baseline refuses unless the operator accepts
it for that invocation (2026-10-05, a design choice inside the unimplemented plan
below). The operator signs approvals; the assistant never reads or invokes
`~/.buildworks/approval.key`. A completed paid run never authorizes another spend.

**Open — operator decisions:**
- **baseline-verification** (`docs/features/baseline-verification/plan.md`,
  `Reconciled`; review `2026-10-05-plan-review.md`, 8 findings accepted): nothing
  implemented. It would refuse a run at `run` time when the frozen verify commands
  fail in a fresh worktree of the starting commit, before any dispatch. The operator
  doubted it (more friction, likely test churn), and I found that with
  `--accept-red-baseline` it would not have caught run 10, since team-notes is red
  for a missing app whether or not `typescript` is installed. Choices put to the
  operator and **unanswered**: (1) runbook checklist only, `npm ci` then the three
  verify commands in a fresh checkout (my recommendation); (2) a "toolchain probe"
  in `governed.yaml` that must pass even when the baseline is red, which changes the
  config format; (3) the full plan. Plan decisions still open: whether to check
  before consent; refuse versus block (I read `prefixAction` in
  `src/operator-state.ts`: phase keys on stage rows only, so a refused run stays a
  re-runnable `ready` run until the 7-day age limit); widening
  `VERIFY_ENV_PASSTHROUGH` (the operator said yes; global versus per-target list
  undecided).
- **Commit plan:** phased work as one commit, dashboard files separately, this file
  and the baseline plan after; branch choice (the work is on `dashboard-restyling`
  and is not dashboard work); full suite not yet run.
- Team-notes needs a repaired `npm install` (operator-owned) and a committed
  application scaffold before any run can pass `build`.
- Local `master` is behind `origin/master`; push branches only if wanted.
- Carried, not rechecked: a live run that reaches a spec_review question needs
  `bw run` or guided mode (`driver.mjs paid` cannot cross a decision pause);
  `test/sign-approval.test.ts:99` false positive on a comment; `plan_review` has no
  blocking criterion or operator-question path; the store records no cost for a
  dispatch that failed after producing a stream.

**Next up:** the operator picks among the three baseline options; then split-commit
the working tree. Any paid run needs its own authorization.

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
- Replay a proposed gate against the failure that motivated it before planning it. The baseline-verification gate looked right until the operator asked; with its accept flag it would have been red on run 10's own target for a different reason than the one that cost $7.30.
- An `[Unknown]` in a plan about the environment a paid stage depends on, answerable by a free command, is a check to run before spend, not a note. The phased plan recorded "whether that worktree has `node_modules` has not been checked" and run 10 paid for the answer.
- Verification commands spawn with `shell: WINDOWS` (`src/verify-command.ts`), so `npm`, `npx`, `pnpm` and `dotnet` shims resolve; only a native `claude.exe` is spawned directly (hazard 8). I wrongly called `.cmd` shims a risk for verification on 2026-10-05.
- A verification worktree (`.governance/worktrees/<run>`) holds tracked files only; dependency resolution there works by walking up to the main checkout's ignored `node_modules`. `checkCommitState` runs `git status` without `--ignored`, and `runVerifyCommand` truncates `<name>.log`, so a reused worktree or evidence directory hides an unreproducible repair and overwrites an audit-referenced log.

## Session records

### Effort plan, run 5, streaming check (2026-09-28 to 2026-09-29, `85fccad`, `ff61dee`)

- Run 5's implementation failed on the 64,000-token output cap, not the idle timer (hazards 19 and 20); the effort defaults do not claim to fix it. Operator rulings (reconciler as its own setting, reviewers never `high`, the final defaults) live in `src/policy.ts` and the stage-role-model-overrides plan.
- Lessons: count assertions on the old value before saying a plan leaves tests unchanged; confirm the unit of configuration in the operator's own words before redesigning around it. Reading a retained stream's last line diagnosed run 5 with no code change or spend; a scratch `.mjs` importing `CLAUDE_CODE.command` ran the effort probes (the recorded fixture is the durable copy).
- Deferred: extracting run 5's failing lines into `test/fixtures/recorded/`; nothing depends on them yet.

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

## 2026-10-04 — team-notes runs 7-9 under phases (phased work still uncommitted)

- **Run 7** blocked at phase 4 of 8: the implementer proposed `modify` for a scope path no phase had created ($5.3116814; hazard 20). I had treated "the prompt states the add-versus-modify rule" as enough; the model could not tell which scope paths existed. General rule: when a prompt asks a model to branch on a fact the system can compute exactly, state the fact, not the rule. Each phase prompt now lists the existing and missing scope paths (`existsSync`). A passing component test (the prompt contains the rule) said nothing about whether the model could follow it.
- **Run 8** blocked at phase 2 by HTTP 429, "session limit" (five-hour utilization 1.05, `total_cost_usd` 0). The "1 failed attempt with unknown spend" is $0; known cost $3.4449324. The limit is shared with the interactive session driving the run; the repair is the reset and a fresh run, not debugging.
- **Run 9** blocked at phase 2: an 11-file patch (113,649 characters, $1.1298948) with one raw U+000A inside a JSON string (hazard 1 item 10; fixture `test/fixtures/recorded/implementation-team-notes-run-9-raw-newline-in-string.json`). Changed: `parseJson` retries once after escaping raw control characters inside string literals (`escapeControlCharsInStrings`; silent; every `extractJsonBody` caller), plus one prompt sentence on `\n` and `\t`. Eight parser tests; six extractor and three prompt mutations each failed a test. Unmeasured: the rate and the sentence's effect. Lesson: a state-toggling guard tested with an even number of occurrences cancels the bug (`\\"` and two escaped quotes both passed the mutant); use an odd count and run the break first.

## 2026-10-05 — team-notes run 10: six phases passed, verification blocked on an uninstalled toolchain

**Result.** Cost $7.3048866 over 16 dispatches (implementation $4.9523102 of it);
blocked at `verification.gate.block` on `typecheck` (`verify-audit`: chain valid).
Evidence: `.governance/verification/10/typecheck.log` in the target; Task 1 of the
baseline plan copies it into `test/fixtures/recorded/` (not yet done). A first
paid attempt the same day, on the scratch calculator, was stopped by me before any
recorded dispatch when the operator redirected to team-notes.

**Reasoning that failed.** The phased plan listed "whether the worktree has
`node_modules`" as `[Unknown]` and the run proceeded on it. A free command could
have answered it before spend. Then, in the follow-up work, I proposed a gate
(baseline verification) without replaying it against run 10, and the operator's
doubts surfaced that it would be red for a different reason on this target; the
first plan draft also reused one worktree and one evidence directory across
retries, which the reviewer showed approves an environment the implementation
worktree lacks and overwrites logged evidence. General rule: replay a proposed
gate against the failure that motivated it, and ask what its escape hatch does to
that case.

**Operational.** `new-run` refuses on an untracked `.claude/` and on leftover
`spec.md` and `plan.md`; moving them aside to `%TEMP%` was enough. `run --yes`
exits 3 at `awaiting_approval`; the dashboard prints its bootstrap URL once, at
start, with a per-start token (not recorded). The consent for `run` covers
only through that pause; implementation needed a second `run --yes` after the
operator's signature, and the operator's "approved" was read as that consent.
`claude` needs the native `claude.exe` directory first on PATH on this host.

**Next time.** Before a paid run on an external target, run its three verify
commands in a fresh checkout yourself, or have the operator do it.
