# Hazards

Failure modes a governed delivery system is subject to, and what each requires.
These are requirements, not advice. Read the relevant entry before implementing
that area.

---

## 1. Model output arrives in shapes the schema refuses

The largest defect class, and it is invisible to a suite whose fixtures emit
conforming bytes.

Every parser that reads model output accepts or explicitly refuses each of:

1. bare JSON
2. a single ` ```json ` fence
3. prose before the fence, e.g. `Now I'll return the reconciliation:`
4. prose after the fence
5. two fenced blocks
6. a fenced block that is not JSON
7. CRLF line endings inside the fence
8. prose before an unfenced object, e.g. `I'll finalize the spec now.\n\n{…}`
9. fenced JSON whose string literals contain markdown code fences
10. JSON whose string literals contain a raw line break, tab, or other control
    character

**Choose strictness by consequence.** Where bytes are canonicalized into an
immutable record, refuse prose outside the fence: dropping it silently corrupts
the record. Where the result is only schema-validated, tolerate one fenced block
anywhere in the body and refuse rather than guess when several are present.

Assert the operator-visible message on every refusal, not merely that an error
was thrown. A message that does not name the cause makes the failure
undiagnosable from logs alone.

**Measured, 2026-09-06, $0.08103.** The spec author of a paid chain wrote one
sentence of prose, a blank line, and then a complete, valid `AgentResult` with
no fence around it. `extractJsonBody` accepted a whole-body parse or exactly one
fenced block; the whole body failed on the sentence and there was no fence to
find, so it refused with "no JSON object found in output" — false as written,
since `JSON.parse` from the first `{` yields the entire twenty-criterion
specification — and the run blocked at stage 1. Unlike the two blocks before
it, the constraint *was* stated: the prompt says to output the object directly
with no surrounding prose, and the model added a sentence anyway. That is the
case this entry's rule is written for. The extractor feeds schema validation and
`src/raw-output.ts` retains the bytes in full, so it already tolerated prose
around a fence on exactly those grounds; an unfenced object is the same two
ingredients with less decoration, and it was the one arrangement with no path.
It now parses from the first `{` to the end of the body when no fence is
present, and each remaining refusal says what the body did contain: no fence
and no `{`, or the offset the parse began at and why it stopped. The retained
response is committed at
`test/fixtures/recorded/spec-author-web-calculator-prose-before-unfenced-json.json`
and is the contract test. What this instance adds: the enumeration above is the
contract every parser is held to, and a shape missing from it is a shape no
reviewer will ask about — items 3 and 4 named prose around a *fence*, and a
suite that worked all seven passed while the eighth blocked a paid run.

