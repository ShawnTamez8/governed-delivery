import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateAgentResult } from "../src/agent-result.ts";
import { extractJsonBody } from "../src/parse-output.ts";

interface RecordedImplementationFixture {
  provenance: {
    stageContext: {
      auditAction: string;
      codeReviewReached: boolean;
      recordedRefusal: string;
    };
  };
  envelope: {
    result: string;
  };
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/recorded/implementation-web-calculator-invalid-unicode-escape.json", import.meta.url),
    "utf8"
  )
) as RecordedImplementationFixture;

const embeddedFenceFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/recorded/implementation-simple-game-embedded-markdown-fence.json", import.meta.url),
    "utf8"
  )
) as { envelope: { result: string } };

/** The files of a recorded response's first patch: these runs predate tool mode, when the reply carried patches. */
function recordedPatchFiles(value: unknown): { path: string }[] {
  return (value as { proposedPatches?: { files: { path: string }[] }[] }).proposedPatches?.[0]?.files ?? [];
}

test("the recorded Task 10 implementer response reproduces its exact JSON refusal", () => {
  const extracted = extractJsonBody(fixture.envelope.result);

  assert.deepEqual(extracted, {
    kind: "refused",
    reason: "fenced block is not valid JSON: Bad escaped character in JSON at position 1912 (line 1 column 1913)",
  });
  assert.equal(fixture.provenance.stageContext.auditAction, "implementation.content.invalid");
  assert.equal(fixture.provenance.stageContext.codeReviewReached, false);
  assert.equal(
    fixture.provenance.stageContext.recordedRefusal,
    `implementer body refused: ${extracted.kind === "refused" ? extracted.reason : "unexpected pass"}`
  );

  const normalized = fixture.envelope.result.trim().replace(/\r\n/g, "\n");
  const fencedBody = normalized.slice(normalized.indexOf("\n") + 1, normalized.lastIndexOf("```"));
  const invalidEscapes = [...fencedBody.matchAll(/\\U0001f319/g)].map((match) => match.index);
  assert.deepEqual(invalidEscapes, [1911, 9505]);
});

test("only the two measured invalid escapes prevent AgentResult validation", () => {
  // Diagnostic counterfactual only: production must refuse malformed provider
  // output rather than repairing it heuristically.
  const repaired = fixture.envelope.result.replaceAll("\\U0001f319", "🌙");
  const extracted = extractJsonBody(repaired);
  assert.equal(extracted.kind, "ok");
  if (extracted.kind !== "ok") return;

  const validated = validateAgentResult("implementer", extracted.value);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(recordedPatchFiles(validated.value).length, 5);
});

test("recorded implementer response with embedded markdown code fences in string values extracts and validates", () => {
  const extracted = extractJsonBody(embeddedFenceFixture.envelope.result);
  assert.equal(extracted.kind, "ok");
  if (extracted.kind !== "ok") return;

  const validated = validateAgentResult("implementer", extracted.value);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(recordedPatchFiles(validated.value).length, 18);
});

const rawNewlineFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/recorded/implementation-team-notes-run-9-raw-newline-in-string.json", import.meta.url),
    "utf8"
  )
) as { result: string; provenance: { recordedRefusal: string } };

test("recorded run 9 phase-2 response, refused for one raw line break in a string, extracts and validates", () => {
  assert.throws(() => JSON.parse(rawNewlineFixture.result), /Bad control character in string literal/);
  const extracted = extractJsonBody(rawNewlineFixture.result);
  assert.equal(extracted.kind, "ok");
  if (extracted.kind !== "ok") return;

  const validated = validateAgentResult("implementer", extracted.value);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.reason);
  if (!validated.ok) return;
  const files = recordedPatchFiles(validated.value);
  assert.equal(files.length, 11);
  assert.equal(files.at(-1)?.path, "src/server/routes/import.ts");
});
