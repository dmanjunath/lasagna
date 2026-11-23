import { rankActions, toActionRow, type ActionRow, type ApiActionRow } from "@web/lib/action-rows";

/** A page's own actions (the web's PageActions types filter): the given insight types, ranked as the web ranks them. */
export function pageActions(insights: ApiActionRow[], types: string[]): ActionRow[] {
  return rankActions(insights.filter((i) => types.includes(i.type ?? "general")).map(toActionRow));
}
