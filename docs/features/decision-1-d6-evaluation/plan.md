# Decision-1 Client and D6 Evaluation Implementation Plan

**Status:** Implemented

**Goal:** A concrete client for Microsoft-Decision-1 on the operator's Foundry resource, configured by three environment variables, and one recorded evaluation of decision D6. D6 asks Decision-1 which clause of the approved specification a code-review finding asks to go beyond. The evaluation scores those answers against the 26 labelled code-review reconciler cases and compares them with Haiku's recorded calls. It ends with a pass or fail verdict under an adoption rule fixed before the run. Nothing is wired into a stage.

**Source:** Operator decisions 2026-10-16. Asked what this plan should cover, the operator chose "Client + D6 evaluation": the proposal's step 1 and nothing past it, with adoption left to a later plan. Asked how the client authenticates, the operator chose "API key env variable". The operator stated that the endpoint, the deployment name and the deployment type "will change" and must be variables. Current values: endpoint `https://snitch-resource.services.ai.azure.com/providers/microsoft/v1/systemone`, deployment `Decision-1`, type `DataZoneStandard`. The design is `docs/proposals/decision-1-review.md`: its D6 bullet, "Evaluation before adoption", "Proposed order" step 1, "Implementation shape" and "Failure handling". The labelled cases are `test/fixtures/recorded/code-review-reconciler-replay-crew-chatter-run-6.json` and `test/fixtures/recorded/code-review-reconciler-test-5-crew-chatter-run-6.json`. They judge findings from `test/fixtures/recorded/code-review-crew-chatter-run-6.json` against the specification pinned in `test/fixtures/recorded/crew-chatter-run-6-approved-spec-plan.json`.

