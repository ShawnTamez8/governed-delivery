import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  freezeProfile,
  invalidProfileReason,
  loadInspectableProfile,
  loadVerifiedProfile,
  loadProfile,
  requireFrozenBinding,
  requiredCapability,
  resolveSettings,
  resolveStartingCommit,
} from "../src/profile.ts";
import { AGENTS } from "../src/agents.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import {
  CODE_REVIEW_PANEL_SIZE,
  NARRATION_THRESHOLD,
  PANEL_SIZE_MAX,
  REQUIRED_SPECIALTIES,
  SYSTEMONE_REQUEST_TIMEOUT_MS,
  buildPolicy,
  policyHash,
  seededSandbox,
} from "../src/policy.ts";
import { narrationQuestionHash } from "../src/narration-check.ts";
import type { VerificationConfig } from "../src/governed-config.ts";
import { canonicalJson, sha256Hex } from "../src/canonical.ts";
import { freezeUniformProfile } from "./uniform-profile.ts";
import { STAND_IN_IMAGE_ID, standInSandbox } from "./fixtures/docker/stand-in.ts";

const COMMIT = "b".repeat(40);
const MODEL = "test-model";
/** One minimal frozen configuration, shared by every call site in this file. */
const VERIFICATION: VerificationConfig = { commands: [{ name: "unit", command: ["node", "--version"] }], derived: [] };
/** The seeded sandbox, at the image ID recorded from a real build. */
const SANDBOX = standInSandbox();

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "bw-profile-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("freezeProfile then loadProfile round-trips with an identical hash", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const loaded = loadProfile(root, 1);
    assert.equal(loaded.hash, frozen.hash);
    assert.deepEqual(loaded.profile, frozen.profile);
  });
});

test("freezeProfile refuses a model name the spawn cannot carry", () => {
  // The model name is operator input that reaches a spawn, and on Windows a
  // space in the name corrupts the child's argv — the audit would record one
  // invocation and the shell would run another.
  withRoot((root) => {
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, "gpt-4 mini", VERIFICATION, SANDBOX),
      /invalid model name "gpt-4 mini": must be 1-64 characters of letters, digits, dot, underscore, or hyphen, starting with a letter or digit/
    );
    assert.throws(() => freezeProfile(root, 1, COMMIT, " ", VERIFICATION, SANDBOX), /invalid model name/);
  });
});

test("altering the profile file changes its hash", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    appendFileSync(frozen.path, " ");
    assert.notEqual(loadProfile(root, 1).hash, frozen.hash);
  });
});

test("the profile records every seeded agent and the executor", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.deepEqual(
      profile.agents.map((a) => a.id).sort(),
      [...AGENTS].map((a) => a.id).sort()
    );
    assert.equal(profile.executor.id, CLAUDE_CODE.id);
    assert.equal(profile.startingCommit, COMMIT);
    assert.equal(profile.runId, 1);
  });
});

test("the profile's policy hash is the live policy's hash", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.equal(profile.policyHash, policyHash(buildPolicy()));
    assert.equal(profile.policyHash, policyHash(profile.policy));
  });
});

test("two freezes differ by their timestamp but agree on policy", () => {
  withRoot((root) => {
    const a = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const b = freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.notEqual(a.hash, b.hash);
    assert.equal(a.profile.policyHash, b.profile.policyHash);
  });
});

test("a missing profile is refused naming the run and the path", () => {
  withRoot((root) => {
    assert.throws(() => loadProfile(root, 7), /no frozen profile for run 7 at .+profile\.json/);
  });
});

test("resolveStartingCommit returns null outside a git repository", () => {
  withRoot((root) => {
    assert.equal(resolveStartingCommit(root), null);
  });
});

test("resolveStartingCommit reads HEAD inside this repository", () => {
  const commit = resolveStartingCommit(process.cwd());
  assert.match(commit ?? "", /^[0-9a-f]{40}$/);
});

test("resolveStartingCommit reads HEAD in a sha256 object-format repository", () => {
  withRoot((root) => {
    // Asserted, not skipped: git 2.29 and newer support this, and a git too
    // old to run it should fail the test rather than pass it vacuously.
    const init = spawnSync("git", ["init", "-q", "--object-format=sha256", root], { encoding: "utf8" });
    assert.equal(init.status, 0, `git init --object-format=sha256 failed: ${init.stderr}`);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    };
    const commit = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "base"], { cwd: root, env, encoding: "utf8" });
    assert.equal(commit.status, 0, commit.stderr);
    // A sha256 repository's OIDs are 64 hex characters. Rejecting them makes
    // the run freeze `startingCommit: null`, and the approval gate then
    // refuses with "not created in a git repository" — a wrong reason for a
    // real repository.
    assert.match(resolveStartingCommit(root) ?? "", /^[0-9a-f]{64}$/);
  });
});

