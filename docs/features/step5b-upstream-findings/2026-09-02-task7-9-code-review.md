# Step 5b Tasks 7-9 — code review

**Status:** reconciled

**Reviewed document:** `docs/features/step5b-upstream-findings/plan.md`, Tasks
7 through 9, together with the accepted Task 6 decisions recorded in
`docs/features/step5b-upstream-findings/2026-09-02-task6-code-review-2.md`.

**Review date:** 2026-09-02

**Effort:** high. Independent review of the complete working-tree tranche,
including the three new source/schema files and the unchanged contracts that
the new orchestration calls.

**Hazards considered:** 1 (finding 3 traces a schema-valid reconciliation
through content conversion and the stage boundary, where a retained
`cannot_determine` decision is currently discarded), 2 (finding 1 manufactures
the wrong immutable reviewer evidence during migration, and finding 4 leaves
proposal creation without the queryable audit record the plan requires), 4
(the migration, proposal-identity, audit, and store tests all choose cases that
agree with the implementation while missing the discriminating cases in
findings 1, 4, 5, and 6), 5 (both completion paths and their decision gates were
traced; no path that falsely completes without decisions was found, although
finding 3 blocks before retaining the decision the gate should see), 7 (the
legacy closure redispatch is gone and each configured round varies by running a
new panel/reconciliation cycle), 12 (both stages read their round counts from
the frozen profile; no live-configuration divergence was found), 13 (finding 3
concerns the required conversion of an ungrounded normative claim to
`cannot_determine`, rather than allowing an invented obligation), and 15 (the
proposal path was checked against the existing read-only subprocess boundary;
this tranche adds persistence and human export, not a new proposal
subprocess). Hazard 3 and 14 bear on the unchanged Task 6 prompt and reviewer
independence contracts, which were traced without a new fault. Hazards 6, 8, 9,
10, and 11 are not newly exercised: these changes add no later-stage coverage
promise, executable resolution, setup hook, model-alias comparison, or default
staffing rule.

**Scope reviewed:** `git diff HEAD` across `ARCHITECTURE.md`,
`docs/features/step5b-upstream-findings/plan.md`, `docs/proposals/README.md`,
`scripts/doc-check.mjs`, `src/cli.ts`, `src/finding.ts`, `src/paths.ts`,
`src/plan-gate.ts`, `src/plan-stage.ts`, `src/policy.ts`, `src/spec-stage.ts`,
`src/store.ts`, `test/cli.test.ts`, `test/migrate.test.ts`,
`test/plan-gate.test.ts`, `test/plan-stage.test.ts`, `test/policy.test.ts`,
`test/profile.test.ts`, `test/schema.test.ts`, `test/spec-stage.test.ts`, and
`test/store.test.ts`; the untracked
`src/migrations/005_finding_report_decision.sql`,
`src/migrations/006_proposal.sql`, and `src/proposal.ts` were read explicitly.
The unchanged `src/reconciliation.ts`, `test/reconciliation.test.ts`, and
`test/audit.test.ts` were also traced because they define the conversion and
audit contracts this tranche relies on. The personal untracked
`.claude/settings.local.json` file was not reviewed.

## Summary

Combining Tasks 7-9 was the right resolution to Task 7's original scope gap:
the new schema is activated by the same atomic change that removes the legacy
severity loop, so no temporary compatibility adapter or second finding schema
is introduced. The round counts now come from the frozen profile, reviewer
reports remain separate from canonical findings, and upstream decisions reach
durable proposal storage.

Six actionable findings remain: one high-severity migration defect and five
medium-severity contract or hardening gaps. The migration must be corrected
before it is applied to any retained Task 6 database. The tranche should not be
described as complete until every finding below has a recorded disposition.

No new entry in `docs/hazards.md` is recommended from this review. The evidence
and fixture failures are instances of hazards 2 and 4; the whitespace issue is
already covered by the current project learning that a tolerance applied at
one boundary but not its sibling is a defect. The exclusive-create correction
in finding 2 enforces Task 8's existing non-overwrite promise at the
consequential write boundary; it does not establish a new architecture or
hazard class.

## Findings

### 1 — high — migration manufactures `current_artifact` evidence for legacy upstream reports

**Disposition:** accepted.

**Where:** `src/migrations/005_finding_report_decision.sql`, the
`INSERT INTO finding_report` at lines 49-52; the migration fixture in
`test/migrate.test.ts`.

**Reachable case:** A database on migrations 1-4 contains a Task 6 reviewer
finding whose validated classification was `upstream`. The old fused table did
not retain a classification column, but it did retain the classification-bound
location token, such as `upstream:design:<decision-key>` or
`upstream:specification:<decision-key>`.

