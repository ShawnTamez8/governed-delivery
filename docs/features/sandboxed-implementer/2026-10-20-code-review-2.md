# Sandboxed implementer — second code review

**Reviewed document:** `docs/features/sandboxed-implementer/plan.md`
**Review date:** 2026-10-20
**Status:** reconciled
**Reviewer:** Claude (Opus 5.5), the operator's `/code-review high` run in a background session after the plan was marked `Implemented`. That session ran no tests and no break-tests, so it reported every finding unverified.
**Hazards considered:** 15 (the containment boundary): Findings 1 and 2 are host-side paths at that boundary, through a committed gitlink and a host `rmSync`. 2 (discarded output): Finding 3, where a refused diff's content is lost. 22 (ignored output and Linux links on the bind mount): Finding 7. 9 and 12 (two surfaces that disagree): Finding 9. Hazard 1 (output shapes): Finding 5, a reply that contradicts itself. Not engaged: 3 to 8, 10, 11, 13, 14 and 16 to 24, because no document schema, gate rule, retry, model selection, review panel or delivery check is at issue.

**Scope reviewed:** the uncommitted change on branch `sandboxed-delivery` against `44a0d3a` (68 files), after the first review's four fixes. Findings 1 to 8 are numbered as the reviewer reported them, with its file and line anchors. Findings 9 and 10 are its two cleanup items.

## Findings

**Finding 1 — `commitWorkspace` refuses deletions and symlinks but not gitlinks (mode `160000`), so a nested Git repository can reach the run branch, and later host-side `git status` runs that repository's agent-written config**

- **Where:** `src/workspace-commit.ts`, the record loop in step 5 (line 253).
- **Claim:** inside the container, `run_command` can `git init` a directory, commit in it and set its `core.fsmonitor` to a command. Only `/work/.git` is read-only. `git add -A` stages the gitlink, the gate passes it when its path fits the scope, and the system commits it. The next host `git status` (the next phase's clean check, regeneration, or verification's commit-state check) recurses into the nested repository and runs the agent's command on the host. `NO_HOOKS` does not cover this. The first review withheld the gitlink as unreachable.

**Finding 2 — Discarding a derived path that `base` does not hold uses a host `rmSync`, which runs before any link check, so a parent directory the agent replaced with a symlink sends the delete outside the worktree**

- **Where:** `src/workspace-commit.ts`, step 3 (line 232).
- **Claim:** on a Linux or macOS host, where a link made in the container is a real host symlink, an agent makes the derived path's parent a link to a host directory and writes the derived file through it. `rmSync(join(worktreePath, path), { recursive: true })` then deletes the file at the link's target. The step 5 symlink refusal comes too late.

**Finding 3 — A refused diff resets the worktree to `base` and cleans it, destroying the only copy of what the agent wrote**

- **Where:** `src/workspace-commit.ts`, the refusal in step 5 (line 265).
- **Claim:** the tool log keeps only a byte count for `write_file`, so after a refusal the operator cannot inspect the refused change or tell a near miss from a hostile one. The moved-head branch keeps its evidence; this one does not.

**Finding 4 — The work container gets `HTTPS_PROXY`/`HTTP_PROXY` but no `NO_PROXY`, so proxy-aware clients send loopback requests to the egress proxy, which refuses them**

- **Where:** `src/container.ts`, `createSandbox` (line 353).
- **Claim:** a verification command whose test calls a local server through a proxy-aware client is refused by the proxy, so a correct implementation fails verification. The same command passed on the host before this change.

**Finding 5 — `validateWorkspaceReply` accepts status `completed` with a non-empty `incompleteTasks`, so a contradictory reply passes and the listed tasks are dropped without a record**

- **Where:** `src/agent-result.ts`, line 62.
- **Claim:** the phase prompt defines `completed` as "every task of this phase is done". The stages check only `status`, so the listed tasks never reach an audit event.

**Finding 6 — `list_files` strips the mount prefix with `replaceAll("/work/", "")`, which also deletes `/work/` inside a path**

- **Where:** `src/tool-server.ts`, line 214.
- **Claim:** `/work/src/work/a.js` becomes `srca.js`, so the agent reads or writes a path that does not exist.

