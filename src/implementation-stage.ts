import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, type Stats } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ExecutorDefinition } from "./executor.ts";
import { requireRunInProgress, type Store } from "./store.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { dispatchOnce } from "./dispatch.ts";
import { validateAgentResult, type ProposedPatch, type ProposedPatchFile } from "./agent-result.ts";
import { extractJsonBody } from "./parse-output.ts";
import { isPathInside, normalizePath, resolveExisting, touchesProtected } from "./scope.ts";
import { buildImplementationAuthorPrompt } from "./prompts.ts";
import { gatePatchPaths, movedPaths } from "./implementation-gate.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { SYSTEM_NAME } from "./policy.ts";

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
  const worktreePath = join(rootDir, ".governance", "worktrees", String(runId));
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
  const worktreeClean = (
    cwd: string
  ): { ok: true } | { ok: false; entries: string[]; detail?: string } => {
    const status = runGit(
      ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"],
      cwd
    );
    if (!status.ok) {
      return { ok: false, entries: [], detail: status.detail };
    }
    const entries = status.stdout.split("\0").filter((e) => e !== "");
    return entries.length === 0 ? { ok: true } : { ok: false, entries };
  };

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
    const cleanBeforeDispatch = worktreeClean(worktreePath);
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
    const cleanAfterDispatch = worktreeClean(worktreePath);
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

    // --- the gate, per patch, in order — every refusal terminal ---
    for (const patch of patches as ProposedPatch[]) {
      if (!Array.isArray(patch.files) || patch.files.length === 0) {
        return abort(stage.id, "implementation.content.invalid", "implementer returned a patch with no files");
      }
      for (const file of patch.files as ProposedPatchFile[]) {
        if (typeof file.content !== "string") {
          return abort(stage.id, "implementation.content.invalid", `patch file ${file.path} is missing string content`);
        }
      }
      const patchPaths = (patch.files as ProposedPatchFile[]).map((f) => f.path);

      // (a) scope and protected-path enforcement, lexically.
      const gate = gatePatchPaths(patchPaths, scope, run.slug);
      if (!gate.ok) {
        return abort(stage.id, "implementation.patch.refused", gate.reason);
      }
      // (b) the patch must name the base commit it was proposed against.
      if (patch.baseCommit !== headAtProposal) {
        return abort(
          stage.id,
          "implementation.patch.refused",
          `patch base commit ${patch.baseCommit} does not match the branch head ${headAtProposal}`
        );
      }
      // (c) the head-moved re-validation (section 8): `headAtProposal` is
      // fixed at dispatch and each applied patch advances the branch, so a
      // later patch touching a path an earlier patch touched is refused here
      // — one patch per file per dispatch, and the designed re-validation in
      // action.
      const currentHeadResult = runGit(["rev-parse", "HEAD"], worktreePath);
      if (!currentHeadResult.ok) {
        return abort(stage.id, "implementation.patch.refused", `cannot read the worktree head: ${currentHeadResult.detail}`);
      }
      const currentHead = currentHeadResult.stdout.trim();
      if (currentHead !== headAtProposal) {
        const diffResult = runGit(["diff", "--name-only", headAtProposal, currentHead], worktreePath);
        if (!diffResult.ok) {
          return abort(stage.id, "implementation.patch.refused", `cannot read the moved paths: ${diffResult.detail}`);
        }
        const moved = movedPaths(
          diffResult.stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l !== ""),
          patchPaths
        );
        if (moved.length > 0) {
          return abort(stage.id, "implementation.patch.refused", `branch moved since proposal in: ${moved.join(", ")}`);
        }
      }

      for (const file of patch.files as ProposedPatchFile[]) {
        const target = join(worktreePath, file.path);
        // (d) the fail-closed link rule, first: the write follows the link,
        // so a symlinked or junctioned ancestor redirects bytes the gate
        // checked only lexically. Refusing every link component is smaller
        // and safer than modelling another "safe" target category — the
        // redirect class has already required multiple corrections, and the
        // design does not require linked patch paths. A dangling link is
        // refused by this same walk: lstat sees the link itself, whose
        // target need not exist. Each component is lstat'ed because the
        // link may sit above the file itself. (On Windows, junctions are
        // symbolic links as far as lstat is concerned.)
        {
          let current = worktreePath;
          for (const segment of normalizePath(relative(worktreePath, target)).split("/")) {
            current = join(current, segment);
            let st: Stats | null = null;
            try {
              st = lstatSync(current);
            } catch {
              // No node at this component; a later one may still be a link.
            }
            if (st?.isSymbolicLink()) {
              return abort(
                stage.id,
                "implementation.patch.refused",
                `patch path ${file.path} contains a link component: ${normalizePath(relative(worktreePath, current))}`
              );
            }
          }
        }
        // The resolved-target backstops remain as defence in depth for a
        // link appearing between the walk and the write: `isPathInside`
        // proves the resolved target is still somewhere inside the worktree.
        const resolvedTarget = resolveExisting(target);
        if (!isPathInside(worktreePath, resolvedTarget)) {
          return abort(stage.id, "implementation.patch.refused", `patch path ${file.path} escapes the worktree`);
        }
        // The resolved-protected re-check: `touchesProtected` inside
        // `gatePatchPaths` is lexical, so a link redirecting the write into a
        // protected path would pass it. Compare the way the filesystem
        // compares, because the write follows the link. `resolveExisting`
        // resolves the nearest existing ancestor, which catches a symlinked
        // parent directory for an `add`.
        const relResolved = normalizePath(relative(worktreePath, resolvedTarget));
        if (touchesProtected([relResolved], run.slug)) {
          return abort(stage.id, "implementation.patch.refused", `resolves to protected path ${relResolved}`);
        }
        // (e) existence semantics, after the security checks: a symlinked
        // target is refused for what it resolves to, never for what happens
        // to exist.
        const exists = existsSync(target);
        if (file.action === "add" && exists) {
          return abort(stage.id, "implementation.patch.refused", `add requires the file not to exist: ${file.path}`);
        }
        if (file.action === "modify" && !exists) {
          return abort(stage.id, "implementation.patch.refused", `modify requires the file to exist: ${file.path}`);
        }
      }

      // (f) apply, (g) commit — one commit per patch, authored as the system
      // identity so run commits are never attributed to the operator.
      try {
        for (const file of patch.files as ProposedPatchFile[]) {
          const target = join(worktreePath, file.path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, file.content as string);
        }
      } catch (err) {
        return abort(stage.id, "implementation.patch.refused", `patch write failed: ${(err as Error).message}`);
      }
      // Every untrusted path travels literally: the global
      // `--literal-pathspecs` disables pathspec magic and `--` terminates
      // options, so a path named `-A` is a path, never `--all`. (The global
      // form is required — `git add --literal-pathspecs` is refused; the
      // invocation was verified at plan time.)
      const addedPatch = runGit(["--literal-pathspecs", "add", "--", ...patchPaths], worktreePath);
      if (!addedPatch.ok) {
        return abort(stage.id, "implementation.patch.refused", `git add failed: ${addedPatch.detail}`);
      }
      // The staged set must be exactly the proposed set. This is the layered
      // backstop behind the cleanliness gate: if anything else ever enters
      // the index — a path expanded by magic, an option consumed as --all, a
      // concurrent write — the run blocks on the observed difference.
      const stagedResult = runGit(["diff", "--cached", "--name-only", "-z"], worktreePath);
      if (!stagedResult.ok) {
        return abort(
          stage.id,
          "implementation.patch.refused",
          `cannot read the staged set: ${stagedResult.detail}`
        );
      }
      const stagedSet = [...new Set(stagedResult.stdout.split("\0").filter((l) => l !== "").map(normalizePath))].sort();
      const proposedSet = [...new Set(patchPaths.map(normalizePath))].sort();
      if (JSON.stringify(stagedSet) !== JSON.stringify(proposedSet)) {
        return abort(
          stage.id,
          "implementation.patch.refused",
          `staged set differs from the proposed patch: staged ${stagedSet.join(", ")}, proposed ${proposedSet.join(", ")}`
        );
      }
      const committedPatch = runGit(
        [
          "-c",
          `user.name=${SYSTEM_NAME}`,
          "-c",
          "user.email=buildworks@buildworks.invalid",
          "commit",
          "-m",
          `bw run ${runId}: apply patch (base ${headAtProposal.slice(0, 8)})`,
        ],
        worktreePath
      );
      if (!committedPatch.ok) {
        return abort(stage.id, "implementation.patch.refused", `git commit failed: ${committedPatch.detail}`);
      }
      // The commit's changed paths are compared again — the record on the
      // branch is the final word, and a mismatch here means the commit
      // carried content the patch never proposed.
      const committedResult = runGit(
        ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD"],
        worktreePath
      );
      if (!committedResult.ok) {
        return abort(
          stage.id,
          "implementation.patch.refused",
          `cannot read the committed set: ${committedResult.detail}`
        );
      }
      const committedSet = [...new Set(committedResult.stdout.split("\0").filter((l) => l !== "").map(normalizePath))].sort();
      if (JSON.stringify(committedSet) !== JSON.stringify(proposedSet)) {
        return abort(
          stage.id,
          "implementation.patch.refused",
          `committed set differs from the proposed patch: committed ${committedSet.join(", ")}, proposed ${proposedSet.join(", ")}`
        );
      }
      // (h) the audit names the observed committed set and the base commit,
      // never the proposal — what git actually committed is the record.
      audit(stage.id, "implementation.patch.apply", `applied patch to ${committedSet.join(", ")} (base ${headAtProposal})`);
    }

    // The pass hands verification a clean worktree and an exact final commit:
    // anything left behind — by the implementer, a hook, or the stage itself
    // — is evidence the boundary failed, and the run blocks on it.
    const cleanBeforePass = worktreeClean(worktreePath);
    if (!cleanBeforePass.ok) {
      return refuseDirty(stage.id, "after applying patches", cleanBeforePass);
    }

    // --- the pass ---
    const finalHeadResult = runGit(["rev-parse", "HEAD"], worktreePath);
    if (!finalHeadResult.ok) {
      return abort(stage.id, "implementation.gate.failed", `cannot read the final worktree head: ${finalHeadResult.detail}`);
    }
    const finalHead = finalHeadResult.stdout.trim();
    store.completeStage(stage.id, worktreePath, "pass");
    audit(stage.id, "implementation.gate.pass", `head=${finalHead}`);
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
