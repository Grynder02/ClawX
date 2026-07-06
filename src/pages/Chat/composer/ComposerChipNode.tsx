import {
  $applyNodeReplacement,
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedTextNode,
} from 'lexical';

import { cn } from '@/lib/utils';

import type { ComposerChip } from './types';

export type SerializedComposerChipNode = SerializedTextNode & {
  type: 'composer-chip';
  version: 1;
  chip: ComposerChip;
};

function getComposerChipText(chip: ComposerChip): string {
  return chip.kind === 'agent' ? `@${chip.name}` : `/${chip.name}`;
}

function cloneComposerChip<T extends ComposerChip>(chip: T): T {
  return { ...chip };
}

function getTextMode(mode: ComposerChipNode['__mode']): SerializedTextNode['mode'] {
  if (mode === 1) return 'token';
  if (mode === 2) return 'segmented';
  return 'normal';
}

function applyComposerChipDOMAttributes(dom: HTMLElement, chip: ComposerChip): void {
  dom.className = cn(
    'inline-flex select-none items-center rounded-full px-1.5 py-0.5 align-baseline text-xs font-medium bg-black/5 dark:bg-white/10',
    chip.kind === 'agent'
      ? 'text-blue-700 dark:text-blue-400'
      : 'text-purple-700 dark:text-purple-400',
  );
  dom.setAttribute(
    'data-testid',
    chip.kind === 'agent' ? 'chat-composer-agent-chip' : 'chat-composer-skill-token',
  );
  dom.dataset.composerChipKind = chip.kind;
  dom.dataset.composerChipName = chip.name;

  if (chip.kind === 'agent') {
    dom.dataset.composerAgentId = chip.id;
    delete dom.dataset.composerSkillManifestPath;
    return;
  }

  dom.dataset.composerSkillManifestPath = chip.manifestPath;
  delete dom.dataset.composerAgentId;
}

export class ComposerChipNode extends TextNode {
  __chip: ComposerChip;

  static getType(): string {
    return 'composer-chip';
  }

  static clone(node: ComposerChipNode): ComposerChipNode {
    return new ComposerChipNode(node.__chip, node.__key);
  }

  static importJSON(serializedNode: SerializedComposerChipNode): ComposerChipNode {
    return $createComposerChipNode(serializedNode.chip).updateFromJSON(serializedNode);
  }

  constructor(chip: ComposerChip, key?: NodeKey) {
    super(getComposerChipText(chip), key);
    this.__chip = cloneComposerChip(chip);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__chip = cloneComposerChip(prevNode.__chip);
  }

  getPayload(): ComposerChip {
    return cloneComposerChip(this.getLatest().__chip);
  }

  getTextContent(): string {
    return getComposerChipText(this.__chip);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    applyComposerChipDOMAttributes(dom, this.__chip);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const shouldReplace = super.updateDOM(prevNode, dom, config);
    if (!shouldReplace) {
      applyComposerChipDOMAttributes(dom, this.__chip);
    }
    return shouldReplace;
  }

  exportJSON(): SerializedComposerChipNode {
    return {
      detail: this.__detail,
      format: this.__format,
      mode: getTextMode(this.__mode),
      style: this.__style,
      text: this.getTextContent(),
      type: 'composer-chip',
      version: 1,
      chip: this.getPayload(),
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedComposerChipNode>): this {
    const self = super.updateFromJSON(serializedNode);
    self.__chip = cloneComposerChip(serializedNode.chip);
    return self.setTextContent(getComposerChipText(serializedNode.chip));
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  isTextEntity(): true {
    return true;
  }
}

export function $createComposerChipNode(chip: ComposerChip): ComposerChipNode {
  return $applyNodeReplacement(new ComposerChipNode(chip).setMode('token'));
}

export function $isComposerChipNode(node: LexicalNode | null | undefined): node is ComposerChipNode {
  return node instanceof ComposerChipNode;
}
