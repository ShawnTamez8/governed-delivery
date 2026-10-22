# Protected acceptance tests - re-review of the review fixes

**Reviewed document:** `docs/features/protected-acceptance-tests/plan.md`, Tasks 12 to 15. Those tasks fix the four findings of `docs/features/protected-acceptance-tests/2026-10-21-code-review.md`.

**Review date:** 2026-10-21

**Status:** reconciled

**Hazards considered:**
- **Bear directly on the findings:**
  - 15: runtime immutability of the suite, now mounted from a copy of the commit;
  - 18: a passing test without a behavioural assertion;
  - 4: real evidence. Each expected value comes from the plan's gate 5 rules, not from the code under review.
- **Checked without a finding:**
  - 6: a gate refusal blocks after the author's dispatch is paid for. That is the cost a false refusal carries;
  - 22: the mount copy is not in the worktree, so the clean-tree guard does not see it.
- **No bearing:** entries 1-3, 5, 7-14, 16, 17, 19-21, 23 and 24. The fixes change no dispatch, prompt, parser, retry, budget or stage sequence.

**Scope reviewed:** the working-tree diff against `9319f0a`, plus the two new recorded fixtures (`acceptance-report-matcher-argument*.json`).

**Reviewer:** an independent agent dispatched in the implementing session. It was given the code, the plan and the first review, not the implementer's conclusions. It modified no file.

## Summary

The four original findings are checked first.
- **Finding 1 (case alias):** closed. Every caller of `createSandbox` passes the repository root, the copy sits beside the worktree and never under it, and a failed start removes the copy.
- **Finding 3 (matcher argument):** closed.
- **Finding 2 (uncalled helper):** closed, but the fix introduced two false refusals (defects 1 and 2 below).
- **Finding 4 (awaited array):** closed only for inline callbacks (defect 3), and its fix introduced one false refusal (defect 4).

Each defect was reproduced. A lint probe ran each shape through `validateAcceptanceSuite`, against the working tree and against an archive of `9319f0a`. Defects 1, 2 and 4 are refused now and were accepted at `9319f0a`, so they are regressions.

## Findings

### Defect 1 - Same-named helpers in two tests resolve to the last declaration

- **Where:** `runsAssertion` in `src/acceptance.ts`. It resolved a called name through `localFunctions`, a file-wide map in which the last declaration of a name wins.
- **Scenario:** two tests each declare a local `check`. Only the first test's `check` asserts. The first test is refused as "a test with no retrying assertion". Reversing the order lets a test with no assertion pass.
- **Severity:** medium. It reaches runs frozen with `--acceptance-tests`. A false refusal blocks the run after the author's dispatch is paid for, and the reverse order defeats gate 5. None of the 53 recorded author suites has this shape.

### Defect 2 - A helper held in an object literal no longer counts

- **Where:** the same walk. A function whose parent is a property assignment is neither called on the spot nor passed to a call, and `calc.expectDisplay()` is not an identifier call.
- **Scenario:** a test declares `const calc = { expectDisplay: async (v) => { await expect(…).toHaveText(v); } }` and calls `await calc.expectDisplay("1")`. It is refused.
- **Severity:** low to medium. The configurations and cost are the same as defect 1.

### Defect 3 - A named callback passed to `map` gets past the array rule

- **Where:** `isPromiseArray`. It checked only an inline function argument.
- **Scenario:** `const clickOne = async (k) => { … click(); }; await ["1", "2"].map(clickOne);` is accepted. That is the unsettled-click race the first review recorded at run time.
- **Severity:** medium, as Finding 4.

### Defect 4 - An array spread into a literal passed to `Promise.all` is refused

- **Where:** `joins`. The `map` node's parent is a `SpreadElement`, not the call.
- **Scenario:** `await Promise.all([...keys.map(async (k) => …)])` is refused.
- **Severity:** low. The shape is valid but uncommon.

### Limits recorded, not defects

- **The assertion rule is syntactic.** `if (false) await expect(…)` passes, as Task 13's rule allows, so a trivial rewrite still reaches gate 5's limit.
- **An empty `mounts/` directory remains** under `.governance/acceptance/<run>/` after teardown.
- **One teardown failure goes unreported.** When a Git failure inside `createSandbox` is followed by a failed copy removal, the removal failure is not added to the error.

---

## Reconciliation

**Date:** 2026-10-21
**Disposition:** 4 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — Defect 1:** `runsAssertion` now resolves each called name through `namedFunction` in `src/acceptance.ts`. That reads the declaration in the nearest enclosing block or file, and a parameter of the same name shadows it. Two tests' same-named helpers stay apart, in both orders.
- **Accepted — Defect 2:** `namedFunction` also resolves `object.method` when `object` is declared as an object literal: an arrow or function property, a method, or a shorthand property. The walk descends into no nested function or method except through a call that names it, so an uncalled method still counts for nothing.
- **Accepted — Defect 3:** a `map` callback resolved by `namedFunction` is held to the same rule as an inline one.
- **Accepted — Defect 4:**
  - `joins` follows a spread into an array literal to the call that takes the literal.
  - An array literal that spreads an array of promises is itself one, so `const all = [...ops]; await all;` is still refused.
- **Evidence:**
  - Three new tests in `test/acceptance.test.ts` cover all four defects, and the file passes 29 of 29. That includes the 53 recorded author suites, which still get 0 refusals.
  - Each fix was break-tested by reverting it, and the matching test failed:
    - the file-wide lookup for defect 1;
    - no object-literal resolution for defect 2;
    - inline-only `map` callbacks for defect 3;
    - no spread join for defect 4.
  - Each break was restored byte-identically, checked by SHA-256.
- **Not changed, recorded as follow-ups:**
  - **The three limits above.**
  - **The `forEach` rule shares defect 3's gap.** It too checks only an inline callback. This is outside the reviewed diff, since it predates `9319f0a`.
