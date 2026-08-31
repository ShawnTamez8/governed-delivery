# The implementer writes the files it also proposes, and the gate refuses them

## What happened

The first end-to-end run of `bw implement` against the real harness blocked
with:

```
add requires the file not to exist: src/clamp.mjs
```

The implementer session had already written the two scratch-repository files
`<smoke>/src/clamp.mjs` and `<smoke>/test/clamp.test.mjs` into the run's
worktree using its own file tools, and
then returned those same files as `add` patches in its `AgentResult`. The
implementation gate's existence check is correct and did what it should; the
model's behaviour is also reasonable given what it was told. The two
disagree because nothing told the model not to write.

Observed on run 1 of a scratch smoke repository, 2026-08-30, dispatch 7,
`claude-sonnet-5`, $0.1319. The worktree afterwards:

```
$ git -C .governance/worktrees/1 status --porcelain
?? src/
?? test/
```

Both files present, untracked, and never committed — exactly the state the
gate refused to build on.

## Why it is a prompt defect rather than a gate defect

`buildImplementationAuthorPrompt` in `src/prompts.ts` says:

> Run no git commands: the system applies and commits the patches you propose.

It forbids git. It does not forbid writing files, and it opens by telling the
model its working directory *is* the repository the changes apply to and to
read it. A session with write tools, told to "propose the code changes" inside
a checkout it is invited to explore, will write them.

This is hazard 3 — a constrained field must have its constraint stated in the
prompt — applied to a constrained *behaviour* rather than a field. The
constraint exists and is enforced; it was simply never said.

## Why this was not caught before

There is no recorded step-6 smoke, and no earlier smoke could have caught it
either, because **every previous smoke exercised one stage in isolation.**
Step 2 drove the harness adapter, step 3 drove `bw spec`, and step 5 drove the
plan stage with — in its own words — "the spec, stage chain, `spec.gate.pass`
event, and approval ... constructed through the store, so the plan stage's
dispatches were the only spend." The run that found this is the first in which
the stages were chained on real model output.

Step 6 shipped on fixture coverage alone, and the fixture executor returns a
canned `AgentResult` without ever touching the worktree — so no test could
have observed this. It reproduces the step-3 lesson exactly: real smoke output
must drive prompt iteration, and fixtures cannot.

## Options

- **State the constraint in the prompt.** One or two sentences: the session
  must not create, modify, or delete files, because the system applies the
  patches; anything written directly is discarded and will make the gate
  refuse the patch that names it. Cheapest, matches how hazard 3 was
  addressed elsewhere, and `test/prompts.test.ts` already scans prompts for
  stated constraints — the scan would need to cover this one.
- **Make the gate tolerant of the model's own writes.** Compare the file on
  disk against the proposed content and treat an identical file as satisfying
  `add`. Rejected on sight: it makes the gate's existence check depend on
  content equality, and a *different* uncommitted file would still have to be
  refused, so the rule becomes conditional and harder to reason about.
- **Deny the worktree to the session.** Run the implementer with a read-only
  view, or somewhere else entirely. This is the containment question
  `docs/proposals/verification-containment.md` raises for verification
  commands, and the same missing mechanism blocks it.

The first option is the one to try first, and it needs its own smoke to
confirm — a prompt change unverified against the real binary is the same
mistake in a new place.

## Blast radius

`src/prompts.ts` (`buildImplementationAuthorPrompt`) and
`test/prompts.test.ts`. No schema, no gate, no stage sequence. This is step 6
work and is deliberately not folded into the verification-stage plan, which is
complete except for its own smoke — that smoke is blocked on this, because it
cannot reach a passed `implementation` stage to verify.
