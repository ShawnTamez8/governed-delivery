import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeText, sha256Hex } from "../src/canonical.ts";
import { planPhases, validatePlanDoc, writePlanDoc } from "../src/plan-doc.ts";
import { IMPLEMENTATION_MAX_PHASES, IMPLEMENTATION_PHASE_TASKS } from "../src/policy.ts";

const SPEC_HASH = "a".repeat(64);

/**
 * The plan team-notes run 6 produced and its plan_review gate passed, verbatim
 * (`test/fixtures/recorded/plan-team-notes-run-6.json`, with provenance). Its
 * task count is the recorded fact the phase tests rest on, not a number written
 * beside the code that splits it.
 */
const RUN_6 = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "plan-team-notes-run-6.json"), "utf8")
) as { provenance: { tasksSectionLines: number }; planMarkdown: string };

/**
 * The plan team-notes run 12 produced and its plan_review gate passed, verbatim
 * (`test/fixtures/recorded/plan-team-notes-run-12.json`, with provenance). The
 * implementation stage refused it: 226 task lines against a ceiling of 80, though
 * the author had written 53 top-level tasks and nested 173 detail lines under them.
 */
const RUN_12 = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "plan-team-notes-run-12.json"), "utf8")
) as {
  provenance: {
    planHash: string;
    tasksSectionLines: number;
    tasksSectionTopLevelItems: number;
    tasksSectionNestedLines: number;
  };
  planMarkdown: string;
};

/**
 * A valid document, built from parts so each refusal test can remove exactly
 * one thing. The expected shape comes from the plan document schema stated in
 * `docs/features/plan-stage/plan.md`, not from anything invented here.
 */
function planDoc(overrides: { frontmatter?: string; tasks?: string; coverage?: string } = {}): string {
  const frontmatter =
    overrides.frontmatter ?? `feature: Thing\nplan_for: ${SPEC_HASH}`;
  const tasks = overrides.tasks ?? "## Tasks\n\n- Build the thing\n- Test the thing\n";
  const coverage =
    overrides.coverage ?? "## Coverage\n\n- AC-001 -> test/thing.test.ts\n";
  return `${frontmatter}\n\n${tasks}\n${coverage}`;
}

function refusal(content: string): string {
  const result = validatePlanDoc(content);
  assert.equal(result.ok, false, "expected a refusal");
  return (result as { reason: string }).reason;
}

test("a well-formed plan document validates and parses every part", () => {
  const result = validatePlanDoc(planDoc());
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.feature, "Thing");
  assert.equal(result.value.planFor, SPEC_HASH);
  assert.deepEqual(result.value.tasks, ["Build the thing", "Test the thing"]);
  assert.deepEqual(result.value.coverage, [
    {
      criterionId: "AC-001",
      artifact: "test/thing.test.ts",
      rationale: null,
      alternativeVerification: null,
    },
  ]);
});

test("a missing feature field is refused by name", () => {
  assert.match(
    refusal(planDoc({ frontmatter: `plan_for: ${SPEC_HASH}` })),
    /plan is missing the frontmatter field feature/
  );
});

test("a missing plan_for field is refused by name", () => {
  assert.match(
    refusal(planDoc({ frontmatter: "feature: Thing" })),
    /plan is missing the frontmatter field plan_for/
  );
});

test("a plan_for that is not a sha256 digest is refused naming the value", () => {
  // The binding to the specification is the whole point of the field, so a
  // value that cannot be a spec hash is refused rather than carried forward.
  assert.match(
    refusal(planDoc({ frontmatter: "feature: Thing\nplan_for: not-a-hash" })),
    /plan_for must be a 64-character sha256 hex digest of the specification: not-a-hash/
  );
});

