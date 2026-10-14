# Split a design too big for one run into features that run one after another

## The gap

BuildWorks builds one design as one run. Three limits bound how big that design
can be, and the two nearest are not about the implementer:

1. **The code-review prompt.** Every reviewer gets the approved spec, the approved
   plan, the changed paths and the complete diff in one prompt, and a prompt over
   1 MiB is refused before it is sent (`PROMPT_MAX_BYTES` in `src/harness.ts`;
   hazard 18: "refused rather than reviewed in part"). Two retained builds
   measured 327,327 bytes of diff for 51 task items (crew-chatter run 2) and
   309,676 bytes for 57 (team-notes run 10), which is 5.4 to 6.4 KB of diff per
   item. With the spec and plan added, one prompt fills at roughly 130 to 160
   task items. **[Inference, two builds.]**
2. **One author reply for the spec and one for the plan.** The largest plan reply
   measured was 51,929 output tokens, about 41 percent of its model's 128,000
   cap (crew-chatter run 2), so a plan has room to roughly double.
   **[Inference, one design family.]**
3. **The spend backstop** on implementation phases, a frozen policy value that
   `docs/features/implementation-segments-and-pause/plan.md` would raise.

The segments plan moves limit 3 and, with its review-size check, makes limit 1
fail early and with numbers instead of late and silent. It cannot move limit 1.
A design that needs 300 task items cannot be built as one run however the
implementation is paced, because no reviewer can be sent its diff.

So a design past about 150 task items has to become several runs. On 2026-10-10
the operator wanted an oversized design stopped and broken into multiple features;
on 2026-10-11 the operator said that if breaking a design into two or more features
works, the other plans may not be needed, or only as a fallback. This proposal sets
out what "break it into features" needs from BuildWorks. It is not a plan and
decides nothing: its design choices are the operator's, and `ARCHITECTURE.md`
section 5 lists `task_decomposition` as a deferred stage that needs its own
decision.

## What exists, what does not

- **One run is one design is one feature.** The design lives at
  `docs/features/<slug>/design.md`; the run's starting commit is the target
  checkout's `HEAD` at `new-run` (`resolveStartingCommit`, `src/profile.ts`); the
  approval binds that commit; the run builds in a worktree at that commit on a
  branch `gov/<slug>/<run-id>`. **[Verified]**
- **Nothing connects two runs.** The delivered branch of run N is not the starting
  point of run N+1 unless the operator merges it into the target checkout and
  commits before running `new-run`. The runbook already says this is the
  operator's step (`docs/runbooks/cli-operator.md`, "Integrate separately and
  preserve evidence": merging, pushing and deploying are separate decisions, and
  the next feature starts after the original worktree is committed or set aside).
  **[Verified]**
- **Spec and plan authors read whatever directory the operator launched from**,
  not the run's worktree (`src/spec-stage.ts` passes no working directory;
  `docs/proposals/toolchain-probe-and-stack-intent.md` records this). A second
  feature's spec author therefore sees the first feature's code only if the first
  feature has been merged into the checkout the operator launches from.
  **[Verified]**
- **A spec carries stable identifiers and declared paths.** Acceptance criteria are
  `AC-001`-style IDs and the spec declares the artifact paths it will change
  (`src/spec-doc.ts`: `CRITERION_ID_PATTERN`, `readSpecDeclaredArtifacts`). That is
  enough for a deterministic check that a proposed split covers every criterion
  exactly once. **[Verified]**
- **No stage proposes a split.** `task_decomposition` is deferred (section 5); no
  code reads a spec and says "this should be two features". **[Verified]**
- **Chaining has never been tried.** No recorded run began from another run's
  delivered commit. Every claim below about what chaining costs is a design
  estimate. **[Unknown]**

## What a split has to get right

- **Each piece must fit its own run, with the next piece built on the last.** A
  piece that adds a file the earlier piece created is normal; a piece whose spec
  assumes code that does not exist yet is not. Order and the dependency between
  pieces are the whole difficulty.
- **Nothing is dropped and nothing is built twice.** Every acceptance criterion in
  the original design belongs to exactly one piece. The check is a set comparison,
  not a judgment.
- **The second piece must be able to see the first.** If it cannot, its spec author
  guesses (the crew-chatter run 1 layout-guess failure, recorded in the toolchain
  proposal) and the run fails after spending.
