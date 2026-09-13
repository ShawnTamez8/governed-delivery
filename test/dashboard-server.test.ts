import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { request } from "node:http";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadDashboardRepositories } from "../src/dashboard-config.ts";
import { startDashboardServer, waitForDashboardShutdown } from "../src/dashboard-server.ts";
import { parseArguments, UsageError } from "../src/cli-args.ts";
import { openStore } from "../src/store.ts";
import type { OperatorResult } from "../src/operator-output.ts";
import { readRunsResult, readStatusResult } from "../src/operator-read.ts";
import { sha256Hex } from "../src/canonical.ts";
import type { DashboardRepository } from "../src/dashboard-config.ts";

const CLI = resolve("src", "cli.ts");

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "bw-dashboard-"));
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function repository(parent: string, name: string): string {
  const root = join(parent, name);
  mkdirSync(root);
  git(root, "init", "-q");
  writeFileSync(join(root, ".gitignore"), ".governance/\n");
  writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: unit\n    command: ["node", "--version"]\n');
  git(root, "add", "-A");
  git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
  return root;
}

function filesystemInventory(root: string): unknown[] {
  return readdirSync(root).sort().map((name) => {
    const path = join(root, name);
    const stat = lstatSync(path);
    return stat.isDirectory()
      ? [name, filesystemInventory(path)]
      : [name, stat.size, sha256Hex(readFileSync(path))];
  });
}

function bearer(bootstrapUrl: string): string {
  const hash = new URL(bootstrapUrl).hash.slice(1);
  const token = new URLSearchParams(hash).get("token");
  assert.ok(token);
  return token;
}

function requestStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const outgoing = request(url, { headers }, (response) => {
      response.resume();
      response.once("end", () => resolveStatus(response.statusCode!));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

test("dashboard repository files accept one leading BOM and reject every other shape", () => {
  const parent = workspace();
  try {
    const first = repository(parent, "first");
    const second = repository(parent, "second");
    const file = join(parent, "repositories.json");
    writeFileSync(file, `\uFEFF${JSON.stringify({ repositories: [first, second] })}`);
    assert.deepEqual(loadDashboardRepositories(file, parent).map((entry) => entry.path), [first, second]);
    const invalid: unknown[] = [
      "", "\uFEFF", "{", [], {}, { repositories: [] }, { repositories: "x" },
      { repositories: ["relative"] }, { repositories: [first, first] },
      { repositories: [first], extra: true }, { repositories: [1] },
    ];
    for (const value of invalid) {
      writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
      assert.throws(() => loadDashboardRepositories(file, parent), UsageError);
    }
    writeFileSync(file, `\uFEFF\uFEFF${JSON.stringify({ repositories: [first] })}`);
    assert.throws(() => loadDashboardRepositories(file, parent), /not valid JSON/);
    if (process.platform === "win32") {
      writeFileSync(file, JSON.stringify({ repositories: [first, `${first}\\`] }));
      assert.throws(() => loadDashboardRepositories(file, parent), /duplicate normalized path/);
      writeFileSync(file, JSON.stringify({ repositories: [first, first.toUpperCase()] }));
      assert.throws(() => loadDashboardRepositories(file, parent), /duplicate normalized path/);
    }
    writeFileSync(file, `\uFEFF\uFEFF${JSON.stringify({ repositories: [first] })}`);
    const refused = spawnSync(process.execPath, [CLI, "dashboard", "--repositories-file", file], {
      cwd: parent, encoding: "utf8",
    });
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /repositories file.*not valid JSON/);
    assert.equal(existsSync(join(first, ".governance")), false);
    assert.equal(existsSync(join(second, ".governance")), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dashboard parsing rejects global target and JSON options without reading input", () => {
  assert.deepEqual(parseArguments(["dashboard", "--help"]).help, true);
  assert.throws(() => parseArguments(["dashboard"]), /--repositories-file/);
  assert.throws(() => parseArguments(["dashboard", "--repositories-file=x", "--json"]), /unknown option --json/);
  assert.throws(() => parseArguments(["dashboard", "--repositories-file=x", "--repo=y"]), /does not accept --repo/);
});

test("dashboard CLI prints one bootstrap URL, opens no state at startup, and follows platform SIGTERM behavior", async () => {
  const parent = workspace();
  try {
    const root = repository(parent, "target");
    const file = join(parent, "repositories.json");
    writeFileSync(file, JSON.stringify({ repositories: [root] }));
    const child = spawn(process.execPath, [CLI, "dashboard", "--repositories-file", file], {
      cwd: parent, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`dashboard did not start: ${stderr}`)), 10_000);
      child.stdout.on("data", () => {
        if (!stdout.includes("\n")) return;
        clearTimeout(timer);
        resolveReady();
      });
      child.once("exit", (code) => reject(new Error(`dashboard exited ${code}: ${stderr}`)));
    });
    assert.match(stdout, /^http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]+\r?\n$/);
    assert.equal(existsSync(join(root, ".governance")), false);
    assert.equal(child.kill("SIGTERM"), true);
    const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    if (process.platform === "win32") assert.equal(signal, "SIGTERM");
    else assert.equal(code, 0, `signal ${signal}: ${stderr}`);
    assert.equal(stderr, "");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dashboard shutdown closes once and removes both signal listeners", async () => {
  const parent = workspace();
  const root = repository(parent, "target");
  const file = join(parent, "repositories.json");
  writeFileSync(file, JSON.stringify({ repositories: [root] }));
  const server = await startDashboardServer(loadDashboardRepositories(file, parent), parent);
  const signals = new EventEmitter();
  const shutdown = waitForDashboardShutdown(server, signals);
  assert.equal(signals.listenerCount("SIGINT"), 1);
  assert.equal(signals.listenerCount("SIGTERM"), 1);
  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  await shutdown;
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  await assert.rejects(fetch(server.origin));
  rmSync(parent, { recursive: true, force: true });
});

