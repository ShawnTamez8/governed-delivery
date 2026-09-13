# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-13, dashboard command center redesign-3 implemented and repository-scoped)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working state:** Branch `cs_candidate_b` remains based on `4356151`. The
working set across `src/dashboard/`, `src/dashboard-server.ts`,
`src/dashboard-config.ts`, `src/operator-read.ts`, `test/dashboard-ui.test.ts`,
`test/dashboard-server.test.ts`, `README.md`, and
`docs/features/dashboard-redesign-3/` is uncommitted. No commit has been
requested yet. `package.json` chains `typecheck:dashboard`.

**Completed:** `docs/features/dashboard-redesign-3/plan.md` is `Implemented` —
all nine tasks shipped, and
`docs/features/dashboard-redesign-3/2026-09-13-code-review.md` is `reconciled`.
The dashboard is now a multi-tab enterprise command center (Overview, Runs,
Findings, Governance, Models & Agents, Audit) featuring a 6-card KPI strip,
Needs Attention queue, interactive 8-stage Delivery Pipeline, analytical panels,
Governed Deliveries table, slide-over detail drawers, keyboard shortcuts (1-6,
?, Esc), and repository-scoped filtering across all tabs. Verification:
`npm test` 1177 tests passing, `npm run typecheck` exit 0, `npm run check:docs`
clean.

**In flight:** Nothing. No plan is mid-execution.

**Decisions locked:** Invariant Hard Rule 2 holds: the dashboard is strictly
read-only and loopback-only; targets are loaded via `--repositories-file <path>`.
The Delivery Pipeline's "Governance" step represents cross-stage gate evaluation
(`gate_result`) rather than a single database stage row (displaying `stageId: null`).
Repository selection scopes the portfolio banner, 6-card KPI strip, exception
queue, pipeline stepper, and all tab detail views to the active repository.

**Implementation boundary:** Presentation narrows, never alters. Interactive
mutation, remote access, WebSockets, new telemetry persistence, a second harness,
and fabricated telemetry remain unauthorized.

**Running state:** No dashboard server, browser, background agent, or paid process
is running. The completed paid target remains at
`C:\Users\tamezs\buildWorks_test_repos\target` ($2.06, 16/16 dispatches) and the
blocked paid target remains at
`C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1789245101665\target` ($1.81).

**Open/deferred:** Manual browser evaluation of the command center layout and
themes across dark/light modes and viewport sizes. Operator commit decision for
the uncommitted dashboard working tree.

**Next up:** Operator browser review of the redesigned command center, then a
commit decision for the dashboard working tree. Do not run a paid chain.

## Diagnostics quick-reference

Durable project facts belong here, regardless of whether a host also caches them.

- Boundary asymmetry caused seven defects, most recently in `validateCodeReviewLocations`; inspect both paths.
- Put field/section constraints in prompts: parser-only rules killed three paid runs. `CONSTRAINT_STRINGS` scans source, so wrapping a phrase can fail it.
- "Fenced block is not valid JSON" names the candidate, not the cause; retained `\UXXXXXXXX` bytes came from the provider, not terminal corruption.
- Native `claude.exe` needs no shell wrapper: removing the shim assumption avoids DEP0190 and preserves typed ENOENT.
- Hazard 1 omitted a shape that blocked a paid run despite all enumerated cases passing; fixtures do not prove universal parser coverage.
- A code_review block is a result, not a driver fault; a pass can retain findings. Read the final panel and frozen verification commands.
- Identify revisions by hash, not dispatch order; zero audit counters do not prove guards fired.
- Break-test doc-check in a mirror. `checkPaths()` recursively includes AGENTS/.agents; tiers classify, not select. Rooted-path recognition is narrower; section 5's deferred list is every backticked `[a-z_]+` token.
- Windows `TEMP=...\AppData\Local\Temp\1`, `PerSessionTempDir=1` and
  `DeleteTempDirsOnExit=1` put default driver targets on a logoff deletion timer.
  Four September 7/9 stores were lost by September 10; use a fresh child of
  `C:\Users\tamezs\buildWorks_test_repos` and extract load-bearing responses into
  `test/fixtures/recorded/` immediately. A non-temp path is not an independent backup.
