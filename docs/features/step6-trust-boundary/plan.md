# Step-6 Trust-Boundary Correction Implementation Plan

**Status:** Reconciled

**Goal:** Close the step-6 trust-boundary defect the recorded step-7 smoke exposed — the implementer subprocess could mutate the worktree the deterministic gate later trusted — by enforcing a read-only executor invocation, a clean-worktree gate before and after dispatch, literal git path handling with exact staged/committed set equality, fail-closed link components, and frozen agent/executor binding at every dispatch construction site, then re-running the step-7 Task 12 smoke against the corrected code.

**Source:** `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` (the confirmed diagnosis of the failure, hypothesis confirmed with deterministic local reproductions); `ARCHITECTURE.md` sections 1 (agents propose, the system decides), 6 (trust boundaries), 7 (repository contract, protected paths, branch and worktree isolation), 9 (the binding rule: a field nothing enforces does not belong here), 10 (model configuration frozen at run start), 11 (harness invocation, the sandbox is enforced by the caller, capabilities are checked at configuration time), 12 (the profile is the frozen record), 15 (evidence model), 22 (known hazards); `docs/hazards.md` entries 3, 4, 8, 11, 12, 14 and the new entry 15 this plan adds; `step7:docs/proposals/implementer-writes-files-it-also-proposes.md` (the recorded failure, its three options, and the rejection of gate tolerance); `step7:docs/features/verification-stage/plan.md:377-422,467-519` (the smoke Task 12 this correction unblocks); the shipped step-6 plan (`docs/features/implementation-stage/plan.md`) as the structural precedent for this document.

**Hazards considered:** 3 (the proposal's framing applies it to a constrained *behaviour*: the implementer prompt now states the checkout is read-only, and `test/prompts.test.ts`'s source scan covers the sentence), 4 (expected behaviour comes from the architecture and the recorded real smoke output, not invented fixtures; the new mutating fixture mode is derived from the recorded reproduction and the scratch reproductions of the diagnosis), 8 (the executor still resolves through the one supported shell shim; every new flag is a constant, shell-safe value — no second harness), 11 (no `--bare`: the installed CLI makes it API-key-only, and a default OAuth installation must complete a run; the implementation capability is declared and a test asserts the seeded registry staffs the stage), 12 (frozen agent and executor definitions become the effective ones — the fixture tests freeze the executor they hand, and pre-existing runs refuse at config time rather than being silently upgraded), 14 (reviewer independence recording is untouched), 15 (the new entry this plan adds: a declared sandbox and a compliant sample do not make a proposal subprocess read-only). Entries 1, 2, 5, 6, 7, 9, 10, and 13 do not drive this correction: output parsing and raw-output retention are unchanged; the delivery check is step 8's; the plan gate's concerns are step 5's; no remediation rounds or retries are added; no setup-time interpreter spawns are added; the model map is unchanged; the gate invents no obligations.

**Assumptions:**

