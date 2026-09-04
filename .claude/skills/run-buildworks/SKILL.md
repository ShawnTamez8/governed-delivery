---
name: run-buildworks
description: Run, drive, and smoke-test the BuildWorks bw CLI against a throwaway target repository. Use to run or start bw, launch a governed run end to end, exercise the stage chain and its gates, check what a run cost, or reproduce a stage failure outside this repository. Covers migrate, new-run, spec, approval-request, approve, plan, implement, verify, deliver, and verify-audit.
---

# Running BuildWorks

`bw` is a CLI that governs **the repository it is run in**: it reads
`governed.yaml` and `docs/features/<slug>/design.md` from that repository's
starting commit, writes state to its `.governance/`, and creates git worktrees
under it. So you never drive it against this repository — you build a scratch
target and run it there. `.claude/skills/run-buildworks/driver.mjs` does that
for you.

Paths below are relative to the repository root. Verified on Windows 11,
Node v24.14.0, npm 11.18.0, git-bash and PowerShell, 2026-08-31.

## Prerequisites

- **Node 24+.** The CLI is TypeScript executed directly by Node's type
  stripping; `node --version` must be v24 or later.
- **git** on PATH.
- `npm install` once, for `typescript` and `@types/node`. No runtime
  dependencies — SQLite is `node:sqlite`.
- Only for the paid chain: the `claude` CLI on PATH (`claude --version`
  printed `2.1.252 (Claude Code)` here).

There is **no `bw` binary** after `npm install`. `package.json` declares the
bin, but npm does not link a private package's own bin, and
`node_modules/.bin/` holds only `tsc`/`tsserver`. Every invocation is
`node <repo>/src/cli.ts ...`, which is what the driver does.

## Run: the free smoke (start here)

Twelve steps, no dispatches, no spend, about ten seconds:

```bash
node .claude/skills/run-buildworks/driver.mjs smoke
```

It builds a fresh scratch target (git repo, committed `governed.yaml` and
`design.md`, throwaway Ed25519 keypair beside it), then drives `migrate` and
`new-run` to success and eight refusals to their exact messages. Each step
declares an expected exit code and an expected pattern; the summary marks
every step `ok` or `FAIL`, prints `12/12 steps as expected`, and exits
non-zero if any step drifted. Last line is the scratch repo's path — it is
left on disk for you to poke at.

Verified output, 2026-08-31:

```
ok    migrate                                               exit=0  migrations applied
ok    new-run                                               exit=0  1
ok    new-run refuses a dirty tree                          exit=1  the working tree is not clean: a run starts from a committed state (section 7). 1 path(s), first
ok    new-run refuses a non-repository                      exit=1  not a git repository (or HEAD cannot be read): a run needs a starting commit to verify against
ok    new-run refuses an uncommitted governed.yaml          exit=1  governed.yaml is not committed at 3b4a2c9d…: the verification con
ok    new-run refuses an unknown change kind                exit=2  invalid change_kind nonsense: allowed values are feature, defect_fix
ok    new-run refuses an unspawnable model name             exit=2  invalid model name "bad model name": must be 1-64 characters of letters, digits, dot, underscore
ok    approval-request refuses before a passed spec_review  exit=1  run 1 has no passed spec_review stage to approve
ok    verify refuses without a passed implementation        exit=1  run 1's last stage is none, not a passed implementation
ok    verify refuses a run that does not exist              exit=1  run 9999 does not exist
ok    verify-audit validates the chain                      exit=0  chain valid
ok    an unknown command prints usage                       exit=2  usage: bw <command>

12/12 steps as expected
```

Other subcommands:

```bash
node .claude/skills/run-buildworks/driver.mjs prepare              # build a target, print how to drive it by hand
node .claude/skills/run-buildworks/driver.mjs report --dir <target> # what a finished run cost and where it stopped
node .claude/skills/run-buildworks/driver.mjs clean                 # delete every scratch target
```

`--dir <path>` overrides the scratch location, `--model <name>` the model.

## Run: the paid chain (spends real money)

```bash
node .claude/skills/run-buildworks/driver.mjs paid --yes
```

Without `--yes` it refuses. It drives the full sequence — `migrate`,
`new-run`, `spec`, `approval-request` → `sign` → `approve`, `plan`,
`implement`, `verify`, `deliver`, `verify-audit` — against the real `claude`
binary, then asserts the terminal state and prints the per-dispatch cost from
the store.

Verified run, 2026-08-31, `claude-sonnet-5`, all seven stages passed. This
record predates step 8, so the run ends `in_progress` and `deliver` was not
called:

