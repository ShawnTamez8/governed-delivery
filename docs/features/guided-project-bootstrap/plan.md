# Guided Project Bootstrap Implementation Plan

**Status:** Implemented

**Goal:** Provide one installed `buildworks` command that safely creates a usable local project, waits for the operator-authored `design.md`, and then discovers and advances the existing governed delivery workflow without requiring Git, YAML, run-ID, or low-level command choreography. Approval remains an explicit external signing handoff because verification code cannot share the operator's private-key authority.

**Source:** Operator requirements confirmed on 2026-09-13: support both `buildworks <new-project-path>` and `buildworks` inside a project; scaffold a guided starter; continue by rerunning the same command after the operator adds `design.md`; preserve cryptographic approval through an external authority that verification cannot access; remain local-only with no GitHub creation or publication. The operator selected exact prompted run identity and external-only private-key custody during reconciliation. `ARCHITECTURE.md`, `docs/hazards.md`, the implemented `docs/features/cli-operator/plan.md`, and `docs/runbooks/cli-operator.md` define the current boundaries this feature replaces or preserves.

**Hazards considered:** 4 requires generated-project checks to execute the generated verification commands rather than trust constants shared with the implementation, and requires mutation proofs for new guards; 7 prohibits an outer retry loop or automatic replay when a stage fails; 8 requires the installed npm shim and the native Claude executable to be tested on their actual Windows paths rather than wrapped in another shell; 9 requires Node, npm, Git, and Claude probes before scaffold or spend; 10 requires the selected model to freeze once at run creation without pretending that a local syntax check proves provider entitlement; 11 requires the default installed command and generated starter to be able to reach a real run; 12 requires generated verification configuration and frozen run configuration to remain visible; 13 requires the operator's `design.md`, not the starter template, to remain the source of product obligations; 15 requires agent subprocesses to remain read-only even though the operator CLI gains bootstrap mutations; and 18 requires the generated verification path to discover and execute real tests while remaining explicit that a passing starter smoke does not prove the later product correct. Hazards 1-3, 5-6, 14, and 16-17 remain enforced by the unchanged stage, parsing, review, reconciliation, and delivery cores.

**Assumptions:** BuildWorks itself is installed once from the local checkout with npm; the linked checkout remains required and registry publication remains out of scope. The first release provides one concrete `static-web` starter for a browser application verified with Node's built-in test runner; it does not add a target-stack adapter interface, because `ARCHITECTURE.md` hard rule 4 requires a second real implementation before an abstraction. The operator supplies the project location, answers bounded prompts for project, feature ID, slug, change kind, and model when no exact persisted identity exists, authors `docs/features/<slug>/design.md`, and uses a separate signing authority for approval. BuildWorks may stage and commit only its generated baseline and that exact design file after showing the change and receiving confirmation. Existing arbitrary nonempty non-Git directories are refused rather than adopted. Existing Git repositories are continued only when their committed inputs already satisfy the current intake contract; the feature does not infer or rewrite an existing project's build system. No paid provider run, GitHub repository, push, merge, deployment, schema migration, new stage, second harness, private-key store, or signing service is authorized by this plan.

**Approach:** Add `buildworks` as an installed alias for the existing CLI and route bare or path-form invocations into one interactive state machine. The first invocation preflights tools and identity, exclusively creates a concrete static-web starter in an empty target, generates and verifies its committed `governed.yaml`, commits only generated paths, and exits successfully with the exact missing design path. A later invocation derives or asks the operator to select the target feature, confirms and commits only `design.md`, obtains the complete run identity, runs existing readiness and run-intake logic, and uses the existing `advanceRun`, `readRunSnapshot`, `buildBinding`, and `approveRun` contracts. It prompts separately for each paid execution range and approval submission. At approval it writes the exact canonical payload, pauses for an external authority to create the signature file, and imports that signature on a later invocation; it never generates, locates, opens, or invokes a private key. Existing low-level commands and their output contracts remain available.

**Affected areas:** Checkout-linked package installation and binary aliases; CLI argument routing and help; interactive prompt handling; project bootstrap and exact-path Git commits; run intake extraction; run identity selection and continuation; external approval payload/signature handoff; current architecture/security documentation; operator README/runbook; and focused unit, CLI integration, installation, and mutation tests. The stage sequence, SQLite schema, frozen profile shape, provider harness, stage implementations, external signer, dashboard, and GitHub behavior remain unchanged.

**Known blockers:** [Verified] `package.json` is private and exposes only `bw`; `npm install` in the checkout does not link the package's own binary. [Verified] `package.json` and `package-lock.json` have no version, so npm 11.17.0 refuses `npm pack --dry-run --json`; the selected contract is checkout-linked installation and does not pack an artifact. [Verified] `src/cli-args.ts` requires a named subcommand and rejects a positional path. [Verified] `resolveRepositoryRoot` accepts only an existing Git worktree, while a new-project entrypoint must resolve and create an absent or empty target before repository resolution. [Verified] `new-run` intake logic is embedded in `src/cli.ts`, so guided and low-level creation would duplicate a security-sensitive freeze path unless it is extracted. [Verified] `Store.insertRun` requires project, feature ID, slug, and change kind, and feature ID enters the signed approval payload; guided mode must obtain and match the complete tuple rather than inventing part of it. [Verified] `advanceRun` deliberately stops at approval and owns its own prompt reader; a composed interactive journey needs an injectable confirmation seam without weakening direct `run` behavior. [Verified] `scripts/sign-approval.mjs` is the only current private-key reader, and `test/sign-approval.test.ts` enforces that no file under `src/` touches a private key. [Verified] verification receives `HOME` and `USERPROFILE` and has no filesystem sandbox, so the guided feature cannot safely create a predictable file-backed private key; it preserves external-only signing and adds no default private-key path. [Verified] `ARCHITECTURE.md` currently lists target-stack adapters and packaging among non-goals; this plan authorizes one concrete starter and checkout-linked local installation, not an adapter framework, packed artifact, or registry publication.

