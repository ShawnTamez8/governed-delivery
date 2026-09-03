# Step 8 Delivery Check Implementation Plan

**Status:** Implemented

**Goal:** Implement `delivery_check` as the final deterministic stage. A new `bw deliver --run <id>` command proves that every declared artifact — an exact, committed file path the spec declared and the operator's signature bound — appears in the commits produced from the implementation patch base, then atomically passes or blocks the stage and sets the run to `completed` or `blocked`. No agent dispatch, model configuration, schema migration, PR creation, deferred stage, or second delivery surface is added.

**Source:** `ARCHITECTURE.md` sections 4 (the branch is the deliverable), 7 (repository contract, protected paths, branch and worktree isolation, retention including blocked runs), 12 (the signed scope is "the set of paths and artifacts the spec declares"; `delivery_check` before a run may complete; the anti-goal this stage exists to refuse), 15 (state, storage, and evidence; the retained delivery record), and 20 (the run-duration ceiling, enforced today by `verification-stage.ts:132-140` against `profile.policy.runDurationLimitSeconds`); `docs/hazards.md` entries 3, 4, 5, and 11; `docs/features/delivery-check/2026-09-02-plan-review.md` (this plan's review record, reconciled here); the shipped stages the handoff touches (`src/implementation-stage.ts`, `src/verification-stage.ts`); the spec pipeline the validation change touches (`src/spec-doc.ts`, `src/spec-stage.ts`, `src/approval-stage.ts`, `src/plan-stage.ts`, `src/scope.ts`, `src/prompts.ts`); `.claude/sessions/project-learnings.md`; and auto memory (invalid-frozen-profile refusal by name, discriminating configuration, break-it mechanics, the `npm test` working-repository leak, doc-check's historical-tier warning baseline).

**Assumptions:**

- The worktree head the implementation stage reads before its first apply equals the signed `starting_commit` the worktree was created from. Verified for today's single-dispatch flow: `implementation-stage.ts:293` creates the branch at `approval.starting_commit`, nothing else moves the branch, and the overlap refusal at `implementation-stage.ts:461-465` revalidates every patch against the same anchor. Task 2 records the empirical head anyway and cross-checks it against the signed commit, so the plan stays correct if a future change moves the branch between creation and apply.
- A declared artifact that names nothing in the starting tree is a future file the implementation is expected to create, and is accepted as such. Its intended type cannot be inferred deterministically, and refusing it would make every new-code run unplannable.
- The spec gate's tree check runs against the repository `HEAD` at validation time; the approval gate re-runs it against the starting commit it is about to bind. The run row does not persist a starting commit — only the approval row does (`ApprovalRow.starting_commit`) — so the authoritative directory check lives where the commit is frozen, and the spec gate's check is the early guard.

**Approach:** Four code changes plus documentation, in dependency order. (1) Declared artifacts become exact future file paths by rule: a shared validator refuses trailing slashes immediately and refuses, against a git tree, any declared path that already identifies a directory; nonexistent paths pass as files; every spec-authoring prompt requires concrete paths. (2) The implementation-to-verification handoff becomes one typed record: the implementation gate event carries the pre-apply head and the final commit, the verification result record carries the patch base, and both sides parse the shared formatter — no compatibility branch for older shapes, refusal by name. (3) A pure delivery-coverage module compares the signed artifact list against `git diff --name-only` from the patch base to the verified commit. (4) `runDeliveryStage` performs every check before creating the stage, then finalizes the stage, the run transition, and the audit event in one `Store.transaction`, so a crash anywhere leaves `bw deliver` retryable. Task 5 wires the CLI and the paid driver; Task 6 updates the binding and reference documents and runs the evidence gate.

**Affected areas:** `src/spec-doc.ts` and its consumers (`spec-stage`, `approval-stage`, `plan-stage`) — declared-artifact validation; `src/prompts.ts` — spec-authoring prompts; `src/implementation-stage.ts` — the gate-event writer; `src/verification-stage.ts` — the handoff parse and result record; a new delivery module and the CLI command; `.claude/skills/run-buildworks/driver.mjs` — the paid sequence; `ARCHITECTURE.md`, `CLAUDE.md`, `README.md`, project learnings, and this plan's `tasks.md`.

