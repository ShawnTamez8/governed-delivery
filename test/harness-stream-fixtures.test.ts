import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CLAUDE_CODE } from "../src/executor.ts";
import { parseEnvelope } from "../src/harness.ts";
import { PATCH_RESULT_SCHEMA } from "../src/agent-result.ts";
import { SELF_REVIEW_RESULT_SCHEMA } from "../src/implementation-self-review.ts";
import { IMPLEMENTATION_PROMPT_PREFIX } from "../src/prompts.ts";

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

// The result line of a real --json-schema dispatch
// (docs/features/structured-patch-output/plan.md): schema-mode emissions are held
// to its fields, since the text-mode recording above has no structured_output.
const SCHEMA_PROBE = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "json-schema-probe-web-calculator-phase-2.json"), "utf8")
) as { calls: { resultLineVerbatim: string }[] };
const recordedSchemaResult = JSON.parse(SCHEMA_PROBE.calls[0]!.resultLineVerbatim) as StreamLine & {
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
  /** Arguments after the script path, as the harness appends them. */
  args?: string[];
  /** True when the dispatch sent --json-schema: held to the schema probe's result line. */
  structured?: boolean;
  /** Fields the result line carries beyond the recorded ones, by design. */
  extraResultFields?: string[];
}

const BASE_COMMIT = "a".repeat(40);
const PHASE_PROMPT = `This is phase 1 of 1.\nbaseCommit must be exactly: ${BASE_COMMIT}\n\nPatch only these paths:\n\nsrc/a.ts\n\n`;
const SELF_REVIEW_PROMPT = `This is your own self-review of the complete change, after the last phase.\nbaseCommit must be exactly: ${BASE_COMMIT}\n\nPatch only these paths:\n\nbase.txt\n\n`;
const REMEDIATION_PROMPT = `you are the code-review remediator implementer\n\nbaseCommit must be exactly ${BASE_COMMIT}.\n\nApproved scope:\n\n- base.txt\n\nFindings to remediate:\n\n`;
const EMISSIONS: Emission[] = [
  { name: "emit-spec-stage (unrecognized prompt)", script: "emit-spec-stage.mjs", prompt: "hello" },
  { name: "emit-plan-stage (unrecognized prompt)", script: "emit-plan-stage.mjs", prompt: "hello" },
  {
    name: "emit-implementation-stage (phase, structured)",
    script: "emit-implementation-stage.mjs",
    prompt: PHASE_PROMPT,
    args: ["--json-schema", JSON.stringify(PATCH_RESULT_SCHEMA)],
    structured: true,
  },
  {
    name: "emit-implementation-stage (self-review, structured)",
    script: "emit-implementation-stage.mjs",
    prompt: SELF_REVIEW_PROMPT,
    args: ["--json-schema", JSON.stringify(SELF_REVIEW_RESULT_SCHEMA)],
    structured: true,
  },
  {
    name: "emit-implementation-stage (self-review reply that is not JSON)",
    script: "emit-implementation-stage.mjs",
    prompt: SELF_REVIEW_PROMPT,
    args: ["--json-schema", JSON.stringify(SELF_REVIEW_RESULT_SCHEMA)],
    env: { EMIT_MODE: "self-review-not-json" },
  },
  {
    name: "emit-code-review (remediation, structured)",
    script: "emit-code-review.mjs",
    prompt: REMEDIATION_PROMPT,
    args: ["--json-schema", JSON.stringify(PATCH_RESULT_SCHEMA)],
    structured: true,
  },
  {
    name: "emit-cli-run (implementation route, structured)",
    script: "emit-cli-run.mjs",
    prompt: `${IMPLEMENTATION_PROMPT_PREFIX} implementer\n\n${PHASE_PROMPT}`,
    args: ["--model", "m", "--effort", "medium", "--json-schema", JSON.stringify(PATCH_RESULT_SCHEMA)],
    structured: true,
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
    const child = spawnSync(process.execPath, [join(FIXTURES, emission.script), ...(emission.args ?? [])], {
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
    const held = emission.structured ? recordedSchemaResult : recordedResult;
    subset(Object.keys(result), [...Object.keys(held), ...(emission.extraResultFields ?? [])], "the result line");
    if (result.usage !== undefined) subset(Object.keys(result.usage), Object.keys(held.usage), "usage");
    for (const entry of Object.values(result.modelUsage ?? {})) {
      const recordedEntry = Object.values(held.modelUsage)[0]!;
      subset(Object.keys(entry), Object.keys(recordedEntry), "a modelUsage entry");
    }
    if (emission.structured) {
      // The answer travels as structured_output, which is what the parser reads in this mode.
      assert.equal(typeof result.structured_output, "object");
      assert.equal(parseEnvelope(CLAUDE_CODE, stdout, true).resultText, JSON.stringify(result.structured_output));
      const toolCalls = emitted
        .flatMap((line) => (line.message as { content?: { type: string; name?: string }[] } | undefined)?.content ?? [])
        .filter((block) => block.type === "tool_use")
        .map((block) => block.name);
      assert.deepEqual(toolCalls, ["StructuredOutput"]);
    } else {
      assert.ok(!("structured_output" in result), "a text reply carries no structured_output");
    }
    const envelope = parseEnvelope(CLAUDE_CODE, stdout);
    assert.equal(envelope.resultText, (result.result as string | undefined) ?? "");
    if (result.modelUsage !== undefined) assert.equal(envelope.effectiveModel, "fixture-model");
  });
}

test("each emitter refuses a dispatch that sends --json-schema where the stage must not, or omits it where it must", () => {
  // The guard the stage wiring is proved against: a stage that stops sending the
  // schema, sends the wrong one, or sends one to a free-text dispatch fails loudly.
  const patch = JSON.stringify(PATCH_RESULT_SCHEMA);
  const selfReview = JSON.stringify(SELF_REVIEW_RESULT_SCHEMA);
  const reviewerPrompt = "you are the code reviewer code-reviewer-correctness with specialty x\n\nChanged paths:\n\nsrc/a.ts\n\n";
  const cases: Array<[string, string, string[], RegExp]> = [
    ["emit-implementation-stage.mjs", PHASE_PROMPT, [], /a phase prompt arrived without --json-schema/],
    ["emit-implementation-stage.mjs", PHASE_PROMPT, ["--json-schema", selfReview], /a phase prompt arrived with the wrong --json-schema/],
    ["emit-implementation-stage.mjs", SELF_REVIEW_PROMPT, [], /a self-review prompt arrived without --json-schema/],
    ["emit-implementation-stage.mjs", SELF_REVIEW_PROMPT, ["--json-schema", patch], /a self-review prompt arrived with the wrong --json-schema/],
    ["emit-code-review.mjs", REMEDIATION_PROMPT, [], /a remediation prompt arrived without --json-schema/],
    ["emit-code-review.mjs", REMEDIATION_PROMPT, ["--json-schema", selfReview], /a remediation prompt arrived with the wrong --json-schema/],
    ["emit-code-review.mjs", reviewerPrompt, ["--json-schema", patch], /a reviewer prompt arrived with --json-schema/],
    ["emit-cli-run.mjs", `${IMPLEMENTATION_PROMPT_PREFIX} implementer\n\n${PHASE_PROMPT}`, [], /a IMPLEMENTATION_PROMPT_PREFIX prompt arrived without --json-schema/],
    ["emit-cli-run.mjs", reviewerPrompt, ["--json-schema", patch], /a CODE_REVIEW_PROMPT_PREFIX prompt arrived with --json-schema/],
  ];
  const cwd = mkdtempSync(join(tmpdir(), "bw-stream-fixture-"));
  try {
    writeFileSync(join(cwd, "base.txt"), "base marker\n");
    for (const [script, prompt, args, refusal] of cases) {
      const child = spawnSync(process.execPath, [join(FIXTURES, script), ...args], {
        cwd, input: prompt, encoding: "utf8", shell: false, env: { ...process.env, EMIT_MODE: "ok" },
      });
      assert.notEqual(child.status, 0, `${script} accepted: ${refusal}`);
      assert.equal(child.stdout, "", `${script} emitted a reply before refusing`);
      assert.match(child.stderr, refusal);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the recorded stream's own line kinds all satisfy the shape check the emitters are held to", () => {
  // A guard on the guard: the recording parses, ends in one result line, and
  // carries every kind the emitters are allowed to use.
  assert.equal(parseEnvelope(CLAUDE_CODE, RECORDING.stream).effectiveModel, "claude-sonnet-5");
  for (const wanted of ["system:init:", "stream_event:content_block_delta:text_delta", "assistant::", "result:success:"]) {
    assert.ok(recordedKinds.has(wanted), `the recording lacks ${wanted}`);
  }
});
