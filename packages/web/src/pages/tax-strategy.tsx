import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Receipt, FileText, Trash2, Plus, RefreshCw } from "lucide-react";
import { Section } from "../components/common/section.js";
import { ActionItem } from "../components/common/action-item.js";
import { Button } from "../components/ui/button.js";
import { PdfUploader, type UploadStep } from "../components/tax/PdfUploader.js";
import { RedactionReview } from "../components/tax/RedactionReview.js";
import type { TaxDocumentSummary, ExtractionResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import { useChatStore } from "../lib/chat-store.js";

const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married Filing Jointly",
  married_separate: "Married Filing Separately",
  head_of_household: "Head of Household",
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  w2: "W-2 employee",
  self_employed: "Self-employed",
  "1099": "1099 contractor",
  business_owner: "Business owner",
  retired: "Retired",
  unemployed: "Unemployed",
};

export function TaxStrategy() {
  const [documents, setDocuments] = useState<TaxDocumentSummary[]>([]);
  const [uploadStep, setUploadStep] = useState<UploadStep>("idle");
  const [pendingExtraction, setPendingExtraction] = useState<ExtractionResult | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insightStatus, setInsightStatus] = useState<"idle" | "generating" | "done">("idle");
  const [profileInfo, setProfileInfo] = useState<{
    filingStatus: string | null;
    stateOfResidence: string | null;
    employmentType: string | null;
  } | null>(null);

  useEffect(() => {
    loadDocuments();
    api.getFinancialProfile()
      .then(({ financialProfile }) => {
        if (financialProfile) {
          setProfileInfo({
            filingStatus: financialProfile.filingStatus,
            stateOfResidence: financialProfile.stateOfResidence,
            employmentType: financialProfile.employmentType,
          });
        }
      })
      .catch(() => {});
  }, []);

  const loadDocuments = async () => {
    try {
      const { documents } = await api.getTaxDocuments();
      setDocuments(documents);
    } catch {
      setDocuments([]);
    }
  };

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    setPendingExtraction(null);

    try {
      // Step 1: Upload
      setUploadStep("uploading");
      // Small delay so the UI registers the first step visually
      await new Promise((r) => setTimeout(r, 400));

      // Step 2: Extract
      setUploadStep("extracting");
      // extractTaxDocument does upload + extraction + redaction server-side
      // We advance to "redacting" after a short delay to show the step
      const extractionPromise = api.extractTaxDocument(file);
      const timer = setTimeout(() => setUploadStep("redacting"), 3000);
      const extraction = await extractionPromise;
      clearTimeout(timer);

      // Step 3: Show review
      setUploadStep("review");
      setPendingExtraction(extraction);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadStep("idle");
    }
  }, []);

  const handleApprove = useCallback(async () => {
    if (!pendingExtraction) return;
    setIsConfirming(true);
    setUploadStep("analyzing");
    try {
      await api.confirmTaxDocument(pendingExtraction);
      setPendingExtraction(null);
      setUploadStep("done");

      // Refresh document list
      const { documents } = await api.getTaxDocuments();
      setDocuments(documents);

      // Re-generate tax insights in the background
      setInsightStatus("generating");
      api.generateInsights()
        .then(() => setInsightStatus("done"))
        .catch(() => setInsightStatus("idle"));

      // Reset upload state after a moment
      setTimeout(() => setUploadStep("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
      setUploadStep("review"); // Go back to review
    } finally {
      setIsConfirming(false);
    }
  }, [pendingExtraction]);

  const handleReject = useCallback(() => {
    // Discard the extraction — GCS file is orphaned but we don't clean it up here
    // (could add a cancel endpoint if needed)
    setPendingExtraction(null);
    setUploadStep("idle");
    setError(null);
  }, []);

  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await api.deleteTaxDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }, []);

  const { openChat } = useChatStore();

  const taxActions = [
    {
      title: "Increase 401(k) pre-tax contributions",
      tag: "TAX" as const,
      description: "Every dollar you contribute to your 401(k) reduces your taxable income dollar-for-dollar. At your tax bracket, this could save significant money.",
      impact: "Up to $2,800/yr saved",
      impactColor: "green" as const,
      chatPrompt: "How much should I increase my 401(k) contributions to save on taxes?",
    },
    {
      title: "Check your W-4 withholding",
      tag: "TAX" as const,
      description: "If you got a big refund last year, you're over-withholding. Adjusting your W-4 puts more money in each paycheck instead of giving the IRS a free loan.",
      impact: "More cash per paycheck",
      impactColor: "green" as const,
      chatPrompt: "How do I check and adjust my W-4 withholding?",
    },
    {
      title: "Fund your Roth IRA $7,000",
      tag: "TAX" as const,
      description: "Roth contributions are made with after-tax dollars, but all future growth and withdrawals are completely tax-free. The $7,000 limit is use-it-or-lose-it each year.",
      impact: "Tax-free growth forever",
      impactColor: "green" as const,
      chatPrompt: "Walk me through funding my Roth IRA for this year.",
    },
    {
      title: "Check HSA eligibility",
      tag: "TAX" as const,
      description: "If you have a high-deductible health plan, an HSA offers triple tax advantages: tax-deductible contributions, tax-free growth, and tax-free withdrawals for medical expenses.",
      impact: "Triple tax advantage",
      impactColor: "green" as const,
      chatPrompt: "Am I eligible for an HSA and how does the triple tax advantage work?",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      {/* Tax Optimization Playbook Hero */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6 mb-6 relative overflow-hidden"
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-warning" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-warning/70">
            Tax Optimization Playbook
          </span>
        </div>
        <div className="font-display text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          {taxActions.length} actions to reduce taxes
        </div>
        <p className="text-sm text-text-secondary">
          Every dollar saved on taxes goes to work for you
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {profileInfo?.employmentType && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-hover text-text-secondary">
              {EMPLOYMENT_LABELS[profileInfo.employmentType] ?? profileInfo.employmentType}
            </span>
          )}
          {(profileInfo?.filingStatus || profileInfo?.stateOfResidence) && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-hover text-text-secondary">
              {[
                profileInfo.filingStatus ? FILING_LABELS[profileInfo.filingStatus] ?? profileInfo.filingStatus : null,
                profileInfo.stateOfResidence,
              ].filter(Boolean).join(" \u00B7 ")}
            </span>
          )}
        </div>
      </motion.div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Section title="Actions">
          <div className="bg-bg-elevated border border-border rounded-xl px-4">
            {taxActions.map((action, i) => (
              <ActionItem
                key={action.title}
                {...action}
                defaultOpen={i === 0}
              />
            ))}
          </div>
        </Section>
      </motion.div>

      {/* Tax-Advantaged Account Stack */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
      >
        <Section title="Tax-Advantaged Account Stack">
          <div className="glass-card p-5">
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold">401(k) pre-tax</div>
                  <div className="text-xs text-text-muted">$23,500 limit</div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-warning/10 text-warning">
                  Contribute more
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold">Roth IRA</div>
                  <div className="text-xs text-text-muted">$7,000 limit</div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-warning/10 text-warning">
                  Unfunded
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold">HSA</div>
                  <div className="text-xs text-text-muted">$4,150 limit</div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-surface-hover text-text-muted">
                  Check eligibility
                </span>
              </div>
            </div>
          </div>
        </Section>
      </motion.div>

      {/* Roth vs Traditional */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24 }}
      >
        <Section title="Roth vs Traditional">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="glass-card p-4 border border-success/25">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-success" />
                <span className="text-xs font-bold uppercase tracking-wider text-success">
                  Roth — Recommended
                </span>
              </div>
              <p className="text-sm text-text-secondary">
                Pay taxes now, withdraw tax-free in retirement. Best if you expect to be in a higher tax bracket later.
              </p>
            </div>
            <div className="glass-card p-4 border border-warning/25">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-xs font-bold uppercase tracking-wider text-warning">
                  Traditional
                </span>
              </div>
              <p className="text-sm text-text-secondary">
                Deduct contributions now, pay taxes on withdrawals. Best if you expect a lower tax bracket in retirement.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openChat("Which is better for my situation — Roth or Traditional?")}
            className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg bg-accent/10 text-accent text-sm font-semibold hover:bg-accent/20 transition-colors"
          >
            Which is better for my situation? &rarr;
          </button>
        </Section>
      </motion.div>

      {/* Tax Calendar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32 }}
      >
        <Section title="Tax Calendar">
          <div className="glass-card p-5">
            <div className="divide-y divide-border">
              <div className="flex items-center gap-4 py-3">
                <div className="w-14 text-center flex-shrink-0">
                  <div className="text-xs font-bold uppercase text-warning">Apr 15</div>
                </div>
                <div className="text-sm text-text-secondary">Roth IRA deadline for prior year</div>
              </div>
              <div className="flex items-center gap-4 py-3">
                <div className="w-14 text-center flex-shrink-0">
                  <div className="text-xs font-bold uppercase text-text-muted">Dec 31</div>
                </div>
                <div className="text-sm text-text-secondary">401(k) contribution deadline</div>
              </div>
              <div className="flex items-center gap-4 py-3">
                <div className="w-14 text-center flex-shrink-0">
                  <div className="text-xs font-bold uppercase text-text-muted">Nov</div>
                </div>
                <div className="text-sm text-text-secondary">Open enrollment (HSA check)</div>
              </div>
            </div>
          </div>
        </Section>
      </motion.div>

      {/* Tax Documents */}
      <Section title="Tax Documents">
        <div className="space-y-6 max-w-2xl">
          {/* Upload / Progress */}
          {uploadStep !== "review" && (
            <PdfUploader onFileSelect={handleFilesSelected} step={uploadStep} />
          )}

          {/* Done state */}
          {uploadStep === "done" && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20 text-success text-sm font-medium"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Document processed successfully
              {insightStatus === "generating" && (
                <span className="ml-auto flex items-center gap-1.5 text-text-muted text-xs font-normal">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Updating tax insights...
                </span>
              )}
              {insightStatus === "done" && (
                <span className="ml-auto text-xs text-success font-normal">Tax insights updated</span>
              )}
            </motion.div>
          )}

          {/* Redaction review */}
          {uploadStep === "review" && pendingExtraction && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <RedactionReview
                extraction={pendingExtraction}
                onApprove={handleApprove}
                onReject={handleReject}
                isConfirming={isConfirming}
              />
            </motion.div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}

          {documents.length > 0 ? (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-3">Uploaded Documents</h4>
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
            </div>
          ) : uploadStep === "idle" && (
            <div className="glass-card rounded-2xl p-8 text-center">
              <Receipt className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">Upload your tax documents to get started</p>
            </div>
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
      </Section>
    </div>
  );
}
