/**
 * The assistant's name in user-facing copy ("Ask Lasagna"). The iOS app shows
 * web pages inside its own theme and names the assistant after the theme's
 * mascot, so it sets `data-assistant` on <html> before the page loads. On the
 * web nothing sets it and the name stays Lasagna.
 */
export function assistantName(): string {
  if (typeof document === 'undefined') return 'Lasagna';
  return document.documentElement.dataset.assistant || 'Lasagna';
}
