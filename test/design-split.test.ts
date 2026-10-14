import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DESIGN_SPLIT_INTENT,
  DESIGN_SPLIT_LOCATION,
  SPLIT_OPTIONS,
  SPLIT_RECOMMENDED,
  SPLIT_WHY,
  featureSlugsInUse,
  minimumSplitPieces,
  readSplitRecord,
  renderPieceDesign,
  splitIsPossible,
  splitQuestionText,
  validateDesignSplit,
  type DesignSplit,
} from "../src/design-split.ts";
import { validateSpecDoc, type SpecDoc } from "../src/spec-doc.ts";
import { validateReviewerReports } from "../src/reconciliation.ts";
import { DESIGN_SPLIT_PATH_THRESHOLD } from "../src/policy.ts";

/**
 * Crew-chatter run 4's reviewed specification, recorded with provenance: 62
 * declared files and 86 acceptance criteria, the design that motivated this
 * feature. Every split below is derived from it mechanically, never written by
 * hand, so the expected answers come from the recording (hazard 4).
 */
const RUN_4 = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "spec-crew-chatter-run-4.json"), "utf8")
) as { specMarkdown: string };

const SPEC: SpecDoc = (() => {
  const result = validateSpecDoc(RUN_4.specMarkdown);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
})();

const RUN_SLUG = "crew-chatter";

/** Split `items` in order into `k` contiguous groups whose sizes differ by at most one. */
function groups<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const size = Math.ceil((items.length - at) / (k - i));
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

/** The criteria and the declared files, each in spec order, in k contiguous groups; piece i builds on piece i-1. */
function derivedSplit(spec: SpecDoc, k: number): DesignSplit {
  const criteria = groups(spec.acceptanceCriteria.map((c) => c.id), k);
  const files = groups(spec.declaredArtifacts, k);
  return {
    pieces: criteria.map((ids, i) => ({
      slug: `${RUN_SLUG}-part-${i + 1}`,
      title: `Crew chatter part ${i + 1}`,
      criteria: ids,
      declaredArtifacts: files[i]!,
      dependsOn: i === 0 ? [] : [i],
    })),
    rationale: "contiguous groups of the specification's criteria and files",
  };
}

const CTX = { spec: SPEC, runSlug: RUN_SLUG, slugsInUse: [RUN_SLUG, "other-feature"], maxPathsPerPiece: DESIGN_SPLIT_PATH_THRESHOLD };

function clone(split: DesignSplit): DesignSplit {
  return JSON.parse(JSON.stringify(split)) as DesignSplit;
}

function refused(value: unknown, pattern: RegExp, ctx = CTX): void {
  const result = validateDesignSplit(value, ctx);
  assert.equal(result.ok, false, `expected a refusal matching ${pattern}`);
  if (!result.ok) assert.match(result.reason, pattern);
}

test("the recorded spec has the counts the split is sized against", () => {
  assert.equal(SPEC.declaredArtifacts.length, 62);
  assert.equal(SPEC.acceptanceCriteria.length, 86);
});

test("(a) a three-way split derived from crew-chatter run 4's spec validates at the frozen threshold", () => {
  const split = derivedSplit(SPEC, 3);
  assert.deepEqual(split.pieces.map((p) => p.declaredArtifacts.length), [21, 21, 20]);
  const result = validateDesignSplit(split, CTX);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.deepEqual(result.value, split);
});

