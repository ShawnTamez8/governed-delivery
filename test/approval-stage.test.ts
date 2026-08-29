import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { approvalPayload } from "../src/approval.ts";
import { approveRun, buildBinding } from "../src/approval-stage.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { appendAudit, verifyAuditChain, type AuditRow } from "../src/audit.ts";
import { freezeProfile } from "../src/profile.ts";
import { openStore, type Store } from "../src/store.ts";

const COMMIT = "b".repeat(40);
const SLUG = "s";

const SPEC = `feature: Thing
change_kind: feature

## Declared artifacts

- src/thing.ts
- test/thing.test.ts

## Acceptance criteria

- It does the thing.
`;

/**
 * What the spec_review gate writes when it passes. The approval gate reads it
 * back to refuse an authorization binding a spec no panel gated, so a fixture
 * that skips it is a run that was never actually reviewed.
 */
function writeGateEvent(
  store: Store,
  runId: number,
  reviewStageId: number,
  specContent: string,
  risk = "low"
): void {
  appendAudit(store, {
    runId,
    stageId: reviewStageId,
    actor: "system",
    actorType: "cli",
    action: "spec.gate.pass",
    summary: `spec_review gate passed in round 1; specHash=${sha256Hex(normalizeText(specContent))}; risk=${risk}`,
  });
}

interface Fixture {
  store: Store;
  root: string;
  runId: number;
  specPath: string;
  reviewStageId: number;
  keyDir: string;
  privateKey: string;
  expiresAt: string;
}

/**
 * A run parked exactly where the approval gate expects it: spec written,
 * spec and spec_review stages passed, profile frozen. No dispatch anywhere —
 * the gate must be reachable without spending anything.
 */
