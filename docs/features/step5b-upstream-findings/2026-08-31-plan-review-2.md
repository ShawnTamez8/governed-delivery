# Step 5b Upstream-Finding Routing Plan — review 2

**Reviewed document:** `plan.md`
**Prior review:** `2026-08-31-plan-review.md`
**Document type:** Plan review and reconciliation of the first review after operator design decisions
**Review date:** 2026-08-31

**Hazards considered:** 1 (self-critique, reconciliation, specialist findings, dispositions, and proposal output are all model-returned shapes that must parse fail closed), 2 (a later run can overwrite `spec.md`/`plan.md`, so audit evidence must retain hashes and raw results independently), 3 (specialty-only review, disposition values, upstream impact, and proposal constraints must be stated in every prompt that requests them), 4 (the revised design depends on claims about self-critique and author reconciliation that fixtures alone cannot establish; a bounded prototype and real sample must precede production commitment), 7 (the proposed default removes repeated closure rounds, while configurable rounds must vary through a real panel/reconciliation cycle), 11 (a default installation must be able to staff the configured 2–5-person panel), 12 (round and panel configuration must have one source and be read from the frozen profile rather than described there while live constants decide), 13 (an upstream proposal is a candidate, not an approved requirement or active feature), 14 (the author's self-critique is useful evidence but is not independent review and must never count as a panel seat). Hazards 5, 6, 8, 9, 10, and 15 are not newly exercised by this design: delivery completeness, later-stage promises, shell invocation, setup probes, model identity reporting, and the read-only proposal boundary retain their shipped rules.

---

## Summary

The first plan correctly found the wrong-artifact remediation defect, but its proposed solution is no longer the intended product behavior. The operator has chosen an author-led review flow: the `spec-author` or `plan-author` performs one self-critique, a bounded panel of specialist reviewers reports findings, and that same author reconciles the findings and amends the artifact. Completion no longer means reviewers eventually return an empty list; it means every finding has a retained, typed reconciliation and every deterministic artifact gate passes.

Upstream work also changes from an unconditional terminal route to a BuildWorks proposal outcome. A follow-up proposal is logged and the current run may advance; a blocking dependency creates the proposal and blocks; an indeterminate case routes to a human. This repository's `docs/proposals/` convention is not yet a BuildWorks runtime capability, so proposal generation, validation, evidence, and persistence must be designed rather than assumed.

This direction is behaviorally simpler than the current recursive review loop, but it is a broader correction than `plan.md` describes. The existing plan must be rewritten in place. No second implementation plan and no separate spike document are warranted: the bounded prototype belongs as the first task and evidence gate inside the one `plan.md`.

## Verdict

**Not ready for implementation; ready for in-place plan reconciliation.** Keep this review and the first review as historical evidence, then update `plan.md` as the single current implementation contract. The revised plan must resolve the six required changes below and retain the still-valid implementation findings from review 1.

## Operator decisions this review treats as authoritative

- There is no separate reconciler agent. The author of the artifact is its reconciler: `spec-author` for the specification and `plan-author` for the plan.
- After producing an artifact, the author performs one explicit self-critique/revision pass before independent reviewers see it.
- Independent review defaults to one round and is configurable per reviewed stage. A round uses 2–5 agents selected for distinct specialties; each prompt limits that reviewer to findings within its specialty.
- The author receives the complete panel's findings, reconciles each one, amends the artifact, and the workflow moves on when the reconciliation and deterministic gates permit it. Reviewers are not expected to return zero findings.
- Findings remain evidence. The author may not erase them; it supplies a typed disposition and rationale tied to each finding id.
- An upstream concern becomes a BuildWorks backlog proposal. It must distinguish a nonblocking follow-up from a prerequisite that blocks the current run.
- Reviewer fields are never combined across reports to manufacture a severity/route pair that no reviewer returned.
- Step 5b remains corrective work inside the existing spec/plan review stages. It does not add a numbered runtime stage or renumber delivery check and deliberate stop.

## Required changes before the plan can govern implementation

### 1. Replace the plan's goal and control flow, not just its merge rule

The current goal is “material upstream finding → terminal block before another author dispatch.” Tasks 1–4 build a `repairTarget` merge and route around the existing repeated closure loop. The selected design instead makes an author dispatch the normal reconciliation boundary and changes the loop itself.

The rewritten plan must describe this exact order for both specification and plan:

| Phase | Actor | Required retained output |
|---|---|---|
| Draft | artifact author | validated initial artifact |
| Self-critique | same author definition, separate dispatch | critique plus validated revised artifact |
| Specialist review | complete independent panel | immutable per-reviewer findings, preserving each report's severity and classification together |
| Reconciliation | same author definition, separate dispatch | revised artifact plus one typed decision and rationale per finding id |
| Gate | deterministic code | complete reconciliation, rerun artifact gates, proposal writes/routes, and final pass or block |

The self-critique and reconciliation dispatches are evidence-bearing `agent_run` rows. “Same author” means the same frozen agent definition and author model mapping, not a hidden continuation or an unrecorded prompt.

### 2. Make the authority change explicit in the architecture

`ARCHITECTURE.md` section 13 currently says nothing resolves its own finding: the author may address or dispute, but resolution belongs to the gate or a human. Section 12 requires a closure pass by the panel after governed content changes. The new design intentionally removes the default closure review and gives the author semantic reconciliation authority.

That is not a prompt adjustment. The rewritten plan must amend sections 12 and 13 and state the trade precisely:

- deterministic code decides whether the result is structurally complete and whether mechanical gates pass;
- the author/reconciler supplies the semantic disposition;
- independent reviewers do not confirm the amended artifact by default;
- the audit retains the original finding, the reconciler's decision and rationale, and before/after artifact hashes;
- malformed, missing, or indeterminate dispositions fail closed.

If a high/critical finding may advance as `rejected_with_rationale`, say so explicitly. Otherwise define which disposition blocks. “Reconcile and move on” cannot remain prose because it is the new gate policy.

### 3. Implement actual configuration rather than freezing descriptions of constants

Architecture sections 12 and 20 say panel sizes and remediation rounds are configuration frozen in the run profile. The shipped code still uses `REMEDIATION_ROUNDS = 3` and `PANEL_SIZE = { low: 1, standard: 2, high: 3 }`; `buildPolicy()` records those values, but operators cannot configure them and the stages/selectors import the live constants.

The rewritten plan must define:

- separate `specReviewRounds` and `planReviewRounds`, both defaulting to one;
- a 2–5 panel-size policy, including exact low/standard/high defaults rather than merely the range;
- whether a configured second round means `panel → reconcile → panel → reconcile` (the natural interpretation) and whether self-critique still occurs only once;
- the configuration source, validation bounds, profile shape/hash effect, and behavior of profiles created before the change;
- stage and selector reads from the frozen policy, with no live-constant fallback;
- a configuration-time staffing refusal when the frozen registry cannot seat the required specialties and panel size.

The current registry and tests prove panels of at most three. A five-reviewer maximum requires enough seeded or configured specialists and a default-install test; a configurable value the default installation cannot staff violates hazard 11.

### 4. Make proposal creation a BuildWorks contract

`ARCHITECTURE.md` and `docs/proposals/README.md` describe this repository's backlog convention, but the runtime has no proposal result shape, validator, write path, identity/dedup rule, or link from a proposal to source findings. The plan may not say “add it to backlog” as though that machinery exists.

The revised contract needs at least:

- source run, stage, feature slug, and finding ids;
- title and problem statement;
- why the concern is upstream of the artifact under review;
- `follow_up | blocking_dependency` impact;
- reconciler rationale and the artifact hashes in force;
- a deterministic path/identity rule and behavior when the same proposal is raised again;
- validation that the proposal is nonbinding: it cannot add acceptance criteria to the current feature or become an active `design.md` automatically;
- retained audit/raw evidence before any repository write;
- explicit behavior if rendering or writing the proposal fails.

A `follow_up` proposal may be written and the run may continue. A `blocking_dependency` proposal is written but the current run blocks because filing the missing decision does not make the approved specification implementable. `cannot_determine` blocks for human disposition. Promotion from proposal to active feature remains a human action.

The plan must also decide whether `docs/proposals/` becomes a fixed BuildWorks project convention or is represented by a system-owned backlog artifact and later projection. Do not silently introduce an arbitrary repository write outside the signed/current feature scope.

### 5. Put the prototype inside Task 1 and give it an exit gate

Claims that one author self-critique removes most gaps and that a stronger author can reliably reconcile specialty findings are plausible, but the repository has no measured evidence for this exact flow. The first task in `plan.md` must therefore be a bounded prototype, not production migrations.

That task should use scratch/fixture storage and the real dispatch boundary without modifying production stage order or canonical schema. It must compare at least:

- draft versus self-critiqued artifact findings;
- two specialty findings that agree;
- conflicting findings whose severity and upstream classification differ;
- one nonblocking upstream proposal;
- one blocking upstream dependency;
- malformed or incomplete reconciliation output.

Record dispatch count, cost, duration, parsing success, finding counts before/after self-critique, reconciliation completeness, proposal quality, and whether the reconciler invented an obligation. One bounded real sample is evidence, not a percentage claim; do not encode “70%” as an expectation until measured.

Task 1's exit is a decision recorded directly in `plan.md`: confirm the selected contracts or revise the later tasks before production work begins. This is one evolving implementation plan, not a second plan or `spike.md`.

### 6. Define “the author is smarter” operationally

The recorded plan smoke used the same effective model for author and reviewers. Agent role names and a tweaked prompt do not establish that the reconciler is more capable. The plan must identify the frozen model mappings used for draft, self-critique/reconciliation, and specialist review, and record the effective model per dispatch as already required.

The system cannot objectively prove one model is “smarter.” It can guarantee that the reconciler uses the operator-selected author mapping, a dedicated reconciliation prompt, the complete artifact and per-report evidence, and enough result/context budget. If the design requires a higher model tier than reviewers, configuration must express and validate that policy rather than relying on an undocumented deployment choice.

## Required reconciliation of review 1

Review 1 is not discarded. Its findings resolve as follows:

| Review-1 finding | Review-2 disposition | Required treatment in `plan.md` |
|---|---|---|
| `insertFinding` can return an unrelated row after an upsert | Retained | Fix with `RETURNING` or identity re-select before any new flow relies on the returned row; tests must read canonical stored state and include a third unrelated row. |
| Cross-field conservative merge manufactures `critical/upstream` | Accepted; original design superseded | Remove severity/target fusion. Preserve each reviewer's paired assertion through reconciliation. |
| Migration-005 rebuild can pass stale whole-file constraint checks | Retained if a finding/proposal migration remains | Scope schema and doc-check assertions to the final table body and prove by breaking a final constraint. |
| Upstream `location` has no defined identity meaning | Retained | Define location for upstream reports in both prompts and test the exact constraint. Do not assume artifact-local headings exist for omissions. |
| A fresh run can overwrite artifact paths referenced by the blocked run | Retained | Audit before/after hashes and source finding/proposal ids; do not call path references immutable evidence. |
| SQL severity ordering duplicates `SEVERITY_ORDER` | Superseded with the merge | Do not rank and combine severity in SQL. If any later aggregation is proposed, keep report pairs intact and implement/test it outside immutable migration text. |
| Multi-reviewer spec test lacks a panel seam | Retained | Use an explicitly high-risk scratch case or add a justified frozen-panel seam; do not rely on a low-risk default. |
| Upstream dominance ratchets across rounds | Superseded with the merge, but configurable rounds still need semantics | Keep reports round-scoped and define the full panel/reconciliation cycle for each configured round. |
| Column order, autoincrement restoration, hazard-count enforcement, blast-radius wording, fixture variants, and v4 migration setup are underspecified | Retained where their affected mechanisms survive | Carry each into the rewritten task that owns the mechanism; remove only those made genuinely obsolete by the selected schema. |
| Project-learnings citation does not support the invented-obligation sentence | Retained | Cite `docs/features/plan-stage/plan.md`'s smoke evidence for that statement or remove it. |
| Operator remedy, approval disposition, and spec-review `current_artifact` meaning are unclear | Reframed but retained | Define follow-up/blocking proposal behavior; preserve the original signed approval as historical evidence; tell spec reviewers that `current_artifact` means the spec and upstream means the design/input. |
| Machine-readable upstream audit summary | Accepted and broadened | Reconciliation/proposal events should carry ids, route, artifact hashes, risk, and outcome in a queryable shape. |

## Additional high-risk areas introduced by the new direction

### Specialty-only findings are a prompt contract, not a deterministic fact

The current selector prefers specialties, and prompts describe a lens, but deterministic code cannot prove a semantic finding belongs to that specialty. Agent definitions and prompts must make the boundary explicit; source/generated-prompt tests must pin it; the reconciler may reject an out-of-specialty finding with rationale. The plan must not claim the system enforces semantic expertise it can only request and audit.

### Self-critique must not weaken reviewer independence evidence

The self-critique is an author dispatch and may improve quality, but it is not an independent review. It must use the author role, never occupy a panel slot, and never produce an independence claim associated with reviewer closure. The actual panel remains author-excluding and records its existing independence value.

### “Log and move on” requires complete disposition, not open-row abandonment

The current system already advances with open low/medium findings and blocks on open high/critical findings. The new system should not simply stop consulting disposition. It must retain a final decision for every panel finding and make advancement a named policy. A useful initial vocabulary is:

- `addressed` — the reconciler changed the current artifact and identifies how;
- `rejected_with_rationale` — the reconciler declines the finding and cites existing scope/requirements;
- `upstream_follow_up` — create a nonbinding proposal and continue;
- `upstream_blocking` — create a proposal and block the current run;
- `cannot_determine` — block for a human.

The exact storage representation may separate finding disposition, repair location, and upstream impact rather than compressing them into one enum. Hard rule 3 requires every stored field to change an enforced or audited behavior; hard rule 4 requires the prototype to settle the shape before migration.

### Proposal deduplication must not recreate the finding-merge problem

Two specialists may identify the same upstream work with different impact. Proposal identity may deduplicate the candidate, but it may not fuse severity, route, or rationale into a claim no agent made. Preserve source finding ids and individual reports; let the reconciler produce the single proposal impact decision explicitly.

## Required verification in the rewritten plan

The replacement tasks must provide executable proof for:

- exactly one self-critique per artifact, before any independent reviewer dispatch;
- self-critique using the frozen author definition/model and producing a separately retained run;
- configured review-round counts, including default one and a configured value greater than one;
- panel bounds 2–5, distinct specialties, complete staffing, and author exclusion;
- one reconciliation decision for every finding id, with extras, duplicates, omissions, and unknown dispositions refused;
- report-pair preservation in the mixed `critical/current_artifact` plus `low/upstream` case;
- mechanical artifact gates rerun after self-critique and after reconciliation;
- follow-up proposal writes then advances, blocking proposal writes then blocks, indeterminate blocks without pretending a proposal solved it;
- proposal source links, dedup behavior, nonbinding status, path safety, raw-output retention, and audit-chain validity;
- profiles/configuration created before the change following an explicit compatibility/refusal rule;
- every new prompt constraint detected when removed;
- every schema/checker guard detected when broken;
- one bounded real-model prototype result and one later production smoke, with actual cost and no retry to green.

## Required `plan.md` rewrite

The single plan should now be reconciled in place as follows:

1. Replace the terminal-upstream goal, assumptions, approach, blast radius, and completion gate with the author-led flow above.
2. Make Task 1 the bounded prototype and an explicit decision gate; append its evidence to the same plan.
3. Add the real configuration/profile work before orchestrator changes.
4. Specify self-critique and reconciliation result contracts and prompts before schema design.
5. Design finding-resolution and proposal evidence from the prototype outcome; do not preserve migration 005 merely because the first draft named it.
6. Implement spec and plan orchestration with the same semantic phases and stage-specific artifacts.
7. Add BuildWorks proposal persistence/routing without auto-promoting active features.
8. Reconcile `ARCHITECTURE.md`, `docs/hazards.md`, `README.md`, checker derivations, and project learnings only after behavior is proven.
9. Preserve the first review and this review unchanged as the decision trail; future implementation/code review targets the reconciled `plan.md`.

The rewritten plan is ready for implementation only after each required change above has a concrete task, test, break-it proof, and completion criterion. Until then, its status remains `Proposed`.

---

## Reconciliation

**Date:** 2026-08-31

**Disposition:** 12 accepted, 0 rejected, 0 deferred, 0 open

**Status:** reconciled

`plan.md` is rewritten in place as this review requires. Four decisions this
review left open were settled by the operator during reconciliation and are
recorded in the plan's "Operator decisions this plan implements" section. Both
review records are unchanged above this block and remain the decision trail.
The plan carries `Status: Reconciled` on the operator's instruction, rather
than the `Proposed` this review names, and advances to `Implemented` when Task
13's gate and independent review are clean.

### Operator decisions settled during reconciliation

- **A high or critical finding may advance as `rejected_with_rationale`.** The author may decline any finding with a retained rationale; only `upstream_blocking` and `cannot_determine` block. Severity stops gating the review stages, which removes the last consumer of `MATERIAL_THRESHOLD`; the plan names that consequence and the resulting profile-hash change rather than absorbing it.
- **Panel bounds are two through five with a configured maximum defaulting to two.** After self-critique the author proposes a size within the frozen bounds and the specialties the artifact calls for, and never names agent identities. Deterministic code selects distinct eligible reviewers from the frozen registry, excludes the author, enforces the configured required specialties, and blocks by name when the request cannot be staffed. This replaces per-risk panel sizes, so the plan amends architecture section 12 rather than leaving the two descriptions in conflict.
- **A proposal is stored run state with evidence under the governance directory, and export to `docs/proposals/` is an explicit human command.** No run writes into the repository outside the signed scope.
- **The governance directory is centralized behind one internal path module and stays fixed at `.governance`.** External configuration of that location, and the state migration it would imply, are deferred to a later feature.

### Verdicts

- **Accepted — replace the plan's goal and control flow, not just its merge rule:** the plan's goal, assumptions, approach, blast radius, tasks, and completion gate are rewritten to the five-phase order. The phase table is reproduced in the assumptions, and self-critique and reconciliation are separate evidence-bearing `agent_run` dispatches under the frozen author definition and model mapping.
- **Accepted — make the authority change explicit in the architecture:** Task 10 amends sections 12 and 13 to state the trade — deterministic code decides structural completeness and mechanical gates, the author supplies the semantic disposition including declining a finding of any severity with rationale, reviewers do not confirm the amended artifact by default, the audit retains the finding, decision, rationale, and before and after artifact hashes, and malformed or indeterminate dispositions fail closed. The open question about high and critical findings is answered explicitly.
- **Accepted — implement actual configuration rather than freezing descriptions of constants:** Task 3 adds `specReviewRounds` and `planReviewRounds` defaulting to one, `panelSizeMax` defaulting to two within validated bounds of two to five, a configured round defined as one complete `panel → reconcile` cycle with self-critique once per artifact, stage and selector reads from the frozen policy with no live-constant fallback, an explicit rule for profiles created before the change, and a configuration-time staffing refusal. Task 9 proves both the default and a configured value greater than one.
- **Accepted — make proposal creation a BuildWorks contract:** Task 8 defines the record, its source links, its identity and dedup rule, its non-binding validation, retained evidence and audit before any write, the failure behaviour when a write fails, and the three impact routes. Task 2 provides the path module the evidence directory needs.
- **Accepted — put the prototype inside Task 1 and give it an exit gate:** Task 1 is the bounded prototype against the real dispatch boundary in scratch storage, covering all six comparisons and the malformed case, recording dispatch count, cost, duration, parsing results, finding counts before and after self-critique, reconciliation completeness, proposal quality, and whether the reconciler invented an obligation. Its exit decision is recorded in `plan.md`, and no percentage claim is encoded.
- **Accepted — define "the author is smarter" operationally:** no capability claim is encoded and no model-tier configuration is added. The plan guarantees the author's frozen mapping, a dedicated prompt, the complete artifact and every per-report finding, sufficient result budget, and the effective model recorded per dispatch.
- **Accepted — specialty-only findings are a prompt contract, not a deterministic fact:** Task 6 states the specialty boundary in the prompts that request it, pins it in the source scan, and lets the reconciler decline an out-of-specialty finding with rationale. The plan claims no enforcement of semantic expertise.
- **Accepted — self-critique must not weaken reviewer independence evidence:** hazard 14 is named in the hazards line, and Task 4 dispatches self-critique under the author role exactly once, never in a panel seat and never contributing to an independence claim.
- **Accepted — "log and move on" requires complete disposition:** the five-value vocabulary is adopted, one decision per finding id is required, and extras, duplicates, omissions, and unknown values are refused. The exact stored shape is settled by Task 1's prototype rather than asserted, because hard rule 3 requires every stored field to change an enforced or audited behaviour.
- **Accepted — proposal deduplication must not recreate the finding-merge problem:** Task 8 deduplicates the candidate while preserving source finding ids and individual reports, and takes the impact from the reconciler's single explicit decision rather than fusing across reports.
- **Accepted — the required verification list:** every item has an owning task. Self-critique count and dispatch identity in Task 4; round counts in Tasks 3 and 9; panel bounds, specialties, staffing, and author exclusion in Task 5; reconciliation completeness and report-pair preservation in Task 6; mechanical gates rerun in Tasks 4 and 6; the three proposal routes, source links, dedup, non-binding status, path safety, retention, and audit validity in Task 8; pre-change profiles in Task 3; prompt and schema guards in Task 11; the prototype and the production smoke in Tasks 1 and 12.
- **Accepted — the required `plan.md` rewrite:** all nine ordering points are implemented. Task 1 is the prototype and decision gate, configuration precedes orchestration, contracts and prompts precede schema design, migration 005 and `repair_target` survive only if the prototype's evidence supports them, both stages share the phase order, proposal persistence adds no auto-promotion, documentation is reconciled only after behaviour is proven, and both reviews stay unchanged as the decision trail.
- **Accepted — the reconciliation of review 1:** every disposition in this review's table is applied. The full finding-by-finding record is stamped on `2026-08-31-plan-review.md`: 22 accepted, none rejected, deferred, or open.
