import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync, type Stats } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ProposedPatch, ProposedPatchFile } from "./agent-result.ts";
import { gatePatchPaths, movedPaths } from "./implementation-gate.ts";
import { SYSTEM_NAME } from "./policy.ts";
import { isPathInside, normalizePath, resolveExisting, touchesProtected } from "./scope.ts";

export type PatchApplicationResult =
  | { ok: true; resultingCommit: string; changedPaths: string[] }
  | {
      ok: false;
      kind: "content_invalid" | "patch_refused" | "worktree_dirty" | "gate_failed";
      reason: string;
    };

export interface PatchApplicationInput {
  worktreePath: string;
  runId: number;
  slug: string;
  scope: string[];
  proposalBase: string;
  patches: ProposedPatch[];
  commitMessage: string;
  audit: (action: string, summary: string) => void;
}

function refusal(
  kind: "content_invalid" | "patch_refused" | "worktree_dirty" | "gate_failed",
  reason: string
): PatchApplicationResult {
  return { ok: false, kind, reason };
}

function runGit(
  args: string[],
  cwd: string
): { ok: true; stdout: string } | { ok: false; detail: string } {
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
}

/** The complete tracked, untracked, staged, and matching-ignored check. */
export function checkWorktreeClean(
  cwd: string
): { ok: true } | { ok: false; entries: string[]; detail?: string } {
  const status = runGit(
    ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"],
    cwd
  );
  if (!status.ok) return { ok: false, entries: [], detail: status.detail };
  const entries = status.stdout.split("\0").filter((entry) => entry !== "");
  return entries.length === 0 ? { ok: true } : { ok: false, entries };
}

/**
 * Apply one model-authored patch envelope through the concrete implementation
 * guards. It changes only the worktree and emits successful-patch audit facts;
 * stage and run status remain the caller's responsibility.
 */
