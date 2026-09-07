# Code review stage — real-run evidence

**Status:** recorded — two chains reached the stage and both blocked on correct `high` findings; three reviewer responses are committed and replayed (Task 10 outcome 4, legitimate half). No chain has yet completed past `code_review`.
**Plan:** `docs/features/code-review-stage/plan.md` (Task 10)
**Run dates:** 2026-09-05 (blocked upstream, below) and 2026-09-06, twice (both reached the stage)
**Hazards considered:** 4 governs why this document exists — a hand-written
emitter and the code it feeds can agree while both are wrong, so section 21
makes a contract test fed by recorded real output the verification category
that pays; both reviewer responses are now committed and replayed. 1 governs
the two envelope shapes observed live, bare JSON and a single fence, both
already in the extractor's enumeration. 7 governs the decision not to re-run:
the block is a legitimate result and a repeat would vary only the sample. 6
and 12 govern the gate: the frozen threshold `high` and the frozen order were
what the stage indexed, and the block is the gate doing the job it was built
for. 16 was weighed and did not fire — no reviewer classified a finding
upstream, so the `blocking_dependency` proposal path is still unexercised live.
5, 11, 14, 15 and 18 bear on the stage and were weighed in the plan header. 3 is
the entry the earlier upstream block belonged to and is closed in its own
feature.

---

## Outcome, 2026-09-06: the chain reached `code_review` and the panel blocked

One paid run was authorized and executed on 2026-09-06 (dispatches dated
2026-09-07 UTC), after the extractor fix under
`docs/features/unfenced-json-extraction/plan.md` cleared the stage-1 block of the
run before it:

```
node .claude/skills/run-buildworks/driver.mjs paid --yes
```

Seven stages passed — `spec`, `spec_review`, `awaiting_approval`, `plan`,
`plan_review`, `implementation`, `verification` — and the eighth,
`code_review`, blocked. The driver reports it as `10/14 steps as expected`: the
`review` step expected exit 0 and got the block's exit 1, and the three
delivery steps after it could not run. **A block is a result, not a driver
failure** (the plan's Step 1 says so), and it is Task 10's outcome 4.

| | |
| --- | --- |
| Dispatches | 13 |
| Total cost | $1.15759 |
| Stages | 7 passed, `code_review` blocked, `delivery_check` never created |
| Run status | `blocked` (terminal; a fresh run is the repair, section 12) |
| Target | `bw-run-skill/1788742310835` (retained, not cleaned) |
| `claude` binary | 2.1.263 (Claude Code) |

| # | Stage | Agent | Role | Cost | Duration |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | `spec-author` | author | $0.02987 | 17039 ms |
| 2 | 1 | `spec-author` | author (self-critique) | $0.07261 | 42117 ms |
| 3 | 2 | `spec-reviewer-traceability` | reviewer | $0.03567 | 15720 ms |
| 4 | 2 | `spec-reviewer-consistency` | reviewer | $0.05410 | 27385 ms |
| 5 | 1 | `spec-author` | author (reconciliation) | $0.02924 | 9381 ms |
| 6 | 4 | `plan-author` | author | $0.02712 | 19973 ms |
| 7 | 4 | `plan-author` | author (self-critique) | $0.07466 | 52713 ms |
| 8 | 5 | `spec-reviewer-traceability` | reviewer | $0.10114 | 50266 ms |
| 9 | 5 | `spec-reviewer-consistency` | reviewer | $0.05992 | 45064 ms |
| 10 | 4 | `plan-author` | author (reconciliation) | $0.05454 | 28990 ms |
| 11 | 6 | `implementer` | author | $0.22464 | 130502 ms |
| 12 | 8 | `code-reviewer-correctness` | reviewer | $0.27779 | 160266 ms |
| 13 | 8 | `code-reviewer-security` | reviewer | $0.11628 | 29350 ms |

The two code-review seats cost $0.39407 together, inside the $0.25–$0.35 the
plan estimated only because the security seat was cheap; the correctness seat
alone was $0.27779, with 13,899 thinking tokens over 160 seconds. The whole
chain came in under the $1.25–$2.50 budget because neither review needed a
second round.

**Model identity.** Every dispatch reports `claude-sonnet-5` as the effective
model, with `claude-haiku-4-5-20251001` appearing as an auxiliary harness query
on each.

## What the panel did

The stage created stage 8 over `cede449f..539d1ba3` with the panel
`code-reviewer-correctness+code-reviewer-security`, four changed paths
(`index.html`, `src/calculator.js`, `src/styles.css`, `src/theme.js`), the
frozen threshold `high` and the frozen order `low, medium, high, critical`.

**`code-reviewer-correctness`** returned bare JSON — hazard 1 shape 1, no fence
— carrying two `current_artifact` findings, both `high`, both located as
`path:line` inside the changed set:

- `src/calculator.js:97` (`backspace-overwrite-clears-entire-entry`): when
  `overwrite` is true, immediately after an operator or equals, backspace
  resets the entry to `0` instead of removing one character, against AC-010.
- `src/styles.css:17` (`operator-button-insufficient-contrast`): the light
  theme's `--operator-bg #ff9500` under `--operator-text #ffffff` is roughly
  2.2:1, below WCAG AA, against AC-019.

**`code-reviewer-security`** returned an `AgentResult` inside a single
` ```json ` fence — shape 2 — with an empty findings array and a summary of what
it checked (`textContent` not `innerHTML`, the persisted theme value validated
against an allowlist, no external or constructed script sources).

The stage recorded findings 2 and 3 (the `finding` table is shared across
stages; finding 1 is the plan review's), and the gate blocked:

```
code_review.gate.block — code_review gate blocked over cede449f..539d1ba3;
panel=code-reviewer-correctness+code-reviewer-security; findings=2; blocking=2;
threshold=high; finding=2; severity=high; cause=severity;
location=src/calculator.js:97; finding=3; severity=high; cause=severity;
location=src/styles.css:17; proposals=none
```

`verify-audit` validated the chain including that event. The record is at the
target's `.governance/code-review/1/result.json` and `report.md`; no proposal was
raised, because no finding was classified upstream.

## The findings read against the code

Task 10's outcome 4 turns on whether the reviewer was right. Both findings were
read against the verified worktree:

- **Backspace.** `src/calculator.js:97-103` is exactly as reported: the
  `overwrite` branch assigns `'0'` and returns. AC-010 reads "removes the most
  recently entered character." After `1 2 +`, the display shows `12` and
  backspace shows `0`; after `= 15`, backspace shows `0`, not `1`. The code
  does what the reviewer says and the criterion says otherwise. A reasonable
  author could argue that an entry committed by an operator has no "most
  recently entered character" to remove — but the specification does not say
  that, and the reviewer graded against the specification it was given.
- **Contrast.** `src/styles.css:17-18` sets `#ff9500` on `#ffffff` for the
  light theme's operator buttons. That pair is about 2.2:1; WCAG AA asks 4.5:1
  for normal text and 3:1 for large text. AC-019 reads "sufficient contrast in
  both dark and light themes." The dark theme's operator pair (`#ff9f0a` on
  `#1a1a1a`) is fine; the light theme's is not.