**Assumptions:**
- **Nothing is frozen into a run profile.** The proposal freezes the three variables at `new-run`. This plan has no run: only the evaluation script reads the variables, once at start, and records the values it used in the result fixture. Freezing them into `src/profile.ts` belongs to the adoption plan, together with the `ARCHITECTURE.md` section 11 amendment. That plan should grep for this sentence.
- **One question per request.** Each request carries one D6 `choice` question. Whether questions sharing a request are judged in isolation is unconfirmed (the proposal's "Evaluation" bullet), and one question per request makes that irrelevant here.
- **The state is the finding plus the specification, not the diff.** Haiku's recorded calls also received the approved plan, the full diff and read access to the checkout (125,867-byte prompts). Those do not fit Decision-1's 32,768-token input limit. So the comparison with Haiku is not like for like, and the report says so. D6's question is whether the *specification* excludes what the finding asks for, which needs only the specification.
- **The options are the specification's clauses.** One option per clause, plus `none`. A clause is one non-empty line of the specification body, with these excluded: the front matter, headings, the `## Declared artifacts` section, and bullets that are only a bold label (such as `- **Authentication:**`). Each clause is named `L` plus its 1-based line number in the pinned specification, zero-padded to three digits (`L047`). Every bullet and paragraph in the pinned specification is one line, so a line is a whole clause. The run 6 specification has 148 lines and 91 bullet lines, so the option count is about 100. Task 2 confirms that a choice with 100 options is accepted.
- **Labels and baselines come from the fixtures.**
  - The replay set's labels are parsed from the comment in its `reconcilerSource`: "Labels (fixed before any call): reject 200; keep 195 197 198 199 201 202 203 204 205; either 196 206 207."
  - Test 5's labels are its structured `sets.5a.labels` and `sets.5b.labels`.
  - That gives 26 cases: 2 reject (#200, #905), 17 keep and 7 either.
  - A withheld reject-labelled finding counts as correct only when the chosen clause is one of its labelled baselines. For #200 that is line 47 or line 49 (provenance: "spec baseline lines 47 and 49"). For #905 it is line 47, the clause containing "Sign-out clears the cookie." (set 5b's provenance).
  - Task 1 asks the operator to confirm them, because the proposal says the labels were "fixed … from the spec text by an assistant session".
- **Repeats.** The 26 cases are asked once each, and #905, the case Haiku split on (kept in 3 of 10 calls), is asked 9 more times: 35 requests. The proposal asks for "the spread of answers when the identical request is repeated" on one fixed case. If the 10 answers for #905 disagree, single answers are not a sound basis, and the adoption rule fails on its determinism clause rather than averaging.
- **No retries.** A 429 or any other failure stops the script with the status named. Rerunning it resumes from the first request that has no recorded result, so a rerun after a 429 sends nothing twice (hazard 7: the stop changes nothing, the operator decides when to resume).
- **No typed-question Haiku baseline.** The proposal's measurement list includes the same typed question asked of Haiku 5.5 through `--json-schema`. That is a Claude spend outside the operator's choice. The 30 recorded Haiku calls are the comparison the proposal's D6 bullet names ("compare its errors with Haiku's on the same cases").
- **Cost.** About 35 requests of about 8K input tokens, roughly 0.3M tokens, or about $0.012 at $0.042 per million [Inference from character counts]. The probe adds at most 8 small requests. Neither is authorized by this plan. Each needs the operator's consent when it runs.

**Approach:** The operator first confirms the labels, the adoption rule, the threshold and the data. A small paid probe then settles the request and response schema and the auth header from real responses, and records them. The client is written and tested against those recordings: config reading, one request, response validation, and failure handling. A script builds the 35 D6 requests from the committed fixtures, sends them sequentially and resumably, scores them, and writes a recorded result fixture that a test re-checks. The proposal and the learnings are then updated with what was settled and the verdict.

**Affected areas:** New `src/systemone.ts`, `scripts/systemone-d6-evaluation.ts`, `test/systemone.test.ts`, `test/systemone-d6-evaluation.test.ts`, `test/systemone-d6-evidence.test.ts`, `test/fixtures/recorded/systemone-probe-snitch-resource.json` and `test/fixtures/recorded/systemone-d6-evaluation-crew-chatter-run-6.json`. Modified: `src/policy.ts` (one constant), `tsconfig.json` (`include`), `docs/proposals/decision-1-review.md` and `.claude/sessions/project-learnings.md`.

**Known blockers:**
- **[Verified]** No primary source for the request or response schema has been read. The proposal says Microsoft Learn's page "was not retrieved", and the auth header, the response fields, a per-option probability on `choice` and the option cap are unconfirmed. Task 2 settles them before any client code is written. If no primary source and no recorded response settles the schema, the plan stops there.
- **[Verified]** `CLAUDE.md`: "A completed paid run never authorizes another spend", and the learnings say "ask before each paid range". Tasks 2 and 6 each ask at the moment they run.
- **[Verified]** The labels need operator confirmation before they count as ground truth (proposal, "Evaluation before adoption", D6 bullet). Task 1.
- **[Verified]** `tsconfig.json` has `"include": ["src", "test"]`, so a `.ts` file under `scripts/` is not typechecked unless `scripts` is added. `scripts/` holds only `doc-check.mjs` and `sign-approval.mjs`, and without `allowJs`, `tsc` ignores `.mjs`.
- **[Verified]** `package.json` declares `"engines": {"node": ">=24"}`, and `import.meta.main` appeared only in Node 24.2. A script guarded by it would silently do nothing on 24.0 or 24.1. The script compares `import.meta.url` with `pathToFileURL(process.argv[1]).href` instead. This machine runs Node v26.4.0.
- **[Verified]** The original crew-chatter target is not on this machine. `C:\Repositories\testing-repos\crew-chatter` is a new repository holding only an uncommitted design document in its docs folder, with no commits (checked 2026-10-16). This plan never reads the target. The specification, plan, findings, labels and Haiku decisions it uses are all committed under `test/fixtures/recorded/`, and D6's state is the finding plus the pinned specification, with no diff or checkout.
- **[Inference]** The `ARCHITECTURE.md` section 11 amendment ("There is one adapter, concrete, with no interface above it until a second harness exists") is not needed here, because nothing on a run's path calls the client (Blast radius). The adoption plan needs it.

**Blast radius:** (evidence: Grep over `src`, `test` and `scripts`, 2026-10-16)
- No module in `src` makes an HTTP request from Node today: `fetch(` occurs only in `src/dashboard/app.js`, which runs in the browser. `src/systemone.ts` is imported only by the new script and the new tests.
- `src/policy.ts` gains `SYSTEMONE_REQUEST_TIMEOUT_MS`. `test/policy.test.ts`'s `FROZEN_ONLY` lists the constants stage modules must not import. This one is not frozen, and no stage module imports it, so that test is unaffected.
- `tsconfig.json`'s `include` gains `scripts`. That adds `scripts/systemone-d6-evaluation.ts` to `npm run typecheck` and nothing else.
- `npm test` runs `node --test test/*.test.ts`, so the three new test files join the suite. The evidence test reads only committed fixtures and makes no network call.
- The script reuses `validateReconcilerReply` and `agreedRejections` (`src/code-review-reconcile.ts`), `validateSpecDoc` (`src/spec-doc.ts`) and `sha256Hex` (`src/canonical.ts`) without changing them.

**Verification:** Component: config reading refuses each missing or invalid variable. The client sends the recorded request shape and accepts the recorded success response. It fails closed on the recorded 401 and wrong-deployment responses, a dropped connection and a timeout, and never puts the key in a reason. The D6 builder and scorer reproduce the fixtures' labels, baselines and Haiku verdicts. The evidence test rebuilds every recorded request by hash and re-scores the recorded responses to the recorded verdict. End to end: one paid evaluation of 35 requests that writes its fixture and verdict. Regression: `npm run typecheck`, `npm run check:docs`, and the full serial suite with 0 failures and HEAD unchanged. A pass shows that D6 met the rule on 26 cases from one stand-in project, and nothing more. Adopting D6 is a separate decision and a separate plan.

**Hazards considered:**
- **1 (model output shapes):** Decision-1 answers are typed, but their wire shape is unconfirmed. The validator is written against recorded responses (Task 2), and any mismatch fails the request rather than being coerced.
- **2 (undiagnosable output):** every raw response is kept in the script's output directory and copied into the result fixture. A failure prints the HTTP status and body.
- **4 (fixtures agreeing with code):** request and response shapes come from the probe's recorded responses. Labels and baselines come from the reconciler fixtures. Haiku's numbers are computed from its recorded decisions and verdicts. The adoption rule is fixed before the run. Nothing expected is invented in the session that consumes it.
- **7 (retries that vary nothing):** no automatic retry. A stop is resumable and sends no request twice.
- **10 (moving aliases):** the deployment name is an alias the operator controls. The result fixture records the variables used and any model or version the responses report. If no response reports a version, the fixture says so, which is evidence for the adoption plan's hazard-10 decision.
- **12 (configuration divergence):** the three variables differ between machines. The script prints and records the values it used, and the evidence test reads them from the fixture, never from the environment.
- **13 and 16 (inventing obligations; a quote is not support):** D6 picks a clause rather than quoting one, so the quoted words always exist. Whether the clause supports the rejection is exactly what the labelled baselines check. The case set holds only two reject-labelled findings, so a pass is weak evidence, and the report says so.
- **14 (independence):** Decision-1 is a different model family from the Claude author and reviewers. That makes its answers independent of them by construction, not correct.
- Not weighed: 3, 5, 6, 8, 9, 11, 15, 17-23. They concern prompts to generating agents, delivery, executables, hooks, sandboxing, reconciliation edits, phases and cleanup, and no stage runs here.

---

## The D6 question

Every request carries one question, named `baseline`, of type `choice`. Its text is fixed. Its hash is recorded, because Microsoft warns that results change with wording:

> The state holds one finding a code reviewer reported against code built from the approved specification, followed by that specification. Which clause of the specification states a workable baseline that the finding asks to go beyond, by requesting protection, limits or policy the specification does not require? Choose none when the finding reports code that fails a behaviour the specification states, or that breaks in ordinary use: it crashes, loses or corrupts data, returns a wrong result, or lets a user read or change data the specification does not allow. When unsure, choose none.

The options:
- **One option per clause:** named `L<nnn>`, with the rubric "The finding asks to go beyond this clause of the specification: <clause text>".
- **`none`:** with the rubric "No clause: the implementer must fix the reported code."

The rule restates the measured Haiku prompt's keep and reject rules (`reconcilerSource`: "Keep a finding when…", "Reject a finding only when…", "When you are unsure, keep the finding").

The state is this text, with one `- reviewer` line per report in the finding's report order, followed by the pinned specification exactly:

```text
Finding reported by code review:
- location <location>
- reviewer <reviewer>; severity <severity>; subject <subject>

Approved specification:

```

A finding is **withheld** when the answer is not `none` and its probability is at least the threshold. Rule clauses 3 and 4 and the Brier score read each case's first answer (`case-<id>`). The nine `repeat-905-<n>` answers serve only clause 2.

## Adoption rule (proposed; the operator confirms or amends it in Task 1, before any request)

At threshold T = 0.8, D6 passes only when all four hold:
1. **Validity:** all 35 responses pass validation.
2. **Determinism:** the 10 answers for #905 choose the same option, and their probabilities for that option differ by at most 0.01.
3. **No wrong rejections:** none of the 17 keep-labelled findings is withheld.
4. **Correct rejections:** #200 and #905 are both withheld, each with one of its labelled baseline clauses.

Otherwise D6 fails at this deployment, and the report names each clause that failed.

These are reported for information and are not part of the verdict:
- the four checks at T = 0.5, 0.6, 0.7, 0.9 and 0.95;
- the Brier score of P(withhold) = 1 − P(`none`) over the 19 labelled findings;
- the answers on the 7 either-labelled findings;
- Haiku's recorded rates: per single call, and for the built 2-of-2 rule over the call pairs (1,2) … (9,10).

T = 0.8 is this plan's proposal and has no measurement behind it.

## Operator confirmations (2026-10-16)

- **Labels and baselines: confirmed as listed.** The 26 labels are: reject #200 and #905; keep 195, 197, 198, 199, 201, 202, 203, 204, 205, 208, 209, 210, 211, 212, 901, 904 and 906; either 196, 206, 207, 213, 214, 902 and 903. The baselines are #200 → `L047` or `L049`, and #905 → `L047` only. There are no overrides.
- **Adoption rule: confirmed as written, with T = 0.8.**
- **Data: confirmed.** The run 6 specification and its findings may be sent to `snitch-resource`.
- **Task 2 probe spend: consented.** At most 8 requests, synthetic content only, under $0.001. The 35-request evaluation (Task 6) is not covered and needs its own consent.

## Tasks

### Task 1: Operator confirmations

**Depends on:** None

**Files:**
- Modify: `docs/features/decision-1-d6-evaluation/plan.md` — an "Operator confirmations" section under the adoption rule.

**Steps:**
- Ask the operator, in one question set:
  - confirm or amend the 26 labels and the two baselines under Assumptions;
  - confirm or amend the adoption rule and T;
  - confirm that the crew-chatter specification and findings, which are already committed in this repository, may be sent to `snitch-resource`.
- Record each answer, dated, in the new section. If a label or baseline changes, also record it as an override list that Task 5's loader applies after parsing, so the fixture-derived labels stay visible beside the amendment.
- Verify: `npm run check:docs`
- Expected: `doc-check: clean`, apart from standing warnings.

**Task completion evidence:** the dated confirmations in this plan.

### Task 2: Probe snitch-resource and record the wire format (paid)

**Depends on:** Task 1

**Files:**
- Create: `test/fixtures/recorded/systemone-probe-snitch-resource.json`

**Steps:**
- Read Microsoft's documentation for Microsoft-Decision-1 (Microsoft Learn, and the model card at `ai.azure.com/catalog/models/Microsoft-Decision-1`). Record the request body for a `choice` question, the auth header and the response fields. If no primary page gives the request body, ask the operator to paste the code sample from the deployment's page in the Foundry portal. If neither exists, stop and report: nothing later can be written.
- Ask the operator for consent: at most 8 requests, using synthetic content only, under $0.001.
- Write a scratch probe script in the session scratchpad. It uses `fetch`, reads `SYSTEMONE_ENDPOINT`, `SYSTEMONE_DEPLOYMENT`, `SYSTEMONE_DEPLOYMENT_TYPE` and `SYSTEMONE_API_KEY` from the environment, and never prints the key. It sends, in order:
  1. a `choice` question with 3 options over the state "The sky is blue on a clear day.", using the documented header;
  2. only if request 1 returns 401 or 403, the same request with the other header (`api-key` or `Authorization: Bearer`);
  3. a `choice` question with 100 options named `o001` to `o100`, with rubrics "Option 1" to "Option 100";
  4. request 1 with the key replaced by `invalid`;
  5. request 1 with `model` set to `no-such-deployment`.
- Write the fixture with these fields:
  - `provenance`: the endpoint, deployment and deployment type used; the documentation read, with URLs and the date; the header that worked, as `authHeader`; the capture date; each request's dispatch time; and `dropped` (the key, and any response header except a request ID).
  - `probeSource`: the script text.
  - `requests`: each request's body.
  - `responses`: each response's status and parsed body.
- Stop and report, building nothing further, if any of these is true: no header is accepted; request 3 is refused for its option count; or a `choice` answer carries no probability for each option. The D6 gate and the Brier score need P(answer) and P(`none`).
- Verify: `node -e "const f=JSON.parse(require('fs').readFileSync('test/fixtures/recorded/systemone-probe-snitch-resource.json','utf8'));console.log(f.provenance.authHeader,f.responses.map(r=>r.status).join(','))"`
- Expected: the working header, then the statuses in request order, with 2xx for requests 1 (or 2) and 3, and non-2xx for the invalid-key and wrong-deployment requests.

**Task completion evidence:** the fixture, the statuses, and the request count and any usage the responses report.

### Task 3: Configuration and key reading

**Depends on:** Task 2

**Files:**
- Create: `src/systemone.ts`
- Create: `test/systemone.test.ts`

**Steps:**
- Export `DEPLOYMENT_TYPES = ["GlobalStandard", "DataZoneStandard"] as const` and `interface SystemOneConfig { endpoint: string; deployment: string; deploymentType: (typeof DEPLOYMENT_TYPES)[number] }`.
- Export `readSystemOneConfig(env: Record<string, string | undefined>)`. It returns `{ ok: true; value: SystemOneConfig }` or `{ ok: false; reason: string }`, the shape `validateSpecDoc` uses. Refusals, in order:
  - each of `SYSTEMONE_ENDPOINT`, `SYSTEMONE_DEPLOYMENT` and `SYSTEMONE_DEPLOYMENT_TYPE` that is unset or blank: "<NAME> is not set";
  - an endpoint that `new URL` rejects, or whose protocol is not `https:`: "SYSTEMONE_ENDPOINT must be an absolute https URL";
  - a deployment type outside `DEPLOYMENT_TYPES`: "SYSTEMONE_DEPLOYMENT_TYPE must be GlobalStandard or DataZoneStandard".
- Export `readSystemOneKey(env)`, returning `{ ok: true; value }` or `{ ok: false; reason: "SYSTEMONE_API_KEY is not set" }`. No reason contains a variable's value.
- A header comment names this plan and the proposal. It says the variables are read once by the caller and are not yet frozen into a run profile (Assumptions), and that the type is the operator's declaration, never sent.
- Tests: each refusal with its exact reason; `http://` refused; a valid environment returns the three values; a refusal for a missing key does not contain a key value supplied under another name.
- Break it: remove the protocol check. The `http://` test must fail. Restore by reversing the edit.
- Verify: `node --test --test-reporter=tap test/systemone.test.ts`
- Expected: all pass, and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 4: One request, validated, failing closed

**Depends on:** Task 3

**Files:**
- Modify: `src/systemone.ts`
- Modify: `src/policy.ts` — `SYSTEMONE_REQUEST_TIMEOUT_MS = 120_000`, with a doc comment: the per-request wall clock for a Decision-1 call; not frozen, because no run calls it yet.
- Modify: `test/systemone.test.ts`

**Steps:**
- Read `src/policy.ts` to the end before editing.
- Export the `choice` question and request types, with the field names exactly as recorded in Task 2's `requests`.
- Export `validateSystemOneResponse(value: unknown, questions, config)`, returning `string[]` problems. The checks:
  - the answer keys equal the question keys;
  - each answer's selected option is one of its question's options;
  - the probabilities cover exactly that question's options, each is in [0, 1], and they sum to 1 within 1e-6. The tolerance is widened only to the rounding Task 2's recorded probabilities show, with a comment citing the fixture;
  - any model or deployment field the recorded response carries equals `config.deployment`, or the recorded model name if that is what the field holds.
- Export `askSystemOne(config, key, request, timeoutMs = SYSTEMONE_REQUEST_TIMEOUT_MS)`. It makes one `fetch` POST to `config.endpoint` with the header from `provenance.authHeader` and a body of `model: config.deployment` plus the request, in the recorded field names, with `signal: AbortSignal.timeout(timeoutMs)`. It returns either `{ ok: true; status; body; problems: [] }`, or `{ ok: false; status: number | null; reason: string; body: string | null }`:
  - a non-2xx status is `HTTP <status>`;
  - a timeout is "timed out after <ms> ms";
  - any other fetch error gives its error name and message;
  - a body that is not JSON, or that fails validation, gives its problems.
  
  There is no retry, and no reason or problem contains the key.
- Tests: a loopback `node:http` server on `127.0.0.1:0` replays Task 2's recorded statuses and bodies. The test builds the config directly with an `http://127.0.0.1:<port>` endpoint, because the https rule belongs to `readSystemOneConfig` and is tested in Task 3. Cases:
  - the success body gives `ok: true`, and the server saw the recorded header and `model` equal to the configured deployment;
  - the recorded 401 and wrong-deployment responses give `ok: false` with their statuses;
  - a server that destroys the socket gives a fetch error;
  - a server that never answers, with `timeoutMs = 200`, gives "timed out after 200 ms";
  - the key `k-test-secret` appears in no reason;
  - each mutation of the recorded success body gives a problem: an answer key removed; an unknown answer key added; the selected option renamed; the probabilities halved; the model field changed.
- Break it, restoring each by reversing the edit: (1) skip the probability-sum check, and the halved test must fail; (2) drop the `signal`, and the timeout test must fail.
- Verify: `node --test --test-reporter=tap test/systemone.test.ts test/policy.test.ts`
- Expected: all pass, and both breaks fail.

**Task completion evidence:** TAP counts and both break-it outcomes.

### Task 5: The D6 builder, scorer and evaluation script

**Depends on:** Task 4

**Files:**
- Create: `scripts/systemone-d6-evaluation.ts`
- Modify: `tsconfig.json` — `"include": ["src", "test", "scripts"]`.
- Create: `test/systemone-d6-evaluation.test.ts`

**Steps:**
- Export from the script:
  - `specClauses(spec)` → `{ name, line, text }[]`, by the rule under Assumptions;
  - `loadCases()` → 26 cases `{ findingId, location, reports: { reviewer, severity, subject }[], label: "keep" | "reject" | "either", baselines: string[] }`. It reads the three fixtures through `import.meta.dirname`, takes the replay set's 13 findings from `code-review-crew-chatter-run-6.json` (`round === 1`), parses its labels from the `reconcilerSource` comment (the `// Labels` line joined with the `// ` continuation line after it), and applies any Task 1 overrides. `BASELINES = { 200: ["L047", "L049"], 905: ["L047"] }`, with a comment quoting each provenance;
  - `QUESTION_TEXT` and `NONE_RUBRIC`, exactly as in "The D6 question";
  - `buildD6Request(spec, finding)` → `{ request, questionHash, stateHash }`, where `questionHash = sha256Hex(JSON.stringify(question))` and `stateHash = sha256Hex(state)`;
  - `PLAN = ` the 26 cases in fixture order, then #905 nine more times, labelled `case-<id>` and `repeat-905-<n>`;
  - `scoreD6(answers, cases, T)`. For each case it reports the chosen option, P(chosen), P(`none`), withheld, and one verdict: `correct-withhold`, `wrong-clause`, `missed`, `wrong-rejection`, `kept`, `either-withheld` or `either-kept`. It also returns the four rule clauses, the pass flag, and the Brier score;
  - `haikuBaseline()`. It counts, from the recorded decisions and `verdict` fields of both reconciler fixtures, each single call's wrong rejections and missed rejections. It also gives each set's `agreedRejections` per pair (1,2) … (9,10), with decisions from `validateReconcilerReply` over the pinned specification and plan.
- `main()` runs only when `import.meta.url === pathToFileURL(process.argv[1]).href`:
  - It reads the config through `readSystemOneConfig(process.env)` and prints the three values.
  - `--dry-run` sends nothing and needs no key. It prints the request count, the clause count and the largest request body in characters.
  - `--out <dir>` reads the key, then sends the `PLAN` entries in order through `askSystemOne`. It skips any entry whose `<dir>/<label>.json` exists, and writes each result there as `{ status, body, at }`. On the first `ok: false` it prints the label, status and reason, and exits 1.
  - When all 35 results exist, it scores them at T and at the informational thresholds, and writes `test/fixtures/recorded/systemone-d6-evaluation-crew-chatter-run-6.json`. It refuses to overwrite an existing file.
  - The fixture's fields:
    - `provenance`: the config used; any model or version reported; the capture date; the dispatch time per request; the request count; usage and cost where reported, otherwise an estimate marked as one; the operator's consent date; and `dropped` (request bodies, reproducible by hash; the key; response headers).
    - `adoptionRule`: the rule and T, verbatim from Task 1.
    - `labelsConfirmed`: the date.
    - `requests`: label, finding, `questionHash` and `stateHash` per request.
    - `responses`: status and body per request.
    - `score`: the verdict at T and the informational results.
    - `haiku`: the Haiku baseline.
- Tests, with expected values taken from the fixtures and the adoption rule, never from the script:
  - For every criterion in `validateSpecDoc(spec)`'s criteria, exactly one clause starts with `<id>: `. (An AC ID can also appear inside other clauses: `AC-013` recurs under `## Out of scope`.)
  - No clause is a path listed under `## Declared artifacts`.
  - `L047`'s text contains "Sign-out clears the cookie." (set 5b's provenance), and `L049`'s text equals the excerpt the replay provenance says all 10 calls quoted.
  - The clause count plus one is no more than the 100 options Task 2 showed accepted.
  - `loadCases()` returns 26 cases. The replay labels parsed from `reconcilerSource` match the ids in the provenance `labels` sentence. The counts are 2 reject, 17 keep and 7 either.
  - `buildD6Request` puts every clause and `none` in the options, and its body contains no key.
  - `scoreD6` applies the adoption rule: a reject-labelled case answered with its baseline at P = T is `correct-withhold`; at P just under T it is `missed`; answered with another clause it is `wrong-clause`; a keep-labelled case withheld fails clause 3; disagreeing repeats fail clause 2.
  - `haikuBaseline()` matches the fixtures' recorded verdicts: set 5b's `wrongRejects` [906] in 5b-3, and `missedRejects` [905] in 5b-1, 5b-6 and 5b-9.
- Break it, restoring each by reversing the edit: (1) keep the `## Declared artifacts` lines, and the path test must fail; (2) score `wrong-clause` as `correct-withhold`, and its test must fail.
- Verify: `node --test --test-reporter=tap test/systemone-d6-evaluation.test.ts`, then `npm run typecheck`, then, with the three variables set, `node scripts/systemone-d6-evaluation.ts --dry-run`.
- Expected: all pass, both breaks fail, the typecheck is clean, and the dry run prints 35 requests and sends nothing.

**Task completion evidence:** TAP counts, both break-it outcomes, and the dry-run output.

### Task 6: Run the evaluation and pin its result (paid)

**Depends on:** Task 5

**Files:**
- Create: `test/fixtures/recorded/systemone-d6-evaluation-crew-chatter-run-6.json` (written by the script)
- Create: `test/systemone-d6-evidence.test.ts`

**Steps:**
- Ask the operator for consent: 35 requests to the configured deployment, with an estimate of about $0.012 and no automatic retry. Stop if it is refused.
- Run `node scripts/systemone-d6-evaluation.ts --out <scratchpad>/d6`. If it stops, report the label, status and reason, and resume only with the operator's word.
- The evidence test reads only the committed fixture:
  - Each recorded request's `questionHash` and `stateHash` equal `buildD6Request` over the pinned specification and that request's case.
  - Every 2xx response passes `validateSystemOneResponse`, with the fixture's recorded config.
  - `scoreD6` over the recorded responses, at the recorded T, reproduces the recorded `score`.
  - `provenance` names the endpoint, deployment, deployment type, capture date, consent date and `dropped`.
- Break it: copy the fixture to the scratchpad, change one recorded probability in the working-tree fixture, and run the test. The validation or score test must fail. Copy the saved fixture back and confirm its SHA-256 matches the copy.
- Verify: `node --test --test-reporter=tap test/systemone-d6-evidence.test.ts`
- Expected: all pass, the break fails, and the restored fixture's hash matches.

**Task completion evidence:** the verdict, each rule clause's result, the request count and cost, TAP counts, and the break-it outcome.

### Task 7: Documents

**Depends on:** Task 6

**Files:**
- Modify: `docs/proposals/decision-1-review.md`
- Modify: `.claude/sessions/project-learnings.md`
- Modify: `docs/features/decision-1-d6-evaluation/plan.md` — `**Status:**` and an implementation note.

**Steps:**
- Proposal: grep for "not confirmed", "unconfirmed", "to be confirmed" and "not stated". Replace each statement that Task 2 or Task 6 settled with the recorded fact and its fixture path: the auth header, the response fields, per-option probabilities, the option cap, whether a model version is reported, and determinism on one case. Add an "Evaluation record" section with the D6 verdict, each rule clause's result, the Haiku comparison, its caveat (different inputs, two reject cases), and both fixture paths. Leave the unsettled statements as they are.
- Learnings: Current state names this plan, its status and the verdict. The next decision is the operator's: adopt D6 in a new plan, or not.
- Plan: `**Status:** Implemented`, with an implementation note: verification, deviations, deferred items.
- Verify: `npm run check:docs`
- Expected: `doc-check: clean`, apart from standing warnings.

**Task completion evidence:** the checker output.

### Task 8: Full verification

**Depends on:** Tasks 1-7

**Steps:**
- `npm run typecheck`. Expected: no errors.
- Record `git log -1 --format=%H` before and after the full serial suite, with TAP output going to a scratch file: `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts > <scratch>/suite.tap`. Expected: 0 fail, and the same HEAD before and after. If `test/cli-operator.test.ts`'s PowerShell transport test fails from the tool shell, ask the operator to rerun it in their terminal before diagnosing it.
- `npm run check:docs`. Expected: clean, apart from standing warnings.

**Task completion evidence:** typecheck output, TAP summary counts and the two HEADs.

## Open decisions

1. **Adopting D6.** A passing verdict makes D6 eligible. It does not adopt it. Adoption needs a new plan: freeze the three variables at `new-run`, add the section 11 amendment, add the decision store table, choose `doctor`'s probe, and replace the two Haiku reconciler calls.
2. **A second project's cases.** Every case here comes from crew-chatter run 6 (test 5's provenance: "neither tests a second project"). With two reject-labelled cases, a pass is thin evidence. More labelled cases are a separate decision.

