# Normative removal accounting — code review

**Reviewed document:** `docs/features/normative-removal-accounting/plan.md`
**Review date:** 2026-09-04
**Effort:** high
**Hazards considered:** 17 is the change under review, and the review's central
question was whether the implementation follows its remedy paragraph literally
or substitutes a cheaper rule — it follows it. 4 drove Step 5: every guard this
diff adds was observed failing under a targeted mutation before being reported
as working, and one finding below exists because a stated rationale turned out
to be unfalsifiable when broken. 5 bears on the fixture that now carries the
verification claim: the recorded response and the governing specification it
was dispatched with are both real run output, extracted with provenance, and
finding 2 is about a provenance sentence that stopped being true when the
second field arrived. 3 was checked against `test/prompts.test.ts`: the removal
obligation is asserted per prompt, not only in the whole-file scan, because one
builder feeds both. 13 was checked in the other direction — whether the guard
invents an obligation the governing input never stated — and the reword tax it
implies is the plan's recorded assumption, not a defect found here. 7 bears on
the live run: the inconclusive result was recorded, not retried. Entries 1, 2,
6, 8, 9, 10, 11, 12, 14, 15 and 16 bear on code this review found no fault
with: the diff adds no parser or output path, discards nothing, makes no
downstream promise, spawns nothing, compares no model string, seeds no agent,
adds no second surface, claims no independence, sandboxes nothing, and adds no
remediation loop.

**Scope reviewed:** `git diff HEAD` over thirteen modified files, plus the one
untracked file this work adds —
`docs/features/normative-removal-accounting/real-run-evidence.md` (the review
file itself is the second untracked path). `git status --porcelain` reports no
other untracked entry. Checks: `npm run typecheck` clean; `npm test` in an
isolated copy of the working tree reports 704 tests, 703 passing, 0 failing, 1
environmental skip, against the pre-change baseline of 695/694/0/1 — and 705
tests, 704 passing on the re-run after finding 1's test was added;
`npm run check:docs` exits 0 with only the pre-existing historical-tier path
warnings; `node .claude/skills/run-buildworks/driver.mjs smoke` reports 12/12
steps as expected. Both copies were deleted afterwards, and the real
repository's `HEAD` never moved.

## Summary

The implementation does the thing the hazard's remedy paragraph asks for and
resists the two cheaper versions of it. Removals ride the claim channel that
already exists, so no schema, migration, or storage guard changed;
`deriveRemovedNormativeNodes` is the existing multiset diff with its arguments
swapped rather than a second counting loop, which keeps the whitespace
tolerance in one place; and the author still never states which direction a
claim is for — deterministic code decides that from the two derived sets, which
is the authority split `ARCHITECTURE.md` section 12 describes. Both stages fail
closed with their own message under the same conversion guard the addition
branch uses, and the reason that guard must stay shared is now written where a
future reader will hit it.

The verification rests where section 21 says it should. The one-claim form of a
real plan-author response reports its superseded task as an unclaimed removal,
and the two-claim form of the same response validates cleanly — the negative
and the positive are visibly one claim apart, and both were checked against the
governing specification that run actually dispatched. Every new guard was
broken and restored: additions-only matching, an always-empty
`unclaimedRemovals`, each stage's abort condition, and the prompt sentence.

Two findings survived verification, both in the diff's own new material rather
than in the production path. Withheld: the pre-existing imprecision in section
12's "handled as `cannot_determine` and blocks", which reads as though an
unclaimed node were converted when in fact the stage aborts with no decision
row at all — the removal sentence mirrors that wording rather than introducing
it, and rewriting the addition half is outside this plan. Also withheld as
speculative: both harness emitters scrape the *first* criterion or task line as
the superseded node, which is correct for every document these fixtures build
today and would misname the claim only for a future fixture that replaces a
later node; the scrape throws rather than silently returning nothing, and no
current test reaches the case.

## Findings

**Finding 1 — the repeated-claim case the accounting was restructured for had
no test, so the restructuring was unproven**