**Known blockers:**

- `npm test` intermittently leaks empty `moved` commits and a stray `base.txt` onto the repository being run in (auto memory: test-suite-leaks-into-real-repo). Task 6 runs the full suite from a disposable clean checkout.
- Filesystem containment for verification commands is unbuilt (`docs/proposals/verification-containment.md`), so a frozen verification command may leave untracked files in the worktree. The delivery cleanliness check in Task 4 is defined around this (tracked state only); the untracked-leftover integration fixture proves the definition.
- `completed` has never been set by any shipped code; delivery is the first writer of the terminal value. `run.status` already admits it (`001_init.sql:7-9`) and `requireRunInProgress` (`store.ts:836-841`, `cli.ts:290`, `cli.ts:349`) already refuses work against blocked or completed runs.
- doc-check currently reports 0 errors and 36 warnings, all historical-tier and pre-existing. The evidence gate in Task 6 introduces no new warnings.

**Blast radius:**

- Declared-artifact validation is consumed in four places today: `spec-stage.ts:349-350` (spec gate), `approval-stage.ts:106-107` and `154` (approval recomputation and binding), `plan-stage.ts:459-460` (revalidation of the approved spec at the plan gate), and `spec-doc.ts` itself (parse, shared by all three). Tightening the validator reaches all four: a spec that declares a directory refuses at the first gate that runs after the change, by name, with no compatibility branch — consistent with the nothing-has-shipped rule and with `loadVerifiedProfile`'s refusal-by-name precedent.
- The gate-event summary is read by `verification-stage.ts:147-164` through an anchored `/^head=([0-9a-f]{40}|[0-9a-f]{64})$/` pattern. Task 2 changes the summary shape, so the verification parse moves to the shared parser in the same change; a run that reaches verification between the two halves of the change refuses by name (no such run can exist outside scratch targets).
- `computeScope` output is signed (`approval-stage.ts:250`) and echoed by `scripts/sign-approval.mjs` for display only. Task 3 does not change what is signed — the signed artifact list is exactly what delivery compares — so existing signatures remain semantically valid under the new matching rule. Nothing has shipped; no real signature must survive the change.
- The audit chain (`verify-audit`) consumes audit rows by hash; Task 4 appends new events with the same chain mechanics and changes no existing event.

**Verification:** `npm test`, `npm run typecheck`, `npm run check:docs` (0 errors, the 36 pre-existing historical warnings, no new ones), and the run-buildworks driver: `smoke` stays green and the paid sequence reaches `delivery_check=passed` with `run=completed` under explicit spend authorization. Task-level verification commands appear in each task; Task 6 is the evidence gate.

**Hazards considered:** 3 (the only control the pre-fix plan put on artifact declarations was a prompt clarification; Task 1 makes it a validator rule, and every constrained field the prompts state is pinned by the same scan), 4 (Tasks 1, 2, and 4 each name guards whose fixtures would agree with a wrong implementation unless broken on purpose; the break-it entries below are load-bearing, and the review's own mechanism claim about the diff range was corrected in Task 2), 5 (the stage is the designed tripwire for completion without delivery; the directory refusal in Task 1 and the cleanliness definition in Task 4 are what stop the tripwire from firing on specs and trees that delivered), 11 (Task 5's driver change is what makes `completed` reachable by the default paid workflow). Entries 1, 2, 6, 7, 8, 9, 10, 12, 13, 14, 15, and 16 do not bear: the stage parses no model output into a new shape (1), retains result records and evidence on both outcomes (2), adds no promise a later stage must keep (6), adds no retry loop (7), spawns nothing new and reuses the git helper verification already uses (8, 9), matches nothing against model output (10), freezes no new configuration (12), mints no obligation (13), claims no independence (14), declares no subprocess sandbox (15), and no finding below targets an artifact this plan does not change (16).

---

## Operator decisions this reconciliation implements

These were settled during reconciliation of `2026-09-02-plan-review.md` and are binding on the tasks below.

