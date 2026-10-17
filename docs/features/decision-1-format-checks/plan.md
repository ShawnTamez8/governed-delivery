# Decision-1 Format Checks: Labelled Cases

**Status:** Implemented

**Goal:** Two labelled case sets, built only from committed recordings, that a later evaluation can score Microsoft-Decision-1 against: a grounding check (does a cited excerpt support what its author used it for?) and a narration check (does an Acceptance criteria entry carry the author's remark about the work?).

**Source:** Operator request 2026-10-17: "build labelled cases for prose-mismatch and reasoning-leak checks". The operator named the recurring failures Decision-1 should help with: "a missing back tick, or bracket, or prose that dont match, or reasoning getting passed into the json schema". On 2026-10-17 the operator also stated that data can be sent to the resource for some operator decisions and that there will be many Decision-1 endpoints (`docs/proposals/decision-1-review.md`, "Decisions the operator must make").

**Hazards considered:**
- 1: the extractor already detects a missing bracket or backtick, and prose outside the answer object, deterministically. That text is not a case.
- 3: the narration rule is the section-membership rule the spec author prompt states.
- 4: no case text is written by hand, and every label names its source.
- 13 and 16: the grounding check targets 16's stated gap, an excerpt that occurs but does not support the claim.
- 17: a removed node is not an addition.
- 7: none, because nothing here dispatches.

**Assumptions:**
- **Only two of the operator's four failure kinds are cases.** A missing backtick or bracket makes the body unparseable, which `extractJsonBody` (`src/parse-output.ts`) reports exactly and for free. Decision-1 answers a choice; it cannot supply the missing character. Prose before or after the answer object is the same: the extractor tolerates or refuses it by shape (hazard 1, items 3, 8 and 11). The two remaining kinds need judgment, which is what Decision-1 offers.
- **"Prose that doesn't match" is the grounding check.** Every recorded claim that cites a governing excerpt is a case. That covers a reconciliation's added node and its `grounding.excerpt`, and a code-review reconciler rejection and its `excerpt`. The shipped check proves only that the excerpt occurs, never that it supports the claim (hazard 16).
- **"Reasoning passed into the schema" is the narration check.** The recorded instances are remarks written inside a structured section's entries. The spec author prompt states the rule they break: "Every non-blank line in this section is one criterion and nothing else: no heading, no note, no explanation" (`src/prompts.ts`). Patch replies already arrive through `--json-schema`, so narration around a patch is never parsed (hazard 1, 2026-10-14).
- **Labels are either recorded or proposed.** A recorded label quotes a fixture's provenance or a hazard entry. A proposed label is the assistant's reading, made before any Decision-1 call, and it is not an expected value until the operator confirms it.

**Approach:** `scripts/systemone-format-cases.ts` derives every case from the fixtures by rule, attaches a label from an explicit map, and refuses to load when a case has no label or a label has no case. It also fixes each question's text and options, because a label means something only relative to its question. It builds no request and sends nothing. `test/systemone-format-cases.test.ts` checks the derivation against values from outside the module: the PRD fixture's "three added nodes and one removed node", test 5's "one 214 rejection whose quote was not in the spec", the finding labels fixed before the recorded calls, the numbering-note provenance, and the prompt's own rule text.

**Affected areas:**
- New: `scripts/systemone-format-cases.ts`, `scripts/systemone-format-evaluation.ts`, `test/systemone-format-cases.test.ts`, `test/systemone-format-evaluation.test.ts`, `test/systemone-format-evidence.test.ts` and the result fixture `test/fixtures/recorded/systemone-format-checks-evaluation.json`.
- Changed: no source, schema or prompt.

**Known blockers:** Recorded positives are scarce. The grounding set has 2 recorded does-not-support cases and 1 proposed one among 23. The narration set has 1 recorded contains-remark entry and 2 proposed ones among 131. An evaluation on these sets measures false alarms well and misses poorly. More positives must come from new recorded failures. They cannot be written here (hard rule 5).

**Blast radius:** None outside the two new files. The module imports `extractJsonBody` and the `ChoiceQuestion` type, and its test imports `REPLAY`, `TEST5` and `replayLabels` from `scripts/systemone-d6-evaluation.ts`. Nothing imports the module.

**Verification:** `node --test test/systemone-format-cases.test.ts` (7 tests), `npm run typecheck` and `npm run check:docs`. Six break-its were run on a copy of the module, and each one failed the suite: removals counted as additions, an uncited rejection kept, a label dropped, a keep-labelled finding marked supports, a wrapped paragraph split, and the section rule changed. The module was restored to its copied bytes, compared by SHA-256.

The evaluation script had its own break-its, and each one failed the rule or evidence tests:
- the threshold ignored;
- the spread ignored;
- catches always true;
- false alarms ignored;
- the request state changed;
- the question changed.

The request-state break-it at first slipped past the evidence test, because the hash covered the case's state rather than the request's. `buildRequest` now hashes what the request carries, and the recorded hashes are unchanged.

---

## The grounding set: 23 cases

The state holds the claim, the author's reason and the cited excerpt. An added node that replaced another also shows the replaced text, so only what changed is judged. There are two question texts, one for each kind, and both have the options `supports` and `does-not-support`.

Rejections are each distinct (finding, excerpt) pair the recorded Haiku reconciler calls made, taken from the first call in fixture order. The one rejection whose excerpt is not in the specification (#214) is left out, because the shipped check refuses it.

| Case | Label | Basis |
|---|---|---|
| R-200-1 | supports | recorded: replay labels, reject 200 |
| R-207-1, R-207-2 | either | recorded: replay labels, either 207 |
| R-213-1 | does-not-support | recorded: test 5 result, "a spec sentence about password reset that does not support it" |
| R-213-2 | either | recorded: set 5a, either 213 |
| R-905-1, R-905-2 | supports | recorded: set 5b, reject 905, baseline "Sign-out clears the cookie." |
| R-906-1 | does-not-support | recorded: test 5 result, "a valid but irrelevant quote" |
| A-wc-plan-2-1 | does-not-support | proposed: the excerpt states a light/dark toggle, and the task adds persistence, validation and a fallback |
| A-wc-prd-plan-5-2 | either | proposed: "before first paint" is not in the excerpt |
| A-nk-spec-b-16-1 | either | proposed: the excerpt is the three words "reset a forgotten password" |
| the other 12 additions | supports | proposed: each restates its excerpt or adds only what the excerpt lists |

## The narration set: 131 entries

The narration set has one entry per criterion line under `## Acceptance criteria` in four recorded specifications from four runs. The documents and their entry counts are:
- the web-calculator numbering-note reconciliation: 24;
- the web-calculator list-marker reconciliation: 33;
- the note-keeper changed-locations reconciliation: 52;
- the crew-chatter run 6 approved spec: 22.

A run of non-list lines is one entry. The state holds the section rule and the entry, and the options are `criterion` and `contains-remark`.

| Case | Label | Basis |
|---|---|---|
| N-wc-numbering-L025 | contains-remark | recorded: hazard 3, 2026-09-05; the "Note:" paragraph blocked the run |
| N-wc-numbering-L049 | contains-remark | proposed: AC-022 ends "so the exact threshold is left as an open decision" |
| N-nk-changed-locations-L131 | contains-remark | proposed: AC-051 ends "the specific limit is an open implementation decision not fixed by this specification" |
| every other entry (128) | criterion | proposed |

## Operator confirmations (2026-10-17)

These were given before any request was sent.
- **Labels:** "Confirm as listed". Every label in the tables above is now an expected value, including the proposed ones and the narration default. No label may change after the answers have been seen.
- **Adoption rule:** "D6 rule, T = 0.8". Each check is judged on its own, and a case is flagged when the failure option is chosen with probability at least 0.8. A check passes only when all four clauses hold:
  - validity;
  - determinism: ten identical requests for R-906-1 (grounding) or N-wc-numbering-L025 (narration) choose the same option, with a probability spread of at most 0.01;
  - no correct case flagged;
  - every labelled failure flagged.
  The text is `ADOPTION_RULE` in `scripts/systemone-format-evaluation.ts`.
- **Spend:** "run the paid step". The run is 172 requests: 154 cases once each, plus 9 repeats for each check.

## Tasks

- Task 1: Build the case sets. Done 2026-10-17, as described under Verification.
- Task 2: The operator confirms or amends the labels. Done 2026-10-17: confirmed as listed.
- Task 3: The operator sets the adoption rule and threshold for each check before any request is sent. Done 2026-10-17.
- Task 4: `scripts/systemone-format-evaluation.ts`, modelled on `scripts/systemone-d6-evaluation.ts`, sends the 172 requests one at a time with no retry. It writes `test/fixtures/recorded/systemone-format-checks-evaluation.json`, and an evidence test then reproduces that file's score from the committed code.

## Evaluation record (2026-10-17)

The run sent 172 requests to `Decision-1` (`DataZoneStandard`) on `snitch-resource`, and all 172 returned valid. They used 38,862 input tokens, which is $0.001632. Every response named `microsoft-decision-1`. The record is `test/fixtures/recorded/systemone-format-checks-evaluation.json`, and `test/systemone-format-evidence.test.ts` reproduces its score from the committed code.

**Narration passes** at T = 0.8, on all four clauses.
- All three labelled remarks were flagged: the recorded note at 0.999, AC-022 at 0.980 and AC-051 at 0.835.
- None of the 128 criteria was flagged. Every criterion's probability of `contains-remark` was at most 0.2.
- The ten identical requests for the note all answered `contains-remark` at 0.999. The Brier score is 0.0006.
- At T = 0.9 and T = 0.95 the check fails on catches, because AC-051's 0.835 falls below the threshold. It passes at 0.5, 0.6 and 0.7.

**Grounding fails** at T = 0.8, on determinism and false alarms.
- All three labelled unsupported citations were flagged: R-213-1 at 0.953, R-906-1 at 0.867 and A-wc-plan-2-1 at 0.971.
- Two supported rejections were flagged as false alarms: R-200-1 at 0.924 and R-905-1 at 0.835.
- R-906-1's ten repeats all chose `does-not-support`, but at probabilities from 0.867 to 0.905, a spread of 0.038 against the 0.01 allowed.
- The check fails at every informational threshold.
- One observation only, since the rule judges the check as a whole: the 12 supported additions all passed, while the rejections were flagged almost regardless of label. Splitting the check by kind now, after seeing these answers, would be choosing the rule to fit the result. A rejections-free grounding check would need its own rule, set before a run on new cases.

What this does not show:
- Narration has three positives, two of them assistant-proposed labels the operator confirmed, all from two projects. It measures false alarms well (128 of 128 clean) and catches weakly.
- One sample per case, apart from the two repeated cases.
- Nothing here wires either check into a stage. That needs its own plan and the `ARCHITECTURE.md` section 11 amendment the proposal names.

## Open decisions

- Whether to grow the positive side before evaluating: from new recorded failures as runs produce them, or by replaying the prompts that produced the recorded ones, which is a paid Claude spend.
- Whether the narration check should also cover `## Open decisions` and `## Declared artifacts`. The prompt states a one-entry rule for both, but no recorded entry breaks it.
