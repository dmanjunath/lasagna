import { motion } from "framer-motion";
import type { ExtractionProgress as ProgressType } from "../../lib/ocr/types.js";

interface ExtractionProgressProps {
  progress: ProgressType;
}

export function ExtractionProgress({ progress }: ExtractionProgressProps) {
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{progress.message}</span>
        <span className="text-sm text-text-muted">{progress.progress}%</span>
      </div>
      <div className="h-2 bg-surface-solid rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-accent to-accent-dim"
          initial={{ width: 0 }}
          animate={{ width: `${progress.progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
    </div>
  );
}
