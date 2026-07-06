import type { QuickAccessSkill } from '@/types/skill';

export type ComposerChipKind = 'agent' | 'skill';

export interface ComposerAgentChip {
  kind: 'agent';
  id: string;
  name: string;
  modelDisplay?: string;
}

export interface ComposerSkillChip extends QuickAccessSkill {
  kind: 'skill';
}

export type ComposerChip = ComposerAgentChip | ComposerSkillChip;

export interface ComposerValue {
  text: string;
  agent: ComposerAgentChip | null;
  skill: ComposerSkillChip | null;
}

export interface SerializedComposerValue {
  text: string;
  targetAgentId: string | null;
}

export type PrefixTrigger = '@' | '/';

export interface PrefixQuery {
  trigger: PrefixTrigger;
  query: string;
}

export interface PrefixOption<TItem> {
  id: string;
  label: string;
  description?: string;
  sourceLabel?: string;
  item: TItem;
}
