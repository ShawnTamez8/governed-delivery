import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { promptDir, promptRef, rawOutputDir, rawOutputRef } from "./paths.ts";

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

/**
 * Retain a prompt before the harness receives it (hazard 2 applied to the
 * input; docs/features/prompt-retention/plan.md). The file is named by `hash`,
 * the prompt's `agent_run.input_hash`, so an identical prompt in the same run
 * reuses one file. Returns the path relative to `rootDir`.
 */
export function writePrompt(rootDir: string, runId: number, prompt: string, hash: string): string {
  const dir = promptDir(rootDir, runId);
  mkdirSync(dir, { recursive: true });
  const name = `${hash}.txt`;
  const path = join(dir, name);
  if (!existsSync(path)) writeFileSync(path, prompt);
  return promptRef(runId, name);
}
