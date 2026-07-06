import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act, createRef, type RefObject } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ChatLexicalComposer,
  type ChatLexicalComposerHandle,
} from '@/pages/Chat/composer/ChatLexicalComposer';
import type { ComposerAgentChip, ComposerSkillChip } from '@/pages/Chat/composer/types';
import type { AgentSummary } from '@/types/agent';
import type { QuickAccessSkill } from '@/types/skill';

const prefixRuleMock = vi.hoisted(() => ({
  forcedPrefixQuery: null as { trigger: '@' | '/'; query: string } | null,
}));

const lexicalStateMock = vi.hoisted(() => ({
  removeActivePrefixQuery: vi.fn(),
}));

vi.mock('@/pages/Chat/composer/prefix-rules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/Chat/composer/prefix-rules')>();

  return {
    ...actual,
    findLogicalStartPrefixQuery: vi.fn((text: string) => (
      prefixRuleMock.forcedPrefixQuery ?? actual.findLogicalStartPrefixQuery(text)
    )),
  };
});

vi.mock('@/pages/Chat/composer/lexical-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/Chat/composer/lexical-state')>();

  lexicalStateMock.removeActivePrefixQuery.mockImplementation(actual.removeActivePrefixQuery);

  return {
    ...actual,
    removeActivePrefixQuery: lexicalStateMock.removeActivePrefixQuery,
  };
});

const labels = {
  agentTitle: 'Agents',
  skillTitle: 'Skills',
  agentEmpty: 'No agents',
  skillEmpty: 'No skills',
  skillLoading: 'Loading skills',
};

const agent: AgentSummary = {
  id: 'reviewer',
  name: 'Reviewer',
  isDefault: false,
  modelDisplay: 'Claude',
  inheritedModel: false,
  workspace: '/tmp/workspace',
  agentDir: '/tmp/workspace/.openclaw/agents/reviewer',
  mainSessionKey: 'main',
  channelTypes: [],
};

const quickSkill: QuickAccessSkill = {
  name: 'code-review',
  description: 'Review code changes for bugs and regressions.',
  source: 'workspace',
  sourceLabel: 'Workspace',
  manifestPath: '/tmp/workspace/skill/code-review/SKILL.md',
  baseDir: '/tmp/workspace/skill/code-review',
};

