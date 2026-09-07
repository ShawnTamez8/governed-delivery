# A prose note answering a numbering finding blocks the run — review

**Reviewed document:** `docs/proposals/spec-reconciliation-prose-note-blocks-run.md`
**Document type:** Design, with a secondary specification-contract surface
**Review date:** 2026-09-05
**Status:** reconciled

**Hazards considered:** 3 is the entry the reviewed document belongs to, and
both high-risk findings extend it further than the document did — one to the
review prompt that raised the finding, one to the sibling section with the same
open membership. 17 is what makes the first of those a defect rather than a
preference: the removal accounting is why a numbering gap is legitimate. 4
governs how the dispositions below were reached — every claim was traced to
source before being accepted, and the one mitigation rejected was refuted by a
committed recorded response rather than by argument. 7 bears on the medium
concern: the post-change run it asks for is permitted precisely because the
remedies change the prompts. 11 was weighed against the corrected mitigation,
which refuses a legitimate path containing a space. No other entry bears on a
review of a proposal document.

---

## Dispositions (2026-09-05)

Every finding was verified against source before disposition, and all seven
were accepted; two carry corrections that changed what was built. The
implementation is `docs/features/spec-section-membership/plan.md`.

- **HR-1, the reviewer prompt leaves the model-sensitive source unchanged —
  accepted, impact corrected.** Verified: `buildSpecReviewPrompt` states the
  finding shape, severities, classification, location syntax and intentKey and
  nothing about ID sequence; `ARCHITECTURE.md` section 8 and section 12's
  removal accounting together make a gap the expected residue of a claimed
  removal. Two corrections to the reasoning: renumbering is not free
  mechanically, since each renumbered criterion is one removed node plus one
  added node the reconciliation must claim and ground; and "breaking plan
  traceability" is the wrong harm at this boundary, because spec reconciliation
  runs before any plan exists — the harm actually available is that findings
  cite AC IDs as their locations, so renumbering invalidates the locations of
  the findings being reconciled. Built as remedy 4 and as the prompt sentence
  forbidding renumbering.
- **HR-2, the sibling section membership boundary — accepted, mitigation
  replaced.** Verified: both sections apply one marker-stripping transform, an
  unbulleted criterion validates today, any non-empty line under
  `## Declared artifacts` becomes an artifact, and such a line is signed into
  scope by `computeScope` and blocks terminally at `delivery_check`. The
  mitigation as written — require every artifact line to be exactly
  `- <path>` — is refuted by committed evidence: two recorded provider
  responses write that section unbulleted, and a test replays both. Built on a
  whitespace rule instead, with the rule stated in the prompts so it is not a
  tolerance applied at one boundary. The criteria section was left at its
  existing strictness per the finding's own logic: it is already closed, and
  what it lacked was a diagnostic. One case the finding did not name was
  handled with it — a non-member line without a colon set
  `obsoleteCriterionShape`, telling the operator a document with twenty-three
  valid criteria used the obsolete prose-only shape; the flag now requires the
  section to carry no criterion line at all.
- **Medium, the acceptance-evidence split — accepted.** Built as the recorded
  replay (the fixture must still refuse, now with the membership diagnostic)
  and the authorized post-change run, which retains requested and effective
  model identity. Addition: because the remedies change the prompts, that run
  is a permitted experiment rather than the bare retry hazard 7 refuses.
- **Missing area 1, where a numbering explanation belongs — accepted.**
  Answered by making the reviewer rule authoritative, which removes the need
  for an explanation rather than relocating it; the prompts additionally name
  the summary or an ordinary prose section, since the schema does accept
  unvalidated prose sections.
- **Missing area 2, a model change is an experiment, not a remedy — accepted.**
  Verified against the frozen profile, which maps every dispatching stage kind
  to the single `new-run --model` value. Recorded in the proposal.
- **Suggestion 1, model identity — accepted.** Verified from the fixture's
  per-model usage: Sonnet 5 produced 6,857 output tokens including 4,124
  thinking tokens for $0.115408; the Haiku entry produced 13 output tokens for
  $0.004302 and is an auxiliary harness query.
- **Suggestion 2, the count and the wording — accepted.** Verified by counting
  the fixture: AC-001 through AC-011 and AC-013 through AC-024, twenty-three.
  A count of twenty-four has counted the note's third line, which begins
  `AC-013`.

