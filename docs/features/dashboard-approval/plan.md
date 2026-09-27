# Dashboard Approval Implementation Plan

**Status:** Implemented

**Goal:** An operator who opens a run waiting for approval in the dashboard sees
that approval is needed, reads the exact specification being approved, and
either approves it in the browser with their own key or copies a complete
terminal fallback, without any assistant explaining the steps.

**Source:** Operator request and authorization, 2026-09-26 (note-keeper run 5
paused at `awaiting_approval`; the badge was the only signal, with no way to
see the spec or approve). Part 1 is the read-only approval handoff; Part 2 is
in-browser approval where the browser signs and the host records the result
through the same core as `bw approve`. Operator: "lets do both Part 1 and Part 2".

**Hazards considered:** 4 (fixtures and code agreeing while both are wrong):
every expected payload and signature comes from the core itself —
`approvalPayload(buildBinding(...))` and `verifyApproval` from
`src/approval.ts` — and Ed25519 signatures are deterministic, so the
browser-path signature must equal Node's `sign()` over the same bytes. New
guards are break-tested. 14 (independence that cannot be proven) and 15 (a
declared sandbox does not contain a subprocess): these bear on where the
private key may live. Architecture section 17 already says a key under the
operator's user profile is reachable by verification commands. This plan never
moves a key into the BuildWorks host: the browser reads it only when the
operator picks it and sends only the signature. It does not fix the existing
key location; the help text says so. 1–3, 5–13, 16–18: not applicable — they
concern model output, delivery, staging and review loops, none of which this
change touches.

**Assumptions:**
- Current Chrome and Edge implement Ed25519 in WebCrypto `importKey("pkcs8")`
  and `sign`. This is not verified on the operator's browser; Task 6 detects
  it and falls back to the terminal commands when unsupported.
- The operator's key is the unencrypted PKCS#8 PEM that
  `scripts/sign-approval.mjs keygen` writes (verified:
  `privateKey.export({ format: "pem", type: "pkcs8" })`). Encrypted PEM is
  refused by name, not supported.

**Approach:**
1. Record an architecture decision that narrows hard rule 2 for exactly one
   action: the dashboard may accept a detached signature and record approval
   through `approveRun` under the repository writer lock.
2. Add one host module that reads the approval request read-only (payload,
   spec text, key facts) and submits a signature under the writer lock with
   the CLI's exact sequence.
3. Add two routes: `GET` and `POST` on `/api/repositories/<id>/runs/<n>/approval`.
4. Add pure model helpers: WebCrypto signing, the fallback script text, and an
   approval entry in the attention queue.
5. Add the UI: a banner in the run view, an approval drawer with the spec, key
   help and an Approve button, and an overview attention item.

Command parity is structural: both surfaces call the same `acquireLock` →
`openStore` → `approveRun` sequence, and a test compares the audit trail each
surface produces.

**Affected areas:** architecture decision record; dashboard HTTP host; one new
host module; dashboard model, renderer and styles; README operator guide;
dashboard tests.

**Known blockers:**
- Hard rule 2 and the 2026-09-12 dashboard authorization forbid the dashboard
  to "accept signatures" or "open a writer" (`ARCHITECTURE.md` sections 3 and
  23). Task 1 must land before any Part 2 code; the operator authorized it on
  2026-09-26.
- Hard rule 2 requires a replacement decision to "define command parity and
  retire or narrow the CLI mutation path". This plan narrows the dashboard's
  write to one action on the shared core and keeps `bw approve`, because
  guided and headless operation need it. The decision text must state that
  choice.
- The approval-request route must stay read-only. `buildBinding` already runs
  on a read-only store inside the status projection (`src/operator-state.ts`,
  the `action.group === "approval"` branch), which is the precedent.
