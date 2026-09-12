# Working rules

## Source of truth

`ARCHITECTURE.md` is the design. `docs/hazards.md` records observed failures
and identified failure mechanisms. Build from those two documents, and
do not import patterns from other codebases on this machine — they were
written against different constraints and carry assumptions this design rejects.

## The architecture is binding

The hard rules are constraints, not aspirations:

1. One harness until one run completes end to end.
2. One surface — a CLI calling the core directly. No second entry point.
3. One schema per thing. No unions, no version discriminators, no compatibility
   handling. Nothing has shipped.
4. No abstraction without two real implementations.
5. No hand-written fixture may define correctness.
6. Config is frozen at run start.

The build order has a deliberate stop at step 9 — one complete run with
queryable cost. Do not build past it without an explicit decision. The operator
authorized `code_review` on 2026-09-04 and its bounded remediation loop on
2026-09-06. Those decisions authorize only `code_review`; no other deferred
stage or behaviour inherits either one.

## Code-review operating contract

The implemented `code_review` loop has three independent release-policy knobs
in `src/policy.ts`: `CODE_REVIEW_PANEL_SIZE` permits 2-5 reviewers and defaults
to 2; `CODE_REVIEW_MAX_ROUNDS` permits 1-5 complete panel executions and
defaults to 2; and `CODE_REVIEW_BLOCKING_SEVERITY` defaults to `high`. These
values freeze at run start. Raising panel size also requires enough registered
`code-findings` agents with distinct, non-empty specialist instructions; an
unstaffable profile refuses before the run spends money.

Every non-empty panel before the final configured round sends all actionable
findings together to the frozen implementer, commits the guarded patch, runs
the frozen verification commands, and reviews that verified commit with the
full panel. The final panel applies the frozen severity threshold without an
unreviewed patch; below-threshold findings remain recorded and non-blocking.
Code reviewers may report only actionable defects in the current code. They do
not create a human gate, waiver, proposal, spike, upstream route, or findings
reconciliation schema. Do not change `spec_review` or `plan_review` while
maintaining this loop.

`docs/features/code-review-remediation/plan.md` is `Implemented`; its review is
`reconciled`, and Task 10 is complete. A separately authorized live chain on
2026-09-07 completed all stages in 13 of the allowed 16 dispatches for a total
cost of $1.39473. Its two specialized code reviewers returned a clean first
panel, delivery passed, and the operator then manually verified the delivered
calculator output. That manual check supplements the run record: the frozen
verification commands themselves checked only `node --version` and
`npm --version`. A completed paid run never authorizes another spend.

## Windows harness launch

The 2026-09-07 correction removed BuildWorks' obsolete *shim assumption*, not
an installed shim. `where claude` showed that the current launcher is native
`claude.exe`. `src/harness.ts` and both run-buildworks drivers now probe and
invoke it directly with no command-shell wrapper. PowerShell resolves the same
executable, so wrapping it in PowerShell or `cmd.exe` would only add a second
argument parser. Direct launch also avoids Node's shell-argument deprecation
warning (`DEP0190`) and retains a typed `ENOENT` when the executable is missing.

The wrapper did not create the recorded invalid `\U0001f319` JSON bytes; they
were already in the provider result. BuildWorks therefore also added explicit
JSON-standard escaping instructions to both patch-producing prompts and
regressions for direct launch, missing-executable reporting, and the prompt
contract. The strict extractor remains unchanged; it does not guess repairs.

## How to work here

**Trace before asserting.** A predicate named `isCurrent` or `isLegacy` tells
you nothing about which branch is live. Find the callers and the construction
sites before describing behaviour. Confident inference from plausible names was
the single largest source of wasted effort in work of this kind.

**Read the whole file before editing it.** File-reading tools return bounded
windows; continue through physical EOF until every line of the file you will
change has been seen. A token-minimal read that unlocks an edit is not reading
the file. Never edit on the basis of `head`/`tail`/`sed` slices, and a
programmatic patch (`read()` + `replace()`) is only legitimate after you
have viewed the full contents.

**Prove a guard by breaking what it guards.** A test that passes on first write
has shown only that your reading matched the code. Change the behaviour, confirm
the test fails, restore. Until then, report assertions as written, not verified.

