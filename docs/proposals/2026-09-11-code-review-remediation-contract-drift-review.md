# Code-review remediation can replace the approved behavior — review

**Reviewed document:** `code-review-remediation-contract-drift.md`
**Document type:** Design proposal with incident-analysis evidence
**Review date:** 2026-09-11
**Status:** open
**Hazards considered:** 2 (retain findings and publication evidence); 4 (use approved contracts and recorded API responses); 7 (do not retry ambiguous issue creation); 12 (make the GitHub target visible); 16 (route a contract conflict to its owner); 18 (issue creation does not prove code safe to deliver).

---

## Summary

The incident analysis establishes that remediation can violate an approved requirement, but the proposal rejects the requested GitHub-issue behavior and leaves delivery safety and the external mutation undefined.

## Verdict

**Not ready for implementation planning** — The proposal must adopt the GitHub-issue outcome, define a non-delivery terminal state or retain the block, and specify a deterministic trigger and safe publication semantics.

## Critical issues — must fix before implementation

**Issue:** The recommendation contradicts the requested outcome

- **Why it matters:** The requested behavior creates a GitHub issue when remediation conflicts with the approved contract. The proposal instead retains the block and requires an operator-authored follow-up.
- **Where:** `Recommendation`, `Immediate handling`, and `Current capability versus proposed automation`, especially lines 20-25 and 160-164.
- **Production impact:** An implementation plan based on this document preserves the exact behavior the proposal is intended to change and creates no issue.
- **Recommended fix:** Replace the recommendation with a decision sought and proposed GitHub-issue behavior. Add acceptance criteria for the trigger, issue contents, target, authority, resulting run state, and recovery.

**Issue:** Replacing the block has no safe run or delivery outcome

- **Why it matters:** The chain allows `delivery_check` only after a passed `code_review`. Treating issue creation as a pass permits delivery of code that violates the approved contract; creating an issue without a pass or block leaves no valid handoff.
- **Where:** The missing behavior after `Recorded incident` and the statements in `What failed, and what worked` that the deterministic gate correctly blocks.
- **Production impact:** The run either delivers a known regression, stalls in an unmodelled state, or produces state that downstream validation refuses.
- **Recommended fix:** Define the post-publication state. If "instead of blocking" excludes `blocked`, specify a terminal non-delivery outcome and its schema, audit, status, and continuation rules. Issue creation must not satisfy the code-review pass contract or authorize `delivery_check`.

## High-risk areas

**Risk:** The system cannot deterministically recognize the intended scenario

- **Why:** Code-review reports admit only `current_artifact` findings, and identity does not establish semantic continuity across rounds. A final high finding does not prove remediation caused contract drift.
- **Impact if ignored:** The system files issues for ordinary defects, misses true requirement conflicts, or promotes a reviewer's unsupported expectation into product policy.
- **Mitigation:** Define trigger inputs and the actor that classifies the conflict. Bind the approved criterion, remediation commit, prior report, final finding, and reproduced behavior without rewriting evidence.

**Risk:** Remote-write consent, identity, and ambiguous failure remain undefined

- **Why:** The proposal provides no target, credential contract, deterministic marker, deduplication key, or recovery rule for a lost create response.
- **Impact if ignored:** A retry creates duplicate issues, a run publishes into the wrong repository, or publication leaks credentials and retained model output.
- **Mitigation:** Incorporate or supersede the outbound contracts in `github-project-projection-and-upstream-spikes.md`: frozen target, publication authority, least-privilege authentication, stable identity, marker recovery, and typed ambiguous state.

**Risk:** GitHub availability can corrupt the authoritative result

- **Why:** No ordering states when the system records the review result or what happens when GitHub refuses, times out, or succeeds before the local write fails.
- **Impact if ignored:** The run loses its original safety result, reports success without a durable issue, or changes outcome because an optional external service is unavailable.
- **Mitigation:** Keep finding and gate evidence authoritative, make publication separately auditable, and specify confirmed, failed, and ambiguous outcomes.

**Risk:** Issue visibility and content have no trust-boundary rule

- **Why:** The evidence contains specification text, paths, findings, commits, and local references, but the proposal does not define what enters an organization-visible issue.
- **Impact if ignored:** Publication exposes repository details or produces an issue whose local references cannot help its readers.
- **Mitigation:** Define the minimum issue schema, visibility decision, redaction rules, accessible evidence links, and an explicit prohibition on raw model output and secrets.

## Medium and low concerns

- Define whether one issue represents the final finding, the cross-round conflict, or the whole run; this choice controls deduplication and closure.
- State that editing or closing the GitHub issue cannot approve, resume, or mutate the retained run, and identify the fresh-run input that resolves the issue.
- Distinguish final blocking findings from remediation verification failures and infrastructure failures; only the intended contract-drift case belongs to this route.
- Require contract tests from sanitized responses recorded against an authorized GitHub target, including duplicate prevention and ambiguous-create recovery.

## Missing and underspecified areas

- The document lacks acceptance criteria for issue creation, no-issue cases, delivery refusal, GitHub failure, repeat invocation, and issue closure.
- The document does not say whether it amends the binding `code_review` architecture or extends the separate outbound GitHub proposal.
- The document does not define issue title, body, labels, owner, links, evidence retention, or the local remote-ID record.
- The document does not identify the operator decision required when the approved criterion itself needs revision rather than the remediation code.

## Suggested improvements

- Separate the immutable incident analysis from the proposed runtime behavior so evidence remains stable while design decisions change.
- Add a concise state-transition table covering final review, issue publication, run terminalization, delivery eligibility, and fresh-run repair.
- Name the exact architecture sections and prior GitHub proposal clauses this proposal changes, preserves, or supersedes.
