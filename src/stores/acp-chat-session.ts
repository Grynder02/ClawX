import { create } from 'zustand';
import type {
  AcpChatLoadPayload,
  AcpChatOperationResult,
  AcpChatPromptPayload,
  AcpChatRespondPermissionPayload,
  AcpPermissionRequestEnvelope,
  AcpSessionUpdateEnvelope,
} from '@shared/acp-chat/types';
import type { MediaThumbnailEntry, MediaThumbnailResult } from '@shared/host-api/contract';
import i18n from '@/i18n';
import {
  extractImageGenerationCompletionFromGatewayChatMessage,
  extractImageGenerationCompletionFromRuntimeEvent,
  extractImageGenerationStartFromAcpEnvelope,
  imageGenerationEvidenceKey,
  type ImageGenerationCompletionEvidence,
  type ImageGenerationMediaCandidate,
} from '@/lib/acp/image-generation-compat';
import { appendSyntheticAssistantMessage, applyAcpSessionUpdate, createEmptyAcpTimeline } from '@/lib/acp/reducer';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import type { AcpTimelineSnapshot, MessageSegmentItem, PermissionItem, RenderPart } from '@/lib/acp/timeline-types';

const EMPTY_SESSION_ID = '';
const CANCEL_PERMISSION_OPTION_ID = '__cancelled__';
const IMAGE_GENERATION_COMPAT_WINDOW_MS = 195_000;

type ImageGenerationCompatSession = {
  taskStartedAt: number;
  delivered: Set<string>;
};

const imageGenerationCompatSessions = new Map<string, ImageGenerationCompatSession>();

type PermissionOutcome = AcpChatRespondPermissionPayload['outcome'];

export type AcpChatSessionState = {
  activeSessionKey: string | null;
  cwd: string | null;
  generation: number;
  loading: boolean;
  sending: boolean;
  cancelling: boolean;
  error: string | null;
  timeline: AcpTimelineSnapshot;
  loadSession: (input: AcpChatLoadPayload) => Promise<boolean>;
  sendPrompt: (input: AcpChatPromptPayload) => Promise<boolean>;
  cancel: () => Promise<void>;
  respondPermission: (requestId: string, optionId: string) => Promise<void>;
  applyUpdateEnvelope: (event: AcpSessionUpdateEnvelope) => void;
  applyPermissionRequest: (event: AcpPermissionRequestEnvelope) => void;
  recordImageGenerationStart: (event: AcpSessionUpdateEnvelope) => void;
  projectImageGenerationCompletion: (event: ImageGenerationCompletionEvidence) => Promise<void>;
  clearError: () => void;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function failedOperationMessage(result: AcpChatOperationResult, fallback: string): string {
  return result.error || fallback;
}

function permissionOutcome(optionId: string): PermissionOutcome {
  return optionId === CANCEL_PERMISSION_OPTION_ID
    ? { outcome: 'cancelled' }
    : { outcome: 'selected', optionId };
}

function permissionStatus(outcome: PermissionOutcome): PermissionItem['status'] {
  return outcome.outcome === 'cancelled' ? 'cancelled' : 'selected';
}

function compatSession(sessionKey: string): ImageGenerationCompatSession {
  const existing = imageGenerationCompatSessions.get(sessionKey);
  if (existing) return existing;

  const created: ImageGenerationCompatSession = { taskStartedAt: 0, delivered: new Set<string>() };
  imageGenerationCompatSessions.set(sessionKey, created);
  return created;
}

function resetImageGenerationCompatSession(sessionKey: string): void {
  imageGenerationCompatSessions.delete(sessionKey);
}

function hasFreshImageGenerationContext(sessionKey: string, now = Date.now()): boolean {
  const session = imageGenerationCompatSessions.get(sessionKey);
  if (!session?.taskStartedAt) return false;
  return now - session.taskStartedAt <= IMAGE_GENERATION_COMPAT_WINDOW_MS;
}

function reserveDelivery(sessionKey: string, key: string): boolean {
  const session = compatSession(sessionKey);
  if (session.delivered.has(key)) return false;
  session.delivered.add(key);
  return true;
}

function thumbnailEntry(candidate: ImageGenerationMediaCandidate): MediaThumbnailEntry {
  if (candidate.gatewayUrl) {
    return {
      gatewayUrl: candidate.gatewayUrl,
      ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
    };
  }

  return {
    filePath: candidate.filePath ?? candidate.key,
    ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
  };
}

function messageIdFromEvidence(key: string): string {
  const encoded: string[] = [];
  for (let index = 0; index < key.length; index += 1) {
    encoded.push(key.charCodeAt(index).toString(16).padStart(4, '0'));
  }
  return `compat:image-generation:${encoded.join('')}`;
}

function isCurrentAction(
  state: AcpChatSessionState,
  sessionKey: string,
  generation: number,
): boolean {
  return state.activeSessionKey === sessionKey && state.generation === generation;
}

function getPendingPermission(
  timeline: AcpTimelineSnapshot,
  requestId: string,
): PermissionItem | null {
  const item = timeline.itemsById[`permission:${requestId}`];
  return item?.kind === 'permission' && item.status === 'pending' ? item : null;
}

function updatePermissionStatus(
  timeline: AcpTimelineSnapshot,
  requestId: string,
  status: PermissionItem['status'],
): AcpTimelineSnapshot {
  const id = `permission:${requestId}`;
  const item = timeline.itemsById[id];
  if (item?.kind !== 'permission') return timeline;

  return {
    ...timeline,
    itemsById: {
      ...timeline.itemsById,
      [id]: { ...item, status },
    },
  };
}

function createOptimisticMessageId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `user:${random}`;
}

