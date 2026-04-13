<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ACCESS_MODE_LABELS, MODELS } from "@phodex/shared";
import type { ThreadRecord } from "@phodex/shared";
import onboardingHero from "./assets/onboarding-hero.png";
import remodexAppLogo from "./assets/remodex-app-logo.png";
import { createAppClient, state } from "./lib/client";

const client = createAppClient();
type RootFlowState =
  | "onboarding"
  | "bootstrap-failure"
  | "subscription-gate"
  | "email-otp"
  | "auto";

type ShellPageState = "settings" | "archived" | "about" | "paywall";

type AppDialogState =
  | { kind: "rename-thread"; threadId: string; title: string }
  | { kind: "archive-group"; projectLabel: string; liveCount: number };

type TurnAutoScrollMode = "followBottom" | "anchorAssistantResponse" | "manual";

const verificationCode = ref("");
const dismissedBannerId = ref<string | null>(null);
const rootFlowState = ref<RootFlowState>(readRootFlowState());
const pendingShellPage = ref<ShellPageState | null>(readShellPageState());
const ONBOARDING_STORAGE_KEY = "phodex.onboarding-seen";
const onboardingPage = ref(0);
const onboardingSeen = ref(readOnboardingSeen());
const onboardingInstallWarningVisible = ref(false);
const onboardingTouchStartX = ref(0);
const selectedPlanId = ref("annual");
const shellPageStack = ref<ShellPageState[]>([]);
const activePanel = computed(() => shellPageStack.value.at(-1) ?? null);
const panelCanGoBack = computed(() => shellPageStack.value.length > 1);
const dialogState = ref<AppDialogState | null>(null);
const dialogInput = ref("");
const conversationScrollEl = ref<HTMLElement | null>(null);
const autoScrollMode = ref<TurnAutoScrollMode>("followBottom");
const isScrolledToBottom = ref(true);
const isUserScrolling = ref(false);
const autoScrollCooldownUntil = ref<number | null>(null);
const previousConversationHeight = ref(0);
const assistantAnchorState = ref<{ threadId: string | null; previousAssistantId: string | null } | null>(null);

const TURN_BOTTOM_THRESHOLD = 12;
const TURN_USER_SCROLL_COOLDOWN_MS = 250;
const TURN_CONTENT_HEIGHT_CORRECTION_THRESHOLD = 1;
const TURN_SCROLL_COALESCE_MS = 16;
const TURN_RECOVERY_DELAYS_MS = [0, 16, 50, 100] as const;
const PROGRAMMATIC_SCROLL_LOCK_MS = 120;
const WHEEL_SCROLL_END_DEBOUNCE_MS = 140;

let followBottomTimer: number | null = null;
let wheelScrollEndTimer: number | null = null;
let timelineSyncTimer: number | null = null;
let programmaticScrollUntil = 0;
let recoveryTimers: number[] = [];

const onboardingScreens = [
  {
    kind: "welcome",
    title: "Remodex",
    subtitle: "Control Codex from your iPhone.",
    badge: "Runs on your Mac",
  },
  {
    kind: "features",
    title: "What you get",
    subtitle: "Everything runs on your Mac. Your phone is the remote.",
    features: [
      {
        icon: "⚡",
        tone: "yellow",
        title: "Fast mode",
        subtitle: "Lower-latency turns for quick interactions",
      },
      {
        icon: "⑂",
        tone: "green",
        title: "Git from your phone",
        subtitle: "Commit, push, pull, and switch branches",
      },
      {
        icon: "⌁",
        tone: "cyan",
        title: "Live relay sync",
        subtitle: "Replies stream from the desktop session in real time",
      },
      {
        icon: "✎",
        tone: "purple",
        title: "Queued drafts",
        subtitle: "Write the next prompt while the current run is still streaming",
      },
      {
        icon: "△",
        tone: "orange",
        title: "Plans, skills and /commands",
        subtitle: "Use plan mode, slash commands, and file mentions from the mobile shell",
      },
    ],
  },
  {
    kind: "step",
    step: "Step 1",
    icon: "⌘",
    title: "Install Codex CLI",
    subtitle: "The AI coding agent that lives in your terminal. Remodex connects to it from your iPhone.",
    command: "npm install -g @openai/codex@latest",
  },
  {
    kind: "step",
    step: "Step 2",
    icon: "↔",
    title: "Install the Bridge",
    subtitle: "A lightweight relay that connects your Mac to your iPhone.",
    command: "npm install -g remodex@latest",
  },
  {
    kind: "step",
    step: "Step 3",
    icon: "@",
    title: "Start Remodex",
    subtitle: "Run this on your Mac, then continue here with email verification.",
    command: "remodex up",
  },
] as const;

const gatePlans = [
  {
    id: "monthly",
    title: "Monthly",
    price: "$3.99",
    subtitle: "Billed monthly",
    badge: "Popular",
  },
  {
    id: "annual",
    title: "Annual",
    price: "$29.99",
    subtitle: "Billed yearly",
    badge: "Best value",
  },
] as const;

const subscriptionGateFeatures = [
  {
    title: "Fast mode",
    subtitle: "Lower-latency turns for quick interactions",
  },
  {
    title: "Git from your phone",
    subtitle: "Commit, push, pull, and switch branches",
  },
  {
    title: "Live relay sync",
    subtitle: "Replies stream from the desktop session in real time",
  },
  {
    title: "Subagents",
    subtitle: "Delegate complex tasks to specialized sub-agents",
  },
  {
    title: "$skills /cmds @files",
    subtitle: "Invoke skills, run slash commands, and mention files inline",
  },
] as const;

const paywallFeatures = [
  "Fast mode",
  "Git from your phone",
  "Live relay sync",
  "Subagents",
  "$skills, /commands & @file mentions",
  "Hosted relay included",
  "Support development",
] as const;

const architectureSteps = [
  ["Remodex mobile UI", "HTTPS + WSS", "Phodex relay"],
  ["Phodex relay", "JSON-RPC", "Bridge (Mac)"],
  ["Bridge (Mac)", "JSONL rollout", "codex app-server"],
] as const;

const aboutSections = [
  {
    title: "How It Works",
    body:
      "Your Mac runs a lightweight bridge that connects to a relay server over WebSocket, and replies stream back to the iPhone in real time.",
  },
  {
    title: "Relay",
    body:
      "A lightweight WebSocket relay routes messages between your iPhone and your Mac and only needs connection metadata to do that job.",
  },
  {
    title: "Sign In",
    body:
      "Use a one-time email code to connect this phone to the relay session running from your Mac.",
  },
  {
    title: "Codex App-Server",
    body:
      "The bridge spawns codex app-server, so phone conversations stay first-class Codex sessions and produce JSONL rollout files under ~/.codex/sessions.",
  },
  {
    title: "Session Recovery",
    body:
      "If the phone disconnects, sign in again, reload the relay snapshot, and continue the same Codex threads from your Mac.",
  },
  {
    title: "Git & Workspace",
    body:
      "The bridge handles git commands from your phone locally on the Mac, including status, commit, push, pull, branch switching, and workspace revert flows.",
  },
  {
    title: "Desktop Integration",
    body:
      "All execution happens on your Mac, so code generation, tool use, file edits, and credentials stay on the desktop side while the phone acts as a focused remote.",
  },
] as const;

const fileSuggestionCatalog = [
  "apps/web/src/App.vue",
  "apps/web/src/style.css",
  "apps/web/src/lib/client.ts",
  "apps/server/src/index.ts",
  "packages/shared/src/index.ts",
] as const;

const skillSuggestionCatalog = [
  "$ui-ux-pro-max",
  "$electron-cdp-automation",
  "$checks",
] as const;

const slashCommandCatalog = [
  { value: "/plan", detail: "Prepare a step-by-step execution plan" },
  { value: "/review", detail: "Switch the turn into review mode" },
  { value: "/worktree", detail: "Hand this chat off into a worktree" },
  { value: "/status", detail: "Summarize current runtime and repo state" },
] as const;

onMounted(() => {
  void client.restoreSession().then(() => {
    if (pendingShellPage.value && isAuthenticated.value) {
      openPanel(pendingShellPage.value, true);
      pendingShellPage.value = null;
    }
  });
});

onBeforeUnmount(() => {
  clearFollowBottomTimer();
  clearWheelScrollEndTimer();
  clearTimelineSyncTimer();
  clearRecoveryTimers();
});

