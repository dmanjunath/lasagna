import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { maskCurrencyInText } from "../../lib/hide-amounts.js";

const toolDisplayNames: Record<string, string> = {
  thinking: "Thinking...",
  get_accounts: "Getting your accounts...",
  get_net_worth: "Calculating net worth...",
  get_transactions: "Fetching transactions...",
  get_monthly_summary: "Analyzing monthly data...",
  update_plan_content: "Updating your plan...",
  get_plan: "Loading plan details...",
};

type ToolStatusProps = {
  toolName: string | null;
};

export function ToolStatus({ toolName }: ToolStatusProps) {
  if (!toolName) return null;

  // `toolName` comes straight off the stream and is rendered verbatim in the
  // fallback, so it goes through the same text mask as every other server
  // string the chat displays.
  const displayText = maskCurrencyInText(toolDisplayNames[toolName] || `Running ${toolName}...`);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        className="flex items-center gap-2 text-sm text-text-secondary px-4 py-2"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{displayText}</span>
      </motion.div>
    </AnimatePresence>
  );
}
