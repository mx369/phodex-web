import { spawnSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { buildPromptTraceKey, summarizePromptForTrace } from "@phodex/shared";
import type {
  AppSettings,
  AppSnapshot,
  AuthSession,
  BridgeDeviceSummary,
  BridgeCommand,
  BridgeDispatchEvent,
  BridgeEvent,
  ClientEvent,
  CompletionBanner,
  DeliveryMode,
  ProjectResourcePayload,
  RelayConnection,
  RequestCodeResponse,
  ServerEvent,
  ThreadHistoryState,
  ThreadMessage,
  ThreadRecord,
  UserSummary,
  VerifyCodeResponse,
} from "@phodex/shared";

type PersistedUser = {
  profile: UserSummary;
  settings: AppSettings;
  selectedThreadId: string | null;
  banner: CompletionBanner | null;
  bridgeDevices: Record<string, PersistedBridgeDevice>;
};

type PersistedBridgeDevice = {
  id: string;
  tokenHash: string;
  issuedAt: string;
  lastConnectedAt: string | null;
  macLabel: string | null;
};

type LegacyBridgeAuth = {
  tokenHash: string;
  issuedAt: string;
  lastConnectedAt: string | null;
};

type LegacyPersistedUser = Omit<PersistedUser, "bridgeDevices"> & {
  bridgeDevices?: Record<string, PersistedBridgeDevice> | null;
  bridgeAuth?: LegacyBridgeAuth | null;
};

type SessionRecord = {
  userId: string;
  expiresAt: string;
};

type OtpRecord = {
  code: string;
  expiresAt: string;
  delivery: DeliveryMode;
};

type PersistedState = {
  users: Record<string, PersistedUser>;
  sessions: Record<string, SessionRecord>;
  otpCodes: Record<string, OtpRecord>;
};

type ClientSocketData = {
  kind: "client";
  userId: string;
  token: string;
};

type BridgeSocketData = {
  kind: "bridge";
  userId: string;
  bridgeId: string;
};

type SocketData = ClientSocketData | BridgeSocketData;

type OtpMailConfig = {
  resendApiKey: string;
  authEmailFrom: string;
  sourceLabel: string;
};

type SetupTokenRecord = {
  userId: string;
  expiresAt: string;
  claimCount: number;
  lastClaimedAt: string | null;
};

type PendingProjectRequest = {
  userId: string;
  bridgeId: string;
  resolve: (value: ProjectResourcePayload) => void;
  reject: (error: Error & { status?: number }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingThreadCreateDispatch = {
  userId: string;
  requestId: string;
  timer: ReturnType<typeof setTimeout>;
};

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const serverRoot = resolve(currentDir, "..");
const appRoot = resolve(serverRoot, "../..");
const dataDir = resolve(serverRoot, "data");
const dataFile = process.env.PHODEX_STATE_FILE ?? resolve(dataDir, "relay-state.json");
const distDir = resolve(appRoot, "apps/web/dist");
const installAssetsDir = resolve(dataDir, "install-assets");
const bridgeRuntimeSourcePath = resolve(serverRoot, "src/index.ts");
const sharedPackageDir = resolve(appRoot, "packages/shared");
const sharedPackageJsonPath = resolve(sharedPackageDir, "package.json");
const sharedSourcePath = resolve(sharedPackageDir, "src/index.ts");
const bridgeInstallerPackageDir = resolve(appRoot, "packages/bridge-installer");
const bridgeInstallScriptSourcePath = resolve(bridgeInstallerPackageDir, "install.sh");
const bridgeInstallerSourcePath = resolve(bridgeInstallerPackageDir, "bin/phodex-bridge.js");
const bridgeInstallerPackageJsonPath = resolve(bridgeInstallerPackageDir, "package.json");

const HOST = process.env.PHODEX_HOST ?? "0.0.0.0";
const PORT = Number(process.env.PHODEX_PORT ?? "3443");
const THREAD_HISTORY_PAGE_SIZE = Math.max(1, Number(process.env.PHODEX_THREAD_HISTORY_PAGE_SIZE ?? "200"));
const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const INSTALL_SETUP_TOKEN_TTL_MS = 5 * 60 * 1000;
const RELAY_LABEL = process.env.PHODEX_RELAY_LABEL ?? "Phodex Public Relay";
const DEFAULT_MAC_LABEL = process.env.PHODEX_MAC_LABEL ?? hostname();
const AUTH_ENV_FALLBACK_FILE =
  process.env.PHODEX_AUTH_ENV_FILE ?? "/Users/young/mx/tmp/remote-terminal/.env.cloudflare";
const DEV_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://localhost:5173",
  "https://127.0.0.1:5173",
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `https://localhost:${PORT}`,
  `https://127.0.0.1:${PORT}`,
]);
const ALLOWED_ORIGINS = new Set(
  (process.env.PHODEX_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const OTP_MAIL_CONFIG = resolveOtpMailConfig();
const FLOW_TRACE_ENABLED = /^(1|true)$/i.test(process.env.PHODEX_FLOW_TRACE ?? "");

let persisted = loadState();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const clientsByUserId = new Map<string, Set<ServerWebSocket<SocketData>>>();
const threadMirrorsByUserId = new Map<string, Map<string, ThreadRecord>>();
const bridgeSocketsByUserId = new Map<string, Map<string, ServerWebSocket<SocketData>>>();
const installSetupTokens = new Map<string, SetupTokenRecord>();
const bridgeConnectionsByUserId = new Map<string, Map<string, RelayConnection>>();
const activeBridgeIdsByUserId = new Map<string, string>();
const selectedThreadHistoryWindowByUserId = new Map<string, number>();
const pendingProjectRequests = new Map<string, PendingProjectRequest>();
const pendingThreadCreateDispatches = new Map<string, PendingThreadCreateDispatch>();

function logFlowTrace(phase: string, details: Record<string, unknown> = {}) {
  if (!FLOW_TRACE_ENABLED) {
    return;
  }
  console.log(
    `[phodex-flow][relay] ${JSON.stringify({
      scope: "relay",
      ts: new Date().toISOString(),
      phase,
      ...details,
    })}`
  );
}

const server = Bun.serve<SocketData>({
  hostname: HOST,
  port: PORT,
  async fetch(req, serverInstance) {
    const url = new URL(req.url);

    if (url.pathname === "/relay") {
      const token = url.searchParams.get("token");
      refreshPersisted();
      const session = token ? persisted.sessions[token] : null;
      if (!token || !session || sessionExpired(session.expiresAt)) {
        return withCors(req, json({ ok: false, error: "Unauthorized" }, 401));
      }

      const upgraded = serverInstance.upgrade(req, {
        data: {
          kind: "client",
          token,
          userId: session.userId,
        } satisfies ClientSocketData,
      });
      return upgraded ? undefined : withCors(req, json({ ok: false, error: "Upgrade failed" }, 400));
    }

    if (url.pathname === "/bridge") {
      refreshPersisted();
      const bridgeToken = url.searchParams.get("token")?.trim() ?? "";
      const bridgeIdentity = resolveBridgeIdentity(bridgeToken);
      if (!bridgeIdentity) {
        return withCors(req, json({ ok: false, error: "Unauthorized" }, 401));
      }

      const upgraded = serverInstance.upgrade(req, {
        data: {
          kind: "bridge",
          userId: bridgeIdentity.userId,
          bridgeId: bridgeIdentity.bridgeId,
        } satisfies BridgeSocketData,
      });
      return upgraded ? undefined : withCors(req, json({ ok: false, error: "Upgrade failed" }, 400));
    }

    if (req.method === "OPTIONS") {
      return withCors(req, new Response(null, { status: 204 }));
    }

    if (url.pathname === "/api/health") {
      const healthIdentity = resolveHealthIdentity(req);
      if (healthIdentity.invalidBridgeToken) {
        return withCors(
          req,
          json(
            {
              ok: false,
              error: "Invalid bridge token. Copy the latest install command from the signed-in phone session and reinstall the bridge.",
            },
            401
          )
        );
      }

      const connection = healthIdentity.userId
        ? getBridgeConnection(healthIdentity.userId, healthIdentity.bridgeId)
        : disconnectedBridgeConnection();
      return withCors(
        req,
        json({
          ok: true,
          relay: RELAY_LABEL,
          bridgeConnected: healthIdentity.userId
            ? healthIdentity.bridgeId
              ? hasBridgeSocket(healthIdentity.userId, healthIdentity.bridgeId)
              : hasAnyBridgeSocket(healthIdentity.userId)
            : false,
          connection,
          users: Object.keys(persisted.users).length,
        })
      );
    }

    const projectTreeMatch = url.pathname.match(/^\/api\/thread\/([^/]+)\/project\/tree$/);
    if (projectTreeMatch && req.method === "GET") {
      return withCors(req, await handleProjectTree(req, decodeURIComponent(projectTreeMatch[1]), url));
    }

    const projectFileMatch = url.pathname.match(/^\/api\/thread\/([^/]+)\/project\/file$/);
    if (projectFileMatch && req.method === "GET") {
      return withCors(req, await handleProjectFile(req, decodeURIComponent(projectFileMatch[1]), url));
    }

    const projectDiffMatch = url.pathname.match(/^\/api\/thread\/([^/]+)\/project\/diff$/);
    if (projectDiffMatch && req.method === "GET") {
      return withCors(req, await handleProjectDiff(req, decodeURIComponent(projectDiffMatch[1]), url));
    }

    if (url.pathname === "/install/manifest.json" && req.method === "GET") {
      return withCors(req, await handleInstallManifest(req));
    }

    if (url.pathname === "/install/claim" && req.method === "POST") {
      return withCors(req, await handleInstallClaim(req));
    }

    if (
      (url.pathname === "/install" ||
        url.pathname === "/install/bridge-install.sh" ||
        /^\/install\/bridge-install-[A-Za-z0-9.-]+\.sh$/.test(url.pathname)) &&
      req.method === "GET"
    ) {
      return withCors(req, serveInstallSource(bridgeInstallScriptSourcePath, "text/plain; charset=utf-8"));
    }

    if (
      (url.pathname === "/install/bridge-runtime.js" ||
        url.pathname === "/install/bridge-runtime.ts" ||
        /^\/install\/bridge-runtime-[A-Za-z0-9.-]+\.(js|ts)$/.test(url.pathname)) &&
      req.method === "GET"
    ) {
      return withCors(req, await serveBridgeRuntimeInstallSource(url.pathname));
    }

    if (
      (url.pathname === "/install/bridge-installer.js" ||
        /^\/install\/bridge-installer-[A-Za-z0-9.-]+\.js$/.test(url.pathname)) &&
      req.method === "GET"
    ) {
      return withCors(req, serveInstallSource(bridgeInstallerSourcePath, "text/javascript; charset=utf-8"));
    }

    if (url.pathname === "/api/bootstrap" && req.method === "GET") {
      const session = authenticate(req);
      if (!session) {
        return withCors(req, json({ ok: false, error: "Unauthorized" }, 401));
      }
      return withCors(req, json(snapshotForUser(session.userId)));
    }

    if (url.pathname === "/api/auth/request-code" && req.method === "POST") {
      return withCors(req, await handleRequestCode(req));
    }

    if (url.pathname === "/api/auth/verify-code" && req.method === "POST") {
      return withCors(req, await handleVerifyCode(req));
    }

    if (url.pathname.startsWith("/api/")) {
      return withCors(req, json({ ok: false, error: "Not found" }, 404));
    }

    return withCors(req, serveStatic(url.pathname));
  },
  websocket: {
    open(ws) {
      if (ws.data.kind === "bridge") {
        getBridgeSockets(ws.data.userId).set(ws.data.bridgeId, ws);
        getBridgeConnectionMap(ws.data.userId).set(ws.data.bridgeId, {
          ...getBridgeConnection(ws.data.userId, ws.data.bridgeId),
          bridgeOnline: true,
          state: "connecting",
        });
        const bridgeDevice = getBridgeDevice(ws.data.userId, ws.data.bridgeId);
        if (bridgeDevice) {
          bridgeDevice.lastConnectedAt = new Date().toISOString();
          schedulePersist();
        }
        broadcastPresence(ws.data.userId);
        sendBridgeCommand(ws.data.userId, { type: "bridge:sync-all" }, ws.data.bridgeId);
        return;
      }

      registerSocket(ws);
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(ws.data.userId) });
      broadcastPresence(ws.data.userId);
    },
    message(ws, raw) {
      if (ws.data.kind === "bridge") {
        handleBridgeMessage(ws, raw.toString());
        return;
      }

      try {
        const message = JSON.parse(raw.toString()) as ClientEvent;
        handleClientEvent(ws, message);
      } catch {
        sendEvent(ws, { type: "toast", tone: "error", message: "Invalid event payload." });
      }
    },
    close(ws) {
      if (ws.data.kind === "bridge") {
        const bridgeSockets = bridgeSocketsByUserId.get(ws.data.userId);
        if (bridgeSockets?.get(ws.data.bridgeId) === ws) {
          bridgeSockets.delete(ws.data.bridgeId);
          if (bridgeSockets.size === 0) {
            bridgeSocketsByUserId.delete(ws.data.userId);
          }
        }
        rejectPendingProjectRequestsForBridge(ws.data.userId, ws.data.bridgeId, "The selected bridge went offline.");
        getBridgeConnectionMap(ws.data.userId).set(ws.data.bridgeId, {
          ...getBridgeConnection(ws.data.userId, ws.data.bridgeId),
          bridgeOnline: false,
          state: "disconnected",
          latencyMs: 0,
        });
        if (activeBridgeIdsByUserId.get(ws.data.userId) === ws.data.bridgeId) {
          activeBridgeIdsByUserId.delete(ws.data.userId);
          const fallbackBridgeId = getActiveBridgeId(ws.data.userId);
          if (fallbackBridgeId) {
            sendBridgeCommand(ws.data.userId, { type: "bridge:sync-all" }, fallbackBridgeId);
          }
        }
        broadcastPresence(ws.data.userId);
        return;
      }

      unregisterSocket(ws);
      broadcastPresence(ws.data.userId);
    },
  },
});

console.log(`[phodex-relay] listening on http://${HOST}:${PORT}`);
console.log(`[phodex-relay] client websocket at /relay and bridge websocket at /bridge`);
if (OTP_MAIL_CONFIG) {
  console.log(
    `[phodex-relay] OTP email delivery via Resend (${OTP_MAIL_CONFIG.sourceLabel}) from ${OTP_MAIL_CONFIG.authEmailFrom}`
  );
} else {
  console.warn("[phodex-relay] OTP email delivery is unavailable until Resend credentials are configured");
}

async function handleRequestCode(req: Request) {
  const body = await safeJson(req);
  const email = normalizeEmail(body?.email);
  if (!email) {
    return json({ ok: false, error: "A valid email is required." }, 400);
  }

  if (!OTP_MAIL_CONFIG) {
    return json({ ok: false, error: "OTP email delivery is not configured on this relay." }, 503);
  }

  ensureUser(email);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  try {
    await deliverCode(email, code);
  } catch (error) {
    console.error(`[phodex-relay] failed to deliver OTP for ${email}`, error);
    return json({ ok: false, error: "Unable to send verification code right now." }, 502);
  }

  persisted.otpCodes[email] = {
    code,
    expiresAt,
    delivery: "resend",
  };
  persistNow();

  const response: RequestCodeResponse = {
    ok: true,
    delivery: "resend",
    expiresInMs: OTP_TTL_MS,
  };
  return json(response);
}

async function handleVerifyCode(req: Request) {
  const body = await safeJson(req);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? "").trim();
  if (!email || !code) {
    return json({ ok: false, error: "Email and verification code are required." }, 400);
  }

  const record = persisted.otpCodes[email];
  const validCode = record && record.delivery === "resend" && !otpExpired(record.expiresAt) && record.code === code;
  if (!validCode) {
    return json({ ok: false, error: "Invalid or expired code." }, 401);
  }

  const user = ensureUser(email);
  const token = randomUUID();
  const session: AuthSession = {
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    user: user.profile,
  };

  persisted.sessions[token] = {
    userId: user.profile.id,
    expiresAt: session.expiresAt,
  };
  delete persisted.otpCodes[email];
  persistNow();

  const response: VerifyCodeResponse = {
    ok: true,
    session,
    snapshot: snapshotForUser(user.profile.id),
  };
  return json(response);
}

