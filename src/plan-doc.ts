import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeText } from "./canonical.ts";
import { runDocumentDir } from "./paths.ts";
import { CRITERION_ID_PATTERN, isCriterionId } from "./spec-doc.ts";

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
  criterionId: string;
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
  /**
   * Every non-empty line of `## Tasks`, trimmed, with a leading `-` removed.
   * This is the plan gate's unit: `planNormativeNodes` makes one normative node
   * of each, so a reworded or removed nested line still needs a claim
   * (hazard 17). It is not the unit a phase is counted in; that is `taskItems`.
   */
  tasks: string[];
  /**
   * The same section grouped into items, the unit the implementation stage
   * counts against its ceiling and splits into phases (hazard 20). A line at
   * the section's smallest indentation starts an item; a deeper line joins the
   * item above it, on its own line and keeping its indentation relative to the
   * item. A plan whose lines are all at one indentation has one item per line,
   * so `taskItems` equals `tasks`.
   */
  taskItems: string[];
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
  const checkboxTask = tasksSection
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^(?:[-*+]\s+)?\[[ xX]\](?:\s|$)/.test(line));
  if (checkboxTask !== undefined) {
    return {
      ok: false,
      reason: `plan task must be a plain list item, not a status checkbox; completion state belongs in the run database: ${checkboxTask}`,
    };
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
    // The delimiter is the *first* `->`. The left side is a constrained
    // criterion ID that can never contain an arrow, while the right side may
    // carry free prose (a not_applicable rationale citing "the a->b mapping").
    // Splitting at the last arrow would break inside that prose and refuse a
    // valid document; splitting at the first cannot mis-accept, because a
    // prose-led left side still fails the ID check below.
    const arrow = line.indexOf("->");
    if (arrow < 0) {
      return {
        ok: false,
        reason: `coverage entry must be '<criterion-id> -> <artifact>' or '<criterion-id> -> not_applicable: <rationale> / <alternative verification>': ${line}`,
      };
    }
    const criterionId = line.slice(0, arrow).trim();
    const target = line.slice(arrow + 2).trim();
    if (criterionId === "" || target === "") {
      return {
        ok: false,
        reason: `coverage entry must name a criterion ID and a target: ${line}`,
      };
    }
    if (!isCriterionId(criterionId)) {
      return {
        ok: false,
        reason: `coverage entry criterion ID is invalid: ${criterionId}; must match ${CRITERION_ID_PATTERN.source}`,
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
          reason: `coverage entry for ${criterionId} says not_applicable without both a rationale and an alternative verification`,
        };
      }
      coverage.push({ criterionId, artifact: null, rationale, alternativeVerification: alternative });
      continue;
    }
    coverage.push({ criterionId, artifact: target, rationale: null, alternativeVerification: null });
  }

  return {
    ok: true,
    value: {
      feature: featureMatch[1].trim(),
      planFor,
      tasks,
      taskItems: groupTaskItems(tasksSection),
      coverage,
    },
  };
}

/**
 * One slice of the approved plan's task list, handed to one implementer
 * dispatch. `index` and `firstTask` are 1-based: phase 2 of 6 starting at task
 * 11 covers tasks 11 through 20.
 */
export interface PlanPhase {
  index: number;
  count: number;
  firstTask: number;
  tasks: string[];
}

/**
 * Split a validated plan's tasks into consecutive phases of `phaseSize`, in
 * plan order, the last phase taking the remainder. The unit is whatever the
 * caller passes: the implementation stage passes `PlanDoc.taskItems`, so a phase
 * never cuts an item and a nested sub-bullet travels with its parent. The plan
 * gate counts every line as a normative node (`PlanDoc.tasks`), so a phase
 * boundary and a normative node are different units. No model is involved: the
 * split is arithmetic over the list, which is why a plan edited after its gate
 * is caught by the existing plan-hash check, not here.
 *
 * Callers pass validated input (`validatePlanDoc` refuses an empty task list,
 * and the frozen policy refuses a non-positive phase size), so a throw here is
 * a programming error, not a path an operator reaches.
 */
export function planPhases(tasks: readonly string[], phaseSize: number): PlanPhase[] {
  if (!Number.isInteger(phaseSize) || phaseSize < 1) {
    throw new Error(`phase size must be a positive integer, found ${JSON.stringify(phaseSize)}`);
  }
  if (tasks.length === 0) {
    throw new Error("cannot split an empty task list into phases");
  }
  const count = Math.ceil(tasks.length / phaseSize);
  const phases: PlanPhase[] = [];
  for (let index = 1; index <= count; index += 1) {
    const start = (index - 1) * phaseSize;
    phases.push({
      index,
      count,
      firstTask: start + 1,
      tasks: tasks.slice(start, start + phaseSize),
    });
  }
  return phases;
}

/** A list line's text: trimmed, with a leading `-` removed. A bare `-` has none. */
function itemText(line: string): string {
  return line.trim().replace(/^-\s*/, "");
}

function listItems(sectionText: string): string[] {
  return sectionText
    .split("\n")
    .map(itemText)
    .filter((line) => line !== "");
}

/**
 * Group a `## Tasks` section into items. A line with text at the section's
 * smallest indentation starts an item, with its indentation and leading `-`
 * removed. A deeper line is appended to the current item after a newline,
 * keeping the indentation it has beyond that smallest one, so the item renders
 * as a nested list under its first line. A deeper line before any item starts
 * one rather than being dropped. A line without text (blank, or a bare `-`) is
 * skipped exactly as `listItems` skips it, so a flat plan has one item per
 * task. Callers pass a section with at least one line that has text.
 */
function groupTaskItems(sectionText: string): string[] {
  const lines = sectionText.split("\n").filter((line) => itemText(line) !== "");
  const indentOf = (line: string): number => line.length - line.trimStart().length;
  const base = Math.min(...lines.map(indentOf));
  const items: string[] = [];
  for (const line of lines) {
    if (indentOf(line) <= base || items.length === 0) {
      items.push(itemText(line));
    } else {
      items[items.length - 1] += `\n${line.slice(base).trimEnd()}`;
    }
  }
  return items;
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
 * replacement stands. Mirrors `writeSpecDoc`: the file goes under the run's
 * own governance directory, and the returned absolute path is what a stage
 * stores as `output_ref`.
 *
 * The implementation stage commits a copy to `docs/features/<slug>/plan.md`
 * on the run branch, which is also where a human-authored implementation plan
 * lives for this repository's own work. The path is deliberately the same one
 * a person would reach for, because a governed plan is the same kind of
 * document.
 */
export function writePlanDoc(
  rootDir: string,
  runId: number,
  content: string
): { path: string; doc: PlanDoc } {
  const result = validatePlanDoc(content);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  const dir = runDocumentDir(rootDir, runId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "plan.md");
  writeFileSync(path, content);
  return { path, doc: result.value };
}
