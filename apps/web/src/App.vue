<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import { ACCESS_MODE_LABELS, MODELS } from "@phodex/shared";
import type {
  AccessMode,
  BridgeDeviceSummary,
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
  | "edit"
  | "file"
  | "folder"
  | "home"
  | "info"
  | "menu"
  | "more-horizontal"
  | "plus"
  | "relay"
  | "settings"
  | "restore"
  | "stop"
  | "terminal"
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
  type: "text" | "code" | "link" | "file-link";
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
  settings: {
    circles: [{ cx: 12, cy: 12, r: 2.5 }],
    lines: [
      { x1: 12, y1: 3.5, x2: 12, y2: 6 },
      { x1: 12, y1: 18, x2: 12, y2: 20.5 },
      { x1: 3.5, y1: 12, x2: 6, y2: 12 },
      { x1: 18, y1: 12, x2: 20.5, y2: 12 },
      { x1: 6.35, y1: 6.35, x2: 8.15, y2: 8.15 },
      { x1: 15.85, y1: 15.85, x2: 17.65, y2: 17.65 },
      { x1: 15.85, y1: 8.15, x2: 17.65, y2: 6.35 },
      { x1: 6.35, y1: 17.65, x2: 8.15, y2: 15.85 },
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

type ShellPageState = "settings" | "archived" | "about" | "paywall";

type AppDialogState =
  | { kind: "rename-thread"; threadId: string; title: string }
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

type AppRouteName =
  | "home"
  | "thread"
  | "settings"
  | "archived"
  | "about"
  | "paywall"
  | "onboarding"
  | "email-otp"
  | "subscription-gate"
  | "bootstrap-failure";

const PANEL_ROUTE_NAMES: Record<ShellPageState, AppRouteName> = {
  settings: "settings",
  archived: "archived",
  about: "about",
  paywall: "paywall",
};

const ROUTE_NAME_TO_PANEL: Partial<Record<AppRouteName, ShellPageState>> = {
  settings: "settings",
  archived: "archived",
  about: "about",
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
const imagePreviewState = ref<ImagePreviewState | null>(null);
const composerImageInputEl = ref<HTMLInputElement | null>(null);
const composerInputEl = ref<HTMLTextAreaElement | null>(null);
const conversationScrollEl = ref<HTMLElement | null>(null);
const conversationInnerEl = ref<HTMLElement | null>(null);
const autoScrollMode = ref<TurnAutoScrollMode>("followBottom");
const isScrolledToBottom = ref(true);

const TURN_BOTTOM_THRESHOLD = 24;
const PROJECTS_ROOT_HINT = "~/.phodex-web/projects";
const MAX_COMPOSER_IMAGE_BYTES = 5 * 1024 * 1024;
const DRAWER_THREAD_SYNC_HINT_MS = 8_000;
const ACCESS_MODE_OPTIONS: AccessMode[] = ["read-only", "on-request", "full-access"];
const ACCESS_MODE_COMPACT_LABELS: Record<AccessMode, string> = {
  "read-only": "Read",
  "on-request": "Ask",
  "full-access": "Full",
};

let followBottomFrame: number | null = null;
let conversationResizeObserver: ResizeObserver | null = null;
let lastConversationScrollTop = 0;
let ignoreManualAutoScrollUntil = 0;
let installCommandCopyTimer: number | null = null;
let drawerThreadSyncTimer: number | null = null;
const installManifest = ref<InstallManifest | null>(null);
const installManifestLoading = ref(false);
const installCommandCopyState = ref<"idle" | "copied" | "failed">("idle");
const installCommandPlatform = ref<InstallCommandPlatform>("shell");
const expandedDrawerGroups = ref<string[]>([]);
const drawerThreadSyncing = ref(false);
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
    subtitle: "Control Codex from your iPhone.",
    badge: "Runs on your Mac",
  },
  {
    kind: "features",
    title: "What you get",
    subtitle: "Everything runs on your Mac. Your phone is the remote.",
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
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
  void client.restoreSession();
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeyDown);
  clearFollowBottomFrame();
  conversationResizeObserver?.disconnect();
  conversationResizeObserver = null;
  clearInstallCommandCopyTimer();
  clearDrawerThreadSyncTimer();
});

const isAuthenticated = computed(() => Boolean(state.session && state.snapshot));
const onboardingBridgeCommand = computed(
  () => "Sign in with email first. The app will mint a short-lived install command that only this account can claim."
);
const bridgeInstallShellLabel = computed(() => (installCommandPlatform.value === "powershell" ? "PowerShell" : "Shell"));
const bridgeInstallRunHint = computed(() =>
  installCommandPlatform.value === "powershell" ? "Run in PowerShell" : "Run in Terminal"
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
const showBridgeLinkedWarning = computed(
  () => isAuthenticated.value && state.snapshot?.connection.bridgeOnline && state.snapshot?.connection.state !== "connected"
);
const bridgeInstallTitle = computed(() => {
  if (state.snapshot?.connection.bridgeOnline) {
    return "Add another computer";
  }
  return "Install bridge for this account";
});
const bridgeInstallCopy = computed(() =>
  installManifest.value?.command
    ? state.snapshot?.connection.bridgeOnline
      ? `Generated for ${state.snapshot?.user.email ?? "this account"}. Run it in ${bridgeInstallRunHint.value === "Run in PowerShell" ? "PowerShell" : "Terminal"} on another machine to add one more trusted device.`
      : `Generated for ${state.snapshot?.user.email ?? "this account"}. Run it in ${bridgeInstallRunHint.value === "Run in PowerShell" ? "PowerShell" : "Terminal"} to install the local bridge.`
    : "Signed in. Preparing a secure install command…"
);
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
const bridgeInstallRefreshLabel = computed(() => {
  if (installManifestLoading.value) {
    return "Refreshing…";
  }
  return installManifest.value?.command ? "New command" : "Retry";
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
const isCurrentThreadPendingCreate = computed(() =>
  Boolean(currentThread.value?.id.startsWith("pending-thread:"))
);
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
  [threadGroups, () => currentThread.value?.projectLabel ?? "", () => state.ui.search.trim()],
  ([groups, currentProjectLabel, search]) => {
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

watch(liveThreadCount, (count) => {
  if (count > 0) {
    drawerThreadSyncing.value = false;
    clearDrawerThreadSyncTimer();
  }
});

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
      detail: "Uses the relay default project root on your Mac.",
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
  [...(state.snapshot?.threads ?? [])]
    .filter((thread) => thread.state === "archived")
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
);
const drawerThreadSyncHintVisible = computed(() =>
  state.ui.sidebarOpen &&
  drawerThreadSyncing.value &&
  !state.ui.search.trim() &&
  threadGroups.value.length === 0 &&
  (state.snapshot?.connection.state === "connected" || state.snapshot?.connection.state === "connecting")
);
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
const composerHasText = computed(() => Boolean(state.ui.composerText.trim()));
const composerHasImage = computed(() => state.ui.composerImages.length > 0);
const composerHasContent = computed(() => composerHasText.value || composerHasImage.value);
const composerSendDisabled = computed(() => isCurrentThreadPendingCreate.value || !composerHasContent.value);
const composerSendTone = computed(() => {
  if (composerSendDisabled.value) {
    return "idle";
  }
  return currentThread.value?.state === "running" ? "queue" : "ready";
});
const composerSendTitle = computed(() => {
  if (isCurrentThreadPendingCreate.value) {
    return "Starting";
  }
  if (!composerHasContent.value) {
    return "Compose or attach first";
  }
  return currentThread.value?.state === "running" ? "Queue" : "Send";
});
const composerRuntimeLabel = computed(
  () => `${state.ui.selectedModel} · ${ACCESS_MODE_COMPACT_LABELS[state.ui.accessMode]}`
);
const composerRuntimeState = computed(() => {
  const connection = state.snapshot?.connection;
  const macLabel = connection?.macLabel?.trim() || "your Mac";

  if (isCurrentThreadPendingCreate.value) {
    return {
      label: "Starting",
      detail: "Creating a fresh chat on your Mac",
      tone: "amber",
    } as const;
  }

  if (connection?.state === "disconnected") {
    return {
      label: "Offline",
      detail: `Reconnect ${macLabel}`,
      tone: "slate",
    } as const;
  }

  if (connection?.bridgeOnline && connection.state !== "connected") {
    return {
      label: "Syncing",
      detail: `Rehydrating ${macLabel}`,
      tone: "amber",
    } as const;
  }

  if (currentThread.value?.state === "running") {
    return {
      label: "Running",
      detail: currentThread.value.queuedDrafts.length
        ? `${currentThread.value.queuedDrafts.length} queued next`
        : `Working on ${macLabel}`,
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
    detail: connection?.state === "connected" ? `On ${macLabel}` : null,
    tone: "amber",
  } as const;
});
const homeStatusLabel = computed(() => {
  if (state.snapshot?.connection.bridgeOnline && state.snapshot.connection.state !== "connected") {
    return "Mac linked";
  }
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
  if (state.snapshot?.connection.bridgeOnline && state.snapshot.connection.state !== "connected") {
    return "amber";
  }
  switch (state.snapshot?.connection.state) {
    case "connected":
      return "green";
    case "connecting":
      return "amber";
    default:
      return "slate";
  }
});
const homeStatusDeviceLabel = computed(() => {
  const activeDevice =
    homeBridgeDevices.value.find((device) => isActiveBridgeDevice(device)) ??
    homeBridgeDevices.value.find((device) => device.state === "connected") ??
    null;

  return activeDevice ? bridgeDeviceLabel(activeDevice) : null;
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
const homeBridgeDevices = computed(() => state.snapshot?.bridgeDevices ?? []);
const homeStatusCopy = computed(() => {
  const connection = state.snapshot?.connection;
  if (connection?.bridgeOnline && connection.state !== "connected") {
    return "This Mac is already linked to your account, but the local Codex service is not ready yet. Check the Mac-side Codex app-server, then wait for the bridge to reconnect.";
  }
  switch (connection?.state) {
    case "connected":
      return "Your phone shell is connected. Open a chat, disconnect this trusted session, or use the install command below to add another Mac.";
    case "connecting":
      return "The relay is still rehydrating thread state from the desktop side.";
    case "disconnected":
      return installManifest.value?.command
        ? "Your phone is signed in, but this account does not have an active Mac bridge yet. Run the account-bound install command below in Terminal."
        : "Your phone is signed in. The relay is preparing an account-bound install command for this session.";
    default:
      return "Sign in first, then install the local bridge from the command generated for your account.";
  }
});

function createUiId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `phodex-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isActiveBridgeDevice(device: BridgeDeviceSummary) {
  return state.snapshot?.activeBridgeId === device.id;
}

function canSelectBridgeDevice(device: BridgeDeviceSummary) {
  return device.state === "connected";
}

function bridgeDeviceLabel(device: BridgeDeviceSummary) {
  return device.macLabel?.trim() || "Awaiting first check-in";
}

function bridgeDeviceTone(device: BridgeDeviceSummary) {
  if (device.state === "connected") {
    return "green";
  }
  if (device.bridgeOnline || device.state === "connecting") {
    return "amber";
  }
  return "slate";
}

function bridgeDeviceStateLabel(device: BridgeDeviceSummary) {
  if (device.state === "connected") {
    return isActiveBridgeDevice(device) ? "Active" : "Connected";
  }
  if (device.bridgeOnline || device.state === "connecting") {
    return "Linking";
  }
  return "Saved";
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
    return "Uses the relay default project root on your Mac.";
  }
  return hasWorktree ? `Project root ${pathTail(cwd, 2)} with worktree support` : `Project root ${pathTail(cwd, 2)}`;
}

function readAppErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

function formatThreadLocation(thread: ThreadRecord) {
  return thread.isWorktree ? `Worktree · ${pathTail(thread.repoLabel, 3)}` : `Project · ${pathTail(thread.repoLabel, 2)}`;
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
    return {
      phase: "syncing" as const,
      label: null,
    };
  }
  return null;
});
const showConversationContent = computed(
  () =>
    Boolean(
      currentThread.value &&
        (currentThread.value.messages.length ||
          currentThread.value.history?.totalMessages ||
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
      return dialogState.value.mode === "worktree" ? "Start a worktree chat" : "Start a local chat";
    case "project-browser":
      return "Project Files";
    case "project-diff":
      return "Code Changes";
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
    case "create-thread":
      return dialogState.value.mode === "worktree"
        ? "Pick an existing project or enter a git-backed path. Phodex creates a fresh worktree before the chat starts."
        : "Pick an existing project or enter a new path for the next local chat on your Mac.";
    case "project-browser":
      return `Browse ${dialogState.value.title} and lazily preview a file when you tap it.`;
    case "project-diff":
      return dialogState.value.filterPath
        ? `Inspect the diff focused on ${dialogState.value.filterPath}.`
        : `Inspect the working-tree diff for ${dialogState.value.title}.`;
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
    case "create-thread":
      if (dialogState.value.useCustomCwd && dialogState.value.mode === "local") {
        return "Create Folder & Start Chat";
      }
      return dialogState.value.mode === "worktree" ? "Create Worktree" : "Start Chat";
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
const dialogConfirmDisabled = computed(() => {
  if (!dialogState.value) {
    return false;
  }
  if (dialogState.value.kind === "rename-thread") {
    return !dialogInput.value.trim();
  }
  if (dialogState.value.kind === "create-thread") {
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
    autoScrollMode.value = "followBottom";
    isScrolledToBottom.value = true;

    if (!nextThreadId) {
      return;
    }

    await nextTick();
    scrollConversationToBottom();
  },
  { flush: "post" }
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
      if (autoScrollMode.value === "followBottom") {
        // Keep the CTA hidden while runtime chrome or message growth is auto-followed.
        isScrolledToBottom.value = true;
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
  const pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)/g;
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
    } else if (match[2] && match[3]) {
      segments.push(parseMarkdownLinkSegment(match[2], match[3]));
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

function toggleModelPicker() {
  if (isCurrentThreadPendingCreate.value) {
    return;
  }
  closeThreadMenu();
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
  threadMenuOpen.value = !threadMenuOpen.value;
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
  closeModelPicker();
  closeThreadMenu();
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeModelPicker();
    closeThreadMenu();
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
  closeModelPicker();
  closeThreadMenu();
  state.ui.sidebarOpen = true;
}

function closeSidebar() {
  closeModelPicker();
  closeThreadMenu();
  state.ui.sidebarOpen = false;
}

function isDrawerGroupExpanded(label: string) {
  if (state.ui.search.trim()) {
    return true;
  }
  return expandedDrawerGroups.value.includes(label);
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
    void client
      .createThreadAndSend("Phodex Web", "local")
      .then((threadId) => {
        navigateToThread(threadId);
      })
      .catch(() => {});
    return;
  }
  client.sendComposer(currentThread.value.id);
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
  openCreateThreadDialog("local", currentThread.value?.projectLabel, currentThread.value?.repoLabel ?? null);
}

function startToolbarLocalChat() {
  if (!currentThread.value || isCurrentThreadPendingCreate.value) {
    return;
  }
  closeModelPicker();
  void client
    .createThread(currentThread.value.projectLabel, "local", currentThread.value.repoLabel || undefined)
    .then((threadId) => {
      navigateToThread(threadId);
    })
    .catch(() => {});
}

function startWorktreeChat() {
  openCreateThreadDialog("worktree", currentThread.value?.projectLabel, currentThread.value?.repoLabel ?? null);
}

function openPanel(panel: ShellPageState, replace = false) {
  closeModelPicker();
  closeThreadMenu();
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

function navigateToThread(threadId: string) {
  const machineId = currentRouteMachineId();
  if (!machineId) {
    client.logFlowTrace("route.thread.manual-missing-machine", {
      threadId,
    });
    client.selectThread(threadId);
    return;
  }

  client.logFlowTrace("route.thread.manual", {
    threadId,
    machineId,
  });
  void router.push({
    name: "thread",
    params: { machineId, threadId },
    query: preservedRouteQuery(),
  });
}

function navigateHome() {
  client.logFlowTrace("route.home.manual");
  void router.push({
    name: "home",
    query: preservedRouteQuery(),
  });
}

function closePanel() {
  closeModelPicker();
  closeThreadMenu();
  if (shellPageStack.value.length > 1) {
    shellPageStack.value = shellPageStack.value.slice(0, -1);
    return;
  }

  shellPageStack.value = [];
}

function closeDialog() {
  closeModelPicker();
  closeThreadMenu();
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
    const nextSelection = createThreadSelection.value;
    if (!nextSelection?.cwd && nextSelection?.isCustom) {
      return;
    }
    void client
      .createThread(
        nextSelection?.projectLabel ?? dialogState.value.projectLabel,
        dialogState.value.mode,
        nextSelection?.cwd ?? dialogState.value.cwd ?? undefined
      )
      .then((threadId) => {
        navigateToThread(threadId);
      })
      .catch(() => {});
    closeDialog();
    closeSidebar();
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

function refreshInstallCommand() {
  void loadInstallManifest();
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

function currentRouteMachineId() {
  if (route.name === "thread") {
    const routeMachineId = normalizedRouteParam(route.params.machineId);
    if (routeMachineId) {
      return routeMachineId;
    }
  }
  return state.snapshot?.activeBridgeId ?? null;
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

function handleConversationScroll() {
  const scrollEl = conversationScrollEl.value;
  if (!scrollEl) {
    return;
  }
  const nextTop = scrollEl.scrollTop;
  const movingUp = nextTop + 1 < lastConversationScrollTop;
  lastConversationScrollTop = nextTop;
  const pinnedToBottom = isConversationPinnedToBottom();
  isScrolledToBottom.value = pinnedToBottom;
  if (pinnedToBottom) {
    autoScrollMode.value = "followBottom";
    return;
  }
  if (autoScrollMode.value === "followBottom" && movingUp && window.performance.now() >= ignoreManualAutoScrollUntil) {
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
                          <span class="archived-empty__icon"><AppIcon name="archive" /></span>
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
                      <button class="icon-button icon-button--tiny drawer-dismiss" aria-label="Close menu" @click="closeSidebar">
                        <AppIcon name="close" />
                      </button>

                      <div class="phone-drawer__toolbar">
                        <div class="phone-drawer__toolbar-copy">
                          <span class="section-label">Conversations</span>
                          <span>{{ liveThreadCount }} chats</span>
                        </div>

                        <input
                          v-model="state.ui.search"
                          class="drawer-search"
                          type="search"
                          placeholder="Search conversations"
                        />

                        <div class="drawer-toolbar-actions">
                          <button class="drawer-new-chat" @click="startLocalChat">
                            <span class="drawer-new-chat__icon">
                              <AppIcon name="plus" />
                            </span>
                            <span>New Chat</span>
                          </button>
                          <button class="drawer-toolbar-pill" @click="startWorktreeChat">
                            <AppIcon name="worktree" />
                            <span>Worktree</span>
                          </button>
                          <button
                            v-if="currentThread"
                            class="drawer-toolbar-pill"
                            @click="navigateHome()"
                          >
                            <AppIcon name="home" />
                            <span>Home</span>
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
                            <button
                              v-for="thread in group.threads"
                              :key="thread.id"
                              class="drawer-thread"
                              :class="{
                                'drawer-thread--selected': currentThread?.id === thread.id,
                                'drawer-thread--archived': thread.state === 'archived',
                              }"
                              @click="
                                navigateToThread(thread.id);
                                closeSidebar();
                              "
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
                                  <span>{{ formatRelativeTime(thread.lastActivityAt) }}</span>
                                </div>
                                <p v-if="currentThread?.id === thread.id" class="drawer-thread__preview">{{ thread.preview }}</p>
                                <div class="drawer-thread__meta">
                                  <span>{{ formatThreadLocation(thread) }}</span>
                                  <span v-if="thread.queuedDrafts.length">{{ thread.queuedDrafts.length }} queued</span>
                                  <span v-if="thread.unreadCount">{{ thread.unreadCount }} unread</span>
                                </div>
                              </div>

                              <div class="drawer-thread__actions">
                                <button
                                  class="icon-button icon-button--tiny"
                                  aria-label="Rename chat"
                                  @click.stop="handleRenameThread(thread.id, thread.title)"
                                >
                                  <AppIcon name="edit" />
                                </button>
                                <button
                                  class="icon-button icon-button--tiny"
                                  :aria-label="thread.state === 'archived' ? 'Restore chat' : 'Archive chat'"
                                  @click.stop="client.toggleArchiveThread(thread)"
                                >
                                  <AppIcon :name="thread.state === 'archived' ? 'restore' : 'archive'" />
                                </button>
                              </div>
                            </button>
                          </div>
                        </section>
                      </div>

                      <div class="phone-drawer__foot">
                        <div class="phone-drawer__footer-card">
                          <span class="drawer-status__label">
                            {{
                              state.snapshot?.connection.state === "connected"
                                ? "Connected to Mac"
                                : state.snapshot?.connection.bridgeOnline
                                  ? "Linked Mac"
                                  : "Trusted Mac"
                            }}
                          </span>
                          <div class="drawer-status">
                            <strong>{{ state.snapshot?.connection.macLabel }}</strong>
                            <span class="drawer-status__meta">
                              {{ state.snapshot?.connection.relayLabel }}
                              <template v-if="state.snapshot?.connection.state === 'connected'">
                                · {{ state.snapshot?.connection.latencyMs }}ms
                              </template>
                            </span>
                          </div>
                        </div>

                        <div class="drawer-footer-actions">
                          <button class="drawer-footer-pill drawer-footer-pill--primary" @click="openPanel('settings')">
                            Settings
                          </button>
                          <button class="drawer-footer-pill" @click="openPanel('archived')">Archived</button>
                          <button class="drawer-footer-pill" @click="openPanel('about')">About</button>
                          <button class="drawer-footer-pill drawer-footer-pill--danger" @click="client.logout()">Disconnect</button>
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
                        <span class="phone-topbar__workspace">{{ currentThreadWorkspaceLabel }}</span>
                        <strong class="phone-topbar-status__label" :class="`phone-topbar-status__label--${composerRuntimeState.tone}`">
                          {{ composerRuntimeState.label }}
                        </strong>
                      </span>
                    </div>

                    <button
                      v-if="!currentThread"
                      class="icon-button phone-topbar__action"
                      aria-label="Settings"
                      @click="openPanel('settings')"
                    >
                      <AppIcon name="settings" />
                    </button>
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
                  >
                    <div ref="conversationInnerEl" class="phone-conversation__inner">
                      <template v-if="currentThread && showConversationContent">
                        <div v-if="currentThread.history?.totalMessages && !currentThread.messages.length" class="conversation-history-status">
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
                                  <a v-else class="phone-inline-link" :href="segment.href" target="_blank" rel="noreferrer">
                                    {{ segment.label }}
                                  </a>
                                </template>
                              </p>
                              <span v-if="message.isStreaming" class="stream-cursor"></span>
                            </div>

                            <pre v-if="message.codeBlock" class="phone-message__code"><code>{{ message.codeBlock.content }}</code></pre>

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
                        <div class="home-empty-state__tabs">
                          <span class="home-empty-state__tab home-empty-state__tab--active">Home</span>
                          <span :class="`home-empty-state__tab home-empty-state__tab--${homeStatusTone}`">
                            {{ homeStatusLabel }}
                          </span>
                        </div>
                        <img :src="remodexAppLogo" alt="" class="home-empty-state__logo" />
                        <div class="home-status-badge">
                          <strong :class="`home-status-badge__label home-status-badge__label--${homeStatusTone}`">
                            {{ homeStatusLabel }}
                          </strong>
                          <span v-if="homeStatusDeviceLabel" class="home-status-badge__detail">
                            On {{ homeStatusDeviceLabel }}
                          </span>
                        </div>
                        <div v-if="homeBridgeDevices.length" class="home-empty-state__device-list">
                          <span class="section-label">{{ homeBridgeDevices.length > 1 ? "Registered Macs" : "Connected To Mac" }}</span>
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
                                  class="home-empty-state__device-chip"
                                  :class="`home-empty-state__device-chip--${bridgeDeviceTone(device)}`"
                                >
                                  {{ bridgeDeviceStateLabel(device) }}
                                </span>
                              </div>
                            </article>
                          </div>
                        </div>
                        <p class="home-empty-state__copy">{{ homeStatusCopy }}</p>
                        <div v-if="showBridgeInstallCard" class="home-empty-state__install-card home-empty-state__install-card--command">
                          <div class="home-empty-state__install-header">
                            <div class="home-empty-state__install-heading">
                              <span class="section-label">Bridge Install</span>
                              <strong>{{ bridgeInstallTitle }}</strong>
                              <p>{{ bridgeInstallCopy }}</p>
                            </div>
                            <div class="home-empty-state__install-actions">
                              <button
                                class="ghost-cta ghost-cta--compact"
                                type="button"
                                :disabled="installManifestLoading"
                                @click="refreshInstallCommand"
                              >
                                {{ bridgeInstallRefreshLabel }}
                              </button>
                              <button
                                class="ghost-cta ghost-cta--compact home-empty-state__install-copy"
                                :class="{
                                  'home-empty-state__install-copy--copied': installCommandCopyState === 'copied',
                                  'home-empty-state__install-copy--failed': installCommandCopyState === 'failed',
                                }"
                                type="button"
                                :disabled="!installManifest?.command"
                                @click="copyInstallCommand"
                              >
                                {{ bridgeInstallCopyLabel }}
                              </button>
                            </div>
                          </div>
                          <div class="home-empty-state__install-code-shell">
                            <div class="home-empty-state__install-code-top">
                              <div class="home-empty-state__install-code-heading">
                                <span class="section-label">{{ bridgeInstallShellLabel }}</span>
                                <span class="home-empty-state__install-code-hint">{{ bridgeInstallRunHint }}</span>
                              </div>
                              <div class="home-empty-state__install-platforms" role="tablist" aria-label="Install command platform">
                                <button
                                  class="home-empty-state__install-platform"
                                  :class="{ 'home-empty-state__install-platform--active': installCommandPlatform === 'shell' }"
                                  type="button"
                                  role="tab"
                                  :aria-selected="installCommandPlatform === 'shell'"
                                  @click="installCommandPlatform = 'shell'"
                                >
                                  Mac / Linux
                                </button>
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
                              </div>
                            </div>
                            <pre
                              class="home-empty-state__install-code"
                              :class="{ 'home-empty-state__install-code--pending': !bridgeInstallCommand.trim() }"
                            ><code>{{ bridgeInstallCommand }}</code></pre>
                          </div>
                          <div class="home-empty-state__install-meta">
                            <span>Short-lived secure command</span>
                            <span>{{ installCommandPlatform === "powershell" ? "Paste it into PowerShell on the machine you want to connect" : "Paste it into the machine terminal you want to connect" }}</span>
                            <span v-if="state.snapshot?.connection.bridgeOnline">Current device stays signed in</span>
                          </div>
                        </div>
                        <div v-if="showBridgeLinkedWarning" class="home-empty-state__install-card home-empty-state__install-card--warning">
                          <span class="section-label">Mac Linked</span>
                          <strong>{{ state.snapshot?.connection.macLabel }}</strong>
                          <p>
                            The bridge is already bound to this account. This screen stays offline because the local Codex
                            app-server has not finished initializing on your Mac yet.
                          </p>
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
                        <p>The relay is creating a fresh thread on your Mac.</p>
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
                                      ? 'Queue draft'
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

              <transition name="scrim">
                <div v-if="dialogState" class="app-dialog-scrim" @click.self="closeDialog">
                  <div
                    class="app-dialog-card"
                    :class="{
                      'app-dialog-card--create-thread': dialogState.kind === 'create-thread',
                      'app-dialog-card--inspector': dialogState.kind === 'project-browser' || dialogState.kind === 'project-diff',
                    }"
                  >
                    <div class="app-dialog-card__head">
                      <span class="section-label">
                        {{
                          dialogState.kind === "rename-thread"
                            ? "Rename"
                            : dialogState.kind === "create-thread"
                              ? "Create"
                              : dialogState.kind === "project-browser"
                                ? "Project"
                                : dialogState.kind === "project-diff"
                                  ? "Diff"
                                  : "Confirm"
                        }}
                      </span>
                      <h3>{{ dialogTitle }}</h3>
                      <p>{{ dialogBody }}</p>
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
                              <AppIcon name="folder" />
                              <div>
                                <strong>Local Chat</strong>
                                <span>Starts at the project root</span>
                              </div>
                            </button>
                            <button
                              class="thread-create-sheet__mode"
                              :class="{ 'thread-create-sheet__mode--active': dialogState.mode === 'worktree' }"
                              @click="setCreateThreadMode('worktree')"
                            >
                              <AppIcon name="worktree" />
                              <div>
                                <strong>Worktree Chat</strong>
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
                                  <strong>New Project Path</strong>
                                  <span v-if="dialogState.useCustomCwd" class="thread-create-sheet__target-tag">Custom</span>
                                </div>
                                <p>Paste a full path or type a folder name.</p>
                                <span>Folder names default to {{ PROJECTS_ROOT_HINT }}</span>
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
                              <span class="section-label">Existing Projects</span>
                              <span>{{ drawerProjectTargets.length }} options</span>
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
                                  <p>{{ target.detail }}</p>
                                  <span>{{ target.liveCount }} live {{ target.liveCount === 1 ? "chat" : "chats" }}</span>
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
                              <div v-else class="project-preview__empty">Binary previews stay lazy. Open this file on your Mac for the full view.</div>
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
                        <button class="primary-cta primary-cta--compact" :disabled="dialogConfirmDisabled" @click="confirmDialogAction">
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
