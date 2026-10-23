# Served Browser Pages Implementation Plan

**Status:** Implemented

**Goal:** Both of the system's browser runners, the acceptance runner and the reproduction checks runner, open the page under test from a loopback HTTP server rooted at the checkout, never from `file:///work/`. A page whose `index.html` loads a module script or a root-absolute path then loads them, which removes the measured cause of the two false confirmations. Whether the page's code started is still not checked: a page whose imported module is missing, or whose startup throws, can leave the same elements unchanged and still confirm a reproduction.

**Source:**
- `docs/hazards.md` entry 18, the paragraph "Measured, 2026-10-22, free, on the engine: a page whose code never ran confirmed two reproductions".
- The evidence it names:
  - `test/fixtures/recorded/reproduction-report-file-origin-ac-014.json` and `test/fixtures/recorded/reproduction-report-file-origin-ac-016.json`. Two reproductions written from the approved Target Tap specification were recorded `confirmed` by `confirmReproductions` at the delivered commit `37f048e`.
  - `test/fixtures/recorded/reproduction-diagnostic-file-origin.json`. The same page served over loopback HTTP met both criteria. Opened from disk it ran no code, because root-absolute paths resolved to `file:///src/...` and Chromium refused the module script by CORS.
- The operator, 2026-10-22: "record the evidence and write the fix plan", after the false-confirmation theory was tested.
- `docs/features/reproduced-review-findings/plan.md` and `docs/features/protected-acceptance-tests/plan.md`. These built the two runners this plan changes.

**Hazards considered:**
- **18 (correctness never inspected).** The motivating entry. A confirmation is executed evidence only when the page under test ran its code. This plan removes the file-origin cause of a page not running. It does not check that a page ran, because `judgeReproductionRun` still confirms on matcher failures without inspecting application startup.
- **4 (fixtures and code agreeing).**
  - The free benchmark's page loads a classic script by a relative path, and the acceptance engine tests' page uses an inline handler. So nothing tested a module page.
  - The new engine tests use the delivered Target Tap tree, captured from the 2026-10-22 paid run into `test/fixtures/recorded/target-tap-delivered-page.json`, not a page written here. Their expected outcomes come from the recorded HTTP diagnostic and the approved specification's criteria.
  - The server's own contract tests take their expected values from the contract stated under "Approach", not from the server's code.
- **22 (a guard that counts ignored files).** The server writes no file, and Playwright's output directory stays in the container's temporary directory, as today.
- **15 (a declared sandbox is not read-only).** The server runs inside the same container as the command that starts it. It serves read-only and is reachable only on the container's own loopback.
- **21 (agents never told their gate).** The test-author prompt and the reviewer's reproduction rules state how the page is opened, so both say it is served.
- **2 (discarded output).** A command's stdout and stderr both go to its retained log (`keep` in `src/verify-command.ts`), and the report reader parses everything after the header as one JSON document. So the server and Playwright's handling of it must print nothing; a stray line would make every report unreadable. The cost is accepted: the server's own exception text on an unexpected failure is discarded, and Playwright's report is the only record of it.
- **Not engaged:** 1, 3, 5 to 14, 16, 17, 19, 20, 23 and 24. No model output shape, prompt-validated field, stage order, retry or store schema changes.

