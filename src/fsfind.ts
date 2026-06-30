import { spawn } from "node:child_process";

// Fast file search via `find`. Returns absolute file paths at least `minBytes`
// in size, no deeper than `maxDepth`. Hidden files are skipped.
export function findFiles(
  dirs: string[],
  opts: { minBytes: number; maxDepth: number; signal?: AbortSignal },
): Promise<string[]> {
  return new Promise((resolve) => {
    if (dirs.length === 0) return resolve([]);
    const args = [
      ...dirs,
      "-maxdepth",
      String(opts.maxDepth),
      "-type",
      "f",
      "-size",
      `+${opts.minBytes}c`,
      "-not",
      "-path",
      "*/.*",
      "-print0",
    ];
    const child = spawn("find", args);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => resolve([]));
    child.on("close", () => resolve(out.split("\0").filter(Boolean)));
    opts.signal?.addEventListener("abort", () => child.kill());
  });
}
