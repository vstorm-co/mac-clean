import { statfs } from "node:fs/promises";
import { duChildren } from "./du.js";

export interface DiskUsage {
  total: number;
  free: number;
  used: number;
}

export async function diskUsage(): Promise<DiskUsage> {
  const s = await statfs("/");
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  return { total, free, used: total - free };
}

export { duChildren };