**Blast radius:** [Verified] `package.json` and `package-lock.json` define the current `bw` bin; README and both project instruction files state that no installed command exists. `src/cli.ts` is invoked by `test/cli.test.ts`, `test/cli-operator.test.ts`, the canonical `.claude/skills/run-buildworks/driver.mjs`, the legacy `.agents` driver copy, and `src/dashboard-server.ts`; the low-level argument and output contracts those callers depend on must remain intact. `src/cli-args.ts` is imported by `src/cli.ts`, while `formatHelp` is asserted directly by `test/cli-operator.test.ts`. `checkIntakeRepository` and `inspectReadiness` in `src/readiness.ts` are imported by `src/cli.ts` and tested through `test/cli-operator.test.ts`; generated projects must pass those exact functions. `advanceRun` in `src/run-command.ts` is called by `src/cli.ts` and directly exercised by `test/run-command.test.ts`. `approvalPayload`, `loadPublicKey`, `buildBinding`, and `approveRun` feed both CLI approval commands and tests in `test/approval.test.ts`, `test/approval-stage.test.ts`, `test/sign-approval.test.ts`, and `test/cli-operator.test.ts`. `listRuns` and `readRunSnapshot` in `src/operator-state.ts` are the authoritative continuation sources. No external consumer of a new guided module exists yet.

**Verification:** Add focused Node tests for checkout-linked installation, path routing, scaffold generation, non-overwrite and exact staging, private-key exclusion, external approval confirmation, exact-tuple state selection, interruption/resume, and full fixture-backed continuation. Execute the generated starter's own `npm ci` and `npm test` in disposable targets. Reuse the existing schema-valid local harness fixtures for end-to-end guided execution without provider spend. Run `npm run typecheck`, `npm test`, `npm run check:docs`, and `git --no-pager diff --check`. Prove the non-overwrite, private-key exclusion, exact-consent, exact-staging, and no-retry guards by breaking each in an isolated mirror and restoring the original bytes before completion. Run an implementer-authored verification command that attempts to read the former default private-key path and require an actual file-not-found refusal; separately assert that guided output and environment maps disclose no alternate private-key path.

---

## Requirements and acceptance criteria

The primary actor is a local developer or project owner who has installed Node
24+, npm, Git, Claude Code, and BuildWorks, but should not need to understand
BuildWorks' internal subcommands or state identifiers.

The first release supports these user-visible forms:

```text
buildworks C:\path\to\new-project
buildworks
```

