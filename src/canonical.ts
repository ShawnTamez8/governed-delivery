import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted, no whitespace, array order kept.
 * Everything a profile or a payload is hashed from goes through here, so two
 * structurally identical values can never produce two different hashes.
 *
 * It throws where `JSON.stringify` would silently drop — `undefined`, a
 * function, a symbol as an object value — because a silently dropped field is
 * exactly how two different profiles come to share one hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("canonical JSON cannot serialize a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new Error(`canonical JSON cannot serialize ${t}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Strip a UTF-8 BOM and normalize CRLF to LF before hashing anything read
 * from the working tree. `docs/features/**` is committed, so a checkout under
 * `core.autocrlf=true` would otherwise change a spec's hash and invalidate an
 * authorization that is still perfectly correct.
 */
export function normalizeText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}
