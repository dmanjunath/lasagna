// packages/web/src/lib/__tests__/directive-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseDirectives, type ParsedSegment } from '../directive-parser.js';

describe('parseDirectives', () => {
  it('returns single markdown segment for plain text', () => {
    const input = 'Just some markdown text.';
    const result = parseDirectives(input);
    expect(result).toEqual([
      { type: 'markdown', content: 'Just some markdown text.' }
    ]);
  });

  it('extracts chart directive', () => {
    const input = `Some text.

::chart
type: area
title: Test Chart
source: run_monte_carlo
::

More text.`;
    const result = parseDirectives(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'markdown', content: 'Some text.' });
    expect(result[1]).toEqual({
      type: 'chart',
      config: { type: 'area', title: 'Test Chart', source: 'run_monte_carlo' }
    });
    expect(result[2]).toEqual({ type: 'markdown', content: 'More text.' });
  });

  it('extracts card directive with variant', () => {
    const input = `::card{variant="warning"}
This is a warning.
::`;
    const result = parseDirectives(input);
    expect(result).toEqual([
      { type: 'card', variant: 'warning', content: 'This is a warning.' }
    ]);
  });

  it('extracts collapse directive with title', () => {
    const input = `::collapse{title="Details"}
Hidden content here.
::`;
    const result = parseDirectives(input);
    expect(result).toEqual([
      { type: 'collapse', title: 'Details', content: 'Hidden content here.' }
    ]);
  });

  it('handles malformed directive gracefully', () => {
    const input = '::unknown\nsome content\n::';
    const result = parseDirectives(input);
    expect(result[0].type).toBe('unknown');
  });
});
