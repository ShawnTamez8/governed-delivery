# Review of the GitHub Spec Kit harness

## What this is

A record of a review of `https://github.com/github/spec-kit` (commit
`51e52be`, 2026-08-31), carried out alongside
`docs/proposals/sssf-harness-review.md`, `docs/proposals/omniagent-harness-review.md`,
and `docs/proposals/archon-harness-review.md`. This repository has been used
in practice here, with the operator's direct experience that it is very slow.
Notes only, no implementation, nothing adopted.

## What it is

GitHub's Spec-Driven Development toolkit: a Python CLI (`specify`) that
installs slash commands into 30+ AI coding agents. The "engine" is prompt
discipline plus one deterministic prerequisite script
(`check_prerequisites.py` in the spec-kit `scripts/` tree — checks that the
feature directory and its documents exist); there is no execution engine, no
gate, no audit.
The workflow: `/speckit.constitution` → `/speckit.specify` → `/speckit.plan`
→ `/speckit.tasks` → `/speckit.implement` → `/speckit.converge`, repeated
until converge reports "Converged". Its feature layout
(`specs/<id>-feature-name/` holding `spec.md`, `plan.md`, `tasks.md`) is the
same shape as this repository's `docs/features/<slug>/` — convergent design,
not an import.

## How it handles greenfield

Greenfield is the most fully developed of the four harnesses reviewed. Three
mechanisms, all carried in command prompts:

1. **MVP-sliced specs.** The spec template mandates prioritized user stories
   (P1, P2, P3), each of which must be independently testable: "if you
   implement just ONE of them, you should still have a viable MVP." A
   greenfield build is never one shot; it is slices that can each be built,
   tested, and demonstrated alone.
2. **The convergence loop.** `/speckit.implement` executes all tasks in one
   pass; `/speckit.converge` assesses the codebase against spec, plan, and
   tasks, classifies every gap (`missing` / `partial` / `contradicts` /
   `unrequested`) with a severity, and **appends** the remaining work as a
   new `## Phase N: Convergence` section with fresh zero-padded task IDs
   traced to source refs (`FR-003`, `SC-002`, `US1/AC2`). The contract is
   append-only: converge never rewrites spec, plan, or tasks, never deletes a
   task, and on convergence leaves `tasks.md` byte-for-byte unchanged. Its
   edge cases cover greenfield explicitly: "Little or no code yet: treat the
   entire specified scope as `missing` remaining work rather than failing."
3. **The constitution.** One-time project principles (MUST/SHOULD), treated
   as non-negotiable by converge — a code violation of a MUST principle is
   the highest-severity finding.

## Why it is slow (the operator's recorded experience)

The slowness is architectural, not incidental. Every slash command is a fresh
full agent invocation loading a 100-380 line protocol prompt; `implement`
executes the entire task list in one pass; `converge` re-reads spec, plan,
tasks, and the codebase on every iteration. Termination is a model saying
"Converged" — there is no mechanical stop. The only deterministic component
is the file-existence prerequisite check. This repository's gates (plan
coverage, verification commands, worktree checks) are precisely the
mechanical termination spec-kit lacks. Its mitigation, progressive
disclosure (loading only minimal context per artifact), works for spec-kit
because nothing it assesses binds to the full text — the opposite of this
repository's `plan_for` and scope bindings, where the full text is
load-bearing.

## Candidates worth carrying forward

