# Plan coverage single artifact — real-run evidence

**Status:** recorded — the third run passed `plan_review` with the change live; Task 7 closed
**Plan:** `docs/features/plan-coverage-single-artifact/plan.md` (Task 7)
**Run dates:** 2026-09-06, two runs: the first blocked at stage 1, the second passed the plan stage
**Hazards considered:** 3 is the entry the change belongs to, and the second run
is its live evidence: a live author wrote twenty single-path coverage lines and a
live panel, told which coverage concerns the document can express, raised a
task finding where the previous panel had demanded a second artifact. 16 is why
that panel behaviour matters — the finding it raised was one the author could
answer, and did. 7 governs both runs: the first is not repeated because a repeat
of a block varies only the sample, and the second is not repeated because it
passed. For the first run, 1 is the entry the observed block belongs to, and it is
recorded as a proposal rather than fixed here — the extractor discarded a
well-formed result because it carried a sentence of prose in front of an
unfenced object, a shape hazard 1's own enumeration does not list. 7 is why the
run was permitted and why it is not being repeated: the prompts changed between
this attempt and the last, which is systematic variation, but repeating *this*
block would vary only the sample. 4 governs what is written down: the refused
response is committed rather than described. 3 was the entry the run was
authorized to test and it reached none of the code that carries it, so nothing
here confirms or refutes the coverage fix. 2 is why a diagnosis exists at all —
the raw body was retained, so the refusal could be re-parsed instead of guessed
at. 6, 11, 13 and 16 bear on the change under test and were not exercised. 5,
8-10, 12, 14, 15, 17 and 18 were read and reached nothing in this run.

---

## Outcome, second run: `plan_review` passed in one round with the change live

After the extractor fix (`docs/features/unfenced-json-extraction/plan.md`) the
operator authorized a further run on 2026-09-06 (dispatches dated 2026-09-07
UTC). It passed `spec`, `spec_review`, `awaiting_approval`, `plan` and
`plan_review`, continued through `implementation` and `verification`, and
blocked at `code_review` on two correct findings — that stage's evidence, in
`docs/features/code-review-stage/real-run-evidence.md`. Thirteen dispatches,
$1.15759, target `bw-run-skill/1788742310835` retained. The plan-stage share was
five dispatches for $0.31738: author $0.02712, self-critique $0.07466,
traceability seat $0.10114, consistency seat $0.05992, reconciliation $0.05454.

**The author side.** The live plan author wrote twenty coverage lines against
four approved artifacts. Nineteen name exactly one path copied from the signed
scope — `src/calculator.js` ten times, `src/styles.css` four, `index.html`
three, `src/theme.js` two — and the twentieth, AC-020, takes the
`not_applicable` form with a rationale and an alternative verification, because
"no authentication required" has no artifact to point at. No line carried two
paths. Where several files contribute to one criterion the author chose one and
put the rest in a task: AC-016 (the page loads within two seconds) is anchored to
`index.html`, while its task keeps `index.html`, `src/styles.css`,
`src/calculator.js` and `src/theme.js` free of build dependencies — the
representative-anchor rule as the prompts state it.

**The reviewer side.** The panel raised one finding (`unbacked-verification-method`,
medium, at `AC-020`): the alternative verification promised an inspection of
three files that no task scheduled. It asked for a *task*, not for the coverage
line to name more files — the redirect Task 3 put into the review prompt — and
the author's reconciliation added the task and dispositioned the finding
`addressed`. The gate passed in round 1. On the previous run the same design
drew three findings demanding a second artifact on one coverage line and the
author obliged, which is the block this feature was written to close.

**What this establishes.** Both boundaries of the change held against a live
author and a live panel on the design that broke them: the author wrote the
constrained field in the stated form, and the panel filed the concern the
document can express instead of the one it cannot. One run is one sample; it
says the prompts are sufficient on this design once, not that they always are.
Task 7 is closed and the plan is `Implemented`.

