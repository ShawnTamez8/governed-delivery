# Debugging Analysis

**Status:** diagnosed; no fix authorized

## Problem

The authorized live chain did not reach delivery. Run 1 in the new
doctor-ambient-config target stopped at the final code-review gate.

## Expected Behavior

The driver attempts the whole web-calculator chain. Delivery is permitted only
after the final configured panel has no finding at or above frozen `high`;
otherwise the gate must block without another patch or an automatic paid retry.

## Actual Behavior

The gate blocked on round 2 of 2, after one remediation and re-verification.
Sixteen dispatches cost $2.4481306; no delivery stage exists. The driver's five
failed expectations are consequences of the code-review block, not five
independent runtime defects.

## Evidence

`test/fixtures/recorded/doctor-ambient-config-web-calculator-live-chain.json`
retains all 16 unchanged raw envelopes with provenance and checked hashes,
the frozen profile, review/verification records, complete relevant store rows,
doctor reports and driver transcript. The live-run session record names the
retained external target and exact commands.

Round 1 correctness finding 4 reported that global Enter handling conflicted
with a focused button's native activation. The implementer changed the
calculator and its test file, producing commit
`511f64bbb34d3ed0c8066a7fd8fb4945dc6ba54e`.

Round 2 correctness finding 5, `enter-key-defers-to-wrong-focused-button`,
reported a `high` issue at calculator.js:186: deferring Enter whenever a
button is focused can activate a digit/operator instead of computing equals,
contrary to the reviewer's reading of AC-013. The security reviewer reported
no finding in either panel. These functional allegations were not independently
reproduced in a browser by this operator.

## Failing Layer

The governed code-review policy gate is the confirmed stopping layer.
The remaining product behavior concern is reviewer-reported UI event handling.

## Hypothesis

The final high finding exhausted the permitted remediation path and caused the
terminal block; the newly implemented doctor diagnostics did not cause it.

## Hypothesis Result

Confirmed for the stopping mechanism. `src/code-review.ts` calls the severity
gate and permits remediation only when another round remains.
`src/code-review-stage.ts` supplies the frozen round limit, persists `block`,
marks the run blocked, and records `code_review.gate.block`.
The retained final record and audit have finding 5, round 2/2 and threshold high.

The native probe, frozen-executor probe and ambient-config observation passed
after the run. Doctor's overall `not_ready` came from the blocked boundary and
the generated untracked spec/plan projections. All 16 provider dispatches
completed with cost; no recorded dispatch failure explains this block.

## Proposed Fix

None in this assignment. The policy behaved as configured. No BuildWorks
change, target patch, threshold adjustment or second paid run was made.
Before any product correction, reconcile the reported Enter/focused-button
behavior with the complete approved contract and reproduce it in the retained
worktree. Do not treat model severity alone as an independently confirmed defect.

## Validation Plan

Completed: compare terminal store state, frozen policy, review result and audit;
retain and hash-match each raw envelope; confirm live diagnostic components
still pass; confirm source identities match their pre-run snapshot.
No paid reproduction was needed or authorized.

## Regression Coverage

No code correction was made, so no new regression test belongs to this
diagnosis. Both frozen verification passes ran only Node/npm version commands;
neither executed the generated calculator tests or established browser correctness.

## Risks and Open Questions

The underlying UI allegation remains independently unverified. Another blind
paid run would not settle the contract or browser behavior. The target, worktree,
keys and evidence are retained; the paid shell has ended and no automatic retry
is authorized.

## Follow-up contract analysis (2026-09-11)

The operator subsequently requested an issue write-up and handling advice.
`docs/proposals/code-review-remediation-contract-drift.md` records that analysis.
The complete approved AC-013 and plan map Enter to equals; source inspection
confirms the remediation skips that handler for every focused button, and its
new tests assert the exception. This establishes a source-level contract conflict,
not a native-browser reproduction. The first report's requested Backspace result
is not itself the approved contract. Preserve both reports as recorded evidence.

The recommended disposition is a defect follow-up unless the product owner
deliberately reopens the interaction policy. A spike is conditional on a genuine
investigation question, not on a high finding or exhausted review rounds.
No fix, waiver, state transition, publication or additional paid run occurred.
