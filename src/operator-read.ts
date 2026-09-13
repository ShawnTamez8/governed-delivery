import { operatorEnvelope, type OperatorCommand, type OperatorResult } from "./operator-output.ts";
import { listRuns, readRunSnapshot, RunMissingError } from "./operator-state.ts";
import { resolveRepositoryRoot, TargetUnavailableError } from "./repo-root.ts";
import { openStore, StoreStateError, type Store } from "./store.ts";

function readRefusal(
  command: Extract<OperatorCommand, "runs" | "status">,
  repository: string | null,
  runId: number | null,
  error: TargetUnavailableError | StoreStateError | RunMissingError,
): OperatorResult {
  const errorCode = error instanceof TargetUnavailableError ? "target_unavailable" : error.code;
  const outcome = errorCode === "state_missing" || errorCode === "run_missing" ? errorCode : "error";
  return operatorEnvelope(command, repository, runId, outcome, null, errorCode, error.message);
}

export function readRunsResult(
  target: string,
  invocationDirectory: string,
  limit: number,
): OperatorResult {
  let repository: string | null = null;
  let store: Store | null = null;
  try {
    repository = resolveRepositoryRoot(target, invocationDirectory);
    store = openStore(repository, { readOnly: true });
    return operatorEnvelope("runs", repository, null, "ok", listRuns(store, limit));
  } catch (error) {
    if (error instanceof TargetUnavailableError || error instanceof StoreStateError) {
      return readRefusal("runs", repository, null, error);
    }
    throw error;
  } finally {
    store?.close();
  }
}

export function readStatusResult(
  target: string,
  invocationDirectory: string,
  runId: number,
): OperatorResult {
  let repository: string | null = null;
  let store: Store | null = null;
  try {
    repository = resolveRepositoryRoot(target, invocationDirectory);
    store = openStore(repository, { readOnly: true });
    return operatorEnvelope("status", repository, runId, "ok", readRunSnapshot(store, repository, runId).snapshot);
  } catch (error) {
    if (error instanceof TargetUnavailableError || error instanceof StoreStateError || error instanceof RunMissingError) {
      return readRefusal("status", repository, runId, error);
    }
    throw error;
  } finally {
    store?.close();
  }
}
