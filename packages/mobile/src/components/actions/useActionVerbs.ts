import { useQueryClient } from "@tanstack/react-query";
import type { ActionRow, ApiActionRow } from "@web/lib/action-rows";
import { useState } from "react";
import { insightsApi } from "@/api/home";
import { SNOOZE_HOURS } from "@/lib/home-actions";
import { committed, failed } from "@/ui/feedback";

type InsightsData = { insights: ApiActionRow[]; lastActionsGeneratedAt: string | null; refreshing?: boolean };

/**
 * Done, Snooze and Not for me on an action, as Home does them: the server
 * first, then the row leaves the shared ["insights"] cache (Home's list too).
 * The API cannot reopen an action, so the toasts carry no Undo. Rows marked
 * done on this visit stay listed, ticked, until the screen reloads.
 */
export function useActionVerbs() {
  const qc = useQueryClient();
  const [done, setDone] = useState<ActionRow[]>([]);
  const drop = (id: string) =>
    qc.setQueryData<InsightsData>(["insights"], (old) => (old ? { ...old, insights: old.insights.filter((i) => i.id !== id) } : old));
  const settle = (call: Promise<unknown>, id: string, title: string) =>
    call
      .then(() => {
        drop(id);
        committed(title);
      })
      .catch(() => failed("Couldn't update this action. Try again."));
  return {
    done,
    complete: async (row: ActionRow) => {
      try {
        await insightsApi.acted(row.id);
      } catch {
        failed("Couldn't update this action. Try again.");
        return;
      }
      drop(row.id);
      setDone((d) => [...d, row]);
      committed("Marked done");
    },
    snooze: (id: string) => void settle(insightsApi.snooze(id, SNOOZE_HOURS), id, "Snoozed for 30 days"),
    dismiss: (id: string) => void settle(insightsApi.dismiss(id), id, "Removed from your actions"),
  };
}