- **Declared artifacts are exact file paths, by rule, not by prompt preference.** A declared path ending in a slash refuses immediately. A declared path that resolves to a directory in a git tree refuses by name — the spec gate checks against the repository `HEAD`, the approval gate against the starting commit it is about to bind. A declared path that names nothing in the tree is accepted as a future file the implementation must create. Directory-prefix containment stays a patch-authorization rule and never counts as delivery. Every spec-authoring prompt (author and critique) requires concrete, exact, repo-relative file paths. `ARCHITECTURE.md` section 12 is amended to state exact normalized matching, replacing the prefix-tolerant "appear in the changed paths" wording.
- **The plan carries a full task decomposition.** Task 1 and Task 4 land the two guards the review marked invisible to the original plan's gates, and `tasks.md` mirrors the tasks below one checkbox each.
- **`delivery_check` finalizes in one transaction, after all checks.** `runDeliveryStage` performs every profile, handoff, git, and coverage check before creating the stage, writes the deterministic delivery record inside the final operation (an orphaned file left by a rollback is safely overwritten on retry), then in one outer `Store.transaction` re-reads the run and stage chain, requires the run still `in_progress` with no existing `delivery_check`, inserts and completes the stage, transitions the run to `completed` or `blocked`, and appends the corresponding audit event. Any throw rolls back every database write, leaving `bw deliver` retryable.

## Architecture amendments this plan makes

- **Section 12, `delivery_check`:** the matching rule is exact normalized equality between a declared artifact and a committed changed path. The sentence "every artifact the spec declared must appear in the changed paths of an applied patch" is replaced with wording that states the equality and names the normalization (separator and leading-`./` normalization, case-sensitive comparison). The amendment records what the old wording allowed (a path merely contained in the changed set, which a directory declaration could satisfy) and what the new one refuses.
- **Section 15:** the retained delivery record — `.governance/delivery/<run-id>/result.json`, its human-readable companion, and the stage `output_ref` pointing at it — joins the storage layout.

---

### Task 1: Declared artifacts become exact file paths

**Depends on:** None

**Files:**

- Modify: `src/spec-doc.ts` — the declared-artifact validation
- Modify: `src/spec-stage.ts`, `src/approval-stage.ts` — the two tree-check call sites
- Modify: `src/prompts.ts` — every spec-authoring prompt
- Validate: `test/` — spec validator and gate tests

**Steps:**

- [ ] **Step 1: refuse trailing slashes in the shared validator**
  - Change: after the repo-relative check in `spec-doc.ts`, refuse any declared artifact whose normalized form ends in `/` or `\`, with a reason naming the path and the rule ("declared artifacts are exact file paths").
  - Verify: unit test — a declaration spelled with a trailing slash (`scripts/`, or a file path with a trailing separator) refuses; a slash-free nonexistent path passes.
  - Expected: named refusal; no other validation changes behavior.

- [ ] **Step 2: refuse paths that identify a directory in a git tree**
  - Change: add a tree check to the validator's caller side — `isDirectoryInTree(commit, path)` over `git ls-tree` (or equivalent) — refusing a declared path that names a tree entry (directory) in the given commit. The spec stage passes the repository `HEAD`; the approval gate passes the starting commit it is about to bind. Nonexistent paths and existing blob (file) entries pass.
  - Verify: unit tests — a declared existing directory (`src/` against a commit that has it) refuses by name; an existing file path passes; a nonexistent path passes as a future file. Regression: a directory introduced during a specification revision round refuses at the next gate that runs.
  - Expected: named refusal at the first gate after the change; the approval gate remains the authoritative check because the starting commit is frozen there.

- [ ] **Step 3: require exact paths in every spec-authoring prompt**
  - Change: `src/prompts.ts` — the spec author prompt and the critique-loop prompts state that every line in `## Declared artifacts` is one concrete, exact, repo-relative file path; directory scopes and globs are refused by the validator and never count as delivery.
  - Verify: the prompt scan test that pins constrained-field wording covers the new sentence.
  - Expected: the constraint is stated wherever the field is requested (hazard 3).

