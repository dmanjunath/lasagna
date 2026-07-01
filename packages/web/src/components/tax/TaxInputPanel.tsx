import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, Settings2, ChevronDown, X, PenLine, AlertCircle } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { api } from "../../lib/api.js";
import type { TaxInputResult } from "../../lib/types.js";
import { Button } from "../uikit";

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
                  "ui-focus flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-3 rounded-ui-lg border-2 border-dashed p-6 transition-colors",
                  isDragging
                    ? "border-brand bg-brand-soft"
                    : "border-line-strong hover:border-brand hover:bg-brand-softer"
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
                  "flex h-11 w-11 items-center justify-center rounded-ui-md transition-colors",
                  isDragging ? "bg-brand text-brand-fg" : "bg-brand-soft text-brand"
                )}>
                  <Upload className="h-5 w-5" />
                </div>
                <div className="text-center">
                  <div className="text-[14px] font-semibold text-content">
                    {isDragging ? "Drop to upload" : "Drop files or click to browse"}
                  </div>
                  <div className="mt-1 text-[12.5px] text-content-muted">PDF · PNG · JPG · up to 20 MB each · multiple files OK</div>
                </div>
              </div>

              {/* Selected files list — side on desktop, below on mobile */}
              {files.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
                    Ready to upload · {files.length}
                  </div>
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-2.5 rounded-ui-md border border-line bg-canvas-sunken px-3 py-2">
                      <FileText className="h-4 w-4 shrink-0 text-brand" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-content">{f.name}</div>
                        <div className="text-[11px] text-content-muted ui-tnum">{(f.size / 1024 / 1024).toFixed(1)} MB</div>
                      </div>
                      <button
                        type="button"
                        className="ui-focus shrink-0 rounded-ui-sm p-1 text-content-muted transition-colors hover:text-negative"
                        onClick={(e) => { e.stopPropagation(); setFiles((prev) => prev.filter((_, j) => j !== i)); }}
                      >
                        <X className="h-3.5 w-3.5" />
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
                className="ui-focus rounded-ui-sm text-[13px] text-content-muted transition-colors"
              >
                Don't feel comfortable uploading tax documents?{" "}
                <span className="font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline">Describe your situation instead →</span>
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
            <div className="flex flex-col overflow-hidden rounded-ui-lg border border-line-strong bg-panel shadow-ui-sm transition-[border-color] focus-within:border-brand">
              <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
                <PenLine className="h-3.5 w-3.5 shrink-0 text-content-muted" />
                <span className="text-[12.5px] font-semibold text-content-secondary">Describe your taxes</span>
              </div>
              <textarea
                className="min-h-[160px] resize-none bg-transparent px-4 py-3 text-[14px] text-content placeholder:text-content-faint focus:outline-none"
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
                className="ui-focus rounded-ui-sm text-[13px] font-semibold text-[rgb(var(--ui-brand-ink))] transition-colors hover:underline"
              >
                ← Upload a document instead
              </button>
            </div>
          </>
        )}

        {/* Extraction settings */}
        <div className="overflow-hidden rounded-ui-md border border-line">
          <button
            type="button"
            onClick={() => setShowSettings((p) => !p)}
            className="ui-focus flex w-full items-center justify-between bg-canvas-sunken px-4 py-2.5 text-left transition-colors hover:bg-canvas-sunken/70"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="h-3.5 w-3.5 text-content-muted" />
              <span className="text-[12.5px] font-semibold text-content-secondary">Extraction settings</span>
              {providerUrl !== OPENROUTER_URL && (
                <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand">custom</span>
              )}
            </div>
            <ChevronDown className={cn(
              "h-3.5 w-3.5 text-content-muted transition-transform duration-150",
              showSettings && "rotate-180"
            )} />
          </button>

          {showSettings && (
            <div className="space-y-3 border-t border-line bg-panel px-4 py-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">LLM endpoint</label>
                <input
                  type="url"
                  className="w-full rounded-ui-sm border border-line-strong bg-panel px-3 py-2 font-mono text-[12px] text-content transition-[border-color,box-shadow] focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)] focus:outline-none"
                  value={providerUrl}
                  onChange={(e) => setProviderUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1/chat/completions"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">Model</label>
                  <input
                    type="text"
                    className="w-full rounded-ui-sm border border-line-strong bg-panel px-3 py-2 font-mono text-[12px] text-content transition-[border-color,box-shadow] focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)] focus:outline-none"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="google/gemma-4-26b-a4b-it"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">API key <span className="opacity-60">(optional)</span></label>
                  <input
                    type="password"
                    className="w-full rounded-ui-sm border border-line-strong bg-panel px-3 py-2 font-mono text-[12px] text-content transition-[border-color,box-shadow] focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)] focus:outline-none"
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
          <div className="flex items-start gap-2.5 rounded-ui-md border border-negative/30 bg-negative-soft px-4 py-3 text-[13.5px] text-negative">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
            loading={loading}
          >
            {loading ? (
              hasFiles ? `Extracting${files.length > 1 ? ` (${files.length} files)` : ""}…` : "Saving…"
            ) : (
              mode === "file"
                ? `Extract & save${files.length > 1 ? ` (${files.length})` : ""}`
                : mode === "text" ? "Save"
                : inputMode === "file" ? "Extract & save" : "Save"
            )}
          </Button>
        </div>
    </div>
  );
}
