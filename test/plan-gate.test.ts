import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLOCKING_DISPOSITIONS,
  coverageFitsScope,
  coverageMeetsCriteria,
  planReviewGate,
  tasksNameScope,
} from "../src/plan-gate.ts";
import { validatePlanDoc, type CoverageEntry, type PlanDoc } from "../src/plan-doc.ts";
import { computeScope } from "../src/scope.ts";
import { validateSpecDoc, type AcceptanceCriterion } from "../src/spec-doc.ts";
import type { FindingDecisionRow } from "../src/store.ts";

function covers(artifact: string, criterionId = "AC-001"): CoverageEntry {
  return { criterionId, artifact, rationale: null, alternativeVerification: null };
}

function notApplicable(criterionId: string): CoverageEntry {
  return {
    criterionId,
    artifact: null,
    rationale: "observed, not asserted",
    alternativeVerification: "checked in the smoke run's recorded output",
  };
}

function criteria(...ids: string[]): AcceptanceCriterion[] {
  return ids.map((id) => ({
    id,
    text: `${id} keeps markdown like \`calculator/index.html\` and qualifiers (no build step)`,
  }));
}

function planWith(coverage: CoverageEntry[]): PlanDoc {
  return { feature: "Thing", planFor: "a".repeat(64), tasks: ["do it"], taskItems: ["do it"], coverage };
}

function decision(disposition: string, findingId: number): FindingDecisionRow {
  return {
    id: findingId,
    finding_id: findingId,
    agent_run_id: 1,
    disposition,
    rationale: "r",
    changed_locations: "[]",
    grounding_source: null,
    grounding_location: null,
    grounding_excerpt: null,
    normative_changes: null,
    artifact_hash_before: "a".repeat(64),
    artifact_hash_after: "a".repeat(64),
  };
}

const SCOPE = ["src/thing.ts", "test/thing.test.ts"];

test("coverage entirely inside the signed scope passes", () => {
  const result = coverageFitsScope(
    planWith([covers("src/thing.ts"), covers("test/thing.test.ts")]),
    SCOPE
  );
  assert.deepEqual(result, { ok: true });
});

test("an artifact outside the signed scope is returned as unkeepable and named", () => {
  const result = coverageFitsScope(
    planWith([covers("src/thing.ts"), covers("src/elsewhere.ts", "AC-002")]),
    SCOPE
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  // The criterion is what the operator can act on, not the path.
  assert.deepEqual(result.unkeepable, ["AC-002"]);
});

test("the refusal names the target that failed and the membership rule, without inferring intent", () => {
  const RULE = "; an artifact-form coverage entry names exactly one path copied from the signed scope";

  // An ordinary out-of-scope path: the operator sees the value that failed and
  // the rule it failed against, not a criterion ID and the word "scope".
  const plain = coverageFitsScope(planWith([covers("src/elsewhere.ts", "AC-002")]), SCOPE);
  assert.equal(plain.ok, false);
  if (plain.ok) return;
  assert.equal(
    plain.reason,
    `plan promises coverage outside the approved scope: AC-002 -> src/elsewhere.ts${RULE}`
  );

  // The shape a live plan author actually wrote, quoted from the committed
  // response at test/fixtures/recorded/
  // plan-reconciliation-web-calculator-multi-artifact-coverage.json.
  const list = coverageFitsScope(
    planWith([covers("src/index.html, src/calculator.js", "AC-008")]),
    SCOPE
  );
  assert.equal(list.ok, false);
  if (list.ok) return;
  assert.equal(
    list.reason,
    `plan promises coverage outside the approved scope: AC-008 -> src/index.html, src/calculator.js${RULE}`
  );

  // The same sentence in both cases, deliberately: the check does not guess
  // from punctuation which kind of mistake was made, because a path may
  // legally contain punctuation and the rule is true either way. The typed
  // signal is what callers branch on.
  assert.deepEqual(list.unkeepable, ["AC-008"]);
  assert.ok(plain.reason.endsWith(RULE) && list.reason.endsWith(RULE));
});

test("a path differing from a signed entry only in case is unkeepable on every platform", () => {
  // The operator signs the paths exactly as declared, which is why
  // `computeScope` preserves spelling. Folding case here would silently widen
  // what was signed, so this must refuse on Windows and macOS too — where the
  // two spellings name one file — not just on a case-sensitive filesystem.
  const result = coverageFitsScope(
    planWith([covers("src/Thing.ts", "AC-001")]),
    SCOPE
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.unkeepable, ["AC-001"]);
});

test("a not_applicable entry is never unkeepable", () => {
  // It promises no artifact: it carries a rationale and an alternative
  // verification instead, which section 8 prefers to a fabricated test.
  const result = coverageFitsScope(
    planWith([covers("src/thing.ts"), notApplicable("AC-002")]),
    SCOPE
  );
  assert.deepEqual(result, { ok: true });
});

test("a mix returns only the offending criteria", () => {
  const result = coverageFitsScope(
    planWith([
      covers("src/thing.ts", "AC-001"),
      covers("src/nope.ts", "AC-002"),
      notApplicable("AC-003"),
      covers("docs/other.md", "AC-004"),
    ]),
    SCOPE
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.unkeepable, ["AC-002", "AC-004"]);
});

test("an empty signed scope makes every artifact promise unkeepable", () => {
  const result = coverageFitsScope(planWith([covers("src/thing.ts", "AC-001")]), []);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.unkeepable, ["AC-001"]);
});