**Assumptions:**
- **[Verified] Both configs open pages from disk.** `container/acceptance.config.mjs` and `container/checks.config.mjs` both set `use.baseURL: "file:///work/"`. The checks config is the acceptance config with `testDir: "/bw-checks"` and its own `outputDir`.
- **[Verified] Logs merge both streams.** A command's evidence log holds its stdout and stderr (`runVerifyCommand` in `src/verify-command.ts` passes both streams to `keep`, which writes to the evidence file). `readAcceptanceReport` (`src/acceptance.ts`) parses everything after the header line as JSON, and refuses the log by name when that fails.
- **[Verified] Loopback is never proxied.** The work container's environment sets `NO_PROXY=localhost,127.0.0.1,::1` (`LOOPBACK_HOSTS` in `src/container.ts`). `test/container.test.ts` already proves a command's call to its own local server stays direct.
- **[Verified] A missing page is a navigation failure.** `NAVIGATION` in `src/acceptance.ts` is `/net::ERR_|^\w*Error: page\.(goto|reload|goBack|goForward|waitForURL):/`. The recorded navigation case (`test/fixtures/recorded/acceptance-report-navigation.json`) failed with `net::ERR_FILE_NOT_FOUND at file:///work/other.html`.
- **[Inference] A 404 would not count as a navigation failure.** Over HTTP, a missing page answered with 404 lets `page.goto` succeed, and its tests would then fail on a matcher, which counts as a valid red. So the server answers a path it cannot serve by closing the connection without a response. Chromium is expected to report that as a `net::ERR_` failure. Task 1 records what it actually reports.
- **[Inference] Readiness must not depend on `/`.** Playwright's `webServer.port` waits only until the port accepts connections. `url` would wait for a response, and `/` has no response when `index.html` does not exist yet. Task 1 confirms it.
- **[Unknown] What a failed server start leaves in the report.** Whether Playwright records a web server that cannot start in the JSON report's top-level `errors` (which `judgeReproductionRun` reads as a load error), or prints it so that the log fails to parse, is not established. Either way the acceptance gate blocks and a reproduction ends `repro_failed`. Task 1 case 5 records which happens.
- **[Verified] The image follows `container/`.** The image tag is a hash over every file under `container/` (`sandboxImageTag`), and `new-run` freezes the image ID. A new file and changed configs therefore build a new image for new runs and leave every frozen run on its own image and its file-origin configs.
- **[Verified] Navigation instructions stay valid.** Both prompts tell the author to open `await page.goto("index.html")`, which resolves against the base URL either way. So no test the prompts ask for changes shape.
- **[Verified] The recorded reports stay valid inputs.** The stage tests and stand-in serve reports recorded under the file origin. The classifier keys on `net::ERR_` and the matcher headers, not on the URL scheme, so those reports still classify as they did.

**Approach:**
- **A system page server.** Add `container/serve.mjs`, copied to `/opt/bw-browser/serve.mjs`. It is a `node:http` server on `127.0.0.1:47731` that serves files under `/work`:
  - It accepts `GET` and `HEAD` only. `HEAD` answers with the headers `GET` would send and no body.
  - The URL path is percent-decoded, and the containment check runs on the decoded path resolved under `/work`. A resolved path that is neither `/work` nor under `/work/` is not served, so a sibling such as `/work-sibling` does not pass as a prefix. The file's real path is checked the same way, so a symlink inside `/work` that points outside it is not served.
  - The lexical check is one exported function, `resolveUnder(rawPath)`, which returns the resolved path or `null`. The module listens only when it is run as the main module, so a host test can call the function without starting a server.
  - A directory URL ending in `/` serves that directory's `index.html`. A directory URL without the trailing slash gets a `301` whose `Location` is the same path with `/` appended, so relative asset URLs resolve against the directory, as they do on a static host.
  - A fixed extension table gives the content type:
    - `.html`: `text/html; charset=utf-8`;
    - `.js` and `.mjs`: `text/javascript; charset=utf-8`, which module scripts require;
    - `.css`: `text/css; charset=utf-8`;
    - `.json` and `.map`: `application/json`;
    - `.txt`: `text/plain; charset=utf-8`;
    - `.svg`: `image/svg+xml`; `.png`: `image/png`; `.jpg` and `.jpeg`: `image/jpeg`; `.gif`: `image/gif`; `.webp`: `image/webp`; `.ico`: `image/x-icon`;
    - `.woff`: `font/woff`; `.woff2`: `font/woff2`; `.wasm`: `application/wasm`;
    - any other extension, or none: `application/octet-stream`.
  - Every response, the redirect included, carries `Cache-Control: no-store`.
  - Anything else it cannot serve (missing, outside `/work`, a read error, another method) gets no response: it closes the socket, so navigation fails as it does on a missing file today.
  - It writes no file and prints nothing. Its own exception text on an unexpected failure, such as a failed start or a read error other than a missing file, is therefore not retained, and an expected missing file and an unexpected read failure end as the same navigation failure. Playwright's report is the only record, and Task 1 case 5 records what it shows for a failed start.
