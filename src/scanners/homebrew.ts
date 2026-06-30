import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstatSafe } from "../fswalk.js";
import { listChildren } from "./common.js";
import type { Category } from "./types.js";

const execFileAsync = promisify(execFile);
const BREW_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

export const homebrew: Category = {
  id: "homebrew",
  label: "Homebrew cache",
  group: "safe",
  description: "Downloaded installers and old versions cached by Homebrew.",
  scan: async (ctx) => {
    let brew: string | null = null;
    for (const p of BREW_PATHS) {
      if (await lstatSafe(p)) {
        brew = p;
        break;
      }
    }
    if (!brew) return [];

    const { stdout } = await execFileAsync(brew, ["--cache"], { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1" } });
    const cacheDir = stdout.trim();
    if (!cacheDir || !(await lstatSafe(cacheDir))) return [];
    return listChildren(cacheDir, ctx, { minSize: ctx.options.minItemMB * 1024 * 1024 });
  },
};
