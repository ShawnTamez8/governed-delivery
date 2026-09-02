# Step 5b Task 6 — second code review

**Status:** reconciled

**Reviewed implementation:** The uncommitted Task 6 reconciliation changes
against `docs/features/step5b-upstream-findings/plan.md`, especially Task 6,
`ARCHITECTURE.md` sections 12 and 13, and `docs/hazards.md`.

**Prior review:**
`docs/features/step5b-upstream-findings/2026-09-02-task6-code-review.md`.
That historical record remains unchanged. This second review examines the
implementation after its two findings were applied.

**Review date:** 2026-09-02

**Effort:** high. Independent review of the complete working-tree diff,
including staged, unstaged, and relevant untracked files.

**Hazards considered:** 1 (the reviewer-report and reconciliation validators
are model-output boundaries; finding 2 shows that their claimed exact schema
still accepts and discards unknown members), 2 (raw output retention and the
new before/after hash events were traced; no new discarded-output path was
found), 3 (findings 3 and 4 are prompt/schema mismatches that can reject a paid
reconciliation), 4 (the new mixed-case tests assert the wrong canonical shape,
and the advertised-example test uses only one finding, so implementation and
fixtures currently agree without proving the governing requirement), 7 (the
legacy round loop and the deliberately deferred Task 9 gate were traced so
they would not be misreported as Task 6 defects), 13 (the normative-delta and
grounding controls were checked against the no-invention rule; no additional
obligation was inferred by this review), and 14 (reconciliation remains a
separate author dispatch and no reviewer is granted an author output
capability). Hazards 5, 6, 8, 9, 10, 11, 12, and 15 are not newly exercised by
these findings: they concern delivery completeness, keepable coverage,
executable resolution, setup hooks, model aliases, default staffing,
cross-target configuration, and proposal-subprocess write isolation.

**Scope reviewed:** `git diff HEAD` across the Task 6 production, fixture,
test, plan, and project-learning changes, plus the untracked
`src/reconciliation.ts`, `test/reconciliation.test.ts`, and prior Task 6 code
review. The personal `.claude/settings.local.json` file was not reviewed.

## Summary

Four actionable findings remain. Two are material contract problems: the
accepted mixed-classification case is split into two canonical findings and
two author decisions, and the new strict validator silently accepts unknown
fields. Two are prompt reliability gaps: a multi-finding round is shown an
incomplete decisions array, and the prompt does not state all conditional-field
prohibitions that deterministic code enforces.

The legacy severity gate continuing to decide the run is withheld deliberately:
the plan assigns activation of the decision-completeness gate to Task 9. The
review does not treat that recorded transition as a Task 6 defect.

## Findings

### 1 — high — mixed classifications cannot reach one canonical decision

**Where:** `src/spec-stage.ts` at the call to
`findingIdentity(report.location, report.intentKey)`, mirrored in
`src/plan-stage.ts`; the mixed-case assertions in `test/spec-stage.test.ts` and
`test/plan-stage.test.ts`.

**Reachable case:** Two reviewers use the same `intentKey` for the same concern.
One classifies it `current_artifact` and supplies a real artifact heading. The
other classifies it `upstream` and, as required by the new validator, supplies
`upstream:design:<decision-key>` or
`upstream:specification:<decision-key>`.

**Why it matters:** Canonical identity currently includes `location`. Because
classification determines two necessarily different location shapes, the
stage creates two finding IDs and requires two reconciliation decisions. The
new tests explicitly assert that split. This contradicts Task 6's required
mixed case — one canonical finding with two immutable reports — and
`ARCHITECTURE.md` section 13, where contradictory recommendations are answered
by one decision without rewriting either report. It also leaves Task 7's
planned one-finding/two-report storage assertion without a runtime identity
that can produce it.

**Required correction:** Resolve the identity contract before Task 7. The
canonical concern needs a classification-independent identity or subject
location, while each immutable report retains its own classification and any
classification-specific route/location evidence. Both stage tests must then
prove one canonical finding, two unfused reports, and one author decision for
the accepted mixed case. If the intended behavior is instead two decisions,
that is a change to the accepted plan and binding architecture, not a test-only
adjustment.

### 2 — high — unknown reconciliation fields are accepted and discarded

**Where:** `validateReconciliation` in `src/reconciliation.ts`, beginning where
each decision is cast to an indexable object. The same parsing pattern appears
in reviewer reports, rejection grounding, normative changes, nested grounding,
and proposal candidates.

**Reachable case:** A reconciliation decision includes an undeclared member,
or an upstream proposal returns its own `impact` member. The validator checks
the known members, constructs a new typed object, and returns `ok: true`; the
unknown member is silently dropped. This was reproduced with both an
`unexpected` decision member and a nested proposal `impact` member.

**Why it matters:** Task 6 requires extras to be refused with named errors and
derives impact only from disposition. Silent dropping conceals producer/schema
drift and makes the validator less strict than its plan, comments, and test
name claim. The current structural-refusal test covers the specifically named
top-level `impact` and misplaced known fields, but not arbitrary members or
nested extras.

