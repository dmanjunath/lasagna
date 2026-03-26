import { describe, it, expect } from 'vitest';
import { responseSchemaV2 } from '../types-v2.js';

describe('responseSchemaV2', () => {
  it('accepts valid response with all fields', () => {
    const input = {
      metrics: [{ label: 'FIRE Number', value: '$2.5M' }],
      content: '## Analysis\n\nSome content here.',
      actions: ['Increase savings', 'Review allocation']
    };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('accepts response with only content', () => {
    const input = { content: 'Just prose, no metrics or actions.' };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects response without content', () => {
    const input = { metrics: [{ label: 'X', value: 'Y' }] };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects metrics with missing label', () => {
    const input = {
      content: 'text',
      metrics: [{ value: '$100' }]
    };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });
});
