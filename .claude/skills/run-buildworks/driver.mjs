#!/usr/bin/env node
// Drives the bw CLI against a throwaway target repository.
//
//   node .claude/skills/run-buildworks/driver.mjs smoke     # free: no dispatches
//   node .claude/skills/run-buildworks/driver.mjs prepare   # just build the target
//   node .claude/skills/run-buildworks/driver.mjs paid --yes # real model spend
//
// bw governs the repository it is run *in*, so every invocation here sets cwd
// to a scratch repository built by prepareTarget() — never this one. The
// scratch repo is left on disk; its path is the last line of output.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SKILL_DIR, "..", "..", "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");
const SIGN = join(REPO_ROOT, "scripts", "sign-approval.mjs");

// node:sqlite prints an experimental warning on every invocation. It is noise
// on a summary line, and it is not what any expectation below is about.
const NOISE = /^\(node:\d+\) ExperimentalWarning|^\(Use `node --trace-warnings/;
const clean = (s) =>
  s.split(/\r?\n/).filter((l) => l.trim() !== "" && !NOISE.test(l)).join("\n");

const args = process.argv.slice(2);
const command = args[0] ?? "smoke";
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const results = [];
let target = null;
let env = process.env;

const DEFAULT_SLUG = "clamp";
const DESIGN = `# Clamp a number to a range

## Goal

Add \`scripts/clamp.mjs\`, one file exporting one function.

## Behaviour

\`clamp(value, min, max)\` returns \`min\` when \`value\` is below \`min\`,
\`max\` when \`value\` is above \`max\`, and \`value\` otherwise. It throws a
\`RangeError\` when \`min\` is greater than \`max\`.

## Acceptance criteria

- \`scripts/clamp.mjs\` exports a named function \`clamp\`.
- \`clamp(5, 1, 10)\` returns 5; \`clamp(-2, 1, 10)\` returns 1; \`clamp(99, 1, 10)\` returns 10.
- \`clamp(1, 10, 1)\` throws \`RangeError\`.

## Out of scope

CLI wiring, tests, and every other file.
`;

function exec(file, argv, opts = {}) {
  const r = spawnSync(file, argv, {
    cwd: opts.cwd ?? target?.repo ?? REPO_ROOT,
    env: opts.env ?? env,
    encoding: opts.encoding ?? "utf8",
    input: opts.input,
    // node and git are real executables, so no shell and nothing to quote.
    // The one exception is the claude probe: it is an npm shim (claude.cmd)
    // on Windows, which spawnSync cannot resolve without one — hazard 8, the
    // same reason src/harness.ts spawns with `shell: WINDOWS`.
    shell: opts.shell ?? false,
  });
  if (r.error) throw r.error;
  return r;
}

function bw(argv, opts = {}) {
  const r = exec(process.execPath, [CLI, ...argv], opts);
  return { code: r.status, out: clean(`${r.stdout ?? ""}\n${r.stderr ?? ""}`), stdout: r.stdout ?? "" };
}

/**
 * One driven step with a declared expectation. A step whose exit code or
 * output does not match is recorded as a failure and the run keeps going:
 * the summary is more useful than the first stack trace, and later steps
 * frequently explain the earlier one.
 */
function step(name, expect, fn) {
  let outcome;
  try {
    outcome = fn();
  } catch (err) {
    outcome = { code: null, out: `driver error: ${err.message}` };
  }
  const codeOk = expect.exit === undefined || outcome.code === expect.exit;
  const matchOk = expect.match === undefined || expect.match.test(outcome.out);
  results.push({ name, ok: codeOk && matchOk, expect, ...outcome });
  return outcome;
}

/** A git repository bw can govern: committed governed.yaml, clean tree. */
function prepareTarget(root) {
  const repo = join(root, "target");
  const keys = join(root, "keys");
  mkdirSync(repo, { recursive: true });
  const git = (...a) => {
    const r = exec("git", a, { cwd: repo });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")} failed: ${clean(r.stderr ?? "")}`);
  };
  git("init", "-q", ".");
  git("config", "user.email", "smoke@buildworks.invalid");
  git("config", "user.name", "BuildWorks smoke");
  // .governance/ does not have to be ignored — new-run filters it out of the
  // clean-tree check — but an unignored target reports it as untracked
  // forever, which makes every later git read noisy.
  writeFileSync(join(repo, ".gitignore"), ".governance/\n");
  // Cheap real commands. npm is deliberate: it is a shim on Windows, which is
  // the path hazard 8 is about, and the recorded smoke used the same two.
  writeFileSync(
    join(repo, "governed.yaml"),
    'verify:\n  - name: node-version\n    command: ["node", "--version"]\n  - name: npm-version\n    command: ["npm", "--version"]\n'
  );
  // The spec stage reads docs/features/<slug>/design.md from the target — the
  // one human-authored input in the whole chain. The slug has to match the
  // run's, so this file and newRunArgs() share DEFAULT_SLUG. Deliberately
  // small: every dispatch downstream reads it, and a vague design is what
  // makes a chain expensive.
  mkdirSync(join(repo, "docs", "features", DEFAULT_SLUG), { recursive: true });
  writeFileSync(join(repo, "docs", "features", DEFAULT_SLUG, "design.md"), DESIGN);
  git("add", "-A");
  git("commit", "-qm", "scratch target");
  const head = exec("git", ["rev-parse", "HEAD"], { cwd: repo }).stdout.trim();

  // The signer is frozen into the profile at new-run, so the key has to exist
  // before the first command, not before `approve`. keygen refuses to write
  // inside any git repository, which is why keys/ is a sibling of target/.
  const pub = join(keys, "approval.pub");
  if (!existsSync(pub)) {
    const r = exec(process.execPath, [SIGN, "keygen", "--out", keys], { cwd: REPO_ROOT });
    if (r.status !== 0) throw new Error(`keygen failed: ${clean(r.stderr ?? "")}`);
  }
  return { root, repo, keys, key: join(keys, "approval.key"), pub, head };
}

function newRunArgs(slug = DEFAULT_SLUG) {
  return ["new-run", "--project", "smoke", "--feature", slug, "--slug", slug,
          "--change-kind", "feature", "--model", value("model", "claude-sonnet-5")];
}

/** The whole surface that refuses, passes, or reports without dispatching. */
function freeSmoke() {
  step("migrate", { exit: 0, match: /migrations applied/ }, () => bw(["migrate"]));

  const created = step("new-run", { exit: 0, match: /^\d+$/m }, () => bw(newRunArgs()));
  const runId = (created.stdout.match(/\d+/) ?? ["1"])[0];

  step("new-run refuses a dirty tree", { exit: 1, match: /working tree is not clean/ }, () => {
    writeFileSync(join(target.repo, "dirt.txt"), "uncommitted\n");
    const r = bw(newRunArgs("dirty"));
    rmSync(join(target.repo, "dirt.txt"));
    return r;
  });

  step("new-run refuses a non-repository", { exit: 1, match: /not a git repository/ }, () => {
    const plain = join(target.root, "plain");
    mkdirSync(plain, { recursive: true });
    return bw(newRunArgs("plain"), { cwd: plain });
  });

  step("new-run refuses an uncommitted governed.yaml", { exit: 1, match: /is not committed at/ }, () => {
    const bare = join(target.root, "nogov");
    mkdirSync(bare, { recursive: true });
    const git = (...a) => exec("git", a, { cwd: bare });
    git("init", "-q", ".");
    git("config", "user.email", "smoke@buildworks.invalid");
    git("config", "user.name", "BuildWorks smoke");
    writeFileSync(join(bare, ".gitignore"), ".governance/\n");
    git("add", "-A");
    git("commit", "-qm", "no config");
    return bw(newRunArgs("nogov"), { cwd: bare });
  });

  step("new-run refuses an unknown change kind", { exit: 2, match: /invalid change_kind/ }, () =>
    bw(["new-run", "--project", "s", "--feature", "f", "--slug", "s",
        "--change-kind", "nonsense", "--model", "claude-sonnet-5"]));

  step("new-run refuses an unspawnable model name", { exit: 2, match: /invalid model name/ }, () =>
    bw(["new-run", "--project", "s", "--feature", "f", "--slug", "s",
        "--change-kind", "feature", "--model", "bad model name"]));

  // The approval gate reads the spec_review stage's own audit event, so it
  // cannot be reached without a real spec stage. This refusal is where the
  // free path ends.
  step("approval-request refuses before a passed spec_review",
    { exit: 1, match: /no passed spec_review stage/ }, () =>
    bw(["approval-request", "--run", runId, "--expires", expiry()]));

  step("verify refuses without a passed implementation",
    { exit: 1, match: /not a passed implementation/ }, () => bw(["verify", "--run", runId]));

  step("verify refuses a run that does not exist", { exit: 1, match: /does not exist/ }, () =>
    bw(["verify", "--run", "9999"]));

  step("verify-audit validates the chain", { exit: 0, match: /chain valid/ }, () =>
    bw(["verify-audit"]));

  step("an unknown command prints usage", { exit: 2, match: /usage: bw <command>/ }, () =>
    bw(["bogus"]));

  return runId;
}

const expiry = () => new Date(Date.now() + 3600 * 1000).toISOString();

/** The chain that spends: every stage below dispatches the real claude binary. */
function paidChain() {
  const probe = exec("claude", ["--version"], { shell: process.platform === "win32" });
  if (probe.status !== 0) throw new Error("claude is not on PATH: the paid chain cannot run");
  console.log(`claude ${probe.stdout.trim()}`);

  step("migrate", { exit: 0, match: /migrations applied/ }, () => bw(["migrate"]));
  const created = step("new-run", { exit: 0, match: /^\d+$/m }, () => bw(newRunArgs()));
  const runId = (created.stdout.match(/\d+/) ?? ["1"])[0];

  step("spec (author + panel + gate)", { exit: 0, match: /spec\.md/ }, () =>
    bw(["spec", "--run", runId]));

  const exp = expiry();
  const payload = step("approval-request", { exit: 0 }, () => {
    // Buffer, not utf8: the signature covers exactly these bytes.
    const r = exec(process.execPath, [CLI, "approval-request", "--run", runId, "--expires", exp],
      { encoding: "buffer" });
    return { code: r.status, out: clean(String(r.stderr ?? "")), bytes: r.stdout };
  });

  const signed = step("sign", { exit: 0 }, () => {
    const r = exec(process.execPath, [SIGN, "sign", "--key", target.key],
      { input: payload.bytes, cwd: REPO_ROOT });
    return { code: r.status, out: clean(`${r.stdout ?? ""}${r.stderr ?? ""}`), stdout: r.stdout ?? "" };
  });

  step("approve", { exit: 0, match: /^\d+$/m }, () =>
    bw(["approve", "--run", runId, "--expires", exp, "--signature", (signed.stdout ?? "").trim()]));

  step("plan (author + panel + gate)", { exit: 0, match: /plan\.md/ }, () =>
    bw(["plan", "--run", runId]));
  step("implement (worktree + patches)", { exit: 0, match: /worktrees/ }, () =>
    bw(["implement", "--run", runId]));
  step("verify (frozen commands)", { exit: 0, match: /result\.json/ }, () =>
    bw(["verify", "--run", runId]));
  // Step 8: the delivery check is what makes `completed` reachable from the
  // default paid workflow (hazard 11) — a chain that never reaches it has no
  // record that delivery ever happened. Success prints the result reference;
  // blocking output would print the named missing artifacts and exit 1.
  step("deliver (step 8 delivery check)", { exit: 0, match: /result\.json/ }, () =>
    bw(["deliver", "--run", runId]));
  step("delivery terminal state", { exit: 0, match: /delivery_check=passed run=completed/ }, () => {
    const db = new DatabaseSync(join(target.repo, ".governance", "state.db"), { readOnly: true });
    const stage = db.prepare(
      "SELECT status FROM stage WHERE kind = ? ORDER BY id DESC LIMIT 1"
    ).get("delivery_check");
    const run = db.prepare("SELECT status FROM run WHERE id = ?").get(runId);
    db.close();
    const state = `delivery_check=${stage?.status ?? "absent"} run=${run?.status ?? "absent"}`;
    return { code: state === "delivery_check=passed run=completed" ? 0 : 1, out: state };
  });
  step("delivery record covers the signed artifacts", { exit: 0, match: /missing=\[\], outcome=pass/ }, () => {
    const rec = JSON.parse(readFileSync(
      join(target.repo, ".governance", "delivery", String(runId), "result.json"), "utf8"));
    const summary = `declared=${rec.declared.length} delivered=${rec.delivered.length} ` +
                    `missing=${JSON.stringify(rec.missing)}, outcome=${rec.outcome}`;
    return {
      code: rec.missing.length === 0 && rec.outcome === "pass" ? 0 : 1,
      out: summary,
    };
  });
  step("verify-audit over the completed chain", { exit: 0, match: /chain valid/ }, () =>
    bw(["verify-audit"]));

  // Never between the run and its summary: a paid chain costs real money, and
  // a reporting bug here once threw away the record of one that had already
  // completed. Report what can be read, then always summarize.
  try {
    reportCost(target.repo);
  } catch (err) {
    console.error(`could not read the cost record: ${err.message}`);
    console.error(`the store is intact at ${join(target.repo, ".governance", "state.db")}`);
  }
  return runId;
}

/** What the run cost and what state it reached — the queryable-cost milestone. */
function reportCost(repo) {
  const db = new DatabaseSync(join(repo, ".governance", "state.db"), { readOnly: true });
  const rows = db.prepare(
    "SELECT agent, role, effective_model AS model, cost, duration_ms FROM agent_run ORDER BY id"
  ).all();
  const stages = db.prepare("SELECT id, kind, status FROM stage ORDER BY id").all();
  const runs = db.prepare("SELECT id, slug, status FROM run ORDER BY id").all();
  db.close();
  const total = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  console.log(`\ndispatches: ${rows.length}   total cost: $${total.toFixed(5)}`);
  for (const r of rows) {
    console.log(`  ${r.agent} (${r.role}, ${r.model ?? "model unreported"}) ` +
                `$${(r.cost ?? 0).toFixed(5)} ${r.duration_ms}ms`);
  }
  console.log(`stages: ${stages.map((s) => `${s.kind}=${s.status}`).join(" ")}`);
  for (const r of runs) console.log(`run ${r.id} (${r.slug}): ${r.status}`);
}

function summarize() {
  const width = Math.max(...results.map((r) => r.name.length));
  console.log("");
  for (const r of results) {
    const first = (r.out.split("\n")[0] ?? "").slice(0, 96);
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name.padEnd(width)}  exit=${r.code}  ${first}`);
    if (!r.ok) {
      console.log(`      expected exit=${r.expect.exit ?? "any"} match=${r.expect.match ?? "any"}`);
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps as expected`);
  console.log(`target repository: ${target.repo}`);
  return failed.length === 0;
}

