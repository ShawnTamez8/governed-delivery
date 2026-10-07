# Plan review: verification-aware-prompts

**Reviewed document:** plan.md

**Reviewed on:** 2026-10-05

**Source of these findings:** pasted into a `reconcile-findings` invocation on
2026-10-05 without a review file or a named reviewer. The text below is the pasted
findings, unedited. Line numbers refer to the plan as it stood before this
reconciliation.

**Hazards considered:** 3, 4, 6, 12, 13, 16, 17, 18 and 20, as weighed by the
reviewer. Hazard 16 (a remediation loop aimed at the wrong artifact) and hazard 17
(a reconciliation answering a finding by deleting the obligation) bear on findings
1 and 6.

## Findings

1. High — The unchanged reconciler can bypass the intended human decision.
   [Lines 24–25 (line 24)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:24) assume a human answers the new question, while [line 86 (line 86)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:86) excludes reconciliation prompts.
   buildSpecReconcilePrompt still permits upstream_blocking only when a missing decision prevents writing a testable acceptance criterion. A feature’s behavior can be testable while its build layout remains incompatible with verification. The reconciler can therefore choose upstream_follow_up, which creates no operator question; specReviewGate passes it. Merely recording an open decision does not establish the promised pause. The reconciliation contract needs to recognize this new kind of decision, with a test covering its route through spec_decision.
2. High — The question rule misses explicitly specified but incompatible stacks.
   [Lines 204–206 (line 204)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:204) require a question when the design does not specify the expected stack/layout. There is no required question when the design explicitly specifies a conflicting stack.
   For example, a design specifying a standalone Node HTTP server can encounter the same frozen npm run build → next build mismatch. The rendered argv does not reveal that script definition, and the implementer discovers it after scope is signed. Require an early question when compatibility cannot be established, including when the design names a stack. Its answer must establish the actual command requirements and necessary scope paths—not merely select a preferred framework.
3. Medium — “You cannot read the target repository” is false for supported invocation paths.
   [Lines 199–200 (line 199)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:199) hard-code this statement into both spec prompts. Spec dispatches inherit the invocation directory; they do not always run from the BuildWorks checkout. Launching from the target makes target files available through the read tools.
   This instruction would discourage inspection when it is possible and generate unnecessary questions. Preserve the authorized working-directory behavior, but describe access accurately or make the instruction conditional on known dispatch context.
4. Medium — The shared block misstates the verification lifecycle.
   [Lines 192–198 (line 192)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:192) say verification commands run “once,” and [lines 248–249 (line 248)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:248) repeat that claim.
   src/code-review-stage.ts runs the same frozen commands after each remediation commit. Also, an exit of zero can still fail verification because of output overflow or a changed/dirty checkout. The new block should accurately describe initial verification, subsequent remediation verification, and the integrity conditions that generated build/test scripts must satisfy.
5. Medium — The claimed prompt-size bound does not exist.
   [Lines 81–82 (line 81)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:81) assume the addition stays below 1 KB. parseGovernedConfig bounds neither command count nor token length; I confirmed it accepts a configuration containing a token over 1 MiB.
   Rendering that accepted config exceeds PROMPT_MAX_BYTES. Smaller additions can also push a later self-critique or implementation prompt over the ceiling after earlier dispatches have spent money. Replace the unsupported bound with defined overflow behavior and boundary tests; retain the existing refusal rather than truncating commands.
6. High — Later artifact-producing passes can undo the new guidance.
   [Lines 86 and 372 (line 372)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:372) exclude plan reconciliation and code-review remediation, although both produce artifacts subsequently judged by these commands.
   Plan reconciliation can append a verification-only task after the draft and self-critique obey the prohibition. Its validators do not reject that task’s meaning; if it forms a trailing phase, implementation still blocks because there is no patch to return—the documented hazard 20 failure. Remediation can likewise change code without receiving the verification guidance. Apply relevant instructions to the final producing passes, or explicitly narrow the feature’s guarantee. This also conflicts with [Task 5’s requirement to inform every judged agent (line 322)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:322).
7. Medium — Valid command data can break fixture routing despite compliant literal wording.
   [Lines 209–210 (line 209)](/C:/Users/Shawn-work/repositories/governed-delivery/docs/features/verification-aware-prompts/plan.md:209) prohibit routing words in new prose, but rendered command names and tokens can contain them.
   I reproduced this with the valid command name self-critique and argv ["node", "--version"]. Adding the proposed block to a spec draft made emit-spec-stage.mjs return proposedContentChanges.selfCritique, leaving the required draft spec absent. The production concern here is fixture-backed dispatches and misleading validation. Tests must cover routing markers in command data, and emitter routing must distinguish instructions from embedded configuration.

