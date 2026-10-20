import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryKey, type FrozenSandbox } from "../../../src/container.ts";
import { seededSandbox } from "../../../src/policy.ts";

/**
 * How the suites use the Docker stand-in (`docker-stand-in.mjs` beside this
 * file; docs/features/sandboxed-implementer/plan.md, Task 4). In-process, a
 * test freezes `standInSandbox()`, whose `dockerCommand` runs the stand-in. A
 * spawned CLI, which freezes the seeded `["docker"]` at `new-run`, imports
 * `REDIRECT_PRELOAD` through `NODE_OPTIONS`, which sends its `docker` spawns
 * to the stand-in.
 */

export const STAND_IN = resolve("test", "fixtures", "docker", "docker-stand-in.mjs");
export const REDIRECT_PRELOAD = resolve("test", "fixtures", "docker", "redirect-docker.mjs");
export const STAND_IN_DOCKER_COMMAND = [process.execPath, STAND_IN];
const RECORDED = JSON.parse(readFileSync(resolve("test", "fixtures", "recorded", "docker-cli-outputs.json"), "utf8")) as {
  provenance: { image: { tag: string; imageId: string } };
};
/** The image ID the stand-in reports, recorded from a real build. */
export const STAND_IN_IMAGE_ID = RECORDED.provenance.image.imageId;
export const STAND_IN_STATE = process.env.BW_DOCKER_STAND_IN_STATE ?? join(tmpdir(), "bw-docker-stand-in");

/** The seeded sandbox, frozen against the stand-in. */
export function standInSandbox(overrides: Partial<FrozenSandbox> = {}): FrozenSandbox {
  return { ...seededSandbox(STAND_IN_IMAGE_ID), dockerCommand: [...STAND_IN_DOCKER_COMMAND], ...overrides };
}

/** The `NODE_OPTIONS` value that redirects a spawned process's `docker` to the stand-in. */
export function redirectNodeOptions(existing = ""): string {
  return `${existing} --import=${pathToFileURL(REDIRECT_PRELOAD).href}`.trim();
}

function mark(kind: "unremovable" | "noexit" | "unstartable", prefix: string): string {
  const dir = join(STAND_IN_STATE, "marks");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${kind}-${Buffer.from(prefix).toString("hex").slice(0, 120)}`);
  writeFileSync(path, prefix);
  return path;
}

/** `rm -f` fails, and inspect still finds the container, for every container whose name starts with `prefix`. */
export function markUnremovable(prefix: string): () => void {
  const path = mark("unremovable", prefix);
  return () => rmSync(path, { force: true });
}

/** The exit-status wrapper writes no file for any container whose name starts with `prefix`. */
export function markNoExitStatus(prefix: string): () => void {
  const path = mark("noexit", prefix);
  return () => rmSync(path, { force: true });
}

/** `run -d` fails with exit 125 for every container whose name starts with `prefix`. */
export function markUnstartable(prefix: string): () => void {
  const path = mark("unstartable", prefix);
  return () => rmSync(path, { force: true });
}

/** The name every sandbox of `runId` and `label` in `rootDir` starts with (`createSandbox`). */
export function sandboxPrefix(rootDir: string, runId: number, label: string): string {
  return `bw-${repositoryKey(rootDir)}-${runId}-${label}-`;
}
