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

test("architecture block defines exactly the six tables", () => {
  const names = [...architectureTables().keys()].sort();
  assert.deepEqual(names, ["agent_run", "approval", "audit", "finding", "run", "stage"]);
});

test("architecture block has no handoff table", () => {
  assert.ok(!architectureTables().has("handoff"));
});

test("run, stage, agent_run, finding, approval, and audit columns in the migrations match the architecture block", () => {
  const arch = architectureTables();
  const mig = migrationColumns(sql);
  for (const table of ["run", "stage", "agent_run", "finding", "approval", "audit"]) {
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
  assert.ok(sql.includes("CHECK (severity IN ('low', 'medium', 'high', 'critical'))"));
  assert.ok(sql.includes("CHECK (disposition IN ('open', 'resolved', 'disputed', 'accepted'))"));
  assert.ok(sql.includes("UNIQUE (stage_id, intent_key, location)"));
  assert.ok(sql.includes("CHECK (risk IN ('low', 'standard', 'high'))"));
  // One authorization per run (section 12). Distinct from the stage table's
  // UNIQUE (run_id, ordinal): the closing paren is what separates them.
  assert.ok(sql.includes("UNIQUE (run_id)"));
});

test("audit is append-only by trigger", () => {
  assert.ok(sql.includes("CREATE TRIGGER audit_no_update"));
  assert.ok(sql.includes("CREATE TRIGGER audit_no_delete"));
});