The reviewer's closing note: the documentation checker passed with warnings, no
repository files were changed and no provider spend occurred, and model compliance
and question-selection behavior remain unmeasured.

---

## Reconciliation

**Date:** 2026-10-05
**Disposition:** 7 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

Three findings (1, 2, 6) needed an operator decision and got one. Findings 5, 6 and 7
are accepted with a named part set aside; those parts are listed under Out of scope in
the plan, each with a revisit trigger, and are not counted as deferred findings.

### Verdicts

- **Accepted — The unchanged reconciler can bypass the intended human decision
  (finding 1):** Verified: `buildSpecReconcilePrompt` allows `upstream_blocking`, the
  only route that opens an operator question, only when no criterion can be written.
  Task 3 adds a rule to that prompt: a finding whose question begins `Verification:`
  is the one exception and routes `upstream_blocking`, with options that name the
  stack and the declared artifact paths. The operator chose a prompt rule only, so the
  plan now promises a recorded question and a prompt asking for the pause, not a
  guaranteed pause; a deterministic refusal is set aside in Out of scope. Task 3 adds
  a route test through `spec_decision` with a new fixture marker, and the Verification
  section says that test cannot show the reconciler's choice.
- **Accepted — The question rule misses explicitly specified but incompatible stacks
  (finding 2):** The rule in Task 2 now applies whenever neither the design nor the
  files the author can read establish compatibility, even when the design names a
  stack, and the question asks what each command requires and which artifact paths
  that needs. The operator chose this over the narrower rule. Consequence recorded in
  the plan: on a launch from the BuildWorks checkout it applies to nearly every run
  whose commands inspect code, and the effect on operator load is unmeasured.
- **Accepted — "You cannot read the target repository" is false for supported
  invocation paths (finding 3):** Verified: only the implementation stage sets `cwd`,
  and a bare `buildworks` call targets the current directory. The spec rule now says
  the working directory may not be the target and to treat a file as evidence only if
  it belongs to the repository the design describes. The plan's blocker states both
  launch cases. Computing the fact from the launch directory was not adopted: it adds
  a path comparison on Windows and a second source of truth.
- **Accepted — The shared block misstates the verification lifecycle (finding 4):**
  Verified against `src/code-review-stage.ts` and `src/commit-verification.ts`. The
  block now says verification runs after implementation and after each code-review
  remediation commit, and that a command passes only within its time and output limits
  and with the checkout left exactly as committed. The implementer line says the same.
- **Accepted — The claimed prompt-size bound does not exist (finding 5):** Verified
  that `parseGovernedConfig` bounds neither count nor token length. The "under 1 KB"
  claim is gone. The plan states the defined behavior, the existing refusal in
  `dispatchOnce`, with no truncation, and Task 2 adds a test that parses the oversize
  config with the real parser and tests the exact boundary. Set aside: a pre-spend
  bound on `governed.yaml`, because it changes what the file accepts; an oversize
  config can still block after earlier dispatches have spent.
- **Accepted — Later artifact-producing passes can undo the new guidance (finding
  6):** Per the operator, the spec reconcile, spec decision fold and plan reconcile
  prompts now carry the commands and a role rule (Tasks 3 and 5), with the plan
  reconcile rule forbidding an added verify-only task and no rule that removes
  anything. Set aside: code-review remediation. Changing it with the spec and plan
  reconcile prompts would span the `code_review`, `spec_review` and `plan_review`
  prompts in one change, against the working rule about changing `spec_review` or
  `plan_review` while maintaining the `code_review` loop. The residual is recorded in
  Out of scope and in hazard 21 (Task 6).
- **Accepted — Valid command data can break fixture routing despite compliant literal
  wording (finding 7):** Verified: the stage emitters route by `stdin.includes(...)`
  over the whole prompt. Task 2 adds a guard that no command name or token in the
  recorded config or any stage-test `VERIFICATION` constant contains a routing marker,
  and a break test for it. Set aside: anchoring the emitters to the instruction text.
  The same exposure already exists for design text, and the `FIXTURE-*` test modes
  rely on routing over embedded data. Production dispatches are unaffected.
