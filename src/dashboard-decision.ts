import { acquireLock } from "./lock.ts";
import { resolveRepositoryRoot, TargetUnavailableError } from "./repo-root.ts";
import { answerQuestion } from "./spec-decision-stage.ts";
import { openStore, StoreStateError, type Store } from "./store.ts";

/**
 * The dashboard's second write (architecture section 23, spec-operator-decisions):
 * one operator answer to one spec_review question. Every rule belongs to
 * `answerQuestion`, the same core `bw decide` calls; this module only
 * reproduces the lock-then-writer sequence `submitApproval` uses.
 */

export type DecisionSubmitResult =
  | { outcome: "answered"; answerId: number; action: string; open: number }
  | { outcome: "refused"; reason: string }
  | { outcome: "writer_busy"; reason: string };

function refusal(error: unknown): { outcome: "refused"; reason: string } {
  if (error instanceof TargetUnavailableError || error instanceof StoreStateError) {
    return { outcome: "refused", reason: error.message };
  }
  throw error;
}

/**
 * Records one answer exactly as `bw decide` does: repository lock, an
 * exact-current schema check that can never migrate, the writer, then
 * `answerQuestion`. A held lock refuses before any state is opened.
 */
export function submitDecisionAnswer(
  target: string,
  invocationDirectory: string,
  input: { runId: number; findingId: number; action: string; answer?: string },
): DecisionSubmitResult {
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
    const result = answerQuestion(store, input);
    return result.ok
      ? { outcome: "answered", answerId: result.answerId, action: result.action, open: result.open }
      : { outcome: "refused", reason: result.reason };
  } catch (error) {
    return refusal(error);
  } finally {
    store?.close();
    release();
  }
}
