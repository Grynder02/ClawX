import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

const { acpState, agentsState, chatState, gatewayState } = vi.hoisted(() => ({
  acpState: {
    timeline: null as AcpTimelineSnapshot | null,
    loading: false,
    sending: false,
    cancelling: false,
    error: null as string | null,
    activeSessionKey: 'agent:main:main' as string | null,
    loadSession: vi.fn().mockResolvedValue(true),
    sendPrompt: vi.fn(),
    cancel: vi.fn(),
    respondPermission: vi.fn(),
    clearError: vi.fn(),
  },
  agentsState: {
    agents: [{ id: 'main', name: 'main', workspace: '/workspace', mainSessionKey: 'agent:main:main' }],
    loading: false,
    error: null as string | null,
    fetchAgents: vi.fn().mockResolvedValue(undefined),
  },
  chatState: {
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    sessions: [{ key: 'agent:main:main' }],
    loadSessions: vi.fn().mockResolvedValue(undefined),
    selectAcpSession: vi.fn(),
  },
  gatewayState: { status: { state: 'running', gatewayReady: true, port: 18789 } },
}));

vi.mock('@/stores/acp-chat-session', () => ({
  ensureAcpChatSubscriptions: vi.fn(),
  useAcpChatSessionStore: (selector: (state: typeof acpState) => unknown) => selector(acpState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: vi.fn(() => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    scrollToBottom: vi.fn(),
    isAtBottom: true,
  })),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({ ChatToolbar: () => null }));
vi.mock('@/pages/Chat/ChatInput', () => ({ ChatInput: () => null }));

function timelineWithAssistantReply(): AcpTimelineSnapshot {
  return {
    sessionId: 'agent:main:main',
    loadGeneration: 1,
    itemOrder: ['msg-user:0', 'msg-assistant:0'],
    itemsById: {
      'msg-user:0': {
        kind: 'message-segment',
        id: 'msg-user:0',
        role: 'user',
        messageId: 'u1',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: '你好' }],
      },
      'msg-assistant:0': {
        kind: 'message-segment',
        id: 'msg-assistant:0',
        role: 'assistant',
        messageId: 'a1',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: '你好，我在。' }],
      },
    },
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
  };
}

describe('Chat history reply while sending', () => {
  beforeEach(() => {
    acpState.timeline = timelineWithAssistantReply();
    acpState.loading = false;
    acpState.sending = true;
    acpState.cancelling = false;
    acpState.error = null;
    acpState.loadSession.mockClear();
  });

  it('shows assistant reply from ACP history even when sending is still true', async () => {
    const { Chat } = await import('@/pages/Chat');
    render(<Chat />);

    expect(screen.getByText('你好，我在。')).toBeTruthy();
    expect(screen.queryByText('Thinking')).toBeNull();
  });
});
