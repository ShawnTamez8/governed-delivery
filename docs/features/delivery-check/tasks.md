# Step 8 Delivery Check Tasks

**Status:** Pending — plan reconciled 2026-09-02; tasks not started.

**Hazards considered:** none directly — this file is the checkbox projection of `docs/features/delivery-check/plan.md`, and the hazard reasoning (entries 3, 4, 5, and 11 weighed; 1, 2, 6, 7, 8, 9, 10, 12, 13, 14, 15, and 16 found not to bear, each with its reason) is stated in full there. This line records that the omission here is deliberate, not an entry nobody consulted.

Task numbers and titles mirror the plan exactly. Mark a box only when that task's own completion evidence exists.

- [ ] **Task 1: Declared artifacts become exact file paths** — trailing-slash and git-tree directory refusals in the shared validator; nonexistent paths pass as future files; spec-authoring prompts require exact paths; break-and-restore cycles recorded.
- [ ] **Task 2: One typed handoff contract with a recorded patch base** — gate event carries pre-apply head and final commit; base cross-checked against the signed starting commit; verification parses the shared format and records the base; refusal by name for legacy shapes.
- [ ] **Task 3: The pure delivery-coverage module** — normalization, dedup, sort, case-sensitive exact equality; declared/changed/delivered/missing sets; diff-range invariants stated.
- [ ] **Task 4: `runDeliveryStage` — check everything, then finalize in one transaction** — named refusals before any mutation; clean means tracked state only; NUL-delimited `git diff --name-only` from patch base to verified commit; record written, then one `Store.transaction` inserting and completing the stage, transitioning the run, and appending the audit event; retryable after any crash.
- [ ] **Task 5: The `deliver` command and the paid driver** — `bw deliver --run <id>` on the single surface; terminal states refuse low-level work; paid sequence reaches `delivery_check=passed` and `run=completed`.
- [ ] **Task 6: Documentation, break-it sweep, and the evidence gate** — section 12 matching-rule amendment and section 15 delivery record; reference and continuity documents; disposable-checkout verification; plan advanced to `Implemented` after the independent code review.