**Why it matters:** The migration assigns the literal `current_artifact` to
every copied report. That creates an immutable report pairing the reviewer's
severity and subject with a classification the reviewer did not return,
contradicting architecture sections 8, 13, and 15 and Task 7's no-fusion
contract. The loss is durable once the legacy table is dropped. The existing
migration test seeds only a current-artifact heading, so it cannot distinguish
the literal from a correct mapping.

**Required correction:** Derive the migrated classification from the accepted
location contract—for example, treat the two exact upstream prefixes as
`upstream` and other legacy locations as `current_artifact`—or explicitly
refuse a row that cannot be classified without invention. Add a prior-schema
fixture containing an upstream location and assert its migrated report retains
`upstream` before the legacy table is dropped.

### 2 — medium — proposal export's check-then-write sequence can overwrite a newly created file

**Disposition:** accepted.

**Where:** `src/cli.ts`, the `existsSync(targetPath)` preflight at line 577 and
the default-mode `writeFileSync(targetPath, body)` at line 599; the static
existing-file case in `test/cli.test.ts`.

**Reachable case:** Another process, editor, or link creation places the target
between the preflight check and the write. `writeFileSync` opens with truncating
mode by default, so the command overwrites the new target despite promising to
refuse any existing proposal file.

**Why it matters:** The two calls do not form one filesystem decision. The
window is narrow, but the consequence is destructive and the command's stated
operator contract is absolute. A test that creates the file before the command
starts proves only the preflight branch.

**Required correction:** Make the write itself exclusive, such as with
`flag: "wx"`, translate `EEXIST` to the existing refusal, and append the export
audit event only after that exclusive write succeeds. Exercise the write-time
collision rather than only the pre-existing-file branch.

### 3 — medium — converted `cannot_determine` decisions are discarded before persistence and gating

**Disposition:** accepted.

**Where:** `src/spec-stage.ts` at the
`reconciliation.value.unclaimedNodes.length` abort near line 571 and the
parallel branch in `src/plan-stage.ts` near line 700; the conversion behavior in
`src/reconciliation.ts` and its regression "a claim with unmatched grounding
converts and its node surfaces as unclaimed".

**Reachable case:** An `addressed` decision claims a genuinely added normative
node but cites grounding text absent from the governing input. The validator
correctly converts that decision to `cannot_determine`, removes its invalid
conditional content, records the conversion, and returns the released node in
`unclaimedNodes`.

**Why it matters:** Both stages treat every non-empty `unclaimedNodes` result as
having no owning decision and abort before writing the reconciled artifact,
the converted decision, or its reconciliation audit record. That premise is
false for the existing conversion case: the finding is known and the retained
typed answer is `cannot_determine`. Task 9 and architecture section 12 require
that answer to be retained and then block at the deterministic gate, naming the
canonical finding. The current path blocks, but it discards the structured
reason and reports only the released prose node.

**Required correction:** Distinguish a node introduced with no decision claim
from a node released by conversion. Preserve converted decisions and let their
`cannot_determine` disposition reach storage and the gate; reserve the early
unclaimed-node refusal for additions with no owning decision. Add both spec and
plan stage regressions that start from the validator's existing unmatched-
grounding case and assert the stored decision, conversion audit evidence, and
named gate block.

### 4 — medium — proposal creation has no audit event and reconciliation events omit required routing fields

**Disposition:** accepted.

**Where:** Proposal persistence in `src/spec-stage.ts` around lines 615-637 and
`src/plan-stage.ts` around lines 737-759; the later
`spec.reconcile.record`/`plan.reconcile.record` summaries; the absence of a
proposal-creation action in the stage tests and `test/audit.test.ts`.

**Reachable case:** Either stage receives `upstream_follow_up` or
`upstream_blocking`, writes evidence, inserts or links a proposal, and records
only the generic reconciliation event. The only `proposal.*` action in
production is the later human `proposal.export` event.

**Why it matters:** Task 8 explicitly requires proposal and reconciliation
audit events with ids, route, artifact hashes, risk, and outcome so a later
query can find upstream blocks without interpreting prose. The reconciliation
summary carries finding/proposal ids and hashes, but omits route, risk, and an
explicit outcome; no distinct event records creation versus deduplication and
linking. A valid hash chain proves only that the events present were not
altered—it cannot prove a required event was emitted.

**Required correction:** Define and emit a proposal persistence action for
create/link outcomes, with proposal id, finding id, derived route, artifact
hashes, frozen risk, and outcome. Bring the reconciliation event to the same
field contract, and add stage-level assertions for both routes plus the dedup
link case. Keep `test/audit.test.ts` focused on the generic chain contract.

