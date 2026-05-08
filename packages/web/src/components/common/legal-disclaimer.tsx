import { useAuth } from '../../lib/auth.js';

type Variant = 'chat' | 'insights' | 'projections';

const COPY: Record<Variant, string> = {
  chat: 'AI responses are for informational purposes only and do not constitute financial advice. LasagnaFi is not a registered investment advisor.',
  insights: 'These suggestions are informational only — not financial, tax, or investment advice. Verify with a qualified professional before acting.',
  projections: 'Projections are based on historical data and assumptions that may not reflect future results. This is not financial advice.',
};

export function LegalDisclaimer({ variant }: { variant: Variant }) {
  const { tenant } = useAuth();

  // Only show on hosted (pro) plan, not self-hosted
  if (tenant?.plan !== 'pro') return null;

  return (
    <p
      style={{
        fontSize: 11,
        lineHeight: 1.45,
        color: 'var(--lf-muted)',
        fontFamily: "'JetBrains Mono', monospace",
        margin: 0,
        padding: '6px 16px',
        textAlign: 'center',
        letterSpacing: '0.01em',
      }}
    >
      {COPY[variant]}
    </p>
  );
}
