import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildGeneratedUserMessageId,
  buildPromptTraceKey,
  dedupeThreadMessages,
  findEquivalentThreadMessageIndex,
  GENERATED_USER_MESSAGE_ID_PREFIX,
  summarizePromptForTrace,
  upsertThreadMessage,
} from "@phodex/shared";
import type {
  AppSettings,
  AppSnapshot,
  BridgeProjectRequest,
  BridgeCommand,
  BridgeDispatchEvent,
  BridgeEvent,
  ClientEvent,
  CodexRateLimitSnapshot,
  CompletionBanner,
  DiffStats,
  FileChangeSummary,
  ImageMessageCard,
  InputImageAttachment,
  MessageSendOutcome,
  ProjectDiffFile,
  ProjectDiffPayload,
  ProjectFilePayload,
  ProjectResourcePayload,
  ProjectTreeEntry,
  ProjectTreePayload,
  QueuedDraft,
  RelayConnection,
  ServerEvent,
  ThreadMessage,
  ThreadHistoryState,
  ThreadRecord,
  UserSummary,
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

type ThreadLocalState = {
  customTitle?: string;
  queuedDrafts: QueuedDraft[];
  diff: DiffStats;
};

type PersistedState = {
  users: Record<string, PersistedUser>;
  sessions: Record<string, SessionRecord>;
  threadLocal: Record<string, ThreadLocalState>;
};

type SocketData = {
  userId: string;
  token: string;
};

type PendingCodexRequest = {
  method: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActiveTurnState = {
  userId: string;
  threadId: string;
  turnId: string;
  assistantMessageId: string | null;
  itemSequence: number;
  startedAt: string;
  mode: "chat" | "plan";
  promptTrace: string;
  promptSummary: string;
};

type PendingTurnTrace = {
  userId: string;
  promptTrace: string;
  promptSummary: string;
  mode: "chat" | "plan";
};

type ThreadListResponse = {
  data: any[];
  nextCursor: string | null;
};

type ThreadTurnsListResponse = {
  data: any[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

type ThreadTurnPaginationState = {
  nextCursor: string | null;
  backwardsCursor: string | null;
  loadedTurns: number;
};

type SessionTurnHistoryFallback = {
  fileChanges: FileChangeSummary[];
};

type SessionHistoryFallback = {
  turns: Map<string, SessionTurnHistoryFallback>;
  totalDiff: DiffStats;
};

type ThreadCreateRequest = Extract<ClientEvent, { type: "thread:create" }>;
type MessageSendResult =
  | { ok: true; outcome: MessageSendOutcome }
  | { ok: false; message: string };

type ProjectContext = {
  requestedCwd: string;
  projectRoot: string;
  gitCommonDir: string | null;
  isRepo: boolean;
};

class ProjectResourceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const serverRoot = resolve(currentDir, "..");
const appRoot = resolve(serverRoot, "../..");
const dataDir = resolve(serverRoot, "data");
const dataFile = process.env.PHODEX_STATE_FILE ?? resolve(dataDir, "bridge-state.json");
const certDir = resolve(serverRoot, "certs");
const distDir = resolve(appRoot, "apps/web/dist");

const HOST = process.env.PHODEX_HOST ?? "0.0.0.0";
const PORT = Number(process.env.PHODEX_PORT ?? "3443");
const DEVICE_LABEL = process.env.PHODEX_DEVICE_LABEL ?? process.env.PHODEX_MAC_LABEL ?? hostname();
const RELAY_LABEL = process.env.PHODEX_RELAY_LABEL ?? "Phodex Public Relay";
const PUBLIC_RELAY_URL = process.env.PHODEX_RELAY_URL ?? "ws://127.0.0.1:3443";
const BRIDGE_TOKEN = process.env.PHODEX_BRIDGE_TOKEN?.trim() ?? "";
const LEGACY_BRIDGE_SECRET = process.env.PHODEX_BRIDGE_SECRET?.trim() ?? "";
const BRIDGE_RECONNECT_MS = Number(process.env.PHODEX_BRIDGE_RECONNECT_MS ?? "1500");
const DEFAULT_THREAD_CWD = process.env.PHODEX_DEFAULT_CWD ?? appRoot;
const PROJECTS_ROOT = process.env.PHODEX_PROJECTS_ROOT ?? resolve(homedir(), ".phodex-web/projects");
const WORKTREE_ROOT = process.env.PHODEX_WORKTREE_ROOT ?? resolve(homedir(), ".codex/worktrees");
const MAX_IMAGE_ARTIFACT_PREVIEW_BYTES = 5 * 1024 * 1024;
const CODEX_WS_URL = process.env.PHODEX_CODEX_WS_URL ?? "ws://127.0.0.1:8765";
const CODEX_READY_URL = CODEX_WS_URL.replace(/^ws/i, "http") + "/readyz";
const CODEX_REQUEST_TIMEOUT_MS = 20_000;
const configuredThreadStartTimeoutMs = Number(process.env.PHODEX_CODEX_THREAD_START_TIMEOUT_MS ?? "120000");
const CODEX_THREAD_START_TIMEOUT_MS = Number.isFinite(configuredThreadStartTimeoutMs)
  ? Math.max(60_000, configuredThreadStartTimeoutMs)
  : 120_000;
const configuredThreadStartRetries = Number(process.env.PHODEX_CODEX_THREAD_START_RETRIES ?? "2");
const CODEX_THREAD_START_RETRIES = Number.isFinite(configuredThreadStartRetries)
  ? Math.max(0, Math.floor(configuredThreadStartRetries))
  : 2;
const MANAGE_CODEX = process.env.PHODEX_MANAGE_CODEX !== "false";
const ACTIVE_TURN_STALE_MS = Math.max(60_000, Number(process.env.PHODEX_ACTIVE_TURN_STALE_MS ?? "600000"));
const CODEX_THREAD_TURNS_PAGE_SIZE = Math.max(1, Number(process.env.PHODEX_CODEX_THREAD_TURNS_PAGE_SIZE ?? "100"));
const CODEX_BIN = resolveCodexBinary();
const FLOW_TRACE_ENABLED = /^(1|true)$/i.test(process.env.PHODEX_FLOW_TRACE ?? "");
const DEV_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://localhost:5173",
  "https://127.0.0.1:5173",
  `https://localhost:${PORT}`,
  `https://127.0.0.1:${PORT}`,
]);

let persisted = loadState();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const clientsByUserId = new Map<string, Set<ServerWebSocket<SocketData>>>();
const bridgeUsers = new Map<string, PersistedUser>();
const threadCache = new Map<string, ThreadRecord>();
const activeTurns = new Map<string, ActiveTurnState>();
const pendingTurnModes = new Map<string, "chat" | "plan">();
const pendingTurnTraces = new Map<string, PendingTurnTrace>();
const activeTurnStaleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const codexRequestWaiters = new Map<string, PendingCodexRequest>();
const projectContextCache = new Map<string, ProjectContext>();
const threadReadInFlight = new Map<string, Promise<ThreadRecord | null>>();
const threadHistoryPageInFlight = new Map<string, Promise<ThreadRecord | null>>();
const threadTurnPaginationByThreadId = new Map<string, ThreadTurnPaginationState>();
let codexSupportsThreadTurnsList = true;

function logFlowTrace(phase: string, details: Record<string, unknown> = {}) {
  if (!FLOW_TRACE_ENABLED) {
    return;
  }
  console.log(
    `[phodex-flow][bridge] ${JSON.stringify({
      scope: "bridge",
      ts: new Date().toISOString(),
      phase,
      ...details,
    })}`
  );
}

let codexProcess: ChildProcessWithoutNullStreams | null = null;
let codexSocket: WebSocket | null = null;
let codexReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let relaySocket: WebSocket | null = null;
let relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let codexConnectionState: RelayConnection["state"] = "connecting";
let codexLastSyncAt: string | null = null;
let codexRateLimits: CodexRateLimitSnapshot | null = null;
let codexRequestSeq = 0;
let threadSyncInFlight: Promise<void> | null = null;
let codexSupportsServiceTier = true;
let codexSupportsTurnSteer = true;
let serviceTierUnsupportedToastSent = false;
const selectedThreadHydrationRetryCounts = new Map<string, number>();
const selectedThreadHydrationRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
connectRelaySocket();
// Bun can fail the remote WSS handshake if the localhost ready probe and relay
// socket race during startup, so establish the relay first.
void ensureCodexBridge();

console.log(`[phodex-bridge] Local bridge starting for ${PUBLIC_RELAY_URL}`);
console.log(`[phodex-bridge] Codex target ${CODEX_WS_URL}`);
if (MANAGE_CODEX) {
  console.warn(
    `[phodex-bridge] Managed Codex fallback is enabled. If no app-server is already running at ${CODEX_WS_URL}, the bridge will launch a background Codex process that may need its own macOS file or automation permissions.`
  );
} else {
  console.log(`[phodex-bridge] Reusing external Codex app-server ${CODEX_WS_URL} with managed fallback disabled.`);
}
process.on("SIGINT", shutdownCodexBridge);
process.on("SIGTERM", shutdownCodexBridge);

function buildBridgeSocketUrl() {
  const url = new URL(PUBLIC_RELAY_URL);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  url.pathname = "/bridge";
  url.search = "";
  if (BRIDGE_TOKEN) {
    url.searchParams.set("token", BRIDGE_TOKEN);
  } else if (LEGACY_BRIDGE_SECRET) {
    url.searchParams.set("secret", LEGACY_BRIDGE_SECRET);
  }
  return url.toString();
}

function connectRelaySocket() {
  if (relaySocket && (relaySocket.readyState === WebSocket.OPEN || relaySocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  clearRelayReconnectTimer();
  const target = buildBridgeSocketUrl();
  const socket = new WebSocket(target);
  relaySocket = socket;

  socket.addEventListener("open", () => {
    console.log(`[phodex-bridge] Connected to relay ${target}`);
    sendBridgeState();
    publishPresenceToAllUsers();
    void syncAllThreadsFromCodex().catch((error) => {
      console.error(`[phodex-bridge] initial sync failed: ${readErrorMessage(error)}`);
    });
  });

  socket.addEventListener("message", (event) => {
    handleRelayMessage(typeof event.data === "string" ? event.data : event.data.toString());
  });

  socket.addEventListener("error", (event) => {
    console.warn("[phodex-bridge] Relay socket error.", event.type);
    scheduleRelayReconnect();
  });

  socket.addEventListener("close", (event) => {
    if (relaySocket === socket) {
      relaySocket = null;
    }
    console.warn(
      `[phodex-bridge] Relay connection closed code=${event.code} reason=${event.reason || "none"} wasClean=${event.wasClean}`
    );
    scheduleRelayReconnect();
  });
}

function handleRelayMessage(raw: string) {
  let command: BridgeCommand | null = null;
  try {
    command = JSON.parse(raw) as BridgeCommand;
  } catch {
    return;
  }

  if (!command) {
    return;
  }

  switch (command.type) {
    case "bridge:sync-all":
      void syncAllThreadsFromCodex().catch((error) => {
        console.error(`[phodex-bridge] sync-all failed: ${readErrorMessage(error)}`);
      });
      break;
    case "bridge:sync-thread":
      void syncThreadFromCodex(command.threadId, true).catch((error) => {
        if (handleMissingThread(undefined, command.threadId, error)) {
          return;
        }
        console.error(`[phodex-bridge] sync-thread failed: ${readErrorMessage(error)}`);
      });
      break;
    case "bridge:sync-thread-history":
      void syncOlderThreadHistoryFromCodex(command.threadId).catch((error) => {
        if (handleMissingThread(undefined, command.threadId, error)) {
          return;
        }
        console.error(`[phodex-bridge] sync-thread-history failed: ${readErrorMessage(error)}`);
      });
      break;
    case "bridge:project:request":
      void handleProjectRequest(command);
      break;
    case "bridge:dispatch":
      void handleBridgeDispatch(command);
      break;
  }
}

async function handleProjectRequest(command: Extract<BridgeCommand, { type: "bridge:project:request" }>) {
  try {
    const result = await readProjectResource(command.request);
    sendBridgeEvent({
      type: "bridge:project:response",
      requestId: command.requestId,
      userId: command.userId,
      ok: true,
      result,
    });
  } catch (error) {
    const status = error instanceof ProjectResourceError ? error.status : 500;
    sendBridgeEvent({
      type: "bridge:project:response",
      requestId: command.requestId,
      userId: command.userId,
      ok: false,
      error: readErrorMessage(error),
      status,
    });
  }
}

async function handleBridgeDispatch(command: Extract<BridgeCommand, { type: "bridge:dispatch" }>) {
  const user = ensureBridgeUser(command.userId, command.selectedThreadId);
  try {
    switch (command.event.type) {
      case "thread:create":
        await handleThreadCreate(user, command.event);
        return;
      case "thread:select":
        if (shouldHydrateThreadOnSelect(command.event.threadId)) {
          try {
            await syncThreadFromCodex(command.event.threadId, true);
          } catch (error) {
            if (handleMissingThread(user.profile.id, command.event.threadId, error)) {
              sendToast(user.profile.id, "error", "This thread is no longer available.");
              return;
            }
            throw error;
          }
        }
        user.selectedThreadId = command.event.threadId;
        sendUserPatch(user.profile.id, {
          selectedThreadId: command.event.threadId,
          banner: null,
        });
        return;
      case "thread:rename":
        await handleThreadRename(user, command.event.threadId, command.event.title);
        return;
      case "thread:archive":
        await handleThreadArchive(user, command.event.threadId);
        return;
      case "message:send": {
        const result = await handleMessageSend(user, command.event);
        sendBridgeMessageSendResult(command, command.event, result);
        return;
      }
      case "draft:resume":
        await handleDraftResume(user, command.event.threadId, command.event.draftId);
        return;
      case "draft:remove":
        handleDraftRemove(user.profile.id, command.event.threadId, command.event.draftId);
        return;
      case "run:stop":
        await handleRunStop(user.profile.id, command.event.threadId);
        return;
    }
  } catch (error) {
    const message = readErrorMessage(error);
    sendToast(user.profile.id, "error", message);
    if (command.event.type === "message:send") {
      sendBridgeMessageSendResult(command, command.event, { ok: false, message });
    }
  }
}

function ensureBridgeUser(userId: string, selectedThreadId: string | null) {
  let user = bridgeUsers.get(userId);
  if (!user) {
    user = {
      profile: {
        id: userId,
        email: "",
        displayName: "Operator",
      },
      settings: {
        fontStyle: "system",
        glassMode: true,
        notifications: true,
        reducedMotion: false,
        compactSidebar: false,
      },
      selectedThreadId,
      banner: null,
    };
    bridgeUsers.set(userId, user);
  } else {
    user.selectedThreadId = selectedThreadId;
  }
  return user;
}

function sendUserPatch(
  userId: string,
  patch: {
    selectedThreadId?: string | null;
    banner?: CompletionBanner | null;
  }
) {
  const user = bridgeUsers.get(userId) ?? ensureBridgeUser(userId, patch.selectedThreadId ?? null);
  if (Object.prototype.hasOwnProperty.call(patch, "selectedThreadId")) {
    user.selectedThreadId = patch.selectedThreadId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "banner")) {
    user.banner = patch.banner ?? null;
  }
  sendBridgeEvent({
    type: "bridge:user-patch",
    userId,
    ...patch,
  });
}

function sendBridgeState() {
  const selectedThreadIds = bridgeSelectedThreadIds();
  sendBridgeEvent({
    type: "bridge:state",
    threads: listBridgeThreads().map((thread) => serializeThreadForSelections(thread, selectedThreadIds)),
    connection: buildConnection(),
  });
}

function listBridgeThreads() {
  return sortThreadsByCreatedAtDesc([...threadCache.values()]);
}

function sortThreadsByCreatedAtDesc<T extends Pick<ThreadRecord, "createdAt" | "lastActivityAt">>(threads: T[]) {
  return threads.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || left.lastActivityAt);
    const rightTime = Date.parse(right.createdAt || right.lastActivityAt);
    return rightTime - leftTime;
  });
}

function serializeThreadForUser(thread: ThreadRecord, selectedThreadId: string | null) {
  if (thread.id === selectedThreadId) {
    return thread;
  }

  return {
    ...thread,
    messages: [],
  } satisfies ThreadRecord;
}

function serializeThreadForSelections(thread: ThreadRecord, selectedThreadIds: Set<string>) {
  if (selectedThreadIds.has(thread.id)) {
    return thread;
  }

  return {
    ...thread,
    messages: [],
  } satisfies ThreadRecord;
}

function bridgeSelectedThreadIds() {
  return new Set(
    [...bridgeUsers.values()]
      .map((user) => user.selectedThreadId)
      .filter((threadId): threadId is string => Boolean(threadId))
  );
}

function sendBridgeEvent(event: BridgeEvent) {
  if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN) {
    return;
  }
  relaySocket.send(JSON.stringify(event));
}

