import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  AppSettings,
  AppSnapshot,
  AuthSession,
  BridgeProjectRequest,
  BridgeCommand,
  BridgeDispatchEvent,
  BridgeEvent,
  ClientEvent,
  CompletionBanner,
  DeliveryMode,
  DiffStats,
  FileChangeSummary,
  ProjectDiffFile,
  ProjectDiffPayload,
  ProjectFilePayload,
  ProjectResourcePayload,
  ProjectTreeEntry,
  ProjectTreePayload,
  QueuedDraft,
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

type ThreadLocalState = {
  customTitle?: string;
  queuedDrafts: QueuedDraft[];
  diff: DiffStats;
};

type PersistedState = {
  users: Record<string, PersistedUser>;
  sessions: Record<string, SessionRecord>;
  otpCodes: Record<string, OtpRecord>;
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
  startedAt: string;
  mode: "chat" | "plan";
};

type ThreadListResponse = {
  data: any[];
  nextCursor: string | null;
};

type SessionTurnHistoryFallback = {
  fileChanges: FileChangeSummary[];
};

type SessionHistoryFallback = {
  turns: Map<string, SessionTurnHistoryFallback>;
  totalDiff: DiffStats;
};

type OtpMailConfig = {
  resendApiKey: string;
  authEmailFrom: string;
  sourceLabel: string;
};

type ThreadCreateRequest = Extract<ClientEvent, { type: "thread:create" }>;

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
const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAC_LABEL = process.env.PHODEX_MAC_LABEL ?? hostname();
const RELAY_LABEL = process.env.PHODEX_RELAY_LABEL ?? "Phodex Public Relay";
const PUBLIC_RELAY_URL = process.env.PHODEX_RELAY_URL ?? "ws://127.0.0.1:3443";
const BRIDGE_TOKEN = process.env.PHODEX_BRIDGE_TOKEN?.trim() ?? "";
const LEGACY_BRIDGE_SECRET = process.env.PHODEX_BRIDGE_SECRET?.trim() ?? "";
const BRIDGE_RECONNECT_MS = Number(process.env.PHODEX_BRIDGE_RECONNECT_MS ?? "1500");
const AUTH_ENV_FALLBACK_FILE =
  process.env.PHODEX_AUTH_ENV_FILE ?? "/Users/young/mx/tmp/remote-terminal/.env.cloudflare";
const DEFAULT_THREAD_CWD = process.env.PHODEX_DEFAULT_CWD ?? appRoot;
const PROJECTS_ROOT = process.env.PHODEX_PROJECTS_ROOT ?? resolve(homedir(), ".phodex-web/projects");
const WORKTREE_ROOT = process.env.PHODEX_WORKTREE_ROOT ?? resolve(homedir(), ".codex/worktrees");
const CODEX_WS_URL = process.env.PHODEX_CODEX_WS_URL ?? "ws://127.0.0.1:8765";
const CODEX_READY_URL = CODEX_WS_URL.replace(/^ws/i, "http") + "/readyz";
const MANAGE_CODEX = process.env.PHODEX_MANAGE_CODEX !== "false";
const CODEX_BIN = resolveCodexBinary();
const OTP_MAIL_CONFIG = resolveOtpMailConfig();
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
const legacyOtpCodesPruned = pruneLegacyOtpCodes();
const clientsByUserId = new Map<string, Set<ServerWebSocket<SocketData>>>();
const bridgeUsers = new Map<string, PersistedUser>();
const threadCache = new Map<string, ThreadRecord>();
const activeTurns = new Map<string, ActiveTurnState>();
const pendingTurnModes = new Map<string, "chat" | "plan">();
const codexRequestWaiters = new Map<string, PendingCodexRequest>();
const projectContextCache = new Map<string, ProjectContext>();

let codexProcess: ChildProcessWithoutNullStreams | null = null;
let codexSocket: WebSocket | null = null;
let codexReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let relaySocket: WebSocket | null = null;
let relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let codexConnectionState: RelayConnection["state"] = "connecting";
let codexLastSyncAt: string | null = null;
let codexRequestSeq = 0;
let threadSyncInFlight: Promise<void> | null = null;
let codexSupportsServiceTier = true;
let serviceTierUnsupportedToastSent = false;
void ensureCodexBridge();
connectRelaySocket();

