# Step 5b Upstream-Finding Routing Plan — review

**Reviewed document:** `plan.md`
**Document type:** Plan
**Review date:** 2026-08-31

**Hazards considered:** 1 (the new reviewer field reaches the same `extractJsonBody` + `validateAgentResult` path; the plan's fail-closed validation is right, and critical issue 2 is where a hand-reasoned merge rule replaces model output with a classification no model returned), 3 (the plan states the enum belongs in both reviewer prompts, but high-risk issue 1 is a second constrained field — `location` — whose meaning changes for upstream findings and which no prompt restates), 4 (critical issue 1 is this entry exactly: a two-insert conflict test passes by coincidence on a store call that returns the wrong row, and critical issue 3 is a guard that survives its own removal), 7 (the plan's premise — a redispatch aimed at the wrong artifact varies nothing that matters — holds; the inverse cost, a terminal block on a repairable run, is unweighed and is critical issue 2), 13 (the no-invention rule is correctly placed in the prompt and correctly excluded from the merge; the deterministic merge is where an obligation gets minted instead). Entries 2, 5, 6, 8, 9, 10, 11, 12, 14, and 15 do not bear on this plan for the reasons `plan.md` states, and I confirmed no finding below reaches raw-output retention, delivery, shell invocation, setup, model selection, executor restriction, frozen profiles, independence, or the read-only boundary.

---

## Summary

A well-grounded corrective plan implementing an obligation `ARCHITECTURE.md` section 13 already states in prose. Its source citations, blast radius, and migration strategy hold up against the shipped code with two exceptions, and three defects would ship silently as written: a store call that returns the wrong row on exactly the conflict path this plan makes load-bearing, a merge rule that terminates repairable runs, and a table rebuild that voids the schema guards protecting the rebuilt table.

## Verdict

**Ready for planning after required changes.** The three critical issues are all in Task 1 — the schema and store foundation every later task depends on — and two of them are invisible to the plan's own verification gates. Fix them in the document before implementation begins; the high-risk items can be resolved during Task 2 and Task 4.

## Critical issues — must fix before implementation

**Issue: `insertFinding` returns the wrong row on the conflict path, and Task 1's merge tests are written against that return value**

- **Why it matters:** `src/store.ts:389` returns `this.getFinding(Number(result.lastInsertRowid))!`. SQLite does not update `last_insert_rowid()` for an `ON CONFLICT ... DO UPDATE`, so the call returns whichever row the previous successful `INSERT` created. I confirmed this against `node:sqlite` directly: after inserting findings 1 and 2 and then re-reporting finding 1's identity, `lastInsertRowid` is 2 and `insertFinding` returns finding 2 — a different, unrelated finding. Both stages currently discard the return value, so nothing breaks today.
- **Where:** Task 1, step 1 ("prove one id survives, `upstream` dominates, severity is the higher report when upstream is involved") and step 3 ("In `ON CONFLICT`, encode the conservative merge directly").
- **Production impact:** The conservative merge is the plan's entire defence against panel-order dependence, and Task 1 makes its stored result the input to a terminal run block. A store test that inserts two conflicting reports as its only two statements passes by coincidence — `lastInsertRowid` happens to still be the right row — while the three-insert case returns a different finding's severity and target. That is hazard 4's failure shape: the test and the code agree while both are wrong, and the guard protecting a terminal decision is the one that never fails.
- **Recommended fix:** Add a Task 1 step that fixes `insertFinding` to return the merged row by identity rather than by `lastInsertRowid` — re-select on `(stage_id, intent_key, location)`, or add `RETURNING id` to the upsert. State in the plan that every merge assertion reads the row back through `getFindings(stageId)`, not through `insertFinding`'s return value, and add a break-it entry: make the upsert return the wrong row and confirm a named merge test fails.

**Issue: the conservative merge manufactures a terminal block that no reviewer reported**

