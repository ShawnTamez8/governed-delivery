import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as promptBuilders from "../src/prompts.ts";
import {
  buildCodeReviewPrompt,
  buildCodeReviewReconcilerPrompt,
  buildCodeReviewRemediationPrompt,
  buildDesignSplitPrompt,
  buildImplementationAuthorPrompt,
  buildImplementationSelfReviewPrompt,
  buildPlanAuthorPrompt,
  buildPlanReconcilePrompt,
  buildPlanReviewPrompt,
  buildPlanSelfCritiquePrompt,
  buildSpecAuthorPrompt,
  buildSpecDecisionFoldPrompt,
  buildSpecReconcilePrompt,
  buildSpecReviewPrompt,
  buildSpecSelfCritiquePrompt,
  type FoldQuestionInput,
  type PanelPromptBounds,
  type ReconciliationFindingInput,
} from "../src/prompts.ts";
import { IMPLEMENTER } from "../src/agents/implementer.ts";
import { PLAN_AUTHOR } from "../src/agents/plan-author.ts";
import { CODE_REVIEWER_CORRECTNESS } from "../src/agents/code-reviewer-correctness.ts";
import { CODE_REVIEWER_SECURITY } from "../src/agents/code-reviewer-security.ts";
import { CODE_REVIEWER_STATE_INTEGRITY } from "../src/agents/code-reviewer-state-integrity.ts";
import { SPEC_AUTHOR } from "../src/agents/spec-author.ts";
import { SPEC_REVIEWER_TRACEABILITY } from "../src/agents/spec-reviewer-traceability.ts";
import { validatePanelRequest } from "../src/select.ts";
import { readSpecDeclaredArtifacts, validateSpecDoc } from "../src/spec-doc.ts";
import { validateDesignSplit } from "../src/design-split.ts";
import { planPhases, validatePlanDoc, type PlanPhase } from "../src/plan-doc.ts";
import { PATCH_RESULT_SCHEMA, validateAgentResult, type AgentResult } from "../src/agent-result.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { parseEnvelope } from "../src/harness.ts";
import { validateSelfCritique } from "../src/self-critique.ts";
import { SELF_REVIEW_RESULT_SCHEMA, validateImplementationSelfReview } from "../src/implementation-self-review.ts";
import {
  planNormativeNodes,
  specNormativeNodes,
  validateReconciliation,
  validateReviewerReports,
} from "../src/reconciliation.ts";
import { validateCodeReviewReports } from "../src/code-review.ts";
import { normalizeText, sha256Hex } from "../src/canonical.ts";
import { parseGovernedConfig, type VerificationConfig } from "../src/governed-config.ts";
import { DESIGN_SPLIT_PATH_THRESHOLD } from "../src/policy.ts";
import { disclosedOpenDecisionReports } from "../src/spec-stage.ts";

// Hazard 3: every constrained field the prompts request must state its
// constraint in the prompt source. This test reads the file, never the
// generated strings — it guards the source.
const source = readFileSync(join(process.cwd(), "src", "prompts.ts"), "utf8");

/**
 * The frozen panel configuration a self-critique prompt is built from.
 *
 * `sizeMin` and `sizeMax` deliberately differ: with the default 2 and 2 a
 * builder that rendered the maximum where the minimum belongs would produce
 * identical text, and the assertion would pass on a prompt that tells the
 * author the wrong bound.
 */
const PANEL: PanelPromptBounds = {
  sizeMin: 2,
  sizeMax: 3,
  requiredSpecialties: ["requirements-traceability"],
  registeredSpecialties: ["consistency", "security"],
};

/**
 * The frozen verification commands every verification-aware builder takes.
 *
 * Parsed by the real parser from the `governed.yaml` recorded verbatim in the
 * run 10 fixture (hard rule 5; hazard 4): the commands are team-notes' own, not
 * a literal written alongside the code that renders them. The fixture's
 * provenance block names the run and what was dropped.
 */
const RUN_10_FIXTURE: { governedYaml: string } = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "run-10-dispatch-context.json"), "utf8")
);
const VERIFICATION: VerificationConfig = (() => {
  const parsed = parseGovernedConfig(RUN_10_FIXTURE.governedYaml);
  if (!parsed.ok) throw new Error(`run 10 governed.yaml does not parse: ${parsed.reason}`);
  return parsed.config;
})();

/** The three command lines as `governed.yaml` in the fixture declares them, in order. */
const RUN_10_COMMAND_LINES = ["- typecheck: npx tsc --noEmit", "- lint: npm run lint", "- build: npm run build"];

/**
 * The verification block's sentences, each one source line in `src/prompts.ts`
 * so the source scan below matches it (hazard 3). The commands themselves are
 * data and are asserted separately.
 */
const VERIFICATION_BLOCK_SENTENCES = [
  "After the implementation is committed, and again after each code-review remediation commit, the system runs these verification commands in this order in a checkout of the delivered code:",
  "A command passes only if it exits 0 within its time and output limits and leaves the checkout exactly as committed: git must show no new or changed file, so build output must be ignored by git.",
  "The first command that fails blocks the run, and no repair round follows.",
];

/**
 * The spec author's rule for the commands. The fifth sentence carries the
 * backticked word the reconcile and fold prompts recognize, which cannot be
 * matched in source without its escapes; it is split around it here and
 * asserted whole against the generated prompt.
 */
const SPEC_VERIFICATION_SENTENCES = [
  "Your working directory is the target repository's working tree; read what each command runs there.",
  "Treat a file as evidence of what a command runs only if it belongs to the repository the design describes; if you cannot tell, what the command requires is not established.",
  "The commands are not obligations the design states: never restate a command as an acceptance criterion, and never declare an artifact only because a command exists.",
  "A command that only reports a tool version depends on nothing and needs no decision.",
  "If neither the design nor files you can read establish that the declared artifacts satisfy every other command, even when the design names a stack, record exactly one open decision in the form stated above, with severity high and a question that begins",
  "asking what each such command requires and which declared artifact paths that needs.",
  "That is the one further kind of open decision this section admits.",
];

/**
 * The spec reconcile prompt's rule for that question, split around its
 * backticked words for the same reason. The prompt routes it `upstream_blocking`
 * as a rule the model may not follow: nothing checks the route.
 */
const RECONCILE_VERIFICATION_SENTENCES = [
  "A finding whose subject reads",
  "is an open decision you disclosed about the verification commands, and it is the one exception to the upstream_blocking test above: choose upstream_blocking for it, because the commands decide whether the delivered code is accepted at all.",
  "For that finding, begin the question's text with",
  "and make each option name the stack or layout the commands would then accept and the declared artifact paths that needs, each path written exactly as it would be declared, as an answer that can be folded into the specification as it stands.",
  "Never restate a command as an acceptance criterion.",
];

/**
 * The implementer's two lines, which follow the block. The implementer is the one
 * agent that can read the repository the commands run against, so it is told to
 * read what each runs; it is not given a way to refuse.
 */
const IMPLEMENTER_VERIFICATION_SENTENCES = [
  "These commands first run after the last phase, and again after any code-review remediation, so a phase that leaves one of them failing is not by itself a defect.",
  "Before you choose a file's content, read what each command runs (for an npm command, its entry under scripts in package.json) and write files that command will accept.",
];

/**
 * The plan prompts' one rule: no task that runs the commands. The system runs them
 * itself, and a task that changes no file in the approved scope can leave its phase
 * with nothing to return, which blocks the run (hazard 20): the implementation
 * stage blocks only when the whole phase returns no patch, so the sentence says
 * "can", not "does". The reconcile prompt forbids an addition and never tells the
 * reconciler to remove a task.
 */
const PLAN_DRAFT_VERIFICATION_SENTENCE =
  "The system runs these commands itself: never write a task that runs, repeats or checks them, because a task that changes no file in the approved scope can leave an implementation phase with nothing to return, and that blocks the run.";
const PLAN_RECONCILE_VERIFICATION_SENTENCE =
  "The system runs these commands itself: never add a task that runs, repeats or checks them, because a task that changes no file in the approved scope can leave an implementation phase with nothing to return, and that blocks the run.";

/** The spec decision fold prompt's rule for an answer to that question. */
const FOLD_VERIFICATION_SENTENCES = [
  "An answer to a question that begins",
  "may name a stack, a layout and declared artifact paths: fold exactly the paths it names into ## Declared artifacts, grounded in that answer, and nothing the answer does not state.",
  "Never restate a command as an acceptance criterion.",
];

/**
 * The remediation prompt's two rules (docs/features/implementation-self-review/plan.md,
 * Task 2), from crew-chatter run 6: the re-read answers #208/#210, the sweep #209.
 * The sweep sentence is also a self-review rule, so one entry covers both builders.
 */
const REMEDIATION_REREAD_RULE =
  "Before you return, re-read every task in the approved plan and every acceptance criterion in the approved specification that governs the code you change: a fix that breaks one of them is not a fix, so find a change that keeps both.";
const SAME_DEFECT_SWEEP_RULE =
  "When you fix a defect, look for the same defect in every other file of the approved scope and fix it there too.";

/** The phase prompt's task check (the same plan, Task 3). */
const PHASE_READ_BACK_RULE =
  "Before you return, read back each task of this phase, and each acceptance criterion whose line in the plan's Coverage section names a file you return, against the files you return, and correct any file that leaves one unmet.";

/** The reconcilers' dependent-sections rule (the same plan, Task 4), one per document. */
const SPEC_RECONCILE_DEPENDENTS_RULE =
  "When a change answers a finding, update every other part of the specification that change affects, such as another acceptance criterion, a declared artifact, or an open decision, so the revised specification stays consistent; each normative node that update adds or removes is claimed in normativeChanges like any other.";
const PLAN_RECONCILE_DEPENDENTS_RULE =
  "When a change answers a finding, update every other part of the plan that change affects, such as another task or a coverage line, so the revised plan stays consistent; each normative node that update adds or removes is claimed in normativeChanges like any other.";

/**
 * The self-review prompt's marker and rules (the same plan, Task 7). The marker is
 * what the stand-in emitter checks before it looks for a phase. The same-defect
 * sweep is SAME_DEFECT_SWEEP_RULE, shared with the remediation prompt.
 */
const SELF_REVIEW_MARKER = "This is your own self-review of the complete change, after the last phase.";
const SELF_REVIEW_RULES = [
  "Read back every task in the approved plan and every acceptance criterion in the approved specification against the code at this commit, and fix any that the code leaves unmet.",
  "Look for wrong results, unchecked input, races between requests, state left inconsistent after a failure, and errors that are caught and ignored, and fix each one you find.",
  SAME_DEFECT_SWEEP_RULE,
  "A fix that breaks a task or an acceptance criterion is not a fix: find a change that keeps both.",
  "Fix only with behavior the approved specification already requires; never add an obligation the specification does not state, however reasonable it looks.",
];
const SELF_REVIEW_REPLY_RULES = [
  "critique holds one entry per problem you found and what you did about it, or one entry saying what you checked when you found nothing.",
  "proposedPatches holds only the files whose content you change, each with its complete new content, and is [] when nothing needs fixing.",
  "Never return a file whose content you did not change.",
  "These commands run right after this review, and the first that fails blocks the run.",
];

/**
 * The three patch prompts' reply rule (docs/features/structured-patch-output/plan.md):
 * those dispatches run with --json-schema, and the free-text prompts' "Output the
 * JSON object directly" sentence made the 2026-10-14 large probe write its whole
 * answer twice (test/fixtures/recorded/json-schema-probe-gate.json).
 */
const STRUCTURED_OUTPUT_RULE =
  "Submit the JSON object once, through the structured output tool, and do not also write it out as text before or after: only the structured output is read.";

