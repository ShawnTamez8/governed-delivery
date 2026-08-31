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

## Why the step-6 smoke did not catch it

**Step 6 was smoked, and it passed.** `.claude/sessions/project-learnings.md`
records it: "one `claude-sonnet-5` dispatch, $0.0673, 5.1s, valid patch set on
the first attempt", and `docs/features/implementation-stage/plan.md` Task 9
Step 1 is checked off. Same prompt, same model, same constructed-upstream
setup. That run's implementer returned its files as JSON without writing them;
this run's implementer wrote them first.

So the behaviour is **not deterministic**, and that is the point. The prompt
permits both readings, the gate accepts only one, and which one occurs is the
model's choice on the day. A one-run smoke that passes is not evidence the
path is sound — it is one sample from a distribution nobody has characterised.

The fixture suite cannot see any of this: the fixture executor returns a
canned `AgentResult` and never touches the worktree, so no automated test can
observe an implementer that writes.

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

The first option is the one to try first. Confirming it needs **more than one
run**: the failure is nondeterministic, so a single green smoke is exactly the
evidence step 6 already had. Run the implementer several times against a
constructed upstream — the pattern steps 5 and 6 both used, where the spec,
chain, gate event, and approval are built through the store so the implementer
dispatch is the only spend, about $0.13 an attempt — and require every one of
them to return files it did not write.

## Blast radius

`src/prompts.ts` (`buildImplementationAuthorPrompt`) and
`test/prompts.test.ts`. No schema, no gate, no stage sequence. This is step 6
work and is deliberately not folded into the verification-stage plan, which is
complete except for its own smoke — that smoke is blocked on this, because it
cannot reach a passed `implementation` stage to verify.