- **Both configs use it.** Both add the same `webServer` block: `command: "node /opt/bw-browser/serve.mjs"`, `port: 47731`, `reuseExistingServer: false`, `stdout: "ignore"`, `stderr: "ignore"`, `timeout: 10_000`. Both set `use.baseURL: "http://127.0.0.1:47731/"`, and nothing else changes.
  - A port already in use makes Playwright refuse to start. That fails closed: an unreadable acceptance report blocks, and a reproduction ends `repro_failed`.
  - Commands in one container run one at a time, and each container has its own loopback, so one fixed port is enough.
- **The prompts say it is served.**
  - The acceptance test-author prompt's "opened from the checkout" sentence and the reproduction rule "The system runs it with a checkout of the reviewed commit as the working directory" both say the page is served from the checkout's root over loopback HTTP. So module scripts and root-absolute paths load, and no build step runs.
  - `page.goto("index.html")` is unchanged.
- **The documents stop saying "static page from `file:///work/`".** `ARCHITECTURE.md` section 7's runner paragraph, `CLAUDE.md` (copied to `AGENTS.md`), `README.md`'s "Opt in to acceptance tests", and `docs/runbooks/cli-operator.md` change to "a page served from the checkout's root, with `index.html` at the root as the entry page and no build step". "A target that must start its own server is not supported" stays true and stays.
- **Not in this plan:**
  - A guard that refuses `confirmed` when the page logged a failed script load. It would stop a false confirmation without fixing the page, and it needs per-test listeners the lint forbids in reviewer files. The operator may ask for it separately.
  - Running a target's build or its own server.
  - Changing any frozen run.

**Affected areas:**
- **Captured before the build:** `test/fixtures/recorded/target-tap-delivered-page.json` (2026-10-22; see Task 1).
- **Create:**
  - `container/serve.mjs`;
  - `test/serve.test.ts`;
  - the Task 1 recorded reports under `test/fixtures/recorded/`.
- **Modify, code:**
  - `container/acceptance.config.mjs`, `container/checks.config.mjs` and `container/Dockerfile`;
  - `src/prompts.ts`: `REPRODUCTION_RULES` and `buildAcceptanceTestAuthorPrompt`.
- **Modify, tests:**
  - `test/acceptance-engine.test.ts` and `test/reproduced-findings-benchmark.test.ts`;
  - `test/prompts.test.ts`, whose `CONSTRAINT_STRINGS` entry pins the reproduction rule's sentence and whose reviewer-prompt test asserts its exact `page.goto` clause.
- **Modify, documents:**
  - `ARCHITECTURE.md` section 7 ("Repository contract");
  - `CLAUDE.md` and `AGENTS.md`;
  - `README.md` and `docs/runbooks/cli-operator.md`;
  - `docs/hazards.md` entry 18 (a dated remedy paragraph).

**Known blockers:**
- **Engine-only verification.** Every behavioural check here needs a real Docker engine. The engine suites skip by name without one (`CLAUDE.md`, "Phased implementation"). A build changes `container/`, so the first engine test after Task 1 builds a new image, which takes several minutes and needs registry access (`ensureImage`).
- **A pre-existing suite failure.** The two `test/sign-approval.test.ts` keygen refusal tests fail on Node v26.4.0 with a libuv assertion in `process.exit`, unchanged by this plan (`.claude/sessions/project-learnings.md`, Current state). The full-suite criterion names them.
- **No operator decision is open.** This plan changes no stage, gate or policy value, and the runners' contract (`page.goto("index.html")`) is unchanged.

**Blast radius** (searched 2026-10-22):
- **The two configs** are used only through the commands `src/acceptance.ts` builds:
  - `acceptanceCommand`, called from three files:
    - `src/implementation-stage.ts`: the gate baseline, the phases' verification, and the command it passes into `buildAcceptanceTestAuthorPrompt` for the author's own runs;
    - `src/verification-stage.ts`;
    - `src/code-review-stage.ts`: remediation verification and the remediation prompt.
  - `reproductionCommand`, called from `src/code-review-stage.ts`: `confirmReproductions` and `preserveCheck`, whose command `runPreservedChecks` runs and the remediation prompt prints.

  None reads `baseURL`. Found by `grep -rn "file:///work\|baseURL" src container scripts test/*.ts`: only the two configs.