- **Why it matters:** The two halves of the rule compose in a way the plan does not trace. Reviewer A reports concern X as `current_artifact`/`critical` — a plan defect the author can fix. Reviewer B reports the same identity as `upstream`/`low` — a minor note about the spec. "`upstream` dominates" plus "when either duplicate report is upstream the stored severity is the higher of the two" merges these into `upstream`/`critical`, which is open and material, so the run blocks terminally in round 1 with zero remediation rounds spent. Neither reviewer reported a material upstream finding.
- **Where:** Assumptions, third bullet; Task 1, step 3.
- **Production impact:** The most expensive outcome in the system — a terminal block requiring a human design change, a fresh run, and a new Ed25519 approval signature — is reachable from one reviewer's low-severity aside. The plan weighs hazard 7 (a redispatch that cannot repair the artifact) and does not weigh its inverse: terminating a run the operator paid to approve, when a reviewer judged the concern repairable in place. "Conservative" is doing two opposite jobs in one sentence.
- **Recommended fix:** Decide which failure the merge is conservative about and say so. The rule that matches the plan's stated goal is to evaluate materiality per report, not on the merged row: block only when at least one individual report is itself both `upstream` and at or above `MATERIAL_THRESHOLD`. Keep `upstream` dominant for the stored routing fact, and keep severity at the later report's value as the shipped upsert does. If the ratchet stays instead, state the trade explicitly and add the reversed-composition case — `current_artifact`/`critical` against `upstream`/`low` — to Task 4's dedup regression, because that is the case the current wording turns terminal.

**Issue: migration 005's table rebuild voids the constraint guards on the table it rebuilds**

- **Why it matters:** `test/schema.test.ts:102-120` and `scripts/doc-check.mjs:328-334` both assert constraints with `sql.includes(...)` against every migration file concatenated. `src/migrations/003_finding.sql` keeps that text forever. Once 005 recreates `finding`, `CHECK (severity IN (...))`, `CHECK (disposition IN (...))`, and `UNIQUE (stage_id, intent_key, location)` all still match against 003's now-dead table, so the rebuilt table can omit any of them and every gate stays green. The identity constraint is the one the whole dedup and merge design rests on.
- **Where:** Known blockers and constraints, third bullet ("Migration 005 must recreate the final table as `finding` so the existing last-definition-wins derivation sees the final schema"); Task 1, steps 4 and 5.
- **Production impact:** The plan's claim that "`test/migrate.test.ts`, `test/schema.test.ts`, and `scripts/doc-check.mjs` are the three independent schema consumers that must agree" stops being true for the finding table at the moment 005 lands. A rebuild that drops the unique index makes every reviewer report a new row, dedup silently stops working, and no test, checker, or typecheck notices. The column derivation is fine — I confirmed last-definition-wins gives 005's shape — but constraints are checked by whole-text search, not by table.
- **Recommended fix:** In Task 1 step 5, scope the finding constraint assertions to the table body, using the pattern already in the file: `test/schema.test.ts:98` does `migrationTables(sql).get("stage")!.includes("UNIQUE (run_id, ordinal)")`. Apply the same scoping in `doc-check.mjs` so `PINNED_CONSTRAINTS` for `finding` resolve against the last `CREATE TABLE finding` body. Add a break-it entry to Task 6: drop the `UNIQUE (stage_id, intent_key, location)` from 005 and confirm a named schema test fails.

## High-risk areas

**Risk: `location` has no defined meaning for an upstream finding, and dedup depends on it**

- **Why:** Both reviewer prompts constrain `location` to the artifact under review — `src/prompts.ts:64` says "a section heading or artifact path from the spec", `src/prompts.ts:170` says "from the plan". An upstream finding says the specification is silent about something, so there is no plan heading that names it. Two reviewers describing the same omission pick different plan sections, produce different identities, and the conservative merge never runs at all.
- **Impact if ignored:** The merge rule the plan builds to make routing panel-order-independent is bypassed for the exact finding class it exists to protect, and hazard 3 is violated: a constrained field whose accepted meaning changed is requested without stating the change, and `location` feeds identity, so it cannot be repaired downstream.
- **Mitigation:** Decide in Task 2 whether an upstream finding's `location` names the upstream document's section or the reviewed artifact's, state that rule in both reviewer prompts beside the enum, and add it to the generated-prompt assertions and the hazard-3 source scan alongside `repairTarget`.

**Risk: the prescribed remedy overwrites the blocked run's own evidence**

