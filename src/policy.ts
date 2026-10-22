import { canonicalJson, sha256Hex } from "./canonical.ts";
import { PROXY_ALIAS, PROXY_PORT, type FrozenSandbox, type SandboxLimits } from "./container.ts";
import { SEVERITIES } from "./finding.ts";
import { PROMPT_MAX_BYTES, RESULT_MAX_BYTES } from "./harness.ts";
import { PROTECTED_PATH_PREFIXES } from "./scope.ts";

/**
 * The system name is configuration, resolved at run start and frozen in the
 * profile (architecture section 12). Nothing functional depends on it.
 */
export const SYSTEM_NAME = "BuildWorks";

/**
 * Review rounds per artifact. One configured round is one complete
 * panel -> reconcile cycle (architecture section 12, as amended 2026-09-01).
 * Self-critique happens once per artifact regardless of this count, before
 * the first panel, and never occupies a panel seat.
 *
 * One, not the three this replaces. Those three counted closure passes, and a
 * closure pass redispatches a panel that varies nothing that matters —
 * hazard 7 exactly. Frozen per run through the profile and read by both
 * stages (step 5b Task 9), which run exactly this many complete
 * `panel -> reconcile` cycles before the decision gate.
 */
export const SPEC_REVIEW_ROUNDS = 1;
export const PLAN_REVIEW_ROUNDS = 1;

/**
 * The panel size bounds, replacing the per-risk map the author-proposed panel
 * supersedes. Risk itself survives — the approval payload binds it — it just
 * no longer sizes the panel.
 *
 * The floor is also the default. Two is what makes an independence claim mean
 * anything, and the default installation only needs to staff two distinct
 * specialties. The author proposes the size within these bounds (step 5b
 * Task 5) and the stages staff exactly what it asked for, so the maximum is a
 * ceiling on that request rather than the size a run seats by default.
 *
 * Configuring more required specialties than the floor is legal — the check
 * below only requires that they fit the maximum — and it raises the smallest
 * request that can succeed to `requiredSpecialties.length`, because required
 * lenses consume seats inside whatever size the author asks for. The
 * self-critique prompt states that effective floor rather than this constant;
 * an operator raising one should expect the other to move.
 *
 * `PANEL_SIZE_MAX` must lie within [`PANEL_SIZE_FLOOR`, `PANEL_SIZE_CEILING`].
 * Raising it is an operator action that requires registering more specialists,
 * and `staffingShortfall` refuses at configuration time when they are absent —
 * before a run row exists and before anything has been spent.
 */
export const PANEL_SIZE_FLOOR = 2;
export const PANEL_SIZE_CEILING = 5;
export const PANEL_SIZE_MAX = 2;

/**
 * Code review has an operator-chosen panel and total panel-execution budget,
 * separate from the author-requested document-review policy above. These are
 * the two values an operator changes after measuring effectiveness; their
 * absolute bounds are enforced against every frozen profile.
 */
export const CODE_REVIEW_PANEL_SIZE_FLOOR = 2;
export const CODE_REVIEW_PANEL_SIZE_CEILING = 5;
export const CODE_REVIEW_PANEL_SIZE = 3;
export const CODE_REVIEW_MAX_ROUNDS_FLOOR = 1;
export const CODE_REVIEW_MAX_ROUNDS_CEILING = 5;
export const CODE_REVIEW_MAX_ROUNDS = 2;

/**
 * How many code-review reconciler calls must each reject a finding before it
 * is withheld from remediation (`docs/features/code-review-reconciler/plan.md`).
 * The calls run in sequence before a remediation, and a later call runs only
 * while some finding is still rejected by every earlier call, so this is also
 * the most reconciler dispatches one remediated round can make.
 *
 * The floor is 2 because a single call wrongly rejected a must-keep finding
 * once in 30 recorded calls (crew-chatter run 6, test 5, #906); no pair of calls
 * rejected it. The ceiling exists because every limit needs one; raising the
 * count only makes a rejection harder to reach. Frozen at run start (hard rule
 * 6); the stage reads `profile.policy.codeReviewReconcilerCalls`.
 */
