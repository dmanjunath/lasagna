import { useState } from "react";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Check, AlertTriangle, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../ui/button.js";

interface RedactionPreviewProps {
  images: string[];
  onConfirm: () => void;
  onCancel: () => void;
  isExtracting: boolean;
}

export function RedactionPreview({ images, onConfirm, onCancel, isExtracting }: RedactionPreviewProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);

  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const resetZoom = () => setZoom(1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
    >
      <motion.div
        initial={{ scale: 0.98, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex-1 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-bg-elevated border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Review Redacted Document</h2>
            <p className="text-sm text-text-muted mt-1">
              Verify that all personal information has been properly redacted
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Zoom controls */}
            <div className="flex items-center gap-1 mr-4 bg-surface rounded-lg p-1">
              <button
                onClick={zoomOut}
                disabled={zoom <= 0.5}
                className="p-2 rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={resetZoom}
                className="px-2 py-1 text-sm font-medium min-w-[60px] hover:bg-surface-hover rounded transition-colors"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={zoomIn}
                disabled={zoom >= 3}
                className="p-2 rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={onCancel}
              disabled={isExtracting}
              className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Image preview - full height scrollable */}
        <div className="flex-1 overflow-auto bg-neutral-900">
          <div className="min-h-full flex items-start justify-center p-6">
            <img
              src={`data:image/png;base64,${images[currentPage]}`}
              alt={`Page ${currentPage + 1}`}
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
              className="max-w-none shadow-2xl border border-border/50 transition-transform duration-200"
            />
          </div>
        </div>

        {/* Footer with navigation and actions */}
        <div className="bg-bg-elevated border-t border-border p-4">
          <div className="flex items-center justify-between">
            {/* Page navigation */}
            <div className="flex items-center gap-2">
              {images.length > 1 && (
                <>
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="p-2 rounded-lg hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="text-sm text-text-muted min-w-[100px] text-center">
                    Page {currentPage + 1} of {images.length}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(images.length - 1, p + 1))}
                    disabled={currentPage === images.length - 1}
                    className="p-2 rounded-lg hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {/* Warning */}
            <div className="flex items-center gap-2 text-sm text-warning">
              <AlertTriangle className="w-4 h-4" />
              <span>Verify names, SSN, and addresses are redacted (black boxes)</span>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
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
        </div>
      </motion.div>
    </motion.div>
  );
}
