# Code-review remediation can replace the approved behavior

**Date:** 2026-09-11

**Purpose:** Give operators, product owners and BuildWorks maintainers an
evidence-backed account of the blocked calculator run and a handling rule for
similar failures. This is an incident write-up and recommendation, not an
implementation plan or authorization to change policy.

**Hazards considered:** 2 (retain the actual reports and patches); 3 (author
and reviewer instructions must agree on what can be corrected); 4 (a test can
encode the same wrong assumption as its implementation); 7 (more unchanged
attempts do not resolve competing expectations); 13 (do not invent a new
behavioral obligation); 16 (a genuine upstream question belongs with its owner,
not another code patch); 18 (version commands and review assertions do not prove
product behavior).

## Recommendation

**Do not automatically create a spike whenever code review blocks.** Retain the
block and triage the evidence first. Use a defect follow-up when the approved
contract already supplies the answer; use a product decision when the owner
must choose a behavior; use a time-boxed spike only when evidence or research is
needed to make that decision.

This incident should initially be handled as **a remediation that conflicts
with an approved requirement**, not as an unexplained upstream dependency.
AC-013 already says what Enter must do. A different focus-dependent interaction
policy would be a deliberate requirements change, not an implicit repair.

## Recorded incident

The separately authorized September 11 web-calculator run used 16 dispatches,
cost $2.4481306, and ended blocked after two code-review panels and one
remediation. Both panels had correctness and security specialists; only the
correctness reviewer reported findings. Delivery did not occur.

The governing specification states:

> AC-013: Pressing the Enter key triggers the same result computation as
> selecting the equals (=) control.

The approved plan also explicitly maps Enter to equals. Its open keyboard
question concerns physical operator-key equivalents such as multiplication,
not an exception for Enter when a button has focus.

The paths below belong to the recorded target, not the BuildWorks checkout.

| Step | Evidence | Consequence |
| --- | --- | --- |
| Initial code, commit `7d5273c2` | The window keydown handler processes Enter globally without cancelling its native default action. | The first reviewer identifies a collision with focused-button activation. Native browser event ordering has not been independently reproduced here. |
| Round 1, finding 4, high | The reviewer expects Enter on focused Backspace to edit the entry rather than compute equals: with pending 5 + 23, it asks for 2 rather than 28. | This combines a plausible double-handling defect with a preferred outcome that AC-013 does not specify. |
| Remediation, commit `511f64bb` | `shouldDeferToButtonActivation` returns true for Enter on every BUTTON; the window handler returns before calling the calculator's key handler. | The patch resolves the first report by disabling the approved Enter shortcut whenever a button is focused. |
| New generated tests | Tests assert that every focused button defers Enter and that the focused-Backspace example returns 2. The existing Enter-equals test calls `handleKey` directly. | The assertions encode the chosen exception; they do not exercise the complete event handler against AC-013. |
| Round 2, finding 5, high | At src/calculator.js:186, the reviewer reports that a focused digit/operator activates instead of computing equals. | This report is grounded in the approved Enter-equals requirement. The final high threshold blocks the run. |

The final source path is established by inspection, not merely by accepting a
reviewer's severity. A full native-browser reproduction remains outstanding.
The initial report's proposed Backspace result should not be promoted to a
requirement simply because it accompanied a valid-looking concern.

## What failed, and what worked

The remediation changed the meaning of the interaction to satisfy a report,
rather than correcting the interaction while preserving the approved
requirement. The new assertions repeated that choice. This is the mechanism
behind the conflicting outcomes across the two panels; it is not evidence that
every successive review will oscillate or that finding IDs identify the same
semantic concern across rounds.

The implementer was not missing the specification: the remediation prompt
already supplies the approved spec, plan, scope, full diff and all first-panel
reports. The failure is not repaired merely by supplying those documents again.
Likewise, the later reviewer seeing a real regression is not itself a defect
in the review process.

The deterministic gate behaved as configured. Final-panel high findings block;
there is no third patch, waiver or automatic retry. Doctor's native-executable
and ambient-config components passed. The subsequent overall `not_ready`
reported the blocked boundary and generated untracked spec/plan projections,
not a provider-configuration failure.

Both frozen verification passes executed only Node/npm version commands.
They could not detect this interaction regression. **Merely adding the current
generated unit suite to verification would not establish the missing guarantee:**
its relevant assertions bless the focus exception or bypass the event handler.
No passing result for that suite is claimed by this write-up.

## Immediate handling

1. Keep run 1 blocked and preserve its original reports, patch commits, approved
   input, frozen verification, cost and audit. This evidence is already retained.
2. Treat the current code/AC-013 mismatch as the default defect classification.
   Record the first report's unsupported expected outcome as analysis beside
   the immutable evidence, not as a rewritten report or a cleared gate.