## Implementation note (2026-10-16)

All eight tasks are done, uncommitted, on branch `dashboard-restyling` at HEAD `0e3277e`.

**Verdict: D6 fails** the confirmed rule at T = 0.8. The evaluation sent 35 requests, cost $0.0117 (278,580 input tokens), and every response named `microsoft-decision-1`. The full record is in `docs/proposals/decision-1-review.md`, "Evaluation record". In short:
- validity passed;
- no wrong rejections passed: no keep-labelled finding was withheld at any threshold;
- correct rejections failed: #200 chose `none`, tied with `L048` at 0.4659, and #905 chose `L048` at 0.895 instead of `L047`;
- determinism failed: all ten #905 answers chose `L048`, with probabilities from 0.687 to 0.922.

Open decision 1 does not arise. Nothing was relabelled after the answers were seen.

**Spend.** The probe reached the resource 5 times across two runs, within the consented 8. The first run's stored key was malformed, so its three requests using it failed inside `fetch` before sending, and only its invalid-key request arrived. The evaluation sent exactly 35 requests under its own consent.

**Verification.**
- `npm run typecheck` is clean, including the new `scripts` include.
- `npm run check:docs` is clean apart from standing warnings.
- The full serial suite ran 1,590 tests: 1,584 passed, 1 failed and 5 were skipped. HEAD was `0e3277e` before and after.
- The failure is `Task 7 external Windows PowerShell transport signs original BOM CRLF input and submits a signature file` in `test/cli-operator.test.ts`. That test is known to fail from the assistant's shell and pass in the operator's terminal. It is unconfirmed until the operator reruns it there.
- Every break-it named in Tasks 3 to 6 failed its target test, and each mutated file was restored to the copied bytes (SHA-256 compared).