export const CODE_REVIEW_RECONCILER_CALLS_FLOOR = 2;
export const CODE_REVIEW_RECONCILER_CALLS_CEILING = 3;
export const CODE_REVIEW_RECONCILER_CALLS = 2;

/**
 * The implementation stage dispatches the `implementer` once per phase, and a
 * phase is this many consecutive tasks of the approved plan's `## Tasks`
 * section, in plan order. One dispatch over a whole plan was refused or failed
 * in team-notes runs 4, 5 and 6 (hazard 20); the operator chose ten tasks per
 * phase on 2026-10-04. Nothing measured says ten is the right size.
 *
 * `IMPLEMENTATION_MAX_PHASES` bounds spend before it happens. The consent
 * preview computes its dispatch ceilings from the frozen policy alone, and the
 * plan may not exist when the preview is printed, so the ceiling cannot come
 * from the plan's task count. A plan with more than
 * `IMPLEMENTATION_PHASE_TASKS * IMPLEMENTATION_MAX_PHASES` tasks is refused
 * before the implementation stage creates its row, worktree or dispatch. Eight
 * is the assistant's value, not the operator's; team-notes run 6 needs six.
 *
 * Both values freeze at run start (hard rule 6); the stage reads
 * `profile.policy`, never these constants.
 */
export const IMPLEMENTATION_PHASE_TASKS = 10;
export const IMPLEMENTATION_MAX_PHASES = 8;

/**
 * A reviewed specification declaring more files than this gets a proposal to
 * split the design into features, after the spec review gate passes and before
 * approval (`docs/features/design-split-into-features/plan.md`). The comparison
 * is strictly greater, on the deduplicated scope (`computeScope`).
 *
 * 30 is the frozen 80-task ceiling (`IMPLEMENTATION_PHASE_TASKS` times
 * `IMPLEMENTATION_MAX_PHASES`) divided by the highest recorded ratio of plan
 * items to declared files, 2.6 (team-notes run 10: 20 files, 52 items), rounded
 * down. The ratio comes from eleven runs of two test designs, copied with their
 * sources into `test/fixtures/recorded/declared-paths-vs-plan-items.json`. It is
 * an estimate: a design under the threshold, or a split the operator denies, may
 * still be refused at the plan ceiling.
 *
 * Frozen at run start (hard rule 6); the spec stage reads
 * `profile.policy.designSplitPathThreshold`, never this constant.
 */
export const DESIGN_SPLIT_PATH_THRESHOLD = 30;

/**
 * The lowest severity at which one code-review report blocks the run.
 *
 * `high` rather than anything weaker because of hazard 11: a panel that
 * returns nothing is the exception, not the rule — every web-calculator panel
 * returned findings — so a gate that blocked on any finding at all would make
 * the default installation unable to complete a run against any design large
 * enough to attract one. `high` is the first level at which a reviewer is
 * asserting the change fails an acceptance criterion or a plan task it claims
 * to cover, or behaves incorrectly in ordinary use; the two levels below it
 * are a defect that fails no criterion, and a nit. That rubric is stated to
 * the reviewer in the prompt, because a threshold over an unstated scale is a
 * comparison against nothing (hazard 3).
 *
 * On the final panel, the run blocks when a report reaches this value and
 * names each blocking finding's id, severity, and location. Earlier panels
 * remediate every finding while the separately frozen round budget remains.
 *
 * Configuration, so its value is stated here and frozen per run through the
 * profile. The stage reads `profile.policy.codeReviewBlockingSeverity` and
 * orders it within `profile.policy.severities` — never this constant, and
 * never the live `SEVERITIES`.
 */
export const CODE_REVIEW_BLOCKING_SEVERITY = "high";

/**
 * The effort levels `claude --effort` takes, as the CLI's own help lists them.
 * `ultracode` is left out on purpose: the CLI treats it as `xhigh` plus a
 * separate feature, and the API docs' set is these five. A level outside this
 * list is refused when the run is frozen, because the CLI itself only warns
 * about an unknown value and then runs at its default.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * The setting that governs the three reconciliation dispatches: the spec and
 * plan reconciliations in a review round, and the decision fold after an
 * operator answers. It is a setting name, not a registered agent; those
 * dispatches still record the author agent that ran them.
 */
export const RECONCILER = "reconciler";

