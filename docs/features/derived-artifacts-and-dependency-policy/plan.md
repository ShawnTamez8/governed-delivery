# Derived Artifacts And Dependency Policy Implementation Plan

**Status:** Implemented

**Goal:** A run can add npm dependencies without a model ever authoring a lockfile. The operator declares in `governed.yaml` which files BuildWorks regenerates and how, and BuildWorks regenerates and commits them after every patch commit. Any package the specification adds is approved or denied by the operator before the plan is written, and the implementation is refused if it adds a package nobody approved.

**Source:**
- `docs/proposals/sandboxed-delivery-rework.md`, changes 2 ("Derived artifacts belong to the harness") and 10 ("Dependency policy as code"). Both are ranked in that proposal's first authorization.
- Operator request 2026-10-18: "write the plan for changes 9, 2 and 10". Change 9 (whole-run replay) is not in this plan. Grounding showed that its premise in the proposal does not hold, and the reasons are recorded under "Change 9" below for an operator decision.
- Crew-chatter run 4, 2026-10-18, $1.7754115, stopped at the `spec_decision` pause. Its reviewed specification chose TipTap 3 for `frontend/package.json` and said "`package-lock.json` is regenerated with `npm install` at the repository root so that `npm ci` installs exactly these packages". The implementer runs with Read, Glob and Grep only (`src/executor.ts`), so it cannot run `npm install`.

**Hazards considered:**
- 2: run 4's reviewed specification exists only as an untracked file in the target and under its `.governance/raw/4`. Task 1 copies it, and the baseline manifests it changes, into the repository before anything depends on them.
- 3: every new constraint is stated wherever its subject is written. The derived-file rule goes into `verificationCommandsBlock`, which nine author prompts render, and explicitly into `buildCodeReviewRemediationPrompt`, which renders no verification block. The dependencies section schema goes into all four spec-schema statements. The implementation rule goes into all three patch prompts. Each is one source line pinned in `CONSTRAINT_STRINGS`.
- 4: the expected package names come from run 4's recorded specification, and the base manifest is crew-chatter's committed `frontend/package.json` at `8f539e5`. The head manifest adds those recorded names to the recorded base under npm's own `dependencies` key, which is the schema that receives it. No regeneration test runs npm. They use a fixture command whose output the test defines, and they test the mechanism, not npm.
- 5: delivery's exact-match check is unchanged. A derived file is never declared, so delivery never requires or refuses it.
- 6: a lockfile declared as an artifact, under a configuration that regenerates it, is a promise the implementer cannot keep. It is refused at the spec write, the earliest deterministic point.
- 12: the derived declaration is read from `governed.yaml` at the starting commit, frozen into the profile, and covered by the approval signature, so every stage sees the same list.
- 13: run 4's author chose a dependency the design never named. The new section turns that choice into an operator question rather than a fact inside the specification.
- 15: regeneration is a system command run by the stage, not a model action. The worktree must hold nothing but the derived paths afterwards, or the run blocks.
- 18: a regenerated lockfile can be thousands of lines. It is excluded from the diffs and changed-path lists given to the self-review and code reviewers, so it cannot push a review prompt toward the 1 MiB ceiling.
- 21: the implementer, self-review and remediation prompts state both new gates: which files are regenerated, and that an unapproved package addition is refused.
- 22: regeneration reuses the verification cleanup of ignored output and the clean-tree check that follows it.
- 24: this closes the residual hazard 24 records. A lockfile that changes only when a dependency is added is no longer declared at all.
- 1, 7, 8, 9, 10, 11, 14, 16, 17, 19, 20 and 23: none. No parser for model output, retry, executable resolution, hook, model alias, default install, independence label, remediation input, normative-node accounting, timeout, phase split or fix input changes. The new spec section is outside the normative-node set, and Task 8 makes the fold refuse to change it.

**Assumptions:**
- `npm install --package-lock-only --ignore-scripts` updates `package-lock.json` (including workspace entries) without creating `node_modules` and without running lifecycle scripts. This comes from npm's documentation, not a measurement here. The live run in Task 11 is the first measurement, and the plan does not depend on it producing no ignored output, because Task 5 runs the cleanup anyway.
- Regenerating after every patch commit, not only after a commit that touched a manifest, is acceptable. It costs one local command per phase, and it keeps ecosystem knowledge out of the core: the system never decides which files count as manifests.
- A package is approved by name and manifest, not by version range. A range check would refuse `^3.0.0` where the specification said `^3`, which is not a policy violation.
- A denied dependency question ends the run `blocked`. The repair is a design that states what to use instead, and a fresh run. This matches section 12's rule that a mistaken answer is repaired by a fresh run, and it avoids asking the fold to rewrite a specification around a refusal.
- The policy covers additions to `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies` in any `package.json` the run changes. Removals and version changes of existing entries are not additions and are not checked.

**Approach:**
- `governed.yaml` gains an optional `derived:` block after `verify:`. Each entry has a name, a repository-relative path, and a command, in a fixed three-line shape, parsed by the existing hand-written parser. `VerificationConfig` gains `derived: DerivedArtifact[]`, which is empty when the block is absent.
- `writeSpecDoc` refuses a declared artifact equal to a derived path, and so does the approval re-check. `verificationCommandsBlock` and the remediation prompt list the derived files and say they are never declared, proposed or edited. The run command's consent preview lists them beside the verification commands.
- The guided `static-web` starter's `governed.yaml` declares its `package-lock.json` as a derived artifact.
- A new module, `src/derived-artifacts.ts`, holds `regenerateDerivedArtifacts`. It runs each derived command in the worktree through `runVerifyCommand`, requires that only derived paths changed, commits them with the system identity, then removes ignored output and audits the commit. The implementation stage calls it after every phase and after the self-review. Code-review remediation calls it after its patch and before its verification, and records the regenerated head as the remediation's resulting commit.
- The self-review and code review diff and list changed paths with every derived path excluded.
- `validateSpecDoc` accepts an optional `## Dependencies added` section, one `- <manifest>: <package>` per line. The manifest must be a declared artifact named `package.json`.
- When the reviewed specification lists any package, the spec stage records a system question beside the design split's, with approve or deny only. Deny ends the run blocked, the question is never folded, and a fold may not change the list.
- A new module, `src/dependency-policy.ts`, compares every changed `package.json` between the implementation's handoff base and the current head with the signed specification's list. The implementation stage checks after every phase and after the self-review; remediation checks after its patch. An unlisted addition blocks the run.

