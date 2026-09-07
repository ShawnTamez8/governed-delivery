# Debugging Analysis — paid run implementation JSON escape

## Problem

The single authorized Task 10 chain blocked at `implementation` before the new
bounded `code_review` remediation loop could run.

## Expected Behavior

The implementation author returns one valid JSON `AgentResult`; BuildWorks
applies its patches, verifies the resulting commit, and starts the specialized
code-review panel.

## Actual Behavior

The provider turn completed, but `extractJsonBody` refused its fenced body as
invalid JSON. BuildWorks recorded `implementation.content.invalid`, blocked
stage 6 and run 1, and did not apply any patch.

## Reproducibility

The failure is reproduced deterministically from the retained response. It is
one observed provider sample; no paid retry is authorized, so its frequency is
unknown.

## Evidence

- Target: `bw-run-skill/1788790553825`, retained.
- Dispatches/cost: 11, $1.00548.
- Audit: `implementation.content.invalid` with `Bad escaped character in JSON
  at position 1912 (line 1 column 1913)`.
- Provider body: one fenced object with `\U0001f319` at zero-based positions
  1911 and 9505.
- Worktree: clean at projection commit
  `dee258883ceb10114d09b1334cf0e56d58f08993`; no proposed file was applied.
- Audit verification: chain valid.

## Likely Failing Layer

Integration at the provider-result contract. The provider generated
Python-style Unicode escapes in JSON. The deterministic extraction boundary
correctly refused them.

## Scope Narrowing

The outer Claude envelope parses and reports a successful turn. Replacing only
the two `\U0001f319` tokens in memory with literal U+1F319 makes
`extractJsonBody` succeed and `validateAgentResult("implementer", ...)` accept
all five patch files. This rules out the envelope, required AgentResult fields,
patch count, worktree mutation, verification, code review, and delivery as the
measured cause.

## Hypothesis

The two non-JSON `\UXXXXXXXX` escapes are the only parse blocker in this
response.

## Hypothesis Result

Confirmed. The retained response refuses unchanged; the two-token in-memory
counterfactual extracts and validates. Production remains strict and performs
no repair.

The later shell hypothesis was split from the content failure. The installed
launcher is native `claude.exe` 2.1.263, while BuildWorks still used
`shell: true` on Windows under an obsolete `claude.cmd` assumption. Direct
spawning matches the executable PowerShell resolves and removes an unnecessary
`cmd.exe` argument parser. It is a launcher regression worth fixing, but it did
not create the retained ASCII `\U0001f319` tokens: stdout was captured as bytes
and decoded once as UTF-8, and those bytes were in the provider result body.

## Codebase Review

- `src/parse-output.ts` accepts bare JSON, one fenced JSON block, or measured
  prose before an unfenced object, and names invalid JSON without guessing.
- `src/agent-result.ts` validates the parsed object but is unreachable for this
  response.
- `src/prompts.ts` tells the implementation author to return JSON directly and
  supplies a patch shape. It does not state that Unicode content must be literal
  UTF-8 or JSON-valid `\uXXXX` escapes and must never use `\UXXXXXXXX`.
- `src/implementation-stage.ts` records this path as
  `implementation.content.invalid` and blocks before patch application.

## Applied Correction

Keep `extractJsonBody` strict. Amend the implementation-author and code-review
remediation prompts to require literal UTF-8 or JSON-valid `\uXXXX` escapes,
including surrogate pairs for non-Basic Multilingual Plane characters, and to
forbid Python-style `\UXXXXXXXX`. Add prompt assertions beside the recorded
response replay. Separately, spawn the native executor directly in the harness
probe, harness invocation, and paid-driver probe instead of routing it through
a command shell. Both changes are applied; the parser still fails closed.

## Validation

The five new assertions were first run against the unchanged implementation
and failed: one direct-launch source guard, one missing-executable result, the
global prompt-source constraint, the implementation-author prompt, and the
remediation prompt. After correction, prompt plus recorded-response tests pass
23/23 and harness tests pass 15/15 with a real direct `claude --version` probe.
The former Node `DEP0190` warning about passing arguments with `shell: true` is
absent from the harness suite; the warning remains intentionally in the
separate npm verification-command path. The affected integration suites pass
148/149 with one expected Windows symlink skip. Typecheck, documentation
checking, and `git diff --check` are clean; the full disposable-mirror gate
passes 821/822 with that same skip; and the dispatch-free BuildWorks smoke
passes 13/13. A new paid chain still requires separate cost and external-data
authorization.

## Regression Coverage

`test/recorded-implementation-response.test.ts` and
`test/fixtures/recorded/implementation-web-calculator-invalid-unicode-escape.json`
reproduce the exact live refusal and prove the narrow counterfactual. The replay
passes 2/2.

## Risks

A prompt constraint reduces this observed failure mode but cannot guarantee a
provider always emits valid JSON. Parser-side repair would guess at paid output
and could silently change source content, so it is not recommended. Claude Code
2.1.263 advertises `--json-schema`, but using it would change the structured
dispatch contract and must be tested as a separate feature against a recorded
real envelope.

## Resolution

The operator separately authorized a fresh chain after the deterministic
correction. It completed every stage in 13 of 16 dispatches for $1.39473; both
specialized reviewers returned empty first-panel reports, delivery and audit
verification passed, and the operator manually verified the delivered
calculator output. Live remediation remains unexercised.

## Open Questions

- Whether to design and record-test `--json-schema` as a separate structured
  output contract improvement.
- When to clean the retained blocked and completed scratch targets.
