#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { acquireLock } from "./lock.ts";
import { requireRunInProgress, openStore, StoreStateError, type ChangeKind, type Store } from "./store.ts";
import { formatHelp, parseArguments, UsageError } from "./cli-args.ts";
import { resolveRepositoryRoot, TargetUnavailableError } from "./repo-root.ts";
import { appendAudit, verifyAuditChain } from "./audit.ts";
import { dispatchOnce } from "./dispatch.ts";
import { runSpecStage } from "./spec-stage.ts";
import { runPlanStage } from "./plan-stage.ts";
import { runImplementationStage } from "./implementation-stage.ts";
import { runVerificationStage } from "./verification-stage.ts";
import { runCodeReviewStage } from "./code-review-stage.ts";
import { runDeliveryStage } from "./delivery-stage.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { approvalPayload, validateExpiry } from "./approval.ts";
import { approveRun, buildBinding } from "./approval-stage.ts";
import { APPROVAL_DEFAULT_LIFETIME_SECONDS, APPROVAL_MAX_LIFETIME_SECONDS } from "./policy.ts";
import { inspectReadiness } from "./readiness.ts";
import { ACTION_REASON_ORDER, readRunSnapshot, RunMissingError, type ActionReason } from "./operator-state.ts";
import { canonicalJson } from "./canonical.ts";
import { advanceRun } from "./run-command.ts";
import { CLAUDE_CODE } from "./executor.ts";
import { readRunsResult, readStatusResult } from "./operator-read.ts";
import { loadDashboardRepositories } from "./dashboard-config.ts";
import { startDashboardServer, waitForDashboardShutdown } from "./dashboard-server.ts";
import {
  formatOperatorResult, operatorCommand, operatorEnvelope, operatorExit,
  type OperatorCommand, type OperatorErrorCode,
} from "./operator-output.ts";
import { createRunIntake, RunIntakeFreezeError } from "./run-intake.ts";
import { GuidedCommandError, runGuidedCommand } from "./guided-command.ts";

// A malformed global option can fail before parsing selects a command. This
// hint chooses only its error presentation; parseArguments still validates it.
function outputCommand(argv: string[]): OperatorCommand | null {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--repo=")) continue;
    if (token === "--repo") {
      if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) i++;
      continue;
    }
    if (token === "help") continue;
    return operatorCommand(token) ? token : null;
  }
  return null;
}

