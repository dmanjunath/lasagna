import { useEffect, useState, useCallback } from "react";
import { useParams } from "wouter";
import { History, MoreVertical, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../lib/api.js";
import { ChatPanel } from "../../components/chat/index.js";
import { Button } from "../../components/ui/button.js";
import { PromptTransition, type TransitionState } from "../../components/plan/prompt-transition.js";
import type { Plan, ChatThread, Message } from "../../lib/types.js";

export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // New: unified transition state
  const [transitionState, setTransitionState] = useState<TransitionState>("idle");
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);

  // Backward-compatible derived state
  const initialMessage = transitionState === "animating" || transitionState === "loading" ? submittedPrompt : null;

  // Show sidebar when not idle (has activity)
  const showSidebar = transitionState !== "idle" || messages.length > 0;

  const handleSelectPrompt = async (prompt: string) => {
    setSubmittedPrompt(prompt);
    setTransitionState("animating");

    // Create thread if needed
    if (!thread && id) {
      const { thread: newThread } = await api.createThread(id);
      setThread(newThread);
    }

    // Wait for animation, then transition to loading
    setTimeout(() => {
      setTransitionState("loading");
    }, 300);
  };

  // Callback when chat response finishes streaming
  const handleChatResponse = useCallback(async () => {
    if (!id) return;
    try {
      const updatedPlan = await api.getPlan(id);
      setPlan(updatedPlan);
      // Only transition to complete after plan is ready
      setTransitionState("complete");
    } catch (err) {
      console.error("Failed to fetch updated plan:", err);
      setTransitionState("complete");
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    // Reset all state when plan changes
    setLoading(true);
    setPlan(null);
    setThread(null);
    setMessages([]);
    setTransitionState("idle");
    setSubmittedPrompt(null);

    const loadPlan = async () => {
      const [planData, { threads }] = await Promise.all([
        api.getPlan(id),
        api.getThreads(id),
      ]);

      setPlan(planData);

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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading plan...</span>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-text-muted">
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
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-display font-semibold text-text">
                {plan.title}
              </h1>
              <p className="text-text-muted mt-1 capitalize">
                {plan.type.replace("_", " ")} Plan
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm">
                <History className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Plan content with transitions */}
          {plan.content ? (
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
    </div>
  );
}
