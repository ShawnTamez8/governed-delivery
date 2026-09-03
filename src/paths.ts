/**
 * Where governance state lives.
 *
 * The directory name was spelled out at nine production construction sites,
 * plus the scope prefix, the executor's denied glob, and the clean-tree
 * filter. That is twelve places to keep in step and twelve places for a
 * thirteenth to appear unnoticed. This module owns the name and every path
 * built from it; `test/paths.test.ts` fails if the literal reappears
 * anywhere else under `src/`.
 *
 * The name is a constant here and is not configurable in this step
 * (architecture section 15 lists `.governance/` among the fixed internal
 * paths). External configuration of the location, and the state migration it
 * would imply, are a separate decision.
 */

import { join } from "node:path";

/** The machine-local state directory, relative to a repository root. */
export const GOVERNANCE_DIR = ".governance";

/**
 * The same name as a path prefix, for the checks that ask whether a path
 * *is* governance state rather than building one: the protected-path list
 * and the executor sandbox both compare, they do not construct.
 */
export const GOVERNANCE_PREFIX = `${GOVERNANCE_DIR}/`;

/** The directory the repository lock file is created in (section 19). */
export function lockDir(rootDir: string): string {
  return join(rootDir, GOVERNANCE_DIR);
}

/** The SQLite database holding run state (section 15). */
export function stateDbPath(rootDir: string): string {
  return join(rootDir, GOVERNANCE_DIR, "state.db");
}

/** The directory holding one run's retained raw agent output (hazard 2). */
export function rawOutputDir(rootDir: string, runId: number): string {
  return join(rootDir, GOVERNANCE_DIR, "raw", String(runId));
}

/**
 * The same file as `agent_run.raw_output_ref` stores it: relative to the
 * repository root, so the reference survives the tree being read elsewhere.
 */
export function rawOutputRef(runId: number, name: string): string {
  return join(GOVERNANCE_DIR, "raw", String(runId), name);
}

/** The directory holding one run's frozen profile (section 12). */
export function profileDir(rootDir: string, runId: number): string {
  return join(rootDir, GOVERNANCE_DIR, "profiles", String(runId));
}

/** The frozen profile itself. */
export function profilePath(rootDir: string, runId: number): string {
  return join(profileDir(rootDir, runId), "profile.json");
}

/** The directory holding one run's verification command logs. */
export function verificationEvidenceDir(rootDir: string, runId: number): string {
  return join(rootDir, GOVERNANCE_DIR, "verification", String(runId));
}

/** The git worktree the implementation stage builds a run's patches in. */
export function worktreePath(rootDir: string, runId: number): string {
  return join(rootDir, GOVERNANCE_DIR, "worktrees", String(runId));
}

/** The directory holding one run's retained upstream-proposal evidence (section 13, section 14). */
export function proposalEvidenceDir(rootDir: string, runId: number): string {
  return join(rootDir, GOVERNANCE_DIR, "proposals", String(runId));
}

/** The directory holding one run's delivery records (step 8). */
export function deliveryEvidenceDir(rootDir: string, runId: number): string {
  return join(rootDir, GOVERNANCE_DIR, "delivery", String(runId));
}

/**
 * The same file a delivery stage's `output_ref` stores it: relative to the
 * repository root, mirroring `rawOutputRef`'s reasoning — the reference must
 * survive the tree being read from elsewhere.
 */
export function deliveryEvidenceRef(runId: number, name: string): string {
  return join(GOVERNANCE_DIR, "delivery", String(runId), name);
}

/**
 * The same file `proposal.evidence_ref` stores it: relative to the
 * repository root, mirroring `rawOutputRef`'s reasoning — the reference must
 * survive the tree being read from elsewhere.
 */
export function proposalEvidenceRef(runId: number, name: string): string {
  return join(GOVERNANCE_DIR, "proposals", String(runId), name);
}