function sendThreadCreateAccepted(user: PersistedUser, event: ThreadCreateRequest, ws?: ServerWebSocket<SocketData>) {
  if (ws) {
    sendEvent(ws, {
      type: "thread:create-accepted",
      requestId: event.requestId,
    });
    return;
  }
  sendBridgeEvent({
    type: "bridge:thread:create-accepted",
    userId: user.profile.id,
    requestId: event.requestId,
  });
}

function sendBridgeMessageSendResult(
  command: Extract<BridgeCommand, { type: "bridge:dispatch" }>,
  event: Extract<ClientEvent, { type: "message:send" }>,
  result: MessageSendResult
) {
  const base = {
    userId: command.userId,
    requestId: command.requestId,
    clientRequestId: event.requestId,
    threadId: event.threadId,
  };
  if (result.ok) {
    sendBridgeEvent({
      type: "bridge:message:send-result",
      ...base,
      ok: true,
      outcome: result.outcome,
    });
    return;
  }
  sendBridgeEvent({
    type: "bridge:message:send-result",
    ...base,
    ok: false,
    message: result.message,
  });
}

function scheduleRelayReconnect() {
  if (relayReconnectTimer) {
    return;
  }

  relayReconnectTimer = setTimeout(() => {
    relayReconnectTimer = null;
    connectRelaySocket();
  }, BRIDGE_RECONNECT_MS);
}

function clearRelayReconnectTimer() {
  if (!relayReconnectTimer) {
    return;
  }
  clearTimeout(relayReconnectTimer);
  relayReconnectTimer = null;
}

