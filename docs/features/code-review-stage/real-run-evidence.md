# Code review stage — real-run evidence

**Status:** awaiting contract evidence
**Plan:** `docs/features/code-review-stage/plan.md` (Task 10)
**Run date:** 2026-09-05
**Hazards considered:** 4 governs why this document exists at all — a hand-written
emitter and the code it feeds can agree while both are wrong, so section 21 makes
a contract test fed by recorded real output the verification category that pays,
and this document records that no such output exists yet for `code_review`. 7
governs the decision not to re-run: the chain, the design, the model, and every
prompt are unchanged, so a second attempt varies nothing systematically. 3 is the
hazard the observed block belongs to, recorded as a proposal rather than fixed
here. 5, 11, 12, 14, 15, 16, and 18 bear on the stage itself and are weighed in
the plan header; this run reached none of the code they govern.

---

## Outcome: the chain blocked upstream, and the panel never ran

One paid run was authorized and executed on 2026-09-05:

```
node .claude/skills/run-buildworks/driver.mjs paid --yes
```

It blocked at `spec_review`, stage 2 of 9, four stages before `code_review`. **No
code-review response exists.** This is not one of the five outcomes Task 10
enumerates — all five assume the chain reaches the stage — so it is recorded here
under its own name rather than rounded into the nearest one.

The plan's status does not advance. The feature is awaiting contract evidence, in
the same standing as Task 10's outcome 1, and for the same reason: the
deterministic tests prove the stage matches its author's reading of the contract,
and nothing yet proves the contract with the provider.

## What the run cost

| | |
| --- | --- |
| Dispatches | 5 |
| Total cost | $0.41049 |
| Model time | 238.6 seconds |
| Target | `bw-run-skill/1788578130692` (retained, not cleaned) |

| # | Agent | Role | Cost | Duration |
| --- | --- | --- | --- | --- |
| 1 | `spec-author` | author | $0.080841 | 39104 ms |
| 2 | `spec-author` | author (self-critique) | $0.0801742 | 54346 ms |
| 3 | `spec-reviewer-traceability` | reviewer | $0.0888288 | 51006 ms |
| 4 | `spec-reviewer-consistency` | reviewer | $0.0409376 | 26957 ms |
| 5 | `spec-author` | author (reconciliation) | $0.11971 | 67147 ms |

Well under the $1.25–$2.50 budget, because the chain stopped early. The budget
figure stands unrevised: it was never tested.

## Why it blocked

The spec panel raised four findings, two of them about an acceptance-criteria
numbering gap (`orphaned-acceptance-criterion-number` and
`acceptance-criteria-numbering-gap`) and two of them upstream against the design
(`upstream:design:contrast-ratio-threshold` and
`upstream:design:accessibility-standards-decomposition`).

Answering the numbering findings, the author's reconciliation revision opened the
`## Acceptance criteria` section with a prose line:

> `Note: AC-012 is intentionally unassigned. No requirement or criterion was`
> `dropped; the ID was reserved in an earlier draft and numbering resumes at`
> `AC-013 so that previously assigned criterion IDs are preserved unchanged.`

`validateSpecDoc` parses every line under that heading as a criterion, so the
explanation of the gap was read as a criterion whose ID is `Note`:

```
spec.reconcile.invalid — spec reconciliation document refused:
invalid acceptance criterion ID Note:
must match ^AC-(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$
```

The stage aborted before writing the revision, so the specification on disk in the
retained target is the earlier self-critique revision and is valid. The refused
document survives only in the retained raw output.

## What this run does and does not establish

**It does not implicate the code-review stage.** Commit `6fb5412` touches no file
in the spec authoring or validation path — not `src/spec-stage.ts`,
`src/spec-doc.ts`, `src/self-critique.ts`, or `src/plan-doc.ts`. The refusing rule
is `validateSpecDoc`'s acceptance-criterion ID pattern, which the commit does not
change. Two independent observations confirm the new code behaved: `new-run`
succeeded, so the freeze-time code-review staffing refusal was satisfied against
the real registry; and the panel's upstream findings were recorded as
`upstream:design:` tokens, so widening `UPSTREAM_SOURCES` with `plan` changed
nothing for the existing sources.

**It does not establish anything about a live code reviewer.** The envelope, the
result shape, the location form a real reviewer gives, and the gate's behaviour
over real findings are all still unverified against the provider. Every claim the
plan makes about them rests on `test/fixtures/harness/emit-code-review.mjs`, which
is a hand-written emitter and therefore cannot define correctness (hard rule 5).

**It did surface a real defect in a shipped stage**, recorded as
`docs/proposals/spec-reconciliation-prose-note-blocks-run.md` and not fixed here.

## The retained evidence

The reconciliation response that caused the block is committed at
`test/fixtures/recorded/spec-reconciliation-web-calculator-numbering-note.json`
with a `provenance` block naming the run, the dispatch time, the capture date,
what was dropped from the harness envelope, and what was sanitized. It was copied
into the repository the moment the proposal came to depend on it, rather than left
in a machine-local target that `driver.mjs clean` deletes wholesale.

That fixture is spec-stage evidence. It is explicitly **not** the recorded
code-review response Task 10 requires, and its provenance block says so, so a
later reader cannot mistake one for the other.

## What would close Task 10

One authorized paid run that reaches `code_review`, with at least one reviewer's
retained raw output committed under `test/fixtures/recorded/` with provenance and
replayed through `extractJsonBody`, `validateAgentResult`,
`validateReviewerReports`, `validateCodeReviewLocations`, and `codeReviewGate`,
asserting the verdict the stage actually recorded — including a refusal, if the
stage refused.

Reaching it requires the spec-stage defect above to be resolved, or a run in which
the author happens not to write a prose note. The second is chance, not a plan.