console.log(`[phodex-bridge] Local bridge starting for ${PUBLIC_RELAY_URL}`);
console.log(`[phodex-bridge] Codex target ${CODEX_WS_URL}`);
if (legacyOtpCodesPruned) {
  schedulePersist();
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
        console.error(`[phodex-bridge] sync-thread failed: ${readErrorMessage(error)}`);
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

async function readProjectResource(request: BridgeProjectRequest): Promise<ProjectResourcePayload> {
  const thread = threadCache.get(request.threadId);
  if (!thread) {
    throw new ProjectResourceError(404, "Thread not found.");
  }

  const rootPath = normalizeComparablePath(resolve(thread.repoLabel || DEFAULT_THREAD_CWD));
  if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    throw new ProjectResourceError(404, "Project root is unavailable.");
  }

  switch (request.kind) {
    case "tree":
      return readProjectTree(rootPath, request.path);
    case "file":
      return readProjectFile(rootPath, request.path);
    case "diff":
      return readProjectDiff(rootPath, request.path);
  }
}

function readProjectTree(rootPath: string, rawPath: string | undefined) {
  const resolved = resolveProjectPathWithinRoot(rootPath, rawPath ?? ".");
  const directoryStat = statSync(resolved.absolutePath);
  if (!directoryStat.isDirectory()) {
    throw new ProjectResourceError(400, "Tree path must point to a directory.");
  }

  const entries: ProjectTreeEntry[] = readdirSync(resolved.absolutePath, { withFileTypes: true })
    .map((entry) => {
      const entryAbsolutePath = resolve(resolved.absolutePath, entry.name);
      const entryStat = statSync(entryAbsolutePath);
      return {
        name: entry.name,
        path: relative(rootPath, entryAbsolutePath) || ".",
        kind: entryStat.isDirectory() ? "directory" : "file",
        size: entryStat.size,
        modifiedAt: entryStat.mtime.toISOString(),
      } satisfies ProjectTreeEntry;
    })
    .sort((left, right) => {
      const leftRank = left.kind === "directory" ? 0 : 1;
      const rightRank = right.kind === "directory" ? 0 : 1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.name.localeCompare(right.name);
    });

  return {
    kind: "tree",
    root: rootPath,
    path: resolved.relativePath,
    entries,
  } satisfies ProjectTreePayload;
}

function readProjectFile(rootPath: string, rawPath: string) {
  const resolved = resolveProjectPathWithinRoot(rootPath, rawPath);
  const fileStat = statSync(resolved.absolutePath);
  if (fileStat.isDirectory()) {
    throw new ProjectResourceError(400, "File path must point to a file.");
  }

  const buffer = readFileSync(resolved.absolutePath);
  const fileKind = isProbablyBinaryBuffer(buffer) ? "binary" : "text";
  const response: ProjectFilePayload = {
    kind: "file",
    root: rootPath,
    path: resolved.relativePath,
    fileKind,
    encoding: fileKind === "binary" ? "none" : "utf-8",
    mimeType: guessMimeType(resolved.absolutePath, fileKind),
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
  };

  if (fileKind === "text") {
    const content = buffer.toString("utf8");
    if (buffer.length > PROJECT_FILE_PREVIEW_BYTES) {
      response.content = content.slice(0, PROJECT_FILE_PREVIEW_BYTES);
      response.truncated = true;
    } else {
      response.content = content;
    }
  }

  return response;
}

function readProjectDiff(rootPath: string, rawPath: string | null) {
  const resolved = rawPath == null ? null : resolveProjectPathWithinRoot(rootPath, rawPath, { mustExist: false });
  const relativePath = resolved?.relativePath ?? null;
  const args = ["diff", "--find-renames", "--no-ext-diff", "--no-color", "--unified=3", "HEAD"];
  if (relativePath && relativePath !== ".") {
    args.push("--", relativePath);
  } else if (rawPath !== null) {
    args.push("--", ".");
  }

  const diffResult = gitSpawnSync(args, rootPath);
  if (!diffResult.ok) {
    throw new ProjectResourceError(404, "Project diff is unavailable.");
  }

  const untrackedFiles = listUntrackedFiles(rootPath, relativePath);
  const patch = [diffResult.stdout.trim(), ...untrackedFiles.map((filePath) => buildUntrackedFileDiff(rootPath, filePath))].filter(Boolean).join("\n\n");
  const files = splitProjectDiffByFile(patch);
  const summary = files.reduce(
    (stats, file) => {
      stats.additions += file.additions;
      stats.deletions += file.deletions;
      return stats;
    },
    { additions: 0, deletions: 0 } satisfies DiffStats
  );

  return {
    kind: "diff",
    root: rootPath,
    path: relativePath,
    summary,
    files,
  } satisfies ProjectDiffPayload;
}

