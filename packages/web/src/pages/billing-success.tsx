import { useLocation, useSearch } from "wouter";
import { BrandMark } from "../components/common/BrandMark";
import { Button } from "../components/uikit";
import { isNativeApp } from "../lib/native";

/** Landing page for Stripe checkout returns from the native app. Public. */
export default function BillingSuccess() {
  const canceled = new URLSearchParams(useSearch()).has("canceled");
  const [, navigate] = useLocation();
  // Universal link opened this page inside the app — offer a way onward
  // instead of telling the user to return to the app they're already in.
  const native = isNativeApp();

  return (
    <div className="ui-root min-h-dvh bg-canvas flex items-center justify-center p-4">
      {/* Ambient warm glow — faint, single brand accent for atmosphere. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, var(--ui-brand-soft), transparent 68%)" }}
        />
      </div>

      <div className="relative w-full max-w-[420px]">
        <div className="rounded-ui-xl border border-line bg-panel shadow-ui-lg p-7 sm:p-8">
          <div className="flex flex-col items-center text-center">
            <BrandMark size={54} />
            <h1 className="mt-4 font-editorial text-[26px] font-medium tracking-[-0.015em] text-content">
              {canceled ? "Checkout canceled" : "Payment complete"}
            </h1>
            <p className="mt-1.5 text-[14px] text-content-secondary">
              {canceled && (
                <>
                  No charge was made.
                  <br />
                </>
              )}
              {native ? (canceled ? "Your plan is unchanged." : "Your plan updates in a moment.") : "You can return to the LasagnaFi app."}
            </p>
            {native && (
              <Button size="lg" className="mt-5" onClick={() => navigate("/profile")}>
                Continue
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