/**
 * The setting that governs the code-review reconciler: the calls that judge
 * each finding of a non-final code-review panel before remediation. Separate
 * from `RECONCILER`, which takes the run's `--model`, because this one was
 * measured only on Haiku 5.5 at `medium` (the run 6 replays). A setting name,
 * not a registered agent; its dispatches record the `implementer`, the code
 * review stage's author.
 */
export const CODE_REVIEW_RECONCILER = "code-review-reconciler";

export interface SettingDefault {
  /** null means "the run's --model". */
  model: string | null;
  effort: EffortLevel;
}

// 2026-10-08: the operator moved both reviewer panels to Haiku 5.5
// (`claude-haiku-5-5`), the spec reviewers from Haiku 4.5 and the code reviewers
// from Sonnet 5.5. Task 0 (2026-09-29) showed Haiku 4.5 accepts --effort at low
// and medium; effort `medium` on Haiku 5.5 was not probed.
const SPEC_REVIEWER: SettingDefault = { model: "claude-haiku-5-5", effort: "medium" };
const CODE_REVIEWER: SettingDefault = { model: "claude-haiku-5-5", effort: "medium" };

/**
 * Seeded model and effort per dispatch setting: one entry per registered agent
 * plus `RECONCILER` and `CODE_REVIEW_RECONCILER`. These are starting points
 * with no measurement behind them for this workload, except the code-review
 * reconciler's, which is the one setting its replays measured. They are read
 * only when a run is frozen, so changing one affects new runs only; the profile
 * freezes the resolved values, not these constants (hard rule 6). They are
 * deliberately not part of `Policy` or `policyHash`.
 *
 * No reviewer is seeded at `high` or above, and a run-wide `--effort` never
 * reaches a reviewer or the code-review reconciler; only its own
 * `--effort-for` moves it.
 *
 * The acceptance test author's setting is the operator's choice from the
 * plan's Task 4 evaluation (2026-10-21,
 * `docs/features/protected-acceptance-tests/plan.md`): Sonnet 5.5 `medium`
 * passed every threshold on 3 of 3 samples at less than a third of Opus's cost.
 */
export const DEFAULT_SETTINGS: Readonly<Record<string, SettingDefault>> = {
  "spec-author": { model: "claude-opus-5-5", effort: "high" },
  "plan-author": { model: "claude-opus-5-5", effort: "high" },
  "implementer": { model: "claude-sonnet-5-5", effort: "medium" },
  "acceptance-test-author": { model: "claude-sonnet-5-5", effort: "medium" },
  [RECONCILER]: { model: null, effort: "medium" },
  [CODE_REVIEW_RECONCILER]: { model: "claude-haiku-5-5", effort: "medium" },
  "spec-reviewer-traceability": SPEC_REVIEWER,
  "spec-reviewer-security": SPEC_REVIEWER,
  "spec-reviewer-consistency": SPEC_REVIEWER,
  "code-reviewer-correctness": CODE_REVIEWER,
  "code-reviewer-security": CODE_REVIEWER,
  "code-reviewer-state-integrity": CODE_REVIEWER,
};

export const REQUIRED_SPECIALTIES = ["requirements-traceability"];

/**
 * The ceiling on how far ahead an authorization may expire. Without it an
 * operator can sign a decade-long approval, which is a human gate in name
 * only.
 */
export const APPROVAL_MAX_LIFETIME_SECONDS = 86400;

/**
 * The authorization window `bw approval-request` uses when the operator does
 * not supply `--expires`.
 *
 * This is a *human* window: it spans printing the payload, the operator
 * reading and signing it, and `bw approve` verifying the signature. Eight
 * hours because a human gate that expires while the human is still reading
 * is a gate that trains people to rubber-stamp — an approval that takes
 * thirteen hours is a slow approval, not an invalid one, and the operator
 * covers that case with `--expires` up to the ceiling above.
 */
export const APPROVAL_DEFAULT_LIFETIME_SECONDS = 28800;

/**
 * The ceiling on how long a run may exist before the implementation stage
 * refuses to start it. Section 20's rule that every limit defines its
 * behaviour on breach is satisfied by the refusal, which names this limit.
 * Seven days because the ceiling exists to stop an unattended run, and the
 * human approval window (default eight hours) plus the remediating stages
 * must fit comfortably.
 *
 * This is configuration, so its value is stated here and frozen per run
 * through the profile — the stage reads `profile.policy.runDurationLimitSeconds`
 * rather than this constant, which is how section 20's "record which values
 * were in force" is satisfied.
 */