- **The capability vocabulary extends the existing two names.** Five dispatchable stage kinds map to four capability names: `spec` → `spec`, `spec_review` → `review`, `plan` → `plan`, `plan_review` → `review`, `implementation` → `implementation`. An unmapped kind is refused by name (`no executor capability defined for stage kind ...`). The executor's declared `capabilities` become `["spec", "plan", "review", "implementation"]`, and `ARCHITECTURE.md` section 11's YAML is updated with both the capability list and the new command.
- **Frozen-executor identity is canonical JSON equality.** The handed executor must serialize identically to the profile's frozen executor (`canonicalJson(executor) === canonicalJson(profile.executor)`). Id equality alone would let a caller hand the same id with a different command, probe, or sandbox — the exact divergence the diagnosis's reproduction exposed.
- **The stage test files freeze the executor they hand.** The three stage test files simulate runs whose frozen executor *is* the fixture executor (the profile rewrite pattern already established by the "no implementation model" config-time test). This is not a test seam: the profile is the frozen record of what the run resolved at start, and a test run resolves the fixture at start.
- **The read-only tool inventory is verified by a dedicated probe, not assumed.** Whether the installed CLI rejects an unknown `--tools`/`--disallowedTools` name loudly or silently is unverified, and a silent-ignore would restore the default inventory — so Task 9 Step 1 runs the exact executor command with a probe prompt asking the model to enumerate its tools, asserts exactly `Read`, `Glob`, and `Grep`, and treats any deviation as a blocking finding before the chain's spend. The flags themselves are verified in the 2.1.251 help (`--restricted`, `--safe-mode`, `--tools`, `--disallowedTools`, `--permission-mode dontAsk`, `--strict-mcp-config`, `--no-session-persistence` all exist; `--bare` is API-key-only); the `mcp__*` deny pattern's acceptance is covered by the same probe.
- **Runs whose profiles predate this correction refuse at configuration time** — the old capabilities lack `spec`/`implementation` — with the refusal naming the capability. Config freeze means a fresh run is required; no in-place repair (hard rule 6, and the diagnosis's risk note). The refusal is asymmetric by design: `spec` and `implementation` refuse on old runs (their capabilities are new), while `plan` and `plan_review` continue to pass (their capabilities existed) — an old run can complete planning but never reach implementation, which is the config-freeze consequence, not a defect.
- **The staged-set and committed-set equality checks are layered backstops.** Their stage-level failure requires non-proposed dirt at add time, and the post-dispatch cleanliness gate blocks exactly that dirt first. Task 7 records this honestly: the checks are implemented as defence in depth, the reachable behaviour is proven by the `-A` ordering test and the git-invocation contract test, and the unobservable middle is not claimed as proven.
- **The recorded blocked smoke run is terminal.** Its frozen profile predates the corrected executor; Task 9 runs fresh scratch repositories.
- **The prompt sentence is UX, not a guard.** The diagnosis is explicit: enforcement belongs in the write path and at the invocation boundary; the sentence states the constraint (hazard 3) and nothing more.

**Approach:** One executor definition change (read-only restricted/safe invocation, capability additions), one frozen-binding helper in `src/profile.ts` consumed by all four dispatch construction sites, profile-sourced agent selection in the three stages, three worktree-cleanliness assertions in the implementation stage, literal git invocation with exact staged/committed set equality, a link-component fail-closed walk replacing the dangling-link branch, one prompt sentence, a hazards entry, and the architecture prose — regression-first per task, with each guard proven by breaking it (Task 7). No schema change, no new harness interface, no stage-sequence change: `scripts/doc-check.mjs`'s derived shapes (sections 5, 7, 15 and the schema fence — verified in `derive()`) are untouched by the section 11 and 22 edits.

**Affected areas:** `src/executor.ts`, `src/profile.ts`, `src/select.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/implementation-stage.ts`, `src/cli.ts`, `src/prompts.ts`; `ARCHITECTURE.md` (sections 11 and 22), `docs/hazards.md` (new entry 15); `test/executor.test.ts`, `test/profile.test.ts`, `test/select.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, `test/implementation-stage.test.ts`, `test/prompts.test.ts`, `test/fixtures/harness/emit-implementation-stage.mjs`; the step-7 branch's records (rebased, resolution notes appended); `.claude/sessions/project-learnings.md` (learnings entry); `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` (committed as the evidence record).

**Known blockers:**

- **The four existing link tests' expected messages change.** Under the new fail-closed link rule the `symlink-dir`, `escape-link`, `dangling-link`, and `symlink-design` cases refuse with the link-component message *before* the resolved-target checks. Each expectation updates in Task 5; this is recorded, not a surprise.
- **The stage test files' scratch-executor tests each gain a profile-freeze step** (Task 2): every test that hands `fixtureExecutor(scratch)` must freeze that same executor into the profile or the binding check refuses it. Enumerated by pattern in Task 2, not left to discovery.
- **The smoke spends real money** (Task 9): two full scratch chains plus the canary, budgeted at roughly $1.2-2.0 total, matching the recorded step-7 attempt ($0.5021 through seven dispatches to the block).
- **`--literal-pathspecs` is a global git option, not a `git add` option** (verified 2026-08-31 in a scratch repo: `git add --literal-pathspecs` is refused with exit 129; `git --literal-pathspecs add -- <paths>` stages exactly the literal paths). The plan mandates the global form.

**Blast radius** (verified by import search and by reading the files):

- `src/executor.ts` — imported by `src/profile.ts` (freezeProfile hardcodes `CLAUDE_CODE`), `src/cli.ts` (four call sites), `test/executor.test.ts` (the command pin at line 10), `test/harness.test.ts` (probe and envelope only — no command assertion), `test/profile.test.ts` (id only). The command change breaks exactly the line-10 pin; the probe is unchanged, so the "real claude shim resolves" test (harness.test.ts:94-104) still passes.
- `src/profile.ts` — imported by `src/cli.ts`, `src/approval-stage.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/implementation-stage.ts`, and five test files. Adding exports breaks nothing; the stages and CLI gain the new import.
- `src/select.ts` — imported by `src/spec-stage.ts` (line 196), `src/plan-stage.ts` (lines 10, 64, 288), `test/select.test.ts` (four call sites at lines 13, 20, 27, 34). The `selectReviewers` signature change touches exactly those seven sites; `plan-stage.ts`'s `selectPanel` seam (`deps: { selectPanel?: (risk, specialties) => AgentDefinition[] }`) widens to take candidates first, and the one seam usage in `test/plan-stage.test.ts:504` (`() => []`) typechecks unchanged.
- `src/spec-stage.ts`, `src/plan-stage.ts`, `src/implementation-stage.ts` — each imported by `src/cli.ts` and its own test file; signatures unchanged.
- `src/cli.ts` — no importers; `test/cli.test.ts` spawns it. The four cases pass `profile.executor` instead of the live `CLAUDE_CODE`. The existing walk tests ("plan/implement drives the real stage logic up to the dispatch boundary", cli.test.ts:626-683, 709+) survive: the CLI's new `getRun` + `loadVerifiedProfile` precede the stage call with the same messages (`run ${id} does not exist`, profile-tamper wording), and the binding check passes there because `new-run` froze `CLAUDE_CODE` and the CLI hands it back.
- `src/prompts.ts` — imported by the three stages and `test/prompts.test.ts`; one added sentence.
- `ARCHITECTURE.md` — `check:docs` derives sections "Stage sequence", "State, storage, and evidence", and "Repository contract" plus the schema fence (`scripts/doc-check.mjs:91-200`); the section 11 YAML and section 22 prose are not derived shapes, so those edits cannot trip exit 2.
- `docs/hazards.md` — current tier; the checker only requires the `**Hazards considered:**` line in feature documents, so a fifteenth entry changes nothing else.
- `step7` — rebased onto corrected master in Task 8; the verification-stage plan and the proposal receive resolution notes without rewriting their historical narrative.

**Verification:** per-task `node --test <file>` with expected results stated; the completion gate in Task 8: `npm ci && npm run typecheck && npm test && npm run check:docs` from a clean checkout, every break-it cycle recorded, then Task 9's real-harness smoke against the corrected code.

---

### Task 1: The read-only executor definition

**Depends on:** None

**Files:**
- Modify: `src/executor.ts` — `CLAUDE_CODE`
- Modify: `test/executor.test.ts`
- Modify: `ARCHITECTURE.md` — section 11's executor YAML

**Steps:**

- [ ] **Step 1: the regression test first**
  - Change: `test/executor.test.ts` gains `claude_executor_exposes_only_read_tools_in_restricted_safe_mode`: it asserts `CLAUDE_CODE.command` deep-equals the exact array
    `["claude", "-p", "--output-format", "json", "--restricted", "--safe-mode", "--tools", "Read,Glob,Grep", "--disallowedTools", "Write,Edit,NotebookEdit,Bash,mcp__*", "--permission-mode", "dontAsk", "--strict-mcp-config", "--no-session-persistence"]`
    and that `CLAUDE_CODE.capabilities` includes `"spec"`, `"plan"`, `"review"`, and `"implementation"`, with a comment tying the flag set to the installed CLI's help semantics (verified at plan time) and noting that the exact array is the probe input Task 9 Step 1 runs against the real binary — the unit pin and the real-harness evidence name one command: `--restricted` removes command/code tools and WebFetch unless `--tools` names them and confines file tools to the working directories; `--safe-mode` disables customizations (CLAUDE.md, skills, hooks, MCP, plugins, custom agents) while auth, model selection, built-in tools, and permissions work normally; `--tools Read,Glob,Grep` fixes the inventory; `--disallowedTools` denies `Write`, `Edit`, `NotebookEdit`, `Bash`, and `mcp__*`; `--permission-mode dontAsk` makes the session non-interactive; `--strict-mcp-config` with no `--mcp-config` means no MCP servers; `--no-session-persistence` works with `-p`; and `--bare` is deliberately absent because the installed CLI makes it API-key-only (hazard 11 — a default OAuth installation must keep completing runs). The test also asserts `probe` is still `["claude", "--version"]`.
  - Verify: `node --test test/executor.test.ts`
  - Expected: the new test fails against current master — the command lacks the flags and the capabilities lack `spec`/`implementation`.

- [ ] **Step 2: the definition**
  - Change: `src/executor.ts`'s `CLAUDE_CODE.command` becomes the exact array above, `capabilities` becomes `["spec", "plan", "review", "implementation"]`, `probe` unchanged. Update the existing pin test `the command matches section 11's YAML` (line 10) to the new array in the same step.
  - Verify: `node --test test/executor.test.ts`
  - Expected: all pass.

- [ ] **Step 3: the architecture YAML**
  - Change: `ARCHITECTURE.md` section 11's executor YAML `command:` line becomes the full flag array and `capabilities: [plan, review]` becomes `capabilities: [spec, plan, review, implementation]`.
  - Verify: `npm run check:docs`
  - Expected: exit 0; the derived shapes are untouched by the section 11 edit, and the pre-existing historical path warnings remain (the master baseline names 25).

**Task completion evidence:** the executor command is exactly the read-only invocation, the capabilities cover all five dispatchable kinds, and the regression has been seen failing against the old definition.

### Task 2: Frozen agent and executor binding at every construction site

**Depends on:** Task 1

**Files:**
- Modify: `src/profile.ts` — `requiredCapability`, `requireFrozenBinding`
- Modify: `src/select.ts` — `selectReviewers` candidates parameter
- Modify: `src/spec-stage.ts`, `src/plan-stage.ts`, `src/implementation-stage.ts` — profile-sourced agents, the binding check, capability check
- Modify: `src/cli.ts` — the `spec`, `plan`, `implement`, and `dispatch` cases pass `profile.executor`
- Modify: `test/profile.test.ts`, `test/select.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`, `test/implementation-stage.test.ts`

**Steps:**

- [ ] **Step 1: the test scaffolds** (suite stays green — enforcement does not exist yet)
  - Change: in `test/implementation-stage.test.ts`, `fixtureExecutor()` (line 49) gains `id: "claude-code"` and `capabilities: ["spec", "plan", "review", "implementation"]`; in `test/spec-stage.test.ts` (line 15) and `test/plan-stage.test.ts` (line 50), `fixtureExecutor(scriptPath)` gains the same id and capabilities.
  - Change: each of the three run-setup helpers gains a freeze step. In `test/implementation-stage.test.ts`'s `withApprovedRun`, after `freezeProfile` + `setProfileRef`, rewrite `profile.json`'s `executor` to `fixtureExecutor()` (the established profile-rewrite pattern of the "no implementation model" test at lines 566-581): read the file, set `executor`, `canonicalJson`, write, `setProfileRef` to the new hash. In `test/spec-stage.test.ts`'s `withRun` and `test/plan-stage.test.ts`'s `withApprovedRun`, the same, with the executor frozen being the one the test will hand: the helpers gain `opts.executor?: ExecutorDefinition`, defaulting to `fixtureExecutor(FIXTURE)`, and every test that hands `fixtureExecutor(scratch)` passes the same scratch executor via the option. The comment states the fixture-blindness answer explicitly: the run's frozen executor *is* the fixture; a run that hands an executor its profile never froze must be refused, and the fixture tests are not exempt from that contract.
  - Verify: `npm test`
  - Expected: all pass — the scaffold alone changes nothing the enforcement would yet catch.

- [ ] **Step 2: the regressions** (each fails against current code)
  - Change: `test/implementation-stage.test.ts` gains `a handed executor that differs from the frozen profile executor is refused before the stage row`: with the profile freezing `fixtureExecutor()`, hand `fixtureExecutor()` with a modified `sandbox.idleTimeoutSeconds` (deep-different but same id) and expect refusal matching `/does not match the executor frozen at run start/`, with no stage row, no worktree, and zero `agent_run` rows. It gains `an executor without the implementation capability is refused before the stage row`: freeze a fixture executor whose `capabilities` omit `implementation` (and hand the same), expect `/lacks the required capability "implementation" for stage kind implementation/`, no worktree, zero dispatches.
  - Change: `test/spec-stage.test.ts` and `test/plan-stage.test.ts` each gain the capability-absent analogue (`spec` and `plan` respectively), asserting the refusal precedes the stage row.
  - Change: `test/profile.test.ts` gains unit tests for `requiredCapability` and `requireFrozenBinding`: the five-kind mapping; an unknown kind refused by name; capability absent refused naming capability and kind; id-different executor refused; same-id-different-command refused (the deep-equal proof); matching executor passes.
  - Change: `test/cli.test.ts` gains the raw-dispatch reachability test: a run whose frozen profile's executor capabilities omit the stage kind's required capability (the profile-rewrite pattern) exits 1 naming the capability and spawns nothing — the proof that the capability rule holds on the raw `dispatch` surface, not only behind the stages.
  - Verify: `node --test test/implementation-stage.test.ts test/spec-stage.test.ts test/plan-stage.test.ts test/profile.test.ts test/cli.test.ts`
  - Expected: the new tests fail — the stage runs to completion instead of refusing, and the raw-dispatch test spawns (or errors elsewhere) instead of refusing by capability, because no binding check exists yet.

- [ ] **Step 3: the helper**
  - Change: `src/profile.ts` exports `requiredCapability(stageKind: string): string | null` (the five-kind map above, `null` for unmapped) and `requireFrozenBinding(profile: Profile, executor: ExecutorDefinition, stageKind: string): { ok: true } | { ok: false; reason: string }`, checking in order: `canonicalJson(executor) === canonicalJson(profile.executor)` — refusal `the executor handed to the stage does not match the executor frozen at run start`; `requiredCapability(stageKind)` — refusal `no executor capability defined for stage kind ${stageKind}` when unmapped; the capability present in `profile.executor.capabilities` — refusal `executor ${executor.id} lacks the required capability ${capability} for stage kind ${stageKind}: capabilities are ${profile.executor.capabilities.join(", ")}`. Comment: the profile is the frozen record (section 12) and canonical JSON is the identity test — id equality alone would accept a caller handing the same id with a different command or sandbox, the exact divergence the diagnosis's finding 4 names.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 4: the stages and selection**
  - Change: `src/select.ts`'s `selectReviewers(risk, requiredSpecialties)` becomes `selectReviewers(candidates: AgentDefinition[], risk: Risk, requiredSpecialties: string[])`, filtering `candidates` instead of the global `AGENTS`; `src/select.ts` drops the `AGENTS` import. `test/select.test.ts`'s four call sites pass `AGENTS` (importing it from `src/agents.ts`).
  - Change: `src/spec-stage.ts` — after the `--model` checks (the config-time cluster, before `store.insertStage`): `requireFrozenBinding(profile, executor, "spec")` **and** `requireFrozenBinding(profile, executor, "spec_review")` refused by name — the stage dispatches under two stage kinds, and both required capabilities must fail at configuration time, mirroring how the stage already resolves two model entries; the author becomes `profile.agents.find(a => a.id === "spec-author")` with refusal `configured agent spec-author is not in the frozen profile` when absent and `agent ${author.id} is bound to executor ${author.executor}, not the frozen executor ${executor.id}` when `author.executor !== executor.id`; the panel selection at line 196 becomes `selectReviewers(profile.agents, risk, REQUIRED_SPECIALTIES)`; each selected reviewer gets the same executor-binding refusal at panel selection, before its first dispatch.
  - Change: `src/plan-stage.ts` — the same pair of checks for `"plan"` and `"plan_review"` and `plan-author`; the `selectPanel` seam (line 61) widens to `(candidates: AgentDefinition[], risk: Risk, specialties: string[]) => AgentDefinition[]`, the default is `selectReviewers`, and line 288 passes `profile.agents`.
  - Change: `src/implementation-stage.ts` — the same for `"implementation"` and `implementer`, placed after the `--model` check and before the approval read (so the refusal precedes the stage row and the worktree); the author lookup at line 310 becomes the profile lookup with the two refusals above.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 5: the CLI passes the frozen executor**
  - Change: `src/cli.ts` — the `dispatch` case passes `dispatchProfile.profile.executor` instead of `CLAUDE_CODE` and, after the frozen model resolution and with the other config-time checks, calls `requireFrozenBinding(dispatchProfile.profile, dispatchProfile.profile.executor, stage.kind)` throwing its reason before the prompt-file read — the raw surface gets the same capability rule the stages get, so a capability the stages refuse is not spendable through the documented escape hatch — and refuses an `--agent` absent from `dispatchProfile.profile.agents` with `configured agent ${id} is not in the frozen profile`. The `spec`, `plan`, and `implement` cases gain, before the stage call: `const stageRun = store.getRun(runId)` throwing `run ${runId} does not exist` when missing (the same message the stages use, so the existing cli tests' expectations hold), then `loadVerifiedProfile(process.cwd(), stageRun)` throwing its reason, then the stage called with `verified.profile.executor`. The `CLAUDE_CODE` import leaves `src/cli.ts` entirely — verify by grep that no live-executor call site or import remains.
  - Verify: `node --test test/cli.test.ts`
  - Expected: all pass — the walk tests reach the same deep refusals as before, the profile load adds no new failure for the frozen-by-`new-run` profiles they construct, and the new raw-dispatch capability regression passes.

- [ ] **Step 6: the regressions pass**
  - Verify: `node --test test/implementation-stage.test.ts test/spec-stage.test.ts test/plan-stage.test.ts test/profile.test.ts test/cli.test.ts`
  - Expected: all pass, including the previously-failing regressions.

**Task completion evidence:** every dispatch construction site uses the frozen executor and the frozen agents; a differing executor, a missing capability, and an unknown stage kind each refuse by name before any stage row, worktree, or paid invocation — including on the raw `dispatch` surface, which refuses a capability or agent the frozen profile does not declare before any spawn; and the fixture suites freeze exactly what they hand.

### Task 3: Worktree cleanliness is a deterministic gate

**Depends on:** Task 2

**Files:**
- Modify: `src/implementation-stage.ts`
- Modify: `test/fixtures/harness/emit-implementation-stage.mjs` — the `mutate-then-propose` mode
- Modify: `test/implementation-stage.test.ts`

**Steps:**

- [ ] **Step 1: the fixture mode and the regression** (fails against current code)
  - Change: `test/fixtures/harness/emit-implementation-stage.mjs` gains the mode `mutate-then-propose`, which simulates exactly what the recorded smoke's implementer did: before building the `ok` proposal, write `unreported.txt` (untracked), append a line to `base.txt` (tracked), and write `ignored-residue.txt` (ignored — the test's `.gitignore` makes it so), each with a comment naming the recorded reproduction as the source. The `ok` proposal then follows.
  - Change: `test/implementation-stage.test.ts` — `withApprovedRun` gains `opts.gitignore?: string` writing and committing `.gitignore` in the base commit. The regression `an executor that mutates the worktree before returning a proposal is refused naming every path`: scope `["src/a1.ts", "test/a1.test.ts"]`, `.gitignore` naming `ignored-residue.txt`, mode `mutate-then-propose`; expect `ok: false` with the reason naming all three entries — assert each of `unreported.txt`, `base.txt`, and `ignored-residue.txt` appears in the reason (individually, without pinning git's entry order); the stage and run blocked; the worktree retained with all three entries present; the branch log holds only the projections commit (nothing was applied); no `implementation.patch.apply` audit event.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: the regression fails — current code returns `ok: true` and applies the patch on top of the mutation.

- [ ] **Step 2: the three checks**
  - Change: `src/implementation-stage.ts` gains a `worktreeClean(runGit, worktreePath)` helper returning `{ ok: true } | { ok: false; entries: string[] }`: runs `git status --porcelain -z --untracked-files=all --ignored=matching` (the invocation verified at plan time; `--ignored=matching` is what makes a write into an ignored path visible), splits on NUL, drops empty entries; a git failure is treated as dirty, and the refusal then names the git detail. Three call sites, each aborting with action `implementation.worktree.dirty` and the reason naming the entries (or the git detail when git itself failed):
    - after the projections commit's audit event, before the dispatch — `worktree is not clean before dispatch: ${entries}`;
    - immediately after `dispatchOnce` resolves, before `extractJsonBody` — `worktree is not clean after dispatch: ${entries}` (the backstop the diagnosis mandates: model-side writes either cause this refusal or survive into a passed verification input, and this closes the second half);
    - after the last patch commit, before the final head read — `worktree is not clean after applying patches: ${entries}` (the pass hands verification a clean tree, as the diagnosis's expected-behaviour paragraph requires).
  - Comment: this is the core's backstop if CLI controls, hooks, or executor configuration drift; the stage refuses and names the paths, never resetting and continuing, because that would hide the evidence that the executor boundary failed.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: the regression passes; the existing suite still passes (the fixture writes nothing in the other modes).

- [ ] **Step 3: the pre-dispatch check is reachable**
  - Change: confirm the pre-dispatch check fires only on genuine residue — the existing success test and every gate-refusal test already prove the worktree is clean after the projections commit, so no new test is needed for the happy side.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: all pass.

**Task completion evidence:** a mutating executor blocks the stage by name with every class of residue — tracked, untracked, and ignored — before anything is applied, and the handed-off worktree is asserted clean.

### Task 4: Literal git paths and exact staged and committed sets

**Depends on:** Task 3

**Files:**
- Modify: `src/implementation-stage.ts` — the add invocation, the two set-equality checks, the audit derivation
- Modify: `test/implementation-stage.test.ts`

**Steps:**

- [ ] **Step 1: the regressions** (the ordering one fails against current code)
  - Change: `test/implementation-stage.test.ts` gains:
    - `an option-like patch path is refused alongside a dirty worktree before any git add` — scope `["-A"]`, mode `mutate-then-propose`; expect `ok: false` with `/worktree is not clean after dispatch/`, no apply commit, and no file named `-A` in the worktree. Against current code the stage passes and `git add -A` commits both `-A` and `unreported.txt` — the recorded reproduction.
    - `an option-like patch path is committed as a literal path` — scope `["-A"]`, mode `ok`; expect a pass, the file `-A` present with the marker content, and the commit's changed paths exactly `["-A"]` (`git diff-tree --no-commit-id --name-only -r -z HEAD` inside the worktree).
    - `the stage's git add invocation stages exactly the literal paths` — a scratch git repository contract pin (the `ok-fixture-contract` pattern of lines 583-610): create a repo with `-A`, `other.txt`, and `unreported.txt` untracked, run the exact invocation `git --literal-pathspecs add -- -A other.txt`, and assert `git diff --cached --name-only -z` yields exactly `-A` and `other.txt`. The comment states the pin's honest scope: it fixes the git semantics the stage relies on (a bare `-A` argument is `--all` and stages everything — the diagnosis's reproduction 3), and it is the contract the implementation's invocation must satisfy; the stage-level ordering guard is the previous test.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: the first fails against current code (stage passes, commit carries `unreported.txt`); the second passes already (a clean tree makes `git add -A` and the literal form identical — recorded, not a contradiction); the third pins git semantics directly.

- [ ] **Step 2: the literal invocation and the set checks**
  - Change: `src/implementation-stage.ts`'s apply step (f) becomes `runGit(["--literal-pathspecs", "add", "--", ...patchPaths], worktreePath)` — the global option precedes the subcommand (verified at plan time; `git add --literal-pathspecs` is refused, `git --literal-pathspecs add` is not). After the add, before the commit: `runGit(["diff", "--cached", "--name-only", "-z"], worktreePath)` parsed on NUL, each entry `normalizePath`'d, compared as a set against the normalized patch paths; a mismatch aborts `implementation.patch.refused` with `staged set differs from the proposed patch: staged ${staged.join(", ")}, proposed ${proposed.join(", ")}`. After the commit: `runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD"], worktreePath)`, the same set comparison, refusal `committed set differs from the proposed patch: ...`. The audit event naming the applied paths (the step-6 plan's step (h)) becomes `applied patch to ${observed.join(", ")} (base ${headAtProposal})` where `observed` is the committed set — the summary derived from what git actually committed, never from the proposal.
  - Comment: `--literal-pathspecs` and `--` make a path named `-A` a path; the set checks are the backstop if anything else ever enters the index or the commit — dirt the cleanliness gate should already have caught, which is why Task 7 records them as layered rather than independently proven. The audit event after the commit (the step-6 plan's step (h)) changes from the proposed `patchPaths` to the observed committed set.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: all three new tests pass; the existing suite passes (the `--` and `--literal-pathspecs` change the invocation for every patch, and the set checks pass on the clean-fixture paths).

**Task completion evidence:** a signed path that looks like a git option is committed as a literal path and only that path; dirt cannot reach the index or the commit; and the audit names the observed committed set.

### Task 5: Link and junction components fail closed

**Depends on:** Task 4

**Files:**
- Modify: `src/implementation-stage.ts` — the per-file security walk
- Modify: `test/fixtures/harness/emit-implementation-stage.mjs` — the `link-ordinary` mode
- Modify: `test/implementation-stage.test.ts`

**Steps:**

- [ ] **Step 1: the regression** (fails against current code)
  - Change: `test/fixtures/harness/emit-implementation-stage.mjs` gains the mode `link-ordinary`: before emitting, create `src/ordinary-target/` (inside the worktree, ordinary, outside any scope, not protected) and a directory junction `src/alias` → `src/ordinary-target` (the `symlink-dir` pattern, `process.platform === "win32" ? "junction" : "dir"`), then propose `src/alias/x.ts`.
  - Change: `test/implementation-stage.test.ts` gains `a link redirecting the write to an ordinary out-of-scope target is refused for the link, not the target` — scope `["src/alias/x.ts"]`, mode `link-ordinary`; expect `ok: false` with `/patch path src\/alias\/x\.ts contains a link component: src\/alias/`. Against current code this passes — the resolved target is inside the worktree and not protected, exactly the diagnosis's reproduction 2.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: the regression fails — current code returns `ok: true` and writes through the junction.

- [ ] **Step 2: the fail-closed walk**
  - Change: `src/implementation-stage.ts`'s per-file security section (d): replace the dangling-link walk (lines 444-467) with a link-component walk — for each component of the target relative to the worktree root, `lstatSync`; any component that is a symbolic link (which includes junctions on Windows) refuses `implementation.patch.refused` with `patch path ${file.path} contains a link component: ${relComponent}`. A dangling link lstat's as a symlink, so the dangling case is subsumed and its branch is deleted. The resolved-target backstops (`isPathInside`, the resolved `touchesProtected` re-check) remain after it — defence in depth for a link appearing between the walk and the write.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: the regression passes; the four existing link tests fail only on their expected-message regexes, updated in the next step.

- [ ] **Step 3: the four expectations move**
  - Change: `test/implementation-stage.test.ts` — the `symlink-dir` case (line 501) expects `/contains a link component: src\/alias/`; the `escape-link` case (line 507) expects `/contains a link component: src\/escape/`; the `dangling-link` case (line 513) expects `/contains a link component: src\/alias/`; the `symlink-design` case (line 519) expects `/contains a link component: src\/alias\.md/`. Each keeps its name's intent but asserts the new fail-closed rule — the link is refused for being a link, never for what it happens to resolve to.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: all pass.

**Task completion evidence:** any link or junction component in a patch target refuses the patch by name before anything is written, including the ordinary out-of-scope redirect the diagnosis reproduced, and the four historical link cases assert the new rule.

### Task 6: The prompt sentence, the hazards entry, and the architecture prose

**Depends on:** Task 5

**Files:**
- Modify: `src/prompts.ts` — `buildImplementationAuthorPrompt`
- Modify: `test/prompts.test.ts`
- Modify: `docs/hazards.md` — entry 15
- Modify: `ARCHITECTURE.md` — section 11 invocation paragraph, section 22

**Steps:**

- [ ] **Step 1: the prompt constraint** (regression first)
  - Change: `test/prompts.test.ts` — `CONSTRAINT_STRINGS` gains `"read-only"`; the generated-implementation-prompt test (line 142) gains `"This checkout is read-only for you"` among its required strings. The comment marks the entry as hazard 3 applied to a constrained behaviour, per the proposal's framing.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: both fail against current master.

- [ ] **Step 2: the sentence**
  - Change: `src/prompts.ts`'s `buildImplementationAuthorPrompt`, after `Run no git commands: the system applies and commits the patches you propose.`, gains: `This checkout is read-only for you: do not create, modify, or delete any file. Only the patch content you return is considered.` with a comment: UX, not a guard — enforcement is the invocation boundary and the cleanliness gate (the diagnosis's explicit ordering).
  - Verify: `node --test test/prompts.test.ts`
  - Expected: all pass.

- [ ] **Step 3: the hazards entry**
  - Change: `docs/hazards.md` gains entry 15, `## 15. A declared sandbox and a compliant sample do not make a proposal subprocess read-only`, recording the failure that actually occurred: the step-7 smoke's implementer wrote the files it then proposed, `add requires the file not to exist` blocked, and the retained worktree showed the untracked writes; a prompt and one compliant smoke are not evidence that a process is read-only. The requirement: proposal subprocesses run read-only at the invocation boundary (restricted mode, an explicit read-only tool inventory), the stage asserts the worktree is clean before and after dispatch, and any change blocks the run naming the paths.
  - Verify: `npm run check:docs`
  - Expected: exit 0; the pre-existing historical path warnings remain.

- [ ] **Step 4: the architecture prose**
  - Change: `ARCHITECTURE.md` — in section 11's invocation paragraph, the sentence after `**The sandbox is enforced by the caller, not requested of the agent.**` gains: enforcement starts at the invocation — proposal subprocesses run read-only (restricted mode, explicit read-only tool inventory, no session persistence), and the stage asserts a clean worktree before and after the dispatch, because a prompt-level instruction is a request and the tree is checked, not trusted. Section 22's opening changes `states fourteen failure modes` to `states fifteen failure modes` and the summary sentence gains `, and proposal subprocesses that are requested rather than enforced to be read-only` at the end of the list.
  - Verify: `npm run check:docs`
  - Expected: exit 0; the pre-existing historical path warnings remain.

**Task completion evidence:** the prompt states the constraint and the scan covers it; the failure that actually occurred is recorded in `docs/hazards.md` as a requirement; and the architecture names the invocation-boundary enforcement.

### Task 7: Break and restore every guard

**Depends on:** Task 6

**Files:**
- Validate: the changed files, via the repo's break-it cycle (`git add -A` → break → run the named test → `git checkout -- <path>` → `git diff --quiet -- <path>`)

**Steps:**

- [ ] **Step 1: the executable breaks**
  - Change: for each guard, break it, run the named test, observe the named failure, restore, observe green:
    1. drop `--restricted` from `CLAUDE_CODE.command` → `claude_executor_exposes_only_read_tools_in_restricted_safe_mode` fails;
    2. make `requireFrozenBinding` skip the canonical comparison → the executor-mismatch test in `test/implementation-stage.test.ts` fails;
    3. make `requireFrozenBinding` skip the capability check → the capability-absent test fails;
    4. remove the post-dispatch cleanliness call → the mutate-then-propose and the `-A` ordering tests fail: the block moves to the pre-pass check, so the `after dispatch` message regexes fail and the `-A` file exists (the patch was applied) where the tests assert it absent;
    5. remove the pre-pass cleanliness call while keeping the post-dispatch one → no named test fails in isolation (the dirt tests block at the post-dispatch check first); with *both* removed, the mutate-then-propose test fails by passing entirely — the two checks are one layered family, recorded as one combined break;
    6. remove the link-component walk → the `link-ordinary` test fails (the stage passes through the junction).
  - Verify: `node --test <the named test file>` after each break and each restore
  - Expected: exactly the named test fails on each break; green after each restore.

- [ ] **Step 2: the honest non-breaks**
  - Change: record, in the task evidence, the three guards that cannot be broken at stage level and why: the staged-set and committed-set equality checks (their failure needs non-proposed dirt at add time, which the post-dispatch cleanliness gate blocks first — they are layered backstops, and the git-invocation contract test pins the git semantics the fixed invocation relies on); the literal-add invocation itself (regressing it to `["add", ...patchPaths]` produces no stage-level failure while the cleanliness gate stands — the same reason the `-A` clean case passes either way, already recorded in Task 4); and the profile-sourced agent lookup (the profile hash verification makes a divergent agent set unreachable; the lookup is enforced by construction, and the success paths exercise it).
  - Verify: read the recorded note back
  - Expected: the note names each guard, the break that would be needed, and why the test cannot construct it.

**Task completion evidence:** six recorded break-restore cycles each seen failing its named test (with the two cleanliness checks recorded as one layered family), plus the three guards recorded with their unbreakable-at-stage-level reasoning.

### Task 8: The completion gate, the commits, and the step-7 rebase

**Depends on:** Task 7

**Files:**
- Modify: `.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md` — committed as the evidence record
- Modify: `step7` branch records — the proposal's resolution note, the verification-stage plan's note

**Steps:**

- [ ] **Step 1: the full gate**
  - Verify: `npm ci && npm run typecheck && npm test && npm run check:docs`
  - Expected: all four exit 0 from a clean install, every automated test on fixture executors, and the check's historical path warnings unchanged from the master baseline.

- [ ] **Step 2: commit on master**
  - Change: two commits. First `Plan step-6 trust-boundary correction`: the committed diagnosis record (`.claude/sessions/2026-08-31-debug-implementer-mutates-worktree.md`) plus `docs/features/step6-trust-boundary/plan.md` and `tasks.md`. Second `Implement step-6 trust-boundary correction`: `src/`, `test/`, `ARCHITECTURE.md`, `docs/hazards.md`. Commit messages follow the repo's existing pattern (compare `32a714e`).
  - Verify: `git log --oneline master -3`
  - Expected: both commits present, tree clean.

- [ ] **Step 3: rebase step7**
  - Change: `git rebase master step7`. The two step-7 commits (`3be15fd`, `a864483`) sit directly on `d82b894`, so the replay is expected to be clean; if a conflict appears, resolve in favor of the corrected master where the correction supersedes (the executor, prompts, and implementation-stage changes) and in favor of step7 for the verification-stage records.
  - Verify: `git log --oneline step7 -3` and `git diff master step7 --stat`
  - Expected: step7's own commits replayed on the corrected master, the diff showing only the verification stage and its records.

- [ ] **Step 4: resolve the step-7 records without rewriting history**
  - Change: `docs/proposals/implementer-writes-files-it-also-proposes.md` gains a dated **Resolution** section: the diagnosis confirmed the failure as a step-6 trust-boundary defect, the correction landed (read-only invocation, cleanliness gate, literal paths, link fail-closed, frozen binding — pointing at this plan), the prompt sentence from the proposal's first option is included as UX, and the gate-tolerance option remains rejected. `docs/features/verification-stage/plan.md`'s implementation note gains a dated entry: the upstream block is resolved; Task 12 now runs against the corrected executor (completed in Task 9).
  - Verify: `npm run check:docs`
  - Expected: exit 0; the historical path warnings are unchanged from the master baseline.

**Task completion evidence:** the full gate is green from a clean checkout, the correction is committed on master, step7 is rebased, and its records carry resolution notes without rewriting what they recorded.

### Task 9: The step-7 Task 12 smoke and the learnings

**Depends on:** Task 8

**Files:**
- Validate: scratch repositories outside the working tree
- Modify: `step7:docs/features/verification-stage/plan.md` — Task 12 checked off, status to Implemented
- Modify: `.claude/sessions/project-learnings.md` — a new entry

**Steps:**

- [ ] **Step 1: the tool-inventory probe, then the passing run**
  - Change: **first, the probe** — in the scratch repository, run the exact `CLAUDE_CODE.command` array plus `--model claude-sonnet-5` with a probe prompt on stdin asking the model to enumerate the tools available to it in this session. This is a direct invocation (the same way the smoke drives the harness), not a governed dispatch — no `agent_run` row is owed for a probe. Assert the response names exactly `Read`, `Glob`, and `Grep` and nothing that can write. Any deviation is a blocking finding: record it and stop before the chain's spend — a silent-ignore failure in the CLI's tool-name validation would otherwise defeat the read-only guarantee without failing a one-sample smoke.
  - Change: **then the passing run** — in the same fresh scratch git repository outside the working tree (the step-7 Task 12 Step 1 pattern: committed `governed.yaml` with cheap real commands — `["node", "--version"]` and `["npm", "--version"]`, npm deliberately for hazard 8's shim path — and a throwaway Ed25519 keypair via `node scripts/sign-approval.mjs keygen`), drive `migrate`, `new-run --model claude-sonnet-5`, `spec`, `approval-request`, sign, `approve`, `plan`, `implement`, then `verify`. Record: the model requested and effective, the cost from the envelopes, whether the implementer returned a valid patch set without writing, whether the gate passed and committed, and the verification result.
  - Verify: `bw implement --run <id>` then `bw verify --run <id>` in the scratch repository
  - Expected: the probe names exactly the three read tools; then a passed implementation stage (the read-only invocation working for real), then a passed verification stage with evidence files. A block is an acceptable recorded outcome if it names a cause worth fixing — do not retry to green (hazard 7 and the diagnosis's one-sample lesson).
  - Budget: roughly the recorded full-chain cost ($0.5021 through seven dispatches) plus verification, plus the probe (~$0.02-0.05); expect $0.6-0.95 for the run. The verification stage's own cost is bounded by its configured commands (cheap `node --version` invocations), not additional dispatches.

- [ ] **Step 2: the blocking run and the canary**
  - Change: a second fresh scratch repository through the same sequence, with one configured command genuinely failing (e.g. `["node", "-e", "process.exit(3)"]` — a failure in the scratch repo's own `governed.yaml`, never in the system's code), and a canary variable set in the parent shell with a command that prints its environment.
  - Verify: `bw verify --run <id>` exits 1 naming the failing command; the evidence file from the env-printing command lacks the canary
  - Expected: the stage is `blocked`, the run is `blocked`, the evidence holds the real failure output, the worktree survives, and the canary is absent from the retained environment dump.
  - Budget: $0.6-0.9.

- [ ] **Step 3: the step-7 record**
  - Change: `docs/features/verification-stage/plan.md` — Task 12's four steps checked, the implementation note gains the dated evidence (run ids, costs, durations, evidence paths), the status flips to `Implemented` (its gate names Task 12, now complete).
  - Verify: `npm run check:docs` in the working tree afterwards
  - Expected: unaffected by the smoke; the scratch repositories are outside the tree.

- [ ] **Step 4: the learnings**
  - Change: append an entry to `.claude/sessions/project-learnings.md` covering: the correction's landed decisions (the capability vocabulary, the canonical-JSON executor identity, the layered guards and which were proven by breaking), the smoke's real outcome and costs, and the honest boundary recorded in Task 7 (guards proven vs. layered backstops).
  - Verify: read the entry back
  - Expected: it names the smoke's real output and the landed decisions, not a summary of intent.

**Task completion evidence:** one passing and one blocking verification stage against the real binary, the environment canary confirmed absent from real retained output, the step-7 plan's gate closed, and the session record carrying the outcome.

---

## Implementation note

To be written on completion, following the step-6 plan's precedent: the shipped summary, the deviations, and the smoke's real costs. The gate is Task 8's completion gate plus Task 9's recorded smoke.
