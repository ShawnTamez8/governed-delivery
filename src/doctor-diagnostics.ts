import {
  accessSync, closeSync, constants, fstatSync, lstatSync, openSync, readSync, statSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { sha256Hex } from "./canonical.ts";
import type { ExecutorDefinition } from "./executor.ts";

const WINDOWS = process.platform === "win32";

export interface DoctorExecutableLookup {
  env: Readonly<Record<string, string>>;
  cwd: string;
  parentPath?: string;
  /** Presence in the parent, even when its value is empty; not a child env option. */
  noDefaultCurrentDirectoryInExePath?: boolean;
}

function filesystemCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string"
    && /^E[A-Z0-9]+$/.test(error.code)) return error.code;
  return undefined;
}

function resolutionError(command: string, code: string, detail: string, cause?: unknown): Error {
  return Object.assign(
    new Error(`executable resolution ${code} for ${command}: ${detail}`, { cause }),
    { name: "DoctorExecutableResolutionError", code },
  );
}

// libuv v1.52.1 src/win/process.c: search_path accepts either quote style,
// protects semicolons inside a leading quote pair, and does not trim spaces.
function windowsPathEntries(path: string): string[] {
  const entries: string[] = [];
  let start = 0;
  while (start < path.length) {
    let searchFrom = start;
    if (path[start] === '"' || path[start] === "'") {
      const quoteEnd = path.indexOf(path[start], start + 1);
      searchFrom = quoteEnd === -1 ? path.length : quoteEnd;
    }
    const separator = path.indexOf(";", searchFrom);
    const end = separator === -1 ? path.length : separator;
    if (end > start) {
      let entry = path.slice(start, end);
      if (entry.startsWith('"') || entry.startsWith("'")) entry = entry.slice(1);
      if (entry.endsWith('"') || entry.endsWith("'")) entry = entry.slice(0, -1);
      entries.push(entry);
    }
    start = end + 1;
  }
  return entries;
}

export function resolveDoctorExecutable(command: string, context: DoctorExecutableLookup): string {
  if (!isAbsolute(context.cwd)) {
    throw resolutionError(command, "EINVAL", `cwd must be absolute: ${context.cwd}`);
  }
  if (!command || command === ".") {
    throw resolutionError(command, "ENOENT", "empty executable name");
  }
  const pathBearing = WINDOWS ? /[\\/:]/.test(command) : command.includes("/");
  const basename = WINDOWS ? command.slice(Math.max(
    command.lastIndexOf("\\"), command.lastIndexOf("/"), command.lastIndexOf(":"),
  ) + 1) : command;
  const firstDot = basename.indexOf(".");
  const hasExtension = firstDot !== -1 && firstDot < basename.length - 1;
  // path_search_walk_ext tries an explicit extension, then appends .com/.exe.
  // PATHEXT is deliberately irrelevant to direct native execution.
  const suffixes = WINDOWS
    ? [...(hasExtension ? [""] : []), `${basename.endsWith(".") ? "" : "."}com`,
      `${basename.endsWith(".") ? "" : "."}exe`]
    : [""];
  const path = context.env.PATH ?? (WINDOWS ? context.parentPath ?? "" : "/usr/bin:/bin");
  const directories = pathBearing ? [""]
    : WINDOWS
      ? [...(context.noDefaultCurrentDirectoryInExePath ? [] : [""]), ...windowsPathEntries(path)]
      : path.split(":");
  let denied = false;
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = resolve(context.cwd, directory, command + suffix);
      try {
        // Node stat adds \\?\ to ordinary paths, bypassing the Win32
        // normalization used by libuv's GetFileAttributesW search. The DOS
        // device namespace keeps that normalization without rewriting the
        // selected spelling; explicitly supplied device paths stay intact.
        const attributePath = WINDOWS && !/^\\\\[?.]\\/.test(candidate)
          ? candidate.startsWith("\\\\") ? `\\\\.\\UNC\\${candidate.slice(2)}` : `\\\\.\\${candidate}`
          : candidate;
        const stats = statSync(attributePath);
        if (WINDOWS) {
          if (!stats.isDirectory()) return candidate;
        } else if (stats.isFile()) {
          accessSync(candidate, constants.X_OK);
          return candidate;
        } else {
          denied = true;
        }
      } catch (error) {
        const code = filesystemCode(error);
        if (code === undefined) throw error;
        // Windows attribute lookup failures are skipped; CreateProcess failure
        // happens only after selection and must never cause a second selection.
        if (WINDOWS || code === "ENOENT" || code === "ENOTDIR") continue;
        if (code === "EACCES" || code === "EPERM") {
          denied = true;
          continue;
        }
        throw resolutionError(command, code, `stat/access ${candidate}`, error);
      }
    }
  }
  throw resolutionError(command, denied ? "EACCES" : "ENOENT", `not found from cwd ${context.cwd}`);
}

export const DOCTOR_OBSERVATION_NAMES = [
  "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_BASE_URL", "CLAUDE_CONFIG_DIR",
] as const;
const ENVIRONMENT_HASH_NAMES = new Set([
  "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot",
]);
export const DOCTOR_CONFIG_MAX_BYTES = 1024 * 1024;

export interface ConfigFileObservation {
  name: "user_settings" | "user_state";
  path: string | null;
  state: "readable" | "absent" | "unavailable";
  sizeBytes: number | null;
  contentHash: string | null;
  reason: string | null;
}