/** The three builders whose dispatches send --json-schema, with the reply rule they carry. */
function structuredPatchPrompts(): Array<{ name: string; prompt: string }> {
  const base = "b".repeat(40);
  return [
    { name: "phase", prompt: buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", ["src/a.ts"], base, ONLY_PHASE, [], VERIFICATION) },
    { name: "self-review", prompt: selfReviewPrompt() },
    { name: "remediation", prompt: buildCodeReviewRemediationPrompt(IMPLEMENTER, "# spec", "# plan", ["src/a.ts"], base, ["src/a.ts"], "DIFF", []) },
  ];
}

// The patch rules (baseCommit, the add/modify action enum, whole-file
// content, the no-deletion rule) arrived with the implementation stage —
// the step whose prompts request patches, exactly as this comment promised
// they would.
const CONSTRAINT_STRINGS = [
  "proposed",
  "blocked",
  "failed",
  "feature",
  "defect_fix",
  "## Declared artifacts",
  "## Acceptance criteria",
  "AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})",
  "never reuse an ID for a different criterion",
  "the run itself writes",
  "Never declare a tasks.md file",
  "low",
  "medium",
  "high",
  "critical",
  "lowercase kebab-case",
  "64",
  "proposedContentChanges.findings",
  // The plan document schema's constrained values. Still no patch rules: the
  // plan stage is a content write like the spec stage.
  "## Tasks",
  "Checkbox prefixes such as",
  "## Coverage",
  "Copy each canonical AC ID",
  "do not copy or paraphrase criterion prose",
  "not_applicable",
  "every line in ## Coverage is a normative node",
  "Do not casually edit, polish, or rephrase coverage entries",
  "proposedContentChanges.plan",
  // The patch rules the implementation prompt states.
  "proposedPatches",
  "baseCommit",
  "add",
  "modify",
  "deletion",
  "content",
  "A tasks.md path is prohibited",
  "JSON-standard escaping",
  "literal UTF-8",
  "\\uXXXX",
  "\\UXXXXXXXX",
  // Hazard 1, item 10: team-notes run 9 returned a 113,649-character patch with
  // one raw line break inside a string. The extractor now repairs that, and the
  // prompts state the rule so the model is told where the repair is a backstop.
  "Write every line break inside a JSON string",
  "never put a raw line break or tab inside a string literal",
  // The phase rules (docs/features/phased-implementation/plan.md, hazard 20).
  // One dispatch is one phase of the plan's tasks, and the model keeps no memory
  // between phases, so what each rule says is stated where it is requested. The
  // add-versus-modify rule is the one the patch applier enforces: add over an
  // existing file and modify over a missing one are both refused.
  "Implement only the tasks listed under",
  "Earlier phases are already committed in this checkout",
  "takes action modify with its complete new file content",
  "use action add only for a file that does not exist yet",
  // The existence lists (team-notes run 7, hazard 20): phase 4 proposed modify
  // for a scope path no phase had created.
  "take the action each list states, and never modify a path listed as not existing yet",
  "do not implement a task outside this phase",
  "Return at least one file",
  // The code-review contract's constrained fields. The severity rubric is
  // here because the gate compares severity against a threshold frozen in the
  // profile (hazard 3): a threshold over an unstated scale is a comparison
  // against nothing. `code-findings` is an output kind, not a prompt string,
  // so it is deliberately absent.
  "Changed paths:",
  "one of the changed paths below",
  "positive integer",
  "fails to implement an acceptance criterion",
  "small but concrete defect with localized impact",
  "reproducible impact",
  "optional refactoring",
  "speculative hardening",
  // The read-only constraint: hazard 3 applied to a constrained behaviour,
  // per docs/proposals/implementer-writes-files-it-also-proposes.md. The
  // sentence is UX, not a guard — enforcement is the invocation boundary
  // and the cleanliness gate.
  "read-only",
  // The self-critique contract's constrained fields (step 5b Task 4). The
  // panel request is a model-returned value reaching deterministic code, so
  // every rule it must obey is stated where it is requested.
  "proposedContentChanges.selfCritique",
  "panelRequest",
  "critique:",
  "artifact:",
  "size:",
  "specialties:",
  "no more of them than the size you request",
  "never an agent identity",
  "registered specialties",
  // The panel bounds Task 5 made binding. The default installation's only
  // legal size is two and the configured required lenses consume seats inside
  // it, so an author told neither would block a run on arithmetic it was never
  // given — hazard 3 names panel size explicitly.
  "A size outside that range blocks the run",
  "always seated and already consume seats",
  "must fit inside the size you request",
  // Two behaviours, not shapes. The first is the no-invention rule the
  // prototype watched an author break; the second says what happens to a
  // self-critique that produces an invalid document, so the model is not
  // told a fallback exists.
  "may not add an obligation",
  "fallback to your draft",
  // The reviewer contract Task 6 changed: the specialty-only reporting
  // boundary, the classification vocabulary, and the classification-
  // dependent location syntax. The empty-result sentence is restated so the
  // specialty boundary and the empty-result rule read as one rule.
  "Report only findings within your specialty",
  "must not be reported",
  "An empty findings array is a valid result",
  "classification",
  "current_artifact",
  "upstream",
  "upstream:design:",
  "upstream:specification:",
  "never require or invent a heading",
  "use that criterion's AC ID as the location",
  "use that entry's AC ID as the location",
  // The reconciliation contract's constrained fields, conditional where
  // used and forbidden elsewhere. Impact is derived, never model output, so
  // the sentence forbidding it is pinned too.
  "decisions",
  "exactly one entry per finding id",
  "addressed",
  "rejected_with_rationale",
  "upstream_follow_up",
  "upstream_blocking",
  "cannot_determine",
  "normativeChanges",
  "artifactText",
  "whyUpstream",
  "Do not return an impact field",
  // The per-disposition shapes. Measured 2026-09-26, $1.2429162 and
  // $2.141577: two note-keeper reconciliations each dropped a field an
  // upstream decision requires — changedLocations once, proposal once — while
  // the prompt advertised only an addressed-like entry.
  "changedLocations is required on every decision",
  "never omit the field",
  "prose in the document is not a proposal candidate",
  "Each decision takes exactly one of these complete shapes",
  // Hazard 17's obligation on the author, and hazard 3's reason it must be
  // stated here: the removal claim is a constrained field the validator
  // enforces, so a prompt silent about it guarantees a blocked paid run.
  "superseded half counts as a removed node",
  "Deleting an obligation is not a way to answer a finding",
  // The node form itself, which a paid run was measured failing without: an
  // author copied the artifact line, list marker and all, and every claim was
  // refused. Hazard 3 — the constraint belongs where the field is requested.
  "artifactText is the node",
  "Leave off the list marker",
  "does not authorize you to add an obligation",
  "Findings to reconcile",
  "none were reported this round",
  "cite its AC ID",
  // The conditional-field prohibitions: the validator refuses a field on
  // every disposition that does not list it, so the prompt must state the
  // allowed/forbidden matrix, not only what each disposition requires.
  "grounding is allowed only on rejected_with_rationale",
  "normativeChanges is",
  "proposal is allowed only on upstream_follow_up",
  "return no field at all that your disposition does not list",
  // The membership rule of each structured section, which is as much a
  // constrained field as the format of a value inside it. Measured
  // 2026-09-05, $0.41049: an author answering a finding about a gap in the
  // criterion numbering explained the gap as the first line under the
  // heading, the section admitted nothing but criteria and never said so,
  // and the run blocked terminally at the spec_review gate.
  "a path contains no whitespace",
  "one criterion and nothing else",
  "not inside this section",
  // The reviewer's half of the same incident: the gap the author was asked
  // to explain is the ordinary residue of the removal accounting, so a
  // reviewer told nothing about stable-ID semantics reports the correct
  // output of another guard as a defect.
  "not a sequence",
  "gap in the numbering is not by itself a finding",
  "never renumber criteria to close a gap",
  // The coverage line's one-artifact rule, and the reviewer rule that stops
  // the finding which provokes breaking it. Measured 2026-09-05, $1.25141:
  // three reviewers said a coverage entry omitted a second implementing
  // artifact, the author named both on one line, and the pair parsed as a
  // single path outside the signed scope.
  "names exactly one of them, copied verbatim",
  "list of paths is not a path",
  "needs a second artifact",
  "not a coverage finding",
  // The one-artifact rule must not withdraw the other legal coverage form.
  // Stated on the author side as the alternative, and on the reviewer side as
  // something that is not a defect.
  "takes the not_applicable form above",
  "says not_applicable with a",
  // What the single path *means*. Without it the rule is a shape with no
  // semantics, and an author asked for one path out of several contributing
  // files has no stated basis for choosing. All four plan prompts carry it.
  "representative delivery anchor",
  "most directly responsible for the criterion's observable outcome",
  "Several criteria may name the same path",
  "Report missing implementation work against the plan's tasks",
  // The audit instruction (Option C): instructs reviewers not to sample or
  // stop after early defects, increasing the likelihood of first-round
  // completeness before the single remediation dispatch.
  "Conduct an exhaustive audit across the entire diff and all changed paths within your specialty",
  "Do not stop after finding the first few defects or return only a sample of issues",
  "report every actionable defect you identify across all declared acceptance criteria and plan tasks",
  // The open-decisions section (docs/features/disclosed-open-decisions/plan.md):
  // its form, ID pattern and membership rule where a spec is requested, the
  // no-add rule where it is revised, and what the reviewer need not repeat.
  "## Open decisions",
  "OD-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})",
  "one open decision and nothing else",
  "must receive a typed decision before approval",
  "never add a new entry during this revision",
  "an open decision you disclosed",
  "already recorded as a finding",
  // The blocking criterion (docs/features/spec-review-blocking-criterion/plan.md):
  // ARCHITECTURE.md section 13 blocks only when the approved input is not
  // implementable. Measured 2026-09-27, $1.4078: team-notes run 1 blocked on
  // two questions about exceeding a baseline the design already stated.
  "List only a decision the design needs and does not make",
  "beyond what the design asks for is not an open decision",
  "choose upstream_blocking only when the design states a behavior",
  "the design is implementable as written: choose upstream_follow_up",
  "does not by itself make a finding blocking",
  // The operator question (docs/features/spec-operator-decisions/plan.md): a
  // constrained object whose option count and index range the validator
  // enforces, stated where the spec reconcile prompt requests it.
  "question for the operator",
  "options holds 2 to 4 entries",
  "zero-based",
  "question is allowed only on upstream_blocking and cannot_determine",
  // The decision fold's contract: one addressed decision per folded answer,
  // grounded in the design or that same finding's answer, and the denied
  // open decisions left exactly as written.
  "disposition is always addressed",
  "never in another finding's answer",
  "Denied questions stay open",
  "for a denied question stays exactly as written",
  // The frozen verification commands and the spec author's rule for them
  // (docs/features/verification-aware-prompts/plan.md, hazard 21). Measured
  // 2026-10-05, $7.3048866: team-notes run 10 delivered a layout its own
  // frozen `npm run build` could not accept, because no prompt said the
  // commands existed.
  ...VERIFICATION_BLOCK_SENTENCES,
  ...SPEC_VERIFICATION_SENTENCES,
  ...RECONCILE_VERIFICATION_SENTENCES,
  ...FOLD_VERIFICATION_SENTENCES,
  ...IMPLEMENTER_VERIFICATION_SENTENCES,
  PLAN_DRAFT_VERIFICATION_SENTENCE,
  PLAN_RECONCILE_VERIFICATION_SENTENCE,
  // The design split's rules (docs/features/design-split-into-features/plan.md):
  // every rule validateDesignSplit enforces is stated where the split is requested.
  "proposedContentChanges.split",
  "differs from every other piece's slug",
  "is in exactly one piece",
  "A file may be listed in several pieces",
  "distinct declared files",
  "dependsOn lists the 1-based positions of earlier pieces",
  // The implementation self-review plan's prompt rules
  // (docs/features/implementation-self-review/plan.md, Tasks 2-4), from crew-chatter
  // run 6. Kept above the criterion-quality block: CRITERION_QUALITY_RULE slices
  // this list from its end.
  REMEDIATION_REREAD_RULE,
  SAME_DEFECT_SWEEP_RULE,
  PHASE_READ_BACK_RULE,
  SPEC_RECONCILE_DEPENDENTS_RULE,
  PLAN_RECONCILE_DEPENDENTS_RULE,
  SELF_REVIEW_MARKER,
  ...SELF_REVIEW_RULES,
  ...SELF_REVIEW_REPLY_RULES,
  // The structured-output reply rule (docs/features/structured-patch-output/plan.md),
  // also kept above the criterion-quality block.
  STRUCTURED_OUTPUT_RULE,
  // What a criterion may say (docs/features/spec-criterion-testability/plan.md).
  // Measured 2026-09-27, $1.6186: team-notes run 3 copied the design's
  // "meaningful content change" into AC-041, and its tone guidance reached
  // review with no home, where it became the finding that blocked the run.
  "Every acceptance criterion must be decidable by one objective pass/fail check: a specific input, action, value, or observable outcome, never a subjective or unquantified term such as fast, meaningful, intuitive, or clean.",
  "Where the design states a behavior in subjective or unquantified terms, write only its checkable part as a criterion, and record the undecided part under ## Open decisions instead of choosing a threshold the design does not state.",
  "Guidance with no checkable part, such as visual tone or typographic feel, belongs in an Out of scope note, not in a criterion.",
  // The code-review reconciler's checked fields (docs/features/code-review-reconciler/plan.md):
  // the excerpt is checked against the specification and every listed finding
  // needs exactly one decision. Both sentences are the measured template's own.
  "A rejection must quote that baseline: words copied exactly from the approved specification, which the system checks.",
  "The decisions list has exactly one entry per finding id listed below, no more and no fewer.",
];

/** The criterion-quality rule, asserted per prompt: two builders carry it. */
const CRITERION_QUALITY_RULE = CONSTRAINT_STRINGS.slice(-5, -2);

test("every constrained field's constraint appears in the prompt source", () => {
  for (const constraint of CONSTRAINT_STRINGS) {
    assert.ok(source.includes(constraint), `prompt source is missing the constraint: ${constraint}`);
  }
});

test("the generated author prompt states the schema constraints", () => {
  const prompt = buildSpecAuthorPrompt(SPEC_AUTHOR, "design text", VERIFICATION);
  for (const constraint of [
    "proposed, blocked, failed",
    "## Declared artifacts",
    "the run itself writes",
    "Never declare a tasks.md file",
    "feature, defect_fix",
    "AC-001: <criterion text>",
    "beginning at AC-001 and increasing monotonically",
    "No git operations",
    "Output the JSON object",
    // Both section membership rules reach the generated prompt, not only the
    // source: the author is told what each section admits, not just how one
    // entry inside it is shaped.
    "a path contains no whitespace",
    "one criterion and nothing else",
    "not inside this section",
    "## Open decisions",
    "- OD-001 (high): <the question the design leaves open>",
    "one open decision and nothing else",
    "must receive a typed decision before approval",
    "List only a decision the design needs and does not make",
    "beyond what the design asks for is not an open decision",
    ...CRITERION_QUALITY_RULE,
  ]) {
    assert.ok(prompt.includes(constraint), `author prompt missing: ${constraint}`);
  }
});

test("the generated spec reviewer prompt states the finding constraints and names the agent", () => {
  const prompt = buildSpecReviewPrompt(SPEC_REVIEWER_TRACEABILITY, "DESIGN-TEXT", "# spec");
  for (const constraint of [
    "spec reviewer spec-reviewer-traceability",
    "low, medium, high, critical",
    "lowercase kebab-case",
    "64",
    "proposedContentChanges.findings",
    // The specialty boundary and the classification contract Task 6 added.
    "Report only findings within your specialty: requirements-traceability",
    "must not be reported",
    "An empty findings array is a valid result",
    "current_artifact",
    "upstream:design:",
    "use that criterion's AC ID as the location",
    "never require or invent a heading",
    // Stable-ID semantics: a gap is the residue of a claimed removal, not a
    // defect, so the reviewer is told before it can report one.
    "not a sequence",
    "gap in the numbering is not by itself a finding",
    // Disclosed open decisions are already findings; omissions still are not.
    "already recorded as a finding",
    "Report a decision the design needs but does not make that the section omits as an upstream finding",
  ]) {
    assert.ok(prompt.includes(constraint), `reviewer prompt missing: ${constraint}`);
  }
  // The design is the governing input the spec reviewer judges against, and
  // it is what makes an upstream classification citable at all.
  assert.ok(prompt.includes("DESIGN-TEXT"), "the design reaches the spec reviewer");
  assert.ok(prompt.includes("# spec"), "the specification under review travels with it");
});

test("the generated plan author prompt states the schema, the hash, and the scope", () => {
  const specHash = "a".repeat(64);
  const prompt = buildPlanAuthorPrompt(PLAN_AUTHOR, "# spec", specHash, [
    "src/thing.ts",
    "test/thing.test.ts",
  ], VERIFICATION);
  for (const constraint of [
    "proposed, blocked, failed",
    "## Tasks",
    "Checkbox prefixes such as",
    "## Coverage",
    "not_applicable requires both a rationale and an alternative verification",
    "Copy each canonical AC ID",
    "do not copy or paraphrase criterion prose",
    "proposedContentChanges",
    "No git operations",
    "Output the JSON object",
    // The coverage line's one-artifact rule, asserted per prompt: three
    // builders carry it and the whole-file scan passes while any one of them
    // still does.
    "names exactly one of them, copied verbatim",
    "list of paths is not a path",
    "takes the not_applicable form above",
    "representative delivery anchor",
    "most directly responsible for the criterion's observable outcome",
  ]) {
    assert.ok(prompt.includes(constraint), `plan author prompt missing: ${constraint}`);
  }
  // The hash is handed to the model, not left to it to compute: it is what
  // binds the plan to the specification the operator signed.
  assert.ok(prompt.includes(`plan_for must be exactly: ${specHash}`));
  // The signed scope is stated as the only paths the plan may promise.
  assert.ok(prompt.includes("- src/thing.ts"));
  assert.ok(prompt.includes("- test/thing.test.ts"));
});

test("the criterion examples advertised by emitting prompts validate against the receiving parsers", () => {
  const spec = validateSpecDoc(`feature: demo
change_kind: feature

## Declared artifacts

- src/a.ts

## Acceptance criteria

- AC-001: criterion text
`);
  assert.equal(spec.ok, true, spec.ok ? "" : spec.reason);

  const plan = validatePlanDoc(`feature: demo
plan_for: ${"a".repeat(64)}

## Tasks

- Build the criterion

## Coverage

- AC-001 -> src/a.ts
- AC-002 -> not_applicable: rationale / alternative verification
`);
  assert.equal(plan.ok, true, plan.ok ? "" : plan.reason);
});

test("the plan author prompt has no revision variant — reconciliation owns revision", () => {
  // The legacy revision variant left with the legacy revision dispatch
  // (Task 6). The author prompt drafts; the reconciliation prompt revises,
  // carrying findings with their reports and asking for typed decisions.
  const specHash = "a".repeat(64);
  const prompt = buildPlanAuthorPrompt(PLAN_AUTHOR, "# spec", specHash, ["src/a.ts"], VERIFICATION);
  assert.ok(!prompt.includes("## Revision"));
  assert.ok(!prompt.includes("Address"), "no legacy revision heading");
});

const PLAN_SCOPE = ["src/thing.ts", "test/thing.test.ts"];

/** The three plan builders that state the commands, each with the rule it carries. */
function planVerificationPrompts(verification: VerificationConfig): Array<{ name: string; prompt: string; sentence: string }> {
  const specHash = "a".repeat(64);
  return [
    { name: "plan author", prompt: buildPlanAuthorPrompt(PLAN_AUTHOR, "SPEC-TEXT", specHash, PLAN_SCOPE, verification), sentence: PLAN_DRAFT_VERIFICATION_SENTENCE },
    { name: "plan self-critique", prompt: buildPlanSelfCritiquePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", specHash, PLAN_SCOPE, PANEL, verification), sentence: PLAN_DRAFT_VERIFICATION_SENTENCE },
    { name: "plan reconcile", prompt: buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", specHash, PLAN_SCOPE, PAIR, verification), sentence: PLAN_RECONCILE_VERIFICATION_SENTENCE },
  ];
}

test("each plan prompt states the frozen commands and forbids a task that runs them, ahead of the approved specification", () => {
  for (const { name, prompt, sentence } of planVerificationPrompts(VERIFICATION)) {
    const at = (text: string): number => {
      const index = prompt.indexOf(text);
      assert.ok(index >= 0, `${name} prompt missing: ${text}`);
      return index;
    };
    assert.ok(prompt.includes(`\n\n${RUN_10_COMMAND_LINES.join("\n")}\n\n`), `${name}: the commands are one block, in order`);
    for (const blockSentence of VERIFICATION_BLOCK_SENTENCES) at(blockSentence);
    // The rule follows the block directly and the approved specification follows the rule.
    at(`${VERIFICATION_BLOCK_SENTENCES[2]}\n${sentence}\n\nApproved specification:\n\n`);
    assert.ok(at(RUN_10_COMMAND_LINES[2]!) < at(sentence), `${name}: commands, then the rule`);
    // The emitter reads the scope as the list after `name only these:`, up to the
    // first blank line, and the criteria as everything after the first
    // `Approved specification:`: neither may move.
    assert.deepEqual(/name only these:\n\n([\s\S]*?)\n\n/.exec(prompt)![1]!.split("\n"), PLAN_SCOPE.map((p) => `- ${p}`), name);
    assert.equal(prompt.split("Approved specification:").length, 2, `${name}: one specification marker`);
    // The emitter routes over the whole prompt: `self-critique` first, then `plan reviewer`.
    assert.ok(!prompt.includes("plan reviewer"), `${name} carries the routing words plan reviewer`);
    if (name !== "plan self-critique") assert.ok(!prompt.includes("self-critique"), `${name} carries the routing word self-critique`);
  }
  // The reconcile prompt keeps the finding-id scrape intact: PAIR holds finding 7 only.
  const reconcile = planVerificationPrompts(VERIFICATION)[2]!.prompt;
  assert.deepEqual([...reconcile.matchAll(/finding (\d+)/g)].map((m) => Number(m[1])), [7]);
  // An addition is forbidden; nothing tells the reconciler to take a task out.
  assert.ok(!/remov|delet|drop/i.test(PLAN_RECONCILE_VERIFICATION_SENTENCE));
});

test("each plan prompt follows the config it is given", () => {
  const other: VerificationConfig = { commands: [{ name: "smoke", command: ["node", "--version"] }] };
  const recorded = planVerificationPrompts(VERIFICATION);
  const changed = planVerificationPrompts(other);
  for (const [index, { name, prompt }] of changed.entries()) {
    assert.notEqual(prompt, recorded[index]!.prompt, `${name} ignores its verification argument`);
    assert.ok(prompt.includes("\n\n- smoke: node --version\n\n"), `${name} names the supplied command`);
    for (const line of RUN_10_COMMAND_LINES) assert.ok(!prompt.includes(line), `${name} still carries ${line}`);
  }
});

test("the generated plan reviewer prompt states the finding constraints and names the agent", () => {
  const prompt = buildPlanReviewPrompt(SPEC_REVIEWER_TRACEABILITY, "# plan", "# spec");
  for (const constraint of [
    "plan reviewer spec-reviewer-traceability",
    "low, medium, high, critical",
    "lowercase kebab-case",
    "64",
    "proposedContentChanges.findings",
    // The same specialty boundary and classification contract the spec
    // reviewer prompt carries, with the plan's own upstream source.
    "Report only findings within your specialty: requirements-traceability",
    "must not be reported",
    "An empty findings array is a valid result",
    "current_artifact",
    "upstream:specification:",
    "use that entry's AC ID as the location",
    "never require or invent a heading",
    // What the coverage relation can express, so the reviewer does not ask
    // for a change the document forbids and the author cannot make. The
    // not_applicable clause is asserted because this is the only plan prompt
    // that never restates the document schema: without it, the sentence below
    // is the whole description of a coverage line a reviewer ever receives,
    // and it would read as forbidding a legitimate entry.
    "Coverage is one line per criterion",
    "says not_applicable with a",
    "Several criteria may name the same artifact",
    "representative delivery anchor",
    "not a coverage finding",
    // The redirect, not a silence: a criterion the plan genuinely fails to
    // deliver must still be reportable, against the tasks that would deliver
    // it.
    "Report missing implementation work against the plan's tasks",
  ]) {
    assert.ok(prompt.includes(constraint), `plan reviewer prompt missing: ${constraint}`);
  }
  // Both documents reach the reviewer: judging coverage needs the criteria.
  assert.ok(prompt.includes("# plan"));
  assert.ok(prompt.includes("# spec"));
  // The rule about what coverage can express must not read as "report fewer
  // coverage findings": the sentence asking for exactly that judgement stays,
  // and the enumeration of what a coverage finding *is* travels with it.
  assert.ok(prompt.includes("actually deliver the specification's acceptance criteria"));
  assert.ok(prompt.includes("names a criterion the plan does not deliver"));
});

/** One phase of one: what a plan of at most one phase's tasks gets. */
const ONLY_PHASE: PlanPhase = { index: 1, count: 1, firstTask: 1, tasks: ["Build the thing"] };

test("the generated implementation author prompt states the patch contract", () => {
  const baseCommit = "b".repeat(40);
  const prompt = buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", [
    "src/a1.ts",
    "test/a1.test.ts",
  ], baseCommit, ONLY_PHASE, [], VERIFICATION);
  for (const constraint of [
    "proposed, blocked, failed",
    "proposedPatches",
    "action one of add, modify",
    "deletion is refused by the system",
    "complete new file content",
    "A tasks.md path is prohibited",
    "Run no git commands",
    "This checkout is read-only for you",
    "Patch only these paths:",
    STRUCTURED_OUTPUT_RULE,
    "JSON-standard escaping",
    "literal UTF-8",
    "\\uXXXX",
    "\\UXXXXXXXX",
    // Asserted per prompt: the remediation prompt carries its own copy, and the
    // whole-file scan passes while either one still does.
    "Write every line break inside a JSON string, including each line break of a file's content, as `\\n` and every tab as `\\t`; never put a raw line break or tab inside a string literal.",
  ]) {
    assert.ok(prompt.includes(constraint), `implementation author prompt missing: ${constraint}`);
  }
  // The base commit is handed to the model, not left to it to compute: it is
  // what the system verifies every proposed patch against.
  assert.ok(prompt.includes(`baseCommit must be exactly: ${baseCommit}`));
  // The signed scope is stated as the only paths a patch may touch, one
  // `- <path>` line per entry.
  assert.ok(prompt.includes("- src/a1.ts"));
  assert.ok(prompt.includes("- test/a1.test.ts"));
});

test("the implementation prompt names its phase, lists that phase's tasks verbatim, and states the phase rules", () => {
  const phase: PlanPhase = {
    index: 2,
    count: 6,
    firstTask: 11,
    tasks: ["src/server/auth.ts: implement sessions.", "src/server/auth.ts: implement password reset."],
  };
  const prompt = buildImplementationAuthorPrompt(IMPLEMENTER, "PLAN-TEXT", "SPEC-TEXT", ["src/a.ts"], "b".repeat(40), phase, [], VERIFICATION);
  for (const text of [
    // The exact sentence the fixture emitter scrapes to learn which phase it
    // is answering; changing it changes the fixture.
    "This is phase 2 of 6.",
    "tasks 11 through 12 of the approved plan",
    "Earlier phases are already committed in this checkout",
    "Later phases will implement the remaining tasks, so do not implement a task outside this phase",
    "A file that already exists in the checkout takes action modify with its complete new file content; use action add only for a file that does not exist yet.",
    "Return at least one file",
    "Tasks for this phase (tasks 11 through 12 of the approved plan):",
    "- src/server/auth.ts: implement sessions.",
    "- src/server/auth.ts: implement password reset.",
    // The whole plan and the specification travel with every phase.
    "PLAN-TEXT",
    "SPEC-TEXT",
  ]) {
    assert.ok(prompt.includes(text), `phase 2 of 6 prompt missing: ${text}`);
  }
  // The phase's tasks come before the whole plan, so the model reads what it
  // is to do before the document it is one slice of.
  assert.ok(prompt.indexOf("Tasks for this phase") < prompt.indexOf("Approved plan:"));
  // The scope block the fixture scrapes still ends at its first blank line,
  // with the phase's task list after it, not inside it.
  const scope = /Patch only these paths:\n\n([\s\S]*?)\n\n/.exec(prompt);
  assert.ok(scope, "the scope block must stay scrapable");
  assert.deepEqual(scope![1]!.split("\n"), ["- src/a.ts"]);
  assert.equal(/This is phase (\d+) of (\d+)\./.exec(prompt)!.slice(1).join("/"), "2/6");
});

test("the implementation prompt splits the scope into paths that exist (modify) and paths that do not (add)", () => {
  const scope = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const phase: PlanPhase = { index: 4, count: 8, firstTask: 31, tasks: ["src/c.ts: implement it."] };
  const prompt = buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", scope, "b".repeat(40), phase, ["src/a.ts", "src/c.ts"], VERIFICATION);
  // Read the two lists the way the fixture emitter does: the block after each
  // heading, up to the next blank line.
  const list = (heading: string): string[] =>
    /\n\n([\s\S]*?)\n\n/.exec(prompt.slice(prompt.indexOf(heading) + heading.length))![1]!.split("\n");
  assert.deepEqual(list("these exist in the checkout now, so each takes action modify:"), ["- src/a.ts", "- src/c.ts"]);
  assert.deepEqual(list("these do not exist yet, so each takes action add:"), ["- src/b.ts"]);
  // Both lists come after the scope list and before the phase's tasks, and the
  // scope block the emitters scrape still ends at its first blank line.
  assert.ok(prompt.indexOf("Patch only these paths:") < prompt.indexOf("these exist in the checkout now"));
  assert.ok(prompt.indexOf("these do not exist yet") < prompt.indexOf("Tasks for this phase (tasks"));
  assert.deepEqual(/Patch only these paths:\n\n([\s\S]*?)\n\n/.exec(prompt)![1]!.split("\n"), scope.map((p) => `- ${p}`));
  // An empty side is stated as `none.`, not left as a heading with nothing under it.
  const none = buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", scope, "b".repeat(40), phase, [], VERIFICATION);
  assert.ok(none.includes("so each takes action modify:\n\nnone.\n\n"));
  const all = buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", scope, "b".repeat(40), phase, scope, VERIFICATION);
  assert.ok(all.includes("so each takes action add:\n\nnone.\n\n"));
});

test("the first phase claims no earlier work, the last claims no later work, and a lone phase claims neither", () => {
  const prompts = {
    first: buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", ["src/a.ts"], "b".repeat(40), { index: 1, count: 3, firstTask: 1, tasks: ["a"] }, [], VERIFICATION),
    last: buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", ["src/a.ts"], "b".repeat(40), { index: 3, count: 3, firstTask: 21, tasks: ["z"] }, [], VERIFICATION),
    only: buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", ["src/a.ts"], "b".repeat(40), ONLY_PHASE, [], VERIFICATION),
  };
  // A sentence telling the first phase that earlier phases are committed, or
  // the last that later phases follow, is a false statement the model acts on.
  assert.ok(!prompts.first.includes("Earlier phases are already committed"));
  assert.ok(prompts.first.includes("Later phases will implement"));
  assert.ok(prompts.last.includes("Earlier phases are already committed"));
  assert.ok(!prompts.last.includes("Later phases will implement"));
  assert.ok(!prompts.only.includes("Earlier phases are already committed"));
  assert.ok(!prompts.only.includes("Later phases will implement"));
  // The add-versus-modify rule is true of every phase: a target may already
  // hold files, so it is not conditional on the phase number.
  for (const [name, prompt] of Object.entries(prompts)) {
    assert.ok(prompt.includes("use action add only for a file that does not exist yet"), name);
    assert.ok(prompt.includes("This is phase "), name);
    // The task check before returning (implementation-self-review Task 3) is true of every phase.
    assert.ok(prompt.includes(PHASE_READ_BACK_RULE), `${name} phase prompt missing the read-back rule`);
  }
});

test("the implementation prompt states the frozen commands after the path lists and before the tasks, and the scraped blocks stay clean", () => {
  const scope = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const phase: PlanPhase = { index: 2, count: 3, firstTask: 11, tasks: ["src/c.ts: implement it."] };
  const prompt = buildImplementationAuthorPrompt(IMPLEMENTER, "PLAN-TEXT", "SPEC-TEXT", scope, "b".repeat(40), phase, ["src/a.ts"], VERIFICATION);
  const at = (text: string): number => {
    const index = prompt.indexOf(text);
    assert.ok(index >= 0, `implementation prompt missing: ${text}`);
    return index;
  };
  assert.ok(prompt.includes(`\n\n${RUN_10_COMMAND_LINES.join("\n")}\n\n`), "the commands are one block, in order");
  for (const sentence of [...VERIFICATION_BLOCK_SENTENCES, ...IMPLEMENTER_VERIFICATION_SENTENCES]) at(sentence);
  // The block and the two lines are one paragraph, then the phase's tasks.
  at(`${VERIFICATION_BLOCK_SENTENCES[2]}\n${IMPLEMENTER_VERIFICATION_SENTENCES.join("\n")}\n\nTasks for this phase (tasks 11 through 11`);
  assert.ok(at("these do not exist yet, so each takes action add:") < at(VERIFICATION_BLOCK_SENTENCES[0]!));
  assert.ok(at(IMPLEMENTER_VERIFICATION_SENTENCES.at(-1)!) < at("Tasks for this phase (tasks"));
  // The emitter reads the scope block and both lists as the text after a heading
  // up to the first blank line. No command line may fall inside any of them.
  const blockAfter = (heading: string): string[] =>
    /\n\n([\s\S]*?)\n\n/.exec(prompt.slice(at(heading) + heading.length))![1]!.split("\n");
  for (const heading of [
    "Patch only these paths:",
    "these exist in the checkout now, so each takes action modify:",
    "these do not exist yet, so each takes action add:",
  ]) {
    const scraped = blockAfter(heading);
    assert.ok(scraped.every((line) => line === "none." || scope.includes(line.slice(2))), `${heading} holds only paths: ${scraped.join(" | ")}`);
    for (const line of RUN_10_COMMAND_LINES) assert.ok(!scraped.includes(line), `${heading} holds a command line`);
  }
  // The values the emitter scrapes once each: the base commit and the phase.
  assert.equal([...prompt.matchAll(/baseCommit must be exactly: [0-9a-f]{40}/g)].length, 1);
  assert.equal([...prompt.matchAll(/This is phase (\d+) of (\d+)\./g)].length, 1);
});

test("the implementation prompt follows the config it is given", () => {
  const other: VerificationConfig = { commands: [{ name: "smoke", command: ["node", "--version"] }] };
  const build = (verification: VerificationConfig): string =>
    buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", ["src/a.ts"], "b".repeat(40), ONLY_PHASE, [], verification);
  const recorded = build(VERIFICATION);
  const changed = build(other);
  assert.notEqual(recorded, changed);
  assert.ok(changed.includes("\n\n- smoke: node --version\n\nA command passes only if"));
  for (const line of RUN_10_COMMAND_LINES) assert.ok(!changed.includes(line), `still carries ${line}`);
});

// --- implementation self-review (implementation-self-review Task 7) ---------

function selfReviewPrompt(verification: VerificationConfig = VERIFICATION): string {
  return buildImplementationSelfReviewPrompt(IMPLEMENTER, "PLAN-TEXT", "SPEC-TEXT", ["src/a.ts", "src/b.ts", "src/c.ts"],
    "d".repeat(40), ["src/a.ts", "src/c.ts"], ["src/a.ts", "src/c.ts"], "DIFF-TEXT", verification);
}

test("the self-review prompt states its marker and every rule, and is never a phase", () => {
  const prompt = selfReviewPrompt();
  assert.ok(prompt.startsWith(`${promptBuilders.IMPLEMENTATION_PROMPT_PREFIX} ${IMPLEMENTER.id}\n\n${SELF_REVIEW_MARKER}\n`));
  for (const text of [...SELF_REVIEW_RULES, ...SELF_REVIEW_REPLY_RULES, "This checkout is read-only for you",
    "Run no git commands", "JSON-standard escaping", "deletion is refused by the system", "A tasks.md path is prohibited"]) {
    assert.ok(prompt.includes(text), `self-review prompt missing: ${text}`);
  }
  // The emitter looks for a phase only after this marker, and a phase sentence here would route it as one.
  assert.ok(!prompt.includes("This is phase"), "the self-review prompt reads as a phase");
  // It is the author's own pass: no review vocabulary a reader could take as independence (hazard 14).
  for (const word of ["reviewer", "finding"]) assert.ok(!prompt.includes(word), `self-review prompt says ${word}`);
});

test("the self-review prompt names the last commit as the base and keeps the scraped blocks in the phase prompt's shape", () => {
  const prompt = selfReviewPrompt();
  assert.equal([...prompt.matchAll(/baseCommit must be exactly: ([0-9a-f]{40})/g)].map((m) => m[1]).join(), "d".repeat(40));
  assert.ok(prompt.includes(`Your working directory is the repository checkout at commit ${"d".repeat(40)}`));
  const blockAfter = (heading: string): string[] =>
    /\n\n([\s\S]*?)\n\n/.exec(prompt.slice(prompt.indexOf(heading) + heading.length))![1]!.split("\n");
  assert.deepEqual(/Patch only these paths:\n\n([\s\S]*?)\n\n/.exec(prompt)![1]!.split("\n"), ["- src/a.ts", "- src/b.ts", "- src/c.ts"]);
  assert.deepEqual(blockAfter("these exist in the checkout now, so each takes action modify:"), ["- src/a.ts", "- src/c.ts"]);
  assert.deepEqual(blockAfter("these do not exist yet, so each takes action add:"), ["- src/b.ts"]);
  assert.deepEqual(blockAfter("Changed paths:"), ["- src/a.ts", "- src/c.ts"]);
  // The commands follow the lists, then the plan and specification, and the diff comes last.
  assert.ok(prompt.includes(`\n\n${RUN_10_COMMAND_LINES.join("\n")}\n\n`), "the commands are one block, in order");
  assert.ok(prompt.indexOf("these do not exist yet") < prompt.indexOf(VERIFICATION_BLOCK_SENTENCES[0]!));
  assert.ok(prompt.indexOf("Approved plan:") < prompt.indexOf("Approved specification:"));
  assert.ok(prompt.endsWith(`Complete diff of the change through ${"d".repeat(40)}:\n\nDIFF-TEXT`));
  const other = selfReviewPrompt({ commands: [{ name: "smoke", command: ["node", "--version"] }] });
  assert.ok(other.includes("\n\n- smoke: node --version\n\n"));
  for (const line of RUN_10_COMMAND_LINES) assert.ok(!other.includes(line), `still carries ${line}`);
});

test("the result and selfReview the self-review prompt advertises validate against their receiving validators", () => {
  const prompt = selfReviewPrompt();
  const advertised = /Return exactly a JSON AgentResult object with this shape:\n(\{[^\n]+\})/.exec(prompt);
  assert.ok(advertised, "the prompt advertises one AgentResult shape");
  const parsed = JSON.parse(advertised![1]!);
  const result = validateAgentResult(IMPLEMENTER.id, parsed);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.value.status, "proposed");
  assert.deepEqual(result.value.proposedPatches, []);
  const selfReview = validateImplementationSelfReview((parsed.proposedContentChanges as { selfReview: unknown }).selfReview);
  assert.ok(selfReview.ok, selfReview.ok ? "" : selfReview.reason);
});

