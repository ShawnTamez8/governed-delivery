import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_MAX_LIFETIME_SECONDS,
  MATERIAL_THRESHOLD,
  REMEDIATION_ROUNDS,
  REQUIRED_SPECIALTIES,
  RUN_DURATION_LIMIT_SECONDS,
  VERIFY_COMMAND_TIMEOUT_SECONDS,
  VERIFY_RETENTION_MAX_BYTES,
  VERIFY_ENV_PASSTHROUGH,
  buildPolicy,
  policyHash,
} from "../src/policy.ts";
import { DISPOSITIONS, SEVERITIES } from "../src/finding.ts";
import { PROMPT_MAX_BYTES, RESULT_MAX_BYTES } from "../src/harness.ts";
import { PROTECTED_PATH_PREFIXES } from "../src/scope.ts";
import { PANEL_SIZE, RISKS } from "../src/select.ts";

test("buildPolicy is stable across calls and hashes deterministically", () => {
  assert.deepEqual(buildPolicy(), buildPolicy());
  assert.equal(policyHash(buildPolicy()), policyHash(buildPolicy()));
});

test("every policy value is the one the enforcing module actually uses", () => {
  const p = buildPolicy();
  assert.deepEqual(p.panelSizes, PANEL_SIZE);
  assert.equal(p.remediationRounds, REMEDIATION_ROUNDS);
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

test("buildPolicy hands out a copy: mutating the result cannot change the live panel sizes", () => {
  const p = buildPolicy();
  p.panelSizes.standard = 99;
  assert.notEqual(PANEL_SIZE.standard, 99);
  assert.equal(buildPolicy().panelSizes.standard, PANEL_SIZE.standard);
});

test("any change to policy changes its hash", () => {
  const base = buildPolicy();
  const before = policyHash(base);
  assert.notEqual(policyHash({ ...base, remediationRounds: base.remediationRounds + 1 }), before);
  assert.notEqual(policyHash({ ...base, materialityThreshold: "low" }), before);
  assert.notEqual(policyHash({ ...base, panelSizes: { ...base.panelSizes, standard: 5 } }), before);
});

test("the risk values match the panel-size map exactly", () => {
  // Anti-drift: a risk level with no panel size (or the reverse) would let a
  // stage select an undefined-size panel.
  assert.deepEqual([...RISKS].sort(), Object.keys(PANEL_SIZE).sort());
});
