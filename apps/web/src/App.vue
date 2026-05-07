<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import { ACCESS_MODE_LABELS, MODELS } from "@phodex/shared";
import type {
  AccessMode,
  BridgeDeviceSummary,
  CodexRateLimitSnapshot,
  CodexRateLimitWindow,
  ImageMessageCard,
  InputImageAttachment,
  ProjectDiffFile,
  ProjectDiffPayload,
  ProjectFilePayload,
  ProjectTreeEntry,
  ProjectTreePayload,
  ThreadCreateMode,
  ThreadRecord,
} from "@phodex/shared";
import onboardingHero from "./assets/onboarding-hero.png";
import remodexAppLogo from "./assets/remodex-app-logo.png";
import { API_ORIGIN, createAppClient, fetchSessionJson, persistComposerPreferences, state } from "./lib/client";

type AppIconName =
  | "archive"
  | "arrow-down"
  | "arrow-up"
  | "bolt"
  | "check"
  | "chevron-left"
  | "chevron-down"
  | "close"
  | "copy"
  | "edit"
  | "file"
  | "folder"
  | "home"
  | "info"
  | "lock"
  | "menu"
  | "more-horizontal"
  | "plus"
  | "relay"
  | "restore"
  | "stop"
  | "terminal"
  | "trash"
  | "unlock"
  | "worktree";

type AppIconSpec = {
  circles?: Array<{ cx: number; cy: number; r: number }>;
  lines?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  paths?: string[];
  polylines?: string[];
};

type DrawerProjectTarget = {
  label: string;
  cwd: string | null;
  repoName: string;
  detail: string;
  liveCount: number;
  hasWorktree: boolean;
  isCurrent: boolean;
};

type RateLimitDisplayRow = {
  key: "primary" | "secondary";
  label: string;
  detail: string;
  remainingPercent: number;
};

type DrawerThreadGroup = {
  label: string;
  threads: DrawerThreadSummary[];
  liveCount: number;
  cwd: string | null;
  hasWorktree: boolean;
};

type DrawerThreadSummary = {
  id: string;
  title: string;
  state: ThreadRecord["state"];
  projectLabel: string;
  repoLabel: string;
  createdAt: string;
  isWorktree: boolean;
  isForked: boolean;
};

type InstallManifest = {
  version: string;
  relayOrigin: string;
  relayLabel: string;
  installScriptUrl: string;
  bridgeInstallerUrl?: string;
  bridgeRuntimeUrl: string;
  setupToken?: string;
  setupTokenExpiresAt?: string;
  command: string;
  windowsCommand: string;
};

type InstallCommandPlatform = "shell" | "powershell";

type MessageInlineSegment = {
  type: "text" | "code" | "link" | "file-link" | "image-link";
  text?: string;
  label?: string;
  displayLabel?: string;
  href?: string;
  line?: number | null;
};

type TurnStarterAction = {
  label: string;
  prompt: string;
};

type ImagePreviewState = {
  src: string;
  title: string;
  meta?: string;
};

const APP_ICON_SPECS: Record<AppIconName, AppIconSpec> = {
  archive: {
    lines: [
      { x1: 4, y1: 8, x2: 20, y2: 8 },
      { x1: 12, y1: 5, x2: 12, y2: 13 },
    ],
    paths: ["M6 8.5v7.25A2.25 2.25 0 0 0 8.25 18h7.5A2.25 2.25 0 0 0 18 15.75V8.5"],
    polylines: ["9.25 10.5 12 13.25 14.75 10.5"],
  },
  "arrow-down": {
    lines: [{ x1: 12, y1: 6.5, x2: 12, y2: 17.5 }],
    polylines: ["7.5 13 12 17.5 16.5 13"],
  },
  "arrow-up": {
    lines: [{ x1: 12, y1: 17.5, x2: 12, y2: 6.5 }],
    polylines: ["7.5 11 12 6.5 16.5 11"],
  },
  bolt: {
    paths: ["M13.5 3.75 6.75 12.25H11l-1 8 7.25-8h-4.25z"],
  },
  check: {
    polylines: ["5.5 12.5 10 17 18.5 8.5"],
  },
  "chevron-left": {
    polylines: ["14.75 6.5 9.25 12 14.75 17.5"],
  },
  "chevron-down": {
    polylines: ["6.5 9.5 12 15 17.5 9.5"],
  },
  close: {
    lines: [
      { x1: 7, y1: 7, x2: 17, y2: 17 },
      { x1: 17, y1: 7, x2: 7, y2: 17 },
    ],
  },
  copy: {
    paths: [
      "M8.5 7.25h8.25A1.25 1.25 0 0 1 18 8.5v8.25A1.25 1.25 0 0 1 16.75 18H8.5a1.25 1.25 0 0 1-1.25-1.25V8.5A1.25 1.25 0 0 1 8.5 7.25z",
      "M5.75 14.75H5A1.25 1.25 0 0 1 3.75 13.5V5A1.25 1.25 0 0 1 5 3.75h8.5A1.25 1.25 0 0 1 14.75 5v.75",
    ],
  },
  edit: {
    lines: [{ x1: 13.5, y1: 6.5, x2: 17.5, y2: 10.5 }],
    paths: ["M4.5 19.5H8l9.4-9.4a2 2 0 1 0-2.82-2.82L5.18 16.68z"],
  },
  file: {
    paths: ["M8 3.75h6.1l4.15 4.15V19a1.25 1.25 0 0 1-1.25 1.25H8A1.25 1.25 0 0 1 6.75 19V5A1.25 1.25 0 0 1 8 3.75z", "M14.1 3.75V8h4.25"],
  },
  folder: {
    paths: ["M3.75 8.5A2.75 2.75 0 0 1 6.5 5.75H10l2.1 2.1h5.4a2.75 2.75 0 0 1 2.75 2.75v5.9a2.75 2.75 0 0 1-2.75 2.75h-11A2.75 2.75 0 0 1 3.75 16.5z"],
  },
  home: {
    paths: ["M4.75 10.5 12 4.75l7.25 5.75V19a1 1 0 0 1-1 1h-4.5v-5.25h-3.5V20h-4.5a1 1 0 0 1-1-1z"],
  },
  info: {
    circles: [{ cx: 12, cy: 12, r: 8.5 }],
    lines: [
      { x1: 12, y1: 10.5, x2: 12, y2: 16 },
      { x1: 12, y1: 7.5, x2: 12, y2: 7.5 },
    ],
  },
  lock: {
    paths: ["M7.25 10.25h9.5a1.25 1.25 0 0 1 1.25 1.25v6.25A1.25 1.25 0 0 1 16.75 19h-9.5A1.25 1.25 0 0 1 6 17.75V11.5a1.25 1.25 0 0 1 1.25-1.25z", "M8.75 10.25V8a3.25 3.25 0 0 1 6.5 0v2.25"],
  },
  menu: {
    lines: [
      { x1: 5, y1: 7, x2: 19, y2: 7 },
      { x1: 5, y1: 12, x2: 19, y2: 12 },
      { x1: 5, y1: 17, x2: 19, y2: 17 },
    ],
  },
  "more-horizontal": {
    circles: [
      { cx: 6.5, cy: 12, r: 1.2 },
      { cx: 12, cy: 12, r: 1.2 },
      { cx: 17.5, cy: 12, r: 1.2 },
    ],
  },
  plus: {
    lines: [
      { x1: 12, y1: 7.25, x2: 12, y2: 16.75 },
      { x1: 7.25, y1: 12, x2: 16.75, y2: 12 },
    ],
  },
  relay: {
    circles: [{ cx: 12, cy: 15.75, r: 1.4 }],
    paths: [
      "M8.5 12.75a5 5 0 0 1 7 0",
      "M5.75 9.75a8.75 8.75 0 0 1 12.5 0",
    ],
  },
  restore: {
    lines: [
      { x1: 4, y1: 8, x2: 20, y2: 8 },
      { x1: 12, y1: 13, x2: 12, y2: 5 },
    ],
    paths: ["M6 8.5v7.25A2.25 2.25 0 0 0 8.25 18h7.5A2.25 2.25 0 0 0 18 15.75V8.5"],
    polylines: ["9.25 7.5 12 4.75 14.75 7.5"],
  },
  stop: {
    paths: ["M8 8h8v8H8z"],
  },
  terminal: {
    lines: [
      { x1: 13.5, y1: 17.25, x2: 18.5, y2: 17.25 },
      { x1: 11, y1: 6.75, x2: 19, y2: 6.75 },
    ],
    polylines: ["5.5 8 9.5 12 5.5 16"],
  },
  trash: {
    lines: [
      { x1: 5, y1: 7, x2: 19, y2: 7 },
      { x1: 10, y1: 11, x2: 10, y2: 17 },
      { x1: 14, y1: 11, x2: 14, y2: 17 },
    ],
    paths: [
      "M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7",
      "M7 7l.75 12A1.25 1.25 0 0 0 9 20.25h6A1.25 1.25 0 0 0 16.25 19L17 7",
    ],
  },
  unlock: {
    paths: ["M7.25 10.25h9.5a1.25 1.25 0 0 1 1.25 1.25v6.25A1.25 1.25 0 0 1 16.75 19h-9.5A1.25 1.25 0 0 1 6 17.75V11.5a1.25 1.25 0 0 1 1.25-1.25z", "M8.75 10.25V8a3.25 3.25 0 0 1 5.8-2"],
  },
  worktree: {
    circles: [
      { cx: 7, cy: 5.75, r: 1.7 },
      { cx: 17, cy: 9.25, r: 1.7 },
      { cx: 17, cy: 17.25, r: 1.7 },
    ],
    lines: [
      { x1: 7, y1: 7.45, x2: 7, y2: 12 },
      { x1: 7, y1: 12, x2: 17, y2: 12 },
      { x1: 17, y1: 11.1, x2: 17, y2: 7.55 },
      { x1: 17, y1: 12.9, x2: 17, y2: 15.55 },
    ],
  },
};

const AppIcon = defineComponent({
  name: "AppIcon",
  props: {
    name: {
      type: String as PropType<AppIconName>,
      required: true,
    },
  },
  setup(props) {
    return () => {
      const spec = APP_ICON_SPECS[props.name];
      return h(
        "svg",
        {
          class: "app-icon",
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "1.92",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "aria-hidden": "true",
        },
        [
          ...(spec.paths?.map((d) => h("path", { d })) ?? []),
          ...(spec.lines?.map((line) => h("line", line)) ?? []),
          ...(spec.polylines?.map((points) => h("polyline", { points })) ?? []),
          ...(spec.circles?.map((circle) => h("circle", circle)) ?? []),
        ]
      );
    };
  },
});

const client = createAppClient();
type RootFlowState =
  | "onboarding"
  | "bootstrap-failure"
  | "subscription-gate"
  | "email-otp"
  | "auto";

type ShellPageState = "archived" | "paywall";

type AppDialogState =
  | { kind: "rename-thread"; threadId: string; title: string }
  | { kind: "delete-thread"; threadId: string; title: string }
  | { kind: "archive-group"; projectLabel: string; liveCount: number }
  | {
      kind: "create-thread";
      mode: ThreadCreateMode;
      projectLabel: string;
      cwd: string | null;
      customCwdInput: string;
      useCustomCwd: boolean;
    }
  | {
      kind: "project-browser";
      threadId: string;
      title: string;
      currentPath: string;
      selectedFilePath: string | null;
    }
  | {
      kind: "project-diff";
      threadId: string;
      title: string;
      filterPath: string | null;
      selectedDiffPath: string | null;
    };

type TurnAutoScrollMode = "followBottom" | "manual";
type PendingThreadRouteState = {
  machineId: string | null;
  threadId: string;
};
type ThreadCreateNavigationPromise = Promise<string> & {
  tempId?: string;
};
type DeferredThreadCreateRequest = {
  projectLabel: string;
  mode: ThreadCreateMode;
  cwd?: string;
  waitingForDialogLeave: boolean;
  waitingForDrawerLeave: boolean;
};

type AppRouteName =
  | "home"
  | "thread"
  | "archived"
  | "paywall"
  | "onboarding"
  | "email-otp"
  | "subscription-gate"
  | "bootstrap-failure";

const PANEL_ROUTE_NAMES: Record<ShellPageState, AppRouteName> = {
  archived: "archived",
  paywall: "paywall",
};

const ROUTE_NAME_TO_PANEL: Partial<Record<AppRouteName, ShellPageState>> = {
  archived: "archived",
  paywall: "paywall",
};

const FLOW_ROUTE_NAMES: Partial<Record<Exclude<RootFlowState, "auto">, AppRouteName>> = {
  onboarding: "onboarding",
  "bootstrap-failure": "bootstrap-failure",
  "subscription-gate": "subscription-gate",
  "email-otp": "email-otp",
};

const verificationCode = ref("");
const router = useRouter();
const route = useRoute();
const rootFlowState = ref<RootFlowState>("auto");
const pendingShellPage = ref<ShellPageState | null>(null);
const pendingThreadRoute = ref<PendingThreadRouteState | null>(null);
const applyingRouteState = ref(false);
const routeStateHydrated = ref(false);
const ONBOARDING_STORAGE_KEY = "phodex.onboarding-seen";
const onboardingPage = ref(0);
const onboardingSeen = ref(readOnboardingSeen());
const onboardingTouchStartX = ref(0);
const selectedPlanId = ref("annual");
const shellPageStack = ref<ShellPageState[]>([]);
const activePanel = computed(() => shellPageStack.value.at(-1) ?? null);
const panelCanGoBack = computed(() => shellPageStack.value.length > 1);
const dialogState = ref<AppDialogState | null>(null);
const dialogInput = ref("");
const modelPickerOpen = ref(false);
const modelPickerEl = ref<HTMLElement | null>(null);
const threadMenuOpen = ref(false);
const threadMenuEl = ref<HTMLElement | null>(null);
const drawerThreadMenuOpenId = ref<string | null>(null);
const drawerThreadMenuEl = ref<HTMLElement | null>(null);
const imagePreviewState = ref<ImagePreviewState | null>(null);
const unlockedOutputBlocks = ref<Set<string>>(new Set());
const composerImageInputEl = ref<HTMLInputElement | null>(null);
const composerInputEl = ref<HTMLTextAreaElement | null>(null);
const conversationScrollEl = ref<HTMLElement | null>(null);
const conversationInnerEl = ref<HTMLElement | null>(null);
const autoScrollMode = ref<TurnAutoScrollMode>("followBottom");
const isScrolledToBottom = ref(true);

const TURN_BOTTOM_THRESHOLD = 24;
const USER_SCROLL_INTENT_MS = 900;
const PROJECTS_ROOT_HINT = "~/.phodex-web/projects";
const MAX_COMPOSER_IMAGE_BYTES = 5 * 1024 * 1024;
const DRAWER_CLOSE_NAVIGATION_FALLBACK_MS = 320;
const THREAD_CREATE_CHROME_CLOSE_FALLBACK_MS = 480;
const DRAWER_THREAD_SYNC_HINT_MS = 8_000;
const DRAWER_THREAD_BATCH_SIZE = 16;
const ACCESS_MODE_OPTIONS: AccessMode[] = ["read-only", "on-request", "full-access"];
const ACCESS_MODE_COMPACT_LABELS: Record<AccessMode, string> = {
  "read-only": "Read",
  "on-request": "Ask",
  "full-access": "Full",
};

let followBottomFrame: number | null = null;
let conversationResizeObserver: ResizeObserver | null = null;
let lastConversationScrollTop = 0;
let homeScrollTop = 0;
let ignoreManualAutoScrollUntil = 0;
let userConversationScrollIntentUntil = 0;
let installCommandCopyTimer: number | null = null;
let drawerThreadSyncTimer: number | null = null;
let drawerThreadNavigationTimer: number | null = null;
let deferredThreadCreateFallbackTimer: number | null = null;
let deferredThreadCreateRequest: DeferredThreadCreateRequest | null = null;
let pendingDrawerThreadNavigationId: string | null = null;
let previousScrollRestoration: ScrollRestoration | null = null;
const installManifest = ref<InstallManifest | null>(null);
const installManifestLoading = ref(false);
const installCommandCopyState = ref<"idle" | "copied" | "failed">("idle");
const installCommandPlatform = ref<InstallCommandPlatform>("shell");
const installCommandExpanded = ref(false);
const expandedDrawerGroups = ref<string[]>([]);
const expandedDrawerThreadLimits = ref<Record<string, number>>({});
const drawerThreadSyncing = ref(false);
const drawerRateLimitExpanded = ref(false);
const projectTree = ref<ProjectTreePayload | null>(null);
const projectTreeLoading = ref(false);
const projectTreeError = ref("");
const projectFile = ref<ProjectFilePayload | null>(null);
const projectFileLoading = ref(false);
const projectFileError = ref("");
const projectDiff = ref<ProjectDiffPayload | null>(null);
const projectDiffLoading = ref(false);
const projectDiffError = ref("");

