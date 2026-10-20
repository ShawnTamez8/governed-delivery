import { createServer } from "node:http";
import { connect } from "node:net";

/**
 * A sandbox's only way out (docs/features/sandboxed-implementer/plan.md,
 * promoted from the spike's proxy). It runs inside the proxy container under
 * Node's type stripping, on port 3128, and imports nothing outside Node, so
 * `src/container.ts` can mount this one file read-only into the container.
 *
 * Its allowlist is its arguments: each is a `host:port` the run froze
 * (`sandbox.egressAllowlist`), so adding a feed is one more frozen entry and
 * no code here changes (extension point 2). It tunnels `CONNECT` to an allowed
 * target and refuses everything else with 403. Plain-HTTP requests are
 * refused, because every allowed target is reached over TLS.
 *
 * Every outcome is a JSON line on stdout, so `docker logs` is the record:
 * `allow` and `deny` with the target, and `error` with the target and the
 * error code when an upstream connection or either socket fails. A failed
 * socket is logged before it is destroyed, never just destroyed.
 *
 *   node egress-proxy.ts <host:port> [<host:port> ...]
 */

const ALLOWED = new Set(process.argv.slice(2).map((target) => target.toLowerCase()));

function log(record: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

function errorCode(err: Error): string {
  return (err as NodeJS.ErrnoException).code ?? err.message;
}

const server = createServer((req, res) => {
  const target = req.headers.host ?? req.url ?? "";
  log({ verdict: "deny", target: `http ${target}` });
  res.writeHead(403, { "content-type": "text/plain" });
  res.end(`egress refused: ${target}\n`);
});

server.on("connect", (req, clientSocket, head) => {
  const target = (req.url ?? "").toLowerCase();
  if (!ALLOWED.has(target)) {
    log({ verdict: "deny", target });
    clientSocket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\negress refused: ${target}\n`);
    return;
  }
  log({ verdict: "allow", target });
  const separator = target.lastIndexOf(":");
  const host = target.slice(0, separator);
  const port = Number(target.slice(separator + 1));
  const upstream = connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", (err) => {
    log({ verdict: "error", side: "upstream", target, code: errorCode(err) });
    clientSocket.destroy();
  });
  clientSocket.on("error", (err) => {
    log({ verdict: "error", side: "client", target, code: errorCode(err) });
    upstream.destroy();
  });
});

server.on("error", (err) => {
  log({ verdict: "error", side: "server", code: errorCode(err), message: err.message });
  process.exit(1);
});

log({ verdict: "start", allowlist: [...ALLOWED] });
server.listen(3128, "0.0.0.0");
