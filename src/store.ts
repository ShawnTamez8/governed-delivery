import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "./migrate.ts";
import { stateDbPath } from "./paths.ts";
import type { AuditRow } from "./audit.ts";

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

/**
 * Round-scoped canonical identity (section 8): `(stage_id, round, intent_key,
 * location)`. Carries no severity, classification, or subject — those are a
 * reviewer's own assertion and live on `finding_report`, never fused here.
 */
export interface CanonicalFindingRow {
  id: number;
  stage_id: number;
  round: number;
  intent_key: string;
  location: string;
}

/**
 * One reviewer's immutable report on a canonical finding. `UNIQUE (finding_id,
 * agent_run_id)` is what makes "one report per reviewer per finding" a schema
 * rule: a second report from the same `agent_run` is a bug, not evidence.
 */
export interface FindingReportRow {
  id: number;
  finding_id: number;
  agent_run_id: number;
  severity: string;
  classification: string;
  subject: string;
}

/**
 * The reconciler's one typed answer to a canonical finding (section 12).
 * `changed_locations` and `normative_changes` are JSON-encoded, matching
 * `approval.scope`'s existing convention for an array column nothing queries
 * into; grounding gets three real columns because unlike those arrays it is
 * one object with three named, individually meaningful fields.
 * `UNIQUE (finding_id)` is what makes "exactly one decision per finding,
 * ever" a schema rule.
 */
export interface FindingDecisionRow {
  id: number;
  finding_id: number;
  agent_run_id: number;
  disposition: string;
  rationale: string;
  changed_locations: string;
  grounding_source: string | null;
  grounding_location: string | null;
  grounding_excerpt: string | null;
  normative_changes: string | null;
  artifact_hash_before: string;
  artifact_hash_after: string;
}

/**
 * An upstream concern's durable record (section 13, section 14). `identity`
 * is the deterministic dedup key `proposal.ts` derives; `UNIQUE (stage_id,
 * identity)` is what makes "the same concern raised again links a source
 * rather than duplicating" a schema rule instead of a convention a caller
 * could forget.
 */
export interface ProposalRow {
  id: number;
  run_id: number;
  stage_id: number;
  identity: string;
  title: string;
  problem: string;
  why_upstream: string;
  route: string;
  evidence_ref: string;
  created_at: string;
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

export interface FindingReportInput {
  findingId: number;
  agentRunId: number;
  severity: string;
  classification: string;
  subject: string;
}

export interface DecisionGrounding {
  source: string;
  location: string;
  excerpt: string;
}

export interface DecisionNormativeChange {
  artifactLocation: string;
  artifactText: string;
  grounding: DecisionGrounding;
}

export interface FindingDecisionInput {
  findingId: number;
  agentRunId: number;
  disposition: string;
  rationale: string;
  changedLocations: string[];
  grounding: DecisionGrounding | null;
  normativeChanges: DecisionNormativeChange[] | null;
  artifactHashBefore: string;
  artifactHashAfter: string;
}

export interface ProposalInput {
  runId: number;
  stageId: number;
  findingId: number;
  title: string;
  problem: string;
  whyUpstream: string;
  route: string;
  evidenceRef: string;
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
// Single source: finding.ts and reconciliation.ts own their vocabularies; the
// store imports them so validation and the migration CHECK cannot drift apart.
import { SEVERITIES as FINDING_SEVERITIES } from "./finding.ts";
import {
  CLASSIFICATIONS,
  DISPOSITIONS as RECONCILIATION_DISPOSITIONS,
  UPSTREAM_SOURCES,
} from "./reconciliation.ts";
import { PROPOSAL_ROUTES } from "./proposal.ts";
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
    const dbPath = stateDbPath(rootDir);
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

  /**
   * Resolve against the canonical findings already stored for this stage and
   * round (the round-scoped identity, section 8), never a map local to one
   * call — a caller that re-derives its own in-memory table can only ever
   * agree with itself. Read-then-maybe-insert is wrapped in `transaction()`
   * for the same reason `insertStage` wraps its ordinal computation: the pair
   * must be atomic under the single-writer lock.
   *
   * Returns the row that now exists at this identity, by identity re-select
   * rather than `lastInsertRowid` — the bug this replaces (`src/store.ts`'s
   * removed `insertFinding`) returned whichever row the *previous* successful
   * insert created on the conflict path, because SQLite does not update
   * `last_insert_rowid()` on `ON CONFLICT ... DO UPDATE`. This upsert never
   * updates a matched row at all, so there is no excluded-value ambiguity to
   * get wrong: a match returns exactly the row it matched.
   */
  upsertCanonicalFinding(stageId: number, round: number, intentKey: string, location: string): CanonicalFindingRow {
    return this.transaction(() => {
      const existing = this.query<CanonicalFindingRow>(
        "SELECT * FROM finding WHERE stage_id = ? AND round = ? AND intent_key = ? AND location = ?",
        [stageId, round, intentKey, location]
      )[0];
      if (existing) return existing;
      const result = this.#db
        .prepare("INSERT INTO finding (stage_id, round, intent_key, location) VALUES (?, ?, ?, ?)")
        .run(stageId, round, intentKey, location);
      return this.getCanonicalFinding(Number(result.lastInsertRowid))!;
    });
  }

