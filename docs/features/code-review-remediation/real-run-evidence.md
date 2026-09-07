# Code-review remediation — paid real-run evidence

**Status:** recorded — the separately authorized fresh chain completed through
code review and delivery; Task 10 is complete, with live remediation still
unexercised because the first panel was clean

**Plan:** `docs/features/code-review-remediation/plan.md` (Task 10)

**Run date:** 2026-09-07

**Hazards considered:** 1 governs both the first attempt's malformed fenced
body and the fresh security response's accepted prose-before-fence shape; 2
requires both outcomes and their exact retained bytes; 3 governs the added
JSON-escaping constraint and the specialized reviewer prompts; 4 requires
load-bearing responses to become committed recorded fixtures before either
scratch target is cleaned; 5 governs the completed delivery range; 7 permits
the fresh run only after a material correction and separate authorization; 8
governs the corrected native Windows launcher; 12 requires the frozen
two-seat, two-round, `high`-threshold policy to be visible in the result; 14
requires separately recorded reviewer dispatches without calling them
independent; 15 requires the final reviewed worktree to remain clean; and 18
is the bounded behavior under test. 6, 9-11, 13, 16, and 17 were weighed and
did not fire: no hook, alias comparison, later-stage promise, upstream route,
or document-removal accounting was involved.

## Authorization and boundary

The operator first authorized one external Anthropic Claude Code chain after the
payload was disclosed: the web-calculator design, generated specification and
plan, scratch implementation files and diffs, and review prompts. The
authorization allowed at most 16 dispatches and acknowledged that the expected
$1.25-$2.50 clean-run range was not a dollar ceiling. It did not authorize a
retry.

After the deterministic launcher and prompt correction, the operator
separately authorized one full fresh paid run with the same disclosed payload
and current 16-dispatch bound. Each authorization produced exactly one chain;
there was no automatic or unchanged retry.

The driver ran once per authorization:

```text
node .claude/skills/run-buildworks/driver.mjs paid --yes
```

The blocked target is retained at `bw-run-skill/1788790553825`; the completed
target is retained at `bw-run-skill/1788794835268`. Both used Claude Code
2.1.263 and reported `claude-sonnet-5` as the effective model for every
dispatch, with `claude-haiku-4-5-20251001` as the auxiliary harness query.

## First authorized outcome — blocked before code review

| Measure | Recorded result |
| --- | --- |
| Run | 1, `web-calculator` |
| Dispatches | 11 of the authorized maximum 16 |
| Total cost | $1.00548 |
| Passed stages | `spec`, `spec_review`, `awaiting_approval`, `plan`, `plan_review` |
| Terminal stage | `implementation=blocked` |
| Later stages | `verification`, `code_review`, and `delivery_check` absent |
| Audit chain | valid |
| Worktree | clean at projection commit `dee258883ceb10114d09b1334cf0e56d58f08993` |
| Code-review policy | panel 2, maximum rounds 2, threshold `high`; never exercised |

The signed scope contained `css/styles.css`, `index.html`,
`js/calculator.js`, `js/theme.js`, and `package.json`. The implementation author
returned all five as proposed patch files, but none was applied because the
result body was not valid JSON.

| # | Stage | Agent invocation | Cost | Duration |
| --- | --- | --- | --- | --- |
| 1 | `spec` | `spec-author` draft | $0.05294 | 30,500 ms |
| 2 | `spec` | `spec-author` self-critique | $0.07412 | 54,471 ms |
| 3 | `spec_review` | `spec-reviewer-traceability` | $0.05007 | 31,686 ms |
| 4 | `spec_review` | `spec-reviewer-consistency` | $0.08154 | 42,875 ms |
| 5 | `spec` | `spec-author` reconciliation | $0.09708 | 47,403 ms |
| 6 | `plan` | `plan-author` draft | $0.04834 | 32,579 ms |
| 7 | `plan` | `plan-author` self-critique | $0.08640 | 59,853 ms |
| 8 | `plan_review` | `spec-reviewer-traceability` | $0.15014 | 86,888 ms |
| 9 | `plan_review` | `spec-reviewer-security` | $0.04029 | 26,506 ms |
| 10 | `plan` | `plan-author` reconciliation | $0.13126 | 70,782 ms |
| 11 | `implementation` | `implementer` | $0.19331 | 113,559 ms |

## Exact block and diagnosis

The implementation stage recorded one typed failure:

```text
implementation.content.invalid — implementer body refused: fenced block is not
valid JSON: Bad escaped character in JSON at position 1912 (line 1 column 1913)
```

