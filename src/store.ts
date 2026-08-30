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

export interface AgentRunRow {
  id: number;
  stage_id: number;
  agent: string;
  role: "author" | "reviewer";
  executor: string;
  requested_model: string;
  effective_model: string | null;
  fallback: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cache_read: number | null;
  cache_write: number | null;
  cost: number | null;
  duration_ms: number;
  input_hash: string;
  output_hash: string;
  raw_output_ref: string;
  independence: "unverified_self_attestation" | "configured_standalone";
}

export interface FindingRow {
  id: number;
  stage_id: number;
  agent_run_id: number | null;
  severity: string;
  intent_key: string;
  subject: string;
  location: string;
  disposition: string;
}

export interface ApprovalRow {
  id: number;
  run_id: number;
  feature_id: string;
  spec_hash: string;
  starting_commit: string;
  profile_hash: string;
  risk: string;
  scope: string;
  expires_at: string;
  signature: string;
  signer: string;
  created_at: string;
}

export interface ApprovalInput {
  runId: number;
  featureId: string;
  specHash: string;
  startingCommit: string;
  profileHash: string;
  risk: string;
  scope: string;
  expiresAt: string;
  signature: string;
  signer: string;
}

export interface FindingInput {
  stageId: number;
  agentRunId: number | null;
  severity: string;
  intentKey: string;
  subject: string;
  location: string;
  disposition?: string;
}

export interface AgentRunInput {
  stageId: number;
  agent: string;
  role: string;
  executor: string;
  requestedModel: string;
  effectiveModel: string | null;
  fallback: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  cost: number | null;
  durationMs: number;
  inputHash: string;
  outputHash: string;
  rawOutputRef: string;
  independence: string;
}