function handleClientEvent(ws: ServerWebSocket<SocketData>, event: ClientEvent) {
  if (ws.data.kind !== "client") {
    return;
  }

  const user = persisted.users[ws.data.userId];
  if (!user) {
    sendEvent(ws, { type: "toast", tone: "error", message: "Session user not found." });
    return;
  }

  switch (event.type) {
    case "bootstrap":
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      if (hasAnyBridgeSocket(user.profile.id)) {
        sendBridgeCommand(user.profile.id, { type: "bridge:sync-all" });
        if (user.selectedThreadId) {
          const selectedThread = getThreadMirror(user.profile.id).get(user.selectedThreadId);
          if ((selectedThread?.messages.length ?? 0) > 0) {
            sendBridgeCommand(user.profile.id, { type: "bridge:sync-thread", threadId: user.selectedThreadId });
          } else {
            sendBridgeCommand(user.profile.id, { type: "bridge:sync-thread", threadId: user.selectedThreadId });
          }
        }
      }
      break;
    case "bridge:select":
      selectBridgeForUser(user, event.bridgeId);
      break;
    case "thread:create":
      if (!dispatchToBridge(user, event)) {
        sendEvent(ws, {
          type: "thread:create-failed",
          requestId: event.requestId,
          message: "The local bridge is offline.",
        });
      } else {
        trackThreadCreateDispatch(user.profile.id, event.requestId);
      }
      break;
    case "thread:select":
      setSelectedThreadForUser(user.profile.id, event.threadId);
      user.banner = null;
      schedulePersist();
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      if (shouldSyncThreadBeforeSelect(user.profile.id, event.threadId)) {
        sendBridgeCommand(user.profile.id, { type: "bridge:sync-thread", threadId: event.threadId });
        break;
      }
      dispatchToBridge(user, event);
      break;
    case "thread:history:load": {
      if (user.selectedThreadId !== event.threadId) {
        setSelectedThreadForUser(user.profile.id, event.threadId);
        schedulePersist();
      }
      const thread = getThreadMirror(user.profile.id).get(event.threadId);
      if (!thread) {
        if (hasAnyBridgeSocket(user.profile.id)) {
          sendBridgeCommand(user.profile.id, { type: "bridge:sync-thread", threadId: event.threadId });
        }
        break;
      }
      const nextLoadedMessages = Math.min(thread.messages.length, Math.max(0, event.loadedMessages) + THREAD_HISTORY_PAGE_SIZE);
      selectedThreadHistoryWindowByUserId.set(user.profile.id, nextLoadedMessages);
      broadcastThreadToUser(user.profile.id, event.threadId);
      break;
    }
    case "thread:clearSelection":
      setSelectedThreadForUser(user.profile.id, null);
      schedulePersist();
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      break;
    case "thread:rename":
    case "thread:archive":
    case "message:send":
      if (event.type === "message:send") {
        logFlowTrace("client.message-send.received", {
          userId: user.profile.id,
          threadId: event.threadId,
          promptTrace: buildPromptTraceKey(event.text, event.images ?? []),
          promptSummary: summarizePromptForTrace(event.text, event.images ?? []),
          threadState: getThreadMirror(user.profile.id).get(event.threadId)?.state ?? null,
          activeBridgeId: getActiveBridgeId(user.profile.id),
        });
      }
      dispatchToBridge(user, event);
      break;
    case "draft:resume":
    case "draft:remove":
    case "run:stop":
      dispatchToBridge(user, event);
      break;
    case "thread:delete":
      sendToast(user.profile.id, "error", "Codex app-server does not expose thread deletion. Archive the thread instead.");
      break;
    case "settings:update":
      user.settings = {
        ...user.settings,
        ...event.patch,
      };
      schedulePersist();
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      break;
  }
}