test("the profile freezes the approval key fingerprint, or null when none is configured", () => {
  const before = process.env.BW_APPROVAL_PUBLIC_KEY;
  const keyDir = mkdtempSync(join(tmpdir(), "bw-profile-key-"));
  try {
    withRoot((root) => {
      // Pointed at a path that cannot exist, not deleted: the deleted fallback
      // is the default ~/.buildworks/approval.pub, which the operator's real
      // machine may well have — then the freeze would bind that key and this
      // null assertion would fail for an environment reason.
      process.env.BW_APPROVAL_PUBLIC_KEY = join(keyDir, "no-such-key.pub");
      // No key at intake is the normal case on a fresh machine and must not
      // fail run creation — it records null and the gate says so in the audit.
      assert.equal(freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX).profile.approvalSigner, null);

      const { publicKey } = generateKeyPairSync("ed25519");
      const der = publicKey.export({ format: "der", type: "spki" });
      const pubPath = join(keyDir, "approval.pub");
      writeFileSync(pubPath, publicKey.export({ format: "pem", type: "spki" }) as string);
      process.env.BW_APPROVAL_PUBLIC_KEY = pubPath;
      // The expected value comes from the key's own DER encoding, not from
      // anything this test invented: it is the same identifier the gate
      // recomputes at approve time.
      assert.equal(freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION, SANDBOX).profile.approvalSigner, sha256Hex(der));
    });
  } finally {
    if (before === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = before;
    rmSync(keyDir, { recursive: true, force: true });
  }
});

// --- per-setting model and effort (stage-role-model-overrides Task 2) --------

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const REVIEWER_IDS = AGENTS.filter((a) => a.role === "reviewer").map((a) => a.id);
const NON_REVIEWER_SETTINGS = ["spec-author", "plan-author", "implementer", "acceptance-test-author", "reconciler"];

function profilePathOf(root: string, runId: number): string {
  return join(root, ".governance", "profiles", String(runId), "profile.json");
}

/** The seeded defaults, spelled out here rather than read back from `DEFAULT_SETTINGS`. */
function seededFor(runModel: string) {
  return {
    "spec-author": { model: "claude-opus-5-5", effort: "high" },
    "plan-author": { model: "claude-opus-5-5", effort: "high" },
    implementer: { model: SONNET, effort: "medium" },
    // The operator's choice from the protected-acceptance-tests plan's Task 4 evaluation (2026-10-21).
    "acceptance-test-author": { model: SONNET, effort: "medium" },
    reconciler: { model: runModel, effort: "medium" },
    "code-review-reconciler": { model: HAIKU, effort: "medium" },
    "spec-reviewer-traceability": { model: HAIKU, effort: "medium" },
    "spec-reviewer-security": { model: HAIKU, effort: "medium" },
    "spec-reviewer-consistency": { model: HAIKU, effort: "medium" },
    "code-reviewer-correctness": { model: HAIKU, effort: "medium" },
    "code-reviewer-security": { model: HAIKU, effort: "medium" },
    "code-reviewer-state-integrity": { model: HAIKU, effort: "medium" },
  };
}

test("with no overrides the profile freezes all twelve settings at their seeded defaults", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION, SANDBOX);
    assert.deepEqual(profile.dispatchSettings, seededFor("chosen-model"));
    assert.deepEqual(resolveSettings(profile, "plan-author"), {
      ok: true,
      model: "claude-opus-5-5",
      effort: "high",
    });
    assert.deepEqual(resolveSettings(profile, "reconciler"), {
      ok: true,
      model: "chosen-model",
      effort: "medium",
    });
    assert.deepEqual(resolveSettings(profile, "spec-author"), {
      ok: true,
      model: "claude-opus-5-5",
      effort: "high",
    });
  });
});

test("modelFor and effortFor override only the named settings", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION, SANDBOX, {}, {
      modelFor: { "spec-reviewer-security": "other-model" },
      effortFor: { implementer: "low" },
    });
    const expected = seededFor("chosen-model");
    expected["spec-reviewer-security"] = { model: "other-model", effort: "medium" };
    expected.implementer = { model: SONNET, effort: "low" };
    assert.deepEqual(profile.dispatchSettings, expected);
  });
});

test("the reconciler is set independently of the spec and plan authors", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION, SANDBOX, {}, {
      modelFor: { reconciler: "recon-model" },
      effortFor: { reconciler: "xhigh" },
    });
    const expected = seededFor("chosen-model");
    expected.reconciler = { model: "recon-model", effort: "xhigh" };
    assert.deepEqual(profile.dispatchSettings, expected);
  });
});

test("a run-wide effort reaches every non-reviewer setting, and a per-name value beats it", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION, SANDBOX, {}, {
      effort: "low",
      effortFor: { implementer: "max" },
    });
    const efforts = Object.fromEntries(
      Object.entries(profile.dispatchSettings).map(([name, s]) => [name, s.effort])
    );
    assert.equal(efforts.implementer, "max");
    for (const name of NON_REVIEWER_SETTINGS.filter((n) => n !== "implementer")) {
      assert.equal(efforts[name], "low", `${name} must take the run-wide effort`);
    }
  });
});

test("a run-wide effort never reaches a reviewer", () => {
  // Operator decision 2026-09-29: `--effort high` must not put a reviewer at
  // high. The six reviewers keep their seeded effort.
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION, SANDBOX, {}, {
      effort: "xhigh",
    });
    assert.equal(REVIEWER_IDS.length, 6);
    for (const id of REVIEWER_IDS) {
      assert.equal(profile.dispatchSettings[id]!.effort, "medium", `${id} must stay at its seeded effort`);
    }
    for (const name of NON_REVIEWER_SETTINGS) {
      assert.equal(profile.dispatchSettings[name]!.effort, "xhigh", `${name} must take the run-wide effort`);
    }
  });
});