The path form accepts a platform-native absolute path, `.` or `..`, or an
explicitly path-shaped relative argument beginning with `.\`, `..\`, `./`, or
`../`. A bare unknown word remains an unknown-command error rather than silently
creating a misspelled directory. With no argument, the current directory is the
target.

The guided command satisfies the following acceptance criteria:

- **GBP-AC-01 — Installed entrypoint:** A one-time local global installation
  exposes both `buildworks` and the compatible `bw` alias. The installed
  checkout link can display help and run with another current working directory
  without missing source, migration, or dashboard assets. The source checkout
  remains present at its installed path.
- **GBP-AC-02 — Safe project creation:** Against an absent target or an empty
  directory, the command preflights Node, npm, Git, Claude Code, and Git commit
  identity before writing project content. It creates only the selected target
  and never creates a signing-key directory or private key.
- **GBP-AC-03 — Concrete starter:** The first release offers one
  `static-web` project type and creates a dependency-light browser starter with
  a valid npm package name, a synchronized lockfile, one meaningful starter
  test, `.gitignore`, `governed.yaml`, source, HTML, and setup documentation.
  The generated verification commands pass before the baseline is committed.
- **GBP-AC-04 — No silent overwrite:** Existing nonempty non-Git targets,
  mismatched partial scaffold files, dirty existing repositories, and unrelated
  untracked files are refused by name.
  The command never deletes, resets, or overwrites them.
- **GBP-AC-05 — Design is the only authored input:** The first invocation
  derives or prompts for one lowercase kebab-case feature slug, creates its
  directory, commits the generated baseline, and exits with the exact path
  where the operator must add `design.md`. It does not create product
  requirements or treat the starter as their source.
- **GBP-AC-06 — Exact design commit:** On rerun, when the only pending
  operator input is that feature's nonempty UTF-8 `design.md`, the command
  displays its path and Git diff, asks for confirmation, stages only that path,
  commits it, and proves the worktree is clean. Other changes cause a refusal.
- **GBP-AC-07 — Existing-repository compatibility:** An existing Git worktree
  with a clean committed `governed.yaml`, committed design, and current
  readiness can enter the guided run path without being scaffolded or rewritten.
  Existing low-level CLI commands retain their argument, output, and exit-code
  contracts.
- **GBP-AC-08 — Run discovery:** With no run for the selected feature, the
  command prompts for and validates project, feature ID, change kind, and model,
  creates one run through the same intake/profile-freeze core as `new-run`, and
  retains its ID internally. The full identity key is project, feature ID, slug,
  and change kind. With one persisted identity tuple for the selected slug, a
  rerun reuses it; with several tuples, the operator selects one exact displayed
  tuple. Exactly one nonterminal run for that tuple resumes. Multiple
  nonterminal matches, or multiple terminal matches with no nonterminal match,
  are refused with their IDs. One terminal match is reported without reopening
  it, and a new run is created only when the exact tuple has no run.
- **GBP-AC-09 — Paid consent:** Before each paid execution range, the command
  displays the existing frozen preview and requires a fresh explicit
  confirmation. Initialization, readiness, run creation, status inspection,
  approval handoff, and approval remain no-spend operations. `--yes` or an
  earlier answer never grants approval or a later range's consent.
- **GBP-AC-10 — Guided cryptographic approval:** At the approval boundary, the
  command displays the reviewed specification path and exact binding fields,
  writes the canonical payload to an exclusive machine-local handoff file, and
  exits without a repository lock. An external authority that the BuildWorks
  host and verification process cannot access writes the corresponding
  signature file. On rerun, the command redisplays the binding, requires
  explicit confirmation, reacquires the repository lock, recomputes the
  binding, and calls the existing deterministic approval gate with that
  signature. Changed payload, signature, expiry, or binding bytes fail rather
  than receiving an implicit approval.
- **GBP-AC-11 — Signing authority containment:** Guided mode accepts only the
  configured external Ed25519 public key and a detached signature. It never
  generates, locates, reads, invokes, logs, or exports a private key or private
  key path, and it does not create the former predictable
  `%USERPROFILE%\.buildworks\approval.key`. The operator keeps private signing
  material in an authority outside the filesystem and process identity
  available to verification. The repository's file signer remains an advanced
  external transport tool, not a guided default or a same-host containment
  claim.
- **GBP-AC-12 — State-aware continuation:** Rerunning the same command derives
  the next action from the existing read-only run snapshot. It never retries a
  failed group, reopens a blocked/completed run, repairs an inconsistent chain,
  replays a completed group, or assumes a lock identifies an active run.
- **GBP-AC-13 — Terminal handoff:** Completion reports the retained delivery
  branch, worktree, delivered commit, evidence references, final findings, and
  known recorded cost. A block or failure reports the durable reason and next
  read-only inspection command without claiming recovery.
- **GBP-AC-14 — Local-only boundary:** The command does not create a GitHub
  repository, add a remote, push, merge, deploy, publish a package to a
  registry, or start the dashboard.
- **GBP-AC-15 — Resumable interaction:** Declining or cancelling scaffold,
  design commit, paid consent, approval submission, or later paid consent
  leaves a diagnosable state. A missing external signature remains an approval
  pause. Rerunning `buildworks` resumes from the next proven boundary; it does
  not require the operator to remember a run ID.

## Command and state contract

### Installation and naming

Keep the package private and add a second bin alias:

```json
{
  "bin": {
    "bw": "src/cli.ts",
    "buildworks": "src/cli.ts"
  }
}
```

The supported one-time local installation is
`npm install --global <absolute-BuildWorks-checkout>`. Registry publication,
self-update, packed-tarball installation, and GitHub distribution are not part
of this increment. npm links the global aliases to the complete checkout, so
that checkout must remain at its installed path. User-facing help names
`buildworks`; `bw` remains a compatible alias for advanced and existing
automation.

### Guided lifecycle

The command derives one of these actions without storing a second lifecycle:

| Observed state | Guided action |
| --- | --- |
| Target absent or empty | Preflight, scaffold `static-web`, validate, commit baseline, print the required design path, exit 0. |
| New scaffold, design absent | Print the required design path without modifying or recommitting anything, exit 0. |
| New scaffold, only design pending | Preview and confirm the exact design commit; then continue readiness and intake. |
| No run for the selected slug | Prompt for project, feature ID, change kind, and model; create and freeze one exact identity tuple through shared intake. |
| One persisted identity tuple for the selected slug | Reuse and display that tuple; if several tuples exist, prompt the operator to choose one exact displayed tuple. |
| Exactly one matching nonterminal run in `ready` | Call the existing guided execution path for the specification group after its paid preview and consent. |
| Matching run in `awaiting_approval`, no signature | Display the bound specification and payload, exclusively write the canonical payload handoff, print the expected signature path, and exit 3. |
| Matching run in `awaiting_approval`, signature present | Redisplay and recompute the binding, obtain explicit approval-submission confirmation, and submit the detached signature through `approveRun`. |
| Matching approved run | Display a new preview and obtain a new consent before plan through delivery. |
| One matching blocked or completed run and no nonterminal match | Report the terminal snapshot and do not mutate it. |
| Multiple matching nonterminal runs, multiple terminal-only matches, or inconsistent evidence | Refuse with identifiers and read-only inspection commands; do not choose or repair. |

The command may perform several rows of this table in one invocation, but it
must re-read authoritative state between them. It never holds a repository lock
while asking a question, reviewing a document, or displaying a cost preview.

For an existing repository, guided mode enumerates committed, nonempty
`docs/features/<slug>/design.md` inputs. Zero eligible designs refuses by name;
one selects that slug; several require the operator to select one displayed
slug. For a selected slug, run identity is the exact tuple of project, feature
ID, slug, and change kind. When no tuple exists, the command prompts for the
other three fields and validates all four through `validateRunIdentity`. When
one tuple exists, it reuses it. When several exist, it prompts only among the
persisted tuples and never synthesizes or selects the newest. Run-state
resolution then applies the nonterminal and terminal cardinality rules in the
table.

The approval handoff uses canonical payload and detached-signature files under
the selected run's ignored `.governance/approval-handoff/<run-id>/` directory.
Those files contain no private material. The CLI exclusively creates the
payload, refuses changed existing bytes, and never creates the signature file.
The external authority writes the signature through an operator-controlled
transport. The CLI reads the signature only after redisplaying the exact
binding and receiving approval-submission confirmation.

### Concrete `static-web` starter

The new-project path creates this exact starter without a template registry:

```text
.gitignore
README.md
governed.yaml
index.html
package.json
package-lock.json
src/app.js
test/starter.test.js
docs/features/<slug>/       # directory only until the operator adds design.md
```

`package.json` uses the normalized project slug as its package name, is private,
uses ESM, and defines `test` as `node --test`. The starter test loads the actual
generated HTML and source and proves the page entrypoint is present and the
module parses; it is scaffold-health evidence, not acceptance evidence for the
future product. `governed.yaml` freezes `npm ci` and `npm test`. Bootstrap runs
those exact commands before staging the named generated files.

### Interaction and exit behavior

- Prompts state the operation and affected path before accepting `yes`.
- EOF, Ctrl+C, or any response other than `yes` declines the current decision.
- No prompt is shown while a repository lock is held.
- Guided mode is interactive-only in this increment. Redirected input refuses
  before mutation or spend; low-level `run --yes --json` remains the automation
  surface.
- Exit 0 means the baseline was prepared, the command is waiting for
  `design.md`, or delivery completed.
- Exit 3 means the run remains at a valid approval boundary because the
  operator declined, cancelled, or has not supplied the external signature.
- Exit 1 means a named operational refusal, block, or execution failure.
- Exit 2 means invalid arguments.

## File map

| Path | Planned responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | Add the checkout-linked `buildworks` alias while preserving `bw`; do not define a packed-artifact contract. |
| `src/cli-args.ts` | Distinguish known low-level commands from no-argument/path-shaped guided entry without converting unknown command typos into directories. |
| `src/cli.ts` | Route guided mode before existing-repository-only resolution; delegate shared run creation; preserve every low-level command contract. |
| `src/project-bootstrap.ts` | Implement the one concrete `static-web` scaffold, prerequisite checks, exclusive writes, generated verification, exact staging, and baseline/design commit rules. |
| `src/run-intake.ts` | Hold the existing repository checks, run insertion, audit events, and profile freeze used by both `new-run` and guided mode. |
| `scripts/sign-approval.mjs` | Remain the unchanged advanced external signer; guided code never imports or invokes it. |
| `src/run-command.ts` | Accept an injected consent callback so one prompt owner can compose multiple paid ranges; retain existing stdin behavior for low-level `run`. |
| `src/guided-command.ts` | Derive scaffold/intake/exact-identity/run/approval-handoff/terminal actions from filesystem, Git, and authoritative run snapshots and orchestrate them without a second state model. |
| `src/operator-output.ts` | Format concise guided previews, approval binding details, and terminal handoffs without changing existing envelopes. |
| `test/project-bootstrap.test.ts` | Exercise generated starter behavior, exact file ownership, commits, refusal, and rerun cases. |
| `test/sign-approval.test.ts` | Preserve the external signer's current behavior and the invariant that no source file reads private-key material. |
| `test/guided-command.test.ts` | Exercise state derivation, prompt boundaries, exact-tuple run selection, external signature handoff, resume, and terminal output with local harness fixtures. |
| `test/cli-operator.test.ts`, `test/cli.test.ts`, `test/run-command.test.ts` | Preserve low-level CLI/parser behavior and verify the new top-level route and consent seam. |
| `test/package-entrypoint.test.ts` | Install the checkout link into a disposable prefix and invoke both executable aliases from outside the checkout. |
| `ARCHITECTURE.md` | Authorize guided bootstrap, one concrete starter, checkout-linked installation, exact operator-owned commits, exact prompted run identity, and external approval handoff while retaining one mutation authority. |
| `AGENTS.md`, `CLAUDE.md` | Replace stale checkout-only instructions while preserving external-only signing authority. |
| `README.md`, `docs/runbooks/cli-operator.md` | Make the one-command path primary and retain low-level commands as advanced/reference operations. |
| `.claude/skills/run-buildworks/SKILL.md` | Teach operational tooling to exercise the installed/guided free path without authorizing provider spend. |
| `.agents/skills/run-buildworks/SKILL.md` | Remain a forwarding entry; no duplicate workflow logic. |

## Tasks

### Task 1: Amend the binding architecture for the guided entrypoint

**Depends on:** None

**Files:**
- Modify: `ARCHITECTURE.md` — sections 3, 7, 12, 14, 17, 19, 23, and 24
- Modify: `AGENTS.md` — architecture summary and command guidance
- Modify: `CLAUDE.md` — architecture summary and command guidance
- Validate: `scripts/doc-check.mjs`

**Steps:**

- **Step 1: Record the operator authorization and preserved boundaries.**
  - Change: state that the CLI remains the only mutation authority, but now has
    a primary guided entrypoint that may initialize an empty local target,
    create only the concrete starter files, make exact operator-confirmed Git
    commits, and call the existing stage core. State that low-level commands
    remain one implementation beneath the same authority.
  - Verify: `npm run check:docs`
  - Expected: the architecture and its current-document projections agree about
    the new primary mutation path, with no stage or schema drift.

- **Step 2: Define the external-only signing boundary.**
  - Change: preserve Ed25519 binding, human review, explicit confirmation, no
    lock during deliberation, and complete private-key exclusion from the
    BuildWorks host's guided path, agents, and verification. Authorize the CLI
    to create canonical payload handoffs and import detached signatures only.
    State that the external authority must remain inaccessible to the
    verification process and that the supplied file signer is not a same-host
    containment mechanism.
  - Verify: `npm run check:docs`
  - Expected: the architecture and repository instructions preserve the rule
    that guided CLI and verification code never receive signing authority;
    README and runbook wording is completed in Task 9.

- **Step 3: Bound project creation.**
  - Change: remove local npm installation and one concrete static-web starter
    from the non-goals while retaining registry publication, self-update,
    target-stack adapter frameworks, GitHub integration, and arbitrary existing
    repository rewriting as non-goals.
  - Verify: `npm run typecheck`
  - Expected: documentation changes introduce no source-check regression.

**Task completion evidence:** Current design documents name the new authority,
its security limits, the one supported starter, and the explicit exclusions.

### Task 2: Link one installed command without breaking `bw`

**Depends on:** Task 1

**Files:**
- Modify: `package.json` — `bin` aliases
- Modify: `package-lock.json` — root package metadata
- Create: `test/package-entrypoint.test.ts`
- Modify: `test/cli-operator.test.ts` — help command inventory and display name

**Steps:**

- **Step 1: Add the installed alias for the checkout-link contract.**
  - Change: expose both `buildworks` and `bw` at `src/cli.ts`; retain
    `private: true`; do not add a `files` allowlist, package version, or packed
    artifact promise.
  - Verify: inspect the root entries in `package.json` and `package-lock.json`.
  - Expected: both bins point to the same source entrypoint and the manifest
    still describes a private checkout-linked tool.

- **Step 2: Prove the installed shape from outside the checkout.**
  - Change: install the absolute checkout path under a disposable global npm
    prefix, invoke the platform-specific `buildworks` and `bw` shims with
    `--help` from a non-repository directory, and assert that npm linked the
    installation to the complete checkout.
  - Verify: `node --test test/package-entrypoint.test.ts`
  - Expected: both aliases exit 0 from a non-repository cwd and help names
    `buildworks`; migrations and dashboard assets resolve through the retained
    checkout link.

- **Step 3: Preserve low-level automation.**
  - Change: update help expectations without changing existing subcommand
    options, outputs, JSON envelopes, or exit codes.
  - Verify: `node --test test/cli-operator.test.ts test/cli.test.ts`
  - Expected: all existing low-level command tests remain green and bare help
    remains read-only.

**Task completion evidence:** A disposable checkout-linked global installation
executes both aliases from outside the checkout and the existing command suite
remains compatible.

### Task 3: Add the external approval handoff without private-key access

**Depends on:** Task 1

**Files:**
- Create: `src/guided-command.ts`
- Create: `test/guided-command.test.ts`
- Modify: `test/sign-approval.test.ts`
- Validate: `scripts/sign-approval.mjs`

**Steps:**

- **Step 1: Preserve the private-key boundary.**
  - Change: retain the recursive assertion that no file under `src/` loads,
    generates, names, or invokes private-key material. Leave
    `scripts/sign-approval.mjs` unchanged and outside the guided call graph.
  - Verify: `node --test test/sign-approval.test.ts`
  - Expected: the legacy signer retains its byte behavior and no guided source
    can read or invoke a private key.

- **Step 2: Create canonical public handoff files.**
  - Change: at `awaiting_approval`, build the prospective binding with one
    expiry, exclusively write the canonical payload to
    `.governance/approval-handoff/<run-id>/payload.txt`, and reserve
    `signature.txt` as the operator-provided detached-signature path. Reuse an
    existing payload only when its bytes match exactly; refuse changed bytes,
    an existing non-file path, or a signature that is empty or invalid UTF-8.
  - Verify: `node --test test/guided-command.test.ts test/approval-stage.test.ts`
  - Expected: payload bytes equal `approvalPayload(buildBinding(...).binding)`,
    no private material exists in the handoff, and no approval mutation occurs.

- **Step 3: Prove the default secret is absent from verification.**
  - Change: run an implementer-authored fixture verification command that tries
    to read `%USERPROFILE%\.buildworks\approval.key` and require the actual
    read to fail because guided mode never creates it. Assert separately that
    source, prompts, handoff files, and executor/verification environment maps
    contain no alternate private-key path.
  - Verify: `node --test test/guided-command.test.ts test/sign-approval.test.ts test/verify-command.test.ts test/harness.test.ts`
  - Expected: the process-level read fails and guided behavior exposes only
    public-key, payload, and detached-signature material. The test does not
    claim to detect a private key the operator placed elsewhere.

**Task completion evidence:** Guided mode never creates or opens signing
authority, canonical public handoff bytes round-trip through the unchanged
approval gate, and verification cannot read a guided-created default key
because none exists.

### Task 4: Build the concrete static-web project bootstrap

**Depends on:** Tasks 1 and 2

**Files:**
- Create: `src/project-bootstrap.ts`
- Create: `test/project-bootstrap.test.ts`
- Modify: `src/repo-root.ts` — expose pre-repository target resolution without weakening existing worktree resolution
- Modify: `src/readiness.ts` — reuse prerequisite evidence without requiring HEAD during preflight

**Steps:**

- **Step 1: Define preflight and target classification.**
  - Change: canonicalize an absent or existing directory without first requiring
    Git; distinguish absent, empty, supported bootstrapped Git worktree, ready
    existing Git worktree, and refused nonempty non-Git/mismatched partial
    target. Probe Node, npm, Git, Claude, and Git identity before writing project
    content. Prompt for repo-local name/email only when commit identity is
    absent; initialize Git metadata before applying that local identity but
    never mutate global Git configuration. Do not inspect, create, or modify
    private signing material during project bootstrap.
  - Verify: `node --test test/project-bootstrap.test.ts`
  - Expected: invalid tools/identity/targets fail before starter files, Git
    history, or governance state are created.

- **Step 2: Generate exactly one starter.**
  - Change: implement a concrete `static-web` file map for `.gitignore`,
    `README.md`, `governed.yaml`, `index.html`, `package.json`, `src/app.js`, and
    `test/starter.test.js`. Normalize the directory name to a valid npm/project
    slug, present `static-web` as the single supported project-type choice, and
    validate the prompted feature slug with `validateRunIdentity`.
    Create `docs/features/<slug>/` but no requirements content.
  - Verify: run `npm ci` and `npm test` inside each generated disposable target
    from `test/project-bootstrap.test.ts`.
  - Expected: the actual generated project installs without dependency drift,
    executes at least one discovered test, and `parseGovernedConfig` returns the
    two exact commands that passed.

- **Step 3: Commit only owned files.**
  - Change: initialize Git only after preflight, use exclusive file creation,
    stage the closed generated-path set instead of `git add .`, show the staged
    diff, obtain confirmation outside any lock, and commit with a fixed
    bootstrap message. On an interrupted rerun, accept only matching generated
    bytes and complete missing owned outputs; refuse mismatches and every
    unrelated path.
  - Verify: `node --test test/project-bootstrap.test.ts`
  - Expected: the baseline commit contains exactly the generated files,
    `.governance/` and `node_modules/` are ignored, the worktree is clean, and
    decline/collision/failure cases retain user bytes without reset or deletion.

- **Step 4: Stop at the design boundary.**
  - Change: after a successful baseline, print the exact absolute and
    repository-relative `design.md` path and exit 0. On rerun with no design,
    print the same instruction and perform no write or commit.
  - Verify: `node --test test/project-bootstrap.test.ts`
  - Expected: product requirements remain wholly operator-authored and repeated
    invocation is idempotent.

**Task completion evidence:** A disposable empty target becomes a committed,
clean, passing static-web starter, while every collision and partial state is
non-destructive and diagnosable.

### Task 5: Share run intake and commit the exact operator design

**Depends on:** Task 4

**Files:**
- Create: `src/run-intake.ts`
- Create: `test/run-intake.test.ts`
- Modify: `src/cli.ts` — delegate the `new-run` case
- Modify: `test/cli.test.ts` — prove unchanged low-level behavior
- Modify: `src/project-bootstrap.ts` — design discovery and exact commit
- Modify: `test/project-bootstrap.test.ts`

**Steps:**

- **Step 1: Extract the existing run-creation transaction.**
  - Change: move `checkIntakeRepository`, run insertion, `run.create` audit,
    profile freeze, profile-ref write, and blocked-freeze audit/status handling
    into one function receiving explicit project, feature, slug, change kind,
    and model. Keep lock/store ownership with callers and preserve the current
    numeric stdout/error behavior in `new-run`.
  - Verify: `node --test test/run-intake.test.ts test/cli.test.ts`
  - Expected: low-level `new-run` produces the same run rows, audit events,
    profile hash, output, and freeze-failure block as before.

- **Step 2: Commit only `design.md`.**
  - Change: for a new scaffold's already selected slug, require nonempty UTF-8
    content, refuse every other dirty path, display the design diff, and
    stage/commit only `docs/features/<slug>/design.md` after confirmation.
    Never convert DOCX, infer requirements from another file, or stage adjacent
    documents.
  - Verify: `node --test test/project-bootstrap.test.ts`
  - Expected: accepted input creates one exact commit and a clean tree; empty,
    unreadable, declined, or accompanied input leaves Git history unchanged.

- **Step 3: Select one design and obtain the complete run identity.**
  - Change: for an existing repository, enumerate committed, nonempty
    `docs/features/<slug>/design.md` files. Select the only eligible design or
    prompt among the displayed slugs when several exist; refuse zero eligible
    designs or an unlisted response. A new scaffold retains its confirmed slug
    after Task 5 Step 2 commits that design. Query persisted runs for the
    selected slug. Reuse one distinct project/feature
    ID/slug/change-kind tuple, prompt among several persisted tuples, or, when
    none exists, prompt for project, feature ID, and change kind with the
    repository basename, slug, and `feature` displayed only as editable
    defaults. Validate through `validateRunIdentity`; never silently accept a
    default.
  - Verify: `node --test test/run-intake.test.ts test/project-bootstrap.test.ts`
  - Expected: every created run has operator-confirmed values for all four
    identity fields, and reruns select an exact persisted tuple without
    inventing or normalizing signed identity.

- **Step 4: Preserve existing ready repositories.**
  - Change: if the target already has HEAD, a clean tree, committed valid
    `governed.yaml`, at least one committed design, and no scaffold marker
    requirement, enter guided intake without changing baseline files and apply
    the same explicit design/identity selection rules.
  - Verify: `node --test test/project-bootstrap.test.ts test/cli-operator.test.ts`
  - Expected: an existing compliant repository and a newly generated starter
    reach identical `checkIntakeRepository` and `inspectReadiness` outcomes.

**Task completion evidence:** Both low-level and guided callers create identical
frozen runs from complete explicit identities, and the only operator-authored
file the bootstrap flow commits is the selected design.

### Task 6: Implement state-aware guided continuation

**Depends on:** Tasks 3 and 5

**Files:**
- Modify: `src/guided-command.ts`
- Modify: `test/guided-command.test.ts`
- Modify: `src/run-command.ts` — injectable consent callback
- Modify: `test/run-command.test.ts`
- Modify: `src/operator-state.ts` — add only a pure feature-run selection helper if direct filtering would duplicate state rules

**Steps:**

- **Step 1: Give the composed journey one prompt owner.**
  - Change: allow `advanceRun` to receive an optional asynchronous consent
    callback while preserving its current stdin/TTY/`--yes` paths. The callback
    receives the already formatted frozen preview and returns only the current
    decision; it cannot alter groups, profile, or observation.
  - Verify: `node --test test/run-command.test.ts`
  - Expected: existing consent, cancellation, redirected-input, lock, and
    observation-change tests remain unchanged; injected consent is asked with
    no lock and cannot authorize a later range.

- **Step 2: Derive the selected feature and run.**
  - Change: use Task 5's selected design and exact identity tuple. Filter
    authoritative run rows by project, feature ID, slug, and change kind.
    Resume exactly one nonterminal match even when older terminal matches
    exist. Create a run only when no exact match exists. With no nonterminal
    match, report exactly one terminal match and refuse multiple terminal
    matches. Refuse multiple nonterminal matches rather than selecting the
    newest.
  - Verify: `node --test test/guided-command.test.ts`
  - Expected: no happy path asks for or exposes a run ID, while ambiguity names
    the complete tuples and IDs needed for advanced inspection. Tests cover
    zero, one, and several eligible designs; zero, one, and several persisted
    tuples; and every terminal/nonterminal cardinality.

- **Step 3: Orchestrate through the approval boundary.**
  - Change: call `advanceRun` for the current paid range. On
    `awaiting_approval`, open a read-only snapshot, build the prospective
    binding with the policy default expiry, print the spec path and every
    canonical binding field, and write Task 3's canonical payload handoff. With
    no signature file, print the payload and expected signature paths and exit
    3. With a signature file, redisplay the binding and ask for explicit
    approval submission. Only after confirmation acquire the repository lock,
    recompute the binding, require exact payload/expiry equality, and call
    `approveRun` with the detached signature. A changed binding produces the
    existing verification refusal.
  - Verify: `node --test test/guided-command.test.ts test/approval-stage.test.ts test/sign-approval.test.ts`
  - Expected: no private key or key path enters source or process state; no lock
    is held during review; approval uses the same expiry and payload; missing,
    declined, malformed, or changed handoffs return a resumable approval pause
    with no approval row.

- **Step 4: Continue with fresh paid consent.**
  - Change: after approval, call `advanceRun` again through a distinct consent
    callback. Stop on the first refusal/failure/block and never loop back to a
    failed group. On completion, format the retained branch, worktree, commit,
    cost, evidence, and final findings from the snapshot.
  - Verify: `node --test test/guided-command.test.ts`
  - Expected: the fixture-backed chain completes across the external-signature
    pause, with two separate paid confirmations and one separate approval
    submission confirmation; cancellation at any boundary resumes correctly
    on the next invocation.

**Task completion evidence:** Fixture-backed journeys cover new run, approval
pause, approved continuation, blocked execution, completed execution,
interruption, ambiguous identities/runs, and repeated invocations without
duplicate work.

### Task 7: Route bare and path-form invocations into guided mode

**Depends on:** Tasks 2, 4, and 6

**Files:**
- Modify: `src/cli-args.ts`
- Modify: `src/cli.ts`
- Modify: `src/operator-output.ts`
- Modify: `test/cli-operator.test.ts`
- Modify: `test/cli.test.ts`

**Steps:**

- **Step 1: Add an unambiguous entry parser.**
  - Change: route no arguments to guided mode in the current directory and one
    absolute, dot, dot-dot, or separator-prefixed path to guided mode at that
    target. Continue routing known command names through `COMMANDS`; reject an
    unknown bare word as a command typo. Keep all help forms read-only and add
    a primary guided synopsis before the advanced command inventory.
  - Verify: `node --test test/cli-operator.test.ts test/cli.test.ts`
  - Expected: both required forms select guided mode, `buildworks typo` remains
    a usage error, and no help invocation creates a directory, state, or lock.

- **Step 2: Route before repository-only resolution.**
  - Change: invoke `guided-command` before `resolveRepositoryRoot`, because the
    target may not exist yet. Leave dashboard and all low-level routes in their
    current order and preserve their envelopes and raw outputs.
  - Verify: `node --test test/cli-operator.test.ts`
  - Expected: new-target setup succeeds while existing missing-target low-level
    commands still return `target_unavailable`.

- **Step 3: Present concise outcomes.**
  - Change: print a numbered current step, completed setup actions, exact
    design path, each consent boundary, and terminal handoff. Do not print raw
    private material, private-key paths, full state JSON, or low-level
    governance command recipes on the happy path; at approval print only the
    public payload/signature handoff paths and external-authority instruction.
    Include advanced inspection commands only on refusal.
  - Verify: `node --test test/guided-command.test.ts test/cli-operator.test.ts`
  - Expected: golden assertions cover the first invocation, design wait,
    ready run, approval, completion, and refusal text without hiding reasons.

**Task completion evidence:** The installed CLI accepts both requested entry
forms and drives the guided state machine while every advanced command remains
available.

### Task 8: Prove safety and end-to-end behavior without provider spend

**Depends on:** Tasks 3-7

**Files:**
- Modify: `test/fixtures/harness/emit-cli-run.mjs` only if the existing recorded/schema-valid route lacks a required deterministic response
- Modify: `test/guided-command.test.ts`
- Modify: `test/cli-operator.test.ts`
- Validate: `.claude/skills/run-buildworks/driver.mjs`

**Steps:**

- **Step 1: Run the complete local fixture journey.**
  - Change: drive project creation, design commit, run creation, specification,
    external-signature approval, planning, implementation, verification, code
    review, and delivery through the guided command using the existing
    schema-validated harness fixture and detached fixture signature. In
    subprocess coverage, let the installed command create the run, decline its
    first paid prompt, replace only that disposable run's frozen executor
    command and corresponding profile hash with the established fixture helper,
    then rerun the installed command; do not add a production executor override.
    Do not hand-author a new model response unless it is validated by the same
    production parser and schema.
  - Verify: `node --test test/guided-command.test.ts`
  - Expected: the run completes with the exact stage sequence, two paid-range
    consent decisions, one externally signed approval, a passing audit chain,
    and no real provider invocation.

- **Step 2: Exercise refusal and containment boundaries.**
  - Change: cover nonempty non-Git targets, existing-file collisions, dirty
    repositories, extra untracked files, zero/several designs, invalid prompted
    identities, multiple persisted identity tuples, every terminal/nonterminal
    match cardinality, missing/mismatched public keys, missing/malformed/changed
    signature handoffs, non-TTY input, declined prompts, changed approval
    binding, stale/tampered evidence, writer contention, blocked runs, and
    completed reruns. Execute a fixture verification command that attempts to
    read the former default private-key path and assert the actual read fails.
  - Verify: `node --test test/project-bootstrap.test.ts test/guided-command.test.ts test/cli-operator.test.ts test/sign-approval.test.ts test/verify-command.test.ts`
  - Expected: every case names the refusal, performs no unauthorized next
    mutation, never exposes a private-key path, and never retries a failed stage.

- **Step 3: Prove high-value guards by mutation.**
  - Change: in an isolated mirror, break in turn the exclusive-create flag,
    exact staged-path allowlist, source private-key exclusion, complete identity
    match, payload byte comparison, post-preview binding comparison, distinct
    later-range consent, and failed group stop condition; run the named focused
    test for each and restore exact bytes.
  - Verify: record each mutation, failing test name, restored hash, and passing
    rerun in the implementation session artifact.
  - Expected: every guard has demonstrated directionality rather than merely a
    passing assertion.

- **Step 4: Keep the canonical free smoke valid.**
  - Change: update only command-name/help assumptions required by the installed
    alias; do not make the existing `smoke` path use the paid provider.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs smoke`
  - Expected: all smoke steps pass with zero dispatches and zero provider spend.