```
dispatches: 7   total cost: $0.15556
  spec-author (author, claude-sonnet-5) $0.01610 5641ms
  spec-reviewer-traceability (reviewer, claude-sonnet-5) $0.02051 10327ms
  plan-author (author, claude-sonnet-5) $0.01778 8216ms
  spec-reviewer-traceability (reviewer, claude-sonnet-5) $0.03290 23623ms
  plan-author (author, claude-sonnet-5) $0.02067 10588ms
  spec-reviewer-traceability (reviewer, claude-sonnet-5) $0.02929 19527ms
  implementer (author, claude-sonnet-5) $0.01830 6105ms
stages: spec=passed spec_review=passed awaiting_approval=passed plan=passed plan_review=passed implementation=passed verification=passed
run 1 (clamp): in_progress
```

Verified run, 2026-09-03, `claude-sonnet-5`, all eight stages passed, the
run completed:

```
dispatches: 11   total cost: $0.25019
stages: spec=passed spec_review=passed awaiting_approval=passed plan=passed plan_review=passed implementation=passed verification=passed delivery_check=passed
run 1 (clamp): completed
```

The step-8 driver asserts the terminal state (`delivery_check=passed`,
`run=completed`), that the delivery record's declared set equals the signed
approval scope, and that `verify-audit` validates the chain including the
`delivery.gate.pass` event. One earlier attempt that day blocked at the spec
dispatch spending nothing: the `claude` binary's OAuth session had expired,
and the stage failed closed with the retained envelope naming the cause.

The implementer produced a correct `clamp.mjs` in the scratch worktree's
scripts directory, on branch `gov/clamp/1`, and `verify` recorded
`"outcome": "pass"` over the two frozen commands. Nothing is written into this
repository — every path in that run is under the scratch target.

**The committed design changed on 2026-09-04, and the two records above are
the old one.** The driver used to commit a three-criterion clamp design, which
is what `run 1 (clamp)` names in both. It now commits
`.claude/skills/run-buildworks/web-calculator-design.md` under the slug
`web-calculator`: a requirements document in PRD form — purpose, goals, scope,
fifteen `RQ-###` functional requirements and five `NFR-###` non-functional
ones. Change what a paid run exercises by editing that file, not the driver.

The reason is not realism for its own sake. Every clamp run produced clean
review panels: no findings, so no reconciliation decisions, so no exercise of
the review, remediation, proposal, or normative-accounting paths — most of what
the system is. A design too small to attract a finding cannot test a governed
chain, and cheap runs were measuring that rather than confirming it worked.

Verified run on the new design, 2026-09-04, `claude-sonnet-5`, all eight
stages passed, the run completed:

```
dispatches: 11   total cost: $1.34097
  spec-author $0.02889 / $0.10923, spec panel $0.04682 + $0.05779,
  spec-author (reconcile) $0.11314, plan-author $0.02628 / $0.12810,
  plan panel $0.13236 + $0.18361, plan-author (reconcile) $0.10946,
  implementer $0.40528
stages: spec=passed spec_review=passed awaiting_approval=passed plan=passed
        plan_review=passed implementation=passed verification=passed
        delivery_check=passed
run 1 (web-calculator): completed        13/13 steps as expected
```

That run delivered four artifacts (`index.html`, `css/styles.css`,
`js/calculator.js`, `js/theme.js`) with `scopeMatch=yes declared=4
delivered=4`, and its two reconciliations exercised what the clamp never did:
an `upstream_follow_up` with a proposal candidate on the spec side, and a
normative task *replacement* on the plan side whose `addressed` decision
claimed both halves and passed with `unclaimedRemoved=0`. That response is
committed at
`test/fixtures/recorded/plan-reconciliation-web-calculator-prd.json` and
replayed by `test/reconciliation.test.ts`.

**Budget $1.00–$2.00 for a full chain on this design, not the clamp's $0.25.**
The cost moved into review and implementation rather than authoring — the
implementer alone was $0.40528 and the plan panel $0.31597 — so a run with an
extra remediation round will sit at the top of that range or above it. The free
`smoke` still costs nothing: it reaches no dispatch.

**Cost is not fixed.** That run took 7 dispatches, not 5, because the plan gate
passed in round 2 — `plan.gate.pass | plan_review gate passed in round 2` after
three findings were resolved by re-review. Budget one to three remediation
rounds. Earlier records in `docs/features/verification-stage/plan.md`: $0.07618
and $0.06595 for 5-dispatch runs, $0.5021 for one that blocked.

**The run now ends `completed`, and the cost is queryable.** Step 8 (the
delivery check) exists and the paid chain drives it: after `verify` the
driver calls `deliver`, which proves every declared artifact appears in the
committed changes over the recorded patch range and then atomically passes
the delivery_check stage and completes the run — or blocks the run naming
what is missing. The driver asserts `delivery_check=passed`, `run=completed`,
and that the delivery record covers every signed artifact, then runs
`verify-audit` over the chain including the delivery event. The 2026-08-31
record above ends `in_progress` because it predates step 8.

