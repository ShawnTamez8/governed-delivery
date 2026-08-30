import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

/**
 * A directory link inside `dir` named `name`, pointing at `target`. Junction
 * on Windows, directory symlink elsewhere; throws rather than skips so the
 * containment guard is never silently unexercised (hazard 4).
 */
function makeDirLink(dir: string, name: string, target: string): string {
  const link = join(dir, name);
  if (process.platform === "win32") {
    const r = spawnSync("cmd", ["/c", "mklink", "/J", link, target], { encoding: "utf8" });
    assert.equal(r.status, 0, `mklink /J failed: ${r.stdout}${r.stderr}`);
  } else {
    symlinkSync(target, link, "dir");
  }
  assert.ok(existsSync(link), "the link must exist for the test to prove anything");
  return link;
}

test("keygen refuses to write through a link into the repository", () => {
  // The junction is lexically outside every repository and its target inside
  // one: the write lands in the tracked tree. The repo test must run on the
  // *resolved* path, or the private key lands inside the repository.
  const base = tempDir();
  const repo = join(base, "repo");
  const elsewhere = join(base, "elsewhere");
  try {
    assert.equal(spawnSync("git", ["init", "-q", repo], { encoding: "utf8" }).status, 0);
    const keys = join(repo, "keys");
    mkdirSync(keys, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    const link = makeDirLink(elsewhere, "keys-link", keys);
    const r = runScript(["keygen", "--out", link]);
    assert.equal(r.status, 2, `expected a refusal, got stdout: ${r.stdout}`);
    assert.match(r.stderr, /refusing to write signing material inside the repository/);
    assert.ok(!existsSync(join(keys, "approval.key")), "no private key may land in the repository");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("sign refuses a private key reached through a link into the repository", () => {
  // The same rule as the direct path, with the path spelled through a link:
  // resolving only the child while identifying the repository lexically would
  // read the in-tree key as outside and sign it.
  const base = tempDir();
  const repo = join(base, "repo");
  const elsewhere = join(base, "elsewhere");
  try {
    assert.equal(spawnSync("git", ["init", "-q", repo], { encoding: "utf8" }).status, 0);
    const keys = join(repo, "keys");
    mkdirSync(keys, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    const planted = join(keys, "approval.key");
    writeFileSync(planted, "dummy private key material");
    const link = makeDirLink(elsewhere, "keys-link", keys);
    const r = runScript(["sign", "--key", join(link, "approval.key")], "buildworks-approval\nfeatureId: f-1\nscope: 0");
    assert.equal(r.status, 2, `expected a refusal, got stdout: ${r.stdout}`);
    assert.match(r.stderr, /refusing to read signing material from inside the repository/);
    assert.equal(r.stdout.trim(), "", "a refusal must not also emit a signature");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("sign accepts a key in the working directory when neither is in a repository", () => {
  // The containment rule is about repositories, not about where the operator
  // happens to stand: a key in a directory that is in no repository is
  // outside the rule even when it is inside the cwd.
  const keys = tempDir();
  try {
    const out = tempDir();
    try {
      assert.equal(runScript(["keygen", "--out", out]).status, 0);
      writeFileSync(join(keys, "approval.key"), readFileSync(join(out, "approval.key"), "utf8"));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    const r = spawnSync(process.execPath, [SCRIPT, "sign", "--key", "./approval.key"], {
      cwd: keys,
      encoding: "utf8",
      input: "buildworks-approval\nfeatureId: f-1\nscope: 0",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout.trim(), /^[A-Za-z0-9+/]+={0,2}$/);
  } finally {
    rmSync(keys, { recursive: true, force: true });
  }
});

test("sign refuses a private key that lives inside a repository", () => {
  // keygen has refused this since step 4, but `sign` applied no containment
  // at all: a private key already sitting in a tracked tree — copied there,
  // or generated before the keygen guard existed — signed without objection.
  const out = tempDir();
  const repo = tempDir();
  try {
    assert.equal(runScript(["keygen", "--out", out]).status, 0);
    assert.equal(spawnSync("git", ["init", "-q", repo], { encoding: "utf8" }).status, 0);
    const planted = join(repo, "approval.key");
    writeFileSync(planted, readFileSync(join(out, "approval.key"), "utf8"));

    // Run from a third directory so the cwd check cannot be what refuses:
    // the guard has to look at --key itself.
    const elsewhere = tempDir();
    try {
      const r = spawnSync(process.execPath, [SCRIPT, "sign", "--key", planted], {
        cwd: elsewhere,
        encoding: "utf8",
        input: "buildworks-approval\nfeatureId: f-1\nscope: 0",
      });
      assert.equal(r.status, 2, `expected a refusal, got stdout: ${r.stdout}`);
      assert.match(r.stderr, /refusing to read signing material from inside the repository/);
      assert.equal(r.stdout.trim(), "", "a refusal must not also emit a signature");
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