**Expected values come from outside your own head.** A schema, a response
recorded from a real run, or a stated requirement in the design document. Never
a value invented in the same session as the code that consumes it. This is the
rule that prevents tests and implementation from agreeing with each other while
both are wrong.

**State which hazards you weighed.** Every plan and every finding
reconciliation under `docs/features/` carries a `**Hazards considered:**` line
naming the `docs/hazards.md` entries it weighed — including `none`, with a
reason, when that is the answer. Silence is the failure mode: an entry nobody
consulted and an entry considered and found irrelevant look identical
afterwards. `npm run check:docs` refuses a document without it.

**Say what is unverified.** Severity is a claim about reachability. Do not label
something critical without naming the configurations that reach it.

**Preserve review evidence.** Verify an alleged gap against the complete
contract and enclosing call path before accepting it. Record corrections and
dispositions in the review's reconciliation block, not by rewriting its
original findings. Inventory the actual findings, including duplicate titles;
do not carry forward a conversational count without reconciling it.

**Tasks are state, not documents.** Never create a new `tasks.md`. The only
exceptions are the exact historical bootstrap records at
`docs/features/delivery-check/tasks.md`,
`docs/features/step6-trust-boundary/tasks.md`, and
`docs/features/verification-stage/tasks.md`. Keep them as history, not
templates. A plan's `## Tasks` section uses plain list items, never Markdown
status checkboxes; execution and completion status belong in run-state database
rows. `npm run check:docs` enforces both rules — and exempts, by exact path,
those three task records plus the eleven bootstrap `plan.md` files that already
carried checkboxes when the rule landed. Both allowlists are closed: a new
document never joins either one.

## Layout

- `ARCHITECTURE.md` — the design. Change it deliberately, not incidentally.
- `docs/hazards.md` — observed failures and identified failure mechanisms.
  Entries distinguish measured incidents from code-path gaps; read the relevant
  entry before implementing that area.
- `docs/proposals/` — backlog. Markdown, no enforced lifecycle.
- `docs/features/<slug>/` — active work. That is the design: `design.md` is the
  only human-authored file, everything else is produced by a stage, and
  `status.md` is a projection. No stage writes there yet. Every directory
  present today is bootstrap work on BuildWorks itself — a hand-written
  `plan.md`, dated review records, and the three grandfathered task documents
  named above. Do not read them as stage output or create new task documents
  from their shape.
- `.governance/` — machine-local state. Gitignored. Never hand-edited.

Plans and review records carry a `**Status:**` line. A plan is `Implemented`
once it has shipped and `Reconciled` when it has absorbed its reviews but
nothing is built; a review record is `reconciled` once every finding has a
final disposition and none remain open. Use `partially reconciled` while any
finding remains open. Reconciliation does not authorize implementation or
provider spend. Nothing enforces these values — `check:docs` does not read them.

## Session continuity

Copilot uses the same project skills and learning record as Claude. The
canonical project workflows are `.claude/skills/doc-check/SKILL.md` and
`.claude/skills/run-buildworks/SKILL.md`; their `.agents` skill entries only
forward to those files. Use the `.claude` driver and design when operating
BuildWorks; do not replace the runtime's Claude harness with Copilot.

The global planning, implementation, review, reconciliation, and compaction
skills call `doc-check` for this repository's document rules. Neither
`doc-check` nor the learning record automatically launches those skills.
Do not create a second harness-specific project-learnings file.

At session start, read `.claude/sessions/project-learnings.md` — it carries
decisions locked, running state, and open questions saved by the
context-compaction skill. Its single top-level `Current state` block is the
resume point and takes precedence over historical session entries. Keep
active-work status, settled operator decisions and the next action there,
not in competing summaries in these instruction files. Consult the named
plan and its reconciliation stamp before resuming work.

**The committed tier is the system of record. Knowledge moves into the
repository, never out of it.** Harness auto memory is a cache: it is
machine-local, per-user, and keyed by clone path, so the same person cloning to
a different directory gets an empty store and a second developer never sees it
at all. A compaction pass may mirror a durable one-liner into auto memory in
addition to the committed file; it may never delete one from the committed file
on the grounds that memory now holds it, and it may never leave the committed
file pointing at memory for content memory alone carries. That trade already
cost this repository a decision — see `docs/proposals/durable-knowledge-tiers.md`.

