/**
 * App-level watcher for background report generation (freeform advisor
 * reports). The user creates a report, browses anywhere in the product, and
 * gets a toast when it's ready — the watch list lives in localStorage so it
 * survives navigation and refreshes.
 *
 * `watchReport` / `unwatchReport` are called by the plan detail page; the
 * <ReportWatcher /> component (mounted once in App, inside ToastProvider)
 * polls only while something is being watched.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { api } from "./api.js";
import { useToast } from "../components/uikit";

const STORAGE_KEY = "lasagna:watchedReports";
const POLL_MS = 10_000;

interface WatchedReport {
  id: string;
  title: string;
}

function readWatched(): WatchedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WatchedReport[]) : [];
  } catch {
    return [];
  }
}

function writeWatched(list: WatchedReport[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable → watching degrades to the page's own polling
  }
}

/** Start watching a generating/revising report (idempotent). */
export function watchReport(id: string, title: string): void {
  const list = readWatched();
  if (!list.some((w) => w.id === id)) writeWatched([...list, { id, title }]);
}

/** Stop watching (report finished, or its plan was deleted). */
export function unwatchReport(id: string): void {
  writeWatched(readWatched().filter((w) => w.id !== id));
}

export function ReportWatcher() {
  const toast = useToast();
  const [location, navigate] = useLocation();
  // Fresh location inside the interval without re-arming it every navigation.
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const watched = readWatched();
      if (watched.length === 0) return;
      for (const w of watched) {
        // The plan page's own polling covers the on-page case; don't fetch (or
        // toast) while the user is looking at that report.
        if (locationRef.current.includes(w.id)) continue;
        try {
          const plan = await api.getFinancialPlan(w.id);
          const ff = plan.document?.freeform;
          if (!ff) {
            unwatchReport(w.id);
            continue;
          }
          const status = ff.status ?? "ready";
          if (status === "generating" || status === "revising") continue;
          if (cancelled) return;
          unwatchReport(w.id);
          if (status === "ready") {
            toast({
              tone: "positive",
              title: `${w.title} is ready`,
              description: (
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => navigate(`/financial-plans/${w.id}`)}
                >
                  View the plan
                </button>
              ),
              duration: 15_000,
            });
          } else {
            toast({
              tone: "negative",
              title: `${w.title} could not be generated`,
              description: "Open the plan to retry.",
              duration: 15_000,
            });
          }
        } catch (e) {
          // Plan gone (deleted/archived → the API's 404 "Plan not found") →
          // stop watching. Anything else (network blip, server hiccup) leaves
          // the entry for the next tick.
          if (e instanceof Error && /not found/i.test(e.message)) unwatchReport(w.id);
        }
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
