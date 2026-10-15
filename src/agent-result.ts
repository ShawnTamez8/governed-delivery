export type AgentResultStatus = "proposed" | "blocked" | "failed";

export interface ProposedPatchFile {
  path: string;
  action: "add" | "modify";
  content?: string;
}

export interface ProposedPatch {
  baseCommit: string;
  files: ProposedPatchFile[];
}

export interface AgentResult {
  status: AgentResultStatus;
  agent: string;
  role: "author" | "reviewer";
  executor: string;
  summary: string;
  proposedContentChanges?: unknown;
  proposedPatches?: ProposedPatch[];
  diagnostics?: string[];
  questions?: string[];
  risk?: string;
  confidence?: number;
  recommendedTransition?: string;
}

export const STATUSES: readonly string[] = ["proposed", "blocked", "failed"];
export const PATCH_ACTIONS: readonly string[] = ["add", "modify"];

/**
 * The JSON Schema the patch-producing dispatches (each implementation phase and
 * code-review remediation) send with `--json-schema`
 * (`docs/features/structured-patch-output/plan.md`). It is the schema the
 * 2026-10-14 probes sent: `provenance.schema` in
 * `test/fixtures/recorded/json-schema-probe-web-calculator-phase-2.json`, which
 * `test/fixtures/recorded/json-schema-probe-gate.json` reused. The enums come
 * from the validator's own constants, so the two cannot drift.
 *
 * It travels per invocation, like model and effort, and is not frozen into a
 * run's profile: it describes the reply this code reads, as the prompt text
 * does. The validator above stays the check; the schema holds the model to the
 * fields the prompt advertises before the reply reaches it.
 */
export const PATCH_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "agent", "role", "executor", "summary", "proposedPatches"],
  properties: {
    status: { type: "string", enum: [...STATUSES] },
    agent: { type: "string" },
    role: { type: "string", enum: ["author", "reviewer"] },
    executor: { type: "string" },
    summary: { type: "string" },
    proposedPatches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["baseCommit", "files"],
        properties: {
          baseCommit: { type: "string" },
          files: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "action", "content"],
              properties: {
                path: { type: "string" },
                action: { type: "string", enum: [...PATCH_ACTIONS] },
                content: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

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
  if (r.proposedPatches !== undefined) {
    if (!Array.isArray(r.proposedPatches)) {
      return { ok: false, reason: "proposedPatches must be an array" };
    }
    for (const patch of r.proposedPatches as Record[]) {
      if (typeof patch.baseCommit !== "string" || patch.baseCommit === "") {
        return { ok: false, reason: "proposed patch is missing baseCommit" };
      }
      if (!Array.isArray(patch.files)) {
        return { ok: false, reason: "proposed patch files must be an array" };
      }
      for (const file of patch.files as Record[]) {
        if (file.action === "delete") {
          return { ok: false, reason: "deletion is schema-legal but refused" };
        }
        if (typeof file.action !== "string" || !PATCH_ACTIONS.includes(file.action)) {
          return {
            ok: false,
            reason: `invalid patch action ${String(file.action)}: allowed values are ${PATCH_ACTIONS.join(", ")}`,
          };
        }
        if (typeof file.path !== "string" || file.path === "") {
          return { ok: false, reason: "proposed patch file path must be a non-empty string" };
        }
      }
    }
  }
  return { ok: true, value: raw as AgentResult };
}
