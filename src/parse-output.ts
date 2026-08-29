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
  const fences = [...normalized.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)];
  if (fences.length === 0) {
    return { kind: "refused", reason: "no JSON object found in output" };
  }
  if (fences.length > 1) {
    return { kind: "refused", reason: `expected exactly one JSON block, found ${fences.length}` };
  }
  const content = fences[0][1].trim();
  try {
    return { kind: "ok", value: JSON.parse(content) };
  } catch (err) {
    return { kind: "refused", reason: `fenced block is not valid JSON: ${(err as Error).message}` };
  }
}
