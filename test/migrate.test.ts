import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations } from "../src/migrate.ts";
import { upstreamPrefixFor } from "../src/reconciliation.ts";

const MIGRATIONS_DIR = join(process.cwd(), "src", "migrations");
// Same predicate as the runner: only NNN_name.sql files apply and count.
const MIGRATION_COUNT = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).length;

function tempDbPath(): { root: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "bw-migrate-"));
  return { root, dbPath: join(root, ".governance", "state.db") };
}

test("applyMigrations creates state.db and sets user_version", () => {
  const { root, dbPath } = tempDbPath();
  try {
    applyMigrations(dbPath, MIGRATIONS_DIR);
    assert.ok(existsSync(dbPath));
    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
      assert.equal(row.user_version, MIGRATION_COUNT);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second run applies nothing", () => {
  const { root, dbPath } = tempDbPath();
  try {
    applyMigrations(dbPath, MIGRATIONS_DIR);
    applyMigrations(dbPath, MIGRATIONS_DIR);
    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
      assert.equal(row.user_version, MIGRATION_COUNT);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function scratchMigrationsDir(): { root: string; dir: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "bw-scratch-mig-"));
  const dir = join(root, "migrations");
  mkdirSync(dir);
  copyFileSync(join(MIGRATIONS_DIR, "001_init.sql"), join(dir, "001_init.sql"));
  return { root, dir, dbPath: join(root, ".governance", "state.db") };
}

test("a mis-named migration file is refused", () => {
  const { root, dir, dbPath } = scratchMigrationsDir();
  try {
    writeFileSync(join(dir, "fix.sql"), "CREATE TABLE extra (id INTEGER);\n");
    assert.throws(
      () => applyMigrations(dbPath, dir),
      /migration filename fix\.sql does not match NNN_name\.sql/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a migration that does not set user_version is refused", () => {
  const { root, dir, dbPath } = scratchMigrationsDir();
  try {
    writeFileSync(join(dir, "002_bad.sql"), "CREATE TABLE extra (id INTEGER);\n");
    assert.throws(
      () => applyMigrations(dbPath, dir),
      /migration 002_bad\.sql did not set user_version to 2/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

interface LegacyRunResult {
  lastInsertRowid: number | bigint;
}

interface FindingRow {
  round: number;
  intent_key: string;
  location: string;
  stage_id: number;
}

interface FindingReportRow {
  severity: string;
  classification: string;
  subject: string;
}

// Step 5b Task 7: the migration that rebuilds `finding` must carry every
// existing row forward under round 1, with one finding_report row when the
// legacy row named a producing agent_run_id — and must not manufacture a
// reviewer for the one that did not. Built against a scratch migrations
// directory holding the prior versions (001-004) applied first, then 005
// copied in and reapplied, per the plan's Task 7 step 7.
test("a legacy finding row survives the round-scoped rebuild, and an orphan row gets no manufactured report", () => {
  const { root, dir, dbPath } = scratchMigrationsDir();
  try {
    for (const f of ["002_agent_run.sql", "003_finding.sql", "004_approval.sql"]) {
      copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    applyMigrations(dbPath, dir);

    let findingId: number;
    let orphanFindingId: number;
    let upstreamFindingId: number;
    const seed = new DatabaseSync(dbPath);
    try {
      const now = "2026-01-01T00:00:00.000Z";
      const runId = Number(
        (
          seed
            .prepare(
              "INSERT INTO run (project, feature_id, slug, change_kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .run("p", "f-1", "s", "feature", "in_progress", now, now) as LegacyRunResult
        ).lastInsertRowid
      );
      const stageId = Number(
        (
          seed.prepare("INSERT INTO stage (run_id, kind, ordinal) VALUES (?, ?, ?)").run(runId, "spec_review", 0) as LegacyRunResult
        ).lastInsertRowid
      );
      const agentRunId = Number(
        (
          seed
            .prepare(
              `INSERT INTO agent_run (stage_id, agent, role, executor, requested_model, duration_ms, input_hash, output_hash, raw_output_ref, independence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(stageId, "reviewer-a", "reviewer", "claude-code", "sonnet", 100, "h1", "h2", "raw/1/x.json", "configured_standalone") as LegacyRunResult
        ).lastInsertRowid
      );
      findingId = Number(
        (
          seed
            .prepare(
              "INSERT INTO finding (stage_id, agent_run_id, severity, intent_key, subject, location, disposition) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .run(stageId, agentRunId, "high", "missing-trace", "no trace for criterion 3", "## Acceptance criteria", "open") as LegacyRunResult
        ).lastInsertRowid
      );
      // An orphan row: no producing reviewer recorded. Migrating it must not
      // invent one.
      orphanFindingId = Number(
        (
          seed
            .prepare(
              "INSERT INTO finding (stage_id, agent_run_id, severity, intent_key, subject, location, disposition) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .run(stageId, null, "low", "orphan-concern", "no producing reviewer recorded", "## Declared artifacts", "open") as LegacyRunResult
        ).lastInsertRowid
      );
      // An upstream row. The legacy table had no classification column, but
      // `validateReviewerReports` bound classification to the location: only
      // an upstream report could carry an `upstream:<source>:` prefix, and the
      // legacy stage stored that validated location verbatim. The migrated
      // report must read that prefix back rather than assume the reviewer
      // said current_artifact. The expected value comes from
      // `upstreamPrefixFor("design")`, not from a string invented here.
      upstreamFindingId = Number(
        (
          seed
            .prepare(
              "INSERT INTO finding (stage_id, agent_run_id, severity, intent_key, subject, location, disposition) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
              stageId,
              agentRunId,
              "critical",
              "undecided-retention",
              "the design never decides retention",
              `${upstreamPrefixFor("design")}retention-window`,
              "open"
            ) as LegacyRunResult
        ).lastInsertRowid
      );
    } finally {
      seed.close();
    }

    copyFileSync(
      join(MIGRATIONS_DIR, "005_finding_report_decision.sql"),
      join(dir, "005_finding_report_decision.sql")
    );
    applyMigrations(dbPath, dir);

    const after = new DatabaseSync(dbPath);
    try {
      const finding = after.prepare("SELECT * FROM finding WHERE id = ?").get(findingId) as FindingRow | undefined;
      assert.ok(finding, "the legacy finding row must survive under its original id");
      assert.equal(finding!.round, 1);
      assert.equal(finding!.intent_key, "missing-trace");
      assert.equal(finding!.location, "## Acceptance criteria");

      const reports = after
        .prepare("SELECT * FROM finding_report WHERE finding_id = ?")
        .all(findingId) as unknown as FindingReportRow[];
      assert.equal(reports.length, 1);
      assert.equal(reports[0].severity, "high");
      assert.equal(reports[0].classification, "current_artifact");
      assert.equal(reports[0].subject, "no trace for criterion 3");

      const orphan = after.prepare("SELECT * FROM finding WHERE id = ?").get(orphanFindingId) as FindingRow | undefined;
      assert.ok(orphan, "the orphan legacy row must survive too");
      assert.equal(orphan!.round, 1);
      const orphanReports = after
        .prepare("SELECT * FROM finding_report WHERE finding_id = ?")
        .all(orphanFindingId) as unknown as FindingReportRow[];
      assert.equal(orphanReports.length, 0, "an orphan legacy row must not manufacture a reviewer");

      // The classification-bound location must survive as `upstream`. A
      // migration writing a literal 'current_artifact' passes every other
      // assertion in this test and still destroys what the reviewer returned.
      const upstreamReports = after
        .prepare("SELECT * FROM finding_report WHERE finding_id = ?")
        .all(upstreamFindingId) as unknown as FindingReportRow[];
      assert.equal(upstreamReports.length, 1);
      assert.equal(
        upstreamReports[0].classification,
        "upstream",
        "an upstream-prefixed legacy location must not migrate as current_artifact"
      );
      assert.equal(upstreamReports[0].severity, "critical");
      assert.equal(upstreamReports[0].subject, "the design never decides retention");

      // Explicit-id copying restores the AUTOINCREMENT sequence correctly: a
      // fresh insert after the rebuild must not collide with a migrated id.
      const fresh = after
        .prepare("INSERT INTO finding (stage_id, round, intent_key, location) VALUES (?, ?, ?, ?)")
        .run(finding!.stage_id, 2, "fresh-concern", "## Declared artifacts") as LegacyRunResult;
      assert.ok(Number(fresh.lastInsertRowid) > orphanFindingId);
    } finally {
      after.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