1. **Stable criterion IDs — an independent candidate designed against a
   recorded predecessor failure, not a re-adoption.** The observed step-7
   failure — the plan restated acceptance criteria without their
   `(traces to: …)` suffixes and the coverage gate blocked on the prose
   comparison — is the class spec-kit eliminates by carrying traceability in
   IDs, never restated prose. Nothing is taken from TheBotFather, this
   repository's predecessor; its own experience with `AC-###` IDs is the
   hazard record this candidate must design against: there, any document
   could mint an ID (the review added criteria, planning added criteria,
   tests referenced IDs), no document was the sole minting authority, and
   the sets drifted — tests could bind to requirements the spec never
   contained. The design requirements that follow, stated so the candidate
   cannot repeat that failure:
   - the spec is the only place a criterion is minted;
   - the plan's coverage entries name spec IDs only, and the gate enforces
     both directions — every spec criterion covered, and every coverage
     entry naming a real spec criterion (invented IDs refused by name);
   - a requirement discovered during planning has exactly one legal path: a
     spec revision that mints the ID in the spec first, which re-hashes
     `specHash` and re-binds the operator's approval. The plan never mints.
   Note the second direction is unchecked in today's gate: `coverageMeetsCriteria`
   verifies only that every spec criterion has a coverage line, never that
   every coverage line names a real criterion — a plan can invent a
   criterion, cover it, and pass. The cheapest immediate fix is the
   reverse-direction check on normalized prose (no schema change); the ID
   scheme is the stronger form of the same invariant. Consistent with hard
   rule 3 (one schema: the criterion carries its ID; the coverage line names
   it). This joins the structured-output analyses in the sssf and archon
   reviews as the third candidate disposition for the coverage-variance
   question.
2. **The append-only convergence contract.** "Byte-for-byte unchanged when
   converged" is the sharpest audit-friendly completion formulation in any
   of the four reviews. Record as the standard for any future assessment
   step.
3. **MVP-slicing for greenfield specs.** The "each story independently
   testable" mandate is the missing piece of this repository's greenfield
   decision (recorded in `docs/proposals/archon-harness-review.md`): it is
   how a whole application becomes several runs instead of one giant patch
   set.
4. **A clarify-before-plan stage.** Spec-kit's `/speckit.clarify` (formerly
   /quizme) has the model ask the human to resolve underspecified areas
   before the plan is written. This repository surfaces underspecification
   only through review rounds after the fact. Candidate stage, deferred past
   the step-9 stop.
5. **Tasks-to-issues.** `/speckit.taskstoissues` converts the generated task
   list into GitHub issues. Step 8 (delivery check) shaped; recorded for
   then.

## Considered and rejected

- **The extension/preset/bundle template stack.** Runtime-resolved,
   priority-ordered template overrides conflict with hard rule 6 (config is
   frozen at run start) by construction. Rejected.
- **The constitution as a new artifact.** This repository's human-authored
   design document is the stricter form of project principles; a separate
   MUST/SHOULD document would be a second, weaker source of truth. Rejected.
- **Progressive disclosure for this repository's prompts.** The full plan
   and spec must reach the implementer verbatim and complete; the binding is
   the point. Rejected for the document stages.
- **Prompt-based cross-artifact analysis** (`/speckit.analyze`). This
   repository's plan-coverage gate is the mechanical version of the same
   idea. Validation, not import.
- **No trust boundary to review.** Spec-kit has no enforcement, no audit, no
   gates beyond file existence; the agent writes directly to the repository.
   It is the weakest of the four harnesses on this axis, and its popularity
   is process-shaped, not enforcement-shaped.

## What would settle it

Nothing is adopted before the step-9 stop. The coverage-variance question
(if it recurs) now has three recorded dispositions: prompt-side verbatim
copy (cheapest, first), the reverse-direction gate check (closes the
invented-criterion hole today, no schema change), and stable criterion IDs
with a single minting authority (this entry — the strongest form, designed
against the predecessor's recorded drift failure). The greenfield decision
in the archon review gains a third input: MVP-sliced specs are how spec-kit
makes a whole app converge, the pattern is proven at GitHub's scale, and the
predecessor's own greenfield record (a start-time readiness gate, designed
there, built here in `new-run`) shows the greenfield journey was narrowed
but never delivered there.

Related: `docs/proposals/sssf-harness-review.md`,
`docs/proposals/omniagent-harness-review.md`,
`docs/proposals/archon-harness-review.md` (the greenfield decision),
`ARCHITECTURE.md` section 12, `docs/hazards.md` entry 15.
