#!/usr/bin/env node
// Documentation checker for governed-delivery.
//
// `CLAUDE.md` declares that `ARCHITECTURE.md` is the design and `docs/hazards.md`
// is the requirements list. That rule was prose, so documents could drift from
// the source and from each other anyway. This script is the executable form of
// the rule: it derives facts from the source, then fails on any document that
// disagrees.
//
//   node scripts/doc-check.mjs              # report + exit code
//   node scripts/doc-check.mjs --json       # machine-readable
//   node scripts/doc-check.mjs --only=paths
//   node scripts/doc-check.mjs --only=schema,migrations
//
// Exit 0 = clean, 1 = at least one document is wrong, 2 = the checker itself
// can no longer read the source (see `derive()`).
//
// Plain Node, no dependencies.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const onlyArg = argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;

const errors = [];
const warnings = [];

const err = (check, file, line, message) => errors.push({ check, file, line, message });
const warn = (check, file, line, message) => warnings.push({ check, file, line, message });

const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// A `--` line comment can contain the exact text of a constraint the table no
// longer has, and can contain unbalanced parentheses that would throw off the
// paren-depth scan for a `CREATE TABLE` body's end. A Task 11 break-it
// mutation proved the first case: a comment explaining a dropped `UNIQUE`
// clause still satisfied `body.includes(constraint)`. Strip comments from the
// concatenated migration source once, before any structural parsing runs, so
// dead text in a comment can affect neither check. Migrations here use only
// `--` comments, never `/* */`.
const stripLineComments = (sql) => sql.replace(/--.*$/gm, "");

// A mismatch is reported against the document that carries the claim, so the
// reader is taken to the line they have to edit.
function mismatch(check, file, line, label, expected, found) {
  err(check, file, line, `${label} — expected ${expected}, found ${found}`);
}

// ---------------------------------------------------------------------------
// Document tiers.
//
// The same sentence is correct in a plan written three steps ago and wrong in
// ARCHITECTURE.md. The tier decides how hard the checker presses:
//   current    - asserts what is true now; every check applies as an error.
//   reference  - backlog and proposals; paths must resolve, claims are not
//                treated as current-state assertions.
//   historical - plans, reviews, and session records. Preserved as written:
//                a stale path is a warning, never an error. These documents
//                record what was believed at the time and must not be edited
//                to resemble the current implementation.
// ---------------------------------------------------------------------------

const CURRENT_DOCS = ["ARCHITECTURE.md", "CLAUDE.md", "README.md", "docs/hazards.md"];
const REFERENCE_DIRS = ["docs/proposals"];
const HISTORICAL_DIRS = ["docs/features", ".claude/sessions"];

function tierOf(rel) {
  const p = rel.split("\\").join("/");
  if (CURRENT_DOCS.includes(p)) return "current";
  if (HISTORICAL_DIRS.some((d) => p.startsWith(`${d}/`))) return "historical";
  if (REFERENCE_DIRS.some((d) => p.startsWith(`${d}/`))) return "reference";
  return "reference";
}

