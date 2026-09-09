# Prose before an unfenced JSON object discards a valid result

**Observed:** 2026-09-06, paid chain against the web-calculator design, run 1 of
target `bw-run-skill/1788674210677`. The run blocked at `spec`, its first stage,
after one dispatch and $0.08103.

**Hazards considered:** 1 is the entry this belongs to, and this is a shape its
own enumeration does not list — the seven documented shapes cover prose *around
a fence*, never prose before a bare object. 2 bears on why the diagnosis was
possible at all: the raw body was retained, so the refused response could be
re-parsed afterwards instead of inferred from a log line. 4 governs the evidence:
the response is committed rather than described, and it is what any fix must be
tested against. 3 is adjacent and was weighed: the prompt does state the
constraint ("Output the JSON object directly, with no surrounding prose"), so
unlike the two defects before it this is not a prompt that failed to say what it
wanted — the model was told and did it anyway, which is precisely the case
hazard 1 exists for. 7 bears on the repair: re-running varies only the sample,
which is why this is worth fixing rather than retrying.

## What happened

The spec author returned one line of prose, a blank line, and then a complete,
valid `AgentResult` object with no code fence:

```
Repo has no existing source files, confirming this is a greenfield build. I'll finalize the spec now.

{"status": "proposed", "agent": "spec-author", ... }
```

`extractJsonBody` (`src/parse-output.ts`) accepts exactly two shapes: a body that
parses in its entirety as JSON, or a body containing exactly one fenced block.
Prose plus an unfenced object is neither, so it refused:

```
spec.content.invalid — spec author body refused: no JSON object found in output
```

The stage aborted and the run blocked at stage 1 of 9.

**The response was not malformed.** `JSON.parse` over the substring from the
first `{` to the end of the body succeeds and yields the whole `AgentResult`,
with `status`, `agent`, `role`, `executor`, `summary` and
`proposedContentChanges` all present, and a twenty-criterion specification
inside it. A well-formed result was discarded for its packaging.

## Why this is a defect and not a model error

The prompt does say "Output the JSON object directly, with no surrounding prose,
no markdown fences, and no commentary", so unlike the two defects measured before
it, this is not a constraint nobody stated. The model was told and added a
sentence anyway.

That is the case hazard 1 is written for. Its rule is *strictness by
consequence*: refuse prose where bytes are canonicalized into an immutable
record, because dropping it silently corrupts the record — but where the result
is only schema-validated, tolerate. This extractor feeds schema validation; the
bytes that become the immutable record are retained separately and in full by
`src/raw-output.ts`, so nothing is lost by reading the object out of a body that
also carries a sentence. The extractor already applies exactly this reasoning to
tolerate prose around a fence. An unfenced object is the same situation with less
decoration, and it is the one arrangement of the same two ingredients the
extractor has no path for.

Hazard 1's enumeration is also incomplete, and that is worth fixing in the entry
itself: items 3 and 4 name prose before and after *a fence*. Nothing names prose
before a bare object, which is why a test suite that works the seven documented
shapes passes while this one blocks a paid run.

## Candidate remedies

**Disposition (2026-09-06):** remedies 1, 2 and 3 applied under
`docs/features/unfenced-json-extraction/plan.md`; remedy 4 not taken, for the
reason it states. The list below is kept as written so the choice stays visible.

1. **Fall back to the first balanced object.** When there is no fence, locate the
   first `{`, parse from there to the end of the body, and refuse only if that
   fails. Smallest change that admits the measured shape, and it cannot
   mis-accept: a body whose tail is not valid JSON still refuses, with the parse
   error named. Prose *after* an unfenced object would still refuse, which is a
   further shape nobody has measured — do not build for it until it is seen.
2. **Add the shape to hazard 1's list and to the extractor's tests.** The
   enumeration is the contract the parsers are held to, and a shape missing from
   it is a shape no reviewer will ask about. This is worth doing whichever code
   remedy is chosen, and doing it alone would leave the run still blocked.
3. **Say what was found, not only what was missing.** "no JSON object found in
   output" is false as written — an object was there. A refusal naming what the
   body did contain (a `{` at offset 103 that did not parse, or no `{` at all)
   would have made this diagnosable from the log rather than from re-parsing the
   retained bytes.
4. **Restate the constraint more forcefully in the prompts.** Cheapest, and the
   least likely to work: the constraint is already stated in the sentence the
   model disobeyed. Recorded so that choosing 1 is visibly a choice.

Remedies 1, 2 and 3 together are the set that matches how the two sibling
defects were closed: the code admits the shape, the catalogue names it, and the
refusal says something true.

## Evidence

The refused response is committed at
`test/fixtures/recorded/spec-author-web-calculator-prose-before-unfenced-json.json`
with a `provenance` block naming the run, the stage, the dispatch time, the
capture date, the cost, the effective models, what was dropped from the harness
envelope, and what was sanitized. Any fix should be tested by replaying it
through `extractJsonBody` and asserting the extracted object, not by a
hand-written string.

The retained target at `bw-run-skill/1788674210677` still holds the run and has
not been cleaned, but it is machine-local: the committed fixture is the copy
anything may depend on.

## Scope

This is a defect in a shipped component, found by the paid run authorized to
prove `docs/features/plan-coverage-single-artifact/plan.md`. It is unrelated to
that plan: the change lives in the plan stage and its prompts, and the run
blocked four stages before reaching any of it. It blocks that plan's Task 7 in
practice, and it blocks every other paid run until it is resolved, because it can
fire on any dispatch of any stage.
