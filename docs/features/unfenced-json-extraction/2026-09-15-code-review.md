# Unfenced JSON extraction — code review of the 2026-09-14 changes

**Reviewed document:** `docs/features/unfenced-json-extraction/plan.md`, including
its `## Amendment (2026-09-14)` section, which was written retrospectively in the
same session as this review because the changes shipped without a governing plan.

**Review date:** 2026-09-15
**Effort:** high
**Status:** partially reconciled — findings 1, 3 and 7 fixed on 2026-09-15;
findings 2, 4, 5 and 6 remain open. See the reconciliation block at the end.

**Hazards considered:** 1 is the entry the main change belongs to — item 9 is
new, and the review's central question was whether anchoring the closing fence
buys item 9 without losing shapes the enumeration already accepted; findings 1
and 2 are two shapes it loses. 2 governs finding 3: the new anchors make the
fence match fail rather than refuse, so a body with a visible fence falls
through to the unfenced path and is refused in language that says there was no
fence, which is the same false-diagnosis failure the entry exists to prevent and
which the function's own docstring promises not to commit. 6 governs finding 4 —
its "any change stranding a run with no in-place repair path" clause is exactly
what raising a frozen sandbox default does, and the mechanism is verified even
though no run on this machine is currently in a position to be stranded. 10's
question, how far the run-start snapshot reaches, and 12, configuration
divergence, both bear on finding 5: the idle timeout is now decided in two
places that agree only by coincidence. 3 and 4 bear on the prompt and test
changes and were checked in both directions — the new `normativeChanges`
constraint is stated in the prompt and scanned by `test/prompts.test.ts` on both
builders, and every new assertion was confirmed to fail against the unfixed
regex before being reported as working; finding 6 is a scan that was deleted
rather than added. 13 was checked against `src/reconciliation.ts`: the new
prompt rule describes what `convert()` already does and invents no obligation.
5 does not apply — no gate, coverage rule, or delivery check is touched. 7 does
not apply — nothing here is a retry, and the fence fix is code written against a
retained response rather than another paid sample. 8, 9, 11 and 14 bear on code
this review found no fault with: nothing spawns an executable, installs a hook
interpreter, seeds an agent, or claims independence.

**Scope reviewed:** the 2026-09-14 12:37–15:21 slice of the uncommitted working
tree on branch `guided-project-bootstrap` at `HEAD` `3415032` — `src/parse-output.ts`,
`src/executor.ts`, `src/prompts.ts`, `docs/hazards.md`, the single
`idleTimeoutSeconds` line of `ARCHITECTURE.md` (its remaining 95 changed lines
are the separate guided-bootstrap work and are out of scope), `test/parse-output.test.ts`,
`test/prompts.test.ts`, `test/executor.test.ts`, and
`test/recorded-implementation-response.test.ts`. One untracked file belongs to
this change and was read in full: `test/fixtures/recorded/implementation-simple-game-embedded-markdown-fence.json`
(50,335 bytes). The other ten untracked paths `git status --porcelain` reports
are guided-bootstrap work and were not reviewed here. Checks: `npm run typecheck`
clean; `npm test` 1175 passing, 1 failing, 5 skipped, the one failure being the
known `verify-command.test.ts` EPERM cleanup race recorded in
`.claude/sessions/2026-09-13-debug-verify-cleanup-eperm.md` and passing on an
isolated rerun; `npm run check:docs` clean; `git diff --check` reports one
defect, which is finding 7.

## Summary

The core reasoning behind the fence fix is correct and worth stating plainly,
because it is the part that a future reader will be tempted to undo. A literal
newline cannot appear unescaped inside a JSON string, so a closing fence
required to begin on its own line cannot match inside a JSON string value. That
is a real invariant, not a heuristic, and it is what makes item 9 solvable
without a parser. The recorded response that motivated it is committed with a
full provenance block, the regression replays those bytes rather than a
hand-built string, and both new tests were confirmed to fail against the old
regex. Hard rule 5 is satisfied.

The problem is that the new pattern does more than anchor the closing fence. It
also anchors the opening fence, requires the info string to be followed
immediately by a newline, and matches the fence body with `[a-zA-Z]*`, which
cannot consume a fourth backtick. Two shapes the old pattern accepted are now
refused, and neither is pinned by a test, which is why the suite is green. One
of them — a four-backtick fence — is the shape a model idiomatically reaches
for precisely when its payload contains triple backticks, which is the exact
condition item 9 was written about. The change therefore narrows tolerance in
the same neighbourhood where it widens it, and the hazard entry describes only
the widening.