- **Why:** `writePlanDoc` writes unconditionally to `docs/features/<slug>/plan.md` (`src/plan-doc.ts:175-177`) and `writeSpecDoc` to `spec.md` (`src/spec-doc.ts:96-98`). `bw new-run` has no same-slug guard. A fresh run on the same feature therefore overwrites both files while the blocked run's `stage.output_ref` still names those paths.
- **Impact if ignored:** The assumption "the original approved run remains immutable evidence" holds for database rows and retained raw output but not for the artifacts the stage rows point at, and Task 4's assertion that "the original plan remains the stage artifact" is true only until the operator follows the plan's own instruction. The blocked run becomes undiagnosable in the way hazard 2 describes.
- **Mitigation:** Record `planHash=` (and `specHash=` for the spec analogue) in the upstream audit event, exactly as `plan.gate.pass` already records it at `src/plan-stage.ts:433`, so the evidence is self-contained regardless of what later overwrites the file. State in Task 4 whether the operator's fresh run uses a new slug, and say which of the two the terminal reason instructs.

**Risk: the severity comparison in `ON CONFLICT` duplicates `SEVERITY_ORDER` into SQL**

- **Why:** SQLite has no ordering over the severity strings, so "retain the greater severity" in `ON CONFLICT` requires a `CASE` expression ranking `low`/`medium`/`high`/`critical` inside the migration. `src/store.ts:133-135` states the opposite rule in a comment: "finding.ts owns the finding enums; the store imports them so the validation and the migration CHECK cannot drift apart."
- **Impact if ignored:** A fourth copy of the severity ordering lands in immutable migration history, where it cannot be imported from `src/finding.ts` and cannot be changed. Adding a severity level later leaves the merge ranking silently stale.
- **Mitigation:** Either merge in TypeScript inside `insertFinding` — read the existing row by identity, compute with the imported `SEVERITY_ORDER`, write — which the single-writer lock in `src/lock.ts` already makes safe, or drop the severity ratchet per critical issue 2 and keep the shipped later-report semantics, which needs no ordering in SQL at all.

## Medium and low concerns