const secondAgent: AgentSummary = {
  ...agent,
  id: 'planner',
  name: 'Planner',
  modelDisplay: 'GPT',
  agentDir: '/tmp/workspace/.openclaw/agents/planner',
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

afterEach(() => {
  prefixRuleMock.forcedPrefixQuery = null;
  lexicalStateMock.removeActivePrefixQuery.mockClear();
});

function renderComposer(overrides: Partial<Parameters<typeof ChatLexicalComposer>[0]> = {}) {
  const ref = createRef<ChatLexicalComposerHandle>();
    const props = {
      disabled: false,
      ariaLabel: 'Message input',
      placeholder: 'Type a message',
      agents: [agent],
      skills: [quickSkill],
    skillsLoading: false,
    skillsError: null,
    labels,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onEscape: vi.fn(),
    onRequestSkills: vi.fn(),
    onPreviewSkill: vi.fn(),
    ...overrides,
  };

  render(<ChatLexicalComposer ref={ref} {...props} />);

  return { ref, props };
}

function createComposerProps(overrides: Partial<Parameters<typeof ChatLexicalComposer>[0]> = {}) {
  return {
    disabled: false,
    ariaLabel: 'Message input',
    placeholder: 'Type a message',
    agents: [agent],
    skills: [quickSkill],
    skillsLoading: false,
    skillsError: null,
    labels,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onEscape: vi.fn(),
    onRequestSkills: vi.fn(),
    onPreviewSkill: vi.fn(),
    ...overrides,
  };
}

async function openForcedSkillPrefixDropdown(
  ref: RefObject<ChatLexicalComposerHandle | null>,
  query: string,
) {
  prefixRuleMock.forcedPrefixQuery = { trigger: '/', query };

  act(() => {
    ref.current?.insertSkill({ kind: 'skill', ...quickSkill });
  });

  await screen.findByTestId('chat-composer-prefix-menu');
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  return screen.getByTestId('chat-composer-input');
}

async function openForcedAgentPrefixDropdown(
  ref: RefObject<ChatLexicalComposerHandle | null>,
  query: string,
) {
  prefixRuleMock.forcedPrefixQuery = { trigger: '@', query };

  act(() => {
    ref.current?.insertAgent({
      kind: 'agent',
      id: agent.id,
      name: agent.name,
      modelDisplay: agent.modelDisplay,
    });
  });

  await screen.findByTestId('chat-composer-prefix-menu');
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  return screen.getByTestId('chat-composer-input');
}

function moveSelectionAroundElement(element: HTMLElement, placement: 'before' | 'after') {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  if (placement === 'before') {
    range.setStartBefore(element);
  } else {
    range.setStartAfter(element);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function expectSelectionAroundElement(element: HTMLElement, placement: 'before' | 'after') {
  const selection = window.getSelection();
  expect(selection?.rangeCount).toBe(1);

  const expectedRange = document.createRange();
  if (placement === 'before') {
    expectedRange.setStartBefore(element);
  } else {
    expectedRange.setStartAfter(element);
  }
  expectedRange.collapse(true);

  const actualRange = selection?.getRangeAt(0);
  expect(actualRange?.compareBoundaryPoints(Range.START_TO_START, expectedRange)).toBe(0);
}

function moveSelectionToStart(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element.querySelector('p') ?? element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

async function moveSelectionToStartAndSync(element: HTMLElement) {
  moveSelectionToStart(element);
  document.dispatchEvent(new Event('selectionchange'));
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

async function typeTextAtSelection(input: HTMLElement, text: string) {
  input.focus();

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

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
}

describe('ChatLexicalComposer', () => {
  it('inserts skill chips, previews them, submits on Enter, and clears through the handle', async () => {
    const { ref, props } = renderComposer();
    const skillChip: ComposerSkillChip = { kind: 'skill', ...quickSkill };

    act(() => {
      ref.current?.insertSkill(skillChip);
    });

    const chip = await screen.findByTestId('chat-composer-skill-token');
    expect(chip).toHaveTextContent('/code-review');
    await waitFor(() => {
      expect(props.onChange).toHaveBeenLastCalledWith({
        text: '',
        agent: null,
        skill: skillChip,
      });
    });

    fireEvent.click(chip);
    expect(props.onPreviewSkill).toHaveBeenCalledWith({
      name: 'code-review',
      manifestPath: quickSkill.manifestPath,
    });

    fireEvent.keyDown(screen.getByTestId('chat-composer-input'), { key: 'Enter' });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);

    act(() => {
      ref.current?.clear();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('chat-composer-skill-token')).not.toBeInTheDocument();
      expect(props.onChange).toHaveBeenLastCalledWith({ text: '', agent: null, skill: null });
    });
  });

  it('public insertSkill removes the active slash query and closes the prefix dropdown', async () => {
    const { ref, props } = renderComposer();
    const skillChip: ComposerSkillChip = {
      kind: 'skill',
      ...quickSkill,
      name: 'explain-code',
      manifestPath: '/tmp/workspace/skill/explain-code/SKILL.md',
      baseDir: '/tmp/workspace/skill/explain-code',
    };

    await openForcedSkillPrefixDropdown(ref, 'code');
    lexicalStateMock.removeActivePrefixQuery.mockClear();

    act(() => {
      ref.current?.insertSkill(skillChip);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('chat-composer-prefix-menu')).not.toBeInTheDocument();
    });
    expect(lexicalStateMock.removeActivePrefixQuery).toHaveBeenCalledWith(expect.any(String), {
      trigger: '/',
      query: 'code',
    });
    await waitFor(() => {
      expect(props.onChange).toHaveBeenLastCalledWith({
        text: '',
        agent: null,
        skill: skillChip,
      });
    });
  });

  it.each([
    { key: 'Backspace', placement: 'after' as const },
    { key: 'Delete', placement: 'before' as const },
  ])('removes a skill chip atomically with $key', async ({ key, placement }) => {
    const { ref, props } = renderComposer();
    const skillChip: ComposerSkillChip = { kind: 'skill', ...quickSkill };

    act(() => {
      ref.current?.insertSkill(skillChip);
    });

    const chip = await screen.findByTestId('chat-composer-skill-token');
    const input = screen.getByTestId('chat-composer-input');
    input.focus();
    moveSelectionAroundElement(chip, placement);

    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.queryByTestId('chat-composer-skill-token')).not.toBeInTheDocument();
      expect(props.onChange).toHaveBeenLastCalledWith({ text: '', agent: null, skill: null });
    });
  });

  it.each([
    { key: 'ArrowLeft', initialPlacement: 'after' as const, expectedPlacement: 'before' as const },
    { key: 'ArrowRight', initialPlacement: 'before' as const, expectedPlacement: 'after' as const },
  ])('moves the caret over a skill chip atomically with $key', async ({ key, initialPlacement, expectedPlacement }) => {
    const { ref } = renderComposer();
    const skillChip: ComposerSkillChip = { kind: 'skill', ...quickSkill };

    act(() => {
      ref.current?.insertSkill(skillChip);
    });

    const chip = await screen.findByTestId('chat-composer-skill-token');
    const input = screen.getByTestId('chat-composer-input');
    input.focus();
    moveSelectionAroundElement(chip, initialPlacement);

    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expectSelectionAroundElement(chip, expectedPlacement);
  });

  it('opens skill suggestions from a slash typed at the caret before existing text', async () => {
    const { props } = renderComposer();
    const input = screen.getByTestId('chat-composer-input');

    await typeTextAtSelection(input, 'hello world');
    await waitFor(() => {
      expect(props.onChange).toHaveBeenLastCalledWith({ text: 'hello world', agent: null, skill: null });
    });

    await moveSelectionToStartAndSync(input);
    await typeTextAtSelection(input, '/');

    expect(await screen.findByTestId('chat-composer-prefix-menu')).toBeInTheDocument();
    expect(props.onRequestSkills).toHaveBeenCalled();
  });

  it('removes only the slash query typed before existing text when selecting a skill', async () => {
    const { props } = renderComposer();
    const input = screen.getByTestId('chat-composer-input');

    await typeTextAtSelection(input, 'hello');
    await waitFor(() => {
      expect(props.onChange).toHaveBeenLastCalledWith({ text: 'hello', agent: null, skill: null });
    });

    await moveSelectionToStartAndSync(input);
    await typeTextAtSelection(input, '/co');

    fireEvent.click(await screen.findByTestId('chat-composer-skill-option-code-review'));

    await waitFor(() => {
      expect(props.onChange).toHaveBeenLastCalledWith({
        text: 'hello',
        agent: null,
        skill: { kind: 'skill', ...quickSkill },
      });
    });
    expect(screen.getByTestId('chat-composer-input')).toHaveTextContent('/code-review hello');
  });

  it('public insertAgent removes the active at-query and closes the prefix dropdown', async () => {
    const { ref, props } = renderComposer({ agents: [agent, secondAgent] });
    const agentChip: ComposerAgentChip = {
      kind: 'agent',
      id: secondAgent.id,
      name: secondAgent.name,
      modelDisplay: secondAgent.modelDisplay,
    };

    await openForcedAgentPrefixDropdown(ref, 'rev');
    lexicalStateMock.removeActivePrefixQuery.mockClear();

    act(() => {
      ref.current?.insertAgent(agentChip);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('chat-composer-prefix-menu')).not.toBeInTheDocument();
    });
    expect(lexicalStateMock.removeActivePrefixQuery).toHaveBeenCalledWith(expect.any(String), {
      trigger: '@',
      query: 'rev',
    });
    await waitFor(() => {
      expect(props.onChange).toHaveBeenLastCalledWith({
        text: '',
        agent: agentChip,
        skill: null,
      });
    });
  });

  it('submits on Enter when the prefix dropdown is open without matching options', async () => {
    const { ref, props } = renderComposer();
    const input = await openForcedSkillPrefixDropdown(ref, 'missing');

    expect(await screen.findByText(labels.skillEmpty)).toBeInTheDocument();

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not prevent ArrowDown when the prefix dropdown has no selectable options', async () => {
    const { ref } = renderComposer();
    const input = await openForcedSkillPrefixDropdown(ref, 'missing');

    expect(await screen.findByText(labels.skillEmpty)).toBeInTheDocument();

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    { name: 'loading', overrides: { skillsLoading: true }, visibleStateLabel: labels.skillLoading },
    { name: 'error', overrides: { skillsError: 'Could not load skills' }, visibleStateLabel: 'Could not load skills' },
  ])('submits on Enter when stale skill options are hidden by $name state', async ({ overrides, visibleStateLabel }) => {
    const { ref, props } = renderComposer(overrides);
    const input = await openForcedSkillPrefixDropdown(ref, '');

    expect(await screen.findByText(visibleStateLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('chat-composer-skill-option-code-review')).not.toBeInTheDocument();

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'loading', overrides: { skillsLoading: true }, visibleStateLabel: labels.skillLoading },
    { name: 'error', overrides: { skillsError: 'Could not load skills' }, visibleStateLabel: 'Could not load skills' },
  ])('does not prevent ArrowDown when stale skill options are hidden by $name state', async ({ overrides, visibleStateLabel }) => {
    const { ref } = renderComposer(overrides);
    const input = await openForcedSkillPrefixDropdown(ref, '');

    expect(await screen.findByText(visibleStateLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('chat-composer-skill-option-code-review')).not.toBeInTheDocument();
    const listbox = screen.getByTestId('chat-composer-prefix-menu');
    expect(listbox.id).toBeTruthy();
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
  });

  it('moves the highlighted prefix option with ArrowDown when options exist', async () => {
    const secondSkill: QuickAccessSkill = {
      ...quickSkill,
      name: 'explain-code',
      description: 'Explain the selected code.',
      manifestPath: '/tmp/workspace/skill/explain-code/SKILL.md',
      baseDir: '/tmp/workspace/skill/explain-code',
    };
    const { ref } = renderComposer({ skills: [quickSkill, secondSkill] });
    const input = await openForcedSkillPrefixDropdown(ref, '');

    const listbox = await screen.findByTestId('chat-composer-prefix-menu');
    const firstOption = await screen.findByTestId('chat-composer-skill-option-code-review');
    const secondOption = await screen.findByTestId('chat-composer-skill-option-explain-code');

    expect(listbox.id).toBeTruthy();
    const firstOptionId = firstOption.id;
    const secondOptionId = secondOption.id;

    expect(firstOptionId).toBeTruthy();
    expect(secondOptionId).toBeTruthy();
    expect(firstOptionId).not.toBe(secondOptionId);
    expect(firstOption).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-activedescendant', firstOptionId);

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId('chat-composer-skill-option-explain-code')).toHaveAttribute('aria-selected', 'true');
      expect(input).toHaveAttribute('aria-activedescendant', secondOptionId);
    });
  });

  it('keeps option DOM ids unique when skill display names sanitize to the same value', async () => {
    const collidingSkills: QuickAccessSkill[] = [
      {
        ...quickSkill,
        name: 'alpha one',
        manifestPath: '/tmp/workspace/skill/alpha-one/SKILL.md',
        baseDir: '/tmp/workspace/skill/alpha-one',
      },
      {
        ...quickSkill,
        name: 'alpha/one',
        manifestPath: '/tmp/workspace/skill/alpha-slash-one/SKILL.md',
        baseDir: '/tmp/workspace/skill/alpha-slash-one',
      },
    ];
    const { ref } = renderComposer({ skills: collidingSkills });
    const input = await openForcedSkillPrefixDropdown(ref, 'alpha');
    const options = screen.getAllByRole('option');
    const optionIds = options.map((option) => option.id);

    expect(optionIds).toHaveLength(2);
    expect(new Set(optionIds).size).toBe(2);
    expect(input).toHaveAttribute('aria-activedescendant', optionIds[0]);

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', optionIds[1]);
    });
  });

  it('uses unique linked listbox and option ids for multiple composer instances', async () => {
    const firstRef = createRef<ChatLexicalComposerHandle>();
    const secondRef = createRef<ChatLexicalComposerHandle>();
    const firstRender = render(<ChatLexicalComposer ref={firstRef} {...createComposerProps()} />);
    const secondRender = render(<ChatLexicalComposer ref={secondRef} {...createComposerProps()} />);

    prefixRuleMock.forcedPrefixQuery = { trigger: '/', query: '' };
    act(() => {
      firstRef.current?.insertSkill({ kind: 'skill', ...quickSkill });
      secondRef.current?.insertSkill({ kind: 'skill', ...quickSkill });
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('chat-composer-prefix-menu')).toHaveLength(2);
    });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    const firstInput = within(firstRender.container).getByTestId('chat-composer-input');
    const secondInput = within(secondRender.container).getByTestId('chat-composer-input');
    const firstListbox = within(firstRender.container).getByTestId('chat-composer-prefix-menu');
    const secondListbox = within(secondRender.container).getByTestId('chat-composer-prefix-menu');
    const firstOption = within(firstRender.container).getByRole('option');
    const secondOption = within(secondRender.container).getByRole('option');

    expect(firstListbox.id).toBeTruthy();
    expect(secondListbox.id).toBeTruthy();
    expect(firstListbox.id).not.toBe(secondListbox.id);
    expect(firstOption.id).toBeTruthy();
    expect(secondOption.id).toBeTruthy();
    expect(firstOption.id).not.toBe(secondOption.id);
    expect(firstInput).toHaveAttribute('aria-controls', firstListbox.id);
    expect(secondInput).toHaveAttribute('aria-controls', secondListbox.id);
    expect(firstInput).toHaveAttribute('aria-activedescendant', firstOption.id);
    expect(secondInput).toHaveAttribute('aria-activedescendant', secondOption.id);
  });
});
