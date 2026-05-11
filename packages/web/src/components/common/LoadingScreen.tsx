/** Full-screen branded loading screen shown during auth check and lazy route loads. */
export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-bg flex flex-col items-center justify-center">
      {/* Ambient background glow — matches Login page */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/3 rounded-full blur-3xl" />
      </div>

      <div className="relative flex flex-col items-center gap-5">
        {/* Animated lasagna bars — mirrors Logo component but with a staggered pulse */}
        <svg width={48} height={35} viewBox="0 0 36 26" fill="none">
          <rect x={0} y={0} width={22} height={6} rx={3} fill="#C9543A" className="animate-loading-bar-1" />
          <rect x={0} y={10} width={32} height={6} rx={3} fill="#E6B85C" className="animate-loading-bar-2" />
          <rect x={0} y={20} width={36} height={6} rx={3} fill="#5A6B3F" className="animate-loading-bar-3" />
        </svg>

        <p className="text-text-muted text-sm tracking-wide animate-pulse">
          Loading...
        </p>
      </div>
    </div>
  );
}

/** Inline loading fallback for lazy-loaded pages inside the shell.
 *  Uses fixed positioning so the loader stays visually centered on screen
 *  regardless of shell layout offsets (sidebar, nav bars). */
export function PageLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="flex flex-col items-center gap-4">
        <svg width={36} height={26} viewBox="0 0 36 26" fill="none">
          <rect x={0} y={0} width={22} height={6} rx={3} fill="#C9543A" className="animate-loading-bar-1" />
          <rect x={0} y={10} width={32} height={6} rx={3} fill="#E6B85C" className="animate-loading-bar-2" />
          <rect x={0} y={20} width={36} height={6} rx={3} fill="#5A6B3F" className="animate-loading-bar-3" />
        </svg>
        <p className="text-text-muted text-xs">Loading...</p>
      </div>
    </div>
  );
}