test("a run-wide effort never reaches the code-review reconciler", () => {
  // It was measured only at its seeded medium (the run 6 replays), so like a
  // reviewer it moves only through its own --effort-for.
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION, SANDBOX, {}, {
      effort: "xhigh",
    });
    assert.deepEqual(profile.dispatchSettings["code-review-reconciler"], { model: HAIKU, effort: "medium" });
  });
});

test("the code-review reconciler's own model-for and effort-for reach it and nothing else", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION, SANDBOX, {}, {
      modelFor: { "code-review-reconciler": "recon-model" },
      effortFor: { "code-review-reconciler": "low" },
    });
    const expected = seededFor("chosen-model");
    expected["code-review-reconciler"] = { model: "recon-model", effort: "low" };
    assert.deepEqual(profile.dispatchSettings, expected);
  });
});

test("an explicit effortFor can raise one reviewer to max and leaves the other five alone", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION, SANDBOX, {}, {
      effortFor: { "code-reviewer-security": "max" },
    });
    assert.equal(profile.dispatchSettings["code-reviewer-security"]!.effort, "max");
    for (const id of REVIEWER_IDS.filter((r) => r !== "code-reviewer-security")) {
      assert.equal(profile.dispatchSettings[id]!.effort, "medium");
    }
  });
});

test("an invalid level, invalid model, unknown setting, or agent with no default is refused and writes nothing", () => {
  withRoot((root) => {
    const extraAuthor = { ...AGENTS.find((a) => a.id === "spec-author")!, id: "extra-author" };
    const cases: Array<[string, () => unknown, RegExp]> = [
      ["run-wide effort", () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, { effort: "ultracode" }),
        /invalid effort "ultracode": allowed values are low, medium, high, xhigh, max/],
      ["per-name effort", () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, { effortFor: { implementer: "hi" } }),
        /invalid effort "hi"/],
      ["per-name model", () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, { modelFor: { implementer: "bad model" } }),
        /invalid model name "bad model"/],
      ["unknown model-for name", () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, { modelFor: { nobody: "m" } }),
        /--model-for names unknown setting nobody: known settings are .*reconciler/],
      ["unknown effort-for name", () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, { effortFor: { nobody: "low" } }),
        /--effort-for names unknown setting nobody/],
      ["agent with no default", () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, { agents: [...AGENTS, extraAuthor] }),
        /no default settings for extra-author/],
    ];
    for (const [label, run, message] of cases) {
      assert.throws(run, message, label);
      assert.equal(existsSync(profilePathOf(root, 1)), false, `${label}: nothing may be written`);
    }
  });
});

test("the shared stage-test helper freezes all twelve settings at the model passed and medium", () => {
  withRoot((root) => {
    const { profile } = freezeUniformProfile(root, 1, COMMIT, "m", VERIFICATION);
    assert.equal(Object.keys(profile.dispatchSettings).length, 12);
    for (const [name, setting] of Object.entries(profile.dispatchSettings)) {
      assert.deepEqual(setting, { model: "m", effort: "medium" }, name);
    }
  });
});

test("staffing refusals come before any settings refusal", () => {
  withRoot((root) => {
    const depleted = AGENTS.filter((a) => a.role !== "reviewer");
    assert.throws(
      () =>
        freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, { agents: depleted }, {
          effort: "ultracode",
          modelFor: { nobody: "m" },
        }),
      /cannot freeze a profile for run 1: the agent registry has no reviewer for required specialty/
    );
  });
});

test("resolveSettings refuses an unmapped setting naming the mapped ones", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const result = resolveSettings(profile, "verification");
    assert.equal(result.ok, false);
    if (result.ok) return;
    // Section 10: the failure is at configuration time and must name what the
    // frozen profile does map, so the operator can see what is missing.
    assert.match(result.reason, /no dispatch settings configured for verification/);
    assert.match(result.reason, /implementer/);
    assert.match(result.reason, /reconciler/);
  });
});

test("a profile with modelMap and no dispatchSettings is refused by name", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const { dispatchSettings, ...rest } = profile;
    const superseded = { ...rest, modelMap: { spec: MODEL } };
    assert.match(
      String(invalidProfileReason(superseded)),
      /carries a modelMap and no dispatchSettings: it was frozen under a superseded configuration/
    );
    // Through the verified door, with a matching hash, so the shape is what refuses it.
    const serialized = canonicalJson(superseded);
    writeFileSync(profilePathOf(root, 1), serialized);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: sha256Hex(serialized) });
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.match(verified.reason, /superseded configuration/);
    assert.match(verified.reason, /must be replaced by a fresh one/);
  });
});

test("a profile whose dispatchSettings lacks an entry or holds a bad value is refused", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const without = (name: string) => {
      const { [name]: _dropped, ...kept } = profile.dispatchSettings;
      return { ...profile, dispatchSettings: kept };
    };
    assert.match(String(invalidProfileReason(without("reconciler"))), /no entry for reconciler/);
    assert.match(
      String(invalidProfileReason(without("code-review-reconciler"))),
      /no entry for code-review-reconciler/
    );
    assert.match(String(invalidProfileReason(without("implementer"))), /no entry for implementer/);
    assert.match(
      String(
        invalidProfileReason({
          ...profile,
          dispatchSettings: { ...profile.dispatchSettings, implementer: { model: SONNET, effort: "ultracode" } },
        })
      ),
      /effort for implementer must be one of/
    );
    assert.match(
      String(
        invalidProfileReason({
          ...profile,
          dispatchSettings: { ...profile.dispatchSettings, implementer: { model: "bad model", effort: "low" } },
        })
      ),
      /model for implementer must be a valid model name/
    );
    assert.match(
      String(invalidProfileReason({ ...profile, dispatchSettings: [] })),
      /carries no dispatchSettings/
    );
  });
});

