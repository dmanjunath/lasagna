import { createContext, useContext } from "react";
import type { TabGroup } from "@/lib/routes";

/** The tab a screen lives in. Each tab's stack sets it, since the screens are shared by all five. */
export const TabContext = createContext<TabGroup>("(home)");
export const useOwnTab = () => useContext(TabContext);
