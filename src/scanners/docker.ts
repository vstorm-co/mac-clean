import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstatSafe } from "../fswalk.js";
import type { CommandCategory } from "./types.js";

const execFileAsync = promisify(execFile);

const DOCKER_PATHS = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
];

async function findDocker(): Promise<string | null> {
  for (const p of DOCKER_PATHS) {
    if (await lstatSafe(p)) return p;
  }
  return null;
}

function parseSize(text: string): number {
  const match = /([\d.]+)\s*([KMGT]?B)/i.exec(text);
  if (!match) return 0;
  const units: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return parseFloat(match[1]!) * (units[match[2]!.toUpperCase()] ?? 1);
}

export const docker: CommandCategory = {
  id: "docker",
  label: "Docker",
  group: "safe",
  description: "Unused Docker images, containers and build cache.",
  warning: "Removed Docker data is NOT moved to the Trash and cannot be recovered.",
  command: "docker system prune -af",
  inspect: async () => {
    const bin = await findDocker();
    if (!bin) return { available: false, reason: "Docker not installed.", reclaimable: 0, detail: "" };
    try {
      const { stdout } = await execFileAsync(bin, ["system", "df", "--format", "{{json .}}"]);
      let reclaimable = 0;
      const parts: string[] = [];
      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const row = JSON.parse(line) as { Type?: string; Reclaimable?: string };
        reclaimable += parseSize(row.Reclaimable ?? "");
        parts.push(`${row.Type}: ${row.Reclaimable}`);
      }
      return { available: true, reclaimable, detail: parts.join(" · ") };
    } catch {
      return { available: false, reason: "Docker is installed but not running.", reclaimable: 0, detail: "" };
    }
  },
};
