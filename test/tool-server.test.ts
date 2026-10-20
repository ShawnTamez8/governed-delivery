import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

/**
 * The tool server without Docker (docs/features/sandboxed-implementer/plan.md,
 * Task 2): the MCP handshake, the path refusals, the call log's order, the
 * error path for a container that does not exist, and unparseable input. The
 * containment properties are `test/container.test.ts`'s, against real Docker.
 */

const SERVER = resolve("src", "tool-server.ts");

interface Reply {
  id: number | string | null;
  result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; serverInfo?: unknown };
  error?: { code: number; message: string };
}

class Client {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number | string | null, (reply: Reply) => void>();
  private nextId = 1;

  constructor(args: string[], env: NodeJS.ProcessEnv = process.env) {
    this.child = spawn(process.execPath, [SERVER, ...args], { env, shell: false, windowsHide: true });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const reply = JSON.parse(line) as Reply;
      const resolveReply = this.pending.get(reply.id);
      if (resolveReply) {
        this.pending.delete(reply.id);
        resolveReply(reply);
      }
    });
  }

  request(method: string, params: object = {}): Promise<Reply> {
    const id = this.nextId++;
    return new Promise((resolveReply) => {
      this.pending.set(id, resolveReply);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  raw(line: string): Promise<Reply> {
    return new Promise((resolveReply) => {
      this.pending.set(null, resolveReply);
      this.child.stdin.write(`${line}\n`);
    });
  }

  async call(name: string, args: object): Promise<{ text: string; isError: boolean }> {
    const reply = await this.request("tools/call", { name, arguments: args });
    return { text: (reply.result?.content ?? []).map((c) => c.text).join(""), isError: reply.result?.isError === true };
  }

  close(): Promise<void> {
    return new Promise((resolveClose) => {
      this.child.on("close", () => resolveClose());
      this.child.stdin.end();
    });
  }
}

interface LogRecord {
  event: string;
  seq?: number;
  tool?: string;
  reason?: string;
  message?: string;
  head?: string;
}

function readLog(path: string): LogRecord[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as LogRecord);
}

function withServer(
  docker: string[],
  container: string,
  body: (client: Client, logPath: string) => Promise<void>,
  options: { dockerEnv?: Record<string, string>; env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bw-tool-server-"));
  const logPath = join(dir, "calls.jsonl");
  const client = new Client(
    ["--container", container, "--docker", JSON.stringify(docker), "--docker-env", JSON.stringify(options.dockerEnv ?? {}), "--log", logPath, "--timeout", "30"],
    options.env
  );
  return body(client, logPath).finally(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });
}

/** A Docker command that cannot exist, so any call that reached Docker would say ENOENT. */
const NO_DOCKER = ["bw-no-such-docker-binary-for-tests"];

test("the server answers initialize and lists its four tools", async () => {
  await withServer(NO_DOCKER, "bw-none", async (client) => {
    const init = await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.deepEqual(init.result?.serverInfo, { name: "bw", version: "1" });
    const tools = (await client.request("tools/list")).result?.tools?.map((t) => t.name).sort();
    assert.deepEqual(tools, ["list_files", "read_file", "run_command", "write_file"]);
  });
});

test(".git, absolute and .. paths are refused by name before any Docker call", async () => {
  await withServer(NO_DOCKER, "bw-none", async (client, logPath) => {
    const cases: [string, object, RegExp][] = [
      ["write_file", { path: ".git", content: "gitdir: /tmp\n" }, /^refused: the checkout's \.git is not writable/],
      ["read_file", { path: ".git/config" }, /^refused: the checkout's \.git/],
      ["write_file", { path: "/etc/x", content: "x" }, /^refused: path must be relative to the checkout: \/etc\/x$/],
      ["read_file", { path: "C:\\x" }, /^refused: path must be relative/],
      ["write_file", { path: "../x", content: "x" }, /^refused: path escapes the checkout: \.\.\/x$/],
      ["list_files", { path: "src/../../x" }, /^refused: path escapes the checkout/],
    ];
    for (const [tool, args, expected] of cases) {
      const answer = await client.call(tool, args);
      assert.equal(answer.isError, true);
      assert.match(answer.text, expected);
    }
    const records = readLog(logPath);
    assert.equal(records.filter((r) => r.event === "refused").length, cases.length);
    assert.deepEqual(records.filter((r) => r.event === "finished" || r.event === "error"), []);
  });
});

test("every call is logged as started before its outcome, once each", async () => {
  await withServer(NO_DOCKER, "bw-none", async (client, logPath) => {
    await client.call("write_file", { path: "../x", content: "x" });
    await client.call("read_file", { path: "README.md" });
    await client.call("run_command", { command: "true" });
    const bySeq = new Map<number, string[]>();
    for (const record of readLog(logPath)) {
      if (record.seq !== undefined) bySeq.set(record.seq, [...(bySeq.get(record.seq) ?? []), record.event]);
    }
    assert.equal(bySeq.size, 3);
    for (const events of bySeq.values()) {
      assert.equal(events.length, 2, events.join(","));
      assert.equal(events[0], "started");
      assert.ok(["finished", "refused", "error"].includes(events[1]!), events[1]);
    }
  });
});

test("run_command against a container that does not exist names the container and Docker's own error", async () => {
  const container = `bw-missing-${process.pid}-${Date.now()}`;
  await withServer(["docker"], container, async (client, logPath) => {
    const answer = await client.call("run_command", { command: "echo hello" });
    assert.equal(answer.isError, true);
    assert.ok(answer.text.includes(container), answer.text);
    assert.match(answer.text, /No such container|ENOENT|daemon|connect/i);
    const outcome = readLog(logPath).find((r) => r.seq === 1 && (r.event === "error" || r.event === "finished"));
    assert.ok(outcome, "the log holds the call's outcome");
    if (outcome.event === "error") assert.ok(outcome.message?.includes(container), outcome.message);
  });
});

test("a tool call's Docker client gets the stage's --docker-env, though the server's own environment lacks it", async () => {
  // The harness environment drops the variables that select a Docker engine
  // (hazards 9 and 12). This probe stands in for `docker`: it answers the
  // exit-status read with 0 and every other call with the engine it was told.
  const dir = mkdtempSync(join(tmpdir(), "bw-tool-server-probe-"));
  try {
    const probe = join(dir, "probe-docker.mjs");
    writeFileSync(
      probe,
      [
        "const args = process.argv.slice(2);",
        'if (args.some((a) => a.startsWith("/tmp/bw-exit-"))) process.stdout.write("0");',
        'else process.stdout.write(`DOCKER_CONTEXT=${process.env.DOCKER_CONTEXT ?? "unset"}`);',
        "",
      ].join("\n")
    );
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("DOCKER_")));
    const docker = [process.execPath, probe];
    for (const [dockerEnv, expected] of [
      [{ DOCKER_CONTEXT: "engine-a" }, "DOCKER_CONTEXT=engine-a"],
      // Control: without it the client would address the default engine.
      [{}, "DOCKER_CONTEXT=unset"],
    ] as const) {
      await withServer(docker, "work-id", async (client) => {
        const answer = await client.call("read_file", { path: "README.md" });
        assert.deepEqual(answer, { text: expected, isError: false });
      }, { dockerEnv, env });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("list_files strips the /work mount prefix once per line, so a directory named work keeps its path", async () => {
  // The probe answers the listing with what `find /work -maxdepth 3` prints
  // for a checkout holding src/work/a.js (the real form is checked against an
  // engine in test/container.test.ts).
  const dir = mkdtempSync(join(tmpdir(), "bw-tool-server-probe-"));
  try {
    const probe = join(dir, "probe-docker.mjs");
    writeFileSync(
      probe,
      [
        "const args = process.argv.slice(2);",
        'if (args.some((a) => a.startsWith("/tmp/bw-exit-"))) process.stdout.write("0");',
        'else process.stdout.write("/work\\n/work/src\\n/work/src/work\\n/work/src/work/a.js\\n");',
        "",
      ].join("\n")
    );
    await withServer([process.execPath, probe], "work-id", async (client) => {
      const answer = await client.call("list_files", { path: "." });
      assert.deepEqual(answer, { text: ".\nsrc\nsrc/work\nsrc/work/a.js\n", isError: false });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing --docker-env, or one naming a variable that does not select an engine, is refused before serving", () => {
  for (const [extra, expected] of [
    [[], /^usage: tool-server\.ts /],
    [["--docker-env", '{"PATH":"x"}'], /^--docker-env must be a JSON object of strings named among DOCKER_HOST, /],
    [["--docker-env", '["DOCKER_HOST"]'], /^--docker-env must be a JSON object/],
  ] as const) {
    const result = spawnSync(process.execPath, [SERVER, "--container", "c", "--docker", '["docker"]', ...extra, "--log", join(tmpdir(), "unused.jsonl"), "--timeout", "30"], {
      encoding: "utf8",
      input: "",
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, expected);
  }
});

test("an unparseable line is answered with -32700 and logged with its head", async () => {
  await withServer(NO_DOCKER, "bw-none", async (client, logPath) => {
    const reply = await client.raw("{not json at all");
    assert.equal(reply.error?.code, -32700);
    const record = readLog(logPath).find((r) => r.event === "unparseable");
    assert.equal(record?.head, "{not json at all");
    // The server keeps serving after a bad line.
    const tools = (await client.request("tools/list")).result?.tools?.length;
    assert.equal(tools, 4);
  });
});
