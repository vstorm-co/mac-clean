import { promises as fs, type Dirent } from "node:fs";

export interface Stat {
  size: number;
  mtime: number | null;
  kind: "file" | "dir" | "symlink";
}

export function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "EACCES" || code === "EPERM";
}

export async function lstatSafe(p: string): Promise<Stat | null> {
  try {
    const st = await fs.lstat(p);
    const kind = st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file";
    return { size: st.size, mtime: st.mtimeMs, kind };
  } catch {
    return null;
  }
}

export async function readdirSafe(p: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}
