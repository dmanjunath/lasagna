import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('../api', () => ({ api: { getBillingStatus: vi.fn(() => new Promise(() => {})) } }));

import { BillingProvider, useBilling } from '../billing';

/**
 * The sidebar, the mobile drawer, Home and the plan card all read the plan.
 * When useBilling carried its own state each of them cost another
 * GET /billing/status. These hold the shape that prevents that: every consumer
 * reads one provider's value, and a consumer outside it fails loudly instead of
 * quietly starting a fetch of its own.
 */
describe('BillingProvider', () => {
  it('hands every consumer the same value', () => {
    const seen: unknown[] = [];
    const Consumer = () => { seen.push(useBilling()); return null; };
    renderToStaticMarkup(
      createElement(BillingProvider, null, createElement(Consumer), createElement(Consumer), createElement(Consumer)),
    );
    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });

  it('refuses a consumer outside the provider', () => {
    const Consumer = () => { useBilling(); return null; };
    expect(() => renderToStaticMarkup(createElement(Consumer))).toThrow(/BillingProvider/);
  });
});