function listUntrackedFiles(rootPath: string, relativePath: string | null) {
  const args = ["ls-files", "--others", "--exclude-standard"];
  if (relativePath && relativePath !== ".") {
    args.push("--", relativePath);
  }
  const result = gitSpawnSync(args, rootPath);
  if (!result.ok || !result.stdout) {
    return [];
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function buildUntrackedFileDiff(rootPath: string, filePath: string) {
  const absolutePath = resolve(rootPath, filePath);
  if (!existsSync(absolutePath)) {
    return "";
  }

  const result = spawnSync("git", ["diff", "--no-ext-diff", "--no-color", "--unified=3", "--no-index", "--", "/dev/null", filePath], {
    cwd: rootPath,
    encoding: "utf8",
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    return "";
  }
  return (result.stdout || "").trim();
}

function splitProjectDiffByFile(diff: string) {
  const trimmed = diff.trim();
  if (!trimmed) {
    return [];
  }

  const chunks: string[][] = [];
  let current: string[] = [];
  for (const line of trimmed.split("\n")) {
    if (line.startsWith("diff --git ") && current.length) {
      chunks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) {
    chunks.push(current);
  }

  return chunks
    .map((lines) => {
      const patch = lines.join("\n").trim();
      const path = extractDiffPath(lines);
      if (!path || !patch) {
        return null;
      }
      return {
        path,
        action: detectDiffAction(lines),
        additions: countDiffAdditions(lines),
        deletions: countDiffDeletions(lines),
        patch,
      } satisfies ProjectDiffFile;
    })
    .filter((entry): entry is ProjectDiffFile => Boolean(entry));
}

function extractDiffPath(lines: string[]) {
  for (const line of lines) {
    if (line.startsWith("rename to ")) {
      return normalizeDiffPath(line.slice("rename to ".length));
    }
  }

  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      const path = normalizeDiffPath(line.slice(4));
      if (path && path !== "/dev/null") {
        return path;
      }
    }
  }

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const path = normalizeDiffPath(line.slice(4));
      if (path && path !== "/dev/null") {
        return path;
      }
    }
  }

  const gitHeader = lines.find((line) => line.startsWith("diff --git "));
  if (gitHeader) {
    const match = gitHeader.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match) {
      return normalizeDiffPath(match[2]);
    }
    const parts = gitHeader.split(" ");
    if (parts.length >= 4) {
      return normalizeDiffPath(parts[parts.length - 1]);
    }
  }

  return "";
}

function normalizeDiffPath(rawPath: string) {
  let value = rawPath.trim();
  if (value.startsWith("a/") || value.startsWith("b/")) {
    value = value.slice(2);
  }
  return value;
}

function detectDiffAction(lines: string[]) {
  if (lines.some((line) => line.startsWith("rename from ") || line.startsWith("rename to "))) {
    return "Moved" as const;
  }
  if (lines.some((line) => line.startsWith("new file mode ") || line === "--- /dev/null")) {
    return "Created" as const;
  }
  if (lines.some((line) => line.startsWith("deleted file mode ") || line === "+++ /dev/null")) {
    return "Deleted" as const;
  }
  return "Edited" as const;
}

function countDiffAdditions(lines: string[]) {
  return lines.reduce((total, line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return total + 1;
    }
    return total;
  }, 0);
}

function countDiffDeletions(lines: string[]) {
  return lines.reduce((total, line) => {
    if (line.startsWith("-") && !line.startsWith("---")) {
      return total + 1;
    }
    return total;
  }, 0);
}

function resolveProjectPathWithinRoot(rootPath: string, rawPath: string, options: { mustExist?: boolean } = {}) {
  const trimmed = rawPath.trim() || ".";
  const rootAbsolute = normalizeComparablePath(rootPath);
  const candidatePath = trimmed === "." ? rootAbsolute : resolve(rootAbsolute, trimmed);
  const existingAncestor = findNearestExistingPath(candidatePath);
  if (!existingAncestor) {
    throw new ProjectResourceError(404, "Path not found.");
  }

  const resolvedAncestor = normalizeComparablePath(existingAncestor);
  const relativeToAncestor = relative(existingAncestor, candidatePath);
  const absolutePath = relativeToAncestor ? resolve(resolvedAncestor, relativeToAncestor) : resolvedAncestor;
  if (!isPathInsideRoot(rootAbsolute, absolutePath)) {
    throw new ProjectResourceError(403, "Path must stay inside the thread project root.");
  }

  if (options.mustExist !== false && !existsSync(absolutePath)) {
    throw new ProjectResourceError(404, "Path not found.");
  }

  return {
    rootPath: rootAbsolute,
    absolutePath,
    relativePath: relative(rootAbsolute, absolutePath) || ".",
  };
}

function findNearestExistingPath(value: string) {
  let cursor = resolve(value);
  while (true) {
    if (existsSync(cursor)) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    cursor = parent;
  }
}

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isProbablyBinaryBuffer(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (!sample.length) {
    return false;
  }

  if (sample.includes(0)) {
    return true;
  }

  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.3;
}