- **The operator approves the split before it spends anything.** A split changes
  what gets built, so a model's proposal is only a proposal. The approval is the
  existing kind of human gate, not a new schema.
- **A split cannot make a failed step safe.** Four of the eight recorded failures
  (runs 8, 9, 2 and 3, $24.41 together) were one failed step stranding a run,
  and smaller runs strand less money per failure without changing how often one
  fails. **[Verified from the recorded costs; the "less per failure" is an
  inference.]**

## Candidate mechanisms

**A. Chain runs; the operator does the splitting.** Add one optional argument to
`new-run`, `--after <run-id>`, and a deterministic check at `new-run` and at
approval: the earlier run is `completed`, its delivered commit is an ancestor of
the new run's starting commit (`git merge-base --is-ancestor`), and the target
checkout is clean. The link is frozen into the profile (hard rule 6; hard rule 3
permits the profile change because nothing has shipped, and earlier profiles are
refused by name as with every shape change). The operator writes the designs and
merges between runs, as the runbook already describes. Small, no model dispatch,
no new stage, and it makes the chain a recorded fact instead of a hope. It does
not take the splitting work off the operator, which is the part the operator wants
BuildWorks to handle.

**B. A split stage proposes the pieces; the operator approves; chaining as in A.**
After spec review passes, one new dispatch reads the approved spec and proposes an
ordered list of features: a slug, a title, the acceptance criteria and declared
paths each takes, and what it depends on. A deterministic validator rejects a
proposal that drops or repeats a criterion, orders a dependency backwards, or
assigns a piece more task items than the frozen backstop (estimated from its
criteria, which is a guess; see the open decisions). The operator approves or
rejects it through the same approve/deny pause the spec decisions use. On approval
BuildWorks writes one `docs/features/<slug>/design.md` per piece in the target and
ends the original run; the pieces are then run in order with mechanism A's
`--after`. This is `task_decomposition` under another name, so it needs the
operator's decision to lift that deferral, and it adds a stage, a dispatch and a
document format. Hard rule 4 asks for two real implementations before an
abstraction: this is one stage with one use, not a framework.

**C. Stop a design that is too big at spec review and say how to split it.** The
plan the operator rejected on 2026-10-10 as the whole answer. It costs nothing to
build and nothing to run, and it leaves the splitting to the operator. It needs a way to
tell, from the spec alone, that a design is too big; decision 2 below says none is
measured yet. Without one, it stops a design only after the plan exists, which is
what the plan-size refusal already does.

**Not proposed: review the diff in slices.** It would lift limit 1, but the
operator authorized `code_review` as a whole-diff panel on 2026-09-04 and
2026-09-06 and that authorization does not extend to a new review shape. It also
does nothing for limit 2.

## What each would have caught

| Recorded case | A | B | C |
| --- | --- | --- | --- |
| crew-chatter run 4: 86 items, refused by a ceiling of 80 | No, the operator still has to write two designs | Yes, if the validator accepts the proposal's piece sizes | Only if a size predictor exists (decision 2); otherwise it stops after the plan, as it did, at $4.94 |
| a 300-item design (not a recorded case) | Only after the operator splits it | Yes, same condition | Same condition |
| team-notes run 12, counted by lines | Already fixed by counting items | Already fixed | Already fixed |
| runs 8, 9, 2, 3 (one failed step) | No | No | No |
| run 10 and crew-chatter run 2 lint (target setup) | No | No | No |

The last two rows are the point of the segments, usage-limit, retry and toolchain
work, not of this proposal. Splitting does not replace them; it only shrinks what
one failure loses.

## Decisions that are the operator's

1. **Mechanism.** A alone, A with C, or B (which includes A). B needs the
   `task_decomposition` deferral lifted, and nothing here authorizes that.
2. **How a piece's size is estimated before the plan exists.** Task items come
   from the plan, which is written after the spec. The two measured ratios of
   declared paths to task items are 1.0 (crew-chatter run 2: 51 files, 51 items)
   and 2.9 (team-notes run 10: 20 files, 57 items), so declared paths alone
   cannot predict item count. Acceptance criteria per task item is unmeasured.
   If no predictor is trusted, B's validator can only check coverage and order,
   not size, and a piece can still overflow.