function dispatchToBridge(user: PersistedUser, event: BridgeDispatchEvent) {
  const activeBridgeTarget = getActiveBridgeTarget(user.profile.id);
  if (!activeBridgeTarget) {
    broadcastPresence(user.profile.id);
    sendToast(user.profile.id, "error", "The local bridge is offline.");
    return false;
  }

  const command: BridgeCommand = {
    type: "bridge:dispatch",
    requestId: randomUUID(),
    userId: user.profile.id,
    selectedThreadId: user.selectedThreadId,
    event,
  };
  if (event.type === "message:send") {
    logFlowTrace("bridge.dispatch.sent", {
      requestId: command.requestId,
      userId: user.profile.id,
      bridgeId: activeBridgeTarget.bridgeId,
      threadId: event.threadId,
      promptTrace: buildPromptTraceKey(event.text, event.images ?? []),
      promptSummary: summarizePromptForTrace(event.text, event.images ?? []),
    });
  } else {
    logFlowTrace("bridge.dispatch.sent", {
      requestId: command.requestId,
      userId: user.profile.id,
      bridgeId: activeBridgeTarget.bridgeId,
      eventType: event.type,
    });
  }
  activeBridgeTarget.socket.send(JSON.stringify(command));
  return true;
}

function threadCreateDispatchKey(userId: string, requestId: string) {
  return `${userId}:${requestId}`;
}

function trackThreadCreateDispatch(userId: string, requestId: string) {
  const key = threadCreateDispatchKey(userId, requestId);
  clearThreadCreateDispatch(userId, requestId);
  pendingThreadCreateDispatches.set(key, {
    userId,
    requestId,
    timer: setTimeout(() => {
      pendingThreadCreateDispatches.delete(key);
      sendToast(userId, "error", "The Mac did not acknowledge the new chat request. Restart the bridge and try again.");
      broadcast(userId, {
        type: "thread:create-failed",
        requestId,
        message: "The Mac did not acknowledge the new chat request. Restart the bridge and try again.",
      });
    }, 22_000),
  });
}

function clearThreadCreateDispatch(userId: string, requestId: string) {
  const key = threadCreateDispatchKey(userId, requestId);
  const pending = pendingThreadCreateDispatches.get(key);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timer);
  pendingThreadCreateDispatches.delete(key);
}

function acknowledgePendingThreadCreateFromMirror(userId: string, threadId: string | null | undefined) {
  if (!threadId) {
    return;
  }
  const pending = [...pendingThreadCreateDispatches.values()].find((entry) => entry.userId === userId);
  if (!pending) {
    return;
  }
  clearThreadCreateDispatch(userId, pending.requestId);
  setSelectedThreadForUser(userId, threadId);
  ensureMirroredThread(userId, threadId);
  schedulePersist();
  broadcast(userId, {
    type: "thread:created",
    requestId: pending.requestId,
    threadId,
  });
}

function selectBridgeForUser(user: PersistedUser, bridgeId: string) {
  if (!user.bridgeDevices[bridgeId]) {
    sendToast(user.profile.id, "error", "That Mac is no longer registered to this account.");
    return false;
  }

  if (!hasBridgeSocket(user.profile.id, bridgeId)) {
    sendToast(user.profile.id, "error", "That Mac is offline right now.");
    return false;
  }

  const nextConnection = getBridgeConnection(user.profile.id, bridgeId);
  if (nextConnection.state !== "connected") {
    sendBridgeCommand(user.profile.id, { type: "bridge:sync-all" }, bridgeId);
    broadcastPresence(user.profile.id);
    sendToast(user.profile.id, "info", "That Mac is still starting. Wait for it to finish connecting before switching.");
    return false;
  }

  const previousBridgeId = getActiveBridgeId(user.profile.id);
  if (previousBridgeId === bridgeId) {
    sendBridgeCommand(user.profile.id, { type: "bridge:sync-all" }, bridgeId);
    broadcastPresence(user.profile.id);
    return true;
  }

  activeBridgeIdsByUserId.set(user.profile.id, bridgeId);
  getThreadMirror(user.profile.id).clear();
  setSelectedThreadForUser(user.profile.id, null);
  user.banner = null;
  schedulePersist();
  broadcastSnapshot(user.profile.id);
  broadcastPresence(user.profile.id);
  sendBridgeCommand(user.profile.id, { type: "bridge:sync-all" }, bridgeId);
  return true;
}