function guessMimeType(filePath: string, fileKind: "text" | "binary") {
  if (fileKind === "binary") {
    return "application/octet-stream";
  }

  switch (extname(filePath).toLowerCase()) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".ts":
    case ".tsx":
    case ".jsx":
      return "text/plain; charset=utf-8";
    case ".yaml":
    case ".yml":
      return "text/yaml; charset=utf-8";
    case ".toml":
      return "text/plain; charset=utf-8";
    case ".sh":
      return "text/x-shellscript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "text/plain; charset=utf-8";
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
        user.selectedThreadId = command.event.threadId;
        sendUserPatch(user.profile.id, {
          selectedThreadId: command.event.threadId,
          banner: null,
        });
        await syncThreadFromCodex(command.event.threadId, true);
        return;
      case "thread:rename":
        await handleThreadRename(user, command.event.threadId, command.event.title);
        return;
      case "thread:archive":
        await handleThreadArchive(user, command.event.threadId);
        return;
      case "message:send":
        await handleMessageSend(user, command.event);
        return;
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
    sendToast(user.profile.id, "error", readErrorMessage(error));
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
  return [...threadCache.values()].sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt));
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

async function handleRequestCode(req: Request) {
  const body = await safeJson(req);
  const email = normalizeEmail(body?.email);
  if (!email) {
    return json({ ok: false, error: "A valid email is required." }, 400);
  }

  if (!OTP_MAIL_CONFIG) {
    return json({ ok: false, error: "OTP email delivery is not configured on this relay." }, 503);
  }

  const user = ensureUser(email);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const delivery: DeliveryMode = "resend";

  try {
    await deliverCode(email, code);
  } catch (error) {
    console.error(`[phodex] failed to deliver OTP for ${email}`, error);
    return json({ ok: false, error: "Unable to send verification code right now." }, 502);
  }

  persisted.otpCodes[email] = {
    code,
    expiresAt,
    delivery,
  };
  schedulePersist();

  const response: RequestCodeResponse = {
    ok: true,
    delivery,
    expiresInMs: OTP_TTL_MS,
  };

  console.log(`[phodex] issued OTP for ${user.profile.email} delivery=${delivery} expiresAt=${expiresAt}`);
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
  const validDynamicCode = record && record.delivery === "resend" && !otpExpired(record.expiresAt) && record.code === code;

  if (!validDynamicCode) {
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
          return syncThreadFromCodex(selectedThreadId, true);
        }
      }).catch((error) => {
        sendToast(user.profile.id, "error", readErrorMessage(error));
      });
      break;
    case "thread:create":
      void handleThreadCreate(user, event);
      break;
    case "thread:select":
      user.selectedThreadId = event.threadId;
      schedulePersist();
      sendEvent(ws, { type: "snapshot", snapshot: snapshotForUser(user.profile.id) });
      void syncThreadFromCodex(event.threadId, true).catch((error) => {
        sendToast(user.profile.id, "error", readErrorMessage(error));
      });
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
      void handleMessageSend(user, event);
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

async function handleThreadCreate(user: PersistedUser, event: ThreadCreateRequest) {
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

    const result = await codexRequest("thread/start", {
      cwd: threadCwd,
      model: "gpt-5.4",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      personality: "pragmatic",
    });
    const thread = mergeCodexThread(result.thread, false, false);
    threadCache.set(thread.id, thread);
    user.selectedThreadId = thread.id;
    sendUserPatch(user.profile.id, {
      selectedThreadId: thread.id,
      banner: null,
    });
    schedulePersist();
    broadcastThreadToAllUsers(thread.id);
    broadcastSnapshotsToAllUsers();
    codexLastSyncAt = new Date().toISOString();
    publishPresenceToAllUsers();
    void syncAllThreadsFromCodex();
  } catch (error) {
    sendToast(user.profile.id, "error", readErrorMessage(error));
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
    sendToast(user.profile.id, "error", readErrorMessage(error));
  }
}

