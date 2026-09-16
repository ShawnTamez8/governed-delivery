import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { appendAudit } from "./audit.ts";
import { approvalPayload, loadPublicKey, validateExpiry } from "./approval.ts";
import { approveRun, buildBinding } from "./approval-stage.ts";
import { acquireLock } from "./lock.ts";
import { readRunSnapshot, type RunSnapshot } from "./operator-state.ts";
import { formatGuidedApproval, formatGuidedTerminal } from "./operator-output.ts";
import { approvalHandoffDir, stateDbPath } from "./paths.ts";
import { APPROVAL_DEFAULT_LIFETIME_SECONDS, APPROVAL_MAX_LIFETIME_SECONDS } from "./policy.ts";
import { prepareGuidedProject, type GuidedPrompt } from "./project-bootstrap.ts";
import { inspectReadiness } from "./readiness.ts";
import { resolveRepositoryRoot } from "./repo-root.ts";
import { createRunIntake, RunIntakeFreezeError } from "./run-intake.ts";
import { advanceRun } from "./run-command.ts";
import { validateModelName } from "./profile.ts";
import { isPathInside } from "./scope.ts";
import { openStore, validateRunIdentity, type ChangeKind, type RunRow } from "./store.ts";

export class GuidedCommandError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "GuidedCommandError";
    this.exitCode = exitCode;
  }
}

export interface GuidedCommandOptions {
  invocationDirectory?: string;
  input?: Readable & { readonly isTTY?: boolean };
  stdout?: Writable;
  stderr?: Writable;
  prompt?: GuidedPrompt;
}

interface RunIdentity {
  project: string;
  featureId: string;
  slug: string;
  changeKind: ChangeKind;
}

function identityKey(identity: RunIdentity): string {
  return JSON.stringify([identity.project, identity.featureId, identity.slug, identity.changeKind]);
}

function identityOf(run: RunRow): RunIdentity {
  return {
    project: run.project,
    featureId: run.feature_id,
    slug: run.slug,
    changeKind: run.change_kind,
  };
}

function displayIdentity(identity: RunIdentity): string {
  return `${identity.project} | ${identity.featureId} | ${identity.slug} | ${identity.changeKind}`;
}

async function promptValue(
  prompt: GuidedPrompt,
  message: string,
  validate: (value: string) => string | null,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = (await prompt(message)).trim();
    const reason = value === "" ? "a non-empty response is required" : validate(value);
    if (reason === null) return value;
  }
  throw new GuidedCommandError(`no valid response was provided for ${message.trim()}`);
}

async function choose(
  prompt: GuidedPrompt,
  heading: string,
  values: readonly string[],
): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = (await prompt(`${heading}\n${values.map((value, index) => `  ${index + 1}. ${value}`).join("\n")}\nSelection (1-${values.length}): `)).trim();
    if (/^\d+$/.test(answer)) {
      const index = Number(answer) - 1;
      if (index >= 0 && index < values.length) return index;
    }
  }
  throw new GuidedCommandError("no displayed value was selected");
}

function readRuns(rootDir: string, slug: string): RunRow[] {
  if (!existsSync(stateDbPath(rootDir))) return [];
  const store = openStore(rootDir, { readOnly: true });
  try {
    return store.query<RunRow>("SELECT * FROM run WHERE slug = ? ORDER BY id", [slug]);
  } finally {
    store.close();
  }
}

