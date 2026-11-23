import { useQueryClient } from "@tanstack/react-query";
import type { FinancialPath } from "@web/lib/api";
import { useState } from "react";
import { pathApi } from "@/api/home";
import { maskCurrencyInText } from "@/lib/hide-amounts";
import { committed, failed } from "@/ui/feedback";

type Status = "pending" | "done" | "not_applicable";

const DONE_TEXT: Record<Status, (title: string) => string> = {
  done: (t) => `${t} is done`,
  not_applicable: (t) => `${t} is off your path`,
  pending: (t) => `${t} is back on your path`,
};

/**
 * Marking a step, shared by Home's journey card and the journey page: the
 * server answers with the path after the mark, which replaces the shared
 * ["financial-path"] cache, then a toast whose Undo puts the step back where
 * it was. `busy` names the mark in flight, so its button spins and the rest wait.
 */
export function useStepMark() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<{ id: string; status: Status } | null>(null);
  const setPath = (p: FinancialPath) => qc.setQueryData(["financial-path"], p);
  const refetch = () => void qc.invalidateQueries({ queryKey: ["financial-path"] });

  const mark = async (step: { id: string; title: string }, status: Status, undoTo: Status = "pending"): Promise<boolean> => {
    setBusy({ id: step.id, status });
    try {
      setPath(await pathApi.mark(step.id, status));
    } catch {
      failed("Couldn't update this step. Try again.");
      refetch();
      return false;
    } finally {
      setBusy(null);
    }
    // The step moves (on, off, or back), so the toast is the quickest way back to where it was.
    committed(maskCurrencyInText(DONE_TEXT[status](step.title)), () => {
      pathApi
        .mark(step.id, undoTo)
        .then(setPath)
        .catch(() => {
          failed("Couldn't undo. Try again.");
          refetch();
        });
    });
    return true;
  };

  return { mark, busy };
}
