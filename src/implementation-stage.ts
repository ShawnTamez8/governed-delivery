import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type ExecutorDefinition } from "./executor.ts";
import { requireRunInProgress, type Store } from "./store.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveSettings } from "./profile.ts";
import { dispatchInSandbox, type DispatchInput, type DispatchResult } from "./dispatch.ts";
import {
  describeIncompleteReply,
  parseWorkspaceReply,
  validateWorkspaceReply,
  WORKSPACE_REPLY_SCHEMA,
} from "./agent-result.ts";
import { unquiescedReason } from "./container.ts";
import { derivedEvidenceDir, worktreePath as governanceWorktreePath } from "./paths.ts";
import { derivedPathExclusion, regenerateDerivedArtifacts } from "./derived-artifacts.ts";
import { unapprovedDependencyAdditions } from "./dependency-policy.ts";
import { validateSpecDoc } from "./spec-doc.ts";
import { buildImplementationAuthorPrompt, buildImplementationSelfReviewPrompt } from "./prompts.ts";
import {
  critiqueAuditEntries,
  SELF_REVIEW_REPLY_SCHEMA,
  validateSelfReviewReply,
} from "./implementation-self-review.ts";
import { formatImplementationGate } from "./handoff.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { SYSTEM_NAME } from "./policy.ts";
import { checkWorktreeClean, commitWorkspace, discardWorkspace } from "./workspace-commit.ts";
import { planPhases, validatePlanDoc } from "./plan-doc.ts";

export type ImplementationStageResult =
  | { ok: true; stageId: number; worktreePath: string }
  | { ok: false; reason: string };

/**
 * The implementation stage (build order step 6), one row continuing section
 * 5's chain from the passed `plan_review` row: create the run's worktree on
 * branch `gov/<slug>/<run-id>` at the approved starting commit, commit the
 * run's projections there, dispatch the implementer once per phase in its own
 * sandbox (it changes the worktree through BuildWorks' tool server in the
 * run's container), commit the diff the system computes when every changed
 * path is inside the signed scope (`commitWorkspace`), and block the run —
 * retaining the worktree — when the deterministic gate refuses
 * (docs/features/sandboxed-implementer/plan.md, Task 9).
 *
 * **On the duplication with `src/spec-stage.ts` and `src/plan-stage.ts`.**
 * The three orchestrators share a shape: preconditions each refused by name,
 * one author dispatch, a deterministic gate, terminal block or pass, and the
 * wedge guard. That is deliberate and is not an oversight to be filed in
 * review. Hard rule 4 forbids an abstraction before two real implementations
 * exist, and whether the shared shape generalizes across all three is a
 * decision for the step that has all three in hand — the differences (no
 * panel, no remediation rounds, a whole worktree to manage, a gate that
 * operates on proposed files rather than documents) are exactly what a
 * premature interface would have had to guess at.
 *
 * Every failure path is terminal: the stage completes blocked with no
 * `output_ref`, the run blocks, an audit event names the reason, the worktree
 * survives (section 7: retain it, including when the run ends blocked), and
 * `dispatchOnce` has already retained the raw output. An unexpected throw
 * lands in the same terminal machinery, so no run is left wedged.
 *
 * No test seam exists here, unlike `runPlanStage`'s `deps.selectPanel`: every
 * guard is reachable through the fixture executor or store-constructed state,
 * and Task 7 proves each.
 *
 * **The self-review** (`docs/features/implementation-self-review/plan.md`).
 * After the last phase commits, the implementer reads its own complete change
 * once, in one more sandboxed dispatch, makes any fixes in the worktree and
 * returns a critique; the fixes pass through the same boundary and commit
 * before verification. Failures split in two. A reply the stage cannot use (a
 * failed dispatch, a body that does not parse, a refused reply, a status other
 * than completed) has its workspace changes discarded, is recorded as
 * `implementation.selfreview.skipped`, and the stage passes on the last
 * phase's commit: every phase has already spent, and code review still reads
 * the whole change independently. A guard failure (a sandbox that does not
 * start or cannot be proven gone, a moved head, a refused diff, or a discard
 * that fails) blocks the run, because it shows the boundary failed. This
 * differs from the spec and plan self-critique, which block on any failure
 * because they fail before most of a run's spend.
 *
 * The self-review is the author's own pass, not review (hazard 14): code review
 * remains the independent check. Its `agent_run` row reads
 * `configured_standalone` like every dispatch; that value describes process
 * isolation, not review independence.
 */
