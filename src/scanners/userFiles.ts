import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdirSafe, lstatSafe } from "../fswalk.js";
import { duSizes } from "../du.js";
import { findFiles } from "../fsfind.js";
import { toItem } from "./common.js";
import { formatBytes } from "../format.js";
import type { Category, ScanContext, ScanItem } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function userRoots(ctx: ScanContext): string[] {
  return ["Downloads", "Documents", "Desktop"].map((d) => path.join(ctx.home, d));
}

export const oldDownloads: Category = {
  id: "downloads-old",
  label: "Old downloads",
  group: "risky",
  description: "Items in ~/Downloads you haven't touched in a while.",
  warning: "May contain files you still want. Review each one.",
  scan: async (ctx) => {
    const cutoff = Date.now() - ctx.options.downloadsDaysOld * DAY_MS;
    const dir = path.join(ctx.home, "Downloads");

    const candidates: { path: string; st: Awaited<ReturnType<typeof lstatSafe>> }[] = [];
    for (const entry of await readdirSafe(dir)) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      const st = await lstatSafe(full);
      if (!st || st.kind === "symlink" || st.mtime === null || st.mtime > cutoff) continue;
      candidates.push({ path: full, st });
    }

    const dirSizes = await duSizes(
      candidates.filter((c) => c.st!.kind === "dir").map((c) => c.path),
      ctx.signal,
    );
    return candidates.map(({ path: p, st }) => {
      const size = st!.kind === "dir" ? (dirSizes.get(p) ?? 0) : st!.size;
      const days = Math.floor((Date.now() - st!.mtime!) / DAY_MS);
      return toItem(p, st!.kind, size, st!.mtime, { note: `${days} days old` });
    });
  },
};

export const largeFiles: Category = {
  id: "large-files",
  label: "Large files",
  group: "risky",
  description: "Big individual files in Downloads, Documents and Desktop.",
  warning: "Review carefully — these are your own files.",
  scan: async (ctx) => {
    const minBytes = ctx.options.largeFileMinMB * 1024 * 1024;
    const files = await findFiles(userRoots(ctx), { minBytes, maxDepth: 4, signal: ctx.signal });

    const items: ScanItem[] = [];
    for (const file of files) {
      const st = await lstatSafe(file);
      if (st) items.push(toItem(file, "file", st.size, st.mtime));
    }
    return items.sort((a, b) => b.size - a.size);
  },
};

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export const duplicates: Category = {
  id: "duplicates",
  label: "Duplicate files",
  group: "risky",
  description: "Files with identical content in Downloads, Documents and Desktop.",
  warning: "Keep at least one copy. Nothing is pre-selected — you choose what to remove.",
  scan: async (ctx) => {
    const minBytes = ctx.options.duplicatesMinMB * 1024 * 1024;
    const files = await findFiles(userRoots(ctx), { minBytes, maxDepth: 6, signal: ctx.signal });

    const bySize = new Map<number, string[]>();
    for (const file of files) {
      const st = await lstatSafe(file);
      if (!st) continue;
      const group = bySize.get(st.size) ?? [];
      group.push(file);
      bySize.set(st.size, group);
    }

    const byHash = new Map<string, { files: string[]; size: number }>();
    for (const [size, group] of bySize) {
      if (group.length < 2 || ctx.signal.aborted) continue;
      for (const file of group) {
        ctx.onProgress(file);
        const digest = await hashFile(file);
        const bucket = byHash.get(digest) ?? { files: [], size };
        bucket.files.push(file);
        byHash.set(digest, bucket);
      }
    }

    const items: ScanItem[] = [];
    for (const [digest, group] of byHash) {
      if (group.files.length < 2) continue;
      const label = `${group.files.length} copies · ${formatBytes(group.size)} each`;
      for (const file of group.files) {
        const st = await lstatSafe(file);
        items.push(
          toItem(file, "file", group.size, st?.mtime ?? null, { groupKey: digest, groupLabel: label }),
        );
      }
    }
    return items;
  },
};
