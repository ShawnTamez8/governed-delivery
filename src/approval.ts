import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sha256Hex } from "./canonical.ts";
import { isPathInside } from "./scope.ts";

/** What the operator signs (architecture section 12). */
export interface ApprovalBinding {
  featureId: string;
  specHash: string;
  startingCommit: string;
  profileHash: string;
  risk: string;
  expiresAt: string;
  scope: string[];
}

const HEADER = "buildworks-approval";
const SIGNATURE_BYTES = 64;

const UNSAFE_IN_PAYLOAD = /[\u0000-\u001f\u007f]/;

/**
 * Every payload field is machine-derived by the time it reaches here, so a
 * line break means an upstream validation hole, not operator error — hence a
 * throw rather than a result union. Without this, a newline in `featureId`
 * forges a second `risk:` line into a payload that still signs and verifies.
 */
function assertPayloadSafe(name: string, value: string): void {
  if (UNSAFE_IN_PAYLOAD.test(value)) {
    throw new Error(
      `approval payload field ${name} contains a line break or control character: ${JSON.stringify(value)}`
    );
  }
}

/**
 * The canonical payload. The `scope` count line bounds the path list so no
 * path can be mistaken for a field, and the whole string ends without a
 * trailing newline so what is printed is exactly what is signed.
 *
 * The header is a fixed domain separator, deliberately not the configurable
 * system name: section 12 says nothing functional depends on that name.
 */
export function approvalPayload(b: ApprovalBinding): string {
  assertPayloadSafe("featureId", b.featureId);
  assertPayloadSafe("specHash", b.specHash);
  assertPayloadSafe("startingCommit", b.startingCommit);
  assertPayloadSafe("profileHash", b.profileHash);
  assertPayloadSafe("risk", b.risk);
  assertPayloadSafe("expiresAt", b.expiresAt);
  b.scope.forEach((path, i) => assertPayloadSafe(`scope[${i}]`, path));
  return [
    HEADER,
    `featureId: ${b.featureId}`,
    `specHash: ${b.specHash}`,
    `startingCommit: ${b.startingCommit}`,
    `profileHash: ${b.profileHash}`,
    `risk: ${b.risk}`,
    `expiresAt: ${b.expiresAt}`,
    `scope: ${b.scope.length}`,
    ...b.scope,
  ].join("\n");
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export function validateExpiry(
  expiresAt: string,
  now: number,
  maxLifetimeSeconds: number
): { ok: true } | { ok: false; reason: string } {
  const malformed = {
    ok: false as const,
    reason: `--expires must be an ISO 8601 UTC timestamp such as 2026-08-30T12:00:00.000Z, got ${expiresAt}`,
  };
  if (!ISO_UTC.test(expiresAt) || Number.isNaN(Date.parse(expiresAt))) {
    return malformed;
  }
  const at = Date.parse(expiresAt);
  // `Date.parse` rolls an impossible day over rather than rejecting it —
  // 2026-02-30 becomes March 2 — so the pattern and `Number.isNaN` together
  // still accept a date that does not exist. Re-serializing the parsed
  // instant and comparing is what catches it. From the operator's side a
  // date that cannot occur is a malformed one, so it earns no second message.
  const canonical = /\.\d{3}Z$/.test(expiresAt) ? expiresAt : expiresAt.replace(/Z$/, ".000Z");
  if (new Date(at).toISOString() !== canonical) {
    return malformed;
  }
  if (at <= now) {
    return { ok: false, reason: `approval expired at ${expiresAt}` };
  }
  // Strict `>`: a timestamp exactly at the ceiling is honoured rather than
  // refused by one millisecond.
  if (at - now > maxLifetimeSeconds * 1000) {
    return {
      ok: false,
      reason: `approval expiry ${expiresAt} exceeds the maximum lifetime of ${maxLifetimeSeconds} seconds`,
    };
  }
  return { ok: true };
}

/**
 * Signing material lives outside the repository (section 17): never in the
 * repo, never in a projection, never in run state. `.governance/` is inside
 * the repository, so the one containment check covers all three.
 *
 * The check resolves links: a junction or symlink outside the repository
 * pointing back into it reads as "outside" to a string comparison, and the
 * key it names is inside the tracked tree all the same.
 */
export function resolvePublicKeyPath(
  rootDir: string
): { ok: true; path: string } | { ok: false; reason: string } {
  const configured = process.env.BW_APPROVAL_PUBLIC_KEY;
  const path =
    configured !== undefined && configured !== ""
      ? resolve(configured)
      : join(homedir(), ".buildworks", "approval.pub");
  if (isPathInside(rootDir, path)) {
    return { ok: false, reason: `approval public key must not live inside the repository: ${path}` };
  }
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `approval public key not found: set BW_APPROVAL_PUBLIC_KEY or place a PEM Ed25519 public key at ${path}`,
    };
  }
  return { ok: true, path };
}

export function loadPublicKey(
  rootDir: string
): { ok: true; key: KeyObject; signer: string; path: string } | { ok: false; reason: string } {
  const resolved = resolvePublicKeyPath(rootDir);
  if (!resolved.ok) return resolved;
  let key: KeyObject;
  try {
    key = createPublicKey(readFileSync(resolved.path, "utf8"));
  } catch (err) {
    return {
      ok: false,
      reason: `approval public key at ${resolved.path} is not a valid PEM public key: ${(err as Error).message}`,
    };
  }
  if (key.asymmetricKeyType !== "ed25519") {
    return {
      ok: false,
      reason: `approval public key at ${resolved.path} is ${key.asymmetricKeyType}, not ed25519`,
    };
  }
  // An identifier for the key that is not the key.
  const signer = sha256Hex(key.export({ format: "der", type: "spki" }));
  return { ok: true, key, signer, path: resolved.path };
}

export function verifyApproval(
  payload: string,
  signatureBase64: string,
  key: KeyObject
): { ok: true } | { ok: false; reason: string } {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)) {
    return { ok: false, reason: "approval signature is not valid base64" };
  }
  const sig = Buffer.from(signatureBase64, "base64");
  if (sig.length !== SIGNATURE_BYTES) {
    // Checked before verify, so a truncated paste is diagnosable rather than
    // an unexplained false.
    return {
      ok: false,
      reason: `approval signature is ${sig.length} bytes, not the ${SIGNATURE_BYTES} an Ed25519 signature must be`,
    };
  }
  return verify(null, Buffer.from(payload, "utf8"), key, sig)
    ? { ok: true }
    : { ok: false, reason: "approval signature does not verify against the configured public key" };
}
