# Verification Stage Tasks

**Status:** Implemented except Task 12

**Hazards considered:** none directly — this file is the checkbox projection of `docs/features/verification-stage/plan.md`, and the hazard reasoning for step 7 (entries 2, 7, 8, 9, 11, and 12 weighed; 1, 3, 4, 5, 6, 10, 13, and 14 found not to apply) is stated in full there. This line records that the omission here is deliberate, not an entry nobody consulted.

Task numbers and titles mirror the plan exactly. Mark a box only when that task's own completion evidence exists.

- [x] **Task 1: The `governed.yaml` strict-subset parser** — one named test per refusal rule, plus reading from the starting commit.
- [x] **Task 2: The repository's own `governed.yaml`** — committed, with the hazard-11 assertion derived from `package.json`.
- [x] **Task 3: Policy — the ceiling, the passthrough, and the frozen output budget** — including the assertion that no passthrough name starts with `BW_`.
- [x] **Task 4: Freeze the validated configuration in the profile** — non-nullable field, passed in rather than re-read.
- [x] **Task 5: `new-run` preconditions** — clean tree, committed and parseable configuration, each refusing before the row exists.
- [x] **Task 6: The bounded command runner** — named environment, complete retention above the cap, `killError`, tree-kill.
- [x] **Task 7: An audit reader on the store** — order, isolation, and the empty case.
- [x] **Task 8: The verification stage orchestrator** — head and cleanliness proven before and after, six block paths, structured `output_ref`.
- [x] **Task 9: `bw verify`** — distinct from `verify-audit`, no `--model`.
- [x] **Task 10: Documentation and the recorded deferrals** — sections 12 and 15 amended, containment limitation stated, proposal filed.
- [x] **Task 11: Prove each guard by breaking what it guards** — twenty-four cycles, direction confirmed at the shell first.
- [ ] **Task 12: Manual end-to-end smoke** — attempted 2026-08-30 and blocked one stage upstream: `bw implement` refuses the implementer's own file writes. Seven dispatches, $0.5021. See the plan's implementation note and `docs/proposals/implementer-writes-files-it-also-proposes.md`.
