import { spawnSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { hostname, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  AppSettings,
  AppSnapshot,
  AuthSession,
  BridgeCommand,
  BridgeDispatchEvent,
  BridgeEvent,
  ClientEvent,
  CompletionBanner,
  DeliveryMode,
  RelayConnection,
  RequestCodeResponse,
  ServerEvent,
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
};

type SocketData = ClientSocketData | BridgeSocketData;

type OtpMailConfig = {
  resendApiKey: string;
  authEmailFrom: string;
  sourceLabel: string;
};

type InstallAssets = {
  version: string;
  runtimePath: string;
  installerPath: string;
};

type SetupTokenRecord = {
  expiresAt: string;
  usedAt: string | null;
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
const bridgeInstallerPackageDir = resolve(appRoot, "packages/bridge-installer");
const bridgeInstallerPackageJsonPath = resolve(bridgeInstallerPackageDir, "package.json");
const bridgeInstallerBinPath = resolve(bridgeInstallerPackageDir, "bin/phodex-bridge.js");

const HOST = process.env.PHODEX_HOST ?? "0.0.0.0";
const PORT = Number(process.env.PHODEX_PORT ?? "3443");
const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const INSTALL_SETUP_TOKEN_TTL_MS = 5 * 60 * 1000;
const RELAY_LABEL = process.env.PHODEX_RELAY_LABEL ?? "Phodex Public Relay";
const DEFAULT_MAC_LABEL = process.env.PHODEX_MAC_LABEL ?? hostname();
const BRIDGE_SECRET = process.env.PHODEX_BRIDGE_SECRET ?? "phodex-local-bridge";
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

let persisted = loadState();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const clientsByUserId = new Map<string, Set<ServerWebSocket<SocketData>>>();
const threadMirror = new Map<string, ThreadRecord>();
let bridgeSocket: ServerWebSocket<SocketData> | null = null;
let installAssetsPromise: Promise<InstallAssets> | null = null;
let cachedInstallAssets: InstallAssets | null = null;
const installSetupTokens = new Map<string, SetupTokenRecord>();
let bridgeConnection: RelayConnection = {
  state: "disconnected",
  relayLabel: RELAY_LABEL,
  macLabel: DEFAULT_MAC_LABEL,
  latencyMs: 0,
  lastSyncAt: null,
};

const server = Bun.serve<SocketData>({
  hostname: HOST,
  port: PORT,
  async fetch(req, serverInstance) {
    const url = new URL(req.url);

    if (url.pathname === "/relay") {
      const token = url.searchParams.get("token");
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
      const secret = url.searchParams.get("secret");
      if (!secret || secret !== BRIDGE_SECRET) {
        return withCors(req, json({ ok: false, error: "Unauthorized" }, 401));
      }

      const upgraded = serverInstance.upgrade(req, {
        data: {
          kind: "bridge",
        } satisfies BridgeSocketData,
      });
      return upgraded ? undefined : withCors(req, json({ ok: false, error: "Upgrade failed" }, 400));
    }

    if (req.method === "OPTIONS") {
      return withCors(req, new Response(null, { status: 204 }));
    }

    if (url.pathname === "/api/health") {
      return withCors(
        req,
        json({
          ok: true,
          relay: RELAY_LABEL,
          bridgeConnected: Boolean(bridgeSocket),
          connection: bridgeConnection,
          users: Object.keys(persisted.users).length,
        })
      );
    }

    if (url.pathname === "/install/manifest.json" && req.method === "GET") {
      return withCors(req, await handleInstallManifest(req));
    }

    if (url.pathname === "/install/claim" && req.method === "POST") {
      return withCors(req, await handleInstallClaim(req));
    }

    if (
      (url.pathname === "/install/bridge-runtime.js" || /^\/install\/bridge-runtime-[A-Za-z0-9.-]+\.js$/.test(url.pathname)) &&
      req.method === "GET"
    ) {
      return withCors(req, await serveInstallAsset(url.pathname, "text/javascript; charset=utf-8"));
    }

    if (
      (url.pathname === "/install/phodex-bridge-installer.tgz" ||
        /^\/install\/phodex-bridge-installer-[A-Za-z0-9.-]+\.tgz$/.test(url.pathname)) &&
      req.method === "GET"
    ) {
      return withCors(req, await serveInstallAsset(url.pathname, "application/gzip"));
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
        if (bridgeSocket && bridgeSocket !== ws) {
          bridgeSocket.close(1000, "Superseded by a newer bridge connection.");
        }
        bridgeSocket = ws;
        broadcastPresenceToAllUsers();
        sendBridgeCommand({ type: "bridge:sync-all" });
        return;
      }

      registerSocket(ws);
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(ws.data.userId) });
      broadcastPresenceToAllUsers();
    },
    message(ws, raw) {
      if (ws.data.kind === "bridge") {
        handleBridgeMessage(raw.toString());
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
        if (bridgeSocket === ws) {
          bridgeSocket = null;
        }
        bridgeConnection = {
          ...bridgeConnection,
          state: "disconnected",
          latencyMs: 0,
        };
        broadcastPresenceToAllUsers();
        return;
      }

      unregisterSocket(ws);
      broadcastPresenceToAllUsers();
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
  schedulePersist();

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
  schedulePersist();

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
      if (bridgeSocket) {
        sendBridgeCommand({ type: "bridge:sync-all" });
        if (user.selectedThreadId) {
          sendBridgeCommand({ type: "bridge:sync-thread", threadId: user.selectedThreadId });
        }
      }
      break;
    case "thread:create":
      dispatchToBridge(user, event);
      break;
    case "thread:select":
      user.selectedThreadId = event.threadId;
      user.banner = null;
      schedulePersist();
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      dispatchToBridge(user, event);
      break;
    case "thread:clearSelection":
      user.selectedThreadId = null;
      schedulePersist();
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      break;
    case "thread:rename":
    case "thread:archive":
    case "message:send":
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
  if (!bridgeSocket) {
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
  bridgeSocket.send(JSON.stringify(command));
  return true;
}

function handleBridgeMessage(raw: string) {
  let event: BridgeEvent | null = null;
  try {
    event = JSON.parse(raw) as BridgeEvent;
  } catch {
    return;
  }

  if (!event) {
    return;
  }

  switch (event.type) {
    case "bridge:state":
      threadMirror.clear();
      for (const thread of event.threads) {
        threadMirror.set(thread.id, thread);
      }
      bridgeConnection = event.connection;
      normalizeSelections();
      broadcastSnapshotsToAllUsers();
      broadcastPresenceToAllUsers();
      break;
    case "bridge:thread:updated":
      threadMirror.set(event.thread.id, event.thread);
      normalizeSelections();
      broadcastThreadToAllUsers(event.thread.id);
      break;
    case "bridge:message:appended":
      appendMirroredMessage(event.threadId, event.message);
      broadcastToAllUsers({ type: "message:appended", threadId: event.threadId, message: event.message });
      break;
    case "bridge:message:delta":
      applyMirroredDelta(event.threadId, event.messageId, event.delta);
      broadcastToAllUsers({ type: "message:delta", threadId: event.threadId, messageId: event.messageId, delta: event.delta });
      break;
    case "bridge:message:finished":
      finishMirroredMessage(event.threadId, event.messageId);
      broadcastToAllUsers({ type: "message:finished", threadId: event.threadId, messageId: event.messageId });
      break;
    case "bridge:presence":
      bridgeConnection = event.connection;
      broadcastPresenceToAllUsers();
      break;
    case "bridge:banner":
      for (const user of Object.values(persisted.users)) {
        user.banner = event.banner;
      }
      schedulePersist();
      broadcastBannersToAllUsers();
      break;
    case "bridge:user-patch": {
      const user = persisted.users[event.userId];
      if (!user) {
        break;
      }
      if (Object.prototype.hasOwnProperty.call(event, "selectedThreadId")) {
        user.selectedThreadId = event.selectedThreadId ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(event, "banner")) {
        user.banner = event.banner ?? null;
        broadcast(user.profile.id, { type: "banner", banner: user.banner });
      }
      schedulePersist();
      broadcast(user.profile.id, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      break;
    }
    case "bridge:toast":
      if (event.userId) {
        sendToast(event.userId, event.tone, event.message);
      } else {
        broadcastToAllUsers({ type: "toast", tone: event.tone, message: event.message });
      }
      break;
  }
}

function appendMirroredMessage(threadId: string, message: ThreadMessage) {
  const thread = ensureMirroredThread(threadId);
  const existingIndex = thread.messages.findIndex((entry) => entry.id === message.id);
  if (existingIndex === -1) {
    thread.messages.push(message);
  } else {
    thread.messages[existingIndex] = {
      ...thread.messages[existingIndex],
      ...message,
    };
  }
  thread.preview = message.text || thread.preview;
  thread.lastActivityAt = message.createdAt;
}

function applyMirroredDelta(threadId: string, messageId: string, delta: string) {
  const thread = ensureMirroredThread(threadId);
  const message = thread.messages.find((entry) => entry.id === messageId);
  if (!message) {
    return;
  }
  message.text += delta;
  message.isStreaming = true;
  thread.preview = message.text || thread.preview;
  thread.lastActivityAt = new Date().toISOString();
}

function finishMirroredMessage(threadId: string, messageId: string) {
  const thread = ensureMirroredThread(threadId);
  const message = thread.messages.find((entry) => entry.id === messageId);
  if (!message) {
    return;
  }
  message.isStreaming = false;
  thread.lastActivityAt = new Date().toISOString();
}

function ensureMirroredThread(threadId: string) {
  const existing = threadMirror.get(threadId);
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
  threadMirror.set(threadId, thread);
  return thread;
}

function snapshotForUser(userId: string): AppSnapshot {
  const user = persisted.users[userId];
  const threads = [...threadMirror.values()].sort((left, right) => {
    const leftArchived = left.state === "archived" ? 1 : 0;
    const rightArchived = right.state === "archived" ? 1 : 0;
    if (leftArchived !== rightArchived) {
      return leftArchived - rightArchived;
    }
    return Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
  });

  return {
    user: user.profile,
    selectedThreadId: user.selectedThreadId,
    threads,
    settings: user.settings,
    connection: bridgeConnection,
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
    };
    normalizeSelections();
    schedulePersist();
  }

  return persisted.users[userId];
}

function normalizeSelections() {
  const firstLiveThreadId = findFirstLiveThreadId();
  const firstAnyThreadId = [...threadMirror.values()]
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
    .at(0)?.id ?? null;

  for (const user of Object.values(persisted.users)) {
    if (user.selectedThreadId === null) {
      continue;
    }
    if (threadMirror.has(user.selectedThreadId)) {
      continue;
    }
    user.selectedThreadId = firstLiveThreadId ?? firstAnyThreadId;
  }
}

function findFirstLiveThreadId(excludingThreadId?: string) {
  return [...threadMirror.values()]
    .filter((thread) => thread.id !== excludingThreadId && thread.state !== "archived")
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
    .at(0)?.id ?? null;
}

function authenticate(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const session = persisted.sessions[token];
  if (!session || sessionExpired(session.expiresAt)) {
    return null;
  }
  return session;
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

function sendBridgeCommand(command: BridgeCommand) {
  if (!bridgeSocket) {
    return;
  }
  bridgeSocket.send(JSON.stringify(command));
}

function broadcastThreadToAllUsers(threadId: string) {
  const thread = threadMirror.get(threadId);
  if (!thread) {
    return;
  }
  for (const [userId, user] of Object.entries(persisted.users)) {
    broadcast(userId, {
      type: "thread:updated",
      thread,
      selectedThreadId: user.selectedThreadId,
    });
  }
}

function broadcastSnapshotsToAllUsers() {
  for (const userId of Object.keys(persisted.users)) {
    broadcast(userId, { type: "snapshot", snapshot: snapshotForUser(userId) });
  }
}

function broadcastBannersToAllUsers() {
  for (const [userId, user] of Object.entries(persisted.users)) {
    broadcast(userId, { type: "banner", banner: user.banner });
  }
}

function broadcastPresenceToAllUsers() {
  for (const userId of Object.keys(persisted.users)) {
    broadcast(userId, { type: "presence", connection: bridgeConnection });
  }
}

function sendToast(userId: string, tone: "info" | "success" | "error", message: string) {
  broadcast(userId, { type: "toast", tone, message });
}

function broadcastToAllUsers(event: ServerEvent) {
  const payload = JSON.stringify(event);
  for (const sockets of clientsByUserId.values()) {
    for (const socket of sockets) {
      socket.send(payload);
    }
  }
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
  const origin = req.headers.get("origin");
  if (!origin) {
    return requestOrigin;
  }
  if (origin === requestOrigin || DEV_ORIGINS.has(origin) || ALLOWED_ORIGINS.has(origin)) {
    return origin;
  }
  return requestOrigin;
}

function withCors(req: Request, response: Response) {
  response.headers.set("access-control-allow-origin", buildOrigin(req));
  response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type,authorization");
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
  try {
    const assets = await ensureInstallAssets();
    const origin = buildOrigin(req);
    const installerUrl = `${origin}/install/${basename(assets.installerPath)}`;
    const bridgeRuntimeUrl = `${origin}/install/${basename(assets.runtimePath)}`;
    const { token, expiresAt } = issueInstallSetupToken();
    return json({
      version: assets.version,
      relayOrigin: origin,
      relayLabel: RELAY_LABEL,
      installerUrl,
      bridgeRuntimeUrl,
      setupToken: token,
      setupTokenExpiresAt: expiresAt,
      command: `bunx phodex-bridge-installer@${installerUrl} --relay ${origin} --token ${token}`,
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
  if (record.usedAt) {
    return json({ ok: false, error: "Setup token has already been used." }, 409);
  }

  try {
    const assets = await ensureInstallAssets();
    const origin = buildOrigin(req);
    record.usedAt = new Date().toISOString();
    return json({
      ok: true,
      relayOrigin: origin,
      relayLabel: RELAY_LABEL,
      bridgeSecret: BRIDGE_SECRET,
      bridgeRuntimeUrl: `${origin}/install/${basename(assets.runtimePath)}`,
      version: assets.version,
    });
  } catch (error) {
    record.usedAt = null;
    return json({ ok: false, error: `Install setup claim failed: ${readErrorMessage(error)}` }, 500);
  }
}

async function serveInstallAsset(pathname: string, contentType: string) {
  let assets: InstallAssets;
  try {
    assets = await ensureInstallAssets();
  } catch (error) {
    return new Response(`Install asset build failed: ${readErrorMessage(error)}`, { status: 500 });
  }

  const assetName =
    pathname === "/install/bridge-runtime.js"
      ? basename(assets.runtimePath)
      : pathname === "/install/phodex-bridge-installer.tgz"
        ? basename(assets.installerPath)
        : basename(pathname);
  const filePath = resolve(installAssetsDir, assetName);
  if (!filePath.startsWith(`${installAssetsDir}/`) || !existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Bun.file(filePath), {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
    },
  });
}

async function ensureInstallAssets() {
  const version = computeInstallAssetsVersion();
  if (
    cachedInstallAssets &&
    cachedInstallAssets.version === version &&
    existsSync(cachedInstallAssets.runtimePath) &&
    existsSync(cachedInstallAssets.installerPath)
  ) {
    return cachedInstallAssets;
  }

  if (installAssetsPromise) {
    return installAssetsPromise;
  }

  installAssetsPromise = (async () => {
    mkdirSync(installAssetsDir, { recursive: true });

    const runtimePath = resolve(installAssetsDir, `bridge-runtime-${version}.js`);
    const installerPath = resolve(installAssetsDir, `phodex-bridge-installer-${version}.tgz`);

    if (!existsSync(runtimePath)) {
      const result = await Bun.build({
        entrypoints: [bridgeRuntimeSourcePath],
        target: "bun",
        minify: false,
        naming: "bridge-runtime.js",
        outdir: installAssetsDir,
        write: false,
      });
      if (!result.success) {
        throw new Error(result.logs.map((entry) => entry.message).join("\n") || "Unknown bridge build failure");
      }
      const output = result.outputs[0];
      if (!output) {
        throw new Error("Bridge build did not emit an output file.");
      }
      writeFileSync(runtimePath, Buffer.from(await output.arrayBuffer()));
    }

    if (!existsSync(installerPath)) {
      buildInstallerArchive(installerPath);
    }

    cachedInstallAssets = { version, runtimePath, installerPath };
    return cachedInstallAssets;
  })().finally(() => {
    installAssetsPromise = null;
  });

  return installAssetsPromise;
}

function computeInstallAssetsVersion() {
  const packageJson = JSON.parse(readFileSync(bridgeInstallerPackageJsonPath, "utf8")) as { version?: string };
  const packageVersion = packageJson.version || "0.1.0";
  const lastSourceEdit = Math.max(
    statSync(bridgeRuntimeSourcePath).mtimeMs,
    statSync(bridgeInstallerPackageJsonPath).mtimeMs,
    statSync(bridgeInstallerBinPath).mtimeMs
  );
  return `${packageVersion}-${Math.floor(lastSourceEdit).toString(36)}`;
}

function issueInstallSetupToken() {
  pruneExpiredInstallSetupTokens();
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + INSTALL_SETUP_TOKEN_TTL_MS).toISOString();
  installSetupTokens.set(token, {
    expiresAt,
    usedAt: null,
  });
  return { token, expiresAt };
}

function pruneExpiredInstallSetupTokens() {
  const now = Date.now();
  for (const [token, record] of installSetupTokens.entries()) {
    if (record.usedAt || Date.parse(record.expiresAt) <= now) {
      installSetupTokens.delete(token);
    }
  }
}

function buildInstallerArchive(installerPath: string) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "phodex-bridge-installer-"));
  const packageRoot = resolve(tempRoot, "package");
  mkdirSync(resolve(packageRoot, "bin"), { recursive: true });
  writeFileSync(resolve(packageRoot, "package.json"), readFileSync(bridgeInstallerPackageJsonPath));
  writeFileSync(resolve(packageRoot, "bin/phodex-bridge.js"), readFileSync(bridgeInstallerBinPath));
  chmodSync(resolve(packageRoot, "bin/phodex-bridge.js"), 0o755);

  const packed = spawnSync("tar", ["-czf", installerPath, "-C", tempRoot, "package"], {
    encoding: "utf8",
  });

  rmSync(tempRoot, { recursive: true, force: true });

  if (packed.status !== 0) {
    throw new Error(packed.stderr?.trim() || packed.stdout?.trim() || "Unknown installer archive failure");
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
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(dataFile, JSON.stringify(persisted, null, 2));
    persistTimer = null;
  }, 120);
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
    return {
      users: parsed.users ?? {},
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
