# A usage-limit refusal ends the run and strands what it already built

## The gap

When the claude.ai usage window runs out in the middle of a paid range, the
refused dispatch fails in seconds and BuildWorks treats it like any other failed
dispatch: the stage completes blocked, the run blocks, and nothing resumes it.
The work already paid for stays on a branch nobody can continue from inside the
system. The operator's question on 2026-10-07 was whether to live with that or
make BuildWorks handle it. This proposal sets out what "handle it" could mean,
smallest first.

## What was observed

| Run | Date | Where it stopped | Recorded run cost at the stop |
| --- | --- | --- | --- |
| note-keeper run 4 | 2026-09-26 | a plan reviewer, HTTP 429 | not recorded here |
| team-notes run 8 | 2026-10-04 | implementation phase 2 | $3.4449324 |
| crew-chatter run 2 | 2026-10-07 | implementation phase 6 of 6 | $9.634060 |

crew-chatter run 2 is the measured case. Phases 1 to 5 were committed on
`gov/crew-chatter/2` and delivered all 51 declared paths; phase 6 was refused.
The retained stream is
`test/fixtures/recorded/crew-chatter-run-2-session-limit-refusal.json`. It shows:

- The previous dispatch's stream (phase 5, 853 seconds) carried five-hour
  `allowed_warning` events at utilization 0.90, 0.91, 0.92 and 0.94, with
  `surpassedThreshold` 0.9. Earlier phases' streams carried none.
- The refused dispatch ran for 2999 ms. It made two tool calls (a file read and
  a search), then a `rate_limit_event` with `status: "rejected"` and
  utilization 1.01 arrived, followed by a synthetic assistant message, "You've
  hit your session limit · resets 12:50pm (America/Chicago)".
- The final `result` line has `is_error: true`, `api_error_status: 429`,
  `api_error: "usage_limit_reached"`, `terminal_reason: "api_error"` and
  `total_cost_usd` 0.1291114 (31,405 cache-creation tokens). Every rate-limit
  event carries `resetsAt` as epoch seconds.
- The store recorded only "1 failed attempt with unknown spend". `dispatchOnce`
  writes an `agent.dispatch.failed` audit event and no `agent_run` row on a
  non-zero exit (`src/dispatch.ts`), and nothing reads the cost from a failed
  stream. The $0.1291 exists only in the retained file.

