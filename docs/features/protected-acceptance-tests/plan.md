# Executable Acceptance Criteria Implementation Plan

**Status:** Reconciled

**Goal:** On a run that opts in, an independent test-author agent turns every acceptance criterion of the approved specification into browser tests before the first implementation phase. The system validates those tests, then holds them read-only for every later agent, and runs them in a browser-capable sandbox at every verification point. Before any of that is wired into the chain, the test author is evaluated on the recorded calculator run.

**Source:**
- `docs/proposals/sandboxed-delivery-rework.md`, change 4 and its 2026-10-20 revision: interaction criteria need a real browser driven with trusted input; the test author is a distinct agent; tests are protected from the implementer.
- The operator, 2026-10-20: tests are not written beforehand by the operator. The operator asked for a deeper version of this one change, not a wider one, as an engineer who has built agentic harnesses would plan it, grounded in research where needed.
- **The first benchmark** is `test/fixtures/recorded/code-review-web-calculator-remediation-regression.json`. It holds:
  - the approved specification and plan in full (`approvedDocuments.specFull`, `planFull`, 23 acceptance criteria);
  - the delivered files at both reviewed commits (`trees`);
  - the two findings: 9 at `b5d42890` and 10 at `bc57eb74`.
- **External grounding:**
  - Zhong, Raghunathan and Carlini, *ImpossibleBench* (arXiv 2510.20270, ICLR 2026):
    - full test access gives the highest cheating rates;
    - read-only tests keep legitimate performance and stop test edits, but not special-casing;
    - an explicit abort path cut GPT-5's cheating from 54% to 9%;
    - prompt wording moves cheating rates substantially, so prompts are ablated before use;
    - LLM monitors caught only 42–65% of cheating on SWE-bench-style tasks, so a monitor is not the only safeguard.
  - OpenAI, *Monitoring Reasoning Models for Misbehavior* (arXiv 2503.11926): a frontier agent made `verify` always return true to pass unit tests.
  - SWE-bench's grading split: FAIL_TO_PASS tests prove the change, and PASS_TO_PASS tests prove nothing regressed.
  - Playwright's documented practice: role-based locators, auto-waiting web-first assertions, no fixed waits, `--repeat-each`, and a JSON reporter.

**Hazards considered:**
- **18 (correctness never inspected).** This plan's reason to exist. Acceptance becomes an executed check, not `node --version`.
- **13 (specifications inventing obligations) and 17 (deleting the obligation).** Tests trace to criteria by ID in their titles, checked structurally. A criterion with no test, or a test with no criterion, refuses the suite, so neither can disappear silently.
- **4 (fixtures and code agreeing).**
  - The test author never sees an implementation: it writes before phase 1.
  - Its evaluation expectations come from the recorded findings 9 and 10, not from this session.
  - The one constructed tree, a control that narrows the recorded remediation to the theme control, is used only to separate a test's own errors from real defects. It never sets a pass threshold by itself.
- **15 (read-only by declaration).** Read-only is enforced twice and proven by breaking it: a read-only mount in every agent container, and the boundary refusal in `commitWorkspace`.
- **21 (agents never told their gate).** The implementer, self-review and remediation can read and run the suite with the system's own command before replying.
- **23 (a fix blind to the decisions behind the code).** The recorded remediation broke a behaviour no executed check held. A suite that covers each criterion's defined conditions holds it.
- **7 (retries that vary nothing).**
  - No retry is added. `--repeat-each 2` is a determinism measurement, not a second chance: a test whose two results differ is reported as flaky, never as passed.
  - An acceptance failure at verification still blocks, as any verification failure does.
- **1 (output shapes).** The test author writes files through the tool server and replies with the structured status the patch dispatches use. No file content travels in a reply.
- **3 (constrained fields).** Every rule the test author must meet is checked deterministically after it replies: coverage by ID, a red baseline, determinism, and forbidden calls. None is left as a prompt request.
- **19 (inactivity as wall clock).** Browser suites are slower than a version probe. The suite runs under the existing verification command ceiling, and the spike measures the calculator suite's time against it.
- **22 (ignored files after a stage that writes them).** Browser profiles and reports go to the container's temporary directories or stdout, never the worktree. `verifyCommit`'s cleanup handles anything ignored.
- **Not engaged:** 2, 5, 6, 8 to 12, 14, 16, 20 and 24. Delivery, approval payload, review panels and phases are unchanged in shape.

**Assumptions:**
- **[Verified]** Delivery requires only that every declared artifact appears in the patch range (`src/delivery-stage.ts`). A system-committed path outside the signed scope, as derived files already are, does not block it.
- **[Verified]** The approval binds the frozen profile's hash (`approval.profile_hash`). A frozen `acceptance` block is therefore covered by the operator's signature without changing the approval payload.
- **[Verified]** `invalidDispatchSettingsReason` requires a setting only for the agents a profile froze. A new agent definition changes nothing for stored runs. A new top-level profile field that nothing on the snapshot path reads is execution-only under the 2026-10-20 rule (`docs/features/inspectable-frozen-profiles/plan.md`), so stored runs stay inspectable. No policy field is added, because a missing policy field makes a stored run uninspectable.
- **[Verified]** The work container already overlays one read-only mount on the worktree (`<worktree>/.git` at `/work/.git:ro`, `createSandbox` in `src/container.ts`). A second overlay for the acceptance directory uses the same mechanism.
- **[Verified]** `@playwright/test` and `playwright-core` are both at 1.64.1, the registry's `latest` on 2026-10-20.
- **[Verified]** The only starter is `static-web`, whose pages open from the checkout. This slice supports static pages opened from the worktree (`file://`). A target that must start a server first is outside it; see "Not in this plan".
- **[Unknown, settled by Task 1]** Whether Chromium launches inside the frozen limits as `node`, whether `@playwright/test` loads from the image, not from a `node_modules` an agent could plant in the worktree, and how long the calculator suite takes.
- **[Unknown, settled by Task 4]** Whether a model writes tests good enough to rely on. Every task that wires the author into the chain depends on that evaluation passing.

**Approach:**
- **One runner, owned by the system.**
  - The image gains `@playwright/test` 1.64.1 and its Chromium under `/opt/bw-browser`, plus a committed `container/acceptance.config.mjs` copied into the image.
  - The image's cache identity covers every file the build copies, not just the Dockerfile. Today `findSandboxImage` (`src/container.ts`) names the tag by the Dockerfile's hash alone. A config-only edit would therefore reuse the old image, with the old config in it, under the old tag. The tag becomes a hash over every file in `container/`, in sorted path order, each path with its bytes.
  - The config fixes the reporter (JSON to stdout), four workers with each test scheduled on its own (`fullyParallel`), retries 0, `forbidOnly`, the per-test timeout, headless Chromium and `file:///work/` as `baseURL`. The work container runs with `--init`, so the orphans Chromium leaves are reaped (Task 4 evaluation record, round 1).
  - The command is the system's, never a model's or the target's: `node /opt/bw-browser/node_modules/@playwright/test/cli.js test --config /opt/bw-browser/acceptance.config.mjs --repeat-each 2 acceptance/<slug>/`.
  - No `governed.yaml` entry, npm script or target file takes part in the invocation.
- **Opt-in at `new-run`.** `new-run --acceptance-tests` freezes a top-level `acceptance: { dir: "acceptance/<slug>/", repeatEach: 2 }` (otherwise `null`), and the approval covers it through the profile hash. The driver passes the flag. Guided mode does not offer it until the paid benchmark has run.
- **The consent preview names the extra dispatch.** For an opted-in run, `formatRunPreview` (`src/operator-output.ts`) counts one more implementation dispatch, so the ceiling becomes `implementationMaxPhases + 2`. Its implementation line also says that one test-author dispatch precedes the phases. With acceptance off, the preview is byte-identical to today.
- **Authoring.** The implementation stage gains a first step, before phase 1, when `acceptance` is not null.
  - **Why a step, not a stage.** Section 5's deferred `test_authoring` stage would add a stage kind to the pinned sequence, the dashboard, the consent groups and the boundary interpretation. Each of those would need rework, and none changes what is proven.
  - **The dispatch.** One dispatch of a new agent, `acceptance-test-author`, with its own frozen setting, through the tool server in its own sandbox. It receives the approved specification, the approved plan for interface names only, and the rules below. It writes only under `acceptance/<slug>/`, and it can run the suite with the system command against the code as it stands, which has no implementation yet.
  - **The commit.** `commitWorkspace`, with a scope of exactly that directory, commits the suite as the system before phase 1's base is taken. So the implementation diff that reviewers judge does not include it.
