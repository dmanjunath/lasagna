import { useCallback, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils.js";

interface PdfUploaderProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

export function PdfUploader({ onFileSelect, isProcessing }: PdfUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.type === "application/pdf") {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "block w-full py-12 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300",
        isDragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/30 hover:bg-surface-hover",
        isProcessing && "pointer-events-none opacity-50"
      )}
    >
      <input type="file" accept=".pdf" onChange={handleFileInput} className="hidden" disabled={isProcessing} />
      <div className="text-center">
        {isProcessing ? (
          <Loader2 className="w-12 h-12 text-accent mx-auto mb-4 animate-spin" />
        ) : (
          <FileUp className="w-12 h-12 text-text-muted mx-auto mb-4" />
        )}
        <div className="font-medium mb-1">{isProcessing ? "Processing..." : "Drop tax documents here"}</div>
        <div className="text-sm text-text-muted">Supports: Form 1040 (more coming soon)</div>
      </div>
    </label>
  );
}
