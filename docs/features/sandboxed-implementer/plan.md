# Sandboxed Implementer Implementation Plan

**Status:** Reconciled

**Goal:** The three patch-producing dispatches (each implementation phase, the implementation self-review and code-review remediation) change files through BuildWorks' own MCP tool server, whose tools act only inside a disposable Docker container. The harness computes the diff from the worktree and gates and commits it. Verification and derived-file regeneration run in the same kind of container. Section 17's "verification is not contained" limitation closes, and patch content no longer travels inside JSON. The build supports Node/npm targets only. Its image, network access and service network stay open to other stacks, and every failure names its cause rather than being swallowed.

**Source:**
- `docs/proposals/sandboxed-delivery-rework.md`, change 1 ("A sandboxed implementer, governed at the boundary") and track B. Track B's text: "the change 1 spike, then change 1, with verification moved into the same container".
- `docs/features/sandboxed-implementer-spike/plan.md` (`Implemented`, commit `28a5786`). Every exit criterion passed. Its spike record lists the findings this plan answers. The spike code under `scripts/sandbox-spike/` is the prototype this plan promotes into `src/`.
- Operator decisions, 2026-10-19:
  - "draft the change 1 build plan".
  - The executor command drops `--safe-mode`, because `--safe-mode` discards a server named by `--mcp-config` and `--restricted` alone keeps `CLAUDE.md` files out (spike record, positive-controlled).
  - `PWD` is a container runtime default.
  - An agent edit to a derived file is discarded and the file regenerated ("Dicard and regenerate for now"). The operator also asked to "determine why the model did that"; see Assumptions.
  - Run worktrees are checked out with LF line endings.
  - The per-dispatch cost cap is $2.00.
  - "Node-only for now, but yes we are buiding apps routinely with various tech stacks so I just want to be careful that we dont tie ourselves to 1 stack" (C#, Azure services, Azure SQL, SQL, SQLite, React, Rust). The target-declared environment model is recorded, unbuilt, in `docs/proposals/target-declared-environments.md`. "dont build the riskier option now. Continue with node-only ... but kept open to other stacks."
  - "add error handling and the correct descriptive log messages were needed so we dont swallow errors and make troubleshooting more difficult on ourselves".
- This plan authorizes nothing. Building it needs the operator's section 23 decision (Task 1). The paid runs in Task 13 each need their own consent.

**Hazards considered:**
- **15 (a declared sandbox is not a read-only process):** this plan replaces its mechanism. The guarantee becomes "nothing reaches the run branch except a diff the harness computes and gates". It is proven by the spike's attempted violations, re-run as committed integration tests (Task 3).
- **1 (output shapes):** patch content leaves the JSON reply. The reply becomes a three-field summary, and items 9 to 11's patch shapes stop being reachable for these dispatches.
- **2 (discarded output):** each tool call is logged before it runs, and the log is retained beside the raw output (Task 2).
- **8 (Windows executable resolution):** `docker` is spawned directly with no shell. Verification commands stop going through the Windows shell, because they run as argv inside a Linux container.
- **9 (unverified interpreters):** the MCP config names the tool server's interpreter by `process.execPath`.
- **12 (configuration divergence):** the image ID, limits and egress allowlist are frozen in the profile and shown by `doctor`.
- **19 (inactivity budget):** a tool call emits nothing while its command runs. The per-command ceiling (300 s) stays below the idle budget (1800 s). Verification's output ceilings stay in `runVerifyCommand`, which now streams the container's output (Task 8).
- **20 (one dispatch over too much):** phases stay at ten items. They are no longer a response-size workaround, only the verification cadence.
- **21 (agents not told their gate):** the agent can now run the frozen commands itself. The harness's own run in a fresh container still gates.
- **22 (ignored files and the clean-tree guard):** ignored output is removed from inside a container, because `npm` leaves Linux symlinks that Git for Windows cannot open (spike Task 1).
- **23 (fix blind to decisions):** unchanged. Remediation's inputs do not change, only its write path.
- **24 (declared artifact nothing changes):** derived paths stay harness-owned. An agent edit to one is discarded before the diff is computed.
- **3, 4, 5, 6, 7, 10, 11, 13, 14, 16, 17 and 18:** not engaged. No document schema, prompt-routed field, gate rule, retry, model selection, review panel or delivery check changes. The stand-in executors and the Docker stand-in are held to recorded real output (Task 4).

**Assumptions:**
- **[Verified]** The spike's result holds for Claude Code 2.1.303, Docker engine 29.8.2 (Docker Desktop, WSL 2) and `node@sha256:a5f4366e…` (`docs/features/sandboxed-implementer-spike/plan.md`). Under the adopted command (`--restricted --strict-mcp-config` without `--safe-mode`), no `CLAUDE.md` loads and the only MCP server is the one named. Another Claude Code version may differ, so Task 13 re-runs the `CLAUDE.md` probe against the built command.
- **[Verified]** Why the spike's agent ran `npm install`: dependencies were not installed in the checkout. Its `npx tsc --noEmit` then downloaded the unrelated `tsc@2.0.4` package from the registry, so it ran `npm install --ignore-scripts` to get TypeScript and ESLint. Its summary says it "did not touch package-lock.json". It did not know `npm install` rewrites that file (`test/fixtures/recorded/sandbox-spike-crew-chatter-phase-2.json`, tool calls 3 and 4).
- **[Verified]** Removing `--safe-mode` from the one executor command also affects the read-only dispatches: spec and plan authors, reviewers, reconcilers, the split and the fold. Under `--restricted --strict-mcp-config` with no `--mcp-config`, those sessions load no `CLAUDE.md` and no MCP server (spike probes). Their tool list is unchanged. The bundled skill and plugin lists were identical with and without `--safe-mode`; the only addition was the built-in agent `statusline-setup`, which needs the `Task` tool, which `--tools Read,Glob,Grep` does not include.
- **[Unknown]** How often an agent installs packages, and whether pre-installing dependencies in the container before the agent starts would remove the need. This plan does not pre-install, because no frozen command names "install dependencies". It tells the agent the side effect instead and keeps the discard. The question is recorded under Open decisions.
- **[Unknown]** The cost of an agentic phase beyond one sample: $0.2417 against $0.1903 one-shot, 5.9 times slower. Task 13 measures two full runs.
- **[Assumption]** Tests cannot require Docker. The suite runs on machines without it. Stage tests therefore use a Docker stand-in held to recorded real output (Task 4), and the containment properties are proven by integration tests against real Docker that skip, with a named reason, when no engine answers (Task 3).

**Approach:** Promote the spike's prototype into `src/`, in four layers, each with one owner:
- **`src/container.ts`** is the only module that runs `docker`. It handles the image, the internal network, the egress proxy container, work containers with frozen limits, `exec` under a ceiling, ignored-output removal and teardown.
- **`src/tool-server.ts`** is the agent-neutral MCP stdio server. It has four tools, logs each call before running it, and refuses `.git`, absolute and `..` paths by name.
- **`src/workspace-commit.ts`** holds the boundary, as host-side Git:
  - discard derived-file edits and record them;
  - compute the staged diff against the dispatch base;
  - refuse deletions and symlinks;
  - run `gatePatchPaths`;
  - commit as the system, then check the committed set.
- **`src/harness.ts` and `src/executor.ts`** hold the Claude-specific part: the `--mcp-config` file, `--allowedTools mcp__bw__*` and `--max-budget-usd`, appended per invocation exactly as `--json-schema` is today.

The three stages then swap `applyProposedPatches` for "create sandbox, dispatch, compute and commit the diff". Verification and derived regeneration keep `runVerifyCommand`'s bounded streaming, but each command runs through `container.ts`'s exec path instead of on the host. Under hard rule 3 the old path is deleted, not kept beside the new one: `PATCH_RESULT_SCHEMA`, `SELF_REVIEW_RESULT_SCHEMA`'s patch arm, `applyProposedPatches`, `dropUnchangedFiles` and host-side command spawning all go. Every profile frozen before this change becomes unusable at its next dispatch, as any frozen-shape change does (hazard 6). No run is in flight.

**Affected areas:**
- **New:** `src/container.ts`, `src/tool-server.ts`, `src/egress-proxy.ts`, `src/workspace-commit.ts` and `container/Dockerfile`.
- **Modified:**
  - `src/executor.ts`, `src/harness.ts`, `src/dispatch.ts` and `src/paths.ts`;
  - `src/policy.ts` and `src/profile.ts`;
  - `src/implementation-stage.ts`, `src/implementation-self-review.ts`, `src/code-review-stage.ts` and `src/agent-result.ts`;
  - `src/verification-stage.ts`, `src/commit-verification.ts`, `src/verify-command.ts` and `src/derived-artifacts.ts`;
  - `src/readiness.ts`, `src/cli.ts`, `src/run-intake.ts`, `src/project-bootstrap.ts` and `src/prompts.ts`.
- **Tests and fixtures:** the matching test files and the stand-in emitters under `test/fixtures/harness/`, plus a new Docker stand-in under `test/fixtures/docker/`.
- **Documents:** `ARCHITECTURE.md` sections 6, 7, 8, 11, 12, 15, 17, 20 and 23; `docs/hazards.md` entries 15, 20 and 22; `README.md` and `docs/runbooks/cli-operator.md` (Docker becomes a prerequisite); `CLAUDE.md`/`AGENTS.md` (the Windows harness launch and phased-implementation paragraphs); and `.claude/skills/run-buildworks/SKILL.md`.

**Known blockers:**
- **The section 23 decision.** It does not exist yet. The 2026-10-18 entry says it "does not authorize change 1". Task 1 records the operator's decision, and no other task starts before it.
- **Docker becomes a hard requirement for any run that reaches implementation.** `new-run` refuses without an engine, at $0. Every developer has Docker Desktop (proposal, operator facts 2026-10-18). Docker Desktop's licence terms for the organization are the operator's question (spike plan, Assumptions).
- **The auto-mode classifier** has blocked launching `claude` without `--safe-mode` and blocked first commits in a target (`.claude/sessions/project-learnings.md`). If it blocks a Task 13 command, the operator runs that command.
- **The PowerShell transport test** `test/cli-operator.test.ts` fails from the assistant's tool shell and passes in the operator's terminal (auto memory, `powershell-transport-test-env-specific`). Read a failure there against that note before diagnosing.

**Blast radius:** from the explore map of 2026-10-19, which records file and line for each item.
- **`applyProposedPatches`** (`src/patch-application.ts`) has three callers: `src/implementation-stage.ts` (phases and self-review) and `src/code-review-stage.ts` (remediation). Seven test references, all in `test/patch-application.test.ts`.
- **`PATCH_RESULT_SCHEMA`**: 21 test references across 5 files. **`SELF_REVIEW_RESULT_SCHEMA`**: 11 across 3.
- **`validateAgentResult`** also serves the document stages, and has about 33 references across 9 test files. It stays, losing only its patch arm, and only if Task 6's search shows no document-stage caller reads patches.
- **`runVerifyCommand`** (`src/verify-command.ts`) is called by `verifyCommit` (`src/commit-verification.ts`, which serves verification and remediation) and by `regenerateDerivedArtifacts` (`src/derived-artifacts.ts`). `VERIFY_ENV_PASSTHROUGH` (`src/policy.ts`) is also read by `src/project-bootstrap.ts`.
- **`CLAUDE_CODE`** (`src/executor.ts`) is frozen into every profile by `freezeProfile` (`src/profile.ts`) and compared by `requireFrozenBinding`. `doctor`'s `frozen_executor_probe` (`src/cli.ts`) applies only when the frozen executor equals `CLAUDE_CODE`.
- **Flag pins:** `test/executor.test.ts` pins the flags. About 13 recorded fixtures carry the old argv; they are evidence of what ran then, and stay unchanged.
- **Prompt pins:** `test/prompts.test.ts` pins "This checkout is read-only for you" and "Run no git commands" (implementation-prompt pins), the structured-output rule order, and the routing table that pairs each builder with its emitter and schema.
- **Stand-in emitters:** `test/fixtures/harness/emit-implementation-stage.mjs` and `emit-code-review.mjs` require `--json-schema` and emit `structured_output` patches. `emit-cli-run.mjs` routes by prompt prefix.
- **Integration boundaries:**
  - the frozen profile shape (hard rule 6);
  - the `agent_run` row, unchanged;
  - the audit vocabulary: new `*.derived.discarded`, `*.workspace.refused`, `*.sandbox.failed`, `*.sandbox.quiescence.failed` and `*.sandbox.teardown.failed` events, and `patch.apply` replaced by `workspace.commit`;
  - the `governed.yaml` contract (section 7), which gains nothing;
  - the dashboard, which reads events by name (`src/dashboard*.ts`; Task 11 searches it).

**Verification:**
- **Component:** each new module's unit tests. Every guard is proven by breaking it: copy the file, mutate it, watch the test fail, restore, and compare SHA-256.
- **Containment:** `test/container.test.ts` re-proves spike criteria 2 to 6, 8 and 9 against real Docker, and skips by name without an engine.
- **Error paths and extension points:**
  - `test/container-seams.test.ts` holds extension point 4 and bans empty or dropped `catch` blocks.
  - Each module's tests include its failure messages: a missing container, an absent image, a teardown failure, a Git failure, and a missing program.
- **Stage:** the existing stage suites, rewritten to tool mode with the Docker stand-in, including the full-chain `test/cli-operator.test.ts` runs.
- **Regression:**
  - `npm run typecheck`;
  - `npm run check:docs`;
  - the full serial suite (`node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`), with zero failures, the new skip count stated, and `git log -1` unchanged afterwards;
  - the free smoke, 13/13.
- **End to end:** two paid runs, each separately consented: the web calculator and crew-chatter feature 3. Plus a cents-level `CLAUDE.md` regression probe against the built executor command (Task 13).
- **Limit:** a green suite does not show cost per run or how often an agent loops. Those need Task 13.

---

## Decisions this plan takes, and open ones

**Taken (operator, 2026-10-19):** discard and regenerate an agent's derived-file edit; LF worktrees; a $2.00 cap per patch dispatch; the command without `--safe-mode`.

**Taken by this plan, from the proposal or a binding rule:**
- **Verification and derived regeneration move into the container.** This is the proposal's track B text.
- **One executor definition** (hard rule 4, section 11's "one adapter"). The read-only dispatches use the same command and append nothing.
- **Deletions and symlinks in the computed diff are refused by name, and a rename counts as a deletion.** Patches could not delete before ("the system refuses patch deletions", hazard 20), and the applier already refused link components. Git reports a rename as one `R` record with no `D` (verified 2026-10-19: `R100 old.ts new.ts`), so the diff is read with rename detection off.
- **A self-review whose reply is unusable discards its workspace changes and skips.** This keeps today's contract that an unusable reply skips and changes nothing. A guard failure still blocks.
- **The image is built locally from the committed `container/Dockerfile` by `new-run`** when absent, and its image ID is frozen. Only the base is pinned, by digest. The Dockerfile installs `git` from Debian's repositories without a version, so two builds can differ, and a rebuild does not recover a lost image ID. The frozen image ID is the toolchain's identity, and the run record holds the ID that ran. A run whose frozen image is absent locally refuses at its next sandbox (Task 7). Recovery is a fresh run, not a rebuild. `doctor` warns that `docker image prune` would remove a frozen image an open run still needs, naming the run.
- **The egress allowlist is `registry.npmjs.org:443` only**, frozen. It is one host for the one ecosystem in use (hard rule 4).

## Scope: Node-only, kept open to other stacks

This build supports targets whose verification and derived commands need only Node, npm and Git, and whose packages come from `registry.npmjs.org`. A target whose frozen commands name a top-level program the image lacks (`dotnet`, `cargo`) is refused at `new-run`, before any spend, by the program check in Task 7. That check proves only the top-level program. It cannot see what that program calls: a tool `npm run build` invokes, a native compiler an npm package needs at install time, a browser a test downloads, or a running service (a database, an emulator). Such a target passes the check and fails later, at a phase or at verification. Section 7 and the README state this limit (Task 11).

Other stacks arrive through the target-declared environment model in `docs/proposals/target-declared-environments.md`, not through a rewrite. These four extension points are requirements of this build, each enforced by a test:

1. **The image is a frozen reference, not a BuildWorks assumption.** The profile freezes `sandbox.image` (an image ID). Its source today is `container/Dockerfile`. No code outside `ensureImage` knows where the image came from, and no code assumes what is installed in it beyond what the frozen commands name.
2. **Network access is a frozen list of allowed hosts.** `sandbox.egressAllowlist` is a list, which the proxy reads from its arguments. Adding a package feed is one more entry, plus the dependency approval that ecosystem needs (proposal, rule 3).
3. **The run's private network can take more members.** `src/container.ts` names the network per sandbox and attaches containers by name. Nothing assumes the work container and the proxy are its only members, so a service container can join later.
4. **No package-manager logic in the sandbox, tool server or boundary code.** Derived files come from `governed.yaml`'s `derived:` list, so lockfiles need no npm code. `test/container-seams.test.ts` (Task 2) fails if `src/container.ts`, `src/tool-server.ts`, `src/egress-proxy.ts` or `src/workspace-commit.ts` mentions `npm`, `package.json`, `package-lock`, `node_modules` or a registry host. The npm-specific parts stay where they already are: the seeded allowlist in `src/policy.ts`, `src/dependency-policy.ts`, and `src/spec-doc.ts`'s `## Dependencies added`.

## Error handling and diagnostics

Every failure in the new path reaches the operator with enough to act on, and none is swallowed. These rules bind every task:

- **An error names five things.** It names the operation (create network, start proxy, start work container, exec, remove ignored output, compute diff, commit, teardown), the object (container or network name, path), the command's argv, its exit code or the spawn error code, and the last 2,000 bytes of its stderr. `src/container.ts` raises one error class, `ContainerError`, carrying those fields, for control operations only: network, run, inspect, logs, remove. Its message reads in one line, for example `start work container bw-1a2b3c4d-7-phase-2-9f8e7d-work failed (docker exit 125): <stderr tail>`.
- **A command's own failure is an outcome, not an infrastructure error.**
  - `docker exec` exits 1 both for a missing container and for a failing test (verified 2026-10-19: `Error response from daemon: No such container`, exit 1), so the exit code alone cannot tell them apart.
  - Each command therefore runs inside a wrapper that records its exit status in the container, with a fresh random `<token>` per command: `docker exec -i <id> sh -c 'timeout --signal=KILL "$0" "$@"; echo $? > /tmp/bw-exit-<token>' <seconds> <argv...>`. Because `timeout` runs inside the wrapper, a ceiling kill is also recorded, as 137.
  - After the exec, `src/container.ts` reads that file. If the file is present, its value is the command's exit code, and verification records it exactly as `runVerifyCommand` records a host exit today. If the file is absent, the exec failed as infrastructure, and it raises `ContainerError` with Docker's stderr.
  - Every image therefore needs POSIX `sh` and `timeout`, which the program check (Task 7) verifies.
- **No empty `catch`, and no `catch` that drops the error.**
  - A `catch` either rethrows with context added, or records the error in an audit event or evidence file and then returns a refusal that carries its message.
  - `test/container-seams.test.ts` fails on an empty `catch` block, or on a `catch` whose body neither uses the caught error nor rethrows, in the four new modules.
- **Teardown never hides the primary error and is never silent.**
  - `destroySandbox` returns `{ removed, failures, workContainerGone }` instead of swallowing.
  - `workContainerGone` is true only after `docker rm -f` on the work container succeeded and a following `docker container inspect` of that ID reports no such container.
- **No host step runs while a writer may survive.** The work container holds the worktree mounted read-write, and a command can leave background processes in it. Before `commitWorkspace`, before a verification result is recorded, and before the next stage reads the worktree:
  - The caller requires `workContainerGone`.
  - Otherwise it blocks with `<stage>.sandbox.quiescence.failed`, which names the container ID and the removal error and carries the stage's primary error first when there is one. No commit follows.
- **Leftover proxies and networks don't block.** A proxy container or network that could not be removed writes to no worktree. It is recorded as `<stage>.sandbox.teardown.failed`, naming every object and why, and the stage keeps its own outcome.
- **`doctor` lists leftovers.** It lists the `bw-*` containers and networks labelled with this repository's key, with the command that removes them.
- **A sandbox that fails to start blocks before any dispatch is spent.** The stage records `<stage>.sandbox.failed` with the `ContainerError` message, and the run is blocked with that reason.
- **Evidence is captured before teardown.**
  - The proxy's log (`docker logs`) goes to `<toolLogDir>/<input hash>-proxy.log`.
  - The tool server's log stays at `<toolLogDir>/<input hash>.jsonl`.
  - A failed dispatch's reason names both paths beside the prompt path.
- **The tool server never crashes silently.**
  - Each tool handler is wrapped. An unexpected exception is written to the log as an `error` record (tool, arguments, message, stack) and returned to the agent as `isError` with the message.
  - Unparseable input is logged with its first 200 characters.
  - A process-level `uncaughtException` or `unhandledRejection` is logged, then the process exits non-zero, so Claude Code reports the server as failed rather than hanging.
- **The egress proxy logs every outcome.** `allow` and `deny` are logged as today. An upstream connect or socket error is logged as an `error` record with the host and the error code, never just `destroy()`ed.
- **Refusals stay specific.** `commitWorkspace` refusals name every refused path with its cause. A Git failure names its argv, exit code and stderr. A program-check refusal (Task 7) names the command, the missing program and the image ID, and points to `docs/proposals/target-declared-environments.md`.
- **Runbook coverage.** `docs/runbooks/cli-operator.md` gains a troubleshooting row for each new event: `sandbox.failed`, `sandbox.quiescence.failed`, `sandbox.teardown.failed`, `workspace.refused`, `derived.discarded`, and the program-check refusal. Each row names where the evidence is (Task 11).

**Open, for the operator after the first paid run:**
- Should the sandbox pre-install dependencies before the agent starts, so the agent never reaches for `npx` or `npm install` to get a toolchain? That needs a frozen "prepare" command, which `governed.yaml` does not have.
- Should `npx` package auto-download be switched off in the container (`npm_config_yes=false`)? It fetched an unrelated package in the spike.
- Does the per-dispatch cap need different values per dispatch kind?

## Tasks

### Task 1: Record the operator's section 23 decision

**Depends on:** the operator's authorization of this plan.

**Files:**
- Modify: `ARCHITECTURE.md` — section 23, a new entry after "Derived artifacts and dependency policy — 2026-10-18".

**Steps:**
- Write the entry in the house form: the reason, what it authorizes, and what it does not. It covers:
  - the three patch dispatches write through BuildWorks' tool server inside a container, which replaces hazard 15's read-only mechanism for those dispatches;
  - the harness-computed diff is the only path to the run branch;
  - verification and derived regeneration run in a container;
  - the executor command without `--safe-mode`;
  - Docker as a run prerequisite;
  - the four operator choices above;
  - Node/npm targets only, with the four extension points under "Scope" kept open;
  - the error-handling rules under "Error handling and diagnostics".

  It does not authorize changes 4, 7 or 9, a second agent, a second image or ecosystem, target-declared environments (`docs/proposals/target-declared-environments.md`), service containers, network beyond the frozen allowlist, or any paid run.
- Verify: `npm run check:docs`. Expected: clean.

**Task completion evidence:** the entry, and the clean check.

### Task 2: Add the container module, the tool server and the egress proxy

**Depends on:** Task 1.

**Files:**
- Create: `container/Dockerfile`, `src/container.ts`, `src/tool-server.ts` and `src/egress-proxy.ts`.
- Modify: `src/paths.ts`: add `toolLogDir(rootDir, runId)` and `toolLogRef(runId, name)` for `.governance/tools/<run>/`.
- Modify: `test/paths.test.ts`: pin both, as the other locations are pinned.
- Create: `test/tool-server.test.ts` and `test/container-seams.test.ts`.

**Steps:**
- **`container/Dockerfile`:** the spike's Dockerfile unchanged. It uses the base pinned by digest, adds `git`, and holds no Claude Code.
- **`src/container.ts`:** port `scripts/sandbox-spike/docker-sandbox.ts`. Keep:
  - its object layout, under host-unique names:
    - `bw-<repoKey>-<run>-<label>-<instance>`, where `repoKey` is the first 8 hex digits of the SHA-256 of the repository root's resolved path, and `instance` is 6 random hex digits per sandbox.
    - Run IDs are local to each repository's store, and the writer lock is per repository (`ARCHITECTURE.md` section 19, `src/lock.ts`), so two repositories can run run 1, phase 1 at once.
    - Every object carries the labels `bw.repo=<repoKey>`, `bw.run=<id>` and `bw.instance=<instance>`.
    - `createSandbox` records the ID Docker returns for each object it actually created, and cleanup, including after a partial start, removes only those IDs, never anything by name pattern;
  - its flags: `--internal` network, a proxy container on the bridge network plus the internal one (attached with `--network-alias proxy` on the internal network), and a work container with `--cpus`, `--memory`/`--memory-swap`, `--pids-limit`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--user <frozen user>`, the worktree at `/work` with its `.git` mounted `:ro` over it, and an explicit `--env` list;
  - its double ceiling (`timeout --signal=KILL` in the container, and a host kill five seconds later);
  - its out-of-memory distinction (exit 137 before the ceiling is not a ceiling kill).

  Take the image ID, limits, allowlist, per-command timeout, container user and environment from a `FrozenSandbox` argument, never from constants. The spike hard-coded `--user node` and `npm_config_proxy`/`npm_config_https_proxy`, which are image-specific and npm-specific. They become the frozen `sandbox.user` and `sandbox.env`, seeded in `src/policy.ts` (Task 7). `src/container.ts` adds only the stack-neutral `HTTPS_PROXY`/`HTTP_PROXY` pointing at its own proxy (extension points 1 and 4). Add:
  - `ensureImage(dockerfileDir)`: build if absent, return the image ID;
  - `dockerReady()`: `docker version` server OS `linux`;
  - `removeIgnoredOutputInContainer(worktree, paths)`, ported from the spike's `removeIgnoredOutput`.
  - **Error handling.**
    - Every control call (network, run, inspect, logs, rm) goes through one helper that raises `ContainerError` (operation, object, argv, exit or spawn code, stderr tail) on any non-zero exit or spawn failure. The spike's `docker()` returned a status that callers could ignore.
    - **Command execution is a separate path.**
      - `execArgv(sandbox, argv, token)` builds the `docker exec` argv with the exit-status wrapper above. `readExitStatus(sandbox, token)` returns the recorded code, or raises `ContainerError` when it is absent.
      - The command's output streams through the existing `runVerifyCommand` (`src/verify-command.ts`), which spawns the `docker exec` argv with `shell: false` (`docker.exe` is native, hazard 8).
      - The frozen in-memory ceiling, the retention ceiling, combined-stream overflow and the timeout tree-kill therefore apply unchanged. The spike's synchronous 64 MiB buffer is not promoted.
      - The tool server's `run_command` uses the same pair.
    - `destroySandbox` returns `{ removed, failures, workContainerGone }`, where the spike's swallowed failures.
    - Add `captureProxyLog(sandbox, path)`, called before teardown.
  - The network, proxy and work container are attached by name, with no assumption that they are the network's only members (extension point 3).
- **`src/egress-proxy.ts`:** port the spike proxy. It reads its allowlist from `argv` so the frozen value reaches it. Mount only this one file into the proxy container, read-only, not its directory. Log upstream connect and socket errors as `error` records with the host and error code.
- **`src/tool-server.ts`:** port the spike server. Arguments are `--container`, `--log` and `--timeout`. It takes its log path as given; Task 6 has `dispatchOnce` build it. Add the error handling the diagnostics rules require: wrapped handlers, unparseable-input logging, and process-level handlers that log and exit non-zero.
- **Tests:**
  - `test/tool-server.test.ts` (no Docker):
    - the handshake and `tools/list`;
    - path refusals for `.git`, absolute and `..` paths, refused before any `docker` call;
    - log order;
    - a `run_command` against a `--container` that does not exist returns `isError` whose text names the container and `docker`'s own error (or `ENOENT` where no `docker` is installed), and the log holds a matching `error` or `finished` record;
    - unparseable input is answered with JSON-RPC error `-32700` and logged.
  - `test/container-seams.test.ts`: the extension-point 4 scan, and the empty-or-dropped-`catch` scan, over the four new modules.
- Break-tests:
  - remove the `.git` refusal; the test fails;
  - write `started` after running; the order test fails;
  - make the tool handler's `catch` return a fixed "failed" text without the error; the missing-container test fails;
  - add an `npm` literal to `src/container.ts`, then an empty `catch {}`; the seams test fails each time;
  - restore each and compare bytes.
- Verify: `node --test test/tool-server.test.ts test/container-seams.test.ts test/paths.test.ts` and `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the passing tests and the recorded break-test failures.

### Task 3: Prove containment against real Docker

**Depends on:** Task 2.

**Files:**
- Create: `test/container.test.ts`.

**Steps:**
- Port the spike's `boundary-checks.ts` into tests, one test per criterion: 2 (mounts, canary, host paths, credentials file), 3 (canary credentials, environment names), 4 (registry allowed, other hosts and a bare IP refused), 6 (two runaways and the memory bound), 8 (`.git`) and 9 (log order, path refusals).
  - Criterion 5 moves to Task 5's unit tests, because the gate is host Git.
  - Each test creates its own throwaway Git repository under the OS temp directory, and its own sandbox, removed in `after`.
- Add error-path and ownership tests against real Docker:
  - starting a work container on an image ID that does not exist raises a `ContainerError` whose message names the operation, the container and Docker's stderr;
  - removing the network before `destroySandbox` makes it return a `failures` entry naming the network, not throw or stay silent;
  - `captureProxyLog` writes the proxy's `allow` and `deny` lines to the given file;
  - a command that leaves a background writer appending to a file under `/work` returns, then `destroySandbox` reports `workContainerGone` true, and the file stops growing;
  - a failing command's exit code is read from the exit-status file, and `docker exec` against a removed container raises `ContainerError` instead;
  - two sandboxes with equal run IDs and labels but different repository roots start side by side. A third, from a further root, fails at its work container (an image ID that does not exist) after its network and proxy started, and removes only its own objects; both others still answer `docker inspect`.
- When `dockerReady()` fails, every test skips with the reason `no Docker engine answered`.
- Break-tests, against a working engine:
  - drop `:ro` from the `.git` mount; the criterion 8 test fails;
  - add `-e ANTHROPIC_API_KEY` to the work container; the criterion 3 test fails;
  - attach the work container to the bridge network; the criterion 4 bare-IP test fails;
  - drop the repository key from object names; the side-by-side test fails;
  - restore each and compare bytes.
- Verify: `node --test test/container.test.ts`, with Docker Desktop running and once with it stopped. Expected: all pass with it running; all skip, with the named reason, with it stopped.

**Task completion evidence:** both runs' output and the break-test failures.

### Task 4: Add a Docker stand-in held to recorded output

**Depends on:** Task 2.

**Files:**
- Create: `test/fixtures/docker/docker-stand-in.mjs`, `test/fixtures/recorded/docker-cli-outputs.json`, `test/docker-stand-in.test.ts`.
- Modify: `src/container.ts`. The `docker` command comes from `FrozenSandbox.dockerCommand`, seeded as `["docker"]`, the way the executor's command is frozen. Tests freeze `[process.execPath, "<stand-in>"]`.

**Steps:**
- Record, with real Docker, the exact stdout of every `docker` form `container.ts` parses (`version --format`, `image inspect --format`, `run -d`, `container inspect` of a present and a removed container, the exit-status wrapper and its file read, `top`, `rm -f`) into the recorded fixture, with a `provenance` block.
- The stand-in implements only those forms. `exec` with the exit-status wrapper runs the inner argv on the host in the directory mounted at `/work`, with the frozen `--env` list plus `PATH` and `SystemRoot` as its environment, spawning with a shell on Windows as `runVerifyCommand` did before this change (hazard 8: `npm` is a Windows shim), so the test targets' commands still resolve. It writes the inner exit code where the wrapper's file read finds it, and returns nothing there when the test removed the container. `rm -f` fails, and `container inspect` still finds the container, for a container the test marks unremovable in the stand-in's state directory. Its outputs are read from the recorded fixture wherever the real output is parsed.
- `test/docker-stand-in.test.ts` asserts that the stand-in's parsed outputs equal the recorded ones (hard rule 5), and that it refuses any form it does not implement.
- Verify: `node --test test/docker-stand-in.test.ts`. Expected: pass.

**Task completion evidence:** the fixture and the passing test.

### Task 5: Compute, gate and commit the workspace diff

**Depends on:** Tasks 2 and 4.

**Files:**
- Create: `src/workspace-commit.ts` and `test/workspace-commit.test.ts`.

**Steps:**
- `commitWorkspace({ worktreePath, base, scope, slug, derivedPaths, sandbox, message, onAudit })`, where `sandbox` is the run's `FrozenSandbox`. Its caller has already confirmed `workContainerGone` ("Error handling and diagnostics").
  1. Confirm HEAD still equals `base`.
  2. Collect ignored paths with `git status --porcelain --ignored` and remove them with `removeIgnoredOutputInContainer`, recording each one.
  3. Return every frozen derived path to its state at `base`. Every Git call in this step runs with `--literal-pathspecs`, so a path is never read as a pattern.
     - Find the derived paths that differ with `git status --porcelain=v1 -z --untracked-files=all -- <derived paths>`.
     - For each one, ask whether `base` holds it, with `git ls-tree -z --name-only <base> -- <path>`. `src/governed-config.ts` validates a derived declaration, not that the file exists, so an agent's first install can create one.
     - A path present at `base` (modified or deleted by the agent) is restored with `git checkout <base> -- <path>`.
     - A path absent at `base` is removed from the worktree. Nothing is staged yet, because `.git` is read-only to the agent and step 4 has not run.
     - Emit `<stage>.derived.discarded` naming each path and which of the two it was.
  4. Run `git add -A`.
  5. Read `git diff --cached --raw --no-renames -z <base>`, NUL-delimited so no path is quoted or split. With rename detection off, a rename arrives as an `A` record and a `D` record. Refuse by name any deletion (`D`), any mode `120000` and any path that `gatePatchPaths` refuses, with a `<stage>.workspace.refused` event. Every path of every record goes through `gatePatchPaths`.
  6. Refuse an empty diff as "changed nothing".
  7. Commit as `SYSTEM_NAME` and check that the committed set equals the staged set.
  8. Return the new head and the paths.

  A refusal leaves the worktree reset to `base` and cleaned, so the branch keeps only committed phases, as today.

  **Errors:** every Git call goes through one helper that, on failure, returns a refusal naming the argv, exit code and stderr tail. Each refusal event's summary names the operation and every refused path with its cause. When the reset after a refusal itself fails, both messages are recorded, the refusal first.
- Tests use a temp repository and no Docker, through the Task 4 stand-in. Cases:
  - an in-scope change commits;
  - out-of-scope, protected (`governed.yaml`) and `tasks.md` paths are refused naming each (spike criterion 5);
  - a deletion is refused;
  - a rename with identical content, whose source and destination are both in scope, is refused, naming the source as a deletion;
  - a symlink is refused;
  - each beside a valid in-scope source edit that commits:
    - a derived file absent at `base` and created by the agent is removed and recorded;
    - a derived file modified by the agent is restored and recorded;
    - a derived file deleted by the agent is restored and recorded;
  - an empty diff is refused;
  - a moved HEAD is refused;
  - a Git failure (a `worktreePath` that is not a repository) returns a refusal naming the Git argv and its stderr.
- Break-tests:
  - skip the derived restore; the modified-derived test fails;
  - restore an absent-at-base path with `git checkout` instead of removing it; the created-derived test fails;
  - drop `--no-renames`; the rename test fails;
  - skip the `120000` check; the symlink test fails;
  - restore and compare bytes.
- Verify: `node --test test/workspace-commit.test.ts`. Expected: pass.

**Task completion evidence:** the passing tests and the break-test failures.

### Task 6: Teach the executor and harness the tool-server invocation

**Depends on:** Task 2.

**Files:**
- Modify: `src/executor.ts` (`CLAUDE_CODE`), `src/harness.ts` (`InvocationInput`, `invokeHarness`), `src/dispatch.ts` (`DispatchInput`), `src/agent-result.ts`, `src/implementation-self-review.ts`.
- Modify: `test/executor.test.ts`, `test/harness.test.ts`, `test/dispatch.test.ts`, `test/harness-stream-fixtures.test.ts`, `test/agent-result.test.ts`, `test/implementation-self-review.test.ts`.

**Steps:**
- **The command.** In `CLAUDE_CODE.command`, remove `--safe-mode`, and remove `mcp__*` from `--disallowedTools`. Update the doc comment with the spike evidence (`--restricted` keeps `CLAUDE.md` out, and `--strict-mcp-config` admits only `--mcp-config` servers). Update `test/executor.test.ts`'s pinned argv and its flag-semantics comment.
- **The tool-server log.** `DispatchInput` gains `toolServerContainer?: string`. When it is set, `dispatchOnce` builds the tool server's argv itself (`process.execPath`, `src/tool-server.ts`, `--container`, `--log <toolLogDir>/<input hash>.jsonl`, `--timeout <frozen>`), after it hashes and retains the prompt, so the log is named like the prompt. A failed dispatch's audit summary names the log path beside the prompt path, in the `dispatchOnce` reason suffix. Keep `test/dispatch.test.ts`'s regexes unanchored.
- **The invocation.** `InvocationInput` gains `toolServer?: { command: string; args: string[] }` and `budgetUsd?: string`. When `toolServer` is set, `invokeHarness` writes the MCP config (`{"mcpServers":{"bw":{"type":"stdio",...}}}`) beside the retained prompt. It appends `--mcp-config <file> --allowedTools mcp__bw__*`, and `--max-budget-usd <budgetUsd>` when given. The config format and flag names stay inside `src/harness.ts`; stages pass only the neutral `toolServer`. Test: argv has these flags only when `toolServer` is set, and a read-only dispatch's argv is unchanged apart from the command edit.
- **The reply schema.** Add `WORKSPACE_REPLY_SCHEMA` (`{status: "completed"|"blocked", summary, incompleteTasks}`) and `validateWorkspaceReply` to `src/agent-result.ts`. Make `SELF_REVIEW_REPLY_SCHEMA` the same shape plus `critique` (minItems 1). The old patch schemas stay until Task 9 moves their last consumers.
- Verify: `node --test test/executor.test.ts test/harness.test.ts test/dispatch.test.ts test/agent-result.test.ts test/implementation-self-review.test.ts` and `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the passing tests.

### Task 7: Freeze the sandbox, refuse without Docker, and check out LF worktrees

**Depends on:** Tasks 2 and 4.

**Files:**
- Modify: `src/policy.ts`. Add seeded constants: `SANDBOX_LIMITS` (`cpus "2"`, `memory "4g"`, `pidsLimit 512`), `SANDBOX_COMMAND_TIMEOUT_SECONDS` (300), `SANDBOX_EGRESS_ALLOWLIST` (`["registry.npmjs.org:443"]`), `PATCH_DISPATCH_BUDGET_USD` (`"2.00"`), `SANDBOX_DOCKER_COMMAND` (`["docker"]`), `SANDBOX_USER` (`"node"`, the base image's non-root user), and `SANDBOX_ENV` (`npm_config_proxy` and `npm_config_https_proxy` pointing at `http://proxy:3128`). The `proxy` host is a network alias `src/container.ts` gives its proxy container, so frozen values never embed a run-specific name.
- Modify: `src/profile.ts`. `freezeProfile` freezes a `sandbox` object from those constants plus the image ID. `invalidProfileReason` refuses a profile without one.
- Modify: `src/run-intake.ts` (`createRunIntake`), `src/readiness.ts` (`inspectReadiness`, `inspectBootstrapPrerequisites`) and `src/cli.ts` (`doctor`).
- Modify: `src/implementation-stage.ts`, at the `git worktree add`.
- Modify: `test/profile.test.ts`, `test/run-intake.test.ts`, `test/doctor-diagnostics.test.ts`, `test/cli.test.ts` (it `deepEqual`s the frozen profile; learnings, "blast-radius search ... parent key").

**Steps:**
- `new-run` calls `dockerReady()` and refuses at $0 when it fails, naming the cause. It calls `ensureImage` and freezes the image ID.
- **Program check.**
  - `new-run` runs `command -v <argv[0]>` for each frozen verification and derived command, inside a throwaway container of the frozen image with `--network none` and no mounts.
  - A missing program refuses the run at $0: `the verification command "<name>" needs "<program>", which image <id> does not provide; this BuildWorks build supports Node/npm targets (see docs/proposals/target-declared-environments.md)`.
  - `doctor` reports the same as `sandbox_programs`.
  - Test with the Docker stand-in. A frozen command `["dotnet", "build"]` is refused with that message, and `["npm", "ci"]` passes; the stand-in's `command -v` answers from the recorded fixture.
  - Break-test: skip the check; the `dotnet` test fails.
- `doctor` adds:
  - `docker_engine`;
  - `sandbox_image`, built or not and its ID;
  - for an existing run, `frozen_sandbox_image`, which compares the frozen ID with the local one and warns that `docker image prune` would remove an image an open run still needs;
  - `sandbox_leftovers`, the containers and networks labelled `bw.repo=<this repository's key>`, with the command that removes them.
- Each dispatch through `container.ts` refuses when the frozen image ID is absent locally (hard rule 6). The refusal names a fresh run as the recovery, because a rebuild is not guaranteed to reproduce the frozen ID.
- Create the run worktree with `git -c core.autocrlf=false -c core.eol=lf worktree add ...`.
  - Test: on a repository whose config sets `core.autocrlf=true`, a committed LF file reads back LF in the worktree, and `git status` is clean.
  - Break-test: drop the `-c` pair; the test fails on a Windows host. On a non-Windows host the test asserts the argv instead.
- Verify: the listed tests and `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the passing tests and the break-test.

### Task 8: Move verification and derived regeneration into the container

**Depends on:** Tasks 4 and 7.

**Files:**
- Modify: `src/commit-verification.ts` (`verifyCommit`, `removeIgnoredOutput`), `src/derived-artifacts.ts` (`regenerateDerivedArtifacts`), `src/verify-command.ts` and `src/project-bootstrap.ts`.
- Modify: `test/verification-stage.test.ts`, `test/verify-command.test.ts`, `test/commit-verification.test.ts`, `test/derived-artifacts.test.ts`, `test/project-bootstrap.test.ts`.

**Steps:**
- `verifyCommit` creates one sandbox per call and runs each frozen command as argv through `container.ts`'s exec path: `execArgv` wrapped by `runVerifyCommand`, then `readExitStatus`. The ceiling is the frozen `VERIFY_COMMAND_TIMEOUT_SECONDS`, and evidence logs are written as today. The cleanup goes through `removeIgnoredOutputInContainer`, and the sandbox is destroyed in `finally`. The audit events are unchanged.
- `regenerateDerivedArtifacts` runs its declared commands the same way.
- **`runVerifyCommand` keeps its streaming and its ceilings.** It still owns the bounded in-memory capture, the retention ceiling, combined-stream overflow, the timeout tree-kill and the evidence file. Its host-shell spawning is deleted (hard rule 3): it now spawns only the `docker exec` argv `container.ts` builds, with `shell: false`. The exit code it records comes from `readExitStatus`, not from `docker exec`'s own exit.
- **Errors.**
  - A sandbox that fails to start blocks with `<stage>.sandbox.failed` (`verification`, `code_review`, `implementation`), carrying the `ContainerError` message.
  - An absent exit-status file is an infrastructure failure. It blocks with `<stage>.sandbox.failed`, and is never recorded as the command failing.
  - A command's evidence log keeps its full output as today, plus a first line naming the container, image ID and argv, so the log alone explains where it ran.
  - Teardown and quiescence failures are handled as Task 9 handles them. A verification result is recorded only after `workContainerGone`.
- **Tests, with the stand-in:**
  - a stand-in `run` failure blocks verification with a reason naming the operation and the stand-in's stderr;
  - a failing command's stdout reaches its evidence log, and the recorded exit code is the command's;
  - mixed-stream overflow and the retention-ceiling kill behave as in `test/verify-command.test.ts` today, now through the exec path;
  - a missing exit-status file raises `ContainerError` and does not record a command failure;
  - a work container the stand-in cannot remove blocks verification with `verification.sandbox.quiescence.failed`, and no verification result is recorded.
  - Break-test: read an absent exit-status file as exit 1; the infrastructure test fails. Restore and compare bytes.
- `VERIFY_ENV_PASSTHROUGH` stops applying to verification, because the container's environment is the frozen `--env` list. First search `src/project-bootstrap.ts` for what it does with `VERIFY_ENV_PASSTHROUGH`, and whether it runs the starter's commands. If it runs them, route them through the container and add the engine check to `inspectBootstrapPrerequisites`. If it only lists the names, leave it, and keep the constant for it alone. Record which in the implementation record.
- Verify: the listed tests and `npm run typecheck`. Expected: pass.

**Task completion evidence:** the passing tests.

### Task 9: Rewrite the three patch dispatches to tool mode

**Depends on:** Tasks 5, 6 and 8.

**Files:**
- Modify: `src/implementation-stage.ts` (the phase loop, the self-review block, `readSelfReviewReply`; delete `dropUnchangedFiles` and `sameBlobAtCommit`).
- Modify: `src/code-review-stage.ts` (the remediation dispatch and apply).
- Modify: `src/prompts.ts` (`buildImplementationAuthorPrompt`, `buildImplementationSelfReviewPrompt`, `buildCodeReviewRemediationPrompt`).
- Delete: `src/patch-application.ts` once no caller remains, and `test/patch-application.test.ts`.

**Steps:**
- **Each phase:**
  1. Clean check.
  2. `createSandbox` for the worktree. A `ContainerError` blocks the run with `implementation.sandbox.failed` carrying its message, before any dispatch.
  3. `dispatchOnce` with `invocation: { cwd: worktreePath, jsonSchema: WORKSPACE_REPLY_SCHEMA, toolServer, budgetUsd: profile.sandbox.patchDispatchBudgetUsd }`.
  4. Capture the proxy log, then destroy the sandbox in `finally`. When `workContainerGone` is false, block with `implementation.sandbox.quiescence.failed`, keeping any primary error first; no commit follows. Record any other teardown `failures` as `implementation.sandbox.teardown.failed`, without changing the phase's outcome.
  5. A reply status other than `completed` blocks, as `proposed` did. The block reason quotes the reply's `summary` and `incompleteTasks`, so the operator sees what the agent said it could not do.
  6. `commitWorkspace` with base `phaseBase` and the frozen derived paths.
  7. The dependency check, then `regenerate`, both unchanged.

  `implementation.phase.apply` names the committed paths. `implementation.phase.dropped` is deleted with its rule.
- **The self-review:** the same flow, with `SELF_REVIEW_REPLY_SCHEMA`.
  - An unusable reply resets the worktree to its head and cleans it, records `implementation.selfreview.skipped` with the discarded paths, and skips.
  - A `commitWorkspace` refusal blocks.
  - No change at all is a pass with no commit, as today.
- **Remediation:** the same flow, with base `patchBase`. A refusal blocks as `applyProposedPatches` failures did. "No new commit" still blocks.
- **The three prompts:**
  - Replace the read-only and JSON-patch text with the spike's tool-mode contract (`scripts/sandbox-spike/phase-replay.ts`, `PREAMBLE`), generalized per prompt.
  - Keep the scope lists. Phases keep the existing and missing scope-path lists, now as information.
  - Add one sentence, stack-neutral, beside the existing derived-files list (`derivedArtifactsLines`): "Installing packages can rewrite the derived files listed above; the system discards your changes to them and regenerates them".
  - Update `STRUCTURED_OUTPUT_RULE` usage and the `test/prompts.test.ts` pins and `CONSTRAINT_STRINGS` (a pinned phrase must not wrap across a template-literal line).
- **Remove the old patch path.** Once the three dispatches above no longer read patches, search `src/` for every remaining reader of `PATCH_RESULT_SCHEMA`, `SELF_REVIEW_RESULT_SCHEMA` and the patch arm of `AgentResult`. Delete each one, with the tests in `test/agent-result.test.ts` and `test/implementation-self-review.test.ts` that exercise only the patch shapes. If a document-stage reader of patches exists, stop and revise this plan.
- Verify: `npm run typecheck` and `node --test test/prompts.test.ts test/agent-result.test.ts test/implementation-self-review.test.ts`. Expected: clean, and passing. The stage suites run in Task 10, once the emitters speak tool mode.

**Task completion evidence:** the clean typecheck, the passing tests, and the search output, kept for the implementation record.

### Task 10: Make the stand-in emitters act through the workspace

**Depends on:** Task 9.

**Files:**
- Modify: `test/fixtures/harness/emit-implementation-stage.mjs`, `emit-code-review.mjs`, `emit-cli-run.mjs`.
- Modify: `test/implementation-stage.test.ts`, `test/code-review-stage.test.ts`, `test/cli-operator.test.ts` and the other suites Tasks 7 to 9 break.

**Steps:**
- **Tool-mode prompts.** In tool mode, an emitter writes its files into its working directory (the worktree), which stands in for the tool server's writes. It then emits a result line carrying `structured_output` in the reply shape, held to the shape of the recorded spike result line (`test/fixtures/recorded/sandbox-spike-crew-chatter-phase-2.json`, `resultLine`).
- **Required flags.** It refuses a patch prompt that arrives without `--mcp-config` or `--json-schema`, so a stage that forgot either fails its tests.
- **Regression cases.** Keep every existing case that still has a meaning:
  - a mutation guard becomes an out-of-scope write;
  - the self-review fix becomes a workspace edit;
  - derived regeneration is unchanged.

  Add one: a phase whose work container the stand-in cannot remove blocks with `implementation.sandbox.quiescence.failed`, and the branch head is unchanged.

  Delete the drop-unchanged cases with their rule.
- Verify: first `node --test test/implementation-stage.test.ts test/code-review-stage.test.ts test/verification-stage.test.ts test/cli-operator.test.ts`, then the full serial suite. Expected: 0 failures. The skip count rises by the Task 3 tests when no engine runs. `git log -1` is unchanged. A `test/cli-operator.test.ts` PowerShell transport failure from the assistant's shell is read against the known environment note before it is diagnosed.

**Task completion evidence:** the suite's counts.

### Task 11: Update the binding documents

**Depends on:** Tasks 1 to 10.

**Files:**
- Modify: `ARCHITECTURE.md`:
  - section 6: agents may not "run commands outside an explicit allowlist", which becomes "outside the run's container, and only through the tool server";
  - section 7: the read-only implementer and the LF worktree;
  - section 8: the patch write mode becomes a computed diff;
  - section 11: the executor YAML, the tool-server invocation, and "the sandbox is enforced by the caller";
  - section 12: the implementation, self-review, verification and remediation gates;
  - section 15: `.governance/tools/`;
  - section 17: verification is contained;
  - section 20: phases.
- Modify: `docs/hazards.md`, entries 15, 20 and 22, each with a dated note.
- Modify: `README.md`, `docs/runbooks/cli-operator.md`, `CLAUDE.md` and `AGENTS.md` (byte-identical), and `.claude/skills/run-buildworks/SKILL.md`.

**Steps:**
- Rewrite each section's binding text to match the build. Name the spike plan and this plan as the evidence.
- Section 7 and the README prerequisites state the supported toolchain (Node, npm, Git, the npm registry), the program check and what it cannot see (tools a script calls, native build dependencies, services), the image guarantee and its recovery (a fresh run), and point to `docs/proposals/target-declared-environments.md` for other stacks.
- `docs/runbooks/cli-operator.md` gains the troubleshooting rows that "Error handling and diagnostics" lists.
- Search the documents for the old mechanism's own wording ("read-only for you", "proposes a diff", "not otherwise contained", "Read,Glob,Grep", "--safe-mode", "dropped") and fix every site that is now false (lessons: "When a route that was blocked finally opens").
- Search `src/dashboard*.ts` and `src/dashboard/` for the deleted event names (`phase.dropped`, `patch.apply`), and update each projection that reads one.
- Verify: `npm run check:docs`, `npm run typecheck`, and a hash comparison of `CLAUDE.md` and `AGENTS.md`. Expected: clean, and equal hashes.

**Task completion evidence:** the clean checks and the search output.

### Task 12: Full free validation

**Depends on:** Task 11.

**Files:** none changed.

**Steps:**
- `npm run typecheck`, then the full serial suite in the background, then `git log -1`, then `npm run check:docs`, then `node .claude/skills/run-buildworks/driver.mjs smoke`.
- Run `node --test test/container.test.ts` once more with the engine up.
- Expected:
  - the suite has 0 failures, with every skip named;
  - `git log -1` is unchanged;
  - the smoke reports `13/13 steps as expected`;
  - the container tests pass.

**Task completion evidence:** the counts and the smoke summary.

### Task 13: Paid validation, each step separately consented

**Depends on:** Task 12 and the operator's consent per step.

**Files:**
- Create: `test/fixtures/recorded/sandboxed-implementer-claude-md-regression.json`.
- Modify: this plan's implementation record, and `.claude/sessions/project-learnings.md`.

**Steps:**
- **The `CLAUDE.md` regression probe** (cents). Re-run the spike's `claude-md-probe.ts` logic against the built `CLAUDE_CODE` command, once with a tool server and once without one (a read-only dispatch's command). Expected: neither planted nor global `CLAUDE.md` loads, and the positive control fires.
- **A web-calculator paid chain**, through `driver.mjs paid --yes --model claude-sonnet-5-5`, after its expected cost is stated to the operator. Expected: the run completes. Record dispatches, cost, tool calls per patch dispatch and per-phase time.
- **Crew-chatter feature 3** (`new-run --after 7`, after its design is exported and committed as the project learnings describe), with its own consent. Expected: it completes or blocks with a recorded cause. Record the same measures, and whether the agent installed packages.
- **The record.** Write both into the implementation record, and set Status to `Implemented` only after the free validation passes. The paid runs are evidence, not the gate. Do not adjust any expectation after seeing a result.

**Task completion evidence:** the fixtures, the cost lines and the record.

## Rollback

Before Task 1 nothing changes. After the build, reverting the build commits restores the read-only implementer and host verification, and every profile frozen under this plan becomes unusable, as any frozen-shape change does. Docker objects are per sandbox and removed in `finally`. A failed teardown leaves `bw-<repoKey>-<run>-*` objects labelled `bw.repo=<repoKey>`, which `doctor` lists and `docker rm -f` and `docker network rm` clear. The `bw` image stays until `docker image rm`.
