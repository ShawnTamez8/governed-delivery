# Paid web-calculator chain blocks at code review

**Date:** 2026-09-12
**Status:** blocked and retained
**Authorization:** The operator explicitly authorized one paid full run in this
session. No second paid invocation is authorized.
**Hazards considered:** 2 required retaining the final provider response before
the temporary target disappears; 4 limits the frozen version-only verification
evidence; 5 prevents describing passed implementation and verification as
delivery; 14 preserves configured-standalone reviewer labels; and 18 requires
reporting that the chain blocked before delivery rather than treating earlier
passes as product correctness.

## Invocation and environment

- Command: `node .claude/skills/run-buildworks/driver.mjs paid --yes`
- Launch chain: PowerShell to Node v26.4.0 to the native Claude Code 2.1.269
  executable.
- Model: `claude-sonnet-5` for all 16 dispatches.
- Target:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1789245101665\target`
- Run: `1`, project `smoke`, feature and slug `web-calculator`.

## Outcome

- The chain spent $1.8073754 across 16 dispatches.
- `spec`, `spec_review`, `awaiting_approval`, `plan`, `plan_review`,
  `implementation`, and `verification` passed.
- `code_review` blocked in round 2 of 2 at the frozen `high` threshold.
- `delivery_check` is absent and the run status is `blocked`; delivery never
  ran.
- `verify-audit` returned `chain valid`.

## Review evidence

- Round 1 reviewed `bbc3df61b4d0e8acf845efb145b46733d596d7a3`.
  The correctness reviewer found a high-severity decimal-formatting defect in
  the calculator JavaScript at line 96; the security reviewer reported no
  finding.
- The bounded remediation changed the calculator JavaScript, committed
  `270dc90fe939d3f1c60836a46151e361d37d6d47`, and passed the two frozen
  verification commands: `node --version` and `npm --version`.
- Round 2 reviewed the remediated commit. The correctness reviewer found a
  high-severity width calculation at `src/styles.css:60`: `94vw` plus the
  body's 16-pixel side padding overflows viewports from 320 pixels through
  roughly 533 pixels, conflicting with AC-018. The security reviewer again
  reported no finding.
- The final round applies the threshold without an unreviewed patch, so the run
  correctly blocked with no second remediation.

## Retained evidence and limits

- `test/fixtures/recorded/code-review-web-calculator-final-mobile-overflow.json`
  preserves the exact final correctness result, its raw-output hash,
  provenance, reviewed commits and final gate.
- The temporary target retains the complete store, raw responses, generated
  documents, worktree and code-review report until the host removes that temp
  directory. It is not the durable evidence tier.
- The generated target has no browser validation. Passing version commands
  establish only frozen command success, not calculator correctness or
  responsive behavior.

## Next action

Inspect or clean the retained target only on operator instruction. A corrected
new paid chain requires separate explicit authorization; the blocked run has
no in-place retry path.
