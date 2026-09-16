export type ExtractResult = { kind: "ok"; value: unknown } | { kind: "refused"; reason: string };

/**
 * Extract a JSON body from model output, exercising every shape hazard 1
 * documents. Strictness by consequence: this extractor feeds schema
 * validation, so it tolerates one fenced block anywhere in the body, refuses
 * rather than guessing when several are present, and names the cause in
 * every refusal.
 */
export function extractJsonBody(text: string): ExtractResult {
  const trimmed = text.trim();
  try {
    return { kind: "ok", value: JSON.parse(trimmed) };
  } catch {
    // not bare JSON; fall through to fenced extraction
  }
  // Normalize CRLF before fence scanning (hazard 1, item 7).
  const normalized = trimmed.replace(/\r\n/g, "\n");
  const fences = [
    ...normalized.matchAll(/(?:^|(?<=\n))[ \t]*```+[a-zA-Z]*[ \t]*\n([\s\S]*?)(?<=\n)[ \t]*```+[ \t]*(?=\n|$)/g),
  ];
  if (fences.length > 1) {
    return { kind: "refused", reason: `expected exactly one JSON block, found ${fences.length}` };
  }
  if (fences.length === 1) {
    const content = fences[0][1].trim();
    try {
      return { kind: "ok", value: JSON.parse(content) };
    } catch (err) {
      return { kind: "refused", reason: `fenced block is not valid JSON: ${(err as Error).message}` };
    }
  }
  // No fence matched (hazard 1, item 8). Measured 2026-09-06, $0.08103: a spec
  // author wrote one sentence of prose, a blank line, then a complete and valid
  // result with no fence, and the run blocked at stage 1 because the whole
  // body did not parse and there was no fence to find. The extractor already
  // tolerates prose around a fence on the grounds that the bytes are retained
  // in full elsewhere and this result is only schema-validated; an unfenced
  // object is the same two ingredients with less decoration. Parse from the
  // first `{` to the end of the body and refuse only if that fails. Prose
  // *after* an unfenced object still refuses — nobody has measured it.
  //
  // Reaching here does not prove the body was unfenced: item 9's anchoring
  // also rejects a fence whose closing delimiter shares a line with the
  // content. Telling the operator "no fence" about a body that visibly has one
  // is hazard 2 — it sends them looking for the wrong thing — so the two cases
  // refuse in different language. A backtick run beginning a line cannot occur
  // inside a valid JSON string, for the same reason item 9's anchoring works,
  // so its presence is a sound signal that the body carried a fence.
  const carriesFence = /(?:^|(?<=\n))[ \t]*```/.test(normalized);
  const rejectedFence =
    "a fence the anchoring rejected — an opening fence must be followed by a newline, " +
    "and a closing fence must begin its own line (hazard 1, item 9)";
  const brace = normalized.indexOf("{");
  if (brace < 0) {
    return {
      kind: "refused",
      reason: carriesFence
        ? `no JSON object found in output: the body has ${rejectedFence}, and no '{'`
        : "no JSON object found in output: the body has no fence and no '{'",
    };
  }
  try {
    return { kind: "ok", value: JSON.parse(normalized.slice(brace)) };
  } catch (err) {
    // Say what was found, not only what was missing (hazard 2): an object
    // may well be there, and the operator diagnosing from the log needs to
    // know where the parse began and why it stopped.
    return {
      kind: "refused",
      reason: `${carriesFence ? rejectedFence : "no fence"}, and the text from the first '{' (offset ${brace}) to the end of the body is not valid JSON: ${(err as Error).message}`,
    };
  }
}