test("requiredCapability maps the six dispatchable stage kinds", () => {
  assert.equal(requiredCapability("spec"), "spec");
  assert.equal(requiredCapability("spec_review"), "review");
  assert.equal(requiredCapability("plan"), "plan");
  assert.equal(requiredCapability("plan_review"), "review");
  assert.equal(requiredCapability("implementation"), "implementation");
  assert.equal(requiredCapability("code_review"), "review");
  assert.equal(requiredCapability("verification"), null);
});

test("requireFrozenBinding accepts the frozen executor with the required capability", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.deepEqual(requireFrozenBinding(profile, CLAUDE_CODE, "implementation"), { ok: true });
    assert.deepEqual(requireFrozenBinding(profile, CLAUDE_CODE, "spec_review"), { ok: true });
  });
});

test("requireFrozenBinding refuses an executor that differs from the frozen one, even with the same id", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const different = {
      ...CLAUDE_CODE,
      sandbox: { ...CLAUDE_CODE.sandbox, idleTimeoutSeconds: 999 },
    };
    const verdict = requireFrozenBinding(profile, different, "implementation");
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.reason, /does not match the executor frozen at run start/);
  });
});

test("requireFrozenBinding refuses a missing capability naming capability and kind", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const without = {
      ...profile,
      executor: {
        ...CLAUDE_CODE,
        capabilities: CLAUDE_CODE.capabilities.filter((c) => c !== "implementation"),
      },
    };
    const verdict = requireFrozenBinding(without, without.executor, "implementation");
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.reason, /lacks the required capability "implementation" for stage kind implementation/);
  });
});

test("requireFrozenBinding refuses an unknown stage kind by name", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const verdict = requireFrozenBinding(profile, CLAUDE_CODE, "delivery_check");
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.reason, /no executor capability defined for stage kind delivery_check/);
  });
});


// --- the frozen-profile validity rule (step 5b Task 3) ----------------------

/**
 * The exact policy shape this repository froze before step 5b Task 3, read off
 * `src/policy.ts` at commit cd11071: a per-risk panel map and a remediation
 * round count, with none of the four fields the review stages read today.
 *
 * Built by transforming the current policy rather than typed out in full, so
 * the fields that did *not* change cannot drift into being this file's opinion
 * of them. Only the difference the change actually made is stated here.
 */
function preTask3Policy(): Record<string, unknown> {
  const {
    specReviewRounds,
    planReviewRounds,
    panelSizeMin,
    panelSizeMax,
    codeReviewPanelSize,
    codeReviewMaxRounds,
    ...carried
  } = buildPolicy();
  return { ...carried, panelSizes: { low: 1, standard: 2, high: 3 }, remediationRounds: 3 };
}

/**
 * Write a profile whose bytes are internally correct in every way the previous
 * code cared about — its `policyHash` describes its own policy and the run row
 * records the file's hash — but whose policy is the superseded shape.
 *
 * This is the case the decision is about. A corrupted or tampered profile is
 * already refused by the hash comparison; this one passes that comparison and
 * still cannot be executed.
 */
function writePreTask3Profile(root: string, runId: number): { hash: string } {
  const { profile } = freezeProfile(root, runId, COMMIT, MODEL, VERIFICATION, SANDBOX);
  const policy = preTask3Policy();
  const stale = { ...profile, policy, policyHash: sha256Hex(canonicalJson(policy)) };
  const serialized = canonicalJson(stale);
  writeFileSync(join(root, ".governance", "profiles", String(runId), "profile.json"), serialized);
  return { hash: sha256Hex(serialized) };
}

test("the profile this code freezes is one it accepts", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.equal(invalidProfileReason(profile), null);
  });
});

test("a current profile loads and verifies", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: frozen.hash });
    assert.equal(verified.ok, true, (verified as { reason?: string }).reason);
  });
});

test("a correctly hashed pre-Task-3 profile is refused by name, not migrated", () => {
  withRoot((root) => {
    const { hash } = writePreTask3Profile(root, 1);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: hash });
    assert.equal(verified.ok, false, "a superseded policy shape must not execute");
    if (verified.ok) return;
    // Named, so an operator can tell this from a tampered profile.
    assert.match(verified.reason, /run 1 cannot be executed/);
    assert.match(verified.reason, /missing codeReviewMaxRounds, codeReviewPanelSize, panelSizeMax, panelSizeMin, planReviewRounds, specReviewRounds/);
    assert.match(verified.reason, /carrying obsolete panelSizes, remediationRounds/);
    // And it says what the operator can still do, because the run's evidence
    // is not what became invalid.
    assert.match(verified.reason, /records and evidence remain readable/);
  });
});

test("the pre-Task-3 profile is refused for its shape, not for its hash", () => {
  // Otherwise this proves nothing: a profile that also failed the tamper check
  // would be refused whether or not the validity rule existed.
  withRoot((root) => {
    const { hash } = writePreTask3Profile(root, 1);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: hash });
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.ok(
      !verified.reason.includes("has been modified since intake"),
      `the tamper check fired instead of the validity check: ${verified.reason}`
    );
  });
});

