import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyApproval } from "../src/approval.ts";

const SCRIPT = resolve(process.cwd(), "scripts", "sign-approval.mjs");

// The guard is relative to where the script runs, so every invocation that
// must succeed runs from the repository root with --out in a temp directory.
function runScript(argv: string[], input?: string) {
  return spawnSync(process.execPath, [SCRIPT, ...argv], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: input ?? "",
  });
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "bw-sign-"));
}

test("keygen writes an ed25519 keypair outside the repository", () => {
  const out = tempDir();
  try {
    const r = runScript(["keygen", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(out, "approval.key")));
    assert.ok(existsSync(join(out, "approval.pub")));
    const pub = createPublicKey(readFileSync(join(out, "approval.pub"), "utf8"));
    assert.equal(pub.asymmetricKeyType, "ed25519");
    assert.match(r.stdout, /export BW_APPROVAL_PUBLIC_KEY=/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("keygen refuses to write signing material inside the repository", () => {
  const inside = join(process.cwd(), "should-never-exist");
  const r = runScript(["keygen", "--out", inside]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refusing to write signing material inside the repository/);
  assert.ok(!existsSync(inside), "the refusal must not have created the directory");
});

test("keygen refuses to overwrite an existing private key", () => {
  const out = tempDir();
  try {
    assert.equal(runScript(["keygen", "--out", out]).status, 0);
    const first = readFileSync(join(out, "approval.key"), "utf8");
    const again = runScript(["keygen", "--out", out]);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /refusing to overwrite an existing private key/);
    assert.equal(readFileSync(join(out, "approval.key"), "utf8"), first);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a signature produced by the script verifies through verifyApproval", () => {
  const out = tempDir();
  try {
    assert.equal(runScript(["keygen", "--out", out]).status, 0);
    const payload = "buildworks-approval\nfeatureId: f-1\nscope: 1\nsrc/a.ts";
    const signed = runScript(["sign", "--key", join(out, "approval.key")], payload);
    assert.equal(signed.status, 0, signed.stderr);
    const key = createPublicKey(readFileSync(join(out, "approval.pub"), "utf8"));
    assert.deepEqual(verifyApproval(payload, signed.stdout.trim(), key), { ok: true });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("sign refuses an empty payload rather than signing nothing", () => {
  const out = tempDir();
  try {
    assert.equal(runScript(["keygen", "--out", out]).status, 0);
    const r = runScript(["sign", "--key", join(out, "approval.key")], "");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no payload on stdin/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("nothing under src/ touches a private key", () => {
  // Section 17, asserted mechanically rather than promised in prose: the
  // system core only ever verifies.
  const forbidden = ["createPrivateKey", "PRIVATE KEY", "approval.key"];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
    });
  for (const file of walk(join(process.cwd(), "src"))) {
    const source = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      assert.ok(!source.includes(needle), `${file} must not reference ${needle}`);
    }
  }
});

test("a payload carrying a trailing newline signs the same bytes the gate verifies", () => {
  // The redirect workflow (`bw approval-request > f` then `sign < f`) must
  // produce a signature over the payload itself, not the payload plus a
  // newline some tool appended.
  const out = tempDir();
  try {
    assert.equal(runScript(["keygen", "--out", out]).status, 0);
    const payload = "buildworks-approval\nfeatureId: f-1\nscope: 1\nsrc/a.ts";
    const bare = runScript(["sign", "--key", join(out, "approval.key")], payload);
    const withNewline = runScript(["sign", "--key", join(out, "approval.key")], `${payload}\n`);
    assert.equal(bare.status, 0);
    assert.equal(withNewline.status, 0);
    assert.equal(withNewline.stdout.trim(), bare.stdout.trim());
    const key = createPublicKey(readFileSync(join(out, "approval.pub"), "utf8"));
    assert.deepEqual(verifyApproval(payload, withNewline.stdout.trim(), key), { ok: true });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("keygen refuses a target inside any git repository, not just the current one", () => {
  // Run from a temp directory so the cwd check cannot be what refuses: the
  // guard has to look at --out itself.
  const elsewhere = tempDir();
  const inside = join(process.cwd(), "keys-should-never-exist");
  try {
    const r = spawnSync(process.execPath, [SCRIPT, "keygen", "--out", inside], {
      cwd: elsewhere,
      encoding: "utf8",
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing to write signing material inside the repository/);
    assert.ok(!existsSync(inside));
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("a payload mangled by the shell signs the bytes the gate recomputes", () => {
  // Measured on Windows PowerShell 5.1: both documented routes rewrite the
  // payload before the signer sees it. A UTF-8 BOM is prepended and every LF
  // becomes CRLF; the direct pipe then appends one CRLF, and the redirect
  // (`> payload.txt`, then `Get-Content -Raw |`) appends two, because the file
  // keeps its own newline and PowerShell adds another handing the string to a
  // native command. The gate recomputes `approvalPayload()`, which is LF with
  // no BOM, so signing the bytes as received produced a signature that could
  // never verify on the default shell of a supported platform.
  //
  // The input is deliberately handed over as the shell delivers it. Cleaning
  // it here first is the normalization that hid this defect once already.
  const out = tempDir();
  try {
    assert.equal(runScript(["keygen", "--out", out]).status, 0);
    const payload = "buildworks-approval\nfeatureId: f-1\nscope: 1\nsrc/a.ts";
    const crlf = `﻿${payload.replace(/\n/g, "\r\n")}`;
    const key = createPublicKey(readFileSync(join(out, "approval.pub"), "utf8"));
    for (const [route, stdin] of [
      ["pipe", `${crlf}\r\n`],
      ["redirect", `${crlf}\r\n\r\n`],
    ]) {
      const signed = runScript(["sign", "--key", join(out, "approval.key")], stdin);
      assert.equal(signed.status, 0, signed.stderr);
      assert.deepEqual(verifyApproval(payload, signed.stdout.trim(), key), { ok: true }, route);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