- **The gate baseline stub** (`ACCEPTANCE_STUB_PAGE`, written into a throwaway checkout by `src/implementation-stage.ts`) is served like any other `index.html`.
- **The image.** `container/Dockerfile` gains one `COPY`, and the tag changes (`test/acceptance.test.ts` pins only that the tag follows the directory). New runs build and freeze the new image.
- **The prompts.**
  - `REPRODUCTION_RULES` is pinned twice by `test/prompts.test.ts`. `CONSTRAINT_STRINGS` holds "The system runs it with a checkout of the reviewed commit as the working directory, so open the page with", and a reviewer-prompt assertion (line 2855) requires the literal ``open the page with `await page.goto("index.html")`.``, period included. The new rule puts a semicolon after the call, so that assertion fails unless it changes too. The reviewer pre-suite hash test removes the joined rules block, so it tolerates a changed rule line, but it does not cover the line 2855 assertion.
  - The test-author sentence is not pinned (`grep -n "opened from the checkout" test/*.ts`: no match).
- **Engine tests that run the runners.** `test/acceptance-engine.test.ts` runs the recorded pass suite on an inline-handler page, and `test/reproduced-findings-benchmark.test.ts` runs the calculator trees. Both must still pass over HTTP; nothing in them names the scheme.
- **Store, profile and records:** no change. No table, column, frozen field or `result.json` member is added.

**Verification:**
- **Component:** Task 1's recorded engine reports, the server's contract tests on the host and on the engine, and each task's tests. Every new guard is broken and restored, with the bytes compared to a copy.
- **The motivating failure:** the two Target Tap reproductions come back `not_reproduced` through `confirmReproductions`, and the acceptance suite of the same two tests passes through `verifyCommit`.
- **Regression:**
  - `npm run typecheck` and `npm run check:docs`;
  - the full serial no-engine suite, then `git log -1`;
  - the engine suites `test/container.test.ts`, `test/acceptance-engine.test.ts` and `test/reproduced-findings-benchmark.test.ts`.
- **No paid run.** The engine tests exercise both runners against recorded model output.

---

## Tasks

### Task 1: The page server, proven on the engine

**Depends on:** nothing.

**Files:**
- Create: `container/serve.mjs`, as in "Approach". The port is one constant, `47731`, and the root is `/work`.
- Modify: `container/acceptance.config.mjs` and `container/checks.config.mjs`. Each gains the `webServer` block and the HTTP `baseURL`, and its header comment says why: the evidence paragraph's two causes.
- Modify: `container/Dockerfile`: `COPY serve.mjs /opt/bw-browser/serve.mjs`, with a comment naming this plan.
- Use: `test/fixtures/recorded/target-tap-delivered-page.json`, captured on 2026-10-22 before the build, from commit `37f048e3893eab96da3fa6b7880a849f8929668d` (tree `4858dd42cbc225f797a4d6d981eb17f5d253cc3f`) of the Target Tap paid run's target. It is the repository's only copy of that page. Its `manifest` lists every path in the commit's tree with mode, blob ID and size. Its `files` hold the bytes of `index.html`, `package.json` and every file under `src/`, each rehashed to its blob ID when it was captured. Its `provenance` names the run, the commit, the capture date and what was dropped: the tests, docs, lockfile, `governed.yaml` and tool configs, which stay named in `manifest`.

