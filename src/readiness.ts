import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS } from "./agents.ts";
import { loadPublicKey } from "./approval.ts";
import {
  dockerReady, findSandboxImage, imagePresent, missingImagePrograms, sandboxLeftovers, type FrozenSandbox,
} from "./container.ts";
import { CLAUDE_CODE } from "./executor.ts";
import {
  collectAmbientProviderConfig, DOCTOR_OBSERVATION_NAMES, resolveDoctorExecutable,
  type AmbientProviderConfig,
} from "./doctor-diagnostics.ts";
import { loadGovernedConfigAtCommit, type VerificationConfig } from "./governed-config.ts";
import { buildHarnessEnvironment, probeExecutor } from "./harness.ts";
import { GOVERNANCE_PREFIX } from "./paths.ts";
import {
  buildPolicy, invalidPolicyReason, policyHash, SANDBOX_DOCKER_COMMAND, seededSandbox, SYSTEM_NAME, type Policy,
} from "./policy.ts";
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

/**
 * What every sandbox runs whatever the target: POSIX `sh` and `timeout` for
 * the exit-status wrapper, `sleep` to hold the work container open, and `node`
 * for the egress proxy (`src/egress-proxy.ts`).
 */
export const SANDBOX_INFRASTRUCTURE_PROGRAMS = ["sh", "timeout", "sleep", "node"];

/**
 * The refusal for each frozen verification and derived command whose
 * top-level program the image lacks, and for each infrastructure program it
 * lacks (docs/features/sandboxed-implementer/plan.md, Task 7). The check sees
 * only the top-level program: a tool a script calls, a native compiler an
 * install needs, a browser a test downloads or a running service passes it and
 * fails later.
 */
export function sandboxProgramRefusals(frozen: FrozenSandbox, verification: VerificationConfig): string[] {
  const needs = [
    ...verification.commands.map((c) => ({ program: c.command[0]!, who: `the verification command "${c.name}"` })),
    ...verification.derived.map((d) => ({ program: d.command[0]!, who: `the derived command "${d.name}"` })),
    ...SANDBOX_INFRASTRUCTURE_PROGRAMS.map((program) => ({ program, who: "every sandbox" })),
  ];
  const missing = new Set(missingImagePrograms(frozen, needs.map((n) => n.program)));
  return needs
    .filter((n) => missing.has(n.program))
    .map((n) => `${n.who} needs "${n.program}", which image ${frozen.imageId} does not provide; this BuildWorks build supports Node/npm targets (see docs/proposals/target-declared-environments.md)`);
}

/**
 * The Docker checks doctor reports, from the seeded Docker command: the
 * engine, the image (reported, not built, when absent; `new-run` builds it), the program check
 * against the current `governed.yaml`, and the leftover sandbox objects
 * labelled with this repository's key.
 */
function inspectSandbox(rootDir: string, verification: VerificationConfig | null): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const engine = dockerReady(SANDBOX_DOCKER_COMMAND);
  checks.push({ name: "docker_engine", status: engine.ok ? "pass" : "fail",
    evidence: engine.ok ? `Docker engine ${engine.serverVersion} runs linux containers.` : engine.reason,
    repair: engine.ok ? null : "Start Docker Desktop (or another engine running Linux containers) so `docker version` answers; every run that reaches implementation needs it." });
  if (!engine.ok) {
    for (const name of ["sandbox_image", "sandbox_programs", "sandbox_leftovers"]) {
      checks.push({ name, status: "not_checked", evidence: "No Docker engine answered.", repair: null });
    }
    return checks;
  }
  let frozen: FrozenSandbox | null = null;
  try {
    const image = findSandboxImage(SANDBOX_DOCKER_COMMAND);
    if (image.imageId !== null) frozen = seededSandbox(image.imageId);
    checks.push({ name: "sandbox_image", status: "pass",
      evidence: image.imageId === null
        ? `${image.tag} is not built yet; new-run builds it from container/Dockerfile.`
        : `${image.tag} is ${image.imageId}.`,
      repair: null });
  } catch (error) {
    checks.push({ name: "sandbox_image", status: "fail", evidence: (error as Error).message,
      repair: "Make `docker image inspect` answer; the error is named above." });
  }
  if (frozen === null || verification === null) {
    checks.push({ name: "sandbox_programs", status: "not_checked",
      evidence: frozen === null ? "No sandbox image is built yet." : "No readable governed.yaml verification configuration.", repair: null });
  } else {
    try {
      const refusals = sandboxProgramRefusals(frozen, verification);
      checks.push({ name: "sandbox_programs", status: refusals.length === 0 ? "pass" : "fail",
        evidence: refusals.length === 0 ? `Image ${frozen.imageId} provides every frozen command's program.` : refusals.join("; "),
        repair: refusals.length === 0 ? null : "Use verification and derived commands this image provides; other stacks wait for docs/proposals/target-declared-environments.md." });
    } catch (error) {
      checks.push({ name: "sandbox_programs", status: "fail", evidence: (error as Error).message, repair: null });
    }
  }
  try {
    const leftovers = sandboxLeftovers(SANDBOX_DOCKER_COMMAND, rootDir);
    const none = leftovers.containers.length === 0 && leftovers.networks.length === 0;
    const ids = (lines: string[]) => lines.map((line) => line.split(" ")[0]).join(" ");
    checks.push({ name: "sandbox_leftovers", status: "pass",
      evidence: none ? "No sandbox containers or networks are left for this repository."
        : [
          leftovers.containers.length > 0 ? `containers ${leftovers.containers.join(", ")}; remove with: docker rm -f ${ids(leftovers.containers)}` : "",
          leftovers.networks.length > 0 ? `networks ${leftovers.networks.join(", ")}; remove with: docker network rm ${ids(leftovers.networks)}` : "",
        ].filter(Boolean).join("; "),
      repair: null });
  } catch (error) {
    checks.push({ name: "sandbox_leftovers", status: "not_checked", evidence: (error as Error).message, repair: null });
  }
  return checks;
}

