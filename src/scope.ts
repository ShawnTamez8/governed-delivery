/**
 * The paths a run may touch and the paths nothing may touch. Extracted from
 * the spec stage because the approval gate is a second real consumer: it
 * recomputes both the scope the operator signs and the risk that sizes the
 * panel (hard rule 4 — the second case exists, so the interface is extracted
 * now and not before).
 */

export const PROTECTED_PATH_PREFIXES: readonly string[] = [
  "src/agents/",
  "src/executor.ts",
  "governed.yaml",
  ".governance/",
];

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * The comparison is case-folded. On Windows and macOS `Src/Agents/x.ts` and
 * `src/agents/x.ts` name the same file, so an exact-case prefix test lets a
 * declared artifact evade the guard and take the risk score down with it.
 * Folding costs nothing on a case-sensitive filesystem: it can only ever
 * protect a path that would not have been protected, never the reverse.
 * `computeScope` deliberately does not fold — the operator signs the paths
 * as the spec declared them.
 */
export function touchesProtected(artifacts: string[], slug: string): boolean {
  const designPath = `docs/features/${slug}/design.md`.toLowerCase();
  return artifacts.some((a) => {
    const p = normalizePath(a).toLowerCase();
    return (
      PROTECTED_PATH_PREFIXES.some((prefix) => p.startsWith(prefix.toLowerCase())) ||
      p === designPath
    );
  });
}

/**
 * The scope the operator signs (architecture section 12): the set of paths
 * the spec declares, normalized, deduplicated, and ordered. Sorting is what
 * makes the signed payload independent of the order the author happened to
 * list them in.
 */
export function computeScope(declaredArtifacts: string[]): string[] {
  return [...new Set(declaredArtifacts.map(normalizePath))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
}
