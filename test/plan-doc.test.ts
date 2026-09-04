import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePlanDoc, writePlanDoc } from "../src/plan-doc.ts";

const SPEC_HASH = "a".repeat(64);

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