- [ ] **Step 4: break and restore the guard**
  - Change: temporarily remove the trailing-slash refusal, then the directory refusal, and confirm the named tests fail; restore.
  - Verify: one break-it cycle per guard, each in its own tool call.
  - Expected: each guard's test fails when the guard is removed and passes when restored.

**Task completion evidence:** validator and gate tests green, including the directory, trailing-slash, revision-introduced-directory, and `scripts/`-fails-early regressions; typecheck clean; break-and-restore cycles recorded in the implementation note.

### Task 2: One typed handoff contract with a recorded patch base

**Depends on:** Task 1

**Files:**

- Modify: `src/implementation-stage.ts` — the gate-event writer (the `head=` summary around lines 418-470)
- Modify: `src/verification-stage.ts` — the handoff parse (`147-164`) and the result record (`290-325`)
- Create: a shared handoff formatter/parser module (both stages import it)
- Validate: `test/` — handoff and result-record tests

**Steps:**

- [ ] **Step 1: record the pre-apply head and the final commit in one typed gate event**
  - Change: the implementation stage records the worktree head it read before its first apply — the commit the implementer's patches bind to — alongside the final commit, through a shared typed formatter that renders the audit summary and parses it back. The formatter validates both values as 40- or 64-hex commits.
  - Verify: unit tests — malformed summaries refuse by name; a summary missing the base refuses by name.
  - Expected: the summary carries both commits; a shape without the base is refused, never defaulted (the `loadVerifiedProfile` refusal-by-name precedent).

- [ ] **Step 2: cross-check the recorded base against the signed starting commit**
  - Change: the delivery stage (Task 4) receives the base; verification (Step 3) records it. The implementation stage asserts the pre-apply head equals `approval.starting_commit` (the branch it created the worktree at, `implementation-stage.ts:293`) and refuses by name when it does not.
  - Verify: unit test — a base differing from the signed starting commit refuses.
  - Expected: the diff range is anchored by a value both the audit trail and the signature bind.

- [ ] **Step 3: move the verification parse to the shared parser and add the base to the result record**
  - Change: `verification-stage.ts:157`'s anchored `/^head=...$/` parse is replaced by the shared parser in the same change that changes the summary shape; the verification result record gains the patch base and validates strictly; a record without the field refuses by name.
  - Verify: unit tests — a legacy `head=`-only summary refuses with a named reason; the parse migration is exercised by a fixture written in the new shape.
  - Expected: no post-change run can reach verification and fail on the old pattern; the format change and its consumer are one atomic change (review high-risk area 2).

- [ ] **Step 4: break and restore**
  - Change: record the wrong base in the gate event and confirm a named delivery-side test fails; then leave the verification parse on the old pattern against a new-shape event and confirm the named refusal fires; restore both.
  - Verify: one break-it cycle per guard, each in its own tool call.
  - Expected: each guard's test fails when broken and passes when restored.

**Task completion evidence:** handoff tests green (malformed fields, mismatched commits, pass/block consistency), verification still refuses a missing or moved head by name, typecheck clean, break-and-restore cycles recorded.

### Task 3: The pure delivery-coverage module

**Depends on:** Task 2

**Files:**

- Create: a coverage module (normalization, comparison, set derivation) with no store or git access
- Validate: `test/` — unit tests

**Steps:**

- [ ] **Step 1: normalize and compare exactly**
  - Change: normalize separators and a leading `./`, deduplicate, sort, and compare case-sensitively. A declared artifact is delivered only when it exactly equals a changed path; a directory-prefix containment result never satisfies delivery.
  - Verify: unit tests — exact matches, slash normalization, duplicates, extra paths, case mismatches, missing files, and the refusal of directory-prefix substitution.
  - Expected: the module returns the declared, changed, delivered, and missing sets for evidence and diagnostics.

- [ ] **Step 2: state the diff-range invariants beside the module**
  - Change: a comment on the range derivation records why net `name-only` over `base..HEAD` equals the union of applied patch changes: one anchor recorded before any apply (Task 2), patches validated against it before any apply, and the apply-time overlap refusal (`implementation-stage.ts:461-465` and architecture section 7) preventing a later patch from reverting an earlier one's path.
  - Verify: review the comment against the invariants in the implementation note.
  - Expected: a future multi-commit apply cannot silently make a reverted path invisible to the net diff without tripping the stated invariant.

