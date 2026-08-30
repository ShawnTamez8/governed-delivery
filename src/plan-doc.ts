import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeText } from "./canonical.ts";

/**
 * One acceptance criterion and how the plan proposes to cover it.
 *
 * Either `artifact` names the thing that will cover it, or the entry is a
 * `not_applicable` decision carrying both a rationale and an alternative
 * verification. Section 8 requires both halves of that decision: a rationale
 * alone is an excuse, and an alternative alone is unexplained. Exactly one of
 * `artifact` / (`rationale` + `alternativeVerification`) is populated.
 */
export interface CoverageEntry {
  criterion: string;
  artifact: string | null;
  rationale: string | null;
  alternativeVerification: string | null;
}

export interface PlanDoc {
  feature: string;
  /**
   * The content hash of the specification this plan was written from, as
   * `sha256Hex(normalizeText(specContent))` — the same pair the
   * `spec.gate.pass` event and the approval payload use. It is what binds a
   * plan to the specification the operator actually authorized.
   */
  planFor: string;
  tasks: string[];
  coverage: CoverageEntry[];
}

/**
 * The minimal plan document schema: frontmatter, a task list, and a coverage
 * list. Everything else is unvalidated prose.
 *
 * Presence and shape only. Hazard 13 warns against a validator inventing
 * obligations the source never stated, so this refuses a document that is
 * missing a required part or malformed — never one whose content it merely
 * disagrees with.
 */
export function validatePlanDoc(
  content: string
): { ok: true; value: PlanDoc } | { ok: false; reason: string } {
  // The same tolerance `validateSpecDoc` applies, for the same reason: a BOM
  // from an editor or a CRLF checkout must not make a valid document
  // unparseable and get reported as a missing field.
  const text = normalizeText(content);

  const featureMatch = /^feature:\s*(.+)$/m.exec(text);
  if (!featureMatch || featureMatch[1].trim() === "") {
    return { ok: false, reason: "plan is missing the frontmatter field feature" };
  }
  const planForMatch = /^plan_for:\s*(.+)$/m.exec(text);
  if (!planForMatch || planForMatch[1].trim() === "") {
    return { ok: false, reason: "plan is missing the frontmatter field plan_for" };
  }
  const planFor = planForMatch[1].trim();
  if (!/^[0-9a-f]{64}$/.test(planFor)) {
    return {
      ok: false,
      reason: `plan_for must be a 64-character sha256 hex digest of the specification: ${planFor}`,
    };
  }

  const tasksSection = section(text, "Tasks");
  if (tasksSection === null) {
    return { ok: false, reason: "plan is missing the ## Tasks section" };
  }
  const tasks = listItems(tasksSection);
  if (tasks.length === 0) {
    return { ok: false, reason: "tasks must not be empty" };
  }

  const coverageSection = section(text, "Coverage");
  if (coverageSection === null) {
    return { ok: false, reason: "plan is missing the ## Coverage section" };
  }
  const coverageLines = listItems(coverageSection);
  if (coverageLines.length === 0) {
    return { ok: false, reason: "coverage must not be empty" };
  }

  const coverage: CoverageEntry[] = [];
  for (const line of coverageLines) {
    // The delimiter is the *last* `->`: criterion prose may legitimately
    // contain an arrow ("the a->b mapping works"), but the artifact path —
    // the tail — is where the split belongs. Splitting at the first arrow
    // truncated that criterion and fabricated an artifact from its tail.
    const arrow = line.lastIndexOf("->");
    if (arrow < 0) {
      return {
        ok: false,
        reason: `coverage entry must be '<criterion> -> <artifact>' or '<criterion> -> not_applicable: <rationale> / <alternative verification>': ${line}`,
      };
    }
    const criterion = line.slice(0, arrow).trim();
    const target = line.slice(arrow + 2).trim();
    if (criterion === "" || target === "") {
      return {
        ok: false,
        reason: `coverage entry must name a criterion and a target: ${line}`,
      };
    }
    // The prefix test is the decision form `not_applicable:` (spacing before
    // the colon tolerated) — a bare `not_applicable` is a decision with no
    // body and stays refused, but an artifact path that merely begins with
    // the word (`not_applicable.test.ts`) is a path, not a decision.
    if (target === "not_applicable" || /^not_applicable\s*:/.test(target)) {
      // `not_applicable: <rationale> / <alternative verification>` — both
      // halves required, so a bare `not_applicable` cannot silently drop a
      // criterion.
      const body = target === "not_applicable" ? "" : target.replace(/^not_applicable\s*:\s*/, "").trim();
      // The delimiter is the *last* ` / `: the rationale is prose and may
      // cite paths ("no check in test/unit/a.test.ts yet"), and splitting at
      // the first slash corrupted both halves while both still validated.
      const slash = body.lastIndexOf(" / ");
      const rationale = slash < 0 ? "" : body.slice(0, slash).trim();
      const alternative = slash < 0 ? "" : body.slice(slash + 3).trim();
      if (rationale === "" || alternative === "") {
        return {
          ok: false,
          reason: `coverage entry for ${criterion} says not_applicable without both a rationale and an alternative verification`,
        };
      }
      coverage.push({ criterion, artifact: null, rationale, alternativeVerification: alternative });
      continue;
    }
    coverage.push({ criterion, artifact: target, rationale: null, alternativeVerification: null });
  }

  return {
    ok: true,
    value: { feature: featureMatch[1].trim(), planFor, tasks, coverage },
  };
}

function listItems(sectionText: string): string[] {
  return sectionText
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "");
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
 * The content write: validate once, then write the document verbatim,
 * overwriting any previous revision — the gate decides whether the
 * replacement stands. Mirrors `writeSpecDoc`.
 *
 * `docs/features/<slug>/plan.md` is also where a human-authored
 * implementation plan lives for this repository's own work. The system owns
 * the file for a governed run and the two never share a slug, so there is no
 * collision — but the path is deliberately the same one a person would reach
 * for, because a governed plan is the same kind of document.
 */
export function writePlanDoc(
  rootDir: string,
  slug: string,
  content: string
): { path: string; doc: PlanDoc } {
  const result = validatePlanDoc(content);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  const path = join(rootDir, "docs", "features", slug, "plan.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { path, doc: result.value };
}
