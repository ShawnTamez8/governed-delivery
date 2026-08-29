import { createHash } from "node:crypto";
import {
  invokeHarness,
  parseEnvelope,
  probeExecutor,
  PROMPT_MAX_BYTES,
  type InvocationInput,
} from "./harness.ts";
import type { ExecutorDefinition } from "./executor.ts";
import { writeRawOutput } from "./raw-output.ts";
import { appendAudit } from "./audit.ts";
import type { Store } from "./store.ts";

export interface DispatchInput {
  stageId: number;
  agent: string;
  role: string;
  requestedModel: string;
  prompt: string;
  invocation?: Partial<InvocationInput>;
}

export type DispatchResult = { ok: true; agentRunId: number } | { ok: false; reason: string };

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The dispatch sequence, in its evidence-safe order (the plan review's
 * critical fix): probe, invoke, retain raw output, audit the attempt, then
 * branch. Every failure path retains the raw bytes and writes an
 * `agent.dispatch.failed` audit event; only a parsed success inserts an
 * `agent_run` row. The result union keeps the caller from ever reaching a
 * failure state with no recorded evidence.
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
  const outcome = await invokeHarness(executor, { prompt: input.prompt, ...(input.invocation ?? {}) });
  // Hazard 2: retain before any parsing or branching.
  const rawOutputRef = writeRawOutput(rootDir, stage.run_id, outcome.raw);
  if (outcome.stderr !== "") {
    writeRawOutput(rootDir, stage.run_id, `--- stderr ---\n${outcome.stderr}`);
  }
  const failed = (summary: string): DispatchResult => {
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
      `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: result exceeded the size cap`
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
  let envelope;
  try {
    envelope = parseEnvelope(executor, outcome.raw);
  } catch (err) {
    return failed(
      `dispatched agent ${input.agent} (${input.role}) on stage ${stage.id}: envelope parse failed: ${(err as Error).message}`
    );
  }
  const row = store.insertAgentRun({
    stageId: stage.id,
    agent: input.agent,
    role: input.role,
    executor: executor.id,
    requestedModel: input.requestedModel,
    effectiveModel: envelope.effectiveModel,
    fallback: envelope.fallback,
    tokensIn: envelope.tokensIn,
    tokensOut: envelope.tokensOut,
    cacheRead: envelope.cacheRead,
    cacheWrite: envelope.cacheWrite,
    cost: envelope.cost,
    durationMs: outcome.durationMs,
    inputHash: sha256(input.prompt),
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
  return { ok: true, agentRunId: row.id };
}
