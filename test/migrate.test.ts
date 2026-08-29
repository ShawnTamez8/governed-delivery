import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations } from "../src/migrate.ts";

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