- **The validity gate.** The system checks the suite before phase 1 is paid for, deterministically, from the JSON report and the files. A failure blocks the run with every reason named, and there is no retry. A run blocked here costs one dispatch, not the implementation.
  1. **Loads:** the report has no load errors and at least one test.
  2. **Traces:** every test title begins with an `AC-NNN` that the approved specification defines, and every defined criterion has at least one test.
  3. **Red where it must be, for the right reason.** The baseline is the suite commit, plus a system stub when needed.
     - **The stub.** The entry page is `index.html` at the repository root, a rule the author prompt states. When the suite commit has none, as in a greenfield target, the gate runs in a throwaway checkout of the suite commit. There the system writes a blank `index.html` (`<!doctype html><html><head><title></title></head><body></body></html>`), so navigation succeeds and each test reaches its own interactions. The run worktree is never touched.
     - **Valid red evidence.** A failure counts as red only when its first error comes from a Playwright locator action or an `expect` matcher, raised in the test body. The error's location must be inside the suite's own file and outside any hook. A typical one is `expect(locator).toHaveText` failing, or `locator.click` timing out on an element the blank page lacks.
     - **Hooks.** No report field can place an error outside a hook declared after its test (Task 1 spike record). So gate 5 refuses every hook, and the classifier classes as `hook` any error located in a file that declares one, as defence in depth.
     - **Broken tests.** Each of these refuses the suite, naming the test and its error:
       - a navigation error (`net::ERR_*`), including a page other than the stubbed `index.html`;
       - a browser launch or fixture failure;
       - an error raised in a `beforeEach`, `beforeAll`, `afterEach` or `afterAll` hook;
       - an exception thrown by the test's own code, such as a `TypeError`;
       - a matcher that refuses its own arguments, such as `toHaveText(undefined)` (`expected value must be a string or regular expression`). Its message opens with the same matcher header as a mismatch, with or without a custom message, but no change to the page can satisfy it;
       - a timeout of the whole test outside a locator action or matcher;
       - any load error.

       "Failed on both repeats" is not by itself valid red.
     - **Classification.** The parser keeps each result's status, its `errors[].message` and `errors[].location`, and the attachment-free `stack`. The classification rule is pinned against reports the real runner produced in Task 1, one per case above, never against a hand-written report (hazard 4).
     - **Already satisfied.** A test that passes at the baseline is recorded as a regression guard (PASS_TO_PASS). A criterion may be covered entirely by guards when its behaviour already exists, as in an existing static application. Then it is recorded as `already_satisfied` in the gate record, the run's report and the code reviewers' prompt, so the operator and the reviewers see the author's claim. To keep such a test from being vacuous, the lint (gate 5) requires every test to run at least one retrying assertion.
     - **What is refused.** A criterion with neither a valid red test nor a passing guard is refused.
  4. **Deterministic:** under `--repeat-each 2`, no test's two results differ, and no test's two error classes differ.
  5. **The lint.** It is a deterministic check over the committed files, with comments ignored. It encodes the recorded failure class, since untrusted events never trigger a focused button's activation, and it holds the operator's 2026-10-20 additions. No test file may contain any of these:
     - **Untrusted input:** `dispatchEvent(`, or a keyboard, mouse, pointer, touch or input event constructor;
     - **Fixed waits and hard-coded timeouts:** `waitForTimeout(`, `setTimeout(`, `setInterval(`, `test.setTimeout(`, `test.slow(`, `setDefaultTimeout(`, `setDefaultNavigationTimeout(`, or a `timeout:` option;
     - **Network idle:** `networkidle`, in any case and any form;
     - **Hooks:** `beforeEach(`, `beforeAll(`, `afterEach(` or `afterAll(`, so each test opens its own page;
     - **A focused test:** `.only(`.

     It also requires:
     - **Retrying assertions.** Every assertion is written `await expect(<subject>)`, optionally followed by `.not`, then one of Playwright's auto-retrying matchers. A subject that awaits a value (`expect(await …)`) is refused, and so are `expect.soft`, `expect.poll` and `expect.configure`.
     - **No unsettled promise.** Every `expect(` and every Playwright page, locator, keyboard or mouse action is settled: awaited, or returned to a caller that awaits it. An array of promises, such as a `map` with an async callback, is settled only when each of its promises is awaited, as an awaited `Promise.all` over it does; awaiting the array itself settles nothing.
     - **The import.** The file's first statement is the import the spike chose, `const { test, expect } = await import(process.env.BW_PLAYWRIGHT_TEST);`.
     - **An assertion the test runs.** Every test runs at least one retrying assertion: in its own body, or in a file-local helper or callback that the test calls or passes to a call. An assertion inside a function the test declares and neither calls nor passes on does not count. The assertion's subject is left to Playwright, which refuses anything but a locator or page at run time.
- **Read-only for everyone after the author, including the system's own verification.**
  - Every later container that holds the worktree mounts `<worktree>/acceptance/<slug>` read-only over itself, as `.git` is today. That covers the phase, self-review and remediation work containers, and every verification sandbox: the verification stage, remediation verification, and the authoring step's gate run.
  - Verification matters as much as the agents' containers. A target's verify commands run before the suite in the same writable container (`verifyCommit`, `src/commit-verification.ts`), and they can execute agent-written code: an npm lifecycle script, or a build step. A process such a command leaves running could change the suite during its run and restore it before the post-command Git check. A read-only mount makes that impossible, not merely detectable. The protection covers every path that reaches the suite's bytes: on a case-insensitive host, such as Docker on Windows, a differently cased path such as `/work/Acceptance/<slug>/` reaches the same files through the writable `/work` mount, so a read-only mount at the exact path is not enough there.
  - `commitWorkspace` also refuses any diff under it, as defence in depth.
  - The spec write and the approval refuse a specification that declares a path under `acceptance/`.

  Read-only rather than hidden is ImpossibleBench's recommendation where legitimate performance matters. The two residual attacks are special-casing and detecting the test environment. They are covered by the reviewer lens and the abort path below, not by hiding.
- **An abort path.** The implementer, self-review and remediation prompts say that a test which contradicts the approved specification must not be special-cased: return `blocked`, naming the test in `incompleteTasks`. The stage records that as `implementation.acceptance.disputed`, so the operator sees a test-author error as one, not as an implementation failure.
- **Run at every verification point.** Both `verifyCommit` callers append the system acceptance command after the frozen verify commands. The stage parses the JSON report from the command's retained log and records per-test outcomes in `result.json`.
  - A failing test blocks, naming its title, so the criterion ID is in the block reason.
  - A test whose repeated results differ blocks as `flaky`, a reason that points at the test, not the code.
