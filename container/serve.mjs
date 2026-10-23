// The system's page server, copied into the image
// (docs/features/served-browser-pages/plan.md). Both browser runners start it
// through their config's `webServer` block and open pages from it, because a
// page opened from `file:///work/` runs no code when its `index.html` loads a
// module script (Chromium refuses it by CORS) or a root-absolute path (it
// resolves to `file:///src/...`): hazard 18, the 2026-10-22 measured paragraph.
//
// It serves files under /work on the container's own loopback, GET and HEAD
// only. Anything it cannot serve gets no response: the socket is closed, so
// navigation fails as a missing file did from disk, where a 404 would let
// `page.goto` succeed. It writes no file and prints nothing, because a
// command's stdout and stderr share the log the report reader parses as one
// JSON document (hazard 2).
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = "/work";
const PORT = 47731;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};
const UNKNOWN_TYPE = "application/octet-stream";

function inside(path) {
  return path === ROOT || path.startsWith(`${ROOT}/`);
}

/**
 * The absolute path a request URL names under /work, or null when it is not
 * servable by its text alone. The check runs on the percent-decoded path, so an
 * encoded `..` cannot pass it, and it needs `/work` or `/work/` exactly, so a
 * sibling such as `/work-sibling` is not a prefix match.
 */
export function resolveUnder(rawPath) {
  const pathname = rawPath.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\0")) return null;
  const resolved = posix.join(ROOT, decoded);
  return inside(resolved) ? resolved : null;
}

/** The real path of `path` when it is under /work, or null. */
async function contained(path) {
  try {
    const real = await realpath(path);
    return inside(real) ? real : null;
  } catch {
    return null;
  }
}

function refuse(req) {
  req.socket.destroy();
}

async function answer(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return refuse(req);
  const path = resolveUnder(req.url);
  if (path === null) return refuse(req);
  let real = await contained(path);
  if (real === null) return refuse(req);
  let info = await stat(real);
  if (info.isDirectory()) {
    const [pathname, ...rest] = req.url.split(/(?=[?#])/);
    if (!pathname.endsWith("/")) {
      // One leading slash, so `//src` cannot become a protocol-relative
      // `//src/` that the browser reads as another host.
      const location = `/${pathname.replace(/^\/+/, "")}/${rest.join("")}`;
      res.writeHead(301, { Location: location, "Cache-Control": "no-store", "Content-Length": 0 });
      return res.end();
    }
    real = await contained(posix.join(real, "index.html"));
    if (real === null) return refuse(req);
    info = await stat(real);
  }
  if (!info.isFile()) return refuse(req);
  const body = await readFile(real);
  res.writeHead(200, {
    "Content-Type": TYPES[posix.extname(real).toLowerCase()] ?? UNKNOWN_TYPE,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer((req, res) => {
    answer(req, res).catch(() => refuse(req));
  })
    // A request Node cannot parse gets no response either, not its default 400.
    .on("clientError", (_err, socket) => socket.destroy())
    .listen(PORT, "127.0.0.1");
}
