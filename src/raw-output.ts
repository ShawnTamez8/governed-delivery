import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { rawOutputDir, rawOutputRef } from "./paths.ts";

/**
 * Retain raw output before any parser touches it (hazard 2). Returns the
 * path relative to `rootDir`, for storage in `agent_run.raw_output_ref`.
 */
export function writeRawOutput(rootDir: string, runId: number, bytes: string): string {
  const dir = rawOutputDir(rootDir, runId);
  mkdirSync(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(6).toString("hex")}.json`;
  writeFileSync(join(dir, name), bytes);
  return rawOutputRef(runId, name);
}
