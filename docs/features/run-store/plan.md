# Run Store Implementation Plan

**Status:** Implemented

**Goal:** Build order step 1: the run store, stage chain, and audit chain over SQLite in TypeScript on Node, with the documentation checker as the first piece of the test suite.

**Source:** `ARCHITECTURE.md` sections 15 (state, storage, and evidence), 16 (audit), 19 (concurrency, failure, and resume), 20 (limits), 21 (verification strategy), and 23 (build order, step 1); `docs/hazards.md` entries 2, 4, 9, and 11; `CLAUDE.md` layout and commands conventions.

**Hazards considered:** `docs/hazards.md` 2 (discarded output is undiagnosable — raw retention precedes parsing), 4 (fixtures and code agreeing while both are wrong — every guard proven by breaking it), 9 (unverified hook interpreters — the interpreter is verified where it will be spawned), 11 (a default install that cannot complete a run). Entries 1, 3, 5-8, 10, 12-14 concern agent output, delivery, and prompts, none of which this step builds.

**Assumptions:**

- Step 1 creates only the `run`, `stage`, and `audit` tables. `agent_run`, `finding`, and `approval` arrive with their build-order steps (2, 3, and 4). The documentation checker still asserts the architecture's full six-table block, so the document stays the contract.
- IDs are `INTEGER PRIMARY KEY AUTOINCREMENT`; timestamps are TEXT ISO-8601 UTC.
- Migrations are committed under `src/migrations/` and applied via `PRAGMA user_version` (no bookkeeping table, so the schema block stays the only schema). The architecture currently lists migrations inside the gitignored `.governance/` directory — task 7 fixes the document; task 6 proves the fix with a checker assertion.
- The CLI binary is named `bw` and the npm package is named `buildworks`. The system display name stays configuration (default BuildWorks) and is not used by step 1.
- Step 1 paths are relative to the invocation's working directory (the repository root): `.governance/`, `src/migrations/`, and the lock file resolve from there. Tests pass explicit temp roots.
- `node:sqlite` prints an ExperimentalWarning on Node 24 — expected and harmless.

**Approach:** Zero runtime dependencies. `node:sqlite` for the store, `node --test` with native type stripping for tests (Node 24 verified on this machine: `process.features.typescript === "strip"`), `tsc --noEmit` for type checking, and `crypto` for audit hashing. Migrations apply at startup; every `bw` invocation takes a repository lock first and fails fast if it cannot. The documentation checker is a dependency-free script that re-derives facts from `ARCHITECTURE.md` and the real migration files, wired as a project skill.

**Affected areas:** New `src/` tree, `test/` tree, `scripts/doc-check.mjs`, `package.json`, `tsconfig.json`, `.claude/skills/doc-check/`; edits to `ARCHITECTURE.md` (migration location), `CLAUDE.md` (commands), and `README.md` (status).

**Known blockers:**

- `ARCHITECTURE.md` section 15 lists `migrations/` inside `.governance/`, which the repository `.gitignore` excludes — migrations are code and must be versioned. Verified against the current `.gitignore` and the architecture layout block. Resolved in tasks 6 and 7, not mid-execution.
- Hazard 9 (unverified hook interpreters): the doc-check skill spawns `node`; the spawning environment must resolve it. The `PATH` fix in `~/.claude/settings.json` (2026-08-28) restores `C:\Program Files\nodejs`. The skill's first step verifies `node --version` resolves before running the checker. The same applies to `test/cli.test.ts`, which spawns `node src/cli.ts`; in a shell where `node` does not resolve, use the full path `C:\Program Files\nodejs\node.exe` (verified present on this machine).
- Hazard 11 (a default installation that cannot complete a run): the completion gate runs the full command set from a clean checkout.

**Blast radius:** No existing code — the repository contains only markdown documents (verified by directory listing; nothing imports or calls anything). The consumers are the future build-order steps, which is why the schema contract test pins `store.ts` and the migrations to the architecture's schema block. `CLAUDE.md` gains its first commands section, so it is edited once.