Both findings are correct, both cite the criterion they violate, and both were
graded `high` against a threshold of `high`. **The stage did its job on its
first live run.** This is the legitimate half of outcome 4: a success of the
gate, not a defect in it, and it completes Task 10. Whether `high` is the right
grade for a contrast ratio is a rubric question the operator may take up later;
nothing here says it was wrong.

## What the run establishes

- **The envelope and result contract with the provider, live, for both shapes
  the two reviewers chose** — bare JSON and a single fence.
- **The finding contract, live:** a real reviewer returned `severity`,
  `classification`, `location`, `intentKey` and `subject` in the shapes the
  shared validator accepts, with severities from the frozen vocabulary.
- **The location contract, live:** both locations are `path:line` with a
  positive integer line inside the changed set. The plan named a line range, a
  column, or a parenthetical as the likeliest first live refusal; none
  occurred. Two findings from one reviewer is a small sample and says nothing
  about frequency.
- **The gate, live:** two findings at the threshold blocked with
  `cause=severity`, the run ended `blocked`, the record and report were written,
  and the audit chain holds.
- **The freeze-time staffing check and the delivery refusal:** `new-run`
  seated the panel against the real registry, and `deliver` refused with
  `run 1 is blocked, not in_progress`.

## What it does not establish

- **The `upstream` route.** No reviewer classified a finding as `upstream:plan:`,
  so the `blocking_dependency` proposal path has never run live.
- **The pass path over real findings.** Below-threshold findings did not occur;
  the pass path is exercised live only by the empty security panel.
- **Delivery after code review.** `delivery_check` was never created, so the
  post-`code_review` delivery read of `last.output_ref` is proved only by the
  deterministic suite.
- **Anything about a repaired run.** Section 12 says a fresh run is the repair.
  None has been authorized; the two findings stand as the reason this chain did
  not complete.

## The committed evidence

Both responses were copied into the repository before anything else was done
with the target, sanitized only of absolute machine paths (none were present in
either envelope), with the per-machine envelope fields dropped:

- `test/fixtures/recorded/code-review-web-calculator-correctness-two-high-findings.json`
- `test/fixtures/recorded/code-review-web-calculator-security-empty-fenced.json`

