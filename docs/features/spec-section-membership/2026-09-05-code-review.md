# Spec section membership — code review

**Reviewed document:** `docs/features/spec-section-membership/plan.md`
**Review date:** 2026-09-05
**Status:** reconciled

**Hazards considered:** 3 is the entry the reviewed change belongs to, and the
review's sharpest finding is that the change does not close what its design
document claimed it closed — a declared-artifact line wearing Markdown
decoration still parses, so the constraint is stated at the prompt boundary and
only partly enforced at the parser. 4 governs how every finding here was
reached: each was reproduced by running the current parser and the `HEAD` copy
side by side on the same input, and each new guard was proved by breaking it and
restoring byte-exact. 17 bears on finding 6: the round-2 review panel is the
only semantic lens on a wrongly deleted obligation, so a prompt clause that
reads as licence to suppress that report is a risk even when the clause is
inert. 13 bears on the parser's restraint and was respected: the membership
rules refuse a shape, never manufacture a requirement. 11 bears on finding 1,
where a false obsolete-shape signal would tell an operator to discard a run over
a bullet character. 7 bears on why finding 1 matters at all: the repair the flag
names is a fresh chain, which varies nothing. 12 was checked and is clear — no
second parser of the specification exists, and no production code branches on
refusal text. 1, 2, 5, 6, 8, 9, 10, 14, 15, 16 and 18 were read and bear on
nothing in this diff: it adds no parser of model output, discards nothing,
spawns nothing, installs no hook, matches no model alias, and reaches no gate,
delivery, or independence claim.

**Scope reviewed:** `git diff HEAD` over `src/spec-doc.ts`, `src/prompts.ts`,
`test/spec-doc.test.ts`, `test/prompts.test.ts`, `test/reconciliation.test.ts`,
`ARCHITECTURE.md`, `docs/hazards.md`, and
`docs/proposals/spec-reconciliation-prose-note-blocks-run.md`, plus the
untracked `docs/features/spec-section-membership/` (`plan.md`,
`real-run-evidence.md`),
`docs/proposals/2026-09-05-spec-reconciliation-prose-note-blocks-run-review.md`,
`docs/proposals/plan-coverage-single-artifact-blocks-run.md`, and
`test/fixtures/recorded/plan-reconciliation-web-calculator-multi-artifact-coverage.json`.
Excluded as unrelated work from another session, by instruction: `.agents/`,
`AGENTS.md`, `docs/proposals/github-project-projection-and-upstream-spikes.md`,
and `.claude/sessions/project-learnings.md`. Everything was run in a disposable
mirror; the working tree was never mutated. Checks at review time: `npm test`
780/779/0/1, `npm run typecheck` exit 0, `npm run check:docs` clean,
`driver.mjs smoke` 13/13.

The review was performed by a separately dispatched reviewer that did not write
the change. It is recorded as `configured_standalone` in the same sense the
system's own reviewers are: separately dispatched, with no shared state — not as
a claim of independence no artifact supports.

## Summary

The change does what its plan says and the parser guards hold, but two of its
six findings are the same mistake in different places: a rule was described as
closing a section when it closes only the shapes that have been measured. The
findings cluster on the edges the plan chose not to look at — what happens to a
line that breaks two rules at once, and what happens to a section whose criteria
are bulleted with something other than a hyphen. Both were reachable, neither
was covered by a test, and both are now fixed. Withheld: style and naming
throughout; the pre-existing openness of the plan document's `## Tasks` section,
which this diff mirrors rather than introduces and which the plan names as a
follow-up.

## Findings

**Finding 1 — the obsolete-shape signal fires on a document whose criteria are
all present, when they are bulleted with anything but a hyphen**

- **Where:** `src/spec-doc.ts`, `validateSpecDoc`, the criteria membership pass.
- **Why it matters:** `criterionLines` strips only the ASCII hyphen as a list
  marker, so a section written with `*`, `+`, `1.`, or an en dash has no
  well-formed criterion line at all, and the flag was set on that count.
  `src/approval-stage.ts` and `src/plan-stage.ts` turn the flag into "this
  specification uses the obsolete prose-only acceptance-criterion shape, so
  start a fresh run to mint stable criterion IDs" — advice to discard a run over
  a bullet character, against a document carrying valid stable IDs. Hazard 11,
  and hazard 7 on the repair it names. Reachable through a `spec.md` edited on
  disk between `spec_review` and `approval-request`, or a legacy specification —
  which is the population the flag exists for.
- **Reproduced:** the current parser and the `HEAD` copy were run side by side
  on four bullet characters; `HEAD` set no flag on any of them and the change
  set it on all four. **CONFIRMED.**
- **Reconciled:** the flag now tests whether the section mentions a criterion ID
  anywhere (`/AC-\d/i`) rather than whether any line is well-formed, with a test
  over the four markers. Proved by reverting the predicate: the new test and the
  note test both fail, and `src/spec-doc.ts` restores byte-exact.

**Finding 2 — the whitespace rule does not close `## Declared artifacts`, and
`ARCHITECTURE.md` said it did**

- **Where:** `src/spec-doc.ts`, the artifacts membership check;
  `ARCHITECTURE.md` section 8.
