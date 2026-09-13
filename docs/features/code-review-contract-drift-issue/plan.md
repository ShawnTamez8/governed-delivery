# Code Review Contract-Drift Issue Publication Implementation Plan

**Status:** Proposed

**Goal:** Let an operator classify one adjacent-round code-review remediation conflict, preview its exact sanitized GitHub Issue, and explicitly publish and project that issue without reopening the blocked run or weakening delivery refusal.

**Source:** `docs/proposals/2026-09-11-code-review-remediation-contract-drift-review.md`, the reviewed incident analysis in `docs/proposals/code-review-remediation-contract-drift.md`, the outbound-integration controls in `docs/proposals/github-project-projection-and-upstream-spikes.md` and its reconciled review, and the operator decisions recorded during planning on 2026-09-11: publication is a separate preview-plus-`--yes` post-run action; the operator selects the conflicting evidence; the run remains `blocked`; each governed repository uses its own committed and frozen GitHub repository/Project mapping; and live discovery uses a separately authorized throwaway target.

**Hazards considered:** Hazard 2 requires the selected finding, criterion, commit transition, reproduction, and publication result to remain queryable after the command exits. Hazard 4 requires sanitized recorded GitHub responses, not invented fixtures, to define the external response contract. Hazard 5 requires the new action to leave `code_review` blocked and `delivery_check` unavailable. Hazard 7 requires a deterministic issue marker, durable local intent before remote mutation, and an explicit ambiguous-create recovery path that never automatically recreates an issue. Hazard 11 requires repositories without GitHub configuration to retain the current local-only path. Hazard 12 requires the remote owner, repository, Project, field, option, label, and size limit to be visible committed configuration frozen at run creation. Hazard 13 prevents this plan from inventing a general tracker adapter, issue lifecycle, waiver, or delivery obligation. Hazard 16 leaves causal classification with the operator because model-authored `intentKey` values do not prove cross-round identity. Hazard 18 requires issue creation and Project projection to remain follow-up evidence only, never proof that delivery is safe.

**Assumptions:** The first implementation targets GitHub Issues and one GitHub Projects V2 single-select status field directly; it does not introduce a generic work-tracker abstraction. A short-lived GitHub App installation token is supplied only through the fixed `BW_GITHUB_TOKEN` environment variable at confirmed-command time. The configured `buildworks-contract-drift` label and Project field/option already exist; BuildWorks validates but does not create or rename them. Adding `github: null | GitHubTarget` to the frozen profile intentionally makes profiles created under the previous schema inspectable but non-executable under the exact-current-profile rule. The GitHub REST API version is pinned in code and changed only with recorded-contract evidence.

**Approach:** Add one post-run command, `github-publish-contract-drift`, outside the stage sequencer. Invoking it is the operator's explicit assertion that the approved criterion remains authoritative and the selected adjacent-round conflict is a remediation-caused code defect; if the criterion instead needs revision, the operator does not invoke this command and uses the existing human product-decision path outside BuildWorks. The operator supplies an earlier-round finding, the immediately following final blocking finding, an approved criterion, and a bounded reproduction file. Without `--yes`, the command performs no local or remote writes and returns the exact target, title, body, marker, and planned mutations. With `--yes`, it atomically records the immutable classification, publication intent, and audit event before calling GitHub, creates one labeled repository issue, adds it to the frozen Project, and sets the frozen blocked-status option through resumable persisted steps. A strict parser shared with operator status validates the blocked code-review record. Remote issue identity is derived from the run, selected finding pair, criterion, and frozen target; ambiguous issue creation can only be reconciled to an operator-selected issue whose body contains that exact marker.

**Affected areas:** Binding architecture and reconciled proposal records; committed `governed.yaml` parsing and frozen profiles; readiness output; SQLite schema and store methods; strict blocked-code-review parsing; issue rendering and GitHub REST/GraphQL transport; CLI parsing, routing, locking, consent, output, and status projection; audit events and `.governance` paths; operator documentation; deterministic, migration, transport, CLI, and recorded-response tests.