### 5 — medium — proposal identity does not implement its documented whitespace normalization

**Disposition:** accepted.

**Where:** `proposalIdentity` in `src/proposal.ts`, lines 40-48.

**Reachable case:** The same proposal is restated across configured rounds with
formatting-only changes inside its title or problem—for example, `"Missing
policy"` versus `"Missing  policy"`, or `"one two"` versus `"one\ntwo"`.

**Why it matters:** The function comment promises that whitespace-only and CRLF
differences produce one deterministic identity, but `normalizeText(...).trim()`
normalizes line endings and edge whitespace only. A direct probe returned
different hashes for the examples above. The store therefore creates duplicate
proposal rows for a case the identity contract says should deduplicate, while
the current test covers only byte-identical content.

**Required correction:** Canonicalize internal whitespace consistently for the
identity inputs, using the same collapse-and-trim tolerance already established
for model-restated prose, and add spaces/newlines/CRLF variants to the identity
and store dedup tests. Preserve `route` in the identity so an escalation remains
a distinct proposal as the plan requires.

### 6 — medium — the authoritative store accepts decision shapes the owning validator forbids

**Disposition:** accepted.

**Where:** `DecisionGrounding`/`FindingDecisionInput` in `src/store.ts` around
lines 166-185 and `insertFindingDecision` around lines 546-574.

**Reachable case:** An internal caller supplies an allowed disposition with an
invalid grounding source, or supplies conditional fields on a disposition that
forbids them—for example, `addressed` with a rejection grounding object or
`cannot_determine` with normative changes. The method checks only the
disposition vocabulary and inserts the remaining values unchanged.

**Why it matters:** The current stages call the store with decisions already
validated by `validateReconciliation`, so the ordinary path is safe today.
The exported storage method and authoritative database do not preserve that
invariant themselves, however, and the migration has no constraint capable of
rejecting these combinations. Task 7 explicitly requires conditional-field
vocabularies to be validated before SQL using the owning module, so the store's
own public boundary is weaker than its plan and types claim.

**Required correction:** Import the owning disposition and source types or
constants, validate the disposition/conditional-field matrix before preparing
SQL, and reject invalid sources and forbidden/present combinations by name.
Add direct store regressions that prove each refusal occurs before SQLite; keep
the schema constraints as a second line for the scalar vocabularies they can
express.

## Verification performed

- Focused Tasks 7-9 tests: 209 passed, 0 failed, 0 skipped across
  `test/store.test.ts`, `test/schema.test.ts`, `test/migrate.test.ts`,
  `test/cli.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`,
  `test/plan-gate.test.ts`, and `test/audit.test.ts`.
- `npm run typecheck`: passed.
- `npm run check:docs`: passed after this record was saved, with 36
  pre-existing historical path warnings and none introduced here.
- `git diff --check`: passed.
- A direct `proposalIdentity` probe confirmed that internal spaces versus a
  newline produce different identities.
- `npm test`: not independently verified. The attempted full run emitted no
  failure but stopped making progress and was interrupted before a final
  summary, so this review does not adopt the implementation note's 618-test
  claim as its own evidence.

No implementation file was changed by this review. This record remains open
until every finding has a recorded disposition; only then should its status be
changed to `reconciled`.

---

## Reconciliation

**Date:** 2026-09-02
**Disposition:** 6 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

Every finding was independently verified against the code before it was
accepted — none were taken on the review's word. Findings 1, 2, and 3 were
then proven by breaking the fix and watching the named test fail, because a
regression that passes on first write has only shown that the reading matched
the code.

### Verdicts

- **Accepted — the migration manufactured `current_artifact` for legacy
  upstream reports:** verified reachable, not theoretical. The legacy
  `src/spec-stage.ts` at `f094c0f` already validated reports through
  `validateReviewerReports` with `upstreamPrefixFor("design")` and stored
  `report.location` verbatim, so a database on migrations 1-4 can hold a row
  whose location carries an upstream prefix. `005_finding_report_decision.sql`
  now derives the classification from that location — the two exact prefixes
  map to `upstream`, everything else to `current_artifact` — and
  `test/migrate.test.ts` seeds an `upstream:design:` row whose migrated report
  must read back `upstream`, with the expected prefix taken from
  `upstreamPrefixFor("design")` rather than a literal typed into the test.
  Break-it: restoring the literal fails that assertion by name. The migration
  file is edited rather than superseded because it is untracked and unapplied
  — the "never edit an existing migration" rule protects migrations that have
  run somewhere, and this one has only ever run against test temp directories.
