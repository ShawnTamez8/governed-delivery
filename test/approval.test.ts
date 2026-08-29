import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvalPayload,
  loadPublicKey,
  resolvePublicKeyPath,
  validateExpiry,
  verifyApproval,
  type ApprovalBinding,
} from "../src/approval.ts";

const BINDING: ApprovalBinding = {
  featureId: "f-1",
  specHash: "a".repeat(64),
  startingCommit: "b".repeat(40),
  profileHash: "c".repeat(64),
  risk: "standard",
  expiresAt: "2026-08-30T12:00:00.000Z",
  scope: ["docs/features/s/spec.md", "src/a.ts"],
};

// The expected signature comes from node:crypto, never from a value written
// alongside the code that consumes it.
function keypair() {
  return generateKeyPairSync("ed25519");
}

function signPayload(payload: string, privateKey: ReturnType<typeof keypair>["privateKey"]): string {
  return sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
}

function withKeyDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "bw-key-"));
  const before = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    fn(dir);
  } finally {
    if (before === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = before;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the payload binds all seven values in a fixed order with a bounded scope list", () => {
  assert.equal(
    approvalPayload(BINDING),
    [
      "buildworks-approval",
      `featureId: f-1`,
      `specHash: ${"a".repeat(64)}`,
      `startingCommit: ${"b".repeat(40)}`,
      `profileHash: ${"c".repeat(64)}`,
      "risk: standard",
      "expiresAt: 2026-08-30T12:00:00.000Z",
      "scope: 2",
      "docs/features/s/spec.md",
      "src/a.ts",
    ].join("\n")
  );
});

test("the payload ends without a trailing newline", () => {
  assert.ok(!approvalPayload(BINDING).endsWith("\n"));
});

test("a signature over the payload verifies", () => {
  const { publicKey, privateKey } = keypair();
  const payload = approvalPayload(BINDING);
  assert.deepEqual(verifyApproval(payload, signPayload(payload, privateKey), publicKey), { ok: true });
});

test("a payload changed by one character does not verify", () => {
  const { publicKey, privateKey } = keypair();
  const signature = signPayload(approvalPayload(BINDING), privateKey);
  const tampered = approvalPayload({ ...BINDING, risk: "high" });
  const result = verifyApproval(tampered, signature, publicKey);
  assert.equal(result.ok, false);
  assert.match(
    (result as { reason: string }).reason,
    /approval signature does not verify against the configured public key/
  );
});

test("a signature from a different keypair does not verify", () => {
  const a = keypair();
  const b = keypair();
  const payload = approvalPayload(BINDING);
  const result = verifyApproval(payload, signPayload(payload, b.privateKey), a.publicKey);
  assert.equal(result.ok, false);
});

test("a truncated signature is refused by length, naming 64", () => {
  const { publicKey } = keypair();
  const result = verifyApproval(approvalPayload(BINDING), Buffer.alloc(32).toString("base64"), publicKey);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /approval signature is 32 bytes, not the 64/);
});

test("a non-base64 signature is refused before any verification", () => {
  const { publicKey } = keypair();
  const result = verifyApproval(approvalPayload(BINDING), "not base64!", publicKey);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /approval signature is not valid base64/);
});

test("the public key path prefers BW_APPROVAL_PUBLIC_KEY", () => {
  withKeyDir((dir) => {
    const { publicKey } = keypair();
    const path = join(dir, "approval.pub");
    writeFileSync(path, publicKey.export({ format: "pem", type: "spki" }) as string);
    process.env.BW_APPROVAL_PUBLIC_KEY = path;
    const resolved = resolvePublicKeyPath(mkdtempSync(join(tmpdir(), "bw-repo-")));
    assert.equal(resolved.ok, true);
    assert.equal((resolved as { path: string }).path, path);
  });
});