const isAuthenticated = computed(() => Boolean(state.session && state.snapshot));
const rootFlow = computed<RootFlowState>(() => {
  if (rootFlowState.value !== "auto") {
    return rootFlowState.value;
  }

  if (!onboardingSeen.value) {
    return "onboarding";
  }

  if (state.auth.phase === "requested") {
    return "email-otp";
  }

  return "email-otp";
});
const currentOnboardingScreen = computed(() => onboardingScreens[onboardingPage.value]);
const onboardingCtaLabel = computed(() => {
  if (onboardingPage.value === 0) return "Get Started";
  if (onboardingPage.value === 1) return "Set Up";
  if (onboardingPage.value === onboardingScreens.length - 1) return "Continue with Email";
  return "Continue";
});
const currentThread = computed(() => {
  if (!state.snapshot) {
    return null;
  }
  return state.snapshot.threads.find((thread) => thread.id === state.snapshot?.selectedThreadId) ?? null;
});
const isCurrentThreadPendingCreate = computed(() =>
  Boolean(currentThread.value?.id.startsWith("pending-thread:"))
);
const liveThreads = computed(() => (state.snapshot?.threads ?? []).filter((thread) => thread.state !== "archived"));
const visibleBanner = computed(() => {
  const banner = state.snapshot?.banner;
  if (!banner) {
    return null;
  }
  return banner.id === dismissedBannerId.value ? null : banner;
});
const threadGroups = computed(() => {
  const groups = new Map<string, ThreadRecord[]>();
  const search = state.ui.search.trim().toLowerCase();
  const threads = [...liveThreads.value]
    .filter((thread) => {
      if (!search) {
        return true;
      }
      return `${thread.title} ${thread.preview} ${thread.projectLabel}`.toLowerCase().includes(search);
    })
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt));

  for (const thread of threads) {
    const existing = groups.get(thread.projectLabel) ?? [];
    existing.push(thread);
    groups.set(thread.projectLabel, existing);
  }

  return [...groups.entries()].map(([label, threads]) => ({ label, threads, liveCount: threads.length }));
});
const archivedThreads = computed(() =>
  [...(state.snapshot?.threads ?? [])]
    .filter((thread) => thread.state === "archived")
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
);
const liveThreadCount = computed(() => (state.snapshot?.threads ?? []).filter((thread) => thread.state !== "archived").length);
const queuedDraftCount = computed(() =>
  (state.snapshot?.threads ?? []).reduce((count, thread) => count + thread.queuedDrafts.length, 0)
);
const connectionStatusLabel = computed(() => {
  switch (state.snapshot?.connection.state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "disconnected":
      return "Offline";
    default:
      return "Unknown";
  }
});
const composerPlaceholder = computed(() => {
  if (isCurrentThreadPendingCreate.value) {
    return "Starting a new chat on your Mac…";
  }
  return currentThread.value?.state === "running"
    ? "Write a follow-up while this run is still streaming..."
    : "Ask anything... @files, $skills, /commands";
});
const homeStatusLabel = computed(() => {
  switch (state.snapshot?.connection.state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "disconnected":
      return "Offline";
    default:
      return "Awaiting relay";
  }
});
const homeStatusTone = computed(() => {
  switch (state.snapshot?.connection.state) {
    case "connected":
      return "green";
    case "connecting":
      return "amber";
    default:
      return "slate";
  }
});
const homePrimaryLabel = computed(() => {
  switch (state.snapshot?.connection.state) {
    case "connected":
      return "Disconnect";
    case "connecting":
      return "Connecting…";
    case "disconnected":
      return "Reconnect with Email";
    default:
      return "Reconnect with Email";
  }
});
const homeSecondaryLabel = computed(() =>
  state.snapshot?.connection.state === "connected" ? "Open chats" : "Replay onboarding"
);
const homeStatusCopy = computed(() => {
  switch (state.snapshot?.connection.state) {
    case "connected":
      return "Your phone shell is connected. Open a chat or disconnect this trusted session.";
    case "connecting":
      return "The relay is still rehydrating thread state from the desktop side.";
    case "disconnected":
      return "Sign in again with email to reconnect this mobile shell to your Mac.";
    default:
      return "Reconnect to recover threads, queued drafts, and remote controls.";
  }
});
const currentThreadRepoName = computed(() => {
  const repoLabel = currentThread.value?.repoLabel ?? "";
  if (!repoLabel) {
    return "";
  }
  const segments = repoLabel.split("/").filter(Boolean);
  return segments.at(-1) ?? repoLabel;
});
const planAccessory = computed(() => {
  if (!currentThread.value || isCurrentThreadPendingCreate.value) {
    return null;
  }
  const latestPlan = [...currentThread.value.messages]
    .reverse()
    .find((message) => message.kind === "plan" && message.role === "assistant");

  if (latestPlan?.text.trim()) {
    return {
      title: currentThread.value.state === "running" ? "Plan in progress" : "Plan ready",
      summary: splitParagraphs(latestPlan.text)[0] ?? "Codex prepared a plan for this chat.",
      tone: currentThread.value.state === "running" ? "amber" : "blue",
    };
  }

  return null;
});
const composerWorkStateVisible = computed(() => Boolean(planAccessory.value || currentThread.value?.queuedDrafts.length));
const turnEmptyLabel = computed(() => (isCurrentThreadPendingCreate.value ? "Starting Chat" : "Empty Timeline"));
const turnEmptyTitle = computed(() =>
  isCurrentThreadPendingCreate.value ? "Creating a new chat on your Mac." : "Start the next turn from the composer."
);
const turnEmptyCopy = computed(() =>
  isCurrentThreadPendingCreate.value
    ? "The relay is asking Codex to start a fresh thread. The composer will unlock as soon as it lands."
    : "Replies, command cards, diffs, and queued follow-ups will stack here after your first message lands."
);
const showScrollToLatestButton = computed(() => Boolean(currentThread.value?.messages.length && !isScrolledToBottom.value));
const composerSuggestion = computed(() => {
  const match = state.ui.composerText.match(/(^|\s)([@$/])([^\s]*)$/);
  if (!match) {
    return null;
  }

  const prefix = match[2];
  const query = match[3].toLowerCase();

  if (prefix === "@") {
    const dynamicPaths = currentThread.value?.messages.flatMap((message) => message.fileChanges?.map((entry) => entry.path) ?? []) ?? [];
    const values = [...new Set([...fileSuggestionCatalog, ...dynamicPaths])]
      .filter((value) => value.toLowerCase().includes(query))
      .slice(0, 5)
      .map((value) => ({
        value: `@${value}`,
        title: value,
        detail: "Project file",
      }));
    return values.length ? { title: "Files", items: values } : null;
  }

  if (prefix === "$") {
    const values = skillSuggestionCatalog
      .filter((value) => value.toLowerCase().includes(`$${query}`) || value.toLowerCase().includes(query))
      .slice(0, 4)
      .map((value) => ({
        value,
        title: value,
        detail: "Installed skill",
      }));
    return values.length ? { title: "Skills", items: values } : null;
  }

  if (prefix === "/") {
    const values = slashCommandCatalog
      .filter((value) => value.value.toLowerCase().includes(`/${query}`) || value.value.toLowerCase().includes(query))
      .slice(0, 4)
      .map((value) => ({
        value: value.value,
        title: value.value,
        detail: value.detail,
      }));
    return values.length ? { title: "Commands", items: values } : null;
  }

  return null;
});
const dialogTitle = computed(() => {
  switch (dialogState.value?.kind) {
    case "rename-thread":
      return "Rename chat";
    case "archive-group":
      return `Archive "${dialogState.value.projectLabel}"?`;
    default:
      return "";
  }
});
const dialogBody = computed(() => {
  switch (dialogState.value?.kind) {
    case "rename-thread":
      return "Update the thread title shown in the sidebar and top navigation.";
    case "archive-group":
      return `All ${dialogState.value.liveCount} live chats in this project group will move to Archived Chats.`;
    default:
      return "";
  }
});
const dialogConfirmLabel = computed(() => {
  switch (dialogState.value?.kind) {
    case "rename-thread":
      return "Save";
    case "archive-group":
      return "Archive";
    default:
      return "Confirm";
  }
});
const activePanelTitle = computed(() => {
  switch (activePanel.value) {
    case "settings":
      return "Settings";
    case "archived":
      return "Archived Chats";
    case "about":
      return "About Remodex";
    case "paywall":
      return "Remodex Pro";
    default:
      return "";
  }
});

watch(
  () => currentThread.value?.id ?? null,
  async (nextThreadId) => {
    clearFollowBottomTimer();
    clearWheelScrollEndTimer();
    clearTimelineSyncTimer();
    clearRecoveryTimers();

    isUserScrolling.value = false;
    autoScrollCooldownUntil.value = null;

    if (assistantAnchorState.value?.threadId && nextThreadId && assistantAnchorState.value.threadId !== nextThreadId) {
      assistantAnchorState.value = null;
    }

    autoScrollMode.value = assistantAnchorState.value ? "anchorAssistantResponse" : "followBottom";

    if (assistantAnchorState.value && !assistantAnchorState.value.threadId && nextThreadId) {
      assistantAnchorState.value = {
        ...assistantAnchorState.value,
        threadId: nextThreadId,
      };
    }

    if (!nextThreadId) {
      previousConversationHeight.value = 0;
      isScrolledToBottom.value = true;
      assistantAnchorState.value = null;
      autoScrollMode.value = "followBottom";
      return;
    }

    await nextTick();
    previousConversationHeight.value = conversationScrollEl.value?.scrollHeight ?? 0;
    isScrolledToBottom.value = isConversationPinnedToBottom();
    scheduleRecoverySnaps(nextThreadId);
  },
  { flush: "post" }
);

