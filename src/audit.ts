import { createHash } from "node:crypto";
import type { Store } from "./store.ts";

export interface AuditInput {
  runId: number;
  stageId: number | null;
  actor: string;
  actorType: string;
  action: string;
  summary: string;
}

export interface AuditRow {
  id: number;
  run_id: number;
  stage_id: number | null;
  actor: string;
  actor_type: string;
  action: string;
  summary: string;
  hash: string;
  prev_hash: string | null;
  created_at: string;
}

export interface ChainBreak {
  id: number;
  stored: string;
  recomputed: string;
}

/**
 * The canonical event string, per the architecture's hash rule: content plus
 * the previous event's hash. `stage_id` and `prev_hash` serialize as the
 * empty string when absent. This is the only builder — appending and
 * verification share it, so the two cannot drift. Any change to this string
 * breaks every existing chain, so it changes only deliberately, never
 * incidentally.
 */
function contentOf(
  e: Pick<AuditRow, "created_at" | "actor" | "actor_type" | "action" | "summary" | "run_id" | "stage_id">,
  prevHash: string | null
): string {
  return [
    e.created_at,
    e.actor,
    e.actor_type,
    e.action,
    e.summary,
    String(e.run_id),
    e.stage_id === null ? "" : String(e.stage_id),
    prevHash ?? "",
  ].join("\n");
}

export function appendAudit(store: Store, input: AuditInput): void {
  const created_at = new Date().toISOString();
  store.transaction(() => {
    const last = store.query<AuditRow>("SELECT * FROM audit ORDER BY id DESC LIMIT 1")[0];
    const prevHash = last?.hash ?? null;
    const row = {
      created_at,
      actor: input.actor,
      actor_type: input.actorType,
      action: input.action,
      summary: input.summary,
      run_id: input.runId,
      stage_id: input.stageId,
    };
    const hash: string = createHash("sha256").update(contentOf(row, prevHash)).digest("hex");
    store.exec(
      "INSERT INTO audit (run_id, stage_id, actor, actor_type, action, summary, hash, prev_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [input.runId, input.stageId, input.actor, input.actorType, input.action, input.summary, hash, prevHash, created_at]
    );
  });
}

export function verifyAuditChain(store: Store): ChainBreak | null {
  const rows = store.query<AuditRow>("SELECT * FROM audit ORDER BY id");
  let prev: string | null = null;
  for (const row of rows) {
    const recomputed: string = createHash("sha256").update(contentOf(row, prev)).digest("hex");
    if (recomputed !== row.hash) {
      return { id: row.id, stored: row.hash, recomputed };
    }
    prev = row.hash;
  }
  return null;
}
