import { createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { ComposerChipNode, $createComposerChipNode, $isComposerChipNode } from '@/pages/Chat/composer/ComposerChipNode';
import type { ComposerAgentChip, ComposerChip, ComposerSkillChip } from '@/pages/Chat/composer/types';

const agentPayload: ComposerAgentChip = {
  kind: 'agent',
  id: 'reviewer',
  name: 'Reviewer',
  modelDisplay: 'Claude',
};

const skillPayload: ComposerSkillChip = {
  kind: 'skill',
  name: 'code-review',
  description: 'Review code changes for bugs and regressions.',
  source: 'workspace',
  sourceLabel: 'Workspace',
  manifestPath: '/tmp/workspace/skill/code-review/SKILL.md',
  baseDir: '/tmp/workspace/skill/code-review',
};

function readChipNode<T>(chip: ComposerChip, read: (node: ComposerChipNode) => T): T {
  const editor = createEditor({
    namespace: 'ComposerChipNodeTest',
    nodes: [ComposerChipNode],
    onError(error) {
      throw error;
    },
  });
  let result: T | undefined;

  editor.update(() => {
    const node = $createComposerChipNode(chip);
    result = read(node);
  });

  return result as T;
}

describe('ComposerChipNode', () => {
  it('creates agent chip text from payload', () => {
    const result = readChipNode(agentPayload, (node) => ({
      text: node.getTextContent(),
      payload: node.getPayload(),
    }));

    expect(result.text).toBe('@Reviewer');
    expect(result.payload).toEqual(agentPayload);
  });

  it('creates skill chip text from payload', () => {
    const result = readChipNode(skillPayload, (node) => ({
      text: node.getTextContent(),
      payload: node.getPayload(),
    }));

    expect(result.text).toBe('/code-review');
    expect(result.payload).toEqual(skillPayload);
  });

  it('exports payload metadata to JSON', () => {
    const json = readChipNode(skillPayload, (node) => node.exportJSON());

    expect(json).toEqual(expect.objectContaining({
      type: 'composer-chip',
      version: 1,
      chip: skillPayload,
      text: '/code-review',
    }));
  });

  it('identifies composer chip nodes', () => {
    const isComposerChipNode = readChipNode(agentPayload, (node) => $isComposerChipNode(node));

    expect(isComposerChipNode).toBe(true);
    expect(typeof $createComposerChipNode).toBe('function');
  });

  it('clones payload when creating a chip node', () => {
    const payload: ComposerAgentChip = { ...agentPayload };
    const storedPayload = readChipNode(payload, (node) => {
      payload.name = 'Mutated';
      return node.getPayload();
    });

    expect(storedPayload).toEqual(agentPayload);
  });

  it('returns cloned payloads', () => {
    const payload: ComposerAgentChip = { ...agentPayload };
    const expectedPayload: ComposerAgentChip = { ...agentPayload };
    const storedPayload = readChipNode(payload, (node) => {
      const returnedPayload = node.getPayload();
      returnedPayload.name = 'Mutated';
      return node.getPayload();
    });

    expect(storedPayload).toEqual(expectedPayload);
  });

  it('exports cloned payload metadata', () => {
    const payload: ComposerSkillChip = { ...skillPayload };
    const expectedPayload: ComposerSkillChip = { ...skillPayload };
    const storedPayload = readChipNode(payload, (node) => {
      const json = node.exportJSON();
      json.chip.name = 'mutated';
      return node.getPayload();
    });

    expect(storedPayload).toEqual(expectedPayload);
  });
});