- **The reviewers' added lens.** On runs with a suite, every code reviewer's prompt adds that code which recognizes the test environment or special-cases test inputs (for example `navigator.webdriver`, or matching a test's literal values) is a high-severity defect. It also tells the reviewer where the read-only suite is, so it can read it.

**Not in this plan:**
- A server-backed target; the config would need a frozen `webServer` command.
- Prior features' suites as regression guards in later runs. SWE-bench's PASS_TO_PASS across features is the natural next step, but it changes what a later run may break.
- A dedicated test-review panel.
- Mutation testing of the suite.
- Feeding an acceptance failure into a remediation round instead of blocking. That interacts with change 7 and section 19.
- Hidden tests with result-only access.

Each is a separate decision with its own evidence.

**Affected areas:**
- **Create:**
  - `container/acceptance.config.mjs`;
  - `src/agents/acceptance-test-author.ts`;
  - `src/acceptance.ts`: the command, the report parser, the validity gate and the lint;
  - `scripts/test-author-evaluation.ts`;
  - `test/acceptance.test.ts` and `test/acceptance-engine.test.ts`;
  - `test/fixtures/recorded/acceptance-report-*.json`, captured from real runs in Task 2.
- **Modify, code:**
  - `container/Dockerfile`;
  - `src/container.ts` (`findSandboxImage`'s tag over every file in `container/`);
  - `src/commit-verification.ts` (`verifyCommit` passes the read-only overlay);
  - `src/operator-output.ts` (`formatRunPreview`);
  - `src/policy.ts` (the seeded setting for the new agent; no policy field);
  - `src/profile.ts` (`acceptance`, execution-only);
  - `src/run-intake.ts` and `src/cli.ts` (`new-run --acceptance-tests`);
  - `src/container.ts` (an optional read-only overlay);
  - `src/dispatch.ts` (`dispatchInSandbox` passes it);
  - `src/workspace-commit.ts` (the refusal);
  - `src/implementation-stage.ts` (the authoring step and the overlay on phases and self-review);
  - `src/code-review-stage.ts` (the overlay on remediation, and the suite in remediation verification);
  - `src/verification-stage.ts`;
  - `src/spec-doc.ts`, `src/spec-stage.ts`, `src/spec-decision-stage.ts` and `src/approval-stage.ts` (the declared-path refusal);
  - `src/prompts.ts` (the test-author prompt, the implementer and remediation additions, and the reviewer lens);
  - `.claude/skills/run-buildworks/driver.mjs` (`--acceptance-tests`).
- **Modify, documents:**
  - `ARCHITECTURE.md` sections 5 (a note that test authoring is an implementation step, so `test_authoring` stays deferred as a stage), 7, 11 and 23;
  - `README.md`;
  - `docs/hazards.md` entries 18 and 23;
  - `.claude/skills/run-buildworks/SKILL.md`;
  - `CLAUDE.md` and `AGENTS.md`;
  - `docs/proposals/sandboxed-delivery-rework.md` (change 4's status).

**Known blockers:**
- **An operator decision.** Change 4 needs a section 23 entry. Tasks 1 to 3 are free and local; Task 4 is a small paid evaluation that needs its own consent.
- **The build host needs internet** for the browser download when the image is built. The run's egress allowlist does not change.
- **Image size and build time grow.** `ensureImage` allows 30 minutes, and Task 1 records both.
- **Engine-only tests** skip by name without Docker.
- **A known environment failure.** The PowerShell transport test in `test/cli-operator.test.ts` fails from the assistant's shell and passes in the operator's terminal.

**Blast radius** (searched 2026-10-20):
- **`verifyCommit`:** `src/verification-stage.ts` and `src/code-review-stage.ts`, which gain one appended command and the read-only overlay each. The authoring step's gate run is a third call.
- **`findSandboxImage` and `ensureImage`:**
  - callers are `src/readiness.ts`, `new-run`'s image freeze and `doctor`;
  - the tag's value changes once for every operator, so the first `new-run` after the change builds a new image;
  - a run already frozen keeps its `imageId` and is checked by `imagePresent`, which never reads the tag.
- **`formatRunPreview`:** one caller, `src/run-command.ts`, and `test/operator-output.test.ts`.
- **`commitWorkspace`:** three calls in `src/implementation-stage.ts` and `src/code-review-stage.ts`, which gain the acceptance directory. The authoring step is a fourth call.
- **`createSandbox` and `withSandbox`:**
  - `src/commit-verification.ts`, `src/derived-artifacts.ts`, `src/dispatch.ts` and `src/project-bootstrap.ts`;
  - the overlay is optional and absent by default, so the argv is byte-identical for every existing caller;
  - `test/container.test.ts` criterion 2 asserts the mounts and gains the overlay case.
- **`writeSpecDoc`:** `src/spec-stage.ts`, `src/spec-decision-stage.ts` and `src/spec-doc.ts`. The `derivedArtifactRefusals` precedent also has a second consumer in `src/approval-stage.ts`. Tests: `test/spec-doc.test.ts` and `test/approval-stage.test.ts`.
- **The prompt builders** in `src/prompts.ts`:
  - the implementer, self-review and remediation builders;
  - `buildCodeReviewPrompt`;
  - `test/prompts.test.ts` pins sentences in `CONSTRAINT_STRINGS`;
  - every prompt is byte-identical when `acceptance` is null.
- **The agent registry** (`src/agents.ts`, `src/agents/`). A new author agent must not be counted as a `code-findings` reviewer, so the panel staffing check must not change. A test pins that.
- **`new-run`** gains one optional flag. `test/cli.test.ts` and the help text tests change.

**Verification:**
- **Component:** each task's tests. Every new guard is broken and restored: copy the file, mutate it, watch the test fail, restore, and compare SHA-256.
- **Model evaluation:** Task 4, against pre-registered thresholds.
- **Regression:** `npm run typecheck`, `npm run check:docs`, and the full serial no-engine suite with 0 failures and only the named skips. Then `test/container.test.ts` and `test/acceptance-engine.test.ts` on the engine.
- **End to end, paid, separately authorized:** Task 11.

**Decision needed (operator):**
- **Settled 2026-10-21 (operator: "we'll stick with Sonnet-medium").** The test author's seeded model and effort are Sonnet 5.5 `medium`, chosen from Task 4's results.
- **Settled 2026-10-20 (operator: "Allow, as regression guards").** An existing static application is in scope. A criterion already satisfied at the baseline is accepted as `already_satisfied`, its tests become regression guards, and the claim is shown to the reviewers.
- **Settled 2026-10-20, when the implementation was invoked:**
  - **Authorization.** The section 23 entry records that the operator authorized change 4 as this plan states it, by invoking its implementation, as change 1's entry does.
  - **Gate failures.** A gate 2 or gate 3 failure blocks the run; it does not pause it.
  - **Task 4.** It has consent up to $5, if Tasks 1 to 3 pass their exit criteria.
- **Settled 2026-10-20, after Task 1 stopped** (operator: "Option 1 works. Ensure the tests use playwrights retrying assertions, no hardcoded timeouts or delays, no missing awaits before async calls, no waitForNetworkIdle"):
  - Gate 5 refuses hooks.
  - It enforces those four rules as written there.
  - The author prompt states each of them.

---

## Tasks

### Task 1: Spike — the system runner in the sandbox

**Depends on:** this plan's approval. Free.

**Files:**
- Scratch only, under the session scratchpad.
- Modify: this plan, by recording the result below Task 11.

**Steps:**
- Build a candidate image from the committed Dockerfile plus:

  ```dockerfile
  RUN npm install --prefix /opt/bw-browser @playwright/test@1.64.1 \
   && cd /opt/bw-browser && npx playwright install --with-deps chromium \
   && chmod -R a+rX /opt/bw-browser
  ENV PLAYWRIGHT_BROWSERS_PATH=/opt/bw-browser/browsers
  COPY acceptance.config.mjs /opt/bw-browser/acceptance.config.mjs
  ```

  Pin `PLAYWRIGHT_BROWSERS_PATH` before the install line, in the order the spike proves works. Record the build time and size against the current image.
- Run every probe as `--user node --cpus 2 --memory 4g --pids-limit 512 --network none`, through the system command.
  1. **Launch.** Chromium opens `file:///work/index.html` through `baseURL`.
  2. **Trusted input, positive.** `page.keyboard.press("Enter")` on a focused button fires its click.
  3. **Untrusted input, negative.** A `dispatchEvent` keydown does not fire it.
  4. **Resolution.** With a decoy `/work/node_modules/@playwright/test` that exports a `test` which always passes, the suite still runs the image's runner, and a failing test still fails. If Playwright resolves the test file's import from the worktree, switch the test files to `const { test, expect } = await import(process.env.BW_PLAYWRIGHT_TEST)`, with that variable added to the seeded sandbox environment, and rerun this probe.
  5. **Clean worktree.** After a run, `git status --porcelain --ignored` in the mounted directory shows nothing new.
  6. **Report.** The JSON report on stdout names each test's title, and both results under `--repeat-each 2`, each with `errors[].message`, `errors[].location` and `stack`. Capture one real report per case, as raw material for Task 2's recorded fixtures:
     - a pass;
     - a valid red from an `expect` matcher;
     - a valid red from a locator action timing out on the blank stub page;
     - a navigation error, from a test that opens a page the stub does not provide;
     - a browser launch failure, forced by pointing `PLAYWRIGHT_BROWSERS_PATH` at an empty directory for that probe only;
     - an error thrown in a `beforeEach`;
     - a `TypeError` in a test body;
     - a flaky test that alternates by `repeatEachIndex`;
     - a load error.

     For each case, record whether the report's fields alone tell it apart from a valid red. If two cases cannot be told apart by any retained field, stop and report: gate 3's rule depends on it.
  7. **The stub.** With the blank `index.html` written in a throwaway checkout, a test that clicks a button by role fails as a locator timeout, not as a navigation error.
  8. **Time.** A three-test suite against the recorded `b5d42890` tree, under the verification command ceiling.

**Exit criteria.** Every probe behaves as stated. If any fails, stop and report rather than adjusting the criterion.

**Task completion evidence:** the dated spike record: probe outputs, sizes, times and the chosen import form.

### Task 2: The image, the runner and the report parser

**Depends on:** Task 1 and the section 23 decision.

**Files:**
- Modify: `container/Dockerfile`. Create: `container/acceptance.config.mjs`. Both carry what Task 1 proved, with a comment naming this plan.
- Modify: `src/container.ts`. Add `sandboxImageTag(dir)`: `bw-sandbox:` plus the first 12 hex digits of a SHA-256 over every file under `dir`, in sorted repository-relative path order, each fed as its path, a NUL, its bytes and a NUL. `findSandboxImage` uses it in place of the Dockerfile-only hash. Update `ensureImage`'s comment.
- Create: `src/acceptance.ts`:
  - `acceptanceCommand(dir, repeatEach): VerifyCommand`, named `acceptance`;
  - `readAcceptanceReport(log)`. It parses the JSON reporter output after the log's header line into `{ loadErrors, tests: [{ title, file, results: [{ status, errors: [{ message, location, stack }] }] }] }`, or a named refusal when it cannot be parsed.
  - `classifyFailure(result, suiteFiles)`. It returns `valid_red`, `navigation`, `launch`, `hook`, `test_code` or `test_timeout`, by the rule in "Approach" gate 3, using only the retained fields.
  - `classifyAcceptance(report)`. It gives each test `pass`, `fail` or `flaky`. A test is `flaky` when its two results differ in status or in failure class.
- Create: `test/fixtures/recorded/acceptance-report-<case>.json`, one per Task 1 case, each with a provenance block.
- Create: `test/acceptance.test.ts`.

**Steps:**
- **Tests:**
  - **Over the recorded reports only,** since the expected values come from the real runner:
    - each report parses;
    - each case's failure gets its own class, and only the two valid-red reports classify as `valid_red`;
    - the flaky test is `flaky`, never `pass`;
    - the load-error report yields `loadErrors > 0`;
    - a truncated log is refused by name.
  - **The image tag,** over a temporary copy of `container/`:
    - changing only `acceptance.config.mjs` changes the tag;
    - changing nothing keeps it;
    - renaming a file changes it.
  - **A frozen run:** a profile whose `sandbox.imageId` names the old image still passes `requireImage` while that image is present. The tag is not read on that path; prove it with the Docker stand-in.
- **Break-tests:**
  - classify a test with mixed results as `pass`: the flaky test fails;
  - classify a navigation error as `valid_red`: its test fails;
  - hash only the Dockerfile again: the config-change tag test fails.
- Verify: `node --test test/acceptance.test.ts test/container.test.ts`, then `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the tests, the three break-test failures, and the new image tag's ID.

### Task 3: The validity gate as a pure function

**Depends on:** Task 2.

**Files:**
- Modify: `src/acceptance.ts`. Add `validateAcceptanceSuite({ report, files, criteria })`, which returns every refusal, not only the first: gates 1 to 5 in "Approach". `criteria` is the list of `AC-NNN` IDs that `src/spec-doc.ts` already parses from the approved specification. `files` is each committed file's path and content.
- Modify: `test/acceptance.test.ts`.

**Steps:**
- **Tests,** with reports built from the recorded case reports in Task 2:
  - a suite covering every criterion with valid red tests passes;
  - each of these is refused, its reason named:
    - an uncovered criterion;
    - a title with an unknown ID;
    - a criterion whose only failing test failed by navigation, launch, hook, test code or whole-test timeout;
    - a flaky test;
    - a load error;
    - each forbidden call, including each hook and `networkidle`;
    - a test with no `expect(` on a page locator;
    - an `expect(` or a page or locator action without `await`, `expect(await …)`, a non-retrying matcher, and a missing or different import line;
  - a criterion covered only by passing tests is accepted as `already_satisfied`, each of its tests recorded as a regression guard;
  - a guard beside a valid red test for the same criterion passes, and the criterion is not marked `already_satisfied`.
- **Break-tests:**
  - drop the coverage check: the uncovered test fails;
  - drop the `dispatchEvent(` lint: its test fails;
  - drop the missing-`await` check: its test fails;
  - treat flaky as passing: its test fails;
  - count any failure as red: the navigation-failure test fails.
- Verify: `node --test test/acceptance.test.ts`. Expected: pass.

**Task completion evidence:** the tests and four break-test failures.

### Task 4: Evaluate the test author on the recorded run before wiring it in

**Depends on:** Tasks 1 to 3, and the operator's consent to this spend. Estimated under $5 at the two settings below, three samples each; the script prints each dispatch's cost and stops at a $5 ceiling.

**Files:**
- Create: `src/agents/acceptance-test-author.ts`: the definition, read-only outside its directory through the tool server. Its role is author; it is not a `code-findings` reviewer.
- Modify: `src/prompts.ts`. Add `buildAcceptanceTestAuthorPrompt(spec, plan, dir)`. Each rule is on one source line:
  - the acceptance criteria are the source of truth, and the plan is read only for interface names;
  - write one or more tests per criterion, titled `AC-NNN <criterion's words>`;
  - where the specification defines the conditions a criterion holds under, test every defined variant. The calculator's example is "with focus on the page document … any element of the calculator page".
  - find elements by role and accessible name, assert with auto-waiting `expect`, and never use fixed waits;
  - every assertion is `await expect(<locator>)` with an auto-retrying matcher, and never `expect(await …)`;
  - `await` every Playwright action and every `expect`;
  - set no timeout, delay or `networkidle` wait;
  - write no hooks: each test opens its own page;
  - begin each file with the exact import line gate 5 requires;
  - use only trusted input (`page.keyboard`, `page.click`) and never `dispatchEvent`;
  - every page is opened from `index.html` at the repository root; when it does not exist yet, the system checks the suite against a blank page;
  - a test for behaviour that does not exist yet must fail on an assertion or a locator, not on navigation or its own error; a test for behaviour that already exists may pass, and is kept as a regression guard;
  - run the suite with the given command before replying;
  - reply with the structured status;
  - if a criterion cannot be tested in a browser, return `blocked`, naming it.
- Create: `scripts/test-author-evaluation.ts`, modelled on `scripts/systemone-format-evaluation.ts`.
  - For each setting, Sonnet 5.5 `medium` and Opus 5.5 `high`, it makes three dispatches of the test author in a fresh sandbox. Each sandbox holds a repository built as `prepareTarget()` in `.claude/skills/run-buildworks/driver.mjs` builds one: `governed.yaml` and the design document, with no `index.html` or `src/`. The prompt carries the fixture's `specFull` and `planFull`.
  - It runs each produced suite through Task 3's gate.
  - It then runs the suite against three trees: `b5d42890`, `bc57eb74`, and the control, which is `bc57eb74`'s `src/app.js` with `event.target.closest("button")` replaced by `event.target.closest("#theme-toggle")`.
  - It writes every reply, suite, report and cost to `test/fixtures/recorded/test-author-evaluation-web-calculator.json` with provenance.

**Pre-registered thresholds,** fixed before any answer is seen:
- **Gate:** at least 2 of 3 suites per setting pass the validity gate.
- **Catches finding 9:** in each gate-passing suite, at least one `AC-018` test fails at `b5d42890` and passes on the control.
- **Catches finding 10:** in each gate-passing suite, at least one test under a keyboard-equals criterion fails at `bc57eb74` and passes on the control. Those criteria are AC-013, AC-014, AC-015 and AC-024. All four carry the "focus on the page document" convention, which includes a focused calculator button.
- **Precision:** every test that fails on the control is read by hand against the control's code and recorded either as a test error or as a real defect in the recorded code. A setting passes only with zero test errors in its gate-passing suites.

A setting passes if it meets all four. If neither setting passes, stop. Report the per-sample record, and change nothing else in this plan until the operator decides. The rest of the plan only works if the test author is good.

**Steps:**
- Verify: `node scripts/test-author-evaluation.ts --yes`, with the output redirected to a file. Expected: the record file and a printed table per setting.

**Task completion evidence:** the committed evaluation record, the thresholds met or not, and the setting the operator chooses.

### Task 5: Freeze the opt-in, and the new agent's setting

**Depends on:** Task 4 passing.

**Files:**
- Modify: `src/policy.ts`. Seed the `acceptance-test-author` setting with the operator's Task 4 choice.
- Modify: `src/profile.ts`. Add `acceptance: { dir: string; repeatEach: number } | null`, checked only by the execution predicate. `invalidInspectableProfileReason` does not read it.
- Modify: `src/run-intake.ts` and `src/cli.ts`. `new-run --acceptance-tests` freezes `{ dir: "acceptance/<slug>/", repeatEach: 2 }`, and `null` without the flag. There is no starting-commit check for a page: a greenfield target, such as the calculator, has none until phase 1. The static-page limit is stated in the test-author prompt and the README. A target whose pages cannot open from the worktree fails the validity gate's load check before phase 1, not after it.
- Modify: `test/profile.test.ts`, `test/run-intake.test.ts` and `test/cli.test.ts`.

**Steps:**
- **Run the stored-run check** (project learnings: "check the stored runs with the predicate itself"). From a scratch `.mjs`, run `invalidInspectableProfileReason` read-only over every stored profile on this machine:
  - crew-chatter runs 5 to 8;
  - the kept targets under `C:\Users\tamezs\buildWorks_test_repos\`.

  Expected: unchanged.
- **Tests:**
  - a profile without `acceptance` is inspectable, and its execution is refused by name;
  - the flag freezes the block;
  - the panel staffing check does not count the new agent.
- **Break-test:** make the inspectable predicate read `acceptance`. The old-profile test fails.
- Verify: those test files, then `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the tests, the break-test failure, and the stored-run output.

### Task 6: The authoring step and the validity gate in the implementation stage

**Depends on:** Task 5.

**Files:**
- Modify: `src/implementation-stage.ts`. When `profile.acceptance` is not null, before phase 1:
  - make one `dispatchInSandbox` of the test author;
  - call `commitWorkspace` with `scope: [profile.acceptance.dir]`;
  - run `verifyCommit` with only the acceptance command, with the suite overlaid read-only. When the suite commit has an `index.html`, it runs on the new head. When it has none, it runs in a throwaway `git worktree` of the new head under `.governance/acceptance/<run>/baseline`, where the system has written the blank stub page, and the worktree is removed afterwards. The run worktree never holds the stub.
  - `validateAcceptanceSuite`.

  Here a failing command is the expected red, not a verification failure. The step reads the report from the retained log and decides only by the gate. Only a sandbox failure, where `record` is null, or an unreadable report, blocks on its own.

  Each step writes audit events `implementation.acceptance.<authored | refused | gate.pass | gate.block>`. The gate record lists each test's baseline class and each `already_satisfied` criterion, and is written to `.governance/acceptance/<run>/gate.json`. Phase 1's base is the head after the suite commit.
- Modify: `src/operator-output.ts`. In `formatRunPreview`, when `profile.acceptance` is not null, the implementation ceiling is `policy.implementationMaxPhases + 2`, and the implementation line begins "One acceptance-test-author dispatch, then …". Otherwise the text is unchanged.
- Modify: `test/implementation-stage.test.ts`, `test/operator-output.test.ts`, and `test/fixtures/harness/emit-implementation-stage.mjs`, so the emitter answers the test-author prompt.

**Steps:**
- **Tests,** with the Docker stand-in. It runs no browser, so the acceptance command's output is a Task 2 recorded report:
  - a gate-passing suite is committed, and phase 1's base is the suite commit;
  - a gate failure blocks the run with every reason and dispatches no phase;
  - an author diff outside the directory is refused;
  - on a suite commit without `index.html`, the gate run's working directory is the throwaway checkout, and afterwards the run worktree is clean and holds no `index.html`;
  - a run with `acceptance: null` is byte-identical in dispatches and audit events;
  - the preview for an opted-in profile shows the extra dispatch and ceiling;
  - the preview for an off profile equals the current output byte for byte, snapshotted before the change.
- **Break-tests:**
  - take phase 1's base before the suite commit: the base assertion fails;
  - leave the preview ceiling at `+ 1` for opted-in runs: the preview test fails.
- Verify: `node --test test/implementation-stage.test.ts test/operator-output.test.ts`. Expected: pass.

**Task completion evidence:** the tests and both break-test failures.

### Task 7: Read-only everywhere after the author

**Depends on:** Task 6.

**Files:**
- Modify: `src/container.ts`. `createSandbox` and `withSandbox` take optional `readOnlyPaths: string[]`, which are worktree-relative. Each becomes `-v <worktree>/<p>:/work/<p>:ro` after the `.git` overlay. Absent, the argv is byte-identical.
- Modify: `src/dispatch.ts`. `dispatchInSandbox` passes `readOnlyPaths`.
- Modify: `src/commit-verification.ts`. `CommitVerificationInput` gains optional `readOnlyPaths`, passed to `withSandbox`, so the whole verification container holds the suite read-only, through every verify command and the acceptance run.
- Modify: `src/implementation-stage.ts`, `src/verification-stage.ts` and `src/code-review-stage.ts`. When `profile.acceptance` is not null, they pass `[profile.acceptance.dir]`:
  - to phases, self-review and remediation, through `dispatchInSandbox`;
  - to the verification stage's `verifyCommit`, remediation verification's `verifyCommit` and the gate run's `verifyCommit`.

  The three existing `commitWorkspace` calls pass the directory for refusal.
- Modify: `src/workspace-commit.ts`. Add a `protectedPaths` input. Any staged path under one adds the cause `changes <path> in the acceptance suite: the system refuses agent edits to it`.
- Modify: `src/spec-doc.ts`. Add `acceptanceArtifactRefusals` beside `derivedArtifactRefusals`, refusing any declared artifact under `acceptance/`. Pass it from `src/spec-stage.ts`, `src/spec-decision-stage.ts` and `src/approval-stage.ts`.
- Modify: `test/container.test.ts`, `test/acceptance-engine.test.ts`, `test/workspace-commit.test.ts`, `test/spec-doc.test.ts`, `test/approval-stage.test.ts`, `test/verification-stage.test.ts` and `test/code-review-stage.test.ts`.

**Steps:**
- **Tests:**
  - **On the engine** (`test/acceptance-engine.test.ts`), `verifyCommit` with the overlay and three verify commands:
    - one writes into the suite directly, and fails with a read-only error;
    - one starts a detached process that tries to rewrite a suite file after the command has returned, while the acceptance command runs;
    - then the acceptance command.

    Expected: the suite files are byte-identical before and after, and the detached writer's own log records the read-only error.
  - **On the engine,** a write under the overlay fails from inside a work container, while the rest of `/work` stays writable.
  - **With the stand-in,** the argv carries the overlay only when asked:
    - for the verification stage's sandbox;
    - for remediation verification's sandbox, in a code-review stage test with one remediation;
    - for the phase and remediation work containers.

    That covers ordinary and remediation verification.
  - A diff under the directory is refused and kept under `refs/buildworks/refused/`.
  - A specification declaring `acceptance/x.spec.mjs` is refused at write and at approval.
- **Break-tests:**
  - drop `:ro`: both engine tests fail;
  - stop passing `readOnlyPaths` from remediation verification: its stand-in argv test fails;
  - drop the boundary cause: the refusal test fails.
- Verify: those files, with the engine for `test/container.test.ts`. Expected: pass.

**Task completion evidence:** the tests and the three break-test failures.

### Task 8: The suite at every verification point

**Depends on:** Task 7.

**Files:**
- Modify: `src/verification-stage.ts` and `src/code-review-stage.ts`. When `profile.acceptance` is not null, append `acceptanceCommand` to the frozen verify commands. After `verifyCommit`, read the acceptance log with `readAcceptanceReport`, classify it, and record `acceptance: { tests: [{ title, outcome, failureClass, message }] }` beside `commands` in each `result.json`. `failureClass` and `message` are `null` for a pass.
- Modify: `src/acceptance.ts`. The command's own pass/fail is replaced, for the block reason, by the classified outcome:
  - `acceptance failed: <titles>`;
  - or `acceptance flaky: <titles>`, which points at the test, not the code.

**Steps:**
- **Tests,** with the stand-in serving recorded reports:
  - a failing report blocks verification, naming the titles;
  - a flaky report blocks as flaky;
  - a passing report passes and is recorded;
  - remediation verification behaves the same;
  - a stored `result.json` without `acceptance`, the recorded fixture's, still parses with `parsePassedCodeReviewRecord` and the delivery stage's reader.
- **Break-test:** treat `flaky` as pass in the block decision. The flaky test fails.
- Verify: the stage test files, then `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the tests and the break-test failure.

### Task 9: The prompts — the gate, the abort path and the reviewers' lens

**Depends on:** Task 8.

**Files:**
- Modify: `src/prompts.ts`. When `acceptance` is not null, and each rule on one source line:
  - **The implementer, self-review and remediation prompts** state:
    - where the read-only suite is and that an independent author wrote it from the criteria;
    - the exact command to run it with `run_command`;
    - that it runs at every verification point and a failure blocks;
    - the abort rule: a test that contradicts the approved specification must not be special-cased. Return `blocked`, naming the test in `incompleteTasks`.
  - **`buildCodeReviewPrompt`** adds that code which detects the test environment or special-cases a test's inputs is a high-severity defect. It names the suite's path, and lists each criterion the gate recorded as `already_satisfied`, so a reviewer can check the author's claim that the behaviour already existed.
- Modify: `src/implementation-stage.ts`. A `blocked` reply whose `incompleteTasks` names an `AC-NNN` test title is recorded as `implementation.acceptance.disputed`, as well as the existing block.
- Modify: `test/prompts.test.ts` and `test/implementation-stage.test.ts`.

**Steps:**
- **Tests:**
  - with `acceptance: null`, every prompt is byte-identical; snapshot the prompts before the change;
  - with a suite, each prompt carries its lines, pinned in `CONSTRAINT_STRINGS`;
  - a disputed reply records the event.
- **Prompt ablation** (ImpossibleBench: wording moves cheating rates). This is not a gate for this task, so it is recorded as an open follow-up with the Task 11 run as its first data point. A free ablation is not possible.
- Verify: `node --test test/prompts.test.ts test/implementation-stage.test.ts`. Expected: pass.

**Task completion evidence:** the tests, including the byte-identity checks.

### Task 10: The driver, documents and full regression

**Depends on:** Tasks 1 to 9.

**Files:**
- Modify: `.claude/skills/run-buildworks/driver.mjs`. Add `--acceptance-tests`, which passes the flag to `new-run`. Without it the chain is byte-identical.
- Modify:
  - `.claude/skills/run-buildworks/SKILL.md`;
  - `ARCHITECTURE.md` sections 5, 7, 11 and 23, with the decision verbatim;
  - `README.md`;
  - `docs/hazards.md` entries 18 and 23 (dated paragraphs);
  - `CLAUDE.md`, then a copy to `AGENTS.md` with hashes compared;
  - `docs/proposals/sandboxed-delivery-rework.md` (change 4's status).

**Steps:**
- Verify, in order:
  - `node .claude/skills/run-buildworks/driver.mjs smoke`, and `smoke --acceptance-tests`;
  - `npm run typecheck`;
  - `npm run check:docs`;
  - the full serial no-engine suite in the background, then `git log -1`;
  - `test/container.test.ts` and `test/acceptance-engine.test.ts` on the engine.

  Expected: `13/13` twice, clean, clean, 0 failures with the named skips, and both engine suites passing.

**Task completion evidence:** the counts and clean checks.

### Task 11: The paid end-to-end benchmark (separate authorization)

**Depends on:** Task 10 and the operator's consent. A completed paid run never authorizes another.

**Steps:**
- Run `node .claude/skills/run-buildworks/driver.mjs paid --yes --model claude-sonnet-5-5 --acceptance-tests --dir <a durable directory under C:\Users\tamezs\buildWorks_test_repos>` on the committed web-calculator design. Redirect the output to a file.
- **Success criterion.** Each item is read from the store and the evidence, not from the outcome:
  - the suite was authored, passed the validity gate, and was committed before phase 1;
  - no later agent diff touched it, and the read-only overlay was in every work container's argv;
  - it ran at verification and after every remediation, with per-test outcomes recorded;
  - any block named its test, or recorded a dispute.
- A block is a result. Compare the run's review findings with its acceptance outcomes: the question is whether the suite caught what the recorded panel caught, and earlier.
- Extract the load-bearing responses into `test/fixtures/recorded/` with provenance before any `driver.mjs clean`.

**Task completion evidence:** the run record and the extracted fixture.

## Task 1 spike record (2026-10-20)

**Result: stopped at Task 1's exit criterion.** Two cases cannot be told apart by any retained report field. Probes 1 to 5, 7 and 8 behaved as stated.

**The image.**
- **What was built.** The committed Dockerfile plus Task 1's lines, with `PLAYWRIGHT_BROWSERS_PATH` and `BW_PLAYWRIGHT_TEST` set before the install line.
- **Build and size.** The cold build, which downloads both npm and the browser, took 93 s. The image is 2.02 GB, against 472 MB for the current `bw-sandbox:9a000fdd1de3`.
- **What it installs.** `chromium-1248` (403 MB), `chromium_headless_shell-1248` (273 MB) and `ffmpeg-1013` (5 MB). The runner reports `Version 1.64.1`.

**The config probed:**
- `testDir` is `/work/acceptance`, and `outputDir` is under the container's temporary directory.
- The JSON reporter writes to stdout, with workers 1, retries 0 and `forbidOnly`.
- Timeouts: a 30 s per-test timeout, and 5 s each for `expect`, `actionTimeout` and `navigationTimeout`.
- Headless Chromium, with `baseURL` `file:///work/`, and trace, screenshot and video off.
- The plan did not list `actionTimeout`. It was set so that a missing element fails as its locator action's own error, not as a whole-test timeout. Playwright's default, with no action timeout, was not probed.

**The probes.** Every probe ran as `--user node --cpus 2 --memory 4g --memory-swap 4g --pids-limit 512 --network none --cap-drop ALL --security-opt no-new-privileges`. The target was mounted at `/work`, its `.git` read-only, through the system command with `--repeat-each 2`.
1. **Launch.** It passed, 2 of 2, in 2.7 s of wall clock including the container start.
2. **Trusted input.** `page.keyboard.press("Enter")` on the focused button fired its click, 2 of 2.
3. **Untrusted input.** A `dispatchEvent` of keydown, keypress and keyup for Enter left the output empty, 2 of 2.
4. **Resolution: the bare import is unsafe; the absolute import is chosen.**
   - **The bare form never resolves from the image.** `import { test, expect } from "@playwright/test"` fails without a package in the worktree. That is a load error: `Cannot find package '@playwright/test' imported from /work/acceptance/pass/pass.spec.mjs`.
   - **So it can only find a planted package.** The decoy re-exported the real `test` with an `expect` whose every matcher passes, at `/work/node_modules/@playwright/test`. With it, a failing `toHaveText` test passed both repeats, and the command exited 0.
   - **The absolute import holds.** With `const { test, expect } = await import(process.env.BW_PLAYWRIGHT_TEST)` and the decoy still present, the same test failed both repeats.
   - **Where the variable is set.** `BW_PLAYWRIGHT_TEST` is an image `ENV` beside `PLAYWRIGHT_BROWSERS_PATH`, not an entry in the seeded sandbox environment. This deviates from Task 1's wording. Only the image knows the path, and a seeded entry would change every new run's frozen `sandbox.env`.
5. **Clean worktree.** `git status --porcelain --ignored` was empty after every run, in all three probe targets.
6. **The report.**
   - **Where each field lives.** Each result carries `status` and `errors[]`, each error with `message` and `location`. The first error is repeated as `error`, with `message`, `stack`, `location` and `snippet`. The `errors[]` entries carry no `stack`.
   - **ANSI colour.** Messages carry ANSI colour codes, which the parser must strip.
   - **The test's position.** Each test's spec carries `title`, `file` relative to `testDir`, `line` and `column`.
   - **Load errors.** These appear only in the top-level `errors[]`, with no suites.
7. **The stub.**
   - **A missing element.** On the blank stub page, `getByRole("button", { name: "7" }).click()` failed as `TimeoutError: locator.click: Timeout 5000ms exceeded.`, located in the test body, not as a navigation error.
   - **A missing page.** `page.goto("other.html")` failed as `Error: page.goto: net::ERR_FILE_NOT_FOUND at file:///work/other.html`.
8. **Time.**
   - **The run.** Three tests, two repeats each, against the recorded `b5d42890` tree took 13.9 s of wall clock including the container start.
   - **The cost per result.** A red result costs about the 5 s assertion timeout, and a green one well under 1 s.
   - **The ceiling.** An all-red baseline of N tests therefore takes about 2N × 5 s. The 900 s verification ceiling holds about 85 such tests [Inference, one timing].
   - **An incidental catch.** The suite's AC-018 test, Enter on the focused theme control, failed at `b5d42890`: that is finding 9.

**Per-case classification.** Messages are shown ANSI-stripped. "Line" is the error's line against the test's declaration line, both in the suite's own file.

| Case | Status, both repeats | First error | Location | Told apart from a valid red by |
|---|---|---|---|---|
| Pass | passed | none | none | status |
| Valid red, matcher | failed | `Error: expect(locator).toHaveText(expected) failed` | line 5; test at 3 | (is valid red) |
| Valid red, locator on the stub | failed | `TimeoutError: locator.click: Timeout 5000ms exceeded.` | line 5; test at 3 | (is valid red) |
| Navigation | failed | `Error: page.goto: net::ERR_FILE_NOT_FOUND at …` | line 4; test at 3 | message |
| Browser launch | failed | `Error: browserType.launch: Executable doesn't exist at …` | none | message, no location |
| `beforeEach` throws | failed | `Error: hook broke` | line 5; test at 7 | message class |
| `beforeEach` locator, hook declared before the test | failed | `TimeoutError: locator.click: …` | line 5; test at 7 | only the error line before the test's line |
| `beforeEach` locator, hook declared after the test | failed | `TimeoutError: locator.click: …` | line 8; test at 3 | **nothing** |
| `TypeError` in the body | failed | `TypeError: Cannot read properties of null (reading 'value')` | line 6; test at 3 | message class |
| Whole-test timeout | timedOut | `Test timeout of 4000ms exceeded.` | none | status, no location |
| Flaky | passed, then failed | `Error: expect(locator).toHaveText(expected) failed` | line 6 | the two statuses differ |
| Load error | no tests | top-level `SyntaxError: … (5:0)` and `Error: No tests found.` | top level | top-level errors |

**Why it stopped.** A locator action that fails inside a hook declared after its test is indistinguishable from a valid red. Its message class is the same, its location is in the suite's own file, and its line follows the test's. Gate 3's rule "outside any hook" cannot be decided from the report. The two cases were added beyond Task 1's list, because the rule names hooks. The routes:
- **A. Refuse hooks in the lint (gate 5).** The lint refuses `test.beforeEach(`, `test.beforeAll(`, `test.afterEach(` and `test.afterAll(`, and the author prompt says each test opens its own page. No hook error can then reach the classifier. An error located before its test's line is still classed `hook`, as defence in depth. This adds one lint entry and one prompt line.
- **B. A system-owned reporter in the image** that records, for each error, whether it was raised in a hook step, using the reporter API's step category. It keeps hooks allowed. It also adds a second runner file to the image and replaces the stock JSON report the classifier is pinned to.
- **C. Locate hooks by parsing the suite's source.** Rejected as fragile.

**Missing `await`.** A follow-up probe ran under the same config.
- **An unawaited matcher.** `expect(locator).toHaveText("never")` failed as `Error: expect(locator).toHaveText(expected) failed`.
- **An unawaited action.** `locator.click()` failed as `Error: locator.click: Test ended.`
- **Why the lint is still the guard.** Both message classes read as valid red at the baseline. Once the behaviour exists, an unawaited action races the steps after it.

**Operator decision, 2026-10-20: route A**, with the lint additions now in gate 5. Task 1 is complete with that decision. Tasks 2 and 3 use the configuration above, and its reports are their recorded fixtures.

## Task 4 evaluation record (2026-10-21)

**Result: neither setting passes the pre-registered thresholds, so the plan stops here** (Task 4: "change nothing else in this plan until the operator decides"). The record is `test/fixtures/recorded/test-author-evaluation-web-calculator.json`. The raw streams, prompts, tool logs and full report logs are kept in `C:\Users\tamezs\buildWorks_test_repos\test-author-evaluation-2026-10-20`.

**Spend:** $4.94 of the $5 ceiling, in six dispatches.

| Sample | Cost | Dispatch | Tests | Baseline run | Gate refusals | Fails at `b5d42890` | Fails at `bc57eb74` | Fails on the control |
|---|---|---|---|---|---|---|---|---|
| Sonnet 5.5 medium 1 | $0.34 | 162 s | 26 | 283 s | 2, all lint | 0 | 0 | 0 |
| Opus 5.5 high 1 | $1.35 | 1183 s | 55 | 599 s | 21, all lint | 0 | 8 | 4 |
| Sonnet 5.5 medium 2 | $0.34 | 423 s | 47 | 514 s | 7, all lint | 0 | 10 | 5 |
| Opus 5.5 high 2 | $1.81 | 1774 s | 68 | 740 s | 31, all lint | 0 | 12 | 4 |
| Sonnet 5.5 medium 3 | $0.28 | 225 s | 33 | 359 s | 3, all lint | 0 | 0 | 0 |
| Opus 5.5 high 3 | $0.82 (capped by the remaining budget) | 613 s | 37 | 403 s | 15, all lint | 0 | 8 | 4 |

**What the thresholds said:**
- **Gate.** Each setting passed 0 of 3.
- **The other three.** No suite passed the gate, so none was scored on them. Every reply said `completed`, and no author wrote outside its directory.
- **The baseline.** Every one of the 266 tests classified as valid red. There was no load, coverage, broken-test or flaky refusal.

**Two defects in this plan's own instruments, found by reading the results against the approved specification:**
1. **The lint over-refuses against the operator's rule.** Every one of the 79 refusals is one of two heuristic failures:
   - **"Not awaited":** a call whose promise is returned to an awaiting caller (`(page) => x.focus()`, `return locator.evaluate(…)`). Also a callback handed to an awaited helper, and a DOM `blur()` inside a `page.evaluate` script.
   - **"No `await expect(` on a page locator":** an assertion whose subject a helper builds (`expect(display(page))`), or an assertion made inside a helper.

   None of the flagged lines is itself a floating promise.
2. **The benchmark's finding-9 expectation and its control contradict the approved specification.**
   - **What the specification says.** Its keyboard mapping says `Enter` does equals. Its convention says "with focus on the page document" covers "any element of the calculator page", and the theme control is one. AC-018 says only "activated".
   - **What a spec-faithful test therefore does.** It requires Enter on the focused theme control to compute equals: the opposite of what finding 9 asked for. So no suite's AC-018 test fails at `b5d42890`, which makes threshold 2 unreachable for an author that follows the specification.
   - **Why the control fails.** It narrows the remediation's guard to the theme control. Enter with that control focused therefore toggles the theme instead of computing, which breaks AC-013, AC-014, AC-015 and AC-024 in the theme-control variant.
   - **The control failures, read by hand.** Every one is that defect in the control, not a test error. One Sonnet 2 test asserts the same Enter behaviour under AC-017's title, beyond that criterion's words.
   - **How this happened.** The control was constructed in the planning session, and finding 9 was a reviewer's judgement, not an obligation of the specification. The plan let both set expectations (hazard 4).

**What the authors did, reported only; nothing re-scored:**
- **Focus variants.** All three Opus suites, and Sonnet suite 2, tested the convention's variants: focus on the body, on a calculator button and on the theme control. Sonnet suites 1 and 3 tested focus on the body only.
- **Finding 10.** Each of those four suites fails AC-013, AC-014, AC-015 and AC-024 at `bc57eb74`, in the variants with focus on a button, and passes them in the body variant.
- **Hazard 19.** The slowest baseline gate run, 740 s for 68 tests, came within 160 s of the 900 s verification ceiling.

**Corrections and operator decision (2026-10-21).** The record above stays as written; these entries correct it.
- **Defect 2 overstated the contradiction.** A spec-correct implementation satisfies both readings. Enter always does equals, and with focus on the theme control the handler leaves the key's default alone, so the control's own click also runs. Equals still holds with focus anywhere (AC-013, AC-014, AC-015, AC-024), and Enter, a standard way to activate a focused button, still changes the theme (AC-018).
  - **What this means for finding 9.** A spec-faithful AC-018 test that activates the focused theme control with Enter fails at `b5d42890`, because that tree prevents the default. So finding 9 is catchable. No sample wrote that test: opus-1, the only sample to test a second activation method, used click and Space.
  - **What was really wrong.** The defect was the control, which returned early on the theme control and skipped equals.
- **Operator decision.** In the operator's words: "if my rules are not the best rules, dont use them. Update the lint and or test issues with the correct and robust fix, then we will rerun the test and loop until it catches all findings and errors and doesnt produce any false positives (up to a total of $15 SPEND)." The $15 is read as cumulative, including the $4.94 above. The operator approved moving `typescript` from `devDependencies` to `dependencies` (2026-10-21).
- **The lint, rebuilt on a parser.** Gate 5 now parses each file with the TypeScript parser, syntax only, instead of matching text, and states each rule as its intent:
  - **Unsettled promises.** It refuses a promise that is never settled: a statement that drops one, `void`, an assigned promise that is never awaited or returned, and `forEach` with an async callback. A promise returned to an awaiting caller passes.
  - **Page context.** Code inside a function passed to `evaluate` or a sibling runs in the browser and is not held to the promise rule.
  - **Assertion subjects.** Playwright refuses them at run time (`toHaveText can be only used with Locator object`, probed in the image), and gate 3 reads that refusal as a broken test. The syntactic subject check is dropped.
  - **Each test asserts.** It needs a retrying assertion in its body, or in a file-local helper it calls.
  - **New refusals.** It adds a `delay:` option, any `*timeout:` option, `new <any>Event`, and `createEvent(`.
  - **Result.** Over the six recorded suites, refusals fell from 79 to 0. A scan of those suites for waits, timeouts, `then` and `forEach` chains, and non-retrying assertions found nothing the lint misses. Four break-tests (local promise helpers, page context, helper assertions, settled assignments) each failed their target test, with byte-identical restores.
- **The control, rebuilt.** It is `bc57eb74` with its Enter branch made spec-correct, as in the first bullet.
- **Thresholds re-registered** before any answer under the corrected instruments was seen: the same four, except that precision now requires zero control failures in the gate-passing suites. A control failure that exposes a real control defect corrects the control and is re-scored, never discounted.

**Round 1: the baseline ceiling and a sandbox defect (2026-10-21).**
- **What happened.** Sonnet sample 1 wrote 109 tests, and the gate refused it only because its baseline was killed at the 900 s ceiling (exit 137, an unreadable report).
- **Why.** On the blank stub page every result waits out the 5 s action or assertion timeout: 5.05 to 5.19 s in all six Task 4 baseline reports. With one worker and `--repeat-each 2`, the ceiling therefore holds about 82 tests. The Task 1 estimate was about 85.
- **The operator's fix.** Run tests in parallel: four workers, `fullyParallel`.
- **What the first probe exposed.** Run four-wide over sample 1's suite, Chromium crashed ("Target crashed", `SIGABRT`, failed `spawn`), and 84 of 109 tests came out flaky. Two workers did the same.
  - **The cause.** PID 1 in the work container was `sleep infinity`, which never reaps orphans.
  - **The evidence.** After the suite finished, 325 zombie `chrome-headless` processes remained, every one parented to PID 1. The container's pid count climbed to the 512 `--pids-limit` while memory stayed near 450 MiB.
  - **Why it is a sandbox defect.** A serial run has the same leak, only slower, and so does any command that orphans children.
- **The fix.** `createSandbox` starts the work container with `--init`, as Playwright's Docker guidance recommends. Criterion 2 in `test/container.test.ts` now admits exactly one more mount, the engine's read-only `/usr/sbin/docker-init`.
  - **The guard.** A new engine test leaves five orphans and requires zero zombies. With `--init` removed it failed, finding the zombies, and the restore was byte-identical. The engine suite passes 15 of 15.
- **The probe under the fix.** Sample 1's baseline ran 4-wide in 305 s. All 109 tests were valid red, with no crash or flaky result. The pid count held between 280 and 380, and memory near 1 GB.

**Round 1 and round 2 results (2026-10-21): both settings pass all four re-registered thresholds.** Sample 1's dispatch was reused from its checkpoint, so the re-run cost nothing extra. The records are `test/fixtures/recorded/test-author-evaluation-web-calculator-r1.json` (Sonnet 5.5 `medium`) and `test-author-evaluation-web-calculator-r2.json` (Opus 5.5 `high`). The raw streams and logs are kept in `C:\Users\tamezs\buildWorks_test_repos\test-author-evaluation-2026-10-21-r1` and `-r2`.

| Sample | Cost | Dispatch | Tests | Baseline run | Gate | Fails at `b5d42890` | Fails at `bc57eb74` | Fails on the control |
|---|---|---|---|---|---|---|---|---|
| Sonnet 5.5 medium 1 | $0.4364 | 646 s | 109 | 305 s | pass | 2 | 17 | 0 |
| Sonnet 5.5 medium 2 | $0.3302 | 796 s | 77 | 215 s | pass | 1 | 20 | 0 |
| Sonnet 5.5 medium 3 | $0.3659 | 245 s | 32 | 96 s | pass | 3 | 4 | 0 |
| Opus 5.5 high 1 | $1.1534 | 680 s | 49 | 140 s | pass | 4 | 7 | 0 |
| Opus 5.5 high 2 | $1.1562 | 698 s | 56 | 158 s | pass | 4 | 6 | 0 |
| Opus 5.5 high 3 | $1.3505 | 950 s | 122 | 341 s | refused, 5 | 5 | 21 | 0 |

- **Sonnet 5.5 `medium`:** 3 of 3 suites pass the gate, each catches findings 9 and 10, and none fails on the control. Cost $1.1326.
- **Opus 5.5 `high`:** 2 of 3 pass the gate, each catches findings 9 and 10, and none fails on the control. Cost $3.6602.
- **The catches, read by hand.** Every catch is a valid red on `toHaveAttribute` or `toHaveText`. Finding 9 is caught in every suite by an `AC-018` test that presses Enter on the focused theme control, and in some also by the `AC-019` and `AC-020` variants that set the theme with Enter. Finding 10 is caught by the keyboard-equals tests in their focused-button and focused-theme-control variants.
- **Spend:** $9.73 of the operator's cumulative $15: $4.94 in Task 4, $1.13 in round 1 and $3.66 in round 2.
- **A gate false refusal, reported and not fixed.** All five of Opus sample 3's refusals have one cause. Its tests pass a custom message to `expect` (`expect(locator, "button labelled +")`), and Playwright then puts that message before the matcher header. `classifyFailure` matches the header only at the start of the message (`/^Error: expect\(/`), so it reads these valid reds as `test_code`. The two criterion refusals follow from that. Under a classifier that accepted the header after a custom message, the suite would have passed the gate. It also catches both findings and has no control failures. The thresholds are met without it, so the fix waits for the operator.
- **The setting.** The operator chooses the seeded setting for Task 5.

**The custom-message fix and a free re-score (2026-10-21).** The entry above stays as written; this one records what followed it.
- **The rule.** `classifyFailure` also counts as valid red a message that begins `Error: `, carries the assertion's custom message, and then, after a blank line, has the matcher's own header line: `expect(locator)` or `expect(page)`, optionally `.not`, a matcher, and `failed`. An error that a test throws itself in the same layout has no such header, so it stays `test_code`.
- **Its evidence.** Two reports were captured from the real runner in the `bw-sandbox:5c7d0cadf267` image, through `createSandbox` and `runInSandbox`:
  - `acceptance-report-valid-red-custom-message.json`, a `toHaveText` failing with a custom message, classifies as `valid_red`;
  - `acceptance-report-test-code-expect-text.json`, a thrown `Error` whose text imitates that layout, classifies as `test_code`.
- **The guard.** The acceptance tests pass 21 of 21. With the rule removed, the classification test failed, and the restore was byte-identical.
- **The re-score.** `test/fixtures/recorded/test-author-evaluation-web-calculator-r2-rescore.json` re-read the gate from each retained baseline log and ran the control again. Nothing was dispatched, and it cost nothing.
  - **Opus 5.5 `high`:** 3 of 3 suites now pass the gate.
  - **Each suite** still catches findings 9 and 10, with no control failures.
  - So the sample-3 refusal was the classifier's false refusal.
- **Spend** is unchanged at $9.73 of $15.
- **Operator decision (2026-10-21): Sonnet 5.5 `medium`** is the seeded setting for Task 5. Both settings pass, and Sonnet passed at less than a third of Opus's cost ($1.1326 against $3.6602).

## Task 5 and Task 6 build record (2026-10-21)

**Task 5.**
- **What was built.** `new-run --acceptance-tests` freezes `acceptance: { dir: "acceptance/<slug>/", repeatEach: 2 }`, and a run without the flag freezes `null`. `ACCEPTANCE_REPEAT_EACH` lives in `src/policy.ts` and is not a `Policy` field. The test author is registered with the seeded setting Sonnet 5.5 `medium`.
- **Old runs.** A profile with no `acceptance` key stays inspectable, and its execution is refused. Over the stored runs on this machine, inspection results were unchanged. Execution is now refused for two runs, both already completed: crew-chatter run 8 and `sandboxed-web-calculator-2026-10-20`.
- **Tests and the break-test.** 224 of 224 tests pass across the profile, run-intake, CLI, dashboard-UI and acceptance suites. With the inspectable predicate made to read `acceptance`, the old-profile test failed, and the restore was byte-identical.

**Task 6.**
- **The output budget (a decision this plan did not foresee).** The verification result budget is 1 MiB (`RESULT_MAX_BYTES`), and the gate run's report is a single JSON log. The retained baseline logs of the round 1 and round 2 samples ran from about 270 KB to 1,014,909 bytes, which is 0.97 of the budget, for Opus sample 3's 122 tests. A larger suite would truncate the report, and the gate would refuse it as unreadable.
  - **The decision.** The gate run's output budget is the retention ceiling, `verifyRetentionMaxBytes` (64 MiB). The report is read from the retained log, never from memory.
  - **What it leaves for Task 8.** The acceptance command appended to verification needs the same per-command budget.
- **The stub-page baseline.** When the suite commit holds no `index.html`, the gate runs in a `git worktree add --detach` checkout at `.governance/acceptance/<run>/baseline`. The system commits the stub there, off the run branch, and the checkout is removed in a `finally` block. A failed removal is audited as `implementation.acceptance.baseline.cleanup.failed`.
- **Read-only mounting came in Task 7.** As Task 6 first built it, the gate run mounted the suite writable. Task 7 added the read-only mount to the gate run (see its record below).
- **The stand-in.** The Docker stand-in answers the acceptance command from a recorded Task 2 report, served by mark for each container prefix. It replaces the recorded suite path with the actual one and logs each run's working directory and `index.html`, so the tests see where the gate ran.
- **The tests.** 77 of 77 pass across `test/implementation-stage.test.ts` and `test/operator-output.test.ts`, and the typecheck is clean.
  - **The cases.** A gate pass commits the suite before phase 1, and both phase 1's base and the handoff base are the suite commit. A suite commit that already holds `index.html` is gated in the run worktree. A navigation suite and a flaky suite each block with every refusal and dispatch no phase. An author write outside the directory is refused by name.
  - **The null run.** A run with `acceptance: null` was compared against the code at `4be6b2a`, in a scratch copy of each tree, over three scenarios: the success path, an out-of-scope refusal and a self-review fix. The audit trail, the dispatch rows and the prompt texts matched after hashes, paths and durations were normalized. The committed tests pin the success path's actions and dispatch rows, plus the whole off-profile preview text that `4be6b2a` printed.
- **The break-tests,** each restored byte for byte:
  - **Phase 1 proposing on the projections commit** fails the gate-pass test. It fails at the workspace boundary ("the worktree head moved"), which refuses the phase before the base assertion is reached.
  - **The opted-in ceiling left at `+ 1`** fails the opted-in preview test.
  - **Reading a `null` acceptance as opted in** fails the byte-for-byte preview test and two others.
  - **Never stubbing** fails the gate-pass test's baseline assertion.
  - **Skipping the checkout's removal** fails the gate-pass test and both gate-refusal tests.
- **A follow-up, not done.** The dashboard's `STAGE_SETTINGS.implementation` in `src/dashboard/app.js` does not list the test author.

## Task 7 build record (2026-10-21)

- **What was built.**
  - **The mount.** `createSandbox` takes `readOnlyPaths`, and each path becomes `-v <worktree>/<p>:/work/<p>:ro` after the `.git` overlay. `dispatchInSandbox` and `verifyCommit` pass it on.
  - **Who gets it.** A run with a suite passes `[profile.acceptance.dir]` to the gate run, every phase, the self-review, remediation, the verification stage and remediation verification. The test author's own dispatch is the one exception, because it writes the suite.
  - **The boundary.** `commitWorkspace`'s `protectedPaths` refuses any staged path under the suite, as `changes <path> in the acceptance suite: the system refuses agent edits to it`. The phase, self-review and remediation calls pass it.
  - **The spec rule.** `acceptanceArtifactRefusals` refuses a declared artifact under `acceptance/`, compared without case. It runs in `writeSpecDoc`, which both `spec-stage` and `spec-decision-stage` use to write a specification, and again in the approval gate. One check in the writer covers both stages, rather than one pass from each stage as the task's file list says.
- **On the engine** (`test/acceptance-engine.test.ts`, 2 of 2 tests).
  - **The verification test.** `verifyCommit` runs four commands with the suite overlaid read-only:
    - a direct write into the suite;
    - a detached writer that sleeps past its own command's return;
    - the real acceptance command over the recorded pass suite;
    - a command that reads the detached writer's log.

    The suite is byte-identical afterwards. Both writers' logs record `Read-only file system`, and the acceptance run passes both repeats. So Playwright 1.64.1 runs with its suite mounted read-only. The plan listed three commands; the fourth exists because the detached writer's log lives in the container and is read there.
  - **The container test.** Inside a work container, a write under the overlay fails. `/proc/mounts` lists `/work/acceptance/s` as `ro`, and writes beside the suite and into its parent `acceptance/` land on the host.
- **With the stand-in.** A recording wrapper (`recordingDockerCommand`) logs each Docker argv. Tests then show:
  - the overlay on the gate run, phase 1, the self-review, the verification stage, remediation 1 and remediation 1's verification, and nowhere else;
  - only the two base mounts for a run without a suite, in the implementation, verification and code-review stages;
  - a phase that edits the suite, with the suite file inside the signed scope, refused by the new cause alone, kept under `refs/buildworks/refused/` and reset to the suite commit;
  - a specification declaring a file under `acceptance/` refused at write, including `Acceptance/x.spec.mjs`, and at approval.
- **The break-tests,** each restored byte for byte:
  - **Dropping `:ro`** fails both engine tests. Verification blocked with `the command left the worktree dirty in: M acceptance/s/s.spec.mjs`, and the container write succeeded.
  - **Not passing `readOnlyPaths` from remediation verification** fails its argv test on `remediation-1-verify`.
  - **Dropping the boundary cause** fails the suite-edit refusal test.
  - **Disabling the spec rule** fails both the write-time and the approval-time test.
- **Regression.** 401 of 402 tests passed across the twelve affected files, run in parallel. The one failure, `self-review-blocked`, is a race in the stand-in's shared state directory: another file's process deleted a container record while this one was listing them, giving `ENOENT` on a different container's file. It passes alone. The full suite runs serially, as recorded, in Task 10.
- **A weakness weighed (hazard 15). This is inference; it was not reproduced.** On a case-insensitive host, a write through `/work/Acceptance/<slug>/` would reach the suite directory through the writable base mount, not the read-only overlay. Two later checks should still catch it:
  - Git reports the change under the tracked path, which the boundary refuses;
  - verification's commit-state check fails on the dirty tree.

  The overlay is the first defence, not the only one.

  **Corrected 2026-10-21.** The weakness is real, and neither later check catches it. On this machine's engine (Docker 29.8.2), a write to `/work/Acceptance/review/test.spec.mjs` succeeded while the exact path refused it with `Read-only file system`. Restoring the bytes the same way left `git status --porcelain` empty, so the boundary and the commit-state check saw nothing. On such a host the overlay is the only defence against a write during verification, and it does not hold (`test/fixtures/recorded/acceptance-code-review-probes.json`, `caseAlias`).

## Task 8 build record (2026-10-21)

- **What was built.**
  - **The command.** With a suite, the verification stage and remediation verification append `acceptanceCommand(dir, repeatEach)` after the frozen commands. So the suite runs only when every frozen command passed, and an earlier block stands unchanged.
  - **The budget (Task 6's leftover).** `verifyCommit` takes `maxBytesFor`, a per-command output budget keyed by name. The acceptance command's budget is the retention ceiling; every other command keeps `resultMaxBytes`.
  - **The verdict.** `applyAcceptanceVerdict` in `src/acceptance.ts` acts only when the acceptance command's own outcome was its exit code. It reads the retained log, reads the committed suite files from the worktree, classifies the report and records `acceptance: { tests: [{ title, outcome, failureClass, message }] }` beside `commands`. The block reason, in order:
    - `acceptance failed: the suite does not load: <first line>` for a load error;
    - `acceptance failed: the suite has no tests`;
    - `acceptance failed: <titles>`;
    - `acceptance flaky: <titles>`.

    A non-zero exit with every test passing keeps the exit-code reason. A timeout, an overflow or a dirty tree also stands as it was. A log that is not a complete report blocks as `the acceptance report cannot be read: …`.
  - **Where it is recorded.** The verification stage writes the field into its `result.json`. Remediation verification carries it inside the round's `remediation.verification`, which is the same `CommitVerificationRecord` type.
  - **A reserved name (a decision this plan did not foresee).** The acceptance log is `acceptance.log`, so a frozen verify command named `acceptance` would share it. `freezeProfile` refuses that name when a suite is on. Without a suite the name stays the repository's to use.
- **Old records.** `parseVerificationHandoff` and `parsePassedCodeReviewRecord` ignore keys they do not check. The existing tests over the recorded `powershell-remediation-chain` fixture, which has no `acceptance` field, still pass. A verification record and a passed code-review record that carry the field both parse in the new stage tests.
- **The tests,** with the stand-in serving recorded Task 2 reports:
  - **Verification:** a passing suite passes and records each test; a failing one blocks naming its test, with `fail`, `valid_red` and the first error message; a flaky one blocks as flaky; one that does not load blocks by name; an earlier command's block stands and the suite never runs; and a report larger than the frozen budget passes under the retention ceiling.
  - **Remediation verification:** a passing suite is recorded in the round, and the record parses for delivery; a failing suite and a flaky suite each block with the reason named, before a second panel.
  - **Freeze:** the reserved-name refusal writes nothing.
  - **Task 7's argv tests** now commit a suite file and serve the pass report, because with a suite the acceptance command runs.
- **The break-tests,** each restored byte for byte:
  - **Treating flaky as pass in the block decision** fails the flaky test. The run still blocked, on the exit code, because the flaky report exits 1; what the test caught was the missing `acceptance flaky` reason.
  - **Skipping the verdict at remediation verification** fails all three remediation tests.
  - **Dropping the per-command budget** fails the budget test.
  - **Disabling the reserved-name check** fails the freeze test.
- **Regression.** `npm run typecheck` is clean. 309 of 309 tests pass across nine files run serially: the verification, code-review, implementation and delivery stage files, plus the profile, acceptance, code-review, handoff and operator-output files.

## Task 9 build record (2026-10-21)

- **What was built.**
  - **The patch prompts.** The phase, self-review and remediation builders take a trailing `acceptance` argument, `{ dir, command }` or `null`. With a suite, four lines follow the dependency rule in the same paragraph:
    - who wrote the suite, where it is, that it is read-only, and that the system refuses a change to it;
    - that it runs after the verification commands every time they run, and that a failing or flaky test blocks;
    - the system's own command, to run through `run_command`;
    - the abort rule: never special-case a test that contradicts the approved specification, match its inputs or detect the test environment; return `blocked`, and list the test's exact title in `incompleteTasks`.
  - **The reviewer lens.** `buildCodeReviewPrompt` takes `{ dir, alreadySatisfied }` or `null`. With a suite, after "Only the findings you return are considered.", it says where the suite is and that reviewers can read it. It says that code which detects the test environment (`navigator.webdriver` is the example) or special-cases a test's inputs is a high-severity defect. When the gate recorded any `already_satisfied` criteria, it lists their IDs as the author's claim to check. Like the rest of that prompt, it states no consequence.
  - **Where the claimed IDs come from.** The code-review stage reads `alreadySatisfied` from `.governance/acceptance/<run>/gate.json`. A run with a suite whose record is unreadable, or carries no list of strings, is refused before the stage row and any dispatch (a decision this plan did not foresee: the record is the only source of the claim).
  - **The dispute.** `disputedTests(incompleteTasks, titles)` in `src/acceptance.ts` returns each gate-recorded test title that some `incompleteTasks` entry contains whole. When a phase's blocked reply names one, the stage audits `implementation.acceptance.disputed` with `tests=<titles>` and then blocks as before. A blocked self-review that names one records the event with a `self-review: ` prefix and is skipped as before.
  - **Why a whole title, not an ID.** The plan's wording is "names an `AC-NNN` test title". A criterion ID alone also appears in an ordinary blocked reply ("AC-003: could not be implemented"), so matching the ID would report implementation failures as test-author errors. The prompt asks for the exact title.
- **Not done, and recorded as follow-ups.**
  - **Remediation disputes.** The remediation prompt states the abort rule, but the event name is the implementation stage's, so a blocked remediation that names a test records no dispute. Its block reason still quotes `incompleteTasks`.
  - **The prompt ablation** (ImpossibleBench). As the task says, it is not a gate; Task 11's run is its first data point.
- **Byte identity.** The six prompts the suite changes (phase, self-review, remediation, and the three seated reviewers) were hashed at `4be6b2a`, from a scratch copy of that commit, and again in the working tree before and after the edit. All three sets match. `test/prompts.test.ts` pins those hashes, built both with the arguments omitted and with an explicit `null`.
- **The tests.**
  - **Prompts:** with a suite, each patch prompt carries the four lines once, after the dependency rule, and removing them gives the prompt without a suite. The phase keeps its scraped blocks and its one phase sentence. The self-review still says neither "reviewer" nor "finding". Each reviewer prompt carries the lens, names the claimed criteria only when there are some, and still says neither "threshold" nor "blocks the run". The new fixed text is pinned in `CONSTRAINT_STRINGS`, above the criterion-quality block.
  - **The implementation stage:** a phase that disputes a test records the event and blocks; one naming only an ID records none; a self-review that disputes a test records it and is skipped. The prompts the stage sent carry the suite's directory and command.
  - **The code-review stage:** each reviewer prompt carries the lens, with and without claimed criteria; a run without a suite sends none; a missing or malformed gate record is refused before the stage row with nothing dispatched. Every remediation test with a suite now writes a gate record.
  - **The emitter.** `emit-implementation-stage.mjs` reads the suite directory from the prompt's first suite line and the first test title from the committed suite file, never from a literal.
- **The break-tests,** each restored byte for byte:
  - **Never recording a dispute** fails both dispute tests.
  - **Matching a criterion ID instead of the title** fails the ID-only test.
  - **Sending reviewers no lens** fails the reviewer-lens test.
  - **Accepting a non-string claimed ID** fails the gate-record refusal test.
  - **One character in the no-suite path** fails the byte-identity test.
  - **Rewording the abort rule** fails the constraint scan and the patch-prompt test.
  - **Always naming the claimed criteria** fails the reviewer-prompt test.
- **Regression.** 440 of 440 tests pass, with none skipped, across nine files run serially: the prompts, implementation, code-review and verification stage files, plus the profile, CLI, acceptance, approval and operator-output files.

## Task 10 build record (2026-10-21)

- **The driver.** `driver.mjs` passes `--acceptance-tests` to `new-run` when given it, and its header documents the flag. Without the flag the argv is unchanged.
- **Documents in the task's file list:**
  - `SKILL.md`, which covers the flag and the larger image;
  - `ARCHITECTURE.md` sections 5, 7, 11 and 23, with the operator's words verbatim in section 23;
  - `README.md`, which has ten agents, the test author's settings row, five non-reviewer settings and a new "Opt in to acceptance tests" section;
  - `docs/hazards.md` entries 18 and 23, as dated paragraphs;
  - `CLAUDE.md`, copied to `AGENTS.md`, with matching SHA-256 hashes;
  - the rework proposal's change 4 status. That status says the variants rule is stated in the author's prompt and not enforced.
- **Documents beyond the file list.** Each would otherwise have stated something false:
  - **ARCHITECTURE section 12:** the suite's gate and `gate.json`, the verification blocks, and the reviewer lens with its `gate.json` refusal.
  - **Section 15:** the `acceptance/<run>/` evidence entry.
  - **Section 20:** the implementation ceiling of plus two.
  - **`docs/runbooks/cli-operator.md`:** it omitted the test author, said "four non-reviewer settings", and listed the image as Node, npm and Git only.
- **Not changed.** Historical plans that say "nine agents" stay as history.
- **Verification.**
  - **The smoke.** `driver.mjs smoke` passes 13/13, and so does `smoke --acceptance-tests`. The second run's frozen profile carries `acceptance: {"dir":"acceptance/web-calculator/","repeatEach":2}`, and the first carries `null`.
  - **The checks.** `npm run typecheck` is clean, and so is `npm run check:docs`.
  - **The full suite.** It ran serially (`--test-concurrency=1`, with the stand-in state in the scratchpad) and took 69 minutes. 1,818 of 1,822 tests pass, with 0 failures and 4 skips, each skipped by name: three POSIX-only PATH differentials and one Windows symlink-privilege test. `git log -1` is `4be6b2a`, so nothing was committed.
  - **The engine.** A Docker engine was running, so `test/container.test.ts` and `test/acceptance-engine.test.ts` ran for real rather than skipping. Run on their own first, they passed 17 of 17.
- **Open follow-ups carried forward:**
  - the dashboard's `STAGE_SETTINGS.implementation` omits the test author;
  - remediation disputes are not recorded;
  - the prompt ablation;
  - the runbook's troubleshooting table has no rows for `acceptance failed`, `acceptance flaky` or a gate refusal.

  Task 11 needs its own authorization.

## Rollback

Revert the build commits.
- The Dockerfile's hash returns to the old tag, and runs frozen without `acceptance` are unaffected.
- Runs frozen with it become unexecutable and stay inspectable.
- Suites already committed on run branches stay as ordinary files.
- No stored schema changes.