const onboardingScreens = [
  {
    kind: "welcome",
    title: "Remodex",
    subtitle: "Control Codex from your phone.",
    badge: "Runs on your computer",
  },
  {
    kind: "features",
    title: "What you get",
    subtitle: "Everything runs on your computer. Your phone is the remote.",
    features: [
      {
        icon: "bolt",
        tone: "yellow",
        title: "Fast mode",
        subtitle: "Lower-latency turns for quick interactions",
      },
      {
        icon: "worktree",
        tone: "green",
        title: "Git from your phone",
        subtitle: "Commit, push, pull, and switch branches",
      },
      {
        icon: "relay",
        tone: "cyan",
        title: "Live relay sync",
        subtitle: "Replies stream from the desktop session in real time",
      },
      {
        icon: "edit",
        tone: "purple",
        title: "Queued drafts",
        subtitle: "Write the next prompt while the current run is still streaming",
      },
      {
        icon: "terminal",
        tone: "orange",
        title: "Plans, skills and /commands",
        subtitle: "Use plan mode, slash commands, and file mentions from the mobile shell",
      },
    ],
  },
  {
    kind: "step",
    step: "Step 1",
    icon: "relay",
    title: "Sign In To Mint Bridge Setup",
    subtitle: "Email verification comes first. After you sign in, the app generates a short-lived install command tied to your account.",
    commandKey: "bridge",
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
  if ("scrollRestoration" in window.history) {
    previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
  }
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
  void client.restoreSession();
});

onBeforeUnmount(() => {
  if (previousScrollRestoration && "scrollRestoration" in window.history) {
    window.history.scrollRestoration = previousScrollRestoration;
  }
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeyDown);
  clearFollowBottomFrame();
  conversationResizeObserver?.disconnect();
  conversationResizeObserver = null;
  clearInstallCommandCopyTimer();
  clearDrawerThreadSyncTimer();
  clearPendingDrawerThreadNavigation();
  clearDeferredThreadCreate();
});

const isAuthenticated = computed(() => Boolean(state.session && state.snapshot));
const onboardingBridgeCommand = computed(
  () => "Sign in with email first. The app will mint a short-lived install command that only this account can claim."
);
const bridgeInstallCommand = computed(() => {
  const manifest = installManifest.value;
  if (!manifest) {
    return "Generating account-bound install command…";
  }
  if (installCommandPlatform.value === "powershell") {
    return manifest.windowsCommand?.trim() || manifest.command;
  }
  return manifest.command;
});
const showBridgeInstallCard = computed(() => isAuthenticated.value);
const bridgeInstallCopyLabel = computed(() => {
  switch (installCommandCopyState.value) {
    case "copied":
      return "Copied";
    case "failed":
      return "Copy failed";
    default:
      return "Copy";
  }
});
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
const currentOnboardingCommand = computed(() => {
  if (currentOnboardingScreen.value.kind !== "step") {
    return "";
  }

  return onboardingBridgeCommand.value;
});
const onboardingCtaLabel = computed(() => {
  if (onboardingPage.value === 0) return "Get Started";
  if (onboardingPage.value === 1) return "Set Up";
  if (onboardingPage.value === onboardingScreens.length - 1) return "Continue with Email";
  return "Continue";
});
const routeThreadId = computed(() => {
  if (route.name !== "thread") {
    return null;
  }
  return normalizedRouteParam(route.params.threadId);
});
const currentThread = computed(() => {
  if (!state.snapshot) {
    return null;
  }
  if (routeThreadId.value) {
    return state.snapshot.threads.find((thread) => thread.id === routeThreadId.value) ?? null;
  }
  return state.snapshot.threads.find((thread) => thread.id === state.snapshot?.selectedThreadId) ?? null;
});
const isCurrentThreadPendingCreate = computed(() => isPendingThreadId(currentThread.value?.id ?? null));
const liveThreads = computed(() => (state.snapshot?.threads ?? []).filter((thread) => thread.state !== "archived"));
const liveThreadCount = computed(() => liveThreads.value.length);
const floatingToasts = computed(() => state.ui.toasts.filter((toast) => toast.tone === "error"));
const currentPendingRunFeedback = computed(() => {
  const pending = state.ui.pendingRunFeedback;
  if (!pending || pending.threadId !== currentThread.value?.id) {
    return null;
  }
  return pending;
});

function sortThreadsByCreatedAtDesc<T extends Pick<ThreadRecord, "createdAt" | "lastActivityAt">>(threads: T[]) {
  return threads.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || left.lastActivityAt);
    const rightTime = Date.parse(right.createdAt || right.lastActivityAt);
    return rightTime - leftTime;
  });
}

const threadGroups = computed<DrawerThreadGroup[]>(() => {
  const groups = new Map<string, DrawerThreadSummary[]>();
  const search = state.ui.search.trim().toLowerCase();
  const threads = sortThreadsByCreatedAtDesc(
    [...liveThreads.value]
      .filter((thread) => {
        if (!search) {
          return true;
        }
        return `${thread.title} ${thread.projectLabel}`.toLowerCase().includes(search);
      })
      .map((thread) => ({
        id: thread.id,
        title: thread.title,
        state: thread.state,
        projectLabel: thread.projectLabel,
        repoLabel: thread.repoLabel,
        createdAt: thread.createdAt || thread.lastActivityAt,
        isWorktree: thread.isWorktree,
        isForked: thread.isForked,
        lastActivityAt: thread.lastActivityAt,
      }))
  );

  for (const thread of threads) {
    const existing = groups.get(thread.projectLabel) ?? [];
    existing.push(thread);
    groups.set(thread.projectLabel, existing);
  }

  return [...groups.entries()].map(([label, threads]) => {
    const representative =
      threads.find((thread) => thread.id === currentThread.value?.id) ??
      threads.find((thread) => !thread.isWorktree) ??
      threads[0];

    return {
      label,
      threads,
      liveCount: threads.length,
      cwd: representative?.repoLabel ?? null,
      hasWorktree: threads.some((thread) => thread.isWorktree),
    };
  });
});
watch(
  [
    () => state.ui.sidebarOpen,
    () => currentThread.value?.projectLabel ?? "",
    () => state.ui.search.trim(),
    () => (state.ui.sidebarOpen ? liveThreadCount.value : 0),
  ],
  ([sidebarOpen, currentProjectLabel, search]) => {
    if (!sidebarOpen) {
      return;
    }
    const groups = threadGroups.value;
    const available = new Set(groups.map((group) => group.label));
    const preserved = expandedDrawerGroups.value.filter((label) => available.has(label));
    const nextExpanded = new Set(preserved);

    if (search) {
      for (const group of groups) {
        nextExpanded.add(group.label);
      }
    } else if (!preserved.length) {
      const defaultLabel =
        (currentProjectLabel && available.has(currentProjectLabel) ? currentProjectLabel : null) ?? groups[0]?.label ?? null;
      if (defaultLabel) {
        nextExpanded.add(defaultLabel);
      }
    } else if (currentProjectLabel && available.has(currentProjectLabel)) {
      nextExpanded.add(currentProjectLabel);
    }

    expandedDrawerGroups.value = [...nextExpanded];
  },
  { immediate: true }
);

function clearDrawerThreadSyncTimer() {
  if (drawerThreadSyncTimer === null) {
    return;
  }
  window.clearTimeout(drawerThreadSyncTimer);
  drawerThreadSyncTimer = null;
}

function clearDrawerThreadNavigationTimer() {
  if (drawerThreadNavigationTimer === null) {
    return;
  }
  window.clearTimeout(drawerThreadNavigationTimer);
  drawerThreadNavigationTimer = null;
}

function clearPendingDrawerThreadNavigation() {
  clearDrawerThreadNavigationTimer();
  pendingDrawerThreadNavigationId = null;
}

function clearDeferredThreadCreateFallbackTimer() {
  if (deferredThreadCreateFallbackTimer === null) {
    return;
  }
  window.clearTimeout(deferredThreadCreateFallbackTimer);
  deferredThreadCreateFallbackTimer = null;
}

function clearDeferredThreadCreate() {
  clearDeferredThreadCreateFallbackTimer();
  deferredThreadCreateRequest = null;
}

function showDrawerThreadSyncHint() {
  drawerThreadSyncing.value = true;
  clearDrawerThreadSyncTimer();
  drawerThreadSyncTimer = window.setTimeout(() => {
    drawerThreadSyncing.value = false;
    drawerThreadSyncTimer = null;
  }, DRAWER_THREAD_SYNC_HINT_MS);
}

watch(
  () => state.snapshot?.activeBridgeId ?? null,
  (nextBridgeId, previousBridgeId) => {
    if (!previousBridgeId || !nextBridgeId || nextBridgeId === previousBridgeId) {
      return;
    }
    showDrawerThreadSyncHint();
  }
);

watch(
  () => (state.ui.sidebarOpen ? liveThreadCount.value : 0),
  (count) => {
    if (count > 0) {
      drawerThreadSyncing.value = false;
      clearDrawerThreadSyncTimer();
    }
  }
);

const drawerProjectTargets = computed<DrawerProjectTarget[]>(() => {
  const targets: DrawerProjectTarget[] = threadGroups.value.map((group) => ({
    label: group.label,
    cwd: group.cwd,
    repoName: repoNameFromPath(group.cwd),
    detail: describeTargetPath(group.cwd, group.hasWorktree),
    liveCount: group.liveCount,
    hasWorktree: group.hasWorktree,
    isCurrent: group.label === currentThread.value?.projectLabel,
  }));

  if (currentThread.value?.projectLabel && !targets.some((target) => target.label === currentThread.value?.projectLabel)) {
    targets.unshift({
      label: currentThread.value.projectLabel,
      cwd: currentThread.value.repoLabel,
      repoName: repoNameFromPath(currentThread.value.repoLabel),
      detail: describeTargetPath(currentThread.value.repoLabel, currentThread.value.isWorktree),
      liveCount: 1,
      hasWorktree: currentThread.value.isWorktree,
      isCurrent: true,
    });
  }

  if (!targets.length) {
    targets.push({
      label: "Phodex Web",
      cwd: null,
      repoName: "Default workspace",
      detail: "Uses the relay default project root on your computer.",
      liveCount: 0,
      hasWorktree: false,
      isCurrent: true,
    });
  }

  return [...targets].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1;
    }
    if (left.liveCount !== right.liveCount) {
      return right.liveCount - left.liveCount;
    }
    return left.label.localeCompare(right.label);
  });
});
const archivedThreads = computed(() =>
  sortThreadsByCreatedAtDesc([...(state.snapshot?.threads ?? [])].filter((thread) => thread.state === "archived"))
);
const drawerThreadSyncHintVisible = computed(() =>
  state.ui.sidebarOpen &&
  drawerThreadSyncing.value &&
  !state.ui.search.trim() &&
  threadGroups.value.length === 0 &&
  (state.snapshot?.connection.state === "connected" || state.snapshot?.connection.state === "connecting")
);
const drawerRateLimitRows = computed(() => formatRateLimitRows(state.snapshot?.connection.rateLimits ?? null));
const drawerCriticalWeeklyRateLimit = computed(
  () => drawerRateLimitRows.value.find((row) => row.label === "Weekly" && row.remainingPercent < 10) ?? null
);
const drawerVisibleRateLimitRows = computed(() =>
  drawerRateLimitExpanded.value
    ? drawerRateLimitRows.value
    : drawerCriticalWeeklyRateLimit.value
      ? [drawerCriticalWeeklyRateLimit.value]
      : []
);
const composerPlaceholder = computed(() => {
  if (isCurrentThreadPendingCreate.value) {
    return "Starting a new chat on your computer…";
  }
  return currentThread.value?.state === "running"
    ? "Write a follow-up while this run is still streaming..."
    : "Ask anything... @files, $skills, /commands";
});
const composerHasText = computed(() => Boolean(state.ui.composerText.trim()));
const composerHasImage = computed(() => state.ui.composerImages.length > 0);
const composerHasContent = computed(() => composerHasText.value || composerHasImage.value);
const composerSendDisabled = computed(() => isCurrentThreadPendingCreate.value || !composerHasContent.value);
const composerSendTone = computed(() => {
  if (composerSendDisabled.value) {
    return "idle";
  }
  return "ready";
});
const composerSendTitle = computed(() => {
  if (isCurrentThreadPendingCreate.value) {
    return "Starting";
  }
  if (!composerHasContent.value) {
    return "Compose or attach first";
  }
  return currentThread.value?.state === "running" ? "Send follow-up" : "Send";
});
const composerRuntimeLabel = computed(
  () => `${state.ui.selectedModel} · ${ACCESS_MODE_COMPACT_LABELS[state.ui.accessMode]}`
);
const composerRuntimeState = computed(() => {
  const connection = state.snapshot?.connection;
  const deviceLabel = connection?.deviceLabel?.trim() || "your computer";

  if (isCurrentThreadPendingCreate.value) {
    return {
      label: "Starting",
      detail: "Creating a fresh chat on your computer",
      tone: "amber",
    } as const;
  }

  if (connection?.state === "disconnected") {
    return {
      label: "Offline",
      detail: `Reconnect ${deviceLabel}`,
      tone: "slate",
    } as const;
  }

  if (connection?.bridgeOnline && connection.state !== "connected") {
    return {
      label: "Syncing",
      detail: `Rehydrating ${deviceLabel}`,
      tone: "amber",
    } as const;
  }

  if (currentThread.value?.state === "running") {
    return {
      label: "Running",
      detail: currentThread.value.queuedDrafts.length
        ? `${currentThread.value.queuedDrafts.length} queued next`
        : `Working on ${deviceLabel}`,
      tone: "blue",
    } as const;
  }

  if (currentThread.value?.state === "queued") {
    return {
      label: "Queued",
      detail: "Runs after the current turn",
      tone: "amber",
    } as const;
  }

  if (currentThread.value?.queuedDrafts.length) {
    return {
      label: "Ready",
      detail: `${currentThread.value.queuedDrafts.length} queued next`,
      tone: "amber",
    } as const;
  }

  return {
    label: "Ready",
    detail: connection?.state === "connected" ? `On ${deviceLabel}` : null,
    tone: "amber",
  } as const;
});
const homePrimaryLabel = computed(() => {
  switch (state.snapshot?.connection.state) {
    case "connected":
      return "Disconnect";
    case "connecting":
      return "Connecting…";
    case "disconnected":
      return "Sign out";
    default:
      return "Sign out";
  }
});
const homeSecondaryLabel = computed(() =>
  state.snapshot?.connection.state === "connected" ? "Open chats" : "Replay onboarding"
);
const homeBridgeDevices = computed(() => dedupeHomeBridgeDevices(state.snapshot?.bridgeDevices ?? []));
const currentBridgeDeviceLabel = computed(() => state.snapshot?.connection.deviceLabel?.trim() || "Awaiting first check-in");