**Measured, 2026-09-14, $2.83862.** The implementer author of a paid chain
returned a valid fenced JSON `AgentResult` proposing 18 files, including a
`README.md` whose content contained markdown code fences (` ``` `).
`extractJsonBody` matched the closing fence with non-greedy `([\s\S]*?)``` `,
terminating the block at the first triple backtick inside the JSON string and
truncating the payload midway through `README.md` at position 43453 with
"Unterminated string in JSON". In valid JSON, control characters including
newlines must be escaped inside strings, so a literal newline followed by
backticks (`(?<=\n)```[ \t]*(?=\n|$)`) cannot occur inside a valid JSON string.
Requiring closing fences to begin on their own line prevents embedded markdown
code fences in JSON string values from prematurely terminating the fence match.
The retained response is committed at
`test/fixtures/recorded/implementation-simple-game-embedded-markdown-fence.json`
and is the contract test.

**What the anchoring costs, and why the cost is accepted.** Requiring each
delimiter to begin its own line narrows the enumeration above, deliberately. A
body whose final `}` and closing delimiter share a line no longer matches and
falls through to the unfenced path. That shape has never been measured and is
not in the list, and the lookbehind that refuses it is the same one that makes
this item solvable, so it is accepted rather than worked around: there is no
way to keep it without reopening the truncation this instance cost $2.83862 to
find. Two things stop that narrowing from repeating item 8's failure. The
opening delimiter is ` ```+ `, so a fence of four or more backticks is still
accepted — that shape briefly regressed and was restored. And when the body
carries a backtick run beginning a line, the refusal names the anchoring rule
instead of claiming there was no fence, which is hazard 2: the operator who
reads "no fence" about a body that visibly has one goes looking for the wrong
thing. Read this item as "one fenced block, each delimiter alone on its line."

**Measured, 2026-10-04, $1.1298948 for the dispatch.** The implementer of
team-notes run 9, phase 2 of 5 (Sonnet 5.5 at `medium`), finished normally
(`end_turn`, `is_error` false) and returned a complete `AgentResult`: one patch of
11 files, 113,649 characters. Exactly one raw line break (U+000A) sits inside a JSON
string, in the content of *src/server/routes/import.ts* at line 605 of 649, 98.7
percent of the way through the response. Every other line break in it is escaped;
the 2,000 characters before the slip hold 53 correct `\n` escapes. The strict parse
refused it ("Bad control character in string literal in JSON at position 112141"),
the stage recorded `implementation.content.invalid`, and the run blocked with phase
1 committed, at $4.8703008 total. The prompts told the model how to escape
non-ASCII characters and never to use `\UXXXXXXXX`; none said that a line break
inside a string is written `\n`. The retained response is committed at
`test/fixtures/recorded/implementation-team-notes-run-9-raw-newline-in-string.json`
and is the contract test.

**What changed, and why this item differs from the `\U` one.** `extractJsonBody`
now retries a failed parse once, after escaping raw control characters that sit
inside string literals (`parseJson` in `src/parse-output.ts`). A CRLF pair becomes
one `\n`, matching item 7. Nothing outside a string literal is touched, and a body
still invalid after the retry is refused with the original parse error, so the
position it names is in the bytes the model wrote. Earlier entries kept the
extractor strict ("does not guess repairs"), and that stays true for an invalid
escape such as `\UXXXXXXXX`, which has no single reading. A raw line break inside a
string has one: the author meant a line break, here followed by indented code. Both
patch-producing prompts (the implementation author and the remediation prompt) now
state the rule too. The repair applies to every stage that parses model output, not
only the implementer.

What this does not show. It is one occurrence in one response, so how often a model
does this is unmeasured, and so is whether the prompt sentence changes it. The
repair is silent: nothing in the run record says it fired, and the original bytes
survive only in the retained raw file. A control character inside a string in a
canonicalized artifact such as a specification is now accepted as the line break it
resembles. Response length is likely a factor, since this was the largest single
response the phased stage has produced, but one sample does not show it.

## 2. Discarded output is undiagnosable

A rejected response whose bytes were discarded leaves only a truncated fragment
inside an error message.

Write raw model output to disk before validation and reference it from the run
record. It is also the only honest source of fixtures — see hazard 4.

## 3. A constrained field must have its constraint stated in the prompt

A field validated against a pattern the prompt never mentions will be returned
in the wrong shape and rejected wholesale, after the invocation is paid for.

Where the field feeds an identity — a finding ID derived from an intent key, for
example — it cannot be repaired downstream, because normalising it changes the
identity. The prompt is the only correct place.

Write a test that reads every prompt-building file and fails when a constrained
field is requested without its shape stated, and assert that every example value
a prompt advertises validates against the schema that receives it.

**Measured, 2026-09-04, $0.39572.** A live spec reconciliation answered three
findings correctly — including claiming both halves of a replacement, which is
what the prompt asks for — and every claim was refused, because each
`artifactText` carried the `- ` list marker of the artifact line while
`specNormativeNodes` derives an acceptance criterion as `<id>: <text>` with no
marker. The prompt asked for "the exact text of the added or removed node" and
never said what a node's text is, so the author copied the line it was looking
at. The run blocked at the `spec_review` gate. Two things fixed it and both
were needed: the prompt now states the node form per artifact kind, and
`normalizeNodeText` tolerates one leading marker on **both** sides of the
comparison. The retained response is committed at
`test/fixtures/recorded/spec-reconciliation-web-calculator-list-marker.json`
and is the contract test for the fix. The lesson generalizes past this field: a
constraint stated as "the exact text of X" is not stated at all unless the
prompt also says what X's text is, and a shape a document schema *requires* the
author to read (`- AC-001: …`) will be the shape the author sends back.

**Measured, 2026-09-05, $0.41049.** A live spec reconciliation answered two
findings about a gap in the acceptance-criteria numbering the most direct way
the document allows — by explaining the gap in place, as the first line under
`## Acceptance criteria`. `validateSpecDoc` read every line under that heading
as a criterion, so the explanation became a criterion whose ID is `Note`, and
the run blocked terminally at the `spec_review` gate with no remediation round.
The prompts stated the format of a criterion ID, which the author obeyed for
all twenty-three real criteria; none of them stated what the *section* admits,
so a line that is not a criterion at all was never ruled out. Both boundaries
were needed again: the prompts now state that every non-blank line in each
structured section is one entry and nothing else, and the parser now refuses a
non-member line by naming the section's rule instead of describing it as a
malformed entry of a kind the author never wrote. The retained response is
committed at
`test/fixtures/recorded/spec-reconciliation-web-calculator-numbering-note.json`
and is the contract test for the fix. The lesson generalizes the entry one
level up: the *membership rule of a section* is as much a constrained field as
the format of a value inside it, and the section a schema forces an author to
write in is the section that author will answer a finding in. The same run
showed the second half of the shape — the finding that invited the note was
itself the ordinary residue of another guard, since stable IDs leave gaps when
an obligation is withdrawn, and the review prompt had never said so.

**Measured, 2026-09-05, $1.25141.** The next paid chain, with the section-
membership fix in place, passed `spec_review` and blocked three stages later at
`plan_review` on the same shape one document over. Three plan reviewers reported
that a coverage entry omitted a second implementing artifact, and the author
answered by naming both: `AC-008 -> src/index.html, src/calculator.js`. A
Coverage line admits exactly one artifact path, `plan-doc` takes the whole
remainder after the first `->` as the target, and no prompt had ever said the
right side was singular — so the pair became one path, no signed scope entry
matched it, and the gate refused it as a promise nobody approved. Fixed at both
boundaries again: the three authoring prompts state that a coverage line naming
an artifact names exactly one approved scope path, and the refusal now names
the failing target and appends that rule to the scope error unconditionally —
inferring from punctuation whether the target "looks like" a list was rejected
in design review, since a path may legally contain any of it — rather than
leaving the operator with a criterion ID and the word "scope". The retained
response is committed at
`test/fixtures/recorded/plan-reconciliation-web-calculator-multi-artifact-coverage.json`.

What this instance adds to the entry: **a finding a document's schema cannot
express will be answered by breaking the schema.** The reviewers were factually
right and the author was co-operative, and between them they produced a
terminal block, because the only faithful answers — name one artifact, or reject
the finding — were never stated anywhere the author could read them. So the
prompt that requests a constrained field and the prompt that invites findings
about it have to agree: stating the constraint to the author while the reviewer
is still free to demand its violation buys one round of delay, not a fix. That
is why the plan review prompt now says which coverage concerns the document can
express.

**Measured, 2026-09-26, $1.2429162 and $2.141577.** Two consecutive paid
`note-keeper` spec reconciliations answered upstream findings, and both were
refused as structure errors. Run 2 sent each upstream decision with a complete
`proposal` but no `changedLocations` field at all. Run 3 sent
`"changedLocations": []` but no `proposal`, after describing the same open
decisions in the revised specification's own summary and out-of-scope prose.
Every other decision in both rounds was well formed, and each time the whole
round was discarded and the run blocked at the `spec_review` gate. The cause
was the prompt. A decision's required fields depend on its disposition, but the
prompt advertised one `addressed`-like entry and said only that
`changedLocations` was "Empty when you change nothing, as for
cannot_determine". That reads as permission to leave the field out, and it
never showed an upstream decision at all. The validator stayed strict. The
contract now says `changedLocations` is required on every decision and `[]`
when nothing changed. It says prose in the document is not a proposal
candidate. It advertises one complete shape per disposition, and a prompt test
fills each shape's placeholders and runs it through `validateReconciliation`.
The addressed shape shows its common branch, one claimed node, because
advertising `"normativeChanges": []` there would invite the inverse omission.
The prose-only `[]` branch is stated in words, not shown as a shape.
The retained responses are committed at
`test/fixtures/recorded/spec-reconciliation-note-keeper-missing-changed-locations.json`
and
`test/fixtures/recorded/spec-reconciliation-note-keeper-missing-proposal.json`,
and their replays pin that both are still refused. What this instance adds: an
advertised example has to validate on each disposition the validator
distinguishes, not only the common one, and an example of the rare branch
teaches the rare branch. How often a live reconciler now
complies has not been measured.

## 4. Fixtures and code agreeing while both are wrong

A hand-written fixture that declares one thing and does another will pass
forever. A suite can complete full delivery runs to a terminal state while
delivering nothing, because the fixture's declared artifacts and its written
artifacts are never compared.

- No hand-written fixture defines correctness. Expected values come from a
  schema, a response recorded from a real run, or the design document.
- Validate what shared fixtures emit against the same contract real output is
  held to.
- Prove a guard by breaking what it guards and confirming the failure, then
  restoring. A test that has never failed has demonstrated nothing.

## 5. Completion without delivery

Scope enforcement answers "may this stage write here". It does not answer "did
anyone write it at all". Without the second check, a run can route work to a
later stage, have that stage mark it complete, and reach a terminal state having
written nothing the specification declared.

Before a run may complete, every declared artifact must appear in the changed
paths of an applied patch.

## 6. Promises a later stage cannot keep

If a criterion's artifacts are produced by a stage that runs after the stage
being planned, coverage cannot be promised for it now: at reconciliation time
the artifact does not exist, and the only way to satisfy the promise is a false
attestation. Refusing the downgrade later strands the run with no in-place
repair.

Refuse the unkeepable promise at the planning gate.

## 7. Retries that vary nothing

A retry that resends an identical prompt receives identical output. If a retry
does not vary the prompt, the context, or the model, it is not a retry — it is a
slower failure with a larger bill.

## 8. Windows executable resolution

Node's spawn hardening breaks npm-shimmed executables, which kills every
external executor on Windows. Handle a shim only on a path that actually uses
one; do not route a native executable through `cmd.exe` on the assumption that
it is still a shim.

**Measured, 2026-09-07.** Claude Code 2.1.263 resolves on the development host
as the native executable `~/.local/bin/claude.exe`, while the harness and paid
driver still carried the older `claude.cmd` assumption and spawned through
`COMSPEC`. Direct spawning resolves the same executable PowerShell launches,
preserves stdin and captured UTF-8 bytes, removes the extra argv parser, and
avoids Node's shell-argument security deprecation. Verification commands keep
their separate shell path because `npm` is still an actual Windows shim. Test
the concrete executor by direct spawn and test shims only at the command path
that uses them.

## 9. Unverified hook interpreters

A hook installed as bare `node` fails when the harness process does not have the
interpreter on its PATH, and the visible symptom is usually a missing context
variable rather than a PATH error — which misdirects debugging onto the
protocol.

If setup installs anything that spawns an interpreter, verify at setup time that
the interpreter resolves in the environment that will spawn it.

## 10. Exact-match model acceptance against moving aliases

Validating an effective model against a literal list authored at initialisation
time breaks whenever a routed alias is remapped, and the check runs after tokens
are spent.

Resolve aliases at run start and snapshot the resolution.

## 11. A default installation that cannot complete a run

Agents bound to mock-backed executors are correctly rejected by governed stages,
and a capability required by a late stage may be declared only by a mock
executor. The result is a fresh install that cannot complete a run at all.

A default-seeded repository must be able to complete a run, and a test asserts
it.

## 12. Configuration divergence between targets

Two repositories with different settings behave as different products — one can
start a run from a given surface and the other cannot, with an error describing
a protocol requirement rather than a setting. The difference is then diagnosed
as a regression.

Make the effective configuration visible in status output, and make the
default-seeded repository the tested case.

## 13. Specifications inventing obligations

Specification authoring adds requirements the source never stated: constraints
the brief never mentioned, implementation technologies pushed into acceptance
criteria, requirements with no traceable origin. Removing one does not stop the
pattern; the same requirement reappears embedded in another criterion.

Require every criterion to trace to a stated obligation, mark derived ones, and
surface invented ones to a human rather than relying on review to catch them.

## 14. Independence that cannot be proven

When reviewers run as subagents inside the same harness session that authored
the work, independence cannot be verified from outside — the system is taking
the harness's word for it.

Record the distinction rather than claiming the guarantee:
`unverified_self_attestation` against `configured_standalone` for a separately
spawned process.

## 15. A declared sandbox and a compliant sample do not make a proposal subprocess read-only

The first end-to-end run of `bw implement` against the real harness blocked
with `add requires the file not to exist: src/clamp.mjs`: the implementer had
written the two files into the run's worktree with its own tools and then
returned them as `add` patches. The gate's existence check is correct; the
prompt and one earlier compliant smoke are not evidence that the process is
read-only — the same prompt and model wrote the files on one run and did not
on another.

Require proposal subprocesses to run read-only at the invocation boundary
(restricted mode, an explicit read-only tool inventory, no session
persistence) and have the stage assert the worktree is clean before and
after the dispatch, blocking the run and naming the paths when anything
changed. A prompt-level instruction is a request; the tree is checked, not
trusted.

## 16. A remediation loop aimed at the wrong artifact cannot repair an upstream omission

A reviewer's finding is sometimes correct about a concern the artifact under
review cannot itself fix, because the missing decision sits upstream of it.
Routing that finding back to the same author for another revision round asks
the author to correct a document that has nothing wrong with it, and the
author can only comply by inventing something to change. Two observations,
not a rate: the plan-stage smoke's 2026-08-30 round-2 finding caught the plan
inventing a rejection requirement the specification never stated, and step
5b's Task 1 prototype recorded an author responding to a security finding by
adding an acceptance criterion — a "single atomic exclusive-create
operation" — that the design never stated, marking the finding `addressed`,
and the artifact gate passed. No run record in this repository describes a
complete wrong-artifact remediation loop end to end;
both are observations of this pattern's precursor, and this entry says so
rather than implying a filed incident that never happened.

Require every added or replaced normative node a reconciliation introduces to
be claimed by exactly one decision and grounded in an excerpt from the
governing upstream input. A decision that claims a node with a duplicated or
ungrounded citation converts to a blocking `cannot_determine`; a node no
decision claims at all — Task 1's actual retained case, replayed against the
shipped validator on 2026-09-03 — is never silently accepted as `addressed`
either, but surfaces as unclaimed and blocks the whole round rather than
converting one decision, because no decision exists to convert. Either path
gives a genuinely upstream concern a route other than another revision of the
wrong artifact. This mitigation proves textual occurrence — that the cited
words are in the governing input, in that order — never that they logically
support what was added or rejected; neither the grounding match nor the
mechanical artifact gates are evidence of semantic correctness, and no panel
independently confirms either.

**The code-review counterpart, 2026-10-13.** Code-review remediation has the
same shape one stage later: the implementer receives every finding, so a
finding that asks for more than the approved specification states becomes code
nobody asked for. Crew-chatter run 6 traced it end to end. Round-1 finding #200
asked for sessions to be invalidated on a password reset, which the
specification does not require ("A successful reset replaces the password hash,
so the old password no longer signs in."); the remediation added that code, and
round 2 found #211, a real lost-edit defect inside it. The remedy is the
code-review reconciler (`ARCHITECTURE.md` section 12): before each remediation,
the frozen number of calls (two by default) judge every finding, and a finding
is withheld only when every call rejects it with an excerpt that occurs in the
approved specification. Two paid replays on run 6's findings, 30 Haiku 5.5 calls
for $0.12858311 in total, preceded it
(`test/fixtures/recorded/code-review-reconciler-replay-crew-chatter-run-6.json`
and `test/fixtures/recorded/code-review-reconciler-test-5-crew-chatter-run-6.json`).
All ten calls of the first rejected #200 with that exact sentence and rejected
no finding labelled keep. Across the twenty calls of the second, one call wrongly
rejected a finding labelled keep (#906) and three calls kept a finding labelled
reject (#905). The limit is this entry's own: one call in the second replay
rejected #213 with an exact quote about password reset that does not support
the rejection, so the excerpt check proves the words exist, not that they apply.
That is why a rejection needs every call to agree. What this does not show: the
replays used one project's specification, no live run has used the
reconciler, and how often two calls agree on a wrong rejection is unmeasured.

## 17. A reconciliation that answers a finding by deleting the obligation

The mechanism, as it stood before the remedy below shipped: the normative-delta
check derived additions only. `deriveAddedNormativeNodes` counts the after-set
up and the before-set down and emits the positive remainder, so a node present
before reconciliation and absent after produced nothing at all — no decision had
to claim it, no excerpt had to ground it, and the unclaimed-node block never
fired. That was the design's shape rather than a divergence from it:
`ARCHITECTURE.md` section 12 specified that "every added node ... must be
claimed exactly once" and said nothing about a removed one.

The consequence was that an `addressed` decision could discharge a reviewer's
finding by deleting the acceptance criterion the finding was about. Every check
was satisfied: the canonical finding carried exactly one typed decision, nothing
was added so nothing required grounding, the revised document still passed its
mechanical gates, and the artifact hash changed exactly as a legitimate revision
would. Because spec reconciliation runs before the approval gate, the operator
would then sign a specification with the obligation already removed, and the hash
binding that protects every later stage would bind the weakened text. Deletion is
the cheapest way to make a finding go away, and it was the one revision the delta
check could not see.

This entry is a code-path gap found by reading, not a filed incident. Nothing
here describes a run that did this, and the entry says so rather than implying
evidence that does not exist. What made it worth recording before it was
observed is that it would have been invisible if it happened: the mechanism that
would catch it did not exist, so no run record could report it, and absence of a
report was therefore not evidence of absence.

The normative delta now accounts for removals as well as additions.
`deriveRemovedNormativeNodes` derives the other direction — the same multiset
diff with its arguments swapped — and the claim accounting in
`validateReconciliation` consumes each claimed `artifactText` against the added
set or the removed set, so a node present before reconciliation and absent
after must be claimed by exactly one `addressed` decision, the only disposition
that may carry `normativeChanges`, and grounded in the governing input by the
same check any addition passes. An unclaimed removal is reported in
`unclaimedRemovals`, and both stages abort the round by name rather than
persisting decisions the accounting cannot support. Where an obligation really
is wrong, the routes that already exist are the honest answers — a grounded
rejection, or an upstream disposition carrying a proposal candidate — and both
reconciliation prompts now tell the author so. Silent deletion is not one of
them.

**Measured live, 2026-09-04, $1.34097.** A completed run's plan reconciliation
answered a load-order finding by replacing a normative task and claimed both
halves — the superseded text and its replacement — in one `addressed` decision,
each grounded in the approved specification, on its first attempt with no
retry. The delta was three added nodes and one removed; nothing converted,
`unclaimedRemoved=0`, `plan_review` passed, and the run delivered every
declared artifact. Replaying that same response with the removal suppressed
from the before-set — addition-only accounting, the behaviour this remedy
replaced — converts the decision to `cannot_determine` and blocks, so the
acceptance was this mechanism's doing rather than incidental. The response, the
two plan revisions, the governing specification, and the provenance recording
how each was identified are at
`test/fixtures/recorded/plan-reconciliation-web-calculator-prd.json`, and both
replays are committed tests. What that run did not show: no claim carried a
list marker, so hazard 3's tolerance was untouched, and its spec round produced
no normative claim at all.

## 18. Delivery proven, correctness never inspected

A chain can prove that every declared path was committed — entry 5's remedy —
and that every frozen verification command passed, and still have had nothing
read the code. The two guarantees are about existence and about exit codes;
neither is about whether the change does what the specification asked for.

The observation is a completed run, not a filed defect. The web-calculator run
of 2026-09-04 cost $1.34097, delivered four artifacts, and passed every gate to
`completed`. Its frozen verification commands were `node --version` and
`npm --version`, which prove that a runtime exists and nothing whatever about a
calculator; `delivery_check` proved each declared file appeared in the patch
range. The calculator did work — established by opening it by hand — but the
system had no opinion either way, and would have recorded the same
`completed` for a file that was present and wrong. Like entries 16 and 17,
this is a gap found by reading a run's own record rather than a report of
something that went wrong.

Before a run may complete, at least two separately dispatched reviewers, each
recorded as `configured_standalone` — section 6 is explicit that the audit can
prove a separate process and never independence — must have read the committed
change against the approved specification and plan; every finding must be
retained as attributable, immutable evidence; and a deterministic gate over
those findings must sit between verification and delivery.

Two later paid chains proved the reviewer boundary and exposed the next gap:
both reached `code_review` and blocked on correct `high` findings, one with two
defects and one with a different single defect. A fresh run merely produced a
different implementation and finding; it did not repair the reviewed commit.

What now enforces the complete boundary is the bounded `code_review` loop. A
frozen panel of two through five explicitly specialized reviewers reads the
specification, plan, changed paths, and complete diff through the current
verified commit. When a non-final panel reports actionable current-code
findings, one frozen implementer receives all of them, its guarded patch is
committed, the frozen verification commands run against that commit, and the
full panel reviews it again. The profile permits one through five total panel
executions. The last panel receives no remediation; it blocks only at or above
the independently frozen severity threshold and retains lower-severity reports
as non-blocking evidence. Code review accepts no upstream classification and
creates no proposal, spike, waiver, or human-review decision.

The residual is worth stating plainly. The final gate proves that no reviewer
asserted a severity at or above the frozen threshold. It does not prove the
code is correct, and accepting a below-threshold finding is an explicit release
policy rather than proof that the finding is harmless. A change whose diff,
specification, and plan exceed the frozen prompt ceiling is refused rather than
reviewed in part. A verification configuration that proves nothing about the
artifact — `node --version` against a calculator — is still accepted: a
stronger `governed.yaml` is the operator's decision, not the system's.

**2026-10-12: a split is the route past the review-prompt ceiling.** The 1 MiB
prompt ceiling bounds the diff one panel can read, which the project learnings
estimate at roughly 130 to 160 plan items. Building in segments cannot lift it,
because code review reads the whole range once. A design that large is now
offered a split into features after spec review, each of at most the frozen
threshold of declared files (entry 20), and each feature is reviewed whole by
the unchanged panel. Nothing reviews less. Whether a real feature's diff stays
under the ceiling is unmeasured.

## 19. An inactivity budget over non-streaming output is a wall clock

An idle timer that resets "on any output" measures inactivity only if the
process produces output while it works. `claude -p --output-format json`
writes nothing until the whole response is finished, so the timer sees silence
for the entire generation. The idle budget then is a hard wall-clock cap on
every dispatch, and a long response is killed while it is still being written.
`src/executor.ts` already said so in a comment ("the idle budget is in practice
the whole generation time"), but nothing measured what that costs.

The kill also defeats entry 2. A process killed before it writes a byte leaves
nothing to retain. The harness reports no cost for it, so the spend is unknown,
and nothing records what the model had written by then.

**Measured, 2026-09-27, $4.19 known plus one dispatch of unknown cost.**
Team-notes run 4 passed spec review, approval, plan, and plan review, then
dispatched the implementer with a 24-path approved scope. The implementer must
return every file's complete content in one response. The harness killed it at
1,800,194 ms, the frozen 1800-second idle budget, with `timedOut`, and the
retained raw file is 0 bytes. The run blocked at `implementation` and cannot be
resumed. The largest implementation dispatch recorded before this ran
780,568 ms.

Require the executor to emit output while it generates, so that the idle timer
measures real inactivity, and keep the separate absolute ceiling for a process
that stays active and never finishes. Where an executor cannot stream, call its
idle budget what it is, a per-dispatch wall-clock limit, and size it to the
largest response the run will request.

**Remedy, 2026-09-28.** The executor now runs `--output-format stream-json
--include-partial-messages --verbose` (`src/executor.ts`), so each text chunk
resets the idle timer. The recorded capture is
`test/fixtures/recorded/harness-stream-json-envelope.json`: 967 lines over a 45 s
dispatch, the longest gap between stdout chunks 571 ms, and every field
`parseEnvelope` reads present on the final `result` line. `parseEnvelope` now
takes that newline-delimited shape and refuses every other one by name. A killed
dispatch keeps the stream written before the kill, which run 4's 0-byte file did
not. The stream is about 25 times the result text (text chunks alone about 18
times), so the 1 MiB result cap now applies to the parsed result and a separate
64 MiB ceiling bounds retention
(`ARCHITECTURE.md` section 20). What this does not show: the idle and absolute
timeout values are unchanged, whether a 24-file implementation now finishes
inside the 3600-second ceiling is unmeasured, and gaps during extended thinking
were not sampled because the capture used none. One paid run past
`implementation` is the end-to-end check, and it has not been made.

## 20. One dispatch over a plan larger than one response

The implementation stage once asked a single implementer dispatch to return every
file the approved plan covered, each with its complete content, as one JSON
response. A plan that needs many files can be more than one response carries, and
the three ways that failed are all measured, on the same team-notes design.

**Measured, 2026-09-27 to 2026-10-07.**
- Run 4 was killed at 1,800,194 ms, the frozen idle budget, with a 24-path scope;
  its retained raw file was 0 bytes (entry 19).
- Run 5 failed with `API Error: Claude's response exceeded the 64000 output token
  maximum` after four consecutive `max_tokens` messages, each 64,000 tokens of
  thinking and none with a write. The raw result reports $2.9195696 that the store
  did not record.
- Run 6 (Sonnet 5.5 at `medium`, a 57-task plan) completed seven turns in 848,053 ms
  for $1.2840398 and returned a valid result with `status: "blocked"` and no patch.
  Its summary said it could not write the whole plan in one response and be
  confident the JSON-escaped file contents were correct, and that a truncated or
  malformed patch would be worse than none. The stage recorded `implementer
  returned status blocked, not proposed`. The response and the plan are committed
  at `test/fixtures/recorded/implementation-team-notes-run-6-refusal.json` and
  `test/fixtures/recorded/plan-team-notes-run-6.json`.

- Run 7, the first run under phases (2026-10-04, Sonnet 5.5 at `medium`, a plan of
  71 to 80 tasks, so eight phases): phases 1 to 3 applied and committed; phase 4
  took 22 turns and 391,664 ms for $1.0709032 and proposed `modify` for
  *src/server/routes/import.ts*, a scope path no phase had created, so the patch
  applier refused it (`modify requires the file to exist`). The prompt already said
  to use `add` for a file that does not exist yet; the model could not tell which
  scope paths earlier phases had created, because phase 1 had written files that
  belong to later tasks. The run blocked at $5.3116814 total, $2.3721 of it
  implementation. Each phase prompt now lists which scope paths exist in the
  worktree and which do not, computed with the applier's own existence test. That
  removes the guess; it does not make a task that needs no file in scope possible.

- Run 9 (2026-10-04, a plan of five phases): phase 1 applied; phase 2 returned an 11-file,
  113,649-character patch that failed to parse on one raw line break inside a string
  (entry 1, item 10), and the run blocked at $4.8703008. That is a parse failure, not a
  size or existence failure, and the extractor now repairs it.

- Run 12 (2026-10-07, a Next.js team-notes design, 11 dispatches, $3.0802364): the
  plan passed its review with a `## Tasks` section of 226 non-empty lines, 53 of them
  top-level bullets and 173 indented beneath them. The implementation stage refused
  it before its row, worktree or any dispatch ("the approved plan has 226 tasks, more
  than the frozen ceiling of 80"), because it counted lines. $1.8167862 of the spend
  was the plan and its review; none was implementation. The author nested its detail
  in the draft (201 task lines, 53 top-level), the self-critique and the reconciliation
  (226 each, 53 top-level), though each plan prompt says one plain task per list line.
  The plan and those per-dispatch counts are committed at
  `test/fixtures/recorded/plan-team-notes-run-12.json`. The count now follows items
  (below); no implementer has run on that plan.

Run 6 also named a second, separate objection: the target still held a Next.js
scaffold the plan never mentioned, and the system refuses patch deletions. Phasing
does not touch that. It is a mismatch between the plan and the target, and it was
handled by clearing the throwaway target.

Bound what one dispatch is asked to return by a unit the plan already has, and
refuse a plan that cannot fit before any implementation spend. The implementation stage
now splits the approved plan's tasks into phases of `implementationPhaseTasks`
(seeded at 10, the operator's choice on 2026-10-04) and dispatches the implementer
once per phase, each proposing against the head the previous phase committed. The
model keeps nothing between phases, so a phase sees the earlier ones only through
the checkout. A plan with more tasks than `implementationPhaseTasks` times
`implementationMaxPhases` (seeded at 8, an assistant value) is refused before the
stage row exists. Both values freeze at run start. A phase that fails blocks the
run and is not retried (entry 7); the earlier phases' commits stay on the retained
branch, and a fresh run is the repair.

What this does not show. Ten is not measured as a good size, and tasks differ
widely in size, so ten items can still be more than one response. A task is a
top-level list item of the plan's `## Tasks` section, and the lines indented beneath
it belong to it (`taskItems` in `src/plan-doc.ts`, 2026-10-07, after run 12). The
ceiling and the split count items, so a nested plan is neither refused for its line
count nor cut mid-task. The plan gate still counts every line as a normative node
(entry 17), so a reworded or removed nested line still needs a claim. A plan of more
than `implementationPhaseTasks` times `implementationMaxPhases` real items still
passes the plan gate and is refused, after the spec and plan stages are paid for. A
phase whose tasks change no file in the signed scope, such as a trailing "run the
build" task, has nothing to return and blocks the run. No paid run has
yet completed `implementation` under phases. Verification and code review still
run once, on the whole range, so a large implementation still sends its entire
diff to each reviewer under the prompt ceiling (entry 18's residual), and whether
a 57-task diff fits is unmeasured.

**2026-10-12: an oversized design is offered a split before the plan is paid
for.** A plan with more items than the ceiling is still refused at
implementation. But a specification that declares more files than the frozen
`designSplitPathThreshold` now gets a split proposal right after spec review,
before approval and the plan (`ARCHITECTURE.md` section 12). Crew-chatter run 4
is the motivating case: 62 declared files, then an 86-item plan refused at the
ceiling of 80 after $4.94. The threshold, 30, is the ceiling divided by the
highest recorded ratio of plan items to declared files. Across eleven runs of
two test designs that ratio ran from 1.0 to 2.6, highest on team-notes run 10
(20 files, 52 items); the runs are committed at
`test/fixtures/recorded/declared-paths-vs-plan-items.json`.

What this does not show. The ratio comes from two designs. A design under 30
files can still produce more than 80 items, and most designs over 30 would have
fit: crew-chatter runs 2 and 3 built 51 and 52 items from 51 and 52 files, and
nine of the eleven recorded runs would have been offered a split. An operator
who denies the split goes on to the same ceiling. No real model has proposed a
split, and no pair of features has been built.

## 21. Agents are never told the gate that will judge their work

The frozen `governed.yaml` commands decide whether delivered code is accepted at
all, and no prompt that produced the specification, the plan or the code stated
them. Each author wrote for the design alone. The commands ran after everything
was paid for, so a design the commands could not accept stayed invisible until
the money was spent.

**Measured, 2026-10-05, $7.3048866.** Team-notes run 10 made 16 dispatches and
blocked at `verification` on `typecheck`, which failed on a partial
`npm install`. The cost is the sum of the 16 `costUsd` rows in
`test/fixtures/recorded/run-10-dispatch-context.json`: $2.3525764 for the ten
spec and plan dispatches and $4.9523102 for the six implementation phases. Its
frozen commands were `npx tsc --noEmit`, `npm run lint` and `npm run build`. After
an operator-authorized `npm ci`, a fresh worktree of the delivered commit
`d62ba9d` still failed `npx tsc --noEmit` (two type errors) and `npm run build`
("Couldn't find any `pages` or `app` directory"). The delivered code is a Node
`http` server in the target's *src/server* and a plain TypeScript client in its
*src/client*; `package.json` was not touched, and its `build` script is
`next build`. Those two results come from a manual check recorded in the project
learnings, not from the run record.

**The mechanism.** None of the eight builders that ask an agent for a
specification, a plan or a patch took the run's verification config, so no
prompt carried the commands. Two facts made that worse. Dispatches 1 to 10 (spec,
plan and their reviews) ran with the BuildWorks checkout as their working
directory, because the spec and plan stages set none and inherit the directory the
operator launched from; the implementation and code-review stages set the run's
worktree, and dispatches 11 to 16 ran there. And the scope is signed before the implementer
can read the target, so an implementer that learns `npm run build` needs an `app`
directory still cannot add one, since a patch outside the signed scope is
refused. Run 6's Next.js scaffold objection (entry 20) is a cousin: the target
held a layout the plan never mentioned. That run did not measure what any agent
knew about the commands, so it shows the same kind of mismatch, not this cause.

**What each prompt states now.** State the frozen commands, as facts the system
computes, to every agent whose output they judge, and give an author that cannot
inspect the target a human-gated way to ask. `src/prompts.ts` renders the run's
frozen `profile.verification`, never the working copy of `governed.yaml`, into
eight prompts, each with one rule for its role.
- The spec draft and self-critique are told the commands, that they are not
  obligations (no acceptance criterion and no artifact exists only because a
  command does), and that when compatibility cannot be established, even for a
  design that names a stack, they record one open decision beginning
  `Verification:`.
- The spec reconcile prompt names that decision as the one exception that routes
  `upstream_blocking`, so it opens an operator question at `spec_decision`. The
  fold prompt folds exactly the declared artifact paths the operator's answer
  names.
- The plan draft, self-critique and reconcile prompts forbid a task that runs,
  repeats or checks the commands, because a task that changes no scope file can
  leave its phase with nothing to return, and a phase that returns no patch blocks
  the run (entry 20).
- The implementer is told the commands first run after the last phase and again
  after any code-review remediation, so a phase that leaves one failing is not a
  defect by itself, and to read what each command runs before choosing a file's
  content.

Replayed against run 10, the spec author would have asked the operator what each
command requires and which artifact paths that needs, before approval and before
any plan or implementation spend. It would not have caught the partial install
(an environment fault no prompt can prevent) or the two type errors (code
defects).

What this does not show.
- One paid run has used these prompts: the web calculator on 2026-10-06, 15
  dispatches for $1.61751, completed. Its frozen commands were `node --version` and
  `npm --version`, so it drew no `Verification:` question, no criterion or plan
  task about the commands, and no operator pause. It says nothing about a real
  build command, whether a spec author asks when one needs a layout the design
  never names, or what a question costs the operator. A question is expected on
  nearly every run launched outside the target, because the author cannot read
  it; that load is unmeasured.
- The reconcile exception is a prompt rule. The reconciler can still choose
  `upstream_follow_up`, which opens no question, and the gate passes it.
- Code-review remediation is not told the commands, by operator decision on
  2026-10-05, so a remediation patch can break a command it never saw.
- The launch-directory gap stays: spec and plan dispatches still inherit the
  directory the operator launched from, and an author launched outside the target
  cannot read it.
- `parseGovernedConfig` bounds neither the number of commands nor a token's
  length. A config large enough to push a prompt past `PROMPT_MAX_BYTES` blocks at
  the first dispatch it overflows, refused by name, possibly after earlier
  dispatches were paid for. Nothing truncates the commands.
- The test fixtures' stage emitters still route by searching the whole prompt for
  words such as `self-critique`, so command data containing one would misroute a
  fixture. A test keeps the fixtures' command names clear of those words; the
  emitters are unchanged.

**2026-10-12.** The launch-directory gap above is closed for authors. The spec
and plan author dispatches (draft, self-critique, reconciliation, decision fold
and split) now run with the target's root as their working directory, and the
spec prompts say so (`ARCHITECTURE.md` section 7). The spec and plan reviewers
still start in the launch directory, because the target's `.governance/` holds
the other reviewers' raw reports and nothing enforces the executor's denied
paths (entry 14). Whether a spec author now reads the target before asking is
unmeasured.

## 22. A guard that counts ignored files, after a stage that writes them

Two guards can each be right and still block every run between them. Code
review's clean-tree guard counts git-ignored entries, so that a reviewer or the
remediation implementer writing into an ignored path is visible (entry 15). The
verification stage runs the frozen commands in that same worktree, and
`npm ci` and a build write `node_modules/` and `dist/`, which are ignored. Every
target whose commands install packages or build output therefore failed the
guard after verification passed. Every run that had reached code review before
used version-only commands, which write nothing, so nothing showed it.

**Measured, 2026-10-13, $4.16645777 recorded before the refusal.** Crew-chatter
run 6 (the first feature of an approved split) built four phases and passed
`npm ci`, typecheck, lint and build. The run then refused to enter code review:
"worktree is not clean at the code_review boundary: !! backend/dist/ !!
backend/node_modules/ !! frontend/dist/ !! frontend/node_modules/ !!
node_modules/". No dispatch was lost: the refusal came before code review
spent anything.

**Remedy.** When every command passes, `verifyCommit`
(`src/commit-verification.ts`) removes the ignored entries the commands left,
records each removed path in a `cleanup` audit event, and blocks if a removal
fails. It keeps a path that holds the verification's own evidence. No agent runs
between the last command and the removal, so the guard still sees anything an
agent writes. The same function serves the verification stage and code-review
remediation, so both are covered. What this does not show: a command that writes
an ignored path outside the worktree is untouched, and whether removal of a large
`node_modules/` ever fails on Windows (a locked file, a long path) is untested.

## 23. A fix that never sees the decisions behind the code it changes

Code-review remediation hands the implementer the findings, the approved
specification and plan, and the full diff. It does not hand it the plan-review
decisions that shaped the plan: which rule a reconciler removed and why, or
which obligation it routed upstream as one the specification lacks. A fix for
one finding can therefore put back a rule the plan removed, add an obligation
nobody approved, or fix one instance of a defect and leave its twin. The next
panel reviews that fix, and when it is the final panel nothing can repair what
it finds.

**Measured, 2026-10-13, $4.83619668 over 22 dispatches.** Crew-chatter run 6 (the
total is the sum of the run's `agent_run` costs, queried read-only from its store
on 2026-10-14 and recorded in the fixture's provenance). Round 1 reported 13 findings. One remediation dispatch
(`claude-sonnet-5-5`, $0.5517149) committed `ca0bd0e`. Round 2 reported 7
findings, four with a `high` report (#208 to #211), and the gate blocked. Every
one traces to the remediation or to round 1
(`test/fixtures/recorded/code-review-crew-chatter-run-6.json`; the facts below
are pinned in `test/code-review-run-6-evidence.test.ts`):
- **#208 and #210** (one defect, two reviewers): the latest edit waited behind a
  save already in progress, against AC-015. To fix #199, the remediation put back
  the one-request-in-flight rule that plan reconciliation had removed for AC-015
  (#187). The approved plan it received said "A send is never deferred behind an
  earlier request"; nothing told it why.
- **#211**: a 401 on save dropped the unsaved edit. It sits inside session
  invalidation the remediation added for #200, which plan reconciliation had
  routed upstream as an obligation the specification lacks (#189).
- **#209**: a NUL byte in the email reached Postgres. That defect was already in
  the round-1 reviewed commit `bb7f3f6`, and the round-1 panel missed it. The
  remediation fixed the NUL byte in the notes route (#201) and nowhere else. A
  paid replay of the round-1 security prompt against `bb7f3f6`
  (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`)
  found #209 itself, `validateEmail` admitting a NUL byte, in 1 of 10 control
  calls (`control-4`) and in 1 of 10 calls of a reworded prompt (`b-8`). One more
  control call (`control-6`) found a NUL byte in the email on the sign-in path, so
  a NUL byte in the email was found in 2 of 10 control calls.

**What answers it, and how strongly.**
- #211's cause has a check: the code-review reconciler (entry 16,
  `ARCHITECTURE.md` section 12) withholds a finding from remediation only when
  every frozen call rejects it with an excerpt found in the approved
  specification. Its replay rejected #200 in 10 of 10 calls.
- The rest are requests. The remediation prompt now tells the implementer to
  re-read, before returning, every plan task and acceptance criterion that
  governs the code it changes, because a fix that breaks one is not a fix, and
  to look for the same defect in every other file of the approved scope. Each
  phase prompt tells the implementer to read back its tasks, and the criteria
  whose Coverage line names a file it returns, against the files it returns. After the
  last phase, one self-review dispatch reads the whole change against the plan
  and specification and may fix what it finds (`ARCHITECTURE.md` section 12).

These mitigate the mechanism; they do not close it. The remediator still never
sees the plan-review decisions; giving it them is a separate operator decision,
not taken. The self-review is the implementer checking its own work: its
`agent_run` row reads `configured_standalone`, which describes process
isolation, not review independence (entry 14), and code review stays the
independent check.

What this does not show. No paid run has used these prompts or the self-review,
so whether a model follows the rules, or whether a self-review finds or fixes
anything, is unmeasured. Hazard 21's prompt rule did not stop crew-chatter run
2's lint failure. A rule that asks for a sweep does not raise a reviewer's
recall: #209 was missed by the panel, not by the rule. The self-review costs one
implementer dispatch per run, roughly a remediation dispatch on a change of this
size [Inference], and saves money only when it prevents a remediation round.
