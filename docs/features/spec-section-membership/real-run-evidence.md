# Spec section membership — real-run evidence

**Status:** the prompt half is proven; the chain blocked three stages later
**Plan:** `docs/features/spec-section-membership/plan.md` (Task 7)
**Run date:** 2026-09-05
**Hazards considered:** 3 is the entry the fix belongs to and the entry this run
tests: the question a paid run answers and a replay cannot is whether a live
author, told what a section admits, writes inside it anyway — and this one did
not. 7 is why the run was permitted at all: the prompts changed between this
attempt and the blocked one before it, so the chain varies something
systematically rather than repeating a call. 4 governs what is recorded here:
the response that blocked this run is committed rather than described, because a
proposal that rests on a machine-local file rests on nothing a teammate can
execute. 17 bears on the observed author behaviour: two obligations were removed
on self-review and their IDs left unused, which is the removal accounting's
ordinary residue, and no reviewer raised the gap as a defect this time. 11 bears
on the whitespace rule the run exercised for the first time against a live
author: four declared paths, none refused. 16 bears on the new block — three
reviewers asked for a change the plan document cannot express, so the
reconciliation loop was aimed at an artifact whose schema forbids the answer. 5,
6, 12, 13, 14, 15 and 18 were read: the run reached no delivery, no verification,
no second surface, no new spawn, and invented no obligation.

---

## Outcome: the specification stage is fixed, and the same shape appeared at the plan

One paid run was authorized and executed on 2026-09-05, after Tasks 1-6:

```
node .claude/skills/run-buildworks/driver.mjs paid --yes
```

It passed `spec` and `spec_review` — the two stages the 2026-09-05 run before
the fix never got past — then passed approval and `plan`, and blocked at
`plan_review`, stage 5 of 9. Ten dispatches, $1.25141, inside the $1.00-$2.00
budget.

| | |
| --- | --- |
| Dispatches | 10 |
| Total cost | $1.25141 |
| Stages | `spec` passed, `spec_review` passed, `awaiting_approval` passed, `plan` passed, `plan_review` blocked |
| Target | `bw-run-skill/1788668925127` (retained, not cleaned) |

| # | Stage | Agent | Role | Cost |
| --- | --- | --- | --- | --- |
| 1 | spec | `spec-author` | author | $0.097968 |
| 2 | spec | `spec-author` | author (self-critique) | $0.184072 |
| 3 | spec_review | `spec-reviewer-traceability` | reviewer | $0.193078 |
| 4 | spec_review | `spec-reviewer-security` | reviewer | $0.101300 |
| 5 | spec | `spec-author` | author (reconciliation) | $0.119560 |
| 6 | plan | `plan-author` | author | $0.069377 |
| 7 | plan | `plan-author` | author (self-critique) | $0.097427 |
| 8 | plan_review | `spec-reviewer-traceability` | reviewer | $0.126974 |
| 9 | plan_review | `spec-reviewer-consistency` | reviewer | $0.108039 |
| 10 | plan | `plan-author` | author (reconciliation) | $0.153620 |

**Model identity.** The requested model is the single value `new-run --model`
froze into every entry of the profile's `modelMap`, so every dispatch above ran
on the same requested model. Each dispatch reports `claude-sonnet-5` as the
authoring model and `claude-haiku-4-5-20251001` as an auxiliary harness query —
on the reconciliation dispatch, Sonnet produced 8,433 output tokens including
5,480 thinking tokens, and the Haiku entry is a few tokens of harness overhead.
Nothing here is evidence that two models authored one document.

## What the run establishes about this plan

**The author needed to explain a numbering decision and put it outside the
structured section.** This is the behaviour the fix exists to produce, and it is
the one thing a replay cannot show. The specification the author wrote carries a
`## Notes on criteria numbering` section — its own heading, after
`## Acceptance criteria` — and inside it:

> An earlier draft included an AC-027 requiring a defined division-by-zero error
> indication and an AC-028 requiring an automated test suite … Both were removed
> on self-review … These remain open questions for the design owner rather than
> settled requirements; the IDs AC-027 and AC-028 are intentionally left unused
> rather than reassigned.

That is the same decision the blocked run's author made, expressed in the same
words, in a place the schema admits. Before the fix, the equivalent explanation
went inside `## Acceptance criteria` and terminated the run.

**Every line under both structured sections was a member.** Twenty-six criteria,
`AC-001` through `AC-026`, no prose line; four declared artifacts —
`src/index.html`, `src/styles.css`, `src/calculator.js`, `src/theme.js` — written
unbulleted and whitespace-free, so the whitespace rule admitted a live author's
real output on its first exposure to one.

**No reviewer raised the unused IDs as a defect.** The panel's three spec
findings were an inaccurate AC-to-NFR mapping statement in the notes section, and
two upstream findings against the design (division-by-zero behaviour, and the
keyboard key-to-action mapping). With `AC-027` and `AC-028` withdrawn and left
unused, the numbering carries exactly the gap the previous panel called an
orphaned criterion — and this panel did not. One run cannot prove the prompt
sentence caused that; it can only record that the finding class did not recur on
the first chain where the sentence was present.

## What the run does not establish

It says nothing about `code_review`: the chain stopped four stages short, so
`docs/features/code-review-stage/plan.md` Task 10 is still open and no
code-review response exists yet.

It is one sample. A different sample from the same model could still write a note
inside the section; what changed is that the prompt now tells it not to and the
parser now names the rule when it does.

## Why it blocked: the same shape, one document later

Three `plan_review` findings said a coverage entry omitted a second implementing
artifact — `coverage-entry-omits-required-artifact` at `AC-017`, and
`coverage-omits-implementing-artifact` at `AC-008` and `AC-017`. The author
answered them the most direct way the document allows, by listing both artifacts
on the coverage line:

```
AC-008 -> src/index.html, src/calculator.js
AC-017 -> src/index.html, src/theme.js
```

A Coverage line admits exactly one artifact path to the right of `->`, and no
prompt says so. `src/plan-doc.ts` splits on the first `->` and takes the whole
remainder as the target, so the pair became one path, that path is not in the
signed scope, and the gate refused:

```
plan.coverage.unkeepable — plan promises coverage outside the approved scope: AC-008; AC-017
```

This is hazard 3 at the plan boundary, and it is not caused by this plan's
change: nothing here touches `src/plan-doc.ts`, `buildPlanAuthorPrompt`,
`buildPlanReviewPrompt`, or `buildPlanReconcilePrompt`. It is the sibling of the
defect just fixed — a constrained field whose constraint the prompt never states,
answered by an author doing the reasonable thing — and it is written up as
`docs/proposals/plan-coverage-single-artifact-blocks-run.md`.

## The retained evidence

The reconciliation response that blocked the run is committed at
`test/fixtures/recorded/plan-reconciliation-web-calculator-multi-artifact-coverage.json`
with a `provenance` block naming the run, the stage, the dispatch time, the
capture date, the cost, the effective models, what was dropped from the harness
envelope, and what was sanitized. It was copied in the moment the proposal came
to depend on it.

The target at `bw-run-skill/1788668925127` is retained and has not been cleaned,
but it is machine-local: the committed fixture is the copy anything may depend
on.
