import { usePageContext } from '../../lib/page-context';
import { useIsMobile } from '../../lib/hooks/use-mobile';

export function FloatingChatInput() {
  const { openChat } = usePageContext();
  const isMobile = useIsMobile();

  // Desktop: chat sidebar is always visible — don't render
  if (!isMobile) return null;

  return (
    <button
      onClick={() => openChat()}
      className="flex items-center gap-3 px-4 py-2.5 bg-bg-elevated border-t border-border transition-colors hover:bg-surface-hover w-full"
    >
      <div className="w-7 h-7 rounded-full bg-bg-subtle border border-border-light flex items-center justify-center flex-shrink-0">
        <span className="text-xs">🍝</span>
      </div>
      <span className="flex-1 text-sm text-text-muted text-left truncate">
        Ask Lasagna anything...
      </span>
      <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 animate-pulse" />
    </button>
  );
}