- Existing guards pin the read-only surface. The `app.js` and model guards sit
  inside test #26, which fails on an earlier assertion, so today they never
  execute. Task 6 moves them into their own test before narrowing them to the
  one allowed path. None is deleted:
  - `test/dashboard-server.test.ts` expects `POST /api/repositories` → 405;
  - `test/dashboard-ui.test.ts` refuses any `fetch(..., { method: ... })` in
    `app.js` and any `fetch`, `window.` or `document.` in the model.
- Five structure-pinning tests in `test/dashboard-ui.test.ts` (numbers 26 and
  29–32) already fail at HEAD from the PWA redesign. They are the baseline,
  not this plan's regressions (`.claude/sessions/project-learnings.md`,
  Active work).

**Blast radius:**
- `startDashboardServer`: called by `src/cli.ts` (dashboard command) and three
  tests in `test/dashboard-server.test.ts`.
- `approveRun`: called by `src/cli.ts` (`approve`) and
  `src/guided-command.ts`; the new module adds a third caller.
- `buildBinding`: called by `src/cli.ts`, `src/operator-state.ts` and
  `src/guided-command.ts`; the new module adds a read-only caller.
- `needsAttentionQueue`: called by `src/dashboard/app.js`
  (`renderNeedsAttention`) and asserted in `test/dashboard-ui.test.ts`, whose
  empty-queue `deepEqual` assertions change shape.
- Integration boundaries: the HTTP host's method and route contract, and the
  audit chain, whose events come only from `approveRun`, unchanged.
- No schema, migration, run-state or `RunSnapshot` change.

**Verification:**
- `npm run typecheck` and `npm run check:docs`.
- `node --test --test-reporter=tap test/dashboard-server.test.ts test/dashboard-ui.test.ts test/approval-stage.test.ts`:
  new tests pass, and the only failures are the recorded baseline.
- A break test for every new guard.
- A manual browser check against a scratch run parked at approval, never a
  paid run.

---

## Scope

In scope: everything in Tasks 1–7.

Out of scope, each named so its absence is a decision and not an oversight:
- **Deny or reject.** No reject lifecycle action exists in the core; a run
  that is not approved stays at the boundary until its window expires.
- **Resuming the run from the dashboard.** `bw run --yes` collects consent to
  spend and stays a terminal action. The drawer shows the resume command
  after approving.
- **Storing, remembering or generating keys.** No `localStorage`, no key
  upload to the host, no keygen in the UI.
- **Moving the operator's existing key.** Section 17's location limitation is
  unchanged.
- **Rendered Markdown.** The spec is shown as preformatted text; the CSP and
  the "no markup parsed from a projected value" guard stay intact.
- **A new audit event naming the surface.** `approval.granted` keeps its exact
  summary, which `src/operator-state.ts` validates by string.

## Tasks

### Task 1: Record the approval decision in the architecture

Depends on: none.

Files:
- Modify: `ARCHITECTURE.md` — section 3 hard rule 2; section 17; section 23,
  a new decision after "Guided bootstrap authorization — 2026-09-13".
- Modify: `README.md` — the "Launch the read-only dashboard" section and the
  "strictly read-only and loopback-only … creates no mutations" paragraph.
- Modify: `CLAUDE.md` and `AGENTS.md` — hard rule 2 in "The architecture is
  binding". Edit `CLAUDE.md`, copy it to `AGENTS.md`, and compare hashes; the
  two must stay byte-identical.
- Check: `docs/runbooks/cli-operator.md`. Run
  `rg -n -i "read-only" README.md docs/runbooks/cli-operator.md CLAUDE.md` and
  correct any current-tier sentence that says the dashboard never writes.

Steps:
- Hard rule 2: after "Interactive dashboard mutation requires a later
  decision…", add one sentence. The 2026-09-26 decision in section 23 permits
  exactly one dashboard write, approval submission, through the same core
  function and writer lock as `bw approve`. Every other mutation remains
  CLI-only.