test("a profile predating approvalSigner is refused, while a frozen null is honoured", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    // Null is a live, supported state: no key was configured at intake.
    assert.equal(invalidProfileReason({ ...profile, approvalSigner: null }), null);
    // Absent is an obsolete shape.
    const { approvalSigner, ...without } = profile;
    assert.match(String(invalidProfileReason(without)), /carries no approvalSigner/);
  });
});

test("a profile predating after is refused, and after is null or exactly a run id and a full commit", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.equal(profile.after, null, "a run that follows nothing freezes null");
    const { after, ...without } = profile;
    assert.match(String(invalidProfileReason(without)), /carries no after: it predates the field/);
    const linked = freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, {}, { runId: 1, deliveredCommit: COMMIT }).profile;
    assert.deepEqual(linked.after, { runId: 1, deliveredCommit: COMMIT });
    assert.equal(invalidProfileReason(linked), null);
    for (const bad of [
      { runId: 0, deliveredCommit: COMMIT },
      { runId: 1, deliveredCommit: "b".repeat(39) },
      { runId: 1 },
      { runId: 1, deliveredCommit: COMMIT, slug: "demo" },
      [1, COMMIT],
      1,
    ]) {
      assert.match(
        String(invalidProfileReason({ ...profile, after: bad })),
        /the frozen profile after must be null or \{ runId, deliveredCommit \}/,
        JSON.stringify(bad)
      );
    }
  });
});

test("a profile predating narrationCheck is refused, and narrationCheck is null or exactly the six frozen values", () => {
  // The deployment is the recorded probe's; the question hash is the code's.
  const probe = JSON.parse(readFileSync(join("test", "fixtures", "recorded", "systemone-probe-snitch-resource.json"), "utf8")).provenance;
  const config = {
    endpoint: probe.endpoint as string,
    deployment: probe.deployment as string,
    deploymentType: probe.deploymentType as string,
    threshold: NARRATION_THRESHOLD,
    timeoutMs: SYSTEMONE_REQUEST_TIMEOUT_MS,
    questionHash: narrationQuestionHash(),
  };
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.equal(profile.narrationCheck, null, "a run frozen with the check off freezes null");
    const { narrationCheck, ...without } = profile;
    assert.match(String(invalidProfileReason(without)), /carries no narrationCheck: it predates the field/);
    const on = freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, {}, null, config).profile;
    assert.deepEqual(on.narrationCheck, config);
    assert.equal(invalidProfileReason(on), null);
    const { questionHash, ...missingHash } = config;
    for (const bad of [
      missingHash,
      { ...config, apiKey: "k" },
      { ...config, endpoint: "" },
      { ...config, deployment: "" },
      { ...config, deploymentType: 7 },
      { ...config, threshold: 0 },
      { ...config, threshold: 1.5 },
      { ...config, threshold: "0.8" },
      { ...config, timeoutMs: 0 },
      { ...config, timeoutMs: 1.5 },
      { ...config, questionHash: questionHash.slice(1) },
      { ...config, questionHash: questionHash.toUpperCase() },
      [config],
      "on",
    ]) {
      assert.match(
        String(invalidProfileReason({ ...profile, narrationCheck: bad })),
        /the frozen profile narrationCheck must be null or \{ endpoint, deployment, deploymentType, threshold, timeoutMs, questionHash \}/,
        JSON.stringify(bad)
      );
    }
  });
});

test("a profile predating verification.derived is refused, while an empty derived list loads", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.deepEqual(frozen.profile.verification.derived, []);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: frozen.hash });
    assert.equal(verified.ok, true, (verified as { reason?: string }).reason);
    const { derived, ...commandsOnly } = frozen.profile.verification;
    assert.equal(
      invalidProfileReason({ ...frozen.profile, verification: commandsOnly }),
      "the frozen profile carries no verification.derived: it predates the field, and a run frozen without it cannot say which files the system regenerates"
    );
  });
});

// --- the read-only door (docs/features/inspectable-frozen-profiles/plan.md) ----

/**
 * Freeze run 1, change its profile with `edit`, and rewrite it canonically.
 * The returned hash is the new bytes', so a caller that records it as the
 * run's `profile_ref` tests the shape alone, never the tamper check.
 */
function rewriteFrozen(root: string, edit: (profile: Record<string, unknown>) => void): { path: string; hash: string } {
  const frozen = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
  const profile = JSON.parse(readFileSync(frozen.path, "utf8")) as Record<string, unknown>;
  edit(profile);
  const serialized = canonicalJson(profile);
  writeFileSync(frozen.path, serialized);
  return { path: frozen.path, hash: sha256Hex(serialized) };
}

test("a correctly hashed profile without acceptance is inspectable, and its execution is refused by name", () => {
  // Every profile frozen before change 4 lacks the field (crew-chatter runs 5 to 8).
  withRoot((root) => {
    const { hash } = rewriteFrozen(root, (p) => { delete p.acceptance; });
    const inspected = loadInspectableProfile(root, { id: 1, profile_ref: hash });
    assert.equal(inspected.ok, true, (inspected as { reason?: string }).reason);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: hash });
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.match(verified.reason, /run 1 cannot be executed: the frozen profile carries no acceptance: it predates executable acceptance tests/);
  });
});

