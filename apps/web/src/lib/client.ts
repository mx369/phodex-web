import { reactive } from "vue";
import { buildPromptTraceKey, summarizePromptForTrace } from "@phodex/shared";
import type {
  AccessMode,
  AppSettings,
  AppSnapshot,
  AuthSession,
  ClientEvent,
  DeliveryMode,
  InputImageAttachment,
  QueuedDraft,
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
  requestId: string;
  projectLabel: string;
  mode: ThreadCreateMode;
  previousSelectedThreadId: string | null;
  slowTimerId: number;
  failureTimerId: number | null;
  isSlow: boolean;
  resolve: (threadId: string) => void;
  reject: (error: Error) => void;
};
type PendingRunFeedback = {
  threadId: string;
  prompt: string;
  images: InputImageAttachment[];
  startedAt: string;
  promptAcknowledged: boolean;
};
type PendingResumeFeedback = {
  threadId: string;
  draftId: string;
  prompt: string;
  images: InputImageAttachment[];
};
type StoredComposerPreferences = {
  selectedModel?: string;
  fastMode?: boolean;
  planArmed?: boolean;
  accessMode?: AccessMode;
};

const SESSION_STORAGE_KEY = "phodex.session";
const COMPOSER_PREFERENCES_STORAGE_KEY = "phodex.composerPreferences";
const FLOW_TRACE_STORAGE_KEY = "phodex.flowTrace";
const PENDING_THREAD_PREFIX = "pending-thread:";
const OPTIMISTIC_QUEUED_DRAFT_PREFIX = "optimistic-queued:";
const PENDING_THREAD_SLOW_MS = 18_000;
const PENDING_THREAD_FAILURE_MS = 45_000;
const PENDING_RUN_FEEDBACK_STALE_MS = 20_000;
const DEFAULT_SELECTED_MODEL = "GPT-5.4";
const DEFAULT_ACCESS_MODE: AccessMode = "full-access";
const storedComposerPreferences = readStoredComposerPreferences();
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
    selectedModel: storedComposerPreferences.selectedModel ?? DEFAULT_SELECTED_MODEL,
    fastMode: storedComposerPreferences.fastMode ?? false,
    planArmed: storedComposerPreferences.planArmed ?? false,
    accessMode: storedComposerPreferences.accessMode ?? DEFAULT_ACCESS_MODE,
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
let pendingResumeFeedback: PendingResumeFeedback | null = null;
const optimisticQueuedDrafts = new Map<string, QueuedDraft[]>();
const pendingResumeTimers = new Map<string, number>();