  getCanonicalFinding(id: number): CanonicalFindingRow | undefined {
    return this.query<CanonicalFindingRow>("SELECT * FROM finding WHERE id = ?", [id])[0];
  }

  /** Every canonical finding raised in any round of this stage, oldest first. */
  getCanonicalFindings(stageId: number): CanonicalFindingRow[] {
    return this.query<CanonicalFindingRow>("SELECT * FROM finding WHERE stage_id = ? ORDER BY id", [stageId]);
  }

  /**
   * Immutable evidence: one reviewer's severity, classification, and subject
   * on one canonical finding. `UNIQUE (finding_id, agent_run_id)` refuses a
   * second report from the same reviewer rather than upserting over the
   * first — section 13's no-fusion rule enforced as a constraint, not a
   * convention a caller could forget.
   */
  insertFindingReport(input: FindingReportInput): FindingReportRow {
    if (!FINDING_SEVERITIES.includes(input.severity)) {
      throw new Error(
        `invalid severity ${input.severity}: allowed values are ${FINDING_SEVERITIES.join(", ")}`
      );
    }
    if (!CLASSIFICATIONS.includes(input.classification)) {
      throw new Error(
        `invalid classification ${input.classification}: allowed values are ${CLASSIFICATIONS.join(", ")}`
      );
    }
    const result = this.#withRetry(() =>
      this.#db
        .prepare(
          `INSERT INTO finding_report (finding_id, agent_run_id, severity, classification, subject)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(input.findingId, input.agentRunId, input.severity, input.classification, input.subject)
    );
    return this.getFindingReport(Number(result.lastInsertRowid))!;
  }

  getFindingReport(id: number): FindingReportRow | undefined {
    return this.query<FindingReportRow>("SELECT * FROM finding_report WHERE id = ?", [id])[0];
  }

  /** Every immutable report on one canonical finding, oldest first. */
  getFindingReports(findingId: number): FindingReportRow[] {
    return this.query<FindingReportRow>(
      "SELECT * FROM finding_report WHERE finding_id = ? ORDER BY id",
      [findingId]
    );
  }

  /**
   * The reconciler's one typed answer to a canonical finding. `UNIQUE
   * (finding_id)` refuses a second decision on the same finding — a finding
   * is decided once, ever; a later round raising the same concern again gets
   * a later-round canonical identity (section 8) and its own decision.
   */
  insertFindingDecision(input: FindingDecisionInput): FindingDecisionRow {
    if (!RECONCILIATION_DISPOSITIONS.includes(input.disposition)) {
      throw new Error(
        `invalid disposition ${input.disposition}: allowed values are ${RECONCILIATION_DISPOSITIONS.join(", ")}`
      );
    }
    // The conditional-field matrix `src/reconciliation.ts` enforces on the
    // model's answer, enforced again at the storage boundary (Task 7 step 4).
    // The stages only ever pass decisions that validator already checked, so
    // this refuses nothing the ordinary path produces — but the exported
    // method and the authoritative table are reachable without it, and a
    // CHECK constraint cannot express a cross-column rule like "grounding
    // exactly when rejected_with_rationale". Without this, the database can
    // hold a decision shape no reconciliation could ever return.
    const requiresGrounding = input.disposition === "rejected_with_rationale";
    if (requiresGrounding && input.grounding === null) {
      throw new Error(`disposition ${input.disposition} requires a grounding object`);
    }
    if (!requiresGrounding && input.grounding !== null) {
      throw new Error(`disposition ${input.disposition} forbids a grounding object`);
    }
    const requiresNormativeChanges = input.disposition === "addressed";
    if (requiresNormativeChanges && input.normativeChanges === null) {
      throw new Error(`disposition ${input.disposition} requires a normativeChanges array`);
    }
    if (!requiresNormativeChanges && input.normativeChanges !== null) {
      throw new Error(`disposition ${input.disposition} forbids normativeChanges`);
    }
    // Every grounding object, including the one nested in each normative
    // change, must cite a governing source rather than the artifact under
    // review — the rule `groundingTextuallyFails` states first.
    const sources = [
      ...(input.grounding ? [input.grounding.source] : []),
      ...(input.normativeChanges ?? []).map((change) => change.grounding.source),
    ];
    for (const source of sources) {
      if (!UPSTREAM_SOURCES.includes(source as (typeof UPSTREAM_SOURCES)[number])) {
        throw new Error(
          `invalid grounding source ${source}: allowed values are ${UPSTREAM_SOURCES.join(", ")}`
        );
      }
    }
    const result = this.#withRetry(() =>
      this.#db
        .prepare(
          `INSERT INTO finding_decision (finding_id, agent_run_id, disposition, rationale, changed_locations,
             grounding_source, grounding_location, grounding_excerpt, normative_changes,
             artifact_hash_before, artifact_hash_after)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.findingId,
          input.agentRunId,
          input.disposition,
          input.rationale,
          JSON.stringify(input.changedLocations),
          input.grounding?.source ?? null,
          input.grounding?.location ?? null,
          input.grounding?.excerpt ?? null,
          input.normativeChanges ? JSON.stringify(input.normativeChanges) : null,
          input.artifactHashBefore,
          input.artifactHashAfter
        )
    );
    return this.getFindingDecision(Number(result.lastInsertRowid))!;
  }

