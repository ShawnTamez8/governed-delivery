import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_MAX_LIFETIME_SECONDS,
  MATERIAL_THRESHOLD,
  PANEL_SIZE_CEILING,
  PANEL_SIZE_FLOOR,
  PANEL_SIZE_MAX,
  PLAN_REVIEW_ROUNDS,
  REQUIRED_SPECIALTIES,
  SPEC_REVIEW_ROUNDS,
  RUN_DURATION_LIMIT_SECONDS,
  VERIFY_COMMAND_TIMEOUT_SECONDS,
  VERIFY_RETENTION_MAX_BYTES,
  VERIFY_ENV_PASSTHROUGH,
  buildPolicy,
  invalidPolicyReason,
  policyHash,
} from "../src/policy.ts";
import { DISPOSITIONS, SEVERITIES } from "../src/finding.ts";
import { PROMPT_MAX_BYTES, RESULT_MAX_BYTES } from "../src/harness.ts";
import { PROTECTED_PATH_PREFIXES } from "../src/scope.ts";
import { RISKS, computeRisk } from "../src/select.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("buildPolicy is stable across calls and hashes deterministically", () => {
  assert.deepEqual(buildPolicy(), buildPolicy());
  assert.equal(policyHash(buildPolicy()), policyHash(buildPolicy()));
});

test("every policy value is the one the enforcing module actually uses", () => {
  const p = buildPolicy();
  assert.equal(p.specReviewRounds, SPEC_REVIEW_ROUNDS);
  assert.equal(p.planReviewRounds, PLAN_REVIEW_ROUNDS);
  assert.equal(p.panelSizeMin, PANEL_SIZE_FLOOR);
  assert.equal(p.panelSizeMax, PANEL_SIZE_MAX);
  assert.equal(p.materialityThreshold, MATERIAL_THRESHOLD);
  assert.deepEqual(p.severities, [...SEVERITIES]);
  assert.deepEqual(p.dispositions, [...DISPOSITIONS]);
  assert.deepEqual(p.requiredSpecialties, [...REQUIRED_SPECIALTIES]);
  assert.deepEqual(p.protectedPathPrefixes, [...PROTECTED_PATH_PREFIXES]);
  assert.equal(p.promptMaxBytes, PROMPT_MAX_BYTES);
  assert.equal(p.resultMaxBytes, RESULT_MAX_BYTES);
  assert.equal(p.approvalMaxLifetimeSeconds, APPROVAL_MAX_LIFETIME_SECONDS);
  assert.equal(p.runDurationLimitSeconds, RUN_DURATION_LIMIT_SECONDS);
  assert.equal(p.verifyCommandTimeoutSeconds, VERIFY_COMMAND_TIMEOUT_SECONDS);
  assert.equal(p.verifyRetentionMaxBytes, VERIFY_RETENTION_MAX_BYTES);
  assert.deepEqual(p.verifyEnvPassthrough, [...VERIFY_ENV_PASSTHROUGH]);
});

test("no verification passthrough name can carry governance material to a command", () => {
  // Modelled on the same assertion in `test/executor.test.ts`. A verification
  // command is implementer-authored code; it must not be able to read
  // BW_APPROVAL_PUBLIC_KEY, the key that binds the approval signer.
  for (const name of VERIFY_ENV_PASSTHROUGH) {
    assert.ok(!name.startsWith("BW_"), `${name} must not reach a verification command`);
  }
});

test("the materiality threshold names a real severity", () => {
  assert.ok(SEVERITIES.includes(MATERIAL_THRESHOLD));
});

test("buildPolicy hands out a copy: mutating the result cannot change the live values", () => {
  const p = buildPolicy();
  p.requiredSpecialties.push("invented");
  assert.deepEqual(buildPolicy().requiredSpecialties, [...REQUIRED_SPECIALTIES]);
});