The outer Claude envelope is valid and reports a successful provider turn. The
inner fenced `AgentResult` contains the Python-style escape `\U0001f319` twice:
at zero-based positions 1911 and 9505. JSON permits `\u` followed by four
hexadecimal digits; it does not permit `\U` followed by eight. The first token
appears in the moon icon inside `index.html`; the second appears in the same
icon assignment inside `js/theme.js`.

`extractJsonBody` reproduces the recorded refusal exactly. As a diagnostic
counterfactual only, replacing those two tokens in memory with the literal
U+1F319 character makes extraction succeed and `validateAgentResult` accept an
implementer result containing five files. Production does not perform that
repair: accepting guessed JSON would violate the deterministic boundary.

The worktree remained clean at the projection commit, so the failure occurred
before patch validation, application, verification, code review, or delivery.
The surrounding markdown fence violated the prompt's direct-JSON instruction
but was not the cause; hazard 1 deliberately accepts exactly one fence.

## Deterministic correction after the run

Two independent regressions were corrected without another provider dispatch.
First, no installed shim was deleted: the installed Claude Code launcher was
measured as the native `claude.exe`, version 2.1.263, so BuildWorks removed its
obsolete assumption that the launcher was a `claude.cmd` shim. The harness
probe and invocation plus both run-buildworks drivers now spawn the native
executable directly with `shell: false`. That is the same executable PowerShell
resolves when the operator runs `claude`, without inserting either PowerShell
or `cmd.exe` as a second argument parser. Direct launch also removes Node's
shell-argument deprecation warning (`DEP0190`) and retains a typed `ENOENT` when the
executable cannot be resolved.

The shell wrapper was a real launcher regression, but it did not produce the
two recorded `\U0001f319` bytes: the provider stdout was captured as bytes and
decoded once as UTF-8, and the exact invalid tokens were already present in the
retained result body. The implementation-author and code-review-remediation
prompts therefore now state the JSON string contract at both patch-producing
boundaries: literal UTF-8 or JSON-standard `\uXXXX` escaping, including UTF-16
surrogate pairs above U+FFFF, and never Python-style `\UXXXXXXXX` syntax. The
strict extractor remains unchanged and still rejects the recorded response;
no heuristic repair was added.

These prompt constraints reduce the observed failure mode but cannot prove a
provider will obey them. Claude Code 2.1.263 advertises a `--json-schema`
structured-output option, but adopting it would change the contract of every
structured dispatch and requires its own recorded invocation and design. It is
not part of this correction and no claim is made that it is validated.

Five launcher and prompt assertions failed before the correction. After it,
prompt plus recorded-response tests pass 23/23, the harness suite passes 15/15
including a direct real-executable probe, and affected integration tests pass
148/149 with one expected Windows symlink skip. Typecheck, documentation, and
diff checks are clean; the disposable full suite passes 821/822 with the same
skip; and the dispatch-free BuildWorks smoke passes 13/13.

## Fresh authorized outcome — completed

The fresh chain completed all 15 driver checks and reached the terminal
`completed` run state.

| Measure | Recorded result |
| --- | --- |
| Run | 1, `web-calculator` |
| Dispatches | 13 of the maximum 16 |
| Total cost | $1.39473 |
| Stages | `spec`, `spec_review`, `awaiting_approval`, `plan`, `plan_review`, `implementation`, `verification`, `code_review`, and `delivery_check` passed |
| Code-review policy | panel 2, maximum rounds 2, threshold `high` |
| Code-review result | round 1 clean; 0 findings, 0 blocking, 0 remediations; pass |
| Reviewed and delivered commit | `b0b1104dc0b045dbc3d8c116ba44e9ed894200e4` |
| Delivery | four declared artifacts delivered; none missing |
| Operator check | manually verified the delivered calculator output after completion |
| Audit chain | valid |
| Worktree | clean on `gov/web-calculator/1` |

