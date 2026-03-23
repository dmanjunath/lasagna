import { FileText, Check, AlertCircle, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils.js";
import type { TaxDocument } from "../../lib/types.js";

interface DocumentListProps {
  documents: TaxDocument[];
  selectedId: string | null;
  onSelect: (doc: TaxDocument) => void;
  onDelete: (id: string) => void;
}

export function DocumentList({ documents, selectedId, onSelect, onDelete }: DocumentListProps) {
  if (documents.length === 0) return null;

  return (
    <div className="space-y-2">
      {documents.map((doc, i) => {
        const data = doc.extractedData;
        const confidence = data?.confidence ?? 0;
        const isLowConfidence = confidence < 85;

        return (
          <motion.div
            key={doc.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onSelect(doc)}
            className={cn("glass-card rounded-xl p-4 cursor-pointer transition-all duration-200", selectedId === doc.id ? "border-accent bg-accent/5" : "hover:bg-surface-hover")}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-text-muted" />
                <div>
                  <div className="font-medium text-sm">{formatDocumentType(doc.documentType)}</div>
                  <div className="text-xs text-text-muted">{doc.extractedAt ? new Date(doc.extractedAt).toLocaleDateString() : "Processing..."}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {data && (
                  <div className={cn("flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full", isLowConfidence ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
                    {isLowConfidence ? <AlertCircle className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                    {confidence}%
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }} className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function formatDocumentType(type: string): string {
  const names: Record<string, string> = { "1040": "Form 1040", "schedule_d": "Schedule D", "w2": "W-2", "1099_div": "1099-DIV", "1099_int": "1099-INT" };
  return names[type] || type;
}
