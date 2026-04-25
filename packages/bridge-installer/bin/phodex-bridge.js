#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { delimiter, resolve } from "node:path";

const DEFAULT_INSTALL_DIR = resolve(homedir(), ".phodex-bridge");
const DEFAULT_PID_FILE = "bridge.pid";
const DEFAULT_ENV_FILE = "bridge.env";
const DEFAULT_LOG_FILE = "logs/bridge.log";
const DEFAULT_RUNTIME_FILE = "current/bridge-runtime.ts";
const DEFAULT_METADATA_FILE = "current/install.json";
const SYSTEM_CA_BUNDLE_CANDIDATES = ["/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem"];
const DEFAULT_CODEX_WS_URL = "ws://127.0.0.1:8765";
const DEFAULT_CODEX_READY_URL = DEFAULT_CODEX_WS_URL.replace(/^ws/i, "http") + "/readyz";
const PERSISTED_RUNTIME_ENV_KEYS = [
  "ALL_PROXY",
  "ASDF_DATA_DIR",
  "ASDF_DIR",
  "CARGO_HOME",
  "GEM_HOME",
  "GEM_PATH",
  "GOPATH",
  "GOROOT",
  "HOMEBREW_CELLAR",
  "HOMEBREW_PREFIX",
  "HOMEBREW_REPOSITORY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "JAVA_HOME",
  "NVM_BIN",
  "NVM_DIR",
  "PATH",
  "PNPM_HOME",
  "PYENV_ROOT",
  "RBENV_ROOT",
  "RUSTUP_HOME",
  "SDKMAN_DIR",
  "SSH_AUTH_SOCK",
  "VOLTA_HOME",
];
const LAUNCH_AGENT_ENV_KEYS = new Set([
  "ALL_PROXY",
  "ASDF_DATA_DIR",
  "ASDF_DIR",
  "CARGO_HOME",
  "DISPLAY",
  "GEM_HOME",
  "GEM_PATH",
  "GOPATH",
  "GOROOT",
  "HOME",
  "HOMEBREW_CELLAR",
  "HOMEBREW_PREFIX",
  "HOMEBREW_REPOSITORY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "JAVA_HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "NODE_EXTRA_CA_CERTS",
  "NVM_BIN",
  "NVM_DIR",
  "PATH",
  "PNPM_HOME",
  "PYENV_ROOT",
  "RBENV_ROOT",
  "RUSTUP_HOME",
  "SHELL",
  "SDKMAN_DIR",
  "SSH_AUTH_SOCK",
  "SSL_CERT_FILE",
  "TERM",
  "TMPDIR",
  "VOLTA_HOME",
]);

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
  const setup = await resolveInstallSetup(relayOrigin, args.options.token, args.options.secret);
  const bunBin = resolveBunBinary();
  const macLabel = args.options["mac-label"] || hostname();
  const explicitCodexWsUrl = normalizeCodexWsUrl(args.options["codex-ws-url"]);
  const detectedCodexWsUrl = explicitCodexWsUrl || (await detectExistingCodexWsUrl());

  mkdirSync(installDir, { recursive: true });
  mkdirSync(resolve(installDir, "current"), { recursive: true });
  mkdirSync(resolve(installDir, "logs"), { recursive: true });
  mkdirSync(resolve(installDir, "data"), { recursive: true });

  const runtimeUrl = setup.bridgeRuntimeUrl;
  const runtimeResponse = await fetch(runtimeUrl);
  if (!runtimeResponse.ok) {
    throw new Error(`Failed to download bridge runtime: ${runtimeResponse.status} ${runtimeResponse.statusText}`);
  }
  const runtimeSource = await runtimeResponse.text();
  writeFileSync(resolve(installDir, DEFAULT_RUNTIME_FILE), runtimeSource, "utf8");

  const envLines = [
    `PHODEX_RELAY_URL=${setup.relayOrigin}`,
    `PHODEX_BRIDGE_TOKEN=${setup.bridgeToken}`,
    `PHODEX_RELAY_LABEL=${setup.relayLabel}`,
    `PHODEX_MAC_LABEL=${macLabel}`,
    `PHODEX_STATE_FILE=${resolve(installDir, "data", "bridge-state.json")}`,
  ];

  if (args.options["codex-bin"]) {
    envLines.push(`PHODEX_CODEX_BIN=${args.options["codex-bin"]}`);
  }

  if (detectedCodexWsUrl) {
    envLines.push(`PHODEX_CODEX_WS_URL=${detectedCodexWsUrl}`);
    envLines.push("PHODEX_MANAGE_CODEX=false");
  }

  appendPersistedRuntimeEnv(envLines, process.env);

  const autoCaBundle = chooseSystemCaBundle(setup.relayOrigin);
  if (autoCaBundle) {
    envLines.push(`SSL_CERT_FILE=${autoCaBundle}`);
    envLines.push(`NODE_EXTRA_CA_CERTS=${autoCaBundle}`);
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
  const health = await waitForRelayBridgeHealth(setup.relayOrigin, setup.bridgeToken);

  console.log(`[phodex-bridge] Installed to ${installDir}`);
  console.log(`[phodex-bridge] Runtime ${resolve(installDir, DEFAULT_RUNTIME_FILE)}`);
  console.log(`[phodex-bridge] Log ${resolve(installDir, DEFAULT_LOG_FILE)}`);
  console.log(`[phodex-bridge] PID ${pid}`);
  if (health?.bridgeConnected) {
    console.log(`[phodex-bridge] Relay connected to ${setup.relayOrigin}`);
  } else if (health?.invalidBridgeToken) {
    stopInstalledBridge(installDir);
    throw new Error(
      health.error ||
        "Relay rejected this bridge token. Copy the latest install command from the signed-in phone session and run it again."
    );
  } else {
    console.log("[phodex-bridge] Started, but the relay has not confirmed the bridge within 6 seconds. Check bridge.log.");
  }
}

