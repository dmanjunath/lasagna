import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { homeApi, insightsApi, pathApi } from "@/api/home";
import { txnApi } from "@/api/transactions";
import { monthFlowFrom, monthWindows } from "@/lib/home";

/**
 * Every request the home screen makes, one query per card, so a slow endpoint
 * costs only its own card a placeholder. Mirrors simple-home.tsx's effects.
 */
export function useHomeData(isOwner: boolean) {
  // "Now" for the month cards. Read again on a pull and on each return to the
  // app, so a new day or month moves the windows (M-9).
  const [now, setNow] = useState(() => new Date());
  const windows = monthWindows(now);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(new Date());
    });
    return () => sub.remove();
  }, []);

  const facts = useQuery({ queryKey: ["facts"], queryFn: homeApi.facts });
  const balances = useQuery({ queryKey: ["accounts", "balances"], queryFn: homeApi.balances });
  const history = useQuery({ queryKey: ["net-worth-history"], queryFn: homeApi.netWorthHistory });
  const lastVisit = useQuery({ queryKey: ["last-visit"], queryFn: homeApi.lastVisit, staleTime: Infinity });
  const goals = useQuery({ queryKey: ["goals"], queryFn: homeApi.goals });
  const recurring = useQuery({ queryKey: ["recurring"], queryFn: homeApi.recurring });
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.list });
  const path = useQuery({ queryKey: ["financial-path"], queryFn: pathApi.get });
  const recent = useQuery({ queryKey: ["transactions", "recent"], queryFn: () => txnApi.recent(4) });
  // Under ["transactions"] so a saved edit (category, exclude) refreshes it too.
  const flow = useQuery({
    queryKey: ["transactions", "spending-summary", windows],
    queryFn: async () => {
      const [cur, prev] = await Promise.all([
        homeApi.spendingSummary(windows.current),
        homeApi.spendingSummary(windows.previous).catch(() => null),
      ]);
      return monthFlowFrom(cur, prev);
    },
  });
  // Only the owner can invite, so nobody else needs either call.
  const household = useQuery({
    queryKey: ["household"],
    enabled: isOwner,
    queryFn: async () => {
      const [m, inv] = await Promise.all([homeApi.householdMembers(), homeApi.householdInvites()]);
      const pending = inv.invites.filter((i) => new Date(i.expiresAt).getTime() > Date.now()).length;
      return { size: m.members.length, pending };
    },
  });

  // One page view per home visit, for "since Monday of last week". Recorded
  // after the last visit is read, and fire and forget.
  const lastVisitDone = !lastVisit.isPending;
  useEffect(() => {
    if (lastVisitDone) homeApi.recordPageView("/").catch(() => {});
  }, [lastVisitDone]);

  // The last visit stays as it was: refetched now it would be this visit.
  // A new window is a new query key, which loads by itself, so only a same-day pull refetches the flow.
  const refreshAll = () => {
    const next = new Date();
    const moved = JSON.stringify(monthWindows(next)) !== JSON.stringify(windows);
    setNow(next);
    return Promise.all(
      [facts, balances, history, goals, recurring, insights, path, recent, ...(moved ? [] : [flow]), ...(isOwner ? [household] : [])].map((q) => q.refetch()),
    );
  };

  return { now, facts, balances, history, lastVisit, goals, recurring, insights, path, recent, flow, household, refreshAll };
}
