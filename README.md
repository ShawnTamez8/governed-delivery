# BuildWorks

A repo-native control plane for AI-assisted software delivery. The system
name is configuration; BuildWorks is the default.

> A governed agentic SDLC

Agents reason, draft, implement, review, and summarize. They never approve their
own work, advance authoritative state, bypass policy, or write without
validation.

## Status

The local operator CLI provides no-spend readiness and inspection, explicit
run creation, consent-bounded continuation, and external approval file
transport. It also launches an authorized loopback-only, read-only dashboard
over explicitly selected local repositories. See the
[operator guide](#local-operator-guide). `bw` in the
description below is shorthand for the checkout-local Node invocation, not
an executable installed on PATH by `npm install`.

Build order steps 1-8 implemented: run store, stage chain, and audit chain
over SQLite; the concrete harness adapter (`bw dispatch` spawns the `claude`
CLI, parses its envelope, retains raw output, and persists `agent_run` rows);
the spec and spec-review stages (`bw spec` runs the author, one self-critique
dispatch, an author-proposed specialist panel, the author's reconciliation of
every finding into one typed decision each, and a deterministic gate that
decides on decision completeness for each configured review round); the human
approval gate
(`bw approval-request` prints the payload, `bw approve` verifies one Ed25519
authorization against a public key held outside the repository); and the plan
and plan-review stages (`bw plan` builds the plan from the approved
specification, re-verified against the hash the review gate recorded, and an
ID-based coverage gate requires every approved acceptance-criterion ID exactly
once, refuses unknown or repeated IDs, then refuses any covered artifact outside
the signed scope before a panel is convened); and the implementation stage
(`bw implement` creates the run's worktree on branch `gov/<slug>/<run-id>`,
commits the projections, dispatches an implementer, and applies each proposed
patch only when it binds to the recorded base commit and stays inside the
signed scope — one commit per patch, the worktree retained when the gate
blocks); and the verification stage (`bw verify` runs the commands frozen at
run start from the committed `governed.yaml` inside that worktree, under a
named environment passthrough and bounded per-command time and output limits,
proving the worktree still holds the commit implementation left and is clean
before and after every command, retaining each command's complete output, and
handing the next stage a structured record naming the worktree and the
verified commit); the code review stage (`bw review` — a frozen panel of two
specialized code reviewers by default reads the verified change against the
approved specification and plan, with the worktree as a read-only working
directory; while another configured panel execution remains, all actionable
findings are sent together to the frozen implementer, the resulting commit is
verified with the frozen commands, and the full panel reviews it again; the
last panel retains below-threshold findings without blocking and blocks only
on findings at or above the independently frozen severity threshold); and
the delivery stage (`bw deliver` — the final
deterministic gate, no dispatch and no model: it re-reads the verification
record and the code-review record it is handed, cross-checks the two, re-reads
the retained worktree, diffs the patch range between the recorded
base and the final reviewed, verified commit, and completes the run only when every declared
artifact the operator signed for appears there as an exact changed path —
otherwise it blocks the run naming what is missing). The model each stage
uses is frozen
at `bw new-run --model` and every spend entry point checks it. Plus the
documentation checker. Commands: see [`CLAUDE.md`](CLAUDE.md).

Step 5b shipped: an author-led correction to the two review stages.
[`docs/features/step5b-upstream-findings/plan.md`](docs/features/step5b-upstream-findings/plan.md)
replaced the closure-round review loop with the five-phase flow named above —
run for each of the profile's configured review rounds (one by default), gated
once over every round's decisions rather than looping until a panel returns
empty — and gave a concern whose cause is upstream of the reviewed artifact a
destination other than another author round: `upstream_follow_up` writes a
stored, non-binding proposal and the run continues; `upstream_blocking` writes
one and blocks. No run writes into `docs/proposals/`; `bw proposal-export` is
the explicit human command that materializes a stored proposal there, and
promotion to active work stays a human `git mv`. Step 8 shipped next:
[`docs/features/delivery-check/plan.md`](docs/features/delivery-check/plan.md)
implemented the terminal delivery check described above — the delivery_check
stage, `bw deliver`, and the audit events that transition a run to
`completed` or `blocked`. All eight build-order stages exist, and step 9's
stop — one feature run reaching `completed` with queryable per-stage cost —
was met on 2026-09-03. The first stage past that stop exists by explicit
operator decision on 2026-09-04 and by that decision alone:
[`docs/features/code-review-stage/plan.md`](docs/features/code-review-stage/plan.md)
added `code_review` between verification and delivery, because a run had
delivered every declared artifact and passed every gate while nothing in the
system had read the code. The five stages still deferred in
[`ARCHITECTURE.md`](ARCHITECTURE.md) section 5 each need their own decision.
An operator-authorized live run on 2026-09-11 on the `web-calculator` design
completed all stages including the code-review remediation loop (16 dispatches,
total cost $2.05854, 2 panel executions, 1 remediation, final commit verified,
6 declared artifacts delivered, run completed, and audit chain valid), preserved
in durable target storage at `C:\Users\tamezs\buildWorks_test_repos`.

The code-review controls live together in [`src/policy.ts`](src/policy.ts) and
are frozen into each new run's profile:

| Constant | Default | Legal range / effect |
| --- | --- | --- |
| `CODE_REVIEW_PANEL_SIZE` | `2` | `2`–`5`; increasing it also requires enough registered `code-findings` reviewers with distinct, non-empty specialist instructions. |
| `CODE_REVIEW_MAX_ROUNDS` | `2` | `1`–`5` total full-panel executions; `1` disables remediation because no re-review remains. |
| `CODE_REVIEW_BLOCKING_SEVERITY` | `high` | Release-policy threshold applied only to the final panel in the frozen severity order. |

Changing one of these constants affects profiles frozen by later `new-run`
commands only. It does not rewrite an in-flight run, and changing the final
threshold does not require changing the review-loop implementation.

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the design, and its binding
  constraints.
- [`docs/hazards.md`](docs/hazards.md) — failure modes this kind of system
  is subject to, and what each requires.
- [`CLAUDE.md`](CLAUDE.md) — how to work in this repository.

## Local operator guide

For a start-to-finish procedure, use the
[CLI operator runbook](docs/runbooks/cli-operator.md). It covers first-time
project setup, external approval, delivery inspection, and troubleshooting
with user-selected paths. The reference below details the command contracts.

This guide lets an operator inspect and advance an existing local delivery
chain without manually sequencing its stages. It does not publish to GitHub,
merge branches, sign on the operator's behalf, or recover partial stages.

### Prepare the checkout and target

Use Node >=24, Git, and the native Claude Code executable on PATH. Install
this checkout's development dependencies once with `npm install` from the
BuildWorks checkout. There is no build, npm-link, or distributed-package
installation step; SQL and other runtime assets resolve beside the checkout.

Set absolute paths in PowerShell. The target is an existing, separate Git
worktree, not the BuildWorks checkout. Replace these example directories with
your own; spaces are supported.

```powershell
$BuildWorksCheckout = (Resolve-Path -LiteralPath 'C:\Repositories\AI.Tools\governed-delivery').Path
$BwCli = Join-Path $BuildWorksCheckout 'src\cli.ts'
$BwSigner = Join-Path $BuildWorksCheckout 'scripts\sign-approval.mjs'
$Target = (Resolve-Path -LiteralPath 'C:\Work\Target Project').Path
$OperatorDirectory = (Resolve-Path -LiteralPath 'C:\Operator Keys').Path
$env:BW_APPROVAL_PUBLIC_KEY = Join-Path $OperatorDirectory 'approval.pub'
$OperatorKeyFile = Join-Path $OperatorDirectory 'approval.key'
$Project = 'local-project'
$FeatureId = 'calculator-1'
$Slug = 'calculator'
$Model = Read-Host 'Authorized Claude model name to freeze for this run'
```

The operator directory and signing key must be outside every repository.
Use an existing PEM Ed25519 key pair. If a new pair is needed, the operator
can separately run `& node $BwSigner keygen --out $OperatorDirectory`;
that tool writes `approval.key` and `approval.pub` and refuses to replace an
existing private key. Never give the private key to the CLI or an agent.
Configure the public key before intake to bind its fingerprint into the
frozen profile; a run created without that binding has only a partial signer
guarantee, which later setup does not retroactively strengthen.

The target must have a readable HEAD, a clean working tree, a committed
`.gitignore` rule for `.governance/`, and committed verification configuration
named `governed.yaml` at its root. Author and commit the design at the path
constructed by `Join-Path $Target "docs\features\$Slug\design.md"`.
The target's design/configuration are inputs, not files this guide creates.

The verification parser accepts only a `verify:` block followed by named
commands in the shown key order, with every argv token double-quoted.
This minimal valid example checks **only the Node version**, not the product:

```yaml
verify:
  - name: unit
    command: ["node", "--version"]
```

Choose real project verification commands before creating a run. Their names
must be unique and filename-safe; command tokens cannot contain spaces,
quotes, or shell metacharacters. A target directory can contain spaces even
though a command token cannot. Configuration, models, agent definitions,
review limits, and verification commands freeze at `new-run`, not at each
continuation.

### Inspect without spending

```powershell
& node $BwCli --help
& node $BwCli help run
& node $BwCli doctor --repo $Target --slug $Slug
& node $BwCli runs --repo $Target --json
```

Help opens no state and resolves no target. `doctor` checks local prerequisites
and the fixed native version probe, bounded at five seconds; it does not check
provider authentication, model entitlement, quota, or private-key availability.
Its `PASS`, `FAIL`, and `NOT CHECKED` entries retain evidence and repair advice.
Without a selector it checks current repository/configuration readiness;
`--slug` adds design checks, while `--run` adds frozen-run diagnostics. Do not
combine the two selectors. Current defaults remain distinct from frozen facts;
doctor never executes an arbitrary probe found in a retained profile.

Doctor supplies its version probe with the same named-variable environment
filter as harness invocation. It selects and probes one absolute native
executable, reporting its selected path, invocation cwd, and successful
version output. `--repo` does not change executable search to the target
directory. This is current evidence, including under `--run`, not a frozen
binary identity or a pin for later dispatches in different worktree cwds.
Version output proves neither executable origin nor a supported installation.

The non-gating `ambient_provider_config` check reports environment presence
and whether BuildWorks supplies each named variable to the child. Windows
can add required system variables beyond that supplied map. The current
filter excludes `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_BASE_URL`,
and `CLAUDE_CONFIG_DIR`, so they can be present but not supplied. Their values
and value hashes are never reported; an excluded config-directory override
does not redirect this inventory.

The inventory observes only `.claude/settings.json` (`user_settings`) and
`.claude.json` (`user_state`) beneath the passed-through absolute, non-empty
`USERPROFILE` on Windows or `HOME` on POSIX, using native path separators.
Each regular file has a one-MiB read ceiling. Missing files are `absent`;
unavailable home, linked/special/unreadable/oversized files, read failures, or
detected changes yield `unavailable` with a reason and no content hash.
Either unavailable file makes this check `NOT CHECKED`, never a readiness
failure or repair requirement. The byte limits do not bound OS filesystem
latency; the five-second timeout bounds the version probe, not all of doctor.
These best-effort observations do not establish managed/project settings,
OS home fallback, actual file use under native flags, or effective precedence.

**Treat either output format as sensitive local operational data.** Absolute
paths, sizes, and full SHA-256 comparison hashes can identify a workstation or
confirm a candidate file; they are not anonymization. The whole-file hash
intentionally includes `user_state` despite its possible sign-in/trust state.
It detects byte changes, including same-size edits, without identifying the
changed field or parsing individual credentials. Review reports before
redirecting or sharing them. Doctor adds no diagnostic persistence or transmission.

Before state exists, `runs` reports `state_missing` and exits 1; it does not
initialize a database. An existing empty store returns an empty array and
exit 0. Inventory is newest-first, defaults to 20, accepts `--limit` 1-100,
and reports `hasMore`. It never chooses a run for execution.

Every command except `dashboard` accepts `--repo` once, before or after its
name. It selects the
canonical Git worktree root, including from a child directory or junction.
Omitting it targets the invocation directory's worktree. User-supplied
prompt, payload, and signature paths instead resolve from the original
invocation directory; absolute transport paths avoid ambiguity. Stored relative
evidence resolves against the target, while absolute evidence stays absolute.
Moving files does not relocate a retained run.

Unknown options, duplicates, extra positional arguments, empty values, invalid
identities/models, and unsafe numeric IDs are usage errors. Values accept
`--name value` or `--name=value`; booleans such as `--yes` and `--json` must
be bare flags. Help still refuses unknown commands/options.

### Launch the read-only dashboard

The dashboard takes one repositories file instead of `--repo`. The file is
resolved from the original invocation directory and must be UTF-8 JSON with
exactly this shape:

```json
{
  "repositories": [
    "C:\\Work\\Target Project",
    "C:\\Work\\Second Project"
  ]
}
```

The list must be non-empty and contain unique absolute paths. One leading UTF-8
BOM is accepted for compatibility with Windows PowerShell output; empty,
BOM-only, malformed, relative, duplicate, or extra-member input is refused as
usage. The list stays in process memory and is never copied into a repository.
Each target retains its own `.governance/state.db`.

```powershell
$RepositoriesFile = Join-Path $OperatorDirectory 'dashboard-repositories.json'
@{ repositories = @($Target, 'C:\Work\Second Project') } |
  ConvertTo-Json |
  Set-Content -LiteralPath $RepositoriesFile -Encoding utf8
& node $BwCli dashboard --repositories-file $RepositoriesFile
```

The command binds an ephemeral listener only to `127.0.0.1`, prints exactly one
bootstrap URL, and waits. Open that URL manually in a current local browser.
Its fragment contains a random process-lifetime bearer token. The browser moves
the token into tab-scoped session storage and removes it from the visible URL;
reload works in that tab, but a token-free URL opened in another tab does not.
Return to the terminal's original URL if the session is unavailable. The token
does not rotate, survive process exit, or authorize any CLI operation.

Refresh is explicit: there is no polling, push, or WebSocket connection. Choose
a run-list limit from 1 through 100. Each repository is read independently
through the same exact-current `runs` and `status` services as the CLI. A
successful prior value remains visibly stale, with its original envelope
`observedAt`, when a later read refuses or transport fails; the new code and
reason are shown beside it. One repository's refusal does not suppress another
repository's successful result. The first release performs synchronous,
serialized Git, SQLite, and evidence reads, so one slow local or network-backed
repository can delay other requests.

The dashboard returns complete snapshots and arrays without a response-size
ceiling or hidden pagination. It displays projected evidence references and
availability reasons, but serves no evidence file contents or unrestricted
filesystem path. Displayed CLI handoffs are copy-only text. The dashboard never
executes them, opens a writer, migrates or repairs state, collects consent,
approval, or signatures, listens remotely, or persists dashboard state.

#### What the dashboard presents

The page opens on eight portfolio measures: runs, blocked runs, active runs,
findings, known cost, total tokens, success rate, and average execution time.
Their scope is every run in the loaded window across every configured
repository. The repository run limit narrows that window and the page says so
whenever any repository reports more runs beyond the limit; the read route
reports no total, so the page never states how many runs lie outside it. The
status and phase filters and the run search change only which runs are listed.
They never change a portfolio measure.

Unavailable is never rendered as zero. A token class no agent row reported,
spend no row reported, and findings no loaded snapshot supplied each read
`Unavailable` with the coverage that produced it. Average execution time is
permanently unavailable because the projection records no agent execution
duration, and trend is unavailable everywhere because no historical series
exists. Agent rows carry no model: the projection binds none.

Below the portfolio, one repository panel per configured repository lists its
loaded runs; selecting a run loads that run alone through the same `status`
route and gives it its own cache slot, so one run's refusal never shows another
run's evidence. The selected run renders its recorded limitations first, then a
stage timeline in recorded order, a bounded recorded-activity list, cost and
token coverage with SVG charts, per-agent analytics, one card per canonical
finding with every immutable report kept separate, the copy-only governance
commands, the frozen configuration, approval, and proposals, delivery and
verification observations, and evidence availability.

Every chart is decoration over a table: each carries an accessible title and
description, a text legend, and a disclosure holding the exact values. A
proportional chart is refused rather than drawn when no group reported a cost.
Colour never carries meaning alone — every state also has a text label and a
non-colour icon — and the palette drops out entirely under forced colours.
Light and dark themes both meet the 4.5:1 text contrast requirement, which
`npm test` checks by computing WCAG relative luminance from the declared
tokens.

Use Ctrl+C to close the listener. A handled `SIGINT`, and `SIGTERM` on platforms
that deliver it to Node, closes the listener once and exits 0. Windows process
termination APIs can terminate the process without delivering `SIGTERM`;
startup or handled close failure exits 1 and does not print a successful URL.
`dashboard --help` reads no repositories file or target. `dashboard` rejects
both `--repo` and `--json`.

### Create an explicit run and consent to execution

Creation requires every identity field and the operator-selected model. It
prints only the numeric run ID on success, not a new-command JSON envelope.

```powershell
$RunIdText = & node $BwCli new-run --repo $Target --project $Project --feature $FeatureId --slug $Slug --change-kind feature --model $Model
if ($LASTEXITCODE -ne 0) { throw 'Run creation failed; inspect its diagnostic.' }
$RunId = [long]$RunIdText
& node $BwCli doctor --repo $Target --run $RunId
& node $BwCli status --repo $Target --run $RunId
```

Use `defect_fix` instead of `feature` for a defect run. A freeze failure can
leave a blocked run; its diagnostic names the ID. Inspect it rather than
assuming no state was created.

`run --run` displays the frozen models, remaining groups, actual verification
argv, review budgets, and dispatch ceilings before asking a TTY for explicit
`yes`. Redirected stdin or `--json` requires `--yes` and never waits for a
prompt. Decline, EOF, or prompt cancellation executes nothing.

**`--yes` authorizes every group in this invocation's preview**, including
bounded internal remediation, through approval or terminalization. It is not
single-stage consent, a hard dollar cap, signature authority, or permission
for another invocation. There is no voluntary stop-after control. Interrupting
execution does not promise cleanup or resumability.

Only run the following block when you consent to that full range:

```powershell
& node $BwCli run --repo $Target --run $RunId --yes
if ($LASTEXITCODE -ne 3) { throw 'Expected the approval pause; inspect the returned result.' }
```

The first invocation runs spec and spec review, then returns control at
`awaiting_approval` with exit 3 and no held writer lock. No pending approval
row is required for this pause. The persisted run can still be `in_progress`;
the derived phase is not another stored lifecycle.

### Review and sign outside the CLI

Read the reviewed specification and the displayed scope, risk, spec hash,
starting commit, profile hash, and signer readiness. Missing or mismatched
public-key readiness withholds actionable signing/submission instructions.
The CLI never opens a private key or runs the signer.

Use the **same expiry** for export and submission. The pause supplies a
prospective value in its action arguments; it is not a granted authorization.
Choose new payload/signature filenames under an existing operator directory:

```powershell
$StatusJson = & node $BwCli status --repo $Target --run $RunId --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the approval boundary.' }
$Snapshot = ($StatusJson | ConvertFrom-Json).result
$Request = $Snapshot.operatorActions | Where-Object kind -eq 'approval_request'
$Submit = $Snapshot.operatorActions | Where-Object kind -eq 'approval_submit'
if (-not $Request.eligible -or -not $Submit.eligible) { throw 'Approval actions are not ready.' }
$ExpiresIndex = [array]::IndexOf($Request.args, '--expires')
$Expires = $Request.args[$ExpiresIndex + 1]
$PayloadFile = Join-Path $OperatorDirectory "run-$RunId-payload.txt"
$SignatureFile = Join-Path $OperatorDirectory "run-$RunId-signature.txt"
& node $BwCli approval-request --repo $Target --run $RunId --expires $Expires --out $PayloadFile
if ($LASTEXITCODE -ne 0) { throw 'Payload export failed; do not sign.' }
```

Export exclusively creates the exact canonical UTF-8 payload, without BOM or
trailing newline. It does not create parents or overwrite files. Without
`--out`, the legacy command writes those same raw bytes to stdout; neither
form grants approval.

The next block is a **separate operator signing decision**, after reviewing
the bound work and payload:

```powershell
if (Test-Path -LiteralPath $SignatureFile) { throw 'Choose a new signature filename.' }
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Signature = Get-Content -LiteralPath $PayloadFile -Raw -Encoding utf8 | & node $BwSigner sign --key $OperatorKeyFile
if ($LASTEXITCODE -ne 0) { throw 'External signing failed; do not submit.' }
$Signature | Set-Content -LiteralPath $SignatureFile -Encoding utf8
& node $BwCli approve --repo $Target --run $RunId --expires $Expires --signature-file $SignatureFile
if ($LASTEXITCODE -ne 0) { throw 'Approval was not recorded; do not continue.' }
```

The existing signer handles PowerShell BOM/CRLF transport. `--signature-file`
accepts UTF-8, an optional leading BOM, and surrounding whitespace; unreadable
or empty input is usage exit 2. Internal whitespace, malformed signatures,
expired submissions, changed bindings/policy/key, and duplicates remain core
refusals with their audit behavior. `--signature` remains available but cannot
be combined with `--signature-file`. Expiry is checked at acceptance: it does
not revoke an already granted approval.

### Continue and inspect delivery

Approval does not execute later stages. A fresh invocation needs new execution
consent; this range runs plan/review, implementation, verification, code review
with its frozen remediation budget, and deterministic delivery:

```powershell
& node $BwCli run --repo $Target --run $RunId --yes
if ($LASTEXITCODE -ne 0) { throw 'Delivery did not complete; inspect the result before any further action.' }
$StatusJson = & node $BwCli status --repo $Target --run $RunId --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the delivery record.' }
$Snapshot = ($StatusJson | ConvertFrom-Json).result
$Snapshot.configuration.verificationCommands | Format-Table name, argv
$Snapshot.delivery
$Snapshot.evidence.references | Format-Table kind, availability, ref, reason
```

The result names the recorded branch, worktree, patch base, initial verified
commit, final reviewed commit, delivered commit, and declared/delivered/missing
paths. Follow its evidence references for command logs, review records/reports,
delivery records/reports, and raw-output locations. Completion means the
declared artifacts changed and the frozen gates passed, not that the product
is correct. A profile whose commands are only `node --version` or
`npm --version` has no application-test evidence. Final below-threshold
findings remain recorded, not harmless or fixed; historical findings keep
their immutable reviewer attribution.

Repeating a completed `run` buys no work. Terminal records remain inspectable
even if a retained worktree later disappears; unavailable evidence is labelled,
not silently reconstructed. Stored upstream proposals have their own explicit
operator action, including on blocked/completed runs:

```powershell
# Select an actual proposal ID from $Snapshot.proposals first.
& node $BwCli proposal-export --repo $Target --proposal $ProposalId --name $ProposalName
```

Export creates a new target backlog document without overwrite and appends
the existing human audit event. It does not reopen execution, change signed
scope, or publish to GitHub. Neither `run` nor `--yes` invokes it.

### Output contracts and refusal handling

`doctor`, `runs`, `status`, and `run` accept `--json`. They write exactly one
JSON object and one terminating newline to stdout, including errors. Progress
and operational diagnostics use stderr. Do not merge stderr into a JSON
capture. Help is always plain text, and legacy numeric/path/raw-payload command
outputs are unchanged.

Dashboard inventory is a separate HTTP response containing one server
observation time, the absolute current CLI path, and each submitted repository
path with its opaque stable identifier. That inventory time is not repository
or run evidence. Authenticated run-list and selected-run routes return the
complete existing operator envelope unchanged. A core read refusal such as
`state_missing`, `schema_unsupported`, `state_unavailable`,
`target_unavailable`, or `run_missing` therefore uses HTTP 200 and retains its
named envelope outcome, code, reason, repository, run ID, and `observedAt`.
HTTP 400 is limited to invalid request values, 401 to an absent or rejected
bearer token, 404 to an unknown route/repository identifier or malformed run
identifier, and 405 to every non-`GET` request. Only 401 expires the browser
session.

The envelope is `{ command, outcome, repository, runId, errorCode, reason,
observedAt, result }`. `observedAt` is the observation timestamp, not an agent
start. `repository` is null before target resolution, `runId` is null when no
run is selected, and `result` is null when unavailable. Successful inspection,
completion, and approval pauses have null `errorCode`/`reason`.

| Command | `result` fields | `outcome` |
| --- | --- | --- |
| `doctor` | `checks`, `current`, `frozen`, `limitations` | `ready`, `not_ready`, `error` |
| `runs` | `runs`, `limit`, `hasMore` | `ok`, `state_missing`, `error` |
| `status` | The complete snapshot below | `ok`, `state_missing`, `run_missing`, `error` |
| `run` | `snapshot`, `execution` | `completed`, `awaiting_approval`, `consent_required`, `refused`, `blocked`, `failed` |

Doctor checks contain `name`, `status` (`pass`, `fail`, `not_checked`),
`evidence`, and nullable `repair`. `current` contains `systemName`,
`nodeVersion`, `minimumNodeMajor`, `gitVersion`, `startingCommit`,
`verification`, `policy`, `policyHash`, `agentIds`, `executor`, and
`approvalSigner`, and `ambientProviderConfig`. `executor` retains its configured
`id`, `command`, `probe`, and `capabilities`, and adds nullable `resolvedPath`,
`probeCwd`, and nullable `versionOutput`. The selected path remains visible
after launch failure; version output is null on failure or an empty response.
`ambientProviderConfig` contains `environment`, `homeVariable`, and exactly two
`files` records. Environment entries contain `name`, `present`, `passedToChild`,
and nullable `valueHash`, sorted by name. Only present `PATH`, `HOME`,
`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, and `SystemRoot` receive
value hashes. Each file contains `name`, nullable `path`, `state`, nullable
`sizeBytes`, nullable `contentHash`, and nullable `reason`; only a complete,
stable, readable observation carries an exact-byte hash.
`frozen` is the selected run's configuration below or null;
unavailable frozen fields are never replaced with current defaults.

Run inventory entries contain `id`, `project`, `featureId`, `slug`, `status`,
`phase`, and `lastRecordedAt`. A selected snapshot has these sections; arrays
are complete, with no silent truncation or pagination:

| Snapshot section | Contents |
| --- | --- |
| `run` | `id`, `project`, `featureId`, `slug`, `changeKind`, persisted `status`, `createdAt`, `updatedAt`. |
| `phase` | `ready`, `awaiting_approval`, `blocked`, `completed`, or `interrupted_or_inconsistent`. |
| `stages` | Ordered IDs/kinds/ordinals, predecessor/output refs, status/gate result, stored start/end times, and labelled `startEvidence`. |
| `workflowAction` | `group`, `eligible`, all `reasons` (`code`, `reason`), `command`, `args`. The existing next group only, not a recovery instruction. |
| `operatorActions` | Separate action `kind`, command/args, eligibility/reason, proposal ID/route/title, and evidence ref. |
| `proposals` | Stored proposal identity, source run/stage/finding IDs, title/problem/upstream rationale, route, evidence ref, and creation time. |
| `configuration` | `systemName`, `profileHash`, `policyHash`, `startingCommit`, `modelMap`, `verificationCommands`, `documentReview`, `codeReview`, `deadline`, `approvalSigner`; unavailable values are null. |
| `approval` | `missing`/`granted` state, ID, feature/signer, scope/risk, spec/start/profile bindings, expiry and creation time. |
| `cost` | USD known subtotal, agent-row and reported/unreported coverage, token coverage, recorded failed attempts, `byStage`, `byAgent`. |
| `activity` | `lastRecordedAt` and nullable `lastEvent` with ID/action/summary/time. |
| `writer` | Observed `status` (`absent`, `live`, `dead`, `unreadable`), path, PID, creation time, reason; never an active-run identity. |
| `delivery` | Stage/outcome, branch/worktree, patch/verified/reviewed/delivered commits, path sets, verification observations, result/report refs. |
| `evidence` | References with availability/reason, canonical findings and immutable reports/decisions; `finalPanelBlocking` is null unless the final panel is bound. |
| `limitations` | Explicit unavailable, partial, or unproven evidence. No raw provider bodies or prompts are embedded in the snapshot. |

Exact nested field names/types are exported as `RunSnapshot` in
[`src/operator-state.ts`](src/operator-state.ts) and as result types in
[`src/operator-output.ts`](src/operator-output.ts). Evidence availability is
`available`, `missing`, `unverified`, or `inconsistent`; availability alone
is not proof that every part of a retained record was validated.

`execution` contains `consent` (`not_needed`, `required`, `declined`,
`granted`), `groupsAttempted`, `groupsCompleted`, `remainingGroups`,
`startedAt`, `endedAt`, and `elapsedMs`. Unstarted invocation times are null.
Group names are `spec`, `plan`, `implementation`, `verification`, `code_review`,
and `delivery_check`. Remaining groups are invocation accounting, not permission
to retry a failed or ineligible group.

Known cost is summed from selected-run agent rows before report fan-out.
Null telemetry is not zero: `costReportedRows`/`costUnreportedRows` and each
token field's `known`/`reportedRows`/`unreportedRows` expose coverage. Failed
dispatches without agent rows are counted from audit, not assigned invented
spend or raw filenames. This is not a complete bill or live cost meter.
The 15-second stderr heartbeat is an elapsed observation while async work
yields; synchronous delivery emits start/end only, and other synchronous work
can delay timers. Neither a lock PID nor heartbeat identifies an active agent.

| Exit | Meaning |
| --- | --- |
| `0` | Successful inspection/readiness; for `run`, completed delivery only. A readable blocked-run `status` still succeeds. |
| `1` | Operational refusal, missing state/run, failed readiness, consent required/declined, block, or execution failure. |
| `2` | Invalid command-line usage. |
| `3` | `run` reached a valid human approval pause. |

The closed `errorCode` set is `usage`, `target_unavailable`, `state_missing`,
`schema_unsupported`, `state_unavailable`, `run_missing`, `setup_required`,
`writer_contention`, `consent_required`, `observation_changed`, `run_aged`,
`chain_incomplete`, `evidence_invalid`, `policy_block`, and `execution_failed`.
`reason` retains the originating diagnostic. Ineligible snapshot actions carry
their own reasons without turning a successful `status` into an error.

Inspection opens only existing exact-current state read-only, with a short
deferred snapshot and one bounded SQLite wait (1,000 ms). It never migrates,
creates state/locks, takes over a dead lock, refreshes the Git index, or repairs
a hot journal. SQLite may refuse a read that needs writer-side crash recovery.
Use the matching checkout for newer schemas; apply an older schema's migrations
only through an explicit writer action such as
`& node $BwCli migrate --repo $Target`, following its diagnostic.

Guided entry checks the exact-current schema before and after consent; consent
cannot authorize a migration or an expanded range after observation changes.
It accepts only intact passed stage-group boundaries. Partial/manual chains,
tampered/missing bindings, moved/dirty worktrees, writer contention, and runs
strictly older than the frozen deadline refuse rather than replay. The early
age check also covers spec/plan here; their low-level policies are unchanged.
There is no deadline watchdog or general repair/resume switch.

A failed group is never retried in the same invocation. A refusal can leave
the persisted run in progress; an unrecorded failure cannot be reconstructed
by a later status call. A delivery transaction that rolls back may leave an
intact boundary for a separately consented later invocation, not an automatic
retry. Preserve evidence and follow the specific diagnostic.

The local workflow needs no GitHub credentials, `gh`, repository URL, or
remote fetch/publication. The actual model provider still needs its own access,
and frozen verification commands are not filesystem/network-sandboxed.

## The milestone that decides everything

The build order in `ARCHITECTURE.md` stops deliberately at step 9: one feature run that
reaches a terminal state with queryable per-stage cost. Nothing past that is
worth building until that run exists.

On 2026-09-11, an operator-authorized end-to-end paid run on the 20-requirement
`web-calculator` design completed through code review and delivery check for a
total cost of $2.05854 across 16 dispatches. The run exercised spec reconciliation,
plan coverage and review, implementation worktree patches, frozen verification
commands, two code review panel executions with an implementer remediation cycle
(`finalCommit=8cd5a2d9`, `finalGate=pass`), delivery check of all 6 declared
artifacts (`scopeMatch=yes declared=6 delivered=6 missing=[]`), and verified audit
chain validity (`exit=0`). The complete run store (`state.db`), keys, and all 16 raw
dispatch payloads are preserved in durable storage under
`C:\Users\tamezs\buildWorks_test_repos`.