**Verification:** `npm run typecheck` (strict `tsc --noEmit`), `npm test` (`node --test`), `npm run check:docs` (the checker), and the completion gate: `npm ci && npm run typecheck && npm test && npm run check:docs` from a clean checkout. Every guard gets a break-it test per hazard 4.

---

### Task 1: Toolchain and package skeleton

**Depends on:** None

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts` — usage-only stub

**Steps:**

- [x] **Step 1: `package.json`**
  - Change: `name: "buildworks"`, `private: true`, `type: "module"`, `engines.node: ">=24"`, `bin: { "bw": "src/cli.ts" }`, scripts: `"typecheck": "tsc --noEmit"`, `"test": "node --test"`, `"check:docs": "node scripts/doc-check.mjs"`. Dev dependencies: `typescript@^5.8`, `@types/node@^24`. `npm install` generates `package-lock.json`, which is committed — the completion gate uses `npm ci`. The CLI entry has the shebang `#!/usr/bin/env node`.
  - Verify: `npm install` completes; `npm ls --depth=0` shows the two dev dependencies.
  - Expected: install succeeds with zero runtime dependencies.

- [x] **Step 2: `tsconfig.json`**
  - Change: `strict: true`, `noEmit: true`, `module` and `moduleResolution: "nodenext"`, `target: "esnext"`, `allowImportingTsExtensions: true`, `verbatimModuleSyntax: true`, `erasableSyntaxOnly: true`, `types: ["node"]`, `skipLibCheck: true`. `erasableSyntaxOnly` forbids enums and namespaces — the stage and gate enums are union types, matching the architecture's schema style. Every relative import must carry the explicit `.ts` extension (Node type stripping does not resolve extensionless specifiers).
  - Verify: `npm run typecheck`
  - Expected: exit 0 once `src/cli.ts` type-checks.

- [x] **Step 3: CLI stub**
  - Change: `src/cli.ts` parses `process.argv`, prints a usage line naming `migrate`, `new-run`, `stage-add`, `stage-complete`, and `verify-audit`, and exits 0. No store calls yet.
  - Verify: `node src/cli.ts`
  - Expected: usage text on stdout, exit 0.

**Task completion evidence:** `npm run typecheck` exits 0; `node src/cli.ts` prints usage.

### Task 2: Migrations and schema

**Depends on:** Task 1

**Files:**
- Create: `src/migrations/001_init.sql`
- Create: `src/migrate.ts`
- Create: `test/migrate.test.ts`
- Create: `test/schema.test.ts`

**Steps:**

- [x] **Step 1: `001_init.sql`**
  - Change: Create the three step-1 tables exactly as the architecture block names them, with SQL types and constraints:

    ```sql
    CREATE TABLE run (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project     TEXT NOT NULL,
      feature_id  TEXT NOT NULL,
      slug        TEXT NOT NULL,
      change_kind TEXT NOT NULL CHECK (change_kind IN ('feature', 'defect_fix')),
      status      TEXT NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'blocked', 'completed')),
      profile_ref TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE stage (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id         INTEGER NOT NULL REFERENCES run(id),
      kind           TEXT NOT NULL,
      ordinal        INTEGER NOT NULL,
      input_stage_id INTEGER REFERENCES stage(id),
      output_ref     TEXT,
      status         TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_progress', 'passed', 'blocked', 'failed')),
      gate_result    TEXT CHECK (gate_result IN ('pass', 'block')),
      started_at     TEXT,
      ended_at       TEXT,
      UNIQUE (run_id, ordinal)
    );

    CREATE TABLE audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id     INTEGER NOT NULL REFERENCES run(id),
      stage_id   INTEGER REFERENCES stage(id),
      actor      TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      action     TEXT NOT NULL,
      summary    TEXT NOT NULL,
      hash       TEXT NOT NULL,
      prev_hash  TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
    BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
    CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
    BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
    ```

    Append-only is enforced at the write path by triggers, not by convention (architecture section 16: "Corrections are new events, never edits"). Finish the file with `PRAGMA user_version = 1;`.
  - Verify: `npm run typecheck`
  - Expected: exit 0 (SQL file is not type-checked; this confirms no file-glob breakage).