export const RUN_DURATION_LIMIT_SECONDS = 7 * 86400;

/**
 * The ceiling on a single verification command. Fifteen minutes because a
 * typecheck plus a test suite fits comfortably inside it: the ceiling exists
 * to stop a hung command, not to pace a fast one.
 *
 * On breach (section 20's rule that every limit defines its behaviour): the
 * process tree is killed and the run blocks, naming the command and this
 * limit. Frozen per run through the profile, so the stage reads
 * `profile.policy.verifyCommandTimeoutSeconds` rather than this constant.
 */
export const VERIFY_COMMAND_TIMEOUT_SECONDS = 900;

/**
 * The ceiling on what one verification command may write to its retained
 * evidence file. Sixty-four times the one-megabyte result budget, because
 * retention exists to make a refusal diagnosable and nobody diagnoses a
 * gigabyte — while a suite that legitimately logs a few megabytes must not be
 * truncated.
 *
 * The in-memory budget alone is not enough. Retention is deliberately
 * independent of it (hazard 2: bytes discarded above a cap are bytes no
 * diagnosis can recover), so without a second ceiling the only bound on disk
 * is the command's time ceiling — and a command writing to stdout at pipe
 * speed reaches gigabytes in seconds. Measured at roughly 1 GB/s on this
 * machine, which is 900 GB inside `VERIFY_COMMAND_TIMEOUT_SECONDS`.
 *
 * On breach (section 20's rule that every limit defines its behaviour): the
 * process tree is killed and the outcome already carries `outputOverflow`,
 * which blocks the run. The command had exhausted its output budget long
 * before this point, so its result was decided either way; killing it only
 * stops the disk filling while the answer is already known.
 */
export const VERIFY_RETENTION_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The run's sandbox, seeded here and frozen into `profile.sandbox` at
 * `new-run` with the image ID (docs/features/sandboxed-implementer/plan.md,
 * hard rule 6). The stages and `src/container.ts` read the frozen values,
 * never these constants.
 *
 * - `SANDBOX_LIMITS`: each work container's CPU, memory (swap equal, so none)
 *   and process ceiling, the spike's values.
 * - `SANDBOX_COMMAND_TIMEOUT_SECONDS`: one tool-server command's ceiling. A
 *   tool call emits nothing while its command runs, so it stays below the
 *   1800-second idle budget (hazard 19).
 * - `SANDBOX_EGRESS_ALLOWLIST`: the one host for the one ecosystem in use
 *   (hard rule 4); a second feed is one more entry.
 * - `PATCH_DISPATCH_BUDGET_USD`: `--max-budget-usd` on each patch dispatch
 *   (operator, 2026-10-19).
 * - `SANDBOX_DOCKER_COMMAND`: how Docker is run; tests freeze a stand-in.
 * - `SANDBOX_USER`: the base image's non-root user.
 * - `SANDBOX_ENV`: the npm proxy settings, pointing at the proxy's network
 *   alias so a frozen value never embeds a run-specific name. They are
 *   image- and npm-specific, which is why they are frozen values here and not
 *   code in `src/container.ts` (extension points 1 and 4).
 */
export const SANDBOX_LIMITS: SandboxLimits = { cpus: "2", memory: "4g", pidsLimit: 512 };
export const SANDBOX_COMMAND_TIMEOUT_SECONDS = 300;
export const SANDBOX_EGRESS_ALLOWLIST = ["registry.npmjs.org:443"];
export const PATCH_DISPATCH_BUDGET_USD = "2.00";
export const SANDBOX_DOCKER_COMMAND = ["docker"];
export const SANDBOX_USER = "node";
export const SANDBOX_ENV = [
  `npm_config_proxy=http://${PROXY_ALIAS}:${PROXY_PORT}`,
  `npm_config_https_proxy=http://${PROXY_ALIAS}:${PROXY_PORT}`,
];

