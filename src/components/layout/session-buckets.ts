import type { ChatSession } from '@/stores/chat';
import {
  DEFAULT_WORKSPACE_CWD,
  getSessionWorkspaceForGrouping,
  getWorkspaceDisplayLabel,
  isDefaultWorkspacePath,
} from '@/lib/workspace-context';

const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionBucketKey =
  | 'today'
  | 'withinWeek'
  | 'withinMonth'
  | 'older';

const SESSION_BUCKET_KEYS: SessionBucketKey[] = ['today', 'withinWeek', 'withinMonth', 'older'];

export type SessionBucket<TSession> = {
  key: SessionBucketKey;
  sessions: TSession[];
};

export type WorkspaceSessionGroup<TSession> = {
  workspacePath: string;
  label: string;
  buckets: Array<SessionBucket<TSession>>;
};

export function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfToday - 7 * DAY_MS) return 'withinWeek';
  if (activityMs >= startOfToday - 30 * DAY_MS) return 'withinMonth';
  return 'older';
}

function getSessionCreatedAtMsFromKey(sessionKey: string): number | undefined {
  const match = sessionKey.match(/(?:^|:)session-(\d{11,})(?=$|:)/);
  if (!match) return undefined;

  const createdAtMs = Number(match[1]);
  return Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : undefined;
}

export function getSessionActivityMs(
  session: ChatSession,
  sessionLastActivity: Record<string, number>,
): number {
  const lastActivityMs = sessionLastActivity[session.key];
  if (Number.isFinite(lastActivityMs) && lastActivityMs > 0) return lastActivityMs;

  if (typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) && session.updatedAt > 0) {
    return session.updatedAt;
  }

  return getSessionCreatedAtMsFromKey(session.key) ?? 0;
}

function createSessionBuckets<TSession>(): Array<SessionBucket<TSession>> {
  return SESSION_BUCKET_KEYS.map((key) => ({ key, sessions: [] }));
}

function getCanonicalWorkspacePathForGrouping(
  session: ChatSession,
  globalWorkspace?: string | null,
): string {
  const workspacePath = getSessionWorkspaceForGrouping(session, globalWorkspace);
  return isDefaultWorkspacePath(workspacePath) ? DEFAULT_WORKSPACE_CWD : workspacePath;
}

export function groupSessionsByWorkspace<TSession extends ChatSession>(
  sessions: readonly TSession[],
  sessionLastActivity: Record<string, number>,
  nowMs: number,
  defaultWorkspaceLabel: string,
  globalWorkspace?: string | null,
): Array<WorkspaceSessionGroup<TSession>> {
  const groups: Array<WorkspaceSessionGroup<TSession>> = [];
  const groupByWorkspace = new Map<string, WorkspaceSessionGroup<TSession>>();

  for (const { session, activityMs } of sessions
    .map((session) => ({
      session,
      activityMs: getSessionActivityMs(session, sessionLastActivity),
    }))
    .sort((a, b) => b.activityMs - a.activityMs)) {
    const workspacePath = getCanonicalWorkspacePathForGrouping(session, globalWorkspace);
    let group = groupByWorkspace.get(workspacePath);
    if (!group) {
      group = {
        workspacePath,
        label: getWorkspaceDisplayLabel(workspacePath, defaultWorkspaceLabel),
        buckets: createSessionBuckets<TSession>(),
      };
      groupByWorkspace.set(workspacePath, group);
      groups.push(group);
    }

    const bucket = group.buckets.find((candidate) => candidate.key === getSessionBucket(activityMs, nowMs));
    bucket?.sessions.push(session);
  }

  return groups;
}
