# Build a plan in segments, and continue after a failed phase

## The gap

A run builds its plan one phase at a time, ten plan tasks per phase, and
refuses the whole run when the plan needs more than eight phases. When any
phase fails, the run blocks and cannot continue. So two different problems end
a run the same way: a design that is too big, and one bad step in a long
build. In both cases everything already paid for sits on a branch that nothing
in BuildWorks can pick up again.

Two limits are involved, and this proposal touches only one. Ten tasks per
phase exists because one model response cannot carry a whole plan: three
single-dispatch runs failed that way, one with the model itself declining
(hazard 20). That limit stays as it is. The eight-phase ceiling exists only to
bound spend; `src/policy.ts` calls eight "the assistant's value, not the
operator's", and phase 9 asks the model for no more than phase 1 did. The
proposal changes the second limit and never makes a dispatch larger. Whether
ten is itself too big was checked in the stored runs (below): no phase has come
near the response cap of the model that builds.

Hand-splitting a test design, or stopping the run earlier, does not remove
either problem. A stop at spec review blocks the same run sooner. This
proposal changes what BuildWorks does with an over-limit plan and with a
failed phase, so a design of any size can be built, a piece at a time.

**Follow-up, 2026-10-11.** The plan written from this proposal,
`docs/features/implementation-segments-and-pause/plan.md`, differs from it in
four ways, each a flagged assumption for the operator to change: the pause is
narrowed to a segment end and a usage-limit refusal (the malformed-reply pause
and the phase-retry fold-in are left out); the segment size is 8, not 3; the
backstop is 16 phases, not 40; and usage-limit recognition is built first. The
backstop changed because of a limit this proposal did not trace: code review
sends the spec, plan and complete diff in one prompt that is refused over 1 MiB
(hazard 18), and two measured builds put that at roughly 130 to 160 task items.
"A design of any size" is therefore not reachable by segments alone; past that
size the design has to be split into features, which
`docs/proposals/split-a-design-into-features.md` sets out. The decisions below
are unchanged and still the operator's.

## What the records show

| Run | What ended it | Recorded cost | Kind of failure |
| --- | --- | --- | --- |
| team-notes 7 | Phase 4 of 8 proposed changing a file no phase had created | $5.31 | Prompt gap, fixed |
| team-notes 8 | Claude usage limit at phase 2 | $3.44 | One step ends the run |
| team-notes 9 | Phase 2 reply had a raw line break | $4.87 | One step ends the run (that kind is now repaired) |
| team-notes 10 | Typecheck failed at verification, toolchain not installed | $7.30 | Target setup |
| team-notes 12 | Plan refused at 226 lines; counted by items it is 53 and fits | $3.08 | Counting, fixed |
| crew-chatter 2 | Usage limit at phase 6 of 6; lint also failed when checked by hand | $9.63 plus $0.13 | One step ends the run, and target setup |
| crew-chatter 3 | Phase 2 reply had unescaped quotes beyond the repair | $6.46 | One step ends the run |
| crew-chatter 4 | Plan has 86 items against a frozen 80 | $4.94 | Size |

Sources: `.claude/sessions/project-learnings.md` and hazard 20 in
`docs/hazards.md`. Crew-chatter 4 is the only genuine size overflow; run 12
stopped on a counting rule that has since changed. The four "one step ends the
run" rows (runs 8, 9, 2 and 3) cost $24.41 in total and each stopped with its
earlier phases committed on a retained branch.

Two checks made while writing this, both free, from the stored runs:

- Reply size does not explain the malformed replies. Ranking the 21 retained
  implementer replies by size, the three malformed ones are 3rd, 6th and 7th;
  the two largest were valid JSON. A smaller phase would not reliably prevent
  them.
- The response cap is not what stops phases. Hazard 20's 64,000-token failure
  (team-notes run 5) ran on the model `claude-sonnet-5`, whose default output
  cap is 64,000 in the installed CLI's catalog (version 2.1.295). Every later
  implementer dispatch ran on `claude-sonnet-5-5`, whose catalog cap is
  128,000. Of the 20 retained phase replies on that model, all ended normally;
  the largest single response was 98,218 output tokens (team-notes run 10
  phase 5), 77 percent of 128,000, and the next were 91,719 and 77,979. The
  earlier CLI versions' own caps were not read; the observed 98,218 shows they
  were above 64,000. BuildWorks passes no output-token setting, so the CLI
  default applies.
- Reply size follows thinking and tool turns, not the number of files: run 10
  phase 5 returned 5 files in 98,218 tokens and phase 6 returned 1 file in
  6,584. The phase-2 lapses were replies carrying 10, 11 and 11 files. Of the
  11 replies carrying 10 or more files, 3 lapsed; of the 9 with fewer, none
  did. That is a lead (about a one-in-seven chance by luck, noticed after the
  fact), not a result.
