import type { Theme } from '@lasagna/design';

/**
 * The design's character (packages/design mascot art). In the artwork
 * currentColor is the outline, so it follows the text color here and stays
 * visible on a dark canvas.
 */
export function Mascot({ theme, name = 'happy', className }: { theme: Theme; name?: 'happy' | 'sleepy'; className?: string }) {
  const svg = theme.mascot?.[name];
  if (!svg) return null;
  // Trusted, build-time artwork from packages/design. Its fixed outline color goes,
  // so currentColor comes from this wrapper.
  const html = svg.replace(/ color="[^"]*"/, '').replace('<svg ', '<svg width="100%" height="100%" aria-hidden="true" ');
  return <span className={className} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />;
}
