import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  History,
  Trash2,
  Loader2,
  X,
  ArrowLeft,
  Target,
  TrendingUp,
  CreditCard,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { PlanType } from "../../lib/types.js";
import { api, API_BASE } from "../../lib/api.js";
import { ChatPanel } from "../../components/chat/index.js";
import { Button } from "../../components/uikit";
import { EditableTitle } from "../../components/ui/editable-title.js";
import { PromptTransition, type TransitionState } from "../../components/plan/prompt-transition.js";
import { PlanResponse } from "../../components/plan-response/index.js";
import type { Plan, ChatThread, Message, PlanEdit } from "../../lib/types.js";
import type { ResponseV2, ToolResult } from "../../lib/types-v2.js";
import { isResponseV2 } from "../../lib/types-v2.js";

const PLAN_META: Record<PlanType, { label: string; icon: typeof Target; accent: string }> = {
  retirement: { label: "Retirement", icon: Target, accent: "var(--ui-viz-1)" },
  net_worth: { label: "Net Worth", icon: TrendingUp, accent: "var(--ui-viz-2)" },
  debt_payoff: { label: "Debt Payoff", icon: CreditCard, accent: "var(--ui-viz-4)" },
  custom: { label: "Custom", icon: Sparkles, accent: "var(--ui-viz-5)" },
};

