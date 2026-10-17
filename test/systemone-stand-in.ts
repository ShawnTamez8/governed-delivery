import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

/**
 * A loopback stand-in for the operator's Decision-1 deployment, for tests that
 * run the narration check (`docs/features/narration-check-spec-review/plan.md`).
 * Every answer body it sends is one Decision-1 returned on 2026-10-17
 * (`test/fixtures/recorded/systemone-format-checks-evaluation.json`), never
 * written here (hard rule 5). The deployment is the probe's. It counts every
 * request, so a test can prove what reached it and that nothing else did.
 */

const RECORDED = join(process.cwd(), "test", "fixtures", "recorded");
const EVALUATION = JSON.parse(readFileSync(join(RECORDED, "systemone-format-checks-evaluation.json"), "utf8")) as {
  responses: Array<{ label: string; body: { answers: Record<string, { choice: string }> } }>;
};
const PROBE = JSON.parse(readFileSync(join(RECORDED, "systemone-probe-snitch-resource.json"), "utf8")).provenance as {
  endpoint: string;
  deployment: string;
  deploymentType: string;
};

function recorded(label: string): string {
  const response = EVALUATION.responses.find((r) => r.label === label);
  if (response === undefined) throw new Error(`the evaluation fixture has no response ${label}`);
  return JSON.stringify(response.body);
}

/** AC-022 of the numbering-note spec: `contains-remark` at 0.980. */
export const RECORDED_REMARK = recorded("narration-N-wc-numbering-L049");
/** The first criterion of crew-chatter run 6's approved spec: `criterion` at 0.994. */
export const RECORDED_CRITERION = recorded("narration-N-cc-run-6-L117");

export interface StandInReply {
  status: number;
  body: string;
}

/** What the stand-in sends for one request; `hang` never answers, for the timeout path. */
export type StandInAnswer = (entry: string, index: number) => StandInReply | "hang";

export interface StandInRequest {
  headers: IncomingMessage["headers"];
  body: { model: string; state: string; questions: Record<string, unknown> };
}

export interface StandIn {
  /** The four variables `new-run` and the spec stage read. */
  env: Record<string, string>;
  key: string;
  requests: StandInRequest[];
  close(): Promise<void>;
}

/** Every entry is a criterion, unless the test says otherwise. */
export const ALWAYS_CRITERION: StandInAnswer = () => ({ status: 200, body: RECORDED_CRITERION });

export async function startStandIn(answer: StandInAnswer = ALWAYS_CRITERION): Promise<StandIn> {
  const requests: StandInRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as StandInRequest["body"];
      requests.push({ headers: req.headers, body });
      const entry = /\nEntry: (.*)$/s.exec(body.state)?.[1] ?? "";
      const reply = answer(entry, requests.length - 1);
      if (reply === "hang") return;
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const key = "k-stand-in-not-a-real-key";
  return {
    env: {
      SYSTEMONE_ENDPOINT: `http://127.0.0.1:${port}${new URL(PROBE.endpoint).pathname}`,
      SYSTEMONE_DEPLOYMENT: PROBE.deployment,
      SYSTEMONE_DEPLOYMENT_TYPE: PROBE.deploymentType,
      SYSTEMONE_API_KEY: key,
    },
    key,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Run `fn` with the stand-in's variables in `process.env`, restoring whatever
 * was there before, so a test never reaches the operator's real deployment.
 */
export async function withStandIn<T>(answer: StandInAnswer, fn: (standIn: StandIn) => Promise<T>): Promise<T> {
  const standIn = await startStandIn(answer);
  const before = Object.fromEntries(Object.keys(standIn.env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, standIn.env);
  try {
    return await fn(standIn);
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await standIn.close();
  }
}