**Task completion evidence:** A no-spend end-to-end guided fixture completes,
all refusal classes preserve state, mutation records prove the guards, and the
canonical smoke remains free.

### Task 9: Replace the manual onboarding documentation

**Depends on:** Tasks 2-8

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/cli-operator.md`
- Modify: `.claude/skills/run-buildworks/SKILL.md`
- Validate: `scripts/doc-check.mjs`

**Steps:**

- **Step 1: Make the guided journey primary.**
  - Change: lead with one-time local installation, `buildworks <path>`, the
    exact `design.md` handoff, and rerunning `buildworks`. Separate one-time
    machine prerequisites, one-time project bootstrap, and per-feature
    decisions. State that BuildWorks handles Git initialization, starter files,
    verification configuration, exact run discovery, approval payload/signature
    transport, and approval submission, while an authority inaccessible to the
    BuildWorks host owns signing.
  - Verify: `npm run check:docs`
  - Expected: a new user can identify the primary BuildWorks command, the only
    repository file they must author, and the separate external signing action
    without reading low-level sections.

- **Step 2: Retain advanced operations as reference.**
  - Change: move current `doctor`, `new-run`, approval transport, `run`,
    inspection, and troubleshooting instructions under an advanced/manual
    section. Preserve their exact contracts and state that GitHub integration
    remains separate.
  - Verify: `npm run check:docs`
  - Expected: low-level operators retain complete recovery and diagnostic
    information without making it the onboarding path.

- **Step 3: Update the operational skill.**
  - Change: add a free guided-bootstrap smoke procedure and installed-command
    check to the canonical skill; keep paid execution behind explicit
    authorization and keep `.agents/skills/run-buildworks/SKILL.md` as a
    forwarding entry only.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs smoke`
  - Expected: automation instructions exercise the new default without
    implying paid consent or duplicating the canonical workflow.