// --- every declared artifact named in a task ---------------------------------

const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "recorded", name), "utf8"));

/** A recorded spec's signed scope, computed the way approval computes it. */
function scopeOf(spec: string): string[] {
  const parsed = validateSpecDoc(spec);
  assert.ok(parsed.ok, "the recorded spec validates");
  return computeScope(parsed.value.declaredArtifacts);
}

function parsedPlan(text: string): PlanDoc {
  const parsed = validatePlanDoc(text);
  assert.ok(parsed.ok, "the recorded plan validates");
  return parsed.value;
}

function planWithTasks(...tasks: string[]): PlanDoc {
  return { feature: "Thing", planFor: "a".repeat(64), tasks, taskItems: tasks, coverage: [covers("src/thing.ts")] };
}

test("crew-chatter run 3's recorded plans name none of the three package files code review found undelivered", () => {
  const run3 = recorded("plan-crew-chatter-run-3-declared-artifacts-untasked.json") as {
    provenance: { blockedBy: { summary: string } };
    spec: string;
    plan: string;
    planDraft: string;
  };
  // The expected set is the run's own code_review.artifact.missing event, not a
  // list written here.
  const listed = /does not deliver declared artifact\(s\): (.+)$/.exec(run3.provenance.blockedBy.summary);
  assert.ok(listed, "the recorded audit summary lists the undelivered artifacts");
  const expected = listed[1]!.split(", ");
  assert.deepEqual(expected, ["backend/package.json", "frontend/package.json", "package-lock.json"]);

  const scope = scopeOf(run3.spec);
  for (const [name, text] of [["approved plan", run3.plan], ["draft plan", run3.planDraft]] as const) {
    const result = tasksNameScope(parsedPlan(text), scope);
    assert.equal(result.ok, false, name);
    if (result.ok) continue;
    assert.deepEqual(result.untasked, expected, name);
    assert.equal(
      result.reason,
      `plan names declared artifact(s) in no task: ${expected.join(", ")}; delivery refuses a declared artifact the change leaves untouched, so every approved scope path must appear, copied verbatim, in a ## Tasks line that changes it`,
      name
    );
  }
});

test("crew-chatter run 6's recorded approved plan names every declared artifact in a task", () => {
  const run6 = recorded("crew-chatter-run-6-approved-spec-plan.json") as { spec: string; plan: string };
  assert.deepEqual(tasksNameScope(parsedPlan(run6.plan), scopeOf(run6.spec)), { ok: true });
});

test("a scope path is named only as a whole path, wherever the sentence puts it", () => {
  const named = (task: string, path: string): boolean => tasksNameScope(planWithTasks(task), [path]).ok;
  assert.equal(named("Create `src/a.ts` with the parser.", "src/a.ts"), true, "backticked");
  assert.equal(named("Wire the parser into src/a.ts.", "src/a.ts"), true, "ending a sentence");
  assert.equal(named("Ignore SQLite files in .gitignore", ".gitignore"), true, "a dotfile at the end");
  assert.equal(named("Create src/a.tsx with the view.", "src/a.ts"), false, "a longer extension");
  assert.equal(named("Add the script to frontend/package.json.", "package.json"), false, "a longer path");
  assert.equal(named("Rewrite ./src/a.ts", "src/a.ts"), false, "a respelled path");
});