test("each patch prompt asks for one structured answer and no longer asks for the object as text", () => {
  for (const { name, prompt } of structuredPatchPrompts()) {
    assert.ok(prompt.includes(STRUCTURED_OUTPUT_RULE), `${name} prompt missing the structured-output rule`);
    assert.equal(prompt.split(STRUCTURED_OUTPUT_RULE).length, 2, `${name} prompt states the rule once`);
    assert.ok(!prompt.includes("Output the JSON object"), `${name} prompt still asks for the object as text`);
    // The rule sits between the advertised shape and the escaping lines it governs.
    assert.ok(prompt.indexOf("Return exactly a JSON AgentResult object with this shape:") < prompt.indexOf(STRUCTURED_OUTPUT_RULE), name);
    assert.ok(prompt.indexOf(STRUCTURED_OUTPUT_RULE) < prompt.indexOf("JSON-standard escaping"), name);
  }
  // The dispatches that still read free text keep their sentence and never get the rule.
  for (const prompt of [
    buildSpecAuthorPrompt(SPEC_AUTHOR, "DESIGN-TEXT", VERIFICATION),
    buildPlanAuthorPrompt(PLAN_AUTHOR, "# spec", "a".repeat(64), ["src/a.ts"], VERIFICATION),
    buildCodeReviewPrompt(CODE_REVIEWER_CORRECTNESS, "SPEC", "PLAN", ["src/a.ts"], "DIFF", "c".repeat(40)),
    buildDesignSplitPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", SPLIT_CONTEXT),
  ]) {
    assert.ok(prompt.includes("Output the JSON object"));
    assert.ok(!prompt.includes("structured output"));
  }
});