function optimisticPromptParts(input: AcpChatPromptPayload): RenderPart[] {
  const parts: RenderPart[] = [];
  const text = input.message?.trim();
  if (text) parts.push({ kind: 'markdown', text });

  for (const item of input.media ?? []) {
    parts.push({
      kind: 'file',
      path: item.filePath,
      name: item.fileName,
      mimeType: item.mimeType,
    });
  }

  return parts.length > 0 ? parts : [{ kind: 'markdown', text: '' }];
}

function appendOptimisticUserSegment(
  timeline: AcpTimelineSnapshot,
  input: AcpChatPromptPayload,
  messageId: string,
): AcpTimelineSnapshot {
  const existingId = timeline.itemOrder.find((itemId) => {
    const item = timeline.itemsById[itemId];
    return item?.kind === 'message-segment' && item.role === 'user' && item.messageId === messageId;
  });
  const id = existingId ?? `${messageId}:0`;
  const item: MessageSegmentItem = {
    kind: 'message-segment',
    id,
    role: 'user',
    messageId,
    segmentIndex: 0,
    parts: optimisticPromptParts(input),
    optimistic: true,
  };

  return {
    ...timeline,
    itemOrder: timeline.itemOrder.includes(id) ? timeline.itemOrder : [...timeline.itemOrder, id],
    itemsById: { ...timeline.itemsById, [id]: item },
    openMessageSegments: { ...timeline.openMessageSegments, [messageId]: id },
    segmentCounts: { ...timeline.segmentCounts, [messageId]: Math.max(timeline.segmentCounts[messageId] ?? 0, 1) },
  };
}

function removePendingOptimisticUserSegment(
  timeline: AcpTimelineSnapshot,
  messageId: string,
): AcpTimelineSnapshot {
  const itemId = timeline.openMessageSegments[messageId];
  const item = itemId ? timeline.itemsById[itemId] : undefined;
  if (item?.kind !== 'message-segment' || item.role !== 'user' || !item.optimistic) return timeline;

  const { [itemId]: _removedItem, ...itemsById } = timeline.itemsById;
  const { [messageId]: _removedOpenSegment, ...openMessageSegments } = timeline.openMessageSegments;
  const { [messageId]: _removedSegmentCount, ...segmentCounts } = timeline.segmentCounts;

  return {
    ...timeline,
    itemOrder: timeline.itemOrder.filter((id) => id !== itemId),
    itemsById,
    openMessageSegments,
    segmentCounts,
  };
}

function applyOperationGeneration(
  state: AcpChatSessionState,
  result: AcpChatOperationResult,
): Pick<AcpChatSessionState, 'generation' | 'timeline'> | Record<string, never> {
  if (result.generation == null) return {};
  return {
    generation: result.generation,
    timeline: { ...state.timeline, loadGeneration: result.generation },
  };
}

