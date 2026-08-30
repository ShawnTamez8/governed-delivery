#!/usr/bin/env node
// The operator's signing tool. It is the only place in this repository that
// touches a private key: the system core only ever verifies, so no worker or
// agent session can reach signing material (ARCHITECTURE.md section 17).
//
//   node scripts/sign-approval.mjs keygen --out <dir>
//   bw approval-request --run <id> --expires <iso> | node scripts/sign-approval.mjs sign --key <path>

import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { normalizeText } from "../src/canonical.ts";
import { isPathInside, resolveExisting } from "../src/scope.ts";

const USAGE = `usage: node scripts/sign-approval.mjs <command>
commands:
  keygen --out <dir>     write approval.key (PKCS#8) and approval.pub (SPKI)
  sign --key <path>      sign the payload read from stdin, print base64`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parse(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      args.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      args.set(arg.slice(2), next === undefined || next.startsWith("--") ? "" : next);
      if (next !== undefined && !next.startsWith("--")) i++;
    }
  }
  return args;
}

/**
 * The nearest enclosing git work tree of `dir`, or null. Comparing against
 * the current directory is not enough: running keygen from outside the
 * repository with --out pointing into it would otherwise write the private
 * key into a tracked tree. The rule is "not inside any repository", so the
 * check has to look at the target.
 */
function enclosingRepo(dir) {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const [command, ...rest] = process.argv.slice(2);
const args = parse(rest);

if (command === "keygen") {
  const out = args.get("out");
  if (!out) fail("missing required option --out");
  // The repository check runs on the *resolved* path as well as the lexical
  // one: `--out` reached through a junction or symlink writes through the
  // link, so a link whose lexical location is outside every repository can
  // still land the private key inside a tracked tree. Resolving first makes
  // the repo test answer where the bytes will land, not what the string says.
  const repo = enclosingRepo(out) ?? enclosingRepo(resolveExisting(out));
  if (repo !== null || isPathInside(process.cwd(), out)) {
    fail(`refusing to write signing material inside the repository: ${resolve(out)}`);
  }
  const keyPath = join(out, "approval.key");
  const pubPath = join(out, "approval.pub");
  if (existsSync(keyPath)) fail(`refusing to overwrite an existing private key at ${keyPath}`);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(out, { recursive: true });
  writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  writeFileSync(pubPath, publicKey.export({ format: "pem", type: "spki" }));
  console.log(`private key: ${keyPath}`);
  console.log(`public key:  ${pubPath}`);
  console.log(`export BW_APPROVAL_PUBLIC_KEY=${pubPath}`);
} else if (command === "sign") {
  const keyPath = args.get("key");
  if (!keyPath) fail("missing required option --key");
  // The same rule keygen enforces, applied to the key actually being used.
  // keygen only governs keys this tool created; a key copied into a tracked
  // tree, or generated before that guard existed, signed without objection.
  // The repository is identified on the *resolved* path so a junction or
  // symlink cannot make an in-tree key read as an outside one, and there is
  // no cwd fallback: a key that lives in no repository is outside the rule,
  // wherever the script is run from, and falling back to the cwd would refuse
  // legitimate keys merely for being under the operator's current directory.
  if (enclosingRepo(resolveExisting(keyPath)) !== null) {
    fail(`refusing to read signing material from inside the repository: ${resolve(keyPath)}`);
  }
  let privateKey;
  try {
    privateKey = readFileSync(keyPath, "utf8");
  } catch (err) {
    fail(`cannot read private key ${keyPath}: ${err.message}`);
  }
  // The payload is read from stdin, never argv: it contains newlines, and a
  // shell would shred it the same way section 11 records for prompts.
  //
  // What arrives on stdin is not what the gate recomputes. Measured on
  // Windows PowerShell 5.1, the documented pipe delivers the payload with a
  // UTF-8 BOM prepended and every LF rewritten to CRLF; a `> payload.txt`
  // redirect does the same. The gate recomputes `approvalPayload()`, which
  // is LF with no BOM, so signing the bytes as received produced a signature
  // that could never verify on the default shell of a supported platform.
  //
  // `normalizeText` is the same normalization the spec hash applies. The
  // trailing newlines are stripped after it, and all of them: `console.log`
  // appends one, and the redirect workflow (`> payload.txt`, then
  // `Get-Content -Raw |`) was measured delivering two — the file keeps its
  // own and PowerShell appends another piping the string to a native command.
  // A payload never ends with a newline by construction: the last line is a
  // scope path or the `scope: 0` count, so none of them are load-bearing.
  const payload = normalizeText(readStdin()).replace(/\n+$/, "");
  if (payload === "") fail("no payload on stdin: pipe the output of bw approval-request");
  console.log(sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64"));
} else {
  fail(USAGE);
}
