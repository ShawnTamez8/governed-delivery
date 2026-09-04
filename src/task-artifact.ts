import { normalizePath } from "./scope.ts";

/**
 * Task execution and status are authoritative run-state rows, never Markdown
 * artifacts. Match by final path segment so the rule is independent of where
 * a model proposes the file, and fold case because supported filesystems may.
 */
export function isTaskDocumentPath(path: string): boolean {
  const segments = normalizePath(path).split("/");
  return segments.at(-1)?.toLowerCase() === "tasks.md";
}
