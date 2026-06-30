import path from "node:path";
import { readdirSafe, lstatSafe, type Stat } from "../fswalk.js";
import { duSizesParallel } from "../du.js";
import type { ScanItem, ScanContext } from "./types.js";

export function toItem(
  full: string,
  kind: Stat["kind"],
  size: number,
  mtime: number | null,
  extra?: Partial<ScanItem>,
): ScanItem {
  return { id: full, path: full, name: path.basename(full), kind, size, mtime, ...extra };
}

export async function listChildren(
  dir: string,
  ctx: ScanContext,
  opts: { includeHidden?: boolean; minSize?: number } = {},
): Promise<ScanItem[]> {
  if (!(await lstatSafe(dir))) return [];

  const children: { path: string; st: Stat }[] = [];
  for (const entry of await readdirSafe(dir)) {
    if (entry.name === ".DS_Store") continue;
    if (!opts.includeHidden && entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const st = await lstatSafe(full);
    if (st && st.kind !== "symlink") children.push({ path: full, st });
  }

  const dirSizes = await duSizesParallel(
    children.filter((c) => c.st.kind === "dir").map((c) => c.path),
    ctx.signal,
  );

  const items: ScanItem[] = [];
  for (const { path: full, st } of children) {
    const size = st.kind === "dir" ? (dirSizes.get(full) ?? 0) : st.size;
    if (size < (opts.minSize ?? 1)) continue;
    items.push(toItem(full, st.kind, size, st.mtime));
  }
  return items;
}

export async function knownPaths(
  paths: string[],
  ctx: ScanContext,
  note?: string,
): Promise<ScanItem[]> {
  const existing: { path: string; st: Stat }[] = [];
  for (const p of paths) {
    const st = await lstatSafe(p);
    if (st && st.kind !== "symlink") existing.push({ path: p, st });
  }

  const sizes = await duSizesParallel(
    existing.map((e) => e.path),
    ctx.signal,
  );
  return existing
    .map(({ path: p, st }) =>
      toItem(p, st.kind, sizes.get(p) ?? 0, st.mtime, note ? { note } : undefined),
    )
    .filter((item) => item.size > 0);
}
