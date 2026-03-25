import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { StarterPrompts } from "../chat/index.js";
import { UIRenderer } from "../ui-renderer/index.js";
import type { PlanType, UIPayload } from "../../lib/types.js";

export type TransitionState = "idle" | "animating" | "loading" | "complete";

interface PromptTransitionProps {
  planType: PlanType;
  transitionState: TransitionState;
  submittedPrompt: string | null;
  planContent: UIPayload | null;
  onSelectPrompt: (prompt: string) => void;
}

export function PromptTransition({
  planType,
  transitionState,
  submittedPrompt,
  planContent,
  onSelectPrompt,
}: PromptTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      {/* State 1: Idle - show starter prompts */}
      {transitionState === "idle" && (
        <motion.div
          key="starter-prompts"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="glass-card p-8"
        >
          <StarterPrompts planType={planType} onSelectPrompt={onSelectPrompt} />
        </motion.div>
      )}

      {/* State 2: Animating - prompt flying to sidebar */}
      {transitionState === "animating" && submittedPrompt && (
        <motion.div
          key="animating"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="glass-card p-8 flex items-center justify-center"
        >
          {/* Visual feedback during transition */}
          <motion.div
            layoutId="prompt-bubble"
            className="bg-accent/20 text-accent px-4 py-2 rounded-xl text-sm max-w-md truncate"
          >
            {submittedPrompt}
          </motion.div>
        </motion.div>
      )}

      {/* State 3: Loading - show spinner */}
      {transitionState === "loading" && (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="glass-card p-12 flex flex-col items-center justify-center gap-4"
        >
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <p className="text-text-muted">Generating your plan...</p>
        </motion.div>
      )}

      {/* State 4: Complete - show plan content */}
      {transitionState === "complete" && planContent && (
        <motion.div
          key="complete"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <UIRenderer payload={planContent} />
        </motion.div>
      )}

      {/* Fallback: no content yet in complete state */}
      {transitionState === "complete" && !planContent && (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card p-8 text-center text-text-muted"
        >
          No content generated yet.
        </motion.div>
      )}
    </AnimatePresence>
  );
}
