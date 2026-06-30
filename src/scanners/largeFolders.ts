import path from "node:path";
import { readdirSafe, lstatSafe } from "../fswalk.js";
import { duTree, type DuEntry } from "../du.js";
import { checkPathAllowed } from "../security.js";
import { toItem } from "./common.js";
import type { Category, ScanContext, ScanItem } from "./types.js";

// Big subtrees are split further so the giants (UTM, app data) get sized in parallel.
const SPLIT = ["Application Support", "Containers", "Group Containers", "Caches"];

async function subdirs(dir: string): Promise<string[]> {
  return (await readdirSafe(dir))
    .filter((e) => e.isDirectory() && !e.isSymbolicLink())
    .map((e) => path.join(dir, e.name));
}

// The set of subtrees to size in parallel: every top-level home folder, with
// ~/Library opened one level deeper so its giant children don't serialize.
async function scanRoots(home: string): Promise<string[]> {
  const roots: string[] = [];
  for (const entry of await readdirSafe(home)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === "Library") continue;
    roots.push(path.join(home, entry.name));
  }
  for (const child of await subdirs(path.join(home, "Library"))) {
    if (SPLIT.includes(path.basename(child))) roots.push(...(await subdirs(child)));
    else roots.push(child);
  }
  return roots;
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) await worker(items[cursor++]!);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

export const largeFolders: Category = {
  id: "large-folders",
  label: "Large folders",
  group: "risky",
  description: "Every folder over the size threshold — VMs, AI models, app data, projects.",
  warning:
    "These are your own files and per-app data. Removing one deletes that app's data or your project (recoverable from the Trash). Review each carefully.",
  scan: async (ctx: ScanContext) => {
    const minBytes = ctx.options.largeFolderMinMB * 1024 * 1024;
    const roots = await scanRoots(ctx.home);

    const all: DuEntry[] = [];
    await pool(roots, 12, async (root) => {
      for (const entry of await duTree(root, ctx.signal)) {
        if (entry.size >= minBytes && checkPathAllowed(entry.path).allowed) all.push(entry);
      }
      ctx.onProgress(root);
    });

    // Keep only the top-most big folder of each branch (no nested duplicates).
    const paths = new Set(all.map((e) => e.path));
    const topMost = all.filter((e) => !paths.has(path.dirname(e.path)));

    const items: ScanItem[] = [];
    for (const entry of topMost) {
      const st = await lstatSafe(entry.path);
      items.push(toItem(entry.path, "dir", entry.size, st?.mtime ?? null));
    }
    return items.sort((a, b) => b.size - a.size);
  },
};