/**
 * Whether a run's frozen image is still present locally. `docker image prune`
 * removes an image no container uses, which includes every image an open run
 * needs between sandboxes.
 */
export function inspectFrozenSandboxImage(frozen: FrozenSandbox, runId: number): ReadinessCheck {
  try {
    const present = imagePresent(frozen.dockerCommand, frozen.imageId);
    return { name: "frozen_sandbox_image", status: present ? "pass" : "fail",
      evidence: present
        ? `Frozen image ${frozen.imageId} is present. docker image prune would remove it while no container uses it, and run ${runId} still needs it.`
        : `Frozen image ${frozen.imageId} for run ${runId} is not present locally.`,
      repair: present ? null : "Start a fresh run: a rebuild is not guaranteed to reproduce the frozen image ID." };
  } catch (error) {
    return { name: "frozen_sandbox_image", status: "not_checked", evidence: (error as Error).message, repair: null };
  }
}

export function inspectBootstrapPrerequisites(cwd: string): ReadinessCheck[] {
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
    checks.push({ name: "node", status: "fail", evidence: (error as Error).message,
      repair: "Use a checkout with a readable Node engine requirement." });
  }
  const npm = spawnSync("npm", ["--version"], {
    cwd, encoding: "utf8", shell: process.platform === "win32",
  });
  checks.push({ name: "npm", status: npm.status === 0 ? "pass" : "fail",
    evidence: npm.status === 0 ? npm.stdout.trim() : npm.error?.message ?? npm.stderr.trim(),
    repair: npm.status === 0 ? null : "Install npm and make it resolvable in this invocation's PATH." });
  const version = git(cwd, "--version");
  checks.push({ name: "git", status: version.status === 0 ? "pass" : "fail",
    evidence: version.status === 0 ? version.stdout.trim() : version.error?.message ?? version.stderr.trim(),
    repair: version.status === 0 ? null : "Install Git and make it resolvable in this invocation's PATH." });
  // The starter's install and test run in a sandbox, not on the host.
  const engine = dockerReady(SANDBOX_DOCKER_COMMAND);
  checks.push({ name: "docker_engine", status: engine.ok ? "pass" : "fail",
    evidence: engine.ok ? `Docker engine ${engine.serverVersion} runs linux containers.` : engine.reason,
    repair: engine.ok ? null : "Start Docker Desktop (or another engine running Linux containers) so `docker version` answers; the starter's install and test run in a container." });

  const ambientSnapshot: NodeJS.ProcessEnv = {};
  for (const name of CLAUDE_CODE.sandbox.envPassthrough) ambientSnapshot[name] = process.env[name];
  const childEnv = buildHarnessEnvironment(CLAUDE_CODE, ambientSnapshot);
  try {
    const executablePath = resolveDoctorExecutable(CLAUDE_CODE.probe[0], {
      env: childEnv,
      cwd,
      parentPath: ambientSnapshot.PATH,
      noDefaultCurrentDirectoryInExePath: process.env.NoDefaultCurrentDirectoryInExePath !== undefined,
    });
    const probe = probeExecutor(CLAUDE_CODE, { executablePath, env: childEnv, cwd, timeoutMs: 5000 });
    const output = [probe.stdout.trim(), probe.stderr.trim()].filter(Boolean).join("; ");
    checks.push({ name: "executor_probe", status: "pass",
      evidence: `${executablePath} ${CLAUDE_CODE.probe.slice(1).join(" ")}: ${output}`, repair: null });
  } catch (error) {
    checks.push({ name: "executor_probe", status: "fail",
      evidence: error instanceof Error ? error.message : String(error),
      repair: "Install the native Claude Code executable and make its version probe available on PATH." });
  }
  return checks;
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
  executor: {
    id: string; command: string[]; probe: string[]; capabilities: string[];
    resolvedPath: string | null; probeCwd: string; versionOutput: string | null;
  };
  ambientProviderConfig: AmbientProviderConfig;
  approvalSigner: string | null;
}