test("a scope path named outside the task list is untasked, and every untasked path is listed in scope order", () => {
  const doc = planWithTasks("Build `src/thing.ts`.");
  const result = tasksNameScope(doc, ["src/other.ts", "src/thing.ts", "test/thing.test.ts"]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  // The coverage line names src/thing.ts too, but coverage is not a task.
  assert.deepEqual(result.untasked, ["src/other.ts", "test/thing.test.ts"]);
});

test("planReviewGate passes when there are no decisions at all", () => {
  assert.deepEqual(planReviewGate([]), { pass: true });
});

test("planReviewGate passes on every non-blocking disposition", () => {
  // addressed, rejected_with_rationale, and upstream_follow_up all reflect a
  // decision the panel already reconciled; only cannot_determine and
  // upstream_blocking withhold completion (section 12, as amended).
  for (const disposition of ["addressed", "rejected_with_rationale", "upstream_follow_up"]) {
    assert.deepEqual(planReviewGate([decision(disposition, 1)]), { pass: true }, disposition);
  }
});

test("planReviewGate blocks on cannot_determine and upstream_blocking, naming their finding ids", () => {
  const result = planReviewGate([
    decision("addressed", 1),
    decision("cannot_determine", 2),
    decision("upstream_blocking", 3),
    decision("rejected_with_rationale", 4),
  ]);
  assert.equal(result.pass, false);
  if (result.pass) return;
  assert.deepEqual(result.blockedFindingIds, [2, 3]);
});

test("planReviewGate blocks on exactly BLOCKING_DISPOSITIONS", () => {
  // specReviewGate imports this same constant from plan-gate.ts (step 5b
  // Task 9), so the two gates agree by construction rather than by a
  // duplicated literal that could drift.
  for (const disposition of BLOCKING_DISPOSITIONS) {
    const blocked = planReviewGate([decision(disposition, 9)]);
    assert.equal(blocked.pass, false, disposition);
    if (blocked.pass) continue;
    assert.deepEqual(blocked.blockedFindingIds, [9]);
  }
});

test("coverageMeetsCriteria passes by ID without restating criterion prose", () => {
  const doc = planWith([covers("src/thing.ts", "AC-001"), notApplicable("AC-002")]);
  assert.deepEqual(coverageMeetsCriteria(doc, criteria("AC-001", "AC-002")), { ok: true });
});

test("coverageMeetsCriteria names missing criterion IDs", () => {
  const doc = planWith([covers("src/thing.ts", "AC-001")]);
  const result = coverageMeetsCriteria(doc, criteria("AC-001", "AC-002", "AC-003"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result, { ok: false, missing: ["AC-002", "AC-003"], unknown: [], duplicate: [] });
});

test("coverageMeetsCriteria names unknown criterion IDs", () => {
  const doc = planWith([covers("src/thing.ts", "AC-001"), covers("src/other.ts", "AC-999")]);
  const result = coverageMeetsCriteria(doc, criteria("AC-001"));
  assert.deepEqual(result, { ok: false, missing: [], unknown: ["AC-999"], duplicate: [] });
});

test("coverageMeetsCriteria names duplicate criterion IDs", () => {
  const doc = planWith([covers("src/a.ts", "AC-001"), covers("src/b.ts", "AC-001")]);
  const result = coverageMeetsCriteria(doc, criteria("AC-001"));
  assert.deepEqual(result, { ok: false, missing: [], unknown: [], duplicate: ["AC-001"] });
});

test("coverageMeetsCriteria reports every identity defect in first-observed order", () => {
  const doc = planWith([
    covers("src/a.ts", "AC-999"),
    covers("src/b.ts", "AC-999"),
    covers("src/c.ts", "AC-888"),
    covers("src/d.ts", "AC-888"),
  ]);
  assert.deepEqual(coverageMeetsCriteria(doc, criteria("AC-001", "AC-002")), {
    ok: false,
    missing: ["AC-001", "AC-002"],
    unknown: ["AC-999", "AC-888"],
    duplicate: ["AC-999", "AC-888"],
  });
});
