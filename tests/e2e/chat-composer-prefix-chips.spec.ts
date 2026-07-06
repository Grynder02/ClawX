import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace/main';
const MAIN_AGENT_DIR = '/agents/main';
const REVIEWER_SESSION_KEY = 'agent:reviewer:main';
const REVIEWER_WORKSPACE = '/workspace/reviewer';
const REVIEWER_AGENT_DIR = '/agents/reviewer';

type RecordedAcpPrompt = {
  sessionKey?: string;
  cwd?: string;
  message?: string;
  media?: unknown;
  messageId?: string;
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const agents = [
  {
    id: 'main',
    name: 'main',
    workspace: MAIN_WORKSPACE,
    agentDir: MAIN_AGENT_DIR,
    mainSessionKey: MAIN_SESSION_KEY,
    modelDisplay: 'main-model',
  },
  {
    id: 'reviewer',
    name: 'reviewer',
    workspace: REVIEWER_WORKSPACE,
    agentDir: REVIEWER_AGENT_DIR,
    mainSessionKey: REVIEWER_SESSION_KEY,
    modelDisplay: 'review-model',
  },
];

const createSkill = {
  name: 'create-skill',
  description: 'Create reusable skills.',
  source: 'workspace',
  sourceLabel: 'Workspace',
  manifestPath: '/workspace/main/skills/create-skill/SKILL.md',
  baseDir: '/workspace/main/skills/create-skill',
};

const agentsSnapshot = {
  success: true,
  agents,
  defaultAgentId: 'main',
  defaultModelRef: null,
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
};

function emptyHistoryMocks(sessionKey: string) {
  return {
    [stableStringify(['chat.history', { sessionKey, limit: 200, maxChars: 500000 }])]: {
      success: true,
      result: { messages: [] },
    },
    [stableStringify(['chat.history', { sessionKey, limit: 1000, maxChars: 500000 }])]: {
      success: true,
      result: { messages: [] },
    },
  };
}

async function installComposerMocks(app: ElectronApplication) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', updatedAt: new Date().toISOString() }],
        },
      },
      ...emptyHistoryMocks(MAIN_SESSION_KEY),
      ...emptyHistoryMocks(REVIEWER_SESSION_KEY),
    },
    hostApi: {
      [stableStringify(['settings', 'getAll', null])]: {
        language: 'en',
        setupComplete: true,
      },
      [stableStringify(['agents', 'list', null])]: agentsSnapshot,
      [stableStringify(['skills', 'quickAccess', { workspace: MAIN_WORKSPACE, agentDir: MAIN_AGENT_DIR }])]: {
        success: true,
        skills: [createSkill],
      },
      [stableStringify(['sessions', 'history', { sessionKey: MAIN_SESSION_KEY, limit: 200 }])]: {
        messages: [],
      },
      [stableStringify(['sessions', 'history', { sessionKey: REVIEWER_SESSION_KEY, limit: 200 }])]: {
        messages: [],
      },
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: MAIN_WORKSPACE }])]: {
        success: true,
        generation: 1,
      },
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: '/' }])]: {
        success: true,
        generation: 1,
      },
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: REVIEWER_SESSION_KEY, cwd: REVIEWER_WORKSPACE }])]: {
        success: true,
        generation: 1,
      },
    },
  });
}

async function installAcpPromptRecorder(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    const globals = globalThis as typeof globalThis & { __prefixChipAcpPrompts?: RecordedAcpPrompt[] };
    globals.__prefixChipAcpPrompts = [];

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        globals.__prefixChipAcpPrompts?.push({ ...(request.payload ?? {}) });
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  });
}

async function getRecordedAcpPrompts(app: ElectronApplication): Promise<RecordedAcpPrompt[]> {
  return await app.evaluate(async ({ app: _app }) => {
    return (globalThis as typeof globalThis & { __prefixChipAcpPrompts?: RecordedAcpPrompt[] }).__prefixChipAcpPrompts ?? [];
  });
}

async function openChat(app: ElectronApplication) {
  const page = await getStableWindow(app);
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
  return page;
}

test.describe('ClawX chat composer prefix chips', () => {
  test('selects typed agent and skill prefixes and sends to the target agent without the agent prefix', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installComposerMocks(app);
      await installAcpPromptRecorder(app);
      const page = await openChat(app);
      const composer = page.getByTestId('chat-composer-input');

      await composer.click();
      await page.keyboard.type('@');
      const agentMenu = page.getByTestId('chat-composer-prefix-menu');
      await expect(agentMenu).toBeVisible();
      await expect(agentMenu).toContainText('Route the next message to another agent');
      await page.getByTestId('chat-composer-agent-option-reviewer').click();
      await expect(page.getByTestId('chat-composer-agent-chip')).toHaveText('@reviewer');

      await page.keyboard.type('/');
      const skillMenu = page.getByTestId('chat-composer-prefix-menu');
      await expect(skillMenu).toBeVisible();
      await expect(skillMenu).toContainText('Quick skill access for main');
      await expect(skillMenu).toContainText('/create-skill');
      await expect(skillMenu).toContainText('Create reusable skills.');
      await expect(skillMenu).toContainText('Workspace');
      await page.getByTestId('chat-composer-skill-option-create-skill').click();
      await expect(page.getByTestId('chat-composer-skill-token')).toHaveText('/create-skill');

      await page.keyboard.type('message');
      await expect(composer).toContainText('@reviewer');
      await expect(composer).toContainText('/create-skill');
      await expect(composer).toContainText('message');

      await page.getByTestId('chat-composer-send').click();

      await expect.poll(async () => await getRecordedAcpPrompts(app), { timeout: 30_000 }).toHaveLength(1);
      const [prompt] = await getRecordedAcpPrompts(app);
      expect(prompt).toMatchObject({
        sessionKey: REVIEWER_SESSION_KEY,
        cwd: REVIEWER_WORKSPACE,
        message: '/create-skill message',
      });
      expect(prompt.message ?? '').not.toContain('@reviewer');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('inserts the same chips from the toolbar agent and skills menus', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installComposerMocks(app);
      const page = await openChat(app);

      await page.getByTestId('chat-composer-agent').click();
      await page.getByRole('button', { name: /reviewer/ }).click();
      await expect(page.getByTestId('chat-composer-agent-chip')).toHaveText('@reviewer');

      await page.getByTestId('chat-composer-skill').click();
      await expect(page.getByTestId('chat-composer-skill-option-create-skill')).toBeVisible();
      await page.getByTestId('chat-composer-skill-option-create-skill').click();
      await expect(page.getByTestId('chat-composer-skill-token')).toHaveText('/create-skill');

      const composer = page.getByTestId('chat-composer-input');
      await expect(composer).toContainText('@reviewer');
      await expect(composer).toContainText('/create-skill');
    } finally {
      await closeElectronApp(app);
    }
  });
});
