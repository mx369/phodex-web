import { reactive } from "vue";
import type {
  AccessMode,
  AppSettings,
  AppSnapshot,
  AuthSession,
  ClientEvent,
  DeliveryMode,
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

type AuthPhase = "idle" | "requested" | "authenticated";
type PendingThreadCreate = {
  tempId: string;
  previousSelectedThreadId: string | null;
  timeoutId: number;
};
type PendingRunFeedback = {
  threadId: string;
  prompt: string;
  startedAt: string;
  promptAcknowledged: boolean;
};

const SESSION_STORAGE_KEY = "phodex.session";
const PENDING_THREAD_PREFIX = "pending-thread:";
const PENDING_THREAD_TIMEOUT_MS = 12_000;
const runtimeHost = window.location.hostname || "localhost";
const inferredApiOrigin =
  import.meta.env.DEV && window.location.port !== "3443"
    ? `${window.location.protocol === "https:" ? "https" : "http"}://${runtimeHost}:3443`
    : window.location.origin;
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || inferredApiOrigin;
const WS_ORIGIN = API_ORIGIN.replace(/^http/, "ws");

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
    search: "",
    selectedModel: "GPT-5.4",
    fastMode: false,
    planArmed: false,
    accessMode: "full-access" as AccessMode,
    sidebarOpen: false,
    settingsOpen: false,
    authStatus: "",
    toasts: [] as UiToast[],
    pendingRunFeedback: null as PendingRunFeedback | null,
  },
});

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let pendingSendAfterThreadCreate = false;
let pendingThreadCreate: PendingThreadCreate | null = null;

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
      pushToast("success", "Verification code ready.");
    } catch (error) {
      pushToast("error", readErrorMessage(error));
    } finally {
      state.ui.sendingCode = false;
    }
  }

  async function verifyCode(code: string) {
    const email = state.auth.email.trim().toLowerCase();
    if (!email || !code.trim()) {
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
      applySnapshot(response.snapshot);
      connectSocket();
      pushToast("success", "Connected to the secure relay.");
      return true;
    } catch (error) {
      pushToast("error", readErrorMessage(error));
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
    state.ui.settingsOpen = false;
    state.ui.pendingRunFeedback = null;
    pushToast("info", "Signed out.");
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
    case "snapshot":
      applySnapshot(event.snapshot);
      reconcilePendingRunFeedback();
      resolvePendingThreadCreate(event.snapshot.selectedThreadId);
      if (pendingSendAfterThreadCreate && event.snapshot.selectedThreadId) {
        const thread = event.snapshot.threads.find((entry) => entry.id === event.snapshot.selectedThreadId);
        if (thread && thread.messages.length === 0) {
          pendingSendAfterThreadCreate = false;
          flushComposer(thread.id);
        }
      }
      break;
    case "thread:updated":
      if (!state.snapshot) {
        return;
      }
      upsertThread(event.thread);
      reconcilePendingRunFeedback(event.thread.id);
      state.snapshot.selectedThreadId = event.selectedThreadId;
      resolvePendingThreadCreate(event.selectedThreadId);
      if (pendingSendAfterThreadCreate && event.selectedThreadId === event.thread.id && event.thread.messages.length === 0) {
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

function upsertThread(nextThread: ThreadRecord) {
  if (!state.snapshot) {
    return;
  }
  const index = state.snapshot.threads.findIndex((thread) => thread.id === nextThread.id);
  if (index === -1) {
    state.snapshot.threads.unshift(nextThread);
    return;
  }
  state.snapshot.threads[index] = nextThread;
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

  const tempId = `${PENDING_THREAD_PREFIX}${crypto.randomUUID()}`;
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
    timeoutId: window.setTimeout(() => {
      rollbackPendingThreadCreate(false);
      pushToast("error", "Starting the new chat took too long. Try again.");
    }, PENDING_THREAD_TIMEOUT_MS),
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

  window.clearTimeout(pendingThreadCreate.timeoutId);
  pendingThreadCreate = null;
}

function rollbackPendingThreadCreate(pushFallbackToast = true) {
  if (!pendingThreadCreate) {
    return;
  }

  const { tempId, previousSelectedThreadId, timeoutId } = pendingThreadCreate;
  window.clearTimeout(timeoutId);

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

function beginPendingRunFeedback(threadId: string, prompt: string) {
  state.ui.pendingRunFeedback = {
    threadId,
    prompt,
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
  if (!text) {
    pushToast("error", "Compose something first.");
    return false;
  }

  const thread = findThread(threadId);
  const willQueueDraft = thread?.state === "running";
  const sent = send({
    type: "message:send",
    threadId,
    text,
    model: state.ui.selectedModel,
    planArmed: state.ui.planArmed,
    fastMode: state.ui.fastMode,
    accessMode: state.ui.accessMode,
  });
  if (!sent) {
    return false;
  }
  if (!willQueueDraft) {
    beginPendingRunFeedback(threadId, text);
  }
  state.ui.composerText = "";
  return true;
}

async function fetchJson<T>(path: string, init: { method: string; body?: unknown }) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: init.method,
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
    id: crypto.randomUUID(),
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
