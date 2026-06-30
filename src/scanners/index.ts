import {
  trash,
  tempFiles,
  browserCache,
  systemCache,
  systemLogs,
  devCache,
  iosBackups,
  mailAttachments,
} from "./simple.js";
import { homebrew } from "./homebrew.js";
import { docker } from "./docker.js";
import { launchAgents } from "./launchAgents.js";
import { nodeModules } from "./nodeModules.js";
import { applications } from "./applications.js";
import { largeFolders } from "./largeFolders.js";
import { oldDownloads, largeFiles, duplicates } from "./userFiles.js";
import type { AnyCategory } from "./types.js";

export const CATEGORIES: AnyCategory[] = [
  trash,
  tempFiles,
  browserCache,
  homebrew,
  docker,
  systemCache,
  systemLogs,
  devCache,
  nodeModules,
  launchAgents,
  oldDownloads,
  largeFiles,
  largeFolders,
  applications,
  iosBackups,
  mailAttachments,
  duplicates,
];

export function getCategory(id: string): AnyCategory | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
