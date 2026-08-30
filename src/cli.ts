#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { acquireLock } from "./lock.ts";
import { requireRunInProgress, CHANGE_KINDS, GATE_RESULTS, ROLES, openStore, type Store } from "./store.ts";
import { appendAudit, verifyAuditChain } from "./audit.ts";
import { CLAUDE_CODE } from "./executor.ts";
import { dispatchOnce } from "./dispatch.ts";
import { runSpecStage } from "./spec-stage.ts";
import { runPlanStage } from "./plan-stage.ts";
import { freezeProfile, loadVerifiedProfile, resolveStageModel, resolveStartingCommit, validateModelName } from "./profile.ts";
import { approvalPayload, validateExpiry } from "./approval.ts";
import { approveRun, buildBinding } from "./approval-stage.ts";
import { APPROVAL_DEFAULT_LIFETIME_SECONDS, APPROVAL_MAX_LIFETIME_SECONDS } from "./policy.ts";

const USAGE = `usage: bw <command>
commands:
  migrate                                apply pending migrations
  new-run --project <p> --feature <f> --slug <s> --change-kind <k> --model <name>
  stage-add --run <id> --kind <k> [--input <stage-id>]
  stage-complete --id <id> --output <ref> --gate-result pass|block
  dispatch --stage <id> --agent <id> --role author|reviewer --prompt-file <path>
           [--model <name>]
  spec --run <id> [--model <name>]       run the spec and spec_review stages
  plan --run <id> [--model <name>]       run the plan and plan_review stages
  approval-request --run <id> [--expires <iso>]
                                         print the payload for the operator to sign
  approve --run <id> --expires <iso> --signature <base64>
                                         verify and record the authorization
  verify-audit                           recompute the audit chain`;

class UsageError extends Error {}

function parse(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        args.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          // The value is missing; record it as empty so required() reports
          // the named option instead of silently consuming the next flag.
          args.set(arg.slice(2), "");
        } else {
          args.set(arg.slice(2), next);
          i++;
        }
      }
    }
  }
  return args;
}

/**
 * An optional flag's value, refusing the flag supplied with no value.
 *
 * `parse()` records a valueless flag as "" precisely so it can be reported by
 * name. Reading such a flag with `args.get` alone turns `--model` at the end
 * of a command line into the empty-string model, which then fails somewhere
 * downstream as a mismatch against the frozen value rather than as the typo
 * it is.
 */
function optional(args: Map<string, string>, name: string): string | undefined {
  const value = args.get(name);
  if (value === undefined) return undefined;
  if (value === "") {
    throw new UsageError(`option --${name} was given without a value`);
  }
  return value;
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (value === undefined || value === "") {
    throw new UsageError(`missing required option --${name}`);
  }
  return value;
}

function numeric(args: Map<string, string>, name: string): number {
  const value = required(args, name);
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`--${name} must be a non-negative integer, got ${value}`);
  }
  return Number(value);
}