test("acceptance freezes null or exactly an acceptance/<slug>/ directory with at least two repeats", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.equal(profile.acceptance, null, "a run that did not opt in freezes null");
    // The plan's frozen block (docs/features/protected-acceptance-tests/plan.md, "Opt-in at new-run").
    const block = { dir: "acceptance/web-calculator/", repeatEach: 2 };
    const on = freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, {}, null, null, block).profile;
    assert.deepEqual(on.acceptance, block);
    assert.equal(invalidProfileReason(on), null);
    for (const bad of [
      { dir: "acceptance/web-calculator", repeatEach: 2 },
      { dir: "tests/web-calculator/", repeatEach: 2 },
      { dir: "acceptance/../src/", repeatEach: 2 },
      { dir: "acceptance/Web/", repeatEach: 2 },
      { dir: "acceptance/web-calculator/", repeatEach: 1 },
      { dir: "acceptance/web-calculator/", repeatEach: 2.5 },
      { dir: "acceptance/web-calculator/" },
      { ...block, extra: true },
      "acceptance/web-calculator/",
    ]) {
      assert.match(
        String(invalidProfileReason({ ...profile, acceptance: bad })),
        /the frozen profile acceptance must be null or \{ dir: "acceptance\/<slug>\/", repeatEach \} with repeatEach at least 2/,
        JSON.stringify(bad)
      );
    }
    assert.throws(
      () => freezeProfile(root, 3, COMMIT, MODEL, VERIFICATION, SANDBOX, {}, {}, null, null, { dir: "src/", repeatEach: 2 }),
      /cannot freeze a profile for run 3: the frozen profile acceptance must be null or/
    );
    assert.equal(existsSync(profilePathOf(root, 3)), false);
  });
});

test("a run with a suite refuses a frozen verify command named acceptance, whose log the suite's would share", () => {
  // docs/features/protected-acceptance-tests/plan.md, Task 8.
  withRoot((root) => {
    const block = { dir: "acceptance/web-calculator/", repeatEach: 2 };
    const named: VerificationConfig = { commands: [{ name: "acceptance", command: ["node", "--version"] }], derived: [] };
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, named, SANDBOX, {}, {}, null, null, block),
      /^Error: cannot freeze a profile for run 1: a run with an acceptance suite reserves the verify command name acceptance, which governed\.yaml already uses$/
    );
    assert.equal(existsSync(profilePathOf(root, 1)), false);
    // Without a suite the name is the repository's to use.
    assert.equal(freezeProfile(root, 2, COMMIT, MODEL, named, SANDBOX).profile.verification.commands[0]!.name, "acceptance");
  });
});

test("the acceptance test author is an author, so neither panel's staffing counts it", () => {
  const author = AGENTS.find((a) => a.id === "acceptance-test-author");
  assert.ok(author, "the agent is registered");
  assert.equal(author.role, "author");
  assert.ok(!author.outputs.includes("code-findings") && !author.outputs.includes("findings"));
  // With one code reviewer removed, the author present still leaves two seats
  // for a panel of three: it never fills a code-review seat.
  withRoot((root) => {
    const short = AGENTS.filter((a) => a.id !== "code-reviewer-state-integrity");
    assert.ok(short.some((a) => a.id === "acceptance-test-author"));
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, { agents: short }),
      /seats 2 code reviewers .*which cannot fill the configured code-review panel of 3/
    );
  });
});

test("a correctly hashed profile without sandbox is inspectable and still refused for execution", () => {
  withRoot((root) => {
    const { hash } = rewriteFrozen(root, (p) => { delete p.sandbox; });
    const inspected = loadInspectableProfile(root, { id: 1, profile_ref: hash });
    assert.equal(inspected.ok, true, (inspected as { reason?: string }).reason);
    if (inspected.ok) assert.equal(inspected.hash, hash);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: hash });
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.match(verified.reason, /run 1 cannot be executed: the frozen profile carries no sandbox/);
  });
});

/**
 * The policy field change 1 removed (src/policy.ts at 44a0d3a), with the value
 * every crew-chatter profile frozen before it carries; its `policyHash`
 * describes the policy with the field, as the stored profiles' do.
 */
function withObsoletePolicyField(p: Record<string, unknown>): void {
  const policy = { ...(p.policy as Record<string, unknown>),
    verifyEnvPassthrough: ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot"] };
  p.policy = policy;
  p.policyHash = policyHash(policy as never);
}

test("a profile frozen before change 1 is inspectable, and execution refuses each of its two differences", () => {
  withRoot((root) => {
    const { hash } = rewriteFrozen(root, (p) => { delete p.sandbox; withObsoletePolicyField(p); });
    const inspected = loadInspectableProfile(root, { id: 1, profile_ref: hash });
    assert.equal(inspected.ok, true, (inspected as { reason?: string }).reason);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: hash });
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.match(verified.reason, /run 1 cannot be executed: the frozen profile carries no sandbox/);
  });
  withRoot((root) => {
    // With its sandbox, the obsolete policy field alone still refuses execution.
    const { hash } = rewriteFrozen(root, withObsoletePolicyField);
    assert.equal(loadInspectableProfile(root, { id: 1, profile_ref: hash }).ok, true);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: hash });
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.match(verified.reason, /run 1 cannot be executed: the frozen policy is not the shape this code enforces: carrying obsolete verifyEnvPassthrough/);
  });
});

