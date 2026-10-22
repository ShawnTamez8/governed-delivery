import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACCEPTANCE_TEST_AUTHOR_PROMPT_PREFIX,
  CODE_REVIEW_PROMPT_PREFIX,
  CODE_REVIEW_RECONCILER_PROMPT_PREFIX,
  CODE_REVIEW_REMEDIATION_PROMPT_PREFIX,
  DESIGN_SPLIT_PROMPT_PREFIX,
  IMPLEMENTATION_PROMPT_PREFIX,
  PLAN_AUTHOR_PROMPT_PREFIX,
  PLAN_REVIEW_PROMPT_PREFIX,
  SPEC_AUTHOR_PROMPT_PREFIX,
  SPEC_REVIEW_PROMPT_PREFIX,
} from "../../../src/prompts.ts";

export const PROMPT_ROUTES = [
  { name: "SPEC_AUTHOR_PROMPT_PREFIX", prefix: SPEC_AUTHOR_PROMPT_PREFIX, emitter: "emit-spec-stage.mjs" },
  { name: "SPEC_REVIEW_PROMPT_PREFIX", prefix: SPEC_REVIEW_PROMPT_PREFIX, emitter: "emit-spec-stage.mjs" },
  { name: "PLAN_AUTHOR_PROMPT_PREFIX", prefix: PLAN_AUTHOR_PROMPT_PREFIX, emitter: "emit-plan-stage.mjs" },
  { name: "PLAN_REVIEW_PROMPT_PREFIX", prefix: PLAN_REVIEW_PROMPT_PREFIX, emitter: "emit-plan-stage.mjs" },
  { name: "IMPLEMENTATION_PROMPT_PREFIX", prefix: IMPLEMENTATION_PROMPT_PREFIX, emitter: "emit-implementation-stage.mjs" },
  { name: "CODE_REVIEW_PROMPT_PREFIX", prefix: CODE_REVIEW_PROMPT_PREFIX, emitter: "emit-code-review.mjs" },
  { name: "CODE_REVIEW_REMEDIATION_PROMPT_PREFIX", prefix: CODE_REVIEW_REMEDIATION_PROMPT_PREFIX, emitter: "emit-code-review.mjs" },
  { name: "CODE_REVIEW_RECONCILER_PROMPT_PREFIX", prefix: CODE_REVIEW_RECONCILER_PROMPT_PREFIX, emitter: "emit-code-review.mjs" },
  { name: "DESIGN_SPLIT_PROMPT_PREFIX", prefix: DESIGN_SPLIT_PROMPT_PREFIX, emitter: "emit-spec-stage.mjs" },
  { name: "ACCEPTANCE_TEST_AUTHOR_PROMPT_PREFIX", prefix: ACCEPTANCE_TEST_AUTHOR_PROMPT_PREFIX, emitter: "emit-implementation-stage.mjs" },
];

export function selectPromptRoute(prompt) {
  const matches = PROMPT_ROUTES.filter(({ prefix }) => prompt.startsWith(prefix));
  if (matches.length !== 1) {
    const searched = PROMPT_ROUTES.map(({ name, prefix }) => `${name}=${JSON.stringify(prefix)}`).join(", ");
    throw new Error(`emit-cli-run: expected exactly one leading prompt marker; match count ${matches.length}; searched ${searched}`);
  }
  return matches[0];
}

// The routes whose dispatches send the tool server's --mcp-config
// (docs/features/sandboxed-implementer/plan.md), and those that send
// --json-schema (docs/features/structured-patch-output/plan.md): the same
// three, and the code reviewers (docs/features/reproduced-review-findings/plan.md).
// Every other route must arrive without either.
const TOOL_SERVER_ROUTES = new Set(["IMPLEMENTATION_PROMPT_PREFIX", "CODE_REVIEW_REMEDIATION_PROMPT_PREFIX", "ACCEPTANCE_TEST_AUTHOR_PROMPT_PREFIX"]);
const SCHEMA_ROUTES = new Set([...TOOL_SERVER_ROUTES, "CODE_REVIEW_PROMPT_PREFIX"]);

const FLAGS = [
  "--implementation-mode", "--code-review-mode", "--delay-ms",
  "--model", "--effort", "--json-schema", "--mcp-config", "--allowedTools", "--max-budget-usd",
];

function options(argv) {
  const result = { implementationMode: "ok", codeReviewMode: "ok", delayMs: 0, jsonSchema: undefined, mcpConfig: undefined };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!FLAGS.includes(name) || seen.has(name) || value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`emit-cli-run: expected unique value pairs of ${FLAGS.join(", ")}`);
    }
    seen.add(name);
    if (name === "--implementation-mode") result.implementationMode = value;
    if (name === "--code-review-mode") result.codeReviewMode = value;
    if (name === "--json-schema") result.jsonSchema = value;
    if (name === "--mcp-config") result.mcpConfig = value;
    if (name === "--delay-ms") {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error("emit-cli-run: --delay-ms must be a non-negative safe integer");
      }
      result.delayMs = Number(value);
    }
  }
  return result;
}

// Modes are fixture argv, so one executor can be frozen before spec and kept
// unchanged across external approval. EMIT_MODE is local to the selected child.
async function main() {
  const config = options(process.argv.slice(2));
  const input = readFileSync(0);
  const route = selectPromptRoute(input.toString("utf8"));
  if (SCHEMA_ROUTES.has(route.name) !== (config.jsonSchema !== undefined)) {
    throw new Error(`emit-cli-run: a ${route.name} prompt arrived ${config.jsonSchema === undefined ? "without" : "with"} --json-schema`);
  }
  if (TOOL_SERVER_ROUTES.has(route.name) !== (config.mcpConfig !== undefined)) {
    throw new Error(`emit-cli-run: a ${route.name} prompt arrived ${config.mcpConfig === undefined ? "without" : "with"} --mcp-config`);
  }
  if (config.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, config.delayMs));
  const env = { ...process.env };
  delete env.EMIT_MODE;
  if (route.emitter === "emit-implementation-stage.mjs") env.EMIT_MODE = config.implementationMode;
  if (route.emitter === "emit-code-review.mjs") env.EMIT_MODE = config.codeReviewMode;
  // The schema and the tool server reach the selected emitter as the real CLI
  // receives them, so that emitter answers through the structured channel and
  // checks both itself.
  const schemaArgs = [
    ...(config.jsonSchema === undefined ? [] : ["--json-schema", config.jsonSchema]),
    ...(config.mcpConfig === undefined ? [] : ["--mcp-config", config.mcpConfig]),
  ];
  const child = spawnSync(process.execPath, [fileURLToPath(new URL(route.emitter, import.meta.url)), ...schemaArgs], {
    input,
    env,
    shell: false,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (child.error) throw new Error(`emit-cli-run: ${route.emitter} could not start: ${child.error.message}`);
  if (child.signal) throw new Error(`emit-cli-run: ${route.emitter} terminated by ${child.signal}`);
  process.exitCode = child.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