watch(
  () => {
    const thread = currentThread.value;
    const lastMessage = thread?.messages.at(-1);
    return [
      thread?.id ?? "",
      thread?.state ?? "",
      thread?.messages.length ?? 0,
      lastMessage?.id ?? "",
      lastMessage?.text.length ?? 0,
      lastMessage?.isStreaming ? 1 : 0,
      lastMessage?.role ?? "",
    ].join("|");
  },
  () => {
    queueTimelineScrollSync();
  },
  { flush: "post" }
);

function formatRelativeTime(value: string) {
  const deltaMinutes = Math.max(1, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }
  const hours = Math.round(deltaMinutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatMessageRole(role: string) {
  if (role === "user") {
    return "You";
  }
  if (role === "assistant") {
    return "Codex";
  }
  return "System";
}

function formatMessageKind(kind: string) {
  return kind === "status" ? "activity" : kind;
}

function formatThreadState(thread: ThreadRecord | null) {
  if (!thread) {
    return "Ready";
  }
  if (thread.id.startsWith("pending-thread:")) {
    return "Starting";
  }
  const stateValue = thread.state;
  switch (stateValue) {
    case "running":
      return "Running";
    case "queued":
      return "Queued";
    case "archived":
      return "Archived";
    default:
      return "Ready";
  }
}

function threadStateTone(thread: ThreadRecord | null) {
  if (!thread) {
    return "green";
  }
  if (thread.id.startsWith("pending-thread:")) {
    return "amber";
  }
  const stateValue = thread.state;
  switch (stateValue) {
    case "running":
      return "amber";
    case "queued":
      return "blue";
    case "archived":
      return "slate";
    default:
      return "green";
  }
}

function splitParagraphs(text: string) {
  return text
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function projectGroupIcon(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("worktree")) {
    return "⑂";
  }
  if (normalized.includes("relay")) {
    return "↔";
  }
  if (normalized.includes("remodex")) {
    return "⌂";
  }
  return "•";
}

function preferredGroupMode(label: string): "local" | "worktree" {
  return label.toLowerCase().includes("worktree") ? "worktree" : "local";
}

function openSidebar() {
  state.ui.sidebarOpen = true;
}

function closeSidebar() {
  state.ui.sidebarOpen = false;
}

function setOnboardingPage(nextPage: number, skipInstallWarning = false) {
  const clamped = Math.max(0, Math.min(nextPage, onboardingScreens.length - 1));
  if (onboardingPage.value === 2 && clamped > 2 && !skipInstallWarning) {
    onboardingInstallWarningVisible.value = true;
    return;
  }
  onboardingPage.value = clamped;
}

function completeOnboarding() {
  onboardingSeen.value = true;
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  rootFlowState.value = "email-otp";
}

function advanceOnboarding(skipInstallWarning = false) {
  if (onboardingPage.value < onboardingScreens.length - 1) {
    setOnboardingPage(onboardingPage.value + 1, skipInstallWarning);
    return;
  }
  completeOnboarding();
}

function confirmInstallWarning() {
  onboardingInstallWarningVisible.value = false;
  advanceOnboarding(true);
}

function handleOnboardingTouchStart(event: TouchEvent) {
  onboardingTouchStartX.value = event.changedTouches[0]?.clientX ?? 0;
}

function handleOnboardingTouchEnd(event: TouchEvent) {
  const endX = event.changedTouches[0]?.clientX ?? 0;
  const delta = endX - onboardingTouchStartX.value;
  if (Math.abs(delta) < 42) {
    return;
  }
  if (delta < 0 && onboardingPage.value < onboardingScreens.length - 1) {
    setOnboardingPage(onboardingPage.value + 1);
    return;
  }
  if (delta > 0 && onboardingPage.value > 0) {
    setOnboardingPage(onboardingPage.value - 1, true);
  }
}

function restartOnboarding() {
  onboardingPage.value = 0;
  onboardingSeen.value = false;
  onboardingInstallWarningVisible.value = false;
  rootFlowState.value = "onboarding";
  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  shellPageStack.value = [];
}

async function handleRequestCode() {
  await client.requestCode();
}

async function handleVerifyCode() {
  const ok = await client.verifyCode(verificationCode.value);
  if (ok) {
    verificationCode.value = "";
  }
}

function handleSend() {
  const activeThread = currentThread.value;
  const shouldArmAssistantAnchor = activeThread ? activeThread.state !== "running" : true;
  if (!currentThread.value) {
    client.createThreadAndSend("Phodex Web", "local");
    if (shouldArmAssistantAnchor) {
      armAssistantAnchor(null);
    }
    return;
  }
  const didSend = client.sendComposer(currentThread.value.id);
  if (didSend && shouldArmAssistantAnchor) {
    armAssistantAnchor(currentThread.value.id);
  }
}

function handleRenameThread(threadId: string, currentTitle: string) {
  dialogInput.value = currentTitle;
  dialogState.value = {
    kind: "rename-thread",
    threadId,
    title: currentTitle,
  };
}

function handleArchiveGroup(projectLabel: string) {
  const group = threadGroups.value.find((entry) => entry.label === projectLabel);
  if (!group) {
    return;
  }
  dialogState.value = {
    kind: "archive-group",
    projectLabel,
    liveCount: group.liveCount,
  };
}

function startLocalChat() {
  client.createThread(currentThread.value?.projectLabel ?? "Phodex Web", "local");
  closeSidebar();
}

function startWorktreeChat() {
  client.createThread(currentThread.value?.projectLabel ?? "Phodex Web", "worktree");
  closeSidebar();
}

function openPanel(panel: ShellPageState, replace = false) {
  if (panel === "settings") {
    shellPageStack.value = ["settings"];
    state.ui.sidebarOpen = false;
    return;
  }

  if (replace || !shellPageStack.value.length) {
    shellPageStack.value = [panel];
  } else if (shellPageStack.value.at(-1) !== panel) {
    shellPageStack.value = [...shellPageStack.value, panel];
  }
  state.ui.sidebarOpen = false;
}

function closePanel() {
  if (shellPageStack.value.length > 1) {
    shellPageStack.value = shellPageStack.value.slice(0, -1);
    return;
  }

  shellPageStack.value = [];
}

function dismissBanner() {
  dismissedBannerId.value = state.snapshot?.banner?.id ?? null;
}

function closeDialog() {
  dialogState.value = null;
  dialogInput.value = "";
}

function confirmDialogAction() {
  if (!dialogState.value) {
    return;
  }

  if (dialogState.value.kind === "rename-thread") {
    const nextTitle = dialogInput.value.trim();
    if (nextTitle) {
      client.renameThread(dialogState.value.threadId, nextTitle);
    }
    closeDialog();
    return;
  }

  if (dialogState.value.kind === "archive-group") {
    const projectLabel = dialogState.value.projectLabel;
    const group = threadGroups.value.find((entry) => entry.label === projectLabel);
    if (group) {
      for (const thread of group.threads) {
        if (thread.state !== "archived") {
          client.toggleArchiveThread(thread);
        }
      }
    }
    closeDialog();
  }
}

function applyComposerSuggestion(value: string) {
  state.ui.composerText = state.ui.composerText.replace(/(^|\s)([@$/])([^\s]*)$/, (_match, space) => `${space}${value} `);
}

function handleHomePrimaryAction() {
  if (state.snapshot?.connection.state === "connected") {
    client.logout();
    shellPageStack.value = [];
    return;
  }
  client.logout();
}

function handleHomeSecondaryAction() {
  if (state.snapshot?.connection.state === "connected") {
    openSidebar();
    return;
  }
  restartOnboarding();
}

function switchRootFlow(nextFlow: RootFlowState) {
  rootFlowState.value = nextFlow;
  if (nextFlow === "auto") {
    return;
  }

  if (nextFlow === "onboarding") {
    onboardingSeen.value = false;
    return;
  }

  if (nextFlow === "bootstrap-failure" || nextFlow === "subscription-gate" || nextFlow === "email-otp") {
    onboardingSeen.value = true;
  }
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function readOnboardingSeen() {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readRootFlowState(): RootFlowState {
  try {
    const value = new URLSearchParams(window.location.search).get("flow");
    if (
      value === "bootstrap-failure" ||
      value === "subscription-gate" ||
      value === "email-otp"
    ) {
      return value;
    }

    if (value === "camera-permission" || value === "scanner" || value === "scanner-error" || value === "bridge-update") {
      return "email-otp";
    }
  } catch {
    return "auto";
  }

  return "auto";
}

function readShellPageState(): ShellPageState | null {
  try {
    const value = new URLSearchParams(window.location.search).get("page");
    if (value === "settings" || value === "archived" || value === "about" || value === "paywall") {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

function queueTimelineScrollSync() {
  clearTimelineSyncTimer();
  timelineSyncTimer = window.setTimeout(() => {
    timelineSyncTimer = null;
    void syncTimelineScrollAfterMutation();
  }, TURN_SCROLL_COALESCE_MS);
}

async function syncTimelineScrollAfterMutation() {
  await nextTick();
  const thread = currentThread.value;
  const scrollEl = conversationScrollEl.value;
  if (!thread || !scrollEl) {
    return;
  }

  const previousHeight = previousConversationHeight.value;
  const nextHeight = scrollEl.scrollHeight;
  const wasPinnedToBottom = isScrolledToBottom.value || autoScrollMode.value !== "manual";
  const shouldCorrectBottom =
    wasPinnedToBottom &&
    previousHeight > 0 &&
    nextHeight > 0 &&
    Math.abs(nextHeight - previousHeight) > TURN_CONTENT_HEIGHT_CORRECTION_THRESHOLD;

  if (assistantAnchorState.value && thread.state !== "running" && !latestAssistantMessage(thread)) {
    assistantAnchorState.value = null;
    autoScrollMode.value = isConversationPinnedToBottom() ? "followBottom" : "manual";
  }

  if (assistantAnchorState.value && autoScrollMode.value === "anchorAssistantResponse") {
    const latestAssistant = latestAssistantMessage(thread);
    const anchorThreadId = assistantAnchorState.value.threadId ?? thread.id;
    const hasNewAssistant =
      anchorThreadId === thread.id &&
      latestAssistant &&
      latestAssistant.id !== assistantAnchorState.value.previousAssistantId;

    if (hasNewAssistant && latestAssistant) {
      scrollMessageToTop(latestAssistant.id, "smooth", 260);
      assistantAnchorState.value = null;
      autoScrollMode.value = "manual";
      previousConversationHeight.value = nextHeight;
      return;
    }

    if (!isAutomaticScrollingPaused()) {
      scheduleFollowBottomScroll();
    }
    previousConversationHeight.value = nextHeight;
    return;
  }

  if (autoScrollMode.value === "followBottom" && !isAutomaticScrollingPaused()) {
    scheduleFollowBottomScroll();
  } else if (shouldCorrectBottom && !isAutomaticScrollingPaused()) {
    scheduleFollowBottomScroll();
  }

  previousConversationHeight.value = nextHeight;
  isScrolledToBottom.value = isConversationPinnedToBottom();
}

function armAssistantAnchor(threadId: string | null) {
  assistantAnchorState.value = {
    threadId,
    previousAssistantId: latestAssistantMessage(currentThread.value)?.id ?? null,
  };
  autoScrollMode.value = "anchorAssistantResponse";
  autoScrollCooldownUntil.value = null;
}

function latestAssistantMessage(thread: ThreadRecord | null) {
  if (!thread) {
    return null;
  }
  return [...thread.messages].reverse().find((message) => message.role === "assistant") ?? null;
}

function isAutomaticScrollingPaused(now = Date.now()) {
  if (isUserScrolling.value) {
    return true;
  }
  return autoScrollCooldownUntil.value !== null && now < autoScrollCooldownUntil.value;
}

function isConversationPinnedToBottom() {
  const scrollEl = conversationScrollEl.value;
  if (!scrollEl) {
    return true;
  }
  return scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - TURN_BOTTOM_THRESHOLD;
}

function scheduleFollowBottomScroll() {
  if (followBottomTimer !== null) {
    return;
  }
  followBottomTimer = window.setTimeout(() => {
    followBottomTimer = null;
    scrollConversationToBottom("auto", PROGRAMMATIC_SCROLL_LOCK_MS);
  }, TURN_SCROLL_COALESCE_MS);
}

function clearFollowBottomTimer() {
  if (followBottomTimer !== null) {
    window.clearTimeout(followBottomTimer);
    followBottomTimer = null;
  }
}

function clearWheelScrollEndTimer() {
  if (wheelScrollEndTimer !== null) {
    window.clearTimeout(wheelScrollEndTimer);
    wheelScrollEndTimer = null;
  }
}

function clearTimelineSyncTimer() {
  if (timelineSyncTimer !== null) {
    window.clearTimeout(timelineSyncTimer);
    timelineSyncTimer = null;
  }
}

function clearRecoveryTimers() {
  for (const timer of recoveryTimers) {
    window.clearTimeout(timer);
  }
  recoveryTimers = [];
}

function scrollConversationToBottom(behavior: ScrollBehavior = "auto", lockDurationMs = PROGRAMMATIC_SCROLL_LOCK_MS) {
  const scrollEl = conversationScrollEl.value;
  if (!scrollEl) {
    return;
  }
  programmaticScrollUntil = Date.now() + lockDurationMs;
  scrollEl.scrollTo({
    top: scrollEl.scrollHeight,
    behavior,
  });
  previousConversationHeight.value = scrollEl.scrollHeight;
  window.setTimeout(() => {
    isScrolledToBottom.value = isConversationPinnedToBottom();
  }, 0);
}

function scrollMessageToTop(messageId: string, behavior: ScrollBehavior = "smooth", lockDurationMs = 260) {
  const scrollEl = conversationScrollEl.value;
  if (!scrollEl) {
    return;
  }
  const target = scrollEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!target) {
    scrollConversationToBottom(behavior, lockDurationMs);
    return;
  }
  programmaticScrollUntil = Date.now() + lockDurationMs;
  scrollEl.scrollTo({
    top: Math.max(0, target.offsetTop - 8),
    behavior,
  });
  window.setTimeout(() => {
    isScrolledToBottom.value = isConversationPinnedToBottom();
  }, 0);
}

function scheduleRecoverySnaps(threadId: string) {
  clearRecoveryTimers();
  recoveryTimers = TURN_RECOVERY_DELAYS_MS.map((delay) =>
    window.setTimeout(() => {
      if (currentThread.value?.id !== threadId || autoScrollMode.value === "manual") {
        return;
      }
      scrollConversationToBottom("auto", PROGRAMMATIC_SCROLL_LOCK_MS);
    }, delay)
  );
}

function beginUserScrollIntent() {
  isUserScrolling.value = true;
  if (autoScrollMode.value !== "anchorAssistantResponse") {
    autoScrollMode.value = "manual";
  }
}

function finishUserScrollIntent() {
  clearWheelScrollEndTimer();
  isUserScrolling.value = false;
  autoScrollCooldownUntil.value = Date.now() + TURN_USER_SCROLL_COOLDOWN_MS;
  if (autoScrollMode.value === "anchorAssistantResponse") {
    return;
  }
  autoScrollMode.value = isConversationPinnedToBottom() ? "followBottom" : "manual";
}

function handleConversationPointerDown() {
  beginUserScrollIntent();
}

function handleConversationPointerUp() {
  finishUserScrollIntent();
}

function handleConversationWheel() {
  beginUserScrollIntent();
  clearWheelScrollEndTimer();
  wheelScrollEndTimer = window.setTimeout(() => {
    finishUserScrollIntent();
  }, WHEEL_SCROLL_END_DEBOUNCE_MS);
}

function handleConversationScroll() {
  isScrolledToBottom.value = isConversationPinnedToBottom();
  previousConversationHeight.value = conversationScrollEl.value?.scrollHeight ?? previousConversationHeight.value;

  if (Date.now() < programmaticScrollUntil) {
    return;
  }

  if (autoScrollMode.value === "anchorAssistantResponse") {
    return;
  }

  if (!isScrolledToBottom.value && isUserScrolling.value) {
    autoScrollMode.value = "manual";
  }
}

function handleScrollToLatest() {
  assistantAnchorState.value = null;
  autoScrollMode.value = "followBottom";
  autoScrollCooldownUntil.value = null;
  scrollConversationToBottom("smooth", 260);
}
</script>

<template>
  <div class="app-page">
    <div class="app-shell">
        <div v-if="state.ui.loadingSession" class="phone-splash">
              <img :src="remodexAppLogo" alt="" class="phone-splash__logo" />
              <p>Hydrating relay session…</p>
        </div>

        <template v-else-if="!isAuthenticated">
              <section
                v-if="rootFlow === 'onboarding'"
                class="onboarding-flow"
                @touchstart.passive="handleOnboardingTouchStart"
                @touchend.passive="handleOnboardingTouchEnd"
              >
                <template v-if="currentOnboardingScreen.kind === 'welcome'">
                  <div class="onboarding-flow__welcome">
                    <img :src="onboardingHero" alt="" class="onboarding-flow__welcome-image" />
                    <div class="onboarding-flow__welcome-fade"></div>
                    <div class="onboarding-flow__welcome-copy">
                      <img :src="remodexAppLogo" alt="" class="onboarding-flow__logo" />
                      <div>
                        <h1>{{ currentOnboardingScreen.title }}</h1>
                        <p>{{ currentOnboardingScreen.subtitle }}</p>
                      </div>
                      <span class="onboarding-flow__badge">{{ currentOnboardingScreen.badge }}</span>
                    </div>
                  </div>
                </template>

                <template v-else-if="currentOnboardingScreen.kind === 'features'">
                  <div class="onboarding-flow__content">
                    <span class="section-label section-label--light">Overview</span>
                    <h2>{{ currentOnboardingScreen.title }}</h2>
                    <p>{{ currentOnboardingScreen.subtitle }}</p>

                    <div class="onboarding-feature-list">
                      <article
                        v-for="feature in currentOnboardingScreen.features"
                        :key="feature.title"
                        class="onboarding-feature-row"
                      >
                        <div class="onboarding-feature-row__icon" :class="`onboarding-feature-row__icon--${feature.tone}`">
                          {{ feature.icon }}
                        </div>
                        <div>
                          <strong>{{ feature.title }}</strong>
                          <p>{{ feature.subtitle }}</p>
                        </div>
                      </article>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div class="onboarding-flow__content onboarding-flow__content--step">
                    <span class="section-label section-label--light">{{ currentOnboardingScreen.step }}</span>
                    <div class="onboarding-step-icon">{{ currentOnboardingScreen.icon }}</div>
                    <h2>{{ currentOnboardingScreen.title }}</h2>
                    <p>{{ currentOnboardingScreen.subtitle }}</p>
                    <div class="onboarding-command-card">{{ currentOnboardingScreen.command }}</div>
                  </div>
                </template>

                <div class="onboarding-flow__bottom">
                  <div class="onboarding-flow__dots">
                    <button
                      v-for="(_, index) in onboardingScreens"
                      :key="index"
                      class="onboarding-flow__dot"
                      :class="{ 'onboarding-flow__dot--active': onboardingPage === index }"
                      @click="setOnboardingPage(index, index <= onboardingPage)"
                    ></button>
                  </div>
                  <button class="primary-cta primary-cta--dark" @click="advanceOnboarding()">
                    {{ onboardingCtaLabel }}
                  </button>
                </div>

                <transition name="scrim">
                  <div v-if="onboardingInstallWarningVisible" class="alert-scrim">
                    <div class="alert-card">
                      <span class="section-label section-label--light">Before you continue</span>
                      <h3>Install Codex CLI first.</h3>
                      <p>Copy and paste the install command on your Mac before moving on. Remodex will not work until Codex CLI is available in your PATH.</p>
                      <div class="alert-card__actions">
                        <button class="ghost-cta ghost-cta--dark ghost-cta--compact" @click="onboardingInstallWarningVisible = false">
                          Not yet
                        </button>
                        <button class="primary-cta primary-cta--dark primary-cta--compact" @click="confirmInstallWarning">
                          Continue
                        </button>
                      </div>
                    </div>
                  </div>
                </transition>
              </section>

              <section v-else-if="rootFlow === 'bootstrap-failure'" class="root-auth-screen">
                <div class="root-auth-screen__backdrop root-auth-screen__backdrop--failure"></div>
                <header class="root-auth-screen__topbar">
                  <button class="icon-button icon-button--dark" @click="switchRootFlow('onboarding')">‹</button>
                  <span>Subscription</span>
                  <span class="root-auth-screen__topbar-spacer"></span>
                </header>
                <div class="root-auth-screen__card">
                  <div class="root-auth-screen__head">
                    <div class="root-auth-screen__hero-icon">!</div>
                    <span class="section-label section-label--light">Bootstrap Failure</span>
                    <h2>Couldn’t load subscription status</h2>
                    <p>Remodex couldn’t confirm your Pro access yet. Check your connection, retry, or continue with email while purchases stay preview-only in this local build.</p>
                  </div>

                  <button class="primary-cta primary-cta--dark" @click="switchRootFlow('subscription-gate')">Retry</button>
                  <button class="ghost-cta ghost-cta--dark" @click="switchRootFlow('email-otp')">Continue with Email</button>

                  <div class="root-auth-screen__links">
                    <button class="root-auth-screen__link" @click="openExternal('https://example.com/privacy')">Privacy</button>
                    <button class="root-auth-screen__link" @click="openExternal('https://example.com/terms')">Terms</button>
                  </div>
                </div>
              </section>

              <section v-else-if="rootFlow === 'subscription-gate'" class="root-auth-screen">
                <div class="root-auth-screen__backdrop"></div>
                <header class="root-auth-screen__topbar">
                  <button class="icon-button icon-button--dark" @click="switchRootFlow('bootstrap-failure')">‹</button>
                  <span>Remodex Pro</span>
                  <span class="root-auth-screen__topbar-spacer"></span>
                </header>
                <div class="root-auth-screen__card root-auth-screen__card--gate">
                  <div class="root-auth-screen__head">
                    <img :src="remodexAppLogo" alt="" class="root-auth-screen__logo" />
                    <span class="section-label section-label--light">Subscription Gate</span>
                    <h2>Unlock the app to connect your iPhone to Codex running on your Mac.</h2>
                    <p>Purchase and restore are preview-only in this local build. Continue with email to keep testing the relay flow.</p>
                  </div>

                  <div class="gate-plan-scroll">
                    <article
                      v-for="plan in gatePlans"
                      :key="plan.id"
                      class="gate-plan-card"
                      :class="{ 'gate-plan-card--active': selectedPlanId === plan.id }"
                      @click="selectedPlanId = plan.id"
                    >
                      <div class="gate-plan-card__head">
                        <strong>{{ plan.title }}</strong>
                        <span>{{ plan.badge }}</span>
                      </div>
                      <div class="gate-plan-card__price">{{ plan.price }}</div>
                      <p>{{ plan.subtitle }}</p>
                    </article>
                  </div>

                  <div class="root-auth-screen__feature-list">
                    <article v-for="feature in subscriptionGateFeatures" :key="feature.title" class="root-auth-screen__feature-row">
                      <strong>{{ feature.title }}</strong>
                      <p>{{ feature.subtitle }}</p>
                    </article>
                  </div>

                  <button class="primary-cta primary-cta--dark" @click="switchRootFlow('email-otp')">Continue with Email</button>
                  <div class="root-auth-screen__links">
                    <button class="root-auth-screen__link" @click="switchRootFlow('email-otp')">Use Email OTP</button>
                    <button class="root-auth-screen__link" @click="openExternal('https://example.com/privacy')">Privacy</button>
                    <button class="root-auth-screen__link" @click="openExternal('https://example.com/terms')">Terms</button>
                  </div>
                </div>
              </section>

              <section v-else class="root-auth-screen">
                <div class="root-auth-screen__backdrop"></div>
                <header class="root-auth-screen__topbar">
                  <button class="icon-button icon-button--dark" @click="switchRootFlow('onboarding')">‹</button>
                  <span>Email OTP</span>
                  <span class="root-auth-screen__topbar-spacer"></span>
                </header>
                <div class="root-auth-screen__card root-auth-screen__card--email">
                  <div class="root-auth-screen__head">
                    <img :src="remodexAppLogo" alt="" class="root-auth-screen__logo" />
                    <span class="section-label section-label--light">Email OTP</span>
                    <h2>Continue with email verification.</h2>
                    <p>Use a one-time verification code to connect this phone to the relay session running on your Mac.</p>
                  </div>

                  <label class="input-label input-label--dark" for="email">Email</label>
                  <input
                    id="email"
                    v-model="state.auth.email"
                    class="input-field input-field--dark"
                    type="email"
                    inputmode="email"
                    placeholder="you@example.com"
                  />

                  <button class="primary-cta primary-cta--dark" :disabled="state.ui.sendingCode" @click="handleRequestCode">
                    {{ state.ui.sendingCode ? "Requesting…" : "Send verification code" }}
                  </button>

                  <template v-if="state.auth.phase === 'requested'">
                    <label class="input-label input-label--stacked input-label--dark" for="code">Verification code</label>
                    <input
                      id="code"
                      v-model="verificationCode"
                      class="input-field input-field--code input-field--dark"
                      type="text"
                      inputmode="numeric"
                      maxlength="6"
                      placeholder="123456"
                    />

                    <button class="primary-cta primary-cta--dark" :disabled="state.ui.verifyingCode" @click="handleVerifyCode">
                      {{ state.ui.verifyingCode ? "Verifying…" : "Continue into relay" }}
                    </button>

                    <button
                      v-if="state.auth.devAuthBypassEnabled"
                      class="ghost-cta ghost-cta--dark"
                      @click="client.loadDevCode()"
                    >
                      Read local backdoor data
                    </button>
                  </template>

                  <p v-if="state.ui.authStatus" class="root-auth-screen__status">{{ state.ui.authStatus }}</p>

                  <div v-if="state.ui.devCode || state.auth.staticBackdoorCode" class="root-auth-screen__backdoor">
                    <div class="root-auth-screen__backdoor-row">
                      <span>Latest OTP</span>
                      <strong>{{ state.ui.devCode ?? "Pending" }}</strong>
                    </div>
                    <div class="root-auth-screen__backdoor-row">
                      <span>Static backdoor</span>
                      <strong>{{ state.auth.staticBackdoorCode ?? "Disabled" }}</strong>
                    </div>
                  </div>

                  <button class="root-auth-screen__text-link" @click="restartOnboarding">Show setup flow again</button>
                </div>
              </section>
            </template>

            <template v-else>
              <transition name="panel" mode="out-in">
                <section v-if="activePanel" :key="activePanel" class="mobile-page" :class="`mobile-page--${activePanel}`">
                  <header class="mobile-page__topbar">
                    <button class="mobile-page__nav" @click="closePanel">{{ panelCanGoBack ? "‹ Back" : "Done" }}</button>
                    <strong>{{ activePanelTitle }}</strong>
                    <span class="mobile-page__spacer"></span>
                  </header>

                  <div class="mobile-page__body">
                    <template v-if="activePanel === 'settings' && state.snapshot">
                      <section class="settings-card">
                        <span class="section-label">Archived Chats</span>
                        <button class="settings-row-button" @click="openPanel('archived')">
                          <span>Archived Chats</span>
                          <strong>{{ archivedThreads.length }}</strong>
                        </button>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">Appearance</span>
                        <label class="settings-toggle">
                          <span>Mono UI text</span>
                          <input
                            type="checkbox"
                            :checked="state.snapshot.settings.fontStyle === 'mono'"
                            @change="client.updateSettings({ fontStyle: state.snapshot!.settings.fontStyle === 'mono' ? 'system' : 'mono' })"
                          />
                        </label>
                        <label class="settings-toggle">
                          <span>Liquid glass</span>
                          <input
                            type="checkbox"
                            :checked="state.snapshot.settings.glassMode"
                            @change="client.updateSettings({ glassMode: !state.snapshot!.settings.glassMode })"
                          />
                        </label>
                        <label class="settings-toggle">
                          <span>Reduced motion</span>
                          <input
                            type="checkbox"
                            :checked="state.snapshot.settings.reducedMotion"
                            @change="client.updateSettings({ reducedMotion: !state.snapshot!.settings.reducedMotion })"
                          />
                        </label>
                        <button class="ghost-cta ghost-cta--compact" @click="restartOnboarding">Replay onboarding</button>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">Notifications</span>
                        <label class="settings-toggle">
                          <span>Run complete notifications</span>
                          <input
                            type="checkbox"
                            :checked="state.snapshot.settings.notifications"
                            @change="client.updateSettings({ notifications: !state.snapshot!.settings.notifications })"
                          />
                        </label>
                        <p class="settings-copy">Used for local alerts when a run finishes while the shell is backgrounded.</p>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">GPT Account</span>
                        <div class="settings-metric-row">
                          <span>Status</span>
                          <strong>{{ state.snapshot.connection.state === "connected" ? "Bridge connected" : "Awaiting bridge" }}</strong>
                        </div>
                        <p class="settings-copy">Account-aware extras remain deferred in this local build.</p>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">Remodex Pro</span>
                        <p class="settings-copy">Open the Pro preview. Purchase and restore remain disabled in this local build.</p>
                        <button class="primary-cta primary-cta--compact" @click="openPanel('paywall')">Open Pro Preview</button>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">Bridge Version</span>
                        <div class="settings-metric-row">
                          <span>Installed on Mac</span>
                          <strong>{{ state.snapshot.connection.relayLabel }}</strong>
                        </div>
                        <div class="settings-metric-row">
                          <span>Relay latency</span>
                          <strong>{{ state.snapshot.connection.latencyMs }}ms</strong>
                        </div>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">Runtime Defaults</span>
                        <div class="settings-metric-row">
                          <span>Model</span>
                          <strong>{{ state.ui.selectedModel }}</strong>
                        </div>
                        <div class="settings-metric-row">
                          <span>Access</span>
                          <strong>{{ ACCESS_MODE_LABELS[state.ui.accessMode] }}</strong>
                        </div>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">About</span>
                        <button class="settings-row-button" @click="openPanel('about')">
                          <span>About Remodex</span>
                          <strong>Open</strong>
                        </button>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">Usage</span>
                        <div class="settings-metric-row">
                          <span>Live chats</span>
                          <strong>{{ liveThreadCount }}</strong>
                        </div>
                        <div class="settings-metric-row">
                          <span>Queued drafts</span>
                          <strong>{{ queuedDraftCount }}</strong>
                        </div>
                        <div class="settings-metric-row">
                          <span>Connection</span>
                          <strong>{{ connectionStatusLabel }}</strong>
                        </div>
                      </section>

                      <section class="settings-card">
                        <span class="section-label">Connection</span>
                        <div class="settings-metric-row">
                          <span>Mac</span>
                          <strong>{{ state.snapshot.connection.macLabel }}</strong>
                        </div>
                        <div class="settings-metric-row">
                          <span>Relay</span>
                          <strong>{{ state.snapshot.connection.relayLabel }}</strong>
                        </div>
                        <button class="ghost-cta" @click="client.logout()">Sign out</button>
                      </section>
                    </template>

                    <template v-else-if="activePanel === 'archived'">
                      <section class="archived-page">
                        <p class="settings-copy archived-page__note">
                          Permanent delete is unavailable in the current Codex bridge. Archived chats can only be restored.
                        </p>
                        <div v-if="archivedThreads.length" class="archived-list">
                          <article v-for="thread in archivedThreads" :key="thread.id" class="archived-row">
                            <div>
                              <strong>{{ thread.title }}</strong>
                              <span class="archived-row__time">{{ formatRelativeTime(thread.lastActivityAt) }}</span>
                              <p>{{ thread.preview }}</p>
                            </div>
                            <div class="archived-row__actions">
                              <button class="archived-row__action" @click="client.toggleArchiveThread(thread)">Restore</button>
                            </div>
                          </article>
                        </div>
                        <div v-else class="archived-empty">
                          <span class="archived-empty__icon">▣</span>
                          <strong>No archived chats</strong>
                          <p class="settings-copy">Archived conversations will appear here after you move a chat out of the main thread list.</p>
                        </div>
                      </section>
                    </template>

                    <template v-else-if="activePanel === 'about'">
                      <section class="about-header">
                        <span class="section-label">Remodex</span>
                        <h2 class="settings-hero-title">Control Codex from your iPhone.</h2>
                        <p class="settings-copy">
                          The Codex runtime stays on your Mac. Your phone is a focused remote control connected through a relay.
                        </p>
                      </section>

                      <div class="about-divider"></div>

                      <section class="about-section">
                        <span class="section-label">Architecture</span>
                        <div class="about-diagram">
                          <div v-for="step in architectureSteps" :key="step[0]" class="about-diagram__row">
                            <strong>{{ step[0] }}</strong>
                            <span>{{ step[1] }}</span>
                            <strong>{{ step[2] }}</strong>
                          </div>
                        </div>
                      </section>

                      <template v-for="section in aboutSections" :key="section.title">
                        <div class="about-divider"></div>
                        <section class="about-section">
                          <span class="section-label">{{ section.title }}</span>
                          <p class="settings-copy">{{ section.body }}</p>
                        </section>
                      </template>
                    </template>

                    <template v-else-if="activePanel === 'paywall'">
                      <section class="paywall-card">
                        <div class="paywall-header">
                          <img :src="remodexAppLogo" alt="" class="paywall-header__logo" />
                          <span class="section-label">Remodex Pro</span>
                          <h2 class="settings-hero-title">Unlock Remodex Pro</h2>
                          <p class="settings-copy">Everything runs on your Mac. Your phone is the remote.</p>
                        </div>

                        <div class="paywall-feature-list">
                          <div v-for="feature in paywallFeatures" :key="feature" class="paywall-feature-row">
                            <span class="paywall-feature-row__dot"></span>
                            <span>{{ feature }}</span>
                          </div>
                        </div>

                        <div class="paywall-plan-list">
                          <button
                            v-for="plan in gatePlans"
                            :key="`paywall-${plan.id}`"
                            class="paywall-plan-row"
                            :class="{ 'paywall-plan-row--active': selectedPlanId === plan.id }"
                            @click="selectedPlanId = plan.id"
                          >
                            <div>
                              <strong>{{ plan.title }}</strong>
                              <p>{{ plan.subtitle }}</p>
                            </div>
                            <span>{{ plan.price }}</span>
                          </button>
                        </div>

                        <button class="primary-cta" disabled>Purchase Preview Only</button>

                        <div class="paywall-footer">
                          <p class="settings-copy">Purchase, restore, and manage are preview-only in this local build.</p>
                          <div class="paywall-footer__links">
                            <button class="root-auth-screen__link" disabled>Restore Preview</button>
                            <button class="root-auth-screen__link" disabled>Manage Preview</button>
                            <button class="root-auth-screen__link">Privacy</button>
                            <button class="root-auth-screen__link">Terms</button>
                          </div>
                        </div>
                      </section>
                    </template>
                  </div>
                </section>
              </transition>

              <transition v-if="!activePanel" name="panel" mode="out-in">
                <div key="main-shell" class="phone-app">
                  <transition name="drawer">
                    <aside v-if="state.ui.sidebarOpen" class="phone-drawer phone-drawer--open">
                      <div class="phone-drawer__head">
                        <div class="drawer-brand">
                          <img :src="remodexAppLogo" alt="" class="drawer-brand__logo" />
                          <div class="drawer-brand__copy">
                            <span class="section-label">{{ homeStatusLabel }}</span>
                            <strong class="drawer-brand__title">Remodex</strong>
                          </div>
                        </div>
                        <button class="icon-button" aria-label="Close menu" @click="closeSidebar">×</button>
                      </div>

                      <input
                        v-model="state.ui.search"
                        class="drawer-search"
                        type="search"
                        placeholder="Search conversations"
                      />

                      <button class="drawer-new-chat" @click="startLocalChat">
                        <span class="drawer-new-chat__icon">＋</span>
                        <div class="drawer-new-chat__copy">
                          <strong>New Chat</strong>
                          <p>Start from the active local checkout.</p>
                        </div>
                      </button>

                      <div class="drawer-shortcuts">
                        <button
                          class="drawer-shortcut"
                          :class="{ 'drawer-shortcut--active': !currentThread }"
                          @click="client.clearThreadSelection()"
                        >
                          Home
                        </button>
                        <button class="drawer-shortcut" @click="startWorktreeChat">New Worktree</button>
                        <button class="drawer-shortcut" @click="openPanel('about')">About</button>
                      </div>

                      <div class="drawer-groups">
                        <section v-for="group in threadGroups" :key="group.label" class="drawer-group">
                          <div class="drawer-group__head">
                            <div class="drawer-group__title">
                              <span class="drawer-group__icon">{{ projectGroupIcon(group.label) }}</span>
                              <p class="drawer-group__label">{{ group.label }}</p>
                            </div>
                            <div class="drawer-group__head-actions">
                              <button class="drawer-group__action" @click="handleArchiveGroup(group.label)">
                                Archive {{ group.liveCount }}
                              </button>
                              <button class="drawer-group__plus" @click="client.createThread(group.label, preferredGroupMode(group.label))">
                                +
                              </button>
                            </div>
                          </div>

                          <button
                            v-for="thread in group.threads"
                            :key="thread.id"
                            class="drawer-thread"
                            :class="{
                              'drawer-thread--selected': currentThread?.id === thread.id,
                              'drawer-thread--archived': thread.state === 'archived',
                            }"
                            @click="
                              client.selectThread(thread.id);
                              closeSidebar();
                            "
                          >
                            <div class="drawer-thread__indicator">
                              <span :class="`drawer-thread__dot drawer-thread__dot--${thread.state}`"></span>
                              <span v-if="thread.isWorktree" class="drawer-thread__badge">⑂</span>
                              <span v-else-if="thread.isForked" class="drawer-thread__badge">⇄</span>
                            </div>

                            <div class="drawer-thread__body">
                              <div class="drawer-thread__top">
                                <strong>{{ thread.title }}</strong>
                                <span>{{ formatRelativeTime(thread.lastActivityAt) }}</span>
                              </div>
                              <p>{{ thread.preview }}</p>
                              <div class="drawer-thread__meta">
                                <span>{{ thread.repoLabel }}</span>
                                <span>{{ thread.branch }}</span>
                                <span>+{{ thread.diff.additions }} -{{ thread.diff.deletions }}</span>
                                <span v-if="thread.subagentCount">{{ thread.subagentCount }} agents</span>
                                <span v-if="thread.queuedDrafts.length">{{ thread.queuedDrafts.length }} queued</span>
                                <span v-if="thread.unreadCount">{{ thread.unreadCount }} unread</span>
                              </div>
                            </div>

                            <div class="drawer-thread__actions">
                              <button class="icon-button icon-button--tiny" @click.stop="handleRenameThread(thread.id, thread.title)">✎</button>
                              <button class="icon-button icon-button--tiny" @click.stop="client.toggleArchiveThread(thread)">
                                {{ thread.state === "archived" ? "↺" : "⌁" }}
                              </button>
                            </div>
                          </button>
                        </section>
                      </div>

                      <div class="phone-drawer__foot">
                        <div class="phone-drawer__footer-card">
                          <span class="drawer-status__label">
                            {{ state.snapshot?.connection.state === "connected" ? "Connected to Mac" : "Trusted Mac" }}
                          </span>
                          <div class="drawer-status__row">
                            <div class="drawer-status">
                              <strong>{{ state.snapshot?.connection.macLabel }}</strong>
                              <span class="drawer-status__relay">{{ state.snapshot?.connection.relayLabel }}</span>
                            </div>
                            <strong v-if="state.snapshot?.connection.state === 'connected'" class="drawer-status__latency">
                              {{ state.snapshot?.connection.latencyMs }}ms
                            </strong>
                          </div>
                        </div>

                        <button class="drawer-settings-bar" @click="openPanel('settings')">Settings</button>

                        <div class="drawer-footer-actions">
                          <button class="drawer-footer-pill" @click="openPanel('archived')">Archived</button>
                          <button class="drawer-footer-pill" @click="client.logout()">Disconnect</button>
                        </div>
                      </div>
                    </aside>
                  </transition>

                  <transition name="scrim">
                    <button v-if="state.ui.sidebarOpen" class="phone-drawer-scrim phone-drawer-scrim--visible" @click="closeSidebar"></button>
                  </transition>

                  <header class="phone-topbar">
                    <button class="icon-button" @click="openSidebar">☰</button>

                    <div class="phone-topbar__title" :class="{ 'phone-topbar__title--home': !currentThread }">
                      <span class="section-label">{{ currentThread?.projectLabel ?? "Remodex" }}</span>
                      <strong>{{ currentThread?.title ?? "Home" }}</strong>
                    </div>

                    <button v-if="!currentThread" class="icon-button phone-topbar__action" aria-label="Settings" @click="openPanel('settings')">⚙</button>
                    <span v-else class="phone-topbar__spacer" aria-hidden="true"></span>
                  </header>

                  <transition name="banner">
                    <div v-if="visibleBanner" class="phone-banner">
                      <div>
                        <span class="section-label">Run Complete</span>
                        <strong>{{ visibleBanner.title }}</strong>
                        <p>{{ visibleBanner.subtitle }}</p>
                      </div>
                      <button class="icon-button icon-button--tiny" @click="dismissBanner">×</button>
                    </div>
                  </transition>

                  <section v-if="currentThread" class="turn-toolbar">
                    <div class="turn-toolbar__inner">
                      <div class="turn-toolbar__strip">
                        <span class="turn-chip" :class="`turn-chip--${threadStateTone(currentThread)}`">
                          {{ formatThreadState(currentThread) }}
                        </span>
                        <span class="turn-chip">+{{ currentThread.diff.additions }} -{{ currentThread.diff.deletions }}</span>
                        <span class="turn-chip">{{ currentThread.branch }}</span>
                        <span class="turn-chip turn-chip--muted">{{ currentThreadRepoName || currentThread.projectLabel }}</span>
                      </div>
                      <div class="turn-toolbar__actions">
                        <button class="turn-toolbar__action" @click="startLocalChat">New Chat</button>
                        <button class="turn-toolbar__action" @click="startWorktreeChat">Worktree</button>
                        <button class="turn-toolbar__action turn-toolbar__action--muted" @click="openSidebar">
                          {{ state.snapshot?.connection.macLabel }}
                        </button>
                      </div>
                    </div>
                  </section>

                  <section
                    ref="conversationScrollEl"
                    class="phone-conversation"
                    @pointerdown="handleConversationPointerDown"
                    @pointerup="handleConversationPointerUp"
                    @pointercancel="handleConversationPointerUp"
                    @wheel.passive="handleConversationWheel"
                    @scroll.passive="handleConversationScroll"
                  >
                    <div class="phone-conversation__inner">
                      <template v-if="currentThread && currentThread.messages.length">
                        <article
                          v-for="message in currentThread.messages"
                          :key="message.id"
                          :data-message-id="message.id"
                          class="phone-message"
                          :class="`phone-message--${message.role}`"
                        >
                          <div class="phone-message__meta">
                            <span>{{ formatMessageRole(message.role) }}</span>
                            <span>{{ formatRelativeTime(message.createdAt) }}</span>
                            <span>{{ formatMessageKind(message.kind) }}</span>
                          </div>

                          <div class="phone-message__card">
                            <p v-if="message.emphasis" class="message-emphasis">{{ message.emphasis }}</p>

                            <div v-if="message.cards?.length" class="message-card-stack">
                              <article
                                v-for="(card, index) in message.cards"
                                :key="`${message.id}-card-${index}`"
                                class="message-card"
                                :class="[`message-card--${card.type}`, `message-card--${card.tone}`]"
                              >
                                <div class="message-card__head">
                                  <div>
                                    <span class="section-label">{{ card.title }}</span>
                                    <strong v-if="card.type === 'command' && card.command">{{ card.command }}</strong>
                                    <strong v-else-if="card.type === 'tool'">{{ card.toolLabel }}</strong>
                                    <strong v-else-if="card.type === 'image'">{{ card.detail ?? card.title }}</strong>
                                  </div>
                                  <span v-if="'statusLabel' in card" class="message-card__status">{{ card.statusLabel }}</span>
                                </div>

                                <p v-if="'detail' in card && card.type !== 'image' && card.type !== 'status' && card.detail" class="message-card__detail">
                                  {{ card.detail }}
                                </p>
                                <p v-else-if="card.type === 'status' && card.detail" class="message-card__detail">
                                  {{ card.detail }}
                                </p>

                                <div v-if="card.type === 'image'" class="message-card__image-path">
                                  <span>{{ card.meta ?? card.path }}</span>
                                </div>

                                <p v-if="'meta' in card && card.meta" class="message-card__meta-line">{{ card.meta }}</p>
                                <pre v-if="'output' in card && card.output" class="message-card__output"><code>{{ card.output }}</code></pre>
                              </article>
                            </div>

                            <div v-if="message.runEvents?.length" class="run-event-stack">
                              <div
                                v-for="event in message.runEvents"
                                :key="`${message.id}-${event.label}`"
                                class="run-event-row"
                              >
                                <span :class="`run-event-row__dot run-event-row__dot--${event.tone}`"></span>
                                <strong>{{ event.label }}</strong>
                                <span>{{ event.detail }}</span>
                              </div>
                            </div>

                            <div v-if="message.text" class="phone-message__copy">
                              <p v-for="paragraph in splitParagraphs(message.text)" :key="`${message.id}-${paragraph}`">
                                {{ paragraph }}
                              </p>
                              <span v-if="message.isStreaming" class="stream-cursor"></span>
                            </div>

                            <pre v-if="message.codeBlock" class="phone-message__code"><code>{{ message.codeBlock.content }}</code></pre>

                            <div v-if="message.fileChanges?.length" class="file-change-stack">
                              <div
                                v-for="change in message.fileChanges"
                                :key="`${message.id}-${change.path}`"
                                class="file-change-row"
                              >
                                <span>{{ change.action }}</span>
                                <strong>{{ change.path }}</strong>
                                <em>+{{ change.additions }} -{{ change.deletions }}</em>
                              </div>
                            </div>
                          </div>
                        </article>
                      </template>

                      <div v-else-if="currentThread" class="turn-empty-state">
                        <div class="turn-empty-state__marker" aria-hidden="true"></div>
                        <div class="turn-empty-state__card">
                          <span class="section-label">{{ turnEmptyLabel }}</span>
                          <h2>{{ turnEmptyTitle }}</h2>
                          <p>{{ turnEmptyCopy }}</p>
                          <div class="turn-empty-state__chips">
                            <span class="turn-empty-state__chip">/plan</span>
                            <span class="turn-empty-state__chip">@files</span>
                            <span class="turn-empty-state__chip">$skills</span>
                          </div>
                        </div>
                      </div>

                      <div v-else class="home-empty-state">
                        <div class="home-empty-state__tabs">
                          <span class="home-empty-state__tab home-empty-state__tab--active">Home</span>
                          <span class="home-empty-state__tab">
                            <span :class="`home-empty-state__tab-dot home-empty-state__tab-dot--${homeStatusTone}`"></span>
                            {{ homeStatusLabel }}
                          </span>
                        </div>
                        <img :src="remodexAppLogo" alt="" class="home-empty-state__logo" />
                        <div class="home-status-badge">
                          <span :class="`home-status-badge__dot home-status-badge__dot--${homeStatusTone}`"></span>
                          <strong>{{ homeStatusLabel }}</strong>
                        </div>
                        <div v-if="state.snapshot?.connection.macLabel" class="home-empty-state__trusted-card">
                          <span class="section-label">
                            {{ state.snapshot.connection.state === "connected" ? "Connected To Mac" : "Trusted Mac" }}
                          </span>
                          <div class="home-empty-state__trusted-row">
                            <span class="home-empty-state__trusted-icon">⌂</span>
                            <div class="home-empty-state__trusted">
                              <strong>{{ state.snapshot?.connection.macLabel }}</strong>
                              <p>{{ state.snapshot?.connection.relayLabel }}</p>
                            </div>
                          </div>
                        </div>
                        <p class="home-empty-state__copy">{{ homeStatusCopy }}</p>
                        <button
                          class="primary-cta primary-cta--compact home-empty-state__primary"
                          :disabled="state.snapshot?.connection.state === 'connecting'"
                          @click="handleHomePrimaryAction"
                        >
                          {{ homePrimaryLabel }}
                        </button>
                        <button class="home-empty-state__secondary" @click="handleHomeSecondaryAction">{{ homeSecondaryLabel }}</button>
                      </div>
                    </div>
                  </section>

                  <footer v-if="currentThread" class="phone-composer-dock">
                    <div class="phone-composer-dock__inner">
                      <button
                        v-if="showScrollToLatestButton"
                        class="scroll-latest-cta"
                        type="button"
                        aria-label="Scroll to latest"
                        @click="handleScrollToLatest"
                      >
                        <span aria-hidden="true">↓</span>
                      </button>

                      <div v-if="composerWorkStateVisible" class="composer-work-state">
                        <div v-if="planAccessory" class="plan-accessory" :class="`plan-accessory--${planAccessory.tone}`">
                          <div class="plan-accessory__head">
                            <span class="section-label">Pinned Plan</span>
                            <span class="plan-accessory__tone">{{ planAccessory.title }}</span>
                          </div>
                          <p>{{ planAccessory.summary }}</p>
                        </div>

                        <div v-if="currentThread?.queuedDrafts.length" class="queued-drafts">
                          <div class="queued-drafts__head">
                            <span class="section-label">Queued Drafts</span>
                            <strong>{{ currentThread.queuedDrafts.length }}</strong>
                          </div>

                          <div v-for="draft in currentThread.queuedDrafts" :key="draft.id" class="queued-draft">
                            <div class="queued-draft__copy">
                              <strong>{{ draft.text }}</strong>
                              <span>{{ formatRelativeTime(draft.createdAt) }}</span>
                            </div>
                            <div class="queued-draft__actions">
                              <button
                                class="ghost-cta ghost-cta--compact"
                                @click="client.resumeDraft(currentThread.id, draft.id)"
                              >
                                Resume
                              </button>
                              <button class="queued-draft__remove" @click="client.removeDraft(currentThread.id, draft.id)">
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div v-if="composerSuggestion" class="composer-autocomplete">
                        <span class="section-label">{{ composerSuggestion.title }}</span>
                        <button
                          v-for="item in composerSuggestion.items"
                          :key="item.value"
                          class="composer-autocomplete__item"
                          @click="applyComposerSuggestion(item.value)"
                        >
                          <strong>{{ item.title }}</strong>
                          <span>{{ item.detail }}</span>
                        </button>
                      </div>

                      <div class="phone-composer">
                        <textarea
                          v-model="state.ui.composerText"
                          class="phone-composer__input"
                          :disabled="isCurrentThreadPendingCreate"
                          :placeholder="composerPlaceholder"
                          rows="3"
                        ></textarea>

                        <div class="phone-composer__toolbar">
                          <div class="phone-composer__toolbar-left">
                            <select v-model="state.ui.selectedModel" class="phone-select" :disabled="isCurrentThreadPendingCreate">
                              <option v-for="model in MODELS" :key="model">{{ model }}</option>
                            </select>
                          </div>

                          <div class="phone-composer__toolbar-right">
                            <button
                              v-if="currentThread?.state === 'running'"
                              class="composer-circle composer-circle--dark"
                              @click="client.stopRun(currentThread.id)"
                            >
                              ■
                            </button>
                            <button
                              class="send-cta send-cta--circle"
                              :disabled="isCurrentThreadPendingCreate"
                              :title="
                                isCurrentThreadPendingCreate
                                  ? 'Starting'
                                  : currentThread?.state === 'running'
                                    ? 'Queue'
                                    : 'Send'
                              "
                              @click="handleSend"
                            >
                              {{ currentThread?.state === "running" ? "+" : "↑" }}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div class="phone-secondary-bar">
                        <span class="pill">Local</span>
                        <button
                          class="pill pill--button"
                          :disabled="isCurrentThreadPendingCreate"
                          @click="
                            state.ui.accessMode =
                              state.ui.accessMode === 'full-access'
                                ? 'on-request'
                                : state.ui.accessMode === 'on-request'
                                  ? 'read-only'
                                  : 'full-access'
                          "
                        >
                          {{ ACCESS_MODE_LABELS[state.ui.accessMode] }}
                        </button>
                        <span class="pill">{{ currentThread?.branch ?? "main" }}</span>
                        <span class="pill pill--muted">{{ state.snapshot?.connection.macLabel }}</span>
                      </div>
                    </div>
                  </footer>
                </div>
              </transition>

              <transition name="scrim">
                <div v-if="dialogState" class="app-dialog-scrim">
                  <div class="app-dialog-card">
                    <span class="section-label">{{ dialogState.kind === "rename-thread" ? "Rename" : "Confirm" }}</span>
                    <h3>{{ dialogTitle }}</h3>
                    <p>{{ dialogBody }}</p>

                    <input
                      v-if="dialogState.kind === 'rename-thread'"
                      v-model="dialogInput"
                      class="input-field app-dialog-card__input"
                      type="text"
                      placeholder="Conversation title"
                    />

                    <div class="alert-card__actions">
                      <button class="ghost-cta ghost-cta--compact" @click="closeDialog">Cancel</button>
                      <button class="primary-cta primary-cta--compact" @click="confirmDialogAction">{{ dialogConfirmLabel }}</button>
                    </div>
                  </div>
                </div>
              </transition>

              <div class="toast-stack">
                <div
                  v-for="toast in state.ui.toasts"
                  :key="toast.id"
                  class="toast-card"
                  :class="`toast-card--${toast.tone}`"
                >
                  {{ toast.message }}
                </div>
              </div>
        </template>
    </div>
  </div>
</template>
