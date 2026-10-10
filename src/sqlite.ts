import type { DatabaseSync, DatabaseSyncOptions } from "node:sqlite";

let sqlite: typeof import("node:sqlite") | undefined;

/**
 * Open a database, loading `node:sqlite` on first use rather than at import.
 * Node prints "SQLite is an experimental feature" on stderr the moment that
 * module loads, so a static import made every command print it, including
 * the dashboard at startup, which opens no state. Loading here keeps a command
 * that never opens a database silent, and the filter hides that one notice
 * for the commands that do. It is installed only around the load, and every
 * other warning passes through untouched.
 */
export function openDatabase(path: string, options?: DatabaseSyncOptions): DatabaseSync {
  if (sqlite === undefined) {
    const emitWarning = process.emitWarning;
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      const text = typeof warning === "string" ? warning : warning.message;
      if (text.startsWith("SQLite is an experimental feature")) return;
      return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
    }) as typeof process.emitWarning;
    try {
      sqlite = process.getBuiltinModule("node:sqlite");
    } finally {
      process.emitWarning = emitWarning;
    }
  }
  // Node refuses an explicit `undefined` for the options argument.
  return options === undefined ? new sqlite.DatabaseSync(path) : new sqlite.DatabaseSync(path, options);
}