function handleBridgeMessage(ws: ServerWebSocket<SocketData>, raw: string) {
  let event: BridgeEvent | null = null;
  try {
    event = JSON.parse(raw) as BridgeEvent;
  } catch {
    return;
  }

  if (!event) {
    return;
  }

  if (ws.data.kind !== "bridge") {
    return;
  }

  const bridgeUserId = ws.data.userId;
  const bridgeId = ws.data.bridgeId;

  switch (event.type) {
    case "bridge:project:response": {
      const pending = pendingProjectRequests.get(event.requestId);
      if (!pending || pending.userId !== bridgeUserId || pending.bridgeId !== bridgeId) {
        break;
      }
      pendingProjectRequests.delete(event.requestId);
      clearTimeout(pending.timer);
      if (event.ok) {
        pending.resolve(event.result);
      } else {
        const error = new Error(event.error) as Error & { status?: number };
        error.status = event.status;
        pending.reject(error);
      }
      break;
    }
    case "bridge:state": {
      getBridgeConnectionMap(bridgeUserId).set(bridgeId, {
        ...event.connection,
        bridgeOnline: true,
      });
      updatePersistedBridgeDeviceMeta(bridgeUserId, bridgeId, event.connection);
      const promoted = maybePromoteBridge(bridgeUserId, bridgeId);
      if (!promoted && getActiveBridgeId(bridgeUserId) !== bridgeId) {
        break;
      }
      getThreadMirror(bridgeUserId).clear();
      for (const thread of event.threads) {
        getThreadMirror(bridgeUserId).set(thread.id, thread);
      }
      const selectedThreadId = persisted.users[bridgeUserId]?.selectedThreadId;
      if (selectedThreadId) {
        ensureMirroredThread(bridgeUserId, selectedThreadId);
      }
      normalizeSelectionForUser(bridgeUserId);
      acknowledgePendingThreadCreateFromMirror(bridgeUserId, persisted.users[bridgeUserId]?.selectedThreadId);
      broadcastSnapshot(bridgeUserId);
      broadcastPresence(bridgeUserId);
      break;
    }
    case "bridge:thread:created": {
      if (getActiveBridgeId(bridgeUserId) !== bridgeId || event.userId !== bridgeUserId) {
        break;
      }
      clearThreadCreateDispatch(event.userId, event.requestId);
      setSelectedThreadForUser(event.userId, event.threadId);
      ensureMirroredThread(event.userId, event.threadId);
      schedulePersist();
      broadcast(event.userId, {
        type: "thread:created",
        requestId: event.requestId,
        threadId: event.threadId,
      });
      break;
    }
    case "bridge:thread:create-failed": {
      if (getActiveBridgeId(bridgeUserId) !== bridgeId || event.userId !== bridgeUserId) {
        break;
      }
      clearThreadCreateDispatch(event.userId, event.requestId);
      broadcast(event.userId, {
        type: "thread:create-failed",
        requestId: event.requestId,
        message: event.message,
      });
      break;
    }
    case "bridge:thread:updated":
      logFlowTrace("bridge.thread-updated.received", {
        userId: bridgeUserId,
        bridgeId,
        threadId: event.thread.id,
        state: event.thread.state,
        queuedDrafts: event.thread.queuedDrafts.length,
      });
      if (getActiveBridgeId(bridgeUserId) !== bridgeId) {
        break;
      }
      getThreadMirror(bridgeUserId).set(event.thread.id, event.thread);
      normalizeSelectionForUser(bridgeUserId);
      broadcastThreadToUser(bridgeUserId, event.thread.id);
      break;
    case "bridge:message:appended":
      logFlowTrace("bridge.message-appended.received", {
        userId: bridgeUserId,
        bridgeId,
        threadId: event.threadId,
        messageId: event.message.id,
        role: event.message.role,
        kind: event.message.kind,
        cardTypes: (event.message.cards ?? []).map((card) => card.type),
      });
      if (getActiveBridgeId(bridgeUserId) !== bridgeId) {
        break;
      }
      appendMirroredMessage(bridgeUserId, event.threadId, event.message);
      if (persisted.users[bridgeUserId]?.selectedThreadId === event.threadId) {
        broadcast(bridgeUserId, { type: "message:appended", threadId: event.threadId, message: event.message });
      } else {
        broadcastThreadToUser(bridgeUserId, event.threadId);
      }
      break;
    case "bridge:message:delta":
      logFlowTrace("bridge.message-delta.received", {
        userId: bridgeUserId,
        bridgeId,
        threadId: event.threadId,
        messageId: event.messageId,
        deltaLength: event.delta.length,
      });
      if (getActiveBridgeId(bridgeUserId) !== bridgeId) {
        break;
      }
      applyMirroredDelta(bridgeUserId, event.threadId, event.messageId, event.delta);
      if (persisted.users[bridgeUserId]?.selectedThreadId === event.threadId) {
        broadcast(bridgeUserId, { type: "message:delta", threadId: event.threadId, messageId: event.messageId, delta: event.delta });
      }
      break;
    case "bridge:message:finished":
      logFlowTrace("bridge.message-finished.received", {
        userId: bridgeUserId,
        bridgeId,
        threadId: event.threadId,
        messageId: event.messageId,
      });
      if (getActiveBridgeId(bridgeUserId) !== bridgeId) {
        break;
      }
      finishMirroredMessage(bridgeUserId, event.threadId, event.messageId);
      if (persisted.users[bridgeUserId]?.selectedThreadId === event.threadId) {
        broadcast(bridgeUserId, { type: "message:finished", threadId: event.threadId, messageId: event.messageId });
      } else {
        broadcastThreadToUser(bridgeUserId, event.threadId);
      }
      break;
    case "bridge:presence":
      getBridgeConnectionMap(bridgeUserId).set(bridgeId, {
        ...event.connection,
        bridgeOnline: true,
      });
      updatePersistedBridgeDeviceMeta(bridgeUserId, bridgeId, event.connection);
      maybePromoteBridge(bridgeUserId, bridgeId);
      if (getActiveBridgeId(bridgeUserId) === bridgeId) {
        broadcastPresence(bridgeUserId);
      }
      break;
    case "bridge:banner":
      if (getActiveBridgeId(bridgeUserId) !== bridgeId) {
        break;
      }
      persisted.users[bridgeUserId].banner = event.banner;
      schedulePersist();
      broadcastBanner(bridgeUserId);
      break;
    case "bridge:user-patch": {
      if (getActiveBridgeId(bridgeUserId) !== bridgeId) {
        break;
      }
      if (event.userId !== bridgeUserId) {
        break;
      }
      const user = persisted.users[event.userId];
      if (!user) {
        break;
      }
      if (Object.prototype.hasOwnProperty.call(event, "selectedThreadId")) {
        setSelectedThreadForUser(user.profile.id, event.selectedThreadId ?? null);
        if (user.selectedThreadId) {
          ensureMirroredThread(user.profile.id, user.selectedThreadId);
          acknowledgePendingThreadCreateFromMirror(user.profile.id, user.selectedThreadId);
        }
      }
      if (Object.prototype.hasOwnProperty.call(event, "banner")) {
        user.banner = event.banner ?? null;
        broadcast(user.profile.id, { type: "banner", banner: user.banner });
      }
      schedulePersist();
      broadcastSnapshot(user.profile.id);
      break;
    }
    case "bridge:toast":
      if (getActiveBridgeId(bridgeUserId) !== bridgeId) {
        break;
      }
      if (event.userId && event.userId !== bridgeUserId) {
        break;
      }
      sendToast(bridgeUserId, event.tone, event.message);
      break;
  }
}

function appendMirroredMessage(userId: string, threadId: string, message: ThreadMessage) {
  const thread = ensureMirroredThread(userId, threadId);
  const existingIndex = thread.messages.findIndex((entry) => entry.id === message.id);
  if (existingIndex === -1) {
    thread.messages.push(message);
  } else {
    thread.messages[existingIndex] = {
      ...thread.messages[existingIndex],
      ...message,
    };
  }
  thread.preview = summarizeMessagePreview(message) || thread.preview;
  thread.lastActivityAt = message.createdAt;
}

function applyMirroredDelta(userId: string, threadId: string, messageId: string, delta: string) {
  const thread = ensureMirroredThread(userId, threadId);
  const message = thread.messages.find((entry) => entry.id === messageId);
  if (!message) {
    return;
  }
  message.text += delta;
  message.isStreaming = true;
  thread.preview = summarizeMessagePreview(message) || thread.preview;
  thread.lastActivityAt = new Date().toISOString();
}

function finishMirroredMessage(userId: string, threadId: string, messageId: string) {
  const thread = ensureMirroredThread(userId, threadId);
  const message = thread.messages.find((entry) => entry.id === messageId);
  if (!message) {
    return;
  }
  message.isStreaming = false;
  thread.lastActivityAt = new Date().toISOString();
}

function summarizeMessagePreview(message: ThreadMessage) {
  const trimmed = message.text.trim();
  if (trimmed) {
    return trimmed;
  }
  if ((message.inputImages?.length ?? 0) === 1) {
    return "Sent an image";
  }
  if ((message.inputImages?.length ?? 0) > 1) {
    return `Sent ${message.inputImages!.length} images`;
  }
  return "";
}

function ensureMirroredThread(userId: string, threadId: string) {
  const mirror = getThreadMirror(userId);
  const existing = mirror.get(threadId);
  if (existing) {
    return existing;
  }

  const thread: ThreadRecord = {
    id: threadId,
    title: "New Chat",
    preview: "",
    projectLabel: "Codex",
    repoLabel: "",
    branch: "main",
    state: "idle",
    lastActivityAt: new Date().toISOString(),
    unreadCount: 0,
    subagentCount: 0,
    isWorktree: false,
    isForked: false,
    diff: { additions: 0, deletions: 0 },
    queuedDrafts: [],
    messages: [],
  };
  mirror.set(threadId, thread);
  return thread;
}

function isPlaceholderThread(thread: ThreadRecord | undefined) {
  return Boolean(
    thread &&
      thread.title === "New Chat" &&
      thread.projectLabel === "Codex" &&
      !thread.preview &&
      !thread.repoLabel &&
      thread.messages.length === 0
  );
}

function shouldSyncThreadBeforeSelect(userId: string, threadId: string) {
  if (!hasAnyBridgeSocket(userId)) {
    return false;
  }
  const thread = getThreadMirror(userId).get(threadId);
  return !thread || isPlaceholderThread(thread);
}

function setSelectedThreadForUser(userId: string, selectedThreadId: string | null) {
  const user = persisted.users[userId];
  if (!user) {
    return;
  }
  const changed = user.selectedThreadId !== selectedThreadId;
  user.selectedThreadId = selectedThreadId;
  if (!changed) {
    return;
  }
  if (!selectedThreadId) {
    selectedThreadHistoryWindowByUserId.delete(userId);
    return;
  }
  selectedThreadHistoryWindowByUserId.set(userId, THREAD_HISTORY_PAGE_SIZE);
}

function buildThreadHistoryState(totalMessages: number, loadedMessages: number): ThreadHistoryState {
  const remainingMessages = Math.max(0, totalMessages - loadedMessages);
  return {
    totalMessages,
    loadedMessages,
    remainingMessages,
    hasMoreBefore: remainingMessages > 0,
    isHydrating: false,
  };
}