function withFixture(fn: (f: Fixture) => void, opts: { spec?: string; commit?: string | null; risk?: string; gateSummary?: string | null } = {}): void {
  const root = mkdtempSync(join(tmpdir(), "bw-approve-"));
  const keyDir = mkdtempSync(join(tmpdir(), "bw-approve-key-"));
  const before = process.env.BW_APPROVAL_PUBLIC_KEY;
  const store = openStore(root);
  try {
    const run = store.insertRun("p", "f-1", SLUG, "feature");
    const specPath = join(root, "docs", "features", SLUG, "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(specPath, opts.spec ?? SPEC);

    const specStage = store.insertStage(run.id, "spec", null);
    store.completeStage(specStage.id, specPath, "pass");
    const reviewStage = store.insertStage(run.id, "spec_review", specStage.id);
    store.completeStage(reviewStage.id, specPath, "pass");
    // SPEC declares two ordinary artifacts on a feature run, so the gate this
    // fixture stands in for would have passed it at low risk. The success test
    // pins that literal independently.
    // The audit table is append-only by trigger, so a test cannot delete this
    // event afterwards — the absent and malformed cases are configured here.
    if (opts.gateSummary === undefined) {
      writeGateEvent(store, run.id, reviewStage.id, opts.spec ?? SPEC, opts.risk ?? "low");
    } else if (opts.gateSummary !== null) {
      appendAudit(store, {
        runId: run.id,
        stageId: reviewStage.id,
        actor: "system",
        actorType: "cli",
        action: "spec.gate.pass",
        summary: opts.gateSummary,
      });
    }

    const frozen = freezeProfile(root, run.id, opts.commit === undefined ? COMMIT : opts.commit);
    store.setProfileRef(run.id, frozen.hash);

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubPath = join(keyDir, "approval.pub");
    writeFileSync(pubPath, publicKey.export({ format: "pem", type: "spki" }) as string);
    process.env.BW_APPROVAL_PUBLIC_KEY = pubPath;

    fn({
      store,
      root,
      runId: run.id,
      specPath,
      reviewStageId: reviewStage.id,
      keyDir,
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  } finally {
    store.close();
    if (before === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = before;
    rmSync(root, { recursive: true, force: true });
    rmSync(keyDir, { recursive: true, force: true });
  }
}

function signFor(f: Fixture): string {
  const bound = buildBinding(f.store, f.root, f.runId, f.expiresAt);
  assert.equal(bound.ok, true, (bound as { reason?: string }).reason);
  const payload = approvalPayload((bound as { binding: Parameters<typeof approvalPayload>[0] }).binding);
  return sign(null, Buffer.from(payload, "utf8"), f.privateKey).toString("base64");
}

function auditActions(store: Store): string[] {
  return store.query<AuditRow>("SELECT * FROM audit ORDER BY id").map((r) => r.action);
}

function assertNothingWritten(f: Fixture): void {
  assert.equal(
    f.store.getStageChain(f.runId).filter((s) => s.kind === "awaiting_approval").length,
    0,
    "a refusal must create no awaiting_approval stage"
  );
  assert.equal(f.store.getApproval(f.runId), undefined, "a refusal must create no approval row");
}

// --- the success path ----------------------------------------------------

test("a verified authorization records the approval and passes the stage", () => {
  withFixture((f) => {
    const result = approveRun(f.store, f.root, {
      runId: f.runId,
      expiresAt: f.expiresAt,
      signature: signFor(f),
    });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);

    const approval = f.store.getApproval(f.runId)!;
    assert.equal(approval.feature_id, "f-1");
    assert.equal(approval.spec_hash, sha256Hex(normalizeText(readFileSync(f.specPath, "utf8"))));
    assert.equal(approval.starting_commit, COMMIT);
    assert.equal(approval.profile_hash, f.store.getRun(f.runId)!.profile_ref);
    assert.equal(approval.risk, "low");
    assert.equal(approval.scope, canonicalJson(["src/thing.ts", "test/thing.test.ts"]));
    assert.equal(approval.expires_at, f.expiresAt);
    assert.match(approval.signer, /^[0-9a-f]{64}$/);

    const chain = f.store.getStageChain(f.runId);
    const stage = chain[chain.length - 1]!;
    assert.equal(stage.kind, "awaiting_approval");
    assert.equal(stage.status, "passed");
    assert.equal(stage.gate_result, "pass");
    // What stage N+1 is handed (section 4).
    assert.equal(stage.output_ref, f.specPath);

    assert.equal(verifyAuditChain(f.store), null);
    assert.ok(auditActions(f.store).includes("approval.granted"));
  });
});

test("the scope the operator signs is exactly the spec's declared artifacts", () => {
  withFixture((f) => {
    const bound = buildBinding(f.store, f.root, f.runId, f.expiresAt) as {
      binding: { scope: string[] };
    };
    assert.deepEqual(bound.binding.scope, ["src/thing.ts", "test/thing.test.ts"]);
  });
});

// --- every refusal -------------------------------------------------------

test("a nonexistent run is refused without touching the audit chain", () => {
  withFixture((f) => {
    const before = auditActions(f.store).length;
    const r = approveRun(f.store, f.root, { runId: 9999, expiresAt: f.expiresAt, signature: "AAAA" });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /run 9999 does not exist/);
    // audit.run_id has a foreign key: an event for a missing run would throw.
    assert.equal(auditActions(f.store).length, before);
  });
});

test("a blocked run is refused naming its status", () => {
  withFixture((f) => {
    const signature = signFor(f);
    f.store.setRunStatus(f.runId, "blocked");
    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /run \d+ is blocked, not in_progress/);
    assertNothingWritten(f);
  });
});

test("a run whose last stage is not a passed spec_review is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-approve-"));
  const store = openStore(root);
  try {
    const run = store.insertRun("p", "f-1", SLUG, "feature");
    store.insertStage(run.id, "spec", null);
    const r = approveRun(store, root, {
      runId: run.id,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      signature: "AAAA",
    });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /last stage is spec \(pending\), not a passed spec_review/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run with no stages at all is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-approve-"));
  const store = openStore(root);
  try {
    const run = store.insertRun("p", "f-1", SLUG, "feature");
    const r = approveRun(store, root, {
      runId: run.id,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      signature: "AAAA",
    });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /has no passed spec_review stage to approve/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second approval is refused naming the existing stage's status", () => {
  withFixture((f) => {
    const signature = signFor(f);
    assert.equal(approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature }).ok, true);
    const again = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(again.ok, false);
    assert.match(
      (again as { reason: string }).reason,
      /already has an awaiting_approval stage with status passed/
    );
  });
});

test("a run with no frozen profile is refused", () => {
  withFixture((f) => {
    const signature = signFor(f);
    f.store.exec("UPDATE run SET profile_ref = NULL WHERE id = ?", [f.runId]);
    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /has no frozen profile/);
    assertNothingWritten(f);
  });
});

test("a profile altered after freezing is refused naming both hashes", () => {
  withFixture((f) => {
    const signature = signFor(f);
    appendFileSync(join(f.root, ".governance", "profiles", String(f.runId), "profile.json"), " ");
    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    assert.match(
      (r as { reason: string }).reason,
      /profile for run \d+ has been modified since intake: frozen [0-9a-f]{64}, on disk [0-9a-f]{64}/
    );
    assertNothingWritten(f);
  });
});

