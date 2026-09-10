import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lockDir } from "./paths.ts";

const LOCK_FILE = "lock";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface LockObservation {
  status: "absent" | "live" | "dead" | "unreadable";
  path: string;
  pid: number | null;
  createdAt: string | null;
  reason: string | null;
}

export function inspectLock(rootDir: string = process.cwd()): LockObservation {
  const path = join(lockDir(rootDir), LOCK_FILE);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "absent", path, pid: null, createdAt: null, reason: null };
    }
    return { status: "unreadable", path, pid: null, createdAt: null,
      reason: error instanceof Error ? error.message : String(error) };
  }
  const pidMatch = /^pid=(\d+)/m.exec(content);
  const createdAt = /^created_at=(.+)$/m.exec(content)?.[1] ?? null;
  if (!pidMatch) {
    return { status: "unreadable", path, pid: null, createdAt,
      reason: `lock file at ${path} is unreadable; remove it manually if no invocation is running` };
  }
  const pid = Number(pidMatch[1]);
  return { status: isAlive(pid) ? "live" : "dead", path, pid, createdAt, reason: null };
}

/**
 * One writer per repository (architecture section 19). Returns a release
 * function that removes the lock only if the file still carries this
 * invocation's token. A live holder fails fast with a diagnostic naming the
 * pid and how long it has held the lock; a dead holder's file is stale and
 * gets taken over; an unreadable file fails fast rather than guessing.
 */
export function acquireLock(rootDir: string = process.cwd()): () => void {
  const dir = lockDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, LOCK_FILE);
  const token = `${process.pid}-${randomBytes(6).toString("hex")}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, `pid=${process.pid}\ntoken=${token}\ncreated_at=${new Date().toISOString()}\n`);
      } finally {
        closeSync(fd);
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const observed = inspectLock(rootDir);
      if (observed.status === "absent") continue;
      if (observed.status === "unreadable") throw new Error(observed.reason!);
      if (observed.status === "live") {
        throw new Error(
          `another invocation (pid ${observed.pid}, held since ${observed.createdAt ?? "unknown"}) holds the lock at ${lockPath}`
        );
      }
      try {
        unlinkSync(lockPath);
      } catch (err2) {
        if ((err2 as NodeJS.ErrnoException).code !== "ENOENT") throw err2;
      }
    }
  }
  return () => {
    try {
      const content = readFileSync(lockPath, "utf8");
      if (content.includes(`token=${token}`)) unlinkSync(lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  };
}