test("the read-only door keeps the tamper check", () => {
  withRoot((root) => {
    const { path, hash } = rewriteFrozen(root, (p) => { delete p.sandbox; });
    appendFileSync(path, " ");
    for (const load of [loadInspectableProfile, loadVerifiedProfile]) {
      const result = load(root, { id: 1, profile_ref: hash });
      assert.equal(result.ok, false, load.name);
      if (result.ok) return;
      assert.match(result.reason, /profile for run 1 has been modified since intake/, load.name);
    }
  });
});

test("a profile failing an inspectable field cannot be inspected, by name", () => {
  withRoot((root) => {
    const { hash } = rewriteFrozen(root, (p) => { delete p.policy; });
    const inspected = loadInspectableProfile(root, { id: 1, profile_ref: hash });
    assert.equal(inspected.ok, false);
    if (inspected.ok) return;
    assert.match(inspected.reason, /^run 1 cannot be inspected: the frozen profile carries no policy object$/);
  });
});

test("a present but malformed projected field cannot be inspected", () => {
  // `runConfiguration` copies both values into the snapshot, so a hash proves
  // only that the bytes are the frozen ones, not that the projection is safe.
  for (const [edit, message] of [
    [(p: Record<string, unknown>) => { (p.verification as Record<string, unknown>).derived = {}; },
      /^run 1 cannot be inspected: the frozen profile carries no verification\.derived/],
    [(p: Record<string, unknown>) => { p.narrationCheck = {}; },
      /^run 1 cannot be inspected: the frozen profile narrationCheck must be null or/],
  ] as const) {
    withRoot((root) => {
      const { hash } = rewriteFrozen(root, edit);
      const inspected = loadInspectableProfile(root, { id: 1, profile_ref: hash });
      assert.equal(inspected.ok, false);
      if (inspected.ok) return;
      assert.match(inspected.reason, message);
    });
  }
});

test("the profile freezes the plan's seeded sandbox, and a profile without one, or with a bad one, is refused", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, seededSandbox(STAND_IN_IMAGE_ID));
    // The values the plan states (docs/features/sandboxed-implementer/plan.md, Task 7).
    assert.deepEqual(profile.sandbox, {
      dockerCommand: ["docker"],
      imageId: STAND_IN_IMAGE_ID,
      limits: { cpus: "2", memory: "4g", pidsLimit: 512 },
      commandTimeoutSeconds: 300,
      egressAllowlist: ["registry.npmjs.org:443"],
      user: "node",
      env: ["npm_config_proxy=http://proxy:3128", "npm_config_https_proxy=http://proxy:3128"],
      patchDispatchBudgetUsd: "2.00",
    });
    assert.equal(invalidProfileReason(profile), null);
    const { sandbox, ...without } = profile;
    assert.match(String(invalidProfileReason(without)), /carries no sandbox: it predates the sandboxed implementer/);
    for (const [bad, message] of [
      [{ ...sandbox, imageId: "bw-sandbox:latest" }, /imageId must be a full sha256 image ID/],
      [{ ...sandbox, dockerCommand: [] }, /dockerCommand must be a non-empty array/],
      [{ ...sandbox, limits: { ...sandbox.limits, memory: "4 GB" } }, /limits must be/],
      [{ ...sandbox, commandTimeoutSeconds: 0 }, /commandTimeoutSeconds must be a positive integer/],
      [{ ...sandbox, egressAllowlist: ["https://registry.npmjs.org"] }, /host:port entries/],
      [{ ...sandbox, extra: 1 }, /must have exactly the keys/],
    ] as const) {
      assert.match(String(invalidProfileReason({ ...profile, sandbox: bad })), message, JSON.stringify(bad));
    }
    // And freezing refuses the same values before writing anything.
    assert.throws(
      () => freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION, { ...sandbox, imageId: "bw-sandbox:latest" }),
      /cannot freeze a profile for run 2: the frozen profile sandbox imageId must be a full sha256 image ID/
    );
    assert.equal(existsSync(profilePathOf(root, 2)), false);
    // Hazard 19: the ceiling plus the host grace must stay below the idle
    // budget of the executor the run freezes; that check lives at freeze time.
    assert.throws(
      () => freezeProfile(root, 3, COMMIT, MODEL, VERIFICATION, { ...sandbox, commandTimeoutSeconds: CLAUDE_CODE.sandbox.idleTimeoutSeconds - 5 }),
      /cannot freeze a profile for run 3: .*must stay below the executor's 1800-second idle budget \(hazard 19\)/
    );
    assert.equal(existsSync(profilePathOf(root, 3)), false);
  });
});

test("a profile whose policyHash does not describe its own policy is refused", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const lying = { ...profile, policyHash: "f".repeat(64) };
    assert.match(String(invalidProfileReason(lying)), /does not describe its own policy/);
  });
});

test("a profile with a policy value outside its bounds is refused", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    for (const patch of [
      { panelSizeMax: 6 },
      { panelSizeMin: 1 },
      { specReviewRounds: 0 },
      { planReviewRounds: 1.5 },
      { codeReviewPanelSize: 1 },
      { codeReviewMaxRounds: 6 },
    ]) {
      const policy = { ...profile.policy, ...patch };
      // Hashed consistently, so the bounds check is what refuses it rather
      // than the self-consistency check above.
      const candidate = { ...profile, policy, policyHash: policyHash(policy as never) };
      assert.notEqual(
        invalidProfileReason(candidate),
        null,
        `${JSON.stringify(patch)} must be refused`
      );
    }
  });
});

