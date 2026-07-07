import { describe, expect, it } from 'vitest';

import { groupSessionsByWorkspace } from '@/components/layout/session-buckets';

describe('workspace session grouping', () => {
  it('groups by workspace first and recency second', () => {
    const nowMs = new Date('2026-07-07T12:00:00Z').getTime();
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-a', workspacePath: '/repo/a', updatedAt: nowMs },
        { key: 'agent:main:session-b', workspacePath: '/repo/b', updatedAt: nowMs - 2 * 24 * 60 * 60 * 1000 },
        { key: 'agent:main:session-c', workspacePath: '/repo/a', updatedAt: nowMs - 10 * 24 * 60 * 60 * 1000 },
      ],
      {},
      nowMs,
      '默认工作空间',
    );

    expect(groups.map((group) => group.workspacePath)).toEqual(['/repo/a', '/repo/b']);
    expect(groups[0].buckets.find((bucket) => bucket.key === 'today')?.sessions.map((session) => session.key)).toEqual(['agent:main:session-a']);
    expect(groups[0].buckets.find((bucket) => bucket.key === 'withinMonth')?.sessions.map((session) => session.key)).toEqual(['agent:main:session-c']);
    expect(groups[1].buckets.find((bucket) => bucket.key === 'withinWeek')?.sessions.map((session) => session.key)).toEqual(['agent:main:session-b']);
  });

  it('puts sessions without cwd into the default workspace group', () => {
    const groups = groupSessionsByWorkspace(
      [{ key: 'agent:main:session-old', updatedAt: 1 }],
      {},
      2,
      '默认工作空间',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('默认工作空间');
  });

  it('groups locally-created sessions without cwd under the selected global workspace', () => {
    const groups = groupSessionsByWorkspace(
      [{ key: 'agent:main:session-pending', createdLocally: true, updatedAt: 1 }],
      {},
      2,
      '默认工作空间',
      '/repo/global',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].workspacePath).toBe('/repo/global');
  });

  it('groups default-equivalent workspace paths with sessions missing cwd', () => {
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-no-cwd', updatedAt: 2 },
        { key: 'agent:main:session-default-path', workspacePath: '/Users/alex/.openclaw/workspace', updatedAt: 1 },
      ],
      {},
      3,
      '默认工作空间',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].workspacePath).toBe('~/.openclaw/workspace');
    expect(groups[0].label).toBe('默认工作空间');
  });
});
