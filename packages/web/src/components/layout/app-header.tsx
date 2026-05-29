interface AppHeaderProps {
  /** Hamburger / back-arrow / etc. Mounted on the left. */
  leadingSlot?: React.ReactNode;
  /** @deprecated — kept for prop compatibility. Page titles now come from
   * the page's own `<PageHeader>` to avoid double-titling on mobile. */
  title?: string;
  /** @deprecated — kept for prop compatibility. */
  variant?: 'simple' | 'advanced';
}

/**
 * Shared top bar (mobile only). Lives `fixed top-0`. Renders the hamburger
 * and the brand mark; deliberately no centered page title since every page
 * brings its own editorial `<PageHeader>` below.
 */
export function AppHeader({
  leadingSlot,
}: AppHeaderProps) {
  return (
    <header className="fixed top-0 inset-x-0 z-30 bg-bg/95 backdrop-blur border-b border-rule/40 pt-safe-top">
      <div className="max-w-md md:max-w-none md:px-6 mx-auto px-4 h-14 flex items-center gap-2">
        <div className="w-11 -ml-2 shrink-0 flex items-center">{leadingSlot}</div>
        <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
          <div className="lf-mark"><span /><span /><span /></div>
          <span className="text-[15px] font-semibold text-text tracking-tight leading-none">
            Lasagna<span className="text-accent">Fi</span>
          </span>
        </div>
        <div className="w-11 -mr-2 shrink-0" aria-hidden="true" />
      </div>
    </header>
  );
}
