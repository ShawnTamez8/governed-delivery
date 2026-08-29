// Documentation checker: re-derives facts from source and verifies the
// architecture document against them. Plain Node, no dependencies. Exit 1 on
// any failed assertion, with one line per failure naming the fact.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const failures = [];

function fail(fact, expected, found) {
  failures.push(`FAIL: ${fact} — expected ${expected}, found ${found}`);
}

const md = readFileSync("ARCHITECTURE.md", "utf8");

function section(title) {
  const start = md.search(new RegExp(`^## \\d+\\. ${title}$`, "m"));
  if (start < 0) return "";
  const rest = md.slice(start);
  const lineEnd = rest.indexOf("\n");
  const tail = lineEnd >= 0 ? rest.slice(lineEnd + 1) : "";
  const next = /^## \d+\./m.exec(tail);
  return next ? rest.slice(0, lineEnd + 1 + next.index) : rest;
}

function fences(text) {
  return [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

// --- 1. Stage sequence ---------------------------------------------------

const sequence = section("Stage sequence");
const seqFence = fences(sequence)[0];
const foundSeq = seqFence
  .split(/->|\s+/)
  .map((t) => t.trim())
  .filter(Boolean);
const expectedSeq = [
  "spec",
  "spec_review",
  "awaiting_approval",
  "plan",
  "plan_review",
  "implementation",
  "verification",
  "delivery_check",
  "completed",
];
if (JSON.stringify(foundSeq) !== JSON.stringify(expectedSeq)) {
  fail("stage sequence", expectedSeq.join(", "), foundSeq.join(", "));
}

const deferred = [...sequence.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
const expectedDeferred = [
  "task_decomposition",
  "test_authoring",
  "code_review",
  "documentation",
  "final_verification",
  "pr_summary",
];
if (JSON.stringify(deferred) !== JSON.stringify(expectedDeferred)) {
  fail("deferred stages", expectedDeferred.join(", "), deferred.join(", "));
}

// --- 2. Schema block -----------------------------------------------------

const storage = section("State, storage, and evidence");
const schemaFence = fences(storage).find((f) => f.includes("run(id,"));
const archTables = new Map();
let current = null;
for (const raw of schemaFence.split("\n")) {
  const line = raw.trim();
  if (line === "") continue;
  const m = /^(\w+)\((.+)$/.exec(line);
  if (m) {
    current = m[1];
    archTables.set(current, [m[2]]);
  } else if (current) {
    archTables.get(current).push(line);
  }
}
const archColumns = new Map();
for (const [name, parts] of archTables) {
  const body = parts.join(" ").replace(/\)\s*$/, "");
  archColumns.set(
    name,
    body
      .split(",")
      .map((c) => c.trim().split(/\s+/)[0])
      .filter(Boolean)
  );
}
const expectedTables = ["agent_run", "approval", "audit", "finding", "run", "stage"];
const foundTables = [...archTables.keys()].sort();
if (JSON.stringify(foundTables) !== JSON.stringify(expectedTables)) {
  fail("schema block tables", expectedTables.join(", "), foundTables.join(", "));
}
if (archTables.has("handoff")) {
  fail("schema block", "no handoff table", "handoff present");
}

// --- 3. Schema vs migrations ---------------------------------------------

const migrationFiles = readdirSync("src/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const migrationSql = migrationFiles.map((f) => readFileSync(join("src", "migrations", f), "utf8")).join("\n");

const migrationColumns = new Map();
const tableRe = /^CREATE TABLE (\w+) \(/gm;
let m;
while ((m = tableRe.exec(migrationSql)) !== null) {
  const name = m[1];
  let depth = 1;
  let i = tableRe.lastIndex;
  while (depth > 0 && i < migrationSql.length) {
    if (migrationSql[i] === "(") depth++;
    else if (migrationSql[i] === ")") depth--;
    i++;
  }
  const cols = [];
  for (const line of migrationSql.slice(tableRe.lastIndex, i - 1).split("\n")) {
    const cm = /^\s*([a-z_][a-z0-9_]*)\s+/.exec(line);
    if (cm) cols.push(cm[1]);
  }
  migrationColumns.set(name, cols);
}
for (const table of ["run", "stage", "agent_run", "audit"]) {
  const expected = archColumns.get(table);
  const found = migrationColumns.get(table);
  if (!found) {
    fail(`migration schema: ${table}`, `table ${table} in 001_init.sql`, "missing");
  } else if (JSON.stringify(found) !== JSON.stringify(expected)) {
    fail(`migration schema: ${table} columns`, (expected ?? []).join(", "), found.join(", "));
  }
}
// Constraints are not columns; the column comparison above cannot see them,
// so assert them separately against the literal migration text.
const constraints = [
  "UNIQUE (run_id, ordinal)",
  "CHECK (change_kind IN ('feature', 'defect_fix'))",
  "CHECK (status IN ('in_progress', 'blocked', 'completed'))",
  "CHECK (status IN ('pending', 'in_progress', 'passed', 'blocked', 'failed'))",
  "CHECK (gate_result IN ('pass', 'block'))",
  "CHECK (role IN ('author', 'reviewer'))",
  "CHECK (independence IN ('unverified_self_attestation', 'configured_standalone'))",
  "CREATE TRIGGER audit_no_update",
  "CREATE TRIGGER audit_no_delete",
];
for (const constraint of constraints) {
  if (!migrationSql.includes(constraint)) {
    fail("migration constraints", `'${constraint}' present in migrations`, "missing");
  }
}

// --- 4. Migration location -----------------------------------------------

const layoutFence = fences(storage).find((f) => f.includes(".governance/"));
const layoutBad =
  !layoutFence ||
  !["state.db", "raw/<run>", "content/<hash>", "profiles/<run>"].every((p) => layoutFence.includes(p)) ||
  layoutFence.includes("migrations/");
const proseBad = !storage.includes("committed with the system source");
if (layoutBad || proseBad) {
  fail(
    "migration location",
    "migrations committed with the system source, not listed under the gitignored .governance/",
    "migrations still listed under .governance/ or prose missing"
  );
}

// --- 5. Protected paths --------------------------------------------------

const contract = section("Repository contract");
if (!contract.includes("governed.yaml")) {
  fail("protected paths", "governed.yaml listed", "absent from the protected paths list");
}

if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log("OK: documentation facts verified");
