import { readFileSync } from "node:fs";
import { isAbsolute, normalize, parse, resolve } from "node:path";
import { UsageError } from "./cli-args.ts";

export interface DashboardRepository {
  path: string;
  normalizedPath: string;
}

function pathIdentity(path: string): string {
  const normalized = normalize(path);
  const root = parse(normalized).root;
  let end = normalized.length;
  while (end > root.length && (normalized[end - 1] === "\\" || normalized[end - 1] === "/")) end--;
  const withoutTrailingSeparators = normalized.slice(0, end);
  return process.platform === "win32" ? withoutTrailingSeparators.toLowerCase() : withoutTrailingSeparators;
}

export function loadDashboardRepositories(
  repositoriesFile: string,
  invocationDirectory: string,
): DashboardRepository[] {
  const filePath = resolve(invocationDirectory, repositoriesFile);
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new UsageError(
      `cannot read repositories file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  contents = contents.replace(/^\uFEFF/, "");
  if (contents === "") throw new UsageError(`repositories file is empty: ${filePath}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new UsageError(
      `repositories file ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`repositories file ${filePath} must contain an object with exactly one repositories member`);
  }
  const members = Object.keys(parsed);
  if (members.length !== 1 || members[0] !== "repositories") {
    throw new UsageError(`repositories file ${filePath} must contain exactly one repositories member`);
  }
  const repositories = (parsed as { repositories?: unknown }).repositories;
  if (!Array.isArray(repositories)) {
    throw new UsageError(`repositories member in ${filePath} must be an array`);
  }
  if (repositories.length === 0) {
    throw new UsageError(`repositories member in ${filePath} must contain at least one absolute path`);
  }

  const seen = new Set<string>();
  return repositories.map((submitted, index) => {
    if (typeof submitted !== "string" || submitted.trim() === "") {
      throw new UsageError(`repositories[${index}] in ${filePath} must be a non-empty string`);
    }
    if (!isAbsolute(submitted)) {
      throw new UsageError(`repositories[${index}] in ${filePath} must be an absolute path: ${submitted}`);
    }
    const normalizedPath = pathIdentity(submitted);
    if (seen.has(normalizedPath)) {
      throw new UsageError(`repositories member in ${filePath} contains duplicate normalized path: ${submitted}`);
    }
    seen.add(normalizedPath);
    return { path: submitted, normalizedPath };
  });
}
