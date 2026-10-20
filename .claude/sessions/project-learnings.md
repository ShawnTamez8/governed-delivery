# Project learnings — BuildWorks (governed-delivery)

Current state is the resume point and is rewritten in place. Session records below it are
history and may name superseded state; Current state wins when they disagree. This file is
the system of record; machine-local memory is only a cache
(`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-10-19: changes 2 and 10 done; crew-chatter runs 6 and 7 completed and merged; nothing in flight; no spend authorized)

**Resume point.** Branch `sandboxed-delivery` carries the build of two `Implemented` plans,
committed 2026-10-19 at the operator's word and not pushed (`origin/sandboxed-delivery` is at
`be6a88c`):
- `docs/features/derived-artifacts-and-dependency-policy/plan.md`, rework changes 2 and 10
  (operator: "Go ahead and build", 2026-10-18). Its review
  `2026-10-18-derived-artifacts-and-dependency-policy-review.md` is `reconciled` (12 accepted,
  1 deferred); the critical finding made regeneration commit derived paths before
  `removeIgnoredOutput`. The plan's implementation record lists every difference and break-test.
- `docs/features/prompt-retention/plan.md` (operator: "yes, start saving prompts now"): every
  dispatch writes `.governance/prompts/<run>/<input_hash>.txt` before the harness starts, a failed
  dispatch's audit summary names the file, and an unwritable prompt refuses the dispatch.
- Validation (2026-10-18): full serial suite 1692 tests, 1687 pass, 0 fail, 5 skipped; typecheck
  and check:docs clean; smoke 13/13 (the smoke exercises neither regeneration nor the dependency
  question).

**Changes 2 and 10 are done.**
- Change 2: `governed.yaml` takes an optional `derived:` block, frozen as `verification.derived`
  (a profile without it is refused). `src/derived-artifacts.ts` regenerates and commits derived
  files after every phase, the self-review fix and each remediation; review diffs exclude them; a
  spec declaring one is refused; the `static-web` starter emits a lockfile entry (operator choice).
- Change 10: the spec's optional `## Dependencies added` raises an approve/deny question at
  `spec_decision`; deny ends the run blocked; a fold may not change the list;
  `src/dependency-policy.ts` refuses an implementation or remediation commit adding an unlisted
  package. Narrower than the proposal: npm only, additions only (not removals or version
  changes), and no allowlist (every listed package asks).
- Run 5 met the plan's Task 11 criterion. An earlier note said "finished" needed a run
  completing through delivery; that bar was the assistant's, not the plan's.
- **Run 6 (2026-10-19, operator: "live-prove untested paths") completed**, $4.91524352 in 26
  Claude dispatches plus 24 Decision-1 requests. Delivery passed 18/18 over `ea9da8d..3c706fb`
  (branch `gov/crew-chatter-accounts-notes/6`, worktree
  `C:\Repositories\testing-repos\crew-chatter\.governance\worktrees\6`). Five packages approved
  (finding 104) and OD-001 server-log code (91). The lockfile was regenerated after phases 1 and 2;
  phase 1 changed only `engines` in `backend/package.json`. Remediation regeneration ran live
  (unchanged). The review excluded the lockfile (19 changed paths, reviewers saw 18). The
  code-review reconciler made its first live rejection (finding 113, 2 of 2 calls). Detail is in
  the plan's "Second live run" section. The only interventions were the operator's two answers
  and the dashboard signature.
- Still never run live, because no model produced the triggering behaviour: regeneration after a
  self-review fix (0 patches), a remediation regeneration that commits, and the unapproved-addition
  refusal. All are covered by tests and break-tests. Remaining options outside the plan: an
  allowlist, checking removals and version changes, and the review's deferred finding.
- Merged (operator, 2026-10-19): crew-chatter `main` fast-forwarded `ec2049c..3c706fb` to run 6's
  branch, so run 6 can be the `--after` predecessor for feature 2. The untracked copies of its
  `spec.md` and `plan.md`, byte-identical to the branch, went to
  `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-19-run6`. The target's tree is clean.
- **Run 7, crew-chatter feature 2 (`crew-chatter-folders-tags`, operator: "I approve the spend",
  2026-10-19) completed**: $5.56758051 in 23 Claude dispatches plus 13 Decision-1 requests. The
  design is proposal 29's text, committed as crew-chatter `1497e7a`; `new-run --after 6`; settings as
  run 6. No operator question (OD-001, subfolder handling on folder delete, routed follow-up). Plan
  passed in one round; 4 phases (31 tasks); every lockfile regeneration was unchanged; self-review
  had 0 patches; verification passed first time. Code review round 1 had 7 medium/low findings, all
  kept, with one remediation; round 2 had 5 medium/low findings below the threshold (138 and 139 say
  the remediation's double-submit guard drops a second legitimate create, so remediation introduced
  them, as in run 6). Delivery passed 12/12 over `887a644..c5d2ff3`. The only intervention was the
  approval signature. Merged: crew-chatter `main` fast-forwarded to `c5d2ff3`; the untracked
  spec and plan went to `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-19-run7`.
- **The untracked spec/plan residue is a BuildWorks defect**: the writers put every run's documents at
  `docs/features/<slug>/` in the operator's checkout, and every reader follows that `output_ref`. Git
  refuses a fast-forward over an identical untracked file (probed), and runs of one slug overwrite each
  other: `status --run 5` now reports "the spec has changed since review". The fix plan is
  `docs/features/run-documents-in-governance/plan.md` (`Reconciled` 2026-10-19 against a Copilot
  review: 18 accepted, 2 rejected, 1 deferred; documents go under `.governance/documents/<run>/` via
  `runDocumentDir` in `src/paths.ts`). Built 2026-10-19 under `/implement-plan` and committed at
  `5e3832b` (operator: "commit"); the operator chose to keep stored refs absolute ("Keep absolute"),
  overriding the plan's repo-relative refs. Full suite 1695/1690/0/5, smoke 13/13. No live run has
  used it yet; its first paid run should record the target's `git status --short`.

**Run 5** (2026-10-18, crew-chatter feature 1 from `ec2049c`, operator-authorized): blocked at
verification `typecheck` on one implementer line unrelated to the mechanisms,
`frontend/src/hooks/useAutoSave.ts(63,44)`, a spread of a ref narrowed to `null` (TS2698). The
operator also approved OD-001 (server-log reset link). $4.04347149 in 15 Claude dispatches plus 24
Decision-1 requests. Worktree `C:\Repositories\testing-repos\crew-chatter\.governance\worktrees\5`,
branch `gov/crew-chatter-accounts-notes/5` at `e62df19`. Its untracked `spec.md` and `plan.md`
were moved to `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-19-run5` (operator, 2026-10-19);
the target's tree is clean.

**Change 1 spike passed (2026-10-19, committed `28a5786`):** `docs/features/sandboxed-implementer-spike/plan.md` (`Implemented`), code in `scripts/sandbox-spike/`, nine fixtures `test/fixtures/recorded/sandbox-spike-*.json`, $0.25 total. `claude` on the host with BuildWorks' hand-written MCP tool server (`bw`, 4 tools) acting in a Docker container (worktree-only mount, read-only `.git`, egress proxy to `registry.npmjs.org` only, limits); boundary checks 17/17 (run 1 failed on `PWD`, a runtime default; operator amended). `--safe-mode` discards an `--mcp-config` server; without it, `--restricted` keeps `CLAUDE.md` out (positive control proved the check) and the operator adopted that command. Run 6 phase 2 replayed in tool mode: same 5 paths, gate ok, lockfile regenerated, all 4 verify commands pass in-container; $0.2417 vs $0.1903 one-shot, 5.9x slower. Scratch target `C:\Repositories\testing-repos\sandbox-spike\` (branch `spike/phase-2` at `f269893`), image `bw-spike:1`; Docker Desktop left running.

**Next action:** the operator decides:
- whether to authorize the change 1 build plan `docs/features/sandboxed-implementer/plan.md` (`Reconciled`: Copilot's review `2026-10-19-sandboxed-implementer-review.md` beside it, 8 findings accepted, among them rename-as-deletion, derived files absent at base, work-container quiescence before commit, repo-keyed Docker names, and a command's exit kept apart from Docker's). Operator choices in it: discard and regenerate agent edits to derived files, LF worktrees, $2.00 per patch dispatch, no `--safe-mode`, Node/npm only but four extension points held by tests, errors never swallowed (`ContainerError`, teardown failures recorded). Multi-stack model recorded unbuilt in `docs/proposals/target-declared-environments.md` (operator builds C#, Azure, SQL, React, Rust apps; real Azure services do not fit a disposable sandbox).
- the next rework change after change 1.
  `sandboxed-delivery` is not merged to `master` until the rework is complete (operator,
  2026-10-19).
- whether to start crew-chatter feature 3 (`new-run --after 7`; needs its own spend authorization;
  features 3-7 are proposals 30-34, not yet exported; export, keep the text from `## Problem` up to
  `## Why this is upstream`, commit it as the feature's `design.md`). Run 5 is superseded by run 6.
- grounding: the recommendation is to leave it unadopted until more recorded positives exist.
- No PR to `master` (operator, 2026-10-17). No spend is authorized.

**Rework proposal** (`docs/proposals/sandboxed-delivery-rework.md`, ten changes in three tracks;
only changes 2 and 10 are authorized, and only to build). Operator facts (2026-10-18): every
developer has Docker Desktop with WSL 2 and Windows Sandbox, Docker first; each holds a personal
Claude Code Enterprise seat and BuildWorks has no credential of its own; runs happen on the
operator's workstation; Docker, WSL and Claude Code are replaceable between BuildWorks versions,
never during a run. So change 1 keeps `claude` on the host and reaches the container only through
an agent-neutral BuildWorks MCP tool server; each dependency is confined to one concrete module;
every deciding check stays agent-independent; per-agent confinement is proven by attempted
violations (MHA-02); the adapter interface is extracted only when a second agent is added
(MHA-03). Decision-1 after self-critique: only as narrow evaluated checks; prose open questions in
the spec self-critique (run 2's draft) are the one candidate. Change 9 (whole-run replay) waits
until changes 2, 10 and 1 are built (operator, 2026-10-18); its design is
`docs/proposals/whole-run-replay.md` (about 2.5–3.5 weeks), and why the proposal's hash replay
fails is in the derived-artifacts plan's "Change 9" section. Open: whether per-seat use is
"ordinary use" under Claude Code's legal terms.

**Runbook defect, unfixed:** the approval export breaks under PowerShell 7.6 (`ConvertFrom-Json`
turns the `--expires` ISO string into a local date). `-DateKind String` fixed it for run 5, but
it does not exist in Windows PowerShell 5.1, so `docs/runbooks/cli-operator.md` and `README.md`
still need a fix that works in both.

**Crew-chatter feature 1 on this machine** (`C:\Repositories\testing-repos\crew-chatter`, `main`
at `c5d2ff3` after merging runs 6 and 7; `1497e7a` adds the feature-2 design; `ec2049c` adds the lockfile `derived:` block; `8f539e5` adds the feature-1 design; `eb1fa30` the TS backend plus React frontend
baseline, `npm ci`, typecheck, lint, build):
- Run 1 (whole PRD): $1.80; spec declared 32 files; the operator approved a split into 7 features
  (proposals 28-34; 29-34 not exported); ended `blocked` as designed.
- Run 2: $0.97, blocked at `spec_review` because inherited open decisions sat under another
  heading and the reconciler's move into `## Open decisions` hit the no-add rule. Fixed in
  `561ce9e` (`docs/features/open-decisions-outside-section/plan.md`): `validateSpecDoc` refuses an
  OD-led line outside the section; fixture
  `test/fixtures/recorded/spec-crew-chatter-run-2-open-questions-outside-section.json`. Residual:
  plain-prose open questions under another heading still pass.
- Run 3: $3.44, the fix held live; OD-001 routed `upstream_follow_up`, so no pause. Blocked at
  `code_review` with `code_review.artifact.missing` (spec declared package files conditionally,
  plan added no dependency). Fixed by `docs/features/declared-artifacts-in-tasks/plan.md`
  (`plan.artifact.untasked`, hazard 24, committed and pushed on `dashboard-restyling`); fixture
  `test/fixtures/recorded/plan-crew-chatter-run-3-declared-artifacts-untasked.json`. Worktree 3
  and the target's `.governance/raw/3` are the only full raw streams: keep them.
- Run 4: $1.78, chose TipTap 3 and told the read-only implementer to run `npm install`; OD-001
  routed `upstream_blocking`. Stopped unanswered at the decision pause (no stop command exists);
  led to the rework proposal and changes 2 and 10. Asides:
  `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-18-run3` and `-run4`.
- Run 5: above.

**Decision-1 (`src/systemone.ts`, operator's Foundry resource, API key):** config from user-scope
`SYSTEMONE_ENDPOINT`, `SYSTEMONE_DEPLOYMENT`, `SYSTEMONE_DEPLOYMENT_TYPE`, `SYSTEMONE_API_KEY`;
the deployment type is never checked against vendor values (operator, 2026-10-17); data may be sent
for some operator decisions. Probe: `test/fixtures/recorded/systemone-probe-snitch-resource.json`
(`api-key` header, `{model, answers, usage}`, unknown deployment is 404 `DeploymentNotFound`).
- D6 fails the confirmed rule at T = 0.8 (`test/fixtures/recorded/systemone-d6-evaluation-crew-chatter-run-6.json`;
  ten identical #905 requests agreed on the choice, probability 0.687-0.922).
- Format checks (`docs/features/decision-1-format-checks/plan.md`, `Proposed`;
  `test/fixtures/recorded/systemone-format-checks-evaluation.json`, 172 requests, $0.001632):
  narration passes (3 of 3 remarks, 0 of 128 criteria; fails at T ≥ 0.9); grounding fails (flagged
  supported rejections R-200-1 and R-905-1). Never relabel cases or split a check by kind after
  seeing answers.
- Narration is wired into spec review (`6cb2e3b`, `docs/features/narration-check-spec-review/plan.md`):
  a flagged entry is a reconciler finding; `new-run` refuses without the variables unless
  `--no-narration-check`; guided mode always on; each call an `agent_run` with executor
  `systemone` and null cost; any failed request blocks the run. Tests use
  `test/systemone-stand-in.ts`, and every test `new-run` passes `--no-narration-check`. No live
  run has flagged anything yet (runs 3-5 and the 2026-10-17 web-calculator run: all `criterion`).

**Web-calculator paid runs under current defaults** (Haiku 5.5 reviewers, sonnet-5-5 reconciler):
2026-10-15, $1.39416 in 21 dispatches, all four patch dispatches returned `structured_output`, the
self-review and code-review reconciler ran live for the first time, one remediation; target
`C:\Users\Shawn-work\repositories\testing-repos\web-calculator-structured-2026-10-15\target`.
2026-10-17 with `--narration-check`, $1.51048 in 22 dispatches, one remediation. Verification in
both ran only `node --version` and `npm --version`. Structured-output plan open decisions 1
(remediation drops unchanged files) and 3 (other dispatches to a schema) remain undecided.

**Working state (verified 2026-10-19):**
- `dashboard-restyling` pushed at `7446cd0` (14 ahead of `origin/master` on 2026-10-18).
  `848469b` and the 2026-10-19 commits on `sandboxed-delivery` (through `5e3832b`, the
  run-documents build) are unpushed. An untracked
  `docs/runbooks/workflow-explorer.html` (2026-10-18, referenced nowhere, origin unrecorded) was
  left out of that commit; it is the operator's to keep or drop. Local `master` was 38 behind `origin/master` on
  2026-10-10 (not rechecked). Pushing uses the personal gh account (auto memory); Snitch's
  decision worker was unavailable on 2026-10-18, so the operator ran the push.
- An untracked empty file `=` sits at the repository root (still present 2026-10-19); deleting it
  is the operator's call. A plain-text API key copy sits in
  `C:\Users\tamezs\.buildworks\[Environment]SetEnvironmentVariable.txt`; removing it is theirs.
- `CLAUDE.md` and `AGENTS.md` are byte-identical. All 49 plans carried a correct Status line on
  2026-10-15. Unbuilt by choice: `baseline-verification`, `implementation-phase-retry`
  (`Reconciled`), `implementation-segments-and-pause` (`Shelved`), `usage-limit-refusal-summary`
  and `code-review-contract-drift-issue` (`Proposed`); `dashboard-pwa-redesign` is `Reconciled`
  with Task 7 next.
- No run is in flight. A loopback dashboard for crew-chatter was launched 2026-10-19 from this
  checkout (repositories file in the session scratchpad); it ends with that session.

**Open work list (operator asked for one list, 2026-10-13):**
1. **Code-review reconciler** (`Implemented`, `6282a6f`): 2-of-2 agreement to reject; any failed
   call keeps the finding. First live call 2026-10-15 kept 1, rejected 0; first live rejection in
   crew-chatter run 6 (2026-10-19, finding 113, login timing, quoting the spec's sign-in error). Not done: the
   passed-branch check in `src/operator-state.ts` (reachable only with a forged audit event).
   Replay: 30 Haiku calls, 1 wrong rejection, 3 missed, 1 invented quote caught. A quote proves the
   words exist, not that they support the rejection (hazard 16).
2. **Implementation self-review** (`Implemented`, `fd235a8`, hazard 23): has not yet returned a
   patch live. Deferred: a CRLF blob makes the unchanged-file drop disagree with `git add`.
3. **#209:** the NUL-byte email defect existed at reviewed commit `bb7f3f6`;
   `test/code-review-run-6-evidence.test.ts` pins both control findings.
4. **Reviewer recall** (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`):
   each call reports about 2 of 8+ known defects; rewording the rule halved real findings; a
   checked `basis` field was valid 10 of 10. Undecided: merged samples per lens (about $0.02 per
   lens per round) or the `basis` field alone (a 10-call replay, about $0.07).
5. **Effort replay** (2026-10-15, $1.2863 against a $0.40 estimate;
   `...-security-effort.json`): distinct defects per call of 7 — Haiku `medium` 2.1 ($0.008),
   `high` 2.5 ($0.019), `xhigh` 3.9 ($0.110); merged three calls 4.2 / 4.9 / 5.8. Sonnet 5.5
   `medium` 1.3, Opus 5.5 `medium` 0.7 (all real), Haiku 4.5 `medium` 1 false finding in 10.
   Undecided: reviewer default effort, merging samples, a three-lens panel replay. One prompt, one
   lens, one sample of each arm.
6. **Spec/plan reconciler stays on Sonnet 5.5** (recommended; $0.54 of run 6's $4.84).
7. **Crew-chatter run 6 (other machine):** blocked at code review round 2; re-run, hand fix of
   `gov/crew-chatter-foundation/6` at `ca0bd0e`, or stop. Undecided. A blocked run cannot be an
   `--after` predecessor.
8. **Older backlog:** the dashboard split card still offers Modify (the core refuses it);
   `ARCHITECTURE.md` section 14 and README line 94 still say `git mv`; split designs carry no
   parent open decisions.

**Backlog plans, detail kept because nothing else records it:**
- **Phase retry** (`docs/features/implementation-phase-retry/plan.md`, `Reconciled` 2026-10-09):
  frozen `implementationPhaseAttempts` seeded 2, ceiling 3; retry only a reply refused with
  " is not valid JSON: "; the retry prompt is the original plus a notice stating the refusal (an
  identical resend "is not a retry"); the retry event names the refused `agent_run` id. Reading
  rule for the first paid retry: keep 2 if a retried phase parses on attempt 2; set 1 and reopen if
  two retried phases are refused again in the same file. Task 3 (extract crew-chatter run 2 phase 2
  into a fixture) is not done; its raw reply is under that target's `.governance/raw/2/`. Building
  makes every earlier frozen profile unusable. Structured output now covers the phase replies it
  was written for; whether it is still wanted is the operator's call.
- **Toolchain probe** (`docs/proposals/toolchain-probe-and-stack-intent.md`): the check must stop
  the run before spend and name the failing command, exit code and end of output (2026-10-11);
  other decisions open.
- **Usage limit** (`docs/proposals/usage-limit-refusal-strands-a-run.md`): option B (recognise the
  429 shape, record reset time and raw cost) is planned; option C (pause) is unauthorized. Its
  plan's `[Verified]` lines about the `failed()` suffix predate prompt retention, which appended
  `; prompt <path>`; re-verify before building.
- **Baseline verification:** not scheduled; the runbook check "Prove the verification commands run
  in a fresh worktree before you spend" is the chosen route.
- **Code-review prompt wall:** code review refuses a prompt over 1 MiB (hazard 18); about 130 to
  160 task items fill it [Inference, n=2]. Splitting the design is the only route past it.

**Shipped and committed:** spec operator decisions (2026-09-27), streaming harness output
(`85fccad`), per-agent settings (`c539e59`), phased implementation and the one-repair extractor
(`3c19653`), verification-aware prompts (`c9ef115`), Haiku 5.5 reviewer defaults (`e2d9bd0`), the
eight-failure fixes (`fd756a7`), design split and code-review reconciler (`6282a6f`), self-review
(`fd235a8`), structured patch output (`94e3b98`), Decision-1 narration (`6cb2e3b`, `05803eb`),
open decisions outside section (`561ce9e`), declared artifacts in tasks (`dashboard-restyling`).
Seeded defaults in `src/policy.ts`: Opus 5.5 `high` authors, Haiku 5.5 `medium` spec and code
reviewers and code-review reconciler, Sonnet 5.5 `medium` implementer; `--model` freezes only the
spec/plan reconciler.

**Decisions locked (operator):** the operator signs approvals; the assistant never reads or invokes
`~/.buildworks/approval.key`. A completed paid run never authorizes another spend; ask before each
paid range. Reviewers Haiku 5.5 (pinned `claude-haiku-5-5`), authors Opus 5.5, implementer Sonnet
5.5 (2026-10-08/09). Design split inside spec review above 30 declared files; the operator merges
each feature before the next starts; segments plan shelved (2026-10-12). Hazard 22: clean ignored
output after checks pass (2026-10-13). Self-review: find and fix in one dispatch after the last
phase; unusable reply skips, guard failure blocks (2026-10-13/14). Code-review reconciler before
remediation only (2026-10-13). Patch dispatches use `--json-schema` and phases drop unchanged files
(2026-10-14/15). Test projects are stand-ins; only BuildWorks handling larger designs counts
(2026-10-10).

**External targets on the other machine** (`C:\Users\Shawn-work\repositories\testing-repos\`, none
on this machine, checked 2026-10-16):
- **crew-chatter**: `master` at `8063995` (six split designs); untracked run 6 `spec.md` and
  `plan.md` under `docs/features/crew-chatter-foundation/` (move aside before another `new-run`);
  branches `gov/crew-chatter/2` (`e02e035`), `/3` (`cc839ba`), `gov/crew-chatter-foundation/6`
  (`ca0bd0e`). Run 1 still reads nonterminal, so guided mode refuses; use low-level commands.
- **web-calculator-selfreview-2026-10-14\target**, **json-schema-probe\** (two probe clones).
- **team-notes** (HEAD `3b73c3d`): runs 1-12, none delivered; "not a real scenario". Evidence in
  `test/fixtures/recorded/plan-team-notes-run-12.json` and `run-10-dispatch-context.json`.

## Diagnostics quick-reference

### Prompts, parsing and provider output
- `specReviewGate`/`planReviewGate` block only on `cannot_determine`/`upstream_blocking`; severity is stored evidence there. Only `code_review` gates on severity (`codeReviewBlockingSeverity`).
- A prompt criterion narrows model judgement but does not settle it. A decision the gate depends on needs a deterministic rule or a human.
- A rule a model must follow is followed reliably when it is a format the code checks (the `basis` field: 10 of 10); a prose prohibition is followed by sampling and also suppresses wanted output (variant B halved real findings). Prefer a checked field over a reworded sentence.
- A reviewer call is one sample: each Haiku security-reviewer call found about 2 of 8+ known defects, a different 2 each time. Recall, not rule-breaking, was run 6's main miss.
- Dispatches run `--restricted --safe-mode` and see no `CLAUDE.md`, `AGENTS.md`, `~/.claude/CLAUDE.md` or `lessons.md` (probe 2026-10-17); a target's instruction files cannot reach a run.
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
- A run's working `spec.md` and `plan.md` live in the target's `.governance/documents/<run>/`, and each stage's `output_ref` stores that absolute path; only the run branch's projections commit puts them under `docs/features/<slug>/`. A run whose stages ran before that change left them untracked in the checkout, where the next `new-run`, `doctor` or fast-forward merge refuses; move those aside first.
- A full `npm test` can leave an empty "moved" commit (author `t`) on the current branch; check `git log -1` after full runs.
- A dispatch that exits 1 within seconds is usually the claude.ai session limit: a `rate_limit_event` with `status: "rejected"` at the stream's tail. It is not always free (crew-chatter run 2 phase 6: $0.1291 the store did not record), and a hit mid-range strands earlier phases ($9.63 in that run). Fixture `test/fixtures/recorded/crew-chatter-run-2-session-limit-refusal.json`.
- Spec, plan, fold and split authors run in the target root; reviewers do not (the executor does not enforce `deniedPaths`). A commit to the target after `new-run` never reaches that run (worktree from the frozen starting commit).
- `npm ci` fails when `package.json` and the lockfile disagree; install every library the design needs in the baseline commit, or declare the lockfile under `derived:`. ESLint reports a disable directive for an unknown rule as an error; check lint in a worktree after `npm ci`.
- `npm install --package-lock-only --ignore-scripts` changed only `package-lock.json` and wrote no ignored output in a crew-chatter probe (2026-10-18).
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
- A claim reaches the operator only after its source was checked in this session, and a scoring rule is fixed and committed before the data it scores exists (2026-10-15 replays: five errors caught only after presenting; prose rules alone did not hold, checker-enforced ones did).
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
- A blast-radius search for a type's literals misses tests that `deepEqual` a whole parsed object (`test/cli.test.ts` compares the frozen profile's `verification`); when a frozen shape gains a field, also search for assertions over the parent key.
- To find tests that pin a list, search for the constant and the code that builds the list (`DEFAULT_SETTINGS`, `RECONCILER`), not only the string literal.
- Before writing a count into a plan or this file, run the exact filter the test will use and find the calls that report that exact finding; a summary label can name a different finding.
- Before listing a test as affected, trace how its run is built (a run built in the store with no dispatch is unaffected).
- Check a sentence about a mechanism against the plan's hazard notes before writing it ("independent", "against the code").
- When a change moves a failure from "parsed later" to "refused at the envelope", keep what the old path recorded (row, cost).
- `dispatchOnce` appends " (requested model m, effort e; prompt .governance/prompts/<run>/<hash>.txt)" to failure reasons (the prompt part since 2026-10-18); don't anchor a test's regex at the end of the reason.
- A review record with zero findings and no status stays unreconciled until someone records the disposition; a status check across `docs/features/` should read every review file, not only plans.
- "Implemented" on a plan means built and unit-proven; when asked whether a change is finished, separate built, committed, and proven by a completed live run, and name the paths no live run has exercised.

## Session records

### Earlier history (2026-08-29 to 2026-10-15)
- Steps 1-8 shipped; step 9 reached 2026-09-03. Paid web-calculator chains 2026-09-06 to 09-12: 11 to 16 dispatches, $1.00 to $2.45; three completed, the rest blocked at code review on correct high findings or provider bytes.
- 2026-10-04 to 10-07: team-notes run 7 blocked on add versus modify (fixed by listing scope paths), run 8 on the session limit, run 9 on one raw line break (the one-repair extractor), run 10 ($7.30) on an uninstalled toolchain; crew-chatter (other machine) run 2 ($9.63) committed 5 of 6 phases before the session limit.
- 2026-10-08 to 10-10: crew-chatter run 3 ($6.46) blocked on an unrepairable reply (phase-retry plan); run 4 ($4.94) passed plan review over the 80-item ceiling (led to the design split). Eight red tests had three causes, fixed in `fd756a7`; they had been committed red because earlier plans called them unrelated.
- 2026-10-11 to 10-13: segments plan shelved for the split; split built (threshold 30); first live split proposed 6 features (`test/fixtures/recorded/split-crew-chatter-run-5.json`); run 6 (feature 1) was the first crew-chatter run to pass verification, then blocked at code review round 2 ($4.84, 22 dispatches). Three replays showed recall, not rule-breaking, was the main miss.
- 2026-10-14 to 10-15: code-review reconciler (`6282a6f`) and self-review (`fd235a8`) built; a web-calculator run blocked at phase 2 on trailing prose (`test/fixtures/recorded/web-calculator-selfreview-run-1-phase-2-trailing-prose.json`), which led to structured patch output (`94e3b98`). The 2026-10-15 status sweep reconciled three older review records.
- Lessons kept: trace the gate before proposing a remedy; compare the retained dispatch each agent received, never a later working tree; when a model-judgement fix fails twice on the same class, offer a deterministic or human-gated route.

### 2026-10-16 to 2026-10-18 — Decision-1, crew-chatter runs 1-5, rework proposal, changes 2 and 10
- Decision-1 client and D6 evaluation (`6cb2e3b`), format checks, narration wired into spec review; crew-chatter runs 1-5 on this machine; two fixes (`561ce9e`, declared-artifacts-in-tasks); the sandboxed-delivery rework proposal and whole-run replay design; changes 2 and 10 and prompt retention built. Outcomes are in Current state.
- 2026-10-17 documentation sweep: the runbook gained the narration-check setup and the plan refusal; README, `CLAUDE.md`/`AGENTS.md` and the run-buildworks skill now cite the Haiku 5.5 reviewer runs. Historical plans, reviews and proposals were not changed.

## 2026-10-19 — status check and compaction

### Decisions and assumptions
- No new operator decisions. The operator asked for status and whether changes 2 or 10 were finished: both are built and uncommitted, partly proven live by run 5, and not finished until committed and proven by a completed run.
- Compaction trimmed this file from 535 lines by compressing resolved run narrative into Current state and the history section; no open decision or durable fact was dropped.

### Verification
- `git status -sb` - `sandboxed-delivery` one ahead of `origin/sandboxed-delivery`; the build is still uncommitted.
- `git -C C:/Repositories/testing-repos/crew-chatter status --short` - run 5's `spec.md` and `plan.md` untracked under `docs/features/crew-chatter-accounts-notes/`.

- The operator then said to move or delete run 5's spec and plan and commit the changes: both were moved aside (not deleted), and the build was committed without `=` and `docs/runbooks/workflow-explorer.html`.

### Next up
- The operator decides what to do with run 5's typecheck block and whether to push.
