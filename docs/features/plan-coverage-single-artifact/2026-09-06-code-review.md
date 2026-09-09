# Plan coverage single artifact — code review

**Reviewed document:** `docs/features/plan-coverage-single-artifact/plan.md`
**Review date:** 2026-09-06
**Status:** reconciled

**Hazards considered:** 3 is the entry the reviewed change belongs to, and the
review's first finding is that the change broke the same entry in a new place —
a sentence stating one rule silently withdrew another the same prompts state
five lines earlier. 16 is why that matters here rather than being cosmetic: a
reviewer told a legitimate entry is a defect files a finding the author cannot
answer, and the reconciliation route the prompt then recommended is the one that
converts to `cannot_determine` and blocks. 4 governs the verification: every
finding was reproduced by running the current code against the `HEAD` copy or by
mutation in a disposable mirror, and the regression is fed by a committed
recorded response. 6 governs the gate, whose verdict this change does not alter.
11 bears on the diagnostic quality the change exists to improve. 13 bears on the
suppression risk in the review prompt, weighed and answered by the redirect. 1
and 2 are inherited and untouched. 5, 7-10, 12, 14, 15, 17 and 18 were read and
bear on nothing in this diff: no output is parsed or discarded, no executable
spawned, no hook installed, no model alias matched, no delivery or independence
claim moved.

**Scope reviewed:** `git diff HEAD` over `src/plan-gate.ts`, `src/plan-stage.ts`,
`src/prompts.ts`, `test/plan-gate.test.ts`, `test/prompts.test.ts`,
`test/reconciliation.test.ts`, `ARCHITECTURE.md`, `docs/hazards.md` and
`docs/proposals/plan-coverage-single-artifact-blocks-run.md`, plus the untracked
`docs/features/plan-coverage-single-artifact/` and
`test/fixtures/recorded/plan-reconciliation-web-calculator-multi-artifact-coverage.json`.
Excluded by instruction as unrelated work: `.agents/`, `AGENTS.md`,
`docs/proposals/github-project-projection-and-upstream-spikes.md`, and
`.claude/sessions/project-learnings.md`. All verification ran in a disposable
mirror; the working tree was never mutated. Checks at review time: `npm test`
784/783/0/1, `npm run typecheck` exit 0, `npm run check:docs` clean.

The review was performed by a separately dispatched reviewer that did not write
the change, recorded as `configured_standalone` in the same sense the system's
own reviewers are — separately dispatched, no shared state — and not as a claim
of independence any artifact supports.

## Summary

The change is faithful to its plan and its guards hold, but the plan itself was
under-specified in one way the reviewer caught and one it did not: the coverage
line's *shape* was defined without its *meaning*, and the sentence defining the
shape withdrew the schema's other legal form by omission. The findings cluster
on what a prompt says when it states one rule and stops. Withheld: style and
naming; the plan document's open `## Tasks` membership, which this diff mirrors
rather than introduces and which the sibling plan already names as a follow-up.

## Findings

**Finding 1 — the review prompt withdrew the `not_applicable` coverage form**

- **Where:** `src/prompts.ts`, `buildPlanReviewPrompt`.
- **Why it matters:** this is the only plan prompt that never restates the
  document schema, so the new sentence was the entire description of a coverage
  line a reviewer receives — and it said every line names exactly one artifact.
  A plan carrying a legitimate `not_applicable` entry would draw a finding that
  it violates the one-artifact rule. The document is already correct, so the
  author's honest answer is `rejected_with_rationale`, whose grounding excerpt
  must appear verbatim in the specification; a schema-shaped rejection has no
  such excerpt, the decision converts to `cannot_determine`, and the run blocks.
  That is the "a finding the document cannot answer terminates the run" shape
  this change exists to close, reintroduced from the reviewer's side.
- **Reproduced:** the omission is certain in the text —
  `grep -n not_applicable src/prompts.ts` returns only the three authoring
  builders — and the gate's exemption was probed directly: a `not_applicable`
  entry returns `{ ok: true }`. The live trigger is unobserved: no recorded
  chain has produced such a line. **CONFIRMED as text, reachability
  unverified.**
- **Reconciled:** the review prompt now states that a criterion with no artifact
  of its own says `not_applicable` with a rationale and an alternative
  verification, and that this is a legitimate entry rather than a defect.

**Finding 2 — the three authoring prompts contradicted the schema they state
five lines earlier**

- **Where:** `src/prompts.ts`, the scope paragraph in `buildPlanAuthorPrompt`,
  `buildPlanSelfCritiquePrompt` and `buildPlanReconcilePrompt`.
- **Why it matters:** each renders the two-form schema and then, a few lines
  later, says each coverage line names exactly one scope path. Read together the
  `not_applicable` form is withdrawn, and the available resolution for a
  criterion with no artifact is to name a plausible file anyway — a fabricated
  test, which `ARCHITECTURE.md` calls the worse outcome. The governing plan
  dictated this wording, so the plan carried the defect too; the proposal had
  been more careful, saying "the right side of `->`".
