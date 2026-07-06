import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { ComposerChipNode, $createComposerChipNode } from '@/pages/Chat/composer/ComposerChipNode';
import { $readComposerValue, $replaceComposerValue, removeActivePrefixQuery } from '@/pages/Chat/composer/lexical-state';
import { formatVisiblePrefixText, hasSendableComposerValue, serializeComposerValue } from '@/pages/Chat/composer/serialization';
import type { ComposerAgentChip, ComposerSkillChip } from '@/pages/Chat/composer/types';

const reviewer: ComposerAgentChip = {
  kind: 'agent',
  id: 'reviewer',
  name: 'Reviewer',
  modelDisplay: 'Claude',
};

const codeReview: ComposerSkillChip = {
  kind: 'skill',
  name: 'code-review',
  description: 'Review code changes for bugs and regressions.',
  source: 'workspace',
  sourceLabel: 'Workspace',
  manifestPath: '/tmp/workspace/skill/code-review/SKILL.md',
  baseDir: '/tmp/workspace/skill/code-review',
};

function createComposerEditor() {
  return createEditor({
    namespace: 'ComposerSerializationTest',
    nodes: [ComposerChipNode],
    onError(error) {
      throw error;
    },
  });
}

describe('chat composer serialization', () => {
  it('excludes the agent chip from sent text and returns targetAgentId', () => {
    expect(serializeComposerValue({ text: 'hello reviewer', agent: reviewer, skill: null })).toEqual({
      text: 'hello reviewer',
      targetAgentId: 'reviewer',
    });
  });

  it('serializes the skill chip as a leading OpenClaw skill prefix', () => {
    expect(serializeComposerValue({ text: 'check this', agent: null, skill: codeReview })).toEqual({
      text: '/code-review check this',
      targetAgentId: null,
    });
  });

  it('supports agent and skill chips together', () => {
    expect(serializeComposerValue({ text: 'check this', agent: reviewer, skill: codeReview })).toEqual({
      text: '/code-review check this',
      targetAgentId: 'reviewer',
    });
  });

  it('allows a skill-only prompt to send', () => {
    expect(serializeComposerValue({ text: '   ', agent: null, skill: codeReview })).toEqual({
      text: '/code-review',
      targetAgentId: null,
    });
    expect(hasSendableComposerValue({ text: '   ', agent: null, skill: codeReview }, 0)).toBe(true);
  });

  it('allows attachment-only sends but blocks empty text without attachments', () => {
    expect(hasSendableComposerValue({ text: '   ', agent: null, skill: null }, 1)).toBe(true);
    expect(hasSendableComposerValue({ text: '   ', agent: null, skill: null }, 0)).toBe(false);
  });

  it('normalizes visible chip text in fixed agent then skill order', () => {
    expect(formatVisiblePrefixText({ agent: reviewer, skill: codeReview })).toBe('@Reviewer /code-review');
    expect(formatVisiblePrefixText({ agent: reviewer, skill: null })).toBe('@Reviewer');
    expect(formatVisiblePrefixText({ agent: null, skill: codeReview })).toBe('/code-review');
  });
});

describe('chat composer lexical state', () => {
  it('reads one agent chip, one skill chip, and left-trimmed normal text', () => {
    const editor = createComposerEditor();
    let value: ReturnType<typeof $readComposerValue> | undefined;

    editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append(
        $createTextNode('   '),
        $createComposerChipNode(codeReview),
        $createTextNode('  check '),
        $createComposerChipNode(reviewer),
        $createTextNode(' this'),
        $createComposerChipNode({ ...reviewer, id: 'second-reviewer', name: 'Second Reviewer' }),
      );
      $getRoot().clear().append(paragraph);

      value = $readComposerValue();
    });

    expect(value).toEqual({
      text: 'check  this',
      agent: reviewer,
      skill: codeReview,
    });
  });

  it('replaces editor contents with normalized chip order before normal text', () => {
    const editor = createComposerEditor();
    let visibleText = '';
    let value: ReturnType<typeof $readComposerValue> | undefined;

    editor.update(() => {
      $replaceComposerValue({ text: '   check this', agent: reviewer, skill: codeReview });
      visibleText = $getRoot().getTextContent();
      value = $readComposerValue();
    });

    expect(visibleText).toBe('@Reviewer /code-review check this');
    expect(value).toEqual({
      text: 'check this',
      agent: reviewer,
      skill: codeReview,
    });
  });

  it('preserves line breaks when replacing and reading composer text', () => {
    const editor = createComposerEditor();
    let hasLineBreakNode = false;
    let value: ReturnType<typeof $readComposerValue> | undefined;

    editor.update(() => {
      $replaceComposerValue({ text: 'hello\nworld', agent: null, skill: null });
      const paragraph = $getRoot().getFirstChildOrThrow();
      if (!$isElementNode(paragraph)) {
        throw new Error('Expected composer paragraph node');
      }
      hasLineBreakNode = paragraph.getChildren().some((child) => $isLineBreakNode(child));
      value = $readComposerValue();
    });

    expect(hasLineBreakNode).toBe(true);
    expect(value?.text).toBe('hello\nworld');
  });

  it('reads line break nodes as newline characters', () => {
    const editor = createComposerEditor();
    let value: ReturnType<typeof $readComposerValue> | undefined;

    editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('hello'), $createLineBreakNode(), $createTextNode('world'));
      $getRoot().clear().append(paragraph);

      value = $readComposerValue();
    });

    expect(value?.text).toBe('hello\nworld');
  });

  it('removes only the active start prefix query and trims following whitespace', () => {
    expect(removeActivePrefixQuery('@rev  check this', { trigger: '@', query: 'rev' })).toBe('check this');
    expect(removeActivePrefixQuery('/code-review\tcheck this', { trigger: '/', query: 'code-review' })).toBe('check this');
    expect(removeActivePrefixQuery('check @rev this', { trigger: '@', query: 'rev' })).toBe('check @rev this');
    expect(removeActivePrefixQuery('@rev check this', null)).toBe('@rev check this');
  });
});
