import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { acquireLock } from "./lock.ts";
import { openStore, StoreStateError, type Store } from "./store.ts";
import {
  EXECUTION_GROUPS, readRunSnapshot, RunMissingError,
  type ExecutionGroup, type RunObservation,
} from "./operator-state.ts";
import {
  formatRunPreview, operatorEnvelope, type OperatorErrorCode, type OperatorResult,
  type RunCommandResult, type RunExecution,
} from "./operator-output.ts";
import type { Profile } from "./profile.ts";
import { runSpecStage } from "./spec-stage.ts";
import { runPlanStage } from "./plan-stage.ts";
import { runImplementationStage } from "./implementation-stage.ts";
import { runVerificationStage } from "./verification-stage.ts";
import { runCodeReviewStage } from "./code-review-stage.ts";
import { runDeliveryStage } from "./delivery-stage.ts";

export interface AdvanceRunOptions {
  yes?: boolean;
  json?: boolean;
  input?: Readable & { readonly isTTY?: boolean };
  stderr?: Writable;
}

function remainingGroups(observed: RunObservation): ExecutionGroup[] {
  const group = observed.snapshot.workflowAction.group;
  if (group === null || group === "approval") return [];
  return group === "spec" ? ["spec"] : EXECUTION_GROUPS.slice(EXECUTION_GROUPS.indexOf(group));
}

function observe(rootDir: string, runId: number): RunObservation {
  const reader = openStore(rootDir, { readOnly: true });
  try {
    return readRunSnapshot(reader, rootDir, runId);
  } finally {
    reader.close();
  }
}

async function confirm(input: Readable, stderr: Writable): Promise<boolean> {
  const reader = createInterface({ input, terminal: false });
  try {
    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (answer: boolean) => {
        if (settled) return;
        settled = true;
        resolve(answer);
      };
      const cancel = () => finish(false);
      const onError = (error: Error) => reject(error);
      reader.once("line", (line) => finish(/^(y|yes)$/i.test(line.trim())));
      reader.once("close", cancel);
      reader.once("SIGINT", cancel);
      reader.once("error", onError);
      process.once("SIGINT", cancel);
      reader.once("close", () => process.removeListener("SIGINT", cancel));
      stderr.write("Execute every group in this preview? Type yes to consent: ");
    });
  } finally {
    reader.close();
  }
}

function callGroup(store: Store, rootDir: string, runId: number, profile: Profile, group: ExecutionGroup) {
  const options = { rootDir, runId };
  switch (group) {
    case "spec": return runSpecStage(store, profile.executor, options);
    case "plan": return runPlanStage(store, profile.executor, options);
    case "implementation": return runImplementationStage(store, profile.executor, options);
    case "verification": return runVerificationStage(store, options);
    case "code_review": return runCodeReviewStage(store, profile.executor, options);
    case "delivery_check": return runDeliveryStage(store, options);
  }
}

function expectedBoundary(before: RunObservation, after: RunObservation, group: ExecutionGroup): boolean {
  const next = group === "spec" ? "approval" : EXECUTION_GROUPS[EXECUTION_GROUPS.indexOf(group) + 1] ?? null;
  const added = group === "spec" || group === "plan" ? 2 : 1;
  return after.fingerprint !== before.fingerprint &&
    after.snapshot.configuration.profileHash === before.snapshot.configuration.profileHash &&
    after.snapshot.stages.length === before.snapshot.stages.length + added &&
    after.snapshot.stages.slice(-added).every((stage) => stage.status === "passed" && stage.gateResult === "pass") &&
    after.snapshot.workflowAction.group === next &&
    (next !== null || after.snapshot.phase === "completed") &&
    !after.snapshot.workflowAction.reasons.some((reason) =>
      reason.code === "observation_changed" || reason.code === "chain_incomplete" || reason.code === "evidence_invalid");
}