**Known blockers:** [Verified] `.claude/sessions/project-learnings.md` and `docs/proposals/2026-09-09-github-project-projection-and-upstream-spikes-review.md` record that the production GitHub owner/repository, GitHub App ownership and permissions, Project node ID, live field/option IDs, and sanctioned label have not been discovered. Task 9 therefore requires separately authorized read-only discovery and one explicitly authorized synthetic issue in a throwaway repository/Project before the feature can be marked implemented. No existing authorization permits that remote mutation or any paid provider run.

**Blast radius:** [Verified] `parseGovernedConfig` is consumed by `src/readiness.ts` and tested directly by `test/governed-config.test.ts`; `checkIntakeRepository` is consumed by `src/cli.ts`, `src/operator-state.ts`, and readiness/CLI tests. [Verified] `freezeProfile`, `invalidProfileReason`, and `loadVerifiedProfile` in `src/profile.ts` define the persisted profile boundary used by stage commands and the guided runner, so the new nullable target must be present in every newly frozen profile while absent configuration still freezes as `null`. [Verified] `runCodeReviewStage` writes the blocked review record and final blocking finding through `Store`, while `runDeliveryStage` independently requires a passed `code_review`; the publisher must read those records and must not call either stage transition. [Verified] command identity and options are centralized in `src/cli-args.ts`, routing and repository locks in `src/cli.ts`, structured envelopes in `src/operator-output.ts`, and terminal-run actions in `src/operator-state.ts`. [Verified] persisted tables are jointly defined by `src/migrations/*.sql`, `src/store.ts`, the architecture schema fence, and `scripts/doc-check.mjs` pins. [Verified] `README.md`, `docs/runbooks/cli-operator.md`, `CLAUDE.md`, and `AGENTS.md` currently state that BuildWorks does not publish to GitHub, so all four must distinguish the new separately authorized post-run action from stage execution and delivery.

**Verification:** Use focused Node tests per task, then `npm run typecheck`, `npm test`, and `npm run check:docs`. Prove the preview is read-only by snapshotting SQLite bytes, audit count, repository status, and absence of network calls before and after it. Prove the gate boundary by asserting the run remains blocked, no delivery stage is added, and delivery still refuses after successful publication. Prove external decoding first with synthetic transport tests, then with sanitized responses recorded during the separately authorized throwaway GitHub proof. No paid model run or production GitHub mutation is part of local verification.

---

## Tasks

### Task 1: Reconcile the governing decision and authorize only the post-run boundary

**Depends on:** None

**Files:**
- Modify: `docs/proposals/code-review-remediation-contract-drift.md` - recommendation and operator decision
- Modify: `docs/proposals/2026-09-11-code-review-remediation-contract-drift-review.md` - reconciliation block and status
- Modify: `ARCHITECTURE.md` - code-review boundary, post-run operator action, schema, configuration, credentials, and blocked-run invariants
- Modify: `CLAUDE.md` - binding code-review operating contract and command inventory
- Modify: `AGENTS.md` - mirrored binding code-review operating contract and command inventory

**Steps:**

- **Step 1: Preserve the incident analysis while recording the superseding operator decision**
  - Change: Amend the proposal's recommendation to distinguish forbidden automatic stage publication from the authorized explicit post-run command. Record that the operator, not finding identity or `intentKey`, selects one earlier finding, its immediately following final blocking finding, the approved criterion, and reproduction evidence. Keep the original blocked-run evidence and delivery refusal unchanged.
  - Verify: `npm run check:docs`
  - Expected: The proposal no longer asks the implementer to choose between operator follow-up and GitHub publication, and its hazards line remains substantive.

- **Step 2: Reconcile every open review finding without rewriting review evidence**
  - Change: Append a reconciliation section to the review that disposes the high finding with the separate explicit command and non-delivery invariant, the medium finding with the exact adjacent-round trigger and one-issue-per-classification identity, and the low finding with Task 9's authorized live discovery. Change the review status to `reconciled` only after all dispositions are final.
  - Verify: `npm run check:docs`
  - Expected: The original findings remain intact, every finding has a final disposition, and no review blocker remains open.

- **Step 3: Amend the binding architecture before changing runtime behavior**
  - Change: Specify that `code_review` itself still creates no issue and that `delivery_check` still requires a passed review. Add the separate blocked-run classification/publication command, the optional frozen GitHub target, the two new tables from Task 3, the `BW_GITHUB_TOKEN` credential boundary, the preview/consent rule, audit events, deterministic marker, and ambiguous-create recovery. Explicitly exclude automatic publication, generic trackers, issue closure, approval, run resume, and delivery authorization.
  - Verify: `npm run check:docs`
  - Expected: Architecture, schema fence, instruction files, and reconciled source all authorize the same narrow post-run behavior.

