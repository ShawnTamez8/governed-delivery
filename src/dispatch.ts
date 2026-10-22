import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  invokeHarness,
  parseEnvelope,
  probeExecutor,
  PROMPT_MAX_BYTES,
  RESULT_MAX_BYTES,
  STREAM_RETAIN_MAX_BYTES,
  type InvocationInput,
} from "./harness.ts";
import type { ExecutorDefinition } from "./executor.ts";
import { captureProxyLog, dockerClientEnv, withSandbox, type FrozenSandbox, type Sandbox, type TeardownResult } from "./container.ts";
import { writePrompt, writeRawOutput } from "./raw-output.ts";
import { appendAudit } from "./audit.ts";
import { promptDir, toolLogDir, toolLogRef } from "./paths.ts";
import type { Store } from "./store.ts";

const TOOL_SERVER = join(import.meta.dirname, "tool-server.ts");

export interface DispatchInput {
  stageId: number;
  agent: string;
  role: string;
  requestedModel: string;
  /** The effort level requested for this dispatch, from the frozen setting. */
  requestedEffort: string;
  /** The dispatch setting that governs this call: an agent id, or `reconciler`. */
  setting: string;
  prompt: string;
  /**
   * Set only by the three patch dispatches: the work container BuildWorks'
   * tool server acts in, the frozen Docker command and the frozen per-command
   * ceiling (docs/features/sandboxed-implementer/plan.md). `dispatchOnce`
   * builds the server's argv itself, after it retains the prompt, so the call
   * log is named like the prompt.
   */
  toolServer?: { container: string; dockerCommand: string[]; timeoutSeconds: number };
  invocation?: Partial<Omit<InvocationInput, "toolServer">>;
}

/**
 * Where a patch dispatch's tool-server log and egress-proxy log live: under
 * `.governance/tools/<run>/`, named by the prompt's `input_hash` as the
 * retained prompt is. The stage that owns the sandbox captures the proxy log
 * here before teardown.
 */
export function toolEvidence(
  rootDir: string,
  runId: number,
  prompt: string
): { inputHash: string; logPath: string; logRef: string; proxyLogPath: string; proxyLogRef: string } {
  const inputHash = sha256(prompt);
  return {
    inputHash,
    logPath: join(toolLogDir(rootDir, runId), `${inputHash}.jsonl`),
    logRef: toolLogRef(runId, `${inputHash}.jsonl`),
    proxyLogPath: join(toolLogDir(rootDir, runId), `${inputHash}-proxy.log`),
    proxyLogRef: toolLogRef(runId, `${inputHash}-proxy.log`),
  };
}

export type DispatchResult =
  | { ok: true; agentRunId: number; envelope: ReturnType<typeof parseEnvelope> }
  | { ok: false; reason: string };

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The dispatch sequence, in its evidence-safe order (the plan review's
 * critical fix): probe, retain the prompt, invoke, retain raw output, audit
 * the attempt, then branch. Every failure path retains the raw bytes and
 * writes an `agent.dispatch.failed` audit event naming the retained prompt;
 * only a parsed success inserts an `agent_run` row, whose `input_hash` names
 * the same prompt file. The result union keeps the caller from ever reaching
 * a failure state with no recorded evidence. A prompt that cannot be retained
 * is refused before the harness starts
 * (docs/features/prompt-retention/plan.md).
 */