- **Reproduced:** each rendered prompt read end to end. **CONFIRMED.**
- **Reconciled:** each now says "each coverage line that names an artifact", and
  states that a criterion with no artifact takes the `not_applicable` form.

**Finding 3 — `ARCHITECTURE.md` described the code as stricter than it is, and
made one false claim**

- **Where:** `ARCHITECTURE.md` section 8.
- **Why it matters:** the new text said the right of `->` names exactly one
  artifact path while the paragraph two below still described the
  `not_applicable` form, so section 8 contradicted itself about one field — and
  the earlier statement is the one a prompt author copies, as findings 1 and 2
  show it already was. It also claimed the relation is "one-to-one in both
  directions", which is false: fourteen criteria name `src/calculator.js` in the
  recorded plan. The uniqueness the gate proves is one entry per criterion.
- **Reproduced:** counted from the committed fixture. **CONFIRMED.**
- **Reconciled:** section 8 now states both forms, says several criteria may name
  the same path, and defines the path as the criterion's representative delivery
  anchor rather than an exhaustive list — the semantics the design review of the
  same day required and the plan never specified.

**Finding 4 — the reconciliation prompt named only the route that fails closed**

- **Where:** `src/prompts.ts`, `buildPlanReconcilePrompt`.
- **Why it matters:** it offered "reject the finding with a grounded rationale",
  but grounding must quote the specification and the rule being invoked is a
  property of the plan schema, so that route converts to `cannot_determine` and
  blocks. The proposal had named two moves — reject, or route upstream — and
  `upstream_follow_up` is not in `BLOCKING_DISPOSITIONS`. The implemented
  sentence dropped the non-blocking half.
- **Not reproduced:** reasoned from the disposition constants and the grounding
  check, not run against a live model. **PLAUSIBLE.**
- **Reconciled:** the prompt now routes upstream with a proposal candidate rather
  than recommending a rejection on a rule the specification never states.

**Finding 5 — the separator hint missed the separators a model reaches for next**

- **Where:** `src/plan-gate.ts`, `coverageFitsScope`.
- **Why it matters:** the predicate matched a comma, ` and `, ` + ` and a
  semicolon, so a space-separated pair — at least as natural an output —
  produced exactly the undiagnosable message the change exists to replace.
- **Reproduced:** six target shapes probed against the mirror's gate; three
  produced no hint. **CONFIRMED.**
- **Reconciled beyond the finding.** The reviewer proposed widening the
  predicate to whitespace, and that was done first. The design review of the
  same day then rejected separator inference altogether: a path may legally
  contain punctuation, and the check already holds the stronger evidence that
  the target equals no signed entry. The rule is now stated unconditionally, and
  a test asserts both refusals carry the identical sentence.

**Finding 6 — `docs/hazards.md` overstated what changed**

- **Where:** `docs/hazards.md` entry 3.
- **Why it matters:** it said the refusal names the rule "instead of" reporting a
  scope error; the message still opens with the scope error and appends the rule.
  The hazard entry is the durable record.
- **Reproduced:** read against the emitted string. **CONFIRMED.**
- **Reconciled:** the entry now describes the message as it is.

**Finding 7 — the plan's `**Status:**` read `Proposed` after Tasks 1-6 shipped**

- **Where:** `docs/features/plan-coverage-single-artifact/plan.md`.
- **Why it matters:** nothing enforces the value, but the plan is the governing
  document and it disagreed with itself.
- **Reproduced:** read from disk. **CONFIRMED.**
- **Reconciled:** advanced to `Reconciled`, which is the honest value — Task 7's
  run exists but never reached this change, so `Implemented` would overclaim.

## Verified clean

- **`{ ok: true }` is still exactly `{ ok: true }`**, so the success-branch
  `deepEqual` passes unedited; no caller reads a removed field; `tsc` exit 0.
- **The only consumer of the old refusal text** is a loose prefix match in
  `test/plan-stage.test.ts`, which passes. The two documents quoting the old
  message quote it as history, correctly.
- **The audit summary is unbounded `TEXT` and feeds only the hash chain**, and
  the worst realistic message on the recorded 26-entry plan is about 1 KB.
- **The replace-all touched only the three plan authoring builders** — the spec,
  implementation and code-review builders are untouched.
- **Hard rule 5 holds.** The scope constant the regression compares against is
  now read from the fixture's `provenance.signedScope` rather than retyped, so
  the expected value cannot drift from the run it came from.
- **Every guard was proved by breaking it**: dropping the membership rule, and
  restoring the separator inference it replaced, each fail the tests that name
  them; removing the one-artifact rule from any one of the three authoring
  builders fails that builder's own assertion while the file-wide scan stays
  green, which is the failure mode the per-builder pins exist for.