3. **Whether the operator merges between pieces, or BuildWorks stages the next
   piece on the previous piece's branch.** The second would let a piece run
   without a merge, but spec and plan authors read the launch directory, so it
   would also need those stages to read the worktree: a change to every
   spec and plan dispatch, and the toolchain proposal's mechanism 1 is that same
   change.
4. **Whether the pieces share one approval or each is approved on its own.** Each
   run's approval binds its own starting commit, which differs by piece, so
   separate approvals are the existing shape; one approval across pieces would
   need a new binding.
5. **What the spend consent covers.** Today a consent covers one invocation of one
   run. A chain of pieces is several consents. Whether to offer one preview for
   the whole chain is an operator-experience question, not a safety one.

## What would settle it

Free evidence first, in this order:

- Measure, from the retained runs, how many acceptance criteria and declared
  paths each recorded plan covers per task item, so decision 2 has data. Three
  or more designs, not two.
- Replay crew-chatter run 4's recorded spec through the split validator once it
  exists, with a hand-checked answer for what a correct split of that spec looks
  like. That checks the validator, not the model.
- A chained pair of stand-in runs through the real `new-run --after` check:
  accepted when the earlier delivery is an ancestor, refused when it is not,
  refused when the earlier run is blocked, refused when the checkout is dirty.

Then one paid pair of real runs, as its own decision and its own consent: one
design that a single run cannot carry, split, built and reviewed as two. Until
that runs, how a second piece behaves with a first piece merged beneath it is
unknown.

## Hazards weighed

- **Hazard 18** (delivery proven, correctness not inspected): a split keeps
  every piece reviewable by the existing panel; it does not weaken review.
- **Hazard 20** (a plan larger than one reply): splitting shrinks plans, which
  is the cheaper way to stay under the reply limit.
- **Hazard 6** (promises a later stage cannot keep): a proposal that says "this
  fits" must be a measured claim or labeled as an estimate.
- **Hazard 4** (fixtures and code agreeing while both are wrong): the split
  validator's expected answers come from a recorded spec and a hand check, not
  from the model's own proposal.
- **Hazard 14** (independence that cannot be proven): a new stage that decides
  what gets built deserves an independent review after the build.
- **Hard rules 2, 3 and 6:** the CLI stays the only mutating surface (an approval
  of a split would go through the same decision path as `decide`); the profile
  gains one field with earlier profiles refused by name, no version discriminator;
  the link between runs is frozen at run start. The stage count grows by one only
  if B is chosen.

Related: `docs/features/implementation-segments-and-pause/plan.md`,
`docs/proposals/build-in-segments-and-continue.md`,
`docs/proposals/usage-limit-refusal-strands-a-run.md`,
`docs/proposals/toolchain-probe-and-stack-intent.md`, `ARCHITECTURE.md` sections
5 and 7, `docs/hazards.md` entries 18 and 20.

## Decided 2026-10-12

The operator chose:

1. **Mechanism B, which includes A.** BuildWorks proposes the split, which lifts
   the `task_decomposition` deferral for this one use and no other. The proposal
   is one dispatch inside `spec_review`, not a new stage. Approved pieces are
   stored as proposals and exported through `proposal-export`; BuildWorks never
   writes a `design.md` into the target.
2. **The trigger is the spec's declared-file count**, against a frozen threshold
   of 30. Eleven recorded runs gave 1.0 to 2.6 plan items per declared file, and
   80 / 2.6 rounds down to 30 (`test/fixtures/recorded/declared-paths-vs-plan-items.json`).
   The plan first proposed 43 from the first five runs; the operator chose the
   worst case of all eleven. The 2.9 ratio above counted changed files, not
   declared paths.
3. **The operator merges each feature** (merge or fast-forward, never squash)
   and commits before the next one starts. `new-run --after <run-id>` checks
   that the earlier run completed, its delivery record verifies, and its
   delivered commit is in the new starting commit's history. Spec, plan and
   review dispatches now run in the target root, so the next feature's authors
   see the merged code.
4. **Each piece is its own run** with its own approval and its own consent;
   decisions 4 and 5 above keep the existing shape.

The segments plan is shelved; the usage-limit summary plan stays. Pausing a run
on a usage-limit refusal remains a separate later decision. The plan is
`docs/features/design-split-into-features/plan.md`.