Each carries a `provenance.stageContext` block — the changed paths, the frozen
severities and threshold, the patch range, and the verdict and blocking entries
the stage recorded — read from the run's own `result.json` rather than retyped.
`test/code-review-stage.test.ts` replays both through the chain the stage runs:
`extractJsonBody`, `validateAgentResult`, `validateReviewerReports` with the
plan upstream prefix, `validateCodeReviewLocations` against the recorded changed
paths, and `codeReviewGate` with the recorded threshold and order, asserting
the recorded verdict. The replay was proved by breaking the gate (`>=` to `>`,
so a finding at the threshold no longer blocks) and the location validator
(negation inverted); each failed exactly the correctness replay and left the
security replay green, which is the correct shape — an empty panel is
indifferent to both, and the test says so in its name.

## Outcome, 2026-09-06, second chain: blocked again at `code_review`, on a different defect

The operator authorized a fresh run the same day, the repair section 12
prescribes for a block. Thirteen dispatches, $1.40170, target
`bw-run-skill/1788745293903` retained. The same seven stages passed — the spec
panel raised one `medium` finding (the criteria over-restricted operations to
two operands, absent from the design) and the plan panel one `medium` finding
(no task wired the buttons' click handlers); both were `addressed` in one round
— and `code_review` blocked again.

| # | Stage | Agent | Cost | Duration |
| --- | --- | --- | --- | --- |
| 11 | 6 | `implementer` | $0.32080 | 188084 ms |
| 12 | 8 | `code-reviewer-correctness` | $0.34662 | 187293 ms |
| 13 | 8 | `code-reviewer-security` | $0.07989 | 22662 ms |

The implementer wrote a different calculator this time and the correctness
reviewer found a different defect: at `src/calculator.js:166` the keydown
handler's `Enter` case calls `equals()` without `e.preventDefault()`, so when a
keypad button holds focus — the ordinary state after a mouse click — the
browser's native Enter-activates-button behaviour also fires that button's
click, appending a digit or re-arming an operator immediately after the result.
Graded `high` against AC-014, "the Enter key is equivalent to selecting the
equals button." Read against the worktree, the finding is correct: the `/` case
three lines above calls `preventDefault()` and the `Enter` case does not. The
security reviewer again returned an empty findings array. Both responses this
time carried a sentence of prose before a single fence — hazard 1 shape 3, the
third envelope shape seen live from a code reviewer.

```
code_review.gate.block — findings=1; blocking=1; threshold=high; finding=3;
severity=high; cause=severity; location=src/calculator.js:166; proposals=none
```

The correctness response is committed at
`test/fixtures/recorded/code-review-web-calculator-correctness-enter-double-activation.json`
and replayed by the third replay test in `test/code-review-stage.test.ts`; the
security response is not committed, since the first run's empty-panel fixture
already anchors that shape and this one adds only the prose prefix.

**What two blocks in a row say.** Both are the legitimate half of outcome 4:
the code was wrong as the reviewer said, and both defects are the kind a
correctness reviewer exists to catch — an off-by-one state reset and an
unhandled default action, each contradicting a numbered criterion. Neither run
implicates the stage. What they do show is that on this design, with this
implementer and this threshold, a single-shot implementation has not yet passed
review, so no chain has completed since `code_review` was added. Section 12
deliberately built no remediation round; whether one is wanted, or whether the
threshold should sit at `critical` for a first delivery, is a product decision
recorded here and not taken. Repeating the run a third time varies only the
sample (hazard 7).

## Outcome, 2026-09-05: the chain blocked upstream, and the panel never ran

The first authorized run blocked at `spec_review`, stage 2 of 9, after five
dispatches for $0.41049 (`bw-run-skill/1788578130692`). The spec panel raised
four findings, two about an acceptance-criteria numbering gap, and the author's
reconciliation answered them with a prose line at the top of
`## Acceptance criteria`, which `validateSpecDoc` read as a criterion whose ID is
`Note`. That defect belongs to the spec stage and is closed under
`docs/features/spec-section-membership/plan.md`; its response is committed at
`test/fixtures/recorded/spec-reconciliation-web-calculator-numbering-note.json`.
The run did not implicate the code-review stage — commit `6fb5412` touches no
file on the spec path — and two positive observations survived it: `new-run`
succeeded against the real registry, and the panel's upstream findings were
recorded as `upstream:design:` tokens, so widening `UPSTREAM_SOURCES` with `plan`
changed nothing for the existing sources. The run after it, on 2026-09-06,
blocked at stage 1 on the extractor and is recorded under
`docs/features/plan-coverage-single-artifact/real-run-evidence.md`.
