#!/usr/bin/env bun

import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { resolve } from "node:path";

const DEFAULT_INSTALL_DIR = resolve(homedir(), ".phodex-bridge");
const DEFAULT_PID_FILE = "bridge.pid";
const DEFAULT_ENV_FILE = "bridge.env";
const DEFAULT_LOG_FILE = "logs/bridge.log";
const DEFAULT_RUNTIME_FILE = "current/bridge-runtime.js";
const DEFAULT_METADATA_FILE = "current/install.json";

main().catch((error) => {
  console.error(`[phodex-bridge] ${readErrorMessage(error)}`);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0] ?? "install";

  if (command === "stop") {
    const installDir = resolveInstallDir(args.options.dir);
    const stopped = stopInstalledBridge(installDir);
    console.log(stopped ? "[phodex-bridge] Stopped local bridge." : "[phodex-bridge] No running bridge process found.");
    return;
  }

  if (command === "status") {
    const installDir = resolveInstallDir(args.options.dir);
    await printStatus(installDir, normalizeRelayOrigin(args.options.relay));
    return;
  }

  if (command !== "install" && command !== "start") {
    printUsage();
    process.exit(2);
  }

  const installDir = resolveInstallDir(args.options.dir);
  const relayOrigin = resolveRelayOrigin(installDir, args.options.relay);
  const manifest = await fetchInstallManifest(relayOrigin);
  const setup = await resolveInstallSetup(relayOrigin, manifest, args.options.token, args.options.secret);
  const bunBin = process.execPath;
  const macLabel = args.options["mac-label"] || hostname();

  mkdirSync(installDir, { recursive: true });
  mkdirSync(resolve(installDir, "current"), { recursive: true });
  mkdirSync(resolve(installDir, "logs"), { recursive: true });
  mkdirSync(resolve(installDir, "data"), { recursive: true });

  const runtimeUrl = setup.bridgeRuntimeUrl || manifest.bridgeRuntimeUrl;
  const runtimeResponse = await fetch(runtimeUrl);
  if (!runtimeResponse.ok) {
    throw new Error(`Failed to download bridge runtime: ${runtimeResponse.status} ${runtimeResponse.statusText}`);
  }
  const runtimeSource = await runtimeResponse.text();
  writeFileSync(resolve(installDir, DEFAULT_RUNTIME_FILE), runtimeSource, "utf8");

  const envLines = [
    `PHODEX_RELAY_URL=${setup.relayOrigin}`,
    `PHODEX_BRIDGE_SECRET=${setup.bridgeSecret}`,
    `PHODEX_RELAY_LABEL=${setup.relayLabel}`,
    `PHODEX_MAC_LABEL=${macLabel}`,
    `PHODEX_STATE_FILE=${resolve(installDir, "data", "bridge-state.json")}`,
  ];

  if (args.options["codex-bin"]) {
    envLines.push(`PHODEX_CODEX_BIN=${args.options["codex-bin"]}`);
  }

  if (args.options["codex-ws-url"]) {
    envLines.push(`PHODEX_CODEX_WS_URL=${args.options["codex-ws-url"]}`);
    envLines.push("PHODEX_MANAGE_CODEX=false");
  }

  writeFileSync(resolve(installDir, DEFAULT_ENV_FILE), `${envLines.join("\n")}\n`, "utf8");
  writeFileSync(
    resolve(installDir, DEFAULT_METADATA_FILE),
    JSON.stringify(
      {
        relayOrigin: setup.relayOrigin,
        bridgeRuntimeUrl: runtimeUrl,
        relayLabel: setup.relayLabel,
        installedAt: new Date().toISOString(),
        bunBin,
      },
      null,
      2
    ),
    "utf8"
  );

  stopInstalledBridge(installDir);
  const pid = startInstalledBridge(installDir, bunBin);
  const health = await waitForRelayBridgeHealth(setup.relayOrigin);

  console.log(`[phodex-bridge] Installed to ${installDir}`);
  console.log(`[phodex-bridge] Runtime ${resolve(installDir, DEFAULT_RUNTIME_FILE)}`);
  console.log(`[phodex-bridge] Log ${resolve(installDir, DEFAULT_LOG_FILE)}`);
  console.log(`[phodex-bridge] PID ${pid}`);
  if (health?.bridgeConnected) {
    console.log(`[phodex-bridge] Relay connected to ${setup.relayOrigin}`);
  } else {
    console.log("[phodex-bridge] Started, but relay health has not reported the bridge yet.");
  }
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  phodex-bridge install --relay <origin> [--token <setup-token>] [--dir <path>] [--mac-label <label>]",
      "  phodex-bridge start --relay <origin> [--token <setup-token>] [--dir <path>] [--mac-label <label>]",
      "  phodex-bridge stop [--dir <path>]",
      "  phodex-bridge status [--dir <path>] [--relay <origin>]",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { positionals, options };
}

function resolveInstallDir(dir) {
  return dir ? resolve(dir) : DEFAULT_INSTALL_DIR;
}

function resolveRelayOrigin(installDir, explicitRelay) {
  const normalized = normalizeRelayOrigin(explicitRelay);
  if (normalized) {
    return normalized;
  }

  const envFile = resolve(installDir, DEFAULT_ENV_FILE);
  if (existsSync(envFile)) {
    const env = readEnvFile(envFile);
    const existing = normalizeRelayOrigin(env.PHODEX_RELAY_URL);
    if (existing) {
      return existing;
    }
  }

  throw new Error("Missing --relay. Use the relay origin from the phone onboarding screen.");
}

