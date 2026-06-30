export type Safety = "safe" | "moderate" | "risky";

export interface ScanItem {
  id: string;
  path: string;
  name: string;
  size: number;
  mtime: number | null;
  kind: "file" | "dir" | "symlink";
  note?: string;
  groupKey?: string;
  groupLabel?: string;
}

export interface ScanOptions {
  downloadsDaysOld: number;
  largeFileMinMB: number;
  largeFolderMinMB: number;
  duplicatesMinMB: number;
  minItemMB: number;
}

export const DEFAULT_OPTIONS: ScanOptions = {
  downloadsDaysOld: 30,
  largeFileMinMB: 200,
  largeFolderMinMB: 300,
  duplicatesMinMB: 5,
  minItemMB: 1,
};

export interface ScanContext {
  home: string;
  options: ScanOptions;
  onProgress: (message: string) => void;
  signal: AbortSignal;
}

export interface Category {
  id: string;
  label: string;
  group: Safety;
  description: string;
  warning?: string;
  scan: (ctx: ScanContext) => Promise<ScanItem[]>;
}

export interface CommandInspection {
  available: boolean;
  reason?: string;
  reclaimable: number;
  detail: string;
}

// A category whose space can only be reclaimed by running a tool's own command
// (e.g. `docker system prune`), not by moving individual files to the Trash.
// mac-clean only reports it and hands you the command to run yourself.
export interface CommandCategory {
  id: string;
  label: string;
  group: Safety;
  description: string;
  warning?: string;
  command: string;
  inspect: (ctx: ScanContext) => Promise<CommandInspection>;
}

export type AnyCategory = Category | CommandCategory;

export function isCommandCategory(c: AnyCategory): c is CommandCategory {
  return "command" in c;
}

export interface CategoryResult {
  id: string;
  label: string;
  group: Safety;
  items: ScanItem[];
  totalSize: number;
  count: number;
  error?: string;
  hint?: string;
}
