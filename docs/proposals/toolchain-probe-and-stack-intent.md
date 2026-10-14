# Toolchain probe, stack intent, and a spec author that can read the target

## The gap

BuildWorks freezes a list of verification commands at `new-run`, then spends
money for hours before anything checks that those commands can run in the
target at all. It also asks agents to write a spec and a plan for a stack it
never tells them. Four runs on two targets show both halves of the gap.

The operator's opinion, 2026-10-07 (paraphrased from the session): BuildWorks
should refuse to start when the target's toolchain is not installed, and the
operator should say up front whether the work is greenfield or brownfield. That
reverses the 2026-10-05 choice of a runbook checklist over code for baseline
verification, which was made when run 10 was the only evidence. This proposal
is the replacement decision's input, not the decision.

The operator restated the direction on 2026-10-11: the check stops the run and
tells the user why. The error is not swallowed. That settles the behaviour of a
failed probe (mechanism 2 below); the open decisions at the end are still open.

## What was observed

- **team-notes run 10 (2026-10-05).** Six implementation phases passed;
  `verification` blocked on `typecheck` with `Cannot find module ...
  \node_modules\typescript\bin\tsc`. Known cost $7.3048866 over 16 dispatches.
  The install was partial: `npm ls typescript` was empty while
  `node_modules/.bin/tsc` existed. After an operator-authorized `npm ci`, the
  delivered code still failed `tsc` (two errors) and `next build` ("Couldn't
  find any `pages` or `app` directory"): the design named no framework, and
  the frozen `build` command assumed one. Details are in the run 10 record in
  `.claude/sessions/project-learnings.md`.
- **By default a spec or plan author cannot see the target.** The spec
  stage, the plan stage and their reviewers pass no working directory to the
  harness (`src/spec-stage.ts` has no `cwd`; `src/harness.ts` only applies one
  when the caller gives it), so those dispatches run in whatever directory the
  operator launched from. Implementation and code review pass the run's
  worktree (`src/implementation-stage.ts`, `src/code-review-stage.ts`). The
  recorded run 10 dispatch contexts show every spec and plan dispatch with
  the BuildWorks checkout as its directory
  (`test/fixtures/recorded/run-10-dispatch-context.json`).
- **crew-chatter run 1 (2026-10-07), launched from the checkout.** The spec
  author raised a `Verification:` question whose two options assumed a
  single-package layout; the target is an npm workspace with `backend/` and
  `frontend/`. The question was a guess about a layout the author could not
  read. Cost $1.1243874; the run was abandoned.
- **crew-chatter run 2, launched from the target.** The author named the real
  workspaces and the installed libraries and asked nothing. The two runs are
  different runs, so this is one sample of the effect, not a measurement of it.
- **crew-chatter run 2, after spec and plan.** The implementer wrote two
  `eslint-disable` directives for `react-hooks/exhaustive-deps` into a project
  whose ESLint config does not load that plugin; `npm run lint` exits 1 on
  them. The implementer had the config readable in its worktree. Verification
  never ran in the run because phase 6 hit the usage limit first, so the
  failure was found by a manual check of the delivered commit.
- **team-notes run 12.** A `Verification:` question reached the operator
  because the verification-aware prompts exist (`docs/hazards.md`, entry 21);
  the operator's answer was Next.js, the stack declaration the design had
  never carried.

## Three mechanisms, and what each would have caught

| Recorded failure | Probe | Intent declaration | Spec author reads the target |
| --- | --- | --- | --- |
| run 10, partial install ($7.30 at verification) | Catches, at $0, if the operator declared a probe such as the TypeScript compiler's version command | Greenfield runs the probe only, so it reaches the same check | No |
| run 10, no framework named, `next build` unsatisfiable | No | Catches: a greenfield declaration requires the design to name the stack | Partly: the author sees there is no app, not which stack was meant |
| crew-chatter run 1, layout-guess question | No | No | Catches |
| crew-chatter run 2, lint directive for an unloaded plugin | No | No | No |

The last row matters. None of the three mechanisms addresses it, and the other
candidates do not either: a green brownfield baseline passes because the
scaffold lints clean, and a computed "plugins configured here" fact needs
per-ecosystem parsing (below). It is a model-compliance failure that only a
verification-failure feedback loop would repair, and the operator has
authorized a bounded remediation loop only for `code_review`. This proposal does
not claim to fix it.

## The mechanisms

**1. The spec and plan stages run with the target as their directory.**
Today the directory is an accident of where the operator typed the command.
Make it the target repository's main checkout for the spec, plan and review
dispatches (their tools are Glob, Grep and Read only, so the exposure is read
access to a checkout the operator already chose). One call-site argument per
stage, no new abstraction. Cost caveat: an author that reads the repository
reads more. crew-chatter's spec group cost $1.1243874 in run 1 and $1.6689004
in run 2; they are different runs, so the difference is a hint, not a price.
The verification-aware prompts hedge today ("Your working directory may not be
the target repository", `src/prompts.ts`); if this lands, that sentence becomes
false and must change with it.

**2. A probe: commands that must pass before the first dispatch, even when the
baseline is red.** `governed.yaml` today accepts only `verify:`. Add an optional
list of probe commands, frozen into the profile at `new-run` the way `verify:`
is (hard rule 6; hard rule 3 permits the schema change because nothing has
shipped, and a profile frozen before it is refused by name, as with every earlier
shape change). Run them once, after consent and before the first group, in a
throwaway worktree of the starting commit, through the existing
`verifyCommit` (`src/commit-verification.ts`). A failure refuses the invocation
and spends nothing. The refusal must say which probe command failed, its exit
code and the end of its output, and what to fix; a probe that cannot start at
all (command not found) is reported the same way, never as a generic "not
ready". The operator, not BuildWorks, knows that a TypeScript
project probes with the compiler's version command and a .NET one with `dotnet
--version`, so BuildWorks gains no per-ecosystem code (hard rule 4). The cost
is that the operator has to write the probe, and a probe that does not exercise
the failing path catches nothing: a first-token check of `npm` would have
passed on run 10.

**3. A declared intent, frozen with the run.** Greenfield or brownfield, chosen
at `new-run` beside `change_kind` (today `feature` or `defect_fix`, in
`src/store.ts`). It selects which gate runs:

- **Brownfield:** the full baseline from `docs/features/baseline-verification/plan.md`
  (the frozen verify commands pass at the starting commit), plus the probe.
- **Greenfield:** the probe only, because a scaffold-from-nothing target
  legitimately fails `build`, and the design must carry a stack section that
  names the framework and the package manager.

This replaces the baseline plan's `--accept-red-baseline` flag (its decision 5,
"refuse unless the operator accepts"). A red baseline is allowed because a
frozen, audited declaration says the target starts from nothing, not because
the operator typed a flag on one invocation. The flag could not tell an
environment failure from a missing-code failure; the declaration plus the probe
can.

## What this proposal declines to build

- **System-computed stack facts beyond the working directory.** The earlier
  sketch included computing facts such as "the ESLint config loads these
  plugins" and stating them in the prompts, on the run 7 lesson that a prompt
  should state a fact the system can compute exactly. Computing them means
  parsing each ecosystem's configuration. One implementation (npm, ESLint) is
  not an abstraction, but a second ecosystem would force one and hard rule 4
  asks for two real implementations first. The reader-of-the-target change
  covers the cheap half: the author sees the files. Revisit when a second
  ecosystem is actually in use.
- **Ecosystem detection.** The operator declares; the system does not guess.

## Open decisions

1. Replace the 2026-10-05 runbook decision with this. If yes, the runbook
   section stays as the manual form of the same check.
2. Whether mechanism 1 ships first and alone. It is the smallest change, it has
   the cleanest evidence, and it does not depend on the others.
3. Whether the greenfield stack section is required by name. The check would be
   presence of a heading, not truth of its content.
4. Whether a probe is required for brownfield targets or optional. Run 10 says
   required; a project with nothing to probe says optional.
5. Where the declaration lives for a target with several features: per run (at
   `new-run`) is consistent with `change_kind`, and means a repository's first
   feature and its tenth can differ.
6. `VERIFY_ENV_PASSTHROUGH` is unchanged. A probe that needs an environment
   variable outside it fails identically at every start, which is the existing
   open decision 4 of the baseline plan.

## What would settle it

Replay each recorded failure against the chosen design before planning it, as
the table above does for the three candidates, and say which cell stays empty.
Then plan mechanism 1 on its own: one call-site argument per stage and one
sentence removed from the verification prompts, tested with a recorded dispatch
context rather than a hand-written one.

Related: `docs/features/baseline-verification/plan.md` (reconciled, unbuilt),
`docs/runbooks/cli-operator.md` (the fresh-worktree check),
`docs/hazards.md` entries 6, 11, 12, 13, 20 and 21, `ARCHITECTURE.md` sections 7
and 12, `docs/proposals/verification-containment.md`.