**Task completion evidence:** The source review is reconciled, the architecture is unambiguous about stage and delivery invariants, and the repository instructions name the new command without implying broader GitHub automation.

### Task 2: Add optional committed GitHub target configuration and freeze it per run

**Depends on:** Task 1

**Files:**
- Modify: `src/governed-config.ts` - `GitHubTargetConfig`, `GovernedConfig`, and strict parser
- Modify: `src/readiness.ts` - intake result and optional-integration diagnostics
- Modify: `src/profile.ts` - frozen `github` field, canonical serialization, and exact-current validation
- Modify: `src/cli.ts` - `new-run` profile construction and readiness presentation inputs
- Modify: `src/operator-output.ts` - readable and JSON readiness/profile projection
- Modify: `test/governed-config.test.ts`
- Modify: `test/profile.test.ts`
- Modify: `test/cli.test.ts`
- Modify: `test/cli-operator.test.ts`

**Steps:**

- **Step 1: Define one strict optional configuration shape**
  - Change: Extend the committed parser to return `GovernedConfig { commands, github }`, where `github` is either `null` when the top-level block is absent or exactly `{ owner, repository, projectNodeId, statusFieldNodeId, blockedStatusOptionId, issueLabel, maxIssueBodyBytes }`. Require non-empty scalar strings, require `issueLabel` to equal `buildworks-contract-drift` for this concrete implementation, and require `maxIssueBodyBytes` to be an integer from 1,024 through 65,536. Reject unknown keys, partial blocks, duplicate keys, extra nesting, credentials, URLs, and Git-remote-derived defaults with line-specific errors.
  - Verify: `node --test test/governed-config.test.ts`
  - Expected: Verify-only files parse with `github: null`; one complete block parses; every omitted, duplicate, malformed, secret-like, and unknown field case refuses deterministically.

- **Step 2: Freeze the complete target without freezing credentials**
  - Change: Add mandatory `github: GitHubTargetConfig | null` to the current profile serialization and validation. Pass the intake value through `new-run`; keep `BW_GITHUB_TOKEN` out of configuration, profiles, hashes, audit summaries, and output. Update profile fixtures and canonical-hash assertions so old profiles missing `github` produce the existing explicit superseded-profile refusal rather than compatibility/defaulting behavior.
  - Verify: `node --test test/profile.test.ts test/cli.test.ts`
  - Expected: New runs freeze either `null` or the exact committed target, target edits after run creation do not change the run, and pre-change profile JSON cannot execute as current.

- **Step 3: Keep local-only readiness usable**
  - Change: Show GitHub publication as disabled when the block is absent and show the committed target and frozen target separately when present. Do not probe GitHub, require a token, or fail ordinary readiness/run creation solely because the optional block is absent.
  - Verify: `node --test test/cli-operator.test.ts test/operator-state.test.ts`
  - Expected: Existing local-only fixtures remain ready, configured fixtures expose non-secret target identity, and no readiness path reads `BW_GITHUB_TOKEN` or makes a network request.

**Task completion evidence:** A new run has one exact frozen `github` value, repositories without the block behave as before, and neither secrets nor Git remotes participate in target selection.

### Task 3: Persist immutable classification and resumable publication state

**Depends on:** Task 1

**Files:**
- Create: `src/migrations/007_code_review_follow_up.sql`
- Modify: `src/store.ts` - row types, inserts, transitions, and queries
- Modify: `ARCHITECTURE.md` - schema fence added in Task 1
- Modify: `scripts/doc-check.mjs` - pinned tables and constraints
- Modify: `test/migrate.test.ts`
- Modify: `test/store.test.ts`

**Steps:**