function createUiId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `phodex-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isActiveBridgeDevice(device: BridgeDeviceSummary) {
  return state.snapshot?.activeBridgeId === device.id;
}

function homeBridgeDeviceKey(device: BridgeDeviceSummary) {
  const label = device.deviceLabel?.trim().toLowerCase();
  return label || device.id;
}

function homeBridgeDeviceRank(device: BridgeDeviceSummary) {
  const stateRank = isActiveBridgeDevice(device)
    ? 4
    : device.state === "connected"
      ? 3
      : device.bridgeOnline || device.state === "connecting"
        ? 2
        : 1;
  const lastConnectedAt = device.lastConnectedAt ? Date.parse(device.lastConnectedAt) : 0;
  const seenRank = Number.isFinite(lastConnectedAt) ? lastConnectedAt / 1_000_000_000_000 : 0;
  return stateRank + seenRank;
}

function dedupeHomeBridgeDevices(devices: BridgeDeviceSummary[]) {
  const byKey = new Map<string, BridgeDeviceSummary>();
  for (const device of devices) {
    const key = homeBridgeDeviceKey(device);
    const existing = byKey.get(key);
    if (!existing || homeBridgeDeviceRank(device) > homeBridgeDeviceRank(existing)) {
      byKey.set(key, device);
    }
  }
  return [...byKey.values()];
}

function canSelectBridgeDevice(device: BridgeDeviceSummary) {
  return device.state === "connected";
}

function bridgeDeviceLabel(device: BridgeDeviceSummary) {
  return device.deviceLabel?.trim() || "Awaiting first check-in";
}

function bridgeDeviceStateLabel(device: BridgeDeviceSummary) {
  if (isActiveBridgeDevice(device)) {
    return "Current";
  }
  return "";
}

function bridgeDeviceMeta(device: BridgeDeviceSummary) {
  const details = [device.bridgeOnline ? "Bridge online" : "Bridge offline"];
  if (device.lastConnectedAt) {
    details.push(`Seen ${formatRelativeTime(device.lastConnectedAt)}`);
  }
  return details.join(" · ");
}

function selectBridgeDevice(device: BridgeDeviceSummary) {
  if (!canSelectBridgeDevice(device)) {
    return;
  }

  if (isActiveBridgeDevice(device) && device.state === "connected") {
    handleHomeSecondaryAction();
    return;
  }

  client.selectBridge(device.id);
}

function repoNameFromPath(value: string | null | undefined) {
  const repoLabel = value ?? "";
  if (!repoLabel) {
    return "";
  }

  const segments = repoLabel.split("/").filter(Boolean);
  return segments.at(-1) ?? repoLabel;
}

function pathTail(value: string | null | undefined, depth = 2) {
  const pathValue = value ?? "";
  if (!pathValue) {
    return "Default workspace";
  }

  const segments = pathValue.split("/").filter(Boolean);
  if (!segments.length) {
    return pathValue;
  }
  return segments.slice(-depth).join("/");
}

function describeTargetPath(cwd: string | null, hasWorktree: boolean) {
  if (!cwd) {
    return "Uses the relay default project root on your computer.";
  }
  return hasWorktree ? `Project root ${pathTail(cwd, 2)} with worktree support` : `Project root ${pathTail(cwd, 2)}`;
}

function readAppErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

const currentThreadRepoName = computed(() => {
  return repoNameFromPath(currentThread.value?.repoLabel ?? "");
});
const currentThreadWorkspaceLabel = computed(() => currentThreadRepoName.value || currentThread.value?.projectLabel || "Project");
const currentThreadSummaryLine = computed(() => {
  if (!currentThread.value) {
    return "";
  }
  return [
    formatThreadState(currentThread.value),
    currentThread.value.branch,
    `+${currentThread.value.diff.additions} -${currentThread.value.diff.deletions}`,
  ].join(" · ");
});
watch(
  isAuthenticated,
  (authenticated) => {
    if (!authenticated) {
      installManifest.value = null;
      return;
    }
    if (pendingShellPage.value) {
      openPanel(pendingShellPage.value, true);
      pendingShellPage.value = null;
    }
    if (
      pendingThreadRoute.value?.threadId &&
      state.snapshot?.threads.some((thread) => thread.id === pendingThreadRoute.value?.threadId)
    ) {
      if (pendingThreadRoute.value.machineId && state.snapshot.activeBridgeId !== pendingThreadRoute.value.machineId) {
        client.selectBridge(pendingThreadRoute.value.machineId);
      }
      client.selectThread(pendingThreadRoute.value.threadId);
      pendingThreadRoute.value = null;
    }
    void loadInstallManifest();
  },
  { immediate: true }
);
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
const currentThreadHistory = computed(() => currentThread.value?.history ?? null);
const showCurrentThreadHistoryLoading = computed(() => {
  const thread = currentThread.value;
  const history = thread?.history;
  return Boolean(thread && history?.isHydrating && !thread.messages.length);
});
const emptyThreadStarterActions = computed<TurnStarterAction[]>(() => {
  const repoName = currentThreadRepoName.value || currentThread.value?.projectLabel || "this workspace";
  return [
    { label: "Plan", prompt: "/plan " },
    { label: "Diff review", prompt: "Review the current working tree diff and call out the highest-risk issues first." },
    { label: "Files", prompt: "@files " },
    { label: "Repo summary", prompt: `Summarize ${repoName} and tell me where I should start.` },
  ];
});
const pendingRunStatus = computed(() => {
  const pending = currentPendingRunFeedback.value;
  if (!pending || !currentThread.value) {
    return null;
  }
  if (!pending.promptAcknowledged) {
    if (pending.acceptedOutcome === "queued") {
      return {
        phase: "waiting" as const,
        label: "Queued next",
      };
    }
    if (currentThread.value.state === "running") {
      return {
        phase: "syncing" as const,
        label: pending.acceptedOutcome === "steered" ? "Added to running turn" : "Adding to running turn",
      };
    }
    return {
      phase: "syncing" as const,
      label: "Sending",
    };
  }
  return null;
});
const showConversationContent = computed(
  () =>
    Boolean(
      currentThread.value &&
        (currentThread.value.messages.length ||
          showCurrentThreadHistoryLoading.value ||
          (currentThread.value.history?.totalMessages ?? 0) > 0 ||
          currentPendingRunFeedback.value ||
          currentThread.value.queuedDrafts.length ||
          currentThread.value.state === "running" ||
          (currentThread.value.state === "queued" && !isCurrentThreadPendingCreate.value))
    )
);
const showTurnStarterRail = computed(
  () =>
    Boolean(
      currentThread.value &&
        !isCurrentThreadPendingCreate.value &&
        !showConversationContent.value &&
        !state.ui.composerText.trim() &&
        !state.ui.composerImages.length
    )
);
const showPendingThreadRail = computed(() => Boolean(currentThread.value && isCurrentThreadPendingCreate.value && !showConversationContent.value));
const showScrollToLatestButton = computed(
  () => Boolean(currentThread.value?.messages.length && autoScrollMode.value === "manual" && !isScrolledToBottom.value)
);
const showLoadOlderMessagesButton = computed(
  () => Boolean(currentThread.value?.messages.length && currentThreadHistory.value?.hasMoreBefore)
);
const selectedProjectDiff = computed<ProjectDiffFile | null>(() => {
  const dialog = dialogState.value;
  if (dialog?.kind !== "project-diff") {
    return null;
  }

  const files = projectDiff.value?.files ?? [];
  if (!files.length) {
    return null;
  }

  return files.find((file) => file.path === dialog.selectedDiffPath) ?? files[0] ?? null;
});
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
    case "create-thread":
      return "New Chat";
    case "project-browser":
      return "Project Files";
    case "project-diff":
      return "Code Changes";
    case "rename-thread":
      return "Rename chat";
    case "delete-thread":
      return "Delete chat?";
    case "archive-group":
      return `Archive "${dialogState.value.projectLabel}"?`;
    default:
      return "";
  }
});
const dialogBody = computed(() => {
  switch (dialogState.value?.kind) {
    case "create-thread":
      return dialogState.value.mode === "worktree"
        ? "Pick an existing project or enter a git-backed path. Phodex creates a fresh worktree before the chat starts."
        : "Pick an existing project or enter a new path for the next local chat on your computer.";
    case "project-browser":
      return `Browse ${dialogState.value.title} and lazily preview a file when you tap it.`;
    case "project-diff":
      return dialogState.value.filterPath
        ? `Inspect the diff focused on ${dialogState.value.filterPath}.`
        : `Inspect the working-tree diff for ${dialogState.value.title}.`;
    case "rename-thread":
      return "Update the thread title shown in the sidebar and top navigation.";
    case "delete-thread":
      return "This sends a delete request to the Codex bridge for this conversation. If the bridge cannot delete it, you will see an error and the chat will remain available.";
    case "archive-group":
      return `All ${dialogState.value.liveCount} live chats in this project group will move to Archived Chats.`;
    default:
      return "";
  }
});
const dialogConfirmLabel = computed(() => {
  switch (dialogState.value?.kind) {
    case "create-thread":
      if (dialogState.value.useCustomCwd && dialogState.value.mode === "local") {
        return "Create Folder & Start Chat";
      }
      return dialogState.value.mode === "worktree" ? "Create Worktree" : "Start Chat";
    case "rename-thread":
      return "Save";
    case "delete-thread":
      return "Delete";
    case "archive-group":
      return "Archive";
    default:
      return "Confirm";
  }
});
const activePanelTitle = computed(() => {
  switch (activePanel.value) {
    case "archived":
      return "Archived Chats";
    case "paywall":
      return "Remodex Pro";
    default:
      return "";
  }
});

watch(
  [() => route.name, () => route.params.machineId, () => route.params.threadId, isAuthenticated, () => state.snapshot],
  () => {
    syncStateFromRoute();
  },
  { immediate: true }
);

watch(
  [isAuthenticated, rootFlow, activePanel],
  () => {
    syncRouteFromState();
  },
  { immediate: true }
);

watch(
  [() => state.snapshot, pendingThreadRoute],
  () => {
    const pendingRoute = pendingThreadRoute.value;
    const snapshot = state.snapshot;
    if (!isAuthenticated.value || !pendingRoute || !snapshot) {
      return;
    }
    if (
      pendingRoute.machineId &&
      snapshot.activeBridgeId !== pendingRoute.machineId &&
      snapshot.bridgeDevices.some((device) => device.id === pendingRoute.machineId)
    ) {
      client.selectBridge(pendingRoute.machineId);
      return;
    }
    if (!snapshot.threads.some((thread) => thread.id === pendingRoute.threadId)) {
      return;
    }
    if (snapshot.selectedThreadId !== pendingRoute.threadId) {
      client.selectThread(pendingRoute.threadId);
      return;
    }
    pendingThreadRoute.value = null;
  },
  { immediate: true }
);

watch(
  () => {
    const threadId = routeThreadId.value;
    if (!threadId || !state.snapshot) {
      return null;
    }
    return {
      threadId,
      hasThread: state.snapshot.threads.some((thread) => thread.id === threadId),
    };
  },
  (nextRouteState, previousRouteState) => {
    if (!isAuthenticated.value || route.name !== "thread" || !routeThreadId.value) {
      return;
    }
    if (
      !nextRouteState ||
      !previousRouteState ||
      nextRouteState.threadId !== previousRouteState.threadId ||
      previousRouteState.hasThread !== true ||
      nextRouteState.hasThread !== false
    ) {
      return;
    }
    pendingThreadRoute.value = null;
    syncRouteFromState();
  }
);
const createThreadSelection = computed(() => {
  if (!dialogState.value || dialogState.value.kind !== "create-thread") {
    return null;
  }

  if (!dialogState.value.useCustomCwd) {
    return {
      projectLabel: dialogState.value.projectLabel,
      cwd: dialogState.value.cwd,
      isCustom: false,
    };
  }

  const input = dialogState.value.customCwdInput.trim();
  return {
    projectLabel: deriveProjectLabelFromPathInput(input),
    cwd: input || null,
    isCustom: true,
  };
});
const createThreadResolvedPathHint = computed(() => {
  if (!dialogState.value || dialogState.value.kind !== "create-thread" || !dialogState.value.useCustomCwd) {
    return "";
  }
  return previewCreateThreadPath(dialogState.value.customCwdInput);
});
const createThreadHintCopy = computed(() => {
  if (!dialogState.value || dialogState.value.kind !== "create-thread" || !dialogState.value.useCustomCwd) {
    return "";
  }
  return dialogState.value.mode === "worktree"
    ? "Absolute paths are used as-is. Folder names resolve inside the default Phodex projects directory, but worktree mode still needs the resolved path to belong to an existing git project."
    : "Paste an absolute path to use it directly, or just type a folder name to create it inside the default Phodex projects directory.";
});
const createThreadBlockedReason = computed(() => {
  if (dialogState.value?.kind !== "create-thread") {
    return "";
  }
  if (state.snapshot?.connection.state === "connected") {
    return "";
  }
  return "Your computer bridge is offline. Reconnect the bridge before starting a new chat.";
});
const dialogConfirmDisabled = computed(() => {
  if (!dialogState.value) {
    return false;
  }
  if (dialogState.value.kind === "rename-thread") {
    return !dialogInput.value.trim();
  }
  if (dialogState.value.kind === "create-thread") {
    if (createThreadBlockedReason.value) {
      return true;
    }
    if (!dialogState.value.useCustomCwd) {
      return false;
    }
    return !dialogState.value.customCwdInput.trim();
  }
  return false;
});

watch(
  () => currentThread.value?.id ?? null,
  async (nextThreadId) => {
    clearFollowBottomFrame();

    if (!nextThreadId) {
      autoScrollMode.value = "manual";
      isScrolledToBottom.value = false;
      await nextTick();
      restoreHomeScrollPosition();
      return;
    }

    autoScrollMode.value = "followBottom";
    isScrolledToBottom.value = true;
    await nextTick();
    scrollConversationToBottom();
  },
  { flush: "post" }
);

const latestMessageGrowthKey = computed(() => {
  const thread = currentThread.value;
  const latestMessage = thread?.messages.at(-1);
  if (!thread || !latestMessage) {
    return "";
  }
  return [
    thread.id,
    thread.messages.length,
    latestMessage.id,
    latestMessage.text.length,
    latestMessage.isStreaming ? "streaming" : "settled",
    currentPendingRunFeedback.value ? "pending" : "acknowledged",
  ].join(":");
});

watch(
  latestMessageGrowthKey,
  async () => {
    if (autoScrollMode.value !== "followBottom") {
      return;
    }
    await nextTick();
    markProgrammaticConversationScroll();
    queueFollowBottomScroll();
  },
  { flush: "post" }
);

watch(
  [() => currentThread.value?.id ?? null, isAuthenticated, activePanel],
  async ([nextThreadId, authenticated, panel]) => {
    if (nextThreadId || !authenticated || panel) {
      return;
    }
    await nextTick();
    restoreHomeScrollPosition();
  },
  { flush: "post", immediate: true }
);

function observeConversationResizeTarget(nextEl: HTMLElement | null, previousEl: HTMLElement | null) {
  if (previousEl && previousEl !== nextEl) {
    conversationResizeObserver?.unobserve(previousEl);
  }

  if (!nextEl || typeof ResizeObserver === "undefined") {
    return;
  }

  if (!conversationResizeObserver) {
    conversationResizeObserver = new ResizeObserver(() => {
      if (!currentThread.value) {
        restoreHomeScrollPosition();
        return;
      }
      if (autoScrollMode.value === "followBottom") {
        // Keep the CTA hidden while runtime chrome or message growth is auto-followed.
        isScrolledToBottom.value = true;
        markProgrammaticConversationScroll();
        queueFollowBottomScroll();
        return;
      }
      isScrolledToBottom.value = isConversationPinnedToBottom();
    });
  }

  conversationResizeObserver.observe(nextEl);
}

watch(
  () => conversationInnerEl.value,
  (nextEl, previousEl) => {
    observeConversationResizeTarget(nextEl, previousEl);
  },
  { flush: "post" }
);

watch(
  () => conversationScrollEl.value,
  (nextEl, previousEl) => {
    observeConversationResizeTarget(nextEl, previousEl);
    lastConversationScrollTop = nextEl?.scrollTop ?? 0;
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

function formatRateLimitRows(snapshot: CodexRateLimitSnapshot | null): RateLimitDisplayRow[] {
  if (!snapshot) {
    return [];
  }

  return [
    formatRateLimitWindow(snapshot.primary, "5h", "primary"),
    formatRateLimitWindow(snapshot.secondary, "Weekly", "secondary"),
  ].filter((row): row is RateLimitDisplayRow => Boolean(row));
}

function formatRateLimitWindow(
  window: CodexRateLimitWindow | null,
  fallbackLabel: string,
  key: RateLimitDisplayRow["key"]
): RateLimitDisplayRow | null {
  if (!window) {
    return null;
  }

  const label = formatRateLimitWindowLabel(window.windowDurationMins, fallbackLabel);
  const remainingPercent = Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
  const resetLabel = formatRateLimitReset(window.resetsAt);
  return {
    key,
    label,
    remainingPercent,
    detail: resetLabel ? `${remainingPercent}% left, resets ${resetLabel}` : `${remainingPercent}% left`,
  };
}

function formatRateLimitWindowLabel(windowDurationMins: number | null, fallbackLabel: string) {
  if (!windowDurationMins) {
    return fallbackLabel;
  }
  if (windowDurationMins >= 7 * 24 * 60) {
    return "Weekly";
  }
  if (windowDurationMins % (24 * 60) === 0) {
    return `${windowDurationMins / (24 * 60)}d`;
  }
  if (windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60}h`;
  }
  return `${windowDurationMins}m`;
}

function formatRateLimitReset(resetsAt: number | null) {
  if (!resetsAt) {
    return "";
  }

  const deltaMinutes = Math.ceil((resetsAt * 1_000 - Date.now()) / 60_000);
  if (deltaMinutes <= 0) {
    return "soon";
  }
  if (deltaMinutes < 60) {
    return `in ${deltaMinutes}m`;
  }

  const hours = Math.ceil(deltaMinutes / 60);
  if (hours < 24) {
    return `in ${hours}h`;
  }

  return `in ${Math.ceil(hours / 24)}d`;
}

async function loadInstallManifest() {
  const token = state.session?.token?.trim();
  if (!token) {
    installManifest.value = null;
    installManifestLoading.value = false;
    return;
  }

  installManifestLoading.value = true;
  try {
    const response = await fetch(`${API_ORIGIN}/install/manifest.json`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      installManifest.value = null;
      return;
    }
    installManifest.value = (await response.json()) as InstallManifest;
    installCommandCopyState.value = "idle";
    clearInstallCommandCopyTimer();
  } catch (error) {
    installManifest.value = null;
    console.warn("[phodex-web] install manifest unavailable", error);
  } finally {
    installManifestLoading.value = false;
  }
}

function clearInstallCommandCopyTimer() {
  if (installCommandCopyTimer === null) {
    return;
  }
  window.clearTimeout(installCommandCopyTimer);
  installCommandCopyTimer = null;
}

function resetInstallCommandCopyStateLater() {
  clearInstallCommandCopyTimer();
  installCommandCopyTimer = window.setTimeout(() => {
    installCommandCopyState.value = "idle";
    installCommandCopyTimer = null;
  }, 1800);
}

async function copyInstallCommand() {
  const command = bridgeInstallCommand.value.trim();
  if (!command) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command);
    } else {
      const helper = document.createElement("textarea");
      helper.value = command;
      helper.setAttribute("readonly", "");
      helper.style.position = "absolute";
      helper.style.left = "-9999px";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      document.body.removeChild(helper);
    }
    installCommandCopyState.value = "copied";
  } catch (error) {
    console.warn("[phodex-web] failed to copy install command", error);
    installCommandCopyState.value = "failed";
  }

  resetInstallCommandCopyStateLater();
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

