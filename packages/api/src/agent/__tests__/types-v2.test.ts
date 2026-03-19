import { describe, it, expect } from 'vitest';
import { responseSchemaV2 } from '../types-v2.js';

describe('responseSchemaV2', () => {
  it('accepts valid response with all fields', () => {
    const input = {
      chat: 'Here is my analysis.',
      content: '## Analysis\n\nSome content here.',
      metrics: [{ label: 'FIRE Number', value: '$2.5M' }],
      actions: ['Increase savings', 'Review allocation'],
    };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('accepts response with only required fields', () => {
    const input = {
      chat: 'Short reply.',
      content: 'Just prose, no metrics or actions.',
    };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects response missing chat', () => {
    const input = { content: 'Some content.' };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects response missing content', () => {
    const input = { chat: 'Here is a reply.' };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects metrics with missing label', () => {
    const input = {
      chat: 'Reply.',
      content: 'Content.',
      metrics: [{ value: '$100' }],
    };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });
});