**Task completion evidence:** coverage unit tests green; the module is pure (no store, no git) and its sets feed Task 4's record.

### Task 4: `runDeliveryStage` — check everything, then finalize in one transaction

**Depends on:** Task 3

**Files:**

- Create: the delivery stage module (`runDeliveryStage(store, { runId, rootDir })`)
- Validate: `test/` — integration tests against real temporary git repositories

**Steps:**

- [ ] **Step 1: perform every check before creating the stage**
  - Change: refuse by name, before any mutation, when: the run does not exist or is not `in_progress`; a `delivery_check` stage already exists; the chain does not end in a passed `verification` stage with a valid handoff record; the frozen profile does not load; the run has exceeded `profile.policy.runDurationLimitSeconds` (the enforcement verification already performs at `verification-stage.ts:132-140`); the approval record's signed scope does not strictly re-parse as the normalized declared-artifact list ("invalid approval scope" — a directory entry cannot reach this stage because Task 1 refuses it at the gates, and an unreadable record refuses here); the worktree is missing; the worktree head is not the verified commit; the worktree has tracked-path differences against the verified commit; or the recorded patch base disagrees with the signed starting commit or is not an ancestor of the verified commit.
  - Verify: integration tests — each refusal by its exact name; a duplicate `bw deliver` invocation refuses; the expired-run-duration case refuses.
  - Expected: named refusals, exit 1, no stage row, no state change — `bw deliver` is re-runnable after every refusal.

- [ ] **Step 2: define clean as tracked state**
  - Change: the cleanliness check compares `HEAD` against the verified commit and the tracked working tree against `HEAD`. Untracked files are excluded and the module comment says why: the branch is the deliverable (architecture section 4), untracked files cannot enter it, and verification commands may legitimately leave them because containment is unbuilt.
  - Verify: integration fixture — a frozen command leaves an untracked file during verification; delivery still passes. Break-it fixture — a tracked modification after verification refuses.
  - Expected: untracked leftovers never block a delivered run; tracked tampering always does.

- [ ] **Step 3: derive the changed paths from git**
  - Change: re-read the worktree with NUL-delimited `git diff --name-only` from the recorded patch base to the verified commit; projection-only changes cannot enter the range because the base is the post-projection commit the implementer was handed.
  - Verify: integration fixture — a commit that changes only projection paths between the base and the verified commit contributes nothing deliverable.
  - Expected: the changed set is exactly the applied patch paths.

- [ ] **Step 4: write the deterministic record, then finalize in one transaction**
  - Change: write `.governance/delivery/<run-id>/result.json` (declared, changed, delivered, missing sets) and a human-readable companion `report.md` beside it; then one outer `Store.transaction` re-reads the run and stage chain, requires the run still `in_progress` with no `delivery_check` stage, inserts and completes the stage — `passed` with the run transitioned to `completed`, or `blocked` with the run transitioned to `blocked` — and appends the hash-chained audit event naming the commits and the delivered or missing paths. The stage's `output_ref` is the `result.json` path. Any throw rolls back every database write; a result file orphaned by a rollback is deterministic and safely overwritten on retry.
  - Verify: integration tests — success passes the stage and completes the run; one artifact missing blocks the stage and the run with the exact missing path; the audit events and result records agree with database state; a forced rollback (an injected failure after the record write) leaves no stage row and a re-run of `bw deliver` succeeds.
  - Expected: atomic finalization; retryable after any crash; blocked and completed runs keep their branch, worktree, verification evidence, and delivery evidence.

**Task completion evidence:** integration tests green over real temporary git repositories (all declared paths present; one missing; projection-only changes; moved `HEAD`; dirty tracked tree; untracked leftovers; unrelated patch base; malformed handoff; invalid approval scope; duplicate invocation; wrong prior stage; expired run duration; missing worktree; completed-run transition; no `agent_run` or model resolution occurs; records agree with the database), typecheck clean.