- [x] **Step 2: `src/migrate.ts`**
  - Change: `applyMigrations(dbPath)`: ensure the parent directory exists (`fs.mkdirSync` recursive), open `node:sqlite` `DatabaseSync` at `dbPath`, set `PRAGMA foreign_keys = ON` and `PRAGMA busy_timeout = 5000`, read `PRAGMA user_version`, list `src/migrations/*.sql` in lexicographic order, and apply each file with index greater than the current `user_version`, wrapped in a transaction that ends by setting `user_version` to that index. Close the database.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: migration tests**
  - Change: `test/migrate.test.ts`: run `applyMigrations` against a temp directory (created per test via `fs.mkdtempSync`, removed in `afterEach`); assert `state.db` exists, `PRAGMA user_version` equals the file count, and a second run applies nothing (user_version unchanged).
  - Verify: `node --test test/migrate.test.ts`
  - Expected: all tests pass.

- [x] **Step 4: schema contract test**
  - Change: `test/schema.test.ts` reads `src/migrations/001_init.sql` and asserts, table by table, that every column the architecture's section 15 block declares for `run`, `stage`, and `audit` exists in the migration with a matching name — this is the "expected values come from the design document" test, so the column lists are parsed from `ARCHITECTURE.md`, not hand-copied. Also assert the migration defines `UNIQUE (run_id, ordinal)` on `stage` and the `audit` triggers. Assert the schema block contains all six tables (`run`, `stage`, `agent_run`, `finding`, `approval`, `audit`) and no `handoff` table.
  - Verify: `node --test test/schema.test.ts`
  - Expected: all tests pass.

- [x] **Step 5: prove the guard by breaking it**
  - Change: temporarily remove the `gate_result` CHECK line from the migration copy the test parses — point the test at a scratch copy of `001_init.sql` with the CHECK deleted.
  - Verify: `node --test test/schema.test.ts`
  - Expected: the test fails on the missing constraint; restore the file and re-run to green. Record the failure and restoration in the task evidence.

**Task completion evidence:** `npm test` green; the schema test fails when a constraint is removed from a scratch migration copy and passes again after restore.

### Task 3: Store core

**Depends on:** Task 2

**Files:**
- Create: `src/store.ts`
- Create: `test/store.test.ts`

**Steps:**

- [x] **Step 1: `src/store.ts` — open and close**
  - Change: `openStore(rootDir = process.cwd())` applies migrations (from `src/migrate.ts`) against `.governance/state.db` under `rootDir` and returns a typed `Store` wrapping the `DatabaseSync` connection with `PRAGMA foreign_keys = ON` and `PRAGMA busy_timeout = 5000`; `closeStore()` closes it. Every write helper runs through a bounded retry wrapper: on `SQLITE_BUSY`, retry up to three times with a 100 ms wait between attempts, then fail naming the operation — architecture section 19 requires the busy timeout plus a bounded retry. `run`/`stage`/`audit` status and enum shapes are TypeScript string-union types mirroring the SQL CHECK lists.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: run and stage writes**
  - Change: `insertRun(project, featureId, slug, changeKind)` sets `created_at`/`updated_at` from `new Date().toISOString()` and returns the row. `insertStage(runId, kind, inputStageId | null)` computes `ordinal` as the input stage's ordinal plus one (0 for the first stage) inside the same transaction, and refuses an `inputStageId` belonging to a different run with an error naming both runs. `setStageStatus(id, status, gateResult?)` applies the union types; `completeStage(id, outputRef, gateResult)` sets `status = 'passed'` when `gateResult` is `pass` and `'blocked'` when it is `block`, plus `ended_at`, `output_ref`, `gate_result`. `getStageChain(runId)` returns stages ordered by `ordinal`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 3: store tests**
  - Change: `test/store.test.ts` (each test creates a temp root via `fs.mkdtempSync` and passes it to `openStore`) covers: create a run (assert defaults and returned row); chain three stages by `inputStageId` and walk them in ordinal order; cross-run `inputStageId` is refused; a duplicate `(run_id, ordinal)` fails on the UNIQUE constraint; `setStageStatus` to a value outside the union fails its type check and a runtime check rejects an invalid string from an untyped source; `completeStage` persists `output_ref` and `gate_result`, and maps `gate_result = 'block'` to `status = 'blocked'`.
  - Verify: `node --test test/store.test.ts`
  - Expected: all tests pass.

