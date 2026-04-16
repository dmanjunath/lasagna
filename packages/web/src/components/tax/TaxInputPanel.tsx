import { useCallback, useRef, useState } from "react";
import { Upload, FileText, Loader2, Settings2, ChevronDown, X } from "lucide-react";
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
  const [showSettings, setShowSettings] = useState(false);
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
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border">
        <div className="text-sm font-semibold">Add tax information</div>
        <div className="text-xs text-text-muted mt-0.5">
          Upload a document or describe your situation — we'll extract the key details
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Dual input */}
        <div className="flex flex-col md:flex-row gap-3 md:gap-0">
          {/* File drop zone */}
          <div
            className={cn(
              "flex-1 rounded-xl border-2 border-dashed p-5 flex flex-col items-center justify-center gap-2.5 cursor-pointer transition-all min-h-[148px]",
              isDragging
                ? "border-accent bg-accent/5 scale-[1.01]"
                : "border-border hover:border-accent/40 hover:bg-surface-hover/40",
              hasText && "opacity-30 pointer-events-none select-none"
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
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-accent" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium truncate max-w-[180px]">{file.name}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-text-muted hover:text-danger transition-colors"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                >
                  <X className="w-3 h-3" /> Remove
                </button>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-surface-hover flex items-center justify-center">
                  <Upload className="w-5 h-5 text-text-muted" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-text-secondary">Drop file or click to browse</div>
                  <div className="text-xs text-text-muted mt-0.5">PDF, PNG, JPG · max 20 MB</div>
                </div>
              </>
            )}
          </div>

          {/* OR divider */}
          <div className="flex md:flex-col items-center justify-center gap-2 px-3 py-1 md:py-0">
            <div className="flex-1 md:flex-none md:h-12 w-px md:w-px bg-border md:bg-border h-px w-full" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted/60 shrink-0">or</span>
            <div className="flex-1 md:flex-none md:h-12 w-px md:w-px bg-border md:bg-border h-px w-full" />
          </div>

          {/* Text input */}
          <div className={cn(
            "flex-1 flex flex-col gap-2 transition-opacity",
            hasFile && "opacity-30 pointer-events-none select-none"
          )}>
            <textarea
              className="flex-1 min-h-[148px] rounded-xl border border-border bg-bg-elevated px-4 py-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-text-muted/70"
              placeholder="Describe your tax situation — e.g. married filing jointly, 2023, W-2 income $120k, federal withheld $18k, standard deduction…"
              value={text}
              onChange={(e) => { setText(e.target.value); setFile(null); }}
              disabled={hasFile}
            />
          </div>
        </div>

        {/* Extraction settings (collapsed by default) */}
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setShowSettings((p) => !p)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-elevated hover:bg-surface-hover transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs font-medium text-text-secondary">Extraction settings</span>
              {providerUrl !== OPENROUTER_URL && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">custom</span>
              )}
            </div>
            <ChevronDown className={cn(
              "w-3.5 h-3.5 text-text-muted transition-transform duration-150",
              showSettings && "rotate-180"
            )} />
          </button>

          {showSettings && (
            <div className="px-4 py-4 border-t border-border bg-bg-elevated space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1.5">LLM endpoint</label>
                <input
                  type="url"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                  value={providerUrl}
                  onChange={(e) => setProviderUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1/chat/completions"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Model</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="google/gemma-4-26b-a4b-it"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">API key <span className="opacity-50">(optional)</span></label>
                  <input
                    type="password"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-or-…"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
            <X className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Footer: submit */}
        <div className="flex items-center justify-end">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all",
              canSubmit
                ? "bg-accent text-white hover:bg-accent/90 shadow-sm shadow-accent/20"
                : "bg-surface-hover text-text-muted cursor-not-allowed"
            )}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {hasFile ? "Extracting…" : "Saving…"}
              </>
            ) : (
              hasFile ? "Extract & save" : hasText ? "Save" : "Send"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