- **Accepted — proposal export's check-then-write could overwrite:** the
  `existsSync` preflight is removed and `src/cli.ts` now writes with
  `flag: "wx"`, translating `EEXIST` into the same refusal message and exit
  code. The refusal is now the write's own outcome, so there is one filesystem
  decision and no window; the audit event already followed the write and still
  does. Break-it: with a default truncating write, the existing test's
  "the pre-existing file must be untouched" assertion fails.
- **Accepted — converted `cannot_determine` decisions were discarded before
  persistence and gating:** this corrects a design decision made earlier in
  implementation, and the reviewer's reading of `src/reconciliation.ts` is the
  correct one. Its accounting loop states plainly that "a converted decision
  drops its entries, so its nodes surface as unclaimed", which means a
  non-empty `unclaimedNodes` has two distinct causes: a node released by a
  conversion, whose owning decision survives as `cannot_determine`, and a node
  nothing owns at all. Both stages aborted on the union of the two, discarding
  the typed answer, the conversion record, and the finding id in the first
  case. Both now abort only when `conversions.length === 0` — no owning
  decision exists to block on — and otherwise persist every decision and let
  the gate block by name over all rounds. Fail-closed is preserved either way:
  a conversion always yields a `cannot_determine` the gate blocks on. New spec
  and plan regressions start from an `addressed` decision whose grounding
  excerpt is absent from the governing input and assert the stored decision,
  its recorded conversion reason, the `->cannot_determine` and `unclaimed=1`
  audit evidence, and the named gate block. Break-it: restoring the
  unconditional abort fails both with "the converted decision must be
  persisted, not discarded with the round".
- **Accepted — proposal creation had no audit event and reconciliation events
  omitted routing fields:** confirmed that the only `proposal.*` action in
  `src/` was the human `proposal.export`. Both stages now emit
  `spec.proposal.record` / `plan.proposal.record` per persisted candidate,
  carrying proposal id, created-versus-linked outcome, finding id, derived
  route, frozen risk, both artifact hashes, and the evidence ref; the
  reconciliation summary gained `risk=` and its `proposals=` field now names
  the route and outcome per entry. Stage-level assertions cover both routes
  and the dedup-link case in each stage. One deviation from the review's
  wording: the event is emitted immediately *after* the upsert rather than
  before any write, because the proposal id it must carry does not exist until
  the row does. Task 8's "block rather than advance if the evidence write
  fails" half already holds through the stage's terminal catch.
- **Accepted — proposal identity did not implement its documented whitespace
  normalization:** reproduced with a direct probe before changing anything —
  `"Missing policy"` versus `"Missing  policy"`, and a space versus a newline,
  hashed differently while the doc comment promised one identity.
  `normalizeText` folds only BOM and CRLF. `proposalIdentity` now uses
  `collapseWhitespace`, the same tolerance the grounding match already applies
  to model-restated prose. Re-probed after the fix: whitespace variants agree,
  while route, stage, and real content differences still produce distinct
  identities, so the key did not become degenerate.
- **Accepted — the store accepted decision shapes the owning validator
  forbids:** `insertFindingDecision` validated only the disposition.
  `src/reconciliation.ts` now exports `UPSTREAM_SOURCES` as a runtime array
  (with `UpstreamSource` derived from it, so there is still one vocabulary),
  and the store validates the full conditional matrix before SQL: grounding
  exactly on `rejected_with_rationale`, `normativeChanges` exactly on
  `addressed`, and every grounding source — including the one nested in each
  normative change — drawn from the governing vocabulary. A CHECK constraint
  cannot express these cross-column rules, which is why they live at the
  method boundary. Fixing this exposed the hazard-4 case the review predicted:
  `test/store.test.ts`'s `decisionInput` helper defaulted `addressed` with
  `normativeChanges: null`, a combination no reconciliation can return, and
  two tests were asserting against it. The helper now derives the conditional
  shape from the disposition, so no fixture in that file can describe an
  unreachable state.

### Verification after reconciliation

- `npm run typecheck`: passed.
- `npm test`: 625 tests, 624 passed, 0 failed, 1 skipped. The skip is the
  pre-existing Windows-Developer-Mode symlink test, unrelated to this tranche.
  This closes the review's open item: the full suite now runs to a summary.
- `npm run check:docs`: `doc-check: clean`, with the same 36 pre-existing
  historical path warnings and none introduced here.
- Break-and-restore evidence recorded above for findings 1, 2, and 3; findings
  5 and 6 are covered by direct probes and new refusal regressions.

No new `docs/hazards.md` entry was added, matching the review's own
recommendation. Task 10 still owns the hazards, architecture-narrative, and
README alignment, and Task 11 still owns the full break-and-restore sweep;
neither was started here.