export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // History panel state
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<PlanEdit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // New: unified transition state
  const [transitionState, setTransitionState] = useState<TransitionState>("idle");
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);

  // V2 response state
  const [responseV2, setResponseV2] = useState<ResponseV2 | null>(null);
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);

  // Backward-compatible derived state
  const initialMessage = transitionState === "animating" || transitionState === "loading" ? submittedPrompt : null;

  // Show sidebar when not idle (has activity)
  const showSidebar = transitionState !== "idle" || messages.length > 0;

  const handleSelectPrompt = async (prompt: string) => {
    setSubmittedPrompt(prompt);
    setTransitionState("animating");

    // Create thread if needed
    let activeThread = thread;
    if (!thread && id) {
      const { thread: newThread } = await api.createThread(id);
      setThread(newThread);
      activeThread = newThread;
    }

    // Wait for animation, then transition to loading
    setTimeout(async () => {
      setTransitionState("loading");

      // Call v2 endpoint
      if (activeThread && id) {
        try {
          const res = await fetch(`${API_BASE}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ threadId: activeThread.id, message: prompt }),
          });

          if (!res.ok) {
            throw new Error("Failed to send message");
          }

          const data = await res.json();
          const { toolResults: results } = data;

          // Store tool results
          if (results) {
            setToolResults(results);
          }

          // Fetch updated plan
          const updatedPlan = await api.getPlan(id);
          setPlan(updatedPlan);

          // Check if plan content is v2 format
          if (updatedPlan.content && isResponseV2(updatedPlan.content)) {
            setResponseV2(updatedPlan.content as ResponseV2);
          }

          setTransitionState("complete");
        } catch (err) {
          console.error("Failed to send message:", err);
          setTransitionState("complete");
        }
      }
    }, 300);
  };

  // Callback when chat response completes - receives response directly from chat panel
  const handleChatResponse = useCallback(async (response: ResponseV2 | null, results: ToolResult[]) => {
    if (!id) return;

    // Update state with response from chat
    if (response) {
      setResponseV2(response);
      setToolResults(results);
    }

    // Refresh plan to get latest persisted state
    try {
      const updatedPlan = await api.getPlan(id);
      setPlan(updatedPlan);
    } catch (err) {
      console.error("Failed to fetch updated plan:", err);
    }

    setTransitionState("complete");
  }, [id]);

  const handleDelete = async () => {
    if (!id || !plan) return;
    const confirmed = window.confirm(`Delete "${plan.title}"? This will archive the plan.`);
    if (!confirmed) return;

    try {
      await api.deletePlan(id);
      setLocation("/plans");
    } catch (err) {
      console.error("Failed to delete plan:", err);
    }
  };

  const handleShowHistory = async () => {
    if (!id) return;
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const { history: planHistory } = await api.getPlanHistory(id);
      setHistory(planHistory);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleRestoreVersion = async (editId: string) => {
    if (!id) return;
    try {
      await fetch(`${API_BASE}/api/plans/${id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ editId }),
      });
      // Refresh plan after restore
      const updatedPlan = await api.getPlan(id);
      setPlan(updatedPlan);
      setShowHistory(false);
    } catch (err) {
      console.error("Failed to restore version:", err);
    }
  };

  useEffect(() => {
    if (!id) return;

    // Reset all state when plan changes
    setLoading(true);
    setPlan(null);
    setThread(null);
    setMessages([]);
    setTransitionState("idle");
    setSubmittedPrompt(null);
    setResponseV2(null);
    setToolResults([]);

    const loadPlan = async () => {
      const [planData, { threads }] = await Promise.all([
        api.getPlan(id),
        api.getThreads(id),
      ]);

      setPlan(planData);

      // Check if plan content is v2 format
      if (planData.content && isResponseV2(planData.content)) {
        setResponseV2(planData.content as ResponseV2);
      }

      if (threads.length > 0) {
        setThread(threads[0]);
        const { messages: threadMessages } = await api.getThread(threads[0].id);
        setMessages(threadMessages);
        // If there are existing messages, start in complete state
        if (threadMessages.length > 0) {
          setTransitionState("complete");
        }
      }

      setLoading(false);
    };

    loadPlan();
  }, [id]);

  if (loading) return null;

  if (!plan) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-content-secondary">
        Plan not found
      </div>
    );
  }

  const meta = PLAN_META[plan.type];
  const TypeIcon = meta.icon;

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-8 lg:px-11 pt-4 sm:pt-9 pb-6 sm:pb-24 text-content">
        <div className="max-w-4xl mx-auto">
          {/* ════════ Hero ════════ */}
          <div className="animate-fade-in">
            <Link
              href="/plans"
              className="hidden items-center gap-1.5 text-[13px] font-bold text-content-muted transition-colors hover:text-content sm:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" />
              Plans
            </Link>

            <div className="mt-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em]"
                  style={{
                    background: `color-mix(in srgb, ${meta.accent} 13%, transparent)`,
                    color: meta.accent,
                  }}
                >
                  <TypeIcon className="h-3 w-3" />
                  {meta.label}
                </span>

                <div className="mt-2.5">
                  {import.meta.env.VITE_DEMO_MODE !== "true" ? (
                    <EditableTitle
                      value={plan.title}
                      onSave={async (newTitle) => {
                        await api.updatePlan(plan.id, { title: newTitle });
                        setPlan({ ...plan, title: newTitle });
                      }}
                      className="font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.05] tracking-[-0.028em]"
                    />
                  ) : (
                    <h1 className="font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.05] tracking-[-0.028em] text-content">
                      {plan.title}
                    </h1>
                  )}
                </div>

                <p className="mt-2 inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-semibold text-content-muted">
                  <span className="inline-flex items-center rounded-full bg-canvas-sunken px-2 py-0.5 text-[11px] font-bold capitalize text-content-secondary">
                    {plan.status}
                  </span>
                  <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
                  <span className="ui-tnum">
                    Updated {new Date(plan.updatedAt).toLocaleDateString()}
                  </span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleShowHistory}
                  aria-label="Plan history"
                >
                  <History className="h-[18px] w-[18px]" />
                </Button>
                {import.meta.env.VITE_DEMO_MODE !== "true" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleDelete}
                    aria-label="Delete plan"
                    className="hover:bg-negative-soft hover:text-negative"
                  >
                    <Trash2 className="h-[18px] w-[18px]" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Plan content with transitions */}
          <div className="mt-8">
          {responseV2 ? (
            <PlanResponse
              response={responseV2}
              toolResults={toolResults}
            />
          ) : plan.content ? (
            <PromptTransition
              planType={plan.type}
              transitionState="complete"
              submittedPrompt={null}
              planContent={plan.content}
              onSelectPrompt={handleSelectPrompt}
            />
          ) : (
            <PromptTransition
              planType={plan.type}
              transitionState={transitionState}
              submittedPrompt={submittedPrompt}
              planContent={null}
              onSelectPrompt={handleSelectPrompt}
            />
          )}
          </div>
        </div>
      </div>

      {/* Chat panel - show when there's activity */}
      <AnimatePresence>
        {showSidebar && thread && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="border-l border-line overflow-hidden h-full flex-shrink-0"
          >
            <ChatPanel
              threadId={thread.id}
              initialMessages={messages}
              initialMessage={initialMessage}
              onMessageSent={() => setSubmittedPrompt(null)}
              onChatResponse={handleChatResponse}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* History panel overlay */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowHistory(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-panel-raised border border-line rounded-ui-xl shadow-ui-xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-line">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
                    Version history
                  </span>
                  <h2 className="font-editorial text-[20px] font-bold tracking-[-0.018em] text-content">
                    Plan history
                  </h2>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setShowHistory(false)} aria-label="Close">
                  <X className="h-[18px] w-[18px]" />
                </Button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[calc(80vh-76px)]">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-brand" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="py-10 text-center text-[14px] font-semibold text-content-muted">
                    No previous versions found.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {history.map((edit) => (
                      <div
                        key={edit.id}
                        className="flex items-center justify-between gap-4 rounded-ui-lg border border-line bg-panel p-4 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-ui-sm"
                      >
                        <div className="min-w-0">
                          <p className="text-[14.5px] font-bold text-content">
                            {edit.changeDescription || "Plan updated"}
                          </p>
                          <p className="mt-0.5 text-[12.5px] font-semibold text-content-muted ui-tnum">
                            {new Date(edit.createdAt).toLocaleString()} • by {edit.editedBy}
                          </p>
                        </div>
                        {import.meta.env.VITE_DEMO_MODE !== "true" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRestoreVersion(edit.id)}
                          >
                            Restore
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
