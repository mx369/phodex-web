#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type BridgeRuntimeTarget = {
  id: string;
  bunTarget: string;
  filename: string;
};

const currentFile = fileURLToPath(import.meta.url);
const packageDir = dirname(currentFile);
const repoRoot = resolve(packageDir, "../..");
const entrypoint = resolve(repoRoot, "apps/server/src/index.ts");
const packageJsonPath = resolve(packageDir, "package.json");
const outputDir = resolve(packageDir, "dist");
const manifestPath = resolve(outputDir, "manifest.json");

const targets: BridgeRuntimeTarget[] = [
  {
    id: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    filename: "phodex-bridge-runtime-darwin-arm64",
  },
  {
    id: "darwin-x64",
    bunTarget: "bun-darwin-x64",
    filename: "phodex-bridge-runtime-darwin-x64",
  },
  {
    id: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    filename: "phodex-bridge-runtime-linux-arm64",
  },
  {
    id: "linux-x64",
    bunTarget: "bun-linux-x64-baseline",
    filename: "phodex-bridge-runtime-linux-x64",
  },
];

main();

function main() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
  const version = packageJson.version || "0.1.0";

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const manifestTargets: Record<
    string,
    { filename: string; bunTarget: string; sha256: string; size: number }
  > = {};

  for (const target of targets) {
    const outfile = resolve(outputDir, target.filename);
    const result = spawnSync(
      process.execPath,
      [
        "build",
        "--compile",
        "--minify",
        "--bytecode",
        "--no-compile-autoload-dotenv",
        "--no-compile-autoload-bunfig",
        `--target=${target.bunTarget}`,
        `--outfile=${outfile}`,
        entrypoint,
      ],
      {
        cwd: repoRoot,
        stdio: "inherit",
      }
    );

    if (result.status !== 0) {
      process.exit(result.status || 1);
    }

    chmodSync(outfile, 0o755);
    const buffer = readFileSync(outfile);
    manifestTargets[target.id] = {
      filename: target.filename,
      bunTarget: target.bunTarget,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      size: buffer.length,
    };
  }

  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version,
        bunVersion: Bun.version,
        builtAt: new Date().toISOString(),
        sourceMtimeMs: statSync(entrypoint).mtimeMs,
        targets: manifestTargets,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`[phodex-bridge] Wrote ${manifestPath}`);
}
