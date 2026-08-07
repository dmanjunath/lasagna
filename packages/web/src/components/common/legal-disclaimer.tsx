import { useAuth } from '../../lib/auth.js';

type Variant = 'chat' | 'projections';

export const DISCLAIMER_COPY: Record<Variant, string> = {
  chat: 'AI responses are for informational purposes only and do not constitute financial advice. LasagnaFi is not a registered investment advisor.',
  projections: 'Projections are based on historical data and assumptions that may not reflect future results. This is not financial advice.',
};

export function LegalDisclaimer({ variant }: { variant: Variant }) {
  const { tenant } = useAuth();

  // Only show on hosted (pro) plan, not self-hosted
  if (tenant?.plan !== 'pro') return null;

  return (
    <p className="px-4 py-1.5 text-[11.5px] leading-[1.45] text-content-faint">
      {DISCLAIMER_COPY[variant]}
    </p>
  );
}
