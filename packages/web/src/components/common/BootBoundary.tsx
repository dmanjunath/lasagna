import { Component, type ReactNode } from 'react';
import { BrandMark } from './BrandMark';

/**
 * Catches a failed lazy-chunk load during boot.
 *
 * Without this, `import()` rejecting — a stale chunk hash after a deploy or an
 * OTA bundle swap, a radio dropping mid-fetch — leaves #root empty forever with
 * no error and no way out. A blank screen is the worst possible failure for the
 * one moment the user is waiting to see anything at all.
 *
 * Reload rather than retry: if the chunk names moved under us, only a fresh
 * document will pick up the new index.html.
 */
export class BootBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ui-root app-wash fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-canvas px-8 text-center">
        <BrandMark size={44} animate={false} />
        <div>
          <p className="font-editorial text-[20px] font-bold tracking-[-0.015em] text-content">
            Couldn't finish loading
          </p>
          <p className="mt-1.5 text-[13.5px] text-content-muted">
            Check your connection and try again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="ui-focus rounded-ui-md bg-brand px-5 py-2.5 text-[14px] font-semibold text-white"
        >
          Reload
        </button>
      </div>
    );
  }
}