- **Step 1: Add one table per persisted concept**
  - Change: Add `code_review_follow_up` with immutable run/stage/finding/criterion/commit/reproduction identity and a unique deterministic classification key. Add `github_issue_publication` with one row per follow-up, the frozen target hash, marker, rendered title/body hash, state constrained to `intent | create_ambiguous | issue_created | project_added | published`, remote issue/project identifiers, timestamps, and bounded `last_error_kind`/`last_error_summary` diagnostics. A definitive refusal leaves the row at its current resumable state and updates diagnostics instead of inventing a terminal failure state; only an uncertain create response moves to `create_ambiguous`. Foreign keys must bind the selected findings to the same run and review stage through store validation before insertion; a unique follow-up relation prevents duplicate publication for one classified final finding.
  - Verify: `node --test test/migrate.test.ts`
  - Expected: A fresh database reaches schema version 7 with both tables and constraints; migration from version 6 preserves existing records; rerunning migration is idempotent.

- **Step 2: Implement atomic local transitions before remote side effects**
  - Change: Add store methods that create the classification, publication intent, retained reproduction digest, and bounded audit event in one transaction; retrieve by classification key or marker; and advance only the allowed state sequence. Require compare-and-set source states, preserve remote identifiers once learned, and reject target/body hash drift, skipped steps, duplicate final-finding classification, and publication rows without the immutable follow-up. Each response-backed remote transition and its audit event must commit together after the response is strictly decoded; a failed local commit leaves the remote step recoverable from its marker or already persisted remote ID.
  - Verify: `node --test test/store.test.ts`
  - Expected: Concurrent or repeated requests return the same logical row, illegal transitions fail without partial writes, and an interrupted operation resumes from the last committed step.

- **Step 3: Keep schema documentation and checker pins synchronized**
  - Change: Add both tables and their key constraints to the architecture schema fence and update `PINNED_TABLES` and `PINNED_TABLE_CONSTRAINTS` as tripwires. Do not relax unrelated pins.
  - Verify: `npm run check:docs`
  - Expected: The migration, architecture, store model, and checker enumerate the same schema version and constraints.

**Task completion evidence:** Migration and store tests prove one immutable classification, one deduplicated publication intent, and monotonic resumable remote state.

### Task 4: Validate the operator classification and render a safe deterministic issue

**Depends on:** Tasks 2 and 3

**Files:**
- Create: `src/code-review-follow-up.ts`
- Modify: `src/code-review.ts` - exported strict blocked-record parser and shared record invariants
- Modify: `src/operator-state.ts` - consume the shared parser instead of its looser duplicate blocked-record interpretation
- Modify: `src/paths.ts` - retained reproduction and publication receipt paths
- Create: `test/code-review-follow-up.test.ts`
- Modify: `test/code-review.test.ts`
- Modify: `test/operator-state.test.ts`

**Steps:**

- **Step 1: Establish one strict parser for blocked final-panel evidence**
  - Change: Parse and validate blocked `code_review` records with the same strictness as passed records: configured round count, final round, `gate.verdict = "block"`, top-level blocking entries, finding IDs, reviewer dispatches, verified commits, and remediation transitions. Use this parser in both follow-up eligibility and operator status so presentation and mutation cannot disagree.
  - Verify: `node --test test/code-review.test.ts test/operator-state.test.ts`
  - Expected: Valid retained blocked records parse, malformed or cross-run references refuse, and status no longer accepts evidence the publication path would reject.

- **Step 2: Validate an operator-selected adjacent-round conflict**
  - Change: Require a blocked run whose last stage is the selected `code_review`, no `delivery_check` stage, a non-null frozen GitHub target, an earlier finding in round N, a final threshold-reaching finding in round N+1, and the intervening recorded remediation whose resulting verified commit is the final panel's reviewed commit. Require the selected criterion to exist in the approved spec bound to the run's recorded spec hash. Treat invocation with this evidence as the operator's explicit assertion that the criterion remains authoritative and the remediation caused a code defect; never infer continuity from title, location, `intentKey`, or severity alone. If the operator determines that the criterion needs revision, produces no reproduction, or classifies the event as a review, infrastructure, or provider failure, no publication row or issue is created by this command.
  - Verify: `node --test test/code-review-follow-up.test.ts`
  - Expected: The exact adjacent-round contract-drift case is eligible; passed runs, non-final findings, nonadjacent rounds, missing remediation, criterion drift, altered profiles, absent GitHub targets, and runs with a delivery stage refuse before any write.