**Steps:**
- **Rebuild the image.** Run `ensureImage(["docker"])` through a scratch `.mjs` that imports `src/container.ts` by its `file:///C:/...` URL, and record the new tag and image ID.
- **The spike:** six runs on the real engine, each through the system's own path, not a direct `docker run`. Every tree built from the delivered-page fixture first rehashes each file to its `manifest` blob ID.
  1. The two reproductions in `reproduction-report-file-origin-ac-014.json` and `-ac-016.json` (their `files[0].content`), through `confirmReproductions` against a temporary repository built from the delivered-page fixture. Expected: both `not_reproduced`, from the recorded HTTP diagnostic, where the message showed and `#start` hid.
  2. The navigation case's suite from `acceptance-report-navigation.json` (`files`), through `verifyCommit` with `acceptanceCommand`, on a page holding no `other.html`. The command blocks, and its retained log is the record. Expected: each result's first error matches `NAVIGATION`, and its exact text is recorded.
  3. The recorded pass suite (`acceptance-report-pass.json`) through `verifyCommit` with `acceptanceCommand`, on `test/acceptance-engine.test.ts`'s `PAGE`. Expected: every result passed.
  4. The same pass suite with no `index.html` in the tree, to confirm that the server starting does not depend on `/`. Expected: the report loads, and its tests fail on navigation, not with a webServer timeout.
  5. A failed server start: `verifyCommit` whose one frozen verification command is `sh -c` holding a `node -e` listener on `127.0.0.1:47731` started in the background, then the acceptance runner's own argv from `acceptanceCommand`, on the pass case's tree. Expected: the command fails, and the log's report either names the web server in its top-level `errors` or does not parse. The recorded text settles the `[Unknown]` above.
  6. For each of cases 1 to 4, `readAcceptanceReport` (or `readReproductionReport`) returns `ok: true` with no top-level `errors`. That proves nothing the server or Playwright printed reached the log, and that the server started.

  Commit each log as `test/fixtures/recorded/served-report-<case>.json` (`reproduction-ac-014`, `reproduction-ac-016`, `navigation`, `pass`, `no-index`, `startup-failure`). Use the Task 1 shape of the reproduced-review-findings plan: `provenance`, `files`, `log`.
- **Stop rule.** Stop and report the recorded log before Task 2 if any of these fails:
  - case 1 is `not_reproduced` for both reproductions;
  - case 2's first errors match `NAVIGATION`;
  - case 3's results all passed;
  - case 4's report loads and its tests fail on navigation, not a webServer timeout;
  - case 5's command fails;
  - case 6 holds for every log.

  The approach is then wrong, and another variant is not to be tried without the operator.
