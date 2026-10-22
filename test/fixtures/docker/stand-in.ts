import { createHash } from "node:crypto";
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

/**
 * Answer the acceptance command, in every container whose name starts with
 * `prefix`, from `test/fixtures/recorded/acceptance-report-<report>.json`.
 */
export function serveAcceptanceReport(prefix: string, report: string): () => void {
  const dir = join(STAND_IN_STATE, "marks");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `acceptance-${Buffer.from(prefix).toString("hex").slice(0, 120)}`);
  writeFileSync(path, JSON.stringify({ prefix, report }));
  return () => rmSync(path, { force: true });
}

/**
 * Answer the reproduction command for `fileName` (every file when undefined), in
 * every container whose name starts with `prefix`, from
 * `test/fixtures/recorded/<report>.json`: a `reproduction-report-*` or a plan 1
 * `acceptance-report-*`. `exitStatus` and `delayMs` replace the recorded exit
 * and its timing; `writeFile` names a file the run writes into its checkout;
 * `noExit` writes no exit status for this command alone, as `markNoExitStatus`
 * does for a whole container.
 */
export function serveReproduction(
  prefix: string,
  fileName: string | undefined,
  report: string,
  options: { exitStatus?: number; delayMs?: number; writeFile?: string; noExit?: boolean } = {}
): () => void {
  const dir = join(STAND_IN_STATE, "marks");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `reproduction-${createHash("sha256").update(`${prefix}|${fileName ?? ""}`).digest("hex")}`);
  writeFileSync(path, JSON.stringify({ prefix, fileName, report, ...options }));
  return () => rmSync(path, { force: true });
}

/** Every reproduction run the stand-in answered for a container whose name starts with `prefix`. */
export function reproductionRuns(prefix: string): { container: string; cwd: string; path: string }[] {
  let lines: string[];
  try {
    lines = readFileSync(join(STAND_IN_STATE, "reproduction-runs.jsonl"), "utf8").split("\n");
  } catch {
    return [];
  }
  return lines.filter((l) => l !== "").map((l) => JSON.parse(l)).filter((r) => r.container.startsWith(prefix));
}

/** Every acceptance run the stand-in answered for a container whose name starts with `prefix`. */
export function acceptanceRuns(prefix: string): { container: string; cwd: string; indexHtml: string | null }[] {
  let lines: string[];
  try {
    lines = readFileSync(join(STAND_IN_STATE, "acceptance-runs.jsonl"), "utf8").split("\n");
  } catch {
    return [];
  }
  return lines.filter((l) => l !== "").map((l) => JSON.parse(l)).filter((r) => r.container.startsWith(prefix));
}

/**
 * A Docker command that runs the stand-in after appending each call's argv,
 * one JSON array per line, to a log in `dir`, and a reader for that log.
 */
export function recordingDockerCommand(dir: string): { dockerCommand: string[]; calls: () => string[][] } {
  const log = join(dir, "docker-argv.log");
  const recorder = join(dir, "record-docker.mjs");
  writeFileSync(
    recorder,
    [
      'import { appendFileSync } from "node:fs";',
      `appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
      `await import(${JSON.stringify(pathToFileURL(STAND_IN).href)});`,
      "",
    ].join("\n")
  );
  const calls = (): string[][] => {
    let text: string;
    try {
      text = readFileSync(log, "utf8");
    } catch {
      return [];
    }
    return text.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]);
  };
  return { dockerCommand: [process.execPath, recorder], calls };
}

/** Each work container a `run -d` call started, by name, with its `-v` values in argv order. */
export function workContainerMounts(calls: string[][]): { name: string; mounts: string[] }[] {
  return calls
    .filter((c) => c[0] === "run" && c.includes("-d"))
    .map((c) => ({ name: c[c.indexOf("--name") + 1]!, mounts: c.flatMap((a, i) => (a === "-v" ? [c[i + 1]!] : [])) }))
    .filter((r) => r.name.endsWith("-work"));
}

/**
 * The read-only `-v` value for `suiteDir` in the work container `workName`: the
 * copy of the committed suite beside the worktree under
 * `.governance/acceptance/<run>/mounts/<sandbox name>/`, never the worktree
 * (docs/features/protected-acceptance-tests/plan.md, Task 12).
 */
export function committedSuiteMount(rootDir: string, runId: number, workName: string, suiteDir: string): string {
  const trimmed = suiteDir.replace(/\/$/, "");
  return `${join(rootDir, ".governance", "acceptance", String(runId), "mounts", workName.replace(/-work$/, ""), trimmed)}:/work/${trimmed}:ro`;
}

/** The name every sandbox of `runId` and `label` in `rootDir` starts with (`createSandbox`). */
export function sandboxPrefix(rootDir: string, runId: number, label: string): string {
  return `bw-${repositoryKey(rootDir)}-${runId}-${label}-`;
}
