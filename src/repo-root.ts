import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

export class TargetUnavailableError extends Error {
  constructor(reason: string) {
    super(`target_unavailable: ${reason}`);
  }
}

export function resolveRepositoryRoot(
  path: string = process.cwd(),
  invocationDirectory: string = process.cwd(),
): string {
  const selected = resolve(invocationDirectory, path);
  try {
    if (!statSync(selected).isDirectory()) {
      throw new Error(`${selected} is not a directory`);
    }
    const directory = realpathSync(selected);
    const query = (...args: string[]): string => {
      const result = spawnSync("git", ["--no-optional-locks", "rev-parse", ...args], {
        cwd: directory, encoding: "utf8", shell: false,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr.trim() || "Git could not resolve the worktree");
      return result.stdout.trim();
    };
    if (query("--is-bare-repository") === "true") {
      throw new Error(`${selected} is a bare repository, not a worktree`);
    }
    if (query("--is-inside-work-tree") !== "true") {
      throw new Error(`${selected} is not a Git worktree`);
    }
    return realpathSync(query("--show-toplevel"));
  } catch (error) {
    throw new TargetUnavailableError(`cannot use ${selected}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
