import { useCallback, useRef, useState } from "react";
import { Upload, FileText, Loader2, Settings2, ChevronDown, X, PenLine } from "lucide-react";
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
  const mode: "file" | "text" | null = hasFile ? "file" : hasText ? "text" : null;

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

      <div className="p-5 space-y-4">
        {/* Dual input */}
        <div className="flex flex-col md:flex-row gap-3">

          {/* ── File zone ── */}
          <div className={cn(
            "flex-1 flex flex-col rounded-xl border transition-all",
            mode === "text" ? "opacity-30 pointer-events-none select-none border-border" : "border-border/60 hover:border-border"
          )}>
            {/* Zone header */}
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/40">
              <Upload className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs font-semibold text-text-secondary">Upload a file</span>
              <span className="text-[10px] text-text-muted ml-auto">PDF · PNG · JPG</span>
            </div>

            {/* Drop area */}
            <div
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-2.5 p-5 cursor-pointer transition-colors min-h-[130px]",
                isDragging ? "bg-accent/5" : "hover:bg-surface-hover/30"
              )}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={mode === "text" ? -1 : 0}
              onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }}
              />
              {file ? (
                <>
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                    <FileText className="w-4.5 h-4.5 text-accent" />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium truncate max-w-[200px]">{file.name}</div>
                    <div className="text-xs text-text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
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
                  <div className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                    isDragging ? "bg-accent/15" : "bg-surface-hover"
                  )}>
                    <Upload className={cn("w-4.5 h-4.5", isDragging ? "text-accent" : "text-text-muted")} />
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-medium text-text-secondary">
                      {isDragging ? "Drop to upload" : "Drop here or click to browse"}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── OR divider ── */}
          <div className="flex md:flex-col items-center justify-center gap-2 py-1">
            <div className="flex-1 h-px md:h-auto md:w-px md:flex-1 bg-border" />
            <span className="text-[11px] font-bold tracking-widest text-text-muted/50 uppercase shrink-0 px-1">or</span>
            <div className="flex-1 h-px md:h-auto md:w-px md:flex-1 bg-border" />
          </div>

          {/* ── Text zone ── */}
          <div className={cn(
            "flex-1 flex flex-col rounded-xl border transition-all",
            mode === "file" ? "opacity-30 pointer-events-none select-none border-border" : "border-border/60 hover:border-border"
          )}>
            {/* Zone header */}
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/40">
              <PenLine className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs font-semibold text-text-secondary">Describe your taxes</span>
            </div>

            {/* Textarea */}
            <textarea
              className="flex-1 min-h-[130px] bg-transparent px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-text-muted/50 text-text-secondary"
              placeholder={"e.g. married filing jointly, 2023\nW-2 income $120k, withheld $18k\nstandard deduction, no dependents"}
              value={text}
              onChange={(e) => { setText(e.target.value); if (hasFile) setFile(null); }}
              disabled={mode === "file"}
            />
          </div>

        </div>

        {/* Extraction settings (collapsed) */}
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

        {/* Footer */}
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
              mode === "file" ? "Extract & save" : mode === "text" ? "Save" : "Send"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
