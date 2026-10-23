# Served browser pages - code review

**Reviewed change:** the uncommitted build of `plan.md` on `sandboxed-delivery`, after commit `12619c8`
**Review type:** Independent code review (a separately dispatched reviewer agent, given the code and the plan's contract, not the author's conclusions)
**Review date:** 2026-10-22
**Status:** reconciled

**Hazards considered:** 2 (the server must print nothing into the report log), 4 (whether the tests' expected values come from the stated contract and would fail on the defect), 15 (path containment of a server reading the worktree), and 18 (whether a false confirmation is still reachable). The rest bear on nothing the change touches.

---

## Summary

The reviewer found no material defect. Path containment, method and refusal handling, the error paths and the prompt changes held up under probing: a copy of `serve.mjs` with only its filesystem import shimmed, raw TCP requests, and direct calls of `resolveUnder`. The reviewer ran no engine test. It reported two low-severity code defects, two low-severity test gaps, one trivial contract deviation and one document overstatement. None reaches a false gate outcome.

## Findings

1. **`container/serve.mjs`: a path beginning with two slashes produces a protocol-relative redirect (low, verified by probe).** The `Location` header was the raw path with `/` appended, so `GET //src`, where `/work/src` is a directory, answered `301` with `Location: //src/`, which a browser resolves to `http://src/`. It is reachable only by a URL built by concatenation, and the result is a navigation failure, not a false pass.

2. **`container/serve.mjs` with both `webServer` blocks: a runner killed at the command ceiling leaves the page server holding port 47731 (low, not verified on the engine).** `timeout --signal=KILL` (`src/container.ts`) kills only the Playwright process, so its teardown never stops the server. In a dispatch container shared by every `run_command` call (`src/tool-server.ts`), every later runner invocation in that dispatch would then refuse with "is already used". The tool server also does not serialize calls, so two concurrent `run_command` runner calls would collide; whether the CLI issues them is unknown. Gates fail closed: reproductions and preserved checks each run alone in their own sandbox, and in `verifyCommit` the acceptance command is last.

3. **`test/acceptance-engine.test.ts`, the contract test: two checks could not fail on the defect they guard (low).** The `HEAD` case did not compare `Content-Length`, so a `HEAD` answering `Content-Length: 0` would pass. The engine case `GET /%2e%2e/etc/passwd` is refused even without decoding, because `/work/%2e%2e/etc/passwd` does not exist; only the host test guards decoding.

4. **`container/serve.mjs`: a malformed request gets a response (trivial, verified).** Node's default `clientError` handling answers `400 Bad Request` instead of closing the socket, which the plan's contract forbids. Chromium never sends such a request.

5. **`docs/hazards.md` entry 18: one sentence overstated the evidence.** "A failed start appears only as Playwright's top-level report error" generalizes from the one measured case, a taken port.

---

## Reconciliation

**Date:** 2026-10-22
**Disposition:** 4 accepted, 0 rejected, 1 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted - Finding 1, protocol-relative redirect:** the redirect now builds `Location` from the path with its leading slashes collapsed to one. The contract test asks `GET //sub` and expects `Location: /sub/`. With the old construction restored, that test fails.
- **Deferred - Finding 2, a killed runner can leave the port held:** this is a residual of the plan's fixed-port design, not a defect in the code as planned. Fixing it changes that design (a per-invocation port, or a server tied to its runner's lifetime), and no gate outcome is affected. Hazard 18's remedy paragraph now names it as unverified. The trigger is the operator's decision to fix it, or an observed "is already used" error in a dispatch's retained command log.
- **Accepted - Finding 3, contract-test gaps:** the probe now records `Content-Length`, and every case compares it, `HEAD` included. With `HEAD` changed to send `Content-Length: 0`, the test fails. The encoded traversal now targets `/%2e%2e/tmp/bw-outside/secret.txt`, a file the probe writes and reads first, so a refusal cannot come from a missing file. A break-test that checks containment on the raw path still passes on the engine, because the real-path check refuses the decoded escape on its own. So the engine case guards the two layers together, and `test/serve.test.ts` stays the only test of the lexical layer alone, which it failed under the same mutation.
- **Accepted - Finding 4, malformed request answered 400:** the server's `clientError` handler destroys the socket. The contract test sends a request line Node cannot parse and expects no bytes back. With the handler removed, the test fails.
- **Accepted - Finding 5, hazard overstatement:** the sentence now says the one failed start measured, a taken port, appeared only as Playwright's top-level report error.
