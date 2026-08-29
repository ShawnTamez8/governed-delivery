#!/usr/bin/env node
import { acquireLock } from "./lock.ts";
import { CHANGE_KINDS, GATE_RESULTS, openStore, type Store } from "./store.ts";
import { appendAudit, verifyAuditChain } from "./audit.ts";

const USAGE = `usage: bw <command>
commands:
  migrate                                apply pending migrations
  new-run --project <p> --feature <f> --slug <s> --change-kind <k>
  stage-add --run <id> --kind <k> [--input <stage-id>]
  stage-complete --id <id> --output <ref> --gate-result pass|block
  verify-audit                           recompute the audit chain`;

class UsageError extends Error {}

function parse(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        args.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          // The value is missing; record it as empty so required() reports
          // the named option instead of silently consuming the next flag.
          args.set(arg.slice(2), "");
        } else {
          args.set(arg.slice(2), next);
          i++;
        }
      }
    }
  }
  return args;
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (value === undefined || value === "") {
    throw new UsageError(`missing required option --${name}`);
  }
  return value;
}

function numeric(args: Map<string, string>, name: string): number {
  const value = required(args, name);
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`--${name} must be a non-negative integer, got ${value}`);
  }
  return Number(value);
}

function numericOptional(args: Map<string, string>, name: string): number | null {
  const value = args.get(name);
  if (value === undefined || value === "") return null;
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`--${name} must be a non-negative integer, got ${value}`);
  }
  return Number(value);
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "";
  const known = ["migrate", "new-run", "stage-add", "stage-complete", "verify-audit"];
  if (!known.includes(command)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const args = parse(argv.slice(1));
  let release: (() => void) | null = null;
  let store: Store | null = null;
  try {
    release = acquireLock();
    store = openStore();
    switch (command) {
      case "migrate": {
        console.log("migrations applied");
        break;
      }
      case "new-run": {
        const changeKind = required(args, "change-kind");
        if (!CHANGE_KINDS.includes(changeKind)) {
          throw new UsageError(
            `invalid change_kind ${changeKind}: allowed values are ${CHANGE_KINDS.join(", ")}`
          );
        }
        const run = store.insertRun(
          required(args, "project"),
          required(args, "feature"),
          required(args, "slug"),
          changeKind
        );
        appendAudit(store, {
          runId: run.id,
          stageId: null,
          actor: "system",
          actorType: "cli",
          action: "run.create",
          summary: `created run ${run.id} for ${run.slug}`,
        });
        console.log(String(run.id));
        break;
      }
      case "stage-add": {
        const stage = store.insertStage(
          numeric(args, "run"),
          required(args, "kind"),
          numericOptional(args, "input")
        );
        appendAudit(store, {
          runId: stage.run_id,
          stageId: stage.id,
          actor: "system",
          actorType: "cli",
          action: "stage.add",
          summary: `added stage ${stage.id} (${stage.kind})`,
        });
        console.log(String(stage.id));
        break;
      }
      case "stage-complete": {
        const gateResult = required(args, "gate-result");
        if (!GATE_RESULTS.includes(gateResult)) {
          throw new UsageError(
            `invalid gate_result ${gateResult}: allowed values are ${GATE_RESULTS.join(", ")}`
          );
        }
        const stage = store.completeStage(numeric(args, "id"), required(args, "output"), gateResult);
        appendAudit(store, {
          runId: stage.run_id,
          stageId: stage.id,
          actor: "system",
          actorType: "cli",
          action: "stage.complete",
          summary: `completed stage ${stage.id} with gate_result ${gateResult}`,
        });
        console.log(String(stage.id));
        break;
      }
      case "verify-audit": {
        const brk = verifyAuditChain(store);
        if (brk) {
          console.error(`broken at audit ${brk.id}: stored ${brk.stored} recomputed ${brk.recomputed}`);
          process.exitCode = 1;
          break;
        }
        console.log("chain valid");
        break;
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = err instanceof UsageError ? 2 : 1;
  } finally {
    store?.close();
    release?.();
  }
}

main();