export function applyProposedPatches(input: PatchApplicationInput): PatchApplicationResult {
  const {
    worktreePath,
    runId,
    slug,
    scope,
    proposalBase,
    patches,
    commitMessage,
    audit,
  } = input;
  if (!Array.isArray(patches) || patches.length === 0) {
    return refusal(
      "content_invalid",
      "implementer returned no proposed patches: a run that delivers nothing cannot pass"
    );
  }
  const changed = new Set<string>();
  for (const patch of patches) {
    if (!Array.isArray(patch.files) || patch.files.length === 0) {
      return refusal("content_invalid", "implementer returned a patch with no files");
    }
    for (const file of patch.files as ProposedPatchFile[]) {
      if (typeof file.content !== "string") {
        return refusal("content_invalid", `patch file ${file.path} is missing string content`);
      }
    }
    const patchPaths = (patch.files as ProposedPatchFile[]).map((file) => file.path);
    const gate = gatePatchPaths(patchPaths, scope, slug);
    if (!gate.ok) return refusal("patch_refused", gate.reason);
    if (patch.baseCommit !== proposalBase) {
      return refusal(
        "patch_refused",
        `patch base commit ${patch.baseCommit} does not match the branch head ${proposalBase}`
      );
    }
    const currentHeadResult = runGit(["rev-parse", "HEAD"], worktreePath);
    if (!currentHeadResult.ok) {
      return refusal("patch_refused", `cannot read the worktree head: ${currentHeadResult.detail}`);
    }
    const currentHead = currentHeadResult.stdout.trim();
    if (currentHead !== proposalBase) {
      const diffResult = runGit(["diff", "--name-only", proposalBase, currentHead], worktreePath);
      if (!diffResult.ok) {
        return refusal("patch_refused", `cannot read the moved paths: ${diffResult.detail}`);
      }
      const moved = movedPaths(
        diffResult.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== ""),
        patchPaths
      );
      if (moved.length > 0) {
        return refusal("patch_refused", `branch moved since proposal in: ${moved.join(", ")}`);
      }
    }

    for (const file of patch.files as ProposedPatchFile[]) {
      const target = join(worktreePath, file.path);
      let current = worktreePath;
      for (const segment of normalizePath(relative(worktreePath, target)).split("/")) {
        current = join(current, segment);
        let stats: Stats | null = null;
        try {
          stats = lstatSync(current);
        } catch {
          // A later component can still be a link.
        }
        if (stats?.isSymbolicLink()) {
          return refusal(
            "patch_refused",
            `patch path ${file.path} contains a link component: ${normalizePath(
              relative(worktreePath, current)
            )}`
          );
        }
      }
      const resolvedTarget = resolveExisting(target);
      if (!isPathInside(worktreePath, resolvedTarget)) {
        return refusal("patch_refused", `patch path ${file.path} escapes the worktree`);
      }
      const relResolved = normalizePath(relative(worktreePath, resolvedTarget));
      if (touchesProtected([relResolved], slug)) {
        return refusal("patch_refused", `resolves to protected path ${relResolved}`);
      }
      const exists = existsSync(target);
      if (file.action === "add" && exists) {
        return refusal("patch_refused", `add requires the file not to exist: ${file.path}`);
      }
      if (file.action === "modify" && !exists) {
        return refusal("patch_refused", `modify requires the file to exist: ${file.path}`);
      }
    }

    try {
      for (const file of patch.files as ProposedPatchFile[]) {
        const target = join(worktreePath, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.content as string);
      }
    } catch (err) {
      return refusal("patch_refused", `patch write failed: ${(err as Error).message}`);
    }
    const addedPatch = runGit(
      ["--literal-pathspecs", "add", "--", ...patchPaths],
      worktreePath
    );
    if (!addedPatch.ok) return refusal("patch_refused", `git add failed: ${addedPatch.detail}`);
    const stagedResult = runGit(["diff", "--cached", "--name-only", "-z"], worktreePath);
    if (!stagedResult.ok) {
      return refusal("patch_refused", `cannot read the staged set: ${stagedResult.detail}`);
    }
    const stagedSet = [
      ...new Set(stagedResult.stdout.split("\0").filter((line) => line !== "").map(normalizePath)),
    ].sort();
    const proposedSet = [...new Set(patchPaths.map(normalizePath))].sort();
    if (JSON.stringify(stagedSet) !== JSON.stringify(proposedSet)) {
      return refusal(
        "patch_refused",
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
        commitMessage,
      ],
      worktreePath
    );
    if (!committedPatch.ok) {
      return refusal("patch_refused", `git commit failed: ${committedPatch.detail}`);
    }
    const committedResult = runGit(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD"],
      worktreePath
    );
    if (!committedResult.ok) {
      return refusal("patch_refused", `cannot read the committed set: ${committedResult.detail}`);
    }
    const committedSet = [
      ...new Set(
        committedResult.stdout.split("\0").filter((line) => line !== "").map(normalizePath)
      ),
    ].sort();
    if (JSON.stringify(committedSet) !== JSON.stringify(proposedSet)) {
      return refusal(
        "patch_refused",
        `committed set differs from the proposed patch: committed ${committedSet.join(", ")}, proposed ${proposedSet.join(", ")}`
      );
    }
    for (const path of committedSet) changed.add(path);
    audit(
      "patch.apply",
      `applied patch to ${committedSet.join(", ")} (base ${proposalBase}; run ${runId})`
    );
  }
  const clean = checkWorktreeClean(worktreePath);
  if (!clean.ok) {
    return refusal(
      "worktree_dirty",
        clean.detail !== undefined
          ? `cannot check worktree cleanliness after applying patches: ${clean.detail}`
          : `worktree is not clean after applying patches: ${clean.entries.join(", ")}`
    );
  }
  const finalHead = runGit(["rev-parse", "HEAD"], worktreePath);
  if (!finalHead.ok) {
    return refusal("gate_failed", `cannot read the final worktree head: ${finalHead.detail}`);
  }
  return {
    ok: true,
    resultingCommit: finalHead.stdout.trim(),
    changedPaths: [...changed].sort(),
  };
}