function handleClientEvent(ws: ServerWebSocket<SocketData>, event: ClientEvent) {
  const user = persisted.users[ws.data.userId];
  if (!user) {
    sendEvent(ws, { type: "toast", tone: "error", message: "Session user not found." });
    return;
  }

  switch (event.type) {
    case "bootstrap":
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      void syncAllThreadsFromCodex().then(() => {
        const selectedThreadId = persisted.users[user.profile.id]?.selectedThreadId;
        if (selectedThreadId) {
          return syncThreadFromCodex(selectedThreadId, true).catch((error) => {
            if (handleMissingThread(user.profile.id, selectedThreadId, error)) {
              return null;
            }
            throw error;
          });
        }
      }).catch((error) => {
        sendToast(user.profile.id, "error", readErrorMessage(error));
      });
      break;
    case "thread:create":
      void handleThreadCreate(user, event, ws);
      break;
    case "thread:select":
      user.selectedThreadId = event.threadId;
      schedulePersist();
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      if (shouldHydrateThreadOnSelect(event.threadId)) {
        void syncThreadFromCodex(event.threadId, true).catch((error) => {
          if (handleMissingThread(user.profile.id, event.threadId, error)) {
            return;
          }
          sendToast(user.profile.id, "error", readErrorMessage(error));
        });
      }
      break;
    case "thread:clearSelection":
      user.selectedThreadId = null;
      schedulePersist();
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      break;
    case "thread:rename":
      void handleThreadRename(user, event.threadId, event.title);
      break;
    case "thread:delete":
      sendToast(user.profile.id, "error", "Codex app-server does not expose thread deletion. Archive the thread instead.");
      break;
    case "thread:archive":
      void handleThreadArchive(user, event.threadId);
      break;
    case "message:send":
      if (threadCache.get(event.threadId)?.state === "running") {
        sendClientMessageSendResult(ws, event, { ok: true, outcome: "steered" });
      }
      void handleMessageSend(user, event).then((result) => {
        sendClientMessageSendResult(ws, event, result);
      });
      break;
    case "draft:resume":
      void handleDraftResume(user, event.threadId, event.draftId);
      break;
    case "draft:remove":
      handleDraftRemove(user.profile.id, event.threadId, event.draftId);
      break;
    case "run:stop":
      void handleRunStop(user.profile.id, event.threadId);
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

async function handleThreadCreate(user: PersistedUser, event: ThreadCreateRequest, ws?: ServerWebSocket<SocketData>) {
  try {
    ensureCodexReady();
    const requestedCwd = resolveRequestedThreadCwd(user, event);
    const projectContext = resolveProjectContext(requestedCwd);
    if (event.mode === "worktree" && !projectContext.isRepo) {
      throw new Error("New worktrees only work from a git project.");
    }

    const threadCwd =
      event.mode === "worktree"
        ? createWorktreeForProject(projectContext.projectRoot, event.projectLabel ?? basename(projectContext.projectRoot)).worktreeCwd
        : ensureLocalThreadCwd(requestedCwd);

    sendThreadCreateAccepted(user, event, ws);
    logFlowTrace("codex.thread-start.accepted", {
      requestId: event.requestId,
      userId: user.profile.id,
      mode: event.mode ?? "local",
      cwd: threadCwd,
    });

    const result = await codexRequestWithRetry("thread/start", {
      cwd: threadCwd,
      model: "gpt-5.4",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      personality: "pragmatic",
    }, {
      timeoutMs: CODEX_THREAD_START_TIMEOUT_MS,
      retries: CODEX_THREAD_START_RETRIES,
    });
    const thread = mergeCodexThread(result.thread, false, false);
    thread.history = buildLoadedThreadHistoryState(thread.messages.length, false);
    threadCache.set(thread.id, thread);
    user.selectedThreadId = thread.id;
    if (ws) {
      sendEvent(ws, {
        type: "thread:created",
        requestId: event.requestId,
        threadId: thread.id,
      });
    } else {
      sendBridgeEvent({
        type: "bridge:thread:created",
        userId: user.profile.id,
        requestId: event.requestId,
        threadId: thread.id,
        thread,
      });
    }
    sendUserPatch(user.profile.id, {
      selectedThreadId: thread.id,
      banner: null,
    });
    schedulePersist();
    broadcastThreadToAllUsers(thread.id);
    broadcastSnapshotsToAllUsers();
    codexLastSyncAt = new Date().toISOString();
    publishPresenceToAllUsers();
  } catch (error) {
    const message = readErrorMessage(error);
    if (ws) {
      sendEvent(ws, {
        type: "thread:create-failed",
        requestId: event.requestId,
        message,
      });
    } else {
      sendBridgeEvent({
        type: "bridge:thread:create-failed",
        userId: user.profile.id,
        requestId: event.requestId,
        message,
      });
    }
    sendToast(user.profile.id, "error", message);
  }
}

async function handleThreadRename(user: PersistedUser, threadId: string, title: string) {
  if (!title.trim()) {
    sendToast(user.profile.id, "error", "Thread name cannot be empty.");
    return;
  }

  const nextTitle = title.trim();
  const local = ensureThreadLocal(threadId);
  local.customTitle = nextTitle;
  const thread = ensureThreadRecord(threadId);
  thread.title = nextTitle;
  schedulePersist();
  broadcastThreadToAllUsers(threadId);

  try {
    ensureCodexReady();
    await codexRequest("thread/name/set", {
      threadId,
      name: nextTitle,
    });
  } catch {
    // Keep the mobile title override even if Codex does not persist names.
  }

  try {
    await syncAllThreadsFromCodex();
  } catch {
    broadcastSnapshotsToAllUsers();
  }
}

async function handleThreadArchive(user: PersistedUser, threadId: string) {
  try {
    ensureCodexReady();
    const thread = threadCache.get(threadId);
    const isArchived = thread?.state === "archived";
    await codexRequest(isArchived ? "thread/unarchive" : "thread/archive", { threadId });
    if (!isArchived && user.selectedThreadId === threadId) {
      user.selectedThreadId = findFirstLiveThreadId(threadId);
      sendUserPatch(user.profile.id, {
        selectedThreadId: user.selectedThreadId,
      });
    }
    schedulePersist();
    await syncAllThreadsFromCodex();
  } catch (error) {
    if (handleMissingThread(user.profile.id, threadId, error)) {
      sendToast(user.profile.id, "error", "This thread is no longer available.");
      return;
    }
    sendToast(user.profile.id, "error", readErrorMessage(error));
  }
}

function buildQueuedDraft(
  text: string,
  images: InputImageAttachment[],
  event: Extract<ClientEvent, { type: "message:send" }>
): QueuedDraft {
  return {
    id: randomUUID(),
    text,
    images,
    createdAt: new Date().toISOString(),
    model: event.model,
    planArmed: event.planArmed,
    fastMode: event.fastMode,
    accessMode: event.accessMode,
  };
}

function buildQueuedDraftEvent(threadId: string, draft: QueuedDraft): Extract<ClientEvent, { type: "message:send" }> {
  return {
    type: "message:send",
    requestId: randomUUID(),
    threadId,
    text: draft.text,
    images: draft.images,
    model: draft.model ?? "GPT-5.4",
    planArmed: draft.planArmed ?? false,
    fastMode: draft.fastMode ?? false,
    accessMode: draft.accessMode ?? "full-access",
  };
}

function queueDraft(
  thread: ThreadRecord,
  text: string,
  images: InputImageAttachment[],
  event: Extract<ClientEvent, { type: "message:send" }>,
  preview: string
) {
  const local = ensureThreadLocal(thread.id);
  local.queuedDrafts.push(buildQueuedDraft(text, images, event));
  thread.queuedDrafts = local.queuedDrafts;
  thread.state = "running";
  thread.preview = preview;
  thread.lastActivityAt = new Date().toISOString();
  logFlowTrace("message-send.queued", {
    threadId: thread.id,
    promptTrace: buildPromptTraceKey(text, images),
    promptSummary: summarizePromptForTrace(text, images),
    queuedDrafts: local.queuedDrafts.length,
  });
  schedulePersist();
  broadcastThreadToAllUsers(thread.id);
}

function restoreQueuedDraft(threadId: string, draft: QueuedDraft, draftIndex: number) {
  const local = ensureThreadLocal(threadId);
  local.queuedDrafts.splice(draftIndex, 0, draft);
  const thread = threadCache.get(threadId);
  if (thread) {
    thread.queuedDrafts = local.queuedDrafts;
    thread.state = deriveThreadState(readThreadStatusType(thread.state), threadId, thread.state === "archived");
    broadcastThreadToAllUsers(threadId);
  }
  schedulePersist();
}

async function startThreadRun(
  user: PersistedUser,
  thread: ThreadRecord,
  event: Extract<ClientEvent, { type: "message:send" }>,
  text: string,
  preview: string
) {
  const images = normalizeInputImages(event.images);
  const promptTrace = buildPromptTraceKey(text, images);
  const promptSummary = summarizePromptForTrace(text, images);
  if (user.selectedThreadId === thread.id) {
    sendUserPatch(user.profile.id, {
      banner: null,
    });
  }
  markThreadRunning(thread.id, preview);
  const turnMode = deriveRequestedTurnMode(text, event.planArmed);
  pendingTurnModes.set(thread.id, turnMode);
  pendingTurnTraces.set(thread.id, {
    userId: user.profile.id,
    promptTrace,
    promptSummary,
    mode: turnMode,
  });
  schedulePersist();
  broadcastThreadToAllUsers(thread.id);
  broadcastSnapshotsToAllUsers();
  logFlowTrace("turn.start.requested", {
    threadId: thread.id,
    userId: user.profile.id,
    promptTrace,
    promptSummary,
    mode: turnMode,
    model: event.model,
    planArmed: event.planArmed,
    fastMode: event.fastMode,
    accessMode: event.accessMode,
    queuedDrafts: ensureThreadLocal(thread.id).queuedDrafts.length,
  });

  try {
    const turnResponse = await startTurn(thread, text, event, user.profile.id);
    const turnId = readString(turnResponse?.turn?.id);
    const pendingTrace = pendingTurnTraces.get(thread.id);
    if (turnId) {
      activeTurns.set(thread.id, {
        userId: user.profile.id,
        threadId: thread.id,
        turnId,
        assistantMessageId: null,
        itemSequence: 0,
        startedAt: new Date().toISOString(),
        mode: turnMode,
        promptTrace: pendingTrace?.promptTrace ?? promptTrace,
        promptSummary: pendingTrace?.promptSummary ?? promptSummary,
      });
    }
    pendingTurnModes.delete(thread.id);
    pendingTurnTraces.delete(thread.id);
    codexLastSyncAt = new Date().toISOString();
    publishPresenceToAllUsers();
    return { ok: true as const };
  } catch (error) {
    pendingTurnModes.delete(thread.id);
    pendingTurnTraces.delete(thread.id);
    let message = readErrorMessage(error);
    if (handleMissingThread(user.profile.id, thread.id, error)) {
      message = "This thread is no longer available.";
    } else {
      thread.state = deriveThreadState("idle", thread.id, thread.state === "archived");
      broadcastThreadToAllUsers(thread.id);
    }
    sendToast(user.profile.id, "error", message);
    return { ok: false as const, message };
  }
}

async function steerThreadRun(
  user: PersistedUser,
  thread: ThreadRecord,
  event: Extract<ClientEvent, { type: "message:send" }>,
  text: string,
  preview: string
): Promise<MessageSendResult | null> {
  if (!codexSupportsTurnSteer) {
    return null;
  }

  const activeTurn = activeTurns.get(thread.id);
  if (!activeTurn?.turnId) {
    return null;
  }

  const images = normalizeInputImages(event.images);
  const input = buildTurnInput(text, images);
  const promptTrace = buildPromptTraceKey(text, images);
  const promptSummary = summarizePromptForTrace(text, images);
  if (user.selectedThreadId === thread.id) {
    sendUserPatch(user.profile.id, {
      banner: null,
    });
  }

  try {
    logFlowTrace("codex.turn-steer.request", {
      threadId: thread.id,
      turnId: activeTurn.turnId,
      userId: user.profile.id,
      promptTrace,
      promptSummary,
    });
    const result = await codexRequest("turn/steer", {
      threadId: thread.id,
      input,
      expectedTurnId: activeTurn.turnId,
    });
    thread.state = "running";
    thread.preview = preview;
    thread.lastActivityAt = new Date().toISOString();
    schedulePersist();
    broadcastThreadToAllUsers(thread.id);
    codexLastSyncAt = new Date().toISOString();
    publishPresenceToAllUsers();
    logFlowTrace("codex.turn-steer.response", {
      threadId: thread.id,
      turnId: readString(result?.turnId) || activeTurn.turnId,
      promptTrace,
      promptSummary,
    });
    return { ok: true, outcome: "steered" };
  } catch (error) {
    if (isTurnSteerUnsupportedError(error)) {
      codexSupportsTurnSteer = false;
    }
    if (shouldQueueAfterTurnSteerFailure(error)) {
      logFlowTrace("codex.turn-steer.fallback-queue", {
        threadId: thread.id,
        turnId: activeTurn.turnId,
        promptTrace,
        promptSummary,
        message: readErrorMessage(error),
      });
      return null;
    }
    const message = readErrorMessage(error);
    sendToast(user.profile.id, "error", message);
    return { ok: false, message };
  }
}

async function handleMessageSend(
  user: PersistedUser,
  event: Extract<ClientEvent, { type: "message:send" }>
): Promise<MessageSendResult> {
  const text = event.text.trim();
  const images = normalizeInputImages(event.images);
  if (!text && !images.length) {
    const message = "Compose something first.";
    sendToast(user.profile.id, "error", message);
    return { ok: false, message };
  }
  const preview = summarizeMessagePreview(text, images);
  logFlowTrace("message-send.received", {
    userId: user.profile.id,
    threadId: event.threadId,
    promptTrace: buildPromptTraceKey(text, images),
    promptSummary: summarizePromptForTrace(text, images),
    threadState: threadCache.get(event.threadId)?.state ?? null,
  });

  try {
    ensureCodexReady();
    let thread = threadCache.get(event.threadId);
    if (!thread) {
      try {
        thread = await syncThreadFromCodex(event.threadId, false);
      } catch (error) {
        if (handleMissingThread(user.profile.id, event.threadId, error)) {
          const message = "This thread is no longer available.";
          sendToast(user.profile.id, "error", message);
          return { ok: false, message };
        }
        throw error;
      }
    }
    if (!thread) {
      forgetThread(event.threadId, user.profile.id);
      const message = "Thread not found.";
      sendToast(user.profile.id, "error", message);
      return { ok: false, message };
    }

    if (thread.state === "running") {
      const steered = await steerThreadRun(user, thread, event, text, preview);
      if (steered) {
        return steered;
      }
      queueDraft(thread, text, images, event, preview);
      sendToast(user.profile.id, "info", "Draft queued while the current run finishes.");
      return { ok: true, outcome: "queued" };
    }

    const started = await startThreadRun(user, thread, event, text, preview);
    return started.ok ? { ok: true, outcome: "started" } : started;
  } catch (error) {
    const thread = threadCache.get(event.threadId);
    let message = readErrorMessage(error);
    if (handleMissingThread(user.profile.id, event.threadId, error)) {
      message = "This thread is no longer available.";
    } else if (thread) {
      thread.state = deriveThreadState("idle", thread.id, thread.state === "archived");
      broadcastThreadToAllUsers(thread.id);
    }
    sendToast(user.profile.id, "error", message);
    return { ok: false, message };
  }
}

async function handleDraftResume(user: PersistedUser, threadId: string, draftId: string) {
  try {
    ensureCodexReady();
    let thread = threadCache.get(threadId);
    if (!thread) {
      try {
        thread = await syncThreadFromCodex(threadId, false);
      } catch (error) {
        if (handleMissingThread(user.profile.id, threadId, error)) {
          sendToast(user.profile.id, "error", "This thread is no longer available.");
          return false;
        }
        throw error;
      }
    }
    if (!thread) {
      forgetThread(threadId, user.profile.id);
      sendToast(user.profile.id, "error", "Thread not found.");
      return false;
    }
    if (thread.state === "running") {
      sendToast(user.profile.id, "info", "This draft will be ready after the current run finishes.");
      return false;
    }

    const local = ensureThreadLocal(threadId);
    const draftIndex = local.queuedDrafts.findIndex((draft) => draft.id === draftId);
    if (draftIndex === -1) {
      return false;
    }

    const [draft] = local.queuedDrafts.splice(draftIndex, 1);
    thread.queuedDrafts = local.queuedDrafts;
    schedulePersist();
    logFlowTrace("queued-draft.resume", {
      userId: user.profile.id,
      threadId,
      draftId,
      promptTrace: buildPromptTraceKey(draft.text, draft.images ?? []),
      promptSummary: summarizePromptForTrace(draft.text, draft.images ?? []),
      remainingDrafts: local.queuedDrafts.length,
    });

    const nextEvent = buildQueuedDraftEvent(threadId, draft);
    const nextText = nextEvent.text.trim();
    const nextPreview = summarizeMessagePreview(nextText, normalizeInputImages(nextEvent.images));
    const started = await startThreadRun(user, thread, nextEvent, nextText, nextPreview);
    if (!started.ok) {
      restoreQueuedDraft(threadId, draft, draftIndex);
    }
    return started.ok;
  } catch (error) {
    sendToast(user.profile.id, "error", readErrorMessage(error));
    return false;
  }
}

async function resumeNextQueuedDraft(userId: string | undefined, threadId: string) {
  try {
    await syncThreadFromCodex(threadId, true);
  } catch (error) {
    if (handleMissingThread(userId, threadId, error)) {
      if (userId) {
        sendToast(userId, "error", "This thread is no longer available.");
      }
      return;
    }
    console.error(`[phodex] Failed to sync thread ${threadId} before resuming queued draft: ${readErrorMessage(error)}`);
    return;
  }

  if (!userId) {
    return;
  }

  const user = bridgeUsers.get(userId) ?? persisted.users[userId];
  const thread = threadCache.get(threadId);
  if (!user || !thread || thread.state === "running") {
    return;
  }

  const local = ensureThreadLocal(threadId);
  const nextDraft = local.queuedDrafts[0];
  if (!nextDraft) {
    return;
  }

  logFlowTrace("queued-draft.auto-resume", {
    userId,
    threadId,
    draftId: nextDraft.id,
    promptTrace: buildPromptTraceKey(nextDraft.text, nextDraft.images ?? []),
    promptSummary: summarizePromptForTrace(nextDraft.text, nextDraft.images ?? []),
    queuedDrafts: local.queuedDrafts.length,
  });

  await handleDraftResume(user, threadId, nextDraft.id);
}

async function startTurn(
  thread: ThreadRecord,
  text: string,
  event: Extract<ClientEvent, { type: "message:send" }>,
  userId: string
) {
  const promptImages = normalizeInputImages(event.images);
  const input = buildTurnInput(text, promptImages);
  const promptTrace = buildPromptTraceKey(text, promptImages);
  const promptSummary = summarizePromptForTrace(text, promptImages);
  const baseParams = {
    threadId: thread.id,
    input,
    model: normalizeModel(event.model),
    approvalPolicy: mapApprovalPolicy(event.accessMode),
    sandboxPolicy: mapSandboxPolicy(event.accessMode, writableRootForThread(thread)),
  };

  logFlowTrace("codex.turn-start.request", {
    threadId: thread.id,
    promptTrace,
    promptSummary,
    model: baseParams.model,
    approvalPolicy: baseParams.approvalPolicy,
    sandboxMode: baseParams.sandboxPolicy.mode,
  });

  try {
    const result = await requestTurnStartWithFastModeFallback(baseParams, event, userId);
    logFlowTrace("codex.turn-start.response", {
      threadId: thread.id,
      promptTrace,
      promptSummary,
      turnId: readString(result?.turn?.id) || null,
    });
    return result;
  } catch (error) {
    if (!isThreadNotLoadedError(error)) {
      throw error;
    }
    logFlowTrace("codex.thread-resume-before-turn.request", {
      threadId: thread.id,
      promptTrace,
      promptSummary,
    });
    await resumeThreadForTurn(thread, event);
    const result = await requestTurnStartWithFastModeFallback(baseParams, event, userId);
    logFlowTrace("codex.turn-start.response", {
      threadId: thread.id,
      promptTrace,
      promptSummary,
      turnId: readString(result?.turn?.id) || null,
      resumed: true,
    });
    return result;
  }
}

async function requestTurnStartWithFastModeFallback(
  baseParams: {
    threadId: string;
    input: ReturnType<typeof buildTurnInput>;
    model: string;
    approvalPolicy: ReturnType<typeof mapApprovalPolicy>;
    sandboxPolicy: ReturnType<typeof mapSandboxPolicy>;
  },
  event: Extract<ClientEvent, { type: "message:send" }>,
  userId: string
) {
  try {
    return await codexRequest("turn/start", {
      ...baseParams,
      ...(event.fastMode && codexSupportsServiceTier ? { serviceTier: "fast" as const } : {}),
    });
  } catch (error) {
    if (event.fastMode && codexSupportsServiceTier && shouldRetryTurnStartWithoutServiceTier(error)) {
      codexSupportsServiceTier = false;
      if (!serviceTierUnsupportedToastSent) {
        serviceTierUnsupportedToastSent = true;
        sendToast(userId, "info", "Fast mode is unavailable on this bridge yet. This run was sent normally.");
      }
      return await codexRequest("turn/start", baseParams);
    }
    throw error;
  }
}

async function resumeThreadForTurn(thread: ThreadRecord, event: Extract<ClientEvent, { type: "message:send" }>) {
  const result = await codexRequest("thread/resume", {
    threadId: thread.id,
    cwd: writableRootForThread(thread),
    model: normalizeModel(event.model),
    approvalPolicy: mapApprovalPolicy(event.accessMode),
    sandbox: mapSandboxMode(event.accessMode),
    personality: "pragmatic",
  });
  if (result?.thread) {
    const resumedThread = mergeCodexThread(
      result.thread,
      thread.state === "archived",
      Array.isArray(result.thread.turns)
    );
    threadCache.set(resumedThread.id, resumedThread);
    codexLastSyncAt = new Date().toISOString();
    broadcastThreadToAllUsers(resumedThread.id, true);
    publishPresenceToAllUsers();
  }
}

function handleDraftRemove(userId: string, threadId: string, draftId: string) {
  const local = ensureThreadLocal(threadId);
  local.queuedDrafts = local.queuedDrafts.filter((draft) => draft.id !== draftId);
  const thread = threadCache.get(threadId);
  if (thread) {
    thread.queuedDrafts = local.queuedDrafts;
    thread.state = deriveThreadState(readThreadStatusType(thread.state), threadId, thread.state === "archived");
    broadcastThreadToAllUsers(threadId);
  }
  schedulePersist();
  publishPresenceToAllUsers();
  sendToast(userId, "info", "Queued draft removed.");
}

async function handleRunStop(userId: string, threadId: string) {
  const activeTurn = activeTurns.get(threadId);
  if (!activeTurn) {
    sendToast(userId, "info", "There is no active run to stop.");
    return;
  }

  try {
    ensureCodexReady();
    const thread = threadCache.get(threadId);
    if (thread?.state === "running") {
      thread.state = deriveThreadState("idle", threadId, false);
      for (const message of thread.messages) {
        if (message.isStreaming) {
          message.isStreaming = false;
        }
      }
      broadcastThreadToAllUsers(threadId);
    }
    sendToast(userId, "info", "Interrupt requested.");
    await codexRequest("turn/interrupt", {
      threadId,
      turnId: activeTurn.turnId,
    });
  } catch (error) {
    sendToast(userId, "error", readErrorMessage(error));
  }
}

async function ensureCodexBridge() {
  clearCodexReconnectTimer();
  setCodexConnectionState("connecting");

  if (await probeCodexReady()) {
    console.log(`[phodex] Reusing existing Codex app-server at ${CODEX_WS_URL}.`);
    connectCodexSocket();
    return;
  }

  if (!MANAGE_CODEX) {
    setCodexConnectionState("disconnected");
    console.error("[phodex] Codex app-server is unavailable and automatic management is disabled.");
    publishPresenceToAllUsers();
    return;
  }

  if (!CODEX_BIN) {
    setCodexConnectionState("disconnected");
    console.error("[phodex] Could not resolve a valid Codex CLI binary. Set PHODEX_CODEX_BIN.");
    publishPresenceToAllUsers();
    return;
  }

  startManagedCodexProcess();
  const ready = await waitForCodexReady(12_000);
  if (!ready) {
    setCodexConnectionState("disconnected");
    console.error("[phodex] Timed out waiting for Codex app-server to become ready.");
    publishPresenceToAllUsers();
    return;
  }

  connectCodexSocket();
}

function connectCodexSocket() {
  if (codexSocket && (codexSocket.readyState === WebSocket.OPEN || codexSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setCodexConnectionState("connecting");
  const socket = new WebSocket(CODEX_WS_URL);
  codexSocket = socket;

  socket.addEventListener("open", () => {
    codexSupportsServiceTier = true;
    codexSupportsTurnSteer = true;
    serviceTierUnsupportedToastSent = false;
    void codexRequest(
      "initialize",
      {
        clientInfo: {
          name: "phodex-web",
          version: "0.1.0",
        },
      },
      { allowBeforeReady: true }
    ).then(() => {
      sendCodexNotification("initialized");
      setCodexConnectionState("connected");
      codexLastSyncAt = new Date().toISOString();
      console.log("[phodex] Connected to local Codex app-server.");
      void refreshCodexRateLimits();
      return syncAllThreadsFromCodex();
    }).catch((error) => {
      console.error(`[phodex] Failed to initialize Codex app-server: ${readErrorMessage(error)}`);
      socket.close();
    });
  });

  socket.addEventListener("message", (event) => {
    handleCodexRpcMessage(typeof event.data === "string" ? event.data : event.data.toString());
  });

  socket.addEventListener("error", () => {
    setCodexConnectionState("disconnected");
    publishPresenceToAllUsers();
  });

  socket.addEventListener("close", () => {
    if (codexSocket === socket) {
      codexSocket = null;
    }
    setCodexConnectionState("disconnected");
    publishPresenceToAllUsers();
    scheduleCodexReconnect();
  });
}

function handleCodexRpcMessage(raw: string) {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (parsed?.id != null) {
    const requestId = String(parsed.id);
    const waiter = codexRequestWaiters.get(requestId);
    if (!waiter) {
      return;
    }

    codexRequestWaiters.delete(requestId);
    clearTimeout(waiter.timer);
    if (parsed.error) {
      const error = new Error(parsed.error.message || `Codex request failed: ${waiter.method}`);
      (error as Error & { code?: unknown; data?: unknown }).code = parsed.error.code;
      (error as Error & { code?: unknown; data?: unknown }).data = parsed.error.data;
      waiter.reject(error);
      return;
    }

    waiter.resolve(parsed.result ?? null);
    return;
  }

  if (typeof parsed?.method !== "string") {
    return;
  }

  handleCodexNotification(parsed.method, parsed.params ?? {});
}

function handleCodexNotification(method: string, params: any) {
  switch (method) {
    case "thread/started": {
      const rawThread = params?.thread;
      if (!rawThread) {
        return;
      }
      const thread = mergeCodexThread(rawThread, false, false);
      threadCache.set(thread.id, thread);
      broadcastThreadToAllUsers(thread.id);
      break;
    }
    case "thread/status/changed":
      applyThreadStatusUpdate(readString(params?.threadId), readString(params?.status?.type));
      break;
    case "thread/name/updated":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/closed":
      void syncAllThreadsFromCodex();
      break;
    case "turn/started":
      handleTurnStarted(params);
      break;
    case "item/started":
      handleItemStarted(params);
      break;
    case "item/agentMessage/delta":
      handleAgentMessageDelta(params);
      break;
    case "item/completed":
      handleItemCompleted(params);
      break;
    case "turn/diff/updated":
      handleTurnDiffUpdated(params);
      break;
    case "turn/completed":
      handleTurnCompleted(params);
      break;
    case "account/rateLimits/updated":
      codexRateLimits = normalizeCodexRateLimitSnapshot(params?.rateLimits);
      break;
    case "error":
      console.error(`[phodex] Codex notification error: ${readString(params?.message) || "unknown error"}`);
      break;
  }

  codexLastSyncAt = new Date().toISOString();
  publishPresenceToAllUsers();
}

async function refreshCodexRateLimits() {
  if (!isCodexReady()) {
    return;
  }

  try {
    const response = await codexRequest("account/rateLimits/read", undefined);
    codexRateLimits = selectCodexRateLimitSnapshot(response);
    publishPresenceToAllUsers();
  } catch (error) {
    console.warn(`[phodex] Codex rate limits unavailable: ${readErrorMessage(error)}`);
  }
}

function selectCodexRateLimitSnapshot(response: any): CodexRateLimitSnapshot | null {
  const byLimitId = response?.rateLimitsByLimitId;
  if (byLimitId && typeof byLimitId === "object") {
    const codexSnapshot = normalizeCodexRateLimitSnapshot(byLimitId.codex);
    if (codexSnapshot) {
      return codexSnapshot;
    }

    for (const value of Object.values(byLimitId)) {
      const snapshot = normalizeCodexRateLimitSnapshot(value);
      if (snapshot) {
        return snapshot;
      }
    }
  }

  return normalizeCodexRateLimitSnapshot(response?.rateLimits);
}

function normalizeCodexRateLimitSnapshot(value: any): CodexRateLimitSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const primary = normalizeCodexRateLimitWindow(value.primary);
  const secondary = normalizeCodexRateLimitWindow(value.secondary);
  const credits = value.credits && typeof value.credits === "object"
    ? {
        hasCredits: value.credits.hasCredits === true,
        unlimited: value.credits.unlimited === true,
        balance: readString(value.credits.balance) || null,
      }
    : null;

  if (!primary && !secondary && !credits) {
    return null;
  }

  return {
    limitId: readString(value.limitId) || null,
    limitName: readString(value.limitName) || null,
    primary,
    secondary,
    credits,
    planType: readString(value.planType) || null,
  };
}

function normalizeCodexRateLimitWindow(value: any): CodexRateLimitSnapshot["primary"] {
  if (!value || typeof value !== "object") {
    return null;
  }

  const usedPercent = readNumber(value.usedPercent);
  if (usedPercent == null) {
    return null;
  }

  return {
    usedPercent,
    windowDurationMins: readNumber(value.windowDurationMins),
    resetsAt: readNumber(value.resetsAt),
  };
}

function handleTurnStarted(params: any) {
  const threadId = readString(params?.threadId);
  const turnId = readString(params?.turn?.id);
  if (!threadId || !turnId) {
    return;
  }

  const thread = ensureThreadRecord(threadId);
  thread.state = "running";
  thread.lastActivityAt = toIsoFromEpoch(params?.turn?.startedAt) ?? new Date().toISOString();
  const currentTurn = activeTurns.get(threadId);
  const pendingTrace = pendingTurnTraces.get(threadId);
  activeTurns.set(threadId, {
    userId: currentTurn?.userId ?? pendingTrace?.userId ?? "",
    threadId,
    turnId,
    assistantMessageId: null,
    itemSequence: currentTurn?.itemSequence ?? 0,
    startedAt: thread.lastActivityAt,
    mode: currentTurn?.mode ?? pendingTrace?.mode ?? pendingTurnModes.get(threadId) ?? "chat",
    promptTrace: currentTurn?.promptTrace ?? pendingTrace?.promptTrace ?? "",
    promptSummary: currentTurn?.promptSummary ?? pendingTrace?.promptSummary ?? "",
  });
  scheduleActiveTurnStaleCheck(threadId);
  logFlowTrace("codex.turn-started", {
    threadId,
    turnId,
    promptTrace: currentTurn?.promptTrace ?? pendingTrace?.promptTrace ?? "",
    promptSummary: currentTurn?.promptSummary ?? pendingTrace?.promptSummary ?? "",
  });
  broadcastThreadToAllUsers(threadId);
}

function handleItemStarted(params: any) {
  const threadId = readString(params?.threadId);
  const item = params?.item;
  if (!threadId || !item || typeof item !== "object") {
    return;
  }

  const thread = ensureThreadRecord(threadId);
  const activeTurn = activeTurns.get(threadId);
  const pendingTrace = pendingTurnTraces.get(threadId);
  const startedAt = activeTurn?.startedAt ?? new Date().toISOString();
  const itemIndex = activeTurn ? activeTurn.itemSequence++ : 0;
  const message = mapLiveItemToMessage(
    item,
    startedAt,
    "started",
    activeTurn?.mode ?? pendingTrace?.mode ?? pendingTurnModes.get(threadId) ?? "chat",
    thread.repoLabel,
    {
      turnId: readString(params?.turnId) || activeTurn?.turnId || null,
      itemIndex,
      fallbackMessageId: readString(params?.itemId) || null,
    }
  );
  if (!message) {
    return;
  }

  if (item.type === "agentMessage") {
    message.isStreaming = true;
    if (activeTurn) {
      activeTurn.assistantMessageId = message.id;
    }
  }

  appendMessage(threadId, message);
  logFlowTrace("codex.item-started", {
    threadId,
    itemId: message.id,
    itemType: item.type,
    role: message.role,
    promptTrace: activeTurn?.promptTrace ?? pendingTrace?.promptTrace ?? "",
    promptSummary: activeTurn?.promptSummary ?? pendingTrace?.promptSummary ?? "",
    cardTypes: (message.cards ?? []).map((card) => card.type),
  });
  sendBridgeEvent({ type: "bridge:message:appended", threadId, message });
  logFlowTrace("relay.message-appended.sent", {
    threadId,
    messageId: message.id,
    role: message.role,
  });
  broadcastThreadToAllUsers(threadId);
}

function handleAgentMessageDelta(params: any) {
  const threadId = readString(params?.threadId);
  const messageId = readString(params?.itemId);
  const delta = typeof params?.delta === "string" ? params.delta : "";
  if (!threadId || !messageId || !delta) {
    return;
  }

  const thread = ensureThreadRecord(threadId);
  let message = thread.messages.find((entry) => entry.id === messageId);
  if (!message) {
    message = {
      id: messageId,
      role: "assistant",
      kind: activeTurns.get(threadId)?.mode ?? pendingTurnModes.get(threadId) ?? "chat",
      text: "",
      createdAt: activeTurns.get(threadId)?.startedAt ?? new Date().toISOString(),
      isStreaming: true,
    };
    appendMessage(threadId, message);
    sendBridgeEvent({ type: "bridge:message:appended", threadId, message });
  }

  message.text += delta;
  message.isStreaming = true;
  thread.preview = message.text || thread.preview;
  thread.lastActivityAt = new Date().toISOString();
  scheduleActiveTurnStaleCheck(threadId);
  const activeTurn = activeTurns.get(threadId);
  const pendingTrace = pendingTurnTraces.get(threadId);
  logFlowTrace("codex.agent-delta", {
    threadId,
    messageId,
    deltaLength: delta.length,
    promptTrace: activeTurn?.promptTrace ?? pendingTrace?.promptTrace ?? "",
    promptSummary: activeTurn?.promptSummary ?? pendingTrace?.promptSummary ?? "",
  });
  sendBridgeEvent({ type: "bridge:message:delta", threadId, messageId, delta });
  logFlowTrace("relay.message-delta.sent", {
    threadId,
    messageId,
    deltaLength: delta.length,
  });
}

function handleItemCompleted(params: any) {
  const threadId = readString(params?.threadId);
  const item = params?.item;
  if (!threadId || !item || typeof item !== "object") {
    return;
  }

  const thread = ensureThreadRecord(threadId);
  const message = mapLiveItemToMessage(
    item,
    activeTurns.get(threadId)?.startedAt ?? new Date().toISOString(),
    "completed",
    activeTurns.get(threadId)?.mode ?? pendingTurnModes.get(threadId) ?? "chat",
    thread.repoLabel,
    {
      turnId: readString(params?.turnId) || activeTurns.get(threadId)?.turnId || null,
      fallbackMessageId: readString(params?.itemId) || activeTurns.get(threadId)?.assistantMessageId || null,
    }
  );
  if (!message) {
    return;
  }

  const existingMessage = thread.messages[findEquivalentThreadMessageIndex(thread.messages, message)];
  appendMessage(threadId, message);
  if (!existingMessage || existingMessage.id !== message.id) {
    sendBridgeEvent({ type: "bridge:message:appended", threadId, message });
    logFlowTrace("relay.message-appended.sent", {
      threadId,
      messageId: message.id,
      role: message.role,
    });
  }
  logFlowTrace("codex.item-completed", {
    threadId,
    itemId: message.id,
    role: message.role,
    itemType: item.type,
    cardTypes: (message.cards ?? []).map((card) => card.type),
    promptTrace: activeTurns.get(threadId)?.promptTrace ?? pendingTurnTraces.get(threadId)?.promptTrace ?? "",
    promptSummary: activeTurns.get(threadId)?.promptSummary ?? pendingTurnTraces.get(threadId)?.promptSummary ?? "",
  });
  if (message.role === "assistant") {
    const liveMessage = thread.messages.find((entry) => entry.id === message.id);
    if (liveMessage) {
      liveMessage.isStreaming = false;
    }
    sendBridgeEvent({ type: "bridge:message:finished", threadId, messageId: message.id });
    scheduleActiveTurnStaleCheck(threadId);
    logFlowTrace("relay.message-finished.sent", {
      threadId,
      messageId: message.id,
      promptTrace: activeTurns.get(threadId)?.promptTrace ?? pendingTurnTraces.get(threadId)?.promptTrace ?? "",
      promptSummary: activeTurns.get(threadId)?.promptSummary ?? pendingTurnTraces.get(threadId)?.promptSummary ?? "",
    });
  }
  broadcastThreadToAllUsers(threadId);
}

function handleTurnDiffUpdated(params: any) {
  const threadId = readString(params?.threadId);
  if (!threadId) {
    return;
  }

  const additions = readNumber(params?.diff?.additions) ?? 0;
  const deletions = readNumber(params?.diff?.deletions) ?? 0;
  const local = ensureThreadLocal(threadId);
  local.diff = { additions, deletions };
  const thread = threadCache.get(threadId);
  if (thread) {
    thread.diff = local.diff;
    broadcastThreadToAllUsers(threadId);
  }
}

function handleTurnCompleted(params: any) {
  const threadId = readString(params?.threadId);
  if (!threadId) {
    return;
  }

  const completedTurn = activeTurns.get(threadId);
  clearActiveTurnStaleCheck(threadId);
  activeTurns.delete(threadId);
  pendingTurnModes.delete(threadId);
  pendingTurnTraces.delete(threadId);
  const thread = ensureThreadRecord(threadId);
  const local = ensureThreadLocal(threadId);
  const hasQueuedDrafts = local.queuedDrafts.length > 0;
  thread.state = hasQueuedDrafts ? "queued" : "idle";
  thread.lastActivityAt = new Date().toISOString();

  const banner: CompletionBanner = {
    id: randomUUID(),
    threadId,
    title: thread.title,
    subtitle: hasQueuedDrafts ? "Run finished. Resuming the next queued draft." : "Run completed and synced.",
  };
  if (completedTurn?.userId) {
    sendUserPatch(completedTurn.userId, { banner });
  }
  logFlowTrace("codex.turn-completed", {
    threadId,
    turnId: completedTurn?.turnId ?? null,
    promptTrace: completedTurn?.promptTrace ?? "",
    promptSummary: completedTurn?.promptSummary ?? "",
    queuedDrafts: local.queuedDrafts.length,
  });
  schedulePersist();
  broadcastThreadToAllUsers(threadId);
  void resumeNextQueuedDraft(completedTurn?.userId, threadId);
}

async function syncAllThreadsFromCodex() {
  if (!isCodexReady()) {
    return;
  }

  if (threadSyncInFlight) {
    return threadSyncInFlight;
  }

  threadSyncInFlight = (async () => {
    const [liveThreads, archivedThreads] = await Promise.all([
      listThreads(false),
      listThreads(true),
    ]);

    const nextIds = new Set<string>();
    const selectedThreadIds = new Set(
      [...bridgeUsers.values()]
        .map((user) => user.selectedThreadId)
        .filter((threadId): threadId is string => Boolean(threadId))
    );
    for (const rawThread of liveThreads) {
      const thread = mergeCodexThread(rawThread, false, false);
      threadCache.set(thread.id, thread);
      nextIds.add(thread.id);
    }
    for (const rawThread of archivedThreads) {
      const thread = mergeCodexThread(rawThread, true, false);
      threadCache.set(thread.id, thread);
      nextIds.add(thread.id);
    }

    for (const threadId of [...threadCache.keys()]) {
      // Keep a just-created empty thread alive until Codex list starts returning it.
      if (!nextIds.has(threadId) && !activeTurns.has(threadId) && !selectedThreadIds.has(threadId)) {
        threadCache.delete(threadId);
      }
    }
    for (const threadId of Object.keys(persisted.threadLocal)) {
      if (!threadCache.has(threadId) && !activeTurns.has(threadId)) {
        delete persisted.threadLocal[threadId];
      }
    }

    normalizeSelections();
    codexLastSyncAt = new Date().toISOString();
    schedulePersist();
    broadcastSnapshotsToAllUsers();
    publishPresenceToAllUsers();

    // Thread list sync does not include turns. Re-hydrate the threads that are
    // currently selected in connected phone sessions so cold-started pages do
    // not stay stuck on metadata-only placeholders until the user reselects.
    if (selectedThreadIds.size > 0) {
      await Promise.all(
        [...selectedThreadIds].map((threadId) =>
          syncThreadFromCodex(threadId, true).catch((error) => {
            if (handleMissingThread(undefined, threadId, error)) {
              return null;
            }
            console.error(`[phodex] selected-thread sync failed for ${threadId}: ${readErrorMessage(error)}`);
            return null;
          })
        )
      );
    }
  })().finally(() => {
    threadSyncInFlight = null;
  });

  return threadSyncInFlight;
}

async function syncThreadFromCodex(threadId: string, includeTurns: boolean) {
  if (!isCodexReady()) {
    return null;
  }

  const syncKey = `${threadId}:${includeTurns ? "turns" : "metadata"}`;
  const existingSync = threadReadInFlight.get(syncKey);
  if (existingSync) {
    return existingSync;
  }

  const syncPromise = readThreadFromCodex(threadId, includeTurns).finally(() => {
    threadReadInFlight.delete(syncKey);
  });
  threadReadInFlight.set(syncKey, syncPromise);
  return syncPromise;
}

async function readThreadFromCodex(threadId: string, includeTurns: boolean) {
  if (!includeTurns) {
    return readThreadMetadataFromCodex(threadId, false);
  }

  if (codexSupportsThreadTurnsList) {
    try {
      return await readThreadFromCodexWithPagedTurns(threadId);
    } catch (error) {
      if (isThreadTurnsListUnsupportedError(error)) {
        codexSupportsThreadTurnsList = false;
        console.warn("[phodex] Codex app-server does not support thread/turns/list; falling back to full thread/read.");
      } else if (isThreadNotMaterializedError(error)) {
        return syncThreadFromCodex(threadId, false);
      } else {
        throw error;
      }
    }
  }

  return readThreadFromCodexWithFullTurns(threadId);
}

async function readThreadMetadataFromCodex(threadId: string, includeMessages: boolean, broadcast = true) {
  let result: any;
  try {
    result = await codexRequest("thread/read", {
      threadId,
      includeTurns: false,
    });
  } catch (error) {
    throw error;
  }
  if (!result?.thread) {
    return null;
  }

  const archived = threadCache.get(threadId)?.state === "archived";
  const thread = mergeCodexThread(result.thread, archived, false);
  threadCache.set(thread.id, thread);
  codexLastSyncAt = new Date().toISOString();
  if (broadcast) {
    broadcastThreadToAllUsers(thread.id, includeMessages);
    publishPresenceToAllUsers();
  }
  return thread;
}

async function readThreadFromCodexWithFullTurns(threadId: string) {
  let result: any;
  try {
    result = await codexRequest("thread/read", {
      threadId,
      includeTurns: true,
    });
  } catch (error) {
    if (isThreadNotMaterializedError(error)) {
      return syncThreadFromCodex(threadId, false);
    }
    throw error;
  }
  if (!result?.thread) {
    return null;
  }

  const archived = threadCache.get(threadId)?.state === "archived";
  const thread = mergeCodexThread(result.thread, archived, true);
  thread.history = buildLoadedThreadHistoryState(thread.messages.length, false);
  threadTurnPaginationByThreadId.delete(thread.id);
  threadCache.set(thread.id, thread);
  codexLastSyncAt = new Date().toISOString();
  finalizeSelectedThreadHydration(thread);
  broadcastThreadToAllUsers(thread.id, true);
  publishPresenceToAllUsers();
  return thread;
}

async function readThreadFromCodexWithPagedTurns(threadId: string) {
  const metadataThread = await readThreadMetadataFromCodex(threadId, true, false);
  if (!metadataThread) {
    return null;
  }

  markThreadHistoryHydrating(metadataThread.id);
  return loadThreadTurnsPageFromCodex(metadataThread.id, true);
}

async function syncOlderThreadHistoryFromCodex(threadId: string) {
  if (!isCodexReady()) {
    return null;
  }

  const existingSync = threadHistoryPageInFlight.get(threadId);
  if (existingSync) {
    return existingSync;
  }

  const syncPromise = (async () => {
    if (!codexSupportsThreadTurnsList) {
      return readThreadFromCodexWithFullTurns(threadId);
    }
    markThreadHistoryHydrating(threadId);
    try {
      return await loadThreadTurnsPageFromCodex(threadId, false);
    } catch (error) {
      if (isThreadTurnsListUnsupportedError(error)) {
        codexSupportsThreadTurnsList = false;
        return readThreadFromCodexWithFullTurns(threadId);
      }
      throw error;
    }
  })().finally(() => {
    threadHistoryPageInFlight.delete(threadId);
  });

  threadHistoryPageInFlight.set(threadId, syncPromise);
  return syncPromise;
}

function markThreadHistoryHydrating(threadId: string) {
  const thread = threadCache.get(threadId);
  if (!thread) {
    return;
  }
  if (isThreadHistoryKnownComplete(thread.history)) {
    return;
  }

  thread.history = {
    totalMessages: thread.history?.totalMessages ?? null,
    loadedMessages: thread.messages.length,
    remainingMessages: thread.history?.remainingMessages ?? null,
    hasMoreBefore: thread.history?.hasMoreBefore ?? false,
    isHydrating: true,
  };
  threadCache.set(thread.id, thread);
  broadcastThreadToAllUsers(thread.id, true);
}

async function loadThreadTurnsPageFromCodex(threadId: string, reset: boolean) {
  let current = threadCache.get(threadId) ?? null;
  if (!current) {
    current = await readThreadMetadataFromCodex(threadId, true);
  }
  if (!current) {
    return null;
  }

  const pagination = reset ? null : threadTurnPaginationByThreadId.get(threadId) ?? null;
  if (!reset && pagination && !pagination.nextCursor) {
    current.history = buildLoadedThreadHistoryState(current.messages.length, false);
    threadCache.set(current.id, current);
    broadcastThreadToAllUsers(current.id, true);
    return current;
  }

  const response = await codexRequest("thread/turns/list", {
    threadId,
    cursor: reset ? null : pagination?.nextCursor ?? null,
    limit: CODEX_THREAD_TURNS_PAGE_SIZE,
    sortDirection: "desc",
  }) as ThreadTurnsListResponse;

  const pageTurns = Array.isArray(response?.data) ? response.data : [];
  const pageMessages = mapTurnsToMessages([...pageTurns].reverse(), new Map(), current.repoLabel || DEFAULT_THREAD_CWD);
  const existingMessages = current.messages ?? [];
  const nextMessages = dedupeMessages(reset ? [...existingMessages, ...pageMessages] : [...pageMessages, ...existingMessages]).map(
    (message) => preserveImagePreviewFromMessage(existingMessages.find((entry) => entry.id === message.id), message)
  );
  const hasMoreBefore = Boolean(response?.nextCursor);

  current = {
    ...current,
    messages: nextMessages,
    history: buildLoadedThreadHistoryState(nextMessages.length, hasMoreBefore),
  };
  threadCache.set(current.id, current);
  threadTurnPaginationByThreadId.set(current.id, {
    nextCursor: response?.nextCursor ?? null,
    backwardsCursor: response?.backwardsCursor ?? null,
    loadedTurns: (reset ? 0 : pagination?.loadedTurns ?? 0) + pageTurns.length,
  });
  codexLastSyncAt = new Date().toISOString();
  finalizeSelectedThreadHydration(current);
  broadcastThreadToAllUsers(current.id, true);
  publishPresenceToAllUsers();
  return current;
}

function buildLoadedThreadHistoryState(loadedMessages: number, hasMoreBefore: boolean): ThreadHistoryState {
  return {
    totalMessages: hasMoreBefore ? null : loadedMessages,
    loadedMessages,
    remainingMessages: hasMoreBefore ? null : 0,
    hasMoreBefore,
    isHydrating: false,
  };
}

function isThreadHistoryKnownComplete(history: ThreadHistoryState | null | undefined) {
  return Boolean(history && history.totalMessages !== null && history.remainingMessages === 0 && !history.hasMoreBefore);
}

function shouldHydrateThreadOnSelect(threadId: string) {
  const thread = threadCache.get(threadId);
  return !thread || thread.messages.length > 0 || !isThreadHistoryKnownComplete(thread.history);
}

function finalizeSelectedThreadHydration(thread: ThreadRecord) {
  if (thread.messages.length > 0 || isThreadHistoryKnownComplete(thread.history)) {
    const retryTimer = selectedThreadHydrationRetryTimers.get(thread.id);
    if (retryTimer) {
      clearTimeout(retryTimer);
      selectedThreadHydrationRetryTimers.delete(thread.id);
    }
    selectedThreadHydrationRetryCounts.delete(thread.id);
  } else if (shouldRetrySelectedThreadHydration(thread.id)) {
    scheduleSelectedThreadHydrationRetry(thread.id);
  }
}

function shouldRetrySelectedThreadHydration(threadId: string) {
  if (![...bridgeUsers.values()].some((user) => user.selectedThreadId === threadId)) {
    return false;
  }
  if (selectedThreadHydrationRetryTimers.has(threadId)) {
    return false;
  }
  return (selectedThreadHydrationRetryCounts.get(threadId) ?? 0) < 1;
}

function scheduleSelectedThreadHydrationRetry(threadId: string) {
  selectedThreadHydrationRetryCounts.set(threadId, (selectedThreadHydrationRetryCounts.get(threadId) ?? 0) + 1);
  const timer = setTimeout(() => {
    selectedThreadHydrationRetryTimers.delete(threadId);
    void syncThreadFromCodex(threadId, true).catch((error) => {
      console.error(`[phodex] selected-thread retry sync failed for ${threadId}: ${readErrorMessage(error)}`);
    });
  }, 800);
  selectedThreadHydrationRetryTimers.set(threadId, timer);
}

async function listThreads(archived: boolean) {
  const items: any[] = [];
  let cursor: string | null = null;

  while (true) {
    const response = await codexRequest("thread/list", {
      archived,
      cursor,
      limit: 100,
    }) as ThreadListResponse;
    items.push(...(Array.isArray(response?.data) ? response.data : []));
    cursor = response?.nextCursor ?? null;
    if (!cursor) {
      break;
    }
  }

  return items;
}

function mergeCodexThread(rawThread: any, archived: boolean, includeTurns: boolean) {
  const threadId = readString(rawThread?.id) || randomUUID();
  const existing = threadCache.get(threadId);
  const local = ensureThreadLocal(threadId);
  const repoLabel = readString(rawThread?.cwd) || readString(rawThread?.path) || existing?.repoLabel || DEFAULT_THREAD_CWD;
  const sessionFallback = includeTurns
    ? readSessionHistoryFallback(readString(rawThread?.path), repoLabel)
    : null;
  const gitDiff = includeTurns ? readThreadDiffFromGit(repoLabel) : null;
  const fallbackDiff = includeTurns
    ? gitDiff ?? (hasDiffStats(sessionFallback?.totalDiff) ? sessionFallback!.totalDiff : local.diff)
    : local.diff;
  if (includeTurns) {
    local.diff = fallbackDiff;
  }
  const preservedLiveMessages = includeTurns
    ? (existing?.messages.filter(
        (message) => hasImageCard(message) && !message.isStreaming && !hasMessageId(rawThread?.turns, message.id)
      ) ?? [])
    : [];
  const mappedMessages = includeTurns && Array.isArray(rawThread?.turns)
    ? dedupeMessages([
        ...mapTurnsToMessages(rawThread.turns, sessionFallback?.turns, repoLabel),
        ...preservedLiveMessages,
        ...(activeTurns.has(threadId) ? (existing?.messages.filter((message) => message.isStreaming) ?? []) : []),
      ]).map((message) => preserveImagePreviewFromMessage(existing?.messages.find((entry) => entry.id === message.id), message))
    : existing?.messages ?? [];

  return {
    id: threadId,
    title: local.customTitle || deriveThreadTitle(rawThread),
    preview: readString(rawThread?.preview) || existing?.preview || "Start a new remote coding pass.",
    projectLabel: deriveProjectLabel(rawThread),
    repoLabel,
    branch: readString(rawThread?.gitInfo?.branch) || existing?.branch || "main",
    state: deriveThreadState(readString(rawThread?.status?.type), threadId, archived),
    createdAt: toIsoFromEpoch(rawThread?.createdAt) ?? existing?.createdAt ?? existing?.lastActivityAt ?? new Date().toISOString(),
    lastActivityAt: toIsoFromEpoch(rawThread?.updatedAt) ?? toIsoFromEpoch(rawThread?.createdAt) ?? existing?.lastActivityAt ?? new Date().toISOString(),
    unreadCount: 0,
    subagentCount: 0,
    isWorktree: isWorktreeThread(rawThread),
    isForked: Boolean(rawThread?.forkedFromId),
    diff: fallbackDiff,
    queuedDrafts: local.queuedDrafts,
    messages: mappedMessages,
    history: includeTurns ? buildLoadedThreadHistoryState(mappedMessages.length, false) : existing?.history ?? null,
  } satisfies ThreadRecord;
}

function mapTurnsToMessages(
  turns: any[],
  fallbackTurns = new Map<string, SessionTurnHistoryFallback>(),
  cwd = DEFAULT_THREAD_CWD
) {
  const messages: ThreadMessage[] = [];
  for (const turn of turns) {
    const createdAt = toIsoFromEpoch(turn?.startedAt) ?? new Date().toISOString();
    const turnMode = deriveTurnModeFromItems(Array.isArray(turn?.items) ? turn.items : []);
    const turnMessages: ThreadMessage[] = [];
    const turnId = readString(turn?.id);
    for (const [itemIndex, item] of (Array.isArray(turn?.items) ? turn.items : []).entries()) {
      const message = mapLiveItemToMessage(item, createdAt, "history", turnMode, cwd, {
        turnId: turnId || null,
        itemIndex,
      });
      if (message) {
        turnMessages.push(message);
      }
    }
    const fallback = turnId ? fallbackTurns.get(turnId) : null;
    if (fallback?.fileChanges.length && !turnMessages.some((message) => message.fileChanges?.length)) {
      const changeSummary = summarizeFileChanges(fallback.fileChanges);
      turnMessages.push({
        id: turnId ? `${turnId}-session-file-change` : randomUUID(),
        role: "system",
        kind: "status",
        text: "",
        createdAt: toIsoFromEpoch(turn?.completedAt) ?? createdAt,
        cards: [
          {
            type: "status",
            title: changeSummary.title,
            detail: changeSummary.detail,
            tone: "blue",
          },
        ],
        fileChanges: fallback.fileChanges,
      } satisfies ThreadMessage);
    }
    messages.push(...turnMessages);
  }
  return messages;
}

const GENERATED_ITEM_MESSAGE_ID_PREFIX = "generated-codex-item-message:";

type ItemMessageContext = {
  turnId?: string | null;
  itemIndex?: number;
  fallbackMessageId?: string | null;
};

function stableUserMessageId(
  item: any,
  text: string,
  inputImages: InputImageAttachment[],
  createdAt: string,
  context: ItemMessageContext
) {
  const explicitId = readString(item?.id) || readString(context.fallbackMessageId);
  if (explicitId) {
    return explicitId;
  }
  if (context.turnId) {
    return `${GENERATED_USER_MESSAGE_ID_PREFIX}${context.turnId}:${buildPromptTraceKey(text, inputImages)}`;
  }
  return buildGeneratedUserMessageId(text, inputImages, createdAt);
}

function stableItemMessageId(item: any, context: ItemMessageContext) {
  const explicitId = readString(item?.id) || readString(context.fallbackMessageId);
  if (explicitId) {
    return explicitId;
  }

  const itemType = readString(item?.type) || "item";
  if (context.turnId && Number.isInteger(context.itemIndex)) {
    return `${GENERATED_ITEM_MESSAGE_ID_PREFIX}${context.turnId}:${context.itemIndex}:${itemType}`;
  }
  if (context.turnId) {
    return `${GENERATED_ITEM_MESSAGE_ID_PREFIX}${context.turnId}:${itemType}:${buildPromptTraceKey(readString(item?.text), [])}`;
  }
  return randomUUID();
}

function mapLiveItemToMessage(
  item: any,
  createdAt: string,
  stage: "history" | "started" | "completed" = "history",
  assistantKind: "chat" | "plan" = "chat",
  cwd = DEFAULT_THREAD_CWD,
  context: ItemMessageContext = {}
) {
  if (item?.type === "userMessage") {
    const inputImages = readUserItemImages(item);
    const text = readUserItemText(item);
    return {
      id: stableUserMessageId(item, text, inputImages, createdAt, context),
      role: "user",
      kind: "chat",
      text,
      inputImages,
      createdAt,
    } satisfies ThreadMessage;
  }

  const itemId = stableItemMessageId(item, context);
  if (item?.type === "agentMessage") {
    const phase = readString(item?.phase);
    return {
      id: itemId,
      role: "assistant",
      kind: assistantKind === "plan" && phase !== "final_answer" ? "plan" : "chat",
      text: readString(item?.text),
      createdAt,
      isStreaming: false,
    } satisfies ThreadMessage;
  }

  if (item?.type === "commandExecution") {
    return mapCommandExecutionMessage(item, itemId, createdAt, stage);
  }

  if (item?.type === "fileChange") {
    return mapFileChangeMessage(item, itemId, createdAt);
  }

  if (item?.type === "webSearch") {
    return mapWebSearchMessage(item, itemId, createdAt);
  }

  if (item?.type === "mcpToolCall") {
    return mapMcpToolCallMessage(item, itemId, createdAt);
  }

  if (item?.type === "collabAgentToolCall") {
    return mapCollabAgentToolCallMessage(item, itemId, createdAt);
  }

  if (item?.type === "contextCompaction") {
    return {
      id: itemId,
      role: "system",
      kind: "status",
      text: "",
      createdAt,
      cards: [
        {
          type: "status",
          title: "Context compacted",
          detail: "Earlier context was compacted so the run could keep going.",
          tone: "slate",
        },
      ],
    } satisfies ThreadMessage;
  }

  if (item?.type === "imageView") {
    const path = readString(item?.path);
    const previewPath = resolveArtifactPath(path, cwd);
    return {
      id: itemId,
      role: "system",
      kind: "status",
      text: "",
      createdAt,
      cards: [
        {
          type: "image",
          title: "Image artifact",
          path,
          imageUrl: readImageArtifactPreview(previewPath),
          detail: path ? basename(path) : "Local image",
          meta: path || undefined,
          tone: "blue",
        },
      ],
    } satisfies ThreadMessage;
  }

  return null;
}

function appendMessage(threadId: string, nextMessage: ThreadMessage) {
  const thread = ensureThreadRecord(threadId);
  upsertThreadMessage(thread.messages, nextMessage);
  thread.preview = summarizeMessagePreview(nextMessage.text, nextMessage.inputImages) || thread.preview;
  thread.lastActivityAt = nextMessage.createdAt;
  return thread;
}

function markThreadRunning(threadId: string, preview: string) {
  const thread = ensureThreadRecord(threadId);
  thread.state = "running";
  thread.preview = preview;
  thread.lastActivityAt = new Date().toISOString();
}

function applyThreadStatusUpdate(threadId: string, statusType: string) {
  if (!threadId) {
    return;
  }

  const thread = ensureThreadRecord(threadId);
  const previousState = thread.state;
  thread.state = deriveThreadState(statusType, threadId, thread.state === "archived");
  thread.lastActivityAt = new Date().toISOString();
  const activeTurn = activeTurns.get(threadId);
  logFlowTrace("codex.thread-status.changed", {
    threadId,
    statusType,
    previousState,
    nextState: thread.state,
    hasActiveTurn: Boolean(activeTurn),
    promptTrace: activeTurn?.promptTrace ?? "",
    promptSummary: activeTurn?.promptSummary ?? "",
  });
  // Some Codex backends emit a terminal status change before turn/completed.
  // Keep the active turn context until the terminal turn event arrives so
  // queued auto-resume still has the originating user and prompt trace.
  broadcastThreadToAllUsers(threadId);
}

function scheduleActiveTurnStaleCheck(threadId: string) {
  clearActiveTurnStaleCheck(threadId);
  activeTurnStaleTimers.set(
    threadId,
    setTimeout(() => {
      activeTurnStaleTimers.delete(threadId);
      reconcileStaleActiveTurn(threadId);
    }, ACTIVE_TURN_STALE_MS)
  );
}

function clearActiveTurnStaleCheck(threadId: string) {
  const timer = activeTurnStaleTimers.get(threadId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  activeTurnStaleTimers.delete(threadId);
}

function reconcileStaleActiveTurn(threadId: string) {
  const activeTurn = activeTurns.get(threadId);
  const thread = threadCache.get(threadId);
  if (!activeTurn || !thread || thread.state !== "running") {
    return;
  }
  if (thread.messages.some((message) => message.isStreaming)) {
    scheduleActiveTurnStaleCheck(threadId);
    return;
  }

  activeTurns.delete(threadId);
  pendingTurnModes.delete(threadId);
  pendingTurnTraces.delete(threadId);
  thread.state = deriveThreadState("idle", threadId, thread.state === "archived");
  thread.lastActivityAt = new Date().toISOString();
  logFlowTrace("codex.turn-stale-reconciled", {
    threadId,
    turnId: activeTurn.turnId,
    promptTrace: activeTurn.promptTrace,
    promptSummary: activeTurn.promptSummary,
  });
  schedulePersist();
  broadcastThreadToAllUsers(threadId);
}

function deriveThreadState(statusType: string, threadId: string, archived: boolean) {
  if (archived) {
    return "archived";
  }
  if (statusType === "active" || statusType === "inProgress") {
    return "running";
  }
  return ensureThreadLocal(threadId).queuedDrafts.length > 0 ? "queued" : "idle";
}

function ensureThreadRecord(threadId: string) {
  const existing = threadCache.get(threadId);
  if (existing) {
    return existing;
  }

  const local = ensureThreadLocal(threadId);
  const defaultProject = resolveProjectContext(DEFAULT_THREAD_CWD);
  const thread: ThreadRecord = {
    id: threadId,
    title: local.customTitle || "New Chat",
    preview: "",
    projectLabel: basename(defaultProject.projectRoot) || "Codex",
    repoLabel: defaultProject.projectRoot,
    branch: "main",
    state: local.queuedDrafts.length > 0 ? "queued" : "idle",
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    unreadCount: 0,
    subagentCount: 0,
    isWorktree: false,
    isForked: false,
    diff: local.diff,
    queuedDrafts: local.queuedDrafts,
    messages: [],
  };
  threadCache.set(threadId, thread);
  return thread;
}

function snapshotForUser(userId: string): AppSnapshot {
  const user = persisted.users[userId];
  const threads = [...sortThreadsByCreatedAtDesc([...threadCache.values()])]
    .sort((left, right) => {
      const leftArchived = left.state === "archived" ? 1 : 0;
      const rightArchived = right.state === "archived" ? 1 : 0;
      if (leftArchived !== rightArchived) {
        return leftArchived - rightArchived;
      }
      return Date.parse(right.createdAt || right.lastActivityAt) - Date.parse(left.createdAt || left.lastActivityAt);
    })
    .map((thread) => serializeThreadForUser(thread, user.selectedThreadId));

  return {
    user: user.profile,
    selectedThreadId: user.selectedThreadId,
    threads,
    settings: user.settings,
    connection: buildConnection(),
    activeBridgeId: null,
    bridgeDevices: [],
    banner: user.banner,
  };
}

function buildConnection(): RelayConnection {
  return {
    bridgeOnline: relaySocket?.readyState === WebSocket.OPEN,
    state: codexConnectionState,
    relayLabel: RELAY_LABEL,
    deviceLabel: DEVICE_LABEL,
    lastSyncAt: codexLastSyncAt,
    rateLimits: codexRateLimits,
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
  const firstAnyThreadId = sortThreadsByCreatedAtDesc([...threadCache.values()]).at(0)?.id ?? null;

  for (const user of bridgeUsers.values()) {
    if (user.selectedThreadId === null) {
      continue;
    }
    if (threadCache.has(user.selectedThreadId)) {
      continue;
    }
    user.selectedThreadId = firstLiveThreadId ?? firstAnyThreadId;
  }
}

function forgetThread(threadId: string, userId?: string) {
  const retryTimer = selectedThreadHydrationRetryTimers.get(threadId);
  if (retryTimer) {
    clearTimeout(retryTimer);
    selectedThreadHydrationRetryTimers.delete(threadId);
  }
  clearActiveTurnStaleCheck(threadId);
  selectedThreadHydrationRetryCounts.delete(threadId);
  activeTurns.delete(threadId);
  pendingTurnModes.delete(threadId);
  pendingTurnTraces.delete(threadId);
  threadCache.delete(threadId);
  delete persisted.threadLocal[threadId];
  const nextSelectedThreadId = findFirstLiveThreadId(threadId);

  for (const user of bridgeUsers.values()) {
    if (user.selectedThreadId !== threadId) {
      continue;
    }
    user.selectedThreadId = nextSelectedThreadId;
    sendUserPatch(user.profile.id, { selectedThreadId: nextSelectedThreadId });
  }

  for (const user of Object.values(persisted.users)) {
    if (user.selectedThreadId === threadId) {
      user.selectedThreadId = nextSelectedThreadId;
    }
  }

  schedulePersist();
  broadcastSnapshotsToAllUsers();
  sendBridgeState();
  if (userId) {
    publishPresenceToAllUsers();
  }
}

function findFirstLiveThreadId(excludingThreadId?: string) {
  return sortThreadsByCreatedAtDesc(
    [...threadCache.values()].filter((thread) => thread.id !== excludingThreadId && thread.state !== "archived")
  ).at(0)?.id ?? null;
}

function ensureThreadLocal(threadId: string) {
  if (!persisted.threadLocal[threadId]) {
    persisted.threadLocal[threadId] = {
      customTitle: undefined,
      queuedDrafts: [],
      diff: { additions: 0, deletions: 0 },
    };
  }
  return persisted.threadLocal[threadId];
}

function deriveThreadTitle(rawThread: any) {
  const explicitName = readString(rawThread?.name);
  if (explicitName) {
    return explicitName;
  }

  const preview = readString(rawThread?.preview);
  if (preview) {
    return preview.slice(0, 64);
  }

  const cwd = readString(rawThread?.cwd);
  if (cwd) {
    return basename(cwd);
  }

  return "New Chat";
}

function deriveProjectLabel(rawThread: any) {
  const cwd = readString(rawThread?.cwd);
  if (!cwd) {
    return "Codex";
  }
  return basename(resolveProjectContext(cwd).projectRoot) || basename(cwd) || "Codex";
}

function isWorktreeThread(rawThread: any) {
  const cwd = readString(rawThread?.cwd);
  return cwd.includes("/worktrees/") || cwd.includes("/.codex/worktrees/");
}

function resolveRequestedThreadCwd(user: PersistedUser, event: ThreadCreateRequest) {
  const explicitCwd = readString(event.cwd);
  if (explicitCwd) {
    return resolveExplicitThreadCwd(explicitCwd);
  }

  const selectedThread = user.selectedThreadId ? threadCache.get(user.selectedThreadId) : null;
  if (selectedThread?.repoLabel) {
    return resolve(selectedThread.repoLabel);
  }

  const groupThread = event.projectLabel
    ? [...threadCache.values()].find((thread) => thread.projectLabel === event.projectLabel && thread.state !== "archived")
    : null;
  if (groupThread?.repoLabel) {
    return resolve(groupThread.repoLabel);
  }

  return DEFAULT_THREAD_CWD;
}

function resolveExplicitThreadCwd(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_THREAD_CWD;
  }

  if (trimmed === "~") {
    return homedir();
  }

  if (trimmed.startsWith("~/")) {
    return resolve(homedir(), trimmed.slice(2));
  }

  if (isAbsolute(trimmed)) {
    return resolve(trimmed);
  }

  const resolvedWithinProjectsRoot = resolve(PROJECTS_ROOT, trimmed);
  const relativeToProjectsRoot = relative(PROJECTS_ROOT, resolvedWithinProjectsRoot);
  if (relativeToProjectsRoot.startsWith("..") || isAbsolute(relativeToProjectsRoot)) {
    throw new Error("Relative project names must stay inside the Phodex projects directory.");
  }

  return resolvedWithinProjectsRoot;
}

function ensureLocalThreadCwd(cwd: string) {
  const resolvedCwd = resolve(cwd);
  projectContextCache.delete(resolvedCwd);
  if (existsSync(resolvedCwd)) {
    const stat = statSync(resolvedCwd);
    if (!stat.isDirectory()) {
      throw new Error("The requested cwd points at a file, not a folder.");
    }
    return resolvedCwd;
  }

  mkdirSync(resolvedCwd, { recursive: true });
  return resolvedCwd;
}

function resolveProjectContext(cwd: string): ProjectContext {
  const requestedCwd = resolve(cwd);
  const cached = projectContextCache.get(requestedCwd);
  if (cached) {
    return cached;
  }

  const gitProbeCwd = findNearestExistingDirectory(requestedCwd);
  let projectRoot = requestedCwd;
  let gitCommonDir: string | null = null;
  let isRepo = false;

  const topLevelResult = gitProbeCwd
    ? gitSpawnSync(["rev-parse", "--path-format=absolute", "--show-toplevel"], gitProbeCwd)
    : { ok: false as const, stderr: "" };
  if (gitProbeCwd && topLevelResult.ok) {
    isRepo = true;
    projectRoot = topLevelResult.stdout || requestedCwd;
    const commonDirResult = gitSpawnSync(["rev-parse", "--path-format=absolute", "--git-common-dir"], gitProbeCwd);
    if (commonDirResult.ok) {
      gitCommonDir = commonDirResult.stdout || null;
      if (gitCommonDir && basename(gitCommonDir) === ".git") {
        projectRoot = dirname(gitCommonDir);
      }
    }
  }

  const context = {
    requestedCwd,
    projectRoot,
    gitCommonDir,
    isRepo,
  } satisfies ProjectContext;
  projectContextCache.set(requestedCwd, context);
  return context;
}

const PROJECT_TEXT_MIME_TYPES: Record<string, string> = {
  ".c": "text/plain",
  ".cc": "text/plain",
  ".cpp": "text/plain",
  ".css": "text/css",
  ".go": "text/plain",
  ".h": "text/plain",
  ".html": "text/html",
  ".java": "text/plain",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/javascript",
  ".kt": "text/plain",
  ".md": "text/markdown",
  ".mjs": "text/javascript",
  ".py": "text/x-python",
  ".rb": "text/plain",
  ".rs": "text/plain",
  ".sh": "text/x-shellscript",
  ".sql": "text/plain",
  ".svg": "image/svg+xml",
  ".toml": "application/toml",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".txt": "text/plain",
  ".vue": "text/plain",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};
const PROJECT_FILE_PREVIEW_MAX_BYTES = 256 * 1024;

function readProjectResource(request: BridgeProjectRequest): ProjectResourcePayload {
  const thread = threadCache.get(request.threadId);
  if (!thread) {
    throw new ProjectResourceError(404, "Thread not found.");
  }

  const root = writableRootForThread(thread);
  if (!existsSync(root)) {
    throw new ProjectResourceError(404, "Project root not found on this computer.");
  }

  switch (request.kind) {
    case "tree":
      return listProjectTree(root, request.path);
    case "file":
      return readProjectFile(root, request.path);
    case "diff":
      return readProjectDiff(root, request.path);
  }
}

function listProjectTree(root: string, requestedPath: string): ProjectTreePayload {
  const directoryPath = resolveProjectScopedPath(root, requestedPath || ".");
  if (!existsSync(directoryPath)) {
    throw new ProjectResourceError(404, "Requested path was not found.");
  }
  const directoryStats = statSync(directoryPath);
  if (!directoryStats.isDirectory()) {
    throw new ProjectResourceError(400, "Requested path is not a directory.");
  }

  const entries: ProjectTreeEntry[] = [];
  for (const dirent of readdirSync(directoryPath, { withFileTypes: true })) {
    const targetPath = resolve(directoryPath, dirent.name);
    try {
      const stats = statSync(targetPath);
      entries.push({
        name: dirent.name,
        path: normalizeProjectRelativePath(root, targetPath),
        kind: stats.isDirectory() ? "directory" : "file",
        size: stats.isDirectory() ? 0 : stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    } catch {
      continue;
    }
  }

  entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  return {
    kind: "tree",
    root: resolve(root),
    path: normalizeProjectRelativePath(root, directoryPath),
    entries,
  };
}

function readProjectFile(root: string, requestedPath: string): ProjectFilePayload {
  const filePath = resolveProjectScopedPath(root, requestedPath);
  if (!existsSync(filePath)) {
    throw new ProjectResourceError(404, "Requested path was not found.");
  }
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new ProjectResourceError(400, "Requested path is not a file.");
  }

  const buffer = readFileSync(filePath);
  const mimeType = PROJECT_TEXT_MIME_TYPES[extname(filePath).toLowerCase()] ?? "text/plain";
  const payloadBase = {
    kind: "file" as const,
    root: resolve(root),
    path: normalizeProjectRelativePath(root, filePath),
    mimeType,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };

  if (isLikelyBinaryBuffer(buffer)) {
    return {
      ...payloadBase,
      fileKind: "binary",
      encoding: "none",
      mimeType: "application/octet-stream",
    };
  }

  const truncated = buffer.byteLength > PROJECT_FILE_PREVIEW_MAX_BYTES;
  const previewBuffer = truncated ? buffer.subarray(0, PROJECT_FILE_PREVIEW_MAX_BYTES) : buffer;
  return {
    ...payloadBase,
    fileKind: "text",
    encoding: "utf-8",
    content: previewBuffer.toString("utf8"),
    truncated,
  };
}

function readProjectDiff(root: string, requestedPath: string | null): ProjectDiffPayload {
  const rootPath = resolve(root);
  const projectContext = resolveProjectContext(rootPath);
  let absoluteFilterPath: string | null = null;
  if (requestedPath) {
    absoluteFilterPath = resolveProjectScopedPath(rootPath, requestedPath);
    if (!existsSync(absoluteFilterPath)) {
      throw new ProjectResourceError(404, "Requested path was not found.");
    }
  }

  if (!projectContext.isRepo) {
    return {
      kind: "diff",
      root: rootPath,
      path: absoluteFilterPath ? normalizeProjectRelativePath(rootPath, absoluteFilterPath) : null,
      summary: { additions: 0, deletions: 0 },
      files: [],
    };
  }

  const gitRelativeFilter = absoluteFilterPath
    ? normalizeProjectRelativePath(projectContext.projectRoot, absoluteFilterPath)
    : null;

  const diffArgs = ["diff", "--find-renames", "--no-ext-diff", "--no-color", "HEAD"];
  if (gitRelativeFilter) {
    diffArgs.push("--", gitRelativeFilter);
  }
  const diffResult = gitSpawnSync(diffArgs, projectContext.projectRoot);
  if (!diffResult.ok) {
    throw new ProjectResourceError(500, diffResult.stderr || "Unable to read git diff.");
  }

  const files = parseProjectDiffFiles(diffResult.stdout);
  const untrackedArgs = ["ls-files", "--others", "--exclude-standard"];
  if (gitRelativeFilter) {
    untrackedArgs.push("--", gitRelativeFilter);
  }
  const untrackedResult = gitSpawnSync(untrackedArgs, projectContext.projectRoot);
  if (untrackedResult.ok) {
    for (const relativePath of untrackedResult.stdout.split("\n").map((value) => value.trim()).filter(Boolean)) {
      const untrackedFile = buildUntrackedDiffFile(projectContext.projectRoot, relativePath);
      if (untrackedFile) {
        files.push(untrackedFile);
      }
    }
  }

  return {
    kind: "diff",
    root: rootPath,
    path: absoluteFilterPath ? normalizeProjectRelativePath(rootPath, absoluteFilterPath) : null,
    summary: summarizeDiffStats(files),
    files,
  };
}

function resolveProjectScopedPath(root: string, requestedPath: string) {
  const normalizedRoot = resolve(root);
  const targetPath = resolve(normalizedRoot, requestedPath || ".");
  const relativeToRoot = relative(normalizedRoot, targetPath);
  if (relativeToRoot && (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot))) {
    throw new ProjectResourceError(403, "Access outside of the project root is not allowed.");
  }

  const realRoot = normalizeComparablePath(normalizedRoot);
  if (existsSync(targetPath)) {
    const realTarget = normalizeComparablePath(targetPath);
    const relativeToRealRoot = relative(realRoot, realTarget);
    if (relativeToRealRoot && (relativeToRealRoot.startsWith("..") || isAbsolute(relativeToRealRoot))) {
      throw new ProjectResourceError(403, "Access outside of the project root is not allowed.");
    }
  }

  return targetPath;
}

function normalizeProjectRelativePath(root: string, targetPath: string) {
  const normalized = relative(resolve(root), resolve(targetPath)).replace(/\\/g, "/");
  return normalized || ".";
}

function isLikelyBinaryBuffer(buffer: Buffer) {
  const length = Math.min(buffer.length, 8_192);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

function parseProjectDiffFiles(diff: string) {
  if (!diff.trim()) {
    return [] as ProjectDiffFile[];
  }

  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ") && currentChunk.length) {
      chunks.push(currentChunk);
      currentChunk = [];
    }
    currentChunk.push(line);
  }
  if (currentChunk.length) {
    chunks.push(currentChunk);
  }

  return chunks
    .map((chunk) => buildProjectDiffFile(chunk))
    .filter((entry): entry is ProjectDiffFile => Boolean(entry));
}

function buildProjectDiffFile(lines: string[]): ProjectDiffFile | null {
  const patch = lines.join("\n").trim();
  if (!patch) {
    return null;
  }

  const renameFrom = lines.find((line) => line.startsWith("rename from "))?.slice("rename from ".length).trim() ?? "";
  const renameTo = lines.find((line) => line.startsWith("rename to "))?.slice("rename to ".length).trim() ?? "";
  const headerPath = extractDiffHeaderPath(lines);
  const path = renameFrom && renameTo ? `${renameFrom} -> ${renameTo}` : normalizeProjectDiffPath(headerPath);
  if (!path) {
    return null;
  }
  const stats = parseUnifiedDiffStats(patch);

  return {
    action: detectProjectDiffAction(lines),
    path,
    additions: stats.additions,
    deletions: stats.deletions,
    patch,
  };
}

function extractDiffHeaderPath(lines: string[]) {
  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      const candidate = line.slice(4).trim();
      if (candidate && candidate !== "/dev/null") {
        return candidate;
      }
    }
  }

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const candidate = line.slice(4).trim();
      if (candidate && candidate !== "/dev/null") {
        return candidate;
      }
    }
  }

  const diffHeader = lines.find((line) => line.startsWith("diff --git "));
  if (!diffHeader) {
    return "";
  }
  const parts = diffHeader.split(" ");
  return parts[3] ?? parts[2] ?? "";
}