const root = value("dir", join(tmpdir(), "bw-run-skill", String(Date.now())));

// Reads a target repository a previous run left behind. No scratch repo is
// built and nothing is dispatched, so it is the cheap way to ask what a paid
// run cost and where it stopped.
if (command === "report") {
  const repo = value("dir", null);
  if (!repo) {
    console.error("report needs --dir <target repository> (the path the smoke printed)");
    process.exit(2);
  }
  reportCost(repo);
  process.exit(0);
}

if (command === "clean") {
  const base = value("dir", join(tmpdir(), "bw-run-skill"));
  rmSync(base, { recursive: true, force: true });
  console.log(`removed ${base}`);
  process.exit(0);
}

// Before anything is built: refusing after creating a scratch repository
// leaves litter behind for a command that never ran.
if (command === "paid" && !flag("yes")) {
  console.error("paid dispatches real model calls and spends money. Re-run with --yes.");
  process.exit(2);
}

mkdirSync(root, { recursive: true });
target = prepareTarget(root);
env = { ...process.env, BW_APPROVAL_PUBLIC_KEY: target.pub };

if (command === "prepare") {
  console.log(`target repository: ${target.repo}`);
  console.log(`starting commit:   ${target.head}`);
  console.log(`public key:        ${target.pub}`);
  console.log(`private key:       ${target.key}`);
  console.log(`\ndrive it with:\n  cd ${target.repo}`);
  console.log(`  BW_APPROVAL_PUBLIC_KEY=${target.pub} node ${CLI} migrate`);
  process.exit(0);
}

if (command === "paid") {
  if (!flag("yes")) {
    console.error("paid dispatches real model calls and spends money. Re-run with --yes.");
    process.exit(2);
  }
  paidChain();
  process.exit(summarize() ? 0 : 1);
}

if (command !== "smoke") {
  console.error(`unknown command ${command}: expected smoke, prepare, paid, report, or clean`);
  process.exit(2);
}

freeSmoke();
process.exit(summarize() ? 0 : 1);
