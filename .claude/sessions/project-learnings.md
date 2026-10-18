# Project learnings — BuildWorks (governed-delivery)

Current state is the resume point and is rewritten in place. Session records below it are
history and may name superseded state; Current state wins when they disagree. This file is
the system of record; machine-local memory is only a cache
(`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-10-17: crew-chatter runs 1-3; open-decisions and declared-artifacts fixes committed and pushed)

**Active work:** `docs/features/open-decisions-outside-section/plan.md` is `Implemented`,
committed in `561ce9e` and pushed with the declared-artifacts commit. The operator asked for "a paid run on a larger design" in
`C:\Repositories\testing-repos\crew-chatter` (TS backend + React frontend baseline committed there as
`eb1fa30`; worktree precheck of `npm ci`, typecheck, lint, build passed).
- **Run 1** (whole PRD, narration on): spec and spec review, $1.7998923 in 6 priced dispatches,
  71 narration answers all `criterion` (top 0.148). The spec declared 32 files; the operator
  approved the split into 7 features; proposals 28-34; run 1 ended `blocked` as designed.
- **Run 2** (feature 1, `crew-chatter-accounts-notes`, design committed as `8f539e5` with run 1's
  spec): blocked at the `spec_review` gate after $0.9690182, "spec reconciliation added open
  decision(s) OD-001, OD-012". The self-critique had listed the parent spec's open decisions under
  `## Questions left open upstream`; the validator checked only open-decisions-like headings; a
  reviewer flagged it and the reconciler's correct move into `## Open decisions` hit the no-add
  rule. Asked whether Decision-1 should catch it: no, because detection was not the failure and a
  regex settles the ID-led form exactly.
- **The fix:** `validateSpecDoc` refuses an OD-led line under any other heading, and
  `openDecisionsSchema` says the section is the only place an open question is listed, including
  an inherited one. Fixture `test/fixtures/recorded/spec-crew-chatter-run-2-open-questions-outside-section.json`;
  hazard 3 and `ARCHITECTURE.md` section 8 updated. Run 3 measured a live author complying.
  Residual: open questions in plain prose under another heading still pass (run 2's draft did this).
- **Run 3** (feature 1 re-run on `8f539e5`, spec range only, operator-approved): reached
  `awaiting_approval` for $0.96232597 in 5 priced dispatches (2 Opus author calls, 2 Haiku
  reviewers, 1 Sonnet reconciler) plus 24 Decision-1 narration requests (all `criterion`, none
  flagged). The fix held live: the spec's only open questions are `OD-001` (high, reset-token
  delivery) and `OD-002` (medium, debounce interval), both under `## Open decisions`, and both
  became `disclosed-open-decision` findings. The reconciler routed both `upstream_follow_up`, as
  well as 5 reviewer findings, addressed 1 (AC-015 wording), and rejected 2 with grounding, so no
  operator question was raised and there was no decision pause. That is the prompt's contract,
  because only `upstream_blocking` pauses, but it means the implementer will choose reset-token
  delivery itself. The operator approved from the dashboard and authorized plan through delivery.
  Run 3 then **blocked at `code_review`** before any reviewer was dispatched, with
  `code_review.artifact.missing` for `backend/package.json`, `frontend/package.json` and
  `package-lock.json`. Run total $3.43547941; this range cost $2.47 (plan $1.27, plan review $0.012,
  3 phases plus self-review $1.19). Plan, plan review, implementation and verification all passed
  (`npm ci`, typecheck, lint and build on `f50bc95`, branch `gov/crew-chatter-accounts-notes/3`).
  Cause: the spec declared the three package files conditionally ("any dependency added ... must
  also be recorded in `package-lock.json`"). The plan then chose "No new dependencies"
  (`node:sqlite`, `node:crypto`), and the implementer correctly left them unchanged. Nothing
  between the spec and code review compares the plan's files with the signed declared artifacts.
  The evidence is now committed-tier: `test/fixtures/recorded/plan-crew-chatter-run-3-declared-artifacts-untasked.json`.
  The worktree and `.governance/raw/3` are still the only copy of the full raw streams; keep them.
- **The fix (2026-10-17, committed and pushed on `dashboard-restyling`):** `docs/features/declared-artifacts-in-tasks/plan.md` is
  `Implemented`. `tasksNameScope` refuses a draft, self-critique or reconciled plan whose `## Tasks`
  names no signed scope path, with the exact bounded match, `plan.artifact.untasked`, before the
  panel. The plan prompts say to name every scope path and invent no change; the spec prompts say
  to declare only files that change however the change is built. Hazard 24; `ARCHITECTURE.md`
  sections 8, 12 and 22; `doc-check` gained `twenty-four`. Full suite 1628 pass / 0 fail / 5 skip,
  check:docs and smoke clean. A probe (about $0.003) showed dispatches load neither
  `~/.claude/CLAUDE.md` nor `lessons.md` (`--safe-mode`), so no `--setting-sources` change is needed.
  Live compliance is unmeasured; a crew-chatter feature-1 re-run is the live test.
- **Documentation sweep (2026-10-17, same commit, operator asked to "review all documentation"):**
  the current-tier documents were checked against source and the recorded runs.
  - `docs/runbooks/cli-operator.md` had never mentioned the narration check, though guided intake
    and `new-run` refuse without the `SYSTEMONE_*` variables. Guided step 2 now sets them,
    advanced step 4 names `--no-narration-check`, and step 7 and troubleshooting cover the new
    plan refusal.
  - README, `CLAUDE.md`/`AGENTS.md` and `.claude/skills/run-buildworks/SKILL.md` said no run had
    used the Haiku 5.5 reviewers. They now cite the 2026-10-15 ($1.39416, 21 dispatches) and
    2026-10-17 ($1.51048, 22) runs.
  - SKILL.md's smoke block and troubleshooting row named `spec_review` where the refusal says
    `spec_decision`, and called the self-review cost unmeasured ($0.088 on 2026-10-15).
  - README's stage summary now names the phases, the self-review and the new plan refusal.
  Not changed: historical plans and reviews (preserved as written), and proposals (backlog).

**Earlier 2026-10-16/17 work:** `docs/features/decision-1-d6-evaluation/plan.md` is `Implemented`, committed in `6cb2e3b`.
The operator redirected the typed-decision proposal from TypeSafe Jev to Microsoft-Decision-1 on
their Foundry resource (`docs/proposals/decision-1-review.md`, renamed from `jev-review.md`) and
chose "Client + D6 evaluation" with an API key. Built: `src/systemone.ts` (config from
`SYSTEMONE_ENDPOINT`, `SYSTEMONE_DEPLOYMENT`, `SYSTEMONE_DEPLOYMENT_TYPE`, key from
`SYSTEMONE_API_KEY`, all user-scope variables on this machine; no stage calls it) and
`scripts/systemone-d6-evaluation.ts`. Probe recorded in
`test/fixtures/recorded/systemone-probe-snitch-resource.json`: `api-key` header, response
`{model, answers, usage}`, `model` is `microsoft-decision-1` with no version, unknown deployment
is 404 `DeploymentNotFound`. D6 (35 requests, $0.0117) **fails** the operator-confirmed rule at
T = 0.8: no keep-labelled finding withheld at any threshold, but #200 chose `none` (tied with
`L048` at 0.4659) and #905 chose `L048` (0.895) instead of its baseline `L047`; ten identical #905
requests agreed on the choice but its probability ranged 0.687-0.922. Result and Haiku comparison
in `test/fixtures/recorded/systemone-d6-evaluation-crew-chatter-run-6.json`. A completed paid run
never authorizes another spend.

**Previous work:** `docs/features/structured-patch-output/plan.md` is `Implemented`, committed in
`94e3b98`; its review is `reconciled`. The paid run the operator asked for ("commit then run the
paid run", 2026-10-15) completed: web-calculator, `driver.mjs paid --yes --model
claude-sonnet-5-5`, 21 dispatches, $1.39416, 15/15 driver steps, run `completed`, audit chain
valid. All four patch dispatches (2 phases, the self-review, 1 remediation) returned
`structured_output` and applied; no phase dropped a file. The self-review ran live for the first
time: 5 critique entries, 0 patches. Code review round 1 found 1 low (`delete-noop-after-result`);
the code-review reconciler ran live for the first time (1 call, kept 1, rejected 0); remediation
patched `script.js`; round 2 found 1 low, non-blocking. Delivered 3 of 3 declared artifacts
(`index.html`, `script.js`, `styles.css`). Verification still ran only `node --version` and
`npm --version`. Cost by part: spec authors $0.374, spec reconcile $0.112, plan authors $0.428,
plan reconcile $0.089, two phases $0.174, self-review $0.088, remediation $0.080; the eight Haiku
5.5 reviewer calls plus the reconciler call totalled about $0.043 as reported by the CLI's
`total_cost_usd` (Haiku 4.5 spec panels cost $0.31 on 2026-09-29). One sample. Target preserved
at `C:\Users\Shawn-work\repositories\testing-repos\web-calculator-structured-2026-10-15\target`.
Plan open decisions 1 (remediation drops unchanged files) and 3 (other dispatches to a schema)
remain undecided. `.claude/skills/run-buildworks/SKILL.md` now records this run and the
2026-10-17 narration run as the two Haiku 5.5 reviewer runs.

**2026-10-17:** the operator stated that the deployment type must not be checked against
vendor values. The `DEPLOYMENT_TYPES` allowlist is gone, because there will be many Decision-1
endpoints and the resource may move. They also stated that data can be sent for some operator
decisions. At their request, `docs/features/decision-1-format-checks/plan.md` (`Proposed`) and
`scripts/systemone-format-cases.ts` now hold two labelled case sets derived from fixtures:
- grounding: 23 cases, 2 recorded and 1 proposed does-not-support;
- narration: 131 Acceptance criteria entries, 1 recorded and 2 proposed contains-remark.

Missing brackets and backticks and prose outside the object are excluded, because the extractor
already catches them.

The operator then confirmed the labels "as listed" and chose the D6 rule at T = 0.8, and said
"run the paid step". `scripts/systemone-format-evaluation.ts` sent 172 requests for $0.001632,
all valid; the result is `test/fixtures/recorded/systemone-format-checks-evaluation.json`.
- **Narration passes.** It flagged 3 of 3 remarks and 0 of 128 criteria, and its repeats
  answered at 0.999. It fails at T ≥ 0.9, where AC-051 scored 0.835.
- **Grounding fails.** It caught 3 of 3 unsupported citations, but it flagged the supported
  rejections R-200-1 and R-905-1, and its repeats spread 0.038. The 12 supported additions all
  passed, but splitting the check by kind after seeing the answers is not allowed.

**Narration wired into spec review (2026-10-17, committed `6cb2e3b`):** the operator asked to "wire
narration into the spec stage. Ensure we do not swallow errors". They decided:
- a flagged entry is a finding for the reconciler;
- the check is an explicit per-run switch: `new-run` refuses without the `SYSTEMONE_*`
  variables unless `--no-narration-check` is given;
- all projects' entries may be sent.

`docs/features/narration-check-spec-review/plan.md` is `Implemented` and describes the build:
- `src/narration-check.ts`;
- the profile's `narrationCheck`;
- `check_answer` (migration 009);
- each Decision-1 call recorded as an `agent_run` with executor `systemone` and a null cost;
- any failed request blocks the run;
- guided mode always on;
- the driver passes `--no-narration-check` unless it is given `--narration-check`;
- ARCHITECTURE sections 11, 12, 15 and 23.

Tests reach Decision-1 only through the loopback stand-in in `test/systemone-stand-in.ts`. Every
test spawn of `new-run` passes `--no-narration-check`.

Committed as `6cb2e3b` and pushed with `05803eb`. The operator then approved a paid live run with
`--narration-check` (web-calculator, sonnet-5-5). It completed:
- 15/15 driver steps;
- 22 Claude dispatches for $1.51048, two code-review panels and one remediation;
- 3 of 3 artifacts delivered.

Decision-1 answered 24 of 24 criteria `criterion`, the highest remark probability being 0.0203,
so nothing was flagged. That fits a clean spec, but it does not exercise a live catch. The
details are in the plan's "First live run" block. The driver's cost-report fix that lists
Decision-1 requests apart and the run record are committed in `05803eb`, pushed.

**Next action:** the operator decides:
- whether to authorize a paid crew-chatter feature-1 re-run (a fresh run on `8f539e5`) as the
  live test of the declared-artifacts fix. No spend is authorized;
- what to do about grounding. The recommendation is to leave it unadopted until more recorded
  positives exist.
- No PR to `master`: the operator said not to create one (2026-10-17).

Follow-ups not taken: split designs carry no parent open decisions; the lockfile risk (feature 1
declares `package-lock.json`, and an implementer cannot run `npm install`) bites at
implementation when a dependency really is added; hazard 24 covers only the case where none is. Never relabel cases after seeing answers. Nothing is in flight.

**Working state (verified 2026-10-17):**
- Branch `dashboard-restyling`, pushed to `origin/dashboard-restyling` with the declared-artifacts
  commit on top of `561ce9e`. Local `master` was 38 behind `origin/master` on 2026-10-10 (not
  rechecked).
- An untracked empty file `=` sits at the repository root; deleting it is the operator's call. A plain-text copy of the API key sits
  in the operator's `C:\Users\tamezs\.buildworks\[Environment]SetEnvironmentVariable.txt`;
  removing it is theirs.
- Plan statuses checked 2026-10-15: all 49 `docs/features/*/plan.md` carry a correct Status line.
  `docs/features/dashboard-pwa-redesign/plan.md` is `Reconciled` with Task 7 next (no `sw.js` or
  manifest in `src/`); unbuilt by choice: `baseline-verification`, `implementation-phase-retry`
  (`Reconciled`), `implementation-segments-and-pause` (`Shelved`), `usage-limit-refusal-summary`
  and `code-review-contract-drift-issue` (`Proposed`).
- `CLAUDE.md` and `AGENTS.md` are byte-identical.
- Last full serial suite (2026-10-17, declared-artifacts fix): 1633 tests, 1628 pass, 0 fail,
  5 skipped. Smoke 13/13.
- A loopback dashboard was launched from the 2026-10-17 session for run 3's approval; it ends
  with that session. No run is in flight.

**Open work list (operator asked for one list, 2026-10-13):**
1. **Code-review reconciler** (`docs/features/code-review-reconciler/plan.md`, `Implemented`,
   committed `6282a6f`, review reconciled). Acts before remediation only; 2-of-2 agreement to
   reject; any failed call or check keeps the finding; a rejected `high` reported again still
   blocks. First live call 2026-10-15 (kept 1 low, rejected 0; no rejection seen live yet). Not
   done: the passed-branch check in
   `src/operator-state.ts` (a pass before the last round is not checked for rejections; reachable
   only with a forged audit event). Replay evidence: 30 Haiku calls, 1 wrong rejection, 3 missed,
   1 invented quote caught by the check (`test/fixtures/recorded/code-review-reconciler-*.json`).
   A quote proves the words exist, not that they support the rejection (hazard 16).
2. **Implementation self-review** (`docs/features/implementation-self-review/plan.md`,
   `Implemented`, committed `fd235a8`, hazard 23). First live run 2026-10-15: $0.088, 5 critique
   entries, no fixes; it has not yet returned a patch live. Deferred: a CRLF blob makes the
   unchanged-file drop disagree with `git add`.
3. **#209:** the NUL-byte email defect already existed at the reviewed commit `bb7f3f6`; the
   control prompt found it in 1 of 10 calls (`control-4`), and a NUL-in-email defect on the
   sign-in path in another (`control-6`). `test/code-review-run-6-evidence.test.ts` pins both.
4. **Reviewer recall** (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`,
   $0.227, 31 calls): each call reports about 2 of 8+ known defects; rewording the rule cut real
   findings by half and is not adopted; a checked `basis` field was valid 10 of 10. Undecided:
   several samples per lens merged (about $0.02 per lens per round), or the `basis` field alone (a
   10-call replay, about $0.07).
5. **Haiku effort replay, run 2026-10-15** (operator-approved, $1.2863 against a $0.40 estimate;
   `test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security-effort.json`). Distinct
   in-spec defects per call, of 7: `medium` 2.1 ($0.008, 62 s median), `high` 2.5 ($0.019, 146 s),
   `xhigh` 3.9 ($0.110, 320 s). Three merged calls: `medium` 4.2, `high` 4.9, `xhigh` 5.8. A new
   defect (offline edit lost on reopen, AC-019) appeared in 0/10 `medium`, 3/10 `high`, 7/10
   `xhigh` calls. Sonnet 5.5 `medium` (same file, $0.4667): 1.3 per call, 12 findings, 7 of 10
   calls reported only the 401 cache leak; worse than Haiku `medium`. Opus 5.5 `medium` (same file,
   $1.2999): 0.7 per call, 7 findings, all real, 3 calls reported nothing; its summaries show it
   kept to the security lens and the spec's exclusions, yet that lens's instructions name
   data-integrity defects, so its B and H misses are real. One lens is not panel recall.
   Haiku 4.5 `medium` ($0.8209): 1 finding in 10 calls, and it was false (`new URL` accepts
   `mailto:`), despite about 13,800 thinking tokens per call against Opus's 3,400. Undecided: reviewer default effort, merging samples, a three-lens panel replay. One prompt, one
   lens, one sample of each arm.
6. **Spec/plan reconciler stays on Sonnet 5.5** (recommended; $0.54 of run 6's $4.84).
7. **Crew-chatter run 6 (feature 1):** blocked at code review round 2. Re-run with more rounds,
   fix branch `gov/crew-chatter-foundation/6` at `ca0bd0e` by hand, or stop. Undecided. A blocked
   run cannot be an `--after` predecessor.
8. **Older backlog, unchanged:** phase-retry plan, usage-limit summary plan (option B),
   toolchain-probe proposal, baseline-verification plan, segments plan (`Shelved`); the dashboard
   split card still offers Modify (the core refuses it); `ARCHITECTURE.md` section 14 and README
   line 94 still say `git mv`.

**Backlog plans, detail kept because nothing else records it:**
- **Phase retry** (`docs/features/implementation-phase-retry/plan.md`, `Reconciled` 2026-10-09,
  review 12 accepted, 1 deferred, 0 open): frozen `implementationPhaseAttempts` seeded 2, ceiling
  3; retry only a reply refused with " is not valid JSON: "; the retry prompt is the original plus
  a notice stating the refusal (section 19 and hazard 7: an identical resend "is not a retry");
  one double-quote sentence in the first prompt; the retry event names the refused `agent_run`
  id. Reading rule for the first paid retry: keep 2 if at least one retried phase parses on
  attempt 2; set 1 and reopen the options if two retried phases are refused again in the same
  file. Task 3 (extract crew-chatter run 2 phase 2 into a fixture) is not done; its raw reply is
  one of 16 files under the target's `.governance/raw/2/`. Building makes every earlier frozen
  profile unusable by name. Structured output now covers the phase replies it was written for;
  whether the plan is still wanted is the operator's call.
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
(`fd756a7`), the design split, hazard-22 cleanup and code-review reconciler (`6282a6f`), and the
implementation self-review (`fd235a8`). Seeded defaults in `src/policy.ts`: Opus 5.5 `high`
authors, Haiku 5.5 `medium` spec and code reviewers and code-review reconciler, Sonnet 5.5
`medium` implementer; `--model` freezes only the spec/plan reconciler.

**Decisions locked (operator):** the operator signs approvals; the assistant never reads or
invokes `~/.buildworks/approval.key`. A completed paid run never authorizes another spend; ask
before each paid range. Reviewers on Haiku 5.5 (pinned `claude-haiku-5-5`), authors on Opus 5.5,
implementer on Sonnet 5.5 (2026-10-08/09). BuildWorks proposes a design split inside spec review
when the spec declares more than 30 files; the operator merges each feature before the next
starts; segments plan shelved (2026-10-12). Hazard 22: clean ignored output after checks pass
(2026-10-13). Self-review: find and fix in one dispatch, once after the last phase; an unusable
reply skips, a guard failure blocks; critique in the audit log; no remediation rule 3
(2026-10-13/14). Code-review reconciler before remediation only (2026-10-13). Patch dispatches
use `--json-schema`, phases drop unchanged files, the "Output the JSON object directly" sentence
is reworded for those three prompts (2026-10-14/15). Test projects (crew-chatter, team-notes) are
stand-ins; only BuildWorks handling larger designs counts (2026-10-10).

**External targets** (under `C:\Users\Shawn-work\repositories\testing-repos\`, on the other machine;
none of them is on this machine, checked 2026-10-16):
- **This machine:** `C:\Repositories\testing-repos\crew-chatter` (not the original target) at
  `8f539e5` on `main`: npm workspaces `backend` (Express 5) and `frontend` (React 19, Vite 7),
  `governed.yaml` running `npm ci`, typecheck, lint, build. Runs 1 and 2 above are in its store;
  proposals 29-34 (features 2-7) are not exported yet. Its run-2 spec is untracked.
- **crew-chatter**: `master` at `8063995` (six split designs under
  `docs/features/crew-chatter-*/design.md`); untracked run 6 `spec.md` and `plan.md` under
  `docs/features/crew-chatter-foundation/` (move them aside before another `new-run`); branches
  `gov/crew-chatter/2` (`e02e035`), `/3` (`cc839ba`), `gov/crew-chatter-foundation/6`
  (`ca0bd0e`). Run 1 still reads nonterminal, so guided mode refuses; use low-level commands.
  Runs 2-4 asides are under `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-*`.
- **web-calculator-selfreview-2026-10-14\target**: the 2026-10-14 paid run's durable target.
- **json-schema-probe\**: the two Task 1 probe clones (2026-10-14).
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
- A `result` line with `is_error: true` and `terminal_reason: api_error` can follow `stop_reason: max_tokens` messages; thinking counts toward the response cap. Read the last line of the retained stream, not the exit code. `claude-sonnet-5-5` caps at 128,000 and the largest phase reply measured 98,218 tokens.
- The one-repair extractor (hazard 1 item 10) escapes raw control characters inside strings and nothing else. Crew-chatter run 3 phase 2 wrote 5,314 characters of one file unescaped; fixture `test/fixtures/recorded/crew-chatter-run-3-phase-2-malformed-json.json`. To measure a lapse, count actual newline characters; a string-state scanner flips at the first unescaped quote and under-counts.
- `--json-schema`: the model answers through a `StructuredOutput` tool call; the result line carries `structured_output`, and its `result` equalled `JSON.stringify(structured_output)` in every probe. With the old "output the JSON directly" wording, one 82 KB call wrote its answer twice (text, then tool): 81,781 output tokens against 53,154. Fixtures `json-schema-probe-gate.json` and `json-schema-probe-web-calculator-phase-2.json`.
- A probe checkout under the system temp directory had its `Read` calls denied; one under `testing-repos` did not. Read `permission_denials` on every probe result line before describing what the model saw.
- A schema cannot forbid an unchanged file; the phase and self-review drop handles that, remediation does not (open decision 1).

### Code review stage
- A code_review block is a result, not a driver fault; a pass can retain findings. A final panel can block after a successful remediation; it gets no further patch.
- Finding IDs are system-assigned; dedup by `intentKey` works within a round only, so a defect recurring in a later round gets a new ID.
- Run 6: every round-2 high traced to round 1 (the remediator re-imposed a rule the plan reconciler removed, or added an obligation it refused to invent). Remediation is where out-of-spec obligations enter; recorded in `test/fixtures/recorded/code-review-crew-chatter-run-6.json`.
- Concurrent panels consume `Promise.allSettled` results in frozen panel order; prove ordering with out-of-order completions, two or more failed seats and non-zero cost.
- `insertFindingDecision` requires grounding exactly for `rejected_with_rationale` and normative changes exactly for `addressed`.
- Code review's clean guard counts ignored entries (`checkWorktreeClean`); `verifyCommit` removes ignored output after the checks pass (hazard 22).

### Evidence, runs and storage
- Retained raw files since 2026-09-28 hold the whole `stream-json` stdout; read `total_cost_usd`, `usage` and `result` from the last line (`parseEnvelope`), never `JSON.parse` of the whole file.
- A schema dispatch whose result line lacks `structured_output` is a failed dispatch: no `agent_run` row, and the refusal names the line's `total_cost_usd` so the cost reaches the audit event.
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
- Spec, plan, fold and split authors run in the target root; reviewers do not (the executor does not enforce `deniedPaths`). A commit to the target after `new-run` never reaches that run (worktree from the frozen starting commit).
- `npm ci` fails when `package.json` and the lockfile disagree; install every library the design needs in the baseline commit. ESLint reports a disable directive for an unknown rule as an error; check lint in a worktree after `npm ci`.
- A control prompt rebuilt byte-identical to a recorded dispatch (`input_hash` match) makes a replay comparable to the run; an older prompt can be rebuilt from `git archive <commit> src`.

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
- Keep the file glob in any `npm test` variant: bare `node --test` runs `test/fixtures/harness/*.mjs` (one waits on stdin, one dumps the environment). Full-suite check: `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` (about 13 minutes; run it in the background).
- On the Shawn-work host prefix BuildWorks commands with `PATH="/c/Users/Shawn-work/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin:$PATH"` or doctor's `executor_probe` fails.
- A scratch `.mjs` outside the repository imports repository TypeScript only through a `file:///C:/...` URL.
- The auto-mode classifier sometimes returns no verdict (retry once, then move on) and sometimes blocks an action outright (launching `claude` without `--safe-mode`, deleting target files, a first commit in the target): stop and give the operator the command.
- `git worktree remove` fails with "Filename too long" on a worktree holding `node_modules`; use a short path or `git archive | tar -x`, and clear leftovers with `robocopy <empty> <dir> /MIR`.
- `npm run`/`npm test` export `.npmrc` settings as `npm_config_*`; this host's `allow-scripts` makes a child `npm ci` fail with `EALLOWSCRIPTS`. Bootstrap now uses `VERIFY_ENV_PASSTHROUGH`.
- Open SQLite only through `openDatabase` in `src/sqlite.ts`; a direct `node:sqlite` import brings the experimental notice back.
- A new subprocess that reads a diff copies the buffer size of the code that already reads diffs; Node's 1 MiB default blocked the self-review before review caught it.

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
- When quoting an expected cost, use an artifact of the same size or say it is smaller. A probe that changes how the answer is delivered can change output volume; quote a range, not the old cost.
- Effort is not a linear cost knob: a Haiku 5.5 reviewer call cost 2.4x `medium` at `high` and 14x at `xhigh` (2026-10-15; estimated $0.40, spent $1.29). Price an effort change from one measured call first.
- 2026-10-15 replays: five errors in one session (unmeasured cost, wrong field path, three scorer fixes after seeing data, a lens claim made without reading `code-reviewer-security.ts`, a circular "known defects" list). Each was caught after presenting, not before. Rule: a claim reaches the operator only after its source was checked in this session, and a scoring rule is fixed and committed before the data it scores exists. Prose rules alone did not hold; checker-enforced ones did.
- A replay script reads the reply's real field path from a recorded reply before spending (reviewer findings sit under `proposedContentChanges.findings`); keep each call's raw stream so a wrong path costs a re-parse, not a re-run.
- Before offering a change to a target after `new-run`, trace what the run froze.
- A field in the only sample read is not evidence it is in the contract; read a second sample.
- An instruction telling an operator how to edit generated output is a claim about its bytes; run the generator and apply the instruction first. A walk that verifies a procedure must run exactly the documented commands.
- Identify a system-written row by a field only the system writes, never one a model can produce.
- Before fixing a review finding, trace its failure scenario in code; a fix whose test passes under both old and new behaviour proves nothing.
- Measure a prompt change against recall, not only against the error it targets. Calibrate a classifier on the known positive before reading new results.
- One run's finding order is not evidence of when a defect appeared; check the reviewed commit.
- "It fails at the previous commit too" does not make a red test acceptable; trace it once.
- Before asking the operator to choose, say what each option does and costs in plain words.
- A plan step that re-decides after a record is built must reset every field the first decision wrote. Test a projection against the record the stage writes, not one the test builds.
- To find tests that pin a list, search for the constant and the code that builds the list (`DEFAULT_SETTINGS`, `RECONCILER`), not only the string literal.
- Before writing a count into a plan or this file, run the exact filter the test will use and find the calls that report that exact finding; a summary label can name a different finding.
- Before listing a test as affected, trace how its run is built (a run built in the store with no dispatch is unaffected).
- Check a sentence about a mechanism against the plan's hazard notes before writing it ("independent", "against the code").
- When a change moves a failure from "parsed later" to "refused at the envelope", keep what the old path recorded (row, cost).
- `dispatchOnce` appends " (requested model m, effort e)" to failure reasons; don't anchor a test's regex at the end of the reason.
- A review record with zero findings and no status stays unreconciled until someone records the disposition; a status check across `docs/features/` should read every review file, not only plans.

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

### 2026-10-13 — first live split; feature 1 built and verified; hazard 22; three replays
- Run 5 ($2.26): the split dispatch proposed 6 features, validated first time; designs committed in the target as `8063995`. Fixture `test/fixtures/recorded/split-crew-chatter-run-5.json`.
- Run 6 (feature 1, 29 files): spec, plan (37 items), 4 phases, then `npm ci`, typecheck, lint and build passed, the first crew-chatter run to pass verification. Code review refused on ignored `node_modules/` (hazard 22, fixed). Round 1: 13 findings; remediation `ca0bd0e`; round 2: 7 findings, 4 high; gate blocked. $4.84 over 22 dispatches.
- Asked why models miss rules, three consented replays ($0.227 + $0.0568 + $0.0718) showed recall, not rule-breaking, was the main miss; the operator then chose the self-review and the code-review reconciler. Errors made: attributing #209 to remediation without checking the reviewed commit, citing a count from memory (27 vs 19), and a recommendation that would have halved real findings.

### 2026-10-14 — reconciler built, self-review reconciled and built, first paid run
- Code-review reconciler built ("build it now"), in-session review found 4 low text errors, committed in `6282a6f`. Self-review plan's two reviews reconciled, then built via `/implement-plan` (review: 5 issues, none high), committed as `fd235a8`.
- First paid run with the self-review (`driver.mjs paid --yes --model claude-sonnet-5-5`, web-calculator, target `C:\Users\Shawn-work\repositories\testing-repos\web-calculator-selfreview-2026-10-14\target`): 12 dispatches, $1.12023, blocked at phase 2 of 2 before the self-review. The reply was a valid object followed by one sentence of prose, and returned `index.html` unchanged; either fault alone blocks. Fixture `test/fixtures/recorded/web-calculator-selfreview-run-1-phase-2-trailing-prose.json`.
- The operator asked whether BuildWorks over-complicates structured output; the answer was that the CLI's `--json-schema` had gone unadopted since 2026-09-07. A two-call probe ($0.1061466) answered through `StructuredOutput`, but its reads were denied (temp-directory checkout). The structured-patch-output plan followed; its gating probes ($1.2809081) both passed, including crew-chatter run 3's 82 KB phase 2 prompt, whose ten files all applied.

### 2026-10-15 — structured patch output built
- The operator said "go ahead and yes reword that sentence first": `STRUCTURED_OUTPUT_RULE` replaced the "Output the JSON object directly…" sentence in the three patch prompts, then Tasks 2-8 were built. In-session review: 0 high, 1 medium (a refused structured reply lost its cost; fixed), 5 low.
- Full serial suite 1562/1556 pass, 0 fail, 6 skipped, HEAD `fd235a8` before and after; typecheck and `check:docs` clean; smoke 13/13; every break-it failed and was restored by hash.

## 2026-10-15 — compaction and status sweep

### Decisions and assumptions
- The operator asked for the learnings update, doc-check, the plan marked `Implemented`, its review reconciled, and every plan's status checked. All 49 plans were correct; three older review records lacked a final status and were reconciled with a dated block that leaves their findings as written.

### What worked
- Reading each review record's status line, not only plans, found the three gaps: `cli-operator/2026-09-10-code-review-2.md` (`open`, zero findings), and two records with no status whose findings source inspection showed fixed.

### Verification
- `npm run check:docs` - `doc-check: clean` after the record edits; rerun after this rewrite.

### Next up
- Done the same day: committed as `94e3b98`, and the paid run completed ($1.39416, 21 dispatches; see Current state).
