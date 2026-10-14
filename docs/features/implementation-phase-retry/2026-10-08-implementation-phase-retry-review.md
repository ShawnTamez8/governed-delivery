# Implementation phase retry plan — review

**Reviewed document:** `plan.md`

**Document type:** Plan

**Review date:** 2026-10-08

**Hazards considered:** 1, 2, 3, 4, 7 and 20. Hazard 7 (retries that vary nothing) governs the plan and bears on high-risk area 1. Hazard 4 (fixtures and code agreeing while both are wrong) bears on high-risk area 2. Hazard 3 (a constrained field must have its constraint stated in the prompt) bears on the medium concern about the negative pin. Hazard 1, item 10 bears on the retry scope concern. Hazard 2 (discarded output is undiagnosable) bears on the observability concern. Hazard 20 is the entry the plan amends. Hazards 5, 6, 8 to 19 and 21 are not design inputs for this review.

---

## Summary

The plan adds a frozen per-phase attempt count and an attempt loop that redispatches a phase whose reply the parser refuses, with a prompt that states the refusal. The mechanics are specified to the level of exact audit strings, test cases and break-it mutations, and the code claims this review checked against the repository hold (one description in Task 4 is imprecise; see the low concerns). The weak points are outside the mechanics: the plan has no rule for judging whether the retry works, it writes measured figures into a current-tier document without committing their evidence, and its retry condition is wider than the evidence behind it.

## Verdict

**Ready for planning after required changes.** No critical issue exists: following the plan as written produces the behavior it describes. Two high-risk areas need plan edits before the build starts, and both edits are text changes plus one fixture extraction. The medium concerns can be folded in during the build.

## Critical issues — must fix before implementation

No critical issues found.

## High-risk areas

**Risk:** The plan defines no success criterion or stop rule for the retry, and its benefit rests on two unmeasured assumptions

- **Why:** The `Known blockers` section marks as unknown whether the notice raises the chance that attempt 2 parses and whether lapses are independent between attempts. The verification section then states what a green result proves (the loop, the bound, the variation, the narrowness) and what it does not (that attempt 2 parses with a real model). Nothing states what result from a real run keeps the feature, changes the setting, or reopens the transport decision. The retained evidence also gives a lead against independence. The three strict-parse failures all occurred in phase 2 replies, in the import file `import.ts` (team-notes run 9), the export file `exportService.ts` (crew-chatter run 2) and the attachments `routes.ts` (crew-chatter run 3). Of the 20 file-carrying replies in the scan, 5 were phase 2 replies and 3 of those failed the strict parse; none of the other 15 did. The grouping was found after the failures were known, so it is a lead and not a result, and whether the content of a file triggers the lapse is unknown. If it does, attempt 2 writes the same code and lapses at the same place, and each failed retry costs a full phase.
- **Impact if ignored:** The first paid run that triggers a retry produces an outcome nobody has agreed how to read. Arithmetic on the loose one-in-twenty rate (n of 20) shows the range the decision covers: a six-phase run dies with probability about 26 percent today; at a retry success rate of 0.9 it drops to about 3 percent, at 0.5 to about 14 percent, and at 0 it stays at 26 percent while each failure adds about one phase of spend. The plan cannot say which of those worlds it is in, and the operator's "Lets go with the retry" chose a mechanism, not an expected outcome.
- **Mitigation:** Add a short section to the plan that states, before any paid run, how the first retried phases are read and what each reading changes. For example: record, for every retried phase, whether attempt 2 parsed and whether its first error fell in the same file as attempt 1; keep the default of 2 if at least one retried phase parses on attempt 2; set the value to 1 and reopen options (a) and (d) from the learnings entry if two retried phases refuse again in the same file. The operator picks the thresholds. Add the reply length to the `implementation.phase.retry` summary (the stage already holds `resultText`), so the run record carries the second number the reading needs. Task 5 records the rule in the learnings file.

**Risk:** Task 5 writes measured figures into `docs/hazards.md` while the evidence for two of the three incidents stays machine-local

- **Why:** `CLAUDE.md` requires recorded evidence to be copied into the repository the moment it becomes load-bearing. The plan commits the run 3 reply and relies on the committed team-notes run 9 fixture. It does not extract crew-chatter run 2 phase 2, the reply the repair rescued, which is the evidence for the plan's claim that a repairable reply never reaches the retry and one of the three counted failures. It also does not preserve the scan that produced "3 of 20" and "1 of 20". The raw reply sits under the crew-chatter target's `.governance/raw/2`, which a new clone or the deletion of that target removes. Task 5 then tells the implementer to write those counts into hazard 1, item 10 in a `current`-tier document, which the checker holds to the standard that its claims are true.
- **Impact if ignored:** A current-tier hazard entry states a measurement no teammate can reproduce or inspect. `CLAUDE.md` records that leaving evidence outside the committed tier already cost this repository a decision (`docs/proposals/durable-knowledge-tiers.md`).
- **Mitigation:** Add a step to Task 3 that extracts crew-chatter run 2 phase 2 into `test/fixtures/recorded/` with a provenance block (run, dispatch time, capture date, what was dropped), plus a test in `test/recorded-implementation-response.test.ts` that `JSON.parse` rejects it with the control-character error and `extractJsonBody` accepts it and validates it as an `AgentResult`. Keep the scan as a script under `scripts/` with a header stating that it needs the target repositories' `.governance/raw` directories, or change the Task 5 wording to name the three incidents with their fixtures and to state the denominator as "measured on one machine on 2026-10-08, not reproducible from the repository".