- Query before driver clean deletes store/raw evidence. Cost joins through `stage_id`; the table is `audit`; finding IDs span document/code review.
- `| tail -N` buffered paid output; redirect logs and inspect state. A timed-out wait can leave the chain running; never relaunch it blindly.
- The driver signs Buffer bytes over stdin without a shell; historical PowerShell `cmd /c` redirection is approval transport, not a launch fix.
- Restore only the break mutation, hash before/after, anchor a unique expression rather than CRLF indentation. Shell-true `--test-name-pattern` lost `(`/`|` and exited 255.
- Bash heredocs/regex `node -e` were mangled; scratch `.mjs` worked. A bare Python heredoc hung on a host without Python.
- Shared validators prove subsets; callers project findings/commands/metadata. Malformed display fields get limitations, not stronger gates.
- `Store.exec` forbids audit writes; model a missing gate by not appending its event.
- Mechanical doc renames invented paths/binaries/model IDs; restore byte-exact originals. Missing status/disposition means unreconciled.
- Read every adjacent review before planning from a proposal.
- Read-only Git needs `--no-optional-locks` and `-c diff.autoRefreshIndex=false`; index refresh was measured without the latter.
- A hot journal made read-only SQLite return 776 without writes; explicit fixture migrate recovered committed rows without replay. Readers never repair.
- `envPassthrough` freezes names, not values/files. Doctor now supplies its captured filtered map; dispatch's bare probe still inherits by default. A doctor pass is not auth proof.
- Node `statSync` adds extended Windows path semantics; native executable lookup does not. Doctor's DOS-device attribute query preserves native normalization while selected/probed spelling stays unchanged.
- A child `tsconfig` inherits the base `include` even when it supplies `files`; override `include` explicitly when isolating checked browser JavaScript from harness fixtures.
- TypeScript child configurations also inherit `exclude`, and a default `lib`
  includes DOM types. Inspect resolved files and libraries when separating Node
  and browser programs.
- Dashboard snapshot caches must key by repository and run, and every overlapping
  refresh path needs its own generation guard; a run ID alone is not an identity.
- Windows `child.kill("SIGTERM")` can terminate without delivering Node's
  handler. Promise graceful cleanup only for signals the platform delivers.
- A full paid chain can exhaust its configured final code-review panel after a
  successful remediation; the final threshold blocks without another patch or
  delivery, and a completed spend never authorizes a retry.
- `agent_runs` persists `executor`, `requested_model`, `effective_model`,
  `fallback`, `duration_ms`, `role` and `independence`, but
  `RunSnapshot.cost.byAgent` keeps only `agent` plus cost totals. The dashboard's
  model, harness and duration "unavailable" labels are a projection gap, not a
  data gap — check the row before calling a value unrecorded.
- `insertFindingDecision` requires grounding exactly when the disposition is
  `rejected_with_rationale` and normative changes exactly when it is
  `addressed`. Rendering either as "Not recorded" in the other state reports a
  structurally forbidden field as missing evidence.
- Apply a formatting-honesty pattern to every value class at once. `countNode`
  paired abbreviated text with an exact accessible value while `usd()` shipped
  the raw float `$0.5452318`; the rule existed and was applied to one type.
- Popover click triggers attaching document-level listeners must use `{ once: true }`
  or explicit cleanup; otherwise re-renders accumulate handlers and leak memory/events.
- Dashboard repository IDs in URL routes and APIs are deterministic base64url SHA-256
  hashes of the normalized worktree path; the pipeline Governance stage is a synthesized
  multi-stage gate projection with `stageId: null`.
- Scoping repository views in the dashboard requires filtering the views array fed to
  `portfolioProjection`, `commandCenterKpis`, `needsAttentionQueue`, and `governedDeliveriesRows`
  by `selectedRepositoryId || repositoryFilter`.

## Session records

### PowerShell paid chain exercises remediation and completes (2026-09-09)

Unchanged driver/design, PowerShell 7.6.5 -> Node26.4.0 -> Claude2.1.263 without
cmd: high/medium findings, one patch, version checks, clean second panel/delivery;
$2.40174/16 dispatches, driver15/15, smoke13/13, valid audit. Five provider bodies,
provenance and records are in
`test/fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json`.
`2026-09-09-paid-powershell-chain.md` retains source hashes, commands and the
null-prototype export correction; no browser check or causal shell comparison.

### Copilot skill portability aligned (2026-09-08)

Canonical `.claude` project skills and shared learnings; six global workflows use
`.copilot/skills/` through `.agents` junctions. Records are not hooks.
`2026-09-08-copilot-skills-audit.md` preserves recovery paths and corrections to
names, oversized entries, unavailable calls, paths and task defaults.

### Paid evidence: implementation block, then clean completion (2026-09-07)