- The largest plan-author response measured was 51,929 output tokens
  (crew-chatter run 2), about 41 percent of the 128,000 catalog cap for the
  plan author's model, Opus 5.5. A plan therefore has room to roughly double
  before one reply cannot hold it. [Inference, from one design family.]

## What Archon does

Read on 2026-10-10 from the public repository (README, the ralph-dag workflow,
its story-sizing prompt, the loop and resume documentation). Nothing was run.
The ralph-dag file is marked legacy, with a replacement "sdlc pack" that was
not read. An earlier review of a local Archon checkout from 2026-08-31 is in
`docs/proposals/archon-harness-review.md`; it recorded that a whole app in one
run had never been run here, which is the case this proposal addresses.

- A big idea or PRD becomes a list of small stories (title, acceptance
  criteria, dependencies, a done flag). The prompt says a story must fit one
  pass of about 15 to 30 minutes. Sizing is a prompt rule, not a measurement.
- A loop does one story per pass, each in a fresh session that re-reads the
  story list and a progress file from disk, runs the project's checks, commits,
  and marks the story done. The loop in that workflow stops after 15 passes.
- Every story lands on one branch in one worktree, so later stories build on
  earlier commits and nothing is merged between pieces.
- A failed run resumes with a flag; completed work is skipped. Transient errors
  such as rate limits retry twice. The resume code also carries a scheduled
  resume at a quota reset time; its details were not read.

What not to copy: the agent marks its own story done. BuildWorks' rule is that
agents propose and the system decides, so a piece counts as built only when the
system's own gates say so.

## The proposal

Two linked changes to the implementation stage. Both keep the approved scope,
the plan hash check, the clean-tree checks and the audit chain exactly as they
are.

### 1. Build in segments instead of refusing

The plan is split into phases as today (`planPhases` in `src/plan-doc.ts`; the
split is deterministic and costs nothing). A new frozen policy value,
`implementationSegmentPhases`, says how many phases one consent covers. When the
plan has more phases than one segment, the stage builds one segment and stops
at a clear boundary: "phases 1 to 3 of 9 built, head abc123; run again to
continue." The operator consents to the next segment separately, so each
spend is small and visible. The refusal at the old ceiling goes away. A much
larger frozen total (`implementationMaxPhases`, kept as a backstop) still
refuses a plan before any spend, because section 20 says every limit needs a
defined behaviour on breach.

Everything stays on the one run branch, so the second segment builds on the
first segment's commits. No second design document, no extra model call, and
no merge.

### 2. Continue after a failed phase, for named causes only

The stage keeps one stage row, left unfinished (an executing stage holds the
store's default `pending` status; the run stays `in_progress`), and the existing
`implementation.phase.apply` audit events (each names the phase, its base and
its head) are the cursor. A later invocation continues at the next phase after
checking that:

- the worktree head equals the head in the last `phase.apply` event;
- the worktree is clean;
- the plan hash, the spec hash, the approval and the frozen profile are
  unchanged;
- the run is inside its duration limit.

Only failures where the dispatch produced nothing applied become pauses:

- a usage-limit refusal, recognised by the shape both recorded refusals share
  (see `docs/proposals/usage-limit-refusal-strands-a-run.md`, option B). The
  pause records the reset time and the refused attempt's raw cost;
- a reply that is not valid JSON after the existing one-time repair. The
  continue sends a different prompt, with the refusal and the two escaping
  rules stated, as hazard 7 requires. This is the phase-retry plan in
  `docs/features/implementation-phase-retry/plan.md`, folded into the same
  mechanism, with its frozen attempt count bounding how often one phase may be
  tried across all continues.

Everything else stays terminal and blocks the run as today: a scope violation,
a refused patch, a dirty tree, a failed gate, an empty delivery. Those mean the
trust boundary or the plan is wrong, not that the clock or the model slipped.

### What the operator sees

A pause is a human boundary like approval, so the command exits 3 and says what
was built and what the next consent would cover. This is a sketch, not a
recorded output:

```
implementation paused after phase 6 of 9: 60 of 86 tasks built, head <sha>.
Cause: segment complete.   (or: usage limit, resets 12:50 pm; $0.13 refused attempt)
Next: bw run --run N  -> phases 7 to 9, at most 3 implementer dispatches.
```

## Where it changes the code

Callers of `runImplementationStage`: `src/cli.ts` (the `implement` command) and
`src/run-command.ts` (the `run` loop). Verified by search.

- `src/implementation-stage.ts`: delete the ceiling refusal (lines 212 to 219),
  keep the backstop; allow an existing unfinished implementation row to be
  continued instead of refusing "already has an implementation stage"; turn the
  recoverable failures into a pause that leaves the stage unfinished and the
  run `in_progress`; `abort` stays for the terminal ones.
- `src/operator-state.ts`, `prefixAction`: today every stage must be `passed`,
  so an unfinished stage reads as "interrupted or inconsistent" and a blocked
  run offers no next group. [Verified by reading lines 257 to 279.] The one
  needed exception: the last row may be an unfinished `implementation` stage
  when it has at least one `phase.apply` event and no abort event after it.
  This is the part that weakens the "intact chain" rule, so it needs the
  tightest tests.
- `src/run-command.ts`, `expectedBoundary`: today an implementation group must
  add exactly one passed stage. It must also accept "no new stage, and the
  cursor advanced".
- `src/operator-output.ts`: the consent preview shows the implementation
  ceiling as the frozen maximum phases; it becomes the segment size.
- `src/policy.ts` and `src/profile.ts`: new frozen fields. Changing the frozen
  profile shape makes every earlier run's profile unusable by name (hard rule
  3). Run 4 is already dead, so nothing live is lost.