function flowTraceEnabled() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("flowTrace") === "1" || localStorage.getItem(FLOW_TRACE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function logFlowTrace(phase: string, details: Record<string, unknown> = {}) {
  if (!flowTraceEnabled()) {
    return;
  }

  const entry = {
    scope: "client",
    ts: new Date().toISOString(),
    phase,
    ...details,
  };
  const traceWindow = window as Window & { __PHODEX_FLOW_TRACE__?: unknown[] };
  if (!Array.isArray(traceWindow.__PHODEX_FLOW_TRACE__)) {
    traceWindow.__PHODEX_FLOW_TRACE__ = [];
  }
  traceWindow.__PHODEX_FLOW_TRACE__.push(entry);
  if (traceWindow.__PHODEX_FLOW_TRACE__.length > 600) {
    traceWindow.__PHODEX_FLOW_TRACE__.splice(0, traceWindow.__PHODEX_FLOW_TRACE__.length - 600);
  }
  console.log("[phodex-flow][client]", JSON.stringify(entry));
}

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `phodex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isOptimisticQueuedDraft(draftId: string) {
  return draftId.startsWith(OPTIMISTIC_QUEUED_DRAFT_PREFIX);
}

function queuedDraftKey(draft: Pick<QueuedDraft, "text" | "images">) {
  const imageKey = (draft.images ?? [])
    .map((image) => [image.fileId ?? "", image.imageUrl ?? "", image.name ?? "", image.mimeType ?? "", image.detail ?? ""].join("|"))
    .join("||");
  return `${normalizePendingRunPrompt(draft.text)}::${imageKey}`;
}

function mergeIncomingQueuedDrafts(thread: ThreadRecord) {
  const serverQueuedDrafts = thread.queuedDrafts.filter((draft) => !isOptimisticQueuedDraft(draft.id));
  const optimisticDrafts = optimisticQueuedDrafts.get(thread.id) ?? [];
  if (!optimisticDrafts.length) {
    return {
      ...thread,
      queuedDrafts: serverQueuedDrafts,
    };
  }

  const serverKeys = new Set(serverQueuedDrafts.map((draft) => queuedDraftKey(draft)));
  const remainingOptimisticDrafts = optimisticDrafts.filter((draft) => !serverKeys.has(queuedDraftKey(draft)));

  if (!remainingOptimisticDrafts.length || thread.state !== "running") {
    optimisticQueuedDrafts.delete(thread.id);
    return {
      ...thread,
      queuedDrafts: serverQueuedDrafts,
    };
  }

  optimisticQueuedDrafts.set(thread.id, remainingOptimisticDrafts);
  return {
    ...thread,
    queuedDrafts: [...remainingOptimisticDrafts, ...serverQueuedDrafts],
  };
}

function addOptimisticQueuedDraft(threadId: string, text: string, images: InputImageAttachment[]) {
  const draft: QueuedDraft = {
    id: `${OPTIMISTIC_QUEUED_DRAFT_PREFIX}${createClientId()}`,
    text,
    createdAt: new Date().toISOString(),
    images: images.length ? images.map((image) => ({ ...image })) : undefined,
    model: state.ui.selectedModel,
    planArmed: state.ui.planArmed,
    fastMode: state.ui.fastMode,
    accessMode: state.ui.accessMode,
  };
  optimisticQueuedDrafts.set(threadId, [draft, ...(optimisticQueuedDrafts.get(threadId) ?? [])]);
  const thread = findThread(threadId);
  if (thread) {
    thread.queuedDrafts = mergeIncomingQueuedDrafts(thread).queuedDrafts;
  }
}

function clearPendingResumeTimer(threadId: string, draftId: string) {
  const timerKey = `${threadId}:${draftId}`;
  const timerId = pendingResumeTimers.get(timerKey);
  if (typeof timerId === "number") {
    window.clearTimeout(timerId);
    pendingResumeTimers.delete(timerKey);
  }
}

function beginOptimisticResume(threadId: string, draft: QueuedDraft) {
  const thread = findThread(threadId);
  if (thread) {
    thread.queuedDrafts = thread.queuedDrafts.filter((entry) => entry.id !== draft.id);
  }
  beginPendingRunFeedback(threadId, draft.text, draft.images ? draft.images.map((image) => ({ ...image })) : []);
  clearPendingResumeTimer(threadId, draft.id);
  const timerKey = `${threadId}:${draft.id}`;
  pendingResumeTimers.set(
    timerKey,
    window.setTimeout(() => {
      if (
        pendingResumeFeedback?.threadId === threadId &&
        pendingResumeFeedback.draftId === draft.id &&
        state.ui.pendingRunFeedback?.threadId === threadId &&
        !state.ui.pendingRunFeedback.promptAcknowledged
      ) {
        state.ui.pendingRunFeedback = null;
      }
      pendingResumeTimers.delete(timerKey);
    }, 8_000)
  );
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
    pendingResumeFeedback = null;
    optimisticQueuedDrafts.clear();
    for (const timerId of pendingResumeTimers.values()) {
      window.clearTimeout(timerId);
    }
    pendingResumeTimers.clear();
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
      return Promise.reject(new Error("A new chat is already starting on your Mac."));
    }

    const requestId = createClientId();
    logFlowTrace("thread.create.requested", {
      requestId,
      projectLabel: projectLabel ?? "Phodex Web",
      mode,
      cwd: cwd ?? null,
    });
    const sent = send({
      type: "thread:create",
      requestId,
      projectLabel,
      cwd,
      mode,
    });
    if (!sent) {
      return Promise.reject(new Error("Relay not connected yet."));
    }

    return beginPendingThreadCreate(requestId, projectLabel ?? "Phodex Web", mode);
  }

  function createThreadAndSend(projectLabel?: string, mode: ThreadCreateMode = "local", cwd?: string) {
    pendingSendAfterThreadCreate = true;
    return createThread(projectLabel, mode, cwd).catch((error) => {
      pendingSendAfterThreadCreate = false;
      throw error;
    });
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

  function loadOlderMessages(threadId: string) {
    const thread = findThread(threadId);
    const history = thread?.history;
    if (!thread || !history || !history.hasMoreBefore || history.isHydrating) {
      return false;
    }
    thread.history = {
      ...history,
      isHydrating: true,
    };
    const sent = send({
      type: "thread:history:load",
      threadId,
      loadedMessages: history.loadedMessages,
    });
    if (!sent) {
      thread.history.isHydrating = false;
      return false;
    }
    return true;
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
    const draft = findThread(threadId)?.queuedDrafts.find((entry) => entry.id === draftId) ?? null;
    const sent = send({
      type: "draft:resume",
      threadId,
      draftId,
    });
    if (sent && draft) {
      beginOptimisticResume(threadId, draft);
      pendingResumeFeedback = {
        threadId,
        draftId,
        prompt: draft.text,
        images: draft.images ? draft.images.map((image) => ({ ...image })) : [],
      };
    }
  }

  function removeDraft(threadId: string, draftId: string) {
    if (pendingResumeFeedback?.threadId === threadId && pendingResumeFeedback.draftId === draftId) {
      pendingResumeFeedback = null;
    }
    clearPendingResumeTimer(threadId, draftId);
    optimisticQueuedDrafts.set(
      threadId,
      (optimisticQueuedDrafts.get(threadId) ?? []).filter((draft) => draft.id !== draftId)
    );
    if ((optimisticQueuedDrafts.get(threadId) ?? []).length === 0) {
      optimisticQueuedDrafts.delete(threadId);
    }
    const thread = findThread(threadId);
    if (thread) {
      thread.queuedDrafts = thread.queuedDrafts.filter((draft) => draft.id !== draftId);
    }
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
    logFlowTrace,
    selectBridge,
    createThread,
    createThreadAndSend,
    selectThread,
    loadOlderMessages,
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
  if (event.type === "message:send") {
    logFlowTrace("ws.send.message", {
      threadId: event.threadId,
      promptTrace: buildPromptTraceKey(event.text, event.images ?? []),
      promptSummary: summarizePromptForTrace(event.text, event.images ?? []),
      model: event.model,
      planArmed: event.planArmed,
      fastMode: event.fastMode,
      accessMode: event.accessMode,
    });
  } else {
    logFlowTrace("ws.send.event", {
      eventType: event.type,
    });
  }
  socket.send(JSON.stringify(event));
  return true;
}

function handleServerEvent(event: ServerEvent) {
  switch (event.type) {
    case "thread:created":
      resolvePendingThreadCreateSuccess(event.requestId, event.threadId);
      break;
    case "thread:create-failed":
      rejectPendingThreadCreate(event.requestId, event.message);
      break;
    case "snapshot": {
      const nextSnapshot = mergeSnapshotWithPendingThread(event.snapshot);
      const previousSelectedThread = findThread(nextSnapshot.selectedThreadId ?? "");
      const nextSelectedThread = nextSnapshot.threads.find((thread) => thread.id === nextSnapshot.selectedThreadId) ?? null;
      if (nextSelectedThread) {
        beginPendingRunFeedbackFromResumedDraft(previousSelectedThread, nextSelectedThread, nextSnapshot.selectedThreadId);
        beginPendingRunFeedbackFromQueuedDraft(previousSelectedThread, nextSelectedThread, nextSnapshot.selectedThreadId);
      }
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
      logFlowTrace("ws.recv.thread-updated", {
        threadId: event.thread.id,
        state: event.thread.state,
        queuedDrafts: event.thread.queuedDrafts.length,
        selectedThreadId: event.selectedThreadId,
      });
      if (!state.snapshot) {
        return;
      }
      const nextSelectedThreadId = coercePendingThreadSelection(event.selectedThreadId);
      const existingThread = findThread(event.thread.id);
      beginPendingRunFeedbackFromResumedDraft(existingThread, event.thread, nextSelectedThreadId);
      beginPendingRunFeedbackFromQueuedDraft(existingThread, event.thread, nextSelectedThreadId);
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
      logFlowTrace("ws.recv.message-appended", {
        threadId: event.threadId,
        messageId: event.message.id,
        role: event.message.role,
        kind: event.message.kind,
        cardTypes: (event.message.cards ?? []).map((card) => card.type),
      });
      const thread = findThread(event.threadId);
      if (!thread) {
        return;
      }
      if (!thread.messages.some((message) => message.id === event.message.id)) {
        thread.messages.push(event.message);
        thread.lastActivityAt = event.message.createdAt;
        if (thread.history) {
          const totalMessages = thread.history.totalMessages + 1;
          const loadedMessages = thread.history.loadedMessages + 1;
          thread.history = {
            ...thread.history,
            totalMessages,
            loadedMessages,
            remainingMessages: Math.max(0, totalMessages - loadedMessages),
            hasMoreBefore: Math.max(0, totalMessages - loadedMessages) > 0,
            isHydrating: false,
          };
        }
      }
      syncPendingRunFeedbackFromMessage(event.threadId, event.message.role, event.message.text);
      break;
    }
    case "message:delta": {
      logFlowTrace("ws.recv.message-delta", {
        threadId: event.threadId,
        messageId: event.messageId,
        deltaLength: event.delta.length,
      });
      const thread = findThread(event.threadId);
      const message = thread?.messages.find((item) => item.id === event.messageId);
      if (message) {
        message.text += event.delta;
        message.isStreaming = true;
      }
      clearAcknowledgedPendingRunFeedback(event.threadId);
      break;
    }
    case "message:finished": {
      logFlowTrace("ws.recv.message-finished", {
        threadId: event.threadId,
        messageId: event.messageId,
      });
      const thread = findThread(event.threadId);
      const message = thread?.messages.find((item) => item.id === event.messageId);
      if (message) {
        message.isStreaming = false;
      }
      clearAcknowledgedPendingRunFeedback(event.threadId);
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
    return mergeIncomingQueuedDrafts(nextThread);
  }

  const shouldPreserveSelectedMessages =
    nextThread.id === selectedThreadId &&
    nextThread.messages.length === 0 &&
    existing.messages.length > 0;

  if (!shouldPreserveSelectedMessages) {
    return mergeIncomingQueuedDrafts(nextThread);
  }

  return mergeIncomingQueuedDrafts({
    ...nextThread,
    messages: existing.messages,
    history: existing.history ?? nextThread.history,
  });
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

function beginPendingThreadCreate(requestId: string, projectLabel: string, mode: ThreadCreateMode) {
  if (!state.snapshot) {
    return Promise.reject(new Error("Snapshot not ready."));
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

  return new Promise<string>((resolve, reject) => {
    pendingThreadCreate = {
      tempId,
      requestId,
      projectLabel,
      mode,
      previousSelectedThreadId,
      slowTimerId: window.setTimeout(() => {
        markPendingThreadCreateSlow(tempId, mode);
      }, PENDING_THREAD_SLOW_MS),
      failureTimerId: null,
      isSlow: false,
      resolve,
      reject,
    };
  });
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

function resolvePendingThreadCreateSuccess(requestId: string, threadId: string) {
  if (!pendingThreadCreate || pendingThreadCreate.requestId !== requestId) {
    return;
  }
  const pending = pendingThreadCreate;
  logFlowTrace("thread.create.resolved", {
    requestId,
    threadId,
    tempId: pending.tempId,
    projectLabel: pending.projectLabel,
    mode: pending.mode,
  });
  window.clearTimeout(pending.slowTimerId);
  if (pending.failureTimerId !== null) {
    window.clearTimeout(pending.failureTimerId);
  }
  if (state.snapshot) {
    const tempThread = state.snapshot.threads.find((thread) => thread.id === pending.tempId);
    if (tempThread) {
      tempThread.id = threadId;
      tempThread.preview = "Opening the new chat…";
      tempThread.lastActivityAt = new Date().toISOString();
    }
    if (state.snapshot.selectedThreadId === pending.tempId) {
      state.snapshot.selectedThreadId = threadId;
    }
  }
  pendingThreadCreate = null;
  pending.resolve(threadId);
}

function rejectPendingThreadCreate(requestId: string, message: string) {
  if (!pendingThreadCreate || pendingThreadCreate.requestId !== requestId) {
    return;
  }
  logFlowTrace("thread.create.rejected", {
    requestId,
    tempId: pendingThreadCreate.tempId,
    projectLabel: pendingThreadCreate.projectLabel,
    mode: pendingThreadCreate.mode,
    message,
  });
  const reject = pendingThreadCreate.reject;
  rollbackPendingThreadCreate(false);
  reject(new Error(message));
}

function rollbackPendingThreadCreate(pushFallbackToast = true) {
  if (!pendingThreadCreate) {
    return;
  }

  const { tempId, previousSelectedThreadId, slowTimerId, failureTimerId, reject } = pendingThreadCreate;
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
    reject(new Error("Unable to keep the pending chat open."));
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

function clearAcknowledgedPendingRunFeedback(threadId?: string) {
  const pending = state.ui.pendingRunFeedback;
  if (!pending) {
    return;
  }
  if (threadId && pending.threadId !== threadId) {
    return;
  }
  if (pending.promptAcknowledged) {
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
  if (!thread || thread.state === "archived") {
    state.ui.pendingRunFeedback = null;
    return;
  }
  if (pending.promptAcknowledged) {
    if (thread.state !== "running") {
      state.ui.pendingRunFeedback = null;
    }
    return;
  }
  if (thread.state === "running") {
    return;
  }
  if (Date.now() - Date.parse(pending.startedAt) > PENDING_RUN_FEEDBACK_STALE_MS) {
    state.ui.pendingRunFeedback = null;
  }
}

function syncPendingRunFeedbackFromMessage(threadId: string, role: string, text: string) {
  const pending = state.ui.pendingRunFeedback;
  if (!pending || pending.threadId !== threadId) {
    return;
  }

  if (role === "user" && normalizePendingRunPrompt(text) === normalizePendingRunPrompt(pending.prompt)) {
    logFlowTrace("pending-run.acknowledged", {
      threadId,
      promptTrace: buildPromptTraceKey(pending.prompt, pending.images),
      promptSummary: summarizePromptForTrace(pending.prompt, pending.images),
    });
    pending.promptAcknowledged = true;
    if (pendingResumeFeedback?.threadId === threadId && normalizePendingRunPrompt(text) === normalizePendingRunPrompt(pendingResumeFeedback.prompt)) {
      clearPendingResumeTimer(threadId, pendingResumeFeedback.draftId);
      pendingResumeFeedback = null;
    }
    return;
  }

  if (role !== "user") {
    clearAcknowledgedPendingRunFeedback(threadId);
  }
}

function beginPendingRunFeedbackFromQueuedDraft(
  existingThread: ThreadRecord | null,
  nextThread: ThreadRecord,
  selectedThreadId: string | null
) {
  if (state.ui.pendingRunFeedback || !existingThread) {
    return;
  }
  if (nextThread.id !== selectedThreadId || existingThread.state === "running" || nextThread.state !== "running") {
    return;
  }
  const resumedDraft =
    [...existingThread.queuedDrafts]
      .reverse()
      .find((draft) => !nextThread.queuedDrafts.some((nextDraft) => nextDraft.id === draft.id)) ?? null;
  if (!resumedDraft) {
    return;
  }
  beginPendingRunFeedback(nextThread.id, resumedDraft.text, resumedDraft.images ?? []);
}

function beginPendingRunFeedbackFromResumedDraft(
  existingThread: ThreadRecord | null,
  nextThread: ThreadRecord,
  selectedThreadId: string | null
) {
  if (!pendingResumeFeedback || !existingThread) {
    return;
  }
  if (pendingResumeFeedback.threadId !== nextThread.id || nextThread.id !== selectedThreadId) {
    return;
  }
  const draftWasPresent = existingThread.queuedDrafts.some((draft) => draft.id === pendingResumeFeedback?.draftId);
  const draftStillPresent = nextThread.queuedDrafts.some((draft) => draft.id === pendingResumeFeedback?.draftId);
  if (!draftWasPresent || draftStillPresent) {
    return;
  }
  clearPendingResumeTimer(nextThread.id, pendingResumeFeedback.draftId);
  if (!state.ui.pendingRunFeedback) {
    beginPendingRunFeedback(nextThread.id, pendingResumeFeedback.prompt, pendingResumeFeedback.images);
  }
  pendingResumeFeedback = null;
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
  const promptTrace = buildPromptTraceKey(text, images);
  const promptSummary = summarizePromptForTrace(text, images);
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
  logFlowTrace(willQueueDraft ? "composer.send.queued" : "composer.send.started", {
    threadId,
    promptTrace,
    promptSummary,
    model: state.ui.selectedModel,
    planArmed: state.ui.planArmed,
    fastMode: state.ui.fastMode,
    accessMode: state.ui.accessMode,
  });
  if (willQueueDraft) {
    addOptimisticQueuedDraft(threadId, text, images);
  } else {
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

export function persistComposerPreferences() {
  try {
    localStorage.setItem(
      COMPOSER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        selectedModel: state.ui.selectedModel,
        fastMode: state.ui.fastMode,
        planArmed: state.ui.planArmed,
        accessMode: state.ui.accessMode,
      } satisfies StoredComposerPreferences)
    );
  } catch {
    // Best-effort UI persistence only.
  }
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

function readStoredComposerPreferences(): StoredComposerPreferences {
  try {
    const raw = localStorage.getItem(COMPOSER_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as StoredComposerPreferences;
    return {
      selectedModel: typeof parsed.selectedModel === "string" ? parsed.selectedModel : undefined,
      fastMode: typeof parsed.fastMode === "boolean" ? parsed.fastMode : undefined,
      planArmed: typeof parsed.planArmed === "boolean" ? parsed.planArmed : undefined,
      accessMode:
        parsed.accessMode === "full-access" || parsed.accessMode === "on-request" || parsed.accessMode === "read-only"
          ? parsed.accessMode
          : undefined,
    };
  } catch {
    return {};
  }
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
