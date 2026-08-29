import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SpecDoc {
  feature: string;
  changeKind: "feature" | "defect_fix";
  declaredArtifacts: string[];
  acceptanceCriteria: string[];
}

const CHANGE_KINDS: readonly string[] = ["feature", "defect_fix"];

/**
 * The minimal spec document schema: frontmatter, a declared-artifacts list,
 * and acceptance criteria. Everything else is unvalidated prose — the
 * schema accepts whatever the source never required (hazard 13).
 */
export function validateSpecDoc(
  content: string
): { ok: true; value: SpecDoc } | { ok: false; reason: string } {
  const featureMatch = /^feature:\s*(.+)$/m.exec(content);
  if (!featureMatch || featureMatch[1].trim() === "") {
    return { ok: false, reason: "spec is missing the frontmatter field feature" };
  }
  const changeMatch = /^change_kind:\s*(.+)$/m.exec(content);
  if (!changeMatch || !CHANGE_KINDS.includes(changeMatch[1].trim())) {
    return {
      ok: false,
      reason: `invalid spec change_kind ${changeMatch?.[1]?.trim() ?? "missing"}: allowed values are ${CHANGE_KINDS.join(", ")}`,
    };
  }
  const artifactsSection = section(content, "Declared artifacts");
  if (artifactsSection === null) {
    return { ok: false, reason: "spec is missing the ## Declared artifacts section" };
  }
  const artifacts = artifactsSection
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "");
  if (artifacts.length === 0) {
    return { ok: false, reason: "declared artifacts must not be empty" };
  }
  for (const path of artifacts) {
    if (path.includes("..") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/")) {
      return { ok: false, reason: `declared artifact must be a repo-relative path: ${path}` };
    }
  }
  const criteriaSection = section(content, "Acceptance criteria");
  if (criteriaSection === null) {
    return { ok: false, reason: "spec is missing the ## Acceptance criteria section" };
  }
  const criteria = criteriaSection
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "");
  if (criteria.length === 0) {
    return { ok: false, reason: "acceptance criteria must not be empty" };
  }
  return {
    ok: true,
    value: {
      feature: featureMatch[1].trim(),
      changeKind: changeMatch[1].trim() as "feature" | "defect_fix",
      declaredArtifacts: artifacts,
      acceptanceCriteria: criteria,
    },
  };
}

function section(content: string, title: string): string | null {
  const re = new RegExp(`^## ${title}\\s*\\n`, "m");
  const m = re.exec(content);
  if (!m) return null;
  const tail = content.slice(m.index + m[0].length);
  const next = /^## /m.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

/**
 * The content write: the system writes the spec verbatim after one
 * validation pass, overwriting any previous revision — the gate decides
 * whether the replacement stands. Returns the path and the parsed document
 * so callers never validate twice.
 */
export function writeSpecDoc(rootDir: string, slug: string, content: string): { path: string; doc: SpecDoc } {
  const result = validateSpecDoc(content);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  const path = join(rootDir, "docs", "features", slug, "spec.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { path, doc: result.value };
}
