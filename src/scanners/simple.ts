import path from "node:path";
import { listChildren, knownPaths } from "./common.js";
import type { Category, ScanContext, ScanItem } from "./types.js";

const home = (ctx: ScanContext, ...parts: string[]) => path.join(ctx.home, ...parts);
const floor = (ctx: ScanContext) => ctx.options.minItemMB * 1024 * 1024;

export const trash: Category = {
  id: "trash",
  label: "Trash",
  group: "safe",
  description: "Files sitting in the macOS Trash, still taking up space.",
  scan: (ctx) => listChildren(home(ctx, ".Trash"), ctx, { includeHidden: true }),
};

export const tempFiles: Category = {
  id: "temp-files",
  label: "Temporary files",
  group: "safe",
  description: "Leftover files in the system temp directories.",
  scan: async (ctx) => {
    const items = await listChildren("/tmp", ctx, { includeHidden: true, minSize: floor(ctx) });
    return items.filter((i) => i.path.split(path.sep).filter(Boolean).length > 1);
  },
};

export const browserCache: Category = {
  id: "browser-cache",
  label: "Browser caches",
  group: "safe",
  description: "Cached data from web browsers. Safe to remove; browsers rebuild it.",
  scan: (ctx) =>
    knownPaths(
      [
        home(ctx, "Library/Caches/Google/Chrome"),
        home(ctx, "Library/Caches/com.apple.Safari"),
        home(ctx, "Library/Caches/Firefox/Profiles"),
        home(ctx, "Library/Caches/company.thebrowser.Browser"),
        home(ctx, "Library/Caches/BraveSoftware"),
        home(ctx, "Library/Caches/com.microsoft.edgemac"),
      ],
      ctx,
    ),
};

export const systemCache: Category = {
  id: "system-cache",
  label: "Application caches",
  group: "moderate",
  description: "Per-app caches under ~/Library/Caches. Apps rebuild them on next launch.",
  warning: "Some apps may briefly slow down on first launch while rebuilding caches.",
  scan: (ctx) => listChildren(home(ctx, "Library/Caches"), ctx, { minSize: floor(ctx) }),
};

export const systemLogs: Category = {
  id: "system-logs",
  label: "Logs",
  group: "moderate",
  description: "Application and diagnostic logs in ~/Library/Logs.",
  warning: "Logs can be useful when debugging a recent problem.",
  scan: (ctx) => listChildren(home(ctx, "Library/Logs"), ctx, { minSize: floor(ctx) }),
};

export const devCache: Category = {
  id: "dev-cache",
  label: "Developer caches",
  group: "moderate",
  description: "Package-manager and build caches (npm, Yarn, pnpm, pip, CocoaPods, Gradle, Xcode).",
  warning: "Projects will re-download or rebuild dependencies afterwards.",
  scan: async (ctx) => {
    const known = await knownPaths(
      [
        home(ctx, ".npm/_cacache"),
        home(ctx, "Library/Caches/Yarn"),
        home(ctx, "Library/pnpm/store"),
        home(ctx, ".cache/pip"),
        home(ctx, ".cache/uv"),
        home(ctx, ".bun/install/cache"),
        home(ctx, ".deno"),
        home(ctx, "Library/Caches/CocoaPods"),
        home(ctx, ".gradle/caches"),
        home(ctx, ".cargo/registry"),
        home(ctx, "Library/Developer/Xcode/Archives"),
      ],
      ctx,
    );
    const derivedData = await listChildren(
      home(ctx, "Library/Developer/Xcode/DerivedData"),
      ctx,
      { minSize: 1024 * 1024 },
    );
    return [...known, ...derivedData];
  },
};

export const iosBackups: Category = {
  id: "ios-backups",
  label: "iOS device backups",
  group: "risky",
  description: "iPhone/iPad backups stored on this Mac.",
  warning: "Deleting these permanently removes device backups. Make sure you have another copy.",
  scan: (ctx) =>
    listChildren(home(ctx, "Library/Application Support/MobileSync/Backup"), ctx, {
      includeHidden: true,
    }),
};

export const mailAttachments: Category = {
  id: "mail-attachments",
  label: "Mail attachments",
  group: "risky",
  description: "Attachments downloaded and cached by Mail.app.",
  warning: "May contain documents you still need.",
  scan: (ctx): Promise<ScanItem[]> =>
    listChildren(
      home(ctx, "Library/Containers/com.apple.mail/Data/Library/Mail Downloads"),
      ctx,
    ),
};
