import path from "node:path";
import { lstatSafe } from "../fswalk.js";
import { duChildren } from "../du.js";
import { toItem } from "./common.js";
import type { Category, ScanItem } from "./types.js";

export const applications: Category = {
  id: "applications",
  label: "Applications",
  group: "risky",
  description: "Installed apps in /Applications. Move ones you no longer use to the Trash.",
  warning: "Trashing an app is recoverable, but some support files may remain elsewhere.",
  scan: async (ctx) => {
    const apps = await duChildren("/Applications", ctx.signal);
    const items: ScanItem[] = [];
    for (const app of apps) {
      if (ctx.signal.aborted) break;
      if (!path.basename(app.path).endsWith(".app")) continue;
      ctx.onProgress(app.path);
      const st = await lstatSafe(app.path);
      items.push(toItem(app.path, "dir", app.size, st?.mtime ?? null));
    }
    return items;
  },
};
