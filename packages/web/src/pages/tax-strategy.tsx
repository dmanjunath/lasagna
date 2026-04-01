import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Receipt, FileText, Trash2, Plus } from "lucide-react";
import { Section } from "../components/common/section.js";
import { Button } from "../components/ui/button.js";
import { PdfUploader } from "../components/tax/PdfUploader.js";
import type { TaxDocumentSummary } from "../lib/types.js";
import { api } from "../lib/api.js";

export function TaxStrategy() {
  const [documents, setDocuments] = useState<TaxDocumentSummary[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const { documents } = await api.getTaxDocuments();
      setDocuments(documents);
    } catch (err) {
      console.error("Failed to load documents:", err);
    }
  };

  const handleFilesSelected = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    setError(null);
    try {
      await Promise.all(
        files.map((file) => api.uploadTaxDocument(file))
      );
      // Refresh document list
      const { documents } = await api.getTaxDocuments();
      setDocuments(documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await api.deleteTaxDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium">Tax History</h1>
        <p className="text-text-muted mt-2">Upload and manage your tax documents</p>
      </motion.div>

      <div className="space-y-6 max-w-2xl">
        <Section title="Upload Documents">
          <PdfUploader onFileSelect={handleFilesSelected} isProcessing={isProcessing} />
          {isProcessing && (
            <p className="mt-3 text-sm text-text-muted">Processing...</p>
          )}
          {error && (
            <div className="mt-4 p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}
        </Section>

        {documents.length > 0 ? (
          <Section title="Uploaded Documents">
            <div className="space-y-2">
              {documents.map((doc, i) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-card rounded-xl p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <FileText className="w-5 h-5 text-text-muted shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{doc.fileName}</div>
                        {doc.taxYear && (
                          <div className="text-xs text-text-muted mt-0.5">Tax Year {doc.taxYear}</div>
                        )}
                        {doc.llmSummary && (
                          <div className="text-xs text-text-muted mt-1 line-clamp-2">{doc.llmSummary}</div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteDocument(doc.id)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </Section>
        ) : (
          <Section title="Get Started">
            <div className="glass-card rounded-2xl p-8 text-center">
              <Receipt className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">Upload your tax documents to get started</p>
            </div>
          </Section>
        )}

        {documents.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Button className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Create Tax Strategy Plan
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
