import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CLAUDE_CODE } from "../src/executor.ts";
import { parseEnvelope } from "../src/harness.ts";

// Hazard 4: a hand-written stream shape must not drift from the real one. The
// stage emitters under test/fixtures/harness write the line sequence of the
// one recorded real invocation, reduced; these tests hold them to it.

const FIXTURES = join(process.cwd(), "test", "fixtures", "harness");
const RECORDING = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "harness-stream-json-envelope.json"), "utf8")
) as { stream: string };

interface StreamLine {
  type: string;
  subtype?: string;
  event?: { type?: string; delta?: { type?: string } };
  [field: string]: unknown;
}

function lines(stream: string): StreamLine[] {
  return stream.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as StreamLine);
}

/** The line kind: top-level type, then the subtype or stream-event type, then the delta type. */
function kind(line: StreamLine): string {
  return `${line.type}:${line.subtype ?? line.event?.type ?? ""}:${line.event?.delta?.type ?? ""}`;
}

const recorded = lines(RECORDING.stream);
const recordedKinds = new Set(recorded.map(kind));
const recordedResult = recorded.at(-1) as StreamLine & {
  usage: Record<string, unknown>;
  modelUsage: Record<string, Record<string, unknown>>;
};

function subset(actual: string[], allowed: Iterable<string>, what: string): void {
  const permitted = new Set(allowed);
  const extra = actual.filter((name) => !permitted.has(name));
  assert.deepEqual(extra, [], `${what} names fields the recorded stream does not have`);
}

interface Emission {
  name: string;
  script: string;
  prompt: string;
  env?: Record<string, string>;
  /** Fields the result line carries beyond the recorded ones, by design. */
  extraResultFields?: string[];
}

const BASE_COMMIT = "a".repeat(40);
const EMISSIONS: Emission[] = [
  { name: "emit-spec-stage (unrecognized prompt)", script: "emit-spec-stage.mjs", prompt: "hello" },
  { name: "emit-plan-stage (unrecognized prompt)", script: "emit-plan-stage.mjs", prompt: "hello" },
  {
    name: "emit-implementation-stage",
    script: "emit-implementation-stage.mjs",
    prompt: `baseCommit must be exactly: ${BASE_COMMIT}\n\nPatch only these paths:\n\nsrc/a.ts\n\n`,
  },
  {
    name: "emit-code-review",
    script: "emit-code-review.mjs",
    prompt: "you are the code reviewer code-reviewer-correctness with specialty x\n\nChanged paths:\n\nsrc/a.ts\n\n",
  },
  {
    name: "emit-code-review (prose result)",
    script: "emit-code-review.mjs",
    prompt: "you are the code reviewer code-reviewer-correctness with specialty x\n\nChanged paths:\n\nsrc/a.ts\n\n",
    env: { EMIT_MODE: "prose" },
  },
  { name: "echo-json", script: "echo-json.mjs", prompt: "hello", extraResultFields: ["stdinLength", "argv"] },
];

function run(emission: Emission): string {
  const cwd = mkdtempSync(join(tmpdir(), "bw-stream-fixture-"));
  try {
    writeFileSync(join(cwd, "base.txt"), "base marker\n");
    const child = spawnSync(process.execPath, [join(FIXTURES, emission.script)], {
      cwd, input: emission.prompt, encoding: "utf8", shell: false,
      env: { ...process.env, EMIT_MODE: "ok", ...(emission.env ?? {}) },
    });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

for (const emission of EMISSIONS) {
  test(`${emission.name} emits the recorded stream shape and parses through parseEnvelope`, () => {
    const stdout = run(emission);
    const emitted = lines(stdout);
    assert.ok(emitted.length >= 2, "a stream, not a single envelope object");
    for (const line of emitted) {
      assert.ok(recordedKinds.has(kind(line)), `line kind ${kind(line)} is not in the recorded stream`);
    }
    const results = emitted.filter((line) => line.type === "result");
    assert.equal(results.length, 1);
    assert.equal(emitted.at(-1), results[0], "the result line is last");
    const result = results[0] as StreamLine & { usage?: Record<string, unknown>; modelUsage?: Record<string, Record<string, unknown>> };
    subset(Object.keys(result), [...Object.keys(recordedResult), ...(emission.extraResultFields ?? [])], "the result line");
    if (result.usage !== undefined) subset(Object.keys(result.usage), Object.keys(recordedResult.usage), "usage");
    for (const entry of Object.values(result.modelUsage ?? {})) {
      const recordedEntry = Object.values(recordedResult.modelUsage)[0]!;
      subset(Object.keys(entry), Object.keys(recordedEntry), "a modelUsage entry");
    }
    const envelope = parseEnvelope(CLAUDE_CODE, stdout);
    assert.equal(envelope.resultText, (result.result as string | undefined) ?? "");
    if (result.modelUsage !== undefined) assert.equal(envelope.effectiveModel, "fixture-model");
  });
}

test("the recorded stream's own line kinds all satisfy the shape check the emitters are held to", () => {
  // A guard on the guard: the recording parses, ends in one result line, and
  // carries every kind the emitters are allowed to use.
  assert.equal(parseEnvelope(CLAUDE_CODE, RECORDING.stream).effectiveModel, "claude-sonnet-5");
  for (const wanted of ["system:init:", "stream_event:content_block_delta:text_delta", "assistant::", "result:success:"]) {
    assert.ok(recordedKinds.has(wanted), `the recording lacks ${wanted}`);
  }
});
