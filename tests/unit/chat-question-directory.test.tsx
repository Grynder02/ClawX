import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatToolbar } from '@/pages/Chat/ChatToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      if (key === 'toolbar.currentAgent') return `Talking to ${String(options?.agent ?? '')}`;
      return typeof options?.defaultValue === 'string' ? options.defaultValue : key;
    },
  }),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { refresh: () => void; loading: boolean; currentAgentId: string }) => unknown) => selector({
    refresh: vi.fn(),
    loading: false,
    currentAgentId: 'main',
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: { agents: Array<{ id: string; name: string; workspace: string }> }) => unknown) => selector({
    agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
  }),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: { open: boolean; tab: string; openBrowser: () => void; close: () => void }) => unknown) => selector({
    open: false,
    tab: 'changes',
    openBrowser: vi.fn(),
    close: vi.fn(),
  }),
}));

describe('Chat question directory toggle', () => {
  it('enables the toolbar toggle when more than one question is available', () => {
    const onToggle = vi.fn();

    render(
      <TooltipProvider>
        <ChatToolbar questionDirectoryCount={2} onToggleQuestionDirectory={onToggle} />
      </TooltipProvider>,
    );

    const toggle = screen.getByTestId('chat-question-directory-toggle');
    expect(toggle).not.toBeDisabled();

    fireEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('disables the toolbar toggle when the directory is unavailable', () => {
    render(
      <TooltipProvider>
        <ChatToolbar questionDirectoryCount={1} onToggleQuestionDirectory={vi.fn()} />
      </TooltipProvider>,
    );

    expect(screen.getByTestId('chat-question-directory-toggle')).toBeDisabled();
  });
});
