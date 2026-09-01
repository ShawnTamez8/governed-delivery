# Step 5b Task 1: bounded prototype evidence and exit decision

**Status:** recorded; result and amendment accepted by the operator 2026-09-01

**Hazards considered:** 1 (every real result went through the shipped
`extractJsonBody` and `validateAgentResult` path plus the prototype's own
validators; twelve dispatches, zero refusals, and the deliberately malformed
shapes are refused by construction), 3 (the panel-request, classification,
upstream-location, disposition, grounding, and proposal constraints were all
stated in the prompt that requested them, and the one constraint that was
deliberately *not* stated — which specialties exist — is the one the author
got wrong), 4 (the constructed checks are written against the contracts, so
they cannot establish correctness; each of the nineteen guards was therefore
broken in a scratch mirror and its check confirmed to fail, and every
substantive claim below comes from real model output rather than a fixture),
7 (round 2 was a fresh panel and a fresh reconciliation with independently
retained reports, not a redispatch of round 1), 11 (the default installation's
two-seat panel was staffed from the frozen registry, and an unstaffable
request blocked by name — which is exactly what happened on the first
attempt), 12 (the prototype reads no production configuration and wrote no
profile; panel bounds and required specialties were passed in explicitly),
13 (the author added an acceptance criterion the design never stated and
marked it `addressed` — recorded below as the run's most important negative
result), and 14 (self-critique ran as its own dispatch and never occupied a
panel seat). Entries 2, 5, 6, 8, 9, 10, and 15 were not exercised: the
prototype retains every prompt and raw byte before parsing, produces no
delivery, spawns through the shipped harness unchanged, runs no hooks, pins
no model alias, and starts no proposal subprocess.

---

## What ran

A scratch harness outside production stage order, driving the real `claude`
binary through the shipped executor definition, the shipped `invokeHarness`,
`parseEnvelope`, `extractJsonBody`, and `validateAgentResult`. Storage was
scratch JSON. `STAGE_SEQUENCE`, the canonical schema, and both shipped stages
were untouched, and nothing under `src/` was modified.

The bundle — harness, prompts, every prompt and raw response, and the derived
state — is preserved outside this repository at
`../step5b-task1-prototype` (441 KB, uncommitted). It is not scratchpad
state: it survives the session that produced it.

The subject was a deliberately incomplete design document for an
activity-log export command, carrying two decisions the design explicitly
declines to make (a retention window and an actor-email redaction policy) and
an explicit `## Out of scope` section naming localisation and access control.

**Phases, in order:** draft → self-critique → baseline panel on the draft →
round-1 panel on the self-critiqued specification → reconciliation →
round-2 panel → reconciliation → a targeted grounding probe. The same two
reviewers, with the same prompts, saw both the draft and the self-critiqued
specification, so that comparison varies only the artifact.

## Cost

Twelve dispatches, **$0.59543**, 430 s of dispatch time, `claude-sonnet-5`
requested and effective on all twelve. This overran the $0.25–$0.45 estimated
before the run: the self-critique and reconciliation dispatches cost
$0.070–$0.091 each rather than the ~$0.03 estimated from prior per-stage
records, because they carry the design, the full artifact, and every
per-reviewer report in one prompt.

| # | Dispatch | Cost | Duration | Prompt | Parse |
|---|---|---|---|---|---|
| 01 | spec-author draft | $0.02066 | 9.6 s | 2168 B | ok |
| 02 | self-critique (registry not named) | $0.07399 | 60.0 s | 4885 B | ok |
| 03 | self-critique (registry named) | $0.06989 | 62.8 s | 5043 B | ok |
| 04 | baseline panel — traceability | $0.03224 | 16.1 s | 4449 B | ok |
| 05 | baseline panel — security | $0.04076 | 36.2 s | 4407 B | ok |
| 06 | round 1 — traceability | $0.02713 | 16.6 s | 4566 B | ok |
| 07 | round 1 — security | $0.03434 | 26.3 s | 4524 B | ok |
| 08 | reconciliation, round 1 | $0.06957 | 43.6 s | 7002 B | ok |
| 09 | round 2 — traceability | $0.02360 | 14.9 s | 4819 B | ok |
| 10 | round 2 — security | $0.07826 | 53.0 s | 4777 B | ok |
| 11 | reconciliation, round 2 | $0.09057 | 74.9 s | 7641 B | ok |
| 12 | grounding probe | $0.03442 | 15.7 s | 6484 B | ok |