- Not traced yet: how the dashboard and `status` project an `in_progress`
  implementation stage, and how `verify-audit` treats the new events.
- Documents that state the old rules and must change with the code: sections 5,
  19 and 20 of `ARCHITECTURE.md`, hazard 20, hazard 7's exception, and the
  "Phased implementation" paragraph of `CLAUDE.md` and `AGENTS.md`.

## What this does not fix

- Target setup (run 10, crew-chatter 2's lint failure). A separate problem.
- A spec or plan too large for one author reply. No run has shown it, and the
  largest plan reply used about 41 percent of its cap (above), so a design
  roughly twice crew-chatter's should still fit. If it happens, the design must be split into separate
  runs, which needs a decomposer. That is a later decision and is not
  proposed here.
- Chaining separate runs. A run's worktree is made from the commit frozen at
  `new-run`, which is the checkout's `HEAD` (`resolveStartingCommit` in
  `src/profile.ts`; the worktree is created at that commit in
  `src/implementation-stage.ts`). So a later run could start from an earlier
  run's branch tip with no merge, by checking that branch out first. Not
  tried. Spec and plan authors read the checkout, not the worktree, so they
  would see the earlier code only if it is checked out.

## What would settle it, without a paid run

Each case uses recorded evidence and a stand-in model, so it costs nothing:

1. Crew-chatter run 4's plan (86 items, 9 phases) is accepted and split into
   segments. It needs a fixture extracted from run 4's plan first; that is not
   in the repository yet.
2. Crew-chatter run 2's refusal stream
   (`test/fixtures/recorded/crew-chatter-run-2-session-limit-refusal.json`)
   after five committed phases leaves a paused run, and a continue builds phase
   6 only, ending at the right head.
3. Crew-chatter run 3's malformed reply
   (`test/fixtures/recorded/crew-chatter-run-3-phase-2-malformed-json.json`)
   pauses, and the continue sends the varied prompt.
4. A scope violation, a refused patch and a dirty tree still block and cannot
   be continued.
5. A continue is refused when the head moved, the tree is dirty, or the plan
   or profile hash changed.
6. `prefixAction` and `expectedBoundary` accept the paused state and still
   refuse a tampered chain. Each guard gets a break-it check: change the
   behaviour, see the test fail, restore.

No paid run until all six pass. The first paid proof would be one new run whose
plan needs more than one segment, with the operator's consent per segment.

## Decisions for the operator

1. Reverse "a failed phase blocks the run" and "no general mid-stage recovery"
   (sections 19 and 20) for the two named causes, and replace the old refusal
   with segments. Without this decision nothing here may be built.
2. The numbers. Suggested starting values, mine and unmeasured: phase size 10
   tasks (unchanged), segment 3 phases (30 tasks per consent), total backstop
   40 phases. Smaller segments mean more consents and smaller bills.
3. Fold the phase-retry plan into this, rather than building it first. Building
   it alone would change the frozen profile twice.
4. Whether the usage-limit recognition (option B in the existing proposal)
   ships first as its own small change. It is needed by this work either way.

## Considered and rejected

- **Stop at spec review.** Blocks the same run sooner; nothing then handles the
  design.
- **Hand-split the test design.** Proves nothing about BuildWorks.
- **Raise the ceiling.** Moves the wall; one failed phase still loses every
  earlier phase.
- **Archon's "the agent marks its own story done".** Breaks the principle in
  section 1.
- **Chained runs now.** Needs a decomposer and re-pays the spec and plan for
  each piece. Later, if a plan ever outgrows one reply.

**Hazards considered:** 7 (a retry that resends the same prompt is not a retry:
the continue after a malformed reply varies the prompt; after a usage limit the
cause is the clock, and the exception is written down), 20 (phases and the
ceiling this changes), 1 item 10 (the one repair stays and runs before any
pause), 2 (a refused attempt's stream and cost are retained and named, not
discarded), 19 (a dispatch that exceeds the idle budget is not classified as
recoverable here), 14 (the independent review of the build, when it comes).

Related: `ARCHITECTURE.md` sections 5, 7, 19 and 20,
`docs/features/phased-implementation/plan.md`,
`docs/proposals/archon-harness-review.md`.