function serializeSelectedThreadForUser(userId: string, thread: ThreadRecord) {
  const totalMessages = thread.messages.length;
  const loadedMessages = Math.min(
    totalMessages,
    Math.max(THREAD_HISTORY_PAGE_SIZE, selectedThreadHistoryWindowByUserId.get(userId) ?? THREAD_HISTORY_PAGE_SIZE)
  );
  return {
    ...thread,
    messages: thread.messages.slice(-loadedMessages),
    history: buildThreadHistoryState(totalMessages, loadedMessages),
  } satisfies ThreadRecord;
}

function serializeThreadForUser(
  userId: string,
  thread: ThreadRecord,
  selectedThreadId: string | null,
  includeSelectedMessages: boolean
) {
  if (thread.id === selectedThreadId) {
    if (includeSelectedMessages) {
      return serializeSelectedThreadForUser(userId, thread);
    }
    return {
      ...thread,
      messages: [],
      history: thread.messages.length ? buildThreadHistoryState(thread.messages.length, 0) : null,
    } satisfies ThreadRecord;
  }

  return {
    ...thread,
    messages: [],
    history: null,
  } satisfies ThreadRecord;
}

function snapshotForUser(userId: string, options: { includeSelectedMessages?: boolean } = {}): AppSnapshot {
  const user = persisted.users[userId];
  const activeBridgeTarget = getActiveBridgeTarget(userId);
  const activeBridgeId = activeBridgeTarget?.bridgeId ?? null;
  const includeSelectedMessages = options.includeSelectedMessages ?? false;
  const threads = [...getThreadMirror(userId).values()].sort((left, right) => {
    const leftArchived = left.state === "archived" ? 1 : 0;
    const rightArchived = right.state === "archived" ? 1 : 0;
    if (leftArchived !== rightArchived) {
      return leftArchived - rightArchived;
    }
    return Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
  }).map((thread) => serializeThreadForUser(userId, thread, user.selectedThreadId, includeSelectedMessages));

  return {
    user: user.profile,
    selectedThreadId: user.selectedThreadId,
    threads,
    settings: user.settings,
    connection: getBridgeConnection(userId, activeBridgeId),
    activeBridgeId,
    bridgeDevices: listBridgeDevicesForUser(userId),
    banner: user.banner,
  };
}

function ensureUser(email: string): PersistedUser {
  const userId = `user-${email.replace(/[^a-z0-9]+/gi, "-")}`;
  if (!persisted.users[userId]) {
    persisted.users[userId] = {
      profile: {
        id: userId,
        email,
        displayName: email.split("@")[0] || "Operator",
      },
      settings: {
        fontStyle: "system",
        glassMode: true,
        notifications: true,
        reducedMotion: false,
        compactSidebar: false,
      },
      selectedThreadId: null,
      banner: null,
      bridgeDevices: {},
    };
    normalizeSelectionForUser(userId);
    schedulePersist();
  }

  return persisted.users[userId];
}

function normalizeSelectionForUser(userId: string) {
  const user = persisted.users[userId];
  if (!user || user.selectedThreadId === null) {
    return;
  }

  const mirror = getThreadMirror(userId);
  if (mirror.has(user.selectedThreadId)) {
    return;
  }

  const firstLiveThreadId = findFirstLiveThreadId(userId);
  const firstAnyThreadId = [...mirror.values()]
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
    .at(0)?.id ?? null;
  setSelectedThreadForUser(userId, firstLiveThreadId ?? firstAnyThreadId);
}

function findFirstLiveThreadId(userId: string, excludingThreadId?: string) {
  return [...getThreadMirror(userId).values()]
    .filter((thread) => thread.id !== excludingThreadId && thread.state !== "archived")
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
    .at(0)?.id ?? null;
}

function getThreadMirror(userId: string) {
  let mirror = threadMirrorsByUserId.get(userId);
  if (!mirror) {
    mirror = new Map<string, ThreadRecord>();
    threadMirrorsByUserId.set(userId, mirror);
  }
  return mirror;
}

function disconnectedBridgeConnection(macLabel = DEFAULT_MAC_LABEL): RelayConnection {
  return {
    bridgeOnline: false,
    state: "disconnected",
    relayLabel: RELAY_LABEL,
    macLabel,
    latencyMs: 0,
    lastSyncAt: null,
  };
}

function getBridgeSockets(userId: string) {
  let sockets = bridgeSocketsByUserId.get(userId);
  if (!sockets) {
    sockets = new Map<string, ServerWebSocket<SocketData>>();
    bridgeSocketsByUserId.set(userId, sockets);
  }
  return sockets;
}

function getActiveBridgeTarget(userId: string) {
  const bridgeId = getActiveBridgeId(userId);
  if (!bridgeId) {
    return null;
  }

  const socket = bridgeSocketsByUserId.get(userId)?.get(bridgeId) ?? null;
  if (!socket) {
    activeBridgeIdsByUserId.delete(userId);
    return null;
  }

  return { bridgeId, socket };
}

function getBridgeConnectionMap(userId: string) {
  let connections = bridgeConnectionsByUserId.get(userId);
  if (!connections) {
    connections = new Map<string, RelayConnection>();
    bridgeConnectionsByUserId.set(userId, connections);
  }
  return connections;
}

function getBridgeDevice(userId: string, bridgeId: string) {
  return persisted.users[userId]?.bridgeDevices[bridgeId] ?? null;
}

function hasBridgeSocket(userId: string, bridgeId: string) {
  return bridgeSocketsByUserId.get(userId)?.has(bridgeId) ?? false;
}

function hasAnyBridgeSocket(userId: string) {
  return (bridgeSocketsByUserId.get(userId)?.size ?? 0) > 0;
}

function getBridgeConnection(userId: string, bridgeId?: string | null) {
  if (bridgeId) {
    const macLabel = getBridgeDevice(userId, bridgeId)?.macLabel ?? DEFAULT_MAC_LABEL;
    if (!hasBridgeSocket(userId, bridgeId)) {
      return disconnectedBridgeConnection(macLabel);
    }
    return getBridgeConnectionMap(userId).get(bridgeId) ?? disconnectedBridgeConnection(macLabel);
  }

  const activeBridgeTarget = getActiveBridgeTarget(userId);
  if (activeBridgeTarget) {
    return getBridgeConnection(userId, activeBridgeTarget.bridgeId);
  }

  const fallbackBridgeId = pickBestBridgeId(userId);
  return fallbackBridgeId ? getBridgeConnection(userId, fallbackBridgeId) : disconnectedBridgeConnection();
}

function listSortedBridgeIds(userId: string, candidateBridgeIds?: string[]) {
  const user = persisted.users[userId];
  if (!user) {
    return [];
  }

  const connectionMap = bridgeConnectionsByUserId.get(userId);
  const bridgeIds = new Set<string>(candidateBridgeIds ?? []);
  for (const bridgeId of Object.keys(user.bridgeDevices)) {
    bridgeIds.add(bridgeId);
  }
  for (const bridgeId of connectionMap?.keys() ?? []) {
    bridgeIds.add(bridgeId);
  }

  return [...bridgeIds].sort((left, right) => {
    const scoreDelta = bridgeConnectionScore(getBridgeConnection(userId, right)) - bridgeConnectionScore(getBridgeConnection(userId, left));
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    const lastConnectedDelta = bridgeLastConnectedAt(userId, right) - bridgeLastConnectedAt(userId, left);
    if (lastConnectedDelta !== 0) {
      return lastConnectedDelta;
    }
    return left.localeCompare(right);
  });
}

function getActiveBridgeId(userId: string) {
  const activeBridgeId = activeBridgeIdsByUserId.get(userId) ?? "";
  const bestOnlineBridgeId = pickBestBridgeId(userId, listOnlineBridgeIds(userId));
  if (activeBridgeId && hasBridgeSocket(userId, activeBridgeId)) {
    if (bestOnlineBridgeId && bestOnlineBridgeId !== activeBridgeId) {
      const activeConnection = getBridgeConnection(userId, activeBridgeId);
      const bestOnlineConnection = getBridgeConnection(userId, bestOnlineBridgeId);
      if (bridgeConnectionScore(bestOnlineConnection) > bridgeConnectionScore(activeConnection)) {
        activeBridgeIdsByUserId.set(userId, bestOnlineBridgeId);
        return bestOnlineBridgeId;
      }
    }
    return activeBridgeId;
  }
  if (activeBridgeId) {
    activeBridgeIdsByUserId.delete(userId);
  }

  const nextBridgeId = bestOnlineBridgeId;
  if (nextBridgeId) {
    activeBridgeIdsByUserId.set(userId, nextBridgeId);
  }
  return nextBridgeId;
}

function maybePromoteBridge(userId: string, candidateBridgeId: string) {
  if (!hasBridgeSocket(userId, candidateBridgeId)) {
    return false;
  }

  const activeBridgeId = getActiveBridgeId(userId);
  if (!activeBridgeId) {
    activeBridgeIdsByUserId.set(userId, candidateBridgeId);
    return true;
  }
  if (activeBridgeId === candidateBridgeId) {
    return false;
  }

  const candidateConnection = getBridgeConnection(userId, candidateBridgeId);
  const activeConnection = getBridgeConnection(userId, activeBridgeId);
  const candidateScore = bridgeConnectionScore(candidateConnection);
  const activeScore = bridgeConnectionScore(activeConnection);
  if (candidateScore > activeScore && candidateConnection.state === "connected" && activeConnection.state !== "connected") {
    activeBridgeIdsByUserId.set(userId, candidateBridgeId);
    return true;
  }

  return false;
}

