import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type ExecutorDefinition } from "./executor.ts";
import { requireRunInProgress, type Store } from "./store.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveSettings } from "./profile.ts";
import { dispatchOnce } from "./dispatch.ts";
import { PATCH_RESULT_SCHEMA, validateAgentResult, type ProposedPatch } from "./agent-result.ts";
import { extractJsonBody } from "./parse-output.ts";
import { worktreePath as governanceWorktreePath } from "./paths.ts";
import { buildImplementationAuthorPrompt, buildImplementationSelfReviewPrompt } from "./prompts.ts";
import {
  critiqueAuditEntries,
  SELF_REVIEW_RESULT_SCHEMA,
  validateImplementationSelfReview,
} from "./implementation-self-review.ts";
import { formatImplementationGate } from "./handoff.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { SYSTEM_NAME } from "./policy.ts";
import { applyProposedPatches, checkWorktreeClean } from "./patch-application.ts";
import { planPhases, validatePlanDoc } from "./plan-doc.ts";

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
 *
 * **The self-review** (`docs/features/implementation-self-review/plan.md`).
 * After the last phase commits, the implementer reads its own complete change
 * once, in one more dispatch, and returns a critique and any fixes, which pass
 * through the same patch guards and commit before verification. Failures split
 * in two. A reply the stage cannot use (a failed dispatch, a body that does not
 * parse, a refused result, a status other than proposed, a malformed critique or
 * patch envelope) is recorded as `implementation.selfreview.skipped` and the
 * stage passes on the last phase's commit: every phase has already spent, and
 * code review still reads the whole change independently. A guard failure (a
 * moved head, a dirty tree, or any patch refusal) blocks the run, because it
 * shows the boundary failed. This differs from the spec and plan self-critique,
 * which block on any failure because they fail before most of a run's spend.
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
    when: "before dispatch" | "after dispatch" | "after applying patches",
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

    // One dispatch per phase, in plan order, each applied and committed before
    // the next begins. The `implementer` keeps no memory between dispatches:
    // what earlier phases built reaches it only through the checkout, which is
    // why every phase proposes against the head the previous phase committed
    // (never `headAtProposal`, which stays the handoff base).
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
      // Which scope paths exist now, by the test the patch applier refuses on
      // (`existsSync` in the worktree). The model is told rather than left to
      // guess what earlier phases created (team-notes run 7, hazard 20).
      const existingPaths = scope.filter((p) => existsSync(join(worktreePath, p)));
      const authorDispatch = await dispatchOnce(
        store,
        executor,
        {
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
          invocation: { cwd: worktreePath, jsonSchema: PATCH_RESULT_SCHEMA },
        },
        rootDir
      );
      if (!authorDispatch.ok) {
        return abort(stage.id, "implementation.author.failed", `${where}${authorDispatch.reason}`);
      }

      // The subprocess boundary backstop: the model may have mutated the tree
      // it was invited to read. Any change — tracked, staged, untracked, or
      // ignored — blocks the run and names the paths before anything is
      // parsed or applied. A prompt is a request; this is the check. It runs
      // after every phase's dispatch; the tree before a later phase is already
      // proven clean by `applyProposedPatches`, which ends on the same check.
      const cleanAfterDispatch = checkWorktreeClean(worktreePath);
      if (!cleanAfterDispatch.ok) {
        return refuseDirty(stage.id, "after dispatch", cleanAfterDispatch, where);
      }

      // --- parse, validate, and refuse an empty delivery ---
      const authorBody = extractJsonBody(authorDispatch.envelope.resultText);
      if (authorBody.kind === "refused") {
        return abort(stage.id, "implementation.content.invalid", `${where}implementer body refused: ${authorBody.reason}`);
      }
      const authorResult = validateAgentResult(author.id, authorBody.value);
      if (!authorResult.ok) {
        return abort(stage.id, "implementation.content.invalid", `${where}implementer result refused: ${authorResult.reason}`);
      }
      if (authorResult.value.status !== "proposed") {
        return abort(
          stage.id,
          "implementation.author.failed",
          `${where}implementer returned status ${authorResult.value.status}, not proposed`
        );
      }
      const patches = authorResult.value.proposedPatches;
      if (!Array.isArray(patches) || patches.length === 0) {
        return abort(
          stage.id,
          "implementation.content.invalid",
          `${where}implementer returned no proposed patches: a run that delivers nothing cannot pass`
        );
      }

      // A file returned unchanged at the phase's base is dropped and recorded,
      // by the self-review's rule; a phase left with nothing blocks, as its
      // prompt says (docs/features/structured-patch-output/plan.md).
      const unchanged = dropUnchangedFiles(worktreePath, phaseBase, scope, patches as ProposedPatch[]);
      if (!unchanged.ok) {
        return abort(stage.id, "implementation.patch.refused", `${where}${unchanged.reason}`);
      }
      if (unchanged.dropped.length > 0) {
        audit(
          stage.id,
          "implementation.phase.dropped",
          `phase ${phase.index} of ${phase.count}: unchanged at ${phaseBase}: ${unchanged.dropped.join(", ")}`
        );
      }
      if (unchanged.kept.length === 0) {
        return abort(
          stage.id,
          "implementation.content.invalid",
          `${where}every returned file is unchanged at ${phaseBase} (${unchanged.dropped.join(", ")}): a phase that changes nothing blocks the run`
        );
      }

      // The patch helper is shared with code-review remediation. It owns the
      // complete write-path guard sequence but never mutates run or stage state.
      const applied = applyProposedPatches({
        worktreePath,
        runId,
        slug: run.slug,
        scope,
        proposalBase: phaseBase,
        patches: unchanged.kept,
        commitMessage:
          phase.count > 1
            ? `bw run ${runId}: phase ${phase.index}/${phase.count} (base ${phaseBase.slice(0, 8)})`
            : `bw run ${runId}: apply patch (base ${phaseBase.slice(0, 8)})`,
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
        return abort(stage.id, action, `${where}${applied.reason}`);
      }
      finalHead = applied.resultingCommit;
      audit(
        stage.id,
        "implementation.phase.apply",
        `phase ${phase.index} of ${phase.count}: tasks ${phase.firstTask}-${phase.firstTask + phase.tasks.length - 1}; base=${phaseBase}; head=${finalHead}`
      );
    }

    // --- the self-review, once, after the last phase ---
    const base = finalHead;
    const selfReviewFailed = (reason: string): ImplementationStageResult =>
      abort(stage.id, "implementation.selfreview.failed", `self-review: ${reason}`);
    // The same commands code review uses to describe the change.
    const changedNames = runGit(["diff", "--name-only", "-z", headAtProposal, base], worktreePath);
    if (!changedNames.ok) {
      return selfReviewFailed(`cannot read the changed paths for ${headAtProposal}..${base}: ${changedNames.detail}`);
    }
    const changedDiff = runGit(["diff", "--no-color", headAtProposal, base], worktreePath);
    if (!changedDiff.ok) {
      return selfReviewFailed(`cannot read the diff for ${headAtProposal}..${base}: ${changedDiff.detail}`);
    }
    const reviewDispatch = await dispatchOnce(
      store,
      executor,
      {
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
        invocation: { cwd: worktreePath, jsonSchema: SELF_REVIEW_RESULT_SCHEMA },
      },
      rootDir
    );
    // The boundary is checked before the reply is read, and whether or not the
    // dispatch succeeded: a failed dispatch that also touched the tree blocks.
    const headAfterReview = runGit(["rev-parse", "HEAD"], worktreePath);
    if (!headAfterReview.ok) {
      return selfReviewFailed(`cannot read the worktree head: ${headAfterReview.detail}`);
    }
    if (headAfterReview.stdout.trim() !== base) {
      return selfReviewFailed(`the worktree head moved during the self-review dispatch: expected ${base}, found ${headAfterReview.stdout.trim()}`);
    }
    const cleanAfterReview = checkWorktreeClean(worktreePath);
    if (!cleanAfterReview.ok) {
      return selfReviewFailed(
        cleanAfterReview.detail !== undefined
          ? `cannot check worktree cleanliness after the self-review dispatch: ${cleanAfterReview.detail}`
          : `worktree is not clean after the self-review dispatch: ${cleanAfterReview.entries.join(", ")}`
      );
    }
    const reply = readSelfReviewReply(
      author.id,
      reviewDispatch.ok ? { ok: true, resultText: reviewDispatch.envelope.resultText } : reviewDispatch
    );
    if (!reply.ok) {
      // The reason goes last because it is free text.
      audit(stage.id, "implementation.selfreview.skipped", `base=${base}; reason=self-review: ${reply.reason}`);
    } else {
      const unchanged = dropUnchangedFiles(worktreePath, base, scope, reply.patches);
      if (!unchanged.ok) return selfReviewFailed(unchanged.reason);
      const { kept, dropped } = unchanged;
      let reviewedHead = base;
      if (kept.length > 0) {
        const applied = applyProposedPatches({
          worktreePath,
          runId,
          slug: run.slug,
          scope,
          proposalBase: base,
          patches: kept,
          commitMessage: `bw run ${runId}: self-review (base ${base.slice(0, 8)})`,
          audit: (action, summary) =>
            audit(stage.id, `implementation.selfreview.${action}`, summary.replace(`; run ${runId}`, "")),
        });
        if (!applied.ok) return selfReviewFailed(applied.reason);
        reviewedHead = applied.resultingCommit;
      }
      const recorded = critiqueAuditEntries(reply.critique);
      for (const entry of recorded) audit(stage.id, "implementation.selfreview.critique", entry);
      audit(
        stage.id,
        "implementation.selfreview.pass",
        `critique=${reply.critique.length}; recorded=${recorded.length}; patches=${kept.length}; dropped=${dropped.length > 0 ? dropped.join(", ") : "none"}; base=${base}; head=${reviewedHead}`
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
 * The self-review reply, or the reason the stage cannot use it. Every refusal
 * here is a skip, never a block: the guard checks have already run.
 * `validateAgentResult` reads a patch or file entry's fields without checking
 * that the entry is an object, so a `null` entry throws there; the throw is
 * caught and becomes a skip like any other malformed envelope.
 */
function readSelfReviewReply(
  agentId: string,
  dispatch: { ok: true; resultText: string } | { ok: false; reason: string }
): { ok: true; critique: string[]; patches: ProposedPatch[] } | { ok: false; reason: string } {
  if (!dispatch.ok) {
    return { ok: false, reason: `dispatch failed: ${dispatch.reason}` };
  }
  const body = extractJsonBody(dispatch.resultText);
  if (body.kind === "refused") {
    return { ok: false, reason: `implementer body refused: ${body.reason}` };
  }
  let result: ReturnType<typeof validateAgentResult>;
  try {
    result = validateAgentResult(agentId, body.value);
  } catch (err) {
    return { ok: false, reason: `implementer result refused: ${(err as Error).message}` };
  }
  if (!result.ok) {
    return { ok: false, reason: `implementer result refused: ${result.reason}` };
  }
  if (result.value.status !== "proposed") {
    return { ok: false, reason: `implementer returned status ${result.value.status}, not proposed` };
  }
  const changes = result.value.proposedContentChanges;
  const selfReview =
    typeof changes === "object" && changes !== null && !Array.isArray(changes)
      ? (changes as { selfReview?: unknown }).selfReview
      : undefined;
  const critique = validateImplementationSelfReview(selfReview);
  if (!critique.ok) {
    return { ok: false, reason: critique.reason };
  }
  const patches = result.value.proposedPatches ?? [];
  for (const patch of patches) {
    if (patch.files.length === 0) {
      return { ok: false, reason: "a proposed patch has no files" };
    }
    for (const file of patch.files) {
      if (typeof file.content !== "string") {
        return { ok: false, reason: `proposed file ${file.path} has no string content` };
      }
    }
  }
  return { ok: true, critique: critique.value.critique, patches };
}

/**
 * The patches with every file returned unchanged at `commit` removed, and the
 * paths removed. A file returned unchanged stages nothing, and the applier
 * refuses a patch whose staged set differs from the proposed set (web-calculator
 * run 1, phase 2, hazard 20). Only a `modify` of an approved scope path with
 * string content is compared; anything else reaches the applier's own refusal.
 * A patch the drop empties is removed. Each phase and the self-review use it,
 * each against the commit it proposed on.
 */
function dropUnchangedFiles(
  worktreePath: string,
  commit: string,
  scope: string[],
  patches: ProposedPatch[]
): { ok: true; kept: ProposedPatch[]; dropped: string[] } | { ok: false; reason: string } {
  const dropped: string[] = [];
  const kept: ProposedPatch[] = [];
  for (const patch of patches) {
    const files: ProposedPatch["files"] = [];
    for (const file of patch.files) {
      if (file.action === "modify" && scope.includes(file.path) && typeof file.content === "string") {
        const same = sameBlobAtCommit(worktreePath, commit, file.path, file.content);
        if (!same.ok) return same;
        if (same.same) {
          dropped.push(file.path);
          continue;
        }
      }
      files.push(file);
    }
    // A patch that arrived with no file is kept for the applier to refuse.
    if (files.length > 0 || patch.files.length === 0) kept.push({ ...patch, files });
  }
  return { ok: true, kept, dropped };
}

/**
 * Whether `content`, staged at `path`, would produce the blob `commit` already
 * holds there. `--path` applies the path's line-ending and filter conversion,
 * so content that differs only in line endings from an LF blob under
 * `core.autocrlf` counts as the same. One case disagrees with `git add`: when
 * the committed blob itself holds CRLF, `git add` keeps CRLF content as it is
 * while `hash-object` still converts it, so an unchanged file is not dropped
 * and the applier refuses its patch. Files the phases create are LF blobs.
 * A path absent at `commit` is not the same; a git failure is named.
 */
function sameBlobAtCommit(
  worktreePath: string,
  commit: string,
  path: string,
  content: string
): { ok: true; same: boolean } | { ok: false; reason: string } {
  const atCommit = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${commit}:${path}`], {
    cwd: worktreePath,
    encoding: "utf8",
  });
  if (atCommit.error) {
    return { ok: false, reason: `cannot read ${path} at ${commit}: ${atCommit.error.message}` };
  }
  // `--verify --quiet` exits 1 with no output when the path is absent.
  if (atCommit.status === 1 && (atCommit.stdout ?? "").trim() === "") {
    return { ok: true, same: false };
  }
  if (atCommit.status !== 0) {
    return { ok: false, reason: `cannot read ${path} at ${commit}: ${(atCommit.stderr ?? "").trim() || `git rev-parse exited with code ${atCommit.status}`}` };
  }
  const proposed = spawnSync("git", ["hash-object", `--path=${path}`, "--stdin"], {
    cwd: worktreePath,
    encoding: "utf8",
    input: content,
  });
  if (proposed.error || proposed.status !== 0) {
    const detail = proposed.error?.message ?? ((proposed.stderr ?? "").trim() || `git hash-object exited with code ${proposed.status}`);
    return { ok: false, reason: `cannot hash the proposed content of ${path}: ${detail}` };
  }
  return { ok: true, same: proposed.stdout.trim() === atCommit.stdout.trim() };
}