## Medium and low concerns

- **Medium: the retry condition is wider than the evidence.** The stage retries on any `extractJsonBody` refusal. That includes `expected exactly one JSON block, found N` and `no JSON object found in output`, which a prose answer or a duplicated fence produces. The plan's assumption says "the cause is the measured one", which holds for one refusal in the retained data. A scan of all 189 retained replies with the real extractor shows 184 completed normally, the extractor refuses one of them (crew-chatter run 3), and the other five refusals are API-error replies that fail at `dispatchOnce` before any parse. The notice's content is about escaping, so for the other refusal kinds it is irrelevant. Restrict the retry to refusals whose reason ends in a `JSON.parse` message (the `is not valid JSON:` forms), with a test that a prose-only reply and a two-fence reply block after one dispatch, or state the wider scope in `Assumptions` as a choice and add the same two tests so the choice is pinned.
- **Medium: the attempt count has no ceiling.** Task 1 declines a ceiling by analogy with `implementationMaxPhases`. The analogy does not hold: phases bound the work, while attempts multiply spend on a repeated failure. The code-review fields pair a floor and a ceiling (`CODE_REVIEW_MAX_ROUNDS_CEILING` is 5) so that any frozen profile stays inside a bound the consent preview can state. A frozen value of 50 passes `invalidPolicyReason`, permits 50 paid replays of a deterministic failure per phase, and makes the preview print 400. Add an absolute ceiling (3 is enough for the mechanism the plan tests) enforced in `invalidPolicyReason`, with the same zero, too-large and non-integer cases.
- **Medium: retries are invisible in operator output.** `status` prints only the last recorded event for a blocked run, and a completed run shows a larger `agentRows` count and nothing else; `recordedFailedAttempts` stays 0 by design. An operator finds a retried phase only by querying the audit table. Task 5's runbook step says the events exist but gives no query. Add the exact `SELECT` to the runbook row, and list retried phases in `formatGuidedTerminal` as one line, which `src/operator-output.ts` already builds from the snapshot.
- **Medium: `ARCHITECTURE.md` section 19 keeps a sentence the new behavior appears to contradict.** Section 19 says "an unsuccessful group is never retried in that invocation". The plan's `Assumptions` resolve this (the group is the stage; a dispatch inside it repeats), but Task 5 only adds a sentence after the identical-retry paragraph and leaves the group sentence unqualified. A reader of the design sees a rule and an exception in different paragraphs. Make the Task 5 sentence say that a retried phase is a dispatch inside a group, not a retried group.
- **Medium: the negative pin on the first prompt encodes an open decision as a requirement.** Task 3 test (d) asserts the first prompt does not contain `double quote`. Hazard 3 says a constraint the model must obey belongs in the prompt, and the recorded failure broke exactly that constraint, so the omission is itself the defect hazard 3 describes. A test that fails when someone states the rule makes the correction harder, not deliberate. Resolve open decision 2 before the build (an operator call), or replace the assertion with a comment in `buildImplementationAuthorPrompt` that names the decision and its date.
- **Low: Task 4 test (e) names the wrong failure.** The mode description says the reply has "no `proposedPatches` array and no `summary`". `validateAgentResult` makes `proposedPatches` optional and requires a non-empty `summary` (`src/agent-result.ts`, the `AgentResult summary must be a non-empty string` check), so only the missing summary refuses. State that, so a later reader does not believe a missing patch list fails validation.
- **Low: Task 6 does not rerun `npm run check:docs`.** Task 5 runs it, but Task 6 follows it and the full suite takes about eleven minutes during which a document can drift. Add the command to Task 6's list so the final report states a clean checker after the last edit.

## Missing and underspecified areas

- **The reading rule for the first paid run.** The plan needs the pass, keep and revert conditions described in the first high-risk area. Without them the plan has no definition of done for the feature, only for the code.
- **Which refusal kinds retry.** The plan needs one sentence in `Assumptions` that names the `extractJsonBody` refusal reasons the retry covers and the ones it does not, and a test for each side.
- **The exact notice wording.** Task 3 fixes four of the five notice lines and describes the fifth. The tests assert two phrases (`double quote`, `line break`). Fix the fifth line's wording in the plan, because the report quotes the rendered notice and the operator reads it as the plan's variation.
- **The audit query for retries.** The runbook step and the learnings entry need the exact `SELECT` that lists retried phases and their reasons.
- **Where the retried attempt's raw file is.** Each attempt retains its own raw stream and `agent_run` row, but nothing in the retry event names the pair. The plan should state that the operator matches them by the stage's `agent_run` order, or add the `agent_run` id of the refused attempt to the event.