/**
 * How many times the acceptance command runs each test, frozen into
 * `profile.acceptance.repeatEach` by `new-run --acceptance-tests`
 * (docs/features/protected-acceptance-tests/plan.md). Two is the least that
 * measures determinism: a test whose two results differ is flaky, never passed
 * (hazard 7). Not a `Policy` field, because a stored run without a policy field
 * cannot be inspected.
 */
export const ACCEPTANCE_REPEAT_EACH = 2;

/** The seeded sandbox around one image ID, as `new-run` freezes it. */
export function seededSandbox(imageId: string): FrozenSandbox {
  return {
    dockerCommand: [...SANDBOX_DOCKER_COMMAND],
    imageId,
    limits: { ...SANDBOX_LIMITS },
    commandTimeoutSeconds: SANDBOX_COMMAND_TIMEOUT_SECONDS,
    egressAllowlist: [...SANDBOX_EGRESS_ALLOWLIST],
    user: SANDBOX_USER,
    env: [...SANDBOX_ENV],
    patchDispatchBudgetUsd: PATCH_DISPATCH_BUDGET_USD,
  };
}

/**
 * The wall clock on one Microsoft-Decision-1 request (`src/systemone.ts`). The
 * probe's four requests took 160 to 615 ms
 * (`test/fixtures/recorded/systemone-probe-snitch-resource.json`), so the
 * ceiling stops a hung connection rather than pacing a slow one. On breach the
 * request fails with "timed out after <ms> ms" and is not retried. A run with
 * the narration check on freezes this value at `new-run` (profile
 * `narrationCheck.timeoutMs`); the evaluation scripts read it directly.
 */
export const SYSTEMONE_REQUEST_TIMEOUT_MS = 120_000;

/**
 * The probability of `contains-remark` at or above which the narration check
 * flags an Acceptance criteria entry. 0.8 is the threshold the operator set
 * before the 2026-10-17 evaluation, under which the check passed every clause
 * (`docs/features/decision-1-format-checks/plan.md`, "Evaluation record"); at
 * 0.9 it missed AC-051 (0.835). Frozen per run at `new-run`.
 */
export const NARRATION_THRESHOLD = 0.8;

export interface Policy {
  specReviewRounds: number;
  planReviewRounds: number;
  panelSizeMin: number;
  panelSizeMax: number;
  codeReviewPanelSize: number;
  codeReviewMaxRounds: number;
  codeReviewReconcilerCalls: number;
  codeReviewBlockingSeverity: string;
  implementationPhaseTasks: number;
  implementationMaxPhases: number;
  designSplitPathThreshold: number;
  severities: string[];
  requiredSpecialties: string[];
  protectedPathPrefixes: string[];
  promptMaxBytes: number;
  resultMaxBytes: number;
  approvalMaxLifetimeSeconds: number;
  approvalDefaultLifetimeSeconds: number;
  runDurationLimitSeconds: number;
  verifyCommandTimeoutSeconds: number;
  verifyRetentionMaxBytes: number;
}

/**
 * Policy is the subset of the profile that gates consult (section 12). Every
 * value is read from the module that actually enforces it, so a constant
 * changed in one place cannot leave the frozen policy describing something
 * the code no longer does.
 */
export function buildPolicy(): Policy {
  return {
    specReviewRounds: SPEC_REVIEW_ROUNDS,
    planReviewRounds: PLAN_REVIEW_ROUNDS,
    panelSizeMin: PANEL_SIZE_FLOOR,
    panelSizeMax: PANEL_SIZE_MAX,
    codeReviewPanelSize: CODE_REVIEW_PANEL_SIZE,
    codeReviewMaxRounds: CODE_REVIEW_MAX_ROUNDS,
    codeReviewReconcilerCalls: CODE_REVIEW_RECONCILER_CALLS,
    codeReviewBlockingSeverity: CODE_REVIEW_BLOCKING_SEVERITY,
    implementationPhaseTasks: IMPLEMENTATION_PHASE_TASKS,
    implementationMaxPhases: IMPLEMENTATION_MAX_PHASES,
    designSplitPathThreshold: DESIGN_SPLIT_PATH_THRESHOLD,
    severities: [...SEVERITIES],
    requiredSpecialties: [...REQUIRED_SPECIALTIES],
    protectedPathPrefixes: [...PROTECTED_PATH_PREFIXES],
    promptMaxBytes: PROMPT_MAX_BYTES,
    resultMaxBytes: RESULT_MAX_BYTES,
    approvalMaxLifetimeSeconds: APPROVAL_MAX_LIFETIME_SECONDS,
    approvalDefaultLifetimeSeconds: APPROVAL_DEFAULT_LIFETIME_SECONDS,
    runDurationLimitSeconds: RUN_DURATION_LIMIT_SECONDS,
    verifyCommandTimeoutSeconds: VERIFY_COMMAND_TIMEOUT_SECONDS,
    verifyRetentionMaxBytes: VERIFY_RETENTION_MAX_BYTES,
  };
}