- **Where:** `src/reconciliation.ts` (`validateReconciliation`, the
  per-direction provisional counters), asserted now in
  `test/reconciliation.test.ts` ("one decision may claim the same removed text
  twice when the node was there twice").
- **Why it matters:** the plan's Task 2 Step 2 required one provisional counter
  per direction specifically because a decision may claim one text twice when a
  node appears twice in an artifact. Nothing in the suite exercised that: every
  removal test claimed distinct texts, so a regression collapsing the two
  counters, or an off-by-one in the provisional decrement, would have left the
  file green. Hazard 4 in its exact shape — the code and the tests agreeing
  about a case neither had tried. Concretely, before the test existed: a
  before-set of `["dup node", "dup node"]` against an empty after-set with one
  decision claiming `"dup node"` twice had no assertion anywhere, and the
  matching behaviour for it was inferred from reading the loop rather than run.
- **Reproduced:** the three behaviours were run directly against the shipped
  validator before writing the assertion — two claims for two deletions
  validate with nothing unclaimed, one claim for two deletions leaves one in
  `unclaimedRemovals` with no conversion, and a third claim of an already
  consumed removal converts the whole decision and releases the addition it
  claimed alongside. The test was then written to those measured values, and
  the suite went from 38 to 39 tests.
- **Follow-on, and this is the part worth reading:** breaking the guard the
  comment claimed exposed the claim itself as unfalsifiable. Aliasing
  `wouldUseRemoved` to `wouldUseAdded` — the single shared counter the comment
  said "would decrement the wrong direction's budget" — failed no assertion in
  the file. It cannot: the two derived sets are computed from one count per
  node, so at most one direction is ever non-zero for a given text, and a
  shared counter could only decrement the non-zero one. The pair is still
  correct and still worth keeping, because it does not depend on that
  invariant, but the comment claimed a failure mode nobody can reach. It now
  says what was measured instead.

**Finding 2 — the recorded fixture's fidelity sentence stopped being true when
the governing specification was added to it**

- **Where:** `test/fixtures/recorded/plan-reconciliation-web-calculator.json`
  (`provenance.fidelity`).
- **Why it matters:** the fixture is `current`-tier evidence whose entire value
  is that its provenance is exact — it is the file the verification claim now
  rests on, and `CLAUDE.md` requires recorded evidence to say what it is and
  what was dropped. The sentence read "Every value below is verbatim as the
  model returned it", which was accurate for the response alone. Executing
  Task 2 Step 2c required the governing specification the run dispatched — the
  validator checks each claim's grounding against it, and without it both
  recorded decisions convert on grounding and the replay proves nothing about
  the accounting. Adding `specification` left a blanket claim that the model
  returned a document it had in fact received, which is the one kind of error
  this file must not contain: a reader trusting it would treat an input as
  model output.
- **Reproduced:** read back out of the committed file and compared against what
  each field is. The sentence now scopes verbatim-as-returned to `beforePlan`,
  `afterPlan`, and `decisions`, states that `specification` is verbatim as the
  run supplied it and was received rather than written, and keeps the
  dropped-envelope list. The replay tests were rerun after the edit — 39 of 39
  pass, so the correction touched prose only.

## Second pass — the operator-authorized list-marker remedy

**Scope reviewed:** the two-part remedy that landed after the findings above
were reconciled, and only it: `normalizeNodeText` and its use in
`validateReconciliation` (`src/reconciliation.ts`), the `nodeForm` parameter of
`reconciliationDecisionContract` and its two call sites (`src/prompts.ts`), and
the tests and fixture that accompany them
(`test/reconciliation.test.ts`, `test/prompts.test.ts`,
`test/fixtures/recorded/spec-reconciliation-web-calculator-list-marker.json`).
Everything the first pass covered is unchanged by it. This is the same reviewer
in the same session as the pass above, which hazard 14 is the reason to say
rather than imply: it is `unverified_self_attestation`, not an independent
process, and the break-tests below are what carries it instead.

**Checks:** `npm run typecheck` clean; `npm run check:docs` exit 0 with 17
hazard headings, so section 22's derived count is unaffected;
`node --test test/reconciliation.test.ts test/prompts.test.ts` 61 of 61;
`node --test test/spec-stage.test.ts test/plan-stage.test.ts` 96 of 96; the
full suite in an isolated copy as recorded in the plan's Implementation
section.

**No findings.** What was checked, and what each check would have caught:

- **Symmetry.** Every comparison the remedy touches normalizes both sides.
  `claimableAdded` and `claimableRemoved` key their entries through
  `normalizeNodeText`, and so does every claim looked up in them; the grounding
  check at the top of the same file still uses `collapseWhitespace` on both
  the governing text and the excerpt, which is correct — an excerpt is prose,
  not a node, and giving it marker tolerance would widen a different guard for
  no reason. A one-sided normalization is this repository's recurring defect
  and is what this check existed to find.
- **The reported text is the derived text, not the key.** The unclaimed sets
  emit `entry.node`, and the conversion message names
  `collapseWhitespace(c.artifactText)` rather than the normalized key, so an
  operator reading a genuine mismatch out of the audit trail sees what the
  author actually sent. A remedy that normalized the message too would have
  made the next marker-shaped defect invisible.
- **Collision reachability, traced rather than assumed.** Keying by
  `normalizeNodeText` means two derived nodes could in principle collapse to
  one map entry — a node beginning `- ` and another equal to its remainder —
  in which case the unclaimed report would name one text twice. The comment
  claims no node kind can produce it, and that claim was checked at the
  parsers: `listItems` in `src/plan-doc.ts` strips `^-\s*` from every task, so
  a task node carries no marker; coverage nodes begin with an AC ID; spec
  criterion nodes begin with an AC ID; declared-artifact nodes begin with a
  path segment. Unreachable today, disclosed in the comment, and it fails
  toward over-reporting rather than under-reporting if a future node kind ever
  reaches it.
- **Both halves proved by breaking them.** Reverting `normalizeNodeText` to
  plain `collapseWhitespace` failed three tests, the recorded replay among
  them; reducing the prompt's sentence block to the bare `nodeForm` argument
  failed the whole-file scan and both per-prompt assertions. Each was restored
  by editing back, never with `git checkout --`, which would have discarded the
  uncommitted work these files carry.
- **The expected values come from outside the session.** The positive assertion
  is the blocked run's own three decisions, replayed through the seam the stage
  uses, against the specification revision and design that run was dispatched
  with. Hard rule 5's failure mode — a fixture and the code agreeing while both
  are wrong — is not available here: the payload was produced by a provider
  before the remedy existed, and the fixture's provenance now names the test
  that consumes it.

**Withheld.** The tolerance rescues a shape the prompt now asks authors not to
send, so on the spec side a correct author and a line-copying author both
succeed and the suite cannot tell them apart. That is the operator's decision
as taken, not a defect: the prompt half exists precisely because the tolerance
alone would leave the honest shape unstated, and the plan's own reasoning for
choosing both is recorded. Also withheld: `normalizeNodeText` drops one marker
and not a run of them, which is asserted and deliberate; no reachable input
produces a doubled marker.

## Third pass — the run-3 recorded fixture and its two replays

**Scope reviewed:** only the material added after the second pass —
`test/fixtures/recorded/plan-reconciliation-web-calculator-prd.json` and the
two tests that read it in `test/reconciliation.test.ts` ("a completed run's
replacement claim validates in both directions" and "addition-only accounting
would have refused that same response"). No production code changed in this
pass; `git diff` over `src/` is byte-identical to what the second pass
reviewed, after two break-and-restore cycles described below. Same reviewer,
same session, `unverified_self_attestation` as above.

**Checks:** `node --test test/reconciliation.test.ts` 45 of 45;
`npm run typecheck` clean; `npm run check:docs` exit 0 with 17 hazard headings;
full suite in an isolated copy as recorded in the plan's Implementation
section.

**No findings.** What was checked:

- **The fixture's three documents are the run's, proved by hash.** Each of
  `beforePlan`, `afterPlan`, and `specification` was hashed with the run's own
  `sha256Hex(normalizeText(...))` and matched against `planHashBefore`,
  `planHashAfter`, and `specHash` in the run's audit trail before the file was
  written; the extraction script throws rather than writing a mismatch. This
  caught a real error in the obvious approach: the pre-reconciliation revision
  is *not* the authoring dispatch's output but the self-critique round's
  artifact, and taking dispatch order on trust would have committed the wrong
  before-revision and a delta that never existed.
- **Both tests were broken before being believed.** Neutering the removal
  direction in `validateReconciliation` failed the positive test along with
  five others; replacing the claim-matching refusal with a no-op failed the
  counterfactual test along with five others. Each mutation was reversed by
  editing it back, and the file returned to 45 of 45 both times.
- **The counterfactual is an input variant, not a mutation.** It reproduces
  addition-only accounting by removing the deleted node from the before-set,
  which leaves the added set at three and the removed set empty — asserted in
  the test itself, so a future change that made that construction stop
  suppressing removals would fail rather than silently pass.
- **The positive test cannot become a tautology.** It asserts the node counts
  (39 before, 41 after, 3 added) and the removed node's exact text before
  asserting the outcome, so a change to `planNormativeNodes` that emptied the
  delta would fail rather than pass over nothing.

**Withheld.** The fixture repeats the governing specification in full, which is
some kilobytes duplicated across three recorded fixtures now. Deduplicating
them would put one fixture's evidence behind another's provenance, and the
whole value of these files is that each stands alone — not a finding.