- Task 4's spec-review analogue and its reversed-order dedup regression need a panel of at least two reviewers, but `PANEL_SIZE.low` is 1 and `runSpecStage` has no `selectPanel` seam — `runPlanStage` has one, `src/plan-stage.ts:62-64`, and `runSpecStage` takes no `deps` at all. Name the mechanism: a high-risk scratch fixture as `test/spec-stage.test.ts:259` uses, with the fixture keying on the agent id it already extracts.
- The repair target ratchets monotonically for the life of a review stage: identity is `(stage_id, intent_key, location)`, the same review stage spans all three rounds, and "`upstream` dominates" therefore applies across rounds, not only across panel members. A concern classified `upstream` in round 1 can never return to `current_artifact` in round 2. The assumptions discuss panel order only. State the cross-round behaviour or scope the merge to a round.
- Both `checkMigrations` in `scripts/doc-check.mjs` and the column test at `test/schema.test.ts:90` compare column lists with `JSON.stringify`, so order matters. Task 5 says to add `repair_target` to section 15's `finding(...)` line without saying where; name the position and require the migration to match it.
- `finding.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`. Rename, recreate, copy with explicit ids, drop restores the sequence correctly only because nothing in `src/` deletes findings. The plan claims id preservation without naming that dependency; add one line to Task 1 step 4.
- Nothing verifies `ARCHITECTURE.md` section 22's hazard count against the entry count in `docs/hazards.md` — `checkHazards` only inspects `docs/features/` documents. Task 5's "Update section 22's count and summary" is unenforced by the gate Task 5 runs.
- The blast radius describes `src/plan-gate.ts` as the module that "only decides whether open material findings remain". It also owns `coverageFitsScope` and `coverageMeetsCriteria`, and `specReviewGate` is not in a gate module at all — it lives at `src/spec-stage.ts:26`. Correct both, since Task 4 edits that file.
- The repository's fixture-variant pattern is a scratch `.mjs` written into the test's temp root, not a mode inside the committed fixture — `test/spec-stage.test.ts` does this seven times. Task 2 step 5's "Add fixture modes" and the Files line "Modify: both harness fixtures" describe a different mechanism; only the shared fixture's `repairTarget` field is a real edit to those files.
- Task 1 step 2 needs a version-4 database, but `applyMigrations` applies every file in the directory it is given. Name the mechanism — a scratch migrations directory holding 001 through 004, applied, then 005 copied in and reapplied — so the implementer does not invent one.
- The plan cites `.claude/sessions/project-learnings.md` for "a reviewer already caught a plan inventing an obligation and forced its removal". I could not locate that record in the file; the other two claims from that citation (steps 1-7 shipped, the plan smoke's six dispatches and three rounds) both resolve. Either cite the document that carries it or drop the clause.

## Missing and underspecified areas

- **What the operator can actually change.** Task 4's reason text says "clarify the upstream design/specification". At `plan_review` the specification is unchangeable in place: `src/plan-stage.ts:183` refuses a spec whose hash moved since the gate, and the approval signature binds `spec_hash`. The only editable upstream artifact is `docs/features/<slug>/design.md`. Specify the exact wording so the reason does not send an operator to edit a file the next run will reject.
- **Whether the incident behind this plan is recorded anywhere.** The goal names a "reported later-round plan-review defect" and the hazards line calls it "the reported later-round failure", but no run record, proposal, or session entry in the repository describes it. `CLAUDE.md` defines `docs/hazards.md` as failures that have actually occurred. Either cite the record, or state plainly that hazard 16 is a class hazard derived from section 13's existing rule rather than an observed one — the rest of the plan stands either way, since section 13 already mandates the routing.
- **The existing approval's disposition on an upstream block.** The run blocks with a valid signed approval bound to a spec hash that a fresh run will not reproduce. Nothing needs to change, but say so, so the implementer does not add a mutation the plan forbids elsewhere.
- **Which enum value a spec reviewer's `current_artifact` means at `spec_review`.** The assumption says "in spec review, it means the specification", and the spec reviewer's upstream is `design.md`, which `src/spec-stage.ts:120` reads. State that in the spec reviewer prompt in Task 2 step 2, since the reviewer never sees `design.md` and must be told what it is being asked to exclude.

## Suggested improvements

- Have the upstream audit event carry the same machine-readable shape the gate events use — `upstreamIds=…; planHash=…; risk=…` — so a later query can find every upstream block without parsing prose, the way `src/plan-stage.ts:169-185` already reads `spec.gate.pass` back.
- Add a `finding` count assertion to Task 4's dedup regression. Proving the merged row is `upstream` at the greater severity does not prove a second row was not created; `SELECT count(*)` proves both halves of "one finding survives".
- Consider adding a `hazards` check to `scripts/doc-check.mjs` that compares the number of `^## \d+\.` headings in `docs/hazards.md` against the count word in section 22. It is a few lines, and it makes Task 5's third step enforced rather than remembered.

---

## Reconciliation

**Date:** 2026-08-31

**Disposition:** 22 accepted, 0 rejected, 0 deferred, 0 open

**Status:** reconciled

This review is reconciled together with `2026-08-31-plan-review-2.md`, which
supersedes the reviewed plan's design direction. Every finding below is
accepted; three are resolved by a different mechanism than the one recommended,
because the terminal-block design they were written against no longer exists.
`plan.md` is rewritten in place to the author-led flow and carries
`Status: Reconciled` on the operator's instruction. It advances to
`Implemented` when Task 13's gate and independent review are clean.

### Verdicts

- **Accepted — `insertFinding` returns the wrong row on the conflict path:** confirmed at `src/store.ts:389`; Task 7 fixes the return by `RETURNING id` or identity re-select, requires every merge assertion to read back through `getFindings(stageId)` with a row-count check, adds a three-insert regression because the two-insert case passes by coincidence, and Task 11 breaks the fix on purpose.
- **Accepted — the conservative merge manufactures a terminal block no reviewer reported:** resolved by removing cross-report fusion entirely rather than by evaluating materiality per report. No stored value pairs a severity, route, or classification that no reviewer returned; the mixed `critical`/`current_artifact` against `low`/upstream case is a Task 6 preservation test and a Task 11 break target.
- **Accepted — migration 005's rebuild voids the constraint guards on the table it rebuilds:** confirmed at `test/schema.test.ts:102-120` and `scripts/doc-check.mjs:243-334`, both whole-file `sql.includes(...)`. Task 7 scopes the finding constraint assertions to the final table body using the pattern at `test/schema.test.ts:98`, in the test and in the checker, and Task 11 drops a constraint from the rebuilt table to prove the scoped test fails.
- **Accepted — `location` has no defined meaning for an upstream finding:** Task 6 states the rule in both reviewer prompts beside the classification field, names the upstream document's section rather than inventing a local heading, and pins it in the hazard-3 source scan and the generated-prompt assertions.
- **Accepted — the prescribed remedy overwrites the blocked run's own evidence:** Task 6 records before and after artifact hashes on the reconciliation event as `plan.gate.pass` already does at `src/plan-stage.ts:433`, and Task 8 carries the hashes in force on the proposal record. The blast radius now states that a path reference is not evidence and a hash is.
- **Accepted — the severity comparison in `ON CONFLICT` duplicates `SEVERITY_ORDER` into SQL:** resolved by removing the ratchet. Task 7 forbids ranking or combining severity in SQL, because immutable migration text cannot import the ordering.
- **Accepted — the spec-review analogue has no panel seam:** Task 5 adds a `deps.selectPanel` seam to `runSpecStage` mirroring `src/plan-stage.ts:62-67`, so a spec test controls its panel without depending on registry contents.
- **Accepted — the repair target ratchets monotonically across rounds:** superseded with the merge. Findings are immutable and round-scoped, and no classification carries across rounds or panel members.
- **Accepted — column lists are compared with `JSON.stringify`, so order matters:** Tasks 7 and 10 require any schema line added to architecture section 15 to name its exact column position and the migration to match it.
- **Accepted — `finding.id` restoration depends on nothing deleting findings:** Task 7 requires the migration file to state that explicit-id copying restores the `AUTOINCREMENT` sequence correctly only because nothing in `src/` deletes findings.
- **Accepted — nothing verifies section 22's hazard count:** Task 10 adds a hazard-count check to `scripts/doc-check.mjs` comparing the `^## \d+\.` heading count against section 22, making the step enforced rather than remembered. This also closes the third suggested improvement.
- **Accepted — the blast radius misdescribes the gate modules:** corrected. `src/plan-gate.ts` exports `planReviewGate`, `coverageFitsScope`, and `coverageMeetsCriteria`, and `specReviewGate` lives at `src/spec-stage.ts:26`, not in a gate module.
- **Accepted — the fixture-variant pattern is a scratch `.mjs`, not a mode in the committed fixture:** Task 9's files line names scratch fixture variants written into each test's temp root, as `test/spec-stage.test.ts` already does.
- **Accepted — the version-4 database setup mechanism is unnamed:** Task 7 names it — a scratch migrations directory holding the prior versions, applied, then the new file copied in and reapplied, because `applyMigrations` applies every file in the directory it is given.
- **Accepted — the project-learnings citation does not support the invented-obligation claim:** confirmed absent from `.claude/sessions/project-learnings.md` and present in `docs/features/plan-stage/plan.md`'s 2026-08-30 smoke record. The rewritten plan cites that document.
- **Accepted — what the operator can actually change is unspecified:** reframed. The terminal instruction to "clarify the upstream design/specification" is gone; an upstream concern now routes by impact to a stored proposal, and Task 8 defines advance, block, and human-routing behaviour for each value.
- **Accepted — whether the incident behind this plan is recorded anywhere:** the plan now states plainly that hazard 16 is a class hazard derived from section 13's standing rule with one recorded observation, the plan-stage smoke's round-2 invented-requirement catch, and that no full wrong-artifact loop is separately recorded in this repository.
- **Accepted — the existing approval's disposition on a block is unstated:** an assumption states the approval stays untouched as historical evidence, and Task 9 asserts a blocked run keeps its approval and its findings.
- **Accepted — which enum value a spec reviewer's `current_artifact` means:** Task 6 tells the spec reviewer that `current_artifact` means the specification and upstream means the design input it never sees, which `src/spec-stage.ts:120` reads.
- **Accepted — machine-readable upstream audit summary:** broadened. Task 8 gives reconciliation and proposal events ids, route, artifact hashes, risk, and outcome in the shape the gate events already use.
- **Accepted — a `finding` count assertion in the dedup regression:** Task 7 requires the row count as well as the surviving row's values, and Task 8 requires proposal dedup to preserve source finding ids without fusing impact.
- **Accepted — a hazards check in `scripts/doc-check.mjs`:** implemented as described above in Task 10.