export const useAcpChatSessionStore = create<AcpChatSessionState>((set, get) => ({
  activeSessionKey: null,
  cwd: null,
  generation: 0,
  loading: false,
  sending: false,
  cancelling: false,
  error: null,
  timeline: createEmptyAcpTimeline(EMPTY_SESSION_ID, 0),

  async loadSession(input) {
    const localGeneration = get().generation + 1;
    resetImageGenerationCompatSession(input.sessionKey);
    set({
      activeSessionKey: input.sessionKey,
      cwd: input.cwd,
      generation: localGeneration,
      loading: true,
      sending: false,
      cancelling: false,
      error: null,
      timeline: createEmptyAcpTimeline(input.sessionKey, localGeneration),
    });

    try {
      const result = await hostApi.chat.loadAcpSession(input);
      const state = get();
      if (state.activeSessionKey !== input.sessionKey || state.generation !== localGeneration) return false;
      if (!result.success) {
        set({
          activeSessionKey: null,
          cwd: null,
          loading: false,
          error: failedOperationMessage(result, 'ACP session load failed'),
        });
        return false;
      }

      const generation = result.generation ?? state.generation;
      set({
        loading: false,
        error: null,
        generation,
        timeline: { ...state.timeline, loadGeneration: generation },
      });
      return true;
    } catch (error) {
      set((state) => (
        state.activeSessionKey === input.sessionKey && state.generation === localGeneration
          ? { activeSessionKey: null, cwd: null, loading: false, error: errorMessage(error, 'ACP session load failed') }
          : {}
      ));
      return false;
    }
  },

  async sendPrompt(input) {
    const startState = get();
    const sessionKey = input.sessionKey;
    const generation = startState.generation;
    if (startState.activeSessionKey !== sessionKey) return false;

    const messageId = input.messageId ?? createOptimisticMessageId();
    const payload = { ...input, messageId };

    set((state) => (
      isCurrentAction(state, sessionKey, generation)
        ? {
          sending: true,
          error: null,
          timeline: appendOptimisticUserSegment(state.timeline, payload, messageId),
        }
        : {}
    ));
    try {
      const result = await hostApi.chat.sendAcpPrompt(payload);
      const state = get();
      if (!isCurrentAction(state, sessionKey, generation)) return false;
      const failedTimeline = result.success
        ? state.timeline
        : removePendingOptimisticUserSegment(state.timeline, messageId);
      set({
        sending: false,
        ...(result.success
          ? applyOperationGeneration(state, result)
          : { error: failedOperationMessage(result, 'ACP prompt failed'), timeline: failedTimeline }),
      });
      return result.success;
    } catch (error) {
      set((state) => (
        isCurrentAction(state, sessionKey, generation)
          ? {
            sending: false,
            error: errorMessage(error, 'ACP prompt failed'),
            timeline: removePendingOptimisticUserSegment(state.timeline, messageId),
          }
          : {}
      ));
      return false;
    }
  },

  async cancel() {
    const startState = get();
    const sessionKey = startState.activeSessionKey;
    const generation = startState.generation;
    if (!sessionKey) return;

    set({ cancelling: true, error: null });
    try {
      const result = await hostApi.chat.cancelAcpSession({ sessionKey });
      set((state) => {
        if (!isCurrentAction(state, sessionKey, generation)) return {};
        return {
          cancelling: false,
          ...(result.success
            ? applyOperationGeneration(state, result)
            : { error: failedOperationMessage(result, 'ACP cancel failed') }),
        };
      });
    } catch (error) {
      set((state) => (
        isCurrentAction(state, sessionKey, generation)
          ? { cancelling: false, error: errorMessage(error, 'ACP cancel failed') }
          : {}
      ));
    }
  },

  async respondPermission(requestId, optionId) {
    const startState = get();
    const sessionKey = startState.activeSessionKey;
    const generation = startState.generation;
    if (!sessionKey) return;
    if (!getPendingPermission(startState.timeline, requestId)) return;

    const outcome = permissionOutcome(optionId);
    try {
      const result = await hostApi.chat.respondAcpPermission({ sessionKey, requestId, outcome });
      set((state) => {
        if (!isCurrentAction(state, sessionKey, generation)) return {};
        if (!result.success) {
          return { error: failedOperationMessage(result, 'ACP permission failed') };
        }
        if (!getPendingPermission(state.timeline, requestId)) return {};
        const timeline = updatePermissionStatus(state.timeline, requestId, permissionStatus(outcome));
        const nextGeneration = result.generation ?? state.generation;
        return {
          error: null,
          generation: nextGeneration,
          timeline: result.generation == null ? timeline : { ...timeline, loadGeneration: nextGeneration },
        };
      });
    } catch (error) {
      set((state) => (
        isCurrentAction(state, sessionKey, generation)
          ? { error: errorMessage(error, 'ACP permission failed') }
          : {}
      ));
    }
  },

  recordImageGenerationStart(event) {
    const state = get();
    if (event.historical) return;
    if (event.sessionKey !== state.activeSessionKey || event.generation !== state.generation) return;

    const start = extractImageGenerationStartFromAcpEnvelope(event);
    if (!start) return;
    compatSession(start.sessionKey).taskStartedAt = Date.now();
  },

  async projectImageGenerationCompletion(evidence) {
    const state = get();
    const sessionKey = evidence.sessionKey ?? state.activeSessionKey;
    if (!sessionKey || sessionKey !== state.activeSessionKey) return;
    if (!hasFreshImageGenerationContext(sessionKey)) return;
    if (evidence.candidates.length === 0) return;

    const generation = state.generation;
    const key = imageGenerationEvidenceKey({ ...evidence, sessionKey });
    if (!reserveDelivery(sessionKey, key)) return;

    let thumbnails: MediaThumbnailResult = {};
    try {
      thumbnails = await hostApi.media.thumbnails({
        paths: evidence.candidates.map(thumbnailEntry),
      });
    } catch {
      thumbnails = {};
    }

    const latest = get();
    if (latest.activeSessionKey !== sessionKey || latest.generation !== generation) return;

    const imageParts: RenderPart[] = [];
    for (const candidate of evidence.candidates) {
      const resolved = thumbnails[candidate.key];
      if (!resolved?.preview) continue;
      imageParts.push({
        kind: 'image',
        source: resolved.preview,
        ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
        alt: i18n.t('chat:acp.image'),
      });
    }

    const missingCount = evidence.candidates.length - imageParts.length;
    const caption = imageParts.length === 0
      ? i18n.t('chat:imageGeneration.previewUnavailable')
      : missingCount > 0
        ? i18n.t('chat:imageGeneration.generatedReadyWithMissing')
        : i18n.t('chat:imageGeneration.generatedReady');
    const parts: RenderPart[] = [{ kind: 'markdown', text: caption }, ...imageParts];

    set((current) => {
      if (current.activeSessionKey !== sessionKey || current.generation !== generation) return {};
      return {
        timeline: appendSyntheticAssistantMessage(current.timeline, {
          messageId: messageIdFromEvidence(key),
          evidenceId: key,
          parts,
        }),
      };
    });
  },

  applyUpdateEnvelope(event) {
    const state = get();
    if (event.sessionKey !== state.activeSessionKey || event.generation !== state.generation) return;
    set({ timeline: applyAcpSessionUpdate(state.timeline, event.notification, { historical: !!event.historical }) });
    get().recordImageGenerationStart(event);
  },

  applyPermissionRequest(event) {
    const state = get();
    if (event.sessionKey !== state.activeSessionKey || event.generation !== state.generation) return;

    const toolCallId = event.request.toolCall?.toolCallId;
    const id = `permission:${event.requestId}`;
    const item: PermissionItem = {
      kind: 'permission',
      id,
      requestId: event.requestId,
      toolCallId,
      title: event.request.toolCall?.title ?? toolCallId ?? 'Permission request',
      options: event.request.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
      status: 'pending',
    };

    set({
      timeline: {
        ...state.timeline,
        itemOrder: state.timeline.itemOrder.includes(id)
          ? state.timeline.itemOrder
          : [...state.timeline.itemOrder, id],
        itemsById: { ...state.timeline.itemsById, [id]: item },
        openMessageSegments: {},
      },
    });
  },

  clearError() {
    set({ error: null });
  },
}));

let acpChatSubscribed = false;

export function ensureAcpChatSubscriptions(): void {
  if (acpChatSubscribed) return;
  acpChatSubscribed = true;
  hostEvents.onAcpSessionUpdate((event) => {
    useAcpChatSessionStore.getState().applyUpdateEnvelope(event);
  });
  hostEvents.onAcpPermissionRequest((event) => {
    useAcpChatSessionStore.getState().applyPermissionRequest(event);
  });
  hostEvents.onGatewayChatMessage((event) => {
    const evidence = extractImageGenerationCompletionFromGatewayChatMessage(event);
    if (evidence) void useAcpChatSessionStore.getState().projectImageGenerationCompletion(evidence);
  });
  hostEvents.onChatRuntimeEvent((event) => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent(event);
    if (evidence) void useAcpChatSessionStore.getState().projectImageGenerationCompletion(evidence);
  });
}