export async function runImplementationStage(
  store: Store,
  executor: ExecutorDefinition,
  input: { runId: number; requestedModel?: string; rootDir: string }
): Promise<ImplementationStageResult> {
  const { runId, requestedModel, rootDir } = input;

  // --- preconditions, each refused by name before any state mutation or spawn ---
  const run = store.getRun(runId);
  if (!run) {
    return { ok: false, reason: `run ${runId} does not exist` };
  }
  const blocked = requireRunInProgress(run);
  if (blocked !== null) {
    return { ok: false, reason: blocked };
  }

  const chain = store.getStageChain(runId);
  if (chain.some((s) => s.kind === "implementation")) {
    const existing = chain.find((s) => s.kind === "implementation")!;
    return {
      ok: false,
      reason: `run ${runId} already has an implementation stage with status ${existing.status}`,
    };
  }
  const last = chain[chain.length - 1];
  if (!last || last.kind !== "plan_review" || last.status !== "passed" || !last.output_ref) {
    return {
      ok: false,
      reason: `run ${runId}'s last stage is ${last ? `${last.kind} (${last.status})` : "none"}, not a passed plan_review`,
    };
  }

  // Section 10: the model and effort come from the profile frozen at run
  // start, and an unmapped setting fails here rather than after a spawn has
  // spent. The `implementer` setting covers this stage and code-review
  // remediation.
  const verified = loadVerifiedProfile(rootDir, run);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const profile = verified.profile;
  const implementerSettings = resolveSettings(profile, "implementer");
  if (!implementerSettings.ok) {
    return { ok: false, reason: implementerSettings.reason };
  }
  if (requestedModel !== undefined && requestedModel !== implementerSettings.model) {
    return {
      ok: false,
      reason: `--model ${requestedModel} does not match the model frozen at run start (${implementerSettings.model}): config is frozen at run start`,
    };
  }
  // Hard rule 6 and section 11: the run executes against the executor it
  // froze, and a stage requiring a capability no frozen executor declares
  // fails at configuration time — before the stage row, the worktree, or any
  // paid invocation exists.
  const binding = requireFrozenBinding(profile, executor, "implementation");
  if (!binding.ok) {
    return { ok: false, reason: binding.reason };
  }
  // The stage ends with the implementer's self-review, so a run frozen before
  // the implementer gained that output refuses here, before the stage row or
  // the worktree exists. A missing implementer is refused by name below.
  const frozenImplementer = profile.agents.find((a) => a.id === "implementer");
  if (frozenImplementer && !frozenImplementer.outputs.includes("implementation-self-review")) {
    return { ok: false, reason: "configured agent implementer does not allow implementation-self-review output" };
  }

  const approval = store.getApproval(runId);
  if (!approval) {
    return { ok: false, reason: `run ${runId} has no recorded approval` };
  }
  let scope: string[];
  try {
    const parsed = JSON.parse(approval.scope) as unknown;
    if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== "string")) {
      throw new Error("scope is not an array of strings");
    }
    scope = parsed as string[];
  } catch (err) {
    return { ok: false, reason: `run ${runId}'s approved scope is unreadable: ${(err as Error).message}` };
  }

  const planPath = last.output_ref;
  let planContent: string;
  try {
    planContent = readFileSync(resolve(rootDir, planPath), "utf8");
  } catch (err) {
    return { ok: false, reason: `cannot read the approved plan ${planPath}: ${(err as Error).message}` };
  }

  // The plan gate approved a plan file and this stage reads it afterwards. A
  // plan edited after the gate would carry the panel's sign-off on content it
  // never saw. Re-verified before the stage row exists, so the refusal costs
  // nothing and creates no residue.
  const planHash = sha256Hex(normalizeText(planContent));
  const planGateEvent = store.query<{ summary: string }>(
    "SELECT summary FROM audit WHERE run_id = ? AND action = 'plan.gate.pass' ORDER BY id DESC LIMIT 1",
    [runId]
  )[0];
  if (!planGateEvent) {
    return {
      ok: false,
      reason: `run ${runId} has no plan.gate.pass audit event: the plan_review gate never recorded what it approved`,
    };
  }
  const gatedPlan = /planHash=([0-9a-f]{64}); planFor=([0-9a-f]{64})/.exec(planGateEvent.summary);
  if (!gatedPlan) {
    return {
      ok: false,
      reason: `run ${runId}'s plan.gate.pass event does not record a plan hash and plan_for`,
    };
  }
  if (gatedPlan[1] !== planHash) {
    return { ok: false, reason: `the plan has changed since review: gated ${gatedPlan[1]}, on disk ${planHash}` };
  }

  // The spec file is a separate mutable file from the plan. The plan check
  // above proves the plan file is unchanged; this holds the spec to both
  // authoritative records of what the operator approved — the signed hash
  // and the `planFor` the gate recorded — because this stage reads the spec,
  // commits it to the run branch, and hands it to the implementer.
  // `runPlanStage` re-verifies the spec at its boundary for exactly this
  // reason.
  const approvalStage = chain.find((s) => s.kind === "awaiting_approval");
  if (!approvalStage || !approvalStage.output_ref) {
    return {
      ok: false,
      reason: `run ${runId} has no passed awaiting_approval stage with a spec to read`,
    };
  }
  const specPath = approvalStage.output_ref;
  let specContent: string;
  try {
    specContent = readFileSync(resolve(rootDir, specPath), "utf8");
  } catch (err) {
    return { ok: false, reason: `cannot read the approved spec ${specPath}: ${(err as Error).message}` };
  }
  const specHash = sha256Hex(normalizeText(specContent));
  if (approval.spec_hash !== specHash) {
    return {
      ok: false,
      reason: `the spec has changed since approval: signed ${approval.spec_hash}, on disk ${specHash}`,
    };
  }
  if (gatedPlan[2] !== specHash) {
    return {
      ok: false,
      reason: `the spec does not match the plan the gate approved: planFor ${gatedPlan[2]}, on disk ${specHash}`,
    };
  }
  // The packages the signed specification lists, which the operator approved
  // at the decision pause: the only additions any commit of this run may make.
  const signedSpec = validateSpecDoc(specContent);
  if (!signedSpec.ok) {
    return { ok: false, reason: `the approved spec ${specPath} no longer validates: ${signedSpec.reason}` };
  }
  const approvedDependencies = signedSpec.value.dependenciesAdded;

  // The plan's task items, split into the phases this stage dispatches (hazard
  // 20: one dispatch over a whole plan was refused or failed in team-notes runs
  // 4, 5 and 6). An item is a top-level list entry of `## Tasks` with its
  // indented lines, so a nested plan is counted by its tasks, not its lines
  // (team-notes run 12 had 226 lines in 53 items and was refused at 80). Both
  // numbers come from the profile frozen at run start. A plan that needs more
  // phases than the frozen ceiling is refused here, before the stage row, the
  // worktree or any dispatch exists, so the refusal costs nothing beyond what
  // the plan stages already spent.
  const parsedPlan = validatePlanDoc(planContent);
  if (!parsedPlan.ok) {
    return { ok: false, reason: `the approved plan ${planPath} does not parse: ${parsedPlan.reason}` };
  }
  const { implementationPhaseTasks, implementationMaxPhases } = profile.policy;
  const taskCeiling = implementationPhaseTasks * implementationMaxPhases;
  if (parsedPlan.value.taskItems.length > taskCeiling) {
    return {
      ok: false,
      reason: `the approved plan has ${parsedPlan.value.taskItems.length} tasks, more than the frozen ceiling of ${taskCeiling} (${implementationPhaseTasks} tasks per phase, at most ${implementationMaxPhases} phases): start a fresh run from a smaller design`,
    };
  }
  const phases = planPhases(parsedPlan.value.taskItems, implementationPhaseTasks);

  // Section 20's run-duration ceiling, read from the profile frozen at run
  // start so the run is governed by the limit in force when it began. The
  // refusal names the limit and happens before the stage row exists.
  const ageSeconds = (Date.now() - Date.parse(run.created_at)) / 1000;
  if (ageSeconds > profile.policy.runDurationLimitSeconds) {
    return {
      ok: false,
      reason: `run ${runId} has exceeded the run-duration limit of ${profile.policy.runDurationLimitSeconds} seconds`,
    };
  }

  // Crash residue from a previous attempt must not silently reuse or corrupt
  // a leftover tree.
  const worktreePath = governanceWorktreePath(rootDir, runId);
  if (existsSync(worktreePath)) {
    return { ok: false, reason: `worktree path already exists for run ${runId}` };
  }

  const audit = (stageId: number | null, action: string, summary: string): void => {
    appendAudit(store, { runId, stageId, actor: "system", actorType: "cli", action, summary });
  };

  let stageId: number | null = null;

  const abort = (sid: number, action: string, reason: string): ImplementationStageResult => {
    audit(sid, action, reason);
    store.completeStage(sid, "", "block");
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  };

  // Git is spawned directly, no shell and no npm shim, the way
  // `resolveStartingCommit` spawns it. A non-zero exit returns git's stderr
  // as the detail; the caller names the operation it was attempting. The
  // buffer is code review's: the self-review reads the whole diff, and at
  // Node's 1 MiB default a large diff failed here instead of reaching the
  // prompt ceiling, which skips the self-review by name.
  const runGit = (args: string[], cwd: string): { ok: true; stdout: string } | { ok: false; detail: string } => {
    let result;
    try {
      result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
    if (result.status !== 0) {
      const detail = (result.stderr ?? "").trim();
      return { ok: false, detail: detail || `git ${args[0]} exited with code ${result.status}` };
    }
    return { ok: true, stdout: result.stdout ?? "" };
  };

  /**
   * Assert the worktree and index hold nothing the stage did not commit:
   * tracked, staged, untracked, and ignored entries all count (the
   * invocation verified at plan time — `--ignored=matching` is what makes a
   * write into an ignored path visible). This is the core's backstop if CLI
   * controls, hooks, or executor configuration drift: the stage refuses and
   * names the paths, never resetting and continuing, because that would hide
   * the evidence that the executor boundary failed. A git failure is treated
   * as dirty, and the refusal names the git detail.
   */
  /** The cleanliness refusals share one shape: name what is dirty. */
  const refuseDirty = (
    sid: number,
    when: "before dispatch",
    check: { ok: false; entries: string[]; detail?: string },
    where = ""
  ): ImplementationStageResult =>
    abort(
      sid,
      "implementation.worktree.dirty",
      `${where}${
        check.detail !== undefined
          ? `cannot check worktree cleanliness ${when}: ${check.detail}`
          : `worktree is not clean ${when}: ${check.entries.join(", ")}`
      }`
    );

  try {
    // --- the stage row and the worktree ---
    const stage = store.insertStage(runId, "implementation", last.id);
    stageId = stage.id;
    audit(stage.id, "implementation.stage.create", `created implementation stage ${stage.id}`);

    // After every patch commit, the files `governed.yaml` declares under
    // `derived:` are regenerated and committed by the system, never by the
    // implementer (docs/features/derived-artifacts-and-dependency-policy/plan.md).
    const regenerate = (label: string, expectedHead: string) =>
      regenerateDerivedArtifacts({
        rootDir,
        worktreePath,
        runId,
        derived: profile.verification.derived,
        expectedHead,
        label,
        evidenceDir: derivedEvidenceDir(rootDir, runId, label),
        sandbox: profile.sandbox,
        policy: {
          timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
          maxBytes: profile.policy.resultMaxBytes,
          retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
        },
        audit: (action, summary) => audit(stage.id, `implementation.${action}`, summary),
      });

    // The worktree is never deleted: section 7 retains it, including when
    // the run ends blocked.
    const branch = `gov/${run.slug}/${run.id}`;
    const added = runGit(worktreeAddArgs(worktreePath, branch, approval.starting_commit), rootDir);
    if (!added.ok) {
      return abort(stage.id, "implementation.worktree.failed", `git worktree add failed: ${added.detail}`);
    }
    audit(
      stage.id,
      "implementation.worktree.create",
      `created worktree at ${worktreePath} on branch ${branch} at ${approval.starting_commit}`
    );

    // --- the projections commit ---
    // Section 7: the system commits everything it writes to the run branch,
    // and the projections are the branch's first commit. The scope gate does
    // not apply here: this is the system's own content write, not an
    // agent-proposed patch — exactly as steps 3 and 5 wrote projections
    // without a scope check. The paths are constructed from the slug: the
    // stages keep their working copies under the run's governance directory
    // (`runDocumentDir`), and this commit is the only place the documents
    // reach `docs/features/<slug>/`.
    const repoSpec = `docs/features/${run.slug}/spec.md`;
    const repoPlan = `docs/features/${run.slug}/plan.md`;
    try {
      mkdirSync(dirname(join(worktreePath, repoSpec)), { recursive: true });
      writeFileSync(join(worktreePath, repoSpec), specContent);
      writeFileSync(join(worktreePath, repoPlan), planContent);
    } catch (err) {
      return abort(
        stage.id,
        "implementation.projections.commit",
        `cannot write projections into the worktree: ${(err as Error).message}`
      );
    }
    const addedProjections = runGit(["add", repoSpec, repoPlan], worktreePath);
    if (!addedProjections.ok) {
      return abort(stage.id, "implementation.projections.commit", `git add failed: ${addedProjections.detail}`);
    }
    const committedProjections = runGit(
      [
        "-c",
        `user.name=${SYSTEM_NAME}`,
        "-c",
        "user.email=buildworks@buildworks.invalid",
        "commit",
        "-m",
        `bw run ${runId}: projections (spec and plan)`,
      ],
      worktreePath
    );
    if (!committedProjections.ok) {
      return abort(
        stage.id,
        "implementation.projections.commit",
        `git commit failed: ${committedProjections.detail}`
      );
    }
    audit(
      stage.id,
      "implementation.projections.commit",
      `committed projections ${repoSpec} (${specHash}) and ${repoPlan} (${planHash})`
    );

    // --- the dispatch ---
    // The author comes from the frozen profile, not the live registry, and
    // is bound to the executor the run froze (section 9: a field that
    // nothing enforces does not belong here).
    const author = profile.agents.find((a) => a.id === "implementer");
    if (!author) {
      return abort(stage.id, "implementation.author.failed", "configured agent implementer is not in the frozen profile");
    }
    if (author.executor !== executor.id) {
      return abort(
        stage.id,
        "implementation.author.failed",
        `agent ${author.id} is bound to executor ${author.executor}, not the frozen executor ${executor.id}`
      );
    }
    if (!author.outputs.includes("patches")) {
      return abort(stage.id, "implementation.author.failed", `configured agent ${author.id} does not allow patches output`);
    }
    // `headAtProposal` is the head in effect when the first phase starts —
    // after the projections commit — and the handoff base. The harness runs
    // with its working directory set to the worktree root so the implementer
    // reads the repository it changes; raw output retention and the audit stay
    // in the main repository.
    const headResult = runGit(["rev-parse", "HEAD"], worktreePath);
    if (!headResult.ok) {
      return abort(stage.id, "implementation.author.failed", `cannot read the worktree head: ${headResult.detail}`);
    }
    const headAtProposal = headResult.stdout.trim();
    const derivedPaths = profile.verification.derived.map((d) => d.path);

    // One patch dispatch in its own sandbox. A sandbox that does not start
    // blocks before the dispatch; a work container not proven gone blocks
    // before anything reads the worktree, because a process left in it could
    // still be writing (docs/features/sandboxed-implementer/plan.md, Task 9).
    // Any other teardown failure is recorded and changes no outcome.
    const sandboxedDispatch = async (
      label: string,
      where: string,
      dispatch: Omit<DispatchInput, "toolServer">
    ): Promise<{ ok: true; dispatch: DispatchResult } | { ok: false; result: ImplementationStageResult }> => {
      const run = await dispatchInSandbox(store, executor, dispatch, { frozen: profile.sandbox, runId, label, worktreePath }, rootDir);
      if (!run.started) {
        return { ok: false, result: abort(stage.id, "implementation.sandbox.failed", `${where}cannot start the implementation sandbox: ${run.reason}`) };
      }
      if (!run.teardown.workContainerGone) {
        const primary = run.dispatch.ok ? null : run.dispatch.reason;
        return { ok: false, result: abort(stage.id, "implementation.sandbox.quiescence.failed", `${where}${unquiescedReason(run.sandbox, run.teardown, primary)}`) };
      }
      const failures = [...(run.proxyLogFailure === null ? [] : [run.proxyLogFailure]), ...run.teardown.failures];
      if (failures.length > 0) {
        audit(stage.id, "implementation.sandbox.teardown.failed", `${where}sandbox ${run.sandbox.name}: ${failures.join("; ")}`);
      }
      return { ok: true, dispatch: run.dispatch };
    };

    // One dispatch per phase, in plan order, each committed before the next
    // begins. The `implementer` keeps no memory between dispatches: what
    // earlier phases built reaches it only through the checkout, which is why
    // every phase's diff is computed against the head the previous phase
    // committed (never `headAtProposal`, which stays the handoff base).
    let phaseBase = headAtProposal;
    let finalHead = headAtProposal;
    for (const phase of phases) {
      // A single-phase run keeps the reasons and the commit message it always
      // had; only a run with more than one phase says where it stopped.
      const where = phase.count > 1 ? `phase ${phase.index} of ${phase.count}: ` : "";
      if (phase.index > 1) {
        const headNow = runGit(["rev-parse", "HEAD"], worktreePath);
        if (!headNow.ok) {
          return abort(stage.id, "implementation.author.failed", `${where}cannot read the worktree head: ${headNow.detail}`);
        }
        phaseBase = headNow.stdout.trim();
      }
      // The phase's base must be clean before the subprocess ever runs: the
      // boundary computes the phase's diff against it, and a dirty start would
      // inherit residue the implementer never caused.
      const cleanBeforeDispatch = checkWorktreeClean(worktreePath);
      if (!cleanBeforeDispatch.ok) {
        return refuseDirty(stage.id, "before dispatch", cleanBeforeDispatch, where);
      }
      // Which scope paths exist now, told to the model rather than left to it
      // to guess what earlier phases created (team-notes run 7, hazard 20).
      const existingPaths = scope.filter((p) => existsSync(join(worktreePath, p)));
      const sandboxed = await sandboxedDispatch(`phase-${phase.index}`, where, {
        stageId: stage.id,
        agent: author.id,
        role: "author",
        requestedModel: implementerSettings.model,
        requestedEffort: implementerSettings.effort,
        setting: author.id,
        prompt: buildImplementationAuthorPrompt(
          author,
          planContent,
          specContent,
          scope,
          phaseBase,
          phase,
          existingPaths,
          profile.verification
        ),
        // The answer comes back as structured output, never free text
        // (docs/features/structured-patch-output/plan.md).
        invocation: { cwd: worktreePath, jsonSchema: WORKSPACE_REPLY_SCHEMA },
      });
      if (!sandboxed.ok) return sandboxed.result;
      const authorDispatch = sandboxed.dispatch;
      if (!authorDispatch.ok) {
        return abort(stage.id, "implementation.author.failed", `${where}${authorDispatch.reason}`);
      }
      const reply = parseWorkspaceReply(authorDispatch.envelope.resultText, validateWorkspaceReply);
      if (!reply.ok) {
        return abort(stage.id, "implementation.content.invalid", `${where}${reply.reason}`);
      }
      if (reply.value.status !== "completed") {
        return abort(stage.id, "implementation.author.failed", `${where}implementer returned ${describeIncompleteReply(reply.value)}`);
      }

      // The boundary: the system computes the phase's diff from the worktree,
      // gates it against the signed scope and commits it. A refusal leaves the
      // worktree reset to the phase's base.
      const committed = commitWorkspace({
        worktreePath,
        base: phaseBase,
        scope,
        slug: run.slug,
        derivedPaths,
        sandbox: profile.sandbox,
        message:
          phase.count > 1
            ? `bw run ${runId}: phase ${phase.index}/${phase.count} (base ${phaseBase.slice(0, 8)})`
            : `bw run ${runId}: apply patch (base ${phaseBase.slice(0, 8)})`,
        // The refusal is the abort's own record, below.
        onAudit: (action, summary) => {
          if (action === "derived.discarded") audit(stage.id, "implementation.derived.discarded", `${where}${summary}`);
        },
      });
      if (!committed.ok) {
        // A refusal is the agent's diff breaking a rule; a failure is Git,
        // Docker or a moved head, which the operator repairs rather than reads
        // as the agent's doing.
        return committed.kind === "empty"
          ? abort(stage.id, "implementation.content.invalid", `${where}the implementer changed nothing at ${phaseBase}: a phase that changes nothing blocks the run`)
          : abort(stage.id, committed.kind === "refused" ? "implementation.workspace.refused" : "implementation.workspace.failed", `${where}${committed.reason}`);
      }
      finalHead = committed.head;
      audit(
        stage.id,
        "implementation.phase.apply",
        `phase ${phase.index} of ${phase.count}: tasks ${phase.firstTask}-${phase.firstTask + phase.tasks.length - 1}; base=${phaseBase}; head=${finalHead}; paths=${committed.paths.join(",")}`
      );
      const dependencies = unapprovedDependencyAdditions(worktreePath, headAtProposal, finalHead, approvedDependencies);
      if (!dependencies.ok) {
        return abort(stage.id, "implementation.dependency.unapproved", `${where}${dependencies.reason}`);
      }
      // The next phase re-reads its base from HEAD, so it proposes against the
      // regenerated commit.
      const regenerated = await regenerate(`phase-${phase.index}`, finalHead);
      if (!regenerated.ok) {
        return abort(stage.id, "implementation.derived.failed", `${where}${regenerated.reason}`);
      }
      finalHead = regenerated.head;
    }

    // --- the self-review, once, after the last phase ---
    const base = finalHead;
    const selfReviewFailed = (reason: string): ImplementationStageResult =>
      abort(stage.id, "implementation.selfreview.failed", `self-review: ${reason}`);
    // The same commands code review uses to describe the change, with the
    // derived files left out: the system wrote them, not the implementer.
    const excludeDerived = derivedPathExclusion(profile.verification.derived);
    const changedNames = runGit(["diff", "--name-only", "-z", headAtProposal, base, ...excludeDerived], worktreePath);
    if (!changedNames.ok) {
      return selfReviewFailed(`cannot read the changed paths for ${headAtProposal}..${base}: ${changedNames.detail}`);
    }
    const changedDiff = runGit(["diff", "--no-color", headAtProposal, base, ...excludeDerived], worktreePath);
    if (!changedDiff.ok) {
      return selfReviewFailed(`cannot read the diff for ${headAtProposal}..${base}: ${changedDiff.detail}`);
    }
    const cleanBeforeReview = checkWorktreeClean(worktreePath);
    if (!cleanBeforeReview.ok) {
      return selfReviewFailed(
        cleanBeforeReview.detail !== undefined
          ? `cannot check worktree cleanliness before the self-review dispatch: ${cleanBeforeReview.detail}`
          : `worktree is not clean before the self-review dispatch: ${cleanBeforeReview.entries.join(", ")}`
      );
    }
    const sandboxedReview = await sandboxedDispatch("self-review", "self-review: ", {
      stageId: stage.id,
      agent: author.id,
      role: "author",
      requestedModel: implementerSettings.model,
      requestedEffort: implementerSettings.effort,
      setting: author.id,
      prompt: buildImplementationSelfReviewPrompt(
        author,
        planContent,
        specContent,
        scope,
        base,
        scope.filter((p) => existsSync(join(worktreePath, p))),
        changedNames.stdout.split("\0").filter((p) => p !== ""),
        changedDiff.stdout,
        profile.verification
      ),
      // Structured output, as the phases (docs/features/structured-patch-output/plan.md).
      invocation: { cwd: worktreePath, jsonSchema: SELF_REVIEW_REPLY_SCHEMA },
    });
    if (!sandboxedReview.ok) return sandboxedReview.result;
    const reviewDispatch = sandboxedReview.dispatch;
    const reply = reviewDispatch.ok
      ? parseWorkspaceReply(reviewDispatch.envelope.resultText, validateSelfReviewReply)
      : { ok: false as const, reason: `dispatch failed: ${reviewDispatch.reason}` };
    if (!reply.ok || reply.value.status !== "completed") {
      // An unusable reply is a skip: whatever the dispatch changed is
      // discarded, so the stage passes on the last phase's commit. A discard
      // that cannot run, or a moved head, is a guard failure and blocks.
      const reason = reply.ok ? `implementer returned ${describeIncompleteReply(reply.value)}` : reply.reason;
      const discarded = discardWorkspace({ worktreePath, base, sandbox: profile.sandbox });
      if (!discarded.ok) return selfReviewFailed(`${reason}; and its changes could not be discarded: ${discarded.reason}`);
      // The reason goes last because it is free text.
      audit(
        stage.id,
        "implementation.selfreview.skipped",
        `base=${base}; discarded=${discarded.discarded.length > 0 ? discarded.discarded.join(",") : "none"}; reason=self-review: ${reason}`
      );
    } else {
      const committed = commitWorkspace({
        worktreePath,
        base,
        scope,
        slug: run.slug,
        derivedPaths,
        sandbox: profile.sandbox,
        message: `bw run ${runId}: self-review (base ${base.slice(0, 8)})`,
        onAudit: (action, summary) => {
          if (action === "derived.discarded") audit(stage.id, "implementation.selfreview.derived.discarded", summary);
        },
      });
      // No change at all is a pass with no commit.
      if (!committed.ok && committed.kind !== "empty") return selfReviewFailed(committed.reason);
      let reviewedHead = base;
      const changed = committed.ok ? committed.paths : [];
      if (committed.ok) {
        const dependencies = unapprovedDependencyAdditions(worktreePath, headAtProposal, committed.head, approvedDependencies);
        if (!dependencies.ok) {
          return abort(stage.id, "implementation.dependency.unapproved", `self-review: ${dependencies.reason}`);
        }
        const regenerated = await regenerate("self-review", committed.head);
        if (!regenerated.ok) {
          return abort(stage.id, "implementation.derived.failed", `self-review: ${regenerated.reason}`);
        }
        reviewedHead = regenerated.head;
      }
      const recorded = critiqueAuditEntries(reply.value.critique);
      for (const entry of recorded) audit(stage.id, "implementation.selfreview.critique", entry);
      audit(
        stage.id,
        "implementation.selfreview.pass",
        `critique=${reply.value.critique.length}; recorded=${recorded.length}; changed=${changed.length > 0 ? changed.join(",") : "none"}; base=${base}; head=${reviewedHead}`
      );
      finalHead = reviewedHead;
    }

    store.completeStage(stage.id, worktreePath, "pass");
    // The handoff carries both commits (step 8, task 2): the base the
    // implementer's patches bound to and the final head. Verification and
    // delivery parse this one canonical shape.
    audit(stage.id, "implementation.gate.pass", formatImplementationGate({ base: headAtProposal, head: finalHead }));
    return { ok: true, stageId: stage.id, worktreePath };
  } catch (err) {
    // The wedge guard: an unexpected throw must produce the same terminal
    // state as any other failure.
    const reason = `implementation stage failed: ${(err as Error).message}`;
    if (stageId !== null) {
      const stage = store.getStage(stageId);
      if (stage && (stage.status === "pending" || stage.status === "in_progress")) {
        store.completeStage(stageId, "", "block");
      }
    }
    audit(stageId, "implementation.stage.failed", reason);
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  }
}

/**
 * The `git` arguments that create the run's worktree, checked out LF whatever
 * the host's `core.autocrlf` says: the work container is Linux, and a CRLF
 * checkout reads as a change to every file it edits
 * (docs/features/sandboxed-implementer/plan.md, Task 7).
 */
export function worktreeAddArgs(worktreePath: string, branch: string, startingCommit: string): string[] {
  return ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "worktree", "add", worktreePath, "-b", branch, startingCommit];
}