**Finding 7 — The bootstrap runs `npm ci` in a container on the operator's project root and never removes the output, leaving a Linux-built `node_modules` with Linux symlinks that Windows cannot open**

- **Where:** `src/project-bootstrap.ts`, `runStarterCommands` (line 62).
- **Claim:** the run stages remove ignored output in a container; the bootstrap does not.

**Finding 8 — Every non-empty `commitWorkspace` failure is recorded as `implementation.workspace.refused`, including a Git or Docker failure and a moved head**

- **Where:** `src/implementation-stage.ts`, line 395 as reported. The abort is at line 578 of the current file.
- **Claim:** an infrastructure fault reads as the agent breaking a rule; the result's `kind` already separates the two and is dropped.

**Finding 9 — Another private Git helper and porcelain parser, beside near-identical ones in four other modules, whose hook and line-ending settings have drifted**

- **Where:** `src/workspace-commit.ts` (`runGit`, `statusPaths`, line 84), against `src/derived-artifacts.ts`, `src/commit-verification.ts`, `src/code-review-stage.ts` and `src/dependency-policy.ts`.
- **Claim:** `workspace-commit.ts` pins line endings and `NO_HOOKS`, `derived-artifacts.ts` has `NO_HOOKS` only, and `code-review-stage.ts` has neither. That drift is the class of defect the first review's Finding 1 came from.

**Finding 10 — `sandboxTarget` in `test/doctor-diagnostics.test.ts` makes its Git targets in the checkout root, not the OS temp directory, so a failed cleanup leaves directories in the repository**

- **Where:** `test/doctor-diagnostics.test.ts`, line 926.
- **Claim:** the after-hook EPERM failures already left three untracked `.doctor-sandbox-*` directories in the checkout.

## Reconciliation

Reconciled 2026-10-20 by the implementing session, at the operator's direction ("yes, go ahead"). Each claim was reproduced or disproved before any change. Each fix's guard was then broken through the scratchpad `breaktest.mjs` (spec `bt-review2.json`): all seven mutations failed their test, two of them against the real engine, and each restore matched by SHA-256. Totals: six accepted and fixed, two rejected as unreachable, one partly accepted, and one, a refactor, declined.