test("a policy changed since intake is refused, past the profile-hash check", () => {
  withFixture((f) => {
    const signature = signFor(f);
    // A *self-consistent* stale profile: the profile-hash check runs first
    // and would otherwise shadow this one.
    const path = join(f.root, ".governance", "profiles", String(f.runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8"));
    profile.policyHash = "f".repeat(64);
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    f.store.setProfileRef(f.runId, sha256Hex(serialized));

    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    assert.match(
      (r as { reason: string }).reason,
      /policy has changed since intake: profile f{64}, in force [0-9a-f]{64}/
    );
    assertNothingWritten(f);
  });
});

test("a run created outside a git repository cannot be approved", () => {
  withFixture(
    (f) => {
      const r = approveRun(f.store, f.root, {
        runId: f.runId,
        expiresAt: f.expiresAt,
        signature: Buffer.alloc(64).toString("base64"),
      });
      assert.equal(r.ok, false);
      assert.match(
        (r as { reason: string }).reason,
        /has no starting commit: it was not created in a git repository/
      );
      assertNothingWritten(f);
    },
    { commit: null }
  );
});

test("a deleted spec is refused naming the path", () => {
  withFixture((f) => {
    const signature = signFor(f);
    rmSync(f.specPath);
    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /cannot read the approved spec /);
    assertNothingWritten(f);
  });
});

test("a spec that no longer validates is refused naming the schema failure", () => {
  withFixture((f) => {
    const signature = signFor(f);
    writeFileSync(f.specPath, "feature: Thing\nchange_kind: feature\n\n## Acceptance criteria\n\n- x\n");
    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    assert.match(
      (r as { reason: string }).reason,
      /no longer validates: spec is missing the ## Declared artifacts section/
    );
    assertNothingWritten(f);
  });
});

test("a spec edited after review is refused by name, before the signature is even checked", () => {
  withFixture((f) => {
    const signature = signFor(f);
    appendFileSync(f.specPath, "\n- src/extra.ts\n");
    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    // A spec change caught by name is a better diagnostic than the signature
    // failure it would otherwise surface as, so the hash check runs first.
    assert.match(
      (r as { reason: string }).reason,
      /the spec has changed since review: gated [0-9a-f]{64}, on disk [0-9a-f]{64}/
    );
    assertNothingWritten(f);
  });
});

test("a run whose spec_review gate recorded nothing cannot be approved", () => {
  withFixture(
    (f) => {
      const r = approveRun(f.store, f.root, {
        runId: f.runId,
        expiresAt: f.expiresAt,
        signature: Buffer.alloc(64).toString("base64"),
      });
      assert.equal(r.ok, false);
      assert.match(
        (r as { reason: string }).reason,
        /has no spec[.]gate[.]pass audit event: the spec_review gate never recorded what it approved/
      );
      assertNothingWritten(f);
    },
    { gateSummary: null }
  );
});

test("a gate event in the old prose format is refused, not approved past", () => {
  // The shape a developer's existing database holds. Refusing by name beats
  // approving past a review whose content cannot be verified.
  withFixture(
    (f) => {
      const r = approveRun(f.store, f.root, {
        runId: f.runId,
        expiresAt: f.expiresAt,
        signature: Buffer.alloc(64).toString("base64"),
      });
      assert.equal(r.ok, false);
      assert.match(
        (r as { reason: string }).reason,
        /spec[.]gate[.]pass event does not record a spec hash and risk/
      );
      assertNothingWritten(f);
    },
    { gateSummary: "spec_review gate passed in round 1" }
  );
});

test("a risk that has moved since the panel was sized is refused", () => {
  withFixture(
    (f) => {
      const r = approveRun(f.store, f.root, {
        runId: f.runId,
        expiresAt: f.expiresAt,
        signature: Buffer.alloc(64).toString("base64"),
      });
      assert.equal(r.ok, false);
      // The panel was recorded as sized for `high`; the spec computes `low`.
      // Approving would bind a risk no panel of that size ever satisfied.
      assert.match(
        (r as { reason: string }).reason,
        /risk has changed since review: the panel was sized for high, the spec now computes low/
      );
      assertNothingWritten(f);
    },
    { risk: "high" }
  );
});

const DEFECT_SPEC = SPEC.replace("change_kind: feature", "change_kind: defect_fix");

test("a spec whose change_kind contradicts the run is refused at the gate", () => {
  // The spec stage refuses this at write time, but a spec edited afterwards
  // can flip it — and section 14 makes change_kind the flag that requires a
  // defect fix to carry regression coverage. The gate must re-check.
  // The gate event is written over this same spec, so the hash guard passes
  // and this check is what fires.
  withFixture(
    (f) => {
      const r = approveRun(f.store, f.root, {
        runId: f.runId,
        expiresAt: f.expiresAt,
        signature: Buffer.alloc(64).toString("base64"),
      });
      assert.equal(r.ok, false);
      assert.match(
        (r as { reason: string }).reason,
        /the approved spec declares change_kind defect_fix, but run \d+ is feature/
      );
      assertNothingWritten(f);
    },
    { spec: DEFECT_SPEC }
  );
});

test("a signature from a different keypair is refused", () => {
  withFixture((f) => {
    const other = generateKeyPairSync("ed25519");
    const bound = buildBinding(f.store, f.root, f.runId, f.expiresAt) as {
      binding: Parameters<typeof approvalPayload>[0];
    };
    const signature = sign(
      null,
      Buffer.from(approvalPayload(bound.binding), "utf8"),
      other.privateKey
    ).toString("base64");
    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /does not verify against the configured public key/);
    assertNothingWritten(f);
  });
});