### Task 5: The `deliver` command and the paid driver

**Depends on:** Task 4

**Files:**

- Modify: `src/cli.ts` — the command surface and usage text
- Modify: `.claude/skills/run-buildworks/driver.mjs` — the paid sequence
- Validate: `test/` — CLI tests; the driver's smoke

**Steps:**

- [ ] **Step 1: add `bw deliver --run <id>`**
  - Change: one command on the existing surface (hard rule 2), with no `--model`. Success prints only the delivery result reference; a refusal prints its name and exits 1; usage errors exit 2. `stage-complete` keeps its low-level role and does not implement terminal delivery semantics.
  - Verify: CLI tests — usage, missing `--run`, unknown run, success output, blocking output, refusal of work against blocked or completed runs; the driver `smoke` stays green.
  - Expected: the command is the single entry point to the stage, and terminal states refuse work from the low-level commands too (`requireRunInProgress` at `cli.ts:290` and `cli.ts:349` already covers them; the completed-run case is new and tested).

- [ ] **Step 2: extend the paid sequence**
  - Change: the driver invokes `deliver` after `verify` and reports `delivery_check=passed` with `run=completed`; the summary keeps reporting per-dispatch cost.
  - Verify: run the paid sequence under explicit spend authorization against a scratch target (Task 6 gate).
  - Expected: all eight stages pass, the run is `completed`, the audit chain validates, every signed artifact is in the delivery record.

**Task completion evidence:** CLI tests green; driver smoke green; paid-chain evidence retained under `.governance`-side records with the run id and cost.

### Task 6: Documentation, break-it sweep, and the evidence gate

**Depends on:** Tasks 1-5

**Files:**

- Modify: `ARCHITECTURE.md` — section 12 (the matching-rule amendment) and section 15 (the retained delivery record)
- Modify: `CLAUDE.md`, `README.md`, `.claude/skills/run-buildworks/SKILL.md`, `.claude/sessions/project-learnings.md` — `bw deliver`, steps 1-8 implemented, step 9 as the completed-run milestone
- Validate: `scripts/doc-check.mjs` output, the full test suite, the driver

**Steps:**

- [ ] **Step 1: land the architecture amendments**
  - Change: amend section 12's `delivery_check` wording to exact normalized equality (the amendment records what the old prefix-tolerant wording allowed and what the new one refuses) and add the retained delivery record to section 15's storage layout.
  - Verify: `npm run check:docs` and `npm run typecheck`.
  - Expected: 0 errors, the 36 pre-existing historical warnings, no new warnings.

