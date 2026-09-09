import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractJsonBody } from "../src/parse-output.ts";

test("1. bare JSON is accepted", () => {
  const result = extractJsonBody('{"a":1}');
  assert.deepEqual(result, { kind: "ok", value: { a: 1 } });
});

test("2. a single json fence is accepted", () => {
  const result = extractJsonBody('```json\n{"a":1}\n```');
  assert.deepEqual(result, { kind: "ok", value: { a: 1 } });
});

test("3. prose before the fence is ignored", () => {
  const result = extractJsonBody('Now I\'ll return the reconciliation:\n```json\n{"a":1}\n```');
  assert.deepEqual(result, { kind: "ok", value: { a: 1 } });
});

test("4. prose after the fence is ignored", () => {
  const result = extractJsonBody('```json\n{"a":1}\n```\nThat covers everything.');
  assert.deepEqual(result, { kind: "ok", value: { a: 1 } });
});

test("5. two fenced blocks are refused, naming the count", () => {
  const result = extractJsonBody('```json\n{"a":1}\n```\n```json\n{"b":2}\n```');
  assert.deepEqual(result, { kind: "refused", reason: "expected exactly one JSON block, found 2" });
});

test("6. a fenced block that is not JSON is refused, naming the parse error", () => {
  const result = extractJsonBody("```json\njust some prose\n```");
  assert.equal(result.kind, "refused");
  if (result.kind === "refused") {
    assert.match(result.reason, /^fenced block is not valid JSON: /);
  }
});

test("7. CRLF line endings inside the fence parse identically", () => {
  const crlf = extractJsonBody("```json\r\n{\"a\":1}\r\n```");
  const lf = extractJsonBody('```json\n{"a":1}\n```');
  assert.deepEqual(crlf, lf);
  assert.equal(crlf.kind, "ok");
});

test("8. prose before an unfenced object is accepted", () => {
  const result = extractJsonBody('Repo has no existing source files. I\'ll finalize the spec now.\n\n{"a":1}');
  assert.deepEqual(result, { kind: "ok", value: { a: 1 } });
});

/**
 * The spec authoring response that blocked the paid chain of 2026-09-06 at its
 * first stage, for $0.08103: one line of prose, a blank line, then a complete
 * `AgentResult` with no fence. Hard rule 5 and section 21 are why shape 8 is
 * pinned on this and not only on the hand-written line above — the fixture is
 * what a real provider returned, and its `provenance.provesWhat` states the
 * expected value: parsing from the first `{` to the end yields the full result.
 */
const UNFENCED_RUN = JSON.parse(
  readFileSync(
    new URL("./fixtures/recorded/spec-author-web-calculator-prose-before-unfenced-json.json", import.meta.url),
    "utf8"
  )
) as { envelope: { result: string } };

test("the recorded unfenced spec response extracts to the result it carries", () => {
  const body = UNFENCED_RUN.envelope.result;
  const firstBrace = body.indexOf("{");
  assert.ok(firstBrace > 0, "the recorded body must begin with prose, not with the object");
  assert.ok(!body.includes("```"), "the recorded body must carry no fence");

  const result = extractJsonBody(body);
  assert.equal(result.kind, "ok", `the recorded response must extract; got ${JSON.stringify(result)}`);
  if (result.kind !== "ok") return;
  // The provenance block's claim, asserted rather than trusted.
  assert.deepEqual(result.value, JSON.parse(body.slice(firstBrace)));
  const agentResult = result.value as { status?: unknown; agent?: unknown; proposedContentChanges?: { spec?: unknown } };
  assert.equal(agentResult.status, "proposed");
  assert.equal(agentResult.agent, "spec-author");
  assert.equal(typeof agentResult.proposedContentChanges?.spec, "string");
});

test("no fence and no '{' is refused, saying so", () => {
  const result = extractJsonBody("I cannot produce JSON today");
  assert.deepEqual(result, {
    kind: "refused",
    reason: "no JSON object found in output: the body has no fence and no '{'",
  });
});

test("no fence and an unparseable tail from the first '{' is refused, naming the offset and the error", () => {
  const result = extractJsonBody('Here is the result:\n{"a": 1, "b": }');
  assert.equal(result.kind, "refused");
  if (result.kind !== "refused") return;
  assert.match(
    result.reason,
    /^no fence, and the text from the first '\{' \(offset 20\) to the end of the body is not valid JSON: /
  );
});