function pickBestBridgeId(userId: string, candidateBridgeIds?: string[]) {
  return listSortedBridgeIds(userId, candidateBridgeIds).at(0) ?? "";
}

function listOnlineBridgeIds(userId: string) {
  return [...(bridgeSocketsByUserId.get(userId)?.keys() ?? [])];
}

function bridgeConnectionScore(connection: RelayConnection) {
  if (!connection.bridgeOnline) {
    return 0;
  }
  if (connection.state === "connected") {
    return 3;
  }
  if (connection.state === "connecting") {
    return 2;
  }
  return 1;
}

function bridgeLastConnectedAt(userId: string, bridgeId: string) {
  const lastConnectedAt = getBridgeDevice(userId, bridgeId)?.lastConnectedAt;
  return lastConnectedAt ? Date.parse(lastConnectedAt) || 0 : 0;
}

function bridgeDeviceSummary(userId: string, bridgeId: string): BridgeDeviceSummary {
  const bridgeDevice = getBridgeDevice(userId, bridgeId);
  const connection = getBridgeConnection(userId, bridgeId);
  return {
    id: bridgeId,
    macLabel: bridgeDevice?.macLabel?.trim() || connection.macLabel || DEFAULT_MAC_LABEL,
    bridgeOnline: connection.bridgeOnline,
    state: connection.state,
    lastConnectedAt: bridgeDevice?.lastConnectedAt ?? null,
    issuedAt: bridgeDevice?.issuedAt ?? null,
  };
}

function bridgeDeviceGroupKey(userId: string, bridgeId: string, device: BridgeDeviceSummary) {
  const persistedMacLabel = getBridgeDevice(userId, bridgeId)?.macLabel?.trim().toLowerCase() ?? "";
  if (persistedMacLabel) {
    return `mac:${persistedMacLabel}`;
  }

  if (device.bridgeOnline) {
    const liveMacLabel = device.macLabel.trim().toLowerCase();
    if (liveMacLabel) {
      return `mac:${liveMacLabel}`;
    }
  }

  return `bridge:${bridgeId}`;
}

function listBridgeDevicesForUser(userId: string): BridgeDeviceSummary[] {
  const bridgeDevices = new Map<string, BridgeDeviceSummary>();
  for (const bridgeId of listSortedBridgeIds(userId)) {
    const device = bridgeDeviceSummary(userId, bridgeId);
    const groupKey = bridgeDeviceGroupKey(userId, bridgeId, device);
    if (!bridgeDevices.has(groupKey)) {
      bridgeDevices.set(groupKey, device);
    }
  }
  return [...bridgeDevices.values()];
}

function updatePersistedBridgeDeviceMeta(userId: string, bridgeId: string, connection: RelayConnection) {
  const bridgeDevice = getBridgeDevice(userId, bridgeId);
  if (!bridgeDevice) {
    return;
  }

  const nextMacLabel = connection.macLabel?.trim() || bridgeDevice.macLabel || null;
  if (nextMacLabel === bridgeDevice.macLabel) {
    return;
  }

  bridgeDevice.macLabel = nextMacLabel;
  schedulePersist();
}

function resolveHealthIdentity(req: Request) {
  const session = authenticate(req);
  if (session) {
    return { userId: session.userId, bridgeId: null, invalidBridgeToken: false };
  }

  const bridgeToken = req.headers.get("x-phodex-bridge-token")?.trim() ?? "";
  if (!bridgeToken) {
    return { userId: "", bridgeId: null, invalidBridgeToken: false };
  }

  const bridgeIdentity = resolveBridgeIdentity(bridgeToken);
  return {
    userId: bridgeIdentity?.userId ?? "",
    bridgeId: bridgeIdentity?.bridgeId ?? null,
    invalidBridgeToken: !bridgeIdentity,
  };
}

function resolveBridgeIdentity(token: string) {
  if (!token) {
    return null;
  }
  const tokenHash = hashBridgeToken(token);
  for (const user of Object.values(persisted.users)) {
    for (const bridgeDevice of Object.values(user.bridgeDevices)) {
      if (bridgeDevice.tokenHash === tokenHash) {
        return { userId: user.profile.id, bridgeId: bridgeDevice.id };
      }
    }
  }
  return null;
}

function issueBridgeAccessToken(userId: string) {
  const user = persisted.users[userId];
  if (!user) {
    throw new Error("Bridge user not found.");
  }

  const bridgeId = `bridge-${randomUUID()}`;
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
  user.bridgeDevices[bridgeId] = {
    id: bridgeId,
    tokenHash: hashBridgeToken(token),
    issuedAt: new Date().toISOString(),
    lastConnectedAt: null,
    macLabel: null,
  };
  return token;
}

function hashBridgeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function authenticate(req: Request) {
  refreshPersisted();
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const session = persisted.sessions[token];
  if (!session || sessionExpired(session.expiresAt)) {
    return null;
  }
  return session;
}

function requireAuthenticatedSession(req: Request) {
  const session = authenticate(req);
  if (!session) {
    throw httpError(401, "Unauthorized");
  }
  return session;
}

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function resolveProjectThreadForUser(userId: string, threadId: string) {
  const thread = getThreadMirror(userId).get(threadId);
  if (!thread) {
    throw httpError(404, "Thread not found.");
  }
  return thread;
}

function normalizeProjectPath(rawPath: string | null, fallback = ".") {
  const value = rawPath?.trim() ?? "";
  return value || fallback;
}

function normalizeOptionalProjectPath(rawPath: string | null) {
  const value = rawPath?.trim() ?? "";
  return value || null;
}

async function handleProjectTree(req: Request, threadId: string, url: URL) {
  try {
    const session = requireAuthenticatedSession(req);
    resolveProjectThreadForUser(session.userId, threadId);
    const result = await requestProjectResource(session.userId, {
      kind: "tree",
      threadId,
      path: normalizeProjectPath(url.searchParams.get("path")),
    });
    if (result.kind !== "tree") {
      throw httpError(502, "Bridge returned an unexpected tree payload.");
    }
    return json(result);
  } catch (error) {
    return projectErrorResponse(error);
  }
}

async function handleProjectFile(req: Request, threadId: string, url: URL) {
  try {
    const session = requireAuthenticatedSession(req);
    resolveProjectThreadForUser(session.userId, threadId);
    const path = normalizeProjectPath(url.searchParams.get("path"), "");
    if (!path) {
      throw httpError(400, "A file path is required.");
    }
    const result = await requestProjectResource(session.userId, {
      kind: "file",
      threadId,
      path,
    });
    if (result.kind !== "file") {
      throw httpError(502, "Bridge returned an unexpected file payload.");
    }
    return json(result);
  } catch (error) {
    return projectErrorResponse(error);
  }
}

async function handleProjectDiff(req: Request, threadId: string, url: URL) {
  try {
    const session = requireAuthenticatedSession(req);
    resolveProjectThreadForUser(session.userId, threadId);
    const result = await requestProjectResource(session.userId, {
      kind: "diff",
      threadId,
      path: normalizeOptionalProjectPath(url.searchParams.get("path")),
    });
    if (result.kind !== "diff") {
      throw httpError(502, "Bridge returned an unexpected diff payload.");
    }
    return json(result);
  } catch (error) {
    return projectErrorResponse(error);
  }
}

function projectErrorResponse(error: unknown) {
  const status = typeof (error as { status?: unknown })?.status === "number" ? Number((error as { status?: unknown }).status) : 500;
  return json({ ok: false, error: readErrorMessage(error) }, status);
}

function requestProjectResource(userId: string, request: Extract<BridgeCommand, { type: "bridge:project:request" }>["request"]) {
  const bridgeId = getActiveBridgeId(userId);
  const bridgeSocket = bridgeId ? bridgeSocketsByUserId.get(userId)?.get(bridgeId) : null;
  if (!bridgeSocket) {
    throw httpError(503, "The local bridge is offline.");
  }

  const requestId = randomUUID();
  const command: BridgeCommand = {
    type: "bridge:project:request",
    requestId,
    userId,
    request,
  };

  return new Promise<ProjectResourcePayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingProjectRequests.delete(requestId);
      reject(httpError(504, "Timed out waiting for the local bridge."));
    }, 7_000);

    pendingProjectRequests.set(requestId, {
      userId,
      bridgeId,
      resolve,
      reject,
      timer,
    });

    bridgeSocket.send(JSON.stringify(command));
  });
}

function rejectPendingProjectRequestsForBridge(userId: string, bridgeId: string, message: string) {
  for (const [requestId, pending] of pendingProjectRequests.entries()) {
    if (pending.userId !== userId || pending.bridgeId !== bridgeId) {
      continue;
    }
    pendingProjectRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.reject(httpError(503, message));
  }
}

