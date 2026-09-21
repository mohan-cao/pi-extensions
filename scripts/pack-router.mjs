import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });

const result = spawnSync(
  "npm",
  ["pack", "./packages/pi-jev-response-router", "--pack-destination", "./artifacts"],
  { stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