## Suggested improvements

- Add the reply length (characters) to the `implementation.phase.retry` summary. The first paid retry then records the size of the reply that lapsed, which the second high-risk area's evidence lacks.
- Commit the scan as a script under `scripts/` and cite it from the hazard entry, so the next machine can repeat the measurement and the entry's denominator stops being a one-machine claim.
- List every file the build edits in the final report, with the hash pair for the two files that must match (`CLAUDE.md` and `AGENTS.md`), so the operator reviews one list before deciding what to commit.
- State in the plan that a frozen value of 1 reproduces today's refusal text byte for byte, and keep test (d) as the proof. The plan says this in Task 4; the `Approach` paragraph should say it too, because it is the plan's rollback.

---

## Reconciliation

**Date:** 2026-10-09
**Disposition:** 12 accepted, 0 rejected, 1 deferred, 0 open
**Status:** reconciled

The review lists 18 items (2 high, 7 medium and low, 5 missing, 4 suggested). Overlapping items share one verdict, so 13 verdicts follow. The operator answered the five judgment calls on 2026-10-09: set the reading rule now, retry only replies that are not valid JSON, cap attempts at 3, state the double-quote rule in the first prompt, and add the query and the `agent_run` id without a terminal line. Reconciling edited `plan.md` only; no source file, fixture or document outside this feature folder changed, and nothing was spent.

### Verdicts

- **Accepted — No success criterion or stop rule for the retry (high); The reading rule for the first paid retry (missing); Add the reply length to the summary (suggested):** the plan has a new section, "Reading the first paid retry", with the operator's thresholds: keep 2 attempts if at least one retried phase parses on attempt 2, set the constant to 1 and reopen the two unchosen options if two retried phases are refused again in the same file, and change nothing otherwise. The retry event now carries the reply length. The rule does not decide a mixed history (one phase parsed, two others refused again in the same file); the section says the operator reads that case.
- **Accepted — Task 5 writes measured figures while the evidence stays machine-local (high):** Task 3 now extracts crew-chatter run 2 phase 2 into a new fixture under `test/fixtures/recorded/` with a provenance block and a test, and Task 5 states the scan as a one-machine measurement and names the three incidents with their fixtures. The extraction is a plan step and has not been done: the raw directory was listed on 2026-10-09 and holds 16 files, but the phase 2 reply has not been identified.
- **Accepted — The retry condition is wider than the evidence (medium); Which refusal kinds retry (missing):** the plan retries only a refusal whose reason contains ` is not valid JSON: `. Assumptions name the refusals that do not retry, Task 4 adds the `prose-at-phase` and `two-fences-at-phase` modes with tests (j) and (k), and break-its (9) to (11) pin the coupling to the wording in `src/parse-output.ts`. That file is unchanged.
- **Accepted — The attempt count has no ceiling (medium):** Task 1 adds `IMPLEMENTATION_PHASE_ATTEMPTS_CEILING = 3`, enforced in `invalidPolicyReason`, with cases for 4, 50 and 3 and two more break-its.
- **Accepted — Retries are invisible in operator output (medium); The audit query for retries (missing); Where the retried attempt's raw file is (missing):** the runbook row gets the exact `audit` and `agent_run` queries, and the retry event names the refused attempt's `agent_run` id. The review's `formatGuidedTerminal` line was not adopted at the operator's choice; revisit it if the queries prove too awkward after the first paid retry.
- **Accepted — `ARCHITECTURE.md` section 19 keeps a sentence the new behavior appears to contradict (medium):** the Task 5 sentence says a retried phase is a dispatch inside one execution of a group, not a retried group, and the blocker list names the section 19 sentence it leaves standing.
- **Accepted — The negative pin on the first prompt encodes an open decision (medium):** the operator decided open decision 2. Task 3 adds the double-quote sentence to `buildImplementationAuthorPrompt`, test (d) asserts the first prompt carries it, and the decision moves into Assumptions. Open decisions are renumbered 1 to 4. The remediation prompt is unchanged.
- **Accepted — Task 4 test (e) names the wrong failure (low):** the plan now says only the missing `summary` refuses a result, because `proposedPatches` is optional.
- **Accepted — Task 6 does not rerun `npm run check:docs` (low):** Task 6 runs it again after the full suite.
- **Accepted — The exact notice wording (missing):** Task 3 fixes the fifth notice line, which contains both phrases test (d) asserts.
- **Accepted — List every file the build edits, with the hash pair (suggested):** Task 6 lists every edited or created file with the `CLAUDE.md` and `AGENTS.md` hashes.
- **Accepted — State in the Approach that a value of 1 reproduces today's refusal text (suggested):** the Approach now says so and names the one difference, the added sentence in the first prompt.
- **Deferred — Commit the scan as a script under `scripts/` (suggested):** the scan reads the raw directories of other repositories on this machine, so a script in this repository would not run from a clone and would not make the denominator reproducible. Task 5 states the denominator as a one-machine figure instead. Revisit if the rate is cited as more than a lead or a second machine can repeat it.
