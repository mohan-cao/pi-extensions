import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });

// `pnpm pack` (not `npm pack`) rewrites the `workspace:` protocol to a concrete
// range, which npm consumers can actually resolve. The `--filter` form is
// required: `pnpm pack <folder>` packs the root workspace instead.
const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@mohan-cao/pi-jev-response-router",
    "pack",
    "--pack-destination",
    "./artifacts",
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
