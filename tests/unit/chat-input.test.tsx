import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { TooltipProvider } from '@/components/ui/tooltip';

const hostApiFetchMock = vi.hoisted(() => vi.fn());
const hostApiDialogOpenMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const { agentsState, chatState, gatewayState, providersState, artifactPanelMocks } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    updateAgentModel: vi.fn(),
  },
  chatState: {
    currentAgentId: 'main',
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    vendors: [] as Array<Record<string, unknown>>,
    defaultAccountId: null as string | null,
    refreshProviderSnapshot: vi.fn(),
  },
  artifactPanelMocks: {
    openPreview: vi.fn(),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState) => unknown) => selector(providersState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: typeof artifactPanelMocks) => unknown) => selector(artifactPanelMocks),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: hostApiFetchMock,
  hostApi: {
    files: {
      stagePaths: (input: unknown) => hostApiFetchMock('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      stageBuffer: (input: unknown) => hostApiFetchMock('/api/files/stage-buffer', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
    skills: {
      quickAccess: (input: unknown) => hostApiFetchMock('/api/skills/quick-access', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
    dialog: {
      open: hostApiDialogOpenMock,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
  },
}));

const mainAgent = {
  id: 'main',
  name: 'Main',
  isDefault: true,
  modelDisplay: 'MiniMax',
  inheritedModel: true,
  workspace: '~/.openclaw/workspace',
  agentDir: '~/.openclaw/agents/main/agent',
  mainSessionKey: 'agent:main:main',
  channelTypes: [],
};

const researchAgent = {
  id: 'research',
  name: 'Research',
  isDefault: false,
  modelDisplay: 'Claude',
  inheritedModel: false,
  workspace: '~/.openclaw/workspace-research',
  agentDir: '~/.openclaw/agents/research/agent',
  mainSessionKey: 'agent:research:desk',
  channelTypes: [],
};

const createSkill = {
  name: 'create-skill',
  description: 'Create and refine reusable skills.',
  source: 'workspace',
  sourceLabel: 'Workspace',
  manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
  baseDir: '/tmp/workspace/skill/create-skill',
};

const emptyRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function translate(key: string, vars?: Record<string, unknown>): string {
  switch (key) {
    case 'composer.attachFiles':
      return 'Attach files';
    case 'composer.pickSkill':
      return 'Choose skill';
    case 'composer.skillButton':
      return 'Skill';
    case 'composer.inputLabel':
      return 'Message input';
    case 'composer.skillPickerTitle':
      return `Quick skill access for ${String(vars?.agent ?? '')}`;
    case 'composer.skillSearchPlaceholder':
      return 'Search skills';
    case 'composer.skillLoading':
      return 'Loading skills...';
    case 'composer.skillEmpty':
      return 'No matching skills found';
    case 'composer.pickAgent':
      return 'Choose agent';
    case 'composer.clearTarget':
      return 'Clear target agent';
    case 'composer.targetChip':
      return `@${String(vars?.agent ?? '')}`;
    case 'composer.agentPickerTitle':
      return 'Route the next message to another agent';
    case 'composer.agentEmpty':
      return 'No other Agents available';
    case 'composer.prefixMenuAriaLabel':
      return 'Composer suggestions';
    case 'composer.gatewayDisconnectedPlaceholder':
      return 'Gateway not connected...';
    case 'composer.send':
      return 'Send';
    case 'composer.stop':
      return 'Stop';
    case 'composer.gatewayConnected':
      return 'connected';
    case 'composer.gatewayStarting':
      return 'starting';
    case 'composer.gatewayStatus':
      return `gateway ${String(vars?.state ?? '')} | port: ${String(vars?.port ?? '')} ${String(vars?.pid ?? '')}`.trim();
    case 'composer.retryFailedAttachments':
      return 'Retry failed attachments';
    case 'composer.workspacePrefix':
      return String(vars?.workspace ?? '');
    case 'composer.workspacePickerTitle':
      return 'Select workspace folder';
    case 'composer.workspacePickerButton':
      return 'Use workspace';
    case 'composer.workspacePickerFailed':
      return 'Could not open workspace picker';
    case 'composer.skillPreviewTooltip':
      return 'Preview SKILL.md';
    case 'composer.skillPreviewNotFound':
      return 'Skill not found';
    case 'composer.pickModel':
      return 'Choose model';
    case 'composer.modelPickerTitle':
      return 'Choose model';
    case 'composer.modelSwitchFailed':
      return `Failed to switch model: ${String(vars?.error ?? '')}`;
    case 'composer.folderDropUnsupported':
      return 'Folder drops are not supported in this environment';
    case 'composer.folderAttachment':
      return 'Folder';
    case 'composer.working':
      return 'Working';
    default:
      return key;
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

function renderChatInput(onSend = vi.fn()) {
  return render(
    <TooltipProvider>
      <ChatInput onSend={onSend} />
    </TooltipProvider>,
  );
}

function mockQuickSkills(skills = [createSkill]) {
  vi.mocked(hostApiFetchMock).mockResolvedValue({
    success: true,
    skills,
  });
}

function moveSelectionToEnd(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element.querySelector('p') ?? element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertTextAtSelection(element: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    element.textContent = `${element.textContent ?? ''}${text}`;
    moveSelectionToEnd(element);
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

async function typeInComposer(text: string) {
  const input = screen.getByTestId('chat-composer-input');
  input.focus();
  moveSelectionToEnd(input);

  let typedText = '';
  for (const character of Array.from(text)) {
    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: character,
      inputType: 'insertText',
    });

    fireEvent(input, beforeInputEvent);
    if (!beforeInputEvent.defaultPrevented) {
      insertTextAtSelection(input, character);
      fireEvent.input(input, { data: character, inputType: 'insertText' });
    }

    typedText += character;
    await waitFor(() => {
      expect(input.textContent ?? '').toContain(typedText);
    });
    moveSelectionToEnd(input);
  }

  await waitFor(() => {
    expect(input).toHaveTextContent(text);
  });

  return input;
}

async function waitForSendEnabled() {
  await waitFor(() => {
    expect(screen.getByTestId('chat-composer-send')).not.toBeDisabled();
  });
}

describe('ChatInput agent targeting', () => {
  beforeAll(() => {
    const nodePrototype = Node.prototype as Node & { getBoundingClientRect?: () => DOMRect };
    if (!nodePrototype.getBoundingClientRect) {
      Object.defineProperty(nodePrototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => emptyRect,
      });
    }

    if (!Range.prototype.getBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => emptyRect,
      });
    }
  });

  beforeEach(() => {
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    agentsState.updateAgentModel.mockReset();
    chatState.currentAgentId = 'main';
    gatewayState.status = { state: 'running', port: 18789 };
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.vendors = [];
    providersState.defaultAccountId = null;
    providersState.refreshProviderSnapshot.mockReset();
    vi.mocked(hostApiFetchMock).mockReset();
    vi.mocked(hostApiDialogOpenMock).mockReset();
    toastErrorMock.mockReset();
    artifactPanelMocks.openPreview.mockReset();
  });

  it('renders editable workspace selector in the composer footer', () => {
    render(
      <TooltipProvider>
        <ChatInput
          onSend={vi.fn()}
          workspaceLabel="~/workspace/ClawX"
          workspacePath="/Users/alex/workspace/ClawX"
          workspaceReadOnly={false}
          onSelectWorkspace={vi.fn()}
        />
      </TooltipProvider>,
    );

    const button = screen.getByTestId('chat-workspace-selector');
    expect(button).toHaveTextContent('~/workspace/ClawX');
    expect(button).toHaveAttribute('title', '/Users/alex/workspace/ClawX');
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('renders read-only workspace selector for bound sessions', () => {
    render(
      <TooltipProvider>
        <ChatInput
          onSend={vi.fn()}
          workspaceLabel="默认工作空间"
          workspacePath="~/.openclaw/workspace"
          workspaceReadOnly
          onSelectWorkspace={vi.fn()}
        />
      </TooltipProvider>,
    );

    const button = screen.getByTestId('chat-workspace-selector');
    expect(button).toHaveTextContent('默认工作空间');
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('workspace selector opens a native directory picker for editable sessions', async () => {
    const onSelectWorkspace = vi.fn();
    vi.mocked(hostApiDialogOpenMock).mockResolvedValue({
      canceled: false,
      filePaths: ['/Users/alex/next-project'],
    });

    render(
      <TooltipProvider>
        <ChatInput
          onSend={vi.fn()}
          workspaceLabel="Project workspace"
          workspacePath="/Users/alex/project"
          workspaceReadOnly={false}
          onSelectWorkspace={onSelectWorkspace}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByTestId('chat-workspace-selector'));

    await waitFor(() => {
      expect(hostApiDialogOpenMock).toHaveBeenCalledWith({
        title: 'Select workspace folder',
        buttonLabel: 'Use workspace',
        defaultPath: '/Users/alex/project',
        properties: ['openDirectory', 'createDirectory'],
      });
    });
    expect(onSelectWorkspace).toHaveBeenCalledWith('/Users/alex/next-project');
  });

  it('read-only workspace selector does not open the native picker', () => {
    const onSelectWorkspace = vi.fn();

    render(
      <TooltipProvider>
        <ChatInput
          onSend={vi.fn()}
          workspaceLabel="Default workspace"
          workspacePath="~/.openclaw/workspace"
          workspaceReadOnly
          onSelectWorkspace={onSelectWorkspace}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByTestId('chat-workspace-selector'));

    expect(hostApiDialogOpenMock).not.toHaveBeenCalled();
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  it('disabled workspace selector is announced disabled and does not open the native picker', () => {
    const onSelectWorkspace = vi.fn();

    render(
      <TooltipProvider>
        <ChatInput
          onSend={vi.fn()}
          disabled
          workspaceLabel="Project workspace"
          workspacePath="/Users/alex/project"
          workspaceReadOnly={false}
          onSelectWorkspace={onSelectWorkspace}
        />
      </TooltipProvider>,
    );

    const button = screen.getByTestId('chat-workspace-selector');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(button);

    expect(hostApiDialogOpenMock).not.toHaveBeenCalled();
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  it('sending workspace selector is announced disabled and does not open the native picker', () => {
    const onSelectWorkspace = vi.fn();

    render(
      <TooltipProvider>
        <ChatInput
          onSend={vi.fn()}
          sending
          workspaceLabel="Project workspace"
          workspacePath="/Users/alex/project"
          workspaceReadOnly={false}
          onSelectWorkspace={onSelectWorkspace}
        />
      </TooltipProvider>,
    );

    const button = screen.getByTestId('chat-workspace-selector');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(button);

    expect(hostApiDialogOpenMock).not.toHaveBeenCalled();
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  it('workspace selector without a selection callback is announced disabled and does not open the native picker', () => {
    render(
      <TooltipProvider>
        <ChatInput
          onSend={vi.fn()}
          workspaceLabel="Project workspace"
          workspacePath="/Users/alex/project"
          workspaceReadOnly={false}
        />
      </TooltipProvider>,
    );

    const button = screen.getByTestId('chat-workspace-selector');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(button);

    expect(hostApiDialogOpenMock).not.toHaveBeenCalled();
  });

  it('workspace selector reports dialog failures without selecting a workspace', async () => {
    const onSelectWorkspace = vi.fn();
    vi.mocked(hostApiDialogOpenMock).mockRejectedValue(new Error('dialog failed'));

    render(
      <TooltipProvider>
        <ChatInput
          onSend={vi.fn()}
          workspaceLabel="Project workspace"
          workspacePath="/Users/alex/project"
          workspaceReadOnly={false}
          onSelectWorkspace={onSelectWorkspace}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByTestId('chat-workspace-selector'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Could not open workspace picker');
    });
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  it('hides the @agent picker when only one agent is configured', () => {
    agentsState.agents = [mainAgent];

    renderChatInput();

    expect(screen.queryByTitle('Choose agent')).not.toBeInTheDocument();
  });

  it('renders a contenteditable composer when no chip is present', async () => {
    agentsState.agents = [mainAgent];

    renderChatInput();

    const textbox = screen.getByRole('textbox');

    expect(textbox.tagName).toBe('DIV');
    expect(textbox).toHaveAttribute('contenteditable', 'true');
    expect(textbox).toHaveAttribute('data-lexical-editor', 'true');
    expect(textbox).toHaveAttribute('aria-label', 'Message input');
    expect(textbox).toHaveAttribute('aria-autocomplete', 'list');
    expect(screen.queryByTestId('chat-composer-agent-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-composer-skill-token')).not.toBeInTheDocument();

    await typeInComposer('我没有填写Skill');

    expect(textbox).toHaveTextContent('我没有填写Skill');
    expect(screen.queryByTestId('chat-composer-skill-token')).not.toBeInTheDocument();
  });

  it('selects an agent from the toolbar and sends only the target route with message text', async () => {
    const onSend = vi.fn();
    agentsState.agents = [mainAgent, researchAgent];

    renderChatInput(onSend);

    fireEvent.click(screen.getByTitle('Choose agent'));
    fireEvent.click(screen.getByText('Research'));

    expect(await screen.findByTestId('chat-composer-agent-chip')).toHaveTextContent('@Research');

    await typeInComposer('Hello direct agent');
    await waitForSendEnabled();
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('Hello direct agent', undefined, 'research');
    });
    expect(onSend.mock.calls[0]?.[0]).not.toContain('@Research');
  });

  it('keeps the ACP composer enabled while gateway is running but not yet ready', async () => {
    const onSend = vi.fn();
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    agentsState.agents = [mainAgent];
    agentsState.defaultModelRef = 'custom-aaaaaaaa/gpt-a';
    const now = '2025-01-01T00:00:00.000Z';
    providersState.accounts = [
      {
        id: 'aaaaaaaa',
        vendorId: 'custom',
        label: 'Alpha',
        authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:1/v1',
        model: 'custom-aaaaaaaa/gpt-a',
        enabled: true,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'bbbbbbbb',
        vendorId: 'custom',
        label: 'Beta',
        authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:2/v1',
        model: 'custom-bbbbbbbb/gpt-b',
        enabled: true,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
    providersState.statuses = [
      { id: 'aaaaaaaa', name: 'Alpha', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
      { id: 'bbbbbbbb', name: 'Beta', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
    ];
    providersState.defaultAccountId = 'aaaaaaaa';

    renderChatInput(onSend);

    const input = screen.getByTestId('chat-composer-input');
    expect(input).toHaveAttribute('contenteditable', 'true');
    expect(input).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByTestId('chat-composer-skill')).not.toBeDisabled();
    expect(screen.getByTestId('chat-model-picker-button')).toBeInTheDocument();
    expect(screen.getByTestId('chat-model-picker-button')).not.toBeDisabled();

    await typeInComposer('Send through ACP');
    await waitForSendEnabled();
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('Send through ACP', undefined, null);
    });
  });

  it('shows starting status while gateway is running but not yet ready', () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    agentsState.agents = [mainAgent];

    renderChatInput();

    expect(screen.getByText(/gateway starting \| port: 18789/i)).toBeInTheDocument();
  });

  it('renders the skill trigger after the @ agent picker', () => {
    agentsState.agents = [mainAgent, researchAgent];

    renderChatInput();

    const agentTrigger = screen.getByTestId('chat-composer-agent');
    const skillTrigger = screen.getByTestId('chat-composer-skill');

    expect(skillTrigger).toHaveTextContent('Skill');
    expect(agentTrigger.compareDocumentPosition(skillTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('selects a skill from the toolbar and serializes it before message text', async () => {
    const onSend = vi.fn();
    agentsState.agents = [mainAgent];
    mockQuickSkills();

    renderChatInput(onSend);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByTestId('chat-composer-skill-option-create-skill'));

    expect(await screen.findByTestId('chat-composer-skill-token')).toHaveTextContent('/create-skill');

    await typeInComposer('Draft a new helper');
    await waitForSendEnabled();
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('/create-skill Draft a new helper', undefined, null);
    });
    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/skills/quick-access',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
  });

  it('opens skill suggestions when / is typed at the document start', async () => {
    agentsState.agents = [mainAgent];
    mockQuickSkills();

    renderChatInput();

    await typeInComposer('/');

    expect(await screen.findByTestId('chat-composer-prefix-menu')).toHaveAttribute(
      'aria-label',
      'Quick skill access for Main',
    );
    expect(await screen.findByTestId('chat-composer-skill-option-create-skill')).toHaveTextContent('/create-skill');
    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/skills/quick-access',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens agent suggestions when @ is typed and sends the selected route without mention text', async () => {
    const onSend = vi.fn();
    agentsState.agents = [mainAgent, researchAgent];

    renderChatInput(onSend);

    await typeInComposer('@');
    fireEvent.click(await screen.findByTestId('chat-composer-agent-option-research'));

    expect(await screen.findByTestId('chat-composer-agent-chip')).toHaveTextContent('@Research');

    await typeInComposer('Route this');
    await waitForSendEnabled();
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('Route this', undefined, 'research');
    });
    expect(onSend.mock.calls[0]?.[0]).not.toContain('@Research');
  });

  it('opens the artifact preview panel when the inline skill token is clicked', async () => {
    agentsState.agents = [mainAgent];
    mockQuickSkills();

    renderChatInput();

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByTestId('chat-composer-skill-option-create-skill'));

    fireEvent.click(await screen.findByTestId('chat-composer-skill-token'));

    expect(artifactPanelMocks.openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/workspace/skill/create-skill/SKILL.md',
        fileName: 'SKILL.md',
      }),
    );
  });

  it('stages dropped folders via disk path instead of buffer upload', async () => {
    vi.mocked(hostApiFetchMock).mockResolvedValueOnce([{
      id: 'folder-id',
      fileName: 'Archive',
      mimeType: 'application/x-directory',
      fileSize: 0,
      stagedPath: '/tmp/project-folder',
      preview: null,
    }]);

    const folderFile = new File([new Uint8Array(192)], 'Archive', { type: 'application/zip' });
    Object.defineProperty(folderFile, 'path', { value: '/tmp/project-folder' });

    const { container } = renderChatInput();
    fireEvent.drop(container.firstElementChild as Element, {
      dataTransfer: {
        items: [{
          kind: 'file',
          getAsFile: () => folderFile,
          webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
        }],
        files: [folderFile],
      },
    });

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify({ filePaths: ['/tmp/project-folder'] }),
      });
    });
    expect(await screen.findByText('Archive')).toBeInTheDocument();
  });
});