function numericOptional(args: Map<string, string>, name: string): number | null {
  const value = args.get(name);
  if (value === undefined) return null;
  // The same convention `optional()` holds: a flag supplied with no value is
  // the typo `parse()` records "" for, not a silent null — silently chaining
  // a stage from nothing is exactly the state corruption the strict paths
  // exist to refuse.
  if (value === "") {
    throw new UsageError(`option --${name} was given without a value`);
  }
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`--${name} must be a non-negative integer, got ${value}`);
  }
  return Number(value);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "";
  const known = [
    "migrate",
    "new-run",
    "stage-add",
    "stage-complete",
    "dispatch",
    "spec",
    "plan",
    "approval-request",
    "approve",
    "verify-audit",
  ];
  if (!known.includes(command)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const args = parse(argv.slice(1));
  let release: (() => void) | null = null;
  let store: Store | null = null;
  try {
    release = acquireLock();
    store = openStore();
    switch (command) {
      case "migrate": {
        console.log("migrations applied");
        break;
      }
      case "new-run": {
        const changeKind = required(args, "change-kind");
        if (!CHANGE_KINDS.includes(changeKind)) {
          throw new UsageError(
            `invalid change_kind ${changeKind}: allowed values are ${CHANGE_KINDS.join(", ")}`
          );
        }
        // Read before the insert: a missing --model must be a usage error, not
        // a run row created and then blocked by a freeze that cannot resolve.
        const model = required(args, "model");
        // A model name the spawn cannot carry must also be a usage error, for
        // the same reason — refuse before the run row exists rather than
        // block a created run on a typo.
        const modelError = validateModelName(model);
        if (modelError !== null) {
          throw new UsageError(modelError);
        }
        const run = store.insertRun(
          required(args, "project"),
          required(args, "feature"),
          required(args, "slug"),
          changeKind
        );
        appendAudit(store, {
          runId: run.id,
          stageId: null,
          actor: "system",
          actorType: "cli",
          action: "run.create",
          summary: `created run ${run.id} for ${run.slug}`,
        });
        // Hard rule 6: config is frozen at run start. A run with no profile
        // can never be approved, so a freeze failure blocks it here rather
        // than surfacing three stages later at the gate.
        try {
          const frozen = freezeProfile(process.cwd(), run.id, resolveStartingCommit(process.cwd()), model);
          store.setProfileRef(run.id, frozen.hash);
          appendAudit(store, {
            runId: run.id,
            stageId: null,
            actor: "system",
            actorType: "cli",
            action: "profile.freeze",
            summary: `froze profile ${frozen.hash} for run ${run.id}`,
          });
        } catch (err) {
          appendAudit(store, {
            runId: run.id,
            stageId: null,
            actor: "system",
            actorType: "cli",
            action: "profile.freeze.failed",
            summary: (err as Error).message,
          });
          store.setRunStatus(run.id, "blocked");
          // The rethrow below exits non-zero and prints the filesystem error,
          // which never names the run. Without this line a caller scripting
          // `bw new-run` gets no id at all — the run exists and is blocked,
          // and nothing in the command's output says which one.
          console.error(`run ${run.id} created but blocked: profile freeze failed`);
          throw err;
        }
        console.log(String(run.id));
        break;
      }
      case "stage-add": {
        // Validate every argument before the store is consulted, so a bad
        // flag is a usage error regardless of run state — the dispatch case
        // holds the same ordering for the same reason.
        const stageRunId = numeric(args, "run");
        const stageKind = required(args, "kind");
        const stageInput = numericOptional(args, "input");
        // The same guard `runSpecStage` and the approval gate carry: a run
        // that can never finish must not accumulate state. Refused before
        // the insert, so no stage row exists afterwards.
        const stageRun = store.getRun(stageRunId);
        if (!stageRun) {
          throw new Error(`run ${stageRunId} does not exist`);
        }
        const stageBlocked = requireRunInProgress(stageRun);
        if (stageBlocked !== null) {
          throw new Error(stageBlocked);
        }
        const stage = store.insertStage(stageRunId, stageKind, stageInput);
        appendAudit(store, {
          runId: stage.run_id,
          stageId: stage.id,
          actor: "system",
          actorType: "cli",
          action: "stage.add",
          summary: `added stage ${stage.id} (${stage.kind})`,
        });
        console.log(String(stage.id));
        break;
      }
      case "stage-complete": {
        const gateResult = required(args, "gate-result");
        if (!GATE_RESULTS.includes(gateResult)) {
          throw new UsageError(
            `invalid gate_result ${gateResult}: allowed values are ${GATE_RESULTS.join(", ")}`
          );
        }
        const stage = store.completeStage(numeric(args, "id"), required(args, "output"), gateResult);
        appendAudit(store, {
          runId: stage.run_id,
          stageId: stage.id,
          actor: "system",
          actorType: "cli",
          action: "stage.complete",
          summary: `completed stage ${stage.id} with gate_result ${gateResult}`,
        });
        console.log(String(stage.id));
        break;
      }
      case "dispatch": {
        // Validate every argument before anything spawns: a bad flag must
        // never spend API cost.
        const agent = required(args, "agent");
        const role = required(args, "role");
        if (!ROLES.includes(role)) {
          throw new UsageError(`invalid role ${role}: allowed values are ${ROLES.join(", ")}`);
        }
        const requestedModel = optional(args, "model");
        const promptFile = required(args, "prompt-file");
        const stageId = numeric(args, "stage");
        // The stage check precedes the prompt-file read so a bad stage fails
        // before touching the filesystem or anything that could spawn.
        const stage = store.getStage(stageId);
        if (!stage) {
          throw new Error(`stage ${stageId} does not exist`);
        }
        // Before the profile read and well before any spawn: dispatching
        // against a blocked run is real spend recorded in `agent_run` for a
        // run no stage could ever consume.
        const dispatchRun = store.getRun(stage.run_id);
        if (!dispatchRun) {
          throw new Error(`run ${stage.run_id} does not exist`);
        }
        const dispatchBlocked = requireRunInProgress(dispatchRun);
        if (dispatchBlocked !== null) {
          throw new Error(dispatchBlocked);
        }
        // Hard rule 6 has to hold on the raw dispatch surface too, or the
        // frozen map governs `bw spec` and `bw plan` while the documented
        // escape hatch beside them spends against any model it is handed.
        const dispatchProfile = loadVerifiedProfile(process.cwd(), dispatchRun);
        if (!dispatchProfile.ok) {
          throw new Error(dispatchProfile.reason);
        }
        const frozenModel = resolveStageModel(dispatchProfile.profile, stage.kind);
        if (!frozenModel.ok) {
          throw new Error(frozenModel.reason);
        }
        if (requestedModel !== undefined && requestedModel !== frozenModel.model) {
          throw new Error(
            `--model ${requestedModel} does not match the model frozen at run start (${frozenModel.model}): config is frozen at run start`
          );
        }
        let prompt: string;
        try {
          prompt = readFileSync(promptFile, "utf8");
        } catch (err) {
          throw new UsageError(`cannot read prompt file ${promptFile}: ${(err as Error).message}`);
        }
        const result = await dispatchOnce(
          store,
          CLAUDE_CODE,
          { stageId, agent, role, requestedModel: frozenModel.model, prompt },
          process.cwd()
        );
        if (result.ok) {
          console.log(String(result.agentRunId));
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "spec": {
        const result = await runSpecStage(store, CLAUDE_CODE, {
          runId: numeric(args, "run"),
          requestedModel: optional(args, "model"),
          rootDir: process.cwd(),
        });
        if (result.ok) {
          console.log(result.specPath);
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "plan": {
        const result = await runPlanStage(store, CLAUDE_CODE, {
          runId: numeric(args, "run"),
          requestedModel: optional(args, "model"),
          rootDir: process.cwd(),
        });
        if (result.ok) {
          console.log(result.planPath);
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "approval-request": {
        const runId = numeric(args, "run");
        // The default window comes from policy, not a literal here, so the
        // frozen profile records the value a run actually used and one
        // constant governs it. Comfortably inside the policy ceiling, so the
        // command's own default can never trip its own check. `--expires`
        // present but empty is a usage error, not a silent default: the
        // parser records "" precisely so it can be reported by name.
        const given = args.get("expires");
        if (given === "") {
          throw new UsageError("missing required option --expires");
        }
        const expires =
          given ?? new Date(Date.now() + APPROVAL_DEFAULT_LIFETIME_SECONDS * 1000).toISOString();
        const expiry = validateExpiry(expires, Date.now(), APPROVAL_MAX_LIFETIME_SECONDS);
        if (!expiry.ok) {
          console.error(expiry.reason);
          process.exitCode = 1;
          break;
        }
        const bound = buildBinding(store, process.cwd(), runId, expires);
        if (!bound.ok) {
          console.error(bound.reason);
          process.exitCode = 1;
          break;
        }
        // write, not console.log: the payload is signed byte for byte, and
        // console.log's trailing newline is not part of what `approve`
        // verifies. Redirecting stdout must capture exactly the signed bytes.
        // The expiry goes to stderr as a reminder of what `approve` needs.
        console.error(`expires: ${expires}`);
        process.stdout.write(approvalPayload(bound.binding));
        break;
      }
      case "approve": {
        const result = approveRun(store, process.cwd(), {
          runId: numeric(args, "run"),
          expiresAt: required(args, "expires"),
          signature: required(args, "signature"),
        });
        if (result.ok) {
          console.log(String(result.approvalId));
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "verify-audit": {
        const brk = verifyAuditChain(store);
        if (brk) {
          console.error(`broken at audit ${brk.id}: stored ${brk.stored} recomputed ${brk.recomputed}`);
          process.exitCode = 1;
          break;
        }
        console.log("chain valid");
        break;
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = err instanceof UsageError ? 2 : 1;
  } finally {
    store?.close();
    release?.();
  }
}

await main();
