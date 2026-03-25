import { useState } from "react";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Check, AlertTriangle } from "lucide-react";
import { Button } from "../ui/button.js";

interface RedactionPreviewProps {
  images: string[];
  onConfirm: () => void;
  onCancel: () => void;
  isExtracting: boolean;
}

export function RedactionPreview({ images, onConfirm, onCancel, isExtracting }: RedactionPreviewProps) {
  const [currentPage, setCurrentPage] = useState(0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-bg-elevated rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Review Redacted Document</h2>
            <p className="text-sm text-text-muted mt-1">
              Verify that all personal information has been properly redacted before sending
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={isExtracting}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Image preview */}
        <div className="flex-1 overflow-auto p-4 bg-surface/50">
          <div className="flex items-center justify-center min-h-[400px]">
            <img
              src={`data:image/png;base64,${images[currentPage]}`}
              alt={`Page ${currentPage + 1}`}
              className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg border border-border"
            />
          </div>
        </div>

        {/* Page navigation */}
        {images.length > 1 && (
          <div className="flex items-center justify-center gap-4 p-3 border-t border-border bg-surface/30">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-2 rounded-lg hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-text-muted">
              Page {currentPage + 1} of {images.length}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(images.length - 1, p + 1))}
              disabled={currentPage === images.length - 1}
              className="p-2 rounded-lg hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Warning and actions */}
        <div className="p-4 border-t border-border">
          <div className="flex items-start gap-3 mb-4 p-3 rounded-lg bg-warning/10 border border-warning/20">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-warning">Check redaction carefully</p>
              <p className="text-text-muted mt-1">
                Black boxes should cover names, SSN, and addresses. Only financial values should be visible.
                This redacted image will be sent to AI for extraction.
              </p>
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={onCancel} disabled={isExtracting}>
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={isExtracting}>
              {isExtracting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                  Extracting...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Confirm & Extract
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
