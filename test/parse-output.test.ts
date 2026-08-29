import { test } from "node:test";
import assert from "node:assert/strict";
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

test("no fence and no JSON is refused", () => {
  const result = extractJsonBody("I cannot produce JSON today");
  assert.deepEqual(result, { kind: "refused", reason: "no JSON object found in output" });
});
