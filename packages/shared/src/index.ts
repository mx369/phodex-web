export type AccessMode = "read-only" | "on-request" | "full-access";
export type ThreadState = "idle" | "running" | "queued" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type MessageKind = "chat" | "plan" | "status";
export type DeliveryMode = "smtp" | "resend" | "local-mailbox" | "backdoor";
export type ThreadCreateMode = "local" | "worktree";

export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface FileChangeSummary {
  action: "Edited" | "Created" | "Deleted" | "Moved";
  path: string;
  additions: number;
  deletions: number;
}

export type CardTone = "amber" | "blue" | "green" | "rose" | "slate";

export interface RunEvent {
  label: string;
  detail: string;
  tone: Exclude<CardTone, "rose">;
  state: "waiting" | "running" | "done";
}

export interface CodeBlock {
  language: string;
  content: string;
}

export interface StatusMessageCard {
  type: "status";
  title: string;
  detail?: string;
  meta?: string;
  tone: CardTone;
}

export interface CommandMessageCard {
  type: "command";
  title: string;
  command?: string;
  statusLabel: string;
  tone: CardTone;
  detail?: string;
  meta?: string;
  output?: string;
}

export interface ToolMessageCard {
  type: "tool";
  title: string;
  toolLabel: string;
  statusLabel: string;
  tone: CardTone;
  detail?: string;
  meta?: string;
  output?: string;
}

export interface ImageMessageCard {
  type: "image";
  title: string;
  path: string;
  detail?: string;
  meta?: string;
  tone: CardTone;
}

export type MessageCard =
  | StatusMessageCard
  | CommandMessageCard
  | ToolMessageCard
  | ImageMessageCard;

export interface ThreadMessage {
  id: string;
  role: MessageRole;
  kind: MessageKind;
  text: string;
  createdAt: string;
  isStreaming?: boolean;
  codeBlock?: CodeBlock;
  fileChanges?: FileChangeSummary[];
  runEvents?: RunEvent[];
  cards?: MessageCard[];
  emphasis?: string;
}

export interface QueuedDraft {
  id: string;
  text: string;
  createdAt: string;
  model?: string;
  planArmed?: boolean;
  fastMode?: boolean;
  accessMode?: AccessMode;
}

export interface ThreadRecord {
  id: string;
  title: string;
  preview: string;
  projectLabel: string;
  repoLabel: string;
  branch: string;
  state: ThreadState;
  lastActivityAt: string;
  unreadCount: number;
  subagentCount: number;
  isWorktree: boolean;
  isForked: boolean;
  diff: DiffStats;
  queuedDrafts: QueuedDraft[];
  messages: ThreadMessage[];
}

export interface AppSettings {
  fontStyle: "system" | "mono";
  glassMode: boolean;
  notifications: boolean;
  reducedMotion: boolean;
  compactSidebar: boolean;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
}

export interface RelayConnection {
  state: "connecting" | "connected" | "disconnected";
  relayLabel: string;
  macLabel: string;
  latencyMs: number;
  lastSyncAt: string | null;
}

export interface CompletionBanner {
  id: string;
  threadId: string;
  title: string;
  subtitle: string;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: UserSummary;
}

export interface AppSnapshot {
  user: UserSummary;
  selectedThreadId: string | null;
  threads: ThreadRecord[];
  settings: AppSettings;
  connection: RelayConnection;
  banner: CompletionBanner | null;
  devAuthBypassEnabled: boolean;
  staticBackdoorCode: string | null;
}

export interface RequestCodeResponse {
  ok: true;
  delivery: DeliveryMode;
  devAuthBypassEnabled: boolean;
  staticBackdoorCode: string | null;
  expiresInMs: number;
}

export interface VerifyCodeResponse {
  ok: true;
  session: AuthSession;
  snapshot: AppSnapshot;
}

export interface DevCodeResponse {
  ok: true;
  email: string;
  code: string | null;
  staticBackdoorCode: string | null;
}

export type ClientEvent =
  | { type: "bootstrap" }
  | { type: "thread:create"; projectLabel?: string; cwd?: string; mode?: ThreadCreateMode }
  | { type: "thread:select"; threadId: string }
  | { type: "thread:clearSelection" }
  | { type: "thread:rename"; threadId: string; title: string }
  | { type: "thread:delete"; threadId: string }
  | { type: "thread:archive"; threadId: string }
  | {
      type: "message:send";
      threadId: string;
      text: string;
      model: string;
      planArmed: boolean;
      fastMode: boolean;
      accessMode: AccessMode;
    }
  | { type: "draft:resume"; threadId: string; draftId: string }
  | { type: "draft:remove"; threadId: string; draftId: string }
  | { type: "run:stop"; threadId: string }
  | { type: "settings:update"; patch: Partial<AppSettings> };

export type ServerEvent =
  | { type: "snapshot"; snapshot: AppSnapshot }
  | { type: "thread:updated"; thread: ThreadRecord; selectedThreadId: string | null }
  | { type: "message:appended"; threadId: string; message: ThreadMessage }
  | { type: "message:delta"; threadId: string; messageId: string; delta: string }
  | { type: "message:finished"; threadId: string; messageId: string }
  | { type: "banner"; banner: CompletionBanner | null }
  | { type: "presence"; connection: RelayConnection }
  | { type: "toast"; tone: "info" | "success" | "error"; message: string };

export const ACCESS_MODE_LABELS: Record<AccessMode, string> = {
  "read-only": "Read only",
  "on-request": "On request",
  "full-access": "Full access",
};

export const MODELS = ["GPT-5.4", "GPT-5.4 mini", "o4-mini"] as const;