async function handleMessageSend(user: PersistedUser, event: Extract<ClientEvent, { type: "message:send" }>) {
  const text = event.text.trim();
  if (!text) {
    sendToast(user.profile.id, "error", "Compose something first.");
    return;
  }

  try {
    ensureCodexReady();
    const thread = threadCache.get(event.threadId) ?? await syncThreadFromCodex(event.threadId, false);
    if (!thread) {
      sendToast(user.profile.id, "error", "Thread not found.");
      return;
    }

    if (thread.state === "running") {
      const local = ensureThreadLocal(thread.id);
      local.queuedDrafts.unshift({
        id: randomUUID(),
        text,
        createdAt: new Date().toISOString(),
        model: event.model,
        planArmed: event.planArmed,
        fastMode: event.fastMode,
        accessMode: event.accessMode,
      });
      thread.queuedDrafts = local.queuedDrafts;
      thread.state = "running";
      thread.preview = text;
      thread.lastActivityAt = new Date().toISOString();
      schedulePersist();
      broadcastThreadToAllUsers(thread.id);
      sendToast(user.profile.id, "info", "Draft queued while the current run finishes.");
      return;
    }

    user.selectedThreadId = thread.id;
    sendUserPatch(user.profile.id, {
      selectedThreadId: thread.id,
      banner: null,
    });
    markThreadRunning(thread.id, text);
    const turnMode = deriveRequestedTurnMode(text, event.planArmed);
    pendingTurnModes.set(thread.id, turnMode);
    schedulePersist();
    broadcastThreadToAllUsers(thread.id);
    broadcastSnapshotsToAllUsers();

    const turnResponse = await startTurn(thread, text, event, user.profile.id);
    const turnId = readString(turnResponse?.turn?.id);
    if (turnId) {
      activeTurns.set(thread.id, {
        userId: user.profile.id,
        threadId: thread.id,
        turnId,
        assistantMessageId: null,
        startedAt: new Date().toISOString(),
        mode: turnMode,
      });
      pendingTurnModes.delete(thread.id);
    }
    codexLastSyncAt = new Date().toISOString();
    publishPresenceToAllUsers();
  } catch (error) {
    const thread = threadCache.get(event.threadId);
    if (thread) {
      thread.state = deriveThreadState("idle", thread.id, thread.state === "archived");
      broadcastThreadToAllUsers(thread.id);
    }
    sendToast(user.profile.id, "error", readErrorMessage(error));
  }
}

async function handleDraftResume(user: PersistedUser, threadId: string, draftId: string) {
  const local = ensureThreadLocal(threadId);
  const draftIndex = local.queuedDrafts.findIndex((draft) => draft.id === draftId);
  if (draftIndex === -1) {
    return;
  }

  const [draft] = local.queuedDrafts.splice(draftIndex, 1);
  const thread = threadCache.get(threadId);
  if (thread) {
    thread.queuedDrafts = local.queuedDrafts;
    thread.state = deriveThreadState(readThreadStatusType(thread.state), threadId, thread.state === "archived");
    broadcastThreadToAllUsers(threadId);
  }
  schedulePersist();

  await handleMessageSend(user, {
    type: "message:send",
    threadId,
    text: draft.text,
    model: draft.model ?? "GPT-5.4",
    planArmed: draft.planArmed ?? false,
    fastMode: draft.fastMode ?? false,
    accessMode: draft.accessMode ?? "full-access",
  });
}

async function startTurn(
  thread: ThreadRecord,
  text: string,
  event: Extract<ClientEvent, { type: "message:send" }>,
  userId: string
) {
  const baseParams = {
    threadId: thread.id,
    input: [{ type: "text", text }],
    model: normalizeModel(event.model),
    approvalPolicy: mapApprovalPolicy(event.accessMode),
    sandboxPolicy: mapSandboxPolicy(event.accessMode, writableRootForThread(thread)),
  };

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
        sendToast(userId, "info", "Fast mode is unavailable on this Mac bridge yet. This run was sent normally.");
      }
      return await codexRequest("turn/start", baseParams);
    }
    throw error;
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
    await codexRequest("turn/interrupt", {
      threadId,
      turnId: activeTurn.turnId,
    });
    sendToast(userId, "info", "Interrupt sent to local Codex.");
  } catch (error) {
    sendToast(userId, "error", readErrorMessage(error));
  }
}

async function ensureCodexBridge() {
  clearCodexReconnectTimer();
  setCodexConnectionState("connecting");

  if (await probeCodexReady()) {
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
    case "error":
      console.error(`[phodex] Codex notification error: ${readString(params?.message) || "unknown error"}`);
      break;
  }

  codexLastSyncAt = new Date().toISOString();
  publishPresenceToAllUsers();
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
  activeTurns.set(threadId, {
    userId: activeTurns.get(threadId)?.userId ?? "",
    threadId,
    turnId,
    assistantMessageId: null,
    startedAt: thread.lastActivityAt,
    mode: activeTurns.get(threadId)?.mode ?? pendingTurnModes.get(threadId) ?? "chat",
  });
  broadcastThreadToAllUsers(threadId);
}

