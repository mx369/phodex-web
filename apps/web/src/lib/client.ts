import { reactive } from "vue";
import type {
  AccessMode,
  AppSettings,
  AppSnapshot,
  AuthSession,
  ClientEvent,
  DeliveryMode,
  InputImageAttachment,
  RequestCodeResponse,
  ServerEvent,
  ThreadCreateMode,
  ThreadRecord,
  VerifyCodeResponse,
} from "@phodex/shared";

type ToastTone = "info" | "success" | "error";

type UiToast = {
  id: string;
  tone: ToastTone;
  message: string;
};

type AuthStatusTone = "neutral" | "success" | "error";

type AuthPhase = "idle" | "requested" | "authenticated";
type PendingThreadCreate = {
  tempId: string;
  previousSelectedThreadId: string | null;
  slowTimerId: number;
  failureTimerId: number | null;
  isSlow: boolean;
};
type PendingRunFeedback = {
  threadId: string;
  prompt: string;
  images: InputImageAttachment[];
  startedAt: string;
  promptAcknowledged: boolean;
};

const SESSION_STORAGE_KEY = "phodex.session";
const PENDING_THREAD_PREFIX = "pending-thread:";
const PENDING_THREAD_SLOW_MS = 18_000;
const PENDING_THREAD_FAILURE_MS = 45_000;
const runtimeHost = window.location.hostname || "localhost";
const inferredDevApiOrigin =
  import.meta.env.DEV && window.location.port !== "3443"
    ? `${window.location.protocol === "https:" ? "https" : "http"}://${runtimeHost}:3443`
    : window.location.origin;
export const API_ORIGIN = import.meta.env.DEV ? import.meta.env.VITE_API_ORIGIN || inferredDevApiOrigin : "";
const WS_ORIGIN = import.meta.env.DEV
  ? API_ORIGIN.replace(/^http/, "ws")
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;