**Required correction:** Add exact allowed-key checks for each model-returned
object level and name the offending field in the refusal. Add regressions for
an unknown reviewer-report field, decision field, grounding field,
normative-change field, nested grounding field, and proposal field, including
nested `impact`.

### 3 — medium — the advertised decisions array is incomplete for real rounds

**Where:** `buildSpecReconcilePrompt` and `buildPlanReconcilePrompt` in
`src/prompts.ts`, where `exampleDecisions` is built from only
`findings[0].findingId`; the corresponding generated-prompt test in
`test/prompts.test.ts`.

**Reachable case:** A panel produces two or more canonical findings. The prompt
says the decisions list has exactly one entry per finding but advertises a JSON
array containing only the first finding ID. A copied array is refused for every
omitted canonical ID.

**Why it matters:** Hazard 3 requires every advertised example value to
validate against the receiving schema. The current regression uses one finding
and only checks that the extracted ID equals that finding, so it cannot detect
an incomplete multi-finding array.

**Required correction:** Either render one structural entry for every canonical
finding ID or separate the complete round-specific ID list from a clearly
non-instance schema description. Exercise a round with at least two finding IDs
and validate the complete advertised payload, not only its first number.

### 4 — medium — the prompt omits conditional-field prohibitions

**Where:** `reconciliationDecisionContract` in `src/prompts.ts`.

**Reachable case:** A model returns an unused conditional field, including as
`null`: `grounding` on `addressed`, `normativeChanges` on a rejection or
upstream decision, or `proposal` on a non-upstream decision. Deterministic code
treats the member as present and refuses the reconciliation.

**Why it matters:** The validator enforces that each conditional field is
absent outside its allowed dispositions. The prompt explicitly states the
absence rule only for `cannot_determine`; saying what a disposition must also
supply does not state what every other disposition must omit. This is the
paid-invocation failure mode in hazard 3, and the source-scan comment currently
claims a constraint the generated prompt does not contain.

**Required correction:** State an explicit allowed/forbidden field matrix, or
an equivalent omit rule, for every disposition. Pin those rules in each
generated reconciliation prompt and break-test each prohibition independently.

## Verification performed

- `npm run typecheck`: passed.
- Focused reconciliation, prompt, agent, specification-stage, and plan-stage
  tests: 140 passed, 0 failed, 0 skipped.
- `npm run check:docs`: exit 0, `doc-check: clean`; the reported historical path
  warnings were not treated as errors or edited away.
- `git diff --check`: no whitespace errors in the reviewed diff.
- `npm test`: not claimed as verified. Two full-suite attempts produced no test
  failure before being stopped, but neither reached the final test summary
  within the review window.

No implementation file was changed by this review. This record remains open
until every finding has a recorded disposition; only then should its status be
changed to `reconciled`.

---

## Reconciliation

**Date:** 2026-09-02
**Disposition:** 4 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — mixed classifications cannot reach one canonical decision:**
  operator decision. The accepted `(round, intentKey, location)` canonical
  identity is kept, and deduplication requires the same location — so a
  mixed-classification pair is two canonical findings with two decisions,
  both reports reaching the same reconciliation dispatch unfused. The
  one-canonical-two-mixed-report row is unreachable through the production
  report contract and must not be hand-constructed in Task 7 (hazard 4).
  `ARCHITECTURE.md` section 13, the plan's Task 6 step 10, assumption 46,
  Task 7 step 3, and the Task 6 completion record were amended to state it;
  Task 7 proves instead: same intent and location with differing severity →
  one finding, two immutable reports; mixed classifications → two findings,
  two decisions; no stored value combines fields from different reports.
- **Accepted — unknown reconciliation fields are accepted and discarded:**
  `unknownMember` in `src/reconciliation.ts` now refuses an unknown member by
  name at every model-returned level — reports, decisions, grounding, nested
  grounding, normative-change entries, and proposals — with `impact`
  special-cased so it still reaches its derived-from-disposition refusal. A
  regression test exercises every level, including nested `impact`.
- **Accepted — the advertised decisions array is incomplete for real rounds:**
  `exampleDecisionsFor` renders one structural entry per canonical finding id
  and an empty array when the round has none, so a copied array validates.
  The generated-prompt test now runs a two-finding round and asserts the
  complete advertised id list on both prompts.
- **Accepted — the prompt omits conditional-field prohibitions:** the
  contract now states the allowed/forbidden matrix — `grounding` only on
  `rejected_with_rationale`, `normativeChanges` only on `addressed`,
  `proposal` only on `upstream_follow_up` and `upstream_blocking`, and no
  field a disposition does not list. Pinned by the source scan and in both
  generated-prompt tests.

Each of the three mechanical fixes was proven by reintroduction in a scratch
mirror: the guard loosened, the mapped test failed, the restore hashed
byte-identical to the working tree.
