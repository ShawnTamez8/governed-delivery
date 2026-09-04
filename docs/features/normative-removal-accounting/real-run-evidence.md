# Normative removal accounting — live run evidence

**Status:** recorded — the second run blocked this plan's gate, the operator's
decision of the same day cleared it, and the third run is the plan's outcome 2
**Run dates:** 2026-09-04 (three operator-authorized runs, $1.98227 in total)
**Outcome:** run 1 (clamp) — outcome 3, no replacement, inconclusive. Run 2
(web-calculator acceptance-criterion design) — a live author claimed both
halves of a replacement on its first attempt, and every claim in the response
was refused for a reason outside this change: the acceptance-criterion list
marker. That is none of the plan's four outcomes, and it stopped completion
pending an operator decision, taken the same day. Run 3 (the operator's
PRD-form design) — **outcome 2**: a completed run whose plan reconciliation
replaced a normative task, claimed both halves, and passed its gate with
`unclaimedRemoved=0`, proved by replay against the run's own hashes and shown
to depend on the new accounting by a counterfactual replay. It cost $1.34097,
above the range stated before it ran; the overrun is recorded in that section.
**Hazards considered:** 3 is what run 2 found — the prompt asks for "the exact
text of the added or removed node" and never says that a criterion's node form
drops the `- ` marker the artifact line carries, so a constrained field was
validated against a shape the prompt never stated, and the invocation was paid
for before it failed. 17 is the change under test, and run 2 is the first live
evidence that its author-side obligation is answerable: both halves were
claimed, unprompted by any retry; run 3 is the accepted path completing. 7
governs what happens next — no run is repeated, and each of the three was its
own authorization rather than a retry of the one before, which is also why run
3's design was changed rather than resent. 5 bears on how these outcomes are
named: run 1 exercised nothing and run 2 was refused, so neither is recorded as
the accepted path working end to end, and run 3 is claimed only for what it
actually exercised — a plan-side replacement, no marker, no spec-side claim.
4 is why each response was extracted into `test/fixtures/recorded/` rather than
described: a finding that rests on a machine-local envelope is a finding nobody
else can check, and run 3's replay is committed with the counterfactual that
shows it is not a tautology.
13 bears on the remedy and is why it was put to the operator rather than
applied while writing this record: tolerating the marker changes what the
deterministic check accepts, which is a design decision, not a cleanup. The
decision came, and what shipped under it is in the closing section. Entries 1, 2, 6, 8–12 and 14–16 bear on nothing in
either run: no parser changed, no output was discarded, no downstream promise
was made, nothing new was spawned, no configuration surface moved.

## Run 1 — the driver's clamp design

The operator authorized one paid chain during Task 6 Step 2, after the stated
cost range of $0.25–$0.85.

```
node .claude/skills/run-buildworks/driver.mjs paid --yes
claude 2.1.260 (Claude Code)

dispatches: 11   total cost: $0.24558
stages: spec=passed spec_review=passed awaiting_approval=passed plan=passed
        plan_review=passed implementation=passed verification=passed
        delivery_check=passed
run 1 (clamp): completed

13/13 steps as expected
```

Retained target: `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788540972942\target`.

Read out of its store rather than inferred from the exit code, both reconcile
summaries carry `decisions=0; … unclaimed=0; unclaimedRemoved=0`, and
`finding_decision` is empty. Both panels reported clean, so each round's
reconciliation answered an empty findings set and returned its artifact
unchanged — the before and after hashes are equal in both stages. **Outcome 3:
inconclusive.** It exercised nothing this change added, and it is not repeated.

## Run 2 — the operator's web-calculator design

The operator authorized a second run and supplied a richer design: the
18-criterion web-calculator PRD, the same feature the retained
plan-reconciliation fixture came from. The driver committed one fixed clamp
design at the time and had no design or slug flag — that changed later the same
day, after run 3 — so this run used a machine-local copy of
`driver.mjs` with three substitutions — repository root, `DEFAULT_SLUG`, and
the design read from a file — leaving the byte-exact approval-signing path and
the delivery assertions identical. A free `smoke` against the patched copy
confirmed the target committed the right design under the right slug before
anything was spent. Stated cost range beforehand: $0.50–$1.20.