**Zero parse failures across all twelve.** No envelope, JSON-extraction,
`AgentResult`, reviewer-report, panel-request, or reconciliation validation
refused a real response.

## The eight comparisons

| # | Comparison | Result |
|---|---|---|
| 1 | Draft versus self-critiqued findings | 3 canonical findings on the draft, **4** on the self-critiqued specification, from the same two reviewers with the same prompts. Self-critique returned 4 critique entries and a valid revised artifact. **No reduction observed.** |
| 2 | Two specialty findings that agree | **Not observed.** Across 9 canonical findings the two reviewers never shared a canonical identity: 9 findings, 9 reports, no pairs. |
| 3 | Conflicting reports differing in severity and classification | **Not observed**, for the same reason. Proven only by constructed checks. |
| 4 | Same concern by two reviewers, and again in a later round | **Not observed as a repeated identity.** Round 2 raised the redaction concern again at the *same* location (`upstream:design:actor-email-redaction-policy`) with a *different* `intentKey`, so it became a separate canonical finding rather than a round-2 recurrence. |
| 5 | Non-blocking upstream concern | **Observed**, findings 4, 6, 7, 9 — `upstream_follow_up` with complete proposal candidates and derived impact `follow_up`. |
| 6 | Blocking upstream dependency | **Observed**, findings 2 and 3 — `upstream_blocking`, complete candidates, derived impact `blocking_dependency`, gate blocked naming both ids. |
| 7 | Rejection grounded against the supplied design | **Not observed in the natural flow** — no `rejected_with_rationale` in 9 decisions. The targeted probe produced two, and exposed the defect below. |
| 8 | Malformed or incomplete reconciliation output | **No real dispatch produced one.** Refusal behaviour is proven by 58 constructed checks and 19 break-and-restore proofs, not by real output. |

## Parser and validator results

- **Real output:** 12/12 dispatches parsed and validated. Six upstream
  findings all used the exact `upstream:design:<decision-key>` token on first
  attempt; no reviewer invented a design heading for an omission. Both panel
  requests were well-formed integers plus unique kebab-case specialty lists.
  Every upstream decision carried a complete title, problem statement, and
  upstream explanation. No decision returned an `impact` field.
- **Constructed:** 58 checks covering malformed, duplicate-specialty,
  over-capacity, missing-proposal, misplaced-conditional, unknown-disposition,
  incomplete-reconciliation, and unmatched-grounding shapes — all refused with
  a named cause.
- **Break and restore:** 19 guards each removed or inverted in a scratch
  mirror, each confirmed to make its own check fail, each restored green.
  Three did not detect their break on the first sweep: two were unrealistic
  mutations that crashed the checker rather than loosening the guard, and one
  was a genuine defect — `mergeCanonical` deduplicated within a single call,
  so dropping `round` from the identity changed nothing observable. It now
  resolves against the findings already stored for the stage, which is the
  `upsertCanonicalFinding` semantics Task 7 specifies.

## What the prototype changes about Tasks 4 through 10

**A. The self-critique prompt must name the registered specialties (Task 4).**
Not told what the registry can seat, the author requested
`["requirements-traceability", "data-privacy"]`. The request was structurally
valid and unstaffable, and the run blocked by name. Told the registry, the
same author requested `["security"]`, which staffed. The named staffing
refusal in Task 5 is correct and must stay, but without the registry in the
prompt it becomes the ordinary outcome rather than the backstop. Task 4 must
supply the frozen registry's specialty list to the self-critique prompt.

