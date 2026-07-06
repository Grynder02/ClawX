import type { ComposerValue, SerializedComposerValue } from './types';

export function serializeComposerValue(value: ComposerValue): SerializedComposerValue {
  const body = value.text.trim();
  const skillPrefix = value.skill ? `/${value.skill.name}` : '';
  const text = [skillPrefix, body].filter(Boolean).join(' ');

  return {
    text,
    targetAgentId: value.agent?.id ?? null,
  };
}

export function hasSendableComposerValue(value: ComposerValue, attachmentCount: number): boolean {
  const serialized = serializeComposerValue(value);
  return serialized.text.length > 0 || attachmentCount > 0;
}

export function formatVisiblePrefixText(value: Pick<ComposerValue, 'agent' | 'skill'>): string {
  return [
    value.agent ? `@${value.agent.name}` : '',
    value.skill ? `/${value.skill.name}` : '',
  ].filter(Boolean).join(' ');
}
