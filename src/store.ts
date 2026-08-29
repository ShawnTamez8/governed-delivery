import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "./migrate.ts";

export type ChangeKind = "feature" | "defect_fix";
export type RunStatus = "in_progress" | "blocked" | "completed";
export type StageStatus = "pending" | "in_progress" | "passed" | "blocked" | "failed";
export type GateResult = "pass" | "block";

export interface RunRow {
  id: number;
  project: string;
  feature_id: string;
  slug: string;
  change_kind: ChangeKind;
  status: RunStatus;
  profile_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface StageRow {
  id: number;
  run_id: number;
  kind: string;
  ordinal: number;
  input_stage_id: number | null;
  output_ref: string | null;
  status: StageStatus;
  gate_result: GateResult | null;
  started_at: string | null;
  ended_at: string | null;
}

export const CHANGE_KINDS: readonly string[] = ["feature", "defect_fix"];
const STAGE_STATUSES: readonly string[] = ["pending", "in_progress", "passed", "blocked", "failed"];
export const GATE_RESULTS: readonly string[] = ["pass", "block"];

// Anchored to this module, not the working directory: the CLI is spawned from
// arbitrary directories in tests and in runs.
const DEFAULT_MIGRATIONS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "migrations");

function isBusy(err: unknown): boolean {
  return err instanceof Error && /busy|locked/i.test(err.message);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * One repository, one writer. The repository lock serializes invocations;
 * the bounded retry below covers `SQLITE_BUSY` on top of the SQLite busy
 * timeout, as architecture section 19 requires.
 */
export class Store {
  #db: DatabaseSync;

  constructor(rootDir: string) {
    const dbPath = join(rootDir, ".governance", "state.db");
    applyMigrations(dbPath, DEFAULT_MIGRATIONS_DIR);
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec("PRAGMA busy_timeout = 5000");
  }

  close(): void {
    this.#db.close();
  }

  query<T>(sql: string, params: (string | number | null)[] = []): T[] {
    return this.#withRetry(() => this.#db.prepare(sql).all(...params) as T[]);
  }

  exec(sql: string, params: (string | number | null)[] = []): void {
    this.#withRetry(() => this.#db.prepare(sql).run(...params));
  }

  /**
   * Run `fn` inside BEGIN IMMEDIATE, retried on `SQLITE_BUSY`. Audit appends
   * and chain writes use this so read-then-write sequences serialize under
   * the database's single-writer lock (architecture section 19).
   */
  transaction<T>(fn: () => T): T {
    return this.#withRetry(() => {
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        this.#db.exec("COMMIT");
        return result;
      } catch (err) {
        this.#db.exec("ROLLBACK");
        throw err;
      }
    });
  }

  #withRetry<T>(fn: () => T): T {
    for (let attempt = 1; ; attempt++) {
      try {
        return fn();
      } catch (err) {
        if (attempt < 3 && isBusy(err)) {
          sleep(100);
          continue;
        }
        throw err;
      }
    }
  }

  insertRun(project: string, featureId: string, slug: string, changeKind: string): RunRow {
    if (!CHANGE_KINDS.includes(changeKind)) {
      throw new Error(`invalid change_kind ${changeKind}: allowed values are ${CHANGE_KINDS.join(", ")}`);
    }
    const now = new Date().toISOString();
    const result = this.#withRetry(() =>
      this.#db
        .prepare(
          "INSERT INTO run (project, feature_id, slug, change_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(project, featureId, slug, changeKind, now, now)
    );
    return this.getRun(Number(result.lastInsertRowid))!;
  }

  getRun(id: number): RunRow | undefined {
    return this.query<RunRow>("SELECT * FROM run WHERE id = ?", [id])[0];
  }

  insertStage(runId: number, kind: string, inputStageId: number | null): StageRow {
    if (!this.getRun(runId)) {
      throw new Error(`run ${runId} does not exist`);
    }
    const id = this.transaction(() => {
      let ordinal = 0;
      if (inputStageId !== null) {
        const input = this.query<StageRow>("SELECT * FROM stage WHERE id = ?", [inputStageId])[0];
        if (!input) {
          throw new Error(`stage ${inputStageId} does not exist`);
        }
        if (input.run_id !== runId) {
          throw new Error(`stage ${inputStageId} belongs to run ${input.run_id}, not run ${runId}`);
        }
        ordinal = input.ordinal + 1;
      }
      const result = this.#db
        .prepare("INSERT INTO stage (run_id, kind, ordinal, input_stage_id) VALUES (?, ?, ?, ?)")
        .run(runId, kind, ordinal, inputStageId);
      return Number(result.lastInsertRowid);
    });
    return this.getStage(id)!;
  }

  getStage(id: number): StageRow | undefined {
    return this.query<StageRow>("SELECT * FROM stage WHERE id = ?", [id])[0];
  }

  getStageChain(runId: number): StageRow[] {
    return this.query<StageRow>("SELECT * FROM stage WHERE run_id = ? ORDER BY ordinal", [runId]);
  }

  setStageStatus(id: number, status: string, gateResult?: string): void {
    if (!STAGE_STATUSES.includes(status)) {
      throw new Error(`invalid stage status ${status}: allowed values are ${STAGE_STATUSES.join(", ")}`);
    }
    let result: { changes: number | bigint };
    if (gateResult === undefined) {
      // A status-only update must not erase a recorded gate result.
      result = this.#withRetry(() =>
        this.#db.prepare("UPDATE stage SET status = ? WHERE id = ?").run(status, id)
      );
    } else {
      if (!GATE_RESULTS.includes(gateResult)) {
        throw new Error(`invalid gate_result ${gateResult}: allowed values are ${GATE_RESULTS.join(", ")}`);
      }
      result = this.#withRetry(() =>
        this.#db.prepare("UPDATE stage SET status = ?, gate_result = ? WHERE id = ?").run(status, gateResult, id)
      );
    }
    if (result.changes === 0) {
      throw new Error(`stage ${id} does not exist`);
    }
  }

  completeStage(id: number, outputRef: string, gateResult: string): StageRow {
    if (!GATE_RESULTS.includes(gateResult)) {
      throw new Error(`invalid gate_result ${gateResult}: allowed values are ${GATE_RESULTS.join(", ")}`);
    }
    const status: StageStatus = gateResult === "pass" ? "passed" : "blocked";
    const result = this.#withRetry(() =>
      this.#db
        .prepare("UPDATE stage SET status = ?, gate_result = ?, output_ref = ?, ended_at = ? WHERE id = ?")
        .run(status, gateResult, outputRef, new Date().toISOString(), id)
    );
    if (result.changes === 0) {
      throw new Error(`stage ${id} does not exist`);
    }
    return this.getStage(id)!;
  }
}

export function openStore(rootDir: string = process.cwd()): Store {
  return new Store(rootDir);
}