The two changes that shipped alongside it are unrelated to extraction and are
recorded here because they travelled in the same uncommitted slice. The prompt
rule is accurate and well covered on the spec side; it silently dropped an
assertion on the plan side. The idle-timeout raise is defensible on its merits —
the executor runs `--output-format json`, so nothing arrives until the end and
the idle budget is effectively the whole generation time for every stage — but
it was made in two places at once and without checking what it does to runs that
froze the old value.

## Finding 1 — a four-backtick fence regressed from accepted to refused (High)

`src/parse-output.ts:19-20`. The opening fence is matched as
`` ```[a-zA-Z]*[ \t]*\n ``. Against a body opening with four backticks, the
pattern matches three of them, then `[a-zA-Z]*` cannot consume the fourth, and
`[ \t]*\n` cannot either, so no match is produced anywhere in the body. The old
pattern had no line anchor, so it simply began matching at offset 1 and
succeeded.

Four backticks is not an exotic shape. It is the standard CommonMark way to
fence content that itself contains a triple backtick, which is the precise
situation item 9 documents. The model that produced the recorded response
happened to use three, so this is unmeasured rather than observed; the severity
is High because the consequence of a refusal here is a dead paid dispatch at the
implementation stage — the recorded one cost $1.0211774 and blocked a run at a
cumulative $2.8386176 — and because nothing in the suite would notice the
regression.

A closing-fence anchor is sufficient for item 9 on its own. The opening anchor
and the bounded info string are what cost this shape.

````text
Reproduced: node against the live regex read out of src/parse-output.ts
  body: "````json\n{\"status\":\"proposed\",\"files\":18}\n````"
    old regex: OK
    new regex: no fence matched -> falls through to the unfenced path

Driving the real extractJsonBody on the same body:
  refused: no fence, and the text from the first '{' (offset 9) to the end of
  the body is not valid JSON: Unexpected non-whitespace character after JSON at
  position 33 (line 2 column 1)
````

## Finding 2 — a closing fence on the content's own line regressed (Medium)

Same lines. The `(?<=\n)` before the closing fence requires the terminator to
begin a line, so a body whose final `}` and closing fence share a line no longer
matches. This one is unavoidable given the chosen mechanism — it is the same
lookbehind that makes item 9 solvable — but it is a real narrowing of the
enumeration in `docs/hazards.md` entry 1, and the new paragraph does not mention
it. Entry 1 is the list a future reviewer works through shape by shape; a shape
that silently left it is how item 8 came to block a paid run in the first place.

The remedy is documentation, not code: state in item 9 that the closing fence
must begin a line, and say why that cost is accepted.

````text
Reproduced:
  body: "```json\n{\"status\":\"proposed\",\"files\":18}```"
    old regex: OK
    new regex: no fence matched -> falls through to the unfenced path
````

## Finding 3 — a rejected fence is reported as no fence at all (Medium)

`src/parse-output.ts:19-41`. When the new pattern fails to match, `fences.length`
is zero and control reaches the unfenced fallback, whose refusal begins "no
fence, and the text from the first '{' …". For findings 1 and 2 that sentence is
false: the body visibly contains a fence, and the reason it was rejected is the
new anchoring rule, which the operator is never told about.

This is hazard 2 as the entry defines it, and it also breaks the contract the
function's own docstring states — "names the cause in every refusal". It is the
same class of defect the previous plan's Task 2 was written to fix; the message
it produced then was "no JSON object found in output", which was false in
exactly the same way.

The fix is cheap: before falling through, scan for the presence of a backtick
fence with a pattern that is not anchored, and if one is found, refuse with a
message naming the anchoring requirement rather than claiming absence.

````text
Reproduced: real extractJsonBody, three bodies that all visibly contain a fence
  "````json\n{...}\n````"        -> refused: no fence, and the text from the
                                    first '{' (offset 9) ...
  "````json\n{...embedded...}\n````" -> refused: no fence, and the text from the
                                    first '{' (offset 9) ...
  "```json\n{...}```"           -> refused: no fence, and the text from the
                                    first '{' (offset 8) ...
````

## Finding 4 — raising the frozen sandbox default refuses every run frozen before it (Medium)

`src/executor.ts:77`, `ARCHITECTURE.md:483`. `requireFrozenBinding`
(`src/profile.ts:411-417`) compares the live executor to the frozen one by
canonical JSON equality of the whole definition, deliberately, so that a
divergent sandbox cannot pass. `idleTimeoutSeconds` is inside that object.
Changing the constant therefore makes every profile frozen at 600 fail the
binding check at the first dispatch construction site it reaches, with a message
that names the executor mismatch but not the field.

The mechanism is verified. Its reach today is nil: every run that exists on this
machine is terminal — `C:\Users\tamezs\buildWorks_test_repos\target` run 1 is
`completed`, and all three runs in `C:\Repositories\testing-repos\simple-game-test`
are `blocked`, which `requireRunInProgress` (`src/store.ts:939-941`) treats as
permanently unable to proceed. The BuildWorks checkout has no store at all. So nothing is
stranded, and this is reported at Medium rather than High for that reason.

It stays a finding because nothing records the constraint. The next person to
adjust a sandbox field will do the same thing, and if an `in_progress` run
exists at that moment it dies with no in-place repair path, which is hazard 6's
second clause. A comment at the field, or a line in the amendment, is enough.

````text
Reproduced: requireFrozenBinding with the executor bytes recorded in the
committed fixture from the 2026-09-12 live chain
  test/fixtures/recorded/doctor-ambient-config-web-calculator-live-chain.json

  idleTimeoutSeconds recorded in that frozen profile: 600
  idleTimeoutSeconds in the current CLAUDE_CODE definition: 1800
  requireFrozenBinding(profile frozen at 600, live executor):
    REFUSED: the executor handed to the stage does not match the executor
    frozen at run start
````

## Finding 5 — the idle timeout is decided in two places (Medium-low)

`src/executor.ts:30` introduces `LARGE_GENERATION_IDLE_TIMEOUT_SECONDS = 1800`,
and `src/executor.ts:77` sets the sandbox default to the same 1800. The constant
is passed at two call sites — `src/implementation-stage.ts:387` and
`src/code-review-stage.ts:515` — and `src/harness.ts:212` resolves
`input.idleTimeoutSeconds ?? executor.sandbox.idleTimeoutSeconds`, so the
call-site value wins whenever it is supplied. The override is live code, not
dead code.

Today it can never differ from the frozen value, because finding 4's binding
check refuses any run whose frozen sandbox is not byte-identical to the live
one. That is what makes this Medium-low rather than a live hard-rule-6 breach.
But the guarantee is accidental: it rests on a check in another module whose
purpose is tamper evidence, not timeout coherence. The moment the sandbox
default moves to any value other than 1800, the two stages that matter most
will run on a live constant instead of the run's frozen snapshot, which is
precisely "a flag that silently overrides the frozen profile".

`test/executor.test.ts:71-72` pins both to the literal `1800` independently, so
the two can diverge without any test failing. An assertion that they are equal
to each other, or removing one of the two decisions, would close this. The
simplest resolution is to delete the call-site override: with the default now
at 1800, the constant expresses nothing the sandbox does not already say.

## Finding 6 — a plan-side prompt assertion was deleted rather than added to (Low)

`test/prompts.test.ts:746-750`. The plan reconciliation scan previously asserted
`"superseded half counts as a removed node"`. That line was replaced by the two
new duplicate-claim strings rather than joined by them. The sentence is still
present in the generated plan prompt, so this is lost coverage, not a moved
assertion — and the comment immediately above it, which explains that the
removal obligation must be asserted on both prompts because one builder feeds
both, now sits above two strings it was not written about and describes them
incorrectly.

The spec-side scan at line 683 did it correctly: both new strings were added and
the existing one kept. This is hazard 3's "check the scan covers newly
constrained fields" read in the other direction — the scan stopped covering an
old one.

````text
Reproduced: building both prompts and testing for each string
  "superseded half counts as a removed node"
     plan prompt: true   spec prompt: true   (asserted on spec only)
  "across the entire revision must be claimed"
     plan prompt: true   spec prompt: true
  "Never duplicate or repeat the same node across multiple decisions"
     plan prompt: true   spec prompt: true
````

## Finding 7 — trailing blank line at end of file (Low)

`test/recorded-implementation-response.test.ts:79`. `git diff --check` exits 2.

````text
Reproduced:
  $ git --no-pager diff --check
  test/recorded-implementation-response.test.ts:79: new blank line at EOF.
  exit=2
````

## Verified non-findings

These were investigated and dismissed; recording them keeps a later reviewer
from spending the same time.

**Hard rule 5 is satisfied.** Correctness is anchored by
`test/fixtures/recorded/implementation-simple-game-embedded-markdown-fence.json`,
a real retained response with a provenance block naming the run, the dispatch
time (`2026-09-14T19:56:37.176Z`), the capture date, the cost, the stage
context, the recorded refusal it produced, and what was dropped from the
envelope and why. The synthetic case 9 in `test/parse-output.test.ts` is an
illustration sitting beside it, not the authority.

**Hazard 4 is satisfied.** Both new tests were confirmed to fail against the old
regex: the recorded fixture's own `recordedRefusal` field is the production
failure, and case 9's embedded-fence body refuses under the old pattern with
"fenced block is not valid JSON: Unterminated string in JSON".

**The `$2.83862` in the hazard entry is correct.** It is the cumulative cost of
run 3 in `simple-game-test` at the point of the block, summing the eleven
recorded `agent_run` rows to `2.8386176`. The implementation dispatch itself
cost `1.0211774`. This matches the convention item 8 used.

**The new prompt rule states something true.** `src/reconciliation.ts` `convert()`
does convert a duplicated node claim to `cannot_determine`, and an empty
`normativeChanges` array on an `addressed` decision is explicitly legal, so the
prompt is describing the deterministic behaviour rather than inventing an
obligation. Hazard 13 does not bite.

**Raising the idle timeout is defensible on its merits.** The executor command
is `claude -p --output-format json`, which is non-streaming, so no output
arrives until generation completes and the idle budget is in practice the total
generation time for every stage. The recorded implementation dispatch ran
780,568 ms — 13 minutes — against a 600-second budget it would have exceeded had
it been a little slower. `absoluteTimeoutSeconds` remains 3600 and still exceeds
the idle budget, so `test/executor.test.ts`'s ceiling relationship holds.

**Indented fences are unaffected.** The `[ \t]*` before the opening fence
preserves them; a two-space-indented fence matches under both patterns.

## What would close this review

Findings 1 and 3 are the ones that can cost money, and both are small. Finding 1
is a narrower opening pattern; finding 3 is a pre-fallthrough check that names
the real cause. Finding 2 is a documentation sentence in `docs/hazards.md`
item 9. Findings 4 and 5 are one decision — whether the call-site override
survives — plus a recorded note about the frozen-binding consequence. Findings 6
and 7 are one line each.

None of them is a reason to revert the anchoring. The invariant it rests on is
sound and the shape it fixes cost a real run.

---

## Reconciliation (2026-09-15)

The operator elected to fix findings 1, 3 and 7 before committing and to leave
the rest open. Nothing above has been rewritten; the findings stand as first
recorded and this block carries their dispositions.

**Finding 1 — fixed.** The opening fence in `src/parse-output.ts` is now
`` ```+ `` rather than `` ``` ``, so a fence of four or more backticks matches
and `[a-zA-Z]*` is no longer asked to consume a backtick. The closing delimiter
was already `` ```+ ``. Nothing else about the anchoring changed.

**Finding 2 — open, and partly mitigated.** A closing fence sharing a line with
the content is still refused; that is inherent to the lookbehind item 9 rests
on. The fix to finding 3 means the operator is now told which rule rejected the
body instead of being told there was no fence, which removes the misdiagnosis
without restoring the shape. `docs/hazards.md` item 9 still does not state the
cost, and that sentence remains unwritten.

**Finding 3 — fixed, by a different remedy than the one this review proposed.**
The finding suggested refusing before the unfenced fallback when a fence is
detected. Implementing that would have regressed a body carrying an opening
fence with no closing fence at all: today the fallback parses it from the first
`{` and accepts it, and an unconditional refusal would have turned an accepted
shape into a refused one — the same defect as findings 1 and 2, introduced while
fixing them. The fallback is therefore unchanged and only the refusal language
branches. A line-anchored backtick run sets `carriesFence`, and both refusal
messages then name the anchoring rule instead of asserting absence. The two
pre-existing refusal strings are preserved byte-identically for the genuinely
unfenced case, so the tests that pin them are untouched.

**Findings 4, 5 and 6 — open.** No code changed. Finding 4's constraint is
recorded in the plan amendment rather than enforced; findings 5 and 6 await a
decision on whether the call-site timeout override survives and on restoring the
plan-side prompt assertion.

**Finding 7 — fixed.** `git diff --check` exits 0 across the tree.

**Proved by breaking.** Both new guards were removed in turn and the suite
re-run. Reverting the opening fence to `` ``` `` failed only "a four-backtick
fence is accepted…"; forcing `carriesFence` to `false` failed only "a fence the
anchoring rejects is refused in language naming the rule…". `src/parse-output.ts`
restored byte-identically both times, SHA-256
`b885aa6e291cdaff416e5e2b95175e41677abcf969027b99da942ef80828eb0e`.

**Verification after the fixes.** `npm run typecheck` exit 0;
`node --test test/parse-output.test.ts test/recorded-implementation-response.test.ts`
17/17 passing.
