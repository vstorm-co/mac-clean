import http from "node:http";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

import { CATEGORIES, getCategory } from "./scanners/index.js";
import {
  DEFAULT_OPTIONS,
  isCommandCategory,
  type CategoryResult,
  type ScanOptions,
} from "./scanners/types.js";
import { generateToken, safeEqual, validateForDeletion, isUserApp } from "./security.js";
import { moveToTrash, deletePermanently, type ItemResult } from "./trash.js";
import { diskUsage, duChildren } from "./overview.js";
import { duSizes } from "./du.js";
import { readdirSafe } from "./fswalk.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const TOKEN = generateToken();
const HOME = os.homedir();

// Paths that appeared in a scan result — only these may be deleted.
const scannedPaths = new Set<string>();

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function authorized(req: http.IncomingMessage, url: URL): boolean {
  const header = req.headers["x-mac-clean-token"];
  const token = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get("token") ?? "";
  return safeEqual(token, TOKEN);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(res: http.ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let content = await fs.readFile(full, "utf8");
    if (rel === "index.html") content = content.replace("%%TOKEN%%", TOKEN);
    res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(full)] ?? "text/plain" });
    res.end(content);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

function parseOptions(params: URLSearchParams): ScanOptions {
  const num = (key: string, fallback: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    downloadsDaysOld: num("downloadsDaysOld", DEFAULT_OPTIONS.downloadsDaysOld),
    largeFileMinMB: num("largeFileMinMB", DEFAULT_OPTIONS.largeFileMinMB),
    largeFolderMinMB: num("largeFolderMinMB", DEFAULT_OPTIONS.largeFolderMinMB),
    duplicatesMinMB: num("duplicatesMinMB", DEFAULT_OPTIONS.duplicatesMinMB),
    minItemMB: num("minItemMB", DEFAULT_OPTIONS.minItemMB),
  };
}

async function handleScan(
  res: http.ServerResponse,
  req: http.IncomingMessage,
  url: URL,
): Promise<void> {
  const ids = (url.searchParams.get("categories") ?? "").split(",").filter(Boolean);
  const options = parseOptions(url.searchParams);

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let lastProgress = 0;
  const onProgress = (message: string) => {
    const now = Date.now();
    if (now - lastProgress < 60) return;
    lastProgress = now;
    send("progress", { message });
  };

  const scanCtx = { home: HOME, options, onProgress, signal: controller.signal };

  const scanOne = async (id: string) => {
    const category = getCategory(id);
    if (!category) return;
    send("category-start", { id, label: category.label });

    if (isCommandCategory(category)) {
      try {
        const inspection = await category.inspect(scanCtx);
        send("command-done", {
          id,
          label: category.label,
          group: category.group,
          command: category.command,
          warning: category.warning,
          ...inspection,
        });
      } catch (err) {
        send("command-done", {
          id,
          label: category.label,
          group: category.group,
          available: false,
          reason: (err as Error).message,
          reclaimable: 0,
          detail: "",
        });
      }
      return;
    }

    const result: CategoryResult = {
      id,
      label: category.label,
      group: category.group,
      items: [],
      totalSize: 0,
      count: 0,
    };
    try {
      const items = await category.scan(scanCtx);
      for (const item of items) {
        scannedPaths.add(item.path);
        result.totalSize += item.size;
      }
      result.items = items;
      result.count = items.length;
    } catch (err) {
      result.error = (err as Error).message;
    }
    send("category-done", result);
  };

  await Promise.all(ids.map(scanOne));

  send("done", {});
  res.end();
}

async function handleDelete(res: http.ServerResponse, req: http.IncomingMessage): Promise<void> {
  const body = (await readBody(req)) as { paths?: unknown; mode?: unknown };
  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
  const mode = body.mode === "delete" ? "delete" : "trash";

  if (paths.length === 0) {
    sendJson(res, 400, { error: "No paths provided." });
    return;
  }

  const allowed: string[] = [];
  const rejected: ItemResult[] = [];
  for (const p of paths) {
    const verdict = await validateForDeletion(p, scannedPaths);
    if (!verdict.allowed) {
      rejected.push({ path: p, ok: false, error: verdict.reason });
    } else if (mode === "delete" && isUserApp(path.normalize(p))) {
      rejected.push({ path: p, ok: false, error: "Apps can only be moved to the Trash." });
    } else {
      allowed.push(path.normalize(p));
    }
  }

  const results =
    mode === "delete" ? await deletePermanently(allowed) : await moveToTrash(allowed);

  for (const r of results) {
    if (r.ok) scannedPaths.delete(path.normalize(r.path));
  }

  sendJson(res, 200, { mode, results: [...results, ...rejected] });
}

async function handleOverview(res: http.ServerResponse, req: http.IncomingMessage): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send("disk", await diskUsage());
  } catch {
    /* statfs unavailable */
  }

  const section = async (dir: string, id: string, title: string) => {
    const entries = await duChildren(dir, controller.signal);
    const items = entries.slice(0, 12).map((e) => ({
      name: path.basename(e.path),
      path: e.path,
      size: e.size,
    }));
    send("section", { id, title, items });
  };

  // Every top-level folder in $HOME (including hidden and custom ones),
  // sized over a small pool of `du` workers and streamed as each completes.
  const homeDirs = (await readdirSafe(HOME))
    .filter((e) => e.isDirectory() && !e.isSymbolicLink() && e.name !== "Library")
    .map((e) => e.name);
  const homeTask = pool(homeDirs, 8, async (name) => {
    const dir = path.join(HOME, name);
    const size = (await duSizes([dir], controller.signal)).get(dir) ?? 0;
    if (size > 1024 * 1024) send("folder", { name, path: dir, size });
  });

  await Promise.all([
    homeTask,
    section("/Applications", "apps", "Applications"),
    section(path.join(HOME, "Library"), "library", "Library"),
  ]);
  send("done", {});
  res.end();
}

// Run `worker` over `items` with at most `concurrency` in flight.
async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const next = async (): Promise<void> => {
    while (cursor < items.length) {
      await worker(items[cursor++]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

function revealInFinder(target: string): void {
  if (!target.startsWith(HOME) && !target.startsWith("/tmp") && !target.startsWith("/private")) return;
  execFile("open", ["-R", target], () => {});
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const isApi = url.pathname.startsWith("/api/");

    if (isApi && !authorized(req, url)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    try {
      if (url.pathname === "/api/categories" && req.method === "GET") {
        sendJson(res, 200, {
          categories: CATEGORIES.map((c) => ({
            id: c.id,
            label: c.label,
            group: c.group,
            description: c.description,
            warning: c.warning,
            kind: isCommandCategory(c) ? "command" : "files",
          })),
          defaults: DEFAULT_OPTIONS,
        });
      } else if (url.pathname === "/api/overview" && req.method === "GET") {
        await handleOverview(res, req);
      } else if (url.pathname === "/api/scan" && req.method === "GET") {
        await handleScan(res, req, url);
      } else if (url.pathname === "/api/delete" && req.method === "POST") {
        await handleDelete(res, req);
      } else if (url.pathname === "/api/reveal" && req.method === "POST") {
        const body = (await readBody(req)) as { path?: string };
        if (body.path) revealInFinder(body.path);
        sendJson(res, 200, { ok: true });
      } else if (!isApi && req.method === "GET") {
        await serveStatic(res, url.pathname);
      } else {
        sendJson(res, 404, { error: "Not found" });
      }
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });
}

export { TOKEN };