- Verify: `node --test test/acceptance.test.ts` and `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the six recorded reports, the new image ID, and each expected result met.

### Task 2: Engine regression tests for both runners

**Depends on:** Task 1.

**Files:**
- Modify: `test/reproduced-findings-benchmark.test.ts`. Add a test that runs the two recorded Target Tap reproductions through `confirmReproductions` against the delivered-page fixture tree. It expects both `not_reproduced`, and names the HTTP diagnostic and the specification criteria as the source of that expectation.
- Modify: `test/acceptance-engine.test.ts`.
  - Add a test that commits the same two files as an acceptance suite under `acceptance/s/`, in a target built from the delivered-page fixture, and runs `verifyCommit` with `acceptanceCommand`. It expects `outcome` `pass`, and every result passed on both repeats.
  - Add a test from the recorded navigation case. It expects each result's `classifyFailure` to be `navigation`, as the recorded file-origin case was.
  - Add a test from Task 1 case 4, the pass suite on a tree with no `index.html`. It expects the report to load with no top-level `errors`, and every result to classify as `navigation`. This keeps readiness independent of `/` as a regression, not only a spike record.
  - Add a test in which two runner invocations share one container: `verifyCommit` whose frozen verification command is the acceptance runner's argv on the pass suite, followed by the acceptance command itself on the same suite. It expects both logs to load with every result passed, which proves the first invocation released port `47731`.
  - Add the server's contract test. A disposable target commits `index.html`, `mod.mjs`, `data.unknownext`, `sub/index.html` and a probe script, and `verifyCommit` runs the probe as the frozen verification command. The probe starts `/opt/bw-browser/serve.mjs` as a child, waits for the port, sends raw `node:http` requests and prints one JSON result. Before its symlink case, it writes `/tmp/bw-outside/secret.txt`, reads it directly to prove it exists, and links `/work/outside-link` to `/tmp/bw-outside`. It removes the link before it exits, so the tree stays clean. The expected values come from the contract under "Approach":
    - `GET /` and `GET /index.html`: `200`, `text/html; charset=utf-8`, the file's bytes;
    - `HEAD /index.html`: `200`, the same headers as `GET`, an empty body;
    - `GET /mod.mjs`: `text/javascript; charset=utf-8`; `GET /data.unknownext`: `application/octet-stream`;
    - `GET /sub`: `301` with `Location: /sub/`; `GET /sub/`: `sub/index.html`'s bytes;
    - every response: `Cache-Control: no-store`;
    - closed without a response: `GET /missing.html`, `POST /index.html`, the encoded traversal `GET /%2e%2e/etc/passwd`, and `GET /outside-link/secret.txt`.
- Create: `test/serve.test.ts`, a host test with no engine. It loads `container/serve.mjs` through a dynamic import of its file URL, held in a variable so that `tsc` needs no declaration for the `.mjs` file, and calls `resolveUnder`. Its cases come from the containment rule under "Approach": `/sub/../index.html` resolves to `/work/index.html`; `null` for the decoded traversal `/%2e%2e/etc/passwd`, the sibling-prefix escape `/../work-sibling/x` and its encoded form `/%2e%2e/work-sibling/x`. Importing the module must not start a server.

**Steps:**
- Run both engine files on the engine, and `node --test test/serve.test.ts` on the host. Expected: the new tests and every existing test pass.
- **Break-tests,** each on a copy restored byte-for-byte, with the image rebuilt whenever `container/` changed for an engine test:
  - set `baseURL` back to `"file:///work/"` in `container/checks.config.mjs`: the reproduction test fails with `confirmed`;
  - the same in `container/acceptance.config.mjs`: the acceptance test fails, blocking on `acceptance failed`;
  - make `serve.mjs` answer a missing path with a 404 response: the navigation test fails, because the class is no longer `navigation`;
  - check containment on the raw path but read the decoded one: `test/serve.test.ts`'s encoded traversal case fails;
  - test containment with a bare `startsWith("/work")`: the sibling-prefix cases fail;
  - remove the real-path check: the contract test's symlink case is served and fails;
  - map `.mjs` to the unknown-extension type: the contract test's `.mjs` case fails.
- Verify: `node --test test/reproduced-findings-benchmark.test.ts test/acceptance-engine.test.ts` on the engine, and `node --test test/serve.test.ts`. Expected: pass.

**Task completion evidence:** the test output and the seven break-test failures.

### Task 3: The prompts say the page is served

**Depends on:** Task 1.

**Files:**
- Modify: `src/prompts.ts`.
  - `REPRODUCTION_RULES`' fourth rule becomes: "The system serves the reviewed commit's checkout over loopback HTTP, with the page at its root, so open the page with `await page.goto("index.html")`; module scripts and root-absolute paths load, and no build step runs."
  - `buildAcceptanceTestAuthorPrompt`'s "Open the page in every test…" sentence ends "…the page under test is index.html at the repository root, served from the checkout over loopback HTTP, where module scripts and root-absolute paths load and no build step runs."
- Modify: `test/prompts.test.ts`.
  - The `CONSTRAINT_STRINGS` entry becomes the new rule's text up to "open the page with".
  - The reviewer-prompt assertion at line 2855 becomes the new rule's literal ``open the page with `await page.goto("index.html")`;``, so it still covers the navigation instruction. Beside it, assert the prompt includes "over loopback HTTP".

**Steps:**
- Verify: `node --test test/prompts.test.ts test/code-review-stage.test.ts`. Expected: pass; the reviewer pre-suite hash test still passes, because it removes the rules block whole, and the line 2855 assertion passes on the new literal.
- **Break-test:** wrap the new rule across a template-literal line break in the source. The `CONSTRAINT_STRINGS` scan fails. Restore and compare bytes.

**Task completion evidence:** the tests and the break-test failure.

### Task 4: Documents and regression

**Depends on:** Tasks 1 to 3.

**Files:**
- Modify: `ARCHITECTURE.md` section 7's runner paragraph, the one that begins "The image also holds the system's acceptance runner". Change "The runner opens static pages from the worktree (`file:///work/`)" to: both runners serve the checkout's root over loopback HTTP through `container/serve.mjs`; "a target that must start its own server first is not supported" stays.
- Modify: `CLAUDE.md`, then copy it to `AGENTS.md` and compare the hashes. "The suite applies only to static pages opening from a root `index.html`" becomes "The suite applies only to a page served from the checkout's root, entered at a root `index.html`, with no build step".
- Modify: `README.md` ("Opt in to acceptance tests") and `docs/runbooks/cli-operator.md` (its "For a static page that opens from the worktree" sentence), to the same rule.
- Modify: `docs/hazards.md` entry 18. Add a dated remedy paragraph after the measured one: what changed, the Task 1 and Task 2 evidence, and what it does not show. A page that needs a build, a target's own server, and a frozen run on an older image are all still unchanged. Nothing yet checks that a page's code started, so a missing imported module or a startup exception can still confirm a reproduction. The server's own exception text on an unexpected failure is not retained.