function handleItemStarted(params: any) {
  const threadId = readString(params?.threadId);
  const item = params?.item;
  if (!threadId || !item || typeof item !== "object") {
    return;
  }

  const startedAt = activeTurns.get(threadId)?.startedAt ?? new Date().toISOString();
  const message = mapLiveItemToMessage(
    item,
    startedAt,
    "started",
    activeTurns.get(threadId)?.mode ?? pendingTurnModes.get(threadId) ?? "chat"
  );
  if (!message) {
    return;
  }

  if (item.type === "agentMessage") {
    message.isStreaming = true;
    const activeTurn = activeTurns.get(threadId);
    if (activeTurn) {
      activeTurn.assistantMessageId = message.id;
    }
  }

  appendMessage(threadId, message);
  sendBridgeEvent({ type: "bridge:message:appended", threadId, message });
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
  sendBridgeEvent({ type: "bridge:message:delta", threadId, messageId, delta });
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
    activeTurns.get(threadId)?.mode ?? pendingTurnModes.get(threadId) ?? "chat"
  );
  if (!message) {
    return;
  }

  appendMessage(threadId, message);
  if (message.role === "assistant") {
    const liveMessage = thread.messages.find((entry) => entry.id === message.id);
    if (liveMessage) {
      liveMessage.isStreaming = false;
    }
    sendBridgeEvent({ type: "bridge:message:finished", threadId, messageId: message.id });
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
  activeTurns.delete(threadId);
  pendingTurnModes.delete(threadId);
  const thread = ensureThreadRecord(threadId);
  const local = ensureThreadLocal(threadId);
  thread.state = local.queuedDrafts.length > 0 ? "queued" : "idle";
  thread.lastActivityAt = new Date().toISOString();

  const banner: CompletionBanner = {
    id: randomUUID(),
    threadId,
    title: thread.title,
    subtitle: local.queuedDrafts.length > 0 ? "Run finished. One queued draft is ready." : "Run completed and synced.",
  };
  if (completedTurn?.userId) {
    sendUserPatch(completedTurn.userId, { banner });
  }
  schedulePersist();
  broadcastThreadToAllUsers(threadId);
  void syncThreadFromCodex(threadId, true);
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
  })().finally(() => {
    threadSyncInFlight = null;
  });

  return threadSyncInFlight;
}

async function syncThreadFromCodex(threadId: string, includeTurns: boolean) {
  if (!isCodexReady()) {
    return null;
  }

  const result = await codexRequest("thread/read", {
    threadId,
    includeTurns,
  });
  if (!result?.thread) {
    return null;
  }

  const archived = threadCache.get(threadId)?.state === "archived";
  const thread = mergeCodexThread(result.thread, archived, includeTurns);
  threadCache.set(thread.id, thread);
  codexLastSyncAt = new Date().toISOString();
  broadcastThreadToAllUsers(thread.id);
  publishPresenceToAllUsers();
  return thread;
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
  const mappedMessages = includeTurns && Array.isArray(rawThread?.turns)
    ? dedupeMessages([
        ...mapTurnsToMessages(rawThread.turns, sessionFallback?.turns),
        ...(activeTurns.has(threadId) ? (existing?.messages.filter((message) => message.isStreaming) ?? []) : []),
      ])
    : existing?.messages ?? [];

  return {
    id: threadId,
    title: local.customTitle || deriveThreadTitle(rawThread),
    preview: readString(rawThread?.preview) || existing?.preview || "Start a new remote coding pass.",
    projectLabel: deriveProjectLabel(rawThread),
    repoLabel,
    branch: readString(rawThread?.gitInfo?.branch) || existing?.branch || "main",
    state: deriveThreadState(readString(rawThread?.status?.type), threadId, archived),
    lastActivityAt: toIsoFromEpoch(rawThread?.updatedAt) ?? toIsoFromEpoch(rawThread?.createdAt) ?? existing?.lastActivityAt ?? new Date().toISOString(),
    unreadCount: 0,
    subagentCount: 0,
    isWorktree: isWorktreeThread(rawThread),
    isForked: Boolean(rawThread?.forkedFromId),
    diff: fallbackDiff,
    queuedDrafts: local.queuedDrafts,
    messages: mappedMessages,
  } satisfies ThreadRecord;
}