- Section 23: add **Dashboard approval — 2026-09-26.** State each of these:
  - The operator authorized it.
  - The host serves the canonical payload and the reviewed spec read-only.
  - The operator's browser signs with a key the operator selects. The key is
    never sent to, stored by, or readable by the host.
  - The host accepts only `{expiresAt, signature}` and records approval
    through `approveRun` under `acquireLock`, with the CLI's exact
    sequence.
  - Command parity is structural: one function, one lock, one audit trail.
  - `bw approve` is kept because guided and headless operation need it.
  - This narrows the 2026-09-12 clause "never … accepts signatures, opens a
    writer" for this one action only.
  - It does not authorize consent collection, run resumption, rejection, key
    storage, a signing service, or any other write.
  - Why: an operator paused at approval had no way to see or act on it
    without assistance.
- Section 17: after the file-signer paragraph, add that browser signing is
  the operator's own authority acting in the browser. BuildWorks never
  receives the key. Keeping the key file under the same user profile that
  verification commands run as is still the limitation this section already
  describes.
- README: add a short "Approving from the dashboard" subsection covering:
  - what the banner means;
  - where `approval.key` came from (`node scripts/sign-approval.mjs keygen`);
  - that the key never leaves the browser;
  - that resuming stays a terminal command.

  Keep the word "read-only" accurate by saying the dashboard is read-only
  except for approval.
- Do not add backticked lowercase tokens to section 5; `doc-check` reads its
  deferred list from them.
- `CLAUDE.md` hard rule 2 gets the same one-sentence exception, pointing to
  the 2026-09-26 decision.
- Verify: `npm run check:docs` → exit 0; `npm run typecheck` → clean;
  `CLAUDE.md` and `AGENTS.md` hashes are equal.

Completion evidence: the checker is clean, the instruction files are
identical, and the new decision text names the single action, the parity
mechanism and the exclusions.

### Task 2: Host module for the approval request and submission

Depends on: Task 1.

Files:
- Create: `src/dashboard-approval.ts`.
- Validate: `test/dashboard-server.test.ts` (Task 4).

Steps:
- `readApprovalRequest(repositoryPath: string, runId: number, now = Date.now())`:
  - Open `openStore(repositoryPath, { readOnly: true })` in `try`/`finally`
    with `close()`, the same way `src/operator-read.ts` does.
  - Compute `expiresAt = new Date(now + APPROVAL_DEFAULT_LIFETIME_SECONDS * 1000).toISOString()`.
  - Call `buildBinding(store, repositoryPath, runId, expiresAt)`.
  - On refusal, return `{ outcome: "refused", reason }`.
  - On success, read `bound.specPath` (resolved against the repository, as
    `buildBinding` does) and compare `sha256Hex(normalizeText(text))` with
    `bound.binding.specHash`. A mismatch, from a spec edited between the
    two reads, refuses with `the spec changed while it was being read`.
  - Call `loadPublicKey(repositoryPath)` for the key facts.
  - Return:
    - `outcome: "ok"`;
    - `expiresAt`;
    - `payload: approvalPayload(bound.binding)`;
    - `specPath`, `specText`, `specHash`, `featureId`, `risk`, `scope`;
    - `signer`: `{ frozen: bound.approvalSigner, configured: key.ok ? key.signer : null, publicKeyPath: key.ok ? key.path : null, reason: key.ok ? null : key.reason }`.

  None of these values is secret (section 17).
- `submitApproval(repositoryPath, input: { runId, expiresAt, signature })`:
  - Call `acquireLock(repositoryPath)` inside `try`.
  - If it throws, return `{ outcome: "writer_busy", reason: error.message }`
    without opening the store.
  - Otherwise open `openStore(repositoryPath)`, call `approveRun`, then close
    the store and call `release()` in `finally`, in that order. This is the
    order `src/cli.ts` uses.
  - Map `approveRun`'s result to `{ outcome: "approved", approvalId, stageId }`
    or `{ outcome: "refused", reason }`.
  - Add no other validation. Expiry, binding, signer and signature checks all
    belong to `approveRun`.
- Verify: `npm run typecheck` → clean.

