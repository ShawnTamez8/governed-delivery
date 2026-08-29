import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Apply every migration in `migrationsDir` whose numeric prefix is greater
 * than the database's current `user_version`, in lexicographic order. Each
 * file applies in its own transaction; a failing file rolls back and leaves
 * `user_version` untouched. The last line of each migration file sets
 * `user_version` to its index, which is the applied-migrations record.
 */
export function applyMigrations(dbPath: string, migrationsDir: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    const current = row.user_version;
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const nameMatch = /^(\d{3})_.+\.sql$/.exec(file);
      if (!nameMatch) {
        throw new Error(`migration filename ${file} does not match NNN_name.sql`);
      }
      const index = Number(nameMatch[1]);
      if (index > current) {
        const sql = readFileSync(join(migrationsDir, file), "utf8");
        db.exec("BEGIN");
        try {
          db.exec(sql);
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
        const after = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
        if (after !== index) {
          throw new Error(`migration ${file} did not set user_version to ${index}`);
        }
      }
    }
  } finally {
    db.close();
  }
}
