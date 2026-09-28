# Streaming Harness Output — code review

**Reviewed document:** `docs/features/streaming-harness-output/plan.md`
**Reviewed change:** the uncommitted working tree on `streaming-harness-output` against `2447192`, Tasks 1-6 of the plan
**Reviewer:** an in-session subagent (not a billed `/code-review ultra`, which only the operator can launch); it read the code and ran only `harness-stream-fixtures.test.ts` and a scratch `parseEnvelope` script, and edited nothing
**Review date:** 2026-09-28
**Status:** reconciled

**Hazards considered:** 1 (the outer envelope became a new shape at the harness boundary; the parser refuses every other shape by name, and findings 2 and 5 concern edge shapes), 2 (a killed dispatch now retains the stream written before the kill; finding 4 concerns the exact-boundary case), 4 (the emitters are held to the recording; finding 6 concerns how much the recording proves about model matching), and 19 (the entry this change answers; finding 1 corrects a number in its remedy). Items 3, 5-18 add nothing here: no prompt, stage order, retry, executable path, hook, model alias, seeding, sandbox, obligation accounting, independence claim or review gate changed.

---

## Findings as reported

The reviewer reported 7 findings and no material defect: all 7 low. It verified
finding 1 by recomputing from the recording and findings 2 and 5 with a scratch
script. It inferred finding 3 without measuring the number of queued chunks.

1. **Low: `docs/hazards.md` entry 19 said the stream is about 18 times the result
   text.** The recording gives 321,434 stream bytes over 12,957 result bytes, about
   25 times. The 18 times figure is the text-delta lines alone.
2. **Low: `dispatchOnce` threw before auditing when a result line's `result` was
   not a string.** `Buffer.byteLength` rejects an object. A CLI emitting that
   shape is hypothetical, and the old code failed the same way one step later.
3. **Low: the `remaining <= 0` branch called `fireTimeout()` on every later
   chunk.** On Windows each call is a blocking `taskkill`; on POSIX a second kill
   of a reaped pid throws and settles early. No wrong result follows, only noise.
4. **Low: the exact-boundary guard is covered only while pipe chunks align with
   the ceiling.** A platform that delivers a chunk straddling the boundary would
   take the other branch and the test would still pass.
5. **Low: two missing tests.** Nothing pins that a nested `"type":"result"` is not
   counted, and nothing tests the result cap with multi-byte characters.
6. **Low: the model-match evidence is thinner than the docs implied.** The
   recording's `modelUsage` has one entry, so "selects exactly one" is trivially
   true. The `parseEnvelope` comment cited the deleted two-entry fixture.
7. **Low, three notes.** `STREAM_RETAIN_MAX_BYTES` is a live constant, not a frozen
   policy field. Retained streams are still written as `*.json` though they are
   NDJSON. The one-line single-object envelope still parses.

---

## Reconciliation

**Status:** reconciled

**Hazards considered:** the same entries as the review.

1. **Fixed.** The hazards entry now says about 25 times for the whole stream and
   about 18 times for text chunks alone.
2. **Fixed.** `parseEnvelope` refuses a non-string `result` by name, with the line
   number, and a test asserts the message. Breaking the check fails that test.
3. **Not reproduced, reverted.** A guard was added and a test counted `taskkill`
   spawns during the flood. The test passed with the guard removed in three runs,
   so it proved nothing and the guard was reverted. The POSIX path is unmeasured.
4. **Accepted.** The exact-fit case is what the flood test produces on this
   platform, and breaking that branch fails the test here. Coverage on a platform
   with different chunking is not established.
5. **Nested type fixed, multi-byte deferred.** A test now pins that a nested
   `"type":"result"` is not counted. The result cap compares `Buffer.byteLength`
   to a byte limit, so it is correct by reading; the multi-byte test is not written.
6. **Fixed in wording.** The comment now says the recording shows only that the
   match still runs, and that the two-entry case is evidenced by the committed
   recorded chain fixtures, which are one-line streams.
7. **Accepted as noted.** The live constant follows how `RESULT_MAX_BYTES` is
   already enforced; freezing it needs a policy-shape change no plan authorized.
   The `.json` extension misleads but nothing in `src/` reads retained raw files.
   The one-line envelope is the same schema, a stream of one line, not a second
   shape.
