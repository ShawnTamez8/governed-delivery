import { createServer } from "node:http";
import { connect } from "node:net";

/**
 * The sandbox's only way out (docs/features/sandboxed-implementer-spike/plan.md,
 * Task 2). It runs inside the proxy container under Node's type stripping, on
 * port 3128. It tunnels `CONNECT registry.npmjs.org:443` and refuses everything
 * else with 403. Plain-HTTP requests are refused, because the registry is
 * reached over TLS. Every request is logged to stdout as `allow` or `deny` with
 * its target, so `docker logs` is the record.
 */

const ALLOWED = new Set(["registry.npmjs.org:443"]);

function log(verdict: "allow" | "deny", target: string): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), verdict, target })}\n`);
}

const server = createServer((req, res) => {
  const target = req.headers.host ?? req.url ?? "";
  log("deny", `http ${target}`);
  res.writeHead(403, { "content-type": "text/plain" });
  res.end(`egress refused: ${target}\n`);
});

server.on("connect", (req, clientSocket, head) => {
  const target = (req.url ?? "").toLowerCase();
  if (!ALLOWED.has(target)) {
    log("deny", target);
    clientSocket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\negress refused: ${target}\n`);
    return;
  }
  log("allow", target);
  const [host, port] = target.split(":");
  const upstream = connect(Number(port), host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
});

server.listen(3128, "0.0.0.0");
