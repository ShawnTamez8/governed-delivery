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

## 15. A declared sandbox and a compliant sample do not make a proposal subprocess read-only

The first end-to-end run of `bw implement` against the real harness blocked
with `add requires the file not to exist: src/clamp.mjs`: the implementer had
written the two files into the run's worktree with its own tools and then
returned them as `add` patches. The gate's existence check is correct; the
prompt and one earlier compliant smoke are not evidence that the process is
read-only — the same prompt and model wrote the files on one run and did not
on another.

Require proposal subprocesses to run read-only at the invocation boundary
(restricted mode, an explicit read-only tool inventory, no session
persistence) and have the stage assert the worktree is clean before and
after the dispatch, blocking the run and naming the paths when anything
changed. A prompt-level instruction is a request; the tree is checked, not
trusted.

## 16. A remediation loop aimed at the wrong artifact cannot repair an upstream omission

A reviewer's finding is sometimes correct about a concern the artifact under
review cannot itself fix, because the missing decision sits upstream of it.
Routing that finding back to the same author for another revision round asks
the author to correct a document that has nothing wrong with it, and the
author can only comply by inventing something to change. Two observations,
not a rate: the plan-stage smoke's 2026-08-30 round-2 finding caught the plan
inventing a rejection requirement the specification never stated, and step
5b's Task 1 prototype recorded an author responding to a security finding by
adding an acceptance criterion — a "single atomic exclusive-create
operation" — that the design never stated, marking the finding `addressed`,
and the artifact gate passed. No run record in this repository describes a
complete wrong-artifact remediation loop end to end;
both are observations of this pattern's precursor, and this entry says so
rather than implying a filed incident that never happened.

Require every added or replaced normative node a reconciliation introduces to
be claimed by exactly one decision and grounded in an excerpt from the
governing upstream input. A decision that claims a node with a duplicated or
ungrounded citation converts to a blocking `cannot_determine`; a node no
decision claims at all — Task 1's actual retained case, replayed against the
shipped validator on 2026-09-03 — is never silently accepted as `addressed`
either, but surfaces as unclaimed and blocks the whole round rather than
converting one decision, because no decision exists to convert. Either path
gives a genuinely upstream concern a route other than another revision of the
wrong artifact. This mitigation proves textual occurrence — that the cited
words are in the governing input, in that order — never that they logically
support what was added or rejected; neither the grounding match nor the
mechanical artifact gates are evidence of semantic correctness, and no panel
independently confirms either.

## 17. A reconciliation that answers a finding by deleting the obligation

The normative-delta check derives additions only. `deriveAddedNormativeNodes`
counts the after-set up and the before-set down and emits the positive
remainder, so a node present before reconciliation and absent after produces
nothing at all: no decision has to claim it, no excerpt has to ground it, and
the unclaimed-node block never fires. This is the design's shape rather than a
divergence from it — `ARCHITECTURE.md` section 12 specifies that "every added
node ... must be claimed exactly once", and says nothing about a removed one.

The consequence is that an `addressed` decision can discharge a reviewer's
finding by deleting the acceptance criterion the finding was about. Every check
is satisfied: the canonical finding carries exactly one typed decision, nothing
was added so nothing requires grounding, the revised document still passes its
mechanical gates, and the artifact hash changes exactly as a legitimate revision
would. Because spec reconciliation runs before the approval gate, the operator
then signs a specification with the obligation already removed, and the hash
binding that protects every later stage binds the weakened text. Deletion is the
cheapest way to make a finding go away, and it is the one revision the delta
check cannot see.

This entry is a code-path gap found by reading, not a filed incident. Nothing
here describes a run that did this, and the entry says so rather than implying
evidence that does not exist. What makes it worth recording before it is
observed is that it would be invisible if it happened: the mechanism that would
catch it does not exist, so no run record could report it, and absence of a
report is therefore not evidence of absence.

Require the normative delta to account for removals as well as additions. A node
present before reconciliation and absent after must be claimed by exactly one
decision whose disposition permits removal, grounded in the governing input like
any addition. Where an obligation really is wrong, the routes that already exist
are the honest answers — a grounded rejection, or an upstream disposition
carrying a proposal candidate. Silent deletion is not one of them.