Completion evidence: the module compiles and contains no approval policy of
its own. A reviewer can see that every refusal comes from `buildBinding` or
`approveRun`.

### Task 3: Routes on the dashboard host

Depends on: Task 2.

Files:
- Modify: `src/dashboard-server.ts` — `handler`.

Steps:
- Keep the Host and Origin-mismatch checks first, exactly as today.
- Then parse `url` (today this happens after the method check; move it up),
  and replace the single `method !== "GET"` check with a path-aware one:
  - for `^/api/repositories/([A-Za-z0-9_-]+)/runs/(\d+)/approval$`, allow
    `GET` and `POST`, and answer anything else with 405 and
    `Allow: GET, POST`;
  - for every other path, keep `method !== "GET"` → 405 with `Allow: GET`
    exactly.
- The asset lookup, the `/api/` prefix check and the bearer check then run
  unchanged, so the approval routes are authenticated before any body is
  read.
- `POST` preconditions, in this order:
  1. An `Origin` header is present and equals `origin`; otherwise 400
     `invalid_origin`. A browser always sends it on `fetch` POST.
  2. `Content-Type` starts with `application/json`; otherwise 415
     `unsupported_media_type`.
  3. The body is at most 8192 bytes, read with a running byte count. The
     request is destroyed at the limit with 413 `payload_too_large`.
  4. The body parses as an object whose `expiresAt` and `signature` are both
     strings; otherwise 400 `invalid_body`.
- The route is async only for the body read. Wrap it so thrown errors still
  reach the existing 500 path.
- Unknown repository → 404 `repository_not_found`. A malformed run → 404
  `run_not_found`, as today.
- `GET` → 200 with `readApprovalRequest`'s result. A refusal is still 200
  with `outcome: "refused"`, matching how the status route returns refusals
  in its envelope.
- `POST` responses:

  | Outcome from `submitApproval` | Status |
  | --- | --- |
  | `approved` | 200 |
  | `refused` | 422 |
  | `writer_busy` | 409 |

  The body is the result object. Never echo the signature.
- In `test/dashboard-server.test.ts`, the existing
  `POST /api/repositories → 405` assertion stays as written.
- Verify: `npm run typecheck` → clean.

Completion evidence: the only non-GET path in the host is the approval path,
visible in one place in `handler`.

### Task 4: Host tests, including parity with the CLI path

Depends on: Task 3.

Files:
- Modify: `test/dashboard-server.test.ts`.

Steps:
- Add a fixture that parks a run at the approval boundary. Copy the shape of
  `withFixture` in `test/approval-stage.test.ts` (git repository, spec, passed
  `spec` and `spec_review` stages, `spec.gate.pass` event, key generated and
  `BW_APPROVAL_PUBLIC_KEY` set **before** `freezeProfile`). Keep its comment
  on why the ordering is load-bearing. Restore the environment variable in
  `finally`.
- Tests:
  - `GET` returns `payload === approvalPayload(buildBinding(...).binding)`
    for the same `expiresAt`, computed by the core in the test.
  - `GET` returns `specText` equal to the spec file and
    `signer.frozen === signer.configured`.
  - `GET` leaves the repository's files byte-identical. Use the existing
    `filesystemInventory` helper before and after.
  - `POST` with `sign(null, Buffer.from(payload), privateKey)` gives 200. It
    must also create:
    - an `approval` row;
    - a passed `awaiting_approval` stage;
    - an `approval.granted` event;
    - a valid audit chain (`verifyAuditChain` returns null).
  - **Parity:** build a second fixture and approve it with
    `approveRun(store, root, …)` directly, as `bw approve` does. Assert both
    fixtures record the same ordered audit `action` list and the same
    approval-row columns, excluding ids, timestamps and signatures.
  - `POST` with a signature from another key gives 422, one
    `approval.refused` event, and no approval row. Refusal accounting belongs
    to the core.
  - A `POST` whose `expiresAt` differs from the one the payload was signed
    over gives 422. The signature no longer verifies.
  - `POST` while the test holds `acquireLock(root)` gives 409, with no audit
    event and no approval row.
  - After a successful `POST`, `acquireLock(root)` in the test succeeds and
    `inspectLock(root).status` was `absent` beforehand. The host released
    the lock.
  - Transport refusals:

    | Request | Status |
    | --- | --- |
    | no `Origin` | 400 |
    | foreign `Origin` | 400 |
    | wrong bearer | 401 |
    | `text/plain` body | 415 |
    | 9000-byte body | 413 |
    | `{ "signature": 1 }` | 400 |
    | `PUT` on the approval path | 405 with `Allow: GET, POST` |
    | `POST` on `/api/repositories/<id>/runs/<n>` | 405 |
