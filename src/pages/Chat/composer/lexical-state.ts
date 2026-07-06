import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type PointType,
  type LexicalNode,
} from 'lexical';

import { $createComposerChipNode, $isComposerChipNode } from './ComposerChipNode';
import type { ComposerAgentChip, ComposerSkillChip, ComposerValue, PrefixQuery } from './types';

export function $readComposerValue(): ComposerValue {
  let agent: ComposerAgentChip | null = null;
  let skill: ComposerSkillChip | null = null;
  const textParts: string[] = [];

  function visit(node: LexicalNode): void {
    if ($isComposerChipNode(node)) {
      const chip = node.getPayload();
      if (chip.kind === 'agent') {
        agent ??= chip;
      } else {
        skill ??= chip;
      }
      return;
    }

    if ($isLineBreakNode(node)) {
      textParts.push('\n');
      return;
    }

    if ($isTextNode(node)) {
      textParts.push(node.getTextContent());
      return;
    }

    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
      }
    }
  }

  visit($getRoot());

  return {
    text: textParts.join('').replace(/^\s+/, ''),
    agent,
    skill,
  };
}

export function $readTextBeforeCaret(): string {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return '';

  const point = selection.focus;
  const textParts: string[] = [];
  let done = false;

  function visit(node: LexicalNode): void {
    if (done) return;

    if ($isComposerChipNode(node)) {
      if (point.key === node.getKey()) {
        done = true;
      }
      return;
    }

    if ($isLineBreakNode(node)) {
      if (point.key === node.getKey()) {
        done = true;
        return;
      }
      textParts.push('\n');
      return;
    }

    if ($isTextNode(node)) {
      if (point.type === 'text' && point.key === node.getKey()) {
        textParts.push(node.getTextContent().slice(0, point.offset));
        done = true;
        return;
      }

      textParts.push(node.getTextContent());
      return;
    }

    if ($isElementNode(node)) {
      visitElement(node, point);
    }
  }

  function visitElement(node: ElementNode, caret: PointType): void {
    const children = node.getChildren();
    const limit = caret.type === 'element' && caret.key === node.getKey()
      ? Math.min(caret.offset, children.length)
      : children.length;

    for (let index = 0; index < limit; index += 1) {
      const child = children[index];
      if (child) visit(child);
      if (done) return;
    }

    if (caret.type === 'element' && caret.key === node.getKey()) {
      done = true;
    }
  }

  visit($getRoot());

  return textParts.join('');
}

export function $replaceComposerValue(value: ComposerValue): void {
  const root = $getRoot();
  const paragraph = $createParagraphNode();
  const text = value.text.replace(/^\s+/, '');

  if (value.agent) {
    paragraph.append($createComposerChipNode(value.agent), $createTextNode(' '));
  }

  if (value.skill) {
    paragraph.append($createComposerChipNode(value.skill), $createTextNode(' '));
  }

  if (text.length > 0) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (line.length > 0) {
        paragraph.append($createTextNode(line));
      }

      if (index < lines.length - 1) {
        paragraph.append($createLineBreakNode());
      }
    });
  }

  root.clear();
  root.append(paragraph);
  paragraph.selectEnd();
}

export function removeActivePrefixQuery(text: string, query: PrefixQuery | null): string {
  if (!query) return text;

  const prefix = `${query.trigger}${query.query}`;
  if (!text.startsWith(prefix)) return text;

  return text.slice(prefix.length).replace(/^\s+/, '');
}