function normalizeProjectDiffPath(rawPath: string) {
  return rawPath.replace(/^(a|b)\//, "").trim();
}

function detectProjectDiffAction(lines: string[]): FileChangeSummary["action"] {
  if (lines.some((line) => line.startsWith("rename from ") || line.startsWith("rename to "))) {
    return "Moved";
  }
  if (lines.some((line) => line.startsWith("new file mode ")) || lines.includes("--- /dev/null")) {
    return "Created";
  }
  if (lines.some((line) => line.startsWith("deleted file mode ")) || lines.includes("+++ /dev/null")) {
    return "Deleted";
  }
  return "Edited";
}

function buildUntrackedDiffFile(projectRoot: string, relativePath: string): ProjectDiffFile | null {
  const filePath = resolve(projectRoot, relativePath);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return null;
    }

    const normalizedPath = normalizeProjectRelativePath(projectRoot, filePath);
    const buffer = readFileSync(filePath);
    if (isLikelyBinaryBuffer(buffer)) {
      return {
        action: "Created",
        path: normalizedPath,
        additions: 0,
        deletions: 0,
        patch: `diff --git a/${normalizedPath} b/${normalizedPath}\nnew file mode 100644\nBinary files /dev/null and b/${normalizedPath} differ`,
      };
    }

    const content = buffer.toString("utf8");
    const lines = content.split("\n");
    const patchLines = [
      `diff --git a/${normalizedPath} b/${normalizedPath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${normalizedPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ];

    return {
      action: "Created",
      path: normalizedPath,
      additions: lines.length,
      deletions: 0,
      patch: patchLines.join("\n"),
    };
  } catch {
    return null;
  }
}

function findNearestExistingDirectory(value: string) {
  let cursor = resolve(value);
  while (true) {
    if (existsSync(cursor)) {
      try {
        if (statSync(cursor).isDirectory()) {
          return cursor;
        }
      } catch {
        return null;
      }
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    cursor = parent;
  }
}

function createWorktreeForProject(projectRoot: string, seed: string) {
  const repoSlug = sanitizeGitRefSegment(basename(projectRoot) || "project");
  const branchSeed = sanitizeGitRefSegment(seed || repoSlug);
  const stamp = Date.now().toString(36);
  const suffix = randomUUID().slice(0, 6).toLowerCase();
  const branchName = `codex-${branchSeed}-${stamp}-${suffix}`;
  const worktreeCwd = resolve(WORKTREE_ROOT, repoSlug, `${stamp}-${suffix}`);
  mkdirSync(dirname(worktreeCwd), { recursive: true });

  const result = gitSpawnSync(["worktree", "add", "-b", branchName, worktreeCwd, "HEAD"], projectRoot);
  if (!result.ok) {
    throw new Error(result.stderr || "Unable to create a new worktree.");
  }

  return { worktreeCwd, branchName };
}

function sanitizeGitRefSegment(value: string) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return sanitized || "worktree";
}

function gitSpawnSync(args: string[], cwd: string) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });

  if (result.error) {
    return {
      ok: false as const,
      stderr: readErrorMessage(result.error),
    };
  }

  if (result.status !== 0) {
    return {
      ok: false as const,
      stderr: (result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim(),
    };
  }

  return {
    ok: true as const,
    stdout: (result.stdout || "").trim(),
  };
}

function readSessionHistoryFallback(sessionPath: string, cwd: string): SessionHistoryFallback | null {
  if (!sessionPath || !sessionPath.endsWith(".jsonl") || !existsSync(sessionPath)) {
    return null;
  }

  try {
    const turns = new Map<string, SessionTurnHistoryFallback>();
    let activeTurnId = "";
    for (const line of readFileSync(sessionPath, "utf8").split("\n")) {
      if (!line.trim()) {
        continue;
      }

      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry?.type === "event_msg") {
        const eventType = readString(entry?.payload?.type);
        if (eventType === "task_started") {
          activeTurnId = readString(entry?.payload?.turn_id);
          if (activeTurnId && !turns.has(activeTurnId)) {
            turns.set(activeTurnId, { fileChanges: [] });
          }
          continue;
        }

        if (eventType === "task_complete" && readString(entry?.payload?.turn_id) === activeTurnId) {
          activeTurnId = "";
        }
        continue;
      }

      if (!activeTurnId || entry?.type !== "response_item") {
        continue;
      }

      const payload = entry?.payload;
      if (readString(payload?.type) !== "custom_tool_call" || readString(payload?.name) !== "apply_patch") {
        continue;
      }

      const fallback = turns.get(activeTurnId) ?? { fileChanges: [] };
      fallback.fileChanges = mergeFileChangeSummaries(
        fallback.fileChanges,
        parseApplyPatchFileChanges(readString(payload?.input), cwd)
      );
      turns.set(activeTurnId, fallback);
    }

    const allFileChanges = [...turns.values()].flatMap((entry) => entry.fileChanges);
    return {
      turns,
      totalDiff: summarizeDiffStats(allFileChanges),
    } satisfies SessionHistoryFallback;
  } catch {
    return null;
  }
}

function readThreadDiffFromGit(cwd: string): DiffStats | null {
  const existingDir = cwd ? findNearestExistingDirectory(cwd) : null;
  if (!existingDir) {
    return null;
  }

  const insideRepo = gitSpawnSync(["rev-parse", "--is-inside-work-tree"], existingDir);
  if (!insideRepo.ok || insideRepo.stdout !== "true") {
    return null;
  }

  const diffResult = gitSpawnSync(["diff", "--numstat", "--find-renames", "--no-ext-diff", "HEAD"], existingDir);
  if (!diffResult.ok) {
    return null;
  }

  const diff = diffResult.stdout.split("\n").reduce(
    (stats, line) => {
      const [additions, deletions] = line.split("\t");
      if (/^\d+$/.test(additions || "")) {
        stats.additions += Number(additions);
      }
      if (/^\d+$/.test(deletions || "")) {
        stats.deletions += Number(deletions);
      }
      return stats;
    },
    { additions: 0, deletions: 0 } satisfies DiffStats
  );

  const untrackedResult = gitSpawnSync(["ls-files", "--others", "--exclude-standard"], existingDir);
  if (untrackedResult.ok) {
    for (const relativePath of untrackedResult.stdout.split("\n").filter(Boolean)) {
      diff.additions += countReadableFileLines(resolve(existingDir, relativePath));
    }
  }

  return diff;
}

function parseApplyPatchFileChanges(patch: string, cwd: string) {
  const fileChanges: FileChangeSummary[] = [];
  let currentChange: FileChangeSummary | null = null;

  const pushCurrentChange = () => {
    if (currentChange) {
      fileChanges.push(currentChange);
      currentChange = null;
    }
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("*** Update File: ")) {
      pushCurrentChange();
      currentChange = {
        action: "Edited",
        path: normalizePatchDisplayPath(line.slice("*** Update File: ".length), cwd),
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      pushCurrentChange();
      currentChange = {
        action: "Created",
        path: normalizePatchDisplayPath(line.slice("*** Add File: ".length), cwd),
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      pushCurrentChange();
      currentChange = {
        action: "Deleted",
        path: normalizePatchDisplayPath(line.slice("*** Delete File: ".length), cwd),
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (line.startsWith("*** Move to: ") && currentChange) {
      currentChange = {
        ...currentChange,
        action: "Moved",
        path: `${currentChange.path} -> ${normalizePatchDisplayPath(line.slice("*** Move to: ".length), cwd)}`,
      };
      continue;
    }

    if (!currentChange || !line) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentChange.additions += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      currentChange.deletions += 1;
    }
  }

  pushCurrentChange();
  return mergeFileChangeSummaries([], fileChanges);
}

function normalizePatchDisplayPath(rawPath: string, cwd: string) {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return trimmed;
  }

  const normalizedCwd = cwd ? normalizeComparablePath(cwd) : "";
  const absolutePath = isAbsolute(trimmed)
    ? normalizeComparablePath(trimmed)
    : normalizeComparablePath(resolve(cwd || DEFAULT_THREAD_CWD, trimmed));
  const relativePath = normalizedCwd ? relative(normalizedCwd, absolutePath) : trimmed;
  return relativePath && !relativePath.startsWith("..") ? relativePath || basename(absolutePath) : trimmed;
}

function mergeFileChangeSummaries(existing: FileChangeSummary[], incoming: FileChangeSummary[]) {
  const merged = new Map<string, FileChangeSummary>();
  for (const change of [...existing, ...incoming]) {
    const key = `${change.action}:${change.path}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...change });
      continue;
    }
    current.additions += change.additions;
    current.deletions += change.deletions;
  }
  return [...merged.values()];
}

