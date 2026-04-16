import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, Loader2, Settings2, ChevronDown, X, PenLine, ShieldCheck, HelpCircle } from "lucide-react";
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
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [showSafety, setShowSafety] = useState(false);
  const safetyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasFile = file !== null;
  const hasText = text.trim().length > 0;
  const canSubmit = (hasFile || hasText) && !loading;
  const mode: "file" | "text" | null = hasFile ? "file" : hasText ? "text" : null;

  // Close safety popover on outside click
  useEffect(() => {
    if (!showSafety) return;
    const handler = (e: MouseEvent) => {
      if (safetyRef.current && !safetyRef.current.contains(e.target as Node)) {
        setShowSafety(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSafety]);

  const switchToText = () => {
    setInputMode("text");
    setFile(null);
  };

  const switchToFile = () => {
    setInputMode("file");
    setText("");
  };

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
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">Add tax information</div>
          {/* Safety popover trigger */}
          <div className="relative" ref={safetyRef}>
            <button
              type="button"
              onClick={() => setShowSafety((p) => !p)}
              className="flex items-center justify-center w-4 h-4 rounded-full text-text-muted hover:text-text-secondary transition-colors"
              aria-label="Privacy & safety information"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>

            {showSafety && (
              <div className="absolute left-0 top-6 z-50 w-72 rounded-xl border border-border bg-bg-elevated shadow-xl shadow-black/40 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-success shrink-0" />
                  <span className="text-xs font-semibold text-text-primary">Privacy & security</span>
                  <button
                    type="button"
                    onClick={() => setShowSafety(false)}
                    className="ml-auto text-text-muted hover:text-text-secondary transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <ul className="space-y-2">
                  {[
                    "We use models with open source weights and zero data retention — your documents are never used for training.",
                    "Your document is sent over HTTPS and only used for field extraction.",
                    "Only the extracted tax fields are stored — not the original file.",
                    "Prefer not to upload? Use the text option to describe your situation manually.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs text-text-muted leading-relaxed">
                      <span className="mt-1 w-1 h-1 rounded-full bg-text-muted/50 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">

        {/* ── File upload zone ── */}
        {inputMode === "file" && (
          <>
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-xl border cursor-pointer transition-all min-h-[160px] p-5",
                isDragging
                  ? "border-accent/60 bg-accent/5"
                  : "border-border/60 hover:border-border hover:bg-surface-hover/20"
              )}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
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
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-accent" />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium truncate max-w-[240px]">{file.name}</div>
                    <div className="text-xs text-text-muted mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                  </div>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-danger transition-colors"
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  >
                    <X className="w-3 h-3" /> Remove
                  </button>
                </>
              ) : (
                <>
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                    isDragging ? "bg-accent/15" : "bg-surface-hover"
                  )}>
                    <Upload className={cn("w-5 h-5", isDragging ? "text-accent" : "text-text-muted")} />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium text-text-secondary">
                      {isDragging ? "Drop to upload" : "Drop here or click to browse"}
                    </div>
                    <div className="text-xs text-text-muted mt-1">PDF · PNG · JPG · up to 20 MB</div>
                  </div>
                </>
              )}
            </div>

            {/* Switch to text */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={switchToText}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Don't feel comfortable uploading tax documents?{" "}
                <span className="text-accent hover:underline">Describe your situation instead →</span>
              </button>
            </div>
          </>
        )}

        {/* ── Text describe zone ── */}
        {inputMode === "text" && (
          <>
            <div className="flex flex-col rounded-xl border border-border/60 hover:border-border transition-all">
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/40">
                <PenLine className="w-3.5 h-3.5 text-text-muted shrink-0" />
                <span className="text-xs font-semibold text-text-secondary">Describe your taxes</span>
              </div>
              <textarea
                className="min-h-[160px] bg-transparent px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-text-muted/40 text-text-secondary"
                placeholder={"e.g. married filing jointly, 2023\nW-2 income $120k, withheld $18k\nstandard deduction, no dependents"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
            </div>

            {/* Switch back to upload */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={switchToFile}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                <span className="text-accent hover:underline">← Upload a document instead</span>
              </button>
            </div>
          </>
        )}

        {/* Extraction settings */}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              mode === "file" ? "Extract & save" : mode === "text" ? "Save" : inputMode === "file" ? "Extract & save" : "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