---

## Summary

The proposal correctly identifies a prompt/schema boundary defect and uses a recorded provider response rather than an invented fixture. Its recommended strict direction is sound, but it does not yet close the defect across every producer and sibling parser boundary: the reviewer prompt still treats an allowed stable-ID gap as a possible defect, and `## Declared artifacts` has the same open membership rule as `## Acceptance criteria`.

## Verdict

**Ready for planning after required changes.** The proposal needs two bounded contract corrections and an explicit acceptance-evidence split before a planner can implement it without preserving the same model-sensitive failure under a different shape.

## Critical issues — must fix before planning

No critical issues found.

## High-risk areas

**Risk:** The remedy leaves the model-sensitive source of the numbering findings unchanged

- **Why:** The proposal changes the spec author, self-critique, and reconciliation prompts, but the two observed findings originate from `buildSpecReviewPrompt`, which states no stable-ID semantics. `ARCHITECTURE.md` section 8 requires revisions to preserve existing criterion IDs and assign new obligations greater unused IDs; a gap can therefore be the correct result of preserving identity. The proposal nevertheless lists renumbering as an honest resolution at lines 50–52.
- **Impact if ignored:** Different reviewer models, or different samples from the same model, can continue raising a gap as a defect. A reconciler can then spend another dispatch explaining a non-defect, reinstate an obligation the design does not contain, or renumber unchanged obligations. The parser cannot prove semantic ID preservation, so the last outcome can pass mechanical validation while breaking plan traceability.
- **Mitigation:** Add the reviewer prompt to the remedy. State that a missing sequence number alone is not a finding, that stable IDs may contain gaps, and that a reviewer must identify the actual design obligation missing from the specification rather than infer one from numbering. Remove renumbering from the listed valid responses and preserve the existing rule against ID reuse or reassignment.

**Risk:** The section-membership contract remains inconsistent at its sibling boundary

- **Why:** `validateSpecDoc` applies the same optional-list-marker transform to both structured sections. It currently accepts an unbulleted `AC-001: ...` line, and it accepts an arbitrary non-empty line under `## Declared artifacts` as an artifact path. The proposal defines a closed grammar only for acceptance criteria and describes skipping non-list lines as safe when paired with a prompt rule.
- **Impact if ignored:** Prose under `## Declared artifacts` can enter the signed scope and survive until a terminal delivery failure. Skipping non-list lines can silently erase an unbulleted criterion from `SpecDoc.acceptanceCriteria`; `coverageMeetsCriteria` then has no ID to require from the plan. A prompt instruction does not make either deterministic interpretation safe.
- **Mitigation:** Define both sections as closed lists. Require every non-blank line under `## Declared artifacts` to be exactly one `- <repo-relative-file>` entry and every non-blank line under `## Acceptance criteria` to be exactly one `- AC-NNN: <text>` entry. Refuse a non-list line with a section-specific membership message. Remove remedy 2 as an admissible fix; a future decision to allow notes needs explicit note syntax that cannot conceal a malformed artifact or criterion line.

## Medium and low concerns

- The evidence section does not define different expected outcomes for the two halves of the recommendation. Replaying `spec-reconciliation-web-calculator-numbering-note.json` must still refuse under remedies 1 and 3, but with the new membership diagnostic; it cannot prove that new prompt text changes provider behavior. Add acceptance evidence that separately checks all affected prompt builders, replays the recorded refusal, and records one authorized post-change run that reaches beyond `spec_review` with requested and effective model identity retained.

## Missing and underspecified areas

- Specify whether a numbering explanation belongs only in the model result summary or in a durable specification section outside the closed acceptance-criteria list. If no explanation is required because gaps are valid, say so and make the reviewer rule authoritative.
- State that changing models is an experiment, not a contract remedy. The current profile maps one frozen model to every dispatching stage, so a fresh run with another model systematically varies the whole panel and author chain rather than isolating reconciliation behavior.

## Suggested improvements

- Record that the failing author turn's effective authoring model is `claude-sonnet-5`; the fixture's Haiku usage is an auxiliary harness query, not evidence that two models authored the response.
- Correct “twenty-four real criteria” to twenty-three criterion entries and change “a model that states it anyway” to “a model that writes it anyway.”