test("a missing Tasks section is refused by name", () => {
  assert.match(refusal(planDoc({ tasks: "" })), /plan is missing the ## Tasks section/);
});

test("an empty task list is refused", () => {
  assert.match(refusal(planDoc({ tasks: "## Tasks\n" })), /tasks must not be empty/);
});

test("task status checkboxes are refused because status belongs in run state", () => {
  for (const checkbox of ["- [ ] Build the thing", "- [x] Build the thing", "* [X] Build the thing"]) {
    assert.match(
      refusal(planDoc({ tasks: `## Tasks\n\n${checkbox}\n` })),
      /plan task must be a plain list item, not a status checkbox/
    );
  }
});

test("a missing Coverage section is refused by name", () => {
  assert.match(refusal(planDoc({ coverage: "" })), /plan is missing the ## Coverage section/);
});

test("an empty coverage list is refused", () => {
  assert.match(refusal(planDoc({ coverage: "## Coverage\n" })), /coverage must not be empty/);
});

test("a coverage line matching neither form is refused naming the line", () => {
  assert.match(
    refusal(planDoc({ coverage: "## Coverage\n\n- AC-001\n" })),
    /coverage entry must be '<criterion-id> -> <artifact>'/
  );
});

test("a coverage line with an empty target is refused", () => {
  assert.match(
    refusal(planDoc({ coverage: "## Coverage\n\n- AC-001 ->\n" })),
    /coverage entry must name a criterion ID and a target/
  );
});

test("a well-formed not_applicable entry carries both halves", () => {
  const result = validatePlanDoc(
    planDoc({
      coverage:
        "## Coverage\n\n- AC-001 -> not_applicable: logging is observed, not asserted / verified by the smoke run's recorded output\n",
    })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.coverage, [
    {
      criterionId: "AC-001",
      artifact: null,
      rationale: "logging is observed, not asserted",
      alternativeVerification: "verified by the smoke run's recorded output",
    },
  ]);
});

test("not_applicable without an alternative verification is refused naming the criterion", () => {
  // Section 8: a coverage decision needs both halves. A rationale alone is an
  // excuse for dropping a criterion.
  assert.match(
    refusal(
      planDoc({ coverage: "## Coverage\n\n- AC-001 -> not_applicable: hard to assert\n" })
    ),
    /coverage entry for AC-001 says not_applicable without both a rationale and an alternative verification/
  );
});

test("not_applicable without a rationale is refused naming the criterion", () => {
  assert.match(
    refusal(
      planDoc({ coverage: "## Coverage\n\n- AC-001 -> not_applicable:  / checked by hand\n" })
    ),
    /coverage entry for AC-001 says not_applicable without both a rationale and an alternative verification/
  );
});

test("a bare not_applicable is refused", () => {
  assert.match(
    refusal(planDoc({ coverage: "## Coverage\n\n- AC-001 -> not_applicable\n" })),
    /says not_applicable without both a rationale and an alternative verification/
  );
});

test("criterion prose on the left side is refused", () => {
  // The split lands at the first arrow, so the diagnostic names the prefix
  // of the prose ("the a") — refused either way, since prose is never an ID.
  assert.match(
    refusal(planDoc({ coverage: "## Coverage\n\n- the a->b mapping works -> src/a1.ts\n" })),
    /coverage entry criterion ID is invalid: the a;/
  );
});

test("a rationale containing a slash splits at the delimiter, not the slash", () => {
  // The rationale is prose and may cite paths. Splitting at the first slash
  // corrupted both halves while both still validated — a silently fabricated
  // coverage record.
  const result = validatePlanDoc(
    planDoc({
      coverage:
        "## Coverage\n\n- AC-001 -> not_applicable: no check in test/unit/a.test.ts yet / verified manually\n",
    })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.coverage[0].rationale, "no check in test/unit/a.test.ts yet");
  assert.equal(result.value.coverage[0].alternativeVerification, "verified manually");
});

test("an arrow inside the not_applicable body splits at the first arrow, not inside the prose", () => {
  // The left side is a constrained ID that can never contain an arrow; the
  // rationale is prose and may. Splitting at the last arrow refused this
  // valid document with a bogus invalid-ID diagnostic.
  const result = validatePlanDoc(
    planDoc({
      coverage:
        "## Coverage\n\n- AC-002 -> not_applicable: the a->b mapping is observed at runtime / checked in the smoke output\n",
    })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.coverage, [
    {
      criterionId: "AC-002",
      artifact: null,
      rationale: "the a->b mapping is observed at runtime",
      alternativeVerification: "checked in the smoke output",
    },
  ]);
});

test("an artifact path beginning with not_applicable is an artifact, not a decision", () => {
  const result = validatePlanDoc(
    planDoc({ coverage: "## Coverage\n\n- AC-001 -> not_applicable.test.ts\n" })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.coverage[0].artifact, "not_applicable.test.ts");
  assert.equal(result.value.coverage[0].rationale, null);
});

test("the spaced not_applicable form is still a decision with both halves", () => {
  const result = validatePlanDoc(
    planDoc({ coverage: "## Coverage\n\n- AC-001 -> not_applicable : hard to assert / checked by hand\n" })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.coverage[0].rationale, "hard to assert");
  assert.equal(result.value.coverage[0].alternativeVerification, "checked by hand");
});

test("duplicate valid criterion IDs remain visible to the spec-aware gate", () => {
  const result = validatePlanDoc(
    planDoc({ coverage: "## Coverage\n\n- AC-001 -> src/a.ts\n- AC-001 -> src/b.ts\n" })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.coverage.map((entry) => entry.criterionId), ["AC-001", "AC-001"]);
});

function run6Tasks(): string[] {
  const result = validatePlanDoc(RUN_6.planMarkdown);
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  return (result as { value: { tasks: string[] } }).value.tasks;
}

test("the recorded run 6 plan parses to the task count recorded when it was captured", () => {
  assert.equal(RUN_6.provenance.tasksSectionLines, 57);
  assert.equal(run6Tasks().length, RUN_6.provenance.tasksSectionLines);
});

/** Parse a plan whose `## Tasks` section is `tasks`, and return both task views. */
function taskViews(tasks: string): { tasks: string[]; taskItems: string[] } {
  const result = validatePlanDoc(planDoc({ tasks }));
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  return (result as { value: { tasks: string[]; taskItems: string[] } }).value;
}

/** Every line of every item in the form `tasks` uses: nothing lost, repeated or reordered. */
function itemLines(items: string[]): string[] {
  return items.flatMap((item) => item.split("\n")).map((line) => line.trim().replace(/^-\s*/, ""));
}

test("a plan whose task lines share one indentation has one task item per line, equal to tasks", () => {
  const { tasks, taskItems } = taskViews("## Tasks\n\n- Build the thing\n- Test the thing\n- Ship it\n");
  assert.deepEqual(taskItems, ["Build the thing", "Test the thing", "Ship it"]);
  assert.deepEqual(taskItems, tasks);
});

test("the recorded run 6 plan has one task item per line, so phasing it is unchanged", () => {
  const result = validatePlanDoc(RUN_6.planMarkdown);
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.taskItems.length, RUN_6.provenance.tasksSectionLines);
  assert.deepEqual(result.value.taskItems, result.value.tasks);
});

test("indented lines under a task join it with their relative indentation, while tasks keeps every line", () => {
  const { tasks, taskItems } = taskViews(
    "## Tasks\n\n- Build the thing:\n  - part one\n  - part two\n- Test the thing\n"
  );
  assert.deepEqual(taskItems, ["Build the thing:\n  - part one\n  - part two", "Test the thing"]);
  assert.deepEqual(tasks, ["Build the thing:", "part one", "part two", "Test the thing"]);
});

test("a plan indented uniformly gives the same task items as the same plan unindented", () => {
  const unindented = taskViews("## Tasks\n\n- A:\n  - a1\n- B\n");
  const indented = taskViews("## Tasks\n\n  - A:\n    - a1\n  - B\n");
  assert.deepEqual(indented.taskItems, unindented.taskItems);
  assert.deepEqual(indented.taskItems, ["A:\n  - a1", "B"]);
});

test("an indented line before any task starts a task instead of being dropped, and does not set the base", () => {
  assert.deepEqual(taskViews("## Tasks\n\n  - stray\n- Real\n").taskItems, ["stray", "Real"]);
  // The smallest indentation in the section is the base, not the first line's:
  // were it the first line's, "a1" would be a task of its own.
  assert.deepEqual(taskViews("## Tasks\n\n  - stray\n- A\n  - a1\n").taskItems, ["stray", "A\n  - a1"]);
});

test("grouping never loses, repeats or reorders a line: the lines of the items are the tasks", () => {
  const nested = taskViews(
    "## Tasks\n\n- A:\n  - a1\n    - a1a\n  - a2\n- B\n- C:\n  - c1\n"
  );
  assert.deepEqual(itemLines(nested.taskItems), nested.tasks);
  assert.equal(nested.taskItems.length, 3);
  const run6 = validatePlanDoc(RUN_6.planMarkdown);
  assert.equal(run6.ok, true, (run6 as { reason?: string }).reason);
  if (!run6.ok) return;
  assert.deepEqual(itemLines(run6.value.taskItems), run6.value.tasks);
});

test("a bare dash is no task in either view, so a flat plan with one still has taskItems equal to tasks", () => {
  const flat = taskViews("## Tasks\n\n- a\n-\n- b\n- \n");
  assert.deepEqual(flat.tasks, ["a", "b"]);
  assert.deepEqual(flat.taskItems, flat.tasks);
  // Above a nested line it must not become an item whose first line is empty.
  const nested = taskViews("## Tasks\n\n-\n  - x\n- y\n");
  assert.deepEqual(nested.tasks, ["x", "y"]);
  assert.deepEqual(nested.taskItems, ["x", "y"]);
});

test("trailing whitespace on a task line or a nested line is not carried into its item", () => {
  assert.deepEqual(taskViews("## Tasks\n\n- a   \n  - a1   \n- b\t\n").taskItems, ["a\n  - a1", "b"]);
});

/** The run 12 plan's `## Tasks` lines that start at column 0: its top-level tasks, read without the parser. */
function run12TopLevelLines(): string[] {
  const section = /\n## Tasks\n([\s\S]*?)\n## Coverage\n/.exec(RUN_12.planMarkdown);
  assert.ok(section, "the recorded plan has a Tasks section followed by Coverage");
  return section![1]!
    .split("\n")
    .filter((line) => /^- \S/.test(line))
    .map((line) => line.slice(2).trim());
}

test("the recorded run 12 plan is the plan its gate passed", () => {
  assert.equal(sha256Hex(normalizeText(RUN_12.planMarkdown)), RUN_12.provenance.planHash);
});

test("the recorded run 12 plan counts 226 lines but 53 tasks, and only the tasks fit the stage ceiling", () => {
  const result = validatePlanDoc(RUN_12.planMarkdown);
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  const ceiling = IMPLEMENTATION_PHASE_TASKS * IMPLEMENTATION_MAX_PHASES;
  assert.equal(result.value.tasks.length, RUN_12.provenance.tasksSectionLines);
  assert.equal(result.value.taskItems.length, RUN_12.provenance.tasksSectionTopLevelItems);
  assert.equal(
    result.value.tasks.length - result.value.taskItems.length,
    RUN_12.provenance.tasksSectionNestedLines
  );
  // The refusal this fix answers: counted by line the plan is over the ceiling,
  // counted by task it is under.
  assert.ok(result.value.tasks.length > ceiling, `${result.value.tasks.length} lines must exceed ${ceiling}`);
  assert.ok(result.value.taskItems.length <= ceiling, `${result.value.taskItems.length} tasks must fit ${ceiling}`);
});

test("the recorded run 12 plan's task items are its column-0 tasks, each carrying its own detail lines", () => {
  const result = validatePlanDoc(RUN_12.planMarkdown);
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  const topLevel = run12TopLevelLines();
  assert.equal(topLevel.length, RUN_12.provenance.tasksSectionTopLevelItems);
  // Each item starts with the plan's own top-level line, in plan order, so no
  // item begins on a detail line.
  assert.deepEqual(result.value.taskItems.map((item) => item.split("\n")[0]), topLevel);
  // The lines of the items are the lines of the plan: nothing lost or reordered.
  assert.deepEqual(itemLines(result.value.taskItems), result.value.tasks);
});

test("the recorded run 12 plan splits into six phases by task, the last holding three", () => {
  const result = validatePlanDoc(RUN_12.planMarkdown);
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  const phases = planPhases(result.value.taskItems, IMPLEMENTATION_PHASE_TASKS);
  // 53 tasks (recorded) at ten per phase.
  assert.deepEqual(phases.map((p) => p.tasks.length), [10, 10, 10, 10, 10, 3]);
  assert.deepEqual(phases.map((p) => p.firstTask), [1, 11, 21, 31, 41, 51]);
  assert.ok(phases.every((p) => p.count === 6));
  assert.deepEqual(phases.flatMap((p) => p.tasks), result.value.taskItems);
  assert.ok(phases.length <= IMPLEMENTATION_MAX_PHASES);
});

test("57 tasks split into five phases of ten and one of seven, in plan order", () => {
  const tasks = run6Tasks();
  const phases = planPhases(tasks, 10);
  assert.deepEqual(phases.map((p) => p.tasks.length), [10, 10, 10, 10, 10, 7]);
  assert.deepEqual(phases.map((p) => p.index), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(phases.map((p) => p.firstTask), [1, 11, 21, 31, 41, 51]);
  assert.ok(phases.every((p) => p.count === 6));
  // No task is dropped, repeated or reordered.
  assert.deepEqual(phases.flatMap((p) => p.tasks), tasks);
  // The first and last lines of each slice are the plan's own, by position.
  assert.equal(phases[1].tasks[0], tasks[10]);
  assert.equal(phases[5].tasks[6], tasks[56]);
});

test("exactly one phase of tasks is one phase, and one task more is a second", () => {
  const ten = Array.from({ length: 10 }, (_, i) => `task ${i + 1}`);
  assert.deepEqual(planPhases(ten, 10).map((p) => p.tasks.length), [10]);
  assert.deepEqual(planPhases([...ten, "task 11"], 10).map((p) => p.tasks.length), [10, 1]);
  assert.deepEqual(planPhases(["only"], 10).map((p) => [p.index, p.count, p.firstTask]), [[1, 1, 1]]);
});

test("a phase size that is not a positive integer, or an empty task list, is a programming error", () => {
  assert.throws(() => planPhases(["a"], 0), /phase size must be a positive integer/);
  assert.throws(() => planPhases(["a"], 2.5), /phase size must be a positive integer/);
  assert.throws(() => planPhases([], 10), /cannot split an empty task list/);
});

test("writePlanDoc writes the content verbatim and returns the parsed document", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-plan-doc-"));
  try {
    const content = planDoc();
    const { path, doc } = writePlanDoc(root, "demo", content);
    assert.equal(path, join(root, "docs", "features", "demo", "plan.md"));
    // Verbatim: the bytes written are the bytes given, so the hash a later
    // stage computes over the file is a hash of what the author produced.
    assert.equal(readFileSync(path, "utf8"), content);
    assert.equal(doc.planFor, SPEC_HASH);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writePlanDoc refuses an invalid document rather than writing it", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-plan-doc-"));
  try {
    assert.throws(
      () => writePlanDoc(root, "demo", planDoc({ frontmatter: "feature: Thing" })),
      /plan is missing the frontmatter field plan_for/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