export interface AmbientProviderConfig {
  environment: { name: string; present: boolean; passedToChild: boolean; valueHash: string | null }[];
  homeVariable: "USERPROFILE" | "HOME";
  files: ConfigFileObservation[];
}

function fileFailure(
  observation: ConfigFileObservation, operation: string, error: unknown,
): ConfigFileObservation {
  const code = filesystemCode(error);
  if (code === undefined) throw error;
  observation.state = operation === "lstat" && code === "ENOENT" ? "absent" : "unavailable";
  observation.contentHash = null;
  observation.reason = observation.state === "absent" ? null : `${operation} ${code}: ${observation.path}`;
  return observation;
}

function stableMetadata(before: Stats, after: Stats): boolean {
  return before.size === after.size && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs && before.dev === after.dev && before.ino === after.ino;
}

function observeConfigFile(
  name: ConfigFileObservation["name"], path: string | null, homeReason: string | null,
): ConfigFileObservation {
  const observation: ConfigFileObservation = {
    name, path, state: "unavailable", sizeBytes: null, contentHash: null, reason: homeReason,
  };
  if (path === null) return observation;
  let listed: Stats;
  try {
    listed = lstatSync(path);
  } catch (error) {
    return fileFailure(observation, "lstat", error);
  }
  if (listed.isSymbolicLink()) {
    observation.reason = `leaf symlink is not observed: ${path}`;
    return observation;
  }
  if (!listed.isFile()) {
    observation.reason = `unsupported non-regular file type: ${path}`;
    return observation;
  }
  observation.sizeBytes = listed.size;
  if (listed.size > DOCTOR_CONFIG_MAX_BYTES) {
    observation.reason = `size exceeds ${DOCTOR_CONFIG_MAX_BYTES}-byte ceiling: ${path}`;
    return observation;
  }
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    return fileFailure(observation, "open", error);
  }
  try {
    let before: Stats;
    try {
      before = fstatSync(descriptor);
    } catch (error) {
      return fileFailure(observation, "fstat before read", error);
    }
    if (!before.isFile()) {
      observation.reason = `unsupported non-regular opened descriptor: ${path}`;
      return observation;
    }
    observation.sizeBytes = before.size;
    if (before.size > DOCTOR_CONFIG_MAX_BYTES) {
      observation.reason = `size exceeds ${DOCTOR_CONFIG_MAX_BYTES}-byte ceiling: ${path}`;
      return observation;
    }
    if (!stableMetadata(listed, before)) {
      observation.reason = `file changed before read: ${path}`;
      return observation;
    }
    const bytes = Buffer.alloc(DOCTOR_CONFIG_MAX_BYTES + 1);
    let count = 0;
    let eof = false;
    while (count < bytes.length) {
      let read: number;
      try {
        read = readSync(descriptor, bytes, count, bytes.length - count, null);
      } catch (error) {
        return fileFailure(observation, "read", error);
      }
      if (read === 0) {
        eof = true;
        break;
      }
      count += read;
    }
    let after: Stats;
    try {
      after = fstatSync(descriptor);
    } catch (error) {
      return fileFailure(observation, "fstat after read", error);
    }
    if (!after.isFile()) {
      observation.reason = `unsupported non-regular opened descriptor after read: ${path}`;
      return observation;
    }
    observation.sizeBytes = after.size;
    if (count > DOCTOR_CONFIG_MAX_BYTES || after.size > DOCTOR_CONFIG_MAX_BYTES) {
      observation.reason = `size exceeds ${DOCTOR_CONFIG_MAX_BYTES}-byte ceiling: ${path}`;
      return observation;
    }
    if (!stableMetadata(before, after)) {
      observation.reason = `file changed during read: ${path}`;
      return observation;
    }
    if (!eof || count !== after.size) {
      observation.reason = `incomplete read: EOF/byte count ${count} does not match stable size ${after.size}: ${path}`;
      return observation;
    }
    observation.state = "readable";
    observation.contentHash = sha256Hex(bytes.subarray(0, count));
    observation.reason = null;
    return observation;
  } finally {
    try {
      closeSync(descriptor);
    } catch (error) {
      fileFailure(observation, "close", error);
    }
  }
}

export function collectAmbientProviderConfig(
  executor: ExecutorDefinition, ambientSnapshot: NodeJS.ProcessEnv, childEnv: Readonly<Record<string, string>>,
): AmbientProviderConfig {
  const names = [...new Set([...executor.sandbox.envPassthrough, ...DOCTOR_OBSERVATION_NAMES])].sort();
  const environment = names.map((name) => {
    const value = ambientSnapshot[name];
    return {
      name, present: value !== undefined, passedToChild: Object.hasOwn(childEnv, name),
      valueHash: value !== undefined && ENVIRONMENT_HASH_NAMES.has(name) ? sha256Hex(value) : null,
    };
  });
  const homeVariable = WINDOWS ? "USERPROFILE" : "HOME";
  const home = Object.hasOwn(childEnv, homeVariable) ? childEnv[homeVariable] : undefined;
  const usableHome = home !== undefined && home !== "" && isAbsolute(home);
  const homeReason = usableHome ? null : `unavailable home: passed-through ${homeVariable} must be non-empty and absolute`;
  return {
    environment, homeVariable,
    files: [
      observeConfigFile("user_settings", usableHome ? join(home, ".claude", "settings.json") : null, homeReason),
      observeConfigFile("user_state", usableHome ? join(home, ".claude.json") : null, homeReason),
    ],
  };
}