- [ ] **Step 2: update the reference and continuity documents**
  - Change: `CLAUDE.md` (commands and the stage sequence), `README.md`, the run-buildworks skill (the paid chain now ends `completed`), and project learnings (this plan's decisions and state).
  - Verify: `npm run check:docs`.
  - Expected: every document agrees with the shipped surface; the learnings file carries the decisions under the `Current state` block.

- [ ] **Step 3: break-and-restore sweep and full verification from a disposable checkout**
  - Change: mutate each load-bearing guard to confirm its named test fails, then restore: the exact-match rule, the patch-base diffing, the handoff validation, the `HEAD` and tracked-cleanliness checks, the missing-artifact blocking, the completed-run transition, the trailing-slash and directory refusals, and the verification parse migration. Run `npm ci`, the full suite, typecheck, and doc-check from a disposable clean checkout because the suite can intermittently mutate its working repository.
  - Verify: one break-it cycle per guard, each in its own tool call, in a scratch mirror where possible.
  - Expected: every guard fails its named test when broken and passes when restored; the disposable run is green.

- [ ] **Step 4: advance the plan lifecycle and record the evidence**
  - Change: after the independent code review of the full diff passes and every finding is reconciled, mark this plan `Implemented` and check off `tasks.md`.
  - Verify: the review file records the disposition of every finding; doc-check stays at the 0/36 baseline.
  - Expected: the stop at step 9 is deliberate and documented; step 8 evidence — including the paid run's cost — lives with this feature's records.

**Task completion evidence:** amendments and updates merged, sweep recorded, disposable-checkout verification green, plan `Implemented`, `tasks.md` fully checked, and the completed-run evidence retained.

---

## Test and acceptance summary

The per-task verifications above are the acceptance plan: unit coverage for the handoff parsers, the result-record validator, and the coverage module (malformed fields, mismatched commits, pass/block consistency, exact matches, slash normalization, duplicates, extra paths, case mismatches, missing files, and the refusal of directory-prefix substitution); integration coverage over real temporary git repositories for every named refusal and both terminal transitions; CLI coverage for the command surface; and the spend-authorized paid run as the end-to-end gate. `npm test`, `npm run typecheck`, and `npm run check:docs` are the standing checks; the run-buildworks driver `smoke` stays green throughout.

---

## Implementation note (2026-09-03)

All six tasks shipped on `master` as seven commits: `1890503` (Task 1),
`02f799b` (Task 2), `849571c` (Task 3), `f68ebbb` (Task 4), `98d87b3`
(Task 5), `695c16f` (Task 6 amendments and sweep), and `36a726d` (the
remediation of the independent code review, `configured_standalone`,
recorded in `2026-09-03-step8-code-review.md` beside this plan). Final
state: full suite 682 tests (681 pass, one pre-existing skip), typecheck
clean, driver smoke 12/12, doc-check 0 errors / 36 warnings (the baseline).

**Deviations from the plan's wording, all corrections of the record rather
than scope changes:**

- **The pre-apply base is the starting commit's child, never the starting
  commit itself.** Task 2's Step 2 and Task 4's Step 1 wording cross-checked
  the recorded base against `approval.starting_commit` by equality, but the
  implementation stage commits its own projections (spec and plan) onto the
  run branch before dispatch, so the empirical pre-apply head always sits one
  commit past the starting commit. Implementation enforces ancestry
  continuity — and, after the code review, strict descent (finding F2): a
  base equal to the starting commit refuses, because equality would widen the
  certified range backwards over the projections commit.
- **Run-document declarations refuse at the gates** (finding F6): a spec
  declaring `docs/features/<slug>/design.md`, `spec.md`, or `plan.md` would
  pass every tree rule and still block terminally at delivery, because those
  documents are written by the system itself before the patch range. The
  names refuse at spec writes and at the approval binding; the prompts state
  the rule.
- **Delivery certifies existence at the verified commit, not only presence
  in the changed listing** (finding F1): an in-range deletion lists the path
  in `git diff --name-only` but must never count as delivered.

**Deferred items, stated rather than closed over:**

- **The paid end-to-end run has been executed — step 9's milestone is
  reached.** Run on 2026-09-03 under explicit spend authorization (`node
  .claude/skills/run-buildworks/driver.mjs paid --yes`, scratch target
  `%LOCALAPPDATA%\Temp\bw-run-skill\1788419068845\target`): 11 dispatches,
  `claude-sonnet-5` throughout, **$0.25019** total; all eight stages passed
  (`spec=passed spec_review=passed awaiting_approval=passed plan=passed
  plan_review=passed implementation=passed verification=passed
  delivery_check=passed`) and `run 1 (clamp): completed`; the delivery
  record's declared set matches the signed approval scope with zero missing;
  `verify-audit` validates the chain including the `delivery.gate.pass`
  event. The first attempt on the same day spent $0.00 and blocked at the
  spec dispatch because the `claude` binary's OAuth session had expired —
  the failure was retained raw, audited by name, and the run blocked, which
  is the designed behaviour for an invocation that cannot authenticate. One
  driver-assertion defect surfaced on the successful run (its expected-output
  regex could not match the summary its own step prints; the comparison
  itself passed) and was corrected; the step was replayed green against the
  retained run without respending. Step 9's stop — one complete run with
  queryable cost — has now been reached; the deliberate stop says do not
  build past it without an explicit decision.
- **The duration ceiling at cost-free stages** (finding F3's architectural
  half) and **the three stage-local git helpers** (finding F12's extraction,
  now permitted by hard rule 4) are recorded with triggers in the review
  file.

