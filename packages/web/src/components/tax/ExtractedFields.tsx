import { useState } from "react";
import { Check, AlertTriangle, Pencil } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils.js";
import type { ExtractedData } from "../../lib/types.js";

interface ExtractedFieldsProps {
  data: ExtractedData;
  onUpdate: (data: ExtractedData) => void;
}

export function ExtractedFields({ data, onUpdate }: ExtractedFieldsProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleEdit = (fieldName: string) => {
    setEditingField(fieldName);
    setEditValue(data.fields[fieldName].value.toString());
  };

  const handleSave = (fieldName: string) => {
    const newValue = parseFloat(editValue);
    if (!isNaN(newValue)) {
      onUpdate({
        ...data,
        fields: {
          ...data.fields,
          [fieldName]: { ...data.fields[fieldName], value: newValue, verified: true },
        },
      });
    }
    setEditingField(null);
  };

  const handleVerify = (fieldName: string) => {
    onUpdate({
      ...data,
      fields: {
        ...data.fields,
        [fieldName]: { ...data.fields[fieldName], verified: true },
      },
    });
  };

  const sortedFields = Object.entries(data.fields).sort((a, b) => {
    const lineA = a[1].line.replace(/[a-z]/g, "");
    const lineB = b[1].line.replace(/[a-z]/g, "");
    return parseInt(lineA) - parseInt(lineB);
  });

  return (
    <div className="glass-card rounded-2xl divide-y divide-border overflow-hidden">
      {sortedFields.map(([fieldName, field], i) => {
        const needsReview = !field.verified && data.confidence < 85;
        return (
          <motion.div
            key={fieldName}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="p-4 flex items-center justify-between hover:bg-surface-hover transition-colors"
          >
            <div className="flex items-center gap-3">
              {field.verified ? <Check className="w-4 h-4 text-success" /> : needsReview ? <AlertTriangle className="w-4 h-4 text-warning" /> : <div className="w-4 h-4" />}
              <div>
                <div className="text-sm font-medium capitalize">{fieldName.replace(/([A-Z])/g, " $1").trim()}</div>
                <div className="text-xs text-text-muted">Line {field.line}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {editingField === fieldName ? (
                <div className="flex items-center gap-2">
                  <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-32 px-3 py-1.5 bg-surface-solid border border-border rounded-lg text-sm text-right" autoFocus />
                  <button onClick={() => handleSave(fieldName)} className="px-3 py-1.5 bg-accent text-bg rounded-lg text-sm font-medium">Save</button>
                </div>
              ) : (
                <>
                  <span className={cn("font-medium tabular-nums", needsReview && "text-warning")}>${field.value.toLocaleString()}</span>
                  <button onClick={() => handleEdit(fieldName)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors"><Pencil className="w-4 h-4" /></button>
                  {!field.verified && <button onClick={() => handleVerify(fieldName)} className="px-2 py-1 text-xs rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors">Verify</button>}
                </>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