3. Before implementing a correction, confirm the intended interaction against
   the approved contract and reproduce the complete keyboard/default-action
   path. A correct repair must avoid double handling without silently disabling
   Enter-equals. Cancelling the conflicting default action for a handled
   calculator shortcut is a candidate, not a verified patch; preserve other
   controls' keyboard accessibility.
4. Derive regression cases from AC-013: compare Enter with the equals control
   when focus is on the calculator background, a digit, an operator, Backspace
   and equals; cover click/Space activation and theme-control behavior too.
   Tests must exercise the event wiring and relevant native default action,
   not only the pure `handleKey` or deferral helper.
5. For separately authorized future work, commit meaningful verification
   commands before freezing a new run. Preserve the original blocked run;
   manually editing its result, increasing its frozen budget, or closing a
   tracking item cannot resume or approve it.

No repair, browser automation dependency, verification-command change or new
paid run is authorized or implemented by this document.

## When a spike is appropriate

| Triage result | Appropriate handling | What it does not authorize |
| --- | --- | --- |
| Reproducible code defect; contract is clear | Defect follow-up with the violated criterion, reproduction and expected result. | Rewriting the contract or bypassing the blocked gate. |
| Report relies on an unsupported expectation | Review-quality follow-up; preserve the report and record the correction separately. | Deleting evidence or treating the original run as passed. |
| Product owner can directly choose between behaviors | Record a product decision and amend upstream inputs when needed. | Inventing the choice inside a code patch. |
| A genuine uncertainty needs investigation before a decision | Time-boxed spike with a specific question and decision owner. | Treating the act of filing it as resolution. |
| Provider, environment or execution failure | Diagnose the operational failure from retained evidence. | Relabeling every failure as a requirements spike or spending again automatically. |

For this case, a spike would be justified only if the owner does not accept
the existing Enter-equals rule as sufficient and needs interaction/accessibility
research. A useful candidate would contain:

- **Question:** Should Enter remain a calculator shortcut while a calculator
  button has focus, or should native focused-button activation take precedence?
  How must other controls, including the theme toggle, remain keyboard usable?
- **Options:** Preserve the approved Enter-equals behavior and prevent competing
  activation; or deliberately introduce a focus-specific exception and amend
  the specification. The second option is not already approved.
- **Owner:** The product/interaction decision owner, not the code-review agent.
- **Bound:** A short, explicitly authorized investigation using the retained
  example and relevant browser behavior; no open-ended provider retry loop.
- **Exit:** One recorded interaction rule, its affected acceptance criteria,
  and reproducible acceptance cases before dependent implementation begins.

If a brief contract review or a direct owner decision answers the question,
do not create a spike merely to package that answer.

## Current capability versus proposed automation

`ARCHITECTURE.md` section 12 explicitly excludes proposals, spikes, upstream
classification, finding dispositions and human waivers from `code_review`.
Section 19 keeps terminally blocked runs inspectable but does not reopen them.
The upstream proposal routes in section 13 belong to document reconciliation;
they do not silently extend the narrower code-review contract.

The existing outbound idea in
`docs/proposals/github-project-projection-and-upstream-spikes.md` proposes an
explicit operator publication action for an already stored
`blocking_dependency` proposal. It is not implemented publication, and a
code-review finding is not such a proposal. Its reconciled review preserves
the separate authorization and fresh-run boundaries.

The smallest present-day handling is the retained run report plus this
operator-authored follow-up. If automatic follow-up routing is later wanted,
plan it as a separately authorized post-run capability. It should present the
block and evidence for operator classification, not guess a decision question,
create a second run-state authority or convert severity directly into a spike.
Any GitHub publication needs its own explicit consent and integration design.

## Evidence and work record

- `test/fixtures/recorded/doctor-ambient-config-web-calculator-live-chain.json`
  retains the approved spec/plan, both implementer responses, both panels,
  costs, raw hashes and final state. Original evidence remains unchanged.
- `.claude/sessions/2026-09-11-doctor-ambient-config-live-run.txt` records the
  authorization, paths, commands and terminal result.
- `.claude/sessions/2026-09-11-debug-doctor-live-code-review-block.md` records the
  original gate diagnosis and links this subsequent contract analysis.
- `.claude/sessions/2026-09-11-code-review-block-triage-evidence.txt` distinguishes
  source evidence from the incomplete optional unit replay.
- `src/prompts.ts`, `src/code-review.ts` and `src/code-review-stage.ts` establish
  the prompt inputs, final severity decision and terminal block.

Requested outcome: explain this incident and whether it should generate a spike.
Baseline: the retained September 11 run and the current doctor implementation.
Success: an evidence-grounded classification, immediate handling, conditional
spike criteria and a clear boundary between recommendations and shipped behavior.
Only documentation/continuity and a diagnostic evidence record are changed.
No runtime, target source, original review, frozen state or architecture is edited;
no rollback, repair, publication or additional provider spend occurred.