function summarizeDiffStats(fileChanges: FileChangeSummary[]) {
  return fileChanges.reduce(
    (stats, change) => {
      stats.additions += change.additions;
      stats.deletions += change.deletions;
      return stats;
    },
    { additions: 0, deletions: 0 } satisfies DiffStats
  );
}

function hasDiffStats(diff: DiffStats | null | undefined) {
  return Boolean(diff && (diff.additions > 0 || diff.deletions > 0));
}

function countReadableFileLines(filePath: string) {
  try {
    return readFileSync(filePath, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

function normalizeComparablePath(filePath: string) {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function dedupeMessages(messages: ThreadMessage[]) {
  return dedupeThreadMessages(messages);
}

function hasMessageId(turns: any, messageId: string) {
  if (!Array.isArray(turns) || !messageId) {
    return false;
  }
  return turns.some((turn) =>
    Array.isArray(turn?.items) && turn.items.some((item: any) => readString(item?.id) === messageId)
  );
}

function hasImageCard(message: ThreadMessage) {
  return Boolean(message.cards?.some((card) => card.type === "image"));
}

function preserveImagePreviewFromMessage(previousMessage: ThreadMessage | undefined, nextMessage: ThreadMessage) {
  if (!previousMessage?.cards?.length || !nextMessage.cards?.length) {
    return nextMessage;
  }

  const previousImageCards = previousMessage.cards.filter(
    (card): card is ImageMessageCard => card.type === "image" && Boolean(card.imageUrl)
  );
  if (!previousImageCards.length) {
    return nextMessage;
  }

  let changed = false;
  const nextCards = nextMessage.cards.map((card) => {
    if (card.type !== "image" || card.imageUrl) {
      return card;
    }

    const matchingCard =
      previousImageCards.find((entry) => entry.path === card.path && entry.imageUrl)
      ?? previousImageCards.find((entry) => entry.meta === card.meta && entry.imageUrl)
      ?? previousImageCards[0];
    if (!matchingCard?.imageUrl) {
      return card;
    }

    changed = true;
    return {
      ...card,
      imageUrl: matchingCard.imageUrl,
    };
  });

  return changed
    ? {
        ...nextMessage,
        cards: nextCards,
      }
    : nextMessage;
}

function readUserItemText(item: any) {
  return readUserContentEntries(item)
    .filter(
      (entry) =>
        (entry?.type === "text" || entry?.type === "input_text") &&
        typeof entry.text === "string" &&
        entry.text.trim() !== "<image>"
    )
    .map((entry) => entry.text)
    .join("\n\n")
    .trim();
}

function readUserItemImages(item: any): InputImageAttachment[] {
  return readUserContentEntries(item)
    .filter((entry) => entry?.type === "input_image" || entry?.type === "image")
    .map((entry) => ({
      imageUrl: readString(entry?.image_url) || readString(entry?.url) || undefined,
      fileId: readString(entry?.file_id) || readString(entry?.fileId) || undefined,
      detail: readImageDetail(entry?.detail),
    }))
    .filter((entry) => Boolean(entry.imageUrl || entry.fileId));
}

function readImageArtifactPreview(imagePath: string) {
  if (!imagePath || !existsSync(imagePath)) {
    return undefined;
  }

  let imageStat;
  try {
    imageStat = statSync(imagePath);
  } catch {
    return undefined;
  }

  if (!imageStat.isFile() || imageStat.size > MAX_IMAGE_ARTIFACT_PREVIEW_BYTES) {
    return undefined;
  }

  const mimeType = readSupportedImageMimeType(imagePath);
  if (!mimeType) {
    return undefined;
  }

  try {
    const imageBuffer = readFileSync(imagePath);
    return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function resolveArtifactPath(filePath: string, cwd: string) {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("~/")) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return isAbsolute(trimmed) ? trimmed : resolve(cwd || DEFAULT_THREAD_CWD, trimmed);
}

function readSupportedImageMimeType(imagePath: string) {
  switch (extname(imagePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    default:
      return undefined;
  }
}

function readUserContentEntries(item: any) {
  return Array.isArray(item?.content) ? item.content : [];
}

function normalizeInputImages(images: InputImageAttachment[] | undefined) {
  return (images ?? [])
    .map((image) => ({
      imageUrl: readString(image.imageUrl) || undefined,
      fileId: readString(image.fileId) || undefined,
      name: readString(image.name) || undefined,
      mimeType: readString(image.mimeType) || undefined,
      detail: readImageDetail(image.detail),
    }))
    .filter((image) => Boolean(image.imageUrl || image.fileId));
}

function readImageDetail(value: unknown): InputImageAttachment["detail"] {
  return value === "low" || value === "high" || value === "auto" ? value : undefined;
}

function summarizeMessagePreview(text: string, images: InputImageAttachment[] | undefined) {
  const trimmed = text.trim();
  if (trimmed) {
    return trimmed;
  }
  if ((images?.length ?? 0) === 1) {
    return "Sent an image";
  }
  if ((images?.length ?? 0) > 1) {
    return `Sent ${images!.length} images`;
  }
  return "";
}

function buildTurnInput(text: string, images: InputImageAttachment[]) {
  const input: Array<Record<string, string>> = [];
  if (text) {
    input.push({ type: "text", text });
  }
  for (const image of images) {
    if (image.fileId) {
      input.push({
        type: "image",
        fileId: image.fileId,
        ...(image.detail ? { detail: image.detail } : {}),
      });
      continue;
    }
    if (image.imageUrl) {
      input.push({
        type: "image",
        url: image.imageUrl,
        ...(image.detail ? { detail: image.detail } : {}),
      });
    }
  }
  return input;
}

function mapCommandExecutionMessage(item: any, itemId: string, createdAt: string, stage: "history" | "started" | "completed") {
  const status = normalizeExecutionStatus(readString(item?.status), stage);
  const exitCode = readNumber(item?.exitCode);
  const action = summarizeCommandAction(Array.isArray(item?.commandActions) ? item.commandActions[0] : null);
  const cwd = readString(item?.cwd);
  const durationMs = readNumber(item?.durationMs);
  const output = summarizeCommandOutput(readString(item?.aggregatedOutput), action.type);

  return {
    id: itemId,
    role: "system",
    kind: "status",
    text: "",
    createdAt,
    cards: [
      {
        type: "command",
        title: action.title,
        command: action.showCommand ? readString(item?.command) : undefined,
        statusLabel: humanizeExecutionStatus(status, exitCode),
        tone: executionTone(status, exitCode),
        detail: action.detail,
        meta: buildExecutionMeta(cwd, durationMs, exitCode),
        output: output || undefined,
      },
    ],
  } satisfies ThreadMessage;
}

function mapFileChangeMessage(item: any, itemId: string, createdAt: string) {
  const rawChanges = Array.isArray(item?.changes) ? item.changes : [];
  const fileChanges = rawChanges
    .map(mapFileChangeSummary)
    .filter((change): change is FileChangeSummary => Boolean(change));
  const changeSummary = summarizeFileChanges(fileChanges);

  return {
    id: itemId,
    role: "system",
    kind: "status",
    text: "",
    createdAt,
    cards: [
      {
        type: "status",
        title: changeSummary.title,
        detail: changeSummary.detail,
        tone: "blue",
      },
    ],
    fileChanges: fileChanges.length ? fileChanges : undefined,
  } satisfies ThreadMessage;
}

function mapWebSearchMessage(item: any, itemId: string, createdAt: string) {
  const query = readString(item?.query) || readString(item?.action?.query);
  const queries = Array.isArray(item?.action?.queries)
    ? item.action.queries.map((entry: unknown) => readString(entry)).filter(Boolean)
    : [];
  const output = truncateText(queries.join("\n"), 6, 600);

  return {
    id: itemId,
    role: "system",
    kind: "status",
    text: "",
    createdAt,
    cards: [
      {
        type: "tool",
        title: "Web search",
        toolLabel: "search",
        statusLabel: "Completed",
        tone: "blue",
        detail: query || "Search query prepared",
        meta: queries.length ? `${queries.length} queries` : undefined,
        output: output || undefined,
      },
    ],
  } satisfies ThreadMessage;
}

function mapMcpToolCallMessage(item: any, itemId: string, createdAt: string) {
  const server = readString(item?.server);
  const tool = readString(item?.tool);
  const status = normalizeExecutionStatus(readString(item?.status), "history");
  const durationMs = readNumber(item?.durationMs);
  const output = truncateText(readToolResultText(item?.result), 8, 900);
  const argumentPreview = stringifyPreview(item?.arguments);

  return {
    id: itemId,
    role: "system",
    kind: "status",
    text: "",
    createdAt,
    cards: [
      {
        type: "tool",
        title: server ? `MCP · ${server}` : "MCP tool",
        toolLabel: tool || "tool",
        statusLabel: humanizeExecutionStatus(status, null),
        tone: executionTone(status, item?.error ? 1 : 0),
        detail: argumentPreview || undefined,
        meta: durationMs != null ? `${durationMs}ms` : undefined,
        output: output || undefined,
      },
    ],
  } satisfies ThreadMessage;
}

function mapCollabAgentToolCallMessage(item: any, itemId: string, createdAt: string) {
  const tool = readString(item?.tool) || "spawnAgent";
  const receiverThreadIds = Array.isArray(item?.receiverThreadIds) ? item.receiverThreadIds.filter(Boolean) : [];
  const prompt = truncateText(readString(item?.prompt), 5, 420);
  const meta = [readString(item?.model), readString(item?.reasoningEffort)].filter(Boolean).join(" · ");
  const status = normalizeExecutionStatus(readString(item?.status), "history");
  const agentStatuses = summarizeAgentStatuses(item?.agentsStates);

  return {
    id: itemId,
    role: "system",
    kind: "status",
    text: "",
    createdAt,
    cards: [
      {
        type: "tool",
        title: receiverThreadIds.length > 1 ? `Spawned ${receiverThreadIds.length} subagents` : "Spawned subagent",
        toolLabel: tool,
        statusLabel: humanizeExecutionStatus(status, null),
        tone: executionTone(status, null),
        detail: prompt || "Delegated work to a background agent.",
        meta: [meta, agentStatuses].filter(Boolean).join(" · ") || undefined,
      },
    ],
  } satisfies ThreadMessage;
}

function mapFileChangeSummary(change: any) {
  const originalPath = readString(change?.path);
  if (!originalPath) {
    return null;
  }

  const movePath = readString(change?.kind?.move_path);
  const diff = readString(change?.diff);
  const stats = diff ? parseUnifiedDiffStats(diff) : { additions: 0, deletions: 0 };
  const kind = readString(change?.kind?.type);

  return {
    action: movePath ? "Moved" : kind === "add" ? "Created" : kind === "delete" ? "Deleted" : "Edited",
    path: movePath ? `${originalPath} -> ${movePath}` : originalPath,
    additions: stats.additions,
    deletions: stats.deletions,
  } satisfies FileChangeSummary;
}

function summarizeFileChanges(changes: FileChangeSummary[]) {
  if (!changes.length) {
    return {
      title: "Workspace updated",
      detail: "Codex applied file changes in this thread.",
    };
  }

  const totalAdditions = changes.reduce((sum, change) => sum + change.additions, 0);
  const totalDeletions = changes.reduce((sum, change) => sum + change.deletions, 0);
  return {
    title: changes.length === 1 ? changes[0].action : `Updated ${changes.length} files`,
    detail: `+${totalAdditions} -${totalDeletions}`,
  };
}

function parseUnifiedDiffStats(diff: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function summarizeCommandAction(action: any) {
  const type = readString(action?.type);
  const name = readString(action?.name);
  const path = readString(action?.path);
  const query = readString(action?.query);

  if (type === "read") {
    return {
      type,
      title: name ? `Read ${name}` : "Read file",
      detail: path || undefined,
      showCommand: false,
    };
  }

  if (type === "search") {
    return {
      type,
      title: "Search project",
      detail: query || path || undefined,
      showCommand: false,
    };
  }

  if (type === "list_files") {
    return {
      type,
      title: "List files",
      detail: path || undefined,
      showCommand: false,
    };
  }

  return {
    type: type || "command",
    title: "Executed command",
    detail: path || undefined,
    showCommand: true,
  };
}

function normalizeExecutionStatus(status: string, stage: "history" | "started" | "completed") {
  if (status === "completed" || status === "failed" || status === "running") {
    return status;
  }
  if (status === "inProgress" || status === "pending") {
    return "running";
  }
  if (stage === "started") {
    return "running";
  }
  return "completed";
}

function humanizeExecutionStatus(status: string, exitCode: number | null) {
  if (status === "running") {
    return "Running";
  }
  if (status === "failed" || exitCode != null && exitCode !== 0) {
    return "Failed";
  }
  return "Completed";
}

function executionTone(status: string, exitCode: number | null): "amber" | "blue" | "green" | "rose" | "slate" {
  if (status === "running") {
    return "amber";
  }
  if (status === "failed" || exitCode != null && exitCode !== 0) {
    return "rose";
  }
  return "green";
}

function buildExecutionMeta(cwd: string, durationMs: number | null, exitCode: number | null) {
  const parts = [];
  if (cwd) {
    parts.push(basename(cwd) || cwd);
  }
  if (durationMs != null) {
    parts.push(`${durationMs}ms`);
  }
  if (exitCode != null) {
    parts.push(`exit ${exitCode}`);
  }
  return parts.join(" · ") || undefined;
}

function truncateText(value: string, maxLines: number, maxChars: number) {
  if (!value) {
    return "";
  }

  const lines = value.trim().split("\n");
  const clippedLines = lines.slice(0, maxLines).join("\n");
  if (clippedLines.length <= maxChars && lines.length <= maxLines) {
    return clippedLines;
  }
  return `${clippedLines.slice(0, maxChars).trimEnd()}\n…`;
}

function summarizeCommandOutput(output: string, actionType: string) {
  if (!output) {
    return "";
  }
  if (actionType === "read") {
    return "";
  }
  if (actionType === "search") {
    return truncateText(output, 4, 360);
  }
  if (actionType === "list_files") {
    return truncateText(output, 4, 280);
  }
  return truncateText(output, 6, 520);
}

function readToolResultText(result: any) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .map((entry) => entry?.type === "text" && typeof entry.text === "string" ? entry.text : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function stringifyPreview(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return truncateText(value, 3, 240);
  }
  try {
    const json = JSON.stringify(value);
    return json === "{}" ? "" : truncateText(json, 3, 240);
  } catch {
    return "";
  }
}

function summarizeAgentStatuses(agentsStates: any) {
  if (!agentsStates || typeof agentsStates !== "object") {
    return "";
  }
  const values = Object.values(agentsStates as Record<string, any>)
    .map((entry) => readString(entry?.status))
    .filter(Boolean);
  if (!values.length) {
    return "";
  }
  const unique = [...new Set(values)];
  return unique.join(", ");
}

function deriveRequestedTurnMode(text: string, planArmed: boolean) {
  if (planArmed || isPlanPrompt(text)) {
    return "plan" as const;
  }
  return "chat" as const;
}

function deriveTurnModeFromItems(items: any[]) {
  const userMessage = items.find((item) => item?.type === "userMessage");
  return deriveRequestedTurnMode(readUserItemText(userMessage), false);
}

function isPlanPrompt(text: string) {
  return text.trim().toLowerCase().startsWith("/plan");
}

function normalizeModel(model: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized === "gpt-5.5") {
    return "gpt-5.5";
  }
  if (normalized === "gpt-5.4 mini") {
    return "gpt-5.4-mini";
  }
  if (normalized === "gpt-5.4") {
    return "gpt-5.4";
  }
  if (normalized === "o4-mini") {
    return "o4-mini";
  }
  return normalized || "gpt-5.4";
}

function shouldRetryTurnStartWithoutServiceTier(error: unknown) {
  const code = (error as Error & { code?: unknown })?.code;
  if (code !== -32600 && code !== -32602) {
    return false;
  }

  const message = readErrorMessage(error).toLowerCase();
  return message.includes("servicetier")
    || message.includes("service tier")
    || message.includes("unknown field")
    || message.includes("unexpected field")
    || message.includes("unrecognized field")
    || message.includes("invalid param")
    || message.includes("invalid params");
}

function isRetryableCodexBackpressureError(error: unknown) {
  const code = (error as (Error & { code?: unknown }) | null)?.code;
  const message = readErrorMessage(error).toLowerCase();
  return code === -32001 || (message.includes("server overloaded") && message.includes("retry"));
}

function isTurnSteerUnsupportedError(error: unknown) {
  const code = (error as (Error & { code?: unknown }) | null)?.code;
  const message = readErrorMessage(error).toLowerCase();
  return (
    code === -32601 ||
    message.includes("method not found") ||
    message.includes("unknown method") ||
    (message.includes("turn/steer") && message.includes("not found"))
  );
}

function shouldQueueAfterTurnSteerFailure(error: unknown) {
  const message = readErrorMessage(error).toLowerCase();
  return (
    isTurnSteerUnsupportedError(error) ||
    message.includes("no active turn to steer") ||
    message.includes("expected active turn id") ||
    message.includes("cannot steer") ||
    message.includes("activeturnnotsteerable") ||
    message.includes("active turn not steerable")
  );
}

function isThreadNotFoundError(error: unknown) {
  const message = readErrorMessage(error).toLowerCase();
  return message.startsWith("thread not found")
    || message.startsWith("invalid thread id");
}

function isThreadNotLoadedError(error: unknown) {
  return readErrorMessage(error).toLowerCase().startsWith("thread not loaded");
}

function isThreadNotMaterializedError(error: unknown) {
  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes("not materialized yet") &&
    (message.includes("includeturns is unavailable") || message.includes("thread/turns/list is unavailable"))
  );
}

function isThreadTurnsListUnsupportedError(error: unknown) {
  const code = (error as (Error & { code?: unknown }) | null)?.code;
  const message = readErrorMessage(error).toLowerCase();
  return (
    code === -32601 ||
    message.includes("method not found") ||
    message.includes("unknown method") ||
    (message.includes("thread/turns/list") && message.includes("not found"))
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function handleMissingThread(userId: string | undefined, threadId: string, error: unknown) {
  if (!isThreadNotFoundError(error)) {
    return false;
  }
  console.warn(`[phodex] forgetting missing thread ${threadId}`);
  forgetThread(threadId, userId);
  return true;
}

function mapApprovalPolicy(accessMode: "read-only" | "on-request" | "full-access") {
  if (accessMode === "on-request") {
    return "on-request";
  }
  return "never";
}

function mapSandboxMode(accessMode: "read-only" | "on-request" | "full-access") {
  if (accessMode === "read-only") {
    return "read-only";
  }
  return "danger-full-access";
}

function writableRootForThread(thread: ThreadRecord) {
  return thread.repoLabel ? resolve(thread.repoLabel) : DEFAULT_THREAD_CWD;
}

function mapSandboxPolicy(accessMode: "read-only" | "on-request" | "full-access", writableRoot = DEFAULT_THREAD_CWD) {
  if (accessMode === "read-only") {
    return {
      type: "readOnly",
      access: {
        type: "fullAccess",
      },
      networkAccess: false,
    };
  }

  if (accessMode === "on-request") {
    return {
      type: "workspaceWrite",
      networkAccess: false,
      readOnlyAccess: {
        type: "fullAccess",
      },
      writableRoots: [writableRoot],
    };
  }

  return {
    type: "dangerFullAccess",
  };
}

function readThreadStatusType(state: ThreadRecord["state"]) {
  return state === "running" ? "active" : "idle";
}

function buildOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && DEV_ORIGINS.has(origin)) {
    return origin;
  }
  return `https://localhost:${PORT}`;
}

function withCors(req: Request, response: Response) {
  response.headers.set("access-control-allow-origin", buildOrigin(req));
  response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type,authorization");
  response.headers.set("access-control-allow-credentials", "true");
  return response;
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
  const sockets = clientsByUserId.get(ws.data.userId) ?? new Set<ServerWebSocket<SocketData>>();
  sockets.add(ws);
  clientsByUserId.set(ws.data.userId, sockets);
}

function unregisterSocket(ws: ServerWebSocket<SocketData>) {
  const sockets = clientsByUserId.get(ws.data.userId);
  sockets?.delete(ws);
  if (sockets && sockets.size === 0) {
    clientsByUserId.delete(ws.data.userId);
  }
}

function broadcastToAllUsers(event: ServerEvent) {
  const payload = JSON.stringify(event);
  for (const sockets of clientsByUserId.values()) {
    for (const socket of sockets) {
      socket.send(payload);
    }
  }
}

function broadcastSnapshotsToAllUsers() {
  sendBridgeState();
}

function broadcastBannersToAllUsers() {
  for (const user of bridgeUsers.values()) {
    sendUserPatch(user.profile.id, { banner: user.banner });
  }
}

function broadcastThreadToAllUsers(threadId: string, includeMessages = false) {
  const thread = threadCache.get(threadId);
  if (!thread) {
    return;
  }
  sendBridgeEvent({
    type: "bridge:thread:updated",
    thread: includeMessages ? thread : serializeThreadForSelections(thread, bridgeSelectedThreadIds()),
  });
}

function clearAllBanners() {
  for (const user of bridgeUsers.values()) {
    user.banner = null;
    sendUserPatch(user.profile.id, { banner: null });
  }
}

function publishPresenceToAllUsers() {
  const connection = buildConnection();
  sendBridgeEvent({ type: "bridge:presence", connection });
}

function sendToast(userId: string, tone: "info" | "success" | "error", message: string) {
  sendBridgeEvent({ type: "bridge:toast", tone, message, userId });
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

function sendClientMessageSendResult(
  ws: ServerWebSocket<SocketData>,
  event: Extract<ClientEvent, { type: "message:send" }>,
  result: MessageSendResult
) {
  if (result.ok) {
    sendEvent(ws, {
      type: "message:send-accepted",
      requestId: event.requestId,
      threadId: event.threadId,
      outcome: result.outcome,
    });
    return;
  }
  sendEvent(ws, {
    type: "message:send-failed",
    requestId: event.requestId,
    threadId: event.threadId,
    message: result.message,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function serveStatic(pathname: string) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(distDir, `.${safePath}`);
  if (filePath.startsWith(distDir) && existsSync(filePath)) {
    return new Response(Bun.file(filePath));
  }

  const indexPath = resolve(distDir, "index.html");
  if (existsSync(indexPath)) {
    return new Response(Bun.file(indexPath), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response(
    "Web bundle not found. Run `bun run build:web` from the project root, then restart the Bun server.",
    { status: 503 }
  );
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
        threadLocal: {},
      };
    }

    const parsed = JSON.parse(readFileSync(dataFile, "utf8")) as Partial<PersistedState>;
    return {
      users: parsed.users ?? {},
      sessions: parsed.sessions ?? {},
      threadLocal: parsed.threadLocal ?? {},
    };
  } catch {
    return {
      users: {},
      sessions: {},
      threadLocal: {},
    };
  }
}

function ensureLocalTls() {
  mkdirSync(certDir, { recursive: true });
  const keyPath = resolve(certDir, "localhost-key.pem");
  const certPath = resolve(certDir, "localhost-cert.pem");

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    const result = spawnSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "3650",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ]);

    if (result.status !== 0) {
      throw new Error(`Failed to generate local TLS certificate: ${result.stderr?.toString() || "openssl failed"}`);
    }
  }

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}

function resolveCodexBinary() {
  if (process.env.PHODEX_CODEX_BIN) {
    return process.env.PHODEX_CODEX_BIN;
  }

  const home = process.env.HOME ?? "";
  const candidates = [
    "/Applications/Codex.app/Contents/Resources/codex",
    resolve(home, ".bun/install/global/node_modules/@openai/codex/bin/codex.js"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

async function probeCodexReady() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    const response = await fetch(CODEX_READY_URL, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCodexReady(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeCodexReady()) {
      return true;
    }
    await Bun.sleep(250);
  }
  return false;
}

function startManagedCodexProcess() {
  if (codexProcess || !CODEX_BIN) {
    return;
  }

  const args = CODEX_BIN.endsWith(".js")
    ? [CODEX_BIN, "app-server", "--listen", CODEX_WS_URL]
    : ["app-server", "--listen", CODEX_WS_URL];
  const command = CODEX_BIN.endsWith(".js") ? "node" : CODEX_BIN;

  codexProcess = spawn(command, args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  codexProcess.stdout.on("data", (chunk) => {
    const output = chunk.toString("utf8").trim();
    if (output) {
      console.log(`[codex] ${output}`);
    }
  });

  codexProcess.stderr.on("data", (chunk) => {
    const output = chunk.toString("utf8").trim();
    if (output) {
      console.error(`[codex] ${output}`);
    }
  });

  codexProcess.on("exit", (code, signal) => {
    console.warn(`[phodex] Codex app-server exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    codexProcess = null;
    scheduleCodexReconnect();
  });

  codexProcess.on("error", (error) => {
    console.error(`[phodex] Failed to spawn Codex app-server: ${error.message}`);
    codexProcess = null;
    scheduleCodexReconnect();
  });
}

function shutdownCodexBridge() {
  clearRelayReconnectTimer();
  clearCodexReconnectTimer();
  if (relaySocket && (relaySocket.readyState === WebSocket.OPEN || relaySocket.readyState === WebSocket.CONNECTING)) {
    relaySocket.close();
  }
  relaySocket = null;
  if (codexSocket && (codexSocket.readyState === WebSocket.OPEN || codexSocket.readyState === WebSocket.CONNECTING)) {
    codexSocket.close();
  }
  codexSocket = null;
  if (codexProcess && !codexProcess.killed) {
    codexProcess.kill("SIGTERM");
  }
}

function scheduleCodexReconnect() {
  if (codexReconnectTimer) {
    return;
  }

  codexReconnectTimer = setTimeout(() => {
    codexReconnectTimer = null;
    void ensureCodexBridge();
  }, 1_500);
}

function clearCodexReconnectTimer() {
  if (!codexReconnectTimer) {
    return;
  }
  clearTimeout(codexReconnectTimer);
  codexReconnectTimer = null;
}

function setCodexConnectionState(nextState: RelayConnection["state"]) {
  codexConnectionState = nextState;
}

function isCodexReady() {
  return codexConnectionState === "connected" && codexSocket?.readyState === WebSocket.OPEN;
}

function ensureCodexReady() {
  if (!isCodexReady()) {
    throw new Error("Local Codex CLI service is not connected yet.");
  }
}

type CodexRequestOptions = {
  allowBeforeReady?: boolean;
  timeoutMs?: number;
};

type CodexRequestRetryOptions = CodexRequestOptions & {
  retries?: number;
  retryBaseDelayMs?: number;
};

async function codexRequestWithRetry(method: string, params: unknown, options: CodexRequestRetryOptions = {}) {
  const retries = Math.max(0, options.retries ?? 0);
  const retryBaseDelayMs = Math.max(100, options.retryBaseDelayMs ?? 750);
  let attempt = 0;

  while (true) {
    try {
      return await codexRequest(method, params, options);
    } catch (error) {
      if (attempt >= retries || !isRetryableCodexBackpressureError(error)) {
        throw error;
      }
      const delayMs = retryBaseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250);
      logFlowTrace("codex.request.retry", {
        method,
        attempt: attempt + 1,
        delayMs,
        message: readErrorMessage(error),
      });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

function codexRequest(method: string, params: unknown, options: CodexRequestOptions = {}) {
  if (!options.allowBeforeReady) {
    ensureCodexReady();
  } else if (!codexSocket || codexSocket.readyState !== WebSocket.OPEN) {
    throw new Error("Codex app-server websocket is not open.");
  }

  const requestId = `phodex-${++codexRequestSeq}`;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    method,
    params,
  });

  return new Promise<any>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      codexRequestWaiters.delete(requestId);
      rejectPromise(new Error(`Codex request timed out: ${method}`));
    }, options.timeoutMs ?? CODEX_REQUEST_TIMEOUT_MS);

    codexRequestWaiters.set(requestId, {
      method,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
    });

    codexSocket!.send(payload);
  });
}

function sendCodexNotification(method: string, params?: unknown) {
  if (!codexSocket || codexSocket.readyState !== WebSocket.OPEN) {
    return;
  }
  codexSocket.send(JSON.stringify({
    jsonrpc: "2.0",
    method,
    ...(params == null ? {} : { params }),
  }));
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIsoFromEpoch(value: unknown) {
  const seconds = readNumber(value);
  if (seconds == null) {
    return null;
  }
  return new Date(seconds * 1_000).toISOString();
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}
