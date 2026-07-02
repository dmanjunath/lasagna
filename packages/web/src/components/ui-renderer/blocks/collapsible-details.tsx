import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { CollapsibleDetailsBlock } from "../../../lib/types.js";

export function CollapsibleDetailsRenderer({ block }: { block: CollapsibleDetailsBlock }) {
  const [isOpen, setIsOpen] = useState(block.defaultOpen ?? false);

  return (
    <div className="rounded-ui-lg border border-line bg-panel shadow-ui-sm overflow-hidden">
      {/* Summary (always visible) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full px-4 py-3 flex items-center gap-2 text-left min-h-touch",
          "hover:bg-canvas-sunken transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-[var(--ui-accent-soft)] focus:ring-inset"
        )}
      >
        <motion.div
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-4 h-4 text-content-muted" />
        </motion.div>
        <span className="text-content font-bold">{block.summary}</span>
      </button>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 border-t border-line">
              <div className="pt-3 prose prose-sm max-w-none prose-p:text-content-secondary prose-strong:text-content prose-li:text-content-secondary marker:text-content-faint">
                <ReactMarkdown>{block.content}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