test("the phase prompts built from the recorded run 12 plan carry its own lines, each task with its detail lines under it", () => {
  // Run 12's author nested 173 detail lines under 53 tasks. The expected text is
  // the plan's Tasks section as written, read here without the parser.
  const RUN_12: { planMarkdown: string } = JSON.parse(
    readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "plan-team-notes-run-12.json"), "utf8")
  );
  const plan = validatePlanDoc(RUN_12.planMarkdown);
  assert.ok(plan.ok, plan.ok ? "" : plan.reason);
  const section = /\n## Tasks\n([\s\S]*?)\n## Coverage\n/.exec(RUN_12.planMarkdown);
  assert.ok(section, "the recorded plan has a Tasks section followed by Coverage");
  const written = section![1]!.split("\n").filter((line) => line.trim() !== "").map((line) => line.trimEnd());
  const phases = planPhases(plan.value.taskItems, 10);
  assert.equal(phases.length, 6);
  const blocks = phases.map((phase) => {
    const prompt = buildImplementationAuthorPrompt(IMPLEMENTER, "PLAN-TEXT", "SPEC-TEXT", ["src/a.ts"], "b".repeat(40), phase, [], VERIFICATION);
    const heading = `Tasks for this phase (tasks ${phase.firstTask} through ${phase.firstTask + phase.tasks.length - 1} of the approved plan):\n\n`;
    const start = prompt.indexOf(heading);
    assert.ok(start >= 0, `phase ${phase.index} prompt missing its task heading`);
    return prompt.slice(start + heading.length, prompt.indexOf("\n\nApproved plan:", start));
  });
  // A phase never opens on a detail line: its first line is a top-level task.
  for (const block of blocks) assert.ok(/^- \S/.test(block), `a phase opens on: ${block.split("\n")[0]}`);
  // In order, the blocks are the plan's lines: nothing lost, repeated or reordered.
  assert.deepEqual(blocks.join("\n").split("\n"), written);
});

test("the generated spec self-critique prompt states the contract and carries both governing inputs", () => {
  // Both inputs travel: the design is the ceiling on what the author may
  // require, the specification is what it is revising. A prompt with only one
  // of them asks for a judgement the model has no basis to make.
  const prompt = buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PANEL, VERIFICATION);
  for (const constraint of [
    "proposedContentChanges.selfCritique",
    "proposed, blocked, failed",
    "the run itself writes",
    "Never declare a tasks.md file",
    "panelRequest",
    "never an agent identity",
    "may not add an obligation",
    "fallback to your draft",
    "Preserve each existing ID",
    "Output the JSON object",
    // The section membership rules, asserted per prompt for the same reason
    // the panel bounds are: three builders carry them, and the whole-file
    // scan above passes while any one of them still does.
    "a path contains no whitespace",
    "one criterion and nothing else",
    "not inside this section",
    "never renumber criteria to close a gap",
    // Asserted here and again on the plan prompt, per prompt rather than per
    // file: both prompts carry these sentences, and the whole-file scan above
    // cannot tell which one dropped it.
    "at least 2",
    "at most 3",
    "A size outside that range blocks the run",
    "always seated and already consume seats",
    "      - requirements-traceability",
    "must fit inside the size you request",
    "one open decision and nothing else",
    "Where the design needs a decision it does not make, record it under ## Open decisions rather than deciding it yourself",
    "List only a decision the design needs and does not make",
    "beyond what the design asks for is not an open decision",
    ...CRITERION_QUALITY_RULE,
    // The pass is where the author applies the rule to what it already wrote.
    "Check every acceptance criterion against the pass/fail rule stated with the ## Acceptance criteria schema above and rewrite, split, or move any criterion that fails it.",
  ]) {
    assert.ok(prompt.includes(constraint), `spec self-critique prompt missing: ${constraint}`);
  }
  assert.ok(prompt.includes("DESIGN-TEXT"), "the design is the governing input");
  assert.ok(prompt.includes("SPEC-TEXT"), "the specification being critiqued travels with it");
  // The registry's lenses are named. Not telling the author what can be
  // staffed made the Task 1 prototype's author request an unstaffable
  // specialty, and the run blocked by name on a request it had no way to get
  // right.
  assert.ok(prompt.includes("- consistency"));
  assert.ok(prompt.includes("- security"));
  assert.ok(!prompt.includes("data-privacy"), "no specialty the caller did not supply");
});

test("the spec self-critique prompt is not the author prompt", () => {
  // Hazard 7 in the small: two dispatches under one agent and one model that
  // sent the same bytes would be paying twice for one answer.
  const author = buildSpecAuthorPrompt(SPEC_AUTHOR, "DESIGN-TEXT", VERIFICATION);
  const critique = buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PANEL, VERIFICATION);
  assert.notEqual(author, critique);
  assert.ok(!author.includes("selfCritique"), "the draft prompt asks for a spec, not a critique");
});

test("both spec draft prompts state the frozen commands in order, then the rule for them, ahead of the design", () => {
  // The expected lines are the ones the recorded governed.yaml declares; this
  // pins that the fixture still declares them, so a changed fixture cannot
  // leave the literals below describing a different config.
  assert.deepEqual(
    VERIFICATION.commands.map(({ name }) => name),
    ["typecheck", "lint", "build"]
  );
  const prompts = {
    author: buildSpecAuthorPrompt(SPEC_AUTHOR, "DESIGN-TEXT", VERIFICATION),
    selfCritique: buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PANEL, VERIFICATION),
  };
  for (const [name, prompt] of Object.entries(prompts)) {
    const at = (text: string): number => {
      const index = prompt.indexOf(text);
      assert.ok(index >= 0, `${name} prompt missing: ${text}`);
      return index;
    };
    // One block, one line per command, in the frozen order.
    assert.ok(
      prompt.includes(`\n\n${RUN_10_COMMAND_LINES.join("\n")}\n\n`),
      `${name} prompt lists the commands as one block in order`
    );
    for (const sentence of [...VERIFICATION_BLOCK_SENTENCES, ...SPEC_VERIFICATION_SENTENCES]) at(sentence);
    // The marker sentence whole, with the backticked word the later passes look for.
    at("a question that begins `Verification:`, asking what each such command requires");
    // The rule says "the form stated above", so the form is stated first: the
    // open-decisions schema, then the commands, then the rule, then the design.
    assert.ok(at("- an optional ## Open decisions section") < at(VERIFICATION_BLOCK_SENTENCES[0]!));
    assert.ok(at(VERIFICATION_BLOCK_SENTENCES[0]!) < at(RUN_10_COMMAND_LINES[0]!));
    assert.ok(at(RUN_10_COMMAND_LINES[2]!) < at(SPEC_VERIFICATION_SENTENCES[0]!));
    assert.ok(at(SPEC_VERIFICATION_SENTENCES.at(-1)!) < at("Design document:"));
  }
});

test("the verification lines follow the config a builder is given, not a fixed one", () => {
  const other: VerificationConfig = { commands: [{ name: "smoke", command: ["node", "--version"] }] };
  const builds: Array<[string, (verification: VerificationConfig) => string]> = [
    ["author", (v) => buildSpecAuthorPrompt(SPEC_AUTHOR, "DESIGN-TEXT", v)],
    ["selfCritique", (v) => buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PANEL, v)],
  ];
  for (const [name, build] of builds) {
    const recorded = build(VERIFICATION);
    const changed = build(other);
    assert.notEqual(recorded, changed, `${name} prompt ignores its verification argument`);
    assert.ok(changed.includes("\n\n- smoke: node --version\n\n"), `${name} prompt names the supplied command`);
    for (const line of RUN_10_COMMAND_LINES) {
      assert.ok(!changed.includes(line), `${name} prompt still carries the other config's line: ${line}`);
    }
    assert.ok(!recorded.includes("- smoke: node --version"), `${name} prompt carries a line it was not given`);
  }
});

test("a specification whose open decision begins Verification: is valid, so the question the rule asks for can be recorded", () => {
  // The form the spec author rule advertises, run through the receiving
  // validator (hazard 3): a question the rule asks for that the validator
  // refuses would block the run at the first spec dispatch.
  const spec = validateSpecDoc(`feature: demo
change_kind: feature

## Declared artifacts

- src/a.ts

## Acceptance criteria

- AC-001: criterion text

## Open decisions

- OD-001 (high): Verification: what does npm run build need, and which declared artifact paths does that need?
`);
  assert.ok(spec.ok, spec.ok ? "" : spec.reason);
  assert.deepEqual(spec.value.openDecisions, [
    {
      id: "OD-001",
      severity: "high",
      text: "Verification: what does npm run build need, and which declared artifact paths does that need?",
    },
  ]);
  // What the stage records as the finding's subject is what the reconcile
  // prompt then shows the reconciler; its rule names that form. The subject is
  // taken from the stage's own function, not written here.
  const [report] = disclosedOpenDecisionReports(spec.value);
  assert.ok(report!.subject.startsWith("OD-001: Verification: "), `the finding subject reads ${report!.subject}`);
});

test("fixture command data carries no word a stage emitter routes on", () => {
  // The stage emitters (test/fixtures/harness/emit-*-stage.mjs) route over the
  // whole prompt with includes(), so the commands rendered into every
  // verification-aware prompt are routing input. A command named
  // `self-critique` turns a spec draft into a self-critique reply. The design
  // text has the same exposure and the FIXTURE-* modes depend on it, so the
  // emitters are not changed; fixture command data has to stay clear instead.
  const markers = [
    "self-critique",
    "spec reviewer",
    "plan reviewer",
    "reconcile",
    "spec author",
    "plan author",
    "Operator answers to fold:",
    "FIXTURE-",
    "REVISED-",
  ];
  const clear = (label: string, text: string): void => {
    for (const marker of markers) {
      assert.ok(!text.toLowerCase().includes(marker.toLowerCase()), `${label} carries the routing marker ${marker}`);
    }
  };
  for (const { name, command } of VERIFICATION.commands) clear(`run 10 command ${name}`, [name, ...command].join("\n"));
  // Every verification constant a stage test freezes into a profile.
  for (const file of ["spec-stage", "spec-decision-stage", "plan-stage", "implementation-stage"]) {
    const text = readFileSync(join(process.cwd(), "test", `${file}.test.ts`), "utf8");
    const constants = [...text.matchAll(/const [A-Z_]*VERIFICATION[A-Z_]*\b[^;]*;/g)].map((m) => m[0]);
    assert.ok(constants.length > 0, `${file}.test.ts defines no verification constant for the guard to read`);
    for (const constant of constants) clear(`${file}.test.ts`, constant.replace(/^const [A-Z_]+\b[^=]*=/, ""));
  }
});