test("a public key inside the repository is refused naming the path", () => {
  withKeyDir((dir) => {
    const repo = mkdtempSync(join(tmpdir(), "bw-repo-"));
    try {
      const { publicKey } = keypair();
      // .governance/ is inside the repository, so the containment check
      // covers run state as well as the tracked tree (section 17).
      const path = join(repo, ".governance", "approval.pub");
      process.env.BW_APPROVAL_PUBLIC_KEY = path;
      const resolved = resolvePublicKeyPath(repo);
      assert.equal(resolved.ok, false);
      assert.match(
        (resolved as { reason: string }).reason,
        /approval public key must not live inside the repository/
      );
      assert.ok(publicKey);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("a missing public key names both the env var and the path", () => {
  withKeyDir((dir) => {
    process.env.BW_APPROVAL_PUBLIC_KEY = join(dir, "absent.pub");
    const resolved = resolvePublicKeyPath(mkdtempSync(join(tmpdir(), "bw-repo-")));
    assert.equal(resolved.ok, false);
    assert.match(
      (resolved as { reason: string }).reason,
      /approval public key not found: set BW_APPROVAL_PUBLIC_KEY or place a PEM Ed25519 public key at .+absent\.pub/
    );
  });
});

test("a non-ed25519 public key is refused naming ed25519", () => {
  withKeyDir((dir) => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const path = join(dir, "approval.pub");
    writeFileSync(path, publicKey.export({ format: "pem", type: "spki" }) as string);
    process.env.BW_APPROVAL_PUBLIC_KEY = path;
    const loaded = loadPublicKey(mkdtempSync(join(tmpdir(), "bw-repo-")));
    assert.equal(loaded.ok, false);
    assert.match((loaded as { reason: string }).reason, /is rsa, not ed25519/);
  });
});

test("a malformed PEM is refused naming the file", () => {
  withKeyDir((dir) => {
    const path = join(dir, "approval.pub");
    writeFileSync(path, "not a pem");
    process.env.BW_APPROVAL_PUBLIC_KEY = path;
    const loaded = loadPublicKey(mkdtempSync(join(tmpdir(), "bw-repo-")));
    assert.equal(loaded.ok, false);
    assert.match((loaded as { reason: string }).reason, /is not a valid PEM public key/);
  });
});

test("the signer fingerprint is stable and differs between keys", () => {
  withKeyDir((dir) => {
    const a = keypair();
    const path = join(dir, "approval.pub");
    writeFileSync(path, a.publicKey.export({ format: "pem", type: "spki" }) as string);
    process.env.BW_APPROVAL_PUBLIC_KEY = path;
    const repo = mkdtempSync(join(tmpdir(), "bw-repo-"));
    const first = loadPublicKey(repo) as { signer: string };
    const second = loadPublicKey(repo) as { signer: string };
    assert.equal(first.signer, second.signer);
    assert.match(first.signer, /^[0-9a-f]{64}$/);

    const b = keypair();
    writeFileSync(path, b.publicKey.export({ format: "pem", type: "spki" }) as string);
    assert.notEqual((loadPublicKey(repo) as { signer: string }).signer, first.signer);
  });
});

test("each expiry refusal states its exact cause", () => {
  const now = Date.parse("2026-08-29T00:00:00.000Z");
  const max = 86400;

  const malformed = validateExpiry("tomorrow", now, max);
  assert.equal(malformed.ok, false);
  assert.match(
    (malformed as { reason: string }).reason,
    /--expires must be an ISO 8601 UTC timestamp such as 2026-08-30T12:00:00\.000Z, got tomorrow/
  );

  const expired = validateExpiry("2026-08-28T00:00:00.000Z", now, max);
  assert.equal(expired.ok, false);
  assert.match((expired as { reason: string }).reason, /approval expired at 2026-08-28T00:00:00\.000Z/);

  const tooLong = validateExpiry("2027-08-29T00:00:00.000Z", now, max);
  assert.equal(tooLong.ok, false);
  assert.match(
    (tooLong as { reason: string }).reason,
    /exceeds the maximum lifetime of 86400 seconds/
  );

  assert.deepEqual(validateExpiry("2026-08-29T12:00:00.000Z", now, max), { ok: true });
});

test("an expiry exactly at the ceiling is honoured, not refused by a millisecond", () => {
  const now = Date.parse("2026-08-29T00:00:00.000Z");
  assert.deepEqual(validateExpiry("2026-08-30T00:00:00.000Z", now, 86400), { ok: true });
});