team-notes run 8 is the second recorded refusal
(`test/fixtures/recorded/team-notes-run-8-session-limit-refusal.json`, claude CLI
2.1.289; crew-chatter's is 2.1.292). It was refused at once: 340 ms, no tool
calls, `total_cost_usd` 0. Its result line has **no `api_error` field**. The two
streams agree on: a result line with `is_error: true`, `api_error_status: 429`
and `terminal_reason: "api_error"`; a `rate_limit_event` with `status: "rejected"`
before the synthetic assistant message; and that message carrying
`error: "rate_limit"`. A rule keyed on `api_error: "usage_limit_reached"` alone
would have missed run 8.

The 2026-10-04 record of run 8 in `.claude/sessions/project-learnings.md` reads
"unknown spend" as $0. That held for run 8 and not for crew-chatter run 2: a
refusal is not always free, and it can arrive after a stage has already produced
committed work.

## Why the run cannot continue today

- `runImplementationStage` treats every failure as terminal: its `abort` helper
  completes the stage blocked and sets the run blocked, and the stage's own
  comment says so (`src/implementation-stage.ts`).
- `ARCHITECTURE.md` says it twice. Section 19: "No general mid-stage recovery
  ... is introduced", and partial chains "are not general resume points". The
  phased-implementation text: "A phase that fails blocks the run with no retry,
  and the commits of earlier phases stay on the branch as evidence."
- A second implementation stage is refused by name (the chain already holds
  one), and so is an existing worktree path.

The pieces a resume would need do exist: each completed phase writes an
`implementation.phase.apply` audit event naming its base and head, the worktree
and its commits survive a block, and the phase split is deterministic
(`planPhases` in `src/plan-doc.ts`), so phase k+1 is computable from the plan
and the audit alone.

## Options, smallest first

**A. Do nothing; change the operating practice.** Split a long paid range with a
consent per piece, as was done for crew-chatter run 2 (plan alone, then
implementation and verification), and start a long range only with headroom in
the window. Limits what one hit strands; recovers nothing; costs nothing to
build. The window is shared with the operator's interactive session, which a
BuildWorks run cannot see.

**B. Recognise the refusal and say so, with no lifecycle change.** When a
non-zero exit's retained stream ends in a result line with `is_error: true` and
`api_error_status: 429` and holds a `rate_limit_event` with `status: "rejected"`
(the fields both recorded refusals share), the failure summary says so, with the
rejected event's `resetsAt` time, its window type and the raw `total_cost_usd`,
beside the existing "exited with code 1". The stage's block message is that same
text, so it carries the cause too. It changes one function, `dispatchOnce`'s
failure summary, plus a read of the stream (`parseEnvelope` reads the last line for
successes; it does not read `is_error` or `api_error_status`). It fixes the two
honesty gaps above (the hidden $0.1291 and the unnamed cause) and recovers
nothing. Naming the committed phases and the branch is left out: the stage's
`phase N of M:` prefix already says where it stopped.

**C. Pause instead of block, implementation stage only.** On the same
recognition, do not call `abort`. Leave the run `in_progress`, append
`implementation.phase.paused` naming the phase, the reset time and the
refused attempt's cost, and return a distinct result that `bw run` reports as a
human pause (exit 3 is today's human-pause code). A later `bw
run` resumes at the next phase after checking that the worktree head equals the
head in the last `implementation.phase.apply` event, the tree is clean, the plan
and profile hashes are unchanged, and the run is inside its duration limit. One
refused dispatch costs up to about $0.13 per pause and the resumed phase is
dispatched fresh. This is the change that would have kept crew-chatter run 2's
$9.63 usable.

What C would have to be decided against:

1. The invariants quoted above. It is a replacement decision for section 19's
   "no general mid-stage recovery" and for "a phase that fails blocks the run",
   scoped to one named external cause. The operator authorized no such thing,
   and no deferred stage inherits any authorization (`CLAUDE.md`).
2. Hazard 7 and the architecture's "a retry that resends an identical prompt is
   not a retry". The distinction C relies on: the refused dispatch produced no
   output, and its cause is the clock, not the prompt. A resumed phase sends the
   same prompt, which is the case the rule warns about, so the exception must be
   written down, not implied.
3. Unverified: how `prefixAction` and the run snapshot treat a stage left
   `in_progress` with no process running, and what the dashboard shows for it.
   Both read stage rows (`src/operator-state.ts`) and neither has been traced for
   this state.
4. Scope. Spec, plan and their reviews hold no durable intermediate state: the
   author, self-critique, panel and reconcile steps run inside one function
   call, so pausing them is a redesign, not an `abort` swap. Their losses have
   been $1 to $4. Not proposed.
5. Recognition must be exact. Only the shape both recorded refusals share counts:
   a failed result line with status 429 together with a rejected `rate_limit_event`.
   A bare 429 does not: both samples have the rejected event, and a 429 without it
   has not been observed here, so nothing says it means the usage window. An
   expired login ("Failed to authenticate") fails the same way
   and is also an environment fix, but folding it in widens the exception; keep
   it a separate decision.

**D. Pause at a phase boundary on a warning, before the refused dispatch.**
Phase 5's stream warned from 0.90 to 0.94 before phase 6 started. Stopping
between phases when the last stream's utilization is at or above a threshold
would avoid the refused attempt and its $0.13. It needs C's resume path to be
useful, adds a policy constant (frozen at run start, hard rule 6), and the
threshold is a guess: one run shows 0.94 two phases from the cliff; no run shows
how much a phase consumes. Do not build D without C, and not before measuring
what a phase costs in window terms.

## Recommendation

B now: it is small, needs no new decision, and fixes what is wrong in the
record today (an unknown-spend failure that was a known $0.13, and an opaque
exit code). C only as a separately decided change, because it overturns a stated
invariant, and only for implementation. A stays in force meanwhile. The
operator decides B and C separately.

## What would settle it

For B: a test that feeds each recorded refusal stream to the failure path and
asserts the summary names the cause, the reset time and the cost, then fails when
the recognition is removed. The expected values come from the fixtures, not from
this document. For C: replay the two stranded implementation runs (team-notes run
8 at phase 2, crew-chatter run 2 at phase 6) through the proposed resume checks
and say what each check would have decided.

Related: `docs/hazards.md` entries 2, 7 and 20, `ARCHITECTURE.md` sections 12 and
19, `.claude/sessions/project-learnings.md` (the 2026-10-04 and 2026-10-06 to
2026-10-07 records), `docs/features/phased-implementation/plan.md`.