test("the generated plan self-critique prompt restates the hash and the scope it must still satisfy", () => {
  const specHash = "a".repeat(64);
  const prompt = buildPlanSelfCritiquePrompt(
    PLAN_AUTHOR,
    "SPEC-TEXT",
    "PLAN-TEXT",
    specHash,
    ["src/thing.ts", "test/thing.test.ts"],
    PANEL,
    VERIFICATION
  );
  for (const constraint of [
    "proposedContentChanges.selfCritique",
    "panelRequest",
    "## Tasks",
    "Checkbox prefixes such as",
    "## Coverage",
    "not_applicable requires both a rationale and an alternative verification",
    "may not add an obligation",
    "fallback to your draft",
    "Copy each canonical AC ID",
    // The plan side's own copy. Task 4 shipped a guard proven only on the spec
    // side once already; these two prompts are duplicated on purpose and
    // nothing structural notices a missing assertion on one of them.
    "at least 2",
    "at most 3",
    "A size outside that range blocks the run",
    "always seated and already consume seats",
    "      - requirements-traceability",
    "must fit inside the size you request",
    // The one-artifact rule, and the move that answers a second-artifact
    // critique without breaching it.
    "names exactly one of them, copied verbatim",
    "list of paths is not a path",
    "takes the not_applicable form above",
    "representative delivery anchor",
    "most directly responsible for the criterion's observable outcome",
    "needs a second artifact",
  ]) {
    assert.ok(prompt.includes(constraint), `plan self-critique prompt missing: ${constraint}`);
  }
  assert.ok(prompt.includes("SPEC-TEXT"), "the approved specification is the governing input");
  assert.ok(prompt.includes("PLAN-TEXT"), "the plan being critiqued travels with it");
  // The revised plan is gated exactly like the draft, so the two values the
  // gates bind are stated rather than left to be rediscovered.
  assert.ok(prompt.includes(`plan_for must be exactly: ${specHash}`));
  assert.ok(prompt.includes("- src/thing.ts"));
  assert.ok(prompt.includes("- test/thing.test.ts"));
});

test("every size a self-critique prompt advertises is one the validator accepts", () => {
  // Hazard 3's second sentence: "assert that every example value a prompt
  // advertises validates against the schema that receives it." Both the stated
  // floor and the example JSON are advertised sizes, and a model copies the
  // example. The configuration that broke this is the third one below —
  // required lenses outnumbering the floor, which `invalidPolicyReason`
  // permits — where the bare floor is a value guaranteed to be refused.
  for (const requiredSpecialties of [
    [],
    ["requirements-traceability"],
    ["requirements-traceability", "security", "consistency"],
  ]) {
    const bounds: PanelPromptBounds = {
      sizeMin: 2,
      sizeMax: 3,
      requiredSpecialties,
      registeredSpecialties: ["consistency", "security"],
    };
    const prompts = {
      spec: buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", bounds, VERIFICATION),
      plan: buildPlanSelfCritiquePrompt(
        PLAN_AUTHOR,
        "SPEC-TEXT",
        "PLAN-TEXT",
        "a".repeat(64),
        ["src/a.ts"],
        bounds,
        VERIFICATION
      ),
    };
    for (const [name, prompt] of Object.entries(prompts)) {
      const stated = Number(/at least (\d+)/.exec(prompt)![1]);
      const example = Number(/"size": (\d+)/.exec(prompt)![1]);
      assert.equal(
        example,
        stated,
        `${name} prompt advertises an example size the same prompt calls illegal`
      );
      const accepted = validatePanelRequest(
        { size: stated, specialties: [] },
        bounds.sizeMin,
        bounds.sizeMax,
        requiredSpecialties
      );
      assert.equal(
        accepted.ok,
        true,
        `${name} prompt advertises size ${stated} with ${requiredSpecialties.length} required lenses, which the validator refuses: ${
          accepted.ok ? "" : accepted.reason
        }`
      );
    }
  }
});

test("a configuration requiring no lens states no always-seated block", () => {
  // An empty required list is legal. A prompt that announced "these lenses are
  // always seated" and then listed nothing would be stating a constraint that
  // does not exist, which is the same defect as omitting one that does.
  const none: PanelPromptBounds = { ...PANEL, requiredSpecialties: [] };
  for (const prompt of [
    buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", none, VERIFICATION),
    buildPlanSelfCritiquePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], none, VERIFICATION),
  ]) {
    assert.ok(!prompt.includes("always seated"), "no always-seated block without required lenses");
    // The cap is still stated, just the simpler one: with no required lens the
    // author's own list is the whole set that has to fit.
    assert.ok(prompt.includes("no more of them than the size you request"));
    assert.ok(prompt.includes("at least 2"), "the size bound is stated either way");
    assert.ok(prompt.includes("A specialty outside that list cannot be staffed"));
  }
});

// --- reconciliation -----------------------------------------------------------

/** The mixed pair: one canonical finding carrying two unfused reports. */
const PAIR: ReconciliationFindingInput[] = [
  {
    findingId: 7,
    reports: [
      {
        reviewerId: "spec-reviewer-security",
        severity: "critical",
        classification: "current_artifact",
        location: "## Acceptance criteria",
        intentKey: "shared-concern",
        subject: "severe in-artifact concern",
      },
      {
        reviewerId: "spec-reviewer-traceability",
        severity: "low",
        classification: "upstream",
        location: "upstream:design:shared-concern",
        intentKey: "shared-concern",
        subject: "mild upstream concern",
      },
    ],
  },
];

test("the generated spec reconciliation prompt carries the decision contract and every report unfused", () => {
  const prompt = buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PAIR, VERIFICATION);
  for (const constraint of [
    "proposedContentChanges",
    "decisions",
    "exactly one entry per finding id",
    "addressed",
    "rejected_with_rationale",
    "upstream_follow_up",
    "upstream_blocking",
    "cannot_determine",
    "normativeChanges",
    "artifactText",
    "whyUpstream",
    "Do not return an impact field",
    // The per-disposition shapes, asserted per prompt: one builder renders
    // both, and the measured blocks came from this one.
    "changedLocations is required on every decision",
    "never omit the field",
    "prose in the document is not a proposal candidate",
    "Each decision takes exactly one of these complete shapes",
    // The node form for this artifact kind, asserted per prompt because the
    // two prompts state different forms and one builder renders both.
    "an acceptance criterion's node text is `AC-001: <criterion text>`",
    "Leave off the list marker",
    // The section membership rules, asserted per prompt: the whole-file scan
    // cannot tell which of the three builders carrying them dropped one, and
    // this is the builder the measured block came from.
    "a path contains no whitespace",
    "one criterion and nothing else",
    "not inside this section",
    "never renumber criteria to close a gap",
    // Both directions of the normative delta, asserted on this prompt rather
    // than only in the whole-file scan: the two reconciliation prompts render
    // from one contract builder, so a sentence missing from one of them would
    // be invisible to a scan that found it in the other.
    "superseded half counts as a removed node",
    "across the entire revision must be claimed",
    "Never duplicate or repeat the same node across multiple decisions",
    "Deleting an obligation is not a way to answer a finding",
    "source is always design",
    "does not authorize you to add an obligation",
    // Spec side only: a blocking decision asks the operator instead of
    // ending the run (spec-operator-decisions).
    "upstream_blocking pauses the run until the operator answers its question, upstream_follow_up does not",
    "question for the operator",
    "options holds 2 to 4 entries",
    "zero-based integer index",
    "question is allowed only on upstream_blocking and cannot_determine",
    // The conditional-field matrix: each disposition lists its fields, and the
    // validator refuses any field on a disposition that does not list it.
    "grounding is allowed only on rejected_with_rationale",
    "normativeChanges is",
    "proposal is allowed only on upstream_follow_up",
    "return no field at all that your disposition does not list",
    // The document schema the reconciled artifact must still satisfy.
    "## Declared artifacts",
    "the run itself writes",
    "Never declare a tasks.md file",
    "## Acceptance criteria",
    "Preserve each existing ID",
    "cite its AC ID",
    "Output the JSON object",
    "one open decision and nothing else",
    "never add a new entry during this revision",
    "A finding whose report comes from spec-author is an open decision you disclosed",
    // The blocking criterion lives only on the spec side (plan scope), so it is
    // asserted on this prompt rather than trusted to the whole-file scan.
    "choose upstream_blocking only when the design states a behavior",
    "no acceptance criterion for that behavior can be written",
    "the design is implementable as written: choose upstream_follow_up",
    "does not by itself make a finding blocking",
    "List only a decision the design needs and does not make",
  ]) {
    assert.ok(prompt.includes(constraint), `spec reconcile prompt missing: ${constraint}`);
  }
  // Both governing inputs travel, and the artifact under review.
  assert.ok(prompt.includes("DESIGN-TEXT"), "the design is the governing input");
  assert.ok(prompt.includes("SPEC-TEXT"), "the specification under review travels with it");
  // Both reports reach the reconciler with their severity and classification
  // intact — the pair is rendered unfused, each report its own line.
  assert.ok(
    prompt.includes("severity critical, classification current_artifact"),
    "the first report keeps its own severity and classification"
  );
  assert.ok(
    prompt.includes("severity low, classification upstream"),
    "the second report keeps its own severity and classification"
  );
  assert.ok(
    prompt.includes("location upstream:design:shared-concern"),
    "the upstream report's location token is intact"
  );
  assert.ok(
    !prompt.includes("severity critical, classification upstream"),
    "no fused severity/classification pair appears"
  );
});

test("the generated plan reconciliation prompt carries the spec as governing input and restates the binding values", () => {
  const specHash = "a".repeat(64);
  const prompt = buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", specHash, ["src/a.ts"], PAIR, VERIFICATION);
  for (const constraint of [
    "decisions",
    "source is always specification",
    "does not authorize you to add an obligation",
    "## Tasks",
    "Checkbox prefixes such as",
    "## Coverage",
    "not_applicable requires both a rationale and an alternative verification",
    "Copy each canonical AC ID",
    "cite its AC ID",
    "Do not return an impact field",
    // The plan side's own copy of the per-disposition shapes.
    "changedLocations is required on every decision",
    "never omit the field",
    "prose in the document is not a proposal candidate",
    "Each decision takes exactly one of these complete shapes",
    // The plan side's own copy of the removal obligation and of the
    // single-claim rule, for the reason the conditional-field matrix is
    // asserted twice: one shared builder, and nothing structural notices a
    // sentence tested on one prompt only.
    "superseded half counts as a removed node",
    "across the entire revision must be claimed",
    "Never duplicate or repeat the same node across multiple decisions",
    "Deleting an obligation is not a way to answer a finding",
    // The plan side states its own node forms — a task and a coverage entry —
    // which are not the spec side's, so a shared assertion would prove
    // neither. The spec side carries the same pair for its own forms.
    "a task's node text is the task itself",
    "`AC-001 -> <artifact path>`",
    "`AC-001 -> not_applicable: <rationale> / <alternative verification>`",
    "Leave off the list marker",
    "every line in ## Coverage is a normative node",
    "Do not casually edit, polish, or rephrase coverage entries",
    // The one-artifact rule, and the move that answers a second-artifact
    // finding without breaching it. This is the builder the measured block
    // came from.
    "names exactly one of them, copied verbatim",
    "list of paths is not a path",
    "takes the not_applicable form above",
    "representative delivery anchor",
    "most directly responsible for the criterion's observable outcome",
    "needs a second artifact",
    // The plan side's own copy of the conditional-field matrix. These two
    // prompts share the contract builder, and nothing structural notices a
    // missing assertion on one of them.
    "grounding is allowed only on rejected_with_rationale",
    "normativeChanges is",
    "proposal is allowed only on upstream_follow_up",
    "return no field at all that your disposition does not list",
    // plan_review has no operator question: its blocking route still blocks.
    "upstream_blocking blocks the run, upstream_follow_up does not",
  ]) {
    assert.ok(prompt.includes(constraint), `plan reconcile prompt missing: ${constraint}`);
  }
  assert.ok(!prompt.includes('"question"'), "the plan reconcile prompt asks the operator nothing");
  assert.ok(!prompt.includes("pauses the run"), "the plan reconcile prompt promises no operator pause");
  assert.ok(prompt.includes("SPEC-TEXT"), "the approved specification is the governing input");
  assert.ok(prompt.includes("PLAN-TEXT"), "the plan under review travels with it");
  // The two values the gates bind are stated rather than left to be
  // rediscovered, exactly as the self-critique prompt restates them.
  assert.ok(prompt.includes(`plan_for must be exactly: ${specHash}`));
  assert.ok(prompt.includes("- src/a.ts"));
  // The findings block renders on the plan side too.
  assert.ok(prompt.includes("severity critical, classification current_artifact"));
});

test("each reconciliation prompt tells the author to update what a change affects, in its own document's terms", () => {
  const spec = buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PAIR, VERIFICATION);
  const plan = buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], PAIR, VERIFICATION);
  assert.ok(spec.includes(SPEC_RECONCILE_DEPENDENTS_RULE), "spec reconcile prompt missing its rule");
  assert.ok(!spec.includes(PLAN_RECONCILE_DEPENDENTS_RULE), "spec reconcile prompt carries the plan's rule");
  assert.ok(plan.includes(PLAN_RECONCILE_DEPENDENTS_RULE), "plan reconcile prompt missing its rule");
  assert.ok(!plan.includes(SPEC_RECONCILE_DEPENDENTS_RULE), "plan reconcile prompt carries the spec's rule");
});

test("a reconciliation prompt with no findings states the none-line, not a bare block", () => {
  for (const prompt of [
    buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", [], VERIFICATION),
    buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], [], VERIFICATION),
  ]) {
    assert.ok(prompt.includes("Findings to reconcile:"));
    assert.ok(prompt.includes("none were reported this round."), "the empty round is stated as such");
  }
});

test("the spec reconciliation prompt is not the spec author prompt", () => {
  // Hazard 7 in the small: two dispatches under one agent and one model that
  // sent the same bytes would be paying twice for one answer.
  const author = buildSpecAuthorPrompt(SPEC_AUTHOR, "DESIGN-TEXT", VERIFICATION);
  const reconcile = buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", [], VERIFICATION);
  assert.notEqual(author, reconcile);
  // The JSON key, not the word: the draft states the `## Open decisions`
  // section, but it never asks for a decisions list.
  assert.ok(!author.includes('"decisions"'), "the draft prompt asks for a spec, not decisions");
  assert.ok(reconcile.includes('"decisions"'), "the reconcile prompt does ask for them");
});

test("every finding id a reconcile prompt advertises is one the validator accepts", () => {
  // Hazard 3's second sentence, applied to the decision example: a fixed
  // example `"findingId": 1` in a round whose canonical ids do not include 1
  // is a value the validator is guaranteed to refuse — the same defect the
  // panel-size example carried until Task 5. The advertised envelope lists one
  // entry per canonical finding, so a copied array names every id and omits
  // none. This test proves id completeness only; the entries point at the
  // per-disposition shapes, whose validity the shape test below proves. An
  // empty round advertises the only envelope that validates against zero
  // canonical ids.
  const report = {
    reviewerId: "spec-reviewer-security",
    severity: "high",
    classification: "current_artifact",
    location: "## Acceptance criteria",
    intentKey: "missing-traceability",
    subject: "criterion lacks a traceable origin",
  };
  const findings: ReconciliationFindingInput[] = [
    { findingId: 3, reports: [report] },
    { findingId: 5, reports: [report] },
  ];
  const prompts = {
    spec: buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", findings, VERIFICATION),
    plan: buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], findings, VERIFICATION),
  };
  for (const [name, prompt] of Object.entries(prompts)) {
    const advertised = [...prompt.matchAll(/"findingId": (\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(
      advertised,
      [3, 5],
      `${name} prompt advertises the complete decisions envelope, not only its first id`
    );
  }
  for (const prompt of [
    buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", [], VERIFICATION),
    buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], [], VERIFICATION),
  ]) {
    assert.ok(prompt.includes('"decisions": []'), "an empty round advertises an empty decisions list");
  }
});