  getFindingDecision(id: number): FindingDecisionRow | undefined {
    return this.query<FindingDecisionRow>("SELECT * FROM finding_decision WHERE id = ?", [id])[0];
  }

  /**
   * Every decision recorded against this stage, across every round — the
   * read the decision gate (Task 9) uses. A per-round read would let a later
   * round's clean decisions hide an earlier round's `upstream_blocking`.
   */
  getFindingDecisions(stageId: number): FindingDecisionRow[] {
    return this.query<FindingDecisionRow>(
      `SELECT finding_decision.* FROM finding_decision
       JOIN finding ON finding.id = finding_decision.finding_id
       WHERE finding.stage_id = ?
       ORDER BY finding_decision.id`,
      [stageId]
    );
  }

  /**
   * A validated upstream proposal candidate becomes a stored, queryable,
   * non-binding proposal. `identity` (computed by `proposal.ts`, the module
   * that owns the derivation) is the dedup key: a candidate that already
   * matches one raised earlier in this stage links its source finding rather
   * than duplicating title, problem, or route — no field is fused across the
   * two decisions, only the source finding id set grows.
   */
  upsertProposal(input: ProposalInput, identity: string): { proposal: ProposalRow; created: boolean } {
    if (!PROPOSAL_ROUTES.includes(input.route)) {
      throw new Error(`invalid route ${input.route}: allowed values are ${PROPOSAL_ROUTES.join(", ")}`);
    }
    return this.transaction(() => {
      const existing = this.query<ProposalRow>(
        "SELECT * FROM proposal WHERE stage_id = ? AND identity = ?",
        [input.stageId, identity]
      )[0];
      let proposal: ProposalRow;
      let created: boolean;
      if (existing) {
        proposal = existing;
        created = false;
      } else {
        const result = this.#db
          .prepare(
            `INSERT INTO proposal (run_id, stage_id, identity, title, problem, why_upstream, route, evidence_ref, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            input.runId,
            input.stageId,
            identity,
            input.title,
            input.problem,
            input.whyUpstream,
            input.route,
            input.evidenceRef,
            new Date().toISOString()
          );
        proposal = this.getProposal(Number(result.lastInsertRowid))!;
        created = true;
      }
      this.#db
        .prepare("INSERT INTO proposal_source (proposal_id, finding_id) VALUES (?, ?)")
        .run(proposal.id, input.findingId);
      return { proposal, created };
    });
  }

  getProposal(id: number): ProposalRow | undefined {
    return this.query<ProposalRow>("SELECT * FROM proposal WHERE id = ?", [id])[0];
  }

  /** Every proposal raised out of this stage, oldest first. */
  getProposalsForStage(stageId: number): ProposalRow[] {
    return this.query<ProposalRow>("SELECT * FROM proposal WHERE stage_id = ? ORDER BY id", [stageId]);
  }

  /** Every canonical finding id that contributed to one proposal, oldest link first. */
  getProposalSources(proposalId: number): number[] {
    return this.query<{ finding_id: number }>(
      "SELECT finding_id FROM proposal_source WHERE proposal_id = ? ORDER BY rowid",
      [proposalId]
    ).map((r) => r.finding_id);
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

  /**
   * Every audit event for one run, oldest first.
   *
   * `appendAudit` and `verifyAuditChain` write and check the chain; until now
   * nothing handed rows back to a caller. The verification stage needs one
   * fact that lives nowhere else: the head the implementation stage committed,
   * which that stage recorded in its own `implementation.gate.pass` event. A
   * reader here is how it gets that without step 6 changing.
   *
   * Insertion order is `id` order — the chain is append-only and the triggers
   * refuse an update or a delete, so ids never reorder.
   */
  getAuditEvents(runId: number): AuditRow[] {
    return this.query<AuditRow>("SELECT * FROM audit WHERE run_id = ? ORDER BY id", [runId]);
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
