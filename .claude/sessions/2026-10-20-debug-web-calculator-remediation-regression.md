# Debugging Analysis: web-calculator paid run blocked at code_review (2026-10-20)

## Problem

The paid web-calculator chain (`driver.mjs paid --yes --model claude-sonnet-5-5`, run 1 in the scratch target
`%TEMP%\bw-run-skill\1792540205762\target`) blocked at `code_review`. Driver: 10 of 15 steps as expected.
21 dispatches, $1.32615. Spec, plan, implementation and verification passed; code review ran 2 panels and 1
remediation, then blocked on one high finding. `verify-audit` reports the chain valid.

## Expected Behavior

The remediation loop fixes the kept finding without regressing the approved plan, so the final panel is clean
or only below-threshold, and `deliver` completes the run.

## Actual Behavior

Round 1 (commit `b5d4289`): correctness found 0; state-integrity reported finding 9 (medium): the document
keydown handler runs `equals()` and `preventDefault()` on Enter, so Enter on the focused theme toggle never
switches the theme. The reconciler kept it (basis AC-018). The implementer's remediation (commit `bc57eb7`) added
an early return for Enter whenever the target is inside ANY `button`. Round 2: correctness reported finding 10
(high, `src/app.js:83`): after clicking `+`, the button keeps focus, Enter re-runs `chooseOperator('+')` and
`2 + 3` Enter shows 3, not 5. That contradicts the plan's `Enter does equals`. The final panel gated at `high`
and blocked. Finding 11 (low, theme restore if `calculator.js` fails to load) did not block.

## Evidence

- `.governance/code-review/1/result.json`: rounds, findings 9/10/11, `blocking: [{findingId: 10, severity: high}]`.
- Plan task for `src/app.js` (documents/1/plan.md line 26): "Call preventDefault for handled keys so that ... Enter
  does not also activate a focused button and run the action twice." The plan chose global Enter = equals on purpose.
- Spec AC-018: "After it is activated once..." Activation is not limited to a click, so finding 9 is a legitimate
  keep, and the reconciler basis `AC-018` is relevant, not arbitrary.
- Remediation dispatch (agent_run claude-sonnet-5-5, $0.0649, ~9 s): ONE `run_command` (a node string-replace plus
  `sed -n 78,92p`), then StructuredOutput `completed`. It read no file through `read_file`, did not open the plan,
  and its own summary says "I did not run the page or any tests." It checked only AC-013/014/015/024 ("focus on
  the document body"), not the plan's Enter rule.
- The remediation prompt (`prompts/1/722e...txt`, line 16) already instructs: "re-read every task in the approved
  plan and every acceptance criterion ... a fix that breaks one of them is not a fix, so find a change that keeps
  both." The prompt carried the plan text; the implementer did not apply it.
- A fix keeping both finding 9 and the plan exists: exempt only `#theme-toggle` from the Enter-equals path.
  Both findings are satisfiable together, so this was not an unsatisfiable conflict.
- Frozen verification commands in the driver are `node --version` and `npm --version`, so post-remediation
  verification could not have detected the regression (known limitation, project CLAUDE.md).

## Likely Failing Layer

Agent output (the implementer's remediation dispatch), not BuildWorks code. The orchestration did its job: the
reconciler kept a real finding, the system committed and verified the diff, a full panel re-reviewed it, and the
severity gate blocked on a real defect.

## Scope Narrowing

Ruled out:
- Panel/gate logic: the block follows `CODE_REVIEW_BLOCKING_SEVERITY=high`; finding 11 (low) correctly did not block.
- Reconciler: kept a defensible finding with a relevant AC.
- Commit/diff path: the committed diff equals the implementer's edit (one `src/app.js` hunk).
- Reviewer false positive: finding 10 reproduces by reading `src/app.js` at `bc57eb7` (any focused button returns
  before `equals()`); not run in a browser.

## Hypothesis

The block is a model-quality failure of one Sonnet 5.5 (medium) remediation dispatch, which skipped the prompt's
re-check against the plan, not a defect in BuildWorks code. No BuildWorks code path produced the wrong diff.

## Hypothesis Result

Supported by the single transcript above; one sample. Not enough to show a BuildWorks prompt or schema fault:
the instruction already exists and is specific. Earlier remediations on this design held (2026-10-15, -17, -20,
each completed after one remediation), so a systematic cause is not indicated.

## Codebase Review

Not done: no fix applied. Candidate seams if one is approved: the remediation prompt and structured-output schema
in `src/prompts.ts` / `src/code-review-stage.ts`. Both files carry uncommitted work from the inspectable-profiles
change; read them whole before touching.

## Proposed Fix

None applied. The only mechanisms in reach are design changes, each needing the operator's decision:
1. Require the remediation reply to name, per finding, the plan task or AC it re-checked (schema change to the
   `--json-schema` output). Evidence it works: none; an agent that skipped an explicit instruction may skip a
   required field or fill it without checking.
2. Change nothing; treat the block as the system working (a code_review block is a result).
3. Rerun to gather a second sample (a new paid spend, needs authorization).

## Validation Plan

For option 1 only: a break-test that the schema refuses a reply without the field, then a paid run, which does
not prove the cause is fixed from one sample.

## Regression Coverage

None added; no code changed.

## Risks

- A schema/prompt change on one sample is a speculative fix; CLAUDE.md raises the burden of proof after each
  failed implementation and forbids redesign before the smallest evidence-backed correction.
- `src/code-review.ts` and other files are uncommitted; any edit mixes with that work.

## Open Questions

1. Does the operator treat this block as a result (no BuildWorks change), or want option 1?
2. Is a second paid sample wanted before any change?
