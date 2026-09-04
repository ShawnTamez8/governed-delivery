# Debugging Analysis

**Status:** reconciled 2026-09-03, after review. The original diagnosis stands
on its central claim and was wrong on three supporting ones; the Reconciliation
section records what changed rather than editing the record silently.

**Hazards considered:** 3 (a constrained field must have its constraint stated
in the prompt — the direct cause here), 13 (specifications inventing
obligations — the reverse-direction hole below is its unguarded twin), 16 (a
remediation loop aimed at the wrong artifact), 17 (a reconciliation that answers
a finding by deleting the obligation — raised out of this investigation).

## Reconciliation

What this report first claimed, what changed it, and what that changes.

**C1 — "Formatting-only" was wrong.** The report characterized all 16
divergences between the spec's criteria and the plan's Coverage lines as
cosmetic. Re-reading the pairs, they span a range: pure formatting (backticks
stripped), harmless rewording, **at least one dropped testable constraint**
(`(no server, no build step)` on criterion 1, and `frameworks` on criterion 2),
and one case where the plan *strengthened* the criterion (spec: "persisted
**e.g.** via localStorage" → plan: "persisted via localStorage"). Calling the
set uniformly cosmetic overstated it. Consequence: the gate's block on criterion
1 was a defensible outcome, and the report's "false-negative" framing is too
strong as a blanket statement.

**C2 — but the mechanism is still the defect.** The gate cannot distinguish a
dropped constraint from a dropped backtick. It compared 16 strings, got 16
mismatches, and reported all 16 identically. It would have blocked the same way
on a semantically perfect restatement that moved one comma. So on criterion 1 it
reached the right outcome through a mechanism that never evaluated the thing
making it right. That is accidental correctness; 16/16 remains the signal.

**C3 — the preferred fix was unsound.** Original option 3 assigned criterion ids
**by list position**. That is not stable: inserting or reordering a criterion
changes identity. The report flagged exactly this in its own Risks section and
then recommended the scheme anyway, which was incoherent. Superseded by
spec-minted, persistent, never-reused, non-positional ids — see Proposed Fix.

**C4 — the analysis already existed in this repository, and was not found.**
`docs/proposals/spec-kit-harness-review.md` contains the same failure, three
recorded dispositions for it, a design constraint drawn from a predecessor
system's drift failure, and a defect in the same function this investigation
never found. See "Prior art".

**C5 — a decision existed and had been pruned.**
`.claude/sessions/project-learnings.md` today records only that "a genuine
plan-coverage block came from the model dropping `(traces to: …)` suffixes". The
entry before commit `f094c0f` also carried: "…and `coverageMeetsCriteria` held
the full text. **The gate was right; the prompt was not softened to pass.**"
That is a recorded decision about this exact gate. It concerns not softening the
prompt; it says nothing about ids, so it does not conflict with C3's successor
design. Filed as `docs/proposals/durable-knowledge-tiers.md`.

## Problem

`coverageMeetsCriteria` (`src/plan-gate.ts`) decides whether a plan covers its
spec by comparing **prose to prose** — the plan's Coverage-line criterion text
against the spec's acceptance-criterion text, under whitespace/case
normalization only. The prompt that produces that text never asks the model to
reproduce criteria verbatim. A gate that requires near-exact text and a prompt
that invites restatement cannot both be satisfied reliably.

## Expected Behavior

A plan that covers every acceptance criterion, one Coverage line each mapped to
a declared artifact, should pass `coverageMeetsCriteria` and reach the
plan_review panel. Where a plan silently weakens a criterion, the gate should
block **and say which criterion and how** — not report all of them identically.

## Actual Behavior

`bw plan --run <id>` blocked with `plan.coverage.incomplete`, reporting all 16
of 16 criteria as uncovered, though the Coverage section held exactly 16 lines,
one per criterion, in the same order, each mapped to `calculator/index.html`.
One of those 16 had genuinely dropped a constraint. The gate's output does not
distinguish it from the other 15.

## Reproducibility

Data-specific (depends on spec wording); reproduced once this session. The root
cause is deterministic given the implementation, and is expected on any spec
whose criteria carry markdown or parenthetical detail.

1. Author a spec (`bw spec`) whose `## Acceptance criteria` lines contain
   backtick-quoted paths and parenthetical qualifiers.
2. Run `bw plan --run <id>`.
3. Compare each Coverage line's criterion text to the spec criterion after
   trim / whitespace-collapse / lowercase.
4. Any divergence — cosmetic or substantive, the gate cannot tell — fails the
   normalized-set match.

## Evidence

- CLI output from the blocked run: `plan does not cover every acceptance
  criterion: <all 16 spec criteria, verbatim>`.
- Spec (scratch target, run 2), criterion 1:
  `` - Opening `calculator/index.html` directly in a browser (no server, no
  build step) renders a visible numeric display and buttons for 0-9, … ``
- Plan (same run), the corresponding Coverage line:
  `Opening calculator/index.html directly in a browser renders a visible numeric
  display and buttons for 0-9, … -> calculator/index.html`
  — backticks stripped **and `(no server, no build step)` dropped.** The dropped
  parenthetical is a testable constraint, not formatting.
- The divergence taxonomy across the 16 pairs (corrects the original claim):
  - backticks stripped — every line;
  - a dropped testable qualifier — criterion 1 (`(no server, no build step)`)
    and criterion 2 (`frameworks` removed from "no external libraries,
    frameworks, or build tooling");
  - a dropped illustrative example — criterion 6 (`(e.g. "Error")`);
  - meaning-preserving rewording — criteria 4, 10, 17;
  - **strengthened** — criterion 11 (spec "persisted e.g. via localStorage" →
    plan "persisted via localStorage").
- `src/plan-gate.ts:89-97`: normalizes `trim()`, `\s+` collapse, `toLowerCase()`,
  then `Set` membership. No markdown stripping, no similarity measure, and no
  way to report *how* a line diverged.
- `src/plan-gate.ts:82-87`, the function's own comment: "Holding restated prose
  to byte equality would refuse correct plans over a double space." The stated
  intent is tolerance of trivial restatement; the implementation tolerates only
  whitespace and case.
- `src/prompts.ts:266-277`, `buildPlanAuthorPrompt`: "a ## Coverage section: one
  line per acceptance criterion, in one of two forms: `<criterion> -> <artifact
  path>`". `<criterion>` is never qualified as verbatim. The same unqualified
  instruction repeats in `buildPlanSelfCritiquePrompt` and the plan
  reconciliation prompt, so all three coverage-emitting sites share the gap.

## Prior art already in this repository

`docs/proposals/spec-kit-harness-review.md` already contains:

- **the same failure**, recorded from step 7: "the plan restated acceptance
  criteria without their `(traces to: …)` suffixes and the coverage gate blocked
  on the prose comparison";
- **three dispositions** for it — prompt-side verbatim copy (cheapest); a
  reverse-direction gate check; and stable criterion ids with a single minting
  authority (strongest);
- **a design constraint this investigation did not have**: a predecessor system
  used `AC-###` ids where *any* document could mint one — review added criteria,
  planning added criteria, tests referenced ids — no document was the sole
  minting authority, and the sets drifted until tests bound to requirements the
  spec never contained. Sole minting authority is the constraint that prevents
  this;
- **a defect in the same function this investigation never found** — see below.

That document is referenced by exactly one file in the repository, the backlog
README. Nothing in `src/plan-gate.ts`, `docs/hazards.md`, or `ARCHITECTURE.md`
points at it. The discoverability failure is filed separately as
`docs/proposals/durable-knowledge-tiers.md`.

## Related defects in the same area

**The reverse direction is unchecked.** `coverageMeetsCriteria` verifies that
every spec criterion has a Coverage line. It never verifies that every Coverage
line names a real criterion. A plan can invent a criterion, cover it, and pass.
Recorded in the spec-kit review; not found independently here.

**A reconciliation can delete the obligation.** Verified in code during this
reconciliation pass: `deriveAddedNormativeNodes`
(`src/reconciliation.ts:285-300`) counts the after-set up and the before-set
down and emits only positive remainders, so a node present before and absent
after produces nothing to claim and nothing to ground. Grep for removed- or
deleted-node handling across `src/reconciliation.ts` and `src/spec-stage.ts`
returns zero hits, and `ARCHITECTURE.md` section 12 specifies the same
asymmetry ("every added node … must be claimed exactly once"), so this is the
design's shape rather than an implementation divergence. Consequence: an
`addressed` decision can discharge a finding by deleting the acceptance
criterion it was about, and because spec reconciliation runs before the approval
gate, the operator signs the weakened spec. Raised as `docs/hazards.md` entry
17.

## Likely Failing Layer

Service/business logic (a deterministic gate), caused by a prompt/gate contract
mismatch. `coverageMeetsCriteria` is pure code and is the direct, reproducible
cause of the block; the contributing defect is that the prompt producing the
text it checks never asks for verbatim reproduction.

## Scope Narrowing

Ruled out:
- Coverage-table parsing bug — the section is well-formed (16 lines, each
  `<text> -> <path>`) and full sentences reach the block message, so
  `doc.coverage[].criterion` populated correctly. The mismatch is content.
- Scope violation — every line names the one signed scope path; the block was
  `plan.coverage.incomplete`, not `plan.coverage.unkeepable`.
- Model not attempting coverage — 16 lines in criterion order is a 1:1 attempt.

Confirmed: the exact-match comparison at `src/plan-gate.ts:89-97` against the
under-specified `<criterion>` instruction at `src/prompts.ts:272-274`.

## Hypothesis Result

Confirmed with a correction. The plan-author is never told to copy criterion
text, so it restates; the gate tolerates only whitespace and case, so every
restatement fails. Corrected per C1: the restatements are not uniformly
faithful — at least two dropped a testable qualifier — but the gate neither
detected nor reported that distinction, which is the defect.

## Codebase Review

Files read: `src/plan-stage.ts`, `src/plan-gate.ts`, `src/prompts.ts` (the three
coverage-emitting prompts and the shared decision contract),
`src/reconciliation.ts`, `ARCHITECTURE.md` (full),
`docs/proposals/spec-kit-harness-review.md`, the scratch target's `spec.md` and
`plan.md`, and the git history of `.claude/sessions/project-learnings.md`.

Callers: `coverageMeetsCriteria` is called at `src/plan-stage.ts:329` (draft),
`:427` (self-critique), and `:678` (reconciliation round) — all three feed
prompt-generated text into the same comparison and share the failure mode.

Existing test coverage: not searched. Baseline: not run. No code changed.

## Proposed Fix (not applied — no fix work started)

Superseding the original option 3. Three dispositions exist, and they are the
three the spec-kit review already recorded; this report adds nothing new to the
menu and should not be read as though it did.

1. **Prompt-side verbatim copy.** Require the criterion be copied
   character-for-character into the Coverage line. Cheapest; still bets on model
   compliance, and long-prose verbatim copying is exactly what models drift on.
2. **Reverse-direction check.** Refuse a Coverage line naming a criterion the
   spec does not contain. Closes the invented-criterion hole today with no
   schema change. Orthogonal to 1 and 3 — worth doing regardless.
3. **(Preferred) Stable, spec-minted criterion ids.** Coverage lines name ids,
   not prose, and the gate compares id sets in both directions. The governing
   rules, from the spec-kit review plus the predecessor's recorded drift
   failure:
   - the spec is the **sole** authority that mints criterion ids;
   - ids are explicit and persisted in the spec, **not positional** — wording
     revisions and reordering never change an id, and ids are never reused;
   - a requirement discovered during planning has exactly one legal path: a
     spec revision that mints the id in the spec first, which re-hashes
     `specHash` and re-binds the operator's approval. The plan never mints;
   - findings and reconciliation decisions name the criterion ids they affect,
     which is what gives a revised criterion the lineage it lacks today;
   - deleted criteria require an explicit disposition (see hazard 17);
   - criterion text may still be displayed beside the id, but it is
     descriptive, never identity.

   Ids provide traceability; they do not bypass approval. Any wording change
   still moves `specHash` and still requires renewed approval.

   Footprint: `src/spec-doc.ts` (minting and persistence), `src/plan-doc.ts`
   (Coverage entry shape), `src/plan-gate.ts` (bidirectional id comparison),
   `src/reconciliation.ts` (decisions naming affected ids), `src/prompts.ts`
   (rendering criteria with ids, all three coverage-emitting prompts).

Nothing here is adopted. The build order's stop at step 9 governs; per the
spec-kit review, "nothing is adopted before the step-9 stop."

## Validation Plan (recommended, not executed)

- A plan that covers every criterion passes.
- A plan that omits a criterion still blocks, naming it.
- A plan that invents a criterion blocks (currently passes).
- A plan that *weakens* a criterion — the criterion-1 case that started this —
  is correctly refused, and the refusal names that criterion specifically rather
  than reporting all of them.

## Regression Coverage (recommended)

Tests on `coverageMeetsCriteria` (or the plan stage) covering: a faithful
restatement is accepted; an omitted criterion blocks and is named; an invented
criterion blocks; a weakened criterion blocks and is named. Failure modes
covered: false-negative rejection of faithful coverage, and the two holes above.

## Risks

- **Prompt tightening alone (1)** leaves the mechanism unchanged, so prompt
  drift reintroduces the failure.
- **Loosening the comparison** — the original option 2, now dropped — would
  have made the criterion-1 weakening pass. C1 is the reason it is not on the
  list. Any tolerance measure must still refuse a dropped constraint, and no
  proposed measure could distinguish those cases.
- **Ids (3)** move identity out of prose but need minting discipline; the
  predecessor's drift failure is the recorded cost of getting it wrong. The
  footprint spans five files and changes the spec schema.
- **Cost of the status quo.** The block lands after a full spec-stage chain and
  at least one plan-author dispatch. This session's run 2 spent $0.24683 before
  hitting it.

## Open Questions

- Does a test exercise `coverageMeetsCriteria` with anything other than
  byte-identical criteria? Still not checked.
- Should the reverse-direction check (option 2) ship independently of the id
  scheme? It is cheap, orthogonal, and closes a live hole.
- Secondary, unresolved from the original report: run 1 blocked at
  `spec_review` with a reconciliation decision missing `changedLocations`,
  despite `src/prompts.ts:501-503` stating it should be an empty array for
  `cannot_determine`. Reads as model non-compliance with a correct prompt
  rather than a code defect. The offending `spec.md` was deleted during cleanup
  before this investigation began, so it was never confirmed.