function appendPersistedRuntimeEnv(envLines, sourceEnv) {
  for (const key of PERSISTED_RUNTIME_ENV_KEYS) {
    const value = sourceEnv[key];
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    envLines.push(`${key}=${value}`);
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

function normalizeCodexWsUrl(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

async function detectExistingCodexWsUrl() {
  try {
    const response = await fetch(DEFAULT_CODEX_READY_URL);
    if (response.ok) {
      return DEFAULT_CODEX_WS_URL;
    }
  } catch {
    // Fall back to managed Codex when no local app-server is listening.
  }
  return "";
}

function chooseSystemCaBundle(relayOrigin) {
  if (process.env.SSL_CERT_FILE?.trim()) {
    return process.env.SSL_CERT_FILE.trim();
  }

  try {
    const url = new URL(relayOrigin);
    if (url.protocol !== "https:" || isLocalRelayHost(url.hostname)) {
      return "";
    }
  } catch {
    return "";
  }

  for (const candidate of SYSTEM_CA_BUNDLE_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function isLocalRelayHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function resolveBunBinary() {
  const candidates = [];

  if (typeof Bun.which === "function") {
    const bunFromPath = Bun.which("bun");
    if (bunFromPath) {
      candidates.push(bunFromPath);
    }
  }

  if (process.env.BUN_INSTALL?.trim()) {
    candidates.push(resolve(process.env.BUN_INSTALL.trim(), "bin", "bun"));
  }

  candidates.push(
    process.execPath,
    resolve(homedir(), ".bun", "bin", "bun"),
    resolve(homedir(), ".bun", "bin", "bun.exe"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    "/usr/bin/bun",
    "/bin/bun"
  );

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(readMissingBunMessage());
}

async function resolveInstallSetup(relayOrigin, setupToken, explicitSecret) {
  if (explicitSecret) {
    return {
      relayOrigin,
      relayLabel: "Phodex Public Relay",
      bridgeRuntimeUrl: new URL("/install/bridge-runtime.ts", relayOrigin).toString(),
      bridgeToken: explicitSecret,
    };
  }

  const token = typeof setupToken === "string" && setupToken.trim() ? setupToken.trim() : "";
  if (!token) {
    throw new Error("Missing setup token. Copy the install command from the signed-in phone session.");
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
  if (!payload?.bridgeRuntimeUrl || !payload?.bridgeToken || !payload?.relayOrigin) {
    throw new Error("Install setup claim response is missing runtime URL, relay origin, or bridge token.");
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
  const env = sanitizeBridgeEnv(
    {
      ...process.env,
      ...readEnvFile(envFile),
    },
    runtimeFile
  );

  if (!existsSync(runtimeFile)) {
    throw new Error(`Missing runtime file at ${runtimeFile}`);
  }

  if (process.platform === "darwin") {
    const pid = startBridgeViaLaunchAgent(installDir, runtimeFile, logFile, env);
    writeFileSync(pidFile, `${pid}\n`, "utf8");
    return pid;
  }

  const stdoutFd = openSync(logFile, "a");
  const stderrFd = openSync(logFile, "a");
  const launched = spawn(bunBin, [runtimeFile], {
    cwd: installDir,
    env,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
  });
  launched.unref();
  closeSync(stdoutFd);
  closeSync(stderrFd);

  const pid = launched.pid;
  if (!Number.isFinite(pid)) {
    throw new Error("Failed to capture local bridge PID.");
  }

  writeFileSync(pidFile, `${pid}\n`, "utf8");
  return pid;
}

function sanitizeBridgeEnv(env, runtimeFile) {
  const next = { ...env };

  for (const key of Object.keys(next)) {
    if (key === "BUN_INTERNAL_BUNX_INSTALL" || key.startsWith("npm_")) {
      delete next[key];
    }
  }

  if (typeof next.PATH === "string" && next.PATH) {
    next.PATH = next.PATH
      .split(delimiter)
      .filter((segment) => segment && !segment.includes("/tmp/bunx-") && !segment.includes("/private/tmp/bunx-"))
      .join(delimiter);
  }

  next._ = runtimeFile;
  return next;
}

function stopInstalledBridge(installDir) {
  if (process.platform === "darwin") {
    const stopped = stopBridgeLaunchAgent(installDir);
    const pidFile = resolve(installDir, DEFAULT_PID_FILE);
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
    return stopped;
  }

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
  const pid =
    process.platform === "darwin"
      ? readLaunchAgentPid(buildLaunchAgentLabel(installDir))
      : existsSync(pidFile)
        ? Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10)
        : null;
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
    const response = await fetch(new URL("/api/health", relayOrigin), {
      headers: env.PHODEX_BRIDGE_TOKEN ? { "x-phodex-bridge-token": env.PHODEX_BRIDGE_TOKEN } : {},
    });
    const text = await response.text();
    console.log(`[phodex-bridge] Relay health ${response.status}: ${text}`);
  } catch (error) {
    console.log(`[phodex-bridge] Relay health error: ${readErrorMessage(error)}`);
  }
}

async function waitForRelayBridgeHealth(relayOrigin, bridgeToken) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(new URL("/api/health", relayOrigin), {
        headers: bridgeToken ? { "x-phodex-bridge-token": bridgeToken } : {},
      });
      if (response.status === 401) {
        return {
          bridgeConnected: false,
          invalidBridgeToken: true,
          error: await readResponseError(
            response,
            "Relay rejected this bridge token. Copy the latest install command from the signed-in phone session and run it again."
          ),
        };
      }
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

function startBridgeViaLaunchAgent(installDir, runtimeFile, logFile, env) {
  const label = buildLaunchAgentLabel(installDir);
  const plistPath = resolveLaunchAgentPlistPath(label);
  const domain = buildLaunchAgentDomain(label);

  mkdirSync(resolve(homedir(), "Library/LaunchAgents"), { recursive: true });
  writeFileSync(plistPath, buildLaunchAgentPlist(label, installDir, runtimeFile, logFile, env), "utf8");

  spawnSync("launchctl", ["bootout", domain], { stdio: "ignore" });

  const bootstrap = spawnSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath], {
    encoding: "utf8",
  });
  if (bootstrap.status !== 0) {
    throw new Error((bootstrap.stderr || bootstrap.stdout || "Failed to bootstrap launch agent.").trim());
  }

  const kickstart = spawnSync("launchctl", ["kickstart", "-k", domain], {
    encoding: "utf8",
  });
  if (kickstart.status !== 0) {
    throw new Error((kickstart.stderr || kickstart.stdout || "Failed to start launch agent.").trim());
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pid = readLaunchAgentPid(label);
    if (pid) {
      return pid;
    }
    Bun.sleepSync(100);
  }

  return 0;
}

function stopBridgeLaunchAgent(installDir) {
  const label = buildLaunchAgentLabel(installDir);
  const plistPath = resolveLaunchAgentPlistPath(label);
  const domain = buildLaunchAgentDomain(label);
  const bootout = spawnSync("launchctl", ["bootout", domain], {
    encoding: "utf8",
  });

  if (existsSync(plistPath)) {
    rmSync(plistPath, { force: true });
  }

  return bootout.status === 0 || bootout.status === null;
}

function buildLaunchAgentLabel(installDir) {
  return `com.phodex.bridge.${createHash("sha1").update(installDir).digest("hex").slice(0, 12)}`;
}

function resolveLaunchAgentPlistPath(label) {
  return resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
}

function buildLaunchAgentDomain(label) {
  return `gui/${process.getuid()}/${label}`;
}

function readLaunchAgentPid(label) {
  const printed = spawnSync("launchctl", ["print", buildLaunchAgentDomain(label)], {
    encoding: "utf8",
  });
  if (printed.status !== 0) {
    return null;
  }

  const match = printed.stdout.match(/\bpid = (\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function buildLaunchAgentPlist(label, installDir, runtimeFile, logFile, env) {
  const launchEnv = selectLaunchAgentEnv(env);
  const programArguments = [
    "/usr/bin/env",
    "-i",
    ...Object.entries(launchEnv).map(([key, value]) => `${key}=${String(value)}`),
    runtimeFile,
  ];
  const programArgumentsXml = programArguments.map((value) => `    <string>${xmlEscape(value)}</string>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${xmlEscape(installDir)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgumentsXml}
  </array>
  <key>StandardOutPath</key><string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(logFile)}</string>
</dict>
</plist>
`;
}

function selectLaunchAgentEnv(env) {
  const next = {};

  for (const [key, value] of Object.entries(env)) {
    if (!value) {
      continue;
    }
    if (key.startsWith("PHODEX_") || LAUNCH_AGENT_ENV_KEYS.has(key)) {
      next[key] = value;
    }
  }

  return next;
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

function readMissingBunMessage() {
  return process.platform === "win32"
    ? 'bun is required to run phodex-bridge. Install it first with the official command: powershell -c "irm bun.sh/install.ps1 | iex"'
    : "bun is required to run phodex-bridge. Install it first with the official command: curl -fsSL https://bun.com/install | bash";
}
