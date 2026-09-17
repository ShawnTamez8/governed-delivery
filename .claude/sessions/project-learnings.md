# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-16, code-review exhaustive audit & pre-dispatch artifact check)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working state:** Branch `guided-project-bootstrap` has implemented refined
Option C (exhaustive code review audit prompt instruction) and pre-dispatch
deterministic declared-artifact completeness check via `deliveryCoverage`.
Verification: `npm run typecheck` clean; `node --test test/prompts.test.ts` 25/25
passed; `node --test test/code-review-stage.test.ts` passed; `npm run check:docs` clean.
Both guards proven by breaking what they guard and confirming failure before restoring.

**Completed (code-review exhaustive audit & pre-dispatch artifact check):**
Paid live run `target-tap-live-2` completed 16 dispatches ($3.58933 total spend),
passing stages 1-7 (spec, spec_review, awaiting_approval, plan, plan_review,
implementation, verification). Stage 8 (`code_review`) blocked at round 2
because Round 1 reported 3 defects which the implementer remediated, but
Round 2 then reported 2 new high findings: Finding 11 (package.json test script
referenced undeclared/uncreated `tests/component/view.test.js`) and Finding 12
(rapid-click race condition on element dataset in the target's view component). Because
Round 2 was the final configured round, the gate failed closed on the high findings.
Fixed:
1. `src/prompts.ts`: `buildCodeReviewPrompt` updated with explicit instructions
   directing reviewers to conduct an exhaustive audit across the entire diff and
   all changed paths within their specialty, rather than stopping after finding
   early defects or returning only a sample; this instructs reviewers not to
   sample and increases the likelihood of first-round completeness so that actionable
   defects can be addressed together during the single remediation opportunity.
2. `test/prompts.test.ts`: Added constraint strings to `CONSTRAINT_STRINGS` and
   asserted them in the generated code reviewer prompt test.
3. `src/code-review-stage.ts`: Reused `deliveryCoverage` and `git ls-tree` blob
   existence checks after creating the stage row to deterministically verify that all
   declared artifacts in `scope` appear in `changedPaths` and exist in the
   `initialVerifiedCommit` tree. If any declared artifact is missing, the stage
   immediately aborts via `code_review.artifact.missing`, marking the stage and run
   as `blocked` before any reviewer dispatch. This satisfies the architectural rule
   that failed post-approval requirements block terminally rather than stranding
   the run in `in_progress`, while avoiding expensive code review dispatches
   ($1.50-$3.50) on an incomplete delivery that `delivery_check` is guaranteed to fail.
4. `test/code-review-stage.test.ts`: Added unit test verifying that a verified
   range missing a declared artifact blocks the stage and the run.

**Completed (plan-reconciliation prompt coverage-node fix):**
Paid live run on `target-tap` completed 10 dispatches ($1.55366 total cost),
passing stages `spec`, `spec_review`, Ed25519 external `awaiting_approval`, and
`plan`. Stage 5 (`plan_review`) blocked at round 1 reconciliation because the
plan author addressed task findings in `## Tasks` and claimed them, but
incidentally rephrased the alternative verification of an existing
`not_applicable` coverage line (`AC-011`) without claiming it in
`normativeChanges`. `planNormativeNodes` treats all coverage lines as normative
nodes, so multiset comparison failed closed with audit event 34.
Fixed:
1. `src/prompts.ts`: `buildPlanReconcilePrompt` updated to include the
   `not_applicable` line format in `nodeForm`; explicitly instructed that every
   task in `## Tasks` and every line in `## Coverage` is a normative node;
   prohibited casual rewording of coverage entries when addressing task findings;
   and stated that any modified coverage line must have its added and removed
   node forms claimed in `normativeChanges` with specification grounding.
2. `test/prompts.test.ts`: Added new constraints to `CONSTRAINT_STRINGS` and
   asserted them in the generated plan reconciliation prompt test.
3. Retained debug analysis:
   `.claude/sessions/2026-09-16-debug-plan-reconcile-unclaimed-coverage-node.md`.

**Completed (verify-command cleanup race fix & documentation sync):**
Intermittent Windows `EPERM` failure in `test/verify-command.test.ts` ("a hung
command is killed with its whole tree at the ceiling") diagnosed and resolved:
1. `src/verify-command.ts`: `settle()` called `evidence.end(cb)`, which runs on
   `'finish'` while `evidence.fd` is still open; Node closes the OS file
   descriptor asynchronously before emitting `'close'`. Fast resolution (<1ms)
   raced `withRoot()`'s `finally { rmSync(root) }`. Fixed to await the
   `'close'` event (or verify `evidence.closed`), ensuring the descriptor is
   closed before resolving.
2. `test/verify-command.test.ts`: Added `{ maxRetries: 3, retryDelay: 50 }` to
   `withRoot`'s `rmSync` to absorb transient NTFS handle table and process
   teardown latency following `taskkill /t /f`.
3. Retained debug analysis:
   `.claude/sessions/2026-09-16-debug-verify-command-cleanup-eperm.md`.
4. Independent code review:
   `docs/features/verification-stage/2026-09-16-code-review.md` (`reconciled`,
   0 findings).
5. Updated `.claude/skills/run-buildworks/SKILL.md` to align the sample
   verified smoke output block with actual CLI outputs (exit 1 `target_unavailable`
   on non-git directory and exit 2 `unknown command bogus`).

**Completed (layer 1, guided project bootstrap):**
`docs/features/guided-project-bootstrap/plan.md` is `Implemented` — Tasks 1-10
shipped. `2026-09-13-plan-review.md` is `reconciled` (3 accepted, 0 open) and
`2026-09-13-code-review.md` is `reconciled` (8 accepted, 0 open).
`docs/runbooks/cli-operator.md` section 3 documents both guided paths.

**Completed (layer 2, fence anchoring and the idle timeout):** Written up
retrospectively at `docs/features/unfenced-json-extraction/plan.md`
(`Implemented`, `## Amendment (2026-09-14)`) and reviewed at
`2026-09-15-code-review.md`, which is `reconciled` as of 2026-09-16 with seven
findings, none open. Findings 1, 3 and 7 were fixed in `3235d23`; 2, 4, 5 and 6
were closed in `a420563`. Idle budget stays 1800 seconds everywhere, decided
only by the frozen sandbox (Hard Rule 6).

**The custom PRD exists and is committed:**
Committed at `.claude/skills/run-buildworks/target-tap-design.md` (18,912 bytes,
slug `target-tap`). The free smoke drove it 13/13 with a clean tree. **It has
never been run against a provider and has no cost history.** Two known gaps
before spending: scratch target frozen verification commands are only
`node --version` and `npm --version`, and PRD asks for five kinds of test that
nothing in the chain executes.

**Decisions locked:** Hard Rule 2 holds — the guided initializer lives inside
the existing CLI mutation authority; dashboard remains a read-only loopback
projection. Signing stays external via canonical bytes and detached signatures.
Single starter is `static-web`. Guided mode is interactive only and refuses
redirected input. Run identity is the exact project, feature ID, slug, and
change-kind tuple. The idle budget is 1800 seconds in the frozen sandbox.

**Implementation boundary:** Presentation narrows, never alters. Interactive UI
mutation, remote access, a second harness, a production executor switch, and
fabricated telemetry remain unauthorized. No paid execution is authorized.

**Running state:** Nothing is running — no dashboard, no browser automation, no
background agent, no paid process.

**Open/deferred:**
- Manual browser evaluation of the dashboard command center across themes and
  viewports.
- The deferred `RunSnapshot` agent-field projection keeps model, harness and
  duration rendering as unavailable.
- Production interactive guided mode is still proved as two composed checks
  because redirected stdin is refused by design.

**Next up:** The paid live chain against `target-tap` remains ready to
authorize and **not** authorized (declined on 2026-09-16 pending operator
decision on spend, budget, and the verification command scope).

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
- Presentation may narrow, never alter: collapse, shorten or aggregate a value
  only while it stays reachable and exact for assistive technology.
- Popover click triggers attaching document-level listeners must use `{ once: true }`
  or explicit cleanup; otherwise re-renders accumulate handlers and leak memory/events.
- Dashboard repository IDs in URL routes and APIs are deterministic base64url SHA-256
  hashes of the normalized worktree path; the pipeline Governance stage is a synthesized
  multi-stage gate projection with `stageId: null`.
- Scoping repository views in the dashboard requires filtering the views array fed to
  `portfolioProjection`, `commandCenterKpis`, `needsAttentionQueue`, and `governedDeliveriesRows`
  by `selectedRepositoryId || repositoryFilter`.
- Run identity has no uniqueness constraint in the schema, so a pre-prompt
  snapshot is stale by the time intake inserts. Re-query the exact project,
  feature ID, slug and change-kind tuple while holding the repository writer
  lock, or two ordinary guided processes create duplicate nonterminal runs.
- An expired approval handoff must be able to rotate. Move the whole handoff
  directory atomically, validate the moved payload, then create fresh canonical
  bytes; stale signature bytes are inert evidence, never a prerequisite for
  renewal and never submitted to `approveRun`.
- Compare committed blobs with LF source constants and compare the worktree with
  HEAD through Git. Byte-comparing generated constants against working-tree text
  rejects a clean `core.autocrlf=true` clone as a modified starter.
- Guided mode refuses redirected stdin by design, so automated proof composes
  real installed-shim execution with an injected-prompt journey. That
  composition is a stated limitation, not end-to-end evidence of the production
  interactive path.
- Guided routing treats the first argument as a target only when it is absolute,
  `.`, `..`, or starts with `.\`, `..\`, `./` or `../`; a bare name is parsed as
  a command and exits 2. No argument means the current directory, and `--repo`
  is refused in guided mode.
- `.governance/` ignore coverage is a doctor readiness check only.
  `checkIntakeRepository` filters the governance prefix out of its cleanliness
  test, so intake requires a readable HEAD, a clean tree excluding governance
  state, a committed `governed.yaml`, and (guided) a resolved
  `BW_APPROVAL_PUBLIC_KEY`.
- `doc-check` recognizes only backticked forward-slash paths under `src`,
  `test`, `scripts`, `docs` or `.claude`, and `docs/runbooks/**` is reference
  tier, where an unresolvable path is an error rather than a warning. Write
  generated example paths in the runbook's Windows backslash form.
- Anchor a closing code fence to the start of its own line. A non-greedy body
  match ending at a bare triple backtick terminates at the first one appearing
  *inside* a JSON string value, truncating the payload; a literal newline cannot
  appear unescaped inside a valid JSON string, so requiring a preceding newline
  is safe. This is hazard 1 item 9 and it cost $2.83862.
- `src/harness.ts` prefers a per-dispatch `invocation.idleTimeoutSeconds` over
  `executor.sandbox.idleTimeoutSeconds`, so a call-site override is live rather
  than decorative — check the call site before assuming the sandbox default
  governs a long dispatch.
- The dashboard reads `--repositories-file` once at startup and holds the list
  in memory. Adding or removing a target means editing the file and restarting
  the command, which mints a new ephemeral port and a new bearer token; the old
  URL is dead. There is no in-UI way to add a repository.
- `evidence.end(cb)` on a Node writable stream invokes `cb` on `'finish'` before
  the OS descriptor closes; callers performing immediate directory deletion on
  Windows race descriptor closure unless they wait for `'close'` (`evidence.closed`).
- Windows `taskkill /t /f` asynchronously terminates process trees; immediate
  synchronous `rmSync` on directory trees can race asynchronous kernel handle
  teardown, requiring `maxRetries` and `retryDelay` on recursive removals.

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
proposal; `2026-09-09-cli-github-impact-analysis.md` is closed history. The plan
review's 22 dispositions preserved full consent, complete arrays, raw approval
bytes and bootstrap criteria, and granted no spend.
`2026-09-10-cli-operator-implementation.txt` retains commands, ten late
mutations and full approval testing. Deviations: target-relative evidence,
disabled diff refresh, shared extraction; no stronger gate/schema. Standard I/O
is the runner seam, stages own gates, and an invocation never retries failed
groups including rolled-back delivery. Lowercase `# design` was required
grounding; ascending severity and unattempted-group accounting needed
correction. CLI 108 and full 1071 passed with one OS symlink skip. A follow-up
`gpt-5.5` review passed nine index/key-isolation/delivery-retry cases; DEP0190
had no retained traced origin, so no attribution was made.

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
semantics rather than Node `statSync` equivalence. The authorized live chain
used 16 dispatches/$2.4481306: one remediation landed, then final high finding 5
blocked code review at `511f64bbb34d3ed0c8066a7fd8fb4945dc6ba54e` with no
delivery. AC-013 maps Enter to equals, which the remediation's all-button
exception contradicts. Native browser ordering and generated-unit behavior
remain unverified; retained triage, live-run and recorded JSON files preserve
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
`270dc90fe939d3f1c60836a46151e361d37d6d47`; the final panel then blocked on high
AC-018 mobile overflow at `src/styles.css:60`, so delivery did not run. Both
security panels were clean and the audit chain was valid. Retained evidence is
in `.claude/sessions/2026-09-12-paid-web-calculator-code-review-block.md`; the
blocked run cannot receive another unreviewed remediation, and any replacement
paid run needs new authorization.

### Dashboard redesign: requirements, density triage, command center (2026-09-12/13, committed at `3415032`)

Three passes over the same read-only projection, retained in
`.claude/sessions/2026-09-12-requirements-dashboard-enterprise-redesign.md` and
`.claude/sessions/2026-09-12-requirements-dashboard-density-triage.md`. The plan
kept the HTTP and `RunSnapshot` contracts unchanged and added one pure checked
browser projection module in `src/dashboard/dashboard-model.js`, testable in
Node without DOM emulation; one self-review reconciled five findings, including
an invented out-of-window count and a command-formatting module cycle. The
operator then replaced hero-plus-collapse with six primary tabs, a KPI strip, an
interactive eight-stage pipeline, a Needs Attention queue and slide-over drawers
— still strictly read-only under Hard Rule 2 — and deferred the `RunSnapshot`
agent-field extension, so model, harness and duration stay unavailable.
Requested average execution time and trends have no `RunSnapshot` source and
render unavailable rather than substituting wall-clock or verification duration.
Governance is a synthesized cross-stage gate check keeping `stageId: null`. Code
review caught `aria-busy` never cleared on four session-unavailable early
returns, a token chart conflating reported zero with nothing reported, and a
popover listener leaking across renders; all were fixed with mutation-proved
regressions. Verified by `npm run typecheck`, `node --test
test/dashboard-ui.test.ts` 32/32, `npm test` 1177 pass, and `npm run
check:docs`.

### Guided project bootstrap implemented; instruction files resynced (2026-09-13/14)

#### Decisions and assumptions
- `docs/features/guided-project-bootstrap/plan.md` shipped Tasks 1-10 on branch
  `guided-project-bootstrap`: checkout-linked `buildworks`/`bw` aliases, the one
  `static-web` initializer in `src/project-bootstrap.ts`, shared run creation in
  `src/run-intake.ts`, and guided identity, consent, continuation and terminal
  reporting in `src/guided-command.ts`.
- Signing stayed external. Guided mode exports canonical payload bytes and
  imports a detached signature; it never creates, names, reads, or invokes a
  private key, and it never runs `scripts/sign-approval.mjs`.
- Interactive only by design: redirected input refuses before mutation or spend,
  each paid range takes its own explicit consent, and the first accepted range
  stops at approval with exit 3.

#### What failed
- Four confirmed review findings: concurrent exact-tuple intake, an expired
  handoff with no rotation path, a clean `core.autocrlf=true` clone rejected as
  a changed starter, and terminal rerun output without the block reason or
  findings. Four more surfaced on follow-up passes: malformed retained expiry
  presented for signing, missing reviewer attribution, a per-file archive
  validation-to-rename race, and a remediation that made an invalid stale
  signature block renewal. All eight were accepted and fixed; the closure review
  returned 0 findings.
- A full-suite attempt hit an intermittent Windows EPERM deleting its temporary
  directory. The test passed in isolation and the suite then passed; the
  analysis is retained in
  `.claude/sessions/2026-09-13-debug-verify-cleanup-eperm.md` and no retry or
  production workaround was added. This was the **first** occurrence; see the
  2026-09-15 record for the second, which activates that record's step 3.

#### What worked
- Eight isolated guard mutations failed their intended assertions and were
  restored to exact hashes.
- The fixture-backed journey completed every architecture stage, retained
  delivery evidence, verified the audit chain, and recorded USD 0, so the whole
  increment was proved without provider spend.
- `test/package-entrypoint.test.ts` exercised the real checkout-linked shims
  from outside the checkout rather than asserting package metadata.

#### Verification
- `npm test` 1,173 passed / 5 skipped; `npm run typecheck`, `npm run
  check:docs` and `git --no-pager diff --check` clean; free smoke 13/13.

#### Documentation sync (2026-09-14)
- Edit `CLAUDE.md`, copy to `AGENTS.md`, then compare hashes — they must stay
  byte-identical, and both carry the guided entrypoint and the `dashboard`
  command, the only command that refuses `--repo`.
- `docs/runbooks/cli-operator.md` section 3 split into "Initialize a new
  project" and "Select an existing project"; a stated requirement for committed
  `.governance/` ignore coverage was removed as false — that check exists only
  in `inspectReadiness`, not `checkIntakeRepository`.
- `driver.mjs clean` was deliberately not run, because it deletes retained
  paid-evidence targets too.

## Dashboard launch, and an undocumented second layer discovered (2026-09-15)

### Decisions and assumptions
- The operator asked only to launch the dashboard and add a second repository;
  no commit, review, or spend was authorized, and none happened.
- Targets were chosen by the assistant from this file's recorded paths, not by
  operator instruction: the surviving paid target plus the operator-named
  `C:\Repositories\testing-repos\simple-game-test`.
- The repositories file is machine-local at
  `C:\Users\tamezs\.copilot\session-state\d4c9f2f8-18c6-4755-a0d8-b45098406e5b\files\dashboard-repositories.json`
  and is deliberately outside the repository; it is disposable, and its one
  `repositories` member takes unique absolute paths only.
- Asked which work to start next, the operator was unavailable, so the
  assistant began the recommended option — review and document layer 2 — and
  reached the reading and tracing stage before compaction.

### What failed
- `npm test` failed at 1,175 passed / 1 failed / 5 skipped after 769 s. The one
  failure is `test/verify-command.test.ts:134`, EPERM removing
  `bw-verify-cmd-*` from `%TEMP%`, with the functional process-tree assertions
  already passed. **Second occurrence**, same signature as 2026-09-13, so the
  debug record's step 3 now governs: preserve handle evidence, investigate open
  handles, add no blind retry. `withRoot` already passes `force: true`, which
  does not suppress EPERM.
- The previous resume point was stale in two ways that mattered: it undercounted
  the working set (23+10 against an actual 33+11) and it listed two temp targets
  that no longer exist. A recorded path is not evidence the path still exists.

### What worked
- Isolated rerun passed in 2.9 s, confirming load-dependence rather than a
  deterministic defect: `node --test --test-name-pattern "a hung command is
  killed with its whole tree at the ceiling" test\verify-command.test.ts`.
- Tracing `src/harness.ts` settled that the layer-2 per-dispatch
  `idleTimeoutSeconds` override is honored rather than dead code — the sandbox
  default is only a fallback.

### Running state
- Dashboard server: `http://127.0.0.1:61419`, launched from this checkout over
  the two targets above - read-only loopback projection, no writer, no
  dispatch - attached to the Copilot session that started it and stopped by
  ending that session; PID `unknown`.
- An earlier instance on port 56248 was stopped when the second repository was
  added; its URL and token are dead.

### Verification
- `npm run typecheck` - clean across both programs.
- `npm run check:docs` - `doc-check: clean`, 74 pre-existing warnings.
- `npm test` - 1,175 passed, 1 failed, 5 skipped (the EPERM race above).
- `Invoke-WebRequest http://127.0.0.1:61419/` - HTTP 200, 5,615 bytes.
- `git status --porcelain` - 33 modified, 11 untracked, HEAD `3415032`.
- `git --no-pager diff --check` - **not clean**: "new blank line at EOF" at
  `test/recorded-implementation-response.test.ts:79`, introduced by layer 2.
  Left unfixed deliberately, because editing unreviewed code during a
  compaction pass is not this step's job (closed in `a420563`).

### Next time
- Check `git status --porcelain` against the recorded file counts before
  trusting a resume point; a count mismatch means an undocumented layer.
- Re-test recorded external paths before reusing them. Temp-directory targets
  on this host expire at logoff and two did.
- When a documented debug record states a conditional next step, the recurrence
  is the trigger — read the record before re-diagnosing the same symptom.

### Verify-command EPERM cleanup race diagnosed, fixed, and reviewed (2026-09-16)

#### Decisions and assumptions
- Investigated and resolved the recurring Windows EPERM failure in
  `test/verify-command.test.ts` ("a hung command is killed with its whole tree at
  the ceiling") without relaxing functional assertions or altering process
  termination contracts.
- Applied Node.js stream lifecycle semantics: await `'close'` rather than
  `'finish'` in `src/verify-command.ts`.
- Added standard Node.js `rmSync` retry options (`maxRetries: 3, retryDelay: 50`)
  in `test/verify-command.test.ts` to absorb transient NTFS handle table and
  process teardown latency.

#### What failed
- `test/verify-command.test.ts:134`: EPERM removing temporary directory
  `%TEMP%\bw-verify-cmd-*` during full-suite execution. Empirical probes proved
  `evidence.end(cb)` executes `cb` on `'finish'` while `evidence.fd` is still
  open (`closed: false`, `fd = 3`). Fast test resolution (<1ms) raced
  `withRoot`'s `finally { rmSync(root) }`.
- In addition, Windows `taskkill /t /f` terminates child processes
  asynchronously; synchronous directory deletion immediately after resolution
  races kernel handle release.

#### What worked
- `src/verify-command.ts`: `settle()` modified to wait for the `evidence`
  stream's `'close'` event (or verify `evidence.closed`), ensuring the descriptor
  is null and OS handle closed before returning.
- `test/verify-command.test.ts`: `withRoot` updated with
  `{ maxRetries: 3, retryDelay: 50 }` on `rmSync`.
- Empirical test script proved the race and verified both descriptor closure
  and `rmSync` resilience.

#### Verification
- `npm run typecheck` - clean.
- `node --test test/verify-command.test.ts` - 8 passed, 0 failed.
- `npm test` - 1,183 tests, 1,178 passed, 5 skipped, 0 failed.
- `npm run check:docs` - clean.
- Code review at `docs/features/verification-stage/2026-09-16-code-review.md` -
  `reconciled`, 0 findings.

#### Next up
- Commit the `verify-command` cleanup fix, debug record, code review, and
  learning record update.

