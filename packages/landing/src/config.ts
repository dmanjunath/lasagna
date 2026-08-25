// PUBLIC_VIDEO_URL is set as a Cloudflare Pages build-time env var.
// Astro exposes env vars to the client only with PUBLIC_ prefix (unlike Vite's VITE_).
// Set to a YouTube or Vimeo embed URL (not the watch URL — use the /embed/ URL).
// Example: https://www.youtube.com/embed/YOUR_VIDEO_ID
export const DEMO_VIDEO_URL: string | null =
  import.meta.env.PUBLIC_VIDEO_URL ?? null;

// PUBLIC_UMAMI_WEBSITE_ID is another Cloudflare Pages build-time env var, set to
// the umami website id. Blank is the self-hosted case: no tag is rendered and
// nothing is requested from umami.
export const UMAMI_WEBSITE_ID: string | null =
  import.meta.env.PUBLIC_UMAMI_WEBSITE_ID ?? null;

export const GITHUB_URL = "https://github.com/dmanjunath/lasagna";
export const APP_URL = "https://app.lasagnafi.com";
export const DEMO_URL = "https://demo.lasagnafi.com";