**B. Exact-match grounding must collapse whitespace, not only CRLF and BOM
(Task 6).** The probe's author cited the design correctly — `any operator who
can run the command may export any project` — but that sentence is
hard-wrapped and the quotation spans the line break. Under `normalizeText`
alone the literal match failed, the sound rejection became
`cannot_determine`, and the gate blocked for a human. Every governing
document in this repository is hard-wrapped, so this is the common case, not
an edge one. The plan's wording — matching "after the same normalization the
document validator uses" — is insufficient and must be corrected to collapse
runs of whitespace. Re-evaluating the *same* stored model output under the
corrected matcher turned both probe rejections into matches with no further
spend. The guarantee is unchanged and still narrow: the words occur, in that
order, in the governing input; nothing about logical support.

**C. `intentKey` is not stable across rounds, so `(round, intentKey,
location)` cannot detect recurrence (Tasks 7 and 9).** Round 1's
`pii-exposure-in-export` and round 2's `pii-exposure-redaction-undecided` are
the same concern at the same location. Round-scoping still does its job —
later evidence cannot overwrite earlier evidence — but Task 9's step
"have the same intent/location recur in both rounds" cannot be demonstrated
with real output and must be written as a fixture test. Nothing in the plan
should imply the system detects semantic recurrence.

**D. The gate must read every round's decisions, not the current round's
(Task 9).** Round 1 routed a block on findings 2 and 3. Round 2, over its own
five findings, routed advance. A per-round gate would let a later round erase
an earlier `upstream_blocking`. The plan says the gate blocks on
`upstream_blocking` but never states the evaluation is over all rounds; it
must.

**E. `addressed` let an invented obligation into the artifact (Task 10,
hazard 16).** Responding to a security finding about a time-of-check
/time-of-use gap, the author added this acceptance criterion and marked the
finding `addressed`:

> The existence check for `--out` and the write to it are performed as a
> single atomic exclusive-create operation, so no process can create the file
> at that path between the check and the write.

The design says only that the command "refuses when `<path>` already exists,
and writes nothing". It contains no atomicity or concurrency requirement —
confirmed by search, not by reading. The no-invention sentence in the
reconciliation prompt did not prevent this, the artifact gate passed, and no
mechanical check can detect it. This is the plan's stated residual risk with
a recorded observation attached, and it belongs in hazard 16's entry as such.

**F. One author's disposition for one concern was not stable across rounds.**
The redaction omission was `upstream_blocking` in round 1 and
`upstream_follow_up` in round 2. In production the round-1 block ends the
stage, so this pair cannot both occur in one run; it is recorded because it
is direct evidence that the semantic disposition is author judgement, not a
property of the concern.

## What one sample cannot support

- No claim about how often self-critique reduces findings. This sample shows
  an increase, 3 to 4, and one sample is not a rate in either direction.
- No claim that two reviewers commonly report one concern. They never did
  here. With a two-seat panel of disjoint specialties and a specialty-only
  reporting boundary, report pairs may be structurally uncommon, which makes
  the pair-preservation requirement cheap insurance rather than a frequent
  path. Tasks 6 and 7 must keep proving it by fixture.
- No claim that malformed model output is rare. None occurred in twelve
  dispatches; that is one observation, and the fail-closed handling stays
  proven by construction.
- No claim about semantic correctness of any disposition. Finding E is one
  invented obligation caught by reading, and reading does not scale.

## Exit decision

The design direction is **confirmed**: the five-value disposition vocabulary,
the panel-request shape, the canonical-finding / immutable-report /
one-decision split, the conditional proposal candidate with derived impact,
and the `upstream:design:<decision-key>` token all survived real output with
no parse failures and no fusion. Both upstream routes occurred naturally with
complete candidates.

The design is **not confirmed as written**: revisions A, B, C, and D above
are required to Tasks 4, 6, 7, and 9 before production work starts, and E
must be recorded in hazard 16 rather than described as a theoretical risk.
No `repair_target`-style column is justified — nothing in the run identified
an enforced or audited consumer for one.

**This document records the prototype result only.** Architecture sections 12
and 13 are unamended, and Tasks 3 through 9 do not start, until the operator
accepts this result and the sections 12 and 13 amendment, which the plan
requires to land first.
