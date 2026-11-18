// Runs Vitest from a normalized working directory.
// On Windows a lowercase drive letter (c:\ vs C:\, common in VS Code terminals) makes Vitest load two copies
// of its runner, and every suite fails with "Cannot read properties of undefined (reading 'config')".
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const upperDrive = (path) => (process.platform === "win32" ? path.replace(/^[a-z]:/, (drive) => drive.toUpperCase()) : path);
const cwd = upperDrive(process.cwd());
const vitestBin = upperDrive(fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)));
const result = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], { cwd, stdio: "inherit" });

process.exit(result.status ?? 1);
