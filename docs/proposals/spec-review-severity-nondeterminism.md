# Spec-review outcomes vary across runs on the same disclosed decisions

**Observed:** 2026-09-26, six sequential `new-run` chains against the
note-keeper target repository (`C:\Users\Shawn-work\repositories\testing-repos\note-keeper`),
all built from the same frozen profile shape and the same `design.md`/PRD at
commit `c32c6908d49b07c0969fbbe01945c652d3e7678d` (runs 3-6; runs 1-2 predate
that commit's last two design amendments but changed nothing the three
decisions below depend on). Run 6's blocking cost was $1.0984362, 5/5 agent
rows cleanly reported, 0 failed attempts — a clean stop, not an error.

**Revised:** 2026-09-26, after an independent review of the first version.
The first version blamed reviewer *severity* sampling, claimed identical
reviewer input, and described an author-stage difference that the retained
responses contradict. The corrections are listed under "What the first
version got wrong".

**Decision:** 2026-09-26 — the operator chose the recommended direction for
`spec_review` only, with disclosures recorded as author-reported findings.
Plan: `docs/features/disclosed-open-decisions/plan.md`.

**Hazards considered:** 7 ("Retries that vary nothing") is the closest. This
evidence does not test it: hazard 7 is about resending an *identical* prompt,
and the two compared reviewer dispatches did not receive provably identical
input (see "What the evidence does and does not show"). 11 (staffing) bears on
the withdrawn panel-widening option: the distinct-specialty rule is what
refuses it. 3 was considered for the reconciler defect runs 2 and 3 hit; that
defect is now fixed and recorded there. 14 ("Independence that cannot be
proven") and 12 do not apply — every dispatch here is already a separate
process, and no cross-target configuration differs.

## What happened

The PRD leaves three security questions undecided: access control for the
full-collection export archive, content-type/content-disposition handling for
non-image attachment downloads, and password-reset token properties. The spec
author disclosed all three as open decisions in several runs. What the review
panel and reconciler did with those disclosures varied:

| Run | export-archive access control | attachment content-type/disposition | password-reset token security | Outcome |
|---|---|---|---|---|
| 1 | — | — | raised, `follow_up` (non-blocking) | blocked on an unrelated rich-text-sanitization finding |
| 2 | — | — | raised, severity medium | blocked on a reconciler defect (finding 22 missing `changedLocations`) |
| 3 | raised, high | raised, medium | raised, medium | blocked on a reconciler defect (finding 31 `upstream_blocking` without a proposal) |
| 4 | — | — | — | blocked on an agent crash at `plan_review`, unrelated |
| 5 | raised, high, as a **defect in AC-003** → reconciler `addressed` (added export jobs) | not raised | not raised | passed `spec_review` |
| 6 | raised, high, **upstream** → reconciler `upstream_blocking` | raised, high, upstream → `upstream_blocking` | raised, high, upstream → `upstream_blocking` | blocked cleanly on findings 46-48 |

Rows 5 and 6 are taken from the retained responses now copied into
`test/fixtures/recorded/spec-review-note-keeper-runs-5-6-disclosed-decisions.json`.
Rows 2 and 3's reconciler failures are preserved in the two
`spec-reconciliation-note-keeper-missing-*.json` fixtures. Rows 1 and 4, and
the severities in rows 2 and 3, come from the run records read during the
original investigation and were not re-checked for this revision.

Only runs 5 and 6 reached a clean gate decision on these questions, so the
comparison below is between them. Run 5 also produced two unrelated findings:
a traceability gap (the PRD's 10-second note-creation goal, `addressed`) and
login rate-limiting (medium, upstream, `upstream_follow_up`). Run 6 also
produced two low traceability findings (preferences scope and soft UX
language), both `addressed`.

## Where runs 5 and 6 diverged

The two specifications the panel reviewed match on everything that matters
here. Both disclose the same three open decisions in nearly the same words
(run 5: *"leaves three security-relevant decisions open rather than inventing
obligations the PRD does not state"*; run 6: *"leaves three security-relevant
decisions to the design stage rather than inventing obligations the PRD does
not state"*), and both ownership criteria omit export jobs (run 5's AC-003,
run 6's AC-002).

The runs diverged at three points, and each one is a model judgment:

1. **Which disclosures became findings.** Run 5's security reviewer raised one
   of the three; run 6's raised all three.
2. **How the reviewer classified them.** Run 5 treated the export gap as a
   defect the spec could fix (`current_artifact`, at AC-003). Run 6 treated
   the same gap as a decision only the PRD can make (`upstream`).
3. **Which disposition the reconciler chose.** Run 5's reconciler fixed the
   export gap inline and routed its one upstream finding (rate-limiting,
   medium) to `upstream_follow_up`. Run 6's reconciler routed all three
   upstream findings to `upstream_blocking`, and its summary gives their high
   severity as the reason. The reconcile prompt (`src/prompts.ts`,
   `reconciliationDecisionContract`) states what each disposition *does* —
   "upstream_blocking blocks the run, upstream_follow_up does not" — but gives
   no rule for choosing between them.

## Where the gate actually decides

`specReviewGate` (`src/spec-stage.ts`) blocks only when a decision's
disposition is in `BLOCKING_DISPOSITIONS` (`cannot_determine`,
`upstream_blocking`; `src/plan-gate.ts`). A reviewer's severity is retained as
evidence and is never compared against anything at this gate — unlike
`code_review`, whose gate does apply a frozen severity threshold. Severity
reaches the `spec_review` outcome only indirectly, as one input the reconciler
may weigh, as run 6's did.

So the question that matters is not "what severity did the reviewer assign?"
but "did each disclosed open decision get a finding, and what disposition did
it get?" In run 5, two of the three disclosed decisions received neither.

## What the evidence does and does not show

- **Shown:** with the same model on every dispatch (`claude-sonnet-5`,
  first-party, same context window and output limit, standard tier, per each
  envelope's `modelUsage`/`usage`) and specifications that disclose the same
  gaps, review outcomes differed across runs.
- **Not shown: identical input.** The reviewer prompts were not retained. The
  two specifications are close but not identical (different AC numbering and
  wording). The two security-review dispatches also consumed visibly
  different input: run 5 took 2 turns, run 6 took 1. What run 5's extra turn
  did is unknown — the envelope does not keep the transcript. This evidence
  therefore neither confirms nor refutes hazard 7's claim about an identical
  prompt.
- **Not shown: sampling temperature.** The responses carry thousands of
  `thinking_tokens`, which suggests these are not deterministic calls, but
  token counts do not establish a temperature.

## What the first version got wrong

- It said run 5 did not raise the export-archive question because the author
  had already closed it. In fact run 5's reviewer raised it as a high defect,
  and the export jobs in run 5's final AC-003 were added by reconciliation
  decision 38. The first version compared run 5's spec *after* reconciliation
  (recovered from `git stash`) against run 6's, which made a reconciler change
  look like an author difference. The "author-stage variance" it described
  does not exist.
- It listed run 5's findings as sign-in rate-limiting, the preferences
  resource, and an artifact-shape question, "all routed `follow_up`". Run 5's
  findings were the 10-second goal (`addressed`), the export gap
  (`addressed`), and rate-limiting (`upstream_follow_up`); the preferences
  finding was run 6's.
- It said run 6's *panel* assigned `upstream_blocking`. Reviewers report
  severity and classification; the reconciler assigns disposition.
- It claimed "same input text" and treated the result as evidence against
  hazard 7. See the previous section.

## Recommended direction

Make the author's disclosed open decisions a structured part of the reviewed
artifact, and require an explicit disposition for each one:

- **The spec records open decisions as data, not prose.** `src/spec-doc.ts`
  has no field for them today; the disclosures in both runs are a paragraph in
  the Summary and Out-of-scope sections. Hard rule 3 allows changing the one
  spec schema because nothing has shipped.
- **Each disclosed decision becomes a review item that reconciliation must
  answer** with one of the existing typed dispositions, validated like any
  other decision. The upstream routes (`upstream_follow_up`,
  `upstream_blocking`, with a proposal candidate) already exist; nothing new
  is needed there.
- **Reviewers stay free to raise anything else**, including gaps the author
  never disclosed.

What this fixes: run 5's two unraised disclosures could not have passed the
gate silently; each would have needed a recorded decision and, if routed
upstream, a proposal candidate.

What it does not fix:

- **The disposition choice is still a model judgment.** Run 5 could have
  routed all three to `upstream_follow_up` and still passed. This guarantees
  every disclosed decision gets decided and recorded, not that it blocks. If
  the operator wants a consistent block/no-block outcome, that needs a stated
  rule in the reconcile prompt or a policy value — a separate decision.
- **It cannot find a gap the author never disclosed.** That remains the
  reviewers' job, with the variance observed above.
- **`plan_review` is the spec stage's twin by design.** Whether plans get the
  same treatment is an open scoping question for the implementation plan.

## Other options considered

1. **Do nothing structural.** Every review record is kept, and
   `bw proposal-export` lets an operator inspect proposals before acting.
   Costs nothing; leaves run 5's silent pass possible.
2. **Sample the reviewer more than once and take the worse severity** —
   *retargeted, not recommended.* Severity does not decide this gate, and
   re-sampling severity does nothing for a finding that was never raised. A
   variant that unions two panels' *findings* would target omissions, but it
   roughly doubles review cost, still leaves disposition to one reconciler,
   and guarantees nothing about disclosed decisions.
3. **Deterministically escalate a fixed list of security categories** —
   *not recommended.* Escalating severity does not affect the gate, and a
   version that forces a disposition would be a maintained list of
   note-keeper-flavoured topics that cannot keep up with the vague designs
   BuildWorks must handle.
4. **Widen the security lens to more than one seat** — *withdrawn.* Panel
   selection refuses a second reviewer with an already-seated specialty
   (`selectReviewers`'s seat check in `src/select.ts`; the distinct-specialty
   rule in `ARCHITECTURE.md`). Under today's rules a larger panel adds
   different lenses, not a second security vote. Doing this would need an
   explicit architecture decision.
5. **Enumerate every `user_id` entity in the ownership criterion** —
   *withdrawn.* It is a rule about note-keeper's data model, not a BuildWorks
   rule; it assumes a PRD data-model table BuildWorks has no input contract
   for; and it was aimed at an author-stage difference that turned out not to
   exist.
6. **`docs/features/stage-role-model-overrides/plan.md`** (proposed
   separately, same investigation) lets the reviewer role run on a different
   model than the author. It does not resolve this on its own: a different
   model is a different sample, and there is no evidence it would treat
   disclosed decisions more consistently.

## Note on the reconciler defect in runs 2 and 3

Runs 2 and 3 blocked because the reconciler returned upstream decisions
missing `changedLocations` or `proposal`, which the validator refused
(`spec.reconcile.invalid`) instead of producing a clean `spec.gate.block`.
That is fixed: `docs/features/reconciliation-disposition-shapes/plan.md` is
`Implemented`, and `docs/hazards.md` entry 3 records it.

## Evidence

- `test/fixtures/recorded/spec-review-note-keeper-runs-5-6-disclosed-decisions.json`
  — the durable copy. For each of runs 5 and 6: the spec author's
  self-critique response (the specification the panel reviewed), both
  reviewer reports, and the reconciliation response, each with its
  `num_turns`, `modelUsage` and `usage`. Its `provenance` block names the
  source files and what was dropped.
- The machine-local sources it was copied from — `.governance/raw/5/` and
  `.governance/raw/6/` in the note-keeper target, plus the `git stash`
  entries and `.governance/profiles/` used in the original investigation —
  are not relied on by this revision and may be deleted.

## Scope

This is a finding about the `spec_review` stage, discovered while diagnosing
why a note-keeper test run blocked. Nothing in BuildWorks has been changed
because of it. Choosing the recommended direction means writing a feature
plan for it under `docs/features/`; this proposal does not authorize
implementation or provider spend.
