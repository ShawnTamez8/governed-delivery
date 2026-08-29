# Approval Gate Implementation Plan

**Status:** Implemented

**Goal:** Build order step 4: the `awaiting_approval` stage — freeze a run's profile at run start, compute the scope the operator signs from the spec's declared artifacts, and gate the run behind one Ed25519 authorization that binds feature ID, spec content hash, starting commit, profile hash, risk, expiry, and scope, verified deterministically against a public key held outside the repository.

**Source:** `ARCHITECTURE.md` sections 3 (hard rule 6, config frozen at run start), 6 (trust boundaries — the approval gate is closed to every agent), 7 (repository contract — the base commit recorded at run start), 12 (gates — `awaiting_approval`, the profile, the scope, the system name), 15 (the `approval` table and `run.profile_ref`), 17 (security and secret handling), 23 (build order step 4); `docs/hazards.md` entries 4 (fixtures and code agreeing while both are wrong), 12 (configuration divergence); `CLAUDE.md`; the shipped steps 1–3 as precedent (`src/store.ts`, `src/audit.ts`, `src/spec-stage.ts`, `docs/features/spec-stage/plan.md`).

**Assumptions:**

- **The profile covers what has actually been resolved, and names what has not.** Section 12 lists model map, limits, policy, agent definitions, verification config, panel sizes, and system name. Of those, limits, policy, agent definitions, panel sizes, and system name exist today as constants and modules and go into the profile. **The model map is deferred** — the model is still a per-invocation `--model` flag and section 10's tier resolution needs the config loader; it lands with step 5, which is the first stage that has to choose a model per stage rather than per command. **Verification config is deferred** — `governed.yaml` does not exist and is step 7's input. Both deferrals are stated here rather than silently omitted; hard rule 3 means the profile shape simply changes when they arrive, with no compatibility handling.
- **Policy is the subset of the profile the gates consult**, hashed separately so the re-check in section 12 ("the gate re-checks that policy has not changed since intake") compares one hash: panel sizes, remediation rounds, the materiality threshold, the severity and disposition enums, the required specialties, the protected-path prefixes, the prompt and result size caps, and the maximum approval lifetime.
- **The starting commit is recorded in the profile, not in a new `run` column.** Section 15's `run` table has no such column, and `test/schema.test.ts` compares the migration's columns to that block, so adding one would mean editing `ARCHITECTURE.md`. The profile is the frozen record of what the run resolved at start, which is exactly what a base commit is.
- **The gate compares the starting commit for equality; it does not verify the commit exists.** Nothing in step 4 touches git beyond reading `HEAD` at run start. Existence, branch creation, and worktree isolation are step 6.
- **A run created outside a git repository records `startingCommit: null`** and can never be approved, refused with a named message. This keeps every existing CLI test (which runs in temp directories) working unchanged, and fails closed rather than inventing a commit.
- **Signature refusal is not a run-terminal event.** The gate spends nothing — no dispatch, no invocation, no API cost — so a bad signature, a stale expiry, or a typo is an operator input error: it writes an `approval.refused` audit event, exits non-zero, and creates no stage row. Only a verified authorization creates the `awaiting_approval` stage row. This differs deliberately from step 3, where every failure was terminal because money had already been spent and state already written.
- **Re-approval is not supported.** If an `awaiting_approval` stage row already exists in any status, `bw approve` refuses and names that status. Because refusals leave no row, the operator can retry a correct signature freely; only a wedged run (a crash between the stage insert and its completion) reaches this refusal, and it is diagnosable rather than silently repaired.
- **One approval per run**, enforced by `UNIQUE (run_id)` on the table — section 12's "After approval. One authorization covers the rest."
- **Ed25519 via `node:crypto`.** No runtime dependencies, matching steps 1–3. Keys are PEM: SPKI for the public key, PKCS#8 for the private key.
- **The signing tool is operator-side, under `scripts/`, never under `src/`.** The system core only ever verifies. Nothing in `src/` reads a private key.
- **The system name is `BuildWorks`, a constant frozen in the profile.** Section 12 says nothing functional depends on it, so no code reads it back in this step.

**Approach:** Pure functions with injected inputs — canonical serialization, scope computation, the payload builder, and signature verification are all testable without git, without a network, and without an agent. One builder produces the payload for both `bw approval-request` and `bw approve`, so the printed payload and the verified payload cannot drift (the same discipline as `contentOf` in `src/audit.ts`). The gate recomputes every bound value from state — spec hash, risk, scope, profile hash — and takes only the signature and the expiry from the operator, so a mutated spec or a changed policy produces a different payload and the signature simply fails. Every guard gets a break-it run per hazard 4.

**Affected areas:** New `src/canonical.ts`, `src/scope.ts`, `src/policy.ts`, `src/profile.ts`, `src/approval.ts`, `src/approval-stage.ts`, `src/migrations/004_approval.sql`, `scripts/sign-approval.mjs`; modify `src/store.ts` (approval ops, `setProfileRef`), `src/cli.ts` (`approval-request`, `approve`, profile freeze in `new-run`), `src/spec-stage.ts` (constants and protected-path helpers move out), `scripts/doc-check.mjs`, `test/schema.test.ts`, `test/executor.test.ts`, `test/cli.test.ts`, `test/spec-stage.test.ts` (one import line), `CLAUDE.md`, `README.md`; new test files.

**Known blockers:**

