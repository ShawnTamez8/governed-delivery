# Spec-review severity varies across runs with no configuration difference

**Observed:** 2026-09-26, six sequential `new-run` chains against the
note-keeper target repository (`C:\Users\Shawn-work\repositories\testing-repos\note-keeper`),
all built from the same frozen profile shape and the same `design.md`/PRD at
commit `c32c6908d49b07c0969fbbe01945c652d3e7678d` (runs 3-6; runs 1-2 predate
that commit's last two design amendments but changed nothing the three
findings below depend on). Run 6's blocking cost was $1.0984362, 5/5 agent
rows cleanly reported, 0 failed attempts — a clean stop, not an error.

**Hazards considered:** 7 ("Retries that vary nothing") is the one this
bears directly on, and this finding is evidence against its stated premise
for review-panel dispatches: it says "a retry that resends an identical
prompt receives identical output. If a retry does not vary the prompt, the
context, or the model, it is not a retry." Runs 5 and 6 gave the reviewer
role near-identical input (same PRD, same model, same reviewer prompt, and —
for two of the three findings below — spec text that discloses the same gap
in almost the same words) and got different severity/blocking verdicts back.
Whatever is producing that difference (sampling temperature, extended
thinking, or something else not visible in the retained envelope — the raw
responses show `thinking_tokens` in the thousands, so these are not
zero-temperature calls), it means "identical prompt and model" does not
imply "identical output" for this dispatch class, and hazard 7's remedy
("refuse the unkeepable promise" / don't bother retrying without varying
something) may need a narrower claim if this repository ever automates a
retry of a review-panel dispatch specifically. 14 ("Independence that cannot
be proven") was considered and is not what this is about: that hazard is
process separation (subagent-in-session vs. a separately spawned process),
which every dispatch here already satisfies regardless of which model ran;
this finding is about sampling variance *within* an already-independent
dispatch. 3, 11, 12 were considered and do not apply — this is not a
schema/parsing constraint, a staffing shortfall, or a cross-target
configuration difference.

## What happened

The same category of undecided upstream question — access control for a
full-collection export archive, content-type/content-disposition handling
for non-image attachment downloads, and password-reset token security
properties — surfaced across five of the six runs, at inconsistent severity,
via two different code paths:

| Run | export-archive access control | attachment content-type/disposition | password-reset token security | Outcome |
|---|---|---|---|---|
| 1 | — | — | raised, `follow_up` (non-blocking) | blocked on an unrelated rich-text-sanitization finding |
| 2 | — | — | raised, severity=**medium** | blocked — but on a **reconciler defect**: "reconciliation decision for finding 22 is missing changedLocations" |
| 3 | raised, severity=**high** | raised, severity=**medium** | raised, severity=**medium** | blocked — but on a **different reconciler defect**: "finding 31 is upstream_blocking without a proposal candidate" |
| 4 | — | — | — | blocked on an agent crash at `plan_review`, unrelated |
| 5 | not raised (already closed — see below) | not raised | not raised | passed `spec_review` cleanly |
| 6 | raised, severity=**high** | raised, severity=**high** | raised, severity=**high** | blocked cleanly via three valid proposals (7, 8, 9) |

Runs 2 and 3 never reached a clean gate decision on these findings at all —
both blocked on the reconciler emitting a decision shape the run engine
refused, a separate defect from the one this proposal is about (see "Note on
a separate defect" below). Only runs 1, 5, and 6 reached a real gate
decision, which is why the comparison below is between run 5 and run 6.

Model configuration was checked directly and ruled out as the cause:

- Every run's frozen `modelMap` used `claude-sonnet-5` for every stage,
  confirmed by reading `.governance/profiles/<run>/profile.json` for runs 1-6.
- The security reviewer's raw dispatch envelope (`.governance/raw/<run>/...json`)
  was compared field-by-field between run 3 and run 6: identical
  `canonicalModel`, `provider`, `contextWindow` (1,000,000), `maxOutputTokens`
  (64,000), `service_tier`. `requestedModel` equalled `effectiveModel` in both
  — no silent fallback.
- `src/prompts.ts` was diffed against its working-tree state at both dispatch
  times; the only uncommitted changes on this branch touch unrelated
  dashboard-approval prompt text (zero matches for
  spec/security/export/attachment/password/token). The last *committed*
  change to `prompts.ts` was 2026-09-17, nine days before any of these six
  runs.

## Two kinds of variance, and only one of them is a content difference

**Author-stage variance (real, but narrow).** Run 5's ownership acceptance
criterion explicitly enumerated `"notes, folders, tags, attachments, export
jobs, and preferences"` — the spec author had added *export jobs* to the
protected-resource list specifically to close the export-archive gap. Run
6's equivalent criterion reads `"notes, folders, tags, attachments, and
preferences"` — export jobs is missing. That is a genuine drop in the
generated artifact between two runs from the same source document, and it is
plausibly why the security reviewer flagged export-archive access control in
run 6 when it did not need to in run 5 (run 5 had already closed the basic
ownership gap; the remaining question there was only whether the archive's
*aggregate* exposure warranted more than ownership, which is a legitimately
different, smaller question than "is there any access control at all").

**Reviewer-stage variance (the harder one).** For the other two findings,
there is no comparable content difference to point to. Run 5's spec and run
6's spec both explicitly defer the same two questions to the design stage,
in nearly identical wording:

- Run 5: *"leaves three security-relevant decisions open rather than
  inventing obligations the PRD does not state: content-type and
  content-disposition handling..., password-reset token security
  properties..."*
- Run 6: *"leaves three security-relevant decisions to the design stage...
  content-type and content-disposition handling..., password-reset token
  security properties..."*

Run 5's `spec_review` panel never raised either topic as a finding at all —
it raised three unrelated things (sign-in rate-limiting, defining the
"preferences" resource, an artifact-shape question), all routed `follow_up`
(non-blocking), and passed. Run 6's panel raised both of these as `high`
severity, `upstream_blocking`, and blocked. Same model, same reviewer role,
same disclosed gap, same input text — a different judgment call on a second
sampling.

This is the part a spec-writer fix cannot reach: the spec already disclosed
the uncertainty as clearly in run 5 as in run 6. What changed was not the
artifact the reviewer read; it was the reviewer's own verdict on reading it.

## Note on a separate defect (not this proposal's subject)

Runs 2 and 3 surfaced a distinct, real bug while gathering the evidence
above: the reconciler can emit a decision the run engine refuses to accept —
run 2's finding 22 was reconciled without a required `changedLocations`
field, and run 3's finding 31 was classified `upstream_blocking` without the
required proposal candidate. Both corrupted the run via a validation error
(`spec.reconcile.invalid`) rather than a clean `spec.gate.block`. This is
worth its own proposal; it is named here only so the evidence trail is not
lost, not analyzed further in this document.

## Candidate remedies

No remedy has been chosen. These are not symmetric in cost or in what they
actually fix — the split above matters when picking one, since a remedy
aimed at author-stage variance does nothing for reviewer-stage variance and
vice versa.

1. **Do nothing structural; treat this as the cost of LLM-based review.**
   The architecture already keeps every review record, so an operator can
   inspect exported proposals (`bw proposal-export`) before deciding whether
   a blocking verdict is worth acting on. Costs nothing to build; leaves the
   inconsistency exactly as observed, including the possibility that a real
   gap goes unflagged the way it did in run 5.
2. **Sample the severity call more than once and take the more severe (or a
   majority) verdict**, specifically for classification/severity rather than
   for the finding's existence — e.g., dispatch the same reviewer twice (or
   the panel's security lens twice) and require agreement before a finding
   is allowed to pass as non-blocking. Directly targets reviewer-stage
   variance; roughly doubles the cost of every review round it applies to.
3. **Deterministically escalate a fixed list of security-relevant upstream
   categories** (export/bulk-access archives, attachment content-serving,
   authentication-token properties, ...) regardless of what severity the
   reviewer assigns — a code-level rule, not a model judgment. Removes the
   coin-flip for exactly the categories on the list; does not generalize to
   a category nobody thought to list, and turns a judgment call into a
   maintained enumeration.
4. **Widen the security lens's panel seat count** (more than one reviewer
   scoring the same lens, per round) so a single sampling swing has to be
   corroborated before it changes the gate outcome. Same shape as option 2
   but implemented as panel composition rather than repeated dispatch; costs
   more per round the same way.
5. **Close the one real author-stage gap directly**: tie the ownership
   acceptance criterion mechanically to the PRD's data-model table (every
   entity carrying a `user_id` gets enumerated, rather than trusting the
   author to remember it every time). Fixes the export-jobs omission
   specifically; does nothing for the other two findings, which were never a
   completeness problem.