export function policyHash(policy: Policy): string {
  return sha256Hex(canonicalJson(policy));
}

function isPositiveInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((e) => typeof e === "string");
}

/** Every policy field that must be a positive integer, with no further bound. */
const POSITIVE_INT_FIELDS = [
  "specReviewRounds",
  "planReviewRounds",
  "codeReviewMaxRounds",
  "codeReviewReconcilerCalls",
  "implementationPhaseTasks",
  "implementationMaxPhases",
  "designSplitPathThreshold",
  "promptMaxBytes",
  "resultMaxBytes",
  "approvalMaxLifetimeSeconds",
  "approvalDefaultLifetimeSeconds",
  "runDurationLimitSeconds",
  "verifyCommandTimeoutSeconds",
  "verifyRetentionMaxBytes",
];

/** Every policy field that must be an array of strings. */
const STRING_ARRAY_FIELDS = [
  "severities",
  "requiredSpecialties",
  "protectedPathPrefixes",
];

/**
 * Is this frozen policy one this code enforces? Returns the reason it is not,
 * or null when it is.
 *
 * Not a version check, and deliberately not compatibility handling — hard rule
 * 3 forbids both, and this is that rule said out loud rather than an exception
 * to it. The question has no notion of "old": does the policy this run froze
 * carry the values the stages read, within the bounds they assume?
 *
 * The reason it has to exist. A profile frozen before a field existed parses
 * with `undefined` in its place, and in JavaScript every comparison against
 * `undefined` is false: `panel.length < undefined` is false, so a staffing
 * refusal would never fire, and a loop bounded by `undefined` would run zero
 * times. The central refusal keeps that malformed value from reaching any
 * consumer.
 * Filling a default would be worse — it would govern a run by a value it never
 * froze — so the only honest answer is to refuse and name what is wrong.
 *
 * The expected field set is read from `buildPolicy()` rather than listed here,
 * so adding a policy field cannot leave this check silently behind. An
 * obsolete field is reported too: a policy still carrying `panelSizes` is as
 * clear a signal of a superseded shape as one missing `panelSizeMax`.
 */
export function invalidPolicyReason(policy: unknown): string | null {
  return policyReason(policy, false);
}

/**
 * The same question for a read-only inspection
 * (docs/features/inspectable-frozen-profiles/plan.md): every check above,
 * except that a field the current `Policy` no longer has is not refused. No
 * code reads such a field, so it cannot reach a snapshot; a missing field is
 * still refused, because code may read it, and that refusal still names any
 * obsolete field too. A policy with an obsolete field and another defect is
 * refused here for the other defect, where execution names the obsolete field.
 */
export function invalidInspectablePolicyReason(policy: unknown): string | null {
  return policyReason(policy, true);
}