**What it does not establish.** Whether a criterion whose outcome necessarily
spans several files draws disagreement between author and panel about *which*
anchor is right — the second review's finding 2 — did not arise here: the panel
raised no wrong-anchor finding. That remains unobserved rather than disproved.

## Outcome, first run: the chain blocked at its first stage, and the change was never reached

One paid run was authorized and executed on 2026-09-06, after Tasks 1-6 and one
reconciled independent review:

```
node .claude/skills/run-buildworks/driver.mjs paid --yes
```

It blocked at `spec`, stage 1 of 9, after a single dispatch. **The plan stage was
never reached, so this run establishes nothing about the coverage change** —
neither that it works nor that it does not. It is recorded under its own name
rather than rounded into a nearer outcome.

| | |
| --- | --- |
| Dispatches | 1 |
| Total cost | $0.08103 |
| Model time | 36.95 seconds |
| Stages | `spec` blocked |
| Target | `bw-run-skill/1788674210677` (retained, not cleaned) |

**Model identity.** The requested model is the single value `new-run --model`
froze into every entry of the profile's `modelMap`. The dispatch reports
`claude-sonnet-5` as the authoring model, with `claude-haiku-4-5-20251001`
appearing as an auxiliary harness query.

## Why it blocked

The spec author returned one line of prose, a blank line, and a complete, valid
`AgentResult` object with no code fence. `extractJsonBody` accepts a body that
parses entirely as JSON, or a body carrying exactly one fenced block; prose
followed by an unfenced object is neither, so it refused with
`spec.content.invalid — spec author body refused: no JSON object found in
output`.

The response was not malformed: `JSON.parse` from the first `{` to the end of the
body yields the whole result, including a twenty-criterion specification. Written
up as `docs/proposals/prose-before-unfenced-json-discards-a-valid-result.md`
with four candidate remedies, none applied, and the response committed at
`test/fixtures/recorded/spec-author-web-calculator-prose-before-unfenced-json.json`.

## What this does and does not establish about this plan

**It does not implicate the coverage change.** The diff touches
`src/plan-gate.ts`, `src/plan-stage.ts`'s three refusal sites, and the four plan
prompt builders. The refusing code is `src/parse-output.ts`, which the change
does not touch, reached from the spec stage four stages before any plan prompt is
built. One positive observation survives: `new-run` and the profile freeze
succeeded, so nothing in the change disturbed run creation.

**It does not establish anything about a live plan author or panel.** Whether a
live author, told that a coverage line names exactly one approved scope path,
stops writing a list — and whether a live panel, told that "this criterion also
touches another file" is not a coverage finding, stops raising it — are both
still unverified against the provider. Every claim the plan makes about them
rests on the deterministic tests and on the recorded response from the previous
run.

## What would close Task 7

One authorized paid run that reaches `plan_review` with the coverage change in
place. Reaching it requires the extractor defect above to be resolved, or a run
in which no dispatch happens to prefix its JSON with a sentence — which is
chance, not a plan, and can fire on any dispatch of any stage.

## The pattern across three runs

Three consecutive paid chains, three distinct blocks, each in a different
component and each invisible to a suite whose fixtures emit conforming bytes:

| Run | Blocked at | Cost | Cause |
| --- | --- | --- | --- |
| 2026-09-05 | `spec_review`, stage 2 | $0.41049 | a prose note inside `## Acceptance criteria` — hazard 3, the section's membership rule was never stated |
| 2026-09-05 | `plan_review`, stage 5 | $1.25141 | two artifacts on one Coverage line — hazard 3, the field's arity was never stated |
| 2026-09-06 | `spec`, stage 1 | $0.08103 | prose before an unfenced JSON object — hazard 1, a shape the extractor has no path for |

The first two were the same defect class at two document boundaries, and the
first fix demonstrably worked: this run's predecessor passed `spec_review` and
the author wrote its numbering note in a prose section, which is what the fix
asked for. The third is a different class and sits earlier than either, in the
one component every stage depends on. Each was found only by spending money, and
none of the three would have been found by the deterministic suite.