test("dashboard server enforces its loopback transport and reuses complete read envelopes", async () => {
  const parent = workspace();
  const first = repository(parent, "first");
  const second = repository(parent, "second");
  const unavailable = join(parent, "unavailable");
  const store = openStore(first);
  const run = store.insertRun("project", "feature", "slug", "feature");
  store.close();
  const beforeFirst = JSON.stringify(readdirSync(first, { recursive: true }).sort());
  const beforeSecond = JSON.stringify(readdirSync(second, { recursive: true }).sort());
  const repositories = loadDashboardRepositories(
    (() => {
      const file = join(parent, "repositories.json");
      writeFileSync(file, JSON.stringify({ repositories: [first, second, unavailable] }));
      return file;
    })(),
    parent,
  );
  const server = await startDashboardServer(repositories, parent, "C:\\BuildWorks\\src\\cli.ts");
  try {
    assert.equal(server.host, "127.0.0.1");
    const token = bearer(server.bootstrapUrl);
    const headers = { Authorization: `Bearer ${token}` };
    const root = await fetch(server.origin);
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-security-policy")!, /default-src 'none'/);
    assert.equal(root.headers.get("cache-control"), "no-store");
    assert.equal(root.headers.get("x-frame-options"), "DENY");
    const unauthenticated = await fetch(`${server.origin}/api/repositories`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${server.origin}/api/repositories`, {
      headers: { Authorization: "Bearer wrong-token" },
    })).status, 401);
    assert.equal(await requestStatus(`${server.origin}/api/repositories`, {
      ...headers, Host: "example.invalid",
    }), 400);
    assert.equal((await fetch(`${server.origin}/api/repositories`, {
      headers: { ...headers, Origin: "http://example.invalid" },
    })).status, 400);
    assert.equal((await fetch(`${server.origin}/api/repositories`, { method: "POST", headers })).status, 405);
    assert.equal((await fetch(`${server.origin}/package.json`)).status, 404);
    assert.equal((await fetch(`${server.origin}/%2e%2e/package.json`)).status, 404);

    const inventoryResponse = await fetch(`${server.origin}/api/repositories`, { headers });
    assert.equal(inventoryResponse.status, 200);
    const inventory = await inventoryResponse.json() as {
      observedAt: string;
      cliPath: string;
      repositories: { id: string; path: string }[];
    };
    assert.ok(Number.isFinite(Date.parse(inventory.observedAt)));
    assert.equal(inventory.cliPath, "C:\\BuildWorks\\src\\cli.ts");
    assert.deepEqual(inventory.repositories.map((entry) => entry.path), [first, second, unavailable]);
    assert.ok(inventory.repositories.every((entry) => entry.id.length === 43));

    const firstId = inventory.repositories[0].id;
    const secondId = inventory.repositories[1].id;
    const unavailableId = inventory.repositories[2].id;
    let beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const listed = await fetch(`${server.origin}/api/repositories/${firstId}/runs?limit=1`, { headers });
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.equal(listed.status, 200);
    const listing = await listed.json() as OperatorResult;
    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const expectedListing = readRunsResult(first, parent, 1);
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.deepEqual({ ...listing, observedAt: expectedListing.observedAt }, expectedListing);
    assert.deepEqual(Object.keys(listing).sort(),
      ["command", "outcome", "repository", "runId", "errorCode", "reason", "observedAt", "result"].sort());
    assert.equal(listing.command, "runs");
    assert.equal(listing.outcome, "ok");
    assert.equal(listing.errorCode, null);
    assert.deepEqual((listing.result as { runs: { id: number }[] }).runs.map((entry) => entry.id), [run.id]);

    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const status = await fetch(`${server.origin}/api/repositories/${firstId}/runs/${run.id}`, { headers });
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.equal(status.status, 200);
    const snapshot = await status.json() as OperatorResult;
    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const expectedSnapshot = readStatusResult(first, parent, run.id);
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.deepEqual({ ...snapshot, observedAt: expectedSnapshot.observedAt }, expectedSnapshot);
    assert.equal(snapshot.command, "status");
    assert.equal(snapshot.outcome, "ok");
    assert.equal((snapshot.result as { run: { id: number } }).run.id, run.id);

    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const missing = await fetch(`${server.origin}/api/repositories/${secondId}/runs`, { headers });
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.equal(missing.status, 200);
    const refusal = await missing.json() as OperatorResult;
    assert.equal(refusal.outcome, "state_missing");
    assert.equal(refusal.errorCode, "state_missing");
    assert.equal(refusal.result, null);
    assert.equal(existsSync(join(second, ".governance")), false);

    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const invalid = await fetch(`${server.origin}/api/repositories/${unavailableId}/runs`, { headers });
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.equal(invalid.status, 200);
    const invalidTarget = await invalid.json() as OperatorResult;
    assert.equal(invalidTarget.errorCode, "target_unavailable");
    assert.equal(invalidTarget.repository, null);
    assert.ok(invalidTarget.reason?.includes(unavailable));

    assert.equal((await fetch(`${server.origin}/api/repositories/${firstId}/runs?limit=0`, { headers })).status, 400);
    assert.equal((await fetch(`${server.origin}/api/repositories/${firstId}/runs?limit=1&limit=2`, { headers })).status, 400);
    assert.equal((await fetch(`${server.origin}/api/repositories/unknown/runs`, { headers })).status, 404);
    assert.equal((await fetch(`${server.origin}/api/repositories/${firstId}/runs/not-a-run`, { headers })).status, 404);
    const script = await fetch(`${server.origin}/app.js`);
    const model = await fetch(`${server.origin}/dashboard-model.js`);
    const styles = await fetch(`${server.origin}/styles.css`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type")!, /^text\/javascript/);
    assert.equal(model.status, 200);
    assert.match(model.headers.get("content-type")!, /^text\/javascript/);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get("content-type")!, /^text\/css/);
    // The allowlist is exact: a sibling module the shell never imports is not served.
    assert.equal((await fetch(`${server.origin}/dashboard/dashboard-model.js`)).status, 404);
    assert.equal((await fetch(`${server.origin}/dashboard-model.js.map`)).status, 404);
    assert.equal(JSON.stringify(readdirSync(first, { recursive: true }).sort()), beforeFirst);
    assert.equal(JSON.stringify(readdirSync(second, { recursive: true }).sort()), beforeSecond);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dashboard repository identifiers survive configured reordering", async () => {
  const parent = mkdtempSync(join(tmpdir(), "bw-dashboard-order-"));
  const first = repository(parent, "first");
  const second = repository(parent, "second");

  async function identifiers(repositories: DashboardRepository[]): Promise<Map<string, string>> {
    const server = await startDashboardServer(repositories, parent, "C:\\BuildWorks\\src\\cli.ts");
    try {
      const response = await fetch(`${server.origin}/api/repositories`, {
        headers: { authorization: `Bearer ${bearer(server.bootstrapUrl)}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as {
        repositories: Array<{ id: string; path: string }>;
      };
      return new Map(body.repositories.map((entry) => [entry.path, entry.id]));
    } finally {
      await server.close();
    }
  }

  try {
    const file = join(parent, "repositories.json");
    writeFileSync(file, JSON.stringify({ repositories: [first, second] }));
    const configured = loadDashboardRepositories(file, parent);
    const original = await identifiers(configured);
    const reordered = await identifiers([...configured].reverse());
    assert.deepEqual(reordered, original);
    if (process.platform === "win32") {
      writeFileSync(file, JSON.stringify({ repositories: [first.toUpperCase()] }));
      const recased = await identifiers(loadDashboardRepositories(file, parent));
      assert.equal([...recased.values()][0], original.get(first));
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