function registerSocket(ws: ServerWebSocket<SocketData>) {
  if (ws.data.kind !== "client") {
    return;
  }
  const sockets = clientsByUserId.get(ws.data.userId) ?? new Set<ServerWebSocket<SocketData>>();
  sockets.add(ws);
  clientsByUserId.set(ws.data.userId, sockets);
}

function unregisterSocket(ws: ServerWebSocket<SocketData>) {
  if (ws.data.kind !== "client") {
    return;
  }
  const sockets = clientsByUserId.get(ws.data.userId);
  sockets?.delete(ws);
  if (sockets && sockets.size === 0) {
    clientsByUserId.delete(ws.data.userId);
  }
}

function sendBridgeCommand(userId: string, command: BridgeCommand, bridgeId = getActiveBridgeId(userId)) {
  const bridgeSocket = bridgeId ? bridgeSocketsByUserId.get(userId)?.get(bridgeId) : null;
  if (!bridgeSocket) {
    return;
  }
  bridgeSocket.send(JSON.stringify(command));
}

function broadcastThreadToUser(userId: string, threadId: string) {
  const thread = getThreadMirror(userId).get(threadId);
  if (!thread) {
    return;
  }
  const user = persisted.users[userId];
  if (!user) {
    return;
  }
  broadcast(userId, {
    type: "thread:updated",
    thread: serializeThreadForUser(userId, thread, user.selectedThreadId, true),
    selectedThreadId: user.selectedThreadId,
  });
}

function broadcastSnapshot(userId: string) {
  broadcast(userId, { type: "snapshot", snapshot: snapshotForUser(userId) });
}

function broadcastBanner(userId: string) {
  const user = persisted.users[userId];
  if (!user) {
    return;
  }
  broadcast(userId, { type: "banner", banner: user.banner });
}

function broadcastPresence(userId: string) {
  const activeBridgeTarget = getActiveBridgeTarget(userId);
  const activeBridgeId = activeBridgeTarget?.bridgeId ?? null;
  broadcast(userId, {
    type: "presence",
    connection: getBridgeConnection(userId, activeBridgeId),
    activeBridgeId,
    bridgeDevices: listBridgeDevicesForUser(userId),
  });
}

function sendToast(userId: string, tone: "info" | "success" | "error", message: string) {
  broadcast(userId, { type: "toast", tone, message });
}

function broadcast(userId: string, event: ServerEvent) {
  const payload = JSON.stringify(event);
  for (const socket of clientsByUserId.get(userId) ?? []) {
    socket.send(payload);
  }
}

function sendEvent(ws: ServerWebSocket<SocketData>, event: ServerEvent) {
  ws.send(JSON.stringify(event));
}

function buildOrigin(req: Request) {
  const requestOrigin = new URL(req.url).origin;
  const forwardedOrigin = resolveForwardedOrigin(req);
  const origin = req.headers.get("origin");
  if (forwardedOrigin) {
    if (!origin) {
      return forwardedOrigin;
    }
    try {
      const parsedOrigin = new URL(origin).origin;
      const parsedHost = new URL(origin).host;
      const forwardedHost = new URL(forwardedOrigin).host;
      if (parsedOrigin === forwardedOrigin || parsedHost === forwardedHost) {
        return parsedOrigin;
      }
    } catch {
      // ignore malformed origin headers
    }
    if (ALLOWED_ORIGINS.has(origin) || DEV_ORIGINS.has(origin)) {
      return origin;
    }
    return forwardedOrigin;
  }
  if (!origin) {
    return requestOrigin;
  }
  if (origin === requestOrigin || DEV_ORIGINS.has(origin) || ALLOWED_ORIGINS.has(origin)) {
    return origin;
  }
  return requestOrigin;
}

function resolveForwardedOrigin(req: Request) {
  const forwarded = req.headers.get("forwarded");
  const forwardedEntry = forwarded?.split(",")[0]?.trim() ?? "";
  const forwardedPairs = new Map<string, string>();
  if (forwardedEntry) {
    for (const segment of forwardedEntry.split(";")) {
      const [rawKey, rawValue] = segment.split("=", 2);
      const key = rawKey?.trim().toLowerCase();
      const value = rawValue?.trim().replace(/^"|"$/g, "");
      if (key && value) {
        forwardedPairs.set(key, value);
      }
    }
  }

  const proto =
    forwardedPairs.get("proto") ??
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    "";
  const host =
    forwardedPairs.get("host") ??
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    req.headers.get("host")?.trim() ??
    "";

  if (!proto || !host) {
    return "";
  }

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return "";
  }
}

function withCors(req: Request, response: Response) {
  response.headers.set("access-control-allow-origin", buildOrigin(req));
  response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type,authorization,x-phodex-bridge-token");
  response.headers.set("access-control-allow-credentials", "true");
  return response;
}

function serveStatic(pathname: string) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(distDir, `.${normalized}`);
  if (existsSync(filePath)) {
    return new Response(Bun.file(filePath));
  }
  return new Response(Bun.file(resolve(distDir, "index.html")));
}

async function handleInstallManifest(req: Request) {
  const session = authenticate(req);
  if (!session) {
    return json({ ok: false, error: "Sign in first to generate a bridge install command." }, 401);
  }

  try {
    const version = computeInstallAssetsVersion();
    await ensureBundledBridgeRuntimeInstallAsset(version);
    const origin = buildOrigin(req);
    const installScriptUrl = `${origin}/install`;
    const bridgeInstallerUrl = `${origin}/install/bridge-installer-${version}.js`;
    const bridgeRuntimeUrl = `${origin}/install/bridge-runtime-${version}.ts`;
    const { token, expiresAt } = issueInstallSetupToken(session.userId);
    const shellCommand = `curl -fsSL "${installScriptUrl}" | bash -s -- --relay "${origin}" --token "${token}"`;
    return json({
      version,
      relayOrigin: origin,
      relayLabel: RELAY_LABEL,
      installScriptUrl,
      bridgeInstallerUrl,
      bridgeRuntimeUrl,
      setupToken: token,
      setupTokenExpiresAt: expiresAt,
      command: shellCommand,
      windowsCommand: buildWindowsInstallCommand(bridgeInstallerUrl, origin, token),
    });
  } catch (error) {
    return json({ ok: false, error: `Install manifest failed: ${readErrorMessage(error)}` }, 500);
  }
}

async function handleInstallClaim(req: Request) {
  const body = (await safeJson(req)) as { token?: string } | null;
  const token = body?.token?.trim() ?? "";
  if (!token) {
    return json({ ok: false, error: "A setup token is required." }, 400);
  }

  const record = installSetupTokens.get(token);
  if (!record) {
    return json({ ok: false, error: "Invalid or expired setup token." }, 401);
  }
  if (sessionExpired(record.expiresAt)) {
    installSetupTokens.delete(token);
    return json({ ok: false, error: "Invalid or expired setup token." }, 401);
  }

  const user = persisted.users[record.userId];
  const previousBridgeDevices = user ? { ...user.bridgeDevices } : null;
  const previousClaimCount = record.claimCount;
  const previousLastClaimedAt = record.lastClaimedAt;

  try {
    const version = computeInstallAssetsVersion();
    await ensureBundledBridgeRuntimeInstallAsset(version);
    const origin = buildOrigin(req);
    if (!user) {
      installSetupTokens.delete(token);
      return json({ ok: false, error: "Bridge user not found." }, 404);
    }

    const bridgeToken = issueBridgeAccessToken(record.userId);
    record.claimCount += 1;
    record.lastClaimedAt = new Date().toISOString();
    persistNow();
    return json({
      ok: true,
      relayOrigin: origin,
      relayLabel: RELAY_LABEL,
      bridgeToken,
      bridgeRuntimeUrl: `${origin}/install/bridge-runtime-${version}.ts`,
      version,
    });
  } catch (error) {
    record.claimCount = previousClaimCount;
    record.lastClaimedAt = previousLastClaimedAt;
    if (user) {
      user.bridgeDevices = previousBridgeDevices ?? {};
    }
    return json({ ok: false, error: `Install setup claim failed: ${readErrorMessage(error)}` }, 500);
  }
}