async function selectIdentity(
  rootDir: string,
  slug: string,
  prompt: GuidedPrompt,
  stdout: Writable,
): Promise<{ identity: RunIdentity; model: string | null; runs: RunRow[] }> {
  const runs = readRuns(rootDir, slug);
  const tuples = new Map<string, RunIdentity>();
  for (const run of runs) tuples.set(identityKey(identityOf(run)), identityOf(run));
  const identities = [...tuples.values()];
  if (identities.length === 1) {
    stdout.write(`Step 2: Reusing run identity ${displayIdentity(identities[0]!)}\n`);
    return { identity: identities[0]!, model: null, runs };
  }
  if (identities.length > 1) {
    const selected = await choose(prompt, "Step 2: Select an existing run identity:", identities.map(displayIdentity));
    const identity = identities[selected]!;
    stdout.write(`Selected run identity ${displayIdentity(identity)}\n`);
    return { identity, model: null, runs: runs.filter((run) => identityKey(identityOf(run)) === identityKey(identity)) };
  }

  const projectDefault = basename(rootDir);
  const project = await promptValue(
    prompt,
    `Project [suggested ${projectDefault}; enter a value explicitly]: `,
    (value) => /[\u0000-\u001f\u007f]/.test(value) ? "project cannot contain control characters" : null,
  );
  const featureId = await promptValue(
    prompt,
    `Feature ID [suggested ${slug}; enter a value explicitly]: `,
    (value) => validateRunIdentity({ featureId: value }),
  );
  const changeKind = await promptValue(
    prompt,
    "Change kind [suggested feature; enter feature or defect_fix explicitly]: ",
    (value) => validateRunIdentity({ changeKind: value }),
  ) as ChangeKind;
  const model = await promptValue(
    prompt,
    "Model [suggested sonnet; enter a value explicitly]: ",
    validateModelName,
  );
  const identity = { project, featureId, slug, changeKind };
  const invalid = validateRunIdentity(identity);
  if (invalid !== null) throw new GuidedCommandError(invalid);
  stdout.write(`Step 2: New run identity ${displayIdentity(identity)}\n`);
  return { identity, model, runs: [] };
}

function matchingRuns(runs: readonly RunRow[], identity: RunIdentity): RunRow[] {
  const key = identityKey(identity);
  return runs.filter((run) => identityKey(identityOf(run)) === key);
}

function strictText(path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch (error) {
    throw new GuidedCommandError(
      `cannot read approval payload ${path} as UTF-8: ${error instanceof Error ? error.message : String(error)}`,
      3,
    );
  }
}

function strictSignature(path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch (error) {
    throw new GuidedCommandError(
      `cannot read detached signature ${path} as UTF-8: ${error instanceof Error ? error.message : String(error)}`,
      3,
    );
  }
}

function parsePayloadExpiry(payload: string): string {
  const matches = payload.split("\n").filter((line) => line.startsWith("expiresAt: "));
  if (matches.length !== 1) throw new GuidedCommandError("the retained approval payload has no unique expiry", 3);
  return matches[0]!.slice("expiresAt: ".length);
}

