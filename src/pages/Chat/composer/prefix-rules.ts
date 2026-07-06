import type { PrefixQuery, PrefixTrigger } from './types';

const LOGICAL_START_QUERY_PATTERN = /^\s*([@/])([^\s@/]*)(?![\s\S])/;

export function findLogicalStartPrefixQuery(textBeforeCaret: string): PrefixQuery | null {
  const normalized = textBeforeCaret.replace(/\u00a0/g, ' ');
  const match = LOGICAL_START_QUERY_PATTERN.exec(normalized);
  if (!match) return null;

  return {
    trigger: match[1] as PrefixTrigger,
    query: match[2] ?? '',
  };
}