- **Step 3: Bound and retain operator-authored reproduction evidence**
  - Change: Read `--reproduction-file` from the original invocation directory, require UTF-8 text with no NUL, enforce the frozen byte limit after rendering, normalize line endings only in memory, and copy the exact accepted text to a run-scoped `.governance` path through `src/paths.ts` during the confirmed local transaction. Persist its SHA-256 digest; never retain or print the source absolute path.
  - Verify: `node --test test/code-review-follow-up.test.ts`
  - Expected: Missing, oversized, binary, changed-between-preview-and-confirmation, and machine-path-bearing output cases refuse; the accepted reproduction can be reloaded by digest after the command exits.

- **Step 4: Render one exact issue identity and body**
  - Change: Derive the marker from canonical `{ runId, stageId, priorFindingId, finalFindingId, criterionId, owner, repository }`. Render the title as `[BuildWorks] Contract drift after code-review remediation: <feature> <criterionId>` and a fixed Markdown body containing the hidden marker, approved criterion text, both normalized finding summaries and repository-relative locations, remediation commit transition, operator reproduction, links to the remotely visible reviewed commit/spec/plan/source paths, and an explicit statement that the run remains blocked and requires changed source plus a fresh run. Exclude raw provider envelopes, credentials, absolute paths, `.governance` paths, unrestricted source excerpts, and audit internals.
  - Verify: `node --test test/code-review-follow-up.test.ts`
  - Expected: Equivalent inputs produce byte-identical title/body/marker, UTF-8 size is enforced, untrusted Markdown cannot alter the hidden marker, and snapshots contain no machine path, token, or raw model response.

**Task completion evidence:** Deterministic tests prove that only an operator-selected, record-backed adjacent-round conflict can produce one bounded issue preview and that the same strict record drives status and mutation.

### Task 5: Implement the concrete GitHub Issue and Projects V2 transport

**Depends on:** Task 4

**Files:**
- Create: `src/github-contract-drift.ts`
- Create: `test/github-contract-drift.test.ts`

**Steps:**

- **Step 1: Add a bounded GitHub-specific client, not an adapter**
  - Change: Use Node's built-in `fetch` with `Authorization: Bearer`, `Accept: application/vnd.github+json`, and one pinned `X-GitHub-Api-Version`. Implement only the REST calls needed to inspect the repository, label, reviewed commit, issue, and recent repository issues plus the GraphQL calls `addProjectV2ItemById` and `updateProjectV2ItemFieldValue`. Add finite timeouts, response-byte caps, strict JSON shape validation, pagination caps, and typed errors that preserve status/request IDs without retaining authorization headers or unrestricted response bodies.
  - Verify: `node --test test/github-contract-drift.test.ts`
  - Expected: Synthetic transport tests cover accepted responses, malformed JSON, wrong types, pagination, 401/403/404/422, rate limiting, timeout, oversized bodies, GraphQL top-level errors, and credential redaction.

- **Step 2: Preflight every visible target assumption before creation**
  - Change: On confirmed initial publication, require `BW_GITHUB_TOKEN`, verify the repository identity, configured label, Project node, status field/option, and final reviewed commit, and verify that generated links resolve within the configured repository. Refuse before creating an issue if any target mapping or permission is stale. Do not create labels, fields, options, Projects, branches, or commits.
  - Verify: `node --test test/github-contract-drift.test.ts`
  - Expected: A stale target or inaccessible commit produces a named refusal with publication still at `intent`; no create request is sent.

- **Step 3: Create and project through separately persisted steps**
  - Change: POST the rendered issue to `/repos/{owner}/{repository}/issues` with the configured label; validate and persist issue number, node ID, and URL before calling `addProjectV2ItemById`; persist the Project item ID before calling `updateProjectV2ItemFieldValue`; then mark `published`. Retries resume from the stored step and first verify any stored remote object still contains the exact marker and target.
  - Verify: `node --test test/github-contract-drift.test.ts test/store.test.ts`
  - Expected: Failures after issue creation or Project addition do not duplicate earlier mutations, and a later invocation resumes only the unfinished mutation.