**Recorded evidence is copied into the repository the moment it becomes
load-bearing.** Retained model output under a run's `.governance/raw/` or a
`driver.mjs` scratch target is machine-local, lives in a temp directory, and is
deleted wholesale by `driver.mjs clean`. When a test, plan, or finding starts to
depend on one of those responses, extract it into `test/fixtures/recorded/`
with a `provenance` block naming the run, the dispatch time, the capture date,
and what was dropped from the harness envelope — then depend on the committed
copy. Never schedule that extraction for later: "later" is a machine-local
dependency a teammate cannot execute. Query a run's store before cleaning it;
`clean` deletes the only record.

## Commands

Run development commands from the BuildWorks checkout root. For operator
commands, use the absolute checkout script and explicitly select the separate
target with `--repo`; see the PowerShell operator guide in `README.md`.

- `npm install` — one-time: dev dependencies (`typescript`, `@types/node`);
  commits `package-lock.json`.
- `npm run typecheck` — strict `tsc --noEmit`.
- `npm test` — `node --test` (Node 24 type stripping; relative imports carry
  explicit `.ts` extensions).
- `npm run check:docs` — the documentation checker (`scripts/doc-check.mjs`);
  run before claiming a documentation change is consistent.
- `node src/cli.ts --help` and `node src/cli.ts help <command>` — free help;
  no target, state, lock, or provider probe. Unknown options remain errors.
- `& node $BwCli doctor --repo $Target`, `& node $BwCli runs --repo $Target`,
  and `& node $BwCli status --repo $Target --run $RunId` — free readiness and
  read-only inspection. Set `$BwCli` to the absolute `src\cli.ts` in this
  checkout and `$Target` to an existing local Git worktree. Status/run require
  an explicit `--run`; doctor accepts either `--slug` or `--run`.
  Doctor/runs/status/run support `--json`.
- `& node $BwCli run --repo $Target --run $RunId --yes` — consent covers every
  previewed group through approval or terminalization, not signing, export,
  publication, or a later invocation. Exit 3 is the external approval pause.
  Exact-current schema, frozen age and intact boundaries are required; this
  is not arbitrary resume, implicit migration, or a failed-stage retry.
- Existing low-level commands remain: `migrate`, `new-run`, `stage-add`,
  `stage-complete`, `dispatch`, `spec`, `plan`, `implement`, `verify`, `review`,
  `deliver`, `approval-request`, `approve`, `verify-audit`, `proposal-export`.
  Their numeric/path/raw-payload outputs remain unchanged. `new-run` requires
  project, feature, slug, change-kind and model; it never selects these
  implicitly. All commands accept one `--repo`, defaulting to the invocation
  worktree, so omitting it here targets BuildWorks itself.
- Approval transport: `approval-request --out` exclusively creates canonical
  bytes; `approve --signature-file` accepts an external UTF-8 signature file.
  Reuse one explicit `--expires`; the separate signer belongs to the operator.
  Transport/prompt paths resolve from the original invocation cwd, not
  `--repo`. The README supplies the full byte-safe PowerShell workflow.
- There is no `bw` on PATH after `npm install`: npm does not link a private
  package's own bin, and `node_modules/.bin/` holds only `tsc` and `tsserver`.
  No packaging, GitHub integration, or remote publication is implied.
- `node .claude/skills/run-buildworks/driver.mjs smoke` — builds that scratch
  target and drives the CLI against it, spending nothing. `paid --yes` drives
  the full chain against the real `claude` binary and reports what it cost:
  budget $1.25–$2.50 for a clean default run, potentially more when remediation
  adds an implementer dispatch and another full reviewer panel. The committed
  design is the 20-requirement `web-calculator-design.md` beside the driver
  rather than the trivial clamp design that preceded it. Change what a run
  exercises by editing that file. See
  `.claude/skills/run-buildworks/SKILL.md`.
- `node scripts/sign-approval.mjs keygen|sign` — the operator's signing tool.
  It holds the only private key path in the repository and the system never
  invokes it.
