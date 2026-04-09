import { usePageContext } from '../../lib/page-context';
import { useIsMobile } from '../../lib/hooks/use-mobile';

export function FloatingChatInput() {
  const { openChat } = usePageContext();
  const isMobile = useIsMobile();

  // On desktop, the chat sidebar is always visible — don't render anything
  if (!isMobile) return null;

  return (
    <button
      onClick={() => openChat()}
      className="fixed bottom-16 left-0 right-0 z-30 flex items-center gap-3 px-4 py-2.5 bg-surface-elevated border-t border-border transition-colors hover:bg-surface-hover"
    >
      {/* Small logo icon */}
      <div className="w-7 h-7 rounded-full bg-bg-elevated border border-border-light flex items-center justify-center flex-shrink-0">
        <span className="text-sm">🍝</span>
      </div>

      {/* Placeholder text */}
      <span className="flex-1 text-sm text-text-muted text-left truncate">
        Ask Lasagna anything...
      </span>

      {/* Green pulse dot */}
      <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 animate-pulse" />
    </button>
  );
}
