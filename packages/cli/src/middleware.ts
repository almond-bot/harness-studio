import { promises as fs } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { collectPartRefs, partKey, type Harness, type PartsCache } from "@almond-harness-studio/core";
import { loadConfig, resolvePart, type VendorConfig } from "./vendors.js";

type Next = () => void;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

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

    // Resolve part references server-side (distributor APIs don't allow browser CORS)
    // and write the results back into the harness file.
    if (url.pathname === "/api/parts/fetch" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        path?: string;
        keys?: { mouser?: { apiKey?: string }; digikey?: { clientId?: string; clientSecret?: string } };
      };
      const rel = body.path ?? "";
      const full = path.resolve(root, rel);
      if (!full.startsWith(root + path.sep) && full !== root) {
        sendJson(res, 400, { error: "invalid path" });
        return;
      }
      let harness: Harness;
      try {
        harness = JSON.parse(await fs.readFile(full, "utf8")) as Harness;
      } catch {
        sendJson(res, 404, { error: `file not found: ${rel}` });
        return;
      }

      const fileConfig = await loadConfig();
      const config: VendorConfig = {
        mouser: { apiKey: body.keys?.mouser?.apiKey || fileConfig.mouser?.apiKey },
        digikey: {
          clientId: body.keys?.digikey?.clientId || fileConfig.digikey?.clientId,
          clientSecret: body.keys?.digikey?.clientSecret || fileConfig.digikey?.clientSecret,
        },
      };

      const cache: PartsCache = { ...(harness.parts ?? {}) };
      const failures: { part: string; error: string }[] = [];
      let changed = false;
      for (const ref of collectPartRefs(harness)) {
        const key = partKey(ref);
        if (cache[key]) continue;
        try {
          cache[key] = await resolvePart(ref, config);
          changed = true;
        } catch (err) {
          failures.push({ part: key, error: (err as Error).message });
        }
      }
      if (changed) {
        harness.parts = cache;
        await fs.writeFile(full, JSON.stringify(harness, null, 2) + "\n", "utf8");
      }
      sendJson(res, 200, { resolved: Object.keys(cache).length, failures });
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
