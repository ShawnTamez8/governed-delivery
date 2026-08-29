# Hazards

Failure modes a governed delivery system is subject to, and what each requires.
These are requirements, not advice. Read the relevant entry before implementing
that area.

---

## 1. Model output arrives in shapes the schema refuses

The largest defect class, and it is invisible to a suite whose fixtures emit
conforming bytes.

Every parser that reads model output accepts or explicitly refuses each of:

1. bare JSON
2. a single ` ```json ` fence
3. prose before the fence, e.g. `Now I'll return the reconciliation:`
4. prose after the fence
5. two fenced blocks
6. a fenced block that is not JSON
7. CRLF line endings inside the fence

**Choose strictness by consequence.** Where bytes are canonicalized into an
immutable record, refuse prose outside the fence: dropping it silently corrupts
the record. Where the result is only schema-validated, tolerate one fenced block
anywhere in the body and refuse rather than guess when several are present.

Assert the operator-visible message on every refusal, not merely that an error
was thrown. A message that does not name the cause makes the failure
undiagnosable from logs alone.

## 2. Discarded output is undiagnosable

A rejected response whose bytes were discarded leaves only a truncated fragment
inside an error message.

Write raw model output to disk before validation and reference it from the run
record. It is also the only honest source of fixtures — see hazard 4.

## 3. A constrained field must have its constraint stated in the prompt

A field validated against a pattern the prompt never mentions will be returned
in the wrong shape and rejected wholesale, after the invocation is paid for.

Where the field feeds an identity — a finding ID derived from an intent key, for
example — it cannot be repaired downstream, because normalising it changes the
identity. The prompt is the only correct place.

Write a test that reads every prompt-building file and fails when a constrained
field is requested without its shape stated, and assert that every example value
a prompt advertises validates against the schema that receives it.

## 4. Fixtures and code agreeing while both are wrong

A hand-written fixture that declares one thing and does another will pass
forever. A suite can complete full delivery runs to a terminal state while
delivering nothing, because the fixture's declared artifacts and its written
artifacts are never compared.

- No hand-written fixture defines correctness. Expected values come from a
  schema, a response recorded from a real run, or the design document.
- Validate what shared fixtures emit against the same contract real output is
  held to.
- Prove a guard by breaking what it guards and confirming the failure, then
  restoring. A test that has never failed has demonstrated nothing.

## 5. Completion without delivery

Scope enforcement answers "may this stage write here". It does not answer "did
anyone write it at all". Without the second check, a run can route work to a
later stage, have that stage mark it complete, and reach a terminal state having
written nothing the specification declared.

Before a run may complete, every declared artifact must appear in the changed
paths of an applied patch.

## 6. Promises a later stage cannot keep

If a criterion's artifacts are produced by a stage that runs after the stage
being planned, coverage cannot be promised for it now: at reconciliation time
the artifact does not exist, and the only way to satisfy the promise is a false
attestation. Refusing the downgrade later strands the run with no in-place
repair.

Refuse the unkeepable promise at the planning gate.

## 7. Retries that vary nothing

A retry that resends an identical prompt receives identical output. If a retry
does not vary the prompt, the context, or the model, it is not a retry — it is a
slower failure with a larger bill.

## 8. Windows executable resolution

Node's spawn hardening breaks npm-shimmed executables, which kills every
external executor on Windows. Use a spawn wrapper that handles shim resolution
and keep a regression test that spawns a shimmed binary.

## 9. Unverified hook interpreters

A hook installed as bare `node` fails when the harness process does not have the
interpreter on its PATH, and the visible symptom is usually a missing context
variable rather than a PATH error — which misdirects debugging onto the
protocol.

If setup installs anything that spawns an interpreter, verify at setup time that
the interpreter resolves in the environment that will spawn it.

## 10. Exact-match model acceptance against moving aliases

Validating an effective model against a literal list authored at initialisation
time breaks whenever a routed alias is remapped, and the check runs after tokens
are spent.

Resolve aliases at run start and snapshot the resolution.

## 11. A default installation that cannot complete a run

Agents bound to mock-backed executors are correctly rejected by governed stages,
and a capability required by a late stage may be declared only by a mock
executor. The result is a fresh install that cannot complete a run at all.

A default-seeded repository must be able to complete a run, and a test asserts
it.

## 12. Configuration divergence between targets

Two repositories with different settings behave as different products — one can
start a run from a given surface and the other cannot, with an error describing
a protocol requirement rather than a setting. The difference is then diagnosed
as a regression.

Make the effective configuration visible in status output, and make the
default-seeded repository the tested case.

## 13. Specifications inventing obligations

Specification authoring adds requirements the source never stated: constraints
the brief never mentioned, implementation technologies pushed into acceptance
criteria, requirements with no traceable origin. Removing one does not stop the
pattern; the same requirement reappears embedded in another criterion.

Require every criterion to trace to a stated obligation, mark derived ones, and
surface invented ones to a human rather than relying on review to catch them.

## 14. Independence that cannot be proven

When reviewers run as subagents inside the same harness session that authored
the work, independence cannot be verified from outside — the system is taking
the harness's word for it.

Record the distinction rather than claiming the guarantee:
`unverified_self_attestation` against `configured_standalone` for a separately
spawned process.
