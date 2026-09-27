import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { approvalPayload, loadPublicKey } from "./approval.ts";
import { approveRun, buildBinding } from "./approval-stage.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { acquireLock } from "./lock.ts";
import { APPROVAL_DEFAULT_LIFETIME_SECONDS } from "./policy.ts";
import { resolveRepositoryRoot, TargetUnavailableError } from "./repo-root.ts";
import { openStore, StoreStateError, type Store } from "./store.ts";

/**
 * The dashboard's one write (architecture section 23, 2026-09-26). Every
 * approval decision below belongs to `buildBinding` and `approveRun`; this
 * module only reads the request read-only and submits a detached signature
 * under the same lock-then-writer sequence the guided CLI uses. It holds no
 * approval policy of its own and never sees a private key.
 */

export type ApprovalRequestResult =
  | {
      outcome: "ok";
      expiresAt: string;
      payload: string;
      specPath: string;
      specText: string;
      specHash: string;
      featureId: string;
      risk: string;
      scope: string[];
      signer: {
        /** The fingerprint frozen at intake; null when none was configured then. */
        frozen: string | null;
        configured: string | null;
        publicKeyPath: string | null;
        reason: string | null;
      };
    }
  | { outcome: "refused"; reason: string };

export type ApprovalSubmitResult =
  | { outcome: "approved"; approvalId: number; stageId: number }
  | { outcome: "refused"; reason: string }
  | { outcome: "writer_busy"; reason: string };

function refusal(error: unknown): { outcome: "refused"; reason: string } {
  if (error instanceof TargetUnavailableError || error instanceof StoreStateError) {
    return { outcome: "refused", reason: error.message };
  }
  throw error;
}

/** The canonical payload, the reviewed spec it binds, and the non-secret key facts. */
export function readApprovalRequest(
  target: string,
  invocationDirectory: string,
  runId: number,
  now: number = Date.now(),
): ApprovalRequestResult {
  let store: Store | null = null;
  try {
    const root = resolveRepositoryRoot(target, invocationDirectory);
    store = openStore(root, { readOnly: true });
    const expiresAt = new Date(now + APPROVAL_DEFAULT_LIFETIME_SECONDS * 1000).toISOString();
    const bound = buildBinding(store, root, runId, expiresAt);
    if (!bound.ok) return { outcome: "refused", reason: bound.reason };
    let specText: string;
    try {
      specText = readFileSync(resolve(root, bound.specPath), "utf8");
    } catch (error) {
      return { outcome: "refused", reason: `cannot read the reviewed spec ${bound.specPath}: ${(error as Error).message}` };
    }
    // buildBinding hashed its own read. A spec edited between the two reads
    // would show the operator text other than what the payload binds.
    if (sha256Hex(normalizeText(specText)) !== bound.binding.specHash) {
      return { outcome: "refused", reason: "the spec changed while it was being read; reload to review the current version" };
    }
    const key = loadPublicKey(root);
    return {
      outcome: "ok",
      expiresAt,
      payload: approvalPayload(bound.binding),
      specPath: bound.specPath,
      specText,
      specHash: bound.binding.specHash,
      featureId: bound.binding.featureId,
      risk: bound.binding.risk,
      scope: bound.binding.scope,
      signer: {
        frozen: bound.approvalSigner,
        configured: key.ok ? key.signer : null,
        publicKeyPath: key.ok ? key.path : null,
        reason: key.ok ? null : key.reason,
      },
    };
  } catch (error) {
    return refusal(error);
  } finally {
    store?.close();
  }
}

/**
 * Records an approval exactly as the guided CLI does: repository lock, an
 * exact-current schema check that can never migrate, the writer, then
 * `approveRun`. A held lock refuses before any state is opened.
 */
export function submitApproval(
  target: string,
  invocationDirectory: string,
  input: { runId: number; expiresAt: string; signature: string },
): ApprovalSubmitResult {
  let root: string;
  try {
    root = resolveRepositoryRoot(target, invocationDirectory);
  } catch (error) {
    return refusal(error);
  }
  let release: (() => void) | null = null;
  try {
    release = acquireLock(root);
  } catch (error) {
    return { outcome: "writer_busy", reason: error instanceof Error ? error.message : String(error) };
  }
  let store: Store | null = null;
  try {
    openStore(root, { readOnly: true }).close();
    store = openStore(root);
    const result = approveRun(store, root, input);
    return result.ok
      ? { outcome: "approved", approvalId: result.approvalId, stageId: result.stageId }
      : { outcome: "refused", reason: result.reason };
  } catch (error) {
    return refusal(error);
  } finally {
    store?.close();
    release();
  }
}