```
dispatches: 5   total cost: $0.39572
  spec-author (author, claude-sonnet-5) $0.02901 15561ms
  spec-author (author, claude-sonnet-5) $0.10133 59066ms
  spec-reviewer-traceability (reviewer, claude-sonnet-5) $0.09673 59675ms
  spec-reviewer-consistency (reviewer, claude-sonnet-5) $0.06668 55381ms
  spec-author (author, claude-sonnet-5) $0.10196 52815ms
stages: spec=passed spec_review=blocked
run 1 (web-calculator): blocked

3/13 steps as expected
```

Retained target: `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788541898254\target`.
The chain stopped at `spec_review`; every later driver step failed because the
run was blocked, which is the expected cascade and not eleven separate
failures.

### What the panel and the author actually did

The panel reported three findings — a missing touch-input criterion, an
unstated precedence qualifier the spec had added to AC-020 on its own
authority, and an out-of-scope exclusion narrower than the design's. The
author answered all three `addressed`, and the decision for finding 2 is the
case this plan was written for:

```
finding 2, claim 1: "- AC-020: The initial theme follows the operating system
  preference via the `prefers-color-scheme` media query when no stored
  preference exists."
finding 2, claim 2: "- AC-020: The initial theme follows the operating system
  preference via the `prefers-color-scheme` media query."
```

Two claims for one replacement — the superseded text and the text that
replaced it — each grounded in the design's own wording, produced on the first
attempt with no retry and no remediation round. That is precisely what the
revised reconciliation prompt asks for, and it is the first live evidence that
a real author can satisfy the removal obligation.

### Why it blocked anyway, measured rather than reasoned

Every `artifactText` in the response carries the artifact's list marker.
`specNormativeNodes` renders an acceptance criterion as `<id>: <text>`, with no
marker, so no claim matched a derived node in either direction and both
claiming decisions converted:

```
derived added:    "AC-020: The initial theme follows …media query."
                  "AC-033: Every button responds to touch input (tap), …"
derived removed:  "AC-020: The initial theme follows …when no stored preference exists."
author claimed:   "- AC-020: …", "- AC-020: …when no stored preference exists.", "- AC-033: …"

validator: 2 conversions, unclaimedNodes 2, unclaimedRemovals 1
audit:     d1=cannot_determine d2=cannot_determine d3=addressed;
           conversions=1:addressed->cannot_determine,2:addressed->cannot_determine;
           unclaimed=2; unclaimedRemoved=1
           spec.gate.block — spec_review blocked: finding id(s) 1, 2
```

Replaying the committed response through the same seam with one change — the
leading `- ` stripped from each claim and nothing else — gives 0 conversions,
`unclaimedNodes` empty, `unclaimedRemovals` empty, and all three decisions
staying `addressed`. The marker is the whole cause.

**The failure is direction-independent and older than this change.** Finding
1's claim is a pure addition and was refused identically, so the same run would
have blocked before removals were ever accounted for. What this change did was
raise the odds of hitting it: a replacement now owes two claims instead of one,
and each is a chance to copy the artifact line verbatim. The mismatch is
structural on the spec side rather than a matter of taste — the document schema
*requires* criteria to be written `- AC-001: <text>`, so the line the author
copies can never equal the node the validator derives. The plan-side fixture
escaped it only because that run's plan wrote its tasks without markers.

The retained response, the specification revision it was given, the revision it
returned, and the governing design are committed at
`test/fixtures/recorded/spec-reconciliation-web-calculator-list-marker.json`
with a `provenance` block. When this section was first written no test consumed
it, deliberately, because any test written before the decision would have
encoded an answer the operator had not given. It is now the contract test for
the remedy the operator chose, and its provenance names the test that reads it.

### What this settles

**Settles:** a live author, asked to claim both halves of a replacement, does
so — unprompted, grounded, on the first attempt. The two-direction accounting
and both stage aborts behaved exactly as their tests say, including releasing
the addition and the removal when their decisions converted, and
`unclaimedRemoved` appears in a live audit trail carrying a non-zero count for
the first time.

**Does not settle:** whether the accepted path completes a run end to end. It
did not here, and the reason was upstream of this plan. No claim is made that
the removal obligation is satisfiable in production until a run passes the
gate with `unclaimedRemoved=0` over a real replacement.

### The decision this left open

Completion of `docs/features/normative-removal-accounting/plan.md` stopped
here. The plan forbids softening the guard, relaxing the prompt, or editing a
fixture to clear a blocking live result without an operator decision, and
nothing of that kind was done while the question was open.