- [x] **Step 4: prove the guard by breaking it**
  - Change: in a scratch copy of the store test data flow, bypass the ordinal computation (insert two stages with the same ordinal directly).
  - Verify: `node --test test/store.test.ts`
  - Expected: the UNIQUE constraint test catches it; restore and re-run to green.

**Task completion evidence:** `npm test` green; the ordinal guard test fails when the computation is bypassed and passes when restored.

### Task 4: Audit chain

**Depends on:** Task 3

**Files:**
- Create: `src/audit.ts`
- Create: `test/audit.test.ts`

**Steps:**

- [x] **Step 1: `src/audit.ts`**
  - Change: `appendAudit(store, { runId, stageId, actor, actorType, action, summary })` reads the most recent audit row (highest `id`), computes `hash = sha256(created_at + "\n" + actor + "\n" + actor_type + "\n" + action + "\n" + summary + "\n" + run_id + "\n" + stage_id + "\n" + prev_hash)` via `node:crypto` (hex digest, `prev_hash` empty for the first event), and inserts the row. The store exposes no UPDATE or DELETE on `audit`. `verifyAuditChain(store)` recomputes every hash in order and returns the first mismatching event (id, stored hash, recomputed hash) or `null` for a valid chain.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: audit tests**
  - Change: `test/audit.test.ts`: append three events and assert each `prev_hash` links to the previous `hash` and `verifyAuditChain` returns `null`; an empty chain verifies trivially; a tampered row (direct `UPDATE` via raw SQL inside the test, which the trigger refuses — assert the trigger error) plus a tampered `hash` value written by editing the row through a fresh connection with triggers temporarily dropped: `verifyAuditChain` returns that event's id. Also assert via a source scan of `src/audit.ts` and `src/store.ts` that no helper updates or deletes from `audit` — append-only is a code shape, not only a trigger.
  - Verify: `node --test test/audit.test.ts`
  - Expected: all tests pass, including the two tamper paths (trigger refusal and detection-after-bypass).

- [x] **Step 3: prove the guard by breaking it**
  - Change: temporarily alter the canonical hash string in `src/audit.ts` (drop one field).
  - Verify: `node --test test/audit.test.ts`
  - Expected: chain verification fails on the first event; restore the field and re-run to green.

**Task completion evidence:** `npm test` green; verification catches a modified canonicalization and a tampered row.

### Task 5: CLI and repository lock

**Depends on:** Tasks 3 and 4

**Files:**
- Create: `src/lock.ts`
- Create: `test/lock.test.ts`
- Modify: `src/cli.ts` — real commands
- Create: `test/cli.test.ts`

**Steps:**

- [x] **Step 1: `src/lock.ts`**
  - Change: `acquireLock()` creates `.governance/` and takes `.governance/lock` with `fs.openSync(path, "wx")`, writing `pid` and `created_at` into it. If the file exists: read the pid; `process.kill(pid, 0)` determines liveness; a live pid fails fast with `another invocation (pid <pid>) holds the lock at <path>` and exit code 1; a dead pid is stale — remove the file and take the lock. `releaseLock()` unlinks the file. The lock is held for every `bw` command, before migrations apply.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: lock tests**
  - Change: `test/lock.test.ts`: acquiring twice fails fast with the diagnostic naming the holder pid; releasing allows re-acquire; a stale lock file containing a dead pid (use a pid unlikely to exist, verified by `process.kill(pid, 0)` throwing `ESRCH`) is taken over.
  - Verify: `node --test test/lock.test.ts`
  - Expected: all tests pass.

