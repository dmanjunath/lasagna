import { useCallback, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/bmp": [".bmp"],
  "image/tiff": [".tiff", ".tif"],
  "image/webp": [".webp"],
};
const ACCEPT_STRING = Object.entries(ACCEPTED_TYPES)
  .flatMap(([mime, exts]) => [mime, ...exts])
  .join(",");

interface PdfUploaderProps {
  onFileSelect: (files: File[]) => void;
  isProcessing: boolean;
}

export function PdfUploader({ onFileSelect, isProcessing }: PdfUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFile = useCallback((file: File): string | null => {
    const validMimes = Object.keys(ACCEPTED_TYPES);
    if (!validMimes.includes(file.type)) {
      return "Unsupported file type. Please upload a PDF or image (PNG, JPG, GIF, BMP, TIFF, WebP).";
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`;
    }
    return null;
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      setError(null);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const firstError = files.map(validateFile).find(Boolean);
      if (firstError) {
        setError(firstError);
        return;
      }
      onFileSelect(files);
    },
    [onFileSelect, validateFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      const firstError = files.map(validateFile).find(Boolean);
      if (firstError) {
        setError(firstError);
        e.target.value = ""; // Reset input
        return;
      }
      onFileSelect(files);
    },
    [onFileSelect, validateFile]
  );

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "block w-full py-12 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300",
          isDragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/30 hover:bg-surface-hover",
          isProcessing && "pointer-events-none opacity-50",
          error && "border-red-500"
        )}
      >
        <input type="file" accept={ACCEPT_STRING} multiple onChange={handleFileInput} className="hidden" disabled={isProcessing} />
        <div className="text-center">
          {isProcessing ? (
            <Loader2 className="w-12 h-12 text-accent mx-auto mb-4 animate-spin" />
          ) : (
            <FileUp className="w-12 h-12 text-text-muted mx-auto mb-4" />
          )}
          <div className="font-medium mb-1">{isProcessing ? "Processing..." : "Drop tax documents here"}</div>
          <div className="text-sm text-text-muted">PDF or images (PNG, JPG, etc.) up to 5MB each</div>
        </div>
      </label>
      {error && (
        <p className="mt-2 text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
