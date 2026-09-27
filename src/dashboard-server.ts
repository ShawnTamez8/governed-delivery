import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { readApprovalRequest, submitApproval } from "./dashboard-approval.ts";
import type { DashboardRepository } from "./dashboard-config.ts";
import { readRunsResult, readStatusResult } from "./operator-read.ts";

const HOST = "127.0.0.1";
/** The one route that accepts a write (architecture section 23, 2026-09-26). */
const APPROVAL_ROUTE = /^\/api\/repositories\/([A-Za-z0-9_-]+)\/runs\/(\d+)\/approval$/;
/** An expiry and a 64-byte signature in base64 fit many times over. */
const APPROVAL_BODY_MAX_BYTES = 8192;
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

interface RepositoryEntry extends DashboardRepository {
  id: string;
}

export interface DashboardServer {
  bootstrapUrl: string;
  origin: string;
  host: string;
  close(): Promise<void>;
}

interface ShutdownSignals {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export function waitForDashboardShutdown(
  server: DashboardServer,
  signals: ShutdownSignals = process,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stopping = false;
    const cleanup = () => {
      signals.removeListener("SIGINT", stop);
      signals.removeListener("SIGTERM", stop);
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close().then(() => {
        cleanup();
        resolve();
      }, (error) => {
        cleanup();
        reject(error);
      });
    };
    signals.once("SIGINT", stop);
    signals.once("SIGTERM", stop);
  });
}

function repositoryId(path: string): string {
  return createHash("sha256").update(path).digest("base64url");
}

