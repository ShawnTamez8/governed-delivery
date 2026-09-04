import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeText } from "./canonical.ts";
import { artifactDirectoryRefusals, normalizePath } from "./scope.ts";
import { isTaskDocumentPath } from "./task-artifact.ts";

export interface SpecDoc {
  feature: string;
  changeKind: "feature" | "defect_fix";
  declaredArtifacts: string[];
  acceptanceCriteria: AcceptanceCriterion[];
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
}

export const CRITERION_ID_PATTERN = /^AC-(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$/;

export function isCriterionId(value: string): boolean {
  return CRITERION_ID_PATTERN.test(value);
}

export type SpecDocValidationResult =
  | { ok: true; value: SpecDoc }
  | { ok: false; reason: string; obsoleteCriterionShape?: true };

const CHANGE_KINDS: readonly string[] = ["feature", "defect_fix"];

/**
 * The minimal spec document schema: frontmatter, a declared-artifacts list,
 * and acceptance criteria. Everything else is unvalidated prose — the
 * schema accepts whatever the source never required (hazard 13).
 */
export function validateSpecDoc(
  content: string
): SpecDocValidationResult {
  // The same tolerance the spec hash already applies (`normalizeText`): an
  // editor that saves a BOM, or a checkout under `core.autocrlf=true`, must
  // not make a valid spec unparseable. Without this the BOM sits before
  // `feature:` and the failure is reported as a missing frontmatter field.
  const text = normalizeText(content);
  const featureMatch = /^feature:\s*(.+)$/m.exec(text);
  if (!featureMatch || featureMatch[1].trim() === "") {
    return { ok: false, reason: "spec is missing the frontmatter field feature" };
  }
  const changeMatch = /^change_kind:\s*(.+)$/m.exec(text);
  if (!changeMatch || !CHANGE_KINDS.includes(changeMatch[1].trim())) {
    return {
      ok: false,
      reason: `invalid spec change_kind ${changeMatch?.[1]?.trim() ?? "missing"}: allowed values are ${CHANGE_KINDS.join(", ")}`,
    };
  }
  const artifactsSection = section(text, "Declared artifacts");
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
    // A trailing slash marks a directory scope, and delivery (step 8) proves
    // each declared artifact by exact equality with a committed file path —
    // a directory can never equal one. Refuse the shape here rather than
    // letting a spec pass the gates and block at the last stage.
    if (/[\\/]$/.test(path)) {
      return {
        ok: false,
        reason: `declared artifact must be an exact file path, not a directory: ${path}`,
      };
    }
    // Architecture section 14 makes task execution and status database
    // state, not documents. Refuse the declaration at the first deterministic
    // boundary so an old or non-conforming prompt cannot authorize tasks.md
    // and spend the rest of a run on an artifact implementation must reject.
    if (isTaskDocumentPath(path)) {
      return {
        ok: false,
        reason: `declared artifact is prohibited because tasks belong in run-state database rows, not tasks.md: ${path}`,
      };
    }
  }
  const criteriaSection = section(text, "Acceptance criteria");
  if (criteriaSection === null) {
    return { ok: false, reason: "spec is missing the ## Acceptance criteria section" };
  }
  const criterionLines = criteriaSection
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "");
  if (criterionLines.length === 0) {
    return { ok: false, reason: "acceptance criteria must not be empty" };
  }
  const criteria: AcceptanceCriterion[] = [];
  const seenCriterionIds = new Set<string>();
  for (const line of criterionLines) {
    const colon = line.indexOf(":");
    if (colon < 0) {
      return {
        ok: false,
        reason: `acceptance criterion must be '<criterion-id>: <criterion text>': ${line}`,
        obsoleteCriterionShape: true,
      };
    }
    const id = line.slice(0, colon).trim();
    if (!isCriterionId(id) || line.slice(0, colon) !== id) {
      return {
        ok: false,
        reason: `invalid acceptance criterion ID ${id || "missing"}: must match ${CRITERION_ID_PATTERN.source}`,
      };
    }
    const afterColon = line.slice(colon + 1);
    const criterionText = afterColon.trim();
    if (criterionText === "") {
      return { ok: false, reason: `acceptance criterion ${id} has empty text` };
    }
    if (!/^\s/.test(afterColon)) {
      return {
        ok: false,
        reason: `acceptance criterion must be '<criterion-id>: <criterion text>': ${line}`,
      };
    }
    if (seenCriterionIds.has(id)) {
      return { ok: false, reason: `duplicate acceptance criterion ID ${id}` };
    }
    seenCriterionIds.add(id);
    criteria.push({ id, text: criterionText });
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

/**
 * A declared artifact naming one of the run's own documents can never be
 * delivered. `docs/features/<slug>/design.md` is the run's protected input,
 * and `spec.md` and `plan.md` are projections the implementation stage
 * commits before the recorded patch base — every one of them sits outside
 * the range `delivery_check` certifies, so a spec declaring one would pass
 * the gates and then block terminally at the last stage. Refuse the names
 * wherever a spec is written and wherever it is re-read before the
 * operator's signature binds it.
 */
export function runDocumentRefusals(slug: string, artifacts: readonly string[]): string[] {
  const runDocuments = ["design.md", "spec.md", "plan.md"].map(
    (name) => normalizePath(`docs/features/${slug}/${name}`)
  );
  return artifacts.filter((path) => runDocuments.includes(normalizePath(path)));
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
 *
 * `startingCommit` is the tree rule's repository context: when supplied, a
 * declared artifact that names a directory in that commit's tree refuses —
 * delivery (architecture step 8) proves artifacts by exact equality with
 * committed file paths, and a directory can never equal one. The frozen
 * starting commit never includes this run's own projections, so the answer
 * is stable across every revision. A pure text parse must not see a git
 * commit, so the caller passes it only where one exists.
 */
export function writeSpecDoc(
  rootDir: string,
  slug: string,
  content: string,
  startingCommit?: string | null
): { path: string; doc: SpecDoc } {
  const result = validateSpecDoc(content);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  if (startingCommit !== undefined && startingCommit !== null) {
    const tree = artifactDirectoryRefusals(rootDir, startingCommit, result.value.declaredArtifacts);
    if (!tree.ok) {
      throw new Error(tree.reason);
    }
    if (tree.directories.length > 0) {
      throw new Error(
        `declared artifact names a directory in the starting commit tree: ${tree.directories.join(", ")}`
      );
    }
  }
  // The tree rule answers "what exists"; this answers "who writes it". A
  // declaration of the run's own design, spec, or plan document passes the
  // tree rule (an existing file, or a future file in the starting tree) and
  // still can never be delivered in the patch range. Independent of git:
  // whoever writes the spec, the names are undeliverable.
  const runDocuments = runDocumentRefusals(slug, result.value.declaredArtifacts);
  if (runDocuments.length > 0) {
    throw new Error(
      `declared artifact names a document the run itself writes (design, spec, or plan under docs/features/${slug}/): ${runDocuments.join(", ")}`
    );
  }
  const path = join(rootDir, "docs", "features", slug, "spec.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { path, doc: result.value };
}