function policyReason(policy: unknown, tolerateObsolete: boolean): string | null {
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    return "the frozen profile carries no policy object";
  }
  const p = policy as Record<string, unknown>;
  const expected = Object.keys(buildPolicy());
  const missing = expected.filter((k) => !(k in p));
  const obsolete = Object.keys(p).filter((k) => !expected.includes(k));
  if (missing.length > 0 || (obsolete.length > 0 && !tolerateObsolete)) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.sort().join(", ")}`);
    if (obsolete.length > 0) parts.push(`carrying obsolete ${obsolete.sort().join(", ")}`);
    return `the frozen policy is not the shape this code enforces: ${parts.join("; ")}`;
  }
  for (const field of POSITIVE_INT_FIELDS) {
    if (!isPositiveInt(p[field])) {
      return `the frozen policy field ${field} must be a positive integer, found ${JSON.stringify(p[field])}`;
    }
  }
  for (const field of STRING_ARRAY_FIELDS) {
    if (!isStringArray(p[field])) {
      return `the frozen policy field ${field} must be an array of strings, found ${JSON.stringify(p[field])}`;
    }
  }
  // Checked against the policy's own frozen vocabulary, not the live
  // `SEVERITIES`, because that frozen list is what the gate indexes: a
  // threshold valid against the live constant but absent from the frozen list
  // would index to -1 and block nothing. Exactly once, so a list carrying the
  // threshold twice cannot make the comparison depend on which index won.
  const severities = p.severities as string[];
  const threshold = p.codeReviewBlockingSeverity;
  if (typeof threshold !== "string" || severities.filter((s) => s === threshold).length !== 1) {
    return `the frozen policy field codeReviewBlockingSeverity must occur exactly once in the frozen severities ${JSON.stringify(
      severities
    )}, found ${JSON.stringify(threshold)}`;
  }
  if (!isPositiveInt(p.panelSizeMin) || !isPositiveInt(p.panelSizeMax)) {
    return `the frozen policy panel sizes must be positive integers, found min ${JSON.stringify(
      p.panelSizeMin
    )} and max ${JSON.stringify(p.panelSizeMax)}`;
  }
  const min = p.panelSizeMin as number;
  const max = p.panelSizeMax as number;
  // The bound is the absolute one, not today's configured value: a run frozen
  // under a different but legal maximum is still governed by what it froze
  // (hard rule 6). Only a size the selector could not honour is refused.
  if (min < PANEL_SIZE_FLOOR || max > PANEL_SIZE_CEILING || min > max) {
    return `the frozen policy panel sizes ${min}-${max} are outside the permitted ${PANEL_SIZE_FLOOR}-${PANEL_SIZE_CEILING}`;
  }
  const required = p.requiredSpecialties as string[];
  if (new Set(required).size !== required.length) {
    return "the frozen policy requiredSpecialties must not contain duplicates";
  }
  if (required.length > max) {
    return `the frozen policy has ${required.length} required specialties, which cannot fit in its maximum panel of ${max}`;
  }
  if (!isPositiveInt(p.codeReviewPanelSize)) {
    return `the frozen policy field codeReviewPanelSize must be a positive integer, found ${JSON.stringify(
      p.codeReviewPanelSize
    )}`;
  }
  const codeReviewPanelSize = p.codeReviewPanelSize as number;
  if (
    codeReviewPanelSize < CODE_REVIEW_PANEL_SIZE_FLOOR ||
    codeReviewPanelSize > CODE_REVIEW_PANEL_SIZE_CEILING
  ) {
    return `the frozen policy field codeReviewPanelSize ${codeReviewPanelSize} is outside the permitted ${CODE_REVIEW_PANEL_SIZE_FLOOR}-${CODE_REVIEW_PANEL_SIZE_CEILING}`;
  }
  const codeReviewMaxRounds = p.codeReviewMaxRounds as number;
  if (
    codeReviewMaxRounds < CODE_REVIEW_MAX_ROUNDS_FLOOR ||
    codeReviewMaxRounds > CODE_REVIEW_MAX_ROUNDS_CEILING
  ) {
    return `the frozen policy field codeReviewMaxRounds ${codeReviewMaxRounds} is outside the permitted ${CODE_REVIEW_MAX_ROUNDS_FLOOR}-${CODE_REVIEW_MAX_ROUNDS_CEILING}`;
  }
  const codeReviewReconcilerCalls = p.codeReviewReconcilerCalls as number;
  if (
    codeReviewReconcilerCalls < CODE_REVIEW_RECONCILER_CALLS_FLOOR ||
    codeReviewReconcilerCalls > CODE_REVIEW_RECONCILER_CALLS_CEILING
  ) {
    return `the frozen policy field codeReviewReconcilerCalls ${codeReviewReconcilerCalls} is outside the permitted ${CODE_REVIEW_RECONCILER_CALLS_FLOOR}-${CODE_REVIEW_RECONCILER_CALLS_CEILING}`;
  }
  return null;
}
