# Debugging Analysis

**Status:** Resolved
**Hazards considered:** 4: a green file-level runner result did not execute the new boundary assertions.

## Problem

Three new doctor boundary tests were not discovered by their name selector.

## Expected Behavior

The existing Node runner reports all three named ambient tests and their assertions.

## Actual Behavior

Two invocations reported one passing file wrapper in about 230 ms, with none of
the three expected names. These results were not accepted as task evidence.

## Evidence

The native argv probe preserved `--test-name-pattern=ambient` correctly. Source
inspection showed the new helper and tests inside the preceding unavailable-tools
test callback, before its remaining body. The enclosing test did not match the
selector, so the nested registrations never ran.

## Failing Layer

Test registration, not production diagnostics or Windows argument transport.

## Hypothesis

An insufficiently specific patch boundary matched the inner mock callback's
closing delimiter rather than the enclosing test's end.

## Hypothesis Result

Confirmed by the complete affected source range. The initial selector-renaming
attempt did not change discovery; the available prior shell-quoting lesson had
been applied without establishing that this failure had the same cause.

## Codebase Review

The full original CLI test file and all edits were read. Task 4 had already passed
166 tests with four expected skips. The new registrations were the only affected
scope; no production code needed correction.

## Proposed Fix

Finish the original test before registering the new helper/tests at module scope,
and outdent only those registrations. Preserve all original assertions.

## Validation Plan

Run `node --test --test-name-pattern=ambient test\cli-operator.test.ts`, requiring
the three actual names, then typecheck and the plan's full focused suite.

## Regression Coverage

The corrected selector ran all three named cases successfully (34.3 seconds);
typecheck passed. No permanent test of test-source formatting is needed: runner
name/count inspection and subsequent guard mutations prove actual execution.

## Risks

The mistaken green wrapper was never counted as behavioral evidence. No product,
target, configuration, or frozen-state rollback was needed.

## Open Questions

None for discovery. The main implementation record owns remaining task evidence.