async function main(): Promise<void> {
  const invocationDirectory = process.cwd();
  const argv = process.argv.slice(2);
  let output = outputCommand(argv);
  let json = argv.includes("--json");
  let rootDir: string | null = null;
  let selectedRun: number | null = null;
  let release: (() => void) | null = null;
  let store: Store | null = null;
  try {
    const parsed = parseArguments(argv);
    const { command, args } = parsed;
    if (parsed.help) {
      process.stdout.write(formatHelp(command));
      return;
    }
    if (parsed.guidedTarget !== null) {
      process.exitCode = await runGuidedCommand(parsed.guidedTarget, {
        invocationDirectory,
        input: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
      });
      return;
    }
    if (command === null) throw new UsageError("missing command");
    output = operatorCommand(command) ? command : null;
    json = parsed.flags.has("json");
    selectedRun = args.has("run") ? Number(args.get("run")) : null;
    let signature = args.get("signature");
    if (args.has("signature-file")) {
      const signaturePath = resolve(invocationDirectory, args.get("signature-file")!);
      try {
        signature = readFileSync(signaturePath, "utf8").replace(/^\uFEFF/, "").trim();
      } catch (error) {
        throw new UsageError(`cannot read signature file ${signaturePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (signature === "") throw new UsageError(`signature file is empty: ${signaturePath}`);
    }
    if (command === "dashboard") {
      const repositories = loadDashboardRepositories(args.get("repositories-file")!, invocationDirectory);
      const dashboard = await startDashboardServer(repositories, invocationDirectory);
      const shutdown = waitForDashboardShutdown(dashboard);
      process.stdout.write(`${dashboard.bootstrapUrl}\n`);
      await shutdown;
      return;
    }
    if (command === "runs" || command === "status") {
      const target = parsed.repo ?? invocationDirectory;
      const result = command === "runs"
        ? readRunsResult(target, invocationDirectory, Number(args.get("limit") ?? 20))
        : readStatusResult(target, invocationDirectory, selectedRun!);
      if (result.reason !== null) console.error(result.reason);
      process.stdout.write(formatOperatorResult(result, json));
      process.exitCode = operatorExit(result);
      return;
    }
    rootDir = resolveRepositoryRoot(parsed.repo ?? invocationDirectory, invocationDirectory);
    if (command === "run") {
      const result = await advanceRun(rootDir, selectedRun!, { yes: parsed.flags.has("yes"), json });
      if (result.reason !== null) console.error(result.reason);
      process.stdout.write(formatOperatorResult(result, json));
      process.exitCode = operatorExit(result);
      return;
    }
    if (command === "doctor") {
      const readiness = inspectReadiness(rootDir, { slug: args.get("slug") });
      let frozen = null;
      const reasons: ActionReason[] = [];
      if (selectedRun !== null) {
        store = openStore(rootDir, { readOnly: true });
        const observed = readRunSnapshot(store, rootDir, selectedRun);
        const { snapshot, profile, profileReason } = observed;
        frozen = snapshot.configuration;
        readiness.limitations.push(...snapshot.limitations);
        readiness.checks.push({ name: "run_state", status: "pass",
          evidence: `run ${selectedRun}: persisted ${snapshot.run.status}; phase ${snapshot.phase}; ${snapshot.stages.length} recorded stage(s)`,
          repair: null });
        readiness.checks.push({ name: "frozen_profile", status: profile === null ? "fail" : "pass",
          evidence: profileReason ?? `Hash-verified frozen profile ${snapshot.configuration.profileHash} for run ${selectedRun}.`,
          repair: profile === null ? "Retain this run's evidence and create a fresh run; do not rebuild or silently substitute its profile." : null });
        for (const [name, value] of [
          ["frozen_models", frozen.modelMap], ["frozen_verification", frozen.verificationCommands],
          ["frozen_deadline", frozen.deadline], ["frozen_approval_signer", frozen.approvalSigner],
        ] as const) {
          readiness.checks.push({ name, status: profile === null ? "not_checked" : "pass",
            evidence: profile === null ? "A readable verified frozen profile is required; current values are not substitutes."
              : name === "frozen_approval_signer" && value === null ? "No signer was bound at intake; the existing approval gate records this partial guarantee."
                : JSON.stringify(value), repair: null });
        }
        const sameExecutor = profile !== null && canonicalJson(profile.executor) === canonicalJson(CLAUDE_CODE);
        const currentProbe = readiness.checks.find((check) => check.name === "executor_probe")!;
        const probeReason = "The frozen executor differs from the fixed native executor doctor probed; its arbitrary retained probe was not executed.";
        readiness.checks.push({ name: "frozen_executor_probe",
          status: profile === null || !sameExecutor ? "not_checked" : currentProbe.status,
          evidence: profile === null ? "No verified frozen executor is available."
            : sameExecutor ? currentProbe.evidence : probeReason,
          repair: profile !== null && sameExecutor ? currentProbe.repair : null });
        if (profile !== null && !sameExecutor) readiness.limitations.push(probeReason);
        reasons.push(...snapshot.workflowAction.reasons);
        for (const reason of reasons) readiness.checks.push({ name: `boundary_${reason.code}`, status: "fail",
          evidence: reason.reason, repair: `Inspect status --repo "${rootDir}" --run ${selectedRun}; do not replay or repair the recorded chain.` });
        // Current intake/configuration remain visible, but they cannot replace
        // frozen facts or require a continuing run's generated documents clean.
        const requiredCurrent = new Set(["node", "git"]);
        if (snapshot.workflowAction.group === "approval") requiredCurrent.add("approval_key");
        if (sameExecutor && snapshot.workflowAction.group !== null && snapshot.workflowAction.group !== "approval") {
          requiredCurrent.add("executor_probe");
        }
        for (const check of readiness.checks.filter((check) => requiredCurrent.has(check.name) && check.status === "fail")) {
          reasons.push({ code: "setup_required", reason: `${check.name}: ${check.evidence}` });
        }
        const submit = snapshot.operatorActions.find((action) => action.kind === "approval_submit");
        if (submit?.reason) reasons.push({ code: "setup_required", reason: submit.reason });
      } else {
        for (const check of readiness.checks.filter((check) => check.status === "fail")) {
          reasons.push({ code: "setup_required", reason: `${check.name}: ${check.evidence}` });
        }
      }
      reasons.sort((a, b) => ACTION_REASON_ORDER.indexOf(a.code) - ACTION_REASON_ORDER.indexOf(b.code));
      const result = operatorEnvelope(command, rootDir, selectedRun, reasons.length === 0 ? "ready" : "not_ready",
        { ...readiness, frozen }, reasons[0]?.code ?? null, reasons.length === 0 ? null : reasons.map((r) => r.reason).join("; "));
      process.stdout.write(formatOperatorResult(result, json));
      process.exitCode = operatorExit(result);
      return;
    }
    release = acquireLock(rootDir);
    store = openStore(rootDir);
    switch (command) {
      case "migrate": {
        console.log("migrations applied");
        break;
      }
      case "new-run": {
        try {
          const created = createRunIntake(store, rootDir, {
            project: args.get("project")!,
            featureId: args.get("feature")!,
            slug: args.get("slug")!,
            changeKind: args.get("change-kind")! as ChangeKind,
            model: args.get("model")!,
          });
          console.log(String(created.run.id));
        } catch (error) {
          if (error instanceof RunIntakeFreezeError) {
            console.error(`run ${error.runId} created but blocked: profile freeze failed`);
          }
          throw error;
        }
        break;
      }
      case "stage-add": {
        // Validate every argument before the store is consulted, so a bad
        // flag is a usage error regardless of run state — the dispatch case
        // holds the same ordering for the same reason.
        const stageRunId = Number(args.get("run"));
        const stageKind = args.get("kind")!;
        const stageInput = args.has("input") ? Number(args.get("input")) : null;
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
        const gateResult = args.get("gate-result")!;
        const stage = store.completeStage(Number(args.get("id")), args.get("output")!, gateResult);
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
        const agent = args.get("agent")!;
        const role = args.get("role")!;
        const requestedModel = args.get("model");
        const promptFile = args.get("prompt-file")!;
        const stageId = Number(args.get("stage"));
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
        const dispatchProfile = loadVerifiedProfile(rootDir, dispatchRun);
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
        // The raw surface gets the same frozen-binding rule the stages get:
        // a capability the stages refuse must not be spendable through the
        // documented escape hatch, and the dispatched agent must be one the
        // run froze.
        const dispatchBinding = requireFrozenBinding(
          dispatchProfile.profile,
          dispatchProfile.profile.executor,
          stage.kind
        );
        if (!dispatchBinding.ok) {
          throw new Error(dispatchBinding.reason);
        }
        if (!dispatchProfile.profile.agents.some((a) => a.id === agent)) {
          throw new Error(`configured agent ${agent} is not in the frozen profile`);
        }
        let prompt: string;
        try {
          prompt = readFileSync(resolve(invocationDirectory, promptFile), "utf8");
        } catch (err) {
          throw new UsageError(`cannot read prompt file ${promptFile}: ${(err as Error).message}`);
        }
        const result = await dispatchOnce(
          store,
          dispatchProfile.profile.executor,
          { stageId, agent, role, requestedModel: frozenModel.model, prompt },
          rootDir
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
        // Hard rule 6: the stage runs against the executor the run froze.
        // The profile is loaded here so the frozen definition is handed in;
        // the stage re-verifies the same binding at its own boundary.
        const specRunId = Number(args.get("run"));
        const specRun = store.getRun(specRunId);
        if (!specRun) {
          throw new Error(`run ${specRunId} does not exist`);
        }
        const specVerified = loadVerifiedProfile(rootDir, specRun);
        if (!specVerified.ok) {
          throw new Error(specVerified.reason);
        }
        const result = await runSpecStage(store, specVerified.profile.executor, {
          runId: specRun.id,
          requestedModel: args.get("model"),
          rootDir,
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
        // Hard rule 6: the stage runs against the executor the run froze.
        const planRunId = Number(args.get("run"));
        const planRun = store.getRun(planRunId);
        if (!planRun) {
          throw new Error(`run ${planRunId} does not exist`);
        }
        const planVerified = loadVerifiedProfile(rootDir, planRun);
        if (!planVerified.ok) {
          throw new Error(planVerified.reason);
        }
        const result = await runPlanStage(store, planVerified.profile.executor, {
          runId: planRun.id,
          requestedModel: args.get("model"),
          rootDir,
        });
        if (result.ok) {
          console.log(result.planPath);
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "implement": {
        // Hard rule 6: the stage runs against the executor the run froze.
        const implementRunId = Number(args.get("run"));
        const implementRun = store.getRun(implementRunId);
        if (!implementRun) {
          throw new Error(`run ${implementRunId} does not exist`);
        }
        const implementVerified = loadVerifiedProfile(rootDir, implementRun);
        if (!implementVerified.ok) {
          throw new Error(implementVerified.reason);
        }
        const result = await runImplementationStage(store, implementVerified.profile.executor, {
          runId: implementRun.id,
          requestedModel: args.get("model"),
          rootDir,
        });
        if (result.ok) {
          console.log(result.worktreePath);
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "verify": {
        // No --model: this stage dispatches nothing, so there is no model to
        // request and accepting one would suggest otherwise. Per-command
        // progress comes from the stage, so nothing is printed here but the
        // result path.
        const result = await runVerificationStage(store, {
          runId: Number(args.get("run")),
          rootDir,
        });
        if (result.ok) {
          console.log(result.resultRef);
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "review": {
        // Hard rule 6: the stage runs against the executor the run froze.
        // Unlike verify and deliver this stage dispatches, so it accepts
        // --model; one invocation owns every frozen panel, remediation, and
        // post-patch verification in the bounded loop.
        const reviewRunId = Number(args.get("run"));
        const reviewRun = store.getRun(reviewRunId);
        if (!reviewRun) {
          throw new Error(`run ${reviewRunId} does not exist`);
        }
        const reviewVerified = loadVerifiedProfile(rootDir, reviewRun);
        if (!reviewVerified.ok) {
          throw new Error(reviewVerified.reason);
        }
        const result = await runCodeReviewStage(store, reviewVerified.profile.executor, {
          runId: reviewRun.id,
          requestedModel: args.get("model"),
          rootDir,
        });
        if (result.ok) {
          console.log(result.resultRef);
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "deliver": {
        // The delivery check (step 8) dispatches nothing and resolves no
        // model, exactly like verify. Success prints only the delivery result
        // reference; a refusal — including a delivery that blocks the run on
        // missing artifacts — prints the named reason and exits 1.
        const result = runDeliveryStage(store, {
          runId: Number(args.get("run")),
          rootDir,
        });
        if (result.ok) {
          console.log(result.resultRef);
        } else {
          console.error(result.reason);
          process.exitCode = 1;
        }
        break;
      }
      case "approval-request": {
        const runId = Number(args.get("run"));
        // The default window comes from policy, not a literal here, so the
        // frozen profile records the value a run actually used and one
        // constant governs it. Comfortably inside the policy ceiling, so the
        // command's own default can never trip its own check. `--expires`
        // present but empty is a usage error, not a silent default: the
        // parser refuses it before state is opened.
        const given = args.get("expires");
        const expires =
          given ?? new Date(Date.now() + APPROVAL_DEFAULT_LIFETIME_SECONDS * 1000).toISOString();
        const expiry = validateExpiry(expires, Date.now(), APPROVAL_MAX_LIFETIME_SECONDS);
        if (!expiry.ok) {
          console.error(expiry.reason);
          process.exitCode = 1;
          break;
        }
        const bound = buildBinding(store, rootDir, runId, expires);
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
        const payload = approvalPayload(bound.binding);
        const out = args.get("out");
        if (out !== undefined) {
          const destination = resolve(invocationDirectory, out);
          try {
            writeFileSync(destination, payload, { encoding: "utf8", flag: "wx" });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
              throw new Error(`refusing to overwrite an existing approval payload file: ${destination}`, { cause: error });
            }
            throw new Error(`cannot create approval payload file ${destination}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
          }
          console.error(`approval payload: ${destination}`);
        } else {
          process.stdout.write(payload);
        }
        break;
      }
      case "approve": {
        const result = approveRun(store, rootDir, {
          runId: Number(args.get("run")),
          expiresAt: args.get("expires")!,
          signature: signature!,
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
      case "proposal-export": {
        // A run never writes here (architecture section 14): this command is
        // the human's own action, materializing state the run only stored.
        const proposalId = Number(args.get("proposal"));
        const proposal = store.getProposal(proposalId);
        if (!proposal) {
          throw new Error(`proposal ${proposalId} does not exist`);
        }
        const explicitName = args.get("name");
        const defaultName = proposal.title
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const name = explicitName ?? defaultName;
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
          throw new UsageError(
            explicitName !== undefined
              ? `invalid --name ${name}: must be lowercase kebab-case`
              : `the proposal's title does not derive a usable file name; pass --name explicitly`
          );
        }
        const targetDir = join(rootDir, "docs", "proposals");
        const targetPath = join(targetDir, `${name}.md`);
        const sources = store.getProposalSources(proposal.id);
        const body = `# ${proposal.title}

**Route:** ${proposal.route}
**Raised in:** run ${proposal.run_id}, stage ${proposal.stage_id}
**Source finding id(s):** ${sources.join(", ")}
**Evidence:** ${proposal.evidence_ref}

## Problem

${proposal.problem}

## Why this is upstream

${proposal.why_upstream}
`;
        mkdirSync(targetDir, { recursive: true });
        // One filesystem decision, not two. An `existsSync` preflight followed
        // by a default (truncating) write leaves a window in which another
        // process, an editor, or a link creation places the target and this
        // command destroys it — and the refusal it promises the operator is
        // absolute. `wx` makes the refusal the write's own outcome, so there
        // is no window to lose.
        try {
          writeFileSync(targetPath, body, { flag: "wx" });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") {
            console.error(`refusing to overwrite an existing proposal file: docs/proposals/${name}.md`);
            process.exitCode = 1;
            break;
          }
          throw err;
        }
        appendAudit(store, {
          runId: proposal.run_id,
          stageId: proposal.stage_id,
          actor: "operator",
          actorType: "human",
          action: "proposal.export",
          summary: `exported proposal ${proposal.id} to docs/proposals/${name}.md`,
        });
        console.log(`docs/proposals/${name}.md`);
        break;
      }
    }
  } catch (err) {
    if (err instanceof GuidedCommandError) {
      console.error(err.message);
      process.exitCode = err.exitCode;
      return;
    }
    if (output !== null) {
      const code: OperatorErrorCode = err instanceof UsageError ? "usage"
        : err instanceof TargetUnavailableError ? "target_unavailable"
        : err instanceof StoreStateError || err instanceof RunMissingError ? err.code
        : output === "doctor" ? "setup_required" : "state_unavailable";
      const outcome = output === "run" ? "refused"
        : code === "state_missing" && (output === "runs" || output === "status") ? "state_missing"
        : code === "run_missing" && output === "status" ? "run_missing" : "error";
      const result = operatorEnvelope(output, rootDir, selectedRun, outcome, null, code,
        err instanceof Error ? err.message : String(err));
      console.error(result.reason);
      process.stdout.write(formatOperatorResult(result, json));
      process.exitCode = operatorExit(result);
      return;
    }
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof UsageError) console.error(formatHelp());
    process.exitCode = err instanceof UsageError ? 2 : 1;
  } finally {
    store?.close();
    release?.();
  }
}

await main();