function markdownFiles(dir = "", out = []) {
  const abs = join(REPO_ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) markdownFiles(rel, out);
    else if (entry.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Facts. Every getter throws a named error rather than returning a
// wrong-but-plausible value: a checker that silently defaults would validate
// every document against a fiction. A throw here exits 2, which says "fix the
// checker", not "fix the docs".
// ---------------------------------------------------------------------------

function derive() {
  const md = read("ARCHITECTURE.md");

  // A missing section is genuinely ambiguous — the heading may have been
  // renamed (checker is stale) or the section removed (document is wrong).
  // Exit 2 names both possibilities instead of guessing and blaming the doc.
  function section(title) {
    const start = md.search(new RegExp(`^## \\d+\\. ${title}$`, "m"));
    if (start < 0) {
      throw new Error(
        `could not locate ARCHITECTURE.md section '${title}' — it was either renamed (update derive()) or removed (restore the section)`
      );
    }
    const rest = md.slice(start);
    const lineEnd = rest.indexOf("\n");
    const tail = lineEnd >= 0 ? rest.slice(lineEnd + 1) : "";
    const next = /^## \d+\./m.exec(tail);
    return next ? rest.slice(0, lineEnd + 1 + next.index) : rest;
  }

  function fences(text) {
    return [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  }

  function fence(text, label, predicate) {
    const found = predicate ? fences(text).find(predicate) : fences(text)[0];
    if (found === undefined) throw new Error(`could not find the ${label} code fence in ARCHITECTURE.md`);
    return found;
  }

  const sequenceSection = section("Stage sequence");
  const storageSection = section("State, storage, and evidence");
  const contractSection = section("Repository contract");

  const stageSequence = fence(sequenceSection, "stage sequence")
    .split(/->|\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (stageSequence.length === 0) throw new Error("stage sequence fence parsed to zero stages");

  const deferredStages = [...sequenceSection.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);

  // ARCHITECTURE.md's schema block, parsed into table -> column names.
  const schemaFence = fence(storageSection, "schema block", (f) => f.includes("run(id,"));
  const archTables = new Map();
  let currentTable = null;
  for (const raw of schemaFence.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const m = /^(\w+)\((.+)$/.exec(line);
    if (m) {
      currentTable = m[1];
      archTables.set(currentTable, [m[2]]);
    } else if (currentTable) {
      archTables.get(currentTable).push(line);
    }
  }
  if (archTables.size === 0) throw new Error("schema fence parsed to zero tables");

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

  const storageLayoutFence = fence(storageSection, "storage layout", (f) => f.includes(".governance/"));
  const hazardsSection = section("Known hazards");
  const hazardsMd = read("docs/hazards.md");
  const hazardHeadings = [...hazardsMd.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));

  // The migrations are source, and source outranks the document.
  const migrationFiles = readdirSync(join(REPO_ROOT, "src/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (migrationFiles.length === 0) throw new Error("no .sql files found under src/migrations");
  const migrationSql = stripLineComments(migrationFiles.map((f) => read(`src/migrations/${f}`)).join("\n"));

  // A table's *final* body: later `CREATE TABLE <name> (...)` occurrences
  // overwrite earlier ones with the same name, so a table a later migration
  // renames-and-rebuilds (step 5b Task 7) resolves to the shape it has now,
  // not the dead text an earlier, superseded migration still carries
  // verbatim. `checkConstraints` uses this to scope a constraint assertion to
  // one table instead of the whole concatenated file.
  const migrationTableBodies = new Map();
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
    const body = migrationSql.slice(tableRe.lastIndex, i - 1);
    migrationTableBodies.set(name, body);
    const cols = [];
    for (const line of body.split("\n")) {
      const cm = /^\s*([a-z_][a-z0-9_]*)\s+/.exec(line);
      if (cm) cols.push(cm[1]);
    }
    migrationColumns.set(name, cols);
  }
  if (migrationColumns.size === 0) throw new Error("could not parse any CREATE TABLE from src/migrations");

  return {
    architectureMd: md,
    sequenceSection,
    storageSection,
    contractSection,
    storageLayoutFence,
    hazardsSection,
    hazardsMd,
    hazardHeadings,
    stageSequence,
    deferredStages,
    archTables,
    archColumns,
    migrationFiles,
    migrationSql,
    migrationColumns,
    migrationTableBodies,
  };
}

// section 22 states the hazard count in prose ("states sixteen failure
// modes"), matching this document's style for small counts elsewhere
// (section 2's "Three structural mistakes", section 5's "Twelve stages").
// Mapping the word rather than asking for a digit keeps that prose style
// intact while still letting the checker compare it against
// `docs/hazards.md`'s own heading count.
const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

// ---------------------------------------------------------------------------
// Pins.
//
// These lists are not derived from source, because no source enumerates them:
// the `stage.kind` column carries no CHECK constraint, so nothing in `src/`
// declares the stage vocabulary. They pin ARCHITECTURE.md so the sequence
// cannot change by accident — a deliberate change edits the document and this
// list together. Do not describe them as verified against the source.
// ---------------------------------------------------------------------------

const PINNED_SEQUENCE = [
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

const PINNED_DEFERRED = [
  "task_decomposition",
  "test_authoring",
  "code_review",
  "documentation",
  "final_verification",
  "pr_summary",
];

const PINNED_TABLES = [
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
];

// Constraints on tables nothing in this step rebuilds. An unscoped whole-file
// search is safe for these: the table's CREATE TABLE text never changes
// underneath it, so there is no dead-text case to guard against.
const PINNED_CONSTRAINTS = [
  "UNIQUE (run_id, ordinal)",
  "CHECK (change_kind IN ('feature', 'defect_fix'))",
  "CHECK (status IN ('in_progress', 'blocked', 'completed'))",
  "CHECK (status IN ('pending', 'in_progress', 'passed', 'blocked', 'failed'))",
  "CHECK (gate_result IN ('pass', 'block'))",
  "CHECK (role IN ('author', 'reviewer'))",
  "CHECK (independence IN ('unverified_self_attestation', 'configured_standalone'))",
  "CHECK (risk IN ('low', 'standard', 'high'))",
  "UNIQUE (run_id)",
  "CREATE TRIGGER audit_no_update",
  "CREATE TRIGGER audit_no_delete",
];

// Constraints scoped to one table's *final* body (step 5b Task 7). `finding`
// was rebuilt with a new shape; its original CREATE TABLE text survives
// verbatim in an earlier, superseded migration file, so an unscoped search
// for these would pass forever regardless of what the current table looks
// like — the exact defect this plan's blast-radius review named.
const PINNED_TABLE_CONSTRAINTS = [
  ["finding", "UNIQUE (stage_id, round, intent_key, location)"],
  ["finding_report", "CHECK (severity IN ('low', 'medium', 'high', 'critical'))"],
  ["finding_report", "CHECK (classification IN ('current_artifact', 'upstream'))"],
  ["finding_report", "UNIQUE (finding_id, agent_run_id)"],
  [
    "finding_decision",
    "CHECK (disposition IN ('addressed', 'rejected_with_rationale', 'upstream_follow_up', 'upstream_blocking', 'cannot_determine'))",
  ],
  ["finding_decision", "UNIQUE (finding_id)"],
  ["proposal", "CHECK (route IN ('follow_up', 'blocking_dependency'))"],
  ["proposal", "UNIQUE (stage_id, identity)"],
  ["proposal_source", "UNIQUE (proposal_id, finding_id)"],
];

const lineIn = (text, needle) => {
  const i = text.indexOf(needle);
  return i < 0 ? 1 : lineOf(text, i);
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkSequence(facts) {
  const line = lineIn(facts.architectureMd, "## 5.");
  if (JSON.stringify(facts.stageSequence) !== JSON.stringify(PINNED_SEQUENCE)) {
    mismatch(
      "sequence",
      "ARCHITECTURE.md",
      line,
      "stage sequence",
      PINNED_SEQUENCE.join(", "),
      facts.stageSequence.join(", ")
    );
  }
}

function checkDeferred(facts) {
  const line = lineIn(facts.architectureMd, "## 5.");
  if (JSON.stringify(facts.deferredStages) !== JSON.stringify(PINNED_DEFERRED)) {
    mismatch(
      "deferred",
      "ARCHITECTURE.md",
      line,
      "deferred stages",
      PINNED_DEFERRED.join(", "),
      facts.deferredStages.join(", ")
    );
  }
}

function checkSchema(facts) {
  const line = lineIn(facts.architectureMd, "run(id,");
  const found = [...facts.archTables.keys()].sort();
  if (JSON.stringify(found) !== JSON.stringify(PINNED_TABLES)) {
    mismatch("schema", "ARCHITECTURE.md", line, "schema block tables", PINNED_TABLES.join(", "), found.join(", "));
  }
  if (facts.archTables.has("handoff")) {
    err("schema", "ARCHITECTURE.md", line, "schema block still carries a handoff table; it was removed from the design");
  }
}

function checkMigrations(facts) {
  const line = lineIn(facts.architectureMd, "run(id,");
  for (const table of PINNED_TABLES) {
    const expected = facts.archColumns.get(table);
    const found = facts.migrationColumns.get(table);
    if (!found) {
      err("migrations", "src/migrations/001_init.sql", 1, `table ${table} is described in ARCHITECTURE.md but absent from the migrations`);
    } else if (JSON.stringify(found) !== JSON.stringify(expected)) {
      mismatch(
        "migrations",
        "ARCHITECTURE.md",
        line,
        `${table} columns`,
        `the migration's ${found.join(", ")}`,
        (expected ?? []).join(", ")
      );
    }
  }
}

function checkConstraints(facts) {
  for (const constraint of PINNED_CONSTRAINTS) {
    if (!facts.migrationSql.includes(constraint)) {
      err("constraints", "src/migrations/001_init.sql", 1, `constraint absent from the migrations: ${constraint}`);
    }
  }
  for (const [table, constraint] of PINNED_TABLE_CONSTRAINTS) {
    const body = facts.migrationTableBodies.get(table);
    if (!body) {
      err("constraints", "src/migrations/001_init.sql", 1, `table ${table} is pinned but absent from the migrations`);
    } else if (!body.includes(constraint)) {
      err(
        "constraints",
        "src/migrations/001_init.sql",
        1,
        `constraint absent from ${table}'s final table body: ${constraint}`
      );
    }
  }
}

function checkLayout(facts) {
  const line = lineIn(facts.architectureMd, ".governance/");
  const layoutBad =
    !["state.db", "raw/<run>", "content/<hash>", "profiles/<run>"].every((p) => facts.storageLayoutFence.includes(p)) ||
    facts.storageLayoutFence.includes("migrations/");
  if (layoutBad) {
    err(
      "layout",
      "ARCHITECTURE.md",
      line,
      "storage layout must list state.db, raw/<run>, content/<hash>, profiles/<run> and must not list migrations/ — migrations are committed with the system source, not written into the gitignored .governance/"
    );
  }
  if (!facts.storageSection.includes("committed with the system source")) {
    err("layout", "ARCHITECTURE.md", line, "storage section no longer states that migrations are committed with the system source");
  }
}

function checkContract(facts) {
  if (!facts.contractSection.includes("governed.yaml")) {
    err(
      "contract",
      "ARCHITECTURE.md",
      lineIn(facts.architectureMd, "## 7."),
      "governed.yaml is absent from the protected paths list"
    );
  }
}

// Section 22 states the hazard count in words; `docs/hazards.md`'s own
// `## N.` headings are the source of truth. This is the enforced form of
// section 22's own closing line — "when a new failure mode is found, add it
// there rather than here" — since prose alone cannot catch the two lists
// drifting apart the way this check can.
function checkHazardCount(facts) {
  const line = lineIn(facts.architectureMd, "## 22.");
  const stated = /states (\w+) failure modes/.exec(facts.hazardsSection);
  if (!stated) {
    err(
      "hazardCount",
      "ARCHITECTURE.md",
      line,
      "section 22 no longer states the hazard count in the expected 'states <word> failure modes' shape"
    );
    return;
  }
  const statedCount = NUMBER_WORDS[stated[1].toLowerCase()];
  if (statedCount === undefined) {
    err(
      "hazardCount",
      "ARCHITECTURE.md",
      line,
      `section 22 states a hazard count word doc-check cannot parse: '${stated[1]}'`
    );
    return;
  }
  const actualCount = facts.hazardHeadings.length;
  if (statedCount !== actualCount) {
    mismatch(
      "hazardCount",
      "ARCHITECTURE.md",
      line,
      "hazard count",
      `${actualCount} (docs/hazards.md '## N.' headings)`,
      `${statedCount} (section 22 states '${stated[1]}')`
    );
  }
}

// `docs/hazards.md` is a requirements list, but consulting it was prose-only
// guidance, so a plan or a reconciliation could silently skip it. Silence is
// the failure mode: an omitted entry and a considered-and-irrelevant entry look
// identical afterwards. Every document under docs/features/ must say which
// entries it weighed, naming `none` with a reason when that is the answer.
function checkHazards() {
  for (const file of markdownFiles("docs/features")) {
    const text = read(file);
    const stated = /^\*\*Hazards considered:\*\*\s*(.+)$/m.exec(text);
    if (!stated) {
      err(
        "hazards",
        file,
        1,
        "no '**Hazards considered:**' line — name the docs/hazards.md entries weighed, or 'none' with a reason"
      );
    } else if (stated[1].trim().length < 4) {
      err(
        "hazards",
        file,
        lineOf(text, stated.index),
        `'**Hazards considered:**' statement is empty or too short: '${stated[1].trim()}'`
      );
    }
  }
}

// Root-anchored repository paths cited in backticks must resolve.
//
// Only root-anchored paths are checked. A `./scope.ts` or `../src/policy.ts` in
// prose is an import specifier relative to a source file, not a repository
// path, and resolving it against the root would be meaningless. `.governance/`
// is gitignored machine-local run state: its absence here is correct, not a
// broken reference.
const ROOTED_PATH = /`((?:src|test|scripts|docs|\.claude)\/[A-Za-z0-9_.\-/]+)`/g;

function checkPaths() {
  for (const doc of markdownFiles()) {
    const tier = tierOf(doc);
    const text = read(doc);
    for (const m of text.matchAll(ROOTED_PATH)) {
      const token = m[1];
      if (/[<>*]/.test(token)) continue; // templates such as docs/features/<feature>/
      if (/:\d/.test(token)) continue; // line citations such as src/cli.ts:120
      if (existsSync(join(REPO_ROOT, token))) continue;
      const line = lineOf(text, m.index);
      const message = `referenced path does not exist -> ${token}`;
      // Historical documents are preserved as written. A path that has since
      // been renamed is a fact about the past, not a defect to repair.
      if (tier === "historical") warn("paths", doc, line, message);
      else err("paths", doc, line, message);
    }
  }
}

// ---------------------------------------------------------------------------

const CHECKS = {
  sequence: checkSequence,
  deferred: checkDeferred,
  schema: checkSchema,
  migrations: checkMigrations,
  constraints: checkConstraints,
  layout: checkLayout,
  contract: checkContract,
  hazardCount: checkHazardCount,
  hazards: checkHazards,
  paths: checkPaths,
};

if (only) {
  const unknown = only.filter((name) => !(name in CHECKS));
  if (unknown.length > 0) {
    console.error(`doc-check: unknown check(s): ${unknown.join(", ")}`);
    console.error(`Available: ${Object.keys(CHECKS).join(", ")}`);
    process.exit(2);
  }
}

let facts;
try {
  facts = derive();
} catch (cause) {
  console.error(`doc-check: cannot derive facts from source: ${cause.message}`);
  console.error("The checker is stale relative to the source. Fix derive() before trusting any result.");
  process.exit(2);
}

for (const [name, fn] of Object.entries(CHECKS)) {
  if (only && !only.includes(name)) continue;
  fn(facts);
}

const reportedFacts = {
  stageSequence: facts.stageSequence,
  deferredStages: facts.deferredStages,
  architectureTables: [...facts.archTables.keys()].sort(),
  migrationTables: [...facts.migrationColumns.keys()].sort(),
  migrationFiles: facts.migrationFiles,
  markdownFiles: markdownFiles().length,
};

if (asJson) {
  console.log(JSON.stringify({ facts: reportedFacts, errors, warnings }, null, 2));
} else {
  console.log("Facts derived from source:");
  for (const [k, v] of Object.entries(reportedFacts)) {
    console.log(`  ${k}: ${Array.isArray(v) ? v.join(" | ") : v}`);
  }
  console.log("");
  const render = (list, label) => {
    if (list.length === 0) return;
    console.log(`${label} (${list.length}):`);
    for (const e of list) console.log(`  ${e.file}:${e.line}  [${e.check}] ${e.message}`);
    console.log("");
  };
  render(errors, "ERRORS");
  render(warnings, "WARNINGS");
  console.log(errors.length === 0 ? "doc-check: clean" : `doc-check: ${errors.length} error(s)`);
}

process.exit(errors.length === 0 ? 0 : 1);