test("every decision shape a reconcile prompt advertises validates against validateReconciliation", () => {
  // Hazard 3's second sentence, on every branch the validator distinguishes:
  // a decision's required fields depend on its disposition. Measured
  // 2026-09-26 — with one addressed-like entry advertised, two paid runs
  // blocked on upstream decisions missing changedLocations and proposal
  // (test/fixtures/recorded/spec-reconciliation-note-keeper-*.json). The
  // shapes are read from the generated prompt, never restated here.
  const cases = [
    {
      name: "spec",
      governingSource: "design" as const,
      governingText: "DESIGN-TEXT",
      prompt: buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PAIR, VERIFICATION),
    },
    {
      name: "plan",
      governingSource: "specification" as const,
      governingText: "SPEC-TEXT",
      prompt: buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], PAIR, VERIFICATION),
    },
  ];
  for (const { name, governingSource, governingText, prompt } of cases) {
    const shapes = [
      ...prompt.matchAll(
        /^- (addressed|rejected_with_rationale|upstream_follow_up|upstream_blocking|cannot_determine): (\{.*\})$/gm
      ),
    ];
    assert.deepEqual(
      shapes.map((m) => m[1]).sort(),
      ["addressed", "cannot_determine", "rejected_with_rationale", "upstream_blocking", "upstream_follow_up"],
      `${name} prompt advertises exactly one shape per disposition`
    );
    for (const [, disposition, shape] of shapes) {
      const decision = JSON.parse(shape!.replaceAll("<id>", "7").replace(/<[^>]*>/g, governingText));
      // The label is what the author reads; the JSON is what it copies.
      assert.equal(decision.disposition, disposition, `${name} ${disposition} shape carries another disposition`);
      // The addressed shape advertises the common branch — a claimed node —
      // so the revision it describes adds exactly the node it claims.
      const claimed: string[] = (decision.normativeChanges ?? []).map(
        (change: { artifactText: string }) => change.artifactText
      );
      if (disposition === "addressed") {
        assert.equal(claimed.length, 1, `${name} addressed shape shows one complete normativeChanges entry`);
      }
      // The spec side's blocking shapes carry the operator question and the
      // plan side's never do; each validates under its own caller's context.
      const asksOperator = name === "spec" && (disposition === "upstream_blocking" || disposition === "cannot_determine");
      assert.equal("question" in decision, asksOperator, `${name} ${disposition} shape question presence`);
      const result = validateReconciliation([decision], {
        canonicalFindingIds: [7],
        governingSource,
        governingText,
        beforeNormativeNodes: [],
        afterNormativeNodes: claimed,
        requireQuestions: name === "spec",
      });
      assert.ok(result.ok, `${name} ${disposition} shape: ${result.ok ? "" : result.reason}`);
      assert.deepEqual(result.value.conversions, [], `${name} ${disposition} shape converts`);
      assert.deepEqual(result.value.unclaimedNodes, []);
      assert.deepEqual(result.value.unclaimedRemovals, []);
    }
  }
});

test("the spec reconciliation prompt states the frozen commands and names a Verification: question as the one blocking exception", () => {
  const prompt = buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PAIR, VERIFICATION);
  const at = (text: string): number => {
    const index = prompt.indexOf(text);
    assert.ok(index >= 0, `spec reconcile prompt missing: ${text}`);
    return index;
  };
  assert.ok(prompt.includes(`\n\n${RUN_10_COMMAND_LINES.join("\n")}\n\n`), "the commands are one block, in order");
  for (const sentence of [...VERIFICATION_BLOCK_SENTENCES, ...RECONCILE_VERIFICATION_SENTENCES]) at(sentence);
  // The two backticked forms, whole: the subject form the reconciler reads in
  // the findings block, and the marker it is told to start the question with.
  at("A finding whose subject reads `OD-<n>: Verification: <question>` is an open decision");
  at("begin the question's text with `Verification:` and make each option name");
  // The exception names the test it is an exception to ("the upstream_blocking
  // test above") because the commands block now sits between them, so "the rule
  // above" would point at the block's last line. The test it names, which is
  // unchanged, is above the block and the exception.
  assert.ok(at("choose upstream_blocking only when the design states a behavior") < at(VERIFICATION_BLOCK_SENTENCES[0]!));
  assert.ok(at("does not by itself make a finding blocking.") < at(VERIFICATION_BLOCK_SENTENCES[0]!));
  assert.ok(at(RUN_10_COMMAND_LINES[2]!) < at(RECONCILE_VERIFICATION_SENTENCES[0]!));
  assert.ok(at(RECONCILE_VERIFICATION_SENTENCES.at(-1)!) < at("The revised specification must satisfy the same document schema"));
  // The stage emitter routes over the whole prompt and checks these two words
  // before `reconcile`; the new text must not carry either.
  for (const word of ["self-critique", "spec reviewer"]) {
    assert.ok(!prompt.includes(word), `spec reconcile prompt carries the routing word ${word}`);
  }
  // The emitter scrapes every `finding <digits>` in the prompt and two block
  // markers; the new text must add none. PAIR holds finding 7 and nothing else.
  assert.deepEqual([...prompt.matchAll(/finding (\d+)/g)].map((m) => Number(m[1])), [7]);
  for (const marker of ["The specification under review:", "Findings to reconcile:"]) {
    assert.equal(prompt.split(marker).length, 2, `${marker} appears once`);
  }
});

test("the spec reconciliation prompt follows the config it is given", () => {
  const other: VerificationConfig = { commands: [{ name: "smoke", command: ["node", "--version"] }] };
  const recorded = buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PAIR, VERIFICATION);
  const changed = buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PAIR, other);
  assert.notEqual(recorded, changed);
  assert.ok(changed.includes("\n\n- smoke: node --version\n\n"));
  for (const line of RUN_10_COMMAND_LINES) assert.ok(!changed.includes(line), `still carries ${line}`);
});

// --- spec decision fold (spec-operator-decisions Task 6) ---------------------

const FOLD_QUESTIONS: FoldQuestionInput[] = [
  { findingId: 4, text: "How long are exports kept?", action: "approve", answer: "Exports are kept for thirty days." },
  { findingId: 6, text: "Who may download exports?", action: "modify", answer: "Only the owner may download exports." },
  { findingId: 9, text: "Is there a size cap?", action: "deny", answer: "" },
];

test("the generated fold prompt carries every answer, lists denied questions apart, and states the fold contract", () => {
  const prompt = buildSpecDecisionFoldPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", FOLD_QUESTIONS, VERIFICATION);
  for (const text of [
    "DESIGN-TEXT",
    "SPEC-TEXT",
    "- finding 4\n  question: How long are exports kept?\n  operator answer (approve): Exports are kept for thirty days.",
    "- finding 6\n  question: Who may download exports?\n  operator answer (modify): Only the owner may download exports.",
    "Denied questions (leave open):\n\n- finding 9\n  question: Is there a size cap?",
    "disposition is always addressed",
    "never in another finding's answer",
    "Denied questions stay open",
    "for a denied question stays exactly as written",
    "Never add a new ## Open decisions",
    "a path contains no whitespace",
    "Output the JSON object",
  ]) {
    assert.ok(prompt.includes(text), `fold prompt missing: ${text}`);
  }
  const folded = prompt.slice(prompt.lastIndexOf(promptBuilders.SPEC_DECISION_FOLD_MARKER));
  assert.ok(!/operator answer \(deny\)/.test(folded), "a denied question is not presented as an answer to fold");
  // The advertised envelope names exactly the folded ids — never a denied one.
  assert.deepEqual([...prompt.matchAll(/"findingId": (\d+)/g)].map((m) => Number(m[1])), [4, 6]);
  // The harness fixture routes the earlier spec prompts on these words and is
  // checked in that order, so the fold prompt must carry none of them.
  for (const word of ["self-critique", "spec reviewer", "reconcile"]) {
    assert.ok(!prompt.includes(word), `fold prompt carries the routing word ${word}`);
  }
});

test("the fold decision shape the prompt advertises validates with the operator's answer as grounding", () => {
  const prompt = buildSpecDecisionFoldPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", FOLD_QUESTIONS, VERIFICATION);
  const shape = /^(\{"findingId": <id>, "disposition": "addressed".*\})$/m.exec(prompt);
  assert.ok(shape, "the fold prompt advertises one complete decision shape");
  const answer = FOLD_QUESTIONS[0].answer;
  const decision = JSON.parse(
    shape![1]!
      .replaceAll("<id>", "4")
      .replace("<exact words of the operator's answer to that finding>", answer)
      .replace(/<[^>]*>/g, "AC-002: Exports are kept for thirty days.")
  );
  const result = validateReconciliation([decision], {
    canonicalFindingIds: [4],
    governingSource: "design",
    governingText: "DESIGN-TEXT",
    beforeNormativeNodes: [],
    afterNormativeNodes: ["AC-002: Exports are kept for thirty days."],
    operatorAnswers: new Map([[4, answer]]),
  });
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.deepEqual(result.value.conversions, []);
  assert.deepEqual(result.value.unclaimedNodes, []);
});

test("the fold prompt states the frozen commands and folds only the paths a Verification: answer names", () => {
  const prompt = buildSpecDecisionFoldPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", FOLD_QUESTIONS, VERIFICATION);
  const at = (text: string): number => {
    const index = prompt.indexOf(text);
    assert.ok(index >= 0, `fold prompt missing: ${text}`);
    return index;
  };
  assert.ok(prompt.includes(`\n\n${RUN_10_COMMAND_LINES.join("\n")}\n\n`), "the commands are one block, in order");
  for (const sentence of [...VERIFICATION_BLOCK_SENTENCES, ...FOLD_VERIFICATION_SENTENCES]) at(sentence);
  at("An answer to a question that begins `Verification:` may name a stack, a layout and declared artifact paths");
  // After the document schema the revision must satisfy, before the design and
  // the answers: the rule is about what the answers below may add.
  assert.ok(at("A revised specification that does not validate blocks the run.") < at(VERIFICATION_BLOCK_SENTENCES[0]!));
  assert.ok(at(RUN_10_COMMAND_LINES[2]!) < at(FOLD_VERIFICATION_SENTENCES[0]!));
  assert.ok(at(FOLD_VERIFICATION_SENTENCES.at(-1)!) < at("Design document:"));
  // The fixture routes the earlier spec prompts on these words, in this order,
  // and recognizes the fold by its own heading afterwards.
  for (const word of ["self-critique", "spec reviewer", "reconcile"]) {
    assert.ok(!prompt.includes(word), `fold prompt carries the routing word ${word}`);
  }
  // The emitter reads the answers from the last use of the heading.
  assert.equal(prompt.indexOf(promptBuilders.SPEC_DECISION_FOLD_MARKER, at("Design document:")) > 0, true);
  // The advertised envelope still names exactly the folded ids.
  assert.deepEqual([...prompt.matchAll(/"findingId": (\d+)/g)].map((m) => Number(m[1])), [4, 6]);
});

test("the fold prompt follows the config it is given", () => {
  const other: VerificationConfig = { commands: [{ name: "smoke", command: ["node", "--version"] }] };
  const recorded = buildSpecDecisionFoldPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", FOLD_QUESTIONS, VERIFICATION);
  const changed = buildSpecDecisionFoldPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", FOLD_QUESTIONS, other);
  assert.notEqual(recorded, changed);
  assert.ok(changed.includes("\n\n- smoke: node --version\n\n"));
  for (const line of RUN_10_COMMAND_LINES) assert.ok(!changed.includes(line), `still carries ${line}`);
});

test("the generated code review prompt states every field the validator and the gate act on", () => {
  const prompt = buildCodeReviewPrompt(
    CODE_REVIEWER_CORRECTNESS,
    "SPEC-TEXT",
    "PLAN-TEXT",
    ["js/a.js", "css/b.css"],
    "DIFF-TEXT",
    "c".repeat(40)
  );
  for (const constraint of [
    "code reviewer code-reviewer-correctness",
    "Report only findings within your specialty: correctness",
    "low, medium, high, critical",
    // One distinguishing phrase per rubric level: a threshold over an
    // unstated scale is a comparison against nothing (hazard 3).
    "unsafe, or destroys data or state",
    "fails to implement an acceptance criterion",
    "does not fail an acceptance criterion",
    "small but concrete defect with localized impact",
    "current_artifact",
    "lowercase kebab-case",
    "64",
    "An empty findings array is a valid result",
    "read-only",
    "- js/a.js",
    "- css/b.css",
    CODE_REVIEWER_CORRECTNESS.codeReviewInstructions!,
    "reproducible impact",
    "optional refactoring",
    "speculative hardening",
    "Conduct an exhaustive audit across the entire diff and all changed paths within your specialty",
    "Do not stop after finding the first few defects or return only a sample of issues",
    "report every actionable defect you identify across all declared acceptance criteria and plan tasks",
    "SPEC-TEXT",
    "PLAN-TEXT",
    "DIFF-TEXT",
    "c".repeat(40),
  ]) {
    assert.ok(prompt.includes(constraint), `code review prompt is missing: ${constraint}`);
  }
  // No consequence a reviewer could write to. The sibling review prompts
  // state none either: a reviewer grading to clear a gate is the bias
  // section 12 keeps out by making the verdict an input to the gate.
  assert.ok(!prompt.includes("threshold"), "the prompt must not name the gate threshold");
  assert.ok(!prompt.includes("high or critical blocks"), "the prompt must not state a consequence");
  assert.ok(!prompt.includes("blocks the run"), "the prompt must not state a consequence");
  assert.ok(!prompt.includes("upstream:plan:"), "code review must not advertise an upstream route");

  // The `Changed paths:` block shape is a contract the harness fixture
  // scrapes. Asserted as the fixture reads it, not as prose.
  const scraped = /Changed paths:\n\n([\s\S]*?)\n\n/.exec(prompt);
  assert.ok(scraped, "the changed-paths block must be scrapable");
  assert.deepEqual(scraped![1]!.split("\n"), ["- js/a.js", "- css/b.css"]);
});

test("the correctness, security, and resilience prompts carry distinct protected specialist instructions", () => {
  const security = buildCodeReviewPrompt(
    CODE_REVIEWER_SECURITY,
    "SPEC",
    "PLAN",
    ["src/a.ts"],
    "DIFF",
    "c".repeat(40)
  );
  const correctness = buildCodeReviewPrompt(
    CODE_REVIEWER_CORRECTNESS,
    "SPEC",
    "PLAN",
    ["src/a.ts"],
    "DIFF",
    "c".repeat(40)
  );
  const resilience = buildCodeReviewPrompt(
    CODE_REVIEWER_STATE_INTEGRITY,
    "SPEC",
    "PLAN",
    ["src/a.ts"],
    "DIFF",
    "c".repeat(40)
  );
  assert.ok(correctness.includes("behavioral defects"));
  assert.ok(security.includes("trust-boundary"));
  assert.ok(resilience.includes("idempotency"));
  assert.ok(resilience.includes("Do not report missing tests"));
  assert.ok(resilience.includes("ordinary functional-result defects owned by correctness"));
  assert.ok(resilience.includes("injection"));
  assert.notEqual(correctness, security);
  assert.notEqual(correctness, resilience);
  assert.notEqual(security, resilience);
});