test("(b) each defect in a split is refused, naming the rule it breaks", () => {
  const base = derivedSplit(SPEC, 3);
  const firstId = base.pieces[0]!.criteria[0]!;
  const lastFile = base.pieces[2]!.declaredArtifacts.at(-1)!;
  const cases: [string, (s: DesignSplit) => unknown, RegExp][] = [
    ["drop one criterion", (s) => { s.pieces[0]!.criteria.shift(); return s; }, new RegExp(`missing=\\[${firstId}\\]`)],
    ["repeat a criterion in two pieces", (s) => { s.pieces[1]!.criteria.push(firstId); return s; }, new RegExp(`repeated=\\[${firstId}\\]`)],
    ["add an unknown criterion", (s) => { s.pieces[1]!.criteria.push("AC-999"); return s; }, /unknown=\[AC-999\]/],
    ["drop the only copy of one file", (s) => { s.pieces[2]!.declaredArtifacts.pop(); return s; }, new RegExp(`missing=\\[${lastFile.replace(/[.]/g, "\\.")}\\]`)],
    ["add a file not in the spec", (s) => { s.pieces[0]!.declaredArtifacts.push("src/invented.ts"); return s; }, /unknown=\[src\/invented\.ts\]/],
    ["one piece", (s) => ({ ...s, pieces: [s.pieces[0]] }), /at least 2 pieces, found 1/],
    ["a slug equal to the run slug", (s) => { s.pieces[1]!.slug = RUN_SLUG; return s; }, /piece 2 slug crew-chatter is this run's own slug/],
    ["a slug already in use", (s) => { s.pieces[1]!.slug = "other-feature"; return s; }, /piece 2 slug other-feature is already a directory under docs\/features\//],
    ["two equal slugs", (s) => { s.pieces[2]!.slug = s.pieces[0]!.slug; return s; }, /piece 3 slug crew-chatter-part-1 is used by an earlier piece/],
    ["an uppercase slug", (s) => { s.pieces[0]!.slug = "Crew-Part"; return s; }, /piece 1 slug "Crew-Part" is not lowercase kebab-case/],
    ["piece 1 building on piece 2", (s) => { s.pieces[0]!.dependsOn = [2]; return s; }, /piece 1 dependsOn 2: a piece builds only on earlier pieces/],
    ["piece 2 building on itself", (s) => { s.pieces[1]!.dependsOn = [2]; return s; }, /piece 2 dependsOn 2: a piece builds only on earlier pieces, 1 to 1/],
    ["a repeated dependency", (s) => { s.pieces[2]!.dependsOn = [1, 1]; return s; }, /piece 3 dependsOn repeats a piece/],
    ["an extra key", (s) => ({ ...s, notes: "x" }), /unknown key\(s\) notes/],
    ["an extra piece key", (s) => { (s.pieces[0] as unknown as Record<string, unknown>).size = 1; return s; }, /piece 1 has unknown key\(s\) size/],
    ["a piece with no criteria", (s) => { s.pieces[1]!.criteria = []; return s; }, /piece 2 has no acceptance criterion/],
    ["a two-line title", (s) => { s.pieces[0]!.title = "a\nb"; return s; }, /piece 1 title must be one non-empty line/],
    ["an empty rationale", (s) => ({ ...s, rationale: " " }), /rationale must be a non-empty string/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const result = validateDesignSplit(mutate(clone(base)), CTX);
    assert.equal(result.ok, false, `${name} must be refused`);
    if (!result.ok) assert.match(result.reason, pattern, name);
  }
});

test("(c) a two-way split of 62 files is refused at the threshold, naming the piece and its 31 files", () => {
  const split = derivedSplit(SPEC, 2);
  assert.deepEqual(split.pieces.map((p) => p.declaredArtifacts.length), [31, 31]);
  refused(split, /piece 1 \(crew-chatter-part-1\) declares 31 files; a feature may declare at most 30/);
  // The same split fits a larger limit, so the refusal is about size alone.
  assert.equal(validateDesignSplit(split, { ...CTX, maxPathsPerPiece: 31 }).ok, true);
});

test("(d) a file listed in two pieces is accepted, and the per-piece count is of distinct files", () => {
  const split = derivedSplit(SPEC, 3);
  split.pieces[1]!.declaredArtifacts.push(split.pieces[0]!.declaredArtifacts[0]!);
  const result = validateDesignSplit(split, CTX);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  // A path repeated inside one piece is one file, not two.
  const repeated = derivedSplit(SPEC, 2);
  const capped = { ...CTX, maxPathsPerPiece: 31 };
  repeated.pieces[0]!.declaredArtifacts.push(repeated.pieces[0]!.declaredArtifacts[0]!);
  assert.ok(validateDesignSplit(repeated, capped).ok, "31 distinct files fit a limit of 31 however often one is listed");
});

test("(d) a path spelled with ./ is the spec's file, not an unknown one", () => {
  const split = derivedSplit(SPEC, 3);
  const last = split.pieces[2]!.declaredArtifacts;
  assert.ok(last.some((p) => p.startsWith("frontend/")), "the recorded spec has a frontend path in the last group");
  const at = last.findIndex((p) => p.startsWith("frontend/"));
  last[at] = `./${last[at]}`;
  const result = validateDesignSplit(split, CTX);
  assert.ok(result.ok, result.ok ? "" : result.reason);
});

test("(e) a rendered feature design carries its own criteria verbatim, names the original by path, and copies no other section", () => {
  const split = derivedSplit(SPEC, 2);
  const decisions = [
    { question: "Who may download exports?", action: "approve", answer: "Only the owner may download exports." },
    { question: "How long are exports kept?", action: "deny", answer: "" },
  ];
  const text = renderPieceDesign({ originalSlug: RUN_SLUG, runId: 4, spec: SPEC, split, index: 2, decisions });
  const specLines = RUN_4.specMarkdown.replace(/\r\n/g, "\n").split("\n");
  const lineOf = (id: string) => specLines.find((l) => l.startsWith(`- ${id}: `))!;
  const [own, other] = text.split("## Criteria other features build");
  for (const id of split.pieces[1]!.criteria) {
    assert.ok(own!.includes(`${lineOf(id)}\n`), `${id} is copied verbatim`);
  }
  for (const id of split.pieces[0]!.criteria) {
    assert.ok(!text.includes(lineOf(id)), `piece 1's ${id} text does not appear`);
    assert.ok(other!.includes(`- ${id}: crew-chatter-part-1\n`), `${id} is named with its owner`);
  }
  assert.ok(text.includes("## Builds on\n\n- crew-chatter-part-1: Crew chatter part 1\n"));
  assert.ok(text.includes("docs/features/crew-chatter/design.md"));
  assert.ok(text.includes("Who may download exports?\n\nAnswer: Only the owner may download exports."));
  assert.ok(text.includes("How long are exports kept?\n\nLeft open by the operator."));
  assert.equal(text.split("Left open by the operator.").length, 2);
  const headings = [...text.matchAll(/^#.*$/gm)].map((m) => m[0]);
  assert.deepEqual(headings, [
    "## Builds on",
    "## Acceptance criteria for this feature",
    "## Files this feature is expected to change",
    "## Criteria other features build",
    "## Decisions already made",
    "## Original design",
  ]);
  const none = renderPieceDesign({ originalSlug: RUN_SLUG, runId: 4, spec: SPEC, split, index: 1, decisions: [] });
  assert.ok(!none.includes("## Decisions already made"));
  assert.ok(none.includes("## Builds on\n\nNothing: this is the first feature.\n"));
  // The output is a function of its inputs.
  assert.equal(renderPieceDesign({ originalSlug: RUN_SLUG, runId: 4, spec: SPEC, split, index: 2, decisions }), text);
});

test("(f) the question names the features, the numbers, and what the check does not establish", () => {
  const split = derivedSplit(SPEC, 3);
  const text = splitQuestionText(split, DESIGN_SPLIT_PATH_THRESHOLD, SPEC.declaredArtifacts.length);
  for (const piece of split.pieces) assert.ok(text.includes(piece.slug));
  for (const words of ["62", "30", "may still be refused", "the operator decides", "Modify is not accepted"]) {
    assert.ok(text.includes(words), `question missing: ${words}`);
  }
  assert.ok(text.includes("2. crew-chatter-part-2: Crew chatter part 2 (29 criteria, 21 files; builds on crew-chatter-part-1)"));
  const why = SPLIT_WHY(30, 62, 80);
  for (const n of ["62", "30", "80"]) assert.ok(why.includes(n));
  assert.equal(SPLIT_OPTIONS[SPLIT_RECOMMENDED]!.label, "Split");
});

test("no reviewer report can take the split finding's location, though one may use its intent key", () => {
  const report = (classification: string, location: string) =>
    validateReviewerReports(
      [{ severity: "high", classification, location, intentKey: DESIGN_SPLIT_INTENT, subject: "split the design" }],
      { agentId: "spec-reviewer-traceability", upstreamPrefix: "upstream:design:" }
    );
  assert.equal(report("upstream", DESIGN_SPLIT_LOCATION).ok, false, "not as an upstream token");
  assert.equal(report("current_artifact", DESIGN_SPLIT_LOCATION).ok, false, "not as a current-artifact location");
  // The intent key alone is no identity: a reviewer may report it, which is why
  // every reader finds the split through its `spec.split.record` event instead.
  assert.ok(report("upstream", "upstream:design:split").ok);
});

test("readSplitRecord reads the last spec.split.record event and nothing else", () => {
  const event = (action: string, summary: string) => ({ action, summary });
  const ref = ".governance/proposals/4/split.json";
  const hash = "a".repeat(64);
  const record = (finding: number) =>
    event("spec.split.record", `finding=${finding}; pieces=2; declared=62; threshold=30; evidence=${ref}; evidenceHash=${hash}`);
  assert.equal(readSplitRecord([]), null);
  assert.equal(readSplitRecord([event("spec.finding.record", "recorded finding 3 at upstream:design:split (design-split), round 1")]), null);
  assert.deepEqual(readSplitRecord([record(3), record(9)]), { findingId: 9, evidenceRef: ref, evidenceHash: hash });
  assert.equal(readSplitRecord([event("spec.split.record", `pieces=2; evidence=${ref}; evidenceHash=${hash}`)]), null);
});

test("a slug matching a feature directory in another case is refused, because Windows folder names ignore case", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-split-slugs-"));
  try {
    mkdirSync(join(root, "docs", "features", "Other-Feature"), { recursive: true });
    mkdirSync(join(root, "docs", "features", "crew-chatter"), { recursive: true });
    writeFileSync(join(root, "docs", "features", "README.md"), "a file, not a feature");
    const inUse = featureSlugsInUse(root);
    assert.deepEqual(inUse, ["crew-chatter", "other-feature"]);
    const split = derivedSplit(SPEC, 3);
    split.pieces[1]!.slug = "other-feature";
    refused(split, /piece 2 slug other-feature is already a directory under docs\/features\//, { ...CTX, slugsInUse: inUse });
    // The validator compares without case even when handed a cased name.
    refused(split, /piece 2 slug other-feature is already a directory/, { ...CTX, slugsInUse: ["Other-Feature"] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("minimumSplitPieces is the fewest pieces whose even share fits the threshold, and never fewer than two", () => {
  // Crew-chatter run 4's 62 files at the frozen 30: two pieces of 31 fail
  // (test (c) above), three of 21/21/20 pass (test (a)).
  assert.equal(minimumSplitPieces(SPEC.declaredArtifacts.length, DESIGN_SPLIT_PATH_THRESHOLD), 3);
  assert.equal(minimumSplitPieces(DESIGN_SPLIT_PATH_THRESHOLD + 1, DESIGN_SPLIT_PATH_THRESHOLD), 2);
  assert.equal(minimumSplitPieces(1, DESIGN_SPLIT_PATH_THRESHOLD), 2);
});

test("splitIsPossible matches what the validator can accept, at the frozen threshold", () => {
  // The most even contiguous split is the best case for the per-piece file
  // limit, so if no piece count of it validates, no split does.
  for (const k of [1, 2, 3, 4]) {
    const spec = { ...SPEC, acceptanceCriteria: SPEC.acceptanceCriteria.slice(0, k) };
    const counts = Array.from({ length: Math.max(0, k - 1) }, (_, i) => i + 2);
    const validates = counts.some((p) => validateDesignSplit(derivedSplit(spec, p), { ...CTX, spec }).ok);
    assert.equal(
      splitIsPossible(k, SPEC.declaredArtifacts.length, DESIGN_SPLIT_PATH_THRESHOLD),
      validates,
      `${k} criteria, ${SPEC.declaredArtifacts.length} files`
    );
  }
});