- **Step 4: Make create ambiguity fail closed**
  - Change: Treat any create transport failure without a definitive GitHub response as `create_ambiguous`. A subsequent invocation must enumerate repository issues updated since the recorded attempt, inspect returned bodies directly for the exact marker, and auto-reconcile only one match. Zero or multiple matches remain ambiguous and never send another create request. `--recover-issue <number> --yes` may bind only an issue fetched directly from the frozen repository whose body has the exact marker; it then resumes Project steps.
  - Verify: `node --test test/github-contract-drift.test.ts test/store.test.ts`
  - Expected: Known REST refusals can be retried from `intent`; ambiguous outcomes never recreate; one exact match recovers; zero, duplicate, wrong-repository, wrong-marker, and pull-request matches refuse.

**Task completion evidence:** Transport tests prove bounded decoding, credential redaction, exact-marker idempotency, no duplicate create after ambiguity, and resumable Issue-to-Project publication.

### Task 6: Wire preview, explicit consent, audit, and recovery into the single CLI

**Depends on:** Tasks 3, 4, and 5

**Files:**
- Modify: `src/cli-args.ts` - command and option grammar
- Modify: `src/cli.ts` - read-only preview route and locked confirmed route
- Modify: `src/operator-output.ts` - command envelope, human preview, JSON projection, and exit mapping
- Modify: `src/audit.ts` - classification/publication/recovery event summaries
- Modify: `src/operator-state.ts` - publication eligibility and persisted state
- Modify: `test/cli.test.ts`
- Modify: `test/cli-operator.test.ts`
- Modify: `test/operator-state.test.ts`
- Modify: `test/delivery-stage.test.ts`

**Steps:**

- **Step 1: Add an explicit command contract**
  - Change: Add `github-publish-contract-drift --repo <path> --run <id> --prior-finding <id> --finding <id> --criterion <id> --reproduction-file <path> [--recover-issue <number>] [--yes] [--json]`. Reject unknown, duplicate, incompatible, and missing options. `--recover-issue` is valid only for a persisted `create_ambiguous` publication and must identify the same classification inputs.
  - Verify: `node --test test/cli.test.ts`
  - Expected: Help documents exact arguments and consent semantics; invalid combinations fail before repository, token, or network access.

- **Step 2: Make preview observably read-only**
  - Change: Route the command without `--yes` before write-mode store opening and repository-lock acquisition. Load the run/profile/stage records read-only, validate the supplied reproduction, and return an operator envelope containing exact target, label, Project, marker, title, body, ordered mutations, and the confirmation command. Do not read `BW_GITHUB_TOKEN`, persist classification, write audit, copy evidence, acquire a lock, or call GitHub.
  - Verify: `node --test test/cli-operator.test.ts`
  - Expected: Human and `--json` previews agree; SQLite bytes, audit rows, `.governance` contents, Git status, and network-call count are unchanged; exit semantics indicate confirmation is required.

- **Step 3: Confirm under the repository lock and expose resumable outcomes**
  - Change: With `--yes`, acquire the existing repository lock, revalidate all preview inputs and digests, atomically persist intent/evidence and the initial audit event, then execute Task 5 from the persisted state. Commit each decoded remote transition with its bounded audit event; audit only IDs, hashes, target, state, request ID, and remote URLs. Return distinct envelopes for `published`, resumable step refusal, and `create_ambiguous`; never print the token, absolute reproduction path, or raw API body.
  - Verify: `node --test test/cli-operator.test.ts`
  - Expected: Concurrent confirmations serialize, changed input after preview refuses, successful output names the issue and Project state, and interruption/error output tells the operator the exact safe next command.

- **Step 4: Project follow-up state without changing workflow state**
  - Change: Extend `status` with eligible final blocking findings, frozen target, classification IDs, publication state, issue URL, and recovery action. Keep `workflowAction` non-executable for the blocked run. After successful publication, assert `run.status = blocked`, `code_review.status = blocked`, no `delivery_check` row exists, and direct delivery still fails its existing passed-review prerequisite.
  - Verify: `node --test test/operator-state.test.ts test/delivery-stage.test.ts test/cli-operator.test.ts`
  - Expected: Publication appears only under operator follow-up actions and cannot resume, approve, waive, complete, or deliver the run.

**Task completion evidence:** CLI tests prove exact no-write preview, explicit confirmation, secure output, resumable recovery, and unchanged delivery refusal.

### Task 7: Complete deterministic regression and trust-boundary coverage

**Depends on:** Tasks 2 through 6