export const CHANGE_KINDS: readonly string[] = ["feature", "defect_fix"];
const STAGE_STATUSES: readonly string[] = ["pending", "in_progress", "passed", "blocked", "failed"];
export const GATE_RESULTS: readonly string[] = ["pass", "block"];
export const ROLES: readonly string[] = ["author", "reviewer"];
export const INDEPENDENCE: readonly string[] = ["unverified_self_attestation", "configured_standalone"];
const RUN_STATUSES: readonly string[] = ["in_progress", "blocked", "completed"];
// Single source: finding.ts owns the finding enums; the store imports them
// so the validation and the migration CHECK cannot drift apart.
import { DISPOSITIONS as FINDING_DISPOSITIONS, SEVERITIES as FINDING_SEVERITIES } from "./finding.ts";
// Same rule for risk: select.ts owns the values beside the Risk type.
import { RISKS } from "./select.ts";

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

  /** Nesting depth of `transaction`; 0 means no transaction is open. */
  #txDepth = 0;
  /**
   * Set when a nested unit fails. The outermost frame must not COMMIT a unit
   * a nested failure aborted, even when a caller swallowed the thrown error:
   * without this flag, a swallowed nested throw would commit the writes that
   * preceded it — a silent partial unit.
   */
  #txAborted = false;

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
   *
   * Re-entrant. `insertStage` and `appendAudit` each open their own
   * transaction, so an operation that must commit several of them as one unit
   * — the approval gate is the first — could not previously wrap them:
   * SQLite refuses a nested BEGIN. A nested call joins the outer transaction
   * instead, and only the outermost frame issues BEGIN, COMMIT, or ROLLBACK.
   *
   * A throw at any depth aborts the whole unit rather than half of it. If the
   * error propagates, the outermost frame rolls back once; if a caller
   * swallows it, the abort flag still forces the outermost frame to roll back
   * rather than commit the partial unit. Only the outermost frame retries on
   * SQLITE_BUSY: a nested retry would re-run part of a unit whose earlier
   * writes already happened.
   */
  transaction<T>(fn: () => T): T {
    if (this.#txDepth > 0) {
      this.#txDepth++;
      try {
        const result = fn();
        this.#txDepth--;
        return result;
      } catch (err) {
        // Restore the depth and flag the unit aborted. A swallowed error must
        // not commit the writes that preceded it, so the outermost frame
        // checks the flag before COMMIT instead of trusting the return.
        this.#txDepth--;
        this.#txAborted = true;
        throw err;
      }
    }
    return this.#withRetry(() => {
      this.#db.exec("BEGIN IMMEDIATE");
      this.#txDepth = 1;
      let rolledBack = false;
      try {
        const result = fn();
        if (this.#txAborted) {
          this.#txAborted = false;
          this.#txDepth = 0;
          rolledBack = true;
          this.#db.exec("ROLLBACK");
          throw new Error("transaction aborted by a nested failure");
        }
        this.#txDepth = 0;
        this.#db.exec("COMMIT");
        return result;
      } catch (err) {
        this.#txAborted = false;
        this.#txDepth = 0;
        if (!rolledBack) this.#db.exec("ROLLBACK");
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
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`invalid slug ${slug}: must be lowercase kebab-case`);
    }
    // feature_id is interpolated into the signed approval payload, where a
    // line break would forge a second field. `project` is deliberately not
    // constrained: it never enters the payload.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(featureId)) {
      throw new Error(
        // JSON.stringify, not raw: an error about a line break must not itself
        // contain one, or the diagnostic is as unreadable as the input.
        `invalid feature_id ${JSON.stringify(featureId)}: must be 1-64 characters of letters, digits, dot, underscore, or hyphen, starting with a letter or digit`
      );
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

  insertAgentRun(input: AgentRunInput): AgentRunRow {
    if (!ROLES.includes(input.role)) {
      throw new Error(`invalid role ${input.role}: allowed values are ${ROLES.join(", ")}`);
    }
    if (!INDEPENDENCE.includes(input.independence)) {
      throw new Error(`invalid independence ${input.independence}: allowed values are ${INDEPENDENCE.join(", ")}`);
    }
    const result = this.#withRetry(() =>
      this.#db
        .prepare(
          `INSERT INTO agent_run (stage_id, agent, role, executor, requested_model, effective_model,
             fallback, tokens_in, tokens_out, cache_read, cache_write, cost, duration_ms,
             input_hash, output_hash, raw_output_ref, independence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.stageId,
          input.agent,
          input.role,
          input.executor,
          input.requestedModel,
          input.effectiveModel,
          input.fallback,
          input.tokensIn,
          input.tokensOut,
          input.cacheRead,
          input.cacheWrite,
          input.cost,
          input.durationMs,
          input.inputHash,
          input.outputHash,
          input.rawOutputRef,
          input.independence
        )
    );
    return this.getAgentRun(Number(result.lastInsertRowid))!;
  }

  getAgentRun(id: number): AgentRunRow | undefined {
    return this.query<AgentRunRow>("SELECT * FROM agent_run WHERE id = ?", [id])[0];
  }

  insertFinding(input: FindingInput): FindingRow {
    if (!FINDING_SEVERITIES.includes(input.severity)) {
      throw new Error(
        `invalid severity ${input.severity}: allowed values are ${FINDING_SEVERITIES.join(", ")}`
      );
    }
    const disposition = input.disposition ?? "open";
    if (!FINDING_DISPOSITIONS.includes(disposition)) {
      throw new Error(
        `invalid disposition ${disposition}: allowed values are ${FINDING_DISPOSITIONS.join(", ")}`
      );
    }
    const result = this.#withRetry(() =>
      this.#db
        .prepare(
          `INSERT INTO finding (stage_id, agent_run_id, severity, intent_key, subject, location, disposition)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(stage_id, intent_key, location) DO UPDATE SET
             severity = excluded.severity,
             subject = excluded.subject,
             agent_run_id = excluded.agent_run_id,
             disposition = excluded.disposition`
        )
        .run(input.stageId, input.agentRunId, input.severity, input.intentKey, input.subject, input.location, disposition)
    );
    return this.getFinding(Number(result.lastInsertRowid))!;
  }

  getFinding(id: number): FindingRow | undefined {
    return this.query<FindingRow>("SELECT * FROM finding WHERE id = ?", [id])[0];
  }

  getFindings(stageId: number): FindingRow[] {
    return this.query<FindingRow>("SELECT * FROM finding WHERE stage_id = ? ORDER BY id", [stageId]);
  }

  updateFindingDisposition(id: number, disposition: string): void {
    if (!FINDING_DISPOSITIONS.includes(disposition)) {
      throw new Error(
        `invalid disposition ${disposition}: allowed values are ${FINDING_DISPOSITIONS.join(", ")}`
      );
    }
    const result = this.#withRetry(() =>
      this.#db.prepare("UPDATE finding SET disposition = ? WHERE id = ?").run(disposition, id)
    );
    if (result.changes === 0) {
      throw new Error(`finding ${id} does not exist`);
    }
  }

  /**
   * The signed authorization (architecture section 12). `UNIQUE (run_id)` in
   * the migration is what makes "one authorization covers the rest" a schema
   * rule rather than a convention.
   */
  insertApproval(input: ApprovalInput): ApprovalRow {
    if (!RISKS.includes(input.risk)) {
      throw new Error(`invalid risk ${input.risk}: allowed values are ${RISKS.join(", ")}`);
    }
    const result = this.#withRetry(() =>
      this.#db
        .prepare(
          `INSERT INTO approval (run_id, feature_id, spec_hash, starting_commit, profile_hash,
             risk, scope, expires_at, signature, signer, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.runId,
          input.featureId,
          input.specHash,
          input.startingCommit,
          input.profileHash,
          input.risk,
          input.scope,
          input.expiresAt,
          input.signature,
          input.signer,
          new Date().toISOString()
        )
    );
    return this.query<ApprovalRow>("SELECT * FROM approval WHERE id = ?", [
      Number(result.lastInsertRowid),
    ])[0]!;
  }

  getApproval(runId: number): ApprovalRow | undefined {
    return this.query<ApprovalRow>("SELECT * FROM approval WHERE run_id = ?", [runId])[0];
  }

  setProfileRef(id: number, profileHash: string): void {
    const result = this.#withRetry(() =>
      this.#db.prepare("UPDATE run SET profile_ref = ?, updated_at = ? WHERE id = ?").run(
        profileHash,
        new Date().toISOString(),
        id
      )
    );
    if (result.changes === 0) {
      throw new Error(`run ${id} does not exist`);
    }
  }

  setRunStatus(id: number, status: string): void {
    if (!RUN_STATUSES.includes(status)) {
      throw new Error(`invalid run status ${status}: allowed values are ${RUN_STATUSES.join(", ")}`);
    }
    const result = this.#withRetry(() =>
      this.#db.prepare("UPDATE run SET status = ?, updated_at = ? WHERE id = ?").run(
        status,
        new Date().toISOString(),
        id
      )
    );
    if (result.changes === 0) {
      throw new Error(`run ${id} does not exist`);
    }
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

/**
 * The one "may this run do work" check, shared by every entry point that
 * spends against a run. A blocked or completed run can never finish, so work
 * against it is spend with no possible outcome; `buildBinding` and
 * `runSpecStage` both refuse it, and one message keeps the two from drifting.
 * Returns null when work may proceed.
 */
export function requireRunInProgress(run: RunRow): string | null {
  return run.status === "in_progress" ? null : `run ${run.id} is ${run.status}, not in_progress`;
}