Two authorized 16-dispatch-bound chains: 11/$1.00548 blocked at
`implementation.content.invalid` (`\U0001f319`, offsets1911/9505); replacing only
those tokens validated five files, not a shell cause. Then 13/$1.39473 completed
with a clean first panel, four artifacts at `b0b1104dc0b045dbc3d8c116ba44e9ed894200e4`,
valid audit and operator manual calculator check (no detailed matrix). Five reviewer
fixtures, focused9/9 and types/docs/diff passed; prior821/822 with symlink skip.

### Extractor fixed; two chains correctly block at code_review (2026-09-06)

`docs/features/unfenced-json-extraction/` fixed run 3's prose-before-JSON with
remedies 1–3, not prompt remedy 4; prose-after remained unbuilt absent evidence.
Separately authorized runs 4/5 correctly blocked on high code findings, each 13
dispatches ($1.15759/$1.40170), with no gates weakened; code-review Task 10 and
plan-coverage Task 7 closed. Three reviewer captures required real stage context
and an invented AC-016 causal example failed review — trace criteria and changed
paths, not just stage order. Mirror replays all passed; fallback removal broke
four assertions and severity/location mutations broke both correctness replays,
with byte-exact restorations.

### Two membership fixes and an agent-portability mirror (2026-09-05/06)

`spec-section-membership` (eight tasks) and `plan-coverage-single-artifact` (seven)
had two independent reviews each on code-review-stage. Coverage is a representative
delivery anchor; the invented separator heuristic was removed. Paid blocks at stage
5/$1.25141 and stage 1/$0.08103 proved membership live on the second before reading
the proposal review. Invented AGENTS/.agents paths/binary/models were restored;
reviews caught two missing `not_applicable` prompts and two overstated parser claims.

### The code_review stage implemented (2026-09-05, `6fb5412`, `4d71ad1`)

`docs/features/code-review-stage/plan.md` Tasks1-9 shipped with separate review
and 19 mutations; only code_review lifted step9. The code-only loop replaced its
original terminal-block/upstream-proposal policy. Reviews caught four overstated
reused contracts, then closed delivery-binding, verification-label and typed-patch
defects on September7. First paid attempt blocked at spec_review; panel size,
round count and severity stay independent.

### Hazard 17, the list-marker remedy, and the driver design swap (2026-09-04, `a2db2a0`)

Both `normalizeNodeText` sides and prompt `nodeForm` were chosen: specify what
"exact text" means. Web calculator replaced clamp to attract real findings;
run 3 completed at $1.34097 with a grounded replacement (`unclaimedRemoved=0`).
A rationale that cannot be broken is not a rationale.

### Earlier history (2026-08-29 to 2026-09-04)

- **Stable criterion IDs** (`9a12cba`): spec-minted canonical IDs and the exact
  bidirectional Coverage relation, proved by two paid chains.
- **Coverage-gate investigation** (2026-09-03): the answer already lived in
  `docs/proposals/spec-kit-harness-review.md` and was not found — a decision
  that lives only in the narrative tier dies at the next compaction.
- **Step 8, delivery check** (`d033595`): a billed standalone review beat an
  in-session subagent (hazard 14); a break mutation must change the outcome
  class the test pins; the recorded patch base is the starting commit's child.
- **Step 5b** (`60587fc`…`39d5432`): only the operator rules on a wrong task
  boundary; a reconciliation stamp is a claim, not evidence.
- **Steps 1-7** (`83d88c0`, `32a714e`): `bw new-run` could never create a run
  in a repository that had not gitignored `.governance/` (hazard 11);
  `resolveExisting` resolved dangling links lexically — refuse what cannot be
  verified; the plan stage mirrors the spec stage without a shared abstraction
  (hard rule 4).

### CLI operator work: planning, review, implementation (2026-09-09/10)

Operator chose `2026-09-09-docs-cli-operator-analysis.md`, not the outbound
proposal, for 18 criteria/boundaries/transactional exceptions/distribution
limits; `2026-09-09-cli-github-impact-analysis.md` is closed history. The plan
review's 22 dispositions preserved full consent, complete arrays, raw approval
bytes and bootstrap criteria; reconciliation granted no spend.

`2026-09-10-cli-operator-implementation.txt` retains commands, ten late
mutations and full approval testing after a contributor's external-signing
filesystem limit. Deviations: target-relative evidence, disabled diff refresh,
shared extraction; no stronger gate/schema. Standard I/O is the runner seam,
stages own gates, and an invocation never retries failed groups including
rolled-back delivery. Lowercase `# design` was required grounding; ascending
severity and unattempted-group accounting needed correction. CLI 108 and full
1071 passed with one OS symlink skip.

