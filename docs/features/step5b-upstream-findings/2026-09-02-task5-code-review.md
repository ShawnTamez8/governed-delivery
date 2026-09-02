# Step 5b Task 5 (author-proposed panel, deterministic staffing) — code review

**Status:** reconciled

**Reviewed document:** `docs/features/step5b-upstream-findings/plan.md`, Task 5,
together with the accepted Task 1 prototype exit decision in
`docs/features/step5b-upstream-findings/2026-09-01-task1-prototype-evidence.md`
(revision A binds the self-critique prompt) and the Task 4 review record
`2026-09-02-code-review.md`.

**Review date:** 2026-09-02

**Effort:** high. Independent reviewer over the staged working-tree diff, nine
files, before any commit.

**Hazards considered:** 3 (panel size is the constrained model-returned field
this task made binding, and the entry's second sentence — "assert that every
example value a prompt advertises validates against the schema that receives
it" — is what findings 1 and 2 turn on; a new test now asserts exactly that for
both self-critique prompts across three required-lens configurations); 7 (no
round budget changed, both `LEGACY_CLOSURE_PASSES` constants are untouched, and
no dispatch was added or repeated); 11 (a default installation still staffs its
panel end to end, and an unstaffable union blocks by name before any reviewer
is dispatched rather than shrinking the panel or substituting a lens); 12
(panel size has one source, the frozen profile, and the prompt now derives the
floor it advertises from the same frozen values the validator enforces); 14
(self-critique is untouched here and still never occupies a panel seat).
Entries 1, 2, 4, and 13 are not newly exercised: no new parse boundary, no new
stored artifact, no fixture defines correctness, and no disposition, grounding,
or reconciliation work lands in this task.

---

## Findings and dispositions

Four findings, all applied. Findings 1 and 2 were reproduced by execution
against the real modules before being accepted, not taken on the reviewer's
description.

### 1 — medium — the prompt advertised a floor the validator refuses

`src/prompts.ts`. The prompt stated `at least ${panel.sizeMin}`, but the
smallest size a request can carry is `max(sizeMin, requiredSpecialties.length)`:
required lenses consume seats inside the requested size, so
`validatePanelRequest` refuses any size their union overflows.
`invalidPolicyReason` only requires `required.length <= panelSizeMax`, so a
policy with floor 2, maximum 3, and three required lenses is legal and
reachable by the documented operator action.

Reproduced: in that configuration the prompt advertised `2`, and
`validatePanelRequest` refused `2` with "panel request of 2 cannot seat the 3
required and requested specialties", after the draft and self-critique
dispatches were already paid for. The repository's own new stage test encodes
that blocked outcome, and the interim
`max(panelSizeMin, requiredSpecialties.length)` this task deleted had made the
same configuration run — so this was a behavioural regression, not only a
documentation defect.

**Applied.** `effectiveFloor()` renders `max(sizeMin, requiredSpecialties.length)`
in both prompts.

### 2 — medium — the advertised example value was a hardcoded 2

`src/prompts.ts`. The example envelope showed `"panelRequest": {"size": 2, …}`
while the bounds around it were interpolated from the frozen policy. Under a
policy whose effective floor is 3, the example handed to the model was
precisely a value the validator refuses, and models copy examples. Hazard 3
names this case in as many words.

**Applied.** The example interpolates the same `effectiveFloor` the prose
states, and a new test asserts the two agree *and* that the advertised value
validates.

### 3 — low — two contradictory caps in one bullet

`src/prompts.ts`. "Unique non-empty strings, no more of them than the size you
request" sat two lines above the always-seated block's union rule. On the
default installation an author naming two lenses at size two satisfies the
first sentence and still blocks on a union of three.

**Applied.** The plain cap now renders only when no lens is configured as
required, where it is the correct rule; otherwise the union rule is the single
stated cap. `seatAccountingBlock` always states one or the other, so no
configuration leaves the cap unstated.

### 4 — low — a stale doc comment describing removed behaviour

`src/policy.ts`. The `PANEL_SIZE_FLOOR`/`PANEL_SIZE_MAX` comment still said the
stages staff the floor "until the author proposes a size (step 5b Task 5)".
This diff is Task 5.

**Applied.** The comment now describes the shipped behaviour and documents
finding 1's consequence at the constant an operator reads before raising the
maximum.

## Not changed

The reviewer noted that `staffingShortfall`'s duplicate-requested and
union-over-capacity branches are unreachable from both current callers
(`freezeProfile` passes an empty list; the stages run `validatePanelRequest`
first) and did not count it against the diff. The duplication is deliberate and
argued in `src/select.ts`: a tolerance applied at one boundary and not its
sibling is how a malformed value reaches a consumer that trusted the other end.

## Follow-up, not fixed here

`src/policy.ts` names `assertStaffable` in the same comment block; the function
is `staffingShortfall`. The wrong name predates this task and is not a
consequence of this change, so it was left alone rather than folded into an
unrelated diff.

## Verification after reconciliation

`npm run typecheck` clean; `npm test` 552 tests, 551 pass, 1 recorded skip, 0
fail; `npm run check:docs` exit 0 with 36 warnings. Three further
break-and-restore mutations were run against the fixes — reverting
`effectiveFloor` to the bare floor, hardcoding the example size again, and
making the seat accounting always state the plain cap — and each was detected
by the named test and restored byte-identical. That is seventeen mutations
across the task in total.
