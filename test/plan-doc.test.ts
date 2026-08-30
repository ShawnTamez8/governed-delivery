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
    overrides.coverage ?? "## Coverage\n\n- It does the thing -> test/thing.test.ts\n";
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
      criterion: "It does the thing",
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

test("a missing Coverage section is refused by name", () => {
  assert.match(refusal(planDoc({ coverage: "" })), /plan is missing the ## Coverage section/);
});

test("an empty coverage list is refused", () => {
  assert.match(refusal(planDoc({ coverage: "## Coverage\n" })), /coverage must not be empty/);
});

test("a coverage line matching neither form is refused naming the line", () => {
  assert.match(
    refusal(planDoc({ coverage: "## Coverage\n\n- It does the thing\n" })),
    /coverage entry must be '<criterion> -> <artifact>'/
  );
});

test("a coverage line with an empty target is refused", () => {
  assert.match(
    refusal(planDoc({ coverage: "## Coverage\n\n- It does the thing ->\n" })),
    /coverage entry must name a criterion and a target/
  );
});

test("a well-formed not_applicable entry carries both halves", () => {
  const result = validatePlanDoc(
    planDoc({
      coverage:
        "## Coverage\n\n- It logs on startup -> not_applicable: logging is observed, not asserted / verified by the smoke run's recorded output\n",
    })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.coverage, [
    {
      criterion: "It logs on startup",
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
      planDoc({ coverage: "## Coverage\n\n- It logs on startup -> not_applicable: hard to assert\n" })
    ),
    /coverage entry for It logs on startup says not_applicable without both a rationale and an alternative verification/
  );
});

test("not_applicable without a rationale is refused naming the criterion", () => {
  assert.match(
    refusal(
      planDoc({ coverage: "## Coverage\n\n- It logs on startup -> not_applicable:  / checked by hand\n" })
    ),
    /coverage entry for It logs on startup says not_applicable without both a rationale and an alternative verification/
  );
});

test("a bare not_applicable is refused", () => {
  assert.match(
    refusal(planDoc({ coverage: "## Coverage\n\n- It logs on startup -> not_applicable\n" })),
    /says not_applicable without both a rationale and an alternative verification/
  );
});

test("a criterion containing an arrow splits at the last one", () => {
  // Criterion prose may legitimately contain an arrow; the artifact path is
  // the tail. Splitting at the first arrow truncated the criterion and
  // fabricated an artifact from its tail.
  const result = validatePlanDoc(
    planDoc({ coverage: "## Coverage\n\n- the a->b mapping works -> src/a1.ts\n" })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.coverage[0].criterion, "the a->b mapping works");
  assert.equal(result.value.coverage[0].artifact, "src/a1.ts");
});

test("a rationale containing a slash splits at the delimiter, not the slash", () => {
  // The rationale is prose and may cite paths. Splitting at the first slash
  // corrupted both halves while both still validated — a silently fabricated
  // coverage record.
  const result = validatePlanDoc(
    planDoc({
      coverage:
        "## Coverage\n\n- It logs on startup -> not_applicable: no check in test/unit/a.test.ts yet / verified manually\n",
    })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.coverage[0].rationale, "no check in test/unit/a.test.ts yet");
  assert.equal(result.value.coverage[0].alternativeVerification, "verified manually");
});

test("an artifact path beginning with not_applicable is an artifact, not a decision", () => {
  const result = validatePlanDoc(
    planDoc({ coverage: "## Coverage\n\n- It logs on startup -> not_applicable.test.ts\n" })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.coverage[0].artifact, "not_applicable.test.ts");
  assert.equal(result.value.coverage[0].rationale, null);
});

test("the spaced not_applicable form is still a decision with both halves", () => {
  const result = validatePlanDoc(
    planDoc({ coverage: "## Coverage\n\n- It logs on startup -> not_applicable : hard to assert / checked by hand\n" })
  );
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(result.value.coverage[0].rationale, "hard to assert");
  assert.equal(result.value.coverage[0].alternativeVerification, "checked by hand");
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