export async function advanceRun(rootDir: string, runId: number, options: AdvanceRunOptions = {}): Promise<OperatorResult> {
  const stderr = options.stderr ?? process.stderr;
  const input = options.input ?? process.stdin;
  const execution: RunExecution = {
    consent: "not_needed", groupsAttempted: [], groupsCompleted: [], remainingGroups: [],
    startedAt: null, endedAt: null, elapsedMs: null,
  };
  let observed: RunObservation | null = null;
  let store: Store | null = null;
  let release: (() => void) | null = null;
  let started: number | null = null;
  let failureReason: string | null = null;
  const result = (outcome: string, code: OperatorErrorCode | null = null, reason: string | null = null): OperatorResult => {
    if (started !== null) {
      execution.endedAt = new Date().toISOString();
      execution.elapsedMs = Math.max(0, Math.round(performance.now() - started));
    }
    const data: RunCommandResult = { snapshot: observed?.snapshot ?? null, execution };
    return operatorEnvelope("run", rootDir, runId, outcome, data, code, reason);
  };
  const boundaryResult = (): OperatorResult | null => {
    if (observed === null) throw new Error("run boundary has not been observed");
    const snapshot = observed.snapshot;
    if (snapshot.phase === "completed") return result("completed");
    const action = snapshot.workflowAction;
    if (snapshot.run.status === "blocked" || !action.eligible) {
      return result(snapshot.run.status === "blocked" ? "blocked" : "refused",
        action.reasons[0]?.code ?? "chain_incomplete",
        action.reasons.map((reason) => reason.reason).join("; ") || "No proven execution boundary is available.");
    }
    if (action.group === "approval") return result("awaiting_approval");
    return null;
  };
  try {
    observed = observe(rootDir, runId);
    execution.remainingGroups = remainingGroups(observed);
    const initial = boundaryResult();
    if (initial !== null) return initial;
    if (observed.profile === null) return result("refused", "evidence_invalid", observed.profileReason);
    const preview = observed;
    stderr.write(formatRunPreview(rootDir, observed.snapshot, execution.remainingGroups, observed.profile));
    execution.consent = "required";
    if (!options.yes) {
      if (options.json || !input.isTTY) {
        return result("consent_required", "consent_required", "Execution requires --yes in JSON mode or with redirected stdin; no work was started.");
      }
      if (!await confirm(input, stderr)) {
        execution.consent = "declined";
        return result("consent_required", "consent_required", "Execution consent was declined, cancelled, or ended without an affirmative response; no work was started.");
      }
    }
    execution.consent = "granted";
    try {
      release = acquireLock(rootDir);
    } catch (error) {
      return result("refused", "writer_contention", error instanceof Error ? error.message : String(error));
    }
    // Consent is not permission to migrate. The writer keeps its existing
    // startup behavior, but only after an exact-current reader has closed.
    const schemaReader = openStore(rootDir, { readOnly: true });
    schemaReader.close();
    store = openStore(rootDir);
    observed = readRunSnapshot(store, rootDir, runId, { ownedWriter: true });
    if (observed.fingerprint !== preview.fingerprint ||
        observed.snapshot.configuration.profileHash !== preview.snapshot.configuration.profileHash ||
        observed.snapshot.workflowAction.group !== preview.snapshot.workflowAction.group) {
      return result(observed.snapshot.run.status === "blocked" ? "blocked" : "refused", "observation_changed",
        "The recorded boundary or frozen profile changed after preview; start a new invocation for a fresh consent decision.");
    }
    while (true) {
      const stopped = boundaryResult();
      if (stopped !== null) return stopped;
      const group = observed.snapshot.workflowAction.group;
      if (group === null || group === "approval" || observed.profile === null ||
          group !== execution.remainingGroups[0]) {
        return result("refused", "observation_changed", "The eligible group is outside this invocation's consented range.");
      }
      const before = observed;
      if (started === null) {
        started = performance.now();
        execution.startedAt = new Date().toISOString();
      }
      const groupStarted = performance.now();
      stderr.write(`[${new Date().toISOString()}] group ${group} start (invocation observation)\n`);
      const heartbeat = group === "delivery_check" ? null : setInterval(() => {
        stderr.write(`[${new Date().toISOString()}] group ${group} elapsed ${Math.round(performance.now() - groupStarted)} ms (observation, not live agent telemetry)\n`);
      }, 15_000);
      let passed = false;
      try {
        try {
          execution.groupsAttempted.push(group);
          const returned = await callGroup(store, rootDir, runId, observed.profile, group);
          passed = returned.ok;
          failureReason = returned.ok ? null : returned.reason;
        } catch (error) {
          failureReason = error instanceof Error ? error.message : String(error);
        } finally {
          if (heartbeat !== null) clearInterval(heartbeat);
        }
        observed = readRunSnapshot(store, rootDir, runId, { ownedWriter: true });
        if (!passed) {
          return result(observed.snapshot.run.status === "blocked" ? "blocked" : "failed",
            observed.snapshot.run.status === "blocked" ? "policy_block" : "execution_failed", failureReason);
        }
        if (!expectedBoundary(before, observed, group)) {
          return result(observed.snapshot.run.status === "blocked" ? "blocked" : "failed",
            observed.snapshot.run.status === "blocked" ? "policy_block" : "execution_failed",
            `${group} returned success without the expected proven passed boundary; no further group was called. ${observed.snapshot.workflowAction.reasons.map((reason) => reason.reason).join("; ")}`.trim());
        }
        execution.groupsCompleted.push(group);
        execution.remainingGroups.shift();
      } finally {
        stderr.write(`[${new Date().toISOString()}] group ${group} end; ${execution.groupsCompleted.includes(group) ? "passed boundary recorded" : "stopped without a confirmed passed boundary"}; elapsed ${Math.round(performance.now() - groupStarted)} ms\n`);
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const code = started !== null ? "execution_failed"
      : error instanceof StoreStateError || error instanceof RunMissingError ? error.code : "execution_failed";
    return result(code === "execution_failed" ? "failed" : "refused", code,
      failureReason === null ? reason : `${failureReason}; post-call observation failed: ${reason}`);
  } finally {
    try { store?.close(); }
    finally { release?.(); }
  }
}