**Files:**
- Modify: `test/code-review-stage.test.ts`
- Modify: `test/cli-operator.test.ts`
- Modify: `test/operator-state.test.ts`
- Modify: `test/store.test.ts`
- Modify: `test/profile.test.ts`

**Steps:**

- **Step 1: Add the end-to-end local scenario**
  - Change: Build a deterministic blocked review with two adjacent rounds and an intervening remediation, preview one operator classification, confirm it against a scripted GitHub transport, interrupt at each remote boundary, resume, and verify one issue and one Project item. Keep expected finding/criterion/commit values grounded in the retained stage records rather than hand-authored duplicates.
  - Verify: `node --test test/code-review-stage.test.ts test/cli-operator.test.ts test/operator-state.test.ts`
  - Expected: The complete post-run path reaches `published` while the governed run remains blocked and delivery remains unavailable.

- **Step 2: Cover rejection and containment cases**
  - Change: Add cases for an unconfigured repository, pre-current frozen profile, token in config, token absent at confirmation, wrong target, inaccessible reviewed commit, stale label/field/option, finding from another run, model-authored identity collision, nonadjacent rounds, below-threshold final finding, modified reproduction, body overflow, absolute paths, malformed API data, duplicate marker, ambiguous create, and recovery selection mismatch.
  - Verify: `node --test test/governed-config.test.ts test/profile.test.ts test/store.test.ts test/code-review-follow-up.test.ts test/github-contract-drift.test.ts test/cli-operator.test.ts`
  - Expected: Every invalid case fails before the unsafe mutation, secrets and machine-local paths are absent from output/audit/storage, and no rejection changes stage/run status.

- **Step 3: Prove the most important guards by mutation**
  - Change: Temporarily disable, one at a time, the final-blocking check, preview no-write route, deterministic marker match, and delivery prerequisite assertion; run the corresponding focused test to observe failure; restore each production line and rerun. Do not retain mutation edits.
  - Verify: `node --test test/code-review-follow-up.test.ts test/github-contract-drift.test.ts test/cli-operator.test.ts test/delivery-stage.test.ts`
  - Expected: Each targeted test fails under its deliberate fault and passes after restoration, demonstrating that the test guards the intended boundary.

**Task completion evidence:** Focused suites cover the accepted path, every material refusal/recovery path, secret containment, and four mutation-proven safety guards.

### Task 8: Update operator documentation and examples

**Depends on:** Tasks 2 through 7

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/cli-operator.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

**Steps:**

- **Step 1: Document configuration and credential ownership**
  - Change: Show the exact optional `github` block without enabling it in BuildWorks' own `governed.yaml`, explain that every value is committed and frozen, state that Git remotes are ignored, and document the separately provisioned short-lived GitHub App installation token in `BW_GITHUB_TOKEN`. List the minimum repository issue and Projects V2 permissions required by the named REST/GraphQL operations in Task 5, mark Task 9's live confirmation as the implementation gate, and do not document a PAT fallback or committed secret.
  - Verify: `npm run check:docs`
  - Expected: An operator can distinguish target configuration from credentials and can tell that absent configuration leaves BuildWorks local-only.

- **Step 2: Document preview, publication, recovery, and non-delivery**
  - Change: Add byte-safe PowerShell examples for preview, `--yes`, status inspection, interruption resume, and `--recover-issue`. State what operator-sanitized data becomes visible in the issue, that preview performs no writes, that invoking this command asserts the cited contract remains authoritative, that contract revision/product choice produces no issue through this route, that guided-run `--yes` does not authorize publication, that ambiguous create never automatically retries, and that a published issue neither changes the blocked run nor authorizes delivery.
  - Verify: `npm run check:docs`
  - Expected: The README, runbook, architecture, and instruction files describe one consistent operator workflow and no longer make the blanket claim that no GitHub publication exists.

**Task completion evidence:** Documentation names the exact command/configuration, consent boundary, visibility, recovery procedure, and blocked-run invariant.

### Task 9: Discover the live contract and prove one synthetic throwaway publication

**Depends on:** Tasks 1 through 8; separate operator authorization for GitHub read access and mutation

**Files:**
- Create: `test/fixtures/recorded/github-contract-drift-create-issue.json`
- Create: `test/fixtures/recorded/github-contract-drift-list-issues.json`
- Create: `test/fixtures/recorded/github-contract-drift-project-mutations.json`
- Modify: `test/github-contract-drift.test.ts`
- Modify: `docs/features/code-review-contract-drift-issue/plan.md` - implementation result/status after completion