function serveInstallSource(filePath: string, contentType: string) {
  if (!existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Bun.file(filePath), {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

async function serveBridgeRuntimeInstallSource(pathname: string) {
  const currentVersion = computeInstallAssetsVersion();
  const requestedVersion = extractBridgeRuntimeVersion(pathname);
  const targetVersion = requestedVersion || currentVersion;

  if (requestedVersion && requestedVersion !== currentVersion) {
    const historicalAssetPath = resolve(installAssetsDir, `bridge-runtime-${requestedVersion}.ts`);
    return serveInstallSource(historicalAssetPath, "text/plain; charset=utf-8");
  }

  const assetPath = await ensureBundledBridgeRuntimeInstallAsset(targetVersion);
  return serveInstallSource(assetPath, "text/plain; charset=utf-8");
}

function extractBridgeRuntimeVersion(pathname: string) {
  const match = pathname.match(/^\/install\/bridge-runtime-([A-Za-z0-9.-]+)\.(?:js|ts)$/);
  return match?.[1] ?? "";
}

async function ensureBundledBridgeRuntimeInstallAsset(version: string) {
  const assetPath = resolve(installAssetsDir, `bridge-runtime-${version}.ts`);
  if (existsSync(assetPath)) {
    return assetPath;
  }

  mkdirSync(installAssetsDir, { recursive: true });
  const bunBin = Bun.which("bun") ?? process.execPath;
  const build = spawnSync(
    bunBin,
    [
      "build",
      bridgeRuntimeSourcePath,
      "--target=bun",
      "--format=esm",
      "--packages=bundle",
      "--outfile",
      assetPath,
    ],
    {
      cwd: appRoot,
      encoding: "utf8",
    }
  );

  if (build.status !== 0 || !existsSync(assetPath)) {
    const stderr = build.stderr?.trim();
    const stdout = build.stdout?.trim();
    throw new Error(stderr || stdout || "Failed to bundle bridge runtime install asset.");
  }

  return assetPath;
}

function computeInstallAssetsVersion() {
  const packageJson = JSON.parse(readFileSync(bridgeInstallerPackageJsonPath, "utf8")) as { version?: string };
  const packageVersion = packageJson.version || "0.1.0";
  const lastSourceEdit = Math.max(
    statSync(currentFile).mtimeMs,
    statSync(bridgeRuntimeSourcePath).mtimeMs,
    statSync(sharedPackageJsonPath).mtimeMs,
    statSync(sharedSourcePath).mtimeMs,
    statSync(bridgeInstallerPackageJsonPath).mtimeMs,
    statSync(bridgeInstallerSourcePath).mtimeMs,
    statSync(bridgeInstallScriptSourcePath).mtimeMs
  );
  return `${packageVersion}-${Math.floor(lastSourceEdit).toString(36)}`;
}

function buildWindowsInstallCommand(bridgeInstallerUrl: string, relayOrigin: string, setupToken: string) {
  const bunInstallCommand = `powershell -c "irm bun.sh/install.ps1 | iex"`;
  const script =
    `if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { ` +
    `Write-Error 'bun is required to run phodex-bridge. Install it first with the official command: ${escapePowerShellSingleQuoted(bunInstallCommand)}'; ` +
    `exit 1 ` +
    `}; ` +
    `$installer = Join-Path $env:TEMP 'phodex-bridge-installer.js'; ` +
    `Invoke-WebRequest -UseBasicParsing '${escapePowerShellSingleQuoted(bridgeInstallerUrl)}' -OutFile $installer; ` +
    `bun $installer install --relay '${escapePowerShellSingleQuoted(relayOrigin)}' --token '${escapePowerShellSingleQuoted(setupToken)}'`;
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command '${escapePowerShellSingleQuoted(script)}'`;
}

function escapePowerShellSingleQuoted(value: string) {
  return value.replaceAll("'", "''");
}

function issueInstallSetupToken(userId: string) {
  pruneExpiredInstallSetupTokens();
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + INSTALL_SETUP_TOKEN_TTL_MS).toISOString();
  installSetupTokens.set(token, {
    userId,
    expiresAt,
    claimCount: 0,
    lastClaimedAt: null,
  });
  return { token, expiresAt };
}

function pruneExpiredInstallSetupTokens() {
  const now = Date.now();
  for (const [token, record] of installSetupTokens.entries()) {
    if (Date.parse(record.expiresAt) <= now) {
      installSetupTokens.delete(token);
    }
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.includes("@") ? email : "";
}

async function deliverCode(email: string, code: string): Promise<DeliveryMode> {
  if (!OTP_MAIL_CONFIG) {
    throw new Error("OTP email delivery is not configured on this relay.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OTP_MAIL_CONFIG.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: OTP_MAIL_CONFIG.authEmailFrom,
      to: [email],
      subject: "Your Phodex verification code",
      html: renderOtpEmail(code),
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(`Resend API returned ${response.status}: ${detail || "unknown error"}`);
  }

  return "resend";
}

function resolveOtpMailConfig(): OtpMailConfig | null {
  const envValue = (key: string) => {
    const direct = readConfigValue(process.env[key]);
    if (direct) {
      return direct;
    }
    const fallback = readOptionalEnvFile(AUTH_ENV_FALLBACK_FILE);
    return readConfigValue(fallback[key]);
  };

  const resendApiKey = envValue("PHODEX_RESEND_API_KEY") || envValue("RESEND_API_KEY");
  const authEmailFrom = envValue("PHODEX_AUTH_EMAIL_FROM") || envValue("AUTH_EMAIL_FROM");
  if (!resendApiKey || !authEmailFrom) {
    return null;
  }

  return {
    resendApiKey,
    authEmailFrom,
    sourceLabel: AUTH_ENV_FALLBACK_FILE,
  };
}

function readOptionalEnvFile(filePath: string) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const values: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        continue;
      }
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function readConfigValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function renderOtpEmail(code: string) {
  const safeCode = escapeHtml(code);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <body style=\"margin:0;background:#0d0d0f;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">",
    '    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 0;background:#0d0d0f;">',
    "      <tr>",
    '        <td align="center">',
    '          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#151518;border:1px solid rgba(255,255,255,0.08);border-radius:28px;padding:32px;">',
    "            <tr>",
    '              <td style="font-size:14px;letter-spacing:0.24em;text-transform:uppercase;color:rgba(255,255,255,0.56);padding-bottom:16px;">Phodex</td>',
    "            </tr>",
    "            <tr>",
    '              <td style="font-size:32px;line-height:1.15;font-weight:700;padding-bottom:16px;">Your verification code</td>',
    "            </tr>",
    "            <tr>",
    '              <td style="font-size:16px;line-height:1.7;color:rgba(255,255,255,0.72);padding-bottom:28px;">Use this one-time code to sign in to Phodex. It expires in 5 minutes.</td>',
    "            </tr>",
    "            <tr>",
    '              <td style="font-size:40px;line-height:1;font-weight:700;letter-spacing:0.18em;padding:18px 20px;border-radius:24px;background:#ffffff;color:#111111;text-align:center;">',
    `                ${safeCode}`,
    "              </td>",
    "            </tr>",
    "          </table>",
    "        </td>",
    "      </tr>",
    "    </table>",
    "  </body>",
    "</html>",
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(req: Request) {
  return req.json().catch(() => null);
}

function otpExpired(expiresAt: string) {
  return Date.parse(expiresAt) <= Date.now();
}

function sessionExpired(expiresAt: string) {
  return Date.parse(expiresAt) <= Date.now();
}

function schedulePersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistNow();
  }, 120);
}

function persistNow() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(dataFile, JSON.stringify(persisted, null, 2));
}

function refreshPersisted() {
  persisted = loadState();
  return persisted;
}

function normalizePersistedBridgeDevices(user: LegacyPersistedUser | undefined) {
  const bridgeDevices = Object.fromEntries(
    Object.entries(user?.bridgeDevices ?? {})
      .filter(([, bridgeDevice]) => Boolean(bridgeDevice?.tokenHash))
      .map(([bridgeId, bridgeDevice]) => [
        bridgeId,
        {
          id: bridgeDevice?.id || bridgeId,
          tokenHash: bridgeDevice?.tokenHash ?? "",
          issuedAt: bridgeDevice?.issuedAt ?? new Date(0).toISOString(),
          lastConnectedAt: bridgeDevice?.lastConnectedAt ?? null,
          macLabel: bridgeDevice?.macLabel ?? null,
        } satisfies PersistedBridgeDevice,
      ])
  );

  if (Object.keys(bridgeDevices).length > 0 || !user?.bridgeAuth?.tokenHash) {
    return bridgeDevices;
  }

  const legacyBridgeId = `bridge-${user.bridgeAuth.tokenHash.slice(0, 12)}`;
  return {
    [legacyBridgeId]: {
      id: legacyBridgeId,
      tokenHash: user.bridgeAuth.tokenHash,
      issuedAt: user.bridgeAuth.issuedAt,
      lastConnectedAt: user.bridgeAuth.lastConnectedAt ?? null,
      macLabel: null,
    },
  } satisfies Record<string, PersistedBridgeDevice>;
}

function loadState(): PersistedState {
  try {
    if (!existsSync(dataFile)) {
      return {
        users: {},
        sessions: {},
        otpCodes: {},
      };
    }

    const parsed = JSON.parse(readFileSync(dataFile, "utf8")) as Partial<PersistedState>;
    const users = Object.fromEntries(
      Object.entries(parsed.users ?? {}).map(([userId, rawUser]) => {
        const user = rawUser as LegacyPersistedUser | undefined;
        return [
        userId,
        {
          ...user,
          bridgeDevices: normalizePersistedBridgeDevices(user),
        } as PersistedUser,
      ];
      })
    );
    return {
      users,
      sessions: parsed.sessions ?? {},
      otpCodes: parsed.otpCodes ?? {},
    };
  } catch {
    return {
      users: {},
      sessions: {},
      otpCodes: {},
    };
  }
}
