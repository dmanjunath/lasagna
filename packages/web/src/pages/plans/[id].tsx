import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { History, Trash2, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api, API_BASE } from "../../lib/api.js";
import { ChatPanel } from "../../components/chat/index.js";
import { Button } from "../../components/ui/button.js";
import { EditableTitle } from "../../components/ui/editable-title.js";
import { PromptTransition, type TransitionState } from "../../components/plan/prompt-transition.js";
import { PlanResponse } from "../../components/plan-response/index.js";
import type { Plan, ChatThread, Message, PlanEdit } from "../../lib/types.js";
import type { ResponseV2, ToolResult } from "../../lib/types-v2.js";
import { isResponseV2 } from "../../lib/types-v2.js";

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
      <div className="flex-1 flex items-center justify-center p-6 text-text-secondary">
        Plan not found
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              {import.meta.env.VITE_DEMO_MODE !== "true" ? (
                <EditableTitle
                  value={plan.title}
                  onSave={async (newTitle) => {
                    await api.updatePlan(plan.id, { title: newTitle });
                    setPlan({ ...plan, title: newTitle });
                  }}
                  className="text-2xl md:text-3xl lg:text-4xl font-display font-semibold"
                />
              ) : (
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-display font-semibold text-text">
                  {plan.title}
                </h1>
              )}
              <p className="text-text-secondary mt-1 capitalize">
                {plan.type.replace("_", " ")} Plan
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleShowHistory}>
                <History className="w-4 h-4" />
              </Button>
              {import.meta.env.VITE_DEMO_MODE !== "true" && (
                <Button variant="ghost" size="sm" onClick={handleDelete}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Plan content with transitions */}
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

      {/* Chat panel - show when there's activity */}
      <AnimatePresence>
        {showSidebar && thread && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="border-l border-border overflow-hidden h-full flex-shrink-0"
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
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
            onClick={() => setShowHistory(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h2 className="text-lg font-semibold text-text">Plan History</h2>
                <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-accent" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-text-secondary text-center py-8">No previous versions found.</p>
                ) : (
                  <div className="space-y-3">
                    {history.map((edit) => (
                      <div
                        key={edit.id}
                        className="p-4 bg-surface rounded-xl border border-border hover:border-accent/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-text font-medium">
                              {edit.changeDescription || "Plan updated"}
                            </p>
                            <p className="text-text-secondary text-sm">
                              {new Date(edit.createdAt).toLocaleString()} • by {edit.editedBy}
                            </p>
                          </div>
                          {import.meta.env.VITE_DEMO_MODE !== "true" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestoreVersion(edit.id)}
                            >
                              Restore
                            </Button>
                          )}
                        </div>
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