**Steps:**

- **Step 1: Perform authorized read-only target discovery**
  - Change: After the authorization names the throwaway owner/repository and Project owner kind/number, use `gh api repos/{owner}/{repository}`, `gh api repos/{owner}/{repository}/labels/buildworks-contract-drift`, and a `gh api graphql` node query over the authorized Project's `ProjectV2` fields to record repository identity, App installation permissions, Project node ID, status field ID, blocked option ID, label presence, response headers/version, and REST/GraphQL response shapes. Supply the same short-lived installation token to `gh` only through process environment for these probes, record the exact commands with secrets omitted, and do not infer IDs from Git remotes or production configuration.
  - Verify: Run the recorded read-only `gh api` commands against the explicitly named throwaway target, compare the discovered IDs with the candidate `governed.yaml` block, then remove both `GH_TOKEN` and `BW_GITHUB_TOKEN` from the process environment.
  - Expected: The exact target mapping and minimum Issue/metadata-read/Projects permissions are evidenced without creating or changing a remote object.

- **Step 2: Publish one synthetic issue under separate explicit consent**
  - Change: Use a disposable governed target containing synthetic criterion, finding, commit, and reproduction text; run preview first; inspect exact visibility; then obtain explicit authorization and run the same command with `--yes`. Interrupt only if the operator has approved that recovery exercise; otherwise observe the normal create, Project add, and status update.
  - Verify: Inspect the issue directly, inspect the Project item and blocked status, run `status --run <id>`, and invoke the existing delivery command expecting refusal.
  - Expected: Exactly one sanitized labeled issue exists in the configured repository and Project, the marker matches local state, no secret or machine path is visible, the run remains blocked, and delivery refuses.

- **Step 3: Commit sanitized real-response fixtures at the evidence boundary**
  - Change: Copy only the contract-relevant REST/GraphQL request metadata and response bodies into the three named fixtures. Each fixture must contain a `provenance` block naming the target/run, capture time, API version, operation, authorization boundary, sanitization, and fields dropped from the original envelope. Replace repository/user IDs, URLs, timestamps, and synthetic content consistently while preserving JSON types and optional/null fields used by the decoder.
  - Verify: `node --test test/github-contract-drift.test.ts`
  - Expected: The production decoder accepts the recorded fixtures; a deliberate field/type mutation fails the fixture-backed test; no token, production identifier, or unrestricted payload is committed.

- **Step 4: Run the repository completion gate**
  - Change: Resolve only defects caused by this feature; correct the README/runbook permission list if live App responses differ from the documented minimum; record the live proof and validation result in the plan; and change `**Status:**` to `Implemented` only when the authorized proof and every command below pass.
  - Verify: `npm run typecheck && npm test && npm run check:docs`
  - Expected: TypeScript, the complete test suite, and documentation consistency pass with schema version 7 and recorded GitHub contract coverage.

**Task completion evidence:** Authorized live evidence proves the remote contract and visible result; sanitized fixtures retain that evidence; the complete local gate passes; and the blocked-run/delivery invariants still hold.

## Completion Gate

Implementation is complete only when:

- The proposal review is reconciled and the binding architecture authorizes only the separate post-run action.
- Repositories without GitHub configuration retain the current local-only workflow.
- New runs freeze one exact nullable GitHub target and no credential.
- One operator-selected adjacent-round classification maps to one deterministic issue marker.
- Contract revision, unsupported reviewer expectations, infrastructure/provider failures, and absent reproduction create no issue through this command.
- Preview is proven read-only and confirmation is distinct from guided-run consent.
- Local intent is durable before remote mutation, each remote step is resumable, and ambiguous create never automatically recreates.
- Issue content is bounded, previewed exactly, sanitized, and free of credentials, absolute paths, raw provider envelopes, and inaccessible machine-local references.
- Successful publication leaves both the run and `code_review` blocked, creates no `delivery_check`, and does not approve, waive, resume, or deliver anything.
- Sanitized recorded GitHub responses from an explicitly authorized throwaway proof define the external decoder contract.
- `npm run typecheck`, `npm test`, and `npm run check:docs` all pass.
