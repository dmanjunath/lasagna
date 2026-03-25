import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Receipt, Plus, Upload, PenLine } from "lucide-react";
import { Section } from "../components/common/section.js";
import { StatCard } from "../components/common/stat-card.js";
import { Button } from "../components/ui/button.js";
import { PdfUploader } from "../components/tax/PdfUploader.js";
import { ExtractionProgress } from "../components/tax/ExtractionProgress.js";
import { ExtractedFields } from "../components/tax/ExtractedFields.js";
import { DocumentList } from "../components/tax/DocumentList.js";
import { ManualEntryForm } from "../components/tax/ManualEntryForm.js";
import { RedactionPreview } from "../components/tax/RedactionPreview.js";
import { previewRedactedPdf, extractFromImages, type ProgressCallback } from "../lib/ocr/index.js";
import type { ExtractionProgress as ProgressType } from "../lib/ocr/types.js";
import type { TaxReturn, TaxDocument, ExtractedData } from "../lib/types.js";
import { api } from "../lib/api.js";
import { cn } from "../lib/utils.js";

const CURRENT_TAX_YEAR = new Date().getFullYear() - 1;

type EntryMode = "upload" | "manual";

export function TaxStrategy() {
  const [taxReturn, setTaxReturn] = useState<TaxReturn | null>(null);
  const [documents, setDocuments] = useState<TaxDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<TaxDocument | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<EntryMode>("upload");

  // Preview state
  const [previewImages, setPreviewImages] = useState<string[] | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  useEffect(() => {
    loadTaxReturn();
  }, []);

  const loadTaxReturn = async () => {
    try {
      const { returns } = await api.getTaxReturns();
      const currentYearReturn = returns.find((r) => r.taxYear === CURRENT_TAX_YEAR);
      if (currentYearReturn) {
        setTaxReturn(currentYearReturn);
        const { documents } = await api.getTaxReturn(currentYearReturn.id);
        setDocuments(documents);
        if (documents.length > 0) setSelectedDoc(documents[0]);
      }
    } catch (err) {
      console.error("Failed to load tax returns:", err);
    }
  };

  const handleFileSelect = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setProgress({ stage: "loading", progress: 0, message: "Uploading PDF..." });

    try {
      setProgress({ stage: "detecting", progress: 30, message: "Redacting PII..." });

      // Get preview of redacted images
      const preview = await previewRedactedPdf(file);
      setPreviewImages(preview.images);

      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process PDF");
      setProgress(null);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleConfirmExtraction = useCallback(async () => {
    if (!previewImages) return;

    setIsExtracting(true);
    setError(null);

    try {
      let returnId = taxReturn?.id;
      if (!returnId) {
        const { taxReturn: newReturn } = await api.createTaxReturn(CURRENT_TAX_YEAR);
        setTaxReturn(newReturn);
        returnId = newReturn.id;
      }

      const result = await extractFromImages(previewImages, setProgress as ProgressCallback);

      if (result.formId === "unknown") {
        setError(result.errors[0] || "Could not extract data");
        setIsExtracting(false);
        setPreviewImages(null);
        return;
      }

      const extractedData: ExtractedData = {
        confidence: result.confidence,
        fields: Object.fromEntries(
          Object.entries(result.fields).map(([key, field]) => [
            key,
            { value: field.value, line: field.line, verified: false },
          ])
        ),
      };

      const { document } = await api.addTaxDocument(returnId, result.formId, extractedData);
      setDocuments((prev) => [...prev, document]);
      setSelectedDoc(document);

      if (result.errors.length > 0) {
        setError(`Extracted with warnings: ${result.errors.join(", ")}`);
      }

      setPreviewImages(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setIsExtracting(false);
      setProgress(null);
    }
  }, [previewImages, taxReturn]);

  const handleCancelPreview = useCallback(() => {
    setPreviewImages(null);
    setError(null);
  }, []);

  const handleUpdateDocument = useCallback(async (data: ExtractedData) => {
    if (!selectedDoc) return;
    try {
      const { document } = await api.updateTaxDocument(selectedDoc.id, data);
      setDocuments((prev) => prev.map((d) => (d.id === document.id ? document : d)));
      setSelectedDoc(document);
    } catch (err) {
      console.error("Failed to update document:", err);
    }
  }, [selectedDoc]);

  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await api.deleteTaxDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (selectedDoc?.id === id) {
        setSelectedDoc(documents.find((d) => d.id !== id) || null);
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }, [selectedDoc, documents]);

  const handleManualSave = useCallback(async (data: ExtractedData) => {
    try {
      let returnId = taxReturn?.id;
      if (!returnId) {
        const { taxReturn: newReturn } = await api.createTaxReturn(CURRENT_TAX_YEAR);
        setTaxReturn(newReturn);
        returnId = newReturn.id;
      }

      // Check if we already have a manually entered 1040
      const existing1040 = documents.find((d) => d.documentType === "1040");
      if (existing1040) {
        const { document } = await api.updateTaxDocument(existing1040.id, data);
        setDocuments((prev) => prev.map((d) => (d.id === document.id ? document : d)));
        setSelectedDoc(document);
      } else {
        const { document } = await api.addTaxDocument(returnId, "1040", data);
        setDocuments((prev) => [...prev, document]);
        setSelectedDoc(document);
      }
    } catch (err) {
      console.error("Failed to save manual entry:", err);
      throw err;
    }
  }, [taxReturn, documents]);

  const summaryStats = calculateSummaryStats(documents);

  return (
    <>
      {/* Redaction Preview Modal */}
      <AnimatePresence>
        {previewImages && (
          <RedactionPreview
            images={previewImages}
            onConfirm={handleConfirmExtraction}
            onCancel={handleCancelPreview}
            isExtracting={isExtracting}
          />
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium">Tax History</h1>
        <p className="text-text-muted mt-2">Upload and manage your tax documents</p>
      </motion.div>

      {summaryStats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-8">
          <StatCard label="Adjusted Gross Income" value={`$${summaryStats.agi.toLocaleString()}`} delay={0} />
          <StatCard label="Total Tax" value={`$${summaryStats.totalTax.toLocaleString()}`} delay={0.05} />
          <StatCard label="Effective Rate" value={`${summaryStats.effectiveRate.toFixed(1)}%`} status={summaryStats.effectiveRate < 20 ? "success" : "default"} delay={0.1} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <div className="space-y-6">
          <Section title={`Tax Year ${CURRENT_TAX_YEAR}`}>
            {/* Entry Mode Tabs */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setEntryMode("upload")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  entryMode === "upload"
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "text-text-muted hover:text-text hover:bg-surface-hover border border-transparent"
                )}
              >
                <Upload className="w-4 h-4" />
                Upload PDF
              </button>
              <button
                onClick={() => setEntryMode("manual")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  entryMode === "manual"
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "text-text-muted hover:text-text hover:bg-surface-hover border border-transparent"
                )}
              >
                <PenLine className="w-4 h-4" />
                Enter Manually
              </button>
            </div>

            {/* Upload Mode */}
            {entryMode === "upload" && (
              <>
                <PdfUploader onFileSelect={handleFileSelect} isProcessing={isProcessing} />
                {progress && <div className="mt-4"><ExtractionProgress progress={progress} /></div>}
                {error && <div className="mt-4 p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>}
              </>
            )}

            {/* Manual Entry Mode */}
            {entryMode === "manual" && (
              <ManualEntryForm
                initialData={selectedDoc?.extractedData ?? undefined}
                onSave={handleManualSave}
              />
            )}
          </Section>

          {documents.length > 0 && (
            <Section title="Uploaded Documents">
              <DocumentList documents={documents} selectedId={selectedDoc?.id ?? null} onSelect={setSelectedDoc} onDelete={handleDeleteDocument} />
            </Section>
          )}
        </div>

        <div>
          {selectedDoc?.extractedData && (
            <Section title="Extracted Data">
              <ExtractedFields data={selectedDoc.extractedData} onUpdate={handleUpdateDocument} />
            </Section>
          )}

          {!selectedDoc && documents.length === 0 && (
            <Section title="Get Started">
              <div className="glass-card rounded-2xl p-8 text-center">
                <Receipt className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <p className="text-text-muted mb-4">Upload your tax return to see extracted data</p>
              </div>
            </Section>
          )}
        </div>
      </div>

      {documents.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
          <Button className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" />
            Create Tax Strategy Plan
          </Button>
        </motion.div>
      )}
      </div>
    </>
  );
}

function calculateSummaryStats(documents: TaxDocument[]) {
  const form1040 = documents.find((d) => d.documentType === "1040");
  if (!form1040?.extractedData?.fields) return null;

  const fields = form1040.extractedData.fields;
  const agi = fields.adjustedGrossIncome?.value ?? 0;
  const totalTax = fields.totalTax?.value ?? 0;
  const effectiveRate = agi > 0 ? (totalTax / agi) * 100 : 0;

  return { agi, totalTax, effectiveRate };
}
