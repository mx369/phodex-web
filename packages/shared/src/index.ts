export type AccessMode = "read-only" | "on-request" | "full-access";
export type ThreadState = "idle" | "running" | "queued" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type MessageKind = "chat" | "plan" | "status";
export type DeliveryMode = "smtp" | "resend";
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

export type ProjectEntryKind = "file" | "directory";
export type ProjectFileKind = "text" | "binary";
export type ProjectFileEncoding = "utf-8" | "none";

export interface ProjectTreeEntry {
  name: string;
  path: string;
  kind: ProjectEntryKind;
  size: number;
  modifiedAt: string;
}

export interface ProjectTreePayload {
  kind: "tree";
  root: string;
  path: string;
  entries: ProjectTreeEntry[];
}

export interface ProjectFilePayload {
  kind: "file";
  root: string;
  path: string;
  fileKind: ProjectFileKind;
  encoding: ProjectFileEncoding;
  content?: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  truncated?: boolean;
}

export interface ProjectDiffFile extends FileChangeSummary {
  patch: string;
}

export interface ProjectDiffPayload {
  kind: "diff";
  root: string;
  path: string | null;
  summary: DiffStats;
  files: ProjectDiffFile[];
}

export type ProjectResourcePayload = ProjectTreePayload | ProjectFilePayload | ProjectDiffPayload;

export type BridgeProjectRequest =
  | { kind: "tree"; threadId: string; path: string }
  | { kind: "file"; threadId: string; path: string }
  | { kind: "diff"; threadId: string; path: string | null };

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

export interface InputImageAttachment {
  imageUrl?: string;
  fileId?: string;
  name?: string;
  mimeType?: string;
  detail?: "auto" | "low" | "high";
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
  imageUrl?: string;
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
  inputImages?: InputImageAttachment[];
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
  images?: InputImageAttachment[];
  model?: string;
  planArmed?: boolean;
  fastMode?: boolean;
  accessMode?: AccessMode;
}

export interface ThreadHistoryState {
  totalMessages: number;
  loadedMessages: number;
  remainingMessages: number;
  hasMoreBefore: boolean;
  isHydrating: boolean;
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
  history?: ThreadHistoryState | null;
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
  bridgeOnline: boolean;
  state: "connecting" | "connected" | "disconnected";
  relayLabel: string;
  macLabel: string;
  latencyMs: number;
  lastSyncAt: string | null;
}

export interface BridgeDeviceSummary {
  id: string;
  macLabel: string;
  bridgeOnline: boolean;
  state: RelayConnection["state"];
  lastConnectedAt: string | null;
  issuedAt: string | null;
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
  activeBridgeId: string | null;
  bridgeDevices: BridgeDeviceSummary[];
  banner: CompletionBanner | null;
}

export interface RequestCodeResponse {
  ok: true;
  delivery: DeliveryMode;
  expiresInMs: number;
}

export interface VerifyCodeResponse {
  ok: true;
  session: AuthSession;
  snapshot: AppSnapshot;
}

export type ClientEvent =
  | { type: "bootstrap" }
  | { type: "bridge:select"; bridgeId: string }
  | { type: "thread:create"; requestId: string; projectLabel?: string; cwd?: string; mode?: ThreadCreateMode }
  | { type: "thread:select"; threadId: string }
  | { type: "thread:history:load"; threadId: string; loadedMessages: number }
  | { type: "thread:clearSelection" }
  | { type: "thread:rename"; threadId: string; title: string }
  | { type: "thread:delete"; threadId: string }
  | { type: "thread:archive"; threadId: string }
  | {
      type: "message:send";
      threadId: string;
      text: string;
      images?: InputImageAttachment[];
      model: string;
      planArmed: boolean;
      fastMode: boolean;
      accessMode: AccessMode;
    }
  | { type: "draft:resume"; threadId: string; draftId: string }
  | { type: "draft:remove"; threadId: string; draftId: string }
  | { type: "run:stop"; threadId: string }
  | { type: "settings:update"; patch: Partial<AppSettings> };

