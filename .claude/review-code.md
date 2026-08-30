# review-code checklist — governed-delivery

The project checklist for the `review-code` skill. It loads this file at Step 0 and works it
as Layer 2 of every review. The rules here override the skill's defaults.

A generic reviewer catches null dereferences. This file is what catches the defects that cost
money in this repository.

## Binding documents

Read these during the skill's grounding step:

- `ARCHITECTURE.md` — the design. It is binding. Code that contradicts it is a finding even
  when it works.
- `docs/hazards.md` — failures that have actually occurred in systems of this kind, each
  costing real money.
- `CLAUDE.md` — the working rules, including the six hard rules below.
- `.claude/sessions/project-learnings.md` — decisions locked, running state, deferred work.
  The most recent entry is the current state. A defect this file records as a deliberate
  decision is not a finding.
- `docs/features/<feature>/plan.md` — the governing plan, plus any prior review file beside it.

## The six hard rules

`CLAUDE.md` states these as constraints, not aspirations. Code that breaks one is a finding at
the same weight as a correctness defect, and the finding names the rule number.

**Rule 1 — one harness until one run completes end to end.**
Look for: a second executor path, an alternate adapter, a branch that bypasses the harness.
The rule holds until one run completes end to end, and nothing has.

**Rule 2 — one surface. A CLI calling the core directly, no second entry point.**
Look for: an HTTP handler, a second binary, an exported programmatic API meant for callers
outside `src/cli.ts`, or a module reimplementing a CLI command's logic so two surfaces can
drift. Two surfaces enforcing different rules for one stage is hazard 12 inside the codebase —
that is exactly how the plan-stage review's finding 3 arose.

**Rule 3 — one schema per thing. No unions, no version discriminators, no compatibility
handling. Nothing has shipped.**
Look for: `v1`/`v2` fields, an optional field that exists only to tolerate old rows, a parser
accepting two shapes, a migration written for data that has never existed. There is no
installed base. Compatibility code here is dead weight maintained forever.

**Rule 4 — no abstraction without two real implementations.**
Look for: an interface, base class, or generic helper with one caller. Equally the inverse
once a second real implementation lands — the plan stage deliberately duplicated the spec
stage rather than extracting early, and recorded the duplication. Duplication that is named
and deferred is compliant; silent duplication is a finding.

**Rule 5 — no hand-written fixture may define correctness.**
Look for: an expected value invented in the same session as the code that consumes it. A
fixture's authority comes from a schema, a response recorded from a real run, or a stated
requirement in `ARCHITECTURE.md`. This is the rule that stops tests and implementation from
agreeing with each other while both are wrong. See hazard 4.

**Rule 6 — config is frozen at run start.**
Look for: a flag that silently overrides the frozen profile, a stage reading live
configuration instead of the run's snapshot, a profile read without verifying its hash. The
plan-stage review's finding 1 was exactly this: three call sites read the profile and
discarded the hash, so the model map was enforced but not tamper-evident.

## Hazard map

`docs/hazards.md` records failures that have actually occurred. Read the entry before
reviewing that area.

| # | Entry | Where it bites in this codebase |
|---|---|---|
| 1 | Model output arrives in shapes the schema refuses | Any agent result parser — `src/agents/*`, the stage result decoders |
| 2 | Discarded output is undiagnosable | Any path validating before persisting raw output. Raw bytes go to disk first and are referenced from the run record |
| 3 | A constrained field must have its constraint stated in the prompt | `src/prompts.ts`. `test/prompts.test.ts` scans for this — check the scan covers newly constrained fields |
| 4 | Fixtures and code agreeing while both are wrong | Every new test. Was the expected value seen failing against unfixed code? |
| 5 | Completion without delivery | Gates that mark a stage complete. The plan-time half is coverage; the delivery half is "every declared artifact appears in the changed paths of an applied patch" |
| 6 | Promises a later stage cannot keep | `src/plan-gate.ts` and any gate refusing out-of-scope coverage. Also any change stranding a run with no in-place repair path |
| 7 | Retries that vary nothing | Closure and remediation rounds. A retry must vary the prompt — open findings injected, not the same call repeated |
| 8 | Windows executable resolution | Any spawn of an external executor. Node's spawn hardening breaks npm-shimmed binaries; the spawn wrapper and its regression test must stay in the path |
| 9 | Unverified hook interpreters | Setup code installing anything that spawns an interpreter. Verify resolution at setup time, in the environment that will spawn it |
| 10 | Exact-match model acceptance against moving aliases | `src/profile.ts`, the model map, and every site comparing a model string. How far does the run-start snapshot reach? |
| 11 | A default installation that cannot complete a run | Agent seeding and capability declarations. A default-seeded repository completes a run, and a test asserts it |
| 12 | Configuration divergence between targets | Two surfaces enforcing different rules for one stage — the CLI and a stage resolving the same thing differently |
| 13 | Specifications inventing obligations | Validators checking more than presence and shape. A schema should not manufacture a requirement nobody stated |
| 14 | Independence that cannot be proven | Reviewer selection, role separation, and any claim of independence no artifact records |

