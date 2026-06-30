import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";

const HOME = os.homedir();

const PROTECTED_PREFIXES = [
  "/System",
  "/usr",
  "/bin",
  "/sbin",
  "/etc",
  "/var/db",
  "/var/root",
  "/private/var/db",
  "/private/var/root",
  "/Library/Apple",
  "/Applications",
  "/cores",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
];

const PROTECTED_EXACT = new Set([
  "/",
  HOME,
  path.join(HOME, "Library"),
  path.join(HOME, "Documents"),
  path.join(HOME, "Downloads"),
  path.join(HOME, "Desktop"),
  path.join(HOME, "Movies"),
  path.join(HOME, "Music"),
  path.join(HOME, "Pictures"),
  path.join(HOME, "Library", "Caches"),
  path.join(HOME, "Library", "Logs"),
  path.join(HOME, "Library", "Application Support"),
  path.join(HOME, "Library", "Containers"),
  path.join(HOME, "Library", "Group Containers"),
  path.join(HOME, "Library", "Developer"),
  path.join(HOME, ".Trash"),
]);

const ALLOWED_ROOTS = [
  HOME,
  "/tmp",
  "/private/tmp",
  "/var/tmp",
  "/private/var/tmp",
  "/var/folders",
  "/private/var/folders",
];

export interface Verdict {
  allowed: boolean;
  reason?: string;
}

// A directly installed app bundle, e.g. /Applications/Foo.app (not nested,
// not /Applications/Utilities). These may be moved to the Trash (recoverable).
export function isUserApp(p: string): boolean {
  const prefix = "/Applications/";
  if (!p.startsWith(prefix)) return false;
  const rest = p.slice(prefix.length);
  return rest.endsWith(".app") && !rest.includes("/");
}

export function checkPathAllowed(rawPath: string): Verdict {
  if (!rawPath) return { allowed: false, reason: "Empty path." };
  const p = path.normalize(rawPath);
  if (!path.isAbsolute(p)) return { allowed: false, reason: "Path is not absolute." };
  if (p.includes("\0")) return { allowed: false, reason: "Illegal character in path." };
  if (PROTECTED_EXACT.has(p)) return { allowed: false, reason: `Protected directory: ${p}` };
  if (isUserApp(p)) return { allowed: true };

  for (const prefix of PROTECTED_PREFIXES) {
    if (p === prefix || p.startsWith(prefix + "/")) {
      return { allowed: false, reason: `Protected system area: ${prefix}` };
    }
  }

  const inAllowed = ALLOWED_ROOTS.some((r) => p === r || p.startsWith(r + "/"));
  if (!inAllowed) {
    return { allowed: false, reason: "Path outside the allowed area (home / temp)." };
  }
  return { allowed: true };
}

// Full pre-deletion check: textual rules + the path must come from a scan
// result + a fresh lstat (guards against TOCTOU / symlink swaps).
export async function validateForDeletion(
  rawPath: string,
  allowedSet: Set<string>,
): Promise<Verdict> {
  const p = path.normalize(rawPath);
  const textual = checkPathAllowed(p);
  if (!textual.allowed) return textual;

  if (!allowedSet.has(p)) {
    return { allowed: false, reason: "Path did not come from a scan result." };
  }

  try {
    await fs.lstat(p);
  } catch {
    return { allowed: false, reason: "File no longer exists." };
  }
  return { allowed: true };
}

export function generateToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