function authorized(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function write(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  write(response, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function transportError(response: ServerResponse, status: number, code: string, reason: string): void {
  json(response, status, { error: code, reason });
}

/**
 * Reads a request body up to `limit` bytes. Past the limit it stops keeping
 * bytes and resolves null at once, so the caller can answer 413 while the
 * remainder drains unstored.
 */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    request.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

/** The submitted body: an object carrying exactly the two strings approval needs. */
function approvalBody(bytes: Buffer): { expiresAt: string; signature: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { expiresAt, signature } = value as Record<string, unknown>;
  return typeof expiresAt === "string" && typeof signature === "string" ? { expiresAt, signature } : null;
}

export async function startDashboardServer(
  repositories: readonly DashboardRepository[],
  invocationDirectory: string,
  cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url)),
): Promise<DashboardServer> {
  const assets = new Map<string, { contentType: string; body: Buffer }>([
    ["/", { contentType: "text/html; charset=utf-8",
      body: readFileSync(fileURLToPath(new URL("./dashboard/index.html", import.meta.url))) }],
    ["/app.js", { contentType: "text/javascript; charset=utf-8",
      body: readFileSync(fileURLToPath(new URL("./dashboard/app.js", import.meta.url))) }],
    ["/dashboard-model.js", { contentType: "text/javascript; charset=utf-8",
      body: readFileSync(fileURLToPath(new URL("./dashboard/dashboard-model.js", import.meta.url))) }],
    ["/styles.css", { contentType: "text/css; charset=utf-8",
      body: readFileSync(fileURLToPath(new URL("./dashboard/styles.css", import.meta.url))) }],
  ]);
  const entries: RepositoryEntry[] = repositories.map((repository) => ({
    ...repository,
    id: repositoryId(repository.normalizedPath),
  }));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const token = randomBytes(32).toString("base64url");
  let origin = "";

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    try {
      if (request.headers.host !== origin.slice("http://".length)) {
        transportError(response, 400, "invalid_host", "request Host does not match the dashboard listener");
        return;
      }
      if (request.headers.origin !== undefined && request.headers.origin !== origin) {
        transportError(response, 400, "invalid_origin", "request Origin does not match the dashboard listener");
        return;
      }
      const url = new URL(request.url ?? "/", origin);
      const approvalMatch = APPROVAL_ROUTE.exec(url.pathname);
      if (approvalMatch !== null ? request.method !== "GET" && request.method !== "POST" : request.method !== "GET") {
        response.setHeader("Allow", approvalMatch !== null ? "GET, POST" : "GET");
        transportError(response, 405, "method_not_allowed", approvalMatch !== null
          ? "the approval route permits only GET and POST" : "dashboard routes permit only GET");
        return;
      }
      const asset = assets.get(url.pathname);
      if (asset !== undefined) {
        write(response, 200, asset.contentType, asset.body);
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        transportError(response, 404, "not_found", "route is not available");
        return;
      }
      if (!authorized(request.headers.authorization, token)) {
        transportError(response, 401, "unauthorized", "a valid dashboard bearer token is required");
        return;
      }
      if (approvalMatch !== null) {
        const repository = byId.get(approvalMatch[1]);
        const runId = Number(approvalMatch[2]);
        if (repository === undefined) {
          transportError(response, 404, "repository_not_found", "repository identifier is not configured");
          return;
        }
        if (!Number.isSafeInteger(runId)) {
          transportError(response, 404, "run_not_found", "run identifier is malformed");
          return;
        }
        if (request.method === "GET") {
          json(response, 200, readApprovalRequest(repository.path, invocationDirectory, runId));
          return;
        }
        // A browser always sends Origin on a fetch POST; its absence means the
        // request did not come from the dashboard page.
        if (request.headers.origin !== origin) {
          transportError(response, 400, "invalid_origin", "an approval must carry the dashboard's Origin");
          return;
        }
        if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
          transportError(response, 415, "unsupported_media_type", "an approval body must be application/json");
          return;
        }
        readBody(request, APPROVAL_BODY_MAX_BYTES).then((bytes) => {
          if (bytes === null) {
            response.setHeader("Connection", "close");
            transportError(response, 413, "payload_too_large", `an approval body is at most ${APPROVAL_BODY_MAX_BYTES} bytes`);
            return;
          }
          const body = approvalBody(bytes);
          if (body === null) {
            transportError(response, 400, "invalid_body", "an approval body is a JSON object with string expiresAt and signature");
            return;
          }
          const result = submitApproval(repository.path, invocationDirectory, { runId, ...body });
          json(response, result.outcome === "approved" ? 200 : result.outcome === "writer_busy" ? 409 : 422, result);
        }).catch((error: unknown) => {
          if (!response.headersSent) {
            transportError(response, 500, "internal_error", error instanceof Error ? error.message : String(error));
          }
        });
        return;
      }
      if (url.pathname === "/api/repositories") {
        json(response, 200, {
          observedAt: new Date().toISOString(),
          cliPath,
          repositories: entries.map(({ id, path }) => ({ id, path })),
        });
        return;
      }

      const runsMatch = /^\/api\/repositories\/([A-Za-z0-9_-]+)\/runs$/.exec(url.pathname);
      if (runsMatch !== null) {
        const repository = byId.get(runsMatch[1]);
        if (repository === undefined) {
          transportError(response, 404, "repository_not_found", "repository identifier is not configured");
          return;
        }
        const values = url.searchParams.getAll("limit");
        const text = values.length === 0 ? "20" : values.length === 1 ? values[0] : "";
        const limit = Number(text);
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
          transportError(response, 400, "invalid_limit", "limit must be a safe integer from 1 through 100");
          return;
        }
        json(response, 200, readRunsResult(repository.path, invocationDirectory, limit));
        return;
      }

      const statusMatch = /^\/api\/repositories\/([A-Za-z0-9_-]+)\/runs\/(\d+)$/.exec(url.pathname);
      if (statusMatch !== null) {
        const repository = byId.get(statusMatch[1]);
        const runId = Number(statusMatch[2]);
        if (repository === undefined) {
          transportError(response, 404, "repository_not_found", "repository identifier is not configured");
          return;
        }
        if (!Number.isSafeInteger(runId)) {
          transportError(response, 404, "run_not_found", "run identifier is malformed");
          return;
        }
        json(response, 200, readStatusResult(repository.path, invocationDirectory, runId));
        return;
      }
      transportError(response, 404, "not_found", "route is not available");
    } catch (error) {
      transportError(response, 500, "internal_error", error instanceof Error ? error.message : String(error));
    }
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      server.off("listening", listening);
      reject(error);
    };
    const listening = () => {
      server.off("error", failed);
      resolve();
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen(0, HOST);
  });
  const address = server.address() as AddressInfo;
  origin = `http://${HOST}:${address.port}`;
  let closing: Promise<void> | null = null;
  return {
    origin,
    host: address.address,
    bootstrapUrl: `${origin}/#token=${encodeURIComponent(token)}`,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      return closing;
    },
  };
}