- **`git` must be on PATH** for the one test that asserts `new-run` records a real starting commit (Task 5). Every other test in this plan is git-free by construction. If `git` is missing, that test fails loudly rather than skipping — an absent starting commit is exactly the condition that makes a run unapprovable, so a silent skip would hide it.
- **Hazard 4 (fixtures and code agreeing while both are wrong):** every guard in this plan gets a break-it run, recorded in task evidence. Expected values come from `node:crypto` (keys and signatures generated at test time), from `ARCHITECTURE.md` (the `approval` column list), and from the live constants (the policy hash) — never invented alongside the code that consumes them.
- **Hazard 12 (configuration divergence):** the profile is the effective configuration, written as readable JSON under `.governance/profiles/<run-id>/profile.json`, and the default-seeded repository is the tested case.
- **`test/cli.test.ts` asserts the walk writes exactly 4 audit rows** ([cli.test.ts:54](test/cli.test.ts#L54)). Freezing the profile in `new-run` adds a `profile.freeze` event, making it 5. Task 5 updates that assertion; it is a real consequence of this change, not an unrelated edit.
- **Hazards 1 and 3 do not apply.** This stage parses no model output and builds no prompt — it is deterministic and agent-free by design (section 12: "the approval gate is closed to every agent regardless of role"). `test/prompts.test.ts` scans `src/prompts.ts` only and is unaffected.
- **Scope fitness (section 12's "when the spec declares an artifact the signed scope does not cover") is not reachable in step 4**, because the scope is computed from the spec's declared artifacts and therefore covers them by construction. It becomes reachable when a later stage proposes an artifact the spec never declared — step 6. Stated, not silently skipped.

**Blast radius** (verified by import search across `src/**` and `test/**`):

- `src/store.ts` is imported by `src/audit.ts`, `src/cli.ts`, `src/dispatch.ts`, `src/spec-stage.ts`, and five test files. All changes are additive methods (`insertApproval`, `getApproval`, `setProfileRef`); no existing signature changes, so those importers compile unchanged. `test/store.test.ts:27` asserts `insertRun` leaves `profile_ref` null — `insertRun` is untouched, so that assertion still holds.
- `src/spec-stage.ts` is imported by `src/cli.ts` and `test/spec-stage.test.ts`. Moving `normalizePath`/`touchesProtected` out is invisible to both (neither is exported today). Moving `REMEDIATION_ROUNDS` to `src/policy.ts` changes one import line in `test/spec-stage.test.ts:7`; `MATERIAL_THRESHOLD` and `REQUIRED_SPECIALTIES` are currently private and have no importers.
- `src/select.ts` (`computeRisk`, `PANEL_SIZE`) is imported by `src/spec-stage.ts` and `test/select.test.ts` and is not modified — the approval gate becomes a third caller of `computeRisk`.
- `src/cli.ts` has no importers; `test/cli.test.ts` spawns it as a process.
- `scripts/doc-check.mjs` already expects `approval` in the architecture's table list ([doc-check.mjs:94](scripts/doc-check.mjs#L94)) but omits it from the migration column loop ([doc-check.mjs:129](scripts/doc-check.mjs#L129)); Task 10 adds it there. `test/schema.test.ts:93` has the same omission and Task 1 closes it.
- No consumer of the approval gate exists yet — step 5 (plan stage) is the next caller.

**Verification:** `npm run typecheck`, `npm test`, `npm run check:docs`. No test in this plan spawns the `claude` binary or makes a network call; the gate has no dispatch path, so there is no smoke test and no API spend for this step. Completion gate: `npm ci && npm run typecheck && npm test && npm run check:docs` from a clean checkout, plus every break-it run in Task 8 and Task 10 recorded as observed failures and restorations.

---

### Task 1: The `approval` table, store operations, and the schema contract

**Depends on:** None

**Files:**
- Create: `src/migrations/004_approval.sql`
- Modify: `src/store.ts` — `ApprovalRow`, `ApprovalInput`, `RISKS`, `insertApproval`, `getApproval`, `setProfileRef`
- Modify: `test/schema.test.ts` — approval coverage
- Modify: `test/store.test.ts` — approval coverage

**Steps:**

- [x] **Step 1: `004_approval.sql`**
  - Change: Create the `approval` table with the architecture's column list in exactly its order (`ARCHITECTURE.md` section 15), because `test/schema.test.ts` compares order: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `run_id INTEGER NOT NULL REFERENCES run(id)`, `feature_id TEXT NOT NULL`, `spec_hash TEXT NOT NULL`, `starting_commit TEXT NOT NULL`, `profile_hash TEXT NOT NULL`, `risk TEXT NOT NULL CHECK (risk IN ('low', 'standard', 'high'))`, `scope TEXT NOT NULL`, `expires_at TEXT NOT NULL`, `signature TEXT NOT NULL`, `signer TEXT NOT NULL`, `created_at TEXT NOT NULL`, then `UNIQUE (run_id)` — one authorization per run (section 12). Last line: `PRAGMA user_version = 4;`.
  - Verify: `node --test test/migrate.test.ts`
  - Expected: passes. That suite counts the `NNN_name.sql` files in `src/migrations` and asserts the applied database's `user_version` equals the count, and `applyMigrations` separately requires each file to set `user_version` to its own numeric prefix — so a missing or wrong `PRAGMA user_version = 4` fails here before anything else is built.

- [x] **Step 2: store operations**
  - Change: `src/store.ts` gains `export const RISKS: readonly string[] = ["low", "standard", "high"]`; `interface ApprovalRow` mirroring the columns; `interface ApprovalInput { runId, featureId, specHash, startingCommit, profileHash, risk, scope, expiresAt, signature, signer }`; `insertApproval(input): ApprovalRow` validating `risk` against `RISKS` with a message naming the allowed values (the established pattern in `insertRun`/`insertAgentRun`) and setting `created_at` to `new Date().toISOString()`; `getApproval(runId): ApprovalRow | undefined`; and `setProfileRef(id: number, profileHash: string): void` which updates `run.profile_ref` and `updated_at` and throws `run ${id} does not exist` when no row changed, matching `setRunStatus`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: store tests**
  - Change: `test/store.test.ts` adds: an approval inserts and reads back with every field intact; an invalid risk is refused naming `low, standard, high`; a second approval for the same run is refused by `UNIQUE (run_id)`; an approval for a nonexistent run is refused by the foreign key; `setProfileRef` sets `run.profile_ref` and throws naming the run when the id does not exist.
  - Verify: `node --test test/store.test.ts`
  - Expected: all pass.

- [x] **Step 4: schema contract extension**
  - Change: `test/schema.test.ts`'s column-compare loop at line 93 gains `"approval"` (and its test name is updated to list it); the CHECK assertions gain `sql.includes("CHECK (risk IN ('low', 'standard', 'high'))")` and `sql.includes("UNIQUE (run_id)")`.
  - Verify: `node --test test/schema.test.ts`
  - Expected: passes only when the migration's columns match the architecture block exactly.

**Task completion evidence:** `node --test test/schema.test.ts test/store.test.ts test/migrate.test.ts` green; a deliberate column reorder in `004_approval.sql` makes the schema test fail (recorded), then restored.

### Task 2: Canonical serialization and hashing

**Depends on:** None

**Files:**
- Create: `src/canonical.ts`
- Create: `test/canonical.test.ts`

**Steps:**

- [x] **Step 1: the three functions**
  - Change: `src/canonical.ts` exports:
    - `canonicalJson(value: unknown): string` — deterministic JSON with object keys sorted ascending by code unit, no whitespace, arrays in their given order. Throws `canonical JSON cannot serialize ${typeof v}` for `undefined`, functions, and symbols (including as object values, which `JSON.stringify` silently drops), and `canonical JSON cannot serialize a non-finite number` for `NaN`/`Infinity`. Silent dropping is what would let two different profiles hash the same.
    - `sha256Hex(input: string | Uint8Array): string` — `createHash("sha256").update(input).digest("hex")`. It accepts bytes as well as text because the signer fingerprint in Task 6 hashes a DER export, which is a `Buffer`.
    - `normalizeText(text: string): string` — strip a leading UTF-8 BOM, then `\r\n` → `\n`. Used before hashing any file read from the working tree: `docs/features/**` is committed, so a checkout under `core.autocrlf=true` would otherwise change the spec hash and invalidate a signature that is still correct.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: tests**
  - Change: `test/canonical.test.ts` asserts: two objects with the same entries in different insertion orders produce identical strings; nested objects and arrays inside arrays sort correctly; array order is preserved; `undefined` as an object value throws rather than vanishing; `NaN` throws; `normalizeText` converts CRLF and strips a BOM and leaves LF text byte-identical; `sha256Hex("")` equals the published empty-string digest `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (an external constant, not a value invented here).
  - Verify: `node --test test/canonical.test.ts`
  - Expected: all pass.

**Task completion evidence:** `node --test test/canonical.test.ts` green; replacing `canonicalJson` with plain `JSON.stringify` makes the key-order test fail (recorded), then restored.

### Task 3: Scope and protected paths, extracted from the spec stage

**Depends on:** None

**Files:**
- Create: `src/scope.ts`
- Create: `test/scope.test.ts`
- Modify: `src/spec-stage.ts` — remove `normalizePath`/`touchesProtected`, import them instead

**Steps:**

- [x] **Step 1: `src/scope.ts`**
  - Change: Move `normalizePath` and `touchesProtected` verbatim out of `src/spec-stage.ts` (lines 38–49) into `src/scope.ts` and export both, plus `export const PROTECTED_PATH_PREFIXES: readonly string[] = ["src/agents/", "src/executor.ts", "governed.yaml", ".governance/"]` — the array `touchesProtected` currently holds inline — and `computeScope(declaredArtifacts: string[]): string[]`, which maps each artifact through `normalizePath`, deduplicates, and sorts ascending. This is the set the operator signs (section 12: "the gate computes it at this stage, and the operator signs exactly that"). The extraction is justified by a second real consumer arriving in Task 8, not in anticipation of one (hard rule 4).
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: rewire the spec stage**
  - Change: `src/spec-stage.ts` imports `touchesProtected` from `./scope.ts` and deletes its local copies. No call site changes — `touchesProtected(written.doc.declaredArtifacts, run.slug)` at line 168 is unchanged.
  - Verify: `node --test test/spec-stage.test.ts`
  - Expected: passes unchanged — the extraction must be behaviour-preserving, and the existing suite is the proof.

- [x] **Step 3: scope tests**
  - Change: `test/scope.test.ts` asserts: `computeScope` sorts, deduplicates, and normalizes `./a` and `a\b` forms; the design document of the run's own slug counts as protected (section 7: "the design document that is the run's own input"); each prefix in `PROTECTED_PATH_PREFIXES` is detected; an ordinary `src/foo.ts` is not.
  - Verify: `node --test test/scope.test.ts`
  - Expected: all pass.

**Task completion evidence:** `node --test test/scope.test.ts test/spec-stage.test.ts` green; the spec-stage suite passing unchanged is the evidence the move was behaviour-preserving.

### Task 4: The policy constants and the policy hash

**Depends on:** Task 2, Task 3

**Files:**
- Create: `src/policy.ts`
- Create: `test/policy.test.ts`
- Modify: `src/spec-stage.ts` — import the constants instead of declaring them
- Modify: `test/spec-stage.test.ts` — one import line

**Steps:**

- [x] **Step 1: move the constants**
  - Change: `src/policy.ts` declares `export const SYSTEM_NAME = "BuildWorks"` (section 12's default, a constant until the config loader exists), and takes over from `src/spec-stage.ts` lines 15–17: `REMEDIATION_ROUNDS = 3`, `MATERIAL_THRESHOLD = "high"`, `REQUIRED_SPECIALTIES = ["requirements-traceability"]`. It adds `export const APPROVAL_MAX_LIFETIME_SECONDS = 86400` — the ceiling on how far ahead an approval may expire, so an operator cannot sign a decade-long authorization. `src/spec-stage.ts` imports all three from `./policy.ts` and deletes its own declarations, re-exporting nothing (one name per thing).
  - Change: In the same step, update the one importer: `test/spec-stage.test.ts:7` imports `REMEDIATION_ROUNDS` from `../src/policy.ts` and `runSpecStage` from `../src/spec-stage.ts`. `tsconfig.json` includes `test`, so typecheck covers it — the move and the import update are one step, not two, because either alone leaves the tree red.
  - Verify: `npm run typecheck && node --test test/spec-stage.test.ts`
  - Expected: exit 0 and the spec-stage suite passes unchanged.

- [x] **Step 2: `buildPolicy` and `policyHash`**
  - Change: `src/policy.ts` exports `interface Policy` and `buildPolicy(): Policy` returning exactly `{ panelSizes: { ...PANEL_SIZE }, remediationRounds: REMEDIATION_ROUNDS, materialityThreshold: MATERIAL_THRESHOLD, severities: [...SEVERITIES], dispositions: [...DISPOSITIONS], requiredSpecialties: [...REQUIRED_SPECIALTIES], protectedPathPrefixes: [...PROTECTED_PATH_PREFIXES], promptMaxBytes: PROMPT_MAX_BYTES, resultMaxBytes: RESULT_MAX_BYTES, approvalMaxLifetimeSeconds: APPROVAL_MAX_LIFETIME_SECONDS }` — imported from `./select.ts`, `./finding.ts`, `./scope.ts`, and `./harness.ts` respectively, so there is one definition of each value and the policy cannot drift from what the gates actually use. Also `policyHash(policy: Policy): string` = `sha256Hex(canonicalJson(policy))`.
  - Verify: `npm run typecheck`
  - Expected: exit 0. (`src/policy.ts` importing `./harness.ts` introduces no cycle: `harness.ts` imports only `./executor.ts`.)

- [x] **Step 3: policy tests**
  - Change: `test/policy.test.ts` asserts: `buildPolicy()` is stable across calls and its hash is deterministic; the policy's `panelSizes`, `remediationRounds`, `severities`, `dispositions`, and `protectedPathPrefixes` are identical to the live exports from `select.ts`, `policy.ts`, `finding.ts`, and `scope.ts` (so a constant changed in one place cannot leave the policy stale); mutating a copy of the policy object changes the hash.
  - Verify: `node --test test/policy.test.ts`
  - Expected: all pass.

**Task completion evidence:** `npm test` green; changing `REMEDIATION_ROUNDS` to 4 changes the policy hash (recorded), then restored.

### Task 5: The frozen profile, written at run start

**Depends on:** Task 1, Task 2, Task 4

**Files:**
- Create: `src/profile.ts`
- Create: `test/profile.test.ts`
- Modify: `src/cli.ts` — `new-run` freezes the profile
- Modify: `test/cli.test.ts` — the audit-count assertion and one new test

**Steps:**

- [x] **Step 1: the profile shape and its writer**
  - Change: `src/profile.ts` exports `interface Profile { runId: number; systemName: string; startingCommit: string | null; frozenAt: string; agents: AgentDefinition[]; executor: ExecutorDefinition; policy: Policy; policyHash: string }` and `freezeProfile(rootDir: string, runId: number, startingCommit: string | null): { path: string; hash: string; profile: Profile }`. It builds the profile with `agents` copied from `AGENTS` sorted by `id`, `executor` from `CLAUDE_CODE`, `policy` from `buildPolicy()`, `policyHash` from `policyHash(policy)`, `frozenAt` from `new Date().toISOString()`; serializes it with `canonicalJson`; writes it to `.governance/profiles/<runId>/profile.json` (creating the directory); and returns `sha256Hex` of that exact string as the hash. Writing the canonical string is what makes the hash reproducible from the file bytes.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: the loader and the tamper check**
  - Change: `src/profile.ts` also exports `loadProfile(rootDir, runId): { profile: Profile; hash: string }`, which reads the file, hashes the raw string it read, and `JSON.parse`s it. It throws `no frozen profile for run ${runId} at ${path}` when the file is missing. The caller — not the loader — compares the hash against `run.profile_ref`, so the loader has one job.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: the starting commit resolver**
  - Change: `src/profile.ts` exports `resolveStartingCommit(rootDir: string): string | null` using `spawnSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" })`. Returns the trimmed stdout when `status === 0` and it matches `/^[0-9a-f]{40}$/`; returns `null` on any other outcome (git absent, not a repository, no commits). Never throws: a run outside a repository is created and simply cannot be approved.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 4: freeze at run start**
  - Change: `src/cli.ts`'s `new-run` case, after the existing `run.create` audit event: call `freezeProfile(process.cwd(), run.id, resolveStartingCommit(process.cwd()))`, then `store.setProfileRef(run.id, hash)`, then `appendAudit(..., action: "profile.freeze", summary: \`froze profile ${hash} for run ${run.id}\`)`, then print the run id as today. Wrap the freeze in `try`/`catch`: on failure, append `profile.freeze.failed` with the error message, call `store.setRunStatus(run.id, "blocked")`, and rethrow so the CLI exits 1 — a run with no profile can never be approved, so it fails closed at creation rather than at the gate.
  - Verify: `node --test test/cli.test.ts`
  - Expected: the chain-walk test fails on the audit count (4 → 5); fixed in the next step.

- [x] **Step 5: CLI tests**
  - Change: `test/cli.test.ts` line 54's `assert.equal(auditRows.length, 4)` becomes `5`, with a comment naming `profile.freeze` as the added event. Add a test: in a temp directory, `new-run` writes `.governance/profiles/<id>/profile.json`, the `run.profile_ref` column equals `sha256Hex` of that file's contents, and `startingCommit` is `null` (a temp directory is not a git repository). Add a second test that runs `git init -q`, `git -c user.email=t@example.invalid -c user.name=t commit -q --allow-empty -m base` in the temp directory — asserting each `status === 0` so a missing `git` fails loudly — then `new-run`, and asserts the profile's `startingCommit` matches the 40-hex output of `git rev-parse HEAD`.
  - Verify: `node --test test/cli.test.ts`
  - Expected: all pass.

- [x] **Step 6: profile tests**
  - Change: `test/profile.test.ts` asserts: `freezeProfile` then `loadProfile` round-trips with an identical hash; appending a byte to the file changes the loaded hash (the tamper detection Task 8's gate relies on); the profile contains every seeded agent id from `AGENTS` and the executor id `claude-code`; the profile's `policyHash` equals `policyHash(buildPolicy())`; freezing twice with the same inputs except `frozenAt` produces different hashes (the timestamp is part of the record) while the policy hash stays equal.
  - Verify: `node --test test/profile.test.ts`
  - Expected: all pass.

**Task completion evidence:** `npm test` green; the profile file exists with `run.profile_ref` matching its digest, shown from a temp-directory run.

### Task 6: The approval payload, the public key, and Ed25519 verification

**Depends on:** Task 2, Task 3, Task 5

**Files:**
- Create: `src/approval.ts`
- Create: `test/approval.test.ts`

**Steps:**

- [x] **Step 1: the canonical payload**
  - Change: `src/approval.ts` exports `interface ApprovalBinding { featureId: string; specHash: string; startingCommit: string; profileHash: string; risk: string; expiresAt: string; scope: string[] }` and `approvalPayload(b: ApprovalBinding): string`, producing exactly, LF-joined with no trailing newline:
    ```
    buildworks-approval
    featureId: <featureId>
    specHash: <specHash>
    startingCommit: <startingCommit>
    profileHash: <profileHash>
    risk: <risk>
    expiresAt: <expiresAt>
    scope: <scope.length>
    <scope[0]>
    …
    ```
    The count line bounds the path list so no path can be confused with a field. The header is the fixed literal `buildworks-approval` — a domain separator, not a version discriminator (hard rule 3), and deliberately not the configurable system name, which section 12 says nothing functional depends on.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: expiry validation**
  - Change: `validateExpiry(expiresAt: string, now: number, maxLifetimeSeconds: number): { ok: true } | { ok: false; reason: string }`. Refuses, with these exact messages: `--expires must be an ISO 8601 UTC timestamp such as 2026-08-30T12:00:00.000Z, got ${expiresAt}` when it does not match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/` or `Date.parse` returns `NaN`; `approval expired at ${expiresAt}` when it is not after `now`; `approval expiry ${expiresAt} exceeds the maximum lifetime of ${maxLifetimeSeconds} seconds` when `Date.parse(expiresAt) - now > maxLifetimeSeconds * 1000` — a strict `>`, so a timestamp exactly at the ceiling is accepted rather than refused by one millisecond.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: the public key**
  - Change: `resolvePublicKeyPath(rootDir: string): { ok: true; path: string } | { ok: false; reason: string }` — uses `process.env.BW_APPROVAL_PUBLIC_KEY` when set and non-empty, otherwise `join(homedir(), ".buildworks", "approval.pub")`. It refuses with `approval public key must not live inside the repository: ${path}` when `resolve(path)` is inside `resolve(rootDir)` (section 17: never in the repo, never in a projection, never in run state — `.governance/` is inside the repository and is therefore covered by the same check), and with `approval public key not found: set BW_APPROVAL_PUBLIC_KEY or place a PEM Ed25519 public key at ${path}` when the file does not exist.
  - Change: `loadPublicKey(rootDir): { ok: true; key: KeyObject; signer: string } | { ok: false; reason: string }` — reads the PEM, `createPublicKey`, refuses `approval public key at ${path} is ${type}, not ed25519` when `asymmetricKeyType !== "ed25519"`, refuses `approval public key at ${path} is not a valid PEM public key: ${message}` on a parse throw, and returns `signer` as `sha256Hex(key.export({ format: "der", type: "spki" }))` — an identifier for the key that is not the key. (This is why `sha256Hex` takes bytes as well as text in Task 2.)
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 4: verification**
  - Change: `verifyApproval(payload: string, signatureBase64: string, key: KeyObject): { ok: true } | { ok: false; reason: string }`. Refuses `approval signature is not valid base64` when the string does not match `/^[A-Za-z0-9+/]+={0,2}$/`; refuses `approval signature is ${n} bytes, not the 64 an Ed25519 signature must be` on a wrong length (checked before `verify`, so a truncated paste is diagnosable rather than a bare false); otherwise returns the result of `verify(null, Buffer.from(payload, "utf8"), key, sig)` as `{ ok: true }` or `{ ok: false, reason: "approval signature does not verify against the configured public key" }`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 5: tests**
  - Change: `test/approval.test.ts` generates a keypair with `generateKeyPairSync("ed25519")` in the test — the expected signature comes from `node:crypto`, never from a value written alongside the code. It asserts: a payload signed with the private key verifies; a payload with one character changed does not; a signature from a second, different keypair does not; the payload's field order and count line are exact (compared against a literal built in the test from the same binding); `resolvePublicKeyPath` prefers the env var, refuses a path inside the repository root naming it, and refuses a missing file naming both the env var and the default path; a non-Ed25519 key (generate an RSA key) is refused naming `ed25519`; a 32-byte signature is refused naming 64; each `validateExpiry` refusal message matches exactly.
  - Verify: `node --test test/approval.test.ts`
  - Expected: all pass.

**Task completion evidence:** `node --test test/approval.test.ts` green; deleting the length check makes the truncated-signature test fail with a different message (recorded), then restored.

### Task 7: The operator's signing tool

**Depends on:** Task 6

**Files:**
- Create: `scripts/sign-approval.mjs`
- Create: `test/sign-approval.test.ts`

**Steps:**

- [x] **Step 1: the script**
  - Change: `scripts/sign-approval.mjs` — plain Node ESM, no dependencies, matching `scripts/doc-check.mjs`'s style. Two subcommands:
    - `keygen --out <dir>`: `generateKeyPairSync("ed25519")`, write `approval.key` (PKCS#8 PEM, `mode: 0o600`) and `approval.pub` (SPKI PEM) into `<dir>`, refusing with `refusing to write signing material inside the repository: ${dir}` when `resolve(dir)` is inside `resolve(process.cwd())` — so the guard is relative to where the script is run, and every test that expects it to pass must spawn the script with `cwd` at the repository root and `--out` pointing at a temp directory — and refusing to overwrite an existing `approval.key`. Print the two paths and the line to export `BW_APPROVAL_PUBLIC_KEY`.
    - `sign --key <path>`: read the payload from **stdin** (never argv — a payload contains newlines and would be shredded by a shell, the same failure section 11 records for prompts), sign with `sign(null, payload, privateKey)`, print the base64 signature and nothing else.
    - Any other argv prints a usage line and exits 2.
  - Change: This script lives under `scripts/` and is never imported by anything in `src/`. It is the only place in the repository that touches a private key.
  - Verify: `node scripts/sign-approval.mjs` (no arguments)
  - Expected: exit 2 with the usage line.

- [x] **Step 2: tests**
  - Change: `test/sign-approval.test.ts` spawns the script with `spawnSync(process.execPath, ...)`: `keygen --out <tempdir>` writes both files and the public key loads as Ed25519; `keygen --out <a directory inside process.cwd()>` exits non-zero naming the refusal; `sign --key <path>` with a multi-line payload on stdin prints a signature that `verifyApproval` accepts against the generated public key.
  - Verify: `node --test test/sign-approval.test.ts`
  - Expected: all pass.

- [x] **Step 3: no private key in the core**
  - Change: Add a test to `test/sign-approval.test.ts` that reads every `.ts` file under `src/` and asserts none contains `createPrivateKey`, `PRIVATE KEY`, or `approval.key` — section 17's "a worker or agent session never receives them under any circumstance", asserted mechanically rather than promised in prose.
  - Verify: `node --test test/sign-approval.test.ts`
  - Expected: passes.

**Task completion evidence:** a signature produced by the script verifies through `verifyApproval`; the source scan passes and fails when `createPrivateKey` is temporarily added to a `src/` file (recorded), then restored.

### Task 8: The `awaiting_approval` gate

**Depends on:** Task 1, Task 3, Task 5, Task 6

**Files:**
- Create: `src/approval-stage.ts`
- Create: `test/approval-stage.test.ts`

**Steps:**

- [x] **Step 1: the binding builder**
  - Change: `src/approval-stage.ts` exports `buildBinding(store, rootDir, runId, expiresAt): { ok: true; binding: ApprovalBinding; specPath: string; reviewStageId: number } | { ok: false; reason: string }`, performing every precondition and recomputation in this order, each with its own message:
    1. run exists — `run ${runId} does not exist`;
    2. `run.status === "in_progress"` — `run ${runId} is ${status}, not in_progress`;
    3. the stage chain's last row is kind `spec_review` with `status === "passed"` and a non-empty `output_ref` — `run ${runId} has no passed spec_review stage to approve` (or, when the last row is a different kind, `run ${runId}'s last stage is ${kind} (${status}), not a passed spec_review`);
    4. no `awaiting_approval` stage exists in the chain — `run ${runId} already has an awaiting_approval stage with status ${status}`;
    5. `run.profile_ref` is not null — `run ${runId} has no frozen profile`;
    6. `loadProfile` succeeds and its hash equals `run.profile_ref` — `profile for run ${runId} has been modified since intake: frozen ${profile_ref}, on disk ${hash}`;
    7. `policyHash(buildPolicy())` equals `profile.policyHash` — `policy has changed since intake: profile ${a}, in force ${b}` (section 12's re-check);
    8. `profile.startingCommit` is not null — `run ${runId} has no starting commit: it was not created in a git repository`;
    9. the spec file at the review stage's `output_ref` reads — `cannot read the approved spec ${path}: ${message}` — and `validateSpecDoc` accepts it — `the approved spec ${path} no longer validates: ${reason}`;
    10. `specHash = sha256Hex(normalizeText(content))`; `risk = computeRisk(run.change_kind, doc.declaredArtifacts.length, touchesProtected(doc.declaredArtifacts, run.slug))`; `scope = computeScope(doc.declaredArtifacts)`.
    Every bound value is recomputed here; the operator supplies only `expiresAt`. A mutated spec, a changed policy, or a moved profile therefore produces a different payload and the signature fails on its own — the gate never has to trust an operator-supplied risk or scope.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: the gate**
  - Change: `approveRun(store, rootDir, { runId, expiresAt, signature }): { ok: true; approvalId: number; stageId: number } | { ok: false; reason: string }`. It calls `validateExpiry` first (the expiry is an input to the payload, so a malformed one must be refused before anything is built), then `buildBinding`, then `loadPublicKey`, then `verifyApproval` over `approvalPayload(binding)`. On any refusal it appends an audit event `approval.refused` (actor `operator`, actorType `human`, `stageId: null`) carrying the reason and returns it — no stage row, no run status change, because nothing was spent. **The audit append is conditional on the run existing**: `audit.run_id` carries a foreign key to `run(id)` and `PRAGMA foreign_keys` is on, so appending an event for a nonexistent run would throw and turn a clean refusal into a crash. When the run does not exist, return the reason with no audit event. On success, in order: `insertStage(runId, "awaiting_approval", reviewStageId)`; audit `approval.stage.create`; `insertApproval({ ...binding, runId, scope: canonicalJson(binding.scope), signature, signer })`; `completeStage(stageId, specPath, "pass")` — `output_ref` is the spec path because that is literally what the plan stage is handed (section 4); audit `approval.granted` with the approval id and the signer fingerprint.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: the gate's tests — the success path**
  - Change: `test/approval-stage.test.ts` builds a fixture run without any dispatch: create a temp directory, `openStore`, `insertRun`, write a valid `spec.md` under `docs/features/<slug>/`, insert a `spec` stage completed pass and a `spec_review` stage completed pass with the spec path as `output_ref`, `freezeProfile` with a literal 40-hex starting commit, `setProfileRef`. Generate a keypair, point `BW_APPROVAL_PUBLIC_KEY` at the written public key, sign `approvalPayload(buildBinding(...).binding)`, call `approveRun`. Assert: it succeeds; the `approval` row's `feature_id`, `spec_hash`, `starting_commit`, `profile_hash`, `risk`, `scope`, `expires_at`, and `signer` match the recomputed values; the `awaiting_approval` stage is `passed` with `gate_result` `pass` and the spec path as `output_ref`; `verifyAuditChain` returns null; the audit contains `approval.granted`.
  - Verify: `node --test test/approval-stage.test.ts`
  - Expected: passes.

- [x] **Step 4: the gate's tests — every refusal**
  - Change: One test per refusal, asserting the exact message and that **no stage row and no approval row were created**: nonexistent run; a blocked run; a run whose last stage is `spec` rather than a passed `spec_review`; a run with an existing `awaiting_approval` stage; a run with `profile_ref` null; a profile file altered after freezing; a profile whose recorded `policyHash` differs from the live one — the profile-hash comparison runs first and would shadow this, so the test must build a *self-consistent* stale profile: take `freezeProfile`'s returned profile object, replace its `policyHash` with a different digest, write `canonicalJson` of the altered object over the file, and `setProfileRef` to `sha256Hex` of exactly those bytes, so check 6 passes and check 7 is the one that fires; then assert the message names both hashes; `startingCommit: null`; a deleted spec file; a spec edited after review (assert the failure is the *signature*, not a hash comparison — the payload changed, which is the design); a signature from a different keypair; an expired `expiresAt`; an `expiresAt` beyond `APPROVAL_MAX_LIFETIME_SECONDS`; a malformed `expiresAt`. Also assert each refusal appended exactly one `approval.refused` audit event.
  - Verify: `node --test test/approval-stage.test.ts`
  - Expected: all pass.

- [x] **Step 5: the gate is closed to every agent**
  - Change: Add a test asserting `src/approval-stage.ts` contains no reference to `dispatchOnce`, `invokeHarness`, or `agentById` (read the file and assert), and that after a full `approveRun` success no `agent_run` row exists for the run. Section 6: "the approval gate is closed to every agent regardless of role" — a deterministic gate that never dispatches is the enforceable form of that sentence, and it is also why a refusal costs nothing.
  - Verify: `node --test test/approval-stage.test.ts`
  - Expected: passes.

- [x] **Step 6: prove the guards by breaking them**
  - Change: Run each of these, confirm the named test fails, then restore: (a) skip the profile-hash comparison in step 6 of `buildBinding` → the altered-profile test fails; (b) skip the policy re-check → the changed-policy test fails; (c) drop the `validateExpiry` call → the expired test fails; (d) take `risk` from a parameter instead of `computeRisk` → the edited-spec test fails; (e) return `{ ok: true }` from `verifyApproval` unconditionally → the wrong-key test fails; (f) allow a public key inside the repository → the section 17 test fails.
  - Verify: `node --test test/approval-stage.test.ts` after each break and each restore
  - Expected: exactly the named test fails on each break and the suite is green after each restore.

**Task completion evidence:** `node --test test/approval-stage.test.ts` green; all six break-it runs recorded with the test that failed for each.

### Task 9: The CLI surface

**Depends on:** Task 6, Task 8

**Files:**
- Modify: `src/cli.ts` — `approval-request`, `approve`, usage
- Modify: `test/cli.test.ts` — the two commands

**Steps:**

- [x] **Step 1: `approval-request`**
  - Change: Add `approval-request` to the `known` array and to `USAGE` as `approval-request --run <id> [--expires <iso>]    print the payload for the operator to sign`. The case reads `numeric(args, "run")` and `args.get("expires")`; when `--expires` is absent it computes `new Date(Date.now() + 3600_000).toISOString()` — one hour, comfortably inside `APPROVAL_MAX_LIFETIME_SECONDS` so the command's own default can never trip its own ceiling check. It calls `validateExpiry` then `buildBinding`, printing the reason to stderr and exiting 1 on refusal. On success it prints the payload alone to **stdout** — nothing else, so `bw approval-request --run 1 --expires <iso> > payload.txt` captures exactly the bytes to be signed — and prints `expires: <iso>` to **stderr** as a reminder of the value `bw approve` will need.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: `approve`**
  - Change: Add `approve` to `known` and to `USAGE` as `approve --run <id> --expires <iso> --signature <base64>    verify and record the authorization`. The case requires all three options through `required`/`numeric` (so a missing one exits 2 naming it, matching every other command), calls `approveRun`, prints the approval id on success, and on refusal prints the reason to stderr and exits 1.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: CLI tests**
  - Change: `test/cli.test.ts` adds: `approval-request --run 9999` exits 1 naming the run; `approve` without `--signature` exits 2 naming the option; a full walk in a temp directory — `new-run`, hand-built spec and stage rows through `openStore` (as in Task 8), then `sign-approval.mjs keygen --out <a second temp directory>` spawned with `cwd` set to the repository root so the inside-the-repository refusal does not fire on a temp path, `BW_APPROVAL_PUBLIC_KEY` set in the spawned environment, one `--expires` value computed in the test and passed **explicitly to both commands** (never scraped from stderr, which also carries the `node:sqlite` ExperimentalWarning), `approval-request` captured from stdout, `sign-approval.mjs sign` over those exact bytes, then `approve` exits 0 and prints an approval id; and `approve` run a second time with the same signature exits 1 naming the existing `awaiting_approval` stage. The walk must pipe the payload through the signing script rather than signing inline, because the byte-for-byte identity of what is printed and what is verified is the property under test.
  - Verify: `node --test test/cli.test.ts`
  - Expected: all pass.

**Task completion evidence:** the end-to-end CLI walk passes: request → sign → approve → recorded approval row, with `bw verify-audit` reporting `chain valid` afterwards.

### Task 10: Documentation facts, trust boundaries, and the completion gate

**Depends on:** Task 1, Task 8, Task 9

**Files:**
- Modify: `scripts/doc-check.mjs` — approval table and constraints
- Modify: `test/executor.test.ts` — trust-boundary assertions
- Modify: `CLAUDE.md` — the commands line
- Modify: `README.md` — the status paragraph

**Steps:**

- [x] **Step 1: the documentation checker**
  - Change: `scripts/doc-check.mjs` line 129's table loop gains `"approval"`, and the `constraints` array gains `"CHECK (risk IN ('low', 'standard', 'high'))"` and `"UNIQUE (run_id)"` — the same precedent as the `severity`/`disposition` additions in step 3.
  - Verify: `npm run check:docs`
  - Expected: `OK: documentation facts verified`.

- [x] **Step 2: trust-boundary assertions on the executor**
  - Change: `test/executor.test.ts` adds two tests. First: no entry of `CLAUDE_CODE.sandbox.envPassthrough` starts with `BW_` — a spawned executor must never receive `BW_APPROVAL_PUBLIC_KEY` or any future approval variable (section 17: "pass named environment variables, never the whole environment"). Second: `CLAUDE_CODE.sandbox.commandAllowlist` contains neither `bw` nor `git` — section 6's "agents may not invoke the governance CLI; spawned executors never receive it in an allowlist." Both pin behaviour that is currently correct by accident of an empty list; the tests make it a rule.
  - Verify: `node --test test/executor.test.ts`
  - Expected: passes; adding `"bw"` to the allowlist makes it fail (recorded break-it run), then restored.

- [x] **Step 3: the commands line**
  - Change: `CLAUDE.md`'s Commands section currently reads `node src/cli.ts migrate|new-run|stage-add|stage-complete|verify-audit`, which already omits `dispatch` and `spec`. Replace with `node src/cli.ts migrate|new-run|stage-add|stage-complete|dispatch|spec|approval-request|approve|verify-audit`, and add one line beneath it: `node scripts/sign-approval.mjs keygen|sign` — the operator's signing tool, never invoked by the system.
  - Verify: read the file back and confirm every listed command appears in `src/cli.ts`'s `known` array
  - Expected: the two lists agree.

- [x] **Step 4: the status paragraph**
  - Change: `README.md`'s Status section extends the "steps 1-3" sentence to steps 1–4, naming the approval gate in one clause: `and the human approval gate (bw approval-request prints the payload, bw approve verifies one Ed25519 authorization against a public key held outside the repository)`. Nothing else in the README changes.
  - Verify: `npm run check:docs`, and read the edited paragraph back against `src/cli.ts`'s `known` array
  - Expected: `OK: documentation facts verified`, and every command the README names exists in `known`. The checker reads `ARCHITECTURE.md`, not the README, so it can only confirm this edit broke nothing — the command-name comparison is the check that the sentence is true. If the paragraph cannot be written without also changing `ARCHITECTURE.md`, stop: an architecture change is outside this plan and is a decision, not a step.

- [x] **Step 5: the completion gate**
  - Change: None — this step runs the gate.
  - Verify: `npm ci && npm run typecheck && npm test && npm run check:docs`
  - Expected: all four exit 0, from a clean checkout, with no test spawning the `claude` binary and no network call.

**Task completion evidence:** the full gate passes; the executor trust-boundary break-it run is recorded; `CLAUDE.md`'s command list matches `src/cli.ts`.

---

## Implementation note (2026-08-29)

All ten tasks executed. `npm ci && npm run typecheck && npm test && npm run check:docs` green from a clean install: **207 tests, 0 failures**. No test spawns the `claude` binary and no network call is made — the gate is deterministic and agent-free, so step 4 cost nothing in API spend.

**What shipped:** migration `004_approval.sql` and the `approval` table; `canonical.ts`, `scope.ts`, `policy.ts`, `profile.ts`, `approval.ts`, `approval-stage.ts`; `scripts/sign-approval.mjs`; `bw approval-request` and `bw approve`; profile freezing in `bw new-run`.

**Guards proven by breaking them** (hazard 4), each confirmed failing then restored: the `approval` column-order contract; `canonicalJson` vs `JSON.stringify`; the policy hash tracking `REMEDIATION_ROUNDS`; the signature length check; the private-key source scan; the profile-hash comparison; the policy re-check; the expiry check; risk recomputation; signature verification; the public-key containment rule; the executor trust boundaries; and the payload/newline identity.

**Deviations from the plan as written:**

- Break-it run (d) was predicted to fail the edited-spec test; hardcoding `risk` actually failed the success-path test, which asserts `risk === "low"`. The guard is proven either way — the prediction was wrong, not the guard.
- Break-it run (f)'s guard is asserted in `test/approval.test.ts`, not the gate suite as the plan implied.
- Task 4's steps 1 and 2 were merged: `tsconfig.json` includes `test`, so moving the constants and updating the importer had to land together or the tree stayed red.

**Independent code review: six findings, four fixed, two accepted by operator decision.**

Fixed:

1. `approval-request` printed the payload with `console.log`, appending a newline that is not part of what `approve` verifies — the documented redirect/pipe workflow would always have failed. The CLI test masked it by stripping the newline before signing. Now `process.stdout.write` emits exact bytes, `sign` strips one trailing newline defensively, and the test signs the raw stdout and asserts it does not end in a newline.
2. `sign-approval.mjs keygen` compared `--out` against `process.cwd()`, so running it from outside the repository could write the private key into the tracked tree. It now walks up from the target for an enclosing `.git`.
3. `--expires` present but empty silently took the default, defeating the parser's own "record it as empty so `required()` reports the option" design. Now a usage error.
4. `RISKS` was hand-duplicated in `store.ts` against `select.ts`'s `Risk`/`PANEL_SIZE`. It now lives in `select.ts` beside the type, with a test asserting it matches the panel-size map exactly.

Accepted, not fixed (operator decision, 2026-08-29):

5. **The verification trust anchor is `BW_APPROVAL_PUBLIC_KEY` read at approve time, and the recorded `signer` is never compared against anything frozen.** Anyone able to set that variable can point it at their own key and self-approve, and it audits as a valid approval. Accepted because the key is machine-local operator configuration by section 12's design, and the agent threat model is covered: agents receive no `BW_*` variable (asserted in `test/executor.test.ts`) and never receive the CLI. **The hardening, if wanted later, is to freeze the signer fingerprint in the profile at run start and have the gate require a match.** Recorded here as a known gap rather than an implied guarantee, per section 6's rule about asserting versus proving.
6. **`approveRun`'s four writes are not atomic.** A crash between `insertStage` and `completeStage` leaves a pending `awaiting_approval` stage that permanently blocks the run with no CLI recovery path. Accepted as the plan already stated. A real fix means restructuring `Store`'s transaction handling — `insertStage` and `appendAudit` each open their own `BEGIN IMMEDIATE` and cannot nest — which is step-1 code and outside this plan.

## What step 4 deliberately does not build

Named here so a reader does not mistake absence for oversight:

- **Branch and worktree creation** (`gov/<slug>/<run-id>`, `.governance/worktrees/<run-id>`) — step 6. The starting commit is recorded now because the approval binds it; nothing creates a branch yet.
- **Scope fitness and delta approvals** (section 12) — unreachable until a stage proposes an artifact the spec never declared, which is step 6.
- **The model map and semantic tier resolution** (section 10) — the profile gains them with the config loader, before step 5 needs a per-stage model.
- **Verification config** (`governed.yaml`) — step 7's input; the profile gains it then.
- **`status.md` projections** (section 14) — no build-order step requires them before the loop closes.