**Affected areas:**
- Configuration and profile: `src/governed-config.ts`, `src/profile.ts` (`invalidProfileReason`), `src/project-bootstrap.ts` (the starter's `governed.yaml`).
- Specification: `src/spec-doc.ts`, `src/spec-stage.ts`, `src/spec-decision-stage.ts`, `src/approval-stage.ts`, `src/prompts.ts`.
- Implementation and review: `src/implementation-stage.ts`, `src/code-review-stage.ts`, `src/commit-verification.ts` (export the cleanup), `src/paths.ts`, `src/delivery-coverage.ts` (comment only).
- Operator surfaces: `src/operator-state.ts` (action reason, `configuration.derivedArtifacts`), `src/operator-output.ts` (consent preview), `src/dashboard/app.js` (configuration display), `src/guided-command.ts` (`decisionHandoff`).
- New modules: `src/derived-artifacts.ts`, `src/dependency-policy.ts`, a design-split-style record for the dependency question (in `src/dependency-policy.ts`).
- Tests and fixtures: `test/governed-config.test.ts`, `test/spec-doc.test.ts`, `test/spec-stage.test.ts`, `test/spec-decision-stage.test.ts`, `test/implementation-stage.test.ts`, `test/code-review-stage.test.ts`, `test/prompts.test.ts`, `test/profile.test.ts`, new `test/derived-artifacts.test.ts`, new `test/dependency-policy.test.ts`, new fixture command `test/fixtures/verify/write-derived.mjs`, new recorded fixture `test/fixtures/recorded/spec-crew-chatter-run-4-dependency-in-prose.json`, and the `VerificationConfig` literals listed under Blast radius.
- Documents: `ARCHITECTURE.md` sections 7, 8, 12 and 23; `docs/hazards.md` entry 24; `README.md` and `docs/runbooks/cli-operator.md` where they show `governed.yaml`; `.claude/sessions/project-learnings.md`.

**Known blockers:**
- Implementation and spend are not authorized by this plan. The step before Task 1 records the section 23 decision once the operator authorizes the build, and nothing is built before it.
- The profile shape changes (`verification.derived`). Under hard rule 3, every run frozen before this lands becomes unexecutable and must be replaced by a fresh run. Crew-chatter run 4 is the only paused run recorded, and it is already stopped.
- A specification that declares a derived path is refused at the write, and the run blocks at that dispatch. With run 4's author, that would be the draft, about $0.35. The prompt sentence is the mitigation, and a refusal here is cheaper than one at code review.
- Regeneration runs `npm` on the host with the network inherited. That is the same exposure `npm ci` already has in verification (`ARCHITECTURE.md` section 17); `--ignore-scripts` runs less third-party code than `npm ci`.
- The live test needs the operator to commit a `derived:` block to crew-chatter's `governed.yaml`, and to move run 4's untracked `docs/features/crew-chatter-accounts-notes/spec.md` aside before `new-run`. The paid run needs its own authorization.
- Whether live authors list dependencies in the new section is unmeasured until that run.

**Blast radius:**
- `parseGovernedConfig` and `loadGovernedConfigAtCommit` are called from `src/readiness.ts` (`checkIntakeRepository`), `src/project-bootstrap.ts` (the starter's validation), and `test/governed-config.test.ts`, from a repository search.
- The starter's generated `governed.yaml` gains the lockfile `derived:` block (operator decision, 2026-10-18). `scaffoldSlug` in `src/project-bootstrap.ts` compares a project's committed bytes exactly against `generatedFiles`, so a project bootstrapped before this change is no longer recognized as an unchanged starter. Under hard rule 3 that is accepted, not migrated. Guided mode then treats such a project as an existing repository, which intake still accepts.
- `VerificationConfig` is constructed or typed in `src/code-review.ts`, `src/governed-config.ts`, `src/profile.ts`, `src/prompts.ts`, `src/readiness.ts`, and in twelve test files plus `test/uniform-profile.ts`: `test/approval-stage.test.ts`, `test/code-review-stage.test.ts`, `test/code-review.test.ts`, `test/dashboard-server.test.ts`, `test/delivery-stage.test.ts`, `test/dispatch.test.ts`, `test/implementation-stage.test.ts`, `test/plan-stage.test.ts`, `test/profile.test.ts`, `test/prompts.test.ts`, `test/spec-decision-stage.test.ts`, `test/spec-stage.test.ts` (from `grep -rln "VerificationConfig\|verification: {"`). Forty-six `commands: [` literals in `test/` (from `grep -rn`) are the sites that may need `derived: []`. `npm run typecheck` names each one that does.
- `writeSpecDoc` is called at `src/spec-stage.ts` (the draft, self-critique and reconciliation writes) and `src/spec-decision-stage.ts` (the fold write). `validateSpecDoc` is also called by `src/approval-stage.ts`, `src/plan-stage.ts`, `src/code-review-reconcile.ts` and `src/operator-state.ts`. The new optional section changes none of their results for a specification without it.
- `verificationCommandsBlock` is rendered into every author prompt. With an empty `derived` list it renders exactly the bytes it renders today, so every existing prompt test and `CONSTRAINT_STRINGS` entry is unaffected.
- `applyProposedPatches` is unchanged. A model patch to a derived path is already refused as `outside the signed scope`, because no specification can declare one.
- The remediation record chain is parsed by `parsePassedCodeReviewRecord` in `src/code-review.ts`. It requires `verification.expectedCommit === remediation.resultingCommit` and that the next round reviews that commit. Task 6 keeps both by recording the regenerated head as `resultingCommit` and verifying that head.
- `readSplitRecord` is special-cased in `src/spec-decision-stage.ts` (`answerQuestion`, `runSpecDecisionStage`), `src/operator-state.ts` (action reason) and `src/guided-command.ts` (`decisionHandoff`), from a repository search. The dependency question needs the same three, and nothing else reads the split record. The dashboard's `questionCard` shows Modify for every question and relies on `answerQuestion` to refuse it, so it needs no change.
- `finding_report.agent_run_id` and `finding_decision.agent_run_id` are NOT NULL (`src/migrations/005_finding_report_decision.sql`). The dependency finding is attributed to the dispatch that wrote the reviewed specification, as disclosed open decisions are attributed to the self-critique dispatch. There is no schema or migration change.
- The `status --json` snapshot's `configuration` gains `derivedArtifacts`. Its readers are `src/cli.ts`, `src/operator-output.ts` and `src/dashboard/app.js`, with tests in `test/cli-operator.test.ts`, `test/operator-output.test.ts` and `test/operator-state.test.ts` (from `grep -rln verificationCommands`). A test that compares the whole snapshot needs the new key.
- No policy constant changes, so `policyHash` and `buildPolicy()` are unchanged.

**Verification:** each task names its focused `node --test` files. Then run `npm run typecheck`, `npm test` serially, `npm run check:docs`, and `node .claude/skills/run-buildworks/driver.mjs smoke`. Every new guard is proven by breaking it: copy the file first, then compare the restored bytes by SHA-256. Task 11 defines the paid live test, which needs separate authorization.

---

## Change 9 is not in this plan

The proposal says: "Every dispatch already records an `input_hash`. A replay executor returns the retained response for a matching hash". Grounding showed this holds only up to the first commit a run makes:

- `input_hash` is `sha256(prompt)` (`src/dispatch.ts`), and the prompt itself is not retained.
- Every system commit after the starting commit has a different SHA in each run. `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` are never set, and the commit messages carry the run ID. The implementer, self-review, code-review and remediation prompts embed those SHAs ("baseCommit must be exactly …"), and a recorded patch's `baseCommit` must equal the live branch head (`src/patch-application.ts`), so a recorded response cannot even be applied.
- Finding IDs are store-wide autoincrement values, and the reconcile, fold, remediation and reconciler prompts embed them.
- Changes 2 and 10 change the spec and implementation prompts themselves, so every dispatch after the first would miss the recorded hash.

Replay as written could therefore test the spec stage of an unchanged-prompt build, and not the changes it was ranked to validate. Making it work for whole runs needs a design decision, for example a replay that maps recorded commit SHAs and finding IDs to the replay's own and matches on a normalized prompt. That is the operator's to decide, separately.

## Tasks

- Before Task 1: record the operator's authorization. Add the section 23 entry to `ARCHITECTURE.md`, dated the day the operator authorizes the build. It says what this plan authorizes (changes 2 and 10 of the rework proposal, as this plan states them) and what it does not: change 1, change 9, prompt retention beyond what its own plan authorizes, and any paid run. `CLAUDE.md` requires the decision before building past the step-9 milestone, so no source change precedes it. Verify with `npm run check:docs`; expected exit 0.

- Task 1: copy the run-4 evidence into the repository.
  - Create `test/fixtures/recorded/spec-crew-chatter-run-4-dependency-in-prose.json` with the keys `provenance`, `spec`, `frontendPackageJson`, `backendPackageJson` and `governedYaml`. Extract with a scratch `.mjs` in the session scratchpad, never a Bash heredoc or `node -e`.
    - `spec` is `C:\Repositories\testing-repos\crew-chatter\docs\features\crew-chatter-accounts-notes\spec.md` exactly as run 4's reconciliation wrote it.
    - `frontendPackageJson`, `backendPackageJson` and `governedYaml` are `git -C C:\Repositories\testing-repos\crew-chatter show 8f539e5:<path>` for `frontend/package.json`, `backend/package.json` and `governed.yaml`.
  - `provenance` names:
    - the run (crew-chatter run 4, operator-authorized spec range, 2026-10-18), the target path and starting commit `8f539e5`, the pause (`awaiting_decision`, finding 63), and the run's recorded cost $1.7754115;
    - that the run was stopped at the decision pause by the operator;
    - the capture date;
    - the four package names the spec adds and the sentence that says so, quoted;
    - what was dropped: nothing from the spec; the manifests are whole files.
  - Verify with a scratch `.mjs` that imports `sha256Hex` and `normalizeText` from `src/canonical.ts`: `sha256Hex(normalizeText(spec))` equals the `specHash=` value in the summary of run 4's `spec.gate.pass` row in the `audit` table of `C:\Repositories\testing-repos\crew-chatter\.governance\state.db`, read read-only through `node:sqlite`. `status --json` does not carry that hash, because run 4 has no approval. Expected: equal. If they differ, stop: the file is not the reviewed specification.

- Task 2: parse the `derived:` block.
  - Change `src/governed-config.ts`:
    - Export `interface DerivedArtifact { name: string; path: string; command: string[] }`, and add `derived: DerivedArtifact[]` to `VerificationConfig`.
    - After the `verify:` entries, accept an optional line exactly `derived:` followed by one or more three-line entries in fixed order: `  - name: <name>`, `    path: <path>`, and `    command: [...]`. The verify loop ends at the first content line that is exactly `derived:`.
    - Reuse `NAME` and `TOKEN` and the existing command-line parsing (extract the bracket parsing into a private function both loops call, so the refusal texts stay identical).
    - New refusals, each naming the line:
      - `expected "    path: <repo-relative file path>", found …`;
      - `derived artifact <name> path must be a repo-relative file path with no whitespace, "..", leading "/", drive letter or trailing slash: <path>`;
      - `derived artifact <name> path is protected: <path>` when `touchesProtected([path], "")` from `src/scope.ts` is true;
      - `duplicate derived artifact name …` and `duplicate derived artifact path …`;
      - `the derived: block names no artifacts` for an empty block;
      - any content line after the derived entries.
    - Update the header comment's "accepted shape, in full" example to show the optional block.
    - Return `derived: []` when the block is absent.
  - Tests in `test/governed-config.test.ts`:
    - crew-chatter's recorded `governedYaml` from the Task 1 fixture parses to its four commands and `derived: []`;
    - the same text plus a block `derived:` / `  - name: lockfile` / `    path: package-lock.json` / `    command: ["npm", "install", "--package-lock-only", "--ignore-scripts"]` parses to one derived artifact with exactly that command;
    - one test per new refusal, asserting the full message and line number;
    - `derived:` before `verify:` is refused by the existing first-line rule.
  - Change `src/project-bootstrap.ts` `generatedFiles`: the `governed.yaml` entry appends `derived:\n  - name: lockfile\n    path: package-lock.json\n    command: ["npm", "install", "--package-lock-only", "--ignore-scripts"]\n` after its two `verify:` entries. `bootstrap()` already validates the file with `parseGovernedConfig`, and it still runs only the `verify:` commands before the baseline commit.
  - Test in `test/project-bootstrap.test.ts`: the generated `governed.yaml` parses to its two commands and that one derived artifact. Update any test that compares the starter's `governed.yaml` bytes.
  - Verify: `node --test test/governed-config.test.ts test/project-bootstrap.test.ts`. Expected: all pass.
  - Break-test: accept a path containing `..`. The traversal test must fail. Restore by SHA-256.

- Task 3: freeze, require and show the field.
  - Change `src/profile.ts` `invalidProfileReason`: after the existing `verification.commands` check, refuse when `!Array.isArray(verification.derived)` with `the frozen profile carries no verification.derived: it predates the field, and a run frozen without it cannot say which files the system regenerates`, following the `after` and `narrationCheck` pattern. `freezeProfile` is unchanged, because it already freezes the `VerificationConfig` it is handed.
  - Add `derived: []` to every `VerificationConfig` literal that `npm run typecheck` reports, in the files listed under Blast radius, and to `test/uniform-profile.ts`.
  - Show the frozen list to the operator before consent:
    - `src/operator-state.ts`: the snapshot's `configuration` gains `derivedArtifacts`, the frozen `verification.derived` (`[]` when none), beside `verificationCommands`.
    - `src/operator-output.ts`: after the `Frozen verification commands:` preview line, add `Frozen derived artifacts: ${JSON.stringify(snapshot.configuration.derivedArtifacts)}`.
    - `src/dashboard/app.js`: show it wherever `verificationCommands` is shown.
  - Tests:
    - `test/profile.test.ts`: a frozen profile whose `verification` lacks `derived` is refused with that message; one with `derived: []` loads.
    - `test/operator-state.test.ts` and `test/operator-output.test.ts`: the snapshot carries `derivedArtifacts`, and the preview prints the new line.
  - Verify: `npm run typecheck`, then `node --test test/profile.test.ts test/operator-state.test.ts test/operator-output.test.ts test/cli-operator.test.ts`. Expected: clean, all pass.

- Task 4: keep derived files out of the specification, and tell every author.
  - Change `src/spec-doc.ts` `writeSpecDoc`: add a fifth parameter `derivedPaths: readonly string[] = []`. After the run-documents refusal, refuse any declared artifact whose `normalizePath` equals a derived path's, with `declared artifact names a file the system regenerates (governed.yaml derived:): <paths>; the system writes it after every patch commit, so it is never declared`.
  - Pass `profile.verification.derived.map((d) => d.path)` at the three `writeSpecDoc` calls in `src/spec-stage.ts` and the fold call in `src/spec-decision-stage.ts`.
  - Change `src/approval-stage.ts`: beside `runDocumentRefusals`, refuse the same intersection with the same message, so an approval can never bind one.
  - Change `src/prompts.ts`:
    - Add a private `derivedArtifactsLines(verification)`. It returns `""` for an empty `verification.derived`. Otherwise it returns `After every implementation and remediation commit, the system regenerates these files itself by running their commands, and commits them:`, then one `- <path>: <command joined by spaces>` line per entry, then `Never declare, propose or edit these files: the system refuses a specification that declares one and a patch that changes one.` Each sentence is one source line.
    - `verificationCommandsBlock` appends a blank line and `derivedArtifactsLines(verification)` when it is non-empty. With an empty list the block's bytes are unchanged.
    - `buildCodeReviewRemediationPrompt` renders no verification block today, so it gains a final parameter `verification: VerificationConfig`. Its one caller in `src/code-review-stage.ts` passes `profile.verification`. When `derivedArtifactsLines` is non-empty, it is inserted after the line `When you fix a defect, look for the same defect in every other file of the approved scope and fix it there too.` and before `Approved scope:`, with a blank line on each side. With an empty list the remediation prompt's bytes are unchanged.
  - Tests:
    - `test/spec-doc.test.ts`: `writeSpecDoc` with run 4's recorded spec and `derivedPaths: ["package-lock.json"]` throws the new message naming `package-lock.json`; without `derivedPaths` it writes.
    - `test/approval-stage.test.ts`: an approval request over a spec declaring a derived path is refused with the new message.
    - `test/prompts.test.ts`: add both new sentences to `CONSTRAINT_STRINGS` (keep `CRITERION_QUALITY_RULE`'s slice indices correct, as the hazard-24 plan did). Assert that with one derived artifact every prompt that renders `verificationCommandsBlock` carries both sentences and the entry line after the commands list, and the remediation prompt carries them before `Approved scope:`. Assert that with none, every one of those prompts' bytes, the remediation prompt's included, equal today's.
  - Verify: `node --test test/spec-doc.test.ts test/approval-stage.test.ts test/prompts.test.ts test/harness-stream-fixtures.test.ts`. Expected: all pass.
  - Break-test: drop the `writeSpecDoc` intersection. The spec-doc test must fail. Restore by SHA-256.

- Task 5: the regeneration function.
  - Change `src/commit-verification.ts`: export the existing private `removeIgnoredOutput(worktreePath, evidenceDir)` unchanged.
  - Change `src/paths.ts`: add `derivedEvidenceDir(rootDir, runId, label)` returning `.governance/derived/<runId>/<label>` under the root, beside `codeReviewVerificationDir`.
  - Create `src/derived-artifacts.ts` exporting `regenerateDerivedArtifacts(input: { worktreePath; runId; derived: DerivedArtifact[]; expectedHead: string; label: string; evidenceDir: string; policy: { timeoutSeconds; maxBytes; retentionMaxBytes; envPassthrough }; audit(action, summary): void }): Promise<{ ok: true; head: string; regenerated: string[] } | { ok: false; reason: string }>`.
    - With `derived` empty, return `{ ok: true, head: expectedHead, regenerated: [] }` and run nothing.
    - Read HEAD with `git rev-parse HEAD` and refuse `the worktree head moved before regeneration: expected <expectedHead>, found <head>` when it differs. Then refuse a dirty tree with `checkWorktreeClean` from `src/patch-application.ts`. `checkCommitState` is not reused, because its `when` parameter admits only `"before verification" | "after command"` and its messages say so.
    - Run each entry's command with `runVerifyCommand({ name, command }, …)` in the worktree, with the same options `verifyCommit` passes it (`cwd`, `timeoutSeconds`, `maxBytes`, `retentionMaxBytes`, `envPassthrough`, and an evidence path of `<evidenceDir>/<name>.log`). A non-zero exit, timeout or overflow returns `derived artifact <name> could not be regenerated: <outcome>` and audits `derived.fail`.
    - Read `git status --porcelain -z --untracked-files=all`, which lists tracked and untracked changes but not ignored ones. Every entry must be a derived path. Otherwise return `the derived command(s) changed files that are not derived artifacts: <paths>` and audit `derived.refused`.
    - If a derived path changed, `git --literal-pathspecs add` the changed derived paths and commit with `-c user.name=${SYSTEM_NAME} -c user.email=buildworks@buildworks.invalid` and message `bw run <runId>: regenerate derived artifacts (<label>, base <first 8 of expectedHead>)`. Check that the committed set equals the changed set.
    - Only then run `removeIgnoredOutput`. It refuses any entry that is not ignored (`unexpected non-ignored entry …`), so it must run after the commit, when the tree holds nothing else. A failure returns its reason.
    - Check the tree is clean with `checkWorktreeClean`.
    - If nothing changed, audit `derived.unchanged` with `label=<label>; head=<expectedHead>; evidence=<evidenceDir>` and return the same head. Otherwise audit `derived.commit` with `label=<label>; base=<expectedHead>; head=<new head>; paths=<paths>; evidence=<evidenceDir>` and return the new head.
    - The doc comment states that this is a system write under section 7, not an agent patch, and that the scope gate does not apply because no agent proposed it.
  - Create `test/fixtures/verify/write-derived.mjs`: writes the file named by its first argument with content from its second, so a test controls whether the command changes anything. Add a mode that also writes a second, non-derived file, for the refusal, and a mode that also writes a file under a git-ignored directory, for the cleanup.
  - Create `test/derived-artifacts.test.ts`, using a temporary git repository the way `test/commit-verification.test.ts` builds one:
    - an empty `derived` list runs nothing and returns the head;
    - a command that changes its derived file produces one commit touching only that path, with the message above and a `derived.commit` audit;
    - a command that changes its derived file and also writes an ignored file produces one commit, removes the ignored file, and leaves the tree clean;
    - a command that leaves the file identical audits `derived.unchanged` and makes no commit;
    - a command that also writes a non-derived file is refused with the message above, and nothing is committed;
    - a failing command (`test/fixtures/verify/exit-two.mjs`) is refused;
    - a head that moved before the call is refused with the head-moved message.
  - Verify: `node --test test/derived-artifacts.test.ts test/commit-verification.test.ts`. Expected: all pass.
  - Break-test: skip the non-derived-path check. The refusal test must fail. Restore by SHA-256. Then move the `removeIgnoredOutput` call back before the commit. The changed-and-ignored test must fail with `unexpected non-ignored entry`. Restore by SHA-256.

- Task 6: regenerate after every patch commit, and keep derived files out of review input.
  - The order inside each phase, once Task 9 also lands, is: `applyProposedPatches`; the `implementation.phase.apply` audit; the dependency check (Task 9); regeneration (this task). The self-review and remediation follow the same order: patch, dependency check, regeneration, then the existing pass audit or verification. Build this task's call where the dependency check will sit before it.
  - Change `src/implementation-stage.ts`:
    - After `implementation.phase.apply` in the phase loop, call `regenerateDerivedArtifacts` with `expectedHead: finalHead`, `label: "phase-<index>"`, `evidenceDir: derivedEvidenceDir(rootDir, runId, "phase-<index>")`, the frozen `profile.policy` verification values, and an audit callback prefixing `implementation.`. On failure abort with `implementation.derived.failed`. On success set `finalHead` to the returned head. The next phase already re-reads `phaseBase` from HEAD.
    - After the self-review's `applyProposedPatches` (only when `kept.length > 0`), call it the same way with `label: "self-review"`, before `implementation.selfreview.pass`, and record the regenerated head as `head=` in that event and in `finalHead`.
    - In the self-review's `changedNames` and `changedDiff` git calls, append `--` followed by `.` and one `:(exclude)<path>` per derived path when the list is non-empty.
  - Change `src/code-review-stage.ts`:
    - In remediation, after the `resultingCommit === currentCommit` check and before `verifyCommit`, call `regenerateDerivedArtifacts` with `expectedHead: applied.resultingCommit`, `label: "remediation-<round>"`, and an audit prefix `code_review.remediation.`. On failure abort with `code_review.remediation.failed`. Use the returned head as `expectedCommit` for `verifyCommit`, as `roundRecord.remediation.resultingCommit`, in `code_review.remediation.pass`, and as the next `currentCommit`. `changedPaths` stays `applied.changedPaths`, the paths the implementer changed.
    - Apply the same derived-path exclusion to the `initialNames` diff, the per-round `names` and `diffResult` calls, and therefore to the `changedPaths` reviewers may place findings on. A reviewer that still cites a derived path fails `validateCodeReviewReports` (`src/code-review.ts`), which the stage calls with `changedPaths`. That reviewer's outcome is invalid, so the stage ends with `code-review panel failed after round …` and blocks without a review record, as `CLAUDE.md`'s code-review contract states for an incomplete panel. Before this change, the same citation reached remediation, whose patch to the derived path was refused as outside scope, so the run blocked either way. State this in the doc comment of the exclusion.
  - Change `src/delivery-coverage.ts`: extend invariant (3) in the module comment to say that derived-regeneration commits also land between base and head, and that delivery neither requires nor refuses them because they are never declared.
  - Tests:
    - `test/implementation-stage.test.ts`: with one derived artifact backed by `write-derived.mjs`, a two-phase run records one `implementation.derived.commit` per phase that changed the file, the gate's `head=` is the last regenerated head, and the derived path is absent from the self-review prompt's changed paths. With `derived: []` every existing test passes unchanged.
    - `test/code-review-stage.test.ts`: a remediation followed by regeneration records `remediation.resultingCommit` equal to the regenerated head, `parsePassedCodeReviewRecord` accepts the record, and the round-2 reviewer prompt's changed paths exclude the derived path. A reviewer whose finding cites the derived path is refused by `validateCodeReviewReports`, the panel fails, and the stage blocks with no review record.
  - Verify: `node --test test/implementation-stage.test.ts test/code-review-stage.test.ts test/code-review.test.ts test/verification-stage.test.ts test/delivery-stage.test.ts`. Expected: all pass.
  - Break-test: remove the phase-loop call. The implementation-stage regeneration test must fail. Restore by SHA-256.

- Task 7: the `## Dependencies added` section.
  - Change `src/spec-doc.ts`:
    - Export `interface DependencyAddition { manifest: string; name: string }`, and add `dependenciesAdded: DependencyAddition[]` to `SpecDoc`.
    - In `validateSpecDoc`, after the open-decisions checks:
      - a heading beginning "dependencies" must be exactly `## Dependencies added`, and there is at most one;
      - each non-blank line, with `- ` stripped, must match `/^(\S+): (\S+)$/`, or the refusal is `every line under ## Dependencies added must be one addition of the form '- <path to package.json>: <package name>'; this line is not: <line>`;
      - the manifest must end in `package.json` (exactly, or after a `/`), and must be one of the declared artifacts after `normalizePath`;
      - the name must match npm's name rule `/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/`, at most 214 characters;
      - a manifest and name pair is listed at most once;
      - an absent section gives `[]`.
  - Change `src/prompts.ts`: add `dependenciesSchema(indent)`, beside `openDecisionsSchema`, and render it after it at the four spec-schema sites (the draft, self-critique, reconcile and fold prompts). Its lines:
    - `- an optional ## Dependencies added section: one package the change adds to a package.json per list line, in exactly this form: \`- frontend/package.json: @tiptap/react\`.`
    - `  List every package the change adds under dependencies, devDependencies, optionalDependencies or peerDependencies of any package.json, and nothing else; the manifest must also be a declared artifact. Leave the section out when the change adds no package.`
    - `  The operator approves or denies the whole list before planning, and the system refuses an implementation that adds a package this section does not list.`
  - Add one sentence, `Add a package to a package.json only if the specification's ## Dependencies added section lists it for that file: the system refuses a commit that adds any other.`, in three places:
    - in `buildImplementationAuthorPrompt` and `buildImplementationSelfReviewPrompt`, on the line after `${verificationCommandsBlock(verification)}`;
    - in `buildCodeReviewRemediationPrompt`, which has no verification block, on the line after `When you fix a defect, look for the same defect in every other file of the approved scope and fix it there too.`, before the derived lines Task 4 inserts there.
  - Tests:
    - `test/spec-doc.test.ts`: run 4's recorded spec validates with `dependenciesAdded: []`. Its prose names four packages and no section lists them, which is the gap this closes. The same spec with a section listing the four recorded names under `frontend/package.json` validates to those four. Refusals for a manifest that is not declared, a non-`package.json` manifest, a malformed line, an invalid name, a duplicate, and a misspelled heading.
    - `test/prompts.test.ts`: the three schema lines and the implementation sentence in `CONSTRAINT_STRINGS`; the schema appears in all four spec prompts and the sentence in all three patch prompts.
  - Verify: `node --test test/spec-doc.test.ts test/prompts.test.ts test/harness-stream-fixtures.test.ts`. Expected: all pass.
  - Break-test: drop the declared-manifest check. Its refusal test must fail. Restore by SHA-256.

- Task 8: ask the operator, and hold the answer.
  - Create the record helpers in `src/dependency-policy.ts`:
    - `DEPENDENCY_INTENT = "dependency-additions"`;
    - `DEPENDENCY_LOCATION = \`${upstreamPrefixFor("design")}dependencies:added\``;
    - `DEPENDENCY_OPTIONS = [{ label: "Approve", answer: "add the listed packages" }, { label: "Deny", answer: "add none of them: the run ends blocked so the design can say what to use instead" }]`;
    - `DEPENDENCY_RECOMMENDED = 0`;
    - `dependencyQuestionText(additions)`;
    - `DEPENDENCY_WHY`, stating that the specification's approach depends on the packages and deny ends the run;
    - `readDependencyRecord(events)`, the last `spec.dependencies.record` event's `{ findingId }`, as `readSplitRecord` reads the split's.
  - Change `src/spec-stage.ts`:
    - Track `specWriterRunId`, set to the dispatch's `agentRunId` beside `written` at each of the three `writeSpecDoc` sites.
    - Inside `if (gate.pass)`, after the design-split block and before `spec.gate.pass`, when `written.doc.dependenciesAdded.length > 0`:
      - upsert the canonical finding (`DEPENDENCY_INTENT`, `DEPENDENCY_LOCATION`);
      - insert a report (severity `medium`, classification `upstream`, subject `specification adds <n> package(s)`) and an `upstream_blocking` decision with grounding and normative changes null and both hashes `specHash`, both attributed to `specWriterRunId`;
      - insert the question;
      - audit `spec.dependencies.record` with `finding=<id>; packages=<manifest:name,…>`;
      - re-read `questions`.
  - Change `src/spec-decision-stage.ts`:
    - In `answerQuestion`, refuse `modify` for the dependency question with `the dependency question takes approve (add the packages) or deny (end the run); modify is not accepted`, beside the split's refusal.
    - In `runSpecDecisionStage`, exclude the dependency question from `others`, so it is never folded.
    - After the split's approve branch and before any fold dispatch, if the dependency question was answered deny, complete `spec_decision` as `block`, set the run `blocked`, and audit `spec_decision.dependencies.denied` naming the packages. No fold is dispatched for the other questions on a run that ends here.
    - After a fold and before `writeSpecDoc`, refuse with `spec_decision.fold.invalid` when the folded specification's `dependenciesAdded` differs from the reviewed one's: `the fold changed ## Dependencies added; the operator answered the reviewed list, so a different list needs a fresh run`. Compare as sets of manifest and name pairs, so a reordered list is not a change.
  - Change `src/operator-state.ts`: give the dependency question its own action reason, `Choose exactly one of --approve (add the packages) or --deny (end the run); this question takes no --answer-file.`, chosen with `readDependencyRecord` as the split's is.
  - Change `src/guided-command.ts` `decisionHandoff`: read `readDependencyRecord` beside `readSplitRecord`, and give the dependency question a menu of `1. Approve`, `2. Deny` and `4. Exit`, mapping to `approve` and `deny`.
  - Tests:
    - `test/spec-stage.test.ts`: an emitter variant whose reviewed spec lists the four recorded names produces one question, one `spec.dependencies.record` event, and the `awaiting_decision` pause. A spec without the section produces no question and passes `spec_decision` as today.
    - `test/spec-decision-stage.test.ts`: approve proceeds to `awaiting_approval` with nothing folded for it; deny blocks with `spec_decision.dependencies.denied`, and with another question answered approve no fold is dispatched; modify is refused with the message above; a fold that drops a listed package is refused, and one that only reorders the list is accepted.
    - `test/operator-state.test.ts`: the dependency question's operator action carries its own reason text.
    - `test/guided-command.test.ts`, beside the split-menu test: the dependency question shows the Approve, Deny and Exit menu and records `deny` for choice 2.
  - Verify: `node --test test/spec-stage.test.ts test/spec-decision-stage.test.ts test/operator-state.test.ts test/guided-command.test.ts`. Expected: all pass.
  - Break-test: remove the exclusion from `others`. The approve test must fail, because a fold would be dispatched. Restore by SHA-256.

- Task 9: refuse an unapproved addition.
  - Add to `src/dependency-policy.ts` `unapprovedDependencyAdditions(worktreePath, base, head, approved: DependencyAddition[]): { ok: true } | { ok: false; reason: string }`.
    - List changed paths with `git diff --name-only -z base head`, and keep those whose last segment is `package.json`.
    - For each, read the file at `base` (absent counts as empty) and at `head` with `git show`, pass each through `normalizeText` from `src/canonical.ts` so a byte-order mark does not fail the parse, and `JSON.parse` both. A parse failure at head is refused by name.
    - Collect every key present at head and absent at base in `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies`.
    - Refuse every manifest and name pair not in `approved`, with `the change adds package(s) the approved specification does not list under ## Dependencies added: <manifest:name, …>`.
  - Change `src/implementation-stage.ts`: parse the signed specification's `dependenciesAdded` once (it already holds `specContent`). Call the check over `headAtProposal..finalHead` after each `applyProposedPatches` and before regeneration, in the phase loop and after the self-review's patch. On refusal abort with `implementation.dependency.unapproved`.
  - Change `src/code-review-stage.ts`: call it over `patchBase..applied.resultingCommit` after the remediation patch and before regeneration. On refusal abort with `code_review.dependency.unapproved`.
  - Create `test/dependency-policy.test.ts` with a temporary repository whose base commit holds the Task 1 fixture's `frontendPackageJson`:
    - a head adding the four recorded names under `dependencies`, with all four approved, passes;
    - the same head with an empty approved list is refused, naming all four as `frontend/package.json:<name>`;
    - a version change of the recorded `react` entry is not an addition;
    - a new `package.json` at head counts every entry as added;
    - invalid JSON at head is refused by name;
    - a head manifest saved with a UTF-8 byte-order mark parses.
  - Add one test each to `test/implementation-stage.test.ts` and `test/code-review-stage.test.ts`: a phase or remediation adding an unlisted package blocks with the new action, and no regeneration or verification runs after it.
  - Verify: `node --test test/dependency-policy.test.ts test/implementation-stage.test.ts test/code-review-stage.test.ts`. Expected: all pass.
  - Break-test: compare names without the manifest. The test approving the names for a different manifest must fail. Add that case first. Restore by SHA-256.

- Task 10: record the design.
  - `ARCHITECTURE.md`:
    - Section 7, "Preconditions": the optional `derived:` block, its shape, that it is frozen with the verification commands, and that a derived path is never declared.
    - Section 7, "What the system writes": add regenerated derived artifacts, committed by the system after each patch commit.
    - Section 8: the optional `## Dependencies added` section and its rules.
    - Section 12: in `spec_decision`, the dependency question (approve or deny, never folded, deny ends the run, a fold may not change the list). In the implementation and code-review paragraphs: regeneration after each patch commit, and the unapproved-addition refusal.
    - Section 23: the entry written before Task 1 stays as the authorization; add only what the build learned, if anything changed from this plan.
  - `docs/hazards.md` entry 24: add to "What answers it" that a lockfile is regenerated by the system and is no longer declared, citing this plan.
  - `README.md` and `docs/runbooks/cli-operator.md`: wherever `governed.yaml` is shown, show the optional `derived:` block, and describe the dependency question at the decision pause. Add troubleshooting rows to the runbook for the derived-declaration refusal at the spec write, `implementation.derived.failed`, `implementation.dependency.unapproved` and `spec_decision.dependencies.denied`.
  - Verify: `npm run check:docs`. Expected: exit 0 with only the expected historical-path warnings.

- Task 11: full validation, the session record, and the live test definition.
  - Run `npm run typecheck`, then `npm test` serially. Expected: 0 failures, with the skip count unchanged from the last recorded run (5).
  - Run `node .claude/skills/run-buildworks/driver.mjs smoke`. Expected: the smoke chain completes, spending nothing.
  - Set this plan's Status to `Implemented`, and add an implementation record covering files changed, the break-tests and their results, and the test totals. Update the Current state in `.claude/sessions/project-learnings.md`.
  - The live test, run only on the operator's separate authorization and budget:
    - the operator commits to crew-chatter's `governed.yaml` the `derived:` block from Task 2's test, and moves run 4's untracked spec aside;
    - a fresh feature-1 run;
    - it succeeds if the spec lists its packages under `## Dependencies added` and does not declare `package-lock.json`, the operator's answer is honoured, every phase that changes a manifest is followed by a `derived.commit`, and verification's `npm ci` passes;
    - record the cost, the dispatch count and the outcome in this plan and in the learnings.

## Implementation record

Implemented 2026-10-18 on branch `sandboxed-delivery`, uncommitted, after the operator said "Go ahead and build". The section 23 entry was written first. The live test in Task 11 has not run, because it needs its own authorization.

Files:
- New: `src/derived-artifacts.ts`, `src/dependency-policy.ts`, `test/derived-artifacts.test.ts`, `test/dependency-policy.test.ts`, `test/fixtures/verify/write-derived.mjs`, `test/fixtures/recorded/spec-crew-chatter-run-4-dependency-in-prose.json`.
- Changed source: `src/governed-config.ts`, `src/profile.ts`, `src/project-bootstrap.ts`, `src/spec-doc.ts`, `src/spec-stage.ts`, `src/spec-decision-stage.ts`, `src/approval-stage.ts`, `src/prompts.ts`, `src/implementation-stage.ts`, `src/code-review-stage.ts`, `src/commit-verification.ts`, `src/paths.ts`, `src/delivery-coverage.ts`, `src/operator-state.ts`, `src/operator-output.ts`, `src/dashboard/app.js`, `src/guided-command.ts`.
- Changed tests and emitters: the `VerificationConfig` sites under Blast radius, `test/cli.test.ts` (below), and `test/fixtures/harness/emit-spec-stage.mjs`, `emit-implementation-stage.mjs` and `emit-code-review.mjs`, which gained the modes the new tests drive.
- Documents: `ARCHITECTURE.md` sections 7, 8, 12 and 23; `docs/hazards.md` entry 24; `README.md`; `docs/runbooks/cli-operator.md`.

Task 1's check held: `sha256Hex(normalizeText(spec))` of the fixture equals the `specHash=` in run 4's `spec.gate.pass` audit row.

Differences from the plan as written:
- `RegenerationInput` also takes `rootDir`, so the audit records the evidence path relative to the root rather than as an absolute machine path.
- The derived-path exclusion is one exported helper, `derivedPathExclusion`, used by the self-review and code review. It uses `:(exclude,literal)<path>` rather than `:(exclude)<path>`, so a path containing glob characters excludes only itself.
- The fold prompt gained a sentence telling the author to keep `## Dependencies added` exactly as reviewed. Task 8 refuses a fold that changes it, and a constraint the code enforces is stated where its subject is written (hazard 3).
- `DEPENDENCY_ADDITION_RULE` sits after the "Before you choose…" line in the implementation prompt and after "These commands run right after this review…" in the self-review prompt, not directly after the verification block, so it does not split that block from the line that explains it.
- The implementation and code-review stages refuse when the signed specification no longer validates, because they now parse it for `dependenciesAdded`. Before, they only read it.
- A base `package.json` that does not parse counts as empty, so every entry at head counts as added. This fails closed. A head that does not parse is refused by name, as planned.
- The dependency question's answer is excluded from the answers copied into an approved split's exported designs, because it shares the `others` list with them.
- `readDependencyRecord` returns only `{ findingId }`, as `readSplitRecord` does. The packages are re-read from the signed specification wherever they are needed.
- `test/fixtures/verify/write-derived.mjs` also accepts `@<path>` as content, which copies another file. The self-review and remediation tests use it to mirror a source file, so the derived file changes only when that source does.
- `test/cli.test.ts` was not listed under Blast radius. Its "new-run freezes a profile and records its hash on the run" test compares the whole frozen `verification` object, and it failed the first full suite run until it expected `derived: []`. `grep "VerificationConfig\|verification: {"` missed it because it compares a parsed profile, not a typed literal.
- Tests beyond the plan: self-review regeneration, a failing regeneration blocking the stage, a listed package passing the implementation check, and the exclusion helper.
- Test harness options added: `verification` on the approval-stage fixture, and `verification` and `scope` on the code-review-stage fixture.

Break-tests, each run on a copied file and restored byte-identical (compared by SHA-256 or `cmp`):
- Task 2, accept a path containing `..`: the traversal test failed.
- Task 4, drop the `writeSpecDoc` intersection: the spec-doc test failed. Drop the approval-stage refusal: the approval test failed.
- Task 5, skip the non-derived-path check: the refusal test failed. Move `removeIgnoredOutput` before the commit: the changed-and-ignored test failed with `unexpected non-ignored entry`.
- Task 6, remove the phase-loop call: the per-phase regeneration test failed. Remove the self-review call: the self-review regeneration test failed. Record `applied.resultingCommit` instead of the regenerated head: the remediation test failed. Make the exclusion helper return nothing: three tests failed.
- Task 7, drop the declared-manifest check: its refusal test failed.
- Task 8, remove the dependency question's exclusion from `others`: the approve test failed. Give the dependency question the generic action reason: the operator-state test failed.
- Task 9, compare names without the manifest: the different-manifest test failed.

Validation:
- Focused runs: code review, verification, delivery and derived artifacts 73/73; prompts, harness-stream, spec-doc, governed-config, project-bootstrap and profile 191/191; cli-operator 127/127; spec and spec-decision stages 111/111; operator-state and guided-command 110/110; cli 72/72.
- `npm run typecheck`: exit 0.
- `npm test`, first run: 1692 tests, 1686 pass, 1 fail (the `test/cli.test.ts` expectation above), 5 skipped. Rerun after the fix: 1692 tests, 1687 pass, 0 fail, 5 skipped.
- `npm run check:docs`: clean.
- `node .claude/skills/run-buildworks/driver.mjs smoke`: 13/13 steps as expected. The smoke dispatches no model and its `governed.yaml` declares no `derived:` block, so it shows that nothing else regressed. It exercises neither regeneration nor the dependency question.

## Live test (2026-10-18, crew-chatter run 5)

The operator asked to "run the live test". Setup:
- Run 4's untracked spec was moved to `%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-18-run4`.
- The operator committed the Task 2 `derived:` block to crew-chatter's `governed.yaml` as `ec2049c`.
- A free probe in a temporary worktree showed `npm install --package-lock-only --ignore-scripts` exiting 0 at `ec2049c` with nothing changed. With `@tiptap/react` added to `frontend/package.json`, it changed only `package-lock.json` and wrote no ignored output.

Run 5 used the same settings as run 4 (`--model claude-sonnet-5-5`, narration on) and started from `ec2049c`.

What held, against the success conditions above:
- The reviewed specification listed `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` and `@tiptap/extension-list` under `## Dependencies added` for `frontend/package.json`. It declared 17 files, none of them `package-lock.json`, and never mentioned `npm install`.
- Spec review raised the dependency question (finding 84) beside OD-001's reset-token question (finding 72). The operator approved both. The fold wrote the server-log answer and kept the package list unchanged.
- Phase 2 added exactly the four packages at `^3.0.0`. The dependency check passed it, and `implementation.derived.commit` recorded the system commit `2adaf88` (`bw run 5: regenerate derived artifacts (phase-2, base 98f29aff)`, `package-lock.json` only, 649 insertions). Phases 1 and 3 changed no manifest and recorded `implementation.derived.unchanged`.
- Verification's `npm ci` passed against the regenerated lockfile in 6.8 seconds.

What failed: verification blocked on `typecheck`. `frontend/src/hooks/useAutoSave.ts(63,44)` reads `{ ...patch, ...pendingRef.current }` after assigning `pendingRef.current = null`, so TypeScript narrows it to `null` (TS2698). That line is the implementer's, and the self-review said it ran no command. The derived-artifact and dependency mechanisms are not involved. Code review and delivery did not run.

Cost: $4.04347149 recorded, in 15 Claude dispatches and 24 Decision-1 requests:
- spec $1.5607;
- spec review $0.0104;
- the decision fold $0.1371;
- plan $1.3522;
- plan review $0.0162;
- three phases and the self-review $0.9668.

The worktree is `.governance/worktrees/5` on branch `gov/crew-chatter-accounts-notes/5` at `e62df19`.