function normalizeRelayOrigin(value) {
  if (!value) {
    return "";
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

async function fetchInstallManifest(relayOrigin) {
  const response = await fetch(new URL("/install/manifest.json", relayOrigin));
  if (!response.ok) {
    throw new Error(`Failed to load install manifest: ${response.status} ${response.statusText}`);
  }

  const manifest = await response.json();
  if (!manifest?.installerUrl || !manifest?.command) {
    throw new Error("Install manifest is missing installer metadata.");
  }

  return manifest;
}

async function resolveInstallSetup(relayOrigin, manifest, setupToken, explicitSecret) {
  if (explicitSecret) {
    return {
      relayOrigin: normalizeRelayOrigin(manifest.relayOrigin) || relayOrigin,
      relayLabel: manifest.relayLabel || "Phodex Public Relay",
      bridgeRuntimeUrl: manifest.bridgeRuntimeUrl || new URL("/install/bridge-runtime.js", relayOrigin).toString(),
      bridgeSecret: explicitSecret,
    };
  }

  const token = typeof setupToken === "string" && setupToken.trim() ? setupToken.trim() : manifest.setupToken;
  if (!token) {
    throw new Error("Missing setup token. Re-copy the command from the phone onboarding screen.");
  }

  return await claimInstallSetup(relayOrigin, token);
}

async function claimInstallSetup(relayOrigin, token) {
  const response = await fetch(new URL("/install/claim", relayOrigin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    const message = await readResponseError(response, "Failed to claim install setup");
    throw new Error(message);
  }

  const payload = await response.json();
  if (!payload?.bridgeRuntimeUrl || !payload?.bridgeSecret || !payload?.relayOrigin) {
    throw new Error("Install setup claim response is missing runtime URL, relay origin, or bridge secret.");
  }
  return payload;
}

async function readResponseError(response, fallback) {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // ignore json parse errors
  }
  return `${fallback}: ${response.status} ${response.statusText}`;
}

function startInstalledBridge(installDir, bunBin) {
  const runtimeFile = resolve(installDir, DEFAULT_RUNTIME_FILE);
  const envFile = resolve(installDir, DEFAULT_ENV_FILE);
  const pidFile = resolve(installDir, DEFAULT_PID_FILE);
  const logFile = resolve(installDir, DEFAULT_LOG_FILE);
  const env = {
    ...process.env,
    ...readEnvFile(envFile),
  };

  if (!existsSync(runtimeFile)) {
    throw new Error(`Missing runtime file at ${runtimeFile}`);
  }

  const logFd = openSync(logFile, "a");
  const child = spawn(bunBin, [runtimeFile], {
    cwd: installDir,
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  child.unref();

  writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  return child.pid;
}

function stopInstalledBridge(installDir) {
  const pidFile = resolve(installDir, DEFAULT_PID_FILE);
  if (!existsSync(pidFile)) {
    return false;
  }

  const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  if (!Number.isFinite(pid)) {
    unlinkSync(pidFile);
    return false;
  }

  const alive = isPidAlive(pid);
  if (!alive) {
    unlinkSync(pidFile);
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    unlinkSync(pidFile);
    return false;
  }

  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      unlinkSync(pidFile);
      return true;
    }
    Bun.sleepSync(100);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }

  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }
  return true;
}

async function printStatus(installDir, relayOriginOverride) {
  const pidFile = resolve(installDir, DEFAULT_PID_FILE);
  const envFile = resolve(installDir, DEFAULT_ENV_FILE);
  const metadataFile = resolve(installDir, DEFAULT_METADATA_FILE);
  const env = existsSync(envFile) ? readEnvFile(envFile) : {};
  const relayOrigin = relayOriginOverride || normalizeRelayOrigin(env.PHODEX_RELAY_URL);
  const pid = existsSync(pidFile) ? Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10) : null;
  const running = pid ? isPidAlive(pid) : false;

  console.log(`[phodex-bridge] Install dir ${installDir}`);
  console.log(`[phodex-bridge] PID ${pid ?? "none"} (${running ? "running" : "stopped"})`);
  console.log(`[phodex-bridge] Relay ${relayOrigin || "unknown"}`);

  if (existsSync(metadataFile)) {
    console.log(`[phodex-bridge] Metadata ${metadataFile}`);
  }

  if (!relayOrigin) {
    return;
  }

  try {
    const response = await fetch(new URL("/api/health", relayOrigin));
    const text = await response.text();
    console.log(`[phodex-bridge] Relay health ${response.status}: ${text}`);
  } catch (error) {
    console.log(`[phodex-bridge] Relay health error: ${readErrorMessage(error)}`);
  }
}

async function waitForRelayBridgeHealth(relayOrigin) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(new URL("/api/health", relayOrigin));
      if (response.ok) {
        const payload = await response.json();
        if (payload?.bridgeConnected) {
          return payload;
        }
      }
    } catch {
      // ignore and retry
    }
    await Bun.sleep(500);
  }
  return null;
}

function readEnvFile(filePath) {
  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values[key] = value;
  }
  return values;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
