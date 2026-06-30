import { spawn } from "node:child_process";

export interface DuEntry {
  path: string;
  size: number;
}

function duRaw(args: string[], signal?: AbortSignal): Promise<DuEntry[]> {
  return new Promise((resolve) => {
    const child = spawn("du", args);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const entries: DuEntry[] = [];
      for (const line of out.split("\n")) {
        const tab = line.indexOf("\t");
        if (tab < 0) continue;
        const kb = parseInt(line.slice(0, tab), 10);
        if (!Number.isFinite(kb)) continue;
        entries.push({ path: line.slice(tab + 1), size: kb * 1024 });
      }
      resolve(entries);
    });
    signal?.addEventListener("abort", () => child.kill());
  });
}

// Recursive sizes of the immediate subdirectories of `dir`, in one pass.
export async function duChildren(dir: string, signal?: AbortSignal): Promise<DuEntry[]> {
  const entries = await duRaw(["-k", "-d", "1", dir], signal);
  return entries.filter((e) => e.path !== dir).sort((a, b) => b.size - a.size);
}

// Recursive size of each given path, in one `du` invocation.
export async function duSizes(paths: string[], signal?: AbortSignal): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (paths.length === 0) return map;
  for (const e of await duRaw(["-k", "-s", ...paths], signal)) map.set(e.path, e.size);
  return map;
}

// Same as duSizes, but spread across several concurrent `du` processes so disk
// I/O overlaps. Much faster on large directory sets (e.g. ~/Library/Caches).
export async function duSizesParallel(
  paths: string[],
  signal?: AbortSignal,
  concurrency = 8,
): Promise<Map<string, number>> {
  if (paths.length <= 1) return duSizes(paths, signal);

  const chunkSize = Math.ceil(paths.length / concurrency);
  const chunks: string[][] = [];
  for (let i = 0; i < paths.length; i += chunkSize) chunks.push(paths.slice(i, i + chunkSize));

  const merged = new Map<string, number>();
  for (const part of await Promise.all(chunks.map((c) => duSizes(c, signal)))) {
    for (const [k, v] of part) merged.set(k, v);
  }
  return merged;
}

// Every directory under `dir` with its recursive size, in one pass.
export function duTree(dir: string, signal?: AbortSignal): Promise<DuEntry[]> {
  return duRaw(["-k", dir], signal);
}