test("any change to policy changes its hash", () => {
  const base = buildPolicy();
  const before = policyHash(base);
  assert.notEqual(policyHash({ ...base, specReviewRounds: base.specReviewRounds + 1 }), before);
  assert.notEqual(policyHash({ ...base, planReviewRounds: base.planReviewRounds + 1 }), before);
  assert.notEqual(policyHash({ ...base, materialityThreshold: "low" }), before);
  assert.notEqual(policyHash({ ...base, panelSizeMax: base.panelSizeMax + 1 }), before);
});

test("every value computeRisk can return is a declared risk value", () => {
  // Anti-drift, retargeted: risk no longer sizes the panel, but the store's
  // validation and the migration CHECK still constrain it, so a value
  // `computeRisk` can return that RISKS does not list would be written and
  // then refused.
  const produced = new Set<string>();
  for (const kind of ["feature", "defect_fix"]) {
    for (const count of [0, 11]) {
      for (const protectedPaths of [false, true]) {
        produced.add(computeRisk(kind, count, protectedPaths));
      }
    }
  }
  assert.deepEqual([...produced].sort(), [...RISKS].sort());
});

test("the configured panel maximum lies within the permitted bounds", () => {
  assert.ok(Number.isInteger(PANEL_SIZE_MAX));
  assert.ok(PANEL_SIZE_MAX >= PANEL_SIZE_FLOOR, `${PANEL_SIZE_MAX} is below the floor ${PANEL_SIZE_FLOOR}`);
  assert.ok(PANEL_SIZE_MAX <= PANEL_SIZE_CEILING, `${PANEL_SIZE_MAX} is above the ceiling ${PANEL_SIZE_CEILING}`);
});

test("the policy this code builds is one it accepts", () => {
  assert.equal(invalidPolicyReason(buildPolicy()), null);
});

test("a policy missing a field this code enforces is refused, naming the field", () => {
  const { panelSizeMax, ...missing } = buildPolicy();
  const reason = invalidPolicyReason(missing);
  assert.match(String(reason), /missing panelSizeMax/);
});

test("a policy still carrying a superseded field is refused, naming it obsolete", () => {
  // The exact shape a pre-Task-3 profile froze: a per-risk panel map and a
  // remediation round count, neither of which this code reads.
  const obsolete = { ...buildPolicy(), panelSizes: { low: 1, standard: 2, high: 3 }, remediationRounds: 3 };
  const reason = invalidPolicyReason(obsolete);
  assert.match(String(reason), /obsolete panelSizes, remediationRounds/);
});

test("a round count that is not a positive integer is refused", () => {
  for (const bad of [0, -1, 1.5, "1", null, undefined]) {
    assert.match(
      String(invalidPolicyReason({ ...buildPolicy(), specReviewRounds: bad })),
      /specReviewRounds must be a positive integer/,
      `specReviewRounds ${JSON.stringify(bad)} must be refused`
    );
    assert.match(
      String(invalidPolicyReason({ ...buildPolicy(), planReviewRounds: bad })),
      /planReviewRounds must be a positive integer/,
      `planReviewRounds ${JSON.stringify(bad)} must be refused`
    );
  }
});

test("a panel maximum outside 2-5 is refused, and both ends are tested", () => {
  assert.match(
    String(invalidPolicyReason({ ...buildPolicy(), panelSizeMin: 1, panelSizeMax: 1 })),
    /panel sizes 1-1 are outside the permitted 2-5/
  );
  assert.match(
    String(invalidPolicyReason({ ...buildPolicy(), panelSizeMax: 6 })),
    /panel sizes 2-6 are outside the permitted 2-5/
  );
  // Legal but not today's configured value: still accepted, because a run is
  // governed by what it froze (hard rule 6), not by what is configured now.
  assert.equal(invalidPolicyReason({ ...buildPolicy(), panelSizeMax: 5 }), null);
});

test("a panel minimum above the maximum is refused", () => {
  assert.match(
    String(invalidPolicyReason({ ...buildPolicy(), panelSizeMin: 4, panelSizeMax: 3 })),
    /panel sizes 4-3 are outside the permitted 2-5/
  );
});

