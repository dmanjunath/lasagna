import { useCallback, useRef, useState } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { api } from "../../lib/api.js";
import type { TaxInputResult } from "../../lib/types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it";

const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface TaxInputPanelProps {
  onSuccess: (doc: TaxInputResult) => void;
}

export function TaxInputPanel({ onSuccess }: TaxInputPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [providerUrl, setProviderUrl] = useState(OPENROUTER_URL);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasFile = file !== null;
  const hasText = text.trim().length > 0;
  const canSubmit = (hasFile || hasText) && !loading;

  const handleFileChange = useCallback((incoming: File) => {
    setError(null);
    if (!ACCEPTED_MIME.includes(incoming.type)) {
      setError("Unsupported file type. Use PDF, PNG, or JPG.");
      return;
    }
    if (incoming.size > MAX_FILE_SIZE) {
      setError("File too large. Maximum 20MB.");
      return;
    }
    setFile(incoming);
    setText("");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFileChange(dropped);
    },
    [handleFileChange]
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const doc = await api.submitTaxInput({
        file: file ?? undefined,
        text: hasText ? text : undefined,
        providerUrl,
        apiKey: apiKey || undefined,
        model: model || undefined,
      });
      // Reset form
      setFile(null);
      setText("");
      setApiKey("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Dual input sections */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* File drop zone */}
        <div
          className={cn(
            "flex-1 rounded-xl border-2 border-dashed p-6 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors min-h-[160px]",
            isDragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/50",
            hasText && "opacity-40 pointer-events-none select-none"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !hasText && fileInputRef.current?.click()}
          role="button"
          tabIndex={hasText ? -1 : 0}
          onKeyDown={(e) => e.key === "Enter" && !hasText && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileChange(f);
            }}
          />
          {file ? (
            <>
              <FileText className="w-8 h-8 text-accent" />
              <div className="text-sm font-medium text-center truncate max-w-full px-2">{file.name}</div>
              <button
                type="button"
                className="text-xs text-text-muted hover:text-danger transition-colors"
                onClick={(e) => { e.stopPropagation(); setFile(null); }}
              >
                Remove
              </button>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 text-text-muted" />
              <div className="text-sm text-text-secondary text-center">
                Drop a file or click to browse
                <div className="text-xs text-text-muted mt-1">PDF, PNG, JPG · max 20MB</div>
              </div>
            </>
          )}
        </div>

        {/* Text input */}
        <div className={cn(
          "flex-1 flex flex-col gap-2 transition-opacity",
          hasFile && "opacity-40 pointer-events-none select-none"
        )}>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Or describe your tax info
          </label>
          <textarea
            className="flex-1 min-h-[136px] rounded-xl border border-border bg-bg-elevated px-4 py-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-text-muted"
            placeholder="e.g. Filed married jointly in 2023. W-2 income $120,000. Federal tax withheld $18,000. Standard deduction. No dependents."
            value={text}
            onChange={(e) => { setText(e.target.value); setFile(null); }}
            disabled={hasFile}
          />
        </div>
      </div>

      {/* Provider config (always visible) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-1">
          <label className="block text-xs text-text-muted mb-1">LLM Endpoint URL</label>
          <input
            type="url"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            value={providerUrl}
            onChange={(e) => setProviderUrl(e.target.value)}
            placeholder="https://openrouter.ai/api/v1/chat/completions"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Model</label>
          <input
            type="text"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="google/gemma-4-26b-a4b-it"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">API Key <span className="text-text-muted/60">(optional)</span></label>
          <input
            type="password"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-..."
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className={cn(
          "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors",
          canSubmit
            ? "bg-accent text-white hover:bg-accent/90"
            : "bg-surface-hover text-text-muted cursor-not-allowed"
        )}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {hasFile ? "Extracting…" : "Saving…"}
          </>
        ) : (
          "Send"
        )}
      </button>
    </div>
  );
}