export type BridgeDispatchEvent = Extract<
  ClientEvent,
  | { type: "thread:create" }
  | { type: "thread:select" }
  | { type: "thread:rename" }
  | { type: "thread:archive" }
  | { type: "message:send" }
  | { type: "draft:resume" }
  | { type: "draft:remove" }
  | { type: "run:stop" }
>;

export type BridgeCommand =
  | { type: "bridge:sync-all" }
  | { type: "bridge:sync-thread"; threadId: string }
  | {
      type: "bridge:project:request";
      requestId: string;
      userId: string;
      request: BridgeProjectRequest;
    }
  | {
      type: "bridge:dispatch";
      requestId: string;
      userId: string;
      selectedThreadId: string | null;
      event: BridgeDispatchEvent;
    };

export type BridgeEvent =
  | { type: "bridge:state"; threads: ThreadRecord[]; connection: RelayConnection }
  | { type: "bridge:thread:updated"; thread: ThreadRecord }
  | {
      type: "bridge:project:response";
      requestId: string;
      userId: string;
      ok: true;
      result: ProjectResourcePayload;
    }
  | {
      type: "bridge:project:response";
      requestId: string;
      userId: string;
      ok: false;
      error: string;
      status: number;
    }
  | { type: "bridge:message:appended"; threadId: string; message: ThreadMessage }
  | { type: "bridge:message:delta"; threadId: string; messageId: string; delta: string }
  | { type: "bridge:message:finished"; threadId: string; messageId: string }
  | { type: "bridge:presence"; connection: RelayConnection }
  | { type: "bridge:banner"; banner: CompletionBanner | null }
  | {
      type: "bridge:user-patch";
      userId: string;
      selectedThreadId?: string | null;
      banner?: CompletionBanner | null;
    }
  | { type: "bridge:toast"; tone: "info" | "success" | "error"; message: string; userId?: string };

export type ServerEvent =
  | { type: "snapshot"; snapshot: AppSnapshot }
  | { type: "thread:created"; requestId: string; threadId: string }
  | { type: "thread:create-failed"; requestId: string; message: string }
  | { type: "thread:updated"; thread: ThreadRecord; selectedThreadId: string | null }
  | { type: "message:appended"; threadId: string; message: ThreadMessage }
  | { type: "message:delta"; threadId: string; messageId: string; delta: string }
  | { type: "message:finished"; threadId: string; messageId: string }
  | { type: "banner"; banner: CompletionBanner | null }
  | { type: "presence"; connection: RelayConnection; activeBridgeId: string | null; bridgeDevices: BridgeDeviceSummary[] }
  | { type: "toast"; tone: "info" | "success" | "error"; message: string };

export const ACCESS_MODE_LABELS: Record<AccessMode, string> = {
  "read-only": "Read only",
  "on-request": "On request",
  "full-access": "Full access",
};

export const MODELS = ["GPT-5.5", "GPT-5.4", "GPT-5.4 mini", "o4-mini"] as const;

function normalizeTraceText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function buildTraceImageSignature(images: InputImageAttachment[] = []) {
  return images
    .map((image) => [image.fileId ?? "", image.name ?? "", image.mimeType ?? "", image.detail ?? "", image.imageUrl ? "url" : ""].join("|"))
    .join("||");
}

function hashTraceValue(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildPromptTraceKey(text: string, images: InputImageAttachment[] = []) {
  return hashTraceValue(`${normalizeTraceText(text)}::${buildTraceImageSignature(images)}`);
}

export function summarizePromptForTrace(text: string, images: InputImageAttachment[] = []) {
  const normalizedText = normalizeTraceText(text);
  const textSummary = normalizedText
    ? normalizedText.length > 72
      ? `${normalizedText.slice(0, 69)}...`
      : normalizedText
    : images.length
      ? "[image-only prompt]"
      : "[empty prompt]";

  if (!images.length) {
    return textSummary;
  }

  const imageLabel = images.length === 1 ? "1 image" : `${images.length} images`;
  return normalizedText ? `${textSummary} [+${imageLabel}]` : imageLabel;
}