export const state = reactive({
  auth: {
    phase: "idle" as AuthPhase,
    email: "",
    delivery: "resend" as DeliveryMode,
  },
  session: null as AuthSession | null,
  snapshot: null as AppSnapshot | null,
  ui: {
    loadingSession: true,
    sendingCode: false,
    verifyingCode: false,
    composerText: "",
    composerImages: [] as InputImageAttachment[],
    search: "",
    selectedModel: "GPT-5.4",
    fastMode: false,
    planArmed: false,
    accessMode: "full-access" as AccessMode,
    sidebarOpen: false,
    settingsOpen: false,
    authStatus: "",
    authStatusTone: "neutral" as AuthStatusTone,
    toasts: [] as UiToast[],
    pendingRunFeedback: null as PendingRunFeedback | null,
  },
});

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let pendingSendAfterThreadCreate = false;
let pendingThreadCreate: PendingThreadCreate | null = null;

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `phodex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAppClient() {
  async function restoreSession() {
    state.ui.loadingSession = true;
    const stored = readStoredSession();
    if (!stored) {
      state.ui.loadingSession = false;
      return;
    }

    state.session = stored;
    state.auth.email = stored.user.email;
    state.auth.phase = "authenticated";

    try {
      const snapshot = await fetchJson<AppSnapshot>("/api/bootstrap", {
        method: "GET",
      });
      applySnapshot(snapshot);
      connectSocket();
    } catch {
      clearSession();
      pushToast("error", "Previous session expired. Sign in again.");
    } finally {
      state.ui.loadingSession = false;
    }
  }

  async function requestCode() {
    const email = state.auth.email.trim().toLowerCase();
    if (!email) {
      state.ui.authStatus = "Enter your email first.";
      state.ui.authStatusTone = "error";
      pushToast("error", "Enter your email first.");
      return;
    }

    state.ui.sendingCode = true;
    try {
      const response = await fetchJson<RequestCodeResponse>("/api/auth/request-code", {
        method: "POST",
        body: {
          email,
        },
      });
      state.auth.phase = "requested";
      state.auth.delivery = response.delivery;
      state.ui.authStatus = "Verification code sent. Check your inbox for the Phodex email.";
      state.ui.authStatusTone = "success";
      pushToast("success", "Verification code ready.");
    } catch (error) {
      const message = readErrorMessage(error);
      state.ui.authStatus = message;
      state.ui.authStatusTone = "error";
      pushToast("error", message);
    } finally {
      state.ui.sendingCode = false;
    }
  }

  async function verifyCode(code: string) {
    const email = state.auth.email.trim().toLowerCase();
    if (!email || !code.trim()) {
      state.ui.authStatus = "Email and code are both required.";
      state.ui.authStatusTone = "error";
      pushToast("error", "Email and code are both required.");
      return false;
    }

    state.ui.verifyingCode = true;
    try {
      const response = await fetchJson<VerifyCodeResponse>("/api/auth/verify-code", {
        method: "POST",
        body: {
          email,
          code: code.trim(),
        },
      });
      state.session = response.session;
      writeStoredSession(response.session);
      state.auth.phase = "authenticated";
      state.ui.authStatus = "";
      state.ui.authStatusTone = "neutral";
      applySnapshot(response.snapshot);
      connectSocket();
      pushToast("success", "Connected to the secure relay.");
      return true;
    } catch (error) {
      const message = readErrorMessage(error);
      state.ui.authStatus = message;
      state.ui.authStatusTone = "error";
      pushToast("error", message);
      return false;
    } finally {
      state.ui.verifyingCode = false;
    }
  }

  function logout() {
    disconnectSocket();
    clearSession();
    state.snapshot = null;
    state.auth.phase = "idle";
    state.ui.composerText = "";
    state.ui.composerImages = [];
    state.ui.settingsOpen = false;
    state.ui.authStatus = "";
    state.ui.authStatusTone = "neutral";
    state.ui.pendingRunFeedback = null;
    pushToast("info", "Signed out.");
  }

  function selectBridge(bridgeId: string) {
    send({
      type: "bridge:select",
      bridgeId,
    });
  }

  function createThread(projectLabel?: string, mode: ThreadCreateMode = "local", cwd?: string) {
    if (pendingThreadCreate) {
      pushToast("info", "A new chat is already starting on your Mac.");
      return false;
    }

    const sent = send({
      type: "thread:create",
      projectLabel,
      cwd,
      mode,
    });
    if (!sent) {
      return false;
    }

    beginPendingThreadCreate(projectLabel ?? "Phodex Web", mode);
    return true;
  }

  function createThreadAndSend(projectLabel?: string, mode: ThreadCreateMode = "local", cwd?: string) {
    const created = createThread(projectLabel, mode, cwd);
    if (created) {
      pendingSendAfterThreadCreate = true;
    }
  }

  function selectThread(threadId: string) {
    send({
      type: "thread:select",
      threadId,
    });
    if (state.snapshot) {
      state.snapshot.selectedThreadId = threadId;
    }
    state.ui.sidebarOpen = false;
  }

  function clearThreadSelection() {
    send({
      type: "thread:clearSelection",
    });
    if (state.snapshot) {
      state.snapshot.selectedThreadId = null;
    }
    state.ui.sidebarOpen = false;
  }

  function renameThread(threadId: string, title: string) {
    send({
      type: "thread:rename",
      threadId,
      title,
    });
  }

  function toggleArchiveThread(thread: ThreadRecord) {
    send({
      type: "thread:archive",
      threadId: thread.id,
    });
  }

  function sendComposer(threadId: string) {
    return flushComposer(threadId);
  }

  function resumeDraft(threadId: string, draftId: string) {
    send({
      type: "draft:resume",
      threadId,
      draftId,
    });
  }

  function removeDraft(threadId: string, draftId: string) {
    send({
      type: "draft:remove",
      threadId,
      draftId,
    });
  }

  function stopRun(threadId: string) {
    send({
      type: "run:stop",
      threadId,
    });
  }

  function updateSettings(patch: Partial<AppSettings>) {
    if (state.snapshot) {
      state.snapshot.settings = {
        ...state.snapshot.settings,
        ...patch,
      };
    }
    send({
      type: "settings:update",
      patch,
    });
  }

    return {
      restoreSession,
      requestCode,
      verifyCode,
      logout,
      selectBridge,
      createThread,
      createThreadAndSend,
      selectThread,
      clearThreadSelection,
      renameThread,
      toggleArchiveThread,
    sendComposer,
    resumeDraft,
    removeDraft,
    stopRun,
    updateSettings,
  };
}

function connectSocket() {
  if (!state.session) {
    return;
  }
  disconnectSocket();

  socket = new WebSocket(`${WS_ORIGIN}/relay?token=${encodeURIComponent(state.session.token)}`);
  updateConnectionState("connecting");

  socket.addEventListener("open", () => {
    updateConnectionState("connected");
    send({ type: "bootstrap" });
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data) as ServerEvent;
    handleServerEvent(payload);
  });

  socket.addEventListener("close", () => {
    updateConnectionState("disconnected");
    if (state.session) {
      reconnectTimer = window.setTimeout(connectSocket, 1200);
    }
  });

  socket.addEventListener("error", () => {
    updateConnectionState("disconnected");
  });
}

function disconnectSocket() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
}

function send(event: ClientEvent) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    pushToast("error", "Relay not connected yet.");
    return false;
  }
  socket.send(JSON.stringify(event));
  return true;
}

function handleServerEvent(event: ServerEvent) {
  switch (event.type) {
    case "snapshot": {
      const nextSnapshot = mergeSnapshotWithPendingThread(event.snapshot);
      applySnapshot(nextSnapshot);
      reconcilePendingRunFeedback();
      resolvePendingThreadCreate(nextSnapshot.selectedThreadId);
      if (pendingSendAfterThreadCreate && nextSnapshot.selectedThreadId) {
        const thread = nextSnapshot.threads.find((entry) => entry.id === nextSnapshot.selectedThreadId);
        if (thread && thread.messages.length === 0) {
          pendingSendAfterThreadCreate = false;
          flushComposer(thread.id);
        }
      }
      break;
    }
    case "thread:updated":
      if (!state.snapshot) {
        return;
      }
      const nextSelectedThreadId = coercePendingThreadSelection(event.selectedThreadId);
      upsertThread(event.thread, nextSelectedThreadId);
      reconcilePendingRunFeedback(event.thread.id);
      state.snapshot.selectedThreadId = nextSelectedThreadId;
      resolvePendingThreadCreate(nextSelectedThreadId);
      if (pendingSendAfterThreadCreate && nextSelectedThreadId === event.thread.id && event.thread.messages.length === 0) {
        pendingSendAfterThreadCreate = false;
        flushComposer(event.thread.id);
      }
      break;
    case "message:appended": {
      const thread = findThread(event.threadId);
      if (!thread) {
        return;
      }
      if (!thread.messages.some((message) => message.id === event.message.id)) {
        thread.messages.push(event.message);
        thread.lastActivityAt = event.message.createdAt;
      }
      syncPendingRunFeedbackFromMessage(event.threadId, event.message.role, event.message.text);
      break;
    }
    case "message:delta": {
      const thread = findThread(event.threadId);
      const message = thread?.messages.find((item) => item.id === event.messageId);
      if (message) {
        message.text += event.delta;
        message.isStreaming = true;
      }
      clearPendingRunFeedback(event.threadId);
      break;
    }
    case "message:finished": {
      const thread = findThread(event.threadId);
      const message = thread?.messages.find((item) => item.id === event.messageId);
      if (message) {
        message.isStreaming = false;
      }
      clearPendingRunFeedback(event.threadId);
      break;
    }
    case "banner":
      if (state.snapshot) {
        state.snapshot.banner = event.banner;
      }
      break;
    case "presence":
      if (state.snapshot) {
        state.snapshot.connection = event.connection;
        state.snapshot.activeBridgeId = event.activeBridgeId;
        state.snapshot.bridgeDevices = event.bridgeDevices;
      }
      break;
    case "toast":
      if (event.tone === "error" && pendingThreadCreate && state.snapshot?.selectedThreadId === pendingThreadCreate.tempId) {
        rollbackPendingThreadCreate(false);
      }
      pushToast(event.tone, event.message);
      break;
  }
}

function applySnapshot(snapshot: AppSnapshot) {
  state.snapshot = snapshot;
  updateConnectionState(snapshot.connection.state);
}

function mergeSnapshotWithPendingThread(snapshot: AppSnapshot) {
  const nextSelectedThreadId = coercePendingThreadSelection(snapshot.selectedThreadId);
  const nextThreads = snapshot.threads.map((thread) => stabilizeIncomingThread(thread, nextSelectedThreadId));
  if (!pendingThreadCreate || nextSelectedThreadId !== pendingThreadCreate.tempId) {
    return {
      ...snapshot,
      selectedThreadId: nextSelectedThreadId,
      threads: nextThreads,
    };
  }

  const tempThread = state.snapshot?.threads.find((thread) => thread.id === pendingThreadCreate?.tempId) ?? null;
  if (!tempThread) {
    return {
      ...snapshot,
      selectedThreadId: nextSelectedThreadId,
      threads: nextThreads,
    };
  }

  return {
    ...snapshot,
    selectedThreadId: nextSelectedThreadId,
    threads: [tempThread, ...nextThreads.filter((thread) => thread.id !== tempThread.id)],
  };
}

function coercePendingThreadSelection(selectedThreadId: string | null) {
  if (
    pendingThreadCreate &&
    (!selectedThreadId ||
      selectedThreadId === pendingThreadCreate.tempId ||
      selectedThreadId === pendingThreadCreate.previousSelectedThreadId)
  ) {
    return pendingThreadCreate.tempId;
  }
  return selectedThreadId;
}

function stabilizeIncomingThread(nextThread: ThreadRecord, selectedThreadId = state.snapshot?.selectedThreadId ?? null) {
  const existing = state.snapshot?.threads.find((thread) => thread.id === nextThread.id) ?? null;
  if (!existing) {
    return nextThread;
  }

  const shouldPreserveSelectedMessages =
    nextThread.id === selectedThreadId &&
    nextThread.messages.length === 0 &&
    existing.messages.length > 0;

  if (!shouldPreserveSelectedMessages) {
    return nextThread;
  }

  return {
    ...nextThread,
    messages: existing.messages,
  };
}

function upsertThread(nextThread: ThreadRecord, selectedThreadId = state.snapshot?.selectedThreadId ?? null) {
  if (!state.snapshot) {
    return;
  }
  const stableThread = stabilizeIncomingThread(nextThread, selectedThreadId);
  const index = state.snapshot.threads.findIndex((thread) => thread.id === stableThread.id);
  if (index === -1) {
    state.snapshot.threads.unshift(stableThread);
    return;
  }
  state.snapshot.threads[index] = stableThread;
}

function updateConnectionState(next: AppSnapshot["connection"]["state"]) {
  if (!state.snapshot) {
    return;
  }
  state.snapshot.connection.state = next;
}

function beginPendingThreadCreate(projectLabel: string, mode: ThreadCreateMode) {
  if (!state.snapshot) {
    return;
  }

  rollbackPendingThreadCreate(false);

  const tempId = `${PENDING_THREAD_PREFIX}${createClientId()}`;
  const previousSelectedThreadId = state.snapshot.selectedThreadId;
  const seedThread =
    state.snapshot.threads.find((thread) => thread.id === previousSelectedThreadId) ??
    state.snapshot.threads.find((thread) => thread.projectLabel === projectLabel) ??
    state.snapshot.threads[0] ??
    null;

  const tempThread: ThreadRecord = {
    id: tempId,
    title: projectLabel,
    preview: mode === "worktree" ? "Starting a worktree chat on your Mac…" : "Starting a new chat on your Mac…",
    projectLabel,
    repoLabel: seedThread?.repoLabel ?? "",
    branch: seedThread?.branch ?? "main",
    state: "queued",
    lastActivityAt: new Date().toISOString(),
    unreadCount: 0,
    subagentCount: 0,
    isWorktree: mode === "worktree",
    isForked: mode === "worktree",
    diff: { additions: 0, deletions: 0 },
    queuedDrafts: [],
    messages: [],
  };

  state.snapshot.selectedThreadId = tempId;
  state.snapshot.threads = [tempThread, ...state.snapshot.threads.filter((thread) => thread.id !== tempId)];

  pendingThreadCreate = {
    tempId,
    previousSelectedThreadId,
    slowTimerId: window.setTimeout(() => {
      markPendingThreadCreateSlow(tempId, mode);
    }, PENDING_THREAD_SLOW_MS),
    failureTimerId: null,
    isSlow: false,
  };
}

function resolvePendingThreadCreate(selectedThreadId: string | null) {
  if (
    !pendingThreadCreate ||
    !selectedThreadId ||
    selectedThreadId === pendingThreadCreate.tempId ||
    selectedThreadId === pendingThreadCreate.previousSelectedThreadId
  ) {
    return;
  }

  const tempId = pendingThreadCreate.tempId;
  if (state.snapshot) {
    state.snapshot.threads = state.snapshot.threads.filter((thread) => thread.id !== tempId);
  }

  window.clearTimeout(pendingThreadCreate.slowTimerId);
  if (pendingThreadCreate.failureTimerId !== null) {
    window.clearTimeout(pendingThreadCreate.failureTimerId);
  }
  pendingThreadCreate = null;
}

function rollbackPendingThreadCreate(pushFallbackToast = true) {
  if (!pendingThreadCreate) {
    return;
  }

  const { tempId, previousSelectedThreadId, slowTimerId, failureTimerId } = pendingThreadCreate;
  window.clearTimeout(slowTimerId);
  if (failureTimerId !== null) {
    window.clearTimeout(failureTimerId);
  }

  if (state.snapshot) {
    state.snapshot.threads = state.snapshot.threads.filter((thread) => thread.id !== tempId);
    if (state.snapshot.selectedThreadId === tempId) {
      const nextSelectedThreadId =
        previousSelectedThreadId &&
        state.snapshot.threads.some((thread) => thread.id === previousSelectedThreadId)
          ? previousSelectedThreadId
          : state.snapshot.threads[0]?.id ?? null;
      state.snapshot.selectedThreadId = nextSelectedThreadId;
    }
  }

  pendingThreadCreate = null;

  if (pushFallbackToast) {
    pushToast("error", "Unable to keep the pending chat open.");
  }
}

function markPendingThreadCreateSlow(tempId: string, mode: ThreadCreateMode) {
  if (!pendingThreadCreate || pendingThreadCreate.tempId !== tempId || pendingThreadCreate.isSlow) {
    return;
  }

  pendingThreadCreate.isSlow = true;

  const thread = findThread(tempId);
  if (thread) {
    thread.preview =
      mode === "worktree"
        ? "Still creating your worktree chat on the Mac…"
        : "Still starting the new chat on the Mac…";
    thread.lastActivityAt = new Date().toISOString();
  }

  pushToast("error", "Starting the new chat is taking longer than usual. Still waiting on your Mac.");
  pendingThreadCreate.failureTimerId = window.setTimeout(() => {
    rollbackPendingThreadCreate(false);
    pushToast("error", "Starting the new chat failed. Try again.");
  }, Math.max(PENDING_THREAD_FAILURE_MS - PENDING_THREAD_SLOW_MS, 0));
}

function beginPendingRunFeedback(threadId: string, prompt: string, images: InputImageAttachment[]) {
  state.ui.pendingRunFeedback = {
    threadId,
    prompt,
    images,
    startedAt: new Date().toISOString(),
    promptAcknowledged: false,
  };
}

function clearPendingRunFeedback(threadId?: string) {
  if (!state.ui.pendingRunFeedback) {
    return;
  }
  if (!threadId || state.ui.pendingRunFeedback.threadId === threadId) {
    state.ui.pendingRunFeedback = null;
  }
}

function reconcilePendingRunFeedback(threadId?: string) {
  const pending = state.ui.pendingRunFeedback;
  if (!pending || !state.snapshot) {
    return;
  }
  if (threadId && pending.threadId !== threadId) {
    return;
  }
  const thread = state.snapshot.threads.find((entry) => entry.id === pending.threadId);
  if (!thread || thread.state !== "running") {
    state.ui.pendingRunFeedback = null;
  }
}

function syncPendingRunFeedbackFromMessage(threadId: string, role: string, text: string) {
  const pending = state.ui.pendingRunFeedback;
  if (!pending || pending.threadId !== threadId) {
    return;
  }

  if (role === "user" && normalizePendingRunPrompt(text) === normalizePendingRunPrompt(pending.prompt)) {
    pending.promptAcknowledged = true;
    return;
  }

  if (role !== "user") {
    clearPendingRunFeedback(threadId);
  }
}

function normalizePendingRunPrompt(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function findThread(threadId: string) {
  return state.snapshot?.threads.find((thread) => thread.id === threadId) ?? null;
}

function flushComposer(threadId: string) {
  if (threadId.startsWith(PENDING_THREAD_PREFIX)) {
    pushToast("info", "The new chat is still starting on your Mac.");
    return false;
  }

  const text = state.ui.composerText.trim();
  const images = state.ui.composerImages.map((image) => ({ ...image }));
  if (!text && !images.length) {
    pushToast("error", "Compose something first.");
    return false;
  }

  const thread = findThread(threadId);
  const willQueueDraft = thread?.state === "running";
  const sent = send({
    type: "message:send",
    threadId,
    text,
    images,
    model: state.ui.selectedModel,
    planArmed: state.ui.planArmed,
    fastMode: state.ui.fastMode,
    accessMode: state.ui.accessMode,
  });
  if (!sent) {
    return false;
  }
  if (!willQueueDraft) {
    beginPendingRunFeedback(threadId, text, images);
  }
  state.ui.composerText = "";
  state.ui.composerImages = [];
  return true;
}

async function fetchJson<T>(path: string, init: { method: string; body?: unknown }) {
  return fetchSessionJson<T>(path, init);
}

export async function fetchSessionJson<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(state.session ? { authorization: `Bearer ${state.session.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data as T;
}

function pushToast(tone: ToastTone, message: string) {
  const toast: UiToast = {
    id: createClientId(),
    tone,
    message,
  };
  state.ui.toasts.push(toast);
  window.setTimeout(() => {
    state.ui.toasts = state.ui.toasts.filter((item) => item.id !== toast.id);
  }, 3600);
}

function readStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function writeStoredSession(session: AuthSession) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  state.session = null;
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}
