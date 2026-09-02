import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The break-it step (plan task 2 step 5) points this at a scratch migration
// copy to prove the assertions have teeth. All committed migration files are
// concatenated so the checks cover every table.
const MIGRATIONS_DIR = join(process.cwd(), "src", "migrations");
const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) =>
    f === "001_init.sql" && process.env.MIGRATION_FILE
      ? readFileSync(process.env.MIGRATION_FILE, "utf8")
      : readFileSync(join(MIGRATIONS_DIR, f), "utf8")
  )
  .join("\n");

const ARCHITECTURE = join(process.cwd(), "ARCHITECTURE.md");

function architectureTables(): Map<string, string[]> {
  const md = readFileSync(ARCHITECTURE, "utf8");
  const fence = md.split("```sql")[1].split("```")[0];
  const tables = new Map<string, string[]>();
  let current: string | null = null;
  for (const raw of fence.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const m = /^(\w+)\((.+)$/.exec(line);
    if (m) {
      current = m[1];
      tables.set(current, [m[2]]);
    } else if (current) {
      tables.get(current)!.push(line);
    }
  }
  const cols = new Map<string, string[]>();
  for (const [name, parts] of tables) {
    const body = parts.join(" ").replace(/\)\s*$/, "");
    const names = body
      .split(",")
      .map((c) => c.trim().split(/\s+/)[0])
      .filter(Boolean);
    cols.set(name, names);
  }
  return cols;
}

function migrationTables(sql: string): Map<string, string> {
  const tables = new Map<string, string>();
  const re = /^CREATE TABLE (\w+) \(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < sql.length) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
      i++;
    }
    tables.set(name, sql.slice(re.lastIndex, i - 1));
  }
  return tables;
}

function migrationColumns(sql: string): Map<string, string[]> {
  const cols = new Map<string, string[]>();
  for (const [name, body] of migrationTables(sql)) {
    const names: string[] = [];
    for (const line of body.split("\n")) {
      const cm = /^\s*([a-z_][a-z0-9_]*)\s+/.exec(line);
      if (cm) names.push(cm[1]);
    }
    cols.set(name, names);
  }
  return cols;
}

test("architecture block defines exactly the ten tables", () => {
  const names = [...architectureTables().keys()].sort();
  assert.deepEqual(names, [
    "agent_run",
    "approval",
    "audit",
    "finding",
    "finding_decision",
    "finding_report",
    "proposal",
    "proposal_source",
    "run",
    "stage",
  ]);
});

test("architecture block has no handoff table", () => {
  assert.ok(!architectureTables().has("handoff"));
});

test("every table's columns in the migrations match the architecture block", () => {
  const arch = architectureTables();
  const mig = migrationColumns(sql);
  for (const table of [
    "run",
    "stage",
    "agent_run",
    "finding",
    "finding_report",
    "finding_decision",
    "approval",
    "audit",
    "proposal",
    "proposal_source",
  ]) {
    assert.deepEqual(mig.get(table), arch.get(table), `columns of ${table}`);
  }
});

test("stage enforces one chain per run", () => {
  assert.ok(migrationTables(sql).get("stage")!.includes("UNIQUE (run_id, ordinal)"));
});

test("enum CHECK constraints are present", () => {
  assert.ok(sql.includes("CHECK (change_kind IN ('feature', 'defect_fix'))"));
  assert.ok(sql.includes("CHECK (status IN ('in_progress', 'blocked', 'completed'))"));
  assert.ok(
    sql.includes("CHECK (status IN ('pending', 'in_progress', 'passed', 'blocked', 'failed'))")
  );
  assert.ok(sql.includes("CHECK (gate_result IN ('pass', 'block'))"));
  assert.ok(sql.includes("CHECK (role IN ('author', 'reviewer'))"));
  assert.ok(
    sql.includes("CHECK (independence IN ('unverified_self_attestation', 'configured_standalone'))")
  );
  assert.ok(sql.includes("CHECK (risk IN ('low', 'standard', 'high'))"));
  // One authorization per run (section 12). Distinct from the stage table's
  // UNIQUE (run_id, ordinal): the closing paren is what separates them.
  assert.ok(sql.includes("UNIQUE (run_id)"));
});

// Scoped to each table's *final* body, not the whole concatenated file
// (step 5b Task 7): `finding`'s original CREATE TABLE text survives verbatim
// in the now-superseded 003_finding.sql, so an unscoped `sql.includes(...)`
// for its old constraints would pass forever regardless of what the current
// table enforces. This is the guard review 1 proved could not fail before
// Task 7 — see `migrationTables(sql).get("stage")` above for the pattern.
test("finding, finding_report, finding_decision, proposal, and proposal_source constraints are present in their final table bodies", () => {
  const tables = migrationTables(sql);
  assert.ok(
    tables.get("finding")!.includes("UNIQUE (stage_id, round, intent_key, location)"),
    "finding round-scoped identity"
  );
  assert.ok(
    tables.get("finding_report")!.includes("CHECK (severity IN ('low', 'medium', 'high', 'critical'))"),
    "finding_report severity"
  );
  assert.ok(
    tables.get("finding_report")!.includes("CHECK (classification IN ('current_artifact', 'upstream'))"),
    "finding_report classification"
  );
  assert.ok(
    tables.get("finding_report")!.includes("UNIQUE (finding_id, agent_run_id)"),
    "finding_report one report per reviewer"
  );
  assert.ok(
    tables
      .get("finding_decision")!
      .includes(
        "CHECK (disposition IN ('addressed', 'rejected_with_rationale', 'upstream_follow_up', 'upstream_blocking', 'cannot_determine'))"
      ),
    "finding_decision disposition"
  );
  assert.ok(tables.get("finding_decision")!.includes("UNIQUE (finding_id)"), "finding_decision one per finding");
  assert.ok(
    tables.get("proposal")!.includes("CHECK (route IN ('follow_up', 'blocking_dependency'))"),
    "proposal route"
  );
  assert.ok(tables.get("proposal")!.includes("UNIQUE (stage_id, identity)"), "proposal dedup identity");
  assert.ok(
    tables.get("proposal_source")!.includes("UNIQUE (proposal_id, finding_id)"),
    "proposal_source one link per finding"
  );
});

// `finding`'s old disposition vocabulary and its old identity constraint are
// gone from the live schema (Task 7 rebuilt the table); this is the negative
// half of the guard above, proving the scoped check actually distinguishes
// the current shape from the superseded one rather than passing regardless.
test("the old finding shape's constraints are absent from its current table body", () => {
  const body = migrationTables(sql).get("finding")!;
  assert.ok(!body.includes("CHECK (disposition IN ('open', 'resolved', 'disputed', 'accepted'))"));
  assert.ok(!body.includes("UNIQUE (stage_id, intent_key, location)"));
});

test("audit is append-only by trigger", () => {
  assert.ok(sql.includes("CREATE TRIGGER audit_no_update"));
  assert.ok(sql.includes("CREATE TRIGGER audit_no_delete"));
});
