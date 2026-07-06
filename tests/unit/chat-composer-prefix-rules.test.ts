import { describe, expect, it } from 'vitest';
import { findLogicalStartPrefixQuery } from '@/pages/Chat/composer/prefix-rules';

describe('chat composer logical-start prefix rules', () => {
  it('detects slash queries at the logical start', () => {
    expect(findLogicalStartPrefixQuery('/code')).toEqual({ trigger: '/', query: 'code' });
    expect(findLogicalStartPrefixQuery('   /code')).toEqual({ trigger: '/', query: 'code' });
    expect(findLogicalStartPrefixQuery('\u00a0\u00a0/code')).toEqual({ trigger: '/', query: 'code' });
  });

  it('detects agent queries at the logical start', () => {
    expect(findLogicalStartPrefixQuery('@review')).toEqual({ trigger: '@', query: 'review' });
  });

  it('does not detect prefixes after normal text', () => {
    expect(findLogicalStartPrefixQuery('hello /code')).toBeNull();
    expect(findLogicalStartPrefixQuery('hello @review')).toBeNull();
  });

  it('does not treat completed normal text as an active query', () => {
    expect(findLogicalStartPrefixQuery('plain text')).toBeNull();
    expect(findLogicalStartPrefixQuery('/code review')).toBeNull();
    expect(findLogicalStartPrefixQuery('/code\u00a0review')).toBeNull();
    expect(findLogicalStartPrefixQuery('/code\n')).toBeNull();
  });
});
