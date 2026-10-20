// Imported through NODE_OPTIONS by a test that spawns the CLI: every `docker`
// spawn in that process runs the stand-in beside this file instead, because
// `new-run` freezes the seeded `["docker"]` and the suite must not need an
// engine (docs/features/sandboxed-implementer/plan.md, Task 4). The pattern is
// the one test/cli-operator.test.ts's version-probe preload uses.
import childProcess from "node:child_process";
import { basename } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

const STAND_IN = fileURLToPath(new URL("./docker-stand-in.mjs", import.meta.url));
const isDocker = (command) => typeof command === "string" && /^docker(?:\.exe)?$/i.test(basename(command));
const nativeSpawnSync = childProcess.spawnSync;
const nativeSpawn = childProcess.spawn;
childProcess.spawnSync = (command, args, options) =>
  isDocker(command)
    ? nativeSpawnSync(process.execPath, [STAND_IN, ...(Array.isArray(args) ? args : [])], Array.isArray(args) ? options : args)
    : nativeSpawnSync(command, args, options);
childProcess.spawn = (command, args, options) =>
  isDocker(command)
    ? nativeSpawn(process.execPath, [STAND_IN, ...(Array.isArray(args) ? args : [])], Array.isArray(args) ? options : args)
    : nativeSpawn(command, args, options);
syncBuiltinESMExports();