test("the remediation prompt carries every report and advertises a valid patch result", () => {
  const base = "b".repeat(40);
  const prompt = buildCodeReviewRemediationPrompt(
    IMPLEMENTER,
    "SPEC-TEXT",
    "PLAN-TEXT",
    ["src/a.ts"],
    base,
    ["src/a.ts"],
    "DIFF-TEXT",
    [
      {
        findingId: 7,
        location: "src/a.ts:3",
        intentKey: "wrong-result",
        reports: [
          {
            reviewerId: "code-reviewer-correctness",
            severity: "high",
            classification: "current_artifact",
            subject: "The calculation returns the wrong result for ordinary input.",
          },
        ],
      },
    ]
  );
  for (const text of [
    "finding 7",
    "src/a.ts:3",
    "wrong-result",
    "code-reviewer-correctness",
    "severity high",
    "classification current_artifact",
    "The calculation returns the wrong result",
    "SPEC-TEXT",
    "PLAN-TEXT",
    "DIFF-TEXT",
    base,
    "Do not return finding dispositions, proposals, waivers, questions",
    "JSON-standard escaping",
    "literal UTF-8",
    "\\uXXXX",
    "\\UXXXXXXXX",
    "Write every line break inside a JSON string, including each line break of a file's content, as `\\n` and every tab as `\\t`; never put a raw line break or tab inside a string literal.",
  ]) {
    assert.ok(prompt.includes(text), `remediation prompt missing: ${text}`);
  }
  const advertised = /Return exactly a JSON AgentResult object with this shape:\n(\{[^\n]+\})/.exec(prompt);
  assert.ok(advertised);
  const result = validateAgentResult(IMPLEMENTER.id, JSON.parse(advertised![1]!));
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  // The two run 6 rules, asserted on the built prompt and placed before the scope.
  for (const rule of [REMEDIATION_REREAD_RULE, SAME_DEFECT_SWEEP_RULE]) {
    const at = prompt.indexOf(rule);
    assert.ok(at >= 0, `remediation prompt missing: ${rule}`);
    assert.ok(at < prompt.indexOf("Approved scope:"), `remediation rule after the scope: ${rule}`);
  }
});

// --- code-review reconciler (code-review-reconciler Task 4) -----------------

/**
 * The measured template, read from the replay fixture rather than written here
 * (hazard 4): the script that produced the 30 recorded reconciler calls.
 */
const RECONCILER_SOURCE: string = (JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "code-review-reconciler-replay-crew-chatter-run-6.json"), "utf8")
) as { reconcilerSource: string }).reconcilerSource;
const TEMPLATE_START = "const prompt = `";
const RECONCILER_TEMPLATE = RECONCILER_SOURCE.slice(
  RECONCILER_SOURCE.indexOf(TEMPLATE_START) + TEMPLATE_START.length,
  RECONCILER_SOURCE.indexOf("`;\n\nconst collapse")
);
/** Run 6's round-1 findings as stored: the replay's input. */
const RUN_6_ROUND_1 = (JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "code-review-crew-chatter-run-6.json"), "utf8")
) as {
  codeReviewFindings: Array<{
    findingId: number;
    round: number;
    location: string;
    intentKey: string;
    reports: Array<{ reviewer: string; severity: string; subject: string }>;
  }>;
}).codeReviewFindings.filter((finding) => finding.round === 1);

function buildRun6ReconcilerPrompt(spec: string, plan: string, diff: string, commit: string): string {
  return buildCodeReviewReconcilerPrompt(
    RUN_6_ROUND_1.map((finding) => ({
      findingId: finding.findingId,
      location: finding.location,
      intentKey: finding.intentKey,
      reports: finding.reports.map((report) => ({
        reviewerId: report.reviewer,
        severity: report.severity,
        classification: "current_artifact" as const,
        subject: report.subject,
      })),
    })),
    spec,
    plan,
    diff,
    commit
  );
}

test("the reconciler prompt is byte for byte the measured replay template", () => {
  assert.equal(RUN_6_ROUND_1.length, 13);
  assert.ok(RECONCILER_TEMPLATE.startsWith("you are the code-review reconciler\n"), "the template was found in the replay source");
  // The replay's own render and template, evaluated over the replay's own inputs.
  const render = RECONCILER_SOURCE.slice(
    RECONCILER_SOURCE.indexOf("const rendered = findings"),
    RECONCILER_SOURCE.indexOf("const ids = ")
  );
  const body = render + "return `" + RECONCILER_TEMPLATE + "`;";
  const replay = new Function("findings", "ids", "HEAD", "spec", "plan", "diff", body) as (
    findings: unknown,
    ids: number[],
    head: string,
    spec: string,
    plan: string,
    diff: string
  ) => string;
  const commit = "c".repeat(40);
  const expected = replay(RUN_6_ROUND_1, RUN_6_ROUND_1.map((f) => f.findingId), commit, "SPEC-TEXT", "PLAN-TEXT", "DIFF-TEXT");
  assert.equal(buildRun6ReconcilerPrompt("SPEC-TEXT", "PLAN-TEXT", "DIFF-TEXT", commit), expected);
});

test("every fixed line of the measured template appears in the reconciler prompt, in order", () => {
  const fixed = RECONCILER_TEMPLATE.split("\n").filter((line) => line.trim() !== "" && !line.includes("${"));
  assert.ok(fixed.length >= 10, `${fixed.length} fixed lines`);
  const lines = buildRun6ReconcilerPrompt("SPEC-TEXT", "PLAN-TEXT", "DIFF-TEXT", "c".repeat(40)).split("\n");
  let at = -1;
  for (const line of fixed) {
    const next = lines.indexOf(line, at + 1);
    assert.ok(next > at, `reconciler prompt missing, or out of order: ${line}`);
    at = next;
  }
});

test("the reconciler prompt opens with its role, ends with the diff, and states no consequence", () => {
  const commit = "c".repeat(40);
  const prompt = buildRun6ReconcilerPrompt("SPEC-TEXT", "PLAN-TEXT", "DIFF-TEXT", commit);
  assert.ok(prompt.startsWith(`${promptBuilders.CODE_REVIEW_RECONCILER_PROMPT_PREFIX}\n`));
  assert.ok(prompt.endsWith("Diff of the change:\n\nDIFF-TEXT"));
  assert.ok(prompt.includes(`Your working directory is the repository checkout at commit ${commit}; you may read it.`));
  // One advertised entry per listed finding, in prompt order.
  assert.deepEqual(
    [...prompt.matchAll(/\{"findingId": (\d+), </g)].map((m) => Number(m[1])),
    RUN_6_ROUND_1.map((f) => f.findingId)
  );
  for (const word of ["threshold", "blocks the run", "second call", "agree"]) {
    assert.ok(!prompt.includes(word), `the reconciler prompt states a consequence: ${word}`);
  }
});

// --- design split (design-split-into-features Task 5) -----------------------

/** Crew-chatter run 4, the run that motivated the split: its reviewed spec as its decision gate passed it. */
const SPLIT_RUN_4: { specMarkdown: string; provenance: { declaredPaths: number } } = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "spec-crew-chatter-run-4.json"), "utf8")
);

/** A split context no default produces, for the routing and wording tests. */
const SPLIT_CONTEXT = { threshold: 17, declaredCount: 23, slugsInUse: ["other-feature"], runSlug: "demo" };

