import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeProfile, loadProfile, resolveStartingCommit } from "../src/profile.ts";
import { AGENTS } from "../src/agents.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { buildPolicy, policyHash } from "../src/policy.ts";

const COMMIT = "b".repeat(40);

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
    const frozen = freezeProfile(root, 1, COMMIT);
    const loaded = loadProfile(root, 1);
    assert.equal(loaded.hash, frozen.hash);
    assert.deepEqual(loaded.profile, frozen.profile);
  });
});

test("altering the profile file changes its hash", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT);
    appendFileSync(frozen.path, " ");
    assert.notEqual(loadProfile(root, 1).hash, frozen.hash);
  });
});

test("the profile records every seeded agent and the executor", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT);
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
    const { profile } = freezeProfile(root, 1, COMMIT);
    assert.equal(profile.policyHash, policyHash(buildPolicy()));
    assert.equal(profile.policyHash, policyHash(profile.policy));
  });
});

test("two freezes differ by their timestamp but agree on policy", () => {
  withRoot((root) => {
    const a = freezeProfile(root, 1, COMMIT);
    const b = freezeProfile(root, 2, COMMIT);
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
