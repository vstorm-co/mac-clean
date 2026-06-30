import path from "node:path";
import { readdirSafe, lstatSafe } from "../fswalk.js";
import { duSizesParallel } from "../du.js";
import { toItem } from "./common.js";
import type { Category, ScanContext, ScanItem } from "./types.js";

const MAX_DEPTH = 4;
// Folders that never hold the user's own projects — skip to stay fast and avoid
// listing tool-internal node_modules (editor extensions, caches, etc.).
const SKIP_ROOTS = new Set(["Library", "Music", "Movies", "Pictures", "Applications", ".Trash"]);

async function findNodeModules(root: string, ctx: ScanContext): Promise<string[]> {
  const found: string[] = [];
  const stack = [{ dir: root, depth: 0 }];

  while (stack.length > 0) {
    if (ctx.signal.aborted) break;
    const { dir, depth } = stack.pop()!;
    for (const entry of await readdirSafe(dir)) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === "node_modules") {
        found.push(full);
        continue;
      }
      if (depth < MAX_DEPTH) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return found;
}

export const nodeModules: Category = {
  id: "node-modules",
  label: "node_modules folders",
  group: "moderate",
  description: "Dependency folders inside your project directories.",
  warning: "The project will need `npm install` (or equivalent) to restore them.",
  scan: async (ctx) => {
    const roots = (await readdirSafe(ctx.home)).filter(
      (e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith(".") && !SKIP_ROOTS.has(e.name),
    );

    const dirs: string[] = [];
    for (const entry of roots) {
      dirs.push(...(await findNodeModules(path.join(ctx.home, entry.name), ctx)));
    }

    const sizes = await duSizesParallel(dirs, ctx.signal);
    const items: ScanItem[] = [];
    for (const dir of dirs) {
      const st = await lstatSafe(dir);
      items.push(toItem(dir, "dir", sizes.get(dir) ?? 0, st?.mtime ?? null, { note: path.dirname(dir) }));
    }
    return items.sort((a, b) => b.size - a.size);
  },
};
