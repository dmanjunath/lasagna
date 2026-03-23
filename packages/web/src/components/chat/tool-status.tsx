import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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

  const displayText = toolDisplayNames[toolName] || `Running ${toolName}...`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        className="flex items-center gap-2 text-sm text-text-muted px-4 py-2"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{displayText}</span>
      </motion.div>
    </AnimatePresence>
  );
}