test("an expired authorization is refused", () => {
  withFixture((f) => {
    const r = approveRun(f.store, f.root, {
      runId: f.runId,
      expiresAt: "2020-01-01T00:00:00.000Z",
      signature: Buffer.alloc(64).toString("base64"),
    });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /approval expired at 2020-01-01T00:00:00\.000Z/);
    assertNothingWritten(f);
  });
});

test("an authorization beyond the maximum lifetime is refused", () => {
  withFixture((f) => {
    const r = approveRun(f.store, f.root, {
      runId: f.runId,
      expiresAt: new Date(Date.now() + 8 * 86400_000).toISOString(),
      signature: Buffer.alloc(64).toString("base64"),
    });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /exceeds the maximum lifetime of 86400 seconds/);
    assertNothingWritten(f);
  });
});

test("a malformed expiry is refused before anything is built", () => {
  withFixture((f) => {
    const r = approveRun(f.store, f.root, {
      runId: f.runId,
      expiresAt: "tomorrow",
      signature: Buffer.alloc(64).toString("base64"),
    });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /--expires must be an ISO 8601 UTC timestamp/);
    assertNothingWritten(f);
  });
});

test("a missing public key is refused naming the env var", () => {
  withFixture((f) => {
    const signature = signFor(f);
    process.env.BW_APPROVAL_PUBLIC_KEY = join(f.keyDir, "absent.pub");
    const r = approveRun(f.store, f.root, { runId: f.runId, expiresAt: f.expiresAt, signature });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /approval public key not found: set BW_APPROVAL_PUBLIC_KEY/);
    assertNothingWritten(f);
  });
});

test("every refusal writes exactly one approval.refused audit event", () => {
  withFixture((f) => {
    const before = auditActions(f.store).filter((a) => a === "approval.refused").length;
    approveRun(f.store, f.root, {
      runId: f.runId,
      expiresAt: "tomorrow",
      signature: Buffer.alloc(64).toString("base64"),
    });
    const after = auditActions(f.store).filter((a) => a === "approval.refused");
    assert.equal(after.length, before + 1);
    assert.equal(verifyAuditChain(f.store), null);
  });
});

// --- the gate is closed to every agent -----------------------------------

test("the gate dispatches nothing: no agent machinery is reachable from it", () => {
  const source = readFileSync(resolve(process.cwd(), "src", "approval-stage.ts"), "utf8");
  for (const forbidden of ["dispatchOnce", "invokeHarness", "agentById", "buildSpec"]) {
    assert.ok(!source.includes(forbidden), `the approval gate must not reference ${forbidden}`);
  }
});

test("a granted approval records no agent run: the gate spends nothing", () => {
  withFixture((f) => {
    const result = approveRun(f.store, f.root, {
      runId: f.runId,
      expiresAt: f.expiresAt,
      signature: signFor(f),
    });
    assert.equal(result.ok, true);
    const rows = f.store.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM agent_run JOIN stage ON stage.id = agent_run.stage_id WHERE stage.run_id = ?",
      [f.runId]
    );
    assert.equal(rows[0]!.n, 0);
  });
});