**Steps:**
- Grep for the old wording, and fix every site it finds: `grep -rn "file:///work\|static page\|opens from the worktree\|opening from a root" ARCHITECTURE.md CLAUDE.md README.md docs/runbooks .claude/skills src`.
- Verify, in order:
  - `npm run typecheck`;
  - `npm run check:docs`;
  - the full serial no-engine suite (`node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`, backgrounded), then `git log -1`;
  - the engine suites `test/container.test.ts`, `test/acceptance-engine.test.ts` and `test/reproduced-findings-benchmark.test.ts`.

  Expected: clean; clean; 0 failures other than the two named `sign-approval` keygen tests, with the named skips; the engine suites passing.

**Task completion evidence:** the counts, the grep output after the edits, and the equal hashes.

## Implementation record

Built 2026-10-22 and 2026-10-23 on `sandboxed-delivery`, after the delivered-page fixture was committed as `12619c8`. No paid run was made.

- **Task 1.** The image built as `bw-sandbox:975c2e567b66` (`sha256:dac27c6bdf2f652da84ca1f230b1eeb2c3c564a4a882021b58ea5400738ed037`). The six spike cases met the stop rule:
  - both reproductions were `not_reproduced`;
  - a missing page failed `page.goto` with `net::ERR_EMPTY_RESPONSE`, which classifies as `navigation`;
  - the pass suite passed;
  - the tree with no `index.html` loaded with no top-level errors and failed on navigation;
  - a taken port produced one top-level report error, "http://localhost:47731 is already used …", with no tests, which settles the `[Unknown]` above: the report parses and names the web server.

  The records are `test/fixtures/recorded/served-report-{reproduction-ac-014,reproduction-ac-016,navigation,pass,no-index,startup-failure}.json`. `test/acceptance.test.ts` passed 36/36, and typecheck was clean.
- **Task 2.** The engine files passed 17/17 and `test/serve.test.ts` 4/4. All seven planned break-tests failed for the intended reason, each file restored byte-for-byte: with the checks config back on `file:///work/`, the Target Tap reproduction ended `confirmed` again.
- **Task 3.** `test/prompts.test.ts` and `test/code-review-stage.test.ts` passed 156/156, and the line-wrap break-test failed both pinned checks. Deviation: `REPRODUCTION_RULE_SENTENCES` also gained the rule's text after the backtick ("; module scripts and root-absolute paths load, and no build step runs."), as the list already does for every rule that continues past one.
- **Task 4.** The documents changed as listed. After the edits the grep finds only the new `ARCHITECTURE.md` sentence that explains why `file:///work/` was dropped. `CLAUDE.md` and `AGENTS.md` hash equal. Typecheck and `check:docs` are clean. The full serial suite, engine included, passed 1887 of 1893: the 2 failures are the named `sign-approval` keygen tests, the 4 skips are the existing platform skips, and `git log -1` was unchanged.
- **Independent code review** (`2026-10-22-code-review.md`). It found 5 findings: 4 accepted and 1 deferred, with no material defect. The server now collapses leading slashes in a redirect's `Location`, so `//sub` cannot become a protocol-relative redirect. It closes a malformed request instead of answering 400. The contract test now compares `Content-Length`, `HEAD` included, and its encoded traversal targets a file that exists outside `/work`. Each new guard failed its own break-test, except one: a raw-path containment check still passes the engine test, because the real-path check refuses the same escape on its own. So `test/serve.test.ts` remains the only test of the lexical layer alone.
- **Deferred:** the "Approach" statement that commands in one container run one at a time holds for `verifyCommit`. It does not hold for a dispatch container, where every `run_command` call shares one container. A runner killed at the command ceiling there can leave the server holding port 47731 [Inference, not run]. No gate is affected. Hazard 18's remedy paragraph names it, and fixing it is the operator's decision.

## Rollback

Revert the build commits.
- The configs return to `file:///work/`, and `container/serve.mjs` goes.
- The image tag returns to the earlier one, so new runs freeze the earlier image again.
- No stored schema, frozen profile or record changes. A run frozen on the served image keeps it, and its reports parse under either reader.
