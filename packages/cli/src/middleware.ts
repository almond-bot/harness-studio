import { promises as fs } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

type Next = () => void;

async function listHarnessFiles(dataDir: string): Promise<string[]> {
  const results: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".harness.json") || entry.name.endsWith(".json")) {
        results.push(path.relative(dataDir, full));
      }
    }
  };
  await walk(dataDir);
  return results.sort();
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Connect-style handler for the harness file API, used by both the CLI server
 * and the Vite dev server. Endpoints: /api/files, /api/file?path=, /api/events (SSE).
 */
export function createApiHandler(dataDir: string) {
  const root = path.resolve(dataDir);
  const sseClients = new Set<ServerResponse>();
  let watcherStarted = false;

  const startWatcher = async () => {
    if (watcherStarted) return;
    watcherStarted = true;
    try {
      const { watch } = await import("chokidar");
      const watcher = watch(root, { ignoreInitial: true, ignored: /node_modules/ });
      const broadcast = () => {
        for (const client of sseClients) client.write(`data: change\n\n`);
      };
      watcher.on("add", broadcast).on("change", broadcast).on("unlink", broadcast);
    } catch {
      // chokidar unavailable; live reload disabled
    }
  };

  return async function apiHandler(req: IncomingMessage, res: ServerResponse, next?: Next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      next?.();
      return;
    }

    if (url.pathname === "/api/files") {
      sendJson(res, 200, { dataDir: root, files: await listHarnessFiles(root) });
      return;
    }

    if (url.pathname === "/api/file") {
      const rel = url.searchParams.get("path") ?? "";
      const full = path.resolve(root, rel);
      if (!full.startsWith(root + path.sep) && full !== root) {
        sendJson(res, 400, { error: "invalid path" });
        return;
      }
      try {
        const content = await fs.readFile(full, "utf8");
        sendJson(res, 200, { path: rel, content });
      } catch {
        sendJson(res, 404, { error: `file not found: ${rel}` });
      }
      return;
    }

    if (url.pathname === "/api/events") {
      await startWatcher();
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: connected\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    sendJson(res, 404, { error: "not found" });
  };
}