function mapTurnsToMessages(turns: any[], fallbackTurns = new Map<string, SessionTurnHistoryFallback>()) {
  const messages: ThreadMessage[] = [];
  for (const turn of turns) {
    const createdAt = toIsoFromEpoch(turn?.startedAt) ?? new Date().toISOString();
    const turnMode = deriveTurnModeFromItems(Array.isArray(turn?.items) ? turn.items : []);
    const turnMessages: ThreadMessage[] = [];
    for (const item of Array.isArray(turn?.items) ? turn.items : []) {
      const message = mapLiveItemToMessage(item, createdAt, "history", turnMode);
      if (message) {
        turnMessages.push(message);
      }
    }
    const turnId = readString(turn?.id);
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

function mapLiveItemToMessage(
  item: any,
  createdAt: string,
  stage: "history" | "started" | "completed" = "history",
  assistantKind: "chat" | "plan" = "chat"
) {
  const itemId = readString(item?.id) || randomUUID();
  if (item?.type === "userMessage") {
    return {
      id: itemId,
      role: "user",
      kind: "chat",
      text: readUserItemText(item),
      createdAt,
    } satisfies ThreadMessage;
  }

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
  const index = thread.messages.findIndex((message) => message.id === nextMessage.id);
  if (index === -1) {
    thread.messages.push(nextMessage);
  } else {
    thread.messages[index] = {
      ...thread.messages[index],
      ...nextMessage,
    };
  }
  thread.preview = nextMessage.text || thread.preview;
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
  thread.state = deriveThreadState(statusType, threadId, thread.state === "archived");
  thread.lastActivityAt = new Date().toISOString();
  if (thread.state !== "running") {
    activeTurns.delete(threadId);
  }
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
  const threads = [...threadCache.values()]
    .sort((left, right) => {
      const leftArchived = left.state === "archived" ? 1 : 0;
      const rightArchived = right.state === "archived" ? 1 : 0;
      if (leftArchived !== rightArchived) {
        return leftArchived - rightArchived;
      }
      return Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
    })
    .map((thread) => serializeThreadForUser(thread, user.selectedThreadId));

  return {
    user: user.profile,
    selectedThreadId: user.selectedThreadId,
    threads,
    settings: user.settings,
    connection: buildConnection(),
    banner: user.banner,
  };
}

function buildConnection(): RelayConnection {
  return {
    state: codexConnectionState,
    relayLabel: RELAY_LABEL,
    macLabel: MAC_LABEL,
    latencyMs: codexConnectionState === "connected" ? randomInt(8, 22) : 0,
    lastSyncAt: codexLastSyncAt,
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
  const firstAnyThreadId = [...threadCache.values()]
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
    .at(0)?.id ?? null;

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

function findFirstLiveThreadId(excludingThreadId?: string) {
  return [...threadCache.values()]
    .filter((thread) => thread.id !== excludingThreadId && thread.state !== "archived")
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
    .at(0)?.id ?? null;
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
    throw new ProjectResourceError(404, "Project root not found on this Mac.");
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
  const next = new Map<string, ThreadMessage>();
  for (const message of messages) {
    next.set(message.id, message);
  }
  return [...next.values()];
}

function readUserItemText(item: any) {
  const content = Array.isArray(item?.content) ? item.content : [];
  return content
    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n\n")
    .trim();
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

function mapApprovalPolicy(accessMode: "read-only" | "on-request" | "full-access") {
  if (accessMode === "on-request") {
    return "on-request";
  }
  return "never";
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

function broadcastThreadToAllUsers(threadId: string) {
  const thread = threadCache.get(threadId);
  if (!thread) {
    return;
  }
  sendBridgeEvent({
    type: "bridge:thread:updated",
    thread: serializeThreadForSelections(thread, bridgeSelectedThreadIds()),
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

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

async function deliverCode(email: string, code: string): Promise<DeliveryMode> {
  if (!OTP_MAIL_CONFIG) {
    throw new Error("OTP email delivery is not configured on this relay.");
  }

  const payload = renderOtpEmail(code);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OTP_MAIL_CONFIG.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: OTP_MAIL_CONFIG.authEmailFrom,
      to: [email],
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `Resend rejected OTP email (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`
    );
  }

  return "resend";
}

function pruneLegacyOtpCodes() {
  let changed = false;
  for (const [email, record] of Object.entries(persisted.otpCodes)) {
    if (record.delivery !== "resend" || otpExpired(record.expiresAt)) {
      delete persisted.otpCodes[email];
      changed = true;
    }
  }
  return changed;
}

function resolveOtpMailConfig(): OtpMailConfig | null {
  const fallbackEnv = readOptionalEnvFile(AUTH_ENV_FALLBACK_FILE);
  const resendApiKey =
    readConfigValue(process.env.PHODEX_RESEND_API_KEY) ||
    readConfigValue(process.env.RESEND_API_KEY) ||
    fallbackEnv.RESEND_API_KEY ||
    "";
  const authEmailFrom =
    readConfigValue(process.env.PHODEX_AUTH_EMAIL_FROM) ||
    readConfigValue(process.env.AUTH_EMAIL_FROM) ||
    fallbackEnv.AUTH_EMAIL_FROM ||
    "";

  if (!resendApiKey || !authEmailFrom) {
    return null;
  }

  const sourceLabel =
    readConfigValue(process.env.PHODEX_RESEND_API_KEY) || readConfigValue(process.env.RESEND_API_KEY)
      ? readConfigValue(process.env.PHODEX_AUTH_EMAIL_FROM) || readConfigValue(process.env.AUTH_EMAIL_FROM)
        ? "process env"
        : "mixed env + fallback file"
      : `fallback file ${AUTH_ENV_FALLBACK_FILE}`;

  return {
    resendApiKey,
    authEmailFrom,
    sourceLabel,
  };
}

function readOptionalEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  const values: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = readConfigValue(rawValue);
    if (value) {
      values[key] = value;
    }
  }

  return values;
}

function readConfigValue(value: string | undefined) {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function renderOtpEmail(code: string) {
  const title = "Continue with email verification.";
  const subtitle =
    "Use this one-time verification code to connect your phone to the relay session running on your Mac.";
  const expiresLabel = `${Math.round(OTP_TTL_MS / 60_000)} minutes`;
  const subject = "Your Phodex verification code";

  return {
    subject,
    text: [
      "Phodex",
      "",
      title,
      subtitle,
      "",
      `Verification code: ${code}`,
      `Expires in ${expiresLabel}.`,
      "",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#050505;color:#f5f7fb;font-family:Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
    <div style="padding:32px 18px;background:
      radial-gradient(circle at top, rgba(92,109,255,0.24), transparent 34%),
      radial-gradient(circle at bottom, rgba(239,142,85,0.18), transparent 28%),
      #050505;">
      <div style="max-width:540px;margin:0 auto;padding:32px 24px;border:1px solid rgba(255,255,255,0.1);border-radius:28px;background:rgba(14,14,18,0.92);box-shadow:0 28px 60px rgba(0,0,0,0.34);">
        <div style="display:inline-flex;align-items:center;min-height:28px;padding:0 12px;border:1px solid rgba(255,255,255,0.1);border-radius:999px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.66);font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Email OTP</div>
        <div style="margin-top:18px;display:grid;gap:14px;">
          <div style="width:64px;height:64px;border-radius:18px;background:
            radial-gradient(circle at 35% 30%, rgba(255,255,255,0.26), transparent 36%),
            linear-gradient(180deg, rgba(92,109,255,0.98), rgba(58,66,195,0.98));box-shadow:0 18px 42px rgba(92,109,255,0.28);color:#ffffff;font-size:24px;font-weight:800;line-height:64px;text-align:center;">P</div>
          <div>
            <h1 style="margin:0;font-size:32px;line-height:1.02;letter-spacing:-0.05em;color:#ffffff;">${escapeHtml(title)}</h1>
            <p style="margin:10px 0 0;color:rgba(255,255,255,0.64);font-size:15px;line-height:1.7;">${escapeHtml(subtitle)}</p>
          </div>
        </div>
        <div style="margin-top:24px;padding:18px;border:1px solid rgba(255,255,255,0.08);border-radius:24px;background:
          linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));">
          <div style="color:rgba(255,255,255,0.56);font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Verification code</div>
          <div style="margin-top:12px;padding:18px 20px;border-radius:20px;background:rgba(255,255,255,0.06);color:#ffffff;font-family:'JetBrains Mono','SF Mono',ui-monospace,monospace;font-size:34px;font-weight:700;letter-spacing:0.22em;text-align:center;">${escapeHtml(code)}</div>
          <p style="margin:12px 0 0;color:rgba(255,255,255,0.62);font-size:13px;line-height:1.6;">This code expires in ${escapeHtml(expiresLabel)}.</p>
        </div>
        <div style="margin-top:18px;padding:14px 16px;border:1px solid rgba(255,255,255,0.06);border-radius:20px;background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.6);font-size:13px;line-height:1.7;">
          If you did not request this code, you can ignore this email.
        </div>
      </div>
    </div>
  </body>
</html>`,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(req: Request) {
  return req.json().catch(() => ({}));
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
        threadLocal: {},
      };
    }

    const parsed = JSON.parse(readFileSync(dataFile, "utf8")) as Partial<PersistedState>;
    return {
      users: parsed.users ?? {},
      sessions: parsed.sessions ?? {},
      otpCodes: parsed.otpCodes ?? {},
      threadLocal: parsed.threadLocal ?? {},
    };
  } catch {
    return {
      users: {},
      sessions: {},
      otpCodes: {},
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

function codexRequest(method: string, params: unknown, options: { allowBeforeReady?: boolean } = {}) {
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
    }, 20_000);

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