export interface ReadinessResult {
  checks: ReadinessCheck[];
  current: CurrentReadiness;
  limitations: string[];
}

export function inspectReadiness(rootDir: string, options: { slug?: string } = {}): ReadinessResult {
  const probeCwd = process.cwd();
  const ambientSnapshot: NodeJS.ProcessEnv = {};
  for (const name of new Set([...CLAUDE_CODE.sandbox.envPassthrough, ...DOCTOR_OBSERVATION_NAMES])) {
    ambientSnapshot[name] = process.env[name];
  }
  const childEnv = buildHarnessEnvironment(CLAUDE_CODE, ambientSnapshot);
  const lookup = { env: childEnv, cwd: probeCwd, parentPath: ambientSnapshot.PATH,
    noDefaultCurrentDirectoryInExePath: process.env.NoDefaultCurrentDirectoryInExePath !== undefined };
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
  checks.push(...inspectSandbox(rootDir, intake.verification));
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
    ["spec-author", ["spec", "spec-self-critique", "spec-reconciliation", "spec-split"]],
    ["plan-author", ["plan", "plan-self-critique", "plan-reconciliation"]],
    ["implementer", ["patches", "implementation-self-review"]],
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
  const ambientProviderConfig = collectAmbientProviderConfig(CLAUDE_CODE, ambientSnapshot, childEnv);
  const overrides = ambientProviderConfig.environment.filter((entry) =>
    DOCTOR_OBSERVATION_NAMES.some((name) => name === entry.name) && entry.present);
  checks.push({ name: "ambient_provider_config",
    status: ambientProviderConfig.files.some((file) => file.state === "unavailable") ? "not_checked" : "pass",
    evidence: [
      overrides.length === 0 ? "No observed overrides are present."
        : overrides.map((entry) => `${entry.name}: present, ${entry.passedToChild ? "supplied to child" : "excluded from child"}`).join("; "),
      ...ambientProviderConfig.files.map((file) => `${file.name}: ${file.state}`),
    ].join("; "), repair: null });
  let resolvedPath: string | null = null;
  let versionOutput: string | null = null;
  try {
    resolvedPath = resolveDoctorExecutable(CLAUDE_CODE.probe[0], lookup);
    const probe = probeExecutor(CLAUDE_CODE, { timeoutMs: 5000, env: childEnv, cwd: probeCwd, executablePath: resolvedPath });
    versionOutput = [probe.stdout.trim(), probe.stderr.trim()].filter(Boolean).join("; ") || null;
    checks.push({ name: "executor_probe", status: "pass",
      evidence: `${resolvedPath} ${CLAUDE_CODE.probe.slice(1).join(" ")}: ${versionOutput ?? ""}`,
      repair: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = `probe failed for executor ${CLAUDE_CODE.id}:`;
    checks.push({ name: "executor_probe", status: "fail",
      evidence: `${message.startsWith(prefix) ? message : `${prefix} ${message}`}${resolvedPath === null ? "" : `; selected probe path: ${resolvedPath}`}`,
      repair: "Install the native Claude Code executable and make its version probe available on PATH." });
  }
  return {
    checks,
    current: {
      systemName: SYSTEM_NAME, nodeVersion: process.versions.node, minimumNodeMajor, gitVersion,
      startingCommit: intake.startingCommit, verification: intake.verification,
      policy, policyHash: policyHash(policy), agentIds: AGENTS.map((agent) => agent.id),
      executor: { id: CLAUDE_CODE.id, command: [...CLAUDE_CODE.command], probe: [...CLAUDE_CODE.probe],
        capabilities: [...CLAUDE_CODE.capabilities], resolvedPath, probeCwd, versionOutput },
      ambientProviderConfig,
      approvalSigner: key.ok ? key.signer : null,
    },
    limitations: [
      "Provider account authentication, model entitlement, and quota are not checked by the local version probe.",
      "External signing-authority availability is not checked.",
      "The inventory covers only two documented user locations; managed/project settings, OS home fallback, actual file use under native flags, and effective precedence are not established.",
      "passedToChild describes the BuildWorks-supplied map only; Windows may add required system environment variables.",
      "Executable identity and ambient observations are current evidence, including under --run, not frozen facts or a pin for later worktree dispatches with different cwd or environment.",
      "Version output does not establish executable origin, a supported installation, or provider readiness.",
      "Paths, environment hashes, sizes and whole-file hashes are sensitive comparison data, not anonymization. The user_state hash intentionally includes any sign-in/trust state; review both output formats before redirecting or sharing.",
      "File observations are best effort, not a filesystem snapshot. The five-second timeout bounds the version probe, not OS filesystem latency or the whole doctor command.",
    ],
  };
}