**Deviations.**
- The response's `model` names the underlying model, not the deployment (Microsoft Learn and the probe). So `validateSystemOneResponse` requires a non-empty model rather than comparing it with `config.deployment`. The script records the set of reported models (`modelsReported`), and the evidence test checks it.
- `readSystemOneKey` also refuses a key containing anything but printable ASCII. The probe's first run showed that such a key makes `fetch` fail locally with only "fetch failed".
- An unknown deployment returns 404 `DeploymentNotFound`, not the 422 the documentation lists. The tests replay the recorded 404.
- The request schema came from a primary source: Microsoft Learn's page for the model was found and read before the probe.
- `askSystemOne` also returns the response's request-ID headers, and its reasons scrub the key. A test server that echoes the key proves it.
- The script takes the consent text through a required `--consent` argument and records it in the fixture's provenance.
- The evidence test validates against the rebuilt request alone. The validator takes no config after the `model` deviation above.
- 2026-10-17, operator decision: Task 3's `DEPLOYMENT_TYPES` allowlist is removed. There will be many Decision-1 endpoints and the resource may move, so no vendor-specific value is hard-coded. `readSystemOneConfig` records `SYSTEMONE_DEPLOYMENT_TYPE` as given, and only an unset or blank value is refused. The refusal test became an acceptance test, and reinstating the allowlist fails it.

**Deferred.** None of this is committed. The operator's plain-text key file (`C:\Users\tamezs\.buildworks\[Environment]SetEnvironmentVariable.txt`) still holds the key; removing it is the operator's call.