## Driving it by hand

`prepare` prints the target path, both key paths, and a ready-made `migrate`
line with the absolute CLI path filled in. Run that line, then keep going:

```bash
node .claude/skills/run-buildworks/driver.mjs prepare
cd <the target repository it printed>
BW_APPROVAL_PUBLIC_KEY=<the public key it printed> node <repo>/src/cli.ts migrate
```

Then any command from `bw`'s usage. Keep `BW_APPROVAL_PUBLIC_KEY` set on
**every** invocation, starting with `new-run` — see the first gotcha.

## Gotchas

- **The signer is frozen at `new-run`, not read at `approve`.**
  `freezeProfile` records the fingerprint of whatever public key resolves at
  run start, defaulting to `~/.buildworks/approval.pub`. Set
  `BW_APPROVAL_PUBLIC_KEY` before creating the run, or the run is bound to a
  key you did not mean to use and the signature you produce later cannot
  verify.
- **`sign-approval.mjs keygen` refuses `--out` under the current directory**,
  not just inside a git repository: the check is
  `enclosingRepo(out) || isPathInside(process.cwd(), out)`. Run it *from the
  repository root* with `--out` pointing somewhere else — running it from the
  scratch root with `--out <scratch>/keys` fails with `refusing to write
  signing material inside the repository`.
- **`claude` is an npm shim.** On Windows it is `claude.cmd`, which
  `spawnSync` cannot resolve without `shell: true` — `spawnSync claude ENOENT`.
  `src/harness.ts` spawns with `shell: WINDOWS` for exactly this (hazard 8);
  the driver's probe had to do the same.
- **The free path stops at `approval-request`.** The approval gate reads the
  `spec.gate.pass` audit event the spec stage writes, so `stage-add` /
  `stage-complete` cannot fake a passed `spec_review`. Anything past the spec
  stage costs money. There is no offline mode.
- **The spec stage needs `docs/features/<slug>/design.md` in the target**, with
  `<slug>` matching `--slug`. Missing, it fails with `cannot read design
  document …`. The driver commits
  `.claude/skills/run-buildworks/web-calculator-design.md` under the slug
  `web-calculator`; a vague design is what makes a chain expensive, and a
  trivial one is what makes it prove nothing.
- **A target repo does not need to gitignore `.governance/`.** `openStore()`
  creates it before the clean-tree check, so `new-run` filters `.governance/`
  out of the porcelain output (hazard 11). Verified: a repo with no
  `.gitignore` at all creates a run. It will show as untracked forever, so
  ignore it anyway.
- **A blocked run's projections dirty the tree**, and the next `new-run` then
  refuses. Commit or clean the target between runs.
- **Exit codes carry meaning: 2 is a usage error, 1 is a refusal, 0 is
  success.** Do not read them through a pipe — `cmd | grep` reports grep's
  status.
- **`verify`, `deliver`, and `verify-audit` are unrelated.** `verify` runs the
  frozen verification commands for one run; `deliver` (step 8) is the
  deterministic terminal check that completes or blocks the run against the
  signed declared artifacts; `verify-audit` recomputes the whole audit hash
  chain.
- Every invocation prints `ExperimentalWarning: SQLite is an experimental
  feature` on stderr. It is noise; the driver strips it.

## Test

```bash
npm test              # node --test — 682 tests as of 2026-09-03 (681 pass,
                      # 1 pre-existing skip); prose count, drifts with the suite
npm run typecheck     # strict tsc --noEmit
npm run check:docs    # the documentation checker
```

These three are also what this repository's own `governed.yaml` freezes as its
verification commands.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `keygen failed: refusing to write signing material inside the repository` | `--out` is under the cwd. Run the tool from the repo root, write the keys elsewhere. |
| `Error: spawnSync claude ENOENT` | `claude` is a `.cmd` shim; spawn it with `shell: true` on Windows. |
| `run N has no passed spec_review stage to approve` | Expected without a real `bw spec`. The free path ends here. |
| `run N's last stage is none, not a passed implementation` | `verify` needs a passed implementation stage, not just a run. |
| `the working tree is not clean` | The target has uncommitted changes — often a previous blocked run's projections. |
| `governed.yaml is not committed at <sha>` | The config is read from the starting commit, never the working copy. Commit it. |
| `--model X does not match the model frozen at run start` | Hard rule 6. Start a new run to change the model. |
| `no such column: …` from a `.governance/state.db` query | Read `src/migrations/*.sql` for the real column names — `agent_run` has `effective_model`, not `model_effective`. |
