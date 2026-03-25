import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { CollapsibleDetailsBlock } from "../../../lib/types.js";

export function CollapsibleDetailsRenderer({ block }: { block: CollapsibleDetailsBlock }) {
  const [isOpen, setIsOpen] = useState(block.defaultOpen ?? false);

  return (
    <div className="glass-card overflow-hidden">
      {/* Summary (always visible) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full px-4 py-3 flex items-center gap-2 text-left",
          "hover:bg-surface/50 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-accent/30 focus:ring-inset"
        )}
      >
        <motion.div
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-4 h-4 text-text-muted" />
        </motion.div>
        <span className="text-text-secondary font-medium">{block.summary}</span>
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
            <div className="px-4 pb-4 pt-0 border-t border-border">
              <div className="pt-3 prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{block.content}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