The narrower identity-aware rule the plan's Assumptions deferred is **not** the
remedy: it would have left finding 1's addition claim failing exactly as it
did. The candidate remedies were (a) tolerate a leading list marker in the
claim comparison, the way whitespace is already tolerated at that boundary,
(b) state the node form in the prompt where `artifactText` is requested —
hazard 3's own prescription — or (c) both. (a) alone changes what the
deterministic check accepts; (b) alone leaves a correct-looking answer failing
whenever an author copies the line it is looking at.

### The decision taken

**2026-09-04, the operator chose (c) — both.** What shipped:

- `normalizeNodeText` in `src/reconciliation.ts` collapses whitespace and then
  strips one leading `-`, `*`, or `+` marker, and every claim comparison keys
  both the derived node and the claimed `artifactText` through it. Applying it
  to one side only is the defect shape this repository keeps producing, so the
  symmetry is the point. The refusal message keeps naming the author's raw
  text, so a genuine mismatch is still diagnosable from the audit trail.
- `reconciliationDecisionContract` in `src/prompts.ts` takes a `nodeForm`
  argument, and each of its two callers supplies the node form for its own
  artifact kinds — `AC-001: <criterion text>` and a bare path for the spec,
  the task text itself and `AC-001 -> <artifact path>` for the plan — each
  followed by the instruction to leave the marker off.

Each half was proved by breaking it. Reverting `normalizeNodeText` to plain
`collapseWhitespace` failed three tests, the recorded replay among them.
Reducing the prompt's sentence block to the bare `nodeForm` argument failed the
whole-file scan and both per-prompt assertions. Both were restored by editing
back.

The recorded response is now the contract test: `test/reconciliation.test.ts`
drives the blocked run's own three decisions through the same seam the stage
uses and asserts they validate with nothing converted and both unclaimed sets
empty. That is the fix measured against the output that failed, not against a
payload invented alongside it, and it is why the fixture was extracted before
the decision rather than after.

**What this still does not settle.** The remedy is verified against a recorded
response, not against a fresh dispatch. Run 3 below completed a chain and
passed `plan_review` over a real replacement, but it never exercised the marker
tolerance — its claims carried no marker — so no live run has yet passed the
`spec_review` gate over a spec-side replacement, which is the shape that
failed. Proving that costs another paid run, which is a separate decision, and
re-running the same chain in hope of a better answer is hazard 7. What runs 1
and 2 settle and do not settle is stated above and is unchanged by the remedy.

## Run 3 — the operator's PRD design, and the accepted path end to end

The operator authorized a third run and supplied a different design: a
product-requirements document in requirement-numbered form — purpose, goals,
target users, scope, fifteen `RQ-###` functional requirements and five
`NFR-###` non-functional ones — rather than run 2's acceptance-criterion list.
The same machine-local driver copy drove it, with the design file swapped and
nothing else changed, and a free `smoke` first confirmed the target committed
the right design under the right slug. Stated cost range beforehand:
$0.30–$1.20.

```
dispatches: 11   total cost: $1.34097
  spec-author (author, claude-sonnet-5)                $0.02889  14980ms
  spec-author (author, claude-sonnet-5)                $0.10923  59035ms
  spec-reviewer-traceability (reviewer, sonnet-5)      $0.04682  34344ms
  spec-reviewer-consistency (reviewer, sonnet-5)       $0.05779  42681ms
  spec-author (author, claude-sonnet-5)                $0.11314  85011ms
  plan-author (author, claude-sonnet-5)                $0.02628  16796ms
  plan-author (author, claude-sonnet-5)                $0.12810  72346ms
  spec-reviewer-traceability (reviewer, sonnet-5)      $0.13236  80371ms
  spec-reviewer-consistency (reviewer, sonnet-5)       $0.18361 120485ms
  plan-author (author, claude-sonnet-5)                $0.10946  53606ms
  implementer (author, claude-sonnet-5)                $0.40528 215265ms
stages: spec=passed spec_review=passed awaiting_approval=passed plan=passed
        plan_review=passed implementation=passed verification=passed
        delivery_check=passed
run 1 (web-calculator): completed        13/13 steps as expected
```

**It cost $1.34097, above the $1.20 top of the range stated before it ran.**
The overrun is recorded rather than rounded: the implementer alone was $0.40528
against a four-file deliverable, and the plan panel's two reviewers were
$0.31597 between them on a 41-node plan. The two earlier runs were $0.24558 and
$0.39572, so design richness raises reviewer and implementer cost faster than
it raises author cost, and the range quoted from those runs was too low for a
20-requirement design that completes all eight stages.

