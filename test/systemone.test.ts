import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  askSystemOne,
  readSystemOneConfig,
  readSystemOneKey,
  validateSystemOneResponse,
  type SystemOneConfig,
  type SystemOneRequest,
} from "../src/systemone.ts";

/**
 * The client against the recorded probe of the operator's Foundry resource
 * (`docs/features/decision-1-d6-evaluation/plan.md`, Tasks 3 and 4). Every
 * request shape, status and body below comes from
 * `test/fixtures/recorded/systemone-probe-snitch-resource.json`, never from a
 * literal written here.
 */
interface ProbeRecord {
  label: string;
  status: number;
  request: { model: string } & SystemOneRequest;
  requestIdHeaders: Record<string, string>;
  body: unknown;
}
const PROBE = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "systemone-probe-snitch-resource.json"), "utf8")
) as { provenance: { endpoint: string; deployment: string; deploymentType: string; authHeader: string }; records: ProbeRecord[] };

function record(label: string): ProbeRecord {
  const found = PROBE.records.find((r) => r.label === label);
  assert.ok(found, `the probe fixture has no ${label} record`);
  return found;
}

function requestOf(r: ProbeRecord): SystemOneRequest {
  const { model: _model, ...rest } = r.request;
  return rest;
}

const ENV = {
  SYSTEMONE_ENDPOINT: PROBE.provenance.endpoint,
  SYSTEMONE_DEPLOYMENT: PROBE.provenance.deployment,
  SYSTEMONE_DEPLOYMENT_TYPE: PROBE.provenance.deploymentType,
};
const KEY = "k-test-secret";

// ---- configuration --------------------------------------------------------------

test("readSystemOneConfig returns the recorded probe's three values", () => {
  const read = readSystemOneConfig(ENV);
  assert.deepEqual(read, {
    ok: true,
    value: {
      endpoint: PROBE.provenance.endpoint,
      deployment: PROBE.provenance.deployment,
      deploymentType: PROBE.provenance.deploymentType,
    },
  });
});

for (const name of ["SYSTEMONE_ENDPOINT", "SYSTEMONE_DEPLOYMENT", "SYSTEMONE_DEPLOYMENT_TYPE"]) {
  test(`readSystemOneConfig refuses an unset or blank ${name}`, () => {
    assert.deepEqual(readSystemOneConfig({ ...ENV, [name]: undefined }), { ok: false, reason: `${name} is not set` });
    assert.deepEqual(readSystemOneConfig({ ...ENV, [name]: "  " }), { ok: false, reason: `${name} is not set` });
  });
}

test("readSystemOneConfig refuses an endpoint that is not an absolute https URL", () => {
  const reason = "SYSTEMONE_ENDPOINT must be an absolute https URL";
  const http = PROBE.provenance.endpoint.replace(/^https:/, "http:");
  assert.notEqual(http, PROBE.provenance.endpoint);
  assert.deepEqual(readSystemOneConfig({ ...ENV, SYSTEMONE_ENDPOINT: http }), { ok: false, reason });
  assert.deepEqual(readSystemOneConfig({ ...ENV, SYSTEMONE_ENDPOINT: "/providers/microsoft/v1/systemone" }), { ok: false, reason });
  const path = new URL(PROBE.provenance.endpoint).pathname;
  assert.deepEqual(readSystemOneConfig({ ...ENV, SYSTEMONE_ENDPOINT: `http://example.com${path}` }), { ok: false, reason });
  assert.deepEqual(readSystemOneConfig({ ...ENV, SYSTEMONE_ENDPOINT: `http://127.0.0.1.example.com${path}` }), { ok: false, reason });
});

test("readSystemOneConfig accepts plain http only on a loopback host, where the key never leaves the machine", () => {
  const path = new URL(PROBE.provenance.endpoint).pathname;
  for (const host of ["127.0.0.1:8080", "[::1]:8080", "localhost:8080"]) {
    const endpoint = `http://${host}${path}`;
    const read = readSystemOneConfig({ ...ENV, SYSTEMONE_ENDPOINT: endpoint });
    assert.equal(read.ok && read.value.endpoint, endpoint, host);
  }
});

test("readSystemOneConfig records any deployment type as given, judging it against no vendor list", () => {
  const read = readSystemOneConfig({ ...ENV, SYSTEMONE_DEPLOYMENT_TYPE: "Standard" });
  assert.equal(read.ok && read.value.deploymentType, "Standard");
});

test("readSystemOneKey refuses an unset key and a key fetch cannot send, naming no value", () => {
  assert.deepEqual(readSystemOneKey({ OTHER: KEY }), { ok: false, reason: "SYSTEMONE_API_KEY is not set" });
  for (const bad of ["\u0016", `${KEY}\n`, `a ${KEY}`, `${KEY}é`]) {
    const read = readSystemOneKey({ SYSTEMONE_API_KEY: bad });
    assert.equal(read.ok, false, JSON.stringify(bad));
    assert.ok(!JSON.stringify(read).includes(KEY), "the reason quotes the key");
  }
  assert.deepEqual(readSystemOneKey({ SYSTEMONE_API_KEY: KEY }), { ok: true, value: KEY });
});

// ---- validation -----------------------------------------------------------------

test("the recorded success bodies validate against their recorded requests", () => {
  for (const label of ["sky-api-key", "many-options"]) {
    const r = record(label);
    assert.equal(r.status, 200);
    assert.deepEqual(validateSystemOneResponse(r.body, requestOf(r)), [], label);
  }
  assert.equal(Object.keys(requestOf(record("many-options")).questions.pick!.criteria).length, 100);
});

