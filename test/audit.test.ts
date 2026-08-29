import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { appendAudit, verifyAuditChain, type AuditRow } from "../src/audit.ts";

function withStore(fn: (store: Store) => void): void {
  const root = mkdtempSync(join(tmpdir(), "bw-audit-"));
  const store = openStore(root);
  try {
    fn(store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("appended events link prev_hash to the previous hash and verify clean", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    appendAudit(store, {
      runId: run.id,
      stageId: null,
      actor: "system",
      actorType: "cli",
      action: "run.create",
      summary: "created run",
    });
    const stage = store.insertStage(run.id, "spec", null);
    appendAudit(store, {
      runId: run.id,
      stageId: stage.id,
      actor: "system",
      actorType: "cli",
      action: "stage.complete",
      summary: "spec stage completed",
    });
    appendAudit(store, {
      runId: run.id,
      stageId: stage.id,
      actor: "operator",
      actorType: "human",
      action: "approval.sign",
      summary: "approved",
    });
    const rows = store.query<AuditRow>("SELECT * FROM audit ORDER BY id");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].prev_hash, null);
    assert.equal(rows[1].prev_hash, rows[0].hash);
    assert.equal(rows[2].prev_hash, rows[1].hash);
    assert.equal(verifyAuditChain(store), null);
  });
});

test("an empty chain verifies trivially", () => {
  withStore((store) => {
    assert.equal(verifyAuditChain(store), null);
  });
});

test("the trigger refuses UPDATE on audit", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    appendAudit(store, {
      runId: run.id,
      stageId: null,
      actor: "system",
      actorType: "cli",
      action: "run.create",
      summary: "created run",
    });
    assert.throws(() => store.exec("UPDATE audit SET summary = 'x' WHERE id = 1"), /append-only/);
  });
});

test("a tampered hash is detected after bypassing the trigger", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    appendAudit(store, {
      runId: run.id,
      stageId: null,
      actor: "system",
      actorType: "cli",
      action: "run.create",
      summary: "created run",
    });
    appendAudit(store, {
      runId: run.id,
      stageId: null,
      actor: "system",
      actorType: "cli",
      action: "run.update",
      summary: "updated run",
    });
    store.exec("DROP TRIGGER audit_no_update");
    store.exec("UPDATE audit SET hash = 'deadbeef' WHERE id = 1");
    const brk = verifyAuditChain(store);
    assert.ok(brk);
    assert.equal(brk.id, 1);
    assert.equal(brk.stored, "deadbeef");
  });
});

test("no helper in src updates or deletes from audit", () => {
  const storeSrc = readFileSync(join(process.cwd(), "src", "store.ts"), "utf8");
  const auditSrc = readFileSync(join(process.cwd(), "src", "audit.ts"), "utf8");
  for (const src of [storeSrc, auditSrc]) {
    assert.ok(!/(UPDATE|DELETE)\s+FROM\s+audit/i.test(src), "no UPDATE/DELETE FROM audit");
  }
  assert.ok(/INSERT INTO audit/i.test(auditSrc));
});