test("the split prompt built from crew-chatter run 4's spec states its counts, the limit, every rule in order and the slugs in use", () => {
  const spec = validateSpecDoc(SPLIT_RUN_4.specMarkdown);
  assert.ok(spec.ok, spec.ok ? "" : spec.reason);
  const declared = readSpecDeclaredArtifacts(SPLIT_RUN_4.specMarkdown)!;
  assert.equal(declared.length, SPLIT_RUN_4.provenance.declaredPaths);
  const prompt = buildDesignSplitPrompt(SPEC_AUTHOR, "DESIGN-TEXT", SPLIT_RUN_4.specMarkdown, {
    threshold: DESIGN_SPLIT_PATH_THRESHOLD, declaredCount: declared.length,
    slugsInUse: ["crew-chatter", "other-feature"], runSlug: "crew-chatter",
  });
  assert.ok(prompt.startsWith(promptBuilders.DESIGN_SPLIT_PROMPT_PREFIX));
  assert.ok(prompt.includes(`declares ${declared.length} files`), "the declared count");
  assert.ok(prompt.includes(`at most ${DESIGN_SPLIT_PATH_THRESHOLD} declared files within its plan ceiling`), "the threshold");
  assert.ok(prompt.includes(`Each piece lists at most ${DESIGN_SPLIT_PATH_THRESHOLD} distinct declared files.`), "the per-feature limit");
  assert.ok(prompt.includes("none of these slugs already in use: crew-chatter, other-feature."));
  for (const criterion of spec.value.acceptanceCriteria) assert.ok(prompt.includes(criterion.id), criterion.id);
  for (const path of declared) assert.ok(prompt.includes(path), path);
  // The rules in the order validateDesignSplit checks them, so the first rule
  // the model reads as broken is the one the refusal will name.
  const order = [
    "only the keys pieces and rationale",
    "at least 2 features",
    "lowercase kebab-case",
    "one non-empty line",
    "at least one acceptance criterion ID and at least one declared file",
    "Every acceptance criterion ID of the specification is in exactly one piece",
    "Every declared file of the specification is in at least one piece",
    `at most ${DESIGN_SPLIT_PATH_THRESHOLD} distinct declared files`,
    "dependsOn lists the 1-based positions of earlier pieces",
    "rationale is a non-empty string",
  ].map((text) => {
    const index = prompt.indexOf(text);
    assert.ok(index >= 0, `split prompt missing: ${text}`);
    return index;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the rules follow the validator's order");
  assert.ok(prompt.includes("JSON-standard escaping"));
  assert.ok(prompt.includes("never put a raw line break or tab inside a string literal"));
});

test("the split prompt follows the numbers and slugs it is given", () => {
  const prompt = buildDesignSplitPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", SPLIT_CONTEXT);
  assert.ok(prompt.includes("declares 23 files"));
  assert.ok(prompt.includes("Each piece lists at most 17 distinct declared files."));
  assert.ok(prompt.includes("none of these slugs already in use: demo, other-feature."));
  assert.ok(!prompt.includes(`at most ${DESIGN_SPLIT_PATH_THRESHOLD} `), "no live constant in place of the frozen value");
});

test("the split result and example the prompt advertises validate against the receiving validators", () => {
  const prompt = buildDesignSplitPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", SPLIT_CONTEXT);
  const envelope = /proposedContentChanges\.split:\n(\{[^\n]+\})$/m.exec(prompt);
  assert.ok(envelope, "the prompt advertises one AgentResult shape");
  const result = validateAgentResult(SPEC_AUTHOR.id, JSON.parse(envelope![1]!));
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.value.status, "proposed");
  // The example names the two-criterion specification it is for; that
  // specification is built here and the example is checked against it.
  assert.ok(prompt.includes("whose criteria are AC-001 and AC-002 and whose declared files are src/a.ts and src/b.ts"));
  const spec = validateSpecDoc(`feature: example
change_kind: feature

## Declared artifacts

- src/a.ts
- src/b.ts

## Acceptance criteria

- AC-001: the core behaviour works
- AC-002: the extras work
`);
  assert.ok(spec.ok, spec.ok ? "" : spec.reason);
  const example = /this split is valid:\n(\{[^\n]+\})$/m.exec(prompt);
  assert.ok(example, "the prompt advertises one example split");
  const split = validateDesignSplit(JSON.parse(example![1]!), {
    spec: spec.value, runSlug: SPLIT_CONTEXT.runSlug, slugsInUse: SPLIT_CONTEXT.slugsInUse, maxPathsPerPiece: 1,
  });
  assert.ok(split.ok, split.ok ? "" : split.reason);
});

test("the split prompt carries no word the spec emitter routes its other prompts on", () => {
  const prompt = buildDesignSplitPrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", SPLIT_CONTEXT).toLowerCase();
  for (const word of ["self-critique", "spec reviewer", "reconcile", "spec author", "operator answers to fold:"]) {
    assert.ok(!prompt.includes(word), `split prompt carries the routing word ${word}`);
  }
});

const CLI_ROUTER = resolve("test", "fixtures", "harness", "emit-cli-run.mjs");
const ROUTE_PREFIXES = {
  SPEC_AUTHOR_PROMPT_PREFIX: promptBuilders.SPEC_AUTHOR_PROMPT_PREFIX,
  SPEC_REVIEW_PROMPT_PREFIX: promptBuilders.SPEC_REVIEW_PROMPT_PREFIX,
  PLAN_AUTHOR_PROMPT_PREFIX: promptBuilders.PLAN_AUTHOR_PROMPT_PREFIX,
  PLAN_REVIEW_PROMPT_PREFIX: promptBuilders.PLAN_REVIEW_PROMPT_PREFIX,
  IMPLEMENTATION_PROMPT_PREFIX: promptBuilders.IMPLEMENTATION_PROMPT_PREFIX,
  CODE_REVIEW_PROMPT_PREFIX: promptBuilders.CODE_REVIEW_PROMPT_PREFIX,
  CODE_REVIEW_REMEDIATION_PROMPT_PREFIX: promptBuilders.CODE_REVIEW_REMEDIATION_PROMPT_PREFIX,
  CODE_REVIEW_RECONCILER_PROMPT_PREFIX: promptBuilders.CODE_REVIEW_RECONCILER_PROMPT_PREFIX,
  DESIGN_SPLIT_PROMPT_PREFIX: promptBuilders.DESIGN_SPLIT_PROMPT_PREFIX,
};
interface PromptRoute {
  name: string;
  prefix: string;
  emitter: string;
}
const router: {
  PROMPT_ROUTES: PromptRoute[];
  selectPromptRoute(prompt: string): PromptRoute;
} = await import(pathToFileURL(CLI_ROUTER).href);

function routingPrompts(document: string) {
  const hash = "a".repeat(64);
  const base = "b".repeat(40);
  const scope = ["src/a.ts"];
  return [
    { builder: "buildSpecAuthorPrompt", prefix: "SPEC_AUTHOR_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecAuthorPrompt(SPEC_AUTHOR, document, VERIFICATION) },
    { builder: "buildSpecSelfCritiquePrompt", prefix: "SPEC_AUTHOR_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecSelfCritiquePrompt(SPEC_AUTHOR, document, document, PANEL, VERIFICATION) },
    { builder: "buildSpecReviewPrompt", prefix: "SPEC_REVIEW_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecReviewPrompt(SPEC_REVIEWER_TRACEABILITY, document, document) },
    { builder: "buildSpecReconcilePrompt", prefix: "SPEC_AUTHOR_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecReconcilePrompt(SPEC_AUTHOR, document, document, PAIR, VERIFICATION) },
    { builder: "buildSpecDecisionFoldPrompt", prefix: "SPEC_AUTHOR_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecDecisionFoldPrompt(SPEC_AUTHOR, document, document, FOLD_QUESTIONS, VERIFICATION) },
    { builder: "buildPlanAuthorPrompt", prefix: "PLAN_AUTHOR_PROMPT_PREFIX", emitter: "emit-plan-stage.mjs", prompt: buildPlanAuthorPrompt(PLAN_AUTHOR, document, hash, scope, VERIFICATION) },
    { builder: "buildPlanSelfCritiquePrompt", prefix: "PLAN_AUTHOR_PROMPT_PREFIX", emitter: "emit-plan-stage.mjs", prompt: buildPlanSelfCritiquePrompt(PLAN_AUTHOR, document, document, hash, scope, PANEL, VERIFICATION) },
    { builder: "buildPlanReviewPrompt", prefix: "PLAN_REVIEW_PROMPT_PREFIX", emitter: "emit-plan-stage.mjs", prompt: buildPlanReviewPrompt(SPEC_REVIEWER_TRACEABILITY, document, document) },
    { builder: "buildPlanReconcilePrompt", prefix: "PLAN_AUTHOR_PROMPT_PREFIX", emitter: "emit-plan-stage.mjs", prompt: buildPlanReconcilePrompt(PLAN_AUTHOR, document, document, hash, scope, PAIR, VERIFICATION) },
    { builder: "buildImplementationAuthorPrompt", prefix: "IMPLEMENTATION_PROMPT_PREFIX", emitter: "emit-implementation-stage.mjs", prompt: buildImplementationAuthorPrompt(IMPLEMENTER, document, document, scope, base, ONLY_PHASE, [], VERIFICATION), schema: PATCH_RESULT_SCHEMA },
    { builder: "buildImplementationSelfReviewPrompt", prefix: "IMPLEMENTATION_PROMPT_PREFIX", emitter: "emit-implementation-stage.mjs", prompt: buildImplementationSelfReviewPrompt(IMPLEMENTER, document, document, scope, base, scope, scope, document, VERIFICATION), schema: SELF_REVIEW_RESULT_SCHEMA },
    { builder: "buildCodeReviewPrompt", prefix: "CODE_REVIEW_PROMPT_PREFIX", emitter: "emit-code-review.mjs", prompt: buildCodeReviewPrompt(CODE_REVIEWER_CORRECTNESS, document, document, scope, document, base) },
    { builder: "buildCodeReviewRemediationPrompt", prefix: "CODE_REVIEW_REMEDIATION_PROMPT_PREFIX", emitter: "emit-code-review.mjs", prompt: buildCodeReviewRemediationPrompt(IMPLEMENTER, document, document, scope, base, scope, document, []), schema: PATCH_RESULT_SCHEMA },
    { builder: "buildCodeReviewReconcilerPrompt", prefix: "CODE_REVIEW_RECONCILER_PROMPT_PREFIX", emitter: "emit-code-review.mjs", prompt: buildCodeReviewReconcilerPrompt([], document, document, document, base) },
    { builder: "buildDesignSplitPrompt", prefix: "DESIGN_SPLIT_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildDesignSplitPrompt(SPEC_AUTHOR, document, document, SPLIT_CONTEXT) },
  ];
}

test("CLI fixture routes every builder by its shared leading role, not embedded roles or document wrapping", () => {
  assert.deepEqual(
    routingPrompts("").map(({ builder }) => builder).sort(),
    Object.keys(promptBuilders).filter((name) => name.startsWith("build")).sort(),
    "every exported builder must have a routing assertion"
  );
  assert.deepEqual(
    Object.fromEntries(router.PROMPT_ROUTES.map(({ name, prefix }) => [name, prefix])),
    ROUTE_PREFIXES
  );
  const embedded = Object.values(ROUTE_PREFIXES).join("\n");
  for (const document of ["# Ordinary input\nWrapped\nparagraph.", `# Quoted roles\r\n\`\`\`\r\n${embedded}\r\n\`\`\`\r\n🌙\r\n`]) {
    for (const entry of routingPrompts(document)) {
      const route = router.selectPromptRoute(entry.prompt);
      assert.equal(route.name, entry.prefix, entry.builder);
      assert.equal(route.emitter, entry.emitter, entry.builder);
      assert.ok(entry.prompt.startsWith(ROUTE_PREFIXES[entry.prefix as keyof typeof ROUTE_PREFIXES]));
    }
  }
});

test("CLI fixture refuses embedded-only and ambiguous roles with complete marker diagnostics and no prompt content", () => {
  const privateText = "PRIVATE-DOCUMENT-MUST-NOT-APPEAR";
  function refused(prompt: string, count: number) {
    assert.throws(() => router.selectPromptRoute(prompt), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`match count ${count}`));
      for (const { name, prefix } of router.PROMPT_ROUTES) {
        assert.ok(error.message.includes(`${name}=${JSON.stringify(prefix)}`), name);
      }
      assert.ok(!error.message.includes(privateText));
      return true;
    });
  }
  refused(`${privateText}\n${Object.values(ROUTE_PREFIXES).join("\n")}`, 0);
  refused(` ${promptBuilders.SPEC_AUTHOR_PROMPT_PREFIX}\n${privateText}`, 0);
  const duplicate = { ...router.PROMPT_ROUTES[0]!, name: "DUPLICATE_SPEC_PREFIX" };
  router.PROMPT_ROUTES.push(duplicate);
  try {
    refused(`${promptBuilders.SPEC_AUTHOR_PROMPT_PREFIX}\n${privateText}`, 2);
  } finally {
    assert.equal(router.PROMPT_ROUTES.pop(), duplicate);
  }
  const child = spawnSync(process.execPath, [CLI_ROUTER], { input: privateText, encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /match count 0/);
  assert.ok(!child.stderr.includes(privateText));
  for (const [name, prefix] of Object.entries(ROUTE_PREFIXES)) {
    assert.ok(child.stderr.includes(`${name}=${JSON.stringify(prefix)}`), name);
  }
});

test("CLI fixture directly forwards exact stdin bytes to every selected emitter and preserves child exit status", () => {
  const mirror = mkdtempSync(join(process.cwd(), ".cli-router-bytes-"));
  try {
    const harness = join(mirror, "test", "fixtures", "harness");
    mkdirSync(harness, { recursive: true });
    mkdirSync(join(mirror, "src"));
    copyFileSync(resolve("src", "prompts.ts"), join(mirror, "src", "prompts.ts"));
    const fixture = join(harness, "emit-cli-run.mjs");
    copyFileSync(CLI_ROUTER, fixture);
    for (const emitter of new Set(router.PROMPT_ROUTES.map((route) => route.emitter))) {
      writeFileSync(join(harness, emitter), 'import { readFileSync } from "node:fs"; process.stdout.write(readFileSync(0)); process.stderr.write(`child stderr ${JSON.stringify(process.argv.slice(2))}`); process.exitCode = 7;\n');
    }
    for (const { builder, prompt, schema } of routingPrompts("# Wrapped\r\nUTF-8 🌙\r\n")) {
      const input = Buffer.concat([Buffer.from(prompt), Buffer.from([0, 255, 13, 10])]);
      // A patch dispatch's schema travels to the selected emitter; nothing else does.
      const schemaArgs = schema === undefined ? [] : ["--json-schema", JSON.stringify(schema)];
      const child = spawnSync(process.execPath, [fixture, "--model", "m", ...schemaArgs], { input });
      assert.equal(child.status, 7, child.stderr.toString());
      assert.deepEqual(child.stdout, input, `${builder}: router must forward original bytes, not decoded text`);
      assert.equal(child.stderr.toString(), `child stderr ${JSON.stringify(schemaArgs)}`);
    }
  } finally {
    rmSync(mirror, { recursive: true, force: true });
  }
});

/** `schema` is the --json-schema a patch dispatch sends; the answer is then read from structured_output. */
function runRouter(cwd: string, prompt: string, agentId: string, args: string[] = [], schema?: object): AgentResult {
  const schemaArgs = schema === undefined ? [] : ["--json-schema", JSON.stringify(schema)];
  const child = spawnSync(process.execPath, [CLI_ROUTER, ...args, "--model", "fixture-model", ...schemaArgs], {
    cwd, input: prompt, encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  const envelope = parseEnvelope(CLAUDE_CODE, child.stdout, schema !== undefined);
  const result = validateAgentResult(agentId, JSON.parse(envelope.resultText));
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.value;
}

function proposedChanges(result: AgentResult): Record<string, unknown> {
  assert.equal(result.status, "proposed");
  assert.ok(result.proposedContentChanges && typeof result.proposedContentChanges === "object");
  return result.proposedContentChanges as Record<string, unknown>;
}

test("CLI fixture composes existing emitters for all builder families with receiving-schema validation", () => {
  const root = mkdtempSync(join(process.cwd(), ".cli-router-schema-"));
  try {
    writeFileSync(join(root, "base.txt"), "worktree marker\n");
    const design = "# design\ndesign\n";
    const specResult = runRouter(root, buildSpecAuthorPrompt(SPEC_AUTHOR, design, VERIFICATION), SPEC_AUTHOR.id);
    const specText = proposedChanges(specResult).spec;
    assert.equal(typeof specText, "string");
    const spec = validateSpecDoc(specText as string);
    assert.ok(spec.ok, spec.ok ? "" : spec.reason);
    const scope = spec.value.declaredArtifacts;
    const specHash = sha256Hex(normalizeText(specText as string));
    const planResult = runRouter(root, buildPlanAuthorPrompt(PLAN_AUTHOR, specText as string, specHash, scope, VERIFICATION), PLAN_AUTHOR.id);
    const planText = proposedChanges(planResult).plan;
    assert.equal(typeof planText, "string");
    const plan = validatePlanDoc(planText as string);
    assert.ok(plan.ok, plan.ok ? "" : plan.reason);
    assert.equal(plan.value.planFor, specHash);

    for (const kind of ["spec", "plan"] as const) {
      const agent = kind === "spec" ? SPEC_AUTHOR : PLAN_AUTHOR;
      const prompt = kind === "spec"
        ? buildSpecSelfCritiquePrompt(agent, design, specText as string, PANEL, VERIFICATION)
        : buildPlanSelfCritiquePrompt(agent, specText as string, planText as string, specHash, scope, PANEL, VERIFICATION);
      const critique = validateSelfCritique(proposedChanges(runRouter(root, prompt, agent.id)).selfCritique);
      assert.ok(critique.ok, critique.ok ? "" : critique.reason);
      const artifact = kind === "spec" ? validateSpecDoc(critique.value.artifact) : validatePlanDoc(critique.value.artifact);
      assert.ok(artifact.ok, artifact.ok ? "" : artifact.reason);

      const reviewer = SPEC_REVIEWER_TRACEABILITY;
      const reviewPrompt = kind === "spec"
        ? buildSpecReviewPrompt(reviewer, design, specText as string)
        : buildPlanReviewPrompt(reviewer, planText as string, specText as string);
      const review = validateReviewerReports(proposedChanges(runRouter(root, reviewPrompt, reviewer.id)).findings, {
        agentId: reviewer.id, upstreamPrefix: kind === "spec" ? "upstream:design:" : "upstream:specification:",
      });
      assert.ok(review.ok, review.ok ? "" : review.reason);
      const findings = review.value.map((report, index) => ({
        findingId: index + 1, reports: [{ reviewerId: reviewer.id, ...report }],
      }));
      const reconciliationPrompt = kind === "spec"
        ? buildSpecReconcilePrompt(agent, design, specText as string, findings, VERIFICATION)
        : buildPlanReconcilePrompt(agent, specText as string, planText as string, specHash, scope, findings, VERIFICATION);
      const reconciled = proposedChanges(runRouter(root, reconciliationPrompt, agent.id));
      const revisedText = reconciled[kind];
      assert.equal(typeof revisedText, "string");
      const revisedSpec = validateSpecDoc(kind === "spec" ? revisedText as string : specText as string);
      const revisedPlan = validatePlanDoc(kind === "plan" ? revisedText as string : planText as string);
      assert.ok(revisedSpec.ok, revisedSpec.ok ? "" : revisedSpec.reason);
      assert.ok(revisedPlan.ok, revisedPlan.ok ? "" : revisedPlan.reason);
      const decisions = validateReconciliation(reconciled.decisions, {
        canonicalFindingIds: findings.map(({ findingId }) => findingId),
        governingSource: kind === "spec" ? "design" : "specification",
        governingText: kind === "spec" ? design : specText as string,
        beforeNormativeNodes: kind === "spec" ? specNormativeNodes(spec.value) : planNormativeNodes(plan.value),
        afterNormativeNodes: kind === "spec" ? specNormativeNodes(revisedSpec.value) : planNormativeNodes(revisedPlan.value),
        requireQuestions: kind === "spec",
      });
      assert.ok(decisions.ok, decisions.ok ? "" : decisions.reason);
      assert.deepEqual(decisions.value.conversions, []);
      assert.deepEqual(decisions.value.unclaimedNodes, []);
      assert.deepEqual(decisions.value.unclaimedRemovals, []);
    }

    const base = "b".repeat(40);
    const implementationPrompt = buildImplementationAuthorPrompt(IMPLEMENTER, planText as string, specText as string, scope, base, planPhases(plan.value.taskItems, 10)[0]!, [], VERIFICATION);
    const implemented = runRouter(root, implementationPrompt, IMPLEMENTER.id, [], PATCH_RESULT_SCHEMA);
    assert.equal(implemented.status, "proposed");
    const patches = implemented.proposedPatches!;
    assert.deepEqual(patches.flatMap((patch) => patch.files.map((file) => file.path)), scope);
    for (const patch of patches) {
      assert.equal(patch.baseCommit, base);
      for (const file of patch.files) {
        assert.equal(file.action, "add");
        assert.equal(typeof file.content, "string");
        const path = join(root, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.content!);
      }
    }
    assert.equal(runRouter(root, implementationPrompt, IMPLEMENTER.id, ["--implementation-mode", "non-proposed"], PATCH_RESULT_SCHEMA).status, "failed");
    assert.equal(runRouter(root, implementationPrompt, IMPLEMENTER.id, ["--implementation-mode", "base-mismatch"], PATCH_RESULT_SCHEMA).proposedPatches![0]!.baseCommit, "0".repeat(40));

    for (const mode of ["ok", "high", "low", "high-then-clean"]) {
      for (const reviewer of [CODE_REVIEWER_CORRECTNESS, CODE_REVIEWER_SECURITY, CODE_REVIEWER_STATE_INTEGRITY]) {
        const prompt = buildCodeReviewPrompt(reviewer, specText as string, planText as string, scope, "", base);
        const result = runRouter(root, prompt, reviewer.id, ["--code-review-mode", mode]);
        const reports = validateReviewerReports(proposedChanges(result).findings, { agentId: reviewer.id, upstreamPrefix: "upstream:plan:" });
        assert.ok(reports.ok, reports.ok ? "" : reports.reason);
        assert.equal(validateCodeReviewReports(reports.value, scope), null);
        const reportingSeat = mode === "high" ? CODE_REVIEWER_SECURITY : CODE_REVIEWER_CORRECTNESS;
        assert.equal(reports.value.length, mode !== "ok" && reviewer === reportingSeat ? 1 : 0);
        if (reports.value.length) assert.equal(reports.value[0]!.severity, mode === "low" ? "low" : "high");
      }
    }
    const remediationPrompt = buildCodeReviewRemediationPrompt(IMPLEMENTER, specText as string, planText as string, scope, base, scope, "", []);
    const remediated = runRouter(root, remediationPrompt, IMPLEMENTER.id, ["--code-review-mode", "high-then-clean"], PATCH_RESULT_SCHEMA);
    assert.equal(remediated.proposedPatches![0]!.baseCommit, base);
    const repaired = remediated.proposedPatches![0]!.files[0]!;
    assert.equal(repaired.path, scope[0]);
    assert.equal(repaired.action, "modify");
    writeFileSync(join(root, repaired.path), repaired.content!);
    const after = runRouter(root, buildCodeReviewPrompt(CODE_REVIEWER_CORRECTNESS, specText as string, planText as string, scope, "", base), CODE_REVIEWER_CORRECTNESS.id, ["--code-review-mode", "high-then-clean"]);
    assert.deepEqual(proposedChanges(after).findings, []);
    for (const mode of ["remediation-empty", "remediation-wrong-base", "remediation-outside-scope"]) {
      const result = runRouter(root, remediationPrompt, IMPLEMENTER.id, ["--code-review-mode", mode], PATCH_RESULT_SCHEMA);
      if (mode === "remediation-empty") assert.deepEqual(result.proposedPatches, []);
      if (mode === "remediation-wrong-base") assert.equal(result.proposedPatches![0]!.baseCommit, "0".repeat(40));
      if (mode === "remediation-outside-scope") assert.ok(!scope.includes(result.proposedPatches![0]!.files[0]!.path));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