test("a profile frozen under a different but legal configuration still executes", () => {
  // Hard rule 6: a run is governed by what it froze, not by what is configured
  // now. Only a value the code could not honour is refused.
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX);
    const policy = {
      ...profile.policy,
      panelSizeMax: 5,
      specReviewRounds: 3,
      requiredSpecialties: ["security"],
      codeReviewPanelSize: 5,
      codeReviewMaxRounds: 4,
    };
    const candidate = { ...profile, policy, policyHash: policyHash(policy as never) };
    assert.equal(invalidProfileReason(candidate), null);
  });
});

test("the default installation staffs the configured panel", () => {
  // Hazard 11: a default installation must be able to create a run. Asserted
  // rather than assumed — if it stopped being true, nothing could start.
  withRoot((root) => {
    assert.doesNotThrow(() => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX));
  });
  assert.ok(PANEL_SIZE_MAX >= REQUIRED_SPECIALTIES.length);
  assert.equal(CODE_REVIEW_PANEL_SIZE, 3);
});

test("a registry that cannot staff the configured panel refuses at freeze time", () => {
  // Section 11's rule applied to the panel: fail at configuration time, not at
  // the dispatch that would have spent money finding out. The refusal must
  // happen before the profile file exists — a run whose profile was written
  // and then rejected is a half-created run.
  withRoot((root) => {
    const depleted = AGENTS.filter((a) => a.role !== "reviewer");
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, { agents: depleted }),
      /cannot freeze a profile for run 1: the agent registry has no reviewer for required specialty requirements-traceability/
    );
    assert.equal(
      existsSync(join(root, ".governance", "profiles", "1", "profile.json")),
      false,
      "nothing may be written when the configuration is refused"
    );
  });
});

test("a registry with reviewers but too few distinct lenses is refused, naming the shortfall", () => {
  withRoot((root) => {
    const oneLens = AGENTS.map((a) =>
      a.role === "reviewer" ? { ...a, specialty: "requirements-traceability" } : a
    );
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, { agents: oneLens }),
      /seats 1 distinct reviewer specialty .* which cannot fill a panel of 2/
    );
  });
});

test("a registry that cannot staff the code-review panel refuses at freeze time", () => {
  // The sibling of the spec-panel refusal above, for the other candidate set.
  // Without it a registry holding no code reviewer would freeze cleanly and
  // fail at the code_review stage, after implementation and verification have
  // already spent — the exact ordering hazard 11 exists to prevent.
  withRoot((root) => {
    const noCodeReviewers = AGENTS.filter((a) => !a.outputs.includes("code-findings"));
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, { agents: noCodeReviewers }),
      /cannot freeze a profile for run 1: the agent registry seats 0 code reviewers on executor claude-code \(none at all\), which cannot fill the configured code-review panel of 3/
    );
    assert.equal(
      existsSync(join(root, ".governance", "profiles", "1", "profile.json")),
      false,
      "nothing may be written when the configuration is refused"
    );
  });
});

test("the seeded registry staffs both panels, so a default installation freezes", () => {
  // Hazard 11 read forwards rather than backwards: the two staffing refusals
  // are only safe to add if the shipped registry satisfies both.
  withRoot((root) => {
    assert.doesNotThrow(() => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX));
    const { profile } = freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION, SANDBOX);
    assert.deepEqual(
      profile.agents.filter((a) => a.outputs.includes("code-findings")).map((a) => a.id),
      ["code-reviewer-correctness", "code-reviewer-security", "code-reviewer-state-integrity"]
    );
  });
});

test("a required reviewer bound to another executor is refused before the profile is written", () => {
  withRoot((root) => {
    const wrongExecutor = AGENTS.map((agent) =>
      agent.specialty === "requirements-traceability"
        ? { ...agent, executor: "another-executor" }
        : agent
    );
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, { agents: wrongExecutor }),
      /no reviewer for required specialty requirements-traceability/
    );
    assert.equal(existsSync(join(root, ".governance", "profiles", "1", "profile.json")), false);
  });
});

test("duplicate eligible reviewer ids are refused before the profile is written", () => {
  withRoot((root) => {
    const reviewer = AGENTS.find((agent) => agent.role === "reviewer")!;
    const duplicateId = [...AGENTS, { ...reviewer, specialty: "database" }];
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, SANDBOX, { agents: duplicateId }),
      /duplicate agent ids/
    );
    assert.equal(existsSync(join(root, ".governance", "profiles", "1", "profile.json")), false);
  });
});


/**
 * Route A rests entirely on this: the validity refusal lives in
 * `loadVerifiedProfile`, so it can only cover every execution path if every
 * execution path goes through it. A stage that called `loadProfile` directly
 * would skip both the tamper check and the validity check, and nothing else
 * would notice.
 */
test("every stage reaches the frozen profile through loadVerifiedProfile, never loadProfile", () => {
  const src = join(fileURLToPath(new URL("..", import.meta.url)), "src");
  const offenders: string[] = [];
  for (const file of [
    "spec-stage.ts",
    "plan-stage.ts",
    "implementation-stage.ts",
    "verification-stage.ts",
    "code-review-stage.ts",
    "approval-stage.ts",
    "cli.ts",
  ]) {
    const source = readFileSync(join(src, file), "utf8");
    if (!source.includes("loadVerifiedProfile")) {
      offenders.push(`${file} never calls loadVerifiedProfile`);
    }
    if (/\bloadProfile\s*\(/.test(source)) {
      offenders.push(`${file} calls loadProfile directly, bypassing the verified door`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