A follow-up `gpt-5.5` review of HEAD plus untracked files passed nine
index/key-isolation/delivery-retry cases; physical EOF resolved nonempty-line
counting. DEP0190 had no retained traced origin, so no attribution was made.

### cc-switch reviewed and rejected as a harness abstraction (2026-09-11)

`docs/proposals/cc-switch-review.md`: switching is no adapter substitute;
MHA-03 argv/envelope and MHA-01 sequencing remain. Candidates A (frozen non-secret
env) and B (doctor reporting) do not discharge them. A new env field needs no
migration but invalidates canonical bindings; land between runs. Filtered overrides
do not contain ambient home files. No `~/.cc-switch` or `ANTHROPIC_*` was observed;
this was prevention, not a measured incident. Types/docs/paths passed, 63 warnings.

### Pi support assessment and retained Claude acceptance chain (2026-09-11)

Full research limits, findings, commands, retained paths and per-dispatch ledger:
`2026-09-11-pi-assessment-and-prior-claude-chain.md`. Pi remains additional
support, not an approved adapter. The earlier Claude 2.1.269/Sonnet 5 run
completed with 16 dispatches/$2.0585392 and a non-blocking medium correctness
finding after remediation; its final panel was not clean. Six artifacts delivered
at `8cd5a2d9b959f4eb215b71feae690a9b1a14b2d2`; only version commands ran.

### Doctor implementation, live block and triage (2026-09-11)

Candidate B shipped at `4356151` with seven mutations; a later Windows
executable-lookup fix closed separately with an eighth. Canonical environment
reads preserve Windows key casing, and native lookup requires native path
semantics rather than Node `statSync` equivalence.

The authorized live chain used 16 dispatches/$2.4481306. One remediation landed,
then final high finding 5 blocked code review at
`511f64bbb34d3ed0c8066a7fd8fb4945dc6ba54e`; no delivery occurred. AC-013 maps
Enter to equals, while the remediation's all-button exception conflicts with that
requirement. Native browser ordering and generated-unit behavior remain
unverified; the retained triage, live-run and recorded JSON files preserve the
limits, envelopes, artifacts, costs and hashes.

### Dashboard read-only increment implemented (2026-09-12)

The CLI-launched `127.0.0.1` dashboard uses bearer-protected GET routes and
shared exact-current read services without opening a writer or executing a
command. Seven review defects were resolved — repository/run request identity,
Windows path identity, checked browser source, inherited TypeScript
configuration, narrow-layout overflow, and a wall-clock-dependent approval test;
`docs/features/dashboard/2026-09-12-code-review.md` is the reconciled record.
Four security/read-only mutations failed as intended with exact restoration, and
a Chrome session covered token, refusal, stale, theme, keyboard, 250-finding,
command-copy and 480-pixel behavior.

### Paid web-calculator chain blocks after remediation (2026-09-12)

One explicitly authorized paid run used 16 dispatches and $1.8073754. Round 1
remediated floating-point display at commit
`270dc90fe939d3f1c60836a46151e361d37d6d47`; the final panel then blocked on
high AC-018 mobile overflow at `src/styles.css:60`, so delivery did not run.
Both security panels were clean and the audit chain was valid.

The retained target and durable evidence paths are in Current state and
`.claude/sessions/2026-09-12-paid-web-calculator-code-review-block.md`. The
blocked run cannot receive another unreviewed remediation, and any replacement
paid run needs new authorization.

### Dashboard enterprise redesign requirements and plan (2026-09-12)

Requirements at
`.claude/sessions/2026-09-12-requirements-dashboard-enterprise-redesign.md`; the
full-path plan kept the HTTP and `RunSnapshot` contracts unchanged, added one
pure checked browser projection module, and defined eight tasks with
source-derived tests. One self-review reconciled five findings first: an
invented out-of-window count, a command-formatting module cycle, exposed
serialized decision lists, omitted operator-action metadata, and weakly verified
contrast.

Requested average execution time and trends had no `RunSnapshot` source, so both
render as unavailable rather than substituting wall-clock or verification
duration. Aggregate only current run-list IDs, key snapshots by repository plus
run, and parse stored decision list fields into structured values — never
restore raw JSON as a fallback.

### Redesign implemented, then operator review reopens density (2026-09-12)

#### Decisions and assumptions

- Operator deferred the `RunSnapshot` extension that would project the agent
  fields `agent_runs` already stores, so agent model, harness and duration stay
  unavailable — the gap is now known to be projection, not data.
