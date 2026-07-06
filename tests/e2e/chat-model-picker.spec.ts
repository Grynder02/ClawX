import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const alphaModelRef = 'custom-alpha123/model-alpha';
const betaModelRef = 'custom-beta5678/provider/model-beta';
const soloModelRef = 'custom-solo1234/solo-model';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX chat model picker', () => {
  test('switches the current agent model without requesting a gateway refresh', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async ({ app: _app }, refs) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        let currentModelRef = refs.alphaModelRef;
        const hostRequests: Array<{ path: string; method: string; body: unknown }> = [];
        const now = new Date().toISOString();
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const makeResponse = (id: unknown, data: unknown) => ({
          id: typeof id === 'string' ? id : undefined,
          ok: true,
          data,
        });

        const agentsSnapshot = () => ({
          success: true,
          agents: [{
            id: 'main',
            name: 'Main',
            isDefault: true,
            modelDisplay: currentModelRef.split('/').slice(1).join('/'),
            modelRef: currentModelRef,
            overrideModelRef: currentModelRef,
            inheritedModel: false,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
            mainSessionKey: 'agent:main:main',
            channelTypes: [],
          }],
          defaultAgentId: 'main',
          defaultModelRef: refs.alphaModelRef,
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        });

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, params: unknown) => {
          hostRequests.push({ path: `gateway:${method}`, method: 'RPC', body: params ?? null });
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
          }
          return { success: true, result: {} };
        });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          const body = request?.payload ?? null;
          hostRequests.push({
            path: `${request?.module ?? ''}:${request?.action ?? ''}`,
            method: 'HOST',
            body,
          });

          if (request?.module === 'gateway' && request.action === 'status') {
            return makeResponse(request.id, { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          }
          if (request?.module === 'gateway' && request.action === 'rpc') {
            const method = typeof body?.method === 'string' ? body.method : '';
            const params = body?.params ?? null;
            hostRequests.push({ path: `gateway:${method}`, method: 'RPC', body: params });
            if (method === 'sessions.list') {
              return makeResponse(request.id, { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } });
            }
            if (method === 'chat.history') {
              return makeResponse(request.id, { success: true, result: { messages: [] } });
            }
            return makeResponse(request.id, { success: true, result: {} });
          }
          if (request?.module === 'agents' && request.action === 'list') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'agents' && request.action === 'updateModel') {
            currentModelRef = typeof body?.modelRef === 'string' ? body.modelRef : refs.alphaModelRef;
            hostRequests.push({
              path: '/api/agents/main/model',
              method: 'PUT',
              body: { modelRef: currentModelRef },
            });
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'providers' && request.action === 'accounts') {
            return makeResponse(request.id, [
              {
                id: 'alpha1234',
                vendorId: 'custom',
                label: 'Alpha',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:1111/v1',
                model: 'model-alpha',
                enabled: true,
                isDefault: true,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'beta5678',
                vendorId: 'custom',
                label: 'Beta',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:2222/v1',
                model: refs.betaModelRef,
                enabled: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'list') {
            return makeResponse(request.id, [
              { id: 'alpha1234', type: 'custom', name: 'Alpha', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'beta5678', type: 'custom', name: 'Beta', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse(request.id, [
              { accountId: 'alpha1234', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'beta5678', hasKey: true, keyMasked: 'sk-***' },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'vendors') {
            return makeResponse(request.id, []);
          }
          if (request?.module === 'providers' && request.action === 'getDefaultAccount') {
            return makeResponse(request.id, { accountId: 'alpha1234' });
          }

          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });

        (globalThis as typeof globalThis & { __chatModelPickerRequests?: typeof hostRequests }).__chatModelPickerRequests = hostRequests;
      }, { alphaModelRef, betaModelRef });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });

      await expect(page.getByTestId('chat-model-picker-button')).toContainText('model-alpha (Alpha)');
      await page.getByTestId('chat-model-picker-button').click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-menu')).toContainText('provider/model-beta (Beta)');
      await page.getByTestId('chat-model-picker-menu').getByRole('button', { name: 'provider/model-beta (Beta)' }).click();
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('provider/model-beta (Beta)');

      const requests = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __chatModelPickerRequests?: Array<{ path: string; method: string; body: unknown }> }).__chatModelPickerRequests ?? []
      ));
      expect(requests).toContainEqual({
        path: '/api/agents/main/model',
        method: 'PUT',
        body: { modelRef: betaModelRef },
      });
      expect(requests.some((request) =>
        request.path === '/api/gateway/restart'
        || request.path === '/api/gateway/start'
        || request.path === 'gateway:restart'
        || request.path === 'gateway:start'
        || request.path === 'gateway:config.patch'
      )).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the model selector before Send even when only one model is configured', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const now = new Date().toISOString();

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['settings', 'getAll', null])]: {
            language: 'en',
            setupComplete: true,
          },
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              modelDisplay: 'solo-model',
              modelRef: soloModelRef,
              overrideModelRef: soloModelRef,
              inheritedModel: false,
              workspace: '~/.openclaw/workspace',
              agentDir: '~/.openclaw/agents/main/agent',
              mainSessionKey: 'agent:main:main',
              channelTypes: [],
            }],
            defaultAgentId: 'main',
            defaultModelRef: soloModelRef,
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: 'agent:main:main', cwd: '~/.openclaw/workspace' }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['providers', 'accounts', null])]: [
            {
              id: 'custom-solo1234',
              vendorId: 'custom',
              label: 'Solo',
              authMode: 'api_key',
              baseUrl: 'http://127.0.0.1:3333/v1',
              model: 'solo-model',
              enabled: true,
              isDefault: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          [stableStringify(['providers', 'list', null])]: [
            { id: 'custom-solo1234', type: 'custom', name: 'Solo', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
          ],
          [stableStringify(['providers', 'accountKeyInfo', null])]: [
            { accountId: 'custom-solo1234', hasKey: true, keyMasked: 'sk-***' },
          ],
          [stableStringify(['providers', 'vendors', null])]: [],
          [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: 'custom-solo1234' },
        },
      });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('solo-model (Solo)', { timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-send')).toBeVisible();

      const modelPickerPrecedesSend = await page.evaluate(() => {
        const modelPicker = document.querySelector('[data-testid="chat-model-picker-button"]');
        const send = document.querySelector('[data-testid="chat-composer-send"]');
        if (!(modelPicker instanceof HTMLElement) || !(send instanceof HTMLElement)) {
          return false;
        }
        return Boolean(modelPicker.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING);
      });

      expect(modelPickerPrecedesSend).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
