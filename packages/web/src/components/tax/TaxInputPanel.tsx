import { useCallback, useRef, useState } from "react";
import { Upload, FileText, X, PenLine, Check, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { api } from "../../lib/api.js";
import type { TaxInputResult } from "../../lib/types.js";
import { Button, Alert } from "../uikit";

const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Sub-100KB files rendered as "0.0 MB", which reads as an empty file. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Per-file state, so a five-file batch isn't one opaque spinner. */
type QueueStatus = "queued" | "uploading" | "done" | "failed";

interface QueuedFile {
  /** name+size, which is as close to identity as the File API gives us. */
  key: string;
  file: File;
  status: QueueStatus;
  error?: string;
}

interface TaxInputPanelProps {
  /** One document finished extracting. Fires per file, as it lands. */
  onDocument: (doc: TaxInputResult) => void;
  /** The whole batch settled. Fires once, with everything that succeeded. */
  onBatchSettled: (docs: TaxInputResult[]) => void;
}

export function TaxInputPanel({ onDocument, onBatchSettled }: TaxInputPanelProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Some files were not added");
  const [isDragging, setIsDragging] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Mirrors `queue` so addFiles can dedupe without reading stale closure state. */
  const queueRef = useRef<QueuedFile[]>([]);
  queueRef.current = queue;

  const pending = queue.filter((q) => q.status !== "done");
  const hasFiles = pending.length > 0;
  const hasText = text.trim().length > 0;
  const canSubmit = (hasFiles || hasText) && !loading;
  const mode: "file" | "text" | null = hasFiles ? "file" : hasText ? "text" : null;

  const switchToText = () => {
    setInputMode("text");
    setQueue([]);
    setError(null);
  };

  const switchToFile = () => {
    setInputMode("file");
    setText("");
    setError(null);
  };

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setError(null);
    setErrorTitle("Some files were not added");
    // Sorted synchronously against a ref, NOT inside the setQueue updater:
    // React runs the updater after this function returns, so a `rejected`
    // array filled in there is still empty when we check it, and every
    // rejection was silently swallowed whenever the queue was non-empty.
    const seen = new Set(queueRef.current.map((q) => q.key));
    const accepted: QueuedFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(incoming)) {
      if (!ACCEPTED_MIME.includes(file.type)) {
        rejected.push(`${file.name} is not a PDF, PNG, or JPG`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name} is over the 20 MB limit`);
        continue;
      }
      // Picking the same file twice used to queue it twice, then upload it
      // twice, leaving two identical extractions feeding the strategist.
      const key = `${file.name}-${file.size}`;
      if (seen.has(key)) {
        rejected.push(`${file.name} is already in the list`);
        continue;
      }
      seen.add(key);
      accepted.push({ key, file, status: "queued" });
    }
    if (accepted.length > 0) setQueue((prev) => [...prev, ...accepted]);
    if (rejected.length > 0) setError(rejected.join(". ") + ".");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const setStatus = (key: string, status: QueueStatus, message?: string) =>
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, status, error: message } : q)));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    if (!hasFiles) {
      try {
        const docs = await api.submitTaxInput({ text });
        for (const doc of docs) onDocument(doc);
        setText("");
        onBatchSettled(docs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that. Try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Sequential, but one failure no longer abandons the files behind it, and
    // anything that succeeded leaves the queue so a retry can't re-upload it.
    const batch = queue.filter((q) => q.status !== "done");
    const landed: TaxInputResult[] = [];
    const failures: string[] = [];

    for (const item of batch) {
      setStatus(item.key, "uploading");
      try {
        const docs = await api.submitTaxInput({ file: item.file });
        for (const doc of docs) {
          landed.push(doc);
          onDocument(doc);
        }
        setStatus(item.key, "done");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Extraction failed";
        setStatus(item.key, "failed", message);
        failures.push(item.file.name);
      }
    }

    setQueue((prev) => prev.filter((q) => q.status !== "done"));
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (failures.length > 0) {
      // "The rest were saved" was printed even when nothing was: with a single
      // file failing, the alert claimed a save that never happened.
      const allFailed = failures.length === batch.length;
      setErrorTitle(allFailed ? "We could not read your files" : "Some files were not added");
      setError(
        allFailed
          ? `${failures.join(", ")} could not be read. Nothing was saved. Fix or replace ${failures.length === 1 ? "it" : "them"}, then try again.`
          : `${failures.length} of ${batch.length} could not be read (${failures.join(", ")}). The rest were saved. Fix or remove them, then try again.`
      );
    }
    setLoading(false);
    onBatchSettled(landed);
  };

  return (
    <div className="space-y-4">
        {/* Above the dropzone, not below the opt-out link 200px away, so the
            rejected file and the control that rejected it are in one glance. */}
        {error && (
          <div role="alert">
            <Alert tone="negative" title={errorTitle}>
              {error}
            </Alert>
          </div>
        )}

        {/* ── File upload zone ── */}
        {inputMode === "file" && (
          <>
            <div className={cn("tax-input-file-layout", hasFiles && "tax-input-has-files")}>
              {/* Dropzone */}
              <div
                className={cn(
                  "ui-focus flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-ui-lg border-2 border-dashed px-5 py-5 text-center transition-colors",
                  isDragging
                    ? "border-brand bg-brand-soft"
                    : "border-line-strong hover:border-brand hover:bg-brand-softer"
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                // Dragging over the icon or the label bubbles a dragleave from
                // the child, which must not read as leaving the zone.
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
                }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="application/pdf,image/jpeg,image/png"
                  multiple
                  onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); }}
                />
                <div className="flex items-center justify-center gap-2.5">
                  <span className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-ui-md transition-colors",
                    isDragging ? "bg-brand text-brand-fg" : "bg-brand-soft text-brand"
                  )}>
                    <Upload className="h-4 w-4" />
                  </span>
                  <span className="text-[16px] sm:text-[17px] font-semibold text-content">
                    {isDragging ? "Drop to upload" : "Drop files or click to browse"}
                  </span>
                </div>
                <div className="text-[12.5px] text-content-muted">PDF, PNG, or JPG, up to 20 MB each. Multiple files OK.</div>
              </div>

              {/* Selected files — one row per file with its own state, so a
                  five-file batch is not a single opaque spinner. */}
              {queue.length > 0 && (
                <div className="flex flex-col gap-2" aria-live="polite">
                  <div className="text-[13px] font-semibold text-content-muted">
                    {loading
                      ? `Extracting ${queue.filter((q) => q.status === "done").length + 1} of ${queue.length}`
                      : queue.some((q) => q.status === "failed")
                        ? `${queue.filter((q) => q.status === "failed").length} could not be read`
                        : `Ready to upload (${queue.length})`}
                  </div>
                  {queue.map((item) => (
                    <div
                      key={item.key}
                      className={cn(
                        "flex items-center gap-2.5 rounded-ui-md border px-3 py-2 transition-colors",
                        item.status === "failed"
                          ? "border-negative/30 bg-negative-soft"
                          : "border-line bg-canvas-sunken",
                      )}
                    >
                      {item.status === "uploading" ? (
                        <Upload className="h-4 w-4 shrink-0 animate-pulse text-brand" />
                      ) : item.status === "done" ? (
                        <Check className="h-4 w-4 shrink-0 text-positive" />
                      ) : item.status === "failed" ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-negative" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-brand" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-content" title={item.file.name}>
                          {item.file.name}
                        </div>
                        <div className="truncate text-[11px] text-content-muted ui-tnum">
                          {item.status === "uploading"
                            ? "Extracting fields…"
                            : item.status === "failed"
                              ? item.error
                              : formatFileSize(item.file.size)}
                        </div>
                      </div>
                      {!loading && (
                        <button
                          type="button"
                          aria-label={`Remove ${item.file.name}`}
                          className="touch-target ui-focus grid shrink-0 place-items-center rounded-ui-sm p-1 text-content-muted transition-colors hover:text-negative"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQueue((prev) => prev.filter((q) => q.key !== item.key));
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Switch to text. Hidden once files are picked — asking "don't
                feel comfortable uploading?" after the user has committed files
                arrives too late to be an option. */}
            {queue.length === 0 && (
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={switchToText}
                  className="touch-target ui-focus inline-block rounded-ui-sm px-2 text-center text-[13px] text-content-muted transition-colors"
                >
                  Don't feel comfortable uploading tax documents?{" "}
                  <span className="font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline">Describe your situation instead →</span>
                </button>
              </div>
            )}

            <style>{`
              /* minmax(0,…): a long unbreakable filename must not set the
                 column's min-content width and blow the grid past its box. */
              .tax-input-file-layout {
                display: grid;
                grid-template-columns: minmax(0, 1fr);
                gap: 16px;
              }
              @media (min-width: 701px) {
                .tax-input-file-layout.tax-input-has-files {
                  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                }
              }
            `}</style>
          </>
        )}

        {/* ── Text describe zone ── */}
        {inputMode === "text" && (
          <>
            <div className="flex flex-col overflow-hidden rounded-ui-lg border border-line-strong bg-panel shadow-ui-sm transition-[border-color] focus-within:border-brand">
              <label htmlFor="tax-describe" className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
                <PenLine className="h-3.5 w-3.5 shrink-0 text-content-muted" />
                <span className="text-[12.5px] font-semibold text-content-secondary">Describe your taxes</span>
              </label>
              <textarea
                id="tax-describe"
                className="min-h-[160px] resize-none bg-transparent px-4 py-3 text-[14px] text-content placeholder:text-content-faint focus:outline-none"
                placeholder={"e.g. married filing jointly, 2025\nW-2 income $120k, withheld $18k\nstandard deduction, no dependents"}
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
                className="touch-target ui-focus inline-flex items-center rounded-ui-sm px-2 text-[13px] font-semibold text-[rgb(var(--ui-brand-ink))] transition-colors hover:underline"
              >
                ← Upload a document instead
              </button>
            </div>
          </>
        )}

        {/* Footer — there is nothing to submit until something is picked or
            typed, so a permanently disabled button would say nothing. */}
        {mode && (
          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="primary"
              disabled={!canSubmit}
              onClick={handleSubmit}
              loading={loading}
            >
              {loading
                ? hasFiles
                  ? "Extracting…"
                  : "Saving…"
                : mode === "file"
                  ? `Extract & save${pending.length > 1 ? ` (${pending.length})` : ""}`
                  : "Save"}
            </Button>
          </div>
        )}
    </div>
  );
}