- Operator chose hero plus aggressive collapse over tabs and sticky section
  navigation; a sticky region costs the vertical space the objective needs.
- Presentation may narrow, never alter: a value may be collapsed, shortened or
  aggregated only while staying reachable and exact for assistive technology.

#### What failed

- `renderTokenChart` was edited to call a `tokenTable(groups)` helper that did
  not exist; the trailing disclosure had to be extracted first. Applying a
  review fix before extracting the code it depends on breaks the build.
- `usd()` shipped raw floats (`$0.5452318`) while `countNode()` right above it
  already paired abbreviated text with an exact accessible value. The honesty
  pattern existed and was applied to one value class only.
- Six section-level `.source-note` paragraphs, constant-valued table columns,
  per-cell coverage parentheticals, raw hashes and input-only token cells made
  the run view read as a report; the full defect catalogue with evidence is in
  `.claude/sessions/2026-09-12-requirements-dashboard-density-triage.md`.

#### What worked

- A separate `code-review` agent independently re-ran the suite and recomputed
  contrast, returning two findings: `aria-busy` never cleared on the four
  session-unavailable early returns, and a token chart conflating reported zero
  with nothing reported. Both fixed with mutation-proved regressions.
- Reading `insertFindingDecision` before trusting a label showed that grounding
  is forbidden unless the disposition is `rejected_with_rationale` and normative
  changes are forbidden unless it is `addressed` — so several "Not recorded"
  rows were misreporting structurally impossible fields as missing evidence.
- Eight mutations in a robocopy mirror, each proved and restored byte-exactly.
  CRLF-aware anchor translation was required; two anchors missed on the first
  pass because the files use CRLF and the anchors used `\n`.

#### Running state

- None. No server, browser, agent or paid process is running; the mutation
  mirror and the `app.js` byte snapshot under `%TEMP%` were both deleted.

#### Verification

- `npm run typecheck` - clean across both programs.
- `node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts` - 22/22.
- `npm test` - 1129 pass, 5 skip, 1 unrelated failure.
- `npm run check:docs` and `git --no-pager diff --check` - clean.

#### Deferred and open

- Deferred: the agent-field projection, historical trends, cross-run comparison,
  and effort levels, which are stored nowhere.
- Open: four questions in the density requirements — findings expanded or
  collapsed beside the hero, hash fragment length, sticky governed actions, and
  whether the portfolio view is in scope.

#### Next time

- Extract the shared helper before applying the review fix that calls it; the
  two durable projection lessons are in the quick-reference above.

### Dashboard enterprise command center & repository scoping (2026-09-13)

#### Decisions and assumptions
- Redesigned the dashboard from a report into an enterprise command center with 6 primary navigation tabs, a 6-card KPI strip, an interactive 8-stage Delivery Pipeline, Needs Attention queue, analytical panels, and slide-over drawers while keeping Hard Rule 2 intact (strictly read-only loopback projection).
- Repository selection scopes all views (Overview, Runs, Findings, Governance, Models & Agents, Audit) dynamically to the chosen repository when active; "All repositories" restores cross-repository portfolio aggregation.
- Governance in the 8-stage pipeline represents a synthesized cross-stage gate check rather than an individual database stage row, retaining `stageId: null`.

#### What failed
- A popover info button listener attached document-level `click` listeners without `{ once: true }`, accumulating listeners across repeated renders. Caught in code review and fixed.
- Running full `node --test` suites without targeted test filters ran unnecessary long-duration suites (e.g. 101s on zero-token assertions). Used targeted patterns during iteration.

#### What worked
- Pure presentation model projections in `src/dashboard/dashboard-model.js` kept UI transformations testable in Node without DOM emulation or browser dependencies.
- Filtering `application.repositories` inside `repositoryViews` cleanly updated all derived KPI, exception, pipeline, and table projections simultaneously without duplicating logic across tabs.
- Mutation testing proved drawer trap accessibility, static asset constraints, and projection stability across five deliberate faults with exact text restoration.

#### Running state
- None. All test shells and background processes exited cleanly.

#### Verification
- `npm run typecheck` - clean across both base and dashboard tsconfig programs.
- `node --test test/dashboard-ui.test.ts` - 32/32 tests pass.
- `npm test` - 48 suites, 1177 tests passing.
- `npm run check:docs` - clean, all documentation hazard rules satisfied.

#### Next up
- Operator browser verification of the command center across dark/light themes, followed by a commit decision for the working tree.

