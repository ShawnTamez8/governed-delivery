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
      // Someone else holds or held it: read and judge.
      let content: string;
      try {
        content = readFileSync(lockPath, "utf8");
      } catch (err2) {
        if ((err2 as NodeJS.ErrnoException).code === "ENOENT") continue; // raced away; retry
        throw err2;
      }
      const pidM = /^pid=(\d+)/m.exec(content);
      if (!pidM) {
        // Partial or foreign content: never take over what we cannot judge.
        throw new Error(
          `lock file at ${lockPath} is unreadable; remove it manually if no invocation is running`
        );
      }
      if (isAlive(Number(pidM[1]))) {
        const sinceM = /^created_at=(.+)$/m.exec(content);
        const since = sinceM ? sinceM[1] : "unknown";
        throw new Error(
          `another invocation (pid ${pidM[1]}, held since ${since}) holds the lock at ${lockPath}`
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
