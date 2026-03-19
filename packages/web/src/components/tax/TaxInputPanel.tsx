import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, Loader2, Settings2, ChevronDown, X, PenLine } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { api } from "../../lib/api.js";
import type { TaxInputResult } from "../../lib/types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it";

const LS_KEY_PROVIDER = "lasagna_tax_llm_endpoint";
const LS_KEY_MODEL = "lasagna_tax_llm_model";
const LS_KEY_API_KEY = "lasagna_tax_llm_api_key";

const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface TaxInputPanelProps {
  onSuccess: (doc: TaxInputResult) => void;
}

export function TaxInputPanel({ onSuccess }: TaxInputPanelProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [providerUrl, setProviderUrl] = useState(() => localStorage.getItem(LS_KEY_PROVIDER) || OPENROUTER_URL);
  const [model, setModel] = useState(() => localStorage.getItem(LS_KEY_MODEL) || DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS_KEY_API_KEY) || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist LLM settings to localStorage
  useEffect(() => { localStorage.setItem(LS_KEY_PROVIDER, providerUrl); }, [providerUrl]);
  useEffect(() => { localStorage.setItem(LS_KEY_MODEL, model); }, [model]);
  useEffect(() => { localStorage.setItem(LS_KEY_API_KEY, apiKey); }, [apiKey]);

  const hasFiles = files.length > 0;
  const hasText = text.trim().length > 0;
  const canSubmit = (hasFiles || hasText) && !loading;
  const mode: "file" | "text" | null = hasFiles ? "file" : hasText ? "text" : null;

  const switchToText = () => {
    setInputMode("text");
    setFiles([]);
  };

  const switchToFile = () => {
    setInputMode("file");
    setText("");
  };

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setError(null);
    const newFiles: File[] = [];
    for (const f of Array.from(incoming)) {
      if (!ACCEPTED_MIME.includes(f.type)) {
        setError("Unsupported file type. Use PDF, PNG, or JPG.");
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        setError("File too large. Maximum 20MB.");
        continue;
      }
      newFiles.push(f);
    }
    if (newFiles.length > 0) {
      setFiles((prev) => [...prev, ...newFiles]);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      if (hasFiles) {
        // Process each file sequentially
        for (const f of files) {
          const docs = await api.submitTaxInput({
            file: f,
            providerUrl,
            apiKey: apiKey || undefined,
            model: model || undefined,
          });
          for (const doc of docs) onSuccess(doc);
        }
      } else {
        const docs = await api.submitTaxInput({
          text: hasText ? text : undefined,
          providerUrl,
          apiKey: apiKey || undefined,
          model: model || undefined,
        });
        for (const doc of docs) onSuccess(doc);
      }
      setFiles([]);
      setText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">

        {/* ── File upload zone ── */}
        {inputMode === "file" && (
          <>
            <div className={cn("tax-input-file-layout", hasFiles && "tax-input-has-files")}>
              {/* Dropzone */}
              <div
                className={cn(
                  "flex flex-col items-center justify-center gap-3 rounded-xl border cursor-pointer transition-all min-h-[120px] p-5",
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
                  multiple
                  onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); }}
                />
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                  isDragging ? "bg-accent/15" : "bg-surface-hover"
                )}>
                  <Upload className={cn("w-5 h-5", isDragging ? "text-accent" : "text-text-secondary")} />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-text-secondary">
                    {isDragging ? "Drop to upload" : "Drop files or click to browse"}
                  </div>
                  <div className="text-sm text-text-secondary mt-1">PDF · PNG · JPG · up to 20 MB each · multiple files OK</div>
                </div>
              </div>

              {/* Selected files list — side on desktop, below on mobile */}
              {files.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                    Ready to upload · {files.length}
                  </div>
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-hover/40 border border-border/40">
                      <FileText className="w-4 h-4 text-accent shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{f.name}</div>
                        <div className="text-[11px] text-text-secondary">{(f.size / 1024 / 1024).toFixed(1)} MB</div>
                      </div>
                      <button
                        type="button"
                        className="text-text-secondary hover:text-danger transition-colors shrink-0"
                        onClick={(e) => { e.stopPropagation(); setFiles((prev) => prev.filter((_, j) => j !== i)); }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Switch to text */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={switchToText}
                className="text-xs text-text-secondary hover:text-text-secondary transition-colors"
              >
                Don't feel comfortable uploading tax documents?{" "}
                <span className="text-accent hover:underline">Describe your situation instead →</span>
              </button>
            </div>

            <style>{`
              .tax-input-file-layout {
                display: grid;
                grid-template-columns: 1fr;
                gap: 16px;
              }
              @media (min-width: 701px) {
                .tax-input-file-layout.tax-input-has-files {
                  grid-template-columns: 1fr 1fr;
                }
              }
            `}</style>
          </>
        )}

        {/* ── Text describe zone ── */}
        {inputMode === "text" && (
          <>
            <div className="flex flex-col rounded-xl border border-border/60 hover:border-border transition-all">
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/40">
                <PenLine className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                <span className="text-xs font-semibold text-text-secondary">Describe your taxes</span>
              </div>
              <textarea
                className="min-h-[160px] bg-transparent px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-text-muted text-text-secondary"
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
                className="text-xs text-text-secondary hover:text-text-secondary transition-colors"
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
              <Settings2 className="w-3.5 h-3.5 text-text-secondary" />
              <span className="text-xs font-medium text-text-secondary">Extraction settings</span>
              {providerUrl !== OPENROUTER_URL && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">custom</span>
              )}
            </div>
            <ChevronDown className={cn(
              "w-3.5 h-3.5 text-text-secondary transition-transform duration-150",
              showSettings && "rotate-180"
            )} />
          </button>

          {showSettings && (
            <div className="px-4 py-4 border-t border-border bg-bg-elevated space-y-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">LLM endpoint</label>
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
                  <label className="block text-xs text-text-secondary mb-1.5">Model</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="google/gemma-4-26b-a4b-it"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5">API key <span className="opacity-50">(optional)</span></label>
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
                : "bg-surface-hover text-text-secondary cursor-not-allowed"
            )}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {hasFiles ? `Extracting${files.length > 1 ? ` (${files.length} files)` : ""}…` : "Saving…"}
              </>
            ) : (
              mode === "file"
                ? `Extract & save${files.length > 1 ? ` (${files.length})` : ""}`
                : mode === "text" ? "Save"
                : inputMode === "file" ? "Extract & save" : "Save"
            )}
          </button>
        </div>
    </div>
  );
}