- [x] **Step 3: CLI commands**
  - Change: `src/cli.ts` dispatches: `migrate` (applies migrations and exits 0), `new-run --project <p> --feature <f> --slug <s> --change-kind <k>` (prints the new run id), `stage-add --run <id> --kind <k> [--input <stage-id>]` (prints the new stage id), `stage-complete --id <id> --output <ref> [--gate-result pass|block]`, `verify-audit` (exit 0 and `chain valid` on success; exit 1 and `broken at audit <id>: stored <a> recomputed <b>` on failure — the chain is global, so verification always covers the whole chain; there is no per-run filter). Every command acquires the lock, applies migrations, runs, and releases the lock. Unknown commands print usage and exit 2. Invalid `changeKind` or `gate-result` values print the operator-visible message naming the allowed values (hazard 1 style) and exit 2.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 4: CLI end-to-end tests**
  - Change: `test/cli.test.ts` spawns `node src/cli.ts <command>` with `cwd` set to a fresh temp directory (so `.governance/` is per-test). Cover: `migrate` creates `.governance/state.db`; `new-run` + three `stage-add` calls + `stage-complete` produce a walkable chain via `verify-audit`-adjacent store reads; `verify-audit` reports `chain valid` for an empty database; a second concurrent `migrate` while a lock is held (test takes the lock first) exits 1 with the pid diagnostic; an invalid `--change-kind` prints the named cause and exits 2.
  - Verify: `node --test test/cli.test.ts`
  - Expected: all tests pass.

**Task completion evidence:** `npm test` green; `node src/cli.ts new-run --project p --feature f --slug s --change-kind feature` prints a run id and `.governance/state.db` appears.

### Task 6: Documentation checker and project skill

**Depends on:** Task 2 (parses the migration files)

**Files:**
- Create: `scripts/doc-check.mjs`
- Create: `.claude/skills/doc-check/SKILL.md`

**Steps:**

- [x] **Step 1: checker script**
  - Change: `scripts/doc-check.mjs` (plain Node, no dependencies) reads `ARCHITECTURE.md` and `src/migrations/*.sql` and asserts:
    1. **Stage sequence:** the section 5 code fence, split on `->` and whitespace, yields exactly `spec, spec_review, awaiting_approval, plan, plan_review, implementation, verification, delivery_check, completed` in order, and the deferred list names exactly `task_decomposition, test_authoring, code_review, documentation, final_verification, pr_summary`.
    2. **Schema block:** the section 15 sql fence defines exactly the six tables `run, stage, agent_run, finding, approval, audit` and contains no `handoff` table (regression guard for the reconciled fold).
    3. **Schema vs migrations:** every column of `run`, `stage`, and `audit` in the architecture block exists in `001_init.sql` (the same check as `test/schema.test.ts`, run independently).
    4. **Migration location:** the `.governance/` layout fence lists `state.db`, `raw/`, `content/`, and `profiles/` and does **not** list `migrations/`; the section 15 prose states migrations are committed with the system source. This assertion fails against the current document — expected until task 7.
    5. **Protected paths:** the section 7 list includes `governed.yaml`.
    Each failure prints one line naming the fact and the expected and found values; exit 1 on any failure.
  - Verify: `npm run check:docs`
  - Expected: **exits 1**, with exactly the migration-location failure named. This proves the checker catches real drift before the document is fixed.

- [x] **Step 2: project skill**
  - Change: `.claude/skills/doc-check/SKILL.md` with frontmatter `name: doc-check` and `description: Verify ARCHITECTURE.md facts against the source (schema, stage sequence, paths). Run before claiming a documentation change is consistent.` Instructions: verify `node --version` resolves in the current environment first (hazard 9 — report a PATH problem, not a checker failure, if it does not), run `node scripts/doc-check.mjs` from the repository root, and report pass or each failing line verbatim.
  - Verify: `npm run check:docs` still exits 1 on the known failing assertion
  - Expected: the skill file exists and the checker behavior is unchanged.