| # | Stage | Agent invocation | Cost | Duration |
| --- | --- | --- | --- | --- |
| 1 | `spec` | `spec-author` draft | $0.06388 | 33,985 ms |
| 2 | `spec` | `spec-author` self-critique | $0.09203 | 50,911 ms |
| 3 | `spec_review` | `spec-reviewer-traceability` | $0.06834 | 36,133 ms |
| 4 | `spec_review` | `spec-reviewer-consistency` | $0.11182 | 65,537 ms |
| 5 | `spec` | `spec-author` reconciliation | $0.04200 | 15,567 ms |
| 6 | `plan` | `plan-author` draft | $0.03339 | 21,506 ms |
| 7 | `plan` | `plan-author` self-critique | $0.10344 | 75,625 ms |
| 8 | `plan_review` | `spec-reviewer-traceability` | $0.09944 | 47,972 ms |
| 9 | `plan_review` | `spec-reviewer-consistency` | $0.05892 | 38,688 ms |
| 10 | `plan` | `plan-author` reconciliation | $0.04570 | 15,652 ms |
| 11 | `implementation` | `implementer` | $0.24514 | 140,141 ms |
| 12 | `code_review` round 1 | `code-reviewer-correctness` | $0.34929 | 406,937 ms |
| 13 | `code_review` round 1 | `code-reviewer-security` | $0.08135 | 22,584 ms |

The implementation author returned valid JSON under the corrected prompt, all
four proposed artifacts were committed, and both frozen verification commands
passed. The correctness reviewer returned one fenced AgentResult with no
findings. The security reviewer returned explanatory prose followed by one
fenced AgentResult with no findings. Both passed the unchanged extractor,
AgentResult validation, the actionable-current-code report contract, and the
stage's clean-tree checks. With an empty first panel, the pure round decision
passed immediately; no implementer remediation or second panel was warranted.
Delivery then matched all four signed artifacts to the full patch range and
the audit chain verified.

After the chain completed, the operator manually verified the delivered
calculator output. This is human evidence outside the frozen BuildWorks
verification commands and audit record. No detailed manual test matrix was
recorded, so the check supports the observed calculator output without
claiming that every acceptance criterion was manually exercised.

## What the two attempts establish

- Both authorized chains froze the new code-review policy at panel size 2,
  maximum rounds 2, and blocking severity `high`.
- The first proves the implementation boundary fails closed on malformed live provider
  JSON, records `implementation.content.invalid`, blocks the run, retains the
  raw response, and leaves the worktree clean.
- The fresh chain did not reproduce that invalid escape under the direct native
  launcher and corrected author prompt; implementation and verification passed.
- Both specialized code reviewers ran against the same verified commit and
  produced attributable, valid empty reports; the final gate, delivery binding,
  terminal state, and audit verification all passed.
- The operator separately verified the delivered calculator output after the
  successful run; this was a manual check, not a BuildWorks stage result.
- The attempts cost $1.00548 across 11 dispatches and $1.39473 across 13
  dispatches respectively. No rate or convergence percentage is inferred from
  two different outcomes.

## What the evidence does not establish

- Neither live panel exercised a code-review remediation patch, its
  post-patch verification, or a second complete panel. Those paths remain
  covered by deterministic integration tests, not provider evidence.
- Empty reports record what two reviewers asserted in one small static-app
  sample; they do not prove the implementation correct, secure, or reliably
  clean across future runs.
- The frozen verification commands reported only `node --version` and
  `npm --version`; they prove the expected tools launched at the verified
  commit, not that calculator behavior passed executable tests. The operator's
  later manual output check supplements this evidence but has no recorded test
  matrix and does not retroactively make the verification stage behavioral.
- The successful response does not isolate whether direct launch, the explicit
  JSON-escaping instruction, provider variation, or their combination avoided
  the first attempt's invalid escape.
- `--json-schema` remains unimplemented and unverified.

## Committed evidence

`test/fixtures/recorded/implementation-web-calculator-invalid-unicode-escape.json`
contains the retained response with provenance, frozen stage context, hashes,
scope, dispatch count, cost, and the exact typed refusal. Provider session ids
and per-request timing fields were dropped; the result body contains no
absolute machine paths or signing material and is otherwise byte-for-byte as
retained.

`test/recorded-implementation-response.test.ts` replays the response through
`extractJsonBody`, asserts the exact refusal and both invalid-token positions,
then performs the in-memory counterfactual through `validateAgentResult`. The
focused replay passes 2/2 under Node's no-isolation mode.

`test/fixtures/recorded/code-review-web-calculator-remediation-clean-correctness.json`
and
`test/fixtures/recorded/code-review-web-calculator-remediation-clean-security.json`
contain the two fresh panel responses with frozen round, commit, policy, cost,
and model provenance. Their result bodies are byte-for-byte copies of the
retained raw responses after dropping only machine/session and per-request
timing fields from the surrounding envelopes. `test/code-review.test.ts`
replays both through extraction, AgentResult validation, shared report
validation, and the code-review-only contract beside the three earlier live
responses.

Both scratch targets remain retained. Do not run `driver.mjs clean` before the
operator decides they are no longer needed; that command deletes all retained
targets, not only the completed one.
