# Step-6 Trust-Boundary Correction Plan — review

**Reviewed document:** `plan.md`
**Document type:** Plan
**Review date:** 2026-08-31

**Hazards considered:** 3 (the prompt constraint and the source scan), 4 (fixtures derive from the recorded smoke; the review verifies each derived claim against the recorded reproduction), 8 (the executor keeps the one shell-resolved harness), 11 (no `--bare`; the capability is added and tested), 12 (frozen executor becomes effective; the raw-surface finding below is this entry's class), 14 (independence recording untouched), 15 (the new entry this plan adds). Entries 1, 2, 5, 6, 7, 9, 10, 13 do not drive this correction for the reasons `plan.md` states.

---

## Summary

A thorough, well-grounded plan for the step-6 trust-boundary correction: every source claim I checked against `ARCHITECTURE.md`, `docs/hazards.md`, the diagnosis record, and the shipped code resolved correctly, and `npm run check:docs` exits clean. Two gaps survive review — one requirement-coverage gap on the raw dispatch surface, and one unverified assumption about the CLI's tool-inventory validation that the smoke alone cannot close.

## Verdict

**Ready for planning after required changes.** The critical finding is a requirement-coverage gap, not a design flaw: the plan binds the raw `dispatch` surface's executor but never checks the capability (or the agent) there, while its own goal and the diagnosis's fix list both require it. Fix Task 2 Step 5, and the plan is executable as written.

## Critical issues — must fix before implementation

**Issue: the raw `dispatch` surface gets no capability or agent binding**

- **Why it matters:** `plan.md`'s goal states "frozen agent/executor binding at every dispatch construction site", and the diagnosis's fix list says "apply the same rule to spec, plan, implementation, and the raw dispatch surface; otherwise config remains only partly frozen". Task 2 Step 5 changes the `dispatch` case to pass `dispatchProfile.profile.executor` — which trivially satisfies executor identity, since the handed executor *is* the frozen one — but nothing on that surface checks `requireFrozenBinding` or verifies the `--agent` id exists in the frozen profile with a matching `executor` field. `bw dispatch --stage <id> --agent <id>` against an implementation-kind stage dispatches even when the frozen executor lacks the `implementation` capability, and accepts an agent id the run never froze.
- **Where:** Task 2, Step 5 (the `dispatch` case bullet).
- **Production impact:** the frozen profile's capability declarations remain advisory on the one surface that is the documented escape hatch; a capability removal that the stages refuse is still spendable through `bw dispatch`, and the paid invocation happens before any deterministic check of what the run froze.
- **Recommended fix:** in the `dispatch` case, after the frozen model resolution, call `requireFrozenBinding(dispatchProfile.profile, dispatchProfile.profile.executor, stage.kind)` and throw its reason, and refuse an `--agent` not present in `profile.agents` with the same wording the stages use (`configured agent ${id} is not in the frozen profile`). Add the reachability test in `test/cli.test.ts`: a run whose frozen executor lacks the stage kind's capability exits 1 naming the capability and spawns nothing.

## High-risk areas

**Risk: the tool-inventory acceptance assumption is unverified, and a silent-ignore failure would defeat the read-only guarantee without failing the smoke**

- **Why:** `plan.md`'s assumptions state "a rejected tool name refuses at CLI startup, before any spend, and the smoke is the authority". That startup-refusal behavior is not verified — the installed CLI's help documents the flags, not the validation of `--tools` values or the `mcp__*` deny pattern. If the CLI silently ignores an unknown tool name (or drops the whole `--tools` value back to the default inventory), the implementer keeps write tools while the executor command still *looks* read-only, and the Task 9 smoke would not necessarily reveal it: the model may simply not write, which is exactly the one-sample lesson this plan's own Task 9 cites.
- **Impact if ignored:** the central guarantee of the correction — a proposal subprocess that cannot mutate the worktree — degrades to the prompt sentence, which the plan itself classifies as UX, not a guard. The cleanliness gate remains as a backstop, but the read-only claim in `ARCHITECTURE.md` section 11 and `docs/hazards.md` entry 15 would rest on an untested flag.
- **Mitigation:** add a decisive probe to Task 9 Step 1, before the full chain: invoke the exact executor command (the `CLAUDE_CODE.command` array plus `--model`) with a prompt asking the model to enumerate its available tools, and assert the response names exactly `Read`, `Glob`, and `Grep`. Treat any deviation as a blocking finding before spending on the full chain. Budget roughly $0.02-0.05. This converts the assumption into evidence and exercises the `--disallowedTools mcp__*` pattern's acceptance in the same invocation.

## Medium and low concerns

- **Old-run behavior is asymmetric and the plan records only the refusal, not the shape.** After the correction, `bw spec` and `bw implement` on a pre-correction run refuse (the old capabilities lack `spec` and `implementation`), while `bw plan` and `bw plan_review` on the same run still pass (`plan` and `review` existed). The assumption states fresh runs are required; a sentence naming the asymmetry would make the recorded behavior complete and prevent a mid-implementation "why does plan work but spec not" investigation.
- **The `mcp__*` deny pattern's acceptance is in the same unverified class as the high-risk finding.** The probe in the high-risk mitigation covers it; if the CLI rejects the pattern loudly instead, the smoke surfaces it before spend. No separate action needed, but the plan's assumption could say so.
- **Task 9's cost range is stated without the verification stage's contribution.** The $0.6-0.9 estimate derives from the recorded attempt, which ended at the implementation block; a passing run adds the verification stage, whose cost is bounded by its configured commands rather than dispatches. The range remains plausible; one sentence attributing the bound would make the budget auditable.

## Missing and underspecified areas

- **The raw dispatch surface's capability and agent binding** (the critical finding) — the plan must either add the checks or state an explicit, reasoned exemption; it currently does neither.
- **Tool-name validation behavior** (the high-risk finding) — the plan assumes loud startup refusal; the probe defines what evidence replaces the assumption.

## Suggested improvements

- Put the inventory probe at the start of Task 9 Step 1 so a read-only failure stops the run before the chain's main spend.
- In the executor regression test, keep the exact `deepEqual` on the command array as written — it is the strongest form of the assertion — and add one comment noting that the array is also the smoke's probe input, tying the unit pin to the real-harness evidence.
- The `-A` ordering test's assertion set (no apply commit, no `-A` file, `after dispatch` message) is the right observable shape; leave it as specified.

---

## Reconciliation

**Date:** 2026-08-31
**Disposition:** 7 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — Critical: raw `dispatch` surface gets no capability or agent binding** (also covers "Missing: raw dispatch binding"): `plan.md` Task 2 Step 5 now calls `requireFrozenBinding` in the `dispatch` case after the frozen model resolution and refuses an `--agent` absent from the frozen profile, both before the prompt-file read; Task 2 Step 2 gains the `test/cli.test.ts` reachability regression (capability-stripped frozen profile exits 1 and spawns nothing); the completion evidence names the raw surface.
- **Accepted — High: tool-inventory acceptance assumption unverified** (also covers "Missing: tool-name validation" and the probe-placement suggestion): `plan.md` Task 9 Step 1 now opens with the tool-inventory probe — the exact executor command plus `--model` with a prompt asking the model to enumerate its tools, asserting exactly `Read`/`Glob`/`Grep`, any deviation blocking before the chain's spend; the assumption is rewritten to say the inventory is verified by the probe, not assumed, and to state that the CLI's rejection of unknown tool names is unverified.
- **Accepted — Medium: old-run behavior asymmetric:** the assumption now names the asymmetry — `spec` and `implementation` refuse on pre-correction runs while `plan` and `plan_review` continue to pass, as the config-freeze consequence, not a defect.
- **Accepted — Medium: `mcp__*` deny pattern acceptance:** the rewritten assumption folds it into the probe's coverage.
- **Accepted — Medium: Task 9 budget attribution:** the budget line now attributes the verification stage's cost to its configured commands and includes the probe.
- **Accepted — Suggested: executor regression comment:** Task 1 Step 1's test comment now ties the exact command array to the Task 9 probe input.
- **Accepted — Suggested: `-A` ordering test left as specified:** the plan already matches the reviewer's recommended assertion set; no edit needed.
