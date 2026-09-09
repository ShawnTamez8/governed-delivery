import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExecutorDefinition } from "./executor.ts";
import { requireRunInProgress, type Store } from "./store.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { dispatchOnce } from "./dispatch.ts";
import { validateAgentResult, type ProposedPatch } from "./agent-result.ts";
import { extractJsonBody } from "./parse-output.ts";
import { worktreePath as governanceWorktreePath } from "./paths.ts";
import { buildImplementationAuthorPrompt } from "./prompts.ts";
import { formatImplementationGate } from "./handoff.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { SYSTEM_NAME } from "./policy.ts";
import { applyProposedPatches, checkWorktreeClean } from "./patch-application.ts";

export type ImplementationStageResult =
  | { ok: true; stageId: number; worktreePath: string }
  | { ok: false; reason: string };

/**
 * The implementation stage (build order step 6), one row continuing section
 * 5's chain from the passed `plan_review` row: create the run's worktree on
 * branch `gov/<slug>/<run-id>` at the approved starting commit, commit the
 * run's projections there, dispatch the implementer, apply each proposed
 * patch only when every touched path is inside the signed scope and
 * untouched since proposal, commit each applied patch to the run branch, and
 * block the run — retaining the worktree — when the deterministic gate
 * refuses.
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

  // Section 10: the model comes from the profile frozen at run start, and an
  // unmapped stage kind fails here rather than after a spawn has spent.
  const verified = loadVerifiedProfile(rootDir, run);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const profile = verified.profile;
  const resolvedModel = resolveStageModel(profile, "implementation");
  if (!resolvedModel.ok) {
    return { ok: false, reason: resolvedModel.reason };
  }
  if (requestedModel !== undefined && requestedModel !== resolvedModel.model) {
    return {
      ok: false,
      reason: `--model ${requestedModel} does not match the model frozen at run start (${resolvedModel.model}): config is frozen at run start`,
    };
  }
  const model = resolvedModel.model;
  // Hard rule 6 and section 11: the run executes against the executor it
  // froze, and a stage requiring a capability no frozen executor declares
  // fails at configuration time — before the stage row, the worktree, or any
  // paid invocation exists.
  const binding = requireFrozenBinding(profile, executor, "implementation");
  if (!binding.ok) {
    return { ok: false, reason: binding.reason };
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
    planContent = readFileSync(planPath, "utf8");
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
    specContent = readFileSync(specPath, "utf8");
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
  // as the detail; the caller names the operation it was attempting.
  const runGit = (args: string[], cwd: string): { ok: true; stdout: string } | { ok: false; detail: string } => {
    let result;
    try {
      result = spawnSync("git", args, { cwd, encoding: "utf8" });
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
    when: "before dispatch" | "after dispatch" | "after applying patches",
    check: { ok: false; entries: string[]; detail?: string }
  ): ImplementationStageResult =>
    abort(
      sid,
      "implementation.worktree.dirty",
      check.detail !== undefined
        ? `cannot check worktree cleanliness ${when}: ${check.detail}`
        : `worktree is not clean ${when}: ${check.entries.join(", ")}`
    );

  try {
    // --- the stage row and the worktree ---
    const stage = store.insertStage(runId, "implementation", last.id);
    stageId = stage.id;
    audit(stage.id, "implementation.stage.create", `created implementation stage ${stage.id}`);

    // The worktree is never deleted: section 7 retains it, including when
    // the run ends blocked.
    const branch = `gov/${run.slug}/${run.id}`;
    const added = runGit(
      ["worktree", "add", worktreePath, "-b", branch, approval.starting_commit],
      rootDir
    );
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
    // without a scope check. The paths are constructed from the slug, the
    // repo-relative locations `writeSpecDoc`/`writePlanDoc` use in the main
    // tree.
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

    // The proposal base must be clean before the subprocess ever runs: the
    // gate later treats this tree as the base every patch is validated
    // against, and a dirty start would inherit residue the implementer never
    // caused.
    const cleanBeforeDispatch = checkWorktreeClean(worktreePath);
    if (!cleanBeforeDispatch.ok) {
      return refuseDirty(stage.id, "before dispatch", cleanBeforeDispatch);
    }

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
    // `headAtProposal` is the head in effect when the patch is proposed —
    // after the projections commit — and the base every proposed patch must
    // name. The harness runs with its working directory set to the worktree
    // root so the implementer reads the repository it is patching; raw
    // output retention and the audit stay in the main repository.
    const headResult = runGit(["rev-parse", "HEAD"], worktreePath);
    if (!headResult.ok) {
      return abort(stage.id, "implementation.author.failed", `cannot read the worktree head: ${headResult.detail}`);
    }
    const headAtProposal = headResult.stdout.trim();
    const authorDispatch = await dispatchOnce(
      store,
      executor,
      {
        stageId: stage.id,
        agent: author.id,
        role: "author",
        requestedModel: model,
        prompt: buildImplementationAuthorPrompt(author, planContent, specContent, scope, headAtProposal),
        invocation: { cwd: worktreePath },
      },
      rootDir
    );
    if (!authorDispatch.ok) {
      return abort(stage.id, "implementation.author.failed", authorDispatch.reason);
    }

    // The subprocess boundary backstop: the model may have mutated the tree
    // it was invited to read. Any change — tracked, staged, untracked, or
    // ignored — blocks the run and names the paths before anything is
    // parsed or applied. A prompt is a request; this is the check.
    const cleanAfterDispatch = checkWorktreeClean(worktreePath);
    if (!cleanAfterDispatch.ok) {
      return refuseDirty(stage.id, "after dispatch", cleanAfterDispatch);
    }

    // --- parse, validate, and refuse an empty delivery ---
    const authorBody = extractJsonBody(authorDispatch.envelope.resultText);
    if (authorBody.kind === "refused") {
      return abort(stage.id, "implementation.content.invalid", `implementer body refused: ${authorBody.reason}`);
    }
    const authorResult = validateAgentResult(author.id, authorBody.value);
    if (!authorResult.ok) {
      return abort(stage.id, "implementation.content.invalid", `implementer result refused: ${authorResult.reason}`);
    }
    if (authorResult.value.status !== "proposed") {
      return abort(
        stage.id,
        "implementation.author.failed",
        `implementer returned status ${authorResult.value.status}, not proposed`
      );
    }
    const patches = authorResult.value.proposedPatches;
    if (!Array.isArray(patches) || patches.length === 0) {
      return abort(
        stage.id,
        "implementation.content.invalid",
        "implementer returned no proposed patches: a run that delivers nothing cannot pass"
      );
    }

    // The patch helper is now shared with code-review remediation. It owns the
    // complete write-path guard sequence but never mutates run or stage state.
    const applied = applyProposedPatches({
      worktreePath,
      runId,
      slug: run.slug,
      scope,
      proposalBase: headAtProposal,
      patches: patches as ProposedPatch[],
      commitMessage: `bw run ${runId}: apply patch (base ${headAtProposal.slice(0, 8)})`,
      audit: (action, summary) => audit(stage.id, `implementation.${action}`, summary.replace(`; run ${runId}`, "")),
    });
    if (!applied.ok) {
      const action =
        applied.kind === "content_invalid"
          ? "implementation.content.invalid"
          : applied.kind === "worktree_dirty"
            ? "implementation.worktree.dirty"
            : applied.kind === "gate_failed"
              ? "implementation.gate.failed"
              : "implementation.patch.refused";
      return abort(
        stage.id,
        action,
        applied.reason
      );
    }
    const finalHead = applied.resultingCommit;
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