6. **`docs/features/stage-role-model-overrides/plan.md`** (proposed
   separately, same investigation) lets the reviewer role run on a different
   model than the author — named here because it was the operator's first
   instinct, but it does not resolve this proposal's finding on its own: a
   different model is just a different sample, and there is no evidence a
   cheaper or more expensive model would land more consistently rather than
   simply shifting which way the coin lands.

## Evidence

- Frozen profiles: `.governance/profiles/<1..6>/profile.json` in the
  note-keeper target, each showing `modelMap` entries of `claude-sonnet-5`
  for every stage.
- Raw dispatch envelopes: `.governance/raw/3/2026-09-26T07-35-49-788Z-1b480f8ab7c6.json`
  (run 3's `spec-reviewer-security`, agent_run 14) and
  `.governance/raw/6/2026-09-26T21-52-40-781Z-17a32c46fee0.json` (run 6's
  `spec-reviewer-security`, agent_run 36), compared field-by-field.
- Spec content by run: captured via `git stash` before each subsequent
  `new-run` cleared the working tree — `stash@{2}` (run 3's leftover
  `spec.md`), `stash@{1}` (run 4's), `stash@{0}` (run 5's), and the working
  tree at the time of this write-up (run 6's, still uncommitted). All four
  are recoverable with `git stash list` / `git stash show -p <ref> --
  docs/features/note-keeper/spec.md` in the note-keeper repository.
- `git log --oneline --all -- docs/note-keeper-prd.md docs/features/note-keeper/design.md`
  in the note-keeper repository shows the design document's actual history;
  `design.md` and the PRD were confirmed near-identical by direct read.

## Scope

This is a finding about the `spec_review` stage's behavior, discovered while
diagnosing why a note-keeper test run blocked. Nothing here has been
changed. It is closely related to, but broader than, the reviewer-model
experiment in `docs/features/stage-role-model-overrides/plan.md`: that plan
makes the reviewer's model configurable, which this proposal's evidence
suggests is not, by itself, a fix for the variance described here.