test("validateSystemOneResponse names each mutation of a recorded body", () => {
  const r = record("sky-api-key");
  const request = requestOf(r);
  const mutate = (change: (body: any) => void) => {
    const body = structuredClone(r.body) as any;
    change(body);
    return validateSystemOneResponse(body, request);
  };
  const [name] = Object.keys(request.questions);
  assert.deepEqual(mutate((b) => delete b.answers[name!]), [`question ${name} has no answer`]);
  assert.deepEqual(mutate((b) => (b.answers.extra = b.answers[name!])), ["answer extra was not asked"]);
  assert.deepEqual(mutate((b) => (b.answers[name!].choice = "purple")), [
    `answer ${name} chose "purple", which is not an option`,
  ]);
  const halved = mutate((b) => {
    for (const option of Object.keys(b.answers[name!].probabilities)) b.answers[name!].probabilities[option] /= 2;
  });
  assert.equal(halved.length, 1);
  const sum = Number(new RegExp(`^answer ${name} probabilities sum to (.+)$`).exec(halved[0]!)?.[1]);
  assert.ok(Math.abs(sum - 0.5) < 1e-9, halved[0]);
  assert.deepEqual(mutate((b) => delete b.model), ["the response names no model"]);
  assert.deepEqual(mutate((b) => delete b.usage), ["the response reports no input_tokens usage"]);
  assert.deepEqual(validateSystemOneResponse([], request), ["the response is not a JSON object"]);
});

// ---- the request ----------------------------------------------------------------

interface Seen {
  headers: IncomingMessage["headers"];
  body: any;
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (config: SystemOneConfig, seen: Seen[]) => Promise<void>
) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: JSON.parse(raw) });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  // http on loopback, built directly: the https rule belongs to readSystemOneConfig.
  const config: SystemOneConfig = {
    endpoint: `http://127.0.0.1:${port}/providers/microsoft/v1/systemone`,
    deployment: PROBE.provenance.deployment,
    deploymentType: "DataZoneStandard",
  };
  try {
    await run(config, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function replay(r: ProbeRecord) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(r.status, { "Content-Type": "application/json", ...r.requestIdHeaders });
    res.end(JSON.stringify(r.body));
  };
}

test("askSystemOne sends the recorded shape and accepts the recorded answer", async () => {
  const r = record("sky-api-key");
  assert.equal(PROBE.provenance.authHeader, "api-key");
  await withServer(replay(r), async (config, seen) => {
    const outcome = await askSystemOne(config, KEY, requestOf(r));
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok) return;
    assert.deepEqual(outcome.response, r.body);
    assert.equal(outcome.text, JSON.stringify(r.body), "the body as received, for retention");
    assert.deepEqual(outcome.requestIds, r.requestIdHeaders);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.headers["api-key"], KEY);
    assert.equal(seen[0]!.headers.authorization, undefined);
    assert.deepEqual(seen[0]!.body, r.request);
  });
});

test("askSystemOne fails closed on the recorded 401 and 404, with no retry", async () => {
  for (const [label, reason] of [
    ["invalid-key", "HTTP 401"],
    ["unknown-deployment", "HTTP 404 DeploymentNotFound"],
  ] as const) {
    const r = record(label);
    await withServer(replay(r), async (config, seen) => {
      const outcome = await askSystemOne(config, KEY, requestOf(record("sky-api-key")));
      assert.deepEqual(
        { ok: outcome.ok, status: outcome.status, reason: outcome.ok ? null : outcome.reason },
        { ok: false, status: r.status, reason }
      );
      assert.equal(seen.length, 1, "one request, no retry");
    });
  }
});

test("askSystemOne never returns the key, even when a server echoes it", async () => {
  const echo = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: String(req.headers["api-key"]), message: `bad ${req.headers["api-key"]}` } }));
  };
  await withServer(echo, async (config) => {
    const outcome = await askSystemOne(config, KEY, requestOf(record("sky-api-key")));
    assert.equal(outcome.ok, false);
    assert.ok(!JSON.stringify(outcome).includes(KEY), JSON.stringify(outcome));
  });
});

test("askSystemOne reports a body that is not JSON, and a recorded body that fails validation", async () => {
  await withServer((_req, res) => res.end("<html>"), async (config) => {
    const outcome = await askSystemOne(config, KEY, requestOf(record("sky-api-key")));
    assert.deepEqual(outcome.ok ? null : outcome.reason, "the response body is not JSON");
  });
  // The 100-option answer does not answer the sky question.
  await withServer(replay(record("many-options")), async (config) => {
    const outcome = await askSystemOne(config, KEY, requestOf(record("sky-api-key")));
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.reason, /^the response failed validation: answer pick was not asked/);
  });
});

test("askSystemOne reports a dropped connection and a timeout", async () => {
  await withServer((req) => req.socket.destroy(), async (config) => {
    const outcome = await askSystemOne(config, KEY, requestOf(record("sky-api-key")));
    assert.equal(outcome.status, null);
    assert.match(outcome.ok ? "" : outcome.reason, /^TypeError: fetch failed/);
  });
  await withServer(() => {}, async (config) => {
    const outcome = await askSystemOne(config, KEY, requestOf(record("sky-api-key")), 200);
    const { durationMs, ...rest } = outcome;
    assert.deepEqual(rest, { ok: false, status: null, reason: "timed out after 200 ms", body: null });
    assert.ok(durationMs >= 200, `waited ${durationMs} ms`);
  });
});
