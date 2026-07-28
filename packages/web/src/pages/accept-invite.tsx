import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Users, AlertCircle } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";
import { Login } from "./Login";

type Validation =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; householdName: string | null; inviterName: string | null };

const STATUS_COPY: Record<string, string> = {
  expired: "This invitation has expired. Ask them to send a new one.",
  used: "This invitation has already been used.",
  revoked: "This invitation was revoked.",
  not_found: "We couldn't find this invitation. Check the link and try again.",
};

export function AcceptInvite() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [validation, setValidation] = useState<Validation>({ state: "loading" });

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  useEffect(() => {
    if (!token) {
      setValidation({ state: "error", message: "This invite link is missing its token." });
      return;
    }
    api
      .household
      .validateInvite(token)
      .then((res) => {
        if (res.status === "ok") {
          setValidation({ state: "ok", householdName: res.householdName ?? null, inviterName: res.inviterName ?? null });
        } else {
          setValidation({ state: "error", message: STATUS_COPY[res.status] ?? "This invitation is no longer valid." });
        }
      })
      .catch(() => setValidation({ state: "error", message: "We couldn't validate this invitation. Please try again." }));
  }, [token]);

  return (
    <div className="ui-root min-h-dvh bg-canvas flex flex-col items-center justify-center gap-4 px-4 py-8 text-content">
      {/* Ambient warm glow — matches the other logged-out screens. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, var(--ui-brand-soft), transparent 68%)" }}
        />
      </div>

      {validation.state === "loading" && (
        <div className="relative flex items-center gap-2.5 text-content-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Checking your invitation…</span>
        </div>
      )}

      {validation.state === "error" && (
        <div className="relative w-full max-w-[420px] rounded-ui-xl border border-line bg-panel shadow-ui-lg p-7 sm:p-8">
          <div className="flex flex-col items-center text-center">
            <BrandMark size={44} />
            <div className="mt-5 flex items-center gap-2.5 rounded-ui-md bg-negative-soft border border-negative/25 px-3.5 py-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-negative" />
              <span className="text-sm text-negative">{validation.message}</span>
            </div>
            <Button variant="ghost" className="mt-5" onClick={() => navigate("/")}>
              Go to LasagnaFi
            </Button>
          </div>
        </div>
      )}

      {validation.state === "ok" && (
        <>
          {/* Invitation summary */}
          <div className="relative w-full max-w-[420px] rounded-ui-xl border border-line bg-panel shadow-ui-lg p-7 sm:p-8">
            <div className="flex flex-col items-center text-center">
              <span className="grid h-14 w-14 place-items-center rounded-ui-lg bg-brand-soft text-brand">
                <Users className="h-7 w-7" />
              </span>
              <h1 className="mt-4 font-editorial text-[24px] sm:text-[26px] font-medium leading-[1.1] tracking-[-0.015em] text-content">
                {invitationHeadline(validation)}
              </h1>
              <p className="mt-2 text-[14px] leading-relaxed text-content-secondary">
                You'll share the same accounts, balances, and plans — each with your own private login and chat.
              </p>
            </div>
          </div>

          {user ? (
            // Already signed in: the invite is joined at signup/login by email match,
            // so a logged-in user is already in a household. Point them home.
            <div className="relative w-full max-w-[420px] rounded-ui-xl border border-line bg-panel shadow-ui-lg p-6 text-center">
              <p className="text-[14px] text-content-secondary">
                You're already signed in as <span className="font-semibold text-content">{user.email}</span>.
              </p>
              <Button className="mt-4" onClick={() => navigate("/")}>
                Continue to LasagnaFi
              </Button>
            </div>
          ) : (
            // New/returning recipient: authenticate with the invited email. provisionUser
            // matches the pending invite by email and joins the household automatically.
            <div className="relative w-full max-w-[420px]">
              <Login defaultSignup requireName />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function invitationHeadline(v: { householdName: string | null; inviterName: string | null }): string {
  const who = v.inviterName || v.householdName;
  if (who) return `${who} invited you to join their household on LasagnaFi`;
  return "You've been invited to join a household on LasagnaFi";
}
