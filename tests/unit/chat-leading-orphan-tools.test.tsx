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

function timelineWithLeadingTools(): AcpTimelineSnapshot {
  return {
    sessionId: 'agent:main:main',
    loadGeneration: 1,
    itemOrder: ['tool:exec', 'tool:image', 'msg-user:0', 'msg-assistant:0'],
    itemsById: {
      'tool:exec': {
        kind: 'tool-call',
        id: 'tool:exec',
        toolCallId: 'exec',
        title: 'Run command',
        status: 'completed',
        outputParts: [],
        locations: [],
      },
      'tool:image': {
        kind: 'tool-call',
        id: 'tool:image',
        toolCallId: 'image',
        title: 'Generate image',
        status: 'completed',
        outputParts: [],
        locations: [],
      },
      'msg-user:0': {
        kind: 'message-segment',
        id: 'msg-user:0',
        role: 'user',
        messageId: 'user-1',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Continue the task' }],
      },
      'msg-assistant:0': {
        kind: 'message-segment',
        id: 'msg-assistant:0',
        role: 'assistant',
        messageId: 'reply',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Finished.' }],
      },
    },
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
  };
}

describe('Chat leading ACP tool rendering', () => {
  beforeEach(() => {
    acpState.timeline = timelineWithLeadingTools();
    acpState.loading = false;
    acpState.sending = false;
    acpState.cancelling = false;
    acpState.error = null;
  });

  it('renders leading tool rows inline without the legacy execution graph', async () => {
    const { Chat } = await import('@/pages/Chat/index');
    render(<Chat />);

    expect(screen.getByTestId('acp-chat-timeline')).toBeInTheDocument();
    expect(screen.getAllByTestId('acp-tool-call-card')).toHaveLength(2);
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
    expect(screen.getByText('Finished.')).toBeInTheDocument();
  });
});
