import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "./canonical.ts";
import { proposalEvidenceDir, proposalEvidenceRef } from "./paths.ts";
import { upstreamPrefixFor } from "./reconciliation.ts";
import { computeScope } from "./scope.ts";
import type { SpecDoc } from "./spec-doc.ts";

/**
 * Splitting a design too large for one run into features built one after
 * another (`docs/features/design-split-into-features/plan.md`; operator decision
 * 2026-10-12). One format, one validator and one renderer: the spec author
 * proposes the split, this module checks it against the reviewed specification,
 * the operator approves or denies it, and an approved split becomes one stored
 * proposal per feature whose text BuildWorks renders here, never a model.
 */

export interface DesignSplitPiece {
  slug: string;
  title: string;
  criteria: string[];
  declaredArtifacts: string[];
  /** 1-based indexes of earlier pieces this one builds on. */
  dependsOn: number[];
}

export interface DesignSplit {
  pieces: DesignSplitPiece[];
  rationale: string;
}

/**
 * The split finding's intent key. A reviewer may report the same key, so no
 * reader finds the split by it: the `spec.split.record` event names the finding
 * (`readSplitRecord`).
 */
export const DESIGN_SPLIT_INTENT = "design-split";

/**
 * The split finding's location. A reviewer's upstream location is the prefix
 * and one kebab-case key (`validateReviewerReports`), so the colon after
 * `split` keeps a reviewer's finding from ever sharing this identity and
 * absorbing the split's report, decision and question.
 */
export const DESIGN_SPLIT_LOCATION = `${upstreamPrefixFor("design")}split:proposed`;

/** The split the spec stage recorded, read from the run's last `spec.split.record` event. */
export interface SplitRecord {
  findingId: number;
  evidenceRef: string;
  evidenceHash: string;
}

/**
 * The run's recorded split, or null when spec review proposed none. The event
 * is written by the system, so it, not the finding's intent key, says which
 * question is the split's.
 */
export function readSplitRecord(events: readonly { action: string; summary: string }[]): SplitRecord | null {
  const record = events.filter((e) => e.action === "spec.split.record").at(-1);
  if (record === undefined) return null;
  const fields = new Map(
    record.summary.split("; ").map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)])
  );
  const findingId = Number(fields.get("finding"));
  const evidenceRef = fields.get("evidence");
  const evidenceHash = fields.get("evidenceHash");
  if (!Number.isInteger(findingId) || findingId < 1 || evidenceRef === undefined || evidenceHash === undefined) return null;
  return { findingId, evidenceRef, evidenceHash };
}

/**
 * The approved split's slug for each stored proposal, from the run's last
 * `spec_decision.split.approve` event (`proposals=<ids>; slugs=<slugs>`, in
 * piece order). Empty when no split was approved.
 */
export function readSplitApproval(events: readonly { action: string; summary: string }[]): Map<number, string> {
  const approval = events.filter((e) => e.action === "spec_decision.split.approve").at(-1);
  const slugs = new Map<number, string>();
  const match = approval === undefined ? null : /^proposals=([0-9,]+); slugs=([a-z0-9,-]+)$/.exec(approval.summary);
  if (match === null) return slugs;
  const ids = match[1]!.split(",").map(Number);
  const names = match[2]!.split(",");
  if (ids.length !== names.length) return slugs;
  ids.forEach((id, i) => slugs.set(id, names[i]!));
  return slugs;
}

/**
 * The fewest pieces a valid split can have: at least two, and enough that none
 * declares more than `threshold` files.
 */
export function minimumSplitPieces(declaredCount: number, threshold: number): number {
  return Math.max(2, Math.ceil(declaredCount / threshold));
}

/**
 * Whether any split can pass `validateDesignSplit`: every piece needs its own
 * criterion, so a spec with fewer criteria than `minimumSplitPieces` has no
 * valid split, and the dispatch is not worth paying for.
 */
export function splitIsPossible(criteriaCount: number, declaredCount: number, threshold: number): boolean {
  return criteriaCount >= minimumSplitPieces(declaredCount, threshold);
}