**Task completion evidence:** Current documentation presents one primary
command and one authored design file, while advanced contracts remain accurate.

### Task 10: Run the repository completion gate

**Depends on:** Tasks 1-9

**Files:**
- Validate: all changed source, tests, package metadata, and current documents

**Steps:**

- **Step 1: Run focused checks together.**
  - Verify: `node --test test/package-entrypoint.test.ts test/project-bootstrap.test.ts test/guided-command.test.ts test/run-intake.test.ts test/run-command.test.ts test/cli-operator.test.ts test/cli.test.ts test/sign-approval.test.ts test/approval-stage.test.ts test/verify-command.test.ts test/harness.test.ts`
  - Expected: checkout-link installation, bootstrap, exact identity, external
    approval handoff, orchestration, compatibility, and harness tests pass.

- **Step 2: Run full static and runtime validation.**
  - Verify: `npm run typecheck`
  - Expected: both TypeScript programs pass strict checking.
  - Verify: `npm test`
  - Expected: the complete existing suite and new guided-flow coverage pass.
  - Verify: `npm run check:docs`
  - Expected: architecture, current documents, paths, hazards, and task-artifact
    rules are consistent.
  - Verify: `git --no-pager diff --check`
  - Expected: no new whitespace errors are introduced.

- **Step 3: Verify the installed user journey in a disposable target.**
  - Change: globally install the absolute checkout path into a disposable npm
    prefix, invoke `buildworks <new-target>` from outside the checkout, add a
    test design, rerun the installed command to prompt for the complete identity
    and decline before dispatch, bind that disposable run to the established
    local fixture executor using the same test-only profile rewrite already
    used by `test/run-command.test.ts`, complete the external signature-file
    handoff, rerun the installed command, and inspect the resulting branch,
    worktree, audit chain, and linked runtime assets. Do not add a production
    executor switch and do not invoke the real provider.
  - Verify: compare the observed files, Git commits, prompts, run phase, stage
    sequence, and delivery references with GBP-AC-01 through GBP-AC-15.
  - Expected: the user performs one checkout-linked installation, uses one
    guided BuildWorks command, authors `design.md`, supplies the prompted run
    identity, completes one external signing action, and reruns the same
    BuildWorks command; all other setup and orchestration is internal and
    observable.

