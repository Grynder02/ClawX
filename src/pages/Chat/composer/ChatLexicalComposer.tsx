import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  mergeRegister,
  type EditorState,
} from 'lexical';
import {
  forwardRef,
  type ForwardedRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/types/agent';
import type { QuickAccessSkill } from '@/types/skill';

import { ComposerChipNode } from './ComposerChipNode';
import { $readComposerValue, $readTextBeforeCaret, $replaceComposerValue, removeActivePrefixQuery } from './lexical-state';
import { findLogicalStartPrefixQuery } from './prefix-rules';
import { PrefixDropdown } from './PrefixDropdown';
import type {
  ComposerAgentChip,
  ComposerSkillChip,
  ComposerValue,
  PrefixOption,
  PrefixQuery,
  PrefixTrigger,
} from './types';

export interface ChatLexicalComposerHandle {
  clear: () => void;
  clearAgent: () => void;
  clearSkill: () => void;
  focus: () => void;
  insertAgent: (agent: ComposerAgentChip) => void;
  insertSkill: (skill: ComposerSkillChip) => void;
}

interface ChatLexicalComposerProps {
  disabled: boolean;
  ariaLabel: string;
  placeholder: string;
  agents: AgentSummary[];
  skills: QuickAccessSkill[];
  skillsLoading: boolean;
  skillsError: string | null;
  labels: {
    agentTitle: string;
    skillTitle: string;
    agentEmpty: string;
    skillEmpty: string;
    skillLoading: string;
  };
  onChange: (value: ComposerValue) => void;
  onSubmit: () => void;
  onEscape: () => void;
  onRequestSkills: () => void;
  onPreviewSkill: (skill: { name: string; manifestPath: string }) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
}

type PrefixDropdownItem = ComposerAgentChip | ComposerSkillChip;

const CHAT_LEXICAL_THEME = {
  text: {
    bold: 'font-semibold',
  },
};

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matchesPrefixQuery(query: string, values: Array<string | null | undefined>): boolean {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return true;

  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function toAgentChip(agent: AgentSummary): ComposerAgentChip {
  return {
    kind: 'agent',
    id: agent.id,
    name: agent.name,
    modelDisplay: agent.modelDisplay,
  };
}

function toSkillChip(skill: QuickAccessSkill): ComposerSkillChip {
  return {
    kind: 'skill',
    ...skill,
  };
}

function buildAgentOptions(agents: AgentSummary[], query: string): PrefixOption<PrefixDropdownItem>[] {
  return agents
    .filter((agent) => matchesPrefixQuery(query, [agent.name, agent.modelDisplay]))
    .map((agent) => ({
      id: agent.id,
      label: `@${agent.name}`,
      description: agent.modelDisplay || undefined,
      item: toAgentChip(agent),
    }));
}

function buildSkillOptions(skills: QuickAccessSkill[], query: string): PrefixOption<PrefixDropdownItem>[] {
  return skills
    .filter((skill) => matchesPrefixQuery(query, [skill.name, skill.description, skill.sourceLabel, skill.source]))
    .map((skill) => ({
      id: skill.manifestPath,
      label: `/${skill.name}`,
      description: skill.description || undefined,
      sourceLabel: skill.sourceLabel,
      item: toSkillChip(skill),
    }));
}

function getPrefixOptionTestId(option: PrefixOption<PrefixDropdownItem>): string {
  return option.item.kind === 'agent'
    ? `chat-composer-agent-option-${option.item.id}`
    : `chat-composer-skill-option-${option.item.name}`;
}

function encodeDomIdPart(value: string): string {
  const encoded = Array.from(value).map((character) => character.codePointAt(0)?.toString(36) ?? '').join('-');
  return encoded || 'empty';
}

function getPrefixOptionDomId(instancePrefix: string, option: PrefixOption<PrefixDropdownItem>): string {
  return `${instancePrefix}-prefix-option-${option.item.kind}-${encodeDomIdPart(option.id)}`;
}

function focusEditorAfterUpdate(focus: () => void): void {
  focus();
  requestAnimationFrame(focus);
}

function moveDomSelectionAroundElement(element: HTMLElement, placement: 'before' | 'after'): void {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) return;

  const range = element.ownerDocument.createRange();
  if (placement === 'before') {
    range.setStartBefore(element);
  } else {
    range.setStartAfter(element);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getPrefixQueryKey(query: PrefixQuery | null): string | null {
  return query ? `${query.trigger}${query.query}` : null;
}

function getComposerChipElement(node: Node | null, root: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const chip = element?.closest<HTMLElement>('[data-composer-chip-kind]') ?? null;
  return chip && root.contains(chip) ? chip : null;
}

function getComposerChipFromBoundaryNode(
  node: Node | null,
  root: HTMLElement,
  direction: 'backward' | 'forward',
): HTMLElement | null {
  let current = node;

  while (current) {
    const chip = getComposerChipElement(current, root);
    if (chip) return chip;

    if (current.nodeType !== Node.TEXT_NODE || current.textContent?.trim()) {
      return null;
    }

    current = direction === 'backward' ? current.previousSibling : current.nextSibling;
  }

  return null;
}

function getAdjacentComposerChip(
  root: HTMLElement | null,
  direction: 'backward' | 'forward',
): HTMLElement | null {
  if (!root) return null;

  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;

  const anchorNode = selection.anchorNode;
  if (!anchorNode || !root.contains(anchorNode)) return null;

  const offset = selection.anchorOffset;
  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const text = anchorNode.textContent ?? '';
    if (direction === 'backward') {
      if (text.slice(0, offset).trim()) return null;
      return getComposerChipFromBoundaryNode(anchorNode.previousSibling, root, direction);
    }

    if (text.slice(offset).trim()) return null;
    return getComposerChipFromBoundaryNode(anchorNode.nextSibling, root, direction);
  }

  const boundaryOffset = direction === 'backward' ? offset - 1 : offset;
  if (boundaryOffset < 0) return null;

  return getComposerChipFromBoundaryNode(anchorNode.childNodes.item(boundaryOffset), root, direction);
}

function ChatLexicalComposerPlugin({
  forwardedRef,
  disabled,
  ariaLabel,
  placeholder,
  agents,
  skills,
  skillsLoading,
  skillsError,
  labels,
  onChange,
  onSubmit,
  onEscape,
  onRequestSkills,
  onPreviewSkill,
  onPaste,
}: ChatLexicalComposerProps & { forwardedRef: ForwardedRef<ChatLexicalComposerHandle> }) {
  const [editor] = useLexicalComposerContext();
  const instanceId = useId();
  const [prefixQuery, setPrefixQuery] = useState<PrefixQuery | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const prefixQueryKeyRef = useRef<string | null>(null);
  const activePrefixQueryRef = useRef<PrefixQuery | null>(null);
  const requestedSkillQueryKeyRef = useRef<string | null>(null);
  const suppressNextPrefixQueryRef = useRef(false);
  const isComposingRef = useRef(false);

  const instancePrefix = useMemo(() => `chat-composer-${encodeDomIdPart(instanceId)}`, [instanceId]);
  const prefixListboxId = `${instancePrefix}-prefix-listbox`;
  const getPrefixOptionId = useCallback((option: PrefixOption<PrefixDropdownItem>) => (
    getPrefixOptionDomId(instancePrefix, option)
  ), [instancePrefix]);

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  const closePrefixDropdown = useCallback(() => {
    prefixQueryKeyRef.current = null;
    activePrefixQueryRef.current = null;
    requestedSkillQueryKeyRef.current = null;
    setHighlightedIndex(0);
    setPrefixQuery(null);
  }, []);

  const focusEditor = useCallback(() => {
    editor.focus();
  }, [editor]);

  const replaceComposerValue = useCallback((input: {
    agent?: ComposerAgentChip | null;
    skill?: ComposerSkillChip | null;
    activeQuery?: PrefixQuery | null;
    removeQueryTrigger?: PrefixTrigger;
    text?: string;
  }, options: { focus?: boolean } = {}) => {
    editor.update(() => {
      const currentValue = $readComposerValue();
      const shouldRemoveQuery = input.removeQueryTrigger && input.activeQuery?.trigger === input.removeQueryTrigger;
      const text = input.text ?? removeActivePrefixQuery(currentValue.text, shouldRemoveQuery ? input.activeQuery ?? null : null);

      $replaceComposerValue({
        text,
        agent: input.agent === undefined ? currentValue.agent : input.agent,
        skill: input.skill === undefined ? currentValue.skill : input.skill,
      });
    });

    if (options.focus !== false) {
      focusEditorAfterUpdate(focusEditor);
    }
  }, [editor, focusEditor]);

  const clear = useCallback(() => {
    closePrefixDropdown();
    replaceComposerValue({ text: '', agent: null, skill: null });
  }, [closePrefixDropdown, replaceComposerValue]);

  const clearAgent = useCallback(() => {
    closePrefixDropdown();
    replaceComposerValue({ agent: null }, { focus: false });
  }, [closePrefixDropdown, replaceComposerValue]);

  const clearSkill = useCallback(() => {
    closePrefixDropdown();
    replaceComposerValue({ skill: null }, { focus: false });
  }, [closePrefixDropdown, replaceComposerValue]);

  const insertAgent = useCallback((agent: ComposerAgentChip) => {
    const activeQuery = activePrefixQueryRef.current;
    if (activeQuery) {
      suppressNextPrefixQueryRef.current = true;
    }
    closePrefixDropdown();
    replaceComposerValue({ agent, activeQuery, removeQueryTrigger: '@' });
  }, [closePrefixDropdown, replaceComposerValue]);

  const insertSkill = useCallback((skill: ComposerSkillChip) => {
    const activeQuery = activePrefixQueryRef.current;
    if (activeQuery) {
      suppressNextPrefixQueryRef.current = true;
    }
    closePrefixDropdown();
    replaceComposerValue({ skill, activeQuery, removeQueryTrigger: '/' });
  }, [closePrefixDropdown, replaceComposerValue]);

  const removeAdjacentChip = useCallback((
    event: KeyboardEvent | null,
    direction: 'backward' | 'forward',
  ): boolean => {
    const chip = getAdjacentComposerChip(editor.getRootElement(), direction);
    const chipKind = chip?.dataset.composerChipKind;
    if (chipKind !== 'agent' && chipKind !== 'skill') return false;

    event?.preventDefault();
    event?.stopPropagation();
    closePrefixDropdown();

    const value = $readComposerValue();
    $replaceComposerValue({
      text: value.text,
      agent: chipKind === 'agent' ? null : value.agent,
      skill: chipKind === 'skill' ? null : value.skill,
    });
    focusEditorAfterUpdate(focusEditor);
    return true;
  }, [closePrefixDropdown, editor, focusEditor]);

  const moveAcrossAdjacentChip = useCallback((
    event: KeyboardEvent,
    direction: 'backward' | 'forward',
  ): boolean => {
    const chip = getAdjacentComposerChip(editor.getRootElement(), direction);
    if (!chip) return false;

    event.preventDefault();
    event.stopPropagation();
    closePrefixDropdown();
    moveDomSelectionAroundElement(chip, direction === 'backward' ? 'before' : 'after');
    return true;
  }, [closePrefixDropdown, editor]);

  useEffect(() => mergeRegister(
    editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => moveAcrossAdjacentChip(event, 'backward'),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => moveAcrossAdjacentChip(event, 'forward'),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => removeAdjacentChip(event, 'backward'),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => removeAdjacentChip(event, 'forward'),
      COMMAND_PRIORITY_HIGH,
    ),
  ), [editor, moveAcrossAdjacentChip, removeAdjacentChip]);

  useImperativeHandle(forwardedRef, () => ({
    clear,
    clearAgent,
    clearSkill,
    focus: focusEditor,
    insertAgent,
    insertSkill,
  }), [clear, clearAgent, clearSkill, focusEditor, insertAgent, insertSkill]);

  const handleEditorChange = useCallback((editorState: EditorState) => {
    editorState.read(() => {
      const value = $readComposerValue();
      const textBeforeCaret = $readTextBeforeCaret();
      const nextPrefixQuery = findLogicalStartPrefixQuery(textBeforeCaret);
      const effectivePrefixQuery = suppressNextPrefixQueryRef.current ? null : nextPrefixQuery;
      const nextPrefixQueryKey = getPrefixQueryKey(effectivePrefixQuery);

      suppressNextPrefixQueryRef.current = false;
      activePrefixQueryRef.current = effectivePrefixQuery;

      onChange(value);

      if (prefixQueryKeyRef.current !== nextPrefixQueryKey) {
        prefixQueryKeyRef.current = nextPrefixQueryKey;
        setHighlightedIndex(0);
      }

      setPrefixQuery(effectivePrefixQuery);

      if (effectivePrefixQuery?.trigger === '/') {
        if (requestedSkillQueryKeyRef.current !== nextPrefixQueryKey) {
          requestedSkillQueryKeyRef.current = nextPrefixQueryKey;
          onRequestSkills();
        }
      } else {
        requestedSkillQueryKeyRef.current = null;
      }
    });
  }, [onChange, onRequestSkills]);

  const handleSelectPrefixItem = useCallback((item: PrefixDropdownItem) => {
    const activeQuery = activePrefixQueryRef.current;
    closePrefixDropdown();

    if (item.kind === 'agent') {
      replaceComposerValue({ agent: item, activeQuery, removeQueryTrigger: '@' });
      return;
    }

    replaceComposerValue({ skill: item, activeQuery, removeQueryTrigger: '/' });
  }, [closePrefixDropdown, replaceComposerValue]);

  const handleContentClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-composer-chip-kind="skill"]')
      : null;
    const name = target?.dataset.composerChipName;
    const manifestPath = target?.dataset.composerSkillManifestPath;

    if (!name || !manifestPath) return;

    event.preventDefault();
    event.stopPropagation();
    onPreviewSkill({ name, manifestPath });
    focusEditorAfterUpdate(focusEditor);
  }, [focusEditor, onPreviewSkill]);

  const prefixTrigger = prefixQuery?.trigger;
  const prefixSearchQuery = prefixQuery?.query ?? '';
  const activeOptions = useMemo(() => {
    if (prefixTrigger === '@') return buildAgentOptions(agents, prefixSearchQuery);
    if (prefixTrigger === '/') return buildSkillOptions(skills, prefixSearchQuery);
    return [];
  }, [agents, prefixSearchQuery, prefixTrigger, skills]);
  const prefixDropdownOpen = !disabled && prefixQuery !== null;
  const prefixOptionsBlocked = prefixTrigger === '/' && (skillsLoading || skillsError !== null);
  const hasSelectableOptions = prefixDropdownOpen && activeOptions.length > 0 && !prefixOptionsBlocked;
  const highlightedOptionIndex = activeOptions.length === 0
    ? 0
    : Math.min(highlightedIndex, activeOptions.length - 1);
  const highlightedOption = hasSelectableOptions ? activeOptions[highlightedOptionIndex] : undefined;
  const activeDescendantId = highlightedOption ? getPrefixOptionId(highlightedOption) : undefined;

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (prefixDropdownOpen) {
        event.preventDefault();
        closePrefixDropdown();
        return;
      }

      onEscape();
      return;
    }

    if (hasSelectableOptions && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setHighlightedIndex((currentIndex) => {
        const normalizedIndex = Math.min(currentIndex, activeOptions.length - 1);
        if (event.key === 'ArrowDown') return (normalizedIndex + 1) % activeOptions.length;
        return (normalizedIndex - 1 + activeOptions.length) % activeOptions.length;
      });
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey) return;

    const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
    if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) return;

    event.preventDefault();

    if (hasSelectableOptions) {
      const option = activeOptions[highlightedOptionIndex];
      if (option) {
        handleSelectPrefixItem(option.item);
        return;
      }
    }

    onSubmit();
  }, [
    activeOptions,
    closePrefixDropdown,
    handleSelectPrefixItem,
    hasSelectableOptions,
    highlightedOptionIndex,
    onEscape,
    onSubmit,
    prefixDropdownOpen,
  ]);

  const dropdownTitle = prefixTrigger === '@' ? labels.agentTitle : labels.skillTitle;
  const dropdownEmptyLabel = prefixTrigger === '@' ? labels.agentEmpty : labels.skillEmpty;

  return (
    <>
      <div className="relative min-h-[48px]">
        <PlainTextPlugin
          contentEditable={(
            <ContentEditable
              ref={setAnchorElement}
              aria-label={ariaLabel}
              aria-disabled={disabled}
              aria-autocomplete="list"
              aria-controls={prefixDropdownOpen ? prefixListboxId : undefined}
              aria-expanded={prefixDropdownOpen}
              aria-activedescendant={activeDescendantId}
              data-testid="chat-composer-input"
              className={cn(
                'relative z-10 min-h-[48px] max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none',
                'focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60',
                disabled && 'cursor-not-allowed opacity-60',
              )}
              onClick={handleContentClick}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onKeyDown={handleKeyDown}
              onPaste={onPaste}
            />
          )}
          placeholder={(
            <div className="pointer-events-none absolute inset-0 text-sm leading-relaxed text-muted-foreground/60">
              {placeholder}
            </div>
          )}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>

      <PrefixDropdown
        open={prefixDropdownOpen}
        anchor={anchorElement}
        listboxId={prefixListboxId}
        title={dropdownTitle}
        loadingLabel={labels.skillLoading}
        loading={prefixTrigger === '/' && skillsLoading}
        error={prefixTrigger === '/' ? skillsError : null}
        emptyLabel={dropdownEmptyLabel}
        highlightedIndex={highlightedOptionIndex}
        options={activeOptions}
        getOptionId={getPrefixOptionId}
        getTestId={getPrefixOptionTestId}
        onSelect={handleSelectPrefixItem}
      />

      <OnChangePlugin ignoreSelectionChange onChange={handleEditorChange} />
    </>
  );
}

export const ChatLexicalComposer = forwardRef<ChatLexicalComposerHandle, ChatLexicalComposerProps>(
  function ChatLexicalComposer({ disabled, ...props }, ref) {
    const initialConfig: InitialConfigType = {
      namespace: 'ChatLexicalComposer',
      nodes: [ComposerChipNode],
      theme: CHAT_LEXICAL_THEME,
      editable: !disabled,
      onError(error) {
        throw error;
      },
    };

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <HistoryPlugin />
        <ChatLexicalComposerPlugin
          forwardedRef={ref}
          disabled={disabled}
          {...props}
        />
      </LexicalComposer>
    );
  },
);
