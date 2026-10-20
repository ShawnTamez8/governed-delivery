import { extractJsonBody } from "./parse-output.ts";

export type AgentResultStatus = "proposed" | "blocked" | "failed";

export interface AgentResult {
  status: AgentResultStatus;
  agent: string;
  role: "author" | "reviewer";
  executor: string;
  summary: string;
  proposedContentChanges?: unknown;
  diagnostics?: string[];
  questions?: string[];
  risk?: string;
  confidence?: number;
  recommendedTransition?: string;
}

export const STATUSES: readonly string[] = ["proposed", "blocked", "failed"];

/** The two states a patch dispatch reports when it finishes changing the workspace. */
export const WORKSPACE_STATUSES: readonly string[] = ["completed", "blocked"];

/**
 * What a patch dispatch (each implementation phase, the self-review and
 * code-review remediation) returns through `--json-schema` now that it
 * changes files through the tool server
 * (docs/features/sandboxed-implementer/plan.md): a summary, never file
 * contents. The diff is computed from the worktree, not reported. The shape is
 * the spike's (`provenance` and `resultLine` in
 * `test/fixtures/recorded/sandbox-spike-crew-chatter-phase-2.json`).
 */
export const WORKSPACE_REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "incompleteTasks"],
  properties: {
    status: { type: "string", enum: [...WORKSPACE_STATUSES] },
    summary: { type: "string" },
    incompleteTasks: { type: "array", items: { type: "string" } },
  },
};

export interface WorkspaceReply {
  status: "completed" | "blocked";
  summary: string;
  incompleteTasks: string[];
}

/** The schema's rules, checked again at the boundary, every refusal named (hazard 1). */
export function validateWorkspaceReply(raw: unknown): { ok: true; value: WorkspaceReply } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "the reply must be an object" };
  }
  const r = raw as { [key: string]: unknown };
  if (typeof r.status !== "string" || !WORKSPACE_STATUSES.includes(r.status)) {
    return { ok: false, reason: `invalid reply status ${JSON.stringify(r.status)}: allowed values are ${WORKSPACE_STATUSES.join(", ")}` };
  }
  if (typeof r.summary !== "string" || r.summary.trim() === "") {
    return { ok: false, reason: "the reply summary must be a non-empty string" };
  }
  if (!Array.isArray(r.incompleteTasks) || r.incompleteTasks.some((t) => typeof t !== "string")) {
    return { ok: false, reason: "the reply incompleteTasks must be an array of strings" };
  }
  // Each prompt defines completed as nothing left undone, so a completed reply
  // that lists something contradicts itself; accepting it would drop the list
  // unrecorded.
  if (r.status === "completed" && r.incompleteTasks.length > 0) {
    return { ok: false, reason: `the reply says completed but lists incomplete tasks: ${(r.incompleteTasks as string[]).join("; ")}` };
  }
  return {
    ok: true,
    value: { status: r.status as WorkspaceReply["status"], summary: r.summary, incompleteTasks: r.incompleteTasks as string[] },
  };
}

/**
 * A patch dispatch's structured output, read and checked by `validate`
 * (`validateWorkspaceReply`, or the self-review's validator), every refusal named.
 */
export function parseWorkspaceReply<T>(
  resultText: string,
  validate: (raw: unknown) => { ok: true; value: T } | { ok: false; reason: string }
): { ok: true; value: T } | { ok: false; reason: string } {
  const body = extractJsonBody(resultText);
  if (body.kind === "refused") return { ok: false, reason: `implementer body refused: ${body.reason}` };
  const reply = validate(body.value);
  return reply.ok ? reply : { ok: false, reason: `implementer reply refused: ${reply.reason}` };
}

/** A reply that did not complete, quoted so the operator sees what the agent said it could not do. */
export function describeIncompleteReply(reply: WorkspaceReply): string {
  return `status ${reply.status}, not completed: ${reply.summary}; incomplete: ${reply.incompleteTasks.length > 0 ? reply.incompleteTasks.join("; ") : "none listed"}`;
}

type Record = { [key: string]: unknown };

/**
 * Section 8's contract, enforced at the boundary. Every refusal names its
 * cause (hazard 1). Unknown extra fields are ignored, never an error —
 * the contract is a floor, not a cage.
 */
export function validateAgentResult(
  agentId: string,
  raw: unknown
): { ok: true; value: AgentResult } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "AgentResult must be an object" };
  }
  const r = raw as Record;
  if (typeof r.status !== "string" || !STATUSES.includes(r.status)) {
    return {
      ok: false,
      reason: `invalid AgentResult status ${String(r.status)}: allowed values are ${STATUSES.join(", ")}`,
    };
  }
  if (typeof r.agent !== "string" || r.agent === "") {
    return { ok: false, reason: "AgentResult agent must be a non-empty string" };
  }
  if (r.agent !== agentId) {
    return { ok: false, reason: `AgentResult agent ${r.agent} does not match dispatched agent ${agentId}` };
  }
  if (typeof r.role !== "string" || (r.role !== "author" && r.role !== "reviewer")) {
    return { ok: false, reason: `invalid AgentResult role ${String(r.role)}: allowed values are author, reviewer` };
  }
  if (typeof r.executor !== "string" || r.executor === "") {
    return { ok: false, reason: "AgentResult executor must be a non-empty string" };
  }
  if (typeof r.summary !== "string" || r.summary === "") {
    return { ok: false, reason: "AgentResult summary must be a non-empty string" };
  }
  return { ok: true, value: raw as AgentResult };
}