- **Finding 1: accepted and fixed (high).** Reproduced with Git for Windows 2.53. A nested repository with `core.fsmonitor` set to a command was committed as a gitlink, and the next plain host `git status` ran that command twice. The untracked, staged, refused and reset states ran nothing. The first review's reason for withholding the case does not hold: `artifactDirectoryRefusals` (`src/scope.ts`) refuses only directories already present in the starting commit, so an agent can `git init` exactly at a declared artifact that does not yet exist, and `pathFitsScope` admits it. `commitWorkspace` now refuses mode `160000` by name. The new test in `test/workspace-commit.test.ts` keeps a positive control: committed by hand, the same gitlink makes `checkWorktreeClean` run the config. `ARCHITECTURE.md` section 8 is updated, hazard 15 has a dated note, and the runbook's refusal row names the case.
- **Finding 2: rejected, not reachable.** Step 3 removes only paths that `git status -- <derived path>` lists. Linux Git, run in the sandbox image, lists `?? gen` for a symlinked parent `gen` and nothing for `gen/lock.json`, so `rmSync` is never reached for a path behind a link. The link itself is staged as mode `120000` and refused, and the reset then removes it from inside a container. Git for Windows does list a path behind a junction, but an agent in a Linux container cannot make one. No change.
- **Finding 3: accepted and fixed.** A refused diff is now kept before the reset. `keepRefused` writes the staged tree as a commit on `base` under `refs/buildworks/refused/<sha>`, outside every branch, and the refusal names the commit. A failure to keep it is appended to the reason and changes no outcome. The new test checks the ref, the parent, the paths and the content, and that the branch and worktree are back at `base`. The stage tests' refusal patterns now include the sentence. `ARCHITECTURE.md` section 8 is updated, and the runbook row says how to inspect and delete the ref. Not changed: an unusable self-review reply's discard (`discardWorkspace`) still keeps only the discarded paths' names, as designed.
- **Finding 4: accepted and fixed.** Reproduced in the sandbox image with `HTTP_PROXY` set. Node's `fetch` under `NODE_USE_ENV_PROXY=1` and `npm` both sent a `127.0.0.1` request to the proxy and failed, and with `NO_PROXY` both connected directly. `createSandbox` now adds `NO_PROXY=localhost,127.0.0.1,::1` (`LOOPBACK_HOSTS`). This departs from the plan's "adds only `HTTPS_PROXY`/`HTTP_PROXY`". The new real-engine test in `test/container.test.ts` reaches a local server by IP and by name, and keeps a positive control: with `NO_PROXY` emptied, the same call fails.
- **Finding 5: accepted and fixed.** Every recorded real reply agrees with the rule. The recorded `completed` replies list no incomplete tasks, and the `blocked` ones list them. `validateWorkspaceReply` now refuses a `completed` reply with a non-empty list and quotes the list. A phase therefore blocks with `implementation.content.invalid`, a self-review skips with its changes discarded, and remediation blocks. New tests: a validator case in `test/agent-result.test.ts`, and a stage test with the emitter mode `completed-with-incomplete`. `ARCHITECTURE.md` section 8 and the runbook state the rule.
- **Finding 6: accepted and fixed.** Confirmed by reading: `replaceAll` turned `/work/src/work/a.js` into `srca.js`. The prefix is now stripped once per line (`/^\/work\//gm`). New tests: a probe test in `test/tool-server.test.ts`, and a real-engine test in `test/container.test.ts` over a real `src/work/a.js`.
- **Finding 7: rejected, not reachable with the one starter offered.** `npm ci` on the static-web starter's zero-dependency project, run in the sandbox image, creates no `node_modules` at all, so nothing Linux-built is left. If a future starter gains dependencies, the bootstrap must remove its ignored output in a container, as the run stages do. No change.
- **Finding 8: accepted and fixed.** A phase's `commitWorkspace` failure of kind `failed` now blocks with `implementation.workspace.failed`, and `implementation.workspace.refused` is kept for a diff that broke a rule. The new stage test uses the emitter mode `commit`, a phase that commits in the checkout, and checks for one event of the new action and none of the other. `ARCHITECTURE.md` section 12 and a runbook row name the event. Remediation keeps its single `code_review.remediation.failed` action, whose reason text distinguishes the two cases.
- **Finding 9: declined as a refactor; no defect found.** The other helpers' Git calls in `src/code-review-stage.ts`, `src/commit-verification.ts` and `src/dependency-policy.ts` are `rev-parse`, `ls-tree`, `diff`, `status` and `show`. These run no hooks and write nothing back to the worktree. The config they read is in the read-only `.git`, and the one agent-written config route, a gitlink, is Finding 1, now refused. Consolidating the helpers is a separate change.
- **Finding 10: accepted and fixed.** `sandboxTarget` now creates its targets under the OS temp directory, and keeps the bounded EPERM/EBUSY retry. The three directories already left in the checkout are untracked. They are not deleted, because deleting is the operator's call.

Validation:
- `npm run typecheck` is clean.
- The affected suites passed with no engine: 210 tests, 0 failures, 4 platform skips. They were `test/implementation-stage.test.ts`, `test/code-review-stage.test.ts`, `test/agent-result.test.ts`, `test/tool-server.test.ts`, `test/workspace-commit.test.ts`, `test/container-seams.test.ts`, `test/docker-stand-in.test.ts` and `test/doctor-diagnostics.test.ts`.
- `test/container.test.ts` passed 14/14 against Docker 29.8.2.
- The full serial suite with no engine (`DOCKER_HOST=tcp://127.0.0.1:1`) ran 1746 tests: 1728 passed, 0 failed and 18 were skipped, all named. The skips were 14 `test/container.test.ts` tests ("no Docker engine answered"; this review added two), three native POSIX differentials and the Windows file-symlink privilege skip.
- `npm run check:docs` is clean.
- `git log -1` stayed at `44a0d3a`.