- **Why it matters:** the design document stated that "an explanation, a note,
  or a heading inside one of these sections is a membership failure wherever it
  appears." A backticked filename, a bolded one, `N/A`, and a comma-joined pair
  all still parse as declared artifacts, flow to `computeScope`, are signed by
  the operator, and block terminally at `delivery_check`. A backtick is the most
  likely decoration a model applies to a filename, and the prompts forbid only
  whitespace. The code is faithful to the plan, which chose the whitespace rule
  deliberately and on evidence; the defect is a design document that reads
  stricter than the code, which this repository's checklist weighs at
  correctness weight.
- **Reproduced:** seven decorated forms were parsed against the current code;
  all seven were accepted as declared artifacts. **CONFIRMED.**
- **Reconciled in the document, not the code.** Closing the section against
  decoration is not what the plan authorized and no measured run has produced
  it. Section 8 now states what each rule actually proves and says plainly that
  neither section is provably closed. Recorded as a named follow-up in the
  plan's implementation note.

**Finding 3 — the artifacts membership message masked three more precise
refusals**

- **Where:** `src/spec-doc.ts`, the artifacts checks.
- **Why it matters:** as first written the membership pass ran before the path
  rules, so any line carrying whitespace was told "this line is not a path" —
  including lines that are paths. `docs/my feature/tasks.md` lost the
  architecture section 14 prohibition, which is the operator's only signal that
  task documents are refused by design; `C:\Program Files\a.ts` lost the
  repo-relative diagnostic, and is the reachable case on this platform. The
  message asserted something false about the input, and diagnostic quality is
  the entire subject of this change.
- **Reproduced:** four inputs compared against `HEAD`, each losing its specific
  message. **CONFIRMED.**
- **Reconciled:** the membership check now runs last within each path's checks,
  with a test pinning all three collisions. Proved by moving it back to the
  front: the new test fails, and the file restores byte-exact.

**Finding 4 — `ARCHITECTURE.md` claimed the section message for lines that
deliberately get the ID message**

- **Where:** `ARCHITECTURE.md` section 8.
- **Why it matters:** the document said a line that is not a valid entry is
  refused by a message naming the section's rule. `ac-001: text`, `AC-0001:
  text`, and `AC-note: …` are all answered by the ID message instead, and that
  routing is deliberate — the `/i` flag exists to keep a wrong-case ID out of
  the membership branch. As written, the design forbade the behaviour the code
  was built to keep.
- **Reproduced:** four inputs, each returning the ID message. **CONFIRMED.**
- **Reconciled:** section 8 now describes both routes and why they differ.

**Finding 5 — the plan's `**Status:**` contradicted its own gate**

- **Where:** `docs/features/spec-section-membership/plan.md`.
- **Why it matters:** the gate said the status stays `Reconciled` until Task 7's
  run exists, while the header still read `Proposed`. Nothing enforces the value
  — `check:docs` does not read it — but the plan is the governing document and
  it disagreed with itself about its own state.
- **Reproduced:** read from disk. **CONFIRMED.**
- **Reconciled:** advanced to `Implemented` once Task 7's run existed, with the
  implementation note recording what shipped.

**Finding 6 — a reviewer-prompt clause that is unobservable and reads as a
suppression**

- **Where:** `src/prompts.ts`, `buildSpecReviewPrompt`.
- **Why it matters:** the sentence added "and neither is an ID that no longer
  appears", but the builder hands the reviewer only the design and the current
  specification — never a prior revision — so a reviewer cannot observe an ID
  that has gone. The clause buys nothing observable and carries a reading risk
  in the opposite direction: architecture section 12 is explicit that no panel
  independently confirms an `addressed` decision, which leaves the review panel
  as the only semantic lens on a wrongly deleted obligation (hazard 17). The
  following sentence redirects rather than silences, so the risk is low.
- **Not reproduced:** reasoned from the builder's parameters and section 12; a
  live run in which an obligation is wrongly deleted would confirm or refute it.
  **PLAUSIBLE.**
- **Reconciled:** the clause was cut. The sentence that carries the measured
  behaviour — a gap in the numbering is not by itself a finding — stays.

## Verified clean

- **The deleted `colon < 0` branch is genuinely unreachable**, by construction
  (the predicate contains a literal colon) and by a 400,000-case fuzz over the
  relevant alphabet after the same trim and marker transform: 65 matches, none
  with `indexOf(":") < 0`.
- **The predicate does not backtrack pathologically.** `\S*` and `\s*` are
  complementary and the pattern is anchored: 400,000 non-matching characters in
  0.47 ms.
- **No pinned constraint is split across a template-literal line wrap**, none
  hides in a comment, each of the three authoring builders carries all three
  membership phrases, both revising builders carry the renumber sentence, and
  every phrase is asserted against a rendered prompt as well as the source. The
  stable-ID paragraph does not leak into `buildPlanReviewPrompt`.
- **Hard rule 5 holds on the new tests.** The three note lines are byte-identical
  to the committed recorded response, the criterion count and the `AC-013` gap
  are read from it, and the proposal's model-usage figures match its envelope
  exactly.
- **Unicode whitespace is consistent at both boundaries** — `String.trim()` and
  `/\s/` cover the same set, so the membership rule and the trimming that
  precedes it do not disagree.
- **Both recorded specifications with unbulleted artifacts still parse**, and
  the harness fixture needed no change.