/**
 * The directory names under the target's `docs/features/`, lowercased: a new
 * feature's slug may not reuse one in any case, because on a case-insensitive
 * filesystem (Windows) `Crew-Core` and `crew-core` are the same directory.
 */
export function featureSlugsInUse(rootDir: string): string[] {
  return [
    ...new Set(
      readdirSync(join(rootDir, "docs", "features"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name.toLowerCase())
    ),
  ].sort();
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SPLIT_KEYS = ["pieces", "rationale"];
const PIECE_KEYS = ["slug", "title", "criteria", "declaredArtifacts", "dependsOn"];

export type DesignSplitResult = { ok: true; value: DesignSplit } | { ok: false; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Check a proposed split against the reviewed specification, strictly, and
 * name the first rule it breaks. It checks coverage and direction only: every
 * criterion in exactly one piece, every declared file in at least one, each
 * piece within the per-feature file limit, and each piece building only on
 * earlier ones. Whether a piece's criteria need code a later piece writes is
 * beyond any check here; the operator decides that.
 */
export function validateDesignSplit(
  value: unknown,
  ctx: { spec: SpecDoc; runSlug: string; slugsInUse: readonly string[]; maxPathsPerPiece: number }
): DesignSplitResult {
  const refuse = (reason: string): DesignSplitResult => ({ ok: false, reason: `design split refused: ${reason}` });
  if (!isObject(value)) return refuse("the split must be an object with pieces and rationale");
  const extra = Object.keys(value).filter((k) => !SPLIT_KEYS.includes(k));
  if (extra.length > 0) return refuse(`unknown key(s) ${extra.join(", ")}`);
  const raw = value.pieces;
  if (!Array.isArray(raw)) return refuse("pieces must be an array");
  if (raw.length < 2) return refuse(`a split needs at least 2 pieces, found ${raw.length}`);
  const pieces: DesignSplitPiece[] = [];
  for (const [i, piece] of raw.entries()) {
    const k = i + 1;
    if (!isObject(piece)) return refuse(`piece ${k} must be an object`);
    const pieceExtra = Object.keys(piece).filter((key) => !PIECE_KEYS.includes(key));
    if (pieceExtra.length > 0) return refuse(`piece ${k} has unknown key(s) ${pieceExtra.join(", ")}`);
    const { slug, title, criteria, declaredArtifacts, dependsOn } = piece;
    if (typeof slug !== "string") return refuse(`piece ${k} slug must be a string`);
    if (typeof title !== "string") return refuse(`piece ${k} title must be a string`);
    if (!isStringArray(criteria)) return refuse(`piece ${k} criteria must be an array of strings`);
    if (!isStringArray(declaredArtifacts)) return refuse(`piece ${k} declaredArtifacts must be an array of strings`);
    if (!Array.isArray(dependsOn)) return refuse(`piece ${k} dependsOn must be an array`);
    pieces.push({ slug, title, criteria, declaredArtifacts, dependsOn: dependsOn as number[] });
  }

  const seen = new Set<string>();
  for (const [i, piece] of pieces.entries()) {
    const k = i + 1;
    if (!SLUG.test(piece.slug)) return refuse(`piece ${k} slug ${JSON.stringify(piece.slug)} is not lowercase kebab-case`);
    if (seen.has(piece.slug)) return refuse(`piece ${k} slug ${piece.slug} is used by an earlier piece`);
    if (piece.slug === ctx.runSlug) return refuse(`piece ${k} slug ${piece.slug} is this run's own slug`);
    if (ctx.slugsInUse.some((used) => used.toLowerCase() === piece.slug)) {
      return refuse(`piece ${k} slug ${piece.slug} is already a directory under docs/features/`);
    }
    seen.add(piece.slug);
  }
  for (const [i, piece] of pieces.entries()) {
    if (piece.title.trim() === "" || /[\r\n]/.test(piece.title)) {
      return refuse(`piece ${i + 1} title must be one non-empty line`);
    }
  }
  for (const [i, piece] of pieces.entries()) {
    if (piece.criteria.length === 0) return refuse(`piece ${i + 1} has no acceptance criterion`);
    if (piece.declaredArtifacts.length === 0) return refuse(`piece ${i + 1} has no declared file`);
  }

  const specCriteria = ctx.spec.acceptanceCriteria.map((c) => c.id);
  const placed = pieces.flatMap((p) => p.criteria);
  const unknown = [...new Set(placed.filter((id) => !specCriteria.includes(id)))];
  const missing = specCriteria.filter((id) => !placed.includes(id));
  const repeated = specCriteria.filter((id) => placed.filter((p) => p === id).length > 1);
  if (unknown.length > 0 || missing.length > 0 || repeated.length > 0) {
    return refuse(
      `every acceptance criterion of the specification must be in exactly one piece: missing=[${missing.join(", ")}]; repeated=[${repeated.join(", ")}]; unknown=[${unknown.join(", ")}]`
    );
  }

  const specFiles = computeScope(ctx.spec.declaredArtifacts);
  const pieceFiles = pieces.map((p) => computeScope(p.declaredArtifacts));
  const strange = [...new Set(pieceFiles.flat().filter((f) => !specFiles.includes(f)))];
  const unplaced = specFiles.filter((f) => !pieceFiles.some((files) => files.includes(f)));
  if (strange.length > 0 || unplaced.length > 0) {
    return refuse(
      `every declared file of the specification must be in at least one piece, and no other file in any: missing=[${unplaced.join(", ")}]; unknown=[${strange.join(", ")}]`
    );
  }

  for (const [i, files] of pieceFiles.entries()) {
    if (files.length > ctx.maxPathsPerPiece) {
      return refuse(
        `piece ${i + 1} (${pieces[i]!.slug}) declares ${files.length} files; a feature may declare at most ${ctx.maxPathsPerPiece}`
      );
    }
  }

  for (const [i, piece] of pieces.entries()) {
    const k = i + 1;
    for (const d of piece.dependsOn) {
      if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > k - 1) {
        return refuse(`piece ${k} dependsOn ${JSON.stringify(d)}: a piece builds only on earlier pieces, 1 to ${k - 1}`);
      }
    }
    if (new Set(piece.dependsOn).size !== piece.dependsOn.length) {
      return refuse(`piece ${k} dependsOn repeats a piece`);
    }
  }

  if (typeof value.rationale !== "string" || value.rationale.trim() === "") {
    return refuse("rationale must be a non-empty string");
  }
  return { ok: true, value: { pieces, rationale: value.rationale } };
}

/** What the spec stage retains for a validated split, and what the decision group re-reads. */
export interface SplitEvidence {
  split: DesignSplit;
  specHash: string;
  declaredCount: number;
  threshold: number;
}

export const SPLIT_EVIDENCE_NAME = "split.json";

/**
 * Retain the validated split before any row refers to it (hazard 2), beside the
 * run's proposal evidence. The returned hash is of the bytes written, so the
 * audit event can bind them and the decision group can refuse an edited file.
 */
export function writeSplitEvidence(rootDir: string, runId: number, evidence: SplitEvidence): { ref: string; hash: string } {
  const dir = proposalEvidenceDir(rootDir, runId);
  mkdirSync(dir, { recursive: true });
  const bytes = JSON.stringify(evidence, null, 2);
  writeFileSync(join(dir, SPLIT_EVIDENCE_NAME), bytes);
  return { ref: proposalEvidenceRef(runId, SPLIT_EVIDENCE_NAME), hash: sha256Hex(bytes) };
}

/** The split question's options: approve is the recommended option, Split. */
export const SPLIT_OPTIONS = [
  { label: "Split", answer: "split the design into the features listed" },
  { label: "Build as one", answer: "build the design as one run" },
];

export const SPLIT_RECOMMENDED = 0;

function buildsOnText(split: DesignSplit, piece: DesignSplitPiece): string {
  return piece.dependsOn.length > 0 ? piece.dependsOn.map((d) => split.pieces[d - 1]!.slug).join(", ") : "nothing";
}

/**
 * The operator question. It states the numbers that triggered it and what the
 * check behind it does not establish (hazard 6): the threshold is an estimate,
 * the order is the operator's call, and a denied split may still be refused at
 * the plan ceiling.
 */
export function splitQuestionText(split: DesignSplit, threshold: number, declaredCount: number): string {
  const features = split.pieces
    .map(
      (piece, i) =>
        `${i + 1}. ${piece.slug}: ${piece.title} (${piece.criteria.length} criteria, ${computeScope(piece.declaredArtifacts).length} files; builds on ${buildsOnText(split, piece)})`
    )
    .join("\n");
  return `The reviewed specification declares ${declaredCount} files, more than the split threshold of ${threshold}. The threshold is an estimate from eleven recorded runs, not a measurement of this design. Split it into these ${split.pieces.length} features, built one after another in this order?

${features}

The check confirms only that every acceptance criterion is in exactly one feature, every declared file is in at least one, and each feature builds only on features before it. It cannot tell whether a feature's criteria need code a later feature writes: the operator decides whether each feature can be built before the ones after it.
Approve stores one design per feature as a proposal and ends this run.
Deny builds the design as one run, which may still be refused at the plan ceiling.
Modify is not accepted for this question.`;
}

/**
 * The question's `why`. The task ceiling comes from the run's frozen policy
 * (`implementationPhaseTasks * implementationMaxPhases`), not a literal.
 */
export function SPLIT_WHY(threshold: number, declaredCount: number, taskCeiling: number): string {
  return `The reviewed specification declares ${declaredCount} files. Above ${threshold}, one run is estimated to need more than the ${taskCeiling} plan items a run can build.`;
}

/**
 * One feature's design, rendered deterministically from the reviewed spec, the
 * validated split and the operator's other answers. It never copies the
 * original design: a feature run's spec stage grounds its requirements in its
 * whole `design.md`, so a copied original would let one feature's spec cite and
 * add every other feature's requirements (hazard 13). The original is named by
 * path for shared context. Criterion lines and answers are copied verbatim.
 */
export function renderPieceDesign(input: {
  originalSlug: string;
  runId: number;
  spec: SpecDoc;
  split: DesignSplit;
  index: number;
  decisions: { question: string; action: string; answer: string }[];
}): string {
  const { originalSlug, runId, spec, split, index, decisions } = input;
  const piece = split.pieces[index - 1];
  if (piece === undefined) throw new Error(`design split has no piece ${index}`);
  const originalPath = `docs/features/${originalSlug}/design.md`;
  const textOf = new Map(spec.acceptanceCriteria.map((c) => [c.id, c.text]));
  const owner = new Map(split.pieces.flatMap((p) => p.criteria.map((id) => [id, p.slug] as const)));
  const buildsOn =
    piece.dependsOn.length > 0
      ? piece.dependsOn.map((d) => `- ${split.pieces[d - 1]!.slug}: ${split.pieces[d - 1]!.title}`).join("\n")
      : index === 1
        ? "Nothing: this is the first feature."
        : "Nothing: this feature builds on no earlier feature.";
  const others = spec.acceptanceCriteria
    .filter((c) => !piece.criteria.includes(c.id))
    .map((c) => `- ${c.id}: ${owner.get(c.id)}`)
    .join("\n");
  const sections = [
    `This is feature ${index} of ${split.pieces.length} split from ${originalPath} by run ${runId}. Build only the acceptance criteria listed below; the other features build the rest.`,
    `## Builds on\n\n${buildsOn}`,
    `## Acceptance criteria for this feature\n\n${piece.criteria.map((id) => `- ${id}: ${textOf.get(id)}`).join("\n")}`,
    `## Files this feature is expected to change\n\n${computeScope(piece.declaredArtifacts).map((f) => `- ${f}`).join("\n")}`,
    `## Criteria other features build\n\n${others === "" ? "None." : others}`,
  ];
  if (decisions.length > 0) {
    sections.push(
      `## Decisions already made\n\n${decisions
        .map((d) => `${d.question}\n\n${d.action === "deny" ? "Left open by the operator." : `Answer: ${d.answer}`}`)
        .join("\n\n")}`
    );
  }
  sections.push(
    `## Original design\n\nThe full design this feature was split from is ${originalPath} in this repository. Read it for shared context; it states no requirement for this feature.`
  );
  return `${sections.join("\n\n")}\n`;
}