function rotateExpiredHandoffDirectory(
  directory: string,
  expiresAt: string,
  canonicalPayload: string,
): string {
  const suffix = expiresAt.replace(/[^0-9]/g, "");
  const provisional = `${directory}.rotating-expired-${suffix}`;
  const archive = `${directory}.expired-${suffix}`;
  if (existsSync(provisional) || existsSync(archive)) {
    throw new GuidedCommandError(`refusing to replace an existing expired approval handoff for ${expiresAt}`, 3);
  }
  try {
    renameSync(directory, provisional);
    const movedPayload = strictText(join(provisional, "payload.txt"));
    if (movedPayload !== canonicalPayload) {
      throw new GuidedCommandError("the expired approval payload changed before archival", 3);
    }
    renameSync(provisional, archive);
    return archive;
  } catch (error) {
    if (existsSync(provisional) && !existsSync(directory)) {
      try {
        renameSync(provisional, directory);
      } catch (restoreError) {
        throw new GuidedCommandError(
          `cannot restore expired approval handoff after validation failure: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
          3,
        );
      }
    }
    if (error instanceof GuidedCommandError) throw error;
    throw new GuidedCommandError(
      `cannot rotate expired approval handoff ${directory}: ${error instanceof Error ? error.message : String(error)}`,
      3,
    );
  }
}

function snapshot(rootDir: string, runId: number): RunSnapshot {
  const store = openStore(rootDir, { readOnly: true });
  try {
    return readRunSnapshot(store, rootDir, runId).snapshot;
  } finally {
    store.close();
  }
}

async function approvalHandoff(
  rootDir: string,
  runId: number,
  prompt: GuidedPrompt,
  stdout: Writable,
): Promise<"paused" | "approved"> {
  const directory = approvalHandoffDir(rootDir, runId);
  const payloadPath = join(directory, "payload.txt");
  const signaturePath = join(directory, "signature.txt");
  if (!isPathInside(rootDir, payloadPath) || !isPathInside(rootDir, signaturePath)) {
    throw new GuidedCommandError(`approval handoff paths must remain inside ${rootDir}`);
  }
  let payload: string | null = existsSync(payloadPath) ? strictText(payloadPath) : null;
  let expiresAt = payload === null ? null : parsePayloadExpiry(payload);
  const reader = openStore(rootDir, { readOnly: true });
  let bound;
  let key;
  try {
    key = loadPublicKey(rootDir);
    if (!key.ok) throw new GuidedCommandError(key.reason);
    if (payload !== null && expiresAt !== null) {
      const retainedBound = buildBinding(reader, rootDir, runId, expiresAt);
      if (!retainedBound.ok) throw new GuidedCommandError(retainedBound.reason, 3);
      if (retainedBound.approvalSigner === null || retainedBound.approvalSigner !== key.signer) {
        throw new GuidedCommandError(
          retainedBound.approvalSigner === null
            ? `run ${runId} has no external approval signer bound at intake`
            : `approval signer ${key.signer} is not the signer frozen at run start (${retainedBound.approvalSigner})`,
        );
      }
      if (approvalPayload(retainedBound.binding) !== payload) {
        throw new GuidedCommandError(
          "the retained approval payload does not exactly match the current binding and expiry",
          3,
        );
      }
      const expiry = validateExpiry(expiresAt, Date.now(), APPROVAL_MAX_LIFETIME_SECONDS);
      if (!expiry.ok) {
        if (!expiry.reason.startsWith("approval expired at ")) {
          throw new GuidedCommandError(`the retained approval payload expiry is invalid: ${expiry.reason}`, 3);
        }
        const archive = rotateExpiredHandoffDirectory(directory, expiresAt, payload);
        stdout.write(`Archived expired approval handoff at ${archive}; creating fresh canonical bytes.\n`);
        payload = null;
        expiresAt = null;
      }
    }
    expiresAt ??= new Date(Date.now() + APPROVAL_DEFAULT_LIFETIME_SECONDS * 1000).toISOString();
    bound = buildBinding(reader, rootDir, runId, expiresAt);
    if (!bound.ok) throw new GuidedCommandError(bound.reason);
    if (bound.approvalSigner === null || bound.approvalSigner !== key.signer) {
      throw new GuidedCommandError(
        bound.approvalSigner === null
          ? `run ${runId} has no external approval signer bound at intake`
          : `approval signer ${key.signer} is not the signer frozen at run start (${bound.approvalSigner})`,
      );
    }
    const canonical = approvalPayload(bound.binding);
    if (payload === null) {
      mkdirSync(directory, { recursive: true });
      try {
        writeFileSync(payloadPath, canonical, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        throw new GuidedCommandError(`cannot exclusively create ${payloadPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      payload = canonical;
    } else if (payload !== canonical) {
      throw new GuidedCommandError(
        "the retained approval payload does not exactly match the current binding and expiry",
        3,
      );
    }
    stdout.write(formatGuidedApproval(runId, bound.specPath, bound.binding, key.signer, payloadPath, signaturePath));
  } finally {
    reader.close();
  }
  while (!existsSync(signaturePath)) {
    stdout.write(
      "\nApproval options:\n" +
      "  1. Approve - Verify detached signature.txt and proceed\n" +
      "  2. Modify  - Guidance on updating requirements in design.md\n" +
      "  3. Reject  - Reject specification and record operator refusal\n" +
      "  4. Exit    - Leave run paused to review or sign later\n\n",
    );
    const choice = (await prompt("Action (1-4) [default 4]: ")).trim().toLowerCase();
    if (choice === "" || choice === "4" || choice === "exit") {
      stdout.write(`Run ${runId} remains paused awaiting external approval.\n`);
      return "paused";
    }
    if (choice === "1" || choice === "approve") {
      if (!existsSync(signaturePath)) {
        stdout.write(
          `\nDetached signature not found at ${signaturePath}\n` +
          `Have the external approval authority review the binding and write signature.txt, then select option 1 again or rerun buildworks.\n`,
        );
      }
    } else if (choice === "2" || choice === "modify" || choice === "feedback") {
      const designPath = join(dirname(bound.specPath), "design.md");
      stdout.write(
        `\nIn BuildWorks, specifications are generated from your design document.\n` +
        `To modify requirements or provide feedback:\n` +
        `  1. Edit ${designPath} with your changes or feedback.\n` +
        `  2. Re-run buildworks to start a fresh run with your updated design.\n\n`,
      );
      return "paused";
    } else if (choice === "3" || choice === "reject") {
      const confirm = (await prompt(`Reject approval for run ${runId}? Type yes to confirm: `)).trim().toLowerCase();
      if (confirm === "yes") {
        let releaseLock: (() => void) | null = null;
        let rejectStore: ReturnType<typeof openStore> | null = null;
        try {
          releaseLock = acquireLock(rootDir);
          rejectStore = openStore(rootDir);
          appendAudit(rejectStore, {
            runId,
            stageId: null,
            actor: "operator",
            actorType: "human",
            action: "approval.refused",
            summary: "approval rejected by operator at Step 4",
          });
        } finally {
          rejectStore?.close();
          releaseLock?.();
        }
        stdout.write(`Approval rejected for run ${runId}. The run remains paused at the approval boundary.\n`);
      } else {
        stdout.write("Rejection cancelled.\n");
      }
      return "paused";
    } else {
      stdout.write("Invalid selection. Please choose 1, 2, 3, or 4.\n");
    }
  }
  const signature = strictSignature(signaturePath).replace(/^\uFEFF/, "").trim();
  if (signature === "") throw new GuidedCommandError(`detached signature is empty: ${signaturePath}`, 3);
  if ((await prompt("Submit this detached signature for the displayed binding? Type yes to confirm: ")).trim().toLowerCase() !== "yes") {
    throw new GuidedCommandError("approval submission was declined, cancelled, or ended without yes", 3);
  }

  let release: (() => void) | null = null;
  let store = null as ReturnType<typeof openStore> | null;
  try {
    release = acquireLock(rootDir);
    const schema = openStore(rootDir, { readOnly: true });
    schema.close();
    store = openStore(rootDir);
    const recomputed = buildBinding(store, rootDir, runId, expiresAt);
    if (!recomputed.ok) throw new GuidedCommandError(recomputed.reason, 3);
    const retained = strictText(payloadPath);
    if (retained !== payload || approvalPayload(recomputed.binding) !== retained) {
      throw new GuidedCommandError("the approval binding changed after confirmation; no approval was recorded", 3);
    }
    const retainedSignature = strictSignature(signaturePath).replace(/^\uFEFF/, "").trim();
    if (retainedSignature !== signature) {
      throw new GuidedCommandError("the detached signature changed after confirmation; no approval was recorded", 3);
    }
    const approved = approveRun(store, rootDir, { runId, expiresAt, signature: retainedSignature });
    if (!approved.ok) throw new GuidedCommandError(approved.reason, 3);
    stdout.write(`Approval recorded for run ${runId}.\n`);
    return "approved";
  } finally {
    store?.close();
    release?.();
  }
}

function terminalResult(rootDir: string, snapshotValue: RunSnapshot, stdout: Writable): number {
  stdout.write(formatGuidedTerminal(rootDir, snapshotValue));
  return snapshotValue.run.status === "completed" ? 0 : 1;
}

export async function runGuidedCommand(
  targetInput: string,
  options: GuidedCommandOptions = {},
): Promise<number> {
  const input = options.input ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  if (options.prompt === undefined && !input.isTTY) {
    throw new GuidedCommandError("guided mode requires interactive input; redirected input is refused before mutation or spend");
  }
  const interfaceReader = options.prompt === undefined
    ? createInterface({ input, output: stderr, terminal: true })
    : null;
  const prompt: GuidedPrompt = options.prompt ?? (async (message) => {
    try {
      return await interfaceReader!.question(message);
    } catch {
      return "";
    }
  });
  try {
    stdout.write("Step 1: Inspecting the selected project.\n");
    const prepared = await prepareGuidedProject(targetInput, {
      prompt,
      stdout,
      invocationDirectory: options.invocationDirectory,
    });
    if (prepared.waitingForDesign) return 0;
    const rootDir = resolveRepositoryRoot(prepared.rootDir, options.invocationDirectory ?? process.cwd());
    const selected = await selectIdentity(rootDir, prepared.slug, prompt, stdout);
    const candidates = matchingRuns(selected.runs, selected.identity);
    let runId: number;
    const nonterminal = candidates.filter((run) => run.status === "in_progress");
    const terminal = candidates.filter((run) => run.status !== "in_progress");
    if (nonterminal.length > 1) {
      throw new GuidedCommandError(`multiple nonterminal runs match ${displayIdentity(selected.identity)}: ${nonterminal.map((run) => run.id).join(", ")}`);
    }
    if (nonterminal.length === 1) {
      runId = nonterminal[0]!.id;
      stdout.write(`Step 3: Resuming run ${runId}.\n`);
    } else if (terminal.length === 1) {
      return terminalResult(rootDir, snapshot(rootDir, terminal[0]!.id), stdout);
    } else if (terminal.length > 1) {
      throw new GuidedCommandError(`multiple terminal runs match ${displayIdentity(selected.identity)}: ${terminal.map((run) => run.id).join(", ")}`);
    } else {
      const readiness = inspectReadiness(rootDir, { slug: prepared.slug });
      const failed = readiness.checks.filter((check) => check.status === "fail");
      if (failed.length > 0) {
        throw new GuidedCommandError(`guided intake is not ready: ${failed.map((check) => `${check.name}: ${check.evidence}`).join("; ")}`);
      }
      const key = loadPublicKey(rootDir);
      if (!key.ok) throw new GuidedCommandError(key.reason);
      let release: (() => void) | null = null;
      let store = null as ReturnType<typeof openStore> | null;
      let created = false;
      try {
        release = acquireLock(rootDir);
        store = openStore(rootDir);
        const lockedCandidates = store.query<RunRow>(
          "SELECT * FROM run WHERE project = ? AND feature_id = ? AND slug = ? AND change_kind = ? ORDER BY id",
          [selected.identity.project, selected.identity.featureId, selected.identity.slug, selected.identity.changeKind],
        );
        const lockedNonterminal = lockedCandidates.filter((run) => run.status === "in_progress");
        const lockedTerminal = lockedCandidates.filter((run) => run.status !== "in_progress");
        if (lockedNonterminal.length > 1) {
          throw new GuidedCommandError(`multiple nonterminal runs match ${displayIdentity(selected.identity)}: ${lockedNonterminal.map((run) => run.id).join(", ")}`);
        }
        if (lockedNonterminal.length === 1) {
          runId = lockedNonterminal[0]!.id;
        } else if (lockedTerminal.length === 1) {
          runId = lockedTerminal[0]!.id;
        } else if (lockedTerminal.length > 1) {
          throw new GuidedCommandError(`multiple terminal runs match ${displayIdentity(selected.identity)}: ${lockedTerminal.map((run) => run.id).join(", ")}`);
        } else {
          const intake = createRunIntake(store, rootDir, {
            ...selected.identity,
            model: selected.model!,
          }, { requireApprovalSigner: true });
          runId = intake.run.id;
          created = true;
        }
      } catch (error) {
        if (error instanceof RunIntakeFreezeError) {
          stderr.write(`run ${error.runId} created but blocked: profile freeze failed\n`);
        }
        throw error;
      } finally {
        store?.close();
        release?.();
      }
      stdout.write(`Step 3: ${created ? "Created" : "Resuming"} run ${runId}.\n`);
    }

    let observed = snapshot(rootDir, runId);
    if (observed.run.status !== "in_progress") return terminalResult(rootDir, observed, stdout);
    if (observed.workflowAction.group === "approval") {
      const approval = await approvalHandoff(rootDir, runId, prompt, stdout);
      if (approval === "paused") return 3;
      observed = snapshot(rootDir, runId);
    }
    const consent = async (preview: string): Promise<boolean> => {
      stdout.write(`Step 5: Paid execution consent for run ${runId}.\n${preview}`);
      return (await prompt("Execute every group in this preview? Type yes to consent: ")).trim().toLowerCase() === "yes";
    };
    const advanced = await advanceRun(rootDir, runId, { consent, stderr });
    if (advanced.reason !== null) stderr.write(`${advanced.reason}\n`);
    const result = advanced.result as { snapshot: RunSnapshot | null };
    if (advanced.outcome === "awaiting_approval") {
      const approval = await approvalHandoff(rootDir, runId, prompt, stdout);
      if (approval === "paused") return 3;
      const continued = await advanceRun(rootDir, runId, { consent, stderr });
      if (continued.reason !== null) stderr.write(`${continued.reason}\n`);
      const continuedResult = continued.result as { snapshot: RunSnapshot | null };
      if (continuedResult.snapshot !== null &&
          (continuedResult.snapshot.run.status !== "in_progress" || continuedResult.snapshot.phase === "completed")) {
        return terminalResult(rootDir, continuedResult.snapshot, stdout);
      }
      return 1;
    }
    if (result.snapshot !== null &&
        (result.snapshot.run.status !== "in_progress" || result.snapshot.phase === "completed")) {
      return terminalResult(rootDir, result.snapshot, stdout);
    }
    return advanced.outcome === "completed" ? 0 : 1;
  } finally {
    interfaceReader?.close();
  }
}
