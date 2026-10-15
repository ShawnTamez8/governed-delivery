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

test("9. fenced JSON containing markdown code fences inside string literals is accepted", () => {
  const jsonWithFences = JSON.stringify({
    status: "proposed",
    content: "# Setup\n\n```bash\nnpm test\n```\n",
  });
  const wrapped = `\`\`\`json\n${jsonWithFences}\n\`\`\``;
  const result = extractJsonBody(wrapped);
  assert.deepEqual(result, {
    kind: "ok",
    value: {
      status: "proposed",
      content: "# Setup\n\n```bash\nnpm test\n```\n",
    },
  });
});

test("a four-backtick fence is accepted, which is the shape a model reaches for when the payload itself contains fences", () => {
  const jsonWithFences = JSON.stringify({
    status: "proposed",
    content: "# Setup\n\n```bash\nnpm test\n```\n",
  });
  const wrapped = `\`\`\`\`json\n${jsonWithFences}\n\`\`\`\``;
  const result = extractJsonBody(wrapped);
  assert.deepEqual(result, { kind: "ok", value: JSON.parse(jsonWithFences) });
});

test("a fence the anchoring rejects is refused in language naming the rule, not claiming there was no fence", () => {
  // The closing fence shares a line with the content, which item 9's anchoring
  // rejects by design. The refusal must not say the body had no fence.
  const result = extractJsonBody('```json\n{"a":1}```');
  assert.equal(result.kind, "refused");
  if (result.kind !== "refused") return;
  assert.match(result.reason, /a fence the anchoring rejected/);
  assert.match(result.reason, /a closing fence must begin its own line \(hazard 1, item 9\)/);
  assert.doesNotMatch(result.reason, /^no fence,/);
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

/**
 * Hazard 1, item 10. The implementer's phase-2 response of team-notes run 9
 * (2026-10-04, $1.1299, `implementation.content.invalid`) is a complete
 * `AgentResult` with exactly one raw line break inside a JSON string: in the
 * content of src/server/routes/import.ts, between
 * `processZip(config, md, file, notes, rejected);` and `} else if (ext ===`.
 * Its `provenance.recordedRefusal` names the strict-parse position (112141),
 * and `provesWhat` states that replacing that one character yields a parseable
 * result. Both are asserted here, not trusted.
 */
const RAW_NEWLINE_RUN = JSON.parse(
  readFileSync(
    new URL("./fixtures/recorded/implementation-team-notes-run-9-raw-newline-in-string.json", import.meta.url),
    "utf8"
  )
) as { result: string; provenance: { recordedRefusal: string } };

test("the recorded run 9 response carries one raw line break in a string, and extracts once it is escaped", () => {
  const body = RAW_NEWLINE_RUN.result;
  const position = 112141;
  assert.throws(
    () => JSON.parse(body),
    new RegExp(`Bad control character in string literal in JSON at position ${position}`),
    "the recorded body must still fail the strict parse where the live run refused it"
  );
  assert.match(RAW_NEWLINE_RUN.provenance.recordedRefusal, new RegExp(`position ${position}\\b`));
  assert.equal(body[position], "\n");

  // Independent expectation: the provenance's claim, built without the repair.
  const escapedByHand = JSON.parse(body.slice(0, position) + "\\n" + body.slice(position + 1)) as {
    proposedPatches: { files: { path: string; content: string }[] }[];
  };
  const result = extractJsonBody(body);
  assert.equal(result.kind, "ok", `the recorded response must extract; got ${JSON.stringify(result)}`);
  if (result.kind !== "ok") return;
  assert.deepEqual(result.value, escapedByHand);

  const files = escapedByHand.proposedPatches[0].files;
  assert.equal(files.length, 11);
  const importFile = files.find((f) => f.path === "src/server/routes/import.ts");
  assert.ok(importFile, "the patch must carry import.ts");
  assert.match(importFile.content, /processZip\(config, md, file, notes, rejected\);\n      \} else if \(ext === 'md'/);
});

test("a raw line break inside a string is accepted in a fence, bare, and after prose", () => {
  const body = '{"a":"x\ny"}';
  const expected = { kind: "ok", value: { a: "x\ny" } };
  assert.deepEqual(extractJsonBody(body), expected);
  assert.deepEqual(extractJsonBody("```json\n" + body + "\n```"), expected);
  assert.deepEqual(extractJsonBody("Here it is:\n\n" + body), expected);
});

test("a raw CRLF inside a string reads as one line break, the same as LF", () => {
  const crlf = extractJsonBody('{"a":"x\r\ny"}');
  const lf = extractJsonBody('{"a":"x\ny"}');
  assert.deepEqual(crlf, lf);
  assert.deepEqual(crlf, { kind: "ok", value: { a: "x\ny" } });
});

test("a raw tab and a raw low control character inside a string are escaped", () => {
  const result = extractJsonBody('{"a":"x\ty\u0001z"}');
  assert.deepEqual(result, { kind: "ok", value: { a: "x\ty\u0001z" } });
});

test("string boundaries are tracked: an escaped backslash ends a string, an escaped quote does not", () => {
  // `x\\` ends string a. If the scanner took `\\"` as an escaped quote, string b
  // would be read as outside a string and its raw line break left unescaped.
  const backslash = extractJsonBody('{"a":"x\\\\","b":"y\nz"}');
  assert.deepEqual(backslash, { kind: "ok", value: { a: "x\\", b: "y\nz" } });
  // `\"` does not end the string, so the raw line break after it is still inside it.
  // One escaped quote, not two: a scanner that wrongly closes the string on `\"`
  // flips state twice on a pair and lands back inside the string by accident.
  const quote = extractJsonBody('{"a":"say \\"hi\nthere"}');
  assert.deepEqual(quote, { kind: "ok", value: { a: 'say "hi\nthere' } });
});

test("line breaks between tokens, outside strings, are left alone", () => {
  const result = extractJsonBody('{\n  "a": "x\ny",\n  "b": [1,\n 2]\n}');
  assert.deepEqual(result, { kind: "ok", value: { a: "x\ny", b: [1, 2] } });
});

test("a body still invalid after the repair is refused with the original parse error", () => {
  // The raw line break is repairable; the trailing comma is not. The refusal
  // must report the strict parse's position in the bytes the model wrote
  // (the control character), not the later failure in the repaired text.
  const result = extractJsonBody('{"a":"x\ny",}');
  assert.equal(result.kind, "refused");
  if (result.kind !== "refused") return;
  assert.match(result.reason, /Bad control character in string literal/);
});

test("a truncated string stays refused: only control characters are repaired", () => {
  const result = extractJsonBody('{"a":"x\ny');
  assert.equal(result.kind, "refused");
});

/**
 * Hazard 1, item 11. The implementer's phase-2 reply of web-calculator run 1
 * (2026-10-14, `implementation.content.invalid`): a complete, valid object with
 * no fence, then one sentence of prose. Its `provenance.outcome` carries the
 * refusal the live run recorded and `provenance.measured` where the object ends
 * and what follows it. The extractor still refuses this shape; the patch
 * dispatches now avoid it by reading `structured_output` instead.
 */
const TRAILING_PROSE_RUN = JSON.parse(
  readFileSync(
    new URL("./fixtures/recorded/web-calculator-selfreview-run-1-phase-2-trailing-prose.json", import.meta.url),
    "utf8"
  )
) as {
  resultText: string;
  provenance: { outcome: string; measured: { strictParseError: string; jsonEndsAt: number; trailingText: string } };
};

test("11. the recorded reply with prose after an unfenced object is refused as the live run refused it", () => {
  const body = TRAILING_PROSE_RUN.resultText;
  const { measured, outcome } = TRAILING_PROSE_RUN.provenance;
  assert.ok(!body.includes("```"), "the recorded body must carry no fence");

  const result = extractJsonBody(body);
  assert.equal(result.kind, "refused");
  if (result.kind !== "refused") return;
  assert.ok(outcome.includes(result.reason), `the live run's recorded outcome must carry this reason: ${result.reason}`);
  assert.ok(result.reason.endsWith(measured.strictParseError));

  // The provenance's claim, asserted rather than trusted: the object is complete
  // and only the trailing text breaks the whole-body parse.
  const object = JSON.parse(body.slice(0, measured.jsonEndsAt)) as { status?: unknown; agent?: unknown };
  assert.equal(object.status, "proposed");
  assert.equal(object.agent, "implementer");
  assert.equal(body.slice(measured.jsonEndsAt).trimEnd(), measured.trailingText.trimEnd());
});
