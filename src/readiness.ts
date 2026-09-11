import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS } from "./agents.ts";
import { loadPublicKey } from "./approval.ts";
import { CLAUDE_CODE } from "./executor.ts";
import { loadGovernedConfigAtCommit, type VerificationConfig } from "./governed-config.ts";
import { probeExecutor } from "./harness.ts";
import { GOVERNANCE_PREFIX } from "./paths.ts";
import { buildPolicy, invalidPolicyReason, policyHash, SYSTEM_NAME, type Policy } from "./policy.ts";
import { requiredCapability, resolveStartingCommit } from "./profile.ts";
import { codeReviewStaffingShortfall, staffingShortfall } from "./select.ts";
import { validateRunIdentity } from "./store.ts";

export interface ReadinessCheck {
  name: string;
  status: "pass" | "fail" | "not_checked";
  evidence: string;
  repair: string | null;
}

export interface IntakeRepositoryResult {
  ok: boolean;
  reason: string | null;
  startingCommit: string | null;
  verification: VerificationConfig | null;
  checks: ReadinessCheck[];
}

function git(rootDir: string, ...args: string[]) {
  return spawnSync("git", ["--no-optional-locks", ...args], {
    cwd: rootDir, encoding: "utf8", shell: false,
  });
}

export function checkIntakeRepository(rootDir: string): IntakeRepositoryResult {
  const checks: ReadinessCheck[] = [];
  const startingCommit = resolveStartingCommit(rootDir);
  if (startingCommit === null) {
    const reason = "not a git repository (or HEAD cannot be read): a run needs a starting commit to verify against";
    checks.push({ name: "head", status: "fail", evidence: reason, repair: "Initialize a local Git worktree and commit the intended starting state." });
    for (const name of ["working_tree", "verification_config"]) {
      checks.push({ name, status: "not_checked", evidence: "No readable HEAD is available.", repair: null });
    }
    return { ok: false, reason, startingCommit, verification: null, checks };
  }
  checks.push({ name: "head", status: "pass", evidence: startingCommit, repair: null });
  const status = git(rootDir, "status", "--porcelain");
  let reason: string | null = null;
  if (status.status !== 0) {
    reason = `cannot read the working tree state: ${(status.stderr ?? "").trim()}`;
  } else {
    // Keep new-run's governance exclusion: its writer may already have created state.
    const dirty = (status.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "")
      .filter((line) => {
        const entry = /^..\s+"?(.*)$/.exec(line);
        return entry === null || !entry[1].startsWith(GOVERNANCE_PREFIX);
      });
    if (dirty.length > 0) {
      reason = `the working tree is not clean: a run starts from a committed state (section 7). ${dirty.length} path(s), first: ${dirty.slice(0, 3).join(", ")}`;
    }
  }
  checks.push({ name: "working_tree", status: reason === null ? "pass" : "fail",
    evidence: reason ?? "The working tree is clean, excluding machine-local governance state.",
    repair: reason === null ? null : "Commit or set aside operator changes before creating a new run." });
  const configuration = loadGovernedConfigAtCommit(rootDir, startingCommit);
  checks.push({ name: "verification_config", status: configuration.ok ? "pass" : "fail",
    evidence: configuration.ok ? `Loaded ${configuration.config.commands.length} verification command(s) from ${startingCommit}.` : configuration.reason,
    repair: configuration.ok ? null : "Commit a valid governed.yaml verification configuration before creating a run." });
  if (!configuration.ok) reason ??= configuration.reason;
  return { ok: reason === null, reason, startingCommit,
    verification: configuration.ok ? configuration.config : null, checks };
}

export interface CurrentReadiness {
  systemName: string;
  nodeVersion: string;
  minimumNodeMajor: number | null;
  gitVersion: string | null;
  startingCommit: string | null;
  verification: VerificationConfig | null;
  policy: Policy;
  policyHash: string;
  agentIds: string[];
  executor: { id: string; command: string[]; probe: string[]; capabilities: string[] };
  approvalSigner: string | null;
}

export interface ReadinessResult {
  checks: ReadinessCheck[];
  current: CurrentReadiness;
  limitations: string[];
}