- Break tests, each run against a mirror or restored by hash as recorded in
  project learnings:
  - drop the `Origin` requirement → the no-`Origin` test fails;
  - remove `release()` from `submitApproval`'s `finally` → the lock-released
    test fails;
  - make `submitApproval` skip `acquireLock` → the 409 test fails.
- Verify: `node --test --test-reporter=tap test/dashboard-server.test.ts` →
  new tests `ok`, and the recorded baseline failure (#3) is unchanged.

Completion evidence: TAP output and the break-test log.

### Task 5: Model helpers for signing, the fallback script and the attention queue

Depends on: Task 3, for the response shape.

Files:
- Modify: `src/dashboard/dashboard-model.js`.
- Modify: `test/dashboard-ui.test.ts`.

Steps:
- `privateKeyDer(pem)` accepts only a single
  `-----BEGIN PRIVATE KEY-----` block and returns its bytes via
  `globalThis.atob`. It returns `{ ok: false, reason }` with a reason naming
  the problem for each of these:
  - `ENCRYPTED PRIVATE KEY`: "encrypted keys are not supported; use the
    unencrypted approval.key keygen wrote";
  - a `PUBLIC KEY` block: "this is the public key; choose approval.key";
  - anything else.
- `async signApprovalPayload(pem, payload, subtle = globalThis.crypto.subtle)`
  runs:
  1. `importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"])`;
  2. `sign({ name: "Ed25519" }, key, new TextEncoder().encode(payload))`;
  3. returns `{ ok: true, signature }`, base64 via `btoa`.

  An import failure returns `{ ok: false, reason }`, naming either
  unsupported Ed25519 or a key that is not Ed25519. The function never
  returns or logs the key.
- `approvalFallbackScript({ cliPath, repositoryPath, runId, expiresAt })`
  returns the PowerShell block the operator used on 2026-09-26:
  - it sets `$BwCli`, `$Signer`, `$Target`, `$RunId` and `$Expires`. `$Signer`
    is `cliPath`'s checkout `scripts\sign-approval.mjs`, derived by replacing
    the trailing `src\cli.ts`;
  - `$Key` is the one line the operator edits, labelled with a comment;
  - it creates a fresh `$env:TEMP` directory, then runs `approval-request
    --out`, the signer pipe and `approve`.

  The command lines reuse `commandText(cliPath, …, "win32")` where they
  invoke the CLI. The `$Var = '…'` assignments use PowerShell single-quote
  escaping (`'` → `''`), the same rule `commandText` applies on `win32`.
  Factor that one escape into a shared helper that `commandText` also calls,
  so there is still one quoting rule.
- `needsAttentionQueue` gains an `approvals` array. It has one entry per run
  whose summary `phase === "awaiting_approval"`, with `kind: "approval"`,
  `repositoryId`, `runId`, `slug`, `project` and `lastRecordedAt`. Update the
  JSDoc.
- Tests in `test/dashboard-ui.test.ts`:
  - `signApprovalPayload` with a Node-generated Ed25519 PKCS#8 PEM returns a
    signature that `verifyApproval` accepts. It must also equal
    `sign(null, bytes, privateKey).toString("base64")`, since Ed25519 is
    deterministic.
  - Public-key PEM, encrypted PEM and an RSA PKCS#8 PEM each return the named
    refusal.
  - `approvalFallbackScript` embeds the run id and expiry. Given a repository
    path containing a space and an apostrophe, `$Target` is assigned
    `'C:\repo with spaces\operator''s'`. That expected string follows
    PowerShell's documented single-quote rule, the same literal the existing
    `commandText` test pins.
  - `commandText`'s existing test still passes after the shared-escape
    refactor.
  - `needsAttentionQueue` returns an `approvals` entry for a real snapshot
    whose recorded phase is `awaiting_approval`. Build it through the store as
    the stage-ledger test does: passed `spec` and `spec_review`, each with an
    output ref.
  - The empty-queue `deepEqual` assertions become
    `{ runs: [], approvals: [], findings: [] }`.
  - The model still contains no `fetch(`, `window.` or `document.`. The
    existing guard stays and must still pass.
- Break tests:
  - sign the payload with a trailing `\n` → the `verifyApproval` assertion
    fails;
  - drop the `awaiting_approval` filter → the approvals assertion fails.
- Verify: `node --test --test-reporter=tap test/dashboard-ui.test.ts` → new
  tests `ok`, and the failures are only the recorded baseline five.

Completion evidence: TAP output and the break-test log.

### Task 6: Approval banner, drawer, Approve button and overview item

Depends on: Task 5.

Files:
- Modify: `src/dashboard/app.js`, `src/dashboard/styles.css`,
  `src/dashboard/index.html`.
- Modify: `test/dashboard-ui.test.ts`.

Steps:
- A new `fetchApproval(repositoryId, runId, token)` issues
  `GET …/approval` with the bearer header, like `fetchEnvelope`.
- A new `postApproval(repositoryId, runId, token, body)` is the **only**
  `fetch` with a `method` in `app.js`: `method: "POST"`,
  `Content-Type: application/json`, a bearer header, and
  `JSON.stringify({ expiresAt, signature })`.
- **Move the read-only boundary guards out of the failing test first.** The
  guards live in "static assets keep the approved accessible boundary…"
  (test #26), after its CSS token assertions: the `WebSocket`/`setInterval`/
  `innerHTML` ban, the `fetch` `method` ban, the model's
  `fetch`/`window.`/`document.` ban, the `JSON.stringify` ban and the style
  bans. #26 already fails at the baseline on an earlier assertion, so those
  guards never run.
  1. Move them unchanged into a new test, "the dashboard's only write is
     approval submission".
  2. Confirm the new test passes before any Task 6 code lands.
  3. Break-check one moved guard: add `innerHTML` → the new test fails; then
     restore.
  4. Then narrow two guards in the new test:
     - the `JSON.stringify` ban becomes "exactly one `JSON.stringify`, inside
       `postApproval`";
     - the method ban becomes "exactly one `fetch(...{ method: "POST" ...})`,
       inside `postApproval`".

     Scope both to the function body, sliced by name. Leave the remaining
     guards unchanged.
- Run view:
  - When `context.snapshot.phase === "awaiting_approval"`,
    `renderExecutiveSummary` inserts an `approval-banner` region above the KPI
    strip.
  - The heading is "Your approval is needed". One sentence names the feature
    and says the spec passed review.
  - Two buttons: **Review spec and approve**, which opens the drawer, and
    **Copy terminal commands**, which uses `copyControl` with
    `approvalFallbackScript`.
  - The expiry shows once the request loads, via `relativeNode`.
  - No auto-opening modal, because auto-refresh re-renders every 15 s.
- Drawer, opened with the existing `openDrawer`, titled "Approve
  specification". Its sections:
  1. **What you are approving:** feature, risk, scope count with a
     disclosure listing `scope`, and the spec hash via `identityNode`.
  2. **Specification:** the path, with `copyControl` for the path and for
     `specText`, and `specText` in a `pre` built with `textContent`.
  3. **Sign and approve:**
     - Help text naming where the key came from
       (`node scripts\sign-approval.mjs keygen --out <folder>` creates
       `approval.key`). It shows the trusted public key path and fingerprint
       from `signer`, and says the key is read only in this browser and never
       sent.
     - Advice to keep the key off this user profile, per section 17.
     - An `<input type="file" accept=".key,.pem">`, and an **Approve** button
       that stays disabled until a file is chosen.
     - On click:
       1. read the file with `File.text()`;
       2. call `signApprovalPayload`;
       3. drop the key text reference and reset the input;
       4. call `postApproval`.
     - Show the result in a `role="status"` element:
       - on success, "Approved" plus the resume command (`commandText` for
         `run --repo … --run N --yes`) with `copyControl`, then trigger the
         existing refresh;
       - on refusal, the core's reason verbatim;
       - on 409, "Another BuildWorks command is running in this repository;
         try again when it finishes".
  4. **Terminal alternative:** the same fallback script, for when signing is
     unsupported or the operator prefers the terminal.
- If `signer.frozen !== null && signer.configured !== signer.frozen`, or
  `signer.reason` is set, disable Approve and state the reason. The core would
  refuse anyway; this says why before the operator picks a key.
- Overview: `renderNeedsAttention` renders `queue.approvals` first, labelled
  "Approval needed". Selecting one routes to the run view, the same way run
  items do.
- `index.html` footer: "Read-only projection except approval · loopback only
  · other governed actions run as terminal commands". Keep "read-only" for
  the existing HTML assertion.
- Styles: `.approval-banner` uses the `warning` tone, the same state scale.
  The spec `pre` gets a bounded height with scrolling. Include a
  forced-colors border rule. No inline style from script.
- Tests (source-scan, matching the file's existing style):
  - `postApproval` is the only POST.
  - The approval drawer region contains no `localStorage` or
    `sessionStorage`.
  - `signApprovalPayload(` is called only in the drawer's Approve handler.
  - The POST body names only `expiresAt` and `signature`.
- Break test: add a second `fetch(..., { method: "POST" })` → the
  single-POST assertion fails.
- Verify: `npm run typecheck`, then
  `node --test --test-reporter=tap test/dashboard-ui.test.ts` → the recorded
  baseline five only.

Completion evidence: TAP output and the break-test log.

### Task 7: End-to-end check against a scratch run, no spend

Depends on: Task 6.

Steps:
- Write a scratch script in the session scratchpad, not the repository. It
  repeats the Task 4 fixture steps in a temporary git repository and a
  temporary key directory, then prints the repository path and the scratch
  public key path. It uses a scratch key pair, never the operator's key.
- Launch `node src/cli.ts dashboard --repositories-file <scratch file>` with
  `BW_APPROVAL_PUBLIC_KEY` set to the scratch public key. `loadPublicKey`
  reads that variable in the host process, and the fixture froze the same
  fingerprint.
- Confirm in Chrome:
  1. the banner appears;
  2. the drawer shows the spec and key facts;
  3. choosing the scratch `approval.key` and clicking Approve records the
     approval;
  4. the badge leaves AWAITING APPROVAL after the refresh;
  5. `bw status --run <n>` shows the approval granted and `verify-audit` says
     `chain valid`.
- Confirm refusals in the browser: choosing `approval.pub` shows the named
  refusal, and a second Approve click shows the core's "already has an
  awaiting_approval stage" refusal.
- If Chrome refuses Ed25519, record the browser version and confirm the
  drawer states it and shows the terminal alternative. That is a partial
  pass, reported as such, not a reason to add a polyfill.
- Update this plan's `**Status:**` to `Implemented` with a short
  implementation note.

Completion evidence: the observed browser steps, the status and verify-audit
output, and the plan status line.

## Implementation note — 2026-09-26

Tasks 1–7 shipped. Chrome automation was not connected, so the operator ran
Task 7's browser check by hand against the review-fixed build. They saw the
banner and the drawer. Choosing their own, non-scratch `approval.key` was
refused twice by the core ("approval signature does not verify against the
configured public key", audit events 2 and 3). Choosing the scratch
`approval.key` recorded the approval, and the run left AWAITING APPROVAL.

The Chrome check also exposed a usability gap: a wrong-but-valid key is
reported only after the POST, as the core's generic refusal. Comparing the
chosen key's public half with the trusted fingerprint in the browser would
name the problem first. That comparison is recorded here as a follow-up, not
built.

What ran in Task 7, against a scratch run and scratch key pair, with no
spend:
- The live scratch dashboard answered `GET` with `signer.frozen ===
  signer.configured`.
- The model's own `signApprovalPayload` (Node WebCrypto) refused
  `approval.pub` by name and signed with `approval.key`.
- The first `POST` returned 200 with `approvalId` 1. A second returned 422
  with the core's "already has an awaiting_approval stage".
- `status` then showed phase `ready` with approval `granted`, and
  `verify-audit` printed `chain valid`.

Deviations from the tasks above:
- `submitApproval` takes the lock, checks the schema read-only, then opens the
  writer. That is the guided command's sequence (`src/guided-command.ts`), so
  the dashboard can never migrate. `bw approve`'s plain `openStore` can.
- `shellQuote` was already shared, so no refactor. The fallback script
  assigns variables and invokes them, rather than using `commandText` lines.
- An over-limit body gets 413 and is drained, not destroyed.
- `renderNeedsAttention` does not exist. The approvals group went into
  `renderAttentionQueue`, the live Overview renderer.
- The banner shows the expiry as a local date ("Sign before …"), not
  `relativeNode`. `relativeTimePresentation` only renders past times.
- The 409 message shows the core's lock reason rather than a fixed sentence
  (review finding 3).

Deferred: none beyond the Scope section's exclusions.

## Independent review — 2026-09-26

**Status:** reconciled

The in-session independent review agent was the operator's choice;
`/code-review ultra` is deferred to before commit. It covered correctness,
security and UI state integrity, and reported no critical, high or medium
finding. It reported three low findings, recorded here as it gave them.

1. **Low: a second Approve can be sent while the first POST is still in
   flight** (`app.js`, approve handler). After signing, the handler
   re-enabled the file input before the POST settled. Re-picking the key and
   clicking again sent a second POST. The core refused it and logged an
   `approval.refused` event, and the refusal overwrote "Approved" in the UI.
   **Disposition: fixed.** The input stays disabled until the POST settles
   and is re-enabled only on a non-approved result.
2. **Low: the banner's cached approval request never refreshes.** An expiry
   past its time kept "Sign before <past>" on screen and put an expired
   `$Expires` in the copied script. A transient GET refusal also stuck.
   **Disposition: fixed.** `approvalSlotStale` treats a request whose expiry
   has passed, or a refusal older than one refresh interval, as stale. The
   banner force-reloads a stale slot, and an auto-refresh tick re-renders
   when any slot is stale. A persistent refusal is re-read at most once per
   interval.
3. **Low: every 409 shows "another command is running", whatever the lock
   reason.** `submitApproval` maps every `acquireLock` throw to
   `writer_busy`, including an unreadable lock file that needs manual
   removal. **Disposition: fixed in the UI.** The message now includes the
   core's reason verbatim. The host mapping is unchanged: every lock failure
   still means nothing was recorded.

The three fixes are UI behaviour in `app.js`. They pass typecheck and the
unchanged test files but have no unit test, because the dashboard's UI tests
are source scans. The browser check is where they get observed.

**Hazards considered:** 4 (fixtures and code agreeing): the review confirmed
that expected payloads and signatures come from `buildBinding`,
`approvalPayload` and Node `sign`, not invented values. 14 and 15 (unprovable
independence; a sandbox that does not contain a subprocess): these bear on
where the key lives. The key never reaches the host, and section 17's
limitation is unchanged. 1–3, 5–13, 16–18: not applicable. They concern model
output, dispatch, delivery, staging and review loops, which this change does
not touch.