Retained target:
`C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788544250363\target`.
Delivery certified four declared artifacts — `index.html`, `css/styles.css`,
`js/calculator.js`, `js/theme.js` — with `scopeMatch=yes declared=4
delivered=4 missing=[]`, and `verify-audit` reported the chain valid.

### What the reconciliations did, read out of the store

Both rounds are recorded, and they exercised different halves of the contract:

```
spec reconcile round 1: decisions=3; findings=1,2,3;
  d1=upstream_follow_up d2=addressed d3=addressed; conversions=;
  unclaimed=0; unclaimedRemoved=0; proposals=1:1:follow_up:created
plan reconcile round 1: decisions=2; findings=4,5;
  d4=addressed d5=addressed; conversions=;
  unclaimed=0; unclaimedRemoved=0; proposals=
```

The spec round answered a traceability finding about an unsourced keyboard
detail with `upstream_follow_up` and a proposal candidate — the honest route
for a concern the design is silent on, which is the route the revised prompt
names — and answered two more `addressed` with no normative claims at all,
because both revisions changed the specification's Summary rather than any
normative node. Zero delta, zero claims, nothing owed in either direction.

The plan round is the one this plan was written for. Both decisions were
`addressed`, and finding 5's carried **two** claims.

### The replacement, proved rather than inferred

`unclaimedRemoved=0` reads identically whether a removal was claimed or no
removal ever happened, so the round was replayed through the seam
`src/plan-stage.ts` uses. The three documents were identified by hashing each
against the run's own audit trail — `planHashBefore`, `planHashAfter`,
`specHash` — not by dispatch order, which is how the pre-reconciliation
revision turned out to be the **self-critique round's** artifact rather than
the authoring dispatch's. All three matched:

```
nodes: before=39 after=41
ADDED (3):
  + "Link css/styles.css in the head of index.html, and load js/theme.js before
     js/calculator.js … so the persisted theme can be applied before first
     paint, then load js/calculator.js afterward"
  + "Ensure arithmetic operations in js/calculator.js parse operands as
     floating-point numbers (e.g., via parseFloat) …"
  + "Manually verify decimal-value calculations (e.g., 0.1 + 0.2, 3.5 x 2,
     10 ÷ 4) produce correct results in the calculator"
REMOVED (1):
  - "Link css/styles.css and js/calculator.js and js/theme.js from index.html"

finding 5, claim 1: the removed task, verbatim
finding 5, claim 2: the task that replaced it
validateReconciliation: 0 conversions, unclaimedNodes [], unclaimedRemovals [],
                        f4=addressed f5=addressed
```

A live plan author answered a load-order finding by replacing a task, claimed
the superseded half and its replacement in one `addressed` decision, grounded
both in the approved specification, and the round passed its gate. Finding 4's
two claims are two genuine additions, so the same response exercises both
shapes at once.

**And the run depended on the new accounting rather than passing regardless.**
Replaying the identical response with the removal suppressed from the
before-set — which reproduces addition-only matching, the behaviour that
shipped before this feature, with the added set unchanged at three — converts
finding 5 to `cannot_determine` and blocks the round:

```
conversions: 1
  f5 addressed -> normative change "Link css/styles.css and js/calculator.js
     and js/theme.js from index.html" is not an added or removed node of this
     reconciliation claimed exactly once
unclaimedNodes: 1   unclaimedRemovals: 0
```

Both replays are committed as tests. The response, the two plan revisions, the
governing specification, and a `provenance` block recording the hash-matching
identification and what was dropped are at
`test/fixtures/recorded/plan-reconciliation-web-calculator-prd.json`.

### What run 3 settles

**Settles — this is the plan's outcome 2, on a run that finished.** A real
provider, given a reviewer finding it chose to answer by replacement, produced
both halves as separate grounded claims on its first attempt; the two-direction
accounting accepted them; `plan_review` passed with `unclaimedRemoved=0`; and
the run completed all eight stages and delivered every declared artifact. The
counterfactual replay shows the acceptance was the new code's doing. The
`upstream_follow_up` route the prompt offers for a genuinely silent design was
also taken in the same run, unprompted.

**Does not settle:** the list-marker tolerance was never exercised. This plan
author wrote its tasks as bare lines and its claims carried no marker, so
`normalizeNodeText` was a no-op on every comparison here — the marker path's
only evidence remains run 2's recorded response. Nor did the spec side produce
a normative claim of any kind, so the `spec_review` gate has still not been
observed passing over a real spec-side replacement; that is the run 2 shape,
and run 2 blocked before the fix existed. Both gaps are named rather than
absorbed into the outcome above.