export function inspectReadiness(rootDir: string, options: { slug?: string } = {}): ReadinessResult {
  const checks: ReadinessCheck[] = [];
  let minimumNodeMajor: number | null = null;
  try {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { engines: { node: string } };
    const minimum = /^>=(\d+)$/.exec(manifest.engines.node);
    if (!minimum) throw new Error(`cannot derive the Node minimum from package.json engines.node ${manifest.engines.node}`);
    minimumNodeMajor = Number(minimum[1]);
    const supported = Number(process.versions.node.split(".")[0]) >= minimumNodeMajor;
    checks.push({ name: "node", status: supported ? "pass" : "fail",
      evidence: `Node ${process.versions.node}; checkout requires ${manifest.engines.node}.`,
      repair: supported ? null : `Use Node ${minimumNodeMajor} or newer for this checkout.` });
  } catch (error) {
    checks.push({ name: "node", status: "fail", evidence: (error as Error).message, repair: "Use a checkout with a readable Node engine requirement." });
  }
  const version = git(rootDir, "--version");
  const gitVersion = version.status === 0 ? version.stdout.trim() : null;
  checks.push({ name: "git", status: gitVersion === null ? "fail" : "pass",
    evidence: gitVersion ?? version.error?.message ?? version.stderr.trim(),
    repair: gitVersion === null ? "Install Git and make it resolvable in this invocation's PATH." : null });
  const intake = checkIntakeRepository(rootDir);
  checks.push(...intake.checks);
  const ignored = git(rootDir, "check-ignore", "--no-index", "--quiet", "--", GOVERNANCE_PREFIX);
  checks.push({ name: "governance_ignore", status: ignored.status === 0 ? "pass" : "fail",
    evidence: ignored.status === 0 ? `${GOVERNANCE_PREFIX} is ignored by Git.`
      : ignored.error?.message ?? (ignored.stderr.trim() || `${GOVERNANCE_PREFIX} is not ignored by Git.`),
    repair: ignored.status === 0 ? null : `Commit a .gitignore rule for ${GOVERNANCE_PREFIX}` });

  const invalidSlug = options.slug === undefined ? null : validateRunIdentity({ slug: options.slug });
  if (options.slug === undefined || invalidSlug !== null) {
    checks.push({ name: "design_readable", status: invalidSlug === null ? "not_checked" : "fail",
      evidence: invalidSlug ?? "No --slug was selected; feature readiness was not checked.",
      repair: invalidSlug === null ? null : "Choose a valid lowercase kebab-case slug." });
    checks.push({ name: "design_committed", status: "not_checked",
      evidence: "No valid feature was selected.", repair: null });
  } else {
    const ref = `docs/features/${options.slug}/design.md`;
    const path = join(rootDir, "docs", "features", options.slug, "design.md");
    try {
      readFileSync(path, "utf8");
      checks.push({ name: "design_readable", status: "pass", evidence: path, repair: null });
    } catch (error) {
      checks.push({ name: "design_readable", status: "fail",
        evidence: `cannot read design document ${path}: ${(error as Error).message}`,
        repair: `Author and commit ${ref} before running the specification stage.` });
    }
    if (intake.startingCommit === null) {
      checks.push({ name: "design_committed", status: "not_checked", evidence: "No readable HEAD is available.", repair: null });
    } else {
      const committed = git(rootDir, "cat-file", "-e", `${intake.startingCommit}:${ref}`);
      checks.push({ name: "design_committed", status: committed.status === 0 ? "pass" : "fail",
        evidence: committed.status === 0 ? `${ref} is present at ${intake.startingCommit}.`
          : committed.error?.message ?? (committed.stderr.trim() || `${ref} is not present at HEAD.`),
        repair: committed.status === 0 ? null : `Commit ${ref} in the selected repository.` });
    }
  }

  const policy = buildPolicy();
  const policyError = invalidPolicyReason(policy);
  checks.push({ name: "policy", status: policyError === null ? "pass" : "fail",
    evidence: policyError ?? `Current policy ${policyHash(policy)} validates.`,
    repair: policyError === null ? null : "Correct the checkout's operator-owned policy configuration." });
  const staffing = [
    ["document_review_staffing", policyError === null
      ? staffingShortfall(AGENTS, policy.panelSizeMax, policy.requiredSpecialties, [], CLAUDE_CODE.id) : policyError],
    ["code_review_staffing", policyError === null
      ? codeReviewStaffingShortfall(AGENTS, policy.codeReviewPanelSize, CLAUDE_CODE.id) : policyError],
  ];
  for (const [name, error] of staffing) {
    checks.push({ name: name!, status: policyError !== null ? "not_checked" : error === null ? "pass" : "fail",
      evidence: error ?? "The current registered specialist reviewers can staff the configured panel.",
      repair: policyError !== null ? "Correct the current policy before checking panel staffing."
        : error === null ? null : "Register enough distinct specialists for the configured panel; do not silently shrink it." });
  }
  const authorErrors: string[] = [];
  for (const [id, outputs] of [
    ["spec-author", ["spec", "spec-self-critique", "spec-reconciliation"]],
    ["plan-author", ["plan", "plan-self-critique", "plan-reconciliation"]],
    ["implementer", ["patches"]],
  ] as const) {
    const author = AGENTS.find((agent) => agent.id === id);
    if (!author) authorErrors.push(`configured agent ${id} is missing`);
    else if (author.executor !== CLAUDE_CODE.id) authorErrors.push(`agent ${id} is bound to executor ${author.executor}, not ${CLAUDE_CODE.id}`);
    else {
      for (const output of outputs) {
        if (!author.outputs.includes(output)) authorErrors.push(`configured agent ${id} does not allow ${output} output`);
      }
    }
  }
  checks.push({ name: "author_bindings", status: authorErrors.length === 0 ? "pass" : "fail",
    evidence: authorErrors.length === 0 ? "The named authors provide every output their existing stages require." : authorErrors.join("; "),
    repair: authorErrors.length === 0 ? null : "Restore the named author definitions and their stage-required outputs on the current executor." });
  const required = [...new Set(["spec", "plan", "implementation", "code_review"].map(requiredCapability))];
  const missing = required.filter((capability) => capability !== null && !CLAUDE_CODE.capabilities.includes(capability));
  checks.push({ name: "executor_capabilities", status: missing.length === 0 ? "pass" : "fail",
    evidence: missing.length === 0 ? `Executor ${CLAUDE_CODE.id} provides ${required.join(", ")}.`
      : `Executor ${CLAUDE_CODE.id} lacks required capabilities: ${missing.join(", ")}.`,
    repair: missing.length === 0 ? null : "Use the current native executor definition with all required stage capabilities." });
  const key = loadPublicKey(rootDir);
  checks.push({ name: "approval_key", status: key.ok ? "pass" : "fail",
    evidence: key.ok ? `Approval signer fingerprint ${key.signer}.` : key.reason,
    repair: key.ok ? null : "Configure an external PEM Ed25519 public key with BW_APPROVAL_PUBLIC_KEY using the separate operator setup workflow." });
  try {
    const probe = probeExecutor(CLAUDE_CODE, { timeoutMs: 5000 });
    checks.push({ name: "executor_probe", status: "pass",
      evidence: `${CLAUDE_CODE.probe.join(" ")}: ${[probe.stdout.trim(), probe.stderr.trim()].filter(Boolean).join("; ")}`,
      repair: null });
  } catch (error) {
    checks.push({ name: "executor_probe", status: "fail", evidence: (error as Error).message,
      repair: "Install the native Claude Code executable and make its version probe available on PATH." });
  }
  return {
    checks,
    current: {
      systemName: SYSTEM_NAME, nodeVersion: process.versions.node, minimumNodeMajor, gitVersion,
      startingCommit: intake.startingCommit, verification: intake.verification,
      policy, policyHash: policyHash(policy), agentIds: AGENTS.map((agent) => agent.id),
      executor: { id: CLAUDE_CODE.id, command: [...CLAUDE_CODE.command], probe: [...CLAUDE_CODE.probe], capabilities: [...CLAUDE_CODE.capabilities] },
      approvalSigner: key.ok ? key.signer : null,
    },
    limitations: ["Provider account authentication, model entitlement, and quota are not checked by the local version probe."],
  };
}