**Task completion evidence:** the checker exits 1 with the migration-location finding named; the skill wrapper exists.

### Task 7: Document fixes and green checker

**Depends on:** Task 6

**Files:**
- Modify: `ARCHITECTURE.md` — migration location
- Modify: `CLAUDE.md` — commands section
- Modify: `README.md` — status

**Steps:**

- [x] **Step 1: fix the migration location in `ARCHITECTURE.md`**
  - Change: remove `migrations/ ordered .sql files, applied at startup` from the `.governance/` layout block; add to the "What is git-tracked and what is not" paragraph that migrations are committed with the system source (`src/migrations/`) and applied at startup; adjust the "Migrations are ordered plain SQL, applied at startup" sentence to say where they live. Change nothing else — the document is reconciled.
  - Verify: `npm run check:docs`
  - Expected: exit 0.

- [x] **Step 2: record the commands in `CLAUDE.md`**
  - Change: replace the `## Commands` placeholder ("Nothing is built yet…") with: `npm install` (one-time), `npm run typecheck`, `npm test`, `npm run check:docs`, `node src/cli.ts migrate|new-run|stage-add|stage-complete|verify-audit`, and the note that `bw` is available once `npm install` links the bin. Commands live here and nowhere else.
  - Verify: `npm run check:docs`
  - Expected: exit 0 (CLAUDE.md is outside the checker's scope; this verifies no interference).

- [x] **Step 3: update `README.md`**
  - Change: retitle the README from "Governed Delivery" to "BuildWorks" with a line noting the system name is configuration (default BuildWorks); update the "Status" section from "Nothing is built yet" to name step 1 of the build order as implemented (run store, stage chain, audit chain, documentation checker) and point at `CLAUDE.md` for commands.
  - Verify: `npm run check:docs`
  - Expected: exit 0.

- [x] **Step 4: completion gate**
  - Change: none.
  - Verify: `npm ci && npm run typecheck && npm test && npm run check:docs`
  - Expected: all four exit 0 from a clean install.

**Task completion evidence:** `npm run check:docs` exits 0; the completion gate passes from a clean checkout.

---

## Implementation note

**Shipped (2026-08-29):** run store, stage chain, and audit chain over SQLite
(`node:sqlite`), the `bw` CLI (migrate, new-run, stage-add, stage-complete,
verify-audit), the repository lock with stale takeover, and the documentation
checker wired as the `doc-check` project skill. Completion gate green from a
clean install: typecheck, 36/36 tests, checker.

**Deviations from the plan:**

- The migrations directory anchors to the module location (`import.meta.url`),
  not the working directory — the CLI tests spawn from temp directories, and
  cwd-relative migration paths broke there.
- `stage-complete` requires `--gate-result` instead of defaulting to `pass`:
  a gate that defaults to pass fails open, which contradicts the design's
  fail-closed stance.
- The CLI appends one audit event per mutation (run.create, stage.add,
  stage.complete), so `verify-audit` exercises a populated chain rather than
  a vacuous empty one.

**Code review:** one independent pass (6 finder angles, 15 consolidated
findings). All 15 reconciled: flag-value consumption, silent missing-id
no-ops, numeric id validation, transactional audit appends, lock
ownership-token release and race-safe takeover, migration filename and
`user_version` enforcement, single shared canonicalization, conditional
`gate_result` updates, and two doc-checker defects. The pid-reuse wedge gets
a held-since diagnostic; age-based auto-takeover was rejected as unsafe for
legitimate long holders.

**Deferred:** none within step 1 scope. The busy-retry wrapper and foreign-key
refusals have no dedicated break-it tests yet — add them when the suite's
break-it sweep next runs.