## Required header fields

**`**Hazards considered:**` is mandatory on every review file.** `npm run check:docs` fails the
build without it, and rejects a statement shorter than four characters.

Write it as the existing reviews do: name each entry, say in a clause how it bore on this
review, then dispose of the rest in two groups — those that do not apply, with the reason, and
those that bear on code this review did not find fault with. `none` is valid only with a
reason. Silence is the failure mode: an entry nobody consulted and an entry considered and
dismissed look identical afterwards.

**`**Reviewed document:**` names the governing `plan.md`,** not the source files. It is what
the implementation is measured against and what `reconcile-findings` resolves the path from.

**`**Scope reviewed:**` names the untracked files explicitly.** It is the reader's only
evidence that the new files were not skipped.

## Output path

`docs/features/<feature>/YYYY-MM-DD-code-review.md` — the feature folder, never the repository
root. The stem is `code-review`, matching the sibling `-plan-review.md` files.

`check:docs` enforces the hazards line only under `docs/features/`, so a review written
elsewhere silently escapes the check. When no feature folder matches the diff, stop and ask
rather than creating one.

## Review disciplines

From `CLAUDE.md`. These govern how a finding is arrived at, not what it is about.

**Trace before asserting.** A predicate named `isCurrent` or `isLegacy` tells you nothing
about which branch is live. Find the callers and the construction sites before describing
behaviour.

**Prove a guard by breaking what it guards.** A test that passes on first write has shown only
that your reading matched the code. Until you have seen it fail, report the assertion as
written, not verified.

**Expected values come from outside your own head.** A schema, a response recorded from a real
run, or a stated requirement in the design document. Never a value invented in the same
session as the code that consumes it.

**Say what is unverified.** Severity is a claim about reachability. Do not label something
critical without naming the configurations that reach it.

## Break-it notes specific to this repository

The general mechanics are in the skill. Two additions:

**Verify the direction of the attack before writing the test.** The approval-gate hardening
plan specified a containment test with the link the wrong way round — a link inside the
repository pointing at an outside key directory. That path is already lexically inside the
root, so the existing guard refused it and the test would have passed against unfixed code.
The direction that actually defeats a lexical `relative()` check is the reverse: a link
outside the repository pointing back into it.

**`core.autocrlf` is `true` on this machine.** CRLF silently breaks substitution-based fixture
assertions, and the failure looks like a logic bug. When a string comparison fails for no
visible reason, check line endings before reading the logic.

## Suppression list

In addition to the skill's defaults:

- **Work past the build-order stop at step 9.** One complete run with queryable cost. The stop
  is deliberate; recommending infrastructure beyond it is scope creep, not a finding.
- **Patterns imported from other codebases on this machine.** They were written against
  different constraints and carry assumptions this design rejects. Do not raise a finding whose
  only basis is "another repository does it differently".
- **Duplication the governing plan named and deferred** under hard rule 4.

## Commands

Run from the repository root.

- `npm run typecheck` — strict `tsc --noEmit`
- `npm test` — `node --test`
- `npm run check:docs` — `scripts/doc-check.mjs`; validates the review file's hazards line