export async function dispatchOnce(
  store: Store,
  executor: ExecutorDefinition,
  input: DispatchInput,
  rootDir: string
): Promise<DispatchResult> {
  const stage = store.getStage(input.stageId);
  if (!stage) {
    return { ok: false, reason: `stage ${input.stageId} does not exist` };
  }
  if (Buffer.byteLength(input.prompt) > PROMPT_MAX_BYTES) {
    return { ok: false, reason: `prompt exceeds ${PROMPT_MAX_BYTES} bytes` };
  }
  try {
    probeExecutor(executor);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const inputHash = sha256(input.prompt);
  let promptRef: string;
  try {
    promptRef = writePrompt(rootDir, stage.run_id, input.prompt, inputHash);
  } catch (err) {
    return { ok: false, reason: `cannot retain the prompt before dispatch: ${(err as Error).message}` };
  }
  let toolServer: InvocationInput["toolServer"];
  let evidenceRefs = `prompt ${promptRef}`;
  if (input.toolServer !== undefined) {
    const tools = toolEvidence(rootDir, stage.run_id, input.prompt);
    try {
      mkdirSync(toolLogDir(rootDir, stage.run_id), { recursive: true });
    } catch (err) {
      return { ok: false, reason: `cannot create the tool-log directory before dispatch: ${(err as Error).message}` };
    }
    toolServer = {
      command: process.execPath,
      args: [
        TOOL_SERVER,
        "--container", input.toolServer.container,
        "--docker", JSON.stringify(input.toolServer.dockerCommand),
        "--docker-env", JSON.stringify(dockerClientEnv()),
        "--log", tools.logPath,
        "--timeout", String(input.toolServer.timeoutSeconds),
      ],
      configPath: join(promptDir(rootDir, stage.run_id), `${inputHash}-mcp.json`),
    };
    evidenceRefs += `; tool log ${tools.logRef}; proxy log ${tools.proxyLogRef}`;
  }
  const outcome = await invokeHarness(executor, {
    prompt: input.prompt,
    model: input.requestedModel,
    effort: input.requestedEffort,
    ...(input.invocation ?? {}),
    ...(toolServer === undefined ? {} : { toolServer }),
  });
  // Hazard 2: retain before any parsing or branching.
  const rawOutputRef = writeRawOutput(rootDir, stage.run_id, outcome.raw);
  if (outcome.stderr !== "") {
    writeRawOutput(rootDir, stage.run_id, `--- stderr ---\n${outcome.stderr}`);
  }
  // A failed dispatch writes no `agent_run` row, so its audit summary is the
  // only per-attempt record of what was requested. It names the model, the
  // effort and the retained prompt so a failure is diagnosable without loading
  // the frozen profile. A patch dispatch's summary also names its tool-server
  // and proxy logs.
  const failed = (detail: string): DispatchResult => {
    const summary = `${detail} (requested model ${input.requestedModel}, effort ${input.requestedEffort}; ${evidenceRefs})`;
    appendAudit(store, {
      runId: stage.run_id,
      stageId: stage.id,
      actor: input.agent,
      actorType: "agent",
      action: "agent.dispatch.failed",
      summary,
    });
    return { ok: false, reason: summary };
  };
  if (outcome.spawnError) {
    return failed(
      `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: spawn failed: ${outcome.spawnError}`
    );
  }
  if (outcome.resultOverflow) {
    return failed(
      `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: output stream exceeded the ${STREAM_RETAIN_MAX_BYTES}-byte retention ceiling`
    );
  }
  if (outcome.timedOut) {
    const kill = outcome.killError ? ` (tree-kill failed: ${outcome.killError})` : "";
    return failed(
      `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: timed out after ${outcome.durationMs}ms${kill}`
    );
  }
  if (outcome.exitCode !== 0) {
    return failed(
      `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: exited with code ${outcome.exitCode}`
    );
  }
  let envelope: ReturnType<typeof parseEnvelope>;
  try {
    // A dispatch that sent --json-schema reads its answer from structured_output.
    envelope = parseEnvelope(executor, outcome.raw, input.invocation?.jsonSchema !== undefined);
  } catch (err) {
    return failed(
      `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: envelope parse failed: ${(err as Error).message}`
    );
  }
  // Section 20: the result cap applies to the result text, not the stream that
  // carried it. The raw stream is already retained above.
  if (Buffer.byteLength(envelope.resultText) > RESULT_MAX_BYTES) {
    return failed(
      `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: result exceeded the ${RESULT_MAX_BYTES}-byte size cap`
    );
  }
  const row = store.insertAgentRun({
    stageId: stage.id,
    agent: input.agent,
    role: input.role,
    executor: executor.id,
    requestedModel: input.requestedModel,
    requestedEffort: input.requestedEffort,
    setting: input.setting,
    effectiveModel: envelope.effectiveModel,
    fallback: envelope.fallback,
    tokensIn: envelope.tokensIn,
    tokensOut: envelope.tokensOut,
    cacheRead: envelope.cacheRead,
    cacheWrite: envelope.cacheWrite,
    cost: envelope.cost,
    durationMs: outcome.durationMs,
    inputHash,
    outputHash: sha256(outcome.raw),
    rawOutputRef,
    independence: "configured_standalone",
  });
  appendAudit(store, {
    runId: stage.run_id,
    stageId: stage.id,
    actor: input.agent,
    actorType: "agent",
    action: "agent.dispatch",
    summary: `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}`,
  });
  return { ok: true, agentRunId: row.id, envelope };
}

export type SandboxedDispatch =
  | { started: false; reason: string }
  | {
      started: true;
      dispatch: DispatchResult;
      sandbox: Sandbox;
      teardown: TeardownResult;
      /** Why the proxy log could not be kept, or null; it changes no outcome. */
      proxyLogFailure: string | null;
    };

/**
 * One patch dispatch in its own sandbox (docs/features/sandboxed-implementer/plan.md,
 * Task 9): start the sandbox for the worktree, dispatch with BuildWorks' tool
 * server acting in its work container under the frozen command ceiling and
 * patch-dispatch budget, keep the egress proxy's log beside the tool log, and
 * tear the sandbox down whatever happened. What the teardown means is the
 * caller's: it must block on a false `workContainerGone` before it reads the
 * worktree (`unquiescedReason`).
 */
export async function dispatchInSandbox(
  store: Store,
  executor: ExecutorDefinition,
  input: Omit<DispatchInput, "toolServer">,
  sandbox: { frozen: FrozenSandbox; runId: number; label: string; worktreePath: string; readOnlyPaths?: string[] },
  rootDir: string
): Promise<SandboxedDispatch> {
  const run = await withSandbox({ ...sandbox, rootDir }, async (started) => {
    const dispatch = await dispatchOnce(
      store,
      executor,
      {
        ...input,
        toolServer: {
          container: started.ids.work!,
          dockerCommand: sandbox.frozen.dockerCommand,
          timeoutSeconds: sandbox.frozen.commandTimeoutSeconds,
        },
        invocation: { ...input.invocation, budgetUsd: sandbox.frozen.patchDispatchBudgetUsd },
      },
      rootDir
    );
    let proxyLogFailure: string | null = null;
    try {
      captureProxyLog(started, toolEvidence(rootDir, sandbox.runId, input.prompt).proxyLogPath);
    } catch (err) {
      proxyLogFailure = `cannot keep the egress proxy log of sandbox ${started.name}: ${(err as Error).message}`;
    }
    return { dispatch, proxyLogFailure };
  });
  if (!run.started) return { started: false, reason: run.error.message };
  return { started: true, sandbox: run.sandbox, teardown: run.teardown, ...run.value };
}