**Task completion evidence:** Focused and full checks pass, both checkout-linked
aliases work from outside the checkout, the disposable guided journey satisfies
every acceptance criterion without provider spend, and no unrelated file
changes remain.

## Self-review reconciliation

One complete self-review was performed against the confirmed operator choices,
`ARCHITECTURE.md`, `docs/hazards.md`, and the relevant CLI, runner, readiness,
approval, signing, installation, and test surfaces. Five material findings were
reconciled:

1. **Guided key setup crossed the private-key authority boundary.** The plan
   now preserves the external signer, creates no default private key, and gives
   guided mode only canonical payload export and detached-signature import.
2. **The path grammar was Windows-only despite the package's supported
   platforms.** The command contract now accepts explicit POSIX relative paths
   as well as Windows and platform-native absolute paths.
3. **Task 1 claimed all current documents were updated before the documentation
   task ran.** Its expected result now covers architecture and repository
   instructions, with README/runbook completion assigned to Task 9.
4. **The end-to-end fixture path did not explain how an installed command could
   avoid the fixed real Claude executor.** Tasks 8 and 10 now use the existing
   test-only frozen-profile rewrite after declining the first paid prompt and
   expressly forbid a production executor override.
5. **The hazard statement overstated what a generated starter test proves.**
   It now requires real test discovery while preserving the explicit limitation
   that starter health is not evidence of final product correctness.

