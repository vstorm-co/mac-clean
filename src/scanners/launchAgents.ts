import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSafe, lstatSafe } from "../fswalk.js";
import { toItem } from "./common.js";
import type { Category, ScanItem } from "./types.js";

const execFileAsync = promisify(execFile);
const SYSTEM_BIN_DIRS = [
  "/usr/bin/",
  "/bin/",
  "/sbin/",
  "/usr/sbin/",
  "/usr/local/bin/",
  "/opt/homebrew/bin/",
];

async function targetProgram(plist: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("plutil", ["-convert", "json", "-o", "-", plist]);
    const data = JSON.parse(stdout) as { Program?: string; ProgramArguments?: string[] };
    if (typeof data.Program === "string") return data.Program;
    if (Array.isArray(data.ProgramArguments) && data.ProgramArguments.length > 0) {
      return data.ProgramArguments[0]!;
    }
    return null;
  } catch {
    return null;
  }
}

export const launchAgents: Category = {
  id: "launch-agents",
  label: "Orphaned launch agents",
  group: "moderate",
  description: "Auto-start entries in ~/Library/LaunchAgents pointing to programs that no longer exist.",
  warning: "Only entries whose target is missing are listed. Removing them stops a leftover auto-start.",
  scan: async (ctx) => {
    const dir = path.join(ctx.home, "Library/LaunchAgents");
    const items: ScanItem[] = [];

    for (const entry of await readdirSafe(dir)) {
      if (ctx.signal.aborted) break;
      if (!entry.isFile() || !entry.name.endsWith(".plist")) continue;

      const full = path.join(dir, entry.name);
      const program = await targetProgram(full);
      if (!program) continue;
      if (SYSTEM_BIN_DIRS.some((d) => program.startsWith(d))) continue;
      if (await lstatSafe(program)) continue;

      ctx.onProgress(full);
      const st = await lstatSafe(full);
      items.push(toItem(full, "file", st?.size ?? 0, st?.mtime ?? null, { note: `missing: ${program}` }));
    }
    return items;
  },
};