function splitParagraphs(text: string) {
  return text
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeMarkdownHref(href: string) {
  const value = href.trim();
  if (value.startsWith("<") && value.endsWith(">")) {
    return value.slice(1, -1);
  }
  return value;
}

function isImageHref(href: string) {
  const value = normalizeMarkdownHref(href).split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  return /\.(png|jpe?g|webp|gif|svg)$/.test(value);
}

function parseMarkdownLinkSegment(label: string, href: string): MessageInlineSegment {
  const normalizedHref = normalizeMarkdownHref(href);
  const lineMatch = normalizedHref.match(/:(\d+)$/);
  const path = lineMatch ? normalizedHref.slice(0, -lineMatch[0].length) : normalizedHref;
  if (path.startsWith("/")) {
    return {
      type: "file-link",
      label,
      displayLabel: label.trim() || path.split("/").at(-1) || path,
      href: normalizedHref,
      line: lineMatch ? Number.parseInt(lineMatch[1] ?? "", 10) : null,
    };
  }
  return {
    type: "link",
    label: label.trim() || normalizedHref,
    href: normalizedHref,
  };
}

function splitInlineSegments(text: string): MessageInlineSegment[] {
  const segments: MessageInlineSegment[] = [];
  const pattern = /`([^`\n]+)`|!\[([^\]\n]*)\]\(([^)\n]+)\)|\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({
        type: "text",
        text: text.slice(cursor, index),
      });
    }

    if (match[1]) {
      segments.push({
        type: "code",
        text: match[1],
      });
    } else if (match[3]) {
      const href = normalizeMarkdownHref(match[3]);
      if (isImageHref(href)) {
        segments.push({
          type: "image-link",
          label: match[2]?.trim() || href.split("/").at(-1) || "Image",
          href,
        });
      } else {
        segments.push({
          type: "text",
          text: match[0],
        });
      }
    } else if (match[4] && match[5]) {
      segments.push(parseMarkdownLinkSegment(match[4], match[5]));
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({
      type: "text",
      text: text.slice(cursor),
    });
  }

  return segments.length ? segments : [{ type: "text", text }];
}

function pushUiToast(tone: "info" | "success" | "error", message: string) {
  const toast = {
    id: createUiId(),
    tone,
    message,
  };
  state.ui.toasts.push(toast);
  window.setTimeout(() => {
    state.ui.toasts = state.ui.toasts.filter((item) => item.id !== toast.id);
  }, 3600);
}

function findThreadRecord(threadId: string) {
  return state.snapshot?.threads.find((thread) => thread.id === threadId) ?? null;
}

function projectDialogTitle(thread: ThreadRecord | null) {
  if (!thread) {
    return "Project";
  }
  if (currentThread.value?.id === thread.id) {
    return currentThreadRepoName.value || thread.projectLabel;
  }
  return repoNameFromPath(thread.repoLabel) || thread.projectLabel;
}

function normalizeProjectPath(path: string | null | undefined) {
  const value = path?.trim() ?? "";
  return value || ".";
}

function formatProjectPath(path: string | null | undefined) {
  const value = normalizeProjectPath(path);
  return value === "." ? "Project root" : value;
}

function parentProjectPath(path: string | null | undefined) {
  const value = normalizeProjectPath(path);
  if (value === ".") {
    return ".";
  }
  const segments = value.split("/").filter(Boolean);
  segments.pop();
  return segments.length ? segments.join("/") : ".";
}

function formatProjectEntryMeta(entry: ProjectTreeEntry) {
  return entry.kind === "directory" ? "Folder" : `${entry.size} bytes`;
}

function resetProjectBrowserState() {
  projectTree.value = null;
  projectTreeLoading.value = false;
  projectTreeError.value = "";
  projectFile.value = null;
  projectFileLoading.value = false;
  projectFileError.value = "";
}

function resetProjectDiffState() {
  projectDiff.value = null;
  projectDiffLoading.value = false;
  projectDiffError.value = "";
}

async function loadProjectTree(threadId: string, path: string) {
  projectTreeLoading.value = true;
  projectTreeError.value = "";
  projectFile.value = null;
  projectFileLoading.value = false;
  projectFileError.value = "";

  try {
    const result = await fetchSessionJson<ProjectTreePayload>(
      `/api/thread/${encodeURIComponent(threadId)}/project/tree?path=${encodeURIComponent(normalizeProjectPath(path))}`
    );
    projectTree.value = result;
    if (dialogState.value?.kind === "project-browser" && dialogState.value.threadId === threadId) {
      dialogState.value = {
        ...dialogState.value,
        currentPath: result.path,
        selectedFilePath: null,
      };
    }
  } catch (error) {
    projectTree.value = null;
    projectTreeError.value = readAppErrorMessage(error);
  } finally {
    projectTreeLoading.value = false;
  }
}

async function loadProjectFile(threadId: string, path: string) {
  projectFileLoading.value = true;
  projectFileError.value = "";

  try {
    const result = await fetchSessionJson<ProjectFilePayload>(
      `/api/thread/${encodeURIComponent(threadId)}/project/file?path=${encodeURIComponent(path)}`
    );
    projectFile.value = result;
    if (dialogState.value?.kind === "project-browser" && dialogState.value.threadId === threadId) {
      dialogState.value = {
        ...dialogState.value,
        selectedFilePath: result.path,
      };
    }
  } catch (error) {
    projectFile.value = null;
    projectFileError.value = readAppErrorMessage(error);
  } finally {
    projectFileLoading.value = false;
  }
}

async function loadProjectDiff(threadId: string, filterPath: string | null) {
  projectDiffLoading.value = true;
  projectDiffError.value = "";

  try {
    const query = filterPath ? `?path=${encodeURIComponent(filterPath)}` : "";
    const result = await fetchSessionJson<ProjectDiffPayload>(
      `/api/thread/${encodeURIComponent(threadId)}/project/diff${query}`
    );
    projectDiff.value = result;
    if (dialogState.value?.kind === "project-diff" && dialogState.value.threadId === threadId) {
      const preferredPath = filterPath ?? dialogState.value.selectedDiffPath;
      const selected = result.files.find((file) => file.path === preferredPath) ?? result.files[0] ?? null;
      dialogState.value = {
        ...dialogState.value,
        filterPath,
        selectedDiffPath: selected?.path ?? null,
      };
    }
  } catch (error) {
    projectDiff.value = null;
    projectDiffError.value = readAppErrorMessage(error);
  } finally {
    projectDiffLoading.value = false;
  }
}

function openProjectBrowser(thread = currentThread.value) {
  if (!thread) {
    return;
  }

  closeModelPicker();
  closeSidebar();
  resetProjectBrowserState();
  dialogState.value = {
    kind: "project-browser",
    threadId: thread.id,
    title: projectDialogTitle(thread),
    currentPath: ".",
    selectedFilePath: null,
  };
  void loadProjectTree(thread.id, ".");
}

function openProjectDiff(thread = currentThread.value, filterPath: string | null = null) {
  if (!thread) {
    return;
  }

  closeModelPicker();
  closeSidebar();
  resetProjectDiffState();
  dialogState.value = {
    kind: "project-diff",
    threadId: thread.id,
    title: projectDialogTitle(thread),
    filterPath,
    selectedDiffPath: filterPath,
  };
  void loadProjectDiff(thread.id, filterPath);
}

function selectProjectEntry(entry: ProjectTreeEntry) {
  if (dialogState.value?.kind !== "project-browser") {
    return;
  }

  if (entry.kind === "directory") {
    void loadProjectTree(dialogState.value.threadId, entry.path);
    return;
  }

  void loadProjectFile(dialogState.value.threadId, entry.path);
}

function openProjectParentDirectory() {
  if (dialogState.value?.kind !== "project-browser") {
    return;
  }
  void loadProjectTree(dialogState.value.threadId, parentProjectPath(dialogState.value.currentPath));
}

function selectProjectDiffFile(path: string) {
  if (dialogState.value?.kind !== "project-diff") {
    return;
  }
  dialogState.value = {
    ...dialogState.value,
    selectedDiffPath: path,
  };
}

function deriveProjectLabelFromPathInput(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "New Project";
  }

  const normalized = trimmed === "~" ? trimmed : trimmed.replace(/^~\//, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function previewCreateThreadPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return `${PROJECTS_ROOT_HINT}/my-project`;
  }

  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("/")) {
    return trimmed;
  }

  return `${PROJECTS_ROOT_HINT}/${trimmed.replace(/^\.\/+/, "").replace(/^\/+/, "")}`;
}

function resolveCreateThreadTarget(projectLabel?: string, cwd?: string | null) {
  if (cwd || projectLabel) {
    const match = drawerProjectTargets.value.find((target) => {
      if (cwd) {
        return target.cwd === cwd;
      }
      return target.label === projectLabel;
    });
    if (match) {
      return match;
    }
  }

  return drawerProjectTargets.value.find((target) => target.isCurrent) ?? drawerProjectTargets.value[0];
}

function openCreateThreadDialog(mode: ThreadCreateMode, projectLabel?: string, cwd?: string | null) {
  const target = resolveCreateThreadTarget(projectLabel, cwd);
  dialogState.value = {
    kind: "create-thread",
    mode,
    projectLabel: target?.label ?? projectLabel ?? "Phodex Web",
    cwd: target?.cwd ?? cwd ?? null,
    customCwdInput: "",
    useCustomCwd: false,
  };
}

function selectCreateThreadTarget(target: DrawerProjectTarget) {
  if (!dialogState.value || dialogState.value.kind !== "create-thread") {
    return;
  }

  dialogState.value = {
    ...dialogState.value,
    projectLabel: target.label,
    cwd: target.cwd,
    useCustomCwd: false,
  };
}

function setCreateThreadMode(mode: ThreadCreateMode) {
  if (!dialogState.value || dialogState.value.kind !== "create-thread") {
    return;
  }

  dialogState.value = {
    ...dialogState.value,
    mode,
  };
}

function activateCustomCreateThreadInput() {
  if (!dialogState.value || dialogState.value.kind !== "create-thread") {
    return;
  }

  dialogState.value = {
    ...dialogState.value,
    useCustomCwd: true,
  };
}

function updateCreateThreadCustomCwd(value: string) {
  if (!dialogState.value || dialogState.value.kind !== "create-thread") {
    return;
  }

  dialogState.value = {
    ...dialogState.value,
    customCwdInput: value,
    useCustomCwd: true,
  };
}

function modelOptionCopy(model: string) {
  switch (model) {
    case "GPT-5.5":
      return "Best default for heavier reasoning and edits.";
    case "GPT-5.4":
      return "Heavier edits and coding work.";
    case "GPT-5.4 mini":
      return "Faster default for routine chats.";
    case "o4-mini":
      return "Quick checks and short turns.";
    default:
      return "Available in this shell.";
  }
}

function speedOptionCopy(fastMode: boolean) {
  return fastMode ? "Lower latency." : "Balanced latency.";
}

function formatImageCountLabel(count: number) {
  return count === 1 ? "1 image attached" : `${count} images attached`;
}

function formatImageCountCompact(count: number) {
  return count === 1 ? "1 image" : `${count} images`;
}

function formatInputImageLabel(image: InputImageAttachment, index: number) {
  return image.name?.trim() || image.fileId?.trim() || `Image ${index + 1}`;
}

function inputImageSource(image: InputImageAttachment) {
  return image.imageUrl ?? "";
}

function openImagePreview(src: string, title: string, meta?: string) {
  if (!src) {
    return;
  }
  imagePreviewState.value = { src, title, meta };
}

function closeImagePreview() {
  imagePreviewState.value = null;
}

function outputBlockKey(messageId: string, blockId: string | number) {
  return `${messageId}:${blockId}`;
}

function isOutputBlockUnlocked(key: string) {
  return unlockedOutputBlocks.value.has(key);
}

function toggleOutputBlockScroll(key: string) {
  const next = new Set(unlockedOutputBlocks.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  unlockedOutputBlocks.value = next;
}

function openInputImagePreview(image: InputImageAttachment, index: number) {
  openImagePreview(inputImageSource(image), formatInputImageLabel(image, index), image.mimeType);
}

function openMessageCardImagePreview(card: ImageMessageCard) {
  openImagePreview(card.imageUrl ?? "", card.detail ?? card.title, card.meta ?? card.path);
}

function draftSummary(draft: { text: string; images?: InputImageAttachment[] }) {
  const trimmed = draft.text.trim();
  if (trimmed) {
    return trimmed;
  }
  return formatImageCountLabel(draft.images?.length ?? 0);
}

function formatQueuedDraftMeta(draft: { text: string; createdAt: string; images?: InputImageAttachment[] }) {
  const parts = [formatRelativeTime(draft.createdAt)];
  if (draft.text.trim() && (draft.images?.length ?? 0) > 0) {
    parts.unshift(formatImageCountCompact(draft.images!.length));
  }
  return parts.join(" · ");
}

function resetComposerImageInput() {
  if (composerImageInputEl.value) {
    composerImageInputEl.value.value = "";
  }
}

function removeComposerImage(index = 0) {
  state.ui.composerImages = state.ui.composerImages.filter((_image, imageIndex) => imageIndex !== index);
  resetComposerImageInput();
}

function openComposerImagePicker() {
  if (isCurrentThreadPendingCreate.value) {
    return;
  }
  composerImageInputEl.value?.click();
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Unable to read this image."));
    };
    reader.onerror = () => reject(new Error("Unable to read this image."));
    reader.readAsDataURL(file);
  });
}

async function handleComposerImageSelection(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    pushUiToast("error", "Only image files can be attached.");
    resetComposerImageInput();
    return;
  }

  if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
    pushUiToast("error", "Images must stay under 5 MB for this mobile shell.");
    resetComposerImageInput();
    return;
  }

  try {
    const imageUrl = await readFileAsDataUrl(file);
    state.ui.composerImages = [
      {
        imageUrl,
        name: file.name,
        mimeType: file.type || undefined,
        detail: "auto",
      },
    ];
  } catch (error) {
    pushUiToast("error", error instanceof Error ? error.message : "Unable to attach this image.");
  } finally {
    resetComposerImageInput();
  }
}

function closeModelPicker() {
  modelPickerOpen.value = false;
}

function closeThreadMenu() {
  threadMenuOpen.value = false;
}

function closeDrawerThreadMenu() {
  drawerThreadMenuOpenId.value = null;
}

function toggleModelPicker() {
  if (isCurrentThreadPendingCreate.value) {
    return;
  }
  closeThreadMenu();
  closeDrawerThreadMenu();
  modelPickerOpen.value = !modelPickerOpen.value;
}

function selectModel(model: string) {
  state.ui.selectedModel = model;
  persistComposerPreferences();
  closeModelPicker();
}

function selectFastMode(fastMode: boolean) {
  state.ui.fastMode = fastMode;
  persistComposerPreferences();
  closeModelPicker();
}

function selectAccessMode(accessMode: AccessMode) {
  if (isCurrentThreadPendingCreate.value) {
    return;
  }
  state.ui.accessMode = accessMode;
  persistComposerPreferences();
  closeModelPicker();
}

function toggleThreadMenu() {
  if (!currentThread.value) {
    return;
  }
  closeModelPicker();
  closeDrawerThreadMenu();
  threadMenuOpen.value = !threadMenuOpen.value;
}

function toggleDrawerThreadMenu(threadId: string) {
  closeModelPicker();
  closeThreadMenu();
  drawerThreadMenuOpenId.value = drawerThreadMenuOpenId.value === threadId ? null : threadId;
}

function setDrawerThreadMenuEl(threadId: string, element: unknown) {
  if (drawerThreadMenuOpenId.value === threadId) {
    drawerThreadMenuEl.value = element instanceof HTMLElement ? element : null;
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  if (modelPickerOpen.value && modelPickerEl.value?.contains(target)) {
    return;
  }
  if (threadMenuOpen.value && threadMenuEl.value?.contains(target)) {
    return;
  }
  if (drawerThreadMenuOpenId.value && drawerThreadMenuEl.value?.contains(target)) {
    return;
  }
  closeModelPicker();
  closeThreadMenu();
  closeDrawerThreadMenu();
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeModelPicker();
    closeThreadMenu();
    closeDrawerThreadMenu();
  }
}

function handleComposerKeyDown(event: KeyboardEvent) {
  if (event.key !== "Enter") {
    return;
  }
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  event.preventDefault();
  handleSend();
}

function openSidebar() {
  clearPendingDrawerThreadNavigation();
  closeModelPicker();
  closeThreadMenu();
  closeDrawerThreadMenu();
  state.ui.sidebarOpen = true;
}

function closeSidebar() {
  closeModelPicker();
  closeThreadMenu();
  closeDrawerThreadMenu();
  state.ui.sidebarOpen = false;
}

function isDrawerGroupExpanded(label: string) {
  if (state.ui.search.trim()) {
    return true;
  }
  return expandedDrawerGroups.value.includes(label);
}

function drawerThreadLimit(label: string) {
  return expandedDrawerThreadLimits.value[label] ?? DRAWER_THREAD_BATCH_SIZE;
}

function visibleDrawerThreads(group: DrawerThreadGroup) {
  const limit = drawerThreadLimit(group.label);
  const visible = group.threads.slice(0, limit);
  const selectedThread = currentThread.value
    ? group.threads.find((thread) => thread.id === currentThread.value?.id)
    : null;

  if (!selectedThread || visible.some((thread) => thread.id === selectedThread.id)) {
    return visible;
  }

  if (visible.length < limit) {
    return [...visible, selectedThread];
  }

  return [...visible.slice(0, Math.max(0, limit - 1)), selectedThread];
}

function hiddenDrawerThreadCount(group: DrawerThreadGroup) {
  return Math.max(0, group.threads.length - visibleDrawerThreads(group).length);
}

function showMoreDrawerThreads(group: DrawerThreadGroup) {
  expandedDrawerThreadLimits.value = {
    ...expandedDrawerThreadLimits.value,
    [group.label]: drawerThreadLimit(group.label) + DRAWER_THREAD_BATCH_SIZE,
  };
}

function toggleDrawerGroup(label: string) {
  if (state.ui.search.trim()) {
    return;
  }
  const nextExpanded = new Set(expandedDrawerGroups.value);
  if (nextExpanded.has(label)) {
    nextExpanded.delete(label);
  } else {
    nextExpanded.add(label);
  }
  expandedDrawerGroups.value = [...nextExpanded];
}

function setOnboardingPage(nextPage: number) {
  const clamped = Math.max(0, Math.min(nextPage, onboardingScreens.length - 1));
  onboardingPage.value = clamped;
}

function completeOnboarding() {
  onboardingSeen.value = true;
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  rootFlowState.value = "email-otp";
}

function advanceOnboarding() {
  if (onboardingPage.value < onboardingScreens.length - 1) {
    setOnboardingPage(onboardingPage.value + 1);
    return;
  }
  completeOnboarding();
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
    setOnboardingPage(onboardingPage.value - 1);
  }
}

function restartOnboarding() {
  onboardingPage.value = 0;
  onboardingSeen.value = false;
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

watch(
  () => state.auth.email,
  () => {
    if (state.ui.authStatusTone === "error") {
      state.ui.authStatus = "";
      state.ui.authStatusTone = "neutral";
    }
  }
);

watch(verificationCode, () => {
  if (state.ui.authStatusTone === "error") {
    state.ui.authStatus = "";
    state.ui.authStatusTone = "neutral";
  }
});

function handleSend() {
  if (!currentThread.value) {
    handleThreadCreateNavigation(client.createThreadAndSend("Phodex Web", "local"));
    return;
  }
  client.sendComposer(currentThread.value.id);
}

function handleRenameThread(threadId: string, currentTitle: string) {
  closeDrawerThreadMenu();
  dialogInput.value = currentTitle;
  dialogState.value = {
    kind: "rename-thread",
    threadId,
    title: currentTitle,
  };
}

function handleDeleteThread(threadId: string, currentTitle: string) {
  closeDrawerThreadMenu();
  dialogState.value = {
    kind: "delete-thread",
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
  openCreateThreadDialog("local", currentThread.value?.projectLabel, currentThread.value?.repoLabel ?? null);
}

function startToolbarLocalChat() {
  if (!currentThread.value || isCurrentThreadPendingCreate.value) {
    return;
  }
  closeModelPicker();
  handleThreadCreateNavigation(client.createThread(currentThread.value.projectLabel, "local", currentThread.value.repoLabel || undefined));
}

function startWorktreeChat() {
  openCreateThreadDialog("worktree", currentThread.value?.projectLabel, currentThread.value?.repoLabel ?? null);
}

function openPanel(panel: ShellPageState, replace = false) {
  closeModelPicker();
  closeThreadMenu();

  if (replace || !shellPageStack.value.length) {
    shellPageStack.value = [panel];
  } else if (shellPageStack.value.at(-1) !== panel) {
    shellPageStack.value = [...shellPageStack.value, panel];
  }
  state.ui.sidebarOpen = false;
}

function navigateToThread(threadId: string, replace = false) {
  const machineId = currentRouteMachineId();
  const shouldReplace =
    replace || (route.name === "thread" && routeThreadId.value !== null && routeThreadId.value !== threadId);
  if (!machineId) {
    client.logFlowTrace("route.thread.manual-missing-machine", {
      threadId,
      replace: shouldReplace,
    });
    client.selectThread(threadId);
    return;
  }

  client.logFlowTrace("route.thread.manual", {
    threadId,
    machineId,
    replace: shouldReplace,
  });
  const target = {
    name: "thread",
    params: { machineId, threadId },
    query: preservedRouteQuery(),
  } satisfies RouteLocationRaw;
  void (shouldReplace ? router.replace(target) : router.push(target));
}

function handleThreadCreateNavigation(creation: ThreadCreateNavigationPromise) {
  const tempId = creation.tempId;
  if (tempId) {
    navigateToThread(tempId);
  }

  void creation
    .then((threadId) => {
      if (tempId && routeThreadId.value === tempId) {
        navigateToThread(threadId, true);
        return;
      }
      if (!tempId) {
        navigateToThread(threadId);
      }
    })
    .catch(() => {});
}

function createThreadAfterClosingChrome(projectLabel: string, mode: ThreadCreateMode, cwd?: string) {
  clearDeferredThreadCreate();
  deferredThreadCreateRequest = {
    projectLabel,
    mode,
    cwd,
    waitingForDialogLeave: false,
    waitingForDrawerLeave: false,
  };
  deferredThreadCreateFallbackTimer = window.setTimeout(() => {
    if (!deferredThreadCreateRequest) {
      return;
    }
    deferredThreadCreateRequest.waitingForDialogLeave = false;
    deferredThreadCreateRequest.waitingForDrawerLeave = false;
    flushDeferredThreadCreate();
  }, THREAD_CREATE_CHROME_CLOSE_FALLBACK_MS);
  closeDialog();
  closeSidebar();
  window.requestAnimationFrame(() => {
    flushDeferredThreadCreate();
  });
}

function flushDeferredThreadCreate() {
  const request = deferredThreadCreateRequest;
  if (!request || request.waitingForDialogLeave || request.waitingForDrawerLeave) {
    return;
  }
  clearDeferredThreadCreateFallbackTimer();
  deferredThreadCreateRequest = null;
  handleThreadCreateNavigation(client.createThread(request.projectLabel, request.mode, request.cwd));
}

function handleDrawerThreadClick(threadId: string) {
  clearPendingDrawerThreadNavigation();
  closeSidebar();
  if (currentThread.value?.id === threadId) {
    return;
  }
  pendingDrawerThreadNavigationId = threadId;
  drawerThreadNavigationTimer = window.setTimeout(() => {
    flushPendingDrawerThreadNavigation();
  }, DRAWER_CLOSE_NAVIGATION_FALLBACK_MS);
}

function flushPendingDrawerThreadNavigation() {
  const threadId = pendingDrawerThreadNavigationId;
  if (!threadId) {
    return;
  }
  clearDrawerThreadNavigationTimer();
  pendingDrawerThreadNavigationId = null;
  navigateToThread(threadId);
}

function handleDrawerAfterLeave() {
  if (deferredThreadCreateRequest) {
    deferredThreadCreateRequest.waitingForDrawerLeave = false;
    flushDeferredThreadCreate();
  }
  window.requestAnimationFrame(() => {
    flushPendingDrawerThreadNavigation();
  });
}

function handleDialogAfterLeave() {
  if (!deferredThreadCreateRequest) {
    return;
  }
  deferredThreadCreateRequest.waitingForDialogLeave = false;
  flushDeferredThreadCreate();
}

function navigateHome() {
  client.logFlowTrace("route.home.manual");
  if (state.snapshot?.selectedThreadId) {
    client.clearThreadSelection();
  }
  void router.push({
    name: "home",
    query: preservedRouteQuery(),
  });
}

function closePanel() {
  closeModelPicker();
  closeThreadMenu();
  closeDrawerThreadMenu();
  if (shellPageStack.value.length > 1) {
    shellPageStack.value = shellPageStack.value.slice(0, -1);
    return;
  }

  shellPageStack.value = [];
}

function closeDialog() {
  closeModelPicker();
  closeThreadMenu();
  closeDrawerThreadMenu();
  resetProjectBrowserState();
  resetProjectDiffState();
  dialogState.value = null;
  dialogInput.value = "";
}

function confirmDialogAction() {
  if (!dialogState.value) {
    return;
  }

  if (dialogState.value.kind === "create-thread") {
    if (createThreadBlockedReason.value) {
      pushUiToast("error", createThreadBlockedReason.value);
      return;
    }
    const nextSelection = createThreadSelection.value;
    if (!nextSelection?.cwd && nextSelection?.isCustom) {
      return;
    }
    createThreadAfterClosingChrome(
      nextSelection?.projectLabel ?? dialogState.value.projectLabel,
      dialogState.value.mode,
      nextSelection?.cwd ?? dialogState.value.cwd ?? undefined
    );
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

  if (dialogState.value.kind === "delete-thread") {
    client.deleteThread(dialogState.value.threadId);
    closeDialog();
    return;
  }

  if (dialogState.value.kind === "archive-group") {
    const projectLabel = dialogState.value.projectLabel;
    const group = threadGroups.value.find((entry) => entry.label === projectLabel);
    if (group) {
      for (const thread of group.threads) {
        client.toggleArchiveThread(thread);
      }
    }
    closeDialog();
  }
}

function applyComposerSuggestion(value: string) {
  state.ui.composerText = state.ui.composerText.replace(/(^|\s)([@$/])([^\s]*)$/, (_match, space) => `${space}${value} `);
}

function focusComposerInput() {
  const input = composerInputEl.value;
  if (!input) {
    return;
  }
  input.focus();
  const cursor = input.value.length;
  input.setSelectionRange(cursor, cursor);
}

function applyTurnStarterPrompt(prompt: string) {
  state.ui.composerText = prompt;
  void nextTick(() => {
    focusComposerInput();
  });
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

function preservedRouteQuery() {
  const flowTrace = route.query.flowTrace;
  return flowTrace === undefined ? {} : { flowTrace };
}

function normalizedRouteParam(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return null;
}

function isPendingThreadId(threadId: string | null) {
  return Boolean(threadId?.startsWith("pending-thread:"));
}

function currentRouteMachineId() {
  if (route.name === "thread") {
    const routeMachineId = normalizedRouteParam(route.params.machineId);
    if (routeMachineId) {
      return routeMachineId;
    }
  }
  return (
    state.snapshot?.activeBridgeId ??
    state.snapshot?.bridgeDevices.find((device) => device.state === "connected")?.id ??
    state.snapshot?.bridgeDevices.find((device) => device.bridgeOnline)?.id ??
    state.snapshot?.bridgeDevices[0]?.id ??
    null
  );
}

function routeLocationForState(): RouteLocationRaw {
  if (!isAuthenticated.value) {
    return {
      name: FLOW_ROUTE_NAMES[rootFlow.value === "auto" ? "email-otp" : rootFlow.value] ?? "email-otp",
      query: preservedRouteQuery(),
    };
  }

  if (activePanel.value) {
    return {
      name: PANEL_ROUTE_NAMES[activePanel.value],
      query: preservedRouteQuery(),
    };
  }

  if (currentThread.value?.id) {
    const machineId = currentRouteMachineId();
    if (!machineId) {
      return {
        name: "home",
        query: preservedRouteQuery(),
      };
    }
    return {
      name: "thread",
      params: { machineId, threadId: currentThread.value.id },
      query: preservedRouteQuery(),
    };
  }

  const selectedThreadId = state.snapshot?.selectedThreadId ?? null;
  if (
    routeThreadId.value &&
    isPendingThreadId(routeThreadId.value) &&
    selectedThreadId &&
    selectedThreadId !== routeThreadId.value &&
    state.snapshot?.threads.some((thread) => thread.id === selectedThreadId)
  ) {
    const machineId = currentRouteMachineId();
    if (machineId) {
      return {
        name: "thread",
        params: { machineId, threadId: selectedThreadId },
        query: preservedRouteQuery(),
      };
    }
  }
  if (
    routeThreadId.value &&
    selectedThreadId &&
    selectedThreadId !== routeThreadId.value &&
    pendingThreadRoute.value?.threadId !== routeThreadId.value &&
    state.snapshot?.threads.some((thread) => thread.id === selectedThreadId)
  ) {
    const machineId = currentRouteMachineId();
    if (machineId) {
      return {
        name: "thread",
        params: { machineId, threadId: selectedThreadId },
        query: preservedRouteQuery(),
      };
    }
  }

  return {
    name: "home",
    query: preservedRouteQuery(),
  };
}

function syncRouteFromState() {
  if (applyingRouteState.value || !routeStateHydrated.value) {
    return;
  }

  const target = routeLocationForState();
  const resolved = router.resolve(target);
  if (resolved.fullPath !== route.fullPath) {
    void router.replace(target);
  }
}

function syncStateFromRoute() {
  if (route.name == null) {
    return;
  }

  const routeName = route.name as AppRouteName;
  const panel = ROUTE_NAME_TO_PANEL[routeName];
  const routeMachineId = normalizedRouteParam(route.params.machineId);
  const routeThreadId = normalizedRouteParam(route.params.threadId);

  applyingRouteState.value = true;
  try {
    if (!isAuthenticated.value) {
      if (panel) {
        pendingShellPage.value = panel;
        switchRootFlow("email-otp");
        return;
      }

      if (routeName === "thread" && routeThreadId) {
        pendingThreadRoute.value = {
          machineId: routeMachineId,
          threadId: routeThreadId,
        };
        switchRootFlow("email-otp");
        return;
      }

      if (
        routeName === "onboarding" ||
        routeName === "bootstrap-failure" ||
        routeName === "subscription-gate" ||
        routeName === "email-otp"
      ) {
        switchRootFlow(routeName);
      } else {
        rootFlowState.value = "auto";
      }
      return;
    }

    rootFlowState.value = "auto";

    if (panel) {
      openPanel(panel, true);
      return;
    }

    if (routeName === "thread" && routeThreadId) {
      closeModelPicker();
      closeThreadMenu();
      shellPageStack.value = [];
      if (
        routeMachineId &&
        state.snapshot?.activeBridgeId !== routeMachineId &&
        state.snapshot?.bridgeDevices.some((device) => device.id === routeMachineId)
      ) {
        pendingThreadRoute.value = {
          machineId: routeMachineId,
          threadId: routeThreadId,
        };
        client.selectBridge(routeMachineId);
        return;
      }
      if (state.snapshot?.threads.some((thread) => thread.id === routeThreadId)) {
        if (state.snapshot.selectedThreadId !== routeThreadId) {
          client.selectThread(routeThreadId);
        }
      } else {
        pendingThreadRoute.value = {
          machineId: routeMachineId,
          threadId: routeThreadId,
        };
      }
      return;
    }

    closeModelPicker();
    closeThreadMenu();
    shellPageStack.value = [];
    pendingThreadRoute.value = null;
    if (routeName === "home" && state.snapshot?.selectedThreadId) {
      client.clearThreadSelection();
    }
  } finally {
    applyingRouteState.value = false;
    routeStateHydrated.value = true;
  }
}

function readOnboardingSeen() {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function maxConversationScrollTop(scrollEl: HTMLElement) {
  return Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
}

function conversationBottomGap(scrollEl: HTMLElement) {
  return Math.max(0, maxConversationScrollTop(scrollEl) - scrollEl.scrollTop);
}

function isConversationPinnedToBottom() {
  const scrollEl = conversationScrollEl.value;
  if (!scrollEl) {
    return true;
  }
  return conversationBottomGap(scrollEl) <= TURN_BOTTOM_THRESHOLD;
}

function queueFollowBottomScroll() {
  if (autoScrollMode.value !== "followBottom") {
    return;
  }
  if (followBottomFrame !== null) {
    return;
  }
  followBottomFrame = window.requestAnimationFrame(() => {
    followBottomFrame = null;
    if (autoScrollMode.value === "followBottom") {
      scrollConversationToBottom();
    }
  });
}

function clearFollowBottomFrame() {
  if (followBottomFrame !== null) {
    window.cancelAnimationFrame(followBottomFrame);
    followBottomFrame = null;
  }
}

function markProgrammaticConversationScroll() {
  ignoreManualAutoScrollUntil = window.performance.now() + 180;
}

function markUserConversationScrollIntent() {
  userConversationScrollIntentUntil = window.performance.now() + USER_SCROLL_INTENT_MS;
}

function hasRecentUserConversationScrollIntent() {
  return window.performance.now() <= userConversationScrollIntentUntil;
}

function scrollConversationToBottom() {
  const scrollEl = conversationScrollEl.value;
  if (!scrollEl) {
    return;
  }
  const targetTop = maxConversationScrollTop(scrollEl);
  markProgrammaticConversationScroll();
  scrollEl.scrollTop = targetTop;
  lastConversationScrollTop = targetTop;
  isScrolledToBottom.value = true;
}

function restoreHomeScrollPosition() {
  const scrollEl = conversationScrollEl.value;
  if (!scrollEl) {
    window.scrollTo({ top: homeScrollTop, left: 0 });
    return;
  }
  const targetTop = Math.min(homeScrollTop, Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight));
  scrollEl.scrollTop = targetTop;
  lastConversationScrollTop = targetTop;
  window.scrollTo({ top: targetTop, left: 0 });
}

function handleConversationScroll() {
  const scrollEl = conversationScrollEl.value;
  if (!scrollEl) {
    return;
  }
  const nextTop = scrollEl.scrollTop;
  const movingUp = nextTop + 1 < lastConversationScrollTop;
  lastConversationScrollTop = nextTop;
  if (!currentThread.value) {
    homeScrollTop = nextTop;
    autoScrollMode.value = "manual";
    return;
  }
  const pinnedToBottom = isConversationPinnedToBottom();
  isScrolledToBottom.value = pinnedToBottom;
  if (pinnedToBottom) {
    autoScrollMode.value = "followBottom";
    return;
  }
  if (
    autoScrollMode.value === "followBottom" &&
    movingUp &&
    hasRecentUserConversationScrollIntent() &&
    window.performance.now() >= ignoreManualAutoScrollUntil
  ) {
    autoScrollMode.value = "manual";
  }
}

function handleScrollToLatest() {
  autoScrollMode.value = "followBottom";
  isScrolledToBottom.value = true;
  clearFollowBottomFrame();
  scrollConversationToBottom();
}

function loadOlderMessages() {
  if (!currentThread.value) {
    return;
  }
  autoScrollMode.value = "manual";
  client.loadOlderMessages(currentThread.value.id);
}

function historyLoadButtonLabel(thread: ThreadRecord) {
  const history = thread.history;
  if (!history) {
    return "Load earlier messages";
  }
  if (history.isHydrating) {
    return "Loading earlier messages…";
  }
  if (history.remainingMessages === null) {
    return "Load earlier messages";
  }
  const nextChunk = Math.min(history.remainingMessages, 200);
  if (history.remainingMessages <= nextChunk) {
    return `Load ${history.remainingMessages} earlier messages`;
  }
  return `Load ${nextChunk} earlier messages (${history.remainingMessages} remaining)`;
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
                          <AppIcon :name="feature.icon" />
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
                    <div class="onboarding-step-icon"><AppIcon :name="currentOnboardingScreen.icon" /></div>
                    <h2>{{ currentOnboardingScreen.title }}</h2>
                    <p>{{ currentOnboardingScreen.subtitle }}</p>
                    <div class="onboarding-command-card">{{ currentOnboardingCommand }}</div>
                  </div>
                </template>

                <div class="onboarding-flow__bottom">
                  <div class="onboarding-flow__dots">
                    <button
                      v-for="(_, index) in onboardingScreens"
                      :key="index"
                      class="onboarding-flow__dot"
                      :class="{ 'onboarding-flow__dot--active': onboardingPage === index }"
                      @click="setOnboardingPage(index)"
                    ></button>
                  </div>
                  <button class="primary-cta primary-cta--dark" @click="advanceOnboarding()">
                    {{ onboardingCtaLabel }}
                  </button>
                </div>
              </section>

              <section v-else-if="rootFlow === 'bootstrap-failure'" class="root-auth-screen">
                <div class="root-auth-screen__backdrop root-auth-screen__backdrop--failure"></div>
                <header class="root-auth-screen__topbar">
                  <button class="icon-button icon-button--dark" aria-label="Back" @click="switchRootFlow('onboarding')">
                    <AppIcon name="chevron-left" />
                  </button>
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
                  <button class="icon-button icon-button--dark" aria-label="Back" @click="switchRootFlow('bootstrap-failure')">
                    <AppIcon name="chevron-left" />
                  </button>
                  <span>Remodex Pro</span>
                  <span class="root-auth-screen__topbar-spacer"></span>
                </header>
                <div class="root-auth-screen__card root-auth-screen__card--gate">
                  <div class="root-auth-screen__head">
                    <img :src="remodexAppLogo" alt="" class="root-auth-screen__logo" />
                    <span class="section-label section-label--light">Subscription Gate</span>
                    <h2>Unlock the app to connect your phone to Codex running on your computer.</h2>
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
                  <button class="icon-button icon-button--dark" aria-label="Back" @click="switchRootFlow('onboarding')">
                    <AppIcon name="chevron-left" />
                  </button>
                  <span>Email OTP</span>
                  <span class="root-auth-screen__topbar-spacer"></span>
                </header>
                <div class="root-auth-screen__card root-auth-screen__card--email">
                  <div class="root-auth-screen__head">
                    <img :src="remodexAppLogo" alt="" class="root-auth-screen__logo" />
                    <span class="section-label section-label--light">Email OTP</span>
                    <h2>Continue with email verification.</h2>
                    <p>Use a one-time verification code to connect this phone to the relay session running on your computer.</p>
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
                  </template>

                  <p
                    v-if="state.ui.authStatus"
                    class="root-auth-screen__status"
                    :class="`root-auth-screen__status--${state.ui.authStatusTone}`"
                  >
                    {{ state.ui.authStatus }}
                  </p>

                  <button class="root-auth-screen__text-link" @click="restartOnboarding">Show setup flow again</button>
                </div>
              </section>
            </template>

            <template v-else>
              <transition name="panel" mode="out-in">
                <section v-if="activePanel" :key="activePanel" class="mobile-page" :class="`mobile-page--${activePanel}`">
                  <header class="mobile-page__topbar">
                    <button class="mobile-page__nav" :aria-label="panelCanGoBack ? 'Back' : 'Done'" @click="closePanel">
                      <template v-if="panelCanGoBack">
                        <AppIcon name="chevron-left" />
                        <span>Back</span>
                      </template>
                      <span v-else>Done</span>
                    </button>
                    <strong>{{ activePanelTitle }}</strong>
                    <span class="mobile-page__spacer"></span>
                  </header>

                  <div class="mobile-page__body">
                    <template v-if="activePanel === 'archived'">
                      <section class="archived-page">
                        <p class="mobile-page-copy archived-page__note">
                          Permanent delete is unavailable in the current Codex bridge. Archived chats can only be restored.
                        </p>
                        <div v-if="archivedThreads.length" class="archived-list">
                          <article v-for="thread in archivedThreads" :key="thread.id" class="archived-row">
                            <div>
                              <strong>{{ thread.title }}</strong>
                              <span class="archived-row__time">{{ formatRelativeTime(thread.createdAt || thread.lastActivityAt) }}</span>
                              <p>{{ thread.preview }}</p>
                            </div>
                            <div class="archived-row__actions">
                              <button class="archived-row__action" @click="client.toggleArchiveThread(thread)">Restore</button>
                            </div>
                          </article>
                        </div>
                        <div v-else class="archived-empty">
                          <span class="archived-empty__icon"><AppIcon name="archive" /></span>
                          <strong>No archived chats</strong>
                          <p class="mobile-page-copy">Archived conversations will appear here after you move a chat out of the main thread list.</p>
                        </div>
                      </section>
                    </template>

                    <template v-else-if="activePanel === 'paywall'">
                      <section class="paywall-card">
                        <div class="paywall-header">
                          <img :src="remodexAppLogo" alt="" class="paywall-header__logo" />
                          <span class="section-label">Remodex Pro</span>
                          <h2 class="mobile-page-hero-title">Unlock Remodex Pro</h2>
                          <p class="mobile-page-copy">Everything runs on your computer. Your phone is the remote.</p>
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
                          <p class="mobile-page-copy">Purchase, restore, and manage are preview-only in this local build.</p>
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
                  <transition name="drawer" @after-leave="handleDrawerAfterLeave">
                    <aside v-if="state.ui.sidebarOpen" class="phone-drawer phone-drawer--open">
                      <div class="phone-drawer__toolbar">
                        <div class="phone-drawer__toolbar-copy">
                          <span class="section-label">Conversations</span>
                          <span>{{ liveThreadCount }} chats</span>
                        </div>

                        <div class="drawer-search-row">
                          <input
                            v-model="state.ui.search"
                            class="drawer-search"
                            type="search"
                            placeholder="Search conversations"
                          />
                          <button class="icon-button icon-button--tiny drawer-new-chat" aria-label="New chat" @click="startLocalChat">
                            <AppIcon name="plus" />
                          </button>
                        </div>
                      </div>

                      <div class="drawer-groups">
                        <div v-if="drawerThreadSyncHintVisible" class="drawer-sync-hint" role="status" aria-live="polite">
                          <span class="drawer-sync-hint__dot" aria-hidden="true"></span>
                          <span>Syncing conversations</span>
                        </div>
                        <section v-for="group in threadGroups" :key="group.label" class="drawer-group">
                          <div class="drawer-group__head">
                            <button
                              class="drawer-group__toggle"
                              type="button"
                              :aria-expanded="isDrawerGroupExpanded(group.label)"
                              @click="toggleDrawerGroup(group.label)"
                            >
                              <span
                                class="drawer-group__chevron"
                                :class="{ 'drawer-group__chevron--expanded': isDrawerGroupExpanded(group.label) }"
                              >
                                <AppIcon name="chevron-down" />
                              </span>
                              <p class="drawer-group__label">{{ group.label }}</p>
                              <span class="drawer-group__count">{{ group.liveCount }}</span>
                            </button>
                            <div class="drawer-group__head-actions">
                              <button
                                class="drawer-group__icon-action"
                                :aria-label="`Archive ${group.liveCount} chats in ${group.label}`"
                                @click.stop="handleArchiveGroup(group.label)"
                              >
                                <AppIcon name="archive" />
                              </button>
                              <button
                                class="drawer-group__icon-action"
                                :aria-label="`Start a new chat in ${group.label}`"
                                @click.stop="openCreateThreadDialog('local', group.label, group.cwd)"
                              >
                                <AppIcon name="plus" />
                              </button>
                            </div>
                          </div>

                          <div v-if="isDrawerGroupExpanded(group.label)" class="drawer-group__threads">
                            <article
                              v-for="thread in visibleDrawerThreads(group)"
                              :key="thread.id"
                              class="drawer-thread"
                              :class="{
                                'drawer-thread--selected': currentThread?.id === thread.id,
                              }"
                              role="button"
                              tabindex="0"
                              @click="handleDrawerThreadClick(thread.id)"
                              @keydown.enter.prevent="handleDrawerThreadClick(thread.id)"
                              @keydown.space.prevent="handleDrawerThreadClick(thread.id)"
                            >
                              <div class="drawer-thread__indicator">
                                <span :class="`drawer-thread__dot drawer-thread__dot--${thread.state}`"></span>
                                <span v-if="thread.isWorktree" class="drawer-thread__badge">
                                  <AppIcon name="worktree" />
                                  <span>WT</span>
                                </span>
                                <span v-else-if="thread.isForked" class="drawer-thread__badge">
                                  <span>Fork</span>
                                </span>
                              </div>

                              <div class="drawer-thread__body">
                                <div class="drawer-thread__top">
                                  <strong>{{ thread.title }}</strong>
                                  <span>{{ formatRelativeTime(thread.createdAt) }}</span>
                                </div>
                              </div>

                              <div class="drawer-thread__actions">
                                <div
                                  :ref="(el) => setDrawerThreadMenuEl(thread.id, el)"
                                  class="drawer-thread-menu"
                                >
                                  <button
                                    class="icon-button icon-button--tiny drawer-thread-menu__trigger"
                                    type="button"
                                    aria-label="More chat actions"
                                    :aria-expanded="drawerThreadMenuOpenId === thread.id"
                                    aria-haspopup="menu"
                                    @click.stop="toggleDrawerThreadMenu(thread.id)"
                                  >
                                    <AppIcon name="more-horizontal" />
                                  </button>

                                  <transition name="composer-picker">
                                    <div
                                      v-if="drawerThreadMenuOpenId === thread.id"
                                      class="drawer-thread-menu__panel"
                                      role="menu"
                                      aria-label="Chat actions"
                                      @click.stop
                                    >
                                      <button class="drawer-thread-menu__action" type="button" role="menuitem" @click="handleRenameThread(thread.id, thread.title)">
                                        <AppIcon name="edit" />
                                        <span>Edit</span>
                                      </button>
                                      <button class="drawer-thread-menu__action" type="button" role="menuitem" @click="client.toggleArchiveThread(thread); closeDrawerThreadMenu()">
                                        <AppIcon name="archive" />
                                        <span>Archive</span>
                                      </button>
                                      <button
                                        class="drawer-thread-menu__action drawer-thread-menu__action--danger"
                                        type="button"
                                        role="menuitem"
                                        @click="handleDeleteThread(thread.id, thread.title)"
                                      >
                                        <AppIcon name="trash" />
                                        <span>Delete</span>
                                      </button>
                                    </div>
                                  </transition>
                                </div>
                              </div>
                            </article>
                            <button
                              v-if="hiddenDrawerThreadCount(group) > 0"
                              class="drawer-thread-more"
                              type="button"
                              @click="showMoreDrawerThreads(group)"
                            >
                              Show {{ Math.min(DRAWER_THREAD_BATCH_SIZE, hiddenDrawerThreadCount(group)) }} more
                            </button>
                          </div>
                        </section>
                      </div>

                      <div class="phone-drawer__foot">
                        <div class="phone-drawer__footer-card">
                          <span class="drawer-status__label">
                            {{
                              state.snapshot?.connection.state === "connected"
                                ? "Connected to Computer"
                                : state.snapshot?.connection.bridgeOnline
                                  ? "Linked Computer"
                                  : "Trusted Computer"
                            }}
                          </span>
                          <div class="drawer-status">
                            <strong>{{ currentBridgeDeviceLabel }}</strong>
                            <span class="drawer-status__meta">
                              {{ state.snapshot?.connection.relayLabel }}
                            </span>
                            <div v-if="drawerRateLimitRows.length" class="drawer-status__quota">
                              <button
                                class="drawer-status__quota-toggle"
                                :class="{ 'drawer-status__quota-toggle--expanded': drawerRateLimitExpanded }"
                                type="button"
                                :aria-expanded="drawerRateLimitExpanded"
                                @click="drawerRateLimitExpanded = !drawerRateLimitExpanded"
                              >
                                <span>Usage limits</span>
                                <AppIcon name="chevron-down" aria-hidden="true" />
                              </button>
                              <div
                                v-if="drawerVisibleRateLimitRows.length"
                                class="drawer-status__quota-lines"
                              >
                                <span
                                  v-for="row in drawerVisibleRateLimitRows"
                                  :key="row.key"
                                  class="drawer-status__quota-line"
                                  :class="{ 'drawer-status__quota-line--critical': row.remainingPercent < 10 }"
                                >
                                  <strong>{{ row.label }}</strong>
                                  <span>{{ row.detail }}</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div class="drawer-footer-actions">
                          <button class="drawer-footer-pill" @click="navigateHome()">Home</button>
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
                    <button class="icon-button" aria-label="Open menu" @click="openSidebar">
                      <AppIcon name="menu" />
                    </button>

                    <div class="phone-topbar__title">
                      <strong>{{ currentThread?.title ?? "Home" }}</strong>
                      <span v-if="currentThread" class="phone-topbar__subtitle" aria-live="polite">
                        <span class="phone-topbar-status__label" :class="`phone-topbar-status__label--${composerRuntimeState.tone}`">
                          {{ composerRuntimeState.label }}
                        </span>
                        <span class="phone-topbar__workspace">{{ currentThreadWorkspaceLabel }}</span>
                      </span>
                    </div>

                    <span v-if="!currentThread" class="phone-topbar__action" aria-hidden="true"></span>
                    <div v-else ref="threadMenuEl" class="thread-menu">
                      <button
                        class="icon-button phone-topbar__action"
                        type="button"
                        aria-label="Thread actions"
                        :aria-expanded="threadMenuOpen"
                        aria-haspopup="menu"
                        @click="toggleThreadMenu"
                      >
                        <AppIcon name="more-horizontal" />
                      </button>

                      <transition name="composer-picker">
                        <div v-if="threadMenuOpen" class="thread-menu__panel" role="menu" aria-label="Thread actions">
                          <div class="thread-menu__summary">
                            <span class="section-label">Current chat</span>
                            <strong>{{ currentThreadWorkspaceLabel }}</strong>
                            <span>{{ currentThreadSummaryLine }}</span>
                          </div>

                          <button class="thread-menu__action" type="button" role="menuitem" @click="openProjectBrowser(currentThread); closeThreadMenu()">
                            <span class="thread-menu__action-copy">
                              <strong>Project files</strong>
                              <span>Browse the current workspace</span>
                            </span>
                          </button>
                          <button class="thread-menu__action" type="button" role="menuitem" @click="openProjectDiff(currentThread); closeThreadMenu()">
                            <span class="thread-menu__action-copy">
                              <strong>Working tree diff</strong>
                              <span>Inspect pending file changes</span>
                            </span>
                          </button>
                          <button
                            class="thread-menu__action"
                            type="button"
                            role="menuitem"
                            :disabled="isCurrentThreadPendingCreate"
                            @click="startToolbarLocalChat(); closeThreadMenu()"
                          >
                            <span class="thread-menu__action-copy">
                              <strong>New chat here</strong>
                              <span>Start another thread in this workspace</span>
                            </span>
                          </button>
                          <button class="thread-menu__action" type="button" role="menuitem" @click="startWorktreeChat(); closeThreadMenu()">
                            <span class="thread-menu__action-copy">
                              <strong>Start worktree</strong>
                              <span>Create a fresh worktree thread</span>
                            </span>
                          </button>
                        </div>
                      </transition>
                    </div>
                  </header>

                  <div v-if="isCurrentThreadPendingCreate" class="thread-create-notice" role="status" aria-live="polite">
                    <span class="thread-create-notice__dot" aria-hidden="true"></span>
                    <span>Creating this chat on your computer. The URL will update when it is ready.</span>
                  </div>

                  <div v-if="floatingToasts.length" class="toast-stack">
                    <div
                      v-for="toast in floatingToasts"
                      :key="toast.id"
                      class="toast-card"
                      :class="`toast-card--${toast.tone}`"
                    >
                      {{ toast.message }}
                    </div>
                  </div>

                  <section
                    ref="conversationScrollEl"
                    class="phone-conversation"
                    @scroll.passive="handleConversationScroll"
                    @touchstart.passive="markUserConversationScrollIntent"
                    @touchmove.passive="markUserConversationScrollIntent"
                    @wheel.passive="markUserConversationScrollIntent"
                  >
                    <div ref="conversationInnerEl" class="phone-conversation__inner">
                      <template v-if="currentThread && showConversationContent">
                        <div v-if="showCurrentThreadHistoryLoading" class="conversation-history-status">
                          Loading recent messages…
                        </div>
                        <div v-else-if="showLoadOlderMessagesButton" class="conversation-history-actions">
                          <button
                            class="conversation-history-load"
                            type="button"
                            :disabled="currentThread.history?.isHydrating"
                            @click="loadOlderMessages"
                          >
                            {{ historyLoadButtonLabel(currentThread) }}
                          </button>
                        </div>
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

                                <button
                                  v-if="card.type === 'image' && card.imageUrl"
                                  class="message-card__image-preview"
                                  type="button"
                                  @click="openMessageCardImagePreview(card)"
                                >
                                  <img :src="card.imageUrl" :alt="card.detail ?? card.title" />
                                  <span>Tap to preview</span>
                                </button>

                                <div v-if="card.type === 'image'" class="message-card__image-path">
                                  <span>{{ card.meta ?? card.path }}</span>
                                </div>

                                <p v-if="'meta' in card && card.meta" class="message-card__meta-line">{{ card.meta }}</p>
                                <div
                                  v-if="'output' in card && card.output"
                                  class="message-output-shell"
                                  :class="{ 'message-output-shell--unlocked': isOutputBlockUnlocked(outputBlockKey(message.id, `card-${index}`)) }"
                                >
                                  <button
                                    class="message-output-shell__lock"
                                    type="button"
                                    :aria-label="isOutputBlockUnlocked(outputBlockKey(message.id, `card-${index}`)) ? 'Lock output scrolling' : 'Unlock output scrolling'"
                                    @click="toggleOutputBlockScroll(outputBlockKey(message.id, `card-${index}`))"
                                  >
                                    <AppIcon :name="isOutputBlockUnlocked(outputBlockKey(message.id, `card-${index}`)) ? 'unlock' : 'lock'" />
                                  </button>
                                  <pre class="message-card__output"><code>{{ card.output }}</code></pre>
                                </div>
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

                            <div v-if="message.inputImages?.length" class="message-input-images">
                              <figure
                                v-for="(image, index) in message.inputImages"
                                :key="`${message.id}-image-${index}`"
                                class="message-input-image"
                              >
                                <button
                                  class="message-input-image__preview"
                                  type="button"
                                  @click="openInputImagePreview(image, index)"
                                >
                                  <img :src="inputImageSource(image)" :alt="formatInputImageLabel(image, index)" />
                                </button>
                                <figcaption>{{ formatInputImageLabel(image, index) }}</figcaption>
                              </figure>
                            </div>

                            <div v-if="message.text" class="phone-message__copy">
                              <p
                                v-for="(paragraph, paragraphIndex) in splitParagraphs(message.text)"
                                :key="`${message.id}-${paragraphIndex}`"
                              >
                                <template
                                  v-for="(segment, segmentIndex) in splitInlineSegments(paragraph)"
                                  :key="`${message.id}-${paragraphIndex}-${segment.type}-${segmentIndex}`"
                                >
                                  <code v-if="segment.type === 'code'" class="phone-inline-code">{{ segment.text }}</code>
                                  <span v-else-if="segment.type === 'text'">{{ segment.text }}</span>
                                  <span v-else-if="segment.type === 'file-link'" class="phone-inline-file-link" :title="segment.href">
                                    <AppIcon name="file" />
                                    <span class="phone-inline-file-link__label">{{ segment.displayLabel }}</span>
                                    <span v-if="segment.line" class="phone-inline-file-link__line">L{{ segment.line }}</span>
                                  </span>
                                  <button
                                    v-else-if="segment.type === 'image-link'"
                                    class="phone-inline-image-link"
                                    type="button"
                                    @click="openImagePreview(segment.href ?? '', segment.label ?? 'Image', segment.href)"
                                  >
                                    <img :src="segment.href ?? ''" :alt="segment.label ?? 'Image'" />
                                    <span>{{ segment.label }}</span>
                                  </button>
                                  <a v-else class="phone-inline-link" :href="segment.href" target="_blank" rel="noreferrer">
                                    {{ segment.label }}
                                  </a>
                                </template>
                              </p>
                              <span v-if="message.isStreaming" class="stream-cursor"></span>
                            </div>

                            <div
                              v-if="message.codeBlock"
                              class="message-output-shell message-output-shell--standalone"
                              :class="{ 'message-output-shell--unlocked': isOutputBlockUnlocked(outputBlockKey(message.id, 'code')) }"
                            >
                              <button
                                class="message-output-shell__lock"
                                type="button"
                                :aria-label="isOutputBlockUnlocked(outputBlockKey(message.id, 'code')) ? 'Lock code scrolling' : 'Unlock code scrolling'"
                                @click="toggleOutputBlockScroll(outputBlockKey(message.id, 'code'))"
                              >
                                <AppIcon :name="isOutputBlockUnlocked(outputBlockKey(message.id, 'code')) ? 'unlock' : 'lock'" />
                              </button>
                              <pre class="phone-message__code"><code>{{ message.codeBlock.content }}</code></pre>
                            </div>

                            <div v-if="message.fileChanges?.length" class="file-change-stack">
                              <button
                                v-for="change in message.fileChanges"
                                :key="`${message.id}-${change.path}`"
                                class="file-change-row"
                                type="button"
                                @click="openProjectDiff(currentThread, change.path)"
                              >
                                <span>{{ change.action }}</span>
                                <strong>{{ change.path }}</strong>
                                <em>+{{ change.additions }} -{{ change.deletions }}</em>
                              </button>
                            </div>
                          </div>
                        </article>

                        <article
                          v-if="currentPendingRunFeedback && !currentPendingRunFeedback.promptAcknowledged"
                          class="phone-message phone-message--user phone-message--pending"
                        >
                          <div class="phone-message__meta phone-message__meta--pending-user">
                            <span>You</span>
                          </div>

                          <div class="phone-message__pending-bubble">
                            <span
                              v-if="pendingRunStatus"
                              class="phone-message__status-dot"
                              :class="`phone-message__status-dot--${pendingRunStatus.phase}`"
                              aria-hidden="true"
                            ></span>
                            <span v-if="pendingRunStatus?.label" class="phone-message__pending-status">
                              {{ pendingRunStatus.label }}
                            </span>

                            <div class="phone-message__card">
                              <div v-if="currentPendingRunFeedback.images.length" class="message-input-images">
                                <figure
                                  v-for="(image, index) in currentPendingRunFeedback.images"
                                  :key="`pending-image-${index}`"
                                  class="message-input-image"
                                >
                                  <button
                                    class="message-input-image__preview"
                                    type="button"
                                    @click="openInputImagePreview(image, index)"
                                  >
                                    <img :src="inputImageSource(image)" :alt="formatInputImageLabel(image, index)" />
                                  </button>
                                  <figcaption>{{ formatInputImageLabel(image, index) }}</figcaption>
                                </figure>
                              </div>

                              <div class="phone-message__copy">
                                <p
                                  v-for="(paragraph, paragraphIndex) in splitParagraphs(currentPendingRunFeedback.prompt)"
                                  :key="`pending-run-${paragraphIndex}`"
                                >
                                  <template
                                    v-for="(segment, segmentIndex) in splitInlineSegments(paragraph)"
                                    :key="`pending-run-${paragraphIndex}-${segment.type}-${segmentIndex}`"
                                  >
                                    <code v-if="segment.type === 'code'" class="phone-inline-code">{{ segment.text }}</code>
                                    <span v-else-if="segment.type === 'text'">{{ segment.text }}</span>
                                    <span v-else-if="segment.type === 'file-link'" class="phone-inline-file-link" :title="segment.href">
                                      <AppIcon name="file" />
                                      <span class="phone-inline-file-link__label">{{ segment.displayLabel }}</span>
                                      <span v-if="segment.line" class="phone-inline-file-link__line">L{{ segment.line }}</span>
                                    </span>
                                    <button
                                      v-else-if="segment.type === 'image-link'"
                                      class="phone-inline-image-link"
                                      type="button"
                                      @click="openImagePreview(segment.href ?? '', segment.label ?? 'Image', segment.href)"
                                    >
                                      <img :src="segment.href ?? ''" :alt="segment.label ?? 'Image'" />
                                      <span>{{ segment.label }}</span>
                                    </button>
                                    <a v-else class="phone-inline-link" :href="segment.href" target="_blank" rel="noreferrer">
                                      {{ segment.label }}
                                    </a>
                                  </template>
                                </p>
                              </div>
                            </div>
                          </div>
                        </article>

                      </template>

                      <div v-else-if="currentThread" class="turn-empty-canvas" aria-hidden="true"></div>

                      <div v-else class="home-empty-state">
                        <div class="home-connection-panel">
                          <div v-if="showBridgeInstallCard" class="home-install-compact">
                            <div class="home-install-compact__bar">
                              <div class="home-empty-state__install-platforms" role="tablist" aria-label="Install command platform">
                                <button
                                  class="home-empty-state__install-platform"
                                  :class="{ 'home-empty-state__install-platform--active': installCommandPlatform === 'powershell' }"
                                  type="button"
                                  role="tab"
                                  :aria-selected="installCommandPlatform === 'powershell'"
                                  @click="installCommandPlatform = 'powershell'"
                                >
                                  Windows
                                </button>
                                <button
                                  class="home-empty-state__install-platform"
                                  :class="{ 'home-empty-state__install-platform--active': installCommandPlatform === 'shell' }"
                                  type="button"
                                  role="tab"
                                  :aria-selected="installCommandPlatform === 'shell'"
                                  @click="installCommandPlatform = 'shell'"
                                >
                                  Mac/Linux
                                </button>
                              </div>
                              <div class="home-install-compact__actions">
                                <button
                                  class="home-empty-state__install-copy"
                                  :class="{
                                    'home-empty-state__install-copy--copied': installCommandCopyState === 'copied',
                                    'home-empty-state__install-copy--failed': installCommandCopyState === 'failed',
                                  }"
                                  type="button"
                                  :aria-label="bridgeInstallCopyLabel"
                                  :disabled="!installManifest?.command"
                                  @click="copyInstallCommand"
                                >
                                  <AppIcon :name="installCommandCopyState === 'copied' ? 'check' : 'copy'" aria-hidden="true" />
                                  <span aria-hidden="true">Copy</span>
                                </button>
                                <button
                                  class="home-empty-state__install-toggle"
                                  :class="{ 'home-empty-state__install-toggle--expanded': installCommandExpanded }"
                                  type="button"
                                  aria-label="Toggle install command"
                                  :aria-expanded="installCommandExpanded"
                                  @click="installCommandExpanded = !installCommandExpanded"
                                >
                                  <AppIcon name="chevron-down" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                            <div v-if="installCommandExpanded" class="home-empty-state__install-code-shell">
                              <pre
                                class="home-empty-state__install-code"
                                :class="{ 'home-empty-state__install-code--pending': !bridgeInstallCommand.trim() }"
                              ><code>{{ bridgeInstallCommand }}</code></pre>
                            </div>
                          </div>
                        </div>
                        <div v-if="homeBridgeDevices.length" class="home-empty-state__device-list">
                          <span class="section-label">{{ homeBridgeDevices.length > 1 ? "Devices" : "Device" }}</span>
                          <div class="home-empty-state__device-stack">
                            <article
                              v-for="device in homeBridgeDevices"
                              :key="device.id"
                              class="home-empty-state__device-card"
                              :class="{
                                'home-empty-state__device-card--active': isActiveBridgeDevice(device),
                                'home-empty-state__device-card--selectable': canSelectBridgeDevice(device),
                                'home-empty-state__device-card--disabled': !canSelectBridgeDevice(device),
                              }"
                              :role="canSelectBridgeDevice(device) ? 'button' : undefined"
                              :tabindex="canSelectBridgeDevice(device) ? 0 : undefined"
                              :aria-disabled="!canSelectBridgeDevice(device)"
                              @click="selectBridgeDevice(device)"
                              @keydown.enter.prevent="selectBridgeDevice(device)"
                              @keydown.space.prevent="selectBridgeDevice(device)"
                            >
                              <div class="home-empty-state__device-row">
                                <span class="home-empty-state__trusted-icon">
                                  <AppIcon name="home" />
                                </span>
                                <div class="home-empty-state__trusted">
                                  <strong>{{ bridgeDeviceLabel(device) }}</strong>
                                  <p>{{ bridgeDeviceMeta(device) }}</p>
                                </div>
                                <span
                                  v-if="bridgeDeviceStateLabel(device)"
                                  class="home-empty-state__device-chip"
                                  :class="{ 'home-empty-state__device-chip--current': isActiveBridgeDevice(device) }"
                                >
                                  {{ bridgeDeviceStateLabel(device) }}
                                </span>
                              </div>
                            </article>
                          </div>
                        </div>
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
                        <AppIcon name="arrow-down" aria-hidden="true" />
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
                            <div class="queued-draft__copy" :title="draftSummary(draft)">
                              <strong>{{ draftSummary(draft) }}</strong>
                              <span class="queued-draft__meta">{{ formatQueuedDraftMeta(draft) }}</span>
                            </div>
                            <div class="queued-draft__actions">
                              <span v-if="currentThread?.state === 'running'" class="queued-draft__status">Waiting</span>
                              <button
                                v-else
                                class="queued-draft__resume"
                                type="button"
                                aria-label="Resume queued draft"
                                @click="client.resumeDraft(currentThread.id, draft.id)"
                              >
                                Resume
                              </button>
                              <button
                                class="queued-draft__remove"
                                type="button"
                                aria-label="Remove queued draft"
                                @click="client.removeDraft(currentThread.id, draft.id)"
                              >
                                <AppIcon name="close" />
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

                      <div v-else-if="showPendingThreadRail" class="empty-thread-rail empty-thread-rail--status">
                        <span class="section-label">Starting Chat</span>
                        <p>The relay is creating a fresh thread on your computer.</p>
                      </div>

                      <div v-else-if="showTurnStarterRail" class="empty-thread-rail">
                        <div class="empty-thread-rail__head">
                          <span class="section-label">Workspace Actions</span>
                          <span class="empty-thread-rail__context">{{ currentThreadRepoName || currentThread?.projectLabel }}</span>
                        </div>
                        <div class="empty-thread-rail__chips">
                          <button
                            v-for="action in emptyThreadStarterActions"
                            :key="action.label"
                            class="empty-thread-rail__chip"
                            type="button"
                            @click="applyTurnStarterPrompt(action.prompt)"
                          >
                            {{ action.label }}
                          </button>
                        </div>
                      </div>

                      <div class="phone-composer">
                        <input
                          ref="composerImageInputEl"
                          class="composer-image-input"
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          @change="handleComposerImageSelection"
                        />

                        <div v-if="state.ui.composerImages.length" class="composer-image-strip">
                          <div
                            v-for="(image, index) in state.ui.composerImages"
                            :key="`${image.name ?? 'image'}-${index}`"
                            class="composer-image-card"
                          >
                            <button
                              class="composer-image-card__preview"
                              type="button"
                              @click="openInputImagePreview(image, index)"
                            >
                              <img :src="inputImageSource(image)" :alt="formatInputImageLabel(image, index)" />
                              <div class="composer-image-card__copy">
                                <strong>{{ formatInputImageLabel(image, index) }}</strong>
                                <span>{{ image.mimeType || "Image attachment" }}</span>
                              </div>
                            </button>
                            <button
                              class="icon-button icon-button--tiny composer-image-card__remove"
                              type="button"
                              aria-label="Remove image"
                              @click="removeComposerImage(index)"
                            >
                              <AppIcon name="close" />
                            </button>
                          </div>
                        </div>

                        <textarea
                          ref="composerInputEl"
                          v-model="state.ui.composerText"
                          class="phone-composer__input"
                          :disabled="isCurrentThreadPendingCreate"
                          :placeholder="composerPlaceholder"
                          rows="2"
                          @keydown="handleComposerKeyDown"
                        ></textarea>

                        <div class="phone-composer__toolbar">
                          <div class="phone-composer__toolbar-left">
                            <button
                              class="composer-action composer-action--attach"
                              type="button"
                              aria-label="Attach image"
                              :disabled="isCurrentThreadPendingCreate"
                              @click="openComposerImagePicker"
                            >
                              <AppIcon name="file" />
                            </button>

                            <div ref="modelPickerEl" class="model-picker model-picker--runtime">
                              <button
                                class="model-picker__trigger model-picker__trigger--runtime"
                                type="button"
                                aria-haspopup="menu"
                                :aria-expanded="modelPickerOpen"
                                aria-label="Select model, speed, and access mode"
                                :disabled="isCurrentThreadPendingCreate"
                                @click="toggleModelPicker"
                              >
                                <span v-if="state.ui.fastMode" class="model-picker__tier" aria-hidden="true">
                                  <AppIcon name="bolt" />
                                </span>
                                <strong class="model-picker__trigger-label">{{ composerRuntimeLabel }}</strong>
                                <AppIcon name="chevron-down" />
                              </button>

                              <transition name="composer-picker">
                                <div v-if="modelPickerOpen" class="model-picker__menu" role="menu" aria-label="Model and speed options">
                                  <span class="model-picker__section-label">Model</span>
                                  <button
                                    v-for="model in MODELS"
                                    :key="model"
                                    class="model-picker__option"
                                    :class="{ 'model-picker__option--active': state.ui.selectedModel === model }"
                                    type="button"
                                    role="menuitemradio"
                                    :aria-checked="state.ui.selectedModel === model"
                                    @click="selectModel(model)"
                                  >
                                    <span class="model-picker__copy">
                                      <strong>{{ model }}</strong>
                                      <span>{{ modelOptionCopy(model) }}</span>
                                    </span>
                                    <span
                                      class="model-picker__status"
                                      :class="{ 'model-picker__status--visible': state.ui.selectedModel === model }"
                                      aria-hidden="true"
                                    >
                                      <AppIcon name="check" />
                                    </span>
                                  </button>

                                  <div class="model-picker__divider" aria-hidden="true"></div>
                                  <span class="model-picker__section-label">Speed</span>

                                  <button
                                    class="model-picker__option"
                                    :class="{ 'model-picker__option--active': !state.ui.fastMode }"
                                    type="button"
                                    role="menuitemradio"
                                    :aria-checked="!state.ui.fastMode"
                                    @click="selectFastMode(false)"
                                  >
                                    <span class="model-picker__copy">
                                      <strong>Normal</strong>
                                      <span>{{ speedOptionCopy(false) }}</span>
                                    </span>
                                    <span
                                      class="model-picker__status"
                                      :class="{ 'model-picker__status--visible': !state.ui.fastMode }"
                                      aria-hidden="true"
                                    >
                                      <AppIcon name="check" />
                                    </span>
                                  </button>

                                  <button
                                    class="model-picker__option"
                                    :class="{ 'model-picker__option--active': state.ui.fastMode }"
                                    type="button"
                                    role="menuitemradio"
                                    :aria-checked="state.ui.fastMode"
                                    @click="selectFastMode(true)"
                                  >
                                    <span class="model-picker__copy">
                                      <strong>Fast</strong>
                                      <span>{{ speedOptionCopy(true) }}</span>
                                    </span>
                                    <span
                                      class="model-picker__status"
                                      :class="{ 'model-picker__status--visible': state.ui.fastMode }"
                                      aria-hidden="true"
                                    >
                                      <AppIcon name="check" />
                                    </span>
                                  </button>

                                  <div class="model-picker__divider" aria-hidden="true"></div>
                                  <span class="model-picker__section-label">Access</span>

                                  <button
                                    v-for="accessMode in ACCESS_MODE_OPTIONS"
                                    :key="accessMode"
                                    class="model-picker__option"
                                    :class="{ 'model-picker__option--active': state.ui.accessMode === accessMode }"
                                    type="button"
                                    role="menuitemradio"
                                    :aria-checked="state.ui.accessMode === accessMode"
                                    @click="selectAccessMode(accessMode)"
                                  >
                                    <span class="model-picker__copy">
                                      <strong>{{ ACCESS_MODE_LABELS[accessMode] }}</strong>
                                      <span>
                                        {{
                                          accessMode === 'full-access'
                                            ? 'Runs in the local shell.'
                                            : accessMode === 'on-request'
                                              ? 'Ask before privileged actions.'
                                              : 'Inspect without writes.'
                                        }}
                                      </span>
                                    </span>
                                    <span
                                      class="model-picker__status"
                                      :class="{ 'model-picker__status--visible': state.ui.accessMode === accessMode }"
                                      aria-hidden="true"
                                    >
                                      <AppIcon name="check" />
                                    </span>
                                  </button>
                                </div>
                              </transition>
                            </div>
                          </div>

                          <div class="phone-composer__toolbar-right">
                            <button
                              v-if="currentThread?.state === 'running'"
                              class="composer-action composer-action--dark"
                              type="button"
                              aria-label="Stop run"
                              @click="client.stopRun(currentThread.id)"
                            >
                              <AppIcon name="stop" />
                            </button>
                            <button
                              class="send-cta composer-action composer-action--send"
                              :class="`send-cta--${composerSendTone}`"
                              type="button"
                              :disabled="composerSendDisabled"
                              :aria-label="
                                isCurrentThreadPendingCreate
                                  ? 'Starting'
                                  : !composerHasContent
                                    ? 'Compose or attach first'
                                    : currentThread?.state === 'running'
                                      ? 'Send follow-up'
                                      : 'Send'
                              "
                              :title="composerSendTitle"
                              @click="handleSend"
                            >
                              <AppIcon :name="currentThread?.state === 'running' ? 'plus' : 'arrow-up'" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </footer>
                </div>
              </transition>

              <transition name="scrim">
                <div v-if="imagePreviewState" class="image-preview-scrim" @click.self="closeImagePreview">
                  <div class="image-preview-sheet">
                    <div class="image-preview-sheet__head">
                      <div class="image-preview-sheet__copy">
                        <span class="section-label">Image Preview</span>
                        <strong>{{ imagePreviewState.title }}</strong>
                        <span v-if="imagePreviewState.meta">{{ imagePreviewState.meta }}</span>
                      </div>
                      <button class="icon-button icon-button--tiny" type="button" aria-label="Close image preview" @click="closeImagePreview">
                        <AppIcon name="close" />
                      </button>
                    </div>

                    <img class="image-preview-sheet__image" :src="imagePreviewState.src" :alt="imagePreviewState.title" />
                  </div>
                </div>
              </transition>

              <transition name="scrim" @after-leave="handleDialogAfterLeave">
                <div v-if="dialogState" class="app-dialog-scrim" @click.self="closeDialog">
                  <div
                    class="app-dialog-card"
                    :class="{
                      'app-dialog-card--create-thread': dialogState.kind === 'create-thread',
                      'app-dialog-card--inspector': dialogState.kind === 'project-browser' || dialogState.kind === 'project-diff',
                    }"
                  >
                    <div class="app-dialog-card__head">
                      <template v-if="dialogState.kind === 'create-thread'">
                        <div class="thread-create-sheet__head">
                          <h3>{{ dialogTitle }}</h3>
                          <span>{{ drawerProjectTargets.length }} projects</span>
                        </div>
                      </template>
                      <template v-else>
                        <span class="section-label">
                          {{
                            dialogState.kind === "rename-thread"
                              ? "Rename"
                              : dialogState.kind === "project-browser"
                                ? "Project"
                                : dialogState.kind === "project-diff"
                                  ? "Diff"
                                  : dialogState.kind === "delete-thread"
                                    ? "Delete"
                                    : "Confirm"
                          }}
                        </span>
                        <h3>{{ dialogTitle }}</h3>
                        <p>{{ dialogBody }}</p>
                      </template>
                      <p v-if="createThreadBlockedReason" class="app-dialog-card__warning">
                        {{ createThreadBlockedReason }}
                      </p>
                    </div>

                    <template v-if="dialogState.kind === 'create-thread'">
                      <div class="app-dialog-card__body app-dialog-card__body--create-thread">
                        <div class="thread-create-sheet__body">
                          <div class="thread-create-sheet__modes">
                            <button
                              class="thread-create-sheet__mode"
                              :class="{ 'thread-create-sheet__mode--active': dialogState.mode === 'local' }"
                              @click="setCreateThreadMode('local')"
                            >
                              <span class="thread-create-sheet__mode-icon">
                                <AppIcon name="folder" />
                              </span>
                              <div class="thread-create-sheet__mode-copy">
                                <strong>Local</strong>
                                <span>Starts at the project root</span>
                              </div>
                            </button>
                            <button
                              class="thread-create-sheet__mode"
                              :class="{ 'thread-create-sheet__mode--active': dialogState.mode === 'worktree' }"
                              @click="setCreateThreadMode('worktree')"
                            >
                              <span class="thread-create-sheet__mode-icon">
                                <AppIcon name="worktree" />
                              </span>
                              <div class="thread-create-sheet__mode-copy">
                                <strong>Worktree</strong>
                                <span>Creates a fresh git worktree first</span>
                              </div>
                            </button>
                          </div>

                          <div class="thread-create-sheet__custom">
                            <button
                              class="thread-create-sheet__target"
                              :class="{ 'thread-create-sheet__target--active': dialogState.useCustomCwd }"
                              @click="activateCustomCreateThreadInput"
                            >
                              <span class="thread-create-sheet__target-icon">
                                <AppIcon name="plus" />
                              </span>
                              <div class="thread-create-sheet__target-copy">
                                <div class="thread-create-sheet__target-head">
                                  <strong>New path</strong>
                                  <span v-if="dialogState.useCustomCwd" class="thread-create-sheet__target-tag">Custom</span>
                                </div>
                                <p>Paste a full path or type a folder name.</p>
                              </div>
                            </button>

                            <div v-if="dialogState.useCustomCwd" class="thread-create-sheet__custom-body">
                              <label class="input-label input-label--stacked thread-create-sheet__field-label">Project path</label>
                              <input
                                :value="dialogState.customCwdInput"
                                class="input-field app-dialog-card__input"
                                type="text"
                                placeholder="my-project or /Users/young/code/my-project"
                                @input="updateCreateThreadCustomCwd(($event.target as HTMLInputElement).value)"
                              />

                              <div class="thread-create-sheet__preview">
                                <span class="section-label">Resolved Path</span>
                                <strong>{{ createThreadResolvedPathHint }}</strong>
                                <p>{{ createThreadHintCopy }}</p>
                              </div>
                            </div>
                          </div>

                          <div class="thread-create-sheet__targets-wrap">
                            <div class="thread-create-sheet__targets-head">
                              <span class="section-label">Projects</span>
                              <span>{{ drawerProjectTargets.length }}</span>
                            </div>

                            <div class="thread-create-sheet__targets">
                              <button
                                v-for="target in drawerProjectTargets"
                                :key="`${target.label}-${target.cwd ?? 'default'}`"
                                class="thread-create-sheet__target"
                                :class="{
                                  'thread-create-sheet__target--active':
                                    !dialogState.useCustomCwd &&
                                    dialogState.projectLabel === target.label &&
                                    dialogState.cwd === target.cwd,
                                }"
                                @click="selectCreateThreadTarget(target)"
                              >
                                <span class="thread-create-sheet__target-icon">
                                  <AppIcon :name="dialogState.mode === 'worktree' ? 'worktree' : 'folder'" />
                                </span>
                                <div class="thread-create-sheet__target-copy">
                                  <div class="thread-create-sheet__target-head">
                                    <strong>{{ target.label }}</strong>
                                    <span v-if="target.isCurrent" class="thread-create-sheet__target-tag">Current</span>
                                  </div>
                                  <p>
                                    {{ target.detail }} · {{ target.liveCount }} live
                                    {{ target.liveCount === 1 ? "chat" : "chats" }}
                                  </p>
                                </div>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </template>
                    <template v-else-if="dialogState.kind === 'project-browser'">
                      <div class="project-inspector">
                        <div class="project-inspector__toolbar">
                          <div class="project-inspector__summary">
                            <span class="section-label">Path</span>
                            <strong>{{ formatProjectPath(dialogState.currentPath) }}</strong>
                            <span>{{ projectTree?.entries.length ?? 0 }} items</span>
                          </div>
                          <button
                            v-if="normalizeProjectPath(dialogState.currentPath) !== '.'"
                            class="ghost-cta ghost-cta--compact"
                            type="button"
                            @click="openProjectParentDirectory"
                          >
                            Up
                          </button>
                        </div>

                        <p v-if="projectTreeError" class="project-inspector__error">{{ projectTreeError }}</p>

                        <div class="project-browser">
                          <div class="project-browser__list">
                            <div v-if="projectTreeLoading" class="project-browser__empty">Loading files…</div>
                            <template v-else>
                              <button
                                v-if="normalizeProjectPath(dialogState.currentPath) !== '.'"
                                class="project-browser__entry project-browser__entry--parent"
                                type="button"
                                @click="openProjectParentDirectory"
                              >
                                <span class="project-browser__entry-icon">
                                  <AppIcon name="chevron-left" />
                                </span>
                                <div class="project-browser__entry-copy">
                                  <strong>..</strong>
                                  <span>Back to {{ formatProjectPath(parentProjectPath(dialogState.currentPath)) }}</span>
                                </div>
                              </button>
                              <button
                                v-for="entry in projectTree?.entries ?? []"
                                :key="entry.path"
                                class="project-browser__entry"
                                :class="{ 'project-browser__entry--active': dialogState.selectedFilePath === entry.path }"
                                type="button"
                                @click="selectProjectEntry(entry)"
                              >
                                <span class="project-browser__entry-icon">
                                  <AppIcon :name="entry.kind === 'directory' ? 'folder' : 'file'" />
                                </span>
                                <div class="project-browser__entry-copy">
                                  <strong>{{ entry.name }}</strong>
                                  <span>{{ formatProjectEntryMeta(entry) }}</span>
                                </div>
                              </button>
                              <div v-if="!(projectTree?.entries.length ?? 0)" class="project-browser__empty">
                                This folder is empty.
                              </div>
                            </template>
                          </div>

                          <div class="project-preview">
                            <div v-if="projectFileLoading" class="project-preview__empty">Loading file preview…</div>
                            <template v-else-if="projectFile">
                              <div class="project-preview__head">
                                <strong>{{ projectFile.path }}</strong>
                                <span>{{ projectFile.fileKind === "text" ? projectFile.mimeType : "Binary file" }}</span>
                              </div>
                              <pre v-if="projectFile.fileKind === 'text'" class="project-preview__code"><code>{{ projectFile.content ?? "" }}</code></pre>
                              <div v-else class="project-preview__empty">Binary previews stay lazy. Open this file on your computer for the full view.</div>
                              <p v-if="projectFile.truncated" class="project-preview__note">Preview truncated at 256 KB.</p>
                            </template>
                            <div v-else-if="projectFileError" class="project-preview__empty">{{ projectFileError }}</div>
                            <div v-else class="project-preview__empty">Select a file to lazily load its contents.</div>
                          </div>
                        </div>
                      </div>
                    </template>
                    <template v-else-if="dialogState.kind === 'project-diff'">
                      <div class="project-inspector">
                        <div class="project-inspector__toolbar">
                          <div class="project-inspector__summary">
                            <span class="section-label">Scope</span>
                            <strong>{{ formatProjectPath(dialogState.filterPath) }}</strong>
                            <span>+{{ projectDiff?.summary.additions ?? 0 }} -{{ projectDiff?.summary.deletions ?? 0 }}</span>
                          </div>
                          <button
                            v-if="dialogState.filterPath"
                            class="ghost-cta ghost-cta--compact"
                            type="button"
                            @click="openProjectDiff(findThreadRecord(dialogState.threadId), null)"
                          >
                            Clear Filter
                          </button>
                        </div>

                        <p v-if="projectDiffError" class="project-inspector__error">{{ projectDiffError }}</p>

                        <div class="project-diff-browser">
                          <div class="project-diff-browser__list">
                            <div v-if="projectDiffLoading" class="project-browser__empty">Loading diff…</div>
                            <template v-else>
                              <button
                                v-for="file in projectDiff?.files ?? []"
                                :key="file.path"
                                class="project-diff-browser__entry"
                                :class="{ 'project-diff-browser__entry--active': selectedProjectDiff?.path === file.path }"
                                type="button"
                                @click="selectProjectDiffFile(file.path)"
                              >
                                <div class="project-diff-browser__copy">
                                  <strong>{{ file.path }}</strong>
                                  <span>{{ file.action }}</span>
                                </div>
                                <em>+{{ file.additions }} -{{ file.deletions }}</em>
                              </button>
                              <div v-if="!(projectDiff?.files.length ?? 0)" class="project-browser__empty">
                                No working-tree changes for this scope.
                              </div>
                            </template>
                          </div>

                          <div class="project-preview">
                            <template v-if="selectedProjectDiff">
                              <div class="project-preview__head">
                                <strong>{{ selectedProjectDiff.path }}</strong>
                                <span>{{ selectedProjectDiff.action }} · +{{ selectedProjectDiff.additions }} -{{ selectedProjectDiff.deletions }}</span>
                              </div>
                              <pre class="project-preview__code project-preview__code--diff"><code>{{ selectedProjectDiff.patch }}</code></pre>
                            </template>
                            <div v-else class="project-preview__empty">Select a changed file to inspect its patch.</div>
                          </div>
                        </div>
                      </div>
                    </template>

                    <input
                      v-else-if="dialogState.kind === 'rename-thread'"
                      v-model="dialogInput"
                      class="input-field app-dialog-card__input"
                      type="text"
                      placeholder="Conversation title"
                    />

                    <div v-else-if="dialogState.kind === 'delete-thread'" class="app-dialog-card__danger-copy">
                      <strong>{{ dialogState.title }}</strong>
                      <span>Use archive if you only want to hide this chat from the main list.</span>
                    </div>

                    <div
                      class="alert-card__actions app-dialog-card__footer"
                      :class="{
                        'alert-card__actions--dialog':
                          dialogState.kind === 'create-thread' ||
                          dialogState.kind === 'project-browser' ||
                          dialogState.kind === 'project-diff',
                      }"
                    >
                      <template v-if="dialogState.kind === 'project-browser' || dialogState.kind === 'project-diff'">
                        <button class="ghost-cta ghost-cta--compact" type="button" @click="closeDialog">Close</button>
                      </template>
                      <template v-else>
                        <button class="ghost-cta ghost-cta--compact" @click="closeDialog">Cancel</button>
                        <button
                          class="primary-cta primary-cta--compact"
                          :class="{ 'primary-cta--danger': dialogState.kind === 'delete-thread' }"
                          :disabled="dialogConfirmDisabled"
                          @click="confirmDialogAction"
                        >
                          {{ dialogConfirmLabel }}
                        </button>
                      </template>
                    </div>
                  </div>
                </div>
              </transition>

        </template>
    </div>
  </div>
</template>