## Implementation note

Implemented on branch `guided-project-bootstrap` on 2026-09-13. All ten tasks
shipped: checkout-linked `buildworks` and `bw` aliases, the concrete
`static-web` initializer, exact design and run identity selection, shared run
intake, state-aware continuation, separate paid-range consent, external
payload/detached-signature approval, terminal handoff, guided-first operator
documentation, and no-spend end-to-end coverage.

The completed implementation also incorporates every independent code-review
finding: locked exact-tuple intake, resumable atomic expiry rotation, Git-native
CRLF-safe starter comparison, complete terminal reasons/finding attribution,
and strict retained-expiry validation. The reconciled review is
`docs/features/guided-project-bootstrap/2026-09-13-code-review.md`.

Verification passed 1,173 tests with 5 skips, strict TypeScript checking,
documentation checking, diff checking, both checkout-linked aliases from
outside the checkout, the 13-step free operational smoke, and a complete
fixture-backed run through delivery with USD 0 recorded cost.

**Deviation:** Automated validation composes real installed-shim execution with
the exported guided function using injected prompts because production guided
mode intentionally refuses redirected stdin before mutation or spend. No
production executor override was added. No provider command, paid dispatch,
GitHub mutation, commit, or deployment was performed.

**Deferred:** Registry publication, self-update, additional starters or a
starter abstraction, GitHub integration, automated recovery of partial stage
chains, and every architecture stage still explicitly deferred remain outside
this plan.