test("required specialties are unique and fit within the maximum panel", () => {
  assert.match(
    String(
      invalidPolicyReason({
        ...buildPolicy(),
        requiredSpecialties: ["security", "security"],
      })
    ),
    /requiredSpecialties must not contain duplicates/
  );
  assert.match(
    String(
      invalidPolicyReason({
        ...buildPolicy(),
        requiredSpecialties: ["one", "two", "three"],
      })
    ),
    /3 required specialties, which cannot fit in its maximum panel of 2/
  );
});

test("a materiality threshold that is not a real severity is refused", () => {
  assert.match(
    String(invalidPolicyReason({ ...buildPolicy(), materialityThreshold: "catastrophic" })),
    /materialityThreshold must be one of/
  );
});

test("a string array field holding a non-string is refused", () => {
  assert.match(
    String(invalidPolicyReason({ ...buildPolicy(), requiredSpecialties: ["ok", 7] })),
    /requiredSpecialties must be an array of strings/
  );
});

test("something that is not a policy object at all is refused", () => {
  for (const bad of [null, undefined, "policy", 7, []]) {
    assert.match(String(invalidPolicyReason(bad)), /carries no policy object/);
  }
});


// --- the review configuration has one source, read where it is enforced -----

const SRC = join(fileURLToPath(new URL("..", import.meta.url)), "src");

/**
 * The constants a stage must never read directly. Each is frozen into the
 * profile at run start, and a stage that imported the live value would govern
 * the run by whatever is configured *now* — the opposite of hard rule 6, and
 * invisible, because the profile would still record the value the run froze.
 *
 * Round counts are frozen now but remain inactive until Task 9 can give a
 * round its promised panel-and-reconciliation meaning. The other values are
 * active now and must be read from the profile rather than these defaults.
 */
const FROZEN_ONLY = [
  "SPEC_REVIEW_ROUNDS",
  "PLAN_REVIEW_ROUNDS",
  "PANEL_SIZE_MAX",
  "PANEL_SIZE_FLOOR",
  "PANEL_SIZE_CEILING",
  "MATERIAL_THRESHOLD",
  "REQUIRED_SPECIALTIES",
];

/** The modules that execute a run, as opposed to those that configure one. */
const STAGE_MODULES = [
  "spec-stage.ts",
  "plan-stage.ts",
  "plan-gate.ts",
  "implementation-stage.ts",
  "verification-stage.ts",
];

test("no stage reads a review-policy constant directly: it comes from the frozen profile", () => {
  const offenders: string[] = [];
  for (const file of STAGE_MODULES) {
    const source = readFileSync(join(SRC, file), "utf8");
    for (const match of source.matchAll(/^import\s[\s\S]*?from\s+"\.\/(policy|select)\.ts";$/gm)) {
      for (const name of FROZEN_ONLY) {
        if (new RegExp(`\\b${name}\\b`).test(match[0])) {
          offenders.push(`${file} imports ${name}`);
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these values are frozen per run and must be read from profile.policy:\n${offenders.join("\n")}`
  );
});

test("both stages read every active review value from the frozen profile", () => {
  for (const file of ["spec-stage.ts", "plan-stage.ts"]) {
    const source = readFileSync(join(SRC, file), "utf8");
    assert.ok(
      source.includes("profile.policy.panelSizeMin"),
      `${file} must read its panel size from the frozen profile`
    );
    assert.ok(
      source.includes("profile.policy.requiredSpecialties"),
      `${file} must read required specialties from the frozen profile`
    );
    assert.ok(
      source.includes("profile.policy.materialityThreshold"),
      `${file} must read materiality from the frozen profile`
    );
  }
});

test("configured round counts remain inactive until Task 9 implements reconciliation", () => {
  for (const [file, field] of [
    ["spec-stage.ts", "specReviewRounds"],
    ["plan-stage.ts", "planReviewRounds"],
  ]) {
    const source = readFileSync(join(SRC, file), "utf8");
    assert.ok(!source.includes(`profile.policy.${field}`), `${file} activates ${field} too early`);
    assert.ok(source.includes("LEGACY_CLOSURE_PASSES"), `${file} must name the transition`);
  }
});
